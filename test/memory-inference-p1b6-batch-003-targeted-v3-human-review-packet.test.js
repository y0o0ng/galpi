'use strict';

// Blind 8-row HUMAN packet for the targeted v3 re-reconciliation: population from the committed
// strong-model receipt, no role or label leak, bundles identical to the strong-model packet.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const builder = require('../scripts/build-memory-inference-p1b6-batch-003-targeted-v3-human-review-packet');
const smPacket = require('../scripts/build-memory-inference-p1b6-batch-003-targeted-v3-strong-model-review-packet');

const ROOT = path.resolve(__dirname, '..');
const [RECEIPT, PROTOCOL] = builder.loadPinned();
const item = number => `p1b6-item-b003-${number}`;
const EXPECTED = ['075', '076', '077', '080', '082', '143', '144', '235'].map(item);
const receiptWith = mutate => {
  const receipt = JSON.parse(RECEIPT);
  mutate(receipt);
  return receipt;
};

test('population is the 5 mandatory and 3 calibration rows of the receipt', () => {
  const population = builder.derivePopulation(JSON.parse(RECEIPT), smPacket.loadCanonicalInputs());
  assert.deepEqual(population.toSorted(), EXPECTED);
});

test('receipt, protocol and selection drift fail closed', () => {
  assert.throws(() => builder.buildHumanReviewPacket(Buffer.from(`${RECEIPT} `), PROTOCOL), /not the canonical/);
  assert.throws(() => builder.buildHumanReviewPacket(RECEIPT, Buffer.from(`${PROTOCOL} `)), /not the canonical/);
  const inputs = smPacket.loadCanonicalInputs();
  assert.throws(() => builder.derivePopulation(receiptWith(r => { r.calibrationRows[0].itemId = item('071'); }),
    inputs), /preregistered rule/);
  assert.throws(() => builder.derivePopulation(receiptWith(r => { r.agreementItemIds.pop(); }),
    inputs), /partition/);
  assert.throws(() => builder.derivePopulation(receiptWith(r => { r.status = 'X'; }), inputs), /not reconciled/);
});

test('rows are opaque, sorted, and leak no identity, label or role', () => {
  const packet = builder.buildHumanReviewPacket(RECEIPT, PROTOCOL);
  assert.equal(packet.rows.length, 8);
  assert.equal(require('../lib/memory-inference-p1b6-skeletons').sha256RawBytes(builder.packetBytes(packet)),
    '35c6601f202f2cf830ee6db4809e622c7c36aa0a7d8ad10d5cd0937cf9a6aa4b');
  const ids = packet.rows.map(row => row.reviewRowId);
  assert.deepEqual(ids, ids.toSorted());
  const text = JSON.stringify(packet);
  for (const value of [...EXPECTED, 'p1b6-item-', 'p1b6-sk-', 'CLEAR', 'ESCALATE', 'KEEP', 'mandatory',
    'calibration', 'agreement', 'DECISION_DISAGREEMENT', 'reference', 'v3smreview']) {
    assert.equal(text.includes(value), false, value);
  }
  for (const row of packet.rows) {
    assert.deepEqual(Object.keys(row), ['reviewRowId', 'selectedBundle']);
    assert.match(row.reviewRowId, /^p1b6-v3hreview-[0-9a-f]{16}$/u);
  }
});

test('each bundle equals the strong-model packet bundle for the same item', () => {
  const packet = builder.buildHumanReviewPacket(RECEIPT, PROTOCOL);
  const sm = smPacket.buildTargetedReviewPacket(smPacket.loadCanonicalInputs());
  const batchSha = smPacket.CANONICAL_INPUTS.batch.rawSha256;
  for (const itemId of EXPECTED) {
    const fresh = packet.rows.find(row => row.reviewRowId === builder.opaqueReviewRowId(batchSha, itemId));
    const old = sm.rows.find(row => row.reviewRowId === smPacket.opaqueReviewRowId(batchSha, itemId));
    assert.equal(fresh.selectedBundle, old.selectedBundle, itemId);
  }
});

test('the protocol carries v3 verbatim and records the reviewer limitation', () => {
  const protocol = JSON.parse(PROTOCOL);
  const v3 = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', smPacket.CANONICAL_INPUTS.v3Catalog.fixture)));
  for (const key of ['clear', 'escalate', 'uncertaintyDistinction', 'targetBoundary', 'pragmaticResolution']) {
    assert.equal(protocol.question[key], v3.interpretationRule[key], key);
  }
  assert.equal(protocol.question.noAddedPremise, v3.interpretationRule.retainedV2Clauses.noAddedPremise);
  assert.equal(protocol.reviewer.knowsV3ReferenceForWholePopulation, true);
  assert.match(protocol.reviewer.independenceNote, /not an independent confirmation/);
  assert.equal(protocol.population.rows, 8);
});
