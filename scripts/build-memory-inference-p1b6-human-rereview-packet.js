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
const EXPECTED_EFFECTIVE_SUMMARY = Object.freeze({
  total: 32, KEEP: 32, FIX: 0, REJECT: 0, CLEAR: 20, ESCALATE: 12,
});
const AUTHORITATIVE_REREVIEW_DECISIONS = new Map([
  ['p1b6-rereview-2a59d0efa5fa4a5c', ['KEEP', 'CLEAR']],
  ['p1b6-rereview-3103bdf5fda47336', ['KEEP', 'ESCALATE']],
  ['p1b6-rereview-5b1aab95130e93ee', ['KEEP', 'CLEAR']],
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
  EXPECTED_CHANGED_COUNT,
  ORIGINAL_ATTEMPT_ID,
  ORIGINAL_BATCH_SHA256,
  ORIGINAL_PACKET_SHA256,
  PACKET_IDENTITY,
  buildEffectiveHumanDecisionSet,
  buildRereviewPacket,
  main,
  opaqueRereviewRowId,
  packetBytes,
  parseArgs,
  reconcileEffectiveHumanDecisions,
  validateAuditReceipt,
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
