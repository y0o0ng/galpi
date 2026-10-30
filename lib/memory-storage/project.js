'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { canonicalJson } = require('./general-fact');
const { validateProjectPayload } = require('./project-candidate');
const { validateCandidate } = require('./router');
const { canonicalAddress, evidenceIdFor } = require('./evidence-registry');

const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && !Object.getOwnPropertySymbols(value).length
  && Object.keys(value).sort().join(',') === [...expected].sort().join(',');
const nonempty = value => typeof value === 'string' && !!value.trim();
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const classes = ['EXPANSION', 'WORLD_UPDATE', 'CORRECTION', 'ADDITIONAL_CONTEXT', 'CONTRADICTION', 'TEMPORAL_SCOPE_CHANGE', 'INTERPRETATION_REVISION', 'AMBIGUOUS', 'UNRESOLVED'];
const transitions = ['CREATE', 'EXPAND', 'SUPERSEDE', 'REVISE', 'INVALIDATE', 'NO_CHANGE', 'KEEP_AMBIGUOUS', 'FORK'];
const candidateIdFor = json => `project_candidate_${hash(`xion-project-candidate-v1\0${json}`)}`;
function fail(code) { const error = Error(code); error.code = code; throw error; }

const PROJECT_PROPOSAL_SCHEMA = freeze({ type: 'object', additionalProperties: false,
  properties: { targetProjectId: { type: 'string' }, targetClaimId: { type: ['string', 'null'] },
    changeClass: { type: ['string', 'null'], enum: [null, ...classes] }, transition: { type: 'string', enum: transitions },
    displayName: { type: ['string', 'null'] },
    evidenceIds: { type: 'array', items: { type: 'string' }, minItems: 1 }, rationale: { type: 'string', minLength: 1 } },
  required: ['targetProjectId', 'targetClaimId', 'changeClass', 'transition', 'displayName', 'evidenceIds', 'rationale'] });

function normalizeCandidate(input) {
  validateCandidate(input);
  if (input.semanticFamily !== 'project') fail('INVALID_PROJECT_CANDIDATE');
  validateProjectPayload(input.payload);
  return { ...input, payload: { ...input.payload }, sources: input.sources.map(canonicalAddress) };
}
function normalizeProposal(input, { allowLegacy = false } = {}) {
  const legacy = allowLegacy && keys(input, PROJECT_PROPOSAL_SCHEMA.required.filter(key => key !== 'displayName'));
  if (!(legacy || keys(input, PROJECT_PROPOSAL_SCHEMA.required)) || !nonempty(input.targetProjectId)
      || !(input.targetClaimId === null || nonempty(input.targetClaimId))
      || !(input.changeClass === null || classes.includes(input.changeClass)) || !transitions.includes(input.transition)
      || (!legacy && (input.transition === 'CREATE' && input.targetProjectId === 'NEW'
        ? !nonempty(input.displayName) : input.displayName !== null))
      || !Array.isArray(input.evidenceIds) || !input.evidenceIds.length || input.evidenceIds.some(id => !nonempty(id))
      || new Set(input.evidenceIds).size !== input.evidenceIds.length || !nonempty(input.rationale)) fail('INVALID_PROJECT_PROPOSAL');
  return freeze({ ...input, evidenceIds: [...input.evidenceIds].sort() });
}
function checkTransition(replay, proposal, { historical = false } = {}) {
  const { transition, changeClass, targetProjectId, targetClaimId, evidenceIds } = proposal;
  if (transition === 'FORK') fail('UNSUPPORTED_TRANSITION');
  const available = new Set(replay.evidence.map(e => e.evidenceRef.evidenceId));
  const incoming = new Set(replay.newEvidence.map(e => e.evidenceRef.evidenceId));
  if (evidenceIds.some(id => !available.has(id)) || !evidenceIds.some(id => incoming.has(id))) fail('INVALID_TRANSITION_EVIDENCE');
  if (!historical && transition === 'CREATE' && targetProjectId === 'NEW'
      && (!nonempty(proposal.displayName) || !replay.evidence.some(item => item.source?.content?.includes(proposal.displayName)))) {
    fail('DISPLAY_NAME_NOT_IN_EVIDENCE');
  }
  if (transition === 'KEEP_AMBIGUOUS') return;
  const project = replay.projects.find(p => p.projectId === targetProjectId);
  if (transition === 'CREATE') {
    if (targetClaimId !== null || changeClass !== null || (targetProjectId !== 'NEW'
      && (!project || replay.candidate.payload.kind !== 'STATUS' || project.currentStatus !== null))) fail('INVALID_TRANSITION_TARGET');
    return;
  }
  if (!project || changeClass === null) fail('INVALID_TRANSITION_TARGET');
  const kind = replay.candidate.payload.kind;
  if (transition === 'EXPAND') {
    if (kind !== 'CLAIM' || targetClaimId !== null || changeClass !== 'EXPANSION') fail('INVALID_TRANSITION_TARGET');
    return;
  }
  if (kind === 'CLAIM' ? !project.currentClaims.some(s => s.stateId === targetClaimId)
    : targetClaimId !== null || !project.currentStatus) fail('INVALID_TRANSITION_TARGET');
  if ((transition === 'SUPERSEDE' && changeClass !== 'WORLD_UPDATE')
      || (['REVISE', 'INVALIDATE'].includes(transition) && changeClass !== 'CORRECTION')) fail('UNSUPPORTED_CHANGE_MAPPING');
}

function createProjectStore(db, evidenceRegistry) {
  const byCandidate = db.prepare('SELECT * FROM memory_project_candidates WHERE candidate_id = ?');
  const evidenceFor = db.prepare('SELECT evidence_id FROM memory_project_transition_evidence WHERE transition_id = ? ORDER BY evidence_id');
  function readProjects() {
    const projects = db.prepare('SELECT project_id AS projectId, display_name AS displayName FROM memory_projects ORDER BY project_id').all()
      .map(p => ({ ...p, aliases: [], currentStatus: null, currentClaims: [], states: [], history: [] }));
    const byProject = new Map(projects.map(p => [p.projectId, p]));
    const states = db.prepare('SELECT state_id AS stateId, project_id AS projectId, candidate_id AS candidateId, kind, value, created_at AS createdAt FROM memory_project_states').all();
    const stateMap = new Map(states.map(s => [s.stateId, s]));
    const introduced = new Set();
    for (const row of db.prepare('SELECT * FROM memory_project_transitions ORDER BY sequence').all()) {
      const p = byProject.get(row.project_id), record = byCandidate.get(row.candidate_id);
      const evidenceIds = evidenceFor.all(row.transition_id).map(e => e.evidence_id);
      if (!p || !record || record.status !== 'COMMITTED' || !evidenceIds.length) fail('INVALID_PROJECT_PROVENANCE');
      const candidate = normalizeCandidate(JSON.parse(record.candidate_json));
      const incomingIds = [...new Set(candidate.sources.map(evidenceIdFor))].sort();
      if (candidateIdFor(record.candidate_json) !== row.candidate_id || canonicalJson(candidate) !== record.candidate_json
          || canonicalJson(incomingIds) !== record.evidence_ids_json) fail('INVALID_CANDIDATE_BINDING');
      const proposal = normalizeProposal(JSON.parse(record.proposal_json), { allowLegacy: true });
      const validation = JSON.parse(record.validation_json);
      const newProject = proposal.transition === 'CREATE' && proposal.targetProjectId === 'NEW';
      const newValidation = keys(validation, ['approved', 'reason', 'approvedDisplayName']);
      if (!(keys(validation, ['approved', 'reason']) || (newProject && newValidation && nonempty(validation.approvedDisplayName)))
          || (newProject && Object.hasOwn(proposal, 'displayName') && !newValidation)
          || (newProject && (newValidation ? p.displayName !== validation.approvedDisplayName : p.displayName !== null))
          || validation.approved !== true || !nonempty(validation.reason) || proposal.transition !== row.transition
          || proposal.changeClass !== row.change_class || canonicalJson(proposal.evidenceIds) !== canonicalJson(evidenceIds)
          || (proposal.targetProjectId !== p.projectId && !(proposal.transition === 'CREATE' && proposal.targetProjectId === 'NEW'))) fail('INVALID_PROJECT_PROVENANCE');
      p.currentStatus = p.states.find(s => s.kind === 'STATUS' && s.status === 'CURRENT') || null;
      p.currentClaims = p.states.filter(s => s.kind === 'CLAIM' && s.status === 'CURRENT');
      if ((p.history.length === 0 && (row.transition !== 'CREATE' || proposal.targetProjectId !== 'NEW'))
          || (p.history.length > 0 && proposal.targetProjectId === 'NEW')) fail('INVALID_PROJECT_HISTORY');
      const availableIds = [...new Set([...incomingIds, ...projects.flatMap(project => project.history.flatMap(h => h.evidenceIds))])];
      const refs = ids => ids.map(evidenceId => evidenceRegistry.resolveEvidenceRef(evidenceId));
      checkTransition({ candidate, projects, evidence: refs(availableIds), newEvidence: refs(incomingIds) }, proposal,
        { historical: !Object.hasOwn(proposal, 'displayName') });
      if (['CREATE', 'EXPAND'].includes(row.transition) ? row.previous_state_id !== null
        : candidate.payload.kind === 'STATUS' ? row.previous_state_id !== p.currentStatus?.stateId
          : row.previous_state_id !== proposal.targetClaimId) fail('INVALID_PROJECT_HISTORY');
      if (row.transition === 'INVALIDATE' ? row.next_state_id !== null
        : row.transition !== 'NO_CHANGE' && row.next_state_id === null) fail('INVALID_PROJECT_HISTORY');
      const previous = row.previous_state_id === null ? null : stateMap.get(row.previous_state_id);
      if (previous && (previous.projectId !== p.projectId || previous.status !== 'CURRENT' || previous.kind !== candidate.payload.kind)) fail('INVALID_PROJECT_HISTORY');
      if (row.previous_state_id !== null && !previous) fail('INVALID_PROJECT_HISTORY');
      if (candidate.payload.kind === 'CLAIM' && !['CREATE', 'EXPAND'].includes(row.transition)
          && proposal.targetClaimId !== previous?.stateId) fail('INVALID_PROJECT_HISTORY');
      if (previous && row.transition !== 'NO_CHANGE') previous.status = { SUPERSEDE: 'HISTORICAL', REVISE: 'CORRECTED', INVALIDATE: 'INVALIDATED' }[row.transition];
      if (row.transition !== 'NO_CHANGE' && row.next_state_id !== null) {
        const state = stateMap.get(row.next_state_id);
        const value = candidate.payload.kind === 'STATUS' ? candidate.payload.status : candidate.payload.claimText;
        if (!state || state.projectId !== p.projectId || state.candidateId !== row.candidate_id || state.kind !== candidate.payload.kind
            || state.value !== value || introduced.has(state.stateId)) fail('INVALID_PROJECT_HISTORY');
        state.status = 'CURRENT'; introduced.add(state.stateId); p.states.push(state);
      } else if (row.transition === 'NO_CHANGE' && row.next_state_id !== row.previous_state_id) fail('INVALID_PROJECT_HISTORY');
      if (candidate.payload.projectMention !== null && !p.aliases.includes(candidate.payload.projectMention)) p.aliases.push(candidate.payload.projectMention);
      p.history.push({ transitionId: row.transition_id, candidateId: row.candidate_id, previousStateId: row.previous_state_id,
        nextStateId: row.next_state_id, transition: row.transition, changeClass: row.change_class, evidenceIds, proposal, validation });
    }
    if (introduced.size !== states.length || projects.some(p => !p.history.length)
      || db.prepare(`SELECT 1 FROM memory_project_candidates c LEFT JOIN memory_project_transitions t USING(candidate_id)
        WHERE c.status='COMMITTED' AND t.candidate_id IS NULL LIMIT 1`).get()) fail('INVALID_PROJECT_HISTORY');
    for (const p of projects) {
      const statuses = p.states.filter(s => s.kind === 'STATUS' && s.status === 'CURRENT');
      if (statuses.length > 1) fail('INVALID_PROJECT_HISTORY');
      p.currentStatus = statuses[0] || null;
      p.currentClaims = p.states.filter(s => s.kind === 'CLAIM' && s.status === 'CURRENT');
    }
    return projects;
  }
  function buildReplay(candidateId) {
    const row = byCandidate.get(candidateId);
    if (!row) fail('CANDIDATE_NOT_FOUND');
    const candidate = normalizeCandidate(JSON.parse(row.candidate_json));
    const ids = [...new Set(candidate.sources.map(evidenceIdFor))].sort();
    if (candidateIdFor(row.candidate_json) !== candidateId || canonicalJson(candidate) !== row.candidate_json
        || canonicalJson(ids) !== row.evidence_ids_json) fail('INVALID_CANDIDATE_BINDING');
    const projects = readProjects();
    const allIds = [...new Set([...ids, ...projects.flatMap(p => p.history.flatMap(h => h.evidenceIds))])].sort();
    const evidence = allIds.map(id => evidenceRegistry.resolveEvidenceRef(id));
    const byId = new Map(evidence.map(e => [e.evidenceRef.evidenceId, e]));
    const replay = { schemaVersion: 1, candidateId, candidate, projects, evidence,
      newEvidence: ids.map(id => byId.get(id)), assumptions: [] };
    return freeze({ ...replay, replaySha256: hash(canonicalJson(replay)) });
  }
  const persistCandidate = db.transaction(input => {
    const candidate = normalizeCandidate(input.candidate);
    if (!Array.isArray(input.evidenceRefs) || input.evidenceRefs.length !== candidate.sources.length
      || input.evidenceRefs.some((e, i) => e?.evidenceRef?.evidenceId !== evidenceIdFor(candidate.sources[i]))) fail('INVALID_CANDIDATE_BINDING');
    const ids = [...new Set(candidate.sources.map(evidenceIdFor))].sort();
    const resolved = ids.map(id => evidenceRegistry.resolveEvidenceRef(id));
    if (candidate.payload.projectMention !== null
      && !resolved.some(e => e.source.content.includes(candidate.payload.projectMention))) fail('PROJECT_MENTION_NOT_IN_EVIDENCE');
    const json = canonicalJson(candidate), candidateId = candidateIdFor(json);
    db.prepare('INSERT INTO memory_project_candidates(candidate_id,candidate_json,evidence_ids_json) VALUES(?,?,?) ON CONFLICT(candidate_id) DO NOTHING')
      .run(candidateId, json, canonicalJson(ids));
    const row = byCandidate.get(candidateId);
    if (row.candidate_json !== json || row.evidence_ids_json !== canonicalJson(ids)) fail('INVALID_CANDIDATE_BINDING');
    if (row.status === 'COMMITTED') return committedResult(candidateId);
    return { status: 'PENDING', candidateId };
  });
  function prepare(input) {
    const result = persistCandidate(input);
    return result.status === 'COMMITTED' ? result : { ...result, replayPackage: db.transaction(buildReplay)(result.candidateId) };
  }
  function committedResult(candidateId) {
    const row = db.prepare('SELECT * FROM memory_project_transitions WHERE candidate_id = ?').get(candidateId);
    if (!row) fail('INVALID_PROJECT_PROVENANCE');
    return { status: 'COMMITTED', candidateId, transitionId: row.transition_id, transition: row.transition, projectId: row.project_id, stateId: row.next_state_id };
  }
  const defer = db.transaction((candidateId, reason, proposal = null, validation = null) => {
    if (byCandidate.get(candidateId)?.status === 'COMMITTED') return committedResult(candidateId);
    db.prepare('UPDATE memory_project_candidates SET pending_reason=?, proposal_json=?, validation_json=? WHERE candidate_id=? AND status=\'PENDING\'')
      .run(reason, proposal ? canonicalJson(proposal) : null, validation ? canonicalJson(validation) : null, candidateId);
    return { status: 'PENDING', candidateId, reason };
  });
  const commit = db.transaction((replay, proposal, validation) => {
    proposal = normalizeProposal(proposal);
    const newProject = proposal.transition === 'CREATE' && proposal.targetProjectId === 'NEW';
    if (!(newProject ? keys(validation, ['approved', 'reason', 'approvedDisplayName']) && nonempty(validation.approvedDisplayName)
      : keys(validation, ['approved', 'reason'])) || validation.approved !== true || !nonempty(validation.reason)) fail('VALIDATION_REJECTED');
    if (byCandidate.get(replay.candidateId)?.status === 'COMMITTED') return committedResult(replay.candidateId);
    const current = buildReplay(replay.candidateId);
    if (canonicalJson(current) !== canonicalJson(replay)) fail('STALE_REPLAY');
    checkTransition(current, proposal);
    if (proposal.transition === 'KEEP_AMBIGUOUS') fail('UNSUPPORTED_TRANSITION');
    const projectId = proposal.transition === 'CREATE' && proposal.targetProjectId === 'NEW' ? `project_${randomUUID()}` : proposal.targetProjectId;
    if (newProject) db.prepare('INSERT INTO memory_projects(project_id, display_name) VALUES (?, ?)').run(projectId, validation.approvedDisplayName);
    const project = current.projects.find(p => p.projectId === projectId);
    const previousId = ['CREATE', 'EXPAND'].includes(proposal.transition) ? null
      : current.candidate.payload.kind === 'STATUS' ? project.currentStatus.stateId : proposal.targetClaimId;
    let nextId = previousId;
    if (['CREATE', 'EXPAND', 'SUPERSEDE', 'REVISE'].includes(proposal.transition)) {
      nextId = `project_state_${randomUUID()}`;
      const payload = current.candidate.payload;
      db.prepare('INSERT INTO memory_project_states(state_id,project_id,candidate_id,kind,value) VALUES(?,?,?,?,?)')
        .run(nextId, projectId, current.candidateId, payload.kind, payload.kind === 'STATUS' ? payload.status : payload.claimText);
    } else if (proposal.transition === 'INVALIDATE') nextId = null;
    const transitionId = `project_transition_${randomUUID()}`;
    db.prepare('INSERT INTO memory_project_transitions(transition_id,project_id,candidate_id,previous_state_id,next_state_id,transition,change_class,replay_sha256) VALUES(?,?,?,?,?,?,?,?)')
      .run(transitionId, projectId, current.candidateId, previousId, nextId, proposal.transition, proposal.changeClass, current.replaySha256);
    const insertEvidence = db.prepare('INSERT INTO memory_project_transition_evidence VALUES(?,?)');
    proposal.evidenceIds.forEach(id => insertEvidence.run(transitionId, id));
    db.prepare('UPDATE memory_project_candidates SET status=\'COMMITTED\', pending_reason=NULL, proposal_json=?, validation_json=? WHERE candidate_id=?')
      .run(canonicalJson(proposal), canonicalJson(validation), current.candidateId);
    return committedResult(current.candidateId);
  });
  return { prepare, defer, commit, readProjects, readReplay: db.transaction(buildReplay) };
}

module.exports = { PROJECT_PROPOSAL_SCHEMA, normalizeProposal, checkTransition, createProjectStore, hash };
