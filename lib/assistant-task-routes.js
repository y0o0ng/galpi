'use strict';

const { AssistantTaskError } = require('./assistant-tasks');

function registerAssistantTaskRoutes({ app, store, enabled, onTaskMutation = async () => {} }) {
  if (!app?.get || !app?.post || !app?.patch) throw new TypeError('Express app이 필요합니다.');
  if (!store?.create || !store?.list) throw new TypeError('일정 저장소가 필요합니다.');
  if (typeof onTaskMutation !== 'function') throw new TypeError('일정 후처리 함수가 올바르지 않습니다.');

  function requireEnabled(_req, res, next) {
    if (!enabled) {
      return res.status(503).json({
        error: '일정 기능이 아직 활성화되지 않았습니다.',
        code: 'TASKS_DISABLED',
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
    if (error instanceof AssistantTaskError) {
      const body = { error: error.message, code: error.code };
      if (error.task) body.task = error.task;
      return res.status(error.statusCode).json(body);
    }
    console.error(`일정 API 오류: ${error?.code || error?.name || 'UNKNOWN'}`);
    return res.status(500).json({
      error: '일정 처리 중 서버 오류가 발생했습니다.',
      code: 'TASK_SERVER_ERROR',
    });
  }

  app.get('/api/tasks', requireEnabled, (req, res) => {
    try {
      return res.json(store.list({
        view: req.query.view,
        status: req.query.status,
        limit: req.query.limit,
      }));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.get('/api/tasks/summary', requireEnabled, (req, res) => {
    try {
      return res.json(store.summary({ calendarCenter: req.query.calendarCenter }));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post('/api/tasks', requireEnabled, requireJson, (req, res) => {
    try {
      const result = store.create(req.body);
      return res.status(result.replayed ? 200 : 201).json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.patch('/api/tasks/:id', requireEnabled, requireJson, (req, res) => {
    try {
      return res.json(store.update(req.params.id, req.body));
    } catch (error) {
      return sendError(res, error);
    }
  });

  for (const action of ['complete', 'cancel', 'reopen', 'delete', 'restore']) {
    app.post(`/api/tasks/:id/${action}`, requireEnabled, requireJson, async (req, res) => {
      try {
        const result = store.transition(req.params.id, action, req.body);
        await onTaskMutation();
        return res.json(result);
      } catch (error) {
        return sendError(res, error);
      }
    });
  }

  app.post('/api/reminders/:id/acknowledge', requireEnabled, requireJson, (req, res) => {
    try {
      return res.json(store.acknowledgeReminder(req.params.id));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post('/api/reminders/:id/snooze', requireEnabled, requireJson, (req, res) => {
    try {
      return res.json(store.snoozeReminder(req.params.id, req.body));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.use((error, req, res, next) => {
    const isTaskPath = /^\/api\/(?:tasks|reminders)(?:\/|$)/.test(req.path);
    if (isTaskPath && error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      return res.status(400).json({
        error: '올바른 JSON 요청 본문이 필요합니다.',
        code: 'INVALID_JSON',
      });
    }
    return next(error);
  });
}

module.exports = { registerAssistantTaskRoutes };
