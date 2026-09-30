'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { migrations } = require('../lib/database-migrations');
const { createMemoryEvidenceRegistry } = require('../lib/memory-storage/evidence-registry');
const { createMemoryStorageRouter } = require('../lib/memory-storage/router');

function fixture() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE messages (
    id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
    content TEXT NOT NULL, created_at INTEGER NOT NULL
  )`);
  migrations.find(item => item.name === 'memory_evidence_refs').up(db);
  db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?)').run(1, 's', 'user', 'first', 100);
  db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?)').run(2, 's', 'user', 'second', 101);
  let calls = 0;
  const handlers = new Map([['synthetic_family', input => { calls += 1; return input; }]]);
  const route = createMemoryStorageRouter({
    evidenceRegistry: createMemoryEvidenceRegistry(db), transitionHandlers: handlers,
  });
  const candidate = {
    schemaVersion: 1, semanticFamily: 'synthetic_family', payload: { fact: 'accepted' },
    sources: [{ sourceDomain: 'conversation_message', sourceKey: '1' }],
  };
  return { db, route, candidate, calls: () => calls };
}

test('accepted candidate dispatches with resolved EvidenceRefs without changing owning source', () => {
  const { db, route, candidate, calls } = fixture();
  const before = db.prepare('SELECT * FROM messages ORDER BY id').all();
  const result = route(candidate);
  assert.equal(calls(), 1);
  assert.equal(result.candidate, candidate);
  assert.equal(result.evidenceRefs.length, 1);
  assert.match(result.evidenceRefs[0].evidenceRef.evidenceId, /^ev1_[0-9a-f]{64}$/);
  assert.equal(result.evidenceRefs[0].source.content, 'first');
  assert.deepEqual(db.prepare('SELECT * FROM messages ORDER BY id').all(), before);
  db.close();
});

test('multiple sources bind before handler; one bad source prevents dispatch and rolls back', () => {
  const { db, route, candidate, calls } = fixture();
  const two = { ...candidate, sources: [...candidate.sources, { sourceDomain: 'conversation_message', sourceKey: '2' }] };
  assert.equal(route(two).evidenceRefs.length, 2);
  assert.equal(calls(), 1);
  db.prepare('DELETE FROM memory_evidence_refs').run();
  assert.throws(() => route({ ...two, sources: [...two.sources, { sourceDomain: 'conversation_message', sourceKey: '3' }] }), /not found/);
  assert.equal(calls(), 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM memory_evidence_refs').get().n, 0);
  db.close();
});

test('invalid ingress and unknown family fail closed', () => {
  const { db, route, candidate, calls } = fixture();
  for (const invalid of [
    { ...candidate, schemaVersion: 2 },
    { ...candidate, sources: [] },
    { ...candidate, payload: [] },
    { ...candidate, payload: { value: undefined } },
    { ...candidate, payload: { value: Number.NaN } },
    { ...candidate, payload: { [Symbol('hidden')]: 'lost' } },
    { ...candidate, validFrom: 123 },
    { ...candidate, semanticFamily: 'generic_fact' },
    { ...candidate, sources: [{ sourceDomain: 'temporary_attachment', sourceKey: '1' }] },
  ]) assert.throws(() => route(invalid));
  assert.equal(calls(), 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM memory_evidence_refs').get().n, 0);
  db.close();
});
