'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { computeFragments, renderVisibleItem } = require('../lib/memory-inference-p1b6-surfaces');
const sourceAudit = require('../scripts/build-memory-inference-p1b6-source-audit-packet');
const plan = require('../scripts/build-memory-inference-p1b6-batch-003-authoring-plan');
const materialize = require('../scripts/build-memory-inference-p1b6-batch-003-materialize');

const ROOT = path.resolve(__dirname, '..');
const fixture = file => path.join(ROOT, 'fixtures', file);
const read = file => fs.readFileSync(fixture(file));
const readJson = file => JSON.parse(read(file));

const ZERO_COVERED = 'p1b6-sk-aebbf047d6864a35';
const PROTOCOL_SHA256 = '33c39777583009aaaa570718ae26741b6a2562e2006d4a4e428c60d47bdcc447';
const BATCH_003_SHA256 = '90b453c3680bccaa537fd0d23db74bbc303882e1a35a2ddcea0b75b013fcaa68';
const MATERIALIZATION_RECEIPT =
  'local-memory-inference-p1b6-surface-batch-003-materialization-receipt.json';
const MATERIALIZATION_RECEIPT_SHA256 =
  '6f6efdff15cb488cb1f63d075f15bda10350a92c0c9176d0f9e19a9b289b2fa0';

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

test('the materialized batch-003 holds exactly 304 valid candidates', () => {
  const batch = readJson(plan.BATCH_003_FILE);
  assert.equal(sha256RawBytes(read(plan.BATCH_003_FILE)), BATCH_003_SHA256);
  assert.equal(batch.name, plan.BATCH_003_IDENTITY);
  assert.equal(batch.batchId, plan.BATCH_003_ID);
  assert.equal(batch.items.length, 304);
  assert.equal(batch.sourceEpisodes.length, 304);

  // Structural validation against the frozen plan, unweakened.
  assert.doesNotThrow(() => plan.validateBatch003(batch, bundle()));
  assert.throws(() => plan.validateBatch003({ name: 'wrong' }, bundle()),
    /identity or batchId is not canonical/);
  assert.throws(() => plan.validateBatch003({
    name: plan.BATCH_003_IDENTITY, batchId: plan.BATCH_003_ID,
    sourceEpisodes: [], items: [],
  }, bundle()), /P1-B6/);

  // Sequential IDs, one item per episode, unique batch-scoped families.
  batch.items.forEach((item, index) => {
    const ordinal = String(index + 1).padStart(3, '0');
    assert.equal(item.itemId, `p1b6-item-b003-${ordinal}`);
    assert.equal(item.sourceEpisodeId, `p1b6-se-b003-${ordinal}`);
    assert.equal(item.surfaceFamilyId, `p1b6-surface-family-b003-${ordinal}`);
  });
  assert.equal(new Set(batch.sourceEpisodes.map(row => row.sourceFamilyId)).size, 304);
  assert.equal(new Set(batch.items.map(row => row.surfaceFamilyId)).size, 304);
  assert.equal(new Set(batch.items.map(row => row.sourceEpisodeId)).size, 304);

  // Regenerates deterministically from the authored content and the frozen plan.
  const rebuilt = materialize.buildBatch003(materialize.loadAuthoredContent(), bundle());
  assert.deepEqual(plan.artifactBytes(rebuilt), read(plan.BATCH_003_FILE));
});

test('batch-003 marginals and per-skeleton counts match the frozen plan exactly', () => {
  const batch = readJson(plan.BATCH_003_FILE);
  const built = bundle();
  const skeletons = new Map(built.artifacts.effectiveCatalog.candidates
    .map(row => [row.semanticSkeletonId, row]));
  const episodes = new Map(batch.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  const count = values => values.reduce((totals, value) => {
    totals[value] = (totals[value] || 0) + 1;
    return totals;
  }, {});

  // The authoring target label is DERIVED from the effective-current catalog, not stored and
  // not taken from historical Exact56.
  assert.equal(batch.items.some(row => Object.hasOwn(row, 'humanLabel')), false);
  assert.deepEqual(count(batch.items.map(row =>
    skeletons.get(row.semanticSkeletonId).splitAssignment)), built.plan.split);
  assert.deepEqual(count(batch.items.map(row =>
    skeletons.get(row.semanticSkeletonId).humanLabel)), built.plan.label);
  assert.deepEqual(count(batch.items.map(row =>
    episodes.get(row.sourceEpisodeId).language)), built.plan.language);
  assert.deepEqual(count(batch.items.map(row =>
    computeFragments(row, episodes.get(row.sourceEpisodeId)).length)),
  Object.fromEntries(Object.entries(built.plan.fragments)));
  assert.deepEqual(count(batch.items.map(row => row.discoursePattern)),
    built.plan.discoursePatterns);

  // Per-skeleton counts, and every item's split agrees with its skeleton.
  assert.deepEqual(count(batch.items.map(row => row.semanticSkeletonId)),
    Object.fromEntries([...built.skeletonAssignments.entries()]));
  for (const item of batch.items) {
    assert.equal(episodes.get(item.sourceEpisodeId).splitAssignment,
      skeletons.get(item.semanticSkeletonId).splitAssignment, item.itemId);
  }

  // The previously zero-covered skeleton receives its new DEV/ESCALATE realizations.
  assert.equal(batch.items.filter(row => row.semanticSkeletonId === ZERO_COVERED).length,
    built.skeletonAssignments.get(ZERO_COVERED));
  assert.equal(built.skeletonAssignments.get(ZERO_COVERED) >= 1, true);
});

test('anchors and evidence spans are valid UTF-8 byte ranges over the authored text', () => {
  const batch = readJson(plan.BATCH_003_FILE);
  const episodes = new Map(batch.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  for (const item of batch.items) {
    const turns = new Map(episodes.get(item.sourceEpisodeId).turns
      .map(turn => [turn.turnId, turn]));
    const check = span => {
      const bytes = Buffer.from(turns.get(span.turnId).text, 'utf8');
      assert.equal(span.startByte >= 0 && span.endByte > span.startByte
        && span.endByte <= bytes.length, true, item.itemId);
      // Round-tripping proves the boundaries land on code points.
      const slice = bytes.subarray(span.startByte, span.endByte);
      assert.equal(Buffer.compare(Buffer.from(slice.toString('utf8'), 'utf8'), slice), 0,
        item.itemId);
    };
    check(item.anchorSpanRef);
    item.evidenceSpanRefs.forEach(check);
    const covered = item.evidenceSpanRefs.some(span => span.turnId === item.anchorSpanRef.turnId
      && span.startByte <= item.anchorSpanRef.startByte
      && span.endByte >= item.anchorSpanRef.endByte);
    assert.equal(covered, true, item.itemId);

    // Exactly one rendered TARGET pair per item.
    const rendered = renderVisibleItem(batch, item);
    assert.equal(rendered.split('[TARGET]').length - 1, 1, item.itemId);
    assert.equal(rendered.split('[/TARGET]').length - 1, 1, item.itemId);
  }
});

test('batch-003 reuses no prior, pilot or internal conversation or non-trivial turn', () => {
  const batch = readJson(plan.BATCH_003_FILE);
  assert.doesNotThrow(() => plan.validateBatch003Leakage(batch));

  // The guard actually bites: a prior conversation, a prior turn, and an internal duplicate.
  const prior = plan.loadPriorSources();
  const reject = (mutate, pattern, label) => {
    const drifted = structuredClone(batch);
    mutate(drifted);
    assert.throws(() => plan.validateBatch003Leakage(drifted, prior), pattern, label);
  };
  reject(b => { b.sourceEpisodes[0].turns = structuredClone(prior[0].turns); },
    /reuses a prior or pilot conversation/, 'prior conversation');
  reject(b => {
    const reused = prior.flatMap(row => row.turns)
      .find(turn => plan.isNonTrivialTurn(turn.text));
    b.sourceEpisodes[0].turns[0] = { ...b.sourceEpisodes[0].turns[0], text: reused.text };
  }, /non-trivial turn reused from/, 'prior turn');
  reject(b => {
    b.sourceEpisodes[1].turns[0] = { ...b.sourceEpisodes[1].turns[0],
      text: b.sourceEpisodes[0].turns[0].text };
  }, /non-trivial turn reused across/, 'internal duplicate turn');
  reject(b => { b.sourceEpisodes[1].sourceFamilyId = b.sourceEpisodes[0].sourceFamilyId; },
    /identity reused in batch-003|crosses splits/, 'family reuse');

  // Template-reuse diagnostic is a report, never a gate.
  const diagnostic = plan.templateReuseDiagnostic(batch);
  assert.equal(diagnostic.distinctTurns > 1000, true);
  assert.equal(Array.isArray(diagnostic.mostRepeated), true);
});

test('a fresh source-audit packet builds for all 304 rows with no answer leakage', () => {
  const batch = readJson(plan.BATCH_003_FILE);
  const packet = sourceAudit.buildAuditPacket(read(plan.BATCH_003_FILE));
  assert.equal(packet.rows.length, 304);
  assert.equal(new Set(packet.rows.map(row => row.auditRowId)).size, 304);

  const batchSha = sha256RawBytes(read(plan.BATCH_003_FILE));
  const byId = new Map(packet.rows.map(row => [row.auditRowId, row]));
  const episodes = new Map(batch.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  for (const item of batch.items) {
    const row = byId.get(sourceAudit.opaqueAuditRowId(batchSha, item.itemId));
    assert.equal(Boolean(row), true, item.itemId);
    assert.deepEqual(row.sourceEpisode.turns, episodes.get(item.sourceEpisodeId).turns);
    assert.equal(row.selectedBundle, renderVisibleItem(batch, item), item.itemId);
  }

  // No generator target, skeleton label, HUMAN decision, or expected answer leaks.
  const serialized = JSON.stringify(packet.rows);
  for (const token of ['p1b6-item-', 'p1b6-sk-', 'p1b6-se-', 'p1b6-sf-', 'CLEAR', 'ESCALATE',
    'humanLabel', 'splitAssignment', 'boundaryClass', 'discoursePattern', 'KEEP', 'PASS']) {
    assert.equal(serialized.includes(token), false, token);
  }
});

test('the materialization receipt records authoring provenance without claiming a gate', () => {
  assert.equal(sha256RawBytes(read(MATERIALIZATION_RECEIPT)), MATERIALIZATION_RECEIPT_SHA256);
  const receipt = readJson(MATERIALIZATION_RECEIPT);
  assert.equal(receipt.materializedBatch.rawSha256, BATCH_003_SHA256);
  assert.equal(receipt.materializedBatch.items, 304);

  // The frozen planning protocol is bound but explicitly not rewritten.
  assert.equal(receipt.frozenAuthoringProtocol.rawSha256, PROTOCOL_SHA256);
  assert.equal(receipt.frozenAuthoringProtocol.amended, false);
  assert.equal(receipt.authority.frozenAuthoringProtocolRewritten, false);

  // Planning provenance and surface-authoring provenance are separate entries.
  assert.equal(receipt.provenance.planningAndProtocolGeneration.note
    .includes('authored no surface text'), true);
  assert.equal(receipt.provenance.surfaceAuthoring.samplingControls,
    'UNAVAILABLE_PLATFORM_CONTROLLED');
  assert.equal(receipt.provenance.surfaceAuthoring.modelSamplingParameters,
    'NOT_INDEPENDENTLY_RECOVERABLE');
  assert.equal(receipt.provenance.surfaceAuthoring.ambiguitySelfCheck
    .includes('NOT HUMAN gold'), true);

  for (const [key, value] of Object.entries(receipt.gatesNotYetRun)) {
    assert.equal(value, false, key);
  }
  for (const [key, value] of Object.entries(receipt.authority)) assert.equal(value, false, key);
  assert.equal(receipt.nextGate, 'FRESH_SOURCE_AUDIT_OF_ALL_304_ROWS');
  assert.equal(receipt.status, 'COMPLETE_SURFACES_AUTHORED_SOURCE_AUDIT_NOT_RUN');
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

// --- Pre-audit authoring repair -------------------------------------------------------------
//
// A construction review before any source audit found systematic ESCALATE surface collapse: the
// visible evidence resolved to one status instead of positively licensing two. The tests below
// pin the repaired population and assert that the specific structural failure modes that caused
// the repair are gone. They encode NO expected HUMAN answer and go into no blind artifact.

const REPAIRED = Object.freeze({
  'p1b6-sk-135ab77919a554dc': [38, 39, 40, 41, 42],
  'p1b6-sk-2da4e54e6609e34b': [79],
  'p1b6-sk-38c426bb2e0bff42': [93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104],
  'p1b6-sk-5229ea237196499d': [130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141],
  'p1b6-sk-59c8f51891ab4996': [146, 147, 148, 149],
  'p1b6-sk-a19bb9e94e9a416b': [220],
  'p1b6-sk-be0efa305956d111': [241, 242, 243, 244, 245, 246, 247, 248, 249],
  'p1b6-sk-cc054a4227cdafef': [254, 255, 256, 257, 258, 259, 260, 261, 262],
});

// The later review passes re-authored these subsets; neither changed a slot or any other row.
const REPAIRED_PASS_TWO = Object.freeze([79, 147, 241, 242, 244, 245, 246, 248,
  254, 255, 257, 259, 260, 261, 262]);
const REPAIRED_PASS_THREE = Object.freeze([255, 257]);

const itemId = ordinal => `p1b6-item-b003-${String(ordinal).padStart(3, '0')}`;
const episodeText = (batch, ordinal) => batch.sourceEpisodes
  .find(row => row.sourceEpisodeId === `p1b6-se-b003-${String(ordinal).padStart(3, '0')}`)
  .turns.map(turn => turn.text).join('\n');
const countOf = (text, patterns) =>
  patterns.reduce((total, pattern) => total + (text.match(pattern) || []).length, 0);

test('the 53 repaired items keep their original skeletons and frozen slot contracts', () => {
  const batch = readJson(plan.BATCH_003_FILE);
  const built = bundle();
  const slots = materialize.buildSlotSpecs(built);
  const items = new Map(batch.items.map(row => [row.itemId, row]));
  const episodes = new Map(batch.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  const skeletons = new Map(built.artifacts.effectiveCatalog.candidates
    .map(row => [row.semanticSkeletonId, row]));

  const ordinals = Object.values(REPAIRED).flat();
  assert.equal(ordinals.length, 53);
  assert.equal(new Set(ordinals).size, 53);

  for (const [semanticSkeletonId, group] of Object.entries(REPAIRED)) {
    for (const ordinal of group) {
      const item = items.get(itemId(ordinal));
      const episode = episodes.get(item.sourceEpisodeId);
      const slot = slots[ordinal - 1];
      assert.equal(item.semanticSkeletonId, semanticSkeletonId, item.itemId);
      assert.equal(slot.semanticSkeletonId, semanticSkeletonId, item.itemId);
      assert.equal(item.sourceEpisodeId, `p1b6-se-b003-${String(ordinal).padStart(3, '0')}`);
      assert.equal(episode.sourceFamilyId, `p1b6-sf-b003-${String(ordinal).padStart(3, '0')}`);
      assert.equal(item.surfaceFamilyId,
        `p1b6-surface-family-b003-${String(ordinal).padStart(3, '0')}`);
      assert.equal(episode.language, slot.language, item.itemId);
      assert.equal(item.discoursePattern, slot.discoursePattern, item.itemId);
      assert.equal(computeFragments(item, episode).length, slot.fragments, item.itemId);
      assert.equal(episode.splitAssignment,
        skeletons.get(semanticSkeletonId).splitAssignment, item.itemId);
    }
  }
});

// Construction-shape regression only.
//
// These assertions pin the KNOWN STRUCTURAL ANTI-PATTERNS that two pre-audit construction
// reviews actually found, so a future edit cannot silently reintroduce them. They do NOT
// establish semantic validity: a green run here does not show that any surface is a valid
// ESCALATE, does not show that two readings are positively licensed from visible evidence, and
// does not substitute for review. Lexical matching cannot prove ambiguity — the first review's
// list missed semantic equivalents such as `같은 말을 했어` and `맞는 말이라고 했어`, and any
// list will miss the next paraphrase. Semantic authoring QA stays a review judgment, and the
// fresh source audit is a different question again: whether each bundle is complete.
test('repaired surfaces keep their construction shape and known anti-patterns stay out', () => {
  const batch = readJson(plan.BATCH_003_FILE);
  const text = ordinal => episodeText(batch, ordinal);

  // FINALITY: at least two rival proposals must stay visible for the bare assent to target.
  // Counting proposal-introducing clauses is an objective construction property.
  for (const ordinal of REPAIRED['p1b6-sk-5229ea237196499d']) {
    const body = text(ordinal);
    const proposals = countOf(body,
      [/[가-힣]자고 (?:제안했|했|하고|한)|[가-힣]자는 제안|[을를] 제안했|proposed /gu]);
    assert.equal(proposals >= 2, true, `${itemId(ordinal)} proposals=${proposals}`);
  }

  // ACTUALITY (report adoption): the report states two aspects, and no clause predicated of the
  // whole report may carry the alignment. The phrase list is the set both reviews caught, not a
  // sufficient test for whole-report scope.
  const WHOLE_REPORT_ADOPTION = Object.freeze([
    '그 말에 동의', '같은 생각', '같은 인상을 받았어', '비슷한 인상을 받았어', '비슷하게 느꼈어',
    '비슷한 말을 하고 싶었어', '같은 말을 했어', '맞는 말이라고 했어',
    'felt the same way', 'matched what I found',
  ]);
  for (const ordinal of REPAIRED['p1b6-sk-cc054a4227cdafef']) {
    const body = text(ordinal);
    for (const collapsed of WHOLE_REPORT_ADOPTION) {
      assert.equal(body.includes(collapsed), false, `${itemId(ordinal)} ${collapsed}`);
    }
    // The reported state must still offer two aspects to align with.
    assert.equal(/고 .*다고 (?:했|했거든)|is .* and the .* are/u.test(body), true, itemId(ordinal));
  }
  // Pass 3: these two carried a clause predicated of the report as a whole. Their replacements
  // scope the alignment to one named aspect instead. Structural shape only — see the header.
  for (const ordinal of REPAIRED_PASS_THREE) {
    const body = text(ordinal);
    for (const whole of ['반박할 게 없었어', '토를 달지 않았어', '고개를 끄덕였어']) {
      assert.equal(body.includes(whole), false, `${itemId(ordinal)} ${whole}`);
    }
    assert.equal(/(?:친절한 건|깔끔하다는 데는|그 부분은)/u.test(body), true, itemId(ordinal));
  }

  // ACTUALITY (simulation): both a simulation frame and an actual-observation frame stay visible.
  for (const ordinal of REPAIRED['p1b6-sk-59c8f51891ab4996']) {
    const body = text(ordinal);
    assert.equal(/모의|시뮬레이션|load test|dry run/u.test(body), true, itemId(ordinal));
    assert.equal(/실제|actually|for real|마침/u.test(body), true, itemId(ordinal));
  }
  // 147 keeps both frames inside one enumerated clause, so neither wins on recency.
  assert.equal(/once on the evacuation dry run, and once when the alarm/u.test(text(147)), true);

  // APPROXIMATION: a per-occurrence basis and an aggregate basis are both visible and unselected.
  for (const ordinal of REPAIRED['p1b6-sk-135ab77919a554dc']) {
    const body = text(ordinal);
    assert.equal(/건별|건당|세션별|회차별|월 사용액/u.test(body), true, itemId(ordinal));
    assert.equal(/합계|총 장수|누계/u.test(body), true, itemId(ordinal));
  }

  // COMPLEMENTARY (overlapping rules): no explicit exception or standing permission may resolve
  // the relationship, and a second rule clause must be present alongside the first.
  for (const ordinal of REPAIRED['p1b6-sk-be0efa305956d111']) {
    const body = text(ordinal);
    for (const resolved of ['예외', '해도 된다', '둬도 된다', '봐도 된다', 'exempt', 'are fine']) {
      assert.equal(body.includes(resolved), false, `${itemId(ordinal)} ${resolved}`);
    }
    assert.equal(/기로 한 것도 있|goes there instead|is also a note/u.test(body), true,
      itemId(ordinal));
  }

  // SCOPE (exception membership): the exception is stated, and 079 no longer says outright that
  // the target went through the ER.
  assert.equal(text(79).includes('예외'), true);
  assert.equal(/응급실 거쳐|응급실을 거쳐서|응급의학과/u.test(text(79)), false);

  // SCOPE (boundary change): the qualifying event straddles the change.
  assert.equal(text(220).includes('기준 바뀌기 전에'), true);
});

test('materialization itself fails closed on cross-batch leakage', () => {
  const built = bundle();
  const authored = materialize.loadAuthoredContent();
  assert.doesNotThrow(() => materialize.buildBatch003(authored, built));

  // Rewrite a turn no span references, so structure stays exactly plan-compliant and only the
  // leakage validator can reject. Without the fail-close the batch would be written as valid.
  const unreferenced = entry => entry.turns.findIndex((turn, index) => {
    const selected = entry.ev.some(sel => (Array.isArray(sel) ? sel[0] : sel) === index);
    return !selected && index !== entry.anchor[0] && plan.isNonTrivialTurn(turn[1]);
  });

  const priorTurn = plan.loadPriorSources()
    .flatMap(row => row.turns).find(turn => plan.isNonTrivialTurn(turn.text));
  const leaky = structuredClone(authored);
  const victim = unreferenced(leaky[0]);
  assert.equal(victim >= 0, true);
  leaky[0].turns[victim][1] = priorTurn.text;
  assert.throws(() => materialize.buildBatch003(leaky, built),
    /non-trivial turn reused from/, 'prior turn leakage');

  const duplicated = structuredClone(authored);
  const donor = unreferenced(duplicated[0]);
  const target = unreferenced(duplicated[1]);
  assert.equal(target >= 0, true);
  duplicated[1].turns[target][1] = duplicated[0].turns[donor][1];
  assert.throws(() => materialize.buildBatch003(duplicated, built),
    /non-trivial turn reused across/, 'internal duplicate turn');
});

test('the pre-audit repairs record no gate result and leave the frozen plan untouched', () => {
  assert.equal(sha256RawBytes(read(plan.PROTOCOL_FILE)), PROTOCOL_SHA256);
  const receipt = readJson(MATERIALIZATION_RECEIPT);
  const passes = receipt.preAuditAuthoringRepairs;

  // Both pre-audit passes stay on the record: the initial materialization was structurally
  // valid, 53 rows were repaired, then a residual 15 were. Neither superseded packet was ever
  // adjudicated and neither pass is a HUMAN relabel.
  assert.equal(receipt.preAuditAuthoringRepairHistory.initialMaterializationStructurallyValid,
    true);
  assert.equal(receipt.preAuditAuthoringRepairHistory.passes, 3);
  assert.deepEqual(receipt.preAuditAuthoringRepairHistory.repairedRowsByPass, [53, 15, 2]);
  assert.equal(receipt.preAuditAuthoringRepairHistory.supersededTransientAuditPackets.length, 3);
  assert.equal(receipt.preAuditAuthoringRepairHistory.supersededPacketsAdjudicated, false);
  assert.equal(receipt.preAuditAuthoringRepairHistory.humanRelabelOccurred, false);

  assert.equal(passes.length, 3);
  assert.deepEqual(passes.map(row => row.pass), [1, 2, 3]);
  assert.deepEqual(passes.map(row => row.repairedItemCount), [53, 15, 2]);
  assert.deepEqual([...passes[0].repairedItemIds].sort(),
    Object.values(REPAIRED).flat().map(itemId).sort());
  assert.deepEqual([...passes[1].repairedItemIds].sort(),
    REPAIRED_PASS_TWO.map(itemId).sort());
  assert.deepEqual([...passes[2].repairedItemIds].sort(),
    REPAIRED_PASS_THREE.map(itemId).sort());
  assert.deepEqual(Object.keys(passes[0].repairedSkeletons).sort(), Object.keys(REPAIRED).sort());

  for (const row of passes) {
    assert.equal(row.trigger, 'SEMANTIC_CONSTRUCTION_REVIEW');
    assert.equal(row.cause, 'PRE_AUDIT_AUTHORING_DEFECT_NOT_A_HUMAN_RELABEL');
    assert.equal(row.supersededPacketDisposition, 'STALE_NEVER_ADJUDICATED');
    assert.equal(row.offsetsRecomputedMechanically, true);
    for (const key of ['frozenPlanAltered', 'marginalsAltered', 'plannedSkeletonCountsAltered',
      'humanJudgmentRecorded', 'sourceAuditDispositionRecorded']) {
      assert.equal(row[key], false, `pass ${row.pass} ${key}`);
    }
  }
  assert.equal(receipt.leakageValidation.enforcedDuringMaterialization, true);

  // No audit or review verdict vocabulary rides along with either repair record.
  const serialized = JSON.stringify(passes);
  for (const token of ['PASS', 'FAIL', 'UNCERTAIN', 'KEEP', 'REJECT', 'ACCEPT']) {
    assert.equal(serialized.includes(token), false, token);
  }
});
