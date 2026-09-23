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

// The owner's post-review revision, recorded next to the unchanged raw result, never in place.
const OWNER_REVISIONS = Object.freeze([Object.freeze({
  reviewRowId: 'p1b6-v3hreview-2a9457ef343c1153',
  from: Object.freeze({ disposition: 'KEEP', decision: 'CLEAR' }),
  to: Object.freeze({ disposition: 'FIX', decision: null }),
  reason: 'Same self-stating TARGET construction as the later FIX rows. The owner found it odd at first sight but left it CLEAR, and began marking FIX from the second row of that form; revised after the review to apply the same judgment.',
})]);
const RAW_RESULT_FILENAME = 'p1b6-v3-human-review-results.json';

// Routing preregistered in the internal re-reconciliation plan.
function routeHumanResult(role, referenceLabel, row) {
  const matches = row.disposition === 'KEEP' && row.decision === referenceLabel;
  if (role === 'mandatory') {
    return matches ? { provenance: 'HUMAN_ADJUDICATED', eligibility: 'ELIGIBLE' }
      : { provenance: null, eligibility: row.disposition === 'KEEP' ? 'INELIGIBLE_PENDING_RESOLUTION' : 'INELIGIBLE' };
  }
  return matches ? { provenance: 'CATALOG_STRONG_MODEL_CONFIRMED', eligibility: 'PROVISIONAL' }
    : { provenance: null, eligibility: 'INELIGIBLE_PENDING_RESOLUTION' };
}

function buildHumanResultReceipt(rawResultBytes, rawReceipt, rawProtocol, reviewDate) {
  const packet = buildHumanReviewPacket(rawReceipt, rawProtocol);
  const smReceipt = JSON.parse(rawReceipt.toString('utf8'));
  const parsed = JSON.parse(Buffer.from(rawResultBytes).toString('utf8'));
  if (!parsed || JSON.stringify(Object.keys(parsed)) !== '["results"]' || !Array.isArray(parsed.results)) {
    fail('result artifact must be an object whose only key is results');
  }
  const ids = parsed.results.map(row => row.reviewRowId);
  if (JSON.stringify(ids.toSorted()) !== JSON.stringify(packet.rows.map(row => row.reviewRowId))) {
    fail('result rows are not exactly the packet rows');
  }
  for (const row of parsed.results) {
    const ok = JSON.stringify(Object.keys(row).toSorted()) === '["decision","disposition","reason","reviewRowId"]'
      && typeof row.reason === 'string' && row.reason.trim() !== ''
      && (row.disposition === 'KEEP' ? ['CLEAR', 'ESCALATE'].includes(row.decision)
        : ['FIX', 'REJECT'].includes(row.disposition) && row.decision === null);
    if (!ok) fail(`result row is malformed: ${row.reviewRowId}`);
  }
  const batchSha256 = smPacket.CANONICAL_INPUTS.batch.rawSha256;
  const roles = new Map([
    ...smReceipt.mandatoryHumanRows.map(row => [row.itemId, 'mandatory']),
    ...smReceipt.calibrationRows.map(row => [row.itemId, 'calibration']),
  ]);
  const references = new Map(reconcile.canonicalReferences(smPacket.loadCanonicalInputs())
    .map(row => [row.itemId, row]));
  const itemOf = new Map([...roles.keys()].map(itemId => [opaqueReviewRowId(batchSha256, itemId), itemId]));
  const rows = parsed.results.map(raw => {
    const revision = OWNER_REVISIONS.find(entry => entry.reviewRowId === raw.reviewRowId);
    if (revision && (raw.disposition !== revision.from.disposition || raw.decision !== revision.from.decision)) {
      fail(`revision does not match the raw result: ${raw.reviewRowId}`);
    }
    const effective = revision ? { ...raw, ...revision.to } : raw;
    const itemId = itemOf.get(raw.reviewRowId);
    const reference = references.get(itemId);
    return {
      reviewRowId: raw.reviewRowId,
      itemId,
      semanticSkeletonId: reference.semanticSkeletonId,
      role: roles.get(itemId),
      referenceLabel: reference.referenceLabel,
      rawDisposition: raw.disposition,
      rawDecision: raw.decision,
      disposition: effective.disposition,
      decision: effective.decision,
      revisedAfterReview: Boolean(revision),
      reason: raw.reason,
      ...routeHumanResult(roles.get(itemId), reference.referenceLabel, effective),
    };
  }).toSorted((a, b) => (a.itemId < b.itemId ? -1 : 1));
  const count = key => rows.reduce((acc, row) => {
    acc[row[key]] = (acc[row[key]] ?? 0) + 1;
    return acc;
  }, {});
  return {
    name: 'xion-local-memory-inference-p1b6-batch-003-targeted-v3-human-review-attempt-001-receipt-v1',
    attemptId: 'p1b6-batch-003-targeted-v3-human-review-attempt-001',
    status: 'COMPLETE_HUMAN_REVIEWED_AGAINST_SEMANTIC_CONTRACT_V3',
    reviewDate,
    reviewProtocol: { identity: packet.reviewProtocol.identity, sha256: PINNED.protocol.rawSha256 },
    reviewPacket: { identity: PACKET_IDENTITY, sha256: sha256RawBytes(packetBytes(packet)), rows: packet.rows.length },
    strongModelReceipt: { identity: PINNED.strongModelReceipt.identity, rawSha256: PINNED.strongModelReceipt.rawSha256 },
    rawResultArtifact: { filename: RAW_RESULT_FILENAME, sha256: sha256RawBytes(rawResultBytes), committed: false },
    reviewer: {
      role: 'repository owner',
      decisionsBy: 'repository owner',
      presentationAid: 'a model presented packet rows one at a time and made no judgment (owner-reported: GPT-5.6 sol)',
      independentConfirmation: false,
      limitation: 'The owner knew every row in this population has v3 reference ESCALATE and that most were model CLEAR; row blindness hid only which row was which.',
      orderEffect: 'The owner left the first self-stating-TARGET row CLEAR, then marked FIX from the second such row on; that first row was revised afterwards (see ownerRevisions).',
    },
    ownerRevisions: OWNER_REVISIONS,
    summary: {
      raw: { KEEP_CLEAR: 1, KEEP_ESCALATE: 1, FIX: 6, REJECT: 0 },
      effective: count('disposition'),
      eligibility: count('eligibility'),
      matchingV3Reference: rows.filter(row => row.disposition === 'KEEP' && row.decision === row.referenceLabel).length,
    },
    rows,
    observation: {
      status: 'OPEN_NOT_ADOPTED',
      skeletons: ['p1b6-sk-2da4e54e6609e34b', 'p1b6-sk-5269c91fcfb6c2cd'],
      note: 'Every reviewed row on these two skeletons was FIX: the TARGET span is the user\'s own stated fact, which is self-evidencing and CLEAR when judged as itself, while the skeleton contracts define the TARGET status as rule applicability or category membership, which v3 targetBoundary treats as downstream. The same construction is on the provisional agreement rows of these skeletons. Retiring, amending or re-authoring them is a separate semantic-contract decision; nothing here changes the catalog, the agreements or any surface.',
    },
    authority: {
      catalogAmendedByThisResult: false,
      agreementsRevisitedByThisResult: false,
      surfacesRepaired: false,
      surfaceAcceptancePerformed: false,
      referenceLabelFreezePerformed: false,
      finalSelectionPerformed: false,
      trainingOrEvaluationOccurred: false,
    },
  };
}

function loadPinned() {
  return [PINNED.strongModelReceipt, PINNED.protocol]
    .map(pinned => fs.readFileSync(path.join(ROOT, 'fixtures', pinned.fixture)));
}

function main(argv = process.argv.slice(2)) {
  if (argv.length === 6 && argv[0] === '--results' && argv[2] === '--date' && argv[4] === '--receipt') {
    if (fs.existsSync(argv[5])) throw new Error(`Existing output will not be overwritten: ${argv[5]}`);
    const receipt = buildHumanResultReceipt(fs.readFileSync(argv[1]), ...loadPinned(), argv[3]);
    fs.writeFileSync(argv[5], `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`Recorded HUMAN result: ${JSON.stringify(receipt.summary)}\n`);
    return 0;
  }
  if (argv.length !== 2 || argv[0] !== '--output' || !argv[1]) {
    throw new Error('Usage: --output <packet.json> | --results <raw.json> --date <YYYY-MM-DD> --receipt <receipt.json>');
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
  OWNER_REVISIONS,
  PACKET_IDENTITY,
  PINNED,
  REVIEW_ID_NAMESPACE,
  buildHumanResultReceipt,
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
