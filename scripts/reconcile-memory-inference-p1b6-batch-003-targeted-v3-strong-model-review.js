#!/usr/bin/env node
'use strict';

// Reconciles the raw targeted v3 strong-model review results against semantic contract v3, with
// the routing and per-skeleton calibration preregistered in the internal re-reconciliation plan.
//
// The population and reference labels are derived from the canonical inputs, never accepted.
// Raw result bytes are bound by SHA only and are not committed. It builds no HUMAN packet,
// accepts nothing, freezes nothing and trains nothing.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('./build-memory-inference-p1b6-batch-003-targeted-v3-strong-model-review-packet');
const historical = require('./build-memory-inference-p1b6-batch-003-strong-model-review-packet');

const ROOT = path.resolve(__dirname, '..');
const RECEIPT_IDENTITY =
  'xion-local-memory-inference-p1b6-targeted-v3-strong-model-review-batch-003-attempt-001-receipt-v1';
const ATTEMPT_ID = 'p1b6-targeted-v3-strong-model-review-batch-003-attempt-001';
const PLAN_FIXTURE = 'local-memory-inference-p1b6-batch-003-v3-rereconciliation-plan.json';
const PLAN_SHA256 = 'ab0db3a730b5f2abc00d3209755f492f9a2f7bbf08ef9c4986b98e3e6ec1a887';
const PACKET_SHA256 = '665755e2e9704240d55d99749af68c17c5882f3c73a9f0867286883f82db1b74';
const CALIBRATION_HASH_DOMAIN = 'p1b6-b003-v3-rereconciliation-calibration-v1';
const RESULT_FILENAME = 'p1b6-v3-review-results.json';

function fail(message) {
  throw new TypeError(`P1-B6 batch-003 targeted v3 reconciliation ${message}`);
}

function calibrationHash(itemId) {
  return crypto.createHash('sha256').update(`${CALIBRATION_HASH_DOMAIN}\0${itemId}`).digest('hex');
}

// References derived from the same canonical inputs the issued packet was built from.
function canonicalReferences(canonicalInputs) {
  const packet = builder.buildTargetedReviewPacket(canonicalInputs);
  if (sha256RawBytes(builder.packetBytes(packet)) !== PACKET_SHA256) {
    fail('rebuilt packet is not the issued packet');
  }
  const batch = JSON.parse(Buffer.from(canonicalInputs.batch).toString('utf8'));
  const catalog = JSON.parse(Buffer.from(canonicalInputs.v3Catalog).toString('utf8'));
  const label = new Map(catalog.candidates.map(row => [row.semanticSkeletonId, row.humanLabel]));
  const byRowId = new Map(batch.items.map(item => [
    builder.opaqueReviewRowId(packet.sourceBatch.sha256, item.itemId), item]));
  return packet.rows.map(({ reviewRowId }) => {
    const item = byRowId.get(reviewRowId);
    return {
      reviewRowId,
      itemId: item.itemId,
      semanticSkeletonId: item.semanticSkeletonId,
      referenceLabel: label.get(item.semanticSkeletonId),
    };
  });
}

// Unknown or duplicate IDs fail the whole artifact; a missing or malformed row routes to HUMAN.
function reconcileTargetedV3(canonicalInputs, results) {
  const references = canonicalReferences(canonicalInputs);
  const byRowId = historical.validateStrongModelResults(results, references);
  const agreements = [];
  const humanAdjudication = [];
  for (const reference of references) {
    const row = byRowId.get(reference.reviewRowId);
    const wellFormed = row
      && JSON.stringify(Object.keys(row).toSorted())
        === JSON.stringify(['decision', 'disposition', 'reason', 'reviewRowId'])
      && typeof row.reason === 'string' && row.reason.trim() !== ''
      && (row.disposition === 'KEEP' ? ['CLEAR', 'ESCALATE'].includes(row.decision)
        : ['FIX', 'REJECT'].includes(row.disposition) && row.decision === null);
    const base = { itemId: reference.itemId, semanticSkeletonId: reference.semanticSkeletonId,
      referenceLabel: reference.referenceLabel };
    if (!wellFormed) humanAdjudication.push({ ...base, route: 'MISSING_OR_INVALID_RESULT' });
    else if (row.disposition !== 'KEEP') humanAdjudication.push({ ...base, route: row.disposition });
    else if (row.decision !== reference.referenceLabel) {
      humanAdjudication.push({ ...base, route: 'DECISION_DISAGREEMENT', modelDecision: row.decision });
    } else {
      agreements.push({ ...base, provenance: 'CATALOG_STRONG_MODEL_CONFIRMED', eligibility: 'PROVISIONAL' });
    }
  }
  // One calibration row per amended skeleton that has any clean agreement; no substitution.
  const calibration = Object.keys(builder.EXPECTED_PER_SKELETON).flatMap(skeletonId => {
    const pool = agreements.filter(row => row.semanticSkeletonId === skeletonId)
      .map(row => row.itemId).toSorted((a, b) => (calibrationHash(a) < calibrationHash(b) ? -1 : 1));
    return pool.length ? [{ semanticSkeletonId: skeletonId, itemId: pool[0], agreementPool: pool.length }] : [];
  });
  return { references, agreements, humanAdjudication, calibration };
}

function buildReceipt(canonicalInputs, rawResultBytes, planBytes) {
  if (sha256RawBytes(planBytes) !== PLAN_SHA256) fail('plan bytes are not the preregistered plan');
  const parsed = JSON.parse(Buffer.from(rawResultBytes).toString('utf8'));
  if (!parsed || JSON.stringify(Object.keys(parsed)) !== '["results"]') {
    fail('result artifact must be an object whose only key is results');
  }
  const { references, agreements, humanAdjudication, calibration } =
    reconcileTargetedV3(canonicalInputs, parsed.results);
  const count = (rows, key) => rows.reduce((acc, row) => {
    acc[row[key]] = (acc[row[key]] ?? 0) + 1;
    return acc;
  }, {});
  const pinned = builder.CANONICAL_INPUTS;
  return {
    name: RECEIPT_IDENTITY,
    attemptId: ATTEMPT_ID,
    status: 'COMPLETE_RECONCILED_AGAINST_SEMANTIC_CONTRACT_V3',
    reviewProtocol: { identity: builder.PROTOCOL_IDENTITY, sha256: pinned.protocol.rawSha256 },
    reviewPacket: { identity: builder.PACKET_IDENTITY, sha256: PACKET_SHA256, rows: references.length },
    rereconciliationPlan: { fixture: PLAN_FIXTURE, rawSha256: PLAN_SHA256 },
    reviewedSourceBatch: { identity: pinned.batch.identity, rawSha256: pinned.batch.rawSha256 },
    referenceAuthority: { identity: pinned.v3Catalog.identity, rawSha256: pinned.v3Catalog.rawSha256 },
    rawResultArtifact: { filename: RESULT_FILENAME, sha256: sha256RawBytes(rawResultBytes), committed: false },
    reviewerExecutionProvenance: {
      evidenceBasis: 'REPORTED_BY_REPOSITORY_OWNER',
      reportedModel: 'Claude Opus 5.5',
      session: 'fresh Claude Code CLI session started in the home directory, given only the protocol and packet paths',
      note: 'The result artifact itself carries no model metadata. The reviewer is the same model family as the reconciling session but ran in a separate fresh session.',
    },
    rawResultSummary: {
      total: parsed.results.length,
      dispositions: count(parsed.results, 'disposition'),
      decisions: count(parsed.results.filter(row => row.decision !== null), 'decision'),
    },
    reconciliation: {
      agreements: agreements.length,
      humanAdjudicationRouted: humanAdjudication.length,
      routes: count(humanAdjudication, 'route'),
      provenanceForAgreements: 'CATALOG_STRONG_MODEL_CONFIRMED',
      eligibilityForAgreements: 'PROVISIONAL',
    },
    agreementItemIds: agreements.map(row => row.itemId).toSorted(),
    mandatoryHumanRows: humanAdjudication
      .map(({ itemId, semanticSkeletonId, referenceLabel, route, modelDecision }) =>
        ({ itemId, semanticSkeletonId, referenceLabel, route, modelDecision: modelDecision ?? null }))
      .toSorted((a, b) => (a.itemId < b.itemId ? -1 : 1)),
    calibrationRows: calibration,
    historicalEvidence: {
      transferredAsV3Decision: false,
      note: 'v2 strong-model answers, HUMAN adjudications and calibration results stay immutable; none is read as a v3 judgment.',
    },
    authority: {
      humanPacketBuilt: false,
      humanAdjudicationPerformed: false,
      calibrationPerformed: false,
      strongModelOutputRelabeled: false,
      catalogAmendedByThisResult: false,
      surfaceAcceptancePerformed: false,
      referenceLabelFreezePerformed: false,
      finalSelectionPerformed: false,
      trainingOrEvaluationOccurred: false,
    },
    nextGates: [
      `one blind HUMAN packet combining the ${humanAdjudication.length} mandatory rows and ${calibration.length} calibration rows without revealing row role`,
    ],
  };
}

function main(argv = process.argv.slice(2)) {
  if (argv.length !== 4 || argv[0] !== '--results' || argv[2] !== '--output') {
    throw new Error('Usage: --results <raw-results.json> --output <receipt.json>');
  }
  if (fs.existsSync(argv[3])) throw new Error(`Existing output will not be overwritten: ${argv[3]}`);
  const receipt = buildReceipt(builder.loadCanonicalInputs(), fs.readFileSync(argv[1]),
    fs.readFileSync(path.join(ROOT, 'fixtures', PLAN_FIXTURE)));
  fs.writeFileSync(argv[3], `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`Reconciled ${receipt.reviewPacket.rows} rows: ${receipt.reconciliation.agreements} agree, `
    + `${receipt.reconciliation.humanAdjudicationRouted} to HUMAN, ${receipt.calibrationRows.length} calibration\n`);
  return 0;
}

module.exports = {
  ATTEMPT_ID,
  CALIBRATION_HASH_DOMAIN,
  PLAN_SHA256,
  RECEIPT_IDENTITY,
  buildReceipt,
  calibrationHash,
  canonicalReferences,
  main,
  reconcileTargetedV3,
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`P1-B6 batch-003 targeted v3 reconciliation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
