'use strict';

const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const {
  FIXTURE_IDENTITY, FIXTURE_SHA256, RUNNER_VERSION, PROMPT_VERSION, RENDERER_VERSION,
  SCORING_VERSION, REPORT_VERSION, TASK_VERSION, MODEL, RUNTIME,
  TIMEOUT_MS, PREFLIGHT_TIMEOUT_MS, SPECIFICATION, REQUEST_SETTINGS, INSTRUCTION,
  stripTargetTags, renderEvidence, loadFixture, buildPilotPrompt,
  mechanicalDisposition, validateReport, runPilot, parseArguments,
} = require('../scripts/run-memory-inference-p1b6-anchor-marker-pilot');

mock.method(globalThis, 'fetch', () => { throw new Error('Real network forbidden in P1-B6 anchor-marker tests'); });
test.after(() => mock.restoreAll());

const source = loadFixture();
const cases = source.fixture.cases;
const COMMIT = 'a'.repeat(40);
const ENDPOINT = 'http://p1b6-anchor.invalid/v1';
const response = (text, status = 200) => ({ ok: status === 200, status, text: async () => text });
const options = fetchImpl => ({ endpoint: ENDPOINT, commit: COMMIT, fetchImpl });

function opposite(decision) {
  return decision === 'CLEAR' ? 'ESCALATE' : 'CLEAR';
}

function harness(reply = ({ pilotCase }) => ({ decision: pilotCase.humanGoldDecision })) {
  const requests = [];
  const lookup = new Map(cases.flatMap(pilotCase => ['A', 'B'].map(variant => [
    renderEvidence(pilotCase, variant), { pilotCase, variant },
  ])));
  const fetchImpl = async (url, init) => {
    if (init.method === 'GET') {
      requests.push({ url, method: 'GET', signal: init.signal });
      return response('{"status":"ok"}');
    }
    const body = JSON.parse(init.body);
    const content = body.messages[1].content;
    const input = JSON.parse(content.slice(content.lastIndexOf('\nINPUT: ') + 8));
    const found = lookup.get(input.evidence);
    assert.ok(found);
    const request = { url, method: 'POST', body, input, ...found, signal: init.signal };
    requests.push(request);
    const value = await reply({ ...found, semanticIndex: requests.length - 2 });
    if (value instanceof Error) throw value;
    if (value?.text) return value;
    const assistant = typeof value === 'string' ? value : JSON.stringify(value);
    return response(JSON.stringify({ choices: [{ message: { content: assistant } }] }));
  };
  return { fetchImpl, requests };
}

test('fixture freezes exactly 001..020, 13/7 gold, and explicit source mentions only', () => {
  assert.equal(source.fixture.name, FIXTURE_IDENTITY);
  assert.equal(source.provenance.sha256, FIXTURE_SHA256);
  assert.deepEqual(cases.map(row => row.caseId),
    Array.from({ length: 20 }, (_, index) => String(index + 1).padStart(3, '0')));
  assert.deepEqual(Object.fromEntries(['CLEAR', 'ESCALATE'].map(label =>
    [label, cases.filter(row => row.humanGoldDecision === label).length])), { CLEAR: 13, ESCALATE: 7 });
  for (const pilotCase of cases) {
    assert.ok(pilotCase.explicitMentions.length >= 2);
    assert.deepEqual(pilotCase.representativeMention, pilotCase.explicitMentions[0]);
    assert.equal(Object.hasOwn(pilotCase, 'semanticSkeletonId'), false);
    for (const mention of pilotCase.explicitMentions) {
      const turn = pilotCase.turns.find(row => row.turnId === mention.turnId);
      assert.ok(turn);
      assert.equal(turn.text.split(mention.quote).length - 1, 1);
    }
  }
});

test('A marks one mention, B marks all declarations, and unmarked evidence bytes are identical', () => {
  for (const pilotCase of cases) {
    const a = renderEvidence(pilotCase, 'A');
    const b = renderEvidence(pilotCase, 'B');
    assert.equal(a.match(/\[TARGET\]/gu).length, 1);
    assert.equal(a.match(/\[\/TARGET\]/gu).length, 1);
    assert.equal(b.match(/\[TARGET\]/gu).length, pilotCase.explicitMentions.length);
    assert.equal(b.match(/\[\/TARGET\]/gu).length, pilotCase.explicitMentions.length);
    assert.equal(stripTargetTags(a), stripTargetTags(b));
    assert.equal(stripTargetTags(a), pilotCase.turns.map(row => `${row.role}: ${row.text}`).join('\n'));
  }
});

test('prompt freezes the focus-marker instruction and exposes only marked visible evidence', () => {
  assert.equal(PROMPT_VERSION, 'xion-local-memory-inference-p1b6-anchor-marker-pilot-prompt-v1');
  assert.equal(TASK_VERSION, 'p1b6-anchor-marker-pilot-v1');
  assert.match(INSTRUCTION, /marker tells you WHAT TOPIC to judge/u);
  assert.match(INSTRUCTION, /does not by itself assert a full proposition/u);
  assert.match(INSTRUCTION, /Do not decide durability/u);
  assert.match(INSTRUCTION, /Do not perform extraction/u);
  assert.deepEqual(SPECIFICATION.outputSchema, {
    type: 'object', additionalProperties: false, required: ['decision'],
    properties: { decision: { type: 'string', enum: ['CLEAR', 'ESCALATE'] } },
  });
  for (const pilotCase of cases) {
    for (const variant of ['A', 'B']) {
      const prompt = buildPilotPrompt(pilotCase, variant);
      assert.equal(prompt.messages.length, 2);
      const text = prompt.messages[1].content;
      assert.ok(text.includes(`INPUT: ${JSON.stringify({ evidence: renderEvidence(pilotCase, variant) })}`));
      for (const hidden of ['humanGoldDecision', 'representativeMention', 'explicitMentions',
        'semanticSkeletonId', pilotCase.caseId]) assert.equal(text.includes(hidden), false);
    }
  }
});

test('one preflight precedes exactly 40 fixed A/B calls with frozen model and settings', async () => {
  const fake = harness();
  const report = await runPilot(options(fake.fetchImpl));
  assert.equal(fake.requests.length, 41);
  assert.deepEqual(fake.requests[0], {
    url: 'http://p1b6-anchor.invalid/health', method: 'GET', signal: fake.requests[0].signal,
  });
  assert.deepEqual(fake.requests.slice(1).map(row => `${row.pilotCase.caseId}${row.variant}`),
    cases.flatMap(row => ['A', 'B'].map(variant => `${row.caseId}${variant}`)));
  for (const row of fake.requests.slice(1)) {
    assert.equal(row.url, 'http://p1b6-anchor.invalid/v1/chat/completions');
    assert.deepEqual(row.body, { model: MODEL.modelId,
      messages: buildPilotPrompt(row.pilotCase, row.variant).messages, ...REQUEST_SETTINGS });
  }
  assert.equal(report.reportVersion, REPORT_VERSION);
  assert.equal(report.runnerVersion, RUNNER_VERSION);
  assert.equal(report.rendererVersion, RENDERER_VERSION);
  assert.equal(report.scoringVersion, SCORING_VERSION);
  assert.equal(report.galpiCommit, COMMIT);
  assert.deepEqual(MODEL, { modelId: 'xion-p1b1-qwen3-1.7b-bf16',
    artifactId: 'unsloth/Qwen3-1.7B-GGUF:BF16', modelSizeClass: '~2B', quantization: 'BF16' });
  assert.deepEqual(report.model, MODEL);
  assert.deepEqual(RUNTIME, { family: 'llama.cpp', version: 'e42214804794fca6abb61b1a5f9adae2a845f0be' });
  assert.deepEqual(report.runtime, RUNTIME);
  assert.deepEqual(REQUEST_SETTINGS, { temperature: 0, max_tokens: 128, stream: false,
    chat_template_kwargs: { enable_thinking: false }, response_format: { type: 'json_object' } });
  assert.deepEqual(report.requestSettings, REQUEST_SETTINGS);
  assert.equal(report.timeoutMs, TIMEOUT_MS);
  assert.equal(TIMEOUT_MS, 180000);
  assert.equal(report.preflight.timeoutMs, PREFLIGHT_TIMEOUT_MS);
  assert.equal(PREFLIGHT_TIMEOUT_MS, 10000);
  assert.equal(report.automaticReruns, false);
  assert.deepEqual(report.execution, { casesPlanned: 20, callsPlanned: 40,
    callsAttempted: 40, callsCompleted: 40, invalidStructuredOutputs: 0, runtimeFailures: 0 });
  assert.deepEqual(report.summary.variants.A, { correct: 20, CLEAR: 13, ESCALATE: 7, INVALID: 0, RUNTIME_FAILURE: 0 });
  assert.deepEqual(report.summary.variants.B, report.summary.variants.A);
  assert.deepEqual(report.summary.pairs, { STABLE_CORRECT: 20, STABLE_WRONG: 0, FIXED: 0, REGRESSION: 0 });
  assert.equal(report.mechanicalDisposition, 'SINGLE_REQUIRED');
  assert.equal(report.fixture.sha256, source.provenance.sha256);
  assert.deepEqual(validateReport(report), report);
});

test('invalid JSON/schema is a completed semantic failure and is never rerun', async () => {
  for (const bad of ['not JSON', { decision: 'CLEAR', rationale: 'extra' }, { decision: 'OTHER' }]) {
    const fake = harness(({ semanticIndex, pilotCase }) => semanticIndex === 4 ? bad
      : ({ decision: pilotCase.humanGoldDecision }));
    const report = await runPilot(options(fake.fetchImpl));
    assert.equal(fake.requests.length, 41);
    assert.equal(report.execution.callsAttempted, 40);
    assert.equal(report.execution.callsCompleted, 40);
    assert.equal(report.execution.invalidStructuredOutputs, 1);
    assert.equal(report.execution.runtimeFailures, 0);
    assert.equal(report.records[4].decision, 'INVALID');
    assert.equal(fake.requests.slice(1).filter(row => row.pilotCase.caseId === '003' && row.variant === 'A').length, 1);
    assert.deepEqual(validateReport(report), report);
  }
});

test('any runtime error completes the fixed order once and makes the pilot indeterminate', async () => {
  const fake = harness(({ semanticIndex, pilotCase }) => semanticIndex === 7
    ? new TypeError('offline') : ({ decision: pilotCase.humanGoldDecision }));
  const report = await runPilot(options(fake.fetchImpl));
  assert.equal(fake.requests.length, 41);
  assert.deepEqual(fake.requests.slice(1).map(row => `${row.pilotCase.caseId}${row.variant}`),
    cases.flatMap(row => ['A', 'B'].map(variant => `${row.caseId}${variant}`)));
  assert.equal(report.execution.callsAttempted, 40);
  assert.equal(report.execution.callsCompleted, 39);
  assert.equal(report.execution.runtimeFailures, 1);
  assert.equal(report.mechanicalDisposition, 'INDETERMINATE_RUNTIME');
  assert.deepEqual(validateReport(report), report);
});

test('pair classifications and mechanical disposition are recomputed from raw outputs', async () => {
  const scenarios = [
    {
      expected: 'SINGLE_REQUIRED',
      reply: ({ pilotCase, variant }) => ({ decision: pilotCase.caseId === '001' && variant === 'B'
        ? opposite(pilotCase.humanGoldDecision) : pilotCase.humanGoldDecision }),
      pairs: { STABLE_CORRECT: 19, STABLE_WRONG: 0, FIXED: 0, REGRESSION: 1 },
    },
    {
      expected: 'SINGLE_REQUIRED',
      reply: ({ pilotCase, variant }) => ({ decision: pilotCase.caseId === '001' && variant === 'A'
        ? opposite(pilotCase.humanGoldDecision) : pilotCase.humanGoldDecision }),
      pairs: { STABLE_CORRECT: 19, STABLE_WRONG: 0, FIXED: 1, REGRESSION: 0 },
    },
    {
      expected: 'REPEATED_REVIEW_ELIGIBLE',
      reply: ({ pilotCase, variant }) => ({ decision: ['001', '002'].includes(pilotCase.caseId) && variant === 'A'
        ? opposite(pilotCase.humanGoldDecision) : pilotCase.humanGoldDecision }),
      pairs: { STABLE_CORRECT: 18, STABLE_WRONG: 0, FIXED: 2, REGRESSION: 0 },
    },
  ];
  for (const scenario of scenarios) {
    const report = await runPilot(options(harness(scenario.reply).fetchImpl));
    assert.deepEqual(report.summary.pairs, scenario.pairs);
    assert.equal(report.mechanicalDisposition, scenario.expected);
    assert.deepEqual(validateReport(report), report);
  }
  assert.equal(mechanicalDisposition({ runtimeFailures: 1, pairs: { REGRESSION: 0, FIXED: 20 } }),
    'INDETERMINATE_RUNTIME');
});

test('report validation rejects changed identity, provenance, raw records, scores, order, settings, or counts', async () => {
  const report = await runPilot(options(harness().fetchImpl));
  for (const mutate of [
    value => { value.reportVersion = 'other'; },
    value => { value.runnerVersion = 'other'; },
    value => { value.promptVersion = 'other'; },
    value => { value.rendererVersion = 'other'; },
    value => { value.scoringVersion = 'other'; },
    value => { value.galpiCommit = 'short'; },
    value => { value.generatedAt = 'invalid'; },
    value => { value.fixture.identity = 'other'; },
    value => { value.fixture.sha256 = '0'.repeat(64); },
    value => { value.model.modelId = 'other'; },
    value => { value.runtime.version = 'other'; },
    value => { value.requestSettings.temperature = 1; },
    value => { value.records.reverse(); },
    value => { value.records[0].result.rawAssistantContent = '{"decision":"ESCALATE"}'; },
    value => { value.records[0].correct = false; },
    value => { value.records[0].result.latencyMs = -1; },
    value => { value.pairs[0].classification = 'REGRESSION'; },
    value => { value.summary.variants.A.correct -= 1; },
    value => { value.execution.callsCompleted -= 1; },
    value => { value.mechanicalDisposition = 'REPEATED_REVIEW_ELIGIBLE'; },
  ]) {
    const changed = structuredClone(report);
    mutate(changed);
    assert.throws(() => validateReport(changed));
  }
});

test('CLI and package expose only endpoint and optional commit', async () => {
  assert.deepEqual(parseArguments(['--endpoint', ENDPOINT, '--commit', COMMIT]),
    { endpoint: ENDPOINT, commit: COMMIT });
  assert.deepEqual(parseArguments(['--endpoint', ENDPOINT]), { endpoint: ENDPOINT });
  for (const key of ['model', 'prompt', 'threshold', 'temperature', 'timeout', 'variant',
    'runtime-version', 'fixture', 'rerun']) {
    assert.throws(() => parseArguments(['--endpoint', ENDPOINT, `--${key}`, 'other']));
    await assert.rejects(runPilot({ ...options(harness().fetchImpl), [key]: 'other' }), /unsupported option/u);
  }
  for (const args of [[], ['--endpoint'], ['--endpoint', ENDPOINT, '--endpoint', ENDPOINT],
    ['--endpoint', ENDPOINT, '--commit', 'short']]) assert.throws(() => parseArguments(args));
  assert.equal(require('../package.json').scripts['research:memory-inference-p1b6-anchor-marker-pilot'],
    'node scripts/run-memory-inference-p1b6-anchor-marker-pilot.js');
});
