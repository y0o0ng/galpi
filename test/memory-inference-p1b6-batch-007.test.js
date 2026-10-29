'use strict';

// Batch-007 top-up: the preregistered protocol is the builder output over pinned inputs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-batch-007');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'fixtures', file));
const protocol = JSON.parse(read(builder.PROTOCOL_FILE));

test('committed batch-007 protocol is exactly the builder output; every input is pinned', () => {
  assert.deepEqual(builder.artifactBytes(builder.buildProtocol(builder.verifySources(builder.loadSources()))), read(builder.PROTOCOL_FILE));
  for (const [, rawSha256, fixture] of Object.values(builder.SOURCES)) assert.equal(sha256RawBytes(read(fixture)), rawSha256, fixture);
});

test('27 slots: lower bound 21 + buffer 6; 43016ef6 probe 2, 5fc872af uncovered; nothing run', () => {
  assert.deepEqual(protocol.tranche.split, { TRAIN: 13, DEV: 9, FINAL_HELD_OUT: 5 });
  const on = id => protocol.slots.filter(s => s.semanticSkeletonId === id).length;
  assert.equal(on('p1b6-sk-43016ef6da889a87'), 2);
  assert.equal(on('p1b6-sk-5fc872afb058b370'), 0);
  assert.equal(on('p1b6-sk-11e63b75bdf266dd'), 3);
  assert.equal(on('p1b6-sk-a19bb9e94e9a416b'), 2);
  assert.equal(new Set(protocol.slots.map(s => s.slot)).size, 27);
  for (const [key, value] of Object.entries(protocol.authority)) assert.equal(value, false, key);
});
