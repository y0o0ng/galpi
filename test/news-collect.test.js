'use strict';

// N4a 수집 경로 (설계 12·16). **여기에는 LLM이 없다** — 가져오는 것이 맞는지
// 먼저 잠그고, 판단은 표본을 본 뒤 N4b에서 붙인다.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const {
  articleIdentityKey,
  buildQuery,
  canonicalizeUrl,
  dedupeArticles,
  normalizeArticle,
  parsePublishedAt,
} = require('../lib/news/normalize');
const { MAX_ANALYSIS_ATTEMPTS, createNewsStore } = require('../lib/news/store');
const { collectNews, createNewsCollector, FAILURE_BACKOFF_SECONDS } = require('../lib/news/collect');
const { createWebService } = require('../lib/web/service');

const NOW = Math.floor(Date.parse('2026-08-20T03:00:00Z') / 1000);

function createDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, model TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY, filename TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
      note_type TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
      codex_status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE note_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, chunk_id TEXT UNIQUE NOT NULL,
      note_filename TEXT NOT NULL, note_title TEXT NOT NULL, chunk_type TEXT NOT NULL,
      content TEXT NOT NULL, source_session TEXT, source_user_message INTEGER,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE auto_save_decisions (id INTEGER PRIMARY KEY, decision TEXT NOT NULL, action TEXT);
  `);
  runDatabaseMigrations(db);
  return db;
}

function createStore(db, options = {}) {
  return createNewsStore(db, { now: () => NOW, ...options });
}

function searchResult(url, extra = {}) {
  return {
    title: extra.title || '기사 제목',
    url,
    snippet: extra.snippet || '요약 문장.',
    publishedDate: extra.publishedDate ?? '2026-08-19T00:00:00Z',
    source: extra.source,
  };
}

function fakeSearch(results, options = {}) {
  const calls = [];
  const search = async (query, searchOptions) => {
    calls.push({ query, ...searchOptions });
    if (options.throwCode) {
      const error = new Error('검색 실패');
      error.code = options.throwCode;
      throw error;
    }
    return { credits: options.credits ?? 1, cached: options.cached === true, results };
  };
  search.calls = calls;
  return search;
}

const INTERESTS = [{ interestId: 'news-a13f', topic: 'OpenAI Responses API', state: 'subscribed' }];

test('추적 꼬리표가 달라도 같은 기사다', () => {
  const base = 'https://example.com/news/article';
  const same = [
    `${base}?utm_source=twitter&utm_medium=social`,
    `${base}#section-2`,
    `${base}/`,
    `http://www.example.com/news/article`,
    `${base}?fbclid=abc123`,
  ];
  const key = articleIdentityKey(canonicalizeUrl(base));
  same.forEach(url => {
    assert.equal(articleIdentityKey(canonicalizeUrl(url)), key, url);
  });

  // 뜻이 있는 파라미터는 남는다 — 지우면 서로 다른 기사가 하나로 합쳐진다.
  assert.notEqual(articleIdentityKey(canonicalizeUrl(`${base}?id=2`)), key);
  // 파라미터 순서는 값이 아니다.
  assert.equal(
    canonicalizeUrl(`${base}?b=2&a=1`),
    canonicalizeUrl(`${base}?a=1&b=2`),
  );
  // 경로 대소문자는 서버에 따라 다른 문서라 접지 않는다.
  assert.notEqual(canonicalizeUrl(`${base}/A`), canonicalizeUrl(`${base}/a`));
});

test('읽을 수 없는 주소와 제목 없는 결과는 조용히 버린다', () => {
  assert.equal(canonicalizeUrl('javascript:alert(1)'), '');
  assert.equal(canonicalizeUrl('그냥 글자'), '');
  assert.equal(normalizeArticle({ url: 'ftp://example.com/a', title: '제목' }), null);
  assert.equal(normalizeArticle({ url: 'https://example.com/a', title: '   ' }), null);
});

test('발행 시각은 파싱되면 epoch, 아니면 원문만 남긴다', () => {
  assert.deepEqual(parsePublishedAt('2026-08-19T00:00:00Z'), {
    publishedAt: Math.floor(Date.parse('2026-08-19T00:00:00Z') / 1000),
    publishedRaw: '2026-08-19T00:00:00Z',
  });
  assert.deepEqual(parsePublishedAt('어제'), { publishedAt: null, publishedRaw: '어제' });
  assert.deepEqual(parsePublishedAt(''), { publishedAt: null, publishedRaw: null });
});

test('질의는 하나이고 별칭을 엮지 않는다', () => {
  assert.equal(buildQuery({ topic: 'OpenAI  Responses API', aliases: ['오픈AI', 'responses'] }), 'OpenAI Responses API');
  assert.equal(buildQuery({ topic: '   ' }), '');
});

test('등록할 때 만든 검색어가 있으면 그것으로 찾고, 없으면 topic으로 찾는다', () => {
  // topic은 사람이 읽는 이름이고 query가 검색어다. 사용자가 말한 이름이 검색에서
  // 약해도(`피지컬 AI 관련 정보`) 수집은 query를 쓴다.
  assert.equal(
    buildQuery({ topic: '로봇 하드웨어 관련 신기술 뉴스', query: 'humanoid robot hardware new products' }),
    'humanoid robot hardware new products',
  );
  // 없거나 비어 있으면 지금까지의 동작 그대로다.
  assert.equal(buildQuery({ topic: '로봇 하드웨어' }), '로봇 하드웨어');
  assert.equal(buildQuery({ topic: '로봇 하드웨어', query: '  ' }), '로봇 하드웨어');
  assert.equal(buildQuery({ topic: '로봇 하드웨어', query: null }), '로봇 하드웨어');
});

test('한 번의 수집 안에서 같은 기사는 한 번만 남는다', () => {
  const articles = dedupeArticles([
    normalizeArticle(searchResult('https://example.com/a?utm_source=x')),
    normalizeArticle(searchResult('https://example.com/a')),
    normalizeArticle(searchResult('https://example.com/b')),
  ]);
  assert.equal(articles.length, 2);
});

test('수집이 기사를 저장하고 관심과 이어 붙인다', async () => {
  const db = createDatabase();
  const store = createStore(db);
  const search = fakeSearch([
    searchResult('https://example.com/a'),
    searchResult('https://example.com/b'),
  ]);

  const summary = await collectNews({ interests: INTERESTS, search, store, now: NOW });
  assert.equal(summary.attempted, 1);
  assert.equal(summary.succeeded, 1);
  assert.equal(summary.created, 2);
  assert.equal(summary.linked, 2);
  assert.deepEqual(search.calls[0], {
    query: 'OpenAI Responses API', topic: 'news', timeRange: 'week', maxResults: 5,
  });

  const rows = store.articlesForInterest('news-a13f');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].analysisState, 'pending');
  // 판단은 아직 없다.
  assert.equal(rows[0].relevance, null);
  assert.equal(rows[0].summary, null);
  db.close();
});

test('다시 수집해도 기사가 늘지 않고 분석 상태는 그대로다', async () => {
  const db = createDatabase();
  const store = createStore(db);
  const search = fakeSearch([searchResult('https://example.com/a')]);

  await collectNews({ interests: INTERESTS, search, store, now: NOW });
  const claimed = store.claimForAnalysis({ limit: 1 });
  store.completeAnalysis({
    articleId: claimed[0].articleId, interestId: claimed[0].interestId,
    leaseUntil: claimed[0].leaseUntil,
    relevance: 0.8, summary: '요약', promptVersion: 'test-v1', analyzerModel: 'test',
  });

  // 다음 주기가 오면 같은 기사가 또 걸린다.
  const later = NOW + 7 * 60 * 60;
  const store2 = createStore(db, { now: () => later });
  await collectNews({ interests: INTERESTS, search, store: store2, now: later });

  assert.deepEqual(store2.analysisCounts(), { pending: 0, analyzing: 0, done: 1, failed: 0, skipped: 0 });
  const rows = store2.articlesForInterest('news-a13f');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].summary, '요약', '이미 판단한 기사를 다시 비우지 않는다');
  db.close();
});

test('주기가 안 됐으면 검색하지 않는다', async () => {
  const db = createDatabase();
  const store = createStore(db);
  const search = fakeSearch([searchResult('https://example.com/a')]);

  await collectNews({ interests: INTERESTS, search, store, now: NOW });
  assert.equal(search.calls.length, 1);

  const soon = NOW + 60;
  const store2 = createStore(db, { now: () => soon });
  const summary = await collectNews({ interests: INTERESTS, search, store: store2, now: soon });
  assert.equal(summary.attempted, 0);
  assert.equal(search.calls.length, 1);
});

test('새로 생긴 관심은 표에 행이 없어도 대상이다', async () => {
  const db = createDatabase();
  const store = createStore(db);
  const search = fakeSearch([searchResult('https://example.com/a')]);

  await collectNews({ interests: INTERESTS, search, store, now: NOW });
  const withNew = [...INTERESTS, { interestId: 'news-b202', topic: 'Zigbee', state: 'expressed' }];
  const soon = NOW + 60;
  const store2 = createStore(db, { now: () => soon });
  const summary = await collectNews({ interests: withNew, search, store: store2, now: soon });

  assert.equal(summary.attempted, 1);
  assert.equal(search.calls.at(-1).query, 'Zigbee');
});

test('검색이 실패해도 다른 관심은 계속 돌고, 실패한 쪽만 천천히 다시 본다', async () => {
  const db = createDatabase();
  const store = createStore(db);
  const failing = fakeSearch([], { throwCode: 'NEWS_SOURCE_DOWN' });

  const summary = await collectNews({ interests: INTERESTS, search: failing, store, now: NOW });
  assert.equal(summary.succeeded, 0);
  assert.equal(summary.results[0].code, 'NEWS_SOURCE_DOWN');

  const row = db.prepare(`
    SELECT next_poll_at AS nextPollAt, last_error_code AS code FROM news_interest_polls WHERE interest_id = ?
  `).get('news-a13f');
  assert.equal(row.code, 'NEWS_SOURCE_DOWN');
  assert.equal(row.nextPollAt, NOW + FAILURE_BACKOFF_SECONDS);
  db.close();
});

test('Tavily 본문 timeout 뒤 다른 관심을 수집하고 다음 tick에서 재시도할 수 있다', async t => {
  const db = createDatabase();
  let now = NOW;
  const store = createStore(db, { now: () => now });
  const deadlines = [];
  t.mock.method(AbortSignal, 'timeout', () => {
    const controller = new AbortController();
    deadlines.push(controller);
    return controller.signal;
  });
  const entered = Promise.withResolvers();
  let calls = 0;
  const web = createWebService({
    enabled: true,
    apiKey: 'test-only',
    now: () => now * 1000,
    fetchImpl: async (url, { signal }) => {
      calls += 1;
      if (calls === 1) return {
        ok: true,
        json() {
          entered.resolve();
          assert.ok(signal instanceof AbortSignal);
          return new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        },
      };
      return new Response(JSON.stringify({ results: [searchResult(`https://example.com/${calls}`)] }));
    },
  });
  const collector = createNewsCollector({
    loadInterests: async () => [...INTERESTS, { interestId: 'news-b202', topic: 'Zigbee' }],
    search: web.search,
    store,
    now: () => now,
    onError: error => assert.fail(error),
  });
  const first = collector.tick();
  t.after(async () => {
    deadlines.forEach(controller => controller.abort());
    try { await first; } finally { db.close(); }
  });
  await entered.promise;
  assert.equal(collector.tick(), first, '실행 중에는 수집을 겹치지 않는다');
  assert.equal(deadlines.length, 1);
  deadlines[0].abort(new DOMException('deadline', 'TimeoutError'));
  await first;
  assert.equal(calls, 2, '중단된 관심 다음의 관심은 계속 수집한다');
  const failed = db.prepare('SELECT last_error_code, next_poll_at FROM news_interest_polls WHERE interest_id = ?').get('news-a13f');
  assert.equal(failed.last_error_code, 'WEB_SEARCH_PROVIDER_FAILED');
  assert.equal(failed.next_poll_at, NOW + FAILURE_BACKOFF_SECONDS);
  assert.equal(store.creditsUsed(), 1);

  now += FAILURE_BACKOFF_SECONDS - 1;
  const next = collector.tick();
  assert.notEqual(next, first, '완료된 running Promise를 해제한다');
  await next;
  assert.equal(calls, 2, '실패 backoff 전에는 재시도하지 않는다');
  now += 1;
  await collector.tick();
  assert.equal(calls, 3);
  assert.equal(store.articlesForInterest('news-a13f').length, 1);
  assert.equal(store.creditsUsed(), 2);
});

test('뉴스 크레딧 한도가 채팅 검색을 굶기지 않게 문을 닫는다', async () => {
  const db = createDatabase();
  const store = createStore(db, { monthlyCreditLimit: 2 });
  const search = fakeSearch([searchResult('https://example.com/a')]);
  const many = [
    { interestId: 'news-1', topic: '주제 하나' },
    { interestId: 'news-2', topic: '주제 둘' },
    { interestId: 'news-3', topic: '주제 셋' },
  ];

  const summary = await collectNews({ interests: many, search, store, now: NOW });
  assert.equal(search.calls.length, 2, '한도를 넘는 호출은 아예 나가지 않는다');
  assert.equal(summary.succeeded, 2);
  assert.equal(summary.results[2].code, 'NEWS_SEARCH_BUDGET_EXHAUSTED');
  assert.equal(store.creditsUsed(), 2);

  // 한도로 미룬 것은 고장이 아니라 정책이라 실패로 적지 않는다.
  const polled = db.prepare('SELECT COUNT(*) AS n FROM news_interest_polls WHERE last_error_code IS NOT NULL').get();
  assert.equal(polled.n, 0);
  db.close();
});

test('캐시가 돌려준 결과는 크레딧을 세지 않는다', async () => {
  const db = createDatabase();
  const store = createStore(db);
  const search = fakeSearch([searchResult('https://example.com/a')], { cached: true });
  await collectNews({ interests: INTERESTS, search, store, now: NOW });
  assert.equal(store.creditsUsed(), 0);
  db.close();
});

test('lease를 잃은 기사는 되돌아온다', async () => {
  const db = createDatabase();
  const store = createStore(db);
  await collectNews({ interests: INTERESTS, search: fakeSearch([searchResult('https://example.com/a')]), store, now: NOW });

  const claimed = store.claimForAnalysis({ limit: 5, leaseSeconds: 60 });
  assert.equal(claimed.length, 1);
  // lease를 들고 있는 동안에는 아무도 못 가져간다.
  assert.deepEqual(store.claimForAnalysis({ limit: 5 }), []);

  const later = createStore(db, { now: () => NOW + 300 });
  assert.equal(later.recoverExpiredLeases(), 1);
  assert.equal(later.analysisCounts().pending, 1);
  db.close();
});

test('상한을 넘긴 기사는 failed로 목록에 남고 사람이 다시 돌릴 수 있다', async () => {
  const db = createDatabase();
  const store = createStore(db);
  await collectNews({ interests: INTERESTS, search: fakeSearch([searchResult('https://example.com/a')]), store, now: NOW });

  let state = null;
  for (let attempt = 0; attempt < MAX_ANALYSIS_ATTEMPTS; attempt += 1) {
    const stepStore = createStore(db, { now: () => NOW + 100_000 * (attempt + 1) });
    const rows = stepStore.claimForAnalysis({ limit: 1 });
    assert.equal(rows.length, 1, `시도 ${attempt + 1}에서 가져와야 한다`);
    assert.equal(rows[0].attemptCount, attempt + 1);
    state = stepStore.failAnalysis({
      articleId: rows[0].articleId, interestId: rows[0].interestId,
      leaseUntil: rows[0].leaseUntil, code: 'BOOM', attemptCount: rows[0].attemptCount,
    });
    assert.equal(state, attempt + 1 >= MAX_ANALYSIS_ATTEMPTS ? 'failed' : 'pending');
  }
  assert.equal(store.analysisCounts().failed, 1);
  // 조용히 사라지지 않는다.
  assert.equal(db.prepare("SELECT analysis_error_code AS c FROM news_article_interests").get().c, 'BOOM');

  assert.equal(store.requeueFailedAnalysis(), 1);
  assert.equal(store.analysisCounts().pending, 1);
  assert.equal(
    db.prepare('SELECT analysis_attempt_count AS n FROM news_article_interests').get().n,
    0,
    '재처리는 시도 횟수를 되돌린다',
  );
  db.close();
});

test('같은 기사가 두 관심에 걸리면 기사는 하나이고 연결이 둘이다', async () => {
  const db = createDatabase();
  const store = createStore(db);
  const search = fakeSearch([searchResult('https://example.com/shared')]);
  const two = [
    { interestId: 'news-1', topic: '주제 하나' },
    { interestId: 'news-2', topic: '주제 둘' },
  ];

  const summary = await collectNews({ interests: two, search, store, now: NOW });
  assert.equal(summary.created, 1);
  assert.equal(summary.linked, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM news_articles').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM news_article_interests').get().n, 2);
  db.close();
});

test('proactive 표가 같은 candidate로 두 번 만들어지지 않는다', () => {
  const db = createDatabase();
  db.prepare("INSERT INTO messages (id, session_id, role, content, created_at) VALUES (1, 'shared-main', 'assistant', '질문', ?)").run(NOW);
  db.prepare("INSERT INTO messages (id, session_id, role, content, created_at) VALUES (2, 'shared-main', 'assistant', '질문 또', ?)").run(NOW);
  db.prepare(`
    INSERT INTO news_review_candidates (id, interest_id, question, created_at) VALUES (1, 'news-a13f', '아직 관심 있어?', ?)
  `).run(NOW);
  const insert = db.prepare(`
    INSERT INTO news_proactive_messages (message_id, candidate_id, interest_id, created_at) VALUES (?, 1, 'news-a13f', ?)
  `);
  insert.run(1, NOW);
  assert.throws(() => insert.run(2, NOW), /UNIQUE/);
  db.close();
});
