'use strict';

// Accepted-row v3 migration: plan and blind packets derived from the ledger v3 flags.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-accepted-v3-migration');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'fixtures', file));
const a = builder.verifySources(builder.loadSources());

test('committed plan is exactly the builder output; inputs pinned; drift fails closed', () => {
  assert.deepEqual(builder.artifactBytes(builder.buildPlan(a)), read(builder.PLAN_FILE));
  for (const [, rawSha256, fixture] of Object.values(builder.SOURCES)) assert.equal(sha256RawBytes(read(fixture)), rawSha256, fixture);
  const raw = builder.loadSources();
  assert.throws(() => builder.verifySources({ ...raw, ledgerV3: Buffer.concat([raw.ledgerV3, Buffer.from(' ')]) }), /not the pinned artifact/);
});

test('population: 12 migrated rows (all gold ESCALATE vs v3 CLEAR), 6 retired kept out', () => {
  const plan = builder.buildPlan(a);
  assert.equal(plan.migration.rows.length, 12);
  assert.equal(plan.migration.rows.every(row => row.historicalHumanGold === 'ESCALATE' && row.v3Reference === 'CLEAR'), true);
  assert.equal(plan.retiredSkeletonAccepted.itemIds.length, 6);
  assert.equal(plan.migration.rows.filter(row => row.splitAssignment === 'FINAL_HELD_OUT').length, 5);
  for (const [key, value] of Object.entries(plan.authority)) assert.equal(value, false, key);
});

test('both packets: 12 sorted opaque rows with one TARGET and no leaked metadata', () => {
  for (const [packet, key, pattern] of [
    [builder.buildAuditPacket(a), 'auditRowId', /^p1b6-mig-audit-[0-9a-f]{16}$/u],
    [builder.buildReviewPacket(a), 'reviewRowId', /^p1b6-mig-v3smreview-[0-9a-f]{16}$/u],
  ]) {
    const ids = packet.rows.map(row => row[key]);
    assert.equal(new Set(ids).size, 12);
    assert.deepEqual(ids, ids.toSorted());
    for (const row of packet.rows) {
      assert.match(row[key], pattern);
      assert.equal(row.selectedBundle.split('[TARGET]').length, 2);
    }
    const text = JSON.stringify(packet);
    for (const value of ['p1b6-item-', 'p1b6-sk-', 'CLEAR', 'ESCALATE', 'TRAIN', 'FINAL_HELD_OUT', 'humanGold']) {
      assert.equal(text.includes(value), false, value);
    }
  }
  assert.deepEqual(Object.keys(builder.buildReviewPacket(a).rows[0]), ['reviewRowId', 'selectedBundle']);
});

const os = require('node:os');
const receipt = JSON.parse(read(builder.RECEIPT_FILE));
const RAW = ['p1b6-mig-source-audit-results.json', 'p1b6-mig-v3-review-results.json'].map(file => path.join(os.homedir(), file));

test('committed migration receipt: 12 audit PASS, 6 clean, 2 mandatory, 5 calibration, 4 HELD ineligible', () => {
  assert.deepEqual(receipt.summary, { total: 12, auditPass: 12, cleanAgreements: 6, mandatoryHuman: 2, calibration: 5, heldIneligible: 4 });
  const by = Object.fromEntries(receipt.rows.map(row => [row.itemId, [row.route, row.eligibility, row.human]]));
  assert.deepEqual(by['p1b6-item-b001-015'], ['DECISION_DISAGREEMENT', 'PENDING_MANDATORY_HUMAN', 'mandatory']);
  assert.deepEqual(by['p1b6-item-b002-063'], ['CLEAN_AGREEMENT', 'PROVISIONAL', null]);
  assert.deepEqual(by['p1b6-item-b001-020'], ['DECISION_DISAGREEMENT', 'INELIGIBLE', null]);
  assert.equal(receipt.rows.some(row => row.splitAssignment === 'FINAL_HELD_OUT' && row.human), false);
  for (const [key, value] of Object.entries(receipt.authority)) assert.equal(value, false, key);
});

test('the receipt equals the reconciled raw result bytes when they are supplied', { skip: !RAW.every(file => fs.existsSync(file)) }, () => {
  assert.deepEqual(builder.reconcile(...RAW.map(file => fs.readFileSync(file)), a), receipt);
});

test('HUMAN packet: 7 sorted opaque rows, bundles equal the strong-model packet, no HELD, no leaks', () => {
  assert.equal(sha256RawBytes(read(builder.HUMAN_PROTOCOL.fixture)), builder.HUMAN_PROTOCOL.rawSha256);
  const packet = builder.buildHumanPacket(receipt, a);
  const ids = packet.rows.map(row => row.reviewRowId);
  assert.equal(ids.length, 7);
  assert.deepEqual(ids, ids.toSorted());
  const members = receipt.rows.filter(row => row.human).map(row => row.itemId);
  assert.deepEqual(members.map(builder.humanRowId).toSorted(), ids);
  const strong = new Map(builder.buildReviewPacket(a).rows.map(row => [row.reviewRowId, row.selectedBundle]));
  for (const itemId of members) {
    assert.equal(packet.rows.find(row => row.reviewRowId === builder.humanRowId(itemId)).selectedBundle, strong.get(builder.reviewRowId(itemId)));
  }
  const text = JSON.stringify(packet.rows);
  for (const value of ['p1b6-item-', 'p1b6-sk-', 'CLEAR', 'ESCALATE', 'TRAIN', 'DEV', 'mandatory', 'calibration']) {
    assert.equal(text.includes(value), false, value);
  }
});
