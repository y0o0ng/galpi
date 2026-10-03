'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const { createReelsStore } = require('../lib/reels/store');
const { createReelsWorker, EXPIRE_AFTER_SECONDS } = require('../lib/reels/worker');
const {
  REELS_PUSH_PAYLOAD_KEYS, buildReelsPushPayload, createReelsPushService,
} = require('../lib/reels/push');
const { registerReelsRoutes } = require('../lib/reels/routes');
const { createAssistantPushDispatcher } = require('../lib/assistant-push');

// 2026-10-02 19:00 KST
const NOW = Math.floor(Date.parse('2026-10-02T10:00:00Z') / 1000);

function createDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, model TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE notes (id INTEGER PRIMARY KEY, filename TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
      note_type TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, codex_status TEXT NOT NULL DEFAULT 'pending');
    CREATE TABLE note_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, chunk_id TEXT UNIQUE NOT NULL,
      note_filename TEXT NOT NULL, note_title TEXT NOT NULL, chunk_type TEXT NOT NULL, content TEXT NOT NULL,
      source_session TEXT, source_user_message INTEGER, created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')));
    CREATE TABLE auto_save_decisions (id INTEGER PRIMARY KEY, decision TEXT NOT NULL, action TEXT);
  `);
  runDatabaseMigrations(db);
  return db;
}

function card(name) {
  return {
    title: `title ${name}`, url: `https://example.com/${name}`, published_at: '2026-10-01',
    why: 'w', concept: `concept ${name}`, bridge: 'b', template: '단계', hook_paradox: 'p', hook_term: 't',
    hook_subtitle: 's', risk: 'r',
  };
}

const CARDS = ['a', 'b', 'c'].map(card);
const ITEMS = ['a', 'b', 'c'].map(name => ({
  source: 'S', title: `title ${name}`, url: `https://example.com/${name}`, published_at: '', summary: '',
}));

const { EventEmitter } = require('node:events');

const fetchOk = async () => ({
  ok: true,
  text: async () => `<rss>${ITEMS.map(i => `<item><title>${i.title}</title><link>${i.url}</link></item>`).join('')}</rss>`,
});

// 실제 claude를 실행하지 않는다.
function fakeSpawn({ code = 0, stdout = JSON.stringify({ cards: CARDS }) } = {}) {
  const spawn = () => {
    spawn.count += 1;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    child.stdin = { on() {}, end() {} };
    setImmediate(() => { child.stdout.emit('data', stdout); child.emit('close', code); });
    return child;
  };
  spawn.count = 0;
  return spawn;
}

function setup(clock = { now: NOW }) {
  const db = createDatabase();
  const store = createReelsStore(db, { now: () => clock.now });
  return { db, store, clock };
}

test('상태 전이: 선택하면 같은 배치의 나머지는 dropped이고 다시 못 고른다', () => {
  const { db, store } = setup();
  store.claimRun('2026-10-02');
  store.saveBatch({ day: '2026-10-02', cards: CARDS, collectedAt: NOW });
  const batch = store.latestBatch();
  assert.deepEqual([batch.status, batch.cards.map(c => c.status)], ['candidate', ['candidate', 'candidate', 'candidate']]);

  store.selectCard(batch.cards[1].id);
  const after = store.latestBatch();
  assert.equal(after.status, 'selected');
  assert.deepEqual(after.cards.map(c => c.status), ['dropped', 'selected', 'dropped']);
  assert.throws(() => store.selectCard(batch.cards[0].id), { code: 'REELS_NOT_PENDING' });
  assert.throws(() => store.rejectBatch('2026-10-02'), { code: 'REELS_NOT_PENDING' });
  assert.throws(() => store.selectCard(999), { code: 'REELS_NOT_FOUND' });
  assert.deepEqual(store.coveredConcepts(), ['concept b']);
  db.close();
});

test('전부 거절·보류·보류 뒤 선택', () => {
  const { db, store } = setup();
  store.claimRun('2026-10-02');
  store.saveBatch({ day: '2026-10-02', cards: CARDS, collectedAt: NOW });
  store.holdBatch('2026-10-02');
  assert.equal(store.latestBatch().status, 'held');
  store.selectCard(store.latestBatch().cards[0].id);
  assert.equal(store.latestBatch().status, 'selected');

  store.claimRun('2026-10-03');
  store.saveBatch({ day: '2026-10-03', cards: CARDS, collectedAt: NOW });
  store.rejectBatch('2026-10-03');
  assert.equal(store.latestBatch().status, 'dropped');
  db.close();
});

test('미결정 배치는 3일 뒤 만료되고 결정된 것은 건드리지 않는다', () => {
  const { db, store, clock } = setup();
  store.claimRun('2026-10-02');
  store.saveBatch({ day: '2026-10-02', cards: CARDS, collectedAt: NOW });
  store.holdBatch('2026-10-02');
  clock.now = NOW + EXPIRE_AFTER_SECONDS - 1;
  assert.equal(store.expireStale(EXPIRE_AFTER_SECONDS), 0);
  clock.now = NOW + EXPIRE_AFTER_SECONDS;
  assert.equal(store.expireStale(EXPIRE_AFTER_SECONDS), 3);
  assert.equal(store.latestBatch().status, 'dropped');
  db.close();
});

test('push: 공용 dispatcher에 붙이면 실제로 보낸다 (enabled가 없으면 dispatcher가 아무것도 안 한다)', async () => {
  const { db, store } = setup();
  db.prepare(`INSERT INTO assistant_push_subscriptions (endpoint, p256dh, auth, status) VALUES ('https://p/1','k','a','active')`).run();
  const push = createReelsPushService(db, { now: () => NOW });
  const worker = createReelsWorker({
    store, pushService: push, pushDispatcher: null, bin: '/fake', now: () => NOW,
    fetchImpl: fetchOk, spawn: fakeSpawn(),
  });
  await worker.tick();
  const sent = [];
  const dispatcher = createAssistantPushDispatcher(push, {
    now: () => NOW,
    transport: { async send(target, payload) { sent.push(JSON.parse(payload)); return { statusCode: 201 }; } },
    buildPayload: buildReelsPushPayload,
  });
  assert.equal(push.enabled, true);
  await dispatcher.tick();
  assert.equal(sent.length, 1);
  assert.deepEqual(Object.keys(sent[0]).sort(), [...REELS_PUSH_PAYLOAD_KEYS].sort());
  assert.equal(db.prepare('SELECT status FROM reels_push_deliveries').get().status, 'accepted');
  db.close();
});

test('worker: 성공하면 배치를 저장하고 push를 건다', async () => {
  const { db, store } = setup();
  db.prepare(`INSERT INTO assistant_push_subscriptions (endpoint, p256dh, auth, status) VALUES ('https://p/1','k','a','active')`).run();
  const push = createReelsPushService(db, { now: () => NOW });
  let dispatched = 0;
  const worker = createReelsWorker({
    store, pushService: push, pushDispatcher: { tick() { dispatched += 1; } }, bin: '/fake', now: () => NOW,
    fetchImpl: fetchOk, spawn: fakeSpawn(),
  });
  await worker.tick();
  assert.equal(db.prepare('SELECT outcome FROM reels_runs').get().outcome, 'ok');
  assert.equal(store.latestBatch().cards.length, 3);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reels_push_deliveries').get().n, 1);
  assert.equal(dispatched, 1);
  db.close();
});

test('worker: 실패하면 그날 1시간 간격으로 최대 3번까지 다시 하고 이유를 남긴다', async () => {
  const { db, store, clock } = setup();
  let fail = true;
  const worker = createReelsWorker({
    store, bin: '/fake', now: () => clock.now, fetchImpl: fetchOk,
    spawn: (...a) => (fail ? fakeSpawn({ code: 1, stdout: JSON.stringify({ is_error: true, result: 'Usage limit reached' }) }) : fakeSpawn())(...a),
  });
  const runs = () => db.prepare('SELECT outcome, attempts, error_code AS code, error_detail AS detail FROM reels_runs').get();
  await worker.tick();
  assert.deepEqual(runs(), { outcome: 'failed', attempts: 1, code: 'REELS_CLAUDE_EXIT', detail: 'Usage limit reached' });
  clock.now += 30 * 60;
  await worker.tick();                       // 1시간이 안 돼서 다시 안 한다
  assert.equal(runs().attempts, 1);
  clock.now += 31 * 60;
  await worker.tick();
  assert.equal(runs().attempts, 2);
  clock.now += 61 * 60;
  await worker.tick();
  assert.equal(runs().attempts, 3);
  clock.now += 61 * 60;
  fail = false;
  await worker.tick();                       // 3번을 다 썼다
  assert.equal(runs().attempts, 3);
  assert.equal(runs().outcome, 'failed');
  db.close();
});

test('worker: 재시도 끝에 성공하면 배치를 저장한다', async () => {
  const { db, store, clock } = setup();
  let fail = true;
  const worker = createReelsWorker({
    store, bin: '/fake', now: () => clock.now, fetchImpl: fetchOk,
    spawn: (...a) => (fail ? fakeSpawn({ code: 1 }) : fakeSpawn())(...a),
  });
  await worker.tick();
  fail = false;
  clock.now += 61 * 60;
  await worker.tick();
  assert.equal(db.prepare('SELECT outcome FROM reels_runs').get().outcome, 'ok');
  assert.equal(store.latestBatch().cards.length, 3);
  db.close();
});

test('마이그레이션 전부터 있던 실행 기록은 재시도하지 않는다(v38 기본값 = 다 씀)', () => {
  const db = createDatabase();
  db.prepare("INSERT INTO reels_runs (day, outcome, created_at) VALUES ('2026-10-03', 'failed', 1)").run();
  assert.equal(db.prepare('SELECT attempts FROM reels_runs').get().attempts, 3);
  db.close();
});

test('worker: 실패한 날은 폭주하지 않고 다음 날 새로 시도한다', async () => {
  const { db, store, clock } = setup();
  const spawn = fakeSpawn();
  let collectOk = false;
  const worker = createReelsWorker({
    store, bin: '/fake', now: () => clock.now, spawn,
    fetchImpl: (...a) => (collectOk ? fetchOk(...a) : Promise.resolve({ ok: false, status: 500 })),
  });
  await worker.tick(); // 수집 실패
  await worker.tick();
  await worker.tick();
  assert.equal(spawn.count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reels_runs').get().n, 1);

  collectOk = true;
  await worker.tick(); // 같은 날이라 여전히 안 돈다
  assert.equal(spawn.count, 0);

  clock.now = NOW + 24 * 3600;
  await worker.tick();
  assert.equal(spawn.count, 1);
  assert.equal(store.latestBatch().batchId, '2026-10-03');
  db.close();
});

test('worker: 19:00 KST 전에는 아무것도 하지 않는다', async () => {
  const { db, store } = setup();
  let touched = 0;
  const worker = createReelsWorker({
    store, bin: '/fake', now: () => NOW - 3 * 3600, // 16:00 KST
    fetchImpl: async () => { touched += 1; return { ok: false }; }, spawn: () => { touched += 1; },
  });
  await worker.tick();
  assert.equal(touched, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reels_runs').get().n, 0);
  db.close();
});

test('push payload 키는 고정이고 주제 문구를 싣지 않는다', () => {
  const payload = JSON.parse(buildReelsPushPayload({ batchId: '2026-10-02' }));
  assert.deepEqual(Object.keys(payload), REELS_PUSH_PAYLOAD_KEYS);
  assert.deepEqual(REELS_PUSH_PAYLOAD_KEYS, ['version', 'type', 'batchId', 'url']);
  assert.throws(() => buildReelsPushPayload({ batchId: 'title ' }), { code: 'REELS_PUSH_INVALID_TARGET' });
});

test('push: 열린 배치만 claim되고 결정되면 건너뛴다', () => {
  const { db, store } = setup();
  db.prepare(`INSERT INTO assistant_push_subscriptions (endpoint, p256dh, auth, status) VALUES ('https://p/1','k','a','active')`).run();
  const push = createReelsPushService(db, { now: () => NOW });
  store.claimRun('2026-10-02');
  store.saveBatch({ day: '2026-10-02', cards: CARDS, collectedAt: NOW });
  assert.equal(push.enqueueBatch('2026-10-02', NOW), 1);
  assert.equal(push.enqueueBatch('2026-10-02', NOW), 0);
  const claim = push.claim(NOW);
  assert.equal(claim.batchId, '2026-10-02');
  assert.equal(push.isClaimSendable(claim, NOW), true);
  assert.equal(push.accept(claim, 201, NOW), true);

  store.claimRun('2026-10-03');
  store.saveBatch({ day: '2026-10-03', cards: CARDS, collectedAt: NOW });
  push.enqueueBatch('2026-10-03', NOW);
  store.rejectBatch('2026-10-03');
  assert.equal(push.claim(NOW), null);
  assert.equal(db.prepare("SELECT status FROM reels_push_deliveries WHERE batch_id = '2026-10-03'").get().status, 'skipped');
  db.close();
});

function fakeApp() {
  const routes = new Map();
  return {
    get: (p, h) => routes.set(`GET ${p}`, h),
    post: (p, h) => routes.set(`POST ${p}`, h),
    routes,
    call(key, req = {}) {
      let status = 200;
      let body = null;
      const res = { status(c) { status = c; return res; }, json(v) { body = v; return res; } };
      routes.get(key)({ params: {}, ...req }, res);
      return { status, body };
    },
  };
}

test('라우트: 플래그가 꺼지면 503, 켜지면 최신 배치·선택·거절·보류가 동작한다', () => {
  const { db, store } = setup();
  const off = fakeApp();
  registerReelsRoutes({ app: off, store, config: { enabled: false } });
  assert.equal(off.call('GET /api/reels/latest').status, 503);
  assert.equal(off.call('POST /api/reels/candidates/:id/select', { params: { id: '1' } }).status, 503);

  const app = fakeApp();
  registerReelsRoutes({ app, store, config: { enabled: true } });
  assert.equal(app.call('GET /api/reels/latest').body.batch, null);
  store.claimRun('2026-10-02');
  store.saveBatch({ day: '2026-10-02', cards: CARDS, collectedAt: NOW });
  const { batch } = app.call('GET /api/reels/latest').body;
  assert.equal(app.call('POST /api/reels/candidates/:id/select', { params: { id: 'x' } }).status, 400);
  assert.equal(app.call('POST /api/reels/batches/:batchId/hold', { params: { batchId: '2026-10-02' } }).status, 200);
  assert.equal(app.call('POST /api/reels/candidates/:id/select', { params: { id: String(batch.cards[0].id) } }).status, 200);
  assert.equal(app.call('POST /api/reels/candidates/:id/select', { params: { id: String(batch.cards[1].id) } }).status, 409);
  assert.equal(app.call('POST /api/reels/batches/:batchId/reject', { params: { batchId: '2026-10-02' } }).status, 409);
  assert.equal(app.call('POST /api/reels/candidates/:id/select', { params: { id: '999' } }).status, 404);
  db.close();
});

test('서버 연결: 모든 라우트가 인증 뒤 /api/reels 아래에 있고 플래그가 꺼지면 worker가 없다', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(server.indexOf("app.use('/api/', requireApiToken)") < server.indexOf('registerReelsRoutes({'));
  const routes = fs.readFileSync(path.join(__dirname, '..', 'lib', 'reels', 'routes.js'), 'utf8');
  assert.ok([...routes.matchAll(/app\.(?:get|post)\(\s*[`']([^`']+)/g)].every(m => m[1].startsWith('/api/reels/')));
  assert.match(server, /const REELS_AGENT_ENABLED = process\.env\.REELS_AGENT_ENABLED === 'true'/);
  assert.match(server, /const reelsWorker = REELS_AGENT_ENABLED\s*\?\s*createReelsWorker/);
  assert.match(server, /const reelsPushService = REELS_AGENT_ENABLED && /);
  assert.match(fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8'), /^REELS_AGENT_ENABLED=false$/m);
});
