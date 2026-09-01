'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CANDIDATE_FIXTURE_NAME,
  DEFAULT_CANDIDATE_FIXTURE,
  DEFAULT_OUTPUT,
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
} = require('../scripts/review-memory-inference-p1b2c-triage-gold');

const ROOT = path.resolve(__dirname, '..');
const P1B1_FIXTURE = path.join(ROOT, 'fixtures/local-memory-inference-p1b1-synthetic.json');

function candidateBytes() {
  return fs.readFileSync(DEFAULT_CANDIDATE_FIXTURE);
}

test('P1-B2c candidate fixture is fixed, evidence-only, fresh, and non-hard-gated', () => {
  const raw = JSON.parse(fs.readFileSync(DEFAULT_CANDIDATE_FIXTURE, 'utf8'));
  const fixture = loadCandidateFixture();
  assert.equal(validateCandidateFixture(fixture), fixture);
  assert.equal(fixture.name, CANDIDATE_FIXTURE_NAME);
  assert.equal(fixture.cases.length, 30);
  assert.deepEqual(fixture.cases.map(item => item.caseId), [...FIXED_CASE_IDS]);
  assert.deepEqual(Object.keys(raw), ['name', 'cases']);

  const forbiddenKeys = new Set([
    'label',
    'gold',
    'adjudication',
    'intendedClass',
    'intendedLabel',
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

  const source = JSON.parse(fs.readFileSync(P1B1_FIXTURE, 'utf8'));
  const existingEvidence = new Set(source.cases
    .filter(item => item.workloadType === 'write_candidate_triage')
    .map(item => item.inputPayload.evidence));
  for (const candidate of fixture.cases) {
    assert.deepEqual(Object.keys(candidate), ['caseId', 'workloadType', 'inputPayload']);
    assert.equal(candidate.workloadType, 'write_candidate_triage');
    assert.deepEqual(Object.keys(candidate.inputPayload), ['evidence']);
    assert.equal(existingEvidence.has(candidate.inputPayload.evidence), false);
    assert.doesNotMatch(
      candidate.inputPayload.evidence,
      /동명이인|같은 이름의 두 (?:사람|계정)|명시적으로 정정|핵심 정체성|법적 권한|permission decision|authorization decision|safety decision/iu,
    );
  }
});

test('blind review order is one fixed deterministic permutation', () => {
  const fixture = loadCandidateFixture();
  assert.equal(FIXED_REVIEW_ORDER.length, 30);
  assert.deepEqual([...FIXED_REVIEW_ORDER].sort((a, b) => a - b), (
    Array.from({ length: 30 }, (_, index) => index)
  ));
  const first = shuffledCandidates(fixture).map(item => item.caseId);
  const second = shuffledCandidates(fixture).map(item => item.caseId);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, fixture.cases.map(item => item.caseId));
});

test('review prompt exposes only opaque index, evidence, and exactly three labels', () => {
  const fixture = loadCandidateFixture();
  const reviewed = shuffledCandidates(fixture)[0];
  const prompt = renderReviewPrompt(reviewed.inputPayload.evidence, 0, fixture.cases.length);
  assert.match(prompt, /^Review 01\/30\n\n/u);
  assert.equal(prompt.includes(reviewed.inputPayload.evidence), true);
  assert.equal(prompt.includes(reviewed.caseId), false);
  assert.deepEqual(LABELS, ['NO_WRITE', 'WRITE_CANDIDATE', 'ESCALATE']);
  assert.equal((prompt.match(/NO_WRITE/gu) || []).length, 1);
  assert.equal((prompt.match(/WRITE_CANDIDATE/gu) || []).length, 1);
  assert.equal((prompt.match(/ESCALATE/gu) || []).length, 1);
  assert.equal(parseReviewChoice('1'), 'NO_WRITE');
  assert.equal(parseReviewChoice('2'), 'WRITE_CANDIDATE');
  assert.equal(parseReviewChoice('3'), 'ESCALATE');
  assert.equal(parseReviewChoice('WRITE_CANDIDATE'), null);
  assert.equal(parseReviewChoice('4'), null);
});

test('an incomplete blind review writes nothing and never mutates the candidate fixture', async () => {
  const fixture = loadCandidateFixture();
  const beforeFixture = structuredClone(fixture);
  const beforeBytes = candidateBytes();
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'xion-p1b2c-partial-'));
  const outputPath = path.join(temporaryDirectory, 'labels.json');
  let answers = 0;
  await assert.rejects(
    conductBlindReview(fixture, {
      outputPath,
      ask: async prompt => {
        assert.doesNotMatch(prompt, /p1b2c-triage-validation-/u);
        answers += 1;
        if (answers === 4) throw new Error('synthetic interruption');
        return '1';
      },
    }),
    /synthetic interruption/,
  );
  assert.equal(fs.existsSync(outputPath), false);
  assert.deepEqual(fixture, beforeFixture);
  assert.deepEqual(candidateBytes(), beforeBytes);
});

test('completed blind review writes every case exactly once without exposing caseId in prompts', async () => {
  const fixture = loadCandidateFixture();
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'xion-p1b2c-complete-'));
  const outputPath = path.join(temporaryDirectory, 'labels.json');
  const prompts = [];
  const mapping = await conductBlindReview(fixture, {
    outputPath,
    completedAt: '2026-09-01T00:00:00.000Z',
    ask: async prompt => {
      prompts.push(prompt);
      return String((prompts.length % 3) + 1);
    },
  });
  assert.equal(prompts.length, 30);
  assert.ok(prompts.every(prompt => !prompt.includes('p1b2c-triage-validation-')));
  assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, 'utf8')), mapping);
  assert.equal(mapping.protocolVersion, REVIEW_PROTOCOL_VERSION);
  assert.equal(mapping.candidateFixture, CANDIDATE_FIXTURE_NAME);
  assert.equal(mapping.labels.length, 30);
  assert.deepEqual(mapping.labels.map(item => item.caseId), [...FIXED_CASE_IDS]);
  assert.equal(new Set(mapping.labels.map(item => item.caseId)).size, 30);
  assert.ok(mapping.labels.every(item => LABELS.includes(item.label)));
  assert.throws(() => fs.writeFileSync(outputPath, 'overwrite', { flag: 'wx' }), /EEXIST/);
});

test('completed mapping is fail-closed until all 30 labels exist', () => {
  const fixture = loadCandidateFixture();
  assert.throws(() => buildCompletedMapping(fixture, new Map()), /30개 blind HUMAN label/);
  const labels = new Map(fixture.cases.map(item => [item.caseId, 'NO_WRITE']));
  labels.set(fixture.cases[0].caseId, 'OTHER');
  assert.throws(() => buildCompletedMapping(fixture, labels), /label이 올바르지/);
});

test('blind review CLI is narrow and uses the fixed local output', () => {
  assert.equal(DEFAULT_OUTPUT, '/tmp/xion-p1b2c-human-primary-labels.json');
  assert.match(helpText(), new RegExp(REVIEW_PROTOCOL_VERSION, 'u'));
  assert.match(helpText(), new RegExp(DEFAULT_OUTPUT, 'u'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(
    packageJson.scripts['review:memory-inference-p1b2c-triage-gold'],
    'node scripts/review-memory-inference-p1b2c-triage-gold.js',
  );
});
