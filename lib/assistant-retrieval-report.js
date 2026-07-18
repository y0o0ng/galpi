'use strict';

const { sha256 } = require('./content-hash');

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function average(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(percentileValue * sorted.length));
  return sorted[Math.min(rank - 1, sorted.length - 1)];
}

function summarizeNumbers(values) {
  return {
    average: round(average(values)),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    maximum: values.length > 0 ? Math.max(...values) : 0,
  };
}

function extractStoredQuestion(content) {
  const value = String(content || '');
  return value.match(
    /(?:^|\n)(?:\*\*Q\.\*\*|Q:)\s*([\s\S]*?)(?=\n+(?:\*\*A\.\*\*|A:))/i,
  )?.[1]?.trim() || value.split('\n').find(line => line.trim())?.trim() || '';
}

function loadRuns(db, { sinceEpoch = null, allModes = false } = {}) {
  const columns = new Set(
    db.prepare('PRAGMA table_info(assistant_retrieval_shadow_runs)')
      .all()
      .map(column => column.name),
  );
  if (columns.size === 0) throw new Error('assistant_retrieval_shadow_runs 테이블이 없습니다.');

  const clauses = [];
  const parameters = [];
  if (Number.isInteger(sinceEpoch)) {
    clauses.push('created_at >= ?');
    parameters.push(sinceEpoch);
  }
  if (!allModes) clauses.push("mode LIKE '%:a1b'");
  const queryHashColumn = columns.has('query_sha256')
    ? 'query_sha256 AS querySha256'
    : 'NULL AS querySha256';
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`
    SELECT id, session_id AS sessionId, mode, ${queryHashColumn},
           notes_json AS notesJson, chunks_json AS chunksJson,
           context_chars AS contextChars, latency_ms AS latencyMs,
           error, created_at AS createdAt
    FROM assistant_retrieval_shadow_runs
    ${where}
    ORDER BY created_at ASC, id ASC
  `).all(...parameters);
}

function findReviewMessages(db, rows) {
  const wanted = new Set(
    rows.filter(row => row.querySha256).map(row => `${row.sessionId || ''}\u0000${row.querySha256}`),
  );
  if (wanted.size === 0) return new Map();

  const matches = new Map();
  const messages = db.prepare(`
    SELECT id, session_id AS sessionId, content, created_at AS createdAt
    FROM messages
    WHERE role = 'user'
    ORDER BY created_at ASC, id ASC
  `).all();
  for (const message of messages) {
    const key = `${message.sessionId || ''}\u0000${sha256(message.content)}`;
    if (!wanted.has(key)) continue;
    if (!matches.has(key)) matches.set(key, []);
    matches.get(key).push(message);
  }
  return matches;
}

function chooseClosestMessage(messages, createdAt) {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const closest = [...messages].sort((left, right) => {
    const leftBefore = left.createdAt < createdAt ? 1 : 0;
    const rightBefore = right.createdAt < createdAt ? 1 : 0;
    if (leftBefore !== rightBefore) return leftBefore - rightBefore;
    return Math.abs(left.createdAt - createdAt) - Math.abs(right.createdAt - createdAt);
  })[0];
  return Math.abs(closest.createdAt - createdAt) <= 2 * 60 * 60 ? closest : null;
}

function loadChunkReviewData(db, chunkIds) {
  if (chunkIds.length === 0) return new Map();
  const wanted = new Set(chunkIds);
  const rows = db.prepare(`
    SELECT chunk_id AS chunkId, note_filename AS noteFilename, content
    FROM note_chunks
    WHERE index_status = 'ready'
  `).all();
  return new Map(rows
    .filter(row => wanted.has(row.chunkId))
    .map(row => [row.chunkId, {
      chunkId: row.chunkId,
      noteFilename: row.noteFilename,
      question: extractStoredQuestion(row.content),
    }]));
}

function buildReviews(db, rows, limit) {
  const groups = new Map();
  for (const row of rows) {
    if (!row.querySha256) continue;
    const key = row.querySha256;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const selectedGroups = [...groups.entries()]
    .sort((left, right) => {
      const leftLatest = Math.max(...left[1].map(row => row.createdAt));
      const rightLatest = Math.max(...right[1].map(row => row.createdAt));
      return rightLatest - leftLatest;
    })
    .slice(0, limit);
  const selectedRows = selectedGroups.flatMap(([, groupRows]) => groupRows);
  const messageMatches = findReviewMessages(db, selectedRows);
  const chunkIds = [...new Set(selectedRows.flatMap(row => (
    parseJsonArray(row.chunksJson) || []
  ).map(chunk => chunk.chunkId).filter(Boolean)))];
  const chunksById = loadChunkReviewData(db, chunkIds);

  return selectedGroups.map(([, groupRows]) => {
    const representative = [...groupRows]
      .sort((left, right) => right.createdAt - left.createdAt || right.id - left.id)[0];
    const messageKey = `${representative.sessionId || ''}\u0000${representative.querySha256}`;
    const message = chooseClosestMessage(messageMatches.get(messageKey), representative.createdAt);
    const chunks = parseJsonArray(representative.chunksJson) || [];
    return {
      traceIds: groupRows.map(row => row.id),
      modes: [...new Set(groupRows.map(row => row.mode))],
      createdAt: representative.createdAt,
      messageId: message?.id || null,
      query: message?.content || null,
      evidence: chunks.map(chunk => ({
        chunkId: chunk.chunkId,
        noteFilename: chunk.noteFilename,
        score: Number.isFinite(chunk.score) ? round(chunk.score, 3) : null,
        question: chunksById.get(chunk.chunkId)?.question || null,
      })),
    };
  });
}

function buildRetrievalShadowReport({
  db,
  sinceEpoch = null,
  allModes = false,
  includeReview = false,
  reviewLimit = 20,
} = {}) {
  if (!db?.prepare) throw new TypeError('SQLite DB 연결이 필요합니다.');
  const rows = loadRuns(db, { sinceEpoch, allModes });
  let invalidJsonRuns = 0;
  const normalized = rows.map(row => {
    const notes = parseJsonArray(row.notesJson);
    const chunks = parseJsonArray(row.chunksJson);
    if (!notes || !chunks) invalidJsonRuns += 1;
    return { ...row, notes: notes || [], chunks: chunks || [] };
  });
  const byMode = Object.entries(Object.groupBy(normalized, row => row.mode))
    .map(([mode, modeRows]) => ({ mode, runs: modeRows.length }))
    .sort((left, right) => left.mode.localeCompare(right.mode));
  const queryKeys = new Set(normalized
    .filter(row => row.querySha256)
    .map(row => row.querySha256));
  const chunkScores = normalized
    .flatMap(row => row.chunks)
    .map(chunk => chunk.score)
    .filter(Number.isFinite);
  const noteCounts = normalized.map(row => row.notes.length);
  const chunkCounts = normalized.map(row => row.chunks.length);

  const report = {
    generatedAt: Math.floor(Date.now() / 1000),
    filters: { sinceEpoch, allModes },
    runs: normalized.length,
    reviewableUniqueQueries: queryKeys.size,
    runsWithoutQueryHash: normalized.filter(row => !row.querySha256).length,
    byMode,
    incrementalShadowLatencyMs: summarizeNumbers(normalized.map(row => row.latencyMs)),
    contextChars: summarizeNumbers(normalized.map(row => row.contextChars)),
    selectedNotes: summarizeNumbers(noteCounts),
    selectedChunks: summarizeNumbers(chunkCounts),
    selectedChunkScore: summarizeNumbers(chunkScores),
    abstentions: normalized.filter(row => row.chunks.length === 0).length,
    saturatedRuns: normalized.filter(row => row.chunks.length >= 6 || row.contextChars >= 8000).length,
    errors: normalized.filter(row => row.error).length,
    invalidJsonRuns,
  };
  if (includeReview) report.reviews = buildReviews(db, normalized, reviewLimit);
  return report;
}

function formatPercent(count, total) {
  return total > 0 ? `${round((count / total) * 100)}%` : '0%';
}

function formatKst(epoch) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(epoch * 1000));
}

function formatRetrievalShadowReport(report) {
  const latency = report.incrementalShadowLatencyMs;
  const context = report.contextChars;
  const notes = report.selectedNotes;
  const chunks = report.selectedChunks;
  const lines = [
    'A1b shadow trace 보고서 (읽기 전용)',
    `범위: ${report.filters.sinceEpoch ? `${formatKst(report.filters.sinceEpoch)} 이후` : '전체'} · ${report.filters.allModes ? '모든 전략' : 'A1b만'}`,
    `실행 ${report.runs}건 · 검토 가능한 고유 질문 ${report.reviewableUniqueQueries}개 · hash 없는 과거 실행 ${report.runsWithoutQueryHash}건`,
    `모드: ${report.byMode.map(item => `${item.mode} ${item.runs}`).join(', ') || '없음'}`,
    `A1b 추가 지연: 평균 ${latency.average}ms · p50 ${latency.p50}ms · p95 ${latency.p95}ms · 최대 ${latency.maximum}ms`,
    `컨텍스트: 평균 ${context.average}자 · p95 ${context.p95}자 · 최대 ${context.maximum}자`,
    `선택량: 노트 평균 ${notes.average}개/최대 ${notes.maximum}개 · 청크 평균 ${chunks.average}개/최대 ${chunks.maximum}개`,
    `중단 ${report.abstentions}건 (${formatPercent(report.abstentions, report.runs)}) · 상한 도달 ${report.saturatedRuns}건 · 오류 ${report.errors}건 · 손상 JSON ${report.invalidJsonRuns}건`,
    '지연은 기존 임베딩·노트 검색 뒤에 추가로 실행되는 A1b shadow 랭킹 구간만 측정합니다.',
  ];

  for (const review of report.reviews || []) {
    lines.push('', `[${review.traceIds.join(', ')}] ${formatKst(review.createdAt)} · ${review.modes.join(', ')}`);
    lines.push(`질문: ${review.query || '(일치하는 사용자 메시지를 찾지 못함)'}`);
    if (review.evidence.length === 0) {
      lines.push('- 선택 evidence 없음');
      continue;
    }
    for (const evidence of review.evidence) {
      const score = evidence.score === null ? '점수 없음' : `점수 ${evidence.score}`;
      lines.push(`- ${score} · ${evidence.chunkId} · ${evidence.noteFilename}`);
      lines.push(`  Q: ${evidence.question || '(질문 발췌 없음)'}`);
    }
  }
  return lines.join('\n');
}

module.exports = {
  buildRetrievalShadowReport,
  formatRetrievalShadowReport,
  parseJsonArray,
  percentile,
};
