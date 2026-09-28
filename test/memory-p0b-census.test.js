'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { sha256 } = require('../lib/content-hash');
const { buildReplayCensus } = require('../scripts/freeze-memory-p0-b-census');

const START = Date.parse('2026-08-31T00:00:00+09:00') / 1000;
const BASELINE = 'a'.repeat(40);
const byteHash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'galpi-p0b-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dbPath = path.join(root, 'galpi.db');
  const vaultPath = path.join(root, 'vault');
  fs.mkdirSync(vaultPath);
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY, name TEXT, applied_at INTEGER);
    CREATE TABLE assistant_retrieval_shadow_runs (
      id INTEGER PRIMARY KEY, session_id TEXT, mode TEXT,
      query_sha256 TEXT, resolution_outcome TEXT, retrieval_query_sha256 TEXT,
      active_notes_json TEXT, notes_json TEXT, chunks_json TEXT,
      context_chars INTEGER, error TEXT, created_at INTEGER
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT,
      embedding TEXT, runtime_generation TEXT, created_at INTEGER
    );
    CREATE TABLE notes (
      filename TEXT PRIMARY KEY, title TEXT, note_type TEXT, embedding TEXT,
      archived INTEGER DEFAULT 0, ai_readable INTEGER DEFAULT 1,
      codex_status TEXT DEFAULT 'processed'
    );
    CREATE TABLE note_chunks (
      id INTEGER PRIMARY KEY, chunk_id TEXT, note_filename TEXT,
      chunk_type TEXT, content TEXT, index_status TEXT, embedding TEXT,
      created_at INTEGER, updated_at INTEGER
    );
  `);
  db.prepare('INSERT INTO schema_version VALUES (26, ?, ?)')
    .run('retrieval_query_resolution_trace', START + 1000);
  return { db, dbPath, vaultPath };
}

function addInvocation(db, {
  at,
  query = '반복 질문',
  outcome = null,
  retrievalHash = outcome === 'pass' ? sha256(query) : null,
  activeNotesJson = '[]',
  chunks = [],
  embedding = [1, 0],
  message = true,
  mode = 'chat:gpt-single-v1:a2',
}) {
  db.prepare(`
    INSERT INTO assistant_retrieval_shadow_runs (
      session_id, mode, query_sha256, resolution_outcome,
      retrieval_query_sha256, active_notes_json, notes_json,
      chunks_json, context_chars, created_at
    ) VALUES ('shared-main', ?, ?, ?, ?, ?, '[]', ?, 0, ?)
  `).run(mode, sha256(query), outcome, retrievalHash, activeNotesJson,
    JSON.stringify(chunks), at);
  if (!message) return;
  db.prepare(`
    INSERT INTO messages (session_id, role, content, embedding, created_at)
    VALUES ('shared-main', 'user', ?, ?, ?)
  `).run(query, embedding ? JSON.stringify(embedding) : null, at + 1);
  db.prepare(`
    INSERT INTO messages (session_id, role, content, runtime_generation, created_at)
    VALUES ('shared-main', 'assistant', 'private answer', 'gpt-single-v1', ?)
  `).run(at + 1);
}

function addChunk(f, { id = 'chunk-1', createdAt, updatedAt = createdAt }) {
  f.db.prepare(`
    INSERT OR IGNORE INTO notes (filename,title,note_type,embedding)
    VALUES ('private.md','Private title','topic',?)
  `).run(JSON.stringify([1, 0]));
  fs.writeFileSync(path.join(f.vaultPath, 'private.md'), 'Q: 반복 질문\nA: private content');
  f.db.prepare(`
    INSERT INTO note_chunks (
      chunk_id,note_filename,chunk_type,content,index_status,embedding,created_at,updated_at
    ) VALUES (?, 'private.md', 'topic_qa', 'Q: 반복 질문\nA: private content', 'ready', ?, ?, ?)
  `).run(id, JSON.stringify([1, 0]), createdAt, updatedAt);
}

async function run(f, expectedEligible) {
  f.db?.close();
  const db = new Database(f.dbPath, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  try {
    return await buildReplayCensus({
      db, vaultPath: f.vaultPath, baselineCommit: BASELINE, expectedEligible,
    });
  } finally {
    db.close();
  }
}

test('legacy/pass replay, resolver no-search, resolved and NULL telemetry have distinct dispositions', async t => {
  const f = fixture(t);
  addInvocation(f.db, { at: START + 100, query: 'legacy' });
  addInvocation(f.db, { at: START + 1100, query: 'pass', outcome: 'pass' });
  addInvocation(f.db, { at: START + 1200, outcome: 'no_retrieval', embedding: null,
    activeNotesJson: '["private.md"]' });
  addInvocation(f.db, { at: START + 1300, outcome: 'ambiguous', embedding: null });
  addInvocation(f.db, { at: START + 1400, outcome: 'resolved',
    retrievalHash: sha256('rewritten private query') });
  addInvocation(f.db, { at: START + 1500, outcome: null });
  const artifact = await run(f, 6);
  assert.deepEqual(artifact.cases.map(item => item.disposition), [
    'REPLAY_SAME', 'REPLAY_SAME', 'NO_D0_BY_PRODUCTION_SEMANTICS',
    'NO_D0_BY_PRODUCTION_SEMANTICS', 'PIT_UNCERTAIN', 'PIT_UNCERTAIN',
  ]);
  assert.equal(artifact.cases[2].activeNoteCount, 1);
  assert.deepEqual(artifact.cases.slice(4).map(item => item.uncertaintyReasons[0]), [
    'PIT_UNCERTAIN_QUERY_RESOLUTION', 'PIT_UNCERTAIN_RESOLUTION_TELEMETRY',
  ]);
  assert.equal(Object.values(artifact.counts.dispositions).reduce((a, b) => a + b), 6);
  assert.equal(artifact.safety.totalChangesDelta, 0);
  assert.equal(artifact.safety.externalApiCalls, 0);
  assert.equal(artifact.safety.answerGenerations, 0);
});

test('missing mapping, active-note telemetry, query hash and embedding fail closed', async t => {
  const f = fixture(t);
  addInvocation(f.db, { at: START + 1100, query: 'missing mapping', outcome: 'pass', message: false });
  addInvocation(f.db, { at: START + 1200, query: 'missing notes', outcome: 'pass', activeNotesJson: null });
  addInvocation(f.db, { at: START + 1300, query: 'malformed notes', outcome: 'pass', activeNotesJson: '{}' });
  addInvocation(f.db, { at: START + 1400, query: 'hash mismatch', outcome: 'pass', retrievalHash: sha256('wrong') });
  addInvocation(f.db, { at: START + 1500, query: 'missing embedding', outcome: 'pass', embedding: null });
  const artifact = await run(f, 5);
  assert.deepEqual(artifact.cases.map(item => item.uncertaintyReasons[0]), [
    'PIT_UNCERTAIN_MESSAGE_MAPPING', 'PIT_UNCERTAIN_ACTIVE_NOTES',
    'PIT_UNCERTAIN_ACTIVE_NOTES', 'PIT_UNCERTAIN_QUERY_RESOLUTION',
    'PIT_UNCERTAIN_QUERY_EMBEDDING',
  ]);
  assert.equal(artifact.counts.dispositions.PIT_UNCERTAIN, 5);
});

test('corpus mismatch, missing historical chunk and post-trace update remain uncertain', async t => {
  const f = fixture(t);
  addChunk(f, { createdAt: START + 20, updatedAt: START + 2500 });
  addInvocation(f.db, { at: START + 1100, outcome: 'pass' });
  addInvocation(f.db, { at: START + 1200, outcome: 'pass',
    chunks: [{ chunkId: 'deleted', noteFilename: 'private.md' }] });
  addInvocation(f.db, { at: START + 1300, outcome: 'pass',
    chunks: [{ chunkId: 'chunk-1', noteFilename: 'private.md' }] });
  const artifact = await run(f, 3);
  assert.deepEqual(artifact.cases.map(item => item.uncertaintyReasons), [
    ['PIT_UNCERTAIN_CORPUS_REPLAY'],
    ['PIT_UNCERTAIN_CORPUS_REPLAY'],
    ['PIT_UNCERTAIN_CORPUS_REPLAY'],
  ]);
});

test('future chunks are excluded, repeated text stays invocation-weighted, artifact is private and deterministic', async t => {
  const f = fixture(t);
  addChunk(f, { createdAt: START + 3000 });
  addInvocation(f.db, { at: START + 1100, outcome: 'pass' });
  addInvocation(f.db, { at: START + 1200, outcome: 'pass' });
  f.db.close();
  const dbBefore = byteHash(fs.readFileSync(f.dbPath));
  const vaultBefore = byteHash(fs.readFileSync(path.join(f.vaultPath, 'private.md')));
  f.db = null;
  const first = await run(f, 2);
  const second = await run({ ...f, db: null }, 2);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.counts.dispositions.REPLAY_SAME, 2);
  assert.notEqual(first.cases[0].traceId, first.cases[1].traceId);
  const json = JSON.stringify(first);
  for (const secret of ['반복 질문', 'private.md', 'Private title', 'private content', 'private answer']) {
    assert.equal(json.includes(secret), false);
  }
  assert.equal(byteHash(fs.readFileSync(f.dbPath)), dbBefore);
  assert.equal(byteHash(fs.readFileSync(path.join(f.vaultPath, 'private.md'))), vaultBefore);
});

test('wrong universe and migration-second overlap fail before freezing', async t => {
  const f = fixture(t);
  addInvocation(f.db, { at: START + 1100, outcome: 'pass' });
  await assert.rejects(run(f, 409), /eligible invocation 불변식/);
  const g = fixture(t);
  addInvocation(g.db, { at: START + 1000, outcome: 'pass' });
  await assert.rejects(run(g, 1), /경계를 증명할 수 없습니다/);
});
