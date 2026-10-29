#!/usr/bin/env node
'use strict';

// P1-B6 reviewed-pool ledger v6 and shortage receipt v6: the pinned v5 ledger under semantic
// contract v4. Statuses change only where the v4 pool review receipt or the owner's v4 HUMAN
// receipt says so (non-realization, HELD scope flags, confirmed out-of-scope rows, and the
// cc054a42 rows re-judged under v4); every in-pool reference label now comes from the v4
// catalog. v5 stays byte-identical. Nothing is authored, accepted, frozen, selected or trained.

const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const v1 = require('./build-memory-inference-p1b6-reviewed-pool-ledger');

const ROOT = path.resolve(__dirname, '..');
const LEDGER_IDENTITY = 'xion-local-memory-inference-p1b6-reviewed-pool-ledger-v6';
const LEDGER_FILE = 'local-memory-inference-p1b6-reviewed-pool-ledger-v6.json';
const SHORTAGE_IDENTITY = 'xion-local-memory-inference-p1b6-shortage-receipt-v6';
const SHORTAGE_FILE = 'local-memory-inference-p1b6-shortage-receipt-v6.json';

const SOURCES = Object.freeze({
  ledgerV5: ['xion-local-memory-inference-p1b6-reviewed-pool-ledger-v5', '81580af10cc0c826bda0c4f387774ae045a6677ec003c08e94729e2a9e0ff730', 'local-memory-inference-p1b6-reviewed-pool-ledger-v5.json'],
  v4: ['xion-local-memory-inference-p1b6-skeleton-effective-current-v4', 'a53debe1b065e9bbd5a94f32036f8ac2586eae72b2f5a6bdf9fae0a93dfed194', 'local-memory-inference-p1b6-skeleton-effective-current-v4.json'],
  poolReview: ['xion-local-memory-inference-p1b6-v4-pool-review-attempt-001-receipt-v1', '3941ce00f3648bc9e4104fa75c2d365e38f7189c16d427235a129217ca3a7e1f', 'local-memory-inference-p1b6-v4-pool-review-attempt-001.json'],
  human: ['xion-local-memory-inference-p1b6-v4-human-review-attempt-001-receipt-v1', '743fc75746c2369e3823c6919554f21d8ff0ce98fe0e9423617817294a84f565', 'local-memory-inference-p1b6-v4-human-review-attempt-001.json'],
});

function fail(message) {
  throw new TypeError(`P1-B6 reviewed-pool ledger v6 ${message}`);
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

// itemId → [new status, v4 outcome] for every row the two v4 receipts move.
function v4Statuses(a) {
  const moves = new Map();
  for (const row of a.poolReview.rows) {
    if (row.eligibility === 'INELIGIBLE') moves.set(row.itemId, ['INELIGIBLE', row.outcome]);
    else if (row.outcome === 'V4_CLEAN_AGREEMENT' && !row.human) moves.set(row.itemId, ['PROVISIONAL', row.outcome]);
  }
  const status = { INELIGIBLE: 'INELIGIBLE', ELIGIBLE: 'HUMAN_ADJUDICATED', PROVISIONAL: 'PROVISIONAL' };
  for (const row of a.human.rows) {
    if (row.eligibility !== 'UNCHANGED') moves.set(row.itemId, [status[row.eligibility] ?? fail(`unknown eligibility: ${row.eligibility}`), row.outcome]);
  }
  const routedOpen = a.poolReview.rows.filter(row => row.human && !a.human.rows.some(h => h.itemId === row.itemId));
  if (routedOpen.length) fail(`rows routed to HUMAN have no HUMAN result: ${routedOpen.map(row => row.itemId).join(', ')}`);
  return moves;
}

function buildLedger(a) {
  const skeletons = new Map(a.v4.candidates.map(row => [row.semanticSkeletonId, row]));
  const changed = new Set(a.v4.labelChangedSkeletonIds);
  const moves = v4Statuses(a);
  const rows = a.ledgerV5.rows.map(entry => {
    const move = moves.get(entry.itemId);
    if (!move) {
      if (entry.inPool && changed.has(entry.semanticSkeletonId)) fail(`label-changed row was not re-judged under v4: ${entry.itemId}`);
      if (entry.inPool && entry.referenceLabel !== skeletons.get(entry.semanticSkeletonId).humanLabel) fail(`in-pool label differs from v4: ${entry.itemId}`);
      return entry;
    }
    if (!entry.inPool) fail(`a v4 receipt moves a row outside the v5 pool: ${entry.itemId}`);
    const [status, v4Outcome] = move;
    const inPool = Object.hasOwn(v1.IN_POOL, status);
    return {
      ...entry,
      status,
      inPool,
      provenance: inPool ? v1.IN_POOL[status] : null,
      referenceLabel: inPool ? skeletons.get(entry.semanticSkeletonId).humanLabel : null,
      v4Outcome,
    };
  });
  const tally = (list, key) => list.reduce((acc, entry) => {
    acc[entry[key]] = (acc[entry[key]] ?? 0) + 1;
    return acc;
  }, {});
  const moved = rows.filter(entry => entry.v4Outcome);
  return {
    name: LEDGER_IDENTITY,
    status: 'CURRENT_REVIEWED_POOL_LEDGER',
    decisionsSource: 'REPOSITORY_OWNER_POOL_RULE_OPTION_A',
    semanticAuthority: { identity: SOURCES.v4[0], rawSha256: SOURCES.v4[1] },
    poolRule: a.ledgerV5.poolRule,
    inputs: Object.fromEntries(Object.entries(SOURCES).map(([key, [identity, rawSha256]]) => [key, { identity, rawSha256 }])),
    batch004OwnerResolutions: a.ledgerV5.batch004OwnerResolutions,
    summary: {
      totalRows: rows.length,
      byStatus: tally(rows, 'status'),
      inPool: rows.filter(entry => entry.inPool).length,
      v4: { rows: moved.length, byOutcome: tally(moved, 'v4Outcome'), byStatus: tally(moved, 'status') },
      batch004: a.ledgerV5.summary.batch004,
      batch005: a.ledgerV5.summary.batch005,
      batch006: a.ledgerV5.summary.batch006,
      v3Migration: a.ledgerV5.summary.v3Migration,
      acceptedOnRetiredSkeleton: a.ledgerV5.summary.acceptedOnRetiredSkeleton,
    },
    rows,
    authority: a.ledgerV5.authority,
  };
}

function buildArtifacts(rawSources = loadSources()) {
  const artifacts = verifySources(rawSources);
  const ledger = buildLedger(artifacts);
  const shortage = { ...v1.buildShortage(ledger, artifacts.v4), name: SHORTAGE_IDENTITY, ledger: { identity: LEDGER_IDENTITY } };
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
