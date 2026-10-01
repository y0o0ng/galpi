#!/usr/bin/env node
'use strict';

// P1-B6 reviewed-pool ledger v5 and shortage receipt v5: the pinned v4 ledger plus the 7 batch-006
// rows, under the same owner pool rule A. v4 stays byte-identical. Batch-006 statuses come
// mechanically from its source-audit, v3 review and HUMAN receipts (audit → v3 route → HUMAN
// outcome; HELD rows stop at the v3 route). Nothing is authored, accepted, frozen, selected or
// trained here.

const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { computeFragments } = require('../lib/memory-inference-p1b6-surfaces');
const v1 = require('./build-memory-inference-p1b6-reviewed-pool-ledger');
const audit = require('./build-memory-inference-p1b6-batch-006-source-audit-packet');

const ROOT = path.resolve(__dirname, '..');
const LEDGER_IDENTITY = 'xion-local-memory-inference-p1b6-reviewed-pool-ledger-v5';
const LEDGER_FILE = 'local-memory-inference-p1b6-reviewed-pool-ledger-v5.json';
const SHORTAGE_IDENTITY = 'xion-local-memory-inference-p1b6-shortage-receipt-v5';
const SHORTAGE_FILE = 'local-memory-inference-p1b6-shortage-receipt-v5.json';

const SOURCES = Object.freeze({
  ledgerV4: ['xion-local-memory-inference-p1b6-reviewed-pool-ledger-v4', 'ef9fa69d34576995f597e044b4d3fe672c6353f8298f7921fe654d62e1f4e8fa', 'local-memory-inference-p1b6-reviewed-pool-ledger-v4.json'],
  v3: ['xion-local-memory-inference-p1b6-skeleton-effective-current-v3', '89a48264d6b09710f976a4ab85235ff161cf81ff44896e37553d5dc7753c65b9', 'local-memory-inference-p1b6-skeleton-effective-current-v3.json'],
  batch006: ['xion-local-memory-inference-p1b6-surface-batch-006-v1', 'c058b752ca9a353ffc10475cf9d74796e3682f4084cfd06b7164851922724e64', 'local-memory-inference-p1b6-surface-batch-006.json'],
  sourceAudit: ['xion-local-memory-inference-p1b6-batch-006-source-audit-attempt-001-receipt-v1', '550fbd816ef2571e24f9cd2abfb61e5af7ace0a6cab794db622447858d6431fa', 'local-memory-inference-p1b6-batch-006-source-audit-attempt-001.json'],
  strongModel: ['xion-local-memory-inference-p1b6-batch-006-v3-review-attempt-001-receipt-v1', '5b96f4470b4eaeba90a0025a313c365762adce045ddbb53c955e8cdb910b68ba', 'local-memory-inference-p1b6-batch-006-v3-review-attempt-001.json'],
  human: ['xion-local-memory-inference-p1b6-batch-006-human-review-attempt-001-receipt-v1', 'c463b7431672676562ca004a1ec869f2f407f99b0f48cb20926e025f238c7c36', 'local-memory-inference-p1b6-batch-006-human-review-attempt-001.json'],
});

function fail(message) {
  throw new TypeError(`P1-B6 reviewed-pool ledger v5 ${message}`);
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

function batch006Statuses(a) {
  const auditItem = new Map(a.batch006.items.map(item =>
    [audit.opaqueAuditRowId(SOURCES.batch006[1], item.itemId), item.itemId]));
  const status = new Map(a.batch006.items.map(item => [item.itemId, null]));
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
  if (a.human.rows.some(row => row.resolutionRequired)) fail('a HUMAN mismatch has no owner resolution');
  const open = [...status].filter(([, value]) => value === null || value === 'ROUTED_PENDING');
  if (open.length) fail(`rows left unresolved: ${open.map(([id]) => id).join(', ')}`);
  return status;
}

function buildLedger(a) {
  const skeletons = new Map(a.v3.candidates.map(row => [row.semanticSkeletonId, row]));
  const statuses = batch006Statuses(a);
  const episodes = new Map(a.batch006.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  const added = a.batch006.items.map(item => {
    const status = statuses.get(item.itemId);
    const inPool = Object.hasOwn(v1.IN_POOL, status);
    const episode = episodes.get(item.sourceEpisodeId);
    return {
      itemId: item.itemId,
      source: 'batch-006',
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
  const rows = [...a.ledgerV4.rows, ...added];
  if (new Set(rows.map(entry => entry.itemId)).size !== rows.length) fail('duplicate ledger row');
  const outOfPool = a.ledgerV4.poolRule.outOfPool;
  for (const entry of rows) {
    if (!Object.hasOwn(v1.IN_POOL, entry.status) && !outOfPool.includes(entry.status)) fail(`unclassified status: ${entry.status}`);
  }
  const tally = list => list.reduce((acc, entry) => {
    acc[entry.status] = (acc[entry.status] ?? 0) + 1;
    return acc;
  }, {});
  return {
    name: LEDGER_IDENTITY,
    status: 'CURRENT_REVIEWED_POOL_LEDGER',
    decisionsSource: 'REPOSITORY_OWNER_POOL_RULE_OPTION_A',
    poolRule: a.ledgerV4.poolRule,
    inputs: Object.fromEntries(Object.entries(SOURCES).map(([key, [identity, rawSha256]]) => [key, { identity, rawSha256 }])),
    batch004OwnerResolutions: a.ledgerV4.batch004OwnerResolutions,
    summary: {
      totalRows: rows.length,
      byStatus: tally(rows),
      inPool: rows.filter(entry => entry.inPool).length,
      batch004: a.ledgerV4.summary.batch004,
      batch005: a.ledgerV4.summary.batch005,
      batch006: { rows: added.length, inPool: added.filter(entry => entry.inPool).length, byStatus: tally(added) },
      v3Migration: a.ledgerV4.summary.v3Migration,
      inPoolLabelDiffersFromV3: a.ledgerV4.summary.inPoolLabelDiffersFromV3,
      acceptedOnRetiredSkeleton: a.ledgerV4.summary.acceptedOnRetiredSkeleton,
    },
    rows,
    authority: a.ledgerV4.authority,
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

module.exports = { LEDGER_FILE, SHORTAGE_FILE, SOURCES, buildArtifacts, loadSources, main, verifySources };

if (require.main === module) process.exit(main());
