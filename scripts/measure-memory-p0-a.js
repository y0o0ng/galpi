#!/usr/bin/env node
'use strict';

const path = require('node:path');
const Database = require('better-sqlite3');
const {
  buildD0Sensitivity,
  buildCurrentInvocationSensitivity,
  buildOnlineEligibleVolume,
  formatMemoryP0Report,
  parseActiveNotesTelemetry,
  resolveCurrentInvocationQueries,
} = require('../lib/memory-p0-research');
const {
  EMBEDDING_MODEL,
  buildHistoricalReplayCorpus,
  loadChunks,
  loadNotes,
  parseEmbedding,
  rankReplayNoteCandidates,
} = require('./review-retrieval-policy');
const { resolveRuntimePaths } = require('../lib/runtime-paths');

const ROOT = path.resolve(__dirname, '..');

function parseAsOf(value) {
  const input = String(value || '').trim();
  if (!input) throw new Error('--as-of 뒤에 날짜나 시각이 필요합니다.');
  const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(input)
    ? Date.parse(`${input}T12:00:00+09:00`)
    : Date.parse(input);
  if (!Number.isFinite(timestamp)) throw new Error(`날짜를 해석할 수 없습니다: ${input}`);
  return timestamp;
}

function parseArguments(argv) {
  const options = {
    dbPath: null,
    vaultPath: null,
    asOf: null,
    limit: 77,
    embedMissing: false,
    envPath: null,
    baselineCommit: 'unknown',
    review: false,
    json: false,
    currentInvocationD0: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--db') {
      if (!argv[index + 1]) throw new Error('--db 뒤에 파일 경로가 필요합니다.');
      options.dbPath = path.resolve(argv[++index]);
    } else if (argument === '--vault') {
      if (!argv[index + 1]) throw new Error('--vault 뒤에 디렉터리 경로가 필요합니다.');
      options.vaultPath = path.resolve(argv[++index]);
    } else if (argument === '--as-of') {
      options.asOf = parseAsOf(argv[++index]);
    } else if (argument === '--limit') {
      options.limit = Number.parseInt(argv[++index], 10);
      if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) {
        throw new Error('--limit은 1~100 사이 정수여야 합니다.');
      }
    } else if (argument === '--embed-missing') {
      options.embedMissing = true;
    } else if (argument === '--env') {
      if (!argv[index + 1]) throw new Error('--env 뒤에 파일 경로가 필요합니다.');
      options.envPath = path.resolve(argv[++index]);
    } else if (argument === '--baseline-commit') {
      const commit = String(argv[++index] || '').trim();
      if (!/^[0-9a-f]{7,40}$/i.test(commit)) throw new Error('유효한 baseline commit이 필요합니다.');
      options.baselineCommit = commit;
    } else if (argument === '--review') {
      options.review = true;
    } else if (argument === '--json') {
      options.json = true;
    } else if (argument === '--current-invocation-d0') {
      options.currentInvocationD0 = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`알 수 없는 인자입니다: ${argument}`);
    }
  }
  return options;
}

function helpText() {
  return [
    'Usage: npm run research:memory-p0 -- [options]',
    '',
    'Options:',
    '  --db <path>               SQLite DB 경로 (기본: GALPI_DATA_DIR/galpi.db)',
    '  --vault <path>            Vault 경로 (기본: VAULT_PATH)',
    '  --as-of <date|time>       28일 window 기준 KST 날짜 또는 ISO 시각',
    '  --limit <1-100>           historical unique-query 한도 (기본: 77)',
    '  --embed-missing           누락 query embedding을 OpenAI에서 in-memory 생성',
    '  --env <path>              OpenAI 환경 파일 경로',
    '  --baseline-commit <sha>   receipt에 기록할 latest main commit',
    '  --review                  질문과 양 arm의 chunk 식별자를 명시적으로 표시',
    '  --json                    JSON 출력',
    '  --current-invocation-d0   current 28-day invocation-weighted conditional D0 follow-up',
    '  -h, --help                도움말',
    '',
    '기본 출력에는 질문·노트 본문·파일명이 없습니다.',
    'Galpi persistent state는 readonly/query_only로 열고 DB/Vault에 쓰지 않습니다.',
    '--embed-missing은 production과 같은 text-embedding-3-small 외부 호출을 수행하지만 저장하지 않습니다.',
    'P0-B answer generation은 이 명령의 범위가 아닙니다.',
  ].join('\n');
}

async function buildCurrentInvocationReplayCorpus(
  db,
  vaultPath,
  { asOf = Date.now(), embedMissing = null, embeddingModel = EMBEDDING_MODEL } = {},
) {
  const resolution = resolveCurrentInvocationQueries(db, { asOf });
  const notes = loadNotes(db, vaultPath);
  const chunks = loadChunks(db);
  const notesByFilename = new Map(notes.map(note => [note.filename, note]));
  const resolved = resolution.invocations.filter(item => item.status === 'RESOLVED');
  const storedEmbeddings = new Map();
  const missingByQuery = new Map();
  for (const invocation of resolved) {
    const stored = parseEmbedding(invocation.embedding);
    if (stored) {
      storedEmbeddings.set(invocation.traceId, stored);
      continue;
    }
    if (!missingByQuery.has(invocation.query)) missingByQuery.set(invocation.query, []);
    missingByQuery.get(invocation.query).push(invocation.traceId);
  }

  const generatedByQuery = new Map();
  let externalApiBatches = 0;
  let generatedUniqueInputs = 0;
  if (missingByQuery.size > 0 && typeof embedMissing === 'function') {
    const inputs = [...missingByQuery.keys()];
    externalApiBatches += 1;
    const embeddings = await embedMissing(inputs);
    inputs.forEach((query, index) => {
      const embedding = embeddings[index];
      if (Array.isArray(embedding) && embedding.every(Number.isFinite)) {
        generatedByQuery.set(query, embedding);
        generatedUniqueInputs += 1;
      }
    });
  }

  let generatedEmbeddingCount = 0;
  let embeddingFailures = 0;
  let activeNotesExact = 0;
  let activeNotesUnknown = 0;
  const cases = resolution.invocations.map(invocation => {
    if (invocation.status !== 'RESOLVED') {
      return {
        traceId: invocation.traceId,
        querySha256: invocation.querySha256,
        createdAt: invocation.createdAt,
        comparable: false,
      };
    }
    const queryEmbedding = storedEmbeddings.get(invocation.traceId)
      || generatedByQuery.get(invocation.query)
      || null;
    if (!storedEmbeddings.has(invocation.traceId) && queryEmbedding) {
      generatedEmbeddingCount += 1;
    }
    if (!queryEmbedding) embeddingFailures += 1;

    const activeState = parseActiveNotesTelemetry(invocation.activeNotesJson);
    if (activeState.observed) activeNotesExact += 1;
    else activeNotesUnknown += 1;
    const activeNotes = activeState.observed
      ? activeState.identifiers.map(filename => ({
        filename,
        title: notesByFilename.get(filename)?.title || filename,
      }))
      : [];
    const temporalChunks = chunks.filter(chunk => Number(chunk.createdAt) < invocation.createdAt);
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

    return {
      traceId: invocation.traceId,
      messageId: invocation.messageId,
      createdAt: invocation.createdAt,
      querySha256: invocation.querySha256,
      query: invocation.query,
      queryEmbedding,
      activeNotes,
      activeNoteStateApproximate: !activeState.observed,
      noteCandidates: queryEmbedding ? rankReplayNoteCandidates({
        query: invocation.query,
        queryEmbedding,
        notes: temporalNotes,
      }) : [],
      chunks: temporalChunks,
      comparable: Boolean(queryEmbedding),
    };
  });

  return {
    sourceDescription: 'current 28-day A2 invocation distribution',
    activeNoteApproximation: 'activeNotes input telemetry가 없는 invocation은 exact state를 추측하지 않고 activeNotes=[] 조건으로 replay한다.',
    pointInTimeCaveats: [
      '두 arm 모두 chunk.created_at < current trace.created_at인 현재 ready topic chunks만 사용한다.',
      '현재 note embedding을 재사용하므로 invocation 이후 topic content가 note-ranking prior에 섞였을 수 있다.',
      '현재 corpus에 남아 있지 않거나 이후 변경된 chunk content는 원시점 상태로 복원하지 못한다.',
      'historical current-window trace에는 activeNotes input telemetry가 없어 activeNotes=[] 조건부 approximation을 사용한다.',
    ],
    sourceRuns: resolution.eligibleRuns,
    uniqueQueries: new Set(resolved.map(item => item.querySha256)).size,
    comparableQueries: cases.filter(item => item.comparable).length,
    resolution,
    storedEmbeddingCount: storedEmbeddings.size,
    generatedEmbeddingCount,
    generatedUniqueInputs,
    embeddingFailures,
    embeddingModel,
    externalApiBatches,
    activeNotesExact,
    activeNotesUnknown,
    cases,
  };
}

function formatPercent(value) {
  return `${Math.round((Number(value) || 0) * 10000) / 100}%`;
}

function formatCurrentInvocationD0Report(report) {
  const current = report.currentInvocationD0;
  const bounds = current.sensitivity.bounds;
  const lines = [
    'XION Memory R3-P0 current invocation follow-up (Galpi persistent state is read-only)',
    `Baseline: ${report.baselineCommit}`,
    `Window: ${current.window.startKst} 00:00 KST <= trace < ${current.window.endExclusiveKst} 00:00 KST`,
    `Eligible invocations N: ${current.eligibleRuns}`,
    `Query resolution: RESOLVED ${current.resolution.RESOLVED} · AMBIGUOUS ${current.resolution.AMBIGUOUS} · MISSING ${current.resolution.MISSING} · coverage ${formatPercent(current.resolutionCoverage)}`,
    `Embeddings: stored ${current.embeddings.stored} · generated ${current.embeddings.generated} · unique generated inputs ${current.embeddings.generatedUniqueInputs} · API batches ${current.embeddings.externalApiBatches} · failures ${current.embeddings.failures} · persistence none`,
    '',
    'Metric: conditional ΔR under empty-activeNotes approximation',
    `Conditional sensitive: ${current.sensitivity.conditionalDeltaR.count}/${current.eligibleRuns} (${formatPercent(current.sensitivity.conditionalDeltaR.rateAmongAllEligible)})`,
    `Breakdown: ACTIVATION_CHANGE ${current.breakdown.ACTIVATION_CHANGE} · MEMBERSHIP_CHANGE ${current.breakdown.MEMBERSHIP_CHANGE} · ORDER_ONLY_CHANGE ${current.breakdown.ORDER_ONLY_CHANGE} · SAME_VISIBLE_CONTEXT ${current.breakdown.SAME_VISIBLE_CONTEXT}`,
    `Query-resolution bounds: ${bounds.lowerPossibleSensitiveCount}..${bounds.upperPossibleSensitiveCount} · ΔR ${formatPercent(bounds.lowerDeltaR)}..${formatPercent(bounds.upperDeltaR)}`,
    `PIT-expanded bounds: ${bounds.pitLowerPossibleSensitiveCount}..${bounds.pitUpperPossibleSensitiveCount} · ΔR ${formatPercent(bounds.pitLowerDeltaR)}..${formatPercent(bounds.pitUpperDeltaR)}`,
    `Active-note input: exact ${current.activeNoteState.exact} · unknown/approximated as [] ${current.activeNoteState.approximateOrUnknown}`,
    `Gate: ${current.sensitivity.gate.result} · threshold ${current.sensitivity.gate.threshold} sensitive invocations`,
    'This is not exact current ΔR. Historical activeNotes input was not observed.',
    'P0-B paired answer generation: not started',
    '',
    `Safety: DB write no · Vault write no · connection changes ${report.safety.connectionChanges}`,
    `SQLite: readonly ${report.safety.sqliteReadonly} · query_only ${report.safety.sqliteQueryOnly}`,
    `External effect: ${report.safety.externalEffect}`,
  ];
  for (const review of current.reviews || []) {
    lines.push('', `질문: ${review.query}`, `분류: ${review.classification}`);
  }
  return lines.join('\n');
}

async function runCurrentInvocationD0Research({
  db,
  vaultPath,
  asOf = Date.now(),
  embedMissing = null,
  baselineCommit = 'unknown',
  includeReview = false,
} = {}) {
  const beforeChanges = db.prepare('SELECT total_changes() AS count').get().count;
  const online = buildOnlineEligibleVolume(db, { asOf });
  const corpus = await buildCurrentInvocationReplayCorpus(db, vaultPath, {
    asOf,
    embedMissing,
    embeddingModel: EMBEDDING_MODEL,
  });
  const d0 = await buildD0Sensitivity(corpus, { includeReview });
  const sensitivity = buildCurrentInvocationSensitivity({
    eligibleRuns: online.eligibleRuns,
    resolutionCounts: corpus.resolution.counts,
    replayedResolved: d0.comparableQueries,
    sensitiveResolved: d0.deltaR.count,
    approximateActiveNoteStateCount: d0.activeNoteState.approximateOrUnrecoverable,
  });
  const afterChanges = db.prepare('SELECT total_changes() AS count').get().count;
  return {
    baselineCommit,
    generatedAt: Math.floor(Date.now() / 1000),
    currentInvocationD0: {
      window: online.window,
      eligibleRuns: online.eligibleRuns,
      resolution: corpus.resolution.counts,
      resolutionCoverage: corpus.resolution.coverage,
      embeddings: {
        stored: corpus.storedEmbeddingCount,
        generated: corpus.generatedEmbeddingCount,
        generatedUniqueInputs: corpus.generatedUniqueInputs,
        externalApiBatches: corpus.externalApiBatches,
        failures: corpus.embeddingFailures,
        model: corpus.embeddingModel,
        persistence: 'none',
      },
      activeNoteState: sensitivity.activeNoteState,
      conditionalMetric: sensitivity.label,
      breakdown: d0.breakdown,
      sensitivity,
      sensitiveCases: d0.forwardedToP0B.cases,
      pointInTimeCaveats: d0.pointInTimeCaveats,
      ...(includeReview ? { reviews: d0.reviews } : {}),
    },
    safety: {
      galpiPersistentState: 'read-only',
      sqliteReadonly: true,
      sqliteQueryOnly: db.pragma('query_only', { simple: true }) === 1,
      connectionChanges: afterChanges - beforeChanges,
      productionDbWrite: false,
      vaultWrite: false,
      answerGeneration: false,
      externalEffect: corpus.externalApiBatches > 0
        ? `OpenAI ${EMBEDDING_MODEL} embedding request; in-memory result only`
        : 'none',
    },
  };
}

function openResearchDatabase(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  return db;
}

function createEmbeddingProvider(options) {
  if (!options.embedMissing) return null;
  require('dotenv').config({ path: options.envPath || path.join(ROOT, '.env') });
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return async inputs => {
    try {
      const response = await client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: inputs.map(input => String(input || '').slice(0, 8000)),
        encoding_format: 'float',
      });
      return [...response.data]
        .sort((left, right) => left.index - right.index)
        .map(item => item.embedding);
    } catch {
      return [];
    }
  };
}

async function runMemoryP0Research({
  db,
  vaultPath,
  asOf = Date.now(),
  limit = 77,
  embedMissing = null,
  baselineCommit = 'unknown',
  includeReview = false,
} = {}) {
  const beforeChanges = db.prepare('SELECT total_changes() AS count').get().count;
  const p01 = buildOnlineEligibleVolume(db, { asOf });
  const corpus = await buildHistoricalReplayCorpus(db, vaultPath, limit, {
    embedMissing,
    embeddingModel: EMBEDDING_MODEL,
  });
  const p02 = await buildD0Sensitivity(corpus, { includeReview });
  const afterChanges = db.prepare('SELECT total_changes() AS count').get().count;
  return {
    baselineCommit,
    generatedAt: Math.floor(Date.now() / 1000),
    p01,
    p02,
    safety: {
      galpiPersistentState: 'read-only',
      sqliteReadonly: true,
      sqliteQueryOnly: db.pragma('query_only', { simple: true }) === 1,
      connectionChanges: afterChanges - beforeChanges,
      productionDbWrite: false,
      vaultWrite: false,
      schemaChange: false,
      productionBehaviorChange: false,
      externalEffect: embedMissing
        ? `OpenAI ${EMBEDDING_MODEL} embedding request; in-memory result only`
        : 'none',
      answerGeneration: false,
    },
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${helpText()}\n`);
    return null;
  }
  if (!options.embedMissing) {
    require('dotenv').config({ path: options.envPath || path.join(ROOT, '.env') });
  }
  const runtimePaths = resolveRuntimePaths({ appRoot: ROOT });
  const dbPath = options.dbPath || runtimePaths.dbPath;
  const vaultPath = options.vaultPath || runtimePaths.vaultPath;
  const db = openResearchDatabase(dbPath);
  try {
    if (options.currentInvocationD0) {
      const report = await runCurrentInvocationD0Research({
        db,
        vaultPath,
        asOf: options.asOf ?? Date.now(),
        embedMissing: createEmbeddingProvider(options),
        baselineCommit: options.baselineCommit,
        includeReview: options.review,
      });
      process.stdout.write(`${options.json
        ? JSON.stringify(report, null, 2)
        : formatCurrentInvocationD0Report(report)}\n`);
      return report;
    }
    const report = await runMemoryP0Research({
      db,
      vaultPath,
      asOf: options.asOf ?? Date.now(),
      limit: options.limit,
      embedMissing: createEmbeddingProvider(options),
      baselineCommit: options.baselineCommit,
      includeReview: options.review,
    });
    process.stdout.write(`${options.json
      ? JSON.stringify(report, null, 2)
      : formatMemoryP0Report(report)}\n`);
    return report;
  } finally {
    db.close();
  }
}

module.exports = {
  buildCurrentInvocationReplayCorpus,
  createEmbeddingProvider,
  formatCurrentInvocationD0Report,
  helpText,
  main,
  openResearchDatabase,
  parseArguments,
  parseAsOf,
  runCurrentInvocationD0Research,
  runMemoryP0Research,
};

if (require.main === module) {
  main().catch(error => {
    console.error(`Memory P0-A measurement failed: ${error.message}`);
    process.exitCode = 1;
  });
}
