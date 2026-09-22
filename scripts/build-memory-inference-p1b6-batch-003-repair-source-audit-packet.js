#!/usr/bin/env node
'use strict';

// Blind fresh source/bundle completeness audit packet for the two repaired batch-003 surface
// candidates (162, 214).
//
// This step CONSTRUCTS the packet and nothing else: no audit, no disposition, no HUMAN packet,
// no acceptance. The auditor runs later in a separate fresh session under the unchanged
// protocol. The repaired text is new evidence, so both rows need fresh judgments.
//
// Rendering and the protocol check are imported from the historical batch-002 repair builder,
// which is not modified; only the inputs, the row contract and the ID namespace are new.

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
const resolution = require('./build-memory-inference-p1b6-batch-003-repair-candidate');
const { artifactBytes } = require('./build-memory-inference-p1b6-skeleton-semantic-contract-v2');

const ROOT = path.resolve(__dirname, '..');
const PACKET_IDENTITY =
  'xion-local-memory-inference-p1b6-batch-003-repair-source-audit-packet-v1';
const PACKET_STATUS = 'BLIND_SOURCE_AUDIT_PACKET_NOT_RUN';
// Disjoint from the historical `p1b6-audit-` and batch-002 `p1b6-repair-audit-` namespaces.
const AUDIT_ID_NAMESPACE = 'p1b6-b003-repair-audit';
const FRESHNESS_CONTRACT = 'Every row requires a fresh judgment. The repaired source text is new evidence and no historical batch-003 source-audit result carries forward to it.';
const EXPECTED_ITEM_IDS = Object.freeze(['p1b6-item-b003-162', 'p1b6-item-b003-214']);

const CANONICAL_INPUTS = Object.freeze({
  repairCandidate: Object.freeze({
    label: 'batch-003 repair candidate',
    identity: 'xion-local-memory-inference-p1b6-surface-repair-candidate-batch-003-v1',
    rawSha256: '8f6254946eef8d8d0920485bde431ca137a83577a5060889f3676b8857b4aa9b',
    fixture: 'local-memory-inference-p1b6-surface-repair-candidate-batch-003.json',
  }),
  resolutionReceipt: Object.freeze({
    label: 'batch-003 resolution receipt',
    identity: 'xion-local-memory-inference-p1b6-batch-003-resolution-receipt-v1',
    rawSha256: '61c29218a360bf914c6453758c7fc243e629f1b5d400e38426d9d18720cb1ffe',
    fixture: 'local-memory-inference-p1b6-batch-003-resolution-receipt.json',
  }),
  semanticAuthority: Object.freeze({
    label: 'semantic authority v3',
    identity: 'xion-local-memory-inference-p1b6-skeleton-effective-current-v3',
    rawSha256: '89a48264d6b09710f976a4ab85235ff161cf81ff44896e37553d5dc7753c65b9',
    fixture: 'local-memory-inference-p1b6-skeleton-effective-current-v3.json',
  }),
  sourceAuditProtocol: Object.freeze({
    label: 'source-audit protocol',
    identity: 'xion-local-memory-inference-p1b6-source-audit-protocol-v1',
    rawSha256: '63a2c70c3af608d60fb817f092e16c62986b1b5ba09a6d19300fa34e24582a1d',
    fixture: 'local-memory-inference-p1b6-source-audit-protocol.json',
  }),
});

function fail(message) {
  throw new TypeError(`P1-B6 batch-003 repair source-audit packet ${message}`);
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

function opaqueAuditRowId(candidateSha256, itemId) {
  const digest = crypto.createHash('sha256')
    .update(`${AUDIT_ID_NAMESPACE}\0${PACKET_IDENTITY}\0${PROTOCOL_IDENTITY}\0${candidateSha256}\0${itemId}`)
    .digest('hex').slice(0, 16);
  return `${AUDIT_ID_NAMESPACE}-${digest}`;
}

function buildRepairSourceAuditPacket(canonicalInputs) {
  if (!canonicalInputs || typeof canonicalInputs !== 'object') {
    fail('canonical input bytes were not supplied');
  }
  const candidate = verifyCanonicalInput('repairCandidate', canonicalInputs.repairCandidate);
  const receipt = verifyCanonicalInput('resolutionReceipt', canonicalInputs.resolutionReceipt);
  const authority = verifyCanonicalInput('semanticAuthority', canonicalInputs.semanticAuthority);
  const protocol = verifyProtocol(canonicalInputs.sourceAuditProtocol);

  if (candidate.provenance.resolutionReceipt.identity !== receipt.name
    || candidate.provenance.resolutionReceipt.rawSha256
      !== CANONICAL_INPUTS.resolutionReceipt.rawSha256
    || candidate.provenance.semanticAuthority.identity !== authority.name
    || candidate.provenance.semanticAuthority.rawSha256
      !== CANONICAL_INPUTS.semanticAuthority.rawSha256) {
    fail('candidate provenance does not bind the canonical resolution receipt and v3 authority');
  }
  // The candidate must be exactly what the batch-003 repair contract produces from these
  // inputs, not merely a plausible-looking artifact that happens to carry the pinned SHA.
  const rebuilt = resolution.buildRepairCandidate(canonicalInputs.resolutionReceipt,
    { ...resolution.loadSources(), v3: canonicalInputs.semanticAuthority });
  if (!artifactBytes(rebuilt).equals(Buffer.from(canonicalInputs.repairCandidate))) {
    fail('candidate is not the deterministic output of the batch-003 repair contract');
  }
  if (JSON.stringify(candidate.items.map(row => row.itemId))
    !== JSON.stringify([...EXPECTED_ITEM_IDS])) {
    fail('candidate does not hold exactly items 162 and 214');
  }

  const candidateSha256 = CANONICAL_INPUTS.repairCandidate.rawSha256;
  const episodes = new Map(candidate.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  return {
    name: PACKET_IDENTITY,
    status: PACKET_STATUS,
    repairCandidate: { identity: candidate.name, rawSha256: candidateSha256 },
    resolutionReceipt: { identity: receipt.name, rawSha256: CANONICAL_INPUTS.resolutionReceipt.rawSha256 },
    semanticAuthority: { identity: authority.name, rawSha256: CANONICAL_INPUTS.semanticAuthority.rawSha256 },
    sourceAuditProtocol: {
      artifactIdentity: protocol.name,
      identity: protocol.protocolIdentity,
      rawSha256: CANONICAL_INPUTS.sourceAuditProtocol.rawSha256,
    },
    rendererIdentity: RENDERER_IDENTITY,
    freshnessContract: FRESHNESS_CONTRACT,
    rows: candidate.items.map(item => ({
      auditRowId: opaqueAuditRowId(candidateSha256, item.itemId),
      sourceEpisode: {
        turns: episodes.get(item.sourceEpisodeId).turns.map(turn => ({ ...turn })),
      },
      selectedBundle: renderCandidateBundle(candidate, item),
    })),
  };
}

function loadCanonicalInputs() {
  return Object.fromEntries(Object.entries(CANONICAL_INPUTS)
    .map(([key, pinned]) => [key, fs.readFileSync(path.join(ROOT, 'fixtures', pinned.fixture))]));
}

function packetBytes(packet) {
  return Buffer.from(`${JSON.stringify(packet, null, 2)}\n`, 'utf8');
}

function writeRepairSourceAuditPacket(outputPath) {
  if (fs.existsSync(outputPath)) {
    throw new Error(`Existing output will not be overwritten: ${outputPath}`);
  }
  const bytes = packetBytes(buildRepairSourceAuditPacket(loadCanonicalInputs()));
  fs.writeFileSync(outputPath, bytes, { flag: 'wx' });
  return sha256RawBytes(bytes);
}

function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2 || argv[0] !== '--output' || !argv[1]) {
    throw new Error('Usage: --output <batch-003-repair-source-audit-packet.json>');
  }
  const rawSha256 = writeRepairSourceAuditPacket(argv[1]);
  process.stdout.write(`Built P1-B6 batch-003 repair source-audit packet: ${argv[1]}\n`);
  process.stdout.write(`Packet raw SHA-256: ${rawSha256}\n`);
  return 0;
}

module.exports = {
  AUDIT_ID_NAMESPACE,
  CANONICAL_INPUTS,
  EXPECTED_ITEM_IDS,
  PACKET_IDENTITY,
  PACKET_STATUS,
  buildRepairSourceAuditPacket,
  loadCanonicalInputs,
  main,
  opaqueAuditRowId,
  packetBytes,
  writeRepairSourceAuditPacket,
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`P1-B6 batch-003 repair source-audit packet build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
