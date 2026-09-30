#!/usr/bin/env node
'use strict';

// P1-B6 accepted-row v3 migration: plan, and the blind source-audit and v3 strong-model packets.
//
// Owner decision (2026-10-01): the 6 accepted surfaces on retired skeletons stay permanently out
// of the pool (records unchanged). The 12 accepted surfaces whose immutable HUMAN gold differs
// from v3 are re-reviewed under v3 rather than kept under their old label, relabelled silently,
// or dropped. Historical HUMAN gold and acceptance records are never rewritten; a migrated row
// gets new provenance and the v3 label or leaves the pool.
//
// The population comes from the ledger v3 flags, never from a supplied list. Both packets are
// blind and are run in fresh separate sessions; routing is preregistered in the plan, which never
// reaches a packet. This step audits, reviews, accepts and trains nothing.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { RENDERER_IDENTITY } = require('../lib/memory-inference-p1b6-surfaces');
const { renderCandidateBundle } = require('./build-memory-inference-p1b6-surface-repair-source-audit-packet');

const ROOT = path.resolve(__dirname, '..');
const PLAN_IDENTITY = 'xion-local-memory-inference-p1b6-accepted-v3-migration-plan-v1';
const PLAN_FILE = 'local-memory-inference-p1b6-accepted-v3-migration-plan.json';
const AUDIT_PACKET_IDENTITY = 'xion-local-memory-inference-p1b6-accepted-v3-migration-source-audit-packet-v1';
const REVIEW_PACKET_IDENTITY = 'xion-local-memory-inference-p1b6-accepted-v3-migration-v3-review-packet-v1';
// Disjoint from every earlier P1-B6 audit and review namespace.
const AUDIT_ID_NAMESPACE = 'p1b6-mig-audit';
const REVIEW_ID_NAMESPACE = 'p1b6-mig-v3smreview';
const EXPECTED = Object.freeze({ migrate: 12, retired: 6 });

const SOURCES = Object.freeze({
  ledgerV3: ['xion-local-memory-inference-p1b6-reviewed-pool-ledger-v3', 'c572ac2d930cc7b614e23d7c48359f3131819db29891921d5c87032e705ba04c', 'local-memory-inference-p1b6-reviewed-pool-ledger-v3.json'],
  v3: ['xion-local-memory-inference-p1b6-skeleton-effective-current-v3', '89a48264d6b09710f976a4ab85235ff161cf81ff44896e37553d5dc7753c65b9', 'local-memory-inference-p1b6-skeleton-effective-current-v3.json'],
  batch001: ['xion-local-memory-inference-p1b6-surface-batch-001-v1', '2a4605f5550118754c315e26700aef1be96a3129a3ef0065fd2accdad5352a36', 'local-memory-inference-p1b6-surface-batch-001.json'],
  batch002Successor: ['xion-local-memory-inference-p1b6-surface-effective-current-batch-002-v1', '9701db8902ae99dc5c08cffb176bf9247443884910e3002b77548ac5436157d1', 'local-memory-inference-p1b6-surface-effective-current-batch-002.json'],
  sourceAuditProtocol: ['xion-local-memory-inference-p1b6-source-audit-protocol-v1', '63a2c70c3af608d60fb817f092e16c62986b1b5ba09a6d19300fa34e24582a1d', 'local-memory-inference-p1b6-source-audit-protocol.json'],
  reviewProtocol: ['xion-local-memory-inference-p1b6-targeted-v3-strong-model-review-protocol-v1', '8a48c2df77374659e10dc2f48f16c3c2c40851669eb07b7377fbeeaf4337a892', 'local-memory-inference-p1b6-targeted-v3-strong-model-review-protocol.json'],
});

function fail(message) {
  throw new TypeError(`P1-B6 accepted v3 migration ${message}`);
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

// The 12 flagged rows, each with the unchanged accepted surface it points at.
function derivePopulation(a) {
  const migrate = a.ledgerV3.rows.filter(row => row.humanGoldDiffersFromV3);
  const retired = a.ledgerV3.rows.filter(row => row.status === 'ACCEPTED_ON_RETIRED_SKELETON').map(row => row.itemId);
  if (migrate.length !== EXPECTED.migrate || retired.length !== EXPECTED.retired) fail('flagged populations drifted');
  const labels = new Map(a.v3.candidates.map(row => [row.semanticSkeletonId, row.humanLabel]));
  const rows = migrate.map(row => {
    const artifact = row.itemId.includes('-b001-') ? a.batch001 : a.batch002Successor;
    const item = artifact.items.find(entry => entry.itemId === row.itemId);
    if (!item || item.semanticSkeletonId !== row.semanticSkeletonId) fail(`accepted surface is missing or moved: ${row.itemId}`);
    return { row, artifact, item, v3Label: labels.get(row.semanticSkeletonId) };
  });
  return { rows, retired };
}

const idFor = (namespace, protocolIdentity, itemId) => `${namespace}-${crypto.createHash('sha256')
  .update(`${namespace}\0${protocolIdentity}\0${SOURCES.ledgerV3[1]}\0${itemId}`).digest('hex').slice(0, 16)}`;
const auditRowId = itemId => idFor(AUDIT_ID_NAMESPACE, 'p1b6-source-bundle-completeness-audit-v1', itemId);
const reviewRowId = itemId => idFor(REVIEW_ID_NAMESPACE, 'p1b6-targeted-v3-semantic-realization-review-v1', itemId);

function buildPlan(a) {
  const { rows, retired } = derivePopulation(a);
  return {
    name: PLAN_IDENTITY,
    status: 'PREREGISTERED_NOT_RUN',
    decisionsSource: 'REPOSITORY_OWNER',
    decisionDate: '2026-10-01',
    inputs: Object.fromEntries(Object.entries(SOURCES).map(([key, [identity, rawSha256]]) => [key, { identity, rawSha256 }])),
    retiredSkeletonAccepted: {
      itemIds: retired,
      decision: 'PERMANENTLY_OUT_OF_POOL',
      note: 'acceptance records and HUMAN gold are not rewritten; no replacement is owed',
    },
    migration: {
      rows: rows.map(({ row, v3Label }) => ({
        itemId: row.itemId,
        semanticSkeletonId: row.semanticSkeletonId,
        splitAssignment: row.splitAssignment,
        historicalHumanGold: row.humanGoldLabel,
        v3Reference: v3Label,
      })),
      historicalRecords: 'batch-001 / batch-002 acceptance and HUMAN gold stay immutable; the old label does not carry into the pool',
      surfaces: 'the accepted surface bytes, pinned through the batch-001 and batch-002 successor artifacts; nothing is re-authored',
    },
    gates: {
      sourceAudit: 'a fresh blind source/bundle audit of all 12 under the unchanged protocol; the acceptance records do not bind a per-row audit result, so none is inherited. FAIL / UNCERTAIN rows leave the pool.',
      v3Review: 'a fresh blind v3 strong-model review of all 12 under the unchanged neutral protocol, run in a separate session; results count only for audit-PASS rows.',
      routing: {
        trainDev: 'clean agreement with v3 → CATALOG_STRONG_MODEL_CONFIRMED / PROVISIONAL with the v3 label, and HUMAN calibration of every clean agreement; disagreement / FIX / REJECT / missing → mandatory HUMAN (KEEP matching v3 → HUMAN_ADJUDICATED / ELIGIBLE, anything else → INELIGIBLE)',
        held: 'no HUMAN review, because repeated HELD review stays unopened: clean agreement → CATALOG_STRONG_MODEL_CONFIRMED / PROVISIONAL with the v3 label (the post-selection independent second strong-model review still applies); anything else → INELIGIBLE',
      },
      afterMigration: 'a new ledger version drops the humanGoldDiffersFromV3 flag for migrated rows and re-measures the shortage; any loss is topped up separately',
    },
    authority: {
      sourceAuditRun: false, semanticReviewRun: false, humanReviewRun: false,
      historicalRecordsRewritten: false, acceptancePerformed: false, finalSelectionPerformed: false, trainingOrEvaluationOccurred: false,
    },
  };
}

function buildAuditPacket(a) {
  const { rows } = derivePopulation(a);
  return {
    name: AUDIT_PACKET_IDENTITY,
    status: 'BLIND_SOURCE_AUDIT_PACKET_NOT_RUN',
    sourceAuditProtocol: { identity: a.sourceAuditProtocol.protocolIdentity, rawSha256: SOURCES.sourceAuditProtocol[1] },
    rendererIdentity: RENDERER_IDENTITY,
    freshnessContract: 'Every row requires a fresh judgment; no historical source-audit result carries forward.',
    rows: rows.map(({ artifact, item }) => ({
      auditRowId: auditRowId(item.itemId),
      sourceEpisode: { turns: artifact.sourceEpisodes.find(row => row.sourceEpisodeId === item.sourceEpisodeId).turns.map(turn => ({ ...turn })) },
      selectedBundle: renderCandidateBundle(artifact, item),
    })).sort((left, right) => (left.auditRowId < right.auditRowId ? -1 : 1)),
  };
}

function buildReviewPacket(a) {
  const { rows } = derivePopulation(a);
  return {
    name: REVIEW_PACKET_IDENTITY,
    status: 'BLIND_STRONG_MODEL_REVIEW_PACKET_NOT_RUN',
    reviewProtocol: { identity: a.reviewProtocol.protocolIdentity, sha256: SOURCES.reviewProtocol[1] },
    rendererIdentity: RENDERER_IDENTITY,
    rows: rows.map(({ artifact, item }) => ({
      reviewRowId: reviewRowId(item.itemId),
      selectedBundle: renderCandidateBundle(artifact, item),
    })).sort((left, right) => (left.reviewRowId < right.reviewRowId ? -1 : 1)),
  };
}

const artifactBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');

function main(argv = process.argv.slice(2)) {
  const a = verifySources(loadSources());
  if (argv.length === 0) {
    fs.writeFileSync(path.join(ROOT, 'fixtures', PLAN_FILE), artifactBytes(buildPlan(a)));
    process.stdout.write(`Wrote fixtures/${PLAN_FILE}\n`);
    return 0;
  }
  const build = { '--audit-packet': buildAuditPacket, '--review-packet': buildReviewPacket }[argv[0]];
  if (argv.length !== 2 || !build) throw new Error('Usage: [--audit-packet <out> | --review-packet <out>]');
  if (fs.existsSync(argv[1])) throw new Error(`Existing output will not be overwritten: ${argv[1]}`);
  const bytes = artifactBytes(build(a));
  fs.writeFileSync(argv[1], bytes, { flag: 'wx' });
  process.stdout.write(`Built ${argv[1]}\nPacket raw SHA-256: ${sha256RawBytes(bytes)}\n`);
  return 0;
}

module.exports = {
  PLAN_FILE, SOURCES, artifactBytes, auditRowId, buildAuditPacket, buildPlan, buildReviewPacket,
  derivePopulation, loadSources, main, reviewRowId, verifySources,
};

if (require.main === module) process.exit(main());
