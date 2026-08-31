'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  SCHEMA_STATUSES,
  TASK_OUTCOMES,
  validatePilotCase,
} = require('../lib/memory-inference-pilot-contracts');
const {
  CALIBRATION_PROMPT_VERSION,
  CALIBRATION_RUNNER_VERSION,
  buildCalibrationPrompt,
} = require('../lib/memory-inference-local-calibration');
const {
  DEFAULT_FIXTURE,
  DIAGNOSTIC_FIXTURE_NAME,
  DIAGNOSTIC_REPORT_VERSION,
  DIAGNOSTIC_RUNNER_VERSION,
  DIAGNOSTIC_RUNTIME_VERSION,
  FIXED_CASE_IDS,
  MODEL_CONFIGURATIONS,
  exitCodeForReport,
  helpText,
  loadDiagnosticFixture,
  parseArguments,
  runDiagnosticFixture,
  validateDiagnosticFixture,
} = require('../scripts/run-memory-inference-extraction-boundary-diagnostic');

const ROOT = path.resolve(__dirname, '..');
const P1B1_FIXTURE_PATH = path.join(ROOT, 'fixtures/local-memory-inference-p1b1-synthetic.json');

const EXPECTED_CASES = Object.freeze({
  'p1b2a-extraction-d0': {
    evidence: '월간 목표 20 pages와 별도로 weekly target은 8 pages다.',
    gold: { weeklyTarget: 8, unit: 'pages' },
    metadata: {
      sourceCaseId: 'p1b1-extraction-023', kind: 'baseline',
      factor: 'baseline_reproduction', pairedBaselineId: null,
    },
  },
  'p1b2a-extraction-d1': {
    evidence: 'weekly target은 8 pages다. 별도로 월간 목표는 20 pages다.',
    gold: { weeklyTarget: 8, unit: 'pages' },
    metadata: {
      sourceCaseId: 'p1b1-extraction-023', kind: 'variant',
      factor: 'target_distractor_order', pairedBaselineId: 'p1b2a-extraction-d0',
    },
  },
  'p1b2a-extraction-d2': {
    evidence: '월간 목표 20 pages와 별도로 요청한 weekly target은 8 pages다.',
    gold: { weeklyTarget: 8, unit: 'pages' },
    metadata: {
      sourceCaseId: 'p1b1-extraction-023', kind: 'variant',
      factor: 'explicit_requested_cue', pairedBaselineId: 'p1b2a-extraction-d0',
    },
  },
  'p1b2a-extraction-d3': {
    evidence: '월간 목표 20 pages와 별도로 주간 목표는 8 pages다.',
    gold: { weeklyTarget: 8, unit: 'pages' },
    metadata: {
      sourceCaseId: 'p1b1-extraction-023', kind: 'variant',
      factor: 'target_lexical_language', pairedBaselineId: 'p1b2a-extraction-d0',
    },
  },
  'p1b2a-extraction-d4': {
    evidence: '월간 목표 20 pages와 별도로 weeklyTarget은 8 pages다.',
    gold: { weeklyTarget: 8, unit: 'pages' },
    metadata: {
      sourceCaseId: 'p1b1-extraction-023', kind: 'variant',
      factor: 'schema_key_lexical_alignment', pairedBaselineId: 'p1b2a-extraction-d0',
    },
  },
  'p1b2a-extraction-d5': {
    evidence: '월간 목표 20 items와 별도로 weekly target은 8 pages다.',
    gold: { weeklyTarget: 8, unit: 'pages' },
    metadata: {
      sourceCaseId: 'p1b1-extraction-023', kind: 'variant',
      factor: 'same_unit_competition', pairedBaselineId: 'p1b2a-extraction-d0',
    },
  },
  'p1b2a-extraction-c1': {
    evidence: '하루 목표는 1회지만 요청한 주간 목표는 5 sessions이다.',
    gold: { weeklyTarget: 5, unit: 'sessions' },
    metadata: {
      sourceCaseId: 'p1b1-extraction-022', kind: 'control',
      factor: 'frozen_control', pairedBaselineId: null,
    },
  },
  'p1b2a-extraction-c2': {
    evidence: 'The monthly budget is 30 hours, while the requested weekly target is 4 hours.',
    gold: { weeklyTarget: 4, unit: 'hours' },
    metadata: {
      sourceCaseId: 'p1b1-extraction-029', kind: 'control',
      factor: 'frozen_control', pairedBaselineId: null,
    },
  },
});

function chatCompletion(content) {
  return JSON.stringify({
    id: 'synthetic-diagnostic-completion',
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
  });
}

function fakeFetch(contents, requests = []) {
  let index = 0;
  return async (url, init) => {
    const value = typeof contents === 'function' ? contents(index) : contents[index];
    requests.push({ url, body: JSON.parse(init.body) });
    index += 1;
    if (value instanceof Error) throw value;
    return {
      ok: true,
      status: 200,
      async text() { return chatCompletion(value); },
    };
  };
}

function runnerOptions(fetchImpl, modelSizeClass = '~2B') {
  const configuration = MODEL_CONFIGURATIONS[modelSizeClass];
  return {
    endpoint: 'http://127.0.0.1:8080/v1',
    modelId: configuration.modelId,
    artifactId: configuration.artifactId,
    quantization: 'BF16',
    modelSizeClass,
    runtimeFamily: 'llama.cpp',
    runtimeVersion: DIAGNOSTIC_RUNTIME_VERSION,
    timeoutMs: 1_000,
    commit: 'a'.repeat(40),
    fetchImpl,
  };
}

function goldOutputs(fixture) {
  return fixture.cases.map(item => JSON.stringify(item.adjudication.primary.label));
}

test('P1-B2a fixture is the exact preregistered eight-case boundary diagnostic', () => {
  const fixture = loadDiagnosticFixture();
  assert.equal(DEFAULT_FIXTURE, path.join(
    ROOT,
    'fixtures/local-memory-inference-p1b2a-extraction-boundary.json',
  ));
  assert.equal(fixture.name, DIAGNOSTIC_FIXTURE_NAME);
  assert.deepEqual(fixture.cases.map(item => item.caseId), [...FIXED_CASE_IDS]);
  assert.equal(fixture.cases.length, 8);
  assert.deepEqual(Object.keys(fixture.diagnosticMetadata).sort(), [...FIXED_CASE_IDS].sort());

  for (const pilotCase of fixture.cases) {
    const expected = EXPECTED_CASES[pilotCase.caseId];
    assert.equal(validatePilotCase(pilotCase), pilotCase);
    assert.equal(pilotCase.inputPayload.evidence, expected.evidence);
    assert.equal(pilotCase.inputPayload.expectedSchema, 'p1b1_quantity_unit_v1');
    assert.deepEqual(pilotCase.adjudication.primary, {
      source: 'PROGRAMMATIC',
      label: expected.gold,
    });
    assert.equal(pilotCase.hardGateExpectation.status, 'DOES_NOT_APPLY');
    assert.deepEqual(fixture.diagnosticMetadata[pilotCase.caseId], expected.metadata);
  }
  const mutated = structuredClone(fixture);
  mutated.cases[0].inputPayload.evidence = 'mutated';
  assert.throws(() => validateDiagnosticFixture(mutated), /preregistration/);
});

test('controls exactly reproduce frozen P1-B1 cases 022 and 029', () => {
  const diagnostic = loadDiagnosticFixture();
  const p1b1 = JSON.parse(fs.readFileSync(P1B1_FIXTURE_PATH, 'utf8'));
  for (const [diagnosticId, sourceId] of [
    ['p1b2a-extraction-c1', 'p1b1-extraction-022'],
    ['p1b2a-extraction-c2', 'p1b1-extraction-029'],
  ]) {
    const current = diagnostic.cases.find(item => item.caseId === diagnosticId);
    const source = p1b1.cases.find(item => item.caseId === sourceId);
    assert.deepEqual(current.inputPayload, source.inputPayload);
    assert.deepEqual(current.adjudication.primary.label, source.adjudication.primary.label);
  }
});

test('diagnostic metadata and gold never enter the frozen P1-B1 prompt', () => {
  const fixture = loadDiagnosticFixture();
  for (const pilotCase of fixture.cases) {
    const serialized = JSON.stringify(buildCalibrationPrompt(pilotCase).messages);
    assert.equal(serialized.includes('diagnosticMetadata'), false);
    assert.equal(serialized.includes('sourceCaseId'), false);
    assert.equal(serialized.includes('pairedBaselineId'), false);
    assert.equal(serialized.includes(fixture.diagnosticMetadata[pilotCase.caseId].factor), false);
  }
  const canary = structuredClone(fixture.cases[0]);
  canary.adjudication.primary.label.weeklyTarget = 9999;
  assert.equal(JSON.stringify(buildCalibrationPrompt(canary).messages).includes('9999'), false);
});

test('fake exact outputs traverse the frozen runtime path and produce a descriptive report', async () => {
  const fixture = loadDiagnosticFixture();
  const requests = [];
  const report = await runDiagnosticFixture(
    fixture,
    runnerOptions(fakeFetch(goldOutputs(fixture), requests)),
  );

  assert.equal(requests.length, 8);
  assert.ok(requests.every(request => request.body.chat_template_kwargs.enable_thinking === false));
  assert.ok(requests.every(request => request.body.response_format.type === 'json_object'));
  assert.ok(requests.every(request => !JSON.stringify(request.body.messages).includes('diagnosticMetadata')));
  assert.equal(report.reportVersion, DIAGNOSTIC_REPORT_VERSION);
  assert.deepEqual(report.summary, {
    totalCases: 8,
    schemaValidCases: 8,
    invalidStructuredOutputs: 0,
    runtimeFailures: 0,
    exactMatches: 8,
    mismatches: 0,
  });
  assert.equal(report.provenance.diagnosticRunnerVersion, DIAGNOSTIC_RUNNER_VERSION);
  assert.equal(report.provenance.p1b1RunnerVersion, CALIBRATION_RUNNER_VERSION);
  assert.equal(report.provenance.promptVersion, CALIBRATION_PROMPT_VERSION);
  assert.equal(report.provenance.taskSpecificationVersion, 'p1b1-structured-extraction-quantity-unit-v1');
  assert.equal(report.provenance.outputSchemaVersion, 'p1b1-structured-extraction-quantity-unit-output-v1');
  assert.ok(report.observations.every(item => item.semanticExactMatch === true));
  assert.ok(report.observations.every(item => item.result.configuration.promptVersion === CALIBRATION_PROMPT_VERSION));
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('screeningDecision'), false);
  assert.equal(serialized.includes('threshold'), false);
  assert.equal(serialized.includes('conclusion'), false);
  assert.equal(exitCodeForReport(report), 0);
});

test('wrong value remains a schema-valid semantic mismatch without becoming CLI failure', async () => {
  const fixture = loadDiagnosticFixture();
  const outputs = goldOutputs(fixture);
  outputs[0] = JSON.stringify({ weeklyTarget: 20, unit: 'pages' });
  const report = await runDiagnosticFixture(fixture, runnerOptions(fakeFetch(outputs)));
  const d0 = report.observations[0];

  assert.deepEqual(report.summary, {
    totalCases: 8,
    schemaValidCases: 8,
    invalidStructuredOutputs: 0,
    runtimeFailures: 0,
    exactMatches: 7,
    mismatches: 1,
  });
  assert.equal(d0.schemaStatus, SCHEMA_STATUSES.VALID);
  assert.equal(d0.taskOutcome, TASK_OUTCOMES.FAILURE);
  assert.equal(d0.semanticExactMatch, false);
  assert.equal(d0.semanticScoring.reasonCode, 'MISMATCH');
  assert.equal(exitCodeForReport(report), 0);
});

test('invalid structured output fails closed and stays separate from semantic mismatch', async () => {
  const fixture = loadDiagnosticFixture();
  const outputs = goldOutputs(fixture);
  outputs[0] = JSON.stringify({ weeklyTarget: 8 });
  const report = await runDiagnosticFixture(fixture, runnerOptions(fakeFetch(outputs)));
  const d0 = report.observations[0];

  assert.equal(report.summary.schemaValidCases, 7);
  assert.equal(report.summary.invalidStructuredOutputs, 1);
  assert.equal(report.summary.exactMatches, 7);
  assert.equal(report.summary.mismatches, 0);
  assert.equal(d0.schemaStatus, SCHEMA_STATUSES.INVALID);
  assert.equal(d0.taskOutcome, TASK_OUTCOMES.FAILURE);
  assert.equal(d0.semanticExactMatch, null);
  assert.equal(d0.error.code, 'MODEL_OUTPUT_SCHEMA_INVALID');
  assert.equal(exitCodeForReport(report), 0);
});

test('runtime failure is distinct and makes the CLI result non-zero', async () => {
  const fixture = loadDiagnosticFixture();
  const outputs = goldOutputs(fixture);
  outputs[0] = new TypeError('synthetic unavailable');
  const report = await runDiagnosticFixture(fixture, runnerOptions(fakeFetch(outputs)));
  const d0 = report.observations[0];

  assert.equal(report.summary.runtimeFailures, 1);
  assert.equal(d0.schemaStatus, SCHEMA_STATUSES.NOT_APPLICABLE);
  assert.equal(d0.taskOutcome, TASK_OUTCOMES.NOT_RUN);
  assert.equal(d0.semanticExactMatch, null);
  assert.equal(d0.error.code, 'LOCAL_ENDPOINT_UNAVAILABLE');
  assert.equal(exitCodeForReport(report), 1);
});

test('CLI is fixed to the two preregistered BF16 model configurations', () => {
  assert.deepEqual(Object.keys(MODEL_CONFIGURATIONS).sort(), ['~2B', '~4B']);
  for (const modelSizeClass of ['~2B', '~4B']) {
    const configuration = MODEL_CONFIGURATIONS[modelSizeClass];
    const parsed = parseArguments([
      '--endpoint', 'http://127.0.0.1:8080/v1',
      '--model', configuration.modelId,
      '--artifact', configuration.artifactId,
      '--quantization', 'BF16',
      '--model-size-class', modelSizeClass,
      '--runtime-version', DIAGNOSTIC_RUNTIME_VERSION,
    ]);
    assert.equal(parsed.modelSizeClass, modelSizeClass);
    assert.equal(parsed.quantization, 'BF16');
  }
  const base = [
    '--endpoint', 'http://127.0.0.1:8080/v1',
    '--model', MODEL_CONFIGURATIONS['~2B'].modelId,
    '--artifact', MODEL_CONFIGURATIONS['~2B'].artifactId,
    '--quantization', 'BF16',
    '--model-size-class', '~2B',
    '--runtime-version', DIAGNOSTIC_RUNTIME_VERSION,
  ];
  assert.throws(() => parseArguments(base.toSpliced(7, 1, 'Q8_0')), /BF16/);
  assert.throws(() => parseArguments(base.toSpliced(9, 1, 'sub-1B')), /~2B 또는 ~4B/);
  assert.throws(() => parseArguments(base.toSpliced(9, 1, '7B')), /~2B 또는 ~4B/);
  assert.throws(() => parseArguments(base.toSpliced(3, 1, 'other-model')), /fixed|고정 configuration/);
  assert.throws(() => parseArguments([...base, '--threshold', '0.5']), /알 수 없는 인자/);
  assert.throws(() => parseArguments([...base, '--prompt', 'other']), /알 수 없는 인자/);
  assert.throws(() => parseArguments([...base, '--fixture', 'other.json']), /알 수 없는 인자/);
  assert.throws(() => parseArguments([...base, '--case', 'd0']), /알 수 없는 인자/);
  assert.doesNotMatch(helpText(), /--threshold|--prompt|--fixture|--case|sub-1B|7B|8B/);

  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(
    packageJson.scripts['research:memory-inference-extraction-boundary'],
    'node scripts/run-memory-inference-extraction-boundary-diagnostic.js',
  );
});
