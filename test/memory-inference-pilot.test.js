'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { migrations } = require('../lib/database-migrations');
const {
  GUARD_SCOPES,
  REASON_CODES,
  WORKLOAD_TYPES,
  candidateBoundaryObservations,
  createObservationRecorder,
  hashSourceEvent,
  persistedObservation,
  structuredExtractionObservation,
} = require('../lib/memory-inference-pilot');
const {
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
  validatePilotCase,
  validatePilotResult,
  validateTrackedPilotFixture,
} = require('../lib/memory-inference-pilot-contracts');
const {
  COVERAGE_STATUSES,
  buildMemoryInferencePilotReport,
  formatMemoryInferencePilotReport,
} = require('../lib/memory-inference-pilot-report');
const {
  helpText,
  parseArguments,
  parseKstDate,
} = require('../scripts/report-memory-inference-pilot');

const ROOT = path.resolve(__dirname, '..');

function createLedgerDatabase() {
  const db = new Database(':memory:');
  migrations.find(migration => migration.version === 24).up(db);
  return db;
}

function insertObservationStatement(db) {
  return db.prepare(`
    INSERT INTO research_memory_inference_observations (
      observation_id, workload_type, occurred_at,
      opportunity, hard_gated, local_eligible, executed,
      source_event_sha256, ledger_schema_version, instrumentation_version,
      guard_scope, reason_code
    ) VALUES (
      @observationId, @workloadType, @occurredAt,
      @opportunity, @hardGated, @localEligible, @executed,
      @sourceEventSha256, @ledgerSchemaVersion, @instrumentationVersion,
      @guardScope, @reasonCode
    )
    ON CONFLICT(observation_id) DO NOTHING
  `);
}

function sourceHash(index = 1) {
  return hashSourceEvent({
    sessionId: `synthetic-session-${index}`,
    userMessageId: index * 2 - 1,
    assistantMessageId: index * 2,
  });
}

function eligibleObservation(overrides = {}) {
  return {
    workloadType: WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE,
    occurredAt: parseKstDate('2026-09-01', 'date') + 60,
    opportunity: true,
    hardGated: false,
    localEligible: true,
    executed: false,
    sourceEventSha256: sourceHash(),
    guardScope: GUARD_SCOPES.NONE,
    reasonCode: REASON_CODES.NONE,
    ...overrides,
  };
}

function baseAdjudication(overrides = {}) {
  return {
    state: ADJUDICATION_STATES.UNADJUDICATED,
    primary: null,
    blindSecondPass: null,
    disagreementState: DISAGREEMENT_STATES.NOT_ASSESSED,
    finalResolvedHumanLabel: null,
    cloudAssistedReview: {
      performed: false,
      configurationId: null,
      suggestion: null,
    },
    ...overrides,
  };
}

function baseCase(overrides = {}) {
  return {
    caseId: 'synthetic-case-001',
    workloadType: WORKLOAD_TYPES.STRUCTURED_EXTRACTION,
    sourceType: CASE_SOURCE_TYPES.SYNTHETIC,
    taskContractVersion: CASE_CONTRACT_VERSION,
    inputPayload: { evidence: '합성 evidence' },
    adjudication: baseAdjudication(),
    ambiguityState: 'CLEAR',
    hardGateExpectation: {
      status: HARD_GATE_EXPECTATIONS.DOES_NOT_APPLY,
      guardScope: GUARD_SCOPES.NONE,
      reasonCode: REASON_CODES.NONE,
    },
    ...overrides,
  };
}

function runtime(overrides = {}) {
  return {
    executionMode: EXECUTION_MODES.SYNCHRONOUS,
    endToEndLatencyMs: 12,
    queueWaitMs: null,
    timeToCompletionMs: 12,
    throughputPerMinute: null,
    deadlineMet: null,
    backlogBefore: null,
    backlogAfter: null,
    ...overrides,
  };
}

function taskResult(executorType, overrides = {}) {
  return {
    executorType,
    configurationId: `${executorType.toLowerCase()}-v1`,
    structuredOutput: { decision: 'WRITE' },
    schemaStatus: SCHEMA_STATUSES.VALID,
    taskOutcome: TASK_OUTCOMES.SUCCESS,
    runtime: runtime(),
    error: { state: ERROR_STATES.NONE, code: null },
    ...overrides,
  };
}

function pilotResult(policyType, executorType, overrides = {}) {
  const localFirst = policyType === POLICY_TYPES.LOCAL_FIRST;
  return {
    contractVersion: RESULT_CONTRACT_VERSION,
    caseId: 'synthetic-case-001',
    workloadType: WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE,
    policyType,
    configuration: {
      configurationId: `${policyType.toLowerCase()}-policy`,
      version: 'v1',
      runnerVersion: 'runner-v1',
      runtimeFamily: 'synthetic-runtime',
      runtimeVersion: 'runtime-v1',
      modelId: executorType === EXECUTOR_TYPES.DETERMINISTIC ? null : 'synthetic-model',
      artifactId: executorType === EXECUTOR_TYPES.DETERMINISTIC ? null : 'synthetic-artifact',
      quantization: executorType === EXECUTOR_TYPES.LOCAL ? 'synthetic-q' : null,
      promptVersion: 'synthetic-prompt-v1',
      taskContractVersion: CASE_CONTRACT_VERSION,
      taskSpecificationVersion: 'synthetic-task-v1',
      outputSchemaVersion: 'synthetic-output-v1',
      commit: 'a'.repeat(40),
    },
    directResult: taskResult(executorType),
    escalation: {
      decision: localFirst
        ? ESCALATION_DECISIONS.NOT_ESCALATED
        : ESCALATION_DECISIONS.NOT_APPLICABLE,
      reasonCode: ESCALATION_REASONS.NONE,
      result: null,
    },
    policyOutcome: localFirst ? POLICY_OUTCOMES.SUCCESS : POLICY_OUTCOMES.NOT_RUN,
    error: { state: ERROR_STATES.NONE, code: null },
    ...overrides,
  };
}

test('privacy-safe observation persists without raw-content columns or accepted fields', () => {
  const db = createLedgerDatabase();
  const insert = insertObservationStatement(db);
  const recorder = createObservationRecorder({ insertObservation: values => insert.run(values) });
  assert.equal(recorder.record(eligibleObservation()), true);

  const row = db.prepare('SELECT * FROM research_memory_inference_observations').get();
  assert.equal(row.workload_type, WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE);
  assert.equal(row.local_eligible, 1);
  assert.equal(row.executed, 0);
  assert.equal(row.source_event_sha256, sourceHash());
  assert.equal(JSON.stringify(row).includes('합성 evidence'), false);

  const columns = db.prepare('PRAGMA table_info(research_memory_inference_observations)')
    .all().map(column => column.name);
  for (const forbidden of ['question', 'answer', 'content', 'prompt', 'output']) {
    assert.equal(columns.includes(forbidden), false);
  }
  assert.throws(
    () => persistedObservation({ ...eligibleObservation(), question: 'raw private content' }),
    /허용되지 않은 필드/,
  );
  db.close();
});

test('workload and opportunity/guard/eligibility semantics are bounded and distinct', () => {
  assert.throws(
    () => persistedObservation(eligibleObservation({ workloadType: 'future_workload' })),
    /지원하지 않는 workloadType/,
  );
  assert.throws(
    () => persistedObservation(eligibleObservation({ hardGated: true })),
    /hard-gated observation/,
  );
  assert.throws(
    () => persistedObservation(eligibleObservation({ opportunity: false })),
    /local-eligible/,
  );

  const currentGuard = persistedObservation(eligibleObservation({
    opportunity: true,
    hardGated: true,
    localEligible: false,
    guardScope: GUARD_SCOPES.CURRENT_PRODUCTION_ELIGIBILITY,
    reasonCode: REASON_CODES.CURRENT_VOICE_AUTO_SAVE_DISABLED,
  }));
  const contractGuard = persistedObservation(eligibleObservation({
    opportunity: true,
    hardGated: true,
    localEligible: false,
    guardScope: GUARD_SCOPES.CONTRACT_LEVEL,
    reasonCode: REASON_CODES.CONTRACT_IDENTITY_AMBIGUITY,
  }));
  assert.notEqual(currentGuard.guardScope, contractGuard.guardScope);
});

test('candidate boundary observes triage and ambiguity for every eligible derived-memory candidate', () => {
  const observations = candidateBoundaryObservations({
    sourceEventSha256: sourceHash(),
    occurredAt: 100,
  });
  assert.deepEqual(
    observations.map(item => item.workloadType),
    [WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE, WORKLOAD_TYPES.AMBIGUITY_ESCALATION],
  );
  assert.ok(observations.every(item => item.opportunity && item.localEligible && !item.hardGated));
});

test('current production guards remain scoped to general derived-memory workloads', () => {
  for (const reasonCode of [
    REASON_CODES.CURRENT_VOICE_AUTO_SAVE_DISABLED,
    REASON_CODES.CURRENT_SCHEDULE_CANDIDATE,
    REASON_CODES.CURRENT_TEMPORARY_ATTACHMENT_CONTEXT,
  ]) {
    const observations = candidateBoundaryObservations({
      sourceEventSha256: sourceHash(),
      occurredAt: 100,
      currentGuardReason: reasonCode,
    });
    assert.deepEqual(
      observations.map(item => item.workloadType),
      [WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE, WORKLOAD_TYPES.AMBIGUITY_ESCALATION],
    );
    assert.ok(observations.every(item => (
      item.opportunity
      && item.hardGated
      && !item.localEligible
      && item.guardScope === GUARD_SCOPES.CURRENT_PRODUCTION_ELIGIBILITY
      && item.reasonCode === reasonCode
    )));
  }
});

test('structured extraction observation represents only the current save path', () => {
  const saved = structuredExtractionObservation({
    sourceEventSha256: sourceHash(),
    occurredAt: 100,
  });
  assert.equal(saved.opportunity, true);
  assert.equal(saved.localEligible, true);
});

test('observation write failure is fail-open and does not cancel production work', () => {
  const errors = [];
  const recorder = createObservationRecorder({
    insertObservation() { throw Object.assign(new Error('synthetic failure'), { code: 'SQLITE_BUSY' }); },
    onRecordError(error) { errors.push(error.code); },
  });
  function productionPath() {
    const recorded = recorder.record(eligibleObservation());
    return { recorded, productionDecision: 'unchanged-save' };
  }
  assert.deepEqual(productionPath(), {
    recorded: false,
    productionDecision: 'unchanged-save',
  });
  assert.deepEqual(errors, ['SQLITE_BUSY']);
});

test('pilot case contract accepts synthetic, private replay, ambiguity, and human adjudication states', () => {
  assert.equal(validatePilotCase(baseCase()).sourceType, CASE_SOURCE_TYPES.SYNTHETIC);
  const privateReplay = baseCase({
    caseId: 'private-replay-001',
    sourceType: CASE_SOURCE_TYPES.PRIVATE_NATURAL_REPLAY,
    inputPayload: { evidence: 'private local replay content' },
    ambiguityState: 'ADJUDICATION_NEEDED',
    adjudication: baseAdjudication({
      state: ADJUDICATION_STATES.ADJUDICATION_NEEDED,
    }),
  });
  assert.equal(validatePilotCase(privateReplay).sourceType, CASE_SOURCE_TYPES.PRIVATE_NATURAL_REPLAY);
  assert.throws(() => validateTrackedPilotFixture([privateReplay]), /synthetic case만/);

  const resolved = baseCase({
    adjudication: baseAdjudication({
      state: ADJUDICATION_STATES.RESOLVED_HUMAN,
      primary: { source: 'HUMAN', label: 'WRITE' },
      blindSecondPass: { label: 'NO_WRITE' },
      disagreementState: DISAGREEMENT_STATES.DISAGREEMENT,
      finalResolvedHumanLabel: 'WRITE',
      cloudAssistedReview: {
        performed: true,
        configurationId: 'cloud-review-v1',
        suggestion: 'NO_WRITE',
      },
    }),
  });
  assert.equal(
    validatePilotCase(resolved).adjudication.finalResolvedHumanLabel,
    'WRITE',
    'cloud suggestion does not replace the resolved human label',
  );
});

test('tracked pilot fixture is synthetic and malformed/unknown cases are rejected', () => {
  const fixture = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'fixtures/local-memory-inference-pilot-synthetic.json'),
    'utf8',
  ));
  assert.equal(validateTrackedPilotFixture(fixture.cases).length, 3);
  assert.throws(
    () => validatePilotCase(baseCase({ workloadType: 'retrieval_routing' })),
    /지원하지 않는 workloadType/,
  );
  assert.throws(
    () => validatePilotCase({ ...baseCase(), taskContractVersion: 'unknown-v2' }),
    /지원하지 않는 task contract version/,
  );
  assert.match(
    fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8'),
    /fixtures\/local-memory-inference-private\*\.json/,
  );
});

test('result envelope represents deterministic, local, cloud, and hybrid policies', () => {
  assert.equal(
    validatePilotResult(pilotResult(
      POLICY_TYPES.DETERMINISTIC_CONTROL,
      EXECUTOR_TYPES.DETERMINISTIC,
    )).directResult.executorType,
    EXECUTOR_TYPES.DETERMINISTIC,
  );
  assert.equal(
    validatePilotResult(pilotResult(POLICY_TYPES.LOCAL_ONLY, EXECUTOR_TYPES.LOCAL))
      .directResult.executorType,
    EXECUTOR_TYPES.LOCAL,
  );
  assert.equal(
    validatePilotResult(pilotResult(POLICY_TYPES.CLOUD_ONLY, EXECUTOR_TYPES.CLOUD))
      .directResult.executorType,
    EXECUTOR_TYPES.CLOUD,
  );

  const invalidLocal = taskResult(EXECUTOR_TYPES.LOCAL, {
    structuredOutput: '{malformed',
    schemaStatus: SCHEMA_STATUSES.INVALID,
    taskOutcome: TASK_OUTCOMES.FAILURE,
    error: { state: ERROR_STATES.VALIDATION_ERROR, code: 'INVALID_SCHEMA' },
  });
  const hybrid = pilotResult(POLICY_TYPES.LOCAL_FIRST, EXECUTOR_TYPES.LOCAL, {
    directResult: invalidLocal,
    escalation: {
      decision: ESCALATION_DECISIONS.ESCALATED,
      reasonCode: ESCALATION_REASONS.INVALID_STRUCTURED_OUTPUT,
      result: taskResult(EXECUTOR_TYPES.CLOUD),
    },
    policyOutcome: POLICY_OUTCOMES.SUCCESS,
  });
  const validated = validatePilotResult(hybrid);
  assert.equal(validated.directResult.taskOutcome, TASK_OUTCOMES.FAILURE);
  assert.equal(validated.directResult.schemaStatus, SCHEMA_STATUSES.INVALID);
  assert.equal(validated.escalation.result.taskOutcome, TASK_OUTCOMES.SUCCESS);
  assert.equal(validated.policyOutcome, POLICY_OUTCOMES.SUCCESS);
  assert.throws(
    () => validatePilotResult({ ...hybrid, confidence: 0.99 }),
    /허용되지 않은 필드/,
  );
});

test('result envelope rejects collapsed direct-task and selective-policy outcomes', () => {
  for (const [policyType, executorType] of [
    [POLICY_TYPES.DETERMINISTIC_CONTROL, EXECUTOR_TYPES.DETERMINISTIC],
    [POLICY_TYPES.LOCAL_ONLY, EXECUTOR_TYPES.LOCAL],
    [POLICY_TYPES.CLOUD_ONLY, EXECUTOR_TYPES.CLOUD],
  ]) {
    assert.throws(
      () => validatePilotResult(pilotResult(policyType, executorType, {
        policyOutcome: POLICY_OUTCOMES.SUCCESS,
      })),
      /NOT_RUN/,
    );
  }

  assert.throws(
    () => validatePilotResult(pilotResult(POLICY_TYPES.LOCAL_FIRST, EXECUTOR_TYPES.LOCAL, {
      escalation: {
        decision: ESCALATION_DECISIONS.NOT_APPLICABLE,
        reasonCode: ESCALATION_REASONS.NONE,
        result: null,
      },
    })),
    /NOT_ESCALATED/,
  );
  assert.throws(
    () => validatePilotResult(pilotResult(POLICY_TYPES.LOCAL_FIRST, EXECUTOR_TYPES.LOCAL, {
      policyOutcome: POLICY_OUTCOMES.NOT_RUN,
    })),
    /policyOutcome/,
  );
  assert.throws(
    () => validatePilotResult(pilotResult(POLICY_TYPES.LOCAL_FIRST, EXECUTOR_TYPES.LOCAL, {
      directResult: taskResult(EXECUTOR_TYPES.LOCAL, {
        structuredOutput: '{malformed',
        schemaStatus: SCHEMA_STATUSES.INVALID,
        taskOutcome: TASK_OUTCOMES.UNKNOWN,
        error: { state: ERROR_STATES.VALIDATION_ERROR, code: 'INVALID_SCHEMA' },
      }),
    })),
    /FAILURE/,
  );
  assert.throws(
    () => validatePilotResult(pilotResult(POLICY_TYPES.LOCAL_FIRST, EXECUTOR_TYPES.LOCAL, {
      escalation: {
        decision: ESCALATION_DECISIONS.ESCALATED,
        reasonCode: ESCALATION_REASONS.LOCAL_ERROR,
        result: null,
      },
    })),
    /result가 필요/,
  );
});

test('LOCAL_FIRST local success requires direct success but escalation success does not', () => {
  assert.throws(
    () => validatePilotResult(pilotResult(POLICY_TYPES.LOCAL_FIRST, EXECUTOR_TYPES.LOCAL, {
      directResult: taskResult(EXECUTOR_TYPES.LOCAL, {
        taskOutcome: TASK_OUTCOMES.FAILURE,
      }),
      policyOutcome: POLICY_OUTCOMES.SUCCESS,
    })),
    /direct taskOutcome=SUCCESS/,
  );

  assert.equal(
    validatePilotResult(pilotResult(POLICY_TYPES.LOCAL_FIRST, EXECUTOR_TYPES.LOCAL, {
      directResult: taskResult(EXECUTOR_TYPES.LOCAL, {
        taskOutcome: TASK_OUTCOMES.SUCCESS,
      }),
      policyOutcome: POLICY_OUTCOMES.SUCCESS,
    })).policyOutcome,
    POLICY_OUTCOMES.SUCCESS,
  );

  const escalated = validatePilotResult(pilotResult(
    POLICY_TYPES.LOCAL_FIRST,
    EXECUTOR_TYPES.LOCAL,
    {
      directResult: taskResult(EXECUTOR_TYPES.LOCAL, {
        taskOutcome: TASK_OUTCOMES.FAILURE,
      }),
      escalation: {
        decision: ESCALATION_DECISIONS.ESCALATED,
        reasonCode: ESCALATION_REASONS.AMBIGUITY,
        result: taskResult(EXECUTOR_TYPES.CLOUD),
      },
      policyOutcome: POLICY_OUTCOMES.SUCCESS,
    },
  ));
  assert.equal(escalated.directResult.taskOutcome, TASK_OUTCOMES.FAILURE);
  assert.equal(escalated.policyOutcome, POLICY_OUTCOMES.SUCCESS);
});

test('deterministic-control registry supports registered and NONE_JUSTIFIED definitions', () => {
  const registry = createControlRegistry([
    {
      workloadType: WORKLOAD_TYPES.STRUCTURED_EXTRACTION,
      status: CONTROL_STATUSES.REGISTERED,
      controlId: 'schema-parser-control',
      kind: CONTROL_KINDS.DETERMINISTIC,
      version: 'v1',
      reasonCode: null,
      reason: null,
    },
    {
      workloadType: WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE,
      status: CONTROL_STATUSES.NONE_JUSTIFIED,
      controlId: null,
      kind: null,
      version: null,
      reasonCode: NONE_JUSTIFIED_REASONS.TASK_REQUIRES_SEMANTIC_JUDGMENT,
      reason: '현재 P0에서는 의미 판단을 대체할 단순 control을 정당화하지 않았다.',
    },
    {
      workloadType: WORKLOAD_TYPES.AMBIGUITY_ESCALATION,
      status: CONTROL_STATUSES.NONE_JUSTIFIED,
      controlId: null,
      kind: null,
      version: null,
      reasonCode: NONE_JUSTIFIED_REASONS.EXISTING_LOGIC_IS_AUTHORITY_GATE,
      reason: '기존 hard gate는 control arm이 아니라 선행 authority boundary다.',
    },
  ]);
  assert.equal(registry.size, 3);
});

test('frequency report counts daily incidence without evaluation-set weighting or extrapolation', () => {
  const db = createLedgerDatabase();
  const insert = insertObservationStatement(db);
  const recorder = createObservationRecorder({ insertObservation: values => insert.run(values) });
  const dayOne = parseKstDate('2026-09-01', 'date') + 60;
  const dayTwo = parseKstDate('2026-09-02', 'date') + 60;

  recorder.record(eligibleObservation({ occurredAt: dayOne, sourceEventSha256: sourceHash(1) }));
  recorder.record(eligibleObservation({
    occurredAt: dayOne,
    sourceEventSha256: sourceHash(2),
    opportunity: true,
    hardGated: true,
    localEligible: false,
    guardScope: GUARD_SCOPES.CURRENT_PRODUCTION_ELIGIBILITY,
    reasonCode: REASON_CODES.CURRENT_SCHEDULE_CANDIDATE,
  }));
  recorder.record(eligibleObservation({
    occurredAt: dayTwo,
    sourceEventSha256: sourceHash(3),
    executed: true,
  }));
  const syntheticEvaluationCases = [baseCase(), baseCase({ caseId: 'synthetic-case-002' })];
  assert.equal(validateTrackedPilotFixture(syntheticEvaluationCases).length, 2);
  const report = buildMemoryInferencePilotReport({
    db,
    startEpoch: parseKstDate('2026-09-01', 'date'),
    endEpoch: parseKstDate('2026-09-04', 'date'),
  });
  const triage = report.workloads.find(item => (
    item.workloadType === WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE
  ));
  assert.deepEqual({
    opportunities: triage.opportunities,
    hardGated: triage.hardGated,
    localEligible: triage.localEligible,
    executed: triage.executed,
  }, { opportunities: 3, hardGated: 1, localEligible: 2, executed: 1 });
  assert.equal(triage.normalizedPerDay.opportunities, 1);
  assert.deepEqual(triage.byDay.map(day => day.opportunities), [2, 1, 0]);
  assert.equal(report.evaluationSetCompositionIncluded, false);
  assert.equal(report.frequencySource, 'observed_production');
  assert.equal(report.coverage.status, COVERAGE_STATUSES.INCOMPLETE);
  assert.equal(report.coverage.extrapolatedMissingIncidence, false);
  assert.equal(report.instrumentationFailures.available, false);
  assert.deepEqual(report.observationContract, {
    current: {
      ledgerSchemaVersion: 1,
      instrumentationVersion: 'xion-local-memory-inference-p0-v1',
    },
    observed: [{
      ledgerSchemaVersion: 1,
      instrumentationVersion: 'xion-local-memory-inference-p0-v1',
      rows: 3,
    }],
    coherent: true,
    matchesCurrent: true,
  });
  const output = formatMemoryInferencePilotReport(report);
  assert.match(output, /synthetic\/private replay evaluation cases excluded/);
  assert.match(output, /xion-local-memory-inference-p0-v1/);
  assert.match(output, /INCOMPLETE/);
  db.close();
});

test('frequency report CLI requires an exact window and independent evidence for COMPLETE', () => {
  assert.deepEqual(
    parseArguments([
      '--since', '2026-09-01',
      '--until', '2026-09-08',
      '--coverage', 'complete',
      '--instrumentation-failures', '0',
      '--json',
    ]),
    {
      dbPath: null,
      startEpoch: parseKstDate('2026-09-01', 'date'),
      endEpoch: parseKstDate('2026-09-08', 'date'),
      coverageStatus: COVERAGE_STATUSES.COMPLETE,
      instrumentationFailureCount: 0,
      json: true,
      help: false,
    },
  );
  assert.throws(
    () => parseArguments(['--since', '2026-09-01', '--until', '2026-09-08', '--coverage', 'complete']),
    /instrumentation-failures/,
  );
  assert.throws(
    () => parseArguments([
      '--since', '2026-09-01',
      '--until', '2026-09-08',
      '--coverage', 'complete',
      '--instrumentation-failures', '1',
    ]),
    /정확히 0/,
  );
  assert.throws(() => parseArguments(['--since', '2026-09-01']), /모두 필요/);
  assert.match(helpText(), /정확히 0/);
});

test('frequency report refuses COMPLETE for failures or mixed observation contracts', () => {
  const db = createLedgerDatabase();
  const insert = insertObservationStatement(db);
  insert.run(persistedObservation(eligibleObservation()));
  assert.throws(() => buildMemoryInferencePilotReport({
    db,
    startEpoch: parseKstDate('2026-09-01', 'date'),
    endEpoch: parseKstDate('2026-09-02', 'date'),
    coverageStatus: COVERAGE_STATUSES.COMPLETE,
    instrumentationFailureCount: 1,
  }), /정확히 0/);
  db.close();

  const mixedDb = new Database(':memory:');
  mixedDb.exec(`
    CREATE TABLE research_memory_inference_observations (
      id INTEGER PRIMARY KEY,
      workload_type TEXT NOT NULL,
      occurred_at INTEGER NOT NULL,
      opportunity INTEGER NOT NULL,
      hard_gated INTEGER NOT NULL,
      local_eligible INTEGER NOT NULL,
      executed INTEGER NOT NULL,
      ledger_schema_version INTEGER NOT NULL,
      instrumentation_version TEXT NOT NULL
    );
  `);
  const occurredAt = parseKstDate('2026-09-01', 'date') + 60;
  const mixedInsert = mixedDb.prepare(`
    INSERT INTO research_memory_inference_observations (
      workload_type, occurred_at, opportunity, hard_gated,
      local_eligible, executed, ledger_schema_version, instrumentation_version
    ) VALUES (?, ?, 1, 0, 1, 0, ?, ?)
  `);
  mixedInsert.run(WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE, occurredAt, 1,
    'xion-local-memory-inference-p0-v1');
  mixedInsert.run(WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE, occurredAt, 2,
    'xion-local-memory-inference-future-v2');

  const incomplete = buildMemoryInferencePilotReport({
    db: mixedDb,
    startEpoch: parseKstDate('2026-09-01', 'date'),
    endEpoch: parseKstDate('2026-09-02', 'date'),
  });
  assert.equal(incomplete.observationContract.coherent, false);
  assert.equal(incomplete.observationContract.matchesCurrent, false);
  assert.equal(incomplete.observationContract.observed.length, 2);
  assert.throws(() => buildMemoryInferencePilotReport({
    db: mixedDb,
    startEpoch: parseKstDate('2026-09-01', 'date'),
    endEpoch: parseKstDate('2026-09-02', 'date'),
    coverageStatus: COVERAGE_STATUSES.COMPLETE,
    instrumentationFailureCount: 0,
  }), /observation contract/);
  mixedDb.close();
});
