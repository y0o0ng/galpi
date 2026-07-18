'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildGlobalShadowRetrieval,
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
  createGlobalShadowRetriever,
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
  assert.deepEqual(extractQueryTerms('고양이 경로'), ['고양이', '경로']);
  assert.deepEqual(
    extractQueryTerms('내가 쓴 시 자료 좀 찾아줘 꿈 핏 키'),
    ['시', '꿈', '핏', '키']
  );
});

test('one-syllable Korean terms do not match inside unrelated compounds', () => {
  const ranked = rankChunkCandidates({
    query: '살을',
    chunks: [
      {
        chunkId: 'literal-weight-loss',
        noteFilename: 'health.md',
        content: '살을 빼려면 식단과 운동을 함께 조절한다.',
      },
      {
        chunkId: 'unrelated-story',
        noteFilename: 'story.md',
        content: '자살을 소재로 삼은 소설과 살인 장면을 검토했다.',
      },
    ],
    includeParticleVariants: true,
    minKeywordScore: 1,
  });

  assert.deepEqual(ranked.map(chunk => chunk.chunkId), ['literal-weight-loss']);
});

test('one-syllable Korean terms keep particle and plural matches', () => {
  const ranked = rankChunkCandidates({
    query: '시 자료 좀 찾아줘',
    chunks: [
      {
        chunkId: 'poetry',
        noteFilename: 'poetry.md',
        content: '내 시와 오래된 시들을 다시 읽었다.',
      },
      {
        chunkId: 'unrelated-compounds',
        noteFilename: 'perfume.md',
        content: '시향 기록과 시스템 점검 내용을 정리했다.',
      },
    ],
    includeParticleVariants: true,
    minKeywordScore: 1,
  });

  assert.deepEqual(ranked.map(chunk => chunk.chunkId), ['poetry']);
});

test('one-syllable Korean terms keep weaker matches at compound starts', () => {
  const ranked = rankChunkCandidates({
    query: '꿈',
    chunks: [
      {
        chunkId: 'exact-dream',
        noteFilename: 'dream.md',
        content: '꿈은 다른 세계의 나라는 설정이다.',
      },
      {
        chunkId: 'dream-compound',
        noteFilename: 'story.md',
        content: '꿈속 장면에서 주인공이 깨어난다.',
      },
      {
        chunkId: 'embedded-dream',
        noteFilename: 'unrelated.md',
        content: '태몽꿈이라는 임의의 합성어다.',
      },
    ],
    minKeywordScore: 0.2,
  });

  assert.deepEqual(
    ranked.map(chunk => chunk.chunkId),
    ['exact-dream', 'dream-compound']
  );
  assert.ok(ranked[0].keywordScore > ranked[1].keywordScore);
});

test('rankers match conservative Korean particle variants', () => {
  const ranked = rankChunkCandidates({
    query: '숙면대행서비스의 결말을 구성을',
    chunks: [{
      chunkId: 'sleep-story',
      noteFilename: 'story.md',
      content: '숙면대행서비스 최초 결말과 기승전결 구성',
    }],
    includeParticleVariants: true,
    minKeywordScore: 3,
  });

  assert.deepEqual(ranked.map(chunk => chunk.chunkId), ['sleep-story']);
});

test('global chunk ranking prefers a matching stored question over repeated answer terms', () => {
  const ranked = rankChunkCandidates({
    query: '숙면대행서비스 결말',
    chunks: [
      {
        chunkId: 'matching-question',
        noteFilename: 'story.md',
        content: 'Q: 숙면대행서비스 결말\nA: 아직 마지막 문장은 정하지 않았다.',
      },
      {
        chunkId: 'repeated-answer',
        noteFilename: 'other.md',
        content: [
          'Q: 다른 아이디어',
          'A: 숙면대행서비스 결말 숙면대행서비스 결말 숙면대행서비스 결말',
        ].join('\n'),
      },
    ],
    questionKeywordWeight: 4,
    maxAnswerTermOccurrences: 3,
    minKeywordScore: 1,
  });

  assert.equal(ranked[0].chunkId, 'matching-question');
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

test('chunk ranker excludes source_missing evidence while accepting legacy rows', () => {
  const ranked = rankChunkCandidates({
    query: '배포 경로',
    chunks: [
      {
        chunkId: 'missing',
        noteFilename: 'deploy.md',
        content: '배포 경로는 /missing 이다.',
        indexStatus: 'source_missing',
      },
      {
        chunkId: 'ready',
        noteFilename: 'deploy.md',
        content: '배포 경로는 /ready 이다.',
        indexStatus: 'ready',
      },
      {
        chunkId: 'legacy',
        noteFilename: 'legacy.md',
        content: '배포 경로는 /legacy 이다.',
      },
    ],
  });

  assert.deepEqual(ranked.map(chunk => chunk.chunkId).sort(), ['legacy', 'ready']);
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

test('global shadow retrieval recovers a strong chunk outside the note shortlist', () => {
  const result = buildGlobalShadowRetrieval({
    query: '현재 배포 경로',
    queryEmbedding: [1, 0],
    noteCandidates: [{
      filename: 'shortlisted.md',
      title: '후보 노트',
      score: 0.8,
      keywordScore: 1,
    }],
    chunks: [
      {
        chunkId: 'weak-shortlist',
        noteFilename: 'shortlisted.md',
        noteTitle: '후보 노트',
        content: '과거 일정 기록',
        embedding: [0, 1],
      },
      {
        chunkId: 'global-answer',
        noteFilename: 'outside.md',
        noteTitle: '운영 정보',
        content: '현재 배포 경로는 /srv/app이다.',
        embedding: [1, 0],
      },
    ],
  });

  assert.equal(result.strategy, 'global-soft-prior');
  assert.deepEqual(result.notes.map(note => note.filename), ['outside.md']);
  assert.deepEqual(result.chunks.map(chunk => chunk.chunkId), ['global-answer']);
});

test('global shadow uses note scores as a soft prior without reviving weak chunks', () => {
  const result = buildGlobalShadowRetrieval({
    query: '배포',
    queryEmbedding: [1, 0],
    noteCandidates: [{
      filename: 'prior.md',
      title: '배포 노트',
      score: 0.9,
      keywordScore: 2,
    }],
    chunks: [
      {
        chunkId: 'prior-close',
        noteFilename: 'prior.md',
        noteTitle: '배포 노트',
        content: '배포 절차',
        embedding: [0.82, 0.5723635208501674],
      },
      {
        chunkId: 'global-close',
        noteFilename: 'global.md',
        noteTitle: '운영 노트',
        content: '배포 절차',
        embedding: [0.84, 0.5425863986500215],
      },
      {
        chunkId: 'weak-prior',
        noteFilename: 'prior.md',
        noteTitle: '배포 노트',
        content: '관련 없는 본문',
        embedding: [0.1, 0.99498743710662],
      },
    ],
  });

  assert.equal(result.chunks[0].chunkId, 'prior-close');
  assert.ok(result.chunks.some(chunk => chunk.chunkId === 'global-close'));
  assert.ok(!result.chunks.some(chunk => chunk.chunkId === 'weak-prior'));
});

test('global shadow abstains from medium semantic collisions without lexical evidence', () => {
  const result = buildGlobalShadowRetrieval({
    query: '고양이 종합백신 예약일',
    queryEmbedding: [1, 0],
    noteCandidates: [{ filename: 'other.md', title: '기타', score: 0.45 }],
    chunks: [{
      chunkId: 'semantic-collision',
      noteFilename: 'other.md',
      noteTitle: '기타',
      content: '완전히 다른 개인 일정',
      embedding: [0.75, 0.6614378277661477],
    }],
  });

  assert.deepEqual(result.notes, []);
  assert.deepEqual(result.chunks, []);
  assert.equal(result.contextChars, 0);
});

test('global shadow expands one note only for explicit multi-evidence queries', () => {
  const chunks = Array.from({ length: 6 }, (_, index) => ({
    chunkId: `qa-${index + 1}`,
    noteFilename: 'topic.md',
    noteTitle: '배포 기록',
    content: `배포 근거 ${index + 1}`,
    embedding: [1, 0],
  }));
  const input = {
    queryEmbedding: [1, 0],
    noteCandidates: [{
      filename: 'topic.md',
      title: '배포 기록',
      score: 0.9,
      keywordScore: 2,
    }],
    chunks,
  };

  const single = buildGlobalShadowRetrieval({ ...input, query: '배포 근거' });
  const multiple = buildGlobalShadowRetrieval({ ...input, query: '배포 근거를 같이 보여줘' });

  assert.equal(single.chunks.length, 3);
  assert.equal(multiple.chunks.length, 5);
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

test('shadow service accepts an async global candidate provider', async () => {
  let request = null;
  const service = createAssistantRetrievalShadow({
    getChunksByNote: () => [],
    getGlobalChunkCandidates: async input => {
      request = input;
      return [{
        chunkId: 'qa-global',
        noteFilename: 'global.md',
        noteTitle: '전역 노트',
        content: '현재 배포 경로',
        embedding: JSON.stringify([1, 0]),
      }];
    },
    insertRun: () => {},
  });
  const retrieval = await service.retrieveGlobal({
    query: '현재 배포 경로',
    queryEmbedding: [1, 0],
  });

  assert.equal(request.query, '현재 배포 경로');
  assert.equal(retrieval.strategy, 'global-soft-prior');
  assert.deepEqual(retrieval.chunks.map(chunk => chunk.chunkId), ['qa-global']);
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
  assert.equal(summary.contextWithinLimit.hits, 18);
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

test('synthetic A1b global shadow preserves recall and strict abstention', async () => {
  const retrieve = createGlobalShadowRetriever({
    searchNotes: async testCase => rankNoteCandidates({
      query: testCase.query,
      queryEmbedding: testCase.queryEmbedding,
      notes: fixture.notes,
      limit: 8,
      minEmbeddingScore: 0.08,
    }),
    readGlobalChunks: async () => fixture.notes.flatMap(note => note.chunks.map(chunk => ({
      ...chunk,
      noteFilename: note.filename,
      noteTitle: note.title,
      embedding: note.embedding,
    }))),
  });
  const summary = await evaluateRetrievalFixture(fixture, retrieve);

  assert.equal(summary.noteRecallAt3.hits, 20);
  assert.equal(summary.chunkRecallAt6.hits, 20);
  assert.equal(summary.abstention.hits, 4);
  assert.equal(summary.contextWithinLimit.hits, 20);
});
