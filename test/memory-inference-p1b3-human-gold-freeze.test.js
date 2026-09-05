'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const PRIMARY_ARTIFACT = 'fixtures/local-memory-inference-p1b3-human-primary-labels.json';
const RESOLUTION_ARTIFACT = 'fixtures/local-memory-inference-p1b3-human-resolution.json';
const RESOLVED_ARTIFACT = 'fixtures/local-memory-inference-p1b3-human-resolved-labels.json';
const CANDIDATE_FIXTURE = 'xion-local-memory-inference-p1b3-decomposed-pipeline-candidates-v2';
const PRIMARY_PROTOCOL = 'xion-p1b3-human-primary-v1';
const COMPLETED_AT = '2026-09-04T09:12:16.673Z';
const RESOLUTION_VERSION = 'xion-local-memory-inference-p1b3-human-resolution-v1';
const RESOLVED_VERSION = 'xion-local-memory-inference-p1b3-human-resolved-labels-v1';
const CASE_033 = 'p1b3-decomposed-v2-033';
const LABELS = ['NO_WRITE', 'WRITE_CANDIDATE', 'ESCALATE'];
const IDS = Array.from({ length: 60 }, (_, index) => (
  `p1b3-decomposed-v2-${String(index + 1).padStart(3, '0')}`
));
const primaryBytes = fs.readFileSync(path.join(ROOT, PRIMARY_ARTIFACT));
const primary = JSON.parse(primaryBytes);
const resolution = JSON.parse(fs.readFileSync(path.join(ROOT, RESOLUTION_ARTIFACT), 'utf8'));
const resolved = JSON.parse(fs.readFileSync(path.join(ROOT, RESOLVED_ARTIFACT), 'utf8'));
const candidates = JSON.parse(fs.readFileSync(path.join(
  ROOT, 'fixtures/local-memory-inference-p1b3-decomposed-pipeline-candidates-v2.json',
), 'utf8'));

function distribution(rows) {
  return Object.fromEntries(LABELS.map(label => [
    label, rows.filter(row => row.label === label).length,
  ]));
}

test('P1-B3 primary HUMAN provenance preserves the exact completed source bytes and 21/19/20', () => {
  // SHA-256 of the actual completed /tmp artifact, read before copying; no regeneration.
  assert.equal(createHash('sha256').update(primaryBytes).digest('hex'),
    '9e852bcea91b4ab362e28de641467ac7b724d401b2bb41b985fd756ccaaaf77f');
  assert.deepEqual(Object.keys(primary), ['protocolVersion', 'candidateFixture', 'completedAt', 'labels']);
  assert.equal(primary.protocolVersion, PRIMARY_PROTOCOL);
  assert.equal(primary.candidateFixture, CANDIDATE_FIXTURE);
  assert.equal(primary.completedAt, COMPLETED_AT);
  assert.deepEqual(primary.labels.map(row => row.caseId), IDS);
  assert.deepEqual(distribution(primary.labels), { NO_WRITE: 21, WRITE_CANDIDATE: 19, ESCALATE: 20 });
  assert.equal(primary.labels.find(row => row.caseId === CASE_033).label, 'NO_WRITE');
});

test('P1-B3 records only the post-primary evidence re-review of 033 with qualified provenance', () => {
  assert.deepEqual(Object.keys(resolution), [
    'name', 'candidateFixture', 'primaryArtifact', 'primaryProtocolVersion',
    'primaryCompletedAt', 'resolutions',
  ]);
  assert.equal(resolution.name, RESOLUTION_VERSION);
  assert.equal(resolution.candidateFixture, CANDIDATE_FIXTURE);
  assert.equal(resolution.primaryArtifact, PRIMARY_ARTIFACT);
  assert.equal(resolution.primaryProtocolVersion, primary.protocolVersion);
  assert.equal(resolution.primaryCompletedAt, primary.completedAt);
  assert.equal(resolution.resolutions.length, 1);
  const [entry] = resolution.resolutions;
  assert.deepEqual(Object.keys(entry), [
    'caseId', 'primaryLabel', 'secondPassLabel', 'finalResolvedHumanLabel',
    'reason', 'provenance', 'reviewerRecollection',
  ]);
  assert.equal(entry.caseId, CASE_033);
  assert.equal(entry.primaryLabel, primary.labels.find(row => row.caseId === entry.caseId).label);
  assert.equal(entry.secondPassLabel, 'WRITE_CANDIDATE');
  assert.equal(entry.finalResolvedHumanLabel, 'WRITE_CANDIDATE');
  assert.match(entry.reason, /정기 재검토 일정은 2028-11-11로 이미 고정되어 있다/u);
  assert.match(entry.reason, /evidence and rubric, not by agreement with a construction target/u);
  assert.match(entry.provenance.selectionTrigger, /After the blind primary review was complete.*mismatch.*post-primary evidence re-review/u);
  assert.equal(entry.provenance.preregisteredIndependentSecondPass, false);
  assert.equal(entry.provenance.authoringTargetDisclosedBeforeSecondPassSelection, false);
  assert.match(entry.provenance.reviewerPresentedWith, /original evidence.*NO_WRITE \/ WRITE_CANDIDATE \/ ESCALATE/u);
  assert.equal(entry.provenance.p1b3ModelOutputExisted, false);
  assert.equal(entry.provenance.authoringTargetDisclosedOnlyAfterSecondPassSelection, true);
  assert.equal(entry.provenance.authoringTargetIsClassGoldAuthority, false);
  assert.equal(entry.reviewerRecollection.status, 'UNVERIFIED_RECOLLECTION');
  assert.match(entry.reviewerRecollection.statement, /may have intended to press option 2/u);
  assert.match(entry.reviewerRecollection.statement, /not independently verified/u);
});

test('P1-B3 effective HUMAN gold matches all 60 candidate IDs, changes only 033, and passes the floor', () => {
  assert.deepEqual(Object.keys(resolved), [
    'name', 'candidateFixture', 'primaryArtifact', 'primaryProtocolVersion',
    'primaryCompletedAt', 'resolutionArtifact', 'resolutionVersion', 'labels',
  ]);
  assert.equal(resolved.name, RESOLVED_VERSION);
  assert.equal(resolved.candidateFixture, CANDIDATE_FIXTURE);
  assert.equal(resolved.primaryArtifact, PRIMARY_ARTIFACT);
  assert.equal(resolved.primaryProtocolVersion, primary.protocolVersion);
  assert.equal(resolved.primaryCompletedAt, primary.completedAt);
  assert.equal(resolved.resolutionArtifact, RESOLUTION_ARTIFACT);
  assert.equal(resolved.resolutionVersion, resolution.name);
  assert.equal(candidates.name, CANDIDATE_FIXTURE);
  assert.deepEqual(candidates.cases.map(row => row.caseId), IDS);
  for (const artifact of [primary, resolved]) {
    assert.equal(artifact.labels.length, 60);
    assert.deepEqual(artifact.labels.map(row => row.caseId), IDS);
    for (const row of artifact.labels) {
      assert.deepEqual(Object.keys(row), ['caseId', 'label']);
      assert.ok(LABELS.includes(row.label));
    }
  }
  assert.deepEqual(resolved.labels.filter((row, index) => (
    row.label !== primary.labels[index].label
  )).map(row => row.caseId), [CASE_033]);
  assert.deepEqual(distribution(resolved.labels), { NO_WRITE: 20, WRITE_CANDIDATE: 20, ESCALATE: 20 });
  assert.ok(Object.values(distribution(resolved.labels)).every(count => count >= 15));
});

test('P1-B3 class gold is exactly the primary plus explicit HUMAN resolutions, without authoringTarget', () => {
  // The complete derivation reads only HUMAN artifacts; no authoring key is loaded.
  const overrides = new Map(resolution.resolutions.map(row => [row.caseId, row.finalResolvedHumanLabel]));
  const expected = primary.labels.map(({ caseId, label }) => ({
    caseId, label: overrides.has(caseId) ? overrides.get(caseId) : label,
  }));
  assert.deepEqual(resolved.labels, expected);
  for (const artifact of [primary, resolution, resolved]) {
    assert.doesNotMatch(JSON.stringify(artifact), /"(?:authoringTarget|extractionGold|modelOutput|modelScore)":/u);
  }
});
