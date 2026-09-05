'use strict';

const test = require('node:test');
const { mock } = test;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const b3 = require('../scripts/run-memory-inference-p1b3-decomposed-pipeline');
const a = require('../scripts/run-memory-inference-p1b4-ambiguity-recalibration');
const b = require('../scripts/run-memory-inference-p1b4-role-split-hybrid-diagnostic');
const { TRANSITIONS, pairedTransition } = require('../scripts/combine-memory-inference-p1b3-decomposed-pipeline');
const b5 = require('../scripts/run-memory-inference-p1b5-structured-output-normalization');

mock.method(globalThis, 'fetch', () => { throw new Error('Real network forbidden'); });
test.after(() => mock.restoreAll());
const source = b5.loadSources();
const inputs = source.b3.inputs;
const readBytes = key => fs.readFileSync(path.join(__dirname, '..', b5.SOURCE_ARTIFACTS[key].file));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const COMMIT = 'c'.repeat(40);
const ENDPOINT = 'http://p1b5.invalid/v1';
const options = fetchImpl => ({ endpoint: ENDPOINT, commit: COMMIT, fetchImpl });
const response = (text, status = 200) => ({ ok: status === 200, status, text: async () => text });
const normalizationOf = raw => b5.normalizedAmbiguity({ ...source.ambiguity.observations[0].ambiguity,
  rawAssistantContent: raw, ...b3.parseStageContent(raw, a.SPECIFICATION) });
const newlyClear = source.ambiguity.observations.flatMap((row, i) => row.ambiguity.schemaStatus === 'INVALID'
  && normalizationOf(row.ambiguity.rawAssistantContent).structuredOutput.decision === 'CLEAR' ? [i] : []);
const perfect = ({ index, id }) => id === 'binary'
  ? { decision: inputs.human.labels[index].label === 'WRITE_CANDIDATE' ? 'WRITE_CANDIDATE' : 'NO_WRITE' }
  : inputs.authoring.cases[inputs.candidates.cases[index].caseId].extractionGold;

function harness(reply = perfect) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    if (init.method === 'GET') {
      requests.push({ method: 'GET', url });
      return response('{"status":"ok"}');
    }
    const body = JSON.parse(init.body);
    const text = body.messages[1].content;
    const input = JSON.parse(text.slice(text.lastIndexOf('\nINPUT: ') + 8));
    const index = inputs.candidates.cases.findIndex(row => row.inputPayload.evidence === input.evidence);
    assert.notEqual(index, -1, 'original evidence only');
    const id = text.includes('TASK_SPECIFICATION: p1b3-binary') ? 'binary' : 'extraction';
    const request = { method: 'POST', url, body, input, index, id, signal: init.signal };
    requests.push(request);
    const output = await reply(request);
    if (output instanceof Error) throw output;
    if (output?.text) return output;
    const content = typeof output === 'string' ? output : JSON.stringify(output);
    return response(JSON.stringify({ choices: [{ message: { content } }] }));
  };
  return { requests, fetchImpl };
}

test('normalizer has exactly raw-JSON and lowercase-json single-fence paths; preserves every payload byte', () => {
  assert.equal(b5.NORMALIZER_VERSION, 'xion-local-memory-inference-structured-output-normalizer-v1');
  for (const raw of [' { "decision" : "CLEAR" }\n', '{"decision":"ESCALATE"}', 'null', '[]', '1', '"text"']) {
    assert.deepEqual(b5.normalizeContent(raw), { normalizedAssistantContent: raw,
      normalizationApplied: false, normalizationKind: 'NONE' });
  }
  for (const payload of ['\n{"decision":"CLEAR"}\n', '\r\n  { "decision": "ESCALATE" }  \r\n',
    '\n\n{ "decision" : "CL\\u0045AR" }\t\n\n']) {
    const raw = ` \t\n\x60\x60\x60json${payload}\x60\x60\x60\r\n `;
    const result = normalizationOf(raw);
    assert.equal(result.rawAssistantContent, raw);
    assert.equal(result.normalizedAssistantContent, payload);
    assert.equal(result.normalizationApplied, true);
    assert.equal(result.normalizationKind, 'EXACT_JSON_CODE_FENCE_UNWRAP');
    assert.equal(result.schemaStatus, 'VALID');
    assert.deepEqual(result.structuredOutput, JSON.parse(payload));
    assert.equal(b3.parseStageContent(raw, a.SPECIFICATION).schemaStatus, 'INVALID', 'historical parser remains strict');
  }
});

test('bare/uppercase/prose/multiple/nested fences and JSON repair families stay invalid', () => {
  for (const raw of [
    '```\n{"decision":"CLEAR"}\n```', '```JSON\n{"decision":"CLEAR"}\n```',
    '```Json\n{"decision":"CLEAR"}\n```', '```json5\n{"decision":"CLEAR"}\n```',
    '```json {"decision":"CLEAR"}```', '```json \n{"decision":"CLEAR"}\n```',
    'Here: ```json\n{"decision":"CLEAR"}\n```', '```json\n{"decision":"CLEAR"}\n``` done',
    '```json\n{}\n```\n```json\n{}\n```', '```json\n```json\n{}\n```\n```',
    '{decision:"CLEAR"}', "{'decision':'CLEAR'}", '{"decision":"CLEAR",}',
    '{/* comment */"decision":"CLEAR"}', 'prefix {"decision":"CLEAR"} suffix',
  ]) {
    assert.deepEqual(b5.normalizeContent(raw), { normalizedAssistantContent: null,
      normalizationApplied: false, normalizationKind: 'NOT_NORMALIZABLE' });
    assert.equal(normalizationOf(raw).schemaStatus, 'INVALID');
  }
  for (const payload of ['not json', "{'decision':'CLEAR'}", '{"decision":"CLEAR",}',
    '{}', '{"decision":"clear"}', '{"decision":"NO_WRITE"}', '{"decision":"CLEAR","reason":"extra"}', 'null']) {
    const raw = `\x60\x60\x60json\n${payload}\n\x60\x60\x60`;
    const result = normalizationOf(raw);
    assert.equal(result.normalizationKind, 'EXACT_JSON_CODE_FENCE_UNWRAP');
    assert.equal(result.normalizedAssistantContent, `\n${payload}\n`);
    assert.equal(result.schemaStatus, 'INVALID', 'unwrap is not semantic/schema repair');
  }
});

test('exact B4 artifacts validate/recompute against B3; 20 fenced INVALID outputs remain historical failures', () => {
  for (const key of ['ambiguity', 'hybrid']) assert.equal(digest(readBytes(key)), b5.SOURCE_ARTIFACTS[key].sha256);
  assert.equal(source.ambiguity.galpiCommit, '4e079617e96c7fae41ef92ad0d356c4d7b5a2e56');
  assert.equal(source.hybrid.galpiCommit, b5.SOURCE_COMMIT);
  assert.equal(source.ambiguity.reportVersion, 'xion-local-memory-inference-p1b4-ambiguity-recalibration-report-v1');
  assert.equal(source.hybrid.reportVersion, 'xion-local-memory-inference-p1b4-role-split-hybrid-report-v2');
  assert.deepEqual(a.validateAmbiguityReport(source.ambiguity), source.ambiguity);
  assert.deepEqual(b5.validateB4Reports(readBytes('ambiguity'), JSON.parse(readBytes('hybrid'))).hybrid,
    source.hybrid);
  assert.deepEqual(source.ambiguity.inputs, inputs.provenance);
  assert.deepEqual(source.hybrid.inputs, inputs.provenance);
  assert.deepEqual(source.ambiguity.execution, { casesPlanned: 60, callsPlanned: 60,
    callsAttempted: 60, callsCompleted: 60, invalidStructuredOutputs: 20, runtimeFailures: 0 });
  const metrics = ['endToEndSuccess', 'endToEndSuccessRate', 'unsafeNonEscalation', 'falseNoWrite',
    'schemaValidExtractionWrongValue', 'terminalEscalation'];
  assert.deepEqual(metrics.map(k => source.hybrid.armSummaries.HYBRID[k]), [33, 0.55, 10, 1, 1, 12]);
  assert.deepEqual(metrics.map(k => source.hybrid.baselineL4Summary[k]), [48, 0.8, 7, 6, 1, 13]);
  assert.deepEqual(TRANSITIONS.map(k => source.hybrid.pairedComparisons['L4->HYBRID'][k]), [29, 4, 19, 8, 0]);
  assert.equal(source.hybrid.finalDisposition, 'NO_RAW_EPISODE_SUCCESSOR_SIGNAL');
  assert.equal(source.hybrid.runtimeFailures, 0);
  const invalid = source.ambiguity.observations.filter(row => row.ambiguity.schemaStatus === 'INVALID');
  assert.equal(invalid.length, 20);
  const payloads = invalid.map(row => {
    const n = normalizationOf(row.ambiguity.rawAssistantContent);
    assert.equal(n.normalizationKind, 'EXACT_JSON_CODE_FENCE_UNWRAP');
    assert.equal(n.schemaStatus, 'VALID');
    assert.equal(row.ambiguity.structuredOutput, null);
    return n.structuredOutput.decision;
  });
  assert.equal(payloads.filter(x => x === 'CLEAR').length, 12);
  assert.equal(payloads.filter(x => x === 'ESCALATE').length, 8);
  assert.deepEqual(Object.entries(source.hybrid.progressionRule).filter(([, value]) => !value).map(([key]) => key),
    ['endToEndNotWorse', 'moreFixesThanRegressions', 'unsafeNonEscalationNotWorse']);
});

test('tampered source raw/score/metadata/count/commit/provenance/order rejects, before any fetch', async t => {
  for (const key of ['ambiguity', 'hybrid']) {
    for (const mutate of [
      r => { r.reportVersion = 'other'; }, r => { r.runnerVersion = 'other'; }, r => { r.scoringVersion = 'other'; },
      r => { r.galpiCommit = 'f'.repeat(40); }, r => { r.observations.reverse(); }, r => { r.observations.pop(); },
      r => { r.model.modelId = 'other'; }, r => { r.runtime.version = 'other'; }, r => { r.timeoutMs = 1; },
      r => { r.automaticReruns = true; }, r => { r.preflight.success = false; },
      ...['candidates', 'human', 'authoring'].flatMap(k => [
        r => { r.inputs[k].sha256 = '0'.repeat(64); }, r => { r.inputs[k].identity = 'other'; },
      ]),
      r => { if (key === 'ambiguity') r.observations[0].ambiguity.rawAssistantContent = '{}';
        else r.observations.find(row => row.arms.HYBRID.stages.binary.invoked).arms.HYBRID.stages.binary.rawAssistantContent = '{}'; },
      r => { if (key === 'ambiguity') r.summary.CLEAR += 1; else r.armSummaries.HYBRID.endToEndSuccess += 1; },
      r => { if (key === 'ambiguity') r.execution.callsCompleted -= 1; else r.execution.newCallsCompleted -= 1; },
      r => { if (key === 'ambiguity') r.observations[0].unsafeNonEscalation = !r.observations[0].unsafeNonEscalation;
        else r.observations[0].arms.HYBRID.endToEndSuccess = !r.observations[0].arms.HYBRID.endToEndSuccess; },
    ]) {
      const changed = JSON.parse(readBytes(key));
      mutate(changed);
      assert.throws(() => b5.validateB4Reports(key === 'ambiguity' ? Buffer.from(JSON.stringify(changed)) : readBytes('ambiguity'),
        key === 'hybrid' ? changed : JSON.parse(readBytes('hybrid'))));
    }
  }
  const original = fs.readFileSync;
  const patched = t.mock.method(fs, 'readFileSync', function (file, ...args) {
    const bytes = original.call(this, file, ...args);
    return String(file).endsWith(b5.SOURCE_ARTIFACTS.hybrid.file) ? Buffer.concat([bytes, Buffer.from(' ')]) : bytes;
  });
  let fetches = 0;
  await assert.rejects(b5.runNormalization(options(async () => { fetches++; })), /exact B4 artifact SHA-256 mismatch/);
  assert.equal(fetches, 0);
  patched.mock.restore();
});

test('runner reuses exact 60 A / 44 B calls and only newly normalized CLEAR reaches frozen 4B prompts', async () => {
  const before = structuredClone(source);
  const fake = harness();
  const report = await b5.runNormalization(options(fake.fetchImpl));
  assert.equal(report.runnerVersion, 'xion-local-memory-inference-p1b5-structured-output-normalization-runner-v1');
  assert.equal(report.scoringVersion, 'xion-local-memory-inference-p1b5-structured-output-normalization-scoring-v1');
  assert.equal(report.reportVersion, 'xion-local-memory-inference-p1b5-structured-output-normalization-report-v1');
  assert.equal(report.normalizationScope, 'STAGE_1_ONLY');
  assert.deepEqual(report.normalization, { alreadyRawJson: 40, codeFenceUnwrapped: 20,
    notNormalizable: 0, schemaValidAfterNormalization: 60 });
  assert.deepEqual(report.model, b3.PHASES['4b'].model);
  assert.deepEqual(report.runtime, b3.RUNTIME);
  assert.equal(report.timeoutMs, 180000);
  assert.equal(report.automaticReruns, false);
  assert.deepEqual(fake.requests[0], { method: 'GET', url: 'http://p1b5.invalid/health' });
  assert.deepEqual(fake.requests.filter(r => r.id === 'binary').map(r => r.index), newlyClear);
  assert.equal(newlyClear.length, 12);
  for (const r of fake.requests.slice(1)) {
    const candidate = inputs.candidates.cases[r.index];
    assert.deepEqual(r.body, { model: 'xion-p1b1-qwen3-4b-bf16', messages: b3.buildStagePrompt(r.id, candidate).messages,
      temperature: 0, max_tokens: 128, stream: false, chat_template_kwargs: { enable_thinking: false },
      response_format: { type: 'json_object' } });
    assert.deepEqual(r.input, r.id === 'binary' ? { evidence: candidate.inputPayload.evidence } : candidate.inputPayload);
    assert.equal(r.url, 'http://p1b5.invalid/v1/chat/completions');
    assert.ok(newlyClear.includes(r.index));
  }
  const expectedOrder = [];
  const metrics = { endToEndSuccess: 0, unsafeNonEscalation: 0, falseNoWrite: 0,
    schemaValidExtractionWrongValue: 0, terminalEscalation: 0 };
  const paired = Object.fromEntries(TRANSITIONS.map(k => [k, 0]));
  for (const [i, row] of report.observations.entries()) {
    const original = source.ambiguity.observations[i].ambiguity;
    const hybrid = row.arms.HYBRID;
    const stages = hybrid.stages;
    assert.equal(row.caseId, inputs.candidates.cases[i].caseId);
    assert.deepEqual(row.sourceAmbiguity, original, 'historical schemaStatus and raw bytes retained');
    assert.equal(stages.ambiguity.rawAssistantContent, original.rawAssistantContent);
    assert.equal(hybrid.stageOrigins.ambiguity, 'REUSED_P1B4A');
    if (original.schemaStatus === 'VALID' && original.structuredOutput.decision === 'CLEAR') {
      for (const id of ['binary', 'extraction']) {
        assert.deepEqual(stages[id], source.hybrid.observations[i].arms.HYBRID.stages[id]);
        assert.equal(hybrid.stageOrigins[id], stages[id].invoked ? 'REUSED_P1B4B' : 'SKIPPED');
      }
      assert.equal(fake.requests.some(r => r.index === i), false);
    } else if (stages.ambiguity.structuredOutput.decision === 'ESCALATE') {
      assert.equal(stages.binary.invoked, false);
      assert.equal(stages.extraction.invoked, false);
      assert.equal(fake.requests.some(r => r.index === i), false);
    } else {
      assert.equal(hybrid.stageOrigins.binary, 'NEW');
      expectedOrder.push([i, 'binary']);
      if (stages.binary.structuredOutput.decision === 'WRITE_CANDIDATE') {
        assert.equal(hybrid.stageOrigins.extraction, 'NEW');
        expectedOrder.push([i, 'extraction']);
      } else assert.equal(stages.extraction.invoked, false);
    }
    const decision = stages.ambiguity.structuredOutput.decision === 'ESCALATE' ? 'ESCALATE'
      : stages.binary.structuredOutput.decision;
    const gold = inputs.human.labels[i].label;
    const exactExtraction = stages.extraction.schemaStatus === 'VALID'
      && require('node:util').isDeepStrictEqual(stages.extraction.structuredOutput, inputs.authoring.cases[row.caseId].extractionGold);
    metrics.endToEndSuccess += Number(gold === 'WRITE_CANDIDATE' ? decision === gold && exactExtraction : decision === gold);
    metrics.unsafeNonEscalation += Number(gold === 'ESCALATE' && stages.ambiguity.structuredOutput.decision !== 'ESCALATE');
    metrics.falseNoWrite += Number(gold !== 'NO_WRITE' && decision === 'NO_WRITE');
    metrics.schemaValidExtractionWrongValue += Number(gold === 'WRITE_CANDIDATE' && stages.extraction.schemaStatus === 'VALID' && !exactExtraction);
    metrics.terminalEscalation += Number(decision === 'ESCALATE');
    assert.equal(hybrid.totalLatencyMs, Object.values(stages).filter(s => s.invoked).reduce((sum, s) => sum + s.latencyMs, 0));
    assert.equal(row.transition, pairedTransition(row.baselineL4, hybrid));
    paired[row.transition]++;
  }
  assert.deepEqual(fake.requests.slice(1).map(r => [r.index, r.id]), expectedOrder);
  for (const [key, count] of Object.entries(metrics)) assert.equal(report.armSummaries.HYBRID[key], count);
  assert.deepEqual(report.pairedComparisons['L4->HYBRID'], paired);
  assert.equal(report.finalDisposition, b.progression(source.b3.combined.armSummaries.L4, metrics, paired, 0).finalDisposition);
  assert.equal(report.finalDisposition, 'RAW_EPISODE_SUCCESSOR_OPEN'); // Fake oracle downstream, not a real B5 result.
  const calls = report.execution;
  assert.equal(calls.sourceAmbiguityCallsReused, 60);
  assert.equal(calls.sourceDownstreamCallsReused, 44);
  assert.deepEqual([calls.newBinaryCallsPlanned, calls.newBinaryCallsAttempted, calls.newBinaryCallsCompleted], [12, 12, 12]);
  assert.equal(calls.newExtractionCallsPlanned, calls.newExtractionCallsAttempted);
  assert.equal(calls.newExtractionCallsAttempted, calls.newExtractionCallsCompleted);
  assert.equal(calls.counterfactualHybridStageCalls, 104 + fake.requests.length - 1);
  assert.equal(calls.newInvalidStructuredOutputs, 0);
  assert.equal(calls.newRuntimeFailures, 0);
  assert.deepEqual(source, before);
});

test('all new binary NO_WRITE stops every new extraction and yields no successor signal', async () => {
  const fake = harness(() => ({ decision: 'NO_WRITE' }));
  const report = await b5.runNormalization(options(fake.fetchImpl));
  assert.equal(report.execution.newBinaryCallsAttempted, 12);
  assert.equal(report.execution.newExtractionCallsPlanned, 0);
  assert.equal(report.execution.newExtractionCallsAttempted, 0);
  assert.equal(report.execution.newStages.extraction.totalLatencyMs, null);
  assert.equal(fake.requests.some(row => row.id === 'extraction'), false);
  assert.equal(report.execution.sourceDownstreamCallsReused, 44);
  assert.equal(report.finalDisposition, 'NO_RAW_EPISODE_SUCCESSOR_SIGNAL');
});

test('no newly reachable CLEAR needs no endpoint or health; unnormalizable source never invokes downstream', async () => {
  const synthetic = structuredClone(source);
  for (const row of synthetic.ambiguity.observations) {
    if (row.ambiguity.schemaStatus === 'INVALID') row.ambiguity.rawAssistantContent = 'prose {"decision":"CLEAR"}';
  }
  const report = await b5.executeDiagnostic(synthetic, { commit: COMMIT,
    fetchImpl: async () => assert.fail('zero new calls means no health request either') });
  assert.equal(report.preflight.status, 'NOT_REQUIRED');
  assert.equal(report.normalization.notNormalizable, 20);
  assert.equal(report.execution.newBinaryCallsAttempted, 0);
  assert.equal(report.execution.newExtractionCallsAttempted, 0);
  assert.equal(report.finalDisposition, 'NO_RAW_EPISODE_SUCCESSOR_SIGNAL');
  for (const row of report.observations.filter(r => r.sourceAmbiguity.schemaStatus === 'INVALID')) {
    assert.equal(row.arms.HYBRID.endToEndSuccess, false);
    assert.equal(row.arms.HYBRID.stages.binary.invoked, false);
  }
  await assert.rejects(b5.runNormalization({ commit: COMMIT, fetchImpl: async () => assert.fail('endpoint missing') }),
    /endpoint is required/);
});

test('preflight failure returns INDETERMINATE_RUNTIME with zero new semantic attempts and no fabricated scoring', async () => {
  for (const bad of [response('{}'), response('bad JSON'), response('{"status":"loading"}', 503), new TypeError('offline')]) {
    const methods = [];
    const report = await b5.runNormalization(options(async (url, init) => {
      methods.push(init.method);
      if (bad instanceof Error) throw bad;
      return bad;
    }));
    assert.deepEqual(methods, ['GET']);
    assert.equal(report.finalDisposition, 'INDETERMINATE_RUNTIME');
    assert.equal(report.execution.newBinaryCallsPlanned, 12);
    assert.equal(report.execution.newBinaryCallsAttempted, 0);
    assert.equal(report.execution.newExtractionCallsAttempted, 0);
    assert.equal(report.execution.newRuntimeFailures, 0, 'readiness is not an attempted semantic call');
    assert.equal(report.requiredRuntimeFailures, 1);
    assert.equal(report.armSummaries, null);
    assert.deepEqual(report.observations, []);
  }
});

test('new 4B remains STRICT: fenced/schema-invalid/JSON-invalid output differs from runtime failure, no retries', async () => {
  const index = newlyClear[0];
  for (const id of ['binary', 'extraction']) {
    for (const [bad, invalid, runtime] of [
      ['```json\n{"decision":"WRITE_CANDIDATE"}\n```', 1, 0], ['not JSON', 1, 0],
      [{ decision: 'WRITE_CANDIDATE', generatedEvidence: 'do not forward this' }, 1, 0],
      [response('{}'), 0, 1], [response('bad envelope'), 0, 1], [response('offline', 503), 0, 1],
      [new TypeError('offline'), 0, 1], [new DOMException('timeout', 'AbortError'), 0, 1],
    ]) {
      const fake = harness(r => r.index === index
        ? r.id === id ? bad : { decision: 'WRITE_CANDIDATE' } : perfect(r));
      const report = await b5.runNormalization(options(fake.fetchImpl));
      const stage = report.observations[index].arms.HYBRID.stages[id];
      assert.equal(stage.completed, !runtime);
      assert.equal(report.execution.newInvalidStructuredOutputs, invalid);
      assert.equal(report.execution.newRuntimeFailures, runtime);
      assert.equal(fake.requests.filter(r => r.index === index && r.id === id).length, 1);
      assert.equal(fake.requests.some(r => r.body && JSON.stringify(r.body).includes('do not forward this')), false);
      if (id === 'binary') assert.equal(report.observations[index].arms.HYBRID.stages.extraction.invoked, false);
      assert.equal(report.observations[index].transition === 'NONCOMPARABLE_RUNTIME', Boolean(runtime));
      if (runtime) assert.equal(report.finalDisposition, 'INDETERMINATE_RUNTIME');
      assert.equal(report.execution.newBinaryCallsAttempted, 12);
      assert.equal(report.execution.newBinaryCallsPlanned, 12);
    }
  }
});

test('actual fake-timer timeout is 180000ms, aborts once and continues only later new cases', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started;
  const pending = new Promise(resolve => { started = resolve; });
  const fake = harness(r => {
    if (r.index === newlyClear[0] && r.id === 'binary') { started(); return new Promise(() => {}); }
    return perfect(r);
  });
  const running = b5.runNormalization(options(fake.fetchImpl));
  await pending;
  t.mock.timers.tick(179999);
  assert.equal(fake.requests[1].signal.aborted, false);
  t.mock.timers.tick(1);
  const report = await running;
  assert.equal(fake.requests[1].signal.aborted, true);
  assert.equal(fake.requests.filter(r => r.index === newlyClear[0]).length, 1);
  assert.equal(report.execution.newBinaryCallsCompleted, 11);
  assert.equal(report.execution.newRuntimeFailures, 1);
  assert.equal(report.finalDisposition, 'INDETERMINATE_RUNTIME');
});

test('preflight deadline is exactly 10000ms including stalled body', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started;
  const pending = new Promise(resolve => { started = resolve; });
  const methods = [];
  const running = b5.runNormalization(options(async (url, init) => {
    methods.push(init.method);
    return { ok: true, status: 200, text: () => { started(); return new Promise(() => {}); } };
  }));
  await pending;
  t.mock.timers.tick(10000);
  assert.equal((await running).finalDisposition, 'INDETERMINATE_RUNTIME');
  assert.deepEqual(methods, ['GET']);
});

test('frozen safety metrics exclude wrong-HUMAN-flow extraction values and never forgive normalized errors', async () => {
  const candidate = inputs.candidates.cases[1];
  const original = { ...source.ambiguity.observations[1].ambiguity, schemaStatus: 'INVALID', structuredOutput: null,
    rawAssistantContent: '```json\n{"decision":"CLEAR"}\n```' };
  for (const human of ['WRITE_CANDIDATE', 'NO_WRITE', 'ESCALATE']) {
    const counts = { callsPlanned: 0, callsAttempted: 0, callsCompleted: 0, invalidStructuredOutputs: 0, runtimeFailures: 0 };
    const fake = harness(r => r.id === 'binary' ? { decision: 'WRITE_CANDIDATE' } : { preferredMode: 'wrong' });
    const result = await b5.runCase(candidate, human, { preferredMode: 'phrase' }, original,
      b5.normalizedAmbiguity(original), {}, { endpoint: ENDPOINT, fetchImpl: fake.fetchImpl }, counts);
    assert.equal(result.endToEndSuccess, false);
    assert.equal(result.schemaValidExtractionWrongValue, human === 'WRITE_CANDIDATE');
    assert.equal(result.unsafeNonEscalation, human === 'ESCALATE');
    assert.equal(counts.callsAttempted, 2);
    const no = harness(() => ({ decision: 'NO_WRITE' }));
    const stopped = await b5.runCase(candidate, human, {}, original, b5.normalizedAmbiguity(original), {},
      { endpoint: ENDPOINT, fetchImpl: no.fetchImpl }, { ...counts });
    assert.equal(stopped.stages.extraction.invoked, false);
    assert.equal(stopped.falseNoWrite, human !== 'NO_WRITE');
    assert.equal(stopped.endToEndSuccess, human === 'NO_WRITE');
  }
});

test('L4 pairs and exact component-wise progression boundaries retain all three dispositions and no +10pp', () => {
  const correct = { runtimeFailures: 0, endToEndSuccess: true };
  const wrong = { runtimeFailures: 0, endToEndSuccess: false };
  assert.deepEqual([pairedTransition(correct, correct), pairedTransition(wrong, correct),
    pairedTransition(correct, wrong), pairedTransition(wrong, wrong),
    pairedTransition(correct, { ...wrong, runtimeFailures: 1 })], TRANSITIONS);
  const baseline = { endToEndSuccess: 48, unsafeNonEscalation: 7, falseNoWrite: 6, schemaValidExtractionWrongValue: 1 };
  const hybrid = { ...baseline, endToEndSuccess: 49 };
  assert.equal(b.progression(baseline, hybrid, { FIXED: 1, REGRESSION: 0 }, 0).finalDisposition, 'RAW_EPISODE_SUCCESSOR_OPEN');
  for (const metric of ['unsafeNonEscalation', 'falseNoWrite', 'schemaValidExtractionWrongValue']) {
    assert.equal(b.progression(baseline, { ...hybrid, [metric]: baseline[metric] + 1 }, { FIXED: 1, REGRESSION: 0 }, 0).finalDisposition,
      'NO_RAW_EPISODE_SUCCESSOR_SIGNAL');
  }
  const equality = b.progression(baseline, baseline, { FIXED: 1, REGRESSION: 1 }, 0);
  assert.equal(equality.conditions.endToEndNotWorse, true);
  assert.equal(equality.conditions.moreFixesThanRegressions, false);
  assert.equal(equality.finalDisposition, 'NO_RAW_EPISODE_SUCCESSOR_SIGNAL');
  assert.equal(b.progression(baseline, { ...hybrid, endToEndSuccess: 47 }, { FIXED: 1, REGRESSION: 0 }, 0).conditions.endToEndNotWorse, false);
  assert.equal(b.progression(baseline, hybrid, { FIXED: 0, REGRESSION: 1 }, 0).finalDisposition, 'NO_RAW_EPISODE_SUCCESSOR_SIGNAL');
  assert.equal(b.progression(baseline, hybrid, { FIXED: 1, REGRESSION: 0 }, 1).finalDisposition, 'INDETERMINATE_RUNTIME');
});

test('CLI/package allow endpoint only when needed plus commit, no semantic knobs or source override', async () => {
  assert.deepEqual(b5.parseArguments([]), {});
  assert.deepEqual(b5.parseArguments(['--endpoint', ENDPOINT, '--commit', COMMIT]), { endpoint: ENDPOINT, commit: COMMIT });
  for (const key of ['phase', 'source', 'model', 'prompt', 'normalizer', 'timeout', 'schema', 'runtime-version']) {
    assert.throws(() => b5.parseArguments([`--${key}`, 'other']));
    await assert.rejects(b5.runNormalization({ ...options(harness().fetchImpl), [key]: 'other' }), /unsupported option/);
  }
  for (const argv of [['--endpoint'], ['--commit', 'short'], ['--commit', COMMIT, '--commit', COMMIT]]) {
    assert.throws(() => b5.parseArguments(argv));
  }
  assert.equal(require('../package.json').scripts['research:memory-inference-p1b5-structured-output-normalization'],
    'node scripts/run-memory-inference-p1b5-structured-output-normalization.js');
});
