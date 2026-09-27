'use strict';

// Blind v3 strong-model review packet for the v3 replacement candidates that passed audit.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-v3-replacement-v3-review-packet');
const audit = require('../scripts/build-memory-inference-p1b6-v3-replacement-source-audit-packet');

const PACKET_SHA256 = 'b32aabeeeeb6c06c7ddd4e39110dc864eeb63ccd2fa76cc3ec7fe4427b3d1776';
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
  assert.deepEqual(population.map(item => item.itemId), ['p1b6-item-rp1-001', 'p1b6-item-rp1-002']);
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
    assert.match(row.reviewRowId, /^p1b6-rp1-v3smreview-[0-9a-f]{16}$/u);
    assert.equal(audited.has(row.selectedBundle), true);
  }
  const text = JSON.stringify(packet);
  for (const value of ['p1b6-item-', 'p1b6-sk-', 'intendedUnresolvedReadings', '작업량이 약 절반', '가로 차이가',
    'CLEAR', 'ESCALATE', 'PASS', 'TRAIN', 'APPROXIMATION', 'calibration', 'plan']) {
    assert.equal(text.includes(value), false, value);
  }
});

test('the internal plan preregisters routing and opens no gate', () => {
  const plan = fixture('plan');
  assert.equal(plan.visibility, 'REPOSITORY_INTERNAL_NEVER_SHOWN_TO_THE_STRONG_MODEL_REVIEWER');
  assert.equal(plan.reviewProtocol.rawSha256, builder.PINNED.protocol.rawSha256);
  assert.equal(plan.routing.calibration.hashDomain, 'p1b6-rp1-v3-review-calibration-v1');
  assert.equal(plan.routing.cleanAgreement.createsHumanGold, false);
  for (const [key, value] of Object.entries(plan.authority)) assert.equal(value, false, key);
});
