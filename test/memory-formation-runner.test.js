'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { migrations } = require('../lib/database-migrations');
const { runFormationEpisode } = require('../lib/memory-storage/formation-runner');
const { buildEvidenceBundles } = require('../lib/memory-storage/bundle-builder');
const { createMemoryEvidenceRegistry } = require('../lib/memory-storage/evidence-registry');
const { createMemoryStorageRouter } = require('../lib/memory-storage/router');
const { createGeneralFactReviewHandler } = require('../lib/memory-storage/general-fact-proposer');
const { createGeneralFactStore } = require('../lib/memory-storage/general-fact');
const { createGeneralFactReviewStore } = require('../lib/memory-storage/general-fact-review');

const episode = () => ({ schemaVersion: 1, sourceDomain: 'conversation_message', sessionId: 'synthetic',
  firstMessageId: 1, lastMessageId: 3, turns: [
    { turnId: 'm1', messageId: 1, role: 'USER', text: '주 노트북은 Test Laptop이야.', createdAt: 100 },
    { turnId: 'm2', messageId: 2, role: 'ASSISTANT', text: '주로 쓰는 노트북이라는 말이구나.', createdAt: 100 },
    { turnId: 'm3', messageId: 3, role: 'USER', text: '다른 이야기는 나중에 하자.', createdAt: 101 },
  ] });
const selection = () => ({ bundles: [{ anchor: { turnId: 'm1', text: '주 노트북은 Test Laptop' },
  evidenceTurnIds: ['m1', 'm2'] }] });
const extracted = () => ({ disposition: 'EXTRACTED', semanticFamily: 'general_fact',
  payload: { subject: 'USER', attributeKey: 'primary_laptop', value: 'Test Laptop' },
  evidenceTurnIds: ['m2', 'm1'] });
const pending = () => ({ status: 'PENDING', reason: 'HUMAN_REVIEW_REQUIRED', candidateId: 'candidate',
  review: { reviewId: 'review', packageSha256: 'synthetic-hash', decision: null } });
const stages = (overrides = {}) => ({ selectBundles: selection,
  assessAmbiguity: () => ({ disposition: 'CLEAR', reason: 'synthetic meaning reason' }),
  assessDurability: () => ({ disposition: 'WRITE', reason: 'synthetic durability reason' }),
  extractCandidate: extracted, prepareReview: pending, ...overrides });

test('one source episode reaches existing Router and HUMAN review without state commit', async t => {
  const db = new Database(':memory:'); t.after(() => db.close());
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, created_at INTEGER)');
  for (const name of ['memory_evidence_refs', 'memory_general_fact_storage', 'memory_general_fact_reviews']) {
    migrations.find(item => item.name === name).up(db);
  }
  const e = episode();
  for (const turn of e.turns) db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?)')
    .run(turn.messageId, e.sessionId, turn.role.toLowerCase(), turn.text, turn.createdAt);
  const before = db.prepare('SELECT * FROM messages').all();
  const registry = createMemoryEvidenceRegistry(db);
  const reviews = createGeneralFactReviewStore(db, registry);
  const store = createGeneralFactStore(db, registry);
  let proposals = 0;
  const handler = createGeneralFactReviewHandler({ db, evidenceRegistry: registry, proposeTransition: request => {
    proposals++;
    const replay = JSON.parse(request.input).replayPackage;
    return { changeClass: null, transition: 'CREATE', rationale: 'Synthetic proposal only',
      evidenceIds: replay.newEvidence.map(item => item.evidenceRef.evidenceId) };
  } });
  const route = createMemoryStorageRouter({ evidenceRegistry: registry,
    transitionHandlers: new Map([['general_fact', handler]]) });
  const [result] = (await runFormationEpisode(e, stages({ prepareReview: route }))).results;
  assert.equal(result.status, 'REVIEW_PREPARED');
  assert.equal(reviews.get(result.reviewId).decision, null);
  assert.equal(proposals, 1);
  assert.equal(store.readTarget('USER', 'primary_laptop').currentState, null);
  assert.equal(db.prepare('SELECT count(*) AS n FROM memory_general_fact_transitions').get().n, 0);
  assert.deepEqual(db.prepare('SELECT * FROM messages').all(), before);
  // Only this explicit synthetic HUMAN decision changes state, never the runner.
  reviews.decide(result.reviewId, { choice: 'APPROVE', packageSha256: result.packageSha256 });
  const [again] = (await runFormationEpisode(e, stages({ prepareReview: route }))).results;
  assert.equal(again.status, 'ALREADY_COMMITTED');
  assert.equal(proposals, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM memory_general_fact_transitions').get().n, 1);
});

test('stage inputs preserve bundle identity; only extraction receives durability reason', async () => {
  const e = episode(); const before = structuredClone(e); const order = [];
  const expected = buildEvidenceBundles(e, selection()).bundles[0];
  const check = input => {
    assert.deepEqual(input.bundle, expected);
    assert.deepEqual(input.evidence, before.turns.slice(0, 2));
    assert.equal(Object.hasOwn(input, 'ambiguity'), false);
  };
  const report = await runFormationEpisode(e, stages({
    assessAmbiguity: input => {
      order.push('ambiguity'); check(input);
      input.bundle.selectedBundle = 'mutated'; input.evidence[0].text = 'mutated';
      e.turns[0].text = 'caller changed during await';
      return { disposition: 'CLEAR', reason: 'DO_NOT_FORWARD' };
    },
    assessDurability: input => {
      order.push('durability'); check(input);
      assert.deepEqual(Object.keys(input).sort(), ['bundle', 'evidence']);
      return { disposition: 'WRITE', reason: 'KEEP_CONDITIONS' };
    },
    extractCandidate: input => {
      order.push('extraction'); check(input); assert.equal(input.durabilityReason, 'KEEP_CONDITIONS');
      assert.equal(JSON.stringify(input).includes('DO_NOT_FORWARD'), false);
      return extracted();
    },
    prepareReview: candidate => {
      order.push('review');
      assert.deepEqual(candidate.sources, [
        { sourceDomain: 'conversation_message', sourceKey: '1' },
        { sourceDomain: 'conversation_message', sourceKey: '2' },
      ]);
      candidate.payload.value = 'callback mutation';
      return pending();
    },
  }));
  assert.deepEqual(order, ['ambiguity', 'durability', 'extraction', 'review']);
  assert.deepEqual(report.results[0].bundle, expected);
  assert.equal(report.results[0].candidate.payload.value, 'Test Laptop');
  assert.equal(report.semanticCompleteness, 'NOT_VALIDATED');
});

test('deferrals and errors stop only their bundle; no skip, retry or fallback', async () => {
  const e = episode();
  e.turns = Array.from({ length: 5 }, (_, i) => ({ turnId: `m${i + 1}`, messageId: i + 1,
    role: 'USER', text: `Synthetic target ${i + 1}`, createdAt: 100 + i }));
  e.lastMessageId = 5;
  const calls = [];
  const id = input => input.bundle.anchorSpanRef.turnId;
  const report = await runFormationEpisode(e, stages({
    selectBundles: () => ({ bundles: e.turns.map(turn => ({ anchor: { turnId: turn.turnId, text: turn.text },
      evidenceTurnIds: [turn.turnId] })) }),
    assessAmbiguity: input => { calls.push(`A:${id(input)}`);
      return { disposition: id(input) === 'm1' ? 'ESCALATE' : 'CLEAR', reason: 'synthetic' }; },
    assessDurability: input => { calls.push(`D:${id(input)}`);
      return { disposition: id(input) === 'm2' ? 'NO_WRITE' : 'WRITE', reason: 'synthetic' }; },
    extractCandidate: input => {
      calls.push(`E:${id(input)}`);
      if (id(input) === 'm3') return { disposition: 'DEFERRED', reason: 'Unsupported representation' };
      if (id(input) === 'm4') throw Error('PRIVATE ERROR BODY');
      return { ...extracted(), evidenceTurnIds: ['m5'] };
    },
    prepareReview: () => { calls.push('R:m5'); return pending(); },
  }));
  assert.deepEqual(report.results.map(r => r.status),
    ['MEANING_DEFERRED', 'NO_WRITE', 'EXTRACTION_DEFERRED', 'PROCESSING_ERROR', 'REVIEW_PREPARED']);
  assert.deepEqual(calls, ['A:m1', 'A:m2', 'D:m2', 'A:m3', 'D:m3', 'E:m3',
    'A:m4', 'D:m4', 'E:m4', 'A:m5', 'D:m5', 'E:m5', 'R:m5']);
  assert.equal(report.results[3].failedStage, 'EXTRACTION');
  assert.equal(JSON.stringify(report).includes('PRIVATE ERROR BODY'), false);
  assert.equal(report.results.every(r => r.bundle.anchorSpanRef && r.bundle.evidenceSpanRefs.length), true);
});

test('malformed judgments and extraction cannot masquerade as decisions or supply source addresses', async () => {
  const invalid = [
    ['assessAmbiguity', { disposition: 'CLEAR', reason: '' }, 'AMBIGUITY'],
    ['assessAmbiguity', { disposition: 'UNKNOWN', reason: 'x' }, 'AMBIGUITY'],
    ['assessDurability', { disposition: 'WRITE', reason: 'x', approved: true }, 'DURABILITY'],
    ['extractCandidate', { disposition: 'DEFERRED', reason: 'x', candidate: {} }, 'EXTRACTION'],
    ['extractCandidate', { ...extracted(), sources: [] }, 'EXTRACTION'],
    ['extractCandidate', { ...extracted(), evidenceTurnIds: ['m3'] }, 'EXTRACTION'],
    ['extractCandidate', { ...extracted(), evidenceTurnIds: ['missing'] }, 'EXTRACTION'],
    ['extractCandidate', { ...extracted(), evidenceTurnIds: [] }, 'EXTRACTION'],
    ['extractCandidate', { ...extracted(), evidenceTurnIds: ['m1', 'm1'] }, 'EXTRACTION'],
    ['extractCandidate', { ...extracted(), payload: { value: NaN } }, 'EXTRACTION'],
    ['extractCandidate', JSON.stringify(extracted()), 'EXTRACTION'],
  ];
  for (const [name, output, stage] of invalid) {
    let reviews = 0;
    const [result] = (await runFormationEpisode(episode(), stages({ [name]: () => output,
      prepareReview: () => { reviews++; return pending(); } }))).results;
    assert.equal(result.status, 'PROCESSING_ERROR'); assert.equal(result.failedStage, stage);
    assert.equal(reviews, 0);
  }
});

test('callback failures at each stage and malformed review are sanitized, once only', async () => {
  for (const [name, stage] of [['assessAmbiguity', 'AMBIGUITY'], ['assessDurability', 'DURABILITY'],
    ['extractCandidate', 'EXTRACTION'], ['prepareReview', 'REVIEW']]) {
    let calls = 0;
    const [result] = (await runFormationEpisode(episode(), stages({ [name]: () => {
      calls++; throw Error('SECRET');
    } }))).results;
    assert.equal(calls, 1); assert.equal(result.reason, `${stage}_FAILED`);
    assert.equal(JSON.stringify(result).includes('SECRET'), false);
  }
  const [bad] = (await runFormationEpisode(episode(), stages({ prepareReview: () => ({ status: 'PENDING' }) }))).results;
  assert.equal(bad.status, 'PROCESSING_ERROR'); assert.equal(bad.failedStage, 'REVIEW');
});

test('missing adapters or invalid source fail before selection; empty discovery is not NO_WRITE', async () => {
  let calls = 0;
  await assert.rejects(runFormationEpisode(episode(), { selectBundles: () => { calls++; } }), /EXPLICIT_STAGE/);
  await assert.rejects(runFormationEpisode({}, stages({ selectBundles: () => { calls++; } })), /INVALID_SOURCE/);
  assert.equal(calls, 0);
  const report = await runFormationEpisode(episode(), stages({ selectBundles: () => ({ bundles: [] }),
    assessAmbiguity: () => { throw Error('Must not run'); } }));
  assert.deepEqual(report.results, []);
  await assert.rejects(runFormationEpisode(episode(), stages({ selectBundles: () => { throw Error('SECRET'); } })),
    { code: 'BUNDLE_SELECTOR_CALL_FAILED' });
});
