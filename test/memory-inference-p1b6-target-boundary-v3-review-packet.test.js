'use strict';

// Blind v3 strong-model review packet for the TARGET-boundary candidates that passed audit.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-target-boundary-v3-review-packet');
const audit = require('../scripts/build-memory-inference-p1b6-target-boundary-source-audit-packet');

const PACKET_SHA256 = 'b1644cc6f1db1419c86058fb667d0f5591b7b2668381593d5cf94720f3412872';
const fixture = key => JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'fixtures', builder.PINNED[key].fixture)));

test('the packet is deterministic and binds the reused v3 protocol', () => {
  const packet = builder.buildReviewPacket();
  assert.equal(sha256RawBytes(builder.packetBytes(packet)), PACKET_SHA256);
  assert.equal(packet.reviewProtocol.identity, 'p1b6-targeted-v3-semantic-realization-review-v1');
  assert.equal(packet.reviewProtocol.sha256, builder.PINNED.protocol.rawSha256);
});

test('population is the PASS rows of the audit receipt and nothing else', () => {
  const { population } = builder.derivePopulation();
  assert.deepEqual(population.map(item => item.itemId), ['p1b6-item-tb1-001', 'p1b6-item-tb1-002']);
  const receipt = fixture('auditReceipt');
  receipt.rows[0].disposition = 'FAIL';
  assert.throws(() => builder.derivePopulation(receipt), /preregistered PASS rows/);
  const drifted = fixture('auditReceipt');
  drifted.auditPacketSha256 = 'a'.repeat(64);
  assert.throws(() => builder.derivePopulation(drifted), /does not bind/);
});

test('rows are opaque, sorted, identical to the audited bundles and leak nothing', () => {
  const packet = builder.buildReviewPacket();
  const ids = packet.rows.map(row => row.reviewRowId);
  assert.deepEqual(ids, ids.toSorted());
  const audited = new Set(audit.buildSourceAuditPacket(audit.loadCanonicalInputs()).rows.map(row => row.selectedBundle));
  for (const row of packet.rows) {
    assert.deepEqual(Object.keys(row), ['reviewRowId', 'selectedBundle']);
    assert.match(row.reviewRowId, /^p1b6-tb1-v3smreview-[0-9a-f]{16}$/u);
    assert.equal(audited.has(row.selectedBundle), true);
  }
  const text = JSON.stringify(packet);
  for (const value of ['p1b6-item-', 'p1b6-sk-', 'targetAnchorRole', 'RULE_RESULT', 'CATEGORY_MEMBERSHIP',
    'intendedUnresolvedReadings', 'CLEAR', 'ESCALATE', 'PASS', 'TRAIN', 'DEV', 'calibration', 'plan']) {
    assert.equal(text.includes(value), false, value);
  }
});

test('the internal plan preregisters routing and opens no gate', () => {
  const plan = fixture('plan');
  assert.equal(plan.visibility, 'REPOSITORY_INTERNAL_NEVER_SHOWN_TO_THE_STRONG_MODEL_REVIEWER');
  assert.equal(plan.reviewProtocol.rawSha256, builder.PINNED.protocol.rawSha256);
  assert.equal(plan.routing.cleanAgreement.createsHumanGold, false);
  assert.equal(plan.routing.calibration.substituteAcrossSkeletons, false);
  for (const [key, value] of Object.entries(plan.authority)) assert.equal(value, false, key);
});

const os = require('node:os');
const RAW = path.join(os.homedir(), 'p1b6-tb1-v3-review-results.json');
const synthetic = mutate => {
  const results = builder.buildReviewPacket().rows.map(row => ({
    reviewRowId: row.reviewRowId, disposition: 'KEEP', decision: 'ESCALATE', reason: 'r',
  }));
  mutate(results);
  return Buffer.from(JSON.stringify({ results }));
};

test('reconciliation routes as preregistered', () => {
  const clean = builder.reconcile(synthetic(() => {}));
  assert.deepEqual(clean.summary, { total: 2, cleanAgreements: 2, mandatoryHuman: 0, calibration: 2 });
  const mixed = builder.reconcile(synthetic(rows => {
    rows[0].decision = 'CLEAR';
    rows[1] = { ...rows[1], disposition: 'FIX', decision: null };
  }));
  assert.equal(mixed.summary.mandatoryHuman, 2);
  assert.deepEqual(mixed.calibrationItemIds, []);
  assert.equal(mixed.rows.some(row => row.eligibility === 'PROVISIONAL'), false);
  const missing = builder.reconcile(synthetic(rows => rows.pop()));
  assert.equal(missing.rows.filter(row => row.route === 'MISSING_OR_INVALID_RESULT').length, 1);
  assert.throws(() => builder.reconcile(synthetic(rows => rows.push({ ...rows[0] }))), /duplicates/);
  assert.throws(() => builder.reconcile(synthetic(rows => { rows[0].reviewRowId = 'x'; })), /not a packet row/);
});

test('the committed review receipt: 2 clean agreements, both calibration, no HUMAN gold', () => {
  const receipt = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', builder.RECEIPT_FIXTURE)));
  assert.equal(receipt.reviewPacket.sha256, PACKET_SHA256);
  assert.deepEqual(receipt.calibrationItemIds, ['p1b6-item-tb1-001', 'p1b6-item-tb1-002']);
  assert.deepEqual(receipt.mandatoryHumanItemIds, []);
  assert.equal(receipt.rawResultArtifact.committed, false);
  for (const row of receipt.rows) assert.equal(row.provenance, 'CATALOG_STRONG_MODEL_CONFIRMED');
  for (const [key, value] of Object.entries(receipt.authority)) assert.equal(value, false, key);
});

test('the review receipt equals the raw result bytes when they are supplied', { skip: !fs.existsSync(RAW) }, () => {
  assert.deepEqual(builder.reconcile(fs.readFileSync(RAW)),
    JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', builder.RECEIPT_FIXTURE))));
});
