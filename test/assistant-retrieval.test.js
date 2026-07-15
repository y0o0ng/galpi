'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildShadowRetrieval,
  buildChunkContext,
  cosineSimilarity,
  extractQueryTerms,
  rankChunkCandidates,
  rankNoteCandidates,
} = require('../lib/assistant-retrieval');
const { createAssistantRetrievalShadow } = require('../lib/assistant-retrieval-shadow');
const {
  buildLegacyNoteEvidence,
  createLegacyBaselineRetriever,
  createShadowRetriever,
  evaluateCase,
  evaluateRetrievalFixture,
  extractVisibleQaIds,
  formatEvaluationReport,
} = require('../lib/assistant-retrieval-eval');
const fixture = require('../fixtures/assistant-retrieval-eval');

test('query terms preserve Korean meaning words and remove search commands', () => {
  assert.deepEqual(
    extractQueryTerms('저번에 꾸었던 꿈 노트 꺼내줘'),
    ['꾸었던', '꿈']
  );
  assert.deepEqual(extractQueryTerms('???'), []);
});

test('note ranker keeps the existing keyword and embedding scoring behavior', () => {
  const ranked = rankNoteCandidates({
    query: '논문 파서',
    queryEmbedding: [1, 0],
    notes: [
      {
        filename: 'paper.md',
        title: '논문 검색',
        body: 'PDF 파서와 청크',
        tags: '논문 파서',
        embedding: [1, 0],
      },
      {
        filename: 'novel.md',
        title: '소설',
        body: '장면 구성',
        tags: '창작',
        embedding: [0, 1],
      },
    ],
    limit: 3,
  });

  assert.deepEqual(ranked.map(note => note.filename), ['paper.md']);
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 0], [Number.NaN, 0]), 0);
});

test('chunk ranker combines keyword and embedding relevance and rejects weak evidence', () => {
  const ranked = rankChunkCandidates({
    query: '현재 논문 PDF 파서 방향',
    queryEmbedding: [1, 0],
    chunks: [
      {
        chunkId: 'paper-current',
        noteFilename: 'paper.md',
        noteTitle: '논문 검색',
        content: '현재 PDF 파서를 유지한다.',
        embedding: [1, 0],
      },
      {
        chunkId: 'unrelated',
        noteFilename: 'travel.md',
        noteTitle: '여행',
        content: '부산 열차 일정',
        embedding: [0, 1],
      },
      null,
      {
        chunkId: 'malformed-vector',
        noteFilename: 'broken.md',
        content: '잘못된 임베딩',
        embedding: [Number.NaN, 0],
      },
    ],
  });

  assert.deepEqual(ranked.map(chunk => chunk.chunkId), ['paper-current']);
});

test('chunk ranker limits one note from monopolizing the result', () => {
  const ranked = rankChunkCandidates({
    query: '배포 백업',
    chunks: [
      { chunkId: 'a1', noteFilename: 'a.md', content: '배포 백업 경로' },
      { chunkId: 'a2', noteFilename: 'a.md', content: '배포 백업 주기' },
      { chunkId: 'a3', noteFilename: 'a.md', content: '배포 백업 복구' },
      { chunkId: 'b1', noteFilename: 'b.md', content: '배포 백업 검증' },
    ],
    limit: 4,
    maxChunksPerNote: 2,
  });

  assert.equal(ranked.filter(chunk => chunk.noteFilename === 'a.md').length, 2);
  assert.ok(ranked.some(chunk => chunk.chunkId === 'b1'));
});

test('chunk context enforces per-chunk and total character limits', () => {
  const result = buildChunkContext([
    { chunkId: 'qa-1', noteFilename: 'topic.md', content: 'a'.repeat(2000), score: 1 },
    { chunkId: 'qa-2', noteFilename: 'topic.md', content: 'b'.repeat(2000), score: 0.9 },
    { chunkId: 'qa-3', noteFilename: 'topic.md', content: 'c'.repeat(2000), score: 0.8 },
  ], {
    maxChunks: 3,
    maxCharsPerChunk: 100,
    maxContextChars: 260,
  });

  assert.ok(result.contextChars <= 260);
  assert.equal(result.contextChars, result.context.length);
  assert.ok(result.chunks.length <= 3);
  assert.ok(result.chunks.every(chunk => chunk.content.length <= 100));
  assert.match(result.context, /chunk_id="qa-1"/);
});

test('shadow retrieval keeps only chunks inside the selected notes', () => {
  const result = buildShadowRetrieval({
    query: '배포 경로',
    noteCandidates: [{ filename: 'deploy.md', title: '배포', score: 1 }],
    chunks: [
      { chunkId: 'deploy-path', noteFilename: 'deploy.md', content: '배포 경로는 /srv/app이다.' },
      { chunkId: 'other-path', noteFilename: 'other.md', content: '배포 경로는 /tmp/app이다.' },
    ],
  });

  assert.deepEqual(result.notes.map(note => note.filename), ['deploy.md']);
  assert.deepEqual(result.chunks.map(chunk => chunk.chunkId), ['deploy-path']);
});

test('shadow service records identifiers without content and isolates trace failures', () => {
  const inserted = [];
  let recordError = null;
  const service = createAssistantRetrievalShadow({
    getChunksByNote: filename => [{
      chunkId: 'qa-secret',
      noteFilename: filename,
      noteTitle: '배포',
      content: '민감한 노트 본문',
      embedding: JSON.stringify([1, 0]),
    }],
    insertRun: values => inserted.push(values),
    onRecordError: error => { recordError = error; },
  });
  const retrieval = service.retrieve({
    query: '배포 노트',
    queryEmbedding: [1, 0],
    rankedCandidates: [{ filename: 'deploy.md', title: '배포', score: 0.9 }],
  });

  assert.equal(service.record({
    sessionId: 'session-1',
    mode: 'chat',
    retrieval,
    latencyMs: 1.6,
  }), true);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].latencyMs, 2);
  assert.doesNotMatch(inserted[0].chunksJson, /민감한|배포 노트/);

  const failingService = createAssistantRetrievalShadow({
    getChunksByNote: () => [],
    insertRun: () => { throw new Error('db unavailable'); },
    onRecordError: error => { recordError = error; },
  });
  assert.equal(failingService.record({ mode: 'chat' }), false);
  assert.equal(recordError.message, 'db unavailable');
});

test('legacy evidence exposes only QA markers visible before the note limit', () => {
  const content = [
    '<!-- qa_id: qa-visible -->',
    'visible answer',
    'x'.repeat(80),
    '<!-- qa_id: qa-hidden -->',
    'hidden answer',
  ].join('\n');
  const evidence = buildLegacyNoteEvidence([
    { filename: 'topic.md', title: 'Topic', content },
  ], 70);

  assert.deepEqual(extractVisibleQaIds(evidence.context), ['qa-visible']);
  assert.deepEqual(evidence.chunks.map(chunk => chunk.chunkId), ['qa-visible']);
  assert.match(evidence.context, /\.\.\.\(이하 생략\)/);
});

test('evaluation treats abstention as a strict no-evidence case', () => {
  const result = evaluateCase({
    id: 'unknown',
    category: 'abstention',
    query: '모르는 질문',
    requiredNoteFilenames: [],
    requiredChunkIds: [],
    expectNoEvidence: true,
  }, {
    notes: [{ filename: 'unrelated.md' }],
    chunks: [],
    contextChars: 100,
  });

  assert.equal(result.noteHit, false);
  assert.equal(result.chunkHit, true);
  assert.deepEqual(result.irrelevantNotes, ['unrelated.md']);
});

test('synthetic A0 fixture fixes the legacy note baseline', async () => {
  const noteMap = new Map(fixture.notes.map(note => [note.filename, note]));
  const retrieve = createLegacyBaselineRetriever({
    searchNotes: async testCase => rankNoteCandidates({
      query: testCase.query,
      queryEmbedding: testCase.queryEmbedding,
      notes: fixture.notes,
      limit: 8,
    }),
    readNote: async filename => noteMap.get(filename),
  });
  const summary = await evaluateRetrievalFixture(fixture, retrieve);

  assert.equal(summary.totalCases, 20);
  assert.deepEqual(
    Object.fromEntries(Object.entries(summary.categories).map(([name, value]) => [name, value.total])),
    { single: 5, multi_session: 4, update: 4, time: 3, abstention: 4 }
  );
  assert.equal(summary.noteRecallAt3.hits, 20);
  assert.equal(summary.chunkRecallAt6.hits, 11);
  assert.equal(summary.abstention.hits, 4);
  assert.equal(summary.contextWithinLimit.hits, 17);
  assert.equal(summary.contextChars.maximum, 10425);
  assert.equal(summary.errors, 0);
  assert.match(formatEvaluationReport(summary), /Chunk Recall@6: 11\/20 \(55\.0%\)/);
});

test('synthetic A1 shadow retrieval meets the initial evidence targets', async () => {
  const retrieve = createShadowRetriever({
    searchNotes: async testCase => rankNoteCandidates({
      query: testCase.query,
      queryEmbedding: testCase.queryEmbedding,
      notes: fixture.notes,
      limit: 3,
      minEmbeddingScore: 0.18,
    }),
    readChunks: async selectedNotes => selectedNotes.flatMap(candidate => {
      const note = fixture.notes.find(item => item.filename === candidate.filename);
      return (note?.chunks || []).map(chunk => ({
        ...chunk,
        noteFilename: note.filename,
        noteTitle: note.title,
        embedding: note.embedding,
      }));
    }),
  });
  const summary = await evaluateRetrievalFixture(fixture, retrieve);

  assert.equal(summary.noteRecallAt3.hits, 20);
  assert.ok(summary.chunkRecallAt6.hits >= 18);
  assert.equal(summary.abstention.hits, 4);
  assert.equal(summary.contextWithinLimit.hits, 20);
});
