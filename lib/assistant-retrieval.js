'use strict';

const DEFAULT_SEARCH_STOP_WORDS = new Set([
  '이', '가', '은', '는', '을', '를', '에', '의', '와', '과', '도', '로', '만',
  '내', '네', '그', '저', '것', '수', '더', '한', '두', '때', '등',
  '그리고', '그런데', '저번에', '우리가', '관련', '내용', '알려줘', '호출해줘',
  '불러와줘', '꺼내줘', '해줘', '해줘요', '해주세요', '알고', '싶어', '있어',
  '없어', '어떤', '어떻게', '무엇', '뭐가', '뭔지', '대해', '대한', '관한',
  '이번', '저번', '지난', '이런', '저런', '그런', '이것', '저것', '그것',
  '정리', '설명', '요약', '노트', '저장', '기록',
]);

const DEFAULT_SHADOW_RETRIEVAL_LIMITS = Object.freeze({
  maxNotes: 3,
  maxChunks: 6,
  maxChunksPerNote: 2,
  maxCharsPerChunk: 1400,
  maxContextChars: 8000,
  minEmbeddingScore: 0.18,
  minKeywordScore: 2,
});

function extractQueryTerms(query, stopWords = DEFAULT_SEARCH_STOP_WORDS) {
  return [...new Set(
    String(query || '').toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .map(term => term.trim())
      .filter(term => term.length >= 1 && !stopWords.has(term))
  )];
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    if (!Number.isFinite(a[index]) || !Number.isFinite(b[index])) return 0;
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

function countOccurrences(text, term) {
  return (text.match(new RegExp(term, 'g')) || []).length;
}

function rankNoteCandidates({
  query,
  queryEmbedding = null,
  notes = [],
  limit = 8,
  keywordWeight = 0.35,
  embeddingWeight = 0.65,
  keywordNormalizer = 30,
  minEmbeddingScore = 0.08,
  minKeywordScore = 2,
} = {}) {
  const terms = extractQueryTerms(query);
  if (terms.length === 0 && !queryEmbedding) return [];

  const normalizedNotes = notes.filter(note => note && typeof note === 'object').map(note => {
    const title = String(note.title || '');
    const body = String(note.body || '');
    const tags = String(note.tagsLower || note.tags || '');
    return {
      ...note,
      title,
      body,
      titleLower: note.titleLower || title.toLowerCase(),
      bodyLower: note.bodyLower || body.toLowerCase(),
      tagsLower: tags.toLowerCase(),
    };
  });

  const documentCount = normalizedNotes.length || 1;
  const termDocumentFrequency = new Map(terms.map(term => [
    term,
    normalizedNotes.filter(note => (
      note.titleLower.includes(term) ||
      note.bodyLower.includes(term) ||
      note.tagsLower.includes(term)
    )).length,
  ]));

  const results = [];
  for (const note of normalizedNotes) {
    let keywordScore = 0;
    for (const term of terms) {
      const documentFrequency = termDocumentFrequency.get(term) || 1;
      const inverseDocumentFrequency = Math.log(
        (documentCount + 1) / (documentFrequency + 1)
      ) + 1;
      const termFrequency = countOccurrences(note.titleLower, term) * 5
        + countOccurrences(note.bodyLower, term)
        + countOccurrences(note.tagsLower, term) * 20;
      keywordScore += termFrequency * inverseDocumentFrequency;
    }

    const embeddingScore = queryEmbedding && note.embedding
      ? Math.max(0, cosineSimilarity(queryEmbedding, note.embedding))
      : null;
    const finalScore = embeddingScore !== null
      ? keywordWeight * Math.min(keywordScore / keywordNormalizer, 1)
        + embeddingWeight * embeddingScore
      : keywordScore;
    const minimumScore = embeddingScore !== null ? minEmbeddingScore : minKeywordScore;
    if (finalScore < minimumScore) continue;

    const firstHit = terms
      .map(term => note.bodyLower.indexOf(term))
      .filter(index => index >= 0)
      .sort((a, b) => a - b)[0] ?? 0;
    const excerptStart = Math.max(0, firstHit - 80);
    const excerpt = note.body
      .slice(excerptStart, excerptStart + 300)
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    results.push({
      filename: note.filename,
      title: note.title,
      excerpt,
      score: finalScore,
    });
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit));
}

function rankChunkCandidates({
  query,
  queryEmbedding = null,
  chunks = [],
  limit = DEFAULT_SHADOW_RETRIEVAL_LIMITS.maxChunks,
  maxChunksPerNote = DEFAULT_SHADOW_RETRIEVAL_LIMITS.maxChunksPerNote,
  keywordWeight = 0.35,
  embeddingWeight = 0.65,
  keywordNormalizer = 15,
  minEmbeddingScore = DEFAULT_SHADOW_RETRIEVAL_LIMITS.minEmbeddingScore,
  minKeywordScore = DEFAULT_SHADOW_RETRIEVAL_LIMITS.minKeywordScore,
} = {}) {
  const terms = extractQueryTerms(query);
  if (terms.length === 0 && !queryEmbedding) return [];

  const normalizedChunks = chunks
    .filter(chunk => (
      chunk &&
      typeof chunk === 'object' &&
      chunk.chunkId &&
      chunk.noteFilename &&
      (!chunk.indexStatus || chunk.indexStatus === 'ready') &&
      typeof chunk.content === 'string'
    ))
    .map(chunk => {
      const noteTitle = String(chunk.noteTitle || '');
      return {
        chunkId: String(chunk.chunkId),
        noteFilename: String(chunk.noteFilename),
        noteTitle,
        chunkType: String(chunk.chunkType || 'topic_qa'),
        content: chunk.content,
        indexStatus: chunk.indexStatus || 'ready',
        titleLower: noteTitle.toLowerCase(),
        contentLower: chunk.content.toLowerCase(),
        embedding: chunk.embedding,
        createdAt: chunk.createdAt ?? null,
        updatedAt: chunk.updatedAt ?? null,
      };
    });

  const documentCount = normalizedChunks.length || 1;
  const termDocumentFrequency = new Map(terms.map(term => [
    term,
    normalizedChunks.filter(chunk => (
      chunk.titleLower.includes(term) || chunk.contentLower.includes(term)
    )).length,
  ]));

  const scored = [];
  for (const chunk of normalizedChunks) {
    let keywordScore = 0;
    for (const term of terms) {
      const documentFrequency = termDocumentFrequency.get(term) || 1;
      const inverseDocumentFrequency = Math.log(
        (documentCount + 1) / (documentFrequency + 1)
      ) + 1;
      const termFrequency = countOccurrences(chunk.titleLower, term) * 3
        + countOccurrences(chunk.contentLower, term);
      keywordScore += termFrequency * inverseDocumentFrequency;
    }

    const embeddingScore = queryEmbedding && chunk.embedding
      ? Math.max(0, cosineSimilarity(queryEmbedding, chunk.embedding))
      : null;
    const finalScore = embeddingScore !== null
      ? keywordWeight * Math.min(keywordScore / keywordNormalizer, 1)
        + embeddingWeight * embeddingScore
      : keywordScore;
    const minimumScore = embeddingScore !== null ? minEmbeddingScore : minKeywordScore;
    if (!Number.isFinite(finalScore) || finalScore < minimumScore) continue;

    scored.push({
      chunkId: chunk.chunkId,
      noteFilename: chunk.noteFilename,
      noteTitle: chunk.noteTitle,
      chunkType: chunk.chunkType,
      content: chunk.content,
      createdAt: chunk.createdAt,
      updatedAt: chunk.updatedAt,
      score: finalScore,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const selected = [];
  const seenChunkIds = new Set();
  const noteCounts = new Map();
  for (const chunk of scored) {
    if (selected.length >= Math.max(0, limit)) break;
    if (seenChunkIds.has(chunk.chunkId)) continue;
    const noteCount = noteCounts.get(chunk.noteFilename) || 0;
    if (noteCount >= Math.max(1, maxChunksPerNote)) continue;
    selected.push(chunk);
    seenChunkIds.add(chunk.chunkId);
    noteCounts.set(chunk.noteFilename, noteCount + 1);
  }

  return selected;
}

function truncateWithMarker(text, limit) {
  const value = String(text || '');
  if (value.length <= limit) return value;
  const marker = '\n...(이하 생략)';
  if (limit <= marker.length) return value.slice(0, Math.max(0, limit));
  return value.slice(0, limit - marker.length) + marker;
}

function escapeContextAttribute(value) {
  return String(value || '').replace(/[&"<>]/g, character => ({
    '&': '&amp;',
    '"': '&quot;',
    '<': '&lt;',
    '>': '&gt;',
  })[character]);
}

function buildChunkContext(chunks, {
  maxChunks = DEFAULT_SHADOW_RETRIEVAL_LIMITS.maxChunks,
  maxCharsPerChunk = DEFAULT_SHADOW_RETRIEVAL_LIMITS.maxCharsPerChunk,
  maxContextChars = DEFAULT_SHADOW_RETRIEVAL_LIMITS.maxContextChars,
} = {}) {
  const open = '<retrieval>\n';
  const close = '\n</retrieval>';
  const innerLimit = Math.max(0, maxContextChars - open.length - close.length);
  let inner = '';
  const selected = [];

  for (const chunk of (Array.isArray(chunks) ? chunks : []).slice(0, Math.max(0, maxChunks))) {
    if (!chunk?.chunkId || !chunk?.noteFilename || typeof chunk.content !== 'string') continue;
    const separator = inner ? '\n\n' : '';
    const prefix = `<qa note="${escapeContextAttribute(chunk.noteFilename)}" chunk_id="${escapeContextAttribute(chunk.chunkId)}">\n`;
    const suffix = '\n</qa>';
    const available = innerLimit - inner.length - separator.length - prefix.length - suffix.length;
    if (available <= 0) break;

    const contentLimit = Math.min(Math.max(0, maxCharsPerChunk), available);
    const content = truncateWithMarker(chunk.content, contentLimit);
    if (!content) continue;
    inner += separator + prefix + content + suffix;
    selected.push({ ...chunk, content });
  }

  const context = selected.length > 0 ? open + inner + close : '';
  return {
    chunks: selected,
    context,
    contextChars: context.length,
  };
}

function buildShadowRetrieval({
  query,
  queryEmbedding = null,
  noteCandidates = [],
  chunks = [],
  limits = DEFAULT_SHADOW_RETRIEVAL_LIMITS,
} = {}) {
  const maxNotes = limits.maxNotes ?? DEFAULT_SHADOW_RETRIEVAL_LIMITS.maxNotes;
  const notes = [];
  const seenNotes = new Set();
  for (const candidate of Array.isArray(noteCandidates) ? noteCandidates : []) {
    if (notes.length >= Math.max(0, maxNotes)) break;
    const filename = typeof candidate === 'string' ? candidate : candidate?.filename;
    if (!filename || seenNotes.has(filename)) continue;
    notes.push({
      filename,
      title: candidate?.title || filename,
      score: Number.isFinite(candidate?.score) ? candidate.score : null,
      explicit: candidate?.explicit === true,
    });
    seenNotes.add(filename);
  }

  const rankedChunks = rankChunkCandidates({
    query,
    queryEmbedding,
    chunks: (Array.isArray(chunks) ? chunks : []).filter(chunk => (
      seenNotes.has(chunk?.noteFilename)
    )),
    limit: limits.maxChunks ?? DEFAULT_SHADOW_RETRIEVAL_LIMITS.maxChunks,
    maxChunksPerNote: limits.maxChunksPerNote
      ?? DEFAULT_SHADOW_RETRIEVAL_LIMITS.maxChunksPerNote,
    minEmbeddingScore: limits.minEmbeddingScore
      ?? DEFAULT_SHADOW_RETRIEVAL_LIMITS.minEmbeddingScore,
    minKeywordScore: limits.minKeywordScore
      ?? DEFAULT_SHADOW_RETRIEVAL_LIMITS.minKeywordScore,
  });
  const context = buildChunkContext(rankedChunks, {
    maxChunks: limits.maxChunks ?? DEFAULT_SHADOW_RETRIEVAL_LIMITS.maxChunks,
    maxCharsPerChunk: limits.maxCharsPerChunk
      ?? DEFAULT_SHADOW_RETRIEVAL_LIMITS.maxCharsPerChunk,
    maxContextChars: limits.maxContextChars
      ?? DEFAULT_SHADOW_RETRIEVAL_LIMITS.maxContextChars,
  });

  return {
    notes,
    chunks: context.chunks,
    context: context.context,
    contextChars: context.contextChars,
  };
}

module.exports = {
  DEFAULT_SEARCH_STOP_WORDS,
  DEFAULT_SHADOW_RETRIEVAL_LIMITS,
  buildChunkContext,
  buildShadowRetrieval,
  cosineSimilarity,
  extractQueryTerms,
  rankChunkCandidates,
  rankNoteCandidates,
};
