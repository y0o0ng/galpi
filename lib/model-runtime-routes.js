'use strict';

const {
  CHAT_SELECTION_AUTO,
  buildOpenAIChatCatalogView,
} = require('./openai-model-catalog');
const { CODEX_CATALOG_SURFACE } = require('./codex-model-catalog');

function catalogStatus(row) {
  if (!row?.lastSuccessAt || !row.payload) return 'empty';
  if (row.lastErrorAt && row.lastErrorAt >= row.lastSuccessAt) return 'stale';
  return 'fresh';
}

function safeCodexRunnerHealth(runner) {
  const value = runner && typeof runner === 'object' ? runner : {};
  return {
    mode: String(value.mode || 'unknown').slice(0, 40),
    ok: value.ok === true,
    checkedAt: value.checkedAt || null,
    version: value.version ? String(value.version).slice(0, 120) : null,
    login: value.login ? 'available' : null,
    errorCode: value.error ? 'CODEX_RUNNER_UNAVAILABLE' : null,
  };
}

function buildCodexCatalogView({ catalogRow, settings, runner }) {
  return {
    source: CODEX_CATALOG_SURFACE,
    models: Array.isArray(catalogRow?.payload?.models) ? catalogRow.payload.models : [],
    settings: {
      general: settings.get('codex.general_model'),
      deep: settings.get('codex.deep_model'),
    },
    catalog: {
      status: catalogRow ? catalogStatus(catalogRow) : 'empty',
      generation: catalogRow?.generation || 0,
      lastAttemptAt: catalogRow?.lastAttemptAt || null,
      lastSuccessAt: catalogRow?.lastSuccessAt || null,
      lastErrorCode: catalogRow?.lastErrorCode || null,
    },
    runner: safeCodexRunnerHealth(runner),
  };
}

function publicRefreshError(error) {
  return {
    code: String(error?.code || error?.name || 'MODEL_CATALOG_REFRESH_FAILED')
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '_')
      .slice(0, 80),
  };
}

function settingVersion(req, bodyKey = 'version') {
  const rawHeader = String(req.get?.('if-match') || '').trim();
  const raw = rawHeader
    ? rawHeader.replace(/^W\//, '').replace(/^"|"$/g, '')
    : req.body?.[bodyKey];
  const version = Number(raw);
  return Number.isSafeInteger(version) && version > 0 ? version : null;
}

function routeError(res, error) {
  const code = String(error?.code || 'MODEL_SETTING_UPDATE_FAILED');
  const status = {
    INVALID_SETTING_VERSION: 428,
    SETTING_VERSION_CONFLICT: 409,
    SETTING_NOT_FOUND: 404,
    INVALID_MODEL_SELECTION: 422,
    MODEL_UNAVAILABLE: 409,
  }[code] || 500;
  return res.status(status).json({
    error: error?.message || '모델 설정을 변경하지 못했습니다.',
    code,
    ...(error?.current ? { current: error.current } : {}),
  });
}

function assertChatSelectionAvailable(selection, view) {
  const value = String(selection || '');
  if (!view.options.some(option => option.value === value)) {
    const error = new Error(
      value === CHAT_SELECTION_AUTO
        ? '자동 모델을 현재 사용할 수 없습니다.'
        : '선택한 채팅 모델을 현재 사용할 수 없습니다.',
    );
    error.code = 'MODEL_UNAVAILABLE';
    throw error;
  }
}

function assertCodexModelAvailable(modelId, catalogRow) {
  const value = String(modelId || '').trim();
  const available = (Array.isArray(catalogRow?.payload?.models)
    ? catalogRow.payload.models
    : []).some(model => model?.id === value && model.hidden !== true);
  if (!available) {
    const error = new Error('선택한 Codex 모델을 현재 사용할 수 없습니다.');
    error.code = 'MODEL_UNAVAILABLE';
    throw error;
  }
}

function registerModelRuntimeRoutes({
  app,
  settings,
  catalogs,
  bootstrapChatModel,
  reasoningEffort,
  getCodexRunnerHealth,
  refreshOpenAI,
  refreshCodex,
}) {
  app.get('/api/models/chat', (_req, res) => {
    const view = buildOpenAIChatCatalogView({
      catalogRow: catalogs.get('openai_api'),
      setting: settings.get('chat.model_selection'),
      bootstrapModel: bootstrapChatModel,
      reasoningEffort,
    });
    res.json(view);
  });

  app.get('/api/models/codex', (_req, res) => {
    res.json(buildCodexCatalogView({
      catalogRow: catalogs.get(CODEX_CATALOG_SURFACE),
      settings,
      runner: getCodexRunnerHealth(),
    }));
  });

  app.put('/api/settings/chat-model', (req, res) => {
    try {
      const version = settingVersion(req);
      if (!version) {
        const error = new Error('현재 채팅 모델 설정 version이 필요합니다.');
        error.code = 'INVALID_SETTING_VERSION';
        throw error;
      }
      const selection = String(req.body?.selection || '').trim();
      const currentView = buildOpenAIChatCatalogView({
        catalogRow: catalogs.get('openai_api'),
        setting: settings.get('chat.model_selection'),
        bootstrapModel: bootstrapChatModel,
        reasoningEffort,
      });
      assertChatSelectionAvailable(selection, currentView);
      const updated = settings.update('chat.model_selection', selection, version);
      const view = buildOpenAIChatCatalogView({
        catalogRow: catalogs.get('openai_api'),
        setting: updated,
        bootstrapModel: bootstrapChatModel,
        reasoningEffort,
      });
      return res.json({ ...view, appliesFrom: 'next_response' });
    } catch (error) {
      return routeError(res, error);
    }
  });

  app.put('/api/settings/codex-models', (req, res) => {
    try {
      const generalVersion = settingVersion(req, 'generalVersion');
      const deepVersion = Number(req.body?.deepVersion);
      if (!generalVersion || !Number.isSafeInteger(deepVersion) || deepVersion < 1) {
        const error = new Error('현재 Codex 모델 설정 version이 필요합니다.');
        error.code = 'INVALID_SETTING_VERSION';
        throw error;
      }
      const generalModel = String(req.body?.generalModel || '').trim();
      const deepModel = String(req.body?.deepModel || '').trim();
      const catalogRow = catalogs.get(CODEX_CATALOG_SURFACE);
      assertCodexModelAvailable(generalModel, catalogRow);
      assertCodexModelAvailable(deepModel, catalogRow);
      settings.updateMany([
        {
          key: 'codex.general_model',
          value: generalModel,
          expectedVersion: generalVersion,
        },
        {
          key: 'codex.deep_model',
          value: deepModel,
          expectedVersion: deepVersion,
        },
      ]);
      return res.json({
        ...buildCodexCatalogView({
          catalogRow,
          settings,
          runner: getCodexRunnerHealth(),
        }),
        appliesFrom: 'next_job',
      });
    } catch (error) {
      return routeError(res, error);
    }
  });

  app.post('/api/models/refresh', async (req, res) => {
    const surface = String(req.body?.surface || 'all');
    if (!['all', 'chat', 'codex'].includes(surface)) {
      return res.status(422).json({
        error: 'surface는 all, chat, codex 중 하나여야 합니다.',
        code: 'INVALID_MODEL_CATALOG_SURFACE',
      });
    }
    const tasks = [];
    if (surface === 'all' || surface === 'chat') {
      tasks.push(['chat', refreshOpenAI]);
    }
    if (surface === 'all' || surface === 'codex') {
      tasks.push(['codex', refreshCodex]);
    }

    const results = {};
    for (const [name, refresh] of tasks) {
      try {
        const row = await refresh();
        results[name] = {
          success: true,
          generation: row.generation,
          lastSuccessAt: row.lastSuccessAt,
        };
      } catch (error) {
        results[name] = {
          success: false,
          error: publicRefreshError(error),
        };
      }
    }
    const success = Object.values(results).every(result => result.success);
    return res.status(success ? 200 : 502).json({ success, results });
  });
}

module.exports = {
  buildCodexCatalogView,
  routeError,
  registerModelRuntimeRoutes,
  safeCodexRunnerHealth,
  settingVersion,
};
