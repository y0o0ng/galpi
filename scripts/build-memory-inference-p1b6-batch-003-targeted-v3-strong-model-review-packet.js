#!/usr/bin/env node
'use strict';

// Fresh blind v3 strong-model semantic-review packet for the batch-003 surfaces left on the three
// skeletons semantic contract v3 reversed from CLEAR to ESCALATE.
//
// The surfaces did not change; the semantic authority did. So the population is derived from
// the v3 receipt, the resolution receipt and the unchanged historical batch; source-audit PASS is
// inherited only after each row maps mechanically to PASS; and the bundles are rendered by the
// same canonical renderer as the historical 301-row packet. Historical v2 answers and HUMAN
// decisions are not transferred as v3 judgments.
//
// It runs no review, ingests no result, accepts nothing, freezes nothing and trains nothing.
// Post-review routing is preregistered in the internal re-reconciliation plan, which never
// reaches the packet.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { RENDERER_IDENTITY, renderHumanReviewText } = require('../lib/memory-inference-p1b6-surfaces');
const historical = require('./build-memory-inference-p1b6-batch-003-strong-model-review-packet');

const ROOT = path.resolve(__dirname, '..');
const PACKET_IDENTITY =
  'xion-local-memory-inference-p1b6-batch-003-targeted-v3-strong-model-review-packet-v1';
const PACKET_STATUS = 'BLIND_STRONG_MODEL_REVIEW_PACKET_NOT_RUN';
const PROTOCOL_IDENTITY = 'p1b6-targeted-v3-semantic-realization-review-v1';
// Disjoint from p1b6-smreview-, p1b6-review-, p1b6-rereview-, p1b6-hacreview- and the repair
// review/audit namespaces.
const REVIEW_ID_NAMESPACE = 'p1b6-v3smreview';
// Expected shape of the derived population; an assertion on the derivation, never its input.
const EXPECTED_COUNT = 24;
const EXPECTED_PER_SKELETON = Object.freeze({
  'p1b6-sk-2da4e54e6609e34b': 11,
  'p1b6-sk-5269c91fcfb6c2cd': 2,
  'p1b6-sk-b8e64a03d97f251c': 11,
});

const CANONICAL_INPUTS = Object.freeze({
  batch: Object.freeze({
    label: 'historical batch-003',
    identity: 'xion-local-memory-inference-p1b6-surface-batch-003-v1',
    rawSha256: '90b453c3680bccaa537fd0d23db74bbc303882e1a35a2ddcea0b75b013fcaa68',
    fixture: 'local-memory-inference-p1b6-surface-batch-003.json',
  }),
  sourceAuditReceipt: Object.freeze({
    label: 'batch-003 source-audit receipt',
    identity: 'xion-local-memory-inference-p1b6-source-audit-batch-003-attempt-001-receipt-v1',
    rawSha256: '3c840476bea6eccb522800248a3ace277b26a5334ec56b5f6b10bbf4d5821221',
    fixture: 'local-memory-inference-p1b6-source-audit-batch-003-attempt-001.json',
  }),
  v3Receipt: Object.freeze({
    label: 'semantic contract v3 receipt',
    identity: 'xion-local-memory-inference-p1b6-skeleton-semantic-contract-v3-receipt-v1',
    rawSha256: '10f8a10eb3325b86c9d9282fc951ee53b2037918c4258c89a7694822df9a98e1',
    fixture: 'local-memory-inference-p1b6-skeleton-semantic-contract-v3-receipt.json',
  }),
  v3Catalog: Object.freeze({
    label: 'semantic authority v3',
    identity: 'xion-local-memory-inference-p1b6-skeleton-effective-current-v3',
    rawSha256: '89a48264d6b09710f976a4ab85235ff161cf81ff44896e37553d5dc7753c65b9',
    fixture: 'local-memory-inference-p1b6-skeleton-effective-current-v3.json',
  }),
  resolutionReceipt: Object.freeze({
    label: 'batch-003 resolution receipt',
    identity: 'xion-local-memory-inference-p1b6-batch-003-resolution-receipt-v1',
    rawSha256: '61c29218a360bf914c6453758c7fc243e629f1b5d400e38426d9d18720cb1ffe',
    fixture: 'local-memory-inference-p1b6-batch-003-resolution-receipt.json',
  }),
  reviewAuthorityAmendment: Object.freeze({
    label: 'large-batch review authority amendment',
    identity: 'xion-local-memory-inference-p1b6-large-batch-review-authority-amendment-v1',
    rawSha256: '821b0cb07580b4c2ac776014d88c78333263900759ca94d1746b4934964ffc0e',
    fixture: 'local-memory-inference-p1b6-large-batch-review-authority-amendment.json',
  }),
  protocol: Object.freeze({
    label: 'targeted v3 strong-model review protocol',
    identity: 'xion-local-memory-inference-p1b6-targeted-v3-strong-model-review-protocol-v1',
    rawSha256: '8a48c2df77374659e10dc2f48f16c3c2c40851669eb07b7377fbeeaf4337a892',
    fixture: 'local-memory-inference-p1b6-targeted-v3-strong-model-review-protocol.json',
  }),
});

function fail(message) {
  throw new TypeError(`P1-B6 batch-003 targeted v3 strong-model review packet ${message}`);
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

function packetBytes(packet) {
  return Buffer.from(`${JSON.stringify(packet, null, 2)}\n`, 'utf8');
}

// The item ID is hash input only and never reaches the packet.
function opaqueReviewRowId(batchSha256, itemId) {
  const digest = crypto.createHash('sha256')
    .update(`${REVIEW_ID_NAMESPACE}\0${PROTOCOL_IDENTITY}\0${batchSha256}\0${itemId}`)
    .digest('hex').slice(0, 16);
  return `${REVIEW_ID_NAMESPACE}-${digest}`;
}

// Pure derivation over parsed artifacts; nothing a caller names can widen or narrow it.
function derivePopulation({ batch, dispositions, v3Receipt, v3Catalog, resolutionReceipt }) {
  const amendments = v3Receipt.amendments.filter(row => row.reversesV2Amendment === true
    && row.fromHumanLabel === 'CLEAR' && row.toHumanLabel === 'ESCALATE');
  const amended = amendments.map(row => row.semanticSkeletonId);
  if (amended.length !== 3 || amendments.length !== v3Receipt.amendments.length
    || JSON.stringify([...amended].sort()) !== JSON.stringify(Object.keys(EXPECTED_PER_SKELETON))
    || JSON.stringify([...v3Catalog.amendedSkeletonIds].sort())
      !== JSON.stringify([...amended].sort())) {
    fail('v3 does not carry exactly the three CLEAR -> ESCALATE reversals');
  }
  for (const skeletonId of amended) {
    if (v3Catalog.candidates.find(row => row.semanticSkeletonId === skeletonId)?.humanLabel
      !== 'ESCALATE') {
      fail(`v3 catalog label disagrees with the v3 amendment: ${skeletonId}`);
    }
  }

  const onAmended = batch.items.filter(item => amended.includes(item.semanticSkeletonId));
  const closed = new Set(resolutionReceipt.decisions
    .filter(row => row.resolution === 'SEMANTIC_CONTRACT_CORRECTION').map(row => row.itemId));
  const closedHere = onAmended.filter(item => closed.has(item.itemId)).map(item => item.itemId);
  // The corrections the resolution closed must be exactly what v3 says its reversals resolved.
  if (JSON.stringify(closedHere.toSorted()) !== JSON.stringify(
    amendments.flatMap(row => row.resolvesBatch003ItemIds).toSorted())) {
    fail('resolution corrections do not match the v3 amendments');
  }
  const resolved = new Set(resolutionReceipt.decisions.map(row => row.itemId));
  const population = onAmended.filter(item => !closed.has(item.itemId));
  if (population.some(item => resolved.has(item.itemId))) {
    fail('a remaining row was already resolved another way');
  }

  if (population.length !== EXPECTED_COUNT) {
    fail(`population is ${population.length} rows, not ${EXPECTED_COUNT}`);
  }
  for (const [skeletonId, count] of Object.entries(EXPECTED_PER_SKELETON)) {
    if (population.filter(item => item.semanticSkeletonId === skeletonId).length !== count) {
      fail(`population distribution drifted on ${skeletonId}`);
    }
  }
  for (const item of population) {
    if (dispositions.get(item.itemId) !== 'PASS') {
      fail(`targeted row is not source-audit PASS: ${item.itemId}`);
    }
  }
  return population;
}

function buildTargetedReviewPacket(canonicalInputs) {
  if (!canonicalInputs || typeof canonicalInputs !== 'object') {
    fail('canonical input bytes were not supplied');
  }
  const extra = Object.keys(canonicalInputs).filter(key => !Object.hasOwn(CANONICAL_INPUTS, key));
  if (extra.length) fail(`does not accept caller inputs: ${extra.join(', ')}`);
  const artifacts = Object.fromEntries(Object.keys(CANONICAL_INPUTS)
    .map(key => [key, verifyCanonicalInput(key, canonicalInputs[key])]));

  // The hardened historical validator rebuilds the audit packet, checks every receipt binding
  // (including the source-audit protocol bytes) and maps opaque audit IDs back mechanically.
  const { batch, batchSha256, dispositions } =
    historical.validateAuditReceipt(artifacts.sourceAuditReceipt, canonicalInputs.batch);
  const population = derivePopulation({ ...artifacts, batch, dispositions });

  const rows = population.map(item => ({
    reviewRowId: opaqueReviewRowId(batchSha256, item.itemId),
    selectedBundle: renderHumanReviewText(batch, item),
  })).sort((left, right) => (left.reviewRowId < right.reviewRowId ? -1 : 1));
  if (new Set(rows.map(row => row.reviewRowId)).size !== rows.length) {
    fail('opaque review row IDs collided');
  }
  return {
    name: PACKET_IDENTITY,
    status: PACKET_STATUS,
    sourceBatch: { identity: batch.name, sha256: batchSha256 },
    rendererIdentity: RENDERER_IDENTITY,
    reviewProtocol: {
      identity: artifacts.protocol.protocolIdentity,
      sha256: CANONICAL_INPUTS.protocol.rawSha256,
    },
    rows,
  };
}

function loadCanonicalInputs() {
  return Object.fromEntries(Object.entries(CANONICAL_INPUTS)
    .map(([key, pinned]) => [key, fs.readFileSync(path.join(ROOT, 'fixtures', pinned.fixture))]));
}

function writeTargetedReviewPacket(outputPath) {
  if (fs.existsSync(outputPath)) {
    throw new Error(`Existing output will not be overwritten: ${outputPath}`);
  }
  const packet = buildTargetedReviewPacket(loadCanonicalInputs());
  const bytes = packetBytes(packet);
  fs.writeFileSync(outputPath, bytes, { flag: 'wx' });
  return { rawSha256: sha256RawBytes(bytes), rowCount: packet.rows.length };
}

function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2 || argv[0] !== '--output' || !argv[1]) {
    throw new Error('Usage: --output <targeted-v3-strong-model-review-packet.json>');
  }
  const { rawSha256, rowCount } = writeTargetedReviewPacket(argv[1]);
  process.stdout.write(`Built P1-B6 batch-003 targeted v3 strong-model review packet: ${argv[1]}\n`);
  process.stdout.write(`Packet raw SHA-256: ${rawSha256}\n`);
  process.stdout.write(`Rows: ${rowCount}\n`);
  return 0;
}

module.exports = {
  CANONICAL_INPUTS,
  EXPECTED_COUNT,
  EXPECTED_PER_SKELETON,
  PACKET_IDENTITY,
  PROTOCOL_IDENTITY,
  REVIEW_ID_NAMESPACE,
  buildTargetedReviewPacket,
  derivePopulation,
  loadCanonicalInputs,
  main,
  opaqueReviewRowId,
  packetBytes,
  writeTargetedReviewPacket,
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`P1-B6 batch-003 targeted v3 strong-model review packet build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
