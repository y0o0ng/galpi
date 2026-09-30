'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { migrations } = require('../lib/database-migrations');
const { createMemoryEvidenceRegistry } = require('../lib/memory-storage/evidence-registry');
const { createGeneralFactStore } = require('../lib/memory-storage/general-fact');
const { createGeneralFactReviewStore } = require('../lib/memory-storage/general-fact-review');

function fixture(t, filename = ':memory:') {
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  t.after(() => { if (db.open) db.close(); });
  db.exec(`CREATE TABLE messages (
    id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
    content TEXT NOT NULL, created_at INTEGER NOT NULL
  )`);
  for (const name of ['memory_evidence_refs', 'memory_general_fact_storage', 'memory_general_fact_reviews']) {
    migrations.find(item => item.name === name).up(db);
  }
  for (let id = 1; id <= 4; id += 1) {
    db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?)').run(id, 's', 'user', `source-only-text-${id}`, 100);
  }
  const registry = createMemoryEvidenceRegistry(db);
  const store = createGeneralFactStore(db, registry);
  const reviews = createGeneralFactReviewStore(db, registry);
  function prepare(value = 'Laptop', id = 1, transition = 'CREATE', changeClass = null) {
    const candidate = {
      schemaVersion: 1, semanticFamily: 'general_fact',
      payload: { subject: 'USER', attributeKey: 'primary_laptop', value },
      sources: [{ sourceDomain: 'conversation_message', sourceKey: String(id) }],
    };
    const replay = store.prepare({ candidate, evidenceRefs: registry.registerSources(candidate.sources) }).replayPackage;
    const proposal = { transition, changeClass, rationale: 'Synthetic interpretation',
      evidenceIds: replay.newEvidence.map(item => item.evidenceRef.evidenceId) };
    const input = { candidateId: replay.candidateId, replaySha256: replay.replaySha256, proposal };
    return { input, replay, proposal };
  }
  const decision = (review, choice, reason = '') => ({ choice, reason, packageSha256: review.packageSha256 });
  const target = () => store.readTarget('USER', 'primary_laptop');
  return { db, registry, store, reviews, prepare, decision, target };
}

test('review persists proposal/hash only and does not grant a write merely by creation/read', t => {
  const f = fixture(t);
  const before = f.db.prepare('SELECT * FROM messages').all();
  const { input } = f.prepare();
  const review = f.reviews.create(input);
  assert.equal(review.decision, null);
  assert.equal(f.target().currentState, null);
  const view = f.reviews.read(review.reviewId);
  assert.equal(view.replayPackage.newEvidence[0].source.content, 'source-only-text-1');
  assert.deepEqual(view.preview, {
    isProposal: true, currentValue: null, resultingCurrentValue: 'Laptop', previousStateDisposition: null,
  });
  assert.equal(f.reviews.listPending()[0].reviewId, review.reviewId);
  const stored = f.db.prepare('SELECT * FROM memory_general_fact_reviews').get();
  assert.equal(JSON.stringify(stored).includes('source-only-text'), false);
  assert.equal(Object.hasOwn(stored, 'replay_json'), false);
  assert.deepEqual(f.db.prepare('SELECT * FROM messages').all(), before);
});

test('pending review survives closing/reopening SQLite without rerunning a proposer', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'general-fact-review-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'scratch.db');
  const f = fixture(t, filename);
  const review = f.reviews.create(f.prepare().input);
  f.db.close();
  const reopened = new Database(filename);
  try {
    const reviews = createGeneralFactReviewStore(reopened, createMemoryEvidenceRegistry(reopened));
    assert.deepEqual(reviews.get(review.reviewId), review);
    assert.equal(reviews.read(review.reviewId).replayPackage.candidate.payload.value, 'Laptop');
    assert.equal(reviews.listPending().length, 1);
    reviews.decide(review.reviewId, f.decision(review, 'APPROVE'));
    assert.equal(reviews.listPending().length, 0);
  } finally { reopened.close(); }
});

test('HUMAN approval commits claim, provenance and decision together', t => {
  const f = fixture(t);
  const review = f.reviews.create(f.prepare().input);
  const result = f.reviews.decide(review.reviewId, f.decision(review, 'APPROVE', 'Source supports this meaning'));
  assert.equal(result.decision, 'APPROVE');
  assert.ok(result.decidedAt);
  assert.equal(result.transitionId, f.target().history[0].transitionId);
  assert.equal(f.target().currentState.value, 'Laptop');
  assert.equal(f.target().history[0].validation.reason, 'Source supports this meaning');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM memory_general_fact_transition_evidence').get().n, 1);
});

for (const choice of ['HOLD', 'REJECT_PROPOSAL']) {
  test(`${choice} preserves stable state/candidate and remains a distinct durable decision`, t => {
    const f = fixture(t);
    const initial = f.reviews.create(f.prepare('Stable').input);
    f.reviews.decide(initial.reviewId, f.decision(initial, 'APPROVE'));
    const review = f.reviews.create(f.prepare('Proposed', 2, 'SUPERSEDE', 'WORLD_UPDATE').input);
    f.reviews.decide(review.reviewId, f.decision(review, choice));
    assert.equal(f.target().currentState.value, 'Stable');
    assert.equal(f.target().revision, 1);
    assert.equal(f.target().unresolvedCandidates[0].reason, `HUMAN_${choice}`);
    assert.equal(f.reviews.get(review.reviewId).decision, choice);
    assert.equal(f.reviews.get(review.reviewId).transitionId, null);
    assert.equal(f.reviews.listPending().length, 0);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM messages').get().n, 4);
  });
}

test('new review after HOLD keeps the earlier decision immutable', t => {
  const f = fixture(t);
  const input = f.prepare().input;
  const first = f.reviews.create(input);
  f.reviews.decide(first.reviewId, f.decision(first, 'HOLD'));
  assert.throws(() => f.reviews.decide(first.reviewId, f.decision(first, 'APPROVE')), /REVIEW_DECISION_CONFLICT/);
  const next = f.reviews.create(input);
  assert.notEqual(next.reviewId, first.reviewId);
  f.reviews.decide(next.reviewId, f.decision(next, 'APPROVE'));
  assert.equal(f.reviews.get(first.reviewId).decision, 'HOLD');
  assert.equal(f.target().revision, 1);
});

test('identical decision retransmission is idempotent; conflicting choice/reason is rejected', t => {
  const f = fixture(t);
  const review = f.reviews.create(f.prepare().input);
  const input = f.decision(review, 'APPROVE', 'checked');
  const result = f.reviews.decide(review.reviewId, input);
  assert.deepEqual(f.reviews.decide(review.reviewId, input), result);
  assert.equal(f.target().revision, 1);
  assert.throws(() => f.reviews.decide(review.reviewId, { ...input, reason: 'different' }), /REVIEW_DECISION_CONFLICT/);
  assert.throws(() => f.reviews.decide(review.reviewId, f.decision(review, 'HOLD')), /REVIEW_DECISION_CONFLICT/);
});

test('decision may only address the exact reviewed package and cannot override proposal or approval', t => {
  const f = fixture(t);
  const review = f.reviews.create(f.prepare().input);
  assert.throws(() => f.reviews.decide(review.reviewId, {
    ...f.decision(review, 'APPROVE'), packageSha256: 'f'.repeat(64),
  }), /REVIEW_PACKAGE_MISMATCH/);
  for (const input of [
    { choice: 'APPROVE' }, { ...f.decision(review, 'APPROVE'), approved: true },
    { ...f.decision(review, 'APPROVE'), proposal: review.proposal },
    f.decision(review, 'AUTO_APPROVE'), { ...f.decision(review, 'HOLD'), reason: null },
  ]) assert.throws(() => f.reviews.decide(review.reviewId, input), /INVALID_REVIEW_DECISION/);
  assert.equal(f.reviews.get(review.reviewId).decision, null);
  assert.equal(f.target().revision, 0);
});

test('unsupported/invalid proposals and stale create requests never become review authority', t => {
  const f = fixture(t);
  const { input } = f.prepare();
  for (const bad of [
    { ...input, replaySha256: 'f'.repeat(64) }, { ...input, approved: true },
    { ...input, proposal: { ...input.proposal, evidenceIds: ['unknown'] } },
    { ...input, proposal: { ...input.proposal, transition: 'FORK', changeClass: 'AMBIGUOUS' } },
  ]) assert.throws(() => f.reviews.create(bad));
  assert.equal(f.reviews.listPending().length, 0);
  assert.equal(f.target().unresolvedCandidates.length, 1);
});

test('changed target snapshot fails closed at display/approval, including same-second changes', t => {
  const f = fixture(t);
  const old = f.reviews.create(f.prepare('First').input);
  const later = f.prepare('Second', 2);
  f.store.commit(later.replay, later.proposal, { approved: true, reason: 'Synthetic competing update' });
  assert.throws(() => f.reviews.read(old.reviewId), /STALE_REVIEW/);
  assert.throws(() => f.reviews.decide(old.reviewId, f.decision(old, 'APPROVE')), /STALE_REVIEW/);
  assert.equal(f.reviews.get(old.reviewId).decision, null);
  assert.equal(f.target().currentState.value, 'Second');
});

test('owning-source integrity failure prevents approval without silently substituting content', t => {
  const f = fixture(t);
  const review = f.reviews.create(f.prepare().input);
  f.db.prepare('UPDATE messages SET content = ? WHERE id = 1').run('Mutated source');
  assert.throws(() => f.reviews.read(review.reviewId), /integrity mismatch/);
  assert.throws(() => f.reviews.decide(review.reviewId, f.decision(review, 'APPROVE')), /integrity mismatch/);
  assert.equal(f.reviews.get(review.reviewId).decision, null);
  assert.equal(f.target().currentState, null);
});

test('persisted proposal/binding corruption fails closed', t => {
  const f = fixture(t);
  const review = f.reviews.create(f.prepare().input);
  const original = f.db.prepare('SELECT proposal_json FROM memory_general_fact_reviews').get().proposal_json;
  f.db.prepare('UPDATE memory_general_fact_reviews SET proposal_json = ?').run(original.replace('Synthetic', 'Tampered'));
  assert.throws(() => f.reviews.get(review.reviewId), /INVALID_REVIEW_INTEGRITY/);
  f.db.prepare('UPDATE memory_general_fact_reviews SET proposal_json = ?, replay_sha256 = ?').run(original, 'f'.repeat(64));
  assert.throws(() => f.reviews.decide(review.reviewId, f.decision(review, 'APPROVE')), /INVALID_REVIEW_INTEGRITY/);
  assert.equal(f.target().revision, 0);
});

test('approval-record failure rolls claim, transition, provenance and candidate status back', t => {
  const f = fixture(t);
  const review = f.reviews.create(f.prepare().input);
  f.db.exec(`CREATE TRIGGER reject_review BEFORE UPDATE ON memory_general_fact_reviews
    BEGIN SELECT RAISE(ABORT, 'synthetic review failure'); END`);
  assert.throws(() => f.reviews.decide(review.reviewId, f.decision(review, 'APPROVE')), /synthetic review failure/);
  assert.equal(f.target().revision, 0);
  assert.equal(f.target().states.length, 0);
  assert.equal(f.target().unresolvedCandidates.length, 1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM memory_general_fact_transition_evidence').get().n, 0);
  assert.equal(f.reviews.get(review.reviewId).decision, null);
});

test('provenance failure never leaves an approved review without a committed transition', t => {
  const f = fixture(t);
  const review = f.reviews.create(f.prepare().input);
  f.db.exec(`CREATE TRIGGER reject_evidence BEFORE INSERT ON memory_general_fact_transition_evidence
    BEGIN SELECT RAISE(ABORT, 'synthetic evidence failure'); END`);
  assert.throws(() => f.reviews.decide(review.reviewId, f.decision(review, 'APPROVE')), /synthetic evidence failure/);
  assert.equal(f.target().revision, 0);
  assert.equal(f.reviews.get(review.reviewId).decision, null);
});

test('a competing review cannot claim approval of an already-committed candidate', t => {
  const f = fixture(t);
  const input = f.prepare().input;
  const first = f.reviews.create(input);
  const second = f.reviews.create(input);
  f.reviews.decide(first.reviewId, f.decision(first, 'APPROVE'));
  assert.throws(() => f.reviews.decide(second.reviewId, f.decision(second, 'APPROVE')), /CANDIDATE_ALREADY_COMMITTED/);
  assert.throws(() => f.reviews.create(input), /CANDIDATE_ALREADY_COMMITTED/);
  assert.equal(f.reviews.get(second.reviewId).decision, null);
  assert.equal(f.target().revision, 1);
});

test('retraction preview is a proposed invalidation, not a persisted null fact', t => {
  const f = fixture(t);
  const first = f.reviews.create(f.prepare('Old').input);
  f.reviews.decide(first.reviewId, f.decision(first, 'APPROVE'));
  const review = f.reviews.create(f.prepare(null, 2, 'INVALIDATE', 'CORRECTION').input);
  const view = f.reviews.read(review.reviewId);
  assert.equal(view.replayPackage.originalSupport[0].source.content, 'source-only-text-1');
  assert.deepEqual(view.preview, { isProposal: true, currentValue: 'Old', resultingCurrentValue: null, previousStateDisposition: 'INVALIDATED' });
  assert.equal(f.target().currentState.value, 'Old');
  f.reviews.decide(review.reviewId, f.decision(review, 'APPROVE'));
  assert.equal(f.target().currentState, null);
  assert.equal(f.target().states.length, 1);
});

test('approved receipt must link to its own candidate/proposal/snapshot transition', t => {
  const f = fixture(t);
  const initial = f.reviews.create(f.prepare('Old').input);
  f.reviews.decide(initial.reviewId, f.decision(initial, 'APPROVE'));
  const next = f.reviews.create(f.prepare('New', 2, 'SUPERSEDE', 'WORLD_UPDATE').input);
  const result = f.reviews.decide(next.reviewId, f.decision(next, 'APPROVE'));
  f.db.prepare('UPDATE memory_general_fact_transitions SET replay_sha256 = ? WHERE transition_id = ?')
    .run('f'.repeat(64), result.transitionId);
  assert.throws(() => f.reviews.get(next.reviewId), /INVALID_REVIEW_INTEGRITY/);
});

test('resumed replay verifies the stored accepted candidate identity instead of trusting changed payload', t => {
  const f = fixture(t);
  const review = f.reviews.create(f.prepare().input);
  const row = f.db.prepare('SELECT candidate_json FROM memory_general_fact_candidates').get();
  f.db.prepare('UPDATE memory_general_fact_candidates SET candidate_json = ?')
    .run(row.candidate_json.replace('Laptop', 'Forged'));
  assert.throws(() => f.reviews.read(review.reviewId), /INVALID_CANDIDATE_BINDING/);
  assert.throws(() => f.reviews.decide(review.reviewId, f.decision(review, 'APPROVE')), /INVALID_CANDIDATE_BINDING/);
  assert.equal(f.reviews.get(review.reviewId).decision, null);
  assert.equal(f.target().revision, 0);
});
