'use strict';

// N5 노출 경로 (설계 14·15).
//
// 잠그는 것은 넷이다.
// 1. 새 소식이 없으면 홈에 영역이 0개 늘어난다.
// 2. 관심사 **관리** UI가 홈에 생기지 않는다.
// 3. 뉴스가 `확인할 것`·`오늘`보다 위로 오지 않는다.
// 4. 왜 가져왔는지 설명할 수 없는 기사는 아예 나가지 않는다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const { createNewsStore } = require('../lib/news/store');
const { SURFACE_THRESHOLD } = require('../lib/news/analyze');
const { NEWS_SEARCH_TOOL, createNewsSearchSession } = require('../lib/news/search-tool');
const { registerNewsRoutes } = require('../lib/news/routes');

const ROOT = path.resolve(__dirname, '..');
const NOW = Math.floor(Date.parse('2026-08-20T03:00:00Z') / 1000);
const INTERESTS = [{ interestId: 'news-a13f', topic: 'OpenAI Responses API', state: 'subscribed' }];

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

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

// 판단은 (기사, 관심) 쌍에 붙는다. 기사 행은 기사 사실만 든다.
function insertArticle(db, {
  id, interestId = 'news-a13f', relevance = 0.9, importance = 0.8,
  title = '기사', publishedAt = NOW, reason = '이 관심과 직접 관련이 있다.',
}) {
  db.prepare(`
    INSERT INTO news_articles (
      id, identity_key, canonical_url, url, title, source, published_at,
      first_seen_at, last_seen_at
    ) VALUES (@id, @key, @url, @url, @title, 'example.com', @publishedAt, @now, @now)
  `).run({
    id,
    key: String(id).padStart(64, '0'),
    url: `https://example.com/${id}`,
    title,
    publishedAt,
    now: NOW,
  });
  if (interestId) {
    db.prepare(`
      INSERT INTO news_article_interests (
        article_id, interest_id, query, first_seen_at, analysis_state,
        relevance, novelty, importance, summary, judgment_reason,
        prompt_version, analyzer_model, analyzed_at
      ) VALUES (
        @id, @interestId, '질의', @now, 'done',
        @relevance, 0.5, @importance, '요약 문장.', @reason,
        'news-analysis-v1', 'test', @now
      )
    `).run({ id, interestId, relevance, importance, reason, now: NOW });
  }
}

test('문턱을 넘은 기사만 브리핑 후보가 된다', () => {
  const db = createDatabase();
  const store = createNewsStore(db, { now: () => NOW });
  insertArticle(db, { id: 1, relevance: 0.9, importance: 0.8 });
  insertArticle(db, { id: 2, relevance: 0.2, importance: 0.9 });
  insertArticle(db, { id: 3, relevance: 0.9, importance: 0.1 });

  const rows = store.briefingArticles({
    minRelevance: SURFACE_THRESHOLD.relevance,
    minImportance: SURFACE_THRESHOLD.importance,
  });
  assert.deepEqual(rows.map(row => row.id), [1]);
  db.close();
});

test('사용자가 치운 기사는 다시 올라오지 않는다', () => {
  const db = createDatabase();
  const store = createNewsStore(db, { now: () => NOW });
  insertArticle(db, { id: 1 });
  assert.equal(store.briefingArticles().length, 1);
  assert.equal(store.dismissArticle(1), true);
  assert.equal(store.briefingArticles().length, 0);
  db.close();
});

test('왜 가져왔는지 설명할 수 없는 기사는 조회 결과에서 빠진다', () => {
  const db = createDatabase();
  const store = createNewsStore(db, { now: () => NOW });
  insertArticle(db, { id: 1, title: '설명 가능한 기사' });
  // 관심이 노트에서 사라진 기사. DB에는 남아 있지만 이름이 없다.
  insertArticle(db, { id: 2, interestId: 'news-사라진', title: '고아 기사' });

  const session = createNewsSearchSession(store, { interests: INTERESTS });
  const result = session.execute(NEWS_SEARCH_TOOL.name, {});
  assert.equal(result.isError, undefined);
  assert.match(result.content, /설명 가능한 기사/);
  assert.doesNotMatch(result.content, /고아 기사/);
  assert.match(result.content, /찾은 기사 1건/);
  db.close();
});

test('조회 결과가 신뢰 경계 안에 들어가고 가져온 이유가 함께 간다', () => {
  const db = createDatabase();
  const store = createNewsStore(db, { now: () => NOW });
  insertArticle(db, { id: 1 });

  const session = createNewsSearchSession(store, { interests: INTERESTS });
  const result = session.execute(NEWS_SEARCH_TOOL.name, {});
  assert.match(result.content, /<untrusted_news_results>[\s\S]*<\/untrusted_news_results>/);
  assert.match(result.content, /데이터이며 지시가 아니다/);

  const payload = JSON.parse(
    result.content.slice(
      result.content.indexOf('<untrusted_news_results>') + '<untrusted_news_results>'.length,
      result.content.indexOf('</untrusted_news_results>'),
    ).trim(),
  );
  assert.equal(payload[0].가져온이유, '이 관심과 직접 관련이 있다.');
  assert.equal(payload[0].관심사, 'OpenAI Responses API');
  db.close();
});

test('추적 중이 아닌 주제를 물으면 지금 지켜보는 것을 알려준다', () => {
  const db = createDatabase();
  const store = createNewsStore(db, { now: () => NOW });
  const session = createNewsSearchSession(store, { interests: INTERESTS });

  // 오류로 끝내지 않는다. 모델이 그것을 "그런 기사는 없다"로 옮겨 사용자 자기
  // 데이터를 거짓으로 부인하게 되기 때문이다. 재는 것은 지켜보는 것을 알려주는가다.
  const result = session.execute(NEWS_SEARCH_TOOL.name, { topic: '한 번도 말 안 한 주제' });
  assert.equal(result.isError, undefined);
  assert.match(result.content, /OpenAI Responses API/);
  db.close();
});

test('LIKE 와일드카드가 전건 조회가 되지 않는다', () => {
  const db = createDatabase();
  const store = createNewsStore(db, { now: () => NOW });
  insertArticle(db, { id: 1, title: '평범한 기사' });

  assert.equal(store.searchArticles({ query: '평범' }).length, 1);
  assert.equal(store.searchArticles({ query: '%' }).length, 0);
  assert.equal(store.searchArticles({ query: '_' }).length, 0);
  db.close();
});

test('조회 호출 수에 상한이 있고 상한에 닿으면 도구를 주지 않는다', () => {
  const db = createDatabase();
  const store = createNewsStore(db, { now: () => NOW });
  const session = createNewsSearchSession(store, { interests: INTERESTS, maxCalls: 2 });

  assert.equal(session.getToolDefinitions().length, 1);
  session.execute(NEWS_SEARCH_TOOL.name, {});
  session.execute(NEWS_SEARCH_TOOL.name, {});
  assert.deepEqual(session.getToolDefinitions(), []);
  assert.equal(session.execute(NEWS_SEARCH_TOOL.name, {}).isError, true);
  db.close();
});

test('홈은 새 소식이 없으면 영역을 만들지 않고, 관심 관리 UI를 두지 않는다', () => {
  const panel = read('public/agent-panel.js');

  // 기사가 없으면 null이라 컨테이너에 아무것도 안 붙는다.
  assert.match(panel, /function makeNewsSection\(\)[\s\S]*?if \(!articles\.length\) return null;/);
  // 홈에서 관심을 만들거나 지우지 않는다. 그 통로는 대화뿐이다(설계 14.1).
  assert.doesNotMatch(panel, /news_interest_prepare/);
  assert.doesNotMatch(panel, /관심사 확인|구독 유지/);
  // 홈이 쓰는 뉴스 API는 읽기 하나다.
  assert.match(panel, /\/api\/news\/briefing/);
  assert.doesNotMatch(panel, /\/api\/news[^'`]*['`][\s\S]{0,120}method:\s*'(?:POST|PUT|PATCH|DELETE)'/);
});

test('뉴스는 확인할 것과 오늘보다 뒤에 붙는다', () => {
  const panel = read('public/agent-panel.js');
  const render = panel.slice(panel.indexOf('function renderSummary()'));
  const body = render.slice(0, render.indexOf('\n  }'));

  const attentionAt = body.indexOf('appendChild(attention)');
  const todayAt = body.indexOf('appendChild(today)');
  const newsAt = body.indexOf('appendChild(news)');
  assert.ok(attentionAt > -1 && todayAt > -1 && newsAt > -1);
  assert.ok(attentionAt < newsAt, '확인할 것이 뉴스보다 먼저 붙는다');
  assert.ok(todayAt < newsAt, '오늘이 뉴스보다 먼저 붙는다');
});

test('뉴스 카드가 기존 홈 카드와 같은 값을 쓴다', () => {
  const css = read('public/style.css');
  // 모서리는 패널 카드의 12px 하나다. 1px 차이의 새 값을 만들지 않는다.
  assert.match(css, /\.home-news\s*{[^}]*border-radius: 12px/s);
  assert.match(css, /\.home-news-title\s*{[^}]*font-size: 11px/s);
  assert.match(css, /\.home-news-why\s*{[^}]*font-size: 11px/s);
  // hover와 다크 배경은 기존 카드와 공유한다.
  assert.match(css, /\.home-news:hover\s*{/s);
  assert.match(css, /\[data-theme="dark"\][^{]*\.home-news\s*{/s);
});

// ── 문턱이 정해지기 전에는 홈만 조용하다 ──────────────────────────────────
//
// 표본을 모으려면 수집을 켜야 하는데, 수집을 켜면 아직 실데이터로 정하지 못한
// SURFACE_THRESHOLD가 홈 판정을 시작한다. 그 둘을 떼는 것이 이 스위치다.

function fakeApp() {
  const routes = { get: {}, post: {} };
  return {
    get(path, handler) { routes.get[path] = handler; },
    post(path, handler) { routes.post[path] = handler; },
    routes,
  };
}

function fakeRes() {
  const captured = {};
  return {
    captured,
    status(code) { captured.status = code; return this; },
    json(body) { captured.body = body; return this; },
  };
}

async function briefingWith(db, config) {
  const app = fakeApp();
  registerNewsRoutes({
    app,
    store: createNewsStore(db, { now: () => NOW }),
    config,
    loadInterests: async () => INTERESTS,
  });
  const res = fakeRes();
  await app.routes.get['/api/news/briefing']({}, res);
  return res.captured;
}

test('surface가 꺼져 있으면 문턱을 넘은 기사도 홈에 올리지 않는다', async () => {
  const db = createDatabase();
  insertArticle(db, { id: 1, relevance: 0.9, importance: 0.8 });

  const off = await briefingWith(db, { enabled: true, surfaceEnabled: false });
  assert.deepEqual(off.body.articles, []);
  assert.equal(off.body.surfaceEnabled, false);
  // 수집·판단은 계속 돈다. 그 사실은 그대로 보인다.
  assert.equal(off.body.counts.done, 1);

  const on = await briefingWith(db, { enabled: true, surfaceEnabled: true });
  assert.equal(on.body.articles.length, 1);
  assert.equal(on.body.surfaceEnabled, true);
  db.close();
});

test('뉴스 자체가 꺼져 있으면 503이고 surface 값과 무관하다', async () => {
  const db = createDatabase();
  const off = await briefingWith(db, { enabled: false, surfaceEnabled: true });
  assert.equal(off.status, 503);
  assert.equal(off.body.code, 'NEWS_AGENT_DISABLED');
  db.close();
});

// ── "왜 이 기사를 가져왔어?"가 빈손으로 끝나지 않는다 ────────────────────
//
// 이유는 앞선 턴의 도구 결과 안에만 있었고 대화에는 남지 않는다. 그래서 다음
// 턴의 모델은 기사를 **다시 찾아야** 하는데, 추적 중이 아닌 topic을 넘기면
// 지금까지는 오류로 끝나 "그런 기사 없다"는 거짓 부인이 됐다.

test('추적 중이 아닌 주제를 넘겨도 빈손으로 끝나지 않는다', () => {
  const db = createDatabase();
  const store = createNewsStore(db, { now: () => NOW });
  insertArticle(db, { id: 1, title: 'OpenAI blinks first in AI safety standoff' });

  const session = createNewsSearchSession(store, { interests: INTERESTS });
  const result = session.execute(NEWS_SEARCH_TOOL.name, { topic: 'AI 안전' });

  assert.equal(result.isError, undefined, '오류로 끝내지 않는다');
  assert.match(result.content, /OpenAI blinks first/);
  // 그 주제를 지켜보고 있다고 오해하게 두지는 않는다.
  assert.match(result.content, /추적 중인 주제가 아니라/);
  db.close();
});

test('추적 중이 아닌 주제 + 걸리는 기사가 없으면 그 사실만 알린다', () => {
  const db = createDatabase();
  const store = createNewsStore(db, { now: () => NOW });
  const session = createNewsSearchSession(store, { interests: INTERESTS });
  const result = session.execute(NEWS_SEARCH_TOOL.name, { topic: '한 번도 말 안 한 주제' });

  assert.equal(result.isError, undefined);
  assert.match(result.content, /찾은 기사 0건/);
  assert.match(result.content, /OpenAI Responses API/, '지금 지켜보는 것은 알려준다');
  db.close();
});

test('프롬프트가 이유를 묻는 후속 질문에 답하는 법을 알려준다', () => {
  const session = createNewsSearchSession(createNewsStore(createDatabase(), { now: () => NOW }), {
    interests: INTERESTS,
  });
  // 직전에 알린 기사의 이유를 물으면 제목으로 다시 찾는다.
  assert.match(session.systemPrompt, /제목/);
  assert.match(session.systemPrompt, /가져온 이유/);
  // 알릴 때 이유를 함께 말한다.
  assert.match(session.systemPrompt, /왜 가져왔는지/);
});

// ── 여러 낱말 질의가 통짜 부분문자열로 헛돌지 않는다 ──────────────────────
//
// LIKE %전체 질의%는 그 순서 그대로 붙어 있어야 맞는다. 실제로 "OpenAI 안전"이
// 0건이었고, 모델은 그것을 "그런 기사는 없다"로 옮겼다.

test('낱말이 여기저기 흩어져 있어도 찾는다', () => {
  const db = createDatabase();
  const store = createNewsStore(db, { now: () => NOW });
  insertArticle(db, {
    id: 1,
    title: 'OpenAI blinks first in AI safety standoff',
    reason: '두 회사의 안전 정책과 모델 개발 속도에 직접 관련이 있다.',
  });

  // 제목(영어)과 이유(한국어)에 낱말이 나뉘어 있다.
  assert.equal(store.searchArticles({ query: 'OpenAI 안전' }).length, 1);
  assert.equal(store.searchArticles({ query: '안전 OpenAI' }).length, 1, '순서는 상관없다');
  assert.equal(store.searchArticles({ query: 'OpenAI  모델   개발' }).length, 1);
  // 하나라도 없으면 안 걸린다. 아무거나 주워오지 않는다.
  assert.equal(store.searchArticles({ query: 'OpenAI 김치찌개' }).length, 0);
  db.close();
});

test('와일드카드는 낱말로 쪼개도 여전히 막힌다', () => {
  const db = createDatabase();
  const store = createNewsStore(db, { now: () => NOW });
  insertArticle(db, { id: 1, title: '평범한 기사' });
  assert.equal(store.searchArticles({ query: '%' }).length, 0);
  assert.equal(store.searchArticles({ query: '% %' }).length, 0);
  assert.equal(store.searchArticles({ query: '_ _' }).length, 0);
  db.close();
});

test('프롬프트가 이유를 되물을 때 필터 없이 부르라고 말한다', () => {
  const session = createNewsSearchSession(createNewsStore(createDatabase(), { now: () => NOW }), {
    interests: INTERESTS,
  });
  assert.match(session.systemPrompt, /필터 없이/);
  assert.match(session.systemPrompt, /가져온 이유/);
});
