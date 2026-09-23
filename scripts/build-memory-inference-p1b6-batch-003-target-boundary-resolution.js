#!/usr/bin/env node
'use strict';

// P1-B6 TARGET-boundary realization failure on 2da4e54e and 5269c91f.
//
// Both skeletons stay active and v3 stays as it is. What failed is the batch-003 realization:
// the marked TARGET is a supporting fact (a person, a date, an action, a product property),
// so judged as itself (v3 targetBoundary) it is self-evidencing and the intended
// applicability / membership boundary sits only downstream. Every batch-003 surface on the two
// skeletons becomes current-ineligible here, in a new layer; no historical artifact is rewritten.
//
// It also encodes the realization invariant for the two skeletons and materializes one fresh
// proof-of-realizability candidate per skeleton, under new IDs, with no inherited review.
// Nothing is audited, reviewed, accepted, frozen or trained here.

const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { DISCOURSE_PATTERNS, computeFragments, decodeSpan, utf8Length } =
  require('../lib/memory-inference-p1b6-surfaces');
const plan = require('./build-memory-inference-p1b6-batch-003-authoring-plan');

const ROOT = path.resolve(__dirname, '..');
const RECEIPT_IDENTITY = 'xion-local-memory-inference-p1b6-batch-003-target-boundary-resolution-receipt-v1';
const RECEIPT_FILE = 'local-memory-inference-p1b6-batch-003-target-boundary-resolution-receipt.json';
const CANDIDATE_IDENTITY = 'xion-local-memory-inference-p1b6-surface-target-boundary-candidate-v1';
const CANDIDATE_FILE = 'local-memory-inference-p1b6-surface-target-boundary-candidate.json';
const RESOLUTION = 'TARGET_BOUNDARY_REALIZATION_FAILURE';
const AFFECTED_SKELETONS = Object.freeze({
  'p1b6-sk-2da4e54e6609e34b': 12,
  'p1b6-sk-5269c91fcfb6c2cd': 4,
});

const SOURCES = Object.freeze({
  v3: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-skeleton-effective-current-v3',
    rawSha256: '89a48264d6b09710f976a4ab85235ff161cf81ff44896e37553d5dc7753c65b9',
    fixture: 'local-memory-inference-p1b6-skeleton-effective-current-v3.json',
  }),
  v3Receipt: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-skeleton-semantic-contract-v3-receipt-v1',
    rawSha256: '10f8a10eb3325b86c9d9282fc951ee53b2037918c4258c89a7694822df9a98e1',
    fixture: 'local-memory-inference-p1b6-skeleton-semantic-contract-v3-receipt.json',
  }),
  batch: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-surface-batch-003-v1',
    rawSha256: '90b453c3680bccaa537fd0d23db74bbc303882e1a35a2ddcea0b75b013fcaa68',
    fixture: 'local-memory-inference-p1b6-surface-batch-003.json',
  }),
  resolution: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-batch-003-resolution-receipt-v1',
    rawSha256: '61c29218a360bf914c6453758c7fc243e629f1b5d400e38426d9d18720cb1ffe',
    fixture: 'local-memory-inference-p1b6-batch-003-resolution-receipt.json',
  }),
  repairCandidate: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-surface-repair-candidate-batch-003-v1',
    rawSha256: '8f6254946eef8d8d0920485bde431ca137a83577a5060889f3676b8857b4aa9b',
    fixture: 'local-memory-inference-p1b6-surface-repair-candidate-batch-003.json',
  }),
  targetedStrongModel: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-targeted-v3-strong-model-review-batch-003-attempt-001-receipt-v1',
    rawSha256: '8db917801426d77f3d024bb843592208f008f490ca49f6a8499306d157f4d283',
    fixture: 'local-memory-inference-p1b6-targeted-v3-strong-model-review-batch-003-attempt-001.json',
  }),
  targetedHuman: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-batch-003-targeted-v3-human-review-attempt-001-receipt-v1',
    rawSha256: 'a70efc875376894460740d74b35de78a3206bffa544d31c7a955d758d83e97e6',
    fixture: 'local-memory-inference-p1b6-batch-003-targeted-v3-human-review-attempt-001.json',
  }),
  acceptance: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-batch-002-acceptance-v1',
    rawSha256: 'c03b8dcf4ddcb2c5f8b193cde8247b9ad64b8ea676da51cab1d709795b273598',
    fixture: 'local-memory-inference-p1b6-batch-002-acceptance.json',
  }),
});

// Prospective realization invariant, scoped to the two applicability / membership skeletons.
// It checks the role the author declares for the TARGET span. Whether the span actually plays
// that role is a semantic judgment for the fresh audit and review gates, not for this check.
const REALIZATION_INVARIANT = Object.freeze({
  id: 'p1b6-applicability-membership-target-anchor-v1',
  scopeSkeletonIds: Object.freeze(Object.keys(AFFECTED_SKELETONS)),
  allowedTargetAnchorRoles: Object.freeze(['APPLICABILITY_STATUS', 'CATEGORY_MEMBERSHIP', 'RULE_RESULT']),
  rejectedTargetAnchorRoles: Object.freeze(['SUPPORTING_FACT', 'IDENTITY', 'DATE', 'ACTION', 'PROPERTY']),
  statement: 'A valid realization anchors TARGET on the unresolved materially relevant status itself — applicability or eligibility, category membership, or the amount / duration / status that results from the rule — not on an observed fact that would be used to infer that status. If the marked TARGET directly states a supporting fact and the intended ambiguity exists only in a downstream consequence, the realization is invalid for this skeleton.',
  limitation: 'Checks the declared role only. Lexical or declared-role checks do not prove semantic validity.',
});

function fail(message) {
  throw new TypeError(`P1-B6 target-boundary resolution ${message}`);
}

function checkTargetBoundaryRealization(item) {
  if (!REALIZATION_INVARIANT.scopeSkeletonIds.includes(item.semanticSkeletonId)) return;
  if (!REALIZATION_INVARIANT.allowedTargetAnchorRoles.includes(item.targetAnchorRole)) {
    fail(`TARGET must denote the applicability / membership status itself: ${item.itemId} (${item.targetAnchorRole})`);
  }
}

// Fresh proof-of-realizability content. IDs are new; nothing is carried from batch-003.
const AUTHORED = Object.freeze([
  {
    n: '001',
    semanticSkeletonId: 'p1b6-sk-2da4e54e6609e34b',
    language: 'KO',
    discoursePattern: 'CONTEXT_FIRST',
    targetAnchorRole: 'RULE_RESULT',
    turns: [
      ['USER', '우리 동네 수영장은 일반 이용자한테 1회 입장료 6천 원을 받아.'],
      ['USER', '구민은 예외로 절반만 내면 된대.'],
      ['USER', '주말에 사촌 동생을 데려가기로 했어.'],
      ['ASSISTANT', '좋네요.'],
      ['USER', '가기 전에 동생 입장료를 미리 챙겨 줘야 해.'],
    ],
    anchorTurnId: 't5',
    anchorText: '동생 입장료',
    evidenceTurnIds: ['t1', 't2', 't3', 't5'],
    intendedUnresolvedReadings: [
      'the cousin is a district resident and the fee is the halved exception rate',
      'the cousin is not a district resident and the fee is the general 6,000 won',
    ],
  },
  {
    n: '002',
    semanticSkeletonId: 'p1b6-sk-5269c91fcfb6c2cd',
    language: 'KO',
    discoursePattern: 'CANONICAL',
    targetAnchorRole: 'CATEGORY_MEMBERSHIP',
    turns: [
      ['USER', '이 서점은 우수 회원한테만 신간을 하루 먼저 보내 줘.'],
      ['USER', '안내를 보니 우수 회원은 보통 연 30만 원 넘게 사고 리뷰도 자주 쓰는 사람이래.'],
      ['USER', '나는 작년에 40만 원어치 샀는데 리뷰는 한 번도 안 남겼어.'],
      ['USER', '내가 우수 회원에 들어가는지 서점에 물어봐야겠어.'],
    ],
    anchorTurnId: 't4',
    anchorText: '우수 회원에 들어가는지',
    evidenceTurnIds: ['t1', 't2', 't3', 't4'],
    intendedUnresolvedReadings: [
      'the spending threshold alone makes the user a premium member',
      'the missing reviews keep the user outside the premium-member category',
    ],
  },
]);

function loadSources(root = ROOT) {
  return Object.fromEntries(Object.entries(SOURCES)
    .map(([key, pinned]) => [key, fs.readFileSync(path.join(root, 'fixtures', pinned.fixture))]));
}

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

// Derived from the two skeleton IDs and the frozen batch only; no caller list is accepted.
function deriveAffected(artifacts) {
  const retired = new Set(artifacts.v3.retiredSkeletons.map(row => row.retiredSkeletonId));
  for (const skeletonId of Object.keys(AFFECTED_SKELETONS)) {
    const skeleton = artifacts.v3.candidates.find(row => row.semanticSkeletonId === skeletonId);
    if (!skeleton || skeleton.humanLabel !== 'ESCALATE' || retired.has(skeletonId)) {
      fail(`skeleton is not an active v3 ESCALATE skeleton: ${skeletonId}`);
    }
  }
  const affected = artifacts.batch.items.filter(row => Object.hasOwn(AFFECTED_SKELETONS, row.semanticSkeletonId));
  for (const [skeletonId, count] of Object.entries(AFFECTED_SKELETONS)) {
    if (affected.filter(row => row.semanticSkeletonId === skeletonId).length !== count) {
      fail(`population drifted on ${skeletonId}`);
    }
  }
  return affected.map(row => row.itemId).toSorted();
}

// The most recent layer that governed each row before this resolution, quoted not rewritten.
function priorCurrentStatus(itemId, artifacts) {
  const human = artifacts.targetedHuman.rows.find(row => row.itemId === itemId);
  if (human) {
    return { source: SOURCES.targetedHuman.identity, disposition: human.disposition,
      provenance: human.provenance, eligibility: human.eligibility };
  }
  if (artifacts.targetedStrongModel.agreementItemIds.includes(itemId)) {
    return { source: SOURCES.targetedStrongModel.identity, disposition: 'KEEP',
      provenance: 'CATALOG_STRONG_MODEL_CONFIRMED', eligibility: 'PROVISIONAL' };
  }
  const decision = artifacts.resolution.decisions.find(row => row.itemId === itemId);
  if (decision?.resolution === 'SEMANTIC_CONTRACT_CORRECTION') {
    return { source: SOURCES.resolution.identity, resolution: decision.resolution,
      resolvedLabel: decision.resolvedLabel };
  }
  fail(`no prior current status for ${itemId}`);
}

function buildReceipt(artifacts) {
  const rows = deriveAffected(artifacts).map(itemId => ({
    itemId,
    semanticSkeletonId: artifacts.batch.items.find(row => row.itemId === itemId).semanticSkeletonId,
    priorCurrentStatus: priorCurrentStatus(itemId, artifacts),
    resolution: RESOLUTION,
    currentEligibility: 'INELIGIBLE',
  }));
  return {
    name: RECEIPT_IDENTITY,
    status: 'COMPLETE_BATCH_003_REALIZATIONS_INELIGIBLE_FRESH_REALIZATION_PENDING_GATES',
    decisionsSource: 'REPOSITORY_OWNER_SEMANTIC_ADJUDICATION',
    resolutionType: RESOLUTION,
    statement: [
      'This is a realization failure, not a semantic-contract failure. Both skeletons stay active v3 ESCALATE skeletons with unchanged meaning.',
      'Every batch-003 realization on the two skeletons anchors TARGET on a supporting fact, so under v3 targetBoundary the intended applicability or membership boundary is only downstream. All of them are current-ineligible.',
      'Earlier source-audit, v2 HUMAN, semantic-contract-correction, targeted strong-model and targeted HUMAN evidence stays immutable history of what was reviewed under the authority in force at the time. It is not reinterpreted as wrong and is not rewritten.',
      'Fresh realizations are required; ordinary top-up after review losses, not one-for-one replacement, determines how many.',
    ],
    inputs: Object.fromEntries(Object.entries(SOURCES)
      .map(([key, pinned]) => [key, { identity: pinned.identity, rawSha256: pinned.rawSha256 }])),
    affectedSkeletonIds: Object.keys(AFFECTED_SKELETONS),
    realizationInvariant: REALIZATION_INVARIANT,
    summary: {
      total: rows.length,
      bySkeleton: { ...AFFECTED_SKELETONS },
      priorProvisionalWithdrawn: rows.filter(row => row.priorCurrentStatus.eligibility === 'PROVISIONAL').length,
      priorSemanticContractCorrectionWithdrawn: rows.filter(row => row.priorCurrentStatus.resolution === 'SEMANTIC_CONTRACT_CORRECTION').length,
    },
    rows,
    freshRealization: {
      candidateArtifact: CANDIDATE_IDENTITY,
      role: 'PROOF_OF_REALIZABILITY_NOT_A_REPLACEMENT_COUNT',
      pendingGates: ['fresh source/bundle audit', 'fresh v3 semantic realization review', 'HUMAN adjudication where current routing requires it'],
    },
    acceptedPool: {
      cumulativeAcceptedSurfacePool: artifacts.acceptance.corpusGrowth.cumulativeAcceptedSurfacePool,
      reopened: false,
      note: 'p1b6-item-b002-047 on 5269c91f is part of the accepted pool and is out of scope here.',
    },
    authority: {
      historicalArtifactsRewritten: false,
      skeletonRetired: false,
      replacementSkeletonCreated: false,
      semanticContractAmended: false,
      acceptedPoolReopened: false,
      historicalReviewTransferredToFreshRealizations: false,
      referenceLabelFreezePerformed: false,
      finalSelectionPerformed: false,
      heldOutReleasePerformed: false,
      trainingOrEvaluationOccurred: false,
    },
  };
}

function materialize(row, v3) {
  const skeleton = v3.candidates.find(entry => entry.semanticSkeletonId === row.semanticSkeletonId);
  if (!DISCOURSE_PATTERNS.includes(row.discoursePattern)) fail(`unknown discourse pattern: ${row.n}`);
  const turns = row.turns.map(([role, text], index) => ({ turnId: `t${index + 1}`, role, text }));
  const byId = new Map(turns.map(turn => [turn.turnId, turn]));
  const haystack = Buffer.from(byId.get(row.anchorTurnId).text, 'utf8');
  const needle = Buffer.from(row.anchorText, 'utf8');
  const startByte = haystack.indexOf(needle);
  if (startByte < 0 || haystack.indexOf(needle, startByte + 1) >= 0) fail(`anchor is not unique in its turn: ${row.n}`);
  const episode = {
    sourceEpisodeId: `p1b6-se-tb1-${row.n}`,
    sourceFamilyId: `p1b6-sf-tb1-${row.n}`,
    splitAssignment: skeleton.splitAssignment,
    language: row.language,
    turns,
  };
  const item = {
    itemId: `p1b6-item-tb1-${row.n}`,
    sourceEpisodeId: episode.sourceEpisodeId,
    semanticSkeletonId: row.semanticSkeletonId,
    anchorSpanRef: { turnId: row.anchorTurnId, startByte, endByte: startByte + utf8Length(row.anchorText) },
    anchorText: row.anchorText,
    evidenceSpanRefs: row.evidenceTurnIds.map(turnId => ({
      turnId, startByte: 0, endByte: utf8Length(byId.get(turnId).text),
    })),
    discoursePattern: row.discoursePattern,
    surfaceFamilyId: `p1b6-surface-family-tb1-${row.n}`,
    targetAnchorRole: row.targetAnchorRole,
    intendedUnresolvedReadings: [...row.intendedUnresolvedReadings],
  };
  return { episode, item };
}

function validateCandidate(candidate, artifacts) {
  const known = new Set([
    ...artifacts.batch.items.flatMap(row => [row.itemId, row.surfaceFamilyId]),
    ...artifacts.batch.sourceEpisodes.flatMap(row => [row.sourceEpisodeId, row.sourceFamilyId]),
    ...artifacts.repairCandidate.items.map(row => row.itemId),
  ]);
  const episodes = new Map(candidate.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  for (const item of candidate.items) {
    const episode = episodes.get(item.sourceEpisodeId);
    for (const id of [item.itemId, item.surfaceFamilyId, episode.sourceEpisodeId, episode.sourceFamilyId]) {
      if (known.has(id)) fail(`fresh realization reuses a historical ID: ${id}`);
    }
    checkTargetBoundaryRealization(item);
    const turns = new Map(episode.turns.map(turn => [turn.turnId, turn]));
    if (decodeSpan(turns.get(item.anchorSpanRef.turnId).text, item.anchorSpanRef) !== item.anchorText
      || !item.evidenceSpanRefs.some(span => span.turnId === item.anchorSpanRef.turnId)) {
      fail(`anchor is not inside its evidence: ${item.itemId}`);
    }
    const fragments = computeFragments(item, episode).length;
    if (fragments < 1 || fragments > 5) fail(`fragment count must be 1..5: ${item.itemId}`);
  }
  // Leakage against every prior source plus the whole historical batch-003 and its repairs.
  plan.validateBatch003Leakage(candidate, [
    ...plan.loadPriorSources(),
    ...[artifacts.batch, artifacts.repairCandidate].flatMap(artifact => artifact.sourceEpisodes
      .map(episode => ({ origin: artifact.name, id: episode.sourceEpisodeId, turns: episode.turns }))),
  ]);
  return candidate;
}

function buildCandidate(artifacts, authored = AUTHORED) {
  const rows = authored.map(row => materialize(row, artifacts.v3));
  return validateCandidate({
    name: CANDIDATE_IDENTITY,
    status: 'FRESH_REALIZATION_CANDIDATE_AWAITING_SOURCE_AUDIT_AND_V3_REVIEW',
    interpretationRule: 'P1B6_SEMANTIC_CONTRACT_V3',
    realizationInvariant: REALIZATION_INVARIANT.id,
    provenance: {
      resolutionReceipt: RECEIPT_IDENTITY,
      semanticAuthority: { identity: SOURCES.v3.identity, rawSha256: SOURCES.v3.rawSha256 },
      note: 'Fresh content under new IDs. No batch-003 text, ID, source-audit result, model or HUMAN decision is carried over.',
    },
    pending: { freshSourceAudit: true, freshV3SemanticReview: true, humanAdjudicationWhereRouted: true },
    authority: {
      historicalReviewTransferred: false,
      sourceAuditPerformed: false,
      semanticReviewPerformed: false,
      humanReviewPerformed: false,
      accepted: false,
      heldOutReleasePerformed: false,
      trainingOccurred: false,
    },
    sourceEpisodes: rows.map(row => row.episode),
    items: rows.map(row => row.item),
  }, artifacts);
}

const artifactBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');

function main() {
  const artifacts = verifySources(loadSources());
  const outputs = [[RECEIPT_FILE, buildReceipt(artifacts)], [CANDIDATE_FILE, buildCandidate(artifacts)]];
  for (const [file, value] of outputs) {
    fs.writeFileSync(path.join(ROOT, 'fixtures', file), artifactBytes(value));
    process.stdout.write(`Wrote fixtures/${file}\n`);
  }
  return 0;
}

module.exports = {
  AFFECTED_SKELETONS,
  AUTHORED,
  CANDIDATE_FILE,
  RECEIPT_FILE,
  REALIZATION_INVARIANT,
  SOURCES,
  artifactBytes,
  buildCandidate,
  buildReceipt,
  checkTargetBoundaryRealization,
  deriveAffected,
  loadSources,
  main,
  verifySources,
};

if (require.main === module) process.exit(main());
