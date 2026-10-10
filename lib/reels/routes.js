'use strict';

const path = require('node:path');

// 검토 1의 세 행동(설계 v0.2 4장): 하나 선택 / 전부 거절 / 보류. 인증은 server.js의
// `app.use('/api/', requireApiToken)`가 /api/reels/* 전체에 이미 건다 — 뉴스 라우트와 같다.
// 검토 2(제작된 편)의 라우트는 episodes 저장소가 있을 때 더한다. 편 파일은 reelsDir/media 안에 있는 것만 내보낸다.
// 주의: `<video>` 태그는 토큰 헤더를 못 붙인다. 화면(2b-2)이 blob fetch 등으로 풀어야 한다.

// 인스타그램은 remote_id에 permalink(없으면 미디어 ID)를 둔다 → permalink일 때만 링크.
function remoteUrl(row) {
  if (row.remote_id === 'manual') return null;
  if (row.platform === 'youtube') return `https://youtu.be/${row.remote_id}`;
  return row.platform === 'instagram' && /^https:\/\/(www\.)?instagram\.com\//.test(row.remote_id) ? row.remote_id : null;
}

function uploadJson(row) {
  return {
    platform: row.platform, status: row.status, attempts: row.attempts,
    remoteUrl: row.status === 'done' && row.remote_id ? remoteUrl(row) : null,
    manual: row.remote_id === 'manual',
    errorCode: row.error_code, errorDetail: row.error_detail,
  };
}

function episodeJson(row, uploads = []) {
  const parse = text => { try { return text ? JSON.parse(text) : null; } catch { return null; } };
  return {
    id: row.id, candidateId: row.candidate_id, batchId: row.batch_id, title: row.title, concept: row.concept,
    // 수정 중은 DB에서 producing + revision_note다. API 이름만 revising이다.
    status: row.status === 'producing' && row.revision_note != null ? 'revising' : row.status,
    revisions: parse(row.revisions_json) || [], revisionNote: row.revision_note ?? null,
    attempts: row.attempts, errorCode: row.error_code, errorDetail: row.error_detail,
    caption: row.caption, claims: parse(row.claims_json),
    videoUrl: row.video_path ? `/api/reels/episodes/${row.id}/video` : null,
    coverUrl: row.cover_path ? `/api/reels/episodes/${row.id}/cover` : null,
    uploads: uploads.map(uploadJson),
    createdAt: row.created_at, finishedAt: row.finished_at, decidedAt: row.decided_at,
  };
}

function registerReelsRoutes({ app, store, config, episodes = null, uploads = null, onRevise = null, onUpload = null, instagramInsights = null }) {
  if (!app?.get) throw new TypeError('Express app이 필요합니다.');
  if (!store?.latestBatch) throw new TypeError('Reels 저장소가 필요합니다.');

  app.get('/api/reels/instagram/insights', async (_req, res) => {
    res.set?.('Cache-Control', 'no-store');
    try {
      return res.json(instagramInsights ? await instagramInsights.latest() : { status: 'disconnected', points: [] });
    } catch (error) {
      const auth = error.code === 'INSTAGRAM_INSIGHTS_AUTH';
      return res.status(503).json({ code: auth ? 'INSTAGRAM_INSIGHTS_AUTH' : 'INSTAGRAM_INSIGHTS_UNAVAILABLE', error: auth ? '인스타 성과 조회 권한이나 인증을 확인해줘.' : '인스타 성과를 불러오지 못했어.' });
    }
  });

  function guard(res) {
    if (config?.enabled) return false;
    res.status(503).json({ error: 'Reels Agent가 아직 활성화되지 않았습니다.', code: 'REELS_AGENT_DISABLED' });
    return true;
  }

  function act(res, fn) {
    try {
      return res.json(fn());
    } catch (error) {
      const status = { REELS_NOT_FOUND: 404, REELS_NOT_PENDING: 409, REELS_BUSY: 409, REELS_NOTE_INVALID: 400 }[error.code] ?? 500;
      return res.status(status).json({ error: status === 500 ? 'Reels 요청을 처리하지 못했습니다.' : error.message, code: error.code || 'REELS_FAILED' });
    }
  }

  const intId = value => (/^[1-9]\d{0,9}$/.test(String(value)) ? Number(value) : null);

  app.get('/api/reels/latest', (_req, res) => {
    if (guard(res)) return;
    return res.json({ batch: store.latestBatch() });
  });

  app.post('/api/reels/candidates/:id/select', (req, res) => {
    if (guard(res)) return;
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ error: '후보 id가 올바르지 않습니다.', code: 'REELS_ID_INVALID' });
    }
    return act(res, () => store.selectCard(id));
  });

  for (const [action, method] of [['reject', 'rejectBatch'], ['hold', 'holdBatch']]) {
    app.post(`/api/reels/batches/:batchId/${action}`, (req, res) => {
      if (guard(res)) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.batchId)) {
        return res.status(400).json({ error: '배치 id가 올바르지 않습니다.', code: 'REELS_ID_INVALID' });
      }
      return act(res, () => store[method](req.params.batchId));
    });
  }

  if (!episodes) return;

  // 제작 플래그는 후보 플래그와 따로다.
  function guardProduction(res) {
    if (config?.productionEnabled) return false;
    res.status(503).json({ error: 'Reels 제작이 아직 활성화되지 않았습니다.', code: 'REELS_PRODUCTION_DISABLED' });
    return true;
  }

  app.get('/api/reels/episodes/latest', (_req, res) => {
    if (guardProduction(res)) return;
    const row = episodes.latestEpisode();
    return res.json({ episode: row ? episodeJson(row, uploads?.list(row.id)) : null });
  });

  for (const [kind, column] of [['video', 'video_path'], ['cover', 'cover_path']]) {
    app.get(`/api/reels/episodes/:id/${kind}`, (req, res) => {
      if (guardProduction(res)) return;
      const id = intId(req.params.id);
      const row = id && episodes.getEpisode(id);
      const mediaDir = path.resolve(config.reelsDir, 'media') + path.sep;
      const file = row?.[column] && path.resolve(row[column]);
      if (!file || !file.startsWith(mediaDir)) return res.status(404).json({ error: '파일을 찾을 수 없습니다.', code: 'REELS_NOT_FOUND' });
      return res.sendFile(file, error => {
        if (error && !res.headersSent) res.status(404).json({ error: '파일을 찾을 수 없습니다.', code: 'REELS_NOT_FOUND' });
      });
    });
  }

  for (const [action, status] of [['approve', 'approved'], ['discard', 'discarded']]) {
    app.post(`/api/reels/episodes/:id/${action}`, (req, res) => {
      if (guardProduction(res)) return;
      const id = intId(req.params.id);
      if (!id) return res.status(400).json({ error: '편 id가 올바르지 않습니다.', code: 'REELS_ID_INVALID' });
      return act(res, () => {
        const result = episodes.decide(id, status);
        // 승인 뒤 업로드 행을 만든다(이미 있으면 그대로). 플래그가 꺼져 있으면 아무것도 만들지 않는다.
        if (status === 'approved' && uploads) {
          if (config.youtubeUploadEnabled) uploads.enqueue(id, 'youtube');
          if (config.instagramUploadEnabled) uploads.enqueue(id, 'instagram');
          if (config.youtubeUploadEnabled || config.instagramUploadEnabled) onUpload?.();
        }
        return result;
      });
    });
  }

  // retry: failed → pending, manual: failed → done(손으로 올림). 편이나 업로드가 없으면 404, failed가 아니면 409.
  for (const action of ['retry', 'manual']) {
    app.post(`/api/reels/episodes/:id/uploads/:platform/${action}`, (req, res) => {
      if (guardProduction(res)) return;
      const platform = req.params.platform;
      if (platform !== 'youtube' && platform !== 'instagram') return res.status(404).json({ error: '업로드를 찾을 수 없습니다.', code: 'REELS_NOT_FOUND' });
      const id = intId(req.params.id);
      if (!id) return res.status(400).json({ error: '편 id가 올바르지 않습니다.', code: 'REELS_ID_INVALID' });
      return act(res, () => {
        if (!uploads) throw Object.assign(new Error('업로드를 찾을 수 없습니다.'), { code: 'REELS_NOT_FOUND' });
        if (action === 'manual') return uploads.markManual(id, platform);
        const result = uploads.retry(id, platform);
        onUpload?.();
        return result;
      });
    });
  }

  // 받으면 04:00 창과 무관하게 바로 돈다(onRevise가 워커를 깨운다).
  app.post('/api/reels/episodes/:id/revise', (req, res) => {
    if (guardProduction(res)) return;
    const id = intId(req.params.id);
    if (!id) return res.status(400).json({ error: '편 id가 올바르지 않습니다.', code: 'REELS_ID_INVALID' });
    return act(res, () => {
      const result = episodes.requestRevision(id, req.body?.note);
      onRevise?.();
      return result;
    });
  });
}

module.exports = { registerReelsRoutes };
