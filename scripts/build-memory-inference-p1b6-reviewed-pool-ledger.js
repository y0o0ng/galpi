#!/usr/bin/env node
'use strict';

// P1-B6 reviewed-pool ledger and shortage receipt.
//
// The ledger derives every row's current status mechanically by applying the committed review
// layers in order; nothing is typed in by hand. The owner's pool rule (option A):
//   in pool: accepted HUMAN gold (batch-001/002) on active skeletons, HUMAN_ADJUDICATED rows,
//            CATALOG_STRONG_MODEL_CONFIRMED / PROVISIONAL rows, the two repaired rows whose HUMAN
//            review matched v3, and the four rows whose label an owner resolution fixed;
//   out:     ineligible, rejected, audit-failed, retired-skeleton surfaces, and accepted
//            surfaces on retired skeletons (flagged, not rewritten).
// Accepted rows whose immutable HUMAN gold differs from the current v3 label stay in the pool
// with their HUMAN label and a flag for the separate migration decision.
//
// The shortage receipt measures marginal deficits against the frozen 380 constraints (label
// balance is abolished). It is a lower bound, not a joint-feasibility proof. Nothing is
// authored, accepted, frozen, selected or trained here.

const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { computeFragments } = require('../lib/memory-inference-p1b6-surfaces');
const plan = require('./build-memory-inference-p1b6-batch-003-authoring-plan');

const ROOT = path.resolve(__dirname, '..');
const LEDGER_IDENTITY = 'xion-local-memory-inference-p1b6-reviewed-pool-ledger-v1';
const LEDGER_FILE = 'local-memory-inference-p1b6-reviewed-pool-ledger.json';
const SHORTAGE_IDENTITY = 'xion-local-memory-inference-p1b6-shortage-receipt-v1';
const SHORTAGE_FILE = 'local-memory-inference-p1b6-shortage-receipt.json';

const SOURCES = Object.freeze({
  v3: ['xion-local-memory-inference-p1b6-skeleton-effective-current-v3', '89a48264d6b09710f976a4ab85235ff161cf81ff44896e37553d5dc7753c65b9', 'local-memory-inference-p1b6-skeleton-effective-current-v3.json'],
  batch: ['xion-local-memory-inference-p1b6-surface-batch-003-v1', '90b453c3680bccaa537fd0d23db74bbc303882e1a35a2ddcea0b75b013fcaa68', 'local-memory-inference-p1b6-surface-batch-003.json'],
  sourceAudit: ['xion-local-memory-inference-p1b6-source-audit-batch-003-attempt-001-receipt-v1', '3c840476bea6eccb522800248a3ace277b26a5334ec56b5f6b10bbf4d5821221', 'local-memory-inference-p1b6-source-audit-batch-003-attempt-001.json'],
  strongModel: ['xion-local-memory-inference-p1b6-strong-model-semantic-review-batch-003-attempt-001-receipt-v1', '9b65327a4ce6d1923391253659c1acc3bb373bb54acdc7872e3ce74d52337074', 'local-memory-inference-p1b6-strong-model-semantic-review-batch-003-attempt-001.json'],
  human: ['xion-local-memory-inference-p1b6-batch-003-human-adjudication-calibration-attempt-001-receipt-v1', '0adbba1789bb91025f277701c51cbf82139092f147966053277573c3f0dbbe6a', 'local-memory-inference-p1b6-batch-003-human-adjudication-calibration-attempt-001.json'],
  resolution: ['xion-local-memory-inference-p1b6-batch-003-resolution-receipt-v1', '61c29218a360bf914c6453758c7fc243e629f1b5d400e38426d9d18720cb1ffe', 'local-memory-inference-p1b6-batch-003-resolution-receipt.json'],
  targetedStrongModel: ['xion-local-memory-inference-p1b6-targeted-v3-strong-model-review-batch-003-attempt-001-receipt-v1', '8db917801426d77f3d024bb843592208f008f490ca49f6a8499306d157f4d283', 'local-memory-inference-p1b6-targeted-v3-strong-model-review-batch-003-attempt-001.json'],
  targetedHuman: ['xion-local-memory-inference-p1b6-batch-003-targeted-v3-human-review-attempt-001-receipt-v1', 'a70efc875376894460740d74b35de78a3206bffa544d31c7a955d758d83e97e6', 'local-memory-inference-p1b6-batch-003-targeted-v3-human-review-attempt-001.json'],
  targetBoundary: ['xion-local-memory-inference-p1b6-batch-003-target-boundary-resolution-receipt-v1', '614ba543e99b765eafe82f5ebaa59dd0f015c5e0d53f5342ad93b28122c91254', 'local-memory-inference-p1b6-batch-003-target-boundary-resolution-receipt.json'],
  repairCandidate: ['xion-local-memory-inference-p1b6-surface-repair-candidate-batch-003-v1', '8f6254946eef8d8d0920485bde431ca137a83577a5060889f3676b8857b4aa9b', 'local-memory-inference-p1b6-surface-repair-candidate-batch-003.json'],
  repairHuman: ['xion-local-memory-inference-p1b6-batch-003-repair-human-review-attempt-001-receipt-v1', 'd3507563fcbad057d734b1d0b5d9a684e39f6cfa29f54bcd33e8d8bb3a6c6f66', 'local-memory-inference-p1b6-batch-003-repair-human-review-attempt-001.json'],
  anchorCandidate: ['xion-local-memory-inference-p1b6-surface-anchor-repair-candidate-batch-003-v1', '19eea01def0a05c32c1ceb236fa97305e7b29822c9e56b70cc0331f3a873599f', 'local-memory-inference-p1b6-surface-anchor-repair-candidate-batch-003.json'],
  anchorHuman: ['xion-local-memory-inference-p1b6-batch-003-anchor-repair-human-review-attempt-001-receipt-v1', 'bc390931fd7f813169ad4755ff88a9549baee1a8543b0309e339e90c9711574d', 'local-memory-inference-p1b6-batch-003-anchor-repair-human-review-attempt-001.json'],
  tb1Candidate: ['xion-local-memory-inference-p1b6-surface-target-boundary-candidate-v1', '5a4253506a9a9885118781c68cdcc407d91b6497b4b1af2105a675332ef8a7f5', 'local-memory-inference-p1b6-surface-target-boundary-candidate.json'],
  tb1Human: ['xion-local-memory-inference-p1b6-target-boundary-human-review-attempt-001-receipt-v1', 'c7e4ba1c2d3274772626807d7d288bf4c40c5c65025008da7df3f433b6924894', 'local-memory-inference-p1b6-target-boundary-human-review-attempt-001.json'],
  rp1Candidate: ['xion-local-memory-inference-p1b6-surface-v3-replacement-candidate-v1', '8c3ff152cfb42abfe4a327e4ba84b833904946c7400332ab5e560980a9af47cc', 'local-memory-inference-p1b6-surface-v3-replacement-candidate.json'],
  rp1Human: ['xion-local-memory-inference-p1b6-v3-replacement-human-review-attempt-001-receipt-v1', 'b5ea161f10937b2fbde92d85a04ea3e9410f2ccfef6a5c4ed304d7eb5926367c', 'local-memory-inference-p1b6-v3-replacement-human-review-attempt-001.json'],
});

// Statuses that are in the reviewed pool under the owner's rule.
const IN_POOL = Object.freeze({
  ACCEPTED_HUMAN_GOLD: 'HUMAN_GOLD',
  HUMAN_ADJUDICATED: 'HUMAN_ADJUDICATED',
  PROVISIONAL: 'CATALOG_STRONG_MODEL_CONFIRMED',
  REPAIR_HUMAN_MATCHING_V3: 'HUMAN_REVIEWED_REPAIR',
  OWNER_RESOLUTION_LABEL: 'OWNER_RESOLUTION',
});
const OUT_OF_POOL = Object.freeze([
  'ACCEPTED_ON_RETIRED_SKELETON', 'EXCLUDED_AUDIT_FAIL', 'HISTORICAL_RETIRED_SKELETON',
  'SURFACE_REJECTED', 'INELIGIBLE', 'INELIGIBLE_TARGET_BOUNDARY',
]);

function fail(message) {
  throw new TypeError(`P1-B6 reviewed-pool ledger ${message}`);
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

// Batch-003: apply each committed layer in chronological order; a later layer overrides.
function batch003Statuses(a) {
  const status = new Map(a.batch.items.map(row => [row.itemId, null]));
  const set = (itemId, value) => {
    if (!status.has(itemId)) fail(`layer names a row outside batch-003: ${itemId}`);
    status.set(itemId, value);
  };
  const auditFailed = new Set(a.sourceAudit.rows.filter(row => row.disposition !== 'PASS').map(row => row.auditRowId));
  const failIds = a.batch.items.map(row => row.itemId)
    .filter(itemId => auditFailed.has(require('./build-memory-inference-p1b6-source-audit-packet')
      .opaqueAuditRowId(SOURCES.batch[1], itemId)));
  if (failIds.length !== 3) fail('batch-003 source-audit FAIL set drifted');
  for (const itemId of a.batch.items.map(row => row.itemId)) {
    set(itemId, failIds.includes(itemId) ? { status: 'EXCLUDED_AUDIT_FAIL' }
      : a.strongModel.routedItemIds.includes(itemId) ? { status: 'ROUTED_PENDING' }
        : { status: 'PROVISIONAL' });
  }
  for (const row of [...a.human.adjudicationRows, ...a.human.calibrationRows]) {
    set(row.itemId, row.eligibility === 'INELIGIBLE' ? { status: 'INELIGIBLE' }
      : row.provenance === 'HUMAN_ADJUDICATED' ? { status: 'HUMAN_ADJUDICATED' } : { status: 'PROVISIONAL' });
  }
  for (const decision of a.resolution.decisions) {
    const byResolution = {
      REFERENCE_UPHELD_REVIEWER_CORRECTION: { status: 'OWNER_RESOLUTION_LABEL', label: decision.resolvedLabel },
      SEMANTIC_CONTRACT_CORRECTION: { status: 'OWNER_RESOLUTION_LABEL', label: decision.resolvedLabel },
      SURFACE_REPAIR: { status: 'INELIGIBLE' },
      SURFACE_REJECT: { status: 'SURFACE_REJECTED' },
      SKELETON_RETIRED: { status: 'HISTORICAL_RETIRED_SKELETON' },
    }[decision.resolution];
    if (!byResolution) fail(`unknown resolution: ${decision.resolution}`);
    set(decision.itemId, byResolution);
  }
  for (const group of a.resolution.retiredSkeletonSurfaces) {
    for (const itemId of group.historicalItemIds) set(itemId, { status: 'HISTORICAL_RETIRED_SKELETON' });
  }
  for (const itemId of a.targetedStrongModel.agreementItemIds) set(itemId, { status: 'PROVISIONAL' });
  for (const row of a.targetedHuman.rows) {
    set(row.itemId, row.eligibility === 'PROVISIONAL' ? { status: 'PROVISIONAL' }
      : row.eligibility === 'ELIGIBLE' ? { status: 'HUMAN_ADJUDICATED' } : { status: 'INELIGIBLE' });
  }
  for (const row of a.targetBoundary.rows) set(row.itemId, { status: 'INELIGIBLE_TARGET_BOUNDARY' });
  for (const row of a.repairCandidate.items) {
    const matching = a.repairHuman.v3ReferenceComparison.matching === a.repairCandidate.items.length
      && a.repairHuman.rows.every(result => result.disposition === 'KEEP');
    set(row.itemId, matching ? { status: 'REPAIR_HUMAN_MATCHING_V3', surface: 'repairCandidate' } : { status: 'INELIGIBLE' });
  }
  for (const row of a.anchorHuman.rows) {
    const next = row.eligibility === 'ELIGIBLE' ? 'HUMAN_ADJUDICATED'
      : row.eligibility === 'PROVISIONAL' ? 'PROVISIONAL' : 'INELIGIBLE';
    set(row.itemId, { status: next, surface: 'anchorCandidate' });
  }
  const pending = [...status].filter(([, value]) => value.status === 'ROUTED_PENDING');
  if (pending.length) fail(`routed rows left unresolved: ${pending.map(([id]) => id).join(', ')}`);
  return status;
}

function candidateStatus(humanReceipt, itemId) {
  const row = humanReceipt.rows.find(entry => entry.itemId === itemId);
  if (!row) fail(`candidate has no HUMAN row: ${itemId}`);
  return row.eligibility === 'ELIGIBLE' ? 'HUMAN_ADJUDICATED'
    : row.eligibility === 'PROVISIONAL' ? 'PROVISIONAL' : 'INELIGIBLE';
}

function buildLedger(a, accepted) {
  const skeletons = new Map(a.v3.candidates.map(row => [row.semanticSkeletonId, row]));
  const retired = new Set(a.v3.retiredSkeletons.map(row => row.retiredSkeletonId));
  const describe = (artifact, item) => {
    const episode = artifact.sourceEpisodes.find(row => row.sourceEpisodeId === item.sourceEpisodeId);
    return { language: episode.language, fragments: computeFragments(item, episode).length };
  };
  const row = (itemId, source, semanticSkeletonId, status, label, surface, extra = {}) => {
    const skeleton = skeletons.get(semanticSkeletonId);
    const inPool = Object.hasOwn(IN_POOL, status);
    if (inPool && (!skeleton || retired.has(semanticSkeletonId))) fail(`in-pool row is not on an active v3 skeleton: ${itemId}`);
    return {
      itemId,
      source,
      semanticSkeletonId,
      splitAssignment: skeleton?.splitAssignment ?? null,
      language: surface.language,
      fragments: surface.fragments,
      status,
      inPool,
      provenance: inPool ? IN_POOL[status] : null,
      referenceLabel: inPool ? label : null,
      ...extra,
    };
  };

  const rows = [];
  for (const seedRow of accepted.rows) {
    const onRetired = retired.has(seedRow.semanticSkeletonId);
    const v3Label = skeletons.get(seedRow.semanticSkeletonId)?.humanLabel ?? null;
    rows.push(row(seedRow.itemId, seedRow.itemId.includes('-b001-') ? 'batch-001 acceptance' : 'batch-002 acceptance',
      seedRow.semanticSkeletonId, onRetired ? 'ACCEPTED_ON_RETIRED_SKELETON' : 'ACCEPTED_HUMAN_GOLD', seedRow.decision,
      { language: seedRow.language, fragments: seedRow.fragments },
      { humanGoldLabel: seedRow.decision, humanGoldDiffersFromV3: !onRetired && v3Label !== seedRow.decision }));
  }
  const statuses = batch003Statuses(a);
  for (const item of a.batch.items) {
    const current = statuses.get(item.itemId);
    const artifact = current.surface ? a[current.surface] : a.batch;
    const surfaceItem = current.surface ? artifact.items.find(entry => entry.itemId === item.itemId) : item;
    const v3Label = skeletons.get(item.semanticSkeletonId)?.humanLabel ?? null;
    if (current.label && current.label !== v3Label) fail(`owner resolution label differs from v3: ${item.itemId}`);
    rows.push(row(item.itemId, current.surface ? artifact.name : 'batch-003', item.semanticSkeletonId,
      current.status, v3Label, describe(artifact, surfaceItem)));
  }
  for (const [candidateKey, humanKey] of [['tb1Candidate', 'tb1Human'], ['rp1Candidate', 'rp1Human']]) {
    for (const item of a[candidateKey].items) {
      rows.push(row(item.itemId, a[candidateKey].name, item.semanticSkeletonId,
        candidateStatus(a[humanKey], item.itemId), skeletons.get(item.semanticSkeletonId).humanLabel,
        describe(a[candidateKey], item)));
    }
  }
  if (new Set(rows.map(entry => entry.itemId)).size !== rows.length) fail('duplicate ledger row');
  for (const entry of rows) {
    if (!Object.hasOwn(IN_POOL, entry.status) && !OUT_OF_POOL.includes(entry.status)) fail(`unclassified status: ${entry.status}`);
  }

  const tally = (list, key) => list.reduce((acc, entry) => {
    acc[entry[key]] = (acc[entry[key]] ?? 0) + 1;
    return acc;
  }, {});
  const pool = rows.filter(entry => entry.inPool);
  return {
    name: LEDGER_IDENTITY,
    status: 'CURRENT_REVIEWED_POOL_LEDGER',
    decisionsSource: 'REPOSITORY_OWNER_POOL_RULE_OPTION_A',
    poolRule: {
      inPool: Object.keys(IN_POOL),
      outOfPool: OUT_OF_POOL,
      acceptedOnRetiredSkeleton: 'excluded from the pool and flagged; the acceptance records are not rewritten',
      humanGoldDiffersFromV3: 'kept in the pool with the immutable HUMAN label and flagged for the separate migration decision',
      provisional: 'CATALOG_STRONG_MODEL_CONFIRMED / PROVISIONAL rows count as reviewed eligible pool members, per the large-batch review order; they are not HUMAN gold',
    },
    inputs: Object.fromEntries(Object.entries(SOURCES).map(([key, [identity, rawSha256]]) => [key, { identity, rawSha256 }])),
    acceptedSeedSource: 'scripts/build-memory-inference-p1b6-batch-003-authoring-plan.js reconstructAcceptedSeed (pinned batch-001/002 acceptance inputs)',
    summary: {
      totalRows: rows.length,
      byStatus: tally(rows, 'status'),
      inPool: pool.length,
      humanGoldDiffersFromV3: rows.filter(entry => entry.humanGoldDiffersFromV3).map(entry => entry.itemId),
      acceptedOnRetiredSkeleton: rows.filter(entry => entry.status === 'ACCEPTED_ON_RETIRED_SKELETON').map(entry => entry.itemId),
    },
    rows,
    authority: {
      acceptancePerformed: false,
      acceptedRecordsRewritten: false,
      historicalReviewRewritten: false,
      referenceLabelFreezePerformed: false,
      finalSelectionPerformed: false,
      trainingOrEvaluationOccurred: false,
    },
  };
}

function buildShortage(ledger, v3) {
  const target = plan.FINAL_CORPUS;
  const pool = ledger.rows.filter(entry => entry.inPool);
  const count = (key, keys) => Object.fromEntries(keys.map(value => [value, pool.filter(entry => entry[key] === value).length]));
  const compare = (observed, targets) => Object.fromEntries(Object.entries(targets).map(([key, value]) =>
    [key, { pool: observed[key] ?? 0, target: value, deficit: Math.max(0, value - (observed[key] ?? 0)), surplus: Math.max(0, (observed[key] ?? 0) - value) }]));
  const split = compare(count('splitAssignment', plan.SPLITS), target.split);
  const language = compare(count('language', plan.LANGUAGES), target.language);
  const fragments = compare(count('fragments', plan.FRAGMENT_BUCKETS), target.fragments);
  const sumDeficit = cells => Object.values(cells).reduce((total, cell) => total + cell.deficit, 0);

  const coverage = new Map(v3.candidates.map(row => [row.semanticSkeletonId, 0]));
  for (const entry of pool) coverage.set(entry.semanticSkeletonId, coverage.get(entry.semanticSkeletonId) + 1);
  const heldSkeletons = v3.candidates.filter(row => row.splitAssignment === 'FINAL_HELD_OUT')
    .map(row => ({
      semanticSkeletonId: row.semanticSkeletonId,
      pool: coverage.get(row.semanticSkeletonId),
      needTo5: Math.max(0, target.heldSurfacesPerSkeleton - coverage.get(row.semanticSkeletonId)),
    })).sort((left, right) => (left.semanticSkeletonId < right.semanticSkeletonId ? -1 : 1));
  const heldPerSkeletonNeed = heldSkeletons.reduce((total, row) => total + row.needTo5, 0);
  const zeroCovered = v3.candidates.filter(row => coverage.get(row.semanticSkeletonId) === 0)
    .map(row => row.semanticSkeletonId).sort();

  // Split-aware lower bound: HELD needs at least the larger of its split deficit and its
  // per-skeleton shortfall; surplus in one split cannot fill another.
  const splitAware = split.TRAIN.deficit + split.DEV.deficit
    + Math.max(split.FINAL_HELD_OUT.deficit, heldPerSkeletonNeed);
  const bounds = {
    total: Math.max(0, target.total - pool.length),
    splitAware,
    language: sumDeficit(language),
    fragments: sumDeficit(fragments),
  };
  return {
    name: SHORTAGE_IDENTITY,
    status: 'MARGINAL_SHORTAGE_MEASURED_TOP_UP_NOT_AUTHORED',
    ledger: { identity: LEDGER_IDENTITY },
    frozenConstraints: {
      total: target.total,
      split: target.split,
      language: target.language,
      fragments: target.fragments,
      heldSurfacesPerSkeleton: target.heldSurfacesPerSkeleton,
      labelBalance: 'ABOLISHED_BY_SEMANTIC_CONTRACT_V3_NOT_MEASURED',
    },
    pool: { total: pool.length, split, language, fragments },
    heldSkeletons,
    heldPerSkeletonNeed,
    zeroCoveredActiveSkeletons: zeroCovered,
    lowerBounds: bounds,
    minimumTopUpLowerBound: Math.max(...Object.values(bounds)),
    statement: [
      'Marginal lower bounds against the frozen 380 constraints; a top-up of this size is necessary but not proven sufficient.',
      'Joint feasibility across split, skeleton, language and fragment cells is checked only at deterministic selection; a top-up plan must add buffer for review losses.',
      'Surplus in one cell cannot fill a deficit in another. Label balance is not a target under semantic contract v3.',
    ],
    authority: {
      topUpAuthored: false,
      acceptancePerformed: false,
      finalSelectionPerformed: false,
      referenceLabelFreezePerformed: false,
      trainingOrEvaluationOccurred: false,
    },
  };
}

function buildArtifacts(rawSources = loadSources()) {
  const artifacts = verifySources(rawSources);
  const seedInputs = Object.fromEntries(Object.entries(plan.loadCanonicalInputs())
    .map(([key, value]) => [key, JSON.parse(value)]));
  const accepted = plan.reconstructAcceptedSeed(seedInputs);
  const ledger = buildLedger(artifacts, accepted);
  return { ledger, shortage: buildShortage(ledger, artifacts.v3) };
}

const artifactBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');

function main() {
  const { ledger, shortage } = buildArtifacts();
  for (const [file, value] of [[LEDGER_FILE, ledger], [SHORTAGE_FILE, shortage]]) {
    fs.writeFileSync(path.join(ROOT, 'fixtures', file), artifactBytes(value));
    process.stdout.write(`Wrote fixtures/${file}\n`);
  }
  return 0;
}

module.exports = {
  IN_POOL,
  LEDGER_FILE,
  OUT_OF_POOL,
  SHORTAGE_FILE,
  SOURCES,
  artifactBytes,
  batch003Statuses,
  buildArtifacts,
  buildShortage,
  loadSources,
  main,
  verifySources,
};

if (require.main === module) process.exit(main());
