#!/usr/bin/env node
'use strict';

// P1-B6 semantic contract v3: the successor semantic authority.
//
// Lineage is Exact56 -> v1 -> v2 -> this successor. v3 is derived from the EXACT RAW BYTES of
// v2, which already carry the earlier lineage; v1 and Exact56 are recorded, not rebuilt.
//
// The receipt is the authority for WHICH skeletons change: three v2 amendments are reversed
// (CLEAR -> ESCALATE under the given-status rule) and two non-realizable APPROXIMATION / RANGE
// skeletons are retired and replaced in place by new opaque IDs. This module validates that
// closed set and materializes the catalog. It mutates no historical artifact, moves no surface
// or HUMAN decision onto a replacement skeleton, and performs no acceptance.

const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { artifactBytes, loadFixture } = require('./build-memory-inference-p1b6-skeleton-semantic-contract-v2');

const ROOT = path.resolve(__dirname, '..');
const RECEIPT_IDENTITY =
  'xion-local-memory-inference-p1b6-skeleton-semantic-contract-v3-receipt-v1';
const RECEIPT_FILE = 'local-memory-inference-p1b6-skeleton-semantic-contract-v3-receipt.json';
const V3_IDENTITY = 'xion-local-memory-inference-p1b6-skeleton-effective-current-v3';
const V3_FILE = 'local-memory-inference-p1b6-skeleton-effective-current-v3.json';
const CONTRACT_IDENTITY = 'P1B6_SEMANTIC_CONTRACT_V3';

const V2 = Object.freeze({
  identity: 'xion-local-memory-inference-p1b6-skeleton-effective-current-v2',
  rawSha256: 'f1e780195441246402ca389da188b1f7b8c4970f42fc1e6e3de2f436a3e9377c',
  fixture: 'local-memory-inference-p1b6-skeleton-effective-current-v2.json',
});
const V2_RECEIPT_SHA256 = 'a12063c38eee6245122e655126708c904319b4a7467cf82084acdea17a293344';

const EXPECTED_V2_LABELS = Object.freeze({ CLEAR: 45, ESCALATE: 11 });
const EXPECTED_LABELS = Object.freeze({ CLEAR: 42, ESCALATE: 14 });
const EXPECTED_SPLITS = Object.freeze({ TRAIN: 24, DEV: 16, FINAL_HELD_OUT: 16 });

// The change set is closed. Anything outside it fails closed.
const AMENDED_SKELETON_IDS = Object.freeze([
  'p1b6-sk-2da4e54e6609e34b',
  'p1b6-sk-5269c91fcfb6c2cd',
  'p1b6-sk-b8e64a03d97f251c',
]);
const RETIREMENTS = Object.freeze([
  Object.freeze({ retired: 'p1b6-sk-f58debd8f04f5c60', replacement: 'p1b6-sk-53ab63517113df16' }),
  Object.freeze({ retired: 'p1b6-sk-28736b74c85fcc93', replacement: 'p1b6-sk-0768ea2028f18511' }),
]);
const MIXED_REALIZATION_SKELETON_IDS = Object.freeze([
  'p1b6-sk-5fc872afb058b370',
  'p1b6-sk-be0efa305956d111',
]);
const RETIRED_IDS = RETIREMENTS.map(row => row.retired);
const REPLACEMENT_IDS = RETIREMENTS.map(row => row.replacement);

function fail(message) {
  throw new TypeError(`P1-B6 semantic contract v3 ${message}`);
}

function countBy(rows, field) {
  return rows.reduce((counts, row) => {
    counts[row[field]] = (counts[row[field]] || 0) + 1;
    return counts;
  }, {});
}

const nonEmptyString = value => typeof value === 'string' && value.trim() !== '';
const nonEmptyStrings = (value, min) => Array.isArray(value) && value.length >= min
  && value.every(nonEmptyString);

function loadV2(rawBytes) {
  const bytes = Buffer.from(rawBytes);
  const sha256 = sha256RawBytes(bytes);
  if (sha256 !== V2.rawSha256) fail(`${V2.identity} raw bytes are not the pinned artifact`);
  const parsed = JSON.parse(bytes.toString('utf8'));
  if (parsed.name !== V2.identity) fail(`${V2.identity} identity is invalid`);
  return { parsed, sha256 };
}

function reEncodes(row) {
  return nonEmptyString(row.candidateFocus) && nonEmptyStrings(row.semanticRelations, 2)
    && nonEmptyString(row.interpretationContract);
}

function validateContractV3Receipt(receipt) {
  if (receipt?.name !== RECEIPT_IDENTITY
    || receipt.status !== 'COMPLETE_PROSPECTIVE_SEMANTIC_CONTRACT_SUCCESSION'
    || receipt.contractVersion !== 'v3'
    || receipt.decisionsSource !== 'REPOSITORY_OWNER_SEMANTIC_ADJUDICATION') {
    fail('receipt identity or status is invalid');
  }
  const rule = receipt.interpretationRule;
  if (rule?.identity !== CONTRACT_IDENTITY
    || rule.supersedesProspectively !== 'P1B6_SEMANTIC_CONTRACT_V2'
    || !['clear', 'escalate', 'uncertaintyDistinction', 'targetBoundary', 'pragmaticResolution']
      .every(key => nonEmptyString(rule[key]))
    || JSON.stringify(rule.supersededV2Clauses) !== JSON.stringify(['unknownIsNotAmbiguity'])) {
    fail('receipt does not carry the complete v3 interpretation rule');
  }
  if (receipt.derivationBase?.identity !== V2.identity
    || receipt.derivationBase.rawSha256 !== V2.rawSha256
    || receipt.priorContractReceipt?.rawSha256 !== V2_RECEIPT_SHA256
    || receipt.successorCatalog?.identity !== V3_IDENTITY) {
    fail('receipt provenance bindings are invalid');
  }

  const amendments = receipt.amendments;
  if (!Array.isArray(amendments)
    || JSON.stringify(amendments.map(row => row?.semanticSkeletonId))
      !== JSON.stringify([...AMENDED_SKELETON_IDS])) {
    fail(`receipt must amend exactly ${AMENDED_SKELETON_IDS.join(', ')}`);
  }
  for (const row of amendments) {
    if (row.fromHumanLabel !== 'CLEAR' || row.toHumanLabel !== 'ESCALATE') {
      fail(`amendment ${row.semanticSkeletonId} is not a CLEAR to ESCALATE transition`);
    }
    if (!reEncodes(row)) fail(`amendment ${row.semanticSkeletonId} does not re-encode semantics`);
  }

  const retirements = receipt.retirements;
  if (!Array.isArray(retirements)
    || JSON.stringify(retirements.map(row => [row?.retiredSkeletonId, row?.replacementSkeletonId]))
      !== JSON.stringify(RETIREMENTS.map(row => [row.retired, row.replacement]))) {
    fail('receipt must retire and replace exactly the two approved skeletons');
  }
  for (const row of retirements) {
    if (!/^p1b6-sk-[0-9a-f]{16}$/u.test(row.replacementSkeletonId)
      || row.splitAssignment !== 'TRAIN' || row.boundaryClass !== 'APPROXIMATION / RANGE'
      || row.humanLabel !== 'ESCALATE' || !reEncodes(row)
      || !nonEmptyStrings(row.intendedUnresolvedReadings, 2)
      || row.historicalSurfacesTransferred !== false || row.humanDecisionsTransferred !== false) {
      fail(`retirement of ${row.retiredSkeletonId} is invalid or transfers historical evidence`);
    }
  }

  const mixed = receipt.mixedRealizationEscalateSkeletons;
  if (!Array.isArray(mixed)
    || JSON.stringify(mixed.map(row => row.semanticSkeletonId))
      !== JSON.stringify([...MIXED_REALIZATION_SKELETON_IDS])
    || !mixed.every(row => row.skeletonLabel === 'ESCALATE' && nonEmptyString(row.note))) {
    fail('receipt does not document the mixed-realization ESCALATE skeletons');
  }
  if (!receipt.authority || !Object.keys(receipt.authority).length
    || Object.entries(receipt.authority).some(([, value]) => value !== false)) {
    fail('receipt claims authority it does not have');
  }
  return receipt;
}

function buildEffectiveCurrentV3(rawV2Bytes, rawReceiptBytes) {
  const v2 = loadV2(rawV2Bytes);
  const receipt = validateContractV3Receipt(
    JSON.parse(Buffer.from(rawReceiptBytes).toString('utf8')));
  const receiptSha256 = sha256RawBytes(Buffer.from(rawReceiptBytes));

  const source = v2.parsed.candidates;
  if (JSON.stringify(countBy(source, 'humanLabel')) !== JSON.stringify(EXPECTED_V2_LABELS)) {
    fail('v2 catalog label distribution is not the historical 45 / 11');
  }
  const historicalIds = new Set(source.map(row => row.semanticSkeletonId));
  if (REPLACEMENT_IDS.some(id => historicalIds.has(id))) fail('a replacement ID collides with v2');

  const amendments = new Map(receipt.amendments.map(row => [row.semanticSkeletonId, row]));
  const retirements = new Map(receipt.retirements.map(row => [row.retiredSkeletonId, row]));
  let inherited = 0;
  // Positional: order, split, boundary class and contrast-group slot never move. Only the
  // semantics of an amended row, and the ID plus semantics of a retired row, change.
  const candidates = source.map(row => {
    const change = amendments.get(row.semanticSkeletonId)
      || retirements.get(row.semanticSkeletonId);
    if (!change) {
      inherited += 1;
      return { ...row };
    }
    const retirement = retirements.has(row.semanticSkeletonId);
    if (row.splitAssignment !== change.splitAssignment
      || row.boundaryClass !== change.boundaryClass
      || row.humanLabel !== (retirement ? 'ESCALATE' : change.fromHumanLabel)
      || (retirement && (change.contrastGroupSlot === 'INHERITED')
        !== Object.hasOwn(row, 'contrastGroupId'))) {
      fail(`change for ${row.semanticSkeletonId} does not match the v2 row it replaces`);
    }
    return {
      semanticSkeletonId: retirement ? change.replacementSkeletonId : row.semanticSkeletonId,
      splitAssignment: row.splitAssignment,
      boundaryClass: row.boundaryClass,
      humanLabel: retirement ? change.humanLabel : change.toHumanLabel,
      candidateFocus: change.candidateFocus,
      semanticRelations: [...change.semanticRelations],
      interpretationContract: change.interpretationContract,
      ...(Object.hasOwn(row, 'contrastGroupId') ? { contrastGroupId: row.contrastGroupId } : {}),
    };
  });
  if (inherited !== 51) fail('v3 must inherit exactly 51 skeletons unchanged');

  const ids = candidates.map(row => row.semanticSkeletonId);
  if (new Set(ids).size !== 56 || RETIRED_IDS.some(id => ids.includes(id))) {
    fail('v3 active IDs are not 56 unique IDs free of retired skeletons');
  }
  const labels = countBy(candidates, 'humanLabel');
  if (JSON.stringify(labels) !== JSON.stringify(EXPECTED_LABELS)) {
    fail(`v3 label distribution must be ${JSON.stringify(EXPECTED_LABELS)}`);
  }
  const splits = countBy(candidates, 'splitAssignment');
  if (JSON.stringify(splits) !== JSON.stringify(EXPECTED_SPLITS)) fail('v3 splits drifted');

  return {
    name: V3_IDENTITY,
    status: 'ACTIVE_PROSPECTIVE_SEMANTIC_AUTHORITY',
    supersedes: {
      identity: V2.identity,
      rawSha256: v2.sha256,
      role: 'IMMUTABLE_HISTORICAL_PRIOR_PROSPECTIVE_AUTHORITY_AND_DERIVATION_BASE',
      overwritten: false,
      humanLabelCounts: { ...EXPECTED_V2_LABELS },
    },
    // Earlier lineage is carried from v2's own bytes; neither is a rebuild path.
    historicalLineage: [
      { ...v2.parsed.supersedes, rebuiltFromHere: false },
      { ...v2.parsed.historicalBase },
    ],
    semanticContractReceipt: { identity: RECEIPT_IDENTITY, rawSha256: receiptSha256 },
    interpretationRule: { ...receipt.interpretationRule },
    amendedSkeletonIds: [...AMENDED_SKELETON_IDS],
    retiredSkeletons: RETIREMENTS.map(row => ({
      retiredSkeletonId: row.retired,
      replacementSkeletonId: row.replacement,
      historicalSurfacesTransferred: false,
    })),
    escalateSkeletonIds: candidates.filter(row => row.humanLabel === 'ESCALATE')
      .map(row => row.semanticSkeletonId),
    mixedRealizationEscalateSkeletonIds: [...MIXED_REALIZATION_SKELETON_IDS],
    corpusLabelContract: { ...v2.parsed.corpusLabelContract },
    coverage: {
      total: candidates.length,
      splitCounts: splits,
      humanLabelCounts: labels,
      boundaryClassSplitCounts: v2.parsed.coverage.boundaryClassSplitCounts,
    },
    authority: { ...receipt.authority },
    candidates,
  };
}

function main() {
  const catalog = buildEffectiveCurrentV3(loadFixture(V2.fixture), loadFixture(RECEIPT_FILE));
  const outputPath = path.join(ROOT, 'fixtures', V3_FILE);
  fs.writeFileSync(outputPath, artifactBytes(catalog));
  process.stdout.write(`Built P1-B6 effective-current skeleton catalog v3: ${outputPath}\n`);
  return 0;
}

module.exports = {
  AMENDED_SKELETON_IDS,
  EXPECTED_LABELS,
  EXPECTED_SPLITS,
  MIXED_REALIZATION_SKELETON_IDS,
  RECEIPT_FILE,
  RECEIPT_IDENTITY,
  RETIREMENTS,
  V2,
  V3_FILE,
  V3_IDENTITY,
  buildEffectiveCurrentV3,
  main,
  validateContractV3Receipt,
};

if (require.main === module) process.exit(main());
