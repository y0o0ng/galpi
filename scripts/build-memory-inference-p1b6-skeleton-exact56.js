#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const skeletons = require('../lib/memory-inference-p1b6-skeletons');
const pass2 = require('./build-memory-inference-p1b6-skeleton-pass2-audit');

const SOURCE_PATHS = Object.freeze({
  pass2Catalog: pass2.OUTPUT_PATHS.catalog,
  pass2Protocol: pass2.OUTPUT_PATHS.protocol,
  historicalReferenceGroups: pass2.OUTPUT_PATHS.historicalReferenceGroups,
  modelSuggestions: pass2.OUTPUT_PATHS.modelSuggestions,
  humanAdjudicationReceipt: 'fixtures/local-memory-inference-p1b6-skeleton-pass2-human-adjudication-receipt.json',
  replacementCandidates: 'fixtures/local-memory-inference-p1b6-skeleton-pass2-replacement-candidates.json',
  historicalCases: pass2.SOURCE_PATHS.historicalCases,
});

const OUTPUT_PATHS = Object.freeze({
  exact56: 'fixtures/local-memory-inference-p1b6-skeleton-exact56.json',
  protocol: 'fixtures/local-memory-inference-p1b6-skeleton-pass2-freeze-protocol.json',
});

const EXPECTED_SHA = Object.freeze({
  ...pass2.EXPECTED_SHA,
  pass2Catalog: 'd8ffa4622ea4a70fc197e0e776cf9308f96f08e472a333875ac81f77e3b66501',
  pass2Protocol: 'b4e4aa442dd61250d8de5c34a90684fc5078e27791d7bb05986eb748208a7965',
  historicalReferenceGroups: 'da97f3e0fa496ed779754acc1a2f15909665c9cc54d30bab66ce6fb9ed7f48f4',
  modelSuggestions: '254a7712e3ff01cb9e0530fde80825586e576f8ca41bc497b0b948e04ee792b1',
  humanAdjudicationReceipt: 'd2320fe0f44b1f9a28be30334284a00d409a12637acec2f7d474ce7689d081f7',
  replacementCandidates: '9b32da295cad802f9582618d7d990bbef98630a1a072ec47ff8557c76718a266',
});

const DROP_EXISTING_IDS = Object.freeze([
  'p1b6-sk-7e613818545d04bc',
  'p1b6-sk-b4a6776ed886de2d',
  'p1b6-sk-ae65e2ec3789a8e5',
  'p1b6-sk-63b9e434ba146408',
  'p1b6-sk-302069b96f1406b3',
  'p1b6-sk-264280ddad65a8da',
  'p1b6-sk-ab85f961c71f1bb5',
  'p1b6-sk-909e894ec573b62c',
  'p1b6-sk-4e7a29da8a3037a4',
  'p1b6-sk-1382663d3ae9f6b7',
  'p1b6-sk-24e17e0cafddd4ae',
  'p1b6-sk-2355452bdd41e4eb',
  'p1b6-sk-609043b6b1fb92e4',
  'p1b6-sk-9ef1bb2b5c5e2d7f',
  'p1b6-sk-9dedffcaacc2426f',
  'p1b6-sk-67d79991996ef494',
  'p1b6-sk-75fa233a7cee369e',
  'p1b6-sk-aad4e8523ca5f042',
  'p1b6-sk-9af7e76a84e97be0',
  'p1b6-sk-7209bf45f4ee890c',
  'p1b6-sk-de16754758b5bb97',
  'p1b6-sk-56c94f11c6522ef7',
]);

const EXPECTED_COVERAGE = Object.freeze({
  total: 56,
  splitCounts: { TRAIN: 24, DEV: 16, FINAL_HELD_OUT: 16 },
  humanLabelCounts: { CLEAR: 32, ESCALATE: 24 },
  perBoundarySplit: { TRAIN: 3, DEV: 2, FINAL_HELD_OUT: 2 },
});

const STARTING_MAIN_SHA = 'a87360c0bf2482418f13df8bdbcfb9acbe9a16dc';

function readBytes(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath));
}

function readJson(root, relativePath) {
  return JSON.parse(readBytes(root, relativePath).toString('utf8'));
}

function writeJson(root, relativePath, value) {
  fs.writeFileSync(path.join(root, relativePath), `${JSON.stringify(value, null, 2)}\n`);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

function assertDeepEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function sourceArtifacts(root) {
  const paths = { ...pass2.SOURCE_PATHS, ...SOURCE_PATHS };
  return Object.fromEntries(Object.entries(paths).map(([key, relativePath]) => {
    const sha256 = skeletons.sha256RawBytes(readBytes(root, relativePath));
    assertEqual(sha256, EXPECTED_SHA[key], `stale source artifact ${relativePath}`);
    return [key, { path: relativePath, sha256 }];
  }));
}

function minimalExactEntry(entry) {
  const exact = {
    semanticSkeletonId: entry.semanticSkeletonId,
    splitAssignment: entry.splitAssignment,
    boundaryClass: entry.boundaryClass,
    humanLabel: entry.humanLabel,
    candidateFocus: entry.candidateFocus,
    semanticRelations: entry.semanticRelations,
  };
  if (Object.hasOwn(entry, 'contrastGroupId')) exact.contrastGroupId = entry.contrastGroupId;
  return exact;
}

function validateExactEntry(entry) {
  const allowed = new Set([
    'semanticSkeletonId',
    'splitAssignment',
    'boundaryClass',
    'humanLabel',
    'candidateFocus',
    'semanticRelations',
    'contrastGroupId',
  ]);
  for (const key of Object.keys(entry)) {
    if (!allowed.has(key)) throw new Error(`unexpected exact56 field ${key}: ${entry.semanticSkeletonId}`);
  }
  if (!skeletons.SKELETON_ID_PATTERN.test(entry.semanticSkeletonId)) throw new Error(`bad skeleton ID: ${entry.semanticSkeletonId}`);
  if (!skeletons.SPLIT_ASSIGNMENTS.includes(entry.splitAssignment)) throw new Error(`bad split: ${entry.semanticSkeletonId}`);
  if (!skeletons.BOUNDARY_CLASSES.includes(entry.boundaryClass)) throw new Error(`bad boundary class: ${entry.semanticSkeletonId}`);
  if (!skeletons.AMBIGUITY_LABELS.includes(entry.humanLabel)) throw new Error(`bad humanLabel: ${entry.semanticSkeletonId}`);
  if (Object.hasOwn(entry, 'contrastGroupId') && !skeletons.CONTRAST_GROUP_ID_PATTERN.test(entry.contrastGroupId)) {
    throw new Error(`bad contrastGroupId: ${entry.semanticSkeletonId}`);
  }
  if (!Array.isArray(entry.semanticRelations) || entry.semanticRelations.length < 2 || entry.semanticRelations.length > 5) {
    throw new Error(`bad semanticRelations: ${entry.semanticSkeletonId}`);
  }
}

function validateReceipt(receipt, catalogSha256) {
  assertEqual(receipt.name, 'xion-local-memory-inference-p1b6-skeleton-pass2-human-adjudication-receipt-v1', 'adjudication receipt name');
  assertEqual(receipt.effectiveInputCatalog.path, SOURCE_PATHS.pass2Catalog, 'adjudication input path');
  assertEqual(receipt.effectiveInputCatalog.sha256, catalogSha256, 'adjudication input sha');
  assertEqual(receipt.effectiveInputCatalog.candidateCount, 71, 'adjudication input count');
  assertDeepEqual(receipt.dropExistingSemanticSkeletonIds, DROP_EXISTING_IDS, 'drop IDs');
  assertDeepEqual(receipt.expectedFinalCoverage, {
    total: EXPECTED_COVERAGE.total,
    splitCounts: EXPECTED_COVERAGE.splitCounts,
    perBoundaryClassSplitCounts: EXPECTED_COVERAGE.perBoundarySplit,
    humanLabelCounts: EXPECTED_COVERAGE.humanLabelCounts,
  }, 'expected final coverage');
  if (!receipt.authority.humanFinalAuthority || !receipt.authority.assistantAssistedSemanticDiscussion) {
    throw new Error('HUMAN / assistant-assisted authority statement missing');
  }
  if (receipt.authority.doesNotClaimFullMetadataBlindness !== true || receipt.authority.reviewWasNotFullyInteractionIsolated !== true) {
    throw new Error('metadata-blindness caveat missing');
  }
  if (receipt.semanticContract.doesNotClassifyDurability !== true || receipt.semanticContract.noSurfaceGenerationOrTraining !== true) {
    throw new Error('semantic contract boundary missing');
  }
}

function validateReplacements(artifact, sourceIds) {
  assertEqual(artifact.name, 'xion-local-memory-inference-p1b6-skeleton-pass2-replacement-candidates-v1', 'replacement fixture name');
  if (!artifact.provenance.humanFinalAuthority || !artifact.provenance.assistantAssisted) {
    throw new Error('replacement provenance authority missing');
  }
  if (artifact.provenance.doesNotClaimFullMetadataBlindness !== true || artifact.provenance.notFullyInteractionIsolated !== true) {
    throw new Error('replacement metadata exposure caveat missing');
  }
  assertEqual(artifact.acceptedReplacements.length, 7, 'accepted replacements count');
  assertEqual(artifact.discardedReplacementAttempts.length, 5, 'discarded replacements count');
  const acceptedIds = new Set();
  for (const entry of artifact.acceptedReplacements) {
    validateExactEntry(minimalExactEntry(entry));
    assertEqual(entry.humanDisposition, 'KEEP', `replacement disposition ${entry.semanticSkeletonId}`);
    if (sourceIds.has(entry.semanticSkeletonId) || acceptedIds.has(entry.semanticSkeletonId)) {
      throw new Error(`replacement ID collision: ${entry.semanticSkeletonId}`);
    }
    acceptedIds.add(entry.semanticSkeletonId);
  }
  for (const attempt of artifact.discardedReplacementAttempts) {
    assertEqual(attempt.humanDisposition, 'KEEP', `discarded human disposition ${attempt.attemptId}`);
    assertEqual(attempt.finalCatalogAuditDecision, 'DROP', `discarded audit decision ${attempt.attemptId}`);
  }
}

function assertNoContrastGroupSplitLeak(catalog) {
  const groups = new Map();
  for (const entry of catalog) {
    if (!Object.hasOwn(entry, 'contrastGroupId')) continue;
    const prior = groups.get(entry.contrastGroupId);
    if (prior && prior !== entry.splitAssignment) {
      throw new Error(`contrast group spans splits: ${entry.contrastGroupId}`);
    }
    groups.set(entry.contrastGroupId, entry.splitAssignment);
  }
}

function assertCoverage(catalog) {
  const coverage = pass2.countCoverage(catalog);
  assertEqual(coverage.total, EXPECTED_COVERAGE.total, 'exact56 total');
  assertDeepEqual(coverage.splitCounts, EXPECTED_COVERAGE.splitCounts, 'exact56 splits');
  assertDeepEqual(coverage.humanLabelCounts, EXPECTED_COVERAGE.humanLabelCounts, 'exact56 labels');
  for (const [boundaryClass, counts] of Object.entries(coverage.boundaryClassSplitCounts)) {
    assertDeepEqual(counts, EXPECTED_COVERAGE.perBoundarySplit, `exact56 boundary split ${boundaryClass}`);
  }
  return coverage;
}

function buildExact56(root = process.cwd()) {
  const sources = sourceArtifacts(root);
  const rebuiltPass2 = pass2.buildEffectiveCatalog(root);
  const pass2Artifact = readJson(root, SOURCE_PATHS.pass2Catalog);
  assertDeepEqual(pass2Artifact, rebuiltPass2, 'Pass-2 effective catalog reconstruction');
  validateReceipt(readJson(root, SOURCE_PATHS.humanAdjudicationReceipt), sources.pass2Catalog.sha256);

  const sourceIds = new Set(pass2Artifact.candidates.map(entry => entry.semanticSkeletonId));
  const replacements = readJson(root, SOURCE_PATHS.replacementCandidates);
  validateReplacements(replacements, sourceIds);

  const dropIds = new Set(DROP_EXISTING_IDS);
  const retained = pass2Artifact.candidates.filter(entry => !dropIds.has(entry.semanticSkeletonId)).map(minimalExactEntry);
  assertEqual(retained.length, 49, 'retained source count after drops');
  for (const id of DROP_EXISTING_IDS) {
    if (!sourceIds.has(id)) throw new Error(`drop ID missing from effective Pass-2 catalog: ${id}`);
  }
  for (const entry of pass2Artifact.candidates) {
    if (!dropIds.has(entry.semanticSkeletonId) && !retained.some(row => row.semanticSkeletonId === entry.semanticSkeletonId)) {
      throw new Error(`retained ID lost: ${entry.semanticSkeletonId}`);
    }
  }

  const accepted = replacements.acceptedReplacements.map(minimalExactEntry);
  const catalog = [...retained, ...accepted];
  const ids = new Set();
  for (const entry of catalog) {
    validateExactEntry(entry);
    if (ids.has(entry.semanticSkeletonId)) throw new Error(`duplicate exact56 ID: ${entry.semanticSkeletonId}`);
    ids.add(entry.semanticSkeletonId);
    if (Object.hasOwn(entry, 'intendedLabel') || Object.hasOwn(entry, 'decisionBasis')) {
      throw new Error(`generator-only field leaked: ${entry.semanticSkeletonId}`);
    }
  }
  for (const id of DROP_EXISTING_IDS) {
    if (ids.has(id)) throw new Error(`dropped ID survived: ${id}`);
  }
  for (const attempt of replacements.discardedReplacementAttempts) {
    if (catalog.some(entry => entry.candidateFocus === attempt.candidateFocus)) {
      throw new Error(`discarded replacement entered exact56: ${attempt.attemptId}`);
    }
  }
  assertNoContrastGroupSplitLeak(catalog);
  const coverage = assertCoverage(catalog);

  const historicalCaseIds = new Set(readJson(root, SOURCE_PATHS.historicalCases).cases.map(row => row.caseId));
  for (const entry of catalog) {
    if (historicalCaseIds.has(entry.semanticSkeletonId)) throw new Error(`historical case entered exact56: ${entry.semanticSkeletonId}`);
  }

  return {
    name: 'xion-local-memory-inference-p1b6-skeleton-exact56-v1',
    sourceProtocol: 'xion-p1b6-skeleton-pass2-exact56-freeze-v1',
    startingMainSha: STARTING_MAIN_SHA,
    sourceArtifacts: sources,
    coverage,
    status: 'CLOSED / FROZEN',
    exclusions: {
      historical60: 'diagnostic/reference-only and excluded from supervised P1-B6 TRAIN/DEV/FINAL_HELD_OUT skeletons',
      surfaceGeneration: 'not performed',
      training: 'not performed',
      finalHeldOutModelOutput: 'none',
      sourceEpisodeAnchorProvenance: 'not invented at skeleton level'
    },
    candidates: catalog,
  };
}

function buildProtocol(root, exact56) {
  const outputSha256 = {
    exact56: skeletons.sha256RawBytes(Buffer.from(`${JSON.stringify(exact56, null, 2)}\n`)),
  };
  return {
    name: 'xion-local-memory-inference-p1b6-skeleton-pass2-freeze-protocol-v1',
    protocolIdentity: exact56.sourceProtocol,
    startingMainSha: STARTING_MAIN_SHA,
    sourceArtifacts: exact56.sourceArtifacts,
    outputs: OUTPUT_PATHS,
    outputSha256,
    dropExistingSemanticSkeletonIds: DROP_EXISTING_IDS,
    acceptedReplacementSemanticSkeletonIds: readJson(root, SOURCE_PATHS.replacementCandidates)
      .acceptedReplacements.map(entry => entry.semanticSkeletonId),
    authorityStatement: 'HUMAN is final authority. Pass-2 did not relabel the whole 71-case catalog; retained existing candidates keep their existing HUMAN labels, and replacement candidates use their listed HUMAN labels. Model Pass-2 suggestions are advisory only.',
    provenanceCaveat: 'The replacement review was assistant-assisted and not fully interaction-isolated; this artifact does not claim full metadata-blindness.',
    excludedWork: [
      'No surface data generation.',
      'No FINAL HELD-OUT surface model output.',
      'No fine-tuning or training.',
      'No source-anchor architecture or Bundle Builder implementation.',
      'No historical60 promotion into supervised P1-B6 skeletons.'
    ],
  };
}

function buildAll(root = process.cwd()) {
  const exact56 = buildExact56(root);
  const protocol = buildProtocol(root, exact56);
  return { exact56, protocol };
}

function main() {
  const root = path.resolve(__dirname, '..');
  const artifacts = buildAll(root);
  writeJson(root, OUTPUT_PATHS.exact56, artifacts.exact56);
  writeJson(root, OUTPUT_PATHS.protocol, artifacts.protocol);
}

module.exports = {
  DROP_EXISTING_IDS,
  EXPECTED_COVERAGE,
  EXPECTED_SHA,
  OUTPUT_PATHS,
  SOURCE_PATHS,
  STARTING_MAIN_SHA,
  buildAll,
  buildExact56,
};

if (require.main === module) main();
