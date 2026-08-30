'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const {
  EVALUATION_MODES,
  PROMPT_VERSION,
  RUNNER_VERSION,
  SEMANTIC_SCORING,
  loadTrackedPilotFixture,
  runPilotCase,
  runTrackedPilotFixture,
} = require('../lib/memory-inference-local-smoke');
const {
  ERROR_STATES,
  ESCALATION_DECISIONS,
  POLICY_OUTCOMES,
  POLICY_TYPES,
  SCHEMA_STATUSES,
  TASK_OUTCOMES,
  validatePilotResult,
} = require('../lib/memory-inference-pilot-contracts');
const {
  DEFAULT_FIXTURE,
  helpText,
  parseArguments,
} = require('../scripts/run-memory-inference-smoke');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE_PATH = path.join(ROOT, 'fixtures/local-memory-inference-pilot-synthetic.json');

function runnerOptions(endpoint, overrides = {}) {
  return {
    endpoint,
    modelId: 'local-smoke-model',
    artifactId: 'ggml-org/Qwen3.5-0.8B-GGUF:Q8_0',
    quantization: 'Q8_0',
    runtimeFamily: 'llama.cpp',
    runtimeVersion: 'llama.cpp-test-commit',
    commit: 'a'.repeat(40),
    timeoutMs: 1_000,
    ...overrides,
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function chatCompletion(content) {
  return {
    id: 'chatcmpl_synthetic',
    object: 'chat.completion',
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop',
    }],
  };
}

async function fakeEndpoint(t, handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const body = await readJson(req);
    requests.push({ url: req.url, body });
    await handler({ req, res, body, index: requests.length - 1 });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  });
  return {
    endpoint: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
  };
}

async function closedEndpoint() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  await once(server, 'close');
  return `http://127.0.0.1:${port}/v1`;
}

test('synthetic fixture completes case to local inference to validated LOCAL_ONLY result', async t => {
  const outputs = [
    JSON.stringify({ reviewDate: '2030-01-15' }),
    JSON.stringify({ decision: 'ESCALATE' }),
    JSON.stringify({ decision: 'ESCALATE' }),
  ];
  const fake = await fakeEndpoint(t, async ({ res, index }) => {
    sendJson(res, 200, chatCompletion(outputs[index]));
  });
  const fixture = loadTrackedPilotFixture(FIXTURE_PATH);
  const report = await runTrackedPilotFixture(fixture, runnerOptions(fake.endpoint));

  assert.equal(report.summary.cases, 3);
  assert.equal(report.summary.schemaValid, 3);
  assert.equal(report.summary.runnerFailures, 0);
  assert.equal(report.summary.invalidStructuredOutput, 0);
  assert.equal(report.summary.semanticScored, 2);
  assert.equal(report.summary.capabilityProbes, 1);
  assert.equal(report.summary.localFirstCompletionOpportunities, 1);
  assert.equal(fake.requests.length, 3);
  assert.ok(fake.requests.every(request => request.url === '/v1/chat/completions'));

  for (const run of report.runs) {
    assert.equal(validatePilotResult(run.result), run.result);
    assert.equal(run.result.policyType, POLICY_TYPES.LOCAL_ONLY);
    assert.equal(run.result.policyOutcome, POLICY_OUTCOMES.NOT_RUN);
    assert.equal(run.result.escalation.decision, ESCALATION_DECISIONS.NOT_APPLICABLE);
  }
  const extraction = report.runs[0];
  assert.equal(extraction.result.directResult.taskOutcome, TASK_OUTCOMES.SUCCESS);
  const unadjudicatedTriage = report.runs[1];
  assert.equal(unadjudicatedTriage.result.directResult.taskOutcome, TASK_OUTCOMES.UNKNOWN);
  assert.deepEqual(unadjudicatedTriage.semanticScoring, {
    status: SEMANTIC_SCORING.NOT_SCORED,
    reasonCode: 'ADJUDICATION_UNAVAILABLE',
  });
  const hardGated = report.runs[2];
  assert.equal(hardGated.evaluationMode, EVALUATION_MODES.CAPABILITY_PROBE);
  assert.equal(hardGated.capabilityProbe, true);
  assert.equal(hardGated.localFirstCompletionOpportunity, false);
  assert.equal(hardGated.result.policyOutcome, POLICY_OUTCOMES.NOT_RUN);

  const provenance = extraction.result.configuration;
  assert.equal(provenance.modelId, 'local-smoke-model');
  assert.equal(provenance.artifactId, 'ggml-org/Qwen3.5-0.8B-GGUF:Q8_0');
  assert.equal(provenance.quantization, 'Q8_0');
  assert.equal(provenance.runtimeFamily, 'llama.cpp');
  assert.equal(provenance.runtimeVersion, 'llama.cpp-test-commit');
  assert.equal(provenance.runnerVersion, RUNNER_VERSION);
  assert.equal(provenance.promptVersion, PROMPT_VERSION);
  assert.equal(provenance.taskContractVersion, fixture.cases[0].taskContractVersion);
  assert.equal(provenance.taskSpecificationVersion, 'structured-extraction-synthetic-fact-v1');
  assert.equal(provenance.outputSchemaVersion, 'structured-extraction-output-v1');
  assert.equal(provenance.commit, 'a'.repeat(40));
  assert.ok(extraction.result.directResult.runtime.endToEndLatencyMs >= 0);
});

test('adjudicated gold is not included in the local model prompt', async t => {
  const fake = await fakeEndpoint(t, async ({ res }) => {
    sendJson(res, 200, chatCompletion(JSON.stringify({ reviewDate: '2030-01-15' })));
  });
  const fixture = loadTrackedPilotFixture(FIXTURE_PATH);
  const pilotCase = structuredClone(fixture.cases[0]);
  pilotCase.adjudication.primary.label.reviewDate = '2099-12-31';
  const run = await runPilotCase(pilotCase, runnerOptions(fake.endpoint));

  const serializedPrompt = JSON.stringify(fake.requests[0].body.messages);
  assert.equal(serializedPrompt.includes('2099-12-31'), false);
  assert.equal(serializedPrompt.includes('adjudication'), false);
  assert.equal(serializedPrompt.includes('hardGateExpectation'), false);
  assert.equal(run.result.directResult.taskOutcome, TASK_OUTCOMES.FAILURE);
  assert.deepEqual(run.semanticScoring, {
    status: SEMANTIC_SCORING.SCORED,
    reasonCode: 'MISMATCH',
  });
});

test('invalid model JSON and schema-invalid output remain distinct direct failures', async t => {
  const fake = await fakeEndpoint(t, async ({ res, index }) => {
    const content = index === 0 ? 'not-json' : JSON.stringify({ decision: 'WRITE' });
    sendJson(res, 200, chatCompletion(content));
  });
  const fixture = loadTrackedPilotFixture(FIXTURE_PATH);
  const invalidJson = await runPilotCase(fixture.cases[0], runnerOptions(fake.endpoint));
  const invalidSchema = await runPilotCase(fixture.cases[1], runnerOptions(fake.endpoint));

  assert.deepEqual({
    schemaStatus: invalidJson.result.directResult.schemaStatus,
    taskOutcome: invalidJson.result.directResult.taskOutcome,
    error: invalidJson.result.directResult.error,
  }, {
    schemaStatus: SCHEMA_STATUSES.INVALID,
    taskOutcome: TASK_OUTCOMES.FAILURE,
    error: { state: ERROR_STATES.VALIDATION_ERROR, code: 'MODEL_OUTPUT_INVALID_JSON' },
  });
  assert.deepEqual({
    schemaStatus: invalidSchema.result.directResult.schemaStatus,
    taskOutcome: invalidSchema.result.directResult.taskOutcome,
    error: invalidSchema.result.directResult.error,
  }, {
    schemaStatus: SCHEMA_STATUSES.INVALID,
    taskOutcome: TASK_OUTCOMES.FAILURE,
    error: { state: ERROR_STATES.VALIDATION_ERROR, code: 'MODEL_OUTPUT_SCHEMA_INVALID' },
  });
  assert.deepEqual(invalidSchema.result.directResult.structuredOutput, { decision: 'WRITE' });
  validatePilotResult(invalidJson.result);
  validatePilotResult(invalidSchema.result);
});

test('timeout and unavailable endpoint are runner failures, not semantic answers', async t => {
  const fake = await fakeEndpoint(t, async ({ res }) => {
    await new Promise(resolve => setTimeout(resolve, 80));
    sendJson(res, 200, chatCompletion(JSON.stringify({ reviewDate: '2030-01-15' })));
  });
  const fixture = loadTrackedPilotFixture(FIXTURE_PATH);
  const timedOut = await runPilotCase(
    fixture.cases[0],
    runnerOptions(fake.endpoint, { timeoutMs: 10 }),
  );
  const unavailable = await runPilotCase(
    fixture.cases[0],
    runnerOptions(await closedEndpoint()),
  );

  assert.deepEqual({
    schemaStatus: timedOut.result.directResult.schemaStatus,
    taskOutcome: timedOut.result.directResult.taskOutcome,
    error: timedOut.result.directResult.error,
  }, {
    schemaStatus: SCHEMA_STATUSES.NOT_APPLICABLE,
    taskOutcome: TASK_OUTCOMES.NOT_RUN,
    error: { state: ERROR_STATES.TIMEOUT, code: 'LOCAL_ENDPOINT_TIMEOUT' },
  });
  assert.equal(unavailable.result.directResult.taskOutcome, TASK_OUTCOMES.NOT_RUN);
  assert.deepEqual(unavailable.result.directResult.error, {
    state: ERROR_STATES.UNAVAILABLE,
    code: 'LOCAL_ENDPOINT_UNAVAILABLE',
  });
});

test('HTTP failure and malformed runtime envelope are separate from model output validation', async t => {
  const fake = await fakeEndpoint(t, async ({ res, index }) => {
    if (index === 0) return sendJson(res, 503, { error: 'synthetic unavailable' });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('not-runtime-json');
  });
  const fixture = loadTrackedPilotFixture(FIXTURE_PATH);
  const httpFailure = await runPilotCase(fixture.cases[0], runnerOptions(fake.endpoint));
  const runtimeFailure = await runPilotCase(fixture.cases[0], runnerOptions(fake.endpoint));

  assert.deepEqual(httpFailure.result.directResult.error, {
    state: ERROR_STATES.RUNNER_ERROR,
    code: 'LOCAL_HTTP_503',
  });
  assert.deepEqual(runtimeFailure.result.directResult.error, {
    state: ERROR_STATES.RUNNER_ERROR,
    code: 'LOCAL_RUNTIME_INVALID_JSON',
  });
  assert.equal(httpFailure.result.directResult.taskOutcome, TASK_OUTCOMES.NOT_RUN);
  assert.equal(runtimeFailure.result.directResult.taskOutcome, TASK_OUTCOMES.NOT_RUN);
});

test('LOCAL_ONLY result keeps direct-task and policy outcomes separate', async t => {
  const fake = await fakeEndpoint(t, async ({ res }) => {
    sendJson(res, 200, chatCompletion(JSON.stringify({ reviewDate: '2030-01-15' })));
  });
  const fixture = loadTrackedPilotFixture(FIXTURE_PATH);
  const run = await runPilotCase(fixture.cases[0], runnerOptions(fake.endpoint));
  assert.equal(run.result.directResult.taskOutcome, TASK_OUTCOMES.SUCCESS);
  assert.equal(run.result.policyOutcome, POLICY_OUTCOMES.NOT_RUN);
  assert.throws(
    () => validatePilotResult({ ...run.result, policyOutcome: POLICY_OUTCOMES.SUCCESS }),
    /NOT_RUN/,
  );
  const missingProvenance = structuredClone(run.result);
  delete missingProvenance.configuration.quantization;
  assert.throws(() => validatePilotResult(missingProvenance), /quantization/);
});

test('research runner does not create or mutate production DB or memory files', async t => {
  const fake = await fakeEndpoint(t, async ({ res }) => {
    sendJson(res, 200, chatCompletion(JSON.stringify({ reviewDate: '2030-01-15' })));
  });
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-p1a-no-write-'));
  t.after(() => fs.rm(scratch, { recursive: true, force: true }));
  const dbPath = path.join(scratch, 'galpi.db');
  const vaultPath = path.join(scratch, 'galpi-vault');
  await fs.writeFile(dbPath, 'synthetic-production-db-sentinel');
  await fs.mkdir(vaultPath);
  await fs.writeFile(path.join(vaultPath, 'sentinel.md'), 'synthetic-memory-sentinel');
  const before = {
    db: await fs.readFile(dbPath, 'utf8'),
    vault: await fs.readFile(path.join(vaultPath, 'sentinel.md'), 'utf8'),
    files: (await fs.readdir(scratch)).sort(),
  };

  const fixture = loadTrackedPilotFixture(FIXTURE_PATH);
  await runPilotCase(fixture.cases[0], runnerOptions(fake.endpoint));

  assert.deepEqual({
    db: await fs.readFile(dbPath, 'utf8'),
    vault: await fs.readFile(path.join(vaultPath, 'sentinel.md'), 'utf8'),
    files: (await fs.readdir(scratch)).sort(),
  }, before);
});

test('P1-A CLI requires explicit external runtime provenance and never manages a runtime', () => {
  assert.deepEqual(parseArguments([
    '--endpoint', 'http://127.0.0.1:8080/v1',
    '--model', 'local-model',
    '--artifact', 'artifact:Q8_0',
    '--quantization', 'Q8_0',
    '--runtime-version', 'llama-commit',
    '--commit', 'b'.repeat(40),
  ]), {
    endpoint: 'http://127.0.0.1:8080/v1',
    modelId: 'local-model',
    artifactId: 'artifact:Q8_0',
    quantization: 'Q8_0',
    runtimeFamily: 'llama.cpp',
    runtimeVersion: 'llama-commit',
    fixturePath: DEFAULT_FIXTURE,
    timeoutMs: 60_000,
    commit: 'b'.repeat(40),
    help: false,
  });
  assert.throws(() => parseArguments([]), /--endpoint/);
  assert.match(helpText(), /다운로드·시작·종료하지 않으며/);
  assert.match(require('../package.json').scripts['research:memory-inference-smoke'], /run-memory-inference-smoke/);
});
