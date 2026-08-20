'use strict';

// N3 재확인 경로 (설계 11).
//
// 잠그는 것은 다섯이다.
// 1. 최근 계속 이야기하는 관심에는 묻지 않고 미룬다.
// 2. 같은 관심에 살아 있는 질문이 둘이 되지 않는다.
// 3. 같은 candidate가 proactive 메시지를 두 번 만들지 못한다.
// 4. Push 실패가 candidate와 메시지를 잃게 만들지 않는다.
// 5. Push payload에 관심 주제도 질문 문면도 실리지 않는다.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const { createNewsStore } = require('../lib/news/store');
const {
  CANDIDATE_TTL_SECONDS,
  extendedReviewAfter,
  initialReviewAfter,
  kstDate,
  mentionTerms,
  mentionedSince,
  pickReviewTarget,
  reviewQuestion,
} = require('../lib/news/review');
const {
  NEWS_PUSH_PAYLOAD_KEYS,
  buildNewsPushPayload,
  buildNewsSendOptions,
  createNewsPushService,
} = require('../lib/news/push');

const NOW = Math.floor(Date.parse('2026-08-20T03:00:00Z') / 1000);
const DAY = 24 * 60 * 60;

function expressed(overrides = {}) {
  return {
    interestId: 'news-b202',
    topic: '초경량 로컬 LLM',
    state: 'expressed',
    lastSeen: '2026-07-01',
    reviewAfter: '2026-08-01',
    aliases: [],
    ...overrides,
  };
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

function addSubscription(db, endpoint) {
  return db.prepare(`
    INSERT INTO assistant_push_subscriptions (endpoint, p256dh, auth, status, created_at, updated_at)
    VALUES (?, 'key', 'auth', 'active', ?, ?)
  `).run(endpoint, NOW, NOW).lastInsertRowid;
}

test('예정일이 지나도 최근에 그 주제를 말했으면 묻지 않고 미룬다', () => {
  const target = pickReviewTarget({
    interests: [expressed()],
    now: NOW,
    loadUserMessagesSince: () => [{ content: '요즘 초경량 로컬 LLM 뭐가 좋아?' }],
  });
  assert.equal(target.action, 'extend');
  assert.equal(target.reviewAfter, extendedReviewAfter(NOW));
});

test('조용하면 묻는다', () => {
  const target = pickReviewTarget({
    interests: [expressed()],
    now: NOW,
    loadUserMessagesSince: () => [{ content: '오늘 날씨 어때?' }],
  });
  assert.equal(target.action, 'ask');
  assert.match(reviewQuestion(target.interest), /초경량 로컬 LLM/);
});

test('예정일 전이거나 expressed가 아니면 대상이 아니다', () => {
  const messages = () => [];
  assert.equal(pickReviewTarget({
    interests: [expressed({ reviewAfter: '2026-09-20' })], now: NOW, loadUserMessagesSince: messages,
  }), null);
  assert.equal(pickReviewTarget({
    interests: [expressed({ state: 'subscribed' })], now: NOW, loadUserMessagesSince: messages,
  }), null);
  assert.equal(pickReviewTarget({
    interests: [expressed({ reviewAfter: null })], now: NOW, loadUserMessagesSince: messages,
  }), null);
});

test('이미 물어둔 관심은 다시 고르지 않는다', () => {
  const target = pickReviewTarget({
    interests: [expressed()],
    now: NOW,
    loadUserMessagesSince: () => [],
    openInterestIds: new Set(['news-b202']),
  });
  assert.equal(target, null);
});

test('별칭도 최근 언급으로 친다', () => {
  const interest = expressed({ aliases: ['local llm'] });
  assert.deepEqual(mentionTerms(interest), ['초경량 로컬 llm', 'local llm']);
  assert.equal(mentionedSince({ interest, messages: [{ content: 'Local LLM 요즘 어때' }] }), true);
  assert.equal(mentionedSince({ interest, messages: [{ content: '점심 뭐 먹지' }] }), false);
});

test('두 글자짜리 조각은 언급 검사에 쓰지 않는다', () => {
  // 짧은 낱말이 아무 문장에나 걸리면 검사가 늘 통과해 재확인이 영영 안 나간다.
  assert.deepEqual(mentionTerms({ topic: 'AI', aliases: ['ai'] }), []);
  assert.equal(mentionedSince({ topic: 'AI' }, { messages: [{ content: 'AI 얘기' }] }), false);
});

test('expressed에만 재확인 예정일이 붙고 기본은 30일 뒤다', () => {
  assert.equal(initialReviewAfter(NOW), kstDate(NOW + 30 * DAY));
});

test('같은 관심에 살아 있는 질문이 둘이 되지 않는다', () => {
  const db = createDatabase();
  const store = createNewsStore(db, { now: () => NOW });

  const first = store.createReviewCandidate({ interestId: 'news-b202', question: '아직 관심 있어?' });
  assert.ok(first.id);
  assert.equal(store.createReviewCandidate({ interestId: 'news-b202', question: '또 물어?' }), null);

  // 끝난 뒤에는 다시 만들 수 있다.
  assert.equal(store.settleReviewCandidate({ id: first.id, state: 'resolved' }), true);
  assert.ok(store.createReviewCandidate({ interestId: 'news-b202', question: '다음에 또' }).id);
  db.close();
});

test('같은 candidate가 proactive 메시지를 두 번 만들지 못한다', () => {
  const db = createDatabase();
  const store = createNewsStore(db, { now: () => NOW });
  const candidate = store.createReviewCandidate({ interestId: 'news-b202', question: '질문' });
  db.prepare("INSERT INTO messages (id, session_id, role, content, created_at) VALUES (1, 'shared-main', 'assistant', '질문', ?)").run(NOW);
  db.prepare("INSERT INTO messages (id, session_id, role, content, created_at) VALUES (2, 'shared-main', 'assistant', '질문', ?)").run(NOW);

  assert.equal(store.linkProactiveMessage({ messageId: 1, candidateId: candidate.id, interestId: 'news-b202' }), true);
  assert.equal(store.linkProactiveMessage({ messageId: 2, candidateId: candidate.id, interestId: 'news-b202' }), false);
  assert.deepEqual([...store.proactiveMessageIds()], [1]);
  db.close();
});

test('답이 없으면 만료하고 같은 질문을 즉시 다시 보내지 않는다', () => {
  const db = createDatabase();
  const store = createNewsStore(db, { now: () => NOW });
  store.createReviewCandidate({ interestId: 'news-b202', question: '질문', at: NOW - CANDIDATE_TTL_SECONDS - 1 });

  assert.equal(store.expireStaleCandidates(CANDIDATE_TTL_SECONDS, NOW), 1);
  assert.deepEqual(store.openReviewCandidates(), []);
  db.close();
});

test('Push payload에 주제도 질문 문면도 실리지 않는다', () => {
  const payload = buildNewsPushPayload({ candidateId: 7 });
  const parsed = JSON.parse(payload);
  assert.deepEqual(Object.keys(parsed).sort(), [...NEWS_PUSH_PAYLOAD_KEYS].sort());
  // 숫자 키는 version과 candidateId 둘뿐이라 다른 값이 실릴 자리가 없다.
  assert.deepEqual(
    Object.entries(parsed).filter(([, value]) => typeof value === 'number').map(([key]) => key).sort(),
    ['candidateId', 'version'],
  );
  assert.doesNotMatch(payload, /초경량|관심|챙겨/);
  assert.equal(buildNewsSendOptions({ candidateId: 7 }).urgency, 'normal');
  assert.throws(() => buildNewsPushPayload({ candidateId: 0 }), error => error.code === 'NEWS_PUSH_INVALID_TARGET');
});

test('질문 하나가 살아 있는 기기 전부에 걸리고 조용한 시간에는 미뤄진다', () => {
  const db = createDatabase();
  const store = createNewsStore(db, { now: () => NOW });
  addSubscription(db, 'https://a.example/1');
  addSubscription(db, 'https://a.example/2');
  const candidate = store.createReviewCandidate({ interestId: 'news-b202', question: '질문' });

  const service = createNewsPushService(db, {
    enabled: true,
    now: () => NOW,
    quietHours: () => ({ enabled: false }),
  });
  assert.equal(service.enqueueCandidate(candidate.id, NOW), 2);
  // 같은 질문을 같은 기기에 두 번 걸지 않는다.
  assert.equal(service.enqueueCandidate(candidate.id, NOW), 0);

  const claim = service.claim(NOW);
  assert.ok(claim);
  assert.equal(service.accept(claim, 201, NOW), true);
  // 한 기기라도 받으면 질문은 전달된 것이다.
  assert.equal(store.openReviewCandidates()[0].state, 'delivered');

  // 조용한 시간이면 next_attempt_at이 밀린다.
  const quiet = createNewsPushService(db, {
    enabled: true,
    now: () => NOW,
    quietHours: () => ({ enabled: true, start: '00:00', end: '23:59' }),
  });
  const second = store.createReviewCandidate({ interestId: 'news-c91d', question: '질문 둘' });
  quiet.enqueueCandidate(second.id, NOW);
  const rows = db.prepare('SELECT next_attempt_at AS at FROM news_push_deliveries WHERE candidate_id = ?').all(second.id);
  assert.ok(rows.every(row => row.at > NOW), '조용한 시간에는 뒤로 밀린다');
  db.close();
});

test('Push가 전부 실패해도 candidate와 메시지는 남는다', () => {
  const db = createDatabase();
  const store = createNewsStore(db, { now: () => NOW });
  addSubscription(db, 'https://a.example/1');
  const candidate = store.createReviewCandidate({ interestId: 'news-b202', question: '질문' });
  db.prepare("INSERT INTO messages (id, session_id, role, content, created_at) VALUES (1, 'shared-main', 'assistant', '질문', ?)").run(NOW);
  store.linkProactiveMessage({ messageId: 1, candidateId: candidate.id, interestId: 'news-b202' });

  const service = createNewsPushService(db, { enabled: true, now: () => NOW, quietHours: () => ({ enabled: false }) });
  service.enqueueCandidate(candidate.id, NOW);
  const claim = service.claim(NOW);
  assert.equal(service.fail(claim, { httpStatus: 500, errorCode: 'PUSH_FAILED' }, NOW), true);

  assert.equal(store.openReviewCandidates().length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM news_proactive_messages').get().n, 1);
  db.close();
});

test('답을 받은 질문은 다른 기기에서 다시 울리지 않는다', () => {
  const db = createDatabase();
  const store = createNewsStore(db, { now: () => NOW });
  addSubscription(db, 'https://a.example/1');
  addSubscription(db, 'https://a.example/2');
  const candidate = store.createReviewCandidate({ interestId: 'news-b202', question: '질문' });

  const service = createNewsPushService(db, { enabled: true, now: () => NOW, quietHours: () => ({ enabled: false }) });
  service.enqueueCandidate(candidate.id, NOW);
  // 사용자가 채팅에서 답했다.
  store.settleReviewCandidate({ id: candidate.id, state: 'resolved' });

  assert.equal(service.claim(NOW), null, '끝난 질문은 더 이상 집히지 않는다');
  const states = db.prepare('SELECT status FROM news_push_deliveries').all().map(row => row.status);
  assert.deepEqual([...new Set(states)], ['skipped']);
  db.close();
});

test('410을 받은 구독은 만료되고 그 기기의 다른 질문도 정리된다', () => {
  const db = createDatabase();
  const store = createNewsStore(db, { now: () => NOW });
  const subscriptionId = addSubscription(db, 'https://a.example/1');
  const first = store.createReviewCandidate({ interestId: 'news-b202', question: '질문 하나' });
  const second = store.createReviewCandidate({ interestId: 'news-c91d', question: '질문 둘' });

  const service = createNewsPushService(db, { enabled: true, now: () => NOW, quietHours: () => ({ enabled: false }) });
  service.enqueueCandidate(first.id, NOW);
  service.enqueueCandidate(second.id, NOW);
  const claim = service.claim(NOW);
  assert.equal(service.expire(claim, 410, NOW), true);

  assert.equal(
    db.prepare('SELECT status FROM assistant_push_subscriptions WHERE id = ?').get(subscriptionId).status,
    'expired',
  );
  const remaining = db.prepare("SELECT status FROM news_push_deliveries WHERE id != ?").all(claim.id);
  assert.deepEqual([...new Set(remaining.map(row => row.status))], ['expired']);
  db.close();
});

test('Push가 꺼져 있으면 delivery를 만들지 않는다', () => {
  const db = createDatabase();
  const store = createNewsStore(db, { now: () => NOW });
  addSubscription(db, 'https://a.example/1');
  const candidate = store.createReviewCandidate({ interestId: 'news-b202', question: '질문' });

  const service = createNewsPushService(db, { enabled: false, now: () => NOW });
  assert.equal(service.enqueueCandidate(candidate.id, NOW), 0);
  assert.equal(service.claim(NOW), null);
  db.close();
});
