#!/usr/bin/env node
'use strict';

// First fresh surface realization for each semantic-contract-v3 replacement skeleton
// (53ab6351 for retired f58debd8, 0768ea20 for retired 28736b74).
//
// These establish initial coverage and realizability; they are not a one-for-one replacement
// count and do not set the later top-up quantity. Nothing is carried from the retired
// skeletons' historical surfaces. Nothing is audited, reviewed, accepted or trained here.

const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { DISCOURSE_PATTERNS, computeFragments, decodeSpan, utf8Length } =
  require('../lib/memory-inference-p1b6-surfaces');
const plan = require('./build-memory-inference-p1b6-batch-003-authoring-plan');

const ROOT = path.resolve(__dirname, '..');
const CANDIDATE_IDENTITY = 'xion-local-memory-inference-p1b6-surface-v3-replacement-candidate-v1';
const CANDIDATE_FILE = 'local-memory-inference-p1b6-surface-v3-replacement-candidate.json';

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
  repairCandidate: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-surface-repair-candidate-batch-003-v1',
    rawSha256: '8f6254946eef8d8d0920485bde431ca137a83577a5060889f3676b8857b4aa9b',
    fixture: 'local-memory-inference-p1b6-surface-repair-candidate-batch-003.json',
  }),
  targetBoundaryCandidate: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-surface-target-boundary-candidate-v1',
    rawSha256: '5a4253506a9a9885118781c68cdcc407d91b6497b4b1af2105a675332ef8a7f5',
    fixture: 'local-memory-inference-p1b6-surface-target-boundary-candidate.json',
  }),
});

// Frozen replacement contracts this authoring must match.
const REPLACEMENTS = Object.freeze({
  'p1b6-sk-53ab63517113df16': Object.freeze({
    retiredSkeletonId: 'p1b6-sk-f58debd8f04f5c60', contrastGroupId: 'p1b6-cg-084af1a6a0723538',
  }),
  'p1b6-sk-0768ea2028f18511': Object.freeze({
    retiredSkeletonId: 'p1b6-sk-28736b74c85fcc93', contrastGroupId: null,
  }),
});

// Fresh content. The intended readings are the v3 receipt's own, recorded as author intent;
// they never enter a blind packet.
const AUTHORED = Object.freeze([
  {
    n: '001',
    semanticSkeletonId: 'p1b6-sk-53ab63517113df16',
    language: 'KO',
    discoursePattern: 'CONTEXT_FIRST',
    turns: [
      ['USER', '이번 프로젝트는 해야 할 작업이 20개고 전체 일정은 4주로 잡혀 있어.'],
      ['USER', '작업 수랑 일정은 매주 금요일에 같이 팀에 공유해.'],
      ['USER', '지금 보니까 반 정도 남았어.'],
    ],
    anchorTurnId: 't3',
    anchorText: '반 정도 남았어',
    evidenceTurnIds: ['t1', 't2', 't3'],
  },
  {
    n: '002',
    semanticSkeletonId: 'p1b6-sk-0768ea2028f18511',
    language: 'KO',
    discoursePattern: 'CANONICAL',
    turns: [
      ['USER', '거실 벽에 걸 판넬 두 개를 비교하고 있어.'],
      ['USER', '첫 번째는 가로 60cm, 세로 35cm야.'],
      ['USER', '두 번째는 가로도 세로도 첫 번째랑 달라.'],
      ['USER', '재 보니까 두 번째가 한 5cm 정도 더 길어.'],
    ],
    anchorTurnId: 't4',
    anchorText: '두 번째가 한 5cm 정도 더 길어',
    evidenceTurnIds: ['t1', 't2', 't3', 't4'],
  },
]);

function fail(message) {
  throw new TypeError(`P1-B6 v3 replacement candidate ${message}`);
}

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

function replacementSkeleton(artifacts, skeletonId) {
  const skeleton = artifacts.v3.candidates.find(row => row.semanticSkeletonId === skeletonId);
  const contract = REPLACEMENTS[skeletonId];
  const retirement = artifacts.v3Receipt.retirements.find(row => row.replacementSkeletonId === skeletonId);
  const retired = new Set(artifacts.v3.retiredSkeletons.map(row => row.retiredSkeletonId));
  if (!skeleton || !contract || retired.has(skeletonId)
    || skeleton.splitAssignment !== 'TRAIN' || skeleton.boundaryClass !== 'APPROXIMATION / RANGE'
    || skeleton.humanLabel !== 'ESCALATE' || (skeleton.contrastGroupId ?? null) !== contract.contrastGroupId
    || retirement?.retiredSkeletonId !== contract.retiredSkeletonId || !retired.has(contract.retiredSkeletonId)) {
    fail(`not the frozen active v3 replacement skeleton: ${skeletonId}`);
  }
  return { skeleton, retirement };
}

function materialize(row, artifacts) {
  const { skeleton, retirement } = replacementSkeleton(artifacts, row.semanticSkeletonId);
  if (!DISCOURSE_PATTERNS.includes(row.discoursePattern)) fail(`unknown discourse pattern: ${row.n}`);
  const turns = row.turns.map(([role, text], index) => ({ turnId: `t${index + 1}`, role, text }));
  const byId = new Map(turns.map(turn => [turn.turnId, turn]));
  const haystack = Buffer.from(byId.get(row.anchorTurnId).text, 'utf8');
  const needle = Buffer.from(row.anchorText, 'utf8');
  const startByte = haystack.indexOf(needle);
  if (startByte < 0 || haystack.indexOf(needle, startByte + 1) >= 0) fail(`anchor is not unique in its turn: ${row.n}`);
  return {
    episode: {
      sourceEpisodeId: `p1b6-se-rp1-${row.n}`,
      sourceFamilyId: `p1b6-sf-rp1-${row.n}`,
      splitAssignment: skeleton.splitAssignment,
      language: row.language,
      turns,
    },
    item: {
      itemId: `p1b6-item-rp1-${row.n}`,
      sourceEpisodeId: `p1b6-se-rp1-${row.n}`,
      semanticSkeletonId: row.semanticSkeletonId,
      anchorSpanRef: { turnId: row.anchorTurnId, startByte, endByte: startByte + utf8Length(row.anchorText) },
      anchorText: row.anchorText,
      evidenceSpanRefs: row.evidenceTurnIds.map(turnId => ({
        turnId, startByte: 0, endByte: utf8Length(byId.get(turnId).text),
      })),
      discoursePattern: row.discoursePattern,
      surfaceFamilyId: `p1b6-surface-family-rp1-${row.n}`,
      intendedUnresolvedReadings: [...retirement.intendedUnresolvedReadings],
    },
  };
}

function validateCandidate(candidate, artifacts) {
  const skeletonIds = candidate.items.map(row => row.semanticSkeletonId);
  if (JSON.stringify(skeletonIds.toSorted()) !== JSON.stringify(Object.keys(REPLACEMENTS).toSorted())) {
    fail('candidate must hold exactly one row per replacement skeleton');
  }
  const text = JSON.stringify(candidate);
  for (const { retiredSkeletonId } of Object.values(REPLACEMENTS)) {
    if (text.includes(retiredSkeletonId)) fail(`retired skeleton appears in the candidate: ${retiredSkeletonId}`);
  }
  const prior = [artifacts.batch, artifacts.repairCandidate, artifacts.targetBoundaryCandidate];
  const known = new Set(prior.flatMap(artifact => [
    ...artifact.items.flatMap(row => [row.itemId, row.surfaceFamilyId]),
    ...artifact.sourceEpisodes.flatMap(row => [row.sourceEpisodeId, row.sourceFamilyId]),
  ]));
  const episodes = new Map(candidate.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  for (const item of candidate.items) {
    const episode = episodes.get(item.sourceEpisodeId);
    for (const id of [item.itemId, item.surfaceFamilyId, episode.sourceEpisodeId, episode.sourceFamilyId]) {
      if (known.has(id)) fail(`fresh realization reuses a historical ID: ${id}`);
    }
    const turns = new Map(episode.turns.map(turn => [turn.turnId, turn]));
    if (decodeSpan(turns.get(item.anchorSpanRef.turnId).text, item.anchorSpanRef) !== item.anchorText
      || !item.evidenceSpanRefs.some(span => span.turnId === item.anchorSpanRef.turnId)) {
      fail(`anchor is not inside its evidence: ${item.itemId}`);
    }
    const fragments = computeFragments(item, episode).length;
    if (fragments < 1 || fragments > 5) fail(`fragment count must be 1..5: ${item.itemId}`);
  }
  plan.validateBatch003Leakage(candidate, [
    ...plan.loadPriorSources(),
    ...prior.flatMap(artifact => artifact.sourceEpisodes
      .map(episode => ({ origin: artifact.name, id: episode.sourceEpisodeId, turns: episode.turns }))),
  ]);
  return candidate;
}

function buildCandidate(artifacts, authored = AUTHORED) {
  const rows = authored.map(row => materialize(row, artifacts));
  return validateCandidate({
    name: CANDIDATE_IDENTITY,
    status: 'FRESH_REALIZATION_CANDIDATE_AWAITING_SOURCE_AUDIT_AND_V3_REVIEW',
    interpretationRule: 'P1B6_SEMANTIC_CONTRACT_V3',
    provenance: {
      semanticAuthority: { identity: SOURCES.v3.identity, rawSha256: SOURCES.v3.rawSha256 },
      semanticContractReceipt: { identity: SOURCES.v3Receipt.identity, rawSha256: SOURCES.v3Receipt.rawSha256 },
      note: 'Fresh content under new IDs for the two v3 replacement skeletons. No retired-skeleton surface, ID, text, source-audit result, model or HUMAN decision, eligibility or provenance is carried over. First coverage, not a replacement count; top-up decides later quantity.',
      intendedUnresolvedReadingsNote: 'intendedUnresolvedReadings are the v3 receipt\'s author intent for each skeleton. They are hidden from every blind audit and review packet and are not gold.',
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
  const candidate = buildCandidate(verifySources(loadSources()));
  fs.writeFileSync(path.join(ROOT, 'fixtures', CANDIDATE_FILE), artifactBytes(candidate));
  process.stdout.write(`Wrote fixtures/${CANDIDATE_FILE}\n`);
  return 0;
}

module.exports = {
  AUTHORED,
  CANDIDATE_FILE,
  REPLACEMENTS,
  SOURCES,
  artifactBytes,
  buildCandidate,
  loadSources,
  main,
  verifySources,
};

if (require.main === module) process.exit(main());
