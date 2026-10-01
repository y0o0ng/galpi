#!/usr/bin/env node
'use strict';

// Blind fresh source/bundle completeness audit packet for the 7 batch-006 DEV / HELD top-up surfaces.
//
// The generic source-audit packet builder validates against the historical Exact56 catalog,
// which does not hold the v3 replacement skeletons batch-006 uses, so this builder follows the
// v3-era candidate builders: inputs pinned by raw SHA, the batch rebuilt byte-for-byte by its
// materializer, and rendering / protocol checks reused from the batch-002 repair builder.
//
// This step CONSTRUCTS the packet and nothing else: no audit, no disposition, no semantic
// review, no acceptance. The auditor runs later in a separate fresh session under the unchanged
// source-audit protocol.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { RENDERER_IDENTITY } = require('../lib/memory-inference-p1b6-surfaces');
const {
  PROTOCOL_IDENTITY,
  renderCandidateBundle,
  verifyProtocol,
} = require('./build-memory-inference-p1b6-surface-repair-source-audit-packet');
const materializer = require('./build-memory-inference-p1b6-batch-006');

const ROOT = path.resolve(__dirname, '..');
const PACKET_IDENTITY = 'xion-local-memory-inference-p1b6-batch-006-source-audit-packet-v1';
const PACKET_STATUS = 'BLIND_SOURCE_AUDIT_PACKET_NOT_RUN';
// Disjoint from every earlier P1-B6 audit namespace.
const AUDIT_ID_NAMESPACE = 'p1b6-b006-audit';
const FRESHNESS_CONTRACT = 'Every row requires a fresh judgment. These are fresh realizations under new IDs and no historical source-audit result carries forward to them.';
const EXPECTED_ROWS = 7;

const CANONICAL_INPUTS = Object.freeze({
  batch: Object.freeze({
    label: 'batch-006 surface batch',
    identity: 'xion-local-memory-inference-p1b6-surface-batch-006-v1',
    rawSha256: 'c058b752ca9a353ffc10475cf9d74796e3682f4084cfd06b7164851922724e64',
    fixture: 'local-memory-inference-p1b6-surface-batch-006.json',
  }),
  sourceAuditProtocol: Object.freeze({
    label: 'source-audit protocol',
    identity: 'xion-local-memory-inference-p1b6-source-audit-protocol-v1',
    rawSha256: '63a2c70c3af608d60fb817f092e16c62986b1b5ba09a6d19300fa34e24582a1d',
    fixture: 'local-memory-inference-p1b6-source-audit-protocol.json',
  }),
});

function fail(message) {
  throw new TypeError(`P1-B6 batch-006 source-audit packet ${message}`);
}

function verifyCanonicalInput(key, rawBytes) {
  const pinned = CANONICAL_INPUTS[key];
  if (!Buffer.isBuffer(rawBytes)) fail(`${pinned.label} bytes were not supplied`);
  if (sha256RawBytes(rawBytes) !== pinned.rawSha256) fail(`${pinned.label} bytes are not the canonical evidence`);
  const artifact = JSON.parse(rawBytes.toString('utf8'));
  if (artifact.name !== pinned.identity) fail(`${pinned.label} identity is not canonical`);
  return artifact;
}

function opaqueAuditRowId(batchSha256, itemId) {
  const digest = crypto.createHash('sha256')
    .update(`${AUDIT_ID_NAMESPACE}\0${PACKET_IDENTITY}\0${PROTOCOL_IDENTITY}\0${batchSha256}\0${itemId}`)
    .digest('hex').slice(0, 16);
  return `${AUDIT_ID_NAMESPACE}-${digest}`;
}

function buildSourceAuditPacket(canonicalInputs) {
  if (!canonicalInputs || typeof canonicalInputs !== 'object') fail('canonical input bytes were not supplied');
  const batch = verifyCanonicalInput('batch', canonicalInputs.batch);
  const protocol = verifyProtocol(canonicalInputs.sourceAuditProtocol);
  // The batch must be exactly what the materializer produces, not a lookalike.
  if (!materializer.artifactBytes(materializer.buildAll().batch).equals(canonicalInputs.batch)) {
    fail('batch is not the deterministic output of the batch-006 materializer');
  }
  if (batch.items.length !== EXPECTED_ROWS) fail(`batch does not hold exactly ${EXPECTED_ROWS} items`);

  const batchSha256 = CANONICAL_INPUTS.batch.rawSha256;
  const episodes = new Map(batch.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  return {
    name: PACKET_IDENTITY,
    status: PACKET_STATUS,
    sourceBatch: { identity: batch.name, batchId: batch.batchId, rawSha256: batchSha256 },
    sourceAuditProtocol: {
      artifactIdentity: protocol.name,
      identity: protocol.protocolIdentity,
      rawSha256: CANONICAL_INPUTS.sourceAuditProtocol.rawSha256,
    },
    rendererIdentity: RENDERER_IDENTITY,
    freshnessContract: FRESHNESS_CONTRACT,
    rows: batch.items.map(item => ({
      auditRowId: opaqueAuditRowId(batchSha256, item.itemId),
      sourceEpisode: { turns: episodes.get(item.sourceEpisodeId).turns.map(turn => ({ ...turn })) },
      selectedBundle: renderCandidateBundle(batch, item),
    })).sort((left, right) => (left.auditRowId < right.auditRowId ? -1 : 1)),
  };
}

const RECEIPT_FIXTURE = 'local-memory-inference-p1b6-batch-006-source-audit-attempt-001.json';
const RAW_RESULT_FILENAME = 'p1b6-b006-source-audit-results.json';

// Builds the audit receipt from the raw result bytes, against the rebuilt packet. FAIL /
// UNCERTAIN rows are mapped back to their items mechanically so the next gate can exclude them.
function buildSourceAuditReceipt(rawResultBytes, canonicalInputs = loadCanonicalInputs()) {
  const packet = buildSourceAuditPacket(canonicalInputs);
  const parsed = JSON.parse(Buffer.from(rawResultBytes).toString('utf8'));
  if (!parsed || JSON.stringify(Object.keys(parsed)) !== '["results"]' || !Array.isArray(parsed.results)) {
    fail('result artifact must be an object whose only key is results');
  }
  const ids = packet.rows.map(row => row.auditRowId);
  if (JSON.stringify(parsed.results.map(row => row.auditRowId).toSorted()) !== JSON.stringify(ids)) {
    fail('result rows are not exactly the packet rows');
  }
  for (const row of parsed.results) {
    if (JSON.stringify(Object.keys(row).toSorted()) !== '["auditRowId","disposition","reason"]'
      || !['PASS', 'FAIL', 'UNCERTAIN'].includes(row.disposition)
      || typeof row.reason !== 'string' || row.reason.trim() === '') {
      fail(`result row is malformed: ${row.auditRowId}`);
    }
  }
  const rows = parsed.results.map(row => ({ ...row }))
    .toSorted((a, b) => (a.auditRowId < b.auditRowId ? -1 : 1));
  const count = disposition => rows.filter(row => row.disposition === disposition).length;
  const batch = JSON.parse(canonicalInputs.batch.toString('utf8'));
  const itemFor = new Map(batch.items.map(item => [opaqueAuditRowId(CANONICAL_INPUTS.batch.rawSha256, item.itemId), item.itemId]));
  const allPass = count('PASS') === rows.length;
  return {
    name: 'xion-local-memory-inference-p1b6-batch-006-source-audit-attempt-001-receipt-v1',
    attemptId: 'p1b6-batch-006-source-audit-attempt-001',
    status: allPass ? 'COMPLETE_PASS' : 'COMPLETE_NEEDS_FIX',
    auditPacketIdentity: PACKET_IDENTITY,
    auditPacketSha256: sha256RawBytes(packetBytes(packet)),
    sourceAuditProtocol: { identity: packet.sourceAuditProtocol.identity, sha256: CANONICAL_INPUTS.sourceAuditProtocol.rawSha256 },
    auditedBatch: { identity: packet.sourceBatch.identity, rawSha256: CANONICAL_INPUTS.batch.rawSha256 },
    rawResultArtifact: { filename: RAW_RESULT_FILENAME, sha256: sha256RawBytes(rawResultBytes), committed: false },
    auditorExecutionProvenance: {
      evidenceBasis: 'REPORTED_BY_REPOSITORY_OWNER',
      surface: 'Claude Code',
      model: 'Claude Opus 5.5',
      reasoningSetting: 'NOT_RECORDED',
      sessionRelationship: 'a fresh Claude Code CLI session started in the home directory (no project instructions or memory loaded), separate from the session that authored the surfaces, given only the protocol and packet paths',
    },
    freshness: {
      freshJudgmentsForEveryRow: true,
      historicalSourceAuditResultInherited: false,
      note: 'Fresh realizations under new IDs; no historical source-audit result carried forward.',
    },
    summary: { total: rows.length, PASS: count('PASS'), FAIL: count('FAIL'), UNCERTAIN: count('UNCERTAIN') },
    failClosedRows: rows.filter(row => row.disposition !== 'PASS')
      .map(row => ({ auditRowId: row.auditRowId, itemId: itemFor.get(row.auditRowId), disposition: row.disposition })),
    authority: {
      sourceBundleGatePassedForPassRows: true,
      failClosedRowsExcludedFromSemanticReview: true,
      semanticReviewOccurred: false,
      humanReviewOccurred: false,
      datasetAcceptancePerformed: false,
      heldOutReleasePerformed: false,
      trainingOccurred: false,
    },
    rows,
  };
}

function loadCanonicalInputs() {
  return Object.fromEntries(Object.entries(CANONICAL_INPUTS)
    .map(([key, pinned]) => [key, fs.readFileSync(path.join(ROOT, 'fixtures', pinned.fixture))]));
}

function packetBytes(packet) {
  return Buffer.from(`${JSON.stringify(packet, null, 2)}\n`, 'utf8');
}

function main(argv = process.argv.slice(2)) {
  if (argv.length === 2 && argv[0] === '--results' && argv[1]) {
    const output = path.join(ROOT, 'fixtures', RECEIPT_FIXTURE);
    if (fs.existsSync(output)) throw new Error(`Existing output will not be overwritten: ${output}`);
    const receipt = buildSourceAuditReceipt(fs.readFileSync(argv[1]));
    fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`Recorded source audit: ${JSON.stringify(receipt.summary)} -> fixtures/${RECEIPT_FIXTURE}\n`);
    return 0;
  }
  if (argv.length !== 2 || argv[0] !== '--output' || !argv[1]) {
    throw new Error('Usage: --output <packet.json> | --results <raw-results.json>');
  }
  if (fs.existsSync(argv[1])) throw new Error(`Existing output will not be overwritten: ${argv[1]}`);
  const bytes = packetBytes(buildSourceAuditPacket(loadCanonicalInputs()));
  fs.writeFileSync(argv[1], bytes, { flag: 'wx' });
  process.stdout.write(`Built P1-B6 batch-006 source-audit packet: ${argv[1]}\n`);
  process.stdout.write(`Packet raw SHA-256: ${sha256RawBytes(bytes)}\n`);
  return 0;
}

module.exports = {
  AUDIT_ID_NAMESPACE,
  CANONICAL_INPUTS,
  EXPECTED_ROWS,
  PACKET_IDENTITY,
  RECEIPT_FIXTURE,
  buildSourceAuditPacket,
  buildSourceAuditReceipt,
  loadCanonicalInputs,
  main,
  opaqueAuditRowId,
  packetBytes,
};

if (require.main === module) process.exit(main());
