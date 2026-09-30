#!/usr/bin/env node
'use strict';

// P1-B6 batch-005 top-up: two EN TRAIN slots for the ledger-v2 EN shortage of one.
//
// Owner-approved allocation (2026-09-30): one slot on the lowest-coverage TRAIN skeleton under the
// batch-004 rule (0768ea20, ESCALATE) and one on the lowest-coverage CLEAR TRAIN skeleton
// (f4d809ae), so that a loss on the harder skeleton can be absorbed. Calibration is every clean
// agreement. The builder writes the preregistered protocol and the materialized batch; offsets and
// IDs are computed from the authored text. It audits, reviews, accepts and trains nothing.

const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { computeFragments, validateSurfaceBatch } = require('../lib/memory-inference-p1b6-surfaces');
const plan003 = require('./build-memory-inference-p1b6-batch-003-authoring-plan');

const ROOT = path.resolve(__dirname, '..');
const PROTOCOL_IDENTITY = 'xion-local-memory-inference-p1b6-surface-batch-005-authoring-protocol-v1';
const PROTOCOL_FILE = 'local-memory-inference-p1b6-surface-batch-005-authoring-protocol.json';
const BATCH_IDENTITY = 'xion-local-memory-inference-p1b6-surface-batch-005-v1';
const BATCH_FILE = 'local-memory-inference-p1b6-surface-batch-005.json';

const SOURCES = Object.freeze({
  v3: ['xion-local-memory-inference-p1b6-skeleton-effective-current-v3', '89a48264d6b09710f976a4ab85235ff161cf81ff44896e37553d5dc7753c65b9', 'local-memory-inference-p1b6-skeleton-effective-current-v3.json'],
  ledgerV2: ['xion-local-memory-inference-p1b6-reviewed-pool-ledger-v2', '853de398664ced6fd2c11299be77c20f8ce452615bff51bfd51c331388b1329d', 'local-memory-inference-p1b6-reviewed-pool-ledger-v2.json'],
  shortageV2: ['xion-local-memory-inference-p1b6-shortage-receipt-v2', '9c6bbda80521f2f6db707e905f04ba3923360f67028e595962b5a430d60792cd', 'local-memory-inference-p1b6-shortage-receipt-v2.json'],
  batch003: ['xion-local-memory-inference-p1b6-surface-batch-003-v1', '90b453c3680bccaa537fd0d23db74bbc303882e1a35a2ddcea0b75b013fcaa68', 'local-memory-inference-p1b6-surface-batch-003.json'],
  repairCandidate: ['xion-local-memory-inference-p1b6-surface-repair-candidate-batch-003-v1', '8f6254946eef8d8d0920485bde431ca137a83577a5060889f3676b8857b4aa9b', 'local-memory-inference-p1b6-surface-repair-candidate-batch-003.json'],
  anchorCandidate: ['xion-local-memory-inference-p1b6-surface-anchor-repair-candidate-batch-003-v1', '19eea01def0a05c32c1ceb236fa97305e7b29822c9e56b70cc0331f3a873599f', 'local-memory-inference-p1b6-surface-anchor-repair-candidate-batch-003.json'],
  tb1Candidate: ['xion-local-memory-inference-p1b6-surface-target-boundary-candidate-v1', '5a4253506a9a9885118781c68cdcc407d91b6497b4b1af2105a675332ef8a7f5', 'local-memory-inference-p1b6-surface-target-boundary-candidate.json'],
  rp1Candidate: ['xion-local-memory-inference-p1b6-surface-v3-replacement-candidate-v1', '8c3ff152cfb42abfe4a327e4ba84b833904946c7400332ab5e560980a9af47cc', 'local-memory-inference-p1b6-surface-v3-replacement-candidate.json'],
  batch004: ['xion-local-memory-inference-p1b6-surface-batch-004-v1', 'f640198f9d472c00046b8cb22083407b12887534bf0544cd808620691c5bc0c1', 'local-memory-inference-p1b6-surface-batch-004.json'],
});

const SLOTS = Object.freeze([
  Object.freeze({ slot: '001', semanticSkeletonId: 'p1b6-sk-0768ea2028f18511', splitAssignment: 'TRAIN', authoringTargetLabel: 'ESCALATE', language: 'EN', fragments: 2, discoursePattern: 'CANONICAL', allocationRule: 'lowest pooled coverage in TRAIN, ties by skeleton ID (batch-004 rule)' }),
  Object.freeze({ slot: '002', semanticSkeletonId: 'p1b6-sk-f4d809ae085dbac9', splitAssignment: 'TRAIN', authoringTargetLabel: 'CLEAR', language: 'EN', fragments: 3, discoursePattern: 'CONTEXT_FIRST', allocationRule: 'owner exception: lowest pooled coverage among CLEAR TRAIN skeletons, to absorb a loss on the harder slot' }),
]);

// One entry per slot: `ev` selects whole evidence turns by index, `anchor` is [turnIndex, text].
// CLEAR: the visible evidence provides the TARGET's status (including an approximate or
// attributed one). ESCALATE: the TARGET status cannot be stated because materially different
// readings stay open or a necessary fact is absent. No premise is invented.
const CONTENT = Object.freeze([
  {
    turns: [
      ['USER', "I'm comparing two desk mats for my office."],
      ['USER', 'The first one is 80 cm wide and 40 cm deep.'],
      ['USER', 'My coffee went cold while I was measuring.'],
      ['USER', 'The second one is about 5 cm bigger on one side, and the other side is the same.'],
    ],
    ev: [0, 1, 3], anchor: [3, 'about 5 cm bigger on one side'],
  },
  {
    turns: [
      ['USER', 'For context, my sister is flying in for the holidays.'],
      ['USER', 'The garage door remote needs new batteries.'],
      ['USER', 'She said her flight lands sometime between 3 and 4 p.m.'],
      ['USER', 'The milk is almost gone.'],
      ['USER', "I'll leave for the airport around 2:30."],
    ],
    ev: [0, 2, 4], anchor: [2, 'between 3 and 4 p.m.'],
  },
]);

function fail(message) {
  throw new TypeError(`P1-B6 batch-005 ${message}`);
}

function loadSources(root = ROOT) {
  return Object.fromEntries(Object.entries(SOURCES)
    .map(([key, [, , fixture]]) => [key, fs.readFileSync(path.join(root, 'fixtures', fixture))]));
}

function verifySources(rawSources) {
  return Object.fromEntries(Object.entries(SOURCES).map(([key, [identity, rawSha256]]) => {
    const bytes = rawSources?.[key];
    if (!bytes || sha256RawBytes(Buffer.from(bytes)) !== rawSha256) fail(`${identity} bytes are not the pinned artifact`);
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
    if (parsed.name !== identity) fail(`${identity} identity is invalid`);
    return [key, parsed];
  }));
}

function buildProtocol(a) {
  if (a.shortageV2.pool.language.EN.deficit !== 1 || a.shortageV2.minimumTopUpLowerBound !== 1) {
    fail('shortage v2 is not the EN-by-one shortage this top-up answers');
  }
  const skeletons = new Map(a.v3.candidates.map(row => [row.semanticSkeletonId, row]));
  for (const slot of SLOTS) {
    const skeleton = skeletons.get(slot.semanticSkeletonId);
    if (skeleton?.splitAssignment !== slot.splitAssignment || skeleton.humanLabel !== slot.authoringTargetLabel) {
      fail(`slot ${slot.slot} does not match its v3 skeleton`);
    }
  }
  return {
    name: PROTOCOL_IDENTITY,
    status: 'PREREGISTERED',
    decisionsSource: 'REPOSITORY_OWNER_APPROVED_TOP_UP_PARAMETERS',
    inputs: Object.fromEntries(['v3', 'ledgerV2', 'shortageV2'].map(key => [key, { identity: SOURCES[key][0], rawSha256: SOURCES[key][1] }])),
    tranche: { total: 2, lowerBound: 1, buffer: 1, split: { TRAIN: 2, DEV: 0, FINAL_HELD_OUT: 0 }, language: { EN: 2 } },
    slots: SLOTS,
    authoringRules: [
      'Fresh content under the b005 namespace; no reuse of any prior text, ID or review result.',
      'The batch-003 leakage check runs fail-closed against every prior batch and candidate artifact, including batch-004.',
      'Authoring target labels are generator targets, not HUMAN gold, and never enter a blind packet.',
      'The owner reviews the authored text before the source audit.',
    ],
    gates: {
      order: ['owner pre-audit authoring review', 'fresh source/bundle audit (FAIL / UNCERTAIN excluded)',
        'blind v3 strong-model semantic review', 'mandatory HUMAN for disagreement / FIX / REJECT / missing',
        'HUMAN calibration of every clean agreement'],
      calibration: { rule: 'every clean agreement', matchingKeepSemantics: 'stays CATALOG_STRONG_MODEL_CONFIRMED / PROVISIONAL; not promoted' },
      mandatoryMatchingKeepSemantics: 'HUMAN_ADJUDICATED / ELIGIBLE',
    },
    authority: {
      sourceAuditRun: false, semanticReviewRun: false, humanReviewRun: false,
      acceptancePerformed: false, finalSelectionPerformed: false, trainingOrEvaluationOccurred: false,
    },
  };
}

function spanFor(turn, selector) {
  const haystack = Buffer.from(turn.text, 'utf8');
  if (selector === undefined) return { turnId: turn.turnId, startByte: 0, endByte: haystack.length };
  const needle = Buffer.from(selector, 'utf8');
  const startByte = haystack.indexOf(needle);
  if (startByte < 0 || haystack.indexOf(needle, startByte + 1) >= 0) fail(`text is missing or not unique in ${turn.turnId}: ${selector}`);
  return { turnId: turn.turnId, startByte, endByte: startByte + needle.length };
}

function buildBatch(a, content = CONTENT) {
  if (content.length !== SLOTS.length) fail(`authored content must hold exactly ${SLOTS.length} episodes`);
  const rows = SLOTS.map((slot, index) => {
    const entry = content[index];
    const turns = entry.turns.map(([role, text], n) => ({ turnId: `t${n + 1}`, role, text }));
    const turnAt = n => turns[n] ?? fail(`turn ${n} is missing in slot ${slot.slot}`);
    const episode = {
      sourceEpisodeId: `p1b6-se-b005-${slot.slot}`,
      sourceFamilyId: `p1b6-sf-b005-${slot.slot}`,
      splitAssignment: slot.splitAssignment,
      language: slot.language,
      turns,
    };
    const item = {
      itemId: `p1b6-item-b005-${slot.slot}`,
      sourceEpisodeId: episode.sourceEpisodeId,
      semanticSkeletonId: slot.semanticSkeletonId,
      anchorSpanRef: spanFor(turnAt(entry.anchor[0]), entry.anchor[1]),
      evidenceSpanRefs: entry.ev.map(n => spanFor(turnAt(n))),
      discoursePattern: slot.discoursePattern,
      surfaceFamilyId: `p1b6-surface-family-b005-${slot.slot}`,
    };
    const fragments = computeFragments(item, episode).length;
    if (fragments !== slot.fragments) fail(`slot ${slot.slot} yields ${fragments} fragments, spec wants ${slot.fragments}`);
    return { episode, item };
  });
  const batch = { name: BATCH_IDENTITY, batchId: 'p1b6-surface-batch-005', sourceEpisodes: rows.map(row => row.episode), items: rows.map(row => row.item) };
  validateSurfaceBatch(batch, { exact56: a.v3 });
  plan003.validateBatch003Leakage(batch, [
    ...plan003.loadPriorSources(),
    ...['batch003', 'repairCandidate', 'anchorCandidate', 'tb1Candidate', 'rp1Candidate', 'batch004']
      .flatMap(key => a[key].sourceEpisodes.map(episode => ({ origin: a[key].name, id: episode.sourceEpisodeId, turns: episode.turns }))),
  ]);
  return batch;
}

const artifactBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');

function buildAll(rawSources = loadSources(), content = CONTENT) {
  const a = verifySources(rawSources);
  return { protocol: buildProtocol(a), batch: buildBatch(a, content) };
}

function main() {
  const { protocol, batch } = buildAll();
  for (const [file, value] of [[PROTOCOL_FILE, protocol], [BATCH_FILE, batch]]) {
    fs.writeFileSync(path.join(ROOT, 'fixtures', file), artifactBytes(value));
    process.stdout.write(`Wrote fixtures/${file}\n`);
  }
  return 0;
}

module.exports = { BATCH_FILE, CONTENT, PROTOCOL_FILE, SLOTS, SOURCES, artifactBytes, buildAll, loadSources, main, verifySources };

if (require.main === module) process.exit(main());
