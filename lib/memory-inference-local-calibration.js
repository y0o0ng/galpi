'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const { isDeepStrictEqual } = require('node:util');

const {
  REASON_CODES,
  WORKLOAD_TYPES,
} = require('./memory-inference-pilot');
const {
  CASE_CONTRACT_VERSION,
  CONTROL_STATUSES,
  ERROR_STATES,
  ESCALATION_DECISIONS,
  ESCALATION_REASONS,
  EXECUTION_MODES,
  EXECUTOR_TYPES,
  HARD_GATE_EXPECTATIONS,
  NONE_JUSTIFIED_REASONS,
  POLICY_OUTCOMES,
  POLICY_TYPES,
  RESULT_CONTRACT_VERSION,
  SCHEMA_STATUSES,
  TASK_OUTCOMES,
  createControlRegistry,
  validatePilotCase,
  validatePilotResult,
  validateTrackedPilotFixture,
} = require('./memory-inference-pilot-contracts');

const CALIBRATION_CONFIGURATION_VERSION = 'xion-local-memory-inference-p1b1-config-v1';
const CALIBRATION_RUNNER_VERSION = 'xion-local-memory-inference-p1b1-runner-v1';
const CALIBRATION_PROMPT_VERSION = 'xion-local-memory-inference-p1b1-prompt-v1';
const CALIBRATION_REPORT_VERSION = 'xion-local-memory-inference-p1b1-report-v1';

const SCREENING_DECISIONS = Object.freeze({
  PASS_CURRENT_SIZE: 'PASS_CURRENT_SIZE',
  ADVANCE_SIZE: 'ADVANCE_SIZE',
  INDETERMINATE_RUNTIME: 'INDETERMINATE_RUNTIME',
});

const MODEL_SIZE_CLASSES = Object.freeze({
  SUB_1B: 'sub-1B',
  APPROX_2B: '~2B',
  APPROX_4B: '~4B',
});

const SEMANTIC_SCORING = Object.freeze({
  SCORED: 'SCORED',
  NOT_SCORED: 'NOT_SCORED',
});

const SCHEMA_FAMILIES = Object.freeze({
  DATE: 'date',
  TEXT_SCALAR: 'text_scalar',
  QUANTITY_UNIT: 'quantity_unit',
});

const EXTRACTION_SCHEMA_IDS = Object.freeze({
  [SCHEMA_FAMILIES.DATE]: 'p1b1_date_v1',
  [SCHEMA_FAMILIES.TEXT_SCALAR]: 'p1b1_text_scalar_v1',
  [SCHEMA_FAMILIES.QUANTITY_UNIT]: 'p1b1_quantity_unit_v1',
});

const SCREENING_CLASSES = Object.freeze({
  EXACT_VALUE: 'EXACT_VALUE',
  NO_WRITE: 'NO_WRITE',
  WRITE_CANDIDATE: 'WRITE_CANDIDATE',
  ESCALATE: 'ESCALATE',
  CLEAR: 'CLEAR',
});

const STRATA = new Set([
  'direct', 'distractor', 'paraphrase', 'long_bounded', 'korean', 'english', 'mixed',
  'no_write', 'write_candidate', 'eligible_escalate', 'hard_gated_escalate',
  'clear_easy', 'clear_distractor', 'clear_near_boundary',
  'eligible_escalate_insufficient', 'eligible_escalate_conflict',
  'eligible_escalate_non_authority', 'hard_gated_identity',
  'hard_gated_correction', 'hard_gated_core', 'hard_gated_authority',
]);

const PROMPT_INSTRUCTIONS = Object.freeze({
  [WORKLOAD_TYPES.STRUCTURED_EXTRACTION]:
    'Extract the one explicitly stated requested fact. Do not infer or abstain.',
  [WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE]: [
    'Classify the input as WRITE_CANDIDATE, NO_WRITE, or ESCALATE.',
    'This is advisory triage only and does not authorize a durable write.',
  ].join(' '),
  [WORKLOAD_TYPES.AMBIGUITY_ESCALATION]: [
    'Return CLEAR only when one interpretation is supported unambiguously.',
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

function boundedRequiredString(value, name, max = 240) {
  const normalized = String(value || '').trim();
  if (normalized.length < 1 || normalized.length > max) {
    throw new TypeError(`${name}은 1~${max}자 문자열이어야 합니다.`);
  }
  return normalized;
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

const TASK_SPECIFICATIONS = Object.freeze({
  [EXTRACTION_SCHEMA_IDS.date]: Object.freeze({
    workloadType: WORKLOAD_TYPES.STRUCTURED_EXTRACTION,
    taskSpecificationVersion: 'p1b1-structured-extraction-date-v1',
    outputSchemaVersion: 'p1b1-structured-extraction-date-output-v1',
    outputSchema: Object.freeze({
      type: 'object', additionalProperties: false, required: ['reviewDate'],
      properties: Object.freeze({ reviewDate: Object.freeze({ type: 'string', format: 'date' }) }),
    }),
    validate(output) { return hasExactKeys(output, ['reviewDate']) && isIsoDate(output.reviewDate); },
  }),
  [EXTRACTION_SCHEMA_IDS.text_scalar]: Object.freeze({
    workloadType: WORKLOAD_TYPES.STRUCTURED_EXTRACTION,
    taskSpecificationVersion: 'p1b1-structured-extraction-text-scalar-v1',
    outputSchemaVersion: 'p1b1-structured-extraction-text-scalar-output-v1',
    outputSchema: Object.freeze({
      type: 'object', additionalProperties: false, required: ['preferredMode'],
      properties: Object.freeze({
        preferredMode: Object.freeze({ type: 'string', minLength: 1, maxLength: 80 }),
      }),
    }),
    validate(output) {
      return hasExactKeys(output, ['preferredMode'])
        && typeof output.preferredMode === 'string'
        && output.preferredMode.length >= 1
        && output.preferredMode.length <= 80;
    },
  }),
  [EXTRACTION_SCHEMA_IDS.quantity_unit]: Object.freeze({
    workloadType: WORKLOAD_TYPES.STRUCTURED_EXTRACTION,
    taskSpecificationVersion: 'p1b1-structured-extraction-quantity-unit-v1',
    outputSchemaVersion: 'p1b1-structured-extraction-quantity-unit-output-v1',
    outputSchema: Object.freeze({
      type: 'object', additionalProperties: false, required: ['weeklyTarget', 'unit'],
      properties: Object.freeze({
        weeklyTarget: Object.freeze({ type: 'integer', minimum: 0, maximum: 10000 }),
        unit: Object.freeze({ type: 'string', enum: Object.freeze(['sessions', 'hours', 'pages', 'items']) }),
      }),
    }),
    validate(output) {
      return hasExactKeys(output, ['weeklyTarget', 'unit'])
        && Number.isSafeInteger(output.weeklyTarget)
        && output.weeklyTarget >= 0
        && output.weeklyTarget <= 10000
        && ['sessions', 'hours', 'pages', 'items'].includes(output.unit);
    },
  }),
  [WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE]: Object.freeze({
    workloadType: WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE,
    taskSpecificationVersion: 'p1b1-write-candidate-triage-v1',
    outputSchemaVersion: 'p1b1-write-candidate-triage-output-v1',
    outputSchema: Object.freeze({
      type: 'object', additionalProperties: false, required: ['decision'],
      properties: Object.freeze({
        decision: Object.freeze({
          type: 'string', enum: Object.freeze(['WRITE_CANDIDATE', 'NO_WRITE', 'ESCALATE']),
        }),
      }),
    }),
    validate(output) {
      return hasExactKeys(output, ['decision'])
        && ['WRITE_CANDIDATE', 'NO_WRITE', 'ESCALATE'].includes(output.decision);
    },
  }),
  [WORKLOAD_TYPES.AMBIGUITY_ESCALATION]: Object.freeze({
    workloadType: WORKLOAD_TYPES.AMBIGUITY_ESCALATION,
    taskSpecificationVersion: 'p1b1-ambiguity-escalation-v1',
    outputSchemaVersion: 'p1b1-ambiguity-escalation-output-v1',
    outputSchema: Object.freeze({
      type: 'object', additionalProperties: false, required: ['decision'],
      properties: Object.freeze({
        decision: Object.freeze({ type: 'string', enum: Object.freeze(['CLEAR', 'ESCALATE']) }),
      }),
    }),
    validate(output) {
      return hasExactKeys(output, ['decision'])
        && ['CLEAR', 'ESCALATE'].includes(output.decision);
    },
  }),
});

function taskSpecificationForCase(pilotCase) {
  const key = pilotCase.workloadType === WORKLOAD_TYPES.STRUCTURED_EXTRACTION
    ? pilotCase.inputPayload.expectedSchema
    : pilotCase.workloadType;
  const specification = TASK_SPECIFICATIONS[key];
  if (!specification || specification.workloadType !== pilotCase.workloadType) {
    throw new TypeError(`P1-B1이 지원하지 않는 task specification입니다: ${pilotCase.caseId}`);
  }
  return specification;
}

function validateCalibrationMetadata(pilotCase, metadata) {
  if (!hasExactKeys(metadata, ['schemaFamily', 'screeningClass', 'stratum', 'capabilityProbe'])) {
    throw new TypeError(`calibration metadata key가 올바르지 않습니다: ${pilotCase.caseId}`);
  }
  if (!Object.values(SCREENING_CLASSES).includes(metadata.screeningClass)) {
    throw new TypeError(`지원하지 않는 screeningClass입니다: ${pilotCase.caseId}`);
  }
  if (!STRATA.has(metadata.stratum) || typeof metadata.capabilityProbe !== 'boolean') {
    throw new TypeError(`지원하지 않는 calibration stratum입니다: ${pilotCase.caseId}`);
  }
  const expectedProbe = pilotCase.hardGateExpectation.status === HARD_GATE_EXPECTATIONS.APPLIES;
  if (metadata.capabilityProbe !== expectedProbe) {
    throw new TypeError(`capabilityProbe와 hard gate expectation이 다릅니다: ${pilotCase.caseId}`);
  }
  const gold = pilotCase.adjudication.primary?.label;
  if (pilotCase.workloadType === WORKLOAD_TYPES.STRUCTURED_EXTRACTION) {
    if (!Object.values(SCHEMA_FAMILIES).includes(metadata.schemaFamily)) {
      throw new TypeError(`지원하지 않는 extraction schemaFamily입니다: ${pilotCase.caseId}`);
    }
    if (metadata.screeningClass !== SCREENING_CLASSES.EXACT_VALUE) {
      throw new TypeError(`extraction screeningClass가 올바르지 않습니다: ${pilotCase.caseId}`);
    }
    if (pilotCase.inputPayload.expectedSchema !== EXTRACTION_SCHEMA_IDS[metadata.schemaFamily]) {
      throw new TypeError(`schemaFamily와 expectedSchema가 다릅니다: ${pilotCase.caseId}`);
    }
    if (!hasExactKeys(pilotCase.inputPayload, ['evidence', 'expectedSchema']) || !isPlainObject(gold)) {
      throw new TypeError(`extraction input/gold contract가 올바르지 않습니다: ${pilotCase.caseId}`);
    }
    if (!taskSpecificationForCase(pilotCase).validate(gold)) {
      throw new TypeError(`extraction constructed gold가 output schema에 맞지 않습니다: ${pilotCase.caseId}`);
    }
  } else {
    if (metadata.schemaFamily !== null || !hasExactKeys(pilotCase.inputPayload, ['evidence'])) {
      throw new TypeError(`decision workload metadata/input contract가 올바르지 않습니다: ${pilotCase.caseId}`);
    }
    if (gold !== metadata.screeningClass) {
      throw new TypeError(`screeningClass와 constructed gold가 다릅니다: ${pilotCase.caseId}`);
    }
  }
  if (
    pilotCase.adjudication.state !== 'PRIMARY_ADJUDICATED'
    || pilotCase.adjudication.primary?.source !== 'PROGRAMMATIC'
  ) {
    throw new TypeError(`P1-B1 synthetic case에는 PROGRAMMATIC primary gold가 필요합니다: ${pilotCase.caseId}`);
  }
  taskSpecificationForCase(pilotCase);
  return metadata;
}

function validateCalibrationFixture(fixture) {
  if (!hasExactKeys(fixture, ['name', 'cases', 'calibrationMetadata'])) {
    throw new TypeError('P1-B1 fixture에는 name, cases, calibrationMetadata만 있어야 합니다.');
  }
  boundedRequiredString(fixture.name, 'fixture.name', 160);
  validateTrackedPilotFixture(fixture.cases);
  if (fixture.cases.length !== 90) throw new TypeError('P1-B1 fixture는 정확히 90 cases여야 합니다.');
  if (!isPlainObject(fixture.calibrationMetadata)) {
    throw new TypeError('calibrationMetadata는 caseId-keyed object여야 합니다.');
  }
  const ids = fixture.cases.map(item => item.caseId);
  if (new Set(ids).size !== ids.length) throw new TypeError('P1-B1 caseId는 중복될 수 없습니다.');
  const metadataIds = Object.keys(fixture.calibrationMetadata).sort();
  if (!isDeepStrictEqual([...ids].sort(), metadataIds)) {
    throw new TypeError('calibrationMetadata는 fixture caseId를 정확히 한 번씩 참조해야 합니다.');
  }
  const workloadCounts = new Map();
  const schemaCounts = new Map();
  for (const pilotCase of fixture.cases) {
    validateCalibrationMetadata(pilotCase, fixture.calibrationMetadata[pilotCase.caseId]);
    workloadCounts.set(pilotCase.workloadType, (workloadCounts.get(pilotCase.workloadType) || 0) + 1);
    const family = fixture.calibrationMetadata[pilotCase.caseId].schemaFamily;
    if (family !== null) schemaCounts.set(family, (schemaCounts.get(family) || 0) + 1);
  }
  for (const workloadType of Object.values(WORKLOAD_TYPES)) {
    if (workloadCounts.get(workloadType) !== 30) {
      throw new TypeError(`P1-B1 workload count는 각각 30이어야 합니다: ${workloadType}`);
    }
  }
  for (const family of Object.values(SCHEMA_FAMILIES)) {
    if (schemaCounts.get(family) !== 10) {
      throw new TypeError(`P1-B1 extraction schema family는 각각 10이어야 합니다: ${family}`);
    }
  }
  const countMetadata = (workloadType, screeningClass, capabilityProbe) => fixture.cases.filter(item => {
    const metadata = fixture.calibrationMetadata[item.caseId];
    return item.workloadType === workloadType
      && metadata.screeningClass === screeningClass
      && metadata.capabilityProbe === capabilityProbe;
  }).length;
  if (
    countMetadata(WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE, SCREENING_CLASSES.NO_WRITE, false) !== 10
    || countMetadata(WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE, SCREENING_CLASSES.WRITE_CANDIDATE, false) !== 10
    || countMetadata(WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE, SCREENING_CLASSES.ESCALATE, false) !== 5
    || countMetadata(WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE, SCREENING_CLASSES.ESCALATE, true) !== 5
  ) {
    throw new TypeError('P1-B1 triage 분포는 NO_WRITE 10 / WRITE_CANDIDATE 10 / eligible ESCALATE 5 / probe ESCALATE 5여야 합니다.');
  }
  if (
    countMetadata(WORKLOAD_TYPES.AMBIGUITY_ESCALATION, SCREENING_CLASSES.CLEAR, false) !== 12
    || countMetadata(WORKLOAD_TYPES.AMBIGUITY_ESCALATION, SCREENING_CLASSES.ESCALATE, false) !== 10
    || countMetadata(WORKLOAD_TYPES.AMBIGUITY_ESCALATION, SCREENING_CLASSES.ESCALATE, true) !== 8
  ) {
    throw new TypeError('P1-B1 ambiguity 분포는 CLEAR 12 / eligible ESCALATE 10 / probe ESCALATE 8이어야 합니다.');
  }
  const ambiguityProbeReasonCounts = new Map();
  for (const pilotCase of fixture.cases.filter(item => (
    item.workloadType === WORKLOAD_TYPES.AMBIGUITY_ESCALATION
    && fixture.calibrationMetadata[item.caseId].capabilityProbe
  ))) {
    const reason = pilotCase.hardGateExpectation.reasonCode;
    ambiguityProbeReasonCounts.set(reason, (ambiguityProbeReasonCounts.get(reason) || 0) + 1);
  }
  for (const reasonCode of [
    REASON_CODES.CONTRACT_IDENTITY_AMBIGUITY,
    REASON_CODES.CONTRACT_EXPLICIT_CORRECTION,
    REASON_CODES.CONTRACT_CORE_OR_HIGH_IMPACT,
    REASON_CODES.CONTRACT_AUTHORITY_SENSITIVE,
  ]) {
    if (ambiguityProbeReasonCounts.get(reasonCode) !== 2) {
      throw new TypeError(`P1-B1 ambiguity probe는 contract reason을 각각 2개 포함해야 합니다: ${reasonCode}`);
    }
  }
  return fixture;
}

function loadCalibrationFixture(fixturePath) {
  return validateCalibrationFixture(JSON.parse(fs.readFileSync(fixturePath, 'utf8')));
}

function buildCalibrationPrompt(pilotCase) {
  validatePilotCase(pilotCase);
  const specification = taskSpecificationForCase(pilotCase);
  return {
    promptVersion: CALIBRATION_PROMPT_VERSION,
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

function normalizeEndpoint(endpoint) {
  let url;
  try { url = new URL(String(endpoint || '').trim()); } catch {
    throw new TypeError('--endpoint는 유효한 HTTP(S) URL이어야 합니다.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new TypeError('--endpoint는 자격증명이 포함되지 않은 HTTP(S) URL이어야 합니다.');
  }
  if (url.search || url.hash) throw new TypeError('--endpoint에는 query나 fragment를 넣을 수 없습니다.');
  const basePath = url.pathname.replace(/\/+$/u, '');
  url.pathname = basePath.endsWith('/chat/completions')
    ? basePath
    : basePath.endsWith('/v1') ? `${basePath}/chat/completions` : `${basePath}/v1/chat/completions`;
  return url.toString();
}

function normalizeRunnerOptions(options = {}) {
  const timeoutMs = Number(options.timeoutMs ?? 60_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new TypeError('timeoutMs는 1~300000 사이 정수여야 합니다.');
  }
  if (!Object.values(MODEL_SIZE_CLASSES).includes(options.modelSizeClass)) {
    throw new TypeError('modelSizeClass는 sub-1B, ~2B, ~4B 중 하나여야 합니다.');
  }
  if (options.quantization !== 'BF16') {
    throw new TypeError('P1-B1 capability-boundary probe는 BF16 configuration만 허용합니다.');
  }
  return {
    endpoint: normalizeEndpoint(options.endpoint),
    modelId: boundedRequiredString(options.modelId, 'modelId'),
    artifactId: boundedRequiredString(options.artifactId, 'artifactId'),
    quantization: boundedRequiredString(options.quantization, 'quantization', 160),
    runtimeFamily: boundedRequiredString(options.runtimeFamily || 'llama.cpp', 'runtimeFamily', 160),
    runtimeVersion: boundedRequiredString(options.runtimeVersion, 'runtimeVersion', 160),
    commit: boundedRequiredString(options.commit, 'commit', 64),
    modelSizeClass: options.modelSizeClass,
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
    runnerVersion: CALIBRATION_RUNNER_VERSION,
    promptVersion: CALIBRATION_PROMPT_VERSION,
    taskContractVersion: pilotCase.taskContractVersion,
    taskSpecificationVersion: specification.taskSpecificationVersion,
    outputSchemaVersion: specification.outputSchemaVersion,
    commit: options.commit,
  };
  const digest = crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  return {
    configurationId: `p1b1-${digest.slice(0, 24)}`,
    version: CALIBRATION_CONFIGURATION_VERSION,
    runnerVersion: CALIBRATION_RUNNER_VERSION,
    runtimeFamily: options.runtimeFamily,
    runtimeVersion: options.runtimeVersion,
    modelId: options.modelId,
    artifactId: options.artifactId,
    quantization: options.quantization,
    promptVersion: CALIBRATION_PROMPT_VERSION,
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
      return { error: { state: ERROR_STATES.RUNNER_ERROR, code: `LOCAL_HTTP_${response.status}` }, latencyMs };
    }
    let envelope;
    try { envelope = JSON.parse(body); } catch {
      return { error: { state: ERROR_STATES.RUNNER_ERROR, code: 'LOCAL_RUNTIME_INVALID_JSON' }, latencyMs };
    }
    const content = envelope?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      return { error: { state: ERROR_STATES.RUNNER_ERROR, code: 'LOCAL_RUNTIME_RESPONSE_INVALID' }, latencyMs };
    }
    return { content, latencyMs, error: null };
  } catch (error) {
    const latencyMs = roundedMilliseconds(startedAt);
    if (error?.name === 'AbortError') {
      return { error: { state: ERROR_STATES.TIMEOUT, code: 'LOCAL_ENDPOINT_TIMEOUT' }, latencyMs };
    }
    return {
      error: {
        state: error instanceof TypeError && !response ? ERROR_STATES.UNAVAILABLE : ERROR_STATES.RUNNER_ERROR,
        code: error instanceof TypeError && !response ? 'LOCAL_ENDPOINT_UNAVAILABLE' : 'LOCAL_RUNTIME_FAILURE',
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

function semanticOutcome(pilotCase, structuredOutput) {
  const gold = pilotCase.adjudication.primary?.label ?? null;
  const normalizedGold = pilotCase.workloadType === WORKLOAD_TYPES.STRUCTURED_EXTRACTION
    ? gold
    : { decision: gold };
  const matches = isDeepStrictEqual(structuredOutput, normalizedGold);
  return {
    taskOutcome: matches ? TASK_OUTCOMES.SUCCESS : TASK_OUTCOMES.FAILURE,
    scoring: { status: SEMANTIC_SCORING.SCORED, reasonCode: matches ? 'MATCH' : 'MISMATCH' },
  };
}

async function runCalibrationCase(pilotCase, metadata, runnerOptions) {
  validatePilotCase(pilotCase);
  validateCalibrationMetadata(pilotCase, metadata);
  const specification = taskSpecificationForCase(pilotCase);
  const options = normalizeRunnerOptions(runnerOptions);
  const prompt = buildCalibrationPrompt(pilotCase);
  const configuration = configurationForCase(pilotCase, specification, options);
  const response = await callLocalChatCompletions(options, prompt);
  let directResult;
  let semanticScoring;
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
    semanticScoring = { status: SEMANTIC_SCORING.NOT_SCORED, reasonCode: 'RUNNER_NOT_COMPLETED' };
  } else {
    let structuredOutput;
    try { structuredOutput = JSON.parse(response.content); } catch {
      directResult = {
        executorType: EXECUTOR_TYPES.LOCAL,
        configurationId: configuration.configurationId,
        structuredOutput: null,
        schemaStatus: SCHEMA_STATUSES.INVALID,
        taskOutcome: TASK_OUTCOMES.FAILURE,
        runtime: synchronousRuntime(response.latencyMs),
        error: { state: ERROR_STATES.VALIDATION_ERROR, code: 'MODEL_OUTPUT_INVALID_JSON' },
      };
      semanticScoring = { status: SEMANTIC_SCORING.NOT_SCORED, reasonCode: 'INVALID_JSON' };
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
      semanticScoring = { status: SEMANTIC_SCORING.NOT_SCORED, reasonCode: 'SCHEMA_INVALID' };
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
      semanticScoring = semantic.scoring;
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
  return {
    caseId: pilotCase.caseId,
    workloadType: pilotCase.workloadType,
    evaluationMode: metadata.capabilityProbe
      ? 'CAPABILITY_PROBE'
      : pilotCase.hardGateExpectation.status === HARD_GATE_EXPECTATIONS.UNKNOWN
        ? 'ELIGIBILITY_UNKNOWN'
        : 'LOCAL_ELIGIBLE',
    localFirstCompletionOpportunity:
      pilotCase.hardGateExpectation.status === HARD_GATE_EXPECTATIONS.DOES_NOT_APPLY,
    capabilityProbe: metadata.capabilityProbe,
    calibration: { ...metadata },
    semanticScoring,
    result,
  };
}

function emptyConfusion(labels) {
  return Object.fromEntries(labels.map(expected => [expected, Object.fromEntries(
    [...labels, 'INVALID', 'RUNTIME_FAILURE'].map(actual => [actual, 0]),
  )]));
}

function actualBucket(run) {
  const direct = run.result.directResult;
  if (direct.taskOutcome === TASK_OUTCOMES.NOT_RUN) return 'RUNTIME_FAILURE';
  if (direct.schemaStatus === SCHEMA_STATUSES.INVALID) return 'INVALID';
  return direct.structuredOutput.decision;
}

function summarizeWorkload(workloadType, runs) {
  const schemaValid = runs.filter(run => run.result.directResult.schemaStatus === SCHEMA_STATUSES.VALID).length;
  const invalidStructuredOutputs = runs.filter(
    run => run.result.directResult.schemaStatus === SCHEMA_STATUSES.INVALID,
  ).length;
  const runtimeFailures = runs.filter(
    run => run.result.directResult.taskOutcome === TASK_OUTCOMES.NOT_RUN,
  ).length;
  const semanticSuccess = runs.filter(
    run => run.result.directResult.taskOutcome === TASK_OUTCOMES.SUCCESS,
  ).length;
  const semanticFailure = runs.filter(
    run => run.result.directResult.taskOutcome === TASK_OUTCOMES.FAILURE,
  ).length;
  const probes = runs.filter(run => run.calibration.capabilityProbe);
  const probeMismatches = probes.filter(run => (
    run.semanticScoring.status === SEMANTIC_SCORING.SCORED
    && run.semanticScoring.reasonCode === 'MISMATCH'
  )).length;
  const localFirstCompletionOpportunities = runs.filter(
    run => run.localFirstCompletionOpportunity,
  ).length;
  const eligibilityUnknown = runs.filter(run => run.evaluationMode === 'ELIGIBILITY_UNKNOWN').length;
  const common = {
    workloadType,
    totalCases: runs.length,
    schemaValid,
    invalidStructuredOutputs,
    runtimeFailures,
    semanticSuccess,
    semanticFailure,
    semanticNotScored: runs.length - semanticSuccess - semanticFailure,
    hardGatedCapabilityProbes: probes.length,
    nonHardGatedCases: runs.length - probes.length,
    probeMismatches,
    capabilityProbeSummary: {
      cases: probes.length,
      schemaValid: probes.filter(run => run.result.directResult.schemaStatus === SCHEMA_STATUSES.VALID).length,
      invalidStructuredOutputs: probes.filter(
        run => run.result.directResult.schemaStatus === SCHEMA_STATUSES.INVALID,
      ).length,
      runtimeFailures: probes.filter(
        run => run.result.directResult.taskOutcome === TASK_OUTCOMES.NOT_RUN,
      ).length,
      semanticSuccess: probes.filter(
        run => run.result.directResult.taskOutcome === TASK_OUTCOMES.SUCCESS,
      ).length,
      semanticFailure: probes.filter(
        run => run.result.directResult.taskOutcome === TASK_OUTCOMES.FAILURE,
      ).length,
      mismatches: probeMismatches,
    },
    localFirstCompletionOpportunities,
    eligibilityUnknown,
  };

  if (workloadType === WORKLOAD_TYPES.STRUCTURED_EXTRACTION) {
    const numerator = semanticSuccess;
    const denominator = runs.length;
    const criticalWrongValueCount = runs.filter(run => (
      run.result.directResult.schemaStatus === SCHEMA_STATUSES.VALID
      && run.semanticScoring.reasonCode === 'MISMATCH'
    )).length;
    return {
      ...common,
      confusion: {
        exactMatches: numerator,
        wrongValues: criticalWrongValueCount,
        invalidStructuredOutputs,
        runtimeFailures,
      },
      criticalUnsafeFailures: criticalWrongValueCount,
      criticalWrongValueCount,
      screeningMetric: {
        name: 'exact_local_completion', numerator, denominator,
        value: denominator === 0 ? null : numerator / denominator,
        threshold: { minimum: 0.9, finitePassBoundary: 27 },
      },
      screeningDecision: runtimeFailures > 0
        ? SCREENING_DECISIONS.INDETERMINATE_RUNTIME
        : numerator >= 27 && criticalWrongValueCount === 0
          ? SCREENING_DECISIONS.PASS_CURRENT_SIZE
          : SCREENING_DECISIONS.ADVANCE_SIZE,
    };
  }

  const labels = workloadType === WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE
    ? ['NO_WRITE', 'WRITE_CANDIDATE', 'ESCALATE']
    : ['CLEAR', 'ESCALATE'];
  const confusion = emptyConfusion(labels);
  for (const run of runs.filter(item => !item.calibration.capabilityProbe)) {
    confusion[run.calibration.screeningClass][actualBucket(run)] += 1;
  }
  if (workloadType === WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE) {
    const denominator = runs.filter(run => (
      !run.calibration.capabilityProbe && run.calibration.screeningClass === 'NO_WRITE'
    )).length;
    const numerator = confusion.NO_WRITE.NO_WRITE;
    const eligibleFalseNoWriteCount = runs.filter(run => (
      !run.calibration.capabilityProbe
      && ['WRITE_CANDIDATE', 'ESCALATE'].includes(run.calibration.screeningClass)
      && actualBucket(run) === 'NO_WRITE'
    )).length;
    return {
      ...common,
      confusion,
      criticalUnsafeFailures: eligibleFalseNoWriteCount,
      eligibleFalseNoWriteCount,
      screeningMetric: {
        name: 'no_write_recall', numerator, denominator,
        value: denominator === 0 ? null : numerator / denominator,
        threshold: { minimum: 0.8, finitePassBoundary: 8 },
      },
      screeningDecision: runtimeFailures > 0
        ? SCREENING_DECISIONS.INDETERMINATE_RUNTIME
        : numerator >= 8 && eligibleFalseNoWriteCount === 0
          ? SCREENING_DECISIONS.PASS_CURRENT_SIZE
          : SCREENING_DECISIONS.ADVANCE_SIZE,
    };
  }

  const denominator = runs.filter(run => (
    !run.calibration.capabilityProbe && run.calibration.screeningClass === 'CLEAR'
  )).length;
  const numerator = confusion.CLEAR.CLEAR;
  const eligibleFalseClearCount = runs.filter(run => (
    !run.calibration.capabilityProbe
    && run.calibration.screeningClass === 'ESCALATE'
    && actualBucket(run) === 'CLEAR'
  )).length;
  return {
    ...common,
    confusion,
    criticalUnsafeFailures: eligibleFalseClearCount,
    eligibleFalseClearCount,
    screeningMetric: {
      name: 'clear_recall', numerator, denominator,
      value: denominator === 0 ? null : numerator / denominator,
      threshold: { minimum: 0.85, finitePassBoundary: 11 },
    },
    screeningDecision: runtimeFailures > 0
      ? SCREENING_DECISIONS.INDETERMINATE_RUNTIME
      : denominator > 0 && numerator / denominator >= 0.85 && eligibleFalseClearCount === 0
        ? SCREENING_DECISIONS.PASS_CURRENT_SIZE
        : SCREENING_DECISIONS.ADVANCE_SIZE,
  };
}

function summarizeCalibrationRuns(runs) {
  return Object.values(WORKLOAD_TYPES).map(workloadType => (
    summarizeWorkload(workloadType, runs.filter(run => run.workloadType === workloadType))
  ));
}

const CONTROL_DEFINITIONS = Object.freeze(Array.from(createControlRegistry([
  {
    workloadType: WORKLOAD_TYPES.STRUCTURED_EXTRACTION,
    status: CONTROL_STATUSES.NONE_JUSTIFIED,
    controlId: null, kind: null, version: null,
    reasonCode: NONE_JUSTIFIED_REASONS.TASK_REQUIRES_SEMANTIC_JUDGMENT,
    reason: 'P1-B1 extraction requires semantic judgment; no meaningful non-generative control is justified.',
  },
  {
    workloadType: WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE,
    status: CONTROL_STATUSES.NONE_JUSTIFIED,
    controlId: null, kind: null, version: null,
    reasonCode: NONE_JUSTIFIED_REASONS.TASK_REQUIRES_SEMANTIC_JUDGMENT,
    reason: 'P1-B1 triage requires semantic judgment; no meaningful non-generative control is justified.',
  },
  {
    workloadType: WORKLOAD_TYPES.AMBIGUITY_ESCALATION,
    status: CONTROL_STATUSES.NONE_JUSTIFIED,
    controlId: null, kind: null, version: null,
    reasonCode: NONE_JUSTIFIED_REASONS.EXISTING_LOGIC_IS_AUTHORITY_GATE,
    reason: 'Existing deterministic logic is an authority gate, not a semantic ambiguity classifier.',
  },
]).values()));

async function runCalibrationFixture(fixture, runnerOptions) {
  validateCalibrationFixture(fixture);
  const options = normalizeRunnerOptions(runnerOptions);
  const runs = [];
  for (const pilotCase of fixture.cases) {
    runs.push(await runCalibrationCase(
      pilotCase,
      fixture.calibrationMetadata[pilotCase.caseId],
      options,
    ));
  }
  const workloads = summarizeCalibrationRuns(runs);
  const taskSpecifications = Array.from(new Map(fixture.cases.map(pilotCase => {
    const specification = taskSpecificationForCase(pilotCase);
    return [specification.taskSpecificationVersion, {
      workloadType: pilotCase.workloadType,
      taskSpecificationVersion: specification.taskSpecificationVersion,
      outputSchemaVersion: specification.outputSchemaVersion,
    }];
  })).values());
  return {
    reportVersion: CALIBRATION_REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    fixture: { name: fixture.name, sourceType: 'synthetic', cases: fixture.cases.length },
    provenance: {
      galpiCommit: options.commit,
      modelId: options.modelId,
      artifactId: options.artifactId,
      quantization: options.quantization,
      modelSizeClass: options.modelSizeClass,
      runtimeFamily: options.runtimeFamily,
      runtimeVersion: options.runtimeVersion,
      runnerVersion: CALIBRATION_RUNNER_VERSION,
      configurationVersion: CALIBRATION_CONFIGURATION_VERSION,
      promptVersion: CALIBRATION_PROMPT_VERSION,
      taskContractVersion: CASE_CONTRACT_VERSION,
      taskSpecifications,
      fixtureIdentity: fixture.name,
    },
    policyType: POLICY_TYPES.LOCAL_ONLY,
    controls: CONTROL_DEFINITIONS,
    workloads,
    runs,
  };
}

module.exports = {
  CALIBRATION_CONFIGURATION_VERSION,
  CALIBRATION_PROMPT_VERSION,
  CALIBRATION_REPORT_VERSION,
  CALIBRATION_RUNNER_VERSION,
  CONTROL_DEFINITIONS,
  EXTRACTION_SCHEMA_IDS,
  MODEL_SIZE_CLASSES,
  PROMPT_INSTRUCTIONS,
  SCHEMA_FAMILIES,
  SCREENING_CLASSES,
  SCREENING_DECISIONS,
  SEMANTIC_SCORING,
  TASK_SPECIFICATIONS,
  buildCalibrationPrompt,
  loadCalibrationFixture,
  runCalibrationCase,
  runCalibrationFixture,
  summarizeCalibrationRuns,
  validateCalibrationFixture,
};
