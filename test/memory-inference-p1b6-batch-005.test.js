'use strict';

// Batch-005 EN top-up: preregistered slots, materialized batch, leakage and drift fail closed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-batch-005');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'fixtures', file));

test('committed protocol and batch are exactly the builder output; inputs pinned', () => {
  const { protocol, batch } = builder.buildAll();
  assert.deepEqual(builder.artifactBytes(protocol), read(builder.PROTOCOL_FILE));
  assert.deepEqual(builder.artifactBytes(batch), read(builder.BATCH_FILE));
  for (const [, rawSha256, fixture] of Object.values(builder.SOURCES)) assert.equal(sha256RawBytes(read(fixture)), rawSha256, fixture);
});

test('two EN TRAIN slots: 0768ea20 ESCALATE target and f4d809ae CLEAR target; no gate opened', () => {
  const protocol = JSON.parse(read(builder.PROTOCOL_FILE));
  assert.deepEqual(protocol.slots.map(slot => [slot.semanticSkeletonId, slot.authoringTargetLabel, slot.language]),
    [['p1b6-sk-0768ea2028f18511', 'ESCALATE', 'EN'], ['p1b6-sk-f4d809ae085dbac9', 'CLEAR', 'EN']]);
  for (const [key, value] of Object.entries(protocol.authority)) assert.equal(value, false, key);
  const batch = JSON.parse(read(builder.BATCH_FILE));
  assert.deepEqual(batch.items.map(item => item.itemId), ['p1b6-item-b005-001', 'p1b6-item-b005-002']);
});

test('fragment drift and leakage fail closed', () => {
  const drift = structuredClone(builder.CONTENT);
  drift[0].ev = [0, 1, 2, 3];
  assert.throws(() => builder.buildAll(undefined, drift), /fragments, spec wants/);
  const leaked = structuredClone(builder.CONTENT);
  leaked[1].turns[1][1] = JSON.parse(read('local-memory-inference-p1b6-surface-batch-004.json')).sourceEpisodes[7].turns[0].text;
  assert.throws(() => builder.buildAll(undefined, leaked), /reused/);
});
