'use strict';

// Blind HUMAN adjudication / calibration packet for batch-004 (2 mandatory + 8 calibration).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-batch-004-human-review-packet');
const review = require('../scripts/build-memory-inference-p1b6-batch-004-v3-review-packet');

const PACKET_SHA256 = 'b1f2f4a08d0bf13dec03eea2094fdd698c0b8633fe64b0ac639fcb411bf19104';
const MANDATORY = ['p1b6-item-b004-032', 'p1b6-item-b004-037'];
const CALIBRATION = ['001', '015', '009', '040', '036', '026', '002', '006'].map(slot => `p1b6-item-b004-${slot}`);
const receiptBytes = fs.readFileSync(path.join(__dirname, '..', 'fixtures', builder.PINNED.reviewReceipt.fixture));
const reviewReceipt = () => JSON.parse(receiptBytes);

test('canonical inputs are pinned by raw SHA', () => {
  for (const pinned of Object.values(builder.PINNED)) {
    assert.equal(sha256RawBytes(fs.readFileSync(path.join(__dirname, '..', 'fixtures', pinned.fixture))), pinned.rawSha256);
  }
});

test('2 mandatory + 8 recomputed calibration = 10 disjoint rows; 30 unsampled kept apart; 008 excluded', () => {
  const { mandatory, calibration, unsampled } = builder.derivePopulation();
  assert.deepEqual(mandatory, MANDATORY);
  assert.deepEqual(calibration, CALIBRATION);
  assert.equal(new Set([...mandatory, ...calibration]).size, 10);
  assert.equal(unsampled.length, 30);
  for (const id of [...mandatory, ...calibration]) assert.equal(unsampled.includes(id), false, id);
  assert.equal([...mandatory, ...calibration, ...unsampled].includes('p1b6-item-b004-008'), false);
});

test('tampered receipt routing fails closed', () => {
  const swapped = reviewReceipt();
  swapped.calibrationItemIds = [...swapped.calibrationItemIds.slice(1), swapped.rows.find(row =>
    row.route === 'CLEAN_AGREEMENT' && !swapped.calibrationItemIds.includes(row.itemId)).itemId];
  assert.throws(() => builder.derivePopulation(swapped), /preregistered rule/);
  const extra = reviewReceipt();
  extra.rows.push({ ...extra.rows[0], itemId: 'p1b6-item-b004-008' });
  assert.throws(() => builder.derivePopulation(extra), /source-audit PASS population/);
  const overlap = reviewReceipt();
  overlap.rows.find(row => row.itemId === CALIBRATION[0]).route = 'FIX';
  assert.throws(() => builder.derivePopulation(overlap), /preregistered rule/);
});

test('packet is deterministic, sorted by opaque ID, bundles equal the strong-model packet, no leaks', () => {
  const packet = builder.buildHumanReviewPacket();
  assert.equal(sha256RawBytes(builder.packetBytes(packet)), PACKET_SHA256);
  const ids = packet.rows.map(row => row.reviewRowId);
  assert.equal(ids.length, 10);
  assert.deepEqual(ids, ids.toSorted());
  const strong = new Map(review.buildReviewPacket().rows.map(row => [row.reviewRowId, row.selectedBundle]));
  const sha = packet.sourceBatch.sha256;
  for (const itemId of [...MANDATORY, ...CALIBRATION]) {
    const row = packet.rows.find(r => r.reviewRowId === builder.opaqueReviewRowId(sha, itemId));
    assert.equal(row.selectedBundle, strong.get(review.opaqueReviewRowId(sha, itemId)));
    assert.deepEqual(Object.keys(row), ['reviewRowId', 'selectedBundle']);
    assert.match(row.reviewRowId, /^p1b6-b004-hreview-[0-9a-f]{16}$/u);
    assert.equal(row.selectedBundle.split('[TARGET]').length, 2);
  }
  // The protocol identity names the mixed packet type; no row carries its own role.
  const text = JSON.stringify(packet.rows);
  for (const value of ['p1b6-item-', 'p1b6-se-', 'p1b6-sf-', 'p1b6-sk-', 'CLEAR', 'ESCALATE', 'KEEP', 'FIX',
    'TRAIN', 'DEV', 'CANONICAL', 'ELLIPTICAL_REPLY', 'mandatory', 'calibration', 'p1b6-b004-v3smreview',
    'p1b6-b004-audit', 'RULE_RESULT', 'APPLICABILITY_STATUS', 'CATEGORY_MEMBERSHIP']) {
    assert.equal(text.includes(value), false, value);
  }
});

const labels = new Map(reviewReceipt().rows.map(row => [row.itemId, row.referenceLabel]));
const opposite = label => (label === 'CLEAR' ? 'ESCALATE' : 'CLEAR');
const results = (answer = () => ({})) => {
  const sha = builder.buildHumanReviewPacket().sourceBatch.sha256;
  return [...MANDATORY, ...CALIBRATION].map(itemId => ({
    reviewRowId: builder.opaqueReviewRowId(sha, itemId), disposition: 'KEEP', decision: labels.get(itemId), reason: 'r',
    ...answer(itemId),
  }));
};
const bytes = rows => Buffer.from(JSON.stringify({ results: rows }));

test('malformed, missing, duplicate or unknown result rows fail closed', () => {
  const rows = results();
  assert.throws(() => builder.buildHumanResultReceipt(bytes(rows.slice(1)), 'd'), /exactly the packet rows/);
  assert.throws(() => builder.buildHumanResultReceipt(bytes([...rows.slice(1), rows[1]]), 'd'), /exactly the packet rows/);
  assert.throws(() => builder.buildHumanResultReceipt(bytes([...rows.slice(1), { ...rows[0], reviewRowId: 'x' }]), 'd'),
    /exactly the packet rows/);
  for (const bad of [{ reason: '' }, { disposition: 'FIX' }, { disposition: 'KEEP', decision: null }, { extra: 1 }]) {
    assert.throws(() => builder.buildHumanResultReceipt(bytes([{ ...rows[0], ...bad }, ...rows.slice(1)]), 'd'), /malformed/);
  }
});

test('all-matching results: mandatory promoted, calibration not promoted, 30 unsampled unchanged', () => {
  const receipt = builder.buildHumanResultReceipt(bytes(results()), '2026-09-30');
  const byId = new Map(receipt.rows.map(row => [row.itemId, row]));
  for (const id of MANDATORY) {
    assert.deepEqual([byId.get(id).role, byId.get(id).outcome, byId.get(id).provenance, byId.get(id).eligibility],
      ['mandatory', 'MANDATORY_MATCH', 'HUMAN_ADJUDICATED', 'ELIGIBLE']);
  }
  for (const id of CALIBRATION) {
    assert.deepEqual([byId.get(id).role, byId.get(id).outcome, byId.get(id).provenance, byId.get(id).eligibility],
      ['calibration', 'CALIBRATION_MATCH', 'CATALOG_STRONG_MODEL_CONFIRMED', 'PROVISIONAL']);
  }
  assert.equal(receipt.summary.humanAdjudicated, 2);
  assert.equal(receipt.unsampledCleanAgreements.length, 30);
  assert.equal(receipt.unsampledCleanAgreements.every(row => row.provenance === 'CATALOG_STRONG_MODEL_CONFIRMED'
    && row.eligibility === 'PROVISIONAL' && row.calibrationExtrapolated === false), true);
  assert.deepEqual(receipt.sourceAuditExcluded, ['p1b6-item-b004-008']);
  assert.equal(receipt.reviewer.independentConfirmation, false);
  for (const key of ['catalogAmendedByThisResult', 'surfaceAcceptancePerformed', 'referenceLabelFreezePerformed',
    'finalSelectionPerformed', 'trainingOrEvaluationOccurred']) {
    assert.equal(receipt.authority[key], false, key);
  }
});

test('opposing, FIX and REJECT outcomes route per the preregistered contract', () => {
  const plan = {
    [MANDATORY[0]]: { decision: opposite(labels.get(MANDATORY[0])) },
    [MANDATORY[1]]: { disposition: 'FIX', decision: null },
    [CALIBRATION[0]]: { decision: opposite(labels.get(CALIBRATION[0])) },
    [CALIBRATION[1]]: { disposition: 'FIX', decision: null },
    [CALIBRATION[2]]: { disposition: 'REJECT', decision: null },
  };
  const receipt = builder.buildHumanResultReceipt(bytes(results(id => plan[id] ?? {})), 'd');
  const byId = new Map(receipt.rows.map(row => [row.itemId, row]));
  const expect = {
    [MANDATORY[0]]: 'MANDATORY_DECISION_MISMATCH', [MANDATORY[1]]: 'MANDATORY_FIX',
    [CALIBRATION[0]]: 'CALIBRATION_DECISION_MISMATCH', [CALIBRATION[1]]: 'CALIBRATION_FIX', [CALIBRATION[2]]: 'CALIBRATION_REJECT',
  };
  for (const [id, outcome] of Object.entries(expect)) {
    assert.equal(byId.get(id).outcome, outcome, id);
    assert.equal(byId.get(id).eligibility, 'INELIGIBLE', id);
    assert.equal(byId.get(id).provenance, null, id);
  }
  assert.equal(byId.get(MANDATORY[0]).resolutionRequired, true);
  assert.equal(builder.routeHumanResult('mandatory', 'CLEAR', { disposition: 'REJECT', decision: null }).outcome, 'MANDATORY_REJECT');
  assert.equal(receipt.authority.promotedToHumanAdjudicated, false);
  assert.equal(receipt.unsampledCleanAgreements.length, 30);
});

const os = require('node:os');
const RECEIPT = path.join(__dirname, '..', 'fixtures', builder.RECEIPT_FIXTURE);
const RAW = path.join(os.homedir(), 'p1b6-b004-human-review-results.json');

test('the committed HUMAN receipt: 032 adjudicated, 037 and 009 ineligible pending resolution, nothing accepted', () => {
  const receipt = JSON.parse(fs.readFileSync(RECEIPT));
  assert.equal(receipt.reviewPacket.sha256, PACKET_SHA256);
  assert.equal(receipt.reviewer.independentConfirmation, false);
  const outcome = Object.fromEntries(receipt.rows.map(row => [row.itemId.slice(-3), row.outcome]));
  assert.deepEqual(outcome, {
    '001': 'CALIBRATION_MATCH', '002': 'CALIBRATION_MATCH', '006': 'CALIBRATION_MATCH',
    '009': 'CALIBRATION_DECISION_MISMATCH', '015': 'CALIBRATION_MATCH', '026': 'CALIBRATION_MATCH',
    '032': 'MANDATORY_MATCH', '036': 'CALIBRATION_MATCH', '037': 'MANDATORY_DECISION_MISMATCH', '040': 'CALIBRATION_MATCH',
  });
  assert.equal(receipt.summary.humanAdjudicated, 1);
  assert.equal(receipt.unsampledCleanAgreements.length, 30);
  assert.equal(receipt.authority.surfaceAcceptancePerformed, false);
});

test('the HUMAN receipt equals the raw result bytes when they are supplied', { skip: !fs.existsSync(RAW) }, () => {
  const receipt = JSON.parse(fs.readFileSync(RECEIPT));
  assert.deepEqual(builder.buildHumanResultReceipt(fs.readFileSync(RAW), receipt.reviewDate), receipt);
});
