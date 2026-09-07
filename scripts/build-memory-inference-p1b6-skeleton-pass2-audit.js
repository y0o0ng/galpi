#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const skeletons = require('../lib/memory-inference-p1b6-skeletons');

const SOURCE_PATHS = Object.freeze({
  originalFixture: 'fixtures/local-memory-inference-p1b6-skeleton-candidates.json',
  originalReceipt: 'fixtures/local-memory-inference-p1b6-skeleton-human-pass1-receipt.json',
  followupFixture: 'fixtures/local-memory-inference-p1b6-skeleton-pass1-followup-candidates.json',
  followupProtocol: 'fixtures/local-memory-inference-p1b6-skeleton-pass1-followup-protocol.json',
  followupReceipt: 'fixtures/local-memory-inference-p1b6-skeleton-pass1-followup-receipt.json',
  authoringProtocol: 'fixtures/local-memory-inference-p1b6-skeleton-authoring-protocol.json',
  historicalCases: 'fixtures/local-memory-inference-p1b3-decomposed-pipeline-candidates-v2.json',
});

const OUTPUT_PATHS = Object.freeze({
  catalog: 'fixtures/local-memory-inference-p1b6-skeleton-pass2-catalog.json',
  protocol: 'fixtures/local-memory-inference-p1b6-skeleton-pass2-protocol.json',
  historicalReferenceGroups: 'fixtures/local-memory-inference-p1b6-historical-reference-groups.json',
  modelSuggestions: 'fixtures/local-memory-inference-p1b6-skeleton-pass2-model-suggestions.json',
});

const EXPECTED_SHA = Object.freeze({
  originalFixture: 'c849037cc086d2806c61f21da100a94cc502b5e41b903fc511db705d305277c9',
  originalReceipt: '428f802a283ad9cddec6370595ceb157c95573cadcc252529898f419fd6fec75',
  followupFixture: '9791a61d4d46d7b6257642eda3cf6a677821f60e0d22afad71af0a5567b646f2',
  followupProtocol: '1ffe5da2896784856e7317348ccb5b55515cc2cd3754d3b9c58f1f17842a6426',
  followupReceipt: 'c21fef8f0524791bc89151e391c7c7576a1831602e44a18d876414a6f4fd6b99',
  authoringProtocol: '193760cd68291138beaba00c9a79d46835a1f1d3aac0e0886a38b92ebf634ef1',
  historicalCases: 'a6608642caad02c772941d58558bd9fc31ee86ef54fe342ee2713aa08cf62c8e',
});

const FIX_IDS = Object.freeze([
  'p1b6-sk-11a3e916ff9b8129',
  'p1b6-sk-f2fb3e894c37caac',
  'p1b6-sk-4e7a29da8a3037a4',
]);
const REJECT_IDS = Object.freeze([
  'p1b6-sk-eb1cd528d84aa3f2',
  'p1b6-sk-348ebfd24bb7d3f5',
]);
const KEEP_CLEAR_CORRECTION_ID = 'p1b6-sk-43016ef6da889a87';
const REPLACEMENT_ID = 'p1b6-sk-95b3c63acff8f020';
const DISCARDED_REPLACEMENT_ID = 'p1b6-sk-3622bd6548e4d782';
const STARTING_MAIN_SHA = 'd54c9faa31d256ffc864b0cd1b135a9791f750f8';

const HISTORICAL_GROUP_SUFFIXES = Object.freeze({
  'HIST-ACT-01': ['007', '012', '013', '021', '028', '031', '038', '043', '049', '055', '058', '060'],
  'HIST-PER-01': ['001', '005', '018', '024', '034', '040', '046', '052'],
  'HIST-FIN-01': ['002', '004', '009', '011', '014', '016', '022', '025', '030', '036', '039', '042', '045', '050', '054', '057'],
  'HIST-PER-02': ['019', '033', '047'],
  'HIST-SCP-01': ['027'],
  'HIST-ACT-02': ['003', '010', '032', '051'],
  'HIST-REF-01': ['006', '017', '041', '048'],
  'HIST-SCP-02': ['008', '020', '026', '035', '044', '059'],
  'HIST-PER-03': ['015', '029', '037', '053', '056'],
  'HIST-FIN-02': ['023'],
});

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function readBytes(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath));
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
  return Object.fromEntries(Object.entries(SOURCE_PATHS).map(([key, relativePath]) => {
    const sha256 = skeletons.sha256RawBytes(readBytes(root, relativePath));
    assertEqual(sha256, EXPECTED_SHA[key], `stale source artifact ${relativePath}`);
    return [key, { path: relativePath, sha256 }];
  }));
}

function minimalCatalogEntry(candidate, humanLabel) {
  const entry = {
    semanticSkeletonId: candidate.semanticSkeletonId,
    splitAssignment: candidate.splitAssignment,
    boundaryClass: candidate.boundaryClass,
    humanLabel,
    candidateFocus: candidate.candidateFocus,
    semanticRelations: candidate.semanticRelations,
  };
  if (Object.hasOwn(candidate, 'contrastGroupId')) entry.contrastGroupId = candidate.contrastGroupId;
  return entry;
}

function countCoverage(catalog) {
  const splitCounts = { TRAIN: 0, DEV: 0, FINAL_HELD_OUT: 0 };
  const humanLabelCounts = { CLEAR: 0, ESCALATE: 0 };
  const boundarySplitCounts = {};
  const target = { TRAIN: 3, DEV: 2, FINAL_HELD_OUT: 2 };
  for (const boundaryClass of skeletons.BOUNDARY_CLASSES) {
    boundarySplitCounts[boundaryClass] = { TRAIN: 0, DEV: 0, FINAL_HELD_OUT: 0 };
  }
  for (const entry of catalog) {
    splitCounts[entry.splitAssignment] += 1;
    humanLabelCounts[entry.humanLabel] += 1;
    boundarySplitCounts[entry.boundaryClass][entry.splitAssignment] += 1;
  }
  const targetDelta = {};
  for (const [boundaryClass, counts] of Object.entries(boundarySplitCounts)) {
    targetDelta[boundaryClass] = {
      TRAIN: counts.TRAIN - target.TRAIN,
      DEV: counts.DEV - target.DEV,
      FINAL_HELD_OUT: counts.FINAL_HELD_OUT - target.FINAL_HELD_OUT,
    };
  }
  return {
    total: catalog.length,
    splitCounts,
    humanLabelCounts,
    boundaryClassSplitCounts: boundarySplitCounts,
    targetPerBoundaryClassSplit: target,
    targetDelta,
  };
}

function buildEffectiveCatalog(root = process.cwd()) {
  const sources = sourceArtifacts(root);
  const originalBytes = readBytes(root, SOURCE_PATHS.originalFixture);
  const followupBytes = readBytes(root, SOURCE_PATHS.followupFixture);
  const originalFixture = skeletons.parseSkeletonCandidateFixture(originalBytes);
  const originalReceipt = skeletons.validateCompletedReviewReceipt(
    readJson(root, SOURCE_PATHS.originalReceipt),
    originalBytes,
  );
  const followupFixture = skeletons.parseSkeletonCandidateFixture(followupBytes, {
    fixtureName: skeletons.FOLLOWUP_CANDIDATE_FIXTURE_NAME,
    minCandidates: 4,
  });
  const followupReceipt = skeletons.validateCompletedReviewReceipt(
    readJson(root, SOURCE_PATHS.followupReceipt),
    followupBytes,
    {
      fixtureName: skeletons.FOLLOWUP_CANDIDATE_FIXTURE_NAME,
      protocolVersion: skeletons.FOLLOWUP_REVIEW_PROTOCOL_VERSION,
      receiptName: skeletons.FOLLOWUP_REVIEW_RECEIPT_NAME,
    },
  );
  const followupProtocol = readJson(root, SOURCE_PATHS.followupProtocol);
  assertEqual(followupProtocol.originalCandidateFixture.sha256, sources.originalFixture.sha256, 'follow-up protocol original fixture sha');
  assertEqual(followupProtocol.originalPass1Receipt.sha256, sources.originalReceipt.sha256, 'follow-up protocol original receipt sha');
  assertEqual(followupProtocol.followupCandidateFixture.sha256, sources.followupFixture.sha256, 'follow-up protocol fixture sha');
  assertDeepEqual(followupProtocol.sourceDecisions.fixSourceIds, FIX_IDS, 'follow-up protocol FIX IDs');
  assertDeepEqual(followupProtocol.sourceDecisions.rejectSourceIds, REJECT_IDS, 'follow-up protocol REJECT IDs');
  assertDeepEqual(followupProtocol.sourceDecisions.keepClearCorrection, {
    sourceId: KEEP_CLEAR_CORRECTION_ID,
    correctedDisposition: 'KEEP',
    correctedAmbiguityLabel: 'CLEAR',
  }, 'follow-up protocol KEEP+CLEAR correction');
  assertEqual(followupProtocol.sourceDecisions.replacementMapping[REJECT_IDS[0]], REPLACEMENT_ID, 'replacement mapping');
  assertEqual(followupProtocol.sourceDecisions.noReplacementSourceIds[0], REJECT_IDS[1], '348e no-replacement mapping');

  const pass1ById = new Map(originalReceipt.results.map(result => [result.semanticSkeletonId, result]));
  const followupCandidateById = new Map(followupFixture.candidates.map(candidate => [candidate.semanticSkeletonId, candidate]));
  const followupResultById = new Map(followupReceipt.results.map(result => [result.semanticSkeletonId, result]));
  for (const id of [...FIX_IDS, REPLACEMENT_ID]) {
    const result = followupResultById.get(id);
    if (!result) throw new Error(`missing follow-up receipt result: ${id}`);
    assertEqual(result.disposition, 'KEEP', `follow-up disposition ${id}`);
    assertEqual(result.ambiguityLabel, 'CLEAR', `follow-up label ${id}`);
  }
  for (const id of REJECT_IDS) {
    assertEqual(pass1ById.get(id)?.disposition, 'REJECT', `original rejected disposition ${id}`);
  }
  const catalog = [];
  for (const candidate of originalFixture.candidates) {
    if (candidate.semanticSkeletonId === REJECT_IDS[0]) {
      const replacement = followupCandidateById.get(REPLACEMENT_ID);
      const review = followupResultById.get(REPLACEMENT_ID);
      if (!replacement || !review) throw new Error('missing replacement follow-up input');
      assertEqual(review.disposition, 'KEEP', 'replacement disposition');
      catalog.push(minimalCatalogEntry(replacement, review.ambiguityLabel));
      continue;
    }
    if (REJECT_IDS.includes(candidate.semanticSkeletonId)) continue;
    const source = FIX_IDS.includes(candidate.semanticSkeletonId)
      ? followupCandidateById.get(candidate.semanticSkeletonId)
      : candidate;
    const review = FIX_IDS.includes(candidate.semanticSkeletonId)
      ? followupResultById.get(candidate.semanticSkeletonId)
      : pass1ById.get(candidate.semanticSkeletonId);
    if (!source || !review) throw new Error(`missing review input for ${candidate.semanticSkeletonId}`);
    if (review.disposition !== 'KEEP') throw new Error(`effective catalog retained non-KEEP ${candidate.semanticSkeletonId}`);
    const humanLabel = candidate.semanticSkeletonId === KEEP_CLEAR_CORRECTION_ID
      ? 'CLEAR'
      : review.ambiguityLabel;
    catalog.push(minimalCatalogEntry(source, humanLabel));
  }

  const ids = new Set(catalog.map(entry => entry.semanticSkeletonId));
  if (ids.size !== catalog.length) throw new Error('duplicate effective catalog IDs');
  for (const rejectedId of REJECT_IDS) {
    if (ids.has(rejectedId)) throw new Error(`rejected ID retained: ${rejectedId}`);
  }
  if (!ids.has(REPLACEMENT_ID)) throw new Error('replacement missing from effective catalog');
  if (ids.has(DISCARDED_REPLACEMENT_ID)) throw new Error('discarded replacement retained');
  for (const entry of catalog) {
    if (Object.hasOwn(entry, 'intendedLabel') || Object.hasOwn(entry, 'decisionBasis')) {
      throw new Error('generator-only fields leaked into effective catalog');
    }
  }
  const coverage = countCoverage(catalog);
  assertEqual(coverage.total, 71, 'effective catalog total');
  assertEqual(coverage.splitCounts.TRAIN, 31, 'effective TRAIN count');
  assertEqual(coverage.splitCounts.DEV, 20, 'effective DEV count');
  assertEqual(coverage.splitCounts.FINAL_HELD_OUT, 20, 'effective FINAL_HELD_OUT count');
  assertEqual(coverage.humanLabelCounts.CLEAR, 38, 'effective CLEAR count');
  assertEqual(coverage.humanLabelCounts.ESCALATE, 33, 'effective ESCALATE count');

  return {
    name: 'xion-local-memory-inference-p1b6-skeleton-pass2-catalog-v1',
    sourceProtocol: 'xion-local-memory-inference-p1b6-skeleton-pass2-audit-preparation-v1',
    startingMainSha: STARTING_MAIN_SHA,
    sourceArtifacts: sources,
    coverage,
    candidates: catalog,
  };
}

function buildHistoricalReferenceGroups(root = process.cwd()) {
  const sources = sourceArtifacts(root);
  const historical = readJson(root, SOURCE_PATHS.historicalCases);
  if (historical.name !== 'xion-local-memory-inference-p1b3-decomposed-pipeline-candidates-v2') {
    throw new Error('unexpected historical fixture identity');
  }
  const caseIds = new Set(historical.cases.map(row => row.caseId));
  const groups = Object.fromEntries(Object.entries(HISTORICAL_GROUP_SUFFIXES).map(([groupId, suffixes]) => [
    groupId,
    suffixes.map(suffix => `p1b3-decomposed-v2-${suffix}`),
  ]));
  const grouped = Object.values(groups).flat();
  if (new Set(grouped).size !== grouped.length) throw new Error('duplicate historical case mapping');
  if (grouped.length !== 60 || grouped.some(caseId => !caseIds.has(caseId))) {
    throw new Error('historical reference groups must cover the exact 60 cases once');
  }
  return {
    name: 'xion-local-memory-inference-p1b6-historical-reference-groups-v1',
    sourceFixture: sources.historicalCases,
    status: 'historical reference skeletons only; not supervised P1-B6 skeletons and not part of the exact-56 catalog',
    provenanceStatement: 'This artifact records only frozen group membership over existing P1-B3 case IDs; it invents no turn, anchor, source-episode, or conversational provenance.',
    groups,
  };
}

function buildModelSuggestions(catalogArtifact, historicalGroupsArtifact) {
  const ids = new Set(catalogArtifact.candidates.map(entry => entry.semanticSkeletonId));
  const referenceIds = new Set(Object.keys(historicalGroupsArtifact.groups));
  const findings = [
    {
      findingId: 'p1b6-pass2-sugg-6d9f7c3e0a2b4f18',
      findingType: 'duplicate_decision_relevant_relation_under_different_wording',
      involvedSemanticSkeletonIds: [
        'p1b6-sk-5229ea237196499d',
        'p1b6-sk-7e613818545d04bc',
      ],
      historicalReferenceSkeletonIds: [],
      representativeHistoricalCaseIds: [],
      reasoning: 'Both structures turn on whether a positive or confirmatory response after a proposed target establishes adoption of that target, or merely acknowledges surrounding discussion. The wording differs, but the decision-relevant relation may collapse.',
    },
    {
      findingId: 'p1b6-pass2-sugg-8124c0ef7395aa2d',
      findingType: 'historical_reference_repackaging',
      involvedSemanticSkeletonIds: [
        'p1b6-sk-b4a6776ed886de2d',
        'p1b6-sk-43016ef6da889a87',
      ],
      historicalReferenceSkeletonIds: ['HIST-ACT-01'],
      representativeHistoricalCaseIds: [
        'p1b3-decomposed-v2-012',
        'p1b3-decomposed-v2-021',
        'p1b3-decomposed-v2-043',
      ],
      reasoning: 'The historical group contains explicit sample/example or quoted non-user content that should not become user state. These skeletons are broader actuality checks, but HUMAN Pass-2 should ensure they are not merely repackaged historical actuality cases.',
    },
    {
      findingId: 'p1b6-pass2-sugg-f0a3bb61d95477ce',
      findingType: 'historical_reference_repackaging',
      involvedSemanticSkeletonIds: [
        'p1b6-sk-ae65e2ec3789a8e5',
        'p1b6-sk-63b9e434ba146408',
        'p1b6-sk-95b3c63acff8f020',
      ],
      historicalReferenceSkeletonIds: ['HIST-PER-01'],
      representativeHistoricalCaseIds: [
        'p1b3-decomposed-v2-005',
        'p1b3-decomposed-v2-018',
        'p1b3-decomposed-v2-024',
      ],
      reasoning: 'The historical group covers temporary or one-context preference/settings exceptions. The involved skeletons are abstract persistence/exception structures, but HUMAN Pass-2 should check that the recurring-default/limited-exception relation is not just the historical temporary-setting pattern with nouns removed.',
    },
  ];
  for (const finding of findings) {
    for (const id of finding.involvedSemanticSkeletonIds) {
      if (!ids.has(id)) throw new Error(`model suggestion references unknown effective skeleton: ${id}`);
    }
    for (const id of finding.historicalReferenceSkeletonIds) {
      if (!referenceIds.has(id)) throw new Error(`model suggestion references unknown historical group: ${id}`);
    }
  }
  return {
    name: 'xion-local-memory-inference-p1b6-skeleton-pass2-model-suggestions-v1',
    sourceProtocol: catalogArtifact.sourceProtocol,
    advisoryOnly: true,
    authorityStatement: 'These suggestions are advisory. HUMAN review is final authority; this model review can miss semantic duplicates. No catalog mutation, approval, rejection, replacement, final catalog choice, or exact-56 selection follows automatically from any finding or from absence of findings.',
    generator: {
      provider: 'OpenAI',
      surface: 'Codex',
      model: 'gpt-5.5',
      exposedSettings: { reasoning: 'medium' },
      platformControlledSettings: ['temperature', 'sampling', 'decoding', 'seed'],
      settingsStatement: 'Temperature, sampling, decoding, and seed controls were not exposed as numeric settings in this Codex session; they are platform-controlled and not invented.',
    },
    auditInputs: {
      effectiveCatalog: OUTPUT_PATHS.catalog,
      historicalReferenceGroups: OUTPUT_PATHS.historicalReferenceGroups,
      historicalCaseEvidence: SOURCE_PATHS.historicalCases,
    },
    findings,
  };
}

function buildProtocol(root, catalogArtifact, historicalGroupsArtifact, modelSuggestionsArtifact) {
  return {
    name: 'xion-local-memory-inference-p1b6-skeleton-pass2-audit-preparation-protocol-v1',
    protocolIdentity: catalogArtifact.sourceProtocol,
    startingMainSha: STARTING_MAIN_SHA,
    sourceArtifacts: catalogArtifact.sourceArtifacts,
    outputs: {
      catalog: OUTPUT_PATHS.catalog,
      protocol: OUTPUT_PATHS.protocol,
      historicalReferenceGroups: OUTPUT_PATHS.historicalReferenceGroups,
      modelSuggestions: OUTPUT_PATHS.modelSuggestions,
    },
    closedInputState: {
      fixedSourceIds: FIX_IDS,
      rejectedSourceIds: REJECT_IDS,
      keepClearCorrection: KEEP_CLEAR_CORRECTION_ID,
      replacementMapping: { [REJECT_IDS[0]]: REPLACEMENT_ID },
      noReplacementSourceIds: [REJECT_IDS[1]],
      followupReceiptResultCount: 4,
    },
    coverage: catalogArtifact.coverage,
    outputSha256: {
      catalog: skeletons.sha256RawBytes(Buffer.from(`${JSON.stringify(catalogArtifact, null, 2)}\n`)),
      historicalReferenceGroups: skeletons.sha256RawBytes(Buffer.from(`${JSON.stringify(historicalGroupsArtifact, null, 2)}\n`)),
      modelSuggestions: skeletons.sha256RawBytes(Buffer.from(`${JSON.stringify(modelSuggestionsArtifact, null, 2)}\n`)),
    },
    excludedWork: [
      'HUMAN Pass 2 is not completed by this preparation artifact.',
      'Exact-56 catalog selection/freeze is not performed.',
      'Surface episode/data authoring is not performed.',
      'Training is not started.',
    ],
  };
}

function writeJson(root, relativePath, value) {
  fs.writeFileSync(path.join(root, relativePath), `${JSON.stringify(value, null, 2)}\n`);
}

function buildAll(root = process.cwd()) {
  const catalog = buildEffectiveCatalog(root);
  const historicalReferenceGroups = buildHistoricalReferenceGroups(root);
  const modelSuggestions = buildModelSuggestions(catalog, historicalReferenceGroups);
  const protocol = buildProtocol(root, catalog, historicalReferenceGroups, modelSuggestions);
  return { catalog, historicalReferenceGroups, modelSuggestions, protocol };
}

function main() {
  const root = path.resolve(__dirname, '..');
  const artifacts = buildAll(root);
  writeJson(root, OUTPUT_PATHS.catalog, artifacts.catalog);
  writeJson(root, OUTPUT_PATHS.historicalReferenceGroups, artifacts.historicalReferenceGroups);
  writeJson(root, OUTPUT_PATHS.modelSuggestions, artifacts.modelSuggestions);
  writeJson(root, OUTPUT_PATHS.protocol, artifacts.protocol);
}

module.exports = {
  DISCARDED_REPLACEMENT_ID,
  EXPECTED_SHA,
  FIX_IDS,
  KEEP_CLEAR_CORRECTION_ID,
  OUTPUT_PATHS,
  REJECT_IDS,
  REPLACEMENT_ID,
  SOURCE_PATHS,
  STARTING_MAIN_SHA,
  buildAll,
  buildEffectiveCatalog,
  buildHistoricalReferenceGroups,
  buildModelSuggestions,
  countCoverage,
};

if (require.main === module) main();
