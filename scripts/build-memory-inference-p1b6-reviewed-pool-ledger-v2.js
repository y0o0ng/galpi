#!/usr/bin/env node
'use strict';

// P1-B6 reviewed-pool ledger v2 and shortage receipt v2: the pinned v1 ledger plus the 41
// batch-004 rows, under the same owner pool rule A.
//
// v1 stays byte-identical because the batch-004 authoring protocol pins it. Batch-004 statuses
// come mechanically from the committed source-audit, v3 review and HUMAN receipts. The owner
// closed the two HUMAN mismatches (009, 037) as current-realization failures: they stay
// INELIGIBLE, nothing relabels a skeleton or amends v3, and nothing replaces them. Nothing is
// authored, accepted, frozen, selected or trained here.

const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { computeFragments } = require('../lib/memory-inference-p1b6-surfaces');
const v1 = require('./build-memory-inference-p1b6-reviewed-pool-ledger');
const audit = require('./build-memory-inference-p1b6-batch-004-source-audit-packet');

const ROOT = path.resolve(__dirname, '..');
const LEDGER_IDENTITY = 'xion-local-memory-inference-p1b6-reviewed-pool-ledger-v2';
const LEDGER_FILE = 'local-memory-inference-p1b6-reviewed-pool-ledger-v2.json';
const SHORTAGE_IDENTITY = 'xion-local-memory-inference-p1b6-shortage-receipt-v2';
const SHORTAGE_FILE = 'local-memory-inference-p1b6-shortage-receipt-v2.json';

const SOURCES = Object.freeze({
  ledgerV1: ['xion-local-memory-inference-p1b6-reviewed-pool-ledger-v1', '0c1e293c01e12aafa9863d8b15a25e4ce803f1f21de7035a952c3fb7b2c3742c', 'local-memory-inference-p1b6-reviewed-pool-ledger.json'],
  v3: ['xion-local-memory-inference-p1b6-skeleton-effective-current-v3', '89a48264d6b09710f976a4ab85235ff161cf81ff44896e37553d5dc7753c65b9', 'local-memory-inference-p1b6-skeleton-effective-current-v3.json'],
  batch004: ['xion-local-memory-inference-p1b6-surface-batch-004-v1', 'f640198f9d472c00046b8cb22083407b12887534bf0544cd808620691c5bc0c1', 'local-memory-inference-p1b6-surface-batch-004.json'],
  sourceAudit: ['xion-local-memory-inference-p1b6-batch-004-source-audit-attempt-001-receipt-v1', '870ac2edfb28f63f72bc28c47569a18a26367b90e218a1840601f0322645d8be', 'local-memory-inference-p1b6-batch-004-source-audit-attempt-001.json'],
  strongModel: ['xion-local-memory-inference-p1b6-batch-004-v3-review-attempt-001-receipt-v1', '08a30720c19490f04da8ffcc0943eb849fac1da6c5051919a0eaab02145587a0', 'local-memory-inference-p1b6-batch-004-v3-review-attempt-001.json'],
  human: ['xion-local-memory-inference-p1b6-batch-004-human-review-attempt-001-receipt-v1', 'b83c60e5d35ea77e62e7619a3a7fbae281326ee391ec7a5505036ec9661ad3cc', 'local-memory-inference-p1b6-batch-004-human-review-attempt-001.json'],
});
const OUT_OF_POOL = Object.freeze([...v1.OUT_OF_POOL, 'EXCLUDED_AUDIT_UNCERTAIN']);
// Owner decision (2026-09-30): both HUMAN decision mismatches are current-realization failures.
const OWNER_RESOLUTIONS = Object.freeze([
  Object.freeze({ itemId: 'p1b6-item-b004-009', resolution: 'CURRENT_REALIZATION_FAILURE' }),
  Object.freeze({ itemId: 'p1b6-item-b004-037', resolution: 'CURRENT_REALIZATION_FAILURE' }),
]);

function fail(message) {
  throw new TypeError(`P1-B6 reviewed-pool ledger v2 ${message}`);
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

// Later layers override: audit → v3 review route → HUMAN outcome.
function batch004Statuses(a) {
  const auditItem = new Map(a.batch004.items.map(item =>
    [audit.opaqueAuditRowId(SOURCES.batch004[1], item.itemId), item.itemId]));
  const status = new Map(a.batch004.items.map(item => [item.itemId, null]));
  for (const row of a.sourceAudit.rows) {
    status.set(auditItem.get(row.auditRowId), row.disposition === 'PASS' ? 'ROUTED_PENDING'
      : row.disposition === 'UNCERTAIN' ? 'EXCLUDED_AUDIT_UNCERTAIN' : 'EXCLUDED_AUDIT_FAIL');
  }
  for (const row of a.strongModel.rows) {
    if (status.get(row.itemId) !== 'ROUTED_PENDING') fail(`v3 review names a row outside the audit PASS set: ${row.itemId}`);
    status.set(row.itemId, row.route === 'CLEAN_AGREEMENT' ? 'PROVISIONAL' : 'ROUTED_PENDING');
  }
  for (const row of a.human.rows) {
    status.set(row.itemId, row.eligibility === 'ELIGIBLE' ? 'HUMAN_ADJUDICATED'
      : row.eligibility === 'PROVISIONAL' ? 'PROVISIONAL' : 'INELIGIBLE');
  }
  const mismatches = a.human.rows.filter(row => row.resolutionRequired).map(row => row.itemId);
  if (JSON.stringify(mismatches) !== JSON.stringify(OWNER_RESOLUTIONS.map(row => row.itemId))) {
    fail('owner resolutions do not cover exactly the HUMAN mismatches');
  }
  const open = [...status].filter(([, value]) => value === null || value === 'ROUTED_PENDING');
  if (open.length) fail(`rows left unresolved: ${open.map(([id]) => id).join(', ')}`);
  return status;
}

function buildLedger(a) {
  const skeletons = new Map(a.v3.candidates.map(row => [row.semanticSkeletonId, row]));
  const statuses = batch004Statuses(a);
  const episodes = new Map(a.batch004.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  const added = a.batch004.items.map(item => {
    const status = statuses.get(item.itemId);
    const inPool = Object.hasOwn(v1.IN_POOL, status);
    const episode = episodes.get(item.sourceEpisodeId);
    return {
      itemId: item.itemId,
      source: 'batch-004',
      semanticSkeletonId: item.semanticSkeletonId,
      splitAssignment: skeletons.get(item.semanticSkeletonId).splitAssignment,
      language: episode.language,
      fragments: computeFragments(item, episode).length,
      status,
      inPool,
      provenance: inPool ? v1.IN_POOL[status] : null,
      referenceLabel: inPool ? skeletons.get(item.semanticSkeletonId).humanLabel : null,
    };
  });
  const rows = [...a.ledgerV1.rows, ...added];
  if (new Set(rows.map(entry => entry.itemId)).size !== rows.length) fail('duplicate ledger row');
  for (const entry of rows) {
    if (!Object.hasOwn(v1.IN_POOL, entry.status) && !OUT_OF_POOL.includes(entry.status)) fail(`unclassified status: ${entry.status}`);
  }
  const tally = list => list.reduce((acc, entry) => {
    acc[entry.status] = (acc[entry.status] ?? 0) + 1;
    return acc;
  }, {});
  return {
    name: LEDGER_IDENTITY,
    status: 'CURRENT_REVIEWED_POOL_LEDGER',
    decisionsSource: 'REPOSITORY_OWNER_POOL_RULE_OPTION_A',
    poolRule: { ...a.ledgerV1.poolRule, outOfPool: OUT_OF_POOL },
    inputs: Object.fromEntries(Object.entries(SOURCES).map(([key, [identity, rawSha256]]) => [key, { identity, rawSha256 }])),
    batch004OwnerResolutions: {
      decisionsSource: 'REPOSITORY_OWNER',
      date: '2026-09-30',
      rows: OWNER_RESOLUTIONS,
      semantics: 'the current realization stays INELIGIBLE; the skeleton and v3 are unchanged; no replacement surface is owed',
    },
    summary: {
      totalRows: rows.length,
      byStatus: tally(rows),
      inPool: rows.filter(entry => entry.inPool).length,
      batch004: { rows: added.length, inPool: added.filter(entry => entry.inPool).length, byStatus: tally(added) },
      humanGoldDiffersFromV3: a.ledgerV1.summary.humanGoldDiffersFromV3,
      acceptedOnRetiredSkeleton: a.ledgerV1.summary.acceptedOnRetiredSkeleton,
    },
    rows,
    authority: a.ledgerV1.authority,
  };
}

function buildArtifacts(rawSources = loadSources()) {
  const artifacts = verifySources(rawSources);
  const ledger = buildLedger(artifacts);
  const shortage = { ...v1.buildShortage(ledger, artifacts.v3), name: SHORTAGE_IDENTITY, ledger: { identity: LEDGER_IDENTITY } };
  return { ledger, shortage };
}

function main() {
  const { ledger, shortage } = buildArtifacts();
  for (const [file, value] of [[LEDGER_FILE, ledger], [SHORTAGE_FILE, shortage]]) {
    fs.writeFileSync(path.join(ROOT, 'fixtures', file), v1.artifactBytes(value));
    process.stdout.write(`Wrote fixtures/${file}\n`);
  }
  return 0;
}

module.exports = {
  LEDGER_FILE,
  OWNER_RESOLUTIONS,
  SHORTAGE_FILE,
  SOURCES,
  batch004Statuses,
  buildArtifacts,
  loadSources,
  main,
  verifySources,
};

if (require.main === module) process.exit(main());
