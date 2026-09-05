'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const { createModelCatalogStore } = require('../lib/model-catalog-store');
const { registerModelRuntimeRoutes } = require('../lib/model-runtime-routes');
const { createModelSettingsStore } = require('../lib/model-settings');
const { buildOpenAIModelCatalogPayload, resolveChatModelSelection } = require('../lib/openai-model-catalog');

function createDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      created_at INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      note_type TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      codex_status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE codex_jobs (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      note_filenames_json TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER NOT NULL DEFAULT 1,
      started_at INTEGER,
      finished_at INTEGER
    );
    CREATE TABLE auto_save_decisions (
      id INTEGER PRIMARY KEY,
      decision TEXT NOT NULL,
      action TEXT
    );
    CREATE TABLE note_chunks (
      id INTEGER PRIMARY KEY,
      chunk_id TEXT UNIQUE NOT NULL,
      note_filename TEXT NOT NULL,
      note_title TEXT NOT NULL,
      chunk_type TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE assistant_retrieval_shadow_runs (
      id INTEGER PRIMARY KEY,
      mode TEXT NOT NULL,
      notes_json TEXT NOT NULL,
      chunks_json TEXT NOT NULL,
      context_chars INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT 1
    );
  `);
  runDatabaseMigrations(db);
  return db;
}

function fakeApp() {
  const routes = new Map();
  return {
    routes,
    get(path, handler) { routes.set(`GET ${path}`, handler); },
    put(path, handler) { routes.set(`PUT ${path}`, handler); },
    post(path, handler) { routes.set(`POST ${path}`, handler); },
  };
}

function invoke(handler, { body = {}, headers = {} } = {}) {
  const result = { status: 200, body: null };
  const req = {
    body,
    get(name) {
      return headers[String(name).toLowerCase()] || '';
    },
  };
  const res = {
    status(value) {
      result.status = value;
      return this;
    },
    json(value) {
      result.body = value;
      return this;
    },
  };
  handler(req, res);
  return result;
}

function setup() {
  const db = createDatabase();
  const settings = createModelSettingsStore(db);
  settings.ensureDefaults({
    'chat.model_selection': 'auto:balanced',
    'codex.general_model': 'gpt-5.6-terra',
    'codex.deep_model': 'gpt-5.5',
  });
  const catalogs = createModelCatalogStore(db);
  catalogs.saveSuccess('openai_api', {
    models: [
      {
        id: 'gpt-5.6-terra',
        role: 'balanced',
        description: '균형',
        probeStatus: 'compatible',
      },
      {
        id: 'gpt-5.6-sol',
        role: 'quality',
        description: '품질',
        probeStatus: 'compatible',
      },
    ],
    active: {
      balanced: 'gpt-5.6-terra',
      quality: 'gpt-5.6-sol',
      fast: null,
    },
  });
  catalogs.saveSuccess('codex_subscription', {
    models: [
      { id: 'gpt-5.6-terra', displayName: 'GPT-5.6 Terra', hidden: false },
      { id: 'gpt-5.5', displayName: 'GPT-5.5', hidden: false },
      { id: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', hidden: false },
    ],
  });
  const app = fakeApp();
  registerModelRuntimeRoutes({
    app,
    settings,
    catalogs,
    bootstrapChatModel: 'gpt-5.6-terra',
    reasoningEffort: 'medium',
    getCodexRunnerHealth: () => ({ mode: 'codex', ok: true }),
    refreshOpenAI: async () => catalogs.get('openai_api'),
    refreshCodex: async () => catalogs.get('codex_subscription'),
  });
  return { app, db, settings, catalogs };
}

test('chat model setting validates the catalog and applies from the next response', () => {
  const { app, db, settings } = setup();
  const handler = app.routes.get('PUT /api/settings/chat-model');
  const result = invoke(handler, {
    headers: { 'if-match': '"1"' },
    body: { selection: 'gpt-5.6-sol' },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.selection, 'gpt-5.6-sol');
  assert.equal(result.body.resolvedModelId, 'gpt-5.6-sol');
  assert.equal(result.body.options[0].resolvedModelId, 'gpt-5.6-terra');
  assert.equal(result.body.selectionVersion, 2);
  assert.equal(result.body.appliesFrom, 'next_response');
  assert.equal(settings.get('chat.model_selection').value, 'gpt-5.6-sol');

  const unavailable = invoke(handler, {
    headers: { 'if-match': '"2"' },
    body: { selection: 'gpt-9.9-unknown' },
  });
  assert.equal(unavailable.status, 409);
  assert.equal(unavailable.body.code, 'MODEL_UNAVAILABLE');
  db.close();
});

test('Codex settings update atomically and reject a stale browser', () => {
  const { app, db, settings } = setup();
  const handler = app.routes.get('PUT /api/settings/codex-models');
  const first = invoke(handler, {
    headers: { 'if-match': '"1"' },
    body: {
      generalModel: 'gpt-5.6-sol',
      deepModel: 'gpt-5.6-sol',
      deepVersion: 1,
    },
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.appliesFrom, 'next_job');
  assert.equal(first.body.settings.general.value, 'gpt-5.6-sol');
  assert.equal(first.body.settings.deep.value, 'gpt-5.6-sol');

  const stale = invoke(handler, {
    headers: { 'if-match': '"1"' },
    body: {
      generalModel: 'gpt-5.6-terra',
      deepModel: 'gpt-5.5',
      deepVersion: 1,
    },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'SETTING_VERSION_CONFLICT');
  assert.equal(settings.get('codex.general_model').value, 'gpt-5.6-sol');
  assert.equal(settings.get('codex.deep_model').value, 'gpt-5.6-sol');
  db.close();
});

test('chat API offers compatible unknown exact models and fails closed after removal', async () => {
  const { app, db, settings, catalogs } = setup();
  try {
    const payload = await buildOpenAIModelCatalogPayload({
      models: [{ id: 'gpt-6-astra', created: 100 }, { id: 'gpt-5.6-terra', created: 1 },
        { id: 'gpt-future-rejected' }, { id: 'gpt-future-untested' }],
      probeModel: async id => {
        if (id === 'gpt-future-rejected') throw Object.assign(new Error('unsupported'), { status: 400 });
        if (id === 'gpt-future-untested') throw Object.assign(new Error('temporary'), { status: 503 });
      },
      probeImageInput: async () => {},
    });
    catalogs.saveSuccess('openai_api', payload, { payloadVersion: 2 });
    const get = app.routes.get('GET /api/models/chat');
    const put = app.routes.get('PUT /api/settings/chat-model');
    const catalog = invoke(get);
    assert.equal(catalog.body.resolvedModelId, 'gpt-5.6-terra');
    assert.deepEqual(catalog.body.options.map(option => option.value),
      ['auto:balanced', 'gpt-6-astra', 'gpt-5.6-terra']);
    assert.equal(catalog.body.options[1].label, 'GPT-6 Astra');
    const selected = invoke(put, {
      headers: { 'if-match': '"1"' }, body: { selection: 'gpt-6-astra' },
    });
    assert.equal(selected.status, 200);
    assert.equal(selected.body.resolvedModelId, 'gpt-6-astra');
    assert.equal(selected.body.options[0].resolvedModelId, 'gpt-5.6-terra');
    assert.equal(invoke(get).body.options[0].resolvedModelId, 'gpt-5.6-terra');
    assert.equal(selected.body.appliesFrom, 'next_response');
    catalogs.saveSuccess('openai_api', {
      ...payload, models: payload.models.filter(model => model.id !== 'gpt-6-astra'),
    }, { payloadVersion: 2 });
    const removed = invoke(get).body;
    assert.equal(removed.resolvedModelId, null);
    assert.equal(removed.options[0].resolvedModelId, 'gpt-5.6-terra');
    assert.equal(settings.get('chat.model_selection').value, 'gpt-6-astra');
    assert.equal(invoke(put, {
      headers: { 'if-match': '"2"' }, body: { selection: 'gpt-6-astra' },
    }).body.code, 'MODEL_UNAVAILABLE');
    assert.throws(() => resolveChatModelSelection({
      selection: settings.get('chat.model_selection').value,
      catalogRow: catalogs.get('openai_api'),
    }), { code: 'MODEL_UNAVAILABLE' });
  } finally { db.close(); }
});
