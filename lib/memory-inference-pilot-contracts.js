'use strict';

const {
  GUARD_SCOPES,
  REASON_CODES,
  WORKLOAD_TYPES,
} = require('./memory-inference-pilot');

const CASE_CONTRACT_VERSION = 'xion-local-memory-inference-case-v1';
const RESULT_CONTRACT_VERSION = 'xion-local-memory-inference-result-v1';

const CASE_SOURCE_TYPES = Object.freeze({
  SYNTHETIC: 'synthetic',
  PRIVATE_NATURAL_REPLAY: 'private_natural_replay',
});

const ADJUDICATION_STATES = Object.freeze({
  UNADJUDICATED: 'UNADJUDICATED',
  PRIMARY_ADJUDICATED: 'PRIMARY_ADJUDICATED',
  AMBIGUOUS: 'AMBIGUOUS',
  ADJUDICATION_NEEDED: 'ADJUDICATION_NEEDED',
  RESOLVED_HUMAN: 'RESOLVED_HUMAN',
});

const DISAGREEMENT_STATES = Object.freeze({
  NOT_ASSESSED: 'NOT_ASSESSED',
  AGREEMENT: 'AGREEMENT',
  DISAGREEMENT: 'DISAGREEMENT',
});

const HARD_GATE_EXPECTATIONS = Object.freeze({
  APPLIES: 'APPLIES',
  DOES_NOT_APPLY: 'DOES_NOT_APPLY',
  UNKNOWN: 'UNKNOWN',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
});

const POLICY_TYPES = Object.freeze({
  DETERMINISTIC_CONTROL: 'DETERMINISTIC_CONTROL',
  LOCAL_ONLY: 'LOCAL_ONLY',
  CLOUD_ONLY: 'CLOUD_ONLY',
  LOCAL_FIRST: 'LOCAL_FIRST',
});

const EXECUTOR_TYPES = Object.freeze({
  DETERMINISTIC: 'DETERMINISTIC',
  LOCAL: 'LOCAL',
  CLOUD: 'CLOUD',
});

const SCHEMA_STATUSES = Object.freeze({
  VALID: 'VALID',
  INVALID: 'INVALID',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
});

const TASK_OUTCOMES = Object.freeze({
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  UNKNOWN: 'UNKNOWN',
  NOT_RUN: 'NOT_RUN',
});

const POLICY_OUTCOMES = Object.freeze({
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  UNKNOWN: 'UNKNOWN',
  NOT_RUN: 'NOT_RUN',
});

const ESCALATION_DECISIONS = Object.freeze({
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  NOT_ESCALATED: 'NOT_ESCALATED',
  ESCALATED: 'ESCALATED',
});

const ESCALATION_REASONS = Object.freeze({
  NONE: 'NONE',
  HARD_GATE: 'HARD_GATE',
  INVALID_STRUCTURED_OUTPUT: 'INVALID_STRUCTURED_OUTPUT',
  AMBIGUITY: 'AMBIGUITY',
  INSUFFICIENT_CONTEXT: 'INSUFFICIENT_CONTEXT',
  EVIDENCE_CONFLICT: 'EVIDENCE_CONFLICT',
  IDENTITY_AMBIGUITY: 'IDENTITY_AMBIGUITY',
  EXPLICIT_CORRECTION: 'EXPLICIT_CORRECTION',
  CORE_OR_HIGH_IMPACT: 'CORE_OR_HIGH_IMPACT',
  AUTHORITY_SENSITIVE: 'AUTHORITY_SENSITIVE',
  TASK_ABSTENTION: 'TASK_ABSTENTION',
  LOCAL_ERROR: 'LOCAL_ERROR',
});

const EXECUTION_MODES = Object.freeze({
  SYNCHRONOUS: 'SYNCHRONOUS',
  ASYNCHRONOUS: 'ASYNCHRONOUS',
});

const ERROR_STATES = Object.freeze({
  NONE: 'NONE',
  RUNNER_ERROR: 'RUNNER_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  TIMEOUT: 'TIMEOUT',
  UNAVAILABLE: 'UNAVAILABLE',
});

const CONTROL_STATUSES = Object.freeze({
  REGISTERED: 'REGISTERED',
  NONE_JUSTIFIED: 'NONE_JUSTIFIED',
});

const CONTROL_KINDS = Object.freeze({
  DETERMINISTIC: 'DETERMINISTIC',
  SPECIALIZED_NON_GENERATIVE: 'SPECIALIZED_NON_GENERATIVE',
});

const NONE_JUSTIFIED_REASONS = Object.freeze({
  NO_MEANINGFUL_NON_GENERATIVE_CONTROL: 'NO_MEANINGFUL_NON_GENERATIVE_CONTROL',
  EXISTING_LOGIC_IS_AUTHORITY_GATE: 'EXISTING_LOGIC_IS_AUTHORITY_GATE',
  TASK_REQUIRES_SEMANTIC_JUDGMENT: 'TASK_REQUIRES_SEMANTIC_JUDGMENT',
});

const WORKLOAD_VALUES = new Set(Object.values(WORKLOAD_TYPES));

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertObject(value, name) {
  if (!isPlainObject(value)) throw new TypeError(`${name} 객체가 필요합니다.`);
}

function assertExactKeys(value, allowed, name) {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new TypeError(`${name}에 허용되지 않은 필드가 있습니다: ${unknown.join(', ')}`);
  }
}

function assertEnum(value, enumObject, name) {
  if (!Object.values(enumObject).includes(value)) {
    throw new TypeError(`${name} 값이 지원되지 않습니다: ${value}`);
  }
}

function assertBoundedString(value, name, { min = 1, max = 160 } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    throw new TypeError(`${name}은 ${min}~${max}자 문자열이어야 합니다.`);
  }
}

function assertNullableBoundedString(value, name, options) {
  if (value === null) return;
  assertBoundedString(value, name, options);
}

function isJsonValue(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every(item => isJsonValue(item, seen))
    : isPlainObject(value)
      && Object.entries(value).every(([key, item]) => (
        typeof key === 'string' && isJsonValue(item, seen)
      ));
  seen.delete(value);
  return valid;
}

function assertJsonValue(value, name) {
  if (!isJsonValue(value)) {
    throw new TypeError(`${name}은 손실 없이 JSON으로 표현할 수 있어야 합니다.`);
  }
}

function validateAdjudication(value) {
  assertObject(value, 'adjudication');
  assertExactKeys(value, [
    'state',
    'primary',
    'blindSecondPass',
    'disagreementState',
    'finalResolvedHumanLabel',
    'cloudAssistedReview',
  ], 'adjudication');
  assertEnum(value.state, ADJUDICATION_STATES, 'adjudication.state');
  assertEnum(value.disagreementState, DISAGREEMENT_STATES, 'disagreementState');

  if (value.primary !== null) {
    assertObject(value.primary, 'adjudication.primary');
    assertExactKeys(value.primary, ['source', 'label'], 'adjudication.primary');
    if (!['HUMAN', 'PROGRAMMATIC'].includes(value.primary.source)) {
      throw new TypeError('primary source는 HUMAN 또는 PROGRAMMATIC이어야 합니다.');
    }
    assertJsonValue(value.primary.label, 'primary label');
  }
  if (value.blindSecondPass !== null) {
    assertObject(value.blindSecondPass, 'adjudication.blindSecondPass');
    assertExactKeys(value.blindSecondPass, ['label'], 'adjudication.blindSecondPass');
    assertJsonValue(value.blindSecondPass.label, 'blind second-pass label');
  }
  if (value.finalResolvedHumanLabel !== null) {
    assertJsonValue(value.finalResolvedHumanLabel, 'final resolved human label');
  }
  assertObject(value.cloudAssistedReview, 'cloudAssistedReview');
  assertExactKeys(
    value.cloudAssistedReview,
    ['performed', 'configurationId', 'suggestion'],
    'cloudAssistedReview',
  );
  if (typeof value.cloudAssistedReview.performed !== 'boolean') {
    throw new TypeError('cloudAssistedReview.performed는 boolean이어야 합니다.');
  }
  assertNullableBoundedString(
    value.cloudAssistedReview.configurationId,
    'cloud review configurationId',
  );
  if (value.cloudAssistedReview.suggestion !== null) {
    assertJsonValue(value.cloudAssistedReview.suggestion, 'cloud review suggestion');
  }
  if (!value.cloudAssistedReview.performed && (
    value.cloudAssistedReview.configurationId !== null
    || value.cloudAssistedReview.suggestion !== null
  )) {
    throw new TypeError('수행하지 않은 cloud review에는 configuration이나 suggestion이 없어야 합니다.');
  }
  if (value.cloudAssistedReview.performed && value.cloudAssistedReview.configurationId === null) {
    throw new TypeError('수행한 cloud review에는 configurationId가 필요합니다.');
  }

  if (value.state === ADJUDICATION_STATES.UNADJUDICATED && value.primary !== null) {
    throw new TypeError('UNADJUDICATED case에는 primary adjudication이 없어야 합니다.');
  }
  if (value.state === ADJUDICATION_STATES.PRIMARY_ADJUDICATED && value.primary === null) {
    throw new TypeError('PRIMARY_ADJUDICATED case에는 primary adjudication이 필요합니다.');
  }
  if (
    value.state === ADJUDICATION_STATES.RESOLVED_HUMAN
    && value.finalResolvedHumanLabel === null
  ) {
    throw new TypeError('RESOLVED_HUMAN case에는 final human label이 필요합니다.');
  }
  if (
    value.state !== ADJUDICATION_STATES.RESOLVED_HUMAN
    && value.finalResolvedHumanLabel !== null
  ) {
    throw new TypeError('final human label은 RESOLVED_HUMAN state에서만 허용됩니다.');
  }
  return value;
}

function validateHardGateExpectation(value) {
  assertObject(value, 'hardGateExpectation');
  assertExactKeys(value, ['status', 'guardScope', 'reasonCode'], 'hardGateExpectation');
  assertEnum(value.status, HARD_GATE_EXPECTATIONS, 'hardGateExpectation.status');
  assertEnum(value.guardScope, GUARD_SCOPES, 'hardGateExpectation.guardScope');
  assertEnum(value.reasonCode, REASON_CODES, 'hardGateExpectation.reasonCode');
  if (value.status === HARD_GATE_EXPECTATIONS.APPLIES) {
    if (value.guardScope === GUARD_SCOPES.NONE || value.reasonCode === REASON_CODES.NONE) {
      throw new TypeError('APPLIES expectation에는 guard scope와 reason code가 필요합니다.');
    }
    if (
      value.guardScope === GUARD_SCOPES.CURRENT_PRODUCTION_ELIGIBILITY
      && ![
        REASON_CODES.CURRENT_VOICE_AUTO_SAVE_DISABLED,
        REASON_CODES.CURRENT_SCHEDULE_CANDIDATE,
        REASON_CODES.CURRENT_TEMPORARY_ATTACHMENT_CONTEXT,
      ].includes(value.reasonCode)
    ) {
      throw new TypeError('current production hard-gate expectation reason이 맞지 않습니다.');
    }
    if (
      value.guardScope === GUARD_SCOPES.CONTRACT_LEVEL
      && ![
        REASON_CODES.CONTRACT_EXPLICIT_CORRECTION,
        REASON_CODES.CONTRACT_IDENTITY_AMBIGUITY,
        REASON_CODES.CONTRACT_CORE_OR_HIGH_IMPACT,
        REASON_CODES.CONTRACT_AUTHORITY_SENSITIVE,
      ].includes(value.reasonCode)
    ) {
      throw new TypeError('contract-level hard-gate expectation reason이 맞지 않습니다.');
    }
  } else if (value.guardScope !== GUARD_SCOPES.NONE || value.reasonCode !== REASON_CODES.NONE) {
    throw new TypeError('APPLIES가 아니면 hard-gate scope와 reason은 none이어야 합니다.');
  }
  return value;
}

function validatePilotCase(value) {
  assertObject(value, 'pilot case');
  assertExactKeys(value, [
    'caseId',
    'workloadType',
    'sourceType',
    'taskContractVersion',
    'inputPayload',
    'adjudication',
    'ambiguityState',
    'hardGateExpectation',
  ], 'pilot case');
  assertBoundedString(value.caseId, 'caseId', { max: 120 });
  if (!/^[A-Za-z0-9._:-]+$/u.test(value.caseId)) {
    throw new TypeError('caseId는 안정적인 ASCII 식별자여야 합니다.');
  }
  if (!WORKLOAD_VALUES.has(value.workloadType)) {
    throw new TypeError(`지원하지 않는 workloadType입니다: ${value.workloadType}`);
  }
  assertEnum(value.sourceType, CASE_SOURCE_TYPES, 'sourceType');
  if (value.taskContractVersion !== CASE_CONTRACT_VERSION) {
    throw new TypeError(`지원하지 않는 task contract version입니다: ${value.taskContractVersion}`);
  }
  if (!isPlainObject(value.inputPayload)) {
    throw new TypeError('inputPayload는 JSON object여야 합니다.');
  }
  assertJsonValue(value.inputPayload, 'inputPayload');
  validateAdjudication(value.adjudication);
  if (!['CLEAR', 'AMBIGUOUS', 'ADJUDICATION_NEEDED'].includes(value.ambiguityState)) {
    throw new TypeError(`지원하지 않는 ambiguityState입니다: ${value.ambiguityState}`);
  }
  validateHardGateExpectation(value.hardGateExpectation);
  return value;
}

function validateTrackedPilotFixture(cases) {
  if (!Array.isArray(cases)) throw new TypeError('tracked fixture cases 배열이 필요합니다.');
  for (const item of cases) {
    validatePilotCase(item);
    if (item.sourceType !== CASE_SOURCE_TYPES.SYNTHETIC) {
      throw new TypeError('repository-tracked pilot fixture에는 synthetic case만 허용됩니다.');
    }
  }
  return cases;
}

function validateRuntime(value) {
  assertObject(value, 'runtime');
  assertExactKeys(value, [
    'executionMode',
    'endToEndLatencyMs',
    'queueWaitMs',
    'timeToCompletionMs',
    'throughputPerMinute',
    'deadlineMet',
    'backlogBefore',
    'backlogAfter',
  ], 'runtime');
  assertEnum(value.executionMode, EXECUTION_MODES, 'runtime.executionMode');
  for (const key of [
    'endToEndLatencyMs',
    'queueWaitMs',
    'timeToCompletionMs',
    'throughputPerMinute',
    'backlogBefore',
    'backlogAfter',
  ]) {
    if (value[key] !== null && (!Number.isFinite(value[key]) || value[key] < 0)) {
      throw new TypeError(`runtime.${key}는 null 또는 0 이상의 숫자여야 합니다.`);
    }
  }
  if (value.deadlineMet !== null && typeof value.deadlineMet !== 'boolean') {
    throw new TypeError('runtime.deadlineMet는 null 또는 boolean이어야 합니다.');
  }
  return value;
}

function validateError(value, name = 'error') {
  assertObject(value, name);
  assertExactKeys(value, ['state', 'code'], name);
  assertEnum(value.state, ERROR_STATES, `${name}.state`);
  assertNullableBoundedString(value.code, `${name}.code`, { max: 80 });
  if (value.state === ERROR_STATES.NONE && value.code !== null) {
    throw new TypeError(`${name}.code는 state=NONE일 때 null이어야 합니다.`);
  }
  if (value.state !== ERROR_STATES.NONE && value.code === null) {
    throw new TypeError(`${name}.code는 오류 state에서 필요합니다.`);
  }
  return value;
}

function validateTaskResult(value, name = 'directResult') {
  assertObject(value, name);
  assertExactKeys(value, [
    'executorType',
    'configurationId',
    'structuredOutput',
    'schemaStatus',
    'taskOutcome',
    'runtime',
    'error',
  ], name);
  assertEnum(value.executorType, EXECUTOR_TYPES, `${name}.executorType`);
  assertBoundedString(value.configurationId, `${name}.configurationId`);
  if (value.structuredOutput !== null) assertJsonValue(value.structuredOutput, `${name}.structuredOutput`);
  assertEnum(value.schemaStatus, SCHEMA_STATUSES, `${name}.schemaStatus`);
  assertEnum(value.taskOutcome, TASK_OUTCOMES, `${name}.taskOutcome`);
  validateRuntime(value.runtime);
  validateError(value.error, `${name}.error`);
  if (value.schemaStatus === SCHEMA_STATUSES.INVALID && value.taskOutcome !== TASK_OUTCOMES.FAILURE) {
    throw new TypeError('invalid structured output의 direct taskOutcome은 FAILURE여야 합니다.');
  }
  return value;
}

function validatePilotResult(value) {
  assertObject(value, 'pilot result');
  assertExactKeys(value, [
    'contractVersion',
    'caseId',
    'workloadType',
    'policyType',
    'configuration',
    'directResult',
    'escalation',
    'policyOutcome',
    'error',
  ], 'pilot result');
  if (value.contractVersion !== RESULT_CONTRACT_VERSION) {
    throw new TypeError(`지원하지 않는 result contract version입니다: ${value.contractVersion}`);
  }
  assertBoundedString(value.caseId, 'caseId', { max: 120 });
  if (!WORKLOAD_VALUES.has(value.workloadType)) {
    throw new TypeError(`지원하지 않는 workloadType입니다: ${value.workloadType}`);
  }
  assertEnum(value.policyType, POLICY_TYPES, 'policyType');
  assertObject(value.configuration, 'configuration');
  assertExactKeys(
    value.configuration,
    ['configurationId', 'version', 'runtimeVersion', 'commit'],
    'configuration',
  );
  assertBoundedString(value.configuration.configurationId, 'configurationId');
  assertBoundedString(value.configuration.version, 'configuration.version');
  assertNullableBoundedString(value.configuration.runtimeVersion, 'configuration.runtimeVersion');
  assertNullableBoundedString(value.configuration.commit, 'configuration.commit', { max: 64 });
  validateTaskResult(value.directResult);
  const expectedExecutor = {
    [POLICY_TYPES.DETERMINISTIC_CONTROL]: EXECUTOR_TYPES.DETERMINISTIC,
    [POLICY_TYPES.LOCAL_ONLY]: EXECUTOR_TYPES.LOCAL,
    [POLICY_TYPES.CLOUD_ONLY]: EXECUTOR_TYPES.CLOUD,
    [POLICY_TYPES.LOCAL_FIRST]: EXECUTOR_TYPES.LOCAL,
  }[value.policyType];
  if (value.directResult.executorType !== expectedExecutor) {
    throw new TypeError('policyType과 direct executor가 맞지 않습니다.');
  }
  assertObject(value.escalation, 'escalation');
  assertExactKeys(value.escalation, ['decision', 'reasonCode', 'result'], 'escalation');
  assertEnum(value.escalation.decision, ESCALATION_DECISIONS, 'escalation.decision');
  assertEnum(value.escalation.reasonCode, ESCALATION_REASONS, 'escalation.reasonCode');
  if (value.escalation.decision === ESCALATION_DECISIONS.ESCALATED) {
    if (value.policyType !== POLICY_TYPES.LOCAL_FIRST) {
      throw new TypeError('cloud escalation은 LOCAL_FIRST policy에서만 허용됩니다.');
    }
    if (!value.escalation.result) throw new TypeError('ESCALATED result가 필요합니다.');
    validateTaskResult(value.escalation.result, 'escalation.result');
    if (value.escalation.result.executorType !== EXECUTOR_TYPES.CLOUD) {
      throw new TypeError('pilot escalation result는 CLOUD executor여야 합니다.');
    }
    if (value.escalation.reasonCode === ESCALATION_REASONS.NONE) {
      throw new TypeError('ESCALATED에는 escalation reason이 필요합니다.');
    }
  } else {
    if (value.escalation.result !== null) throw new TypeError('미실행 escalation result는 null이어야 합니다.');
    if (value.escalation.reasonCode !== ESCALATION_REASONS.NONE) {
      throw new TypeError('미실행 escalation reason은 NONE이어야 합니다.');
    }
  }
  assertEnum(value.policyOutcome, POLICY_OUTCOMES, 'policyOutcome');
  if (value.policyType !== POLICY_TYPES.LOCAL_FIRST) {
    if (value.policyOutcome !== POLICY_OUTCOMES.NOT_RUN) {
      throw new TypeError('LOCAL_FIRST가 아닌 runner의 policyOutcome은 NOT_RUN이어야 합니다.');
    }
    if (value.escalation.decision !== ESCALATION_DECISIONS.NOT_APPLICABLE) {
      throw new TypeError('LOCAL_FIRST가 아닌 runner의 escalation은 NOT_APPLICABLE이어야 합니다.');
    }
  } else {
    if (value.policyOutcome === POLICY_OUTCOMES.NOT_RUN) {
      throw new TypeError('실행된 LOCAL_FIRST의 policyOutcome은 NOT_RUN일 수 없습니다.');
    }
    if (
      value.escalation.decision !== ESCALATION_DECISIONS.NOT_ESCALATED
      && value.escalation.decision !== ESCALATION_DECISIONS.ESCALATED
    ) {
      throw new TypeError('LOCAL_FIRST는 NOT_ESCALATED local completion 또는 ESCALATED여야 합니다.');
    }
    if (
      value.escalation.decision === ESCALATION_DECISIONS.NOT_ESCALATED
      && value.policyOutcome === POLICY_OUTCOMES.SUCCESS
      && value.directResult.taskOutcome !== TASK_OUTCOMES.SUCCESS
    ) {
      throw new TypeError('성공한 LOCAL_FIRST local completion에는 direct taskOutcome=SUCCESS가 필요합니다.');
    }
  }
  validateError(value.error, 'pilot result error');
  return value;
}

function validateControlDefinition(value) {
  assertObject(value, 'control definition');
  assertExactKeys(value, [
    'workloadType',
    'status',
    'controlId',
    'kind',
    'version',
    'reasonCode',
    'reason',
  ], 'control definition');
  if (!WORKLOAD_VALUES.has(value.workloadType)) {
    throw new TypeError(`지원하지 않는 workloadType입니다: ${value.workloadType}`);
  }
  assertEnum(value.status, CONTROL_STATUSES, 'control status');
  if (value.status === CONTROL_STATUSES.REGISTERED) {
    assertBoundedString(value.controlId, 'controlId');
    assertEnum(value.kind, CONTROL_KINDS, 'control kind');
    assertBoundedString(value.version, 'control version');
    if (value.reasonCode !== null || value.reason !== null) {
      throw new TypeError('REGISTERED control에는 NONE_JUSTIFIED reason이 없어야 합니다.');
    }
  } else {
    if (value.controlId !== null || value.kind !== null || value.version !== null) {
      throw new TypeError('NONE_JUSTIFIED control에는 runner identity가 없어야 합니다.');
    }
    assertEnum(value.reasonCode, NONE_JUSTIFIED_REASONS, 'NONE_JUSTIFIED reasonCode');
    assertBoundedString(value.reason, 'NONE_JUSTIFIED reason', { max: 240 });
  }
  return value;
}

function createControlRegistry(definitions) {
  if (!Array.isArray(definitions)) throw new TypeError('control definitions 배열이 필요합니다.');
  const registry = new Map();
  for (const definition of definitions) {
    validateControlDefinition(definition);
    if (registry.has(definition.workloadType)) {
      throw new TypeError(`중복 control definition입니다: ${definition.workloadType}`);
    }
    registry.set(definition.workloadType, Object.freeze({ ...definition }));
  }
  for (const workloadType of WORKLOAD_VALUES) {
    if (!registry.has(workloadType)) {
      throw new TypeError(`control definition이 없습니다: ${workloadType}`);
    }
  }
  return registry;
}

module.exports = {
  ADJUDICATION_STATES,
  CASE_CONTRACT_VERSION,
  CASE_SOURCE_TYPES,
  CONTROL_KINDS,
  CONTROL_STATUSES,
  DISAGREEMENT_STATES,
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
  validateControlDefinition,
  validatePilotCase,
  validatePilotResult,
  validateTrackedPilotFixture,
};
