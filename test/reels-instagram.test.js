'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const { createReelsEpisodes } = require('../lib/reels/episodes');
const { createReelsUploads } = require('../lib/reels/uploads');
const { createReelsProductionWorker } = require('../lib/reels/production-worker');
const { registerReelsRoutes } = require('../lib/reels/routes');
const { API_VERSION, checkCaption, createInstagramUploader, createTokenStore, runNextInstagramUpload } = require('../lib/reels/instagram');

const T = 1_790_000_000;
const TOKEN = 'ig-secret-token-value';
const ENV_TOKEN = 'env-token-value';
const BASE = 'https://pi.example.ts.net:8443';
const CAPTION = '왜 그럴까\n\n설명 한 줄\n#태그';

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-test-'));
  const video = path.join(dir, 'a.mp4');
  const cover = path.join(dir, 'a.png');
  fs.writeFileSync(video, 'VIDEO');
  fs.writeFileSync(cover, 'COVER');
  return { dir, video, cover, root: path.join(dir, 'public-tmp') };
}

// 가짜 execFile: 호출 인자를 모으고 funnel 기동 때 로컬 포트를 기록한다.
function fakeExec({ failOn } = {}) {
  const calls = [];
  const fn = (cmd, args, opts, cb) => {
    calls.push([cmd, ...args]);
    const port = /127\.0\.0\.1:(\d+)/.exec(args.join(' '))?.[1];
    if (port) fn.port = Number(port);
    setImmediate(() => cb(failOn?.(args) ? new Error('boom') : null));
  };
  fn.calls = calls;
  return fn;
}

function makeUploader(t, { fetch, execFile = fakeExec(), sleeps = [], publicDnsReady = async () => true } = {}) {
  return createInstagramUploader({
    userId: '1789', tokens: { get: () => TOKEN }, publicBaseUrl: `${BASE}/`, tmpRoot: t.root, execFile, fetch,
    sleep: async ms => { sleeps.push(ms); }, publicDnsReady,
  });
}

// 정상 흐름용 fetch. statuses는 상태 조회 응답 순서.
function igFetch({ statuses = ['FINISHED'], onCreate, create = () => json(200, { id: 'c1' }), publish = () => json(200, { id: 'm1' }), permalink = () => json(200, { permalink: 'https://www.instagram.com/reel/abc/' }) } = {}) {
  const calls = [];
  let poll = 0;
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = String(url);
    if (u.endsWith('/media') && init.method === 'POST') { await onCreate?.(init); return create(); }
    if (u.includes('?fields=status_code')) return json(200, { status_code: statuses[Math.min(poll++, statuses.length - 1)] });
    if (u.endsWith('/media_publish')) return publish();
    if (u.includes('?fields=permalink')) return permalink();
    throw new Error(`unexpected ${u}`);
  };
  fn.calls = calls;
  return fn;
}

const noServeOr443 = exec => {
  for (const [cmd, sub, ...rest] of exec.calls) {
    assert.equal(cmd, 'tailscale');
    assert.equal(sub, 'funnel'); // serve는 없다
    assert.ok(rest.includes('--https=8443'), '8443만 쓴다');
    assert.equal(rest.some(a => /443(?!\d)/.test(a) && a !== '--https=8443'), false);
  }
};

test('게시: 컨테이너 필드·상태 폴링·publish·permalink, 임시 서버는 폴더 밖·목록 요청을 거부하고 끝나면 모두 닫힌다', async () => {
  const t = tmp();
  const exec = fakeExec();
  const sleeps = [];
  let served;
  const fetch = igFetch({
    statuses: ['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED'],
    onCreate: async init => {
      const body = new URLSearchParams(init.body);
      assert.equal(body.get('media_type'), 'REELS');
      assert.equal(body.get('share_to_feed'), 'true');
      assert.equal(body.get('is_ai_generated'), 'true');
      assert.equal(body.get('caption'), CAPTION);
      assert.match(body.get('video_url'), new RegExp(`^${BASE}/[0-9a-f]{32}/video\\.mp4$`));
      assert.match(body.get('cover_url'), new RegExp(`^${BASE}/[0-9a-f]{32}/cover\\.png$`));
      assert.equal(init.headers.authorization, `Bearer ${TOKEN}`);
      // 열려 있는 동안 로컬 서버 동작을 확인한다.
      const token = /\/([0-9a-f]{32})\//.exec(body.get('video_url'))[1];
      served = `http://127.0.0.1:${exec.port}`;
      assert.equal(await (await globalThis.fetch(`${served}/${token}/video.mp4`)).text(), 'VIDEO');
      assert.equal((await globalThis.fetch(`${served}/${token}/video.mp4`, { method: 'HEAD' })).status, 200);
      assert.equal((await globalThis.fetch(`${served}/${token}/`)).status, 404); // 목록 없음
      assert.equal((await globalThis.fetch(`${served}/`)).status, 404);
      assert.equal((await globalThis.fetch(`${served}/${token}/..%2Fa.mp4`)).status, 404); // 폴더 밖
      assert.equal((await globalThis.fetch(`${served}/${token}/video.mp4/x`)).status, 404);
      assert.equal((await globalThis.fetch(`${served}/other/video.mp4`)).status, 404);
      assert.equal((await globalThis.fetch(`${served}/${token}/video.mp4`, { method: 'POST' })).status, 405);
      assert.equal(fs.readdirSync(t.root).length, 1);
    },
  });
  const result = await makeUploader(t, { fetch, execFile: exec, sleeps }).upload({ videoPath: t.video, caption: CAPTION, coverPath: t.cover });
  assert.deepEqual(result, { mediaId: 'm1', permalink: 'https://www.instagram.com/reel/abc/' });
  assert.equal(fetch.calls[0].url, `https://graph.instagram.com/${API_VERSION}/1789/media`);
  assert.equal(fetch.calls.find(c => c.url.endsWith('/media_publish')).init.body, 'creation_id=c1');
  assert.deepEqual(sleeps, [10_000, 10_000]);

  // funnel on → off 순서, 8443만, serve 없음
  assert.deepEqual(exec.calls[0].slice(0, 4), ['tailscale', 'funnel', '--bg', '--https=8443']);
  assert.deepEqual(exec.calls.at(-1), ['tailscale', 'funnel', '--https=8443', 'off']);
  noServeOr443(exec);
  assert.deepEqual(fs.readdirSync(t.root), []); // 임시 폴더 삭제
  await assert.rejects(globalThis.fetch(`${served}/x`)); // 서버 close
});

test('실패·예외 경로에도 funnel off·서버 close·폴더 삭제가 불린다', async () => {
  const cases = {
    'HTTP 400': igFetch({ create: () => json(400, { error: { code: 100, error_subcode: 2207026, message: `bad ${TOKEN}` } }) }),
    'ERROR': igFetch({ statuses: ['ERROR'] }),
    'EXPIRED': igFetch({ statuses: ['EXPIRED'] }),
    'publish 400': igFetch({ publish: () => json(400, { error: { code: 9007 } }) }),
    '네트워크': async () => { throw Object.assign(new Error(`net ${TOKEN}`), { code: 'ECONNRESET' }); },
  };
  for (const [name, fetch] of Object.entries(cases)) {
    const t = tmp();
    const exec = fakeExec();
    await assert.rejects(makeUploader(t, { fetch, execFile: exec }).upload({ videoPath: t.video, caption: CAPTION, coverPath: t.cover }), error => {
      const text = JSON.stringify({ m: error.message, d: error.detail, c: error.code });
      assert.equal(text.includes(TOKEN), false, name);
      assert.equal(text.includes('bad'), false, name); // Meta 메시지 원문 저장 금지
      return true;
    }, name);
    assert.deepEqual(exec.calls.at(-1), ['tailscale', 'funnel', '--https=8443', 'off'], name);
    noServeOr443(exec);
    assert.deepEqual(fs.readdirSync(t.root), [], name);
  }

  // funnel을 못 열어도(execFile 실패) 서버·폴더는 정리된다.
  const t = tmp();
  const exec = fakeExec({ failOn: args => args.includes('--bg') });
  await assert.rejects(makeUploader(t, { fetch: igFetch(), execFile: exec }).upload({ videoPath: t.video, caption: CAPTION }));
  assert.deepEqual(exec.calls.at(-1), ['tailscale', 'funnel', '--https=8443', 'off']);
  assert.deepEqual(fs.readdirSync(t.root), []);
});

test('오류 코드: REELS_IG_HTTP_<상태> + Meta code/subcode 숫자만', async () => {
  const t = tmp();
  const fetch = igFetch({ create: () => json(400, { error: { code: 100, error_subcode: 2207026, message: 'x' } }) });
  await assert.rejects(makeUploader(t, { fetch }).upload({ videoPath: t.video, caption: CAPTION }), error => {
    assert.equal(error.code, 'REELS_IG_HTTP_400');
    assert.equal(error.detail, 'HTTP 400 code 100 sub 2207026');
    return true;
  });
});

test('상태 폴링: ERROR/EXPIRED는 실패, 10분(60회) 넘으면 시간 초과', async () => {
  for (const status of ['ERROR', 'EXPIRED']) {
    const t = tmp();
    await assert.rejects(makeUploader(t, { fetch: igFetch({ statuses: [status] }) }).upload({ videoPath: t.video, caption: CAPTION }), { code: 'REELS_IG_CONTAINER_ERROR', detail: `status_code ${status}` });
  }
  const t = tmp();
  const sleeps = [];
  const fetch = igFetch({ statuses: ['IN_PROGRESS'] });
  await assert.rejects(makeUploader(t, { fetch, sleeps }).upload({ videoPath: t.video, caption: CAPTION }), { code: 'REELS_IG_TIMEOUT' });
  assert.equal(sleeps.length, 59);
  assert.equal(fetch.calls.filter(c => c.url.includes('status_code')).length, 60);
  assert.equal(fetch.calls.some(c => c.url.endsWith('/media_publish')), false);
});

test('공개 DNS에 이름이 뜨기 전에는 Meta를 부르지 않고, 10분 넘으면 재시도 가능한 실패로 funnel을 끈다', async () => {
  const t = tmp();
  const sleeps = [];
  const hosts = [];
  const fetch = igFetch();
  let checks = 0;
  const publicDnsReady = async host => {
    hosts.push(host);
    // 이름이 뜨기 전에 Meta를 불렀으면 여기서 잡힌다.
    assert.equal(fetch.calls.length, 0);
    return ++checks >= 3;
  };
  await makeUploader(t, { fetch, sleeps, publicDnsReady }).upload({ videoPath: t.video, caption: CAPTION });
  assert.deepEqual(hosts, Array(3).fill('pi.example.ts.net'));
  assert.deepEqual(sleeps.slice(0, 2), [10_000, 10_000]);

  const t2 = tmp();
  const exec = fakeExec();
  const fetch2 = igFetch();
  await assert.rejects(
    makeUploader(t2, { fetch: fetch2, execFile: exec, publicDnsReady: async () => false }).upload({ videoPath: t2.video, caption: CAPTION }),
    { code: 'REELS_IG_PUBLIC_DNS_TIMEOUT', retryable: true },
  );
  assert.equal(fetch2.calls.length, 0);
  assert.deepEqual(exec.calls.at(-1), ['tailscale', 'funnel', '--https=8443', 'off']);
  assert.deepEqual(fs.readdirSync(t2.root), []);
});

test('5xx는 재시도하지만 media_publish는 재시도하지 않는다', async () => {
  const t = tmp();
  let creates = 0;
  const fetch = igFetch({ create: () => (++creates < 3 ? json(503, {}) : json(200, { id: 'c1' })) });
  await makeUploader(t, { fetch }).upload({ videoPath: t.video, caption: CAPTION });
  assert.equal(creates, 3);

  const t2 = tmp();
  let publishes = 0;
  const fetch2 = igFetch({ publish: () => { publishes += 1; return json(503, {}); } });
  await assert.rejects(makeUploader(t2, { fetch: fetch2 }).upload({ videoPath: t2.video, caption: CAPTION }), { code: 'REELS_IG_HTTP_503' });
  assert.equal(publishes, 1);
});

test('permalink를 못 읽어도 게시는 성공이고, 캡션 한도는 게시 전에 막는다', async () => {
  const t = tmp();
  const result = await makeUploader(t, { fetch: igFetch({ permalink: () => json(400, {}) }) }).upload({ videoPath: t.video, caption: CAPTION });
  assert.deepEqual(result, { mediaId: 'm1', permalink: null });

  assert.throws(() => checkCaption('가'.repeat(2201)), { code: 'REELS_IG_CAPTION_TOO_LONG' });
  checkCaption('가'.repeat(2200));
  assert.throws(() => checkCaption(Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ')), { code: 'REELS_IG_TOO_MANY_HASHTAGS' });
  assert.throws(() => checkCaption(Array.from({ length: 21 }, (_, i) => `@u${i}`).join(' ')), { code: 'REELS_IG_TOO_MANY_MENTIONS' });
  const fetch = igFetch();
  const exec = fakeExec();
  await assert.rejects(makeUploader(t, { fetch, execFile: exec }).upload({ videoPath: t.video, caption: '' }), { code: 'REELS_IG_CAPTION_EMPTY' });
  assert.equal(exec.calls.length, 0); // 검사에서 막히면 funnel도 안 연다
});

test('기동 정리: 남은 임시 폴더를 지우고 8443 funnel을 끈다(실패는 무시)', async () => {
  const t = tmp();
  fs.mkdirSync(path.join(t.root, 'leftover'), { recursive: true });
  fs.writeFileSync(path.join(t.root, 'leftover', 'x'), '1');
  const exec = fakeExec({ failOn: () => true });
  await makeUploader(t, { fetch: igFetch(), execFile: exec }).cleanup();
  assert.deepEqual(exec.calls, [['tailscale', 'funnel', '--https=8443', 'off']]);
  assert.deepEqual(fs.readdirSync(t.root), []);
});

// ── 토큰 ──────────────────────────────────────────────────────────────────────

test('토큰: 파일이 있으면 파일, 없으면 .env 값', () => {
  const t = tmp();
  const tokenFile = path.join(t.dir, 'cfg', 'instagram-token.json');
  const store = createTokenStore({ tokenFile, envToken: ENV_TOKEN, now: () => T });
  assert.equal(store.get(), ENV_TOKEN);
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
  fs.writeFileSync(tokenFile, JSON.stringify({ access_token: 'file-token', expires_at: T + 99, refreshed_at: T }));
  assert.equal(store.get(), 'file-token');
});

test('토큰 갱신: 파일 없으면 즉시, 있으면 만료 10일 전부터 하루 한 번, 파일 권한 0600/0700, 원문 로그 없음', async () => {
  const t = tmp();
  const tokenFile = path.join(t.dir, 'cfg', 'instagram-token.json');
  const clock = { now: T };
  const urls = [];
  const fetch = async url => { urls.push(String(url)); return json(200, { access_token: 'new-token', token_type: 'bearer', expires_in: 5_184_000 }); };
  const store = createTokenStore({ tokenFile, envToken: ENV_TOKEN, fetch, now: () => clock.now });

  assert.equal(await store.refreshIfDue(), 'refreshed'); // 파일 없음 → 만료일을 모르니 바로
  const url = new URL(urls[0]);
  assert.equal(`${url.origin}${url.pathname}`, 'https://graph.instagram.com/refresh_access_token');
  assert.equal(url.searchParams.get('grant_type'), 'ig_refresh_token');
  assert.equal(url.searchParams.get('access_token'), ENV_TOKEN);
  assert.deepEqual(JSON.parse(fs.readFileSync(tokenFile, 'utf8')), { access_token: 'new-token', expires_at: T + 5_184_000, refreshed_at: T });
  assert.equal(fs.statSync(tokenFile).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(tokenFile)).mode & 0o777, 0o700);
  assert.equal(store.get(), 'new-token');
  assert.deepEqual(fs.readdirSync(path.dirname(tokenFile)), ['instagram-token.json']); // tmp 파일 남지 않음

  clock.now = T + 40 * 86400; // 만료까지 20일 → 아직
  assert.equal(await store.refreshIfDue(), 'skipped');
  clock.now = T + 51 * 86400; // 만료까지 9일 → 갱신
  assert.equal(await store.refreshIfDue(), 'refreshed');
  assert.equal(urls.at(-1).includes('access_token=new-token'), true);
  assert.equal(await store.refreshIfDue(), 'skipped'); // 같은 날 다시 안 한다
  assert.equal(urls.length, 2);
});

test('토큰 갱신 실패: 하루 한 번만 시도하고 오류 문구에 토큰이 없다', async () => {
  const t = tmp();
  let n = 0;
  const clock = { now: T };
  const fetch = async () => { n += 1; return json(400, { error: { code: 190, message: `x ${ENV_TOKEN}` } }); };
  const store = createTokenStore({ tokenFile: path.join(t.dir, 'tok.json'), envToken: ENV_TOKEN, fetch, now: () => clock.now });
  await assert.rejects(store.refreshIfDue(), error => {
    assert.equal(error.code, 'REELS_IG_REFRESH_HTTP_400');
    assert.equal(error.detail, 'HTTP 400 code 190');
    assert.equal(JSON.stringify({ m: error.message, d: error.detail }).includes(ENV_TOKEN), false);
    return true;
  });
  assert.equal(await store.refreshIfDue(), 'skipped');
  assert.equal(n, 1);
  assert.equal(fs.existsSync(path.join(t.dir, 'tok.json')), false);
});

// ── 저장소·워커·라우트 ────────────────────────────────────────────────────────

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
  return { db, clock, episodes: createReelsEpisodes(db, { now: () => clock.now }), uploads: createReelsUploads(db, { now: () => clock.now }) };
}

function readyEpisode(ctx, n = 1) {
  const c = ctx.db.prepare(`INSERT INTO reels_candidates (batch_id, position, title, source_url, published_at, collected_at, why, concept, bridge, template,
    hook_paradox, hook_term, hook_subtitle, risk, status, created_at) VALUES ('2026-10-03', ?, 't', 'https://e.com', '2026-10-01', ?, 'w', 'c', 'b', '단계',
    'p', 't', 's', 'r', 'selected', ?)`).run(n, T, T).lastInsertRowid;
  return Number(ctx.db.prepare(`INSERT INTO reels_episodes (candidate_id, episode_dir, work_dir, status, caption, video_path, cover_path, created_at)
    VALUES (?, 'ep01_px', '/w', 'ready', ?, '/m/a.mp4', '/m/a.png', ?)`).run(c, CAPTION, T).lastInsertRowid);
}

test('저장소: 플랫폼별로 하나씩 독립이고, 인스타그램은 1시간 뒤 자동 재시도가 없다', () => {
  const ctx = setup();
  const id = readyEpisode(ctx);
  ctx.uploads.enqueue(id, 'youtube');
  ctx.uploads.enqueue(id, 'instagram');
  const ig = ctx.uploads.claim(undefined, undefined, 'instagram');
  assert.equal(ig.platform, 'instagram');
  const yt = ctx.uploads.claim(undefined, undefined, 'youtube'); // 인스타가 uploading이어도 유튜브는 잡힌다
  assert.equal(yt.platform, 'youtube');
  assert.equal(ctx.uploads.claim(undefined, undefined, 'instagram'), null);

  ctx.uploads.finishFailed(ig.id, 'REELS_IG_HTTP_500', 'HTTP 500');
  ctx.uploads.finishFailed(yt.id, 'REELS_YT_HTTP_503', 'HTTP 503');
  ctx.clock.now += 3 * 3600;
  assert.equal(ctx.uploads.claim(undefined, undefined, 'instagram'), null); // 자동 재시도 없음
  assert.equal(ctx.uploads.claim(undefined, undefined, 'youtube').platform, 'youtube'); // 유튜브는 그대로
  ctx.db.close();
});

test('runNextInstagramUpload·워커: 성공은 done+permalink, 실패는 failed+code, 토큰은 DB에 없다', async () => {
  const ctx = setup();
  const id = readyEpisode(ctx);
  ctx.uploads.enqueue(id, 'instagram');
  let refreshed = 0;
  const ok = {
    refreshTokenIfDue: async () => { refreshed += 1; },
    cleanup: async () => {},
    upload: async ({ videoPath, caption, coverPath }) => {
      assert.deepEqual([videoPath, caption, coverPath], ['/m/a.mp4', CAPTION, '/m/a.png']);
      return { mediaId: 'm9', permalink: 'https://www.instagram.com/reel/zz/' };
    },
  };
  const worker = createReelsProductionWorker({ episodes: ctx.episodes, uploads: ctx.uploads, instagramUploader: ok, reelsDir: '/r', bin: 'claude', now: () => ctx.clock.now });
  await worker.tickUpload();
  const row = ctx.uploads.get(id, 'instagram');
  assert.deepEqual([row.status, row.remote_id, row.attempts], ['done', 'https://www.instagram.com/reel/zz/', 1]);
  assert.equal(refreshed, 1);

  const id2 = readyEpisode(ctx, 2);
  ctx.uploads.enqueue(id2, 'instagram');
  const bad = { upload: async () => { throw Object.assign(new Error(`m ${TOKEN}`), { code: 'REELS_IG_HTTP_400', detail: 'HTTP 400 code 100' }); } };
  const seen = [];
  await runNextInstagramUpload({ uploads: ctx.uploads, episodes: ctx.episodes, uploader: bad, onError: e => seen.push(e.code) });
  const failed = ctx.uploads.get(id2, 'instagram');
  assert.deepEqual([failed.status, failed.error_code, failed.error_detail], ['failed', 'REELS_IG_HTTP_400', 'HTTP 400 code 100']);
  assert.equal(JSON.stringify(ctx.db.prepare('SELECT * FROM reels_uploads').all()).includes(TOKEN), false);
  assert.deepEqual(seen, ['REELS_IG_HTTP_400']);
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

test('승인 → 플래그별 pending, 인스타 retry 라우트, remoteUrl은 permalink만', () => {
  const run = config => {
    const ctx = setup();
    const app = fakeApp();
    registerReelsRoutes({ app, store: { latestBatch() {} }, episodes: ctx.episodes, uploads: ctx.uploads, config: { enabled: true, productionEnabled: true, reelsDir: '/r', ...config } });
    return { ctx, app };
  };
  const approve = (app, id) => app.call('POST /api/reels/episodes/:id/approve', { params: { id: String(id) } });
  const retry = (app, platform, id) => app.call('POST /api/reels/episodes/:id/uploads/:platform/retry', { params: { id: String(id), platform } });
  const platforms = ctx => ctx.uploads.list(1).map(r => r.platform);

  for (const [config, expected] of [
    [{}, []],
    [{ youtubeUploadEnabled: true }, ['youtube']],
    [{ instagramUploadEnabled: true }, ['instagram']],
    [{ youtubeUploadEnabled: true, instagramUploadEnabled: true }, ['youtube', 'instagram']],
  ]) {
    const { ctx, app } = run(config);
    const id = readyEpisode(ctx);
    assert.equal(approve(app, id).status, 200);
    assert.deepEqual(ctx.uploads.list(id).map(r => r.platform), expected);
    ctx.db.close();
  }

  const { ctx, app } = run({ instagramUploadEnabled: true });
  const id = readyEpisode(ctx);
  assert.equal(retry(app, 'instagram', id).status, 404); // 행 없음
  assert.equal(retry(app, 'tiktok', id).status, 404);
  approve(app, id);
  assert.equal(retry(app, 'instagram', id).status, 409); // failed 아님
  const row = ctx.uploads.claim(undefined, undefined, 'instagram');
  ctx.uploads.finishFailed(row.id, 'REELS_IG_HTTP_500', 'HTTP 500');
  assert.equal(retry(app, 'instagram', id).status, 200);
  assert.equal(ctx.uploads.get(id, 'instagram').status, 'pending');
  const again = ctx.uploads.claim(undefined, undefined, 'instagram');
  ctx.uploads.finishOk(again.id, 'https://www.instagram.com/reel/abc/');
  assert.equal(app.call('GET /api/reels/episodes/latest').body.episode.uploads[0].remoteUrl, 'https://www.instagram.com/reel/abc/');
  ctx.db.prepare("UPDATE reels_uploads SET remote_id = '1789000'").run(); // 미디어 ID만 있으면 링크 없음
  assert.equal(app.call('GET /api/reels/episodes/latest').body.episode.uploads[0].remoteUrl, null);
  ctx.db.close();
  assert.equal(platforms.length, 1);
});

test('수동 게시: failed만 done(manual)이 되고, 다시 시도·자동 재시도에 안 잡힌다', () => {
  const ctx = setup();
  const app = fakeApp();
  registerReelsRoutes({ app, store: { latestBatch() {} }, episodes: ctx.episodes, uploads: ctx.uploads, config: { enabled: true, productionEnabled: true, reelsDir: '/r', youtubeUploadEnabled: true } });
  const id = readyEpisode(ctx);
  const manual = () => app.call('POST /api/reels/episodes/:id/uploads/:platform/manual', { params: { id: String(id), platform: 'youtube' } });
  assert.equal(manual().status, 404); // 행 없음
  app.call('POST /api/reels/episodes/:id/approve', { params: { id: String(id) } });
  assert.equal(manual().status, 409); // failed 아님
  ctx.uploads.finishFailed(ctx.uploads.claim(undefined, undefined, 'youtube').id, 'X', null);
  assert.equal(manual().status, 200);
  const upload = app.call('GET /api/reels/episodes/latest').body.episode.uploads[0];
  assert.deepEqual([upload.status, upload.manual, upload.remoteUrl, upload.errorCode], ['done', true, null, null]);
  assert.equal(ctx.uploads.claim(undefined, Date.now() / 1000 + 86400, 'youtube'), null);
  assert.equal(app.call('POST /api/reels/episodes/:id/uploads/:platform/retry', { params: { id: String(id), platform: 'youtube' } }).status, 409);
  ctx.db.close();
});

test('서버 연결·설정 계약: 플래그 기본 false, .env.example 이름만, gitignore, 화면 링크', () => {
  const root = path.join(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /const REELS_INSTAGRAM_UPLOAD_ENABLED = process\.env\.REELS_INSTAGRAM_UPLOAD_ENABLED === 'true'/);
  assert.match(server, /instagramUploadEnabled: REELS_INSTAGRAM_UPLOAD_ENABLED/);
  const env = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  assert.match(env, /^REELS_INSTAGRAM_UPLOAD_ENABLED=false$/m);
  for (const name of ['USER_ID', 'ACCESS_TOKEN', 'TOKEN_FILE']) assert.match(env, new RegExp(`^REELS_INSTAGRAM_${name}=$`, 'm'));
  assert.match(env, /^REELS_PUBLIC_BASE_URL=$/m);
  assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /^reels\/public-tmp\/$/m);
  const panel = fs.readFileSync(path.join(root, 'public/agent-panel.js'), 'utf8');
  assert.match(panel.slice(panel.indexOf('function reelsUploadLines'), panel.indexOf('function makeReelsEpisodeCard')), /youtu\\\.be\|www\\\.instagram\\\.com/);
  // tailscale·funnel 코드는 instagram.js에만 있다.
  for (const file of ['server.js', 'lib/reels/routes.js', 'lib/reels/production-worker.js', 'lib/reels/uploads.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /tailscale|funnel/i, file);
  }
});
