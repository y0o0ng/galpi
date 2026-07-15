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

  const normalizedNotes = notes.map(note => {
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

module.exports = {
  DEFAULT_SEARCH_STOP_WORDS,
  cosineSimilarity,
  extractQueryTerms,
  rankNoteCandidates,
};
