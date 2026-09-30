'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { createGeneralFactStore, normalizeProposal, checkTransition, canonicalJson } = require('./general-fact');

const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const isSha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function hasKeys(input, required, optional = []) {
  return input !== null && typeof input === 'object'
    && [Object.prototype, null].includes(Object.getPrototypeOf(input))
    && Object.getOwnPropertySymbols(input).length === 0
    && required.every(key => Object.hasOwn(input, key))
    && Object.keys(input).every(key => [...required, ...optional].includes(key));
}

function packageHash(candidateId, replaySha256, proposalSha256) {
  return sha256(canonicalJson({ schemaVersion: 1, candidateId, replaySha256, proposalSha256 }));
}

function createGeneralFactReviewStore(db, evidenceRegistry) {
  const store = createGeneralFactStore(db, evidenceRegistry);
  const byId = db.prepare('SELECT * FROM memory_general_fact_reviews WHERE review_id = ?');
  const candidateStatus = db.prepare('SELECT status FROM memory_general_fact_candidates WHERE candidate_id = ?');

  function requirePending(candidateId) {
    const candidate = candidateStatus.get(candidateId);
    if (!candidate) fail('CANDIDATE_NOT_FOUND');
    if (candidate.status !== 'PENDING') fail('CANDIDATE_ALREADY_COMMITTED');
  }

  function get(reviewId) {
    if (typeof reviewId !== 'string') fail('INVALID_REVIEW_ID');
    const row = byId.get(reviewId);
    if (!row) fail('REVIEW_NOT_FOUND');
    const proposal = normalizeProposal(JSON.parse(row.proposal_json));
    if (canonicalJson(proposal) !== row.proposal_json
        || sha256(row.proposal_json) !== row.proposal_sha256
        || packageHash(row.candidate_id, row.replay_sha256, row.proposal_sha256) !== row.package_sha256) {
      fail('INVALID_REVIEW_INTEGRITY');
    }
    if (row.decision === 'APPROVE') {
      const committed = db.prepare(`SELECT t.candidate_id, t.replay_sha256, t.transition, t.change_class,
          c.status, c.proposal_json FROM memory_general_fact_transitions t
        JOIN memory_general_fact_candidates c USING (candidate_id) WHERE t.transition_id = ?`).get(row.transition_id);
      if (!committed || committed.candidate_id !== row.candidate_id || committed.status !== 'COMMITTED'
          || committed.replay_sha256 !== row.replay_sha256 || committed.proposal_json !== row.proposal_json
          || committed.transition !== proposal.transition || committed.change_class !== proposal.changeClass) {
        fail('INVALID_REVIEW_INTEGRITY');
      }
    }
    return Object.freeze({
      reviewId: row.review_id, candidateId: row.candidate_id,
      replaySha256: row.replay_sha256, proposalSha256: row.proposal_sha256,
      packageSha256: row.package_sha256, proposal, createdAt: row.created_at,
      decision: row.decision, reason: row.decision_reason, decidedAt: row.decided_at,
      transitionId: row.transition_id,
    });
  }

  function currentReplay(review) {
    requirePending(review.candidateId);
    const replay = store.readReplay(review.candidateId);
    if (replay.replaySha256 !== review.replaySha256) fail('STALE_REVIEW');
    checkTransition(replay, review.proposal);
    return replay;
  }

  const create = db.transaction(input => {
    if (!hasKeys(input, ['candidateId', 'replaySha256', 'proposal'])
        || typeof input.candidateId !== 'string' || !isSha256(input.replaySha256)) fail('INVALID_REVIEW_INPUT');
    const proposal = normalizeProposal(input.proposal);
    currentReplay({ ...input, proposal });
    const proposalJson = canonicalJson(proposal);
    const proposalSha256 = sha256(proposalJson);
    // Each new review is a distinct attempt; a held/rejected attempt stays immutable.
    const reviewId = `gf_review_${randomUUID()}`;
    db.prepare(`INSERT INTO memory_general_fact_reviews
      (review_id, candidate_id, replay_sha256, proposal_json, proposal_sha256, package_sha256)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(reviewId, input.candidateId, input.replaySha256, proposalJson, proposalSha256,
        packageHash(input.candidateId, input.replaySha256, proposalSha256));
    return get(reviewId);
  });

  const read = db.transaction(reviewId => {
    const review = get(reviewId);
    const replayPackage = currentReplay(review);
    const transition = review.proposal.transition;
    return Object.freeze({
      review, replayPackage,
      preview: Object.freeze({
        isProposal: true,
        currentValue: replayPackage.currentState?.value ?? null,
        resultingCurrentValue: transition === 'INVALIDATE' ? null
          : transition === 'NO_CHANGE' ? replayPackage.currentState.value : replayPackage.candidate.payload.value,
        previousStateDisposition: transition === 'CREATE' ? null : {
          SUPERSEDE: 'HISTORICAL', REVISE: 'CORRECTED', INVALIDATE: 'INVALIDATED', NO_CHANGE: 'CURRENT',
        }[transition],
      }),
    });
  });

  // Only the trusted owner-review adapter may call this. No proposer/model calls it.
  const decide = db.transaction((reviewId, input) => {
    if (!hasKeys(input, ['choice', 'packageSha256'], ['reason'])
        || !['APPROVE', 'HOLD', 'REJECT_PROPOSAL'].includes(input.choice)
        || !isSha256(input.packageSha256)
        || (Object.hasOwn(input, 'reason') && (typeof input.reason !== 'string' || input.reason.length > 2000))) {
      fail('INVALID_REVIEW_DECISION');
    }
    const reason = input.reason ?? '';
    const review = get(reviewId);
    if (input.packageSha256 !== review.packageSha256) fail('REVIEW_PACKAGE_MISMATCH');
    if (review.decision !== null) {
      if (review.decision !== input.choice || review.reason !== reason) fail('REVIEW_DECISION_CONFLICT');
      return review; // Idempotent retransmission, including after an approved commit.
    }
    requirePending(review.candidateId);
    let transitionId = null;
    if (input.choice === 'APPROVE') {
      const replay = currentReplay(review);
      const result = store.commit(replay, review.proposal, {
        approved: true, reason: reason.trim() || 'HUMAN_APPROVAL',
      });
      transitionId = result.transitionId;
    } else {
      const diagnostic = `HUMAN_${input.choice}`;
      store.defer(review.candidateId, diagnostic, review.proposal, {
        approved: false, reason: reason.trim() || diagnostic,
      });
    }
    db.prepare(`UPDATE memory_general_fact_reviews
      SET decision = ?, decision_reason = ?, decided_at = strftime('%s','now'), transition_id = ?
      WHERE review_id = ? AND decision IS NULL`).run(input.choice, reason, transitionId, reviewId);
    return get(reviewId);
  });

  function listPending() {
    return db.prepare(`SELECT r.review_id AS reviewId, r.candidate_id AS candidateId,
        r.created_at AS createdAt, r.package_sha256 AS packageSha256
      FROM memory_general_fact_reviews r JOIN memory_general_fact_candidates c USING (candidate_id)
      WHERE r.decision IS NULL AND c.status = 'PENDING' ORDER BY r.created_at, r.review_id`).all();
  }

  return { create, get, read, decide, listPending };
}

module.exports = { createGeneralFactReviewStore };
