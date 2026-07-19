'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const {
  buildSemanticEmbeddingText,
  createNoteIndexStateStore,
  deriveNoteIndexState,
  noteContentSha256,
} = require('../lib/note-index-state');

function topicNote(answer, summary = '요약') {
  return `---
title: "토픽"
note_type: topic
archived: false
---

# 토픽

<!-- CODEX-SUMMARY-START -->
${summary}
<!-- CODEX-SUMMARY-END -->

<!-- QA-LOG-START -->

### 2026-07-18 10:00 · Claude
<!-- qa_id: qa-a111 -->
**Q:** 질문

**A:** ${answer}

<!-- QA-LOG-END -->`;
}

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, model TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      note_type TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      codex_status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE auto_save_decisions (
      id INTEGER PRIMARY KEY, decision TEXT NOT NULL, action TEXT
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
      mode TEXT NOT NULL, notes_json TEXT NOT NULL, chunks_json TEXT NOT NULL,
      context_chars INTEGER NOT NULL DEFAULT 0, latency_ms INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);
  runDatabaseMigrations(db);
  db.prepare(`
    INSERT INTO notes (filename, title, note_type, content_sha256, index_status)
    VALUES ('topic.md', '토픽', 'topic', ?, 'pending')
  `).run(noteContentSha256({ filename: 'topic.md', title: '토픽', noteType: 'topic', raw: topicNote('답변') }));
  return db;
}

test('topic hash follows normalized QA-LOG while semantic note hash ignores generated tag blocks', () => {
  const first = topicNote('답변', '첫 요약');
  const second = topicNote('답변', '바뀐 요약');
  const changed = topicNote('새 답변', '바뀐 요약');
  assert.equal(
    noteContentSha256({ filename: 'topic.md', title: '토픽', noteType: 'topic', raw: first }),
    noteContentSha256({ filename: 'topic.md', title: '토픽', noteType: 'topic', raw: second }),
  );
  assert.notEqual(
    noteContentSha256({ filename: 'topic.md', title: '토픽', noteType: 'topic', raw: first }),
    noteContentSha256({ filename: 'topic.md', title: '토픽', noteType: 'topic', raw: changed }),
  );

  const note = `---\ntitle: "일반"\nnote_type: highlight\n---\n본문\n<!-- CODEX-TAGS-START -->\n#태그\n<!-- CODEX-TAGS-END -->`;
  const retagged = note.replace('#태그', '#새태그');
  assert.equal(buildSemanticEmbeddingText('일반', note), buildSemanticEmbeddingText('일반', retagged));
  assert.equal(
    noteContentSha256({ title: '일반', noteType: 'highlight', raw: note }),
    noteContentSha256({ title: '일반', noteType: 'highlight', raw: retagged }),
  );
});

test('malformed topics derive an error state without inventing a content hash', () => {
  const derived = deriveNoteIndexState({
    filename: 'broken.md',
    title: '깨짐',
    noteType: 'topic',
    raw: '---\ntitle: 깨짐\nnote_type: topic\n---\nQA marker 없음',
  });
  assert.equal(derived.contentSha256, null);
  assert.equal(derived.indexStatus, 'error');
  assert.match(derived.error.message, /QA-LOG hash/);
});

test('note index state rejects stale async completion and records missing sources without deletion', () => {
  const db = createDb();
  const store = createNoteIndexStateStore(db);
  const firstHash = store.get('topic.md').contentSha256;

  assert.equal(store.markReady({
    filename: 'topic.md',
    contentSha256: firstHash,
    embedding: '[1,0]',
  }).changes, 1);
  assert.deepEqual(store.get('topic.md'), {
    filename: 'topic.md',
    contentSha256: firstHash,
    indexedSha256: firstHash,
    indexStatus: 'ready',
    embedding: '[1,0]',
  });

  const nextHash = noteContentSha256({
    filename: 'topic.md', title: '토픽', noteType: 'topic', raw: topicNote('새 답변'),
  });
  store.markContent({ filename: 'topic.md', contentSha256: nextHash });
  assert.equal(store.get('topic.md').indexStatus, 'pending');
  assert.equal(store.markReady({
    filename: 'topic.md', contentSha256: firstHash, embedding: '[0,1]',
  }).changes, 0);
  assert.equal(store.markError({ filename: 'topic.md', contentSha256: firstHash }).changes, 0);
  assert.equal(store.markError({ filename: 'topic.md', contentSha256: nextHash }).changes, 1);
  assert.equal(store.get('topic.md').indexStatus, 'error');

  db.prepare("UPDATE notes SET ai_readable = 0 WHERE filename = 'topic.md'").run();
  assert.equal(store.markReady({
    filename: 'topic.md', contentSha256: nextHash, embedding: '[0.5,0.5]',
  }).changes, 0);
  db.prepare("UPDATE notes SET ai_readable = 1 WHERE filename = 'topic.md'").run();

  db.prepare("UPDATE notes SET codex_status = 'recovery_required' WHERE filename = 'topic.md'").run();
  const quarantinedState = store.get('topic.md');
  const quarantinedHash = noteContentSha256({
    filename: 'topic.md', title: '토픽', noteType: 'topic', raw: topicNote('복구 전 변경'),
  });
  assert.equal(store.markContent({ filename: 'topic.md', contentSha256: quarantinedHash }).changes, 0);
  assert.equal(store.markReady({
    filename: 'topic.md', contentSha256: nextHash, embedding: '[0.5,0.5]',
  }).changes, 0);
  assert.equal(store.markError({ filename: 'topic.md', contentSha256: nextHash }).changes, 0);
  assert.deepEqual(store.get('topic.md'), quarantinedState);

  assert.equal(store.markMissing('topic.md').changes, 1);
  assert.equal(store.get('topic.md').indexStatus, 'missing');
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM notes WHERE filename='topic.md'").get().count, 1);
  db.close();
});
