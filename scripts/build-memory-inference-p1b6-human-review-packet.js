#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const {
  RENDERER_IDENTITY,
  renderHumanReviewText,
  validateSurfaceBatch,
} = require('../lib/memory-inference-p1b6-surfaces');
const sourceAudit = require('./build-memory-inference-p1b6-source-audit-packet');

const PACKET_IDENTITY = 'xion-local-memory-inference-p1b6-primary-human-review-packet-v1';
const RECEIPT_IDENTITY = 'xion-local-memory-inference-p1b6-source-audit-batch-001-attempt-002-receipt-v1';
const ATTEMPT_ID = 'p1b6-source-audit-batch-001-attempt-002';

function fail(message) {
  throw new TypeError(`P1-B6 primary HUMAN review packet ${message}`);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--input', '--audit-receipt', '--output'].includes(flag)
      || !value || Object.hasOwn(values, flag)) {
      throw new Error('Usage: --input <surface-batch.json> --audit-receipt <receipt.json> --output <review-packet.json>');
    }
    values[flag] = value;
  }
  if (!values['--input'] || !values['--audit-receipt'] || !values['--output']) {
    throw new Error('Usage: --input <surface-batch.json> --audit-receipt <receipt.json> --output <review-packet.json>');
  }
  return {
    inputPath: values['--input'],
    receiptPath: values['--audit-receipt'],
    outputPath: values['--output'],
  };
}

function packetBytes(packet) {
  return Buffer.from(`${JSON.stringify(packet, null, 2)}\n`, 'utf8');
}

function opaqueReviewRowId(batchSha256, itemId) {
  return `p1b6-review-${crypto.createHash('sha256')
    .update(`${PACKET_IDENTITY}\0${batchSha256}\0${itemId}`).digest('hex').slice(0, 16)}`;
}

function validateAuditReceipt(receipt, rawBatchBytes) {
  const batch = validateSurfaceBatch(JSON.parse(Buffer.from(rawBatchBytes).toString('utf8')));
  const batchSha256 = sha256RawBytes(rawBatchBytes);
  const protocol = sourceAudit.loadProtocol();
  const auditPacket = sourceAudit.buildAuditPacket(rawBatchBytes);
  const auditPacketSha256 = sha256RawBytes(packetBytes(auditPacket));

  if (!exactKeys(receipt, [
    'name', 'attemptId', 'status', 'auditPacketIdentity', 'auditPacketSha256',
    'sourceAuditProtocol', 'auditedSourceBatch', 'rawResultArtifact',
    'auditorExecutionProvenance', 'summary', 'authority', 'rows',
  ]) || receipt.name !== RECEIPT_IDENTITY || receipt.attemptId !== ATTEMPT_ID
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
    || auditPacket.sourceBatch.sha256 !== batchSha256
    || auditPacket.rendererIdentity !== RENDERER_IDENTITY) fail('receipt binding is invalid');

  if (!exactKeys(receipt.summary, ['total', 'PASS', 'FAIL', 'UNCERTAIN'])
    || receipt.summary.total !== batch.items.length || receipt.summary.PASS !== batch.items.length
    || receipt.summary.FAIL !== 0 || receipt.summary.UNCERTAIN !== 0
    || !Array.isArray(receipt.rows) || receipt.rows.length !== batch.items.length) {
    fail('receipt is not an all-PASS result for every current item');
  }

  const expectedIds = new Set(auditPacket.rows.map(row => row.auditRowId));
  const seenIds = new Set();
  for (const row of receipt.rows) {
    if (!exactKeys(row, ['auditRowId', 'disposition', 'reason'])
      || typeof row.reason !== 'string' || row.reason.trim() === ''
      || row.disposition !== 'PASS' || !expectedIds.has(row.auditRowId)
      || seenIds.has(row.auditRowId)) fail('receipt rows are incomplete, stale, or not all PASS');
    seenIds.add(row.auditRowId);
  }
  if (seenIds.size !== expectedIds.size) fail('receipt is missing an audit row');
  return { batch, batchSha256 };
}

function buildHumanReviewPacket(rawBatchBytes, receipt) {
  const { batch, batchSha256 } = validateAuditReceipt(receipt, rawBatchBytes);
  const rows = batch.items.map(item => ({
    reviewRowId: opaqueReviewRowId(batchSha256, item.itemId),
    selectedBundle: renderHumanReviewText(batch, item),
  })).sort((left, right) => left.reviewRowId < right.reviewRowId ? -1 : 1);
  return {
    name: PACKET_IDENTITY,
    sourceBatch: { identity: batch.name, sha256: batchSha256 },
    rendererIdentity: RENDERER_IDENTITY,
    sourceAuditAttempt: ATTEMPT_ID,
    rows,
  };
}

function writeHumanReviewPacket(inputPath, receiptPath, outputPath) {
  if (fs.existsSync(outputPath)) throw new Error(`Existing output will not be overwritten: ${outputPath}`);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  const packet = buildHumanReviewPacket(fs.readFileSync(inputPath), receipt);
  fs.writeFileSync(outputPath, packetBytes(packet), { flag: 'wx' });
  return packet;
}

function main(argv = process.argv.slice(2)) {
  const { inputPath, receiptPath, outputPath } = parseArgs(argv);
  writeHumanReviewPacket(inputPath, receiptPath, outputPath);
  process.stdout.write(`Built P1-B6 primary HUMAN review packet: ${outputPath}\n`);
  return 0;
}

module.exports = {
  ATTEMPT_ID,
  PACKET_IDENTITY,
  RECEIPT_IDENTITY,
  buildHumanReviewPacket,
  main,
  opaqueReviewRowId,
  packetBytes,
  parseArgs,
  validateAuditReceipt,
  writeHumanReviewPacket,
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`P1-B6 primary HUMAN review packet build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
