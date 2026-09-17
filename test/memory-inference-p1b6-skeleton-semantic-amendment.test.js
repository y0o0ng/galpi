'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const exact56Builder = require('../scripts/build-memory-inference-p1b6-skeleton-exact56');
const amendment = require('../scripts/build-memory-inference-p1b6-skeleton-semantic-amendment');

const ROOT = path.resolve(__dirname, '..');
const fixture = file => path.join(ROOT, 'fixtures', file);
const read = file => fs.readFileSync(fixture(file));
const readJson = file => JSON.parse(read(file));

const EXACT56 = 'local-memory-inference-p1b6-skeleton-exact56.json';
const RECEIPT = 'local-memory-inference-p1b6-skeleton-semantic-amendment-receipt.json';
const EFFECTIVE_CATALOG = 'local-memory-inference-p1b6-skeleton-effective-current.json';
const ADJUDICATION_RECEIPT = 'local-memory-inference-p1b6-pragmatic-adjudication-batch-002-receipt.json';
const BATCH_001 = 'local-memory-inference-p1b6-surface-batch-001.json';
const BATCH_002 = 'local-memory-inference-p1b6-surface-batch-002.json';
const HUMAN_001 = 'local-memory-inference-p1b6-primary-human-effective-current-batch-001.json';
const HUMAN_002_V2 = 'local-memory-inference-p1b6-primary-human-effective-current-batch-002-v2.json';
const ACCEPTANCE = 'local-memory-inference-p1b6-smoke-batch-001-acceptance.json';

const EXACT56_SHA256 = '772f07bd679a9c98ea65feaa164ec7a9c1f3e3fb33632052ef076f8301999602';
const RECEIPT_SHA256 = '2778f64cf9f8f15bc85b7d015b706f5e87ad20e9dafc1249357477b235744977';
const CATALOG_SHA256 = '48490b6e4e1494856ef3268d944da16093c4735d207e07c1fd9e8bbf69df2559';
const ADJUDICATION_RECEIPT_SHA256 =
  'cf05f5073fc30f19078aab1a0c081b59face607a041387bf5421ffa2af8bbdaa';
const HUMAN_002_V2_SHA256 = 'a96fc01393c79057d292cf10b565589e7448b86289eb52b8cd1c63657af2ed05';
const HUMAN_001_SHA256 = '44832509f04ffb81a0772e9fda9adcbbea43305315a5d05948819b2c845b162a';
const BATCH_001_SHA256 = '2a4605f5550118754c315e26700aef1be96a3129a3ef0065fd2accdad5352a36';
const BATCH_002_SHA256 = 'ed68a562a67deee4d8e92d3e4841362d9589f876480d174a043d822cbf61e80c';
const AMENDED = ['p1b6-sk-155420007d75f36f', 'p1b6-sk-8dd28ec6b22a18ad'];
const PRESERVED = 'p1b6-sk-2fa39ece4157b2b8';
const SURFACE_COLLAPSE_MISMATCHES = [
  'p1b6-item-b002-022', 'p1b6-item-b002-024', 'p1b6-item-b002-029', 'p1b6-item-b002-032',
  'p1b6-item-b002-034', 'p1b6-item-b002-037', 'p1b6-item-b002-039', 'p1b6-item-b002-047',
  'p1b6-item-b002-049', 'p1b6-item-b002-050', 'p1b6-item-b002-051', 'p1b6-item-b002-059',
  'p1b6-item-b002-063',
];

const exact56 = readJson(EXACT56);
const catalog = readJson(EFFECTIVE_CATALOG);
const historicalSources = () => ({
  adjudicationReceipt: read(ADJUDICATION_RECEIPT),
  batch002Effective: read(HUMAN_002_V2),
  batch001Effective: read(HUMAN_001),
});
const rebuild = (rawReceipt = read(RECEIPT), sources = historicalSources()) =>
  amendment.buildEffectiveCurrentSkeletonCatalog(read(EXACT56), rawReceipt, sources);

test('historical exact56 stays byte-identical and still reconstructs itself', () => {
  assert.equal(sha256RawBytes(read(EXACT56)), EXACT56_SHA256);
  const rebuilt = exact56Builder.buildExact56(ROOT);
  assert.deepEqual(rebuilt.candidates, exact56.candidates);
  assert.equal(rebuilt.candidates.length, 56);
  assert.deepEqual(rebuilt.coverage.humanLabelCounts, { CLEAR: 32, ESCALATE: 24 });
  assert.equal(exact56.status, 'CLOSED / FROZEN');
});

test('amendment receipt binds canonical inputs and claims no extra authority', () => {
  assert.equal(sha256RawBytes(read(RECEIPT)), RECEIPT_SHA256);
  const receipt = amendment.validateAmendmentReceipt(
    read(RECEIPT), read(EXACT56), historicalSources());
  assert.equal(receipt.name, amendment.RECEIPT_IDENTITY);
  assert.equal(receipt.interpretationRule, 'CONSERVATIVE_PRAGMATIC_INTERPRETATION');
  assert.equal(receipt.historicalExact56.rawSha256, EXACT56_SHA256);
  assert.equal(receipt.historicalPragmaticAdjudicationReceipt.rawSha256,
    ADJUDICATION_RECEIPT_SHA256);
  assert.equal(receipt.effectiveHumanDecisionArtifacts.batch002.rawSha256, HUMAN_002_V2_SHA256);
  assert.equal(receipt.effectiveHumanDecisionArtifacts.batch001.rawSha256, HUMAN_001_SHA256);

  // Exactly two amendments, one explicit preservation, two routing corrections.
  assert.deepEqual(receipt.amendments.map(row => row.semanticSkeletonId).toSorted(), AMENDED);
  assert.equal(receipt.amendments.every(row => row.toHumanLabel === 'CLEAR'), true);
  assert.deepEqual(receipt.preserved.map(row => row.semanticSkeletonId), [PRESERVED]);
  assert.equal(receipt.preserved[0].humanLabel, 'ESCALATE');
  assert.equal(receipt.preserved[0].amended, false);
  assert.deepEqual(receipt.routingCorrections.map(row => row.itemId),
    ['p1b6-item-b002-059', 'p1b6-item-b002-063']);
  for (const row of receipt.routingCorrections) {
    assert.equal(row.historicalOutcome, 'SKELETON_SEMANTICS_NEEDS_REVISION');
    assert.equal(row.currentOutcome, 'SURFACE_COLLAPSES_AMBIGUITY');
    assert.equal(row.repairPerformed, false);
  }
  for (const [key, value] of Object.entries(receipt.authority)) {
    if (key !== 'decisionsSource') assert.equal(value, false, key);
  }

  // Semantic replacement content is auditable data in the receipt, not only in code.
  for (const row of receipt.amendments) {
    assert.equal(typeof row.candidateFocus, 'string');
    assert.equal(row.semanticRelations.length > 0, true);
    assert.equal(typeof row.interpretationContract, 'string');
  }
});

test('amendment receipt validation fails closed on widened or drifting authority', () => {
  const reject = (mutate, label) => {
    const receipt = structuredClone(readJson(RECEIPT));
    mutate(receipt);
    assert.throws(() => rebuild(amendment.artifactBytes(receipt)), /semantic amendment/, label);
  };
  reject(r => { r.amendments.push(structuredClone(r.preserved[0])); }, 'third amendment');
  reject(r => { r.amendments[0].semanticSkeletonId = PRESERVED; }, 'amends preserved skeleton');
  reject(r => { r.amendments[0].toHumanLabel = 'ESCALATE'; }, 'wrong target label');
  reject(r => { r.amendments[0].splitAssignment = 'DEV'; }, 'split drift');
  reject(r => { r.amendments[0].boundaryClass = 'REFERENT'; }, 'boundary drift');
  reject(r => { r.amendments[0].fromHumanLabel = 'CLEAR'; }, 'wrong base label');
  reject(r => { r.preserved[0].humanLabel = 'CLEAR'; }, 'relabels preserved');
  reject(r => { r.routingCorrections.pop(); }, 'missing routing correction');
  reject(r => { r.routingCorrections[0].repairPerformed = true; }, 'claims repair');
  reject(r => { r.authority.surfacesRepaired = true; }, 'claims surface repair');
  reject(r => { r.authority.humanDecisionsAltered = true; }, 'claims human relabel');
  reject(r => { r.authority.datasetAcceptancePerformed = true; }, 'claims acceptance');
  reject(r => { r.authority.humanGoldFrozen = true; }, 'claims gold freeze');
  reject(r => { r.authority.trainingOccurred = true; }, 'claims training');
  reject(r => { r.historicalExact56.rawSha256 = CATALOG_SHA256; }, 'wrong exact56 binding');
  assert.doesNotThrow(() => rebuild());
});

test('historical evidence is pinned by identity and raw SHA, not by dynamic hashing', () => {
  // Every pinned constant matches the artifact actually committed.
  const pinned = amendment.HISTORICAL_SOURCES;
  const onDisk = {
    adjudicationReceipt: [ADJUDICATION_RECEIPT, ADJUDICATION_RECEIPT_SHA256],
    batch002Effective: [HUMAN_002_V2, HUMAN_002_V2_SHA256],
    batch001Effective: [HUMAN_001, HUMAN_001_SHA256],
  };
  for (const [key, [file, sha]] of Object.entries(onDisk)) {
    assert.equal(pinned[key].rawSha256, sha, key);
    assert.equal(sha256RawBytes(read(file)), pinned[key].rawSha256, key);
    assert.equal(readJson(file).name, pinned[key].identity, key);
  }

  // A supplied source whose identity is wrong is refused even with a correct-looking receipt.
  for (const key of Object.keys(pinned)) {
    const sources = historicalSources();
    const drifted = structuredClone(JSON.parse(sources[key].toString('utf8')));
    drifted.name = 'xion-local-memory-inference-p1b6-not-the-canonical-artifact-v1';
    sources[key] = amendment.artifactBytes(drifted);
    assert.throws(() => rebuild(read(RECEIPT), sources),
      /bytes are not the canonical historical evidence|identity is not canonical/, key);
  }

  // Raw-byte drift in any historical source is refused on its own.
  for (const key of Object.keys(pinned)) {
    const sources = historicalSources();
    const drifted = JSON.parse(sources[key].toString('utf8'));
    drifted.driftMarker = true;
    sources[key] = amendment.artifactBytes(drifted);
    assert.throws(() => rebuild(read(RECEIPT), sources),
      /bytes are not the canonical historical evidence/, key);
  }

  // Coordinated drift: the source changes AND the receipt is rewritten to carry the drifted
  // SHA. This satisfied the old dynamic-hash check; the pinned constants must still refuse it.
  const receiptField = {
    adjudicationReceipt: r => r.historicalPragmaticAdjudicationReceipt,
    batch002Effective: r => r.effectiveHumanDecisionArtifacts.batch002,
    batch001Effective: r => r.effectiveHumanDecisionArtifacts.batch001,
  };
  for (const [key, pick] of Object.entries(receiptField)) {
    const sources = historicalSources();
    const drifted = JSON.parse(sources[key].toString('utf8'));
    drifted.driftMarker = true;
    const driftedBytes = amendment.artifactBytes(drifted);
    sources[key] = driftedBytes;
    const receipt = structuredClone(readJson(RECEIPT));
    pick(receipt).rawSha256 = sha256RawBytes(driftedBytes);
    assert.notEqual(sha256RawBytes(driftedBytes), pinned[key].rawSha256);
    assert.throws(() => rebuild(amendment.artifactBytes(receipt), sources),
      /bytes are not the canonical historical evidence/, key);
  }

  // A receipt naming a wrong identity or a wrong canonical SHA is refused.
  for (const [key, pick] of Object.entries(receiptField)) {
    for (const mutate of [
      row => { row.identity = 'xion-local-memory-inference-p1b6-wrong-identity-v1'; },
      row => { row.rawSha256 = EXACT56_SHA256; },
    ]) {
      const receipt = structuredClone(readJson(RECEIPT));
      mutate(pick(receipt));
      assert.throws(() => rebuild(amendment.artifactBytes(receipt)),
        /does not bind to the canonical historical inputs/, key);
    }
  }

  // Missing sources fail closed rather than skipping verification.
  assert.throws(() => rebuild(read(RECEIPT), {}), /were not supplied/);
  assert.throws(() => amendment.buildEffectiveCurrentSkeletonCatalog(
    read(EXACT56), read(RECEIPT), undefined), /were not supplied/);
  assert.doesNotThrow(() => rebuild());
});

test('effective-current catalog amends exactly two rows and preserves everything else', () => {
  assert.equal(sha256RawBytes(read(EFFECTIVE_CATALOG)), CATALOG_SHA256);
  assert.deepEqual(rebuild(), catalog);
  assert.equal(catalog.name, amendment.EFFECTIVE_IDENTITY);
  assert.equal(catalog.historicalBase.rawSha256, EXACT56_SHA256);
  assert.equal(catalog.historicalBase.role, 'IMMUTABLE_HISTORICAL_FREEZE_AND_PROVENANCE_BASE');
  assert.equal(catalog.authority.historicalExact56Superseded, false);
  assert.equal(catalog.semanticAmendmentReceipt.rawSha256, RECEIPT_SHA256);

  assert.equal(catalog.candidates.length, 56);
  assert.deepEqual(catalog.candidates.map(row => row.semanticSkeletonId),
    exact56.candidates.map(row => row.semanticSkeletonId));
  assert.deepEqual(catalog.coverage.humanLabelCounts, { CLEAR: 34, ESCALATE: 22 });
  assert.deepEqual(catalog.coverage.splitCounts, { TRAIN: 24, DEV: 16, FINAL_HELD_OUT: 16 });
  assert.deepEqual(catalog.coverage.boundaryClassSplitCounts,
    exact56.coverage.boundaryClassSplitCounts);

  const changed = catalog.candidates.filter((row, index) =>
    JSON.stringify(row) !== JSON.stringify(exact56.candidates[index]));
  assert.deepEqual(changed.map(row => row.semanticSkeletonId).toSorted(), AMENDED);
  for (const row of changed) assert.equal(row.humanLabel, 'CLEAR');
  for (const [index, row] of catalog.candidates.entries()) {
    const base = exact56.candidates[index];
    assert.equal(row.splitAssignment, base.splitAssignment);
    assert.equal(row.boundaryClass, base.boundaryClass);
    assert.equal(row.contrastGroupId, base.contrastGroupId);
    if (!AMENDED.includes(row.semanticSkeletonId)) assert.deepEqual(row, base);
  }
  assert.deepEqual(catalog.candidates.find(row => row.semanticSkeletonId === PRESERVED),
    exact56.candidates.find(row => row.semanticSkeletonId === PRESERVED));
});

test('batch-002 reconciles at 51 match / 13 mismatch without touching a HUMAN decision', () => {
  const human = readJson(HUMAN_002_V2);
  assert.equal(sha256RawBytes(read(HUMAN_002_V2)), HUMAN_002_V2_SHA256);
  assert.deepEqual(human.summary,
    { total: 64, KEEP: 64, FIX: 0, REJECT: 0, CLEAR: 52, ESCALATE: 12 });
  assert.equal(human.reconciliation.matchCount, 43);
  assert.equal(human.reconciliation.mismatchCount, 21);
  assert.equal(human.authority.humanReviewCompleted, false);

  const batch = readJson(BATCH_002);
  const current = amendment.reconcileAgainstCatalog(catalog, batch, human.rows);
  assert.equal(current.matchCount, 51);
  assert.equal(current.mismatchCount, 13);
  assert.deepEqual(current.mismatches, SURFACE_COLLAPSE_MISMATCHES);

  // The historical reconciliation is untouched and still recomputes to 43/21.
  const historical = amendment.reconcileAgainstCatalog(
    { candidates: exact56.candidates }, batch, human.rows);
  assert.equal(historical.matchCount, 43);
  assert.equal(historical.mismatchCount, 21);

  // The preserved skeleton keeps item 061 matched and 059/063 mismatched.
  const skeletonOf = new Map(batch.items.map(item => [item.itemId, item.semanticSkeletonId]));
  const decisionOf = new Map(human.rows.map(row => [row.itemId, row.decision]));
  assert.equal(skeletonOf.get('p1b6-item-b002-061'), PRESERVED);
  assert.equal(decisionOf.get('p1b6-item-b002-061'), 'ESCALATE');
  assert.equal(current.mismatches.includes('p1b6-item-b002-061'), false);
  for (const itemId of ['p1b6-item-b002-059', 'p1b6-item-b002-063']) {
    assert.equal(skeletonOf.get(itemId), PRESERVED);
    assert.equal(decisionOf.get(itemId), 'CLEAR');
    assert.equal(current.mismatches.includes(itemId), true, itemId);
  }
});

test('remaining batch-002 queue is 13 surface-collapse items and nothing else', () => {
  const receipt = readJson(RECEIPT);
  const adjudication = readJson(ADJUDICATION_RECEIPT);
  const batch = readJson(BATCH_002);
  const human = readJson(HUMAN_002_V2);
  const skeletonOf = new Map(batch.items.map(item => [item.itemId, item.semanticSkeletonId]));
  const decisionOf = new Map(human.rows.map(row => [row.itemId, row.decision]));
  const label = new Map(catalog.candidates.map(row => [row.semanticSkeletonId, row.humanLabel]));
  const corrected = new Map(receipt.routingCorrections.map(row => [row.itemId, row.currentOutcome]));

  // Project each historical routing row onto its current status: an item whose skeleton was
  // amended, or whose HUMAN decision now agrees with the catalog, has left the pending queue.
  const outcomes = adjudication.rows.map(row => {
    if (decisionOf.get(row.itemId) === label.get(skeletonOf.get(row.itemId))) {
      return { itemId: row.itemId, outcome: 'RESOLVED' };
    }
    return { itemId: row.itemId, outcome: corrected.get(row.itemId) ?? row.outcome };
  });

  const byOutcome = name => outcomes.filter(row => row.outcome === name).map(row => row.itemId);
  assert.equal(byOutcome('SKELETON_SEMANTICS_NEEDS_REVISION').length, 0);
  assert.equal(byOutcome('HUMAN_DECISION_NEEDS_REREVIEW').length, 0);
  assert.equal(byOutcome('UNRESOLVED').length, 0);
  assert.equal(byOutcome('RESOLVED').length, 11);
  assert.deepEqual(byOutcome('SURFACE_COLLAPSES_AMBIGUITY').toSorted(),
    SURFACE_COLLAPSE_MISMATCHES);

  // 8 resolved by the two skeleton amendments, 3 by the completed blind attempt-003.
  assert.equal(byOutcome('RESOLVED').filter(itemId =>
    AMENDED.includes(skeletonOf.get(itemId))).length, 8);
  assert.equal(byOutcome('RESOLVED').filter(itemId =>
    decisionOf.get(itemId) === 'ESCALATE').length, 3);

  // The historical routing artifact itself is untouched: it still reads 10 / 11 / 3 / 0.
  assert.equal(sha256RawBytes(read(ADJUDICATION_RECEIPT)), ADJUDICATION_RECEIPT_SHA256);
  assert.deepEqual(adjudication.summary, {
    total: 24,
    SKELETON_SEMANTICS_NEEDS_REVISION: 10,
    SURFACE_COLLAPSES_AMBIGUITY: 11,
    HUMAN_DECISION_NEEDS_REREVIEW: 3,
    UNRESOLVED: 0,
  });
});

test('batch-001 impact is 31 match / 1 mismatch without reopening smoke acceptance', () => {
  const human = readJson(HUMAN_001);
  const batch = readJson(BATCH_001);
  const historical = amendment.reconcileAgainstCatalog(
    { candidates: exact56.candidates }, batch, human.rows);
  assert.equal(historical.matchCount, 30);
  assert.equal(historical.mismatchCount, 2);

  const current = amendment.reconcileAgainstCatalog(catalog, batch, human.rows);
  assert.equal(current.matchCount, 31);
  assert.equal(current.mismatchCount, 1);
  assert.deepEqual(current.mismatches, ['p1b6-item-b001-019']);

  const skeletonOf = new Map(batch.items.map(item => [item.itemId, item.semanticSkeletonId]));
  assert.equal(skeletonOf.get('p1b6-item-b001-009'), 'p1b6-sk-8dd28ec6b22a18ad');

  // The closed acceptance is historical and stays as it was.
  const acceptance = readJson(ACCEPTANCE);
  assert.equal(acceptance.accepted.length, 30);
  assert.equal(acceptance.rejected.length, 2);
  assert.equal(acceptance.rejected.some(row => row.itemId === 'p1b6-item-b001-009'), true);
});

test('amendment opens no surface repair, acceptance, gold, HELD, or training gate', () => {
  const frozen = {
    [EXACT56]: EXACT56_SHA256,
    [BATCH_001]: BATCH_001_SHA256,
    [BATCH_002]: BATCH_002_SHA256,
    [ADJUDICATION_RECEIPT]: ADJUDICATION_RECEIPT_SHA256,
    [HUMAN_001]: HUMAN_001_SHA256,
    [HUMAN_002_V2]: HUMAN_002_V2_SHA256,
    'local-memory-inference-p1b6-pragmatic-adjudication-batch-002.json':
      'dd8697b890f41a3541c38b7101bd93ee697889bdaa9ceafea114d2d7feef4967',
    'local-memory-inference-p1b6-primary-human-effective-current-batch-002.json':
      'd0e5dcc2da7d1f87b4886d6e5b6726c1053c88fdc4cdf8fbd144a47c3cddf38f',
    'local-memory-inference-p1b6-primary-human-review-batch-002-attempt-001.json':
      '6c2d8fabaf6c9caa4d86b5d4252d4e96801648c414b65ab0454e61c66ed0de4c',
    'local-memory-inference-p1b6-primary-human-rereview-batch-002-attempt-002.json':
      '141070c2e1485294a64c73d69de12dee867ce81ba1b66a3b9b189d61d84d67f3',
    'local-memory-inference-p1b6-primary-human-rereview-batch-002-attempt-003.json':
      '182fcad42d34a631fe77057cd19046ce125a06d933d68c39d870f2d366241aa3',
    [ACCEPTANCE]: '449318d5d3895fca87257a40b7d47b6d8d8eb3df8e9817fff5998a34d658bb5c',
  };
  for (const [file, expected] of Object.entries(frozen)) {
    assert.equal(sha256RawBytes(read(file)), expected, file);
  }
  for (const file of [
    'local-memory-inference-p1b6-smoke-batch-002-acceptance.json',
    'local-memory-inference-p1b6-final-corpus-gold.json',
    'local-memory-inference-p1b6-held-repeated-review.json',
  ]) assert.equal(fs.existsSync(fixture(file)), false, file);
  assert.equal(readJson(HUMAN_002_V2).authority.humanReviewCompleted, false);
  assert.equal(readJson(HUMAN_002_V2).authority.surfaceHumanGoldFrozen, false);
  assert.equal(readJson(HUMAN_002_V2).authority.trainingOccurred, false);
  assert.equal(readJson(ACCEPTANCE).accepted.length, 30);
});
