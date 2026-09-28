#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { sha256 } = require('../lib/content-hash');
const {
  D0_CLASSIFICATIONS,
  buildD0Sensitivity,
  parseActiveNotesTelemetry,
  resolveCurrentInvocationQueries,
} = require('../lib/memory-p0-research');
const {
  loadChunks,
  loadNotes,
  parseEmbedding,
  rankReplayNoteCandidates,
} = require('./review-retrieval-policy');

const WINDOW = Object.freeze({
  startKst: '2026-08-31 00:00 KST',
  endExclusiveKst: '2026-09-28 00:00 KST',
  startEpoch: Date.parse('2026-08-31T00:00:00+09:00') / 1000,
  endEpoch: Date.parse('2026-09-28T00:00:00+09:00') / 1000,
});
const EXPECTED_ELIGIBLE = 409;
const AS_OF = Date.parse('2026-09-28T12:00:00+09:00');
const DISPOSITIONS = Object.freeze([
  'NO_D0_BY_PRODUCTION_SEMANTICS',
  'REPLAY_SAME',
  'REPLAY_SENSITIVE',
  'PIT_UNCERTAIN',
]);
const RESIDUAL_PIT_CAVEATS = Object.freeze([
  'Current note embeddings and note bodies can include post-invocation information; case-level historical influence is not fully identifiable.',
  'Deleted or changed historical chunks outside retained selected-chunk evidence cannot be fully reconstructed.',
  'Stored message embeddings reproduce production query input/model semantics but do not prove byte-identical historical embedding responses.',
]);

function chunkIdentity(chunks) {
  return (chunks || []).map(chunk => [chunk.chunkId, chunk.noteFilename]);
}

function identityHash(chunks) {
  return sha256(JSON.stringify(chunkIdentity(chunks)));
}

function parseActualChunks(value) {
  try {
    const chunks = JSON.parse(value);
    return Array.isArray(chunks) && chunks.every(chunk => (
      typeof chunk?.chunkId === 'string' && typeof chunk?.noteFilename === 'string'
    )) ? chunks : null;
  } catch {
    return null;
  }
}

function resolutionForInvocation(invocation, telemetry, appliedAt) {
  if (invocation.createdAt < appliedAt) {
    if (telemetry.resolutionOutcome !== null || telemetry.retrievalQuerySha256 !== null) {
      return { reason: 'PIT_UNCERTAIN_RESOLUTION_TELEMETRY' };
    }
    return { outcome: 'LEGACY_PRE_RESOLVER', query: invocation.query };
  }
  if (telemetry.resolutionOutcome === null) {
    return { reason: 'PIT_UNCERTAIN_RESOLUTION_TELEMETRY' };
  }
  if (telemetry.resolutionOutcome === 'pass') {
    return telemetry.retrievalQuerySha256 === invocation.querySha256
      ? { outcome: 'pass', query: invocation.query }
      : { reason: 'PIT_UNCERTAIN_QUERY_RESOLUTION' };
  }
  if (telemetry.resolutionOutcome === 'no_retrieval'
    || telemetry.resolutionOutcome === 'ambiguous') {
    return telemetry.retrievalQuerySha256 === null
      ? { outcome: telemetry.resolutionOutcome, noD0: true }
      : { reason: 'PIT_UNCERTAIN_QUERY_RESOLUTION' };
  }
  if (telemetry.resolutionOutcome === 'resolved') {
    return { reason: 'PIT_UNCERTAIN_QUERY_RESOLUTION' };
  }
  return { reason: 'PIT_UNCERTAIN_RESOLUTION_TELEMETRY' };
}

function summarize(cases) {
  const dispositions = Object.fromEntries(DISPOSITIONS.map(value => [value, 0]));
  const sensitiveSubtypes = Object.fromEntries(
    Object.values(D0_CLASSIFICATIONS)
      .filter(value => value !== D0_CLASSIFICATIONS.SAME_VISIBLE_CONTEXT)
      .map(value => [value, 0]),
  );
  const uncertainReasons = {};
  for (const item of cases) {
    dispositions[item.disposition] += 1;
    if (item.disposition === 'REPLAY_SENSITIVE') sensitiveSubtypes[item.d0Classification] += 1;
    for (const reason of item.uncertaintyReasons || []) {
      uncertainReasons[reason] = (uncertainReasons[reason] || 0) + 1;
    }
  }
  return { dispositions, sensitiveSubtypes, uncertainReasons };
}

async function buildReplayCensus({ db, vaultPath, baselineCommit, expectedEligible = EXPECTED_ELIGIBLE }) {
  const beforeChanges = db.prepare('SELECT total_changes() AS count').get().count;
  const queryOnly = db.pragma('query_only', { simple: true });
  if (!db.readonly || queryOnly !== 1) throw new Error('readonly=true/query_only=true 연결이 필요합니다.');
  const migration = db.prepare(`
    SELECT applied_at AS appliedAt
    FROM schema_version
    WHERE version = 26 AND name = 'retrieval_query_resolution_trace'
  `).get();
  if (!Number.isInteger(migration?.appliedAt)) throw new Error('schema v26 적용 시각을 확인할 수 없습니다.');
  // v26 is applied in server startup before requests; second-resolution timestamps must not overlap.
  const boundaryOverlap = db.prepare(`
    SELECT COUNT(*) AS count FROM assistant_retrieval_shadow_runs
    WHERE created_at = ? AND mode GLOB 'chat:*:a2'
  `).get(migration.appliedAt).count;
  if (boundaryOverlap) throw new Error('v26 applied_at과 같은 초의 trace가 있어 경계를 증명할 수 없습니다.');

  const resolution = resolveCurrentInvocationQueries(db, { asOf: AS_OF });
  if (resolution.window.startEpoch !== WINDOW.startEpoch
    || resolution.window.endEpoch !== WINDOW.endEpoch) {
    throw new Error('고정 28일 window와 current resolver window가 다릅니다.');
  }
  if (resolution.eligibleRuns !== expectedEligible) {
    throw new Error(`eligible invocation 불변식 실패: ${resolution.eligibleRuns} != ${expectedEligible}`);
  }
  const telemetry = new Map(db.prepare(`
    SELECT id, resolution_outcome AS resolutionOutcome,
           retrieval_query_sha256 AS retrievalQuerySha256, chunks_json AS chunksJson
    FROM assistant_retrieval_shadow_runs
    WHERE created_at >= ? AND created_at < ? AND mode GLOB 'chat:*:a2'
  `).all(WINDOW.startEpoch, WINDOW.endEpoch).map(row => [row.id, row]));
  const notes = loadNotes(db, vaultPath);
  const chunks = loadChunks(db);
  const notesByFilename = new Map(notes.map(note => [note.filename, note]));
  const chunksByIdentity = new Map(chunks.map(chunk => [JSON.stringify([
    chunk.chunkId, chunk.noteFilename,
  ]), chunk]));
  const cases = [];
  const replayCases = [];

  for (const invocation of resolution.invocations) {
    const trace = telemetry.get(invocation.traceId);
    if (!trace) throw new Error(`trace ${invocation.traceId}의 resolver telemetry가 없습니다.`);
    const activeState = parseActiveNotesTelemetry(invocation.activeNotesJson);
    const actualChunks = parseActualChunks(trace.chunksJson);
    const item = {
      traceId: invocation.traceId,
      messageId: invocation.messageId || null,
      createdAt: invocation.createdAt,
      runtimeGeneration: invocation.runtimeGeneration,
      querySha256: invocation.querySha256,
      retrievalQuerySha256: trace.retrievalQuerySha256,
      resolutionOutcome: trace.resolutionOutcome,
      activeNotesObserved: activeState.observed,
      activeNoteCount: activeState.identifiers?.length ?? null,
      disposition: null,
      d0Classification: null,
      hardContextSha256: null,
      globalContextSha256: null,
      hardChunkIdentitySha256: null,
      globalChunkIdentitySha256: null,
      actualChunkIdentitySha256: actualChunks ? identityHash(actualChunks) : null,
      uncertaintyReasons: [],
    };
    cases.push(item);
    function uncertain(reason) {
      item.disposition = 'PIT_UNCERTAIN';
      item.uncertaintyReasons.push(reason);
    }
    if (invocation.status !== 'RESOLVED' || !invocation.querySha256) {
      uncertain('PIT_UNCERTAIN_MESSAGE_MAPPING');
      continue;
    }
    if (!activeState.observed) {
      uncertain('PIT_UNCERTAIN_ACTIVE_NOTES');
      continue;
    }
    const queryResolution = resolutionForInvocation(invocation, trace, migration.appliedAt);
    if (queryResolution.reason) {
      uncertain(queryResolution.reason);
      continue;
    }
    if (queryResolution.noD0) {
      if (!actualChunks || actualChunks.length || !Number.isInteger(invocation.createdAt)) {
        uncertain('PIT_UNCERTAIN_CORPUS_REPLAY');
      } else {
        item.disposition = 'NO_D0_BY_PRODUCTION_SEMANTICS';
      }
      continue;
    }
    const embedding = parseEmbedding(invocation.embedding);
    if (!embedding) {
      uncertain('PIT_UNCERTAIN_QUERY_EMBEDDING');
      continue;
    }
    if (!actualChunks || activeState.identifiers.some(filename => !notesByFilename.has(filename))) {
      uncertain('PIT_UNCERTAIN_CORPUS_REPLAY');
      continue;
    }
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
    replayCases.push({
      traceId: invocation.traceId,
      createdAt: invocation.createdAt,
      querySha256: invocation.querySha256,
      query: queryResolution.query,
      queryEmbedding: embedding,
      activeNotes: activeState.identifiers.map(filename => ({
        filename, title: notesByFilename.get(filename).title,
      })),
      noteCandidates: rankReplayNoteCandidates({
        query: queryResolution.query,
        queryEmbedding: embedding,
        notes: temporalNotes,
      }),
      chunks: temporalChunks,
      comparable: true,
    });
  }

  const replay = await buildD0Sensitivity({ cases: replayCases }, { includeReview: true });
  const reviews = new Map(replay.reviews.map(review => [review.traceId, review]));
  for (const item of cases.filter(entry => entry.disposition === null)) {
    const review = reviews.get(item.traceId);
    const actual = parseActualChunks(telemetry.get(item.traceId).chunksJson);
    if (!review) throw new Error(`trace ${item.traceId}의 replay 결과가 없습니다.`);
    const replayGlobal = review.globalSoftPrior.chunks;
    const selected = [...actual, ...review.hardGated.chunks, ...replayGlobal];
    const missingOrChanged = selected.some(chunk => {
      const retained = chunksByIdentity.get(JSON.stringify([chunk.chunkId, chunk.noteFilename]));
      return !retained || retained.updatedAt >= item.createdAt;
    });
    if (missingOrChanged || identityHash(actual) !== identityHash(replayGlobal)) {
      item.disposition = 'PIT_UNCERTAIN';
      item.uncertaintyReasons.push('PIT_UNCERTAIN_CORPUS_REPLAY');
      continue;
    }
    item.d0Classification = review.classification;
    item.hardContextSha256 = review.hardContextSha256;
    item.globalContextSha256 = review.globalContextSha256;
    item.hardChunkIdentitySha256 = identityHash(review.hardGated.chunks);
    item.globalChunkIdentitySha256 = identityHash(replayGlobal);
    item.disposition = review.classification === D0_CLASSIFICATIONS.SAME_VISIBLE_CONTEXT
      ? 'REPLAY_SAME' : 'REPLAY_SENSITIVE';
  }
  if (cases.some(item => !DISPOSITIONS.includes(item.disposition))) {
    throw new Error('모든 invocation의 disposition이 확정되지 않았습니다.');
  }
  const afterChanges = db.prepare('SELECT total_changes() AS count').get().count;
  if (afterChanges !== beforeChanges) throw new Error('읽기 전용 연결에서 total_changes()가 증가했습니다.');
  return {
    schemaVersion: 1,
    baselineCommit,
    window: WINDOW,
    eligibleUniverse: expectedEligible,
    resolverInstrumentation: { schemaVersion: 26, appliedAt: migration.appliedAt },
    status: {
      p0bPreparation: 'COMPLETE',
      operationalReplayCensus: 'FROZEN',
      answerGeneration: 'NOT_STARTED',
      strictHistoricalExactS: 'UNPROVEN',
    },
    counts: summarize(cases),
    residualPitCaveats: RESIDUAL_PIT_CAVEATS,
    safety: {
      sqliteReadonly: db.readonly,
      sqliteQueryOnly: queryOnly === 1,
      totalChangesDelta: afterChanges - beforeChanges,
      externalApiCalls: 0,
      answerGenerations: 0,
    },
    cases,
  };
}

function parseArguments(argv) {
  const options = { dbPath: null, vaultPath: null, baselineCommit: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--db') options.dbPath = argv[++index];
    else if (argument === '--vault') options.vaultPath = argv[++index];
    else if (argument === '--baseline-commit') options.baselineCommit = argv[++index];
    else throw new Error(`알 수 없는 인자입니다: ${argument}`);
  }
  if (!/^[0-9a-f]{40}$/.test(options.baselineCommit || '')) {
    throw new Error('--baseline-commit에 40자리 commit SHA가 필요합니다.');
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const root = path.resolve(__dirname, '..');
  const dbPath = options.dbPath || path.join(root, 'galpi.db');
  const vaultPath = options.vaultPath || path.join(root, 'galpi-vault');
  if (!fs.statSync(vaultPath).isDirectory()) throw new Error('Vault 경로가 디렉터리가 아닙니다.');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  try {
    const artifact = await buildReplayCensus({
      db, vaultPath, baselineCommit: options.baselineCommit,
    });
    process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
  } finally {
    db.close();
  }
}

module.exports = { buildReplayCensus, resolutionForInvocation, parseArguments, main };
if (require.main === module) {
  main().catch(error => {
    console.error(`P0-B census freeze failed: ${error.message}`);
    process.exitCode = 1;
  });
}
