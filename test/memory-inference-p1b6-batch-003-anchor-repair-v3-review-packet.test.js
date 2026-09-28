'use strict';

// Blind v3 strong-model review packet for the aebbf047 anchor-repair candidates that passed audit.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-batch-003-anchor-repair-v3-review-packet');
const audit = require('../scripts/build-memory-inference-p1b6-batch-003-anchor-repair-source-audit-packet');

const PACKET_SHA256 = '5c0c5362081c7e29c62a928ed334ff4c1f862e01d4d999bd5da09307abf155e7';
const ITEMS = ['224', '225', '226', '227', '228'].map(n => `p1b6-item-b003-${n}`);
const fixture = key => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', builder.PINNED[key].fixture)));

test('the packet is deterministic and binds the reused v3 protocol', () => {
  const packet = builder.buildReviewPacket();
  assert.equal(sha256RawBytes(builder.packetBytes(packet)), PACKET_SHA256);
  assert.equal(packet.reviewProtocol.identity, 'p1b6-targeted-v3-semantic-realization-review-v1');
  assert.equal(packet.rows.length, 5);
});

test('population is the PASS rows of the audit receipt and nothing else', () => {
  assert.deepEqual(builder.derivePopulation().population.map(item => item.itemId), ITEMS);
  const receipt = fixture('auditReceipt');
  receipt.rows[0].disposition = 'FAIL';
  assert.throws(() => builder.derivePopulation(receipt), /preregistered PASS rows/);
});

test('rows are opaque, sorted, identical to the audited bundles and leak nothing', () => {
  const packet = builder.buildReviewPacket();
  const ids = packet.rows.map(row => row.reviewRowId);
  assert.deepEqual(ids, ids.toSorted());
  const audited = new Set(audit.buildSourceAuditPacket(audit.loadCanonicalInputs()).rows.map(row => row.selectedBundle));
  for (const row of packet.rows) {
    assert.deepEqual(Object.keys(row), ['reviewRowId', 'selectedBundle']);
    assert.match(row.reviewRowId, /^p1b6-b003-anchor-v3smreview-[0-9a-f]{16}$/u);
    assert.equal(audited.has(row.selectedBundle), true);
  }
  const text = JSON.stringify(packet);
  for (const value of ['p1b6-item-', 'p1b6-sk-', 'aebbf047', 'CLEAR', 'ESCALATE', 'PASS', 'DEV',
    'REANCHOR', 'calibration', 'plan']) {
    assert.equal(text.includes(value), false, value);
  }
});

test('the internal plan samples at most one calibration row on the single skeleton', () => {
  const plan = fixture('plan');
  assert.equal(plan.visibility, 'REPOSITORY_INTERNAL_NEVER_SHOWN_TO_THE_STRONG_MODEL_REVIEWER');
  assert.deepEqual(plan.population.expectedItemIds, ITEMS);
  assert.equal(plan.routing.calibration.hashDomain, 'p1b6-b003-anchor-v3-review-calibration-v1');
  const synthetic = Buffer.from(JSON.stringify({ results: builder.buildReviewPacket().rows.map(row => ({
    reviewRowId: row.reviewRowId, disposition: 'KEEP', decision: 'CLEAR', reason: 'r',
  })) }));
  const receipt = builder.reconcile(synthetic);
  assert.deepEqual(receipt.summary, { total: 5, cleanAgreements: 5, mandatoryHuman: 0, calibration: 1 });
  for (const [key, value] of Object.entries(plan.authority)) assert.equal(value, false, key);
});

const os = require('node:os');
const RAW = path.join(os.homedir(), 'p1b6-b003-anchor-v3-review-results.json');
const RECEIPT = path.join(__dirname, '..', 'fixtures', builder.RECEIPT_FIXTURE);

test('the committed review receipt: 4 mandatory disagreements, 1 calibration agreement', () => {
  const receipt = JSON.parse(fs.readFileSync(RECEIPT));
  assert.equal(receipt.reviewPacket.sha256, PACKET_SHA256);
  assert.deepEqual(receipt.summary, { total: 5, cleanAgreements: 1, mandatoryHuman: 4, calibration: 1 });
  assert.deepEqual(receipt.mandatoryHumanItemIds, ITEMS.slice(0, 4));
  assert.deepEqual(receipt.calibrationItemIds, [ITEMS[4]]);
  for (const row of receipt.rows) assert.equal(row.referenceLabel, 'CLEAR');
  assert.equal(receipt.rows.filter(row => row.route === 'DECISION_DISAGREEMENT').every(row => row.decision === 'ESCALATE'), true);
  assert.equal(receipt.rawResultArtifact.committed, false);
  for (const [key, value] of Object.entries(receipt.authority)) assert.equal(value, false, key);
});

test('the review receipt equals the raw result bytes when they are supplied', { skip: !fs.existsSync(RAW) }, () => {
  assert.deepEqual(builder.reconcile(fs.readFileSync(RAW)), JSON.parse(fs.readFileSync(RECEIPT)));
});
