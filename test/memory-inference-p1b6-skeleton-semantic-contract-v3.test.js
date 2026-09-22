'use strict';

// P1-B6 semantic contract v3: the successor semantic authority at 42 CLEAR / 14 ESCALATE.
//
// These tests pin the derivation boundary: v3 comes from the exact raw bytes of v2, exactly
// three v2 amendments are reversed, exactly two skeletons are retired and replaced in place,
// and no historical artifact moves. Nothing here reviews, accepts, freezes or trains.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const v3 = require('../scripts/build-memory-inference-p1b6-skeleton-semantic-contract-v3');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, 'fixtures', file));
const readJson = file => JSON.parse(read(file));

const V3_SHA256 = '89a48264d6b09710f976a4ab85235ff161cf81ff44896e37553d5dc7753c65b9';
const RECEIPT_SHA256 = '10f8a10eb3325b86c9d9282fc951ee53b2037918c4258c89a7694822df9a98e1';

const UNCHANGED = Object.freeze({
  'local-memory-inference-p1b6-skeleton-exact56.json':
    '772f07bd679a9c98ea65feaa164ec7a9c1f3e3fb33632052ef076f8301999602',
  'local-memory-inference-p1b6-skeleton-effective-current.json':
    '48490b6e4e1494856ef3268d944da16093c4735d207e07c1fd9e8bbf69df2559',
  'local-memory-inference-p1b6-skeleton-effective-current-v2.json':
    'f1e780195441246402ca389da188b1f7b8c4970f42fc1e6e3de2f436a3e9377c',
  'local-memory-inference-p1b6-skeleton-semantic-contract-v2-receipt.json':
    'a12063c38eee6245122e655126708c904319b4a7467cf82084acdea17a293344',
  'local-memory-inference-p1b6-skeleton-semantic-amendment-receipt.json':
    '2778f64cf9f8f15bc85b7d015b706f5e87ad20e9dafc1249357477b235744977',
});

const build = (overrides = {}) => v3.buildEffectiveCurrentV3(
  overrides.v2 ?? read(v3.V2.fixture), overrides.receipt ?? read(v3.RECEIPT_FILE));
const withReceipt = mutate => {
  const receipt = readJson(v3.RECEIPT_FILE);
  mutate(receipt);
  return Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
};

test('Exact56, v1, v2 and the earlier receipts remain byte-identical', () => {
  for (const [file, sha] of Object.entries(UNCHANGED)) {
    assert.equal(sha256RawBytes(read(file)), sha, file);
  }
  const v2 = readJson(v3.V2.fixture);
  assert.equal(v2.status, 'ACTIVE_PROSPECTIVE_SEMANTIC_AUTHORITY', 'v2 bytes are not rewritten');
  assert.deepEqual(v2.coverage.humanLabelCounts, { CLEAR: 45, ESCALATE: 11 });
});

test('v3 is deterministic and derives from the exact v2 bytes', () => {
  const committed = read(v3.V3_FILE);
  assert.equal(sha256RawBytes(committed), V3_SHA256);
  assert.equal(sha256RawBytes(read(v3.RECEIPT_FILE)), RECEIPT_SHA256);
  assert.deepEqual(Buffer.from(`${JSON.stringify(build(), null, 2)}\n`, 'utf8'), committed);

  const catalog = readJson(v3.V3_FILE);
  assert.equal(catalog.name, v3.V3_IDENTITY);
  assert.equal(catalog.supersedes.identity, v3.V2.identity);
  assert.equal(catalog.supersedes.rawSha256, v3.V2.rawSha256);
  assert.equal(catalog.supersedes.overwritten, false);
  assert.equal(catalog.semanticContractReceipt.rawSha256, RECEIPT_SHA256);
  assert.deepEqual(catalog.historicalLineage.map(row => [row.rawSha256, row.rebuiltFromHere]), [
    [UNCHANGED['local-memory-inference-p1b6-skeleton-effective-current.json'], false],
    [UNCHANGED['local-memory-inference-p1b6-skeleton-exact56.json'], false],
  ]);

  const drifted = readJson(v3.V2.fixture);
  drifted.candidates[0].humanLabel = 'ESCALATE';
  assert.throws(() => build({
    v2: Buffer.from(`${JSON.stringify(drifted, null, 2)}\n`, 'utf8'),
  }), /not the pinned artifact/);
});

test('v3 has 56 active skeletons, 24 / 16 / 16 splits and 42 CLEAR / 14 ESCALATE', () => {
  const catalog = readJson(v3.V3_FILE);
  const count = field => catalog.candidates.reduce((totals, row) => {
    totals[row[field]] = (totals[row[field]] || 0) + 1;
    return totals;
  }, {});
  assert.equal(catalog.candidates.length, 56);
  assert.equal(new Set(catalog.candidates.map(row => row.semanticSkeletonId)).size, 56);
  assert.deepEqual(count('splitAssignment'), { TRAIN: 24, DEV: 16, FINAL_HELD_OUT: 16 });
  assert.deepEqual(count('humanLabel'), { CLEAR: 42, ESCALATE: 14 });
  assert.deepEqual(catalog.coverage.humanLabelCounts, { CLEAR: 42, ESCALATE: 14 });
  assert.deepEqual(catalog.coverage.boundaryClassSplitCounts,
    readJson(v3.V2.fixture).coverage.boundaryClassSplitCounts);
});

test('exactly three skeletons flip CLEAR -> ESCALATE, two are replaced, 51 are inherited', () => {
  const catalog = readJson(v3.V3_FILE);
  const v2 = readJson(v3.V2.fixture);
  const replaced = new Map(v3.RETIREMENTS.map(row => [row.retired, row.replacement]));
  const flipped = [];
  let inherited = 0;
  v2.candidates.forEach((before, index) => {
    const row = catalog.candidates[index];
    // Split, boundary class and contrast-group slot never move, for any row.
    assert.equal(row.splitAssignment, before.splitAssignment);
    assert.equal(row.boundaryClass, before.boundaryClass);
    assert.equal(row.contrastGroupId, before.contrastGroupId);
    if (replaced.has(before.semanticSkeletonId)) {
      assert.equal(row.semanticSkeletonId, replaced.get(before.semanticSkeletonId));
      assert.equal(row.splitAssignment, 'TRAIN');
      assert.equal(row.boundaryClass, 'APPROXIMATION / RANGE');
      assert.equal(row.humanLabel, 'ESCALATE');
      assert.notEqual(row.candidateFocus, before.candidateFocus);
      return;
    }
    assert.equal(row.semanticSkeletonId, before.semanticSkeletonId);
    if (before.humanLabel !== row.humanLabel) {
      flipped.push(row.semanticSkeletonId);
      assert.equal(before.humanLabel, 'CLEAR');
      assert.equal(row.humanLabel, 'ESCALATE');
      assert.notDeepEqual(row.semanticRelations, before.semanticRelations);
      return;
    }
    inherited += 1;
    assert.deepEqual(row, before, row.semanticSkeletonId);
  });
  assert.deepEqual(flipped, [...v3.AMENDED_SKELETON_IDS].sort((a, b) =>
    v2.candidates.findIndex(row => row.semanticSkeletonId === a)
    - v2.candidates.findIndex(row => row.semanticSkeletonId === b)));
  assert.equal(inherited, 51);

  // The f58de slot keeps its TRAIN contrast group; 28736 had none and gains none.
  const byId = new Map(catalog.candidates.map(row => [row.semanticSkeletonId, row]));
  assert.equal(byId.get('p1b6-sk-53ab63517113df16').contrastGroupId, 'p1b6-cg-084af1a6a0723538');
  assert.equal(Object.hasOwn(byId.get('p1b6-sk-0768ea2028f18511'), 'contrastGroupId'), false);
  // aebbf047 and 869c7127 keep their v2 CLEAR semantics exactly.
  for (const id of ['p1b6-sk-aebbf047d6864a35', 'p1b6-sk-869c71279b6b8a33']) {
    assert.deepEqual(byId.get(id), v2.candidates.find(row => row.semanticSkeletonId === id));
  }
});

test('retired IDs are gone from v3, replacement IDs are opaque and new', () => {
  const catalog = readJson(v3.V3_FILE);
  const ids = catalog.candidates.map(row => row.semanticSkeletonId);
  const historical = ['local-memory-inference-p1b6-skeleton-exact56.json',
    'local-memory-inference-p1b6-skeleton-effective-current.json', v3.V2.fixture]
    .flatMap(file => readJson(file).candidates.map(row => row.semanticSkeletonId));
  for (const { retired, replacement } of v3.RETIREMENTS) {
    assert.equal(ids.includes(retired), false, retired);
    assert.equal(ids.includes(replacement), true, replacement);
    assert.equal(historical.includes(replacement), false, replacement);
    assert.match(replacement, /^p1b6-sk-[0-9a-f]{16}$/u);
    assert.notEqual(replacement.slice(8), retired.slice(8));
  }
  // The retired IDs stay intact in v2.
  const v2Ids = readJson(v3.V2.fixture).candidates.map(row => row.semanticSkeletonId);
  assert.equal(v3.RETIREMENTS.every(row => v2Ids.includes(row.retired)), true);

  const receipt = readJson(v3.RECEIPT_FILE);
  for (const row of receipt.retirements) {
    assert.equal(row.historicalSurfacesTransferred, false);
    assert.equal(row.humanDecisionsTransferred, false);
    assert.equal(row.retirementReason, 'SKELETON_LEVEL_REALIZABILITY_FAILURE');
    assert.equal(row.intendedUnresolvedReadings.length, 2);
  }
  // The old range / choice-set / revision semantics are not carried into the 28736 replacement.
  const replacement = catalog.candidates.find(row => row.semanticSkeletonId === 'p1b6-sk-0768ea2028f18511');
  assert.equal(/선택지|수정 순서/u.test(replacement.semanticRelations.join(' ')), false);
});

test('the receipt carries the given-status rule and supersedes only unknownIsNotAmbiguity', () => {
  const rule = readJson(v3.RECEIPT_FILE).interpretationRule;
  assert.equal(rule.identity, 'P1B6_SEMANTIC_CONTRACT_V3');
  assert.deepEqual(rule.supersededV2Clauses, ['unknownIsNotAmbiguity']);
  assert.match(rule.uncertaintyDistinction, /itself given is CLEAR/u);
  assert.match(rule.targetBoundary, /not a downstream inference/u);
  assert.deepEqual(readJson(v3.V3_FILE).mixedRealizationEscalateSkeletonIds,
    [...v3.MIXED_REALIZATION_SKELETON_IDS]);
});

test('the builder rejects a widened, narrowed or rebound change set', () => {
  assert.throws(() => build({ receipt: withReceipt(row => { row.amendments.pop(); }) }),
    /must amend exactly/);
  assert.throws(() => build({
    receipt: withReceipt(row => { row.amendments[0].semanticSkeletonId = 'p1b6-sk-aebbf047d6864a35'; }),
  }), /must amend exactly/);
  assert.throws(() => build({
    receipt: withReceipt(row => { row.amendments[0].toHumanLabel = 'CLEAR'; }),
  }), /not a CLEAR to ESCALATE transition/);
  assert.throws(() => build({
    receipt: withReceipt(row => { row.amendments[0].semanticRelations = []; }),
  }), /does not re-encode/);
  assert.throws(() => build({
    receipt: withReceipt(row => { row.amendments[0].splitAssignment = 'DEV'; }),
  }), /does not match the v2 row/);
  assert.throws(() => build({
    receipt: withReceipt(row => { row.retirements[0].replacementSkeletonId = 'p1b6-sk-000035b8df850b3e'; }),
  }), /exactly the two approved skeletons/);
  assert.throws(() => build({
    receipt: withReceipt(row => { row.retirements[1].historicalSurfacesTransferred = true; }),
  }), /transfers historical evidence/);
  assert.throws(() => build({
    receipt: withReceipt(row => { row.retirements[0].splitAssignment = 'DEV'; }),
  }), /transfers historical evidence|invalid/);
  assert.throws(() => build({
    receipt: withReceipt(row => { row.retirements[1].contrastGroupSlot = 'INHERITED'; }),
  }), /does not match the v2 row/);
  assert.throws(() => build({
    receipt: withReceipt(row => { row.derivationBase.rawSha256 = 'x'.repeat(64); }),
  }), /provenance bindings are invalid/);
  assert.throws(() => build({
    receipt: withReceipt(row => { row.interpretationRule.supersededV2Clauses = []; }),
  }), /complete v3 interpretation rule/);
  for (const claim of [true, 'true', 1]) {
    assert.throws(() => build({
      receipt: withReceipt(row => { row.authority.datasetAcceptancePerformed = claim; }),
    }), /claims authority/);
  }
});
