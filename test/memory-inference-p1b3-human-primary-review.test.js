'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { TASK_SPECIFICATIONS } = require('../lib/memory-inference-local-calibration');
const {
  CANDIDATE_FIXTURE_NAME,
  DEFAULT_CANDIDATE_FIXTURE,
  DEFAULT_OUTPUT,
  EXTRACTION_SCHEMA_IDS,
  FIXED_CASE_IDS,
  FIXED_REVIEW_ORDER,
  LABELS,
  REVIEW_PROTOCOL_VERSION,
  buildCompletedMapping,
  conductBlindReview,
  helpText,
  loadCandidateFixture,
  parseReviewChoice,
  renderReviewPrompt,
  shuffledCandidates,
  validateCandidateFixture,
  writeCompletedMapping,
} = require('../scripts/review-memory-inference-p1b3-human-primary-gold');

const ROOT = path.resolve(__dirname, '..');
const AUTHORING_KEY = path.join(
  ROOT,
  'fixtures/local-memory-inference-p1b3-decomposed-pipeline-authoring-key-v2.json',
);
const SUPERSEDED_CANDIDATE_FIXTURE = path.join(
  ROOT,
  'fixtures/local-memory-inference-p1b3-decomposed-pipeline-candidates.json',
);
const SUPERSEDED_AUTHORING_KEY = path.join(
  ROOT,
  'fixtures/local-memory-inference-p1b3-decomposed-pipeline-authoring-key.json',
);
const REVIEWER_SOURCE = path.join(
  ROOT,
  'scripts/review-memory-inference-p1b3-human-primary-gold.js',
);
const EXISTING_FIXTURES = [
  'fixtures/local-memory-inference-p1b1-synthetic.json',
  'fixtures/local-memory-inference-p1b2a-extraction-boundary.json',
  'fixtures/local-memory-inference-p1b2b-triage-label-semantics.json',
  'fixtures/local-memory-inference-p1b2c-triage-validation-candidates.json',
  'fixtures/local-memory-inference-p1b2d-triage-boundary-candidates.json',
  'fixtures/local-memory-inference-p1b3-decomposed-pipeline-candidates.json',
].map(relativePath => path.join(ROOT, relativePath));

function candidateBytes() {
  return fs.readFileSync(DEFAULT_CANDIDATE_FIXTURE);
}

function authoringKeyBytes() {
  return fs.readFileSync(AUTHORING_KEY);
}

function normalizedEvidence(value) {
  return String(value).normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

test('P1-B3 v2 candidate fixture has 60 fixed gold-free exact-distinct local-eligible cases', () => {
  const raw = JSON.parse(fs.readFileSync(DEFAULT_CANDIDATE_FIXTURE, 'utf8'));
  const fixture = loadCandidateFixture();
  assert.equal(validateCandidateFixture(fixture), fixture);
  assert.equal(fixture.name, CANDIDATE_FIXTURE_NAME);
  assert.equal(fixture.cases.length, 60);
  assert.deepEqual(fixture.cases.map(item => item.caseId), [...FIXED_CASE_IDS]);
  assert.deepEqual(Object.keys(raw), ['name', 'cases']);

  const forbiddenKeys = new Set([
    'label',
    'gold',
    'adjudication',
    'authoringTarget',
    'extractionGold',
    'intendedClass',
    'constructionClass',
    'hardGateExpectation',
  ]);
  function inspectKeys(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `forbidden candidate key: ${key}`);
      inspectKeys(nested);
    }
  }
  inspectKeys(raw);

  const existingEvidence = new Set();
  for (const fixturePath of EXISTING_FIXTURES) {
    const existing = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    for (const priorCase of existing.cases) {
      existingEvidence.add(normalizedEvidence(priorCase.inputPayload.evidence));
    }
  }
  const candidateEvidence = new Set();
  for (const candidate of fixture.cases) {
    assert.deepEqual(Object.keys(candidate), ['caseId', 'inputPayload']);
    assert.match(candidate.caseId, /^p1b3-decomposed-v2-\d{3}$/u);
    assert.doesNotMatch(candidate.caseId, /no.?write|write.?candidate|escalate|date|text|quantity/iu);
    assert.deepEqual(Object.keys(candidate.inputPayload), ['evidence', 'expectedSchema']);
    assert.ok(EXTRACTION_SCHEMA_IDS.includes(candidate.inputPayload.expectedSchema));
    const normalized = normalizedEvidence(candidate.inputPayload.evidence);
    assert.equal(existingEvidence.has(normalized), false);
    assert.equal(candidateEvidence.has(normalized), false);
    candidateEvidence.add(normalized);
    assert.doesNotMatch(
      candidate.inputPayload.evidence,
      /동명이인|같은 이름의 두 (?:사람|계정)|명시적으로 정정|핵심 정체성|법적 권한|permission decision|authorization decision|safety decision/iu,
    );
  }
});

test('separate authoring key matches all candidates, validates extraction gold, and keeps 20/20/20 targets', () => {
  const fixture = loadCandidateFixture();
  const key = JSON.parse(fs.readFileSync(AUTHORING_KEY, 'utf8'));
  assert.deepEqual(Object.keys(key), ['name', 'candidateFixture', 'cases']);
  assert.equal(
    key.name,
    'xion-local-memory-inference-p1b3-decomposed-pipeline-authoring-key-v2',
  );
  assert.equal(key.candidateFixture, CANDIDATE_FIXTURE_NAME);
  assert.deepEqual(Object.keys(key.cases), [...FIXED_CASE_IDS]);

  const counts = Object.fromEntries(LABELS.map(label => [label, 0]));
  for (const candidate of fixture.cases) {
    const entry = key.cases[candidate.caseId];
    assert.deepEqual(Object.keys(entry), ['authoringTarget', 'extractionGold']);
    assert.ok(LABELS.includes(entry.authoringTarget));
    counts[entry.authoringTarget] += 1;
    const specification = TASK_SPECIFICATIONS[candidate.inputPayload.expectedSchema];
    assert.ok(specification, `missing frozen schema: ${candidate.inputPayload.expectedSchema}`);
    assert.equal(specification.validate(entry.extractionGold), true, candidate.caseId);
  }
  assert.deepEqual(counts, { NO_WRITE: 20, WRITE_CANDIDATE: 20, ESCALATE: 20 });
});

test('superseded v1 artifacts remain preserved under identities distinct from v2', () => {
  const candidate = JSON.parse(fs.readFileSync(SUPERSEDED_CANDIDATE_FIXTURE, 'utf8'));
  const key = JSON.parse(fs.readFileSync(SUPERSEDED_AUTHORING_KEY, 'utf8'));
  assert.equal(
    candidate.name,
    'xion-local-memory-inference-p1b3-decomposed-pipeline-candidates-v1',
  );
  assert.equal(
    key.name,
    'xion-local-memory-inference-p1b3-decomposed-pipeline-authoring-key-v1',
  );
  assert.notEqual(candidate.name, CANDIDATE_FIXTURE_NAME);
  assert.notEqual(key.candidateFixture, CANDIDATE_FIXTURE_NAME);
  assert.throws(
    () => loadCandidateFixture(SUPERSEDED_CANDIDATE_FIXTURE),
    /fixture identity가 올바르지/,
  );
});

test('P1-B3 blind review order is one fixed deterministic permutation', () => {
  const fixture = loadCandidateFixture();
  assert.equal(FIXED_REVIEW_ORDER.length, 60);
  assert.deepEqual(
    [...FIXED_REVIEW_ORDER].sort((a, b) => a - b),
    Array.from({ length: 60 }, (_, index) => index),
  );
  const first = shuffledCandidates(fixture).map(item => item.caseId);
  const second = shuffledCandidates(fixture).map(item => item.caseId);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, fixture.cases.map(item => item.caseId));
  assert.deepEqual(first.slice(0, 3), [
    'p1b3-decomposed-v2-002',
    'p1b3-decomposed-v2-022',
    'p1b3-decomposed-v2-021',
  ]);
});

test('reviewer loads no authoring key and displays only evidence with the three fixed choices', () => {
  const fixture = loadCandidateFixture();
  const reviewed = shuffledCandidates(fixture)[0];
  const prompt = renderReviewPrompt(reviewed.inputPayload.evidence, 0, fixture.cases.length);
  const source = fs.readFileSync(REVIEWER_SOURCE, 'utf8');
  assert.match(prompt, /^Review 01\/60\n\n/u);
  assert.equal(prompt.includes(reviewed.inputPayload.evidence), true);
  assert.equal(prompt.includes(reviewed.caseId), false);
  assert.equal(prompt.includes(reviewed.inputPayload.expectedSchema), false);
  assert.doesNotMatch(prompt, /authoring|gold|expectedSchema|caseId|rationale|confidence/iu);
  assert.doesNotMatch(source, /decomposed-pipeline-authoring-key|authoringTarget|extractionGold/u);
  assert.deepEqual(LABELS, ['NO_WRITE', 'WRITE_CANDIDATE', 'ESCALATE']);
  assert.equal((prompt.match(/NO_WRITE/gu) || []).length, 1);
  assert.equal((prompt.match(/WRITE_CANDIDATE/gu) || []).length, 1);
  assert.equal((prompt.match(/ESCALATE/gu) || []).length, 1);
  assert.equal(parseReviewChoice('1'), 'NO_WRITE');
  assert.equal(parseReviewChoice('2'), 'WRITE_CANDIDATE');
  assert.equal(parseReviewChoice('3'), 'ESCALATE');
  assert.equal(parseReviewChoice('NO_WRITE'), null);
  assert.equal(parseReviewChoice('4'), null);
});

test('partial blind review writes nothing and mutates neither fixture nor authoring key', async () => {
  const fixture = loadCandidateFixture();
  const beforeFixture = structuredClone(fixture);
  const beforeCandidateBytes = candidateBytes();
  const beforeKeyBytes = authoringKeyBytes();
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'xion-p1b3-partial-'));
  const outputPath = path.join(temporaryDirectory, 'labels.json');
  let answers = 0;
  await assert.rejects(
    conductBlindReview(fixture, {
      outputPath,
      ask: async prompt => {
        assert.doesNotMatch(prompt, /p1b3-decomposed-v2-|expectedSchema/iu);
        answers += 1;
        if (answers === 7) throw new Error('synthetic interruption');
        return '1';
      },
    }),
    /synthetic interruption/,
  );
  assert.equal(fs.existsSync(outputPath), false);
  assert.deepEqual(fixture, beforeFixture);
  assert.deepEqual(candidateBytes(), beforeCandidateBytes);
  assert.deepEqual(authoringKeyBytes(), beforeKeyBytes);
});

test('complete blind review writes every case exactly once with fixed provenance', async () => {
  const fixture = loadCandidateFixture();
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'xion-p1b3-complete-'));
  const outputPath = path.join(temporaryDirectory, 'labels.json');
  const prompts = [];
  const mapping = await conductBlindReview(fixture, {
    outputPath,
    completedAt: '2026-09-03T00:00:00.000Z',
    ask: async prompt => {
      prompts.push(prompt);
      return String((prompts.length % 3) + 1);
    },
  });
  assert.equal(prompts.length, 60);
  assert.ok(prompts.every(prompt => !prompt.includes('p1b3-decomposed-v2-')));
  assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, 'utf8')), mapping);
  assert.equal(mapping.protocolVersion, REVIEW_PROTOCOL_VERSION);
  assert.equal(mapping.protocolVersion, 'xion-p1b3-human-primary-v1');
  assert.equal(mapping.candidateFixture, CANDIDATE_FIXTURE_NAME);
  assert.equal(mapping.labels.length, 60);
  assert.deepEqual(mapping.labels.map(item => item.caseId), [...FIXED_CASE_IDS]);
  assert.equal(new Set(mapping.labels.map(item => item.caseId)).size, 60);
  assert.ok(mapping.labels.every(item => LABELS.includes(item.label)));
});

test('completed mapping is complete-only and output creation is write-once', () => {
  const fixture = loadCandidateFixture();
  assert.throws(() => buildCompletedMapping(fixture, new Map()), /60개 blind HUMAN label/);
  const labels = new Map(fixture.cases.map(item => [item.caseId, 'NO_WRITE']));
  labels.set(fixture.cases[0].caseId, 'OTHER');
  assert.throws(() => buildCompletedMapping(fixture, labels), /label이 올바르지/);

  labels.set(fixture.cases[0].caseId, 'NO_WRITE');
  const mapping = buildCompletedMapping(fixture, labels, '2026-09-03T00:00:00.000Z');
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'xion-p1b3-write-once-'));
  const outputPath = path.join(temporaryDirectory, 'labels.json');
  writeCompletedMapping(outputPath, mapping);
  assert.throws(() => writeCompletedMapping(outputPath, mapping), /EEXIST/);
});

test('P1-B3 review CLI is narrow and uses the fixed local output', () => {
  assert.equal(DEFAULT_OUTPUT, '/tmp/xion-p1b3-human-primary-labels.json');
  assert.match(helpText(), new RegExp(REVIEW_PROTOCOL_VERSION, 'u'));
  assert.match(helpText(), new RegExp(DEFAULT_OUTPUT, 'u'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(
    packageJson.scripts['review:memory-inference-p1b3-human-primary-gold'],
    'node scripts/review-memory-inference-p1b3-human-primary-gold.js',
  );
});
