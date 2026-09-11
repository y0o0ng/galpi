#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const {
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
  buildRereviewPacket,
  main,
  opaqueRereviewRowId,
  packetBytes,
  parseArgs,
  validateAuditReceipt,
  validateOriginalPacket,
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
