#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_CANDIDATE_FIXTURE = path.join(
  ROOT,
  'fixtures/local-memory-inference-p1b2c-triage-validation-candidates.json',
);
const DEFAULT_OUTPUT = '/tmp/xion-p1b2c-human-primary-labels.json';
const CANDIDATE_FIXTURE_NAME = 'xion-local-memory-inference-p1b2c-triage-validation-candidates-v1';
const REVIEW_PROTOCOL_VERSION = 'xion-p1b2c-human-primary-v1';
const LABELS = Object.freeze(['NO_WRITE', 'WRITE_CANDIDATE', 'ESCALATE']);
const FIXED_REVIEW_ORDER = Object.freeze([
  12, 2, 25, 7, 19, 0, 28, 14, 5, 22,
  9, 17, 3, 26, 11, 21, 6, 29, 15, 1,
  24, 8, 18, 4, 27, 13, 23, 10, 20, 16,
]);
const FIXED_CASE_IDS = Object.freeze(Array.from({ length: 30 }, (_, index) => (
  `p1b2c-triage-validation-${String(index + 1).padStart(3, '0')}`
)));

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isPlainObject(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function validateCandidateFixture(fixture) {
  if (!hasExactKeys(fixture, ['name', 'cases'])) {
    throw new TypeError('P1-B2c candidate fixture에는 name과 cases만 있어야 합니다.');
  }
  if (fixture.name !== CANDIDATE_FIXTURE_NAME || !Array.isArray(fixture.cases)) {
    throw new TypeError('P1-B2c candidate fixture identity가 올바르지 않습니다.');
  }
  if (JSON.stringify(fixture.cases.map(item => item.caseId)) !== JSON.stringify(FIXED_CASE_IDS)) {
    throw new TypeError('P1-B2c candidate fixture는 고정된 30개 opaque ID를 순서대로 포함해야 합니다.');
  }
  for (const candidate of fixture.cases) {
    if (
      !hasExactKeys(candidate, ['caseId', 'workloadType', 'inputPayload'])
      || candidate.workloadType !== 'write_candidate_triage'
      || !hasExactKeys(candidate.inputPayload, ['evidence'])
      || typeof candidate.inputPayload.evidence !== 'string'
      || candidate.inputPayload.evidence.trim() === ''
    ) {
      throw new TypeError(`P1-B2c evidence-only candidate가 올바르지 않습니다: ${candidate.caseId}`);
    }
  }
  return fixture;
}

function loadCandidateFixture(fixturePath = DEFAULT_CANDIDATE_FIXTURE) {
  return validateCandidateFixture(JSON.parse(fs.readFileSync(fixturePath, 'utf8')));
}

function shuffledCandidates(fixture) {
  validateCandidateFixture(fixture);
  return FIXED_REVIEW_ORDER.map(index => fixture.cases[index]);
}

function renderReviewPrompt(evidence, reviewIndex, total) {
  return [
    `Review ${String(reviewIndex + 1).padStart(2, '0')}/${total}`,
    '',
    evidence,
    '',
    '1. NO_WRITE',
    '2. WRITE_CANDIDATE',
    '3. ESCALATE',
    '> ',
  ].join('\n');
}

function parseReviewChoice(value) {
  const choice = String(value).trim();
  if (choice === '1') return LABELS[0];
  if (choice === '2') return LABELS[1];
  if (choice === '3') return LABELS[2];
  return null;
}

function buildCompletedMapping(fixture, labelsByCaseId, completedAt = new Date().toISOString()) {
  validateCandidateFixture(fixture);
  if (!(labelsByCaseId instanceof Map) || labelsByCaseId.size !== fixture.cases.length) {
    throw new TypeError('30개 blind HUMAN label이 모두 있어야 completed mapping을 만들 수 있습니다.');
  }
  const labels = fixture.cases.map(candidate => {
    const label = labelsByCaseId.get(candidate.caseId);
    if (!LABELS.includes(label)) {
      throw new TypeError(`완료 mapping의 label이 올바르지 않습니다: ${candidate.caseId}`);
    }
    return { caseId: candidate.caseId, label };
  });
  return {
    protocolVersion: REVIEW_PROTOCOL_VERSION,
    candidateFixture: fixture.name,
    completedAt,
    labels,
  };
}

function writeCompletedMapping(outputPath, mapping) {
  fs.writeFileSync(outputPath, `${JSON.stringify(mapping, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
}

async function conductBlindReview(fixture, options) {
  const { ask, outputPath = DEFAULT_OUTPUT, completedAt } = options;
  const ordered = shuffledCandidates(fixture);
  const labelsByCaseId = new Map();
  for (let index = 0; index < ordered.length; index += 1) {
    const candidate = ordered[index];
    const prompt = renderReviewPrompt(candidate.inputPayload.evidence, index, ordered.length);
    let label = null;
    while (!label) label = parseReviewChoice(await ask(prompt));
    labelsByCaseId.set(candidate.caseId, label);
  }
  const mapping = buildCompletedMapping(fixture, labelsByCaseId, completedAt);
  writeCompletedMapping(outputPath, mapping);
  return mapping;
}

function helpText() {
  return [
    'Usage: npm run review:memory-inference-p1b2c-triage-gold',
    '',
    `Protocol: ${REVIEW_PROTOCOL_VERSION}`,
    `Completed output: ${DEFAULT_OUTPUT}`,
    '30개 응답이 모두 끝난 뒤에만 output을 새로 만듭니다.',
  ].join('\n');
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length > 0) {
    if (argv.length === 1 && ['-h', '--help'].includes(argv[0])) {
      process.stdout.write(`${helpText()}\n`);
      return 0;
    }
    throw new Error('P1-B2c blind review command는 조정 인자를 허용하지 않습니다.');
  }
  if (fs.existsSync(DEFAULT_OUTPUT)) {
    throw new Error(`기존 output을 덮어쓰지 않습니다: ${DEFAULT_OUTPUT}`);
  }
  const review = readline.createInterface({ input: process.stdin, output: process.stdout });
  process.stdout.write('P1-B2c blind HUMAN primary review: 모든 30개 응답 완료 후에만 결과를 저장합니다.\n\n');
  try {
    await conductBlindReview(loadCandidateFixture(), {
      ask: prompt => review.question(prompt),
      outputPath: DEFAULT_OUTPUT,
    });
  } finally {
    review.close();
  }
  process.stdout.write(`완료: ${DEFAULT_OUTPUT}\n`);
  return 0;
}

module.exports = {
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
  main,
  parseReviewChoice,
  renderReviewPrompt,
  shuffledCandidates,
  validateCandidateFixture,
  writeCompletedMapping,
};

if (require.main === module) {
  main().then(
    exitCode => { process.exitCode = exitCode; },
    error => {
      console.error(`P1-B2c blind HUMAN review failed: ${error.message}`);
      process.exitCode = 1;
    },
  );
}
