#!/usr/bin/env node
'use strict';

// P1-B6 Phase B surface repair materialization.
//
// Phase A amended the skeleton semantics and left one blocker: the repair-versus-rejection
// decision for the 13 current batch-002 surface realizations that still mismatch the
// effective-current catalog. The committed resolution receipt is the authority for WHICH
// realizations are repaired and for their repaired source text; this module validates that
// receipt against the canonical historical inputs and materializes the repair candidates.
//
// What this module does NOT do: it does not touch the historical batch, Exact56, the
// historical HUMAN decisions, or the historical pragmatic routing; it does not build a
// 63-row effective-current successor; and it carries no HUMAN decision forward onto repaired
// source text. The old HUMAN labels were recorded against the old surfaces and are evidence
// for those only.

const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const {
  DISCOURSE_PATTERNS,
  computeFragments,
  decodeSpan,
  utf8Length,
} = require('../lib/memory-inference-p1b6-surfaces');
const { reconcileAgainstCatalog } = require('./build-memory-inference-p1b6-skeleton-semantic-amendment');

const RECEIPT_IDENTITY =
  'xion-local-memory-inference-p1b6-surface-repair-resolution-batch-002-receipt-v1';
const CANDIDATE_IDENTITY =
  'xion-local-memory-inference-p1b6-surface-repair-candidate-batch-002-v1';
const CANDIDATE_STATUS =
  'REPAIR_CANDIDATE_AWAITING_FRESH_SOURCE_AUDIT_AND_FRESH_BLIND_HUMAN_REVIEW';
const RECEIPT_STATUS = 'COMPLETE_PHASE_B_SURFACE_RESOLUTION_REPAIR_CANDIDATES_PENDING_REVIEW';
const INTERPRETATION_RULE = 'CONSERVATIVE_PRAGMATIC_INTERPRETATION';
const CANDIDATE_FILE = 'local-memory-inference-p1b6-surface-repair-candidate-batch-002.json';
const RECEIPT_FILE =
  'local-memory-inference-p1b6-surface-repair-resolution-batch-002-receipt.json';

// The Phase B authorization envelope. The receipt supplies the decisions; these constants
// bound them, so an edited receipt cannot widen the repair set or rescue the rejected row.
const AUTHORIZED_REPAIR_ITEM_IDS = Object.freeze([
  'p1b6-item-b002-022', 'p1b6-item-b002-024', 'p1b6-item-b002-029', 'p1b6-item-b002-032',
  'p1b6-item-b002-034', 'p1b6-item-b002-037', 'p1b6-item-b002-039', 'p1b6-item-b002-047',
  'p1b6-item-b002-049', 'p1b6-item-b002-051', 'p1b6-item-b002-059', 'p1b6-item-b002-063',
]);
const AUTHORIZED_REJECT_ITEM_IDS = Object.freeze(['p1b6-item-b002-050']);
const EXPECTED_SUMMARY = Object.freeze({ total: 13, REPAIR: 12, REJECT: 1 });

// Every historical input is pinned by identity AND raw SHA. The builder verifies the supplied
// bytes against these constants, so hashing whatever is on disk can never define "canonical",
// and coordinated drift of a source plus its receipt SHA still fails closed.
const HISTORICAL_SOURCES = Object.freeze({
  exact56: Object.freeze({
    label: 'historical Exact56 freeze',
    identity: 'xion-local-memory-inference-p1b6-skeleton-exact56-v1',
    rawSha256: '772f07bd679a9c98ea65feaa164ec7a9c1f3e3fb33632052ef076f8301999602',
    fixture: 'local-memory-inference-p1b6-skeleton-exact56.json',
    receiptField: receipt => receipt.historicalExact56,
  }),
  effectiveCatalog: Object.freeze({
    label: 'effective-current skeleton catalog',
    identity: 'xion-local-memory-inference-p1b6-skeleton-effective-current-v1',
    rawSha256: '48490b6e4e1494856ef3268d944da16093c4735d207e07c1fd9e8bbf69df2559',
    fixture: 'local-memory-inference-p1b6-skeleton-effective-current.json',
    receiptField: receipt => receipt.effectiveCurrentSkeletonCatalog,
  }),
  amendmentReceipt: Object.freeze({
    label: 'Phase A semantic amendment receipt',
    identity: 'xion-local-memory-inference-p1b6-skeleton-semantic-amendment-receipt-v1',
    rawSha256: '2778f64cf9f8f15bc85b7d015b706f5e87ad20e9dafc1249357477b235744977',
    fixture: 'local-memory-inference-p1b6-skeleton-semantic-amendment-receipt.json',
    receiptField: receipt => receipt.semanticAmendmentReceipt,
  }),
  sourceBatch: Object.freeze({
    label: 'historical batch-002 surface source',
    identity: 'xion-local-memory-inference-p1b6-surface-batch-002-v1',
    rawSha256: 'ed68a562a67deee4d8e92d3e4841362d9589f876480d174a043d822cbf61e80c',
    fixture: 'local-memory-inference-p1b6-surface-batch-002.json',
    receiptField: receipt => receipt.historicalSourceBatch,
  }),
  adjudicationReceipt: Object.freeze({
    label: 'historical pragmatic adjudication receipt',
    identity: 'xion-local-memory-inference-p1b6-pragmatic-adjudication-batch-002-receipt-v1',
    rawSha256: 'cf05f5073fc30f19078aab1a0c081b59face607a041387bf5421ffa2af8bbdaa',
    fixture: 'local-memory-inference-p1b6-pragmatic-adjudication-batch-002-receipt.json',
    receiptField: receipt => receipt.historicalPragmaticAdjudicationReceipt,
  }),
  humanEffective: Object.freeze({
    label: 'batch-002 effective HUMAN artifact',
    identity: 'xion-local-memory-inference-p1b6-primary-human-effective-current-batch-002-v2',
    rawSha256: 'a96fc01393c79057d292cf10b565589e7448b86289eb52b8cd1c63657af2ed05',
    fixture: 'local-memory-inference-p1b6-primary-human-effective-current-batch-002-v2.json',
    receiptField: receipt => receipt.effectiveHumanDecisionArtifact,
  }),
  humanRereview: Object.freeze({
    label: 'attempt-003 fresh blind HUMAN re-review receipt',
    identity: 'xion-local-memory-inference-p1b6-primary-human-rereview-batch-002-attempt-003-receipt-v1',
    rawSha256: '182fcad42d34a631fe77057cd19046ce125a06d933d68c39d870f2d366241aa3',
    fixture: 'local-memory-inference-p1b6-primary-human-rereview-batch-002-attempt-003.json',
    receiptField: receipt => receipt.freshBlindHumanRereviewAttempt,
  }),
});

function fail(message) {
  throw new TypeError(`P1-B6 surface repair ${message}`);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function artifactBytes(artifact) {
  return Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
}

function sorted(values) {
  return [...values].sort((left, right) => (left < right ? -1 : 1));
}

function verifyHistoricalSource(key, rawBytes) {
  const pinned = HISTORICAL_SOURCES[key];
  if (!Buffer.isBuffer(rawBytes) && !ArrayBuffer.isView(rawBytes)) {
    fail(`${pinned.label} bytes were not supplied`);
  }
  if (sha256RawBytes(rawBytes) !== pinned.rawSha256) {
    fail(`${pinned.label} bytes are not the canonical historical evidence`);
  }
  const artifact = JSON.parse(Buffer.from(rawBytes).toString('utf8'));
  if (artifact.name !== pinned.identity) {
    fail(`${pinned.label} identity is not canonical`);
  }
  return artifact;
}

function verifyHistoricalSources(historicalSources) {
  if (!historicalSources || typeof historicalSources !== 'object') {
    fail('historical source bytes were not supplied');
  }
  return Object.fromEntries(Object.keys(HISTORICAL_SOURCES)
    .map(key => [key, verifyHistoricalSource(key, historicalSources[key])]));
}

// Which realizations are open is derived from the canonical artifacts, never from a list in
// script source: batch-002 reconciled against the effective-current catalog with the unchanged
// HUMAN decisions must still yield exactly the 13 authorized items.
function canonicalOpenMismatches(artifacts) {
  const { mismatches } = reconcileAgainstCatalog(
    artifacts.effectiveCatalog, artifacts.sourceBatch, artifacts.humanEffective.rows);
  const authorized = sorted([...AUTHORIZED_REPAIR_ITEM_IDS, ...AUTHORIZED_REJECT_ITEM_IDS]);
  if (JSON.stringify(mismatches) !== JSON.stringify(authorized)) {
    fail('canonical reconciliation no longer yields exactly the authorized open mismatches');
  }
  return mismatches;
}

function validateResolutionReceipt(rawReceiptBytes, historicalSources) {
  const artifacts = verifyHistoricalSources(historicalSources);
  const openMismatches = canonicalOpenMismatches(artifacts);
  const receipt = JSON.parse(Buffer.from(rawReceiptBytes).toString('utf8'));

  if (!exactKeys(receipt, [
    'name', 'status', 'interpretationRule', 'statement', 'historicalExact56',
    'effectiveCurrentSkeletonCatalog', 'semanticAmendmentReceipt', 'historicalSourceBatch',
    'historicalPragmaticAdjudicationReceipt', 'effectiveHumanDecisionArtifact',
    'freshBlindHumanRereviewAttempt', 'repairCandidateArtifact', 'summary', 'pending',
    'authority', 'decisions',
  ]) || receipt.name !== RECEIPT_IDENTITY
    || receipt.status !== RECEIPT_STATUS
    || receipt.interpretationRule !== INTERPRETATION_RULE
    || !Array.isArray(receipt.statement) || receipt.statement.length < 5
    || receipt.statement.some(line => typeof line !== 'string' || !line)
    || receipt.repairCandidateArtifact.identity !== CANDIDATE_IDENTITY
    || receipt.repairCandidateArtifact.status !== CANDIDATE_STATUS
    || JSON.stringify(receipt.summary) !== JSON.stringify(EXPECTED_SUMMARY)
    // The pending fields do not share an expected value. The two fresh review gates are the
    // only current blockers; a replacement surface for the rejected realization is explicitly
    // NOT outstanding work, and a receipt claiming otherwise changes the agreed state contract.
    || !exactKeys(receipt.pending, [
      'freshSourceAudit', 'freshBlindHumanReview', 'replacementSurfaceForRejectedItem',
    ]) || receipt.pending.freshSourceAudit !== true
    || receipt.pending.freshBlindHumanReview !== true
    || receipt.pending.replacementSurfaceForRejectedItem !== false) {
    fail('resolution receipt does not bind to the canonical Phase B contract');
  }

  for (const [key, pinned] of Object.entries(HISTORICAL_SOURCES)) {
    const binding = pinned.receiptField(receipt);
    if (!binding || binding.identity !== pinned.identity
      || binding.rawSha256 !== pinned.rawSha256) {
      fail(`resolution receipt does not bind the canonical ${key} input`);
    }
  }

  // Authority: this step records a semantic decision and materializes candidates. Nothing else.
  if (!exactKeys(receipt.authority, [
    'historicalSourceBatchAltered', 'historicalExact56BytesAltered',
    'historicalHumanDecisionsAltered', 'historicalHumanDecisionsTransferredToRepairedText',
    'historicalPragmaticRoutingAltered', 'phaseASemanticAmendmentReopened',
    'rejectedItemSkeletonAmended', 'repairedRowsAccepted', 'datasetAcceptancePerformed',
    'humanGoldFrozen', 'heldOutReleasePerformed', 'trainingOccurred', 'decisionsSource',
  ]) || receipt.authority.decisionsSource !== 'REPOSITORY_OWNER_SEMANTIC_ADJUDICATION'
    || Object.entries(receipt.authority)
      .some(([key, value]) => key !== 'decisionsSource' && value !== false)) {
    fail('resolution receipt claims authority it does not have');
  }

  const decisionIds = receipt.decisions.map(row => row.itemId);
  if (JSON.stringify(decisionIds) !== JSON.stringify(openMismatches)) {
    fail('resolution receipt does not hold exactly one sorted row per open mismatch');
  }
  const repaired = receipt.decisions.filter(row => row.decision === 'REPAIR');
  const rejected = receipt.decisions.filter(row => row.decision === 'REJECT');
  if (repaired.length + rejected.length !== receipt.decisions.length
    || JSON.stringify(repaired.map(row => row.itemId))
      !== JSON.stringify([...AUTHORIZED_REPAIR_ITEM_IDS])
    || JSON.stringify(rejected.map(row => row.itemId))
      !== JSON.stringify([...AUTHORIZED_REJECT_ITEM_IDS])) {
    fail('resolution receipt does not record exactly the authorized 12 REPAIR and 1 REJECT');
  }

  const historicalItems = new Map(artifacts.sourceBatch.items.map(row => [row.itemId, row]));
  for (const row of receipt.decisions) {
    const historical = historicalItems.get(row.itemId);
    if (!historical) fail(`decision has no historical source row: ${row.itemId}`);
    if (row.semanticSkeletonId !== historical.semanticSkeletonId) {
      fail(`decision remaps its semantic skeleton: ${row.itemId}`);
    }
  }
  for (const row of rejected) {
    if (!exactKeys(row, [
      'itemId', 'decision', 'semanticSkeletonId', 'rejectionRationale', 'rejectedScope',
      'skeletonAmended', 'replacementAuthored',
    ]) || row.rejectedScope !== 'CURRENT_SURFACE_REALIZATION_ONLY'
      || row.skeletonAmended !== false || row.replacementAuthored !== false
      || typeof row.rejectionRationale !== 'string' || !row.rejectionRationale) {
      fail(`rejection row is invalid or claims more than a surface rejection: ${row.itemId}`);
    }
  }
  for (const row of repaired) {
    if (!exactKeys(row, [
      'itemId', 'decision', 'semanticSkeletonId', 'repairRationale',
      'intendedUnresolvedReadings', 'discoursePattern', 'anchorTurnId', 'anchorText',
      'evidenceTurnIds', 'turns',
    ]) || typeof row.repairRationale !== 'string' || !row.repairRationale
      || !Array.isArray(row.intendedUnresolvedReadings)
      || row.intendedUnresolvedReadings.length !== 2
      || row.intendedUnresolvedReadings.some(entry => typeof entry !== 'string' || !entry)
      || !DISCOURSE_PATTERNS.includes(row.discoursePattern)
      || typeof row.anchorText !== 'string' || !row.anchorText
      || !Array.isArray(row.evidenceTurnIds) || row.evidenceTurnIds.length === 0
      || !Array.isArray(row.turns) || row.turns.length === 0) {
      fail(`repair row is invalid: ${row.itemId}`);
    }
  }
  return { receipt, artifacts };
}

function anchorSpan(turn, anchorText) {
  const haystack = Buffer.from(turn.text, 'utf8');
  const needle = Buffer.from(anchorText, 'utf8');
  const startByte = haystack.indexOf(needle);
  if (startByte < 0) fail(`anchor text is not present in its repaired turn: ${turn.turnId}`);
  if (haystack.indexOf(needle, startByte + 1) !== -1) {
    fail(`anchor text is not unique in its repaired turn: ${turn.turnId}`);
  }
  return { turnId: turn.turnId, startByte, endByte: startByte + needle.length };
}

// Offsets are always recomputed from the repaired text. Nothing is carried over from the
// historical batch, whose byte offsets belong to the old source.
function repairedRow(decision, historicalItem, historicalEpisode) {
  const turns = new Map(decision.turns.map(turn => [turn.turnId, turn]));
  const anchorTurn = turns.get(decision.anchorTurnId);
  if (!anchorTurn) fail(`anchor turn is not in the repaired episode: ${decision.itemId}`);
  const evidenceTurns = decision.evidenceTurnIds.map(turnId => {
    const turn = turns.get(turnId);
    if (!turn) fail(`evidence turn is not in the repaired episode: ${decision.itemId}`);
    return turn;
  });
  return {
    episode: {
      sourceEpisodeId: historicalEpisode.sourceEpisodeId,
      sourceFamilyId: historicalEpisode.sourceFamilyId,
      splitAssignment: historicalEpisode.splitAssignment,
      language: historicalEpisode.language,
      turns: decision.turns.map(turn => ({ ...turn })),
    },
    item: {
      itemId: decision.itemId,
      sourceEpisodeId: historicalEpisode.sourceEpisodeId,
      semanticSkeletonId: decision.semanticSkeletonId,
      anchorSpanRef: anchorSpan(anchorTurn, decision.anchorText),
      anchorText: decision.anchorText,
      evidenceSpanRefs: evidenceTurns.map(turn => ({
        turnId: turn.turnId, startByte: 0, endByte: utf8Length(turn.text),
      })),
      discoursePattern: decision.discoursePattern,
      surfaceFamilyId: historicalItem.surfaceFamilyId,
      historicalDiscoursePattern: historicalItem.discoursePattern,
    },
  };
}

// A narrow Phase B validator. The historical surface validator stays pointed at the frozen
// Exact56 and the historical batch shape; prospective repair candidates carry a different
// schema (anchorText, historical provenance fields) and validate against the effective-current
// catalog, so the two paths stay separate on purpose.
function validateRepairCandidateBatch(candidate, options = {}) {
  if (!exactKeys(candidate, [
    'name', 'status', 'interpretationRule', 'provenance', 'pending', 'authority',
    'coverage', 'sourceEpisodes', 'items',
  ]) || candidate.name !== CANDIDATE_IDENTITY || candidate.status !== CANDIDATE_STATUS
    || candidate.interpretationRule !== INTERPRETATION_RULE) {
    fail('repair candidate identity or status is not canonical');
  }
  if (Object.entries(candidate.authority)
    .some(([key, value]) => key !== 'decisionsSource' && value !== false)) {
    fail('repair candidate claims authority it does not have');
  }
  const catalog = options.effectiveCatalog;
  if (!catalog || catalog.name !== HISTORICAL_SOURCES.effectiveCatalog.identity) {
    fail('repair candidate validation needs the effective-current skeleton catalog');
  }
  const skeletons = new Map(catalog.candidates.map(row => [row.semanticSkeletonId, row]));

  const episodes = new Map();
  for (const episode of candidate.sourceEpisodes) {
    if (!exactKeys(episode, [
      'sourceEpisodeId', 'sourceFamilyId', 'splitAssignment', 'language', 'turns',
    ]) || episodes.has(episode.sourceEpisodeId)) {
      fail(`duplicate or invalid repaired episode: ${episode.sourceEpisodeId}`);
    }
    if (!Array.isArray(episode.turns) || episode.turns.length === 0) {
      fail(`repaired episode has no turns: ${episode.sourceEpisodeId}`);
    }
    for (const [index, turn] of episode.turns.entries()) {
      if (!exactKeys(turn, ['turnId', 'role', 'text']) || turn.turnId !== `t${index + 1}`
        || !['USER', 'ASSISTANT'].includes(turn.role) || typeof turn.text !== 'string'
        || turn.text.trim() === '' || /[\r\n]/u.test(turn.text)
        || turn.text.includes('[TARGET]') || turn.text.includes('[/TARGET]')) {
        fail(`invalid repaired turn in ${episode.sourceEpisodeId}`);
      }
    }
    episodes.set(episode.sourceEpisodeId, episode);
  }

  const itemIds = new Set();
  for (const item of candidate.items) {
    if (!exactKeys(item, [
      'itemId', 'sourceEpisodeId', 'semanticSkeletonId', 'anchorSpanRef', 'anchorText',
      'evidenceSpanRefs', 'discoursePattern', 'surfaceFamilyId', 'historicalDiscoursePattern',
    ]) || itemIds.has(item.itemId)) {
      fail(`duplicate or invalid repaired item: ${item.itemId}`);
    }
    itemIds.add(item.itemId);
    if (AUTHORIZED_REJECT_ITEM_IDS.includes(item.itemId)) {
      fail(`a rejected realization must not appear in the repair candidate: ${item.itemId}`);
    }
    if (!AUTHORIZED_REPAIR_ITEM_IDS.includes(item.itemId)) {
      fail(`unauthorized row in the repair candidate: ${item.itemId}`);
    }
    const episode = episodes.get(item.sourceEpisodeId);
    const skeleton = skeletons.get(item.semanticSkeletonId);
    if (!episode) fail(`unknown repaired episode: ${item.itemId}`);
    if (!skeleton) fail(`unknown effective-current skeleton: ${item.itemId}`);
    if (episode.splitAssignment !== skeleton.splitAssignment) {
      fail(`episode/skeleton split mismatch: ${item.itemId}`);
    }
    if (!DISCOURSE_PATTERNS.includes(item.discoursePattern)) {
      fail(`invalid discoursePattern: ${item.itemId}`);
    }

    const turns = new Map(episode.turns.map(turn => [turn.turnId, turn]));
    const turnOrder = new Map(episode.turns.map((turn, index) => [turn.turnId, index]));
    const checkSpan = span => {
      if (!exactKeys(span, ['turnId', 'startByte', 'endByte']) || !turns.has(span.turnId)) {
        fail(`invalid span reference: ${item.itemId}`);
      }
      return decodeSpan(turns.get(span.turnId).text, span);
    };
    // Offsets must belong to the repaired text, not to the historical source. A stale anchor
    // offset decodes to something other than the recorded anchor text and fails here.
    if (checkSpan(item.anchorSpanRef) !== item.anchorText) {
      fail(`anchor offsets do not match the repaired source text: ${item.itemId}`);
    }
    if (!Array.isArray(item.evidenceSpanRefs) || item.evidenceSpanRefs.length === 0) {
      fail(`repaired item has no evidence: ${item.itemId}`);
    }
    for (const span of item.evidenceSpanRefs) {
      checkSpan(span);
      if (span.startByte !== 0 || span.endByte !== utf8Length(turns.get(span.turnId).text)) {
        fail(`evidence span is not a whole repaired turn: ${item.itemId}`);
      }
    }
    for (let index = 1; index < item.evidenceSpanRefs.length; index += 1) {
      const previous = item.evidenceSpanRefs[index - 1];
      const current = item.evidenceSpanRefs[index];
      if (turnOrder.get(current.turnId) <= turnOrder.get(previous.turnId)) {
        fail(`evidence spans are not in canonical source order: ${item.itemId}`);
      }
    }
    const anchorCovered = item.evidenceSpanRefs.some(span =>
      span.turnId === item.anchorSpanRef.turnId
      && span.startByte <= item.anchorSpanRef.startByte
      && span.endByte >= item.anchorSpanRef.endByte);
    if (!anchorCovered) fail(`anchor is outside selected evidence: ${item.itemId}`);
    const fragmentCount = computeFragments(item, episode).length;
    if (fragmentCount < 1 || fragmentCount > 5) fail(`fragment count must be 1..5: ${item.itemId}`);
  }
  if (JSON.stringify([...itemIds]) !== JSON.stringify([...AUTHORIZED_REPAIR_ITEM_IDS])) {
    fail('repair candidate does not hold exactly the authorized repaired rows');
  }
  return candidate;
}

function buildRepairCandidateBatch(rawReceiptBytes, historicalSources) {
  const { receipt, artifacts } = validateResolutionReceipt(rawReceiptBytes, historicalSources);
  const historicalItems = new Map(artifacts.sourceBatch.items.map(row => [row.itemId, row]));
  const historicalEpisodes = new Map(
    artifacts.sourceBatch.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));

  const rows = receipt.decisions.filter(row => row.decision === 'REPAIR').map(decision => {
    const historicalItem = historicalItems.get(decision.itemId);
    return repairedRow(decision, historicalItem,
      historicalEpisodes.get(historicalItem.sourceEpisodeId));
  });

  const candidate = {
    name: CANDIDATE_IDENTITY,
    status: CANDIDATE_STATUS,
    interpretationRule: INTERPRETATION_RULE,
    provenance: {
      resolutionReceipt: {
        identity: receipt.name,
        rawSha256: sha256RawBytes(rawReceiptBytes),
      },
      historicalSourceBatch: {
        identity: HISTORICAL_SOURCES.sourceBatch.identity,
        rawSha256: HISTORICAL_SOURCES.sourceBatch.rawSha256,
        role: 'IMMUTABLE_HISTORICAL_SURFACE_SOURCE',
      },
      effectiveCurrentSkeletonCatalog: {
        identity: HISTORICAL_SOURCES.effectiveCatalog.identity,
        rawSha256: HISTORICAL_SOURCES.effectiveCatalog.rawSha256,
        role: 'PROSPECTIVE_SEMANTIC_AUTHORITY',
      },
      rejectedItemIds: [...AUTHORIZED_REJECT_ITEM_IDS],
      note: 'Item IDs, semantic skeleton IDs, source episode IDs and family IDs are carried from the historical rows so provenance stays explicit. Byte offsets are recomputed from the repaired source text; no historical offset is reused.',
    },
    pending: {
      freshSourceAudit: true,
      freshBlindHumanReview: true,
    },
    authority: {
      humanDecisionsTransferredFromOldSurfaces: false,
      humanReviewPerformed: false,
      repairedRowsAccepted: false,
      datasetAcceptancePerformed: false,
      humanGoldFrozen: false,
      heldOutReleasePerformed: false,
      trainingOccurred: false,
      effectiveCurrentSurfaceBatchSuperseded: false,
      decisionsSource: 'REPOSITORY_OWNER_SEMANTIC_ADJUDICATION',
    },
    coverage: {
      repairedItems: rows.length,
      rejectedItems: AUTHORIZED_REJECT_ITEM_IDS.length,
      splitCounts: rows.reduce((counts, row) => {
        counts[row.episode.splitAssignment] = (counts[row.episode.splitAssignment] || 0) + 1;
        return counts;
      }, {}),
    },
    sourceEpisodes: rows.map(row => row.episode),
    items: rows.map(row => row.item),
  };
  return validateRepairCandidateBatch(candidate, {
    effectiveCatalog: artifacts.effectiveCatalog,
  });
}

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', name));
}

function loadHistoricalSources() {
  return Object.fromEntries(Object.entries(HISTORICAL_SOURCES)
    .map(([key, pinned]) => [key, loadFixture(pinned.fixture)]));
}

function main() {
  const candidate = buildRepairCandidateBatch(loadFixture(RECEIPT_FILE), loadHistoricalSources());
  const outputPath = path.join(__dirname, '..', 'fixtures', CANDIDATE_FILE);
  fs.writeFileSync(outputPath, artifactBytes(candidate));
  process.stdout.write(`Built P1-B6 surface repair candidate: ${outputPath}\n`);
  return 0;
}

module.exports = {
  AUTHORIZED_REJECT_ITEM_IDS,
  AUTHORIZED_REPAIR_ITEM_IDS,
  CANDIDATE_FILE,
  CANDIDATE_IDENTITY,
  CANDIDATE_STATUS,
  EXPECTED_SUMMARY,
  HISTORICAL_SOURCES,
  RECEIPT_FILE,
  RECEIPT_IDENTITY,
  artifactBytes,
  buildRepairCandidateBatch,
  canonicalOpenMismatches,
  loadHistoricalSources,
  main,
  validateRepairCandidateBatch,
  validateResolutionReceipt,
};

if (require.main === module) process.exit(main());
