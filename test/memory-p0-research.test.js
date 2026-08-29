'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  CURRENT_GATE_RESULTS,
  D0_CLASSIFICATIONS,
  QUERY_RESOLUTION,
  buildD0Sensitivity,
  buildCurrentInvocationSensitivity,
  buildOnlineEligibleVolume,
  classifyVisibleRetrieval,
  formatMemoryP0Report,
  mostRecentCompleteKstWindow,
  parseActiveNotesTelemetry,
  parseRegularApiChatA2Mode,
  resolveCurrentInvocationQueries,
} = require('../lib/memory-p0-research');
const { sha256 } = require('../lib/content-hash');
const {
  helpText,
  openResearchDatabase,
  parseArguments,
  parseAsOf,
  runCurrentInvocationD0Research,
  runMemoryP0Research,
} = require('../scripts/measure-memory-p0-a');

const AS_OF = Date.parse('2026-08-29T12:00:00+09:00');

function createTraceDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE assistant_retrieval_shadow_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      mode TEXT NOT NULL,
      query_sha256 TEXT,
      notes_json TEXT NOT NULL,
      chunks_json TEXT NOT NULL,
      context_chars INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

function insertTrace(db, {
  sessionId = 'shared-main',
  mode,
  queryHash = sha256('same query'),
  chunks = [],
  contextChars = 0,
  error = null,
  createdAt,
}) {
  db.prepare(`
    INSERT INTO assistant_retrieval_shadow_runs (
      session_id, mode, query_sha256, notes_json, chunks_json,
      context_chars, latency_ms, error, created_at
    ) VALUES (?, ?, ?, '[]', ?, ?, 1, ?, ?)
  `).run(sessionId, mode, queryHash, JSON.stringify(chunks), contextChars, error, createdAt);
}

function createCurrentResolverDatabase() {
  const db = createTraceDatabase();
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT,
      runtime_generation TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

function insertChatPair(db, {
  sessionId = 'shared-main',
  query,
  embedding = [1, 0],
  runtimeGeneration = 'gpt-single-v1',
  createdAt,
}) {
  db.prepare(`
    INSERT INTO messages (
      session_id, role, content, embedding, runtime_generation, created_at
    ) VALUES (?, 'user', ?, ?, NULL, ?)
  `).run(sessionId, query, embedding ? JSON.stringify(embedding) : null, createdAt);
  db.prepare(`
    INSERT INTO messages (
      session_id, role, content, embedding, runtime_generation, created_at
    ) VALUES (?, 'assistant', 'answer', NULL, ?, ?)
  `).run(sessionId, runtimeGeneration, createdAt);
}

test('P0.1 uses the latest 28 complete KST calendar days', () => {
  assert.deepEqual(mostRecentCompleteKstWindow(AS_OF), {
    days: 28,
    startEpoch: Date.parse('2026-08-01T00:00:00+09:00') / 1000,
    endEpoch: Date.parse('2026-08-29T00:00:00+09:00') / 1000,
  });
});

test('P0.1 includes only regular /api/chat runtime-generation A2 modes', () => {
  assert.deepEqual(parseRegularApiChatA2Mode('chat:gpt-single-v1:a2'), {
    runtimeGeneration: 'gpt-single-v1',
  });
  assert.equal(parseRegularApiChatA2Mode('chat:a2'), null);
  assert.equal(parseRegularApiChatA2Mode('chat:gpt-single-v1:a1b'), null);
  assert.equal(parseRegularApiChatA2Mode('council-debate:a2'), null);
  assert.equal(parseRegularApiChatA2Mode('manual-preview:gpt-single-v1:a2'), null);
  assert.equal(parseRegularApiChatA2Mode('realtime:gpt-single-v1:a2'), null);
});

test('P0.1 counts repeated eligible invocations without query-hash deduplication', () => {
  const db = createTraceDatabase();
  const window = mostRecentCompleteKstWindow(AS_OF);
  const inside = window.startEpoch + 60;
  insertTrace(db, {
    mode: 'chat:gpt-single-v1:a2',
    createdAt: inside,
    chunks: [{ chunkId: 'a' }],
    contextChars: 100,
  });
  insertTrace(db, {
    mode: 'chat:gpt-single-v1:a2',
    createdAt: inside + 1,
    chunks: [{ chunkId: 'a' }],
    contextChars: 100,
  });
  insertTrace(db, {
    mode: 'chat:gpt-single-v2:a2',
    queryHash: null,
    createdAt: inside + 2,
    error: 'ranking failed',
  });
  for (const mode of [
    'chat:gpt-single-v1:a1b',
    'chat:a2',
    'council-debate:a2',
    'manual-preview:gpt-single-v1:a2',
    'realtime:gpt-single-v1:a2',
  ]) {
    insertTrace(db, { mode, createdAt: inside + 3 });
  }
  insertTrace(db, {
    mode: 'chat:gpt-single-v1:a2',
    createdAt: window.startEpoch - 1,
  });
  insertTrace(db, {
    mode: 'chat:gpt-single-v1:a2',
    createdAt: window.endEpoch,
  });

  const report = buildOnlineEligibleVolume(db, { asOf: AS_OF });
  assert.equal(report.eligibleRuns, 3);
  assert.equal(report.eligiblePerDay, 0.11);
  assert.deepEqual(report.byRuntimeGeneration, [
    { runtimeGeneration: 'gpt-single-v1', runs: 2 },
    { runtimeGeneration: 'gpt-single-v2', runs: 1 },
  ]);
  assert.equal(report.activation.count, 2);
  assert.equal(report.abstention.count, 1);
  assert.equal(report.errors, 1);
  assert.equal(report.missingQueryHashes, 1);
  assert.equal(report.contextChars.average, 66.67);
  assert.equal(report.scope, 'regular /api/chat A2 eligible retrieval invocations');
  db.close();
});

test('current trace resolver uses exact session/hash/runtime/time intervals per invocation', () => {
  const db = createCurrentResolverDatabase();
  const window = mostRecentCompleteKstWindow(AS_OF);
  const firstAt = window.startEpoch + 100;
  const repeatedQuery = '같은 질문';
  insertTrace(db, {
    mode: 'chat:gpt-single-v1:a2',
    queryHash: sha256(repeatedQuery),
    createdAt: firstAt,
  });
  insertChatPair(db, { query: repeatedQuery, createdAt: firstAt + 2 });
  insertTrace(db, {
    mode: 'chat:gpt-single-v1:a2',
    queryHash: sha256(repeatedQuery),
    createdAt: firstAt + 10,
  });
  insertChatPair(db, { query: repeatedQuery, createdAt: firstAt + 12 });

  const resolved = resolveCurrentInvocationQueries(db, { asOf: AS_OF });
  assert.deepEqual(resolved.counts, {
    RESOLVED: 2,
    AMBIGUOUS: 0,
    MISSING: 0,
  });
  assert.equal(resolved.invocations.length, 2);
  assert.ok(resolved.invocations.every(item => item.status === QUERY_RESOLUTION.RESOLVED));
  assert.equal(new Set(resolved.invocations.map(item => item.messageId)).size, 2);
  db.close();
});

test('current trace resolver does not guess ambiguous or missing query mappings', () => {
  const db = createCurrentResolverDatabase();
  const window = mostRecentCompleteKstWindow(AS_OF);
  const at = window.startEpoch + 100;
  const ambiguousQuery = '중복 후보';
  insertTrace(db, {
    mode: 'chat:gpt-single-v1:a2',
    queryHash: sha256(ambiguousQuery),
    createdAt: at,
  });
  insertChatPair(db, { query: ambiguousQuery, createdAt: at + 1 });
  insertChatPair(db, { query: ambiguousQuery, createdAt: at + 2 });
  insertTrace(db, {
    mode: 'chat:gpt-single-v1:a2',
    queryHash: sha256('다음 질문'),
    createdAt: at + 10,
  });
  insertChatPair(db, { query: '다른 내용', createdAt: at + 11 });

  const result = resolveCurrentInvocationQueries(db, { asOf: AS_OF });
  assert.equal(result.invocations[0].status, QUERY_RESOLUTION.AMBIGUOUS);
  assert.equal(result.invocations[0].query, undefined);
  assert.equal(result.invocations[1].status, QUERY_RESOLUTION.MISSING);
  assert.equal(result.invocations[1].query, undefined);
  assert.deepEqual(result.counts, {
    RESOLVED: 0,
    AMBIGUOUS: 1,
    MISSING: 1,
  });
  db.close();
});

test('same-second cross-table boundaries are ambiguous rather than treated as exact', () => {
  const db = createCurrentResolverDatabase();
  const window = mostRecentCompleteKstWindow(AS_OF);
  const at = window.startEpoch + 100;
  insertTrace(db, {
    mode: 'chat:gpt-single-v1:a2',
    queryHash: sha256('경계 질문'),
    createdAt: at,
  });
  insertChatPair(db, { query: '경계 질문', createdAt: at });

  const result = resolveCurrentInvocationQueries(db, { asOf: AS_OF });
  assert.equal(result.invocations[0].status, QUERY_RESOLUTION.AMBIGUOUS);
  db.close();
});

test('active-note telemetry distinguishes historical unknown from exact empty', () => {
  assert.deepEqual(parseActiveNotesTelemetry(null), {
    observed: false,
    state: 'UNKNOWN',
    identifiers: null,
  });
  assert.deepEqual(parseActiveNotesTelemetry('[]'), {
    observed: true,
    state: 'OBSERVED',
    identifiers: [],
  });
  assert.deepEqual(parseActiveNotesTelemetry('["topic.md"]'), {
    observed: true,
    state: 'OBSERVED',
    identifiers: ['topic.md'],
  });
});

function visible(chunks, context, score = 1) {
  return {
    context,
    chunks: chunks.map(([noteFilename, chunkId, content]) => ({
      noteFilename,
      chunkId,
      content,
      score,
    })),
  };
}

test('D0 classification distinguishes activation changes', () => {
  assert.equal(
    classifyVisibleRetrieval(visible([], ''), visible([['a.md', 'a', 'A']], '<retrieval>A</retrieval>')),
    D0_CLASSIFICATIONS.ACTIVATION_CHANGE,
  );
});

test('D0 classification distinguishes membership changes', () => {
  assert.equal(
    classifyVisibleRetrieval(
      visible([['a.md', 'a', 'A']], '<retrieval>A</retrieval>'),
      visible([['b.md', 'b', 'B']], '<retrieval>B</retrieval>'),
    ),
    D0_CLASSIFICATIONS.MEMBERSHIP_CHANGE,
  );
});

test('D0 classification counts same membership in a different order', () => {
  const a = ['a.md', 'a', 'A'];
  const b = ['b.md', 'b', 'B'];
  assert.equal(
    classifyVisibleRetrieval(
      visible([a, b], '<retrieval>A B</retrieval>'),
      visible([b, a], '<retrieval>B A</retrieval>'),
    ),
    D0_CLASSIFICATIONS.ORDER_ONLY_CHANGE,
  );
});

test('D0 classification ignores score-only differences with the same visible context', () => {
  const hard = visible([['a.md', 'a', 'A']], '<retrieval>A</retrieval>', 0.7);
  const soft = visible([['a.md', 'a', 'A']], '<retrieval>A</retrieval>', 0.9);
  assert.equal(
    classifyVisibleRetrieval(hard, soft),
    D0_CLASSIFICATIONS.SAME_VISIBLE_CONTEXT,
  );
});

test('D0 replay uses actual hard-gated/global-soft-prior paths and enforces PIT cutoff', async () => {
  const corpus = {
    sourceRuns: 2,
    uniqueQueries: 1,
    comparableQueries: 1,
    missingEmbeddings: 0,
    generatedEmbeddingCount: 0,
    embeddingFailures: 0,
    embeddingModel: 'text-embedding-3-small',
    changedQueries: 999,
    cases: [{
      comparable: true,
      query: '배포 경로',
      querySha256: sha256('배포 경로'),
      queryEmbedding: [1, 0],
      createdAt: 100,
      activeNotes: [],
      activeNoteStateApproximate: true,
      noteCandidates: [{
        filename: 'gate.md',
        title: '게이트',
        score: 0.9,
        keywordScore: 1,
      }],
      chunks: [
        {
          chunkId: 'inside-gate',
          noteFilename: 'gate.md',
          noteTitle: '게이트',
          content: 'Q: 배포 경로\nA: gate',
          embedding: [1, 0],
          createdAt: 90,
        },
        {
          chunkId: 'outside-gate',
          noteFilename: 'outside.md',
          noteTitle: '전역',
          content: 'Q: 배포 경로\nA: global',
          embedding: [1, 0],
          createdAt: 90,
        },
        {
          chunkId: 'future',
          noteFilename: 'future.md',
          noteTitle: '미래',
          content: 'Q: 배포 경로\nA: future',
          embedding: [1, 0],
          createdAt: 101,
        },
      ],
    }],
  };

  const report = await buildD0Sensitivity(corpus, { includeReview: true });
  assert.equal(report.comparableQueries, 1);
  assert.equal(report.deltaR.count, 1);
  assert.equal(report.breakdown.MEMBERSHIP_CHANGE, 1);
  assert.equal(report.forwardedToP0B.count, 1);
  assert.equal(report.forwardedToP0B.count, report.deltaR.count);
  assert.equal(report.reviews[0].hardGated.strategy, 'hard-gated');
  assert.equal(report.reviews[0].globalSoftPrior.strategy, 'global-soft-prior');
  assert.deepEqual(
    report.reviews[0].hardGated.chunks.map(chunk => chunk.chunkId),
    ['inside-gate'],
  );
  assert.ok(report.reviews[0].globalSoftPrior.chunks.some(chunk => (
    chunk.chunkId === 'outside-gate'
  )));
  assert.ok(report.reviews[0].hardGated.chunks.every(chunk => chunk.chunkId !== 'future'));
  assert.ok(report.reviews[0].globalSoftPrior.chunks.every(chunk => chunk.chunkId !== 'future'));
  assert.notEqual(report.deltaR.count, corpus.changedQueries);
});

test('D0 keeps final scorer thresholds fixed so gating is the only policy difference', async () => {
  const query = '기억 질문';
  const weakChunk = {
    chunkId: 'weak',
    noteFilename: 'gate.md',
    noteTitle: '게이트',
    content: 'Q: 전혀 다른 질문\nA: 약한 의미 유사도',
    embedding: [0.5, Math.sqrt(0.75)],
    createdAt: 10,
  };
  const report = await buildD0Sensitivity({
    sourceRuns: 1,
    uniqueQueries: 1,
    comparableQueries: 1,
    cases: [{
      comparable: true,
      query,
      querySha256: sha256(query),
      queryEmbedding: [1, 0],
      createdAt: 20,
      activeNotes: [],
      activeNoteStateApproximate: true,
      noteCandidates: [{ filename: 'gate.md', title: '게이트', score: 0.5 }],
      chunks: [weakChunk],
    }],
  }, { includeReview: true });

  assert.equal(report.reviews[0].hardGated.chunks.length, 0);
  assert.equal(report.reviews[0].globalSoftPrior.chunks.length, 0);
  assert.equal(report.breakdown.SAME_VISIBLE_CONTEXT, 1);
});

test('D0 replays repeated query invocations independently at their own PIT cutoffs', async () => {
  const baseCase = {
    comparable: true,
    query: '반복 질문',
    querySha256: sha256('반복 질문'),
    queryEmbedding: [1, 0],
    activeNotes: [],
    activeNoteStateApproximate: true,
    noteCandidates: [{ filename: 'gate.md', title: '게이트', score: 0.9 }],
    chunks: [{
      chunkId: 'late-global',
      noteFilename: 'outside.md',
      noteTitle: '전역',
      content: 'Q: 반복 질문\nA: later evidence',
      embedding: [1, 0],
      createdAt: 15,
    }],
  };
  const report = await buildD0Sensitivity({
    sourceRuns: 2,
    uniqueQueries: 1,
    cases: [
      { ...baseCase, traceId: 1, createdAt: 10 },
      { ...baseCase, traceId: 2, createdAt: 20 },
    ],
  });

  assert.equal(report.comparableQueries, 2);
  assert.equal(report.breakdown.SAME_VISIBLE_CONTEXT, 1);
  assert.equal(report.breakdown.ACTIVATION_CHANGE, 1);
  assert.deepEqual(report.forwardedToP0B.cases.map(item => item.traceId), [2]);
});

test('current invocation bounds retain unresolved cases and fail close on PIT uncertainty', () => {
  const base = {
    eligibleRuns: 181,
    resolutionCounts: { RESOLVED: 181, AMBIGUOUS: 0, MISSING: 0 },
    replayedResolved: 181,
    sensitiveResolved: 3,
    approximateActiveNoteStateCount: 181,
  };
  const pit = buildCurrentInvocationSensitivity(base);
  assert.equal(pit.bounds.lowerPossibleSensitiveCount, 3);
  assert.equal(pit.bounds.upperPossibleSensitiveCount, 3);
  assert.equal(pit.bounds.pitUpperPossibleSensitiveCount, 181);
  assert.equal(pit.gate.result, CURRENT_GATE_RESULTS.INDETERMINATE_PIT);

  const red = buildCurrentInvocationSensitivity({
    ...base,
    approximateActiveNoteStateCount: 0,
  });
  assert.equal(red.gate.result, CURRENT_GATE_RESULTS.RED_PROVEN_NO_P0B);

  const resolution = buildCurrentInvocationSensitivity({
    ...base,
    resolutionCounts: { RESOLVED: 166, AMBIGUOUS: 10, MISSING: 5 },
    replayedResolved: 166,
    approximateActiveNoteStateCount: 0,
  });
  assert.equal(resolution.bounds.upperPossibleSensitiveCount, 18);
  assert.equal(resolution.gate.result, CURRENT_GATE_RESULTS.RED_PROVEN_NO_P0B);

  const boundary = buildCurrentInvocationSensitivity({
    ...base,
    resolutionCounts: { RESOLVED: 164, AMBIGUOUS: 10, MISSING: 7 },
    replayedResolved: 164,
    approximateActiveNoteStateCount: 0,
  });
  assert.equal(boundary.bounds.upperPossibleSensitiveCount, 20);
  assert.equal(boundary.gate.result, CURRENT_GATE_RESULTS.INDETERMINATE_RESOLUTION);
});

function createResearchFixture(root) {
  const dbPath = path.join(root, 'galpi.db');
  const vaultPath = path.join(root, 'vault');
  fs.mkdirSync(vaultPath);
  fs.writeFileSync(path.join(vaultPath, 'topic.md'), [
    '---',
    'title: Topic',
    '---',
    '# Topic',
    'Q: 배포 경로',
    'A: /srv/app',
  ].join('\n'));
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE assistant_retrieval_shadow_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      mode TEXT NOT NULL,
      query_sha256 TEXT,
      notes_json TEXT NOT NULL,
      chunks_json TEXT NOT NULL,
      context_chars INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT,
      runtime_generation TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE notes (
      filename TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      note_type TEXT NOT NULL,
      embedding TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      ai_readable INTEGER NOT NULL DEFAULT 1,
      codex_status TEXT NOT NULL DEFAULT 'processed'
    );
    CREATE TABLE note_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chunk_id TEXT UNIQUE NOT NULL,
      note_filename TEXT NOT NULL,
      chunk_type TEXT NOT NULL,
      content TEXT NOT NULL,
      index_status TEXT NOT NULL,
      embedding TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  const question = '배포 경로';
  const queryHash = sha256(question);
  const traceAt = Date.parse('2026-07-20T12:00:00+09:00') / 1000;
  db.prepare(`
    INSERT INTO messages (session_id, role, content, embedding, created_at)
    VALUES ('shared-main', 'user', ?, ?, ?)
  `).run(question, JSON.stringify([1, 0]), traceAt - 1);
  db.prepare(`
    INSERT INTO messages (
      session_id, role, content, runtime_generation, created_at
    ) VALUES ('shared-main', 'assistant', 'historical answer', 'gpt-single-v1', ?)
  `).run(traceAt - 1);
  db.prepare(`
    INSERT INTO notes (filename, title, note_type, embedding)
    VALUES ('topic.md', 'Topic', 'topic', ?)
  `).run(JSON.stringify([1, 0]));
  db.prepare(`
    INSERT INTO note_chunks (
      chunk_id, note_filename, chunk_type, content,
      index_status, embedding, created_at, updated_at
    ) VALUES ('qa-1', 'topic.md', 'topic_qa', ?, 'ready', ?, ?, ?)
  `).run('Q: 배포 경로\nA: /srv/app', JSON.stringify([1, 0]), traceAt - 10, traceAt - 10);
  insertTrace(db, {
    mode: 'chat:a1b',
    queryHash,
    createdAt: traceAt,
    chunks: [{ chunkId: 'qa-1', noteFilename: 'topic.md' }],
    contextChars: 100,
  });
  const currentTraceAt = Date.parse('2026-08-10T12:00:00+09:00') / 1000;
  insertTrace(db, {
    mode: 'chat:gpt-single-v1:a2',
    queryHash,
    createdAt: currentTraceAt,
    chunks: [{ chunkId: 'qa-1', noteFilename: 'topic.md' }],
    contextChars: 100,
  });
  db.prepare(`
    INSERT INTO messages (session_id, role, content, embedding, created_at)
    VALUES ('shared-main', 'user', ?, ?, ?)
  `).run(question, JSON.stringify([1, 0]), currentTraceAt + 1);
  db.prepare(`
    INSERT INTO messages (
      session_id, role, content, runtime_generation, created_at
    ) VALUES ('shared-main', 'assistant', 'current answer', 'gpt-single-v1', ?)
  `).run(currentTraceAt + 1);
  db.close();
  return { dbPath, vaultPath };
}

test('research execution keeps DB and Vault bytes unchanged and default output private', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'galpi-p0-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { dbPath, vaultPath } = createResearchFixture(root);
  const dbBefore = fs.readFileSync(dbPath);
  const vaultFile = path.join(vaultPath, 'topic.md');
  const vaultBefore = fs.readFileSync(vaultFile);
  const db = openResearchDatabase(dbPath);
  assert.throws(() => db.prepare('UPDATE notes SET title = ?').run('changed'), /readonly|read-only/i);

  const report = await runMemoryP0Research({
    db,
    vaultPath,
    asOf: AS_OF,
    baselineCommit: '62ad111861991f0a71ecd4133578240a6f86478f',
  });
  assert.equal(report.safety.connectionChanges, 0);
  assert.equal(report.safety.productionDbWrite, false);
  assert.equal(report.safety.vaultWrite, false);
  assert.equal(report.safety.answerGeneration, false);
  db.close();

  assert.deepEqual(fs.readFileSync(dbPath), dbBefore);
  assert.deepEqual(fs.readFileSync(vaultFile), vaultBefore);
  const output = formatMemoryP0Report(report);
  assert.doesNotMatch(output, /배포 경로|\/srv\/app|topic\.md/);
  assert.match(output, /Galpi persistent state is read-only/);
});

test('current invocation follow-up keeps DB and Vault bytes unchanged', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'galpi-p0-current-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { dbPath, vaultPath } = createResearchFixture(root);
  const dbBefore = fs.readFileSync(dbPath);
  const vaultFile = path.join(vaultPath, 'topic.md');
  const vaultBefore = fs.readFileSync(vaultFile);
  const db = openResearchDatabase(dbPath);

  const report = await runCurrentInvocationD0Research({
    db,
    vaultPath,
    asOf: AS_OF,
    baselineCommit: 'f0d825311708b19e23d899f46cc40f53baed3222',
  });
  assert.equal(report.currentInvocationD0.eligibleRuns, 1);
  assert.equal(report.currentInvocationD0.resolution.RESOLVED, 1);
  assert.equal(report.currentInvocationD0.embeddings.stored, 1);
  assert.equal(report.currentInvocationD0.embeddings.externalApiBatches, 0);
  assert.equal(report.safety.connectionChanges, 0);
  assert.equal(report.safety.answerGeneration, false);
  db.close();

  assert.deepEqual(fs.readFileSync(dbPath), dbBefore);
  assert.deepEqual(fs.readFileSync(vaultFile), vaultBefore);
});

test('P0 CLI keeps review explicit and documents the external embedding effect', () => {
  assert.equal(parseAsOf('2026-08-29'), AS_OF);
  const options = parseArguments([
    '--db', './galpi.db',
    '--vault', './vault',
    '--as-of', '2026-08-29',
    '--limit', '77',
    '--embed-missing',
    '--env', './.env',
    '--baseline-commit', '62ad111861991f0a71ecd4133578240a6f86478f',
    '--review',
    '--json',
  ]);
  assert.equal(options.embedMissing, true);
  assert.equal(options.review, true);
  assert.equal(options.limit, 77);
  assert.equal(options.currentInvocationD0, false);
  assert.throws(() => parseArguments(['--limit', '101']), /1~100/);
  assert.match(helpText(), /기본 출력에는 질문·노트 본문·파일명이 없습니다/);
  assert.match(helpText(), /외부 호출을 수행하지만 저장하지 않습니다/);
  assert.match(helpText(), /P0-B answer generation은 이 명령의 범위가 아닙니다/);
  assert.match(helpText(), /--current-invocation-d0/);
});
