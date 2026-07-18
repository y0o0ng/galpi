'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const { auditNoteIndex, formatNoteIndexAudit } = require('../lib/note-index-audit');
const { createNoteIndexStateStore, noteContentSha256 } = require('../lib/note-index-state');

async function createFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'note-index-audit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const vaultPath = path.join(root, 'vault');
  await fs.mkdir(vaultPath);
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, model TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE notes (id INTEGER PRIMARY KEY, filename TEXT UNIQUE NOT NULL, title TEXT NOT NULL, note_type TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE auto_save_decisions (id INTEGER PRIMARY KEY, decision TEXT NOT NULL, action TEXT);
    CREATE TABLE note_chunks (id INTEGER PRIMARY KEY, chunk_id TEXT UNIQUE NOT NULL, note_filename TEXT NOT NULL, note_title TEXT NOT NULL, chunk_type TEXT NOT NULL, content TEXT NOT NULL, source_session TEXT, source_user_message INTEGER, source_assistant_message INTEGER, embedding TEXT, created_at INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE assistant_retrieval_shadow_runs (id INTEGER PRIMARY KEY, mode TEXT NOT NULL, notes_json TEXT NOT NULL, chunks_json TEXT NOT NULL, context_chars INTEGER NOT NULL DEFAULT 0, latency_ms INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 1);
  `);
  runDatabaseMigrations(db);
  return { db, vaultPath };
}

test('note index audit is readonly, verifies ready hashes, and reports file drift without content', async t => {
  const { db, vaultPath } = await createFixture(t);
  const raw = '---\ntitle: "메모"\nnote_type: highlight\narchived: false\n---\n\n# 메모\n\n본문';
  await fs.writeFile(path.join(vaultPath, 'memo.md'), raw);
  const contentSha256 = noteContentSha256({ filename: 'memo.md', title: '메모', noteType: 'highlight', raw });
  db.prepare(`
    INSERT INTO notes (id, filename, title, note_type, content_sha256, index_status)
    VALUES (1, 'memo.md', '메모', 'highlight', ?, 'pending')
  `).run(contentSha256);
  createNoteIndexStateStore(db).markReady({
    filename: 'memo.md', contentSha256, embedding: '[1,0]',
  });

  const before = db.serialize();
  const healthy = await auditNoteIndex({ db, vaultPath });
  assert.equal(healthy.healthy, true);
  assert.match(formatNoteIndexAudit(healthy), /Note index audit: passed/);
  assert.deepEqual(db.serialize(), before);

  await fs.writeFile(path.join(vaultPath, 'memo.md'), raw.replace('본문', '바뀐 본문'));
  const drift = await auditNoteIndex({ db, vaultPath });
  assert.equal(drift.healthy, false);
  assert.deepEqual(drift.findings.contentHashDrift.map(item => item.filename), ['memo.md']);
  assert.equal(JSON.stringify(drift).includes('바뀐 본문'), false);
});
