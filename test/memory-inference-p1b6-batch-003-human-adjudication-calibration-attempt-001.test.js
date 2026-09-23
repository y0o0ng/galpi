'use strict';

// Executed batch-003 combined HUMAN review, attempt 001.
//
// The committed receipt is checked for internal consistency against canonical artifacts in every
// environment. Regenerating it byte-for-byte needs both uncommitted raw artifacts, so that test
// skips explicitly unless P1B6_B003_SM_RESULTS and P1B6_B003_HUMAN_RESULTS point at them.
// Synthetic populations are used only to cross-check committed role assignments; they never
// produce the receipt.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const strongModel = require('../scripts/build-memory-inference-p1b6-batch-003-strong-model-review-packet');
const combined = require('../scripts/build-memory-inference-p1b6-batch-003-human-adjudication-calibration-packet');
const reconcile = require('../scripts/reconcile-memory-inference-p1b6-batch-003-human-adjudication-calibration');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file));
const readJson = file => JSON.parse(read(file));

const BATCH = 'fixtures/local-memory-inference-p1b6-surface-batch-003.json';
const AUDIT = 'fixtures/local-memory-inference-p1b6-source-audit-batch-003-attempt-001.json';
const SM_RECEIPT =
  'fixtures/local-memory-inference-p1b6-strong-model-semantic-review-batch-003-attempt-001.json';
const CATALOG = 'fixtures/local-memory-inference-p1b6-skeleton-effective-current-v2.json';
const RECEIPT = 'fixtures/local-memory-inference-p1b6-batch-003-human-adjudication-calibration-attempt-001.json';
const PRIVATE_PACKET =
  'fixtures/local-memory-inference-private-p1b6-batch-003-human-adjudication-calibration-packet.json';
const SM_RAW = process.env.P1B6_B003_SM_RESULTS;
const HUMAN_RAW = process.env.P1B6_B003_HUMAN_RESULTS;
const FAILED = strongModel.EXPECTED_FAILED_ITEM_IDS;

const UNCHANGED = Object.freeze({
  [BATCH]: '90b453c3680bccaa537fd0d23db74bbc303882e1a35a2ddcea0b75b013fcaa68',
  [AUDIT]: '3c840476bea6eccb522800248a3ace277b26a5334ec56b5f6b10bbf4d5821221',
  [SM_RECEIPT]: '9b65327a4ce6d1923391253659c1acc3bb373bb54acdc7872e3ce74d52337074',
  [CATALOG]: 'f1e780195441246402ca389da188b1f7b8c4970f42fc1e6e3de2f436a3e9377c',
  'fixtures/local-memory-inference-p1b6-batch-003-human-adjudication-calibration-protocol.json':
    '171ee15d02a0dd674ed72f6910654ce0fe58242700415ded7e91ec858e55e001',
  'fixtures/local-memory-inference-p1b6-skeleton-effective-current.json':
    '48490b6e4e1494856ef3268d944da16093c4735d207e07c1fd9e8bbf69df2559',
  'fixtures/local-memory-inference-p1b6-skeleton-exact56.json':
    '772f07bd679a9c98ea65feaa164ec7a9c1f3e3fb33632052ef076f8301999602',
  'fixtures/local-memory-inference-p1b6-skeleton-semantic-contract-v2-receipt.json':
    'a12063c38eee6245122e655126708c904319b4a7467cf82084acdea17a293344',
  'fixtures/local-memory-inference-p1b6-large-batch-review-authority-amendment.json':
    '821b0cb07580b4c2ac776014d88c78333263900759ca94d1746b4934964ffc0e',
  'fixtures/local-memory-inference-p1b6-strong-model-semantic-review-protocol.json':
    '2f97028fe5bb9612a0750140754136785f99d07f93f7924c697a5b67990c16c4',
  'fixtures/local-memory-inference-p1b6-primary-human-review-batch-001-attempt-001.json':
    '816a24aec8ca429fad3582dfd972bffb6437c9d41d7ddebd393674fb48d4d8e2',
  'scripts/build-memory-inference-p1b6-human-review-packet.js':
    '74db840d5be654446c619cbbb8b7c0e00f70ef491cc5969a3c150275b2c4c12c',
  'scripts/build-memory-inference-p1b6-batch-003-strong-model-review-packet.js':
    'e429b59e5eb53b60c97dfe7e941250646e9d4b6cb9f0e6fa666a087cdc02fd0f',
});

const receipt = readJson(RECEIPT);
const allRows = () => [...receipt.adjudicationRows, ...receipt.calibrationRows];
const tally = values => values.reduce((totals, value) => {
  totals[value] = (totals[value] ?? 0) + 1;
  return totals;
}, {});

// Roles recomputed from canonical artifacts without the raw bytes, for cross-checking only.
function syntheticPopulations() {
  const { references } = strongModel.buildCanonicalReviewReferences(read(BATCH), readJson(AUDIT));
  const routed = new Set(readJson(SM_RECEIPT).routedItemIds);
  const results = references.map(row => ({
    reviewRowId: row.reviewRowId,
    disposition: 'KEEP',
    decision: routed.has(row.itemId)
      ? (row.referenceLabel === 'CLEAR' ? 'ESCALATE' : 'CLEAR') : row.referenceLabel,
    reason: 'cross-check',
  }));
  return combined.unauthorized.computePopulations(read(BATCH), readJson(AUDIT), results);
}

test('the receipt binds the exact reviewed artifacts and current authority', () => {
  assert.equal(receipt.attemptId, reconcile.ATTEMPT_ID);
  assert.equal(receipt.status, 'COMPLETE_NEEDS_RESOLUTION');
  assert.equal(receipt.rawHumanResultArtifact.sha256, reconcile.HUMAN_RESULT_SHA256);
  assert.equal(reconcile.HUMAN_RESULT_SHA256,
    '2515be0eb8b48b313ee6ae3080cbd293332fd4cc6188a04cb76dab4aec8c98ad');
  assert.equal(receipt.rawHumanResultArtifact.committed, false);
  assert.deepEqual(receipt.reviewPacket, {
    identity: combined.PACKET_IDENTITY,
    sha256: '4750a467b521975f60f6bf5fd776ff6cfd80ad5be1efa04a485e389532988ed0',
    rows: 66,
    committed: false,
  });
  assert.deepEqual(receipt.reviewProtocol, {
    identity: combined.PROTOCOL_IDENTITY, sha256: combined.loadProtocol().sha256,
  });
  assert.equal(receipt.reviewedSourceBatch.rawSha256, UNCHANGED[BATCH]);
  assert.equal(receipt.strongModelReconciliation.rawResultSha256,
    '148c272fa77174ce51d61d7cf5adce959061623715078284a5e6a7b0cfcdb2de');
  assert.equal(receipt.strongModelReconciliation.rawResultCommitted, false);
  assert.deepEqual(receipt.currentReferenceAuthority, {
    identity: strongModel.CATALOG_IDENTITY, rawSha256: UNCHANGED[CATALOG],
  });
  // The private packet and raw results stay out of git. The container image has no .git
  // (.dockerignore), so this is checked only in a git checkout.
  if (fs.existsSync(path.join(ROOT, '.git'))) {
    const tracked = require('node:child_process')
      .execFileSync('git', ['ls-files', 'fixtures'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(tracked.includes('local-memory-inference-private-'), false);
    assert.equal(tracked.includes('human-adjudication-calibration-results'), false);
  }
});

test('the HUMAN bytes are bound before parsing; mutations and reserializations fail', () => {
  const rows = allRows().map(row => ({
    reviewRowId: row.reviewRowId, disposition: row.humanDisposition,
    decision: row.humanDecision, reason: row.humanReason,
  }));
  const candidates = {
    compact: Buffer.from(JSON.stringify({ results: rows }), 'utf8'),
    reordered: Buffer.from(`${JSON.stringify({ results: [...rows].reverse() }, null, 2)}\n`),
    mutated: Buffer.from(`${JSON.stringify({ results: rows.map((row, index) => (index
      ? row : { ...row, reason: `${row.reason} ` })) }, null, 2)}\n`),
    empty: Buffer.alloc(0),
  };
  for (const [label, bytes] of Object.entries(candidates)) {
    assert.throws(() => reconcile.buildReceipt(read(BATCH), readJson(AUDIT), Buffer.alloc(0), bytes),
      /not the reviewed attempt-001 artifact/, label);
  }
  assert.throws(() => reconcile.buildReceipt(read(BATCH), readJson(AUDIT), Buffer.alloc(0),
    { results: rows }), /not the reviewed attempt-001 artifact/);
});

test('hidden composition is 34 routed + 32 calibration, matching the canonical derivation', () => {
  const pops = syntheticPopulations();
  const roles = new Map(pops.rows.map(row => [row.itemId, row]));
  assert.equal(receipt.adjudicationRows.length, 34);
  assert.equal(receipt.calibrationRows.length, 32);
  assert.deepEqual(receipt.composition, { total: 66, mandatoryAdjudication: 34, calibration: 32 });
  assert.deepEqual(receipt.adjudicationRows.map(row => row.itemId),
    [...readJson(SM_RECEIPT).routedItemIds].sort());
  for (const [list, role] of [[receipt.adjudicationRows, combined.ROLE.ROUTED],
    [receipt.calibrationRows, combined.ROLE.CALIBRATION]]) {
    for (const row of list) {
      const canonical = roles.get(row.itemId);
      assert.equal(canonical.role, role, row.itemId);
      assert.equal(row.reviewRowId, canonical.reviewRowId);
      assert.equal(row.referenceLabel, canonical.referenceLabel);
      assert.equal(row.semanticSkeletonId, canonical.semanticSkeletonId);
    }
  }
  const ids = allRows().map(row => row.reviewRowId);
  assert.equal(new Set(ids).size, 66);
  const packetIds = pops.rows.map(row => row.reviewRowId).sort();
  assert.deepEqual([...ids].sort(), packetIds);
  for (const failed of FAILED) {
    assert.equal(JSON.stringify(receipt).includes(failed), false, failed);
  }
});

test('reference labels come from v2 and were not rewritten by HUMAN decisions', () => {
  const catalog = readJson(CATALOG);
  const labels = new Map(catalog.candidates.map(row => [row.semanticSkeletonId, row.humanLabel]));
  const items = new Map(readJson(BATCH).items.map(item => [item.itemId, item]));
  for (const row of allRows()) {
    assert.equal(items.get(row.itemId).semanticSkeletonId, row.semanticSkeletonId);
    assert.equal(row.referenceLabel, labels.get(row.semanticSkeletonId), row.itemId);
  }
  const counts = tally(catalog.candidates.map(row => row.humanLabel));
  assert.deepEqual(counts, { CLEAR: 45, ESCALATE: 11 });
  assert.equal(receipt.authority.catalogAmended, false);
  assert.equal(receipt.authority.referenceLabelsChanged, false);
});

test('every outcome follows the preregistered routed and calibration contracts', () => {
  const expected = (role, row) => {
    const match = row.humanDisposition === 'KEEP' && row.humanDecision === row.referenceLabel;
    if (role === 'routed') {
      return match ? ['HUMAN_KEEP_MATCHING_REFERENCE', 'HUMAN_ADJUDICATED', 'ELIGIBLE']
        : [row.humanDisposition === 'KEEP' ? 'HUMAN_KEEP_OPPOSING_REFERENCE'
          : `HUMAN_${row.humanDisposition}`, null, 'INELIGIBLE'];
    }
    return match ? ['CALIBRATION_MATCH', 'CATALOG_STRONG_MODEL_CONFIRMED', 'PROVISIONAL']
      : [row.humanDisposition === 'KEEP' ? 'CALIBRATION_DECISION_MISMATCH'
        : `CALIBRATION_${row.humanDisposition}`, null, 'INELIGIBLE'];
  };
  for (const row of receipt.adjudicationRows) {
    assert.deepEqual([row.outcome, row.provenance, row.eligibility], expected('routed', row), row.itemId);
  }
  for (const row of receipt.calibrationRows) {
    assert.deepEqual([row.outcome, row.provenance, row.eligibility], expected('cal', row), row.itemId);
    assert.notEqual(row.provenance, 'HUMAN_ADJUDICATED');
  }
  // Summaries are exactly what the rows say.
  assert.deepEqual(receipt.reconciliation.adjudication,
    tally(receipt.adjudicationRows.map(row => row.outcome)));
  assert.deepEqual(receipt.reconciliation.calibration,
    tally(receipt.calibrationRows.map(row => row.outcome)));
  assert.deepEqual(receipt.rawResultSummary, {
    total: 66, dispositions: { KEEP: 66 }, decisions: { CLEAR: 47, ESCALATE: 19 },
  });
  const ineligible = allRows().filter(row => row.eligibility === 'INELIGIBLE')
    .map(row => row.itemId).sort();
  assert.deepEqual(receipt.reconciliation.resolutionRequiredItemIds, ineligible);
  assert.deepEqual(Object.values(receipt.reconciliation.resolutionRequiredBySkeleton).flat().sort(),
    ineligible);
  assert.equal(allRows().filter(row => row.provenance === 'HUMAN_ADJUDICATED')
    .every(row => receipt.adjudicationRows.includes(row)), true);
});

test('the 235 unsampled agreements are untouched and nothing is extrapolated', () => {
  const pops = syntheticPopulations();
  const reviewed = new Set(allRows().map(row => row.itemId));
  const unsampled = receipt.unsampledAgreements;
  assert.equal(unsampled.count, 235);
  assert.equal(unsampled.itemIds.length, 235);
  assert.equal(unsampled.provenance, 'CATALOG_STRONG_MODEL_CONFIRMED');
  assert.equal(unsampled.eligibility, 'PROVISIONAL');
  assert.equal(unsampled.allUnchanged, true);
  assert.equal(unsampled.calibrationExtrapolated, false);
  assert.deepEqual(unsampled.itemIds, pops.unreviewedAgreements.map(row => row.itemId).sort());
  assert.equal(unsampled.itemIds.some(itemId => reviewed.has(itemId)), false);
  assert.equal(receipt.authority.calibrationExtrapolatedToUnsampledRows, false);
  assert.equal(receipt.authority.calibrationPromotedToHumanAdjudicated, false);
});

test('no downstream gate is opened and historical artifacts are unchanged', () => {
  for (const key of ['surfacesRepaired', 'surfaceAcceptancePerformed',
    'referenceLabelFreezePerformed', 'finalSelectionPerformed', 'heldSecondReviewPerformed',
    'trainingOrEvaluationOccurred']) {
    assert.equal(receipt.authority[key], false, key);
  }
  for (const [file, sha] of Object.entries(UNCHANGED)) {
    assert.equal(sha256RawBytes(read(file)), sha, file);
  }
  if (fs.existsSync(path.join(ROOT, PRIVATE_PACKET))) {
    assert.equal(sha256RawBytes(read(PRIVATE_PACKET)), receipt.reviewPacket.sha256);
  }
});

test('the exact raw artifacts regenerate the committed receipt byte-for-byte',
  { skip: !(SM_RAW && HUMAN_RAW) && 'P1B6_B003_SM_RESULTS / P1B6_B003_HUMAN_RESULTS not set; raw artifacts are not committed' },
  () => {
    const smRaw = fs.readFileSync(SM_RAW);
    const humanRaw = fs.readFileSync(HUMAN_RAW);
    assert.equal(sha256RawBytes(humanRaw), reconcile.HUMAN_RESULT_SHA256);
    const rebuilt = reconcile.receiptBytes(reconcile.buildReceipt(read(BATCH), readJson(AUDIT),
      smRaw, humanRaw));
    assert.equal(rebuilt.equals(read(RECEIPT)), true);

    // Right HUMAN bytes cannot stand in for the strong-model bytes, and result order never
    // decides hidden role.
    assert.throws(() => reconcile.buildReceipt(read(BATCH), readJson(AUDIT),
      Buffer.from(JSON.stringify(readJson(SM_RECEIPT).rawResultSummary)), humanRaw),
    /not the reconciled raw artifact/);
    const pops = combined.derivePopulations(read(BATCH), readJson(AUDIT), smRaw);
    const parsed = JSON.parse(humanRaw.toString('utf8'));
    const reversed = Buffer.from(JSON.stringify({ results: [...parsed.results].reverse() }));
    const out = combined.reconcileHumanResults(pops, reversed);
    assert.deepEqual(out.adjudication, receipt.adjudicationRows);
    assert.deepEqual(out.calibration, receipt.calibrationRows);
  });
