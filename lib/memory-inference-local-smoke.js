'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const { performance } = require('node:perf_hooks');

const {
  WORKLOAD_TYPES,
} = require('./memory-inference-pilot');
const {
  ERROR_STATES,
  ESCALATION_DECISIONS,
  ESCALATION_REASONS,
  EXECUTION_MODES,
  EXECUTOR_TYPES,
  HARD_GATE_EXPECTATIONS,
  POLICY_OUTCOMES,
  POLICY_TYPES,
  RESULT_CONTRACT_VERSION,
  SCHEMA_STATUSES,
  TASK_OUTCOMES,
  validatePilotCase,
  validatePilotResult,
  validateTrackedPilotFixture,
} = require('./memory-inference-pilot-contracts');

const RUNNER_CONFIGURATION_VERSION = 'xion-local-memory-inference-p1a-config-v1';
const RUNNER_VERSION = 'xion-local-memory-inference-p1a-runner-v1';
const PROMPT_VERSION = 'xion-local-memory-inference-p1a-prompt-v1';
const SMOKE_REPORT_VERSION = 'xion-local-memory-inference-p1a-smoke-report-v1';

const EVALUATION_MODES = Object.freeze({
  LOCAL_ELIGIBLE: 'LOCAL_ELIGIBLE',
  ELIGIBILITY_UNKNOWN: 'ELIGIBILITY_UNKNOWN',
  CAPABILITY_PROBE: 'CAPABILITY_PROBE',
});

const SEMANTIC_SCORING = Object.freeze({
  SCORED: 'SCORED',
  NOT_SCORED: 'NOT_SCORED',
});

const PROMPT_INSTRUCTIONS = Object.freeze({
  [WORKLOAD_TYPES.STRUCTURED_EXTRACTION]:
    'Extract only the requested synthetic fact. Do not infer missing values.',
  [WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE]: [
    'Classify the input as WRITE_CANDIDATE, NO_WRITE, or ESCALATE.',
    'This is advisory triage only and does not authorize a durable write.',
  ].join(' '),
  [WORKLOAD_TYPES.AMBIGUITY_ESCALATION]: [
    'Return CLEAR only when the evidence identifies one unambiguous interpretation.',
    'Otherwise return ESCALATE. Do not resolve ambiguity yourself.',
  ].join(' '),
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isPlainObject(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

const TASK_SPECIFICATIONS = Object.freeze({
  [WORKLOAD_TYPES.STRUCTURED_EXTRACTION]: Object.freeze({
    taskSpecificationVersion: 'structured-extraction-synthetic-fact-v1',
    outputSchemaVersion: 'structured-extraction-output-v1',
    outputSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: ['reviewDate'],
      properties: Object.freeze({
        reviewDate: Object.freeze({ type: 'string', format: 'date' }),
      }),
    }),
    supports(pilotCase) {
      return pilotCase.inputPayload.expectedSchema === 'synthetic_fact_v1';
    },
    validate(output) {
      return hasExactKeys(output, ['reviewDate']) && isIsoDate(output.reviewDate);
    },
  }),
  [WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE]: Object.freeze({
    taskSpecificationVersion: 'write-candidate-triage-v1',
    outputSchemaVersion: 'write-candidate-triage-output-v1',
    outputSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: ['decision'],
      properties: Object.freeze({
        decision: Object.freeze({
          type: 'string',
          enum: Object.freeze(['WRITE_CANDIDATE', 'NO_WRITE', 'ESCALATE']),
        }),
      }),
    }),
    supports() { return true; },
    validate(output) {
      return hasExactKeys(output, ['decision'])
        && ['WRITE_CANDIDATE', 'NO_WRITE', 'ESCALATE'].includes(output.decision);
    },
  }),
  [WORKLOAD_TYPES.AMBIGUITY_ESCALATION]: Object.freeze({
    taskSpecificationVersion: 'ambiguity-escalation-v1',
    outputSchemaVersion: 'ambiguity-escalation-output-v1',
    outputSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: ['decision'],
      properties: Object.freeze({
        decision: Object.freeze({
          type: 'string',
          enum: Object.freeze(['CLEAR', 'ESCALATE']),
        }),
      }),
    }),
    supports() { return true; },
    validate(output) {
      return hasExactKeys(output, ['decision'])
        && ['CLEAR', 'ESCALATE'].includes(output.decision);
    },
  }),
});

function taskSpecificationForCase(pilotCase) {
  const specification = TASK_SPECIFICATIONS[pilotCase.workloadType];
  if (!specification || !specification.supports(pilotCase)) {
    throw new TypeError(`P1-A가 지원하지 않는 task specification입니다: ${pilotCase.caseId}`);
  }
  return specification;
}

function buildPilotPrompt(pilotCase) {
  validatePilotCase(pilotCase);
  const specification = taskSpecificationForCase(pilotCase);
  return {
    promptVersion: PROMPT_VERSION,
    taskSpecificationVersion: specification.taskSpecificationVersion,
    outputSchemaVersion: specification.outputSchemaVersion,
    messages: [
      {
        role: 'system',
        content: [
          'You are an experimental bounded local inference runner.',
          'Return exactly one JSON object and no markdown or explanation.',
          'Use only the supplied input. Do not claim memory, write, or authority.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          `WORKLOAD: ${pilotCase.workloadType}`,
          `TASK_SPECIFICATION: ${specification.taskSpecificationVersion}`,
          `INSTRUCTION: ${PROMPT_INSTRUCTIONS[pilotCase.workloadType]}`,
          `OUTPUT_SCHEMA: ${JSON.stringify(specification.outputSchema)}`,
          `INPUT: ${JSON.stringify(pilotCase.inputPayload)}`,
        ].join('\n'),
      },
    ],
  };
}

function loadTrackedPilotFixture(fixturePath) {
  const parsed = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  if (!hasExactKeys(parsed, ['name', 'cases'])) {
    throw new TypeError('tracked fixture에는 name과 cases만 있어야 합니다.');
  }
  if (typeof parsed.name !== 'string' || parsed.name.length < 1 || parsed.name.length > 160) {
    throw new TypeError('tracked fixture name은 1~160자 문자열이어야 합니다.');
  }
  validateTrackedPilotFixture(parsed.cases);
  return parsed;
}

function normalizeEndpoint(endpoint) {
  let url;
  try {
    url = new URL(String(endpoint || '').trim());
  } catch {
    throw new TypeError('--endpoint는 유효한 HTTP(S) URL이어야 합니다.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new TypeError('--endpoint는 자격증명이 포함되지 않은 HTTP(S) URL이어야 합니다.');
  }
  if (url.search || url.hash) {
    throw new TypeError('--endpoint에는 query나 fragment를 넣을 수 없습니다.');
  }
  const basePath = url.pathname.replace(/\/+$/u, '');
  if (basePath.endsWith('/chat/completions')) {
    url.pathname = basePath;
  } else if (basePath.endsWith('/v1')) {
    url.pathname = `${basePath}/chat/completions`;
  } else {
    url.pathname = `${basePath}/v1/chat/completions`;
  }
  return url.toString();
}

function boundedRequiredString(value, name, max = 240) {
  const normalized = String(value || '').trim();
  if (normalized.length < 1 || normalized.length > max) {
    throw new TypeError(`${name}은 1~${max}자 문자열이어야 합니다.`);
  }
  return normalized;
}

function normalizeRunnerOptions(options = {}) {
  const timeoutMs = Number(options.timeoutMs ?? 60_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new TypeError('timeoutMs는 1~300000 사이 정수여야 합니다.');
  }
  return {
    endpoint: normalizeEndpoint(options.endpoint),
    modelId: boundedRequiredString(options.modelId, 'modelId'),
    artifactId: boundedRequiredString(options.artifactId, 'artifactId'),
    quantization: boundedRequiredString(options.quantization, 'quantization', 160),
    runtimeFamily: boundedRequiredString(options.runtimeFamily || 'llama.cpp', 'runtimeFamily', 160),
    runtimeVersion: boundedRequiredString(options.runtimeVersion, 'runtimeVersion', 160),
    commit: boundedRequiredString(options.commit, 'commit', 64),
    timeoutMs,
    fetchImpl: options.fetchImpl || globalThis.fetch,
  };
}

function configurationForCase(pilotCase, specification, options) {
  const identity = {
    endpoint: options.endpoint,
    modelId: options.modelId,
    artifactId: options.artifactId,
    quantization: options.quantization,
    runtimeFamily: options.runtimeFamily,
    runtimeVersion: options.runtimeVersion,
    runnerVersion: RUNNER_VERSION,
    promptVersion: PROMPT_VERSION,
    taskContractVersion: pilotCase.taskContractVersion,
    taskSpecificationVersion: specification.taskSpecificationVersion,
    outputSchemaVersion: specification.outputSchemaVersion,
    commit: options.commit,
  };
  const digest = crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  return {
    configurationId: `p1a-${digest.slice(0, 24)}`,
    version: RUNNER_CONFIGURATION_VERSION,
    runnerVersion: RUNNER_VERSION,
    runtimeFamily: options.runtimeFamily,
    runtimeVersion: options.runtimeVersion,
    modelId: options.modelId,
    artifactId: options.artifactId,
    quantization: options.quantization,
    promptVersion: PROMPT_VERSION,
    taskContractVersion: pilotCase.taskContractVersion,
    taskSpecificationVersion: specification.taskSpecificationVersion,
    outputSchemaVersion: specification.outputSchemaVersion,
    commit: options.commit,
  };
}

function roundedMilliseconds(startedAt) {
  return Math.round((performance.now() - startedAt) * 1000) / 1000;
}

async function callLocalChatCompletions(options, prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  const startedAt = performance.now();
  let response;
  try {
    response = await options.fetchImpl(options.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.modelId,
        messages: prompt.messages,
        temperature: 0,
        max_tokens: 128,
        stream: false,
        chat_template_kwargs: { enable_thinking: false },
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    const body = await response.text();
    const latencyMs = roundedMilliseconds(startedAt);
    if (!response.ok) {
      return {
        error: { state: ERROR_STATES.RUNNER_ERROR, code: `LOCAL_HTTP_${response.status}` },
        latencyMs,
      };
    }
    let envelope;
    try {
      envelope = JSON.parse(body);
    } catch {
      return {
        error: { state: ERROR_STATES.RUNNER_ERROR, code: 'LOCAL_RUNTIME_INVALID_JSON' },
        latencyMs,
      };
    }
    const content = envelope?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      return {
        error: { state: ERROR_STATES.RUNNER_ERROR, code: 'LOCAL_RUNTIME_RESPONSE_INVALID' },
        latencyMs,
      };
    }
    return { content, latencyMs, error: null };
  } catch (error) {
    const latencyMs = roundedMilliseconds(startedAt);
    if (error?.name === 'AbortError') {
      return {
        error: { state: ERROR_STATES.TIMEOUT, code: 'LOCAL_ENDPOINT_TIMEOUT' },
        latencyMs,
      };
    }
    return {
      error: {
        state: error instanceof TypeError && !response
          ? ERROR_STATES.UNAVAILABLE
          : ERROR_STATES.RUNNER_ERROR,
        code: error instanceof TypeError && !response
          ? 'LOCAL_ENDPOINT_UNAVAILABLE'
          : 'LOCAL_RUNTIME_FAILURE',
      },
      latencyMs,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function synchronousRuntime(latencyMs) {
  return {
    executionMode: EXECUTION_MODES.SYNCHRONOUS,
    endToEndLatencyMs: latencyMs,
    queueWaitMs: null,
    timeToCompletionMs: latencyMs,
    throughputPerMinute: null,
    deadlineMet: null,
    backlogBefore: null,
    backlogAfter: null,
  };
}

function adjudicatedGold(pilotCase) {
  if (pilotCase.adjudication.finalResolvedHumanLabel !== null) {
    return pilotCase.adjudication.finalResolvedHumanLabel;
  }
  return pilotCase.adjudication.primary?.label ?? null;
}

function normalizedGoldOutput(pilotCase, gold) {
  if (gold === null) return null;
  if (pilotCase.workloadType === WORKLOAD_TYPES.STRUCTURED_EXTRACTION) return gold;
  return typeof gold === 'string' ? { decision: gold } : gold;
}

function semanticOutcome(pilotCase, structuredOutput) {
  const gold = normalizedGoldOutput(pilotCase, adjudicatedGold(pilotCase));
  if (gold === null) {
    return {
      taskOutcome: TASK_OUTCOMES.UNKNOWN,
      scoring: { status: SEMANTIC_SCORING.NOT_SCORED, reasonCode: 'ADJUDICATION_UNAVAILABLE' },
    };
  }
  const matches = isDeepStrictEqual(structuredOutput, gold);
  return {
    taskOutcome: matches ? TASK_OUTCOMES.SUCCESS : TASK_OUTCOMES.FAILURE,
    scoring: { status: SEMANTIC_SCORING.SCORED, reasonCode: matches ? 'MATCH' : 'MISMATCH' },
  };
}

function evaluationMode(pilotCase) {
  if (pilotCase.hardGateExpectation.status === HARD_GATE_EXPECTATIONS.APPLIES) {
    return EVALUATION_MODES.CAPABILITY_PROBE;
  }
  if (pilotCase.hardGateExpectation.status === HARD_GATE_EXPECTATIONS.DOES_NOT_APPLY) {
    return EVALUATION_MODES.LOCAL_ELIGIBLE;
  }
  return EVALUATION_MODES.ELIGIBILITY_UNKNOWN;
}

async function runPilotCase(pilotCase, runnerOptions) {
  validatePilotCase(pilotCase);
  const specification = taskSpecificationForCase(pilotCase);
  const options = normalizeRunnerOptions(runnerOptions);
  const prompt = buildPilotPrompt(pilotCase);
  const configuration = configurationForCase(pilotCase, specification, options);
  const response = await callLocalChatCompletions(options, prompt);

  let directResult;
  let scoring;
  if (response.error) {
    directResult = {
      executorType: EXECUTOR_TYPES.LOCAL,
      configurationId: configuration.configurationId,
      structuredOutput: null,
      schemaStatus: SCHEMA_STATUSES.NOT_APPLICABLE,
      taskOutcome: TASK_OUTCOMES.NOT_RUN,
      runtime: synchronousRuntime(response.latencyMs),
      error: response.error,
    };
    scoring = { status: SEMANTIC_SCORING.NOT_SCORED, reasonCode: 'RUNNER_NOT_COMPLETED' };
  } else {
    let structuredOutput;
    try {
      structuredOutput = JSON.parse(response.content);
    } catch {
      directResult = {
        executorType: EXECUTOR_TYPES.LOCAL,
        configurationId: configuration.configurationId,
        structuredOutput: null,
        schemaStatus: SCHEMA_STATUSES.INVALID,
        taskOutcome: TASK_OUTCOMES.FAILURE,
        runtime: synchronousRuntime(response.latencyMs),
        error: { state: ERROR_STATES.VALIDATION_ERROR, code: 'MODEL_OUTPUT_INVALID_JSON' },
      };
      scoring = { status: SEMANTIC_SCORING.NOT_SCORED, reasonCode: 'INVALID_JSON' };
    }
    if (!directResult && !specification.validate(structuredOutput)) {
      directResult = {
        executorType: EXECUTOR_TYPES.LOCAL,
        configurationId: configuration.configurationId,
        structuredOutput,
        schemaStatus: SCHEMA_STATUSES.INVALID,
        taskOutcome: TASK_OUTCOMES.FAILURE,
        runtime: synchronousRuntime(response.latencyMs),
        error: { state: ERROR_STATES.VALIDATION_ERROR, code: 'MODEL_OUTPUT_SCHEMA_INVALID' },
      };
      scoring = { status: SEMANTIC_SCORING.NOT_SCORED, reasonCode: 'SCHEMA_INVALID' };
    }
    if (!directResult) {
      const semantic = semanticOutcome(pilotCase, structuredOutput);
      directResult = {
        executorType: EXECUTOR_TYPES.LOCAL,
        configurationId: configuration.configurationId,
        structuredOutput,
        schemaStatus: SCHEMA_STATUSES.VALID,
        taskOutcome: semantic.taskOutcome,
        runtime: synchronousRuntime(response.latencyMs),
        error: { state: ERROR_STATES.NONE, code: null },
      };
      scoring = semantic.scoring;
    }
  }

  const result = validatePilotResult({
    contractVersion: RESULT_CONTRACT_VERSION,
    caseId: pilotCase.caseId,
    workloadType: pilotCase.workloadType,
    policyType: POLICY_TYPES.LOCAL_ONLY,
    configuration,
    directResult,
    escalation: {
      decision: ESCALATION_DECISIONS.NOT_APPLICABLE,
      reasonCode: ESCALATION_REASONS.NONE,
      result: null,
    },
    policyOutcome: POLICY_OUTCOMES.NOT_RUN,
    error: directResult.error,
  });
  const mode = evaluationMode(pilotCase);
  return {
    caseId: pilotCase.caseId,
    workloadType: pilotCase.workloadType,
    evaluationMode: mode,
    capabilityProbe: mode === EVALUATION_MODES.CAPABILITY_PROBE,
    localFirstCompletionOpportunity: mode === EVALUATION_MODES.LOCAL_ELIGIBLE,
    semanticScoring: scoring,
    result,
  };
}

function summarizeRuns(runs) {
  const directTaskOutcomes = {
    [TASK_OUTCOMES.SUCCESS]: 0,
    [TASK_OUTCOMES.FAILURE]: 0,
    [TASK_OUTCOMES.UNKNOWN]: 0,
    [TASK_OUTCOMES.NOT_RUN]: 0,
  };
  const errorsByCode = {};
  let schemaValid = 0;
  let invalidStructuredOutput = 0;
  let runnerFailures = 0;
  let semanticScored = 0;
  let capabilityProbes = 0;
  let localFirstCompletionOpportunities = 0;
  for (const run of runs) {
    directTaskOutcomes[run.result.directResult.taskOutcome] += 1;
    if (run.result.directResult.schemaStatus === SCHEMA_STATUSES.VALID) schemaValid += 1;
    if (run.result.directResult.schemaStatus === SCHEMA_STATUSES.INVALID) {
      invalidStructuredOutput += 1;
    }
    if (run.result.directResult.taskOutcome === TASK_OUTCOMES.NOT_RUN) runnerFailures += 1;
    if (run.semanticScoring.status === SEMANTIC_SCORING.SCORED) semanticScored += 1;
    if (run.capabilityProbe) capabilityProbes += 1;
    if (run.localFirstCompletionOpportunity) localFirstCompletionOpportunities += 1;
    const code = run.result.directResult.error.code;
    if (code !== null) errorsByCode[code] = (errorsByCode[code] || 0) + 1;
  }
  return {
    cases: runs.length,
    schemaValid,
    invalidStructuredOutput,
    runnerFailures,
    semanticScored,
    capabilityProbes,
    localFirstCompletionOpportunities,
    directTaskOutcomes,
    errorsByCode,
  };
}

async function runTrackedPilotFixture(fixture, runnerOptions) {
  validateTrackedPilotFixture(fixture.cases);
  const runs = [];
  for (const pilotCase of fixture.cases) {
    runs.push(await runPilotCase(pilotCase, runnerOptions));
  }
  return {
    reportVersion: SMOKE_REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    fixture: {
      name: fixture.name,
      sourceType: 'synthetic',
      cases: fixture.cases.length,
    },
    policyType: POLICY_TYPES.LOCAL_ONLY,
    summary: summarizeRuns(runs),
    runs,
  };
}

module.exports = {
  EVALUATION_MODES,
  PROMPT_INSTRUCTIONS,
  PROMPT_VERSION,
  RUNNER_CONFIGURATION_VERSION,
  RUNNER_VERSION,
  SEMANTIC_SCORING,
  SMOKE_REPORT_VERSION,
  TASK_SPECIFICATIONS,
  buildPilotPrompt,
  loadTrackedPilotFixture,
  normalizeEndpoint,
  runPilotCase,
  runTrackedPilotFixture,
};
