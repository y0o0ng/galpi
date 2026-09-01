'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  HARD_GATE_EXPECTATIONS,
  SCHEMA_STATUSES,
  TASK_OUTCOMES,
  validatePilotCase,
} = require('../lib/memory-inference-pilot-contracts');
const {
  CALIBRATION_PROMPT_VERSION,
  CALIBRATION_RUNNER_VERSION,
  TASK_SPECIFICATIONS,
  buildCalibrationPrompt,
  loadCalibrationFixture,
} = require('../lib/memory-inference-local-calibration');
const {
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
  parseArguments,
  runDefinedLabelSemanticsCase,
  runDiagnosticFixture,
  validateDiagnosticFixture,
} = require('../scripts/run-memory-inference-triage-label-semantics-diagnostic');

const ROOT = path.resolve(__dirname, '..');

function chatCompletion(content) {
  return JSON.stringify({
    id: 'synthetic-p1b2b-completion',
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

function goldOutput(pilotCase) {
  return JSON.stringify({ decision: pilotCase.adjudication.primary.label });
}

function promptSections(content) {
  const instructionMarker = '\nINSTRUCTION: ';
  const outputMarker = '\nOUTPUT_SCHEMA: ';
  const instructionStart = content.indexOf(instructionMarker);
  const outputStart = content.indexOf(outputMarker);
  assert.ok(instructionStart >= 0);
  assert.ok(outputStart > instructionStart);
  return {
    beforeInstruction: content.slice(0, instructionStart),
    instruction: content.slice(instructionStart + instructionMarker.length, outputStart),
    afterInstruction: content.slice(outputStart),
  };
}

function sourceMetadata(caseId) {
  return loadCalibrationFixture(P1B1_FIXTURE).calibrationMetadata[caseId];
}

test('P1-B2b fixture is the exact frozen 25-case HUMAN non-hard-gated triage snapshot', () => {
  const fixture = loadDiagnosticFixture();
  const source = loadCalibrationFixture(P1B1_FIXTURE);
  assert.equal(DEFAULT_FIXTURE, path.join(
    ROOT,
    'fixtures/local-memory-inference-p1b2b-triage-label-semantics.json',
  ));
  assert.equal(fixture.name, DIAGNOSTIC_FIXTURE_NAME);
  assert.equal(validateDiagnosticFixture(fixture, source), fixture);
  assert.equal(fixture.cases.length, 25);
  assert.deepEqual(fixture.cases.map(item => item.caseId), [...FIXED_CASE_IDS]);
  assert.equal(fixture.cases.some(item => item.caseId.includes('-probe-')), false);

  const counts = { NO_WRITE: 0, WRITE_CANDIDATE: 0, ESCALATE: 0 };
  for (const pilotCase of fixture.cases) {
    const sourceCase = source.cases.find(item => item.caseId === pilotCase.caseId);
    assert.equal(validatePilotCase(pilotCase), pilotCase);
    assert.deepEqual(pilotCase, sourceCase);
    for (const key of [
      'inputPayload',
      'adjudication',
      'ambiguityState',
      'hardGateExpectation',
      'taskContractVersion',
      'workloadType',
    ]) {
      assert.deepEqual(pilotCase[key], sourceCase[key], `${pilotCase.caseId}:${key}`);
    }
    assert.equal(pilotCase.workloadType, 'write_candidate_triage');
    assert.equal(pilotCase.adjudication.primary.source, 'HUMAN');
    assert.notEqual(pilotCase.hardGateExpectation.status, HARD_GATE_EXPECTATIONS.APPLIES);
    assert.equal(source.calibrationMetadata[pilotCase.caseId].capabilityProbe, false);
    counts[pilotCase.adjudication.primary.label] += 1;
  }
  assert.deepEqual(counts, { NO_WRITE: 10, WRITE_CANDIDATE: 10, ESCALATE: 5 });

  const mutated = structuredClone(fixture);
  mutated.cases[0].inputPayload.evidence = 'mutated';
  assert.throws(() => validateDiagnosticFixture(mutated, source), /frozen P1-B1 source/);
});

test('defined prompt changes only the exact preregistered INSTRUCTION content', () => {
  const pilotCase = loadDiagnosticFixture().cases[0];
  const frozen = buildCalibrationPrompt(pilotCase);
  const defined = buildDefinedLabelSemanticsPrompt(pilotCase);
  assert.equal(frozen.promptVersion, CALIBRATION_PROMPT_VERSION);
  assert.equal(defined.promptVersion, DEFINED_LABELS_PROMPT_VERSION);
  assert.deepEqual(defined.messages[0], frozen.messages[0]);

  const frozenSections = promptSections(frozen.messages[1].content);
  const definedSections = promptSections(defined.messages[1].content);
  assert.equal(definedSections.beforeInstruction, frozenSections.beforeInstruction);
  assert.equal(definedSections.afterInstruction, frozenSections.afterInstruction);
  assert.equal(definedSections.instruction, DEFINED_LABEL_SEMANTICS_INSTRUCTION);
  assert.equal(definedSections.instruction, [
    'Classify the supplied evidence into exactly one advisory triage label.',
    'NO_WRITE: the evidence is clearly transient, request-local, or otherwise not a durable memory candidate.',
    'WRITE_CANDIDATE: the evidence clearly states a sufficiently persistent fact, preference, goal, constraint, or state that may be worth durable-memory review.',
    'ESCALATE: the supplied evidence is insufficient or ambiguous in persistence, scope, reference, or meaning in a way that prevents safely deciding between NO_WRITE and WRITE_CANDIDATE. Do not resolve that ambiguity yourself.',
    'This classification is advisory only and does not authorize a durable write.',
  ].join('\n'));

  const expected = structuredClone(frozen);
  expected.promptVersion = DEFINED_LABELS_PROMPT_VERSION;
  expected.messages[1].content = [
    'WORKLOAD: write_candidate_triage',
    'TASK_SPECIFICATION: p1b1-write-candidate-triage-v1',
    `INSTRUCTION: ${DEFINED_LABEL_SEMANTICS_INSTRUCTION}`,
    `OUTPUT_SCHEMA: ${JSON.stringify(TASK_SPECIFICATIONS.write_candidate_triage.outputSchema)}`,
    `INPUT: ${JSON.stringify(pilotCase.inputPayload)}`,
  ].join('\n');
  assert.deepEqual(defined, expected);
  assert.doesNotMatch(defined.messages[1].content, /few[- ]shot|example|rationale|confidence|chain.of.thought/iu);
});

test('gold, adjudication, and non-input metadata never enter either model-visible prompt', () => {
  const original = loadDiagnosticFixture().cases[0];
  const changedGold = structuredClone(original);
  changedGold.adjudication.primary.label = 'WRITE_CANDIDATE';
  const promptPairs = [
    [buildCalibrationPrompt(original), buildCalibrationPrompt(changedGold)],
    [buildDefinedLabelSemanticsPrompt(original), buildDefinedLabelSemanticsPrompt(changedGold)],
  ];
  for (const [originalPrompt, changedGoldPrompt] of promptPairs) {
    assert.deepEqual(changedGoldPrompt.messages, originalPrompt.messages);
    const serialized = JSON.stringify(changedGoldPrompt.messages);
    assert.equal(serialized.includes('adjudication'), false);
    assert.equal(serialized.includes('hardGateExpectation'), false);
    assert.equal(serialized.includes('screeningClass'), false);
    assert.equal(serialized.includes('capabilityProbe'), false);
  }
});

test('paired runner executes A then B once per case with request parity except INSTRUCTION', async () => {
  const fixture = loadDiagnosticFixture();
  const outputs = fixture.cases.flatMap(pilotCase => [goldOutput(pilotCase), goldOutput(pilotCase)]);
  const requests = [];
  const report = await runDiagnosticFixture(fixture, runnerOptions(fakeFetch(outputs, requests)));

  assert.equal(requests.length, 50);
  for (let index = 0; index < fixture.cases.length; index += 1) {
    const pilotCase = fixture.cases[index];
    const conditionA = requests[index * 2].body;
    const conditionB = requests[(index * 2) + 1].body;
    assert.deepEqual(conditionA.messages, buildCalibrationPrompt(pilotCase).messages);
    assert.deepEqual(conditionB.messages, buildDefinedLabelSemanticsPrompt(pilotCase).messages);
    assert.deepEqual(conditionA.messages[0], conditionB.messages[0]);
    const aSections = promptSections(conditionA.messages[1].content);
    const bSections = promptSections(conditionB.messages[1].content);
    assert.equal(aSections.beforeInstruction, bSections.beforeInstruction);
    assert.equal(aSections.afterInstruction, bSections.afterInstruction);
    assert.notEqual(aSections.instruction, bSections.instruction);

    const normalizedB = structuredClone(conditionB);
    normalizedB.messages[1].content = conditionA.messages[1].content;
    assert.deepEqual(normalizedB, conditionA);
    assert.equal(conditionA.model, runnerOptions(null).modelId);
    assert.equal(conditionA.temperature, 0);
    assert.equal(conditionA.max_tokens, 128);
    assert.equal(conditionA.stream, false);
    assert.deepEqual(conditionA.chat_template_kwargs, { enable_thinking: false });
    assert.deepEqual(conditionA.response_format, { type: 'json_object' });
  }

  assert.equal(report.reportVersion, DIAGNOSTIC_REPORT_VERSION);
  assert.equal(report.provenance.diagnosticRunnerVersion, DIAGNOSTIC_RUNNER_VERSION);
  assert.equal(report.provenance.p1b1RunnerVersion, CALIBRATION_RUNNER_VERSION);
  assert.equal(report.provenance.frozenPromptVersion, CALIBRATION_PROMPT_VERSION);
  assert.equal(report.provenance.definedLabelSemanticsPromptVersion, DEFINED_LABELS_PROMPT_VERSION);
  assert.deepEqual(report.design, {
    cases: 25,
    conditionsPerCase: 2,
    callsPerModel: 50,
    totalPlannedExperimentCalls: 100,
    executionOrder: [CONDITIONS.FROZEN_P1B1, CONDITIONS.DEFINED_LABEL_SEMANTICS],
    automaticReruns: false,
  });
  assert.equal(report.observations.length, 25);
  assert.equal(report.summaries.FROZEN_P1B1.exactMatches, 25);
  assert.equal(report.summaries.DEFINED_LABEL_SEMANTICS.exactMatches, 25);
  assert.deepEqual(report.pairedSummary, {
    unchangedCorrect: 25,
    fixes: 0,
    regressions: 0,
    unchangedWrong: 0,
    nonComparable: 0,
  });
  assert.ok(report.observations.every(item => (
    item.FROZEN_P1B1.promptVersion === CALIBRATION_PROMPT_VERSION
    && item.DEFINED_LABEL_SEMANTICS.promptVersion === DEFINED_LABELS_PROMPT_VERSION
  )));
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('screeningDecision'), false);
  assert.equal(serialized.includes('PASS_CURRENT_SIZE'), false);
  assert.equal(serialized.includes('ADVANCE_SIZE'), false);
  assert.equal(serialized.includes('threshold'), false);
  assert.equal(serialized.includes('conclusion'), false);
  assert.equal(exitCodeForReport(report), 0);
});

test('defined condition preserves exact scoring and fail-closed runtime distinctions', async () => {
  const pilotCase = loadDiagnosticFixture().cases[0];
  const metadata = sourceMetadata(pilotCase.caseId);
  const exact = await runDefinedLabelSemanticsCase(
    pilotCase,
    metadata,
    runnerOptions(fakeFetch([JSON.stringify({ decision: 'NO_WRITE' })])),
  );
  assert.equal(exact.result.directResult.schemaStatus, SCHEMA_STATUSES.VALID);
  assert.equal(exact.result.directResult.taskOutcome, TASK_OUTCOMES.SUCCESS);
  assert.equal(exact.semanticScoring.reasonCode, 'MATCH');
  assert.equal(exact.result.configuration.promptVersion, DEFINED_LABELS_PROMPT_VERSION);

  const wrong = await runDefinedLabelSemanticsCase(
    pilotCase,
    metadata,
    runnerOptions(fakeFetch([JSON.stringify({ decision: 'WRITE_CANDIDATE' })])),
  );
  assert.equal(wrong.result.directResult.schemaStatus, SCHEMA_STATUSES.VALID);
  assert.equal(wrong.result.directResult.taskOutcome, TASK_OUTCOMES.FAILURE);
  assert.equal(wrong.semanticScoring.reasonCode, 'MISMATCH');

  const invalidJson = await runDefinedLabelSemanticsCase(
    pilotCase,
    metadata,
    runnerOptions(fakeFetch(['```json\n{"decision":"NO_WRITE"}\n```'])),
  );
  assert.equal(invalidJson.result.directResult.schemaStatus, SCHEMA_STATUSES.INVALID);
  assert.equal(invalidJson.result.directResult.error.code, 'MODEL_OUTPUT_INVALID_JSON');

  const invalidDecision = await runDefinedLabelSemanticsCase(
    pilotCase,
    metadata,
    runnerOptions(fakeFetch([JSON.stringify({ decision: 'OTHER' })])),
  );
  assert.equal(invalidDecision.result.directResult.schemaStatus, SCHEMA_STATUSES.INVALID);
  assert.equal(invalidDecision.result.directResult.error.code, 'MODEL_OUTPUT_SCHEMA_INVALID');

  const runtime = await runDefinedLabelSemanticsCase(
    pilotCase,
    metadata,
    runnerOptions(fakeFetch([new TypeError('synthetic unavailable')])),
  );
  assert.equal(runtime.result.directResult.schemaStatus, SCHEMA_STATUSES.NOT_APPLICABLE);
  assert.equal(runtime.result.directResult.taskOutcome, TASK_OUTCOMES.NOT_RUN);
  assert.equal(runtime.result.directResult.error.code, 'LOCAL_ENDPOINT_UNAVAILABLE');
});

test('condition summaries, confusion, safety count, and all paired transitions are descriptive', async () => {
  const fixture = loadDiagnosticFixture();
  const outputs = fixture.cases.flatMap(pilotCase => [goldOutput(pilotCase), goldOutput(pilotCase)]);
  outputs[2] = JSON.stringify({ decision: 'WRITE_CANDIDATE' });
  outputs[5] = JSON.stringify({ decision: 'WRITE_CANDIDATE' });
  outputs[6] = JSON.stringify({ decision: 'WRITE_CANDIDATE' });
  outputs[7] = JSON.stringify({ decision: 'ESCALATE' });
  outputs[8] = JSON.stringify({ decision: 'OTHER' });
  outputs[20] = JSON.stringify({ decision: 'NO_WRITE' });

  const report = await runDiagnosticFixture(fixture, runnerOptions(fakeFetch(outputs)));
  assert.deepEqual(report.pairedSummary, {
    unchangedCorrect: 20,
    fixes: 2,
    regressions: 1,
    unchangedWrong: 1,
    nonComparable: 1,
  });
  const transitions = report.observations.slice(0, 5).map(item => item.pairedTransition);
  assert.deepEqual(transitions, [
    PAIRED_TRANSITIONS.UNCHANGED_CORRECT,
    PAIRED_TRANSITIONS.FIXED,
    PAIRED_TRANSITIONS.REGRESSION,
    PAIRED_TRANSITIONS.UNCHANGED_WRONG,
    PAIRED_TRANSITIONS.NONCOMPARABLE_RUNTIME_OR_SCHEMA,
  ]);
  assert.equal(report.observations[10].pairedTransition, PAIRED_TRANSITIONS.FIXED);

  assert.deepEqual({
    totalCases: report.summaries.FROZEN_P1B1.totalCases,
    schemaValidOutputs: report.summaries.FROZEN_P1B1.schemaValidOutputs,
    invalidStructuredOutputs: report.summaries.FROZEN_P1B1.invalidStructuredOutputs,
    runtimeFailures: report.summaries.FROZEN_P1B1.runtimeFailures,
    exactMatches: report.summaries.FROZEN_P1B1.exactMatches,
    mismatches: report.summaries.FROZEN_P1B1.mismatches,
  }, {
    totalCases: 25,
    schemaValidOutputs: 24,
    invalidStructuredOutputs: 1,
    runtimeFailures: 0,
    exactMatches: 21,
    mismatches: 3,
  });
  assert.deepEqual({
    totalCases: report.summaries.DEFINED_LABEL_SEMANTICS.totalCases,
    schemaValidOutputs: report.summaries.DEFINED_LABEL_SEMANTICS.schemaValidOutputs,
    invalidStructuredOutputs: report.summaries.DEFINED_LABEL_SEMANTICS.invalidStructuredOutputs,
    runtimeFailures: report.summaries.DEFINED_LABEL_SEMANTICS.runtimeFailures,
    exactMatches: report.summaries.DEFINED_LABEL_SEMANTICS.exactMatches,
    mismatches: report.summaries.DEFINED_LABEL_SEMANTICS.mismatches,
  }, {
    totalCases: 25,
    schemaValidOutputs: 25,
    invalidStructuredOutputs: 0,
    runtimeFailures: 0,
    exactMatches: 23,
    mismatches: 2,
  });
  assert.deepEqual(report.summaries.FROZEN_P1B1.confusion.NO_WRITE, {
    NO_WRITE: 7,
    WRITE_CANDIDATE: 2,
    ESCALATE: 0,
    INVALID: 1,
    RUNTIME_FAILURE: 0,
  });
  assert.deepEqual(report.summaries.FROZEN_P1B1.confusion.WRITE_CANDIDATE, {
    NO_WRITE: 1,
    WRITE_CANDIDATE: 9,
    ESCALATE: 0,
    INVALID: 0,
    RUNTIME_FAILURE: 0,
  });
  assert.deepEqual(report.summaries.FROZEN_P1B1.correctNoWrite, { numerator: 7, denominator: 10 });
  assert.deepEqual(report.summaries.FROZEN_P1B1.correctWriteCandidate, {
    numerator: 9,
    denominator: 10,
  });
  assert.deepEqual(report.summaries.FROZEN_P1B1.correctEscalate, { numerator: 5, denominator: 5 });
  assert.equal(report.summaries.FROZEN_P1B1.eligibleFalseNoWriteCount, 1);
  assert.equal(report.summaries.DEFINED_LABEL_SEMANTICS.eligibleFalseNoWriteCount, 0);
});

test('runtime failure is noncomparable and makes the report exit non-zero', async () => {
  const fixture = loadDiagnosticFixture();
  const outputs = fixture.cases.flatMap(pilotCase => [goldOutput(pilotCase), goldOutput(pilotCase)]);
  outputs[1] = new TypeError('synthetic unavailable');
  const report = await runDiagnosticFixture(fixture, runnerOptions(fakeFetch(outputs)));
  assert.equal(report.summaries.DEFINED_LABEL_SEMANTICS.runtimeFailures, 1);
  assert.equal(report.observations[0].pairedTransition, PAIRED_TRANSITIONS.NONCOMPARABLE_RUNTIME_OR_SCHEMA);
  assert.equal(exitCodeForReport(report), 1);
});

test('P1-B2b CLI permits only the two fixed BF16 configurations and exposes no tuning knobs', () => {
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
  assert.throws(() => parseArguments(base.toSpliced(3, 1, 'other-model')), /고정 configuration/);
  assert.throws(() => parseArguments(base.toSpliced(11, 1, 'other-runtime')), /runtime version/);
  for (const forbidden of [
    ['--condition', 'A'],
    ['--prompt', 'other'],
    ['--fixture', 'other.json'],
    ['--threshold', '0.5'],
    ['--case', 'one'],
    ['--label-definition', 'other'],
    ['--model-family', 'other'],
  ]) {
    assert.throws(() => parseArguments([...base, ...forbidden]), /알 수 없는 인자/);
  }
  assert.doesNotMatch(
    helpText(),
    /--condition|--prompt|--fixture|--threshold|--case|--label-definition|--model-family|sub-1B|7B|8B/,
  );

  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(
    packageJson.scripts['research:memory-inference-triage-label-semantics'],
    'node scripts/run-memory-inference-triage-label-semantics-diagnostic.js',
  );
});
