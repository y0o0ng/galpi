'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const { createModelSettingsStore } = require('../lib/model-settings');
const { createModelCatalogStore } = require('../lib/model-catalog-store');

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
      source_session TEXT,
      source_user_message INTEGER,
      source_assistant_message INTEGER,
      embedding TEXT,
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

test('model settings seed once and reject stale optimistic updates', () => {
  const db = createDatabase();
  let clock = 100;
  const store = createModelSettingsStore(db, { now: () => clock });

  assert.deepEqual(store.ensureDefaults({
    'chat.model_selection': 'auto:balanced',
    'codex.general_model': 'gpt-5.6-terra',
    'codex.deep_model': 'gpt-5.5',
  }), [
    'chat.model_selection',
    'codex.general_model',
    'codex.deep_model',
  ]);
  assert.deepEqual(store.ensureDefaults({
    'chat.model_selection': 'gpt-5.6-sol',
  }), []);
  assert.deepEqual(store.get('chat.model_selection'), {
    key: 'chat.model_selection',
    value: 'auto:balanced',
    version: 1,
    updatedAt: 100,
  });

  clock = 101;
  assert.deepEqual(store.update('chat.model_selection', 'gpt-5.6-sol', 1), {
    key: 'chat.model_selection',
    value: 'gpt-5.6-sol',
    version: 2,
    updatedAt: 101,
  });
  assert.throws(
    () => store.update('chat.model_selection', 'gpt-5.6-luna', 1),
    error => error.code === 'SETTING_VERSION_CONFLICT' && error.current.version === 2,
  );
  assert.throws(
    () => store.get('unknown.setting'),
    error => error.code === 'INVALID_SETTING_KEY',
  );
  db.close();
});

test('model settings updateMany is atomic', () => {
  const db = createDatabase();
  const store = createModelSettingsStore(db);
  store.ensureDefaults({
    'codex.general_model': 'gpt-5.6-terra',
    'codex.deep_model': 'gpt-5.5',
  });
  store.update('codex.deep_model', 'gpt-5.6-sol', 1);

  assert.throws(
    () => store.updateMany([
      { key: 'codex.general_model', value: 'gpt-5.6-luna', expectedVersion: 1 },
      { key: 'codex.deep_model', value: 'gpt-5.5', expectedVersion: 1 },
    ]),
    error => error.code === 'SETTING_VERSION_CONFLICT',
  );
  assert.equal(store.get('codex.general_model').value, 'gpt-5.6-terra');
  assert.equal(store.get('codex.general_model').version, 1);
  db.close();
});

test('model catalog failures preserve the last-known-good payload', () => {
  const db = createDatabase();
  let clock = 200;
  const store = createModelCatalogStore(db, { now: () => clock });

  store.recordAttempt('openai_api');
  const first = store.saveSuccess('openai_api', {
    models: [{ id: 'gpt-5.6-terra' }],
    active: { balanced: 'gpt-5.6-terra' },
  });
  assert.equal(first.generation, 1);
  assert.equal(first.lastSuccessAt, 200);

  clock = 300;
  const failed = store.saveFailure('openai_api', { code: 'provider timeout' });
  assert.equal(failed.generation, 1);
  assert.equal(failed.payload.active.balanced, 'gpt-5.6-terra');
  assert.equal(failed.lastSuccessAt, 200);
  assert.equal(failed.lastErrorAt, 300);
  assert.equal(failed.lastErrorCode, 'PROVIDER_TIMEOUT');
  db.close();
});
