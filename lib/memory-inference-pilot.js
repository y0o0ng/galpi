'use strict';

const { sha256 } = require('./content-hash');

const LEDGER_SCHEMA_VERSION = 1;
const INSTRUMENTATION_VERSION = 'xion-local-memory-inference-p0-v1';

const WORKLOAD_TYPES = Object.freeze({
  STRUCTURED_EXTRACTION: 'structured_extraction',
  WRITE_CANDIDATE_TRIAGE: 'write_candidate_triage',
  AMBIGUITY_ESCALATION: 'ambiguity_escalation',
});

const GUARD_SCOPES = Object.freeze({
  NONE: 'none',
  CONTRACT_LEVEL: 'contract_level',
  CURRENT_PRODUCTION_ELIGIBILITY: 'current_production_eligibility',
});

const REASON_CODES = Object.freeze({
  NONE: 'none',
  CURRENT_VOICE_AUTO_SAVE_DISABLED: 'current_voice_auto_save_disabled',
  CURRENT_SCHEDULE_CANDIDATE: 'current_schedule_candidate',
  CURRENT_TEMPORARY_ATTACHMENT_CONTEXT: 'current_temporary_attachment_context',
  CONTRACT_EXPLICIT_CORRECTION: 'contract_explicit_correction',
  CONTRACT_IDENTITY_AMBIGUITY: 'contract_identity_ambiguity',
  CONTRACT_CORE_OR_HIGH_IMPACT: 'contract_core_or_high_impact',
  CONTRACT_AUTHORITY_SENSITIVE: 'contract_authority_sensitive',
});

const WORKLOAD_VALUES = new Set(Object.values(WORKLOAD_TYPES));
const GUARD_SCOPE_VALUES = new Set(Object.values(GUARD_SCOPES));
const REASON_CODE_VALUES = new Set(Object.values(REASON_CODES));
const CURRENT_GUARD_REASONS = new Set([
  REASON_CODES.CURRENT_VOICE_AUTO_SAVE_DISABLED,
  REASON_CODES.CURRENT_SCHEDULE_CANDIDATE,
  REASON_CODES.CURRENT_TEMPORARY_ATTACHMENT_CONTEXT,
]);
const CONTRACT_GUARD_REASONS = new Set([
  REASON_CODES.CONTRACT_EXPLICIT_CORRECTION,
  REASON_CODES.CONTRACT_IDENTITY_AMBIGUITY,
  REASON_CODES.CONTRACT_CORE_OR_HIGH_IMPACT,
  REASON_CODES.CONTRACT_AUTHORITY_SENSITIVE,
]);

function assertPlainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} 객체가 필요합니다.`);
  }
}

function assertExactKeys(value, allowed, name) {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new TypeError(`${name}에 허용되지 않은 필드가 있습니다: ${unknown.join(', ')}`);
  }
}

function assertBoolean(value, name) {
  if (typeof value !== 'boolean') throw new TypeError(`${name}은 boolean이어야 합니다.`);
}

function assertSha256(value, name) {
  if (!/^[a-f0-9]{64}$/u.test(String(value || ''))) {
    throw new TypeError(`${name}은 SHA-256 hex여야 합니다.`);
  }
}

function hashSourceEvent({ sessionId, userMessageId, assistantMessageId } = {}) {
  const session = String(sessionId || '').trim();
  if (!session || session.length > 200) throw new TypeError('sessionId가 필요합니다.');
  if (!Number.isSafeInteger(userMessageId) || userMessageId < 1) {
    throw new TypeError('userMessageId는 양의 정수여야 합니다.');
  }
  if (!Number.isSafeInteger(assistantMessageId) || assistantMessageId < 1) {
    throw new TypeError('assistantMessageId는 양의 정수여야 합니다.');
  }
  return sha256([
    'xion-local-memory-inference-source-v1',
    session,
    userMessageId,
    assistantMessageId,
  ].join('\u0000'));
}

function validateObservation(input) {
  assertPlainObject(input, 'observation');
  assertExactKeys(input, [
    'workloadType',
    'occurredAt',
    'opportunity',
    'hardGated',
    'localEligible',
    'executed',
    'sourceEventSha256',
    'guardScope',
    'reasonCode',
  ], 'observation');

  if (!WORKLOAD_VALUES.has(input.workloadType)) {
    throw new TypeError(`지원하지 않는 workloadType입니다: ${input.workloadType}`);
  }
  if (!Number.isSafeInteger(input.occurredAt) || input.occurredAt < 0) {
    throw new TypeError('occurredAt은 epoch seconds 정수여야 합니다.');
  }
  assertBoolean(input.opportunity, 'opportunity');
  assertBoolean(input.hardGated, 'hardGated');
  assertBoolean(input.localEligible, 'localEligible');
  assertBoolean(input.executed, 'executed');
  assertSha256(input.sourceEventSha256, 'sourceEventSha256');
  if (!GUARD_SCOPE_VALUES.has(input.guardScope)) {
    throw new TypeError(`지원하지 않는 guardScope입니다: ${input.guardScope}`);
  }
  if (!REASON_CODE_VALUES.has(input.reasonCode)) {
    throw new TypeError(`지원하지 않는 reasonCode입니다: ${input.reasonCode}`);
  }

  if (input.hardGated) {
    if (!input.opportunity || input.localEligible) {
      throw new TypeError('hard-gated observation은 opportunity이며 local-eligible일 수 없습니다.');
    }
    if (input.guardScope === GUARD_SCOPES.NONE || input.reasonCode === REASON_CODES.NONE) {
      throw new TypeError('hard-gated observation에는 guard scope와 reason code가 필요합니다.');
    }
    if (
      input.guardScope === GUARD_SCOPES.CURRENT_PRODUCTION_ELIGIBILITY
      && !CURRENT_GUARD_REASONS.has(input.reasonCode)
    ) {
      throw new TypeError('current production guard scope와 reason code가 맞지 않습니다.');
    }
    if (
      input.guardScope === GUARD_SCOPES.CONTRACT_LEVEL
      && !CONTRACT_GUARD_REASONS.has(input.reasonCode)
    ) {
      throw new TypeError('contract-level guard scope와 reason code가 맞지 않습니다.');
    }
  } else if (input.guardScope !== GUARD_SCOPES.NONE) {
    throw new TypeError('hard-gated가 아니면 guardScope는 none이어야 합니다.');
  }

  if (input.localEligible && (!input.opportunity || input.hardGated)) {
    throw new TypeError('local-eligible은 hard gate를 통과한 opportunity여야 합니다.');
  }
  if (!input.opportunity && input.localEligible) {
    throw new TypeError('opportunity가 아니면 local-eligible일 수 없습니다.');
  }
  if (
    !input.hardGated
    && input.reasonCode !== REASON_CODES.NONE
  ) {
    throw new TypeError('hard-gated가 아닌 observation의 reason code가 올바르지 않습니다.');
  }
  return input;
}

function persistedObservation(input) {
  const value = validateObservation(input);
  return {
    observationId: sha256([
      INSTRUMENTATION_VERSION,
      value.sourceEventSha256,
      value.workloadType,
    ].join('\u0000')),
    workloadType: value.workloadType,
    occurredAt: value.occurredAt,
    opportunity: Number(value.opportunity),
    hardGated: Number(value.hardGated),
    localEligible: Number(value.localEligible),
    executed: Number(value.executed),
    sourceEventSha256: value.sourceEventSha256,
    ledgerSchemaVersion: LEDGER_SCHEMA_VERSION,
    instrumentationVersion: INSTRUMENTATION_VERSION,
    guardScope: value.guardScope,
    reasonCode: value.reasonCode,
  };
}

function createObservationRecorder({ insertObservation, onRecordError = () => {} } = {}) {
  if (typeof insertObservation !== 'function') {
    throw new TypeError('observation 저장 함수가 필요합니다.');
  }

  function record(input) {
    try {
      insertObservation(persistedObservation(input));
      return true;
    } catch (error) {
      try { onRecordError(error); } catch { /* telemetry error handling is fail-open */ }
      return false;
    }
  }

  function recordMany(inputs) {
    return (Array.isArray(inputs) ? inputs : []).map(record);
  }

  return { record, recordMany };
}

function baseObservation({ workloadType, sourceEventSha256, occurredAt }) {
  return {
    workloadType,
    sourceEventSha256,
    occurredAt,
    executed: false,
  };
}

function candidateBoundaryObservations({
  sourceEventSha256,
  occurredAt,
  currentGuardReason = REASON_CODES.NONE,
} = {}) {
  assertSha256(sourceEventSha256, 'sourceEventSha256');
  if (!Number.isSafeInteger(occurredAt) || occurredAt < 0) {
    throw new TypeError('occurredAt은 epoch seconds 정수여야 합니다.');
  }
  if (currentGuardReason !== REASON_CODES.NONE && !CURRENT_GUARD_REASONS.has(currentGuardReason)) {
    throw new TypeError(`지원하지 않는 current production guard입니다: ${currentGuardReason}`);
  }

  if (currentGuardReason !== REASON_CODES.NONE) {
    return [
      WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE,
      WORKLOAD_TYPES.AMBIGUITY_ESCALATION,
    ].map(workloadType => ({
      ...baseObservation({ workloadType, sourceEventSha256, occurredAt }),
      opportunity: true,
      hardGated: true,
      localEligible: false,
      guardScope: GUARD_SCOPES.CURRENT_PRODUCTION_ELIGIBILITY,
      reasonCode: currentGuardReason,
    }));
  }

  return [
    WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE,
    WORKLOAD_TYPES.AMBIGUITY_ESCALATION,
  ].map(workloadType => ({
    ...baseObservation({ workloadType, sourceEventSha256, occurredAt }),
    opportunity: true,
    hardGated: false,
    localEligible: true,
    guardScope: GUARD_SCOPES.NONE,
    reasonCode: REASON_CODES.NONE,
  }));
}

function structuredExtractionObservation({
  sourceEventSha256,
  occurredAt,
} = {}) {
  return {
    ...baseObservation({
      workloadType: WORKLOAD_TYPES.STRUCTURED_EXTRACTION,
      sourceEventSha256,
      occurredAt,
    }),
    opportunity: true,
    hardGated: false,
    localEligible: true,
    guardScope: GUARD_SCOPES.NONE,
    reasonCode: REASON_CODES.NONE,
  };
}

module.exports = {
  GUARD_SCOPES,
  INSTRUMENTATION_VERSION,
  LEDGER_SCHEMA_VERSION,
  REASON_CODES,
  WORKLOAD_TYPES,
  candidateBoundaryObservations,
  createObservationRecorder,
  hashSourceEvent,
  persistedObservation,
  structuredExtractionObservation,
  validateObservation,
};
