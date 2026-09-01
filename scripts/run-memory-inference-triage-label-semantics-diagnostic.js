#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');

const { WORKLOAD_TYPES } = require('../lib/memory-inference-pilot');
const {
  HARD_GATE_EXPECTATIONS,
  POLICY_TYPES,
  SCHEMA_STATUSES,
  TASK_OUTCOMES,
  validatePilotCase,
  validatePilotResult,
} = require('../lib/memory-inference-pilot-contracts');
const {
  CALIBRATION_PROMPT_VERSION,
  CALIBRATION_RUNNER_VERSION,
  MODEL_SIZE_CLASSES,
  PROMPT_INSTRUCTIONS,
  TASK_SPECIFICATIONS,
  buildCalibrationPrompt,
  loadCalibrationFixture,
  runCalibrationCase,
} = require('../lib/memory-inference-local-calibration');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_FIXTURE = path.join(
  ROOT,
  'fixtures/local-memory-inference-p1b2b-triage-label-semantics.json',
);
const P1B1_FIXTURE = path.join(ROOT, 'fixtures/local-memory-inference-p1b1-synthetic.json');
const DIAGNOSTIC_FIXTURE_NAME = 'xion-local-memory-inference-p1b2b-triage-label-semantics-v1';
const DIAGNOSTIC_CONFIGURATION_VERSION = 'xion-local-memory-inference-p1b2b-triage-label-semantics-config-v1';
const DIAGNOSTIC_RUNNER_VERSION = 'xion-local-memory-inference-p1b2b-triage-label-semantics-runner-v1';
const DIAGNOSTIC_REPORT_VERSION = 'xion-local-memory-inference-p1b2b-triage-label-semantics-report-v1';
const DIAGNOSTIC_RUNTIME_VERSION = 'e42214804794fca6abb61b1a5f9adae2a845f0be';
const DEFINED_LABELS_PROMPT_VERSION = 'xion-local-memory-inference-p1b2b-triage-defined-labels-prompt-v1';
const TRIAGE_SPECIFICATION = TASK_SPECIFICATIONS[WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE];
const LABELS = Object.freeze(['NO_WRITE', 'WRITE_CANDIDATE', 'ESCALATE']);
const ACTUAL_BUCKETS = Object.freeze([...LABELS, 'INVALID', 'RUNTIME_FAILURE']);
const CONDITIONS = Object.freeze({
  FROZEN_P1B1: 'FROZEN_P1B1',
  DEFINED_LABEL_SEMANTICS: 'DEFINED_LABEL_SEMANTICS',
});
const PAIRED_TRANSITIONS = Object.freeze({
  UNCHANGED_CORRECT: 'UNCHANGED_CORRECT',
  FIXED: 'FIXED',
  REGRESSION: 'REGRESSION',
  UNCHANGED_WRONG: 'UNCHANGED_WRONG',
  NONCOMPARABLE_RUNTIME_OR_SCHEMA: 'NONCOMPARABLE_RUNTIME_OR_SCHEMA',
});
const DEFINED_LABEL_SEMANTICS_INSTRUCTION = [
  'Classify the supplied evidence into exactly one advisory triage label.',
  'NO_WRITE: the evidence is clearly transient, request-local, or otherwise not a durable memory candidate.',
  'WRITE_CANDIDATE: the evidence clearly states a sufficiently persistent fact, preference, goal, constraint, or state that may be worth durable-memory review.',
  'ESCALATE: the supplied evidence is insufficient or ambiguous in persistence, scope, reference, or meaning in a way that prevents safely deciding between NO_WRITE and WRITE_CANDIDATE. Do not resolve that ambiguity yourself.',
  'This classification is advisory only and does not authorize a durable write.',
].join('\n');
const FIXED_CASE_IDS = Object.freeze([
  ...Array.from({ length: 10 }, (_, index) => (
    `p1b1-triage-no-write-${String(index + 1).padStart(3, '0')}`
  )),
  ...Array.from({ length: 10 }, (_, index) => (
    `p1b1-triage-write-${String(index + 1).padStart(3, '0')}`
  )),
  ...Array.from({ length: 5 }, (_, index) => (
    `p1b1-triage-escalate-${String(index + 1).padStart(3, '0')}`
  )),
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isPlainObject(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function validateDiagnosticFixture(fixture, p1b1Fixture = loadCalibrationFixture(P1B1_FIXTURE)) {
  if (!hasExactKeys(fixture, ['name', 'cases'])) {
    throw new TypeError('P1-B2b fixture에는 name과 cases만 있어야 합니다.');
  }
  if (fixture.name !== DIAGNOSTIC_FIXTURE_NAME || !Array.isArray(fixture.cases)) {
    throw new TypeError('P1-B2b fixture identity가 올바르지 않습니다.');
  }
  if (!isDeepStrictEqual(fixture.cases.map(item => item.caseId), FIXED_CASE_IDS)) {
    throw new TypeError('P1-B2b fixture는 고정된 25개 caseId를 고정 순서로 포함해야 합니다.');
  }
  for (const pilotCase of fixture.cases) {
    validatePilotCase(pilotCase);
    const source = p1b1Fixture.cases.find(item => item.caseId === pilotCase.caseId);
    const metadata = p1b1Fixture.calibrationMetadata[pilotCase.caseId];
    if (
      !source
      || !isDeepStrictEqual(pilotCase, source)
      || pilotCase.workloadType !== WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE
      || pilotCase.adjudication.primary?.source !== 'HUMAN'
      || pilotCase.hardGateExpectation.status === HARD_GATE_EXPECTATIONS.APPLIES
      || metadata?.capabilityProbe !== false
      || metadata?.screeningClass !== pilotCase.adjudication.primary.label
    ) {
      throw new TypeError(`P1-B2b case가 frozen P1-B1 source와 다릅니다: ${pilotCase.caseId}`);
    }
  }
  const goldCounts = Object.fromEntries(LABELS.map(label => [
    label,
    fixture.cases.filter(item => item.adjudication.primary.label === label).length,
  ]));
  if (!isDeepStrictEqual(goldCounts, { NO_WRITE: 10, WRITE_CANDIDATE: 10, ESCALATE: 5 })) {
    throw new TypeError('P1-B2b gold 분포는 NO_WRITE 10 / WRITE_CANDIDATE 10 / ESCALATE 5여야 합니다.');
  }
  return fixture;
}

function loadDiagnosticFixture() {
  const fixture = JSON.parse(fs.readFileSync(DEFAULT_FIXTURE, 'utf8'));
  return validateDiagnosticFixture(fixture);
}

function sourceMetadataByCase() {
  const source = loadCalibrationFixture(P1B1_FIXTURE);
  return Object.fromEntries(FIXED_CASE_IDS.map(caseId => [
    caseId,
    source.calibrationMetadata[caseId],
  ]));
}

function buildDefinedLabelSemanticsPrompt(pilotCase) {
  if (pilotCase.workloadType !== WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE) {
    throw new TypeError('P1-B2b defined prompt는 write_candidate_triage case만 허용합니다.');
  }
  const frozen = buildCalibrationPrompt(pilotCase);
  const prompt = structuredClone(frozen);
  const frozenLine = `INSTRUCTION: ${PROMPT_INSTRUCTIONS[WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE]}`;
  const lines = prompt.messages[1].content.split('\n');
  const indexes = lines.flatMap((line, index) => line === frozenLine ? [index] : []);
  if (indexes.length !== 1) {
    throw new TypeError('frozen P1-B1 triage INSTRUCTION 경계를 정확히 찾을 수 없습니다.');
  }
  lines[indexes[0]] = `INSTRUCTION: ${DEFINED_LABEL_SEMANTICS_INSTRUCTION}`;
  prompt.promptVersion = DEFINED_LABELS_PROMPT_VERSION;
  prompt.messages[1].content = lines.join('\n');
  return prompt;
}

function diagnosticConfiguration(configuration) {
  const identity = {
    ...configuration,
    version: DIAGNOSTIC_CONFIGURATION_VERSION,
    runnerVersion: DIAGNOSTIC_RUNNER_VERSION,
    promptVersion: DEFINED_LABELS_PROMPT_VERSION,
  };
  const digest = crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  return {
    ...configuration,
    configurationId: `p1b2b-${digest.slice(0, 24)}`,
    version: DIAGNOSTIC_CONFIGURATION_VERSION,
    runnerVersion: DIAGNOSTIC_RUNNER_VERSION,
    promptVersion: DEFINED_LABELS_PROMPT_VERSION,
  };
}

async function runDefinedLabelSemanticsCase(pilotCase, metadata, runnerOptions) {
  const frozenPrompt = buildCalibrationPrompt(pilotCase);
  const definedPrompt = buildDefinedLabelSemanticsPrompt(pilotCase);
  const delegateFetch = runnerOptions.fetchImpl || globalThis.fetch;
  let requestCount = 0;
  const fetchImpl = async (url, init) => {
    requestCount += 1;
    if (requestCount !== 1) throw new Error('P1-B2b condition은 case당 한 번만 호출할 수 있습니다.');
    const body = JSON.parse(init.body);
    if (!isDeepStrictEqual(body.messages, frozenPrompt.messages)) {
      throw new Error('P1-B2b Condition B가 frozen P1-B1 request scaffold에서 벗어났습니다.');
    }
    return delegateFetch(url, {
      ...init,
      body: JSON.stringify({ ...body, messages: definedPrompt.messages }),
    });
  };
  const frozenRun = await runCalibrationCase(pilotCase, metadata, {
    ...runnerOptions,
    fetchImpl,
  });
  if (requestCount !== 1) throw new Error('P1-B2b Condition B request가 정확히 한 번 실행되지 않았습니다.');
  const run = structuredClone(frozenRun);
  run.result.configuration = diagnosticConfiguration(run.result.configuration);
  run.result.directResult.configurationId = run.result.configuration.configurationId;
  validatePilotResult(run.result);
  return run;
}

function actualBucket(run) {
  const direct = run.result.directResult;
  if (direct.taskOutcome === TASK_OUTCOMES.NOT_RUN) return 'RUNTIME_FAILURE';
  if (direct.schemaStatus !== SCHEMA_STATUSES.VALID) return 'INVALID';
  return direct.structuredOutput.decision;
}

function emptyConfusion() {
  return Object.fromEntries(LABELS.map(gold => [
    gold,
    Object.fromEntries(ACTUAL_BUCKETS.map(actual => [actual, 0])),
  ]));
}

function summarizeConditionRuns(runs) {
  const confusion = emptyConfusion();
  for (const run of runs) confusion[run.calibration.screeningClass][actualBucket(run)] += 1;
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
    confusion,
    correctNoWrite: { numerator: confusion.NO_WRITE.NO_WRITE, denominator: 10 },
    correctWriteCandidate: {
      numerator: confusion.WRITE_CANDIDATE.WRITE_CANDIDATE,
      denominator: 10,
    },
    correctEscalate: { numerator: confusion.ESCALATE.ESCALATE, denominator: 5 },
    eligibleFalseNoWriteCount: runs.filter(run => (
      ['WRITE_CANDIDATE', 'ESCALATE'].includes(run.calibration.screeningClass)
      && actualBucket(run) === 'NO_WRITE'
    )).length,
  };
}

function isComparable(run) {
  return run.result.directResult.schemaStatus === SCHEMA_STATUSES.VALID
    && ['MATCH', 'MISMATCH'].includes(run.semanticScoring.reasonCode);
}

function pairedTransition(conditionA, conditionB) {
  if (!isComparable(conditionA) || !isComparable(conditionB)) {
    return PAIRED_TRANSITIONS.NONCOMPARABLE_RUNTIME_OR_SCHEMA;
  }
  const aCorrect = conditionA.semanticScoring.reasonCode === 'MATCH';
  const bCorrect = conditionB.semanticScoring.reasonCode === 'MATCH';
  if (aCorrect && bCorrect) return PAIRED_TRANSITIONS.UNCHANGED_CORRECT;
  if (!aCorrect && bCorrect) return PAIRED_TRANSITIONS.FIXED;
  if (aCorrect && !bCorrect) return PAIRED_TRANSITIONS.REGRESSION;
  return PAIRED_TRANSITIONS.UNCHANGED_WRONG;
}

function summarizePairedTransitions(observations) {
  const counts = {
    unchangedCorrect: 0,
    fixes: 0,
    regressions: 0,
    unchangedWrong: 0,
    nonComparable: 0,
  };
  const keys = {
    [PAIRED_TRANSITIONS.UNCHANGED_CORRECT]: 'unchangedCorrect',
    [PAIRED_TRANSITIONS.FIXED]: 'fixes',
    [PAIRED_TRANSITIONS.REGRESSION]: 'regressions',
    [PAIRED_TRANSITIONS.UNCHANGED_WRONG]: 'unchangedWrong',
    [PAIRED_TRANSITIONS.NONCOMPARABLE_RUNTIME_OR_SCHEMA]: 'nonComparable',
  };
  for (const observation of observations) counts[keys[observation.pairedTransition]] += 1;
  return counts;
}

function conditionObservation(run) {
  const direct = run.result.directResult;
  return {
    promptVersion: run.result.configuration.promptVersion,
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
}

function validateConfiguration(options) {
  const configuration = MODEL_CONFIGURATIONS[options.modelSizeClass];
  if (!configuration) throw new Error('--model-size-class은 ~2B 또는 ~4B여야 합니다.');
  if (options.quantization !== 'BF16') throw new Error('P1-B2b --quantization은 BF16이어야 합니다.');
  if (options.modelId !== configuration.modelId || options.artifactId !== configuration.artifactId) {
    throw new Error('model/artifact는 선택한 P1-B2b 고정 configuration과 일치해야 합니다.');
  }
  if (options.runtimeVersion !== DIAGNOSTIC_RUNTIME_VERSION) {
    throw new Error('P1-B2b runtime version은 preregistered llama.cpp commit이어야 합니다.');
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

async function runDiagnosticFixture(fixture, runnerOptions) {
  validateDiagnosticFixture(fixture);
  const options = normalizeRunnerOptions(runnerOptions);
  const metadataByCase = sourceMetadataByCase();
  const pairs = [];
  for (const pilotCase of fixture.cases) {
    const metadata = metadataByCase[pilotCase.caseId];
    const conditionA = await runCalibrationCase(pilotCase, metadata, options);
    const conditionB = await runDefinedLabelSemanticsCase(pilotCase, metadata, options);
    pairs.push({ pilotCase, conditionA, conditionB });
  }
  const conditionARuns = pairs.map(pair => pair.conditionA);
  const conditionBRuns = pairs.map(pair => pair.conditionB);
  const observations = pairs.map(({ pilotCase, conditionA, conditionB }) => ({
    caseId: pilotCase.caseId,
    goldLabel: pilotCase.adjudication.primary.label,
    [CONDITIONS.FROZEN_P1B1]: conditionObservation(conditionA),
    [CONDITIONS.DEFINED_LABEL_SEMANTICS]: conditionObservation(conditionB),
    pairedTransition: pairedTransition(conditionA, conditionB),
  }));
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
      p1b1RunnerVersion: CALIBRATION_RUNNER_VERSION,
      frozenPromptVersion: CALIBRATION_PROMPT_VERSION,
      definedLabelSemanticsPromptVersion: DEFINED_LABELS_PROMPT_VERSION,
      taskContractVersion: conditionARuns[0].result.configuration.taskContractVersion,
      taskSpecificationVersion: TRIAGE_SPECIFICATION.taskSpecificationVersion,
      outputSchemaVersion: TRIAGE_SPECIFICATION.outputSchemaVersion,
      fixtureIdentity: fixture.name,
    },
    design: {
      cases: 25,
      conditionsPerCase: 2,
      callsPerModel: 50,
      totalPlannedExperimentCalls: 100,
      executionOrder: [CONDITIONS.FROZEN_P1B1, CONDITIONS.DEFINED_LABEL_SEMANTICS],
      automaticReruns: false,
    },
    policyType: POLICY_TYPES.LOCAL_ONLY,
    conditions: {
      [CONDITIONS.FROZEN_P1B1]: { promptVersion: CALIBRATION_PROMPT_VERSION },
      [CONDITIONS.DEFINED_LABEL_SEMANTICS]: { promptVersion: DEFINED_LABELS_PROMPT_VERSION },
    },
    summaries: {
      [CONDITIONS.FROZEN_P1B1]: summarizeConditionRuns(conditionARuns),
      [CONDITIONS.DEFINED_LABEL_SEMANTICS]: summarizeConditionRuns(conditionBRuns),
    },
    pairedSummary: summarizePairedTransitions(observations),
    observations,
  };
}

function exitCodeForReport(report) {
  return Object.values(report.summaries).some(summary => summary.runtimeFailures > 0) ? 1 : 0;
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

function helpText() {
  return [
    'Usage: npm run research:memory-inference-triage-label-semantics -- [options]',
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
    '고정된 25개 case를 A→B 순서로 한 번씩 실행하며 runtime/model을 관리하지 않습니다.',
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
  CONDITIONS,
  DEFAULT_FIXTURE,
  DEFINED_LABELS_PROMPT_VERSION,
  DEFINED_LABEL_SEMANTICS_INSTRUCTION,
  DIAGNOSTIC_FIXTURE_NAME,
  DIAGNOSTIC_REPORT_VERSION,
  DIAGNOSTIC_RUNNER_VERSION,
  DIAGNOSTIC_RUNTIME_VERSION,
  FIXED_CASE_IDS,
  MODEL_CONFIGURATIONS,
  P1B1_FIXTURE,
  PAIRED_TRANSITIONS,
  buildDefinedLabelSemanticsPrompt,
  exitCodeForReport,
  helpText,
  loadDiagnosticFixture,
  main,
  pairedTransition,
  parseArguments,
  runDefinedLabelSemanticsCase,
  runDiagnosticFixture,
  summarizeConditionRuns,
  summarizePairedTransitions,
  validateDiagnosticFixture,
};

if (require.main === module) {
  main().then(
    exitCode => { process.exitCode = exitCode; },
    error => {
      console.error(`Memory inference P1-B2b diagnostic failed: ${error.message}`);
      process.exitCode = 1;
    },
  );
}
