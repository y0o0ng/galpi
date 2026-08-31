'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { WORKLOAD_TYPES } = require('../lib/memory-inference-pilot');
const {
  HARD_GATE_EXPECTATIONS,
  POLICY_OUTCOMES,
  POLICY_TYPES,
  SCHEMA_STATUSES,
  TASK_OUTCOMES,
  validatePilotCase,
  validatePilotResult,
} = require('../lib/memory-inference-pilot-contracts');
const {
  CALIBRATION_PROMPT_VERSION,
  CALIBRATION_REPORT_VERSION,
  CALIBRATION_RUNNER_VERSION,
  CONTROL_DEFINITIONS,
  MODEL_SIZE_CLASSES,
  SCREENING_DECISIONS,
  TASK_SPECIFICATIONS,
  buildCalibrationPrompt,
  loadCalibrationFixture,
  runCalibrationCase,
  runCalibrationFixture,
  summarizeCalibrationRuns,
  validateCalibrationFixture,
} = require('../lib/memory-inference-local-calibration');
const {
  DEFAULT_FIXTURE,
  helpText,
  parseArguments,
} = require('../scripts/run-memory-inference-calibration');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE_PATH = path.join(ROOT, 'fixtures/local-memory-inference-p1b1-synthetic.json');

function runnerOptions(fetchImpl) {
  return {
    endpoint: 'http://127.0.0.1:8080/v1',
    modelId: 'synthetic-local-model',
    artifactId: 'synthetic-local-artifact-bf16',
    quantization: 'BF16',
    modelSizeClass: MODEL_SIZE_CLASSES.SUB_1B,
    runtimeFamily: 'llama.cpp',
    runtimeVersion: 'llama.cpp-test-commit',
    timeoutMs: 1_000,
    commit: 'a'.repeat(40),
    fetchImpl,
  };
}

function chatCompletion(content) {
  return JSON.stringify({
    id: 'synthetic-completion',
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
  });
}

function fakeFetch(contents, requests = []) {
  let index = 0;
  return async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    const content = typeof contents === 'function' ? contents(index) : contents[index];
    index += 1;
    return {
      ok: true,
      status: 200,
      async text() { return chatCompletion(content); },
    };
  };
}

function goldOutput(pilotCase) {
  const label = pilotCase.adjudication.primary.label;
  return pilotCase.workloadType === WORKLOAD_TYPES.STRUCTURED_EXTRACTION
    ? label
    : { decision: label };
}

function fixtureRuns(fixture, overrides = new Map()) {
  return fixture.cases.map(pilotCase => {
    const metadata = fixture.calibrationMetadata[pilotCase.caseId];
    const override = overrides.get(pilotCase.caseId) || {};
    const expected = goldOutput(pilotCase);
    const kind = override.kind || 'valid';
    const structuredOutput = override.output === undefined ? expected : override.output;
    const semanticMatch = kind === 'valid'
      && JSON.stringify(structuredOutput) === JSON.stringify(expected);
    const directResult = kind === 'runtime'
      ? {
          schemaStatus: SCHEMA_STATUSES.NOT_APPLICABLE,
          taskOutcome: TASK_OUTCOMES.NOT_RUN,
          structuredOutput: null,
        }
      : kind === 'invalid'
        ? {
            schemaStatus: SCHEMA_STATUSES.INVALID,
            taskOutcome: TASK_OUTCOMES.FAILURE,
            structuredOutput,
          }
        : {
            schemaStatus: SCHEMA_STATUSES.VALID,
            taskOutcome: semanticMatch ? TASK_OUTCOMES.SUCCESS : TASK_OUTCOMES.FAILURE,
            structuredOutput,
          };
    return {
      caseId: pilotCase.caseId,
      workloadType: pilotCase.workloadType,
      localFirstCompletionOpportunity:
        pilotCase.hardGateExpectation.status === HARD_GATE_EXPECTATIONS.DOES_NOT_APPLY,
      calibration: { ...metadata },
      semanticScoring: kind === 'valid'
        ? { status: 'SCORED', reasonCode: semanticMatch ? 'MATCH' : 'MISMATCH' }
        : { status: 'NOT_SCORED', reasonCode: kind === 'runtime' ? 'RUNNER_NOT_COMPLETED' : 'SCHEMA_INVALID' },
      result: { directResult },
    };
  });
}

function workloadSummary(runs, workloadType) {
  return summarizeCalibrationRuns(runs).find(item => item.workloadType === workloadType);
}

test('P1-B1 tracked fixture is exact, synthetic, and has preregistered distributions', () => {
  const fixture = loadCalibrationFixture(FIXTURE_PATH);
  assert.equal(validateCalibrationFixture(fixture), fixture);
  assert.equal(fixture.cases.length, 90);
  assert.equal(new Set(fixture.cases.map(item => item.caseId)).size, 90);
  assert.deepEqual(
    Object.keys(fixture.calibrationMetadata).sort(),
    fixture.cases.map(item => item.caseId).sort(),
  );
  for (const pilotCase of fixture.cases) assert.equal(validatePilotCase(pilotCase), pilotCase);

  const byWorkload = Object.fromEntries(Object.values(WORKLOAD_TYPES).map(workloadType => [
    workloadType,
    fixture.cases.filter(item => item.workloadType === workloadType).length,
  ]));
  assert.deepEqual(byWorkload, {
    structured_extraction: 30,
    write_candidate_triage: 30,
    ambiguity_escalation: 30,
  });
  const extractionFamilies = {};
  for (const pilotCase of fixture.cases.filter(item => (
    item.workloadType === WORKLOAD_TYPES.STRUCTURED_EXTRACTION
  ))) {
    const family = fixture.calibrationMetadata[pilotCase.caseId].schemaFamily;
    extractionFamilies[family] = (extractionFamilies[family] || 0) + 1;
  }
  assert.deepEqual(extractionFamilies, { date: 10, text_scalar: 10, quantity_unit: 10 });

  const triage = fixture.cases.filter(item => item.workloadType === WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE);
  const triageMeta = triage.map(item => fixture.calibrationMetadata[item.caseId]);
  assert.deepEqual({
    noWrite: triageMeta.filter(item => item.screeningClass === 'NO_WRITE').length,
    write: triageMeta.filter(item => item.screeningClass === 'WRITE_CANDIDATE').length,
    eligibleEscalate: triageMeta.filter(item => item.screeningClass === 'ESCALATE' && !item.capabilityProbe).length,
    probeEscalate: triageMeta.filter(item => item.screeningClass === 'ESCALATE' && item.capabilityProbe).length,
  }, { noWrite: 10, write: 10, eligibleEscalate: 5, probeEscalate: 5 });

  const ambiguity = fixture.cases.filter(item => item.workloadType === WORKLOAD_TYPES.AMBIGUITY_ESCALATION);
  const ambiguityMeta = ambiguity.map(item => fixture.calibrationMetadata[item.caseId]);
  assert.deepEqual({
    clear: ambiguityMeta.filter(item => item.screeningClass === 'CLEAR').length,
    eligibleEscalate: ambiguityMeta.filter(item => item.screeningClass === 'ESCALATE' && !item.capabilityProbe).length,
    probeEscalate: ambiguityMeta.filter(item => item.screeningClass === 'ESCALATE' && item.capabilityProbe).length,
  }, { clear: 12, eligibleEscalate: 10, probeEscalate: 8 });
  const ambiguityProbeReasons = ambiguity
    .filter(item => fixture.calibrationMetadata[item.caseId].capabilityProbe)
    .map(item => item.hardGateExpectation.reasonCode);
  for (const reasonCode of [
    'contract_identity_ambiguity',
    'contract_explicit_correction',
    'contract_core_or_high_impact',
    'contract_authority_sensitive',
  ]) {
    assert.equal(ambiguityProbeReasons.filter(reason => reason === reasonCode).length, 2);
  }
});

test('calibration metadata remains outside PilotCase and is never exposed to prompts', () => {
  const fixture = loadCalibrationFixture(FIXTURE_PATH);
  const pilotCase = structuredClone(fixture.cases[0]);
  pilotCase.adjudication.primary.label.reviewDate = '2099-12-31';
  const serialized = JSON.stringify(buildCalibrationPrompt(pilotCase).messages);
  assert.equal(serialized.includes('2099-12-31'), false);
  assert.equal(serialized.includes('adjudication'), false);
  assert.equal(serialized.includes('screeningClass'), false);
  assert.equal(serialized.includes('stratum'), false);
  assert.equal(serialized.includes('hardGateExpectation'), false);
  assert.throws(
    () => validatePilotCase({ ...fixture.cases[0], calibration: {} }),
    /허용되지 않은 필드/,
  );
});

test('all P1-B1 output schemas reject extra keys', () => {
  const samples = {
    'p1b1_date_v1': { reviewDate: '2030-01-15' },
    'p1b1_text_scalar_v1': { preferredMode: 'quiet' },
    'p1b1_quantity_unit_v1': { weeklyTarget: 3, unit: 'sessions' },
    write_candidate_triage: { decision: 'NO_WRITE' },
    ambiguity_escalation: { decision: 'CLEAR' },
  };
  for (const [key, specification] of Object.entries(TASK_SPECIFICATIONS)) {
    assert.equal(specification.validate(samples[key]), true, key);
    assert.equal(specification.validate({ ...samples[key], extra: 'forbidden' }), false, key);
    assert.equal(specification.outputSchema.additionalProperties, false, key);
  }
});

test('fake endpoint completes the 90-case LOCAL_ONLY path with reproducible provenance', async () => {
  const fixture = loadCalibrationFixture(FIXTURE_PATH);
  const outputs = fixture.cases.map(item => JSON.stringify(goldOutput(item)));
  const requests = [];
  const report = await runCalibrationFixture(fixture, runnerOptions(fakeFetch(outputs, requests)));

  assert.equal(report.reportVersion, CALIBRATION_REPORT_VERSION);
  assert.equal(report.runs.length, 90);
  assert.equal(requests.length, 90);
  assert.ok(requests.every(request => request.body.chat_template_kwargs.enable_thinking === false));
  assert.ok(requests.every(request => !JSON.stringify(request.body.messages).includes('screeningClass')));
  assert.equal(report.provenance.runnerVersion, CALIBRATION_RUNNER_VERSION);
  assert.equal(report.provenance.promptVersion, CALIBRATION_PROMPT_VERSION);
  assert.equal(report.provenance.modelId, 'synthetic-local-model');
  assert.equal(report.provenance.artifactId, 'synthetic-local-artifact-bf16');
  assert.equal(report.provenance.quantization, 'BF16');
  assert.equal(report.provenance.runtimeVersion, 'llama.cpp-test-commit');
  assert.equal(report.controls.length, 3);
  assert.deepEqual(report.controls, CONTROL_DEFINITIONS);
  assert.ok(report.workloads.every(item => item.screeningDecision === SCREENING_DECISIONS.PASS_CURRENT_SIZE));
  for (const run of report.runs) {
    assert.equal(validatePilotResult(run.result), run.result);
    assert.equal(run.result.policyType, POLICY_TYPES.LOCAL_ONLY);
    assert.equal(run.result.policyOutcome, POLICY_OUTCOMES.NOT_RUN);
  }
});

test('invalid JSON and schema-invalid output fail closed as direct local failures', async () => {
  const fixture = loadCalibrationFixture(FIXTURE_PATH);
  const dateCase = fixture.cases[0];
  const metadata = fixture.calibrationMetadata[dateCase.caseId];
  const invalidJson = await runCalibrationCase(
    dateCase,
    metadata,
    runnerOptions(fakeFetch(['```json\n{"reviewDate":"2030-01-15"}\n```'])),
  );
  assert.equal(invalidJson.result.directResult.schemaStatus, SCHEMA_STATUSES.INVALID);
  assert.equal(invalidJson.result.directResult.taskOutcome, TASK_OUTCOMES.FAILURE);
  assert.equal(invalidJson.result.directResult.error.code, 'MODEL_OUTPUT_INVALID_JSON');

  const schemaInvalid = await runCalibrationCase(
    dateCase,
    metadata,
    runnerOptions(fakeFetch([JSON.stringify({ reviewDate: '2030-01-15', extra: true })])),
  );
  assert.equal(schemaInvalid.result.directResult.schemaStatus, SCHEMA_STATUSES.INVALID);
  assert.equal(schemaInvalid.result.directResult.taskOutcome, TASK_OUTCOMES.FAILURE);
  assert.equal(schemaInvalid.result.directResult.error.code, 'MODEL_OUTPUT_SCHEMA_INVALID');
});

test('eligible unsafe triage and ambiguity outputs are critical while hard-gated probes are separate', () => {
  const fixture = loadCalibrationFixture(FIXTURE_PATH);
  const eligibleWrite = fixture.cases.find(item => item.caseId === 'p1b1-triage-write-001');
  const triageProbe = fixture.cases.find(item => item.caseId === 'p1b1-triage-probe-001');
  const triageOverrides = new Map([
    [eligibleWrite.caseId, { output: { decision: 'NO_WRITE' } }],
    [triageProbe.caseId, { output: { decision: 'NO_WRITE' } }],
  ]);
  const triage = workloadSummary(fixtureRuns(fixture, triageOverrides), WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE);
  assert.equal(triage.eligibleFalseNoWriteCount, 1);
  assert.equal(triage.criticalUnsafeFailures, 1);
  assert.equal(triage.probeMismatches, 1);

  const eligibleEscalate = fixture.cases.find(item => item.caseId === 'p1b1-ambiguity-escalate-001');
  const ambiguityProbe = fixture.cases.find(item => item.caseId === 'p1b1-ambiguity-probe-001');
  const ambiguityOverrides = new Map([
    [eligibleEscalate.caseId, { output: { decision: 'CLEAR' } }],
    [ambiguityProbe.caseId, { output: { decision: 'CLEAR' } }],
  ]);
  const ambiguity = workloadSummary(
    fixtureRuns(fixture, ambiguityOverrides),
    WORKLOAD_TYPES.AMBIGUITY_ESCALATION,
  );
  assert.equal(ambiguity.eligibleFalseClearCount, 1);
  assert.equal(ambiguity.criticalUnsafeFailures, 1);
  assert.equal(ambiguity.probeMismatches, 1);
});

test('hard-gated false decisions are probe mismatches but never critical failures', () => {
  const fixture = loadCalibrationFixture(FIXTURE_PATH);
  const triageProbe = fixture.cases.find(item => item.caseId === 'p1b1-triage-probe-001');
  const triage = workloadSummary(fixtureRuns(fixture, new Map([
    [triageProbe.caseId, { output: { decision: 'NO_WRITE' } }],
  ])), WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE);
  assert.equal(triage.probeMismatches, 1);
  assert.equal(triage.eligibleFalseNoWriteCount, 0);

  const ambiguityProbe = fixture.cases.find(item => item.caseId === 'p1b1-ambiguity-probe-001');
  const ambiguity = workloadSummary(fixtureRuns(fixture, new Map([
    [ambiguityProbe.caseId, { output: { decision: 'CLEAR' } }],
  ])), WORKLOAD_TYPES.AMBIGUITY_ESCALATION);
  assert.equal(ambiguity.probeMismatches, 1);
  assert.equal(ambiguity.eligibleFalseClearCount, 0);
});

test('extraction mismatch is critical and 27/30 passes while 26/30 advances', () => {
  const fixture = loadCalibrationFixture(FIXTURE_PATH);
  const extractionCases = fixture.cases.filter(item => item.workloadType === WORKLOAD_TYPES.STRUCTURED_EXTRACTION);
  const wrong = workloadSummary(fixtureRuns(fixture, new Map([
    [extractionCases[0].caseId, { output: { reviewDate: '2040-01-01' } }],
  ])), WORKLOAD_TYPES.STRUCTURED_EXTRACTION);
  assert.equal(wrong.criticalWrongValueCount, 1);
  assert.equal(wrong.screeningDecision, SCREENING_DECISIONS.ADVANCE_SIZE);

  const invalidOverrides = count => new Map(extractionCases.slice(0, count).map(item => [
    item.caseId,
    { kind: 'invalid', output: null },
  ]));
  const twentySeven = workloadSummary(
    fixtureRuns(fixture, invalidOverrides(3)),
    WORKLOAD_TYPES.STRUCTURED_EXTRACTION,
  );
  assert.equal(twentySeven.screeningMetric.numerator, 27);
  assert.equal(twentySeven.screeningDecision, SCREENING_DECISIONS.PASS_CURRENT_SIZE);
  const twentySix = workloadSummary(
    fixtureRuns(fixture, invalidOverrides(4)),
    WORKLOAD_TYPES.STRUCTURED_EXTRACTION,
  );
  assert.equal(twentySix.screeningMetric.numerator, 26);
  assert.equal(twentySix.screeningDecision, SCREENING_DECISIONS.ADVANCE_SIZE);
});

test('triage 8/10 recall passes and 7/10 advances when critical count is zero', () => {
  const fixture = loadCalibrationFixture(FIXTURE_PATH);
  const noWrite = fixture.cases.filter(item => (
    item.workloadType === WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE
    && fixture.calibrationMetadata[item.caseId].screeningClass === 'NO_WRITE'
  ));
  const misses = count => new Map(noWrite.slice(0, count).map(item => [
    item.caseId,
    { output: { decision: 'ESCALATE' } },
  ]));
  const eight = workloadSummary(fixtureRuns(fixture, misses(2)), WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE);
  assert.equal(eight.screeningMetric.numerator, 8);
  assert.equal(eight.criticalUnsafeFailures, 0);
  assert.equal(eight.screeningDecision, SCREENING_DECISIONS.PASS_CURRENT_SIZE);
  const seven = workloadSummary(fixtureRuns(fixture, misses(3)), WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE);
  assert.equal(seven.screeningMetric.numerator, 7);
  assert.equal(seven.screeningDecision, SCREENING_DECISIONS.ADVANCE_SIZE);
});

test('ambiguity finite boundary is 10/12 fail and 11/12 pass', () => {
  const fixture = loadCalibrationFixture(FIXTURE_PATH);
  const clear = fixture.cases.filter(item => (
    item.workloadType === WORKLOAD_TYPES.AMBIGUITY_ESCALATION
    && fixture.calibrationMetadata[item.caseId].screeningClass === 'CLEAR'
  ));
  const misses = count => new Map(clear.slice(0, count).map(item => [
    item.caseId,
    { output: { decision: 'ESCALATE' } },
  ]));
  const ten = workloadSummary(fixtureRuns(fixture, misses(2)), WORKLOAD_TYPES.AMBIGUITY_ESCALATION);
  assert.equal(ten.screeningMetric.numerator, 10);
  assert.ok(Math.abs(ten.screeningMetric.value - (10 / 12)) < 1e-12);
  assert.equal(ten.screeningDecision, SCREENING_DECISIONS.ADVANCE_SIZE);
  const eleven = workloadSummary(fixtureRuns(fixture, misses(1)), WORKLOAD_TYPES.AMBIGUITY_ESCALATION);
  assert.equal(eleven.screeningMetric.numerator, 11);
  assert.equal(eleven.screeningDecision, SCREENING_DECISIONS.PASS_CURRENT_SIZE);
});

test('runtime failure is INDETERMINATE_RUNTIME and cannot masquerade as capability failure', () => {
  const fixture = loadCalibrationFixture(FIXTURE_PATH);
  for (const workloadType of Object.values(WORKLOAD_TYPES)) {
    const pilotCase = fixture.cases.find(item => item.workloadType === workloadType);
    const summary = workloadSummary(fixtureRuns(fixture, new Map([
      [pilotCase.caseId, { kind: 'runtime' }],
    ])), workloadType);
    assert.equal(summary.runtimeFailures, 1);
    assert.equal(summary.screeningDecision, SCREENING_DECISIONS.INDETERMINATE_RUNTIME);
  }
});

test('actual endpoint failure remains a runner NOT_RUN and makes its workload indeterminate', async () => {
  const fixture = loadCalibrationFixture(FIXTURE_PATH);
  const pilotCase = fixture.cases[0];
  const failedRun = await runCalibrationCase(
    pilotCase,
    fixture.calibrationMetadata[pilotCase.caseId],
    runnerOptions(async () => { throw new TypeError('synthetic unavailable'); }),
  );
  assert.equal(failedRun.result.directResult.taskOutcome, TASK_OUTCOMES.NOT_RUN);
  assert.equal(failedRun.result.directResult.schemaStatus, SCHEMA_STATUSES.NOT_APPLICABLE);
  assert.equal(failedRun.result.directResult.error.code, 'LOCAL_ENDPOINT_UNAVAILABLE');
  const runs = fixtureRuns(fixture);
  runs[runs.findIndex(run => run.caseId === pilotCase.caseId)] = failedRun;
  const summary = workloadSummary(runs, WORKLOAD_TYPES.STRUCTURED_EXTRACTION);
  assert.equal(summary.runtimeFailures, 1);
  assert.equal(summary.screeningDecision, SCREENING_DECISIONS.INDETERMINATE_RUNTIME);
});

test('capability probes stay outside LOCAL_FIRST completion metrics', () => {
  const fixture = loadCalibrationFixture(FIXTURE_PATH);
  const summaries = summarizeCalibrationRuns(fixtureRuns(fixture));
  const triage = summaries.find(item => item.workloadType === WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE);
  const ambiguity = summaries.find(item => item.workloadType === WORKLOAD_TYPES.AMBIGUITY_ESCALATION);
  assert.equal(triage.hardGatedCapabilityProbes, 5);
  assert.equal(triage.nonHardGatedCases, 25);
  assert.equal(triage.localFirstCompletionOpportunities, 23);
  assert.equal(ambiguity.hardGatedCapabilityProbes, 8);
  assert.equal(ambiguity.nonHardGatedCases, 22);
  assert.equal(ambiguity.localFirstCompletionOpportunities, 22);
});

test('calibration runner does not mutate DB, Vault, or production state', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'galpi-p1b1-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const dbSentinel = path.join(tempDir, 'galpi.db');
  const vaultSentinel = path.join(tempDir, 'vault-sentinel.md');
  fs.writeFileSync(dbSentinel, 'synthetic-db-sentinel');
  fs.writeFileSync(vaultSentinel, 'synthetic-vault-sentinel');
  const fixture = loadCalibrationFixture(FIXTURE_PATH);
  const pilotCase = fixture.cases[0];
  await runCalibrationCase(
    pilotCase,
    fixture.calibrationMetadata[pilotCase.caseId],
    runnerOptions(fakeFetch([JSON.stringify(goldOutput(pilotCase))])),
  );
  assert.equal(fs.readFileSync(dbSentinel, 'utf8'), 'synthetic-db-sentinel');
  assert.equal(fs.readFileSync(vaultSentinel, 'utf8'), 'synthetic-vault-sentinel');
});

test('P1-B1 CLI exposes one fixed calibration command without threshold knobs', () => {
  assert.equal(DEFAULT_FIXTURE, FIXTURE_PATH);
  const parsed = parseArguments([
    '--endpoint', 'http://127.0.0.1:8080/v1',
    '--model', 'model',
    '--artifact', 'artifact',
    '--quantization', 'BF16',
    '--model-size-class', 'sub-1B',
    '--runtime-version', 'runtime-commit',
  ]);
  assert.equal(parsed.modelSizeClass, MODEL_SIZE_CLASSES.SUB_1B);
  assert.equal(parsed.quantization, 'BF16');
  assert.throws(() => parseArguments([
    '--endpoint', 'http://127.0.0.1:8080/v1',
    '--model', 'model',
    '--artifact', 'artifact',
    '--quantization', 'Q8_0',
    '--model-size-class', 'sub-1B',
    '--runtime-version', 'runtime-commit',
  ]), /BF16/);
  assert.match(helpText(), /고정된 P1-B1 screening rule/);
  assert.doesNotMatch(helpText(), /threshold <|minimum <|recall <|critical <|completion </);
});
