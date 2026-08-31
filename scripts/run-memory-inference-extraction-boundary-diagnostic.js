#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');

const { WORKLOAD_TYPES } = require('../lib/memory-inference-pilot');
const {
  HARD_GATE_EXPECTATIONS,
  SCHEMA_STATUSES,
  TASK_OUTCOMES,
  validatePilotCase,
} = require('../lib/memory-inference-pilot-contracts');
const {
  CALIBRATION_PROMPT_VERSION,
  CALIBRATION_RUNNER_VERSION,
  MODEL_SIZE_CLASSES,
  runCalibrationCase,
} = require('../lib/memory-inference-local-calibration');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_FIXTURE = path.join(
  ROOT,
  'fixtures/local-memory-inference-p1b2a-extraction-boundary.json',
);
const DIAGNOSTIC_FIXTURE_NAME = 'xion-local-memory-inference-p1b2a-extraction-boundary-v1';
const DIAGNOSTIC_RUNNER_VERSION = 'xion-local-memory-inference-p1b2a-extraction-boundary-runner-v1';
const DIAGNOSTIC_REPORT_VERSION = 'xion-local-memory-inference-p1b2a-extraction-boundary-report-v1';
const DIAGNOSTIC_RUNTIME_VERSION = 'e42214804794fca6abb61b1a5f9adae2a845f0be';
const QUANTITY_SCHEMA_ID = 'p1b1_quantity_unit_v1';
const FIXED_CASE_IDS = Object.freeze([
  'p1b2a-extraction-d0',
  'p1b2a-extraction-d1',
  'p1b2a-extraction-d2',
  'p1b2a-extraction-d3',
  'p1b2a-extraction-d4',
  'p1b2a-extraction-d5',
  'p1b2a-extraction-c1',
  'p1b2a-extraction-c2',
]);
const MODEL_CONFIGURATIONS = Object.freeze({
  [MODEL_SIZE_CLASSES.APPROX_2B]: Object.freeze({
    modelId: 'xion-p1b1-qwen3-1.7b-bf16',
    artifactId: 'unsloth/Qwen3-1.7B-GGUF:BF16',
  }),
  [MODEL_SIZE_CLASSES.APPROX_4B]: Object.freeze({
    modelId: 'xion-p1b1-qwen3-4b-bf16',
    artifactId: 'unsloth/Qwen3-4B-GGUF:BF16',
  }),
});
const FIXED_CALIBRATION_METADATA = Object.freeze({
  schemaFamily: 'quantity_unit',
  screeningClass: 'EXACT_VALUE',
  stratum: 'distractor',
  capabilityProbe: false,
});
const EXPECTED_CASES = Object.freeze({
  'p1b2a-extraction-d0': Object.freeze({
    evidence: '월간 목표 20 pages와 별도로 weekly target은 8 pages다.',
    gold: Object.freeze({ weeklyTarget: 8, unit: 'pages' }),
    sourceCaseId: 'p1b1-extraction-023', kind: 'baseline',
    factor: 'baseline_reproduction', pairedBaselineId: null,
  }),
  'p1b2a-extraction-d1': Object.freeze({
    evidence: 'weekly target은 8 pages다. 별도로 월간 목표는 20 pages다.',
    gold: Object.freeze({ weeklyTarget: 8, unit: 'pages' }),
    sourceCaseId: 'p1b1-extraction-023', kind: 'variant',
    factor: 'target_distractor_order', pairedBaselineId: 'p1b2a-extraction-d0',
  }),
  'p1b2a-extraction-d2': Object.freeze({
    evidence: '월간 목표 20 pages와 별도로 요청한 weekly target은 8 pages다.',
    gold: Object.freeze({ weeklyTarget: 8, unit: 'pages' }),
    sourceCaseId: 'p1b1-extraction-023', kind: 'variant',
    factor: 'explicit_requested_cue', pairedBaselineId: 'p1b2a-extraction-d0',
  }),
  'p1b2a-extraction-d3': Object.freeze({
    evidence: '월간 목표 20 pages와 별도로 주간 목표는 8 pages다.',
    gold: Object.freeze({ weeklyTarget: 8, unit: 'pages' }),
    sourceCaseId: 'p1b1-extraction-023', kind: 'variant',
    factor: 'target_lexical_language', pairedBaselineId: 'p1b2a-extraction-d0',
  }),
  'p1b2a-extraction-d4': Object.freeze({
    evidence: '월간 목표 20 pages와 별도로 weeklyTarget은 8 pages다.',
    gold: Object.freeze({ weeklyTarget: 8, unit: 'pages' }),
    sourceCaseId: 'p1b1-extraction-023', kind: 'variant',
    factor: 'schema_key_lexical_alignment', pairedBaselineId: 'p1b2a-extraction-d0',
  }),
  'p1b2a-extraction-d5': Object.freeze({
    evidence: '월간 목표 20 items와 별도로 weekly target은 8 pages다.',
    gold: Object.freeze({ weeklyTarget: 8, unit: 'pages' }),
    sourceCaseId: 'p1b1-extraction-023', kind: 'variant',
    factor: 'same_unit_competition', pairedBaselineId: 'p1b2a-extraction-d0',
  }),
  'p1b2a-extraction-c1': Object.freeze({
    evidence: '하루 목표는 1회지만 요청한 주간 목표는 5 sessions이다.',
    gold: Object.freeze({ weeklyTarget: 5, unit: 'sessions' }),
    sourceCaseId: 'p1b1-extraction-022', kind: 'control',
    factor: 'frozen_control', pairedBaselineId: null,
  }),
  'p1b2a-extraction-c2': Object.freeze({
    evidence: 'The monthly budget is 30 hours, while the requested weekly target is 4 hours.',
    gold: Object.freeze({ weeklyTarget: 4, unit: 'hours' }),
    sourceCaseId: 'p1b1-extraction-029', kind: 'control',
    factor: 'frozen_control', pairedBaselineId: null,
  }),
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isPlainObject(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function validateDiagnosticFixture(fixture) {
  if (!hasExactKeys(fixture, ['name', 'cases', 'diagnosticMetadata'])) {
    throw new TypeError('P1-B2a fixture에는 name, cases, diagnosticMetadata만 있어야 합니다.');
  }
  if (fixture.name !== DIAGNOSTIC_FIXTURE_NAME || !Array.isArray(fixture.cases)) {
    throw new TypeError('P1-B2a fixture identity가 올바르지 않습니다.');
  }
  const ids = fixture.cases.map(item => item.caseId);
  if (!isDeepStrictEqual(ids, FIXED_CASE_IDS)) {
    throw new TypeError('P1-B2a fixture는 고정된 8개 caseId를 고정 순서로 포함해야 합니다.');
  }
  if (!isPlainObject(fixture.diagnosticMetadata)
      || !isDeepStrictEqual(Object.keys(fixture.diagnosticMetadata).sort(), [...FIXED_CASE_IDS].sort())) {
    throw new TypeError('P1-B2a diagnosticMetadata는 8개 caseId를 정확히 참조해야 합니다.');
  }
  for (const pilotCase of fixture.cases) {
    validatePilotCase(pilotCase);
    const expected = EXPECTED_CASES[pilotCase.caseId];
    const metadata = fixture.diagnosticMetadata[pilotCase.caseId];
    if (
      pilotCase.workloadType !== WORKLOAD_TYPES.STRUCTURED_EXTRACTION
      || pilotCase.sourceType !== 'synthetic'
      || !isDeepStrictEqual(pilotCase.inputPayload, {
        evidence: expected.evidence,
        expectedSchema: QUANTITY_SCHEMA_ID,
      })
      || pilotCase.adjudication.state !== 'PRIMARY_ADJUDICATED'
      || pilotCase.adjudication.primary?.source !== 'PROGRAMMATIC'
      || !isDeepStrictEqual(pilotCase.adjudication.primary.label, expected.gold)
      || pilotCase.ambiguityState !== 'CLEAR'
      || !isDeepStrictEqual(pilotCase.hardGateExpectation, {
        status: HARD_GATE_EXPECTATIONS.DOES_NOT_APPLY,
        guardScope: 'none',
        reasonCode: 'none',
      })
    ) {
      throw new TypeError(`P1-B2a case contract가 preregistration과 다릅니다: ${pilotCase.caseId}`);
    }
    if (!hasExactKeys(metadata, ['sourceCaseId', 'kind', 'factor', 'pairedBaselineId'])
        || !isDeepStrictEqual(metadata, {
          sourceCaseId: expected.sourceCaseId,
          kind: expected.kind,
          factor: expected.factor,
          pairedBaselineId: expected.pairedBaselineId,
        })) {
      throw new TypeError(`P1-B2a diagnostic metadata가 preregistration과 다릅니다: ${pilotCase.caseId}`);
    }
  }
  return fixture;
}

function loadDiagnosticFixture() {
  return validateDiagnosticFixture(JSON.parse(fs.readFileSync(DEFAULT_FIXTURE, 'utf8')));
}

function requiredValue(argv, index, optionName) {
  if (!argv[index + 1] || argv[index + 1].startsWith('--')) {
    throw new Error(`${optionName} 뒤에 값이 필요합니다.`);
  }
  return argv[index + 1];
}

function validateConfiguration(options) {
  const configuration = MODEL_CONFIGURATIONS[options.modelSizeClass];
  if (!configuration) throw new Error('--model-size-class은 ~2B 또는 ~4B여야 합니다.');
  if (options.quantization !== 'BF16') throw new Error('P1-B2a --quantization은 BF16이어야 합니다.');
  if (options.modelId !== configuration.modelId || options.artifactId !== configuration.artifactId) {
    throw new Error('model/artifact는 선택한 P1-B2a 고정 configuration과 일치해야 합니다.');
  }
  if (options.runtimeVersion !== DIAGNOSTIC_RUNTIME_VERSION) {
    throw new Error('P1-B2a runtime version은 preregistered llama.cpp commit이어야 합니다.');
  }
  return options;
}

function parseArguments(argv) {
  const options = {
    endpoint: null,
    modelId: null,
    artifactId: null,
    quantization: null,
    modelSizeClass: null,
    runtimeVersion: null,
    timeoutMs: 60_000,
    commit: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--endpoint') {
      options.endpoint = requiredValue(argv, index, '--endpoint'); index += 1;
    } else if (argument === '--model') {
      options.modelId = requiredValue(argv, index, '--model'); index += 1;
    } else if (argument === '--artifact') {
      options.artifactId = requiredValue(argv, index, '--artifact'); index += 1;
    } else if (argument === '--quantization') {
      options.quantization = requiredValue(argv, index, '--quantization'); index += 1;
    } else if (argument === '--model-size-class') {
      options.modelSizeClass = requiredValue(argv, index, '--model-size-class'); index += 1;
    } else if (argument === '--runtime-version') {
      options.runtimeVersion = requiredValue(argv, index, '--runtime-version'); index += 1;
    } else if (argument === '--timeout-ms') {
      options.timeoutMs = Number(requiredValue(argv, index, '--timeout-ms'));
      if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) {
        throw new Error('--timeout-ms는 1 이상의 정수여야 합니다.');
      }
      index += 1;
    } else if (argument === '--commit') {
      options.commit = requiredValue(argv, index, '--commit'); index += 1;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`알 수 없는 인자입니다: ${argument}`);
    }
  }
  if (!options.help) {
    for (const [name, value] of [
      ['--endpoint', options.endpoint], ['--model', options.modelId],
      ['--artifact', options.artifactId], ['--quantization', options.quantization],
      ['--model-size-class', options.modelSizeClass], ['--runtime-version', options.runtimeVersion],
    ]) {
      if (!value) throw new Error(`${name}이 필요합니다.`);
    }
    validateConfiguration(options);
  }
  return options;
}

function normalizeRunnerOptions(options) {
  return validateConfiguration({
    ...options,
    runtimeFamily: 'llama.cpp',
    quantization: options.quantization,
  });
}

function summarizeRuns(runs) {
  return {
    totalCases: runs.length,
    schemaValidCases: runs.filter(run => (
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
  };
}

async function runDiagnosticFixture(fixture, runnerOptions) {
  validateDiagnosticFixture(fixture);
  const options = normalizeRunnerOptions(runnerOptions);
  const runs = [];
  for (const pilotCase of fixture.cases) {
    runs.push(await runCalibrationCase(pilotCase, FIXED_CALIBRATION_METADATA, options));
  }
  const observations = runs.map(run => {
    const direct = run.result.directResult;
    return {
      caseId: run.caseId,
      diagnosticMetadata: { ...fixture.diagnosticMetadata[run.caseId] },
      structuredOutput: direct.structuredOutput,
      schemaStatus: direct.schemaStatus,
      taskOutcome: direct.taskOutcome,
      semanticExactMatch: run.semanticScoring.reasonCode === 'MATCH'
        ? true
        : run.semanticScoring.reasonCode === 'MISMATCH' ? false : null,
      semanticScoring: run.semanticScoring,
      runtime: direct.runtime,
      error: direct.error,
      result: run.result,
    };
  });
  const configuration = runs[0].result.configuration;
  return {
    reportVersion: DIAGNOSTIC_REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    fixture: { name: fixture.name, sourceType: 'synthetic', cases: fixture.cases.length },
    provenance: {
      galpiCommit: options.commit,
      modelId: options.modelId,
      artifactId: options.artifactId,
      quantization: options.quantization,
      modelSizeClass: options.modelSizeClass,
      runtimeFamily: 'llama.cpp',
      runtimeVersion: options.runtimeVersion,
      diagnosticRunnerVersion: DIAGNOSTIC_RUNNER_VERSION,
      p1b1RunnerVersion: configuration.runnerVersion,
      promptVersion: configuration.promptVersion,
      taskContractVersion: configuration.taskContractVersion,
      taskSpecificationVersion: configuration.taskSpecificationVersion,
      outputSchemaVersion: configuration.outputSchemaVersion,
      fixtureIdentity: fixture.name,
    },
    policyType: 'LOCAL_ONLY',
    summary: summarizeRuns(runs),
    observations,
  };
}

function exitCodeForReport(report) {
  return report.summary.runtimeFailures > 0 ? 1 : 0;
}

function helpText() {
  return [
    'Usage: npm run research:memory-inference-extraction-boundary -- [options]',
    '',
    'Required:',
    '  --endpoint <url>          별도로 실행 중인 OpenAI-compatible base URL',
    '  --model <id>              고정 ~2B 또는 ~4B model ID',
    '  --artifact <id>           선택 size의 고정 BF16 artifact ID',
    '  --quantization BF16       BF16만 허용',
    '  --model-size-class <id>   ~2B | ~4B',
    `  --runtime-version <id>    고정: ${DIAGNOSTIC_RUNTIME_VERSION}`,
    '',
    'Optional:',
    '  --timeout-ms <N>          요청 안전 timeout, 기본 60000',
    '  --commit <sha>            기본: 현재 Galpi git HEAD',
    '  -h, --help                도움말',
    '',
    '고정된 8개 P1-B2a case만 실행하며 runtime/model을 관리하지 않습니다.',
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
  const report = await runDiagnosticFixture(loadDiagnosticFixture(), {
    ...options,
    commit: options.commit || currentCommit(),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return exitCodeForReport(report);
}

module.exports = {
  DEFAULT_FIXTURE,
  DIAGNOSTIC_FIXTURE_NAME,
  DIAGNOSTIC_REPORT_VERSION,
  DIAGNOSTIC_RUNNER_VERSION,
  DIAGNOSTIC_RUNTIME_VERSION,
  EXPECTED_CASES,
  FIXED_CALIBRATION_METADATA,
  FIXED_CASE_IDS,
  MODEL_CONFIGURATIONS,
  exitCodeForReport,
  helpText,
  loadDiagnosticFixture,
  main,
  parseArguments,
  runDiagnosticFixture,
  summarizeRuns,
  validateDiagnosticFixture,
};

if (require.main === module) {
  main().then(
    exitCode => { process.exitCode = exitCode; },
    error => {
      console.error(`Memory inference P1-B2a diagnostic failed: ${error.message}`);
      process.exitCode = 1;
    },
  );
}
