#!/usr/bin/env node
'use strict';

// Blind HUMAN adjudication / calibration packet for batch-004: the 2 mandatory and 8 calibration
// rows of the committed v3 review receipt, in one packet that does not reveal which is which.
// The calibration sample is recomputed from the authoring protocol's preregistered rule, and every
// bundle must equal the strong-model packet's. Building it makes no HUMAN decision, accepts
// nothing and trains nothing.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { RENDERER_IDENTITY } = require('../lib/memory-inference-p1b6-surfaces');
const { renderCandidateBundle } = require('./build-memory-inference-p1b6-surface-repair-source-audit-packet');
const review = require('./build-memory-inference-p1b6-batch-004-v3-review-packet');

const ROOT = path.resolve(__dirname, '..');
const PACKET_IDENTITY = 'xion-local-memory-inference-p1b6-batch-004-human-review-packet-v1';
const PACKET_STATUS = 'BLIND_HUMAN_REVIEW_PACKET_NOT_RUN';
// Disjoint from every earlier P1-B6 review namespace.
const REVIEW_ID_NAMESPACE = 'p1b6-b004-hreview';
const SOURCE_AUDIT_EXCLUDED = Object.freeze(['p1b6-item-b004-008']);

const PINNED = Object.freeze({
  reviewReceipt: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-batch-004-v3-review-attempt-001-receipt-v1',
    rawSha256: '08a30720c19490f04da8ffcc0943eb849fac1da6c5051919a0eaab02145587a0',
    fixture: review.RECEIPT_FIXTURE,
  }),
  protocol: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-batch-004-human-adjudication-calibration-protocol-v1',
    rawSha256: 'c40d19b58ac65582556543be9639b5be1236924eb6ec496fc3158b6c245a4b4e',
    fixture: 'local-memory-inference-p1b6-batch-004-human-adjudication-calibration-protocol.json',
  }),
});

function fail(message) {
  throw new TypeError(`P1-B6 batch-004 HUMAN review packet ${message}`);
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

// Roles come only from the receipt's routes and the recomputed preregistered calibration rule.
function derivePopulation(receipt = load('reviewReceipt')) {
  if (receipt.status !== 'COMPLETE_RECONCILED_AGAINST_SEMANTIC_CONTRACT_V3') fail('receipt is not reconciled');
  const { PINNED: upstream } = review;
  if (receipt.reviewPacket.sha256 !== sha256RawBytes(review.packetBytes(review.buildReviewPacket()))
    || receipt.routingAuthority.rawSha256 !== upstream.authoringProtocol.rawSha256
    || receipt.referenceAuthority.rawSha256 !== upstream.v3.rawSha256
    || receipt.reviewProtocol.sha256 !== upstream.protocol.rawSha256) {
    fail('receipt does not bind the canonical review packet, routing authority, v3 and protocol');
  }
  const { population } = review.derivePopulation();
  if (JSON.stringify(receipt.rows.map(row => row.itemId)) !== JSON.stringify(population.map(item => item.itemId))) {
    fail('receipt rows are not the source-audit PASS population');
  }
  const mandatory = receipt.rows.filter(row => row.route !== 'CLEAN_AGREEMENT').map(row => row.itemId);
  const clean = receipt.rows.filter(row => row.route === 'CLEAN_AGREEMENT').map(row => row.itemId);
  const authoring = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', upstream.authoringProtocol.fixture)));
  const { hashDomain, size, fraction } = authoring.gates.calibration;
  if (hashDomain !== 'p1b6-b004-v3-review-calibration-v1' || size !== 8 || fraction !== 0.2) {
    fail('preregistered calibration rule is not the batch-004 rule');
  }
  const calibration = clean
    .toSorted((a, b) => (review.calibrationHash(hashDomain, a) < review.calibrationHash(hashDomain, b) ? -1 : 1))
    .slice(0, size);
  if (JSON.stringify(receipt.mandatoryHumanItemIds) !== JSON.stringify(mandatory)
    || JSON.stringify(receipt.calibrationItemIds) !== JSON.stringify(calibration)) {
    fail('receipt routing does not follow the preregistered rule');
  }
  const members = [...mandatory, ...calibration];
  if (new Set(members).size !== members.length) fail('mandatory and calibration rows overlap');
  if (members.some(id => SOURCE_AUDIT_EXCLUDED.includes(id))) fail('a source-audit-excluded row entered the population');
  if (members.length !== 10) fail(`population is ${members.length} rows, not 10`);
  const sampled = new Set(calibration);
  return { mandatory, calibration, unsampled: clean.filter(id => !sampled.has(id)) };
}

function buildHumanReviewPacket() {
  const protocol = load('protocol');
  const { mandatory, calibration } = derivePopulation();
  const members = new Set([...mandatory, ...calibration]);
  const { batch, batchSha256, population } = review.derivePopulation();
  const strongModel = new Map(review.buildReviewPacket().rows.map(row => [row.reviewRowId, row.selectedBundle]));
  return {
    name: PACKET_IDENTITY,
    status: PACKET_STATUS,
    sourceBatch: { identity: batch.name, sha256: batchSha256 },
    rendererIdentity: RENDERER_IDENTITY,
    reviewProtocol: { identity: protocol.protocolIdentity, sha256: PINNED.protocol.rawSha256 },
    rows: population.filter(item => members.has(item.itemId)).map(item => {
      const selectedBundle = renderCandidateBundle(batch, item);
      if (selectedBundle !== strongModel.get(review.opaqueReviewRowId(batchSha256, item.itemId))) {
        fail(`bundle differs from the strong-model packet: ${item.itemId}`);
      }
      return { reviewRowId: opaqueReviewRowId(batchSha256, item.itemId), selectedBundle };
    }).sort((left, right) => (left.reviewRowId < right.reviewRowId ? -1 : 1)),
  };
}

const RECEIPT_FIXTURE = 'local-memory-inference-p1b6-batch-004-human-review-attempt-001.json';
const RAW_RESULT_FILENAME = 'p1b6-b004-human-review-results.json';

// The preregistered semantics of the batch-004 HUMAN protocol.
function routeHumanResult(role, referenceLabel, row) {
  const prefix = role === 'mandatory' ? 'MANDATORY' : 'CALIBRATION';
  if (row.disposition !== 'KEEP') return { outcome: `${prefix}_${row.disposition}`, provenance: null, eligibility: 'INELIGIBLE' };
  if (row.decision !== referenceLabel) {
    return { outcome: `${prefix}_DECISION_MISMATCH`, provenance: null, eligibility: 'INELIGIBLE', resolutionRequired: true };
  }
  return role === 'mandatory'
    ? { outcome: 'MANDATORY_MATCH', provenance: 'HUMAN_ADJUDICATED', eligibility: 'ELIGIBLE' }
    : { outcome: 'CALIBRATION_MATCH', provenance: 'CATALOG_STRONG_MODEL_CONFIRMED', eligibility: 'PROVISIONAL' };
}

function buildHumanResultReceipt(rawResultBytes, reviewDate) {
  const packet = buildHumanReviewPacket();
  const reviewReceipt = load('reviewReceipt');
  const parsed = JSON.parse(Buffer.from(rawResultBytes).toString('utf8'));
  if (!parsed || JSON.stringify(Object.keys(parsed)) !== '["results"]' || !Array.isArray(parsed.results)) {
    fail('result artifact must be an object whose only key is results');
  }
  if (JSON.stringify(parsed.results.map(row => row?.reviewRowId).toSorted())
    !== JSON.stringify(packet.rows.map(row => row.reviewRowId))) {
    fail('result rows are not exactly the packet rows');
  }
  for (const row of parsed.results) {
    const ok = JSON.stringify(Object.keys(row).toSorted()) === '["decision","disposition","reason","reviewRowId"]'
      && typeof row.reason === 'string' && row.reason.trim() !== ''
      && (row.disposition === 'KEEP' ? ['CLEAR', 'ESCALATE'].includes(row.decision)
        : ['FIX', 'REJECT'].includes(row.disposition) && row.decision === null);
    if (!ok) fail(`result row is malformed: ${row.reviewRowId}`);
  }
  const { mandatory, calibration, unsampled } = derivePopulation(reviewReceipt);
  const batchSha256 = packet.sourceBatch.sha256;
  const byItem = new Map(reviewReceipt.rows.map(row => [row.itemId, row]));
  const rows = [...mandatory.map(id => [id, 'mandatory']), ...calibration.map(id => [id, 'calibration'])]
    .map(([itemId, role]) => {
      const raw = parsed.results.find(row => row.reviewRowId === opaqueReviewRowId(batchSha256, itemId));
      const reference = byItem.get(itemId);
      return {
        reviewRowId: raw.reviewRowId,
        itemId,
        semanticSkeletonId: reference.semanticSkeletonId,
        role,
        referenceLabel: reference.referenceLabel,
        disposition: raw.disposition,
        decision: raw.decision,
        reason: raw.reason,
        ...routeHumanResult(role, reference.referenceLabel, raw),
      };
    }).toSorted((a, b) => (a.itemId < b.itemId ? -1 : 1));
  return {
    name: 'xion-local-memory-inference-p1b6-batch-004-human-review-attempt-001-receipt-v1',
    attemptId: 'p1b6-batch-004-human-review-attempt-001',
    status: 'COMPLETE_HUMAN_REVIEWED_AGAINST_SEMANTIC_CONTRACT_V3',
    reviewDate,
    reviewProtocol: { identity: packet.reviewProtocol.identity, sha256: PINNED.protocol.rawSha256 },
    reviewPacket: { identity: PACKET_IDENTITY, sha256: sha256RawBytes(packetBytes(packet)), rows: packet.rows.length },
    v3ReviewReceipt: { identity: PINNED.reviewReceipt.identity, rawSha256: PINNED.reviewReceipt.rawSha256 },
    rawResultArtifact: { filename: RAW_RESULT_FILENAME, sha256: sha256RawBytes(rawResultBytes), committed: false },
    reviewer: {
      role: 'repository owner',
      decisionsBy: 'repository owner',
      independentConfirmation: false,
      limitation: 'The owner reviewed every surface before audit with its authoring target label, directed both repairs of 037, and had seen the v3 review summary including the mandatory and calibration item IDs; row blindness hid only which opaque row was which.',
    },
    summary: {
      total: rows.length,
      mandatory: mandatory.length,
      calibration: calibration.length,
      matchingV3Reference: rows.filter(row => row.outcome.endsWith('_MATCH')).length,
      humanAdjudicated: rows.filter(row => row.provenance === 'HUMAN_ADJUDICATED').length,
      unsampledCleanAgreements: unsampled.length,
    },
    rows,
    unsampledCleanAgreements: unsampled.map(itemId => ({
      itemId, provenance: 'CATALOG_STRONG_MODEL_CONFIRMED', eligibility: 'PROVISIONAL', calibrationExtrapolated: false,
    })),
    sourceAuditExcluded: [...SOURCE_AUDIT_EXCLUDED],
    authority: {
      // Only mandatory matching rows become HUMAN_ADJUDICATED (routeHumanResult).
      promotedToHumanAdjudicated: rows.some(row => row.provenance === 'HUMAN_ADJUDICATED'),
      catalogAmendedByThisResult: false,
      surfaceAcceptancePerformed: false,
      referenceLabelFreezePerformed: false,
      finalSelectionPerformed: false,
      trainingOrEvaluationOccurred: false,
    },
  };
}

function packetBytes(packet) {
  return Buffer.from(`${JSON.stringify(packet, null, 2)}\n`, 'utf8');
}

function main(argv = process.argv.slice(2)) {
  if (argv.length === 4 && argv[0] === '--results' && argv[2] === '--date') {
    const output = path.join(ROOT, 'fixtures', RECEIPT_FIXTURE);
    if (fs.existsSync(output)) throw new Error(`Existing output will not be overwritten: ${output}`);
    const receipt = buildHumanResultReceipt(fs.readFileSync(argv[1]), argv[3]);
    fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`Recorded HUMAN result: ${JSON.stringify(receipt.summary)} -> fixtures/${RECEIPT_FIXTURE}\n`);
    return 0;
  }
  if (argv.length !== 2 || argv[0] !== '--output' || !argv[1]) {
    throw new Error('Usage: --output <packet.json> | --results <raw.json> --date <YYYY-MM-DD>');
  }
  if (fs.existsSync(argv[1])) throw new Error(`Existing output will not be overwritten: ${argv[1]}`);
  const bytes = packetBytes(buildHumanReviewPacket());
  fs.writeFileSync(argv[1], bytes, { flag: 'wx' });
  process.stdout.write(`Built P1-B6 batch-004 HUMAN review packet: ${argv[1]}\n`);
  process.stdout.write(`Packet raw SHA-256: ${sha256RawBytes(bytes)}\n`);
  return 0;
}

module.exports = {
  PACKET_IDENTITY,
  PINNED,
  RECEIPT_FIXTURE,
  REVIEW_ID_NAMESPACE,
  SOURCE_AUDIT_EXCLUDED,
  buildHumanResultReceipt,
  buildHumanReviewPacket,
  derivePopulation,
  main,
  opaqueReviewRowId,
  packetBytes,
  routeHumanResult,
};

if (require.main === module) process.exit(main());
