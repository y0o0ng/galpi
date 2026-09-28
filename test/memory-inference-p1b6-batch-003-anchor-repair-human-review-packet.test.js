'use strict';

// Blind 5-row HUMAN packet for the aebbf047 anchor-repair candidates (4 mandatory + 1 calibration).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-batch-003-anchor-repair-human-review-packet');
const review = require('../scripts/build-memory-inference-p1b6-batch-003-anchor-repair-v3-review-packet');

const PACKET_SHA256 = '626557153094f0f5c79fe41c77fe787c7e0770a8e12fb42ab4553fdd24683f3f';
const receipt = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', builder.PINNED.reviewReceipt.fixture)));

test('population is the four mandatory rows plus the one calibration row', () => {
  assert.deepEqual(builder.derivePopulation(),
    ['224', '225', '226', '227', '228'].map(n => `p1b6-item-b003-${n}`));
  const moved = receipt();
  moved.calibrationItemIds = [];
  assert.throws(() => builder.derivePopulation(moved), /preregistered plan/);
});

test('the packet is deterministic, opaque, sorted, and hides row role', () => {
  const packet = builder.buildHumanReviewPacket();
  assert.equal(sha256RawBytes(builder.packetBytes(packet)), PACKET_SHA256);
  const ids = packet.rows.map(row => row.reviewRowId);
  assert.equal(ids.length, 5);
  assert.deepEqual(ids, ids.toSorted());
  const reviewed = new Set(review.buildReviewPacket().rows.map(row => row.selectedBundle));
  for (const row of packet.rows) {
    assert.deepEqual(Object.keys(row), ['reviewRowId', 'selectedBundle']);
    assert.match(row.reviewRowId, /^p1b6-b003-anchor-hreview-[0-9a-f]{16}$/u);
    assert.equal(reviewed.has(row.selectedBundle), true);
  }
  const text = JSON.stringify(packet);
  for (const value of ['p1b6-item-', 'p1b6-sk-', 'CLEAR', 'ESCALATE', 'KEEP', 'calibration', 'mandatory',
    'DECISION_DISAGREEMENT', 'v3smreview', 'reference', 'REANCHOR']) {
    assert.equal(text.includes(value), false, value);
  }
});

test('the protocol carries v3 and records the reviewer limitation', () => {
  const protocol = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', builder.PINNED.protocol.fixture)));
  const v3 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures',
    'local-memory-inference-p1b6-skeleton-effective-current-v3.json')));
  for (const key of ['clear', 'escalate', 'uncertaintyDistinction', 'targetBoundary', 'pragmaticResolution', 'noAddedPremise']) {
    assert.equal(protocol.question[key], key === 'noAddedPremise'
      ? v3.interpretationRule.retainedV2Clauses.noAddedPremise : v3.interpretationRule[key], key);
  }
  assert.equal(protocol.population.rows, 5);
  assert.equal(protocol.reviewer.decidedTheReanchoring, true);
  assert.match(protocol.reviewer.independenceNote, /not an independent confirmation/);
});
