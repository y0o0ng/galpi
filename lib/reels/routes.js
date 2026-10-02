'use strict';

// 검토 1의 세 행동(설계 v0.2 4장): 하나 선택 / 전부 거절 / 보류. 인증은 server.js의
// `app.use('/api/', requireApiToken)`가 /api/reels/* 전체에 이미 건다 — 뉴스 라우트와 같다.

function registerReelsRoutes({ app, store, config }) {
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
}

module.exports = { registerReelsRoutes };
