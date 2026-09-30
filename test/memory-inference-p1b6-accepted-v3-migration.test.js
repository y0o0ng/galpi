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
