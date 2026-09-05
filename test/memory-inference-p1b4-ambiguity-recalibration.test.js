'use strict';

const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const b3 = require('../scripts/run-memory-inference-p1b3-decomposed-pipeline');
const {
  RUNNER_VERSION, SCORING_VERSION, REPORT_VERSION, PROMPT_VERSION, TASK_VERSION,
  INSTRUCTION, SPECIFICATION, REQUEST_SETTINGS, buildAmbiguityPrompt,
  loadSources, validateAmbiguityReport, runRecalibration, parseArguments,
} = require('../scripts/run-memory-inference-p1b4-ambiguity-recalibration');

mock.method(globalThis, 'fetch', () => { throw new Error('Real network forbidden in P1-B4A tests'); });
test.after(() => mock.restoreAll());
const source = loadSources();
const inputs = source.inputs;
const COMMIT = 'a'.repeat(40);
const ENDPOINT = 'http://p1b4a.invalid/v1';
const response = (text, status = 200) => ({ ok: status === 200, status, text: async () => text });
const options = fetchImpl => ({ endpoint: ENDPOINT, commit: COMMIT, fetchImpl });
const perfect = index => ({ decision: inputs.human.labels[index].label === 'ESCALATE' ? 'ESCALATE' : 'CLEAR' });

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
    assert.notEqual(index, -1);
    requests.push({ url, method: 'POST', body, input, index, signal: init.signal });
    const value = await reply(index);
    if (value instanceof Error) throw value;
    if (value?.text) return value;
    const content = typeof value === 'string' ? value : JSON.stringify(value);
    return response(JSON.stringify({ choices: [{ message: { content } }] }));
  };
  return { fetchImpl, requests };
}

test('exactly one revised ambiguity prompt uses the frozen scaffold and structural CLEAR/ESCALATE schema', () => {
  const expected = `Return CLEAR when the supplied evidence has one sufficiently clear
interpretation for downstream durability classification, even if that
interpretation is temporary, request-local, or would later be NO_WRITE.

Return ESCALATE only when the evidence itself leaves material ambiguity
about meaning, referent, scope, applicability, or whether the statement is
actual user state versus quoted, example, or hypothetical content.

Do not decide durability yourself. Do not resolve ambiguity yourself.`;
  assert.equal(INSTRUCTION, expected);
  assert.equal(RUNNER_VERSION, 'xion-local-memory-inference-p1b4-ambiguity-recalibration-runner-v1');
  assert.equal(SCORING_VERSION, 'xion-local-memory-inference-p1b4-ambiguity-recalibration-scoring-v1');
  assert.equal(REPORT_VERSION, 'xion-local-memory-inference-p1b4-ambiguity-recalibration-report-v1');
  assert.equal(PROMPT_VERSION, 'xion-local-memory-inference-p1b4-ambiguity-recalibration-prompt-v1');
  assert.equal(TASK_VERSION, 'p1b4-ambiguity-recalibration-v1');
  assert.equal(SPECIFICATION.outputSchemaVersion, 'p1b1-ambiguity-escalation-output-v1');
  assert.deepEqual(SPECIFICATION.outputSchema, { type: 'object', additionalProperties: false,
    required: ['decision'], properties: { decision: { type: 'string', enum: ['CLEAR', 'ESCALATE'] } } });
  for (const candidate of inputs.candidates.cases) {
    const prompt = buildAmbiguityPrompt(candidate);
    assert.deepEqual(prompt.messages, [b3.buildStagePrompt('ambiguity', candidate).messages[0],
      { role: 'user', content: [
        'WORKLOAD: ambiguity_escalation', `TASK_SPECIFICATION: ${TASK_VERSION}`,
        `INSTRUCTION: ${expected}`, `OUTPUT_SCHEMA: ${JSON.stringify(SPECIFICATION.outputSchema)}`,
        `INPUT: ${JSON.stringify({ evidence: candidate.inputPayload.evidence })}`,
      ].join('\n') }]);
    assert.equal(prompt.promptVersion, PROMPT_VERSION);
    assert.ok(!prompt.messages[1].content.includes('Return CLEAR only when one interpretation is supported unambiguously.'));
    assert.ok(!prompt.messages[1].content.includes('TASK_SPECIFICATION: p1b1-ambiguity-escalation-v1'));
  }
  const doc = fs.readFileSync(path.join(__dirname, '../docs/Memory research/local-memory-inference-study-design.md'), 'utf8');
  assert.ok(doc.includes(`\n${INSTRUCTION}\n`));
});

test('all 60 cases run once in frozen order after health, using exact 1.7B request and original evidence only', async () => {
  const fake = harness();
  const report = await runRecalibration(options(fake.fetchImpl));
  assert.deepEqual(fake.requests[0], { url: 'http://p1b4a.invalid/health', method: 'GET' });
  assert.deepEqual(fake.requests.slice(1).map(r => r.index), Array.from({ length: 60 }, (_, i) => i));
  for (const r of fake.requests.slice(1)) {
    assert.deepEqual(r.body, { model: 'xion-p1b1-qwen3-1.7b-bf16',
      messages: buildAmbiguityPrompt(inputs.candidates.cases[r.index]).messages,
      temperature: 0, max_tokens: 128, stream: false, chat_template_kwargs: { enable_thinking: false },
      response_format: { type: 'json_object' } });
    assert.deepEqual(r.input, { evidence: inputs.candidates.cases[r.index].inputPayload.evidence });
    assert.equal(r.url, 'http://p1b4a.invalid/v1/chat/completions');
    for (const key of ['humanGoldLabel', 'authoringTarget', 'extractionGold', 'expectedSchema']) {
      assert.ok(!Object.hasOwn(r.input, key));
    }
  }
  assert.equal(report.runnerVersion, RUNNER_VERSION);
  assert.equal(report.scoringVersion, SCORING_VERSION);
  assert.equal(report.reportVersion, REPORT_VERSION);
  assert.equal(report.galpiCommit, COMMIT);
  assert.deepEqual(report.model, { modelId: 'xion-p1b1-qwen3-1.7b-bf16',
    artifactId: 'unsloth/Qwen3-1.7B-GGUF:BF16', modelSizeClass: '~2B', quantization: 'BF16' });
  assert.deepEqual(report.runtime, { family: 'llama.cpp', version: 'e42214804794fca6abb61b1a5f9adae2a845f0be' });
  assert.deepEqual(report.requestSettings, REQUEST_SETTINGS);
  assert.equal(report.timeoutMs, 180000);
  assert.equal(report.automaticReruns, false);
  assert.deepEqual(report.execution, { casesPlanned: 60, callsPlanned: 60, callsAttempted: 60,
    callsCompleted: 60, invalidStructuredOutputs: 0, runtimeFailures: 0 });
  assert.equal(report.summary.CLEAR, 40);
  assert.equal(report.summary.ESCALATE, 20);
  assert.equal(report.summary.unsafeNonEscalation, 0);
  assert.equal(report.summary.unnecessaryEscalation, 0);
  assert.deepEqual(report.summary.perHumanClass.NO_WRITE, { CLEAR: 20, ESCALATE: 0, INVALID: 0, RUNTIME_FAILURE: 0 });
  assert.deepEqual(report.historicalComparison.currentMinusHistorical, {
    CLEAR: 19, ESCALATE: -18, unsafeNonEscalation: -1, unnecessaryEscalation: -19,
  });
  assert.equal(report.summary.totalLatencyMs, report.observations.reduce((sum, r) => sum + r.ambiguity.latencyMs, 0));
  assert.equal(report.summary.meanInvokedCallLatencyMs, report.summary.totalLatencyMs / 60);
  assert.deepEqual(validateAmbiguityReport(report), report);
});

test('invalid JSON/schema are completed semantic failures; HTTP/runtime/envelope errors are incomplete with no retry', async () => {
  for (const [bad, invalid, runtime] of [
    ['not JSON', 1, 0], ['```json\n{"decision":"ESCALATE"}\n```', 1, 0],
    [{ decision: 'NO_WRITE' }, 1, 0], [{ decision: 'CLEAR', rationale: 'extra' }, 1, 0],
    [response('{}'), 0, 1], [response('bad envelope'), 0, 1], [response('unavailable', 503), 0, 1],
    [new TypeError('offline'), 0, 1], [new DOMException('timeout', 'AbortError'), 0, 1],
  ]) {
    const fake = harness(i => i === 2 ? bad : perfect(i));
    const report = await runRecalibration(options(fake.fetchImpl));
    assert.equal(fake.requests.length, 61);
    assert.equal(fake.requests.filter(r => r.index === 2).length, 1);
    assert.equal(report.execution.callsPlanned, 60);
    assert.equal(report.execution.callsAttempted, 60);
    assert.equal(report.execution.callsCompleted, 60 - runtime);
    assert.equal(report.execution.invalidStructuredOutputs, invalid);
    assert.equal(report.execution.runtimeFailures, runtime);
    assert.equal(report.summary.unsafeNonEscalation, 1);
    assert.equal(report.runtimeDisposition, runtime ? 'INDETERMINATE_RUNTIME' : 'COMPLETE');
    assert.deepEqual(validateAmbiguityReport(report), report);
  }
});

test('worse semantic performance never creates an A-to-B entry gate', async () => {
  for (const decision of ['ESCALATE', 'CLEAR']) {
    const report = await runRecalibration(options(harness(() => ({ decision })).fetchImpl));
    assert.equal(report.runtimeDisposition, 'COMPLETE');
    assert.equal(report.summary.unnecessaryEscalation, decision === 'ESCALATE' ? 40 : 0);
    assert.equal(report.summary.unsafeNonEscalation, decision === 'CLEAR' ? 20 : 0);
    assert.deepEqual(validateAmbiguityReport(report), report);
  }
});

test('raw records are reparsed and every supplied identity/config/provenance/score/count is verified', async () => {
  const report = await runRecalibration(options(harness().fetchImpl));
  for (const mutate of [
    r => { r.reportVersion = 'other'; }, r => { r.runnerVersion = 'other'; },
    r => { r.scoringVersion = 'other'; }, r => { r.promptVersion = 'other'; },
    r => { r.taskSpecificationVersion = 'p1b1-ambiguity-escalation-v1'; },
    r => { r.outputSchemaVersion = 'other'; }, r => { r.galpiCommit = 'short'; },
    r => { r.generatedAt = 'invalid'; }, r => { r.model.modelId = 'other'; },
    r => { r.model.artifactId = 'other'; }, r => { r.model.quantization = 'Q4'; },
    r => { r.model.modelSizeClass = '~4B'; }, r => { r.runtime.version = 'other'; },
    r => { r.runtime.family = 'other'; }, r => { r.timeoutMs = 1; },
    r => { r.automaticReruns = true; }, r => { r.preflight.success = false; },
    r => { r.requestSettings.temperature = 1; }, r => { r.inputs.candidates.sha256 = '0'.repeat(64); },
    r => { r.inputs.human.identity = 'primary'; }, r => { r.observations.reverse(); },
    r => { r.observations.pop(); }, r => { r.observations[0].humanGoldLabel = 'ESCALATE'; },
    r => { r.observations[0].ambiguity.rawAssistantContent = '{"decision":"ESCALATE"}'; },
    r => { r.observations[0].ambiguity.structuredOutput = { decision: 'ESCALATE' }; },
    r => { r.observations[0].ambiguity.latencyMs = -1; },
    r => { r.observations[0].ambiguity.schemaStatus = 'INVALID'; },
    r => { r.observations[0].unnecessaryEscalation = true; },
    r => { r.execution.callsCompleted -= 1; }, r => { r.summary.CLEAR -= 1; },
    r => { r.historicalComparison.summary.CLEAR += 1; },
  ]) {
    const changed = structuredClone(report);
    mutate(changed);
    assert.throws(() => validateAmbiguityReport(changed));
  }
});

test('failed readiness permits zero semantic calls', async () => {
  for (const bad of [response('{}'), response('bad JSON'), response('{"status":"loading"}', 503), new TypeError('offline')]) {
    const methods = [];
    await assert.rejects(runRecalibration(options(async (url, init) => {
      methods.push(init.method);
      if (bad instanceof Error) throw bad;
      return bad;
    })), /preflight failed/);
    assert.deepEqual(methods, ['GET']);
  }
});

test('180000ms semantic timeout makes one attempt, then continues the remaining cases', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started;
  const pending = new Promise(resolve => { started = resolve; });
  const fake = harness(i => {
    if (i === 0) { started(); return new Promise(() => {}); }
    return perfect(i);
  });
  const running = runRecalibration(options(fake.fetchImpl));
  await pending;
  t.mock.timers.tick(179999);
  assert.equal(fake.requests[1].signal.aborted, false);
  t.mock.timers.tick(1);
  const report = await running;
  assert.equal(fake.requests[1].signal.aborted, true);
  assert.equal(report.execution.callsAttempted, 60);
  assert.equal(report.execution.callsCompleted, 59);
  assert.equal(report.observations[0].ambiguity.runtimeError.code, 'LOCAL_ENDPOINT_TIMEOUT');
  assert.equal(report.runtimeDisposition, 'INDETERMINATE_RUNTIME');
});

test('10000ms preflight timeout covers stalled body and never attempts semantic inference', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started;
  const pending = new Promise(resolve => { started = resolve; });
  const methods = [];
  const running = runRecalibration(options(async (url, init) => {
    methods.push(init.method);
    return { ok: true, status: 200, text: () => { started(); return new Promise(() => {}); } };
  }));
  const rejected = assert.rejects(running, /preflight failed/);
  await pending;
  t.mock.timers.tick(10000);
  await rejected;
  assert.deepEqual(methods, ['GET']);
});

test('CLI/package expose one fixed prompt only, without model or experimental tuning options', async () => {
  assert.deepEqual(parseArguments(['--endpoint', ENDPOINT, '--commit', COMMIT]), { endpoint: ENDPOINT, commit: COMMIT });
  assert.deepEqual(parseArguments(['--endpoint', ENDPOINT]), { endpoint: ENDPOINT });
  for (const key of ['phase', 'prompt', 'candidate', 'instruction', 'model', 'artifact', 'quantization', 'timeout', 'schema', 'runtime-version']) {
    assert.throws(() => parseArguments(['--endpoint', ENDPOINT, `--${key}`, 'other']));
    await assert.rejects(runRecalibration({ ...options(harness().fetchImpl), [key]: 'other' }), /unsupported B4A option/);
  }
  for (const args of [[], ['--endpoint'], ['--endpoint', ENDPOINT, '--endpoint', ENDPOINT],
    ['--endpoint', ENDPOINT, '--commit', 'short']]) assert.throws(() => parseArguments(args));
  assert.equal(require('../package.json').scripts['research:memory-inference-p1b4-ambiguity-recalibration'],
    'node scripts/run-memory-inference-p1b4-ambiguity-recalibration.js');
});
