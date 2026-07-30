'use strict';

const DEFAULT_MODEL = 'gpt-realtime-2.1-mini';
const DEFAULT_VOICE = 'marin';
const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';
const DEFAULT_MAX_SESSION_SECONDS = 5 * 60;
const DEFAULT_MAX_OUTPUT_TOKENS = 800;
const DEFAULT_MAX_SDP_BYTES = 64 * 1024;

class RealtimeSessionError extends Error {
  constructor(message, {
    code = 'REALTIME_SESSION_FAILED',
    status = 500,
    upstreamStatus = null,
    upstreamCode = '',
    upstreamParam = '',
  } = {}) {
    super(message);
    this.name = 'RealtimeSessionError';
    this.code = code;
    this.status = status;
    this.upstreamStatus = upstreamStatus;
    this.upstreamCode = upstreamCode;
    this.upstreamParam = upstreamParam;
  }
}

function normalizeBaseUrl(value) {
  return String(value || 'https://api.openai.com/v1').replace(/\/+$/, '');
}

function normalizeModel(value) {
  return String(value || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

function normalizeVoice(value) {
  return String(value || DEFAULT_VOICE).trim() || DEFAULT_VOICE;
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function buildRealtimeSessionConfig({
  model = DEFAULT_MODEL,
  voice = DEFAULT_VOICE,
  transcriptionModel = DEFAULT_TRANSCRIPTION_MODEL,
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
} = {}) {
  const resolvedTranscriptionModel = String(
    transcriptionModel || DEFAULT_TRANSCRIPTION_MODEL,
  );
  const transcription = resolvedTranscriptionModel === 'gpt-live-transcribe'
    ? {
        model: resolvedTranscriptionModel,
        languages: ['ko', 'en'],
        delay: 'low',
      }
    : {
        model: resolvedTranscriptionModel,
        language: 'ko',
      };
  return {
    type: 'realtime',
    model: normalizeModel(model),
    output_modalities: ['audio'],
    instructions: [
      '너는 개인 AI 비서 시온(XION)이다.',
      '사용자가 말한 언어로 자연스럽고 간결하게 답한다.',
      '한국어 대화에서는 편안한 존댓말을 쓰되 지나치게 장황하지 않게 말한다.',
      '이 음성 베타에서는 기억, 일정, 웹, 논문 도구를 사용할 수 없고 어떤 데이터도 저장하지 않는다.',
      '저장이나 외부 행동을 요청받으면 현재 음성 베타는 대화 전용이라고 짧게 알린다.',
      '사용자가 말을 시작하면 즉시 발화를 양보한다.',
    ].join('\n'),
    tools: [],
    tool_choice: 'none',
    max_output_tokens: clampInteger(maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS, 64, 4096),
    audio: {
      input: {
        transcription,
        turn_detection: {
          type: 'semantic_vad',
          eagerness: 'auto',
          create_response: true,
          interrupt_response: true,
        },
      },
      output: {
        voice: normalizeVoice(voice),
      },
    },
  };
}

function validateSdpOffer(value, maxBytes = DEFAULT_MAX_SDP_BYTES) {
  const sdp = typeof value === 'string' ? value : '';
  if (!sdp.trim()) {
    throw new RealtimeSessionError('SDP offer가 비어 있습니다.', {
      code: 'INVALID_SDP',
      status: 400,
    });
  }
  if (Buffer.byteLength(sdp, 'utf8') > maxBytes) {
    throw new RealtimeSessionError('SDP offer가 허용 크기를 넘었습니다.', {
      code: 'SDP_TOO_LARGE',
      status: 413,
    });
  }
  if (!/^v=0(?:\r?\n|$)/.test(sdp)) {
    throw new RealtimeSessionError('올바른 SDP offer가 아닙니다.', {
      code: 'INVALID_SDP',
      status: 400,
    });
  }
  return sdp;
}

function createRealtimeSessionService({
  enabled = false,
  apiKey = '',
  baseUrl = '',
  model = DEFAULT_MODEL,
  voice = DEFAULT_VOICE,
  transcriptionModel = DEFAULT_TRANSCRIPTION_MODEL,
  maxSessionSeconds = DEFAULT_MAX_SESSION_SECONDS,
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
  maxSdpBytes = DEFAULT_MAX_SDP_BYTES,
  fetchImpl = globalThis.fetch,
} = {}) {
  const resolvedModel = normalizeModel(model);
  const resolvedVoice = normalizeVoice(voice);
  const resolvedMaxSessionSeconds = clampInteger(
    maxSessionSeconds,
    DEFAULT_MAX_SESSION_SECONDS,
    30,
    15 * 60,
  );
  const resolvedMaxSdpBytes = clampInteger(
    maxSdpBytes,
    DEFAULT_MAX_SDP_BYTES,
    1024,
    256 * 1024,
  );
  const available = enabled === true && Boolean(String(apiKey || '').trim());
  const sessionConfig = buildRealtimeSessionConfig({
    model: resolvedModel,
    voice: resolvedVoice,
    transcriptionModel,
    maxOutputTokens,
  });

  function publicConfig() {
    return {
      enabled: available,
      model: resolvedModel,
      voice: resolvedVoice,
      maxSessionSeconds: resolvedMaxSessionSeconds,
    };
  }

  async function createCall(sdpOffer, { safetyIdentifier = '' } = {}) {
    if (!available) {
      throw new RealtimeSessionError('Realtime 음성이 비활성화되어 있습니다.', {
        code: 'REALTIME_DISABLED',
        status: 503,
      });
    }
    if (typeof fetchImpl !== 'function') {
      throw new RealtimeSessionError('Realtime 연결 기능을 사용할 수 없습니다.');
    }

    const sdp = validateSdpOffer(sdpOffer, resolvedMaxSdpBytes);
    const form = new FormData();
    form.set('sdp', sdp);
    form.set('session', JSON.stringify(sessionConfig));
    const headers = {
      Authorization: `Bearer ${String(apiKey).trim()}`,
    };
    if (safetyIdentifier) headers['OpenAI-Safety-Identifier'] = safetyIdentifier;

    let response;
    try {
      response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/realtime/calls`, {
        method: 'POST',
        headers,
        body: form,
      });
    } catch (error) {
      throw new RealtimeSessionError('OpenAI Realtime 서버에 연결하지 못했습니다.', {
        code: 'REALTIME_UPSTREAM_UNAVAILABLE',
        status: 502,
      });
    }

    const answer = await response.text();
    if (!response.ok) {
      let upstreamError = {};
      try {
        upstreamError = JSON.parse(answer)?.error || {};
      } catch (_) {
        // Provider가 JSON이 아닌 오류를 반환하면 상태 코드만 기록한다.
      }
      throw new RealtimeSessionError('OpenAI Realtime 세션을 시작하지 못했습니다.', {
        code: 'REALTIME_UPSTREAM_REJECTED',
        status: response.status === 429 ? 429 : 502,
        upstreamStatus: response.status,
        upstreamCode: String(upstreamError.code || upstreamError.type || '').slice(0, 80),
        upstreamParam: String(upstreamError.param || '').slice(0, 120),
      });
    }
    if (!answer.trim()) {
      throw new RealtimeSessionError('OpenAI Realtime SDP answer가 비어 있습니다.', {
        code: 'REALTIME_EMPTY_ANSWER',
        status: 502,
      });
    }
    return {
      sdp: answer,
      model: resolvedModel,
      voice: resolvedVoice,
      maxSessionSeconds: resolvedMaxSessionSeconds,
    };
  }

  return {
    createCall,
    publicConfig,
    sessionConfig,
  };
}

module.exports = {
  DEFAULT_MAX_SDP_BYTES,
  DEFAULT_MAX_SESSION_SECONDS,
  DEFAULT_MODEL,
  DEFAULT_TRANSCRIPTION_MODEL,
  DEFAULT_VOICE,
  RealtimeSessionError,
  buildRealtimeSessionConfig,
  createRealtimeSessionService,
  validateSdpOffer,
};
