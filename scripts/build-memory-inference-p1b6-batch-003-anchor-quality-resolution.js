#!/usr/bin/env node
'use strict';

// P1-B6 semantic-contract-v3 anchor-quality follow-up for the CLEAR skeletons aebbf047 and
// 869c7127. This is an anchor-quality resolution under the closed anchor contract (the anchor
// names the candidate/topic, not a value or supporting fact), not a semantic amendment.
//
// 869c7127: all four batch-003 anchors already mark the observed state itself -> PASS, unchanged.
// aebbf047: all five mark a one-sided value sub-span -> REANCHOR to the approved topic span.
// The five reanchored rows are materialized as an anchorSpanRef-only candidate; frozen batch-003
// and every historical audit/model/HUMAN result stay as they are and do not transfer.

const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { computeFragments, decodeSpan, utf8Length } = require('../lib/memory-inference-p1b6-surfaces');
const { renderCandidateBundle } = require('./build-memory-inference-p1b6-surface-repair-source-audit-packet');

const ROOT = path.resolve(__dirname, '..');
const RECEIPT_IDENTITY = 'xion-local-memory-inference-p1b6-batch-003-anchor-quality-resolution-receipt-v1';
const RECEIPT_FILE = 'local-memory-inference-p1b6-batch-003-anchor-quality-resolution-receipt.json';
const CANDIDATE_IDENTITY = 'xion-local-memory-inference-p1b6-surface-anchor-repair-candidate-batch-003-v1';
const CANDIDATE_FILE = 'local-memory-inference-p1b6-surface-anchor-repair-candidate-batch-003.json';

const SKELETONS = Object.freeze({
  'p1b6-sk-aebbf047d6864a35': Object.freeze({
    split: 'DEV', boundaryClass: 'COMPLEMENTARY EVIDENCE', count: 5, disposition: 'REANCHOR',
  }),
  'p1b6-sk-869c71279b6b8a33': Object.freeze({
    split: 'FINAL_HELD_OUT', boundaryClass: 'ACTUALITY', count: 4, disposition: 'ANCHOR_QUALITY_PASS',
  }),
});

const item = number => `p1b6-item-b003-${number}`;
// The owner's closed decisions, keyed by item. Current anchors are asserted against the bytes.
const DECISIONS = Object.freeze({
  [item('192')]: { currentAnchorText: 'dark mode로 떠 있어' },
  [item('193')]: { currentAnchorText: '저녁 10시 이후엔 알림이 안 울려' },
  [item('194')]: { currentAnchorText: '흑백으로만 나와' },
  [item('195')]: { currentAnchorText: '광고 메일이 하나도 안 들어와' },
  [item('224')]: { currentAnchorText: '본사 예산에 30만 원이 잡혀 있고', newAnchorText: '이번 출장비', newAnchorTurnId: 't1' },
  [item('225')]: { currentAnchorText: '두 명으로 적혀 있어', newAnchorText: '이번 프로젝트 인력', newAnchorTurnId: 't1' },
  // `재고` also occurs inside `재고표` in t3 / t5; the topic mention is t1.
  [item('226')]: { currentAnchorText: '열 개로 돼 있어', newAnchorText: '재고', newAnchorTurnId: 't1' },
  [item('227')]: { currentAnchorText: '500만 원이 적혀 있고', newAnchorText: '이번 달 광고 예산', newAnchorTurnId: 't1' },
  [item('228')]: { currentAnchorText: '닷새 남은 걸로 나오고', newAnchorText: '내 연차', newAnchorTurnId: 't1' },
});
const RATIONALE = Object.freeze({
  ANCHOR_QUALITY_PASS: 'The marked span is the candidate\'s observed state or behavior itself, not its unknown cause, a supporting fact or an internal slot; it matches the skeleton focus and the anchor contract.',
  REANCHOR: 'The marked span is one value or status sub-span from only one side of the complementary evidence, not the candidate/topic; the approved span names the topic both sides describe.',
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
  sourceAudit: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-source-audit-batch-003-attempt-001-receipt-v1',
    rawSha256: '3c840476bea6eccb522800248a3ace277b26a5334ec56b5f6b10bbf4d5821221',
    fixture: 'local-memory-inference-p1b6-source-audit-batch-003-attempt-001.json',
  }),
  strongModel: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-strong-model-semantic-review-batch-003-attempt-001-receipt-v1',
    rawSha256: '9b65327a4ce6d1923391253659c1acc3bb373bb54acdc7872e3ce74d52337074',
    fixture: 'local-memory-inference-p1b6-strong-model-semantic-review-batch-003-attempt-001.json',
  }),
  human: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-batch-003-human-adjudication-calibration-attempt-001-receipt-v1',
    rawSha256: '0adbba1789bb91025f277701c51cbf82139092f147966053277573c3f0dbbe6a',
    fixture: 'local-memory-inference-p1b6-batch-003-human-adjudication-calibration-attempt-001.json',
  }),
  resolution: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-batch-003-resolution-receipt-v1',
    rawSha256: '61c29218a360bf914c6453758c7fc243e629f1b5d400e38426d9d18720cb1ffe',
    fixture: 'local-memory-inference-p1b6-batch-003-resolution-receipt.json',
  }),
  acceptance: Object.freeze({
    identity: 'xion-local-memory-inference-p1b6-batch-002-acceptance-v1',
    rawSha256: 'c03b8dcf4ddcb2c5f8b193cde8247b9ad64b8ea676da51cab1d709795b273598',
    fixture: 'local-memory-inference-p1b6-batch-002-acceptance.json',
  }),
});

function fail(message) {
  throw new TypeError(`P1-B6 batch-003 anchor-quality resolution ${message}`);
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

// From the two skeleton IDs and canonical batch-003 only.
function deriveRows(artifacts) {
  const retired = new Set(artifacts.v3.retiredSkeletons.map(row => row.retiredSkeletonId));
  for (const [skeletonId, frozen] of Object.entries(SKELETONS)) {
    const skeleton = artifacts.v3.candidates.find(row => row.semanticSkeletonId === skeletonId);
    if (!skeleton || retired.has(skeletonId) || skeleton.humanLabel !== 'CLEAR'
      || skeleton.splitAssignment !== frozen.split || skeleton.boundaryClass !== frozen.boundaryClass) {
      fail(`not the frozen active v3 CLEAR skeleton: ${skeletonId}`);
    }
  }
  const rows = artifacts.batch.items.filter(row => Object.hasOwn(SKELETONS, row.semanticSkeletonId));
  for (const [skeletonId, frozen] of Object.entries(SKELETONS)) {
    if (rows.filter(row => row.semanticSkeletonId === skeletonId).length !== frozen.count) {
      fail(`population drifted on ${skeletonId}`);
    }
  }
  if (JSON.stringify(rows.map(row => row.itemId).toSorted()) !== JSON.stringify(Object.keys(DECISIONS).toSorted())) {
    fail('population is not the closed decision set');
  }
  const episodes = new Map(artifacts.batch.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  return rows.map(row => {
    const episode = episodes.get(row.sourceEpisodeId);
    const turn = episode.turns.find(entry => entry.turnId === row.anchorSpanRef.turnId);
    const current = decodeSpan(turn.text, row.anchorSpanRef);
    if (current !== DECISIONS[row.itemId].currentAnchorText) fail(`current anchor drifted: ${row.itemId}`);
    return { row, episode, current };
  }).sort((a, b) => (a.row.itemId < b.row.itemId ? -1 : 1));
}

function reanchor(row, episode, decision) {
  const turn = episode.turns.find(entry => entry.turnId === decision.newAnchorTurnId);
  const haystack = Buffer.from(turn.text, 'utf8');
  const needle = Buffer.from(decision.newAnchorText, 'utf8');
  const startByte = haystack.indexOf(needle);
  if (startByte < 0 || haystack.indexOf(needle, startByte + 1) >= 0) {
    fail(`approved anchor is not unique in its turn: ${row.itemId}`);
  }
  const anchorSpanRef = { turnId: turn.turnId, startByte, endByte: startByte + utf8Length(decision.newAnchorText) };
  if (!row.evidenceSpanRefs.some(span => span.turnId === anchorSpanRef.turnId
    && span.startByte <= anchorSpanRef.startByte && span.endByte >= anchorSpanRef.endByte)) {
    fail(`approved anchor is outside selected evidence: ${row.itemId}`);
  }
  return { ...row, anchorSpanRef };
}

const withoutTarget = bundle => bundle.replace('[TARGET]', '').replace('[/TARGET]', '');

function buildArtifacts(artifacts) {
  const derived = deriveRows(artifacts);
  const reanchored = derived.filter(({ row }) => SKELETONS[row.semanticSkeletonId].disposition === 'REANCHOR');
  const candidate = {
    name: CANDIDATE_IDENTITY,
    status: 'ANCHOR_REPAIR_CANDIDATE_AWAITING_FRESH_SOURCE_AUDIT_AND_V3_REVIEW',
    interpretationRule: 'P1B6_SEMANTIC_CONTRACT_V3',
    provenance: {
      resolutionReceipt: RECEIPT_IDENTITY,
      historicalSourceBatch: { identity: SOURCES.batch.identity, rawSha256: SOURCES.batch.rawSha256 },
      note: 'Only anchorSpanRef changed, recomputed from the unchanged source bytes. IDs, source text, evidence spans, split, language and discourse pattern are the historical ones. Old source-audit, strong-model and HUMAN judgments were about the old marked bundle and do not transfer.',
    },
    pending: { freshSourceAudit: true, freshV3SemanticReview: true, humanAdjudicationWhereRouted: true },
    authority: {
      historicalReviewTransferred: false,
      sourceAuditPerformed: false,
      semanticReviewPerformed: false,
      humanReviewPerformed: false,
      accepted: false,
      referenceLabelFreezePerformed: false,
      finalSelectionPerformed: false,
      heldOutReleasePerformed: false,
      trainingOccurred: false,
    },
    sourceEpisodes: reanchored.map(({ episode }) => episode),
    items: reanchored.map(({ row, episode }) => reanchor(row, episode, DECISIONS[row.itemId])),
  };
  // The model-visible change is the TARGET marker alone.
  const historical = { sourceEpisodes: artifacts.batch.sourceEpisodes };
  candidate.items.forEach((next, index) => {
    const { row, episode } = reanchored[index];
    if (withoutTarget(renderCandidateBundle(candidate, next)) !== withoutTarget(renderCandidateBundle(historical, row))
      || computeFragments(next, episode).length !== computeFragments(row, episode).length) {
      fail(`reanchored bundle changed beyond the marker: ${row.itemId}`);
    }
  });

  const receipt = {
    name: RECEIPT_IDENTITY,
    status: 'COMPLETE_ANCHOR_QUALITY_RESOLUTION_REANCHORED_ROWS_PENDING_FRESH_GATES',
    decisionsSource: 'REPOSITORY_OWNER_ANCHOR_QUALITY_ADJUDICATION',
    statement: [
      'Anchor-quality resolution under the closed anchor contract, not a semantic amendment. Both skeletons keep their v3 CLEAR semantics unchanged.',
      '869c7127: all four rows already mark the observed state itself and stay unchanged; no fresh review is opened because no model-visible bundle changes.',
      'aebbf047: all five rows are reanchored to the approved candidate/topic span; only anchorSpanRef changes, so they need a fresh source/bundle audit and a fresh v3 semantic review.',
      'Historical source-audit, strong-model and HUMAN evidence is not rewritten; for the reanchored rows it remains evidence about the old marked bundle only.',
    ],
    inputs: Object.fromEntries(Object.entries(SOURCES)
      .map(([key, pinned]) => [key, { identity: pinned.identity, rawSha256: pinned.rawSha256 }])),
    summary: {
      total: derived.length,
      REANCHOR: reanchored.length,
      ANCHOR_QUALITY_PASS: derived.length - reanchored.length,
    },
    rows: derived.map(({ row, current }) => {
      const disposition = SKELETONS[row.semanticSkeletonId].disposition;
      return {
        itemId: row.itemId,
        semanticSkeletonId: row.semanticSkeletonId,
        currentAnchorText: current,
        disposition,
        rationale: RATIONALE[disposition],
        ...(disposition === 'REANCHOR' ? { approvedAnchorText: DECISIONS[row.itemId].newAnchorText } : {}),
      };
    }),
    candidateArtifact: CANDIDATE_IDENTITY,
    acceptedPool: { cumulativeAcceptedSurfacePool: artifacts.acceptance.corpusGrowth.cumulativeAcceptedSurfacePool, reopened: false },
    authority: {
      semanticContractAmended: false,
      skeletonChanged: false,
      historicalArtifactsRewritten: false,
      historicalReviewTransferred: false,
      acceptancePerformed: false,
      referenceLabelFreezePerformed: false,
      finalSelectionPerformed: false,
      heldOutReleasePerformed: false,
      trainingOrEvaluationOccurred: false,
    },
  };
  return { receipt, candidate };
}

const artifactBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');

function main() {
  const { receipt, candidate } = buildArtifacts(verifySources(loadSources()));
  for (const [file, value] of [[RECEIPT_FILE, receipt], [CANDIDATE_FILE, candidate]]) {
    fs.writeFileSync(path.join(ROOT, 'fixtures', file), artifactBytes(value));
    process.stdout.write(`Wrote fixtures/${file}\n`);
  }
  return 0;
}

module.exports = {
  CANDIDATE_FILE,
  DECISIONS,
  RECEIPT_FILE,
  SKELETONS,
  SOURCES,
  artifactBytes,
  buildArtifacts,
  deriveRows,
  loadSources,
  main,
  verifySources,
};

if (require.main === module) process.exit(main());
