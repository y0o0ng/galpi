#!/usr/bin/env node
'use strict';

// P1-B6 reviewed-pool ledger v4 and shortage receipt v4: ledger v3 with the accepted-row v3
// migration applied. v3 stays byte-identical. The 12 gold-vs-v3 rows take their final migration
// status from the committed migration HUMAN receipt: migrated rows enter the pool with the v3
// label and new provenance; the rest leave it. Historical HUMAN gold stays on each row as a fact.
// Nothing is authored, accepted, frozen, selected or trained here.

const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const v1 = require('./build-memory-inference-p1b6-reviewed-pool-ledger');

const ROOT = path.resolve(__dirname, '..');
const LEDGER_IDENTITY = 'xion-local-memory-inference-p1b6-reviewed-pool-ledger-v4';
const LEDGER_FILE = 'local-memory-inference-p1b6-reviewed-pool-ledger-v4.json';
const SHORTAGE_IDENTITY = 'xion-local-memory-inference-p1b6-shortage-receipt-v4';
const SHORTAGE_FILE = 'local-memory-inference-p1b6-shortage-receipt-v4.json';

const SOURCES = Object.freeze({
  ledgerV3: ['xion-local-memory-inference-p1b6-reviewed-pool-ledger-v3', 'c572ac2d930cc7b614e23d7c48359f3131819db29891921d5c87032e705ba04c', 'local-memory-inference-p1b6-reviewed-pool-ledger-v3.json'],
  v3: ['xion-local-memory-inference-p1b6-skeleton-effective-current-v3', '89a48264d6b09710f976a4ab85235ff161cf81ff44896e37553d5dc7753c65b9', 'local-memory-inference-p1b6-skeleton-effective-current-v3.json'],
  migrationHuman: ['xion-local-memory-inference-p1b6-accepted-v3-migration-human-review-attempt-001-receipt-v1', '370c49ca02262744844b3ba6271b92296137410cbfc981176323bd8c3f98547d', 'local-memory-inference-p1b6-accepted-v3-migration-human-review-attempt-001.json'],
});

function fail(message) {
  throw new TypeError(`P1-B6 reviewed-pool ledger v4 ${message}`);
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

function buildLedger(a) {
  const labels = new Map(a.v3.candidates.map(row => [row.semanticSkeletonId, row.humanLabel]));
  const final = new Map(a.migrationHuman.rows.map(row => [row.itemId, row]));
  const flagged = a.ledgerV3.rows.filter(row => row.humanGoldDiffersFromV3).map(row => row.itemId);
  if (JSON.stringify(flagged.toSorted()) !== JSON.stringify([...final.keys()].toSorted())) fail('migration rows are not the flagged rows');
  const rows = a.ledgerV3.rows.map(row => {
    const migrated = final.get(row.itemId);
    if (!migrated) return row;
    const inPool = ['PROVISIONAL', 'ELIGIBLE'].includes(migrated.finalEligibility);
    const status = inPool ? (migrated.finalProvenance === 'HUMAN_ADJUDICATED' ? 'HUMAN_ADJUDICATED' : 'PROVISIONAL') : 'INELIGIBLE';
    return {
      ...row,
      status,
      inPool,
      provenance: inPool ? v1.IN_POOL[status] : null,
      referenceLabel: inPool ? labels.get(row.semanticSkeletonId) : null,
      v3Migration: inPool ? 'MIGRATED_TO_V3' : 'MIGRATION_INELIGIBLE',
    };
  });
  const tally = list => list.reduce((acc, entry) => {
    acc[entry.status] = (acc[entry.status] ?? 0) + 1;
    return acc;
  }, {});
  return {
    name: LEDGER_IDENTITY,
    status: 'CURRENT_REVIEWED_POOL_LEDGER',
    decisionsSource: 'REPOSITORY_OWNER_POOL_RULE_OPTION_A',
    poolRule: {
      ...a.ledgerV3.poolRule,
      humanGoldDiffersFromV3: 'resolved by the accepted-row v3 migration: migrated rows carry the v3 label with new provenance, the rest are out of the pool; the historical gold stays on the row',
      acceptedOnRetiredSkeleton: 'permanently out of the pool (owner, 2026-10-01); the acceptance records are not rewritten',
    },
    inputs: Object.fromEntries(Object.entries(SOURCES).map(([key, [identity, rawSha256]]) => [key, { identity, rawSha256 }])),
    batch004OwnerResolutions: a.ledgerV3.batch004OwnerResolutions,
    summary: {
      totalRows: rows.length,
      byStatus: tally(rows),
      inPool: rows.filter(entry => entry.inPool).length,
      batch004: a.ledgerV3.summary.batch004,
      batch005: a.ledgerV3.summary.batch005,
      v3Migration: {
        migrated: rows.filter(entry => entry.v3Migration === 'MIGRATED_TO_V3').map(entry => entry.itemId),
        ineligible: rows.filter(entry => entry.v3Migration === 'MIGRATION_INELIGIBLE').map(entry => entry.itemId),
      },
      inPoolLabelDiffersFromV3: rows.filter(entry => entry.inPool && entry.referenceLabel !== labels.get(entry.semanticSkeletonId)).map(entry => entry.itemId),
      acceptedOnRetiredSkeleton: a.ledgerV3.summary.acceptedOnRetiredSkeleton,
    },
    rows,
    authority: a.ledgerV3.authority,
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
