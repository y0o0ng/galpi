'use strict';

// Batch-005 EN top-up: preregistered slots, materialized batch, leakage and drift fail closed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-batch-006');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'fixtures', file));

test('committed protocol and batch are exactly the builder output; inputs pinned', () => {
  const { protocol, batch } = builder.buildAll();
  assert.deepEqual(builder.artifactBytes(protocol), read(builder.PROTOCOL_FILE));
  assert.deepEqual(builder.artifactBytes(batch), read(builder.BATCH_FILE));
  for (const [, rawSha256, fixture] of Object.values(builder.SOURCES)) assert.equal(sha256RawBytes(read(fixture)), rawSha256, fixture);
});

test('seven KO slots: 5 HELD on the per-skeleton needs and 2 DEV; HELD skips owner and HUMAN review', () => {
  const protocol = JSON.parse(read(builder.PROTOCOL_FILE));
  const count = split => protocol.slots.filter(slot => slot.splitAssignment === split).length;
  assert.deepEqual([count('FINAL_HELD_OUT'), count('DEV'), count('TRAIN')], [5, 2, 0]);
  assert.equal(protocol.slots.every(slot => slot.language === 'KO' && slot.authoringTargetLabel === 'CLEAR'), true);
  assert.equal(protocol.gates.held.order.includes('owner pre-audit authoring review'), false);
  assert.equal(protocol.gates.dev.order[0], 'owner pre-audit authoring review');
  for (const [key, value] of Object.entries(protocol.authority)) assert.equal(value, false, key);
  const batch = JSON.parse(read(builder.BATCH_FILE));
  assert.equal(batch.items.length, 7);
});

test('fragment drift and leakage fail closed', () => {
  const drift = structuredClone(builder.CONTENT);
  drift[5].ev = [0, 1, 2, 3, 4];
  assert.throws(() => builder.buildAll(undefined, drift), /fragments, spec wants/);
  const leaked = structuredClone(builder.CONTENT);
  leaked[6].turns[1][1] = JSON.parse(read('local-memory-inference-p1b6-surface-batch-005.json')).sourceEpisodes[0].turns[1].text;
  assert.throws(() => builder.buildAll(undefined, leaked), /reused/);
});
