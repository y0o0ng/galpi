#!/usr/bin/env node
'use strict';

// P1-B6 semantic contract v4: the user-centered successor semantic authority.
//
// Lineage is Exact56 -> v1 -> v2 -> v3 -> this successor. v4 is derived from the EXACT RAW BYTES
// of v3, which already carry the earlier lineage. The receipt applies the owner's user-centered
// TARGET clarification: the interpretation rule drops attribution as a given status, 43016ef6 and
// cc054a42 move to ESCALATE, and 714725ee is re-encoded with its label kept. This module validates
// that closed set and materializes the catalog. It mutates no historical artifact, moves no
// surface or review result onto a changed skeleton, and performs no acceptance.

const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { artifactBytes, loadFixture } = require('./build-memory-inference-p1b6-skeleton-semantic-contract-v2');

const ROOT = path.resolve(__dirname, '..');
const RECEIPT_IDENTITY = 'xion-local-memory-inference-p1b6-skeleton-semantic-contract-v4-receipt-v1';
const RECEIPT_FILE = 'local-memory-inference-p1b6-skeleton-semantic-contract-v4-receipt.json';
const V4_IDENTITY = 'xion-local-memory-inference-p1b6-skeleton-effective-current-v4';
const V4_FILE = 'local-memory-inference-p1b6-skeleton-effective-current-v4.json';
const CONTRACT_IDENTITY = 'P1B6_SEMANTIC_CONTRACT_V4';

const V3 = Object.freeze({
  identity: 'xion-local-memory-inference-p1b6-skeleton-effective-current-v3',
  rawSha256: '89a48264d6b09710f976a4ab85235ff161cf81ff44896e37553d5dc7753c65b9',
  fixture: 'local-memory-inference-p1b6-skeleton-effective-current-v3.json',
});
const V3_RECEIPT_SHA256 = '10f8a10eb3325b86c9d9282fc951ee53b2037918c4258c89a7694822df9a98e1';

const EXPECTED_V3_LABELS = Object.freeze({ CLEAR: 42, ESCALATE: 14 });
const EXPECTED_LABELS = Object.freeze({ CLEAR: 40, ESCALATE: 16 });

// The change set is closed. Anything outside it fails closed.
const CHANGES = Object.freeze([
  Object.freeze({ id: 'p1b6-sk-43016ef6da889a87', from: 'CLEAR', to: 'ESCALATE' }),
  Object.freeze({ id: 'p1b6-sk-cc054a4227cdafef', from: 'CLEAR', to: 'ESCALATE' }),
  Object.freeze({ id: 'p1b6-sk-714725eea477a631', from: 'CLEAR', to: 'CLEAR' }),
]);
const LABEL_CHANGED_SKELETON_IDS = Object.freeze(CHANGES.filter(row => row.from !== row.to).map(row => row.id));

function fail(message) {
  throw new TypeError(`P1-B6 semantic contract v4 ${message}`);
}

const countBy = (rows, field) => rows.reduce((counts, row) => {
  counts[row[field]] = (counts[row[field]] || 0) + 1;
  return counts;
}, {});
const nonEmptyString = value => typeof value === 'string' && value.trim() !== '';

function validateReceipt(receipt) {
  if (receipt?.name !== RECEIPT_IDENTITY || receipt.status !== 'COMPLETE_PROSPECTIVE_SEMANTIC_CONTRACT_SUCCESSION'
    || receipt.contractVersion !== 'v4' || receipt.decisionsSource !== 'REPOSITORY_OWNER_SEMANTIC_ADJUDICATION') {
    fail('receipt identity or status is invalid');
  }
  const rule = receipt.interpretationRule;
  if (rule?.identity !== CONTRACT_IDENTITY || rule.supersedesProspectively !== 'P1B6_SEMANTIC_CONTRACT_V3'
    || !['userCenteredTarget', 'clear', 'escalate', 'uncertaintyDistinction', 'targetBoundary', 'pragmaticResolution']
      .every(key => nonEmptyString(rule[key]))
    || !nonEmptyString(rule.retainedV2Clauses?.noAddedPremise) || /attributed/u.test(rule.clear)) {
    fail('receipt does not carry the complete user-centered v4 interpretation rule');
  }
  if (receipt.derivationBase?.identity !== V3.identity || receipt.derivationBase.rawSha256 !== V3.rawSha256
    || receipt.priorContractReceipt?.rawSha256 !== V3_RECEIPT_SHA256 || receipt.successorCatalog?.identity !== V4_IDENTITY) {
    fail('receipt provenance bindings are invalid');
  }
  if (JSON.stringify(receipt.amendments?.map(row => [row.semanticSkeletonId, row.fromHumanLabel, row.toHumanLabel]))
    !== JSON.stringify(CHANGES.map(row => [row.id, row.from, row.to]))) {
    fail('receipt must amend exactly the approved three skeletons');
  }
  for (const row of receipt.amendments) {
    if (!nonEmptyString(row.candidateFocus) || !Array.isArray(row.semanticRelations) || row.semanticRelations.length < 2
      || !row.semanticRelations.every(nonEmptyString) || !nonEmptyString(row.interpretationContract)) {
      fail(`amendment ${row.semanticSkeletonId} does not re-encode semantics`);
    }
  }
  if (!Array.isArray(receipt.retirements) || receipt.retirements.length !== 0) fail('v4 retires nothing');
  if (!Object.keys(receipt.authority ?? {}).length || Object.values(receipt.authority).some(value => value !== false)) {
    fail('receipt claims authority it does not have');
  }
  return receipt;
}

function buildEffectiveCurrentV4(rawV3Bytes, rawReceiptBytes) {
  const bytes = Buffer.from(rawV3Bytes);
  if (sha256RawBytes(bytes) !== V3.rawSha256) fail(`${V3.identity} raw bytes are not the pinned artifact`);
  const v3 = JSON.parse(bytes.toString('utf8'));
  if (v3.name !== V3.identity) fail(`${V3.identity} identity is invalid`);
  if (JSON.stringify(countBy(v3.candidates, 'humanLabel')) !== JSON.stringify(EXPECTED_V3_LABELS)) {
    fail('v3 catalog label distribution is not 42 / 14');
  }
  const receipt = validateReceipt(JSON.parse(Buffer.from(rawReceiptBytes).toString('utf8')));
  const amendments = new Map(receipt.amendments.map(row => [row.semanticSkeletonId, row]));
  // Positional: order, ID, split, boundary class and contrast group never move.
  const candidates = v3.candidates.map(row => {
    const change = amendments.get(row.semanticSkeletonId);
    if (!change) return { ...row };
    if (row.humanLabel !== change.fromHumanLabel) fail(`change for ${row.semanticSkeletonId} does not match v3`);
    return {
      semanticSkeletonId: row.semanticSkeletonId,
      splitAssignment: row.splitAssignment,
      boundaryClass: row.boundaryClass,
      humanLabel: change.toHumanLabel,
      candidateFocus: change.candidateFocus,
      semanticRelations: [...change.semanticRelations],
      interpretationContract: change.interpretationContract,
      ...(Object.hasOwn(row, 'contrastGroupId') ? { contrastGroupId: row.contrastGroupId } : {}),
    };
  });
  const labels = countBy(candidates, 'humanLabel');
  if (JSON.stringify(labels) !== JSON.stringify(EXPECTED_LABELS)) fail(`v4 label distribution must be ${JSON.stringify(EXPECTED_LABELS)}`);
  if (JSON.stringify(countBy(candidates, 'splitAssignment')) !== JSON.stringify(v3.coverage.splitCounts)) fail('v4 splits drifted');

  return {
    name: V4_IDENTITY,
    status: 'ACTIVE_PROSPECTIVE_SEMANTIC_AUTHORITY',
    supersedes: {
      identity: V3.identity,
      rawSha256: V3.rawSha256,
      role: 'IMMUTABLE_HISTORICAL_PRIOR_PROSPECTIVE_AUTHORITY_AND_DERIVATION_BASE',
      overwritten: false,
      humanLabelCounts: { ...EXPECTED_V3_LABELS },
    },
    historicalLineage: [{ ...v3.supersedes, rebuiltFromHere: false }, ...v3.historicalLineage],
    semanticContractReceipt: { identity: RECEIPT_IDENTITY, rawSha256: sha256RawBytes(Buffer.from(rawReceiptBytes)) },
    interpretationRule: { ...receipt.interpretationRule },
    amendedSkeletonIds: CHANGES.map(row => row.id),
    labelChangedSkeletonIds: [...LABEL_CHANGED_SKELETON_IDS],
    retiredSkeletons: v3.retiredSkeletons,
    escalateSkeletonIds: candidates.filter(row => row.humanLabel === 'ESCALATE').map(row => row.semanticSkeletonId),
    mixedRealizationEscalateSkeletonIds: v3.mixedRealizationEscalateSkeletonIds,
    corpusLabelContract: v3.corpusLabelContract,
    coverage: { ...v3.coverage, humanLabelCounts: labels },
    authority: { ...receipt.authority },
    candidates,
  };
}

function main() {
  const catalog = buildEffectiveCurrentV4(loadFixture(V3.fixture), loadFixture(RECEIPT_FILE));
  fs.writeFileSync(path.join(ROOT, 'fixtures', V4_FILE), artifactBytes(catalog));
  process.stdout.write(`Built P1-B6 effective-current skeleton catalog v4: fixtures/${V4_FILE}\n`);
  return 0;
}

module.exports = {
  CHANGES, EXPECTED_LABELS, LABEL_CHANGED_SKELETON_IDS, RECEIPT_FILE, V3, V4_FILE, V4_IDENTITY,
  buildEffectiveCurrentV4, main, validateReceipt,
};

if (require.main === module) process.exit(main());
