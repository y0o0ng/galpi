#!/usr/bin/env node
'use strict';

// P1-B6 reviewed-pool ledger v3 and shortage receipt v3: the pinned v2 ledger plus the 2 batch-005
// rows, under the same owner pool rule A. v2 stays byte-identical. Batch-005 statuses come
// mechanically from its source-audit, v3 review and HUMAN receipts (audit → v3 route → HUMAN
// outcome). Nothing is authored, accepted, frozen, selected or trained here.

const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { computeFragments } = require('../lib/memory-inference-p1b6-surfaces');
const v1 = require('./build-memory-inference-p1b6-reviewed-pool-ledger');
const audit = require('./build-memory-inference-p1b6-batch-005-source-audit-packet');

const ROOT = path.resolve(__dirname, '..');
const LEDGER_IDENTITY = 'xion-local-memory-inference-p1b6-reviewed-pool-ledger-v3';
const LEDGER_FILE = 'local-memory-inference-p1b6-reviewed-pool-ledger-v3.json';
const SHORTAGE_IDENTITY = 'xion-local-memory-inference-p1b6-shortage-receipt-v3';
const SHORTAGE_FILE = 'local-memory-inference-p1b6-shortage-receipt-v3.json';

const SOURCES = Object.freeze({
  ledgerV2: ['xion-local-memory-inference-p1b6-reviewed-pool-ledger-v2', '853de398664ced6fd2c11299be77c20f8ce452615bff51bfd51c331388b1329d', 'local-memory-inference-p1b6-reviewed-pool-ledger-v2.json'],
  v3: ['xion-local-memory-inference-p1b6-skeleton-effective-current-v3', '89a48264d6b09710f976a4ab85235ff161cf81ff44896e37553d5dc7753c65b9', 'local-memory-inference-p1b6-skeleton-effective-current-v3.json'],
  batch005: ['xion-local-memory-inference-p1b6-surface-batch-005-v1', '98f28dfe844cf07e766c9d0cfb91c00f02c0a79ea6c67e845d70f14f088b2713', 'local-memory-inference-p1b6-surface-batch-005.json'],
  sourceAudit: ['xion-local-memory-inference-p1b6-batch-005-source-audit-attempt-001-receipt-v1', '48b7639fb9c1017ee1f3cb1296c4e63765ac613520146eec2ca4a845bfeedcdf', 'local-memory-inference-p1b6-batch-005-source-audit-attempt-001.json'],
  strongModel: ['xion-local-memory-inference-p1b6-batch-005-v3-review-attempt-001-receipt-v1', '23b50a93cbd12009b8cb0af56ef4da90b30f5022ee7d7faa95389892452d8159', 'local-memory-inference-p1b6-batch-005-v3-review-attempt-001.json'],
  human: ['xion-local-memory-inference-p1b6-batch-005-human-review-attempt-001-receipt-v1', '2bc7a1ea312cad16101cf996bf45dc5f288c46b24ff95635dfeeedd0ff03bfe0', 'local-memory-inference-p1b6-batch-005-human-review-attempt-001.json'],
});

function fail(message) {
  throw new TypeError(`P1-B6 reviewed-pool ledger v3 ${message}`);
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

function batch005Statuses(a) {
  const auditItem = new Map(a.batch005.items.map(item =>
    [audit.opaqueAuditRowId(SOURCES.batch005[1], item.itemId), item.itemId]));
  const status = new Map(a.batch005.items.map(item => [item.itemId, null]));
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
  const statuses = batch005Statuses(a);
  const episodes = new Map(a.batch005.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  const added = a.batch005.items.map(item => {
    const status = statuses.get(item.itemId);
    const inPool = Object.hasOwn(v1.IN_POOL, status);
    const episode = episodes.get(item.sourceEpisodeId);
    return {
      itemId: item.itemId,
      source: 'batch-005',
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
  const rows = [...a.ledgerV2.rows, ...added];
  if (new Set(rows.map(entry => entry.itemId)).size !== rows.length) fail('duplicate ledger row');
  const outOfPool = a.ledgerV2.poolRule.outOfPool;
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
    poolRule: a.ledgerV2.poolRule,
    inputs: Object.fromEntries(Object.entries(SOURCES).map(([key, [identity, rawSha256]]) => [key, { identity, rawSha256 }])),
    batch004OwnerResolutions: a.ledgerV2.batch004OwnerResolutions,
    summary: {
      totalRows: rows.length,
      byStatus: tally(rows),
      inPool: rows.filter(entry => entry.inPool).length,
      batch004: a.ledgerV2.summary.batch004,
      batch005: { rows: added.length, inPool: added.filter(entry => entry.inPool).length, byStatus: tally(added) },
      humanGoldDiffersFromV3: a.ledgerV2.summary.humanGoldDiffersFromV3,
      acceptedOnRetiredSkeleton: a.ledgerV2.summary.acceptedOnRetiredSkeleton,
    },
    rows,
    authority: a.ledgerV2.authority,
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
