'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { canonicalAddress, evidenceIdFor } = require('./evidence-registry');
const { validateCandidate } = require('./router');

const GENERAL_FACT_ATTRIBUTES = Object.freeze({
  primary_laptop: Object.freeze({
    meaning: '사용자가 자신의 주 사용 노트북으로 지칭하는 기기',
    valueType: 'string',
    cardinality: 'SINGLE',
  }),
});
const CHANGE_CLASSES = new Set([
  'EXPANSION', 'WORLD_UPDATE', 'CORRECTION', 'ADDITIONAL_CONTEXT',
  'CONTRADICTION', 'TEMPORAL_SCOPE_CHANGE', 'INTERPRETATION_REVISION',
  'AMBIGUOUS', 'UNRESOLVED',
]);
const TRANSITIONS = new Set([
  'NO_CHANGE', 'CREATE', 'EXPAND', 'SUPERSEDE', 'REVISE',
  'FORK', 'KEEP_AMBIGUOUS', 'INVALIDATE',
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object'
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Object.getOwnPropertySymbols(value).length === 0
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');

function freeze(value) {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function normalizeCandidate(input) {
  validateCandidate(input);
  const { payload } = input;
  if (input.semanticFamily !== 'general_fact'
      || !exactKeys(payload, ['subject', 'attributeKey', 'value'])
      || payload.subject !== 'USER'
      || !Object.hasOwn(GENERAL_FACT_ATTRIBUTES, payload.attributeKey)
      || (payload.value !== null && (typeof payload.value !== 'string'
        || payload.value.trim().length === 0 || payload.value.length > 2000))) {
    fail('INVALID_GENERAL_FACT_CANDIDATE');
  }
  // null means no replacement value, never a persisted fact. No alias/value inference.
  return { ...input, payload: { ...payload }, sources: input.sources.map(canonicalAddress) };
}

function normalizeProposal(input) {
  if (!exactKeys(input, ['changeClass', 'transition', 'evidenceIds', 'rationale'])
      || (input.changeClass !== null && !CHANGE_CLASSES.has(input.changeClass))
      || !TRANSITIONS.has(input.transition)
      || !Array.isArray(input.evidenceIds) || input.evidenceIds.length === 0
      || input.evidenceIds.some(id => typeof id !== 'string')
      || new Set(input.evidenceIds).size !== input.evidenceIds.length
      || typeof input.rationale !== 'string' || !input.rationale.trim()) {
    fail('INVALID_TRANSITION_PROPOSAL');
  }
  return freeze({ ...input, evidenceIds: [...input.evidenceIds].sort() });
}

function normalizeValidation(input) {
  if (!exactKeys(input, ['approved', 'reason']) || typeof input.approved !== 'boolean'
      || typeof input.reason !== 'string' || !input.reason.trim()) fail('INVALID_VALIDATION_RESULT');
  return freeze({ ...input });
}

function checkTransition(replay, proposal) {
  const { transition, changeClass, evidenceIds } = proposal;
  if (['EXPAND', 'FORK', 'KEEP_AMBIGUOUS'].includes(transition)) fail('UNSUPPORTED_TRANSITION');
  const hasCurrent = replay.currentState !== null;
  if (transition === 'CREATE' ? hasCurrent || changeClass !== null : !hasCurrent || changeClass === null) {
    fail('INVALID_TRANSITION_TARGET');
  }
  if ((transition === 'SUPERSEDE' && changeClass !== 'WORLD_UPDATE')
      || (['REVISE', 'INVALIDATE'].includes(transition) && changeClass !== 'CORRECTION')) {
    fail('UNSUPPORTED_CHANGE_MAPPING');
  }
  if (['CREATE', 'SUPERSEDE', 'REVISE'].includes(transition) && replay.candidate.payload.value === null) {
    fail('REPLACEMENT_VALUE_REQUIRED');
  }
  const available = new Set(replay.evidence.map(item => item.evidenceRef.evidenceId));
  const incoming = new Set(replay.newEvidence.map(item => item.evidenceRef.evidenceId));
  if (evidenceIds.some(id => !available.has(id)) || !evidenceIds.some(id => incoming.has(id))) {
    fail('INVALID_TRANSITION_EVIDENCE');
  }
}

function createGeneralFactStore(db, evidenceRegistry) {
  if (!db?.prepare || typeof db.transaction !== 'function'
      || typeof evidenceRegistry?.resolveEvidenceRef !== 'function') {
    throw new TypeError('SQLite DB and EvidenceRef registry required');
  }
  const candidateById = db.prepare('SELECT * FROM memory_general_fact_candidates WHERE candidate_id = ?');
  const transitionsFor = db.prepare(`
    SELECT * FROM memory_general_fact_transitions
    WHERE subject = ? AND attribute_key = ? ORDER BY revision
  `);
  const statesFor = db.prepare(`
    SELECT s.state_id AS stateId, s.candidate_id AS candidateId, s.value, s.created_at AS createdAt
    FROM memory_general_fact_states s JOIN memory_general_fact_candidates c USING (candidate_id)
    WHERE c.subject = ? AND c.attribute_key = ? ORDER BY s.state_id
  `);
  const evidenceFor = db.prepare(`
    SELECT evidence_id FROM memory_general_fact_transition_evidence
    WHERE transition_id = ? ORDER BY evidence_id
  `);
  const pendingFor = db.prepare(`
    SELECT * FROM memory_general_fact_candidates
    WHERE subject = ? AND attribute_key = ? AND status = 'PENDING' ORDER BY candidate_id
  `);

  // ponytail: replay the complete slot history; add bounded evidence selection if measured input size requires it.
  function readTarget(subject, attributeKey) {
    if (subject !== 'USER' || !Object.hasOwn(GENERAL_FACT_ATTRIBUTES, attributeKey)) fail('INVALID_GENERAL_FACT_TARGET');
    const states = statesFor.all(subject, attributeKey);
    const byId = new Map(states.map(state => [state.stateId, state]));
    const history = [];
    const introduced = new Set();
    let currentId = null;
    for (const row of transitionsFor.all(subject, attributeKey)) {
      if (row.revision !== history.length + 1 || row.previous_state_id !== currentId) fail('INVALID_STATE_HISTORY');
      const record = candidateById.get(row.candidate_id);
      const evidenceIds = evidenceFor.all(row.transition_id).map(item => item.evidence_id);
      if (!record || record.status !== 'COMMITTED' || record.subject !== subject
          || record.attribute_key !== attributeKey || evidenceIds.length === 0) fail('INVALID_STATE_PROVENANCE');
      const proposal = normalizeProposal(JSON.parse(record.proposal_json));
      const validation = normalizeValidation(JSON.parse(record.validation_json));
      if (!validation.approved || proposal.transition !== row.transition || proposal.changeClass !== row.change_class
          || canonicalJson(proposal.evidenceIds) !== canonicalJson(evidenceIds)) fail('INVALID_STATE_PROVENANCE');
      if (row.next_state_id !== null && row.transition !== 'NO_CHANGE') {
        const state = byId.get(row.next_state_id);
        if (!state || state.candidateId !== row.candidate_id || introduced.has(state.stateId)
            || state.value !== JSON.parse(record.candidate_json).payload.value) fail('INVALID_STATE_HISTORY');
        introduced.add(state.stateId);
        state.status = 'CURRENT';
      }
      if (currentId !== null && row.transition !== 'NO_CHANGE') {
        byId.get(currentId).status = { SUPERSEDE: 'HISTORICAL', REVISE: 'CORRECTED', INVALIDATE: 'INVALIDATED' }[row.transition];
      }
      history.push({
        transitionId: row.transition_id, revision: row.revision, candidateId: row.candidate_id,
        previousStateId: row.previous_state_id, nextStateId: row.next_state_id,
        transition: row.transition, changeClass: row.change_class, evidenceIds,
        proposal, validation,
        createdAt: row.created_at,
      });
      currentId = row.next_state_id;
    }
    if (introduced.size !== states.length) fail('INVALID_STATE_HISTORY');
    return {
      target: { semanticFamily: 'general_fact', subject, attributeKey }, revision: history.length,
      currentState: currentId === null ? null : byId.get(currentId), states, history,
      unresolvedCandidates: pendingFor.all(subject, attributeKey).map(row => ({
        candidateId: row.candidate_id, candidate: JSON.parse(row.candidate_json),
        evidenceIds: JSON.parse(row.evidence_ids_json), reason: row.pending_reason,
        proposal: row.proposal_json === null ? null : JSON.parse(row.proposal_json),
        validation: row.validation_json === null ? null : JSON.parse(row.validation_json),
      })),
    };
  }

  function buildReplay(candidateId) {
    const record = candidateById.get(candidateId);
    if (!record) fail('CANDIDATE_NOT_FOUND');
    const candidate = JSON.parse(record.candidate_json);
    const target = readTarget(record.subject, record.attribute_key);
    target.unresolvedCandidates = target.unresolvedCandidates.filter(item => item.candidateId !== candidateId);
    const newIds = JSON.parse(record.evidence_ids_json);
    const originalIds = target.history.find(item => item.nextStateId === target.currentState?.stateId
      && item.transition !== 'NO_CHANGE')?.evidenceIds || [];
    const allIds = [...new Set([
      ...newIds, ...target.history.flatMap(item => item.evidenceIds),
      ...target.unresolvedCandidates.flatMap(item => item.evidenceIds),
    ])].sort();
    const evidence = allIds.map(id => evidenceRegistry.resolveEvidenceRef(id));
    const byId = new Map(evidence.map(item => [item.evidenceRef.evidenceId, item]));
    const replay = {
      schemaVersion: 1, candidateId, candidate, ...target, evidence,
      newEvidence: newIds.map(id => byId.get(id)), originalSupport: originalIds.map(id => byId.get(id)),
      counterEvidence: target.history.filter(item => ['REVISE', 'INVALIDATE'].includes(item.transition))
        .map(item => ({ targetStateId: item.previousStateId, evidenceIds: item.evidenceIds })),
      assumptions: [],
    };
    return freeze({ ...replay, replaySha256: hash(canonicalJson(replay)) });
  }

  function committedResult(candidateId) {
    const row = db.prepare('SELECT * FROM memory_general_fact_transitions WHERE candidate_id = ?').get(candidateId);
    if (!row) fail('INVALID_STATE_PROVENANCE');
    return { status: 'COMMITTED', candidateId, transitionId: row.transition_id, transition: row.transition,
      revision: row.revision, stateId: row.next_state_id };
  }

  const persistCandidate = db.transaction(({ candidate: input, evidenceRefs }) => {
    const candidate = normalizeCandidate(input);
    if (!Array.isArray(evidenceRefs) || evidenceRefs.length !== candidate.sources.length
        || evidenceRefs.some((item, i) => item?.evidenceRef?.evidenceId !== evidenceIdFor(candidate.sources[i]))) {
      fail('INVALID_CANDIDATE_BINDING');
    }
    const evidenceIds = [...new Set(candidate.sources.map(evidenceIdFor))].sort();
    evidenceIds.forEach(id => evidenceRegistry.resolveEvidenceRef(id));
    const candidateJson = canonicalJson(candidate);
    const candidateId = `gf_candidate_${hash(`xion-general-fact-candidate-v1\0${candidateJson}`)}`;
    db.prepare(`
      INSERT INTO memory_general_fact_candidates
        (candidate_id, subject, attribute_key, candidate_json, evidence_ids_json)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(candidate_id) DO NOTHING
    `).run(candidateId, candidate.payload.subject, candidate.payload.attributeKey, candidateJson, JSON.stringify(evidenceIds));
    const existing = candidateById.get(candidateId);
    if (existing.candidate_json !== candidateJson || existing.evidence_ids_json !== JSON.stringify(evidenceIds)
        || existing.subject !== candidate.payload.subject || existing.attribute_key !== candidate.payload.attributeKey) {
      fail('INVALID_CANDIDATE_BINDING');
    }
    if (existing.status === 'COMMITTED') return committedResult(candidateId);
    return { status: 'PENDING', candidateId };
  });

  const readReplay = db.transaction(buildReplay);
  function prepare(input) {
    const result = persistCandidate(input);
    // A replay failure must not erase the already-bound unresolved candidate.
    return result.status === 'COMMITTED' ? result : { ...result, replayPackage: readReplay(result.candidateId) };
  }

  const defer = db.transaction((candidateId, reason, proposal, validation) => {
    if (candidateById.get(candidateId)?.status === 'COMMITTED') return committedResult(candidateId);
    db.prepare(`
      UPDATE memory_general_fact_candidates
      SET pending_reason = ?, proposal_json = ?, validation_json = ? WHERE candidate_id = ? AND status = 'PENDING'
    `).run(reason, proposal ? canonicalJson(proposal) : null, validation ? canonicalJson(validation) : null, candidateId);
    return { status: 'PENDING', candidateId, reason };
  });

  const commit = db.transaction((replay, proposal, validation) => {
    proposal = normalizeProposal(proposal);
    validation = normalizeValidation(validation);
    if (candidateById.get(replay.candidateId)?.status === 'COMMITTED') return committedResult(replay.candidateId);
    const current = buildReplay(replay.candidateId);
    if (canonicalJson(current) !== canonicalJson(replay)) fail('STALE_REPLAY');
    replay = current;
    checkTransition(replay, proposal);
    if (validation.approved !== true) fail('VALIDATION_REJECTED');
    let nextId = replay.currentState?.stateId || null;
    if (['CREATE', 'SUPERSEDE', 'REVISE'].includes(proposal.transition)) {
      nextId = `gf_state_${randomUUID()}`;
      db.prepare('INSERT INTO memory_general_fact_states (state_id, candidate_id, value) VALUES (?, ?, ?)')
        .run(nextId, replay.candidateId, replay.candidate.payload.value);
    } else if (proposal.transition === 'INVALIDATE') nextId = null;
    const transitionId = `gf_transition_${randomUUID()}`;
    db.prepare(`
      INSERT INTO memory_general_fact_transitions
        (transition_id, subject, attribute_key, revision, candidate_id, previous_state_id,
         next_state_id, transition, change_class, replay_sha256)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(transitionId, replay.target.subject, replay.target.attributeKey, replay.revision + 1,
      replay.candidateId, replay.currentState?.stateId || null, nextId,
      proposal.transition, proposal.changeClass, replay.replaySha256);
    const bind = db.prepare('INSERT INTO memory_general_fact_transition_evidence VALUES (?, ?)');
    proposal.evidenceIds.forEach(id => bind.run(transitionId, id));
    db.prepare(`
      UPDATE memory_general_fact_candidates SET status = 'COMMITTED', pending_reason = NULL,
        proposal_json = ?, validation_json = ? WHERE candidate_id = ?
    `).run(canonicalJson(proposal), canonicalJson(validation), replay.candidateId);
    return committedResult(replay.candidateId);
  });

  return { prepare, defer, commit, readTarget };
}

function createGeneralFactHandler({ db, evidenceRegistry, proposeTransition, validateTransition }) {
  if (typeof proposeTransition !== 'function' || typeof validateTransition !== 'function') {
    throw new TypeError('Explicit transition proposer and semantic validator required');
  }
  const store = createGeneralFactStore(db, evidenceRegistry);
  return async input => {
    const prepared = store.prepare(input);
    if (prepared.status === 'COMMITTED') return prepared;
    const replay = prepared.replayPackage;
    let proposal = null;
    let validation = null;
    try {
      proposal = normalizeProposal(await proposeTransition(replay));
      checkTransition(replay, proposal);
      validation = normalizeValidation(await validateTransition({ replayPackage: replay, proposal }));
      if (!validation.approved) return store.defer(replay.candidateId, 'VALIDATION_REJECTED', proposal, validation);
      return store.commit(replay, proposal, validation);
    } catch (error) {
      store.defer(replay.candidateId, error.code || 'TRANSITION_EVALUATION_FAILED', proposal, validation);
      throw error;
    }
  };
}

module.exports = { GENERAL_FACT_ATTRIBUTES, createGeneralFactStore, createGeneralFactHandler };
