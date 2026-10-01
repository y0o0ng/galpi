'use strict';

const { normalizeCandidate, createGeneralFactStore } = require('./general-fact');
const { createMemoryStorageRouter } = require('./router');
const { createGeneralFactReviewHandler } = require('./general-fact-proposer');

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

// Explicit owner-authored development ingress, not extraction or WRITE/NO_WRITE triage.
function createDevelopmentCandidateInput({ db, evidenceRegistry, proposeTransition }) {
  const store = createGeneralFactStore(db, evidenceRegistry);
  const route = createMemoryStorageRouter({ evidenceRegistry,
    transitionHandlers: new Map([['general_fact', createGeneralFactReviewHandler({ db, evidenceRegistry, proposeTransition })]]) });
  let busy = false;

  return async function prepareInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).sort().join(',') !== 'payload,sourceText,submissionId'
        || typeof input.submissionId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.submissionId)
        || typeof input.sourceText !== 'string' || !input.sourceText.trim() || input.sourceText.length > 8000) {
      fail('INVALID_CANDIDATE_INPUT');
    }
    const normalized = normalizeCandidate({ schemaVersion: 1, semanticFamily: 'general_fact', payload: input.payload,
      sources: [{ sourceDomain: 'conversation_message', sourceKey: '1' }] });
    const sessionId = `general-fact-development-input:${input.submissionId}`;
    if (db.prepare('SELECT id FROM messages WHERE session_id = ?').get(sessionId)) fail('CANDIDATE_INPUT_ALREADY_SUBMITTED');
    if (busy) fail('CANDIDATE_INPUT_IN_PROGRESS');
    busy = true;
    try {
      // ponytail: one localhost writer; add a UNIQUE request identity if multi-process ingress is introduced.
      const candidate = db.transaction(() => {
        const inserted = db.prepare(`INSERT INTO messages (session_id, role, content, created_at)
          VALUES (?, 'user', ?, strftime('%s','now'))`).run(sessionId, input.sourceText);
        const candidate = { ...normalized,
          sources: [{ sourceDomain: 'conversation_message', sourceKey: String(inserted.lastInsertRowid) }] };
        store.prepare({ candidate, evidenceRefs: evidenceRegistry.registerSources(candidate.sources) });
        return candidate;
      })();
      // A durable source/candidate precedes dispatch. An interrupted submission is never auto-retried.
      const result = await route(candidate);
      return { status: result.status, candidateId: result.candidateId, reviewId: result.review.reviewId };
    } finally { busy = false; }
  };
}

module.exports = { createDevelopmentCandidateInput };
