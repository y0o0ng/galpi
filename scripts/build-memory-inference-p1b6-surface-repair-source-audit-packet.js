#!/usr/bin/env node
'use strict';

// Blind fresh source/bundle completeness audit packet for the 12 repaired batch-002 surface
// candidates.
//
// This step CONSTRUCTS the packet and nothing else. It assigns no disposition, performs no
// audit, creates no HUMAN label, accepts no row, freezes no gold, releases no HELD_OUT, and
// trains nothing. The auditor runs later in a separate fresh strong-model session under the
// unchanged protocol at fixtures/local-memory-inference-p1b6-source-audit-protocol.json.
//
// The repaired source text is new evidence, so all 12 rows require FRESH judgments. No
// historical batch-002 source-audit PASS carries forward, and the opaque audit IDs live in a
// namespace of their own so a historical row ID can never be mistaken for a repaired one.
//
// The historical packet builder validates the four-key surface-batch shape through
// validateSurfaceBatch(). The repair candidate is deliberately a different artifact with its
// own provenance/status/authority contract, so this builder is narrow: it reuses the already
// hardened candidate validator and the shared low-level span primitives, and leaves
// lib/memory-inference-p1b6-surfaces.js pointed at the historical contract.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { TextDecoder } = require('node:util');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const {
  RENDERER_IDENTITY,
  computeFragments,
} = require('../lib/memory-inference-p1b6-surfaces');
const {
  AUTHORIZED_REJECT_ITEM_IDS,
  AUTHORIZED_REPAIR_ITEM_IDS,
  validateRepairCandidateBatch,
} = require('./build-memory-inference-p1b6-surface-repair-candidate');

const ROOT = path.resolve(__dirname, '..');
const PACKET_IDENTITY =
  'xion-local-memory-inference-p1b6-surface-repair-source-audit-packet-batch-002-v1';
const PACKET_STATUS = 'BLIND_SOURCE_AUDIT_PACKET_NOT_RUN';
const PROTOCOL_IDENTITY = 'p1b6-source-bundle-completeness-audit-v1';
// The opaque IDs are namespaced by this label, so they can never collide with the historical
// `p1b6-audit-` namespace even if every other hash input somehow matched.
const AUDIT_ID_NAMESPACE = 'p1b6-repair-audit';
const FRESHNESS_CONTRACT = 'Every row requires a fresh judgment. The repaired source text is new evidence and no historical batch-002 source-audit result carries forward to it.';

// Every canonical input is pinned by identity AND raw SHA, verified against the supplied bytes
// before anything is derived, so coordinated drift of a source plus a binding fails closed and
// whatever happens to be on disk never defines "canonical".
const CANONICAL_INPUTS = Object.freeze({
  repairCandidate: Object.freeze({
    label: 'repair candidate batch-002',
    identity: 'xion-local-memory-inference-p1b6-surface-repair-candidate-batch-002-v1',
    rawSha256: 'd59d0dec225d3f4fea74952da10e05b8f0be01942a3aa6e15ea58d659e22abb3',
    fixture: 'local-memory-inference-p1b6-surface-repair-candidate-batch-002.json',
  }),
  resolutionReceipt: Object.freeze({
    label: 'Phase B resolution receipt',
    identity: 'xion-local-memory-inference-p1b6-surface-repair-resolution-batch-002-receipt-v1',
    rawSha256: '792cb050b08375fd6dec9e8ce2b1a04787760123496b3dfed601aac984f4626d',
    fixture: 'local-memory-inference-p1b6-surface-repair-resolution-batch-002-receipt.json',
  }),
  effectiveCatalog: Object.freeze({
    label: 'effective-current skeleton catalog',
    identity: 'xion-local-memory-inference-p1b6-skeleton-effective-current-v1',
    rawSha256: '48490b6e4e1494856ef3268d944da16093c4735d207e07c1fd9e8bbf69df2559',
    fixture: 'local-memory-inference-p1b6-skeleton-effective-current.json',
  }),
  sourceAuditProtocol: Object.freeze({
    label: 'source-audit protocol',
    identity: 'xion-local-memory-inference-p1b6-source-audit-protocol-v1',
    rawSha256: '63a2c70c3af608d60fb817f092e16c62986b1b5ba09a6d19300fa34e24582a1d',
    fixture: 'local-memory-inference-p1b6-source-audit-protocol.json',
  }),
});

const decoder = new TextDecoder('utf-8', { fatal: true });

function fail(message) {
  throw new TypeError(`P1-B6 repair source-audit packet ${message}`);
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

// The protocol stays authoritative and unamended: this only refuses a drifted question, gate,
// or disposition set.
function verifyProtocol(rawBytes) {
  const protocol = verifyCanonicalInput('sourceAuditProtocol', rawBytes);
  if (protocol.protocolIdentity !== PROTOCOL_IDENTITY
    || JSON.stringify(protocol.reviewGate) !== JSON.stringify({
      eligibleForHumanSemanticReview: ['PASS'], failClosed: ['FAIL', 'UNCERTAIN'],
    })
    || JSON.stringify(protocol.outputContract.dispositionEnum)
      !== JSON.stringify(['PASS', 'FAIL', 'UNCERTAIN'])) {
    fail('protocol identity or review gate is not canonical');
  }
  return protocol;
}

// Item IDs feed the hash but never reach the blind row. Any candidate byte change moves the
// whole identity namespace, and the namespace label keeps it disjoint from historical IDs.
function opaqueAuditRowId(candidateSha256, itemId) {
  const digest = crypto.createHash('sha256')
    .update(`${AUDIT_ID_NAMESPACE}\0${PROTOCOL_IDENTITY}\0${candidateSha256}\0${itemId}`)
    .digest('hex').slice(0, 16);
  return `${AUDIT_ID_NAMESPACE}-${digest}`;
}

// Same canonical visible-bundle semantics as the historical renderer: evidence fragments in
// source order, exact role prefixes, exact byte-span selection, exactly one source-grounded
// TARGET insertion, and `---` between discontiguous fragments.
function renderCandidateBundle(candidate, item) {
  const episode = candidate.sourceEpisodes
    .find(row => row.sourceEpisodeId === item.sourceEpisodeId);
  const turns = new Map(episode.turns.map(turn => [turn.turnId, turn]));
  return computeFragments(item, episode).map(fragment => fragment.map(span => {
    const turn = turns.get(span.turnId);
    const selected = Buffer.from(turn.text, 'utf8').subarray(span.startByte, span.endByte);
    let text = decoder.decode(selected);
    if (span.turnId === item.anchorSpanRef.turnId
      && span.startByte <= item.anchorSpanRef.startByte
      && span.endByte >= item.anchorSpanRef.endByte) {
      const start = item.anchorSpanRef.startByte - span.startByte;
      const end = item.anchorSpanRef.endByte - span.startByte;
      text = `${decoder.decode(selected.subarray(0, start))}[TARGET]${decoder.decode(selected.subarray(start, end))}[/TARGET]${decoder.decode(selected.subarray(end))}`;
    }
    return `${turn.role}: ${text}`;
  }).join('\n')).join('\n---\n');
}

function buildRepairSourceAuditPacket(canonicalInputs) {
  if (!canonicalInputs || typeof canonicalInputs !== 'object') {
    fail('canonical input bytes were not supplied');
  }
  const rawCandidate = canonicalInputs.repairCandidate;
  const candidate = verifyCanonicalInput('repairCandidate', rawCandidate);
  const receipt = verifyCanonicalInput('resolutionReceipt', canonicalInputs.resolutionReceipt);
  const catalog = verifyCanonicalInput('effectiveCatalog', canonicalInputs.effectiveCatalog);
  const protocol = verifyProtocol(canonicalInputs.sourceAuditProtocol);

  // The candidate must still satisfy its own hardened contract, including span offsets against
  // the repaired source text, before any of it is rendered for an auditor.
  validateRepairCandidateBatch(candidate, { effectiveCatalog: catalog });

  if (candidate.provenance.resolutionReceipt.identity !== receipt.name
    || candidate.provenance.resolutionReceipt.rawSha256
      !== CANONICAL_INPUTS.resolutionReceipt.rawSha256
    || candidate.provenance.effectiveCurrentSkeletonCatalog.rawSha256
      !== CANONICAL_INPUTS.effectiveCatalog.rawSha256) {
    fail('candidate provenance does not bind the canonical resolution receipt and catalog');
  }
  const itemIds = candidate.items.map(row => row.itemId);
  if (JSON.stringify(itemIds) !== JSON.stringify([...AUTHORIZED_REPAIR_ITEM_IDS])
    || itemIds.some(itemId => AUTHORIZED_REJECT_ITEM_IDS.includes(itemId))) {
    fail('candidate does not hold exactly the 12 authorized repaired rows');
  }

  const candidateSha256 = sha256RawBytes(rawCandidate);
  const episodes = new Map(candidate.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  return {
    name: PACKET_IDENTITY,
    status: PACKET_STATUS,
    repairCandidate: { identity: candidate.name, rawSha256: candidateSha256 },
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

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== '--output' || !argv[1]) {
    throw new Error('Usage: --output <repair-source-audit-packet.json>');
  }
  return { outputPath: argv[1] };
}

function writeRepairSourceAuditPacket(outputPath) {
  if (fs.existsSync(outputPath)) {
    throw new Error(`Existing output will not be overwritten: ${outputPath}`);
  }
  const packet = buildRepairSourceAuditPacket(loadCanonicalInputs());
  const bytes = `${JSON.stringify(packet, null, 2)}\n`;
  fs.writeFileSync(outputPath, bytes, { encoding: 'utf8', flag: 'wx' });
  return { packet, rawSha256: sha256RawBytes(Buffer.from(bytes, 'utf8')) };
}

function main(argv = process.argv.slice(2)) {
  const { outputPath } = parseArgs(argv);
  const { rawSha256 } = writeRepairSourceAuditPacket(outputPath);
  process.stdout.write(`Built P1-B6 repair source-audit packet: ${outputPath}\n`);
  process.stdout.write(`Packet raw SHA-256: ${rawSha256}\n`);
  return 0;
}

module.exports = {
  AUDIT_ID_NAMESPACE,
  CANONICAL_INPUTS,
  FRESHNESS_CONTRACT,
  PACKET_IDENTITY,
  PACKET_STATUS,
  PROTOCOL_IDENTITY,
  buildRepairSourceAuditPacket,
  loadCanonicalInputs,
  main,
  opaqueAuditRowId,
  parseArgs,
  renderCandidateBundle,
  verifyProtocol,
  writeRepairSourceAuditPacket,
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`P1-B6 repair source-audit packet build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
