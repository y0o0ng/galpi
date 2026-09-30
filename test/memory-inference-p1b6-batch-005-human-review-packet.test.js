'use strict';

// Blind HUMAN calibration packet for batch-005 (both rows are clean agreements).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-batch-005-human-review-packet');
const review = require('../scripts/build-memory-inference-p1b6-batch-005-v3-review-packet');

const PACKET_SHA256 = '8b1a5b85102bb4167dbea954d1430d46a15de95ceb36254f82ac3dc3bcaadc08';
const ITEMS = ['p1b6-item-b005-001', 'p1b6-item-b005-002'];
const receipt = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', builder.PINNED.reviewReceipt.fixture)));

test('population is derived: 0 mandatory, both clean agreements as calibration; tampering fails closed', () => {
  assert.deepEqual(builder.derivePopulation(), { mandatory: [], calibration: ITEMS, unsampled: [] });
  const tampered = receipt();
  tampered.calibrationItemIds = [ITEMS[0]];
  assert.throws(() => builder.derivePopulation(tampered), /preregistered rule/);
});

test('packet: deterministic, sorted opaque IDs, bundles equal the strong-model packet, no leaks', () => {
  const packet = builder.buildHumanReviewPacket();
  assert.equal(sha256RawBytes(builder.packetBytes(packet)), PACKET_SHA256);
  const ids = packet.rows.map(row => row.reviewRowId);
  assert.deepEqual(ids, ids.toSorted());
  const strong = new Map(review.buildReviewPacket().rows.map(row => [row.reviewRowId, row.selectedBundle]));
  for (const itemId of ITEMS) {
    const row = packet.rows.find(r => r.reviewRowId === builder.opaqueReviewRowId(packet.sourceBatch.sha256, itemId));
    assert.equal(row.selectedBundle, strong.get(review.opaqueReviewRowId(packet.sourceBatch.sha256, itemId)));
    assert.match(row.reviewRowId, /^p1b6-b005-hreview-[0-9a-f]{16}$/u);
  }
  const text = JSON.stringify(packet.rows);
  for (const value of ['p1b6-item-', 'p1b6-sk-', 'CLEAR', 'ESCALATE', 'KEEP', 'mandatory', 'calibration', 'TRAIN']) {
    assert.equal(text.includes(value), false, value);
  }
});

test('calibration results route per the preregistered contract and never promote', () => {
  const labels = new Map(receipt().rows.map(row => [row.itemId, row.referenceLabel]));
  const sha = builder.buildHumanReviewPacket().sourceBatch.sha256;
  const bytes = answer => Buffer.from(JSON.stringify({ results: ITEMS.map(itemId => ({
    reviewRowId: builder.opaqueReviewRowId(sha, itemId), disposition: 'KEEP', decision: labels.get(itemId), reason: 'r',
    ...answer(itemId),
  })) }));
  const match = builder.buildHumanResultReceipt(bytes(() => ({})), 'd');
  assert.deepEqual(match.rows.map(row => [row.outcome, row.provenance, row.eligibility]),
    ITEMS.map(() => ['CALIBRATION_MATCH', 'CATALOG_STRONG_MODEL_CONFIRMED', 'PROVISIONAL']));
  assert.equal(match.authority.promotedToHumanAdjudicated, false);
  assert.equal(match.reviewer.independentConfirmation, false);
  const mixed = builder.buildHumanResultReceipt(bytes(id => (id === ITEMS[0] ? { disposition: 'FIX', decision: null } : {})), 'd');
  assert.deepEqual(mixed.rows.map(row => row.outcome), ['CALIBRATION_FIX', 'CALIBRATION_MATCH']);
  assert.throws(() => builder.buildHumanResultReceipt(Buffer.from(JSON.stringify({ results: [] })), 'd'), /exactly the packet rows/);
});

const os = require('node:os');
const RECEIPT = path.join(__dirname, '..', 'fixtures', builder.RECEIPT_FIXTURE);
const RAW = path.join(os.homedir(), 'p1b6-b005-human-review-results.json');

test('the committed HUMAN receipt: 2 calibration matches, ID-only submission correction, nothing promoted', () => {
  const committed = JSON.parse(fs.readFileSync(RECEIPT));
  assert.equal(committed.reviewPacket.sha256, PACKET_SHA256);
  assert.deepEqual(committed.rows.map(row => [row.itemId, row.outcome, row.eligibility]),
    ITEMS.map(itemId => [itemId, 'CALIBRATION_MATCH', 'PROVISIONAL']));
  assert.equal(committed.submissionCorrection.decisionsOrReasonsChanged, false);
  assert.deepEqual(committed.submissionCorrection.changedFields, ['reviewRowId']);
  const packetIds = new Set(builder.buildHumanReviewPacket().rows.map(row => row.reviewRowId));
  for (const { from, to } of committed.submissionCorrection.rowIds) {
    assert.equal(packetIds.has(from), false, from);
    assert.equal(packetIds.has(to), true, to);
  }
  assert.equal(committed.authority.promotedToHumanAdjudicated, false);
  assert.equal(committed.reviewer.independentConfirmation, false);
});

test('the HUMAN receipt equals the corrected raw result bytes when they are supplied', { skip: !fs.existsSync(RAW) }, () => {
  const committed = JSON.parse(fs.readFileSync(RECEIPT));
  assert.deepEqual(builder.buildHumanResultReceipt(fs.readFileSync(RAW), committed.reviewDate), committed);
});
