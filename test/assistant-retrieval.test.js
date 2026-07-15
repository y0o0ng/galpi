'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cosineSimilarity,
  extractQueryTerms,
  rankNoteCandidates,
} = require('../lib/assistant-retrieval');
const {
  buildLegacyNoteEvidence,
  createLegacyBaselineRetriever,
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
