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
      archived INTEGER NOT NULL DEFAULT 0
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
  `);
  return db;
}

test('database migrations upgrade a legacy DB sequentially and remain idempotent', () => {
  const db = createLegacyDatabase();
  db.prepare(`
    INSERT INTO note_chunks (
      chunk_id, note_filename, note_title, chunk_type, content
    ) VALUES (?, ?, ?, ?, ?)
  `).run('qa-legacy', 'topic.md', 'Topic', 'topic_qa', 'Q: 질문  \r\nA: 답변');

  const first = runDatabaseMigrations(db);
  assert.equal(first.currentVersion, LATEST_SCHEMA_VERSION);
  assert.deepEqual(first.applied.map(item => item.version), [1, 2]);
  assert.deepEqual(
    db.prepare('SELECT version FROM schema_version ORDER BY version').all(),
    [{ version: 1 }, { version: 2 }],
  );

  const chunk = db.prepare(`
    SELECT content_sha256 AS contentSha256, index_status AS indexStatus
    FROM note_chunks
    WHERE chunk_id = 'qa-legacy'
  `).get();
  assert.equal(chunk.contentSha256, sha256('Q: 질문\nA: 답변'));
  assert.equal(chunk.indexStatus, 'ready');

  const second = runDatabaseMigrations(db);
  assert.deepEqual(second, { currentVersion: LATEST_SCHEMA_VERSION, applied: [] });
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM schema_version').get().count,
    LATEST_SCHEMA_VERSION,
  );
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

  db.prepare("UPDATE notes SET archived = 1 WHERE filename = 'topic.md'").run();
  assert.deepEqual(store.listReadyByNote('topic.md'), []);
  db.prepare("UPDATE notes SET archived = 0 WHERE filename = 'topic.md'").run();

  store.updateEmbedding('qa-current', '[1,0]');
  db.prepare(`
    UPDATE note_chunks
    SET index_status = 'source_missing'
    WHERE chunk_id = 'qa-current'
  `).run();
  assert.deepEqual(store.listReadyByNote('topic.md'), []);

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
