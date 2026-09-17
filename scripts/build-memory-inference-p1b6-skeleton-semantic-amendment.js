#!/usr/bin/env node
'use strict';

// Targeted P1-B6 skeleton semantic amendment.
//
// The historical Exact56 freeze stays immutable and remains the provenance base. This module
// applies exactly the amendments the committed receipt authorizes and materializes the
// effective-current catalog, which is the prospective semantic authority. The receipt is the
// authority for WHICH amendments were approved and for their replacement semantics; this
// module validates it rather than inventing semantic decisions.

const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { EXACT56_SHA256 } = require('../lib/memory-inference-p1b6-surfaces');

const RECEIPT_IDENTITY = 'xion-local-memory-inference-p1b6-skeleton-semantic-amendment-receipt-v1';
const EFFECTIVE_IDENTITY = 'xion-local-memory-inference-p1b6-skeleton-effective-current-v1';
const EXACT56_IDENTITY = 'xion-local-memory-inference-p1b6-skeleton-exact56-v1';
const INTERPRETATION_RULE = 'CONSERVATIVE_PRAGMATIC_INTERPRETATION';
const AMENDED_SKELETON_IDS = Object.freeze([
  'p1b6-sk-155420007d75f36f',
  'p1b6-sk-8dd28ec6b22a18ad',
]);
const PRESERVED_SKELETON_IDS = Object.freeze(['p1b6-sk-2fa39ece4157b2b8']);
const ROUTING_CORRECTION_ITEM_IDS = Object.freeze([
  'p1b6-item-b002-059',
  'p1b6-item-b002-063',
]);
const EXPECTED_TOTAL = 56;
const EXPECTED_LABELS = Object.freeze({ CLEAR: 34, ESCALATE: 22 });
const EXPECTED_HISTORICAL_LABELS = Object.freeze({ CLEAR: 32, ESCALATE: 24 });
const EXPECTED_SPLITS = Object.freeze({ TRAIN: 24, DEV: 16, FINAL_HELD_OUT: 16 });
// Every historical input is pinned by identity AND raw SHA. The builder verifies the actual
// bytes against these constants, so hashing whatever happens to be on disk can never define
// what "canonical" means, and coordinated drift of a source plus its receipt SHA fails closed.
const HISTORICAL_SOURCES = Object.freeze({
  adjudicationReceipt: Object.freeze({
    label: 'pragmatic adjudication receipt',
    identity: 'xion-local-memory-inference-p1b6-pragmatic-adjudication-batch-002-receipt-v1',
    rawSha256: 'cf05f5073fc30f19078aab1a0c081b59face607a041387bf5421ffa2af8bbdaa',
    fixture: 'local-memory-inference-p1b6-pragmatic-adjudication-batch-002-receipt.json',
  }),
  batch002Effective: Object.freeze({
    label: 'batch-002 effective HUMAN artifact',
    identity: 'xion-local-memory-inference-p1b6-primary-human-effective-current-batch-002-v2',
    rawSha256: 'a96fc01393c79057d292cf10b565589e7448b86289eb52b8cd1c63657af2ed05',
    fixture: 'local-memory-inference-p1b6-primary-human-effective-current-batch-002-v2.json',
  }),
  batch001Effective: Object.freeze({
    label: 'batch-001 effective HUMAN artifact',
    identity: 'xion-local-memory-inference-p1b6-primary-human-effective-current-batch-001-v1',
    rawSha256: '44832509f04ffb81a0772e9fda9adcbbea43305315a5d05948819b2c845b162a',
    fixture: 'local-memory-inference-p1b6-primary-human-effective-current-batch-001.json',
  }),
});

function fail(message) {
  throw new TypeError(`P1-B6 skeleton semantic amendment ${message}`);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function artifactBytes(artifact) {
  return Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
}

function countBy(rows, field) {
  return rows.reduce((counts, row) => {
    counts[row[field]] = (counts[row[field]] || 0) + 1;
    return counts;
  }, {});
}

function boundarySplitCounts(rows) {
  const counts = {};
  for (const row of rows) {
    counts[row.boundaryClass] ??= {};
    counts[row.boundaryClass][row.splitAssignment] =
      (counts[row.boundaryClass][row.splitAssignment] || 0) + 1;
  }
  return counts;
}

// The receipt is committed data. Everything it authorizes is checked against the frozen
// expectations here, so an edited receipt cannot widen the amendment silently.
function verifyHistoricalSource(key, rawBytes) {
  const pinned = HISTORICAL_SOURCES[key];
  if (!Buffer.isBuffer(rawBytes) && !ArrayBuffer.isView(rawBytes)) {
    fail(`${pinned.label} bytes were not supplied`);
  }
  if (sha256RawBytes(rawBytes) !== pinned.rawSha256) {
    fail(`${pinned.label} bytes are not the canonical historical evidence`);
  }
  const artifact = JSON.parse(Buffer.from(rawBytes).toString('utf8'));
  if (artifact.name !== pinned.identity) {
    fail(`${pinned.label} identity is not canonical`);
  }
  return artifact;
}

function validateAmendmentReceipt(rawReceiptBytes, rawExact56Bytes, historicalSources) {
  if (sha256RawBytes(rawExact56Bytes) !== EXACT56_SHA256) {
    fail('historical exact56 bytes are invalid');
  }
  if (JSON.parse(Buffer.from(rawExact56Bytes).toString('utf8')).name !== EXACT56_IDENTITY) {
    fail('historical exact56 identity is not canonical');
  }
  if (!historicalSources || typeof historicalSources !== 'object') {
    fail('historical source bytes were not supplied');
  }
  for (const key of Object.keys(HISTORICAL_SOURCES)) {
    verifyHistoricalSource(key, historicalSources[key]);
  }
  const receipt = JSON.parse(Buffer.from(rawReceiptBytes).toString('utf8'));
  if (!exactKeys(receipt, [
    'name', 'status', 'interpretationRule', 'historicalExact56',
    'historicalPragmaticAdjudicationReceipt', 'effectiveHumanDecisionArtifacts',
    'effectiveCurrentSkeletonCatalog', 'summary', 'amendments', 'preserved',
    'routingCorrections', 'routingCorrectionRationale', 'authority',
  ]) || receipt.name !== RECEIPT_IDENTITY
    || receipt.status !== 'COMPLETE_TARGETED_SEMANTIC_AMENDMENT'
    || receipt.interpretationRule !== INTERPRETATION_RULE
    || receipt.historicalExact56.identity !== EXACT56_IDENTITY
    || receipt.historicalExact56.rawSha256 !== EXACT56_SHA256
    || receipt.historicalPragmaticAdjudicationReceipt.identity
      !== HISTORICAL_SOURCES.adjudicationReceipt.identity
    || receipt.historicalPragmaticAdjudicationReceipt.rawSha256
      !== HISTORICAL_SOURCES.adjudicationReceipt.rawSha256
    || receipt.effectiveHumanDecisionArtifacts.batch002.identity
      !== HISTORICAL_SOURCES.batch002Effective.identity
    || receipt.effectiveHumanDecisionArtifacts.batch002.rawSha256
      !== HISTORICAL_SOURCES.batch002Effective.rawSha256
    || receipt.effectiveHumanDecisionArtifacts.batch001.identity
      !== HISTORICAL_SOURCES.batch001Effective.identity
    || receipt.effectiveHumanDecisionArtifacts.batch001.rawSha256
      !== HISTORICAL_SOURCES.batch001Effective.rawSha256
    || receipt.effectiveCurrentSkeletonCatalog.identity !== EFFECTIVE_IDENTITY
    || JSON.stringify(receipt.summary)
      !== JSON.stringify({ amendedSkeletons: 2, preservedSkeletons: 1, routingCorrections: 2 })) {
    fail('receipt does not bind to the canonical historical inputs');
  }

  // Authority: this step records a semantic decision and nothing else.
  if (!exactKeys(receipt.authority, [
    'humanDecisionsAltered', 'historicalExact56BytesAltered',
    'historicalPragmaticRoutingAltered', 'surfacesRepaired', 'datasetAcceptancePerformed',
    'humanGoldFrozen', 'heldRepeatedReviewOpened', 'trainingOccurred', 'decisionsSource',
  ]) || receipt.authority.decisionsSource !== 'REPOSITORY_OWNER_SEMANTIC_ADJUDICATION'
    || Object.entries(receipt.authority)
      .some(([key, value]) => key !== 'decisionsSource' && value !== false)) {
    fail('receipt claims authority it does not have');
  }

  const historical = new Map(JSON.parse(Buffer.from(rawExact56Bytes).toString('utf8'))
    .candidates.map(row => [row.semanticSkeletonId, row]));
  const amendedIds = receipt.amendments.map(row => row.semanticSkeletonId)
    .sort((left, right) => left < right ? -1 : 1);
  if (receipt.amendments.length !== AMENDED_SKELETON_IDS.length
    || JSON.stringify(amendedIds) !== JSON.stringify([...AMENDED_SKELETON_IDS])) {
    fail('receipt does not amend exactly the two authorized skeletons');
  }
  for (const amendment of receipt.amendments) {
    const base = historical.get(amendment.semanticSkeletonId);
    if (!exactKeys(amendment, [
      'semanticSkeletonId', 'splitAssignment', 'boundaryClass', 'fromHumanLabel',
      'toHumanLabel', 'candidateFocus', 'semanticRelations', 'interpretationContract',
    ]) || !base
      || amendment.splitAssignment !== base.splitAssignment
      || amendment.boundaryClass !== base.boundaryClass
      || amendment.fromHumanLabel !== base.humanLabel
      || amendment.toHumanLabel !== 'CLEAR'
      || typeof amendment.candidateFocus !== 'string' || !amendment.candidateFocus
      || !Array.isArray(amendment.semanticRelations) || !amendment.semanticRelations.length
      || amendment.semanticRelations.some(entry => typeof entry !== 'string' || !entry)
      || typeof amendment.interpretationContract !== 'string') {
      fail(`amendment is invalid or drifts from its frozen base: ${amendment.semanticSkeletonId}`);
    }
  }

  const preservedIds = receipt.preserved.map(row => row.semanticSkeletonId);
  if (JSON.stringify(preservedIds) !== JSON.stringify([...PRESERVED_SKELETON_IDS])
    || receipt.preserved.some(row => row.amended !== false
      || row.humanLabel !== historical.get(row.semanticSkeletonId)?.humanLabel)) {
    fail('receipt does not explicitly preserve the unamended skeleton');
  }

  const routingIds = receipt.routingCorrections.map(row => row.itemId)
    .sort((left, right) => left < right ? -1 : 1);
  if (JSON.stringify(routingIds) !== JSON.stringify([...ROUTING_CORRECTION_ITEM_IDS])
    || receipt.routingCorrections.some(row => !exactKeys(row, [
      'itemId', 'semanticSkeletonId', 'historicalOutcome', 'currentOutcome',
      'plannedMinimumRepairConcept', 'repairPerformed',
    ]) || row.historicalOutcome !== 'SKELETON_SEMANTICS_NEEDS_REVISION'
      || row.currentOutcome !== 'SURFACE_COLLAPSES_AMBIGUITY'
      || row.semanticSkeletonId !== PRESERVED_SKELETON_IDS[0]
      || row.repairPerformed !== false)) {
    fail('receipt does not record exactly the two surface routing corrections');
  }
  return receipt;
}

function buildEffectiveCurrentSkeletonCatalog(rawExact56Bytes, rawReceiptBytes,
  historicalSources) {
  const receipt = validateAmendmentReceipt(rawReceiptBytes, rawExact56Bytes, historicalSources);
  const exact56 = JSON.parse(Buffer.from(rawExact56Bytes).toString('utf8'));
  const amendments = new Map(receipt.amendments.map(row => [row.semanticSkeletonId, row]));

  // Order, IDs, splits, boundaries and contrast groups are carried through untouched; only the
  // amendable semantic fields of the authorized rows are replaced.
  const candidates = exact56.candidates.map(row => {
    const amendment = amendments.get(row.semanticSkeletonId);
    if (!amendment) return row;
    return {
      ...row,
      humanLabel: amendment.toHumanLabel,
      candidateFocus: amendment.candidateFocus,
      semanticRelations: [...amendment.semanticRelations],
    };
  });

  const changed = candidates.filter((row, index) =>
    JSON.stringify(row) !== JSON.stringify(exact56.candidates[index]));
  const labelCounts = countBy(candidates, 'humanLabel');
  if (candidates.length !== EXPECTED_TOTAL
    || changed.length !== AMENDED_SKELETON_IDS.length
    || JSON.stringify(candidates.map(row => row.semanticSkeletonId))
      !== JSON.stringify(exact56.candidates.map(row => row.semanticSkeletonId))
    || candidates.some((row, index) => {
      const base = exact56.candidates[index];
      return row.splitAssignment !== base.splitAssignment
        || row.boundaryClass !== base.boundaryClass
        || row.contrastGroupId !== base.contrastGroupId
        || Object.keys(row).length !== Object.keys(base).length;
    })
    || changed.some(row => !amendments.has(row.semanticSkeletonId))
    || JSON.stringify(labelCounts) !== JSON.stringify(EXPECTED_LABELS)
    || JSON.stringify(countBy(candidates, 'splitAssignment')) !== JSON.stringify(EXPECTED_SPLITS)
    || JSON.stringify(boundarySplitCounts(candidates))
      !== JSON.stringify(boundarySplitCounts(exact56.candidates))) {
    fail('effective-current catalog drifted from the authorized amendment');
  }
  for (const skeletonId of PRESERVED_SKELETON_IDS) {
    const before = exact56.candidates.find(row => row.semanticSkeletonId === skeletonId);
    const after = candidates.find(row => row.semanticSkeletonId === skeletonId);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      fail(`preserved skeleton was modified: ${skeletonId}`);
    }
  }

  return {
    name: EFFECTIVE_IDENTITY,
    status: 'ACTIVE_PROSPECTIVE_SEMANTIC_AUTHORITY',
    historicalBase: {
      identity: exact56.name,
      rawSha256: EXACT56_SHA256,
      role: 'IMMUTABLE_HISTORICAL_FREEZE_AND_PROVENANCE_BASE',
      humanLabelCounts: EXPECTED_HISTORICAL_LABELS,
    },
    semanticAmendmentReceipt: {
      identity: receipt.name,
      rawSha256: sha256RawBytes(rawReceiptBytes),
    },
    interpretationRule: INTERPRETATION_RULE,
    amendedSkeletonIds: changed.map(row => row.semanticSkeletonId),
    preservedSkeletonIds: [...PRESERVED_SKELETON_IDS],
    coverage: {
      total: candidates.length,
      splitCounts: countBy(candidates, 'splitAssignment'),
      humanLabelCounts: labelCounts,
      boundaryClassSplitCounts: boundarySplitCounts(candidates),
    },
    authority: {
      historicalExact56Superseded: false,
      humanDecisionsAltered: false,
      surfacesRepaired: false,
      datasetAcceptancePerformed: false,
      humanGoldFrozen: false,
      trainingOccurred: false,
    },
    candidates,
  };
}

// Impact is reported, never written back onto a HUMAN artifact.
function reconcileAgainstCatalog(catalog, batch, effectiveRows) {
  const labels = new Map(catalog.candidates.map(row => [row.semanticSkeletonId, row.humanLabel]));
  const skeletonOf = new Map(batch.items.map(item => [item.itemId, item.semanticSkeletonId]));
  const mismatches = [];
  let matchCount = 0;
  for (const row of effectiveRows) {
    const label = labels.get(skeletonOf.get(row.itemId));
    if (!label) fail(`an effective row has no catalog skeleton: ${row.itemId}`);
    if (row.decision === label) matchCount += 1; else mismatches.push(row.itemId);
  }
  mismatches.sort((left, right) => left < right ? -1 : 1);
  return { matchCount, mismatchCount: mismatches.length, mismatches };
}

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', name));
}

function loadHistoricalSources() {
  return Object.fromEntries(Object.entries(HISTORICAL_SOURCES)
    .map(([key, pinned]) => [key, loadFixture(pinned.fixture)]));
}

function main() {
  const rawExact56 = loadFixture('local-memory-inference-p1b6-skeleton-exact56.json');
  const rawReceipt = loadFixture('local-memory-inference-p1b6-skeleton-semantic-amendment-receipt.json');
  const catalog = buildEffectiveCurrentSkeletonCatalog(rawExact56, rawReceipt,
    loadHistoricalSources());
  const outputPath = path.join(__dirname, '..', 'fixtures',
    'local-memory-inference-p1b6-skeleton-effective-current.json');
  fs.writeFileSync(outputPath, artifactBytes(catalog));
  process.stdout.write(`Built P1-B6 effective-current skeleton catalog: ${outputPath}\n`);
  return 0;
}

module.exports = {
  AMENDED_SKELETON_IDS,
  EFFECTIVE_IDENTITY,
  EXPECTED_LABELS,
  HISTORICAL_SOURCES,
  EXPECTED_SPLITS,
  PRESERVED_SKELETON_IDS,
  RECEIPT_IDENTITY,
  ROUTING_CORRECTION_ITEM_IDS,
  artifactBytes,
  buildEffectiveCurrentSkeletonCatalog,
  loadHistoricalSources,
  main,
  reconcileAgainstCatalog,
  validateAmendmentReceipt,
};

if (require.main === module) process.exit(main());
