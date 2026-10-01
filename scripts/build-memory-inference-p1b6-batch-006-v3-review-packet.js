#!/usr/bin/env node
'use strict';

// Blind v3 strong-model semantic-review packet for the batch-006 surfaces that passed the fresh
// source audit. The population comes from the committed audit receipt; the neutral targeted v3
// protocol is reused unchanged; routing is the batch-006 authoring protocol's per-split rule,
// which never reaches the packet: HELD rows never go to HUMAN (a clean agreement is PROVISIONAL,
// anything else INELIGIBLE); DEV rows follow batch-005 (every clean agreement is calibration). It runs no
// review, accepts nothing and trains nothing.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { RENDERER_IDENTITY } = require('../lib/memory-inference-p1b6-surfaces');
const { renderCandidateBundle } = require('./build-memory-inference-p1b6-surface-repair-source-audit-packet');
const audit = require('./build-memory-inference-p1b6-batch-006-source-audit-packet');

const ROOT = path.resolve(__dirname, '..');
const PACKET_IDENTITY = 'xion-local-memory-inference-p1b6-batch-006-v3-review-packet-v1';
const PACKET_STATUS = 'BLIND_STRONG_MODEL_REVIEW_PACKET_NOT_RUN';
// Disjoint from every earlier P1-B6 review namespace.
const REVIEW_ID_NAMESPACE = 'p1b6-b006-v3smreview';
// The audit receipt's PASS rows: all seven slots.
const EXPECTED_ITEM_IDS = Object.freeze(['001', '002', '003', '004', '005', '006', '007'].map(slot => `p1b6-item-b006-${slot}`));

const PINNED = Object.freeze({
  auditReceipt: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-batch-006-source-audit-attempt-001-receipt-v1',
    rawSha256: '550fbd816ef2571e24f9cd2abfb61e5af7ace0a6cab794db622447858d6431fa',
    fixture: 'local-memory-inference-p1b6-batch-006-source-audit-attempt-001.json',
  }),
  authoringProtocol: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-surface-batch-006-authoring-protocol-v1',
    rawSha256: '4b8153da5da0698cfa932e1b26d9512f1323eb268738020de30e2b4d53c7bd90',
    fixture: 'local-memory-inference-p1b6-surface-batch-006-authoring-protocol.json',
  }),
  protocol: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-targeted-v3-strong-model-review-protocol-v1',
    rawSha256: '8a48c2df77374659e10dc2f48f16c3c2c40851669eb07b7377fbeeaf4337a892',
    fixture: 'local-memory-inference-p1b6-targeted-v3-strong-model-review-protocol.json',
  }),
  v3: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-skeleton-effective-current-v3',
    rawSha256: '89a48264d6b09710f976a4ab85235ff161cf81ff44896e37553d5dc7753c65b9',
    fixture: 'local-memory-inference-p1b6-skeleton-effective-current-v3.json',
  }),
});

function fail(message) {
  throw new TypeError(`P1-B6 batch-006 v3 review packet ${message}`);
}

function load(key) {
  const pinned = PINNED[key];
  const bytes = fs.readFileSync(path.join(ROOT, 'fixtures', pinned.fixture));
  if (sha256RawBytes(bytes) !== pinned.rawSha256) fail(`${key} bytes are not the canonical evidence`);
  const artifact = JSON.parse(bytes.toString('utf8'));
  if (artifact.name !== pinned.identity) fail(`${key} identity is not canonical`);
  return artifact;
}

function opaqueReviewRowId(batchSha256, itemId) {
  const digest = crypto.createHash('sha256')
    .update(`${REVIEW_ID_NAMESPACE}\0${PINNED.protocol.identity}\0${batchSha256}\0${itemId}`)
    .digest('hex').slice(0, 16);
  return `${REVIEW_ID_NAMESPACE}-${digest}`;
}

// PASS rows of the committed audit receipt, mapped back mechanically through the audit IDs.
function derivePopulation(receipt = load('auditReceipt')) {
  const inputs = audit.loadCanonicalInputs();
  const batch = JSON.parse(inputs.batch.toString('utf8'));
  const batchSha256 = audit.CANONICAL_INPUTS.batch.rawSha256;
  if (receipt.auditedBatch.rawSha256 !== batchSha256
    || receipt.auditPacketSha256 !== sha256RawBytes(audit.packetBytes(audit.buildSourceAuditPacket(inputs)))) {
    fail('audit receipt does not bind the canonical batch and packet');
  }
  const pass = new Set(receipt.rows.filter(row => row.disposition === 'PASS').map(row => row.auditRowId));
  const population = batch.items.filter(item => pass.has(audit.opaqueAuditRowId(batchSha256, item.itemId)));
  if (JSON.stringify(population.map(item => item.itemId)) !== JSON.stringify(EXPECTED_ITEM_IDS)) {
    fail('population is not the audit PASS rows');
  }
  return { batch, batchSha256, population };
}

function buildReviewPacket() {
  const protocol = load('protocol');
  const { batch, batchSha256, population } = derivePopulation();
  return {
    name: PACKET_IDENTITY,
    status: PACKET_STATUS,
    sourceBatch: { identity: batch.name, sha256: batchSha256 },
    rendererIdentity: RENDERER_IDENTITY,
    reviewProtocol: { identity: protocol.protocolIdentity, sha256: PINNED.protocol.rawSha256 },
    rows: population.map(item => ({
      reviewRowId: opaqueReviewRowId(batchSha256, item.itemId),
      selectedBundle: renderCandidateBundle(batch, item),
    })).sort((left, right) => (left.reviewRowId < right.reviewRowId ? -1 : 1)),
  };
}

const RECEIPT_FIXTURE = 'local-memory-inference-p1b6-batch-006-v3-review-attempt-001.json';
const RAW_RESULT_FILENAME = 'p1b6-b006-v3-review-results.json';

// Routes the raw result exactly as the batch-006 authoring protocol preregistered.
function reconcile(rawResultBytes) {
  const { gates } = load('authoringProtocol');
  const labels = new Map(load('v3').candidates.map(row => [row.semanticSkeletonId, row.humanLabel]));
  const packet = buildReviewPacket();
  const { batchSha256, population } = derivePopulation();
  const split = new Map(load('authoringProtocol').slots.map(slot => [`p1b6-item-b006-${slot.slot}`, slot.splitAssignment]));
  const parsed = JSON.parse(Buffer.from(rawResultBytes).toString('utf8'));
  if (!parsed || JSON.stringify(Object.keys(parsed)) !== '["results"]' || !Array.isArray(parsed.results)) {
    fail('result artifact must be an object whose only key is results');
  }
  const known = new Set(packet.rows.map(row => row.reviewRowId));
  const byId = new Map();
  for (const row of parsed.results) {
    if (!known.has(row?.reviewRowId)) fail(`result row is not a packet row: ${row?.reviewRowId}`);
    if (byId.has(row.reviewRowId)) fail(`result duplicates a packet row: ${row.reviewRowId}`);
    byId.set(row.reviewRowId, row);
  }
  const rows = population.map(item => {
    const row = byId.get(opaqueReviewRowId(batchSha256, item.itemId));
    const referenceLabel = labels.get(item.semanticSkeletonId);
    const wellFormed = row
      && JSON.stringify(Object.keys(row).toSorted()) === '["decision","disposition","reason","reviewRowId"]'
      && typeof row.reason === 'string' && row.reason.trim() !== ''
      && (row.disposition === 'KEEP' ? ['CLEAR', 'ESCALATE'].includes(row.decision)
        : ['FIX', 'REJECT'].includes(row.disposition) && row.decision === null);
    let route = 'CLEAN_AGREEMENT';
    if (!wellFormed) route = 'MISSING_OR_INVALID_RESULT';
    else if (row.disposition !== 'KEEP') route = row.disposition;
    else if (row.decision !== referenceLabel) route = 'DECISION_DISAGREEMENT';
    const held = split.get(item.itemId) === 'FINAL_HELD_OUT';
    return {
      itemId: item.itemId,
      semanticSkeletonId: item.semanticSkeletonId,
      splitAssignment: split.get(item.itemId),
      referenceLabel,
      disposition: row?.disposition ?? null,
      decision: row?.decision ?? null,
      reason: row?.reason ?? null,
      route,
      ...(route === 'CLEAN_AGREEMENT'
        ? { provenance: 'CATALOG_STRONG_MODEL_CONFIRMED', eligibility: 'PROVISIONAL' }
        : held ? { provenance: null, eligibility: 'INELIGIBLE' } : { provenance: null, eligibility: 'PENDING_MANDATORY_HUMAN' }),
    };
  });
  if (!gates.held.order.every(step => !step.includes('HUMAN'))) fail('HELD gates are not the preregistered ones');
  const dev = rows.filter(row => row.splitAssignment === 'DEV');
  const calibrationItemIds = dev.filter(row => row.route === 'CLEAN_AGREEMENT').map(row => row.itemId);
  const mandatory = dev.filter(row => row.route !== 'CLEAN_AGREEMENT').map(row => row.itemId);
  return {
    name: 'xion-local-memory-inference-p1b6-batch-006-v3-review-attempt-001-receipt-v1',
    attemptId: 'p1b6-batch-006-v3-review-attempt-001',
    status: 'COMPLETE_RECONCILED_AGAINST_SEMANTIC_CONTRACT_V3',
    reviewProtocol: { identity: packet.reviewProtocol.identity, sha256: PINNED.protocol.rawSha256 },
    reviewPacket: { identity: PACKET_IDENTITY, sha256: sha256RawBytes(packetBytes(packet)), rows: packet.rows.length },
    routingAuthority: { identity: PINNED.authoringProtocol.identity, rawSha256: PINNED.authoringProtocol.rawSha256 },
    referenceAuthority: { identity: PINNED.v3.identity, rawSha256: PINNED.v3.rawSha256 },
    rawResultArtifact: { filename: RAW_RESULT_FILENAME, sha256: sha256RawBytes(rawResultBytes), committed: false },
    reviewerExecutionProvenance: {
      evidenceBasis: 'REPORTED_BY_REPOSITORY_OWNER',
      reportedModel: 'Claude Opus 5.5',
      session: 'fresh Claude Code CLI session started in the home directory, given only the protocol and packet paths',
    },
    summary: {
      total: rows.length,
      cleanAgreements: rows.length - mandatory.length,
      mandatoryHuman: mandatory.length,
      calibration: calibrationItemIds.length,
      heldIneligible: rows.filter(row => row.splitAssignment === 'FINAL_HELD_OUT' && row.eligibility === 'INELIGIBLE').length,
    },
    rows,
    mandatoryHumanItemIds: mandatory,
    calibrationItemIds,
    authority: {
      humanPacketBuilt: false,
      humanReviewPerformed: false,
      surfaceAcceptancePerformed: false,
      referenceLabelFreezePerformed: false,
      trainingOrEvaluationOccurred: false,
    },
  };
}

function packetBytes(packet) {
  return Buffer.from(`${JSON.stringify(packet, null, 2)}\n`, 'utf8');
}

function main(argv = process.argv.slice(2)) {
  if (argv.length === 2 && argv[0] === '--results' && argv[1]) {
    const output = path.join(ROOT, 'fixtures', RECEIPT_FIXTURE);
    if (fs.existsSync(output)) throw new Error(`Existing output will not be overwritten: ${output}`);
    const receipt = reconcile(fs.readFileSync(argv[1]));
    fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`Reconciled: ${JSON.stringify(receipt.summary)} -> fixtures/${RECEIPT_FIXTURE}\n`);
    return 0;
  }
  if (argv.length !== 2 || argv[0] !== '--output' || !argv[1]) {
    throw new Error('Usage: --output <packet.json> | --results <raw-results.json>');
  }
  if (fs.existsSync(argv[1])) throw new Error(`Existing output will not be overwritten: ${argv[1]}`);
  const bytes = packetBytes(buildReviewPacket());
  fs.writeFileSync(argv[1], bytes, { flag: 'wx' });
  process.stdout.write(`Built P1-B6 batch-006 v3 review packet: ${argv[1]}\n`);
  process.stdout.write(`Packet raw SHA-256: ${sha256RawBytes(bytes)}\n`);
  return 0;
}

module.exports = {
  EXPECTED_ITEM_IDS,
  PACKET_IDENTITY,
  PINNED,
  RECEIPT_FIXTURE,
  REVIEW_ID_NAMESPACE,
  buildReviewPacket,
  derivePopulation,
  main,
  opaqueReviewRowId,
  packetBytes,
  reconcile,
};

if (require.main === module) process.exit(main());
