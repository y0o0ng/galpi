'use strict';

// Semantic contract v4: the user-centered successor, derived from v3's exact raw bytes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-skeleton-semantic-contract-v4');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'fixtures', file));
const v3Bytes = read(builder.V3.fixture);
const receiptBytes = read(builder.RECEIPT_FILE);

test('the committed v4 catalog is exactly the builder output and v3 is unchanged', () => {
  assert.equal(sha256RawBytes(v3Bytes), builder.V3.rawSha256);
  const built = builder.buildEffectiveCurrentV4(v3Bytes, receiptBytes);
  assert.deepEqual(Buffer.from(`${JSON.stringify(built, null, 2)}\n`), read(builder.V4_FILE));
});

test('v4: 43016ef6 and cc054a42 move to ESCALATE, 714725ee keeps CLEAR, everything else is inherited', () => {
  const v3 = JSON.parse(v3Bytes);
  const v4 = JSON.parse(read(builder.V4_FILE));
  assert.deepEqual(v4.coverage.humanLabelCounts, { CLEAR: 40, ESCALATE: 16 });
  assert.deepEqual(v4.labelChangedSkeletonIds, ['p1b6-sk-43016ef6da889a87', 'p1b6-sk-cc054a4227cdafef']);
  const changed = new Set(builder.CHANGES.map(row => row.id));
  v3.candidates.forEach((row, index) => {
    const next = v4.candidates[index];
    assert.deepEqual([next.semanticSkeletonId, next.splitAssignment, next.boundaryClass], [row.semanticSkeletonId, row.splitAssignment, row.boundaryClass]);
    if (!changed.has(row.semanticSkeletonId)) assert.deepEqual(next, row);
  });
  assert.equal(v4.candidates.find(row => row.semanticSkeletonId === 'p1b6-sk-714725eea477a631').humanLabel, 'CLEAR');
  assert.match(v4.interpretationRule.userCenteredTarget, /user's own state, stance, plan, or relationship/u);
  assert.doesNotMatch(v4.interpretationRule.clear, /attributed/u);
});

test('the change set is closed and drift fails closed', () => {
  const receipt = JSON.parse(receiptBytes);
  const extra = structuredClone(receipt);
  extra.amendments.push({ ...extra.amendments[0], semanticSkeletonId: 'p1b6-sk-000035b8df850b3e' });
  assert.throws(() => builder.buildEffectiveCurrentV4(v3Bytes, Buffer.from(JSON.stringify(extra))), /exactly the approved three/);
  const attributed = structuredClone(receipt);
  attributed.interpretationRule.clear += ' attributed';
  assert.throws(() => builder.buildEffectiveCurrentV4(v3Bytes, Buffer.from(JSON.stringify(attributed))), /user-centered/);
  assert.throws(() => builder.buildEffectiveCurrentV4(Buffer.concat([v3Bytes, Buffer.from(' ')]), receiptBytes), /not the pinned artifact/);
});
