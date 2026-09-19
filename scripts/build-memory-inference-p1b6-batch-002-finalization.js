#!/usr/bin/env node
'use strict';

// Batch-002 finalization: the effective-current surface successor, its effective HUMAN
// successor, and the batch-002 acceptance artifact.
//
// This closes the batch-002 repair/reconciliation cycle and nothing beyond it. It does not
// freeze final corpus HUMAN gold, run repeated HELD review, release FINAL_HELD_OUT, perform
// deterministic FINAL selection, train, or inspect FINAL model outputs. The P1-B6 corpus is
// NOT complete; construction continues later from the accepted pool.
//
// Deliberately specific to batch-002. No generic multi-batch abstraction is introduced.

const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const {
  AUTHORIZED_REJECT_ITEM_IDS,
  AUTHORIZED_REPAIR_ITEM_IDS,
} = require('./build-memory-inference-p1b6-surface-repair-candidate');
const humanPacketBuilder =
  require('./build-memory-inference-p1b6-surface-repair-human-review-packet');

const ROOT = path.resolve(__dirname, '..');
const SURFACE_SUCCESSOR_IDENTITY =
  'xion-local-memory-inference-p1b6-surface-effective-current-batch-002-v1';
const HUMAN_SUCCESSOR_IDENTITY =
  'xion-local-memory-inference-p1b6-primary-human-accepted-current-batch-002-v1';
const ACCEPTANCE_IDENTITY = 'xion-local-memory-inference-p1b6-batch-002-acceptance-v1';
const SURFACE_SUCCESSOR_FILE = 'local-memory-inference-p1b6-surface-effective-current-batch-002.json';
const HUMAN_SUCCESSOR_FILE =
  'local-memory-inference-p1b6-primary-human-accepted-current-batch-002.json';
const ACCEPTANCE_FILE = 'local-memory-inference-p1b6-batch-002-acceptance.json';

const REJECTED_ITEM_ID = 'p1b6-item-b002-050';
const REJECTION_REASON_CODE = 'PHASE_B_CURRENT_SURFACE_REALIZATION_REJECTED';
const EXPECTED_POPULATION = Object.freeze({
  reviewedOriginal: 64, inherited: 51, repaired: 12, rejected: 1, accepted: 63,
});
const EXPECTED_HUMAN_SUMMARY = Object.freeze({
  total: 63, KEEP: 63, FIX: 0, REJECT: 0, CLEAR: 39, ESCALATE: 24,
});
// Smoke batch-001 closed at 30 accepted and is not reopened here.
const SMOKE_BATCH_001_ACCEPTED = 30;
const EXPECTED_CUMULATIVE_ACCEPTED_POOL = 93;

// Every canonical input is pinned by identity AND raw SHA and verified against the supplied
// bytes before anything is derived.
const CANONICAL_INPUTS = Object.freeze({
  historicalBatch: Object.freeze({
    label: 'historical batch-002',
    identity: 'xion-local-memory-inference-p1b6-surface-batch-002-v1',
    rawSha256: 'ed68a562a67deee4d8e92d3e4841362d9589f876480d174a043d822cbf61e80c',
    fixture: 'local-memory-inference-p1b6-surface-batch-002.json',
  }),
  historicalHuman: Object.freeze({
    label: 'historical effective HUMAN batch-002 v2',
    identity: 'xion-local-memory-inference-p1b6-primary-human-effective-current-batch-002-v2',
    rawSha256: 'a96fc01393c79057d292cf10b565589e7448b86289eb52b8cd1c63657af2ed05',
    fixture: 'local-memory-inference-p1b6-primary-human-effective-current-batch-002-v2.json',
  }),
  effectiveCatalog: Object.freeze({
    label: 'effective-current skeleton catalog',
    identity: 'xion-local-memory-inference-p1b6-skeleton-effective-current-v1',
    rawSha256: '48490b6e4e1494856ef3268d944da16093c4735d207e07c1fd9e8bbf69df2559',
    fixture: 'local-memory-inference-p1b6-skeleton-effective-current.json',
  }),
  resolutionReceipt: Object.freeze({
    label: 'Phase B resolution receipt',
    identity: 'xion-local-memory-inference-p1b6-surface-repair-resolution-batch-002-receipt-v1',
    rawSha256: '792cb050b08375fd6dec9e8ce2b1a04787760123496b3dfed601aac984f4626d',
    fixture: 'local-memory-inference-p1b6-surface-repair-resolution-batch-002-receipt.json',
  }),
  repairCandidate: Object.freeze({
    label: 'repair candidate batch-002',
    identity: 'xion-local-memory-inference-p1b6-surface-repair-candidate-batch-002-v1',
    rawSha256: 'd59d0dec225d3f4fea74952da10e05b8f0be01942a3aa6e15ea58d659e22abb3',
    fixture: 'local-memory-inference-p1b6-surface-repair-candidate-batch-002.json',
  }),
  sourceAuditReceipt: Object.freeze({
    label: 'fresh source-audit receipt',
    identity:
      'xion-local-memory-inference-p1b6-surface-repair-source-audit-batch-002-attempt-001-receipt-v1',
    rawSha256: 'd08bf4488d4fa4a89c8f03172c4569405093051e939fea395a85b5fafda254b9',
    fixture: 'local-memory-inference-p1b6-surface-repair-source-audit-batch-002-attempt-001.json',
  }),
  humanReviewReceipt: Object.freeze({
    label: 'fresh blind HUMAN review receipt',
    identity:
      'xion-local-memory-inference-p1b6-surface-repair-primary-human-review-batch-002-attempt-001-receipt-v1',
    rawSha256: 'cab70e8a277189e0eee1847adcc89e114139363f20cebb95d39c7153fac30f04',
    fixture:
      'local-memory-inference-p1b6-surface-repair-primary-human-review-batch-002-attempt-001.json',
  }),
  provenanceCorrection: Object.freeze({
    label: 'HUMAN review provenance correction',
    identity:
      'xion-local-memory-inference-p1b6-surface-repair-human-review-provenance-correction-v1',
    rawSha256: 'd7f635596f12c37241a7ccb231eeb244fec37b6b8d9ec459aa99d575b3747314',
    fixture: 'local-memory-inference-p1b6-surface-repair-human-review-provenance-correction.json',
  }),
  smokeAcceptance: Object.freeze({
    label: 'smoke batch-001 acceptance',
    identity: 'xion-local-memory-inference-p1b6-smoke-batch-001-acceptance-v1',
    rawSha256: '449318d5d3895fca87257a40b7d47b6d8d8eb3df8e9817fff5998a34d658bb5c',
    fixture: 'local-memory-inference-p1b6-smoke-batch-001-acceptance.json',
  }),
});

function fail(message) {
  throw new TypeError(`P1-B6 batch-002 finalization ${message}`);
}

function artifactBytes(artifact) {
  return Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
}

function countBy(rows, field) {
  return rows.reduce((counts, row) => {
    counts[row[field]] = (counts[row[field]] || 0) + 1;
    return counts;
  }, {});
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

// The correction is pinned like every other canonical input. What it must NOT do is claim
// independence or touch the historical receipt, so those are checked as content, not just bytes.
function verifyProvenanceCorrection(rawBytes, humanReviewReceiptSha256) {
  const correction = verifyCanonicalInput('provenanceCorrection', rawBytes);
  if (correction.correctedArtifact.rawSha256 !== humanReviewReceiptSha256
    || correction.correctedArtifact.identity !== CANONICAL_INPUTS.humanReviewReceipt.identity
    || correction.correctedArtifact.bytesAmended !== false
    || correction.inaccurateClaim.field !== 'reviewIndependence.reviewerAuthoredTheRepairs'
    || correction.correction.reviewerPersonallyAuthoredAllTwelveRepairedSurfaceTexts !== false
    || correction.correction.reviewerPerformedFinalHumanJudgments !== true
    || !correction.correction.interpretationRule.includes('MUST NOT be interpreted as literal')
    || correction.preservedLimitation.reviewerKnewEveryPresentedRowWasARepair !== true
    || correction.preservedLimitation.reviewerKnewThePurposeWasToRestoreAmbiguity !== true
    || correction.preservedLimitation.reviewerIndependentConfirmationEstablished !== false
    || !correction.preservedLimitation.statement.includes('does NOT establish')
    || correction.authority.reviewerIndependenceClaimed !== false
    || correction.authority.historicalReceiptBytesAltered !== false
    || correction.authority.humanDecisionsAltered !== false) {
    fail('provenance correction does not narrowly correct authorship while preserving the limitation');
  }
  return correction;
}

function verifyCanonicalInputs(canonicalInputs) {
  if (!canonicalInputs || typeof canonicalInputs !== 'object') {
    fail('canonical input bytes were not supplied');
  }
  const artifacts = {};
  for (const key of Object.keys(CANONICAL_INPUTS)) {
    if (key === 'provenanceCorrection') continue;
    artifacts[key] = verifyCanonicalInput(key, canonicalInputs[key]);
  }
  artifacts.provenanceCorrection = verifyProvenanceCorrection(
    canonicalInputs.provenanceCorrection, CANONICAL_INPUTS.humanReviewReceipt.rawSha256);
  return artifacts;
}

// Opaque fresh review IDs are mapped back to item IDs through the packet builder, never by a
// table written here.
function freshHumanDecisions(artifacts, candidateSha256) {
  const receipt = artifacts.humanReviewReceipt;
  const byReviewRowId = new Map(artifacts.repairCandidate.items
    .map(item => [humanPacketBuilder.opaqueReviewRowId(candidateSha256, item.itemId), item.itemId]));
  const decisions = new Map();
  for (const row of receipt.rows) {
    const itemId = byReviewRowId.get(row.reviewRowId);
    if (!itemId) fail(`a fresh HUMAN row maps to no repaired item: ${row.reviewRowId}`);
    if (row.disposition !== 'KEEP') {
      fail(`a repaired row is not KEEP and cannot be accepted: ${row.reviewRowId}`);
    }
    if (decisions.has(itemId)) fail(`duplicate fresh HUMAN decision for ${itemId}`);
    decisions.set(itemId, row.decision);
  }
  if (decisions.size !== AUTHORIZED_REPAIR_ITEM_IDS.length) {
    fail('fresh HUMAN decisions do not cover exactly the repaired rows');
  }
  return decisions;
}

function buildBatch002Finalization(canonicalInputs) {
  const artifacts = verifyCanonicalInputs(canonicalInputs);
  const candidateSha256 = CANONICAL_INPUTS.repairCandidate.rawSha256;
  const historical = artifacts.historicalBatch;
  const candidate = artifacts.repairCandidate;

  // The repaired population is exactly what Phase B authorized, and 050 is not in it.
  const repairedIds = candidate.items.map(row => row.itemId);
  if (JSON.stringify(repairedIds) !== JSON.stringify([...AUTHORIZED_REPAIR_ITEM_IDS])
    || repairedIds.includes(REJECTED_ITEM_ID)
    || JSON.stringify([...AUTHORIZED_REJECT_ITEM_IDS]) !== JSON.stringify([REJECTED_ITEM_ID])) {
    fail('repaired population is not exactly the 12 authorized rows');
  }
  const rejectedDecision = artifacts.resolutionReceipt.decisions
    .find(row => row.itemId === REJECTED_ITEM_ID);
  if (rejectedDecision?.decision !== 'REJECT'
    || rejectedDecision.rejectedScope !== 'CURRENT_SURFACE_REALIZATION_ONLY'
    || rejectedDecision.skeletonAmended !== false
    || rejectedDecision.replacementAuthored !== false) {
    fail('the Phase B rejection of 050 is missing or was widened');
  }

  const excluded = new Set([...repairedIds, REJECTED_ITEM_ID]);
  const inheritedItems = historical.items.filter(row => !excluded.has(row.itemId));
  if (historical.items.length !== EXPECTED_POPULATION.reviewedOriginal
    || inheritedItems.length !== EXPECTED_POPULATION.inherited
    || repairedIds.length !== EXPECTED_POPULATION.repaired) {
    fail('population is not 51 inherited + 12 repaired + 1 rejected');
  }

  const historicalDecisions = new Map(artifacts.historicalHuman.rows
    .map(row => [row.itemId, row]));
  const fresh = freshHumanDecisions(artifacts, candidateSha256);

  const historicalEpisodes = new Map(historical.sourceEpisodes
    .map(row => [row.sourceEpisodeId, row]));
  const candidateEpisodes = new Map(candidate.sourceEpisodes
    .map(row => [row.sourceEpisodeId, row]));

  const rows = [];
  const episodes = [];
  for (const item of inheritedItems) {
    const decision = historicalDecisions.get(item.itemId);
    if (!decision || decision.disposition !== 'KEEP') {
      fail(`an inherited row has no KEEP HUMAN decision: ${item.itemId}`);
    }
    episodes.push(structuredClone(historicalEpisodes.get(item.sourceEpisodeId)));
    rows.push({
      ...structuredClone(item),
      realizationOrigin: 'INHERITED_HISTORICAL_BATCH_002',
      humanDecision: decision.decision,
      humanDecisionSource: CANONICAL_INPUTS.historicalHuman.identity,
    });
  }
  for (const item of candidate.items) {
    // The old HUMAN decision belongs to the OLD surface text and must never travel here.
    const decision = fresh.get(item.itemId);
    if (!decision) fail(`a repaired row has no fresh HUMAN decision: ${item.itemId}`);
    episodes.push(structuredClone(candidateEpisodes.get(item.sourceEpisodeId)));
    rows.push({
      ...structuredClone(item),
      realizationOrigin: 'REPAIRED_PHASE_B_CANDIDATE',
      humanDecision: decision,
      humanDecisionSource: CANONICAL_INPUTS.humanReviewReceipt.identity,
    });
  }

  if (rows.length !== EXPECTED_POPULATION.accepted
    || new Set(rows.map(row => row.itemId)).size !== EXPECTED_POPULATION.accepted
    || rows.some(row => row.itemId === REJECTED_ITEM_ID)) {
    fail('successor population is not exactly 63 unique accepted rows without 050');
  }

  // Reconciliation is against the effective-current catalog, never historical Exact56.
  const labels = new Map(artifacts.effectiveCatalog.candidates
    .map(row => [row.semanticSkeletonId, row.humanLabel]));
  const mismatches = rows.filter(row => labels.get(row.semanticSkeletonId) !== row.humanDecision)
    .map(row => row.itemId);
  if (mismatches.length !== 0) {
    fail(`accepted rows mismatch effective-current skeleton semantics: ${mismatches.join(', ')}`);
  }

  const humanRows = rows.map(row => ({
    itemId: row.itemId,
    disposition: 'KEEP',
    decision: row.humanDecision,
    realizationOrigin: row.realizationOrigin,
  }));
  const humanSummary = {
    total: humanRows.length,
    KEEP: humanRows.filter(row => row.disposition === 'KEEP').length,
    FIX: 0,
    REJECT: 0,
    ...{ CLEAR: 0, ESCALATE: 0, ...countBy(humanRows, 'decision') },
  };
  if (JSON.stringify(humanSummary) !== JSON.stringify(EXPECTED_HUMAN_SUMMARY)) {
    fail('effective HUMAN successor aggregate is not 63 KEEP / 39 CLEAR / 24 ESCALATE');
  }

  const acceptedCount = artifacts.smokeAcceptance.summary.accepted;
  if (acceptedCount !== SMOKE_BATCH_001_ACCEPTED
    || acceptedCount + rows.length !== EXPECTED_CUMULATIVE_ACCEPTED_POOL) {
    fail('cumulative accepted pool is not 93');
  }

  // Structural guarantee that no old HUMAN decision reached repaired text: every repaired row
  // is sourced from the fresh receipt, every inherited row from the historical artifact, and
  // the two sets are disjoint.
  const repairedSet = new Set(repairedIds);
  if (rows.some(row => repairedSet.has(row.itemId)
      && row.humanDecisionSource !== CANONICAL_INPUTS.humanReviewReceipt.identity)
    || rows.some(row => !repairedSet.has(row.itemId)
      && row.humanDecisionSource !== CANONICAL_INPUTS.historicalHuman.identity)
    || rows.some(row => repairedSet.has(row.itemId)
      && row.humanDecision !== fresh.get(row.itemId))) {
    fail('a repaired row did not take its decision from the fresh HUMAN receipt');
  }

  const binding = key => ({
    identity: CANONICAL_INPUTS[key].identity,
    rawSha256: CANONICAL_INPUTS[key].rawSha256,
  });

  const surfaceSuccessor = {
    name: SURFACE_SUCCESSOR_IDENTITY,
    status: 'ACCEPTED_CURRENT_REALIZATIONS_BATCH_002',
    provenance: {
      historicalBatch: { ...binding('historicalBatch'), role: 'IMMUTABLE_HISTORICAL_SOURCE' },
      repairCandidate: { ...binding('repairCandidate'), role: 'REPAIRED_REALIZATION_SOURCE' },
      effectiveCurrentSkeletonCatalog: {
        ...binding('effectiveCatalog'), role: 'SEMANTIC_AUTHORITY',
      },
      rejectedItemIds: [REJECTED_ITEM_ID],
      note: 'The historical 64-row batch is not modified. Inherited rows are carried byte-identically from it; repaired rows are carried byte-identically from the repair candidate, including their recomputed offsets.',
    },
    coverage: {
      reviewedOriginal: EXPECTED_POPULATION.reviewedOriginal,
      inherited: EXPECTED_POPULATION.inherited,
      repaired: EXPECTED_POPULATION.repaired,
      rejected: EXPECTED_POPULATION.rejected,
      total: rows.length,
      humanDecisionCounts: countBy(rows, 'humanDecision'),
    },
    authority: {
      historicalBatchSuperseded: false,
      finalCorpusHumanGoldFrozen: false,
      heldRepeatedReviewCompleted: false,
      heldOutReleasePerformed: false,
      finalSelectionPerformed: false,
      trainingOccurred: false,
    },
    sourceEpisodes: episodes,
    items: rows,
  };

  const humanSuccessor = {
    name: HUMAN_SUCCESSOR_IDENTITY,
    status: 'ACCEPTED_CURRENT_HUMAN_STATE_BATCH_002',
    supersededScope: {
      identity: CANONICAL_INPUTS.historicalHuman.identity,
      rawSha256: CANONICAL_INPUTS.historicalHuman.rawSha256,
      note: 'The historical 64-row HUMAN artifact stays byte-identical and remains the evidence for the OLD surfaces. Its decisions for the 12 repaired items and for the rejected 050 are deliberately NOT carried forward.',
    },
    decisionSources: {
      inherited: binding('historicalHuman'),
      repaired: binding('humanReviewReceipt'),
      repairedProvenanceCorrection: binding('provenanceCorrection'),
    },
    reconciliation: {
      against: CANONICAL_INPUTS.effectiveCatalog.identity,
      rawSha256: CANONICAL_INPUTS.effectiveCatalog.rawSha256,
      matchCount: rows.length,
      mismatchCount: 0,
    },
    reviewIndependence: {
      repairedRowsIndependentlyConfirmed: false,
      note: 'The fresh blind HUMAN review of the repaired rows is not reviewer-independent; see the provenance correction and the HUMAN receipt.',
    },
    summary: humanSummary,
    authority: {
      humanReviewCompletedForBatch002: true,
      oldHumanDecisionsTransferredToRepairedText: false,
      finalCorpusHumanGoldFrozen: false,
      heldRepeatedReviewCompleted: false,
      heldOutReleasePerformed: false,
      finalSelectionPerformed: false,
      trainingOccurred: false,
    },
    rows: humanRows,
  };

  const acceptance = {
    name: ACCEPTANCE_IDENTITY,
    status: 'COMPLETE_WITH_REJECTIONS',
    bindings: {
      historicalBatch: binding('historicalBatch'),
      repairResolutionReceipt: binding('resolutionReceipt'),
      repairCandidate: binding('repairCandidate'),
      freshSourceAuditReceipt: binding('sourceAuditReceipt'),
      freshHumanReviewReceipt: binding('humanReviewReceipt'),
      humanReviewProvenanceCorrection: binding('provenanceCorrection'),
      effectiveCurrentSkeletonCatalog: binding('effectiveCatalog'),
      surfaceEffectiveCurrentSuccessor: {
        identity: SURFACE_SUCCESSOR_IDENTITY,
        rawSha256: sha256RawBytes(artifactBytes(surfaceSuccessor)),
      },
      humanAcceptedCurrentSuccessor: {
        identity: HUMAN_SUCCESSOR_IDENTITY,
        rawSha256: sha256RawBytes(artifactBytes(humanSuccessor)),
      },
    },
    summary: {
      reviewed: EXPECTED_POPULATION.reviewedOriginal,
      accepted: rows.length,
      rejected: EXPECTED_POPULATION.rejected,
      unresolved: 0,
    },
    corpusGrowth: {
      smokeBatch001Accepted: acceptedCount,
      batch002Accepted: rows.length,
      cumulativeAcceptedSurfacePool: acceptedCount + rows.length,
      note: 'Corpus-growth state, not final corpus completion. P1-B6 corpus construction continues from this pool.',
    },
    reconciliation: {
      against: CANONICAL_INPUTS.effectiveCatalog.identity,
      matchCount: rows.length,
      mismatchCount: 0,
      historicalExact56Role: 'IMMUTABLE_PROVENANCE_NOT_SEMANTIC_AUTHORITY',
    },
    authority: {
      sourceBundleGatePassed: true,
      primaryHumanReviewResolved: true,
      repairedRowsIndependentlyConfirmed: false,
      finalCorpusHumanGoldFrozen: false,
      heldRepeatedReviewCompleted: false,
      heldOutReleasePerformed: false,
      finalSelectionPerformed: false,
      trainingOccurred: false,
      finalModelOutputsInspected: false,
      p1b6CorpusComplete: false,
    },
    accepted: rows.map(row => ({
      itemId: row.itemId,
      decision: row.humanDecision,
      realizationOrigin: row.realizationOrigin,
    })),
    rejected: [{
      itemId: REJECTED_ITEM_ID,
      reasonCode: REJECTION_REASON_CODE,
      rejectedScope: rejectedDecision.rejectedScope,
      reason: rejectedDecision.rejectionRationale,
      skeletonAmended: false,
      replacementAuthored: false,
    }],
  };

  if (acceptance.rejected.length !== EXPECTED_POPULATION.rejected
    || acceptance.accepted.length !== EXPECTED_POPULATION.accepted
    || acceptance.accepted.some(row => row.itemId === REJECTED_ITEM_ID)) {
    fail('acceptance is not 63 accepted / 1 rejected / 0 unresolved');
  }
  return { surfaceSuccessor, humanSuccessor, acceptance };
}

function loadCanonicalInputs() {
  return Object.fromEntries(Object.entries(CANONICAL_INPUTS)
    .map(([key, pinned]) => [key, fs.readFileSync(path.join(ROOT, 'fixtures', pinned.fixture))]));
}

function main() {
  const built = buildBatch002Finalization(loadCanonicalInputs());
  const written = [
    [SURFACE_SUCCESSOR_FILE, built.surfaceSuccessor],
    [HUMAN_SUCCESSOR_FILE, built.humanSuccessor],
    [ACCEPTANCE_FILE, built.acceptance],
  ];
  for (const [file, artifact] of written) {
    const outputPath = path.join(ROOT, 'fixtures', file);
    fs.writeFileSync(outputPath, artifactBytes(artifact));
    process.stdout.write(`${file}: ${sha256RawBytes(artifactBytes(artifact))}\n`);
  }
  return 0;
}

module.exports = {
  ACCEPTANCE_FILE,
  ACCEPTANCE_IDENTITY,
  CANONICAL_INPUTS,
  EXPECTED_CUMULATIVE_ACCEPTED_POOL,
  EXPECTED_HUMAN_SUMMARY,
  EXPECTED_POPULATION,
  HUMAN_SUCCESSOR_FILE,
  HUMAN_SUCCESSOR_IDENTITY,
  REJECTED_ITEM_ID,
  SURFACE_SUCCESSOR_FILE,
  SURFACE_SUCCESSOR_IDENTITY,
  artifactBytes,
  buildBatch002Finalization,
  loadCanonicalInputs,
  main,
  verifyProvenanceCorrection,
};

if (require.main === module) process.exit(main());
