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
  TASK_SPECIFICATIONS,
} = require('../lib/memory-inference-local-calibration');
const {
  DEFINED_LABELS_PROMPT_VERSION,
  DEFINED_LABEL_SEMANTICS_INSTRUCTION,
  DIAGNOSTIC_RUNNER_VERSION,
  buildDefinedLabelSemanticsPrompt,
  runDefinedLabelSemanticsCase,
} = require('../scripts/run-memory-inference-triage-label-semantics-diagnostic');
const {
  CANDIDATE_FIXTURE_NAME,
  FIXED_CASE_IDS,
  LABELS,
  REVIEW_PROTOCOL_VERSION,
  loadCandidateFixture,
} = require('../scripts/review-memory-inference-p1b2c-triage-gold');
const {
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
  parseArguments,
  runValidationFixture,
  validateHumanReview,
  validateValidationFixture,
} = require('../scripts/run-memory-inference-p1b2c-triage-validation');

const ROOT = path.resolve(__dirname, '..');

function chatCompletion(content) {
  return JSON.stringify({
    id: 'synthetic-p1b2c-completion',
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
  });
}

function fakeFetch(contents, requests = []) {
  let index = 0;
  return async (url, init) => {
    const value = typeof contents === 'function' ? contents(index) : contents[index];
    requests.push({ url, body: JSON.parse(init.body), signal: init.signal });
    index += 1;
    if (value instanceof Error) throw value;
    return {
      ok: true,
      status: 200,
      async text() { return chatCompletion(value); },
    };
  };
}

function runnerOptions(fetchImpl) {
  return {
    endpoint: 'http://127.0.0.1:8080/v1',
    ...FIXED_MODEL_CONFIGURATION,
    timeoutMs: 1,
    commit: 'a'.repeat(40),
    fetchImpl,
  };
}

function outputForLabel(label) {
  return JSON.stringify({ decision: label });
}

function exactOutputs(fixture = loadValidationFixture()) {
  return fixture.cases.map(item => outputForLabel(item.adjudication.primary.label));
}

async function reportWithOverrides(overrides = new Map()) {
  const fixture = loadValidationFixture();
  const outputs = exactOutputs(fixture);
  for (const [index, value] of overrides) outputs[index] = value;
  return runValidationFixture(fixture, runnerOptions(fakeFetch(outputs)));
}

function fixedCliArguments(overrides = {}) {
  const configuration = { ...FIXED_MODEL_CONFIGURATION, ...overrides };
  return [
    '--endpoint', 'http://127.0.0.1:8080/v1',
    '--model', configuration.modelId,
    '--artifact', configuration.artifactId,
    '--quantization', configuration.quantization,
    '--model-size-class', configuration.modelSizeClass,
    '--runtime-version', configuration.runtimeVersion,
  ];
}

test('tracked raw HUMAN review provenance is exact, complete, unique, and balanced', () => {
  const review = loadHumanReview();
  assert.equal(DEFAULT_HUMAN_REVIEW, path.join(
    ROOT,
    'fixtures/local-memory-inference-p1b2c-human-primary-labels.json',
  ));
  assert.equal(validateHumanReview(review), review);
  assert.equal(review.protocolVersion, REVIEW_PROTOCOL_VERSION);
  assert.equal(review.protocolVersion, 'xion-p1b2c-human-primary-v1');
  assert.equal(review.candidateFixture, CANDIDATE_FIXTURE_NAME);
  assert.equal(review.completedAt, HUMAN_REVIEW_COMPLETED_AT);
  assert.equal(review.completedAt, '2026-09-01T09:20:26.476Z');
  assert.equal(review.labels.length, 30);
  assert.deepEqual(review.labels.map(item => item.caseId), [...FIXED_CASE_IDS]);
  assert.equal(new Set(review.labels.map(item => item.caseId)).size, 30);
  assert.ok(review.labels.every(item => LABELS.includes(item.label)));
  const counts = Object.fromEntries(LABELS.map(label => [
    label,
    review.labels.filter(item => item.label === label).length,
  ]));
  assert.deepEqual(counts, LABEL_DISTRIBUTION);
});

test('final fixture is derived exactly from candidate evidence and blind HUMAN mapping', () => {
  const candidates = loadCandidateFixture();
  const review = loadHumanReview();
  const fixture = loadValidationFixture();
  assert.equal(DEFAULT_FIXTURE, path.join(
    ROOT,
    'fixtures/local-memory-inference-p1b2c-triage-validation.json',
  ));
  assert.equal(fixture.name, VALIDATION_FIXTURE_NAME);
  assert.equal(validateValidationFixture(fixture, candidates, review), fixture);
  assert.equal(fixture.cases.length, 30);
  assert.deepEqual(fixture.cases.map(item => item.caseId), [...FIXED_CASE_IDS]);
  const labels = new Map(review.labels.map(item => [item.caseId, item.label]));
  const distribution = { NO_WRITE: 0, WRITE_CANDIDATE: 0, ESCALATE: 0 };

  for (let index = 0; index < fixture.cases.length; index += 1) {
    const pilotCase = fixture.cases[index];
    const candidate = candidates.cases[index];
    const gold = labels.get(pilotCase.caseId);
    assert.equal(validatePilotCase(pilotCase), pilotCase);
    assert.equal(pilotCase.caseId, candidate.caseId);
    assert.equal(pilotCase.workloadType, candidate.workloadType);
    assert.deepEqual(pilotCase.inputPayload, candidate.inputPayload);
    assert.equal(pilotCase.inputPayload.evidence, candidate.inputPayload.evidence);
    assert.equal(pilotCase.adjudication.state, 'PRIMARY_ADJUDICATED');
    assert.deepEqual(pilotCase.adjudication.primary, { source: 'HUMAN', label: gold });
    assert.equal(pilotCase.adjudication.blindSecondPass, null);
    assert.equal(pilotCase.adjudication.disagreementState, 'NOT_ASSESSED');
    assert.equal(pilotCase.adjudication.finalResolvedHumanLabel, null);
    assert.deepEqual(pilotCase.adjudication.cloudAssistedReview, {
      performed: false,
      configurationId: null,
      suggestion: null,
    });
    assert.equal(pilotCase.ambiguityState, gold === 'ESCALATE' ? 'AMBIGUOUS' : 'CLEAR');
    assert.deepEqual(pilotCase.hardGateExpectation, {
      status: 'DOES_NOT_APPLY',
      guardScope: 'none',
      reasonCode: 'none',
    });
    const metadata = calibrationMetadataForCase(pilotCase);
    assert.equal(metadata.schemaFamily, null);
    assert.equal(metadata.screeningClass, gold);
    assert.equal(metadata.capabilityProbe, false);
    assert.equal(metadata.stratum, {
      NO_WRITE: 'no_write',
      WRITE_CANDIDATE: 'write_candidate',
      ESCALATE: 'eligible_escalate',
    }[gold]);
    distribution[gold] += 1;
  }
  assert.deepEqual(distribution, LABEL_DISTRIBUTION);

  const changedEvidence = structuredClone(fixture);
  changedEvidence.cases[0].inputPayload.evidence += ' changed';
  assert.throws(
    () => validateValidationFixture(changedEvidence, candidates, review),
    /candidate\/HUMAN source/,
  );
  const changedGold = structuredClone(fixture);
  changedGold.cases[0].adjudication.primary.label = 'ESCALATE';
  assert.throws(() => validateValidationFixture(changedGold, candidates, review));
});

test('P1-B2c reuses the exact frozen B2b defined-label prompt without gold leakage', async () => {
  const pilotCase = loadValidationFixture().cases[0];
  const prompt = buildDefinedLabelSemanticsPrompt(pilotCase);
  assert.equal(prompt.promptVersion, DEFINED_LABELS_PROMPT_VERSION);
  assert.equal(
    DEFINED_LABELS_PROMPT_VERSION,
    'xion-local-memory-inference-p1b2b-triage-defined-labels-prompt-v1',
  );
  assert.equal(DEFINED_LABEL_SEMANTICS_INSTRUCTION, [
    'Classify the supplied evidence into exactly one advisory triage label.',
    'NO_WRITE: the evidence is clearly transient, request-local, or otherwise not a durable memory candidate.',
    'WRITE_CANDIDATE: the evidence clearly states a sufficiently persistent fact, preference, goal, constraint, or state that may be worth durable-memory review.',
    'ESCALATE: the supplied evidence is insufficient or ambiguous in persistence, scope, reference, or meaning in a way that prevents safely deciding between NO_WRITE and WRITE_CANDIDATE. Do not resolve that ambiguity yourself.',
    'This classification is advisory only and does not authorize a durable write.',
  ].join('\n'));
  assert.match(prompt.messages[1].content, new RegExp(
    `INSTRUCTION: ${DEFINED_LABEL_SEMANTICS_INSTRUCTION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
  ));
  assert.doesNotMatch(
    prompt.messages[1].content,
    /few[- ]shot|example|rationale|confidence|chain.of.thought/iu,
  );
  assert.match(
    prompt.messages[1].content,
    new RegExp(`OUTPUT_SCHEMA: ${JSON.stringify(TASK_SPECIFICATIONS.write_candidate_triage.outputSchema).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  );

  const changed = structuredClone(pilotCase);
  changed.adjudication.primary.label = 'WRITE_CANDIDATE';
  changed.ambiguityState = 'AMBIGUOUS';
  changed.hardGateExpectation = {
    status: 'UNKNOWN',
    guardScope: 'none',
    reasonCode: 'none',
  };
  assert.deepEqual(
    buildDefinedLabelSemanticsPrompt(changed).messages,
    prompt.messages,
  );

  const requests = [];
  await runDefinedLabelSemanticsCase(
    changed,
    {
      schemaFamily: null,
      screeningClass: 'WRITE_CANDIDATE',
      capabilityProbe: false,
      stratum: 'write_candidate',
    },
    runnerOptions(fakeFetch([outputForLabel('WRITE_CANDIDATE')], requests)),
  );
  assert.deepEqual(requests[0].body.messages, prompt.messages);
  const serialized = JSON.stringify(requests[0].body.messages);
  for (const hidden of [
    'HUMAN', 'adjudication', 'ambiguityState', 'calibrationMetadata',
    'hardGateExpectation', 'screeningClass', 'capabilityProbe',
    'eligibleFalseNoWriteCount', 'requiredMinimum',
  ]) {
    assert.equal(serialized.includes(hidden), false, hidden);
  }
});

test('validation runner makes exactly one defined-label call per case in fixture order', async () => {
  const fixture = loadValidationFixture();
  const requests = [];
  const report = await runValidationFixture(
    fixture,
    runnerOptions(fakeFetch(exactOutputs(fixture), requests)),
  );
  assert.equal(requests.length, CALLS_PLANNED);
  assert.equal(requests.length, 30);
  for (let index = 0; index < requests.length; index += 1) {
    const body = requests[index].body;
    assert.deepEqual(body.messages, buildDefinedLabelSemanticsPrompt(fixture.cases[index]).messages);
    assert.equal(body.model, FIXED_MODEL_CONFIGURATION.modelId);
    assert.equal(body.temperature, 0);
    assert.equal(body.max_tokens, 128);
    assert.equal(body.stream, false);
    assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
    assert.deepEqual(body.response_format, { type: 'json_object' });
  }

  assert.equal(report.reportVersion, VALIDATION_REPORT_VERSION);
  assert.equal(report.fixture.name, VALIDATION_FIXTURE_NAME);
  assert.deepEqual(report.humanReview, {
    protocolVersion: REVIEW_PROTOCOL_VERSION,
    candidateFixture: CANDIDATE_FIXTURE_NAME,
    completedAt: HUMAN_REVIEW_COMPLETED_AT,
    labelsComplete: 30,
    distribution: LABEL_DISTRIBUTION,
  });
  assert.equal(report.provenance.validationRunnerVersion, VALIDATION_RUNNER_VERSION);
  assert.equal(
    report.provenance.underlyingDefinedLabelExecutionRunnerVersion,
    DIAGNOSTIC_RUNNER_VERSION,
  );
  assert.equal(report.provenance.promptVersion, DEFINED_LABELS_PROMPT_VERSION);
  assert.equal(report.provenance.taskSpecificationVersion, 'p1b1-write-candidate-triage-v1');
  assert.equal(report.provenance.outputSchemaVersion, 'p1b1-write-candidate-triage-output-v1');
  assert.equal(report.provenance.modelId, FIXED_MODEL_CONFIGURATION.modelId);
  assert.equal(report.provenance.artifactId, FIXED_MODEL_CONFIGURATION.artifactId);
  assert.equal(report.provenance.modelSizeClass, '~4B');
  assert.equal(report.provenance.quantization, 'BF16');
  assert.equal(report.provenance.runtimeFamily, 'llama.cpp');
  assert.equal(report.provenance.runtimeVersion, FIXED_MODEL_CONFIGURATION.runtimeVersion);
  assert.equal(report.policyType, 'LOCAL_ONLY');
  assert.deepEqual(report.execution, {
    timeoutMs: FIXED_TIMEOUT_MS,
    callsPlanned: 30,
    callsCompleted: 30,
    automaticReruns: false,
  });
  assert.equal(report.observations.length, 30);
  assert.deepEqual(report.observations.map(item => item.caseId), [...FIXED_CASE_IDS]);
  assert.ok(report.observations.every(item => (
    item.underlyingPilotResult.configuration.runnerVersion === DIAGNOSTIC_RUNNER_VERSION
    && item.underlyingPilotResult.configuration.promptVersion === DEFINED_LABELS_PROMPT_VERSION
  )));
  assert.equal(report.finalDisposition, FINAL_DISPOSITIONS.PASS);
  assert.equal(exitCodeForReport(report), 0);
});

test('summary records confusion, class recall, safety errors, invalid output, and runtime separately', async () => {
  const fixture = loadValidationFixture();
  const noWriteIndex = fixture.cases.findIndex(item => item.adjudication.primary.label === 'NO_WRITE');
  const writeIndex = fixture.cases.findIndex(item => item.adjudication.primary.label === 'WRITE_CANDIDATE');
  const escalateIndexes = fixture.cases
    .map((item, index) => item.adjudication.primary.label === 'ESCALATE' ? index : -1)
    .filter(index => index >= 0);
  const report = await reportWithOverrides(new Map([
    [noWriteIndex, outputForLabel('WRITE_CANDIDATE')],
    [writeIndex, outputForLabel('NO_WRITE')],
    [escalateIndexes[0], '```json\n{"decision":"ESCALATE"}\n```'],
    [escalateIndexes[1], new TypeError('synthetic unavailable')],
  ]));
  assert.deepEqual({
    totalCases: report.summary.totalCases,
    schemaValidOutputs: report.summary.schemaValidOutputs,
    invalidStructuredOutputs: report.summary.invalidStructuredOutputs,
    runtimeFailures: report.summary.runtimeFailures,
    exactMatches: report.summary.exactMatches,
    mismatches: report.summary.mismatches,
  }, {
    totalCases: 30,
    schemaValidOutputs: 28,
    invalidStructuredOutputs: 1,
    runtimeFailures: 1,
    exactMatches: 26,
    mismatches: 2,
  });
  assert.deepEqual(report.summary.confusionMatrix.NO_WRITE, {
    NO_WRITE: 9,
    WRITE_CANDIDATE: 1,
    ESCALATE: 0,
    INVALID: 0,
    RUNTIME_FAILURE: 0,
  });
  assert.deepEqual(report.summary.confusionMatrix.WRITE_CANDIDATE, {
    NO_WRITE: 1,
    WRITE_CANDIDATE: 9,
    ESCALATE: 0,
    INVALID: 0,
    RUNTIME_FAILURE: 0,
  });
  assert.deepEqual(report.summary.confusionMatrix.ESCALATE, {
    NO_WRITE: 0,
    WRITE_CANDIDATE: 0,
    ESCALATE: 8,
    INVALID: 1,
    RUNTIME_FAILURE: 1,
  });
  assert.deepEqual(report.summary.correctNoWrite, { numerator: 9, denominator: 10 });
  assert.deepEqual(report.summary.correctWriteCandidate, { numerator: 9, denominator: 10 });
  assert.deepEqual(report.summary.correctEscalate, { numerator: 8, denominator: 10 });
  assert.equal(report.summary.eligibleFalseNoWriteCount, 1);
  assert.equal(report.observations[escalateIndexes[0]].schemaStatus, SCHEMA_STATUSES.INVALID);
  assert.equal(report.observations[escalateIndexes[0]].taskOutcome, TASK_OUTCOMES.FAILURE);
  assert.equal(report.observations[escalateIndexes[1]].schemaStatus, SCHEMA_STATUSES.NOT_APPLICABLE);
  assert.equal(report.observations[escalateIndexes[1]].taskOutcome, TASK_OUTCOMES.NOT_RUN);
  assert.equal(report.finalDisposition, FINAL_DISPOSITIONS.INDETERMINATE_RUNTIME);
});

test('frozen acceptance dispositions implement exact semantic gates and runtime precedence', async () => {
  const fixture = loadValidationFixture();
  const indexes = Object.fromEntries(LABELS.map(label => [
    label,
    fixture.cases
      .map((item, index) => item.adjudication.primary.label === label ? index : -1)
      .filter(index => index >= 0),
  ]));

  const perfect = await reportWithOverrides();
  assert.equal(perfect.finalDisposition, FINAL_DISPOSITIONS.PASS);
  assert.equal(exitCodeForReport(perfect), 0);

  const classSeven = await reportWithOverrides(new Map(
    indexes.NO_WRITE.slice(0, 3).map(index => [index, outputForLabel('WRITE_CANDIDATE')]),
  ));
  assert.equal(classSeven.summary.correctNoWrite.numerator, 7);
  assert.equal(classSeven.summary.eligibleFalseNoWriteCount, 0);
  assert.equal(classSeven.finalDisposition, FINAL_DISPOSITIONS.FAIL);
  assert.equal(exitCodeForReport(classSeven), 0);

  const falseNoWrite = await reportWithOverrides(new Map([
    [indexes.WRITE_CANDIDATE[0], outputForLabel('NO_WRITE')],
  ]));
  assert.equal(falseNoWrite.summary.correctWriteCandidate.numerator, 9);
  assert.equal(falseNoWrite.summary.eligibleFalseNoWriteCount, 1);
  assert.equal(falseNoWrite.finalDisposition, FINAL_DISPOSITIONS.FAIL);

  const runtime = await reportWithOverrides(new Map([
    [indexes.ESCALATE[0], new TypeError('synthetic unavailable')],
  ]));
  assert.equal(runtime.summary.runtimeFailures, 1);
  assert.equal(runtime.finalDisposition, FINAL_DISPOSITIONS.INDETERMINATE_RUNTIME);
  assert.equal(exitCodeForReport(runtime), 1);

  const invalid = await reportWithOverrides(new Map([
    [indexes.ESCALATE[0], 'not-json'],
  ]));
  assert.equal(invalid.summary.invalidStructuredOutputs, 1);
  assert.equal(invalid.summary.runtimeFailures, 0);
  assert.equal(invalid.summary.correctEscalate.numerator, 9);
  assert.equal(invalid.finalDisposition, FINAL_DISPOSITIONS.PASS);

  const boundaryOverrides = new Map([
    ...indexes.NO_WRITE.slice(0, 2).map(index => [index, outputForLabel('WRITE_CANDIDATE')]),
    ...indexes.WRITE_CANDIDATE.slice(0, 2).map(index => [index, outputForLabel('ESCALATE')]),
    ...indexes.ESCALATE.slice(0, 2).map(index => [index, outputForLabel('WRITE_CANDIDATE')]),
  ]);
  const boundary = await reportWithOverrides(boundaryOverrides);
  assert.deepEqual([
    boundary.summary.correctNoWrite.numerator,
    boundary.summary.correctWriteCandidate.numerator,
    boundary.summary.correctEscalate.numerator,
  ], [8, 8, 8]);
  assert.equal(boundary.summary.eligibleFalseNoWriteCount, 0);
  assert.equal(boundary.finalDisposition, FINAL_DISPOSITIONS.PASS);

  const oneBelow = new Map(boundaryOverrides);
  oneBelow.set(indexes.ESCALATE[2], outputForLabel('WRITE_CANDIDATE'));
  const seven = await reportWithOverrides(oneBelow);
  assert.equal(seven.summary.correctEscalate.numerator, 7);
  assert.equal(seven.finalDisposition, FINAL_DISPOSITIONS.FAIL);

  const direct = acceptanceForSummary({
    ...boundary.summary,
    runtimeFailures: 1,
  });
  assert.equal(direct.finalDisposition, FINAL_DISPOSITIONS.INDETERMINATE_RUNTIME);
});

test('CLI allows only fixed Qwen3-4B BF16 and exposes no tuning controls', () => {
  const parsed = parseArguments(fixedCliArguments());
  assert.equal(parsed.modelId, 'xion-p1b1-qwen3-4b-bf16');
  assert.equal(parsed.artifactId, 'unsloth/Qwen3-4B-GGUF:BF16');
  assert.equal(parsed.modelSizeClass, '~4B');
  assert.equal(parsed.quantization, 'BF16');
  assert.equal(parsed.runtimeVersion, FIXED_MODEL_CONFIGURATION.runtimeVersion);

  for (const overrides of [
    { modelId: 'xion-p1b1-qwen3-1.7b-bf16' },
    { modelId: 'sub-1B' },
    { modelId: '7B' },
    { modelSizeClass: '~2B' },
    { modelSizeClass: '7B' },
    { quantization: 'Q8_0' },
    { artifactId: 'other-artifact' },
    { runtimeVersion: 'other-runtime' },
  ]) {
    assert.throws(() => parseArguments(fixedCliArguments(overrides)), /고정 ~4B BF16/);
  }
  for (const forbidden of [
    ['--timeout-ms', '1'],
    ['--fixture', 'other.json'],
    ['--case', 'one'],
    ['--prompt', 'other'],
    ['--threshold', '0.5'],
    ['--condition', 'defined'],
    ['--label-definition', 'other'],
    ['--model-family', 'other'],
    ['--rerun', 'true'],
  ]) {
    assert.throws(() => parseArguments([...fixedCliArguments(), ...forbidden]), /알 수 없는 인자/);
  }
  assert.doesNotMatch(
    helpText(),
    /--timeout|--fixture|--case|--prompt|--threshold|--condition|--label|--model-family|--rerun|~2B|7B|8B/,
  );

  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(
    packageJson.scripts['research:memory-inference-p1b2c-triage-validation'],
    'node scripts/run-memory-inference-p1b2c-triage-validation.js',
  );
});
