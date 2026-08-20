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

// ── 회귀: 최초 관심 표현이 "최근 언급"으로 다시 세어지면 안 된다 ──────────
//
// last_seen은 **사용자가 실제로 그 관심을 말한 마지막 시점**이다. 그 값을 만든
// 발화가 다음 review에서 다시 잡히면 관심이 영영 재확인되지 않고, 더 나쁘게는
// 연장이 last_seen을 오늘로 바꿔 "오늘 말했다"는 거짓 기록이 남는다.

const { applyInterestActions, parseNewsContextNote } = require('../lib/news-interest-note');
const { kstDateToEpoch } = require('../lib/news/review');

const EXPRESSED_AT = Math.floor(Date.parse('2026-07-01T05:00:00Z') / 1000); // 14:00 KST
const REVIEW_DAY = Math.floor(Date.parse('2026-07-31T05:00:00Z') / 1000);

// 서버의 loadUserMessagesSince와 같은 의미: created_at >= since 인 user 메시지.
function messageLoader(messages) {
  return since => messages.filter(item => item.createdAt >= since);
}

function noteWithExpressedInterest() {
  const { content } = applyInterestActions({
    raw: '',
    now: EXPRESSED_AT,
    source: 'user',
    actions: [{
      op: 'add', topic: '로컬 LLM', state: 'expressed',
      reason: '요즘 로컬 LLM에 관심 있어', reviewAfter: initialReviewAfter(EXPRESSED_AT),
    }],
  });
  return content;
}

test('관심을 만든 그 발화를 나중에 최근 언급으로 다시 세지 않는다', () => {
  const interests = parseNewsContextNote(noteWithExpressedInterest());
  assert.equal(interests[0].lastSeen, '2026-07-01');

  const load = messageLoader([
    // 관심을 만든 바로 그 발화. 이것 말고는 관련 발화가 없다.
    { content: '요즘 로컬 LLM에 관심 있어', createdAt: EXPRESSED_AT },
    { content: '오늘 점심 뭐 먹지', createdAt: EXPRESSED_AT + 3600 },
    { content: '주말에 자전거 탈까', createdAt: REVIEW_DAY - 3600 },
  ]);

  const target = pickReviewTarget({ interests, now: REVIEW_DAY, loadUserMessagesSince: load });
  assert.equal(target.action, 'ask', '30일 동안 조용했으므로 물어야 한다');
});

test('스캔은 last_seen 다음 날부터 본다', () => {
  const interests = parseNewsContextNote(noteWithExpressedInterest());
  const seen = [];
  pickReviewTarget({
    interests,
    now: REVIEW_DAY,
    loadUserMessagesSince: since => { seen.push(since); return []; },
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0], kstDateToEpoch('2026-07-01') + DAY, 'last_seen 당일은 이미 센 것이다');
});

test('last_seen 다음 날 이후의 언급은 그대로 잡는다', () => {
  const interests = parseNewsContextNote(noteWithExpressedInterest());
  const load = messageLoader([
    { content: '요즘 로컬 LLM에 관심 있어', createdAt: EXPRESSED_AT },
    { content: '로컬 LLM 뭐가 제일 빠르지?', createdAt: EXPRESSED_AT + 5 * DAY },
  ]);
  const target = pickReviewTarget({ interests, now: REVIEW_DAY, loadUserMessagesSince: load });
  assert.equal(target.action, 'extend');
});

test('review 연장이 last_seen을 오늘로 바꾸지 않는다', () => {
  const note = noteWithExpressedInterest();
  const before = parseNewsContextNote(note)[0];

  // review가 쓰는 mutation. 예정일만 미루고 언급 기록은 건드리지 않는다.
  const { interests } = applyInterestActions({
    raw: note,
    now: REVIEW_DAY,
    source: 'user',
    actions: [{ op: 'reschedule', interestId: before.interestId, reviewAfter: '2026-08-14' }],
  });

  assert.equal(interests[0].reviewAfter, '2026-08-14');
  assert.equal(interests[0].lastSeen, before.lastSeen, 'last_seen은 그대로다');
  assert.equal(interests[0].state, before.state);
  assert.equal(interests[0].topic, before.topic);
});

test('reschedule은 예정일 말고는 아무것도 못 바꾼다', () => {
  const note = noteWithExpressedInterest();
  const id = parseNewsContextNote(note)[0].interestId;
  const { interests } = applyInterestActions({
    raw: note,
    now: REVIEW_DAY,
    source: 'user',
    actions: [{
      op: 'reschedule', interestId: id, reviewAfter: '2026-08-14',
      state: 'subscribed', topic: '다른 주제', reason: '몰래 바꾸기',
    }],
  });
  assert.equal(interests[0].state, 'expressed');
  assert.equal(interests[0].topic, '로컬 LLM');
  assert.equal(interests[0].reason, '요즘 로컬 LLM에 관심 있어');
});

test('사용자가 다시 말하면 last_seen은 그때 갱신된다', () => {
  const note = noteWithExpressedInterest();
  const id = parseNewsContextNote(note)[0].interestId;
  const { interests } = applyInterestActions({
    raw: note, now: REVIEW_DAY, source: 'user',
    actions: [{ op: 'update', interestId: id, reason: '아직 관심 있어' }],
  });
  assert.equal(interests[0].lastSeen, '2026-07-31');
});

// ── 회귀: 열린 질문이 하나뿐이라는 것은 DB가 보장해야 한다 ──────────────────

test('DB를 직접 우회해도 열린 질문이 둘이 되지 않는다', () => {
  const db = createDatabase();
  const store = createNewsStore(db, { now: () => NOW });
  store.createReviewCandidate({ interestId: 'news-b202', question: '질문 하나' });

  assert.throws(
    () => db.prepare(`
      INSERT INTO news_review_candidates (interest_id, question, created_at)
      VALUES ('news-b202', '우회 질문', ?)
    `).run(NOW),
    /UNIQUE/,
  );
  assert.equal(store.openReviewCandidates().length, 1);
  db.close();
});

test('질문이 끝난 뒤에는 같은 관심에 새 질문을 만들 수 있다', () => {
  const db = createDatabase();
  const store = createNewsStore(db, { now: () => NOW });
  const first = store.createReviewCandidate({ interestId: 'news-b202', question: '질문 하나' });

  for (const state of ['resolved', 'dismissed', 'expired']) {
    const open = store.openReviewCandidates()[0];
    assert.ok(open, `${state} 전에는 열린 질문이 있어야 한다`);
    assert.equal(store.settleReviewCandidate({ id: open.id, state }), true);
    assert.ok(store.createReviewCandidate({ interestId: 'news-b202', question: `${state} 뒤 질문` }));
  }
  // 끝난 질문들은 그대로 남아 있다.
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM news_review_candidates').get().n > 3);
  assert.equal(first.interestId, 'news-b202');
  db.close();
});
