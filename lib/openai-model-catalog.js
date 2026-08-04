'use strict';

const OPENAI_CATALOG_SURFACE = 'openai_api';
const OPENAI_CATALOG_PAYLOAD_VERSION = 1;
const OPENAI_PROBE_VERSION = 2;
// 1x1 RGBA PNG. Models API는 이미지 입력 지원 여부를 알려주지 않으므로 실제로
// 한 장 보내보고 판정한다. 서명·IHDR·청크 CRC를 확인한 값이다.
const PROBE_IMAGE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const CHAT_SELECTION_AUTO = 'auto:balanced';
const CHAT_RUNTIME_GENERATION = 'gpt-single-v1';

const TIER_METADATA = {
  sol: {
    role: 'quality',
    label: '최고 품질',
    description: '깊은 토론과 복잡한 설계',
  },
  terra: {
    role: 'balanced',
    label: '균형',
    description: '성능과 비용의 균형',
  },
  luna: {
    role: 'fast',
    label: '빠름',
    description: '짧은 질의와 속도 우선',
  },
};

function compactProviderErrorCode(error, fallback = 'MODEL_PROBE_FAILED') {
  const status = Number(error?.status || error?.statusCode || 0);
  if (status === 401 || status === 403) return 'PROVIDER_AUTH_FAILED';
  if (status === 429) return 'PROVIDER_RATE_LIMITED';
  if (error?.name === 'AbortError' || error?.code === 'ETIMEDOUT') return 'PROVIDER_TIMEOUT';
  const code = String(error?.code || error?.name || fallback)
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .slice(0, 80);
  return code || fallback;
}

function parseStableOpenAIChatModelId(value) {
  const id = String(value || '').trim();
  const match = id.match(/^gpt-(\d+)\.(\d+)-(sol|terra|luna)$/);
  if (!match) return null;
  const tier = match[3];
  return {
    id,
    major: Number(match[1]),
    minor: Number(match[2]),
    tier,
    ...TIER_METADATA[tier],
  };
}

function compareParsedModels(a, b) {
  if (a.major !== b.major) return b.major - a.major;
  if (a.minor !== b.minor) return b.minor - a.minor;
  return a.id.localeCompare(b.id);
}

function normalizeAvailableOpenAIModels(models) {
  const byId = new Map();
  for (const raw of Array.isArray(models) ? models : []) {
    const parsed = parseStableOpenAIChatModelId(raw?.id);
    if (!parsed || byId.has(parsed.id)) continue;
    byId.set(parsed.id, {
      ...parsed,
      created: Number.isFinite(Number(raw.created)) ? Number(raw.created) : null,
      ownedBy: String(raw.owned_by || raw.ownedBy || '').slice(0, 120) || null,
      probeVersion: null,
      probeStatus: 'untested',
      probeErrorCode: null,
      probedAt: null,
      imageProbeStatus: 'untested',
      imageProbeErrorCode: null,
      imageProbedAt: null,
    });
  }
  return [...byId.values()].sort(compareParsedModels);
}

async function collectOpenAIModels(client) {
  if (!client?.models?.list) throw new TypeError('OpenAI Models client가 필요합니다.');
  const page = await client.models.list();
  if (page && typeof page[Symbol.asyncIterator] === 'function') {
    const rows = [];
    for await (const model of page) rows.push(model);
    return rows;
  }
  return Array.isArray(page?.data) ? page.data : [];
}

function extractResponseText(response) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }
  return (Array.isArray(response?.output) ? response.output : [])
    .filter(item => item?.type === 'message' && item.role === 'assistant')
    .flatMap(item => Array.isArray(item.content) ? item.content : [])
    .filter(part => part?.type === 'output_text' && part.text)
    .map(part => part.text)
    .join('\n')
    .trim();
}

function assertCompletedResponse(response) {
  if (response?.status && response.status !== 'completed') {
    const error = new Error(`Responses probe가 완료되지 않았습니다: ${response.status}`);
    error.code = 'INCOMPLETE_MODEL_RESPONSE';
    throw error;
  }
}

async function probeOpenAIResponsesModel(client, modelId) {
  if (!client?.responses?.create) throw new TypeError('OpenAI Responses client가 필요합니다.');
  const tools = [{
    type: 'function',
    name: 'galpi_model_probe',
    description: 'Return the supplied nonce without side effects.',
    parameters: {
      type: 'object',
      properties: {
        nonce: { type: 'string' },
      },
      required: ['nonce'],
      additionalProperties: false,
    },
    strict: true,
  }];
  const input = [{
    role: 'user',
    content: '갈피 호환성 검증이다. galpi_model_probe를 nonce "galpi"로 한 번 호출하라.',
  }];
  const baseRequest = {
    model: modelId,
    tools,
    store: false,
    max_output_tokens: 128,
    reasoning: { effort: 'none' },
  };

  const first = await client.responses.create({ ...baseRequest, input });
  assertCompletedResponse(first);
  const functionCall = (Array.isArray(first?.output) ? first.output : [])
    .find(item => item?.type === 'function_call' && item.name === 'galpi_model_probe');
  if (!functionCall?.call_id) {
    const error = new Error('Responses probe가 함수 호출을 반환하지 않았습니다.');
    error.code = 'MODEL_PROBE_TOOL_MISSING';
    throw error;
  }
  let args;
  try {
    args = JSON.parse(functionCall.arguments || '{}');
  } catch {
    const error = new Error('Responses probe 함수 인자가 JSON이 아닙니다.');
    error.code = 'MODEL_PROBE_ARGUMENTS_INVALID';
    throw error;
  }
  if (args.nonce !== 'galpi') {
    const error = new Error('Responses probe nonce가 일치하지 않습니다.');
    error.code = 'MODEL_PROBE_NONCE_MISMATCH';
    throw error;
  }

  input.push(
    ...(Array.isArray(first.output) ? first.output : []),
    {
      type: 'function_call_output',
      call_id: functionCall.call_id,
      output: JSON.stringify({ nonce: 'galpi', ok: true }),
    },
  );
  const second = await client.responses.create({ ...baseRequest, input });
  assertCompletedResponse(second);
  if (!extractResponseText(second)) {
    const error = new Error('Responses probe 최종 텍스트가 비어 있습니다.');
    error.code = 'MODEL_PROBE_TEXT_MISSING';
    throw error;
  }
  return {
    modelId: String(second.model || modelId),
    requestId: second._request_id || second.id || null,
  };
}

/**
 * 이미지 입력만 따로 판정한다. 텍스트 probe와 필드를 나눠서, 이미지를 거부하는
 * 모델도 일반 채팅에는 계속 쓸 수 있게 한다.
 */
async function probeOpenAIImageInput(client, modelId) {
  if (!client?.responses?.create) throw new TypeError('OpenAI Responses client가 필요합니다.');
  const response = await client.responses.create({
    model: modelId,
    store: false,
    max_output_tokens: 128,
    reasoning: { effort: 'none' },
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: '갈피 이미지 입력 검증이다. 이 이미지가 보이면 "ok"만 답하라.' },
        { type: 'input_image', image_url: PROBE_IMAGE_DATA_URL },
      ],
    }],
  });
  assertCompletedResponse(response);
  if (!extractResponseText(response)) {
    const error = new Error('이미지 probe 최종 텍스트가 비어 있습니다.');
    error.code = 'MODEL_IMAGE_PROBE_TEXT_MISSING';
    throw error;
  }
  return { modelId: String(response.model || modelId) };
}

function previousProbeForModel(previousPayload, modelId) {
  const row = (Array.isArray(previousPayload?.models) ? previousPayload.models : [])
    .find(model => model?.id === modelId);
  if (!row || row.probeVersion !== OPENAI_PROBE_VERSION) return null;
  if (!['compatible', 'rejected'].includes(row.probeStatus)) return null;
  return {
    probeVersion: row.probeVersion,
    probeStatus: row.probeStatus,
    probeErrorCode: row.probeErrorCode || null,
    probedAt: row.probedAt || null,
    ...(['compatible', 'rejected'].includes(row.imageProbeStatus) ? {
      imageProbeStatus: row.imageProbeStatus,
      imageProbeErrorCode: row.imageProbeErrorCode || null,
      imageProbedAt: row.imageProbedAt || null,
    } : {}),
  };
}

async function buildOpenAIModelCatalogPayload({
  models,
  previousPayload = null,
  probeModel,
  probeImageInput = null,
  now = () => Math.floor(Date.now() / 1000),
}) {
  const normalized = normalizeAvailableOpenAIModels(models);
  if (normalized.length === 0) {
    const error = new Error('인식 가능한 안정판 GPT 채팅 모델이 없습니다.');
    error.code = 'NO_COMPATIBLE_MODEL_CANDIDATES';
    throw error;
  }

  for (const model of normalized) {
    const previousProbe = previousProbeForModel(previousPayload, model.id);
    if (previousProbe) Object.assign(model, previousProbe);
  }

  for (const role of ['quality', 'balanced', 'fast']) {
    const candidate = normalized.find(model => model.role === role);
    if (!candidate || candidate.probeStatus !== 'untested') continue;
    try {
      await probeModel(candidate.id);
      Object.assign(candidate, {
        probeVersion: OPENAI_PROBE_VERSION,
        probeStatus: 'compatible',
        probeErrorCode: null,
        probedAt: now(),
      });
    } catch (error) {
      Object.assign(candidate, {
        probeVersion: OPENAI_PROBE_VERSION,
        probeStatus: 'rejected',
        probeErrorCode: compactProviderErrorCode(error),
        probedAt: now(),
      });
    }
  }

  // 이미지 probe는 텍스트가 이미 호환으로 확인된 모델에만 돌린다.
  if (probeImageInput) {
    for (const role of ['quality', 'balanced', 'fast']) {
      const candidate = normalized.find(model => model.role === role);
      if (!candidate || candidate.probeStatus !== 'compatible') continue;
      if (candidate.imageProbeStatus !== 'untested') continue;
      try {
        await probeImageInput(candidate.id);
        Object.assign(candidate, {
          imageProbeStatus: 'compatible',
          imageProbeErrorCode: null,
          imageProbedAt: now(),
        });
      } catch (error) {
        Object.assign(candidate, {
          imageProbeStatus: 'rejected',
          imageProbeErrorCode: compactProviderErrorCode(error, 'MODEL_IMAGE_PROBE_FAILED'),
          imageProbedAt: now(),
        });
      }
    }
  }

  const active = {};
  const activeImage = {};
  for (const role of ['quality', 'balanced', 'fast']) {
    active[role] = normalized.find(
      model => model.role === role && model.probeStatus === 'compatible',
    )?.id || null;
    activeImage[role] = normalized.find(
      model => model.role === role
        && model.probeStatus === 'compatible'
        && model.imageProbeStatus === 'compatible',
    )?.id || null;
  }

  return {
    schemaVersion: OPENAI_CATALOG_PAYLOAD_VERSION,
    probeVersion: OPENAI_PROBE_VERSION,
    refreshedAt: now(),
    models: normalized,
    active,
    activeImage,
  };
}

async function refreshOpenAIModelCatalog({
  store,
  client,
  probeModel = modelId => probeOpenAIResponsesModel(client, modelId),
  probeImageInput = modelId => probeOpenAIImageInput(client, modelId),
  now,
}) {
  const previous = store.get(OPENAI_CATALOG_SURFACE);
  store.recordAttempt(OPENAI_CATALOG_SURFACE);
  try {
    const models = await collectOpenAIModels(client);
    const payload = await buildOpenAIModelCatalogPayload({
      models,
      previousPayload: previous?.payload || null,
      probeModel,
      probeImageInput,
      now,
    });
    return store.saveSuccess(OPENAI_CATALOG_SURFACE, payload, {
      payloadVersion: OPENAI_CATALOG_PAYLOAD_VERSION,
    });
  } catch (error) {
    store.saveFailure(OPENAI_CATALOG_SURFACE, error);
    throw error;
  }
}

function catalogStatus(row) {
  if (!row?.lastSuccessAt || !row.payload) return 'fallback';
  if (row.lastErrorAt && row.lastErrorAt >= row.lastSuccessAt) return 'stale';
  return 'fresh';
}

function modelLabel(modelId) {
  const parsed = parseStableOpenAIChatModelId(modelId);
  if (!parsed) return modelId;
  const tier = parsed.tier[0].toUpperCase() + parsed.tier.slice(1);
  return `GPT-${parsed.major}.${parsed.minor} ${tier}`;
}

function imageUnsupportedError() {
  const error = new Error('이 모델은 이미지 입력을 지원하지 않습니다. 모델을 바꾸거나 이미지를 빼고 보내주세요.');
  error.code = 'MODEL_IMAGE_UNSUPPORTED';
  return error;
}

function resolveChatModelSelection({
  selection,
  catalogRow,
  bootstrapModel = 'gpt-5.6-terra',
  reasoningEffort = 'medium',
  // 이미지가 붙은 턴에서만 켠다. 검증되지 않으면 조용히 다른 모델로 바꾸지 않고
  // 실패시킨다.
  requireImageInput = false,
}) {
  const normalizedSelection = String(selection || CHAT_SELECTION_AUTO);
  if (normalizedSelection === CHAT_SELECTION_AUTO) {
    const modelId = requireImageInput
      ? catalogRow?.payload?.activeImage?.balanced || null
      : catalogRow?.payload?.active?.balanced || bootstrapModel;
    if (!modelId) {
      if (requireImageInput) throw imageUnsupportedError();
      const error = new Error('사용 가능한 자동 균형형 모델이 없습니다.');
      error.code = 'MODEL_CATALOG_UNAVAILABLE';
      throw error;
    }
    return {
      selection: CHAT_SELECTION_AUTO,
      modelId,
      catalogGeneration: catalogRow?.generation || 0,
      runtimeGeneration: CHAT_RUNTIME_GENERATION,
      reasoningEffort,
    };
  }

  const model = (Array.isArray(catalogRow?.payload?.models) ? catalogRow.payload.models : [])
    .find(item => item.id === normalizedSelection && item.probeStatus === 'compatible');
  if (!model) {
    const error = new Error('선택한 모델을 현재 API 계정에서 사용할 수 없습니다.');
    error.code = 'MODEL_UNAVAILABLE';
    throw error;
  }
  if (requireImageInput && model.imageProbeStatus !== 'compatible') throw imageUnsupportedError();
  return {
    selection: normalizedSelection,
    modelId: model.id,
    catalogGeneration: catalogRow.generation,
    runtimeGeneration: CHAT_RUNTIME_GENERATION,
    reasoningEffort,
  };
}

function buildOpenAIChatCatalogView({
  catalogRow,
  setting,
  bootstrapModel = 'gpt-5.6-terra',
  reasoningEffort = 'medium',
}) {
  const selection = setting?.value || CHAT_SELECTION_AUTO;
  let resolved;
  try {
    resolved = resolveChatModelSelection({
      selection,
      catalogRow,
      bootstrapModel,
      reasoningEffort,
    });
  } catch {
    resolved = {
      selection,
      modelId: null,
      catalogGeneration: catalogRow?.generation || 0,
      runtimeGeneration: CHAT_RUNTIME_GENERATION,
      reasoningEffort,
    };
  }
  const models = Array.isArray(catalogRow?.payload?.models) ? catalogRow.payload.models : [];
  const activeIds = new Set(
    Object.values(catalogRow?.payload?.active || {}).filter(Boolean),
  );
  const options = [{
    value: CHAT_SELECTION_AUTO,
    label: '자동',
    description: '검증된 최신 균형형',
    resolvedModelId: resolved.modelId,
  }];
  for (const model of models) {
    if (!activeIds.has(model.id) || model.probeStatus !== 'compatible') continue;
    options.push({
      value: model.id,
      label: modelLabel(model.id),
      description: model.description,
      tier: model.role,
      modelId: model.id,
    });
  }
  return {
    source: OPENAI_CATALOG_SURFACE,
    selection,
    selectionVersion: setting?.version || 0,
    resolvedModelId: resolved.modelId,
    reasoningEffort,
    options,
    catalog: {
      status: catalogRow ? catalogStatus(catalogRow) : 'fallback',
      generation: catalogRow?.generation || 0,
      lastAttemptAt: catalogRow?.lastAttemptAt || null,
      lastSuccessAt: catalogRow?.lastSuccessAt || null,
      lastErrorCode: catalogRow?.lastErrorCode || null,
    },
  };
}

module.exports = {
  CHAT_RUNTIME_GENERATION,
  CHAT_SELECTION_AUTO,
  OPENAI_CATALOG_SURFACE,
  OPENAI_PROBE_VERSION,
  buildOpenAIChatCatalogView,
  buildOpenAIModelCatalogPayload,
  collectOpenAIModels,
  extractResponseText,
  normalizeAvailableOpenAIModels,
  parseStableOpenAIChatModelId,
  probeOpenAIImageInput,
  probeOpenAIResponsesModel,
  refreshOpenAIModelCatalog,
  resolveChatModelSelection,
};
