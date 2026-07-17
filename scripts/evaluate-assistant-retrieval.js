#!/usr/bin/env node
'use strict';

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const {
  createGlobalShadowRetriever,
  createLegacyBaselineRetriever,
  createShadowRetriever,
  evaluateRetrievalFixture,
  formatEvaluationReport,
} = require('../lib/assistant-retrieval-eval');
const {
  DEFAULT_SHADOW_RETRIEVAL_LIMITS,
  rankNoteCandidates,
} = require('../lib/assistant-retrieval');

function parseArguments(argv) {
  const options = { fixture: null, baseUrl: null, mode: 'legacy', json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      options.json = true;
    } else if (argument === '--fixture') {
      options.fixture = argv[index + 1];
      index += 1;
    } else if (argument === '--base-url') {
      options.baseUrl = argv[index + 1];
      index += 1;
    } else if (argument === '--mode') {
      options.mode = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`알 수 없는 인자입니다: ${argument}`);
    }
  }
  if (!['legacy', 'shadow', 'shadow-global'].includes(options.mode)) {
    throw new Error('--mode는 legacy, shadow 또는 shadow-global이어야 합니다.');
  }
  return options;
}

function loadFixture(fixturePath) {
  const resolved = path.resolve(
    fixturePath || path.join(__dirname, '..', 'fixtures', 'assistant-retrieval-eval.js')
  );
  if (!fs.existsSync(resolved)) throw new Error(`평가 fixture를 찾을 수 없습니다: ${resolved}`);
  if (path.extname(resolved).toLowerCase() === '.json') {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  }
  delete require.cache[require.resolve(resolved)];
  return require(resolved);
}

function createSyntheticRetriever(fixture) {
  if (!Array.isArray(fixture.notes)) {
    throw new Error('합성 평가 fixture에 notes 배열이 필요합니다.');
  }
  const noteMap = new Map(fixture.notes.map(note => [note.filename, note]));
  return createLegacyBaselineRetriever({
    searchNotes: async testCase => rankNoteCandidates({
      query: testCase.query,
      queryEmbedding: testCase.queryEmbedding,
      notes: fixture.notes,
      limit: 8,
    }),
    readNote: async filename => noteMap.get(filename) || null,
  });
}

function createSyntheticShadowRetriever(fixture) {
  if (!Array.isArray(fixture.notes)) {
    throw new Error('합성 평가 fixture에 notes 배열이 필요합니다.');
  }
  return createShadowRetriever({
    searchNotes: async testCase => rankNoteCandidates({
      query: testCase.query,
      queryEmbedding: testCase.queryEmbedding,
      notes: fixture.notes,
      limit: DEFAULT_SHADOW_RETRIEVAL_LIMITS.maxNotes,
      minEmbeddingScore: DEFAULT_SHADOW_RETRIEVAL_LIMITS.minEmbeddingScore,
      minKeywordScore: DEFAULT_SHADOW_RETRIEVAL_LIMITS.minKeywordScore,
    }),
    readChunks: async selectedNotes => selectedNotes.flatMap(candidate => {
      const note = fixture.notes.find(item => item.filename === candidate.filename);
      if (!note) return [];
      return note.chunks.map(chunk => ({
        ...chunk,
        noteFilename: note.filename,
        noteTitle: note.title,
        chunkType: 'topic_qa',
        embedding: note.embedding,
      }));
    }),
  });
}

function createSyntheticGlobalShadowRetriever(fixture) {
  if (!Array.isArray(fixture.notes)) {
    throw new Error('합성 평가 fixture에 notes 배열이 필요합니다.');
  }
  return createGlobalShadowRetriever({
    searchNotes: async testCase => rankNoteCandidates({
      query: testCase.query,
      queryEmbedding: testCase.queryEmbedding,
      notes: fixture.notes,
      limit: 8,
      minEmbeddingScore: 0.08,
      minKeywordScore: 2,
    }),
    readGlobalChunks: async () => fixture.notes.flatMap(note => note.chunks.map(chunk => ({
      ...chunk,
      noteFilename: note.filename,
      noteTitle: note.title,
      chunkType: 'topic_qa',
      embedding: note.embedding,
    }))),
  });
}

function createLiveRetriever(baseUrl, apiToken) {
  const origin = String(baseUrl || '').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(origin)) throw new Error('--base-url은 HTTP(S) URL이어야 합니다.');
  const headers = apiToken ? { 'X-API-Token': apiToken } : {};

  async function requestJson(url) {
    const response = await fetch(url, { headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    return payload;
  }

  return createLegacyBaselineRetriever({
    searchNotes: async testCase => {
      const payload = await requestJson(
        `${origin}/api/vault/search?q=${encodeURIComponent(testCase.query)}`
      );
      return payload.results || [];
    },
    readNote: async filename => {
      const payload = await requestJson(
        `${origin}/api/vault/note/${encodeURIComponent(filename)}`
      );
      return payload.note || null;
    },
  });
}

function createLiveShadowRetriever(baseUrl, apiToken, strategy) {
  const origin = String(baseUrl || '').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(origin)) throw new Error('--base-url은 HTTP(S) URL이어야 합니다.');
  const headers = apiToken ? { 'X-API-Token': apiToken } : {};

  return async function retrieveLiveShadow(testCase) {
    const response = await fetch(
      `${origin}/api/vault/retrieval-shadow?q=${encodeURIComponent(testCase.query)}&strategy=${strategy}`,
      { headers }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload.retrieval || { notes: [], chunks: [], contextChars: 0 };
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.baseUrl && !options.fixture) {
    throw new Error('라이브 평가는 해당 볼트의 비공개 --fixture가 필요합니다.');
  }
  const fixture = loadFixture(options.fixture);
  let retrieve;
  if (options.mode === 'legacy') {
    retrieve = options.baseUrl
      ? createLiveRetriever(options.baseUrl, process.env.API_TOKEN || '')
      : createSyntheticRetriever(fixture);
  } else if (options.mode === 'shadow') {
    retrieve = options.baseUrl
      ? createLiveShadowRetriever(
          options.baseUrl,
          process.env.API_TOKEN || '',
          'hard-gated',
        )
      : createSyntheticShadowRetriever(fixture);
  } else {
    retrieve = options.baseUrl
      ? createLiveShadowRetriever(
          options.baseUrl,
          process.env.API_TOKEN || '',
          'global-soft-prior',
        )
      : createSyntheticGlobalShadowRetriever(fixture);
  }
  const summary = await evaluateRetrievalFixture(fixture, retrieve);
  process.stdout.write(options.json
    ? `${JSON.stringify(summary, null, 2)}\n`
    : `${formatEvaluationReport(summary)}\n`);
}

main().catch(error => {
  process.stderr.write(`Retrieval evaluation failed: ${error.message}\n`);
  process.exitCode = 1;
});
