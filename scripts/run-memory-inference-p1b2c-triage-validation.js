#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');

const { WORKLOAD_TYPES } = require('../lib/memory-inference-pilot');
const {
  CASE_CONTRACT_VERSION,
  POLICY_TYPES,
  SCHEMA_STATUSES,
  TASK_OUTCOMES,
  validatePilotCase,
} = require('../lib/memory-inference-pilot-contracts');
const {
  MODEL_SIZE_CLASSES,
  TASK_SPECIFICATIONS,
} = require('../lib/memory-inference-local-calibration');
const {
  DEFINED_LABELS_PROMPT_VERSION,
  DIAGNOSTIC_RUNNER_VERSION,
  DIAGNOSTIC_RUNTIME_VERSION,
  runDefinedLabelSemanticsCase,
} = require('./run-memory-inference-triage-label-semantics-diagnostic');
const {
  CANDIDATE_FIXTURE_NAME,
  FIXED_CASE_IDS,
  LABELS,
  REVIEW_PROTOCOL_VERSION,
  loadCandidateFixture,
} = require('./review-memory-inference-p1b2c-triage-gold');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_FIXTURE = path.join(
  ROOT,
  'fixtures/local-memory-inference-p1b2c-triage-validation.json',
);
const DEFAULT_HUMAN_REVIEW = path.join(
  ROOT,
  'fixtures/local-memory-inference-p1b2c-human-primary-labels.json',
);
const VALIDATION_FIXTURE_NAME = 'xion-local-memory-inference-p1b2c-triage-validation-v1';
const VALIDATION_RUNNER_VERSION = 'xion-local-memory-inference-p1b2c-triage-validation-runner-v1';
const VALIDATION_REPORT_VERSION = 'xion-local-memory-inference-p1b2c-triage-validation-report-v1';
const HUMAN_REVIEW_COMPLETED_AT = '2026-09-01T09:20:26.476Z';
const FIXED_TIMEOUT_MS = 180_000;
const CALLS_PLANNED = 30;
const LABEL_DISTRIBUTION = Object.freeze({
  NO_WRITE: 10,
  WRITE_CANDIDATE: 10,
  ESCALATE: 10,
});
const ACTUAL_BUCKETS = Object.freeze([...LABELS, 'INVALID', 'RUNTIME_FAILURE']);
const FIXED_MODEL_CONFIGURATION = Object.freeze({
  modelId: 'xion-p1b1-qwen3-4b-bf16',
  artifactId: 'unsloth/Qwen3-4B-GGUF:BF16',
  modelSizeClass: MODEL_SIZE_CLASSES.APPROX_4B,
  quantization: 'BF16',
  runtimeFamily: 'llama.cpp',
  runtimeVersion: DIAGNOSTIC_RUNTIME_VERSION,
});
const TRIAGE_SPECIFICATION = TASK_SPECIFICATIONS[WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE];
const FINAL_DISPOSITIONS = Object.freeze({
  PASS: 'PASS_FRESH_SYNTHETIC_VALIDATION',
  FAIL: 'FAIL_FRESH_SYNTHETIC_VALIDATION',
  INDETERMINATE_RUNTIME: 'INDETERMINATE_RUNTIME',
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isPlainObject(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function countLabels(labels) {
  return Object.fromEntries(LABELS.map(label => [
    label,
    labels.filter(value => value === label).length,
  ]));
}

function validateHumanReview(review) {
  if (!hasExactKeys(review, ['protocolVersion', 'candidateFixture', 'completedAt', 'labels'])) {
    throw new TypeError('P1-B2c HUMAN review provenance key가 올바르지 않습니다.');
  }
  if (
    review.protocolVersion !== REVIEW_PROTOCOL_VERSION
    || review.candidateFixture !== CANDIDATE_FIXTURE_NAME
    || review.completedAt !== HUMAN_REVIEW_COMPLETED_AT
    || !Array.isArray(review.labels)
    || review.labels.length !== CALLS_PLANNED
  ) {
    throw new TypeError('P1-B2c HUMAN review provenance identity가 올바르지 않습니다.');
  }
  for (const entry of review.labels) {
    if (!hasExactKeys(entry, ['caseId', 'label']) || !LABELS.includes(entry.label)) {
      throw new TypeError(`P1-B2c HUMAN label mapping이 올바르지 않습니다: ${entry?.caseId}`);
    }
  }
  if (!isDeepStrictEqual(review.labels.map(entry => entry.caseId), FIXED_CASE_IDS)) {
    throw new TypeError('P1-B2c HUMAN mapping은 고정된 30개 ID를 정확히 한 번씩 포함해야 합니다.');
  }
  if (!isDeepStrictEqual(countLabels(review.labels.map(entry => entry.label)), LABEL_DISTRIBUTION)) {
    throw new TypeError('P1-B2c HUMAN gold 분포는 정확히 10/10/10이어야 합니다.');
  }
  return review;
}

function loadHumanReview(reviewPath = DEFAULT_HUMAN_REVIEW) {
  return validateHumanReview(JSON.parse(fs.readFileSync(reviewPath, 'utf8')));
}

function expectedPilotCase(candidate, label) {
  return {
    caseId: candidate.caseId,
    workloadType: candidate.workloadType,
    sourceType: 'synthetic',
    taskContractVersion: CASE_CONTRACT_VERSION,
    inputPayload: candidate.inputPayload,
    adjudication: {
      state: 'PRIMARY_ADJUDICATED',
      primary: { source: 'HUMAN', label },
      blindSecondPass: null,
      disagreementState: 'NOT_ASSESSED',
      finalResolvedHumanLabel: null,
      cloudAssistedReview: {
        performed: false,
        configurationId: null,
        suggestion: null,
      },
    },
    ambiguityState: label === 'ESCALATE' ? 'AMBIGUOUS' : 'CLEAR',
    hardGateExpectation: {
      status: 'DOES_NOT_APPLY',
      guardScope: 'none',
      reasonCode: 'none',
    },
  };
}

function validateValidationFixture(
  fixture,
  candidates = loadCandidateFixture(),
  review = loadHumanReview(),
) {
  validateHumanReview(review);
  if (!hasExactKeys(fixture, ['name', 'cases'])) {
    throw new TypeError('P1-B2c validation fixture에는 name과 cases만 있어야 합니다.');
  }
  if (
    fixture.name !== VALIDATION_FIXTURE_NAME
    || !Array.isArray(fixture.cases)
    || fixture.cases.length !== CALLS_PLANNED
    || !isDeepStrictEqual(fixture.cases.map(item => item.caseId), FIXED_CASE_IDS)
  ) {
    throw new TypeError('P1-B2c validation fixture identity 또는 case set이 올바르지 않습니다.');
  }
  const labelByCaseId = new Map(review.labels.map(entry => [entry.caseId, entry.label]));
  for (let index = 0; index < fixture.cases.length; index += 1) {
    const pilotCase = fixture.cases[index];
    validatePilotCase(pilotCase);
    const expected = expectedPilotCase(candidates.cases[index], labelByCaseId.get(pilotCase.caseId));
    if (!isDeepStrictEqual(pilotCase, expected)) {
      throw new TypeError(`P1-B2c validation case가 candidate/HUMAN source와 다릅니다: ${pilotCase.caseId}`);
    }
  }
  const distribution = countLabels(fixture.cases.map(item => item.adjudication.primary.label));
  if (!isDeepStrictEqual(distribution, LABEL_DISTRIBUTION)) {
    throw new TypeError('P1-B2c final fixture가 HUMAN 10/10/10 fail-close를 통과하지 못했습니다.');
  }
  return fixture;
}

function loadValidationFixture(fixturePath = DEFAULT_FIXTURE) {
  return validateValidationFixture(JSON.parse(fs.readFileSync(fixturePath, 'utf8')));
}

function calibrationMetadataForCase(pilotCase) {
  const gold = pilotCase.adjudication.primary.label;
  const strata = {
    NO_WRITE: 'no_write',
    WRITE_CANDIDATE: 'write_candidate',
    ESCALATE: 'eligible_escalate',
  };
  return {
    schemaFamily: null,
    screeningClass: gold,
    capabilityProbe: false,
    stratum: strata[gold],
  };
}

function actualBucket(run) {
  const direct = run.result.directResult;
  if (direct.taskOutcome === TASK_OUTCOMES.NOT_RUN) return 'RUNTIME_FAILURE';
  if (direct.schemaStatus !== SCHEMA_STATUSES.VALID) return 'INVALID';
  return direct.structuredOutput.decision;
}

function emptyConfusionMatrix() {
  return Object.fromEntries(LABELS.map(gold => [
    gold,
    Object.fromEntries(ACTUAL_BUCKETS.map(actual => [actual, 0])),
  ]));
}

function summarizeRuns(runs) {
  const confusionMatrix = emptyConfusionMatrix();
  for (const run of runs) {
    confusionMatrix[run.calibration.screeningClass][actualBucket(run)] += 1;
  }
  return {
    totalCases: runs.length,
    schemaValidOutputs: runs.filter(run => (
      run.result.directResult.schemaStatus === SCHEMA_STATUSES.VALID
    )).length,
    invalidStructuredOutputs: runs.filter(run => (
      run.result.directResult.schemaStatus === SCHEMA_STATUSES.INVALID
    )).length,
    runtimeFailures: runs.filter(run => (
      run.result.directResult.taskOutcome === TASK_OUTCOMES.NOT_RUN
    )).length,
    exactMatches: runs.filter(run => run.semanticScoring.reasonCode === 'MATCH').length,
    mismatches: runs.filter(run => run.semanticScoring.reasonCode === 'MISMATCH').length,
    confusionMatrix,
    correctNoWrite: { numerator: confusionMatrix.NO_WRITE.NO_WRITE, denominator: 10 },
    correctWriteCandidate: {
      numerator: confusionMatrix.WRITE_CANDIDATE.WRITE_CANDIDATE,
      denominator: 10,
    },
    correctEscalate: { numerator: confusionMatrix.ESCALATE.ESCALATE, denominator: 10 },
    eligibleFalseNoWriteCount: runs.filter(run => (
      ['WRITE_CANDIDATE', 'ESCALATE'].includes(run.calibration.screeningClass)
      && actualBucket(run) === 'NO_WRITE'
    )).length,
  };
}

function acceptanceForSummary(summary) {
  const gates = {
    zeroRuntimeFailures: {
      actual: summary.runtimeFailures,
      required: 0,
      passed: summary.runtimeFailures === 0,
    },
    zeroEligibleFalseNoWrite: {
      actual: summary.eligibleFalseNoWriteCount,
      required: 0,
      passed: summary.eligibleFalseNoWriteCount === 0,
    },
    correctNoWrite: {
      actual: summary.correctNoWrite.numerator,
      denominator: 10,
      requiredMinimum: 8,
      passed: summary.correctNoWrite.numerator >= 8,
    },
    correctWriteCandidate: {
      actual: summary.correctWriteCandidate.numerator,
      denominator: 10,
      requiredMinimum: 8,
      passed: summary.correctWriteCandidate.numerator >= 8,
    },
    correctEscalate: {
      actual: summary.correctEscalate.numerator,
      denominator: 10,
      requiredMinimum: 8,
      passed: summary.correctEscalate.numerator >= 8,
    },
  };
  let finalDisposition;
  if (summary.runtimeFailures > 0) {
    finalDisposition = FINAL_DISPOSITIONS.INDETERMINATE_RUNTIME;
  } else if (
    gates.zeroEligibleFalseNoWrite.passed
    && gates.correctNoWrite.passed
    && gates.correctWriteCandidate.passed
    && gates.correctEscalate.passed
  ) {
    finalDisposition = FINAL_DISPOSITIONS.PASS;
  } else {
    finalDisposition = FINAL_DISPOSITIONS.FAIL;
  }
  return { gates, finalDisposition };
}

function observationForRun(run) {
  const direct = run.result.directResult;
  return {
    caseId: run.caseId,
    humanGoldLabel: run.calibration.screeningClass,
    structuredOutput: direct.structuredOutput,
    schemaStatus: direct.schemaStatus,
    taskOutcome: direct.taskOutcome,
    semanticExactMatch: run.semanticScoring.reasonCode === 'MATCH'
      ? true
      : run.semanticScoring.reasonCode === 'MISMATCH' ? false : null,
    semanticExactMatchState: run.semanticScoring.reasonCode,
    runtime: direct.runtime,
    error: direct.error,
    underlyingPilotResult: run.result,
  };
}

function validateConfiguration(options) {
  for (const key of [
    'modelId', 'artifactId', 'modelSizeClass', 'quantization', 'runtimeVersion',
  ]) {
    if (options[key] !== FIXED_MODEL_CONFIGURATION[key]) {
      throw new Error(`P1-B2c ${key}는 고정 ~4B BF16 configuration과 일치해야 합니다.`);
    }
  }
  return options;
}

async function runValidationFixture(fixture, runnerOptions) {
  validateValidationFixture(fixture);
  const review = loadHumanReview();
  const options = validateConfiguration({
    ...runnerOptions,
    runtimeFamily: FIXED_MODEL_CONFIGURATION.runtimeFamily,
    timeoutMs: FIXED_TIMEOUT_MS,
  });
  const runs = [];
  for (const pilotCase of fixture.cases) {
    runs.push(await runDefinedLabelSemanticsCase(
      pilotCase,
      calibrationMetadataForCase(pilotCase),
      options,
    ));
  }
  const summary = summarizeRuns(runs);
  const acceptance = acceptanceForSummary(summary);
  return {
    reportVersion: VALIDATION_REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    fixture: { name: fixture.name, sourceType: 'synthetic', cases: fixture.cases.length },
    humanReview: {
      protocolVersion: review.protocolVersion,
      candidateFixture: review.candidateFixture,
      completedAt: review.completedAt,
      labelsComplete: review.labels.length,
      distribution: LABEL_DISTRIBUTION,
    },
    provenance: {
      galpiCommit: options.commit,
      modelId: options.modelId,
      artifactId: options.artifactId,
      modelSizeClass: options.modelSizeClass,
      quantization: options.quantization,
      runtimeFamily: FIXED_MODEL_CONFIGURATION.runtimeFamily,
      runtimeVersion: options.runtimeVersion,
      validationRunnerVersion: VALIDATION_RUNNER_VERSION,
      underlyingDefinedLabelExecutionRunnerVersion: DIAGNOSTIC_RUNNER_VERSION,
      promptVersion: DEFINED_LABELS_PROMPT_VERSION,
      taskContractVersion: CASE_CONTRACT_VERSION,
      taskSpecificationVersion: TRIAGE_SPECIFICATION.taskSpecificationVersion,
      outputSchemaVersion: TRIAGE_SPECIFICATION.outputSchemaVersion,
      fixtureIdentity: fixture.name,
    },
    execution: {
      timeoutMs: FIXED_TIMEOUT_MS,
      callsPlanned: CALLS_PLANNED,
      callsCompleted: runs.length,
      automaticReruns: false,
    },
    policyType: POLICY_TYPES.LOCAL_ONLY,
    observations: runs.map(observationForRun),
    summary,
    acceptanceGates: acceptance.gates,
    finalDisposition: acceptance.finalDisposition,
  };
}

function exitCodeForReport(report) {
  return report.finalDisposition === FINAL_DISPOSITIONS.INDETERMINATE_RUNTIME ? 1 : 0;
}

function requiredValue(argv, index, optionName) {
  if (!argv[index + 1] || argv[index + 1].startsWith('--')) {
    throw new Error(`${optionName} 뒤에 값이 필요합니다.`);
  }
  return argv[index + 1];
}

function parseArguments(argv) {
  const options = {
    endpoint: null,
    modelId: null,
    artifactId: null,
    quantization: null,
    modelSizeClass: null,
    runtimeVersion: null,
    help: false,
  };
  const names = {
    '--endpoint': 'endpoint',
    '--model': 'modelId',
    '--artifact': 'artifactId',
    '--quantization': 'quantization',
    '--model-size-class': 'modelSizeClass',
    '--runtime-version': 'runtimeVersion',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (Object.hasOwn(names, argument)) {
      options[names[argument]] = requiredValue(argv, index, argument);
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`알 수 없는 인자입니다: ${argument}`);
    }
  }
  if (!options.help) {
    for (const [argument, property] of Object.entries(names)) {
      if (!options[property]) throw new Error(`${argument}이 필요합니다.`);
    }
    validateConfiguration(options);
  }
  return options;
}

function helpText() {
  return [
    'Usage: npm run research:memory-inference-p1b2c-triage-validation -- [options]',
    '',
    'Required:',
    '  --endpoint <url>          별도로 실행 중인 OpenAI-compatible base URL',
    `  --model ${FIXED_MODEL_CONFIGURATION.modelId}`,
    `  --artifact ${FIXED_MODEL_CONFIGURATION.artifactId}`,
    '  --quantization BF16',
    '  --model-size-class ~4B',
    `  --runtime-version ${FIXED_MODEL_CONFIGURATION.runtimeVersion}`,
    '',
    '고정된 30개 case를 각각 한 번 실행하며 timeout은 180000ms이고 자동 재실행하지 않습니다.',
  ].join('\n');
}

function currentCommit() {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${helpText()}\n`);
    return 0;
  }
  const report = await runValidationFixture(loadValidationFixture(), {
    ...options,
    commit: currentCommit(),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return exitCodeForReport(report);
}

module.exports = {
  CALLS_PLANNED,
  DEFAULT_FIXTURE,
  DEFAULT_HUMAN_REVIEW,
  FINAL_DISPOSITIONS,
  FIXED_MODEL_CONFIGURATION,
  FIXED_TIMEOUT_MS,
  HUMAN_REVIEW_COMPLETED_AT,
  LABEL_DISTRIBUTION,
  VALIDATION_FIXTURE_NAME,
  VALIDATION_REPORT_VERSION,
  VALIDATION_RUNNER_VERSION,
  acceptanceForSummary,
  calibrationMetadataForCase,
  exitCodeForReport,
  helpText,
  loadHumanReview,
  loadValidationFixture,
  main,
  parseArguments,
  runValidationFixture,
  summarizeRuns,
  validateConfiguration,
  validateHumanReview,
  validateValidationFixture,
};

if (require.main === module) {
  main().then(
    exitCode => { process.exitCode = exitCode; },
    error => {
      console.error(`Memory inference P1-B2c validation failed: ${error.message}`);
      process.exitCode = 1;
    },
  );
}
