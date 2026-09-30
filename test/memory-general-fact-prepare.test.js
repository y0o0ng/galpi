'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const { migrations } = require('../lib/database-migrations');
const { createMemoryEvidenceRegistry } = require('../lib/memory-storage/evidence-registry');
const { createGeneralFactReviewStore } = require('../lib/memory-storage/general-fact-review');
const { main } = require('../lib/memory-storage/prepare-general-fact-review');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'general-fact-prepare-'));
  fs.chmodSync(dir, 0o700);
  const filename = path.join(dir, 'general-fact-development.db');
  const candidateFile = path.join(dir, 'candidate.json');
  const db = new Database(filename);
  fs.chmodSync(filename, 0o600);
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, created_at INTEGER)');
  for (const name of ['memory_evidence_refs', 'memory_general_fact_storage', 'memory_general_fact_reviews']) {
    migrations.find(item => item.name === name).up(db);
  }
  db.prepare('INSERT INTO messages VALUES (1, ?, ?, ?, 100)').run('synthetic', 'user', 'private-original-source');
  db.prepare('INSERT INTO messages VALUES (2, ?, ?, ?, 101)').run('synthetic', 'user', 'private-next-source');
  const candidate = { schemaVersion: 1, semanticFamily: 'general_fact',
    payload: { subject: 'USER', attributeKey: 'primary_laptop', value: 'private-laptop-value' },
    sources: [{ sourceDomain: 'conversation_message', sourceKey: '1' }] };
  const write = value => fs.writeFileSync(candidateFile, JSON.stringify(value), { mode: 0o600 });
  write(candidate);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { db, filename, candidateFile, candidate, write,
    argv: ['--development-db', filename, '--candidate', candidateFile] };
}

function proposal(request, transition = 'CREATE', changeClass = null) {
  return { transition, changeClass, rationale: 'private-rationale',
    evidenceIds: JSON.parse(request.input).replayPackage.newEvidence.map(item => item.evidenceRef.evidenceId) };
}

test('command binds evidence and makes one pending review; output is identifiers only', async t => {
  const f = fixture(t);
  const before = f.db.prepare('SELECT * FROM messages').all();
  let calls = 0;
  const result = await main(f.argv, request => {
    calls++;
    assert.equal(JSON.parse(request.input).replayPackage.newEvidence[0].source.content, 'private-original-source');
    return proposal(request);
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 'PENDING');
  assert.equal(result.reason, 'HUMAN_REVIEW_REQUIRED');
  assert.deepEqual(Object.keys(result).sort(), ['candidateId', 'packageSha256', 'reason', 'reviewId', 'status']);
  assert.equal(JSON.stringify(result).includes('private-'), false);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM memory_general_fact_states').get().n, 0);
  assert.equal(f.db.prepare('SELECT decision FROM memory_general_fact_reviews').get().decision, null);
  assert.deepEqual(f.db.prepare('SELECT * FROM messages').all(), before);
  const reviews = createGeneralFactReviewStore(f.db, createMemoryEvidenceRegistry(f.db));
  reviews.decide(result.reviewId, { choice: 'APPROVE', packageSha256: result.packageSha256 });
  const repeated = await main(f.argv, () => { throw new Error('No second call for committed candidate'); });
  assert.equal(repeated.status, 'COMMITTED');
  f.write({ ...f.candidate, payload: { ...f.candidate.payload, value: 'private-new-value' },
    sources: [{ sourceDomain: 'conversation_message', sourceKey: '2' }] });
  const next = await main(f.argv, request => {
    const replay = JSON.parse(request.input).replayPackage;
    assert.equal(replay.currentState.value, 'private-laptop-value');
    assert.equal(replay.originalSupport[0].source.content, 'private-original-source');
    return proposal(request, 'SUPERSEDE', 'WORLD_UPDATE');
  });
  assert.equal(next.status, 'PENDING');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM memory_general_fact_states').get().n, 1);
});

test('bad inputs and missing owning sources prevent proposer invocation', async t => {
  const f = fixture(t);
  const never = () => { assert.fail('Proposer must not run'); };
  await assert.rejects(main([], never), { code: 'INVALID_ARGUMENTS' });
  for (const value of [null, { ...f.candidate, schemaVersion: 2 }, { ...f.candidate, sources: [] },
    { ...f.candidate, semanticFamily: 'other' },
    { ...f.candidate, payload: { ...f.candidate.payload, attributeKey: 'invented' } },
    { ...f.candidate, sources: [...f.candidate.sources, { sourceDomain: 'conversation_message', sourceKey: '999' }] },
    { ...f.candidate, sources: [{ sourceDomain: 'temporary_attachment', sourceKey: '1' }] }]) {
    f.write(value);
    await assert.rejects(main(f.argv, never));
  }
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM memory_general_fact_reviews').get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM memory_general_fact_states').get().n, 0);
});

test('private file and existing development schema requirements fail before any call', async t => {
  const f = fixture(t);
  const never = () => { assert.fail('No provider'); };
  fs.chmodSync(f.candidateFile, 0o644);
  await assert.rejects(main(f.argv, never), { code: 'PRIVATE_CANDIDATE_FILE_REQUIRED' });
  fs.chmodSync(f.candidateFile, 0o600);
  fs.writeFileSync(f.candidateFile, '{ private malformed JSON');
  await assert.rejects(main(f.argv, never), { code: 'INVALID_CANDIDATE_JSON' });
  f.write(f.candidate);
  f.db.exec('DROP TABLE memory_general_fact_reviews');
  await assert.rejects(main(f.argv, never), /automatic migration/);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='memory_general_fact_reviews'").get().n, 0);
});

test('provider failure is one attempt, preserves pending candidate, never approves', async t => {
  const f = fixture(t);
  let calls = 0;
  await assert.rejects(main(f.argv, () => { calls++; throw new Error('private-provider-error'); }), { code: 'PROPOSER_CALL_FAILED' });
  assert.equal(calls, 1);
  assert.equal(f.db.prepare('SELECT pending_reason FROM memory_general_fact_candidates').get().pending_reason, 'PROPOSER_CALL_FAILED');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM memory_general_fact_states').get().n, 0);
});

test('missing credentials or custom endpoint fail before binding or model dispatch', t => {
  const f = fixture(t);
  const script = path.resolve(__dirname, '../lib/memory-storage/prepare-general-fact-review.js');
  for (const [overrides, code] of [
    [{ OPENAI_API_KEY: '', OPENAI_BASE_URL: '' }, 'OPENAI_API_KEY_REQUIRED'],
    [{ OPENAI_API_KEY: 'private-secret', OPENAI_BASE_URL: 'https://private.invalid' }, 'CUSTOM_OPENAI_ENDPOINT_UNSUPPORTED'],
  ]) {
    const result = spawnSync(process.execPath, [script, ...f.argv], {
      env: { ...process.env, ...overrides }, encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.equal(result.stderr.trim(), code);
    assert.equal(result.stdout, '');
  }
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM memory_evidence_refs').get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM memory_general_fact_candidates').get().n, 0);
});

test('CLI help and errors do not dump credentials, paths, source or stack', () => {
  const script = path.resolve(__dirname, '../lib/memory-storage/prepare-general-fact-review.js');
  const env = { ...process.env, OPENAI_API_KEY: 'private-secret-key', OPENAI_BASE_URL: 'https://private.invalid' };
  const help = spawnSync(process.execPath, [script, '--help'], { env, encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /HUMAN/);
  const invalid = spawnSync(process.execPath, [script, '--private-secret'], { env, encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stderr.trim(), 'INVALID_ARGUMENTS');
  assert.equal(invalid.stdout, '');
  assert.equal((help.stdout + help.stderr + invalid.stderr).includes('private-secret'), false);
});
