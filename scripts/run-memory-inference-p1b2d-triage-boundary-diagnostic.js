#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');

const { WORKLOAD_TYPES } = require('../lib/memory-inference-pilot');
const {
  CASE_CONTRACT_VERSION,
  POLICY_TYPES,
  SCHEMA_STATUSES,
  TASK_OUTCOMES,
  validatePilotCase,
  validatePilotResult,
} = require('../lib/memory-inference-pilot-contracts');
const {
  MODEL_SIZE_CLASSES,
  TASK_SPECIFICATIONS,
} = require('../lib/memory-inference-local-calibration');
const {
  DEFINED_LABELS_PROMPT_VERSION,
  DEFINED_LABEL_SEMANTICS_INSTRUCTION,
  DIAGNOSTIC_RUNNER_VERSION,
  DIAGNOSTIC_RUNTIME_VERSION,
  PAIRED_TRANSITIONS,
  buildDefinedLabelSemanticsPrompt,
  pairedTransition,
  runDefinedLabelSemanticsCase,
} = require('./run-memory-inference-triage-label-semantics-diagnostic');
const {
  CANDIDATE_FIXTURE_NAME,
  FIXED_CASE_IDS,
  LABELS,
  REVIEW_PROTOCOL_VERSION,
  loadCandidateFixture,
} = require('./review-memory-inference-p1b2d-triage-gold');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_FIXTURE = path.join(
  ROOT,
  'fixtures/local-memory-inference-p1b2d-triage-boundary.json',
);
const DEFAULT_HUMAN_REVIEW = path.join(
  ROOT,
  'fixtures/local-memory-inference-p1b2d-human-primary-labels.json',
);

const BOUNDARY_FIXTURE_NAME = 'xion-local-memory-inference-p1b2d-triage-boundary-v1';
const BOUNDARY_CONFIGURATION_VERSION = 'xion-local-memory-inference-p1b2d-triage-boundary-config-v1';
const BOUNDARY_RUNNER_VERSION = 'xion-local-memory-inference-p1b2d-triage-boundary-runner-v1';
const BOUNDARY_REPORT_VERSION = 'xion-local-memory-inference-p1b2d-triage-boundary-report-v1';
const AMBIGUITY_PRECEDENCE_PROMPT_VERSION = (
  'xion-local-memory-inference-p1b2d-triage-ambiguity-precedence-prompt-v1'
);
const AMBIGUITY_TEMPORARY_PROMPT_VERSION = (
  'xion-local-memory-inference-p1b2d-triage-ambiguity-temporary-prompt-v1'
);
const HUMAN_REVIEW_COMPLETED_AT = '2026-09-02T02:59:25.032Z';
const FIXED_TIMEOUT_MS = 180_000;
const PREFLIGHT_TIMEOUT_MS = 10_000;
const CALLS_PLANNED = 45;
const LABEL_DISTRIBUTION = Object.freeze({
  NO_WRITE: 5,
  WRITE_CANDIDATE: 5,
  ESCALATE: 5,
});
const ACTUAL_BUCKETS = Object.freeze([...LABELS, 'INVALID', 'RUNTIME_FAILURE']);
const CONDITIONS = Object.freeze({
  A: 'CURRENT_DEFINED_LABELS',
  B: 'AMBIGUITY_PRECEDENCE',
  C: 'AMBIGUITY_PRECEDENCE_PLUS_TEMPORARY_SCOPE',
});
const AMBIGUITY_PRECEDENCE_CLARIFICATION = Object.freeze([
  'Before choosing NO_WRITE or WRITE_CANDIDATE, first check whether persistence, scope, reference, or meaning is unresolved.',
  'If such ambiguity prevents a safe choice between NO_WRITE and WRITE_CANDIDATE, choose ESCALATE.',
  'ESCALATE takes precedence over guessing either durable or non-durable status. Do not use NO_WRITE as a fallback for unresolved ambiguity.',
]);
const TEMPORARY_SCOPE_CLARIFICATION = (
  'When scope is unambiguous, evidence explicitly limited to the current message, response, document, task, session, preview, or another temporary window is NO_WRITE, even when the content resembles a preference, setting, format rule, or state.'
);
const DEFINED_LABEL_LINES = Object.freeze(DEFINED_LABEL_SEMANTICS_INSTRUCTION.split('\n'));
const ADVISORY_ONLY_SENTENCE = DEFINED_LABEL_LINES.at(-1);
const AMBIGUITY_PRECEDENCE_INSTRUCTION = Object.freeze([
  ...DEFINED_LABEL_LINES.slice(0, -1),
  ...AMBIGUITY_PRECEDENCE_CLARIFICATION,
  ADVISORY_ONLY_SENTENCE,
].join('\n'));
const AMBIGUITY_TEMPORARY_INSTRUCTION = Object.freeze([
  ...DEFINED_LABEL_LINES.slice(0, -1),
  ...AMBIGUITY_PRECEDENCE_CLARIFICATION,
  TEMPORARY_SCOPE_CLARIFICATION,
  ADVISORY_ONLY_SENTENCE,
].join('\n'));
const FIXED_MODEL_CONFIGURATION = Object.freeze({
  modelId: 'xion-p1b1-qwen3-4b-bf16',
  artifactId: 'unsloth/Qwen3-4B-GGUF:BF16',
  modelSizeClass: MODEL_SIZE_CLASSES.APPROX_4B,
  quantization: 'BF16',
  runtimeFamily: 'llama.cpp',
  runtimeVersion: DIAGNOSTIC_RUNTIME_VERSION,
});
const TRIAGE_SPECIFICATION = TASK_SPECIFICATIONS[WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isPlainObject(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function countLabels(labels) {
  return Object.fromEntries(LABELS.map(label => [
    label,
    labels.filter(value => value === label).length,
  ]));
}

function validateHumanReview(review) {
  if (!hasExactKeys(review, ['protocolVersion', 'candidateFixture', 'completedAt', 'labels'])) {
    throw new TypeError('P1-B2d HUMAN review provenance key가 올바르지 않습니다.');
  }
  if (
    review.protocolVersion !== REVIEW_PROTOCOL_VERSION
    || review.candidateFixture !== CANDIDATE_FIXTURE_NAME
    || review.completedAt !== HUMAN_REVIEW_COMPLETED_AT
    || !Array.isArray(review.labels)
    || review.labels.length !== FIXED_CASE_IDS.length
  ) {
    throw new TypeError('P1-B2d HUMAN review provenance identity가 올바르지 않습니다.');
  }
  for (const entry of review.labels) {
    if (!hasExactKeys(entry, ['caseId', 'label']) || !LABELS.includes(entry.label)) {
      throw new TypeError(`P1-B2d HUMAN label mapping이 올바르지 않습니다: ${entry?.caseId}`);
    }
  }
  if (!isDeepStrictEqual(review.labels.map(entry => entry.caseId), FIXED_CASE_IDS)) {
    throw new TypeError('P1-B2d HUMAN mapping은 고정된 15개 ID를 정확히 한 번씩 포함해야 합니다.');
  }
  if (!isDeepStrictEqual(countLabels(review.labels.map(entry => entry.label)), LABEL_DISTRIBUTION)) {
    throw new TypeError('P1-B2d HUMAN gold 분포는 정확히 5/5/5여야 합니다.');
  }
  return review;
}

function loadHumanReview(reviewPath = DEFAULT_HUMAN_REVIEW) {
  return validateHumanReview(JSON.parse(fs.readFileSync(reviewPath, 'utf8')));
}

function expectedPilotCase(candidate, label) {
  return {
    caseId: candidate.caseId,
    workloadType: candidate.workloadType,
    sourceType: 'synthetic',
    taskContractVersion: CASE_CONTRACT_VERSION,
    inputPayload: candidate.inputPayload,
    adjudication: {
      state: 'PRIMARY_ADJUDICATED',
      primary: { source: 'HUMAN', label },
      blindSecondPass: null,
      disagreementState: 'NOT_ASSESSED',
      finalResolvedHumanLabel: null,
      cloudAssistedReview: {
        performed: false,
        configurationId: null,
        suggestion: null,
      },
    },
    ambiguityState: label === 'ESCALATE' ? 'AMBIGUOUS' : 'CLEAR',
    hardGateExpectation: {
      status: 'DOES_NOT_APPLY',
      guardScope: 'none',
      reasonCode: 'none',
    },
  };
}

function validateBoundaryFixture(
  fixture,
  candidates = loadCandidateFixture(),
  review = loadHumanReview(),
) {
  validateHumanReview(review);
  if (!hasExactKeys(fixture, ['name', 'cases'])) {
    throw new TypeError('P1-B2d final fixture에는 name과 cases만 있어야 합니다.');
  }
  if (
    fixture.name !== BOUNDARY_FIXTURE_NAME
    || !Array.isArray(fixture.cases)
    || fixture.cases.length !== FIXED_CASE_IDS.length
    || !isDeepStrictEqual(fixture.cases.map(item => item.caseId), FIXED_CASE_IDS)
  ) {
    throw new TypeError('P1-B2d final fixture identity 또는 case set이 올바르지 않습니다.');
  }
  const labelsByCaseId = new Map(review.labels.map(entry => [entry.caseId, entry.label]));
  for (let index = 0; index < fixture.cases.length; index += 1) {
    const pilotCase = fixture.cases[index];
    validatePilotCase(pilotCase);
    const expected = expectedPilotCase(
      candidates.cases[index],
      labelsByCaseId.get(pilotCase.caseId),
    );
    if (!isDeepStrictEqual(pilotCase, expected)) {
      throw new TypeError(`P1-B2d final case가 candidate/HUMAN source와 다릅니다: ${pilotCase.caseId}`);
    }
  }
  const distribution = countLabels(fixture.cases.map(item => item.adjudication.primary.label));
  if (!isDeepStrictEqual(distribution, LABEL_DISTRIBUTION)) {
    throw new TypeError('P1-B2d final fixture가 HUMAN 5/5/5 fail-close를 통과하지 못했습니다.');
  }
  return fixture;
}

function loadBoundaryFixture(fixturePath = DEFAULT_FIXTURE) {
  return validateBoundaryFixture(JSON.parse(fs.readFileSync(fixturePath, 'utf8')));
}

function calibrationMetadataForCase(pilotCase) {
  const gold = pilotCase.adjudication.primary.label;
  const strata = {
    NO_WRITE: 'no_write',
    WRITE_CANDIDATE: 'write_candidate',
    ESCALATE: 'eligible_escalate',
  };
  return {
    schemaFamily: null,
    screeningClass: gold,
    stratum: strata[gold],
    capabilityProbe: false,
  };
}

function promptVersionForCondition(condition) {
  const versions = {
    [CONDITIONS.A]: DEFINED_LABELS_PROMPT_VERSION,
    [CONDITIONS.B]: AMBIGUITY_PRECEDENCE_PROMPT_VERSION,
    [CONDITIONS.C]: AMBIGUITY_TEMPORARY_PROMPT_VERSION,
  };
  if (!versions[condition]) throw new TypeError(`지원하지 않는 P1-B2d condition입니다: ${condition}`);
  return versions[condition];
}

function instructionForCondition(condition) {
  const instructions = {
    [CONDITIONS.A]: DEFINED_LABEL_SEMANTICS_INSTRUCTION,
    [CONDITIONS.B]: AMBIGUITY_PRECEDENCE_INSTRUCTION,
    [CONDITIONS.C]: AMBIGUITY_TEMPORARY_INSTRUCTION,
  };
  if (!instructions[condition]) {
    throw new TypeError(`지원하지 않는 P1-B2d condition입니다: ${condition}`);
  }
  return instructions[condition];
}

function buildConditionPrompt(pilotCase, condition) {
  const prompt = structuredClone(buildDefinedLabelSemanticsPrompt(pilotCase));
  const currentInstruction = `INSTRUCTION: ${DEFINED_LABEL_SEMANTICS_INSTRUCTION}`;
  const replacement = `INSTRUCTION: ${instructionForCondition(condition)}`;
  const occurrences = prompt.messages[1].content.split(currentInstruction).length - 1;
  if (occurrences !== 1) {
    throw new TypeError('P1-B2d가 frozen defined-label INSTRUCTION 경계를 정확히 찾지 못했습니다.');
  }
  prompt.messages[1].content = prompt.messages[1].content.replace(
    currentInstruction,
    replacement,
  );
  prompt.promptVersion = promptVersionForCondition(condition);
  return prompt;
}

function boundaryConfiguration(configuration, condition) {
  const promptVersion = promptVersionForCondition(condition);
  const identity = {
    ...configuration,
    version: BOUNDARY_CONFIGURATION_VERSION,
    runnerVersion: BOUNDARY_RUNNER_VERSION,
    promptVersion,
  };
  const digest = crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  return {
    ...configuration,
    configurationId: `p1b2d-${digest.slice(0, 24)}`,
    version: BOUNDARY_CONFIGURATION_VERSION,
    runnerVersion: BOUNDARY_RUNNER_VERSION,
    promptVersion,
  };
}

async function runBoundaryWrappedCase(pilotCase, metadata, runnerOptions, condition) {
  if (![CONDITIONS.B, CONDITIONS.C].includes(condition)) {
    throw new TypeError('P1-B2d wrapper는 Condition B/C에만 사용합니다.');
  }
  const conditionA = buildDefinedLabelSemanticsPrompt(pilotCase);
  const selected = buildConditionPrompt(pilotCase, condition);
  const delegateFetch = runnerOptions.fetchImpl || globalThis.fetch;
  let requestCount = 0;
  const fetchImpl = async (url, init) => {
    requestCount += 1;
    if (requestCount !== 1) {
      throw new Error(`P1-B2d ${condition}은 case당 한 번만 호출할 수 있습니다.`);
    }
    const body = JSON.parse(init.body);
    if (!isDeepStrictEqual(body.messages, conditionA.messages)) {
      throw new Error(`P1-B2d ${condition}이 frozen Condition A request에서 벗어났습니다.`);
    }
    return delegateFetch(url, {
      ...init,
      body: JSON.stringify({ ...body, messages: selected.messages }),
    });
  };
  const definedRun = await runDefinedLabelSemanticsCase(pilotCase, metadata, {
    ...runnerOptions,
    fetchImpl,
  });
  if (requestCount !== 1) {
    throw new Error(`P1-B2d ${condition} request가 정확히 한 번 실행되지 않았습니다.`);
  }
  const run = structuredClone(definedRun);
  run.result.configuration = boundaryConfiguration(run.result.configuration, condition);
  run.result.directResult.configurationId = run.result.configuration.configurationId;
  validatePilotResult(run.result);
  return run;
}

async function runConditionCase(pilotCase, metadata, runnerOptions, condition) {
  if (condition === CONDITIONS.A) {
    return runDefinedLabelSemanticsCase(pilotCase, metadata, runnerOptions);
  }
  return runBoundaryWrappedCase(pilotCase, metadata, runnerOptions, condition);
}

function actualBucket(run) {
  const direct = run.result.directResult;
  if (direct.taskOutcome === TASK_OUTCOMES.NOT_RUN) return 'RUNTIME_FAILURE';
  if (direct.schemaStatus !== SCHEMA_STATUSES.VALID) return 'INVALID';
  return direct.structuredOutput.decision;
}

function emptyConfusionMatrix() {
  return Object.fromEntries(LABELS.map(gold => [
    gold,
    Object.fromEntries(ACTUAL_BUCKETS.map(actual => [actual, 0])),
  ]));
}

function summarizeConditionRuns(runs) {
  const confusionMatrix = emptyConfusionMatrix();
  for (const run of runs) {
    confusionMatrix[run.calibration.screeningClass][actualBucket(run)] += 1;
  }
  return {
    totalCases: runs.length,
    schemaValidOutputs: runs.filter(run => (
      run.result.directResult.schemaStatus === SCHEMA_STATUSES.VALID
    )).length,
    invalidStructuredOutputs: runs.filter(run => (
      run.result.directResult.schemaStatus === SCHEMA_STATUSES.INVALID
    )).length,
    runtimeFailures: runs.filter(run => (
      run.result.directResult.taskOutcome === TASK_OUTCOMES.NOT_RUN
    )).length,
    exactMatches: runs.filter(run => run.semanticScoring.reasonCode === 'MATCH').length,
    mismatches: runs.filter(run => run.semanticScoring.reasonCode === 'MISMATCH').length,
    confusionMatrix,
    correctNoWrite: { numerator: confusionMatrix.NO_WRITE.NO_WRITE, denominator: 5 },
    correctWriteCandidate: {
      numerator: confusionMatrix.WRITE_CANDIDATE.WRITE_CANDIDATE,
      denominator: 5,
    },
    correctEscalate: { numerator: confusionMatrix.ESCALATE.ESCALATE, denominator: 5 },
    eligibleFalseNoWriteCount: runs.filter(run => (
      ['WRITE_CANDIDATE', 'ESCALATE'].includes(run.calibration.screeningClass)
      && actualBucket(run) === 'NO_WRITE'
    )).length,
  };
}

function summarizeTransitions(transitions) {
  const counts = {
    unchangedCorrect: 0,
    fixes: 0,
    regressions: 0,
    unchangedWrong: 0,
    nonComparable: 0,
  };
  const keys = {
    [PAIRED_TRANSITIONS.UNCHANGED_CORRECT]: 'unchangedCorrect',
    [PAIRED_TRANSITIONS.FIXED]: 'fixes',
    [PAIRED_TRANSITIONS.REGRESSION]: 'regressions',
    [PAIRED_TRANSITIONS.UNCHANGED_WRONG]: 'unchangedWrong',
    [PAIRED_TRANSITIONS.NONCOMPARABLE_RUNTIME_OR_SCHEMA]: 'nonComparable',
  };
  for (const transition of transitions) {
    if (!keys[transition]) throw new TypeError(`지원하지 않는 paired transition입니다: ${transition}`);
    counts[keys[transition]] += 1;
  }
  return counts;
}

function conditionObservation(run) {
  const direct = run.result.directResult;
  return {
    promptVersion: run.result.configuration.promptVersion,
    structuredOutput: direct.structuredOutput,
    schemaStatus: direct.schemaStatus,
    taskOutcome: direct.taskOutcome,
    semanticExactMatch: run.semanticScoring.reasonCode === 'MATCH'
      ? true
      : run.semanticScoring.reasonCode === 'MISMATCH' ? false : null,
    semanticScoring: run.semanticScoring,
    runtime: direct.runtime,
    error: direct.error,
    underlyingPilotResult: run.result,
  };
}

function validDecision(observation) {
  if (
    observation.schemaStatus !== SCHEMA_STATUSES.VALID
    || observation.taskOutcome === TASK_OUTCOMES.NOT_RUN
  ) return null;
  return observation.structuredOutput.decision;
}

function interpretDirectionalHypotheses(summaries, pairedSummaries, observations = []) {
  const a = summaries[CONDITIONS.A];
  const b = summaries[CONDITIONS.B];
  const c = summaries[CONDITIONS.C];
  const aToB = pairedSummaries.AtoB;
  const bToC = pairedSummaries.BtoC;
  const criticalCases = observations.filter(observation => (
    observation.humanGoldLabel === 'ESCALATE'
    && validDecision(observation.conditionA) === 'NO_WRITE'
    && validDecision(observation.conditionB) === 'ESCALATE'
  )).map(observation => observation.caseId);

  const ambiguityCriteria = {
    fixesExceedRegressions: aToB.fixes > aToB.regressions,
    correctEscalateIncreased: b.correctEscalate.numerator > a.correctEscalate.numerator,
    eligibleFalseNoWriteDidNotIncrease: (
      b.eligibleFalseNoWriteCount <= a.eligibleFalseNoWriteCount
    ),
  };
  const temporaryCriteria = {
    fixesExceedRegressions: bToC.fixes > bToC.regressions,
    correctNoWriteIncreased: b.correctNoWrite.numerator < c.correctNoWrite.numerator,
    correctWriteCandidateDidNotDecrease: (
      c.correctWriteCandidate.numerator >= b.correctWriteCandidate.numerator
    ),
    eligibleFalseNoWriteDidNotIncrease: (
      c.eligibleFalseNoWriteCount <= b.eligibleFalseNoWriteCount
    ),
  };
  return {
    ambiguityPrecedenceAtoB: {
      supported: Object.values(ambiguityCriteria).every(Boolean),
      criteria: ambiguityCriteria,
      criticalNoWriteToCorrectEscalate: {
        count: criticalCases.length,
        caseIds: criticalCases,
      },
      runtimeOrSchemaNoncomparables: aToB.nonComparable,
    },
    temporaryScopeBtoC: {
      supported: Object.values(temporaryCriteria).every(Boolean),
      criteria: temporaryCriteria,
      eligibleFalseNoWriteIncreaseIsNegative: (
        c.eligibleFalseNoWriteCount > b.eligibleFalseNoWriteCount
      ),
      runtimeOrSchemaNoncomparables: bToC.nonComparable,
    },
    interpretationBoundary: {
      candidatePromptOnly: true,
      requiresSeparateFreshValidation: true,
      productionValidated: false,
      rescuesP1B2c: false,
      authorizesComposition: false,
      authorizesDurableMemoryWrites: false,
    },
  };
}

function validateConfiguration(options) {
  for (const key of [
    'modelId', 'artifactId', 'modelSizeClass', 'quantization', 'runtimeVersion',
  ]) {
    if (options[key] !== FIXED_MODEL_CONFIGURATION[key]) {
      throw new Error(`P1-B2d ${key}는 고정 ~4B BF16 configuration과 일치해야 합니다.`);
    }
  }
  return options;
}

function deriveHealthUrl(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new TypeError('P1-B2d endpoint는 유효한 URL이어야 합니다.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new TypeError('P1-B2d endpoint는 credential/query/hash 없는 HTTP(S) URL이어야 합니다.');
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.at(-2) === 'chat' && segments.at(-1) === 'completions') {
    segments.splice(-2);
  }
  if (segments.at(-1) === 'v1') segments.pop();
  segments.push('health');
  url.pathname = `/${segments.join('/')}`;
  return url.toString();
}

function preflightFailure(reason, cause) {
  return new Error(
    `P1-B2d endpoint preflight failed: llama.cpp is unavailable or not ready. ${reason}`,
    cause ? { cause } : undefined,
  );
}

async function preflightLlamaCppEndpoint(endpoint, fetchImpl) {
  if (typeof fetchImpl !== 'function') {
    throw preflightFailure('fetch implementation is unavailable.');
  }
  const healthUrl = deriveHealthUrl(endpoint);
  const controller = new AbortController();
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new DOMException('llama.cpp health request timed out', 'AbortError'));
    }, PREFLIGHT_TIMEOUT_MS);
  });
  let response;
  try {
    response = await Promise.race([
      fetchImpl(healthUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      }),
      timeout,
    ]);
  } catch (error) {
    const reason = error?.name === 'AbortError'
      ? `health request timed out after ${PREFLIGHT_TIMEOUT_MS}ms.`
      : error?.message || 'health request failed.';
    throw preflightFailure(reason, error);
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response || response.status !== 200) {
    throw preflightFailure(`HTTP ${response?.status ?? 'unknown'}.`);
  }
  let health;
  try {
    health = await response.json();
  } catch (error) {
    throw preflightFailure('health response was not valid JSON.', error);
  }
  if (!isPlainObject(health) || health.status !== 'ok') {
    throw preflightFailure('health status was not "ok".');
  }
  return { healthUrl, status: health.status };
}

async function runBoundaryDiagnostic(fixture, runnerOptions) {
  validateBoundaryFixture(fixture);
  const review = loadHumanReview();
  const options = validateConfiguration({
    ...runnerOptions,
    runtimeFamily: FIXED_MODEL_CONFIGURATION.runtimeFamily,
    timeoutMs: FIXED_TIMEOUT_MS,
  });
  const delegateFetch = options.fetchImpl || globalThis.fetch;
  await preflightLlamaCppEndpoint(options.endpoint, delegateFetch);
  let callsAttempted = 0;
  const experimentalFetch = async (url, init) => {
    if (init?.method !== 'POST') {
      throw new Error('P1-B2d experimental request는 POST여야 합니다.');
    }
    callsAttempted += 1;
    if (callsAttempted > CALLS_PLANNED) {
      throw new Error(`P1-B2d unexpected extra call invariant 위반: ${callsAttempted}`);
    }
    return delegateFetch(url, init);
  };
  const experimentalOptions = { ...options, fetchImpl: experimentalFetch };
  const triplets = [];
  for (const pilotCase of fixture.cases) {
    const metadata = calibrationMetadataForCase(pilotCase);
    const conditionA = await runConditionCase(
      pilotCase, metadata, experimentalOptions, CONDITIONS.A,
    );
    const conditionB = await runConditionCase(
      pilotCase, metadata, experimentalOptions, CONDITIONS.B,
    );
    const conditionC = await runConditionCase(
      pilotCase, metadata, experimentalOptions, CONDITIONS.C,
    );
    triplets.push({ pilotCase, conditionA, conditionB, conditionC });
  }
  if (callsAttempted !== CALLS_PLANNED) {
    throw new Error(`P1-B2d callsAttempted invariant 위반: ${callsAttempted}`);
  }
  const conditionARuns = triplets.map(item => item.conditionA);
  const conditionBRuns = triplets.map(item => item.conditionB);
  const conditionCRuns = triplets.map(item => item.conditionC);
  const callsCompleted = [conditionARuns, conditionBRuns, conditionCRuns]
    .flat()
    .filter(run => run.result.directResult.taskOutcome !== TASK_OUTCOMES.NOT_RUN)
    .length;
  const observations = triplets.map(({ pilotCase, conditionA, conditionB, conditionC }) => ({
    caseId: pilotCase.caseId,
    humanGoldLabel: pilotCase.adjudication.primary.label,
    conditionA: conditionObservation(conditionA),
    conditionB: conditionObservation(conditionB),
    conditionC: conditionObservation(conditionC),
    pairedTransitionAtoB: pairedTransition(conditionA, conditionB),
    pairedTransitionBtoC: pairedTransition(conditionB, conditionC),
    pairedTransitionAtoC: pairedTransition(conditionA, conditionC),
  }));
  const summaries = {
    [CONDITIONS.A]: summarizeConditionRuns(conditionARuns),
    [CONDITIONS.B]: summarizeConditionRuns(conditionBRuns),
    [CONDITIONS.C]: summarizeConditionRuns(conditionCRuns),
  };
  const pairedSummaries = {
    AtoB: summarizeTransitions(observations.map(item => item.pairedTransitionAtoB)),
    BtoC: summarizeTransitions(observations.map(item => item.pairedTransitionBtoC)),
    AtoCDescriptive: summarizeTransitions(observations.map(item => item.pairedTransitionAtoC)),
  };
  return {
    reportVersion: BOUNDARY_REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    fixture: { name: fixture.name, sourceType: 'synthetic', cases: fixture.cases.length },
    humanGold: {
      protocolVersion: review.protocolVersion,
      candidateFixture: review.candidateFixture,
      completedAt: review.completedAt,
      labelsComplete: review.labels.length,
      distribution: LABEL_DISTRIBUTION,
    },
    provenance: {
      galpiCommit: options.commit,
      modelId: options.modelId,
      artifactId: options.artifactId,
      modelSizeClass: options.modelSizeClass,
      quantization: options.quantization,
      runtimeFamily: FIXED_MODEL_CONFIGURATION.runtimeFamily,
      runtimeVersion: options.runtimeVersion,
      boundaryRunnerVersion: BOUNDARY_RUNNER_VERSION,
      underlyingDefinedLabelExecutionRunnerVersion: DIAGNOSTIC_RUNNER_VERSION,
      configurationVersion: BOUNDARY_CONFIGURATION_VERSION,
      taskContractVersion: CASE_CONTRACT_VERSION,
      taskSpecificationVersion: TRIAGE_SPECIFICATION.taskSpecificationVersion,
      outputSchemaVersion: TRIAGE_SPECIFICATION.outputSchemaVersion,
      fixtureIdentity: fixture.name,
    },
    execution: {
      timeoutMs: FIXED_TIMEOUT_MS,
      callsPlanned: CALLS_PLANNED,
      callsAttempted,
      callsCompleted,
      order: 'case-local A->B->C',
      automaticReruns: false,
    },
    policyType: POLICY_TYPES.LOCAL_ONLY,
    conditions: {
      [CONDITIONS.A]: { promptVersion: DEFINED_LABELS_PROMPT_VERSION },
      [CONDITIONS.B]: { promptVersion: AMBIGUITY_PRECEDENCE_PROMPT_VERSION },
      [CONDITIONS.C]: { promptVersion: AMBIGUITY_TEMPORARY_PROMPT_VERSION },
    },
    observations,
    summaries,
    pairedSummaries,
    directionalInterpretation: interpretDirectionalHypotheses(
      summaries,
      pairedSummaries,
      observations,
    ),
  };
}

function exitCodeForReport(report) {
  if (
    report.reportVersion !== BOUNDARY_REPORT_VERSION
    || report.execution?.callsPlanned !== CALLS_PLANNED
    || report.execution?.callsAttempted !== CALLS_PLANNED
    || !Number.isInteger(report.execution?.callsCompleted)
    || report.execution.callsCompleted < 0
    || report.execution.callsCompleted > report.execution.callsAttempted
    || report.observations?.length !== FIXED_CASE_IDS.length
    || report.fixture?.name !== BOUNDARY_FIXTURE_NAME
    || !isPlainObject(report.summaries)
    || !isPlainObject(report.pairedSummaries)
    || !isPlainObject(report.directionalInterpretation)
  ) {
    throw new Error('P1-B2d complete report invariant가 충족되지 않았습니다.');
  }
  return 0;
}

function requiredValue(argv, index, optionName) {
  if (!argv[index + 1] || argv[index + 1].startsWith('--')) {
    throw new Error(`${optionName} 뒤에 값이 필요합니다.`);
  }
  return argv[index + 1];
}

function parseArguments(argv) {
  const options = {
    endpoint: null,
    modelId: null,
    artifactId: null,
    quantization: null,
    modelSizeClass: null,
    runtimeVersion: null,
    commit: null,
    help: false,
  };
  const names = {
    '--endpoint': 'endpoint',
    '--model': 'modelId',
    '--artifact': 'artifactId',
    '--quantization': 'quantization',
    '--model-size-class': 'modelSizeClass',
    '--runtime-version': 'runtimeVersion',
    '--commit': 'commit',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (Object.hasOwn(names, argument)) {
      options[names[argument]] = requiredValue(argv, index, argument);
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`알 수 없는 인자입니다: ${argument}`);
    }
  }
  if (!options.help) {
    for (const [argument, property] of Object.entries(names)) {
      if (argument !== '--commit' && !options[property]) {
        throw new Error(`${argument}이 필요합니다.`);
      }
    }
    validateConfiguration(options);
  }
  return options;
}

function helpText() {
  return [
    'Usage: npm run research:memory-inference-p1b2d-triage-boundary -- [options]',
    '',
    'Required:',
    '  --endpoint <url>          별도로 실행 중인 OpenAI-compatible base URL',
    `  --model ${FIXED_MODEL_CONFIGURATION.modelId}`,
    `  --artifact ${FIXED_MODEL_CONFIGURATION.artifactId}`,
    '  --quantization BF16',
    '  --model-size-class ~4B',
    `  --runtime-version ${FIXED_MODEL_CONFIGURATION.runtimeVersion}`,
    '',
    'Optional:',
    '  --commit <sha>            기본: 현재 Galpi git HEAD',
    '  -h, --help                도움말',
    '',
    '고정된 15개 case를 case-local A→B→C로 한 번씩 실행합니다.',
    'timeout은 180000ms이고 자동 재실행하지 않습니다.',
  ].join('\n');
}

function currentCommit() {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${helpText()}\n`);
    return 0;
  }
  const report = await runBoundaryDiagnostic(loadBoundaryFixture(), {
    ...options,
    commit: options.commit || currentCommit(),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return exitCodeForReport(report);
}

module.exports = {
  AMBIGUITY_PRECEDENCE_CLARIFICATION,
  AMBIGUITY_PRECEDENCE_INSTRUCTION,
  AMBIGUITY_PRECEDENCE_PROMPT_VERSION,
  AMBIGUITY_TEMPORARY_INSTRUCTION,
  AMBIGUITY_TEMPORARY_PROMPT_VERSION,
  BOUNDARY_CONFIGURATION_VERSION,
  BOUNDARY_FIXTURE_NAME,
  BOUNDARY_REPORT_VERSION,
  BOUNDARY_RUNNER_VERSION,
  CALLS_PLANNED,
  CONDITIONS,
  DEFAULT_FIXTURE,
  DEFAULT_HUMAN_REVIEW,
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
  instructionForCondition,
  interpretDirectionalHypotheses,
  loadBoundaryFixture,
  loadHumanReview,
  main,
  parseArguments,
  preflightLlamaCppEndpoint,
  runBoundaryDiagnostic,
  runBoundaryWrappedCase,
  runConditionCase,
  summarizeConditionRuns,
  summarizeTransitions,
  validateBoundaryFixture,
  validateConfiguration,
  validateHumanReview,
};

if (require.main === module) {
  main().then(
    exitCode => { process.exitCode = exitCode; },
    error => {
      console.error(`Memory inference P1-B2d diagnostic failed: ${error.message}`);
      process.exitCode = 1;
    },
  );
}
