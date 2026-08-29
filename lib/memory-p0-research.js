'use strict';

const {
  DEFAULT_SHADOW_RETRIEVAL_LIMITS,
  buildGlobalShadowRetrieval,
} = require('./assistant-retrieval');
const { mergeShadowNoteCandidates } = require('./assistant-retrieval-shadow');
const { sha256 } = require('./content-hash');

const KST_OFFSET_SECONDS = 9 * 60 * 60;
const P0_WINDOW_DAYS = 28;
const REGULAR_API_CHAT_A2_MODE = /^chat:([^:]+):a2$/u;

const D0_CLASSIFICATIONS = Object.freeze({
  ACTIVATION_CHANGE: 'ACTIVATION_CHANGE',
  MEMBERSHIP_CHANGE: 'MEMBERSHIP_CHANGE',
  ORDER_ONLY_CHANGE: 'ORDER_ONLY_CHANGE',
  SAME_VISIBLE_CONTEXT: 'SAME_VISIBLE_CONTEXT',
});

const QUERY_RESOLUTION = Object.freeze({
  RESOLVED: 'RESOLVED',
  AMBIGUOUS: 'AMBIGUOUS',
  MISSING: 'MISSING',
});

const CURRENT_GATE_RESULTS = Object.freeze({
  RED_PROVEN_NO_P0B: 'RED_PROVEN_NO_P0B',
  P0B_STILL_POSSIBLE: 'P0B_STILL_POSSIBLE',
  INDETERMINATE_RESOLUTION: 'INDETERMINATE_RESOLUTION',
  INDETERMINATE_PIT: 'INDETERMINATE_PIT',
});

const P0_INFORMATIVE_CASE_THRESHOLD = 20;

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[Math.min(rank - 1, sorted.length - 1)];
}

function summarizeNumbers(values) {
  return {
    average: round(values.length > 0
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    maximum: values.length > 0 ? Math.max(...values) : 0,
  };
}

function mostRecentCompleteKstWindow(asOf = Date.now()) {
  const instant = asOf instanceof Date ? asOf : new Date(asOf);
  if (!Number.isFinite(instant.getTime())) throw new TypeError('유효한 측정 기준 시각이 필요합니다.');
  const shifted = new Date(instant.getTime() + KST_OFFSET_SECONDS * 1000);
  const endEpoch = Math.floor(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  ) / 1000) - KST_OFFSET_SECONDS;
  return {
    days: P0_WINDOW_DAYS,
    startEpoch: endEpoch - P0_WINDOW_DAYS * 24 * 60 * 60,
    endEpoch,
  };
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseRegularApiChatA2Mode(mode) {
  const match = String(mode || '').match(REGULAR_API_CHAT_A2_MODE);
  return match ? { runtimeGeneration: match[1] } : null;
}

function loadWindowRuns(db, window) {
  const columns = new Set(
    db.prepare('PRAGMA table_info(assistant_retrieval_shadow_runs)')
      .all()
      .map(column => column.name),
  );
  if (columns.size === 0) throw new Error('assistant_retrieval_shadow_runs 테이블이 없습니다.');
  const queryHashColumn = columns.has('query_sha256')
    ? 'query_sha256 AS querySha256'
    : 'NULL AS querySha256';
  const activeNotesColumn = columns.has('active_notes_json')
    ? 'active_notes_json AS activeNotesJson'
    : 'NULL AS activeNotesJson';
  return db.prepare(`
    SELECT id, session_id AS sessionId, mode, ${queryHashColumn},
           ${activeNotesColumn}, notes_json AS notesJson, chunks_json AS chunksJson,
           context_chars AS contextChars, error, created_at AS createdAt
    FROM assistant_retrieval_shadow_runs
    WHERE created_at >= ? AND created_at < ?
    ORDER BY created_at ASC, id ASC
  `).all(window.startEpoch, window.endEpoch);
}

function loadAllRegularApiChatA2Runs(db) {
  return db.prepare(`
    SELECT id, session_id AS sessionId, mode,
           query_sha256 AS querySha256, created_at AS createdAt
    FROM assistant_retrieval_shadow_runs
    WHERE mode GLOB 'chat:*:a2'
    ORDER BY session_id ASC, created_at ASC, id ASC
  `).all().filter(row => parseRegularApiChatA2Mode(row.mode));
}

function messageColumns(db) {
  return new Set(db.prepare('PRAGMA table_info(messages)').all().map(column => column.name));
}

function emptyResolutionCounts() {
  return Object.fromEntries(Object.values(QUERY_RESOLUTION).map(status => [status, 0]));
}

function resolveCurrentInvocationQueries(db, { asOf = Date.now() } = {}) {
  if (!db?.prepare) throw new TypeError('SQLite DB 연결이 필요합니다.');
  const window = mostRecentCompleteKstWindow(asOf);
  const eligible = loadWindowRuns(db, window)
    .flatMap(row => {
      const parsedMode = parseRegularApiChatA2Mode(row.mode);
      return parsedMode ? [{ ...row, ...parsedMode }] : [];
    });
  const allRuns = loadAllRegularApiChatA2Runs(db);
  const runsBySession = new Map();
  for (const run of allRuns) {
    if (!runsBySession.has(run.sessionId)) runsBySession.set(run.sessionId, []);
    runsBySession.get(run.sessionId).push(run);
  }

  const columns = messageColumns(db);
  const runtimeColumn = columns.has('runtime_generation')
    ? 'next.runtime_generation AS assistantRuntimeGeneration'
    : 'NULL AS assistantRuntimeGeneration';
  const embeddingColumn = columns.has('embedding') ? 'm.embedding' : 'NULL AS embedding';
  const pairs = db.prepare(`
    SELECT m.id AS messageId, m.session_id AS sessionId, m.content,
           ${embeddingColumn}, m.created_at AS createdAt,
           next.id AS assistantMessageId, ${runtimeColumn}
    FROM messages m
    LEFT JOIN messages next
      ON next.id = m.id + 1 AND next.session_id = m.session_id
    WHERE m.role = 'user' AND next.role = 'assistant'
    ORDER BY m.session_id ASC, m.created_at ASC, m.id ASC
  `).all();
  const pairsBySession = new Map();
  for (const pair of pairs) {
    if (!pairsBySession.has(pair.sessionId)) pairsBySession.set(pair.sessionId, []);
    pairsBySession.get(pair.sessionId).push({
      ...pair,
      querySha256: sha256(pair.content),
    });
  }

  const counts = emptyResolutionCounts();
  const invocations = eligible.map(trace => {
    const sessionRuns = runsBySession.get(trace.sessionId) || [];
    const traceIndex = sessionRuns.findIndex(run => run.id === trace.id);
    const nextTrace = traceIndex >= 0 ? sessionRuns[traceIndex + 1] || null : null;
    const sessionPairs = pairsBySession.get(trace.sessionId) || [];
    const inStrictInterval = sessionPairs.filter(pair => (
      pair.createdAt > trace.createdAt
      && (!nextTrace || pair.createdAt < nextTrace.createdAt)
      && pair.assistantRuntimeGeneration === trace.runtimeGeneration
    ));
    const boundaryMatches = sessionPairs.filter(pair => (
      pair.querySha256 === trace.querySha256
      && pair.assistantRuntimeGeneration === trace.runtimeGeneration
      && (
        pair.createdAt === trace.createdAt
        || (nextTrace && pair.createdAt === nextTrace.createdAt)
      )
    ));
    let status = QUERY_RESOLUTION.MISSING;
    let message = null;
    if (inStrictInterval.length > 1 || boundaryMatches.length > 0) {
      status = QUERY_RESOLUTION.AMBIGUOUS;
    } else if (
      inStrictInterval.length === 1
      && trace.querySha256
      && inStrictInterval[0].querySha256 === trace.querySha256
    ) {
      status = QUERY_RESOLUTION.RESOLVED;
      [message] = inStrictInterval;
    }
    counts[status] += 1;
    const publicTrace = {
      traceId: trace.id,
      sessionId: trace.sessionId,
      mode: trace.mode,
      runtimeGeneration: trace.runtimeGeneration,
      querySha256: trace.querySha256,
      createdAt: trace.createdAt,
      notesJson: trace.notesJson,
      activeNotesJson: trace.activeNotesJson,
      status,
    };
    if (!message) return publicTrace;
    return {
      ...publicTrace,
      messageId: message.messageId,
      assistantMessageId: message.assistantMessageId,
      query: message.content,
      embedding: message.embedding,
    };
  });

  return {
    window,
    eligibleRuns: eligible.length,
    counts,
    coverage: eligible.length > 0 ? counts.RESOLVED / eligible.length : 0,
    invocations,
  };
}

function parseActiveNotesTelemetry(value) {
  if (value === null || value === undefined) {
    return { observed: false, state: 'UNKNOWN', identifiers: null };
  }
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every(item => typeof item === 'string')) {
      return { observed: false, state: 'UNKNOWN', identifiers: null };
    }
    return { observed: true, state: 'OBSERVED', identifiers: parsed };
  } catch {
    return { observed: false, state: 'UNKNOWN', identifiers: null };
  }
}

function formatKstDate(epoch) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epoch * 1000));
}

function buildOnlineEligibleVolume(db, { asOf = Date.now() } = {}) {
  if (!db?.prepare) throw new TypeError('SQLite DB 연결이 필요합니다.');
  const window = mostRecentCompleteKstWindow(asOf);
  const rows = loadWindowRuns(db, window);
  const eligible = [];
  const excludedModeCounts = new Map();
  for (const row of rows) {
    const parsedMode = parseRegularApiChatA2Mode(row.mode);
    if (!parsedMode) {
      excludedModeCounts.set(row.mode, (excludedModeCounts.get(row.mode) || 0) + 1);
      continue;
    }
    const chunks = parseJsonArray(row.chunksJson);
    eligible.push({ ...row, ...parsedMode, chunks });
  }

  const runtimeCounts = new Map();
  const dailyCounts = new Map();
  let invalidJsonRuns = 0;
  for (const row of eligible) {
    runtimeCounts.set(
      row.runtimeGeneration,
      (runtimeCounts.get(row.runtimeGeneration) || 0) + 1,
    );
    const day = formatKstDate(row.createdAt);
    dailyCounts.set(day, (dailyCounts.get(day) || 0) + 1);
    if (!row.chunks) invalidJsonRuns += 1;
  }

  const activationCount = eligible.filter(row => Number(row.contextChars) > 0).length;
  const abstentionCount = eligible.length - activationCount;
  const errors = eligible.filter(row => Boolean(row.error)).length;
  const missingQueryHashes = eligible.filter(row => !row.querySha256).length;
  const saturationCount = eligible.filter(row => (
    Number(row.contextChars) >= DEFAULT_SHADOW_RETRIEVAL_LIMITS.maxContextChars
    || (row.chunks?.length || 0) >= DEFAULT_SHADOW_RETRIEVAL_LIMITS.maxChunks
  )).length;
  const allEligibleFirst = db.prepare(`
    SELECT MIN(created_at) AS firstSeen
    FROM assistant_retrieval_shadow_runs
    WHERE mode LIKE 'chat:%:a2'
  `).get()?.firstSeen || null;
  const daysWithRuns = dailyCounts.size;
  const caveats = [
    'Typed chat와 같은 /api/chat A2 retrieval path를 타는 half-duplex voice를 함께 포함한다.',
    'Realtime/voice의 별도 retrieval 또는 instrumentation path는 mode filter로 포함하지 않는다.',
    '실행이 없는 날짜는 무사용과 logging outage를 trace만으로 구분할 수 없다.',
  ];
  if (allEligibleFirst && allEligibleFirst > window.startEpoch) {
    caveats.push('A2 eligible trace가 observation window 시작 뒤에 처음 나타나 window 일부의 coverage가 없다.');
  }
  if (invalidJsonRuns > 0) caveats.push(`chunks_json을 해석하지 못한 eligible trace가 ${invalidJsonRuns}건 있다.`);

  return {
    scope: 'regular /api/chat A2 eligible retrieval invocations',
    includedModePattern: 'chat:<runtimeGeneration>:a2',
    includedChannels: ['typed chat', 'half-duplex voice through /api/chat'],
    excluded: [
      'realtime/voice retrieval paths with different instrumentation',
      'council',
      'manual preview/eval',
      'unrelated modes',
    ],
    window: {
      ...window,
      startKst: formatKstDate(window.startEpoch),
      endExclusiveKst: formatKstDate(window.endEpoch),
    },
    eligibleRuns: eligible.length,
    eligiblePerDay: round(eligible.length / P0_WINDOW_DAYS),
    byRuntimeGeneration: [...runtimeCounts.entries()]
      .map(([runtimeGeneration, runs]) => ({ runtimeGeneration, runs }))
      .sort((left, right) => left.runtimeGeneration.localeCompare(right.runtimeGeneration)),
    includedModes: [...new Set(eligible.map(row => row.mode))].sort(),
    excludedModesInWindow: [...excludedModeCounts.entries()]
      .map(([mode, runs]) => ({ mode, runs }))
      .sort((left, right) => left.mode.localeCompare(right.mode)),
    activation: {
      count: activationCount,
      rate: eligible.length > 0 ? activationCount / eligible.length : 0,
    },
    abstention: {
      count: abstentionCount,
      rate: eligible.length > 0 ? abstentionCount / eligible.length : 0,
    },
    errors,
    missingQueryHashes,
    invalidJsonRuns,
    contextChars: summarizeNumbers(eligible.map(row => Number(row.contextChars) || 0)),
    saturation: {
      count: saturationCount,
      rate: eligible.length > 0 ? saturationCount / eligible.length : 0,
    },
    traceCoverage: {
      firstEligibleTraceAt: eligible[0]?.createdAt || null,
      lastEligibleTraceAt: eligible.at(-1)?.createdAt || null,
      daysWithRuns,
      daysWithoutRuns: P0_WINDOW_DAYS - daysWithRuns,
      caveats,
    },
  };
}

function visibleChunkKey(chunk) {
  return sha256([
    chunk?.noteFilename || '',
    chunk?.chunkId || '',
    chunk?.content || '',
  ].join('\u0000'));
}

function sameSet(left, right) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every(item => rightSet.has(item));
}

function classifyVisibleRetrieval(hardGated, globalSoftPrior) {
  const hardContext = String(hardGated?.context || '');
  const softContext = String(globalSoftPrior?.context || '');
  if (hardContext === softContext) return D0_CLASSIFICATIONS.SAME_VISIBLE_CONTEXT;
  if (Boolean(hardContext) !== Boolean(softContext)) {
    return D0_CLASSIFICATIONS.ACTIVATION_CHANGE;
  }
  const hardMembership = (hardGated?.chunks || []).map(visibleChunkKey);
  const softMembership = (globalSoftPrior?.chunks || []).map(visibleChunkKey);
  if (!sameSet(hardMembership, softMembership)) {
    return D0_CLASSIFICATIONS.MEMBERSHIP_CHANGE;
  }
  return D0_CLASSIFICATIONS.ORDER_ONLY_CHANGE;
}

async function buildD0Sensitivity(corpus, { includeReview = false } = {}) {
  if (!corpus || !Array.isArray(corpus.cases)) throw new TypeError('historical replay corpus가 필요합니다.');
  const breakdown = Object.fromEntries(
    Object.values(D0_CLASSIFICATIONS).map(name => [name, 0]),
  );
  const forwardedCases = [];
  const reviews = [];
  let approximateActiveNoteStateCount = 0;

  for (const testCase of corpus.cases.filter(item => item.comparable)) {
    const temporalChunks = (testCase.chunks || []).filter(chunk => (
      Number(chunk.createdAt) < testCase.createdAt
    ));
    if (testCase.activeNoteStateApproximate) approximateActiveNoteStateCount += 1;
    const activeNotes = testCase.activeNotes || [];
    const noteCandidates = testCase.noteCandidates || [];
    const gatedNotes = mergeShadowNoteCandidates(
      activeNotes,
      noteCandidates,
      testCase.queryEmbedding,
      DEFAULT_SHADOW_RETRIEVAL_LIMITS,
    );
    const gatedFilenames = new Set(gatedNotes.map(note => note.filename));
    const common = {
      query: testCase.query,
      queryEmbedding: testCase.queryEmbedding,
      activeNotes,
      limits: DEFAULT_SHADOW_RETRIEVAL_LIMITS,
    };
    const hardGated = {
      ...buildGlobalShadowRetrieval({
        ...common,
        noteCandidates: gatedNotes,
        chunks: temporalChunks.filter(chunk => gatedFilenames.has(chunk.noteFilename)),
      }),
      strategy: 'hard-gated',
    };
    const globalSoftPrior = buildGlobalShadowRetrieval({
      ...common,
      noteCandidates,
      chunks: temporalChunks,
    });
    const classification = classifyVisibleRetrieval(hardGated, globalSoftPrior);
    breakdown[classification] += 1;
    const sensitive = classification !== D0_CLASSIFICATIONS.SAME_VISIBLE_CONTEXT;
    const publicCase = {
      ...(testCase.traceId ? { traceId: testCase.traceId } : {}),
      querySha256: testCase.querySha256 || sha256(testCase.query),
      classification,
      hardContextSha256: sha256(hardGated.context || ''),
      globalContextSha256: sha256(globalSoftPrior.context || ''),
    };
    if (sensitive) forwardedCases.push(publicCase);
    if (includeReview) {
      reviews.push({
        ...publicCase,
        query: testCase.query,
        hardGated: {
          strategy: hardGated.strategy,
          chunks: hardGated.chunks.map(chunk => ({
            chunkId: chunk.chunkId,
            noteFilename: chunk.noteFilename,
          })),
          contextChars: hardGated.contextChars,
        },
        globalSoftPrior: {
          strategy: globalSoftPrior.strategy,
          chunks: globalSoftPrior.chunks.map(chunk => ({
            chunkId: chunk.chunkId,
            noteFilename: chunk.noteFilename,
          })),
          contextChars: globalSoftPrior.contextChars,
        },
      });
    }
  }

  const comparableQueries = corpus.cases.filter(item => item.comparable).length;
  const deltaRCount = comparableQueries - breakdown.SAME_VISIBLE_CONTEXT;
  return {
    source: corpus.sourceDescription || 'A1b unique-query replay corpus',
    historicalSource: 'A1b unique-query replay corpus',
    sourceRuns: corpus.sourceRuns,
    sourceQueries: corpus.uniqueQueries,
    comparableQueries,
    missingEmbeddings: corpus.missingEmbeddings,
    generatedEmbeddings: {
      count: corpus.generatedEmbeddingCount || 0,
      model: corpus.embeddingModel || null,
      failures: corpus.embeddingFailures || 0,
      persistence: 'none (in-memory only; no DB/Vault persistence)',
    },
    activeNoteState: {
      recoverable: comparableQueries - approximateActiveNoteStateCount,
      approximateOrUnrecoverable: approximateActiveNoteStateCount,
      approximation: corpus.activeNoteApproximation
        || 'trace output의 explicit=true notes만 복원하고 그 밖의 active-note input은 빈 목록으로 둔다.',
    },
    armA: 'HARD-GATED: candidate note gate first, then chunks inside gated notes',
    armB: 'GLOBAL-SOFT-PRIOR: global ready temporal chunks with note relevance as soft prior',
    deltaR: {
      count: deltaRCount,
      rate: comparableQueries > 0 ? deltaRCount / comparableQueries : 0,
    },
    breakdown,
    forwardedToP0B: {
      count: forwardedCases.length,
      cases: forwardedCases,
    },
    pointInTimeCaveats: corpus.pointInTimeCaveats || [
      '두 arm 모두 chunk.created_at < historical trace.created_at인 ready topic chunks만 사용한다.',
      '현재 note embedding을 재사용하므로 query 이후 topic content가 note-ranking prior에 섞였을 수 있다.',
      '현재 corpus에 남아 있지 않은 과거 chunk나 이후 변경된 chunk content는 복원하지 못한다.',
      'historical active-note input은 trace에 완전 저장되지 않아 output의 explicit 표시만 근사 복원한다.',
    ],
    ...(includeReview ? { reviews } : {}),
  };
}

function buildCurrentInvocationSensitivity({
  eligibleRuns,
  resolutionCounts,
  replayedResolved,
  sensitiveResolved,
  approximateActiveNoteStateCount,
  threshold = P0_INFORMATIVE_CASE_THRESHOLD,
} = {}) {
  const total = Math.max(0, Number(eligibleRuns) || 0);
  const resolved = Math.max(0, Number(resolutionCounts?.RESOLVED) || 0);
  const ambiguous = Math.max(0, Number(resolutionCounts?.AMBIGUOUS) || 0);
  const missing = Math.max(0, Number(resolutionCounts?.MISSING) || 0);
  const replayed = Math.max(0, Number(replayedResolved) || 0);
  const sensitive = Math.max(0, Number(sensitiveResolved) || 0);
  const unreplayedResolved = Math.max(0, resolved - replayed);
  const unresolvedForSensitivity = ambiguous + missing + unreplayedResolved;
  const lower = Math.min(total, sensitive);
  const upper = Math.min(total, lower + unresolvedForSensitivity);
  const approximate = Math.min(
    total,
    Math.max(0, Number(approximateActiveNoteStateCount) || 0),
  );
  const pitLower = Math.max(0, lower - approximate);
  const pitUpper = Math.min(total, upper + approximate);

  let result;
  if (approximate > 0 && pitLower < threshold && pitUpper >= threshold) {
    result = CURRENT_GATE_RESULTS.INDETERMINATE_PIT;
  } else if (lower < threshold && upper >= threshold) {
    result = CURRENT_GATE_RESULTS.INDETERMINATE_RESOLUTION;
  } else if (pitUpper < threshold) {
    result = CURRENT_GATE_RESULTS.RED_PROVEN_NO_P0B;
  } else {
    result = CURRENT_GATE_RESULTS.P0B_STILL_POSSIBLE;
  }

  return {
    label: 'conditional ΔR under empty-activeNotes approximation',
    eligibleRuns: total,
    resolution: {
      resolved,
      ambiguous,
      missing,
      coverage: total > 0 ? resolved / total : 0,
    },
    conditionalDeltaR: {
      count: sensitive,
      rateAmongAllEligible: total > 0 ? sensitive / total : 0,
      rateAmongResolved: resolved > 0 ? sensitive / resolved : 0,
    },
    bounds: {
      lowerPossibleSensitiveCount: lower,
      upperPossibleSensitiveCount: upper,
      lowerDeltaR: total > 0 ? lower / total : 0,
      upperDeltaR: total > 0 ? upper / total : 0,
      pitLowerPossibleSensitiveCount: pitLower,
      pitUpperPossibleSensitiveCount: pitUpper,
      pitLowerDeltaR: total > 0 ? pitLower / total : 0,
      pitUpperDeltaR: total > 0 ? pitUpper / total : 0,
      unreplayedResolved,
    },
    activeNoteState: {
      exact: Math.max(0, replayed - approximate),
      approximateOrUnknown: approximate,
      approximation: 'historical activeNotes input이 관측되지 않은 invocation은 activeNotes=[]로 replay한다.',
    },
    gate: {
      threshold,
      result,
      p0bStarted: false,
    },
  };
}

function formatPercent(metric) {
  return `${round((Number(metric) || 0) * 100)}%`;
}

function formatMemoryP0Report(report) {
  const online = report.p01;
  const replay = report.p02;
  const context = online.contextChars;
  const lines = [
    'XION Memory R3-P0-A (Galpi persistent state is read-only)',
    `Baseline: ${report.baselineCommit}`,
    `P0.1 window: ${online.window.startKst} 00:00 KST <= trace < ${online.window.endExclusiveKst} 00:00 KST (${online.window.days} complete days)`,
    `Scope: ${online.scope} · modes ${online.includedModes.join(', ') || 'none'}`,
    `Eligible: ${online.eligibleRuns} · E/day ${online.eligiblePerDay}`,
    `Runtime generations: ${online.byRuntimeGeneration.map(item => `${item.runtimeGeneration} ${item.runs}`).join(', ') || 'none'}`,
    `Activation: ${online.activation.count} (${formatPercent(online.activation.rate)}) · abstention ${online.abstention.count} (${formatPercent(online.abstention.rate)})`,
    `Errors ${online.errors} · missing hashes ${online.missingQueryHashes} · invalid JSON ${online.invalidJsonRuns}`,
    `Context chars: avg ${context.average} · p50 ${context.p50} · p95 ${context.p95} · max ${context.maximum}`,
    `Saturation: ${online.saturation.count} (${formatPercent(online.saturation.rate)})`,
    `Coverage: ${online.traceCoverage.daysWithRuns}/${online.window.days} days with eligible runs`,
    '',
    `P0.2 source: ${replay.sourceRuns} runs · ${replay.sourceQueries} unique queries · ${replay.comparableQueries} comparable`,
    `Generated query embeddings: ${replay.generatedEmbeddings.count} · model ${replay.generatedEmbeddings.model || '-'} · failures ${replay.generatedEmbeddings.failures} · persistence none`,
    `D0 ΔR: ${replay.deltaR.count}/${replay.comparableQueries} (${formatPercent(replay.deltaR.rate)})`,
    `Breakdown: ACTIVATION_CHANGE ${replay.breakdown.ACTIVATION_CHANGE} · MEMBERSHIP_CHANGE ${replay.breakdown.MEMBERSHIP_CHANGE} · ORDER_ONLY_CHANGE ${replay.breakdown.ORDER_ONLY_CHANGE} · SAME_VISIBLE_CONTEXT ${replay.breakdown.SAME_VISIBLE_CONTEXT}`,
    `P0-B candidates: ${replay.forwardedToP0B.count} (generation not run)`,
    `Active-note state: recoverable ${replay.activeNoteState.recoverable} · approximate/unrecoverable ${replay.activeNoteState.approximateOrUnrecoverable}`,
    '',
    `Safety: DB write ${report.safety.productionDbWrite ? 'yes' : 'no'} · Vault write ${report.safety.vaultWrite ? 'yes' : 'no'} · schema change ${report.safety.schemaChange ? 'yes' : 'no'} · production behavior change ${report.safety.productionBehaviorChange ? 'yes' : 'no'}`,
    `SQLite: readonly ${report.safety.sqliteReadonly} · query_only ${report.safety.sqliteQueryOnly} · connection changes ${report.safety.connectionChanges}`,
    `External effect: ${report.safety.externalEffect}`,
    `P0-B answer generation: ${report.safety.answerGeneration ? 'yes' : 'no'}`,
    '',
    'PIT caveats:',
    ...replay.pointInTimeCaveats.map(item => `- ${item}`),
    '',
    'Trace coverage caveats:',
    ...online.traceCoverage.caveats.map(item => `- ${item}`),
  ];
  if (replay.forwardedToP0B.cases.length > 0) {
    lines.push('', 'P0-B candidate query hashes:');
    lines.push(...replay.forwardedToP0B.cases.map(item => (
      `- ${item.querySha256} · ${item.classification}`
    )));
  }
  for (const review of replay.reviews || []) {
    lines.push('', `질문: ${review.query}`);
    lines.push(`분류: ${review.classification}`);
    lines.push('HARD-GATED:');
    if (review.hardGated.chunks.length === 0) lines.push('- 선택 없음');
    else lines.push(...review.hardGated.chunks.map(chunk => (
      `- ${chunk.noteFilename} · ${chunk.chunkId}`
    )));
    lines.push('GLOBAL-SOFT-PRIOR:');
    if (review.globalSoftPrior.chunks.length === 0) lines.push('- 선택 없음');
    else lines.push(...review.globalSoftPrior.chunks.map(chunk => (
      `- ${chunk.noteFilename} · ${chunk.chunkId}`
    )));
  }
  return lines.join('\n');
}

module.exports = {
  CURRENT_GATE_RESULTS,
  D0_CLASSIFICATIONS,
  P0_WINDOW_DAYS,
  QUERY_RESOLUTION,
  REGULAR_API_CHAT_A2_MODE,
  buildD0Sensitivity,
  buildCurrentInvocationSensitivity,
  buildOnlineEligibleVolume,
  classifyVisibleRetrieval,
  formatMemoryP0Report,
  mostRecentCompleteKstWindow,
  parseActiveNotesTelemetry,
  parseRegularApiChatA2Mode,
  resolveCurrentInvocationQueries,
};
