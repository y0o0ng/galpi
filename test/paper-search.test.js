'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PaperSearchError,
  clearPaperSearchCache,
  normalizePaper,
  normalizePaperResults,
  searchSemanticScholar,
} = require('../lib/paper-search');
const { MOCK_S2_RESPONSE } = require('../lib/paper-search-mock');

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
    openAccessPdf: { url: 'https://example.com/paper.pdf' },
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
    openAccessPdfUrl: 'https://example.com/paper.pdf',
  });
});

test('normalizePaper preserves an already normalized browser result', () => {
  const first = normalizePaper({
    paperId: 'roundtrip-paper',
    title: 'Roundtrip paper',
    authors: [{ name: 'Kim' }, { name: 'Lee' }],
    tldr: { text: 'Short finding' },
    externalIds: { DOI: '10.1000/roundtrip', ArXiv: '2501.00002' },
  });

  assert.deepEqual(normalizePaper(first), first);
});

test('mock fixture normalizes missing, unsafe, and invalid paper fields', () => {
  const papers = normalizePaperResults(MOCK_S2_RESPONSE.data);

  assert.equal(papers.length, 4);

  const tldrOnly = papers.find(paper => paper.paperId === 'edge-tldr-only');
  assert.equal(tldrOnly.abstract, null);
  assert.match(tldrOnly.tldr, /intentionally provides a TLDR/);
  assert.equal(tldrOnly.citationCount, 0);

  const fullText = papers.find(paper => paper.paperId === 'abc123');
  assert.equal(fullText.openAccessPdfUrl, 'https://arxiv.org/pdf/2412.20138');

  const sparse = papers.find(paper => paper.paperId === 'edge-missing-metadata');
  assert.equal(sparse.abstract, null);
  assert.equal(sparse.tldr, null);
  assert.equal(sparse.year, null);
  assert.deepEqual(sparse.authors, []);
  assert.equal(sparse.citationCount, 0);
  assert.equal(sparse.url, 'https://www.semanticscholar.org/paper/edge-missing-metadata');
  assert.equal(sparse.openAccessPdfUrl, null);

  const unsafe = papers.find(paper => paper.paperId === 'edge-many-authors');
  assert.equal(unsafe.title, 'Robust Multi-Agent Evaluation');
  assert.equal(unsafe.abstract, 'Evidence without executable markup.');
  assert.equal(unsafe.authors.length, 6);
  assert.equal(unsafe.citationCount, 17);
  assert.equal(unsafe.url, 'https://www.semanticscholar.org/paper/edge-many-authors');
  assert.equal(unsafe.openAccessPdfUrl, null);
});

test('mock search uses the production normalization and cache path without fetching', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error('mock mode must not fetch');
  };

  const first = await searchSemanticScholar('mock edge cases', {
    fetchImpl,
    mockResponse: MOCK_S2_RESPONSE,
  });
  const second = await searchSemanticScholar('mock edge cases', {
    fetchImpl,
    mockResponse: MOCK_S2_RESPONSE,
  });

  assert.equal(calls, 0);
  assert.equal(first.mock, true);
  assert.equal(first.cached, false);
  assert.equal(first.results.length, 4);
  assert.equal(second.cached, true);
});

test('mock search preserves an empty result set', async () => {
  const emptyResult = await searchSemanticScholar('no results', {
    mockResponse: { total: 0, data: [] },
  });
  const malformedResult = await searchSemanticScholar('malformed response', {
    mockResponse: null,
  });

  assert.equal(emptyResult.mock, true);
  assert.equal(emptyResult.total, 0);
  assert.deepEqual(emptyResult.results, []);
  assert.equal(malformedResult.total, 0);
  assert.deepEqual(malformedResult.results, []);
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
  assert.match(requestedUrl, /openAccessPdf/);
  assert.equal(requestedHeaders['x-api-key'], 'secret-key');
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(first.results[0].paperId, 'paper-2');
});

test('searchSemanticScholar retries transient responses with exponential backoff and caches success', async () => {
  let calls = 0;
  const delays = [];
  const responses = [429, 503, 200];
  const fetchImpl = async () => {
    const status = responses[calls];
    calls += 1;
    return {
      ok: status === 200,
      status,
      json: async () => status === 200
        ? { total: 1, data: [{ paperId: 'retry-paper', title: 'Recovered paper' }] }
        : { message: 'try again' },
    };
  };

  const first = await searchSemanticScholar('retry success', {
    fetchImpl,
    randomImpl: () => 0.5,
    sleepImpl: async delay => delays.push(delay),
  });
  const second = await searchSemanticScholar('retry success', { fetchImpl });

  assert.equal(calls, 3);
  assert.deepEqual(delays, [1125, 2125]);
  assert.equal(first.results[0].paperId, 'retry-paper');
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
});

test('searchSemanticScholar stops after two retries and maps persistent rate limits', async () => {
  let calls = 0;
  const delays = [];
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: false,
      status: 429,
      json: async () => ({ message: 'Too Many Requests' }),
    };
  };

  await assert.rejects(
    searchSemanticScholar('rate limit test', {
      fetchImpl,
      randomImpl: () => 0,
      sleepImpl: async delay => delays.push(delay),
    }),
    error => {
      assert.ok(error instanceof PaperSearchError);
      assert.equal(error.statusCode, 429);
      assert.match(error.message, /잠시 후/);
      return true;
    },
  );
  assert.equal(calls, 3);
  assert.deepEqual(delays, [1000, 2000]);
});

test('searchSemanticScholar does not retry invalid or authentication responses', async () => {
  for (const status of [400, 401, 403]) {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return {
        ok: false,
        status,
        json: async () => ({}),
      };
    };

    await assert.rejects(
      searchSemanticScholar(`non-retryable ${status}`, { fetchImpl }),
      error => error instanceof PaperSearchError,
    );
    assert.equal(calls, 1);
  }
});

test('searchSemanticScholar maps timeouts to a retryable gateway error', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
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
  assert.equal(calls, 1);
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
