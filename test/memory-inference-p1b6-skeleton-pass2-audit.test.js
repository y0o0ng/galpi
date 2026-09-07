'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const skeletons = require('../lib/memory-inference-p1b6-skeletons');
const pass2 = require('../scripts/build-memory-inference-p1b6-skeleton-pass2-audit');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath));
}

function json(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function sha(relativePath) {
  return skeletons.sha256RawBytes(read(relativePath));
}

test('Pass-2 sources remain byte-identical and completed follow-up receipt is present', () => {
  for (const [key, expected] of Object.entries(pass2.EXPECTED_SHA)) {
    assert.equal(sha(pass2.SOURCE_PATHS[key]), expected, key);
  }
  const followupReceipt = skeletons.validateCompletedReviewReceipt(
    json(pass2.SOURCE_PATHS.followupReceipt),
    read(pass2.SOURCE_PATHS.followupFixture),
    {
      fixtureName: skeletons.FOLLOWUP_CANDIDATE_FIXTURE_NAME,
      protocolVersion: skeletons.FOLLOWUP_REVIEW_PROTOCOL_VERSION,
      receiptName: skeletons.FOLLOWUP_REVIEW_RECEIPT_NAME,
    },
  );
  assert.equal(followupReceipt.results.length, 4);
  assert.ok(followupReceipt.results.every(result => result.disposition === 'KEEP'));
  assert.ok(followupReceipt.results.every(result => result.ambiguityLabel === 'CLEAR'));
});

test('effective Pass-2 catalog is reconstructable and has the expected accepted pool', () => {
  const built = pass2.buildEffectiveCatalog(ROOT);
  const artifact = json(pass2.OUTPUT_PATHS.catalog);
  assert.deepEqual(artifact, built);
  assert.equal(artifact.candidates.length, 71);
  assert.deepEqual(artifact.coverage.splitCounts, { TRAIN: 31, DEV: 20, FINAL_HELD_OUT: 20 });
  assert.deepEqual(artifact.coverage.humanLabelCounts, { CLEAR: 38, ESCALATE: 33 });

  const ids = new Set(artifact.candidates.map(candidate => candidate.semanticSkeletonId));
  for (const rejectedId of pass2.REJECT_IDS) assert.equal(ids.has(rejectedId), false, rejectedId);
  assert.equal(ids.has(pass2.REPLACEMENT_ID), true);
  assert.equal(ids.has(pass2.DISCARDED_REPLACEMENT_ID), false);
  assert.equal(artifact.candidates.filter(candidate => !skeletons.SKELETON_ID_PATTERN.test(candidate.semanticSkeletonId)).length, 0);
  assert.equal(artifact.candidates.filter(candidate => Object.hasOwn(candidate, 'intendedLabel')).length, 0);
  assert.equal(artifact.candidates.filter(candidate => Object.hasOwn(candidate, 'decisionBasis')).length, 0);
  assert.ok(artifact.candidates.some(candidate => Object.hasOwn(candidate, 'contrastGroupId')));
});

test('FIX IDs use follow-up semantic content and follow-up HUMAN labels', () => {
  const original = skeletons.parseSkeletonCandidateFixture(read(pass2.SOURCE_PATHS.originalFixture));
  const followup = skeletons.parseSkeletonCandidateFixture(read(pass2.SOURCE_PATHS.followupFixture), {
    fixtureName: skeletons.FOLLOWUP_CANDIDATE_FIXTURE_NAME,
    minCandidates: 4,
  });
  const followupReceipt = json(pass2.SOURCE_PATHS.followupReceipt);
  const catalog = json(pass2.OUTPUT_PATHS.catalog).candidates;
  for (const id of pass2.FIX_IDS) {
    const effective = catalog.find(candidate => candidate.semanticSkeletonId === id);
    const fixed = followup.candidates.find(candidate => candidate.semanticSkeletonId === id);
    const old = original.candidates.find(candidate => candidate.semanticSkeletonId === id);
    const review = followupReceipt.results.find(result => result.semanticSkeletonId === id);
    assert.deepEqual(effective.candidateFocus, fixed.candidateFocus);
    assert.deepEqual(effective.semanticRelations, fixed.semanticRelations);
    assert.notDeepEqual(effective.semanticRelations, old.semanticRelations);
    assert.equal(effective.humanLabel, review.ambiguityLabel);
  }
});

test('43016 correction, replacement slot, and source provenance are applied fail-closed', () => {
  const catalog = json(pass2.OUTPUT_PATHS.catalog);
  assert.equal(
    catalog.candidates.find(candidate => candidate.semanticSkeletonId === pass2.KEEP_CLEAR_CORRECTION_ID).humanLabel,
    'CLEAR',
  );
  assert.equal(catalog.candidates[26].semanticSkeletonId, pass2.REPLACEMENT_ID);
  const protocol = json(pass2.OUTPUT_PATHS.protocol);
  assert.equal(protocol.startingMainSha, pass2.STARTING_MAIN_SHA);
  assert.deepEqual(protocol.closedInputState.fixedSourceIds, pass2.FIX_IDS);
  assert.deepEqual(protocol.closedInputState.rejectedSourceIds, pass2.REJECT_IDS);
  assert.deepEqual(protocol.closedInputState.replacementMapping, {
    [pass2.REJECT_IDS[0]]: pass2.REPLACEMENT_ID,
  });
  assert.deepEqual(protocol.closedInputState.noReplacementSourceIds, [pass2.REJECT_IDS[1]]);
  assert.equal(protocol.outputSha256.catalog, sha(pass2.OUTPUT_PATHS.catalog));
  assert.equal(protocol.outputSha256.historicalReferenceGroups, sha(pass2.OUTPUT_PATHS.historicalReferenceGroups));
  assert.equal(protocol.outputSha256.modelSuggestions, sha(pass2.OUTPUT_PATHS.modelSuggestions));
});

test('historical reference groups cover all historical 60 exactly once without new provenance', () => {
  const artifact = json(pass2.OUTPUT_PATHS.historicalReferenceGroups);
  const historical = json(pass2.SOURCE_PATHS.historicalCases);
  const grouped = Object.values(artifact.groups).flat();
  assert.equal(grouped.length, 60);
  assert.equal(new Set(grouped).size, 60);
  assert.deepEqual([...grouped].sort(), historical.cases.map(row => row.caseId).sort());
  assert.equal(artifact.status.includes('not supervised P1-B6 skeletons'), true);
  assert.equal(artifact.provenanceStatement.includes('invents no turn, anchor, source-episode'), true);
});

test('model suggestions are advisory and reference only valid effective catalog/reference IDs', () => {
  const catalogIds = new Set(json(pass2.OUTPUT_PATHS.catalog).candidates.map(candidate => candidate.semanticSkeletonId));
  const referenceGroups = json(pass2.OUTPUT_PATHS.historicalReferenceGroups).groups;
  const referenceIds = new Set(Object.keys(referenceGroups));
  const historicalCaseIds = new Set(json(pass2.SOURCE_PATHS.historicalCases).cases.map(row => row.caseId));
  const suggestions = json(pass2.OUTPUT_PATHS.modelSuggestions);
  assert.equal(suggestions.advisoryOnly, true);
  assert.match(suggestions.authorityStatement, /HUMAN review is final authority/u);
  assert.match(suggestions.authorityStatement, /No catalog mutation, approval, rejection, replacement/u);
  assert.equal(suggestions.generator.provider, 'OpenAI');
  assert.equal(suggestions.generator.surface, 'Codex');
  assert.equal(suggestions.generator.model, 'gpt-5.5');
  assert.deepEqual(suggestions.generator.exposedSettings, { reasoning: 'medium' });
  assert.equal(suggestions.findings.length, 3);
  for (const finding of suggestions.findings) {
    assert.match(finding.findingId, /^p1b6-pass2-sugg-[0-9a-f]{16}$/u);
    assert.equal(Object.hasOwn(finding, 'automaticAction'), false);
    assert.equal(Object.hasOwn(finding, 'replacementCandidate'), false);
    for (const id of finding.involvedSemanticSkeletonIds) assert.equal(catalogIds.has(id), true, id);
    for (const id of finding.historicalReferenceSkeletonIds) assert.equal(referenceIds.has(id), true, id);
    for (const id of finding.representativeHistoricalCaseIds) assert.equal(historicalCaseIds.has(id), true, id);
  }
});

test('package script wiring is narrow', () => {
  assert.equal(
    json('package.json').scripts['build:memory-inference-p1b6-skeleton-pass2-audit'],
    'node scripts/build-memory-inference-p1b6-skeleton-pass2-audit.js',
  );
});
