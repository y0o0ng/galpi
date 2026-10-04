'use strict';

const path = require('node:path');

// 검토 1의 세 행동(설계 v0.2 4장): 하나 선택 / 전부 거절 / 보류. 인증은 server.js의
// `app.use('/api/', requireApiToken)`가 /api/reels/* 전체에 이미 건다 — 뉴스 라우트와 같다.
// 검토 2(제작된 편)의 라우트는 episodes 저장소가 있을 때 더한다. 편 파일은 reelsDir/media 안에 있는 것만 내보낸다.
// 주의: `<video>` 태그는 토큰 헤더를 못 붙인다. 화면(2b-2)이 blob fetch 등으로 풀어야 한다.

function episodeJson(row) {
  const parse = text => { try { return text ? JSON.parse(text) : null; } catch { return null; } };
  return {
    id: row.id, candidateId: row.candidate_id, title: row.title, concept: row.concept, status: row.status,
    attempts: row.attempts, errorCode: row.error_code, errorDetail: row.error_detail,
    caption: row.caption, claims: parse(row.claims_json),
    videoUrl: row.video_path ? `/api/reels/episodes/${row.id}/video` : null,
    coverUrl: row.cover_path ? `/api/reels/episodes/${row.id}/cover` : null,
    createdAt: row.created_at, finishedAt: row.finished_at, decidedAt: row.decided_at,
  };
}

function registerReelsRoutes({ app, store, config, episodes = null }) {
  if (!app?.get) throw new TypeError('Express app이 필요합니다.');
  if (!store?.latestBatch) throw new TypeError('Reels 저장소가 필요합니다.');

  function guard(res) {
    if (config?.enabled) return false;
    res.status(503).json({ error: 'Reels Agent가 아직 활성화되지 않았습니다.', code: 'REELS_AGENT_DISABLED' });
    return true;
  }

  function act(res, fn) {
    try {
      return res.json(fn());
    } catch (error) {
      const status = error.code === 'REELS_NOT_FOUND' ? 404 : error.code === 'REELS_NOT_PENDING' ? 409 : 500;
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
    return res.json({ episode: row ? episodeJson(row) : null });
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
      return act(res, () => episodes.decide(id, status));
    });
  }
}

module.exports = { registerReelsRoutes };
