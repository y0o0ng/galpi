'use strict';

// v4 pool review: plan and blind packets derived from ledger v5 and the v4 catalog.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-v4-review');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'fixtures', file));
const a = builder.verifySources(builder.loadSources());

test('committed plan is exactly the builder output; every input is pinned', () => {
  assert.deepEqual(builder.artifactBytes(builder.buildPlan(a)), read(builder.PLAN_FILE));
  for (const [, rawSha256, fixture] of Object.values(builder.SOURCES)) assert.equal(sha256RawBytes(read(fixture)), rawSha256, fixture);
});

test('populations: all 386 pool rows for scope; the 19 rows on label-changed skeletons for v4 review', () => {
  const plan = builder.buildPlan(a);
  assert.deepEqual(plan.scopeReview.bySplit, { TRAIN: 241, DEV: 61, FINAL_HELD_OUT: 84 });
  assert.equal(plan.v4Review.rows.length, 19);
  assert.equal(plan.v4Review.rows.every(row => row.v4Reference === 'ESCALATE'), true);
  assert.equal(plan.v4Review.routing.calibration.size, 4);
  for (const [key, value] of Object.entries(plan.authority)) assert.equal(value, false, key);
});

test('both packets: sorted unique opaque IDs, one TARGET each, no leaked metadata', () => {
  for (const [packet, size, pattern] of [
    [builder.buildScopePacket(a), 386, /^p1b6-v4-scope-[0-9a-f]{16}$/u],
    [builder.buildReviewPacket(a), 19, /^p1b6-v4-smreview-[0-9a-f]{16}$/u],
  ]) {
    const ids = packet.rows.map(row => row.reviewRowId);
    assert.equal(new Set(ids).size, size);
    assert.deepEqual(ids, ids.toSorted());
    for (const row of packet.rows) {
      assert.deepEqual(Object.keys(row), ['reviewRowId', 'selectedBundle']);
      assert.match(row.reviewRowId, pattern);
      assert.equal(row.selectedBundle.split('[TARGET]').length, 2);
    }
    const text = JSON.stringify(packet.rows);
    for (const value of ['p1b6-item-', 'p1b6-sk-', 'CLEAR', 'ESCALATE', 'TRAIN', 'FINAL_HELD_OUT']) assert.equal(text.includes(value), false, value);
  }
});
