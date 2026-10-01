'use strict';

// Blind HUMAN calibration packet for batch-006: the two DEV clean agreements only; no HELD row.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-batch-006-human-review-packet');
const review = require('../scripts/build-memory-inference-p1b6-batch-006-v3-review-packet');

const PACKET_SHA256 = '24dbf13a813190fbe38695f59bf56e66b8e9df8acd466672d634998301c9f07a';
const ITEMS = ['p1b6-item-b006-006', 'p1b6-item-b006-007'];

test('population is the two DEV clean agreements; no HELD row can enter', () => {
  assert.deepEqual(builder.derivePopulation(), { mandatory: [], calibration: ITEMS, unsampled: [] });
});

test('packet: deterministic, 2 sorted opaque rows, bundles equal the strong-model packet, no leaks', () => {
  const packet = builder.buildHumanReviewPacket();
  assert.equal(sha256RawBytes(builder.packetBytes(packet)), PACKET_SHA256);
  const ids = packet.rows.map(row => row.reviewRowId);
  assert.deepEqual(ids, ids.toSorted());
  const strong = new Map(review.buildReviewPacket().rows.map(row => [row.reviewRowId, row.selectedBundle]));
  for (const itemId of ITEMS) {
    const row = packet.rows.find(r => r.reviewRowId === builder.opaqueReviewRowId(packet.sourceBatch.sha256, itemId));
    assert.equal(row.selectedBundle, strong.get(review.opaqueReviewRowId(packet.sourceBatch.sha256, itemId)));
  }
  const text = JSON.stringify(packet.rows);
  for (const value of ['p1b6-item-', 'p1b6-sk-', 'CLEAR', 'ESCALATE', 'DEV', 'FINAL_HELD_OUT', 'calibration']) {
    assert.equal(text.includes(value), false, value);
  }
});

test('committed v3 review receipt: 7 clean, HELD all PROVISIONAL, only DEV routed to HUMAN', () => {
  const receipt = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', review.RECEIPT_FIXTURE)));
  assert.deepEqual(receipt.summary, { total: 7, cleanAgreements: 7, mandatoryHuman: 0, calibration: 2, heldIneligible: 0 });
  assert.deepEqual(receipt.calibrationItemIds, ITEMS);
  assert.equal(receipt.rows.filter(row => row.splitAssignment === 'FINAL_HELD_OUT').every(row => row.eligibility === 'PROVISIONAL'), true);
});

const os = require('node:os');
const HUMAN_RECEIPT = path.join(__dirname, '..', 'fixtures', builder.RECEIPT_FIXTURE);
const RAW = path.join(os.homedir(), 'p1b6-b006-human-review-results.json');

test('the committed HUMAN receipt: both DEV rows are calibration matches, nothing promoted', () => {
  const human = JSON.parse(fs.readFileSync(HUMAN_RECEIPT));
  assert.deepEqual(human.rows.map(row => [row.itemId, row.outcome, row.eligibility]),
    ITEMS.map(itemId => [itemId, 'CALIBRATION_MATCH', 'PROVISIONAL']));
  assert.equal(human.authority.promotedToHumanAdjudicated, false);
  assert.equal(human.reviewer.independentConfirmation, false);
});

test('the HUMAN receipt equals the raw result bytes when they are supplied', { skip: !fs.existsSync(RAW) }, () => {
  const human = JSON.parse(fs.readFileSync(HUMAN_RECEIPT));
  assert.deepEqual(builder.buildHumanResultReceipt(fs.readFileSync(RAW), human.reviewDate), human);
});
