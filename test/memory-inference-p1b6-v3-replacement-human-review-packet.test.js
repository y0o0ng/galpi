'use strict';

// Blind 2-row HUMAN packet for the v3 replacement candidates.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-v3-replacement-human-review-packet');
const review = require('../scripts/build-memory-inference-p1b6-v3-replacement-v3-review-packet');

const PACKET_SHA256 = '1d02df06cf983f6999ccbd0086705f5e480d19c9765067465983edc2cb6a7e3e';
const receipt = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', builder.PINNED.reviewReceipt.fixture)));

test('population is the receipt mandatory + calibration rows; drift fails closed', () => {
  assert.deepEqual(builder.derivePopulation(), ['p1b6-item-rp1-001', 'p1b6-item-rp1-002']);
  const moved = receipt();
  moved.calibrationItemIds = ['p1b6-item-rp1-001'];
  assert.throws(() => builder.derivePopulation(moved), /preregistered plan/);
});

test('the packet is deterministic, opaque, sorted, and reuses the reviewed bundles', () => {
  const packet = builder.buildHumanReviewPacket();
  assert.equal(sha256RawBytes(builder.packetBytes(packet)), PACKET_SHA256);
  const ids = packet.rows.map(row => row.reviewRowId);
  assert.deepEqual(ids, ids.toSorted());
  const reviewed = new Set(review.buildReviewPacket().rows.map(row => row.selectedBundle));
  for (const row of packet.rows) {
    assert.deepEqual(Object.keys(row), ['reviewRowId', 'selectedBundle']);
    assert.match(row.reviewRowId, /^p1b6-rp1-hreview-[0-9a-f]{16}$/u);
    assert.equal(reviewed.has(row.selectedBundle), true);
  }
  const text = JSON.stringify(packet);
  for (const value of ['p1b6-item-', 'p1b6-sk-', 'intendedUnresolvedReadings', 'CLEAR', 'ESCALATE', 'KEEP',
    'calibration', 'mandatory', 'v3smreview', 'reference']) {
    assert.equal(text.includes(value), false, value);
  }
});

test('the protocol carries v3 and records the reviewer limitation', () => {
  const protocol = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', builder.PINNED.protocol.fixture)));
  const v3 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures',
    'local-memory-inference-p1b6-skeleton-effective-current-v3.json')));
  for (const key of ['clear', 'escalate', 'uncertaintyDistinction', 'targetBoundary', 'pragmaticResolution']) {
    assert.equal(protocol.question[key], v3.interpretationRule[key], key);
  }
  assert.equal(protocol.population.rows, 2);
  assert.equal(protocol.reviewer.knowsStrongModelResult, true);
  assert.match(protocol.reviewer.independenceNote, /not an independent confirmation/);
});

const os = require('node:os');
const RAW = path.join(os.homedir(), 'p1b6-rp1-human-review-results.json');
const ORIGINAL = path.join(os.homedir(), 'p1b6-rp1-human-review-results.original.json');
const HUMAN_RECEIPT = path.join(__dirname, '..', 'fixtures', builder.RECEIPT_FIXTURE);
const synthetic = mutate => {
  const results = builder.buildHumanReviewPacket().rows.map(row => ({
    reviewRowId: row.reviewRowId, disposition: 'KEEP', decision: 'ESCALATE', reason: 'r',
  }));
  mutate(results);
  return Buffer.from(JSON.stringify({ results }));
};

test('HUMAN calibration rows are never promoted; unknown row IDs fail closed', () => {
  for (const row of builder.buildHumanResultReceipt(synthetic(() => {}), '2026-09-28').rows) {
    assert.equal(row.role, 'calibration');
    assert.equal(row.provenance, 'CATALOG_STRONG_MODEL_CONFIRMED');
  }
  const opposing = builder.buildHumanResultReceipt(synthetic(rows => { rows[0].decision = 'CLEAR'; }), 'd');
  assert.equal(opposing.rows.some(row => row.eligibility === 'INELIGIBLE_PENDING_RESOLUTION'), true);
  assert.throws(() => builder.buildHumanResultReceipt(synthetic(rows => {
    rows[1].reviewRowId = builder.SUBMISSION_CORRECTION.rowIdFrom;
  }), 'd'), /exactly the packet rows/);
});

test('the committed HUMAN receipt: 2 KEEP ESCALATE, provisional, correction recorded', () => {
  const receipt = JSON.parse(fs.readFileSync(HUMAN_RECEIPT));
  assert.equal(receipt.reviewPacket.sha256, PACKET_SHA256);
  assert.equal(receipt.reviewDate, '2026-09-28');
  assert.deepEqual(receipt.summary, { total: 2, matchingV3Reference: 2, humanAdjudicated: 0 });
  for (const row of receipt.rows) assert.equal(row.eligibility, 'PROVISIONAL');
  assert.equal(receipt.reviewer.independentConfirmation, false);
  assert.deepEqual(receipt.submissionCorrection.changedFields, ['reviewRowId']);
  assert.equal(receipt.submissionCorrection.decisionsOrReasonsChanged, false);
  assert.equal(receipt.submissionCorrection.rowIdTo,
    builder.buildHumanReviewPacket().rows.find(row => row.reviewRowId !== 'p1b6-rp1-hreview-1d3479569880603e').reviewRowId);
  for (const [key, value] of Object.entries(receipt.authority)) assert.equal(value, false, key);
});

test('the HUMAN receipt equals the corrected raw bytes, which differ from the original only in the row ID',
  { skip: !fs.existsSync(RAW) || !fs.existsSync(ORIGINAL) }, () => {
    const committed = JSON.parse(fs.readFileSync(HUMAN_RECEIPT));
    assert.deepEqual(builder.buildHumanResultReceipt(fs.readFileSync(RAW), committed.reviewDate), committed);
    const original = fs.readFileSync(ORIGINAL);
    assert.equal(sha256RawBytes(original), builder.SUBMISSION_CORRECTION.originalSubmission.sha256);
    assert.equal(original.toString('utf8').replace(builder.SUBMISSION_CORRECTION.rowIdFrom,
      builder.SUBMISSION_CORRECTION.rowIdTo), fs.readFileSync(RAW, 'utf8'));
  });
