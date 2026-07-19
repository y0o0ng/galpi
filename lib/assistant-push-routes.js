'use strict';

const { AssistantPushError } = require('./assistant-push');
const { publicAssistantPushConfig } = require('./assistant-push-config');

function registerAssistantPushRoutes({ app, service, config }) {
  if (!app?.get || !app?.post || !app?.delete) throw new TypeError('Express app이 필요합니다.');
  if (!service?.register || !service?.revoke) throw new TypeError('Push service가 필요합니다.');
  if (!config || typeof config !== 'object') throw new TypeError('Push 설정이 필요합니다.');

  function requireEnabled(_req, res, next) {
    if (!config.enabled) {
      return res.status(503).json({
        error: 'Web Push가 아직 활성화되지 않았습니다.',
        code: 'WEB_PUSH_DISABLED',
      });
    }
    return next();
  }

  function requireJson(req, res, next) {
    if (!req.is('application/json')) {
      return res.status(415).json({
        error: 'Content-Type은 application/json이어야 합니다.',
        code: 'JSON_REQUIRED',
      });
    }
    return next();
  }

  function sendError(res, error) {
    if (error instanceof AssistantPushError) {
      return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }
    console.error(`Push API 오류: ${error?.code || error?.name || 'UNKNOWN'}`);
    return res.status(500).json({
      error: 'Push 처리 중 서버 오류가 발생했습니다.',
      code: 'PUSH_SERVER_ERROR',
    });
  }

  app.get('/api/push/config', (_req, res) => {
    return res.json(publicAssistantPushConfig(config));
  });

  app.post('/api/push/subscriptions', requireEnabled, requireJson, (req, res) => {
    try {
      const result = service.register(req.body);
      return res.status(result.replayed ? 200 : 201).json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.delete('/api/push/subscriptions/:id', requireEnabled, (req, res) => {
    try {
      return res.json(service.revoke(req.params.id));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.use((error, req, res, next) => {
    const isPushPath = /^\/api\/push(?:\/|$)/.test(req.path);
    if (isPushPath && error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      return res.status(400).json({
        error: '올바른 JSON 요청 본문이 필요합니다.',
        code: 'INVALID_JSON',
      });
    }
    return next(error);
  });
}

module.exports = { registerAssistantPushRoutes };
