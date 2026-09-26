'use strict';

// TARGET-boundary realization failure on 2da4e54e / 5269c91f: all 16 batch-003 realizations
// current-ineligible in a new layer, the realization invariant, and fresh candidates under new
// IDs. Historical artifacts, v3 and the accepted pool stay as they are.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-batch-003-target-boundary-resolution');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, 'fixtures', file));
const artifacts = () => builder.verifySources(builder.loadSources());
const receipt = JSON.parse(read(builder.RECEIPT_FILE));
const candidate = JSON.parse(read(builder.CANDIDATE_FILE));
const item = number => `p1b6-item-b003-${number}`;
const SK_A = 'p1b6-sk-2da4e54e6609e34b';
const SK_B = 'p1b6-sk-5269c91fcfb6c2cd';
const EXPECTED = [...Array.from({ length: 12 }, (_, i) => String(71 + i).padStart(3, '0')),
  '142', '143', '144', '145'].map(item);

test('committed artifacts are exactly what the builder produces', () => {
  const current = artifacts();
  assert.deepEqual(builder.artifactBytes(builder.buildReceipt(current)), read(builder.RECEIPT_FILE));
  assert.deepEqual(builder.artifactBytes(builder.buildCandidate(current)), read(builder.CANDIDATE_FILE));
});

test('exactly 16 rows, 12 + 4, are derived from the two skeletons and nothing else', () => {
  const current = artifacts();
  assert.deepEqual(builder.deriveAffected(current), EXPECTED);
  assert.deepEqual(receipt.rows.map(row => row.itemId), EXPECTED);
  assert.equal(receipt.rows.filter(row => row.semanticSkeletonId === SK_A).length, 12);
  assert.equal(receipt.rows.filter(row => row.semanticSkeletonId === SK_B).length, 4);
  for (const row of receipt.rows) {
    assert.equal(current.batch.items.find(entry => entry.itemId === row.itemId).semanticSkeletonId,
      row.semanticSkeletonId);
  }
  // A b8e64a03 correction row and every other batch-003 row stay outside this layer.
  assert.equal(receipt.rows.some(row => row.itemId === item('231')), false);
  const others = current.batch.items.filter(row => ![SK_A, SK_B].includes(row.semanticSkeletonId));
  assert.equal(others.length, current.batch.items.length - 16);
});

test('all 16 are current-ineligible and prior provisional agreements are withdrawn', () => {
  for (const row of receipt.rows) {
    assert.equal(row.resolution, 'TARGET_BOUNDARY_REALIZATION_FAILURE');
    assert.equal(row.currentEligibility, 'INELIGIBLE');
  }
  const current = artifacts();
  const provisional = current.targetedStrongModel.agreementItemIds.filter(id => EXPECTED.includes(id));
  assert.deepEqual(provisional, ['071', '073', '074', '076', '078', '079', '081', '144'].map(item));
  for (const id of provisional) {
    const row = receipt.rows.find(entry => entry.itemId === id);
    assert.equal(row.currentEligibility, 'INELIGIBLE', id);
  }
  assert.equal(receipt.summary.priorProvisionalWithdrawn, 6);
  // No HUMAN_ADJUDICATED from any authority survives on these rows.
  assert.equal(receipt.rows.some(row => row.priorCurrentStatus.provenance === 'HUMAN_ADJUDICATED'), false);
});

test('072, 142, 145 stay recorded as semantic-contract corrections but are no longer valid', () => {
  const current = artifacts();
  for (const id of ['072', '142', '145'].map(item)) {
    const historical = current.resolution.decisions.find(row => row.itemId === id);
    assert.equal(historical.resolution, 'SEMANTIC_CONTRACT_CORRECTION');
    const row = receipt.rows.find(entry => entry.itemId === id);
    assert.equal(row.priorCurrentStatus.resolution, 'SEMANTIC_CONTRACT_CORRECTION');
    assert.equal(row.currentEligibility, 'INELIGIBLE');
  }
});

test('historical artifacts, v3 and the accepted pool are unchanged; skeletons stay active', () => {
  for (const pinned of Object.values(builder.SOURCES)) {
    assert.equal(sha256RawBytes(read(pinned.fixture)), pinned.rawSha256, pinned.fixture);
  }
  const current = artifacts();
  const retired = current.v3.retiredSkeletons.map(row => row.retiredSkeletonId);
  for (const id of [SK_A, SK_B]) {
    assert.equal(retired.includes(id), false);
    assert.equal(current.v3.candidates.find(row => row.semanticSkeletonId === id).humanLabel, 'ESCALATE');
  }
  assert.equal(receipt.acceptedPool.cumulativeAcceptedSurfacePool, 93);
  assert.equal(current.acceptance.corpusGrowth.cumulativeAcceptedSurfacePool, 93);
  for (const [key, value] of Object.entries(receipt.authority)) assert.equal(value, false, key);
});

test('a retired or relabelled skeleton, or a drifted source, fails closed', () => {
  const current = artifacts();
  const retiredOne = structuredClone(current);
  retiredOne.v3.retiredSkeletons.push({ retiredSkeletonId: SK_A });
  assert.throws(() => builder.deriveAffected(retiredOne), /not an active v3 ESCALATE/);
  const relabelled = structuredClone(current);
  relabelled.v3.candidates.find(row => row.semanticSkeletonId === SK_B).humanLabel = 'CLEAR';
  assert.throws(() => builder.deriveAffected(relabelled), /not an active v3 ESCALATE/);
  const raw = builder.loadSources();
  assert.throws(() => builder.verifySources({ ...raw, batch: Buffer.concat([raw.batch, Buffer.from(' ')]) }),
    /not the pinned artifact/);
});

test('fresh realizations use new IDs and inherit no review provenance', () => {
  const current = artifacts();
  assert.deepEqual(candidate.items.map(row => row.semanticSkeletonId), [SK_A, SK_B]);
  const historical = new Set(current.batch.items.map(row => row.itemId));
  for (const row of candidate.items) {
    assert.match(row.itemId, /^p1b6-item-tb1-\d{3}$/u);
    assert.equal(historical.has(row.itemId), false);
    for (const key of ['provenance', 'humanDecision', 'referenceLabel', 'eligibility', 'disposition']) {
      assert.equal(Object.hasOwn(row, key), false, key);
    }
  }
  for (const [key, value] of Object.entries(candidate.authority)) assert.equal(value, false, key);
  assert.deepEqual(candidate.pending,
    { freshSourceAudit: true, freshV3SemanticReview: true, humanAdjudicationWhereRouted: true });
});

test('the invariant rejects a TARGET on a supporting fact and accepts a status TARGET', () => {
  const base = candidate.items[0];
  for (const role of ['SUPPORTING_FACT', 'IDENTITY', 'DATE', 'ACTION', 'PROPERTY', undefined]) {
    assert.throws(() => builder.checkTargetBoundaryRealization({ ...base, targetAnchorRole: role }),
      /TARGET must denote/, String(role));
  }
  for (const role of ['APPLICABILITY_STATUS', 'CATEGORY_MEMBERSHIP', 'RULE_RESULT']) {
    assert.doesNotThrow(() => builder.checkTargetBoundaryRealization({ ...base, targetAnchorRole: role }));
  }
  // Scoped: other skeletons are not governed by this invariant.
  assert.doesNotThrow(() => builder.checkTargetBoundaryRealization(
    { ...base, semanticSkeletonId: 'p1b6-sk-b8e64a03d97f251c', targetAnchorRole: 'SUPPORTING_FACT' }));
  const bad = structuredClone(builder.AUTHORED);
  bad[1].targetAnchorRole = 'SUPPORTING_FACT';
  assert.throws(() => builder.buildCandidate(artifacts(), bad), /TARGET must denote/);
});

test('fresh candidates pass leakage and sit in their skeleton split', () => {
  const current = artifacts();
  const reused = structuredClone(builder.AUTHORED);
  reused[0].turns[0][1] = current.batch.sourceEpisodes
    .flatMap(row => row.turns).find(turn => turn.text.length > 20).text;
  assert.throws(() => builder.buildCandidate(current, reused), /reused/);
  const splits = new Map(current.v3.candidates.map(row => [row.semanticSkeletonId, row.splitAssignment]));
  for (const row of candidate.items) {
    const episode = candidate.sourceEpisodes.find(entry => entry.sourceEpisodeId === row.sourceEpisodeId);
    assert.equal(episode.splitAssignment, splits.get(row.semanticSkeletonId));
  }
});

test('tb1-002 readings are alternative actual membership states, not hard feature criteria', () => {
  const row = candidate.items.find(entry => entry.itemId === 'p1b6-item-tb1-002');
  const [member, nonMember] = row.intendedUnresolvedReadings;
  assert.match(member, /in fact classified as a premium member/);
  assert.match(nonMember, /in fact not classified as a premium member/);
  for (const reading of row.intendedUnresolvedReadings) {
    assert.match(reading, /typical-feature description does not settle it/);
    // `보통` features must not become a deterministic membership rule.
    assert.doesNotMatch(reading, /spending|threshold|review|makes the user|keep the user/i);
  }
  // Only the readings changed: text, TARGET, IDs and split are the authored ones.
  const episode = candidate.sourceEpisodes.find(entry => entry.sourceEpisodeId === row.sourceEpisodeId);
  assert.equal(row.anchorText, '우수 회원에 들어가는지');
  assert.equal(episode.sourceEpisodeId, 'p1b6-se-tb1-002');
  assert.equal(episode.splitAssignment, 'DEV');
  assert.equal(episode.turns[3].text, '내가 우수 회원에 들어가는지 서점에 물어봐야겠어.');
});
