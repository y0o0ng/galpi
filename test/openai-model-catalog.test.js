'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const { createModelCatalogStore } = require('../lib/model-catalog-store');
const {
  CHAT_SELECTION_AUTO,
  OPENAI_PROBE_VERSION,
  classifyProbeFailure,
  buildOpenAIChatCatalogView,
  buildOpenAIModelCatalogPayload,
  normalizeAvailableOpenAIModels,
  probeOpenAIImageInput,
  probeOpenAIResponsesModel,
  refreshOpenAIModelCatalog,
  resolveChatModelSelection,
} = require('../lib/openai-model-catalog');

function createDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, model TEXT, created_at INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY, filename TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
      note_type TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
      codex_status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE codex_jobs (
      id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending',
      note_filenames_json TEXT NOT NULL, attempt_count INTEGER NOT NULL DEFAULT 0,
      error TEXT, created_at INTEGER NOT NULL DEFAULT 1, started_at INTEGER, finished_at INTEGER
    );
    CREATE TABLE auto_save_decisions (id INTEGER PRIMARY KEY, decision TEXT NOT NULL, action TEXT);
    CREATE TABLE note_chunks (
      id INTEGER PRIMARY KEY, chunk_id TEXT UNIQUE NOT NULL, note_filename TEXT NOT NULL,
      note_title TEXT NOT NULL, chunk_type TEXT NOT NULL, content TEXT NOT NULL,
      source_session TEXT, source_user_message INTEGER, source_assistant_message INTEGER,
      embedding TEXT, created_at INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE assistant_retrieval_shadow_runs (
      id INTEGER PRIMARY KEY, mode TEXT NOT NULL, notes_json TEXT NOT NULL,
      chunks_json TEXT NOT NULL, context_chars INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 1
    );
  `);
  runDatabaseMigrations(db);
  return db;
}

test('OpenAI catalog recognizes only stable Sol, Terra, and Luna model IDs', () => {
  assert.deepEqual(
    normalizeAvailableOpenAIModels([
      { id: 'gpt-5.6-terra', created: 2, owned_by: 'openai' },
      { id: 'gpt-5.7-terra', created: 3, owned_by: 'openai' },
      { id: 'gpt-5.6-sol-2026-07-01' },
      { id: 'gpt-5.6-terra-preview' },
      { id: 'text-embedding-3-small' },
      { id: 'gpt-5.6-luna' },
    ]).map(model => model.id),
    ['gpt-5.7-terra', 'gpt-5.6-luna', 'gpt-5.6-terra'],
  );
});

test('OpenAI catalog keeps a compatible older active model when a newer probe fails', async () => {
  const previousPayload = {
    models: [{
      id: 'gpt-5.6-terra',
      role: 'balanced',
      probeVersion: OPENAI_PROBE_VERSION,
      probeStatus: 'compatible',
      probeErrorCode: null,
      probedAt: 10,
    }],
    active: { balanced: 'gpt-5.6-terra' },
  };
  const payload = await buildOpenAIModelCatalogPayload({
    models: [
      { id: 'gpt-5.7-terra' },
      { id: 'gpt-5.6-terra' },
    ],
    previousPayload,
    probeModel: async modelId => {
      assert.equal(modelId, 'gpt-5.7-terra');
      const error = new Error('rejected');
      error.code = 'unsupported';
      throw error;
    },
    now: () => 20,
  });

  assert.equal(payload.models.find(model => model.id === 'gpt-5.7-terra').probeStatus, 'rejected');
  assert.equal(payload.active.balanced, 'gpt-5.6-terra');
});

test('OpenAI catalog refresh preserves last-known-good after Models API failure', async () => {
  const db = createDatabase();
  const store = createModelCatalogStore(db, { now: () => 50 });
  const client = {
    models: {
      async list() {
        return {
          data: [{ id: 'gpt-5.6-terra' }],
        };
      },
    },
  };
  const first = await refreshOpenAIModelCatalog({
    store,
    client,
    probeModel: async () => ({ modelId: 'gpt-5.6-terra' }),
    now: () => 50,
  });
  assert.equal(first.payload.active.balanced, 'gpt-5.6-terra');

  client.models.list = async () => {
    const error = new Error('down');
    error.code = 'ETIMEDOUT';
    throw error;
  };
  await assert.rejects(
    refreshOpenAIModelCatalog({ store, client, now: () => 60 }),
    /down/,
  );
  const stale = store.get('openai_api');
  assert.equal(stale.payload.active.balanced, 'gpt-5.6-terra');
  assert.equal(stale.generation, 1);
  assert.equal(stale.lastErrorCode, 'ETIMEDOUT');
  db.close();
});

test('Responses compatibility probe preserves output items and exact call_id', async () => {
  const requests = [];
  const client = {
    responses: {
      async create(request) {
        requests.push(structuredClone(request));
        if (requests.length === 1) {
          return {
            status: 'completed',
            output: [{
              type: 'function_call',
              id: 'fc_1',
              call_id: 'call_exact',
              name: 'galpi_model_probe',
              arguments: '{"nonce":"galpi"}',
            }],
          };
        }
        return {
          status: 'completed',
          model: 'gpt-5.6-terra',
          output_text: '호환됨',
          output: [{
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '호환됨' }],
          }],
        };
      },
    },
  };

  const result = await probeOpenAIResponsesModel(client, 'gpt-5.6-terra');
  assert.equal(result.modelId, 'gpt-5.6-terra');
  assert.equal(requests[0].store, false);
  assert.equal(requests[0].reasoning.effort, 'none');
  assert.equal(requests[1].input[1].type, 'function_call');
  assert.equal(requests[1].input[2].type, 'function_call_output');
  assert.equal(requests[1].input[2].call_id, 'call_exact');
});

test('chat resolver auto-moves but exact selections must be compatible', () => {
  const catalogRow = {
    generation: 4,
    payload: {
      active: { balanced: 'gpt-5.7-terra' },
      models: [
        { id: 'gpt-5.7-terra', probeStatus: 'compatible' },
        { id: 'gpt-5.6-sol', probeStatus: 'compatible' },
      ],
    },
  };
  assert.deepEqual(
    resolveChatModelSelection({ selection: CHAT_SELECTION_AUTO, catalogRow }),
    {
      selection: CHAT_SELECTION_AUTO,
      modelId: 'gpt-5.7-terra',
      catalogGeneration: 4,
      runtimeGeneration: 'gpt-single-v1',
      reasoningEffort: 'medium',
    },
  );
  assert.equal(
    resolveChatModelSelection({ selection: 'gpt-5.6-sol', catalogRow }).modelId,
    'gpt-5.6-sol',
  );
  assert.throws(
    () => resolveChatModelSelection({ selection: 'gpt-5.5-terra', catalogRow }),
    error => error.code === 'MODEL_UNAVAILABLE',
  );
});

test('image probe is judged separately so a text-only model stays usable', async () => {
  const probed = [];
  const payload = await buildOpenAIModelCatalogPayload({
    models: [{ id: 'gpt-5.6-terra' }, { id: 'gpt-5.6-luna' }],
    probeModel: async () => {},
    probeImageInput: async modelId => {
      probed.push(modelId);
      if (modelId === 'gpt-5.6-luna') {
        const error = new Error('no image input');
        error.status = 400;
        throw error;
      }
    },
    now: () => 30,
  });

  assert.deepEqual(probed.sort(), ['gpt-5.6-luna', 'gpt-5.6-terra']);
  const terra = payload.models.find(model => model.id === 'gpt-5.6-terra');
  const luna = payload.models.find(model => model.id === 'gpt-5.6-luna');
  assert.equal(terra.imageProbeStatus, 'compatible');
  assert.equal(luna.imageProbeStatus, 'rejected');
  // 이미지에서 거부돼도 텍스트 채팅 후보로는 남는다.
  assert.equal(luna.probeStatus, 'compatible');
  assert.equal(payload.active.fast, 'gpt-5.6-luna');
  assert.equal(payload.activeImage.fast, null);
  assert.equal(payload.activeImage.balanced, 'gpt-5.6-terra');
});

test('image probe does not run on a model the text probe already rejected', async () => {
  let imageProbeCalls = 0;
  const payload = await buildOpenAIModelCatalogPayload({
    models: [{ id: 'gpt-5.6-terra' }],
    probeModel: async () => {
      throw new Error('rejected');
    },
    probeImageInput: async () => { imageProbeCalls += 1; },
    now: () => 40,
  });
  assert.equal(imageProbeCalls, 0);
  assert.equal(payload.models[0].imageProbeStatus, 'untested');
  assert.equal(payload.activeImage.balanced, null);
});

test('image probe sends one image and requires completed text back', async () => {
  const requests = [];
  const okClient = {
    responses: {
      async create(request) {
        requests.push(request);
        return { status: 'completed', model: 'gpt-5.6-terra', output_text: 'ok' };
      },
    },
  };
  assert.deepEqual(await probeOpenAIImageInput(okClient, 'gpt-5.6-terra'), {
    modelId: 'gpt-5.6-terra',
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].store, false);
  const parts = requests[0].input[0].content;
  assert.equal(parts.filter(part => part.type === 'input_image').length, 1);
  assert.match(parts.at(-1).image_url, /^data:image\/png;base64,/);

  const emptyClient = {
    responses: {
      async create() {
        return { status: 'completed', output_text: '   ' };
      },
    },
  };
  await assert.rejects(
    () => probeOpenAIImageInput(emptyClient, 'gpt-5.6-terra'),
    error => error.code === 'MODEL_IMAGE_PROBE_TEXT_MISSING',
  );
});

test('image turns resolve only to verified models and never switch silently', () => {
  const catalogRow = {
    generation: 7,
    payload: {
      active: { balanced: 'gpt-5.7-terra' },
      activeImage: { balanced: 'gpt-5.6-terra' },
      models: [
        { id: 'gpt-5.7-terra', probeStatus: 'compatible', imageProbeStatus: 'rejected' },
        { id: 'gpt-5.6-terra', probeStatus: 'compatible', imageProbeStatus: 'compatible' },
      ],
    },
  };
  assert.equal(
    resolveChatModelSelection({
      selection: CHAT_SELECTION_AUTO,
      catalogRow,
      requireImageInput: true,
    }).modelId,
    'gpt-5.6-terra',
  );
  // 고정 선택이 이미지를 못 받으면 조용히 다른 모델로 바꾸지 않고 실패한다.
  assert.throws(
    () => resolveChatModelSelection({
      selection: 'gpt-5.7-terra',
      catalogRow,
      requireImageInput: true,
    }),
    error => error.code === 'MODEL_IMAGE_UNSUPPORTED',
  );
  assert.equal(
    resolveChatModelSelection({ selection: 'gpt-5.7-terra', catalogRow }).modelId,
    'gpt-5.7-terra',
  );
  // 검증 전에는 bootstrap 모델로 흘려보내지 않는다.
  assert.throws(
    () => resolveChatModelSelection({
      selection: CHAT_SELECTION_AUTO,
      catalogRow: { generation: 0, payload: null },
      requireImageInput: true,
    }),
    error => error.code === 'MODEL_IMAGE_UNSUPPORTED',
  );
});

test('chat catalog reports bootstrap fallback before the first successful refresh', () => {
  const view = buildOpenAIChatCatalogView({
    catalogRow: {
      generation: 0,
      payload: null,
      lastAttemptAt: 100,
      lastSuccessAt: null,
      lastErrorCode: 'PROVIDER_TIMEOUT',
      lastErrorAt: 100,
    },
    setting: {
      value: CHAT_SELECTION_AUTO,
      version: 1,
    },
    bootstrapModel: 'gpt-5.6-terra',
    reasoningEffort: 'medium',
  });
  assert.equal(view.catalog.status, 'fallback');
  assert.equal(view.resolvedModelId, 'gpt-5.6-terra');
});

test('transient probe failures retry once and never harden into a rejection', async () => {
  const attempts = [];
  const payload = await buildOpenAIModelCatalogPayload({
    models: [{ id: 'gpt-5.6-terra' }, { id: 'gpt-5.6-luna' }],
    probeModel: async modelId => {
      attempts.push(modelId);
      if (modelId === 'gpt-5.6-terra' && attempts.filter(id => id === modelId).length === 1) {
        // 실제로 관측된 흔들림이다. 두 번째 호출이 빈 텍스트를 돌려줬다.
        const error = new Error('empty');
        error.code = 'MODEL_PROBE_TEXT_MISSING';
        throw error;
      }
    },
    probeImageInput: async () => {},
    now: () => 60,
  });

  // 같은 refresh 안에서 한 번 더 시도해 살아난다.
  assert.deepEqual(attempts, ['gpt-5.6-terra', 'gpt-5.6-terra', 'gpt-5.6-luna']);
  assert.equal(payload.models.find(m => m.id === 'gpt-5.6-terra').probeStatus, 'compatible');
  assert.equal(payload.activeImage.balanced, 'gpt-5.6-terra');
});

test('a probe that keeps flaking stays retryable instead of being cached as rejected', async () => {
  const flaky = async () => {
    const error = new Error('empty');
    error.code = 'MODEL_PROBE_TEXT_MISSING';
    throw error;
  };
  const first = await buildOpenAIModelCatalogPayload({
    models: [{ id: 'gpt-5.6-terra' }],
    probeModel: flaky,
    probeImageInput: async () => {},
    now: () => 70,
  });
  const terra = first.models[0];
  // rejected로 굳으면 previousProbeForModel이 재사용해 영원히 막힌다.
  assert.equal(terra.probeStatus, 'untested');
  assert.equal(terra.probeErrorCode, 'MODEL_PROBE_TEXT_MISSING');
  assert.equal(first.active.balanced, null);

  let calls = 0;
  const second = await buildOpenAIModelCatalogPayload({
    models: [{ id: 'gpt-5.6-terra' }],
    previousPayload: first,
    probeModel: async () => { calls += 1; },
    probeImageInput: async () => {},
    now: () => 80,
  });
  assert.equal(calls, 1, '다음 refresh가 다시 시도해야 한다');
  assert.equal(second.models[0].probeStatus, 'compatible');
  assert.equal(second.activeImage.balanced, 'gpt-5.6-terra');
});

test('a real capability rejection is hardened and not retried', async () => {
  const noVision = async () => {
    const error = new Error('this model does not support image input');
    error.status = 400;
    throw error;
  };
  const first = await buildOpenAIModelCatalogPayload({
    models: [{ id: 'gpt-5.6-terra' }],
    probeModel: async () => {},
    probeImageInput: noVision,
    now: () => 90,
  });
  assert.equal(first.models[0].imageProbeStatus, 'rejected');
  assert.equal(first.activeImage.balanced, null);
  // 텍스트는 계속 쓴다.
  assert.equal(first.active.balanced, 'gpt-5.6-terra');

  let imageCalls = 0;
  const second = await buildOpenAIModelCatalogPayload({
    models: [{ id: 'gpt-5.6-terra' }],
    previousPayload: first,
    probeModel: async () => {},
    probeImageInput: async () => { imageCalls += 1; },
    now: () => 100,
  });
  assert.equal(imageCalls, 0, '확정된 거부는 매번 다시 찌르지 않는다');
  assert.equal(second.models[0].imageProbeStatus, 'rejected');
});

test('probe failures are split by what they say about the model', () => {
  const cases = [
    [{ code: 'MODEL_PROBE_TEXT_MISSING' }, true],
    [{ status: 429 }, true],
    [{ status: 503 }, true],
    [{ status: 401 }, true],
    [{ name: 'AbortError' }, true],
    [{ code: 'ECONNRESET' }, true],
    [{ code: 'INCOMPLETE_MODEL_RESPONSE' }, true],
    [{ status: 400 }, false],
    [{ status: 404 }, false],
    [{ code: 'MODEL_PROBE_TOOL_MISSING' }, false],
  ];
  for (const [error, transient] of cases) {
    assert.equal(
      classifyProbeFailure(error).transient,
      transient,
      `${JSON.stringify(error)} → transient ${transient}`,
    );
  }
});
