#!/usr/bin/env node
'use strict';

// Blind fresh source/bundle completeness audit packet for the 41 batch-004 top-up surfaces.
//
// The generic source-audit packet builder validates against the historical Exact56 catalog,
// which does not hold the v3 replacement skeletons batch-004 uses, so this builder follows the
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
const materializer = require('./build-memory-inference-p1b6-batch-004-materialize');

const ROOT = path.resolve(__dirname, '..');
const PACKET_IDENTITY = 'xion-local-memory-inference-p1b6-batch-004-source-audit-packet-v1';
const PACKET_STATUS = 'BLIND_SOURCE_AUDIT_PACKET_NOT_RUN';
// Disjoint from every earlier P1-B6 audit namespace.
const AUDIT_ID_NAMESPACE = 'p1b6-b004-audit';
const FRESHNESS_CONTRACT = 'Every row requires a fresh judgment. These are fresh realizations under new IDs and no historical source-audit result carries forward to them.';
const EXPECTED_ROWS = 41;

const CANONICAL_INPUTS = Object.freeze({
  batch: Object.freeze({
    label: 'batch-004 surface batch',
    identity: 'xion-local-memory-inference-p1b6-surface-batch-004-v1',
    rawSha256: 'f640198f9d472c00046b8cb22083407b12887534bf0544cd808620691c5bc0c1',
    fixture: 'local-memory-inference-p1b6-surface-batch-004.json',
  }),
  sourceAuditProtocol: Object.freeze({
    label: 'source-audit protocol',
    identity: 'xion-local-memory-inference-p1b6-source-audit-protocol-v1',
    rawSha256: '63a2c70c3af608d60fb817f092e16c62986b1b5ba09a6d19300fa34e24582a1d',
    fixture: 'local-memory-inference-p1b6-source-audit-protocol.json',
  }),
});

function fail(message) {
  throw new TypeError(`P1-B6 batch-004 source-audit packet ${message}`);
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
    fail('batch is not the deterministic output of the batch-004 materializer');
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

function loadCanonicalInputs() {
  return Object.fromEntries(Object.entries(CANONICAL_INPUTS)
    .map(([key, pinned]) => [key, fs.readFileSync(path.join(ROOT, 'fixtures', pinned.fixture))]));
}

function packetBytes(packet) {
  return Buffer.from(`${JSON.stringify(packet, null, 2)}\n`, 'utf8');
}

function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2 || argv[0] !== '--output' || !argv[1]) throw new Error('Usage: --output <packet.json>');
  if (fs.existsSync(argv[1])) throw new Error(`Existing output will not be overwritten: ${argv[1]}`);
  const bytes = packetBytes(buildSourceAuditPacket(loadCanonicalInputs()));
  fs.writeFileSync(argv[1], bytes, { flag: 'wx' });
  process.stdout.write(`Built P1-B6 batch-004 source-audit packet: ${argv[1]}\n`);
  process.stdout.write(`Packet raw SHA-256: ${sha256RawBytes(bytes)}\n`);
  return 0;
}

module.exports = {
  AUDIT_ID_NAMESPACE,
  CANONICAL_INPUTS,
  EXPECTED_ROWS,
  PACKET_IDENTITY,
  buildSourceAuditPacket,
  loadCanonicalInputs,
  main,
  opaqueAuditRowId,
  packetBytes,
};

if (require.main === module) process.exit(main());
