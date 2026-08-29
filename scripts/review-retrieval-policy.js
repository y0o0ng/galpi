#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  buildGlobalShadowRetrieval,
  rankNoteCandidates,
} = require('../lib/assistant-retrieval');
const { buildRetrievalShadowReport } = require('../lib/assistant-retrieval-report');
const { sha256 } = require('../lib/content-hash');
const { resolveRuntimePaths } = require('../lib/runtime-paths');

const ROOT = path.resolve(__dirname, '..');
const EMBEDDING_MODEL = 'text-embedding-3-small';

function parseArguments(argv) {
  const options = {
    dbPath: null,
    vaultPath: null,
    limit: 100,
    review: false,
    json: false,
    embedMissing: false,
    envPath: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--db') {
      options.dbPath = path.resolve(argv[++index] || '');
    } else if (argument === '--vault') {
      options.vaultPath = path.resolve(argv[++index] || '');
    } else if (argument === '--limit') {
      options.limit = Number.parseInt(argv[++index], 10);
      if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) {
        throw new Error('--limit은 1~100 사이 정수여야 합니다.');
      }
    } else if (argument === '--review') {
      options.review = true;
    } else if (argument === '--json') {
      options.json = true;
    } else if (argument === '--embed-missing') {
      options.embedMissing = true;
    } else if (argument === '--env') {
      options.envPath = path.resolve(argv[++index] || '');
    } else {
      throw new Error(`알 수 없는 인자입니다: ${argument}`);
    }
  }
  return options;
}

function parseEmbedding(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every(Number.isFinite) ? parsed : null;
  } catch {
    return null;
  }
}

function stripFrontmatter(raw) {
  return String(raw || '').replace(/^---[\s\S]*?---\n?/, '').trim();
}

function extractTags(raw) {
  return (
    String(raw || '').match(
      /<!-- CODEX-TAGS-START -->([\s\S]*?)<!-- CODEX-TAGS-END -->/,
    )?.[1] || ''
  ).replace(/#/g, ' ').toLowerCase();
}

function extractStoredQuestion(content) {
  return String(content || '').match(
    /(?:^|\n)(?:\*\*Q\.\*\*|Q:)\s*([\s\S]*?)(?=\n+(?:\*\*A\.\*\*|A:))/i,
  )?.[1]?.trim() || '';
}

function loadNotes(db, vaultPath) {
  return db.prepare(`
    SELECT filename, title, note_type AS noteType, embedding
    FROM notes
    WHERE archived = 0
      AND ai_readable = 1
      AND codex_status NOT IN ('running', 'recovery_required')
  `).all().flatMap(row => {
    const embedding = parseEmbedding(row.embedding);
    if (!embedding) return [];
    const filename = path.basename(row.filename);
    if (filename !== row.filename) return [];
    try {
      const raw = fs.readFileSync(path.join(vaultPath, filename), 'utf8');
      const body = stripFrontmatter(raw);
      return [{
        filename,
        title: row.title,
        noteType: row.noteType,
        body,
        tagsLower: extractTags(raw),
        embedding,
      }];
    } catch {
      return [];
    }
  });
}

function loadChunks(db) {
  return db.prepare(`
    SELECT c.chunk_id AS chunkId, c.note_filename AS noteFilename,
           n.title AS noteTitle, c.chunk_type AS chunkType, c.content,
           c.index_status AS indexStatus, c.embedding,
           c.created_at AS createdAt, c.updated_at AS updatedAt
    FROM note_chunks c
    JOIN notes n ON n.filename = c.note_filename
    WHERE c.chunk_type = 'topic_qa'
      AND c.index_status = 'ready'
      AND n.note_type = 'topic'
      AND n.archived = 0
      AND n.ai_readable = 1
      AND n.codex_status NOT IN ('running', 'recovery_required')
    ORDER BY c.id ASC
  `).all().flatMap(row => {
    const embedding = parseEmbedding(row.embedding);
    return embedding ? [{ ...row, embedding }] : [];
  });
}

function retrievePolicy({ query, queryEmbedding, notes, chunks, legacy }) {
  const noteCandidates = rankReplayNoteCandidates({
    query,
    queryEmbedding,
    notes,
  });
  return buildGlobalShadowRetrieval({
    query,
    queryEmbedding,
    noteCandidates,
    chunks,
    limits: legacy ? {
      globalAllowNoteKeywordAnchor: true,
      globalAllowAutomaticStrongNotePrior: true,
      globalSemanticOnlyUsesBaseScore: true,
      globalSemanticOnlyMinScore: 0.62,
      globalLexicalMinEmbeddingScore: 0,
      globalMinScore: 0.365,
      globalMaxScoreGap: Infinity,
    } : undefined,
  }).chunks.map(chunk => ({
    chunkId: chunk.chunkId,
    noteFilename: chunk.noteFilename,
    score: Math.round(chunk.score * 1000) / 1000,
    baseScore: Math.round(chunk.baseScore * 1000) / 1000,
    keywordScore: Math.round(chunk.keywordScore * 1000) / 1000,
    questionKeywordScore: Math.round(chunk.questionKeywordScore * 1000) / 1000,
    questionMatchedTerms: chunk.questionMatchedTerms,
    embeddingScore: Math.round((chunk.embeddingScore || 0) * 1000) / 1000,
    notePrior: Math.round(chunk.notePrior * 1000) / 1000,
    question: extractStoredQuestion(chunk.content),
  }));
}

function rankReplayNoteCandidates({ query, queryEmbedding, notes }) {
  return rankNoteCandidates({
    query,
    queryEmbedding,
    notes,
    limit: 8,
    keywordWeight: 0.35,
    embeddingWeight: 0.65,
    keywordNormalizer: 30,
    minEmbeddingScore: 0.08,
    minKeywordScore: 2,
  });
}

async function buildHistoricalReplayCorpus(
  db,
  vaultPath,
  limit,
  { embedMissing = null, embeddingModel = EMBEDDING_MODEL } = {},
) {
  const oldReport = buildRetrievalShadowReport({
    db,
    includeReview: true,
    reviewLimit: limit,
  });
  const notes = loadNotes(db, vaultPath);
  const chunks = loadChunks(db);
  const getMessage = db.prepare('SELECT content, embedding FROM messages WHERE id = ?');
  const getTraceNotes = db.prepare(`
    SELECT notes_json AS notesJson
    FROM assistant_retrieval_shadow_runs
    WHERE id = ?
  `);
  const messages = new Map(oldReport.reviews.map(review => [
    review.messageId,
    review.messageId ? getMessage.get(review.messageId) : null,
  ]));
  const generatedEmbeddings = new Map();
  let generatedEmbeddingCount = 0;
  let embeddingFailures = 0;
  if (typeof embedMissing === 'function') {
    const missing = oldReport.reviews.filter(review => {
      const message = messages.get(review.messageId);
      return message?.content && !parseEmbedding(message.embedding);
    });
    if (missing.length > 0) {
      const embeddings = await embedMissing(
        missing.map(review => messages.get(review.messageId).content),
      );
      missing.forEach((review, index) => {
        const embedding = embeddings[index];
        if (Array.isArray(embedding) && embedding.every(Number.isFinite)) {
          generatedEmbeddings.set(review.messageId, embedding);
          generatedEmbeddingCount += 1;
        } else {
          embeddingFailures += 1;
        }
      });
    }
  }

  let missingEmbeddings = 0;
  const cases = oldReport.reviews.map(review => {
    const message = messages.get(review.messageId);
    const queryEmbedding = parseEmbedding(message?.embedding)
      || generatedEmbeddings.get(review.messageId)
      || null;
    if (!message?.content || !queryEmbedding) {
      missingEmbeddings += 1;
      return {
        review,
        traceIds: review.traceIds,
        createdAt: review.createdAt,
        messageId: review.messageId,
        querySha256: message?.content ? sha256(message.content) : null,
        comparable: false,
      };
    }

    const temporalChunks = chunks.filter(chunk => (
      Number(chunk.createdAt) < review.createdAt
    ));
    const topicBodies = new Map();
    for (const chunk of temporalChunks) {
      const current = topicBodies.get(chunk.noteFilename) || '';
      topicBodies.set(chunk.noteFilename, `${current}\n\n${chunk.content}`.trim());
    }
    const temporalNotes = notes.map(note => (
      note.noteType === 'topic'
        ? { ...note, body: topicBodies.get(note.filename) || '' }
        : note
    ));
    const representativeTraceId = review.traceIds.at(-1);
    const traceNotes = parseTraceNotes(getTraceNotes.get(representativeTraceId)?.notesJson);
    const activeNotes = traceNotes
      .filter(note => note?.explicit === true && note.filename)
      .map(note => ({ filename: note.filename, title: note.filename }));

    return {
      review,
      traceIds: review.traceIds,
      createdAt: review.createdAt,
      messageId: review.messageId,
      querySha256: sha256(message.content),
      query: message.content,
      queryEmbedding,
      activeNotes,
      activeNoteStateApproximate: true,
      notes: temporalNotes,
      noteCandidates: rankReplayNoteCandidates({
        query: message.content,
        queryEmbedding,
        notes: temporalNotes,
      }),
      chunks: temporalChunks,
      comparable: true,
    };
  });

  return {
    sourceRuns: oldReport.runs,
    uniqueQueries: cases.length,
    comparableQueries: cases.filter(item => item.comparable).length,
    missingEmbeddings,
    generatedEmbeddingCount,
    embeddingFailures,
    embeddingModel,
    cases,
  };
}

function parseTraceNotes(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function buildPolicyReview(db, vaultPath, limit, { embedMissing = null } = {}) {
  const corpus = await buildHistoricalReplayCorpus(db, vaultPath, limit, { embedMissing });
  const reviews = corpus.cases.map(item => {
    if (!item.comparable) {
      return { ...item.review, replacement: null };
    }
    const input = {
      query: item.query,
      queryEmbedding: item.queryEmbedding,
      notes: item.notes,
      chunks: item.chunks,
    };
    return {
      ...item.review,
      baseline: retrievePolicy({ ...input, legacy: true }),
      replacement: retrievePolicy({ ...input, legacy: false }),
    };
  });

  const comparable = reviews.filter(review => Array.isArray(review.replacement));
  const changed = comparable.filter(review => (
    JSON.stringify(review.baseline.map(item => item.chunkId))
      !== JSON.stringify(review.replacement.map(item => item.chunkId))
  ));
  return {
    sourceRuns: corpus.sourceRuns,
    uniqueQueries: reviews.length,
    comparableQueries: comparable.length,
    missingEmbeddings: corpus.missingEmbeddings,
    baseline: {
      selectedQueries: comparable.filter(review => review.baseline.length > 0).length,
      selectedChunks: comparable.reduce((sum, review) => sum + review.baseline.length, 0),
      abstentions: comparable.filter(review => review.baseline.length === 0).length,
    },
    replacement: {
      selectedQueries: comparable.filter(review => review.replacement.length > 0).length,
      selectedChunks: comparable.reduce((sum, review) => sum + review.replacement.length, 0),
      abstentions: comparable.filter(review => review.replacement.length === 0).length,
    },
    changedQueries: changed.length,
    reviews,
  };
}

function formatReview(report, includeReview) {
  const lines = [
    'A1b 회수 정책 재평가 (읽기 전용)',
    `원본 실행 ${report.sourceRuns}건 · 고유 질문 ${report.uniqueQueries}개 · 비교 가능 ${report.comparableQueries}개`,
    `동일 corpus 기존 정책: 선택 질문 ${report.baseline.selectedQueries} · 청크 ${report.baseline.selectedChunks} · 중단 ${report.baseline.abstentions}`,
    `새 정책: 선택 질문 ${report.replacement.selectedQueries} · 청크 ${report.replacement.selectedChunks} · 중단 ${report.replacement.abstentions}`,
    `선택 변경 ${report.changedQueries}개 · 메시지 임베딩 누락 ${report.missingEmbeddings}개`,
    'DB는 readonly/query_only로 열며 trace·메시지·노트를 수정하지 않습니다.',
  ];
  if (!includeReview) {
    lines.push('질문·본문 비교는 명시적인 --review에서만 표시합니다.');
    return lines.join('\n');
  }
  for (const review of report.reviews) {
    lines.push('', `질문: ${review.query || '(질문 없음)'}`);
    lines.push('동일 corpus 기존 정책:');
    if (!review.baseline) lines.push('- 비교 불가');
    else if (review.baseline.length === 0) lines.push('- 선택 없음');
    for (const item of review.baseline || []) {
      lines.push(`- ${item.score ?? '-'} · ${item.noteFilename} · ${item.question || '(질문 발췌 없음)'}`);
    }
    lines.push('새 정책:');
    if (!review.replacement) lines.push('- 비교 불가');
    else if (review.replacement.length === 0) lines.push('- 선택 없음');
    else {
      for (const item of review.replacement) {
        lines.push(`- ${item.score} · ${item.noteFilename} · ${item.question || '(질문 발췌 없음)'}`);
      }
    }
  }
  return lines.join('\n');
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  require('dotenv').config({
    path: options.envPath || path.join(ROOT, '.env'),
  });
  const runtimePaths = resolveRuntimePaths({ appRoot: ROOT });
  const dbPath = options.dbPath || runtimePaths.dbPath;
  const vaultPath = options.vaultPath || runtimePaths.vaultPath;
  let embedMissing = null;
  if (options.embedMissing) {
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    embedMissing = async inputs => {
      const response = await client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: inputs.map(input => String(input || '').slice(0, 8000)),
        encoding_format: 'float',
      });
      return [...response.data]
        .sort((left, right) => left.index - right.index)
        .map(item => item.embedding);
    };
  }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    const report = await buildPolicyReview(db, vaultPath, options.limit, {
      embedMissing,
    });
    process.stdout.write(`${options.json
      ? JSON.stringify(report, null, 2)
      : formatReview(report, options.review)}\n`);
  } finally {
    db.close();
  }
}

module.exports = {
  EMBEDDING_MODEL,
  buildHistoricalReplayCorpus,
  buildPolicyReview,
  formatReview,
  loadChunks,
  loadNotes,
  main,
  parseArguments,
  parseEmbedding,
  rankReplayNoteCandidates,
};

if (require.main === module) {
  main().catch(error => {
    console.error(`Retrieval policy review failed: ${error.message}`);
    process.exitCode = 1;
  });
}
