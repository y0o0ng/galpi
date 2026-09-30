'use strict';

// Blind v3 strong-model review packet for the 40 batch-004 rows that passed the source audit.

const test = require('node:test');
const assert = require('node:assert/strict');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-batch-004-v3-review-packet');

const PACKET_SHA256 = '95df87e3137adee24b7ab805636e0e30794880cbced7f63afbc5feb3f54d0cbb';

test('the packet is deterministic, 40 sorted opaque rows, audit PASS rows only', () => {
  const packet = builder.buildReviewPacket();
  assert.equal(sha256RawBytes(builder.packetBytes(packet)), PACKET_SHA256);
  assert.equal(packet.rows.length, 40);
  assert.equal(builder.EXPECTED_ITEM_IDS.includes('p1b6-item-b004-008'), false);
  const ids = packet.rows.map(row => row.reviewRowId);
  assert.deepEqual(ids, ids.toSorted());
  for (const row of packet.rows) {
    assert.deepEqual(Object.keys(row), ['reviewRowId', 'selectedBundle']);
    assert.match(row.reviewRowId, /^p1b6-b004-v3smreview-[0-9a-f]{16}$/u);
    assert.equal(row.selectedBundle.split('[TARGET]').length, 2);
  }
});

test('the packet leaks no identity, skeleton, split, pattern, label or role', () => {
  const text = JSON.stringify(builder.buildReviewPacket());
  for (const value of ['p1b6-item-', 'p1b6-se-', 'p1b6-sf-', 'p1b6-sk-', 'semanticSkeletonId', 'CLEAR', 'ESCALATE',
    'TRAIN', 'DEV', 'CANONICAL', 'ELLIPTICAL_REPLY', 'RULE_RESULT', 'APPLICABILITY_STATUS', 'CATEGORY_MEMBERSHIP',
    'sourceEpisode', 'p1b6-b004-audit']) {
    assert.equal(text.includes(value), false, value);
  }
});

const synthetic = mutate => {
  const { population } = builder.derivePopulation();
  const labels = new Map(require('../fixtures/local-memory-inference-p1b6-skeleton-effective-current-v3.json')
    .candidates.map(row => [row.semanticSkeletonId, row.humanLabel]));
  const sha = require('../scripts/build-memory-inference-p1b6-batch-004-source-audit-packet').CANONICAL_INPUTS.batch.rawSha256;
  const results = population.map(item => ({ reviewRowId: builder.opaqueReviewRowId(sha, item.itemId),
    disposition: 'KEEP', decision: labels.get(item.semanticSkeletonId), reason: 'r', itemId: item.itemId }));
  mutate(results);
  return Buffer.from(JSON.stringify({ results: results.map(({ itemId, ...row }) => row) }));
};

test('reconciliation routes per the preregistered gates and samples 8 calibration rows', () => {
  const clean = builder.reconcile(synthetic(() => {}));
  assert.deepEqual(clean.summary, { total: 40, cleanAgreements: 40, mandatoryHuman: 0, calibration: 8 });
  const expected = builder.EXPECTED_ITEM_IDS
    .toSorted((a, b) => (builder.calibrationHash('p1b6-b004-v3-review-calibration-v1', a)
      < builder.calibrationHash('p1b6-b004-v3-review-calibration-v1', b) ? -1 : 1)).slice(0, 8);
  assert.deepEqual(clean.calibrationItemIds, expected);
  const routed = builder.reconcile(synthetic(rows => {
    rows[0].decision = rows[0].decision === 'CLEAR' ? 'ESCALATE' : 'CLEAR';
    Object.assign(rows[1], { disposition: 'FIX', decision: null });
    rows[2].reason = '';
  }));
  assert.equal(routed.summary.mandatoryHuman, 3);
  assert.deepEqual(routed.rows.slice(0, 3).map(row => row.route), ['DECISION_DISAGREEMENT', 'FIX', 'MISSING_OR_INVALID_RESULT']);
  assert.equal(routed.calibrationItemIds.some(id => routed.mandatoryHumanItemIds.includes(id)), false);
  assert.throws(() => builder.reconcile(Buffer.from(JSON.stringify({ results: [{ reviewRowId: 'x' }] }))), /not a packet row/);
});

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const RECEIPT = path.join(__dirname, '..', 'fixtures', builder.RECEIPT_FIXTURE);
const RAW = path.join(os.homedir(), 'p1b6-b004-v3-review-results.json');

test('the committed receipt routes 032 and 037 to HUMAN and opens no HUMAN gate', () => {
  const receipt = JSON.parse(fs.readFileSync(RECEIPT));
  assert.equal(receipt.reviewPacket.sha256, PACKET_SHA256);
  assert.deepEqual(receipt.summary, { total: 40, cleanAgreements: 38, mandatoryHuman: 2, calibration: 8 });
  assert.deepEqual(receipt.mandatoryHumanItemIds, ['p1b6-item-b004-032', 'p1b6-item-b004-037']);
  assert.equal(receipt.rawResultArtifact.committed, false);
  for (const [key, value] of Object.entries(receipt.authority)) assert.equal(value, false, key);
});

test('the receipt equals the reconciled raw result bytes when they are supplied', { skip: !fs.existsSync(RAW) }, () => {
  assert.deepEqual(builder.reconcile(fs.readFileSync(RAW)), JSON.parse(fs.readFileSync(RECEIPT)));
});
