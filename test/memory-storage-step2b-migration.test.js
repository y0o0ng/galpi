'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { migrations } = require('../lib/database-migrations');
const { applyModuleMigrations, main: applyCommand } = require('../lib/memory-storage/migrations');
const { openDevelopmentDb } = require('../lib/memory-storage/review-ui');
const { createMemoryEvidenceRegistry } = require('../lib/memory-storage/evidence-registry');
const { createGeneralFactStore } = require('../lib/memory-storage/general-fact');
const { createGeneralFactReviewStore } = require('../lib/memory-storage/general-fact-review');
const { createGeneralFactReviewHandler } = require('../lib/memory-storage/general-fact-proposer');
const { createOpenAIGeneralFactProposer } = require('../lib/memory-storage/general-fact-openai');

test('module migration applies once, preserves foreign keys and keeps the development table guard', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-migration-')); fs.chmodSync(dir, 0o700);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'general-fact-development.db');
  let db = new Database(filename); fs.chmodSync(filename, 0o600);
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE messages(id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL)');
  for (const name of ['memory_evidence_refs', 'memory_general_fact_storage', 'memory_general_fact_reviews']) migrations.find(m => m.name === name).up(db);
  db.close();
  db = openDevelopmentDb(filename);
  applyModuleMigrations(db); applyModuleMigrations(db);
  assert.deepEqual(db.prepare('SELECT version FROM memory_storage_migrations').all(), [{ version: 1 }]);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  db.close();
  assert.deepEqual(applyCommand([filename]), { version: 1 });
  db = openDevelopmentDb(filename);
  db.exec('CREATE TABLE unexpected(value TEXT)'); db.close();
  assert.throws(() => openDevelopmentDb(filename), /Expected only/);
});

test('MULTI Luna proposal schema requires a specific state ID field', async () => {
  let body;
  const value = { transition: 'EXPAND', changeClass: 'EXPANSION', targetStateId: null, evidenceIds: ['ev'], rationale: 'synthetic' };
  const proposer = createOpenAIGeneralFactProposer({ apiKey: 'fake', fetch: async (_url, options) => {
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }),
      { headers: { 'content-type': 'application/json' } });
  } });
  await proposer({ promptVersion: 'general-fact-transition-proposal-v1', instructions: 'test', input: JSON.stringify({ replayPackage: { candidate: { payload: { attributeKey: 'affiliation' } } } }) });
  assert.ok(body.text.format.schema.required.includes('targetStateId'));
});

test('migration preserves existing SINGLE transitions, reviews and evidence foreign keys', t => {
  const db = new Database(':memory:'); t.after(() => db.close()); db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE messages(id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL)');
  for (const name of ['memory_evidence_refs', 'memory_general_fact_storage', 'memory_general_fact_reviews']) migrations.find(m => m.name === name).up(db);
  db.prepare('INSERT INTO messages VALUES(1, ?, ?, ?, 1)').run('s', 'user', 'synthetic');
  const registry = createMemoryEvidenceRegistry(db), store = createGeneralFactStore(db, registry);
  const candidate = { schemaVersion: 1, semanticFamily: 'general_fact', payload: { subject: 'USER', attributeKey: 'primary_laptop', value: 'laptop' },
    sources: [{ sourceDomain: 'conversation_message', sourceKey: '1' }] };
  const replay = store.prepare({ candidate, evidenceRefs: registry.registerSources(candidate.sources) }).replayPackage;
  const reviews = createGeneralFactReviewStore(db, registry);
  const review = reviews.create({ candidateId: replay.candidateId, replaySha256: replay.replaySha256, proposal: { transition: 'CREATE', changeClass: null,
    evidenceIds: replay.newEvidence.map(e => e.evidenceRef.evidenceId), rationale: 'synthetic' } });
  reviews.decide(review.reviewId, { choice: 'APPROVE', packageSha256: review.packageSha256 });
  applyModuleMigrations(db);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(createGeneralFactStore(db, registry).readTarget('USER', 'primary_laptop').currentState.value, 'laptop');
  assert.equal(createGeneralFactReviewStore(db, registry).get(review.reviewId).decision, 'APPROVE');
  assert.equal(db.pragma('foreign_key_list(memory_general_fact_reviews)').find(row => row.from === 'transition_id').table, 'memory_general_fact_transitions');
});

test('MULTI affiliation adds and changes only the named current state', async t => {
  const db = new Database(':memory:'); t.after(() => db.close()); db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE messages(id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL)');
  for (const name of ['memory_evidence_refs', 'memory_general_fact_storage', 'memory_general_fact_reviews']) migrations.find(m => m.name === name).up(db);
  applyModuleMigrations(db);
  const registry = createMemoryEvidenceRegistry(db), store = createGeneralFactStore(db, registry);
  function prepare(id, value) {
    db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?)').run(id, 's', 'user', `synthetic ${id}`, id);
    const candidate = { schemaVersion: 1, semanticFamily: 'general_fact', payload: { subject: 'USER', attributeKey: 'affiliation', value }, sources: [{ sourceDomain: 'conversation_message', sourceKey: String(id) }] };
    return store.prepare({ candidate, evidenceRefs: registry.registerSources(candidate.sources) }).replayPackage;
  }
  const approve = { approved: true, reason: 'synthetic owner' };
  function commit(replay, transition, changeClass, targetStateId) {
    return store.commit(replay, { transition, changeClass, targetStateId, evidenceIds: replay.newEvidence.map(e => e.evidenceRef.evidenceId), rationale: 'synthetic' }, approve);
  }
  commit(prepare(1, 'school'), 'CREATE', null, null);
  commit(prepare(2, 'club'), 'EXPAND', 'EXPANSION', null);
  let target = store.readTarget('USER', 'affiliation');
  assert.deepEqual(target.currentStates.map(state => state.value).sort(), ['club', 'school']);
  const school = target.currentStates.find(state => state.value === 'school').stateId;
  const replay = prepare(3, 'new school');
  assert.throws(() => commit(replay, 'SUPERSEDE', 'WORLD_UPDATE', 'missing'), /INVALID_TRANSITION_TARGET/);
  commit(replay, 'SUPERSEDE', 'WORLD_UPDATE', school);
  target = store.readTarget('USER', 'affiliation');
  assert.deepEqual(target.currentStates.map(state => state.value).sort(), ['club', 'new school']);
  assert.equal(target.states.find(state => state.value === 'school').status, 'HISTORICAL');
  const club = target.currentStates.find(state => state.value === 'club').stateId;
  commit(prepare(4, 'club corrected'), 'REVISE', 'CORRECTION', club);
  target = store.readTarget('USER', 'affiliation');
  const corrected = target.currentStates.find(state => state.value === 'club corrected').stateId;
  commit(prepare(5, null), 'INVALIDATE', 'CORRECTION', corrected);
  target = store.readTarget('USER', 'affiliation');
  assert.deepEqual(target.currentStates.map(state => state.value), ['new school']);
  commit(prepare(6, 'new school again'), 'NO_CHANGE', 'ADDITIONAL_CONTEXT', target.currentStates[0].stateId);
  assert.equal(store.readTarget('USER', 'affiliation').currentStates[0].value, 'new school');
  const rejected = prepare(7, 'bad replacement');
  const reviews = createGeneralFactReviewStore(db, registry);
  const review = reviews.create({ candidateId: rejected.candidateId, replaySha256: rejected.replaySha256,
    proposal: { transition: 'REVISE', changeClass: 'CORRECTION', targetStateId: target.currentStates[0].stateId,
      evidenceIds: rejected.newEvidence.map(e => e.evidenceRef.evidenceId), rationale: 'synthetic' } });
  assert.equal(reviews.read(review.reviewId).preview.currentValue, 'new school');
  assert.throws(() => reviews.decide(review.reviewId, { choice: 'REJECT_PROPOSAL', packageSha256: review.packageSha256 }), /INVALID_REVIEW_DECISION/);
  assert.equal(reviews.decide(review.reviewId, { choice: 'REJECT_PROPOSAL', packageSha256: review.packageSha256,
    rejectionTag: 'WRONG_TARGET' }).rejectionTag, 'WRONG_TARGET');
  const uncertain = prepare(8, 'another school');
  const handler = createGeneralFactReviewHandler({ db, evidenceRegistry: registry, proposeTransition: async request => ({
    transition: 'KEEP_AMBIGUOUS', changeClass: 'AMBIGUOUS', targetStateId: null,
    evidenceIds: JSON.parse(request.input).replayPackage.newEvidence.map(e => e.evidenceRef.evidenceId), rationale: 'synthetic' }) });
  const result = await handler({ candidate: uncertain.candidate, evidenceRefs: registry.registerSources(uncertain.candidate.sources) });
  assert.equal(result.reason, 'KEEP_AMBIGUOUS');
  assert.equal(store.readTarget('USER', 'affiliation').currentStates[0].value, 'new school');
});
