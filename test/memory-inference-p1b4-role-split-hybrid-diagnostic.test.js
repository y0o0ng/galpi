'use strict';

const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const b3 = require('../scripts/run-memory-inference-p1b3-decomposed-pipeline');
const b4a = require('../scripts/run-memory-inference-p1b4-ambiguity-recalibration');
const { combineReports, validatePhaseReport, pairedTransition, TRANSITIONS } =
  require('../scripts/combine-memory-inference-p1b3-decomposed-pipeline');
const {
  RUNNER_VERSION, SCORING_VERSION, REPORT_VERSION, SOURCE_COMMIT, SOURCE_ARTIFACTS, INPUT_SHA256,
  validateSourceReports, loadSources, runHybridCase, progression, runHybrid, parseArguments,
} = require('../scripts/run-memory-inference-p1b4-role-split-hybrid-diagnostic');

mock.method(globalThis, 'fetch', () => { throw new Error('Real network forbidden in P1-B4 tests'); });
test.after(() => mock.restoreAll());
const inputs = b3.loadInputs();
const source = loadSources();
const readReports = () => Object.fromEntries(Object.entries(SOURCE_ARTIFACTS).map(([key, value]) =>
  [key, JSON.parse(fs.readFileSync(path.join(__dirname, '..', value.file)))]));
const ENDPOINT = 'http://p1b4.invalid/v1';
const COMMIT = 'a'.repeat(40);
const AMBIGUITY_PATH = '/virtual/fake-p1b4a-report.json';
let ambiguityReport;
let ambiguityBytes;
const originalReadFile = fs.readFileSync;
mock.method(fs, 'readFileSync', function (file, ...args) {
  return String(file) === AMBIGUITY_PATH ? ambiguityBytes : originalReadFile.call(this, file, ...args);
});
const setAmbiguity = report => {
  ambiguityReport = report;
  ambiguityBytes = Buffer.from(JSON.stringify(report));
};
async function fakeAmbiguity(reply = ({ index }) => ({
  decision: inputs.human.labels[index].label === 'ESCALATE' ? 'ESCALATE' : 'CLEAR',
})) {
  return b4a.runRecalibration({ endpoint: ENDPOINT, commit: COMMIT, fetchImpl: harness(reply).fetchImpl });
}
test.beforeEach(async () => setAmbiguity(await fakeAmbiguity()));
const response = (text, status = 200) => ({ ok: status === 200, status, text: async () => text });
const counts = () => ({ callsPlanned: 0, callsAttempted: 0, callsCompleted: 0,
  invalidStructuredOutputs: 0, runtimeFailures: 0 });
const options = fetchImpl => ({ endpoint: ENDPOINT, ambiguityReport: AMBIGUITY_PATH, commit: COMMIT, fetchImpl });

function perfect({ index, candidate, stageId }) {
  return stageId === 'extraction' ? inputs.authoring.cases[candidate.caseId].extractionGold
    : { decision: inputs.human.labels[index].label };
}

function harness(reply = perfect) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    if (init.method === 'GET') {
      requests.push({ url, method: 'GET' });
      return response('{"status":"ok"}');
    }
    const body = JSON.parse(init.body);
    const message = body.messages[1].content;
    const input = JSON.parse(message.slice(message.lastIndexOf('\nINPUT: ') + 8));
    const index = inputs.candidates.cases.findIndex(row => row.inputPayload.evidence === input.evidence);
    assert.notEqual(index, -1, 'only unchanged original evidence is allowed');
    const candidate = inputs.candidates.cases[index];
    const stageId = message.includes('TASK_SPECIFICATION: p1b3-binary') ? 'binary' : 'extraction';
    const request = { url, method: 'POST', body, input, index, candidate, stageId, signal: init.signal };
    requests.push(request);
    const output = await reply(request);
    if (output instanceof Error) throw output;
    if (output?.text) return output;
    const content = typeof output === 'string' ? output : JSON.stringify(output);
    return response(JSON.stringify({ choices: [{ message: { content } }] }));
  };
  return { fetchImpl, requests };
}

test('exact committed P1-B3 bytes, identities, execution commit, input SHAs, and recombination', () => {
  const reports = readReports();
  for (const [key, artifact] of Object.entries(SOURCE_ARTIFACTS)) {
    const bytes = fs.readFileSync(path.join(__dirname, '..', artifact.file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256);
    assert.equal(reports[key].galpiCommit, '5b1c54cc97faada4a11afd2bb2132f2596f2f751');
    assert.deepEqual(reports[key].inputs, inputs.provenance);
  }
  assert.equal(reports.report4b.reportVersion, 'xion-local-memory-inference-p1b3-decomposed-pipeline-4b-report-v1');
  assert.equal(reports.report1p7b.reportVersion, 'xion-local-memory-inference-p1b3-decomposed-pipeline-1p7b-report-v1');
  assert.equal(reports.combined.reportVersion, 'xion-local-memory-inference-p1b3-decomposed-pipeline-combined-report-v1');
  assert.equal(validatePhaseReport(reports.report4b, '4b', inputs), reports.report4b);
  assert.equal(validatePhaseReport(reports.report1p7b, '1.7b', inputs), reports.report1p7b);
  assert.deepEqual(combineReports(reports.report4b, reports.report1p7b), reports.combined);
  assert.deepEqual(validateSourceReports(reports), reports.combined);
  for (const key of Object.keys(INPUT_SHA256)) assert.equal(inputs.provenance[key].sha256, INPUT_SHA256[key]);
  assert.deepEqual(inputs.human.labels.map(row => row.caseId), inputs.candidates.cases.map(row => row.caseId));
  for (const label of ['NO_WRITE', 'WRITE_CANDIDATE', 'ESCALATE']) {
    assert.equal(inputs.human.labels.filter(row => row.label === label).length, 20);
  }
});

test('committed P1-B3 metrics, strict fence invalidity, pairs, and historical disposition are frozen', () => {
  const c = source.combined;
  const metrics = ['endToEndSuccess', 'endToEndSuccessRate', 'unsafeNonEscalation',
    'falseNoWrite', 'schemaValidExtractionWrongValue', 'terminalEscalation'];
  for (const [arm, expected] of Object.entries({
    L4: [48, 0.8, 7, 6, 1, 13], D4: [20, 1 / 3, 0, 0, 0, 60],
    'D1.7': [32, 32 / 60, 1, 4, 0, 38],
  })) assert.deepEqual(metrics.map(key => c.armSummaries[arm][key]), expected);
  for (const [pair, expected] of Object.entries({
    'L4->D4': [13, 7, 35, 5, 0], 'D4->D1.7': [19, 13, 1, 27, 0], 'L4->D1.7': [23, 9, 25, 3, 0],
  })) assert.deepEqual(TRANSITIONS.map(key => c.pairedComparisons[pair][key]), expected);
  assert.equal(c.trainingTrigger.netSuccessfulCases, -16);
  assert.equal(c.trainingTrigger.deltaPercentagePoints, -26.666666666666668);
  assert.equal(c.runtimeFailures, 0);
  assert.equal(c.finalDisposition, 'NO_SPECIALIZED_TRAINING_SIGNAL');
  assert.deepEqual(c.sourceReports.map(r => [r.execution.callsPlanned, r.execution.callsAttempted,
    r.execution.callsCompleted, r.execution.invalidStructuredOutputs, r.preflight.success]),
  [[144, 144, 144, 0, true], [98, 98, 98, 1, true]]);
  const invalid = c.observations.filter(r => r.arms['D1.7'].stages.ambiguity.schemaStatus === 'INVALID');
  assert.equal(invalid.length, 1);
  assert.match(invalid[0].arms['D1.7'].stages.ambiguity.rawAssistantContent, /^```json\s*\{\s*"decision":\s*"ESCALATE"\s*\}\s*```\s*$/u);
  assert.equal(invalid[0].arms['D1.7'].unsafeNonEscalation, true);
  for (const r of c.observations) {
    assert.equal(r.arms.D4.stages.ambiguity.structuredOutput.decision, 'ESCALATE');
    assert.equal(r.arms.D4.stages.binary.invoked, false);
    assert.equal(r.arms.D4.stages.extraction.invoked, false);
  }
});

test('source provenance rejects altered commits, inputs, order, raw output, and forged scores before calls', async t => {
  for (const mutate of [
    r => { r.report4b.galpiCommit = r.report1p7b.galpiCommit = 'b'.repeat(40); },
    ...['candidates', 'human', 'authoring'].flatMap(key => [
      r => { r.report1p7b.inputs[key].sha256 = '0'.repeat(64); },
      r => { r.report1p7b.inputs[key].identity = 'other'; },
    ]),
    r => { r.report1p7b.observations.reverse(); },
    r => { r.report1p7b.observations.pop(); },
    r => { r.report1p7b.observations[0].arms['D1.7'].stages.ambiguity.rawAssistantContent = '{}'; },
    r => { r.report1p7b.observations[0].arms['D1.7'].endToEndSuccess = true; },
    r => { r.combined.finalDisposition = 'SPECIALIZED_TRAINING_WORTH_INVESTIGATING'; },
  ]) {
    const reports = readReports();
    mutate(reports);
    assert.throws(() => validateSourceReports(reports));
  }
  const modified = structuredClone(inputs);
  modified.provenance.human.sha256 = '0'.repeat(64);
  assert.throws(() => validateSourceReports(readReports(), modified), /frozen input SHA-256/);
  const originalRead = fs.readFileSync;
  const readMock = t.mock.method(fs, 'readFileSync', function (file, ...args) {
    const bytes = originalRead.call(this, file, ...args);
    return String(file).endsWith(SOURCE_ARTIFACTS.report4b.file) ? Buffer.concat([bytes, Buffer.from(' ')]) : bytes;
  });
  let calls = 0;
  await assert.rejects(runHybrid(options(async () => { calls += 1; })), /source artifact bytes changed/);
  assert.equal(calls, 0);
  readMock.mock.restore();
});

test('B4A records, not historical D1.7, are copied exactly with 4B-only downstream and frozen prompts', async () => {
  assert.equal(RUNNER_VERSION, 'xion-local-memory-inference-p1b4-role-split-hybrid-runner-v2');
  assert.equal(REPORT_VERSION, 'xion-local-memory-inference-p1b4-role-split-hybrid-report-v2');
  assert.equal(SCORING_VERSION, 'xion-local-memory-inference-p1b4-role-split-hybrid-scoring-v1');
  const before = structuredClone(source.combined);
  const fake = harness();
  const report = await runHybrid(options(fake.fetchImpl));
  assert.equal(report.runnerVersion, RUNNER_VERSION);
  assert.equal(report.scoringVersion, SCORING_VERSION);
  assert.equal(report.reportVersion, REPORT_VERSION);
  assert.equal(report.galpiCommit, COMMIT);
  assert.deepEqual(Object.keys(report.armSummaries), ['HYBRID']);
  assert.deepEqual(report.source.artifacts, source.provenance);
  assert.equal(report.source.galpiCommit, SOURCE_COMMIT);
  assert.equal(report.source.ambiguityArm, 'P1-B4A');
  assert.equal(report.source.ambiguityReport.sha256, createHash('sha256').update(ambiguityBytes).digest('hex'));
  assert.equal(report.source.ambiguityReport.galpiCommit, COMMIT);
  assert.equal(report.source.ambiguityReport.revalidated, true);
  assert.notDeepEqual(ambiguityReport.observations[0].ambiguity, source.combined.observations[0].arms['D1.7'].stages.ambiguity);
  assert.deepEqual(report.inputs, inputs.provenance);
  assert.deepEqual(report.model, b3.PHASES['4b'].model);
  assert.deepEqual(report.model, { modelId: 'xion-p1b1-qwen3-4b-bf16',
    artifactId: 'unsloth/Qwen3-4B-GGUF:BF16', modelSizeClass: '~4B', quantization: 'BF16' });
  assert.deepEqual(report.runtime, { family: 'llama.cpp', version: 'e42214804794fca6abb61b1a5f9adae2a845f0be' });
  assert.equal(report.timeoutMs, 180000);
  assert.equal(report.automaticReruns, false);
  assert.deepEqual(fake.requests[0], { url: 'http://p1b4.invalid/health', method: 'GET' });
  assert.equal(fake.requests.filter(r => r.method === 'GET').length, 1);
  const expectedOrder = [];
  const paired = Object.fromEntries(TRANSITIONS.map(key => [key, 0]));
  for (const [index, row] of report.observations.entries()) {
    const original = source.combined.observations[index];
    const h = row.arms.HYBRID;
    assert.equal(row.caseId, original.caseId);
    assert.equal(row.humanGoldLabel, inputs.human.labels[index].label);
    assert.deepEqual(h.stages.ambiguity, ambiguityReport.observations[index].ambiguity);
    assert.notEqual(h.stages.ambiguity, ambiguityReport.observations[index].ambiguity);
    assert.equal(h.stageOrigins.ambiguity, 'REUSED_P1B4A');
    assert.deepEqual(row.baselineL4, original.arms.L4);
    for (const id of ['binary', 'extraction']) {
      assert.equal(h.stageOrigins[id], h.stages[id].invoked ? 'NEW' : 'SKIPPED');
      if (h.stages[id].invoked) expectedOrder.push([index, id]);
      else assert.equal(h.stages[id].latencyMs, null);
    }
    if (h.stages.ambiguity.schemaStatus === 'INVALID') {
      assert.equal(h.stages.binary.invoked, false);
      assert.equal(h.endToEndSuccess, false);
      assert.equal(h.unsafeNonEscalation, true);
    } else if (h.stages.ambiguity.structuredOutput.decision === 'ESCALATE') {
      assert.equal(h.stages.binary.invoked, false);
      assert.equal(h.endToEndSuccess, row.humanGoldLabel === 'ESCALATE');
    } else {
      assert.equal(h.stages.binary.invoked, true);
      assert.equal(h.endToEndSuccess, true);
      assert.equal(h.stages.extraction.invoked, row.humanGoldLabel === 'WRITE_CANDIDATE');
    }
    assert.equal(h.totalLatencyMs, Object.values(h.stages).filter(s => s.invoked).reduce((sum, s) => sum + s.latencyMs, 0));
    assert.equal(row.transition, pairedTransition(row.baselineL4, h));
    paired[row.transition] += 1;
  }
  assert.deepEqual(fake.requests.slice(1).map(r => [r.index, r.stageId]), expectedOrder);
  for (const r of fake.requests.slice(1)) {
    assert.deepEqual(r.body, { model: b3.PHASES['4b'].model.modelId,
      messages: b3.buildStagePrompt(r.stageId, r.candidate).messages, temperature: 0, max_tokens: 128,
      stream: false, chat_template_kwargs: { enable_thinking: false }, response_format: { type: 'json_object' } });
    assert.deepEqual(r.input, r.stageId === 'binary' ? { evidence: r.candidate.inputPayload.evidence } : r.candidate.inputPayload);
    assert.equal(r.url, 'http://p1b4.invalid/v1/chat/completions');
    assert.ok(!r.body.messages[1].content.includes('p1b1-ambiguity-escalation-v1'));
  }
  assert.deepEqual(report.pairedComparisons['L4->HYBRID'], paired);
  assert.deepEqual(paired, { UNCHANGED_CORRECT: 48, FIXED: 12, REGRESSION: 0,
    UNCHANGED_WRONG: 0, NONCOMPARABLE_RUNTIME: 0 });
  assert.equal(report.execution.sourceAmbiguityCallsReused, 60);
  assert.equal(report.execution.newCallsPlanned, 60);
  assert.equal(report.execution.newCallsAttempted, 60);
  assert.equal(report.execution.newCallsCompleted, 60);
  assert.equal(report.execution.newInvalidStructuredOutputs, 0);
  assert.equal(report.execution.newRuntimeFailures, 0);
  assert.equal(report.execution.counterfactualHybridStageCalls, 120);
  assert.equal(report.execution.newStages.binary.callsAttempted, 40);
  assert.equal(report.execution.newStages.extraction.callsAttempted, 20);
  assert.equal(report.execution.sourceAmbiguity.invalidStructuredOutputs, 0);
  assert.equal(report.armSummaries.HYBRID.endToEndSuccess, 60);
  assert.equal(report.armSummaries.HYBRID.unsafeNonEscalation, 0);
  assert.equal(report.armSummaries.HYBRID.falseNoWrite, 0);
  assert.equal(report.armSummaries.HYBRID.schemaValidExtractionWrongValue, 0);
  assert.equal(report.armSummaries.HYBRID.terminalEscalation, 20);
  assert.equal(report.armSummaries.HYBRID.endToEndSuccessRate, 1);
  assert.equal(report.armSummaries.HYBRID.terminalEscalationRate, 20 / 60);
  const summary = report.armSummaries.HYBRID;
  assert.equal(summary.invokedCallCount, 120);
  assert.equal(summary.meanInvokedCallLatencyMs, summary.totalLatencyMs / 120);
  assert.equal(summary.meanCaseTotalLatencyMs, summary.totalLatencyMs / 60);
  assert.equal(report.finalDisposition, 'RAW_EPISODE_SUCCESSOR_OPEN');
  assert.match(report.execution.latencyBasis, /counterfactual, not wall-clock/);
  assert.deepEqual(source.combined, before);
});

test('historical pre-run analysis: superseded source ceiling was 40, below unchanged L4 48', () => {
  const rows = source.combined.observations;
  const decision = row => row.arms['D1.7'].stages.ambiguity.structuredOutput?.decision;
  const clear = rows.filter(row => decision(row) === 'CLEAR').length;
  const escalated = rows.filter(row => decision(row) === 'ESCALATE');
  const correctEscalations = escalated.filter(row => row.humanGoldLabel === 'ESCALATE').length;
  assert.deepEqual([escalated.length, clear, rows.length - escalated.length - clear, correctEscalations], [38, 21, 1, 19]);
  assert.equal(correctEscalations + clear, 40);
  assert.ok(correctEscalations + clear < source.combined.armSummaries.L4.endToEndSuccess);
});

test('B4A raw/schema/score/count/provenance tampering and missing source reject before any fetch', async () => {
  const valid = structuredClone(ambiguityReport);
  for (const mutate of [
    r => { r.reportVersion = 'other'; }, r => { r.runnerVersion = 'other'; },
    r => { r.promptVersion = 'old'; }, r => { r.taskSpecificationVersion = 'old'; },
    r => { r.model.modelId = b3.PHASES['4b'].model.modelId; },
    r => { r.runtime.version = 'other'; }, r => { r.timeoutMs = 1; },
    r => { r.automaticReruns = true; }, r => { r.requestSettings.temperature = 1; },
    ...['candidates', 'human', 'authoring'].flatMap(key => [
      r => { r.inputs[key].sha256 = '0'.repeat(64); },
      r => { r.inputs[key].identity = 'other'; },
    ]),
    r => { r.observations.reverse(); }, r => { r.observations.pop(); },
    r => { r.observations[0].ambiguity.rawAssistantContent = '{"decision":"ESCALATE"}'; },
    r => { r.observations[0].ambiguity.structuredOutput.decision = 'ESCALATE'; },
    r => { r.observations[0].ambiguity = source.combined.observations[0].arms['D1.7'].stages.ambiguity; },
    r => { r.observations[0].unnecessaryEscalation = true; },
    r => { r.summary.CLEAR -= 1; }, r => { r.execution.callsCompleted -= 1; },
    r => { r.galpiCommit = 'b'.repeat(40); },
  ]) {
    const changed = structuredClone(valid);
    mutate(changed);
    setAmbiguity(changed);
    let calls = 0;
    await assert.rejects(runHybrid(options(async () => { calls += 1; })));
    assert.equal(calls, 0);
  }
  await assert.rejects(runHybrid({ endpoint: ENDPOINT, commit: COMMIT,
    fetchImpl: async () => assert.fail('missing source must fail before network') }), /ambiguity-report is required/);
});

test('B4A runtime failure prevents 4B preflight and semantic calls, without repair', async () => {
  setAmbiguity(await fakeAmbiguity(({ index }) => index === 0 ? new TypeError('fake offline') : { decision: 'CLEAR' }));
  assert.equal(b4a.validateAmbiguityReport(ambiguityReport).runtimeDisposition, 'INDETERMINATE_RUNTIME');
  let calls = 0;
  await assert.rejects(runHybrid(options(async () => { calls += 1; })), { code: 'INDETERMINATE_RUNTIME' });
  assert.equal(calls, 0);
});

test('B4A INVALID remains semantic failure with no downstream; runtime-free poor scores have no entry gate', async () => {
  setAmbiguity(await fakeAmbiguity(({ index }) => index === 2 ? '```json\n{"decision":"ESCALATE"}\n```'
    : { decision: inputs.human.labels[index].label === 'ESCALATE' ? 'ESCALATE' : 'CLEAR' }));
  const fake = harness();
  const report = await runHybrid(options(fake.fetchImpl));
  const invalid = report.observations[2].arms.HYBRID;
  assert.deepEqual(invalid.stages.ambiguity, ambiguityReport.observations[2].ambiguity);
  assert.equal(invalid.stages.ambiguity.schemaStatus, 'INVALID');
  assert.equal(invalid.stages.binary.invoked, false);
  assert.equal(invalid.endToEndSuccess, false);
  assert.equal(invalid.unsafeNonEscalation, true);
  assert.equal(fake.requests.some(row => row.index === 2), false);
  assert.equal(report.execution.sourceAmbiguity.invalidStructuredOutputs, 1);
  assert.equal(report.execution.newInvalidStructuredOutputs, 0);
  assert.equal(report.runtimeFailures, 0);
  setAmbiguity(await fakeAmbiguity(() => ({ decision: 'ESCALATE' })));
  const noCalls = harness();
  const poor = await runHybrid(options(noCalls.fetchImpl));
  assert.deepEqual(noCalls.requests.map(row => row.method), ['GET']);
  assert.equal(poor.execution.newCallsAttempted, 0);
  assert.equal(poor.armSummaries.HYBRID.endToEndSuccess, 20);
  assert.equal(poor.finalDisposition, 'NO_RAW_EPISODE_SUCCESSOR_SIGNAL');
});

test('new invalid JSON/schema and runtime failures remain distinct, stop downstream, and never retry', async () => {
  for (const stageId of ['binary', 'extraction']) {
    for (const [bad, invalid, runtime] of [
      ['not JSON', 1, 0], ['{"decision":"WRITE_CANDIDATE","explanation":"replacement evidence"}', 1, 0],
      [response('{}'), 0, 1], [response('bad envelope'), 0, 1], [response('unavailable', 503), 0, 1],
      [new TypeError('fake offline'), 0, 1], [new DOMException('fake timeout', 'AbortError'), 0, 1],
    ]) {
      const fake = harness(r => r.index === 1 && r.stageId === stageId ? bad : perfect(r));
      const report = await runHybrid(options(fake.fetchImpl));
      const h = report.observations[1].arms.HYBRID;
      assert.equal(h.endToEndSuccess, false);
      assert.equal(h.stages[stageId].completed, !runtime);
      assert.equal(report.execution.newInvalidStructuredOutputs, invalid);
      assert.equal(report.execution.newRuntimeFailures, runtime);
      assert.equal(report.execution.newCallsPlanned, stageId === 'binary' ? 59 : 60);
      assert.equal(report.execution.newCallsPlanned, report.execution.newCallsAttempted);
      assert.equal(report.execution.newCallsCompleted, report.execution.newCallsAttempted - runtime);
      assert.equal(fake.requests.filter(r => r.index === 1 && r.stageId === stageId).length, 1);
      assert.equal(fake.requests.some(r => r.body && JSON.stringify(r.body).includes('replacement evidence')), false);
      if (stageId === 'binary') assert.equal(h.stages.extraction.invoked, false);
      assert.equal(report.observations[1].transition, runtime ? 'NONCOMPARABLE_RUNTIME' : 'UNCHANGED_WRONG');
      assert.equal(report.finalDisposition, runtime ? 'INDETERMINATE_RUNTIME' : 'RAW_EPISODE_SUCCESSOR_OPEN');
    }
  }
});

test('NO_WRITE stops extraction and wrong-value safety counts exclude wrong HUMAN control flow', async () => {
  const allNo = await runHybrid(options(harness(() => ({ decision: 'NO_WRITE' })).fetchImpl));
  assert.equal(allNo.execution.newCallsAttempted, 40);
  assert.equal(allNo.execution.newStages.extraction.totalLatencyMs, null);
  assert.equal(allNo.execution.newStages.extraction.meanInvokedCallLatencyMs, null);
  assert.equal(allNo.armSummaries.HYBRID.falseNoWrite, 20);
  for (const humanGold of ['WRITE_CANDIDATE', 'NO_WRITE', 'ESCALATE']) {
    const candidate = inputs.candidates.cases[1];
    const clear = ambiguityReport.observations[1].ambiguity;
    const fake = harness(r => r.stageId === 'binary' ? { decision: 'WRITE_CANDIDATE' } : { preferredMode: 'wrong' });
    const h = await runHybridCase(candidate, humanGold, { preferredMode: 'phrase' }, clear,
      { endpoint: ENDPOINT, fetchImpl: fake.fetchImpl }, counts());
    assert.equal(h.endToEndSuccess, false);
    assert.equal(h.schemaValidExtractionWrongValue, humanGold === 'WRITE_CANDIDATE');
    assert.equal(h.unsafeNonEscalation, humanGold === 'ESCALATE');
  }
});

test('source runtime failure is verified then INDETERMINATE_RUNTIME before preflight or any new call', async t => {
  const reports = readReports();
  const candidate = inputs.candidates.cases[0];
  const row = reports.report1p7b.observations[0];
  const stages = { ambiguity: { ...b3.stageRecord('ambiguity', candidate, null), attempted: true,
    latencyMs: 1, runtimeError: { state: 'TIMEOUT', code: 'LOCAL_ENDPOINT_TIMEOUT' } },
  binary: b3.stageRecord('binary', candidate, 'UPSTREAM_RUNTIME_FAILURE'),
  extraction: b3.stageRecord('extraction', candidate, 'UPSTREAM_RUNTIME_FAILURE') };
  row.arms['D1.7'] = b3.scoreArmCase('D1.7', stages, row.humanGoldLabel, inputs.authoring.cases[row.caseId].extractionGold);
  const small = reports.report1p7b;
  small.execution.callsCompleted -= 1;
  small.execution.runtimeFailures += 1;
  small.armSummaries['D1.7'] = b3.summarizeArm('D1.7', small.observations.map(r => r.arms['D1.7']));
  reports.combined = combineReports(reports.report4b, small);
  assert.equal(reports.combined.finalDisposition, 'INDETERMINATE_RUNTIME');
  assert.throws(() => validateSourceReports(reports), { code: 'INDETERMINATE_RUNTIME' });
  const originalRead = fs.readFileSync;
  const readMock = t.mock.method(fs, 'readFileSync', function (file, ...args) {
    const entry = Object.entries(SOURCE_ARTIFACTS).find(([, artifact]) => String(file).endsWith(artifact.file));
    return entry ? Buffer.from(JSON.stringify(reports[entry[0]])) : originalRead.call(this, file, ...args);
  });
  let calls = 0;
  await assert.rejects(runHybrid(options(async () => { calls += 1; })), { code: 'INDETERMINATE_RUNTIME' });
  assert.equal(calls, 0);
  readMock.mock.restore();
});

test('failed health preflight makes zero semantic calls and no semantic report', async () => {
  for (const bad of [response('{}'), response('bad JSON'), response('{"status":"loading"}', 503), new TypeError('offline')]) {
    const methods = [];
    await assert.rejects(runHybrid(options(async (url, init) => {
      methods.push(init.method);
      if (bad instanceof Error) throw bad;
      return bad;
    })), /preflight failed/);
    assert.deepEqual(methods, ['GET']);
  }
});

test('fixed 180000ms new-stage timeout aborts one attempt and still processes later cases', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started;
  const pending = new Promise(resolve => { started = resolve; });
  const fake = harness(r => {
    if (r.index === 1 && r.stageId === 'binary') { started(); return new Promise(() => {}); }
    return perfect(r);
  });
  const running = runHybrid(options(fake.fetchImpl));
  await pending;
  t.mock.timers.tick(179999);
  assert.equal(fake.requests.length, 3);
  assert.equal(fake.requests[2].signal.aborted, false);
  t.mock.timers.tick(1);
  const report = await running;
  assert.equal(fake.requests[2].signal.aborted, true);
  assert.equal(fake.requests.filter(r => r.index === 1).length, 1);
  assert.equal(report.observations[1].arms.HYBRID.stages.binary.runtimeError.code, 'LOCAL_ENDPOINT_TIMEOUT');
  assert.equal(report.execution.newCallsAttempted, 59);
  assert.equal(report.execution.newCallsCompleted, 58);
  assert.equal(report.finalDisposition, 'INDETERMINATE_RUNTIME');
});

test('fixed 10000ms readiness deadline includes a stalled response body', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started;
  const pending = new Promise(resolve => { started = resolve; });
  const methods = [];
  const running = runHybrid(options(async (url, init) => {
    methods.push(init.method);
    return { ok: true, status: 200, text: () => { started(); return new Promise(() => {}); } };
  }));
  const rejected = assert.rejects(running, /preflight failed/);
  await pending;
  t.mock.timers.tick(10000);
  await rejected;
  assert.deepEqual(methods, ['GET']);
});

test('all paired categories and component-wise progression boundaries use no +10pp or training gate', () => {
  const correct = { endToEndSuccess: true, runtimeFailures: 0 };
  const wrong = { endToEndSuccess: false, runtimeFailures: 0 };
  const runtime = { endToEndSuccess: false, runtimeFailures: 1 };
  assert.deepEqual([pairedTransition(correct, correct), pairedTransition(wrong, correct),
    pairedTransition(correct, wrong), pairedTransition(wrong, wrong), pairedTransition(correct, runtime)], TRANSITIONS);
  const baseline = { endToEndSuccess: 48, unsafeNonEscalation: 7, falseNoWrite: 6, schemaValidExtractionWrongValue: 1 };
  const better = { ...baseline, endToEndSuccess: 49 };
  const pair = { FIXED: 2, REGRESSION: 1 };
  assert.equal(progression(baseline, better, pair, 0).finalDisposition, 'RAW_EPISODE_SUCCESSOR_OPEN');
  for (const key of ['unsafeNonEscalation', 'falseNoWrite', 'schemaValidExtractionWrongValue']) {
    assert.equal(progression(baseline, { ...better, [key]: baseline[key] + 1 }, pair, 0).finalDisposition,
      'NO_RAW_EPISODE_SUCCESSOR_SIGNAL');
  }
  const equal = progression(baseline, baseline, { FIXED: 2, REGRESSION: 2 }, 0);
  assert.equal(equal.conditions.endToEndNotWorse, true);
  assert.equal(equal.conditions.moreFixesThanRegressions, false);
  assert.equal(equal.finalDisposition, 'NO_RAW_EPISODE_SUCCESSOR_SIGNAL');
  assert.equal(progression(baseline, { ...better, endToEndSuccess: 47 }, pair, 0).conditions.endToEndNotWorse, false);
  assert.equal(progression(baseline, better, { FIXED: 1, REGRESSION: 2 }, 0).finalDisposition, 'NO_RAW_EPISODE_SUCCESSOR_SIGNAL');
  assert.equal(progression(baseline, better, pair, 1).finalDisposition, 'INDETERMINATE_RUNTIME');
});

test('CLI requires the B4A report and permits only endpoint/report/commit, not semantic tuning', () => {
  const required = ['--endpoint', ENDPOINT, '--ambiguity-report', AMBIGUITY_PATH];
  assert.deepEqual(parseArguments([...required, '--commit', COMMIT]),
    { endpoint: ENDPOINT, ambiguityReport: AMBIGUITY_PATH, commit: COMMIT });
  assert.deepEqual(parseArguments(required), { endpoint: ENDPOINT, ambiguityReport: AMBIGUITY_PATH });
  for (const argv of [[], ['--endpoint'], ['--endpoint', ENDPOINT, '--endpoint', ENDPOINT],
    ['--endpoint', ENDPOINT], [...required, '--commit', 'short'],
    ...['phase', 'source', 'model', 'artifact', 'quantization', 'model-size', 'timeout', 'prompt', 'schema', 'runtime-version']
      .map(key => [...required, `--${key}`, 'other'])]) assert.throws(() => parseArguments(argv));
  assert.equal(require('../package.json').scripts['research:memory-inference-p1b4-role-split-hybrid'],
    'node scripts/run-memory-inference-p1b4-role-split-hybrid-diagnostic.js');
});
