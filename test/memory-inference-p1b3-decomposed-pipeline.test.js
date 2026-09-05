'use strict';

const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const {
  loadInputs, validateInputs, INPUT_FILES, INPUT_IDENTITIES, PHASES, TIMEOUT_MS, PREFLIGHT_TIMEOUT_MS,
  RUNNER_VERSION, BINARY_INSTRUCTION, BINARY_SPECIFICATION, BINARY_PROMPT_VERSION,
  buildStagePrompt, endpointUrls, runPhase, parseArguments,
} = require('../scripts/run-memory-inference-p1b3-decomposed-pipeline');
const { buildCalibrationPrompt, TASK_SPECIFICATIONS } = require('../lib/memory-inference-local-calibration');
const { buildDefinedLabelSemanticsPrompt } = require('../scripts/run-memory-inference-triage-label-semantics-diagnostic');

mock.method(globalThis, 'fetch', () => { throw new Error('Real network forbidden in P1-B3 tests'); });
test.after(() => mock.restoreAll());
const inputs = loadInputs();
const COMMIT = 'a'.repeat(40);
const ENDPOINT = 'http://p1b3.invalid/v1';
const response = (text, status = 200) => ({ ok: status === 200, status, text: async () => text });
const assistant = content => response(JSON.stringify({ choices: [{ message: { content } }] }));

function perfect({ stageId, candidate, index }) {
  const gold = inputs.human.labels[index].label;
  if (stageId === 'extraction') return inputs.authoring.cases[candidate.caseId].extractionGold;
  if (stageId === 'ambiguity') return { decision: gold === 'ESCALATE' ? 'ESCALATE' : 'CLEAR' };
  return { decision: gold };
}

function harness(phase, reply = perfect) {
  const requests = [];
  let arm;
  const fetchImpl = async (url, init) => {
    if (init.method === 'GET') {
      requests.push({ url, method: 'GET' });
      return response('{"status":"ok"}');
    }
    const body = JSON.parse(init.body);
    const content = body.messages[1].content;
    const input = JSON.parse(content.slice(content.lastIndexOf('\nINPUT: ') + 8));
    const index = inputs.candidates.cases.findIndex(row => row.inputPayload.evidence === input.evidence);
    const candidate = inputs.candidates.cases[index];
    const stageId = content.includes('TASK_SPECIFICATION: p1b3-binary') ? 'binary'
      : content.includes('TASK_SPECIFICATION: p1b1-ambiguity') ? 'ambiguity'
        : content.includes('TASK_SPECIFICATION: p1b1-write') ? 'triage' : 'extraction';
    if (stageId === 'triage') arm = 'L4';
    if (stageId === 'ambiguity') arm = phase === '4b' ? 'D4' : 'D1.7';
    const request = { url, method: 'POST', body, input, index, candidate, stageId, arm };
    requests.push(request);
    const value = await reply(request);
    if (value instanceof Error) throw value;
    if (value?.text) return value;
    return assistant(typeof value === 'string' ? value : JSON.stringify(value));
  };
  return { requests, fetchImpl };
}

function options(phase, fetchImpl) { return { phase, endpoint: ENDPOINT, commit: COMMIT, fetchImpl }; }

function pilotCase(candidate, workloadType) {
  return {
    caseId: candidate.caseId, workloadType, sourceType: 'synthetic',
    taskContractVersion: 'xion-local-memory-inference-case-v1',
    inputPayload: workloadType === 'structured_extraction' ? candidate.inputPayload
      : { evidence: candidate.inputPayload.evidence },
    adjudication: { state: 'UNADJUDICATED', primary: null, blindSecondPass: null,
      disagreementState: 'NOT_ASSESSED', finalResolvedHumanLabel: null,
      cloudAssistedReview: { performed: false, configurationId: null, suggestion: null } },
    ambiguityState: 'ADJUDICATION_NEEDED',
    hardGateExpectation: { status: 'DOES_NOT_APPLY', guardScope: 'none', reasonCode: 'none' },
  };
}

test('P1-B3 inputs have exact ordered IDs, identities, byte digests, HUMAN distribution, and valid extraction gold', () => {
  assert.equal(inputs.candidates.cases.length, 60);
  for (const [key, file] of Object.entries(INPUT_FILES)) {
    assert.equal(inputs[key].name, INPUT_IDENTITIES[key]);
    assert.deepEqual(inputs.provenance[key], { identity: INPUT_IDENTITIES[key],
      sha256: createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', file))).digest('hex') });
  }
  assert.deepEqual(inputs.candidates.cases.map(row => row.caseId), inputs.human.labels.map(row => row.caseId));
  assert.deepEqual(Object.keys(inputs.authoring.cases), inputs.human.labels.map(row => row.caseId));
  assert.equal(inputs.human.labels[32].label, 'WRITE_CANDIDATE');
  for (const label of ['NO_WRITE', 'WRITE_CANDIDATE', 'ESCALATE']) {
    assert.equal(inputs.human.labels.filter(row => row.label === label).length, 20);
  }
  for (const row of inputs.candidates.cases) {
    assert.ok(TASK_SPECIFICATIONS[row.inputPayload.expectedSchema].validate(inputs.authoring.cases[row.caseId].extractionGold));
  }
  for (const mutate of [
    value => { value.candidates.name = 'v1'; },
    value => { value.human.name = 'primary'; },
    value => { value.authoring.name = 'v1'; },
    value => { value.human.candidateFixture = 'v1'; },
    value => { value.authoring.candidateFixture = 'v1'; },
    value => { value.candidates.cases.reverse(); },
    value => { value.human.labels.reverse(); },
    value => { value.human.labels.pop(); },
    value => { value.human.labels[0].label = 'WRITE_CANDIDATE'; },
    value => { delete value.authoring.cases[value.candidates.cases[0].caseId]; },
    value => { value.authoring.cases[value.candidates.cases[0].caseId].extractionGold = { reviewDate: '2027-02-30' }; },
  ]) {
    const modified = structuredClone(inputs);
    mutate(modified);
    assert.throws(() => validateInputs(modified));
  }
});

test('authoringTarget is never read for execution or scoring; resolved HUMAN is the only class gold', async () => {
  const modified = structuredClone(inputs);
  for (const entry of Object.values(modified.authoring.cases)) {
    Object.defineProperty(entry, 'authoringTarget', { enumerable: true,
      get() { throw new Error('authoringTarget must not be read'); } });
  }
  const fake = harness('1.7b');
  const report = await runPhase(options('1.7b', fake.fetchImpl), modified);
  assert.equal(report.armSummaries['D1.7'].endToEndSuccess, 60);
  assert.deepEqual(report.observations.map(row => row.humanGoldLabel), inputs.human.labels.map(row => row.label));
  assert.equal(report.observations[32].arms['D1.7'].stages.extraction.invoked, true);
});

test('all L4 messages equal B2b; Stage 1 and Stage 3 messages equal frozen P1-B1', () => {
  for (const candidate of inputs.candidates.cases) {
    assert.deepEqual(buildStagePrompt('triage', candidate),
      buildDefinedLabelSemanticsPrompt(pilotCase(candidate, 'write_candidate_triage')));
    assert.deepEqual(buildStagePrompt('ambiguity', candidate),
      buildCalibrationPrompt(pilotCase(candidate, 'ambiguity_escalation')));
    assert.deepEqual(buildStagePrompt('extraction', candidate),
      buildCalibrationPrompt(pilotCase(candidate, 'structured_extraction')));
  }
});

test('Stage 2 has exactly the preregistered binary instruction, scaffold, schema, and evidence payload', () => {
  const doc = fs.readFileSync(path.join(__dirname, '../docs/Memory research/local-memory-inference-study-design.md'), 'utf8');
  assert.ok(doc.includes(`\n${BINARY_INSTRUCTION}\n`));
  assert.equal(BINARY_SPECIFICATION.taskSpecificationVersion, 'p1b3-binary-write-candidate-triage-v1');
  assert.equal(BINARY_SPECIFICATION.outputSchemaVersion, 'p1b3-binary-write-candidate-triage-output-v1');
  assert.deepEqual(BINARY_SPECIFICATION.outputSchema, {
    type: 'object', additionalProperties: false, required: ['decision'],
    properties: { decision: { type: 'string', enum: ['NO_WRITE', 'WRITE_CANDIDATE'] } },
  });
  const candidate = inputs.candidates.cases[2];
  const prompt = buildStagePrompt('binary', candidate);
  assert.equal(prompt.promptVersion, BINARY_PROMPT_VERSION);
  assert.deepEqual(prompt.messages, [
    buildCalibrationPrompt(pilotCase(candidate, 'ambiguity_escalation')).messages[0],
    { role: 'user', content: [
      'WORKLOAD: binary_write_candidate_triage',
      'TASK_SPECIFICATION: p1b3-binary-write-candidate-triage-v1',
      `INSTRUCTION: ${BINARY_INSTRUCTION}`,
      `OUTPUT_SCHEMA: ${JSON.stringify(BINARY_SPECIFICATION.outputSchema)}`,
      `INPUT: ${JSON.stringify({ evidence: candidate.inputPayload.evidence })}`,
    ].join('\n') },
  ]);
  for (const output of [{ decision: 'ESCALATE' }, {}, null, [],
    { decision: 'NO_WRITE', confidence: 1 }, { decision: 'clear' }]) {
    assert.equal(BINARY_SPECIFICATION.validate(output), false);
  }
  for (const decision of ['NO_WRITE', 'WRITE_CANDIDATE']) assert.ok(BINARY_SPECIFICATION.validate({ decision }));
});

test('both phases use one preflight then exact case-local order, original evidence, and fixed HTTP contract', async () => {
  for (const phase of ['4b', '1.7b']) {
    const fake = harness(phase);
    const report = await runPhase(options(phase, fake.fetchImpl));
    assert.deepEqual(fake.requests[0], { url: 'http://p1b3.invalid/health', method: 'GET' });
    assert.equal(fake.requests.filter(row => row.method === 'GET').length, 1);
    const expectedOrder = [];
    for (const [index, candidate] of inputs.candidates.cases.entries()) {
      const gold = inputs.human.labels[index].label;
      for (const arm of PHASES[phase].arms) {
        const stages = arm === 'L4' ? ['triage'] : ['ambiguity'];
        if (arm !== 'L4' && gold !== 'ESCALATE') stages.push('binary');
        if (gold === 'WRITE_CANDIDATE') stages.push('extraction');
        for (const stage of stages) expectedOrder.push([candidate.caseId, arm, stage]);
      }
    }
    assert.deepEqual(fake.requests.slice(1).map(row => [row.candidate.caseId, row.arm, row.stageId]), expectedOrder);
    for (const request of fake.requests.slice(1)) {
      assert.equal(request.url, 'http://p1b3.invalid/v1/chat/completions');
      assert.deepEqual(request.body, {
        model: PHASES[phase].model.modelId,
        messages: buildStagePrompt(request.stageId, request.candidate).messages,
        temperature: 0, max_tokens: 128, stream: false,
        chat_template_kwargs: { enable_thinking: false }, response_format: { type: 'json_object' },
      });
      assert.deepEqual(request.input, request.stageId === 'extraction' ? request.candidate.inputPayload
        : { evidence: request.candidate.inputPayload.evidence });
    }
    assert.equal(report.runnerVersion, RUNNER_VERSION);
    assert.equal(report.galpiCommit, COMMIT);
    assert.equal(report.timeoutMs, 180000);
    assert.equal(report.automaticReruns, false);
    assert.deepEqual(report.model, PHASES[phase].model);
    assert.deepEqual(report.runtime, { family: 'llama.cpp', version: 'e42214804794fca6abb61b1a5f9adae2a845f0be' });
    assert.equal(report.preflight.success, true);
    const calls = phase === '4b' ? 200 : 120;
    assert.deepEqual(report.execution, { casesPlanned: 60, maxPossibleCalls: phase === '4b' ? 300 : 180,
      callsPlanned: calls, callsAttempted: calls, callsCompleted: calls, invalidStructuredOutputs: 0, runtimeFailures: 0 });
    for (const arm of PHASES[phase].arms) {
      const summary = report.armSummaries[arm];
      assert.equal(summary.endToEndSuccess, 60);
      assert.equal(summary.endToEndSuccessRate, 1);
      assert.equal(summary.terminalEscalation, 20);
      assert.equal(summary.terminalEscalationRate, 20 / 60);
      assert.equal(summary.unsafeNonEscalation, 0);
      assert.equal(summary.falseNoWrite, 0);
      assert.equal(summary.schemaValidExtractionWrongValue, 0);
      assert.equal(summary.meanInvokedCallLatencyMs, summary.totalLatencyMs / summary.invokedCallCount);
      assert.equal(summary.meanCaseTotalLatencyMs, summary.totalLatencyMs / 60);
      assert.equal(Object.values(summary.stages).reduce((sum, stage) => sum + stage.callsAttempted, 0), summary.callsAttempted);
      for (const row of report.observations) {
        const stages = Object.values(row.arms[arm].stages);
        assert.equal(row.arms[arm].totalLatencyMs, stages.filter(stage => stage.invoked).reduce((sum, stage) => sum + stage.latencyMs, 0));
        for (const stage of stages.filter(stage => !stage.invoked)) {
          assert.equal(stage.latencyMs, null);
          assert.equal(stage.attempted, false);
          assert.ok(stage.skipReason);
        }
      }
    }
  }
});

test('an incorrect CLEAR on HUMAN ESCALATE still invokes gold-free binary/extraction and counts only the applicable safety error', async () => {
  const fake = harness('1.7b', request => {
    if (request.index !== 2) return perfect(request);
    return request.stageId === 'ambiguity' ? { decision: 'CLEAR' }
      : request.stageId === 'binary' ? { decision: 'WRITE_CANDIDATE' }
        : { weeklyTarget: 999, unit: 'pages' };
  });
  const report = await runPhase(options('1.7b', fake.fetchImpl));
  const result = report.observations[2].arms['D1.7'];
  assert.equal(result.stages.binary.invoked, true);
  assert.equal(result.stages.binary.schemaStatus, 'VALID');
  assert.equal(result.stages.extraction.invoked, true);
  assert.equal(result.endToEndSuccess, false);
  assert.equal(result.unsafeNonEscalation, true);
  assert.equal(result.schemaValidExtractionWrongValue, false);
  assert.equal(report.armSummaries['D1.7'].schemaValidExtractionWrongValue, 0);
  assert.equal(report.execution.callsPlanned, 122);
});

test('false NO_WRITE, wrong-value extraction, and wrong HUMAN control flow remain separate', async () => {
  const fake = harness('4b', request => {
    if (request.index === 1 && request.stageId === 'extraction') return { preferredMode: 'wrong' };
    if (request.index === 2) return { decision: request.stageId === 'ambiguity' ? 'CLEAR' : 'NO_WRITE' };
    if (request.index === 3) return { decision: request.stageId === 'ambiguity' ? 'CLEAR' : 'NO_WRITE' };
    if (request.index === 0) return request.stageId === 'extraction' ? { reviewDate: '2000-01-01' }
      : { decision: request.stageId === 'ambiguity' ? 'CLEAR' : 'WRITE_CANDIDATE' };
    return perfect(request);
  });
  const report = await runPhase(options('4b', fake.fetchImpl));
  for (const arm of ['L4', 'D4']) {
    const summary = report.armSummaries[arm];
    assert.equal(summary.endToEndSuccess, 56);
    assert.equal(summary.falseNoWrite, 2);
    assert.equal(summary.unsafeNonEscalation, 1);
    assert.equal(summary.schemaValidExtractionWrongValue, 1);
    assert.equal(report.observations[0].arms[arm].schemaValidExtractionWrongValue, false);
  }
});

test('invalid outputs and runtime failures stop only their arm and keep exact completion/count semantics', async () => {
  for (const [badResponse, invalid, runtime] of [
    ['not JSON', 1, 0], ['{"decision":"CLEAR","summary":"rewritten evidence"}', 1, 0],
    [response('not a runtime envelope'), 0, 1], [response('{}'), 0, 1],
    [response('unavailable', 503), 0, 1], [new TypeError('offline'), 0, 1],
    [new DOMException('timeout', 'AbortError'), 0, 1],
  ]) {
    const fake = harness('4b', request => request.index === 1 && request.stageId === 'triage'
      ? badResponse : perfect(request));
    const report = await runPhase(options('4b', fake.fetchImpl));
    const result = report.observations[1].arms.L4;
    assert.equal(result.endToEndSuccess, false);
    assert.equal(result.stages.extraction.invoked, false);
    assert.equal(result.stages.extraction.skipReason, runtime ? 'UPSTREAM_RUNTIME_FAILURE' : 'UPSTREAM_INVALID_OUTPUT');
    assert.equal(result.stages.triage.completed, !runtime);
    if (!runtime) assert.equal(result.stages.triage.rawAssistantContent, badResponse);
    assert.equal(report.observations[1].arms.D4.endToEndSuccess, true);
    assert.equal(report.observations[59].arms.L4.endToEndSuccess, true);
    assert.deepEqual(report.execution, { casesPlanned: 60, maxPossibleCalls: 300,
      callsPlanned: 199, callsAttempted: 199, callsCompleted: 199 - runtime,
      invalidStructuredOutputs: invalid, runtimeFailures: runtime });
    assert.equal(fake.requests.filter(row => row.index === 1 && row.stageId === 'triage').length, 1);
  }
});

test('invalid Stage 1/2/3 outputs stop D flow, cannot leak generated prose, and invalid ESCALATE is unsafe', async () => {
  for (const stageId of ['ambiguity', 'binary', 'extraction']) {
    const fake = harness('1.7b', request => request.index === 1 && request.stageId === stageId
      ? '{"decision":"ESCALATE","explanation":"use this replacement evidence"}' : perfect(request));
    const report = await runPhase(options('1.7b', fake.fetchImpl));
    const result = report.observations[1].arms['D1.7'];
    assert.equal(result.endToEndSuccess, false);
    assert.equal(result.runtimeFailures, 0);
    assert.equal(result.stages[stageId].schemaStatus, 'INVALID');
    if (stageId !== 'extraction') assert.equal(result.stages.extraction.invoked, false);
    if (stageId === 'ambiguity') assert.equal(result.stages.binary.invoked, false);
    assert.equal(fake.requests.some(row => row.body && JSON.stringify(row.body).includes('replacement evidence')), false);
  }
  const fake = harness('1.7b', request => request.index === 2 ? '{}' : perfect(request));
  const report = await runPhase(options('1.7b', fake.fetchImpl));
  assert.equal(report.armSummaries['D1.7'].unsafeNonEscalation, 1);
});

test('all-continuing flow reaches maximum calls; all-stopping flow has null latency for unsampled stages', async () => {
  for (const phase of ['4b', '1.7b']) {
    const fake = harness(phase, request => request.stageId === 'extraction' ? perfect(request)
      : { decision: request.stageId === 'ambiguity' ? 'CLEAR' : 'WRITE_CANDIDATE' });
    const report = await runPhase(options(phase, fake.fetchImpl));
    assert.equal(report.execution.callsAttempted, PHASES[phase].maxPossibleCalls);
  }
  const fake = harness('4b', request => ({ decision: request.stageId === 'triage' ? 'NO_WRITE' : 'ESCALATE' }));
  const report = await runPhase(options('4b', fake.fetchImpl));
  assert.equal(report.execution.callsAttempted, 120);
  for (const stage of [report.armSummaries.L4.stages.extraction,
    report.armSummaries.D4.stages.binary, report.armSummaries.D4.stages.extraction]) {
    assert.equal(stage.callsPlanned, 0);
    assert.equal(stage.invokedCallCount, 0);
    assert.equal(stage.totalLatencyMs, null);
    assert.equal(stage.meanInvokedCallLatencyMs, null);
  }
});

test('D runtime failures at every stage stop downstream only and count one incomplete call', async () => {
  for (const stageId of ['ambiguity', 'binary', 'extraction']) {
    const fake = harness('4b', request => request.index === 1 && request.arm === 'D4'
      && request.stageId === stageId ? new TypeError('synthetic unavailable') : perfect(request));
    const report = await runPhase(options('4b', fake.fetchImpl));
    const result = report.observations[1].arms.D4;
    const requiredCalls = 200 - ['ambiguity', 'binary', 'extraction'].indexOf('extraction')
      + ['ambiguity', 'binary', 'extraction'].indexOf(stageId);
    assert.equal(result.runtimeFailures, 1);
    assert.equal(result.endToEndSuccess, false);
    assert.equal(result.schemaValidExtractionWrongValue, false);
    assert.equal(result.stages[stageId].completed, false);
    assert.equal(report.observations[1].arms.L4.endToEndSuccess, true);
    assert.equal(report.observations[59].arms.D4.endToEndSuccess, true);
    assert.equal(report.execution.callsPlanned, requiredCalls);
    assert.equal(report.execution.callsAttempted, requiredCalls);
    assert.equal(report.execution.callsCompleted, requiredCalls - 1);
    assert.equal(report.execution.runtimeFailures, 1);
    assert.equal(report.execution.invalidStructuredOutputs, 0);
  }
});

test('endpoint derivation and failed readiness never perform a semantic POST', async () => {
  assert.equal(PREFLIGHT_TIMEOUT_MS, 10000);
  for (const suffix of ['', '/v1', '/v1/chat/completions', '/chat/completions']) {
    assert.equal(endpointUrls(`http://p1b3.invalid/prefix${suffix}`).health, 'http://p1b3.invalid/prefix/health');
  }
  for (const invalid of ['http://name:secret@p1b3.invalid', 'file:///tmp/test',
    'http://p1b3.invalid?token=secret', 'http://p1b3.invalid#fragment', 'invalid']) {
    assert.throws(() => endpointUrls(invalid));
  }
  for (const health of [new TypeError('offline'), response('{}'), response('invalid JSON'),
    response('{"status":"loading"}', 503), response('{"status":"loading"}')]) {
    const calls = [];
    await assert.rejects(runPhase(options('4b', async (url, init) => {
      calls.push(init.method);
      if (health instanceof Error) throw health;
      return health;
    })), /preflight failed/);
    assert.deepEqual(calls, ['GET']);
  }
  let calls = 0;
  const invalidInputs = structuredClone(inputs);
  invalidInputs.human.labels.pop();
  await assert.rejects(runPhase(options('4b', async () => { calls += 1; }), invalidInputs));
  assert.equal(calls, 0);
});

test('actual fixed semantic timeout is 180000ms, makes one attempt, and allows the sibling arm/later cases', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started;
  const pending = new Promise(resolve => { started = resolve; });
  const fake = harness('4b', request => {
    if (request.index === 0 && request.stageId === 'triage') {
      started();
      return new Promise(() => {});
    }
    return perfect(request);
  });
  const running = runPhase(options('4b', fake.fetchImpl));
  await pending;
  t.mock.timers.tick(TIMEOUT_MS - 1);
  assert.equal(fake.requests.filter(row => row.method === 'POST').length, 1);
  t.mock.timers.tick(1);
  const report = await running;
  assert.equal(TIMEOUT_MS, 180000);
  assert.deepEqual(report.observations[0].arms.L4.stages.triage.runtimeError,
    { state: 'TIMEOUT', code: 'LOCAL_ENDPOINT_TIMEOUT' });
  assert.equal(report.observations[0].arms.D4.endToEndSuccess, true);
  assert.equal(report.execution.callsAttempted, 200);
  assert.equal(report.execution.callsCompleted, 199);
  assert.equal(report.execution.runtimeFailures, 1);
});

test('preflight timeout covers a stalled health body and produces no report or semantic attempt', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started;
  const pending = new Promise(resolve => { started = resolve; });
  const methods = [];
  const running = runPhase(options('1.7b', async (url, init) => {
    methods.push(init.method);
    return { ok: true, status: 200, text: () => { started(); return new Promise(() => {}); } };
  }));
  const rejected = assert.rejects(running, /preflight failed/);
  await pending;
  t.mock.timers.tick(10000);
  await rejected;
  assert.deepEqual(methods, ['GET']);
});

test('CLI/package commands freeze phases and reject experimental tuning or duplicate arguments', () => {
  assert.deepEqual(parseArguments(['--phase', '4b', '--endpoint', ENDPOINT, '--commit', COMMIT]),
    { phase: '4b', endpoint: ENDPOINT, commit: COMMIT });
  assert.equal(parseArguments(['--endpoint', ENDPOINT, '--phase', '1.7b']).commit, undefined);
  for (const args of [[], ['--phase', 'other', '--endpoint', ENDPOINT],
    ['--phase', '4b', '--endpoint'], ['--phase', '4b', '--endpoint', ENDPOINT, '--phase', '1.7b'],
    ...['model', 'artifact', 'quantization', 'model-size', 'timeout', 'prompt', 'schema', 'runtime-version']
      .map(flag => ['--phase', '4b', '--endpoint', ENDPOINT, `--${flag}`, 'other'])]) {
    assert.throws(() => parseArguments(args));
  }
  const pkg = require('../package.json');
  assert.equal(pkg.scripts['research:memory-inference-p1b3-4b'],
    'node scripts/run-memory-inference-p1b3-decomposed-pipeline.js --phase 4b');
  assert.equal(pkg.scripts['research:memory-inference-p1b3-1p7b'],
    'node scripts/run-memory-inference-p1b3-decomposed-pipeline.js --phase 1.7b');
});
