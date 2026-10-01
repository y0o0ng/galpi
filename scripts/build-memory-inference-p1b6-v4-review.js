#!/usr/bin/env node
'use strict';

// P1-B6 semantic contract v4 pool review: plan, and two blind packets.
//
// Owner decisions (2026-10-01): v4 applies the user-centered TARGET. Two checks follow over the
// reviewed pool of ledger v5, each run in its own fresh separate session:
//   - a scope review of every pool row: is the marked TARGET about the user?
//   - a v4 semantic review of the pool rows on the two skeletons whose label v4 changed
//     (43016ef6, cc054a42); their v3 labels and review results are not carried over.
// Populations come from ledger v5 and the v4 catalog, never from a supplied list. Routing is
// preregistered in the plan, which never reaches a packet. This step reviews, accepts and trains
// nothing.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { RENDERER_IDENTITY } = require('../lib/memory-inference-p1b6-surfaces');
const { renderCandidateBundle } = require('./build-memory-inference-p1b6-surface-repair-source-audit-packet');

const ROOT = path.resolve(__dirname, '..');
const PLAN_IDENTITY = 'xion-local-memory-inference-p1b6-v4-pool-review-plan-v1';
const PLAN_FILE = 'local-memory-inference-p1b6-v4-pool-review-plan.json';
const SCOPE_NAMESPACE = 'p1b6-v4-scope';
const REVIEW_NAMESPACE = 'p1b6-v4-smreview';
const CALIBRATION_HASH_DOMAIN = 'p1b6-v4-review-calibration-v1';
const CALIBRATION_FRACTION = 0.2;
const EXPECTED = Object.freeze({ pool: 386, v4Review: 19 });

const pin = (identity, rawSha256, fixture) => Object.freeze([identity, rawSha256, fixture]);
const SOURCES = Object.freeze({
  ledgerV5: pin('xion-local-memory-inference-p1b6-reviewed-pool-ledger-v5', '81580af10cc0c826bda0c4f387774ae045a6677ec003c08e94729e2a9e0ff730', 'local-memory-inference-p1b6-reviewed-pool-ledger-v5.json'),
  v4: pin('xion-local-memory-inference-p1b6-skeleton-effective-current-v4', 'a53debe1b065e9bbd5a94f32036f8ac2586eae72b2f5a6bdf9fae0a93dfed194', 'local-memory-inference-p1b6-skeleton-effective-current-v4.json'),
  scopeProtocol: pin('xion-local-memory-inference-p1b6-user-centered-scope-review-protocol-v1', '38eef07a36b05b449e7482b9bea17aeff2a39130e0ddce47c5a44583ebe3dfe7', 'local-memory-inference-p1b6-user-centered-scope-review-protocol.json'),
  reviewProtocol: pin('xion-local-memory-inference-p1b6-v4-strong-model-review-protocol-v1', '229d0026867aa5ed33a21cbc6984236ca98ad1a4ec90d2710cb9fdada5fba652', 'local-memory-inference-p1b6-v4-strong-model-review-protocol.json'),
  batch001: pin('xion-local-memory-inference-p1b6-surface-batch-001-v1', '2a4605f5550118754c315e26700aef1be96a3129a3ef0065fd2accdad5352a36', 'local-memory-inference-p1b6-surface-batch-001.json'),
  batch002: pin('xion-local-memory-inference-p1b6-surface-effective-current-batch-002-v1', '9701db8902ae99dc5c08cffb176bf9247443884910e3002b77548ac5436157d1', 'local-memory-inference-p1b6-surface-effective-current-batch-002.json'),
  batch003: pin('xion-local-memory-inference-p1b6-surface-batch-003-v1', '90b453c3680bccaa537fd0d23db74bbc303882e1a35a2ddcea0b75b013fcaa68', 'local-memory-inference-p1b6-surface-batch-003.json'),
  repairCandidate: pin('xion-local-memory-inference-p1b6-surface-repair-candidate-batch-003-v1', '8f6254946eef8d8d0920485bde431ca137a83577a5060889f3676b8857b4aa9b', 'local-memory-inference-p1b6-surface-repair-candidate-batch-003.json'),
  anchorCandidate: pin('xion-local-memory-inference-p1b6-surface-anchor-repair-candidate-batch-003-v1', '19eea01def0a05c32c1ceb236fa97305e7b29822c9e56b70cc0331f3a873599f', 'local-memory-inference-p1b6-surface-anchor-repair-candidate-batch-003.json'),
  tb1Candidate: pin('xion-local-memory-inference-p1b6-surface-target-boundary-candidate-v1', '5a4253506a9a9885118781c68cdcc407d91b6497b4b1af2105a675332ef8a7f5', 'local-memory-inference-p1b6-surface-target-boundary-candidate.json'),
  rp1Candidate: pin('xion-local-memory-inference-p1b6-surface-v3-replacement-candidate-v1', '8c3ff152cfb42abfe4a327e4ba84b833904946c7400332ab5e560980a9af47cc', 'local-memory-inference-p1b6-surface-v3-replacement-candidate.json'),
  batch004: pin('xion-local-memory-inference-p1b6-surface-batch-004-v1', 'f640198f9d472c00046b8cb22083407b12887534bf0544cd808620691c5bc0c1', 'local-memory-inference-p1b6-surface-batch-004.json'),
  batch005: pin('xion-local-memory-inference-p1b6-surface-batch-005-v1', '98f28dfe844cf07e766c9d0cfb91c00f02c0a79ea6c67e845d70f14f088b2713', 'local-memory-inference-p1b6-surface-batch-005.json'),
  batch006: pin('xion-local-memory-inference-p1b6-surface-batch-006-v1', 'c058b752ca9a353ffc10475cf9d74796e3682f4084cfd06b7164851922724e64', 'local-memory-inference-p1b6-surface-batch-006.json'),
});
// Ledger `source` → the artifact that holds the current surface.
const SURFACE_BY_SOURCE = Object.freeze({
  'batch-001 acceptance': 'batch001',
  'batch-002 acceptance': 'batch002',
  'batch-003': 'batch003',
  [SOURCES.repairCandidate[0]]: 'repairCandidate',
  [SOURCES.anchorCandidate[0]]: 'anchorCandidate',
  [SOURCES.tb1Candidate[0]]: 'tb1Candidate',
  [SOURCES.rp1Candidate[0]]: 'rp1Candidate',
  'batch-004': 'batch004',
  'batch-005': 'batch005',
  'batch-006': 'batch006',
});

function fail(message) {
  throw new TypeError(`P1-B6 v4 pool review ${message}`);
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

// Every pool row with its current surface; the v4 subset is every pool row on a label-changed skeleton.
function derivePopulations(a) {
  const pool = a.ledgerV5.rows.filter(row => row.inPool).map(row => {
    const key = SURFACE_BY_SOURCE[row.source] ?? fail(`unknown ledger source: ${row.source}`);
    const item = a[key].items.find(entry => entry.itemId === row.itemId);
    if (!item || item.semanticSkeletonId !== row.semanticSkeletonId) fail(`pool surface is missing or moved: ${row.itemId}`);
    return { row, artifact: a[key], item };
  });
  const changed = new Set(a.v4.labelChangedSkeletonIds);
  const v4Review = pool.filter(({ row }) => changed.has(row.semanticSkeletonId));
  if (pool.length !== EXPECTED.pool || v4Review.length !== EXPECTED.v4Review) fail('populations drifted');
  return { pool, v4Review };
}

const opaqueId = (namespace, protocol, itemId) => `${namespace}-${crypto.createHash('sha256')
  .update(`${namespace}\0${protocol}\0${SOURCES.ledgerV5[1]}\0${itemId}`).digest('hex').slice(0, 16)}`;
const scopeRowId = itemId => opaqueId(SCOPE_NAMESPACE, SOURCES.scopeProtocol[0], itemId);
const reviewRowId = itemId => opaqueId(REVIEW_NAMESPACE, SOURCES.reviewProtocol[0], itemId);

function buildPlan(a) {
  const { pool, v4Review } = derivePopulations(a);
  const labels = new Map(a.v4.candidates.map(row => [row.semanticSkeletonId, row.humanLabel]));
  const tally = list => list.reduce((acc, { row }) => {
    acc[row.splitAssignment] = (acc[row.splitAssignment] ?? 0) + 1;
    return acc;
  }, {});
  return {
    name: PLAN_IDENTITY,
    status: 'PREREGISTERED_NOT_RUN',
    decisionsSource: 'REPOSITORY_OWNER',
    decisionDate: '2026-10-01',
    inputs: Object.fromEntries(Object.entries(SOURCES).map(([key, [identity, rawSha256]]) => [key, { identity, rawSha256 }])),
    scopeReview: {
      rows: pool.length,
      bySplit: tally(pool),
      routing: {
        IN_SCOPE: 'unchanged',
        trainDevOutOfScopeOrUncertain: 'owner HUMAN scope check; confirmed out of scope → INELIGIBLE, otherwise unchanged',
        heldOutOfScopeOrUncertain: 'INELIGIBLE with no HUMAN step, because repeated HELD review stays unopened',
      },
    },
    v4Review: {
      rows: v4Review.map(({ row }) => ({ itemId: row.itemId, semanticSkeletonId: row.semanticSkeletonId, splitAssignment: row.splitAssignment, v4Reference: labels.get(row.semanticSkeletonId) })),
      carriedOver: 'nothing: no v3 label, review result or HUMAN decision counts as a v4 judgment',
      routing: {
        cleanAgreement: 'KEEP matching the v4 reference → CATALOG_STRONG_MODEL_CONFIRMED / PROVISIONAL with the v4 label',
        otherwise: 'disagreement / FIX / REJECT / missing → mandatory owner HUMAN (KEEP matching v4 → HUMAN_ADJUDICATED / ELIGIBLE, anything else → INELIGIBLE)',
        calibration: {
          fraction: CALIBRATION_FRACTION,
          size: Math.round(v4Review.length * CALIBRATION_FRACTION),
          rule: 'the clean agreements with the lowest sha256 of the hash domain, a NUL separator and the itemId; all of them if fewer exist',
          hashDomain: CALIBRATION_HASH_DOMAIN,
          matchingKeepSemantics: 'stays CATALOG_STRONG_MODEL_CONFIRMED / PROVISIONAL; not promoted',
        },
      },
      combinedWithScope: 'a row stays in the pool only if it also survives the scope review',
    },
    afterReview: 'a new ledger version applies both results under v4, and the shortage is re-measured; deterministic selection waits for it',
    authority: {
      reviewRun: false, humanReviewRun: false, historicalRecordsRewritten: false,
      acceptancePerformed: false, finalSelectionPerformed: false, trainingOrEvaluationOccurred: false,
    },
  };
}

function buildScopePacket(a) {
  const { pool } = derivePopulations(a);
  return {
    name: 'xion-local-memory-inference-p1b6-user-centered-scope-review-packet-v1',
    status: 'BLIND_SCOPE_REVIEW_PACKET_NOT_RUN',
    reviewProtocol: { identity: a.scopeProtocol.protocolIdentity, sha256: SOURCES.scopeProtocol[1] },
    rendererIdentity: RENDERER_IDENTITY,
    rows: pool.map(({ artifact, item }) => ({ reviewRowId: scopeRowId(item.itemId), selectedBundle: renderCandidateBundle(artifact, item) }))
      .sort((left, right) => (left.reviewRowId < right.reviewRowId ? -1 : 1)),
  };
}

function buildReviewPacket(a) {
  const { v4Review } = derivePopulations(a);
  return {
    name: 'xion-local-memory-inference-p1b6-v4-strong-model-review-packet-v1',
    status: 'BLIND_STRONG_MODEL_REVIEW_PACKET_NOT_RUN',
    reviewProtocol: { identity: a.reviewProtocol.protocolIdentity, sha256: SOURCES.reviewProtocol[1] },
    rendererIdentity: RENDERER_IDENTITY,
    rows: v4Review.map(({ artifact, item }) => ({ reviewRowId: reviewRowId(item.itemId), selectedBundle: renderCandidateBundle(artifact, item) }))
      .sort((left, right) => (left.reviewRowId < right.reviewRowId ? -1 : 1)),
  };
}

const artifactBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');

const RECEIPT_FILE = 'local-memory-inference-p1b6-v4-pool-review-attempt-001.json';
const HUMAN_NAMESPACE = 'p1b6-v4-hreview';
const HUMAN_PROTOCOL = Object.freeze({
  identity: 'xion-local-memory-inference-p1b6-v4-human-review-protocol-v1',
  rawSha256: 'ee09adb967ec1cc35adfbc6ccfd695b801ee8b71a60dc377f2ff4aac84d42acb',
  fixture: 'local-memory-inference-p1b6-v4-human-review-protocol.json',
});
// Owner decisions after seeing the results (2026-10-01).
const OWNER_DECISIONS = Object.freeze({
  date: '2026-10-01',
  scopeReviewWithoutProtocolFile: 'kept: the scope reviewer ran before the protocol file reached the working checkout and judged from the prompt, which carried the same IN / OUT / UNCERTAIN definitions; flagged TRAIN / DEV rows still get the owner check',
  nonRealizationSkeletonIds: Object.freeze(['p1b6-sk-43016ef6da889a87']),
  nonRealization: 'every historical surface on 43016ef6 marks the quoted content itself as the TARGET, which the v4 contract says is not a realization of the redefined skeleton; they leave the pool without HUMAN review, replacing the preregistered mandatory-HUMAN route for these rows',
});

function parseResults(rawBytes, ids, validRow) {
  const parsed = JSON.parse(Buffer.from(rawBytes).toString('utf8'));
  if (!parsed || JSON.stringify(Object.keys(parsed)) !== '["results"]' || !Array.isArray(parsed.results)) {
    fail('result artifact must be an object whose only key is results');
  }
  if (JSON.stringify(parsed.results.map(row => row?.reviewRowId).toSorted()) !== JSON.stringify([...ids].toSorted())) {
    fail('result rows are not exactly the packet rows');
  }
  for (const row of parsed.results) if (!validRow(row)) fail(`result row is malformed: ${row.reviewRowId}`);
  return new Map(parsed.results.map(row => [row.reviewRowId, row]));
}

const validSemantic = row => typeof row.reason === 'string' && row.reason.trim() !== ''
  && (row.disposition === 'KEEP' ? ['CLEAR', 'ESCALATE'].includes(row.decision)
    : ['FIX', 'REJECT'].includes(row.disposition) && row.decision === null);
const calibrationHash = itemId => crypto.createHash('sha256').update(`${CALIBRATION_HASH_DOMAIN}\0${itemId}`).digest('hex');

// Applies the plan's routing and the owner decisions to the scope and v4 review results.
function reconcile(scopeBytes, reviewBytes, a = verifySources(loadSources())) {
  const { pool, v4Review } = derivePopulations(a);
  const labels = new Map(a.v4.candidates.map(row => [row.semanticSkeletonId, row.humanLabel]));
  const scope = parseResults(scopeBytes, pool.map(({ item }) => scopeRowId(item.itemId)), row =>
    JSON.stringify(Object.keys(row).toSorted()) === '["reason","reviewRowId","scope"]'
    && ['IN_SCOPE', 'OUT_OF_SCOPE', 'UNCERTAIN'].includes(row.scope) && typeof row.reason === 'string' && row.reason.trim() !== '');
  const review = parseResults(reviewBytes, v4Review.map(({ item }) => reviewRowId(item.itemId)), row =>
    JSON.stringify(Object.keys(row).toSorted()) === '["decision","disposition","reason","reviewRowId"]' && validSemantic(row));
  const nonRealization = new Set(OWNER_DECISIONS.nonRealizationSkeletonIds);
  const v4Items = new Set(v4Review.map(({ item }) => item.itemId));
  const rows = pool.map(({ row }) => {
    const s = scope.get(scopeRowId(row.itemId));
    const held = row.splitAssignment === 'FINAL_HELD_OUT';
    const entry = { itemId: row.itemId, semanticSkeletonId: row.semanticSkeletonId, splitAssignment: row.splitAssignment, scope: s.scope, scopeReason: s.reason };
    if (v4Items.has(row.itemId)) {
      const r = review.get(reviewRowId(row.itemId));
      Object.assign(entry, { v4Reference: labels.get(row.semanticSkeletonId), reviewDisposition: r.disposition, reviewDecision: r.decision, reviewReason: r.reason });
      if (nonRealization.has(row.semanticSkeletonId)) return { ...entry, outcome: 'OWNER_NON_REALIZATION', eligibility: 'INELIGIBLE', human: null };
      const clean = r.disposition === 'KEEP' && r.decision === entry.v4Reference;
      return { ...entry, outcome: clean ? 'V4_CLEAN_AGREEMENT' : 'V4_DISAGREEMENT', eligibility: clean ? 'PROVISIONAL' : 'PENDING_MANDATORY_HUMAN', human: clean ? 'pending-calibration' : 'mandatory' };
    }
    if (s.scope === 'IN_SCOPE') return { ...entry, outcome: 'IN_SCOPE', eligibility: 'UNCHANGED', human: null };
    return held ? { ...entry, outcome: 'HELD_SCOPE_FLAGGED', eligibility: 'INELIGIBLE', human: null }
      : { ...entry, outcome: 'SCOPE_FLAGGED', eligibility: 'PENDING_HUMAN_SCOPE_CHECK', human: 'scope' };
  });
  const clean = rows.filter(row => row.human === 'pending-calibration');
  const size = Math.round(v4Review.length * CALIBRATION_FRACTION);
  const calibration = new Set(clean.map(row => row.itemId)
    .toSorted((x, y) => (calibrationHash(x) < calibrationHash(y) ? -1 : 1)).slice(0, size));
  for (const row of rows) if (row.human === 'pending-calibration') row.human = calibration.has(row.itemId) ? 'calibration' : null;
  const count = predicate => rows.filter(predicate).length;
  return {
    name: 'xion-local-memory-inference-p1b6-v4-pool-review-attempt-001-receipt-v1',
    status: 'COMPLETE_RECONCILED_AGAINST_SEMANTIC_CONTRACT_V4',
    plan: { identity: PLAN_IDENTITY, rawSha256: sha256RawBytes(artifactBytes(buildPlan(a))) },
    scopePacketSha256: sha256RawBytes(artifactBytes(buildScopePacket(a))),
    reviewPacketSha256: sha256RawBytes(artifactBytes(buildReviewPacket(a))),
    rawResultArtifacts: {
      scope: { filename: 'p1b6-v4-scope-review-results.json', sha256: sha256RawBytes(scopeBytes), committed: false },
      v4Review: { filename: 'p1b6-v4-review-results.json', sha256: sha256RawBytes(reviewBytes), committed: false },
    },
    executionProvenance: {
      evidenceBasis: 'REPORTED_BY_REPOSITORY_OWNER',
      reportedModel: 'Claude Opus 5.5',
      session: 'two fresh Claude Code CLI sessions started in the home directory, one per packet',
      limitation: 'the scope session ran before its protocol file reached the working checkout and judged from the prompt\'s inline definitions',
    },
    ownerDecisions: OWNER_DECISIONS,
    summary: {
      pool: rows.length,
      scope: { IN_SCOPE: count(row => row.scope === 'IN_SCOPE'), OUT_OF_SCOPE: count(row => row.scope === 'OUT_OF_SCOPE'), UNCERTAIN: count(row => row.scope === 'UNCERTAIN') },
      heldScopeIneligible: count(row => row.outcome === 'HELD_SCOPE_FLAGGED'),
      nonRealizationIneligible: count(row => row.outcome === 'OWNER_NON_REALIZATION'),
      v4CleanAgreements: clean.length,
      human: { scope: count(row => row.human === 'scope'), mandatory: count(row => row.human === 'mandatory'), calibration: count(row => row.human === 'calibration') },
    },
    rows,
    authority: { humanReviewPerformed: false, historicalRecordsRewritten: false, acceptancePerformed: false, finalSelectionPerformed: false, trainingOrEvaluationOccurred: false },
  };
}

const humanRowId = itemId => opaqueId(HUMAN_NAMESPACE, HUMAN_PROTOCOL.identity, itemId);

// Every row the receipt routes to the owner, one blind packet; each row gets the same two questions.
function buildHumanPacket(receipt, a = verifySources(loadSources())) {
  const { pool } = derivePopulations(a);
  const members = new Set(receipt.rows.filter(row => row.human).map(row => row.itemId));
  return {
    name: 'xion-local-memory-inference-p1b6-v4-human-review-packet-v1',
    status: 'BLIND_HUMAN_REVIEW_PACKET_NOT_RUN',
    reviewProtocol: { identity: HUMAN_PROTOCOL.identity, rawSha256: HUMAN_PROTOCOL.rawSha256 },
    rendererIdentity: RENDERER_IDENTITY,
    rows: pool.filter(({ item }) => members.has(item.itemId))
      .map(({ artifact, item }) => ({ reviewRowId: humanRowId(item.itemId), selectedBundle: renderCandidateBundle(artifact, item) }))
      .sort((left, right) => (left.reviewRowId < right.reviewRowId ? -1 : 1)),
  };
}

function main(argv = process.argv.slice(2)) {
  const a = verifySources(loadSources());
  if (argv.length === 0) {
    fs.writeFileSync(path.join(ROOT, 'fixtures', PLAN_FILE), artifactBytes(buildPlan(a)));
    process.stdout.write(`Wrote fixtures/${PLAN_FILE}\n`);
    return 0;
  }
  if (argv.length === 4 && argv[0] === '--scope-results' && argv[2] === '--review-results') {
    const output = path.join(ROOT, 'fixtures', RECEIPT_FILE);
    if (fs.existsSync(output)) throw new Error(`Existing output will not be overwritten: ${output}`);
    const receipt = reconcile(fs.readFileSync(argv[1]), fs.readFileSync(argv[3]), a);
    fs.writeFileSync(output, artifactBytes(receipt), { flag: 'wx' });
    process.stdout.write(`Reconciled: ${JSON.stringify(receipt.summary)} -> fixtures/${RECEIPT_FILE}\n`);
    return 0;
  }
  const humanPacket = () => {
    if (sha256RawBytes(fs.readFileSync(path.join(ROOT, 'fixtures', HUMAN_PROTOCOL.fixture))) !== HUMAN_PROTOCOL.rawSha256) {
      fail('HUMAN protocol bytes are not the pinned artifact');
    }
    return buildHumanPacket(JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', RECEIPT_FILE))), a);
  };
  const build = { '--scope-packet': buildScopePacket, '--review-packet': buildReviewPacket, '--human-packet': humanPacket }[argv[0]];
  if (argv.length !== 2 || !build) throw new Error('Usage: [--scope-packet <out> | --review-packet <out> | --human-packet <out> | --scope-results <raw> --review-results <raw>]');
  if (fs.existsSync(argv[1])) throw new Error(`Existing output will not be overwritten: ${argv[1]}`);
  const bytes = artifactBytes(build(a));
  fs.writeFileSync(argv[1], bytes, { flag: 'wx' });
  process.stdout.write(`Built ${argv[1]}\nPacket raw SHA-256: ${sha256RawBytes(bytes)}\n`);
  return 0;
}

module.exports = {
  CALIBRATION_HASH_DOMAIN, HUMAN_PROTOCOL, OWNER_DECISIONS, PLAN_FILE, RECEIPT_FILE, SOURCES, artifactBytes, buildHumanPacket,
  buildPlan, buildReviewPacket, buildScopePacket, derivePopulations, humanRowId, loadSources, main, reconcile, reviewRowId,
  scopeRowId, verifySources,
};

if (require.main === module) process.exit(main());
