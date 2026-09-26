#!/usr/bin/env node
'use strict';

// Blind v3 strong-model semantic-review packet for the TARGET-boundary candidates that passed
// the fresh source audit. The population comes from the committed audit receipt; the neutral
// targeted v3 protocol is reused unchanged; routing is preregistered in the internal plan,
// which never reaches the packet. It runs no review, accepts nothing and trains nothing.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { RENDERER_IDENTITY } = require('../lib/memory-inference-p1b6-surfaces');
const { renderCandidateBundle } = require('./build-memory-inference-p1b6-surface-repair-source-audit-packet');
const audit = require('./build-memory-inference-p1b6-target-boundary-source-audit-packet');

const ROOT = path.resolve(__dirname, '..');
const PACKET_IDENTITY = 'xion-local-memory-inference-p1b6-target-boundary-v3-review-packet-v1';
const PACKET_STATUS = 'BLIND_STRONG_MODEL_REVIEW_PACKET_NOT_RUN';
// Disjoint from every earlier P1-B6 review namespace.
const REVIEW_ID_NAMESPACE = 'p1b6-tb1-v3smreview';

const PINNED = Object.freeze({
  auditReceipt: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-target-boundary-source-audit-attempt-001-receipt-v1',
    rawSha256: '468512753a6441e68d574f21fb8893d11ddc9a436355e018baf83d0ed48b8187',
    fixture: 'local-memory-inference-p1b6-target-boundary-source-audit-attempt-001.json',
  }),
  plan: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-target-boundary-v3-review-plan-v1',
    rawSha256: 'be85f33e6234c4ed58a0a245dfaefc8def7e3bbfb2862165de37007cb53ff7dc',
    fixture: 'local-memory-inference-p1b6-target-boundary-v3-review-plan.json',
  }),
  protocol: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-targeted-v3-strong-model-review-protocol-v1',
    rawSha256: '8a48c2df77374659e10dc2f48f16c3c2c40851669eb07b7377fbeeaf4337a892',
    fixture: 'local-memory-inference-p1b6-targeted-v3-strong-model-review-protocol.json',
  }),
});

function fail(message) {
  throw new TypeError(`P1-B6 TARGET-boundary v3 review packet ${message}`);
}

function load(key) {
  const pinned = PINNED[key];
  const bytes = fs.readFileSync(path.join(ROOT, 'fixtures', pinned.fixture));
  if (sha256RawBytes(bytes) !== pinned.rawSha256) fail(`${key} bytes are not the canonical evidence`);
  const artifact = JSON.parse(bytes.toString('utf8'));
  if (artifact.name !== pinned.identity) fail(`${key} identity is not canonical`);
  return artifact;
}

function opaqueReviewRowId(candidateSha256, itemId) {
  const digest = crypto.createHash('sha256')
    .update(`${REVIEW_ID_NAMESPACE}\0${PINNED.protocol.identity}\0${candidateSha256}\0${itemId}`)
    .digest('hex').slice(0, 16);
  return `${REVIEW_ID_NAMESPACE}-${digest}`;
}

// PASS rows of the committed audit receipt, mapped back mechanically through the audit IDs.
function derivePopulation(receipt = load('auditReceipt'), plan = load('plan')) {
  const inputs = audit.loadCanonicalInputs();
  const candidate = JSON.parse(inputs.candidate.toString('utf8'));
  const candidateSha256 = audit.CANONICAL_INPUTS.candidate.rawSha256;
  if (receipt.auditedCandidate.rawSha256 !== candidateSha256
    || receipt.auditPacketSha256 !== sha256RawBytes(audit.packetBytes(audit.buildSourceAuditPacket(inputs)))) {
    fail('audit receipt does not bind the canonical candidate and packet');
  }
  const pass = new Set(receipt.rows.filter(row => row.disposition === 'PASS').map(row => row.auditRowId));
  const population = candidate.items
    .filter(item => pass.has(audit.opaqueAuditRowId(candidateSha256, item.itemId)));
  if (JSON.stringify(population.map(item => item.itemId)) !== JSON.stringify(plan.population.expectedItemIds)) {
    fail('population is not the preregistered PASS rows');
  }
  return { candidate, candidateSha256, population };
}

function buildReviewPacket() {
  const protocol = load('protocol');
  const { candidate, candidateSha256, population } = derivePopulation();
  return {
    name: PACKET_IDENTITY,
    status: PACKET_STATUS,
    sourceCandidate: { identity: candidate.name, sha256: candidateSha256 },
    rendererIdentity: RENDERER_IDENTITY,
    reviewProtocol: { identity: protocol.protocolIdentity, sha256: PINNED.protocol.rawSha256 },
    rows: population.map(item => ({
      reviewRowId: opaqueReviewRowId(candidateSha256, item.itemId),
      selectedBundle: renderCandidateBundle(candidate, item),
    })).sort((left, right) => (left.reviewRowId < right.reviewRowId ? -1 : 1)),
  };
}

const RECEIPT_FIXTURE = 'local-memory-inference-p1b6-target-boundary-v3-review-attempt-001.json';
const RAW_RESULT_FILENAME = 'p1b6-tb1-v3-review-results.json';
const V3_FIXTURE = 'local-memory-inference-p1b6-skeleton-effective-current-v3.json';

function calibrationHash(hashDomain, itemId) {
  return crypto.createHash('sha256').update(`${hashDomain}\0${itemId}`).digest('hex');
}

// Routes the raw result exactly as the internal plan preregistered.
function reconcile(rawResultBytes) {
  const plan = load('plan');
  const v3Bytes = fs.readFileSync(path.join(ROOT, 'fixtures', V3_FIXTURE));
  if (sha256RawBytes(v3Bytes) !== plan.referenceAuthority.rawSha256) fail('v3 bytes are not the plan authority');
  const labels = new Map(JSON.parse(v3Bytes.toString('utf8')).candidates
    .map(row => [row.semanticSkeletonId, row.humanLabel]));
  const packet = buildReviewPacket();
  const { candidateSha256, population } = derivePopulation();
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
    const reviewRowId = opaqueReviewRowId(candidateSha256, item.itemId);
    const row = byId.get(reviewRowId);
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
    return {
      itemId: item.itemId,
      semanticSkeletonId: item.semanticSkeletonId,
      referenceLabel,
      disposition: row?.disposition ?? null,
      decision: row?.decision ?? null,
      reason: row?.reason ?? null,
      route,
      ...(route === 'CLEAN_AGREEMENT'
        ? { provenance: 'CATALOG_STRONG_MODEL_CONFIRMED', eligibility: 'PROVISIONAL' }
        : { provenance: null, eligibility: 'PENDING_MANDATORY_HUMAN' }),
    };
  });
  const { hashDomain } = plan.routing.calibration;
  const skeletons = [...new Set(rows.map(row => row.semanticSkeletonId))];
  const calibrationItemIds = skeletons.flatMap(skeletonId => {
    const pool = rows.filter(row => row.semanticSkeletonId === skeletonId && row.route === 'CLEAN_AGREEMENT')
      .map(row => row.itemId)
      .toSorted((a, b) => (calibrationHash(hashDomain, a) < calibrationHash(hashDomain, b) ? -1 : 1));
    return pool.length ? [pool[0]] : [];
  });
  const mandatory = rows.filter(row => row.route !== 'CLEAN_AGREEMENT').map(row => row.itemId);
  return {
    name: 'xion-local-memory-inference-p1b6-target-boundary-v3-review-attempt-001-receipt-v1',
    attemptId: 'p1b6-target-boundary-v3-review-attempt-001',
    status: 'COMPLETE_RECONCILED_AGAINST_SEMANTIC_CONTRACT_V3',
    reviewProtocol: { identity: packet.reviewProtocol.identity, sha256: PINNED.protocol.rawSha256 },
    reviewPacket: { identity: PACKET_IDENTITY, sha256: sha256RawBytes(packetBytes(packet)), rows: packet.rows.length },
    reviewPlan: { identity: PINNED.plan.identity, rawSha256: PINNED.plan.rawSha256 },
    referenceAuthority: { identity: plan.referenceAuthority.identity, rawSha256: plan.referenceAuthority.rawSha256 },
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
  process.stdout.write(`Built P1-B6 TARGET-boundary v3 review packet: ${argv[1]}\n`);
  process.stdout.write(`Packet raw SHA-256: ${sha256RawBytes(bytes)}\n`);
  return 0;
}

module.exports = {
  PACKET_IDENTITY,
  PINNED,
  RECEIPT_FIXTURE,
  REVIEW_ID_NAMESPACE,
  buildReviewPacket,
  calibrationHash,
  reconcile,
  derivePopulation,
  main,
  opaqueReviewRowId,
  packetBytes,
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`P1-B6 TARGET-boundary v3 review packet build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
