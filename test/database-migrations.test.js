'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { sha256 } = require('../lib/content-hash');
const {
  LATEST_SCHEMA_VERSION,
  runDatabaseMigrations,
} = require('../lib/database-migrations');
const { createTopicChunkStore } = require('../lib/topic-chunk-store');

function createLegacyDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      note_type TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      codex_status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE auto_save_decisions (
      id INTEGER PRIMARY KEY,
      decision TEXT NOT NULL,
      action TEXT
    );
    CREATE TABLE note_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chunk_id TEXT UNIQUE NOT NULL,
      note_filename TEXT NOT NULL,
      note_title TEXT NOT NULL,
      chunk_type TEXT NOT NULL,
      content TEXT NOT NULL,
      source_session TEXT,
      source_user_message INTEGER,
      source_assistant_message INTEGER,
      embedding TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE assistant_retrieval_shadow_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      mode TEXT NOT NULL,
      notes_json TEXT NOT NULL,
      chunks_json TEXT NOT NULL,
      context_chars INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);
  return db;
}

test('database migrations upgrade a legacy DB sequentially and remain idempotent', () => {
  const db = createLegacyDatabase();
  db.prepare(`
    INSERT INTO notes (id, filename, title, note_type, archived)
    VALUES (1, 'topic.md', 'Topic', 'topic', 0)
  `).run();
  db.prepare(`
    INSERT INTO note_chunks (
      chunk_id, note_filename, note_title, chunk_type, content
    ) VALUES (?, ?, ?, ?, ?)
  `).run('qa-legacy', 'topic.md', 'Topic', 'topic_qa', 'Q: 질문  \r\nA: 답변');

  const first = runDatabaseMigrations(db);
  assert.equal(first.currentVersion, LATEST_SCHEMA_VERSION);
  assert.deepEqual(first.applied.map(item => item.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.deepEqual(
    db.prepare('SELECT version FROM schema_version ORDER BY version').all(),
    [
      { version: 1 }, { version: 2 }, { version: 3 }, { version: 4 },
      { version: 5 }, { version: 6 }, { version: 7 }, { version: 8 },
      { version: 9 }, { version: 10 }, { version: 11 }, { version: 12 },
      { version: 13 },
    ],
  );

  const chunk = db.prepare(`
    SELECT content_sha256 AS contentSha256, index_status AS indexStatus
    FROM note_chunks
    WHERE chunk_id = 'qa-legacy'
  `).get();
  assert.equal(chunk.contentSha256, sha256('Q: 질문\nA: 답변'));
  assert.equal(chunk.indexStatus, 'ready');
  assert.ok(
    db.prepare('PRAGMA table_info(assistant_retrieval_shadow_runs)')
      .all()
      .some(column => column.name === 'query_sha256'),
  );
  assert.deepEqual(
    db.prepare(`
      SELECT content_sha256 AS contentSha256, indexed_sha256 AS indexedSha256,
             index_status AS indexStatus, ai_readable AS aiReadable,
             owner_agent AS ownerAgent
      FROM notes
      WHERE filename = 'topic.md'
    `).get(),
    {
      contentSha256: null,
      indexedSha256: null,
      indexStatus: 'pending',
      aiReadable: 1,
      ownerAgent: null,
    },
  );
  assert.deepEqual(
    db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name IN ('app_settings', 'model_catalog_cache')
      ORDER BY name
    `).all(),
    [
      { name: 'app_settings' },
      { name: 'model_catalog_cache' },
    ],
  );
  assert.deepEqual(
    db.prepare('PRAGMA table_info(messages)').all()
      .filter(column => [
        'model_selection',
        'model_catalog_generation',
        'runtime_generation',
        'reasoning_effort',
      ].includes(column.name))
      .map(column => column.name),
    [
      'model_selection',
      'model_catalog_generation',
      'runtime_generation',
      'reasoning_effort',
    ],
  );
  assert.deepEqual(
    db.prepare('PRAGMA table_info(codex_jobs)').all()
      .filter(column => [
        'model_selection',
        'model_id',
        'model_catalog_generation',
      ].includes(column.name))
      .map(column => column.name),
    [
      'model_selection',
      'model_id',
      'model_catalog_generation',
    ],
  );
  assert.deepEqual(
    db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name IN (
        'assistant_tasks', 'assistant_task_events', 'assistant_reminders',
        'assistant_push_subscriptions', 'assistant_push_deliveries',
        'assistant_schedule_note_projections', 'assistant_shortcut_credentials',
        'voice_shortcut_receipts'
      )
      ORDER BY name
    `).all(),
    [
      { name: 'assistant_push_deliveries' },
      { name: 'assistant_push_subscriptions' },
      { name: 'assistant_reminders' },
      { name: 'assistant_schedule_note_projections' },
      { name: 'assistant_shortcut_credentials' },
      { name: 'assistant_task_events' },
      { name: 'assistant_tasks' },
      { name: 'voice_shortcut_receipts' },
    ],
  );

  const second = runDatabaseMigrations(db);
  assert.deepEqual(second, { currentVersion: LATEST_SCHEMA_VERSION, applied: [] });
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM schema_version').get().count,
    LATEST_SCHEMA_VERSION,
  );
  db.close();
});

test('schema v10 enforces one receipt per realtime turn and one per final response', () => {
  const db = createLegacyDatabase();
  runDatabaseMigrations(db);

  const insert = db.prepare(`
    INSERT INTO realtime_turn_receipts (session_id, input_item_id, final_response_id)
    VALUES (?, ?, ?)
  `);
  insert.run('voice-1', 'item_1', 'resp_1');
  insert.run('voice-1', 'item_2', null);
  // 같은 session의 다른 턴은 허용하되 같은 턴의 중복 receipt는 막는다.
  assert.throws(() => insert.run('voice-1', 'item_1', null), /UNIQUE/);
  // 값이 있을 때만 response ID가 유일해야 하므로 NULL은 여러 개 들어간다.
  insert.run('voice-2', 'item_1', null);
  assert.throws(() => insert.run('voice-2', 'item_9', 'resp_1'), /UNIQUE/);

  const setStatus = db.prepare(
    'UPDATE realtime_turn_receipts SET status = ? WHERE session_id = ? AND input_item_id = ?',
  );
  assert.throws(() => setStatus.run('bogus', 'voice-1', 'item_1'), /CHECK/);
  setStatus.run('finalized', 'voice-1', 'item_1');

  const receipt = db.prepare(
    'SELECT status FROM realtime_turn_receipts WHERE session_id = ? AND input_item_id = ?',
  ).get('voice-1', 'item_2');
  assert.equal(receipt.status, 'correction_pending');
  db.close();
});

test('schema v11 scopes shortcut credentials and request receipts', () => {
  const db = createLegacyDatabase();
  runDatabaseMigrations(db);
  const subscriptionId = db.prepare(`
    INSERT INTO assistant_push_subscriptions (endpoint, p256dh, auth, status)
    VALUES ('https://web.push.apple.com/device', 'p256dh', 'auth', 'active')
  `).run().lastInsertRowid;
  const credentialId = db.prepare(`
    INSERT INTO assistant_shortcut_credentials (
      subscription_id, token_sha256, token_prefix, status
    ) VALUES (?, ?, 'prefix12', 'active')
  `).run(subscriptionId, 'a'.repeat(64)).lastInsertRowid;
  db.prepare(`
    INSERT INTO voice_shortcut_receipts (
      credential_id, request_id, request_sha256, conversation_id
    ) VALUES (?, '00000000-0000-4000-8000-000000000001', ?, ?)
  `).run(credentialId, 'b'.repeat(64), 'c'.repeat(22));

  assert.throws(() => db.prepare(`
    INSERT INTO assistant_shortcut_credentials (
      subscription_id, token_sha256, token_prefix, status
    ) VALUES (?, ?, 'other123', 'active')
  `).run(subscriptionId, 'c'.repeat(64)), /UNIQUE/);
  assert.throws(() => db.prepare(`
    UPDATE voice_shortcut_receipts SET status = 'completed'
  `).run(), /CHECK/);
  assert.throws(() => db.prepare(`
    INSERT INTO voice_shortcut_receipts (
      credential_id, request_id, request_sha256, conversation_id
    ) VALUES (?, '00000000-0000-4000-8000-000000000001', ?, ?)
  `).run(credentialId, 'b'.repeat(64), 'd'.repeat(22)), /UNIQUE/);
  db.close();
});

test('schema v12 stores temporary attachment blobs separately from user uploads', () => {
  const db = createLegacyDatabase();
  runDatabaseMigrations(db);
  const blobId = db.prepare(`
    INSERT INTO attachment_blobs (
      sha256, stored_name, stored_path, mime_type, size_bytes
    ) VALUES (?, 'att_test.txt', '/data/attachments/tmp/att_test.txt', 'text/plain', 4)
  `).run('a'.repeat(64)).lastInsertRowid;
  db.prepare(`
    INSERT INTO attachments (id, blob_id, original_name, kind)
    VALUES ('att_0123456789abcdef0123456789abcdef', ?, 'note.txt', 'text')
  `).run(blobId);

  assert.deepEqual(db.prepare(`
    SELECT a.lifecycle_status AS lifecycleStatus, a.scope,
           b.storage_scope AS storageScope, b.status
    FROM attachments a
    JOIN attachment_blobs b ON b.id = a.blob_id
  `).get(), {
    lifecycleStatus: 'uploaded_unattached',
    scope: 'temporary',
    storageScope: 'temporary',
    status: 'ready',
  });
  assert.throws(() => db.prepare(`
    UPDATE attachments SET lifecycle_status = 'unknown'
  `).run(), /CHECK/);
  assert.throws(() => db.prepare(`
    INSERT INTO attachment_blobs (
      sha256, stored_name, stored_path, mime_type, size_bytes
    ) VALUES (?, 'att_empty.txt', '/data/attachments/tmp/att_empty.txt', 'text/plain', 0)
  `).run('b'.repeat(64)), /CHECK/);
  db.close();
});

test('schema v13 links attachments to one replay-snapshotted user message', () => {
  const db = createLegacyDatabase();
  runDatabaseMigrations(db);
  const messageId = db.prepare(`
    INSERT INTO messages (session_id, role, content, created_at)
    VALUES ('attachment-session', 'user', '첨부 질문', 1)
  `).run().lastInsertRowid;
  const blobId = db.prepare(`
    INSERT INTO attachment_blobs (
      sha256, stored_name, stored_path, mime_type, size_bytes
    ) VALUES (?, 'att_link.txt', '/data/attachments/tmp/att_link.txt', 'text/plain', 4)
  `).run('c'.repeat(64)).lastInsertRowid;
  db.prepare(`
    INSERT INTO attachments (id, blob_id, original_name, kind)
    VALUES ('att_abcdef0123456789abcdef0123456789', ?, 'link.txt', 'text')
  `).run(blobId);
  db.prepare(`
    INSERT INTO message_attachments (
      message_id, attachment_id, position, origin_user_turn_index, replay_window_turns
    ) VALUES (?, 'att_abcdef0123456789abcdef0123456789', 0, 1, 10)
  `).run(messageId);

  assert.deepEqual(db.prepare(`
    SELECT origin_user_turn_index AS originTurn, replay_window_turns AS replayTurns
    FROM message_attachments
  `).get(), { originTurn: 1, replayTurns: 10 });
  assert.throws(() => db.prepare(`
    UPDATE message_attachments SET replay_window_turns = 0
  `).run(), /CHECK/);
  db.close();
});

test('topic chunk store hashes new content, excludes source_missing, and restores ready on upsert', () => {
  const db = createLegacyDatabase();
  runDatabaseMigrations(db);
  const store = createTopicChunkStore(db);
  db.prepare(`
    INSERT INTO notes (id, filename, title, note_type, archived)
    VALUES (1, 'topic.md', 'Topic', 'topic', 0)
  `).run();

  store.upsert({
    chunkId: 'qa-current',
    noteFilename: 'topic.md',
    noteTitle: 'Topic',
    chunkType: 'topic_qa',
    content: 'Q: 첫 질문\nA: 첫 답변',
    sourceSession: 'session-1',
    sourceUserMessage: 1,
    sourceAssistantMessage: 2,
  });
  let chunk = db.prepare(`
    SELECT content_sha256 AS contentSha256, index_status AS indexStatus
    FROM note_chunks
    WHERE chunk_id = 'qa-current'
  `).get();
  assert.equal(chunk.contentSha256, sha256('Q: 첫 질문\nA: 첫 답변'));
  assert.equal(chunk.indexStatus, 'ready');
  assert.deepEqual(store.listReadyByNote('topic.md').map(item => item.chunkId), ['qa-current']);
  db.prepare("UPDATE notes SET title = 'Current Topic' WHERE filename = 'topic.md'").run();
  assert.deepEqual(
    store.listReadyByNote('topic.md').map(item => ({ chunkId: item.chunkId, noteTitle: item.noteTitle })),
    [{ chunkId: 'qa-current', noteTitle: 'Current Topic' }],
  );
  assert.deepEqual(
    store.listAllReady().map(item => ({ chunkId: item.chunkId, noteTitle: item.noteTitle })),
    [{ chunkId: 'qa-current', noteTitle: 'Current Topic' }],
  );

  db.prepare("UPDATE notes SET codex_status = 'running' WHERE filename = 'topic.md'").run();
  assert.deepEqual(store.listReadyByNote('topic.md'), []);
  assert.deepEqual(store.listAllReady(), []);
  db.prepare("UPDATE notes SET codex_status = 'recovery_required' WHERE filename = 'topic.md'").run();
  assert.equal(store.updateEmbedding('qa-current', '[9,9]').changes, 0);
  assert.equal(
    db.prepare("SELECT embedding FROM note_chunks WHERE chunk_id = 'qa-current'").get().embedding,
    null,
  );
  assert.deepEqual(store.listReadyByNote('topic.md'), []);
  assert.deepEqual(store.listAllReady(), []);
  db.prepare("UPDATE notes SET codex_status = 'pending' WHERE filename = 'topic.md'").run();

  db.prepare("UPDATE notes SET archived = 1 WHERE filename = 'topic.md'").run();
  assert.deepEqual(store.listReadyByNote('topic.md'), []);
  assert.deepEqual(store.listAllReady(), []);
  db.prepare("UPDATE notes SET archived = 0 WHERE filename = 'topic.md'").run();

  db.prepare("UPDATE notes SET ai_readable = 0 WHERE filename = 'topic.md'").run();
  assert.equal(store.updateEmbedding('qa-current', '[9,9]').changes, 0);
  assert.deepEqual(store.listReadyByNote('topic.md'), []);
  assert.deepEqual(store.listAllReady(), []);
  db.prepare("UPDATE notes SET ai_readable = 1 WHERE filename = 'topic.md'").run();

  store.updateEmbedding('qa-current', '[1,0]');
  db.prepare(`
    UPDATE note_chunks
    SET index_status = 'source_missing'
    WHERE chunk_id = 'qa-current'
  `).run();
  assert.deepEqual(store.listReadyByNote('topic.md'), []);
  assert.deepEqual(store.listAllReady(), []);

  store.upsert({
    chunkId: 'qa-current',
    noteFilename: 'topic.md',
    noteTitle: 'Topic',
    chunkType: 'topic_qa',
    content: 'Q: 첫 질문\nA: 첫 답변',
  });
  assert.deepEqual(
    db.prepare(`
      SELECT index_status AS indexStatus, embedding
      FROM note_chunks
      WHERE chunk_id = 'qa-current'
    `).get(),
    { indexStatus: 'ready', embedding: '[1,0]' },
  );
  db.prepare(`
    UPDATE note_chunks
    SET index_status = 'source_missing'
    WHERE chunk_id = 'qa-current'
  `).run();

  store.upsert({
    chunkId: 'qa-current',
    noteFilename: 'topic.md',
    noteTitle: 'Topic Updated',
    chunkType: 'topic_qa',
    content: 'Q: 새 질문\nA: 새 답변',
  });
  chunk = db.prepare(`
    SELECT note_title AS noteTitle, content_sha256 AS contentSha256,
           index_status AS indexStatus, embedding
    FROM note_chunks
    WHERE chunk_id = 'qa-current'
  `).get();
  assert.deepEqual(chunk, {
    noteTitle: 'Topic Updated',
    contentSha256: sha256('Q: 새 질문\nA: 새 답변'),
    indexStatus: 'ready',
    embedding: null,
  });
  db.close();
});
