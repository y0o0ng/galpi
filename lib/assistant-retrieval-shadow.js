'use strict';

const {
  DEFAULT_SHADOW_RETRIEVAL_LIMITS,
  buildShadowRetrieval,
} = require('./assistant-retrieval');

function parseStoredEmbedding(value) {
  if (!value) return null;
  try {
    const embedding = JSON.parse(value);
    return Array.isArray(embedding) && embedding.every(Number.isFinite) ? embedding : null;
  } catch {
    return null;
  }
}

function mergeShadowNoteCandidates(activeNotes, rankedCandidates, queryEmbedding, limits) {
  const selected = [];
  const seen = new Set();
  for (const note of Array.isArray(activeNotes) ? activeNotes : []) {
    if (selected.length >= limits.maxNotes) break;
    if (!note?.filename || seen.has(note.filename)) continue;
    selected.push({
      filename: note.filename,
      title: note.title || note.filename,
      score: null,
      explicit: true,
    });
    seen.add(note.filename);
  }

  const minimumScore = queryEmbedding ? limits.minEmbeddingScore : limits.minKeywordScore;
  for (const note of Array.isArray(rankedCandidates) ? rankedCandidates : []) {
    if (selected.length >= limits.maxNotes) break;
    if (!note?.filename || seen.has(note.filename) || note.score < minimumScore) continue;
    selected.push({ ...note, explicit: false });
    seen.add(note.filename);
  }
  return selected;
}

function createAssistantRetrievalShadow({
  getChunksByNote,
  insertRun,
  onRecordError = () => {},
  limits: limitOverrides = {},
} = {}) {
  if (typeof getChunksByNote !== 'function') throw new TypeError('청크 조회 함수가 필요합니다.');
  if (typeof insertRun !== 'function') throw new TypeError('shadow trace 저장 함수가 필요합니다.');
  const limits = { ...DEFAULT_SHADOW_RETRIEVAL_LIMITS, ...limitOverrides };

  function retrieve({ query, queryEmbedding = null, activeNotes = [], rankedCandidates = [] } = {}) {
    const noteCandidates = mergeShadowNoteCandidates(
      activeNotes,
      rankedCandidates,
      queryEmbedding,
      limits,
    );
    const chunks = noteCandidates.flatMap(note => getChunksByNote(note.filename).map(chunk => ({
      ...chunk,
      embedding: parseStoredEmbedding(chunk.embedding),
    })));
    return buildShadowRetrieval({
      query,
      queryEmbedding,
      noteCandidates,
      chunks,
      limits,
    });
  }

  function record({ sessionId, mode, retrieval, latencyMs, error = null } = {}) {
    try {
      insertRun({
        sessionId: sessionId || null,
        mode: String(mode || 'unknown').slice(0, 40),
        notesJson: JSON.stringify((retrieval?.notes || []).map(note => ({
          filename: note.filename,
          score: note.score,
          explicit: note.explicit,
        }))),
        chunksJson: JSON.stringify((retrieval?.chunks || []).map(chunk => ({
          chunkId: chunk.chunkId,
          noteFilename: chunk.noteFilename,
          score: chunk.score,
        }))),
        contextChars: retrieval?.contextChars || 0,
        latencyMs: Math.max(0, Math.round(latencyMs || 0)),
        error: error ? String(error.message || error).slice(0, 500) : null,
      });
      return true;
    } catch (recordError) {
      onRecordError(recordError);
      return false;
    }
  }

  function toPublicResult(retrieval) {
    return {
      notes: (retrieval?.notes || []).map(note => ({
        filename: note.filename,
        title: note.title,
        score: note.score,
      })),
      chunks: (retrieval?.chunks || []).map(chunk => ({
        chunkId: chunk.chunkId,
        noteFilename: chunk.noteFilename,
        score: chunk.score,
      })),
      contextChars: retrieval?.contextChars || 0,
    };
  }

  return { record, retrieve, toPublicResult };
}

module.exports = {
  createAssistantRetrievalShadow,
  parseStoredEmbedding,
};
