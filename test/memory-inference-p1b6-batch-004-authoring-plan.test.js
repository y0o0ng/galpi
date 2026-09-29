'use strict';

// Batch-004 top-up authoring plan: derived from the reviewed-pool ledger and shortage receipt.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-batch-004-authoring-plan');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, 'fixtures', file));
const protocol = JSON.parse(read(builder.PROTOCOL_FILE));
const sum = counts => Object.values(counts).reduce((total, value) => total + value, 0);

test('committed protocol is exactly the builder output', () => {
  assert.deepEqual(builder.artifactBytes(builder.buildProtocol(builder.verifySources(builder.loadSources()))),
    read(builder.PROTOCOL_FILE));
});

test('tranche: 41 = lower bound 34 + buffer 7, TRAIN 38 / DEV 3 / HELD 0', () => {
  const { tranche } = protocol;
  assert.deepEqual([tranche.total, tranche.lowerBound, tranche.buffer], [41, 34, 7]);
  assert.deepEqual(tranche.split, { TRAIN: 38, DEV: 3, FINAL_HELD_OUT: 0 });
  assert.deepEqual(tranche.language, { KO: 26, MIXED: 10, EN: 5 });
  assert.deepEqual(tranche.fragments, { 1: 5, 2: 15, 3: 12, 4: 7, 5: 2 });
  for (const counts of [tranche.split, tranche.language, tranche.fragments, tranche.discoursePatterns]) {
    assert.equal(sum(counts), 41);
  }
});

test('slots realize every marginal exactly and respect the per-skeleton cap', () => {
  const { slots, tranche } = protocol;
  assert.equal(slots.length, 41);
  const tally = key => slots.reduce((acc, slot) => {
    acc[slot[key]] = (acc[slot[key]] ?? 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(tally('language'), tranche.language);
  assert.deepEqual(tally('discoursePattern'), tranche.discoursePatterns);
  assert.deepEqual(Object.fromEntries(Object.entries(tally('fragments')).map(([key, value]) => [key, value])),
    tranche.fragments);
  const perSkeleton = tally('semanticSkeletonId');
  assert.equal(Math.max(...Object.values(perSkeleton)), builder.PER_SKELETON_CAP);
  const v3 = JSON.parse(read(builder.SOURCES.v3[2]));
  const skeletons = new Map(v3.candidates.map(row => [row.semanticSkeletonId, row]));
  for (const slot of slots) {
    const skeleton = skeletons.get(slot.semanticSkeletonId);
    assert.equal(skeleton.splitAssignment, slot.splitAssignment, slot.slot);
    assert.equal(skeleton.humanLabel, slot.authoringTargetLabel, slot.slot);
    assert.equal(slot.targetBoundaryInvariant, builder.TARGET_BOUNDARY_SKELETONS.includes(slot.semanticSkeletonId));
  }
});

test('gates preregister the 20% calibration sample and the owner pre-audit review', () => {
  assert.equal(protocol.gates.calibration.size, 8);
  assert.equal(protocol.gates.calibration.hashDomain, builder.CALIBRATION_HASH_DOMAIN);
  assert.equal(protocol.gates.order[0], 'owner pre-audit authoring review');
  assert.match(protocol.derivation.labelRule, /label balance is not a target/);
  for (const [key, value] of Object.entries(protocol.authority)) assert.equal(value, false, key);
});

test('pinned inputs are unchanged and drift fails closed', () => {
  for (const [, rawSha256, fixture] of Object.values(builder.SOURCES)) {
    assert.equal(sha256RawBytes(read(fixture)), rawSha256, fixture);
  }
  const raw = builder.loadSources();
  assert.throws(() => builder.verifySources({ ...raw, shortage: Buffer.concat([raw.shortage, Buffer.from(' ')]) }),
    /not the pinned artifact/);
});
