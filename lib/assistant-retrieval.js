'use strict';

const DEFAULT_SEARCH_STOP_WORDS = new Set([
  '이', '가', '은', '는', '을', '를', '에', '의', '와', '과', '도', '로', '만',
  '내', '내가', '네', '그', '저', '것', '수', '더', '한', '두', '때', '등',
  '그리고', '그런데', '저번에', '우리가', '관련', '내용', '알려줘', '호출해줘',
  '불러와줘', '꺼내줘', '찾아줘', '말해줘', '추천해줘',
  '해', '해줘', '해줘요', '해주세요', '알고', '싶어', '있어',
  '없어', '어떤', '어떻게', '무엇', '뭐가', '뭔지', '대해', '대한', '관한',
  '이번', '저번', '지난', '이런', '저런', '그런', '이것', '저것', '그것',
  '정리', '설명', '요약', '노트', '저장', '기록', '쓴', '자료', '좀',
]);

const GLOBAL_SHADOW_SEARCH_STOP_WORDS = new Set([
  ...DEFAULT_SEARCH_STOP_WORDS,
  '그게', '관련해', '관련해서', '최근', '최근에', '가장', '무슨', '머냐',
  '이야기', '이야기를', '얘기', '했더라', '했지', '아닌가', '있냐고',
  '물어봤잖아', '물어봤었잖아',
]);

const KOREAN_SEARCH_PARTICLE_PATTERN = /(?:에게서|한테서|으로부터|께서|에서|에게|한테|부터|까지|처럼|보다|으로|은|는|을|를|의|와|과|에)$/u;
const KOREAN_SINGLE_SYLLABLE_PATTERN = /^[가-힣]$/u;
const KOREAN_SINGLE_SYLLABLE_QUERY_PARTICLE_PATTERN = /^(?:은|는|을|를|와|과)$/u;
const KOREAN_SINGLE_SYLLABLE_SUFFIX_PATTERN = /^(?:들)?(?:에게서|한테서|으로부터|께서|에서|에게|한테|부터|까지|처럼|보다|으로|은|는|이|가|을|를|의|와|과|에|도|로|만)?$/u;
const KOREAN_SINGLE_SYLLABLE_COMPOUND_WEIGHT = 0.25;
const MULTI_EVIDENCE_QUERY_PATTERN = /(?:함께|같이|동시에|둘\s*다|각각)/u;

const DEFAULT_SHADOW_RETRIEVAL_LIMITS = Object.freeze({
  maxNotes: 3,
  maxChunks: 6,
  maxChunksPerNote: 2,
  maxCharsPerChunk: 1400,
  maxContextChars: 8000,
  minEmbeddingScore: 0.18,
  minKeywordScore: 2,
  globalKeywordNormalizer: 45,
  globalChunkTitleKeywordWeight: 0.5,
  globalQuestionKeywordWeight: 4,
  globalMaxAnswerTermOccurrences: 3,
  globalMaxChunksPerNote: 3,
  globalMultiEvidenceMaxChunksPerNote: 5,
  globalNotePriorWeight: 0.15,
  globalMinBaseScore: 0.18,
  globalMinScore: 0.365,
  globalStrongNotePriorThreshold: 0.50,
  globalStrongNoteMinScore: 0.30,
  globalSemanticOnlyMinScore: 0.62,
});

function extractQueryTermGroups(
  query,
  stopWords = DEFAULT_SEARCH_STOP_WORDS,
  { includeParticleVariants = false } = {},
) {
  const groups = [];
  const seen = new Set();
  const rawTerms = String(query || '').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map(term => term.trim())
    .filter(Boolean);

  for (const term of rawTerms) {
    const stripped = includeParticleVariants && term.length >= 3
      ? term.replace(KOREAN_SEARCH_PARTICLE_PATTERN, '')
      : term;
    if (stripped !== term && stopWords.has(stripped)) continue;
    if (stopWords.has(term) || seen.has(term)) continue;
    const variants = [...new Set([term, stripped])]
      .filter(variant => variant.length >= 1 && !stopWords.has(variant));
    if (variants.length === 0) continue;
    groups.push({ term, variants });
    seen.add(term);
  }
  return groups;
}

function extractQueryTerms(query, stopWords = DEFAULT_SEARCH_STOP_WORDS) {
  return extractQueryTermGroups(query, stopWords).map(group => group.term);
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
  const value = String(text || '');
  const isSingleSyllable = KOREAN_SINGLE_SYLLABLE_PATTERN.test(term);
  const isShortParticleTerm = term.length === 2 &&
    KOREAN_SINGLE_SYLLABLE_PATTERN.test(term.slice(0, 1)) &&
    KOREAN_SINGLE_SYLLABLE_QUERY_PARTICLE_PATTERN.test(term.slice(1));
  if (!isSingleSyllable && !isShortParticleTerm) {
    return (value.match(new RegExp(term, 'g')) || []).length;
  }

  const tokens = value.match(/[\p{L}\p{N}]+/gu) || [];
  if (isSingleSyllable) {
    return tokens.reduce((total, token) => {
      if (!token.startsWith(term)) return total;
      return total + (KOREAN_SINGLE_SYLLABLE_SUFFIX_PATTERN.test(token.slice(1))
        ? 1
        : KOREAN_SINGLE_SYLLABLE_COMPOUND_WEIGHT);
    }, 0);
  }
  return tokens.filter(token => token.startsWith(term)).length;
}

function maxVariantScore(variants, scoreVariant) {
  return Math.max(0, ...variants.map(scoreVariant));
}

function compactSearchText(value) {
  return String(value || '').replace(/\s+/g, '');
}

function hasNearLongTitleMatch(title, variants) {
  const compactTitle = compactSearchText(title);
  return variants.some(variant => {
    const compactVariant = compactSearchText(variant);
    if (compactVariant.length < 5 || compactTitle.length < compactVariant.length) return false;
    for (let start = 0; start <= compactTitle.length - compactVariant.length; start += 1) {
      let differences = 0;
      for (let index = 0; index < compactVariant.length; index += 1) {
        if (compactTitle[start + index] !== compactVariant[index]) differences += 1;
        if (differences > 1) break;
      }
      if (differences <= 1) return true;
    }
    return false;
  });
}

function extractStoredQuestion(content) {
  return String(content || '').match(
    /(?:^|\n)(?:\*\*Q\.\*\*|Q:)\s*([\s\S]*?)(?=\n+(?:\*\*A\.\*\*|A:))/i
  )?.[1]?.trim() || '';
}

function clampScore(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function getNotePrior(notePriors, filename) {
  const value = notePriors instanceof Map
    ? notePriors.get(filename)
    : notePriors?.[filename];
  if (Number.isFinite(value)) return { score: clampScore(value), keywordMatched: false };
  return {
    score: clampScore(value?.score),
    keywordMatched: value?.keywordMatched === true,
  };
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
  const termGroups = extractQueryTermGroups(query);
  if (termGroups.length === 0 && !queryEmbedding) return [];

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
  const termDocumentFrequency = new Map(termGroups.map(group => [
    group.term,
    normalizedNotes.filter(note => (
      group.variants.some(variant => (
        countOccurrences(note.titleLower, variant) > 0 ||
        countOccurrences(note.bodyLower, variant) > 0 ||
        countOccurrences(note.tagsLower, variant) > 0
      ))
    )).length,
  ]));

  const results = [];
  for (const note of normalizedNotes) {
    let keywordScore = 0;
    for (const group of termGroups) {
      const documentFrequency = termDocumentFrequency.get(group.term) || 1;
      const inverseDocumentFrequency = Math.log(
        (documentCount + 1) / (documentFrequency + 1)
      ) + 1;
      const termFrequency = maxVariantScore(group.variants, variant => (
        Math.max(
          countOccurrences(note.titleLower, variant),
          hasNearLongTitleMatch(note.titleLower, [variant]) ? 1 : 0,
        ) * 5
          + countOccurrences(note.bodyLower, variant)
          + countOccurrences(note.tagsLower, variant) * 20
      ));
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

    const firstHit = termGroups
      .flatMap(group => group.variants.map(variant => note.bodyLower.indexOf(variant)))
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
      keywordScore,
      embeddingScore,
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
  titleKeywordWeight = 3,
  questionKeywordWeight = 0,
  maxAnswerTermOccurrences = Infinity,
  minEmbeddingScore = DEFAULT_SHADOW_RETRIEVAL_LIMITS.minEmbeddingScore,
  minKeywordScore = DEFAULT_SHADOW_RETRIEVAL_LIMITS.minKeywordScore,
  notePriors = null,
  notePriorWeight = 0,
  minBaseScore = null,
  minFinalScore = null,
  semanticOnlyMinScore = null,
  strongNotePriorThreshold = null,
  strongNoteMinFinalScore = null,
  maxNotes = Infinity,
  includeParticleVariants = false,
  stopWords = DEFAULT_SEARCH_STOP_WORDS,
} = {}) {
  const termGroups = extractQueryTermGroups(
    query,
    stopWords,
    { includeParticleVariants },
  );
  if (termGroups.length === 0 && !queryEmbedding) return [];

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
        questionLower: extractStoredQuestion(chunk.content).toLowerCase(),
        embedding: chunk.embedding,
        createdAt: chunk.createdAt ?? null,
        updatedAt: chunk.updatedAt ?? null,
      };
    });

  const documentCount = normalizedChunks.length || 1;
  const termDocumentFrequency = new Map(termGroups.map(group => [
    group.term,
    normalizedChunks.filter(chunk => (
      group.variants.some(variant => (
        countOccurrences(chunk.titleLower, variant) > 0 ||
        countOccurrences(chunk.contentLower, variant) > 0
      ))
    )).length,
  ]));

  const scored = [];
  for (const chunk of normalizedChunks) {
    let keywordScore = 0;
    for (const group of termGroups) {
      const documentFrequency = termDocumentFrequency.get(group.term) || 1;
      const inverseDocumentFrequency = Math.log(
        (documentCount + 1) / (documentFrequency + 1)
      ) + 1;
      const termFrequency = maxVariantScore(group.variants, variant => (
        countOccurrences(chunk.titleLower, variant) * titleKeywordWeight
          + (questionKeywordWeight > 0
            ? countOccurrences(chunk.questionLower, variant) * questionKeywordWeight
              + Math.min(
                Math.max(
                  0,
                  countOccurrences(chunk.contentLower, variant)
                    - countOccurrences(chunk.questionLower, variant),
                ),
                maxAnswerTermOccurrences,
              )
            : countOccurrences(chunk.contentLower, variant))
      ));
      keywordScore += termFrequency * inverseDocumentFrequency;
    }

    const embeddingScore = queryEmbedding && chunk.embedding
      ? Math.max(0, cosineSimilarity(queryEmbedding, chunk.embedding))
      : null;
    const legacyScore = embeddingScore !== null
      ? keywordWeight * Math.min(keywordScore / keywordNormalizer, 1)
        + embeddingWeight * embeddingScore
      : keywordScore;
    if (!Number.isFinite(legacyScore)) continue;

    const prior = getNotePrior(notePriors, chunk.noteFilename);
    let baseScore = legacyScore;
    let finalScore = legacyScore;
    if (notePriorWeight > 0) {
      baseScore = embeddingScore !== null
        ? legacyScore
        : Math.min(keywordScore / keywordNormalizer, 1);
      const baseThreshold = Number.isFinite(minBaseScore)
        ? minBaseScore
        : embeddingScore !== null
          ? minEmbeddingScore
          : Math.min(minKeywordScore / keywordNormalizer, 1);
      if (baseScore < baseThreshold) continue;

      const hasLexicalAnchor = keywordScore > 0 || prior.keywordMatched;
      const hasStrongNotePrior = Number.isFinite(strongNotePriorThreshold)
        && prior.score >= strongNotePriorThreshold;
      if (
        !hasLexicalAnchor &&
        !hasStrongNotePrior &&
        Number.isFinite(semanticOnlyMinScore) &&
        baseScore < semanticOnlyMinScore
      ) continue;

      const priorWeight = clampScore(notePriorWeight);
      finalScore = baseScore + priorWeight * prior.score * (1 - baseScore);
      const finalThreshold = hasStrongNotePrior && Number.isFinite(strongNoteMinFinalScore)
        ? Number.isFinite(minFinalScore)
          ? Math.min(minFinalScore, strongNoteMinFinalScore)
          : strongNoteMinFinalScore
        : minFinalScore;
      if (Number.isFinite(finalThreshold) && finalScore < finalThreshold) continue;
    } else {
      const minimumScore = embeddingScore !== null ? minEmbeddingScore : minKeywordScore;
      if (finalScore < minimumScore) continue;
    }

    scored.push({
      chunkId: chunk.chunkId,
      noteFilename: chunk.noteFilename,
      noteTitle: chunk.noteTitle,
      chunkType: chunk.chunkType,
      content: chunk.content,
      createdAt: chunk.createdAt,
      updatedAt: chunk.updatedAt,
      score: finalScore,
      baseScore,
      keywordScore,
      embeddingScore,
      notePrior: prior.score,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const selected = [];
  const seenChunkIds = new Set();
  const noteCounts = new Map();
  const selectedNotes = new Set();
  const noteLimit = Number.isFinite(maxNotes) ? Math.max(0, Math.floor(maxNotes)) : Infinity;
  for (const chunk of scored) {
    if (selected.length >= Math.max(0, limit)) break;
    if (seenChunkIds.has(chunk.chunkId)) continue;
    const noteCount = noteCounts.get(chunk.noteFilename) || 0;
    if (noteCount >= Math.max(1, maxChunksPerNote)) continue;
    if (noteCount === 0 && selectedNotes.size >= noteLimit) continue;
    selected.push(chunk);
    seenChunkIds.add(chunk.chunkId);
    noteCounts.set(chunk.noteFilename, noteCount + 1);
    selectedNotes.add(chunk.noteFilename);
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

function truncateNoteContext(text, limit) {
  const value = String(text || '');
  const normalizedLimit = Math.max(0, Number.isFinite(limit) ? Math.floor(limit) : 0);
  if (value.length <= normalizedLimit) return value;

  const marker = '\n...(중간 생략)...\n';
  if (normalizedLimit <= marker.length) return value.slice(0, normalizedLimit);
  const available = normalizedLimit - marker.length;
  const headLength = Math.floor(available / 2);
  const tailLength = available - headLength;
  return value.slice(0, headLength) + marker + value.slice(-tailLength);
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
    strategy: 'hard-gated',
    notes,
    chunks: context.chunks,
    context: context.context,
    contextChars: context.contextChars,
  };
}

function buildGlobalShadowRetrieval({
  query,
  queryEmbedding = null,
  activeNotes = [],
  noteCandidates = [],
  chunks = [],
  limits = DEFAULT_SHADOW_RETRIEVAL_LIMITS,
} = {}) {
  const noteMetadata = new Map();
  const notePriors = new Map();

  for (const note of Array.isArray(activeNotes) ? activeNotes : []) {
    if (!note?.filename) continue;
    noteMetadata.set(note.filename, {
      filename: note.filename,
      title: note.title || note.filename,
      score: null,
      explicit: true,
    });
    notePriors.set(note.filename, { score: 1, keywordMatched: false });
  }

  for (const candidate of Array.isArray(noteCandidates) ? noteCandidates : []) {
    if (!candidate?.filename) continue;
    const existing = noteMetadata.get(candidate.filename);
    const candidateScore = Number.isFinite(candidate.score) ? candidate.score : 0;
    const normalizedScore = queryEmbedding
      ? clampScore(candidateScore)
      : candidateScore > 0
        ? candidateScore / (candidateScore + 30)
        : 0;
    noteMetadata.set(candidate.filename, {
      filename: candidate.filename,
      title: candidate.title || existing?.title || candidate.filename,
      score: Number.isFinite(candidate.score) ? candidate.score : existing?.score ?? null,
      explicit: existing?.explicit === true,
    });
    const existingPrior = notePriors.get(candidate.filename);
    notePriors.set(candidate.filename, {
      score: Math.max(existingPrior?.score || 0, normalizedScore),
      keywordMatched: existingPrior?.keywordMatched === true || candidate.keywordScore > 0,
    });
  }

  const rankedChunks = rankChunkCandidates({
    query,
    queryEmbedding,
    chunks,
    limit: limits.maxChunks ?? DEFAULT_SHADOW_RETRIEVAL_LIMITS.maxChunks,
    maxChunksPerNote: MULTI_EVIDENCE_QUERY_PATTERN.test(String(query || ''))
      ? limits.globalMultiEvidenceMaxChunksPerNote
        ?? DEFAULT_SHADOW_RETRIEVAL_LIMITS.globalMultiEvidenceMaxChunksPerNote
      : limits.globalMaxChunksPerNote
        ?? DEFAULT_SHADOW_RETRIEVAL_LIMITS.globalMaxChunksPerNote,
    maxNotes: limits.maxNotes ?? DEFAULT_SHADOW_RETRIEVAL_LIMITS.maxNotes,
    keywordNormalizer: limits.globalKeywordNormalizer
      ?? DEFAULT_SHADOW_RETRIEVAL_LIMITS.globalKeywordNormalizer,
    titleKeywordWeight: limits.globalChunkTitleKeywordWeight
      ?? DEFAULT_SHADOW_RETRIEVAL_LIMITS.globalChunkTitleKeywordWeight,
    questionKeywordWeight: limits.globalQuestionKeywordWeight
      ?? DEFAULT_SHADOW_RETRIEVAL_LIMITS.globalQuestionKeywordWeight,
    maxAnswerTermOccurrences: limits.globalMaxAnswerTermOccurrences
      ?? DEFAULT_SHADOW_RETRIEVAL_LIMITS.globalMaxAnswerTermOccurrences,
    includeParticleVariants: true,
    stopWords: GLOBAL_SHADOW_SEARCH_STOP_WORDS,
    notePriors,
    notePriorWeight: limits.globalNotePriorWeight
      ?? DEFAULT_SHADOW_RETRIEVAL_LIMITS.globalNotePriorWeight,
    minBaseScore: limits.globalMinBaseScore
      ?? DEFAULT_SHADOW_RETRIEVAL_LIMITS.globalMinBaseScore,
    minFinalScore: limits.globalMinScore
      ?? DEFAULT_SHADOW_RETRIEVAL_LIMITS.globalMinScore,
    semanticOnlyMinScore: limits.globalSemanticOnlyMinScore
      ?? DEFAULT_SHADOW_RETRIEVAL_LIMITS.globalSemanticOnlyMinScore,
    strongNotePriorThreshold: limits.globalStrongNotePriorThreshold
      ?? DEFAULT_SHADOW_RETRIEVAL_LIMITS.globalStrongNotePriorThreshold,
    strongNoteMinFinalScore: limits.globalStrongNoteMinScore
      ?? DEFAULT_SHADOW_RETRIEVAL_LIMITS.globalStrongNoteMinScore,
  });
  const context = buildChunkContext(rankedChunks, {
    maxChunks: limits.maxChunks ?? DEFAULT_SHADOW_RETRIEVAL_LIMITS.maxChunks,
    maxCharsPerChunk: limits.maxCharsPerChunk
      ?? DEFAULT_SHADOW_RETRIEVAL_LIMITS.maxCharsPerChunk,
    maxContextChars: limits.maxContextChars
      ?? DEFAULT_SHADOW_RETRIEVAL_LIMITS.maxContextChars,
  });

  const notes = [];
  const seenNotes = new Set();
  for (const chunk of context.chunks) {
    if (seenNotes.has(chunk.noteFilename)) continue;
    const metadata = noteMetadata.get(chunk.noteFilename);
    notes.push({
      filename: chunk.noteFilename,
      title: metadata?.title || chunk.noteTitle || chunk.noteFilename,
      score: metadata?.score ?? chunk.score,
      explicit: metadata?.explicit === true,
    });
    seenNotes.add(chunk.noteFilename);
  }

  return {
    strategy: 'global-soft-prior',
    notes,
    chunks: context.chunks,
    context: context.context,
    contextChars: context.contextChars,
  };
}

module.exports = {
  DEFAULT_SEARCH_STOP_WORDS,
  GLOBAL_SHADOW_SEARCH_STOP_WORDS,
  DEFAULT_SHADOW_RETRIEVAL_LIMITS,
  buildChunkContext,
  buildGlobalShadowRetrieval,
  buildShadowRetrieval,
  cosineSimilarity,
  extractQueryTerms,
  rankChunkCandidates,
  rankNoteCandidates,
  truncateNoteContext,
};
