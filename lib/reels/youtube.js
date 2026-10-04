'use strict';

// Reels 3단계: 승인된 편을 유튜브에 올린다(videos.insert, 재개 가능 업로드).
// 공식: developers.google.com/youtube/v3/guides/using_resumable_upload_protocol, .../docs/videos/insert.
// 토큰·비밀값·응답 본문은 로그·DB·오류 문구에 넣지 않는다. 오류에는 우리가 정한 code와 짧은 detail(HTTP 상태·구글 reason)만 둔다.

const fs = require('node:fs');
const { createGoogleTokenSource } = require('../mail/gmail');

const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
// thumbnails.set(youtube.upload 범위 허용, PNG ≤ 50MB). 커스텀 썸네일 권한이 없는 채널은 403이다(고급 기능 인증 전 등).
const THUMBNAIL_URL = 'https://www.googleapis.com/upload/youtube/v3/thumbnails/set';
const CATEGORY_ID = '28'; // Science & Technology
const TITLE_MAX = 100;
const MAX_RETRIES = 3;
const BACKOFF_MS = 1000;
const PRIVACY = ['private', 'unlisted', 'public'];

function ytError(code, detail, retryable = false) {
  return Object.assign(new Error(code), { code, detail, retryable });
}

/** 잘못된 값이면 private. warn은 로그용(값 자체는 담지 않는다). */
function resolvePrivacy(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { privacy: 'private', warn: false };
  return PRIVACY.includes(value) ? { privacy: value, warn: false } : { privacy: 'private', warn: true };
}

/** 첫 줄 = 제목(100자 초과 시 자름), 나머지 = 설명(앞 빈 줄 제거). */
function splitCaption(caption) {
  const text = String(caption ?? '').replace(/\r\n/g, '\n');
  const at = text.indexOf('\n');
  const first = (at < 0 ? text : text.slice(0, at)).trim();
  const description = (at < 0 ? '' : text.slice(at + 1)).replace(/^\s*\n/, '').trim();
  const title = Array.from(first).slice(0, TITLE_MAX).join('');
  return { title, description, titleTruncated: title.length < first.length };
}

function createYoutubeUploader({ credentials, privacy = 'private', thumbnail = false, fetch: fetchOption, sleep = ms => new Promise(r => setTimeout(r, ms)), now, readFile = fs.promises.readFile } = {}) {
  const fetchImpl = typeof fetchOption === 'function' ? fetchOption : globalThis.fetch;
  const tokens = createGoogleTokenSource({ credentials: { ...credentials }, fetch: fetchImpl, now });

  async function accessToken() {
    try {
      return await tokens.getAccessToken();
    } catch (error) {
      throw ytError(error.code === 'MAIL_AUTH_REQUIRED' ? 'REELS_YT_AUTH' : 'REELS_YT_TOKEN', error.statusCode ? `HTTP ${error.statusCode}` : undefined, Boolean(error.retryable));
    }
  }

  // 한 번 호출. 네트워크 오류·5xx·408·429는 retryable, 그 밖의 오류 상태는 즉시 실패.
  async function call(url, init, { accept = [] } = {}) {
    let response;
    try {
      response = await fetchImpl(url, { redirect: 'manual', ...init });
    } catch (error) {
      throw ytError('REELS_YT_NETWORK', String(error?.cause?.code || error?.code || error?.name || '').slice(0, 60) || undefined, true);
    }
    if (response.ok || accept.includes(response.status)) return response;
    const payload = await response.json().catch(() => null);
    const reason = payload?.error?.errors?.[0]?.reason;
    const detail = `HTTP ${response.status}${/^[A-Za-z0-9_]{1,60}$/.test(reason || '') ? ` ${reason}` : ''}`;
    throw ytError(`REELS_YT_HTTP_${response.status}`, detail, response.status >= 500 || response.status === 408 || response.status === 429);
  }

  async function retrying(fn) {
    for (let i = 0; ; i++) {
      try {
        return await fn(i);
      } catch (error) {
        if (!error.retryable || i >= MAX_RETRIES) throw error;
        await sleep(BACKOFF_MS * 2 ** i);
      }
    }
  }

  async function setThumbnail({ videoId, imagePath }) {
    const image = await readFile(imagePath);
    const token = await accessToken();
    await retrying(() => call(`${THUMBNAIL_URL}?videoId=${encodeURIComponent(videoId)}`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'image/png' }, body: image,
    }));
  }

  return {
    setThumbnail,
    /** → { videoId, titleTruncated, thumbnail: 'set' | 'skipped' | 실패 code } — 썸네일 실패는 업로드 실패가 아니다. */
    async upload({ videoPath, caption, coverPath }) {
      const { title, description, titleTruncated } = splitCaption(caption);
      if (!title) throw ytError('REELS_YT_CAPTION_EMPTY', '캡션 첫 줄이 비어 있습니다.');
      const file = await readFile(videoPath);
      const size = file.length;
      const token = await accessToken();
      const auth = { authorization: `Bearer ${token}` };

      // 1단계: 세션 시작. 응답 Location이 업로드 주소다.
      const start = await retrying(() => call(UPLOAD_URL, {
        method: 'POST',
        headers: {
          ...auth, 'content-type': 'application/json; charset=UTF-8',
          'x-upload-content-length': String(size), 'x-upload-content-type': 'video/mp4',
        },
        body: JSON.stringify({
          snippet: { title, description, categoryId: CATEGORY_ID },
          // containsSyntheticMedia는 status 자원의 필드(videos.insert 문서). 사용자 결정으로 켜지 않는다.
          status: { privacyStatus: privacy, selfDeclaredMadeForKids: false, containsSyntheticMedia: false },
        }),
      }));
      const session = start.headers.get('location');
      if (!session) throw ytError('REELS_YT_NO_SESSION', 'Location 헤더가 없습니다.');

      // 2단계: 파일 PUT. 재시도 때는 먼저 서버가 받은 만큼을 물어 거기서 이어 보낸다(308 + Range).
      let offset = 0;
      const done = await retrying(async attempt => {
        if (attempt) {
          const probe = await call(session, { method: 'PUT', headers: { 'content-range': `bytes */${size}` } }, { accept: [308] });
          if (probe.status !== 308) return probe;
          const end = /bytes=0-(\d+)/.exec(probe.headers.get('range') || '');
          offset = end ? Number(end[1]) + 1 : 0;
        }
        const headers = { 'content-type': 'video/mp4' };
        if (offset) headers['content-range'] = `bytes ${offset}-${size - 1}/${size}`;
        return call(session, { method: 'PUT', headers, body: file.subarray(offset) });
      });
      const videoId = (await done.json().catch(() => null))?.id;
      if (!videoId) throw ytError('REELS_YT_NO_VIDEO_ID', '응답에 영상 ID가 없습니다.');
      let thumbnailResult = 'skipped';
      if (thumbnail && coverPath) {
        try {
          await setThumbnail({ videoId: String(videoId), imagePath: coverPath });
          thumbnailResult = 'set';
        } catch (error) {
          thumbnailResult = error?.code || 'REELS_YT_THUMBNAIL';
        }
      }
      return { videoId: String(videoId), titleTruncated, thumbnail: thumbnailResult };
    },
  };
}

/** claim → 업로드 → done/failed. 처리할 게 없으면 null. 오류 문구는 code·detail만 DB에 간다. */
async function runNextUpload({ uploads, episodes, uploader, episodeId, onError = () => {} }) {
  const row = uploads.claim(episodeId);
  if (!row) return null;
  try {
    const episode = episodes.getEpisode(row.episode_id);
    if (!episode?.video_path || !episode.caption) throw ytError('REELS_UPLOAD_NO_MEDIA', '영상이나 캡션이 없습니다.');
    const { videoId, titleTruncated, thumbnail } = await uploader.upload({ videoPath: episode.video_path, caption: episode.caption, coverPath: episode.cover_path });
    uploads.finishOk(row.id, videoId);
    if (thumbnail !== 'set' && thumbnail !== 'skipped') onError(ytError(thumbnail, '썸네일을 넣지 못했습니다(영상은 올라갔다).'));
    return { id: row.id, status: 'done', remoteId: videoId, titleTruncated, thumbnail };
  } catch (error) {
    uploads.finishFailed(row.id, error?.code, error?.detail);
    onError(error);
    return { id: row.id, status: 'failed', code: error?.code };
  }
}

module.exports = { createYoutubeUploader, resolvePrivacy, runNextUpload, splitCaption, ytError };

// 수동 실행: node lib/reels/youtube.js --episode <id> [--thumbnail-only]  (워커 없이 한 편. .env의 REELS_YOUTUBE_* 사용)
// --thumbnail-only: 이미 올라간 편(done)에 커버 썸네일만 다시 넣는다.
if (require.main === module) {
  (async () => {
    require('dotenv').config();
    const Database = require('better-sqlite3');
    const { resolveRuntimePaths } = require('../runtime-paths');
    const { createReelsEpisodes } = require('./episodes');
    const { createReelsUploads } = require('./uploads');
    const id = Number(process.argv[process.argv.indexOf('--episode') + 1]);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('사용법: node lib/reels/youtube.js --episode <id>');
    const env = process.env;
    const db = new Database(resolveRuntimePaths({ appRoot: require('node:path').join(__dirname, '..', '..') }).dbPath, { fileMustExist: true });
    const uploads = createReelsUploads(db);
    const episodes = createReelsEpisodes(db);
    const uploader = createYoutubeUploader({
      credentials: { clientId: env.REELS_YOUTUBE_CLIENT_ID, clientSecret: env.REELS_YOUTUBE_CLIENT_SECRET, refreshToken: env.REELS_YOUTUBE_REFRESH_TOKEN },
      privacy: resolvePrivacy(env.REELS_YOUTUBE_PRIVACY).privacy,
      thumbnail: env.REELS_YOUTUBE_THUMBNAIL === 'true',
    });
    if (process.argv.includes('--thumbnail-only')) {
      const row = uploads.get(id, 'youtube');
      const episode = episodes.getEpisode(id);
      if (row?.status !== 'done' || !row.remote_id || !episode?.cover_path) throw new Error('올라간 영상이나 커버가 없습니다.');
      await uploader.setThumbnail({ videoId: row.remote_id, imagePath: episode.cover_path });
      console.log(JSON.stringify({ id, thumbnail: 'set' }));
      db.close();
      return;
    }
    uploads.enqueue(id, 'youtube');
    if (uploads.get(id, 'youtube').status === 'failed') uploads.retry(id, 'youtube');
    const result = await runNextUpload({ uploads, episodes, uploader, episodeId: id });
    console.log(JSON.stringify(result));
    db.close();
  })().catch(error => { console.error(error.message); process.exit(1); });
}
