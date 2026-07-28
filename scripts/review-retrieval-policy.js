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

const ROOT = path.resolve(__dirname, '..');

function parseArguments(argv) {
  const options = {
    dbPath: path.join(ROOT, 'galpi.db'),
    vaultPath: path.join(ROOT, 'galpi-vault'),
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
  const noteCandidates = rankNoteCandidates({
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

async function buildPolicyReview(db, vaultPath, limit, { embedMissing = null } = {}) {
  const oldReport = buildRetrievalShadowReport({
    db,
    includeReview: true,
    reviewLimit: limit,
  });
  const notes = loadNotes(db, vaultPath);
  const chunks = loadChunks(db);
  const getMessage = db.prepare('SELECT content, embedding FROM messages WHERE id = ?');
  const messages = new Map(oldReport.reviews.map(review => [
    review.messageId,
    review.messageId ? getMessage.get(review.messageId) : null,
  ]));
  const generatedEmbeddings = new Map();
  if (typeof embedMissing === 'function') {
    const missing = oldReport.reviews.filter(review => {
      const message = messages.get(review.messageId);
      return message?.content && !parseEmbedding(message.embedding);
    });
    if (missing.length > 0) {
      const embeddings = await embedMissing(missing.map(review => (
        messages.get(review.messageId).content
      )));
      missing.forEach((review, index) => {
        const embedding = embeddings[index];
        if (Array.isArray(embedding)) generatedEmbeddings.set(review.messageId, embedding);
      });
    }
  }
  let missingEmbeddings = 0;

  const reviews = oldReport.reviews.map(review => {
    const message = messages.get(review.messageId);
    const queryEmbedding = parseEmbedding(message?.embedding)
      || generatedEmbeddings.get(review.messageId)
      || null;
    if (!message?.content || !queryEmbedding) {
      missingEmbeddings += 1;
      return { ...review, replacement: null };
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
    const input = {
      query: message.content,
      queryEmbedding,
      notes: temporalNotes,
      chunks: temporalChunks,
    };
    return {
      ...review,
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
    sourceRuns: oldReport.runs,
    uniqueQueries: reviews.length,
    comparableQueries: comparable.length,
    missingEmbeddings,
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
  let embedMissing = null;
  if (options.embedMissing) {
    require('dotenv').config(options.envPath ? { path: options.envPath } : undefined);
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    embedMissing = async inputs => {
      const response = await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: inputs.map(input => String(input || '').slice(0, 8000)),
      });
      return [...response.data]
        .sort((left, right) => left.index - right.index)
        .map(item => item.embedding);
    };
  }
  const db = new Database(options.dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    const report = await buildPolicyReview(db, options.vaultPath, options.limit, {
      embedMissing,
    });
    process.stdout.write(`${options.json
      ? JSON.stringify(report, null, 2)
      : formatReview(report, options.review)}\n`);
  } finally {
    db.close();
  }
}

module.exports = { buildPolicyReview, formatReview, main, parseArguments };

if (require.main === module) {
  main().catch(error => {
    console.error(`Retrieval policy review failed: ${error.message}`);
    process.exitCode = 1;
  });
}
