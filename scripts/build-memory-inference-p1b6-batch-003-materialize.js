#!/usr/bin/env node
'use strict';

// Batch-003 surface materialization.
//
// The frozen authoring plan decides HOW MANY candidates each skeleton gets and what the batch
// marginals must be. This module turns the authored episode content into the committed batch
// fixture: it assigns the per-slot authoring spec deterministically, computes every byte offset
// from the authored text, and refuses anything that drifts from the frozen plan.
//
// It authors no semantics of its own, executes no HUMAN decision, invents no source-audit
// disposition, performs no acceptance, and trains nothing.

const fs = require('node:fs');
const path = require('node:path');
const { computeFragments } = require('../lib/memory-inference-p1b6-surfaces');
const plan = require('./build-memory-inference-p1b6-batch-003-authoring-plan');

const ROOT = path.resolve(__dirname, '..');

function fail(message) {
  throw new TypeError(`P1-B6 batch-003 materialization ${message}`);
}

// Deterministic even spread: the k-th slot of a marginal is placed by largest-remainder
// interleaving so the whole batch, not just its tail, carries every value.
function spreadCounts(counts, keys, total) {
  const slots = new Array(total).fill(null);
  const entries = keys.filter(key => counts[key] > 0)
    .map(key => ({ key, remaining: counts[key], step: total / counts[key], next: 0 }));
  for (const entry of entries) entry.next = entry.step / 2;
  for (let index = 0; index < total; index += 1) {
    const candidates = entries.filter(entry => entry.remaining > 0)
      .sort((left, right) => left.next - right.next
        || (left.key < right.key ? -1 : 1));
    if (!candidates.length) fail('spread ran out of marginal budget');
    const chosen = candidates[0];
    slots[index] = chosen.key;
    chosen.remaining -= 1;
    chosen.next += chosen.step;
  }
  return slots;
}

// Slot order is the frozen plan's skeleton order, so the spec is reproducible from the plan
// alone and never depends on authoring order.
function buildSlotSpecs(bundle) {
  const assignments = [...bundle.skeletonAssignments.entries()]
    .sort((left, right) => (left[0] < right[0] ? -1 : 1));
  const slots = [];
  for (const [semanticSkeletonId, count] of assignments) {
    for (let index = 0; index < count; index += 1) slots.push({ semanticSkeletonId });
  }
  if (slots.length !== plan.TRANCHE_SIZE) fail('slot count does not match the tranche size');

  const languages = spreadCounts(bundle.plan.language, plan.LANGUAGES, slots.length);
  const fragments = spreadCounts(bundle.plan.fragments, plan.FRAGMENT_BUCKETS.map(String),
    slots.length);
  const patterns = spreadCounts(bundle.plan.discoursePatterns, plan.DISCOURSE_PATTERNS,
    slots.length);
  slots.forEach((slot, index) => {
    slot.language = languages[index];
    slot.fragments = Number(fragments[index]);
    slot.discoursePattern = patterns[index];
  });
  return slots;
}

function utf8(text) {
  return Buffer.from(text, 'utf8');
}

// Offsets are always computed from the authored text. Nothing is hand-written.
function spanFor(turn, turnId, selector) {
  const haystack = utf8(turn.text);
  if (selector === undefined) {
    return { turnId, startByte: 0, endByte: haystack.length };
  }
  const needle = utf8(selector);
  const startByte = haystack.indexOf(needle);
  if (startByte < 0) fail(`selected text is not present in ${turnId}: ${selector}`);
  if (haystack.indexOf(needle, startByte + 1) !== -1) {
    fail(`selected text is not unique in ${turnId}: ${selector}`);
  }
  return { turnId, startByte, endByte: startByte + needle.length };
}

function materializeEpisode(entry, index) {
  const ordinal = String(index + 1).padStart(3, '0');
  const sourceEpisodeId = `p1b6-se-b003-${ordinal}`;
  const turns = entry.turns.map(([role, text], turnIndex) => ({
    turnId: `t${turnIndex + 1}`, role, text,
  }));
  const evidenceSpanRefs = entry.ev.map(selector => {
    const [turnIndex, text] = Array.isArray(selector) ? selector : [selector, undefined];
    const turn = turns[turnIndex];
    if (!turn) fail(`evidence turn ${turnIndex} is missing in ${sourceEpisodeId}`);
    return spanFor(turn, turn.turnId, text);
  });
  const anchorTurn = turns[entry.anchor[0]];
  if (!anchorTurn) fail(`anchor turn is missing in ${sourceEpisodeId}`);
  return {
    episode: {
      sourceEpisodeId,
      sourceFamilyId: `p1b6-sf-b003-${ordinal}`,
      splitAssignment: entry.split,
      language: entry.lang,
      turns,
    },
    item: {
      itemId: `p1b6-item-b003-${ordinal}`,
      sourceEpisodeId,
      semanticSkeletonId: entry.sk,
      anchorSpanRef: spanFor(anchorTurn, anchorTurn.turnId, entry.anchor[1]),
      evidenceSpanRefs,
      discoursePattern: entry.dp,
      surfaceFamilyId: `p1b6-surface-family-b003-${ordinal}`,
    },
  };
}

function buildBatch003(entries, bundle) {
  if (!Array.isArray(entries) || entries.length !== plan.TRANCHE_SIZE) {
    fail(`authored content must hold exactly ${plan.TRANCHE_SIZE} episodes`);
  }
  const slots = buildSlotSpecs(bundle);
  const skeletons = new Map(bundle.artifacts.effectiveCatalog.candidates
    .map(row => [row.semanticSkeletonId, row]));

  const rows = entries.map((entry, index) => {
    const slot = slots[index];
    if (entry.sk !== slot.semanticSkeletonId) {
      fail(`episode ${index + 1} is authored for the wrong skeleton`);
    }
    if (entry.lang !== slot.language || entry.dp !== slot.discoursePattern) {
      fail(`episode ${index + 1} does not match its assigned language/discourse spec`);
    }
    const split = skeletons.get(entry.sk).splitAssignment;
    const built = materializeEpisode({ ...entry, split }, index);
    const fragments = computeFragments(built.item, built.episode).length;
    if (fragments !== slot.fragments) {
      fail(`episode ${index + 1} yields ${fragments} fragments, spec wants ${slot.fragments}`);
    }
    return built;
  });

  const batch = {
    name: plan.BATCH_003_IDENTITY,
    batchId: plan.BATCH_003_ID,
    sourceEpisodes: rows.map(row => row.episode),
    items: rows.map(row => row.item),
  };
  return plan.validateBatch003(batch, bundle);
}

function loadAuthoredContent() {
  return require('./data/memory-inference-p1b6-batch-003-content');
}

function main() {
  const bundle = plan.buildPlan(plan.loadCanonicalInputs());
  const batch = buildBatch003(loadAuthoredContent(), bundle);
  const outputPath = path.join(ROOT, 'fixtures', plan.BATCH_003_FILE);
  fs.writeFileSync(outputPath, plan.artifactBytes(batch));
  process.stdout.write(`Built P1-B6 batch-003: ${outputPath}\n`);
  return 0;
}

module.exports = {
  buildBatch003,
  buildSlotSpecs,
  loadAuthoredContent,
  main,
  materializeEpisode,
  spreadCounts,
};

if (require.main === module) process.exit(main());
