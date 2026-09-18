#!/usr/bin/env node
'use strict';

// Fresh blind primary HUMAN review packet for the 12 repaired batch-002 candidates that
// freshly passed source audit.
//
// This step CONSTRUCTS the packet. It makes no HUMAN decision, embeds no expected
// CLEAR/ESCALATE answer, builds no authoritative decision map, accepts no row, freezes no
// gold, releases no HELD_OUT, and trains nothing. The repository owner's blind review comes
// later and records KEEP/FIX/REJECT with CLEAR/ESCALATE in its own receipt.
//
// The historical HUMAN builder consumes the four-key surface-batch shape through
// validateSurfaceBatch(); the repair candidate deliberately is not that artifact. This builder
// is therefore narrow, and the visible bundles come straight from the canonical repaired
// source-audit packet so what the reviewer sees is byte-for-byte what was audited.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { RENDERER_IDENTITY } = require('../lib/memory-inference-p1b6-surfaces');
const {
  AUTHORIZED_REJECT_ITEM_IDS,
  AUTHORIZED_REPAIR_ITEM_IDS,
} = require('./build-memory-inference-p1b6-surface-repair-candidate');
const auditPacketBuilder =
  require('./build-memory-inference-p1b6-surface-repair-source-audit-packet');

const PACKET_IDENTITY =
  'xion-local-memory-inference-p1b6-surface-repair-primary-human-review-packet-batch-002-v1';
// A namespace of its own: these are new reviewed surface realizations, so no historical
// `p1b6-review-` identity may be reused for the changed source text.
const REVIEW_ID_NAMESPACE = 'p1b6-repair-review';
const AUDIT_ATTEMPT_ID = 'p1b6-surface-repair-source-audit-batch-002-attempt-001';
const AUDIT_RECEIPT_IDENTITY =
  'xion-local-memory-inference-p1b6-surface-repair-source-audit-batch-002-attempt-001-receipt-v1';
const AUDIT_RECEIPT_FIXTURE =
  'local-memory-inference-p1b6-surface-repair-source-audit-batch-002-attempt-001.json';
// The external result artifact stays outside the repository, as raw model output does by
// convention. Its bytes are pinned here so the committed receipt cannot quietly re-point at a
// different run, and so supplied result bytes can be checked when they are available.
const RAW_RESULT_FILENAME = 'p1b6-repair-source-audit-results.json';
const RAW_RESULT_SHA256 = 'fd4d11a21ea9ee960b7f990df9d0207c4768d122e3c6afdb1dffab013f17f4aa';
const HISTORICAL_AUDIT_ID_PREFIX = 'p1b6-audit-';

function fail(message) {
  throw new TypeError(`P1-B6 repair HUMAN review packet ${message}`);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function packetBytes(packet) {
  return Buffer.from(`${JSON.stringify(packet, null, 2)}\n`, 'utf8');
}

// The item ID is hash input only and never reaches the packet. Any candidate byte change moves
// the whole review-ID namespace.
function opaqueReviewRowId(candidateSha256, itemId) {
  const digest = crypto.createHash('sha256')
    .update(`${REVIEW_ID_NAMESPACE}\0${PACKET_IDENTITY}\0${candidateSha256}\0${itemId}`)
    .digest('hex').slice(0, 16);
  return `${REVIEW_ID_NAMESPACE}-${digest}`;
}

function verifyRawResultArtifact(rawBytes) {
  if (!Buffer.isBuffer(rawBytes) && !ArrayBuffer.isView(rawBytes)) {
    fail('raw result artifact bytes were not supplied');
  }
  if (sha256RawBytes(rawBytes) !== RAW_RESULT_SHA256) {
    fail('raw result artifact bytes are not the reviewed evidence');
  }
  return JSON.parse(Buffer.from(rawBytes).toString('utf8'));
}

// The audit receipt is the gate. It must bind to the mechanically rebuilt canonical packet,
// cover exactly its 12 opaque IDs, and be all PASS; FAIL or UNCERTAIN fails closed under the
// unchanged protocol.
function validateAuditReceipt(receipt, canonicalInputs = auditPacketBuilder.loadCanonicalInputs()) {
  const auditPacket = auditPacketBuilder.buildRepairSourceAuditPacket(canonicalInputs);
  const auditPacketSha256 = sha256RawBytes(packetBytes(auditPacket));
  const candidateSha256 = auditPacket.repairCandidate.rawSha256;

  if (!exactKeys(receipt, [
    'name', 'attemptId', 'status', 'auditPacketIdentity', 'auditPacketSha256',
    'sourceAuditProtocol', 'auditedRepairCandidate', 'rawResultArtifact',
    'auditorExecutionProvenance', 'freshness', 'summary', 'authority', 'rows',
  ]) || receipt.name !== AUDIT_RECEIPT_IDENTITY
    || receipt.attemptId !== AUDIT_ATTEMPT_ID
    || receipt.status !== 'COMPLETE_PASS'
    || receipt.auditPacketIdentity !== auditPacketBuilder.PACKET_IDENTITY
    || receipt.auditPacketSha256 !== auditPacketSha256
    || !exactKeys(receipt.sourceAuditProtocol, ['identity', 'sha256'])
    || receipt.sourceAuditProtocol.identity !== auditPacketBuilder.PROTOCOL_IDENTITY
    || receipt.sourceAuditProtocol.sha256
      !== auditPacketBuilder.CANONICAL_INPUTS.sourceAuditProtocol.rawSha256
    || !exactKeys(receipt.auditedRepairCandidate, ['identity', 'rawSha256'])
    || receipt.auditedRepairCandidate.identity
      !== auditPacketBuilder.CANONICAL_INPUTS.repairCandidate.identity
    || receipt.auditedRepairCandidate.rawSha256 !== candidateSha256
    || !exactKeys(receipt.rawResultArtifact, ['filename', 'sha256'])
    || receipt.rawResultArtifact.filename !== RAW_RESULT_FILENAME
    || receipt.rawResultArtifact.sha256 !== RAW_RESULT_SHA256
    || auditPacket.rendererIdentity !== RENDERER_IDENTITY) {
    fail('audit receipt binding is invalid');
  }

  // Nothing was inherited from the historical batch-002 audit.
  if (receipt.freshness?.freshJudgmentsForEveryRow !== true
    || receipt.freshness?.historicalSourceAuditResultInherited !== false
    || receipt.rows.some(row => String(row?.auditRowId)
      .startsWith(HISTORICAL_AUDIT_ID_PREFIX))) {
    fail('audit receipt inherits or claims to inherit a historical audit result');
  }

  const expectedIds = auditPacket.rows.map(row => row.auditRowId);
  if (!exactKeys(receipt.summary, ['total', 'PASS', 'FAIL', 'UNCERTAIN'])
    || receipt.summary.total !== expectedIds.length
    || receipt.summary.PASS !== expectedIds.length
    || receipt.summary.FAIL !== 0 || receipt.summary.UNCERTAIN !== 0
    || !Array.isArray(receipt.rows) || receipt.rows.length !== expectedIds.length) {
    fail('audit receipt is not an all-PASS result for every repaired candidate');
  }
  if (receipt.authority?.sourceBundleGatePassedForRepairedCandidates !== true
    || Object.entries(receipt.authority)
      .some(([key, value]) => key !== 'sourceBundleGatePassedForRepairedCandidates'
        && value !== false)) {
    fail('audit receipt claims authority it does not have');
  }

  const expected = new Set(expectedIds);
  const seen = new Set();
  for (const row of receipt.rows) {
    if (!exactKeys(row, ['auditRowId', 'disposition', 'reason'])
      || row.disposition !== 'PASS'
      || typeof row.reason !== 'string' || row.reason.trim() === ''
      || !expected.has(row.auditRowId) || seen.has(row.auditRowId)) {
      fail('audit rows are incomplete, stale, duplicated, or not all PASS');
    }
    seen.add(row.auditRowId);
  }
  if (seen.size !== expected.size) fail('audit receipt is missing an audit row');
  return { auditPacket, candidateSha256, candidate: JSON.parse(
    Buffer.from(canonicalInputs.repairCandidate).toString('utf8')) };
}

function buildRepairHumanReviewPacket(receipt,
  canonicalInputs = auditPacketBuilder.loadCanonicalInputs()) {
  const { auditPacket, candidateSha256, candidate } =
    validateAuditReceipt(receipt, canonicalInputs);

  const itemIds = candidate.items.map(row => row.itemId);
  if (JSON.stringify(itemIds) !== JSON.stringify([...AUTHORIZED_REPAIR_ITEM_IDS])
    || itemIds.some(itemId => AUTHORIZED_REJECT_ITEM_IDS.includes(itemId))) {
    fail('reviewed population is not exactly the 12 authorized repaired rows');
  }

  // Bundles come from the audited packet itself, so the reviewer necessarily sees byte-for-byte
  // what was source-audited. The full source episode is deliberately NOT carried over: the
  // HUMAN reviewer judges the selected visible bundle.
  const auditedBundles = new Map(auditPacket.rows.map(row => [row.auditRowId, row.selectedBundle]));
  const rows = candidate.items.map(item => {
    const auditRowId = auditPacketBuilder.opaqueAuditRowId(candidateSha256, item.itemId);
    const selectedBundle = auditedBundles.get(auditRowId);
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
    status: 'BLIND_PRIMARY_HUMAN_REVIEW_PACKET_NOT_RUN',
    reviewedRepairCandidate: {
      identity: candidate.name,
      rawSha256: candidateSha256,
    },
    rendererIdentity: RENDERER_IDENTITY,
    sourceAuditPrerequisite: {
      attemptId: receipt.attemptId,
      status: receipt.status,
      allRowsPassed: true,
    },
    rows,
  };
}

function loadAuditReceipt() {
  return JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', AUDIT_RECEIPT_FIXTURE), 'utf8'));
}

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== '--output' || !argv[1]) {
    throw new Error('Usage: --output <repair-human-review-packet.json>');
  }
  return { outputPath: argv[1] };
}

function writeRepairHumanReviewPacket(outputPath) {
  if (fs.existsSync(outputPath)) {
    throw new Error(`Existing output will not be overwritten: ${outputPath}`);
  }
  const packet = buildRepairHumanReviewPacket(loadAuditReceipt());
  const bytes = packetBytes(packet);
  fs.writeFileSync(outputPath, bytes, { flag: 'wx' });
  return { packet, rawSha256: sha256RawBytes(bytes) };
}

function main(argv = process.argv.slice(2)) {
  const { outputPath } = parseArgs(argv);
  const { rawSha256 } = writeRepairHumanReviewPacket(outputPath);
  process.stdout.write(`Built P1-B6 repair blind HUMAN review packet: ${outputPath}\n`);
  process.stdout.write(`Packet raw SHA-256: ${rawSha256}\n`);
  return 0;
}

module.exports = {
  AUDIT_ATTEMPT_ID,
  AUDIT_RECEIPT_FIXTURE,
  AUDIT_RECEIPT_IDENTITY,
  PACKET_IDENTITY,
  RAW_RESULT_FILENAME,
  RAW_RESULT_SHA256,
  REVIEW_ID_NAMESPACE,
  buildRepairHumanReviewPacket,
  loadAuditReceipt,
  main,
  opaqueReviewRowId,
  packetBytes,
  parseArgs,
  validateAuditReceipt,
  verifyRawResultArtifact,
  writeRepairHumanReviewPacket,
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`P1-B6 repair HUMAN review packet build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
