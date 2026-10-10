'use strict';

// Reels: 승인된 편을 인스타그램 릴스로 게시한다(Instagram 로그인 방식 Content Publishing API).
// 공식: developers.facebook.com/docs/instagram-platform/content-publishing/ · .../ig-user/media/ · .../reference/refresh_access_token/.
// 릴스는 video_url(공개 주소)로만 받는다 → 게시 동안만 cloudflared 임시 터널(trycloudflare.com)로 임시 폴더 하나를 연다.
// Tailscale Funnel(*.ts.net)은 2026-10-06부터 Meta가 받으러 오지 않아 버렸다(같은 파일·파라미터로 trycloudflare는 FINISHED, 2026-10-10).
// 토큰·응답 원문은 로그·DB·오류 문구에 넣지 않는다. 오류에는 code와 HTTP 상태·Meta code/error_subcode 숫자만 둔다.
// 게시 실패는 자동 재시도하지 않는다(중복 게시 위험) — failed로 두고 사람이 retry한다(uploads.js).

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const dns = require('node:dns').promises;
const crypto = require('node:crypto');
const { spawn: nodeSpawn } = require('node:child_process');

const API_BASE = 'https://graph.instagram.com';
const API_VERSION = 'v25.0'; // ig-user/media 문서: "The lastest API version is: v25.0"
const DEFAULT_CLOUDFLARED_BIN = '/home/pi/bin/cloudflared';
const TUNNEL_START_MS = 60_000;
const CAPTION_MAX = 2200; // 문서: "Maximum 2200 characters, 30 hashtags, and 20 @ tags."
const HASHTAG_MAX = 30;
const MENTION_MAX = 20;
const POLL_MS = 10_000;
const POLL_MAX = 60; // 10분
const DNS_POLL_MS = 10_000;
const DNS_POLL_MAX = 60; // 10분
const MAX_RETRIES = 3;
const BACKOFF_MS = 1000;
const REFRESH_BEFORE = 10 * 86400;
const REFRESH_GAP = 86400; // 하루 한 번만 시도(문서: 토큰은 발급 24시간 뒤부터 갱신 가능)
const DEFAULT_TOKEN_FILE = '/home/pi/.config/galpi/instagram-token.json';

function igError(code, detail, retryable = false) {
  return Object.assign(new Error(code), { code, detail, retryable });
}

/** 캡션 길이·해시태그·멘션 수 검사(문서 한도). 어기면 throw. */
function checkCaption(caption) {
  const text = String(caption ?? '');
  if (!text.trim()) throw igError('REELS_IG_CAPTION_EMPTY', '캡션이 비어 있습니다.');
  if (Array.from(text).length > CAPTION_MAX) throw igError('REELS_IG_CAPTION_TOO_LONG', `${CAPTION_MAX}자를 넘습니다.`);
  if ((text.match(/#[^\s#]+/g) || []).length > HASHTAG_MAX) throw igError('REELS_IG_TOO_MANY_HASHTAGS', `해시태그 ${HASHTAG_MAX}개를 넘습니다.`);
  if ((text.match(/@[^\s@]+/g) || []).length > MENTION_MAX) throw igError('REELS_IG_TOO_MANY_MENTIONS', `@태그 ${MENTION_MAX}개를 넘습니다.`);
}

function metaDetail(status, payload) {
  const num = v => (Number.isSafeInteger(v) ? v : null);
  const code = num(payload?.error?.code);
  const sub = num(payload?.error?.error_subcode);
  return `HTTP ${status}${code != null ? ` code ${code}` : ''}${sub != null ? ` sub ${sub}` : ''}`;
}

// ---- 토큰: 파일(0600, 폴더 0700, 원자적 쓰기)이 있으면 파일, 없으면 .env 값 ----
function createTokenStore({ tokenFile = DEFAULT_TOKEN_FILE, envToken = '', fetch: fetchOption, now = () => Math.floor(Date.now() / 1000), fsImpl = fs } = {}) {
  const fetchImpl = typeof fetchOption === 'function' ? fetchOption : globalThis.fetch;
  let lastAttempt = 0;

  function readFile() {
    try {
      const data = JSON.parse(fsImpl.readFileSync(tokenFile, 'utf8'));
      return typeof data?.access_token === 'string' && data.access_token ? data : null;
    } catch { return null; }
  }

  function write(data) {
    const dir = path.dirname(tokenFile);
    fsImpl.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fsImpl.chmodSync(dir, 0o700);
    const tmp = `${tokenFile}.${process.pid}.tmp`;
    fsImpl.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fsImpl.chmodSync(tmp, 0o600);
    fsImpl.renameSync(tmp, tokenFile);
  }

  return {
    get: () => readFile()?.access_token || String(envToken || ''),
    /** 파일이 없으면(만료일을 모른다) 바로, 있으면 만료 10일 전부터 하루 한 번 갱신한다. → 'refreshed' | 'skipped' */
    async refreshIfDue() {
      const t = now();
      const file = readFile();
      const token = file?.access_token || String(envToken || '');
      if (!token) return 'skipped';
      const due = !file || (file.expires_at - t < REFRESH_BEFORE && t - (file.refreshed_at || 0) >= REFRESH_GAP);
      if (!due || t - lastAttempt < REFRESH_GAP) return 'skipped';
      lastAttempt = t;
      let response;
      try {
        response = await fetchImpl(`${API_BASE}/refresh_access_token?${new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token })}`, { redirect: 'manual' });
      } catch (error) {
        throw igError('REELS_IG_REFRESH_NETWORK', String(error?.cause?.code || error?.code || error?.name || '').slice(0, 60) || undefined);
      }
      if (!response.ok) throw igError(`REELS_IG_REFRESH_HTTP_${response.status}`, metaDetail(response.status, await response.json().catch(() => null)));
      const body = await response.json().catch(() => null);
      if (!body?.access_token || !Number.isFinite(Number(body.expires_in))) throw igError('REELS_IG_REFRESH_BAD_RESPONSE');
      write({ access_token: body.access_token, expires_at: t + Number(body.expires_in), refreshed_at: t });
      return 'refreshed';
    },
  };
}

// ---- 공개 임시 폴더를 내보내는 작은 정적 서버: GET/HEAD만, 목록 없음, 허용 목록 밖은 404 ----
function servePublic({ dir, token, files }) {
  const server = http.createServer((req, res) => {
    const deny = status => { res.writeHead(status, { 'content-type': 'text/plain' }); res.end(); };
    if (req.method !== 'GET' && req.method !== 'HEAD') return deny(405);
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return deny(400); }
    const [, tok, name, extra] = pathname.split('/');
    if (tok !== token || !name || extra !== undefined || !Object.hasOwn(files, name)) return deny(404);
    const file = path.join(dir, name);
    let size;
    try { size = fs.statSync(file).size; } catch { return deny(404); }
    res.writeHead(200, { 'content-type': files[name], 'content-length': size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// 터널 주소는 공용 DNS 이름이 조금 뒤에야 생긴다(2026-10-10 실측: funnel 165초, trycloudflare 5초). 그 전에 Meta를 부르면 영상을 받으러
// 오지도 못하고 ERROR가 난다. 공용 리졸버는 이른 NXDOMAIN을 5분 캐시하므로 영역의 권한 서버 전부에 직접 묻는다.
async function authoritativeHasName(host) {
  try {
    const servers = await dns.resolveNs(host.split('.').slice(-2).join('.'));
    for (const ns of servers) {
      const resolver = new dns.Resolver();
      resolver.setServers([(await dns.lookup(ns, { family: 4 })).address]);
      if (!(await resolver.resolve4(host)).length) return false;
    }
    return servers.length > 0;
  } catch {
    return false;
  }
}

// ponytail: trycloudflare는 계정 없는 무보증 임시 터널이다. 막히거나 불안정해지면 Cloudflare 계정의 이름 있는 터널로 올린다.
function startCloudflared(port, { bin = DEFAULT_CLOUDFLARED_BIN, spawn = nodeSpawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'ignore', 'pipe'] });
    const stop = () => { child.kill('SIGTERM'); };
    let log = '';
    let done = false;
    const fail = detail => { if (done) return; done = true; clearTimeout(timer); stop(); reject(igError('REELS_IG_TUNNEL', detail, true)); };
    const timer = setTimeout(() => fail('터널 주소를 60초 안에 받지 못했습니다.'), TUNNEL_START_MS);
    child.on('error', () => fail('cloudflared를 실행하지 못했습니다.'));
    child.on('exit', () => fail('cloudflared가 주소를 주기 전에 끝났습니다.'));
    // 주소를 받은 뒤에도 파이프가 차지 않게 계속 읽어서 버린다.
    child.stderr.on('data', chunk => {
      if (done) return;
      log += chunk;
      const origin = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(log)?.[0];
      if (!origin || !/Registered tunnel connection/.test(log)) return;
      done = true;
      clearTimeout(timer);
      resolve({ origin, stop });
    });
  });
}

function createInstagramUploader({
  userId, tokens, tmpRoot, cloudflaredBin, startTunnel = port => startCloudflared(port, { bin: cloudflaredBin }), fetch: fetchOption,
  sleep = ms => new Promise(r => setTimeout(r, ms)), publicDnsReady = authoritativeHasName,
} = {}) {
  const fetchImpl = typeof fetchOption === 'function' ? fetchOption : globalThis.fetch;
  const base = `${API_BASE}/${API_VERSION}`;
  let chain = Promise.resolve(); // 인스타 게시는 하나씩

  async function call(url, init, { retry = true } = {}) {
    for (let i = 0; ; i++) {
      try {
        let response;
        try {
          response = await fetchImpl(url, { redirect: 'manual', ...init, headers: { authorization: `Bearer ${tokens.get()}`, ...init?.headers } });
        } catch (error) {
          throw igError('REELS_IG_NETWORK', String(error?.cause?.code || error?.code || error?.name || '').slice(0, 60) || undefined, true);
        }
        if (response.ok) return response;
        const payload = await response.json().catch(() => null);
        throw igError(`REELS_IG_HTTP_${response.status}`, metaDetail(response.status, payload), response.status >= 500 || response.status === 429);
      } catch (error) {
        if (!retry || !error.retryable || i >= MAX_RETRIES) throw error;
        await sleep(BACKOFF_MS * 2 ** i);
      }
    }
  }

  const form = fields => ({
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString(),
  });

  async function publishReel({ videoUrl, coverUrl, caption }) {
    const created = await (await call(`${base}/${userId}/media`, form({
      media_type: 'REELS', video_url: videoUrl, ...(coverUrl ? { cover_url: coverUrl } : {}),
      caption, share_to_feed: 'true', is_ai_generated: 'true',
    }))).json().catch(() => null);
    if (!created?.id) throw igError('REELS_IG_NO_CONTAINER_ID', '응답에 컨테이너 ID가 없습니다.');
    for (let n = 0; ; n++) {
      const status = (await (await call(`${base}/${created.id}?fields=status_code`)).json().catch(() => null))?.status_code;
      if (status === 'FINISHED') break;
      if (status === 'ERROR' || status === 'EXPIRED') throw igError('REELS_IG_CONTAINER_ERROR', `status_code ${status}`);
      if (n + 1 >= POLL_MAX) throw igError('REELS_IG_TIMEOUT', '컨테이너가 10분 안에 끝나지 않았습니다.');
      await sleep(POLL_MS);
    }
    // 응답을 잃은 재시도가 중복 게시가 되지 않게 publish는 재시도하지 않는다.
    const published = await (await call(`${base}/${userId}/media_publish`, form({ creation_id: created.id }), { retry: false })).json().catch(() => null);
    if (!published?.id) throw igError('REELS_IG_NO_MEDIA_ID', '응답에 미디어 ID가 없습니다.');
    let permalink = null;
    try {
      const p = (await (await call(`${base}/${published.id}?fields=permalink`)).json())?.permalink;
      if (/^https:\/\/(www\.)?instagram\.com\//.test(p || '')) permalink = p;
    } catch { /* 링크는 덤이다 */ }
    return { mediaId: String(published.id), permalink };
  }

  // 성공·실패·예외 모두 finally에서: 터널 종료 → 서버 close → 폴더 삭제.
  async function withPublicFiles(paths, fn) {
    const token = crypto.randomBytes(16).toString('hex');
    const dir = path.join(tmpRoot, token);
    let served = null;
    let tunnel = null;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const files = {};
      const names = {};
      for (const [key, src] of Object.entries(paths)) {
        if (!src) continue;
        const name = `${key}${path.extname(src)}`;
        fs.copyFileSync(src, path.join(dir, name)); // 복사(하드링크 아님)
        files[name] = key === 'video' ? 'video/mp4' : 'image/png';
        names[key] = name;
      }
      served = await servePublic({ dir, token, files });
      tunnel = await startTunnel(served.port);
      const urls = Object.fromEntries(Object.entries(names).map(([key, name]) => [key, `${tunnel.origin}/${token}/${name}`]));
      const host = new URL(tunnel.origin).hostname;
      for (let n = 0; !(await publicDnsReady(host)); n++) {
        if (n + 1 >= DNS_POLL_MAX) throw igError('REELS_IG_PUBLIC_DNS_TIMEOUT', '공개 주소가 10분 안에 DNS에 뜨지 않았습니다.', true);
        await sleep(DNS_POLL_MS);
      }
      return await fn(urls);
    } finally {
      tunnel?.stop();
      if (served) await new Promise(r => { served.server.close(() => r()); served.server.closeAllConnections?.(); });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  return {
    /** → { mediaId, permalink } */
    upload({ videoPath, caption, coverPath }) {
      const run = async () => {
        checkCaption(caption);
        return withPublicFiles({ video: videoPath, cover: coverPath }, urls => publishReel({ videoUrl: urls.video, coverUrl: urls.cover, caption }));
      };
      const result = chain.then(run, run);
      chain = result.catch(() => {});
      return result;
    },
    /** 기동 때: 남은 임시 폴더를 지운다(남은 터널은 서비스 재시작 때 함께 끝난다). */
    async cleanup() {
      try { for (const name of fs.readdirSync(tmpRoot)) fs.rmSync(path.join(tmpRoot, name), { recursive: true, force: true }); } catch { /* 폴더 없음 */ }
    },
    refreshTokenIfDue: () => tokens.refreshIfDue(),
  };
}

/** claim → 게시 → done/failed. remote_id에는 permalink(없으면 미디어 ID)를 둔다. */
async function runNextInstagramUpload({ uploads, episodes, uploader, episodeId, onError = () => {} }) {
  const row = uploads.claim(episodeId, undefined, 'instagram');
  if (!row) return null;
  try {
    const episode = episodes.getEpisode(row.episode_id);
    if (!episode?.video_path || !episode.caption) throw igError('REELS_UPLOAD_NO_MEDIA', '영상이나 캡션이 없습니다.');
    const { mediaId, permalink } = await uploader.upload({ videoPath: episode.video_path, caption: episode.caption, coverPath: episode.cover_path });
    uploads.finishOk(row.id, permalink || mediaId);
    return { id: row.id, status: 'done', remoteId: mediaId, permalink };
  } catch (error) {
    uploads.finishFailed(row.id, error?.code, error?.detail);
    onError(error);
    return { id: row.id, status: 'failed', code: error?.code };
  }
}

module.exports = { API_VERSION, DEFAULT_TOKEN_FILE, checkCaption, createInstagramUploader, createTokenStore, igError, runNextInstagramUpload, servePublic, startCloudflared };

// 수동 실행: node lib/reels/instagram.js --episode <id>  (워커 없이 한 편. 실제 게시가 나간다)
if (require.main === module) {
  (async () => {
    require('dotenv').config();
    const Database = require('better-sqlite3');
    const { resolveRuntimePaths } = require('../runtime-paths');
    const { createReelsEpisodes } = require('./episodes');
    const { createReelsUploads } = require('./uploads');
    const id = Number(process.argv[process.argv.indexOf('--episode') + 1]);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('사용법: node lib/reels/instagram.js --episode <id>');
    const env = process.env;
    const root = path.join(__dirname, '..', '..');
    const db = new Database(resolveRuntimePaths({ appRoot: root }).dbPath, { fileMustExist: true });
    const uploads = createReelsUploads(db);
    const episodes = createReelsEpisodes(db);
    const uploader = createInstagramUploader({
      userId: env.REELS_INSTAGRAM_USER_ID,
      tokens: createTokenStore({ tokenFile: env.REELS_INSTAGRAM_TOKEN_FILE || DEFAULT_TOKEN_FILE, envToken: env.REELS_INSTAGRAM_ACCESS_TOKEN }),
      cloudflaredBin: env.REELS_CLOUDFLARED_BIN || undefined,
      tmpRoot: path.join(root, 'reels', 'public-tmp'),
    });
    uploads.enqueue(id, 'instagram');
    if (uploads.get(id, 'instagram').status === 'failed') uploads.retry(id, 'instagram');
    console.log(JSON.stringify(await runNextInstagramUpload({ uploads, episodes, uploader, episodeId: id })));
    db.close();
  })().catch(error => { console.error(error.message); process.exit(1); });
}
