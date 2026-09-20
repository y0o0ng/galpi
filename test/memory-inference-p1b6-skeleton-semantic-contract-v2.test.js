'use strict';

// P1-B6 semantic contract v2: the successor semantic authority at 45 CLEAR / 11 ESCALATE.
//
// Nothing here executes a review, adjudicates anything, freezes a label, or accepts a dataset.
// These tests pin the derivation boundary: v2 comes from the exact raw bytes of the committed
// v1 catalog, the amendment set is closed at 11, and no historical artifact moves.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const v2 = require('../scripts/build-memory-inference-p1b6-skeleton-semantic-contract-v2');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, 'fixtures', file));
const readJson = file => JSON.parse(read(file));

const V2_SHA256 = 'f1e780195441246402ca389da188b1f7b8c4970f42fc1e6e3de2f436a3e9377c';
const RECEIPT_SHA256 = 'a12063c38eee6245122e655126708c904319b4a7467cf82084acdea17a293344';

// Historical artifacts this succession must leave byte-identical.
const UNCHANGED = Object.freeze({
  'local-memory-inference-p1b6-skeleton-exact56.json':
    '772f07bd679a9c98ea65feaa164ec7a9c1f3e3fb33632052ef076f8301999602',
  'local-memory-inference-p1b6-skeleton-effective-current.json':
    '48490b6e4e1494856ef3268d944da16093c4735d207e07c1fd9e8bbf69df2559',
  'local-memory-inference-p1b6-skeleton-semantic-amendment-receipt.json':
    '2778f64cf9f8f15bc85b7d015b706f5e87ad20e9dafc1249357477b235744977',
  'local-memory-inference-p1b6-surface-batch-003.json':
    '90b453c3680bccaa537fd0d23db74bbc303882e1a35a2ddcea0b75b013fcaa68',
  'local-memory-inference-p1b6-surface-batch-003-authoring-protocol.json':
    '33c39777583009aaaa570718ae26741b6a2562e2006d4a4e428c60d47bdcc447',
  'local-memory-inference-p1b6-surface-batch-003-materialization-receipt.json':
    '6f6efdff15cb488cb1f63d075f15bda10350a92c0c9176d0f9e19a9b289b2fa0',
  'local-memory-inference-p1b6-source-audit-batch-003-attempt-001.json':
    '3c840476bea6eccb522800248a3ace277b26a5334ec56b5f6b10bbf4d5821221',
  'local-memory-inference-p1b6-large-batch-review-authority-amendment.json':
    '821b0cb07580b4c2ac776014d88c78333263900759ca94d1746b4934964ffc0e',
  'local-memory-inference-p1b6-strong-model-semantic-review-protocol.json':
    '2f97028fe5bb9612a0750140754136785f99d07f93f7924c697a5b67990c16c4',
  'local-memory-inference-p1b6-batch-002-acceptance.json':
    'c03b8dcf4ddcb2c5f8b193cde8247b9ad64b8ea676da51cab1d709795b273598',
  'local-memory-inference-p1b6-smoke-batch-001-acceptance.json':
    '449318d5d3895fca87257a40b7d47b6d8d8eb3df8e9817fff5998a34d658bb5c',
});

const sources = () => ({
  v1: read(v2.V1.fixture),
  receipt: read(v2.RECEIPT_FILE),
  exact56: read(v2.EXACT56.fixture),
});
const build = (overrides = {}) => {
  const { v1, receipt, exact56 } = { ...sources(), ...overrides };
  return v2.buildEffectiveCurrentV2(v1, receipt, exact56);
};
const withReceipt = mutate => {
  const receipt = readJson(v2.RECEIPT_FILE);
  mutate(receipt);
  return Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
};

test('historical Exact56, v1 and the frozen batch artifacts remain byte-identical', () => {
  for (const [file, sha] of Object.entries(UNCHANGED)) {
    assert.equal(sha256RawBytes(read(file)), sha, file);
  }
  // v1 is superseded, not overwritten: it is still on disk, still 34 / 22, still v1 identity.
  const v1 = readJson(v2.V1.fixture);
  assert.equal(v1.name, v2.V1.identity);
  assert.equal(v1.candidates.filter(row => row.humanLabel === 'CLEAR').length, 34);
  assert.equal(v1.candidates.filter(row => row.humanLabel === 'ESCALATE').length, 22);
});

test('v2 is deterministic and derives from the exact canonical v1 bytes', () => {
  const committed = read(v2.V2_FILE);
  assert.equal(sha256RawBytes(committed), V2_SHA256);
  assert.equal(sha256RawBytes(read(v2.RECEIPT_FILE)), RECEIPT_SHA256);
  assert.deepEqual(v2.artifactBytes(build()), committed);

  const catalog = readJson(v2.V2_FILE);
  assert.equal(catalog.name, v2.V2_IDENTITY);
  assert.equal(catalog.status, 'ACTIVE_PROSPECTIVE_SEMANTIC_AUTHORITY');
  assert.equal(catalog.supersedes.identity, v2.V1.identity);
  assert.equal(catalog.supersedes.rawSha256, v2.V1.rawSha256);
  assert.equal(catalog.supersedes.overwritten, false);
  assert.equal(catalog.semanticContractReceipt.rawSha256, RECEIPT_SHA256);

  // Exact56 stays lineage provenance and is explicitly not a second rebuild path.
  assert.equal(catalog.historicalBase.identity, v2.EXACT56.identity);
  assert.equal(catalog.historicalBase.rawSha256, v2.EXACT56.rawSha256);
  assert.equal(catalog.historicalBase.rebuiltFromHere, false);

  // Drifted historical bytes fail closed on both pinned inputs.
  const driftedV1 = readJson(v2.V1.fixture);
  driftedV1.candidates[0].humanLabel = 'ESCALATE';
  assert.throws(() => build({
    v1: Buffer.from(`${JSON.stringify(driftedV1, null, 2)}\n`, 'utf8'),
  }), /not the pinned artifact/);
  assert.throws(() => build({ exact56: Buffer.from('{}', 'utf8') }), /not the pinned artifact/);
});

test('exactly 11 skeletons are amended and 45 are inherited unchanged', () => {
  const catalog = readJson(v2.V2_FILE);
  const v1 = readJson(v2.V1.fixture);
  const amended = new Set(v2.AMENDED_SKELETON_IDS);
  assert.equal(amended.size, 11);

  let changed = 0;
  let inherited = 0;
  catalog.candidates.forEach((row, index) => {
    const before = v1.candidates[index];
    if (amended.has(row.semanticSkeletonId)) {
      changed += 1;
      assert.equal(before.humanLabel, 'ESCALATE', row.semanticSkeletonId);
      assert.equal(row.humanLabel, 'CLEAR', row.semanticSkeletonId);
      // Not a bare label flip: the semantics are re-encoded and a contract is recorded.
      assert.notEqual(row.candidateFocus, before.candidateFocus, row.semanticSkeletonId);
      assert.notDeepEqual(row.semanticRelations, before.semanticRelations,
        row.semanticSkeletonId);
      assert.equal(typeof row.interpretationContract === 'string'
        && row.interpretationContract.trim() !== '', true, row.semanticSkeletonId);
      return;
    }
    inherited += 1;
    assert.deepEqual(row, before, row.semanticSkeletonId);
  });
  assert.equal(changed, 11);
  assert.equal(inherited, 45);
});

test('the v2 distribution is exactly 45 CLEAR / 11 ESCALATE with the approved set', () => {
  const catalog = readJson(v2.V2_FILE);
  const counts = catalog.candidates.reduce((totals, row) => {
    totals[row.humanLabel] = (totals[row.humanLabel] || 0) + 1;
    return totals;
  }, {});
  assert.deepEqual(counts, { CLEAR: 45, ESCALATE: 11 });
  assert.deepEqual(counts, v2.EXPECTED_LABELS);
  assert.deepEqual(catalog.coverage.humanLabelCounts, { CLEAR: 45, ESCALATE: 11 });

  const escalate = catalog.candidates.filter(row => row.humanLabel === 'ESCALATE')
    .map(row => row.semanticSkeletonId).sort();
  assert.deepEqual(escalate, [...v2.SURVIVING_ESCALATE_SKELETON_IDS].sort());
  assert.equal(escalate.some(id => v2.AMENDED_SKELETON_IDS.includes(id)), false);

  // The four mixed skeletons keep ESCALATE at skeleton level and carry an explicit note that
  // individual surfaces may collapse and must be judged at surface QA time.
  const receipt = readJson(v2.RECEIPT_FILE);
  assert.deepEqual(receipt.mixedRealizationEscalateSkeletons.map(row => row.semanticSkeletonId),
    [...v2.MIXED_REALIZATION_SKELETON_IDS]);
  for (const row of receipt.mixedRealizationEscalateSkeletons) {
    assert.equal(escalate.includes(row.semanticSkeletonId), true, row.semanticSkeletonId);
    assert.equal(row.skeletonLabel, 'ESCALATE');
    assert.equal(row.note.trim() === '', false, row.semanticSkeletonId);
  }
  assert.equal(typeof receipt.mixedRealizationPolicy, 'string');
});

test('IDs, order, splits, boundary classes and contrast groups do not drift', () => {
  const catalog = readJson(v2.V2_FILE);
  const v1 = readJson(v2.V1.fixture);
  assert.equal(catalog.candidates.length, 56);
  assert.deepEqual(catalog.candidates.map(row => row.semanticSkeletonId),
    v1.candidates.map(row => row.semanticSkeletonId));
  assert.deepEqual(catalog.candidates.map(row => row.splitAssignment),
    v1.candidates.map(row => row.splitAssignment));
  assert.deepEqual(catalog.candidates.map(row => row.boundaryClass),
    v1.candidates.map(row => row.boundaryClass));
  assert.deepEqual(catalog.candidates.map(row => row.contrastGroupId),
    v1.candidates.map(row => row.contrastGroupId));
  assert.deepEqual(catalog.coverage.splitCounts, v2.EXPECTED_SPLITS);
  assert.deepEqual(catalog.coverage.boundaryClassSplitCounts,
    v1.coverage.boundaryClassSplitCounts);
});

test('the builder rejects an unauthorized, missing or malformed amendment set', () => {
  // A twelfth amendment.
  assert.throws(() => build({
    receipt: withReceipt(row => {
      row.amendments.push({
        semanticSkeletonId: 'p1b6-sk-5229ea237196499d',
        splitAssignment: 'TRAIN',
        boundaryClass: 'FINALITY / COMMITMENT',
        fromHumanLabel: 'ESCALATE',
        toHumanLabel: 'CLEAR',
        candidateFocus: 'x',
        semanticRelations: ['a', 'b'],
        interpretationContract: 'y',
      });
    }),
  }), /exactly 11 amendments/);

  // An amendment targeting a skeleton outside the approved set.
  assert.throws(() => build({
    receipt: withReceipt(row => {
      row.amendments[0].semanticSkeletonId = 'p1b6-sk-5229ea237196499d';
    }),
  }), /amends an unauthorized skeleton/);

  // A missing amendment.
  assert.throws(() => build({
    receipt: withReceipt(row => { row.amendments.pop(); }),
  }), /exactly 11 amendments/);

  // A duplicated amendment that keeps the count at 11.
  assert.throws(() => build({
    receipt: withReceipt(row => { row.amendments[1] = { ...row.amendments[0] }; }),
  }), /amends a skeleton twice/);

  // Wrong from/to labels.
  assert.throws(() => build({
    receipt: withReceipt(row => { row.amendments[0].fromHumanLabel = 'CLEAR'; }),
  }), /not an ESCALATE to CLEAR transition/);
  assert.throws(() => build({
    receipt: withReceipt(row => { row.amendments[0].toHumanLabel = 'ESCALATE'; }),
  }), /not an ESCALATE to CLEAR transition/);

  // A bare label flip that does not re-encode the semantics.
  assert.throws(() => build({
    receipt: withReceipt(row => { row.amendments[0].semanticRelations = []; }),
  }), /does not re-encode candidateFocus/);
  assert.throws(() => build({
    receipt: withReceipt(row => { row.amendments[0].candidateFocus = '  '; }),
  }), /does not re-encode candidateFocus/);
  assert.throws(() => build({
    receipt: withReceipt(row => { delete row.amendments[0].interpretationContract; }),
  }), /does not re-encode candidateFocus/);

  // Split or boundary drift inside an amendment.
  assert.throws(() => build({
    receipt: withReceipt(row => { row.amendments[0].splitAssignment = 'TRAIN'; }),
  }), /does not match the v1 row it amends/);
  assert.throws(() => build({
    receipt: withReceipt(row => { row.amendments[0].boundaryClass = 'REFERENT'; }),
  }), /does not match the v1 row it amends/);

  // A drifted surviving-ESCALATE or mixed-realization declaration.
  assert.throws(() => build({
    receipt: withReceipt(row => { row.survivingEscalateSkeletonIds.pop(); }),
  }), /surviving ESCALATE set/);
  assert.throws(() => build({
    receipt: withReceipt(row => { row.mixedRealizationEscalateSkeletons.pop(); }),
  }), /mixed-realization ESCALATE skeletons/);

  // Provenance rebinding.
  assert.throws(() => build({
    receipt: withReceipt(row => { row.derivationBase.rawSha256 = 'x'.repeat(64); }),
  }), /provenance bindings are invalid/);
  assert.throws(() => build({
    receipt: withReceipt(row => { row.historicalExact56.rebuiltFromHere = true; }),
  }), /provenance bindings are invalid/);
});

test('the receipt cannot claim historical mutation or dataset acceptance', () => {
  const receipt = readJson(v2.RECEIPT_FILE);
  for (const [key, value] of Object.entries(receipt.authority)) {
    assert.equal(value, false, key);
  }
  for (const key of ['historicalExact56Superseded', 'historicalEffectiveCurrentV1Overwritten',
    'historicalHumanDecisionsAltered', 'batch001Or002AcceptanceReopened',
    'batch003SurfacesRegenerated', 'batch003AuthoringProtocolRewritten',
    'strongModelOutputRelabeled', 'datasetAcceptancePerformed', 'referenceLabelFreezePerformed',
    'humanAdjudicationPerformed', 'calibrationPerformed', 'trainingOccurred']) {
    assert.equal(receipt.authority[key], false, key);
  }
  for (const claim of [true, 'true', 1]) {
    assert.throws(() => build({
      receipt: withReceipt(row => { row.authority.datasetAcceptancePerformed = claim; }),
    }), /claims authority it does not have/, String(claim));
  }
  assert.throws(() => build({
    receipt: withReceipt(row => { row.authority.historicalEffectiveCurrentV1Overwritten = true; }),
  }), /claims authority it does not have/);

  // The v1 preservation of 2fa39e is recorded as reversed, not silently rewritten.
  assert.equal(receipt.supersededPriorDecisions[0].semanticSkeletonId,
    'p1b6-sk-2fa39ece4157b2b8');
  assert.equal(receipt.priorAmendmentReceipt.rawSha256,
    UNCHANGED['local-memory-inference-p1b6-skeleton-semantic-amendment-receipt.json']);
});

test('the v2 contract retires label balancing without replacing it with a new ratio', () => {
  const receipt = readJson(v2.RECEIPT_FILE);
  const catalog = readJson(v2.V2_FILE);
  assert.deepEqual(receipt.corpusLabelContract.retiredProspectively,
    [...v2.RETIRED_LABEL_CONTRACTS]);
  assert.equal(receipt.corpusLabelContract.replacedWithNewRatio, false);
  assert.equal(receipt.corpusLabelContract.currentRule,
    'CLEAR_ESCALATE_COUNTS_ARE_A_DERIVED_PROPERTY_OF_SEMANTICALLY_VALID_SELECTED_SURFACES');
  assert.deepEqual(catalog.corpusLabelContract.retiredProspectively,
    [...v2.RETIRED_LABEL_CONTRACTS]);
  assert.equal(catalog.corpusLabelContract.replacedWithNewRatio, false);

  // Unrelated structural contracts are untouched.
  for (const kept of ['total corpus size 380', 'TRAIN / DEV / FINAL_HELD_OUT = 240 / 60 / 80',
    'language totals', 'fragment totals', 'split isolation', 'held skeleton structure']) {
    assert.equal(receipt.corpusLabelContract.unchangedStructuralContracts.includes(kept), true,
      kept);
  }
  // A low held-out positive count is reported, never fixed by relabeling.
  assert.equal(typeof receipt.corpusLabelContract.heldOutPositiveCount, 'string');

  // Batch-003's historical authoring allocation is metadata, and the surfaces are not rebuilt.
  assert.deepEqual(receipt.batch003AuthoringProvenance.frozenAuthoringAllocation,
    { CLEAR: 141, ESCALATE: 163 });
  assert.equal(receipt.batch003AuthoringProvenance.status, 'HISTORICAL_AUTHORING_METADATA_ONLY');

  assert.throws(() => build({
    receipt: withReceipt(row => { row.corpusLabelContract.replacedWithNewRatio = true; }),
  }), /does not retire the label-balancing contracts/);
  assert.throws(() => build({
    receipt: withReceipt(row => { row.corpusLabelContract.retiredProspectively.pop(); }),
  }), /does not retire the label-balancing contracts/);
});

test('the historical large-batch amendment keeps its own 190/190 wording, unmutated', () => {
  const amendment = readJson('local-memory-inference-p1b6-large-batch-review-authority-amendment.json');
  // History records the old rule as it stood; contract v2 supersedes it prospectively rather
  // than editing this artifact.
  assert.equal(amendment.finalCorpusLabelConstraint.constraint, '190 CLEAR / 190 ESCALATE');
  assert.equal(amendment.finalCorpusLabelConstraint.isOver, 'FROZEN_REFERENCE_LABELS');
  assert.equal(sha256RawBytes(read('local-memory-inference-p1b6-large-batch-review-authority-amendment.json')),
    UNCHANGED['local-memory-inference-p1b6-large-batch-review-authority-amendment.json']);

  const receipt = readJson(v2.RECEIPT_FILE);
  assert.equal(receipt.corpusLabelContract.retiredProspectively
    .includes('final corpus exactly 190 CLEAR / 190 ESCALATE'), true);
});
