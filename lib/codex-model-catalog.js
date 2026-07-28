'use strict';

const { spawn } = require('node:child_process');
const readline = require('node:readline');

const CODEX_CATALOG_SURFACE = 'codex_subscription';
const CODEX_CATALOG_PAYLOAD_VERSION = 1;

function safeString(value, max = 240) {
  const text = String(value || '').trim();
  return text ? text.slice(0, max) : null;
}

function normalizeEfforts(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => {
      if (typeof item === 'string') return { reasoningEffort: item, description: null };
      const reasoningEffort = safeString(item?.reasoningEffort, 40);
      if (!reasoningEffort) return null;
      return {
        reasoningEffort,
        description: safeString(item?.description, 160),
      };
    })
    .filter(Boolean);
}

function normalizeCodexModels(rows) {
  const byId = new Map();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const id = safeString(raw?.id || raw?.model, 120);
    if (!id || byId.has(id) || raw?.hidden === true) continue;
    byId.set(id, {
      id,
      model: safeString(raw?.model, 120) || id,
      displayName: safeString(raw?.displayName, 120) || id,
      description: safeString(raw?.description, 240),
      hidden: false,
      defaultReasoningEffort: safeString(raw?.defaultReasoningEffort, 40),
      supportedReasoningEfforts: normalizeEfforts(raw?.supportedReasoningEfforts),
      inputModalities: Array.isArray(raw?.inputModalities)
        ? raw.inputModalities.map(item => safeString(item, 40)).filter(Boolean)
        : ['text', 'image'],
      supportsPersonality: raw?.supportsPersonality === true,
      isDefault: raw?.isDefault === true,
      upgrade: safeString(raw?.upgrade, 120),
    });
  }
  return [...byId.values()];
}

function appServerError(message, code = 'CODEX_MODEL_LIST_FAILED') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function listCodexModelsViaAppServer({
  codexBin,
  cwd = process.cwd(),
  env = process.env,
  timeoutMs = 10_000,
  limit = 100,
  spawnImpl = spawn,
}) {
  if (!codexBin) throw new TypeError('CODEX_BIN이 필요합니다.');
  return new Promise((resolve, reject) => {
    const child = spawnImpl(codexBin, ['app-server'], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = readline.createInterface({ input: child.stdout });
    let stderr = '';
    let settled = false;
    let initialized = false;
    let nextRequestId = 1;
    let pendingModelRequestId = null;
    const rows = [];

    const timer = setTimeout(() => {
      finish(appServerError('Codex model/list 시간이 초과되었습니다.', 'CODEX_MODEL_LIST_TIMEOUT'));
    }, Math.max(100, Number(timeoutMs) || 10_000));
    timer.unref?.();

    function cleanup() {
      clearTimeout(timer);
      lines.close();
      child.stdout?.removeAllListeners?.();
      child.stderr?.removeAllListeners?.();
      child.removeAllListeners?.('error');
      child.removeAllListeners?.('exit');
      if (!child.killed) child.kill?.('SIGTERM');
    }

    function finish(error, value) {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    }

    function send(message) {
      if (settled || child.stdin?.destroyed) return;
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    function requestPage(cursor = null) {
      pendingModelRequestId = nextRequestId;
      nextRequestId += 1;
      send({
        method: 'model/list',
        id: pendingModelRequestId,
        params: {
          limit,
          includeHidden: false,
          ...(cursor ? { cursor } : {}),
        },
      });
    }

    child.stderr?.on('data', chunk => {
      stderr = `${stderr}${String(chunk)}`.slice(-1000);
    });
    child.once('error', error => {
      finish(appServerError(
        `Codex app-server 실행 실패: ${error?.code || error?.name || 'SPAWN_ERROR'}`,
        'CODEX_APP_SERVER_SPAWN_FAILED',
      ));
    });
    child.once('exit', code => {
      if (!settled) {
        finish(appServerError(
          `Codex app-server가 model/list 전에 종료되었습니다: ${code ?? 'unknown'}${stderr ? ` (${stderr.trim().slice(0, 160)})` : ''}`,
          'CODEX_APP_SERVER_EXITED',
        ));
      }
    });

    lines.on('line', line => {
      if (settled || !line.trim()) return;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        finish(appServerError('Codex app-server가 잘못된 JSONL을 반환했습니다.', 'CODEX_APP_SERVER_INVALID_JSON'));
        return;
      }
      if (message.id === 0 && !initialized) {
        if (message.error) {
          finish(appServerError('Codex app-server 초기화에 실패했습니다.', 'CODEX_APP_SERVER_INIT_FAILED'));
          return;
        }
        initialized = true;
        send({ method: 'initialized', params: {} });
        requestPage();
        return;
      }
      if (message.id !== pendingModelRequestId) return;
      if (message.error) {
        finish(appServerError(
          safeString(message.error?.message, 200) || 'Codex model/list가 실패했습니다.',
          'CODEX_MODEL_LIST_FAILED',
        ));
        return;
      }
      const page = message.result || {};
      if (Array.isArray(page.data)) rows.push(...page.data);
      if (page.nextCursor) {
        requestPage(page.nextCursor);
        return;
      }
      finish(null, normalizeCodexModels(rows));
    });

    send({
      method: 'initialize',
      id: 0,
      params: {
        clientInfo: {
          name: 'galpi',
          title: 'Galpi',
          version: '1.0.0',
        },
      },
    });
  });
}

async function refreshCodexModelCatalog({
  store,
  listModels,
  now = () => Math.floor(Date.now() / 1000),
}) {
  store.recordAttempt(CODEX_CATALOG_SURFACE);
  try {
    const models = normalizeCodexModels(await listModels());
    if (models.length === 0) {
      throw appServerError('표시 가능한 Codex 모델이 없습니다.', 'CODEX_MODEL_LIST_EMPTY');
    }
    return store.saveSuccess(CODEX_CATALOG_SURFACE, {
      schemaVersion: CODEX_CATALOG_PAYLOAD_VERSION,
      refreshedAt: now(),
      models,
    }, {
      payloadVersion: CODEX_CATALOG_PAYLOAD_VERSION,
    });
  } catch (error) {
    store.saveFailure(CODEX_CATALOG_SURFACE, error);
    throw error;
  }
}

module.exports = {
  CODEX_CATALOG_SURFACE,
  listCodexModelsViaAppServer,
  normalizeCodexModels,
  refreshCodexModelCatalog,
};
