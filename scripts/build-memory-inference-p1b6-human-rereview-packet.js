#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const {
  EXACT56_SHA256,
  RENDERER_IDENTITY,
  renderHumanReviewText,
  validateSurfaceBatch,
} = require('../lib/memory-inference-p1b6-surfaces');
const sourceAudit = require('./build-memory-inference-p1b6-source-audit-packet');
const primaryReview = require('./build-memory-inference-p1b6-human-review-packet');

const PACKET_IDENTITY = 'xion-local-memory-inference-p1b6-primary-human-rereview-packet-v1';
const CURRENT_BATCH_SHA256 = '2a4605f5550118754c315e26700aef1be96a3129a3ef0065fd2accdad5352a36';
const AUDIT_ATTEMPT_ID = 'p1b6-source-audit-batch-001-attempt-004';
const AUDIT_RECEIPT_IDENTITY = 'xion-local-memory-inference-p1b6-source-audit-batch-001-attempt-004-receipt-v1';
const AUDIT_RESULT_SHA256 = '21ecee72861a7c58d2b09d2777901475c6f60d1bae90c836ef5356d5203ea103';
const ORIGINAL_ATTEMPT_ID = 'p1b6-primary-human-review-batch-001-attempt-001';
const ORIGINAL_RECEIPT_IDENTITY = 'xion-local-memory-inference-p1b6-primary-human-review-batch-001-attempt-001-receipt-v1';
const ORIGINAL_BATCH_SHA256 = '8663f2e2a376ae96f7ab5263168ea36d8a35a5861014473acf51c48b10dd19aa';
const ORIGINAL_PACKET_SHA256 = '5a57a22f595697dccbf70bf42b91f609a78676f0a21af78363ce05e611e00cb5';
const EXPECTED_CHANGED_COUNT = 3;
const REREVIEW_ATTEMPT_ID = 'p1b6-primary-human-rereview-batch-001-attempt-002';
const REREVIEW_RECEIPT_IDENTITY = 'xion-local-memory-inference-p1b6-primary-human-rereview-batch-001-attempt-002-receipt-v1';
const REREVIEW_PACKET_SHA256 = '1924fea91c0667aa4ec0e7c47629836df988476bb0dfcaaa9dc3ed775e3a4fbc';
const EFFECTIVE_DECISIONS_IDENTITY = 'xion-local-memory-inference-p1b6-primary-human-effective-current-batch-001-v1';
const EFFECTIVE_DECISIONS_SHA256 = '44832509f04ffb81a0772e9fda9adcbbea43305315a5d05948819b2c845b162a';
const SMOKE_ACCEPTANCE_IDENTITY = 'xion-local-memory-inference-p1b6-smoke-batch-001-acceptance-v1';
const SKELETON_MISMATCH_REASON = 'SKELETON_REALIZATION_MISMATCH';
const EXPECTED_EFFECTIVE_SUMMARY = Object.freeze({
  total: 32, KEEP: 32, FIX: 0, REJECT: 0, CLEAR: 20, ESCALATE: 12,
});
const AUTHORITATIVE_REREVIEW_DECISIONS = new Map([
  ['p1b6-rereview-2a59d0efa5fa4a5c', ['KEEP', 'CLEAR']],
  ['p1b6-rereview-3103bdf5fda47336', ['KEEP', 'ESCALATE']],
  ['p1b6-rereview-5b1aab95130e93ee', ['KEEP', 'CLEAR']],
]);
const BATCH002_REREVIEW = Object.freeze({
  currentBatchSha256: 'ed68a562a67deee4d8e92d3e4841362d9589f876480d174a043d822cbf61e80c',
  auditAttemptId: 'p1b6-source-audit-batch-002-attempt-002',
  originalAttemptId: 'p1b6-primary-human-review-batch-002-attempt-001',
  originalReceiptIdentity:
    'xion-local-memory-inference-p1b6-primary-human-review-batch-002-attempt-001-receipt-v1',
  originalBatchSha256: '552a11e4c976c514f27ee36afe0fa5546dcc921a465b24180c831771f9d02334',
  originalPacketSha256: 'e949dceb77e68dde278ef448eb17380645064573e187eb1cba7b24c673069fa5',
  changedCount: 4,
  rereviewAttemptId: 'p1b6-primary-human-rereview-batch-002-attempt-002',
  rereviewReceiptIdentity:
    'xion-local-memory-inference-p1b6-primary-human-rereview-batch-002-attempt-002-receipt-v1',
  rereviewPacketSha256: 'f582776c81a51fb08f2e5cfe697b51be939aeb6533659e6038d80d391fffd2c9',
});
const BATCH002_REREVIEW_DECISIONS = new Map([
  ['p1b6-rereview-02acbfe8ee8d6bcc', ['KEEP', 'CLEAR']],
  ['p1b6-rereview-27a2b7b3013ce07d', ['KEEP', 'CLEAR']],
  ['p1b6-rereview-4dc89a20b64524ef', ['KEEP', 'CLEAR']],
  ['p1b6-rereview-b8bc096f17086620', ['KEEP', 'CLEAR']],
]);
const BATCH002_REREVIEW_SUMMARY = Object.freeze({
  total: 4, KEEP: 4, FIX: 0, REJECT: 0, CLEAR: 4, ESCALATE: 0,
});
const BATCH002_EFFECTIVE_IDENTITY =
  'xion-local-memory-inference-p1b6-primary-human-effective-current-batch-002-v1';
const BATCH002_MISMATCH_IDENTITY =
  'xion-local-memory-inference-p1b6-primary-human-reconciliation-mismatches-batch-002-v1';
const BATCH002_EFFECTIVE_SUMMARY = Object.freeze({
  total: 64, KEEP: 64, FIX: 0, REJECT: 0, CLEAR: 55, ESCALATE: 9,
});
const BATCH002_ADJUDICATION_IDENTITY =
  'xion-local-memory-inference-p1b6-pragmatic-adjudication-batch-002-v1';
const BATCH002_ADJUDICATION_EXPECTED = Object.freeze({ items: 24, skeletonGroups: 10 });
const BATCH002_EFFECTIVE_SHA256 =
  'd0e5dcc2da7d1f87b4886d6e5b6726c1053c88fdc4cdf8fbd144a47c3cddf38f';
const BATCH002_MISMATCH_SHA256 =
  '9a02ecfec486a6b5f5d1f586b2a2482dafc94a8b2f642e71e23f3653020129f5';
const BATCH002_ADJUDICATION_SHA256 =
  'dd8697b890f41a3541c38b7101bd93ee697889bdaa9ceafea114d2d7feef4967';
// The canonical 10 unique mismatch skeletons, lexically sorted. The diagnostic is
// source-of-truth for WHICH 24 reconciliation mismatches are adjudicated, so a caller
// cannot mutate effective rows and substitute a different 24-item set of the same size.
const BATCH002_MISMATCH_SKELETONS = Object.freeze([
  'p1b6-sk-155420007d75f36f',
  'p1b6-sk-2fa39ece4157b2b8',
  'p1b6-sk-5269c91fcfb6c2cd',
  'p1b6-sk-5f335bdc1d9d630c',
  'p1b6-sk-5fc872afb058b370',
  'p1b6-sk-8dd28ec6b22a18ad',
  'p1b6-sk-aebbf047d6864a35',
  'p1b6-sk-be0efa305956d111',
  'p1b6-sk-cc054a4227cdafef',
  'p1b6-sk-e7fe317a78077d37',
]);
const BATCH002_ADJUDICATION_RECEIPT_IDENTITY =
  'xion-local-memory-inference-p1b6-pragmatic-adjudication-batch-002-receipt-v1';
const BATCH002_ADJUDICATION_RECEIPT_SHA256 =
  'cf05f5073fc30f19078aab1a0c081b59face607a041387bf5421ffa2af8bbdaa';
const BATCH002_ADJUDICATION_SUMMARY = Object.freeze({
  total: 24,
  SKELETON_SEMANTICS_NEEDS_REVISION: 10,
  SURFACE_COLLAPSES_AMBIGUITY: 11,
  HUMAN_DECISION_NEEDS_REREVIEW: 3,
  UNRESOLVED: 0,
});
const BATCH002_REREVIEW_003 = Object.freeze({
  attemptId: 'p1b6-primary-human-rereview-batch-002-attempt-003',
  selectionOutcome: 'HUMAN_DECISION_NEEDS_REREVIEW',
  expectedRows: 3,
  // HUMAN review packets are generated, never committed; only their receipts are.
  packetSha256: '165d8d02ca6f5d36a22f4a8baa4d5ee7d19b059b6e2a944cbc5e1a19554973c2',
  receiptIdentity:
    'xion-local-memory-inference-p1b6-primary-human-rereview-batch-002-attempt-003-receipt-v1',
});
// Authoritative blind HUMAN decisions, keyed only by the opaque IDs shown during review.
const BATCH002_ATTEMPT003_DECISIONS = new Map([
  ['p1b6-rereview-2c251b9d9e952944', ['KEEP', 'ESCALATE']],
  ['p1b6-rereview-a0c1900947d7341b', ['KEEP', 'ESCALATE']],
  ['p1b6-rereview-f53ff2ec780365d2', ['KEEP', 'ESCALATE']],
]);
const BATCH002_ATTEMPT003_SUMMARY = Object.freeze({
  total: 3, KEEP: 3, FIX: 0, REJECT: 0, CLEAR: 0, ESCALATE: 3,
});
const BATCH002_EFFECTIVE_003_IDENTITY =
  'xion-local-memory-inference-p1b6-primary-human-effective-current-batch-002-v2';
const BATCH002_EFFECTIVE_003_SUMMARY = Object.freeze({
  total: 64, KEEP: 64, FIX: 0, REJECT: 0, CLEAR: 52, ESCALATE: 12,
});
const INTERPRETATION_RULE = 'CONSERVATIVE_PRAGMATIC_INTERPRETATION';
const ADJUDICATION_TAXONOMY = Object.freeze([
  'SKELETON_SEMANTICS_NEEDS_REVISION',
  'SURFACE_COLLAPSES_AMBIGUITY',
  'HUMAN_DECISION_NEEDS_REREVIEW',
  'UNRESOLVED',
]);

function fail(message) {
  throw new TypeError(`P1-B6 primary HUMAN re-review packet ${message}`);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function packetBytes(packet) {
  return Buffer.from(`${JSON.stringify(packet, null, 2)}\n`, 'utf8');
}

function opaqueRereviewRowId(batchSha256, itemId) {
  return `p1b6-rereview-${crypto.createHash('sha256')
    .update(`${PACKET_IDENTITY}\0${batchSha256}\0${itemId}`).digest('hex').slice(0, 16)}`;
}

function parseArgs(argv) {
  const allowed = ['--input', '--audit-receipt', '--original-packet', '--original-receipt', '--output'];
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.includes(flag) || !value || Object.hasOwn(values, flag)) {
      throw new Error(`Usage: ${allowed.map(flagName => `${flagName} <file>`).join(' ')}`);
    }
    values[flag] = value;
  }
  if (allowed.some(flag => !values[flag])) {
    throw new Error(`Usage: ${allowed.map(flagName => `${flagName} <file>`).join(' ')}`);
  }
  return {
    inputPath: values['--input'],
    auditReceiptPath: values['--audit-receipt'],
    originalPacketPath: values['--original-packet'],
    originalReceiptPath: values['--original-receipt'],
    outputPath: values['--output'],
  };
}

function validateAuditReceipt(rawBatchBytes, receipt) {
  const batchSha256 = sha256RawBytes(rawBatchBytes);
  if (batchSha256 !== CURRENT_BATCH_SHA256) fail('current batch hash is invalid');
  const batch = validateSurfaceBatch(JSON.parse(Buffer.from(rawBatchBytes).toString('utf8')));
  const protocol = sourceAudit.loadProtocol();
  const auditPacket = sourceAudit.buildAuditPacket(rawBatchBytes);
  const auditPacketSha256 = sha256RawBytes(packetBytes(auditPacket));

  if (!exactKeys(receipt, [
    'name', 'attemptId', 'status', 'auditPacketIdentity', 'auditPacketSha256',
    'sourceAuditProtocol', 'auditedSourceBatch', 'rawResultArtifact',
    'auditorExecutionProvenance', 'summary', 'authority', 'rows',
  ]) || receipt.name !== AUDIT_RECEIPT_IDENTITY || receipt.attemptId !== AUDIT_ATTEMPT_ID
    || receipt.status !== 'COMPLETE_PASS'
    || receipt.auditPacketIdentity !== sourceAudit.PACKET_IDENTITY
    || receipt.auditPacketSha256 !== auditPacketSha256
    || !exactKeys(receipt.sourceAuditProtocol, ['identity', 'sha256'])
    || receipt.sourceAuditProtocol.identity !== sourceAudit.PROTOCOL_IDENTITY
    || receipt.sourceAuditProtocol.sha256 !== protocol.sha256
    || !exactKeys(receipt.auditedSourceBatch, ['identity', 'batchId', 'rawSha256'])
    || receipt.auditedSourceBatch.identity !== batch.name
    || receipt.auditedSourceBatch.batchId !== batch.batchId
    || receipt.auditedSourceBatch.rawSha256 !== batchSha256
    || !exactKeys(receipt.rawResultArtifact, ['filename', 'sha256'])
    || receipt.rawResultArtifact.filename !== 'p1b6-source-audit-batch-001-attempt-004-results.json'
    || receipt.rawResultArtifact.sha256 !== AUDIT_RESULT_SHA256
    || !exactKeys(receipt.auditorExecutionProvenance, [
      'evidenceBasis', 'provider', 'surface', 'model', 'reasoningSetting', 'sessionRelationship',
    ])
    || receipt.auditorExecutionProvenance.evidenceBasis
      !== 'USER_REPORTED_NOT_INDEPENDENTLY_RECOVERED_FROM_API_OR_RUNTIME_METADATA'
    || receipt.auditorExecutionProvenance.provider !== 'OpenAI'
    || receipt.auditorExecutionProvenance.surface !== 'ChatGPT'
    || receipt.auditorExecutionProvenance.model !== 'GPT-5.6 Sol'
    || receipt.auditorExecutionProvenance.reasoningSetting !== 'High'
    || receipt.auditorExecutionProvenance.sessionRelationship
      !== 'fresh/separate session used only for the blind source/bundle audit'
    || !exactKeys(receipt.summary, ['total', 'PASS', 'FAIL', 'UNCERTAIN'])
    || receipt.summary.total !== batch.items.length || receipt.summary.PASS !== batch.items.length
    || receipt.summary.FAIL !== 0 || receipt.summary.UNCERTAIN !== 0
    || !exactKeys(receipt.authority, [
      'sourceBundleGatePassed', 'humanSemanticReviewOccurred',
      'surfaceHumanGoldAssigned', 'trainingOccurred',
    ]) || receipt.authority.sourceBundleGatePassed !== true
    || receipt.authority.humanSemanticReviewOccurred !== false
    || receipt.authority.surfaceHumanGoldAssigned !== false
    || receipt.authority.trainingOccurred !== false
    || !Array.isArray(receipt.rows) || receipt.rows.length !== batch.items.length) {
    fail('attempt-004 receipt binding is invalid');
  }

  const expectedIds = new Set(auditPacket.rows.map(row => row.auditRowId));
  const seenIds = new Set();
  for (const row of receipt.rows) {
    if (!exactKeys(row, ['auditRowId', 'disposition', 'reason'])
      || row.disposition !== 'PASS' || typeof row.reason !== 'string' || !row.reason.trim()
      || !expectedIds.has(row.auditRowId) || seenIds.has(row.auditRowId)) {
      fail('attempt-004 rows are stale, duplicate, incomplete, or non-PASS');
    }
    seenIds.add(row.auditRowId);
  }
  if (seenIds.size !== expectedIds.size) fail('attempt-004 receipt is missing an audit row');
  return { batch, batchSha256 };
}

function validateOriginalPacket(rawPacketBytes, receipt, batch) {
  if (sha256RawBytes(rawPacketBytes) !== ORIGINAL_PACKET_SHA256) {
    fail('original primary HUMAN packet hash is invalid');
  }
  const packet = JSON.parse(Buffer.from(rawPacketBytes).toString('utf8'));
  if (!exactKeys(packet, ['name', 'sourceBatch', 'rendererIdentity', 'sourceAuditAttempt', 'rows'])
    || packet.name !== primaryReview.PACKET_IDENTITY
    || !exactKeys(packet.sourceBatch, ['identity', 'sha256'])
    || packet.sourceBatch.identity !== batch.name
    || packet.sourceBatch.sha256 !== ORIGINAL_BATCH_SHA256
    || packet.rendererIdentity !== RENDERER_IDENTITY
    || packet.sourceAuditAttempt !== 'p1b6-source-audit-batch-001-attempt-002'
    || !Array.isArray(packet.rows) || packet.rows.length !== batch.items.length
    || !exactKeys(receipt, [
      'name', 'attemptId', 'status', 'primaryHumanReviewPacket', 'reviewedSourceBatch',
      'rendererIdentity', 'sourceAuditPrerequisite', 'summary', 'authority', 'rows',
    ]) || receipt.name !== ORIGINAL_RECEIPT_IDENTITY
    || receipt.attemptId !== ORIGINAL_ATTEMPT_ID || receipt.status !== 'COMPLETE_NEEDS_FIX'
    || !exactKeys(receipt.primaryHumanReviewPacket, ['identity', 'rawSha256'])
    || receipt.primaryHumanReviewPacket.identity !== primaryReview.PACKET_IDENTITY
    || receipt.primaryHumanReviewPacket.rawSha256 !== ORIGINAL_PACKET_SHA256
    || !exactKeys(receipt.reviewedSourceBatch, ['identity', 'rawSha256'])
    || receipt.reviewedSourceBatch.identity !== batch.name
    || receipt.reviewedSourceBatch.rawSha256 !== ORIGINAL_BATCH_SHA256
    || receipt.rendererIdentity !== RENDERER_IDENTITY
    || !exactKeys(receipt.sourceAuditPrerequisite, ['attemptId', 'status', 'allRowsPassed'])
    || receipt.sourceAuditPrerequisite.attemptId !== 'p1b6-source-audit-batch-001-attempt-002'
    || receipt.sourceAuditPrerequisite.status !== 'COMPLETE_PASS'
    || receipt.sourceAuditPrerequisite.allRowsPassed !== true
    || !Array.isArray(receipt.rows) || receipt.rows.length !== batch.items.length) {
    fail('original primary HUMAN binding is invalid');
  }

  const packetRows = new Map();
  for (const row of packet.rows) {
    if (!exactKeys(row, ['reviewRowId', 'selectedBundle'])
      || typeof row.reviewRowId !== 'string' || typeof row.selectedBundle !== 'string'
      || !row.selectedBundle || packetRows.has(row.reviewRowId)) {
      fail('original primary HUMAN packet rows are invalid or duplicate');
    }
    packetRows.set(row.reviewRowId, row);
  }
  const receiptIds = new Set();
  for (const row of receipt.rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || typeof row.reviewRowId !== 'string' || receiptIds.has(row.reviewRowId)
      || !packetRows.has(row.reviewRowId)) fail('original primary HUMAN receipt rows are invalid');
    receiptIds.add(row.reviewRowId);
  }
  if (receiptIds.size !== packetRows.size) fail('original primary HUMAN receipt rows are incomplete');
  return packetRows;
}

function buildRereviewPacket(rawBatchBytes, auditReceipt, rawOriginalPacketBytes, originalReceipt) {
  const { batch, batchSha256 } = validateAuditReceipt(rawBatchBytes, auditReceipt);
  const originalRows = validateOriginalPacket(rawOriginalPacketBytes, originalReceipt, batch);
  const changed = [];
  for (const item of batch.items) {
    const originalId = primaryReview.opaqueReviewRowId(ORIGINAL_BATCH_SHA256, item.itemId);
    const originalRow = originalRows.get(originalId);
    if (!originalRow) fail('a current item has no original primary HUMAN row');
    const selectedBundle = renderHumanReviewText(batch, item);
    if (selectedBundle !== originalRow.selectedBundle) changed.push({ item, selectedBundle });
  }
  if (changed.length !== EXPECTED_CHANGED_COUNT) fail('changed visible-bundle count is not exactly three');

  const rows = changed.map(({ item, selectedBundle }) => ({
    reviewRowId: opaqueRereviewRowId(batchSha256, item.itemId),
    selectedBundle,
  })).sort((left, right) => left.reviewRowId < right.reviewRowId ? -1 : 1);
  if (new Set(rows.map(row => row.reviewRowId)).size !== EXPECTED_CHANGED_COUNT) {
    fail('fresh re-review row IDs are not unique');
  }
  return {
    name: PACKET_IDENTITY,
    sourceBatch: { identity: batch.name, sha256: batchSha256 },
    rendererIdentity: RENDERER_IDENTITY,
    sourceAuditAttempt: AUDIT_ATTEMPT_ID,
    originalPrimaryHumanAttempt: ORIGINAL_ATTEMPT_ID,
    originalPrimaryHumanPacketSha256: ORIGINAL_PACKET_SHA256,
    rows,
  };
}

function buildBatch002RereviewPacket(rawBatchBytes, auditReceipt,
  rawOriginalPacketBytes, originalReceipt) {
  const { batch, batchSha256, attemptId } = primaryReview.validateAuditReceipt(
    auditReceipt, rawBatchBytes,
  );
  if (batchSha256 !== BATCH002_REREVIEW.currentBatchSha256
    || attemptId !== BATCH002_REREVIEW.auditAttemptId
    || sha256RawBytes(rawOriginalPacketBytes) !== BATCH002_REREVIEW.originalPacketSha256) {
    fail('batch-002 current or historical binding is invalid');
  }

  const originalPacket = JSON.parse(Buffer.from(rawOriginalPacketBytes).toString('utf8'));
  if (!exactKeys(originalPacket, [
    'name', 'sourceBatch', 'rendererIdentity', 'sourceAuditAttempt', 'rows',
  ]) || originalPacket.name !== primaryReview.PACKET_IDENTITY
    || !exactKeys(originalPacket.sourceBatch, ['identity', 'sha256'])
    || originalPacket.sourceBatch.identity !== batch.name
    || originalPacket.sourceBatch.sha256 !== BATCH002_REREVIEW.originalBatchSha256
    || originalPacket.rendererIdentity !== RENDERER_IDENTITY
    || originalPacket.sourceAuditAttempt !== 'p1b6-source-audit-batch-002-attempt-001'
    || !Array.isArray(originalPacket.rows) || originalPacket.rows.length !== batch.items.length
    || !exactKeys(originalReceipt, [
      'name', 'attemptId', 'status', 'primaryHumanReviewPacket', 'reviewedSourceBatch',
      'rendererIdentity', 'sourceAuditPrerequisite', 'summary', 'authority', 'rows',
    ]) || originalReceipt.name !== BATCH002_REREVIEW.originalReceiptIdentity
    || originalReceipt.attemptId !== BATCH002_REREVIEW.originalAttemptId
    || originalReceipt.status !== 'COMPLETE_NEEDS_FIX'
    || !exactKeys(originalReceipt.primaryHumanReviewPacket, ['identity', 'rawSha256'])
    || originalReceipt.primaryHumanReviewPacket.identity !== primaryReview.PACKET_IDENTITY
    || originalReceipt.primaryHumanReviewPacket.rawSha256
      !== BATCH002_REREVIEW.originalPacketSha256
    || !exactKeys(originalReceipt.reviewedSourceBatch, ['identity', 'rawSha256'])
    || originalReceipt.reviewedSourceBatch.identity !== batch.name
    || originalReceipt.reviewedSourceBatch.rawSha256
      !== BATCH002_REREVIEW.originalBatchSha256
    || originalReceipt.rendererIdentity !== RENDERER_IDENTITY
    || !exactKeys(originalReceipt.sourceAuditPrerequisite,
      ['attemptId', 'status', 'allRowsPassed'])
    || originalReceipt.sourceAuditPrerequisite.attemptId
      !== 'p1b6-source-audit-batch-002-attempt-001'
    || originalReceipt.sourceAuditPrerequisite.status !== 'COMPLETE_PASS'
    || originalReceipt.sourceAuditPrerequisite.allRowsPassed !== true
    || JSON.stringify(originalReceipt.summary) !== JSON.stringify({
      total: 64, KEEP: 60, FIX: 4, REJECT: 0, CLEAR: 55, ESCALATE: 9,
    })
    || !exactKeys(originalReceipt.authority, [
      'reviewCompletedForAllPresentedRows', 'acceptedKeepCount', 'unresolvedFixCount',
      'humanReviewGateClosed', 'surfaceHumanGoldFrozen', 'decisionsSource',
      'modelInferenceUsedForHumanDecisions', 'trainingOccurred',
    ]) || originalReceipt.authority.reviewCompletedForAllPresentedRows !== true
    || originalReceipt.authority.acceptedKeepCount !== 60
    || originalReceipt.authority.unresolvedFixCount !== BATCH002_REREVIEW.changedCount
    || originalReceipt.authority.humanReviewGateClosed !== false
    || originalReceipt.authority.surfaceHumanGoldFrozen !== false
    || originalReceipt.authority.decisionsSource
      !== 'REPOSITORY_OWNER_PRIMARY_HUMAN_REVIEWER'
    || originalReceipt.authority.modelInferenceUsedForHumanDecisions !== false
    || originalReceipt.authority.trainingOccurred !== false
    || !Array.isArray(originalReceipt.rows)
    || originalReceipt.rows.length !== batch.items.length) {
    fail('batch-002 original primary HUMAN binding is invalid');
  }

  const packetRows = new Map();
  for (const row of originalPacket.rows) {
    if (!exactKeys(row, ['reviewRowId', 'selectedBundle'])
      || typeof row.reviewRowId !== 'string' || typeof row.selectedBundle !== 'string'
      || !row.selectedBundle || packetRows.has(row.reviewRowId)) {
      fail('batch-002 original packet rows are invalid or duplicate');
    }
    packetRows.set(row.reviewRowId, row);
  }
  const decisions = new Map();
  for (const row of originalReceipt.rows) {
    const keys = row.disposition === 'FIX'
      ? ['reviewRowId', 'disposition', 'decision', 'reason']
      : ['reviewRowId', 'disposition', 'decision'];
    if (!exactKeys(row, keys) || !packetRows.has(row.reviewRowId)
      || decisions.has(row.reviewRowId)
      || !['KEEP', 'FIX', 'REJECT'].includes(row.disposition)
      || !['CLEAR', 'ESCALATE'].includes(row.decision)
      || (row.disposition === 'FIX' && (typeof row.reason !== 'string' || !row.reason.trim()))) {
      fail('batch-002 original receipt rows are invalid or duplicate');
    }
    decisions.set(row.reviewRowId, row);
  }
  if (decisions.size !== packetRows.size) fail('batch-002 original review rows are incomplete');

  const changed = [];
  const fixes = [];
  for (const item of batch.items) {
    const originalId = primaryReview.opaqueReviewRowId(
      BATCH002_REREVIEW.originalBatchSha256, item.itemId,
    );
    const originalRow = packetRows.get(originalId);
    const decision = decisions.get(originalId);
    if (!originalRow || !decision) fail('batch-002 item has no original review row');
    const selectedBundle = renderHumanReviewText(batch, item);
    if (selectedBundle !== originalRow.selectedBundle) changed.push({ item, selectedBundle });
    if (decision.disposition === 'FIX') fixes.push(item.itemId);
  }
  if (changed.length !== BATCH002_REREVIEW.changedCount
    || fixes.length !== BATCH002_REREVIEW.changedCount
    || changed.some(({ item }) => !fixes.includes(item.itemId))) {
    fail('batch-002 changed bundle set does not exactly match historical FIX rows');
  }

  const rows = changed.map(({ item, selectedBundle }) => ({
    reviewRowId: opaqueRereviewRowId(batchSha256, item.itemId),
    selectedBundle,
  })).sort((left, right) => left.reviewRowId < right.reviewRowId ? -1 : 1);
  if (new Set(rows.map(row => row.reviewRowId)).size !== BATCH002_REREVIEW.changedCount) {
    fail('batch-002 fresh re-review row IDs are not unique');
  }
  return {
    name: PACKET_IDENTITY,
    sourceBatch: { identity: batch.name, sha256: batchSha256 },
    rendererIdentity: RENDERER_IDENTITY,
    sourceAuditAttempt: attemptId,
    originalPrimaryHumanAttempt: BATCH002_REREVIEW.originalAttemptId,
    originalPrimaryHumanPacketSha256: BATCH002_REREVIEW.originalPacketSha256,
    rows,
  };
}

function validateBatch002RereviewReceipt(rawBatchBytes, auditReceipt, rawOriginalPacketBytes,
  originalReceipt, rawRereviewPacketBytes, receipt) {
  const packet = buildBatch002RereviewPacket(
    rawBatchBytes, auditReceipt, rawOriginalPacketBytes, originalReceipt,
  );
  const rebuiltBytes = packetBytes(packet);
  if (sha256RawBytes(rebuiltBytes) !== BATCH002_REREVIEW.rereviewPacketSha256
    || !Buffer.from(rawRereviewPacketBytes).equals(rebuiltBytes)) {
    fail('batch-002 completed re-review packet bytes are invalid');
  }
  if (!exactKeys(receipt, [
    'name', 'attemptId', 'status', 'primaryHumanRereviewPacket', 'reviewedSourceBatch',
    'rendererIdentity', 'sourceAuditPrerequisite', 'originalPrimaryHumanReview',
    'summary', 'authority', 'rows',
  ]) || receipt.name !== BATCH002_REREVIEW.rereviewReceiptIdentity
    || receipt.attemptId !== BATCH002_REREVIEW.rereviewAttemptId
    || receipt.status !== 'COMPLETE_PASS'
    || !exactKeys(receipt.primaryHumanRereviewPacket, ['identity', 'rawSha256'])
    || receipt.primaryHumanRereviewPacket.identity !== PACKET_IDENTITY
    || receipt.primaryHumanRereviewPacket.rawSha256 !== BATCH002_REREVIEW.rereviewPacketSha256
    || !exactKeys(receipt.reviewedSourceBatch, ['identity', 'rawSha256'])
    || receipt.reviewedSourceBatch.identity !== packet.sourceBatch.identity
    || receipt.reviewedSourceBatch.rawSha256 !== BATCH002_REREVIEW.currentBatchSha256
    || receipt.rendererIdentity !== RENDERER_IDENTITY
    || !exactKeys(receipt.sourceAuditPrerequisite, ['attemptId', 'status', 'allRowsPassed'])
    || receipt.sourceAuditPrerequisite.attemptId !== BATCH002_REREVIEW.auditAttemptId
    || receipt.sourceAuditPrerequisite.status !== 'COMPLETE_PASS'
    || receipt.sourceAuditPrerequisite.allRowsPassed !== true
    || !exactKeys(receipt.originalPrimaryHumanReview, ['attemptId', 'receiptIdentity'])
    || receipt.originalPrimaryHumanReview.attemptId !== BATCH002_REREVIEW.originalAttemptId
    || receipt.originalPrimaryHumanReview.receiptIdentity
      !== BATCH002_REREVIEW.originalReceiptIdentity
    || JSON.stringify(receipt.summary) !== JSON.stringify(BATCH002_REREVIEW_SUMMARY)
    || !exactKeys(receipt.authority, [
      'reviewCompletedForAllPresentedRows', 'acceptedKeepCount', 'unresolvedFixCount',
      'primaryHumanReviewGateClosed', 'surfaceHumanGoldFrozen', 'decisionsSource',
      'modelInferenceUsedForHumanDecisions', 'trainingOccurred',
    ]) || receipt.authority.reviewCompletedForAllPresentedRows !== true
    || receipt.authority.acceptedKeepCount !== BATCH002_REREVIEW.changedCount
    || receipt.authority.unresolvedFixCount !== 0
    || receipt.authority.primaryHumanReviewGateClosed !== false
    || receipt.authority.surfaceHumanGoldFrozen !== false
    || receipt.authority.decisionsSource !== 'REPOSITORY_OWNER_PRIMARY_HUMAN_REVIEWER'
    || receipt.authority.modelInferenceUsedForHumanDecisions !== false
    || receipt.authority.trainingOccurred !== false
    || !Array.isArray(receipt.rows)
    || receipt.rows.length !== BATCH002_REREVIEW.changedCount) {
    fail('batch-002 completed re-review receipt binding is invalid');
  }

  const expectedIds = new Set(packet.rows.map(row => row.reviewRowId));
  const rows = new Map();
  for (const row of receipt.rows) {
    const expectedDecision = BATCH002_REREVIEW_DECISIONS.get(row.reviewRowId);
    if (!exactKeys(row, ['reviewRowId', 'disposition', 'decision'])
      || !expectedIds.has(row.reviewRowId) || rows.has(row.reviewRowId)
      || !expectedDecision || row.disposition !== expectedDecision[0]
      || row.decision !== expectedDecision[1]) {
      fail('batch-002 completed re-review rows are invalid, stale, or duplicate');
    }
    rows.set(row.reviewRowId, row);
  }
  if (rows.size !== expectedIds.size
    || JSON.stringify(summarizeDecisions([...rows.values()]))
      !== JSON.stringify(BATCH002_REREVIEW_SUMMARY)) {
    fail('batch-002 completed re-review rows do not match the authoritative aggregate');
  }
  return { packet, rows };
}

function summarizeDecisions(rows) {
  return rows.reduce((summary, row) => {
    summary[row.disposition] += 1;
    summary[row.decision] += 1;
    return summary;
  }, { total: rows.length, KEEP: 0, FIX: 0, REJECT: 0, CLEAR: 0, ESCALATE: 0 });
}

function validateRereviewReceipt(rawBatchBytes, auditReceipt, rawOriginalPacketBytes,
  originalReceipt, rawRereviewPacketBytes, receipt) {
  const packet = buildRereviewPacket(
    rawBatchBytes, auditReceipt, rawOriginalPacketBytes, originalReceipt,
  );
  const packetBytesValue = packetBytes(packet);
  if (sha256RawBytes(rawRereviewPacketBytes) !== REREVIEW_PACKET_SHA256
    || !Buffer.from(rawRereviewPacketBytes).equals(packetBytesValue)) {
    fail('completed re-review packet bytes are invalid');
  }
  const batch = validateSurfaceBatch(JSON.parse(Buffer.from(rawBatchBytes).toString('utf8')));
  const summary = { total: 3, KEEP: 3, FIX: 0, REJECT: 0, CLEAR: 2, ESCALATE: 1 };
  if (!exactKeys(receipt, [
    'name', 'attemptId', 'status', 'primaryHumanRereviewPacket', 'reviewedSourceBatch',
    'rendererIdentity', 'sourceAuditPrerequisite', 'originalPrimaryHumanReview',
    'summary', 'authority', 'rows',
  ]) || receipt.name !== REREVIEW_RECEIPT_IDENTITY
    || receipt.attemptId !== REREVIEW_ATTEMPT_ID || receipt.status !== 'COMPLETE_PASS'
    || !exactKeys(receipt.primaryHumanRereviewPacket, ['identity', 'rawSha256'])
    || receipt.primaryHumanRereviewPacket.identity !== PACKET_IDENTITY
    || receipt.primaryHumanRereviewPacket.rawSha256 !== REREVIEW_PACKET_SHA256
    || !exactKeys(receipt.reviewedSourceBatch, ['identity', 'rawSha256'])
    || receipt.reviewedSourceBatch.identity !== batch.name
    || receipt.reviewedSourceBatch.rawSha256 !== CURRENT_BATCH_SHA256
    || receipt.rendererIdentity !== RENDERER_IDENTITY
    || !exactKeys(receipt.sourceAuditPrerequisite, ['attemptId', 'status', 'allRowsPassed'])
    || receipt.sourceAuditPrerequisite.attemptId !== AUDIT_ATTEMPT_ID
    || receipt.sourceAuditPrerequisite.status !== 'COMPLETE_PASS'
    || receipt.sourceAuditPrerequisite.allRowsPassed !== true
    || !exactKeys(receipt.originalPrimaryHumanReview, ['attemptId', 'receiptIdentity'])
    || receipt.originalPrimaryHumanReview.attemptId !== ORIGINAL_ATTEMPT_ID
    || receipt.originalPrimaryHumanReview.receiptIdentity !== ORIGINAL_RECEIPT_IDENTITY
    || JSON.stringify(receipt.summary) !== JSON.stringify(summary)
    || !exactKeys(receipt.authority, [
      'reviewCompletedForAllPresentedRows', 'acceptedKeepCount', 'unresolvedFixCount',
      'primaryHumanReviewGateClosed', 'surfaceHumanGoldFrozen', 'decisionsSource',
      'modelInferenceUsedForHumanDecisions', 'trainingOccurred',
    ]) || receipt.authority.reviewCompletedForAllPresentedRows !== true
    || receipt.authority.acceptedKeepCount !== 3 || receipt.authority.unresolvedFixCount !== 0
    || receipt.authority.primaryHumanReviewGateClosed !== false
    || receipt.authority.surfaceHumanGoldFrozen !== false
    || receipt.authority.decisionsSource !== 'REPOSITORY_OWNER_PRIMARY_HUMAN_REVIEWER'
    || receipt.authority.modelInferenceUsedForHumanDecisions !== false
    || receipt.authority.trainingOccurred !== false
    || !Array.isArray(receipt.rows) || receipt.rows.length !== EXPECTED_CHANGED_COUNT) {
    fail('completed re-review receipt binding is invalid');
  }

  const expectedIds = new Set(packet.rows.map(row => row.reviewRowId));
  const rows = new Map();
  for (const row of receipt.rows) {
    const expectedDecision = AUTHORITATIVE_REREVIEW_DECISIONS.get(row.reviewRowId);
    if (!exactKeys(row, ['reviewRowId', 'disposition', 'decision'])
      || !expectedIds.has(row.reviewRowId) || rows.has(row.reviewRowId)
      || !expectedDecision || row.disposition !== expectedDecision[0]
      || row.decision !== expectedDecision[1]) {
      fail('completed re-review rows are invalid, stale, or duplicate');
    }
    rows.set(row.reviewRowId, row);
  }
  if (rows.size !== expectedIds.size
    || JSON.stringify(summarizeDecisions([...rows.values()])) !== JSON.stringify(summary)) {
    fail('completed re-review rows do not match the authoritative aggregate');
  }
  return { batch, packet, rows };
}

function reconcileEffectiveHumanDecisions(batch, effectiveRows, exact56) {
  const rows = new Map(effectiveRows.map(row => [row.itemId, row]));
  if (rows.size !== batch.items.length || effectiveRows.length !== batch.items.length) {
    fail('effective current HUMAN rows are incomplete or duplicate');
  }
  if (!exact56 || !Array.isArray(exact56.candidates)) fail('frozen exact56 binding is invalid');
  const skeletons = new Map(exact56.candidates.map(row => [row.semanticSkeletonId, row]));
  if (skeletons.size !== exact56.candidates.length) fail('frozen exact56 binding is invalid');
  let matchCount = 0;
  for (const item of batch.items) {
    const row = rows.get(item.itemId);
    const skeleton = skeletons.get(item.semanticSkeletonId);
    if (!exactKeys(row, ['itemId', 'disposition', 'decision']) || row.itemId !== item.itemId
      || row.disposition !== 'KEEP' || !['CLEAR', 'ESCALATE'].includes(row.decision)
      || !skeleton || !['CLEAR', 'ESCALATE'].includes(skeleton.humanLabel)) {
      fail('effective current HUMAN row or frozen skeleton binding is invalid');
    }
    if (row.decision === skeleton.humanLabel) matchCount += 1;
  }
  const mismatchCount = batch.items.length - matchCount;
  return { matchCount, mismatchCount, humanReviewCompleted: mismatchCount === 0 };
}

function classifySmokeAcceptance(batch, effectiveRows, exact56) {
  const reconciliation = reconcileEffectiveHumanDecisions(batch, effectiveRows, exact56);
  if (reconciliation.matchCount !== 30 || reconciliation.mismatchCount !== 2) {
    fail('smoke acceptance requires exactly 30 matches and two mismatches');
  }
  const rows = new Map(effectiveRows.map(row => [row.itemId, row]));
  const skeletons = new Map(exact56.candidates.map(row => [row.semanticSkeletonId, row]));
  const accepted = [];
  const rejected = [];
  for (const item of batch.items) {
    const row = rows.get(item.itemId);
    if (row.decision === skeletons.get(item.semanticSkeletonId).humanLabel) {
      accepted.push({ itemId: item.itemId, decision: row.decision });
    } else {
      rejected.push({ itemId: item.itemId, reasonCode: SKELETON_MISMATCH_REASON });
    }
  }
  accepted.sort((left, right) => left.itemId < right.itemId ? -1 : 1);
  rejected.sort((left, right) => left.itemId < right.itemId ? -1 : 1);
  return { reconciliation, accepted, rejected };
}

function buildSmokeBatchAcceptance(rawBatchBytes, auditReceipt, rawEffectiveBytes, rawExact56Bytes) {
  const { batch } = validateAuditReceipt(rawBatchBytes, auditReceipt);
  if (sha256RawBytes(rawEffectiveBytes) !== EFFECTIVE_DECISIONS_SHA256
    || sha256RawBytes(rawExact56Bytes) !== EXACT56_SHA256) {
    fail('smoke acceptance input bytes are invalid');
  }
  const effective = JSON.parse(Buffer.from(rawEffectiveBytes).toString('utf8'));
  const exact56 = JSON.parse(Buffer.from(rawExact56Bytes).toString('utf8'));
  if (!exactKeys(effective, [
    'name', 'status', 'currentSourceBatch', 'rendererIdentity', 'originalPrimaryHumanAttempt',
    'focusedPrimaryHumanRereviewAttempt', 'summary', 'reconciliation', 'authority', 'rows',
  ]) || effective.name !== EFFECTIVE_DECISIONS_IDENTITY
    || effective.status !== 'RECONCILIATION_NEEDS_FIX'
    || !exactKeys(effective.currentSourceBatch, ['identity', 'rawSha256'])
    || effective.currentSourceBatch.identity !== batch.name
    || effective.currentSourceBatch.rawSha256 !== CURRENT_BATCH_SHA256
    || effective.rendererIdentity !== RENDERER_IDENTITY
    || effective.originalPrimaryHumanAttempt !== ORIGINAL_ATTEMPT_ID
    || effective.focusedPrimaryHumanRereviewAttempt !== REREVIEW_ATTEMPT_ID
    || JSON.stringify(effective.summary) !== JSON.stringify(EXPECTED_EFFECTIVE_SUMMARY)
    || !exactKeys(effective.reconciliation, ['exact56Sha256', 'matchCount', 'mismatchCount'])
    || effective.reconciliation.exact56Sha256 !== EXACT56_SHA256
    || effective.reconciliation.matchCount !== 30 || effective.reconciliation.mismatchCount !== 2
    || !exactKeys(effective.authority, [
      'sourceBundleGatePassed', 'humanReviewCompleted', 'surfaceHumanGoldFrozen',
      'trainingOccurred',
    ]) || effective.authority.sourceBundleGatePassed !== true
    || effective.authority.humanReviewCompleted !== false
    || effective.authority.surfaceHumanGoldFrozen !== false
    || effective.authority.trainingOccurred !== false
    || !Array.isArray(effective.rows)) {
    fail('effective current HUMAN artifact binding is invalid');
  }
  const { accepted, rejected } = classifySmokeAcceptance(batch, effective.rows, exact56);
  return {
    name: SMOKE_ACCEPTANCE_IDENTITY,
    status: 'COMPLETE_WITH_REJECTIONS',
    sourceBatch: { identity: batch.name, rawSha256: CURRENT_BATCH_SHA256 },
    exact56: { identity: exact56.name, rawSha256: EXACT56_SHA256 },
    effectiveHumanDecisionArtifact: {
      identity: effective.name,
      rawSha256: EFFECTIVE_DECISIONS_SHA256,
    },
    summary: { reviewed: 32, accepted: accepted.length, rejected: rejected.length, unresolved: 0 },
    authority: {
      sourceBundleGatePassed: true,
      primaryHumanReviewResolved: true,
      finalCorpusHumanGoldFrozen: false,
      heldRepeatedReviewCompleted: false,
      trainingOccurred: false,
    },
    accepted,
    rejected,
  };
}

function buildEffectiveHumanDecisionSet(rawBatchBytes, auditReceipt, rawOriginalPacketBytes,
  originalReceipt, rawRereviewPacketBytes, rereviewReceipt, rawExact56Bytes) {
  const { batch, rows: rereviewRows } = validateRereviewReceipt(
    rawBatchBytes, auditReceipt, rawOriginalPacketBytes, originalReceipt,
    rawRereviewPacketBytes, rereviewReceipt,
  );
  if (sha256RawBytes(rawExact56Bytes) !== EXACT56_SHA256) {
    fail('frozen exact56 bytes are invalid');
  }
  const exact56 = JSON.parse(Buffer.from(rawExact56Bytes).toString('utf8'));
  const originalPacket = JSON.parse(Buffer.from(rawOriginalPacketBytes).toString('utf8'));
  const originalBundles = new Map(originalPacket.rows.map(row => [row.reviewRowId, row.selectedBundle]));
  const originalDecisions = new Map(originalReceipt.rows.map(row => [row.reviewRowId, row]));
  const rows = batch.items.map(item => {
    const originalId = primaryReview.opaqueReviewRowId(ORIGINAL_BATCH_SHA256, item.itemId);
    const changed = originalBundles.get(originalId) !== renderHumanReviewText(batch, item);
    const decision = changed
      ? rereviewRows.get(opaqueRereviewRowId(CURRENT_BATCH_SHA256, item.itemId))
      : originalDecisions.get(originalId);
    if (!decision || !['KEEP', 'FIX', 'REJECT'].includes(decision.disposition)
      || !['CLEAR', 'ESCALATE'].includes(decision.decision)) {
      fail('a current item has no applicable authoritative HUMAN decision');
    }
    return { itemId: item.itemId, disposition: decision.disposition, decision: decision.decision };
  }).sort((left, right) => left.itemId < right.itemId ? -1 : 1);
  const summary = summarizeDecisions(rows);
  if (JSON.stringify(summary) !== JSON.stringify(EXPECTED_EFFECTIVE_SUMMARY)) {
    fail('effective current HUMAN aggregate is invalid');
  }
  const reconciliation = reconcileEffectiveHumanDecisions(batch, rows, exact56);
  return {
    name: EFFECTIVE_DECISIONS_IDENTITY,
    status: reconciliation.humanReviewCompleted ? 'COMPLETE_PASS' : 'RECONCILIATION_NEEDS_FIX',
    currentSourceBatch: { identity: batch.name, rawSha256: CURRENT_BATCH_SHA256 },
    rendererIdentity: RENDERER_IDENTITY,
    originalPrimaryHumanAttempt: ORIGINAL_ATTEMPT_ID,
    focusedPrimaryHumanRereviewAttempt: REREVIEW_ATTEMPT_ID,
    summary,
    reconciliation: {
      exact56Sha256: EXACT56_SHA256,
      matchCount: reconciliation.matchCount,
      mismatchCount: reconciliation.mismatchCount,
    },
    authority: {
      sourceBundleGatePassed: true,
      humanReviewCompleted: reconciliation.humanReviewCompleted,
      surfaceHumanGoldFrozen: false,
      trainingOccurred: false,
    },
    rows,
  };
}

function buildBatch002EffectiveHumanDecisionSet(rawBatchBytes, auditReceipt,
  rawOriginalPacketBytes, originalReceipt, rawRereviewPacketBytes, rereviewReceipt,
  rawExact56Bytes) {
  const { rows: rereviewRows } = validateBatch002RereviewReceipt(
    rawBatchBytes, auditReceipt, rawOriginalPacketBytes, originalReceipt,
    rawRereviewPacketBytes, rereviewReceipt,
  );
  if (sha256RawBytes(rawExact56Bytes) !== EXACT56_SHA256) {
    fail('batch-002 frozen exact56 bytes are invalid');
  }
  const batch = validateSurfaceBatch(JSON.parse(Buffer.from(rawBatchBytes).toString('utf8')));
  const exact56 = JSON.parse(Buffer.from(rawExact56Bytes).toString('utf8'));
  const originalPacket = JSON.parse(Buffer.from(rawOriginalPacketBytes).toString('utf8'));
  const originalBundles = new Map(originalPacket.rows.map(row => [
    row.reviewRowId, row.selectedBundle,
  ]));
  const originalDecisions = new Map(originalReceipt.rows.map(row => [row.reviewRowId, row]));

  let inheritedCount = 0;
  let repairedCount = 0;
  const rows = batch.items.map(item => {
    const originalId = primaryReview.opaqueReviewRowId(
      BATCH002_REREVIEW.originalBatchSha256, item.itemId,
    );
    const changed = originalBundles.get(originalId) !== renderHumanReviewText(batch, item);
    const decision = changed
      ? rereviewRows.get(opaqueRereviewRowId(BATCH002_REREVIEW.currentBatchSha256, item.itemId))
      : originalDecisions.get(originalId);
    if (!decision || decision.disposition !== 'KEEP'
      || !['CLEAR', 'ESCALATE'].includes(decision.decision)) {
      fail('a batch-002 item has no applicable KEEP HUMAN decision');
    }
    if (changed) repairedCount += 1; else inheritedCount += 1;
    return { itemId: item.itemId, disposition: decision.disposition, decision: decision.decision };
  }).sort((left, right) => left.itemId < right.itemId ? -1 : 1);
  if (new Set(rows.map(row => row.itemId)).size !== batch.items.length
    || inheritedCount !== batch.items.length - BATCH002_REREVIEW.changedCount
    || repairedCount !== BATCH002_REREVIEW.changedCount) {
    fail('batch-002 effective rows are duplicated or misattributed');
  }
  const summary = summarizeDecisions(rows);
  if (JSON.stringify(summary) !== JSON.stringify(BATCH002_EFFECTIVE_SUMMARY)) {
    fail('batch-002 effective current HUMAN aggregate is invalid');
  }

  const reconciliation = reconcileEffectiveHumanDecisions(batch, rows, exact56);
  if (reconciliation.matchCount + reconciliation.mismatchCount !== batch.items.length) {
    fail('batch-002 reconciliation counts do not cover every current item');
  }
  return {
    artifact: {
      name: BATCH002_EFFECTIVE_IDENTITY,
      status: reconciliation.humanReviewCompleted ? 'COMPLETE_PASS' : 'RECONCILIATION_NEEDS_FIX',
      currentSourceBatch: {
        identity: batch.name,
        rawSha256: BATCH002_REREVIEW.currentBatchSha256,
      },
      rendererIdentity: RENDERER_IDENTITY,
      originalPrimaryHumanAttempt: BATCH002_REREVIEW.originalAttemptId,
      focusedPrimaryHumanRereviewAttempt: BATCH002_REREVIEW.rereviewAttemptId,
      summary,
      reconciliation: {
        exact56Sha256: EXACT56_SHA256,
        matchCount: reconciliation.matchCount,
        mismatchCount: reconciliation.mismatchCount,
      },
      authority: {
        sourceBundleGatePassed: true,
        humanReviewCompleted: reconciliation.humanReviewCompleted,
        surfaceHumanGoldFrozen: false,
        trainingOccurred: false,
      },
      rows,
    },
    batch,
    exact56,
    reconciliation,
    inheritedCount,
    repairedCount,
  };
}

function buildBatch002MismatchDiagnostic(effective) {
  const { artifact, batch, exact56, reconciliation } = effective;
  const decisions = new Map(artifact.rows.map(row => [row.itemId, row]));
  const skeletons = new Map(exact56.candidates.map(row => [row.semanticSkeletonId, row]));
  const mismatches = batch.items.filter(item =>
    decisions.get(item.itemId).decision !== skeletons.get(item.semanticSkeletonId).humanLabel)
    .map(item => ({
      itemId: item.itemId,
      semanticSkeletonId: item.semanticSkeletonId,
      splitAssignment: skeletons.get(item.semanticSkeletonId).splitAssignment,
      currentHumanDecision: decisions.get(item.itemId).decision,
      frozenSkeletonHumanLabel: skeletons.get(item.semanticSkeletonId).humanLabel,
    }))
    .sort((left, right) => left.itemId < right.itemId ? -1 : 1);
  if (mismatches.length !== reconciliation.mismatchCount) {
    fail('batch-002 mismatch diagnostic does not match the reconciliation count');
  }
  return {
    name: BATCH002_MISMATCH_IDENTITY,
    status: 'DIAGNOSTIC_ONLY_REQUIRES_REPOSITORY_OWNER_RESOLUTION',
    currentSourceBatch: artifact.currentSourceBatch,
    effectiveHumanDecisionArtifact: { identity: artifact.name },
    exact56: { identity: exact56.name, rawSha256: EXACT56_SHA256 },
    summary: {
      total: batch.items.length,
      matchCount: reconciliation.matchCount,
      mismatchCount: reconciliation.mismatchCount,
    },
    authority: {
      humanDecisionsAltered: false,
      frozenSkeletonLabelsAltered: false,
      acceptanceOrRejectionPerformed: false,
      surfacesRepaired: false,
      neverExposedToBlindHumanReview: true,
    },
    mismatches,
  };
}

// The canonical mismatch diagnostic decides WHICH reconciliation mismatches are
// adjudicated. Binding to its raw bytes, and requiring it to agree mechanically with the
// recomputed diagnostic, stops a caller from mutating effective rows into a different
// 24-item mismatch set that still preserves the counts.
function validateBatch002MismatchDiagnostic(effective, rawMismatchDiagnosticBytes) {
  if (sha256RawBytes(rawMismatchDiagnosticBytes) !== BATCH002_MISMATCH_SHA256) {
    fail('canonical batch-002 mismatch diagnostic bytes are invalid');
  }
  const diagnostic = JSON.parse(Buffer.from(rawMismatchDiagnosticBytes).toString('utf8'));
  if (diagnostic.name !== BATCH002_MISMATCH_IDENTITY
    || diagnostic.currentSourceBatch?.rawSha256 !== BATCH002_REREVIEW.currentBatchSha256
    || diagnostic.effectiveHumanDecisionArtifact?.identity !== BATCH002_EFFECTIVE_IDENTITY
    || diagnostic.exact56?.rawSha256 !== EXACT56_SHA256
    || JSON.stringify(diagnostic) !== JSON.stringify(buildBatch002MismatchDiagnostic(effective))) {
    fail('canonical batch-002 mismatch diagnostic does not bind to the current artifacts');
  }
  const itemIds = diagnostic.mismatches.map(row => row.itemId);
  const skeletonIds = [...new Set(diagnostic.mismatches.map(row => row.semanticSkeletonId))]
    .sort((left, right) => left < right ? -1 : 1);
  if (itemIds.length !== BATCH002_ADJUDICATION_EXPECTED.items
    || new Set(itemIds).size !== itemIds.length
    || JSON.stringify(skeletonIds) !== JSON.stringify([...BATCH002_MISMATCH_SKELETONS])) {
    fail('canonical batch-002 mismatch diagnostic is not the expected 24-item mismatch set');
  }
  return diagnostic;
}

function buildBatch002PragmaticAdjudicationPacket(effective,
  rawOriginalPacketBytes, rawRereviewPacketBytes, rawMismatchDiagnosticBytes) {
  const { artifact, batch, exact56 } = effective;
  const diagnostic = validateBatch002MismatchDiagnostic(effective, rawMismatchDiagnosticBytes);
  const skeletons = new Map(exact56.candidates.map(row => [row.semanticSkeletonId, row]));
  const items = new Map(batch.items.map(item => [item.itemId, item]));
  const mismatchIds = new Set(diagnostic.mismatches.map(row => row.itemId));
  if (mismatchIds.size !== BATCH002_ADJUDICATION_EXPECTED.items) {
    fail('batch-002 adjudication packet expects exactly 24 mismatch items');
  }
  // The surface each mismatch item's HUMAN reviewer actually saw: the immutable original
  // packet, or the focused re-review packet for a repaired anchor.
  const seen = new Map();
  for (const row of JSON.parse(Buffer.from(rawOriginalPacketBytes).toString('utf8')).rows) {
    seen.set(row.reviewRowId, row.selectedBundle);
  }
  for (const row of JSON.parse(Buffer.from(rawRereviewPacketBytes).toString('utf8')).rows) {
    seen.set(row.reviewRowId, row.selectedBundle);
  }
  const grouped = new Map();
  for (const row of diagnostic.mismatches) {
    const item = items.get(row.itemId);
    if (!item) fail(`batch-002 mismatch item is absent from the current batch: ${row.itemId}`);
    const skeleton = skeletons.get(row.semanticSkeletonId);
    if (!skeleton) fail(`batch-002 mismatch skeleton is absent from exact56: ${row.semanticSkeletonId}`);
    const selectedBundle = renderHumanReviewText(batch, item);
    const canonical = seen.get(opaqueRereviewRowId(BATCH002_REREVIEW.currentBatchSha256, row.itemId))
      ?? seen.get(primaryReview.opaqueReviewRowId(BATCH002_REREVIEW.originalBatchSha256, row.itemId));
    if (selectedBundle !== canonical) {
      fail(`batch-002 renderer output differs from the canonical HUMAN surface: ${row.itemId}`);
    }
    if (!grouped.has(row.semanticSkeletonId)) {
      grouped.set(row.semanticSkeletonId, {
        semanticSkeletonId: skeleton.semanticSkeletonId,
        splitAssignment: skeleton.splitAssignment,
        boundaryClass: skeleton.boundaryClass,
        candidateFocus: skeleton.candidateFocus,
        semanticRelations: skeleton.semanticRelations,
        items: [],
      });
    }
    grouped.get(row.semanticSkeletonId).items.push({ itemId: row.itemId, selectedBundle });
  }
  const skeletonGroups = [...grouped.values()]
    .sort((left, right) => left.semanticSkeletonId < right.semanticSkeletonId ? -1 : 1);
  for (const group of skeletonGroups) {
    group.items.sort((left, right) => left.itemId < right.itemId ? -1 : 1);
  }
  const packetIds = skeletonGroups.flatMap(group => group.items.map(row => row.itemId));
  if (skeletonGroups.length !== BATCH002_ADJUDICATION_EXPECTED.skeletonGroups) {
    fail('batch-002 adjudication packet expects exactly 10 unique skeleton groups');
  }
  if (packetIds.length !== BATCH002_ADJUDICATION_EXPECTED.items
    || new Set(packetIds).size !== packetIds.length
    || packetIds.some(itemId => !mismatchIds.has(itemId))) {
    fail('batch-002 adjudication packet contains a duplicated or non-mismatch item');
  }
  return {
    name: BATCH002_ADJUDICATION_IDENTITY,
    status: 'DIAGNOSTIC_ONLY_AWAITING_SEMANTIC_ADJUDICATION',
    interpretationRule: INTERPRETATION_RULE,
    currentSourceBatch: artifact.currentSourceBatch,
    rendererIdentity: RENDERER_IDENTITY,
    effectiveHumanDecisionArtifact: { identity: artifact.name },
    mismatchDiagnostic: { identity: diagnostic.name },
    exact56: { identity: exact56.name, rawSha256: EXACT56_SHA256 },
    summary: {
      mismatchItems: packetIds.length,
      skeletonGroups: skeletonGroups.length,
    },
    adjudicationTaxonomy: ADJUDICATION_TAXONOMY,
    authority: {
      humanDecisionsAltered: false,
      frozenSkeletonLabelsAltered: false,
      acceptanceOrRejectionPerformed: false,
      surfacesRepaired: false,
      adjudicationPerformed: false,
      neverExposedToBlindHumanReview: true,
    },
    skeletonGroups,
  };
}

// Item-level routing decides which rows reach a blind HUMAN review, so the receipt is bound
// by raw bytes, not only by its canonical item set and 10/11/3/0 aggregate. Without this a
// count-preserving swap of two rows' outcomes would silently change the attempt-003
// population while every structural check still passed.
function parseCanonicalAdjudicationReceipt(rawReceiptBytes) {
  if (sha256RawBytes(rawReceiptBytes) !== BATCH002_ADJUDICATION_RECEIPT_SHA256) {
    fail('canonical batch-002 semantic adjudication receipt bytes are invalid');
  }
  return JSON.parse(Buffer.from(rawReceiptBytes).toString('utf8'));
}

// The committed receipt carries the repository owner's item-level semantic routing; this
// script validates it and never authors an outcome. Routing is bound to the canonical
// mismatch diagnostic, so it can only ever describe those exact 24 reconciliation
// mismatches.
function validateBatch002PragmaticAdjudicationReceipt(effective, rawOriginalPacketBytes,
  rawRereviewPacketBytes, rawMismatchDiagnosticBytes, rawEffectiveBytes, rawReceiptBytes) {
  const diagnostic = validateBatch002MismatchDiagnostic(effective, rawMismatchDiagnosticBytes);
  if (sha256RawBytes(rawEffectiveBytes) !== BATCH002_EFFECTIVE_SHA256
    || JSON.stringify(JSON.parse(Buffer.from(rawEffectiveBytes).toString('utf8')))
      !== JSON.stringify(effective.artifact)) {
    fail('batch-002 effective-current artifact bytes are invalid');
  }
  const packet = buildBatch002PragmaticAdjudicationPacket(effective, rawOriginalPacketBytes,
    rawRereviewPacketBytes, rawMismatchDiagnosticBytes);
  if (sha256RawBytes(packetBytes(packet)) !== BATCH002_ADJUDICATION_SHA256) {
    fail('batch-002 pragmatic adjudication packet bytes changed');
  }

  const receipt = parseCanonicalAdjudicationReceipt(rawReceiptBytes);
  if (!exactKeys(receipt, [
    'name', 'status', 'interpretationRule', 'currentSourceBatch',
    'effectiveHumanDecisionArtifact', 'mismatchDiagnostic', 'pragmaticAdjudicationPacket',
    'exact56', 'summary', 'pendingResolutions', 'authority', 'rows',
  ]) || receipt.name !== BATCH002_ADJUDICATION_RECEIPT_IDENTITY
    || receipt.status !== 'COMPLETE_WITH_HUMAN_REREVIEW_REQUIRED'
    || receipt.interpretationRule !== INTERPRETATION_RULE
    || receipt.currentSourceBatch.rawSha256 !== BATCH002_REREVIEW.currentBatchSha256
    || receipt.currentSourceBatch.identity !== effective.batch.name
    || receipt.effectiveHumanDecisionArtifact.identity !== BATCH002_EFFECTIVE_IDENTITY
    || receipt.effectiveHumanDecisionArtifact.rawSha256 !== BATCH002_EFFECTIVE_SHA256
    || receipt.mismatchDiagnostic.identity !== diagnostic.name
    || receipt.mismatchDiagnostic.rawSha256 !== BATCH002_MISMATCH_SHA256
    || receipt.pragmaticAdjudicationPacket.identity !== packet.name
    || receipt.pragmaticAdjudicationPacket.rawSha256 !== BATCH002_ADJUDICATION_SHA256
    || receipt.exact56.identity !== effective.exact56.name
    || receipt.exact56.rawSha256 !== EXACT56_SHA256) {
    fail('batch-002 semantic adjudication receipt does not bind to the canonical artifacts');
  }

  // Exactly one row per canonical mismatch item, sorted, carrying only a routing outcome.
  const mismatchIds = new Set(diagnostic.mismatches.map(row => row.itemId));
  const itemIds = receipt.rows.map(row => row.itemId);
  const summary = { total: receipt.rows.length };
  for (const outcome of ADJUDICATION_TAXONOMY) {
    summary[outcome] = receipt.rows.filter(row => row.outcome === outcome).length;
  }
  if (itemIds.length !== mismatchIds.size
    || new Set(itemIds).size !== itemIds.length
    || itemIds.some(itemId => !mismatchIds.has(itemId))
    || JSON.stringify(itemIds) !== JSON.stringify([...itemIds].sort((left, right) =>
      left < right ? -1 : 1))
    || receipt.rows.some(row => !exactKeys(row, ['itemId', 'outcome'])
      || !ADJUDICATION_TAXONOMY.includes(row.outcome))
    || JSON.stringify(receipt.summary) !== JSON.stringify(BATCH002_ADJUDICATION_SUMMARY)
    || JSON.stringify(summary) !== JSON.stringify(BATCH002_ADJUDICATION_SUMMARY)) {
    fail('batch-002 semantic adjudication rows are not exactly the canonical mismatch set');
  }

  // Routing records what still has to be resolved; it assigns no HUMAN gold and amends nothing.
  const skeletonOf = new Map(diagnostic.mismatches.map(row => [row.itemId, row.semanticSkeletonId]));
  const revisionSkeletons = [...new Set(receipt.rows
    .filter(row => row.outcome === 'SKELETON_SEMANTICS_NEEDS_REVISION')
    .map(row => skeletonOf.get(row.itemId)))].sort((left, right) => left < right ? -1 : 1);
  const { pendingResolutions: pending, authority } = receipt;
  if (JSON.stringify(pending.exact56SemanticAmendment.semanticSkeletonIds)
      !== JSON.stringify(revisionSkeletons)
    || pending.surfaceRepairOrDatasetRejection.itemCount !== summary.SURFACE_COLLAPSES_AMBIGUITY
    || pending.freshBlindHumanRereview.itemCount !== summary.HUMAN_DECISION_NEEDS_REREVIEW
    || pending.freshBlindHumanRereview.attemptId !== BATCH002_REREVIEW_003.attemptId
    || Object.values(pending).some(entry => entry.required !== true)
    || authority.humanGoldAssigned !== false || authority.humanDecisionsAltered !== false
    || authority.frozenSkeletonLabelsAltered !== false || authority.exact56Amended !== false
    || authority.surfacesRepaired !== false
    || authority.acceptanceOrRejectionPerformed !== false) {
    fail('batch-002 semantic adjudication receipt claims authority it does not have');
  }
  return { receipt, diagnostic, packet, revisionSkeletons };
}

// Fresh blind HUMAN re-review packet for exactly the HUMAN_DECISION_NEEDS_REREVIEW rows.
// Selection comes from the canonical semantic adjudication receipt, and the HUMAN-facing
// rows carry nothing but an opaque row ID and the canonical rendered bundle.
function buildBatch002RereviewAttempt003Packet(rawBatchBytes, auditReceipt,
  rawAdjudicationReceiptBytes) {
  const { batch, batchSha256, attemptId } = primaryReview.validateAuditReceipt(
    auditReceipt, rawBatchBytes,
  );
  if (batchSha256 !== BATCH002_REREVIEW.currentBatchSha256
    || attemptId !== BATCH002_REREVIEW.auditAttemptId) {
    fail('batch-002 attempt-003 current batch or audit binding is invalid');
  }
  const receipt = parseCanonicalAdjudicationReceipt(rawAdjudicationReceiptBytes);
  if (receipt.name !== BATCH002_ADJUDICATION_RECEIPT_IDENTITY
    || receipt.interpretationRule !== INTERPRETATION_RULE
    || receipt.currentSourceBatch?.rawSha256 !== BATCH002_REREVIEW.currentBatchSha256
    || receipt.exact56?.rawSha256 !== EXACT56_SHA256
    || receipt.mismatchDiagnostic?.rawSha256 !== BATCH002_MISMATCH_SHA256
    || !Array.isArray(receipt.rows)
    || receipt.rows.length !== BATCH002_ADJUDICATION_EXPECTED.items) {
    fail('batch-002 semantic adjudication receipt binding is invalid');
  }

  const items = new Map(batch.items.map(item => [item.itemId, item]));
  const selected = receipt.rows
    .filter(row => row.outcome === BATCH002_REREVIEW_003.selectionOutcome)
    .map(row => row.itemId);
  if (selected.length !== BATCH002_REREVIEW_003.expectedRows
    || new Set(selected).size !== selected.length) {
    fail('batch-002 attempt-003 expects exactly three HUMAN re-review rows');
  }
  const rows = selected.map(itemId => {
    const item = items.get(itemId);
    if (!item) fail(`batch-002 attempt-003 row is absent from the current batch: ${itemId}`);
    return {
      reviewRowId: opaqueRereviewRowId(batchSha256, itemId),
      selectedBundle: renderHumanReviewText(batch, item),
    };
  }).sort((left, right) => left.reviewRowId < right.reviewRowId ? -1 : 1);
  if (new Set(rows.map(row => row.reviewRowId)).size !== rows.length) {
    fail('batch-002 attempt-003 review row IDs are not unique');
  }
  return {
    name: PACKET_IDENTITY,
    attemptId: BATCH002_REREVIEW_003.attemptId,
    sourceBatch: { identity: batch.name, sha256: batchSha256 },
    rendererIdentity: RENDERER_IDENTITY,
    sourceAuditAttempt: BATCH002_REREVIEW.auditAttemptId,
    rows,
  };
}

// Attempt-003 is an additional HUMAN provenance layer over attempt-001/002; it rewrites no
// history. The reviewed population is whatever the canonical attempt-003 blind packet held,
// so the receipt is checked against the rebuilt packet rather than a copied item mapping.
function validateBatch002Attempt003Receipt(rawBatchBytes, auditReceipt,
  rawAdjudicationReceiptBytes, receipt) {
  const packet = buildBatch002RereviewAttempt003Packet(
    rawBatchBytes, auditReceipt, rawAdjudicationReceiptBytes,
  );
  if (sha256RawBytes(packetBytes(packet)) !== BATCH002_REREVIEW_003.packetSha256) {
    fail('batch-002 attempt-003 blind packet bytes are invalid');
  }
  if (!exactKeys(receipt, [
    'name', 'attemptId', 'status', 'primaryHumanRereviewPacket', 'reviewedSourceBatch',
    'rendererIdentity', 'sourceAuditPrerequisite', 'originalPrimaryHumanReview',
    'precedingFocusedRereview', 'reviewPopulationSelection', 'summary', 'authority', 'rows',
  ]) || receipt.name !== BATCH002_REREVIEW_003.receiptIdentity
    || receipt.attemptId !== BATCH002_REREVIEW_003.attemptId
    || receipt.status !== 'COMPLETE_PASS'
    || !exactKeys(receipt.primaryHumanRereviewPacket, ['identity', 'rawSha256'])
    || receipt.primaryHumanRereviewPacket.identity !== PACKET_IDENTITY
    || receipt.primaryHumanRereviewPacket.rawSha256 !== BATCH002_REREVIEW_003.packetSha256
    || !exactKeys(receipt.reviewedSourceBatch, ['identity', 'rawSha256'])
    || receipt.reviewedSourceBatch.identity !== packet.sourceBatch.identity
    || receipt.reviewedSourceBatch.rawSha256 !== BATCH002_REREVIEW.currentBatchSha256
    || receipt.rendererIdentity !== RENDERER_IDENTITY
    || !exactKeys(receipt.sourceAuditPrerequisite, ['attemptId', 'status', 'allRowsPassed'])
    || receipt.sourceAuditPrerequisite.attemptId !== BATCH002_REREVIEW.auditAttemptId
    || receipt.sourceAuditPrerequisite.status !== 'COMPLETE_PASS'
    || receipt.sourceAuditPrerequisite.allRowsPassed !== true
    || !exactKeys(receipt.originalPrimaryHumanReview, ['attemptId', 'receiptIdentity'])
    || receipt.originalPrimaryHumanReview.attemptId !== BATCH002_REREVIEW.originalAttemptId
    || receipt.originalPrimaryHumanReview.receiptIdentity
      !== BATCH002_REREVIEW.originalReceiptIdentity
    || !exactKeys(receipt.precedingFocusedRereview, ['attemptId', 'receiptIdentity'])
    || receipt.precedingFocusedRereview.attemptId !== BATCH002_REREVIEW.rereviewAttemptId
    || receipt.precedingFocusedRereview.receiptIdentity
      !== BATCH002_REREVIEW.rereviewReceiptIdentity
    || !exactKeys(receipt.reviewPopulationSelection, [
      'receiptIdentity', 'rawSha256', 'selectionOutcome',
    ]) || receipt.reviewPopulationSelection.receiptIdentity
      !== BATCH002_ADJUDICATION_RECEIPT_IDENTITY
    || receipt.reviewPopulationSelection.rawSha256 !== BATCH002_ADJUDICATION_RECEIPT_SHA256
    || receipt.reviewPopulationSelection.selectionOutcome
      !== BATCH002_REREVIEW_003.selectionOutcome
    || JSON.stringify(receipt.summary) !== JSON.stringify(BATCH002_ATTEMPT003_SUMMARY)
    || !exactKeys(receipt.authority, [
      'reviewCompletedForAllPresentedRows', 'acceptedKeepCount', 'unresolvedFixCount',
      'blindReview', 'primaryHumanReviewGateClosed', 'surfaceHumanGoldFrozen',
      'decisionsSource', 'modelInferenceUsedForHumanDecisions', 'trainingOccurred',
    ]) || receipt.authority.reviewCompletedForAllPresentedRows !== true
    || receipt.authority.acceptedKeepCount !== BATCH002_REREVIEW_003.expectedRows
    || receipt.authority.unresolvedFixCount !== 0
    || receipt.authority.blindReview !== true
    || receipt.authority.primaryHumanReviewGateClosed !== false
    || receipt.authority.surfaceHumanGoldFrozen !== false
    || receipt.authority.decisionsSource !== 'REPOSITORY_OWNER_PRIMARY_HUMAN_REVIEWER'
    || receipt.authority.modelInferenceUsedForHumanDecisions !== false
    || receipt.authority.trainingOccurred !== false
    || !Array.isArray(receipt.rows)
    || receipt.rows.length !== BATCH002_REREVIEW_003.expectedRows) {
    fail('batch-002 attempt-003 receipt binding is invalid');
  }

  // Exactly the packet's opaque IDs, once each, carrying the authoritative HUMAN decisions.
  const expectedIds = new Set(packet.rows.map(row => row.reviewRowId));
  const rows = new Map();
  for (const row of receipt.rows) {
    const expectedDecision = BATCH002_ATTEMPT003_DECISIONS.get(row.reviewRowId);
    if (!exactKeys(row, ['reviewRowId', 'disposition', 'decision'])
      || !expectedIds.has(row.reviewRowId) || rows.has(row.reviewRowId)
      || !expectedDecision || row.disposition !== expectedDecision[0]
      || row.decision !== expectedDecision[1]) {
      fail('batch-002 attempt-003 rows are invalid, stale, or duplicate');
    }
    rows.set(row.reviewRowId, row);
  }
  if (rows.size !== expectedIds.size
    || JSON.stringify(summarizeDecisions([...rows.values()]))
      !== JSON.stringify(BATCH002_ATTEMPT003_SUMMARY)) {
    fail('batch-002 attempt-003 rows do not match the authoritative aggregate');
  }
  return { packet, rows };
}

// Layers attempt-003 onto the existing effective overlay. The prior artifact stays exactly as
// built, because the frozen mismatch diagnostic and the semantic adjudication chain bind to it.
function buildBatch002EffectiveHumanDecisionSetWithAttempt003(rawBatchBytes, auditReceipt,
  rawOriginalPacketBytes, originalReceipt, rawRereviewPacketBytes, rereviewReceipt,
  rawExact56Bytes, rawAdjudicationReceiptBytes, attempt003Receipt) {
  const prior = buildBatch002EffectiveHumanDecisionSet(rawBatchBytes, auditReceipt,
    rawOriginalPacketBytes, originalReceipt, rawRereviewPacketBytes, rereviewReceipt,
    rawExact56Bytes);
  const { rows: attempt003Rows } = validateBatch002Attempt003Receipt(
    rawBatchBytes, auditReceipt, rawAdjudicationReceiptBytes, attempt003Receipt,
  );

  // Map each opaque review ID back to its batch item mechanically, never by a copied list.
  const population = new Map();
  for (const item of prior.batch.items) {
    const reviewRowId = opaqueRereviewRowId(BATCH002_REREVIEW.currentBatchSha256, item.itemId);
    if (attempt003Rows.has(reviewRowId)) population.set(item.itemId, attempt003Rows.get(reviewRowId));
  }
  if (population.size !== BATCH002_REREVIEW_003.expectedRows) {
    fail('batch-002 attempt-003 rows do not map onto exactly the reviewed population');
  }

  let supersededCount = 0;
  const rows = prior.artifact.rows.map(row => {
    const decision = population.get(row.itemId);
    if (!decision) return row;
    supersededCount += 1;
    return { itemId: row.itemId, disposition: decision.disposition, decision: decision.decision };
  });
  if (supersededCount !== BATCH002_REREVIEW_003.expectedRows
    || rows.length !== prior.artifact.rows.length
    || rows.some((row, index) => row.itemId !== prior.artifact.rows[index].itemId)
    || rows.some((row, index) => !population.has(row.itemId)
      && JSON.stringify(row) !== JSON.stringify(prior.artifact.rows[index]))) {
    fail('batch-002 attempt-003 overlay changed a decision outside the reviewed population');
  }
  const summary = summarizeDecisions(rows);
  if (JSON.stringify(summary) !== JSON.stringify(BATCH002_EFFECTIVE_003_SUMMARY)) {
    fail('batch-002 post-attempt-003 effective aggregate is invalid');
  }

  const reconciliation = reconcileEffectiveHumanDecisions(prior.batch, rows, prior.exact56);
  if (reconciliation.matchCount + reconciliation.mismatchCount !== prior.batch.items.length) {
    fail('batch-002 reconciliation counts do not cover every current item');
  }
  return {
    artifact: {
      name: BATCH002_EFFECTIVE_003_IDENTITY,
      status: reconciliation.humanReviewCompleted ? 'COMPLETE_PASS' : 'RECONCILIATION_NEEDS_FIX',
      supersedes: { identity: BATCH002_EFFECTIVE_IDENTITY, rawSha256: BATCH002_EFFECTIVE_SHA256 },
      currentSourceBatch: prior.artifact.currentSourceBatch,
      rendererIdentity: RENDERER_IDENTITY,
      originalPrimaryHumanAttempt: BATCH002_REREVIEW.originalAttemptId,
      focusedPrimaryHumanRereviewAttempt: BATCH002_REREVIEW.rereviewAttemptId,
      freshBlindPrimaryHumanRereviewAttempt: BATCH002_REREVIEW_003.attemptId,
      summary,
      reconciliation: {
        exact56Sha256: EXACT56_SHA256,
        matchCount: reconciliation.matchCount,
        mismatchCount: reconciliation.mismatchCount,
      },
      authority: {
        sourceBundleGatePassed: true,
        humanReviewCompleted: reconciliation.humanReviewCompleted,
        surfaceHumanGoldFrozen: false,
        trainingOccurred: false,
      },
      rows,
    },
    batch: prior.batch,
    exact56: prior.exact56,
    prior,
    reconciliation,
    supersededCount,
  };
}

function writeRereviewPacket(inputPath, auditReceiptPath, originalPacketPath,
  originalReceiptPath, outputPath) {
  if (fs.existsSync(outputPath)) throw new Error(`Existing output will not be overwritten: ${outputPath}`);
  const packet = buildRereviewPacket(
    fs.readFileSync(inputPath),
    JSON.parse(fs.readFileSync(auditReceiptPath, 'utf8')),
    fs.readFileSync(originalPacketPath),
    JSON.parse(fs.readFileSync(originalReceiptPath, 'utf8')),
  );
  fs.writeFileSync(outputPath, packetBytes(packet), { flag: 'wx' });
  return packet;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  writeRereviewPacket(args.inputPath, args.auditReceiptPath, args.originalPacketPath,
    args.originalReceiptPath, args.outputPath);
  process.stdout.write(`Built P1-B6 primary HUMAN re-review packet: ${args.outputPath}\n`);
  return 0;
}

module.exports = {
  AUDIT_ATTEMPT_ID,
  AUDIT_RESULT_SHA256,
  CURRENT_BATCH_SHA256,
  EFFECTIVE_DECISIONS_SHA256,
  EXPECTED_CHANGED_COUNT,
  ORIGINAL_ATTEMPT_ID,
  ORIGINAL_BATCH_SHA256,
  ORIGINAL_PACKET_SHA256,
  PACKET_IDENTITY,
  SMOKE_ACCEPTANCE_IDENTITY,
  SKELETON_MISMATCH_REASON,
  BATCH002_EFFECTIVE_IDENTITY,
  BATCH002_EFFECTIVE_SUMMARY,
  BATCH002_MISMATCH_IDENTITY,
  BATCH002_ADJUDICATION_IDENTITY,
  BATCH002_ADJUDICATION_EXPECTED,
  ADJUDICATION_TAXONOMY,
  INTERPRETATION_RULE,
  BATCH002_ADJUDICATION_RECEIPT_IDENTITY,
  BATCH002_ADJUDICATION_RECEIPT_SHA256,
  BATCH002_ADJUDICATION_SUMMARY,
  BATCH002_MISMATCH_SKELETONS,
  BATCH002_REREVIEW_003,
  buildBatch002PragmaticAdjudicationPacket,
  buildBatch002RereviewAttempt003Packet,
  buildSmokeBatchAcceptance,
  BATCH002_ATTEMPT003_SUMMARY,
  BATCH002_EFFECTIVE_003_IDENTITY,
  BATCH002_EFFECTIVE_003_SUMMARY,
  buildBatch002EffectiveHumanDecisionSet,
  buildBatch002EffectiveHumanDecisionSetWithAttempt003,
  buildBatch002MismatchDiagnostic,
  buildBatch002RereviewPacket,
  buildEffectiveHumanDecisionSet,
  buildRereviewPacket,
  classifySmokeAcceptance,
  main,
  opaqueRereviewRowId,
  packetBytes,
  parseArgs,
  reconcileEffectiveHumanDecisions,
  validateAuditReceipt,
  validateBatch002Attempt003Receipt,
  validateBatch002MismatchDiagnostic,
  validateBatch002PragmaticAdjudicationReceipt,
  validateBatch002RereviewReceipt,
  validateOriginalPacket,
  validateRereviewReceipt,
  writeRereviewPacket,
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`P1-B6 primary HUMAN re-review packet build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
