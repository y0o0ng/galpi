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

const RECEIPT_FILE = 'local-memory-inference-p1b6-accepted-v3-migration-review-attempt-001.json';
const HUMAN_PACKET_IDENTITY = 'xion-local-memory-inference-p1b6-accepted-v3-migration-human-review-packet-v1';
const HUMAN_ID_NAMESPACE = 'p1b6-mig-hreview';
const HUMAN_PROTOCOL = Object.freeze({
  identity: 'xion-local-memory-inference-p1b6-accepted-v3-migration-human-review-protocol-v1',
  rawSha256: '68b4f39d78fecc81f69c4c710a6002f740c8931bed9369e556d83435dd83db9b',
  fixture: 'local-memory-inference-p1b6-accepted-v3-migration-human-review-protocol.json',
});

function parseResults(rawBytes, key, known, validRow) {
  const parsed = JSON.parse(Buffer.from(rawBytes).toString('utf8'));
  if (!parsed || JSON.stringify(Object.keys(parsed)) !== '["results"]' || !Array.isArray(parsed.results)) {
    fail('result artifact must be an object whose only key is results');
  }
  if (JSON.stringify(parsed.results.map(row => row?.[key]).toSorted()) !== JSON.stringify([...known].toSorted())) {
    fail(`${key} result rows are not exactly the packet rows`);
  }
  for (const row of parsed.results) if (!validRow(row)) fail(`result row is malformed: ${row[key]}`);
  return new Map(parsed.results.map(row => [row[key], row]));
}

// Applies the plan's preregistered routing to the fresh audit and v3 review results.
function reconcile(auditBytes, reviewBytes, a = verifySources(loadSources())) {
  const { rows } = derivePopulation(a);
  const audits = parseResults(auditBytes, 'auditRowId', rows.map(({ item }) => auditRowId(item.itemId)), row =>
    JSON.stringify(Object.keys(row).toSorted()) === '["auditRowId","disposition","reason"]'
    && ['PASS', 'FAIL', 'UNCERTAIN'].includes(row.disposition) && typeof row.reason === 'string' && row.reason.trim() !== '');
  const reviews = parseResults(reviewBytes, 'reviewRowId', rows.map(({ item }) => reviewRowId(item.itemId)), row =>
    JSON.stringify(Object.keys(row).toSorted()) === '["decision","disposition","reason","reviewRowId"]'
    && typeof row.reason === 'string' && row.reason.trim() !== ''
    && (row.disposition === 'KEEP' ? ['CLEAR', 'ESCALATE'].includes(row.decision)
      : ['FIX', 'REJECT'].includes(row.disposition) && row.decision === null));
  const routed = rows.map(({ row, v3Label }) => {
    const auditRow = audits.get(auditRowId(row.itemId));
    const review = reviews.get(reviewRowId(row.itemId));
    const held = row.splitAssignment === 'FINAL_HELD_OUT';
    let route;
    if (auditRow.disposition !== 'PASS') route = 'EXCLUDED_AUDIT';
    else if (review.disposition !== 'KEEP') route = review.disposition;
    else route = review.decision === v3Label ? 'CLEAN_AGREEMENT' : 'DECISION_DISAGREEMENT';
    const clean = route === 'CLEAN_AGREEMENT';
    return {
      itemId: row.itemId,
      semanticSkeletonId: row.semanticSkeletonId,
      splitAssignment: row.splitAssignment,
      v3Reference: v3Label,
      auditDisposition: auditRow.disposition,
      auditReason: auditRow.reason,
      reviewDisposition: review.disposition,
      reviewDecision: review.decision,
      reviewReason: review.reason,
      route,
      ...(clean ? { provenance: 'CATALOG_STRONG_MODEL_CONFIRMED', eligibility: 'PROVISIONAL', human: held ? null : 'calibration' }
        : route === 'EXCLUDED_AUDIT' || held ? { provenance: null, eligibility: 'INELIGIBLE', human: null }
          : { provenance: null, eligibility: 'PENDING_MANDATORY_HUMAN', human: 'mandatory' }),
    };
  });
  return {
    name: 'xion-local-memory-inference-p1b6-accepted-v3-migration-review-attempt-001-receipt-v1',
    status: 'COMPLETE_RECONCILED_AGAINST_SEMANTIC_CONTRACT_V3',
    plan: { identity: PLAN_IDENTITY, rawSha256: sha256RawBytes(artifactBytes(buildPlan(a))) },
    auditPacketSha256: sha256RawBytes(artifactBytes(buildAuditPacket(a))),
    reviewPacketSha256: sha256RawBytes(artifactBytes(buildReviewPacket(a))),
    rawResultArtifacts: {
      sourceAudit: { filename: 'p1b6-mig-source-audit-results.json', sha256: sha256RawBytes(auditBytes), committed: false },
      v3Review: { filename: 'p1b6-mig-v3-review-results.json', sha256: sha256RawBytes(reviewBytes), committed: false },
    },
    executionProvenance: {
      evidenceBasis: 'REPORTED_BY_REPOSITORY_OWNER',
      reportedModel: 'Claude Opus 5.5',
      session: 'two fresh Claude Code CLI sessions started in the home directory, one per packet, each given only its protocol and packet paths',
    },
    summary: {
      total: routed.length,
      auditPass: routed.filter(row => row.auditDisposition === 'PASS').length,
      cleanAgreements: routed.filter(row => row.route === 'CLEAN_AGREEMENT').length,
      mandatoryHuman: routed.filter(row => row.human === 'mandatory').length,
      calibration: routed.filter(row => row.human === 'calibration').length,
      heldIneligible: routed.filter(row => row.splitAssignment === 'FINAL_HELD_OUT' && row.eligibility === 'INELIGIBLE').length,
    },
    rows: routed,
    authority: {
      humanReviewPerformed: false, historicalRecordsRewritten: false, acceptancePerformed: false,
      referenceLabelFreezePerformed: false, finalSelectionPerformed: false, trainingOrEvaluationOccurred: false,
    },
  };
}

const humanRowId = itemId => idFor(HUMAN_ID_NAMESPACE, HUMAN_PROTOCOL.identity, itemId);

// Mandatory and calibration rows of the committed receipt, one blind packet; bundles must equal
// the strong-model packet's.
function buildHumanPacket(receipt, a = verifySources(loadSources())) {
  const { rows } = derivePopulation(a);
  const members = new Set(receipt.rows.filter(row => row.human).map(row => row.itemId));
  const strong = new Map(buildReviewPacket(a).rows.map(row => [row.reviewRowId, row.selectedBundle]));
  return {
    name: HUMAN_PACKET_IDENTITY,
    status: 'BLIND_HUMAN_REVIEW_PACKET_NOT_RUN',
    reviewProtocol: { identity: HUMAN_PROTOCOL.identity, rawSha256: HUMAN_PROTOCOL.rawSha256 },
    rendererIdentity: RENDERER_IDENTITY,
    rows: rows.filter(({ item }) => members.has(item.itemId)).map(({ artifact, item }) => {
      const selectedBundle = renderCandidateBundle(artifact, item);
      if (selectedBundle !== strong.get(reviewRowId(item.itemId))) fail(`bundle differs from the strong-model packet: ${item.itemId}`);
      return { reviewRowId: humanRowId(item.itemId), selectedBundle };
    }).sort((left, right) => (left.reviewRowId < right.reviewRowId ? -1 : 1)),
  };
}

const HUMAN_RECEIPT_FILE = 'local-memory-inference-p1b6-accepted-v3-migration-human-review-attempt-001.json';

// Preregistered HUMAN semantics; the owner closed every mismatch as a current-realization
// failure (2026-10-01): no catalog change, no relabel.
function routeHuman(role, v3Reference, row) {
  const prefix = role === 'mandatory' ? 'MANDATORY' : 'CALIBRATION';
  if (row.disposition !== 'KEEP') return { outcome: `${prefix}_${row.disposition}`, provenance: null, eligibility: 'INELIGIBLE' };
  if (row.decision !== v3Reference) return { outcome: `${prefix}_DECISION_MISMATCH`, provenance: null, eligibility: 'INELIGIBLE' };
  return role === 'mandatory'
    ? { outcome: 'MANDATORY_MATCH', provenance: 'HUMAN_ADJUDICATED', eligibility: 'ELIGIBLE' }
    : { outcome: 'CALIBRATION_MATCH', provenance: 'CATALOG_STRONG_MODEL_CONFIRMED', eligibility: 'PROVISIONAL' };
}

function buildHumanReceipt(rawResultBytes, reviewDate, receipt, a = verifySources(loadSources())) {
  const packet = buildHumanPacket(receipt, a);
  const results = parseResults(rawResultBytes, 'reviewRowId', packet.rows.map(row => row.reviewRowId), row =>
    JSON.stringify(Object.keys(row).toSorted()) === '["decision","disposition","reason","reviewRowId"]'
    && typeof row.reason === 'string' && row.reason.trim() !== ''
    && (row.disposition === 'KEEP' ? ['CLEAR', 'ESCALATE'].includes(row.decision)
      : ['FIX', 'REJECT'].includes(row.disposition) && row.decision === null));
  const rows = receipt.rows.map(row => {
    if (!row.human) {
      return { itemId: row.itemId, splitAssignment: row.splitAssignment, role: null, finalProvenance: row.provenance, finalEligibility: row.eligibility };
    }
    const raw = results.get(humanRowId(row.itemId));
    const routed = routeHuman(row.human, row.v3Reference, raw);
    return {
      itemId: row.itemId,
      splitAssignment: row.splitAssignment,
      role: row.human,
      reviewRowId: raw.reviewRowId,
      v3Reference: row.v3Reference,
      disposition: raw.disposition,
      decision: raw.decision,
      reason: raw.reason,
      outcome: routed.outcome,
      finalProvenance: routed.provenance,
      finalEligibility: routed.eligibility,
    };
  });
  const reviewed = rows.filter(row => row.role);
  return {
    name: 'xion-local-memory-inference-p1b6-accepted-v3-migration-human-review-attempt-001-receipt-v1',
    status: 'COMPLETE_HUMAN_REVIEWED_AGAINST_SEMANTIC_CONTRACT_V3',
    reviewDate,
    reviewProtocol: { identity: HUMAN_PROTOCOL.identity, rawSha256: HUMAN_PROTOCOL.rawSha256 },
    reviewPacket: { identity: HUMAN_PACKET_IDENTITY, sha256: sha256RawBytes(artifactBytes(packet)), rows: packet.rows.length },
    migrationReviewReceipt: { identity: receipt.name, rawSha256: sha256RawBytes(artifactBytes(receipt)) },
    rawResultArtifact: { filename: 'p1b6-mig-human-review-results.json', sha256: sha256RawBytes(rawResultBytes), committed: false },
    reviewer: {
      role: 'repository owner',
      decisionsBy: 'repository owner',
      presentationAid: 'a model presented packet rows and helped format the JSON, and made no judgment (owner-reported: GPT-5.6 sol)',
      independentConfirmation: false,
      limitation: 'The owner made the historical HUMAN judgments on these surfaces, chose the migration and had seen the review summary; row blindness hid only which opaque row was which.',
    },
    ownerClosure: {
      decisionsSource: 'REPOSITORY_OWNER',
      date: reviewDate,
      decision: 'every mismatch is closed as a current-realization failure: INELIGIBLE, no catalog amendment, no relabel, historical records unchanged',
      observation: 'all four cc054a42 rows were KEEP ESCALATE against v3 CLEAR: the owner read the TARGET as the user\'s stance on the attributed proposal, the v3 contract treats the unadopted facet as a given attributed status. The owner kept the v3 contract; any revisit is a separate gate.',
    },
    summary: {
      reviewed: reviewed.length,
      matchingV3: reviewed.filter(row => row.outcome.endsWith('_MATCH')).length,
      migratedIntoPool: rows.filter(row => ['PROVISIONAL', 'ELIGIBLE'].includes(row.finalEligibility)).map(row => row.itemId),
      ineligible: rows.filter(row => row.finalEligibility === 'INELIGIBLE').map(row => row.itemId),
    },
    rows,
    authority: {
      promotedToHumanAdjudicated: rows.some(row => row.finalProvenance === 'HUMAN_ADJUDICATED'),
      catalogAmendedByThisResult: false, historicalRecordsRewritten: false, surfaceAcceptancePerformed: false,
      referenceLabelFreezePerformed: false, finalSelectionPerformed: false, trainingOrEvaluationOccurred: false,
    },
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
  if (argv.length === 4 && argv[0] === '--audit-results' && argv[2] === '--review-results') {
    const output = path.join(ROOT, 'fixtures', RECEIPT_FILE);
    if (fs.existsSync(output)) throw new Error(`Existing output will not be overwritten: ${output}`);
    const receipt = reconcile(fs.readFileSync(argv[1]), fs.readFileSync(argv[3]), a);
    fs.writeFileSync(output, artifactBytes(receipt), { flag: 'wx' });
    process.stdout.write(`Reconciled: ${JSON.stringify(receipt.summary)} -> fixtures/${RECEIPT_FILE}
`);
    return 0;
  }
  if (argv.length === 4 && argv[0] === '--human-results' && argv[2] === '--date') {
    const output = path.join(ROOT, 'fixtures', HUMAN_RECEIPT_FILE);
    if (fs.existsSync(output)) throw new Error(`Existing output will not be overwritten: ${output}`);
    const receipt = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', RECEIPT_FILE)));
    const human = buildHumanReceipt(fs.readFileSync(argv[1]), argv[3], receipt, a);
    fs.writeFileSync(output, artifactBytes(human), { flag: 'wx' });
    process.stdout.write(`Recorded HUMAN result: ${JSON.stringify(human.summary)} -> fixtures/${HUMAN_RECEIPT_FILE}\n`);
    return 0;
  }
  const humanPacket = () => {
    const bytes = fs.readFileSync(path.join(ROOT, 'fixtures', HUMAN_PROTOCOL.fixture));
    if (sha256RawBytes(bytes) !== HUMAN_PROTOCOL.rawSha256) fail('HUMAN protocol bytes are not the pinned artifact');
    return buildHumanPacket(JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', RECEIPT_FILE))), a);
  };
  const build = { '--audit-packet': buildAuditPacket, '--review-packet': buildReviewPacket, '--human-packet': humanPacket }[argv[0]];
  if (argv.length !== 2 || !build) throw new Error('Usage: [--audit-packet <out> | --review-packet <out> | --human-packet <out> | --audit-results <raw> --review-results <raw>]');
  if (fs.existsSync(argv[1])) throw new Error(`Existing output will not be overwritten: ${argv[1]}`);
  const bytes = artifactBytes(build(a));
  fs.writeFileSync(argv[1], bytes, { flag: 'wx' });
  process.stdout.write(`Built ${argv[1]}\nPacket raw SHA-256: ${sha256RawBytes(bytes)}\n`);
  return 0;
}

module.exports = {
  HUMAN_PROTOCOL, HUMAN_RECEIPT_FILE, PLAN_FILE, RECEIPT_FILE, SOURCES, artifactBytes, auditRowId, buildAuditPacket, buildHumanPacket, buildHumanReceipt,
  buildPlan, buildReviewPacket, derivePopulation, humanRowId, loadSources, main, reconcile, reviewRowId, verifySources,
};

if (require.main === module) process.exit(main());
