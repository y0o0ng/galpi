'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PaperSearchError,
  clearPaperSearchCache,
  normalizePaper,
  searchSemanticScholar,
} = require('../lib/paper-search');

test.beforeEach(() => clearPaperSearchCache());

test('normalizePaper keeps useful metadata and removes unsafe markup', () => {
  const paper = normalizePaper({
    paperId: 'paper-1',
    title: '<b>Useful</b> research',
    abstract: '<script>ignore()</script>Evidence  based',
    year: 2025,
    authors: [{ name: 'Kim' }, { name: '' }, { name: 'Lee' }],
    citationCount: 42,
    externalIds: { DOI: '10.1000/example', ArXiv: '2501.00001' },
    url: 'javascript:alert(1)',
    tldr: { text: '<i>Short</i> finding' },
  });

  assert.deepEqual(paper, {
    paperId: 'paper-1',
    title: 'Useful research',
    abstract: 'Evidence based',
    year: 2025,
    authors: ['Kim', 'Lee'],
    citationCount: 42,
    tldr: 'Short finding',
    url: 'https://www.semanticscholar.org/paper/paper-1',
    arxivId: '2501.00001',
    doi: '10.1000/example',
  });
});

test('searchSemanticScholar normalizes results and caches the same query', async () => {
  let calls = 0;
  let requestedUrl = '';
  let requestedHeaders = null;
  const fetchImpl = async (url, options) => {
    calls += 1;
    requestedUrl = String(url);
    requestedHeaders = options.headers;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        total: 1,
        data: [{ paperId: 'paper-2', title: 'Agent systems', authors: [] }],
      }),
    };
  };

  const first = await searchSemanticScholar('  multi-agent   trading  ', {
    apiKey: 'secret-key',
    fetchImpl,
  });
  const second = await searchSemanticScholar('multi-agent trading', {
    apiKey: 'secret-key',
    fetchImpl,
  });

  assert.equal(calls, 1);
  assert.match(requestedUrl, /query=multi-agent(?:\+|%20)trading/);
  assert.match(requestedUrl, /limit=10/);
  assert.equal(requestedHeaders['x-api-key'], 'secret-key');
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(first.results[0].paperId, 'paper-2');
});

test('searchSemanticScholar maps rate limits to a user-facing error', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 429,
    json: async () => ({ message: 'Too Many Requests' }),
  });

  await assert.rejects(
    searchSemanticScholar('rate limit test', { fetchImpl }),
    error => {
      assert.ok(error instanceof PaperSearchError);
      assert.equal(error.statusCode, 429);
      assert.match(error.message, /잠시 후/);
      return true;
    },
  );
});

test('searchSemanticScholar maps timeouts to a retryable gateway error', async () => {
  const fetchImpl = async () => {
    const error = new Error('timed out');
    error.name = 'TimeoutError';
    throw error;
  };

  await assert.rejects(
    searchSemanticScholar('timeout test', { fetchImpl }),
    error => {
      assert.ok(error instanceof PaperSearchError);
      assert.equal(error.statusCode, 504);
      assert.equal(error.code, 'timeout');
      assert.match(error.message, /다시 시도/);
      return true;
    },
  );
});

test('searchSemanticScholar rejects empty and oversized queries before fetch', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error('should not fetch');
  };

  await assert.rejects(searchSemanticScholar(' ', { fetchImpl }), /검색어/);
  await assert.rejects(searchSemanticScholar('x'.repeat(201), { fetchImpl }), /200자/);
  assert.equal(calls, 0);
});
