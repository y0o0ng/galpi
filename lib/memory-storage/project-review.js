'use strict';

const { randomUUID } = require('node:crypto');
const { canonicalJson } = require('./general-fact');
const { createProjectStore, normalizeProposal, checkTransition, hash } = require('./project');

const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const tags = ['WRONG_TARGET', 'WRONG_CONTENT', 'OTHER'];
function fail(code) { const error = Error(code); error.code = code; throw error; }
const packageHash = (candidateId, replaySha256, proposalSha256) => hash(canonicalJson({ schemaVersion: 1, candidateId, replaySha256, proposalSha256 }));

function createProjectReviewStore(db, evidenceRegistry) {
  const store = createProjectStore(db, evidenceRegistry);
  function get(reviewId) {
    const row = db.prepare('SELECT * FROM memory_project_reviews WHERE review_id=?').get(reviewId);
    if (!row) fail('REVIEW_NOT_FOUND');
    const proposal = normalizeProposal(JSON.parse(row.proposal_json));
    if (canonicalJson(proposal) !== row.proposal_json || hash(row.proposal_json) !== row.proposal_sha256
      || packageHash(row.candidate_id, row.replay_sha256, row.proposal_sha256) !== row.package_sha256) fail('INVALID_REVIEW_INTEGRITY');
    if (row.decision === null ? (row.decision_reason !== null || row.decided_at !== null || row.transition_id !== null || row.rejection_tag !== null)
      : (typeof row.decision_reason !== 'string' || row.decided_at === null
        || (row.decision === 'REJECT_PROPOSAL' ? !tags.includes(row.rejection_tag) : row.rejection_tag !== null)
        || (row.decision === 'APPROVE' ? row.transition_id === null : row.transition_id !== null))) fail('INVALID_REVIEW_INTEGRITY');
    if (row.decision === 'APPROVE') {
      const committed = db.prepare('SELECT t.*,c.status,c.proposal_json FROM memory_project_transitions t JOIN memory_project_candidates c USING(candidate_id) WHERE t.transition_id=?').get(row.transition_id);
      if (!committed || committed.candidate_id !== row.candidate_id || committed.status !== 'COMMITTED'
          || committed.replay_sha256 !== row.replay_sha256 || committed.proposal_json !== row.proposal_json
          || committed.transition !== proposal.transition || committed.change_class !== proposal.changeClass) fail('INVALID_REVIEW_INTEGRITY');
    }
    return Object.freeze({ reviewId: row.review_id, candidateId: row.candidate_id, replaySha256: row.replay_sha256,
      proposalSha256: row.proposal_sha256, packageSha256: row.package_sha256, proposal, createdAt: row.created_at,
      decision: row.decision, reason: row.decision_reason, rejectionTag: row.rejection_tag, decidedAt: row.decided_at,
      transitionId: row.transition_id, requiresRejectionTag: true });
  }
  function currentReplay(review) {
    const row = db.prepare('SELECT status FROM memory_project_candidates WHERE candidate_id=?').get(review.candidateId);
    if (!row) fail('CANDIDATE_NOT_FOUND');
    if (row.status !== 'PENDING') fail('CANDIDATE_ALREADY_COMMITTED');
    const replay = store.readReplay(review.candidateId);
    if (replay.replaySha256 !== review.replaySha256) fail('STALE_REVIEW');
    checkTransition(replay, review.proposal);
    if (review.proposal.transition === 'KEEP_AMBIGUOUS') fail('UNSUPPORTED_TRANSITION');
    return replay;
  }
  const create = db.transaction(input => {
    if (!input || Object.keys(input).sort().join(',') !== 'candidateId,proposal,replaySha256'
      || typeof input.candidateId !== 'string' || !sha(input.replaySha256)) fail('INVALID_REVIEW_INPUT');
    const proposal = normalizeProposal(input.proposal);
    currentReplay({ ...input, proposal });
    const json = canonicalJson(proposal), proposalSha256 = hash(json), reviewId = `project_review_${randomUUID()}`;
    db.prepare('INSERT INTO memory_project_reviews(review_id,candidate_id,replay_sha256,proposal_json,proposal_sha256,package_sha256) VALUES(?,?,?,?,?,?)')
      .run(reviewId, input.candidateId, input.replaySha256, json, proposalSha256, packageHash(input.candidateId, input.replaySha256, proposalSha256));
    return get(reviewId);
  });
  const read = db.transaction(reviewId => {
    const review = get(reviewId), replayPackage = currentReplay(review);
    const project = replayPackage.projects.find(p => p.projectId === review.proposal.targetProjectId) || null;
    const touched = replayPackage.candidate.payload.kind === 'STATUS' ? project?.currentStatus
      : project?.currentClaims.find(s => s.stateId === review.proposal.targetClaimId);
    const transition = review.proposal.transition;
    const next = replayPackage.candidate.payload.kind === 'STATUS' ? replayPackage.candidate.payload.status : replayPackage.candidate.payload.claimText;
    const ids = new Set(project?.history.filter(h => h.nextStateId === touched?.stateId && h.transition !== 'NO_CHANGE').flatMap(h => h.evidenceIds) || []);
    return { review, replayPackage: { ...replayPackage, originalSupport: replayPackage.evidence.filter(e => ids.has(e.evidenceRef.evidenceId)) },
      preview: { isProposal: true, currentValue: touched?.value ?? null,
        resultingCurrentValue: transition === 'INVALIDATE' ? null : transition === 'NO_CHANGE' ? touched.value : next,
        previousStateDisposition: { SUPERSEDE: 'HISTORICAL', REVISE: 'CORRECTED', INVALIDATE: 'INVALIDATED', NO_CHANGE: 'CURRENT' }[transition] || null,
        project, touched: touched || null } };
  });
  const decide = db.transaction((reviewId, input) => {
    if (!input || Object.keys(input).some(k => !['choice', 'packageSha256', 'reason', 'rejectionTag'].includes(k))
      || !['APPROVE', 'HOLD', 'REJECT_PROPOSAL'].includes(input.choice) || !sha(input.packageSha256)
      || (input.reason !== undefined && (typeof input.reason !== 'string' || input.reason.length > 2000))
      || (input.choice === 'REJECT_PROPOSAL' ? !tags.includes(input.rejectionTag) : input.rejectionTag !== undefined)) fail('INVALID_REVIEW_DECISION');
    const review = get(reviewId), reason = input.reason ?? '', tag = input.rejectionTag ?? null;
    if (review.packageSha256 !== input.packageSha256) fail('REVIEW_PACKAGE_MISMATCH');
    if (review.decision !== null) {
      if (review.decision !== input.choice || review.reason !== reason || review.rejectionTag !== tag) fail('REVIEW_DECISION_CONFLICT');
      return review;
    }
    const candidate = db.prepare('SELECT status FROM memory_project_candidates WHERE candidate_id=?').get(review.candidateId);
    if (!candidate) fail('CANDIDATE_NOT_FOUND');
    if (candidate.status !== 'PENDING') fail('CANDIDATE_ALREADY_COMMITTED');
    let transitionId = null;
    if (input.choice === 'APPROVE') transitionId = store.commit(currentReplay(review), review.proposal, { approved: true, reason: reason.trim() || 'HUMAN_APPROVAL' }).transitionId;
    else store.defer(review.candidateId, `HUMAN_${input.choice}`, review.proposal, { approved: false, reason: reason.trim() || `HUMAN_${input.choice}` });
    db.prepare('UPDATE memory_project_reviews SET decision=?, decision_reason=?, rejection_tag=?, decided_at=strftime(\'%s\',\'now\'), transition_id=? WHERE review_id=? AND decision IS NULL')
      .run(input.choice, reason, tag, transitionId, reviewId);
    return get(reviewId);
  });
  function listPending() {
    return db.prepare(`SELECT r.review_id AS reviewId,r.candidate_id AS candidateId,r.created_at AS createdAt,r.package_sha256 AS packageSha256
      FROM memory_project_reviews r JOIN memory_project_candidates c USING(candidate_id)
      WHERE r.decision IS NULL AND c.status='PENDING' ORDER BY r.created_at,r.review_id`).all();
  }
  return { create, get, read, decide, listPending };
}

module.exports = { createProjectReviewStore };
