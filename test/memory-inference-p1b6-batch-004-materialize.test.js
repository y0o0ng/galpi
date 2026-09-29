'use strict';

// Batch-004 materialization: structure, plan conformance, TARGET-boundary roles and leakage.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { computeFragments, validateSurfaceBatch } = require('../lib/memory-inference-p1b6-surfaces');
const builder = require('../scripts/build-memory-inference-p1b6-batch-004-materialize');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, 'fixtures', file));
const batch = JSON.parse(read(builder.BATCH_FILE));
const receipt = JSON.parse(read(builder.RECEIPT_FILE));
const protocol = JSON.parse(read(builder.SOURCES.protocol[2]));

test('committed batch and receipt are exactly the builder output', () => {
  const { batch: built, receipt: builtReceipt } = builder.buildAll();
  assert.deepEqual(builder.artifactBytes(built), read(builder.BATCH_FILE));
  assert.deepEqual(builder.artifactBytes(builtReceipt), read(builder.RECEIPT_FILE));
  assert.equal(receipt.batch.rawSha256, sha256RawBytes(read(builder.BATCH_FILE)));
});

test('41 items in the b004 namespace pass the shared validator and match every slot', () => {
  const v3 = JSON.parse(read(builder.SOURCES.v3[2]));
  validateSurfaceBatch(batch, { exact56: v3 });
  assert.equal(batch.items.length, 41);
  const episodes = new Map(batch.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  batch.items.forEach((item, index) => {
    const slot = protocol.slots[index];
    const episode = episodes.get(item.sourceEpisodeId);
    assert.equal(item.itemId, `p1b6-item-b004-${slot.slot}`);
    assert.equal(item.semanticSkeletonId, slot.semanticSkeletonId);
    assert.equal(episode.language, slot.language);
    assert.equal(item.discoursePattern, slot.discoursePattern);
    assert.equal(computeFragments(item, episode).length, slot.fragments);
  });
});

test('TARGET-boundary slots declare allowed roles; other slots declare none', () => {
  const tbSlots = protocol.slots.filter(slot => slot.targetBoundaryInvariant).map(slot => `p1b6-item-b004-${slot.slot}`);
  assert.deepEqual(receipt.targetBoundaryRoles.map(row => row.itemId), tbSlots);
  for (const row of receipt.targetBoundaryRoles) {
    assert.equal(['APPLICABILITY_STATUS', 'CATEGORY_MEMBERSHIP', 'RULE_RESULT'].includes(row.targetAnchorRole), true);
  }
  const entries = structuredClone(builder.loadAuthoredContent());
  entries[protocol.slots.findIndex(slot => slot.targetBoundaryInvariant)].role = 'SUPPORTING_FACT';
  assert.throws(() => builder.buildAll(undefined, entries), /TARGET must denote/);
  const stray = structuredClone(builder.loadAuthoredContent());
  stray[protocol.slots.findIndex(slot => !slot.targetBoundaryInvariant)].role = 'RULE_RESULT';
  assert.throws(() => builder.buildAll(undefined, stray), /declares a role outside/);
});

test('spec drift, fragment drift and leakage fail closed', () => {
  const wrongLanguage = structuredClone(builder.loadAuthoredContent());
  wrongLanguage[0].lang = 'EN';
  assert.throws(() => builder.buildAll(undefined, wrongLanguage), /does not match its skeleton/);
  const wrongFragments = structuredClone(builder.loadAuthoredContent());
  wrongFragments[0].ev = [0, 3];
  assert.throws(() => builder.buildAll(undefined, wrongFragments), /fragments, spec wants/);
  const leaked = structuredClone(builder.loadAuthoredContent());
  const prior = JSON.parse(read(builder.SOURCES.batch003[2])).sourceEpisodes
    .flatMap(row => row.turns).find(turn => turn.text.length > 20).text;
  leaked[1].turns[1][1] = prior;
  assert.throws(() => builder.buildAll(undefined, leaked), /reused/);
});

test('the receipt opens no gate and the pinned inputs are unchanged', () => {
  assert.equal(receipt.status, 'MATERIALIZED_AWAITING_OWNER_PRE_AUDIT_REVIEW');
  for (const [key, value] of Object.entries(receipt.authority)) assert.equal(value, false, key);
  for (const [, rawSha256, fixture] of Object.values(builder.SOURCES)) {
    assert.equal(sha256RawBytes(read(fixture)), rawSha256, fixture);
  }
});
