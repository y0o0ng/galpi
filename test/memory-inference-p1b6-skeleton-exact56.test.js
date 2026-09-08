'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const skeletons = require('../lib/memory-inference-p1b6-skeletons');
const pass2 = require('../scripts/build-memory-inference-p1b6-skeleton-pass2-audit');
const exact56 = require('../scripts/build-memory-inference-p1b6-skeleton-exact56');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath));
}

function json(relativePath) {
  return JSON.parse(read(relativePath).toString('utf8'));
}

function sha(relativePath) {
  return skeletons.sha256RawBytes(read(relativePath));
}

function stripTitle(markdown) {
  return markdown.toString('utf8').replace(/^# .+\n/u, '');
}

test('all frozen source hashes remain byte-identical', () => {
  for (const [key, expected] of Object.entries(exact56.EXPECTED_SHA)) {
    const sourcePath = exact56.SOURCE_PATHS[key] || pass2.SOURCE_PATHS[key];
    assert.equal(sha(sourcePath), expected, key);
  }
});

test('Pass-2 effective catalog is still reconstructable from frozen inputs', () => {
  assert.deepEqual(json(pass2.OUTPUT_PATHS.catalog), pass2.buildEffectiveCatalog(ROOT));
});

test('Pass-2 HUMAN adjudication receipt points at the exact input catalog', () => {
  const receipt = json(exact56.SOURCE_PATHS.humanAdjudicationReceipt);
  assert.equal(receipt.effectiveInputCatalog.path, pass2.OUTPUT_PATHS.catalog);
  assert.equal(receipt.effectiveInputCatalog.sha256, sha(pass2.OUTPUT_PATHS.catalog));
  assert.equal(receipt.effectiveInputCatalog.candidateCount, 71);
  assert.equal(receipt.authority.humanFinalAuthority, true);
  assert.equal(receipt.authority.modelPass2SuggestionsAdvisoryOnly, true);
  assert.equal(receipt.authority.pass2DidNotRelabelWholeCatalog, true);
  assert.equal(receipt.authority.reviewWasNotFullyInteractionIsolated, true);
  assert.equal(receipt.authority.doesNotClaimFullMetadataBlindness, true);
  assert.match(receipt.authority.metadataExposureCaveat, /disclosed before/u);
});

test('exact56 materialization is deterministic and hash-provenanced', () => {
  const built = exact56.buildAll(ROOT);
  assert.deepEqual(json(exact56.OUTPUT_PATHS.exact56), built.exact56);
  assert.deepEqual(json(exact56.OUTPUT_PATHS.protocol), built.protocol);
  const protocol = json(exact56.OUTPUT_PATHS.protocol);
  assert.equal(protocol.outputSha256.exact56, sha(exact56.OUTPUT_PATHS.exact56));
  assert.equal(protocol.sourceArtifacts.pass2Protocol.sha256, sha(pass2.OUTPUT_PATHS.protocol));
  assert.match(protocol.authorityStatement, /HUMAN is final authority/u);
  assert.match(protocol.provenanceCaveat, /not fully interaction-isolated/u);
});

test('drop, retention, accepted replacement, and discarded replacement membership are exact', () => {
  const sourceIds = new Set(json(pass2.OUTPUT_PATHS.catalog).candidates.map(entry => entry.semanticSkeletonId));
  const exact = json(exact56.OUTPUT_PATHS.exact56).candidates;
  const exactIds = new Set(exact.map(entry => entry.semanticSkeletonId));
  const acceptedIds = json(exact56.SOURCE_PATHS.replacementCandidates)
    .acceptedReplacements.map(entry => entry.semanticSkeletonId);

  for (const id of exact56.DROP_EXISTING_IDS) assert.equal(exactIds.has(id), false, id);
  for (const id of sourceIds) {
    if (!exact56.DROP_EXISTING_IDS.includes(id)) {
      assert.equal(exact.filter(entry => entry.semanticSkeletonId === id).length, 1, id);
    }
  }
  for (const id of acceptedIds) assert.equal(exactIds.has(id), true, id);
  assert.equal(acceptedIds.length, 7);

  for (const attempt of json(exact56.SOURCE_PATHS.replacementCandidates).discardedReplacementAttempts) {
    assert.equal(exact.some(entry => entry.candidateFocus === attempt.candidateFocus), false, attempt.attemptId);
  }
});

test('exact56 coverage and field surface are frozen', () => {
  const artifact = json(exact56.OUTPUT_PATHS.exact56);
  assert.equal(artifact.candidates.length, 56);
  assert.deepEqual(artifact.coverage.splitCounts, { TRAIN: 24, DEV: 16, FINAL_HELD_OUT: 16 });
  assert.deepEqual(artifact.coverage.humanLabelCounts, { CLEAR: 32, ESCALATE: 24 });
  for (const counts of Object.values(artifact.coverage.boundaryClassSplitCounts)) {
    assert.deepEqual(counts, { TRAIN: 3, DEV: 2, FINAL_HELD_OUT: 2 });
  }

  const ids = new Set();
  const contrastSplits = new Map();
  for (const entry of artifact.candidates) {
    assert.match(entry.semanticSkeletonId, skeletons.SKELETON_ID_PATTERN);
    assert.equal(ids.has(entry.semanticSkeletonId), false, entry.semanticSkeletonId);
    ids.add(entry.semanticSkeletonId);
    assert.equal(Object.hasOwn(entry, 'intendedLabel'), false, entry.semanticSkeletonId);
    assert.equal(Object.hasOwn(entry, 'decisionBasis'), false, entry.semanticSkeletonId);
    if (Object.hasOwn(entry, 'contrastGroupId')) {
      const prior = contrastSplits.get(entry.contrastGroupId);
      if (prior) assert.equal(prior, entry.splitAssignment, entry.contrastGroupId);
      contrastSplits.set(entry.contrastGroupId, entry.splitAssignment);
    }
  }
});

test('historical P1-B3 60 remain outside supervised exact56', () => {
  const exactIds = new Set(json(exact56.OUTPUT_PATHS.exact56).candidates.map(entry => entry.semanticSkeletonId));
  const historicalCases = json(pass2.SOURCE_PATHS.historicalCases).cases.map(row => row.caseId);
  assert.equal(historicalCases.length, 60);
  for (const id of historicalCases) assert.equal(exactIds.has(id), false, id);
  assert.match(json(exact56.OUTPUT_PATHS.exact56).exclusions.historical60, /excluded from supervised/u);
});

test('replacement provenance keeps HUMAN judgment separate from catalog audit inclusion', () => {
  const replacements = json(exact56.SOURCE_PATHS.replacementCandidates);
  assert.equal(replacements.provenance.authoredBy, 'OpenAI ChatGPT assistant');
  assert.equal(replacements.provenance.reviewedBy, 'HUMAN reviewer');
  assert.equal(replacements.provenance.doesNotClaimFullMetadataBlindness, true);
  for (const attempt of replacements.discardedReplacementAttempts) {
    assert.equal(attempt.humanDisposition, 'KEEP');
    assert.match(attempt.humanLabel, /^(CLEAR|ESCALATE)$/u);
    assert.equal(attempt.finalCatalogAuditDecision, 'DROP');
    assert.ok(attempt.finalCatalogAuditReason.length > 0);
  }
});

test('AGENTS.md and CLAUDE.md stay identical except title', () => {
  assert.equal(stripTitle(read('AGENTS.md')), stripTitle(read('CLAUDE.md')));
});
