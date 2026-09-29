#!/usr/bin/env node
'use strict';

// P1-B6 batch-004 top-up authoring plan, derived mechanically from the committed reviewed-pool
// ledger and shortage receipt. Owner-approved parameters: an 85% review-survival assumption per
// split, extra slots spread by largest remainder over the frozen 380 targets, batch-003's
// lowest-prospective-coverage skeleton rule, and a 20% deterministic HUMAN calibration sample.
//
// It writes the preregistered authoring protocol only. It authors no surface, runs no gate,
// accepts nothing and trains nothing.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const plan003 = require('./build-memory-inference-p1b6-batch-003-authoring-plan');

const ROOT = path.resolve(__dirname, '..');
const PROTOCOL_IDENTITY = 'xion-local-memory-inference-p1b6-surface-batch-004-authoring-protocol-v1';
const PROTOCOL_FILE = 'local-memory-inference-p1b6-surface-batch-004-authoring-protocol.json';
const SURVIVAL_ASSUMPTION = 0.85;
const CALIBRATION_FRACTION = 0.2;
const CALIBRATION_HASH_DOMAIN = 'p1b6-b004-v3-review-calibration-v1';
// A stride coprime with the tranche size spreads language / fragment / discourse across slots.
const SPREAD_STRIDE = 17;
const EXPECTED_TRANCHE = 41;
// Owner cap: no skeleton takes more than four slots, spreading review-loss risk.
const PER_SKELETON_CAP = 4;

const SOURCES = Object.freeze({
  ledger: ['xion-local-memory-inference-p1b6-reviewed-pool-ledger-v1', '0c1e293c01e12aafa9863d8b15a25e4ce803f1f21de7035a952c3fb7b2c3742c', 'local-memory-inference-p1b6-reviewed-pool-ledger.json'],
  shortage: ['xion-local-memory-inference-p1b6-shortage-receipt-v1', '44d7d92d8e8d271b4b86d58fc5cf157d4f61654ae169976ee4c7548c0e84c048', 'local-memory-inference-p1b6-shortage-receipt.json'],
  v3: ['xion-local-memory-inference-p1b6-skeleton-effective-current-v3', '89a48264d6b09710f976a4ab85235ff161cf81ff44896e37553d5dc7753c65b9', 'local-memory-inference-p1b6-skeleton-effective-current-v3.json'],
});
const TARGET_BOUNDARY_SKELETONS = Object.freeze(['p1b6-sk-2da4e54e6609e34b', 'p1b6-sk-5269c91fcfb6c2cd']);

function fail(message) {
  throw new TypeError(`P1-B6 batch-004 authoring plan ${message}`);
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

// Deficits first, then the remaining slots by largest remainder over the frozen targets.
function allocateMarginal(cells, keys, targets, total) {
  const deficits = keys.map(key => cells[key].deficit);
  const extra = total - deficits.reduce((sum, value) => sum + value, 0);
  if (extra < 0) fail('tranche is smaller than a marginal deficit');
  const spread = plan003.largestRemainder(keys.map(key => targets[key]), extra);
  return Object.fromEntries(keys.map((key, index) => [String(key), deficits[index] + spread[index]]));
}

function deriveSplitTranche(shortage) {
  const split = Object.fromEntries(plan003.SPLITS.map(key => [key,
    Math.ceil(shortage.pool.split[key].deficit / SURVIVAL_ASSUMPTION)]));
  if (shortage.heldPerSkeletonNeed !== 0 || split.FINAL_HELD_OUT !== 0) fail('HELD top-up is not zero');
  return split;
}

function assignSkeletons(split, ledger, v3) {
  const pool = ledger.rows.filter(row => row.inPool);
  const coverage = id => pool.filter(row => row.semanticSkeletonId === id).length;
  const slots = [];
  for (const splitKey of plan003.SPLITS) {
    const candidates = v3.candidates.filter(row => row.splitAssignment === splitKey)
      .map(row => ({ id: row.semanticSkeletonId, label: row.humanLabel, current: coverage(row.semanticSkeletonId), planned: 0 }));
    for (let index = 0; index < split[splitKey]; index += 1) {
      const target = candidates.filter(row => row.planned < PER_SKELETON_CAP)
        .toSorted((left, right) => (left.current + left.planned) - (right.current + right.planned)
          || (left.id < right.id ? -1 : 1))[0];
      if (!target) fail(`${splitKey} cannot place its slots under the per-skeleton cap`);
      target.planned += 1;
      slots.push({ splitAssignment: splitKey, semanticSkeletonId: target.id, authoringTargetLabel: target.label });
    }
  }
  return slots;
}

function spread(values, count) {
  if (values.length !== count) fail('spread length mismatch');
  return Array.from({ length: count }, (_, index) => values[(index * SPREAD_STRIDE) % count]);
}

function buildProtocol(artifacts) {
  const { ledger, shortage, v3 } = artifacts;
  if (shortage.ledger.identity !== ledger.name) fail('shortage receipt does not name the ledger');
  const split = deriveSplitTranche(shortage);
  const total = Object.values(split).reduce((sum, value) => sum + value, 0);
  if (total !== EXPECTED_TRANCHE) fail(`tranche is ${total}, not ${EXPECTED_TRANCHE}`);
  const target = plan003.FINAL_CORPUS;
  const language = allocateMarginal(shortage.pool.language, plan003.LANGUAGES, target.language, total);
  const fragments = allocateMarginal(shortage.pool.fragments, plan003.FRAGMENT_BUCKETS, target.fragments, total);
  const discourse = Object.fromEntries(plan003.DISCOURSE_PATTERNS.map((pattern, index) =>
    [pattern, Math.floor(total / plan003.DISCOURSE_PATTERNS.length)
      + (index < total % plan003.DISCOURSE_PATTERNS.length ? 1 : 0)]));

  const expand = counts => Object.entries(counts).flatMap(([key, count]) => Array(count).fill(key));
  const skeletonSlots = assignSkeletons(split, ledger, v3);
  const languages = spread(expand(language), total);
  const fragmentCounts = spread(expand(fragments), total);
  const patterns = spread(expand(discourse), total);
  const slots = skeletonSlots.map((slot, index) => ({
    slot: String(index + 1).padStart(3, '0'),
    ...slot,
    language: languages[index],
    fragments: Number(fragmentCounts[index]),
    discoursePattern: patterns[index],
    targetBoundaryInvariant: TARGET_BOUNDARY_SKELETONS.includes(slot.semanticSkeletonId),
  }));

  return {
    name: PROTOCOL_IDENTITY,
    status: 'PREREGISTERED_NOT_AUTHORED',
    decisionsSource: 'REPOSITORY_OWNER_APPROVED_TOP_UP_PARAMETERS',
    inputs: Object.fromEntries(Object.entries(SOURCES).map(([key, [identity, rawSha256]]) => [key, { identity, rawSha256 }])),
    derivation: {
      survivalAssumption: SURVIVAL_ASSUMPTION,
      splitRule: 'ceil(split deficit / survival assumption); HELD is zero because every HELD skeleton already has >= 5 pooled surfaces',
      marginalRule: 'deficit first, remaining slots by largest remainder over the frozen 380 targets in canonical key order',
      skeletonRule: `within each split, the skeleton with the lowest pooled coverage plus planned slots, ties by skeleton ID (the batch-003 rule), capped at ${PER_SKELETON_CAP} slots per skeleton`,
      spreadRule: `language, fragment and discourse values are laid out by index * ${SPREAD_STRIDE} mod tranche size`,
      labelRule: 'authoring target label follows the v3 skeleton; label balance is not a target',
    },
    tranche: {
      total,
      lowerBound: shortage.minimumTopUpLowerBound,
      buffer: total - shortage.minimumTopUpLowerBound,
      split,
      language,
      fragments,
      discoursePatterns: discourse,
    },
    slots,
    authoringRules: [
      'Fresh content under the b004 namespace; no reuse of any prior text, ID or review result.',
      'The batch-003 leakage check runs fail-closed against every prior batch and candidate artifact.',
      'Slots on 2da4e54e / 5269c91f must satisfy the TARGET-boundary realization invariant (declared targetAnchorRole).',
      'Authoring target labels are generator targets, not HUMAN gold, and never enter a blind packet.',
      'The owner reviews the authored text before the source audit.',
    ],
    gates: {
      order: ['owner pre-audit authoring review', 'fresh source/bundle audit (FAIL / UNCERTAIN excluded)',
        'blind v3 strong-model semantic review', 'mandatory HUMAN for disagreement / FIX / REJECT / missing',
        'HUMAN calibration sample of clean agreements'],
      calibration: {
        fraction: CALIBRATION_FRACTION,
        size: Math.round(total * CALIBRATION_FRACTION),
        rule: 'the clean agreements with the lowest sha256 of the hash domain, a NUL separator and the itemId; all of them if fewer exist',
        hashDomain: CALIBRATION_HASH_DOMAIN,
        matchingKeepSemantics: 'stays CATALOG_STRONG_MODEL_CONFIRMED / PROVISIONAL; not promoted',
      },
      mandatoryMatchingKeepSemantics: 'HUMAN_ADJUDICATED / ELIGIBLE',
    },
    authority: {
      surfacesAuthored: false,
      sourceAuditRun: false,
      semanticReviewRun: false,
      humanReviewRun: false,
      acceptancePerformed: false,
      finalSelectionPerformed: false,
      trainingOrEvaluationOccurred: false,
    },
  };
}

function calibrationHash(itemId) {
  return crypto.createHash('sha256').update(`${CALIBRATION_HASH_DOMAIN}\0${itemId}`).digest('hex');
}

const artifactBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');

function main() {
  const protocol = buildProtocol(verifySources(loadSources()));
  fs.writeFileSync(path.join(ROOT, 'fixtures', PROTOCOL_FILE), artifactBytes(protocol));
  process.stdout.write(`Wrote fixtures/${PROTOCOL_FILE}\n`);
  return 0;
}

module.exports = {
  CALIBRATION_HASH_DOMAIN,
  EXPECTED_TRANCHE,
  PER_SKELETON_CAP,
  PROTOCOL_FILE,
  SOURCES,
  TARGET_BOUNDARY_SKELETONS,
  artifactBytes,
  buildProtocol,
  calibrationHash,
  loadSources,
  main,
  verifySources,
};

if (require.main === module) process.exit(main());
