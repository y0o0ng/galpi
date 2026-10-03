'use strict';

const { validateEpisode, discoverEvidenceBundles } = require('./bundle-builder');
const { validateCandidate } = require('./router');

const keys = (value, expected) => value !== null && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value))
  && Object.getOwnPropertySymbols(value).length === 0
  && Object.keys(value).sort().join(',') === [...expected].sort().join(',');
const text = value => typeof value === 'string' && Boolean(value.trim());

function invalid() { throw new TypeError('INVALID_STAGE_RESULT'); }

function judgment(value, dispositions) {
  if (!keys(value, ['disposition', 'reason'])
      || !dispositions.includes(value.disposition) || !text(value.reason)) invalid();
  return structuredClone(value);
}

function extractedCandidate(value, evidence) {
  if (!keys(value, ['disposition', 'semanticFamily', 'payload', 'evidenceTurnIds'])
      || value.disposition !== 'EXTRACTED' || !Array.isArray(value.evidenceTurnIds)
      || !value.evidenceTurnIds.length
      || new Set(value.evidenceTurnIds).size !== value.evidenceTurnIds.length
      || value.evidenceTurnIds.some(id => !evidence.some(turn => turn.turnId === id))) invalid();
  const selected = new Set(value.evidenceTurnIds);
  // Addresses and their order come from the source, never from model output.
  return structuredClone(validateCandidate({ schemaVersion: 1,
    semanticFamily: value.semanticFamily, payload: value.payload,
    sources: evidence.filter(turn => selected.has(turn.turnId)).map(turn => ({
      sourceDomain: 'conversation_message', sourceKey: String(turn.messageId),
    })),
  }));
}

// Development composition only. Callbacks are trusted adapters, not model output.
// No implicit provider, retry, persistence, approval or production entry point.
async function runFormationEpisode(episode, {
  selectBundles, assessAmbiguity, assessDurability, extractCandidate, prepareReview,
} = {}) {
  if ([selectBundles, assessAmbiguity, assessDurability, extractCandidate, prepareReview]
    .some(callback => typeof callback !== 'function')) throw new TypeError('EXPLICIT_STAGE_CALLBACKS_REQUIRED');
  const snapshot = structuredClone(validateEpisode(episode));
  const built = await discoverEvidenceBundles(snapshot, selectBundles);
  const results = [];
  for (const bundle of built.bundles) {
    const ids = new Set(bundle.evidenceSpanRefs.map(span => span.turnId));
    const evidence = snapshot.turns.filter(turn => ids.has(turn.turnId));
    const input = { bundle, evidence };
    const result = { bundle, ambiguity: null, durability: null, extraction: null };
    let stage = 'AMBIGUITY';
    try {
      result.ambiguity = judgment(await assessAmbiguity(structuredClone(input)), ['CLEAR', 'ESCALATE']);
      if (result.ambiguity.disposition === 'ESCALATE') {
        results.push({ ...result, status: 'MEANING_DEFERRED', reason: result.ambiguity.reason });
        continue;
      }
      stage = 'DURABILITY';
      result.durability = judgment(await assessDurability(structuredClone(input)), ['WRITE', 'NO_WRITE']);
      if (result.durability.disposition === 'NO_WRITE') {
        results.push({ ...result, status: 'NO_WRITE', reason: result.durability.reason });
        continue;
      }
      stage = 'EXTRACTION';
      const extraction = await extractCandidate(structuredClone({ ...input,
        durabilityReason: result.durability.reason }));
      if (extraction?.disposition === 'DEFERRED') {
        result.extraction = judgment(extraction, ['DEFERRED']);
        results.push({ ...result, status: 'EXTRACTION_DEFERRED', reason: result.extraction.reason });
        continue;
      }
      const candidate = extractedCandidate(extraction, evidence);
      result.extraction = structuredClone(extraction);
      result.candidate = candidate;
      stage = 'REVIEW';
      const prepared = await prepareReview(structuredClone(candidate));
      if (prepared?.status === 'COMMITTED' && text(prepared.candidateId) && text(prepared.transitionId)) {
        // Existing handler's idempotent return: this run did not approve or commit it.
        results.push({ ...result, status: 'ALREADY_COMMITTED', candidateId: prepared.candidateId,
          transitionId: prepared.transitionId });
      } else if (prepared?.status === 'PENDING' && prepared.reason === 'HUMAN_REVIEW_REQUIRED'
          && text(prepared.candidateId) && text(prepared.review?.reviewId)
          && text(prepared.review.packageSha256) && prepared.review.decision === null) {
        results.push({ ...result, status: 'REVIEW_PREPARED', candidateId: prepared.candidateId,
          reviewId: prepared.review.reviewId, packageSha256: prepared.review.packageSha256 });
      } else invalid();
    } catch {
      // Adapter errors may contain private prompts/provider bodies; never copy them.
      results.push({ ...result, status: 'PROCESSING_ERROR', failedStage: stage,
        reason: `${stage}_FAILED` });
    }
  }
  return { schemaVersion: 1, sourceEpisodeSha256: built.sourceEpisodeSha256,
    semanticCompleteness: built.semanticCompleteness, results };
}

module.exports = { runFormationEpisode };
