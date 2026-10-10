'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const { createReelsStore } = require('../lib/reels/store');
const { createReelsEpisodes } = require('../lib/reels/episodes');
const { createReelsProductionWorker } = require('../lib/reels/production-worker');
const {
  REELS_EPISODE_PUSH_PAYLOAD_KEYS, buildReelsPushPayload, createReelsPushService,
} = require('../lib/reels/push');
const { registerReelsRoutes } = require('../lib/reels/routes');
const { createAssistantPushDispatcher } = require('../lib/assistant-push');

const T = Date.parse('2026-10-04T04:00:00+09:00') / 1000; // 04:00 KST
const HOUR = 3600;

function setup() {
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
  const clock = { now: T };
  const reelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reels-pw-'));
  fs.mkdirSync(path.join(reelsDir, 'episodes', 'ep03_x_px'), { recursive: true });
  fs.mkdirSync(path.join(reelsDir, 'media'));
  const store = createReelsStore(db, { now: () => clock.now });
  const episodes = createReelsEpisodes(db, { now: () => clock.now });
  return { db, store, episodes, clock, reelsDir };
}

// 후보를 하나 만들어 selected로 둔다.
function selectCandidate(store, day = '2026-10-03') {
  store.claimRun(day);
  const card = n => ({
    title: `t${n}`, url: `https://e.com/${n}`, published_at: '2026-10-01', why: 'w', concept: `c${n}`, bridge: 'b',
    template: '단계', hook_paradox: 'p', hook_term: 't', hook_subtitle: 's', risk: 'r', everyday_door: 'e',
  });
  store.saveBatch({ day, cards: [1, 2, 3].map(card), collectedAt: T });
  const cards = store.latestBatch().cards;
  store.selectCard(cards[0].id);
  return cards[0].id;
}

// 성공이면 결과 파일을 놓고 record를 돌려주는 가짜 러너. 실패는 마지막 단계 한 곳에서 난다.
function fakeProduce({ fail = null } = {}) {
  const produce = async ({ reelsDir, workDir, episodeDir, from, signal }) => {
    produce.calls.push({ workDir, episodeDir, from, signal });
    const num = /^ep(\d+)_/.exec(episodeDir)[1];
    if (fail) {
      return {
        outcome: 'failed',
        stages: [{ stage: 'script', result: 'ok' }, { stage: 'review', result: 'ok' },
          { stage: 'build', result: 'failed', code: fail, reason: 'boom' }],
      };
    }
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, 'caption.txt'), '훅\n설명\n');
    fs.writeFileSync(path.join(workDir, 'final.md'), 'x');
    fs.writeFileSync(path.join(reelsDir, 'media', `ep${num}_px_preview.mp4`), 'mp4');
    fs.writeFileSync(path.join(reelsDir, 'media', `ep${num}_px_preview_cover.png`), 'png');
    return { outcome: 'ok', stages: ['script', 'review', 'build', 'visual', 'fix'].map(stage => ({ stage, result: 'ok' })) };
  };
  produce.calls = [];
  return produce;
}

function worker(ctx, extra = {}) {
  return createReelsProductionWorker({
    episodes: ctx.episodes, reelsDir: ctx.reelsDir, bin: '/fake', now: () => ctx.clock.now,
    produce: fakeProduce(), claims: async () => [{ row: '1', found: true }], ...extra,
  });
}

const subscribe = db => db.prepare(
  "INSERT INTO assistant_push_subscriptions (endpoint, p256dh, auth, status) VALUES ('https://p/1','k','a','active')",
).run();

test('창(04:00~07:00 KST) 밖에서는 아무것도 하지 않는다', async () => {
  const ctx = setup();
  selectCandidate(ctx.store);
  const produce = fakeProduce();
  ctx.clock.now = T - 1;
  await worker(ctx, { produce }).tick();
  ctx.clock.now = T + 3 * HOUR; // 07:00 KST — 끝은 포함하지 않는다
  await worker(ctx, { produce }).tick();
  assert.equal(produce.calls.length, 0);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM reels_episodes').get().n, 0);
  ctx.clock.now = T;
  await worker(ctx, { produce }).tick();
  assert.equal(produce.calls.length, 1);
  ctx.db.close();
});

test('선택된 후보가 없으면 건너뛴다', async () => {
  const ctx = setup();
  const produce = fakeProduce();
  await worker(ctx, { produce }).tick();
  assert.equal(produce.calls.length, 0);
  ctx.db.close();
});

test('선택 후보 → producing → ready, 기록·캡션·경로·claims가 저장되고 검토 2 push가 한 번 걸린다', async () => {
  const ctx = setup();
  subscribe(ctx.db);
  const candidateId = selectCandidate(ctx.store);
  const push = createReelsPushService(ctx.db, { now: () => ctx.clock.now });
  let dispatched = 0;
  const produce = fakeProduce();
  const seen = [];
  const w = worker(ctx, {
    produce, pushService: push, pushDispatcher: { tick() { dispatched += 1; } },
    claims: async () => { seen.push(ctx.episodes.latestEpisode().status); return [{ row: '1', found: true }]; },
  });
  await w.tick();
  const row = ctx.episodes.latestEpisode();
  assert.equal(row.candidate_id, candidateId);
  assert.deepEqual(seen, ['producing']);
  assert.equal(row.status, 'ready');
  assert.equal(row.episode_dir, `ep04_c${candidateId}_px`);
  assert.equal(produce.calls[0].from, 'script');
  assert.equal(row.attempts, 1);
  assert.equal(row.caption, '훅\n설명\n');
  assert.equal(row.video_path, path.join(ctx.reelsDir, 'media', 'ep04_px_preview.mp4'));
  assert.equal(row.cover_path, path.join(ctx.reelsDir, 'media', 'ep04_px_preview_cover.png'));
  assert.deepEqual(JSON.parse(row.claims_json), [{ row: '1', found: true }]);
  assert.equal(JSON.parse(row.record_json).outcome, 'ok');
  assert.equal(dispatched, 1);
  assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM reels_push_deliveries WHERE kind = 'episode'").get().n, 1);
  await w.tick(); // 편이 이미 있어 다시 만들지 않는다
  assert.equal(produce.calls.length, 1);
  assert.equal(push.enqueueEpisode(row.id, ctx.clock.now), 0); // 같은 편은 한 번만
  ctx.db.close();
});

test('push: 조용한 시간이면 미뤄지고, payload 키는 고정이며, 검토 전까지만 보낸다', async () => {
  const ctx = setup();
  subscribe(ctx.db);
  selectCandidate(ctx.store);
  ctx.clock.now = T + HOUR + 30 * 60; // 05:30 KST — 조용한 시간(23:00~07:00)
  const push = createReelsPushService(ctx.db, { now: () => ctx.clock.now });
  await worker(ctx, { pushService: push }).tick();
  const delivery = ctx.db.prepare('SELECT next_attempt_at AS at, kind FROM reels_push_deliveries').get();
  assert.equal(delivery.kind, 'episode');
  assert.equal(delivery.at, T + 3 * HOUR); // 07:00 KST
  assert.equal(push.claim(ctx.clock.now), null);

  ctx.clock.now = T + 3 * HOUR;
  const sent = [];
  const dispatcher = createAssistantPushDispatcher(push, {
    now: () => ctx.clock.now,
    transport: { async send(_target, payload) { sent.push(JSON.parse(payload)); return { statusCode: 201 }; } },
    buildPayload: buildReelsPushPayload,
  });
  await dispatcher.tick();
  assert.equal(sent.length, 1);
  assert.deepEqual(Object.keys(sent[0]), REELS_EPISODE_PUSH_PAYLOAD_KEYS);
  assert.equal(sent[0].type, 'reels_episode');
  assert.equal(sent[0].url, '/?panel=agents');
  assert.throws(() => buildReelsPushPayload({ kind: 'episode', batchId: 'title' }), { code: 'REELS_PUSH_INVALID_TARGET' });

  // 결정이 난 편은 아직 안 나간 알림도 건너뛴다.
  const second = ctx.episodes.latestEpisode();
  ctx.db.prepare("UPDATE reels_episodes SET status = 'discarded' WHERE id = ?").run(second.id);
  push.enqueueEpisode(second.id + 100, ctx.clock.now);
  assert.equal(push.claim(ctx.clock.now), null);
  ctx.db.close();
});

test('실패 → failed, 1시간 뒤 실패한 단계부터 재시도, 3번이 한도', async () => {
  const ctx = setup();
  selectCandidate(ctx.store);
  const produce = fakeProduce({ fail: 'REELS_NO_MP4' });
  const w = worker(ctx, { produce });
  await w.tick();
  let row = ctx.episodes.latestEpisode();
  assert.deepEqual([row.status, row.attempts, row.error_code, row.error_detail], ['failed', 1, 'REELS_NO_MP4', 'boom']);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM reels_push_deliveries').get().n, 0);

  ctx.clock.now += HOUR - 1;
  await w.tick();
  assert.equal(produce.calls.length, 1); // 1시간 전
  ctx.clock.now += 1;
  await w.tick();
  assert.equal(produce.calls.length, 2);
  assert.equal(produce.calls[1].from, 'build');
  assert.equal(produce.calls[1].workDir, produce.calls[0].workDir);
  assert.equal(produce.calls[1].episodeDir, produce.calls[0].episodeDir);
  ctx.clock.now += HOUR;
  await w.tick();
  row = ctx.episodes.latestEpisode();
  assert.equal(row.attempts, 3);
  ctx.clock.now += HOUR;
  await w.tick();
  assert.equal(produce.calls.length, 3); // 3번을 다 썼다
  ctx.db.close();
});

test('재시도는 새 선택 후보보다 뒤이고, 번호는 DB에 잡힌 편과 겹치지 않는다', async () => {
  const ctx = setup();
  selectCandidate(ctx.store, '2026-10-02');
  const produce = fakeProduce({ fail: 'REELS_NO_MP4' });
  const w = worker(ctx, { produce });
  await w.tick();                         // ep04 실패(폴더는 아직 없다)
  const second = selectCandidate(ctx.store, '2026-10-03');
  ctx.clock.now += HOUR;
  await w.tick();                         // 새 후보가 먼저다
  assert.equal(produce.calls[1].from, 'script');
  assert.equal(produce.calls[1].episodeDir, `ep05_c${second}_px`);
  ctx.db.close();
});

test('기동 때 producing은 failed(REELS_INTERRUPTED)가 되고 끊긴 단계부터 다시 돈다', async () => {
  const ctx = setup();
  selectCandidate(ctx.store);
  const claim = ctx.episodes.claimProduction((card) => ({ episodeDir: `ep04_c${card.id}_px`, workDir: path.join(ctx.reelsDir, 'work', 'w') }), T);
  fs.mkdirSync(claim.episode.work_dir, { recursive: true });
  fs.writeFileSync(path.join(claim.episode.work_dir, 'production.json'), JSON.stringify({
    outcome: 'running', stages: [{ stage: 'script', result: 'ok' }, { stage: 'review', result: 'ok' }, { stage: 'build' }],
  }));
  const produce = fakeProduce();
  const w = worker(ctx, { produce });
  ctx.clock.now = T - HOUR; // 창 밖 — start()가 tick을 불러도 아무것도 안 한다
  w.start();
  w.stop();
  await w.tick(); // start()가 건 tick이 끝나길 기다린다
  const row = ctx.episodes.latestEpisode();
  assert.deepEqual([row.status, row.attempts, row.error_code], ['failed', 1, 'REELS_INTERRUPTED']);
  ctx.clock.now = T + HOUR;
  await w.tick();
  assert.equal(produce.calls[0].from, 'build');
  assert.equal(ctx.episodes.latestEpisode().attempts, 2);
  ctx.db.close();
});

test('동시에 둘이 돌지 않는다', async () => {
  const ctx = setup();
  selectCandidate(ctx.store, '2026-10-02');
  selectCandidate(ctx.store, '2026-10-03');
  const plan = card => ({ episodeDir: `ep0${card.id}_c${card.id}_px`, workDir: `/w/${card.id}` });
  assert.ok(ctx.episodes.claimProduction(plan, T));
  assert.equal(ctx.episodes.claimProduction(plan, T), null);
  ctx.db.close();
});

test('stop()은 돌고 있는 러너에 중단 신호를 보낸다', async () => {
  const ctx = setup();
  selectCandidate(ctx.store);
  let signal;
  const produce = ({ signal: s }) => new Promise(resolve => {
    signal = s;
    s.addEventListener('abort', () => resolve({
      outcome: 'failed', stages: [{ stage: 'script', result: 'failed', code: 'REELS_ABORTED', reason: '제작이 중단됐습니다.' }],
    }));
  });
  const w = worker(ctx, { produce });
  const pending = w.tick();
  w.stop();
  await pending;
  assert.equal(signal.aborted, true);
  const row = ctx.episodes.latestEpisode();
  assert.deepEqual([row.status, row.error_code], ['failed', 'REELS_ABORTED']);
  ctx.db.close();
});

function fakeApp() {
  const routes = new Map();
  return {
    get: (p, h) => routes.set(`GET ${p}`, h),
    post: (p, h) => routes.set(`POST ${p}`, h),
    call(key, req = {}) {
      let status = 200;
      let body = null;
      let sent = null;
      const res = {
        headersSent: false,
        status(c) { status = c; return res; },
        json(v) { body = v; return res; },
        sendFile(file, cb) { sent = file; if (!fs.existsSync(file)) cb(new Error('ENOENT')); },
      };
      routes.get(key)({ params: {}, ...req }, res);
      return { status, body, sent };
    },
  };
}

async function readyEpisode(ctx) {
  selectCandidate(ctx.store);
  await worker(ctx).tick();
  return ctx.episodes.latestEpisode();
}

test('라우트: 플래그 503, latest는 경로 대신 URL, approve/discard는 ready에서만(409)', async () => {
  const ctx = setup();
  const off = fakeApp();
  registerReelsRoutes({ app: off, store: ctx.store, episodes: ctx.episodes, config: { enabled: true, productionEnabled: false, reelsDir: ctx.reelsDir } });
  assert.equal(off.call('GET /api/reels/episodes/latest').status, 503);

  const app = fakeApp();
  registerReelsRoutes({ app, store: ctx.store, episodes: ctx.episodes, config: { enabled: true, productionEnabled: true, reelsDir: ctx.reelsDir } });
  assert.equal(app.call('GET /api/reels/episodes/latest').body.episode, null);
  const row = await readyEpisode(ctx);
  const { episode } = app.call('GET /api/reels/episodes/latest').body;
  assert.equal(episode.batchId, '2026-10-03');
  assert.equal(episode.status, 'ready');
  assert.equal(episode.videoUrl, `/api/reels/episodes/${row.id}/video`);
  assert.equal(episode.title, 't1');
  assert.deepEqual(episode.claims, [{ row: '1', found: true }]);
  assert.equal(JSON.stringify(episode).includes(ctx.reelsDir), false);

  const act = (action, id) => app.call(`POST /api/reels/episodes/:id/${action}`, { params: { id: String(id) } });
  assert.equal(act('approve', 'x').status, 400);
  assert.equal(act('approve', 999).status, 404);
  assert.equal(act('approve', row.id).status, 200);
  assert.equal(ctx.episodes.getEpisode(row.id).status, 'approved');
  assert.ok(ctx.episodes.getEpisode(row.id).decided_at);
  assert.equal(act('discard', row.id).status, 409);
  assert.equal(act('approve', row.id).status, 409);
  ctx.db.close();
});

test('라우트: 영상·표지는 reelsDir/media 안의 파일만, 밖이면 404', async () => {
  const ctx = setup();
  const app = fakeApp();
  registerReelsRoutes({ app, store: ctx.store, episodes: ctx.episodes, config: { enabled: true, productionEnabled: true, reelsDir: ctx.reelsDir } });
  const row = await readyEpisode(ctx);
  const get = (kind, id = row.id) => app.call(`GET /api/reels/episodes/:id/${kind}`, { params: { id: String(id) } });
  assert.equal(get('video').sent, row.video_path);
  assert.equal(get('cover').sent, row.cover_path);
  assert.equal(get('video', 999).status, 404);
  for (const bad of [path.join(ctx.reelsDir, 'media', '..', 'secret.txt'), path.join(ctx.reelsDir, 'mediax', 'a.mp4'), '/etc/passwd']) {
    ctx.db.prepare('UPDATE reels_episodes SET video_path = ? WHERE id = ?').run(bad, row.id);
    assert.equal(get('video').status, 404, bad);
  }
  ctx.db.prepare('UPDATE reels_episodes SET video_path = ? WHERE id = ?').run(path.join(ctx.reelsDir, 'media', 'gone.mp4'), row.id);
  assert.equal(get('video').status, 404); // 파일이 없으면 sendFile 오류로 404
  ctx.db.close();
});

test('서버 연결: 제작 worker는 별도 플래그이고 .env.example은 false', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /const REELS_PRODUCTION_ENABLED = process\.env\.REELS_PRODUCTION_ENABLED === 'true'/);
  assert.match(server, /const reelsProductionWorker = REELS_PRODUCTION_ENABLED\s*\?\s*createReelsProductionWorker/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8'), /^REELS_PRODUCTION_ENABLED=false$/m);
});

const VENV_PY = path.join(__dirname, '..', 'reels', '.venv', 'bin', 'python');
test('factcheck --json: 인용마다 한 줄, 텍스트는 stderr, 옵션 없을 때 출력 불변', { skip: !fs.existsSync(VENV_PY) }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reels-fc-'));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'The quick brown fox jumps over the lazy dog.');
  fs.writeFileSync(path.join(dir, 's.md'), [
    '## 사실 확인 목록', '- **[A]** 출처, https://e.com/a', '',
    '| # | 주장 | 출처 | 원문 인용 |', '| --- | --- | --- | --- |',
    '| 1 | 기어가 100배 | [A] | "the quick brown fox jumps over the lazy dog" |',
    '| 2 | 일반 원리 | 직접 확인 | - |',
    '| 3 | 없는 말 | https://e.com/a | "this sentence is absent from the source text" |', '',
  ].join('\n'));
  const run = flags => {
    try {
      return { out: execFileSync(VENV_PY, [path.join(__dirname, '..', 'reels', 'factcheck.py'), path.join(dir, 's.md'), ...flags,
        `https://e.com/a=${path.join(dir, 'a.txt')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }), code: 0 };
    } catch (error) { return { out: error.stdout, code: error.status }; }
  };
  const json = run(['--json']);
  assert.equal(json.code, 1);
  assert.deepEqual(JSON.parse(json.out).map(e => [e.row, e.claim, e.source, e.url, e.found]), [
    ['1', '기어가 100배', '[A]', 'https://e.com/a', true],
    ['2', '일반 원리', '직접 확인', null, null],
    ['3', '없는 말', 'https://e.com/a', 'https://e.com/a', false],
  ]);
  assert.equal(JSON.parse(json.out)[0].quote, 'the quick brown fox jumps over the lazy dog');
  const text = run([]);
  assert.equal(text.code, 1);
  assert.match(text.out, /^OK   1 /m);
  assert.match(text.out, /3 rows, 1 missing/);
});

// ---- 사람 의견 → 바로 수정 ----

function fakeRevise({ fail = null } = {}) {
  const revise = async args => {
    revise.calls.push(args);
    if (fail) return { outcome: 'failed', stages: [{ stage: 'fix', result: 'failed', code: fail, reason: '고치지 못함' }] };
    return { outcome: 'ok', stages: [{ stage: 'fix', result: 'ok' }, { stage: 'visual', result: 'ok' }] };
  };
  revise.calls = [];
  return revise;
}

function reviseApp(ctx, onRevise) {
  const app = fakeApp();
  registerReelsRoutes({ app, store: ctx.store, episodes: ctx.episodes, onRevise, config: { enabled: true, productionEnabled: true, reelsDir: ctx.reelsDir } });
  return (id, note) => app.call('POST /api/reels/episodes/:id/revise', { params: { id: String(id) }, body: { note } });
}

test('revise 검증: 빈 의견·1000자 초과 400, ready 아님 409, 다른 편 producing이면 REELS_BUSY', async () => {
  const ctx = setup();
  const revise = reviseApp(ctx);
  assert.equal(revise(1, 'x').status, 404);
  const row = await readyEpisode(ctx);
  assert.equal(revise(row.id, '   ').body.code, 'REELS_NOTE_INVALID');
  assert.equal(revise(row.id, '가'.repeat(1001)).status, 400);
  assert.equal(revise(row.id, undefined).status, 400);
  assert.equal(revise('x', '의견').status, 400);

  selectCandidate(ctx.store, '2026-10-04');
  ctx.episodes.claimProduction(card => ({ episodeDir: `ep09_c${card.id}_px`, workDir: path.join(ctx.reelsDir, 'work', 'other') }), T);
  const busy = revise(row.id, '자막이 작아요');
  assert.deepEqual([busy.status, busy.body.code], [409, 'REELS_BUSY']);
  assert.equal(ctx.episodes.getEpisode(row.id).status, 'ready');

  ctx.db.prepare("UPDATE reels_episodes SET status = 'approved' WHERE id = ?").run(row.id);
  assert.equal(revise(row.id, '의견').body.code, 'REELS_NOT_PENDING');
  ctx.db.close();
});

test('수정 성공: 창 밖(낮)에도 돌고 ready + revisions 1건 + push 1건, 두 번째 수정이면 push가 또 1건', async () => {
  const ctx = setup();
  subscribe(ctx.db);
  const push = createReelsPushService(ctx.db, { now: () => ctx.clock.now });
  const revise = fakeRevise();
  const w = worker(ctx, { revise, pushService: push });
  const row = await readyEpisode(ctx);
  const episodeDeliveries = () => ctx.db.prepare("SELECT COUNT(*) AS n FROM reels_push_deliveries WHERE kind = 'episode'").get().n;
  assert.equal(episodeDeliveries(), 0); // readyEpisode의 worker에는 push가 없다

  ctx.clock.now = T + 8 * HOUR; // 12:00 KST — 제작 창 밖
  let woke = 0;
  const api = reviseApp(ctx, () => { woke += 1; });
  const res = api(row.id, '  제목 자막이 작아요  ');
  assert.deepEqual([res.status, res.body], [200, { id: row.id, status: 'revising' }]);
  assert.equal(woke, 1);
  const app = fakeApp();
  registerReelsRoutes({ app, store: ctx.store, episodes: ctx.episodes, config: { enabled: true, productionEnabled: true, reelsDir: ctx.reelsDir } });
  let ep = app.call('GET /api/reels/episodes/latest').body.episode;
  assert.deepEqual([ep.status, ep.revisionNote, ep.revisions], ['revising', '제목 자막이 작아요', []]);
  assert.ok(ep.videoUrl);

  await w.tick();
  assert.equal(revise.calls.length, 1);
  assert.equal(revise.calls[0].note, '제목 자막이 작아요');
  assert.equal(revise.calls[0].n, 1);
  ep = app.call('GET /api/reels/episodes/latest').body.episode;
  assert.deepEqual([ep.status, ep.revisionNote], ['ready', null]);
  assert.deepEqual(ep.revisions.map(r => [r.note, r.outcome, r.at]), [['제목 자막이 작아요', 'ok', T + 8 * HOUR]]);
  assert.equal(episodeDeliveries(), 1);

  api(row.id, '배경이 어두워요');
  await w.tick();
  assert.equal(revise.calls[1].n, 2);
  assert.equal(app.call('GET /api/reels/episodes/latest').body.episode.revisions.length, 2);
  assert.equal(episodeDeliveries(), 2);
  assert.deepEqual(ctx.db.prepare("SELECT batch_id FROM reels_push_deliveries ORDER BY id").all().map(r => r.batch_id), [`${row.id}-r1`, `${row.id}-r2`]);

  // payload는 revision 키에서도 편 id를 숫자로 보낸다.
  assert.equal(JSON.parse(buildReelsPushPayload({ kind: 'episode', batchId: `${row.id}-r2` })).episodeId, row.id);
  assert.equal(push.claim(ctx.clock.now).kind, 'episode'); // ready라 아직 보낼 가치가 있다
  ctx.db.close();
});

test('수정 실패: ready로 돌아오고 outcome failed가 기록되며 영상 경로·캡션은 그대로다', async () => {
  const ctx = setup();
  const row = await readyEpisode(ctx);
  reviseApp(ctx)(row.id, '장면 2를 고쳐요');
  await worker(ctx, { revise: fakeRevise({ fail: 'REELS_NO_MP4' }) }).tick();
  const after = ctx.episodes.getEpisode(row.id);
  assert.equal(after.status, 'ready');
  assert.equal(after.revision_note, null);
  assert.equal(after.video_path, row.video_path);
  assert.equal(after.caption, row.caption);
  assert.deepEqual(JSON.parse(after.revisions_json).map(({ at, ...rest }) => rest), [
    { note: '장면 2를 고쳐요', outcome: 'failed', errorCode: 'REELS_NO_MP4', errorDetail: '고치지 못함' },
  ]);
  // 러너가 던져도 마찬가지다.
  reviseApp(ctx)(row.id, '다시');
  await worker(ctx, { revise: async () => { throw Object.assign(new Error('x'), { code: 'REELS_CLAUDE_EXIT' }); } }).tick();
  assert.equal(ctx.episodes.getEpisode(row.id).status, 'ready');
  assert.equal(JSON.parse(ctx.episodes.getEpisode(row.id).revisions_json)[1].errorCode, 'REELS_CLAUDE_EXIT');
  ctx.db.close();
});

test('수정 중 기동: failed가 아니라 ready + REELS_INTERRUPTED 수정 기록', async () => {
  const ctx = setup();
  const row = await readyEpisode(ctx);
  reviseApp(ctx)(row.id, '의견');
  const revise = fakeRevise();
  const w = worker(ctx, { revise });
  w.start(); // markInterrupted가 먼저 돌아 수정이 끊긴 것으로 처리된다
  w.stop();
  await w.tick();
  const after = ctx.episodes.getEpisode(row.id);
  assert.equal(after.status, 'ready');
  assert.equal(after.attempts, 1);
  assert.equal(revise.calls.length, 0);
  assert.deepEqual(JSON.parse(after.revisions_json).map(r => [r.outcome, r.errorCode]), [['failed', 'REELS_INTERRUPTED']]);
  ctx.db.close();
});
