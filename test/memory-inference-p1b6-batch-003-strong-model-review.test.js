'use strict';

// Batch-003 source-audit consumption and strong-model semantic-review preparation.
//
// Nothing here executes a review. There is no HUMAN decision, no strong-model result, no
// acceptance, no label freeze and no training. These tests pin the bindings, the fail-closed
// boundaries, and the prospective authority model.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { RENDERER_IDENTITY, renderHumanReviewText } = require('../lib/memory-inference-p1b6-surfaces');
const sourceAudit = require('../scripts/build-memory-inference-p1b6-source-audit-packet');
const humanPacket = require('../scripts/build-memory-inference-p1b6-human-review-packet');
const strongModel = require('../scripts/build-memory-inference-p1b6-batch-003-strong-model-review-packet');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file));
const readJson = file => JSON.parse(read(file));

const BATCH = 'fixtures/local-memory-inference-p1b6-surface-batch-003.json';
const RECEIPT = 'fixtures/local-memory-inference-p1b6-source-audit-batch-003-attempt-001.json';
const AMENDMENT = 'fixtures/local-memory-inference-p1b6-large-batch-review-authority-amendment.json';
const SM_PROTOCOL = 'fixtures/local-memory-inference-p1b6-strong-model-semantic-review-protocol.json';
const CATALOG = 'fixtures/local-memory-inference-p1b6-skeleton-effective-current.json';

const BATCH_SHA256 = '90b453c3680bccaa537fd0d23db74bbc303882e1a35a2ddcea0b75b013fcaa68';
const AUDIT_PACKET_SHA256 = '9f18c656a1717c8d11b9e12ebb68d3e3a9d1e79dcb77d9371be859f45a9252a2';
const AUDIT_PROTOCOL_SHA256 = '63a2c70c3af608d60fb817f092e16c62986b1b5ba09a6d19300fa34e24582a1d';
const RESULT_ARTIFACT_SHA256 = '956a94cf59f2cd62594d035fa5cf913dc758920341b6319c43a3a557526dc3c6';
const FAILED = Object.freeze(['p1b6-item-b003-002', 'p1b6-item-b003-006', 'p1b6-item-b003-109']);

// Artifacts this step must leave byte-identical. The historical HUMAN review and acceptance
// receipts keep their own authority; this step neither reopens nor renames any of them.
const UNCHANGED = Object.freeze({
  'fixtures/local-memory-inference-p1b6-surface-batch-003.json': BATCH_SHA256,
  'fixtures/local-memory-inference-p1b6-surface-batch-003-authoring-protocol.json':
    '33c39777583009aaaa570718ae26741b6a2562e2006d4a4e428c60d47bdcc447',
  'fixtures/local-memory-inference-p1b6-source-audit-protocol.json': AUDIT_PROTOCOL_SHA256,
  'fixtures/local-memory-inference-p1b6-skeleton-exact56.json':
    '772f07bd679a9c98ea65feaa164ec7a9c1f3e3fb33632052ef076f8301999602',
  'fixtures/local-memory-inference-p1b6-skeleton-effective-current.json':
    '48490b6e4e1494856ef3268d944da16093c4735d207e07c1fd9e8bbf69df2559',
  'lib/memory-inference-p1b6-surfaces.js':
    '4b6dabf2280529b138efe124f32252c2ff7a2b9a118d7eb2c2b3341c7c56f1b7',
  'scripts/build-memory-inference-p1b6-human-review-packet.js':
    '74db840d5be654446c619cbbb8b7c0e00f70ef491cc5969a3c150275b2c4c12c',
  'scripts/build-memory-inference-p1b6-source-audit-packet.js':
    '0466b8085739d249306a489055e905c5294f89a79f48fb50c33bd2cb615844b4',
  'fixtures/local-memory-inference-p1b6-primary-human-review-batch-001-attempt-001.json':
    '816a24aec8ca429fad3582dfd972bffb6437c9d41d7ddebd393674fb48d4d8e2',
});

const packet = () => strongModel.buildStrongModelReviewPacket(read(BATCH), readJson(RECEIPT));

test('the committed audit receipt binds exactly to the current canonical packet', () => {
  const receipt = readJson(RECEIPT);
  const batchBytes = read(BATCH);
  const auditPacket = sourceAudit.buildAuditPacket(batchBytes);
  const auditPacketSha = sha256RawBytes(
    Buffer.from(`${JSON.stringify(auditPacket, null, 2)}\n`, 'utf8'));

  assert.equal(receipt.name,
    'xion-local-memory-inference-p1b6-source-audit-batch-003-attempt-001-receipt-v1');
  assert.equal(receipt.attemptId, 'p1b6-source-audit-batch-003-attempt-001');
  assert.equal(receipt.status, 'COMPLETE_NEEDS_FIX');
  assert.equal(sha256RawBytes(batchBytes), BATCH_SHA256);
  assert.equal(auditPacketSha, AUDIT_PACKET_SHA256);
  assert.equal(receipt.auditPacketIdentity, sourceAudit.PACKET_IDENTITY);
  assert.equal(receipt.auditPacketSha256, AUDIT_PACKET_SHA256);
  assert.equal(receipt.sourceAuditProtocol.identity, sourceAudit.PROTOCOL_IDENTITY);
  assert.equal(receipt.sourceAuditProtocol.sha256, AUDIT_PROTOCOL_SHA256);
  assert.equal(receipt.auditedSourceBatch.rawSha256, BATCH_SHA256);
  assert.equal(receipt.rawResultArtifact.filename, 'p1b6-batch-003-source-audit-results.json');
  assert.equal(receipt.rawResultArtifact.sha256, RESULT_ARTIFACT_SHA256);

  // No auditor model or runtime setting was supplied, so none may be asserted.
  assert.equal(receipt.auditorExecutionProvenance.evidenceBasis,
    'NOT_SUPPLIED_IN_RESULT_ARTIFACT');
  for (const invented of ['provider', 'surface', 'model', 'reasoningSetting']) {
    assert.equal(Object.hasOwn(receipt.auditorExecutionProvenance, invented), false, invented);
  }
});

test('the audit outcome is 304 / 301 PASS / 3 FAIL / 0 UNCERTAIN with mechanical mapping', () => {
  const receipt = readJson(RECEIPT);
  const batch = readJson(BATCH);

  assert.deepEqual(receipt.summary, { total: 304, PASS: 301, FAIL: 3, UNCERTAIN: 0 });
  assert.equal(receipt.rows.length, 304);
  assert.equal(new Set(receipt.rows.map(row => row.auditRowId)).size, 304);

  // Opaque IDs are recomputed, never trusted from a table.
  const byAuditRowId = new Map(batch.items
    .map(item => [sourceAudit.opaqueAuditRowId(BATCH_SHA256, item.itemId), item.itemId]));
  assert.equal(receipt.rows.every(row => byAuditRowId.has(row.auditRowId)), true);
  const failed = receipt.rows.filter(row => row.disposition !== 'PASS')
    .map(row => byAuditRowId.get(row.auditRowId)).sort();
  assert.deepEqual(failed, [...FAILED]);
  assert.deepEqual([...receipt.failedItems.itemIds].sort(), [...FAILED]);
  assert.equal(receipt.failedItems.disposition, 'EXCLUDED_NOT_REPAIRED');

  // Auditor reasons are preserved verbatim, not summarized.
  for (const row of receipt.rows) {
    assert.equal(typeof row.reason === 'string' && row.reason.trim() !== '', true);
  }
  assert.equal(receipt.rows.find(row => byAuditRowId.get(row.auditRowId) === FAILED[2]).reason
    .includes("identifies 'that restaurant' as the cafeteria"), true);

  // No gate beyond the audit is claimed.
  assert.equal(receipt.authority.wholeBatchAuditComplete, true);
  assert.equal(receipt.authority.passRowsEligibleForSemanticReview, 301);
  assert.equal(receipt.authority.failRowsIneligible, 3);
  for (const key of ['humanSemanticReviewOccurred', 'strongModelSemanticReviewOccurred',
    'surfaceAcceptanceOccurred', 'referenceLabelFreezeOccurred',
    'trainingOrEvaluationOccurred']) {
    assert.equal(receipt.authority[key], false, key);
  }
});

test('the review-authority amendment is prospective and grants no retroactive mutation', () => {
  const amendment = readJson(AMENDMENT);
  assert.equal(amendment.amendmentId, 'p1b6-large-batch-review-authority-v1');
  assert.equal(amendment.decision.source, 'REPOSITORY_OWNER');
  assert.equal(amendment.appliesFrom, 'BATCH_003_LARGE_BATCH_REVIEW_ONWARD');
  assert.equal(amendment.retroactive, false);
  assert.equal(amendment.historicalAuthority.batch001And002ReviewArtifactsImmutable, true);
  assert.equal(amendment.historicalAuthority.retroactiveRelabelAuthorized, false);
  assert.equal(amendment.historicalAuthority.historicalHumanProvenanceRemainsValid, true);

  assert.equal(amendment.semanticAuthorityModel.referenceLabelSourceOfTruth,
    'EFFECTIVE_CURRENT_SKELETON_CATALOG');
  assert.equal(amendment.semanticAuthorityModel.exhaustivePerSurfaceHumanReviewRequired, false);
  assert.equal(amendment.semanticAuthorityModel.strongModelDisagreementRelabelsCatalog, false);
  assert.equal(amendment.semanticAuthorityModel.strongModelDisagreementRelabelsSurface, false);
  assert.deepEqual(Object.keys(amendment.labelProvenanceCategories).sort(),
    ['CATALOG_STRONG_MODEL_CONFIRMED', 'HISTORICAL_HUMAN_CONFIRMED', 'HUMAN_ADJUDICATED']);
  assert.equal(amendment.humanProvenanceClaim.unreviewedAgreementRowsAreHumanGold, false);
  assert.equal(amendment.humanProvenanceClaim.calibrationExtrapolatedToUnreviewedRows, false);
  assert.equal(amendment.humanAdjudicationSemantics.automaticCatalogAmendment, false);
  assert.equal(amendment.finalHeldOutContract.exhaustiveRepeatedHumanReviewRequired, false);
  assert.equal(amendment.finalHeldOutContract.secondIndependentStrongModelReviewRequired, true);
  assert.equal(amendment.finalCorpusLabelConstraint.isOver, 'FROZEN_REFERENCE_LABELS');
  assert.equal(
    amendment.finalCorpusLabelConstraint.claimsDirectHumanLabelingOfEvery380Surface, false);

  for (const [key, value] of Object.entries(amendment.authority)) {
    assert.equal(value, false, key);
  }
  assert.equal(amendment.boundTo.effectiveCurrentCatalog.rawSha256,
    sha256RawBytes(read(CATALOG)));
});

test('the strong-model protocol leaks no expected answer and is not a HUMAN protocol', () => {
  const protocol = readJson(SM_PROTOCOL);
  assert.equal(protocol.protocolIdentity, 'p1b6-strong-model-semantic-realization-review-v1');
  assert.equal(protocol.isHumanProtocol, false);
  assert.equal(protocol.isSourceAuditProtocol, false);
  assert.equal(protocol.authorizedBy, 'p1b6-large-batch-review-authority-v1');
  assert.equal(protocol.reviewer.role, 'fresh separate strong-model semantic realization reviewer');
  assert.equal(protocol.reviewer.humanGoldAuthority, false);
  assert.equal(protocol.reviewer.knowsIntendedAnswer, false);
  assert.equal(protocol.reviewer.mayAmendCatalog, false);
  assert.equal(protocol.interpretationRule, 'CONSERVATIVE_PRAGMATIC_INTERPRETATION');
  assert.equal(protocol.sourceEpisodeExposure.fullUnselectedSourceEpisodeShown, false);

  for (const blind of ['item ID', 'semanticSkeletonId', 'boundary class', 'split',
    'discourse pattern', 'effective-current reference label',
    'source-audit reason or disposition']) {
    assert.equal(protocol.blindFields.includes(blind), true, blind);
  }
  assert.deepEqual(protocol.outputContract.required,
    ['reviewRowId', 'disposition', 'decision', 'reason']);
  assert.deepEqual(protocol.outputContract.dispositionEnum, ['KEEP', 'FIX', 'REJECT']);
  assert.deepEqual(protocol.outputContract.decisionEnum, ['CLEAR', 'ESCALATE', null]);
  assert.equal(protocol.reconciliation.cleanAgreement.provenance,
    'CATALOG_STRONG_MODEL_CONFIRMED');
  assert.equal(protocol.reconciliation.cleanAgreement.eligibility, 'PROVISIONAL');
  for (const key of ['humanPacketMayExposeRoutingReason', 'humanPacketMayExposeModelDecision',
    'humanPacketMayExposeReferenceLabel']) {
    assert.equal(protocol.reconciliation.mandatoryHumanAdjudication[key], false, key);
  }
  assert.equal(protocol.reconciliation.calibrationSample.size, 32);
  assert.equal(protocol.reconciliation.calibrationSample.extrapolatedToUnreviewedRows, false);
  assert.equal(protocol.reconciliation.calibrationSample.failClosedWhenPopulationBelowSize, true);
  assert.equal(protocol.reconciliation.calibrationSample.populatedCellCountIsNotAFixedInvariant,
    true);

  // No reference label, no per-row answer, no audit disposition rides along.
  const serialized = JSON.stringify(protocol.reconciliation.calibrationSample);
  for (const token of ['p1b6-item-', 'p1b6-sk-']) {
    assert.equal(serialized.includes(token), false, token);
  }
});

test('the semantic-review packet holds exactly the 301 audit-PASS rows', () => {
  const built = packet();
  const batch = readJson(BATCH);
  const eligible = batch.items.filter(item => !FAILED.includes(item.itemId));

  assert.equal(built.name, strongModel.PACKET_IDENTITY);
  assert.equal(built.rows.length, 301);
  assert.equal(new Set(built.rows.map(row => row.reviewRowId)).size, 301);
  assert.equal(built.rendererIdentity, RENDERER_IDENTITY);
  assert.equal(built.sourceBatch.sha256, BATCH_SHA256);
  assert.equal(built.sourceAuditAttempt, 'p1b6-source-audit-batch-003-attempt-001');
  assert.equal(built.reviewProtocol.identity, strongModel.PROTOCOL_IDENTITY);
  assert.equal(built.reviewProtocol.sha256, sha256RawBytes(read(SM_PROTOCOL)));
  assert.equal(built.reviewAuthorityAmendment.sha256, sha256RawBytes(read(AMENDMENT)));

  // Every row comes from an audit PASS item, and the failed rows are absent.
  const byRowId = new Map(built.rows.map(row => [row.reviewRowId, row]));
  for (const item of eligible) {
    const row = byRowId.get(strongModel.opaqueReviewRowId(BATCH_SHA256, item.itemId));
    assert.equal(Boolean(row), true, item.itemId);
    // selectedBundle is exactly the canonical renderer output, byte for byte.
    assert.equal(row.selectedBundle, renderHumanReviewText(batch, item), item.itemId);
  }
  for (const failedId of FAILED) {
    assert.equal(byRowId.has(strongModel.opaqueReviewRowId(BATCH_SHA256, failedId)), false,
      failedId);
  }

  // Opaque ordering, not source item order.
  const ordered = [...built.rows].sort((left, right) =>
    (left.reviewRowId < right.reviewRowId ? -1 : 1));
  assert.deepEqual(built.rows.map(row => row.reviewRowId), ordered.map(row => row.reviewRowId));
  assert.notDeepEqual(built.rows.map(row => row.reviewRowId),
    eligible.map(item => strongModel.opaqueReviewRowId(BATCH_SHA256, item.itemId)));

  // Row payload carries nothing but the opaque ID and the visible bundle.
  for (const row of built.rows) assert.deepEqual(Object.keys(row), ['reviewRowId', 'selectedBundle']);
  const serialized = JSON.stringify(built.rows);
  for (const token of ['p1b6-item-', 'p1b6-sk-', 'p1b6-se-', 'p1b6-sf-', 'p1b6-audit-',
    'CLEAR', 'ESCALATE', 'humanLabel', 'splitAssignment', 'boundaryClass', 'discoursePattern',
    'disposition', 'PASS', 'FAIL']) {
    assert.equal(serialized.includes(token), false, token);
  }
});

test('the packet builder fails closed on every audit binding', () => {
  const receipt = readJson(RECEIPT);
  const batchBytes = read(BATCH);
  const reject = (mutate, pattern, label) => {
    const drifted = structuredClone(receipt);
    mutate(drifted);
    assert.throws(() => strongModel.buildStrongModelReviewPacket(batchBytes, drifted),
      pattern, label);
  };

  reject(row => { row.status = 'COMPLETE_PASS'; }, /receipt binding is invalid/, 'status');
  reject(row => { row.auditPacketSha256 = 'x'.repeat(64); },
    /receipt binding is invalid/, 'packet sha');
  reject(row => { row.sourceAuditProtocol.sha256 = 'x'.repeat(64); },
    /receipt binding is invalid/, 'protocol sha');
  reject(row => { row.auditedSourceBatch.rawSha256 = 'x'.repeat(64); },
    /receipt binding is invalid/, 'batch sha');
  reject(row => { row.summary.PASS = 302; row.summary.FAIL = 2; },
    /not the audited 301 PASS/, 'summary drift');
  reject(row => { row.rows = row.rows.slice(0, 303); }, /P1-B6/, 'missing row');
  reject(row => { row.rows[0].disposition = 'FAIL'; },
    /failed rows are not the audited/, 'extra failure');
  reject(row => { row.failedItems.itemIds = ['p1b6-item-b003-001']; },
    /failedItems do not match/, 'failedItems drift');

  // A batch that is not the audited bytes is refused before anything else.
  const drifted = JSON.parse(batchBytes.toString('utf8'));
  drifted.sourceEpisodes[0].turns[0].text = `${drifted.sourceEpisodes[0].turns[0].text} .`;
  assert.throws(() => strongModel.buildStrongModelReviewPacket(
    Buffer.from(`${JSON.stringify(drifted, null, 2)}\n`, 'utf8'), receipt),
  /not the audited batch/, 'batch drift');

  // Refuses to overwrite an existing output, like every other packet builder here.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b6-sm-'));
  const out = path.join(dir, 'packet.json');
  fs.writeFileSync(out, '{}');
  assert.throws(() => strongModel.writeStrongModelReviewPacket(
    path.join(ROOT, BATCH), path.join(ROOT, RECEIPT), out), /will not be overwritten/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('prospective reconciliation routes disagreement and keeps clean agreements provisional', () => {
  const references = [
    { reviewRowId: 'r1', itemId: 'i1', boundaryClass: 'REFERENT', referenceLabel: 'CLEAR' },
    { reviewRowId: 'r2', itemId: 'i2', boundaryClass: 'REFERENT', referenceLabel: 'ESCALATE' },
    { reviewRowId: 'r3', itemId: 'i3', boundaryClass: 'ACTUALITY', referenceLabel: 'CLEAR' },
    { reviewRowId: 'r4', itemId: 'i4', boundaryClass: 'ACTUALITY', referenceLabel: 'CLEAR' },
    { reviewRowId: 'r5', itemId: 'i5', boundaryClass: 'ACTUALITY', referenceLabel: 'CLEAR' },
  ];
  const results = [
    { reviewRowId: 'r1', disposition: 'KEEP', decision: 'CLEAR', reason: 'ok' },
    { reviewRowId: 'r2', disposition: 'KEEP', decision: 'CLEAR', reason: 'disagrees' },
    { reviewRowId: 'r3', disposition: 'FIX', decision: null, reason: 'repairable' },
    { reviewRowId: 'r4', disposition: 'REJECT', decision: null, reason: 'incoherent' },
    // r5 missing entirely.
  ];
  const { agreements, humanAdjudication } = strongModel.reconcile(results, references);

  assert.deepEqual(agreements.map(row => row.itemId), ['i1']);
  assert.equal(agreements[0].provenance, 'CATALOG_STRONG_MODEL_CONFIRMED');
  assert.equal(agreements[0].eligibility, 'PROVISIONAL');
  assert.deepEqual(humanAdjudication, [
    { itemId: 'i2', route: 'DECISION_DISAGREEMENT' },
    { itemId: 'i3', route: 'FIX' },
    { itemId: 'i4', route: 'REJECT' },
    { itemId: 'i5', route: 'MISSING_OR_INVALID_RESULT' },
  ]);

  // KEEP without a decision, and FIX with one, are both invalid and route to HUMAN.
  assert.deepEqual(strongModel.reconcile(
    [{ reviewRowId: 'r1', disposition: 'KEEP', decision: null, reason: 'x' }],
    [references[0]]).humanAdjudication,
  [{ itemId: 'i1', route: 'MISSING_OR_INVALID_RESULT' }]);
  assert.deepEqual(strongModel.reconcile(
    [{ reviewRowId: 'r1', disposition: 'FIX', decision: 'CLEAR', reason: 'x' }],
    [references[0]]).humanAdjudication,
  [{ itemId: 'i1', route: 'MISSING_OR_INVALID_RESULT' }]);
});

test('the calibration selector implements the deterministic prospective rule', () => {
  const batch = readJson(BATCH);
  const catalog = readJson(CATALOG);
  const skeletons = new Map(catalog.candidates.map(row => [row.semanticSkeletonId, row]));
  // Stand-in population: the audit-PASS rows. The real population is clean agreements, which do
  // not exist until the strong-model review runs.
  const population = batch.items.filter(item => !FAILED.includes(item.itemId)).map(item => {
    const skeleton = skeletons.get(item.semanticSkeletonId);
    return {
      itemId: item.itemId,
      boundaryClass: skeleton.boundaryClass,
      referenceLabel: skeleton.humanLabel,
    };
  });
  assert.equal(population.length, 301);

  const selected = strongModel.selectCalibrationSample(population);
  assert.equal(selected.length, 32);
  assert.equal(new Set(selected.map(row => row.itemId)).size, 32);

  // Every populated cell contributes at least one row.
  const cellKey = row => `${row.boundaryClass} ${row.referenceLabel}`;
  const populated = new Set(population.map(cellKey));
  assert.equal(populated.size, 15);
  assert.deepEqual([...new Set(selected.map(cellKey))].sort(), [...populated].sort());

  // Within a cell, selection follows the stable hash order and nothing else.
  for (const key of populated) {
    const cell = population.filter(row => cellKey(row) === key)
      .sort((left, right) => (strongModel.calibrationHash(left.itemId)
        < strongModel.calibrationHash(right.itemId) ? -1 : 1));
    const taken = selected.filter(row => cellKey(row) === key).map(row => row.itemId).sort();
    assert.deepEqual(taken, cell.slice(0, taken.length).map(row => row.itemId).sort(), key);
  }

  // Deterministic and order-independent.
  assert.deepEqual(strongModel.selectCalibrationSample([...population].reverse())
    .map(row => row.itemId), selected.map(row => row.itemId));
  assert.equal(strongModel.calibrationHash('p1b6-item-b003-001'),
    crypto.createHash('sha256')
      .update('p1b6-large-batch-human-calibration-v1\0p1b6-item-b003-001').digest('hex'));

  // Fails closed rather than shrinking the sample.
  assert.throws(() => strongModel.selectCalibrationSample(population.slice(0, 31)),
    /smaller than the 32-row calibration sample/);
});

test('the prospective design supersedes exhaustive HUMAN review without erasing history', () => {
  const design = read(
    'docs/Memory research/local-memory-inference/local-memory-inference-p1b6-design.md')
    .toString('utf8');

  // The prospective flow is the amended one.
  assert.equal(design.includes('blind strong-model semantic realization review'), true);
  assert.equal(design.includes('32-row deterministic HUMAN calibration sample'), true);
  assert.equal(design.includes('second independent strong-model review of selected HELD'), true);
  assert.equal(design.includes('## HELD Second-Pass Validation'), true);
  assert.equal(design.includes(
    'This is a second independent model review plus targeted adjudication. It is\n**not** repeated HUMAN review'), true);

  // History is preserved, not deleted.
  assert.equal(design.includes('### Historical HELD repeated HUMAN pass (batch-001 / batch-002)'),
    true);
  assert.equal(design.includes('repeated blind HUMAN review of every eligible accepted candidate'),
    true);
  assert.equal(design.includes('remain valid and immutable'), true);

  // The label constraint is over reference labels, not a HUMAN-labeling claim.
  assert.equal(design.includes(
    '**The 190 CLEAR / 190 ESCALATE\nconstraint is over the frozen reference labels**'), true);
  assert.equal(design.includes('301 PASS / 3 FAIL / 0 UNCERTAIN'), true);
  for (const failedId of FAILED) assert.equal(design.includes(failedId), true, failedId);
});

test('batch-003 and the historical artifacts are byte-identical after this step', () => {
  for (const [file, sha] of Object.entries(UNCHANGED)) {
    assert.equal(sha256RawBytes(read(file)), sha, file);
  }

  // The historical generic HUMAN builder is untouched and still refuses this receipt, because it
  // requires an all-PASS COMPLETE_PASS audit.
  assert.equal(typeof humanPacket.buildHumanReviewPacket, 'function');
  assert.throws(() => humanPacket.buildHumanReviewPacket(read(BATCH), readJson(RECEIPT)),
    /receipt binding is invalid|not an all-PASS result/);
});
