#!/usr/bin/env node
'use strict';

// Blind fresh source/bundle completeness audit packet for the two TARGET-boundary
// proof-of-realizability candidates (tb1-001, tb1-002).
//
// This step CONSTRUCTS the packet and nothing else: no audit, no disposition, no semantic
// review, no acceptance. The auditor runs later in a separate fresh session under the unchanged
// source-audit protocol. Rendering and the protocol check are reused from the batch-002 repair
// builder; only the inputs and the ID namespace are new.

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
const resolution = require('./build-memory-inference-p1b6-batch-003-target-boundary-resolution');

const ROOT = path.resolve(__dirname, '..');
const PACKET_IDENTITY = 'xion-local-memory-inference-p1b6-target-boundary-source-audit-packet-v1';
const PACKET_STATUS = 'BLIND_SOURCE_AUDIT_PACKET_NOT_RUN';
// Disjoint from every earlier P1-B6 audit namespace.
const AUDIT_ID_NAMESPACE = 'p1b6-tb1-audit';
const FRESHNESS_CONTRACT = 'Every row requires a fresh judgment. These are fresh realizations under new IDs and no historical source-audit result carries forward to them.';
const EXPECTED_ITEM_IDS = Object.freeze(['p1b6-item-tb1-001', 'p1b6-item-tb1-002']);

const CANONICAL_INPUTS = Object.freeze({
  candidate: Object.freeze({
    label: 'TARGET-boundary candidate',
    identity: 'xion-local-memory-inference-p1b6-surface-target-boundary-candidate-v1',
    rawSha256: '5a4253506a9a9885118781c68cdcc407d91b6497b4b1af2105a675332ef8a7f5',
    fixture: 'local-memory-inference-p1b6-surface-target-boundary-candidate.json',
  }),
  resolutionReceipt: Object.freeze({
    label: 'TARGET-boundary resolution receipt',
    identity: 'xion-local-memory-inference-p1b6-batch-003-target-boundary-resolution-receipt-v1',
    rawSha256: '614ba543e99b765eafe82f5ebaa59dd0f015c5e0d53f5342ad93b28122c91254',
    fixture: 'local-memory-inference-p1b6-batch-003-target-boundary-resolution-receipt.json',
  }),
  sourceAuditProtocol: Object.freeze({
    label: 'source-audit protocol',
    identity: 'xion-local-memory-inference-p1b6-source-audit-protocol-v1',
    rawSha256: '63a2c70c3af608d60fb817f092e16c62986b1b5ba09a6d19300fa34e24582a1d',
    fixture: 'local-memory-inference-p1b6-source-audit-protocol.json',
  }),
});

function fail(message) {
  throw new TypeError(`P1-B6 TARGET-boundary source-audit packet ${message}`);
}

function verifyCanonicalInput(key, rawBytes) {
  const pinned = CANONICAL_INPUTS[key];
  if (!Buffer.isBuffer(rawBytes)) fail(`${pinned.label} bytes were not supplied`);
  if (sha256RawBytes(rawBytes) !== pinned.rawSha256) fail(`${pinned.label} bytes are not the canonical evidence`);
  const artifact = JSON.parse(rawBytes.toString('utf8'));
  if (artifact.name !== pinned.identity) fail(`${pinned.label} identity is not canonical`);
  return artifact;
}

function opaqueAuditRowId(candidateSha256, itemId) {
  const digest = crypto.createHash('sha256')
    .update(`${AUDIT_ID_NAMESPACE}\0${PACKET_IDENTITY}\0${PROTOCOL_IDENTITY}\0${candidateSha256}\0${itemId}`)
    .digest('hex').slice(0, 16);
  return `${AUDIT_ID_NAMESPACE}-${digest}`;
}

function buildSourceAuditPacket(canonicalInputs) {
  if (!canonicalInputs || typeof canonicalInputs !== 'object') fail('canonical input bytes were not supplied');
  const candidate = verifyCanonicalInput('candidate', canonicalInputs.candidate);
  const receipt = verifyCanonicalInput('resolutionReceipt', canonicalInputs.resolutionReceipt);
  const protocol = verifyProtocol(canonicalInputs.sourceAuditProtocol);
  if (candidate.provenance.resolutionReceipt !== receipt.name) {
    fail('candidate does not name the canonical resolution receipt');
  }
  // The candidate must be exactly what the resolution builder produces, not a lookalike.
  const rebuilt = resolution.buildCandidate(resolution.verifySources(resolution.loadSources()));
  if (!resolution.artifactBytes(rebuilt).equals(canonicalInputs.candidate)) {
    fail('candidate is not the deterministic output of the TARGET-boundary builder');
  }
  if (JSON.stringify(candidate.items.map(row => row.itemId)) !== JSON.stringify([...EXPECTED_ITEM_IDS])) {
    fail('candidate does not hold exactly tb1-001 and tb1-002');
  }

  const candidateSha256 = CANONICAL_INPUTS.candidate.rawSha256;
  const episodes = new Map(candidate.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  return {
    name: PACKET_IDENTITY,
    status: PACKET_STATUS,
    candidate: { identity: candidate.name, rawSha256: candidateSha256 },
    resolutionReceipt: { identity: receipt.name, rawSha256: CANONICAL_INPUTS.resolutionReceipt.rawSha256 },
    sourceAuditProtocol: {
      artifactIdentity: protocol.name,
      identity: protocol.protocolIdentity,
      rawSha256: CANONICAL_INPUTS.sourceAuditProtocol.rawSha256,
    },
    rendererIdentity: RENDERER_IDENTITY,
    freshnessContract: FRESHNESS_CONTRACT,
    rows: candidate.items.map(item => ({
      auditRowId: opaqueAuditRowId(candidateSha256, item.itemId),
      sourceEpisode: { turns: episodes.get(item.sourceEpisodeId).turns.map(turn => ({ ...turn })) },
      selectedBundle: renderCandidateBundle(candidate, item),
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
  if (argv.length !== 2 || argv[0] !== '--output' || !argv[1]) {
    throw new Error('Usage: --output <target-boundary-source-audit-packet.json>');
  }
  if (fs.existsSync(argv[1])) throw new Error(`Existing output will not be overwritten: ${argv[1]}`);
  const bytes = packetBytes(buildSourceAuditPacket(loadCanonicalInputs()));
  fs.writeFileSync(argv[1], bytes, { flag: 'wx' });
  process.stdout.write(`Built P1-B6 TARGET-boundary source-audit packet: ${argv[1]}\n`);
  process.stdout.write(`Packet raw SHA-256: ${sha256RawBytes(bytes)}\n`);
  return 0;
}

module.exports = {
  AUDIT_ID_NAMESPACE,
  CANONICAL_INPUTS,
  EXPECTED_ITEM_IDS,
  PACKET_IDENTITY,
  buildSourceAuditPacket,
  loadCanonicalInputs,
  main,
  opaqueAuditRowId,
  packetBytes,
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`P1-B6 TARGET-boundary source-audit packet build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
