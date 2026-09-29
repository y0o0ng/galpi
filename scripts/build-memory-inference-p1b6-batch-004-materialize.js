#!/usr/bin/env node
'use strict';

// P1-B6 batch-004 surface materialization.
//
// Turns the authored content into the batch-004 fixture against the preregistered protocol:
// every slot must match its skeleton, language, discourse pattern and fragment count; offsets
// and IDs are computed mechanically; TARGET-boundary slots must declare an allowed anchor role;
// the shared structural validator and the batch-003 leakage check run fail-closed against every
// prior batch and candidate. It runs no gate, accepts nothing and trains nothing.

const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { computeFragments, validateSurfaceBatch } = require('../lib/memory-inference-p1b6-surfaces');
const plan003 = require('./build-memory-inference-p1b6-batch-003-authoring-plan');
const { checkTargetBoundaryRealization } = require('./build-memory-inference-p1b6-batch-003-target-boundary-resolution');

const ROOT = path.resolve(__dirname, '..');
const BATCH_IDENTITY = 'xion-local-memory-inference-p1b6-surface-batch-004-v1';
const BATCH_ID = 'p1b6-surface-batch-004';
const BATCH_FILE = 'local-memory-inference-p1b6-surface-batch-004.json';
const RECEIPT_FILE = 'local-memory-inference-p1b6-surface-batch-004-materialization-receipt.json';

const SOURCES = Object.freeze({
  protocol: ['xion-local-memory-inference-p1b6-surface-batch-004-authoring-protocol-v1', 'b6295fed0cb38ca7bebca3d41d91deed80f55d0505b71287e0d425368b413a9c', 'local-memory-inference-p1b6-surface-batch-004-authoring-protocol.json'],
  v3: ['xion-local-memory-inference-p1b6-skeleton-effective-current-v3', '89a48264d6b09710f976a4ab85235ff161cf81ff44896e37553d5dc7753c65b9', 'local-memory-inference-p1b6-skeleton-effective-current-v3.json'],
  batch003: ['xion-local-memory-inference-p1b6-surface-batch-003-v1', '90b453c3680bccaa537fd0d23db74bbc303882e1a35a2ddcea0b75b013fcaa68', 'local-memory-inference-p1b6-surface-batch-003.json'],
  repairCandidate: ['xion-local-memory-inference-p1b6-surface-repair-candidate-batch-003-v1', '8f6254946eef8d8d0920485bde431ca137a83577a5060889f3676b8857b4aa9b', 'local-memory-inference-p1b6-surface-repair-candidate-batch-003.json'],
  anchorCandidate: ['xion-local-memory-inference-p1b6-surface-anchor-repair-candidate-batch-003-v1', '19eea01def0a05c32c1ceb236fa97305e7b29822c9e56b70cc0331f3a873599f', 'local-memory-inference-p1b6-surface-anchor-repair-candidate-batch-003.json'],
  tb1Candidate: ['xion-local-memory-inference-p1b6-surface-target-boundary-candidate-v1', '5a4253506a9a9885118781c68cdcc407d91b6497b4b1af2105a675332ef8a7f5', 'local-memory-inference-p1b6-surface-target-boundary-candidate.json'],
  rp1Candidate: ['xion-local-memory-inference-p1b6-surface-v3-replacement-candidate-v1', '8c3ff152cfb42abfe4a327e4ba84b833904946c7400332ab5e560980a9af47cc', 'local-memory-inference-p1b6-surface-v3-replacement-candidate.json'],
});

function fail(message) {
  throw new TypeError(`P1-B6 batch-004 materialization ${message}`);
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

function spanFor(turn, selector) {
  const haystack = Buffer.from(turn.text, 'utf8');
  if (selector === undefined) return { turnId: turn.turnId, startByte: 0, endByte: haystack.length };
  const needle = Buffer.from(selector, 'utf8');
  const startByte = haystack.indexOf(needle);
  if (startByte < 0 || haystack.indexOf(needle, startByte + 1) >= 0) fail(`text is missing or not unique in ${turn.turnId}: ${selector}`);
  return { turnId: turn.turnId, startByte, endByte: startByte + needle.length };
}

function materialize(entry, slot, split) {
  const ordinal = slot.slot;
  const turns = entry.turns.map(([role, text], index) => ({ turnId: `t${index + 1}`, role, text }));
  const turnAt = index => turns[index] ?? fail(`turn ${index} is missing in slot ${ordinal}`);
  const episode = {
    sourceEpisodeId: `p1b6-se-b004-${ordinal}`,
    sourceFamilyId: `p1b6-sf-b004-${ordinal}`,
    splitAssignment: split,
    language: entry.lang,
    turns,
  };
  const item = {
    itemId: `p1b6-item-b004-${ordinal}`,
    sourceEpisodeId: episode.sourceEpisodeId,
    semanticSkeletonId: entry.sk,
    anchorSpanRef: spanFor(turnAt(entry.anchor[0]), entry.anchor[1]),
    evidenceSpanRefs: entry.ev.map(index => spanFor(turnAt(index))),
    discoursePattern: entry.dp,
    surfaceFamilyId: `p1b6-surface-family-b004-${ordinal}`,
  };
  return { episode, item };
}

function buildBatch004(entries, artifacts) {
  const { protocol, v3 } = artifacts;
  if (!Array.isArray(entries) || entries.length !== protocol.slots.length) {
    fail(`authored content must hold exactly ${protocol.slots.length} episodes`);
  }
  const skeletons = new Map(v3.candidates.map(row => [row.semanticSkeletonId, row]));
  const roles = [];
  const rows = entries.map((entry, index) => {
    const slot = protocol.slots[index];
    if (entry.sk !== slot.semanticSkeletonId || entry.lang !== slot.language || entry.dp !== slot.discoursePattern) {
      fail(`slot ${slot.slot} does not match its skeleton / language / discourse spec`);
    }
    const built = materialize(entry, slot, skeletons.get(entry.sk).splitAssignment);
    const fragments = computeFragments(built.item, built.episode).length;
    if (fragments !== slot.fragments) fail(`slot ${slot.slot} yields ${fragments} fragments, spec wants ${slot.fragments}`);
    if (slot.targetBoundaryInvariant) {
      checkTargetBoundaryRealization({ ...built.item, targetAnchorRole: entry.role });
      roles.push({ itemId: built.item.itemId, semanticSkeletonId: entry.sk, targetAnchorRole: entry.role });
    } else if (Object.hasOwn(entry, 'role')) {
      fail(`slot ${slot.slot} declares a role outside the TARGET-boundary skeletons`);
    }
    return built;
  });
  const batch = {
    name: BATCH_IDENTITY,
    batchId: BATCH_ID,
    sourceEpisodes: rows.map(row => row.episode),
    items: rows.map(row => row.item),
  };
  validateSurfaceBatch(batch, { exact56: v3 });
  plan003.validateBatch003Leakage(batch, [
    ...plan003.loadPriorSources(),
    ...['batch003', 'repairCandidate', 'anchorCandidate', 'tb1Candidate', 'rp1Candidate']
      .flatMap(key => artifacts[key].sourceEpisodes
        .map(episode => ({ origin: artifacts[key].name, id: episode.sourceEpisodeId, turns: episode.turns }))),
  ]);
  return { batch, roles };
}

function buildReceipt(batch, roles, artifacts) {
  const tally = values => values.reduce((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
  const episodes = new Map(batch.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  const observed = {
    split: tally(batch.sourceEpisodes.map(row => row.splitAssignment)),
    language: tally(batch.sourceEpisodes.map(row => row.language)),
    fragments: tally(batch.items.map(item => String(computeFragments(item, episodes.get(item.sourceEpisodeId)).length))),
    discoursePatterns: tally(batch.items.map(item => item.discoursePattern)),
  };
  const { tranche } = artifacts.protocol;
  const expected = {
    split: Object.fromEntries(Object.entries(tranche.split).filter(([, value]) => value > 0)),
    language: tranche.language,
    fragments: tranche.fragments,
    discoursePatterns: tranche.discoursePatterns,
  };
  for (const key of Object.keys(expected)) {
    const sorted = counts => JSON.stringify(Object.entries(counts).sort());
    if (sorted(observed[key]) !== sorted(expected[key])) fail(`${key} marginal does not match the protocol`);
  }
  return {
    name: 'xion-local-memory-inference-p1b6-surface-batch-004-materialization-receipt-v1',
    status: 'MATERIALIZED_AWAITING_OWNER_PRE_AUDIT_REVIEW',
    batch: { identity: BATCH_IDENTITY, rawSha256: sha256RawBytes(artifactBytes(batch)), items: batch.items.length },
    protocol: { identity: SOURCES.protocol[0], rawSha256: SOURCES.protocol[1] },
    marginals: observed,
    targetBoundaryRoles: roles,
    checks: [
      'every slot matches its preregistered skeleton, language, discourse pattern and fragment count',
      'offsets and IDs are computed from the authored text',
      'TARGET-boundary slots declare an allowed targetAnchorRole (declared role only; semantics are for the gates)',
      'shared structural validator against the v3 catalog',
      'batch-003 leakage check against every prior batch and candidate artifact',
    ],
    authority: {
      ownerPreAuditReviewPerformed: false,
      sourceAuditRun: false,
      semanticReviewRun: false,
      humanReviewRun: false,
      acceptancePerformed: false,
      trainingOrEvaluationOccurred: false,
    },
  };
}

const artifactBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');

function loadAuthoredContent() {
  return require('./data/memory-inference-p1b6-batch-004-content');
}

function buildAll(rawSources = loadSources(), entries = loadAuthoredContent()) {
  const artifacts = verifySources(rawSources);
  const { batch, roles } = buildBatch004(entries, artifacts);
  return { batch, receipt: buildReceipt(batch, roles, artifacts) };
}

function main() {
  const { batch, receipt } = buildAll();
  for (const [file, value] of [[BATCH_FILE, batch], [RECEIPT_FILE, receipt]]) {
    fs.writeFileSync(path.join(ROOT, 'fixtures', file), artifactBytes(value));
    process.stdout.write(`Wrote fixtures/${file}\n`);
  }
  return 0;
}

module.exports = {
  BATCH_FILE,
  BATCH_IDENTITY,
  RECEIPT_FILE,
  SOURCES,
  artifactBytes,
  buildAll,
  buildBatch004,
  loadAuthoredContent,
  loadSources,
  main,
  verifySources,
};

if (require.main === module) process.exit(main());
