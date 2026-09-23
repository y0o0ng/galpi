'use strict';

// Reconciliation of the targeted v3 strong-model review. Raw result bytes are not committed, so
// routing is pinned with synthetic results and the committed receipt is checked for consistency.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-batch-003-targeted-v3-strong-model-review-packet');
const reconcile = require('../scripts/reconcile-memory-inference-p1b6-batch-003-targeted-v3-strong-model-review');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file));
const PLAN = read('fixtures/local-memory-inference-p1b6-batch-003-v3-rereconciliation-plan.json');
const RECEIPT = 'fixtures/local-memory-inference-p1b6-targeted-v3-strong-model-review-batch-003-attempt-001.json';
const inputs = () => builder.loadCanonicalInputs();
const references = reconcile.canonicalReferences(inputs());
const agreeing = () => references.map(row => ({
  reviewRowId: row.reviewRowId, disposition: 'KEEP', decision: row.referenceLabel, reason: 'r',
}));
const bytes = results => Buffer.from(JSON.stringify({ results }));

test('references are the 24 packet rows, all v3 ESCALATE', () => {
  assert.equal(references.length, 24);
  assert.equal(references.every(row => row.referenceLabel === 'ESCALATE'), true);
});

test('routing follows the preregistered plan', () => {
  const rows = agreeing();
  rows[0].decision = 'CLEAR';
  rows[1] = { ...rows[1], disposition: 'FIX', decision: null };
  rows[2] = { ...rows[2], disposition: 'REJECT', decision: null };
  rows[3] = { ...rows[3], disposition: 'FIX', decision: 'ESCALATE' };
  rows.splice(4, 1);
  const { agreements, humanAdjudication } = reconcile.reconcileTargetedV3(inputs(), rows);
  assert.equal(agreements.length, 19);
  assert.deepEqual(humanAdjudication.map(row => row.route).toSorted(), [
    'DECISION_DISAGREEMENT', 'FIX', 'MISSING_OR_INVALID_RESULT', 'MISSING_OR_INVALID_RESULT', 'REJECT',
  ]);
  for (const row of agreements) {
    assert.equal(row.provenance, 'CATALOG_STRONG_MODEL_CONFIRMED');
    assert.equal(row.eligibility, 'PROVISIONAL');
  }
});

test('unknown or duplicate rows fail the whole artifact', () => {
  assert.throws(() => reconcile.reconcileTargetedV3(inputs(),
    [...agreeing(), { ...agreeing()[0], reviewRowId: 'p1b6-v3smreview-0000000000000000' }]), /not a known/);
  assert.throws(() => reconcile.reconcileTargetedV3(inputs(), [...agreeing(), agreeing()[0]]), /duplicates/);
  assert.throws(() => reconcile.buildReceipt(inputs(), Buffer.from('{"results":[],"x":1}'), PLAN), /only key/);
  assert.throws(() => reconcile.buildReceipt(inputs(), bytes(agreeing()), Buffer.from('{}')), /preregistered plan/);
});

test('calibration draws one lowest-hash agreement per skeleton, never from HUMAN rows', () => {
  const { calibration } = reconcile.reconcileTargetedV3(inputs(), agreeing());
  assert.equal(calibration.length, 3);
  for (const pick of calibration) {
    const pool = references.filter(row => row.semanticSkeletonId === pick.semanticSkeletonId)
      .map(row => reconcile.calibrationHash(row.itemId));
    assert.equal(reconcile.calibrationHash(pick.itemId), pool.toSorted()[0]);
  }
  // A skeleton with no agreement contributes nothing and is not substituted.
  const rows = agreeing().map((row, index) => (references[index].semanticSkeletonId
    === 'p1b6-sk-5269c91fcfb6c2cd' ? { ...row, decision: 'CLEAR' } : row));
  const result = reconcile.reconcileTargetedV3(inputs(), rows);
  assert.equal(result.calibration.length, 2);
  const human = new Set(result.humanAdjudication.map(row => row.itemId));
  assert.equal(result.calibration.some(row => human.has(row.itemId)), false);
});

test('the committed receipt is internally consistent and opens no gate', () => {
  const receipt = JSON.parse(read(RECEIPT));
  assert.equal(receipt.attemptId, reconcile.ATTEMPT_ID);
  assert.equal(receipt.status, 'COMPLETE_RECONCILED_AGAINST_SEMANTIC_CONTRACT_V3');
  // The packet is gitignored, so compare against the deterministic rebuild, not the file.
  assert.equal(receipt.reviewPacket.sha256,
    sha256RawBytes(builder.packetBytes(builder.buildTargetedReviewPacket(inputs()))));
  assert.equal(receipt.rereconciliationPlan.rawSha256, sha256RawBytes(PLAN));
  assert.equal(receipt.referenceAuthority.rawSha256, builder.CANONICAL_INPUTS.v3Catalog.rawSha256);
  assert.equal(receipt.rawResultArtifact.committed, false);
  assert.match(receipt.rawResultArtifact.sha256, /^[0-9a-f]{64}$/u);
  assert.equal(receipt.reviewerExecutionProvenance.evidenceBasis, 'REPORTED_BY_REPOSITORY_OWNER');

  const ids = [...receipt.agreementItemIds, ...receipt.mandatoryHumanRows.map(row => row.itemId)];
  assert.deepEqual(ids.toSorted(), references.map(row => row.itemId).toSorted());
  assert.equal(receipt.reconciliation.agreements, receipt.agreementItemIds.length);
  assert.equal(receipt.reconciliation.humanAdjudicationRouted, receipt.mandatoryHumanRows.length);
  for (const pick of receipt.calibrationRows) {
    assert.equal(receipt.agreementItemIds.includes(pick.itemId), true, pick.itemId);
    const pool = receipt.agreementItemIds.filter(id => references.find(row => row.itemId === id)
      .semanticSkeletonId === pick.semanticSkeletonId);
    assert.equal(pick.agreementPool, pool.length);
    assert.equal(reconcile.calibrationHash(pick.itemId), pool.map(reconcile.calibrationHash).toSorted()[0]);
  }
  for (const [key, value] of Object.entries(receipt.authority)) assert.equal(value, false, key);
});
