'use strict';

// Blind 2-row HUMAN packet for the TARGET-boundary candidates.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-target-boundary-human-review-packet');
const review = require('../scripts/build-memory-inference-p1b6-target-boundary-v3-review-packet');

const PACKET_SHA256 = '74f1886e502292fd189bd286c6dff1a8a626c4d600d7b9897c23c5e2038e8a3b';
const receipt = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', builder.PINNED.reviewReceipt.fixture)));

test('population is the receipt mandatory + calibration rows; drift fails closed', () => {
  assert.deepEqual(builder.derivePopulation(), ['p1b6-item-tb1-001', 'p1b6-item-tb1-002']);
  const moved = receipt();
  moved.calibrationItemIds = ['p1b6-item-tb1-001'];
  assert.throws(() => builder.derivePopulation(moved), /preregistered plan/);
  const unreconciled = receipt();
  unreconciled.status = 'X';
  assert.throws(() => builder.derivePopulation(unreconciled), /not reconciled/);
});

test('the packet is deterministic, opaque, sorted, and reuses the reviewed bundles', () => {
  const packet = builder.buildHumanReviewPacket();
  assert.equal(sha256RawBytes(builder.packetBytes(packet)), PACKET_SHA256);
  const ids = packet.rows.map(row => row.reviewRowId);
  assert.deepEqual(ids, ids.toSorted());
  const reviewed = new Set(review.buildReviewPacket().rows.map(row => row.selectedBundle));
  for (const row of packet.rows) {
    assert.deepEqual(Object.keys(row), ['reviewRowId', 'selectedBundle']);
    assert.match(row.reviewRowId, /^p1b6-tb1-hreview-[0-9a-f]{16}$/u);
    assert.equal(reviewed.has(row.selectedBundle), true);
  }
  const text = JSON.stringify(packet);
  for (const value of ['p1b6-item-', 'p1b6-sk-', 'targetAnchorRole', 'intendedUnresolvedReadings', 'CLEAR',
    'ESCALATE', 'KEEP', 'calibration', 'mandatory', 'v3smreview', 'reference']) {
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
