#!/usr/bin/env node
'use strict';

// Batch-003 adaptive corpus-growth authoring plan.
//
// This derives the tranche plan from the canonical accepted pool and validates the committed
// batch-003 fixture against it. It authors no semantics, executes no HUMAN decision, invents
// no source-audit disposition, performs no acceptance, freezes no gold, runs no HELD repeated
// review, performs no FINAL selection, and trains nothing.
//
// Semantic authority for all NEW authoring is the effective-current skeleton catalog, not the
// historical Exact56 freeze. Exact56 stays immutable provenance, and
// lib/memory-inference-p1b6-surfaces.js keeps pointing at it for historical validation.
//
// Deliberately batch-003-specific. No generic corpus/allocator framework is introduced.

const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const {
  computeFragments,
  validateSurfaceBatch,
} = require('../lib/memory-inference-p1b6-surfaces');

const ROOT = path.resolve(__dirname, '..');
const BATCH_003_IDENTITY = 'xion-local-memory-inference-p1b6-surface-batch-003-v1';
const BATCH_003_ID = 'p1b6-surface-batch-003';
const BATCH_003_FILE = 'local-memory-inference-p1b6-surface-batch-003.json';
const PROTOCOL_IDENTITY =
  'xion-local-memory-inference-p1b6-surface-batch-003-authoring-protocol-v1';
const PROTOCOL_FILE = 'local-memory-inference-p1b6-surface-batch-003-authoring-protocol.json';
// Same normalization the batch-002 growth tests already use, so the duplicate metric stays
// comparable across batches rather than being a new invented similarity measure.
const NON_TRIVIAL_TURN_CHARS = 12;
const LEAKAGE_SOURCES = Object.freeze([
  'local-memory-inference-p1b6-surface-batch-001.json',
  'local-memory-inference-p1b6-surface-batch-002.json',
  'local-memory-inference-p1b6-surface-effective-current-batch-002.json',
]);
const PILOT_FIXTURE = 'local-memory-inference-p1b6-anchor-marker-pilot.json';
const INTERPRETATION_RULE = 'CONSERVATIVE_PRAGMATIC_INTERPRETATION';

const SPLITS = Object.freeze(['TRAIN', 'DEV', 'FINAL_HELD_OUT']);
const LABELS = Object.freeze(['CLEAR', 'ESCALATE']);
const LANGUAGES = Object.freeze(['KO', 'MIXED', 'EN']);
const FRAGMENT_BUCKETS = Object.freeze([1, 2, 3, 4, 5]);
const DISCOURSE_PATTERNS = Object.freeze([
  'CANONICAL', 'CONTEXT_FIRST', 'CONCLUSION_FIRST', 'INTERLEAVED',
  'PROGRESSIVE_REFINEMENT', 'SELF_REVISION', 'RETURN_TO_TOPIC', 'ELLIPTICAL_REPLY',
]);

// Frozen final-corpus contracts. These are NOT changed by this tranche; 380 stays the only
// exact corpus-size contract and 304 is an authoring-tranche size.
const FINAL_CORPUS = Object.freeze({
  total: 380,
  split: Object.freeze({ TRAIN: 240, DEV: 60, FINAL_HELD_OUT: 80 }),
  label: Object.freeze({ CLEAR: 190, ESCALATE: 190 }),
  language: Object.freeze({ KO: 266, MIXED: 76, EN: 38 }),
  fragments: Object.freeze({ 1: 70, 2: 100, 3: 120, 4: 70, 5: 20 }),
  heldSurfacesPerSkeleton: 5,
});
const TRANCHE_SIZE = 304;
const DISCOURSE_PER_PATTERN = 38;

const CANONICAL_INPUTS = Object.freeze({
  effectiveCatalog: Object.freeze({
    label: 'effective-current skeleton catalog',
    identity: 'xion-local-memory-inference-p1b6-skeleton-effective-current-v1',
    rawSha256: '48490b6e4e1494856ef3268d944da16093c4735d207e07c1fd9e8bbf69df2559',
    fixture: 'local-memory-inference-p1b6-skeleton-effective-current.json',
  }),
  batch001: Object.freeze({
    label: 'surface batch-001',
    identity: 'xion-local-memory-inference-p1b6-surface-batch-001-v1',
    rawSha256: '2a4605f5550118754c315e26700aef1be96a3129a3ef0065fd2accdad5352a36',
    fixture: 'local-memory-inference-p1b6-surface-batch-001.json',
  }),
  smokeAcceptance: Object.freeze({
    label: 'smoke batch-001 acceptance',
    identity: 'xion-local-memory-inference-p1b6-smoke-batch-001-acceptance-v1',
    rawSha256: '449318d5d3895fca87257a40b7d47b6d8d8eb3df8e9817fff5998a34d658bb5c',
    fixture: 'local-memory-inference-p1b6-smoke-batch-001-acceptance.json',
  }),
  batch002Successor: Object.freeze({
    label: 'batch-002 effective-current surface successor',
    identity: 'xion-local-memory-inference-p1b6-surface-effective-current-batch-002-v1',
    rawSha256: '9701db8902ae99dc5c08cffb176bf9247443884910e3002b77548ac5436157d1',
    fixture: 'local-memory-inference-p1b6-surface-effective-current-batch-002.json',
  }),
  batch002Human: Object.freeze({
    label: 'batch-002 accepted HUMAN successor',
    identity: 'xion-local-memory-inference-p1b6-primary-human-accepted-current-batch-002-v1',
    rawSha256: '32b2221e2cefdb9a1a7e47efa1f5accd3d2a915c3f418578dc8f1c314b5281c4',
    fixture: 'local-memory-inference-p1b6-primary-human-accepted-current-batch-002.json',
  }),
  batch002Acceptance: Object.freeze({
    label: 'batch-002 acceptance',
    identity: 'xion-local-memory-inference-p1b6-batch-002-acceptance-v1',
    rawSha256: 'c03b8dcf4ddcb2c5f8b193cde8247b9ad64b8ea676da51cab1d709795b273598',
    fixture: 'local-memory-inference-p1b6-batch-002-acceptance.json',
  }),
});

// Expected baseline. The plan refuses to proceed if canonical main no longer reproduces it,
// rather than silently redesigning the tranche around a moved seed.
const EXPECTED_SEED = Object.freeze({
  total: 93,
  split: Object.freeze({ TRAIN: 56, DEV: 16, FINAL_HELD_OUT: 21 }),
  label: Object.freeze({ CLEAR: 57, ESCALATE: 36 }),
  language: Object.freeze({ KO: 65, MIXED: 18, EN: 10 }),
  fragments: Object.freeze({ 1: 18, 2: 26, 3: 27, 4: 17, 5: 5 }),
  coveredSkeletons: 55,
  totalSkeletons: 56,
  zeroCoveredSkeletonIds: Object.freeze(['p1b6-sk-aebbf047d6864a35']),
});

function fail(message) {
  throw new TypeError(`P1-B6 batch-003 authoring plan ${message}`);
}

function artifactBytes(artifact) {
  return Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
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

function verifyCanonicalInputs(canonicalInputs) {
  if (!canonicalInputs || typeof canonicalInputs !== 'object') {
    fail('canonical input bytes were not supplied');
  }
  return Object.fromEntries(Object.keys(CANONICAL_INPUTS)
    .map(key => [key, verifyCanonicalInput(key, canonicalInputs[key])]));
}

function tally(values, keys) {
  const counts = Object.fromEntries(keys.map(key => [key, 0]));
  for (const value of values) {
    if (!Object.hasOwn(counts, value)) fail(`unexpected tally key: ${value}`);
    counts[value] += 1;
  }
  return counts;
}

// Deterministic largest remainder. Ties break on the caller's canonical key order, which is
// always the frozen SPLITS / LABELS / LANGUAGES / FRAGMENT_BUCKETS order.
function largestRemainder(weights, total) {
  const sum = weights.reduce((left, right) => left + right, 0);
  if (sum <= 0) fail('largest remainder needs a positive weight sum');
  const exact = weights.map(weight => (weight * total) / sum);
  const allocated = exact.map(Math.floor);
  let remaining = total - allocated.reduce((left, right) => left + right, 0);
  const order = weights.map((weight, index) => index)
    .sort((left, right) => (exact[right] - allocated[right]) - (exact[left] - allocated[left])
      || left - right);
  for (let index = 0; index < remaining; index += 1) allocated[order[index]] += 1;
  return allocated;
}

function allocateDeficit(deficits, keys, buffer) {
  const weights = keys.map(key => deficits[key]);
  const extra = largestRemainder(weights, buffer);
  return Object.fromEntries(keys.map((key, index) => [key, deficits[key] + extra[index]]));
}

// The accepted pool is rebuilt from the canonical acceptance artifacts, never from a count.
function reconstructAcceptedSeed(artifacts) {
  const skeletons = new Map(artifacts.effectiveCatalog.candidates
    .map(row => [row.semanticSkeletonId, row]));
  const rows = [];

  const batch001Items = new Map(artifacts.batch001.items.map(row => [row.itemId, row]));
  const batch001Episodes = new Map(artifacts.batch001.sourceEpisodes
    .map(row => [row.sourceEpisodeId, row]));
  for (const accepted of artifacts.smokeAcceptance.accepted) {
    const item = batch001Items.get(accepted.itemId);
    if (!item) fail(`accepted batch-001 item is missing: ${accepted.itemId}`);
    const episode = batch001Episodes.get(item.sourceEpisodeId);
    rows.push({
      itemId: item.itemId,
      semanticSkeletonId: item.semanticSkeletonId,
      decision: accepted.decision,
      language: episode.language,
      fragments: computeFragments(item, episode).length,
    });
  }

  const batch002Episodes = new Map(artifacts.batch002Successor.sourceEpisodes
    .map(row => [row.sourceEpisodeId, row]));
  const batch002Human = new Map(artifacts.batch002Human.rows.map(row => [row.itemId, row]));
  for (const item of artifacts.batch002Successor.items) {
    const human = batch002Human.get(item.itemId);
    if (!human || human.decision !== item.humanDecision) {
      fail(`batch-002 successor and HUMAN successor disagree: ${item.itemId}`);
    }
    rows.push({
      itemId: item.itemId,
      semanticSkeletonId: item.semanticSkeletonId,
      decision: item.humanDecision,
      language: batch002Episodes.get(item.sourceEpisodeId).language,
      fragments: computeFragments(item, batch002Episodes.get(item.sourceEpisodeId)).length,
    });
  }

  if (rows.length !== artifacts.smokeAcceptance.summary.accepted
    + artifacts.batch002Acceptance.summary.accepted) {
    fail('accepted seed size disagrees with the acceptance artifacts');
  }

  const coverage = new Map();
  for (const row of rows) {
    coverage.set(row.semanticSkeletonId, (coverage.get(row.semanticSkeletonId) || 0) + 1);
  }
  const zeroCovered = artifacts.effectiveCatalog.candidates
    .filter(row => !coverage.has(row.semanticSkeletonId))
    .map(row => row.semanticSkeletonId);

  const seed = {
    total: rows.length,
    split: tally(rows.map(row => skeletons.get(row.semanticSkeletonId).splitAssignment), SPLITS),
    label: tally(rows.map(row => row.decision), LABELS),
    language: tally(rows.map(row => row.language), LANGUAGES),
    fragments: tally(rows.map(row => row.fragments), FRAGMENT_BUCKETS),
    coveredSkeletons: coverage.size,
    totalSkeletons: artifacts.effectiveCatalog.candidates.length,
    zeroCoveredSkeletonIds: zeroCovered,
    coverage,
    rows,
  };

  const observed = {
    total: seed.total,
    split: seed.split,
    label: seed.label,
    language: seed.language,
    fragments: seed.fragments,
    coveredSkeletons: seed.coveredSkeletons,
    totalSkeletons: seed.totalSkeletons,
    zeroCoveredSkeletonIds: zeroCovered,
  };
  if (JSON.stringify(observed) !== JSON.stringify(EXPECTED_SEED)) {
    fail('canonical main no longer reproduces the expected accepted-seed baseline');
  }
  return seed;
}

function deriveTranchePlan(seed) {
  const deficit = (targets, observed) => Object.fromEntries(Object.entries(targets)
    .map(([key, target]) => [key, Math.max(0, target - (observed[key] || 0))]));

  const splitDeficit = deficit(FINAL_CORPUS.split, seed.split);
  const labelDeficit = deficit(FINAL_CORPUS.label, seed.label);
  const languageDeficit = deficit(FINAL_CORPUS.language, seed.language);
  const fragmentDeficit = deficit(FINAL_CORPUS.fragments, seed.fragments);

  const noLossShortage = FINAL_CORPUS.total - seed.total;
  const sum = counts => Object.values(counts).reduce((left, right) => left + right, 0);
  for (const [name, counts] of Object.entries({
    split: splitDeficit, label: labelDeficit, language: languageDeficit,
    fragments: fragmentDeficit,
  })) {
    if (sum(counts) !== noLossShortage) fail(`${name} deficit does not total the shortage`);
  }
  const buffer = TRANCHE_SIZE - noLossShortage;
  if (buffer < 0) fail('tranche size is below the no-loss shortage');

  return {
    noLossShortage,
    trancheSize: TRANCHE_SIZE,
    buffer,
    deficits: {
      split: splitDeficit, label: labelDeficit,
      language: languageDeficit, fragments: fragmentDeficit,
    },
    split: allocateDeficit(splitDeficit, SPLITS, buffer),
    label: allocateDeficit(labelDeficit, LABELS, buffer),
    language: allocateDeficit(languageDeficit, LANGUAGES, buffer),
    fragments: allocateDeficit(fragmentDeficit, FRAGMENT_BUCKETS, buffer),
    discoursePatterns: Object.fromEntries(DISCOURSE_PATTERNS
      .map(pattern => [pattern, DISCOURSE_PER_PATTERN])),
  };
}

// The HELD contract takes precedence over an independent label split: every held skeleton needs
// exactly five ACCEPTED surfaces in the final corpus, so its shortage is mandatory first.
function deriveHeldAllocation(seed, artifacts, plan) {
  const held = artifacts.effectiveCatalog.candidates
    .filter(row => row.splitAssignment === 'FINAL_HELD_OUT');
  const mandatory = held.map(row => ({
    semanticSkeletonId: row.semanticSkeletonId,
    humanLabel: row.humanLabel,
    currentAccepted: seed.coverage.get(row.semanticSkeletonId) || 0,
    needTo5: Math.max(0,
      FINAL_CORPUS.heldSurfacesPerSkeleton - (seed.coverage.get(row.semanticSkeletonId) || 0)),
  }));
  const mandatoryTotal = mandatory.reduce((total, row) => total + row.needTo5, 0);
  const mandatoryLabel = Object.fromEntries(LABELS.map(label => [label, mandatory
    .filter(row => row.humanLabel === label)
    .reduce((total, row) => total + row.needTo5, 0)]));

  const bufferTotal = plan.split.FINAL_HELD_OUT - mandatoryTotal;
  if (bufferTotal < 0) fail('HELD tranche is smaller than its mandatory shortage');
  const bufferByLabel = Object.fromEntries(LABELS.map((label, index) =>
    [label, largestRemainder(LABELS.map(key => mandatoryLabel[key]), bufferTotal)[index]]));

  // Buffer skeletons: larger mandatory needTo5 first, then lexical skeleton ID.
  const planned = new Map(mandatory.map(row => [row.semanticSkeletonId, row.needTo5]));
  const bufferAssignments = [];
  for (const label of LABELS) {
    const ranked = mandatory.filter(row => row.humanLabel === label)
      .sort((left, right) => right.needTo5 - left.needTo5
        || (left.semanticSkeletonId < right.semanticSkeletonId ? -1 : 1));
    for (let index = 0; index < bufferByLabel[label]; index += 1) {
      const target = ranked[index % ranked.length];
      planned.set(target.semanticSkeletonId, planned.get(target.semanticSkeletonId) + 1);
      bufferAssignments.push({ semanticSkeletonId: target.semanticSkeletonId, humanLabel: label });
    }
  }

  const trancheLabel = Object.fromEntries(LABELS
    .map(label => [label, mandatoryLabel[label] + bufferByLabel[label]]));
  if (trancheLabel.CLEAR + trancheLabel.ESCALATE !== plan.split.FINAL_HELD_OUT) {
    fail('HELD label allocation does not total the HELD tranche');
  }
  return {
    mandatory, mandatoryTotal, mandatoryLabel,
    bufferTotal, bufferByLabel, bufferAssignments,
    trancheLabel, planned,
  };
}

function deriveTrainDevCells(plan, heldAllocation) {
  const remaining = Object.fromEntries(LABELS
    .map(label => [label, plan.label[label] - heldAllocation.trancheLabel[label]]));
  const splits = ['TRAIN', 'DEV'];
  const weights = splits.map(split => plan.split[split]);
  const cells = {};
  for (const label of LABELS) {
    const allocated = largestRemainder(weights, remaining[label]);
    splits.forEach((split, index) => {
      cells[split] ??= {};
      cells[split][label] = allocated[index];
    });
  }
  for (const split of splits) {
    const total = LABELS.reduce((sum, label) => sum + cells[split][label], 0);
    if (total !== plan.split[split]) fail(`${split} cells do not total its tranche size`);
  }
  return { remaining, cells };
}

// Zero-covered compatible skeletons are seeded first; afterwards each assignment goes to the
// skeleton with the lowest prospective accepted coverage.
function deriveSkeletonAssignments(seed, artifacts, plan, heldAllocation, trainDev) {
  const planned = new Map();
  for (const [skeletonId, count] of heldAllocation.planned) planned.set(skeletonId, count);

  for (const split of ['TRAIN', 'DEV']) {
    for (const label of LABELS) {
      const compatible = artifacts.effectiveCatalog.candidates
        .filter(row => row.splitAssignment === split && row.humanLabel === label)
        .sort((left, right) =>
          left.semanticSkeletonId < right.semanticSkeletonId ? -1 : 1);
      if (!compatible.length) fail(`no compatible skeleton for ${split}/${label}`);
      let remaining = trainDev.cells[split][label];

      for (const row of compatible) {
        if (remaining <= 0) break;
        if ((seed.coverage.get(row.semanticSkeletonId) || 0) === 0
          && !planned.has(row.semanticSkeletonId)) {
          planned.set(row.semanticSkeletonId, 1);
          remaining -= 1;
        }
      }
      while (remaining > 0) {
        const target = compatible.map(row => ({
          row,
          current: seed.coverage.get(row.semanticSkeletonId) || 0,
          planned: planned.get(row.semanticSkeletonId) || 0,
        })).sort((left, right) => (left.current + left.planned) - (right.current + right.planned)
          || left.planned - right.planned
          || (left.row.semanticSkeletonId < right.row.semanticSkeletonId ? -1 : 1))[0];
        planned.set(target.row.semanticSkeletonId, target.planned + 1);
        remaining -= 1;
      }
    }
  }

  const total = [...planned.values()].reduce((left, right) => left + right, 0);
  if (total !== plan.trancheSize) fail('skeleton assignments do not total the tranche size');
  for (const skeletonId of seed.zeroCoveredSkeletonIds) {
    if (!planned.get(skeletonId)) {
      fail(`a zero-covered skeleton received no batch-003 candidate: ${skeletonId}`);
    }
  }
  return planned;
}

// Structural validation reuses the frozen shared validator unchanged, with the
// effective-current catalog supplied at the batch-003 boundary. The shared library keeps
// pointing at historical Exact56 for every historical caller.
function validateBatch003(batch, bundle) {
  const { artifacts, seed, plan, skeletonAssignments } = bundle;
  if (batch?.name !== BATCH_003_IDENTITY || batch.batchId !== BATCH_003_ID) {
    fail('batch-003 identity or batchId is not canonical');
  }
  validateSurfaceBatch(batch, { exact56: artifacts.effectiveCatalog });

  if (batch.items.length !== plan.trancheSize
    || batch.sourceEpisodes.length !== plan.trancheSize) {
    fail(`batch-003 must hold exactly ${plan.trancheSize} items and source episodes`);
  }

  const episodes = new Map(batch.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  const skeletons = new Map(artifacts.effectiveCatalog.candidates
    .map(row => [row.semanticSkeletonId, row]));
  const itemIds = new Set();
  const episodeIds = new Set();
  const sourceFamilies = new Set();
  const surfaceFamilies = new Set();
  const perSkeleton = new Map();
  const seenEpisodes = new Set();

  batch.items.forEach((item, index) => {
    const expectedItemId = `p1b6-item-b003-${String(index + 1).padStart(3, '0')}`;
    if (item.itemId !== expectedItemId) {
      fail(`batch-003 item IDs must be sequential: ${item.itemId}`);
    }
    if (itemIds.has(item.itemId)) fail(`duplicate itemId: ${item.itemId}`);
    itemIds.add(item.itemId);
    if (!/^p1b6-se-b003-\d{3}$/u.test(item.sourceEpisodeId)) {
      fail(`source episode ID is not batch-003 scoped: ${item.sourceEpisodeId}`);
    }
    if (seenEpisodes.has(item.sourceEpisodeId)) {
      fail(`batch-003 uses one candidate per episode: ${item.sourceEpisodeId}`);
    }
    seenEpisodes.add(item.sourceEpisodeId);
    if (!/^p1b6-sf-b003-/u.test(episodes.get(item.sourceEpisodeId).sourceFamilyId)
      || !/^p1b6-surface-family-b003-/u.test(item.surfaceFamilyId)) {
      fail(`family IDs are not batch-003 scoped: ${item.itemId}`);
    }
    sourceFamilies.add(episodes.get(item.sourceEpisodeId).sourceFamilyId);
    surfaceFamilies.add(item.surfaceFamilyId);

    const skeleton = skeletons.get(item.semanticSkeletonId);
    if (!skeleton) fail(`unknown effective-current skeleton: ${item.itemId}`);
    if (episodes.get(item.sourceEpisodeId).splitAssignment !== skeleton.splitAssignment) {
      fail(`episode/skeleton split mismatch: ${item.itemId}`);
    }
    perSkeleton.set(item.semanticSkeletonId,
      (perSkeleton.get(item.semanticSkeletonId) || 0) + 1);
  });
  for (const episode of batch.sourceEpisodes) {
    if (!/^p1b6-se-b003-\d{3}$/u.test(episode.sourceEpisodeId)
      || episodeIds.has(episode.sourceEpisodeId)) {
      fail(`duplicate or non-batch-003 episode: ${episode.sourceEpisodeId}`);
    }
    episodeIds.add(episode.sourceEpisodeId);
  }
  if (sourceFamilies.size !== plan.trancheSize || surfaceFamilies.size !== plan.trancheSize) {
    fail('batch-003 family IDs are not unique per candidate');
  }

  // Marginals. The authoring target label is DERIVED from the effective-current skeleton, never
  // stored on the item and never taken from historical Exact56.
  const marginal = {
    split: tally(batch.items.map(row => skeletons.get(row.semanticSkeletonId).splitAssignment),
      SPLITS),
    label: tally(batch.items.map(row => skeletons.get(row.semanticSkeletonId).humanLabel), LABELS),
    language: tally(batch.items.map(row => episodes.get(row.sourceEpisodeId).language), LANGUAGES),
    fragments: tally(batch.items.map(row =>
      computeFragments(row, episodes.get(row.sourceEpisodeId)).length), FRAGMENT_BUCKETS),
    discoursePatterns: tally(batch.items.map(row => row.discoursePattern), DISCOURSE_PATTERNS),
  };
  for (const key of ['split', 'label', 'language', 'fragments', 'discoursePatterns']) {
    if (JSON.stringify(marginal[key]) !== JSON.stringify(plan[key])) {
      fail(`batch-003 ${key} marginal does not match the derived plan`);
    }
  }

  const planned = Object.fromEntries([...skeletonAssignments.entries()].sort());
  const actual = Object.fromEntries([...perSkeleton.entries()].sort());
  if (JSON.stringify(planned) !== JSON.stringify(actual)) {
    fail('batch-003 per-skeleton counts do not match the derived assignment');
  }
  for (const skeletonId of seed.zeroCoveredSkeletonIds) {
    if (!perSkeleton.get(skeletonId)) {
      fail(`the zero-covered skeleton received no batch-003 realization: ${skeletonId}`);
    }
  }
  return batch;
}

function normalizedConversation(turns) {
  return turns.map(turn => `${turn.role}:${turn.text.normalize('NFKC').toLowerCase()
    .replace(/\p{N}+/gu, '#').replace(/[^\p{L}#]+/gu, '')}`).join('|');
}

function normalizedTurn(text) {
  return text.normalize('NFKC').trim();
}

function isNonTrivialTurn(text) {
  return Array.from(normalizedTurn(text)).length >= NON_TRIVIAL_TURN_CHARS;
}

// Prior/pilot material stays part of duplicate detection even where it was rejected or
// superseded. This is an exact-match metric on purpose: obvious essential-dialogue paraphrase
// leakage still needs HUMAN or code review judgment and is NOT silently rejected here.
function loadPriorSources(root = ROOT) {
  const episodes = [];
  for (const file of LEAKAGE_SOURCES) {
    const artifact = JSON.parse(fs.readFileSync(path.join(root, 'fixtures', file), 'utf8'));
    for (const episode of artifact.sourceEpisodes) {
      episodes.push({ origin: file, id: episode.sourceEpisodeId, turns: episode.turns });
    }
  }
  const pilot = JSON.parse(fs.readFileSync(path.join(root, 'fixtures', PILOT_FIXTURE), 'utf8'));
  pilot.cases.forEach((row, index) => {
    episodes.push({ origin: PILOT_FIXTURE, id: `pilot-${index + 1}`, turns: row.turns });
  });
  return episodes;
}

function validateBatch003Leakage(batch, priorEpisodes = loadPriorSources()) {
  const priorConversations = new Map();
  const priorTurns = new Map();
  for (const episode of priorEpisodes) {
    priorConversations.set(normalizedConversation(episode.turns), `${episode.origin}:${episode.id}`);
    for (const turn of episode.turns) {
      if (isNonTrivialTurn(turn.text)) {
        priorTurns.set(normalizedTurn(turn.text), `${episode.origin}:${episode.id}`);
      }
    }
  }

  const seenConversations = new Map();
  const seenTurns = new Map();
  const seenIdentities = new Map();
  const familySplits = new Map();
  const episodeSplits = new Map(batch.sourceEpisodes
    .map(row => [row.sourceEpisodeId, row.splitAssignment]));

  for (const episode of batch.sourceEpisodes) {
    const conversation = normalizedConversation(episode.turns);
    if (priorConversations.has(conversation)) {
      fail(`episode reuses a prior or pilot conversation: ${episode.sourceEpisodeId} vs ${priorConversations.get(conversation)}`);
    }
    if (seenConversations.has(conversation)) {
      fail(`episode duplicates another batch-003 conversation: ${episode.sourceEpisodeId} vs ${seenConversations.get(conversation)}`);
    }
    seenConversations.set(conversation, episode.sourceEpisodeId);

    for (const turn of episode.turns) {
      if (!isNonTrivialTurn(turn.text)) continue;
      const normalized = normalizedTurn(turn.text);
      if (priorTurns.has(normalized)) {
        fail(`non-trivial turn reused from ${priorTurns.get(normalized)}: ${episode.sourceEpisodeId}`);
      }
      if (seenTurns.has(normalized)) {
        fail(`non-trivial turn reused across ${seenTurns.get(normalized)} and ${episode.sourceEpisodeId}`);
      }
      seenTurns.set(normalized, episode.sourceEpisodeId);
    }

    for (const identity of [episode.sourceEpisodeId, episode.sourceFamilyId]) {
      if (seenIdentities.has(identity)) fail(`identity reused in batch-003: ${identity}`);
      seenIdentities.set(identity, episode.sourceEpisodeId);
    }
    const priorSplit = familySplits.get(episode.sourceFamilyId);
    if (priorSplit && priorSplit !== episode.splitAssignment) {
      fail(`sourceFamilyId crosses splits: ${episode.sourceFamilyId}`);
    }
    familySplits.set(episode.sourceFamilyId, episode.splitAssignment);
  }

  const surfaceFamilySplits = new Map();
  for (const item of batch.items) {
    for (const identity of [item.itemId, item.surfaceFamilyId]) {
      if (seenIdentities.has(identity)) fail(`identity reused in batch-003: ${identity}`);
      seenIdentities.set(identity, item.itemId);
    }
    const split = episodeSplits.get(item.sourceEpisodeId);
    const priorSplit = surfaceFamilySplits.get(item.surfaceFamilyId);
    if (priorSplit && priorSplit !== split) {
      fail(`surfaceFamilyId crosses splits: ${item.surfaceFamilyId}`);
    }
    surfaceFamilySplits.set(item.surfaceFamilyId, split);
  }
  return batch;
}

// A HUMAN-facing diagnostic, not a gate. It reports the most reused turn texts below the
// exact-match threshold so a reviewer can eyeball mechanical templating; it never rejects.
function templateReuseDiagnostic(batch, limit = 15) {
  const counts = new Map();
  for (const episode of batch.sourceEpisodes) {
    for (const turn of episode.turns) {
      const normalized = normalizedTurn(turn.text);
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
  }
  const repeated = [...counts.entries()].filter(([, count]) => count > 1)
    .sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : 1));
  return {
    distinctTurns: counts.size,
    repeatedTurnTexts: repeated.length,
    mostRepeated: repeated.slice(0, limit).map(([text, count]) => ({ text, count })),
  };
}

function buildPlan(canonicalInputs) {
  const artifacts = verifyCanonicalInputs(canonicalInputs);
  const seed = reconstructAcceptedSeed(artifacts);
  const plan = deriveTranchePlan(seed);
  const heldAllocation = deriveHeldAllocation(seed, artifacts, plan);
  const trainDev = deriveTrainDevCells(plan, heldAllocation);
  const skeletonAssignments = deriveSkeletonAssignments(seed, artifacts, plan, heldAllocation,
    trainDev);
  return { artifacts, seed, plan, heldAllocation, trainDev, skeletonAssignments };
}

// The protocol is the committed authoring contract for this tranche. It is written ONCE, at
// authoring-plan time, and must not be rewritten later to pretend downstream gates ran; audit
// and review results get their own receipts.
function buildAuthoringProtocol(bundle) {
  const { seed, plan, heldAllocation, trainDev, skeletonAssignments } = bundle;
  const binding = key => ({
    identity: CANONICAL_INPUTS[key].identity,
    rawSha256: CANONICAL_INPUTS[key].rawSha256,
  });
  return {
    name: PROTOCOL_IDENTITY,
    batchId: BATCH_003_ID,
    status: 'AUTHORING_PLAN_FROZEN_SURFACES_NOT_YET_AUTHORED',
    interpretationRule: INTERPRETATION_RULE,
    semanticAuthority: {
      ...binding('effectiveCatalog'),
      role: 'AUTHORING_SEMANTIC_AUTHORITY',
      note: 'All new authoring targets come from this catalog. Historical Exact56 stays immutable provenance and is NOT the authoring target where the two differ.',
    },
    acceptedSeedInputs: {
      batch001: binding('batch001'),
      smokeAcceptance: binding('smokeAcceptance'),
      batch002Successor: binding('batch002Successor'),
      batch002Human: binding('batch002Human'),
      batch002Acceptance: binding('batch002Acceptance'),
    },
    acceptedSeedCoverage: {
      total: seed.total,
      split: seed.split,
      humanLabel: seed.label,
      language: seed.language,
      fragments: seed.fragments,
      coveredSkeletons: seed.coveredSkeletons,
      totalSkeletons: seed.totalSkeletons,
      zeroCoveredSkeletonIds: seed.zeroCoveredSkeletonIds,
    },
    finalCorpusTargets: FINAL_CORPUS,
    tranche: {
      noLossShortage: plan.noLossShortage,
      size: plan.trancheSize,
      buffer: plan.buffer,
      deficits: plan.deficits,
      split: plan.split,
      authoringSemanticLabel: plan.label,
      language: plan.language,
      fragments: plan.fragments,
      discoursePatterns: plan.discoursePatterns,
      note: '304 is an authoring-tranche size, not a corpus-size contract. The exact final corpus remains 380 and the 17 buffer candidates are review/rejection headroom, not automatic final members.',
    },
    heldAllocation: {
      surfacesPerSkeleton: FINAL_CORPUS.heldSurfacesPerSkeleton,
      mandatoryTotal: heldAllocation.mandatoryTotal,
      mandatoryByLabel: heldAllocation.mandatoryLabel,
      bufferTotal: heldAllocation.bufferTotal,
      bufferByLabel: heldAllocation.bufferByLabel,
      trancheByLabel: heldAllocation.trancheLabel,
      perSkeleton: heldAllocation.mandatory.map(row => ({
        semanticSkeletonId: row.semanticSkeletonId,
        humanLabel: row.humanLabel,
        currentAccepted: row.currentAccepted,
        needTo5: row.needTo5,
        batch003Planned: heldAllocation.planned.get(row.semanticSkeletonId),
      })),
      note: 'needTo5 = max(0, 5 - currentAcceptedCountForSkeleton). The extra HELD candidates are buffer only; deterministic FINAL selection later still chooses exactly five accepted surfaces per held skeleton.',
    },
    trainDevCells: trainDev.cells,
    allocationRules: {
      marginalBuffer: 'Positive deficits against the frozen 380 constraints, with the 17-candidate buffer allocated by deterministic largest remainder in canonical key order.',
      heldPrecedence: 'The per-skeleton HELD shortage is mandatory before any HELD buffer assignment; HELD buffer labels use largest remainder over the mandatory label deficits.',
      heldBufferSkeleton: 'Larger mandatory needTo5 first, then lexical semanticSkeletonId.',
      trainDevLabel: 'After reserving the HELD cells, each label is split across TRAIN and DEV by largest remainder proportional to their tranche sizes.',
      skeletonAssignment: 'Any compatible skeleton with zero current accepted coverage receives one candidate first; every remaining assignment goes to the skeleton minimizing currentAcceptedCount + batch003PlannedCount, then batch003PlannedCount, then lexical semanticSkeletonId.',
      zeroCoverageRequirement: 'p1b6-sk-aebbf047d6864a35 must receive at least one entirely new DEV/ESCALATE realization. This is a new candidate with new source text and new IDs, NOT a repair or replacement of historical item p1b6-item-b002-050.',
    },
    plannedSkeletonCounts: Object.fromEntries([...skeletonAssignments.entries()]
      .sort((left, right) => (left[0] < right[0] ? -1 : 1))),
    generatorProvenance: {
      authoringAgent: 'Claude Opus 5 via Claude Code, driven by the repository owner',
      planDerivation: 'DETERMINISTIC_FROM_CANONICAL_ARTIFACTS',
      samplingControls: 'UNAVAILABLE_PLATFORM_CONTROLLED',
      modelSamplingParameters: 'NOT_INDEPENDENTLY_RECOVERABLE',
      note: 'Only genuinely available metadata is recorded. Sampling temperature, seeds and decoding parameters are platform-controlled and are not invented here.',
    },
    gatesNotYetRun: {
      surfacesAuthored: false,
      sourceAuditCompleted: false,
      humanReviewCompleted: false,
      humanGoldFrozen: false,
      acceptancePerformed: false,
      heldRepeatedReviewPerformed: false,
      finalSelectionPerformed: false,
      trainingPerformed: false,
    },
    authority: {
      exact56Altered: false,
      effectiveCurrentCatalogAltered: false,
      interpretationRuleAltered: false,
      batch002Reopened: false,
      historicalItem050Repaired: false,
      oldHumanLabelsTransferred: false,
      finalCorpusSizeContractChanged: false,
      authoringSemanticLabelsAreHumanGold: false,
      note: 'The per-item authoring semantic labels derived from the effective-current catalog are generator targets. They are NOT HUMAN gold and must never enter a blind HUMAN packet.',
    },
    nextGate: 'FRESH_SOURCE_AUDIT_OF_ALL_304_ROWS',
  };
}

function loadCanonicalInputs() {
  return Object.fromEntries(Object.entries(CANONICAL_INPUTS)
    .map(([key, pinned]) => [key, fs.readFileSync(path.join(ROOT, 'fixtures', pinned.fixture))]));
}

function main() {
  const { seed, plan, heldAllocation, trainDev, skeletonAssignments } =
    buildPlan(loadCanonicalInputs());
  const report = {
    seed: {
      total: seed.total, split: seed.split, label: seed.label,
      language: seed.language, fragments: seed.fragments,
      coverage: `${seed.coveredSkeletons}/${seed.totalSkeletons}`,
      zeroCovered: seed.zeroCoveredSkeletonIds,
    },
    tranche: {
      noLossShortage: plan.noLossShortage, size: plan.trancheSize, buffer: plan.buffer,
      split: plan.split, label: plan.label, language: plan.language,
      fragments: plan.fragments, discoursePerPattern: DISCOURSE_PER_PATTERN,
    },
    held: {
      mandatoryTotal: heldAllocation.mandatoryTotal,
      mandatoryLabel: heldAllocation.mandatoryLabel,
      bufferByLabel: heldAllocation.bufferByLabel,
      trancheLabel: heldAllocation.trancheLabel,
    },
    trainDevCells: trainDev.cells,
    skeletonAssignments: Object.fromEntries([...skeletonAssignments.entries()]
      .sort((left, right) => (left[0] < right[0] ? -1 : 1))),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return 0;
}

module.exports = {
  BATCH_003_FILE,
  BATCH_003_ID,
  BATCH_003_IDENTITY,
  CANONICAL_INPUTS,
  DISCOURSE_PATTERNS,
  DISCOURSE_PER_PATTERN,
  EXPECTED_SEED,
  FINAL_CORPUS,
  FRAGMENT_BUCKETS,
  INTERPRETATION_RULE,
  LABELS,
  LANGUAGES,
  PROTOCOL_FILE,
  PROTOCOL_IDENTITY,
  SPLITS,
  TRANCHE_SIZE,
  artifactBytes,
  buildAuthoringProtocol,
  buildPlan,
  deriveHeldAllocation,
  deriveSkeletonAssignments,
  deriveTrainDevCells,
  deriveTranchePlan,
  largestRemainder,
  loadCanonicalInputs,
  main,
  reconstructAcceptedSeed,
  isNonTrivialTurn,
  loadPriorSources,
  normalizedConversation,
  templateReuseDiagnostic,
  validateBatch003,
  validateBatch003Leakage,
};

if (require.main === module) process.exit(main());
