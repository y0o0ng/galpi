#!/usr/bin/env node
'use strict';

// P1-B6 semantic contract v2: the successor semantic authority.
//
// Lineage is Exact56 (immutable historical freeze) -> effective-current v1 (the prior
// prospective authority, still committed and still byte-identical) -> this successor. v2 is
// derived from the EXACT RAW BYTES of v1, which already carry the Exact56 lineage; Exact56 is
// retained in provenance but is deliberately not a second, independent rebuild path.
//
// The receipt is the authority for WHICH skeletons are amended and for their replacement
// semantics. This module validates the receipt and materializes the catalog; it invents no
// semantic decision, mutates no historical artifact, and performs no acceptance.

const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');

const ROOT = path.resolve(__dirname, '..');
const RECEIPT_IDENTITY =
  'xion-local-memory-inference-p1b6-skeleton-semantic-contract-v2-receipt-v1';
const RECEIPT_FILE = 'local-memory-inference-p1b6-skeleton-semantic-contract-v2-receipt.json';
const V2_IDENTITY = 'xion-local-memory-inference-p1b6-skeleton-effective-current-v2';
const V2_FILE = 'local-memory-inference-p1b6-skeleton-effective-current-v2.json';
const CONTRACT_IDENTITY = 'P1B6_SEMANTIC_CONTRACT_V2';

// Both historical inputs are pinned by identity AND raw SHA, so hashing whatever happens to be
// on disk can never redefine what "canonical" means.
const V1 = Object.freeze({
  identity: 'xion-local-memory-inference-p1b6-skeleton-effective-current-v1',
  rawSha256: '48490b6e4e1494856ef3268d944da16093c4735d207e07c1fd9e8bbf69df2559',
  fixture: 'local-memory-inference-p1b6-skeleton-effective-current.json',
});
const EXACT56 = Object.freeze({
  identity: 'xion-local-memory-inference-p1b6-skeleton-exact56-v1',
  rawSha256: '772f07bd679a9c98ea65feaa164ec7a9c1f3e3fb33632052ef076f8301999602',
  fixture: 'local-memory-inference-p1b6-skeleton-exact56.json',
});

const EXPECTED_TOTAL = 56;
const EXPECTED_AMENDED = 11;
const EXPECTED_INHERITED = 45;
const EXPECTED_LABELS = Object.freeze({ CLEAR: 45, ESCALATE: 11 });
const EXPECTED_V1_LABELS = Object.freeze({ CLEAR: 34, ESCALATE: 22 });
const EXPECTED_SPLITS = Object.freeze({ TRAIN: 24, DEV: 16, FINAL_HELD_OUT: 16 });
const LABELS = Object.freeze(['CLEAR', 'ESCALATE']);

// The amendment set is closed. A twelfth amendment, a missing one, or a different target fails
// closed rather than silently widening this contract's authority.
const AMENDED_SKELETON_IDS = Object.freeze([
  'p1b6-sk-e7fe317a78077d37',
  'p1b6-sk-66ecb02cbfc40c3c',
  'p1b6-sk-2da4e54e6609e34b',
  'p1b6-sk-5269c91fcfb6c2cd',
  'p1b6-sk-2fa39ece4157b2b8',
  'p1b6-sk-a19bb9e94e9a416b',
  'p1b6-sk-cc054a4227cdafef',
  'p1b6-sk-869c71279b6b8a33',
  'p1b6-sk-aebbf047d6864a35',
  'p1b6-sk-16697b52f83abeba',
  'p1b6-sk-b8e64a03d97f251c',
]);
const SURVIVING_ESCALATE_SKELETON_IDS = Object.freeze([
  'p1b6-sk-5229ea237196499d',
  'p1b6-sk-49e0f357eda8365c',
  'p1b6-sk-9dc48f4b2f10775d',
  'p1b6-sk-5f335bdc1d9d630c',
  'p1b6-sk-59c8f51891ab4996',
  'p1b6-sk-38c426bb2e0bff42',
  'p1b6-sk-135ab77919a554dc',
  'p1b6-sk-5fc872afb058b370',
  'p1b6-sk-be0efa305956d111',
  'p1b6-sk-f58debd8f04f5c60',
  'p1b6-sk-28736b74c85fcc93',
]);
const MIXED_REALIZATION_SKELETON_IDS = Object.freeze([
  'p1b6-sk-5fc872afb058b370',
  'p1b6-sk-be0efa305956d111',
  'p1b6-sk-f58debd8f04f5c60',
  'p1b6-sk-28736b74c85fcc93',
]);
const RETIRED_LABEL_CONTRACTS = Object.freeze([
  'final corpus exactly 190 CLEAR / 190 ESCALATE',
  'per-label DEV minimums',
  'per-label FINAL_HELD_OUT minimums',
]);

const CANDIDATE_KEYS = Object.freeze([
  'semanticSkeletonId', 'splitAssignment', 'boundaryClass', 'humanLabel',
  'candidateFocus', 'semanticRelations', 'contrastGroupId',
]);

function fail(message) {
  throw new TypeError(`P1-B6 semantic contract v2 ${message}`);
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

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function loadPinned(pinned, rawBytes) {
  const bytes = rawBytes === undefined
    ? fs.readFileSync(path.join(ROOT, 'fixtures', pinned.fixture)) : Buffer.from(rawBytes);
  const sha256 = sha256RawBytes(bytes);
  if (sha256 !== pinned.rawSha256) {
    fail(`${pinned.identity} raw bytes are not the pinned artifact`);
  }
  const parsed = JSON.parse(bytes.toString('utf8'));
  if (parsed.name !== pinned.identity) fail(`${pinned.identity} identity is invalid`);
  return { parsed, sha256 };
}

// The receipt decides the semantics; this only proves it is the approved, closed one.
function validateContractV2Receipt(receipt, v1Sha256, exact56Sha256) {
  if (receipt?.name !== RECEIPT_IDENTITY
    || receipt.status !== 'COMPLETE_PROSPECTIVE_SEMANTIC_CONTRACT_SUCCESSION'
    || receipt.contractVersion !== 'v2') fail('receipt identity or status is invalid');

  if (receipt.interpretationRule?.identity !== CONTRACT_IDENTITY
    || !nonEmptyString(receipt.interpretationRule.clear)
    || !nonEmptyString(receipt.interpretationRule.escalate)
    || !nonEmptyString(receipt.interpretationRule.unknownIsNotAmbiguity)
    || !nonEmptyString(receipt.interpretationRule.noAddedPremise)) {
    fail('receipt does not carry the complete v2 interpretation rule');
  }

  if (receipt.derivationBase?.identity !== V1.identity
    || receipt.derivationBase.rawSha256 !== v1Sha256
    || receipt.historicalExact56?.identity !== EXACT56.identity
    || receipt.historicalExact56.rawSha256 !== exact56Sha256
    || receipt.historicalExact56.rebuiltFromHere !== false
    || receipt.successorCatalog?.identity !== V2_IDENTITY) {
    fail('receipt provenance bindings are invalid');
  }

  const amendments = receipt.amendments;
  if (!Array.isArray(amendments) || amendments.length !== EXPECTED_AMENDED) {
    fail(`receipt must authorize exactly ${EXPECTED_AMENDED} amendments`);
  }
  const seen = new Set();
  for (const amendment of amendments) {
    const id = amendment?.semanticSkeletonId;
    if (!AMENDED_SKELETON_IDS.includes(id)) {
      fail(`receipt amends an unauthorized skeleton: ${String(id)}`);
    }
    if (seen.has(id)) fail(`receipt amends a skeleton twice: ${id}`);
    seen.add(id);
    if (amendment.fromHumanLabel !== 'ESCALATE' || amendment.toHumanLabel !== 'CLEAR') {
      fail(`amendment ${id} is not an ESCALATE to CLEAR transition`);
    }
    // Flipping the label alone is not an amendment; the row must re-encode the contract.
    if (!nonEmptyString(amendment.candidateFocus)
      || !Array.isArray(amendment.semanticRelations)
      || amendment.semanticRelations.length < 2
      || !amendment.semanticRelations.every(nonEmptyString)
      || !nonEmptyString(amendment.interpretationContract)) {
      fail(`amendment ${id} does not re-encode candidateFocus and semanticRelations`);
    }
  }
  if (seen.size !== AMENDED_SKELETON_IDS.length) fail('receipt is missing an authorized amendment');

  if (JSON.stringify(receipt.survivingEscalateSkeletonIds)
    !== JSON.stringify([...SURVIVING_ESCALATE_SKELETON_IDS])) {
    fail('receipt surviving ESCALATE set does not match the approved set');
  }
  const mixed = receipt.mixedRealizationEscalateSkeletons;
  if (!Array.isArray(mixed)
    || JSON.stringify(mixed.map(row => row.semanticSkeletonId))
      !== JSON.stringify([...MIXED_REALIZATION_SKELETON_IDS])
    || !mixed.every(row => row.skeletonLabel === 'ESCALATE' && nonEmptyString(row.note))) {
    fail('receipt does not document the mixed-realization ESCALATE skeletons');
  }

  if (JSON.stringify(receipt.corpusLabelContract?.retiredProspectively)
    !== JSON.stringify([...RETIRED_LABEL_CONTRACTS])
    || receipt.corpusLabelContract.replacedWithNewRatio !== false
    || !nonEmptyString(receipt.corpusLabelContract.currentRule)) {
    fail('receipt does not retire the label-balancing contracts as approved');
  }

  for (const [key, value] of Object.entries(receipt.authority || {})) {
    if (value !== false) fail(`receipt claims authority it does not have: ${key}`);
  }
  if (receipt.authority?.historicalEffectiveCurrentV1Overwritten !== false
    || receipt.authority?.datasetAcceptancePerformed !== false) {
    fail('receipt authority block is incomplete');
  }
  return new Map(amendments.map(row => [row.semanticSkeletonId, row]));
}

function buildEffectiveCurrentV2(rawV1Bytes, rawReceiptBytes, rawExact56Bytes) {
  const v1 = loadPinned(V1, rawV1Bytes);
  const exact56 = loadPinned(EXACT56, rawExact56Bytes);
  const receipt = JSON.parse(Buffer.from(rawReceiptBytes).toString('utf8'));
  const receiptSha256 = sha256RawBytes(Buffer.from(rawReceiptBytes));
  const amendments = validateContractV2Receipt(receipt, v1.sha256, exact56.sha256);

  const source = v1.parsed.candidates;
  if (!Array.isArray(source) || source.length !== EXPECTED_TOTAL) {
    fail(`v1 catalog must carry exactly ${EXPECTED_TOTAL} candidates`);
  }
  if (JSON.stringify(countBy(source, 'humanLabel')) !== JSON.stringify(EXPECTED_V1_LABELS)) {
    fail('v1 catalog label distribution is not the historical 34 / 22');
  }

  // Order, IDs, splits, boundary classes and contrast groups are inherited positionally. Only
  // the four semantic fields of an authorized row may differ.
  let amendedCount = 0;
  let inheritedCount = 0;
  const candidates = source.map(row => {
    const amendment = amendments.get(row.semanticSkeletonId);
    if (!amendment) {
      inheritedCount += 1;
      return { ...row };
    }
    if (row.humanLabel !== amendment.fromHumanLabel
      || row.splitAssignment !== amendment.splitAssignment
      || row.boundaryClass !== amendment.boundaryClass) {
      fail(`amendment ${row.semanticSkeletonId} does not match the v1 row it amends`);
    }
    amendedCount += 1;
    return {
      semanticSkeletonId: row.semanticSkeletonId,
      splitAssignment: row.splitAssignment,
      boundaryClass: row.boundaryClass,
      humanLabel: amendment.toHumanLabel,
      candidateFocus: amendment.candidateFocus,
      semanticRelations: [...amendment.semanticRelations],
      interpretationContract: amendment.interpretationContract,
      ...(Object.hasOwn(row, 'contrastGroupId') ? { contrastGroupId: row.contrastGroupId } : {}),
    };
  });

  if (amendedCount !== EXPECTED_AMENDED || inheritedCount !== EXPECTED_INHERITED) {
    fail(`v2 must amend ${EXPECTED_AMENDED} and inherit ${EXPECTED_INHERITED} skeletons`);
  }
  assertNoStructuralDrift(source, candidates);

  const labels = countBy(candidates, 'humanLabel');
  if (JSON.stringify(labels) !== JSON.stringify(EXPECTED_LABELS)) {
    fail(`v2 label distribution must be ${JSON.stringify(EXPECTED_LABELS)}`);
  }
  const splits = countBy(candidates, 'splitAssignment');
  for (const [split, expected] of Object.entries(EXPECTED_SPLITS)) {
    if (splits[split] !== expected) fail(`v2 split ${split} drifted`);
  }
  const escalate = candidates.filter(row => row.humanLabel === 'ESCALATE')
    .map(row => row.semanticSkeletonId).sort();
  if (JSON.stringify(escalate) !== JSON.stringify([...SURVIVING_ESCALATE_SKELETON_IDS].sort())) {
    fail('v2 ESCALATE set does not match the approved surviving set');
  }

  return {
    name: V2_IDENTITY,
    status: 'ACTIVE_PROSPECTIVE_SEMANTIC_AUTHORITY',
    supersedes: {
      identity: V1.identity,
      rawSha256: v1.sha256,
      role: 'IMMUTABLE_HISTORICAL_PRIOR_PROSPECTIVE_AUTHORITY_AND_DERIVATION_BASE',
      overwritten: false,
      humanLabelCounts: { ...EXPECTED_V1_LABELS },
    },
    historicalBase: {
      identity: EXACT56.identity,
      rawSha256: exact56.sha256,
      role: 'IMMUTABLE_HISTORICAL_FREEZE_AND_PROVENANCE_BASE',
      rebuiltFromHere: false,
    },
    semanticContractReceipt: { identity: RECEIPT_IDENTITY, rawSha256: receiptSha256 },
    interpretationRule: { ...receipt.interpretationRule },
    amendedSkeletonIds: [...AMENDED_SKELETON_IDS],
    survivingEscalateSkeletonIds: [...SURVIVING_ESCALATE_SKELETON_IDS],
    mixedRealizationEscalateSkeletonIds: [...MIXED_REALIZATION_SKELETON_IDS],
    corpusLabelContract: {
      retiredProspectively: [...RETIRED_LABEL_CONTRACTS],
      replacedWithNewRatio: false,
      currentRule: receipt.corpusLabelContract.currentRule,
    },
    coverage: {
      total: candidates.length,
      splitCounts: splits,
      humanLabelCounts: labels,
      boundaryClassSplitCounts: v1.parsed.coverage.boundaryClassSplitCounts,
    },
    authority: { ...receipt.authority },
    candidates,
  };
}

// Everything except the four semantic fields of an amended row must be positionally identical.
function assertNoStructuralDrift(source, candidates) {
  if (source.length !== candidates.length) fail('v2 candidate count drifted');
  source.forEach((row, index) => {
    const built = candidates[index];
    for (const key of ['semanticSkeletonId', 'splitAssignment', 'boundaryClass']) {
      if (row[key] !== built[key]) fail(`v2 ${key} drifted at index ${index}`);
    }
    if (Object.hasOwn(row, 'contrastGroupId') !== Object.hasOwn(built, 'contrastGroupId')
      || row.contrastGroupId !== built.contrastGroupId) {
      fail(`v2 contrastGroupId drifted at index ${index}`);
    }
    const extra = Object.keys(built)
      .filter(key => !CANDIDATE_KEYS.includes(key) && key !== 'interpretationContract');
    if (extra.length) fail(`v2 candidate carries unexpected fields: ${extra.join(', ')}`);
  });
}

function loadFixture(name) {
  return fs.readFileSync(path.join(ROOT, 'fixtures', name));
}

function main() {
  const catalog = buildEffectiveCurrentV2(loadFixture(V1.fixture), loadFixture(RECEIPT_FILE),
    loadFixture(EXACT56.fixture));
  const outputPath = path.join(ROOT, 'fixtures', V2_FILE);
  fs.writeFileSync(outputPath, artifactBytes(catalog));
  process.stdout.write(`Built P1-B6 effective-current skeleton catalog v2: ${outputPath}\n`);
  return 0;
}

module.exports = {
  AMENDED_SKELETON_IDS,
  CONTRACT_IDENTITY,
  EXACT56,
  EXPECTED_LABELS,
  EXPECTED_SPLITS,
  MIXED_REALIZATION_SKELETON_IDS,
  RECEIPT_FILE,
  RECEIPT_IDENTITY,
  RETIRED_LABEL_CONTRACTS,
  SURVIVING_ESCALATE_SKELETON_IDS,
  V1,
  V2_FILE,
  V2_IDENTITY,
  artifactBytes,
  buildEffectiveCurrentV2,
  loadFixture,
  main,
  validateContractV2Receipt,
};

if (require.main === module) process.exit(main());
