#!/usr/bin/env node
'use strict';

// P1-B6 batch-003 resolution: closes the 26-row gate HUMAN reconciliation attempt-001 left open.
//
// The committed resolution receipt is the authority for each row's final disposition and for
// the repaired source text of 162 and 214. This module proves the receipt covers exactly the
// reconciliation's 26 ineligible rows, that every quoted historical HUMAN field still matches
// the reconciliation receipt, and that each disposition is consistent with v2 (the reconciled
// reference) or v3 (the current authority). It then materializes the two repair candidates.
//
// It does not touch batch-003, v2 or any HUMAN evidence; it moves no HUMAN decision onto the
// repaired text and no retired-skeleton surface onto a replacement skeleton; it accepts nothing.

const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const {
  DISCOURSE_PATTERNS,
  computeFragments,
  decodeSpan,
  utf8Length,
} = require('../lib/memory-inference-p1b6-surfaces');
const { artifactBytes, loadFixture } = require('./build-memory-inference-p1b6-skeleton-semantic-contract-v2');

const RECEIPT_IDENTITY = 'xion-local-memory-inference-p1b6-batch-003-resolution-receipt-v1';
const RECEIPT_FILE = 'local-memory-inference-p1b6-batch-003-resolution-receipt.json';
const RECEIPT_STATUS =
  'COMPLETE_RESOLUTION_REPAIR_CANDIDATES_AND_REPLACEMENT_SURFACES_PENDING_FRESH_GATES';
const CANDIDATE_IDENTITY = 'xion-local-memory-inference-p1b6-surface-repair-candidate-batch-003-v1';
const CANDIDATE_FILE = 'local-memory-inference-p1b6-surface-repair-candidate-batch-003.json';
const CANDIDATE_STATUS =
  'REPAIR_CANDIDATE_AWAITING_FRESH_SOURCE_AUDIT_AND_FRESH_BLIND_HUMAN_REVIEW';
const INTERPRETATION_RULE = 'P1B6_SEMANTIC_CONTRACT_V3';

const item = number => `p1b6-item-b003-${number}`;
// The owner's closed decision set. The receipt must match it exactly.
const AUTHORIZED = Object.freeze({
  REFERENCE_UPHELD_REVIEWER_CORRECTION: ['040', '103', '259'].map(item),
  SEMANTIC_CONTRACT_CORRECTION: ['072', '142', '145', '231'].map(item),
  SURFACE_REPAIR: ['162', '214'].map(item),
  SURFACE_REJECT: ['242', '244', '246', '248', '249'].map(item),
  SKELETON_RETIRED: ['060', '061', '290', '292', '293', '294', '295', '296', '297', '298', '299',
    '300'].map(item),
});
const AUTHORIZED_REPAIR_ITEM_IDS = AUTHORIZED.SURFACE_REPAIR;
const REJECTED_SKELETON_ID = 'p1b6-sk-be0efa305956d111';

// Every input is pinned by identity AND raw SHA, and the receipt must bind the same pair.
const SOURCES = Object.freeze({
  v2: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-skeleton-effective-current-v2',
    rawSha256: 'f1e780195441246402ca389da188b1f7b8c4970f42fc1e6e3de2f436a3e9377c',
    fixture: 'local-memory-inference-p1b6-skeleton-effective-current-v2.json',
    receiptKey: 'priorSemanticAuthority',
  }),
  v3: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-skeleton-effective-current-v3',
    rawSha256: '89a48264d6b09710f976a4ab85235ff161cf81ff44896e37553d5dc7753c65b9',
    fixture: 'local-memory-inference-p1b6-skeleton-effective-current-v3.json',
    receiptKey: 'currentSemanticAuthority',
  }),
  v3Receipt: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-skeleton-semantic-contract-v3-receipt-v1',
    rawSha256: '10f8a10eb3325b86c9d9282fc951ee53b2037918c4258c89a7694822df9a98e1',
    fixture: 'local-memory-inference-p1b6-skeleton-semantic-contract-v3-receipt.json',
    receiptKey: 'semanticContractV3Receipt',
  }),
  batch: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-surface-batch-003-v1',
    rawSha256: '90b453c3680bccaa537fd0d23db74bbc303882e1a35a2ddcea0b75b013fcaa68',
    fixture: 'local-memory-inference-p1b6-surface-batch-003.json',
    receiptKey: 'historicalSourceBatch',
  }),
  sourceAudit: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-source-audit-batch-003-attempt-001-receipt-v1',
    rawSha256: '3c840476bea6eccb522800248a3ace277b26a5334ec56b5f6b10bbf4d5821221',
    fixture: 'local-memory-inference-p1b6-source-audit-batch-003-attempt-001.json',
    receiptKey: 'sourceAuditAttempt',
  }),
  strongModel: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-strong-model-semantic-review-batch-003-attempt-001-receipt-v1',
    rawSha256: '9b65327a4ce6d1923391253659c1acc3bb373bb54acdc7872e3ce74d52337074',
    fixture: 'local-memory-inference-p1b6-strong-model-semantic-review-batch-003-attempt-001.json',
    receiptKey: 'strongModelReviewAttempt',
  }),
  human: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-batch-003-human-adjudication-calibration-attempt-001-receipt-v1',
    rawSha256: '0adbba1789bb91025f277701c51cbf82139092f147966053277573c3f0dbbe6a',
    fixture: 'local-memory-inference-p1b6-batch-003-human-adjudication-calibration-attempt-001.json',
    receiptKey: 'humanReconciliationAttempt',
  }),
});

function fail(message) {
  throw new TypeError(`P1-B6 batch-003 resolution ${message}`);
}

const nonEmptyString = value => typeof value === 'string' && value.trim() !== '';

function verifySources(rawSources) {
  return Object.fromEntries(Object.entries(SOURCES).map(([key, pinned]) => {
    const bytes = rawSources?.[key];
    if (!bytes || sha256RawBytes(Buffer.from(bytes)) !== pinned.rawSha256) {
      fail(`${pinned.identity} bytes are not the pinned artifact`);
    }
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
    if (parsed.name !== pinned.identity) fail(`${pinned.identity} identity is invalid`);
    return [key, parsed];
  }));
}

function validateResolutionReceipt(rawReceiptBytes, rawSources) {
  const artifacts = verifySources(rawSources);
  const receipt = JSON.parse(Buffer.from(rawReceiptBytes).toString('utf8'));
  if (receipt.name !== RECEIPT_IDENTITY || receipt.status !== RECEIPT_STATUS
    || receipt.decisionsSource !== 'REPOSITORY_OWNER_SEMANTIC_ADJUDICATION'
    || receipt.repairCandidateArtifact?.identity !== CANDIDATE_IDENTITY
    || receipt.repairCandidateArtifact.status !== CANDIDATE_STATUS) {
    fail('receipt identity or status is invalid');
  }
  for (const pinned of Object.values(SOURCES)) {
    const binding = receipt.inputs?.[pinned.receiptKey];
    if (binding?.identity !== pinned.identity || binding.rawSha256 !== pinned.rawSha256) {
      fail(`receipt does not bind the canonical ${pinned.receiptKey}`);
    }
  }
  if (receipt.inputs.humanReconciliationAttempt.rawHumanResultSha256
    !== artifacts.human.rawHumanResultArtifact.sha256) {
    fail('receipt does not bind the raw HUMAN result of the reconciled attempt');
  }
  if (!receipt.authority || Object.values(receipt.authority).some(value => value !== false)) {
    fail('receipt claims authority it does not have');
  }
  const pending = receipt.pending || {};
  if (pending.repairCandidateFreshSourceAudit !== true
    || pending.repairCandidateFreshBlindHumanReviewUnderV3 !== true
    || pending.replacementSkeletonSurfaceAuthoring !== true
    || pending.replacementSurfaceSourceAuditAndBlindHumanReview !== true
    || pending.replacementSurfaceForRejectedBe0efa30Rows !== false) {
    fail('receipt does not keep the fresh gates pending');
  }

  // The population is the reconciliation's own ineligible set, never a list in this receipt.
  const required = artifacts.human.reconciliation.resolutionRequiredItemIds;
  const decisions = receipt.decisions;
  if (!Array.isArray(decisions)
    || JSON.stringify(decisions.map(row => row.itemId)) !== JSON.stringify(required)
    || required.length !== 26) {
    fail('receipt does not hold exactly one sorted row per reconciliation-required item');
  }
  for (const [resolution, ids] of Object.entries(AUTHORIZED)) {
    const got = decisions.filter(row => row.resolution === resolution).map(row => row.itemId);
    if (JSON.stringify(got) !== JSON.stringify(ids)) {
      fail(`receipt ${resolution} rows are not the authorized set`);
    }
  }
  const summary = Object.fromEntries(Object.entries(AUTHORIZED)
    .map(([key, ids]) => [key, ids.length]));
  if (JSON.stringify(receipt.summary) !== JSON.stringify({ total: 26, ...summary })) {
    fail('receipt summary does not match its decisions');
  }

  const humanRows = new Map([...artifacts.human.adjudicationRows,
    ...artifacts.human.calibrationRows].map(row => [row.itemId, row]));
  const v3Labels = new Map(artifacts.v3.candidates
    .map(row => [row.semanticSkeletonId, row.humanLabel]));
  const retired = new Map(artifacts.v3.retiredSkeletons
    .map(row => [row.retiredSkeletonId, row.replacementSkeletonId]));
  for (const row of decisions) {
    const human = humanRows.get(row.itemId);
    // Historical HUMAN evidence is quoted, not rewritten.
    if (row.semanticSkeletonId !== human.semanticSkeletonId
      || row.historicalOutcome !== human.outcome
      || row.historicalReferenceLabel !== human.referenceLabel
      || row.historicalHumanDecision !== human.humanDecision
      || !nonEmptyString(row.rationale)) {
      fail(`decision ${row.itemId} does not quote the historical reconciliation row`);
    }
    const expectedLabel = {
      REFERENCE_UPHELD_REVIEWER_CORRECTION: human.referenceLabel,
      SEMANTIC_CONTRACT_CORRECTION: v3Labels.get(row.semanticSkeletonId),
    }[row.resolution] ?? null;
    if (row.resolvedLabel !== expectedLabel
      || (row.resolution === 'SEMANTIC_CONTRACT_CORRECTION'
        && (expectedLabel === human.referenceLabel || !artifacts.v3.amendedSkeletonIds
          .includes(row.semanticSkeletonId)))
      || (row.resolution === 'SKELETON_RETIRED' && !retired.has(row.semanticSkeletonId))
      || (row.resolution === 'SURFACE_REJECT' && row.semanticSkeletonId !== REJECTED_SKELETON_ID)
      || (row.resolution === 'SURFACE_REPAIR') !== Object.hasOwn(row, 'repair')) {
      fail(`decision ${row.itemId} is inconsistent with its resolution`);
    }
  }

  // Every historical surface on a retired skeleton stays historical, including rows that were
  // never routed to HUMAN review.
  const expectedSiblings = [...retired].map(([retiredId, replacementId]) => ({
    retiredSkeletonId: retiredId,
    replacementSkeletonId: replacementId,
    historicalItemIds: artifacts.batch.items
      .filter(row => row.semanticSkeletonId === retiredId).map(row => row.itemId),
    transferredToReplacement: false,
    prospectiveStatus: 'HISTORICAL_EVIDENCE_ONLY',
  })).sort((a, b) => (a.retiredSkeletonId < b.retiredSkeletonId ? -1 : 1));
  if (JSON.stringify(receipt.retiredSkeletonSurfaces) !== JSON.stringify(expectedSiblings)) {
    fail('receipt does not keep every retired-skeleton surface historical');
  }
  return { receipt, artifacts };
}

function repairedRow(decision, historicalItem, historicalEpisode) {
  const { repair } = decision;
  if (!Array.isArray(repair.intendedUnresolvedReadings)
    || repair.intendedUnresolvedReadings.length !== 2
    || !repair.intendedUnresolvedReadings.every(nonEmptyString)
    || !DISCOURSE_PATTERNS.includes(repair.discoursePattern)
    || !nonEmptyString(repair.anchorText) || !Array.isArray(repair.turns)) {
    fail(`repair row is invalid: ${decision.itemId}`);
  }
  const turns = new Map(repair.turns.map(turn => [turn.turnId, turn]));
  const anchorTurn = turns.get(repair.anchorTurnId);
  if (!anchorTurn) fail(`anchor turn is not in the repaired episode: ${decision.itemId}`);
  const haystack = Buffer.from(anchorTurn.text, 'utf8');
  const startByte = haystack.indexOf(Buffer.from(repair.anchorText, 'utf8'));
  if (startByte < 0 || haystack.indexOf(Buffer.from(repair.anchorText, 'utf8'), startByte + 1) >= 0) {
    fail(`anchor text is not unique in its repaired turn: ${decision.itemId}`);
  }
  // Offsets are recomputed from the repaired text; no historical offset is reused.
  return {
    episode: {
      sourceEpisodeId: historicalEpisode.sourceEpisodeId,
      sourceFamilyId: historicalEpisode.sourceFamilyId,
      splitAssignment: historicalEpisode.splitAssignment,
      language: historicalEpisode.language,
      turns: repair.turns.map(turn => ({ ...turn })),
    },
    item: {
      itemId: decision.itemId,
      sourceEpisodeId: historicalEpisode.sourceEpisodeId,
      semanticSkeletonId: decision.semanticSkeletonId,
      anchorSpanRef: {
        turnId: anchorTurn.turnId,
        startByte,
        endByte: startByte + utf8Length(repair.anchorText),
      },
      anchorText: repair.anchorText,
      evidenceSpanRefs: repair.evidenceTurnIds.map(turnId => {
        const turn = turns.get(turnId);
        if (!turn) fail(`evidence turn is not in the repaired episode: ${decision.itemId}`);
        return { turnId, startByte: 0, endByte: utf8Length(turn.text) };
      }),
      discoursePattern: repair.discoursePattern,
      surfaceFamilyId: historicalItem.surfaceFamilyId,
      historicalDiscoursePattern: historicalItem.discoursePattern,
      intendedUnresolvedReadings: [...repair.intendedUnresolvedReadings],
    },
  };
}

function validateRepairCandidate(candidate, v3) {
  if (candidate.name !== CANDIDATE_IDENTITY || candidate.status !== CANDIDATE_STATUS
    || candidate.interpretationRule !== INTERPRETATION_RULE
    || Object.values(candidate.authority).some(value => value !== false)) {
    fail('repair candidate identity, status or authority is invalid');
  }
  if (JSON.stringify(candidate.items.map(row => row.itemId))
    !== JSON.stringify(AUTHORIZED_REPAIR_ITEM_IDS)) {
    fail('repair candidate does not hold exactly the authorized repaired rows');
  }
  const skeletons = new Map(v3.candidates.map(row => [row.semanticSkeletonId, row]));
  const episodes = new Map(candidate.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  for (const row of candidate.items) {
    const episode = episodes.get(row.sourceEpisodeId);
    const skeleton = skeletons.get(row.semanticSkeletonId);
    if (!episode || !skeleton || episode.splitAssignment !== skeleton.splitAssignment) {
      fail(`repaired row does not sit on an active v3 skeleton in its split: ${row.itemId}`);
    }
    episode.turns.forEach((turn, index) => {
      if (turn.turnId !== `t${index + 1}` || !['USER', 'ASSISTANT'].includes(turn.role)
        || !nonEmptyString(turn.text) || /[\r\n]|\[\/?TARGET\]/u.test(turn.text)) {
        fail(`invalid repaired turn in ${episode.sourceEpisodeId}`);
      }
    });
    const turns = new Map(episode.turns.map(turn => [turn.turnId, turn]));
    if (decodeSpan(turns.get(row.anchorSpanRef.turnId).text, row.anchorSpanRef) !== row.anchorText
      || !row.evidenceSpanRefs.some(span => span.turnId === row.anchorSpanRef.turnId)) {
      fail(`anchor is not inside its repaired evidence: ${row.itemId}`);
    }
    const order = episode.turns.map(turn => turn.turnId);
    const positions = row.evidenceSpanRefs.map(span => order.indexOf(span.turnId));
    if (positions.some((value, index) => index > 0 && value <= positions[index - 1])) {
      fail(`evidence spans are not in source order: ${row.itemId}`);
    }
    const fragments = computeFragments(row, episode).length;
    if (fragments < 1 || fragments > 5) fail(`fragment count must be 1..5: ${row.itemId}`);
  }
  return candidate;
}

function buildRepairCandidate(rawReceiptBytes, rawSources) {
  const { receipt, artifacts } = validateResolutionReceipt(rawReceiptBytes, rawSources);
  const items = new Map(artifacts.batch.items.map(row => [row.itemId, row]));
  const episodes = new Map(artifacts.batch.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  const rows = receipt.decisions.filter(row => row.resolution === 'SURFACE_REPAIR')
    .map(decision => {
      const historical = items.get(decision.itemId);
      return repairedRow(decision, historical, episodes.get(historical.sourceEpisodeId));
    });
  const candidate = {
    name: CANDIDATE_IDENTITY,
    status: CANDIDATE_STATUS,
    interpretationRule: INTERPRETATION_RULE,
    provenance: {
      resolutionReceipt: { identity: RECEIPT_IDENTITY, rawSha256: sha256RawBytes(rawReceiptBytes) },
      historicalSourceBatch: {
        identity: SOURCES.batch.identity,
        rawSha256: SOURCES.batch.rawSha256,
        role: 'IMMUTABLE_HISTORICAL_SURFACE_SOURCE',
      },
      semanticAuthority: {
        identity: SOURCES.v3.identity,
        rawSha256: SOURCES.v3.rawSha256,
        role: 'PROSPECTIVE_SEMANTIC_AUTHORITY',
      },
      note: 'Item, skeleton, episode and family IDs are carried from the historical rows so provenance stays explicit. Byte offsets are recomputed from the repaired text. No HUMAN decision recorded against the old text applies here.',
    },
    pending: { freshSourceAudit: true, freshBlindHumanReviewUnderV3: true },
    authority: {
      humanDecisionsTransferredFromOldSurfaces: false,
      humanReviewPerformed: false,
      sourceAuditPerformed: false,
      repairedRowsAccepted: false,
      datasetAcceptancePerformed: false,
      heldOutReleasePerformed: false,
      trainingOccurred: false,
    },
    sourceEpisodes: rows.map(row => row.episode),
    items: rows.map(row => row.item),
  };
  return validateRepairCandidate(candidate, artifacts.v3);
}

function loadSources() {
  return Object.fromEntries(Object.entries(SOURCES)
    .map(([key, pinned]) => [key, loadFixture(pinned.fixture)]));
}

function main() {
  const candidate = buildRepairCandidate(loadFixture(RECEIPT_FILE), loadSources());
  const outputPath = path.join(__dirname, '..', 'fixtures', CANDIDATE_FILE);
  fs.writeFileSync(outputPath, artifactBytes(candidate));
  process.stdout.write(`Built P1-B6 batch-003 repair candidate: ${outputPath}\n`);
  return 0;
}

module.exports = {
  AUTHORIZED,
  AUTHORIZED_REPAIR_ITEM_IDS,
  CANDIDATE_FILE,
  CANDIDATE_IDENTITY,
  RECEIPT_FILE,
  SOURCES,
  buildRepairCandidate,
  loadSources,
  main,
  validateResolutionReceipt,
};

if (require.main === module) process.exit(main());
