'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const {
  CASE_CONTRACT_VERSION,
  SCHEMA_STATUSES,
  TASK_OUTCOMES,
  validatePilotCase,
} = require('../lib/memory-inference-pilot-contracts');
const {
  DEFINED_LABELS_PROMPT_VERSION,
  DEFINED_LABEL_SEMANTICS_INSTRUCTION,
  DIAGNOSTIC_RUNNER_VERSION,
  PAIRED_TRANSITIONS,
  buildDefinedLabelSemanticsPrompt,
  pairedTransition,
} = require('../scripts/run-memory-inference-triage-label-semantics-diagnostic');
const {
  CANDIDATE_FIXTURE_NAME,
  FIXED_CASE_IDS,
  LABELS,
  REVIEW_PROTOCOL_VERSION,
  loadCandidateFixture,
} = require('../scripts/review-memory-inference-p1b2d-triage-gold');
const {
  AMBIGUITY_PRECEDENCE_CLARIFICATION,
  AMBIGUITY_PRECEDENCE_INSTRUCTION,
  AMBIGUITY_PRECEDENCE_PROMPT_VERSION,
  AMBIGUITY_TEMPORARY_INSTRUCTION,
  AMBIGUITY_TEMPORARY_PROMPT_VERSION,
  BOUNDARY_FIXTURE_NAME,
  BOUNDARY_REPORT_VERSION,
  BOUNDARY_RUNNER_VERSION,
  CALLS_PLANNED,
  CONDITIONS,
  FIXED_MODEL_CONFIGURATION,
  FIXED_TIMEOUT_MS,
  HUMAN_REVIEW_COMPLETED_AT,
  LABEL_DISTRIBUTION,
  PREFLIGHT_TIMEOUT_MS,
  TEMPORARY_SCOPE_CLARIFICATION,
  buildConditionPrompt,
  calibrationMetadataForCase,
  deriveHealthUrl,
  exitCodeForReport,
  helpText,
  interpretDirectionalHypotheses,
  loadBoundaryFixture,
  loadHumanReview,
  parseArguments,
  runBoundaryDiagnostic,
  runConditionCase,
  summarizeConditionRuns,
  summarizeTransitions,
  validateBoundaryFixture,
  validateConfiguration,
  validateHumanReview,
} = require('../scripts/run-memory-inference-p1b2d-triage-boundary-diagnostic');

const ROOT = path.resolve(__dirname, '..');
const EXPECTED_LABELS = [
  'ESCALATE',
  'NO_WRITE',
  'WRITE_CANDIDATE',
  'NO_WRITE',
  'ESCALATE',
  'WRITE_CANDIDATE',
  'ESCALATE',
  'WRITE_CANDIDATE',
  'NO_WRITE',
  'WRITE_CANDIDATE',
  'ESCALATE',
  'NO_WRITE',
  'WRITE_CANDIDATE',
  'ESCALATE',
  'NO_WRITE',
];
const EXPECTED_DEFINED_INSTRUCTION = [
  'Classify the supplied evidence into exactly one advisory triage label.',
  'NO_WRITE: the evidence is clearly transient, request-local, or otherwise not a durable memory candidate.',
  'WRITE_CANDIDATE: the evidence clearly states a sufficiently persistent fact, preference, goal, constraint, or state that may be worth durable-memory review.',
  'ESCALATE: the supplied evidence is insufficient or ambiguous in persistence, scope, reference, or meaning in a way that prevents safely deciding between NO_WRITE and WRITE_CANDIDATE. Do not resolve that ambiguity yourself.',
  'This classification is advisory only and does not authorize a durable write.',
].join('\n');
const EXPECTED_AMBIGUITY_BLOCK = [
  'Before choosing NO_WRITE or WRITE_CANDIDATE, first check whether persistence, scope, reference, or meaning is unresolved.',
  'If such ambiguity prevents a safe choice between NO_WRITE and WRITE_CANDIDATE, choose ESCALATE.',
  'ESCALATE takes precedence over guessing either durable or non-durable status. Do not use NO_WRITE as a fallback for unresolved ambiguity.',
].join('\n');
const EXPECTED_TEMPORARY_LINE = (
  'When scope is unambiguous, evidence explicitly limited to the current message, response, document, task, session, preview, or another temporary window is NO_WRITE, even when the content resembles a preference, setting, format rule, or state.'
);

function fixedRunnerOptions(fetchImpl) {
  return {
    endpoint: 'http://127.0.0.1:1',
    ...FIXED_MODEL_CONFIGURATION,
    commit: 'a'.repeat(40),
    fetchImpl,
  };
}

function responseForContent(content) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({ choices: [{ message: { content } }] });
    },
  };
}

function responseForDecision(decision) {
  return responseForContent(JSON.stringify({ decision }));
}

function healthResponse({ status = 200, body = { status: 'ok' }, malformed = false } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      if (malformed) throw new SyntaxError('synthetic malformed health JSON');
      return body;
    },
  };
}

function healthyExperimentFetch(fixture, responseForCall = (pilotCase) => (
  responseForDecision(pilotCase.adjudication.primary.label)
)) {
  const evidenceToCase = new Map(fixture.cases.map(item => [item.inputPayload.evidence, item]));
  const healthCalls = [];
  const experimentalCalls = [];
  const fetchImpl = async (url, init) => {
    if (init.method === 'GET') {
      healthCalls.push({ url, init });
      return healthResponse();
    }
    const body = JSON.parse(init.body);
    const inputLine = body.messages[1].content.split('\n').find(line => line.startsWith('INPUT: '));
    const input = JSON.parse(inputLine.slice('INPUT: '.length));
    const pilotCase = evidenceToCase.get(input.evidence);
    const condition = conditionLetter(body);
    experimentalCalls.push({ url, init, body, pilotCase, condition });
    return responseForCall(pilotCase, condition, experimentalCalls.length);
  };
  return { fetchImpl, healthCalls, experimentalCalls };
}

function conditionLetter(body) {
  const content = body.messages[1].content;
  if (content.includes(EXPECTED_TEMPORARY_LINE)) return 'C';
  if (content.includes(EXPECTED_AMBIGUITY_BLOCK)) return 'B';
  return 'A';
}

function runStub(gold, actual, state = 'valid') {
  const runtime = state === 'runtime';
  const invalid = state === 'invalid';
  return {
    calibration: { screeningClass: gold },
    semanticScoring: {
      reasonCode: runtime ? 'RUNNER_NOT_COMPLETED'
        : invalid ? 'INVALID_JSON'
          : actual === gold ? 'MATCH' : 'MISMATCH',
    },
    result: {
      directResult: {
        structuredOutput: runtime || invalid ? null : { decision: actual },
        schemaStatus: runtime ? SCHEMA_STATUSES.NOT_APPLICABLE
          : invalid ? SCHEMA_STATUSES.INVALID : SCHEMA_STATUSES.VALID,
        taskOutcome: runtime ? TASK_OUTCOMES.NOT_RUN
          : invalid ? TASK_OUTCOMES.FAILURE
            : actual === gold ? TASK_OUTCOMES.SUCCESS : TASK_OUTCOMES.FAILURE,
      },
    },
  };
}

function transitionStub(reasonCode, schemaStatus = SCHEMA_STATUSES.VALID) {
  return {
    semanticScoring: { reasonCode },
    result: { directResult: { schemaStatus } },
  };
}

function directionalSummary({ noWrite, writeCandidate, escalate, falseNoWrite }) {
  return {
    correctNoWrite: { numerator: noWrite, denominator: 5 },
    correctWriteCandidate: { numerator: writeCandidate, denominator: 5 },
    correctEscalate: { numerator: escalate, denominator: 5 },
    eligibleFalseNoWriteCount: falseNoWrite,
  };
}

test('final P1-B2d HUMAN mapping is the exact supplied 15-case 5/5/5 gold', () => {
  const review = loadHumanReview();
  assert.equal(validateHumanReview(review), review);
  assert.equal(review.protocolVersion, REVIEW_PROTOCOL_VERSION);
  assert.equal(review.protocolVersion, 'xion-p1b2d-human-primary-v1');
  assert.equal(review.candidateFixture, CANDIDATE_FIXTURE_NAME);
  assert.equal(review.completedAt, HUMAN_REVIEW_COMPLETED_AT);
  assert.equal(review.labels.length, 15);
  assert.deepEqual(review.labels.map(entry => entry.caseId), [...FIXED_CASE_IDS]);
  assert.equal(new Set(review.labels.map(entry => entry.caseId)).size, 15);
  assert.ok(review.labels.every(entry => LABELS.includes(entry.label)));
  assert.deepEqual(review.labels.map(entry => entry.label), EXPECTED_LABELS);
  assert.deepEqual(
    Object.fromEntries(LABELS.map(label => [
      label,
      review.labels.filter(entry => entry.label === label).length,
    ])),
    LABEL_DISTRIBUTION,
  );
  assert.equal(review.labels[12].caseId, 'p1b2d-triage-boundary-013');
  assert.equal(review.labels[12].label, 'WRITE_CANDIDATE');
});

test('final PilotCase fixture preserves candidate order/evidence and exact HUMAN adjudication', () => {
  const candidates = loadCandidateFixture();
  const review = loadHumanReview();
  const fixture = loadBoundaryFixture();
  assert.equal(validateBoundaryFixture(fixture, candidates, review), fixture);
  assert.equal(fixture.name, BOUNDARY_FIXTURE_NAME);
  assert.equal(fixture.name, 'xion-local-memory-inference-p1b2d-triage-boundary-v1');
  assert.equal(fixture.cases.length, 15);
  assert.deepEqual(fixture.cases.map(item => item.caseId), candidates.cases.map(item => item.caseId));

  const labelsById = new Map(review.labels.map(entry => [entry.caseId, entry.label]));
  for (let index = 0; index < fixture.cases.length; index += 1) {
    const pilotCase = fixture.cases[index];
    const candidate = candidates.cases[index];
    const gold = labelsById.get(pilotCase.caseId);
    assert.equal(validatePilotCase(pilotCase), pilotCase);
    assert.equal(pilotCase.workloadType, candidate.workloadType);
    assert.equal(pilotCase.sourceType, 'synthetic');
    assert.equal(pilotCase.taskContractVersion, CASE_CONTRACT_VERSION);
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
      status: 'DOES_NOT_APPLY', guardScope: 'none', reasonCode: 'none',
    });
    assert.deepEqual(calibrationMetadataForCase(pilotCase), {
      schemaFamily: null,
      screeningClass: gold,
      stratum: {
        NO_WRITE: 'no_write',
        WRITE_CANDIDATE: 'write_candidate',
        ESCALATE: 'eligible_escalate',
      }[gold],
      capabilityProbe: false,
    });
  }
});

test('Condition A is the exact frozen B2b prompt and execution identity', () => {
  const pilotCase = loadBoundaryFixture().cases[0];
  assert.equal(DEFINED_LABELS_PROMPT_VERSION, (
    'xion-local-memory-inference-p1b2b-triage-defined-labels-prompt-v1'
  ));
  assert.equal(DEFINED_LABEL_SEMANTICS_INSTRUCTION, EXPECTED_DEFINED_INSTRUCTION);
  assert.deepEqual(
    buildConditionPrompt(pilotCase, CONDITIONS.A),
    buildDefinedLabelSemanticsPrompt(pilotCase),
  );
  const frozenSource = fs.readFileSync(
    path.join(ROOT, 'scripts/run-memory-inference-triage-label-semantics-diagnostic.js'),
    'utf8',
  );
  assert.equal(frozenSource.includes('p1b2d'), false);
});

test('Condition B adds only the registered ambiguity block at the registered location', () => {
  const pilotCase = loadBoundaryFixture().cases[0];
  const aLines = EXPECTED_DEFINED_INSTRUCTION.split('\n');
  const expected = [...aLines.slice(0, -1), ...EXPECTED_AMBIGUITY_BLOCK.split('\n'), aLines.at(-1)]
    .join('\n');
  assert.equal(AMBIGUITY_PRECEDENCE_PROMPT_VERSION, (
    'xion-local-memory-inference-p1b2d-triage-ambiguity-precedence-prompt-v1'
  ));
  assert.deepEqual(AMBIGUITY_PRECEDENCE_CLARIFICATION, EXPECTED_AMBIGUITY_BLOCK.split('\n'));
  assert.equal(AMBIGUITY_PRECEDENCE_INSTRUCTION, expected);
  const content = buildConditionPrompt(pilotCase, CONDITIONS.B).messages[1].content;
  assert.equal(content.includes(`INSTRUCTION: ${expected}`), true);
  assert.equal(content.replace(`\n${EXPECTED_AMBIGUITY_BLOCK}`, ''), (
    buildConditionPrompt(pilotCase, CONDITIONS.A).messages[1].content
  ));
});

test('Condition C adds only the registered temporary-scope line after Condition B block', () => {
  const pilotCase = loadBoundaryFixture().cases[0];
  const bLines = AMBIGUITY_PRECEDENCE_INSTRUCTION.split('\n');
  const expected = [...bLines.slice(0, -1), EXPECTED_TEMPORARY_LINE, bLines.at(-1)].join('\n');
  assert.equal(AMBIGUITY_TEMPORARY_PROMPT_VERSION, (
    'xion-local-memory-inference-p1b2d-triage-ambiguity-temporary-prompt-v1'
  ));
  assert.equal(TEMPORARY_SCOPE_CLARIFICATION, EXPECTED_TEMPORARY_LINE);
  assert.equal(AMBIGUITY_TEMPORARY_INSTRUCTION, expected);
  const content = buildConditionPrompt(pilotCase, CONDITIONS.C).messages[1].content;
  assert.equal(content.includes(`INSTRUCTION: ${expected}`), true);
  assert.equal(content.replace(`${EXPECTED_TEMPORARY_LINE}\n`, ''), (
    buildConditionPrompt(pilotCase, CONDITIONS.B).messages[1].content
  ));
});

test('A/B/C preserve request scaffold/settings and issue exactly one request each', async () => {
  const pilotCase = loadBoundaryFixture().cases[0];
  const metadata = calibrationMetadataForCase(pilotCase);
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init: { ...init }, body: JSON.parse(init.body) });
    return responseForDecision(pilotCase.adjudication.primary.label);
  };
  const results = [];
  for (const condition of [CONDITIONS.A, CONDITIONS.B, CONDITIONS.C]) {
    results.push(await runConditionCase(
      pilotCase,
      metadata,
      fixedRunnerOptions(fetchImpl),
      condition,
    ));
  }
  assert.equal(requests.length, 3);
  for (let index = 0; index < requests.length; index += 1) {
    const body = requests[index].body;
    assert.deepEqual(Object.keys(body), [
      'model', 'messages', 'temperature', 'max_tokens', 'stream',
      'chat_template_kwargs', 'response_format',
    ]);
    assert.equal(body.model, FIXED_MODEL_CONFIGURATION.modelId);
    assert.equal(body.temperature, 0);
    assert.equal(body.max_tokens, 128);
    assert.equal(body.stream, false);
    assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.deepEqual(
      body.messages,
      buildConditionPrompt(pilotCase, [CONDITIONS.A, CONDITIONS.B, CONDITIONS.C][index]).messages,
    );
    assert.deepEqual(body.messages[0], requests[0].body.messages[0]);
    assert.match(body.messages[1].content, new RegExp(
      `INPUT: ${JSON.stringify(pilotCase.inputPayload).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`,
      'u',
    ));
  }
  const nonMessageBody = body => Object.fromEntries(
    Object.entries(body).filter(([key]) => key !== 'messages'),
  );
  assert.deepEqual(nonMessageBody(requests[0].body), nonMessageBody(requests[1].body));
  assert.deepEqual(nonMessageBody(requests[1].body), nonMessageBody(requests[2].body));
  assert.equal(results[0].result.configuration.promptVersion, DEFINED_LABELS_PROMPT_VERSION);
  assert.equal(results[0].result.configuration.runnerVersion, DIAGNOSTIC_RUNNER_VERSION);
  assert.equal(results[1].result.configuration.promptVersion, AMBIGUITY_PRECEDENCE_PROMPT_VERSION);
  assert.equal(results[1].result.configuration.runnerVersion, BOUNDARY_RUNNER_VERSION);
  assert.equal(results[2].result.configuration.promptVersion, AMBIGUITY_TEMPORARY_PROMPT_VERSION);
  assert.equal(results[2].result.configuration.runnerVersion, BOUNDARY_RUNNER_VERSION);
});

test('health URL derivation strips standard completion suffixes and preserves prefixes', () => {
  assert.equal(PREFLIGHT_TIMEOUT_MS, 10000);
  for (const endpoint of [
    'http://127.0.0.1:8080',
    'http://127.0.0.1:8080/v1',
    'http://127.0.0.1:8080/v1/chat/completions',
    'http://127.0.0.1:8080/chat/completions',
  ]) {
    assert.equal(deriveHealthUrl(endpoint), 'http://127.0.0.1:8080/health');
  }
  assert.equal(
    deriveHealthUrl('http://127.0.0.1:8080/prefix/v1/chat/completions'),
    'http://127.0.0.1:8080/prefix/health',
  );
  assert.equal(
    deriveHealthUrl('http://127.0.0.1:8080/prefix'),
    'http://127.0.0.1:8080/prefix/health',
  );
});

test('unavailable llama.cpp preflight is fatal before any experimental POST', async () => {
  const fixture = loadBoundaryFixture();
  let healthGets = 0;
  let experimentalPosts = 0;
  const fetchImpl = async (url, init) => {
    if (init.method === 'GET') {
      healthGets += 1;
      assert.equal(url, 'http://127.0.0.1:1/health');
      throw new TypeError('fetch failed: connection refused');
    }
    experimentalPosts += 1;
    return responseForDecision('NO_WRITE');
  };
  await assert.rejects(
    runBoundaryDiagnostic(fixture, fixedRunnerOptions(fetchImpl)),
    /P1-B2d endpoint preflight failed: llama\.cpp is unavailable or not ready/u,
  );
  assert.equal(healthGets, 1);
  assert.equal(experimentalPosts, 0);
});

test('llama.cpp loading response is fatal before any experimental POST', async () => {
  const fixture = loadBoundaryFixture();
  let experimentalPosts = 0;
  const fetchImpl = async (url, init) => {
    if (init.method === 'GET') return healthResponse({ status: 503, body: { status: 'loading' } });
    experimentalPosts += 1;
    return responseForDecision('NO_WRITE');
  };
  await assert.rejects(
    runBoundaryDiagnostic(fixture, fixedRunnerOptions(fetchImpl)),
    /P1-B2d endpoint preflight failed.*HTTP 503/u,
  );
  assert.equal(experimentalPosts, 0);
});

test('malformed or non-ready health JSON is fatal before any experimental POST', async (t) => {
  for (const [name, health] of [
    ['malformed JSON', healthResponse({ malformed: true })],
    ['non-ready status', healthResponse({ body: { status: 'loading' } })],
  ]) {
    await t.test(name, async () => {
      const fixture = loadBoundaryFixture();
      let experimentalPosts = 0;
      const fetchImpl = async (url, init) => {
        if (init.method === 'GET') return health;
        experimentalPosts += 1;
        return responseForDecision('NO_WRITE');
      };
      await assert.rejects(
        runBoundaryDiagnostic(fixture, fixedRunnerOptions(fetchImpl)),
        /P1-B2d endpoint preflight failed: llama\.cpp is unavailable or not ready/u,
      );
      assert.equal(experimentalPosts, 0);
    });
  }
});

test('runner uses one healthy preflight, exact case-local A/B/C order, and no reruns', async () => {
  const fixture = loadBoundaryFixture();
  const harness = healthyExperimentFetch(fixture, (pilotCase, condition, callNumber) => {
    if (callNumber === 1) return responseForDecision('NO_WRITE');
    if (callNumber === 2) return responseForContent('not-json');
    if (callNumber === 3) throw new DOMException('synthetic timeout', 'AbortError');
    return responseForDecision(pilotCase.adjudication.primary.label);
  });
  const report = await runBoundaryDiagnostic(fixture, fixedRunnerOptions(harness.fetchImpl));
  const expectedOrder = fixture.cases.flatMap(item => [
    `${item.caseId}-A`, `${item.caseId}-B`, `${item.caseId}-C`,
  ]);
  assert.equal(harness.healthCalls.length, 1);
  assert.equal(harness.healthCalls[0].url, 'http://127.0.0.1:1/health');
  assert.equal(harness.healthCalls[0].init.method, 'GET');
  assert.equal(Object.hasOwn(harness.healthCalls[0].init, 'body'), false);
  assert.deepEqual(
    harness.experimentalCalls.map(call => `${call.pilotCase.caseId}-${call.condition}`),
    expectedOrder,
  );
  assert.equal(harness.experimentalCalls.length, CALLS_PLANNED);
  assert.ok(harness.experimentalCalls.every(call => call.init.method === 'POST'));
  assert.equal(report.reportVersion, BOUNDARY_REPORT_VERSION);
  assert.equal(report.execution.timeoutMs, FIXED_TIMEOUT_MS);
  assert.equal(report.execution.timeoutMs, 180000);
  assert.equal(report.execution.callsPlanned, 45);
  assert.equal(report.execution.callsAttempted, 45);
  assert.equal(report.execution.callsCompleted, 44);
  assert.equal(report.execution.order, 'case-local A->B->C');
  assert.equal(report.execution.automaticReruns, false);
  assert.equal(report.observations.length, 15);
  assert.equal(report.summaries[CONDITIONS.A].mismatches, 1);
  assert.equal(report.summaries[CONDITIONS.B].invalidStructuredOutputs, 1);
  assert.equal(report.summaries[CONDITIONS.C].runtimeFailures, 1);
  assert.equal(report.observations[0].pairedTransitionAtoB, (
    PAIRED_TRANSITIONS.NONCOMPARABLE_RUNTIME_OR_SCHEMA
  ));
  assert.equal(report.observations[0].pairedTransitionBtoC, (
    PAIRED_TRANSITIONS.NONCOMPARABLE_RUNTIME_OR_SCHEMA
  ));
  assert.equal(exitCodeForReport(report), 0);
  assert.equal(Object.hasOwn(report, 'finalDisposition'), false);
  assert.equal(Object.hasOwn(report, 'acceptanceThreshold'), false);
  assert.doesNotMatch(JSON.stringify(report), /PASS_B2D|FAIL_B2D/u);
});

test('healthy all-valid execution reports planned=attempted=completed=45', async () => {
  const fixture = loadBoundaryFixture();
  const harness = healthyExperimentFetch(fixture);
  const report = await runBoundaryDiagnostic(fixture, fixedRunnerOptions(harness.fetchImpl));
  assert.equal(harness.healthCalls.length, 1);
  assert.equal(harness.experimentalCalls.length, 45);
  assert.deepEqual(report.execution, {
    timeoutMs: 180000,
    callsPlanned: 45,
    callsAttempted: 45,
    callsCompleted: 45,
    order: 'case-local A->B->C',
    automaticReruns: false,
  });
  assert.equal(exitCodeForReport(report), 0);
});

test('completed invalid structured response counts as completed inference response', async () => {
  const fixture = loadBoundaryFixture();
  const harness = healthyExperimentFetch(fixture, (pilotCase, condition, callNumber) => (
    callNumber === 1
      ? responseForContent('not-json')
      : responseForDecision(pilotCase.adjudication.primary.label)
  ));
  const report = await runBoundaryDiagnostic(fixture, fixedRunnerOptions(harness.fetchImpl));
  assert.equal(harness.experimentalCalls.length, 45);
  assert.equal(report.execution.callsAttempted, 45);
  assert.equal(report.execution.callsCompleted, 45);
  assert.equal(report.summaries[CONDITIONS.A].invalidStructuredOutputs, 1);
  assert.equal(exitCodeForReport(report), 0);
});

test('configuration is fixed to Qwen3-4B BF16, fixed runtime, and fixed timeout', () => {
  const valid = { ...FIXED_MODEL_CONFIGURATION };
  assert.equal(validateConfiguration(valid), valid);
  for (const override of [
    { modelSizeClass: '~2B' },
    { modelSizeClass: 'sub-1B' },
    { modelId: 'xion-p1b1-qwen3-1.7b-bf16' },
    { modelId: 'alternate-model' },
    { artifactId: 'unsloth/Qwen3-1.7B-GGUF:BF16' },
    { quantization: 'Q4_K_M' },
    { runtimeVersion: 'wrong-runtime' },
  ]) {
    assert.throws(() => validateConfiguration({ ...valid, ...override }), /고정 ~4B BF16/u);
  }
  const argv = [
    '--endpoint', 'http://127.0.0.1:8080',
    '--model', valid.modelId,
    '--artifact', valid.artifactId,
    '--quantization', valid.quantization,
    '--model-size-class', valid.modelSizeClass,
    '--runtime-version', valid.runtimeVersion,
  ];
  assert.equal(parseArguments(argv).commit, null);
  assert.throws(() => parseArguments([...argv, '--timeout', '1']), /알 수 없는 인자/u);
  assert.throws(() => parseArguments([...argv, '--timeout-ms', '1']), /알 수 없는 인자/u);
  assert.doesNotMatch(helpText(), /--timeout(?:-ms)?\s+</u);
  assert.match(helpText(), /180000ms/u);
});

test('condition summary uses 5/5/5 denominators and separates invalid/runtime buckets', () => {
  const runs = [
    ...Array.from({ length: 3 }, () => runStub('NO_WRITE', 'NO_WRITE')),
    runStub('NO_WRITE', null, 'invalid'),
    runStub('NO_WRITE', null, 'runtime'),
    ...Array.from({ length: 4 }, () => runStub('WRITE_CANDIDATE', 'WRITE_CANDIDATE')),
    runStub('WRITE_CANDIDATE', 'NO_WRITE'),
    ...Array.from({ length: 3 }, () => runStub('ESCALATE', 'ESCALATE')),
    runStub('ESCALATE', 'NO_WRITE'),
    runStub('ESCALATE', 'WRITE_CANDIDATE'),
  ];
  const summary = summarizeConditionRuns(runs);
  assert.equal(summary.totalCases, 15);
  assert.equal(summary.schemaValidOutputs, 13);
  assert.equal(summary.invalidStructuredOutputs, 1);
  assert.equal(summary.runtimeFailures, 1);
  assert.equal(summary.exactMatches, 10);
  assert.equal(summary.mismatches, 3);
  assert.deepEqual(summary.correctNoWrite, { numerator: 3, denominator: 5 });
  assert.deepEqual(summary.correctWriteCandidate, { numerator: 4, denominator: 5 });
  assert.deepEqual(summary.correctEscalate, { numerator: 3, denominator: 5 });
  assert.equal(summary.eligibleFalseNoWriteCount, 2);
  assert.equal(summary.confusionMatrix.NO_WRITE.INVALID, 1);
  assert.equal(summary.confusionMatrix.NO_WRITE.RUNTIME_FAILURE, 1);
  assert.equal(summary.confusionMatrix.WRITE_CANDIDATE.NO_WRITE, 1);
  assert.equal(summary.confusionMatrix.ESCALATE.NO_WRITE, 1);
});

test('paired transitions preserve all five frozen B2b semantics', () => {
  const correct = transitionStub('MATCH');
  const wrong = transitionStub('MISMATCH');
  const invalid = transitionStub('INVALID_JSON', SCHEMA_STATUSES.INVALID);
  assert.equal(pairedTransition(correct, correct), PAIRED_TRANSITIONS.UNCHANGED_CORRECT);
  assert.equal(pairedTransition(wrong, correct), PAIRED_TRANSITIONS.FIXED);
  assert.equal(pairedTransition(correct, wrong), PAIRED_TRANSITIONS.REGRESSION);
  assert.equal(pairedTransition(wrong, wrong), PAIRED_TRANSITIONS.UNCHANGED_WRONG);
  assert.equal(
    pairedTransition(correct, invalid),
    PAIRED_TRANSITIONS.NONCOMPARABLE_RUNTIME_OR_SCHEMA,
  );
  assert.deepEqual(summarizeTransitions([
    PAIRED_TRANSITIONS.UNCHANGED_CORRECT,
    PAIRED_TRANSITIONS.FIXED,
    PAIRED_TRANSITIONS.REGRESSION,
    PAIRED_TRANSITIONS.UNCHANGED_WRONG,
    PAIRED_TRANSITIONS.NONCOMPARABLE_RUNTIME_OR_SCHEMA,
  ]), {
    unchangedCorrect: 1,
    fixes: 1,
    regressions: 1,
    unchangedWrong: 1,
    nonComparable: 1,
  });
});

test('directional interpretation supports and rejects A->B exactly as preregistered', () => {
  const summaries = {
    [CONDITIONS.A]: directionalSummary({
      noWrite: 2, writeCandidate: 4, escalate: 1, falseNoWrite: 2,
    }),
    [CONDITIONS.B]: directionalSummary({
      noWrite: 2, writeCandidate: 4, escalate: 3, falseNoWrite: 1,
    }),
    [CONDITIONS.C]: directionalSummary({
      noWrite: 4, writeCandidate: 4, escalate: 3, falseNoWrite: 1,
    }),
  };
  const paired = {
    AtoB: { fixes: 3, regressions: 1, nonComparable: 0 },
    BtoC: { fixes: 3, regressions: 1, nonComparable: 0 },
  };
  const observations = [{
    caseId: 'critical',
    humanGoldLabel: 'ESCALATE',
    conditionA: {
      schemaStatus: SCHEMA_STATUSES.VALID,
      taskOutcome: TASK_OUTCOMES.FAILURE,
      structuredOutput: { decision: 'NO_WRITE' },
    },
    conditionB: {
      schemaStatus: SCHEMA_STATUSES.VALID,
      taskOutcome: TASK_OUTCOMES.SUCCESS,
      structuredOutput: { decision: 'ESCALATE' },
    },
  }];
  const positive = interpretDirectionalHypotheses(summaries, paired, observations);
  assert.equal(positive.ambiguityPrecedenceAtoB.supported, true);
  assert.deepEqual(positive.ambiguityPrecedenceAtoB.criticalNoWriteToCorrectEscalate, {
    count: 1, caseIds: ['critical'],
  });

  const tooManyFalseNoWrites = structuredClone(summaries);
  tooManyFalseNoWrites[CONDITIONS.B].eligibleFalseNoWriteCount = 3;
  const negative = interpretDirectionalHypotheses(tooManyFalseNoWrites, paired, observations);
  assert.equal(negative.ambiguityPrecedenceAtoB.supported, false);
  assert.equal(
    negative.ambiguityPrecedenceAtoB.criteria.eligibleFalseNoWriteDidNotIncrease,
    false,
  );
  const noNetFix = structuredClone(paired);
  noNetFix.AtoB = { fixes: 1, regressions: 1, nonComparable: 0 };
  assert.equal(
    interpretDirectionalHypotheses(summaries, noNetFix).ambiguityPrecedenceAtoB.supported,
    false,
  );
});

test('directional interpretation supports and rejects B->C exactly as preregistered', () => {
  const summaries = {
    [CONDITIONS.A]: directionalSummary({
      noWrite: 2, writeCandidate: 4, escalate: 1, falseNoWrite: 2,
    }),
    [CONDITIONS.B]: directionalSummary({
      noWrite: 2, writeCandidate: 4, escalate: 3, falseNoWrite: 1,
    }),
    [CONDITIONS.C]: directionalSummary({
      noWrite: 4, writeCandidate: 4, escalate: 3, falseNoWrite: 1,
    }),
  };
  const paired = {
    AtoB: { fixes: 3, regressions: 1, nonComparable: 0 },
    BtoC: { fixes: 3, regressions: 1, nonComparable: 0 },
  };
  const positive = interpretDirectionalHypotheses(summaries, paired);
  assert.equal(positive.temporaryScopeBtoC.supported, true);
  assert.equal(positive.interpretationBoundary.candidatePromptOnly, true);
  assert.equal(positive.interpretationBoundary.productionValidated, false);
  assert.equal(positive.interpretationBoundary.rescuesP1B2c, false);
  assert.equal(positive.interpretationBoundary.authorizesComposition, false);

  const tooManyFalseNoWrites = structuredClone(summaries);
  tooManyFalseNoWrites[CONDITIONS.C].eligibleFalseNoWriteCount = 2;
  const negative = interpretDirectionalHypotheses(tooManyFalseNoWrites, paired);
  assert.equal(negative.temporaryScopeBtoC.supported, false);
  assert.equal(negative.temporaryScopeBtoC.eligibleFalseNoWriteIncreaseIsNegative, true);
  const writeRegression = structuredClone(summaries);
  writeRegression[CONDITIONS.C].correctWriteCandidate.numerator = 3;
  assert.equal(
    interpretDirectionalHypotheses(writeRegression, paired).temporaryScopeBtoC.supported,
    false,
  );
});

test('model-visible A/B/C messages cannot observe HUMAN gold or non-input metadata', () => {
  const pilotCase = loadBoundaryFixture().cases[0];
  const mutated = structuredClone(pilotCase);
  mutated.adjudication.primary.label = 'NO_WRITE';
  mutated.adjudication.disagreementState = 'AGREEMENT';
  mutated.ambiguityState = 'CLEAR';
  mutated.hardGateExpectation.status = 'UNKNOWN';
  const originalMetadata = calibrationMetadataForCase(pilotCase);
  const mutatedMetadata = {
    schemaFamily: 'forbidden-if-visible',
    screeningClass: 'WRITE_CANDIDATE',
    stratum: 'write_candidate',
    capabilityProbe: true,
    expectedConditionResult: 'ESCALATE',
    acceptanceCriteria: 'forbidden-if-visible',
  };
  assert.equal(isDeepStrictEqual(originalMetadata, mutatedMetadata), false);
  for (const condition of [CONDITIONS.A, CONDITIONS.B, CONDITIONS.C]) {
    const original = buildConditionPrompt(pilotCase, condition).messages;
    const changed = buildConditionPrompt(mutated, condition).messages;
    assert.deepEqual(changed, original);
    const visible = JSON.stringify(original);
    for (const forbidden of [
      'adjudication',
      'ambiguityState',
      'screeningClass',
      'stratum',
      'hardGateExpectation',
      `\"label\":\"${pilotCase.adjudication.primary.label}\"`,
      'PRIMARY_ADJUDICATED',
      'AMBIGUOUS',
      'eligible_escalate',
      'DOES_NOT_APPLY',
      'expectedConditionResult',
      'acceptanceCriteria',
    ]) {
      assert.equal(visible.includes(forbidden), false, `leaked: ${forbidden}`);
    }
  }
});

test('package exposes only the narrow P1-B2d execution script', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(
    packageJson.scripts['research:memory-inference-p1b2d-triage-boundary'],
    'node scripts/run-memory-inference-p1b2d-triage-boundary-diagnostic.js',
  );
});
