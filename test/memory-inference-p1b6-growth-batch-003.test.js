'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const plan = require('../scripts/build-memory-inference-p1b6-batch-003-authoring-plan');

const ROOT = path.resolve(__dirname, '..');
const fixture = file => path.join(ROOT, 'fixtures', file);
const read = file => fs.readFileSync(fixture(file));
const readJson = file => JSON.parse(read(file));

const ZERO_COVERED = 'p1b6-sk-aebbf047d6864a35';
const PROTOCOL_SHA256 = '33c39777583009aaaa570718ae26741b6a2562e2006d4a4e428c60d47bdcc447';

// Historical artifacts this authoring step must leave byte-identical.
const UNCHANGED = Object.freeze({
  'lib/memory-inference-p1b6-surfaces.js':
    '4b6dabf2280529b138efe124f32252c2ff7a2b9a118d7eb2c2b3341c7c56f1b7',
  'fixtures/local-memory-inference-p1b6-skeleton-exact56.json':
    '772f07bd679a9c98ea65feaa164ec7a9c1f3e3fb33632052ef076f8301999602',
  'fixtures/local-memory-inference-p1b6-skeleton-effective-current.json':
    '48490b6e4e1494856ef3268d944da16093c4735d207e07c1fd9e8bbf69df2559',
  'fixtures/local-memory-inference-p1b6-surface-batch-001.json':
    '2a4605f5550118754c315e26700aef1be96a3129a3ef0065fd2accdad5352a36',
  'fixtures/local-memory-inference-p1b6-surface-batch-002.json':
    'ed68a562a67deee4d8e92d3e4841362d9589f876480d174a043d822cbf61e80c',
  'fixtures/local-memory-inference-p1b6-smoke-batch-001-acceptance.json':
    '449318d5d3895fca87257a40b7d47b6d8d8eb3df8e9817fff5998a34d658bb5c',
  'fixtures/local-memory-inference-p1b6-surface-effective-current-batch-002.json':
    '9701db8902ae99dc5c08cffb176bf9247443884910e3002b77548ac5436157d1',
  'fixtures/local-memory-inference-p1b6-primary-human-accepted-current-batch-002.json':
    '32b2221e2cefdb9a1a7e47efa1f5accd3d2a915c3f418578dc8f1c314b5281c4',
  'fixtures/local-memory-inference-p1b6-batch-002-acceptance.json':
    'c03b8dcf4ddcb2c5f8b193cde8247b9ad64b8ea676da51cab1d709795b273598',
  'fixtures/local-memory-inference-p1b6-surface-repair-primary-human-review-batch-002-attempt-001.json':
    'cab70e8a277189e0eee1847adcc89e114139363f20cebb95d39c7153fac30f04',
});

const inputs = () => plan.loadCanonicalInputs();
const bundle = () => plan.buildPlan(inputs());

test('canonical seed artifacts are pinned by identity and raw SHA', () => {
  for (const [key, pinned] of Object.entries(plan.CANONICAL_INPUTS)) {
    assert.equal(sha256RawBytes(read(pinned.fixture)), pinned.rawSha256, key);
    assert.equal(readJson(pinned.fixture).name, pinned.identity, key);
  }

  // Byte drift, identity drift and missing bytes all fail closed.
  for (const key of Object.keys(plan.CANONICAL_INPUTS)) {
    const drifted = inputs();
    const marked = JSON.parse(drifted[key].toString('utf8'));
    marked.driftMarker = true;
    drifted[key] = plan.artifactBytes(marked);
    assert.throws(() => plan.buildPlan(drifted), /not the canonical evidence/, `${key} bytes`);

    const renamed = inputs();
    const other = JSON.parse(renamed[key].toString('utf8'));
    other.name = 'xion-local-memory-inference-p1b6-not-canonical-v1';
    renamed[key] = plan.artifactBytes(other);
    assert.throws(() => plan.buildPlan(renamed),
      /not the canonical evidence|identity is not canonical/, `${key} identity`);

    const missing = inputs();
    delete missing[key];
    assert.throws(() => plan.buildPlan(missing), /were not supplied/, `${key} missing`);
  }
  assert.throws(() => plan.buildPlan(undefined), /were not supplied/);
});

test('the accepted seed reconstructs to exactly 93 with the expected marginals', () => {
  const { seed } = bundle();
  assert.equal(seed.total, 93);
  assert.deepEqual(seed.split, { TRAIN: 56, DEV: 16, FINAL_HELD_OUT: 21 });
  assert.deepEqual(seed.label, { CLEAR: 57, ESCALATE: 36 });
  assert.deepEqual(seed.language, { KO: 65, MIXED: 18, EN: 10 });
  assert.deepEqual(seed.fragments, { 1: 18, 2: 26, 3: 27, 4: 17, 5: 5 });

  // The seed is rebuilt from the acceptance artifacts, not copied from a constant.
  assert.equal(seed.rows.length, 93);
  assert.equal(readJson('local-memory-inference-p1b6-smoke-batch-001-acceptance.json')
    .summary.accepted
    + readJson('local-memory-inference-p1b6-batch-002-acceptance.json').summary.accepted, 93);
});

test('exactly 55 of 56 skeletons have accepted coverage and one has none', () => {
  const { seed } = bundle();
  assert.equal(seed.coveredSkeletons, 55);
  assert.equal(seed.totalSkeletons, 56);
  assert.deepEqual(seed.zeroCoveredSkeletonIds, [ZERO_COVERED]);

  const catalog = readJson('local-memory-inference-p1b6-skeleton-effective-current.json');
  const zero = catalog.candidates.find(row => row.semanticSkeletonId === ZERO_COVERED);
  assert.equal(zero.splitAssignment, 'DEV');
  assert.equal(zero.humanLabel, 'ESCALATE');
  assert.equal(zero.boundaryClass, 'COMPLEMENTARY EVIDENCE');
});

test('the tranche is 304 with a 17-candidate buffer over a 287 no-loss shortage', () => {
  const derived = bundle().plan;
  assert.equal(derived.noLossShortage, 287);
  assert.equal(derived.trancheSize, 304);
  assert.equal(derived.buffer, 17);
  assert.equal(plan.TRANCHE_SIZE, 304);

  // Every deficit dimension independently totals the same shortage.
  for (const [name, counts] of Object.entries(derived.deficits)) {
    assert.equal(Object.values(counts).reduce((left, right) => left + right, 0), 287, name);
  }
  assert.deepEqual(derived.deficits.split, { TRAIN: 184, DEV: 44, FINAL_HELD_OUT: 59 });
  assert.deepEqual(derived.deficits.label, { CLEAR: 133, ESCALATE: 154 });
});

test('derived tranche marginals match the frozen targets', () => {
  const derived = bundle().plan;
  assert.deepEqual(derived.split, { TRAIN: 195, DEV: 47, FINAL_HELD_OUT: 62 });
  assert.deepEqual(derived.label, { CLEAR: 141, ESCALATE: 163 });
  assert.deepEqual(derived.language, { KO: 213, MIXED: 61, EN: 30 });
  assert.deepEqual(derived.fragments, { 1: 55, 2: 78, 3: 99, 4: 56, 5: 16 });

  for (const counts of [derived.split, derived.label, derived.language, derived.fragments]) {
    assert.equal(Object.values(counts).reduce((left, right) => left + right, 0), 304);
  }

  // All eight discourse patterns exactly 38 each.
  assert.equal(Object.keys(derived.discoursePatterns).length, 8);
  assert.deepEqual([...new Set(Object.values(derived.discoursePatterns))], [38]);
  assert.equal(Object.values(derived.discoursePatterns)
    .reduce((left, right) => left + right, 0), 304);
});

test('HELD mandatory shortage is 59 and the buffer lands 2 CLEAR / 1 ESCALATE', () => {
  const { heldAllocation, plan: derived } = bundle();
  assert.equal(heldAllocation.mandatoryTotal, 59);
  assert.deepEqual(heldAllocation.mandatoryLabel, { CLEAR: 45, ESCALATE: 14 });
  assert.equal(heldAllocation.bufferTotal, 3);
  assert.deepEqual(heldAllocation.bufferByLabel, { CLEAR: 2, ESCALATE: 1 });
  assert.deepEqual(heldAllocation.trancheLabel, { CLEAR: 47, ESCALATE: 15 });
  assert.equal(heldAllocation.trancheLabel.CLEAR + heldAllocation.trancheLabel.ESCALATE,
    derived.split.FINAL_HELD_OUT);

  // needTo5 is derived per skeleton, and no held skeleton is left short.
  assert.equal(heldAllocation.mandatory.length, 16);
  for (const row of heldAllocation.mandatory) {
    assert.equal(row.needTo5, Math.max(0, 5 - row.currentAccepted), row.semanticSkeletonId);
    assert.equal(heldAllocation.planned.get(row.semanticSkeletonId) >= row.needTo5, true);
  }
  assert.equal(heldAllocation.mandatory
    .reduce((total, row) => total + row.needTo5, 0), 59);

  // Buffer skeletons follow larger needTo5 first, then lexical ID.
  for (const assignment of heldAllocation.bufferAssignments) {
    const row = heldAllocation.mandatory
      .find(entry => entry.semanticSkeletonId === assignment.semanticSkeletonId);
    assert.equal(row.humanLabel, assignment.humanLabel);
    const better = heldAllocation.mandatory.filter(entry => entry.humanLabel === assignment.humanLabel
      && (entry.needTo5 > row.needTo5
        || (entry.needTo5 === row.needTo5 && entry.semanticSkeletonId < row.semanticSkeletonId)));
    assert.equal(better.length <= heldAllocation.bufferAssignments.length, true);
  }
});

test('TRAIN and DEV label cells are 76/119 and 18/29', () => {
  const { trainDev, plan: derived, heldAllocation } = bundle();
  assert.deepEqual(trainDev.cells.TRAIN, { CLEAR: 76, ESCALATE: 119 });
  assert.deepEqual(trainDev.cells.DEV, { CLEAR: 18, ESCALATE: 29 });
  assert.deepEqual(trainDev.remaining, { CLEAR: 94, ESCALATE: 148 });

  assert.equal(trainDev.cells.TRAIN.CLEAR + trainDev.cells.TRAIN.ESCALATE, 195);
  assert.equal(trainDev.cells.DEV.CLEAR + trainDev.cells.DEV.ESCALATE, 47);
  for (const label of plan.LABELS) {
    assert.equal(trainDev.cells.TRAIN[label] + trainDev.cells.DEV[label]
      + heldAllocation.trancheLabel[label], derived.label[label], label);
  }
});

test('skeleton assignments follow the deterministic rule and total 304', () => {
  const { seed, skeletonAssignments, artifacts, trainDev, heldAllocation } = bundle();
  const total = [...skeletonAssignments.values()].reduce((left, right) => left + right, 0);
  assert.equal(total, 304);
  assert.equal(skeletonAssignments.size, 56);

  const skeletons = new Map(artifacts.effectiveCatalog.candidates
    .map(row => [row.semanticSkeletonId, row]));
  const bySplit = {};
  const byLabel = {};
  for (const [skeletonId, count] of skeletonAssignments) {
    const skeleton = skeletons.get(skeletonId);
    bySplit[skeleton.splitAssignment] = (bySplit[skeleton.splitAssignment] || 0) + count;
    byLabel[skeleton.humanLabel] = (byLabel[skeleton.humanLabel] || 0) + count;
  }
  assert.deepEqual(bySplit, { TRAIN: 195, DEV: 47, FINAL_HELD_OUT: 62 });
  assert.deepEqual(byLabel, { CLEAR: 141, ESCALATE: 163 });

  // Per split x label cell the assignment matches the derived cell.
  for (const split of ['TRAIN', 'DEV']) {
    for (const label of plan.LABELS) {
      const cell = [...skeletonAssignments.entries()]
        .filter(([id]) => skeletons.get(id).splitAssignment === split
          && skeletons.get(id).humanLabel === label)
        .reduce((total2, [, count]) => total2 + count, 0);
      assert.equal(cell, trainDev.cells[split][label], `${split}/${label}`);
    }
  }
  for (const row of heldAllocation.mandatory) {
    assert.equal(skeletonAssignments.get(row.semanticSkeletonId),
      heldAllocation.planned.get(row.semanticSkeletonId), row.semanticSkeletonId);
  }

  // Deterministic: the same canonical inputs give the same assignment.
  assert.deepEqual([...bundle().skeletonAssignments.entries()].sort(),
    [...skeletonAssignments.entries()].sort());

  // The sole zero-covered skeleton receives new DEV/ESCALATE candidates.
  assert.equal(skeletonAssignments.get(ZERO_COVERED) >= 1, true);
  assert.equal(seed.coverage.get(ZERO_COVERED), undefined);
  assert.equal(skeletons.get(ZERO_COVERED).splitAssignment, 'DEV');
  assert.equal(skeletons.get(ZERO_COVERED).humanLabel, 'ESCALATE');
});

test('the authoring protocol records the plan and claims no completed gate', () => {
  assert.equal(sha256RawBytes(read(plan.PROTOCOL_FILE)), PROTOCOL_SHA256);
  const protocol = readJson(plan.PROTOCOL_FILE);
  assert.equal(protocol.name, plan.PROTOCOL_IDENTITY);
  assert.equal(protocol.batchId, plan.BATCH_003_ID);
  assert.equal(protocol.interpretationRule, plan.INTERPRETATION_RULE);

  // Regenerates deterministically from the canonical inputs.
  assert.deepEqual(plan.artifactBytes(plan.buildAuthoringProtocol(bundle())),
    read(plan.PROTOCOL_FILE));

  // Binds the seed inputs and the authoring semantic authority by identity and raw SHA.
  assert.equal(protocol.semanticAuthority.rawSha256,
    plan.CANONICAL_INPUTS.effectiveCatalog.rawSha256);
  assert.equal(protocol.semanticAuthority.role, 'AUTHORING_SEMANTIC_AUTHORITY');
  for (const key of ['batch001', 'smokeAcceptance', 'batch002Successor', 'batch002Human',
    'batch002Acceptance']) {
    assert.equal(protocol.acceptedSeedInputs[key].rawSha256,
      plan.CANONICAL_INPUTS[key].rawSha256, key);
  }

  // Records the derivation, not just the totals.
  assert.equal(protocol.tranche.noLossShortage, 287);
  assert.equal(protocol.tranche.size, 304);
  assert.equal(protocol.tranche.buffer, 17);
  assert.equal(protocol.heldAllocation.mandatoryTotal, 59);
  assert.equal(protocol.heldAllocation.perSkeleton.length, 16);
  assert.deepEqual(protocol.acceptedSeedCoverage.zeroCoveredSkeletonIds, [ZERO_COVERED]);
  assert.equal(Object.keys(protocol.plannedSkeletonCounts).length, 56);
  assert.equal(protocol.allocationRules.zeroCoverageRequirement.includes('NOT a repair'), true);

  // Unavailable generator metadata is marked unavailable, never invented.
  assert.equal(protocol.generatorProvenance.samplingControls, 'UNAVAILABLE_PLATFORM_CONTROLLED');
  assert.equal(protocol.generatorProvenance.modelSamplingParameters,
    'NOT_INDEPENDENTLY_RECOVERABLE');

  // No downstream gate is claimed, and the authoring labels are not HUMAN gold.
  for (const [key, value] of Object.entries(protocol.gatesNotYetRun)) {
    assert.equal(value, false, key);
  }
  for (const [key, value] of Object.entries(protocol.authority)) {
    if (key !== 'note') assert.equal(value, false, key);
  }
  assert.equal(protocol.authority.authoringSemanticLabelsAreHumanGold, false);
  assert.equal(protocol.nextGate, 'FRESH_SOURCE_AUDIT_OF_ALL_304_ROWS');
  assert.equal(protocol.status, 'AUTHORING_PLAN_FROZEN_SURFACES_NOT_YET_AUTHORED');
});

test('the batch-003 validator is wired and fails closed before any surface exists', () => {
  const built = bundle();
  assert.equal(typeof plan.validateBatch003, 'function');
  assert.throws(() => plan.validateBatch003({ name: 'wrong' }, built),
    /identity or batchId is not canonical/);
  assert.throws(() => plan.validateBatch003({
    name: plan.BATCH_003_IDENTITY, batchId: plan.BATCH_003_ID,
    sourceEpisodes: [], items: [],
  }, built), /P1-B6/);

  // The batch-003 surface fixture is authored in a later step; it is not claimed to exist yet.
  assert.equal(fs.existsSync(fixture(plan.BATCH_003_FILE)), false);
});

test('historical artifacts remain byte-identical and no gate result is invented', () => {
  for (const [file, sha] of Object.entries(UNCHANGED)) {
    assert.equal(sha256RawBytes(fs.readFileSync(path.join(ROOT, file))), sha, file);
  }

  // Nothing in this step encodes a HUMAN decision, an audit disposition, or an acceptance
  // outcome. The plan knows the CLEAR/ESCALATE label vocabulary because it allocates authoring
  // targets, but it must carry no review or audit verdict vocabulary at all.
  const source = fs.readFileSync(path.join(ROOT,
    'scripts/build-memory-inference-p1b6-batch-003-authoring-plan.js'), 'utf8');
  const code = source.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  for (const token of ['PASS', 'UNCERTAIN', 'disposition', 'KEEP', 'REJECT']) {
    assert.equal(code.includes(token), false, token);
  }
  const protocol = readJson(plan.PROTOCOL_FILE);
  const serialized = JSON.stringify(protocol);
  for (const token of ['"PASS"', '"disposition"', '"KEEP"', '"REJECT"']) {
    assert.equal(serialized.includes(token), false, token);
  }

  // The authoring targets are explicitly denied gold status rather than left ambiguous.
  assert.equal(protocol.authority.authoringSemanticLabelsAreHumanGold, false);
  assert.equal(protocol.authority.note.includes('NOT HUMAN gold'), true);
  assert.equal(protocol.gatesNotYetRun.surfacesAuthored, false);
});
