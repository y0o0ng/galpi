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
  assert.deepEqual(first.applied.map(item => item.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  assert.deepEqual(
    db.prepare('SELECT version FROM schema_version ORDER BY version').all(),
    [
      { version: 1 }, { version: 2 }, { version: 3 }, { version: 4 },
      { version: 5 }, { version: 6 }, { version: 7 }, { version: 8 },
      { version: 9 }, { version: 10 }, { version: 11 }, { version: 12 },
      { version: 13 }, { version: 14 }, { version: 15 }, { version: 16 },
      { version: 17 }, { version: 18 }, { version: 19 },
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

test('schema v14 stores one bounded parsed document and ordered chunks per attachment', () => {
  const db = createLegacyDatabase();
  runDatabaseMigrations(db);
  const blobId = db.prepare(`
    INSERT INTO attachment_blobs (
      sha256, stored_name, stored_path, mime_type, size_bytes
    ) VALUES (?, 'att_doc.md', '/data/attachments/tmp/att_doc.md', 'text/markdown', 12)
  `).run('d'.repeat(64)).lastInsertRowid;
  const attachmentId = 'att_1234567890abcdef1234567890abcdef';
  db.prepare(`
    INSERT INTO attachments (id, blob_id, original_name, kind)
    VALUES (?, ?, '문서.md', 'markdown')
  `).run(attachmentId, blobId);
  db.prepare(`
    INSERT INTO attachment_documents (
      attachment_id, content_sha256, parser_version, parse_status,
      line_count, char_count, chunk_count, parsed_at
    ) VALUES (?, ?, 'attachment-document-v1:test', 'ready', 2, 12, 1, 1)
  `).run(attachmentId, 'd'.repeat(64));
  db.prepare(`
    INSERT INTO attachment_chunks (
      chunk_id, attachment_id, chunk_index, heading,
      line_start, line_end, content, content_sha256
    ) VALUES ('atch_1234567890abcdef1234567890abcdef', ?, 0, '제목', 2, 2, '본문', ?)
  `).run(attachmentId, 'e'.repeat(64));

  assert.deepEqual(db.prepare(`
    SELECT parse_status AS status, line_count AS lineCount,
           char_count AS charCount, chunk_count AS chunkCount
    FROM attachment_documents
  `).get(), { status: 'ready', lineCount: 2, charCount: 12, chunkCount: 1 });
  assert.throws(() => db.prepare(`
    UPDATE attachment_documents SET parse_status = 'ready', chunk_count = 0
  `).run(), /CHECK/);
  assert.throws(() => db.prepare(`
    UPDATE attachment_chunks SET chunk_index = -1
  `).run(), /CHECK/);
  db.close();
});

test('schema v15 links one promoted attachment to one Attachment note', () => {
  const db = createLegacyDatabase();
  runDatabaseMigrations(db);
  const blobId = db.prepare(`
    INSERT INTO attachment_blobs (
      sha256, stored_name, stored_path, mime_type, size_bytes, storage_scope
    ) VALUES (?, 'library.txt', '/vault/_attachments/library.txt', 'text/plain', 4, 'library')
  `).run('f'.repeat(64)).lastInsertRowid;
  const attachmentId = 'att_abcdefabcdefabcdefabcdefabcdefab';
  db.prepare(`
    INSERT INTO attachments (
      id, blob_id, original_name, kind, session_id, scope, lifecycle_status
    ) VALUES (?, ?, '자료.txt', 'text', 'shared-main', 'library', 'library')
  `).run(attachmentId, blobId);
  db.prepare(`
    INSERT INTO notes (id, filename, title, note_type, archived)
    VALUES (1, 'attachment.md', '자료', 'attachment', 0)
  `).run();
  db.prepare(`
    INSERT INTO attachment_library_items (attachment_id, note_filename)
    VALUES (?, 'attachment.md')
  `).run(attachmentId);

  assert.deepEqual(db.prepare(`
    SELECT attachment_id AS attachmentId, note_filename AS noteFilename
    FROM attachment_library_items
  `).get(), { attachmentId, noteFilename: 'attachment.md' });
  assert.throws(() => db.prepare(`
    INSERT INTO attachment_library_items (attachment_id, note_filename)
    VALUES ('att_11111111111111111111111111111111', 'attachment.md')
  `).run(), /FOREIGN KEY|UNIQUE/);
  db.close();
});

test('schema v17 holds a recurrence master and links occurrences to plain task rows', () => {
  const db = createLegacyDatabase();
  runDatabaseMigrations(db);
  const insertSeries = db.prepare(`
    INSERT INTO assistant_task_series (
      client_request_id, create_payload_sha256, title,
      freq, by_weekday, by_monthday, start_date, time_kind, time_of_day
    ) VALUES (?, ?, ?, ?, ?, ?, '2026-08-10', ?, ?)
  `);
  const seriesId = insertSeries.run(
    'series-req-1', 'a'.repeat(64), '운동', 'weekly', '1,3,5', null, 'datetime', '19:30:00'
  ).lastInsertRowid;

  // 규칙마다 쓰는 필드가 다르다. 섞어 쓰면 적재가 거부된다.
  assert.throws(() => insertSeries.run(
    'series-req-2', 'b'.repeat(64), '잘못', 'weekly', null, 15, 'date', null
  ), /CHECK/);
  assert.throws(() => insertSeries.run(
    'series-req-3', 'c'.repeat(64), '잘못', 'monthly', '1,3', 15, 'date', null
  ), /CHECK/);
  assert.throws(() => insertSeries.run(
    'series-req-4', 'd'.repeat(64), '잘못', 'daily', null, null, 'datetime', null
  ), /CHECK/);
  assert.throws(() => insertSeries.run(
    'series-req-5', '0'.repeat(64), '잘못', 'monthly', null, null, 'date', null
  ), /CHECK/);

  const insertTask = db.prepare(`
    INSERT INTO assistant_tasks (
      client_request_id, create_payload_sha256, title,
      due_kind, due_at, series_id, occurrence_date
    ) VALUES (?, ?, '운동', 'datetime', 1786000000, ?, ?)
  `);
  insertTask.run(`series:${seriesId}:2026-08-10`, 'e'.repeat(64), seriesId, '2026-08-10');

  // 회차는 (series_id, occurrence_date)가 UNIQUE라 materializer가 몇 번 돌아도 늘지 않는다.
  assert.throws(() => insertTask.run(
    `series:${seriesId}:2026-08-10-dup`, 'f'.repeat(64), seriesId, '2026-08-10'
  ), /UNIQUE/);

  assert.deepEqual(db.prepare(`
    SELECT series_id AS seriesId, occurrence_date AS occurrenceDate, overridden
    FROM assistant_tasks WHERE series_id IS NOT NULL
  `).all(), [{ seriesId: Number(seriesId), occurrenceDate: '2026-08-10', overridden: 0 }]);

  // 단발 일정은 세 열이 비어 있고 부분 UNIQUE 인덱스가 걸리지 않는다.
  const insertSingle = db.prepare(`
    INSERT INTO assistant_tasks (client_request_id, create_payload_sha256, title)
    VALUES (?, ?, '단발')
  `);
  insertSingle.run('single-1', '1'.repeat(64));
  insertSingle.run('single-2', '2'.repeat(64));
  assert.deepEqual(db.prepare(`
    SELECT COUNT(*) AS count FROM assistant_tasks
    WHERE series_id IS NULL AND occurrence_date IS NULL AND overridden = 0
  `).get(), { count: 2 });

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

test('schema v19 makes identity the only dedup key and keeps locators separate', () => {
  const db = createLegacyDatabase();
  runDatabaseMigrations(db);

  const accountId = db.prepare(`
    INSERT INTO mail_accounts (provider, address) VALUES ('naver', 'me@naver.com')
  `).run().lastInsertRowid;

  // 켜짐/꺼짐의 정본은 status 하나다. enabled 열이 따로 생기면 안 된다.
  const accountColumns = db.prepare('PRAGMA table_info(mail_accounts)').all().map(c => c.name);
  assert.equal(accountColumns.includes('enabled'), false);

  const insertMessage = db.prepare(`
    INSERT INTO mail_messages (
      account_id, identity_kind, identity_key,
      imap_uid_validity, imap_uid, received_at
    ) VALUES (?, ?, ?, ?, ?, 1786949400)
  `);
  insertMessage.run(accountId, 'rfc_message_id', '<a@example.com>', '0', 101);

  // 같은 메일을 다시 만나면 UID가 달라도 identity로 막힌다. 네이버는 UIDVALIDITY가
  // 늘 '0'이라 재번호를 감지할 수 없으므로 이 제약이 유일한 방어선이다.
  assert.throws(
    () => insertMessage.run(accountId, 'rfc_message_id', '<a@example.com>', '0', 55001),
    /UNIQUE/,
  );

  // 반대로 UID가 같아도 identity가 다르면 별개 메일이다. UID는 dedup 키가 아니다.
  insertMessage.run(accountId, 'fingerprint', 'f'.repeat(64), '0', 101);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mail_messages').get().n, 2);

  const messageColumns = db.prepare('PRAGMA table_info(mail_messages)').all().map(c => c.name);

  // 기한은 종류마다 채우는 열이 다르다. 날짜만 있는데 시각을 만들어내면 거부된다.
  // provider 열이 없다. 계정이 이미 정하고 있어서 여기에 또 두면 네이버 계정에
  // gmail 메시지가 들어간 행을 DB가 막을 수 없다.
  assert.equal(messageColumns.includes('provider'), false);

  const insertDeadline = db.prepare(`
    INSERT INTO mail_messages (
      account_id, identity_kind, identity_key, received_at,
      deadline_kind, deadline_date, deadline_at
    ) VALUES (?, 'gmail_message', ?, 1786949400, ?, ?, ?)
  `);
  insertDeadline.run(accountId, 'g1', 'date', '2026-08-19', null);
  assert.throws(() => insertDeadline.run(accountId, 'g2', 'date', '2026-08-19', 1786949400), /CHECK/);
  assert.throws(() => insertDeadline.run(accountId, 'g3', 'none', '2026-08-19', null), /CHECK/);
  assert.throws(() => insertDeadline.run(accountId, 'g4', 'datetime', '2026-08-19', 1786949400), /CHECK/);

  // analyzing인데 lease가 없으면 회수할 수 없는 좌초 행이 된다. 그 조합을 막는다.
  const messageId = db.prepare('SELECT id FROM mail_messages LIMIT 1').get().id;
  assert.throws(
    () => db.prepare('UPDATE mail_messages SET analysis_state = ? WHERE id = ?').run('analyzing', messageId),
    /CHECK/,
  );
  db.prepare(`
    UPDATE mail_messages SET analysis_state = 'analyzing', analysis_lease_until = 1786949460 WHERE id = ?
  `).run(messageId);

  // 메시지 행에는 전달 상태 열이 없다. 기기별 상태는 mail_push_deliveries가 든다.
  assert.equal(messageColumns.includes('push_status'), false);
  assert.equal(messageColumns.includes('next_push_attempt_at'), false);

  // snooze 재알림은 notify_seq로 갈린다. 같은 회차만 중복이 막힌다.
  const subscriptionId = db.prepare(`
    INSERT INTO assistant_push_subscriptions (endpoint, p256dh, auth)
    VALUES ('https://web.push.apple.com/x', 'p', 'a')
  `).run().lastInsertRowid;
  const insertDelivery = db.prepare(`
    INSERT INTO mail_push_deliveries (
      target_kind, target_id, notify_seq, subscription_id, next_attempt_at, expires_at
    ) VALUES ('attention', 1, ?, ?, 1786949400, 1787035800)
  `);
  insertDelivery.run(1, subscriptionId);
  assert.throws(() => insertDelivery.run(1, subscriptionId), /UNIQUE/);
  insertDelivery.run(2, subscriptionId);

  db.close();
});
