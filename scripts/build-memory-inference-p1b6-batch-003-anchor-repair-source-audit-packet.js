#!/usr/bin/env node
'use strict';

// Blind fresh source/bundle completeness audit packet for the five anchor-only repair candidates
// on aebbf047 (batch-003 224-228). Only the TARGET marker moved, so the historical audit result
// was about a different bundle and does not carry forward.
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
const authoring = require('./build-memory-inference-p1b6-batch-003-anchor-quality-resolution');

const ROOT = path.resolve(__dirname, '..');
const PACKET_IDENTITY = 'xion-local-memory-inference-p1b6-batch-003-anchor-repair-source-audit-packet-v1';
const PACKET_STATUS = 'BLIND_SOURCE_AUDIT_PACKET_NOT_RUN';
// Disjoint from every earlier P1-B6 audit namespace.
const AUDIT_ID_NAMESPACE = 'p1b6-b003-anchor-audit';
const FRESHNESS_CONTRACT = 'Every row requires a fresh judgment. The TARGET marker moved, so these are new bundles and no historical batch-003 source-audit result carries forward to them.';
const EXPECTED_ITEM_IDS = Object.freeze(['224', '225', '226', '227', '228'].map(n => `p1b6-item-b003-${n}`));

const CANONICAL_INPUTS = Object.freeze({
  candidate: Object.freeze({
    label: 'anchor repair candidate',
    identity: 'xion-local-memory-inference-p1b6-surface-anchor-repair-candidate-batch-003-v1',
    rawSha256: '19eea01def0a05c32c1ceb236fa97305e7b29822c9e56b70cc0331f3a873599f',
    fixture: 'local-memory-inference-p1b6-surface-anchor-repair-candidate-batch-003.json',
  }),
  sourceAuditProtocol: Object.freeze({
    label: 'source-audit protocol',
    identity: 'xion-local-memory-inference-p1b6-source-audit-protocol-v1',
    rawSha256: '63a2c70c3af608d60fb817f092e16c62986b1b5ba09a6d19300fa34e24582a1d',
    fixture: 'local-memory-inference-p1b6-source-audit-protocol.json',
  }),
});

function fail(message) {
  throw new TypeError(`P1-B6 batch-003 anchor-repair source-audit packet ${message}`);
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
  const protocol = verifyProtocol(canonicalInputs.sourceAuditProtocol);
  // The candidate must be exactly what the anchor-quality builder produces, not a lookalike.
  const rebuilt = authoring.buildArtifacts(authoring.verifySources(authoring.loadSources())).candidate;
  if (!authoring.artifactBytes(rebuilt).equals(canonicalInputs.candidate)) {
    fail('candidate is not the deterministic output of the anchor-quality builder');
  }
  if (JSON.stringify(candidate.items.map(row => row.itemId)) !== JSON.stringify([...EXPECTED_ITEM_IDS])) {
    fail('candidate does not hold exactly items 224-228');
  }

  const candidateSha256 = CANONICAL_INPUTS.candidate.rawSha256;
  const episodes = new Map(candidate.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  return {
    name: PACKET_IDENTITY,
    status: PACKET_STATUS,
    candidate: { identity: candidate.name, rawSha256: candidateSha256 },
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

const RECEIPT_FIXTURE = 'local-memory-inference-p1b6-batch-003-anchor-repair-source-audit-attempt-001.json';
const RAW_RESULT_FILENAME = 'p1b6-b003-anchor-source-audit-results.json';

// Builds the audit receipt from the raw result bytes, against the rebuilt packet.
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
  const allPass = count('PASS') === rows.length;
  return {
    name: 'xion-local-memory-inference-p1b6-batch-003-anchor-repair-source-audit-attempt-001-receipt-v1',
    attemptId: 'p1b6-batch-003-anchor-repair-source-audit-attempt-001',
    status: allPass ? 'COMPLETE_PASS' : 'COMPLETE_NEEDS_FIX',
    auditPacketIdentity: PACKET_IDENTITY,
    auditPacketSha256: sha256RawBytes(packetBytes(packet)),
    sourceAuditProtocol: { identity: packet.sourceAuditProtocol.identity, sha256: CANONICAL_INPUTS.sourceAuditProtocol.rawSha256 },
    auditedCandidate: { identity: packet.candidate.identity, rawSha256: CANONICAL_INPUTS.candidate.rawSha256 },
    rawResultArtifact: { filename: RAW_RESULT_FILENAME, sha256: sha256RawBytes(rawResultBytes), committed: false },
    auditorExecutionProvenance: {
      evidenceBasis: 'REPORTED_BY_REPOSITORY_OWNER',
      surface: 'Claude Code',
      model: 'Claude Opus 5.5',
      reasoningSetting: 'NOT_RECORDED',
      sessionRelationship: 'a fresh Claude Code CLI session started in the home directory (no project instructions or memory loaded), separate from the session that reanchored the candidates, given only the protocol and packet paths',
    },
    freshness: {
      freshJudgmentsForEveryRow: true,
      historicalSourceAuditResultInherited: false,
      note: 'The TARGET marker moved, so the bundles are new; no historical batch-003 source-audit result carried forward.',
    },
    summary: { total: rows.length, PASS: count('PASS'), FAIL: count('FAIL'), UNCERTAIN: count('UNCERTAIN') },
    authority: {
      sourceBundleGatePassedForCandidates: allPass,
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
  process.stdout.write(`Built P1-B6 batch-003 anchor-repair source-audit packet: ${argv[1]}\n`);
  process.stdout.write(`Packet raw SHA-256: ${sha256RawBytes(bytes)}\n`);
  return 0;
}

module.exports = {
  AUDIT_ID_NAMESPACE,
  CANONICAL_INPUTS,
  EXPECTED_ITEM_IDS,
  PACKET_IDENTITY,
  RECEIPT_FIXTURE,
  buildSourceAuditPacket,
  buildSourceAuditReceipt,
  loadCanonicalInputs,
  main,
  opaqueAuditRowId,
  packetBytes,
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`P1-B6 batch-003 anchor-repair source-audit packet build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
