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
// Reconciliation reads the CURRENT reference authority, which is semantic contract v2. The
// superseded v1 catalog stays committed as historical evidence and must not be read here.
const CATALOG = 'fixtures/local-memory-inference-p1b6-skeleton-effective-current-v2.json';
const CATALOG_V1 = 'fixtures/local-memory-inference-p1b6-skeleton-effective-current.json';
const CATALOG_V2_SHA256 = 'f1e780195441246402ca389da188b1f7b8c4970f42fc1e6e3de2f436a3e9377c';
const CATALOG_V1_SHA256 = '48490b6e4e1494856ef3268d944da16093c4735d207e07c1fd9e8bbf69df2559';

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
  'fixtures/local-memory-inference-p1b6-skeleton-effective-current.json': CATALOG_V1_SHA256,
  'fixtures/local-memory-inference-p1b6-skeleton-effective-current-v2.json': CATALOG_V2_SHA256,
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
  // The amendment is historical: it binds the v1 catalog that was current when it was written,
  // and semantic contract v2 supersedes its label rule prospectively rather than editing it.
  assert.equal(amendment.boundTo.effectiveCurrentCatalog.rawSha256, CATALOG_V1_SHA256);
  assert.equal(amendment.boundTo.effectiveCurrentCatalog.identity,
    'xion-local-memory-inference-p1b6-skeleton-effective-current-v1');
  assert.equal(amendment.finalCorpusLabelConstraint.constraint, '190 CLEAR / 190 ESCALATE');
  const contract = readJson(
    'fixtures/local-memory-inference-p1b6-skeleton-semantic-contract-v2-receipt.json');
  assert.equal(contract.corpusLabelContract.retiredProspectively
    .includes('final corpus exactly 190 CLEAR / 190 ESCALATE'), true);
  assert.equal(contract.corpusLabelContract.replacedWithNewRatio, false);
  assert.equal(contract.authority.historicalEffectiveCurrentV1Overwritten, false);
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

  // The packet-generation contract did not change in the reconciliation fix, so the bytes the
  // reviewer receives must not move either.
  assert.equal(sha256RawBytes(strongModel.packetBytes(built)),
    '91b0276d0301eb0d8193868d7bfbe011bfe9132fdf3501ec1151fb8689cd57ca');

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

// Deriving the canonical population revalidates the whole audit binding, which is slow. The
// population is frozen and identical for every test, so derive it once and share it.
let canonicalCache = null;
const canonical = () => {
  if (!canonicalCache) {
    canonicalCache = strongModel.buildCanonicalReviewReferences(read(BATCH), readJson(RECEIPT));
  }
  return canonicalCache;
};
const cleanResults = (mutate = rows => rows) => mutate(canonical().references
  .map(row => ({
    reviewRowId: row.reviewRowId,
    disposition: 'KEEP',
    decision: row.referenceLabel,
    reason: 'stable judgment from the visible bundle',
  })));

test('canonical references are derived from the batch and the pinned v2 catalog', () => {
  const { references, catalogSha256, batchSha256 } = canonical();
  const batch = readJson(BATCH);
  const catalog = readJson(CATALOG);
  const skeletons = new Map(catalog.candidates.map(row => [row.semanticSkeletonId, row]));

  assert.equal(references.length, 301);
  assert.equal(new Set(references.map(row => row.itemId)).size, 301);
  assert.equal(new Set(references.map(row => row.reviewRowId)).size, 301);
  assert.equal(batchSha256, BATCH_SHA256);
  assert.equal(catalogSha256, strongModel.CATALOG_SHA256);
  assert.equal(catalogSha256, sha256RawBytes(read(CATALOG)));
  assert.equal(catalogSha256, CATALOG_V2_SHA256);
  assert.equal(readJson(CATALOG).name,
    'xion-local-memory-inference-p1b6-skeleton-effective-current-v2');
  // The superseded v1 catalog is still committed, but it is not what reconciliation reads.
  assert.notEqual(catalogSha256, CATALOG_V1_SHA256);
  assert.equal(sha256RawBytes(read(CATALOG_V1)), CATALOG_V1_SHA256);

  const items = new Map(batch.items.map(item => [item.itemId, item]));
  for (const reference of references) {
    const item = items.get(reference.itemId);
    assert.equal(FAILED.includes(reference.itemId), false, reference.itemId);
    assert.equal(reference.semanticSkeletonId, item.semanticSkeletonId, reference.itemId);
    assert.equal(reference.reviewRowId,
      strongModel.opaqueReviewRowId(BATCH_SHA256, reference.itemId));
    const skeleton = skeletons.get(item.semanticSkeletonId);
    assert.equal(reference.boundaryClass, skeleton.boundaryClass, reference.itemId);
    assert.equal(reference.referenceLabel, skeleton.humanLabel, reference.itemId);
    assert.equal(Object.isFrozen(reference), true, reference.itemId);
  }

  // Reference labels track the v2 contract, not the retired v1 one.
  assert.deepEqual(catalog.candidates.reduce((totals, row) => {
    totals[row.humanLabel] = (totals[row.humanLabel] || 0) + 1;
    return totals;
  }, {}), { CLEAR: 45, ESCALATE: 11 });
  const v1Labels = new Map(readJson(CATALOG_V1).candidates
    .map(row => [row.semanticSkeletonId, row.humanLabel]));
  assert.equal(references.some(row => row.referenceLabel !== v1Labels.get(row.semanticSkeletonId)),
    true, 'at least one reference label must differ from the superseded v1 catalog');

  // A catalog that is not the pinned bytes cannot supply reference labels.
  const drifted = structuredClone(catalog);
  drifted.candidates[0].humanLabel =
    drifted.candidates[0].humanLabel === 'CLEAR' ? 'ESCALATE' : 'CLEAR';
  assert.throws(() => strongModel.buildCanonicalReviewReferences(read(BATCH), readJson(RECEIPT),
    Buffer.from(`${JSON.stringify(drifted, null, 2)}\n`, 'utf8')),
  /not the pinned catalog/);
});

test('callers have no authority over item, boundary class or reference label', () => {
  // There is no public reconciliation path that accepts a reference population at all.
  assert.equal(Object.hasOwn(strongModel, 'reconcile'), false);
  assert.equal(typeof strongModel.reconcileBatch003, 'function');

  const { references } = canonical();
  const flipped = references[0].referenceLabel === 'CLEAR' ? 'ESCALATE' : 'CLEAR';

  // A caller-authored reference asserting the opposite label changes nothing: the extra argument
  // is not a reference population, and the label still comes from the pinned catalog.
  const agreeing = cleanResults();
  const withBogusReferences = strongModel.reconcileBatch003(read(BATCH), readJson(RECEIPT),
    agreeing, undefined);
  assert.equal(withBogusReferences.agreements.length, 301);
  assert.equal(withBogusReferences.humanAdjudication.length, 0);

  // Answering with the flipped label is a disagreement, not an agreement, however the caller
  // describes it.
  const lying = cleanResults(rows => rows.map((row, index) =>
    (index === 0 ? { ...row, decision: flipped } : row)));
  const result = strongModel.reconcileBatch003(read(BATCH), readJson(RECEIPT), lying);
  assert.equal(result.agreements.length, 300);
  assert.deepEqual(result.humanAdjudication,
    [{ itemId: references[0].itemId, route: 'DECISION_DISAGREEMENT' }]);
  assert.equal(result.agreements.some(row => row.itemId === references[0].itemId), false);
});

test('a coordinated fake item and label cannot manufacture a clean agreement', () => {
  const forgedItemId = 'p1b6-item-b003-999';
  const forged = [{
    reviewRowId: strongModel.opaqueReviewRowId(BATCH_SHA256, forgedItemId),
    disposition: 'KEEP',
    decision: 'CLEAR',
    reason: 'forged',
  }];
  assert.throws(() => strongModel.reconcileBatch003(read(BATCH), readJson(RECEIPT), forged),
    /not a known batch-003 review row/);

  // A source-audit FAIL item has no review row, so it cannot be smuggled back in either.
  const excluded = [{
    reviewRowId: strongModel.opaqueReviewRowId(BATCH_SHA256, FAILED[0]),
    disposition: 'KEEP',
    decision: 'CLEAR',
    reason: 'excluded row',
  }];
  assert.throws(() => strongModel.reconcileBatch003(read(BATCH), readJson(RECEIPT), excluded),
    /not a known batch-003 review row/);

  // Every agreement's boundary class and label trace to the catalog, never to the result rows.
  const catalog = readJson(CATALOG);
  const skeletons = new Map(catalog.candidates.map(row => [row.semanticSkeletonId, row]));
  const byItemId = new Map(canonical().references.map(row => [row.itemId, row]));
  for (const agreement of strongModel.reconcileBatch003(read(BATCH), readJson(RECEIPT),
    cleanResults()).agreements) {
    const skeleton = skeletons.get(byItemId.get(agreement.itemId).semanticSkeletonId);
    assert.equal(agreement.boundaryClass, skeleton.boundaryClass, agreement.itemId);
    assert.equal(agreement.referenceLabel, skeleton.humanLabel, agreement.itemId);
  }
});

test('duplicate and unknown result rows are artifact-integrity failures that fail closed', () => {
  const { references } = canonical();

  // Duplicates must never be silently collapsed by a Map.
  const duplicated = cleanResults(rows => [...rows, { ...rows[0] }]);
  assert.throws(() => strongModel.reconcileBatch003(read(BATCH), readJson(RECEIPT), duplicated),
    /duplicates a review row/);
  // Even a duplicate that disagrees with itself fails closed rather than picking a winner.
  const contradicting = cleanResults(rows => [...rows,
    { ...rows[0], decision: rows[0].decision === 'CLEAR' ? 'ESCALATE' : 'CLEAR' }]);
  assert.throws(() => strongModel.reconcileBatch003(read(BATCH), readJson(RECEIPT), contradicting),
    /duplicates a review row/);

  // Unknown and extra rows are never silently ignored.
  const extra = cleanResults(rows => [...rows,
    { reviewRowId: 'p1b6-smreview-0000000000000000', disposition: 'KEEP', decision: 'CLEAR', reason: 'x' }]);
  assert.throws(() => strongModel.reconcileBatch003(read(BATCH), readJson(RECEIPT), extra),
    /not a known batch-003 review row/);
  for (const bad of [null, 42, {}, { reviewRowId: 7 }]) {
    assert.throws(() => strongModel.reconcileBatch003(read(BATCH), readJson(RECEIPT),
      cleanResults(rows => [...rows, bad])), /not a known batch-003 review row/);
  }
  assert.throws(() => strongModel.reconcileBatch003(read(BATCH), readJson(RECEIPT), {}),
    /results must be an array/);

  // The validator itself draws the same line.
  assert.equal(strongModel.validateStrongModelResults(cleanResults(), references).size, 301);
  assert.doesNotThrow(() => strongModel.validateStrongModelResults([], references),
    'an empty artifact is every row missing, not an integrity failure');
  assert.equal(strongModel.reconcileBatch003(read(BATCH), readJson(RECEIPT), [])
    .humanAdjudication.length, 301);
});

test('missing and malformed known rows route to HUMAN instead of failing the run', () => {
  const { references } = canonical();
  const target = references[5];

  // Missing expected row.
  const missing = cleanResults(rows => rows.filter(row => row.reviewRowId !== target.reviewRowId));
  const missingResult = strongModel.reconcileBatch003(read(BATCH), readJson(RECEIPT), missing);
  assert.equal(missingResult.agreements.length, 300);
  assert.deepEqual(missingResult.humanAdjudication,
    [{ itemId: target.itemId, route: 'MISSING_OR_INVALID_RESULT' }]);

  // Malformed but validly identified rows: each routes, none becomes an agreement.
  const malformed = [
    { disposition: 'KEEP', decision: null, reason: 'keep needs a decision' },
    { disposition: 'FIX', decision: 'CLEAR', reason: 'fix must be null' },
    { disposition: 'REJECT', decision: 'ESCALATE', reason: 'reject must be null' },
    { disposition: 'MAYBE', decision: 'CLEAR', reason: 'unknown disposition' },
    { disposition: 'KEEP', decision: 'PROBABLY', reason: 'unknown decision' },
    { disposition: 'KEEP', decision: target.referenceLabel, reason: '   ' },
    { disposition: 'KEEP', decision: target.referenceLabel, reason: 42 },
    { disposition: 'KEEP', decision: target.referenceLabel },
    { disposition: 'KEEP', decision: target.referenceLabel, reason: 'ok', extra: true },
  ];
  for (const shape of malformed) {
    const rows = cleanResults(all => all.map(row => (row.reviewRowId === target.reviewRowId
      ? { reviewRowId: target.reviewRowId, ...shape } : row)));
    const result = strongModel.reconcileBatch003(read(BATCH), readJson(RECEIPT), rows);
    assert.equal(result.agreements.some(row => row.itemId === target.itemId), false,
      JSON.stringify(shape));
    assert.deepEqual(result.humanAdjudication,
      [{ itemId: target.itemId, route: 'MISSING_OR_INVALID_RESULT' }], JSON.stringify(shape));
  }
});

test('clean agreement, disagreement, FIX and REJECT route exactly as the contract says', () => {
  const { references } = canonical();
  const [keepRow, disagreeRow, fixRow, rejectRow] = references;
  const flipped = label => (label === 'CLEAR' ? 'ESCALATE' : 'CLEAR');
  const rows = cleanResults(all => all.map(row => {
    if (row.reviewRowId === disagreeRow.reviewRowId) {
      return { ...row, decision: flipped(disagreeRow.referenceLabel) };
    }
    if (row.reviewRowId === fixRow.reviewRowId) {
      return { ...row, disposition: 'FIX', decision: null, reason: 'repairable' };
    }
    if (row.reviewRowId === rejectRow.reviewRowId) {
      return { ...row, disposition: 'REJECT', decision: null, reason: 'incoherent' };
    }
    return row;
  }));
  const result = strongModel.reconcileBatch003(read(BATCH), readJson(RECEIPT), rows);

  assert.equal(result.agreements.length, 298);
  assert.deepEqual(result.humanAdjudication.sort((left, right) =>
    (left.itemId < right.itemId ? -1 : 1)), [
    { itemId: disagreeRow.itemId, route: 'DECISION_DISAGREEMENT' },
    { itemId: fixRow.itemId, route: 'FIX' },
    { itemId: rejectRow.itemId, route: 'REJECT' },
  ].sort((left, right) => (left.itemId < right.itemId ? -1 : 1)));

  const kept = result.agreements.find(row => row.itemId === keepRow.itemId);
  assert.equal(kept.provenance, 'CATALOG_STRONG_MODEL_CONFIRMED');
  assert.equal(kept.eligibility, 'PROVISIONAL');
  for (const agreement of result.agreements) {
    assert.deepEqual(Object.keys(agreement).sort(),
      ['boundaryClass', 'eligibility', 'itemId', 'provenance', 'referenceLabel']);
    assert.equal(agreement.provenance, 'CATALOG_STRONG_MODEL_CONFIRMED');
    assert.equal(agreement.eligibility, 'PROVISIONAL');
  }
  // Nothing here is HUMAN gold, and no HUMAN decision was created.
  assert.equal(JSON.stringify(result).includes('HUMAN_ADJUDICATED'), false);
});

test('calibration only consumes reconciled clean agreements', () => {
  const rows = cleanResults();
  const selected = strongModel.selectBatch003CalibrationSample(read(BATCH), readJson(RECEIPT),
    rows);
  assert.equal(selected.length, 32);

  // Boundary class and reference label on every selected row trace to the catalog.
  const catalog = readJson(CATALOG);
  const skeletons = new Map(catalog.candidates.map(row => [row.semanticSkeletonId, row]));
  const byItemId = new Map(canonical().references.map(row => [row.itemId, row]));
  for (const row of selected) {
    const skeleton = skeletons.get(byItemId.get(row.itemId).semanticSkeletonId);
    assert.equal(row.boundaryClass, skeleton.boundaryClass, row.itemId);
    assert.equal(row.referenceLabel, skeleton.humanLabel, row.itemId);
    assert.equal(row.provenance, 'CATALOG_STRONG_MODEL_CONFIRMED', row.itemId);
  }

  // Caller-authored rows cannot enter the selector as canonical data.
  const forged = Array.from({ length: 40 }, (unused, index) => ({
    itemId: `forged-${index}`, boundaryClass: 'REFERENT', referenceLabel: 'CLEAR',
  }));
  assert.throws(() => strongModel.selectCalibrationSample(forged),
    /not a reconciled clean-agreement row/);
  assert.throws(() => strongModel.selectCalibrationSample(forged.map(row =>
    ({ ...row, provenance: 'HUMAN_ADJUDICATED', eligibility: 'PROVISIONAL' }))),
  /not a reconciled clean-agreement row/);

  // The 32-row allocation rule itself is unchanged.
  const { agreements } = strongModel.reconcileBatch003(read(BATCH), readJson(RECEIPT), rows);
  const cellKey = row => `${row.boundaryClass}\u0000${row.referenceLabel}`;
  const populated = new Set(agreements.map(cellKey));
  // Populated cells are whatever the agreement population actually has; the count is not an
  // invariant, so it is derived here rather than hard-coded.
  assert.equal(populated.size, new Set(canonical().references.map(cellKey)).size);
  assert.equal(populated.size <= 16, true);
  assert.deepEqual([...new Set(selected.map(cellKey))].sort(), [...populated].sort());
  for (const key of populated) {
    const cell = agreements.filter(row => cellKey(row) === key)
      .sort((left, right) => (strongModel.calibrationHash(left.itemId)
        < strongModel.calibrationHash(right.itemId) ? -1 : 1));
    const taken = selected.filter(row => cellKey(row) === key).map(row => row.itemId).sort();
    assert.deepEqual(taken, cell.slice(0, taken.length).map(row => row.itemId).sort(), key);
  }
  assert.deepEqual(strongModel.selectCalibrationSample([...agreements].reverse())
    .map(row => row.itemId), selected.map(row => row.itemId));
  assert.equal(strongModel.calibrationHash('p1b6-item-b003-001'),
    crypto.createHash('sha256')
      .update('p1b6-large-batch-human-calibration-v1\0p1b6-item-b003-001').digest('hex'));
  assert.throws(() => strongModel.selectCalibrationSample(agreements.slice(0, 31)),
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

  // No stale claim that the source audit is still the pending next gate.
  assert.equal(/source audit[^.]*is the next gate and has NOT been\nexecuted/u.test(design), false);
  assert.equal(design.includes(
    '**Current state: that source audit has since run and is complete at 301 PASS / 3\nFAIL / 0 UNCERTAIN**'), true);
  assert.equal(design.includes(
    '**301-row blind strong-model semantic review**, which has NOT been executed.'), true);
  // The pre-audit story is kept, explicitly marked as a snapshot.
  assert.equal(design.includes('(historical snapshot)'), true);

  // Prospective post-freeze wording protects reference labels and provenance, not blanket gold.
  assert.equal(design.includes('membership, evidence, targets, and HUMAN gold are immutable'),
    false);
  assert.equal(design.includes(
    'frozen **reference labels** and **label\nprovenance** are immutable'), true);
  assert.equal(design.includes('relabel HUMAN gold to satisfy'), false);
  assert.equal(design.includes('relabel a frozen reference label'), true);
  // Historical wording is untouched where it accurately describes batch-001/batch-002.
  assert.equal(design.includes(
    'For historical batch-001/batch-002 review, HUMAN gold was\nauthoritative'), true);
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

test('the committed reconciliation receipt binds to real result bytes and claims no gate', () => {
  const RECONCILIATION =
    'fixtures/local-memory-inference-p1b6-strong-model-semantic-review-batch-003-attempt-001.json';
  const receipt = readJson(RECONCILIATION);
  const { references } = canonical();
  const byItemId = new Map(references.map(row => [row.itemId, row]));

  assert.equal(receipt.attemptId, 'p1b6-strong-model-semantic-review-batch-003-attempt-001');
  assert.equal(receipt.status, 'COMPLETE_RECONCILED_AGAINST_SEMANTIC_CONTRACT_V2');
  assert.equal(receipt.reviewedSourceBatch.rawSha256, BATCH_SHA256);
  assert.equal(receipt.sourceAuditAttempt, 'p1b6-source-audit-batch-003-attempt-001');

  // The issued packet binding is the one that was actually issued.
  assert.equal(receipt.reviewPacket.rows, 301);
  assert.equal(receipt.reviewPacket.sha256,
    '91b0276d0301eb0d8193868d7bfbe011bfe9132fdf3501ec1151fb8689cd57ca');
  assert.equal(receipt.reviewProtocol.sha256, sha256RawBytes(read(SM_PROTOCOL)));
  assert.equal(receipt.reviewAuthorityAmendment.sha256, sha256RawBytes(read(AMENDMENT)));

  // Reconciliation authority is v2, separate from the packet's own provenance.
  assert.equal(receipt.currentReferenceAuthority.rawSha256, CATALOG_V2_SHA256);
  assert.equal(receipt.currentReferenceAuthority.identity,
    'xion-local-memory-inference-p1b6-skeleton-effective-current-v2');

  // Raw result bytes are bound by SHA and explicitly not committed; no reviewer metadata is
  // invented, because the artifact carried none.
  assert.equal(receipt.rawResultArtifact.filename,
    'p1b6-batch-003-strong-model-semantic-review-results.json');
  assert.equal(/^[0-9a-f]{64}$/u.test(receipt.rawResultArtifact.sha256), true);
  assert.equal(receipt.rawResultArtifact.committed, false);
  assert.equal(receipt.reviewerExecutionProvenance.evidenceBasis,
    'NOT_SUPPLIED_IN_RESULT_ARTIFACT');
  for (const invented of ['provider', 'surface', 'model', 'reasoningSetting']) {
    assert.equal(Object.hasOwn(receipt.reviewerExecutionProvenance, invented), false, invented);
  }

  // Counts are internally consistent and every routed item is a real canonical review row.
  assert.equal(receipt.rawResultSummary.total, 301);
  assert.equal(receipt.reconciliation.agreements
    + receipt.reconciliation.humanAdjudicationRouted, 301);
  assert.equal(receipt.routedItemIds.length, receipt.reconciliation.humanAdjudicationRouted);
  assert.equal(new Set(receipt.routedItemIds).size, receipt.routedItemIds.length);
  for (const itemId of receipt.routedItemIds) {
    assert.equal(byItemId.has(itemId), true, itemId);
    assert.equal(FAILED.includes(itemId), false, itemId);
  }
  assert.equal(Object.values(receipt.disagreementsBySkeleton)
    .reduce((total, row) => total + row.count, 0),
  receipt.reconciliation.humanAdjudicationRouted);
  assert.equal(receipt.reconciliation.provenanceForAgreements, 'CATALOG_STRONG_MODEL_CONFIRMED');
  assert.equal(receipt.reconciliation.eligibilityForAgreements, 'PROVISIONAL');

  // Downstream gates stay shut.
  for (const [key, value] of Object.entries(receipt.authority)) {
    assert.equal(value, false, key);
  }
});
