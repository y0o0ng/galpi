'use strict';

// Blind v3 strong-model review packet for the 2 batch-005 rows that passed the source audit.

const test = require('node:test');
const assert = require('node:assert/strict');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-batch-005-v3-review-packet');
const audit = require('../scripts/build-memory-inference-p1b6-batch-005-source-audit-packet');

const PACKET_SHA256 = 'dfafb7fe5bd45d61bbf788aafb40aa72a5f90dd5a869115ea54fc0409a949b88';

test('the packet is deterministic, 2 sorted opaque rows, no leaked metadata', () => {
  const packet = builder.buildReviewPacket();
  assert.equal(sha256RawBytes(builder.packetBytes(packet)), PACKET_SHA256);
  const ids = packet.rows.map(row => row.reviewRowId);
  assert.equal(ids.length, 2);
  assert.deepEqual(ids, ids.toSorted());
  for (const row of packet.rows) {
    assert.deepEqual(Object.keys(row), ['reviewRowId', 'selectedBundle']);
    assert.match(row.reviewRowId, /^p1b6-b005-v3smreview-[0-9a-f]{16}$/u);
  }
  const text = JSON.stringify(packet);
  for (const value of ['p1b6-item-', 'p1b6-sk-', 'CLEAR', 'ESCALATE', 'TRAIN', 'sourceEpisode', 'p1b6-b005-audit']) {
    assert.equal(text.includes(value), false, value);
  }
});

test('reconciliation routes disagreements to HUMAN and takes every clean agreement as calibration', () => {
  const labels = { 'p1b6-item-b005-001': 'ESCALATE', 'p1b6-item-b005-002': 'CLEAR' };
  const sha = audit.CANONICAL_INPUTS.batch.rawSha256;
  const results = flip => Buffer.from(JSON.stringify({ results: builder.EXPECTED_ITEM_IDS.map(itemId => ({
    reviewRowId: builder.opaqueReviewRowId(sha, itemId), disposition: 'KEEP',
    decision: itemId === flip ? (labels[itemId] === 'CLEAR' ? 'ESCALATE' : 'CLEAR') : labels[itemId], reason: 'r',
  })) }));
  assert.deepEqual(builder.reconcile(results()).summary, { total: 2, cleanAgreements: 2, mandatoryHuman: 0, calibration: 2 });
  const routed = builder.reconcile(results('p1b6-item-b005-001'));
  assert.deepEqual(routed.mandatoryHumanItemIds, ['p1b6-item-b005-001']);
  assert.deepEqual(routed.calibrationItemIds, ['p1b6-item-b005-002']);
});
