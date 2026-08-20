'use strict';

// 판단은 (기사, 관심) 쌍에 속한다 (설계 13·15).
//
// 같은 기사가 두 관심에 걸릴 수 있는데 판단을 기사 하나에 저장하면, 한쪽 기준으로
// 매긴 relevance와 "왜 가져왔는지"가 다른 관심에서도 그대로 쓰인다. 그러면 홈과
// 대화가 사용자에게 **틀린 이유**를 말한다.
//
// 잠그는 것은 넷이다.
// 1. 한 기사가 두 관심에 걸리면 판단도 둘이다.
// 2. 한쪽 판단이 다른 쪽으로 새지 않는다.
// 3. 홈이 보여주는 topic과 reason이 같은 판단에서 나온다.
// 4. 같은 URL dedupe는 그대로다.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const { createNewsStore } = require('../lib/news/store');
const { collectNews } = require('../lib/news/collect');
const { createNewsAnalyzer } = require('../lib/news/analyze');
const { NEWS_SEARCH_TOOL, createNewsSearchSession } = require('../lib/news/search-tool');

const NOW = Math.floor(Date.parse('2026-08-20T03:00:00Z') / 1000);

const A = { interestId: 'news-aaaa', topic: 'OpenAI Responses API', state: 'subscribed', reason: '갈피 tool runtime' };
const B = { interestId: 'news-bbbb', topic: 'Microsoft', state: 'subscribed', reason: '주식 때문' };

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

// 두 관심 검색에 같은 기사가 걸린다.
async function seedShared(db) {
  const store = createNewsStore(db, { now: () => NOW });
  const search = async () => ({
    credits: 1,
    results: [{
      title: 'OpenAI와 Microsoft, 새 계약 발표',
      url: 'https://example.com/deal',
      snippet: '두 회사가 계약을 맺었다.',
      publishedDate: '2026-08-19T00:00:00Z',
    }],
  });
  await collectNews({ interests: [A, B], search, store, now: NOW });
  return store;
}

// 관심마다 다른 판단을 돌려주는 모델.
function analyzerFor(store, byInterest, options = {}) {
  const calls = [];
  const instance = createNewsAnalyzer({
    store,
    now: () => NOW,
    loadInterests: async () => options.interests || [A, B],
    callModel: async payload => {
      calls.push(payload);
      const topic = /topic: (.+)/.exec(payload.input)?.[1];
      const decision = byInterest[topic];
      if (!decision) throw new Error(`판단 준비 안 된 topic: ${topic}`);
      return decision;
    },
    ...options.extra,
  });
  instance.calls = calls;
  return instance;
}

const JUDGMENTS = {
  'OpenAI Responses API': {
    relevance: 0.95, novelty: 0.8, importance: 0.9,
    summary: 'Responses API 관련 계약이다.',
    reason: '갈피가 쓰는 Responses API에 직접 영향이 있다.',
  },
  Microsoft: {
    relevance: 0.4, novelty: 0.3, importance: 0.2,
    summary: 'Microsoft가 계약 당사자다.',
    reason: '보유 종목이라 계약 규모만 관련이 있다.',
  },
};

test('한 기사가 두 관심에 걸리면 판단도 둘이고 기사는 하나다', async () => {
  const db = createDatabase();
  const store = await seedShared(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM news_articles').get().n, 1, 'dedupe는 그대로다');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM news_article_interests').get().n, 2);

  const worker = analyzerFor(store, JUDGMENTS);
  const outcomes = await worker.tick();

  assert.equal(worker.calls.length, 2, '관심마다 한 번씩 판단한다');
  assert.equal(outcomes.length, 2);
  assert.deepEqual(
    outcomes.map(item => item.interestId).sort(),
    ['news-aaaa', 'news-bbbb'],
  );
  db.close();
});

test('한쪽 판단이 다른 쪽으로 새지 않는다', async () => {
  const db = createDatabase();
  const store = await seedShared(db);
  await analyzerFor(store, JUDGMENTS).tick();

  const rows = db.prepare(`
    SELECT interest_id AS interestId, relevance, importance,
           summary, judgment_reason AS reason
    FROM news_article_interests ORDER BY interest_id
  `).all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].relevance, 0.95);
  assert.match(rows[0].reason, /Responses API에 직접 영향/);
  assert.equal(rows[1].relevance, 0.4);
  assert.match(rows[1].reason, /보유 종목이라/);
  db.close();
});

test('news_search에서 topic B로 조회하면 B 기준 판단만 온다', async () => {
  const db = createDatabase();
  const store = await seedShared(db);
  await analyzerFor(store, JUDGMENTS).tick();

  const session = createNewsSearchSession(store, { interests: [A, B] });
  const result = session.execute(NEWS_SEARCH_TOOL.name, { topic: 'Microsoft' });
  const payload = JSON.parse(
    result.content.slice(
      result.content.indexOf('<untrusted_news_results>') + '<untrusted_news_results>'.length,
      result.content.indexOf('</untrusted_news_results>'),
    ).trim(),
  );

  assert.equal(payload.length, 1);
  assert.equal(payload[0].관심사, 'Microsoft');
  assert.equal(payload[0].요약, 'Microsoft가 계약 당사자다.');
  assert.match(payload[0].가져온이유, /보유 종목이라/);
  // A 기준 문장이 새어 나오면 안 된다.
  assert.doesNotMatch(result.content, /Responses API에 직접 영향/);
  db.close();
});

test('홈이 보여주는 topic과 reason이 같은 판단에서 나온다', async () => {
  const db = createDatabase();
  const store = await seedShared(db);
  await analyzerFor(store, JUDGMENTS).tick();

  // 문턱을 낮춰 두 판단이 모두 후보가 되게 한 뒤, 기사 하나가 카드 하나로
  // 오면서 그 카드의 topic과 reason이 같은 쌍에서 나오는지 본다.
  const rows = store.briefingArticles({ minRelevance: 0.1, minImportance: 0.1, limit: 5 });
  assert.equal(rows.length, 1, '기사 하나는 카드 하나다');
  assert.equal(rows[0].interestId, 'news-aaaa', '더 중요하게 판단된 쪽이 대표다');
  assert.match(rows[0].reason, /Responses API에 직접 영향/);
  assert.equal(rows[0].summary, 'Responses API 관련 계약이다.');

  // B만 문턱을 넘는 경우에는 B가 대표여야 한다.
  const onlyB = store.briefingArticles({ minRelevance: 0.1, minImportance: 0.1, limit: 5, interestIds: ['news-bbbb'] });
  assert.equal(onlyB[0].interestId, 'news-bbbb');
  assert.match(onlyB[0].reason, /보유 종목이라/);
  db.close();
});

test('관심 하나가 노트에서 사라져도 다른 쌍의 판단은 남는다', async () => {
  const db = createDatabase();
  const store = await seedShared(db);
  // B가 노트에서 사라진 상태로 분석한다.
  const worker = analyzerFor(store, JUDGMENTS, { interests: [A] });
  const outcomes = await worker.tick();

  assert.equal(worker.calls.length, 1, '살아 있는 관심만 판단한다');
  const skipped = outcomes.find(item => item.outcome === 'skipped');
  assert.equal(skipped.interestId, 'news-bbbb');
  assert.deepEqual(store.analysisCounts(), { pending: 0, analyzing: 0, done: 1, failed: 0, skipped: 1 });
  db.close();
});

test('한 쌍의 실패가 다른 쌍의 판단을 되돌리지 않는다', async () => {
  const db = createDatabase();
  const store = await seedShared(db);
  const worker = createNewsAnalyzer({
    store,
    now: () => NOW,
    loadInterests: async () => [A, B],
    callModel: async payload => {
      const topic = /topic: (.+)/.exec(payload.input)?.[1];
      if (topic === 'Microsoft') throw Object.assign(new Error('timeout'), { code: 'NEWS_TIMEOUT' });
      return JUDGMENTS[topic];
    },
  });
  await worker.tick();

  const counts = store.analysisCounts();
  assert.equal(counts.done, 1);
  assert.equal(counts.pending, 1, '실패한 쌍만 큐로 돌아간다');
  const done = db.prepare("SELECT relevance FROM news_article_interests WHERE analysis_state = 'done'").get();
  assert.equal(done.relevance, 0.95);
  db.close();
});

test('다시 수집해도 이미 내린 판단을 비우지 않는다', async () => {
  const db = createDatabase();
  const store = await seedShared(db);
  await analyzerFor(store, JUDGMENTS).tick();

  const later = NOW + 7 * 60 * 60;
  const store2 = createNewsStore(db, { now: () => later });
  const search = async () => ({
    credits: 1,
    results: [{
      title: 'OpenAI와 Microsoft, 새 계약 발표',
      url: 'https://example.com/deal?utm_source=x',
      snippet: '두 회사가 계약을 맺었다.',
      publishedDate: '2026-08-19T00:00:00Z',
    }],
  });
  await collectNews({ interests: [A, B], search, store: store2, now: later });

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM news_articles').get().n, 1);
  assert.deepEqual(store2.analysisCounts(), { pending: 0, analyzing: 0, done: 2, failed: 0, skipped: 0 });
  db.close();
});
