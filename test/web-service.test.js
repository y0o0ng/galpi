'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TAVILY_EXTRACT_ENDPOINT,
  TAVILY_SEARCH_ENDPOINT,
  createWebService,
  normalizePublicWebUrl,
} = require('../lib/web/service');

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

function createHarness({ usageCredits = 0, limit = 800, providerResponse } = {}) {
  const requests = [];
  const usage = [];
  const service = createWebService({
    enabled: true,
    provider: 'tavily',
    apiKey: 'tvly-test-secret',
    maxResults: 3,
    searchDepth: 'basic',
    cacheTtlMs: 900000,
    maxSnippetChars: 400,
    monthlyCreditSoftLimit: limit,
    getUsage: () => ({ credits: usageCredits + usage.reduce((sum, item) => sum + item.credits, 0) }),
    addUsage: (provider, credits) => usage.push({ provider, credits }),
    now: () => Date.parse('2026-09-02T01:02:03Z'),
    fetchImpl: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      if (typeof providerResponse === 'function') return providerResponse(url, options);
      return response(200, providerResponse || { results: [] });
    },
  });
  return { requests, service, usage };
}

test('search preserves Tavily request, normalization, source strategy, cache, and accounting', async () => {
  const { requests, service, usage } = createHarness({
    providerResponse: {
      results: [
        {
          title: '<b>일반 결과</b>',
          url: 'https://example.com/story',
          content: '<script>bad()</script> 요약  문장',
          score: 0.8,
        },
        {
          title: '공식 문서',
          url: 'https://docs.example.org/api-reference/item',
          content: '문서 내용',
          score: 0.7,
          published_date: '2026-09-01',
        },
      ],
    },
  });

  const options = {
    topic: 'news',
    timeRange: 'week',
    maxResults: 5,
    sourceStrategy: 'technical_first',
    reason: '  최신   확인  ',
  };
  const first = await service.search('  현재   정보 ', options);
  const second = await service.search('현재 정보', options);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, TAVILY_SEARCH_ENDPOINT);
  assert.deepEqual(requests[0].body, {
    query: '현재 정보',
    search_depth: 'basic',
    max_results: 5,
    topic: 'news',
    include_answer: false,
    include_raw_content: false,
    time_range: 'week',
  });
  assert.equal(requests[0].options.headers.Authorization, 'Bearer tvly-test-secret');
  assert.equal(first.results[0].title, '일반 결과');
  assert.equal(first.results[0].snippet, '요약 문장');
  assert.equal(first.results[1].sourceType, 'news');
  assert.equal(first.reason, '최신 확인');
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.deepEqual(usage, [{ provider: 'tavily', credits: 1 }]);
});

test('search source strategy reorders close technical evidence without changing result shape', async () => {
  const { service } = createHarness({
    providerResponse: {
      results: [
        { title: '일반', url: 'https://example.com/a', content: 'a', score: 0.8 },
        { title: '문서', url: 'https://docs.example.com/a', content: 'b', score: 0.75 },
      ],
    },
  });
  const result = await service.search('query', { sourceStrategy: 'technical_first' });
  assert.deepEqual(result.results.map(item => item.title), ['문서', '일반']);
  assert.deepEqual(Object.keys(result.results[0]), [
    'title', 'url', 'snippet', 'publishedDate', 'source', 'sourceType',
    'rank', 'score', 'provider', 'retrievedAt',
  ]);
});

test('monthly soft limit blocks search and basic Extract before provider calls', async () => {
  const { requests, service } = createHarness({ usageCredits: 800, limit: 800 });
  await assert.rejects(service.search('query'), error => error.code === 'WEB_MONTHLY_BUDGET_EXHAUSTED');
  await assert.rejects(service.fetch('https://example.com/page'), error => error.code === 'WEB_MONTHLY_BUDGET_EXHAUSTED');
  assert.equal(requests.length, 0);
});

test('Extract uses fixed basic markdown settings and records reported usage', async () => {
  const { requests, service, usage } = createHarness({
    providerResponse: {
      results: [{
        url: 'https://example.com/page',
        raw_content: '# 제목\r\n\r\n본문  \r\n\r\n\r\n\r\n끝',
      }],
      usage: { credits: 0 },
    },
  });

  const result = await service.fetch('https://example.com/page');
  assert.equal(requests[0].url, TAVILY_EXTRACT_ENDPOINT);
  assert.deepEqual(requests[0].body, {
    urls: 'https://example.com/page',
    extract_depth: 'basic',
    format: 'markdown',
    include_images: false,
    include_usage: true,
  });
  assert.equal(requests[0].options.headers.Authorization, 'Bearer tvly-test-secret');
  assert.equal(result.content, '# 제목\n\n본문\n\n\n끝');
  assert.equal(result.url, 'https://example.com/page');
  assert.deepEqual(usage, [{ provider: 'tavily', credits: 0 }]);
});

test('query-assisted Extract normalizes the query and fixes chunks_per_source at 3', async () => {
  const { requests, service } = createHarness({
    providerResponse: {
      results: [{ url: 'https://example.com/page', raw_content: 'relevant content' }],
      usage: { credits: 1 },
    },
  });
  const result = await service.fetch('https://example.com/page', { query: '  exact   topic ' });
  assert.equal(result.query, 'exact topic');
  assert.equal(requests[0].body.query, 'exact topic');
  assert.equal(requests[0].body.chunks_per_source, 3);
});

test('Extract rejects missing content and sanitizes provider failures', async () => {
  const empty = createHarness({
    providerResponse: {
      results: [],
      failed_results: [{ error: 'SECRET HTML' }],
      usage: { credits: 1 },
    },
  });
  await assert.rejects(empty.service.fetch('https://example.com'), error => {
    assert.equal(error.code, 'WEB_FETCH_NO_CONTENT');
    assert.doesNotMatch(error.message, /SECRET HTML/);
    return true;
  });
  assert.deepEqual(empty.usage, [{ provider: 'tavily', credits: 1 }]);

  const failed = createHarness({
    providerResponse: () => response(403, { error: 'token tvly-test-secret <html>private</html>' }),
  });
  await assert.rejects(failed.service.fetch('https://example.com'), error => {
    assert.equal(error.code, 'WEB_FETCH_PROVIDER_FAILED');
    assert.doesNotMatch(error.message, /tvly-test-secret|private|html/);
    return true;
  });
  assert.deepEqual(failed.usage, []);

  const networkFailure = createHarness({
    providerResponse: () => { throw new Error('network failure'); },
  });
  await assert.rejects(networkFailure.service.fetch('https://example.com'), error => (
    error.code === 'WEB_FETCH_PROVIDER_FAILED'
  ));
  assert.deepEqual(networkFailure.usage, []);
});

test('Extract validates the provider-returned URL before exposing evidence', async () => {
  const { service, usage } = createHarness({
    providerResponse: {
      results: [{ url: 'http://127.0.0.1/private', raw_content: 'must not escape' }],
      usage: { credits: 1 },
    },
  });
  await assert.rejects(service.fetch('https://example.com'), error => error.code === 'WEB_FETCH_URL_NOT_PUBLIC');
  assert.deepEqual(usage, [{ provider: 'tavily', credits: 1 }]);
});

for (const method of ['search', 'fetch']) {
  for (const phase of ['response', 'body']) {
    test(`${method} aborts a stalled ${phase} within the same 10-second request deadline`, async t => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      t.mock.method(AbortSignal, 'timeout', delay => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(new DOMException('deadline', 'TimeoutError')), delay);
        return controller.signal;
      });
      const entered = Promise.withResolvers();
      const responseDelay = phase === 'body' ? 3000 : 0;
      let stall = true;
      const { service, requests, usage } = createHarness({
        providerResponse: (url, { signal }) => {
          if (!stall) return response(200, {
            results: [{ title: 'Recovered', url: 'https://example.com/a', content: 'ok', raw_content: 'ok' }],
            usage: { credits: 1 },
          });
          const waitForAbort = () => {
            entered.resolve();
            assert.ok(signal instanceof AbortSignal, 'request must carry its deadline signal');
            return new Promise((resolve, reject) => {
              signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            });
          };
          t.mock.timers.tick(responseDelay);
          return phase === 'response' ? waitForAbort() : { ok: true, json: waitForAbort };
        },
      });
      const input = method === 'search' ? 'query' : 'https://example.com/a';
      const pending = service[method](input).then(value => ({ value }), error => ({ error }));
      await entered.promise;
      const signal = requests[0].options.signal;
      assert.ok(signal instanceof AbortSignal);
      t.mock.timers.tick(9999 - responseDelay);
      assert.equal(signal.aborted, false);
      t.mock.timers.tick(1);
      assert.equal(signal.aborted, true);
      const { error } = await pending;
      assert.equal(error?.code, method === 'search' ? 'WEB_SEARCH_PROVIDER_FAILED' : 'WEB_FETCH_PROVIDER_FAILED');
      assert.doesNotMatch(error.message, /deadline|tvly-test-secret/);
      assert.deepEqual(usage, []);

      stall = false;
      const recovered = await service[method](input);
      assert.equal(requests.length, 2, 'failed requests must not become cached empty results');
      assert.ok(method === 'search' ? recovered.results.length === 1 : recovered.content === 'ok');
      assert.deepEqual(usage, [{ provider: 'tavily', credits: 1 }]);
    });
  }

  test(`${method} rejects unreadable JSON instead of accepting empty evidence`, async () => {
    const { service, requests, usage } = createHarness({
      providerResponse: () => new Response('<private>tvly-test-secret', { status: 200 }),
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(service[method](method === 'search' ? 'query' : 'https://example.com/a'), error => {
        assert.equal(error.code, method === 'search' ? 'WEB_SEARCH_PROVIDER_FAILED' : 'WEB_FETCH_PROVIDER_FAILED');
        assert.doesNotMatch(error.message, /private|tvly-test-secret/);
        return true;
      });
    }
    assert.equal(requests.length, 2);
    assert.deepEqual(usage, []);
  });
}

test('public URL validation accepts normal HTTP(S) and rejects local/non-public targets', () => {
  assert.equal(normalizePublicWebUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(normalizePublicWebUrl('http://example.com/a.pdf'), 'http://example.com/a.pdf');

  const rejected = [
    '/relative',
    'file:///etc/passwd',
    'ftp://example.com/a',
    'javascript:alert(1)',
    'https://user:pass@example.com/',
    'http://localhost/',
    'http://device.local/path',
    'http://127.0.0.1/',
    'http://10.0.0.1/',
    'http://172.16.0.1/',
    'http://192.168.0.1/',
    'http://169.254.1.1/',
    'http://198.51.100.1/',
    'http://203.0.113.1/',
    'http://[::1]/',
    'http://[fe80::1]/',
    'http://[fd00::1]/',
    'http://[2001:db8::1]/',
    `https://example.com/${'x'.repeat(2048)}`,
  ];
  for (const value of rejected) {
    assert.throws(() => normalizePublicWebUrl(value), error => (
      error.code === 'WEB_FETCH_URL_INVALID' || error.code === 'WEB_FETCH_URL_NOT_PUBLIC'
    ), value);
  }
});
