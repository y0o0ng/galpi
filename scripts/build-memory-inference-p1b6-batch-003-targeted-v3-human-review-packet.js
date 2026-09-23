#!/usr/bin/env node
'use strict';

// Blind HUMAN review packet for the targeted v3 re-reconciliation: the mandatory rows and the
// per-skeleton calibration rows of the committed strong-model receipt, in one packet that does
// not reveal which row is which.
//
// Building the packet makes no HUMAN decision and embeds no expected answer. It accepts nothing,
// freezes nothing and trains nothing.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { RENDERER_IDENTITY, renderHumanReviewText } = require('../lib/memory-inference-p1b6-surfaces');
const smPacket = require('./build-memory-inference-p1b6-batch-003-targeted-v3-strong-model-review-packet');
const reconcile = require('./reconcile-memory-inference-p1b6-batch-003-targeted-v3-strong-model-review');

const ROOT = path.resolve(__dirname, '..');
const PACKET_IDENTITY = 'xion-local-memory-inference-p1b6-batch-003-targeted-v3-human-review-packet-v1';
const PACKET_STATUS = 'BLIND_HUMAN_REVIEW_PACKET_NOT_RUN';
// Disjoint from every earlier P1-B6 review and audit namespace.
const REVIEW_ID_NAMESPACE = 'p1b6-v3hreview';
const EXPECTED_ROWS = 8;

const PINNED = Object.freeze({
  strongModelReceipt: Object.freeze({
    identity: reconcile.RECEIPT_IDENTITY,
    rawSha256: '8db917801426d77f3d024bb843592208f008f490ca49f6a8499306d157f4d283',
    fixture: 'local-memory-inference-p1b6-targeted-v3-strong-model-review-batch-003-attempt-001.json',
  }),
  protocol: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-batch-003-targeted-v3-human-review-protocol-v1',
    rawSha256: 'b12ab70f5a1a79e7089e87c3cf35f46b8429f2a26a887237c9fed07711256542',
    fixture: 'local-memory-inference-p1b6-batch-003-targeted-v3-human-review-protocol.json',
  }),
});

function fail(message) {
  throw new TypeError(`P1-B6 batch-003 targeted v3 HUMAN review packet ${message}`);
}

function verify(key, rawBytes) {
  const pinned = PINNED[key];
  if (!Buffer.isBuffer(rawBytes)) fail(`${key} bytes were not supplied`);
  if (sha256RawBytes(rawBytes) !== pinned.rawSha256) fail(`${key} bytes are not the canonical evidence`);
  const artifact = JSON.parse(rawBytes.toString('utf8'));
  if (artifact.name !== pinned.identity) fail(`${key} identity is not canonical`);
  return artifact;
}

function packetBytes(packet) {
  return Buffer.from(`${JSON.stringify(packet, null, 2)}\n`, 'utf8');
}

// The item ID is hash input only and never reaches the packet.
function opaqueReviewRowId(batchSha256, itemId) {
  const digest = crypto.createHash('sha256')
    .update(`${REVIEW_ID_NAMESPACE}\0${PINNED.protocol.identity}\0${batchSha256}\0${itemId}`)
    .digest('hex').slice(0, 16);
  return `${REVIEW_ID_NAMESPACE}-${digest}`;
}

// Mandatory + calibration rows, checked against the canonical 24 and the plan's selection rule.
function derivePopulation(receipt, canonicalInputs) {
  if (receipt.status !== 'COMPLETE_RECONCILED_AGAINST_SEMANTIC_CONTRACT_V3') fail('receipt is not reconciled');
  const references = reconcile.canonicalReferences(canonicalInputs);
  const skeletonOf = new Map(references.map(row => [row.itemId, row.semanticSkeletonId]));
  const agreements = receipt.agreementItemIds;
  const mandatory = receipt.mandatoryHumanRows.map(row => row.itemId);
  const all = [...agreements, ...mandatory];
  if (new Set(all).size !== all.length || all.length !== references.length
    || !all.every(id => skeletonOf.has(id))) {
    fail('receipt rows are not a partition of the canonical population');
  }
  const expectedCalibration = Object.keys(smPacket.EXPECTED_PER_SKELETON).flatMap(skeletonId => {
    const pool = agreements.filter(id => skeletonOf.get(id) === skeletonId)
      .toSorted((a, b) => (reconcile.calibrationHash(a) < reconcile.calibrationHash(b) ? -1 : 1));
    return pool.length ? [pool[0]] : [];
  });
  const calibration = receipt.calibrationRows.map(row => row.itemId);
  if (JSON.stringify(calibration.toSorted()) !== JSON.stringify(expectedCalibration.toSorted())) {
    fail('calibration rows do not follow the preregistered rule');
  }
  const population = [...mandatory, ...calibration];
  if (population.length !== EXPECTED_ROWS) fail(`population is ${population.length} rows, not ${EXPECTED_ROWS}`);
  return population;
}

function buildHumanReviewPacket(rawReceipt, rawProtocol) {
  const receipt = verify('strongModelReceipt', rawReceipt);
  const protocol = verify('protocol', rawProtocol);
  const canonicalInputs = smPacket.loadCanonicalInputs();
  const population = derivePopulation(receipt, canonicalInputs);
  const batch = JSON.parse(canonicalInputs.batch.toString('utf8'));
  const batchSha256 = smPacket.CANONICAL_INPUTS.batch.rawSha256;
  const rows = population.map(itemId => ({
    reviewRowId: opaqueReviewRowId(batchSha256, itemId),
    selectedBundle: renderHumanReviewText(batch, batch.items.find(item => item.itemId === itemId)),
  })).sort((left, right) => (left.reviewRowId < right.reviewRowId ? -1 : 1));
  if (new Set(rows.map(row => row.reviewRowId)).size !== rows.length) fail('opaque review row IDs collided');
  return {
    name: PACKET_IDENTITY,
    status: PACKET_STATUS,
    sourceBatch: { identity: batch.name, sha256: batchSha256 },
    rendererIdentity: RENDERER_IDENTITY,
    reviewProtocol: { identity: protocol.protocolIdentity, sha256: PINNED.protocol.rawSha256 },
    rows,
  };
}

function loadPinned() {
  return [PINNED.strongModelReceipt, PINNED.protocol]
    .map(pinned => fs.readFileSync(path.join(ROOT, 'fixtures', pinned.fixture)));
}

function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2 || argv[0] !== '--output' || !argv[1]) {
    throw new Error('Usage: --output <targeted-v3-human-review-packet.json>');
  }
  if (fs.existsSync(argv[1])) throw new Error(`Existing output will not be overwritten: ${argv[1]}`);
  const packet = buildHumanReviewPacket(...loadPinned());
  const bytes = packetBytes(packet);
  fs.writeFileSync(argv[1], bytes, { flag: 'wx' });
  process.stdout.write(`Built P1-B6 batch-003 targeted v3 HUMAN review packet: ${argv[1]}\n`);
  process.stdout.write(`Packet raw SHA-256: ${sha256RawBytes(bytes)}\nRows: ${packet.rows.length}\n`);
  return 0;
}

module.exports = {
  PACKET_IDENTITY,
  PINNED,
  REVIEW_ID_NAMESPACE,
  buildHumanReviewPacket,
  derivePopulation,
  loadPinned,
  main,
  opaqueReviewRowId,
  packetBytes,
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`P1-B6 batch-003 targeted v3 HUMAN review packet build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
