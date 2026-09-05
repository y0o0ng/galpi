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
  parseStableOpenAIChatModelId,
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

test('OpenAI discovery accepts stable GPT aliases independently of auto policy', () => {
  assert.deepEqual(
    normalizeAvailableOpenAIModels([
      { id: 'gpt-5.6-terra', created: 2, owned_by: 'openai' },
      { id: 'gpt-5.7-terra', created: 3, owned_by: 'openai' },
      { id: 'gpt-5.6-sol-2026-07-01' },
      { id: 'gpt-5.6-terra-preview' },
      { id: 'text-embedding-3-small' },
      { id: 'gpt-5.6-luna' },
      { id: 'gpt-6-astra', created: 4 },
      { id: 'gpt-future-family' },
      { id: 'gpt-audio' },
      { id: 'gpt-image-1' },
      { id: 'gpt-6-astra-2026-09-01' },
      { id: 'gpt-preview-future' },
      { id: 'gpt-future-preview-alias' },
      { id: 'ft:gpt-6-astra:custom' },
      { id: 'o3' },
    ]).map(model => model.id),
    ['gpt-6-astra', 'gpt-5.7-terra', 'gpt-5.6-terra', 'gpt-5.6-luna',
      'gpt-audio', 'gpt-future-family', 'gpt-image-1'],
  );
  for (const [tier, role] of [['sol', 'quality'], ['terra', 'balanced'], ['luna', 'fast']]) {
    assert.equal(parseStableOpenAIChatModelId(`gpt-5.6-${tier}`).role, role);
  }
  for (const id of ['gpt-6-astra', 'gpt-future-family']) {
    assert.equal(parseStableOpenAIChatModelId(id), null);
    assert.equal(normalizeAvailableOpenAIModels([{ id }])[0].role, null);
  }
});

test('OpenAI catalog keeps a compatible older active model when a newer probe fails', async () => {
  const previousPayload = {
    probeReasoningEffort: 'medium',
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
  assert.deepEqual(requests[0].reasoning, { effort: 'medium', context: 'current_turn' });
  assert.equal(requests[0].max_output_tokens, 8192);
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
  assert.deepEqual(attempts, ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-terra']);
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

test('all compatible aliases are manual options while auto uses known semantic versions', async () => {
  const models = [
    { id: 'gpt-6-astra', created: 100 },
    { id: 'gpt-future-family', created: 100 },
    { id: 'gpt-5.9-terra', created: 90 },
    { id: 'gpt-5.10-terra', created: 1 },
    { id: 'gpt-5.6-sol' },
    { id: 'gpt-5.6-luna' },
  ];
  const textCalls = [];
  const imageCalls = [];
  const payload = await buildOpenAIModelCatalogPayload({
    models,
    probeModel: async id => { textCalls.push(id); },
    probeImageInput: async id => { imageCalls.push(id); },
  });
  assert.deepEqual(textCalls, payload.models.map(model => model.id));
  assert.deepEqual(imageCalls, textCalls);
  assert.equal(payload.schemaVersion, 2);
  assert.deepEqual(payload.active, {
    quality: 'gpt-5.6-sol', balanced: 'gpt-5.10-terra', fast: 'gpt-5.6-luna',
  });
  assert.deepEqual(payload.activeImage, payload.active);
  const catalogRow = { generation: 1, payload };
  const view = buildOpenAIChatCatalogView({ catalogRow });
  assert.deepEqual(view.options.map(option => option.value), [
    'auto:balanced', 'gpt-6-astra', 'gpt-future-family', 'gpt-5.9-terra',
    'gpt-5.10-terra', 'gpt-5.6-luna', 'gpt-5.6-sol',
  ]);
  assert.deepEqual(view.options.slice(1).map(option => option.label), [
    'GPT-6 Astra', 'GPT Future Family', 'GPT-5.9 Terra',
    'GPT-5.10 Terra', 'GPT-5.6 Luna', 'GPT-5.6 Sol',
  ]);
  assert.equal(view.options[1].description, '검증된 GPT 모델');
  assert.equal(view.options[1].tier, null);
  for (const requireImageInput of [false, true]) {
    assert.equal(resolveChatModelSelection({ catalogRow, requireImageInput }).modelId, 'gpt-5.10-terra');
    assert.equal(resolveChatModelSelection({
      catalogRow, requireImageInput, selection: 'gpt-6-astra',
    }).modelId, 'gpt-6-astra');
  }
  const reordered = await buildOpenAIModelCatalogPayload({
    models: [...models].reverse(), previousPayload: payload,
    probeModel: async () => assert.fail('same-version compatible cache must be reused'),
    probeImageInput: async () => assert.fail('image cache must be reused'),
  });
  assert.deepEqual(reordered.models, payload.models);
});

test('unknown rejections are cached, transient failures retry, and exact selections fail closed', async () => {
  const models = ['gpt-6-astra', 'gpt-future-rejected', 'gpt-future-flaky'].map(id => ({ id }));
  const attempts = [];
  const first = await buildOpenAIModelCatalogPayload({
    models,
    probeModel: async id => {
      attempts.push(id);
      if (id === 'gpt-future-rejected') throw Object.assign(new Error('unsupported'), { status: 400 });
      if (id === 'gpt-future-flaky') throw Object.assign(new Error('temporary'), { status: 503 });
    },
    probeImageInput: async id => {
      assert.equal(id, 'gpt-6-astra');
      throw Object.assign(new Error('no images'), { status: 400 });
    },
  });
  assert.equal(attempts.filter(id => id === 'gpt-future-rejected').length, 1);
  assert.equal(attempts.filter(id => id === 'gpt-future-flaky').length, 2);
  const catalogRow = { generation: 1, payload: first };
  assert.deepEqual(buildOpenAIChatCatalogView({ catalogRow }).options.map(option => option.value),
    ['auto:balanced', 'gpt-6-astra']);
  assert.deepEqual(first.active, { quality: null, balanced: null, fast: null });
  assert.deepEqual(first.activeImage, first.active);
  assert.throws(() => resolveChatModelSelection({
    catalogRow, selection: 'gpt-6-astra', requireImageInput: true,
  }), { code: 'MODEL_IMAGE_UNSUPPORTED' });
  // A saved exact choice disappearing on refresh cannot switch to auto/bootstrap.
  assert.throws(() => resolveChatModelSelection({
    catalogRow: { payload: { ...first, models: [] } }, selection: 'gpt-6-astra',
  }), { code: 'MODEL_UNAVAILABLE' });
  const retryCalls = [];
  const second = await buildOpenAIModelCatalogPayload({
    models, previousPayload: first,
    probeModel: async id => { retryCalls.push(id); },
    probeImageInput: async id => { assert.equal(id, 'gpt-future-flaky'); },
  });
  assert.deepEqual(retryCalls, ['gpt-future-flaky']);
  assert.equal(second.models.find(model => model.id === 'gpt-future-rejected').probeStatus, 'rejected');
  assert.equal(second.models.find(model => model.id === 'gpt-future-flaky').probeStatus, 'compatible');
});

test('old payloads remain readable and probes are revalidated when protocol or effort changes', async () => {
  const old = {
    schemaVersion: 1,
    models: [{ id: 'gpt-5.6-terra', probeVersion: 2, probeStatus: 'compatible' }],
    active: { balanced: 'gpt-5.6-terra' },
  };
  const catalogRow = { generation: 1, payload: old };
  assert.equal(resolveChatModelSelection({ catalogRow }).modelId, 'gpt-5.6-terra');
  assert.equal(buildOpenAIChatCatalogView({ catalogRow }).options[1].value, 'gpt-5.6-terra');
  let textCalls = 0;
  let imageCalls = 0;
  const refresh = previousPayload => buildOpenAIModelCatalogPayload({
    models: [{ id: 'gpt-5.6-terra' }], previousPayload, reasoningEffort: 'medium',
    probeModel: async () => { textCalls += 1; },
    probeImageInput: async () => { imageCalls += 1; },
  });
  const current = await refresh(old);
  assert.equal(current.probeVersion, 3);
  assert.equal(current.probeReasoningEffort, 'medium');
  await refresh(current);
  assert.equal(textCalls, 1);
  assert.equal(imageCalls, 1);
  await refresh({ ...current, probeReasoningEffort: 'none' });
  assert.equal(textCalls, 2);
  assert.equal(imageCalls, 2);
});

test('discovery refresh probes an unknown model with the configured chat effort', async () => {
  const db = createDatabase();
  const store = createModelCatalogStore(db);
  const requests = [];
  const client = {
    models: { list: async () => ({ data: [{ id: 'gpt-6-astra' }] }) },
    responses: { create: async request => {
      requests.push(structuredClone(request));
      assert.deepEqual(request.reasoning, { effort: 'high', context: 'current_turn' });
      assert.equal(request.max_output_tokens, 8192);
      if (requests.length === 1) return {
        status: 'completed', output: [{ type: 'function_call', name: 'galpi_model_probe',
          call_id: 'unknown_exact', arguments: '{"nonce":"galpi"}' }],
      };
      return { status: 'completed', model: request.model, output_text: 'ok' };
    } },
  };
  try {
    const row = await refreshOpenAIModelCatalog({ store, client, reasoningEffort: 'high' });
    assert.equal(requests.length, 3);
    assert.equal(requests[1].input.at(-1).call_id, 'unknown_exact');
    assert.equal(requests[2].input[0].content.at(-1).type, 'input_image');
    assert.equal(row.payloadVersion, 2);
    assert.equal(row.payload.models[0].imageProbeStatus, 'compatible');
    await refreshOpenAIModelCatalog({ store, client, reasoningEffort: 'high' });
    assert.equal(requests.length, 3);
  } finally { db.close(); }
});
