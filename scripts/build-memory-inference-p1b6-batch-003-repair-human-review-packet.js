#!/usr/bin/env node
'use strict';

// Fresh blind HUMAN review packet for the two repaired batch-003 candidates (162, 214), under
// semantic contract v3.
//
// Building the packet makes no HUMAN decision and embeds no expected CLEAR/ESCALATE answer.
// The owner's attempt-001 result is validated against the packet below; neither step accepts
// a row, freezes a label, releases HELD or trains anything. The visible bundles come straight
// from the mechanically rebuilt audited source-audit packet, so the reviewer sees
// byte-for-byte what passed source audit.
//
// The historical batch-002 repair HUMAN builder and the batch-003 v2 calibration protocol are
// not reused: the former is pinned to batch-002, the latter carries the superseded v2 rule.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { RENDERER_IDENTITY } = require('../lib/memory-inference-p1b6-surfaces');
const auditPacketBuilder =
  require('./build-memory-inference-p1b6-batch-003-repair-source-audit-packet');

const ROOT = path.resolve(__dirname, '..');
const PACKET_IDENTITY =
  'xion-local-memory-inference-p1b6-batch-003-repair-human-review-packet-v1';
const PACKET_STATUS = 'BLIND_HUMAN_REVIEW_PACKET_NOT_RUN';
// Disjoint from p1b6-review-, p1b6-rereview-, p1b6-hacreview- and batch-002 p1b6-repair-review-.
const REVIEW_ID_NAMESPACE = 'p1b6-b003-repair-review';
const V3_RECEIPT = Object.freeze({
  identity: 'xion-local-memory-inference-p1b6-skeleton-semantic-contract-v3-receipt-v1',
  rawSha256: '10f8a10eb3325b86c9d9282fc951ee53b2037918c4258c89a7694822df9a98e1',
});

const CANONICAL_INPUTS = Object.freeze({
  auditReceipt: Object.freeze({
    label: 'repair source-audit receipt',
    identity: 'xion-local-memory-inference-p1b6-batch-003-repair-source-audit-attempt-001-receipt-v1',
    rawSha256: '60191c33f71a7531488ff7767fe281538a3498028944fae370c7b39e098f7b13',
    fixture: 'local-memory-inference-p1b6-batch-003-repair-source-audit-attempt-001.json',
  }),
  reviewProtocol: Object.freeze({
    label: 'repair HUMAN review protocol',
    identity: 'xion-local-memory-inference-p1b6-batch-003-repair-human-review-protocol-v1',
    rawSha256: 'bb7c79d484b35df0ef91c8cf29781d048e15cef481b878d1cd18e8b88311e10d',
    fixture: 'local-memory-inference-p1b6-batch-003-repair-human-review-protocol.json',
  }),
});
const AUDIT_ATTEMPT_ID = 'p1b6-batch-003-repair-source-audit-attempt-001';
const RAW_RESULT_FILENAME = 'p1b6-b003-repair-source-audit-results.json';
const RAW_RESULT_SHA256 = 'fcf8265ddafc26733b80ca8579c0f25a44eae7a3c4a88b05e14b03fed8d96963';

function fail(message) {
  throw new TypeError(`P1-B6 batch-003 repair HUMAN review packet ${message}`);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function verifyCanonicalInput(key, rawBytes) {
  const pinned = CANONICAL_INPUTS[key];
  if (!Buffer.isBuffer(rawBytes) && !ArrayBuffer.isView(rawBytes)) {
    fail(`${pinned.label} bytes were not supplied`);
  }
  if (sha256RawBytes(rawBytes) !== pinned.rawSha256) {
    fail(`${pinned.label} bytes are not the canonical evidence`);
  }
  const artifact = JSON.parse(Buffer.from(rawBytes).toString('utf8'));
  if (artifact.name !== pinned.identity) fail(`${pinned.label} identity is not canonical`);
  return artifact;
}

function packetBytes(packet) {
  return Buffer.from(`${JSON.stringify(packet, null, 2)}\n`, 'utf8');
}

// The item ID is hash input only and never reaches the packet.
function opaqueReviewRowId(candidateSha256, itemId) {
  const digest = crypto.createHash('sha256')
    .update(`${REVIEW_ID_NAMESPACE}\0${PACKET_IDENTITY}\0${candidateSha256}\0${itemId}`)
    .digest('hex').slice(0, 16);
  return `${REVIEW_ID_NAMESPACE}-${digest}`;
}

// The protocol must bind v3 by identity and exact raw SHA, as the audited candidate does.
function validateProtocol(protocol) {
  const authority = auditPacketBuilder.CANONICAL_INPUTS.semanticAuthority;
  const contract = protocol.semanticContract;
  if (protocol.status !== 'PREREGISTERED_NOT_RUN'
    || contract?.interpretationRuleIdentity !== 'P1B6_SEMANTIC_CONTRACT_V3'
    || !exactKeys(contract.semanticAuthority, ['identity', 'rawSha256'])
    || contract.semanticAuthority.identity !== authority.identity
    || contract.semanticAuthority.rawSha256 !== authority.rawSha256
    || !exactKeys(contract.semanticContractReceipt, ['identity', 'rawSha256'])
    || contract.semanticContractReceipt.identity !== V3_RECEIPT.identity
    || contract.semanticContractReceipt.rawSha256 !== V3_RECEIPT.rawSha256) {
    fail('protocol does not bind semantic contract v3');
  }
  return protocol;
}

// The audit receipt is the gate: it must bind the mechanically rebuilt audit packet, cover
// exactly its two opaque IDs, be all PASS and fresh, and claim only source-bundle passage.
function validateAuditReceipt(receipt,
  auditInputs = auditPacketBuilder.loadCanonicalInputs()) {
  const auditPacket = auditPacketBuilder.buildRepairSourceAuditPacket(auditInputs);
  const pinned = auditPacketBuilder.CANONICAL_INPUTS;

  if (!exactKeys(receipt, [
    'name', 'attemptId', 'status', 'auditPacketIdentity', 'auditPacketSha256',
    'sourceAuditProtocol', 'auditedRepairCandidate', 'semanticAuthority', 'rawResultArtifact',
    'auditorExecutionProvenance', 'freshness', 'summary', 'authority', 'rows',
  ]) || receipt.name !== CANONICAL_INPUTS.auditReceipt.identity
    || receipt.attemptId !== AUDIT_ATTEMPT_ID
    || receipt.status !== 'COMPLETE_PASS'
    || receipt.auditPacketIdentity !== auditPacket.name
    || receipt.auditPacketSha256 !== sha256RawBytes(packetBytes(auditPacket))) {
    fail('audit receipt does not bind the rebuilt audit packet');
  }
  if (!exactKeys(receipt.auditedRepairCandidate, ['identity', 'rawSha256'])
    || receipt.auditedRepairCandidate.identity !== pinned.repairCandidate.identity
    || receipt.auditedRepairCandidate.rawSha256 !== pinned.repairCandidate.rawSha256) {
    fail('audit receipt does not bind the canonical repair candidate');
  }
  if (!exactKeys(receipt.sourceAuditProtocol, ['identity', 'sha256'])
    || receipt.sourceAuditProtocol.identity !== auditPacket.sourceAuditProtocol.identity
    || receipt.sourceAuditProtocol.sha256 !== pinned.sourceAuditProtocol.rawSha256) {
    fail('audit receipt does not bind the canonical source-audit protocol');
  }
  if (!exactKeys(receipt.semanticAuthority, ['identity', 'rawSha256'])
    || receipt.semanticAuthority.identity !== pinned.semanticAuthority.identity
    || receipt.semanticAuthority.rawSha256 !== pinned.semanticAuthority.rawSha256) {
    fail('audit receipt does not bind semantic authority v3');
  }
  if (!exactKeys(receipt.rawResultArtifact, ['filename', 'sha256'])
    || receipt.rawResultArtifact.filename !== RAW_RESULT_FILENAME
    || receipt.rawResultArtifact.sha256 !== RAW_RESULT_SHA256) {
    fail('audit receipt does not bind the audited raw result');
  }
  if (receipt.freshness?.freshJudgmentsForEveryRow !== true
    || receipt.freshness?.historicalSourceAuditResultInherited !== false) {
    fail('audit receipt inherits or claims to inherit a historical audit result');
  }
  if (!exactKeys(receipt.authority, [
    'sourceBundleGatePassedForRepairedCandidates', 'humanSemanticReviewOccurred',
    'humanGoldAssignedOrFrozen', 'datasetAcceptancePerformed', 'heldOutReleasePerformed',
    'trainingOccurred',
  ]) || receipt.authority.sourceBundleGatePassedForRepairedCandidates !== true
    || Object.entries(receipt.authority)
      .some(([key, value]) => key !== 'sourceBundleGatePassedForRepairedCandidates'
        && value !== false)) {
    fail('audit receipt claims authority it does not have');
  }

  const expectedIds = auditPacket.rows.map(row => row.auditRowId);
  if (!exactKeys(receipt.summary, ['total', 'PASS', 'FAIL', 'UNCERTAIN'])
    || receipt.summary.total !== 2 || receipt.summary.PASS !== 2
    || receipt.summary.FAIL !== 0 || receipt.summary.UNCERTAIN !== 0
    || expectedIds.length !== 2) {
    fail('audit receipt summary is not 2 PASS / 0 FAIL / 0 UNCERTAIN');
  }
  if (!Array.isArray(receipt.rows) || receipt.rows.length !== expectedIds.length) {
    fail('audit receipt does not hold exactly one row per audited candidate');
  }
  const seen = new Set();
  for (const row of receipt.rows) {
    if (!exactKeys(row, ['auditRowId', 'disposition', 'reason'])
      || row.disposition !== 'PASS'
      || typeof row.reason !== 'string' || row.reason.trim() === ''
      || !expectedIds.includes(row.auditRowId) || seen.has(row.auditRowId)) {
      fail('audit rows are incomplete, unknown, duplicated, or not all PASS');
    }
    seen.add(row.auditRowId);
  }
  return auditPacket;
}

function buildRepairHumanReviewPacket(canonicalInputs) {
  if (!canonicalInputs || typeof canonicalInputs !== 'object') {
    fail('canonical input bytes were not supplied');
  }
  const receipt = verifyCanonicalInput('auditReceipt', canonicalInputs.auditReceipt);
  const protocol = validateProtocol(
    verifyCanonicalInput('reviewProtocol', canonicalInputs.reviewProtocol));
  const auditPacket = validateAuditReceipt(receipt, canonicalInputs.audit);
  const candidateSha256 = auditPacket.repairCandidate.rawSha256;
  const candidate = JSON.parse(Buffer.from(canonicalInputs.audit.repairCandidate).toString('utf8'));

  // Bundles come from the audited packet itself; the full source episode is not carried over.
  const auditedBundles = new Map(auditPacket.rows.map(row => [row.auditRowId, row.selectedBundle]));
  const rows = candidate.items.map(item => {
    const selectedBundle = auditedBundles.get(
      auditPacketBuilder.opaqueAuditRowId(candidateSha256, item.itemId));
    if (typeof selectedBundle !== 'string' || !selectedBundle) {
      fail('a reviewed row has no audited visible bundle');
    }
    return { reviewRowId: opaqueReviewRowId(candidateSha256, item.itemId), selectedBundle };
  }).sort((left, right) => (left.reviewRowId < right.reviewRowId ? -1 : 1));
  if (new Set(rows.map(row => row.reviewRowId)).size !== rows.length) {
    fail('opaque review IDs collided');
  }

  return {
    name: PACKET_IDENTITY,
    status: PACKET_STATUS,
    reviewProtocol: {
      identity: protocol.name,
      protocolIdentity: protocol.protocolIdentity,
      rawSha256: CANONICAL_INPUTS.reviewProtocol.rawSha256,
    },
    semanticAuthority: { ...protocol.semanticContract.semanticAuthority },
    reviewedRepairCandidate: { identity: candidate.name, rawSha256: candidateSha256 },
    rendererIdentity: RENDERER_IDENTITY,
    sourceAuditPrerequisite: {
      attemptId: receipt.attemptId,
      receiptRawSha256: CANONICAL_INPUTS.auditReceipt.rawSha256,
      status: receipt.status,
      allRowsPassed: true,
    },
    rows,
  };
}

function loadCanonicalInputs() {
  return {
    ...Object.fromEntries(Object.entries(CANONICAL_INPUTS)
      .map(([key, pinned]) => [key, fs.readFileSync(path.join(ROOT, 'fixtures', pinned.fixture))])),
    audit: auditPacketBuilder.loadCanonicalInputs(),
  };
}

// ---- HUMAN result (attempt-001) ----------------------------------------------------------
// The raw result stays outside the repository; its bytes are pinned so the committed receipt
// cannot re-point at a different result.

const HUMAN_ATTEMPT_ID = 'p1b6-batch-003-repair-human-review-attempt-001';
const HUMAN_RECEIPT_IDENTITY =
  'xion-local-memory-inference-p1b6-batch-003-repair-human-review-attempt-001-receipt-v1';
const HUMAN_RECEIPT_FIXTURE =
  'local-memory-inference-p1b6-batch-003-repair-human-review-attempt-001.json';
const HUMAN_RAW_RESULT_FILENAME = 'p1b6-b003-repair-human-review-results.json';
const HUMAN_RAW_RESULT_SHA256 = 'cc37eef9a77e73a489eaa58acb05f82315d225b2a0470491ccd584942fc6fd82';
const OUTCOMES = Object.freeze(['KEEP:CLEAR', 'KEEP:ESCALATE', 'FIX:null', 'REJECT:null']);

// Validates the SHAPE of result rows against the packet, never their answers.
function validateResultRows(rows, packet) {
  const expected = packet.rows.map(row => row.reviewRowId);
  if (!Array.isArray(rows) || rows.length !== expected.length
    || JSON.stringify(rows.map(row => row?.reviewRowId).toSorted())
      !== JSON.stringify(expected)) {
    fail('HUMAN result rows are missing, extra, duplicated, or unknown');
  }
  for (const row of rows) {
    if (!exactKeys(row, ['reviewRowId', 'disposition', 'decision', 'reason'])
      || !OUTCOMES.includes(`${row.disposition}:${row.decision}`)
      || typeof row.reason !== 'string' || row.reason.trim() === '') {
      fail(`HUMAN result row is invalid: ${row.reviewRowId}`);
    }
  }
  return rows;
}

function validateHumanRawResult(rawBytes, packet) {
  if (!Buffer.isBuffer(rawBytes) && !ArrayBuffer.isView(rawBytes)) {
    fail('HUMAN raw result bytes were not supplied');
  }
  if (sha256RawBytes(rawBytes) !== HUMAN_RAW_RESULT_SHA256) {
    fail('HUMAN raw result bytes are not the recorded evidence');
  }
  const result = JSON.parse(Buffer.from(rawBytes).toString('utf8'));
  if (!exactKeys(result, ['results'])) fail('HUMAN raw result container is invalid');
  return validateResultRows(result.results, packet);
}

// Hidden roles are restored from canonical artifacts after validation, never from the result.
function compareWithV3Reference(rows, canonicalInputs) {
  const candidate = JSON.parse(Buffer.from(canonicalInputs.audit.repairCandidate).toString('utf8'));
  const v3 = JSON.parse(Buffer.from(canonicalInputs.audit.semanticAuthority).toString('utf8'));
  const candidateSha256 = auditPacketBuilder.CANONICAL_INPUTS.repairCandidate.rawSha256;
  const reference = new Map(candidate.items.map(item => [
    opaqueReviewRowId(candidateSha256, item.itemId),
    v3.candidates.find(row => row.semanticSkeletonId === item.semanticSkeletonId).humanLabel,
  ]));
  const kept = rows.filter(row => row.disposition === 'KEEP');
  const matching = kept.filter(row => row.decision === reference.get(row.reviewRowId)).length;
  return { matching, opposing: kept.length - matching };
}

function validateHumanReviewReceipt(receipt, rawResultBytes,
  canonicalInputs = loadCanonicalInputs()) {
  const packet = buildRepairHumanReviewPacket(canonicalInputs);
  const packetSha256 = sha256RawBytes(packetBytes(packet));

  if (!exactKeys(receipt, [
    'name', 'attemptId', 'status', 'reviewDate', 'humanReviewPacket', 'reviewProtocol',
    'semanticAuthority', 'reviewedRepairCandidate', 'sourceAuditPrerequisite',
    'rawResultArtifact', 'reviewProvenance', 'reviewIndependence', 'summary',
    'v3ReferenceComparison', 'authority', 'rows',
  ]) || receipt.name !== HUMAN_RECEIPT_IDENTITY
    || receipt.attemptId !== HUMAN_ATTEMPT_ID
    || JSON.stringify(receipt.humanReviewPacket)
      !== JSON.stringify({ identity: PACKET_IDENTITY, rawSha256: packetSha256 })
    || JSON.stringify(receipt.reviewProtocol) !== JSON.stringify(packet.reviewProtocol)
    || JSON.stringify(receipt.semanticAuthority) !== JSON.stringify(packet.semanticAuthority)
    || JSON.stringify(receipt.reviewedRepairCandidate)
      !== JSON.stringify(packet.reviewedRepairCandidate)
    || JSON.stringify(receipt.sourceAuditPrerequisite)
      !== JSON.stringify(packet.sourceAuditPrerequisite)
    || JSON.stringify(receipt.rawResultArtifact) !== JSON.stringify(
      { filename: HUMAN_RAW_RESULT_FILENAME, sha256: HUMAN_RAW_RESULT_SHA256 })) {
    fail('HUMAN review receipt binding is invalid');
  }

  // Row blindness is not independence: the reviewer took part in resolving these repairs.
  const independence = receipt.reviewIndependence;
  if (!exactKeys(independence, [
    'packetBlindToRowIdentity', 'packetCarriedNoLabelRationaleOrAuditReason',
    'reviewerParticipatedInRepairResolution',
    'reviewerKnewEveryPresentedRowWasARepairedRealization', 'limitation',
  ]) || independence.packetBlindToRowIdentity !== true
    || independence.packetCarriedNoLabelRationaleOrAuditReason !== true
    || independence.reviewerParticipatedInRepairResolution !== true
    || independence.reviewerKnewEveryPresentedRowWasARepairedRealization !== true
    || typeof independence.limitation !== 'string'
    || !independence.limitation.includes('does NOT establish')) {
    fail('HUMAN review receipt does not record its independence limitation');
  }

  if (!exactKeys(receipt.authority, [
    'reviewCompletedForAllPresentedRows', 'decisionsSource',
    'modelInferenceUsedForHumanDecisions', 'surfaceAccepted', 'datasetAcceptancePerformed',
    'referenceLabelFrozen', 'heldOutReleasePerformed', 'trainingOccurred',
  ]) || receipt.authority.reviewCompletedForAllPresentedRows !== true
    || receipt.authority.decisionsSource !== 'REPOSITORY_OWNER_PRIMARY_HUMAN_REVIEWER'
    || ['modelInferenceUsedForHumanDecisions', 'surfaceAccepted', 'datasetAcceptancePerformed',
      'referenceLabelFrozen', 'heldOutReleasePerformed', 'trainingOccurred']
      .some(key => receipt.authority[key] !== false)) {
    fail('HUMAN review receipt claims authority it does not have');
  }

  const rows = validateResultRows(receipt.rows, packet);
  if (JSON.stringify(rows.map(row => row.reviewRowId))
    !== JSON.stringify(packet.rows.map(row => row.reviewRowId))) {
    fail('HUMAN review receipt rows are not in packet order');
  }
  // With the raw bytes present, the receipt rows must be exactly the recorded result.
  if (rawResultBytes !== undefined) {
    const raw = validateHumanRawResult(rawResultBytes, packet)
      .toSorted((left, right) => (left.reviewRowId < right.reviewRowId ? -1 : 1));
    if (JSON.stringify(raw) !== JSON.stringify(rows)) {
      fail('HUMAN review receipt rows differ from the raw result');
    }
  }

  const count = (field, value) => rows.filter(row => row[field] === value).length;
  const summary = {
    total: rows.length,
    KEEP: count('disposition', 'KEEP'),
    FIX: count('disposition', 'FIX'),
    REJECT: count('disposition', 'REJECT'),
    CLEAR: count('decision', 'CLEAR'),
    ESCALATE: count('decision', 'ESCALATE'),
  };
  if (JSON.stringify(receipt.summary) !== JSON.stringify(summary)
    || receipt.status !== (summary.KEEP === rows.length ? 'COMPLETE_ALL_KEEP' : 'COMPLETE_NEEDS_FIX')) {
    fail('HUMAN review summary or status does not follow from its rows');
  }
  const comparison = compareWithV3Reference(rows, canonicalInputs);
  if (!exactKeys(receipt.v3ReferenceComparison, ['matching', 'opposing', 'note'])
    || receipt.v3ReferenceComparison.matching !== comparison.matching
    || receipt.v3ReferenceComparison.opposing !== comparison.opposing) {
    fail('HUMAN review v3 comparison does not follow from its rows');
  }
  return { receipt, packet, packetSha256 };
}

function loadHumanReviewReceipt() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', HUMAN_RECEIPT_FIXTURE), 'utf8'));
}

function writeRepairHumanReviewPacket(outputPath) {
  if (fs.existsSync(outputPath)) {
    throw new Error(`Existing output will not be overwritten: ${outputPath}`);
  }
  const packet = buildRepairHumanReviewPacket(loadCanonicalInputs());
  const bytes = packetBytes(packet);
  fs.writeFileSync(outputPath, bytes, { flag: 'wx' });
  return { rawSha256: sha256RawBytes(bytes), rowCount: packet.rows.length };
}

function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2 || argv[0] !== '--output' || !argv[1]) {
    throw new Error('Usage: --output <batch-003-repair-human-review-packet.json>');
  }
  const { rawSha256, rowCount } = writeRepairHumanReviewPacket(argv[1]);
  process.stdout.write(`Built P1-B6 batch-003 repair blind HUMAN review packet: ${argv[1]}\n`);
  process.stdout.write(`Packet raw SHA-256: ${rawSha256}\n`);
  process.stdout.write(`Rows: ${rowCount}\n`);
  return 0;
}

module.exports = {
  CANONICAL_INPUTS,
  HUMAN_RAW_RESULT_SHA256,
  HUMAN_RECEIPT_FIXTURE,
  PACKET_IDENTITY,
  PACKET_STATUS,
  REVIEW_ID_NAMESPACE,
  buildRepairHumanReviewPacket,
  loadCanonicalInputs,
  loadHumanReviewReceipt,
  main,
  opaqueReviewRowId,
  packetBytes,
  validateAuditReceipt,
  validateHumanRawResult,
  validateHumanReviewReceipt,
  validateProtocol,
  writeRepairHumanReviewPacket,
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`P1-B6 batch-003 repair HUMAN review packet build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
