'use strict';

const { performance } = require('node:perf_hooks');

const DEFAULT_NOTE_RECALL_K = 3;
const DEFAULT_CHUNK_RECALL_K = 6;
const DEFAULT_CONTEXT_LIMIT = 8000;
const DEFAULT_MAX_ACTIVE_NOTES = 8;
const DEFAULT_MAX_NOTE_CHARS = 5000;

function uniqueStrings(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map(value => String(value || '').trim())
      .filter(Boolean)
  )];
}

function extractVisibleQaIds(content) {
  const ids = [];
  const pattern = /<!--\s*qa_id:\s*([^>]+?)\s*-->/g;
  let match;
  while ((match = pattern.exec(String(content || ''))) !== null) {
    const id = match[1].trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function buildLegacyNoteEvidence(notes, maxNoteChars = DEFAULT_MAX_NOTE_CHARS) {
  const boundedNotes = [];
  const chunks = [];
  const blocks = [];

  for (const note of notes) {
    if (!note?.filename) continue;
    const content = String(note.content || note.body || '');
    const visibleContent = content.length > maxNoteChars
      ? `${content.slice(0, maxNoteChars)}\n...(이하 생략)`
      : content;
    boundedNotes.push({ filename: note.filename, title: note.title || note.filename });
    blocks.push(
      `<note title="${String(note.title || '').replace(/"/g, "'")}">\n${visibleContent}\n</note>`
    );
    for (const chunkId of extractVisibleQaIds(visibleContent)) {
      chunks.push({ chunkId, noteFilename: note.filename });
    }
  }

  const context = blocks.join('\n\n---\n\n');
  return {
    notes: boundedNotes,
    chunks,
    context,
    contextChars: context.length,
  };
}

function createLegacyBaselineRetriever({
  searchNotes,
  readNote,
  maxActiveNotes = DEFAULT_MAX_ACTIVE_NOTES,
  maxNoteChars = DEFAULT_MAX_NOTE_CHARS,
} = {}) {
  if (typeof searchNotes !== 'function') throw new TypeError('노트 검색 함수가 필요합니다.');
  if (typeof readNote !== 'function') throw new TypeError('노트 조회 함수가 필요합니다.');

  return async function retrieveLegacyEvidence(testCase) {
    const candidates = await searchNotes(testCase);
    const selected = (Array.isArray(candidates) ? candidates : []).slice(0, maxActiveNotes);
    const resolved = await Promise.all(selected.map(async candidate => {
      const filename = typeof candidate === 'string' ? candidate : candidate?.filename;
      if (!filename) return null;
      const note = await readNote(filename);
      if (!note) return null;
      return {
        filename,
        title: note.title || candidate?.title || filename,
        content: note.content || note.body || '',
      };
    }));
    return buildLegacyNoteEvidence(resolved.filter(Boolean), maxNoteChars);
  };
}

function caseMetric(hit, total = 1) {
  return { hits: hit ? 1 : 0, total, rate: hit ? 1 : 0 };
}

function mergeMetric(target, source) {
  target.hits += source.hits;
  target.total += source.total;
  target.rate = target.total > 0 ? target.hits / target.total : 0;
}

function evaluateCase(testCase, retrieval, options = {}) {
  const noteRecallK = options.noteRecallK || DEFAULT_NOTE_RECALL_K;
  const chunkRecallK = options.chunkRecallK || DEFAULT_CHUNK_RECALL_K;
  const contextLimit = options.contextLimit || DEFAULT_CONTEXT_LIMIT;
  const expectedNotes = uniqueStrings(testCase.requiredNoteFilenames);
  const expectedChunks = uniqueStrings(testCase.requiredChunkIds);
  const relevantNotes = new Set(uniqueStrings(
    testCase.relevantNoteFilenames?.length
      ? testCase.relevantNoteFilenames
      : expectedNotes
  ));
  const relevantChunks = new Set(uniqueStrings(
    testCase.relevantChunkIds?.length
      ? testCase.relevantChunkIds
      : expectedChunks
  ));
  const returnedNotes = uniqueStrings((retrieval.notes || []).map(note => (
    typeof note === 'string' ? note : note?.filename
  )));
  const returnedChunks = uniqueStrings((retrieval.chunks || []).map(chunk => (
    typeof chunk === 'string' ? chunk : chunk?.chunkId
  )));
  const topNotes = returnedNotes.slice(0, noteRecallK);
  const topChunks = returnedChunks.slice(0, chunkRecallK);
  const expectNoEvidence = testCase.expectNoEvidence === true;
  const noteHit = expectNoEvidence
    ? topNotes.length === 0
    : expectedNotes.length > 0 && expectedNotes.every(filename => topNotes.includes(filename));
  const chunkHit = expectNoEvidence
    ? topChunks.length === 0
    : expectedChunks.length > 0 && expectedChunks.every(chunkId => topChunks.includes(chunkId));
  const irrelevantNotes = topNotes.filter(filename => !relevantNotes.has(filename));
  const irrelevantChunks = topChunks.filter(chunkId => !relevantChunks.has(chunkId));
  const contextChars = Math.max(0, Number(retrieval.contextChars) || 0);

  return {
    id: testCase.id,
    category: testCase.category,
    query: testCase.query,
    noteHit,
    chunkHit,
    returnedNotes: topNotes,
    returnedChunks: topChunks,
    missingNotes: expectedNotes.filter(filename => !topNotes.includes(filename)),
    missingChunks: expectedChunks.filter(chunkId => !topChunks.includes(chunkId)),
    irrelevantNotes,
    irrelevantChunks,
    contextChars,
    contextWithinLimit: contextChars <= contextLimit,
    latencyMs: retrieval.latencyMs || 0,
    error: retrieval.error || null,
  };
}

function emptySummary(name, totalCases) {
  return {
    name,
    totalCases,
    noteRecallAt3: { hits: 0, total: 0, rate: 0 },
    chunkRecallAt6: { hits: 0, total: 0, rate: 0 },
    contextWithinLimit: { hits: 0, total: 0, rate: 0 },
    abstention: { hits: 0, total: 0, rate: 0 },
    irrelevantNotesAt3: { count: 0, returned: 0, rate: 0 },
    irrelevantChunksAt6: { count: 0, returned: 0, rate: 0 },
    contextChars: { average: 0, maximum: 0 },
    latencyMs: { average: 0, maximum: 0 },
    errors: 0,
    categories: {},
    failures: [],
    cases: [],
  };
}

async function evaluateRetrievalFixture(fixture, retrieveCase, options = {}) {
  if (!fixture || !Array.isArray(fixture.cases)) throw new TypeError('평가 cases 배열이 필요합니다.');
  if (typeof retrieveCase !== 'function') throw new TypeError('평가할 회수 함수가 필요합니다.');

  const summary = emptySummary(fixture.name || 'assistant-retrieval', fixture.cases.length);
  let totalContextChars = 0;
  let totalLatencyMs = 0;

  for (const testCase of fixture.cases) {
    const startedAt = performance.now();
    let retrieval;
    try {
      retrieval = await retrieveCase(testCase);
    } catch (error) {
      retrieval = { notes: [], chunks: [], contextChars: 0, error: error.message };
    }
    retrieval.latencyMs = performance.now() - startedAt;
    const result = evaluateCase(testCase, retrieval, options);
    summary.cases.push(result);
    mergeMetric(summary.noteRecallAt3, caseMetric(result.noteHit));
    mergeMetric(summary.chunkRecallAt6, caseMetric(result.chunkHit));
    mergeMetric(summary.contextWithinLimit, caseMetric(result.contextWithinLimit));

    if (testCase.expectNoEvidence === true) {
      const abstained = result.returnedNotes.length === 0 && result.returnedChunks.length === 0;
      mergeMetric(summary.abstention, caseMetric(abstained));
    }

    summary.irrelevantNotesAt3.count += result.irrelevantNotes.length;
    summary.irrelevantNotesAt3.returned += result.returnedNotes.length;
    summary.irrelevantChunksAt6.count += result.irrelevantChunks.length;
    summary.irrelevantChunksAt6.returned += result.returnedChunks.length;
    totalContextChars += result.contextChars;
    totalLatencyMs += result.latencyMs;
    summary.contextChars.maximum = Math.max(summary.contextChars.maximum, result.contextChars);
    summary.latencyMs.maximum = Math.max(summary.latencyMs.maximum, result.latencyMs);
    if (result.error) summary.errors += 1;

    const category = result.category || 'uncategorized';
    if (!summary.categories[category]) {
      summary.categories[category] = {
        total: 0,
        noteHits: 0,
        chunkHits: 0,
      };
    }
    summary.categories[category].total += 1;
    summary.categories[category].noteHits += result.noteHit ? 1 : 0;
    summary.categories[category].chunkHits += result.chunkHit ? 1 : 0;

    if (!result.noteHit || !result.chunkHit || !result.contextWithinLimit || result.error) {
      summary.failures.push({
        id: result.id,
        noteHit: result.noteHit,
        chunkHit: result.chunkHit,
        contextWithinLimit: result.contextWithinLimit,
        missingNotes: result.missingNotes,
        missingChunks: result.missingChunks,
        error: result.error,
      });
    }
  }

  summary.irrelevantNotesAt3.rate = summary.irrelevantNotesAt3.returned > 0
    ? summary.irrelevantNotesAt3.count / summary.irrelevantNotesAt3.returned
    : 0;
  summary.irrelevantChunksAt6.rate = summary.irrelevantChunksAt6.returned > 0
    ? summary.irrelevantChunksAt6.count / summary.irrelevantChunksAt6.returned
    : 0;
  summary.contextChars.average = summary.totalCases > 0
    ? Math.round(totalContextChars / summary.totalCases)
    : 0;
  summary.latencyMs.average = summary.totalCases > 0
    ? totalLatencyMs / summary.totalCases
    : 0;
  return summary;
}

function percent(metric) {
  return `${(metric.rate * 100).toFixed(1)}%`;
}

function formatEvaluationReport(summary) {
  const lines = [
    `Assistant retrieval baseline: ${summary.name}`,
    `Cases: ${summary.totalCases}`,
    `Note Recall@3: ${summary.noteRecallAt3.hits}/${summary.noteRecallAt3.total} (${percent(summary.noteRecallAt3)})`,
    `Chunk Recall@6: ${summary.chunkRecallAt6.hits}/${summary.chunkRecallAt6.total} (${percent(summary.chunkRecallAt6)})`,
    `Abstention: ${summary.abstention.hits}/${summary.abstention.total} (${percent(summary.abstention)})`,
    `Context <= 8,000 chars: ${summary.contextWithinLimit.hits}/${summary.contextWithinLimit.total} (${percent(summary.contextWithinLimit)})`,
    `Context chars: avg ${summary.contextChars.average}, max ${summary.contextChars.maximum}`,
    `Irrelevant notes@3: ${summary.irrelevantNotesAt3.count}/${summary.irrelevantNotesAt3.returned} (${percent(summary.irrelevantNotesAt3)})`,
    `Irrelevant chunks@6: ${summary.irrelevantChunksAt6.count}/${summary.irrelevantChunksAt6.returned} (${percent(summary.irrelevantChunksAt6)})`,
    `Latency: avg ${summary.latencyMs.average.toFixed(2)}ms, max ${summary.latencyMs.maximum.toFixed(2)}ms`,
    `Errors: ${summary.errors}`,
  ];

  if (summary.failures.length > 0) {
    lines.push('', 'Failures:');
    for (const failure of summary.failures) {
      const reasons = [];
      if (!failure.noteHit) reasons.push(`note [${failure.missingNotes.join(', ') || 'unexpected evidence'}]`);
      if (!failure.chunkHit) reasons.push(`chunk [${failure.missingChunks.join(', ') || 'unexpected evidence'}]`);
      if (!failure.contextWithinLimit) reasons.push('context limit');
      if (failure.error) reasons.push(`error: ${failure.error}`);
      lines.push(`- ${failure.id}: ${reasons.join('; ')}`);
    }
  }
  return lines.join('\n');
}

module.exports = {
  DEFAULT_CHUNK_RECALL_K,
  DEFAULT_CONTEXT_LIMIT,
  DEFAULT_MAX_ACTIVE_NOTES,
  DEFAULT_MAX_NOTE_CHARS,
  DEFAULT_NOTE_RECALL_K,
  buildLegacyNoteEvidence,
  createLegacyBaselineRetriever,
  evaluateCase,
  evaluateRetrievalFixture,
  extractVisibleQaIds,
  formatEvaluationReport,
};
