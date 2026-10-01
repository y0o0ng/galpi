'use strict';

// Blind v3 strong-model review packet for the 7 batch-006 rows; HELD rows never route to HUMAN.

const test = require('node:test');
const assert = require('node:assert/strict');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-batch-006-v3-review-packet');
const audit = require('../scripts/build-memory-inference-p1b6-batch-006-source-audit-packet');

const PACKET_SHA256 = '4f9ce9470943282f41803c6ad4e91a99d7f50371e172a242dc62a4878e731859';

test('the packet is deterministic, 7 sorted opaque rows, no leaked metadata', () => {
  const packet = builder.buildReviewPacket();
  assert.equal(sha256RawBytes(builder.packetBytes(packet)), PACKET_SHA256);
  const ids = packet.rows.map(row => row.reviewRowId);
  assert.equal(ids.length, 7);
  assert.deepEqual(ids, ids.toSorted());
  for (const row of packet.rows) assert.deepEqual(Object.keys(row), ['reviewRowId', 'selectedBundle']);
  const text = JSON.stringify(packet);
  for (const value of ['p1b6-item-', 'p1b6-sk-', 'CLEAR', 'ESCALATE', 'DEV', 'FINAL_HELD_OUT', 'sourceEpisode', 'p1b6-b006-audit']) {
    assert.equal(text.includes(value), false, value);
  }
});

test('routing: HELD disagreements are ineligible without HUMAN; DEV disagreements are mandatory; DEV clean is calibration', () => {
  const sha = audit.CANONICAL_INPUTS.batch.rawSha256;
  const results = flip => Buffer.from(JSON.stringify({ results: builder.EXPECTED_ITEM_IDS.map(itemId => ({
    reviewRowId: builder.opaqueReviewRowId(sha, itemId), disposition: 'KEEP',
    decision: flip.includes(itemId) ? 'ESCALATE' : 'CLEAR', reason: 'r',
  })) }));
  assert.deepEqual(builder.reconcile(results([])).summary,
    { total: 7, cleanAgreements: 7, mandatoryHuman: 0, calibration: 2, heldIneligible: 0 });
  const routed = builder.reconcile(results(['p1b6-item-b006-001', 'p1b6-item-b006-006']));
  assert.deepEqual(routed.mandatoryHumanItemIds, ['p1b6-item-b006-006']);
  assert.deepEqual(routed.calibrationItemIds, ['p1b6-item-b006-007']);
  assert.equal(routed.rows.find(row => row.itemId === 'p1b6-item-b006-001').eligibility, 'INELIGIBLE');
  assert.equal(routed.summary.heldIneligible, 1);
});
