'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const { createModelCatalogStore } = require('../lib/model-catalog-store');
const {
  CHAT_SELECTION_AUTO,
  buildOpenAIChatCatalogView,
  buildOpenAIModelCatalogPayload,
  normalizeAvailableOpenAIModels,
  probeOpenAIResponsesModel,
  refreshOpenAIModelCatalog,
  resolveChatModelSelection,
} = require('../lib/openai-model-catalog');

function createDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, model TEXT, created_at INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY, filename TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
      note_type TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
      codex_status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE codex_jobs (
      id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending',
      note_filenames_json TEXT NOT NULL, attempt_count INTEGER NOT NULL DEFAULT 0,
      error TEXT, created_at INTEGER NOT NULL DEFAULT 1, started_at INTEGER, finished_at INTEGER
    );
    CREATE TABLE auto_save_decisions (id INTEGER PRIMARY KEY, decision TEXT NOT NULL, action TEXT);
    CREATE TABLE note_chunks (
      id INTEGER PRIMARY KEY, chunk_id TEXT UNIQUE NOT NULL, note_filename TEXT NOT NULL,
      note_title TEXT NOT NULL, chunk_type TEXT NOT NULL, content TEXT NOT NULL,
      source_session TEXT, source_user_message INTEGER, source_assistant_message INTEGER,
      embedding TEXT, created_at INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE assistant_retrieval_shadow_runs (
      id INTEGER PRIMARY KEY, mode TEXT NOT NULL, notes_json TEXT NOT NULL,
      chunks_json TEXT NOT NULL, context_chars INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 1
    );
  `);
  runDatabaseMigrations(db);
  return db;
}

test('OpenAI catalog recognizes only stable Sol, Terra, and Luna model IDs', () => {
  assert.deepEqual(
    normalizeAvailableOpenAIModels([
      { id: 'gpt-5.6-terra', created: 2, owned_by: 'openai' },
      { id: 'gpt-5.7-terra', created: 3, owned_by: 'openai' },
      { id: 'gpt-5.6-sol-2026-07-01' },
      { id: 'gpt-5.6-terra-preview' },
      { id: 'text-embedding-3-small' },
      { id: 'gpt-5.6-luna' },
    ]).map(model => model.id),
    ['gpt-5.7-terra', 'gpt-5.6-luna', 'gpt-5.6-terra'],
  );
});

test('OpenAI catalog keeps a compatible older active model when a newer probe fails', async () => {
  const previousPayload = {
    models: [{
      id: 'gpt-5.6-terra',
      role: 'balanced',
      probeVersion: 1,
      probeStatus: 'compatible',
      probeErrorCode: null,
      probedAt: 10,
    }],
    active: { balanced: 'gpt-5.6-terra' },
  };
  const payload = await buildOpenAIModelCatalogPayload({
    models: [
      { id: 'gpt-5.7-terra' },
      { id: 'gpt-5.6-terra' },
    ],
    previousPayload,
    probeModel: async modelId => {
      assert.equal(modelId, 'gpt-5.7-terra');
      const error = new Error('rejected');
      error.code = 'unsupported';
      throw error;
    },
    now: () => 20,
  });

  assert.equal(payload.models.find(model => model.id === 'gpt-5.7-terra').probeStatus, 'rejected');
  assert.equal(payload.active.balanced, 'gpt-5.6-terra');
});

test('OpenAI catalog refresh preserves last-known-good after Models API failure', async () => {
  const db = createDatabase();
  const store = createModelCatalogStore(db, { now: () => 50 });
  const client = {
    models: {
      async list() {
        return {
          data: [{ id: 'gpt-5.6-terra' }],
        };
      },
    },
  };
  const first = await refreshOpenAIModelCatalog({
    store,
    client,
    probeModel: async () => ({ modelId: 'gpt-5.6-terra' }),
    now: () => 50,
  });
  assert.equal(first.payload.active.balanced, 'gpt-5.6-terra');

  client.models.list = async () => {
    const error = new Error('down');
    error.code = 'ETIMEDOUT';
    throw error;
  };
  await assert.rejects(
    refreshOpenAIModelCatalog({ store, client, now: () => 60 }),
    /down/,
  );
  const stale = store.get('openai_api');
  assert.equal(stale.payload.active.balanced, 'gpt-5.6-terra');
  assert.equal(stale.generation, 1);
  assert.equal(stale.lastErrorCode, 'ETIMEDOUT');
  db.close();
});

test('Responses compatibility probe preserves output items and exact call_id', async () => {
  const requests = [];
  const client = {
    responses: {
      async create(request) {
        requests.push(structuredClone(request));
        if (requests.length === 1) {
          return {
            status: 'completed',
            output: [{
              type: 'function_call',
              id: 'fc_1',
              call_id: 'call_exact',
              name: 'galpi_model_probe',
              arguments: '{"nonce":"galpi"}',
            }],
          };
        }
        return {
          status: 'completed',
          model: 'gpt-5.6-terra',
          output_text: '호환됨',
          output: [{
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '호환됨' }],
          }],
        };
      },
    },
  };

  const result = await probeOpenAIResponsesModel(client, 'gpt-5.6-terra');
  assert.equal(result.modelId, 'gpt-5.6-terra');
  assert.equal(requests[0].store, false);
  assert.equal(requests[0].reasoning.effort, 'none');
  assert.equal(requests[1].input[1].type, 'function_call');
  assert.equal(requests[1].input[2].type, 'function_call_output');
  assert.equal(requests[1].input[2].call_id, 'call_exact');
});

test('chat resolver auto-moves but exact selections must be compatible', () => {
  const catalogRow = {
    generation: 4,
    payload: {
      active: { balanced: 'gpt-5.7-terra' },
      models: [
        { id: 'gpt-5.7-terra', probeStatus: 'compatible' },
        { id: 'gpt-5.6-sol', probeStatus: 'compatible' },
      ],
    },
  };
  assert.deepEqual(
    resolveChatModelSelection({ selection: CHAT_SELECTION_AUTO, catalogRow }),
    {
      selection: CHAT_SELECTION_AUTO,
      modelId: 'gpt-5.7-terra',
      catalogGeneration: 4,
      runtimeGeneration: 'gpt-single-v1',
      reasoningEffort: 'medium',
    },
  );
  assert.equal(
    resolveChatModelSelection({ selection: 'gpt-5.6-sol', catalogRow }).modelId,
    'gpt-5.6-sol',
  );
  assert.throws(
    () => resolveChatModelSelection({ selection: 'gpt-5.5-terra', catalogRow }),
    error => error.code === 'MODEL_UNAVAILABLE',
  );
});

test('chat catalog reports bootstrap fallback before the first successful refresh', () => {
  const view = buildOpenAIChatCatalogView({
    catalogRow: {
      generation: 0,
      payload: null,
      lastAttemptAt: 100,
      lastSuccessAt: null,
      lastErrorCode: 'PROVIDER_TIMEOUT',
      lastErrorAt: 100,
    },
    setting: {
      value: CHAT_SELECTION_AUTO,
      version: 1,
    },
    bootstrapModel: 'gpt-5.6-terra',
    reasoningEffort: 'medium',
  });
  assert.equal(view.catalog.status, 'fallback');
  assert.equal(view.resolvedModelId, 'gpt-5.6-terra');
});
