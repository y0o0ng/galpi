'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const { createReelsEpisodes } = require('../lib/reels/episodes');
const { createReelsUploads } = require('../lib/reels/uploads');
const { createReelsProductionWorker } = require('../lib/reels/production-worker');
const { registerReelsRoutes } = require('../lib/reels/routes');
const { createYoutubeUploader, resolvePrivacy, runNextUpload, splitCaption } = require('../lib/reels/youtube');

const T = 1_790_000_000;
const SECRET = 'sekret-client-value';
const REFRESH = 'refresh-token-value';
const ACCESS = 'access-token-value';
const credentials = { clientId: 'cid', clientSecret: SECRET, refreshToken: REFRESH };
const VIDEO = Buffer.from('0123456789');

const json = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300, status, headers: { get: k => headers[k.toLowerCase()] ?? null }, json: async () => body,
});

// 토큰 → 세션 시작 → PUT 순서로 응답을 돌려주는 가짜 fetch. script는 [{match, res}] 대신 함수 하나.
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init, body: init.body });
    const out = await handler(String(url), init, calls.length, calls);
    if (out instanceof Error) throw out;
    return out;
  };
  fn.calls = calls;
  return fn;
}

const tokenOk = () => json(200, { access_token: ACCESS, expires_in: 3600 });
function happy(extra = {}) {
  return fakeFetch(async (url, init) => {
    if (url.includes('oauth2')) return extra.token ? extra.token(url, init) : tokenOk();
    if (init.method === 'POST') return extra.start ? extra.start() : json(200, {}, { location: 'https://upload.example/session' });
    return extra.put ? extra.put(init) : json(201, { id: 'vid123' });
  });
}

const uploader = (fetch, opts = {}) => createYoutubeUploader({
  credentials, fetch, sleep: async () => {}, now: () => T, readFile: async () => VIDEO, ...opts,
});
const CAPTION = '왜 그럴까\n\n설명 한 줄\n#태그';

test('캡션 분리: 첫 줄 = 제목, 앞 빈 줄 제거, 100자 초과는 자르고 표시', () => {
  assert.deepEqual(splitCaption(CAPTION), { title: '왜 그럴까', description: '설명 한 줄\n#태그', titleTruncated: false });
  assert.deepEqual(splitCaption('한 줄뿐'), { title: '한 줄뿐', description: '', titleTruncated: false });
  const long = splitCaption(`${'가'.repeat(101)}\n설명`);
  assert.equal(long.title.length, 100);
  assert.equal(long.titleTruncated, true);
  assert.equal(splitCaption(`${'가'.repeat(100)}\n`).titleTruncated, false);
});

test('공개 범위: 허용값만, 그 밖은 private + warn', () => {
  assert.deepEqual(resolvePrivacy(undefined), { privacy: 'private', warn: false });
  assert.deepEqual(resolvePrivacy('unlisted'), { privacy: 'unlisted', warn: false });
  assert.deepEqual(resolvePrivacy('public'), { privacy: 'public', warn: false });
  assert.deepEqual(resolvePrivacy('Public!'), { privacy: 'private', warn: true });
});

test('재개 업로드 두 단계: 토큰 갱신, 세션 시작 헤더·body 필드, 파일 PUT', async () => {
  const fetch = happy();
  const result = await uploader(fetch, { privacy: 'unlisted' }).upload({ videoPath: '/x.mp4', caption: CAPTION });
  assert.deepEqual(result, { videoId: 'vid123', titleTruncated: false });
  assert.equal(fetch.calls.length, 3);

  const [token, start, put] = fetch.calls;
  assert.match(token.url, /oauth2\.googleapis\.com\/token/);
  assert.match(token.body, /grant_type=refresh_token/);

  assert.equal(start.url, 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status');
  assert.equal(start.init.method, 'POST');
  assert.equal(start.init.headers.authorization, `Bearer ${ACCESS}`);
  assert.equal(start.init.headers['content-type'], 'application/json; charset=UTF-8');
  assert.equal(start.init.headers['x-upload-content-length'], String(VIDEO.length));
  assert.equal(start.init.headers['x-upload-content-type'], 'video/mp4');
  assert.deepEqual(JSON.parse(start.body), {
    snippet: { title: '왜 그럴까', description: '설명 한 줄\n#태그', categoryId: '28' },
    status: { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false, containsSyntheticMedia: false },
  });

  assert.equal(put.url, 'https://upload.example/session');
  assert.equal(put.init.method, 'PUT');
  assert.equal(put.init.headers['content-type'], 'video/mp4');
  assert.equal(put.init.headers['content-range'], undefined);
  assert.deepEqual(Buffer.from(put.body), VIDEO);
});

test('토큰은 만료 전 재사용하고, 기본 공개 범위는 private', async () => {
  const fetch = happy();
  const up = uploader(fetch);
  await up.upload({ videoPath: '/x.mp4', caption: CAPTION });
  await up.upload({ videoPath: '/x.mp4', caption: CAPTION });
  assert.equal(fetch.calls.filter(c => c.url.includes('oauth2')).length, 1);
  assert.equal(JSON.parse(fetch.calls[1].body).status.privacyStatus, 'private');
});

test('5xx·네트워크 오류는 3번까지 재시도하고 PUT은 서버가 받은 만큼부터 이어 보낸다', async () => {
  let starts = 0;
  let puts = 0;
  const fetch = fakeFetch(async (url, init) => {
    if (url.includes('oauth2')) return tokenOk();
    if (init.method === 'POST') {
      starts += 1;
      return starts < 3 ? json(503, {}) : json(200, {}, { location: 'https://upload.example/s' });
    }
    puts += 1;
    if (puts === 1) return new TypeError('fetch failed');
    if (init.headers['content-range'] === `bytes */${VIDEO.length}`) return json(308, {}, { range: 'bytes=0-3' });
    assert.equal(init.headers['content-range'], `bytes 4-9/10`);
    assert.deepEqual(Buffer.from(init.body), VIDEO.subarray(4));
    return json(201, { id: 'resumed' });
  });
  assert.equal((await uploader(fetch).upload({ videoPath: '/x.mp4', caption: CAPTION })).videoId, 'resumed');
  assert.equal(starts, 3);
});

test('재시도는 3번에서 멈추고(총 4회), 4xx는 즉시 실패', async () => {
  const always503 = happy({ start: () => json(503, {}) });
  await assert.rejects(uploader(always503).upload({ videoPath: '/x', caption: CAPTION }), { code: 'REELS_YT_HTTP_503' });
  assert.equal(always503.calls.filter(c => c.init.method === 'POST' && !c.url.includes('oauth2')).length, 4);

  const forbidden = happy({ start: () => json(403, { error: { errors: [{ reason: 'quotaExceeded' }], message: `leak ${SECRET}` } }) });
  await assert.rejects(uploader(forbidden).upload({ videoPath: '/x', caption: CAPTION }), error => {
    assert.equal(error.code, 'REELS_YT_HTTP_403');
    assert.equal(error.detail, 'HTTP 403 quotaExceeded');
    return true;
  });
  assert.equal(forbidden.calls.length, 2); // 토큰 + 시작 한 번
});

test('오류 문구·detail에 토큰과 비밀값이 없다', async () => {
  const badToken = happy({ token: () => json(400, { error: 'invalid_grant', error_description: `${REFRESH} ${SECRET}` }) });
  await assert.rejects(uploader(badToken).upload({ videoPath: '/x', caption: CAPTION }), error => {
    assert.equal(error.code, 'REELS_YT_AUTH');
    const text = JSON.stringify({ m: error.message, d: error.detail, c: error.code });
    for (const secret of [SECRET, REFRESH, ACCESS]) assert.equal(text.includes(secret), false);
    return true;
  });
  const net = happy({ put: () => new Error(`net ${ACCESS}`) });
  await assert.rejects(uploader(net).upload({ videoPath: '/x', caption: CAPTION }), error => {
    assert.equal(JSON.stringify({ m: error.message, d: error.detail }).includes(ACCESS), false);
    return true;
  });
});

// ── 저장소·워커·라우트 ───────────────────────────────────────────────────────

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
  const episodes = createReelsEpisodes(db, { now: () => clock.now });
  const uploads = createReelsUploads(db, { now: () => clock.now });
  return { db, clock, episodes, uploads };
}

// 후보 position은 1~3이라 한 DB에 편은 셋까지.
function readyEpisode(ctx, n = 1) {
  const c = ctx.db.prepare(`INSERT INTO reels_candidates (batch_id, position, title, source_url, published_at, collected_at, why, concept, bridge, template,
    hook_paradox, hook_term, hook_subtitle, risk, status, created_at) VALUES ('2026-10-03', ?, 't', 'https://e.com', '2026-10-01', ?, 'w', 'c', 'b', '단계',
    'p', 't', 's', 'r', 'selected', ?)`).run(n, T, T).lastInsertRowid;
  const id = ctx.db.prepare(`INSERT INTO reels_episodes (candidate_id, episode_dir, work_dir, status, caption, video_path, created_at)
    VALUES (?, 'ep01_px', '/w', 'ready', ?, '/m/a.mp4', ?)`).run(c, CAPTION, T).lastInsertRowid;
  return Number(id);
}

test('저장소: pending → uploading → done, 한 번에 하나, 실패 재시도는 1시간 뒤 최대 3번', () => {
  const ctx = setup();
  const a = readyEpisode(ctx, 1);
  const b = readyEpisode(ctx, 2);
  assert.equal(ctx.uploads.enqueue(a, 'youtube'), true);
  assert.equal(ctx.uploads.enqueue(a, 'youtube'), false); // 이미 있으면 그대로
  ctx.uploads.enqueue(b, 'youtube');

  const first = ctx.uploads.claim();
  assert.equal(first.episode_id, a);
  assert.equal(first.status, 'uploading');
  assert.equal(first.attempts, 1);
  assert.equal(ctx.uploads.claim(), null); // 하나씩
  assert.equal(ctx.uploads.finishFailed(first.id, 'REELS_YT_HTTP_503', 'HTTP 503'), true);

  assert.equal(ctx.uploads.claim().episode_id, b); // pending이 먼저
  ctx.uploads.finishOk(ctx.uploads.get(b, 'youtube').id, 'abc');
  assert.equal(ctx.uploads.get(b, 'youtube').status, 'done');

  assert.equal(ctx.uploads.claim(), null); // 1시간 전
  ctx.clock.now += 3600;
  for (let n = 2; n <= 3; n++) {
    const again = ctx.uploads.claim();
    assert.equal(again.attempts, n);
    ctx.uploads.finishFailed(again.id, 'X');
    ctx.clock.now += 3600;
  }
  assert.equal(ctx.uploads.claim(), null); // 3번 뒤 멈춘다
  assert.equal(ctx.uploads.get(a, 'youtube').attempts, 3);
  ctx.db.close();
});

test('runNextUpload·워커: 성공은 done+remote_id, 실패는 failed+code, 토큰은 DB에 없다', async () => {
  const ctx = setup();
  const id = readyEpisode(ctx);
  ctx.uploads.enqueue(id, 'youtube');
  const ok = { upload: async ({ videoPath, caption }) => { assert.equal(videoPath, '/m/a.mp4'); assert.equal(caption, CAPTION); return { videoId: 'v1' }; } };
  const worker = createReelsProductionWorker({ episodes: ctx.episodes, uploads: ctx.uploads, uploader: ok, reelsDir: '/r', bin: 'claude', now: () => ctx.clock.now });
  await worker.tickUpload();
  assert.deepEqual(
    (({ status, remote_id, attempts }) => ({ status, remote_id, attempts }))(ctx.uploads.get(id, 'youtube')),
    { status: 'done', remote_id: 'v1', attempts: 1 },
  );

  const id2 = readyEpisode(ctx, 2);
  ctx.uploads.enqueue(id2, 'youtube');
  const bad = { upload: async () => { throw Object.assign(new Error(`m ${ACCESS}`), { code: 'REELS_YT_HTTP_403', detail: 'HTTP 403' }); } };
  const seen = [];
  await runNextUpload({ uploads: ctx.uploads, episodes: ctx.episodes, uploader: bad, onError: e => seen.push(e.code) });
  const row = ctx.uploads.get(id2, 'youtube');
  assert.deepEqual([row.status, row.error_code, row.error_detail], ['failed', 'REELS_YT_HTTP_403', 'HTTP 403']);
  assert.equal(JSON.stringify(ctx.db.prepare('SELECT * FROM reels_uploads').all()).includes(ACCESS), false);
  assert.deepEqual(seen, ['REELS_YT_HTTP_403']);

  // 서버가 꺼지며 끊긴 uploading은 failed로.
  const id3 = readyEpisode(ctx, 3);
  ctx.uploads.enqueue(id3, 'youtube');
  ctx.uploads.claim(id3);
  assert.equal(ctx.uploads.markInterrupted(), 1);
  assert.equal(ctx.uploads.get(id3, 'youtube').error_code, 'REELS_INTERRUPTED');
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
      const res = { headersSent: false, status(c) { status = c; return res; }, json(v) { body = v; return res; } };
      routes.get(key)({ params: {}, ...req }, res);
      return { status, body };
    },
  };
}

test('승인 → pending(플래그 꺼짐이면 없음), retry 라우트 404/409/200, latest의 uploads 모양', () => {
  const run = youtubeUploadEnabled => {
    const ctx = setup();
    const app = fakeApp();
    let woke = 0;
    registerReelsRoutes({
      app, store: { latestBatch() {} }, episodes: ctx.episodes, uploads: ctx.uploads, onUpload: () => { woke += 1; },
      config: { enabled: true, productionEnabled: true, youtubeUploadEnabled, reelsDir: '/r' },
    });
    return { ctx, app, woke: () => woke };
  };
  const post = (app, action, id) => app.call(`POST /api/reels/episodes/:id/${action}`, { params: { id: String(id) } });

  const off = run(false);
  const offId = readyEpisode(off.ctx);
  assert.equal(post(off.app, 'approve', offId).status, 200);
  assert.deepEqual(off.ctx.uploads.list(offId), []);
  assert.deepEqual(off.app.call('GET /api/reels/episodes/latest').body.episode.uploads, []);
  off.ctx.db.close();

  const { ctx, app, woke } = run(true);
  const id = readyEpisode(ctx);
  assert.equal(post(app, 'uploads/youtube/retry', id).status, 404); // 업로드 행 없음
  assert.equal(post(app, 'uploads/youtube/retry', 999).status, 404);
  assert.equal(post(app, 'approve', id).status, 200);
  assert.equal(ctx.uploads.get(id, 'youtube').status, 'pending');
  assert.equal(woke(), 1);
  assert.equal(post(app, 'uploads/youtube/retry', id).status, 409); // failed가 아님

  const row = ctx.uploads.claim();
  ctx.uploads.finishFailed(row.id, 'REELS_YT_HTTP_403', 'HTTP 403');
  assert.deepEqual(app.call('GET /api/reels/episodes/latest').body.episode.uploads, [{
    platform: 'youtube', status: 'failed', attempts: 1, remoteUrl: null, errorCode: 'REELS_YT_HTTP_403', errorDetail: 'HTTP 403',
  }]);
  assert.equal(post(app, 'uploads/youtube/retry', id).status, 200);
  assert.equal(ctx.uploads.get(id, 'youtube').status, 'pending');
  assert.equal(ctx.uploads.get(id, 'youtube').attempts, 0);

  const again = ctx.uploads.claim();
  ctx.uploads.finishOk(again.id, 'xyz');
  const shown = app.call('GET /api/reels/episodes/latest').body.episode.uploads[0];
  assert.equal(shown.remoteUrl, 'https://youtu.be/xyz');
  assert.equal(JSON.stringify(shown).includes('/m/a.mp4'), false);
  ctx.db.close();
});

test('서버 연결·화면 계약: 플래그 기본 false, .env.example 이름만, 카드는 textContent', () => {
  const root = path.join(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /const REELS_YOUTUBE_UPLOAD_ENABLED = process\.env\.REELS_YOUTUBE_UPLOAD_ENABLED === 'true'/);
  const env = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  assert.match(env, /^REELS_YOUTUBE_UPLOAD_ENABLED=false$/m);
  assert.match(env, /^REELS_YOUTUBE_PRIVACY=private$/m);
  for (const name of ['CLIENT_ID', 'CLIENT_SECRET', 'REFRESH_TOKEN']) assert.match(env, new RegExp(`^REELS_YOUTUBE_${name}=$`, 'm'));

  const panel = fs.readFileSync(path.join(root, 'public/agent-panel.js'), 'utf8');
  const lines = panel.slice(panel.indexOf('function reelsUploadLines'), panel.indexOf('function makeReelsEpisodeCard'));
  assert.doesNotMatch(lines, /innerHTML/);
  assert.match(lines, /label\.textContent/);
  assert.match(lines, /\^https:\\\/\\\/youtu\\\.be\\\//); // 링크는 youtu.be 주소만
  assert.match(lines, /uploads\/\$\{upload\.platform\}\/retry/);
  assert.match(panel, /episode\.status === 'approved'\) body\.append\(\.\.\.reelsUploadLines/);
});
