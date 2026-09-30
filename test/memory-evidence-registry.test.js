'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');
const { migrations } = require('../lib/database-migrations');
const {
  canonicalAddress, evidenceIdFor, createMemoryEvidenceRegistry,
} = require('../lib/memory-storage/evidence-registry');

function fixture() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE messages (
    id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
    content TEXT NOT NULL, created_at INTEGER NOT NULL, embedding TEXT
  )`);
  migrations.find(item => item.name === 'memory_evidence_refs').up(db);
  db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (1, ?, ?, ?, 123)')
    .run('session-a', 'user', 'Original source');
  return { db, registry: createMemoryEvidenceRegistry(db) };
}

test('canonical EvidenceRef ID is deterministic and address fields are distinct', () => {
  const address = { sourceDomain: 'conversation_message', sourceKey: '1' };
  assert.deepEqual(canonicalAddress(address), { ...address, locator: '', sourceVersion: '' });
  assert.equal(evidenceIdFor(address), evidenceIdFor({ ...address, locator: '', sourceVersion: '' }));
  assert.notEqual(evidenceIdFor(address), evidenceIdFor({ ...address, sourceKey: '2' }));
  assert.notEqual(evidenceIdFor(address), evidenceIdFor({ ...address, sourceDomain: 'topic_qa' }));
  assert.notEqual(evidenceIdFor({ ...address, sourceDomain: 'topic_qa' }),
    evidenceIdFor({ ...address, sourceDomain: 'topic_qa', locator: 'section-1' }));
  assert.notEqual(evidenceIdFor({ ...address, sourceDomain: 'topic_qa' }),
    evidenceIdFor({ ...address, sourceDomain: 'topic_qa', sourceVersion: '2' }));
  for (const invalid of [
    { ...address, sourceKey: '01' }, { ...address, sourceKey: '0' },
    { ...address, sourceKey: '-1' }, { ...address, sourceKey: '1.0' },
    { ...address, sourceKey: '9007199254740992' },
    { ...address, locator: 'span' }, { ...address, sourceVersion: 'v2' },
  ]) assert.throws(() => evidenceIdFor(invalid));
});

test('registration is idempotent, resolves owning message, and stores no content copy', () => {
  const { db, registry } = fixture();
  const address = { sourceDomain: 'conversation_message', sourceKey: '1' };
  const first = registry.registerSource(address);
  const second = registry.registerSource(address);
  assert.deepEqual(first, second);
  assert.deepEqual(registry.resolveEvidenceRef(first.evidenceRef.evidenceId), first);
  assert.equal(first.source.sessionId, 'session-a');
  assert.equal(first.source.role, 'user');
  assert.equal(first.source.content, 'Original source');
  assert.equal(first.source.createdAt, 123);
  assert.equal(first.evidenceRef.contentSha256,
    createHash('sha256').update('Original source').digest('hex'));
  assert.equal(db.prepare('SELECT count(*) AS n FROM memory_evidence_refs').get().n, 1);
  db.prepare('UPDATE messages SET embedding = ? WHERE id = 1').run('[0.1,0.2]');
  assert.deepEqual(registry.registerSource(address), first);
  const columns = db.prepare('PRAGMA table_info(memory_evidence_refs)').all().map(row => row.name);
  assert.deepEqual(columns, [
    'evidence_id', 'source_domain', 'source_key', 'locator', 'source_version',
    'content_sha256', 'created_at',
  ]);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM memory_evidence_refs').get()).includes('Original source'), false);
  db.close();
});

test('missing source, changed content, and unsupported domain fail closed', () => {
  const { db, registry } = fixture();
  assert.throws(() => registry.registerSource({ sourceDomain: 'conversation_message', sourceKey: '2' }), /not found/);
  assert.throws(() => registry.registerSource({ sourceDomain: 'attachment', sourceKey: '1' }), /Unsupported/);
  const { evidenceRef } = registry.registerSource({ sourceDomain: 'conversation_message', sourceKey: '1' });
  db.prepare('UPDATE messages SET content = ? WHERE id = 1').run('Changed source');
  assert.throws(() => registry.registerSource({ sourceDomain: 'conversation_message', sourceKey: '1' }), /integrity mismatch/);
  assert.throws(() => registry.resolveEvidenceRef(evidenceRef.evidenceId), /integrity mismatch/);
  db.close();
});

test('all-source binding rolls back registry inserts if a later source fails', () => {
  const { db, registry } = fixture();
  assert.throws(() => registry.registerSources([
    { sourceDomain: 'conversation_message', sourceKey: '1' },
    { sourceDomain: 'conversation_message', sourceKey: '2' },
  ]), /not found/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM memory_evidence_refs').get().n, 0);
  db.close();
});
