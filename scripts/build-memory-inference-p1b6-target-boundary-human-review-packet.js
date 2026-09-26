#!/usr/bin/env node
'use strict';

// Blind HUMAN review packet for the TARGET-boundary candidates: the mandatory and calibration
// rows of the committed v3 review receipt, in one packet that does not reveal which is which.
// Building it makes no HUMAN decision, accepts nothing and trains nothing.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { RENDERER_IDENTITY } = require('../lib/memory-inference-p1b6-surfaces');
const { renderCandidateBundle } = require('./build-memory-inference-p1b6-surface-repair-source-audit-packet');
const review = require('./build-memory-inference-p1b6-target-boundary-v3-review-packet');

const ROOT = path.resolve(__dirname, '..');
const PACKET_IDENTITY = 'xion-local-memory-inference-p1b6-target-boundary-human-review-packet-v1';
const PACKET_STATUS = 'BLIND_HUMAN_REVIEW_PACKET_NOT_RUN';
// Disjoint from every earlier P1-B6 review namespace.
const REVIEW_ID_NAMESPACE = 'p1b6-tb1-hreview';

const PINNED = Object.freeze({
  reviewReceipt: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-target-boundary-v3-review-attempt-001-receipt-v1',
    rawSha256: 'f8042d1800f64e06a978e97318d3c17428fe5d6ecce252a6ab1533ff0392e58c',
    fixture: review.RECEIPT_FIXTURE,
  }),
  protocol: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-target-boundary-human-review-protocol-v1',
    rawSha256: 'e8b9f7281d3200f9b41599782847950d94082026fdfaf15d98d2e3c71a392ade',
    fixture: 'local-memory-inference-p1b6-target-boundary-human-review-protocol.json',
  }),
});

function fail(message) {
  throw new TypeError(`P1-B6 TARGET-boundary HUMAN review packet ${message}`);
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

// Mandatory + calibration rows of the receipt, re-checked against the reviewed population and
// the preregistered per-skeleton calibration rule.
function derivePopulation(receipt = load('reviewReceipt')) {
  if (receipt.status !== 'COMPLETE_RECONCILED_AGAINST_SEMANTIC_CONTRACT_V3') fail('receipt is not reconciled');
  const { population } = review.derivePopulation();
  const skeletonOf = new Map(population.map(item => [item.itemId, item.semanticSkeletonId]));
  const rows = receipt.rows;
  if (JSON.stringify(rows.map(row => row.itemId)) !== JSON.stringify(population.map(item => item.itemId))) {
    fail('receipt rows are not the reviewed population');
  }
  const mandatory = rows.filter(row => row.route !== 'CLEAN_AGREEMENT').map(row => row.itemId);
  const domain = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', review.PINNED.plan.fixture)))
    .routing.calibration.hashDomain;
  const expectedCalibration = [...new Set(skeletonOf.values())].flatMap(skeletonId => {
    const pool = rows.filter(row => row.route === 'CLEAN_AGREEMENT' && skeletonOf.get(row.itemId) === skeletonId)
      .map(row => row.itemId)
      .toSorted((a, b) => (review.calibrationHash(domain, a) < review.calibrationHash(domain, b) ? -1 : 1));
    return pool.length ? [pool[0]] : [];
  });
  if (JSON.stringify(receipt.mandatoryHumanItemIds) !== JSON.stringify(mandatory)
    || JSON.stringify(receipt.calibrationItemIds) !== JSON.stringify(expectedCalibration)) {
    fail('receipt routing does not follow the preregistered plan');
  }
  return [...mandatory, ...expectedCalibration];
}

function buildHumanReviewPacket() {
  const protocol = load('protocol');
  const population = new Set(derivePopulation());
  const { candidate, candidateSha256 } = review.derivePopulation();
  return {
    name: PACKET_IDENTITY,
    status: PACKET_STATUS,
    sourceCandidate: { identity: candidate.name, sha256: candidateSha256 },
    rendererIdentity: RENDERER_IDENTITY,
    reviewProtocol: { identity: protocol.protocolIdentity, sha256: PINNED.protocol.rawSha256 },
    rows: candidate.items.filter(item => population.has(item.itemId)).map(item => ({
      reviewRowId: opaqueReviewRowId(candidateSha256, item.itemId),
      selectedBundle: renderCandidateBundle(candidate, item),
    })).sort((left, right) => (left.reviewRowId < right.reviewRowId ? -1 : 1)),
  };
}

const RECEIPT_FIXTURE = 'local-memory-inference-p1b6-target-boundary-human-review-attempt-001.json';
const RAW_RESULT_FILENAME = 'p1b6-tb1-human-review-results.json';

// Routing preregistered in the internal TARGET-boundary v3 review plan.
function routeHumanResult(role, referenceLabel, row) {
  const matches = row.disposition === 'KEEP' && row.decision === referenceLabel;
  if (role === 'mandatory') {
    return matches ? { provenance: 'HUMAN_ADJUDICATED', eligibility: 'ELIGIBLE' }
      : { provenance: null, eligibility: 'INELIGIBLE' };
  }
  return matches ? { provenance: 'CATALOG_STRONG_MODEL_CONFIRMED', eligibility: 'PROVISIONAL' }
    : { provenance: null, eligibility: 'INELIGIBLE_PENDING_RESOLUTION' };
}

function buildHumanResultReceipt(rawResultBytes, reviewDate) {
  const packet = buildHumanReviewPacket();
  const reviewReceipt = load('reviewReceipt');
  const parsed = JSON.parse(Buffer.from(rawResultBytes).toString('utf8'));
  if (!parsed || JSON.stringify(Object.keys(parsed)) !== '["results"]' || !Array.isArray(parsed.results)) {
    fail('result artifact must be an object whose only key is results');
  }
  if (JSON.stringify(parsed.results.map(row => row.reviewRowId).toSorted())
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
  const candidateSha256 = packet.sourceCandidate.sha256;
  const byItem = new Map(reviewReceipt.rows.map(row => [row.itemId, row]));
  const rows = derivePopulation(reviewReceipt).map(itemId => {
    const raw = parsed.results.find(row => row.reviewRowId === opaqueReviewRowId(candidateSha256, itemId));
    const reference = byItem.get(itemId);
    const role = reviewReceipt.mandatoryHumanItemIds.includes(itemId) ? 'mandatory' : 'calibration';
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
    name: 'xion-local-memory-inference-p1b6-target-boundary-human-review-attempt-001-receipt-v1',
    attemptId: 'p1b6-target-boundary-human-review-attempt-001',
    status: 'COMPLETE_HUMAN_REVIEWED_AGAINST_SEMANTIC_CONTRACT_V3',
    reviewDate,
    reviewProtocol: { identity: packet.reviewProtocol.identity, sha256: PINNED.protocol.rawSha256 },
    reviewPacket: { identity: PACKET_IDENTITY, sha256: sha256RawBytes(packetBytes(packet)), rows: packet.rows.length },
    v3ReviewReceipt: { identity: PINNED.reviewReceipt.identity, rawSha256: PINNED.reviewReceipt.rawSha256 },
    rawResultArtifact: { filename: RAW_RESULT_FILENAME, sha256: sha256RawBytes(rawResultBytes), committed: false },
    reviewer: {
      role: 'repository owner',
      decisionsBy: 'repository owner',
      presentationAid: 'a model presented packet rows and helped format the JSON, and made no judgment (owner-reported: GPT-5.6 sol)',
      independentConfirmation: false,
      limitation: 'The owner specified the realization prototypes, knew both skeletons\' v3 reference is ESCALATE and was told the strong-model result; row blindness hid only which row was which.',
    },
    summary: {
      total: rows.length,
      matchingV3Reference: rows.filter(row => row.disposition === 'KEEP' && row.decision === row.referenceLabel).length,
      humanAdjudicated: rows.filter(row => row.provenance === 'HUMAN_ADJUDICATED').length,
    },
    rows,
    authority: {
      promotedToHumanAdjudicated: false,
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
  process.stdout.write(`Built P1-B6 TARGET-boundary HUMAN review packet: ${argv[1]}\n`);
  process.stdout.write(`Packet raw SHA-256: ${sha256RawBytes(bytes)}\n`);
  return 0;
}

module.exports = {
  PACKET_IDENTITY,
  PINNED,
  RECEIPT_FIXTURE,
  REVIEW_ID_NAMESPACE,
  buildHumanResultReceipt,
  buildHumanReviewPacket,
  derivePopulation,
  main,
  opaqueReviewRowId,
  packetBytes,
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`P1-B6 TARGET-boundary HUMAN review packet build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
