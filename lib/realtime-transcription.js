'use strict';

const crypto = require('node:crypto');
const Busboy = require('busboy');

const DEFAULT_MODEL = 'gpt-transcribe';
const DEFAULT_MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_DURATION_MS = 120 * 1000;
const DEFAULT_TIMEOUT_MS = 30 * 1000;
const DEFAULT_MAX_PENDING_TURNS = 3;
const SUPPORTED_AUDIO_TYPES = new Set(['audio/wav', 'audio/x-wav']);
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,160}$/;

class RealtimeTranscriptionError extends Error {
  constructor(message, {
    code = 'REALTIME_TRANSCRIPTION_FAILED',
    status = 500,
    upstreamStatus = 0,
    upstreamCode = '',
  } = {}) {
    super(message);
    this.name = 'RealtimeTranscriptionError';
    this.code = code;
    this.status = status;
    this.upstreamStatus = upstreamStatus;
    this.upstreamCode = upstreamCode;
  }
}

function transcriptionError(message, code, status) {
  return new RealtimeTranscriptionError(message, { code, status });
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
}

function normalizeUsage(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    const items = value
      .map(item => normalizeUsage(item, depth + 1))
      .filter(item => item !== undefined);
    return items.length ? items : undefined;
  }
  if (typeof value !== 'object') return undefined;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[a-z0-9_]{1,64}$/i.test(key)) continue;
    const normalized = normalizeUsage(item, depth + 1);
    if (normalized !== undefined) result[key] = normalized;
  }
  return Object.keys(result).length ? result : undefined;
}

function inspectPcmWav(audio) {
  if (!Buffer.isBuffer(audio) || audio.length < 44) {
    throw transcriptionError('음성 파일이 비어 있거나 손상되었습니다.', 'REALTIME_AUDIO_INVALID', 400);
  }
  if (audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') {
    throw transcriptionError('지원하지 않는 음성 파일입니다.', 'REALTIME_AUDIO_INVALID', 400);
  }

  let offset = 12;
  let format = null;
  let dataBytes = 0;
  while (offset + 8 <= audio.length) {
    const id = audio.toString('ascii', offset, offset + 4);
    const size = audio.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > audio.length) {
      throw transcriptionError('음성 파일이 손상되었습니다.', 'REALTIME_AUDIO_INVALID', 400);
    }
    if (id === 'fmt ' && size >= 16) {
      format = {
        audioFormat: audio.readUInt16LE(start),
        channels: audio.readUInt16LE(start + 2),
        sampleRate: audio.readUInt32LE(start + 4),
        byteRate: audio.readUInt32LE(start + 8),
        bitsPerSample: audio.readUInt16LE(start + 14),
      };
    } else if (id === 'data') {
      dataBytes += size;
    }
    offset = end + (size % 2);
  }

  if (
    !format
    || format.audioFormat !== 1
    || format.channels !== 1
    || format.bitsPerSample !== 16
    || format.sampleRate < 8000
    || format.sampleRate > 48000
    || format.byteRate <= 0
    || dataBytes <= 0
  ) {
    throw transcriptionError(
      '16-bit mono PCM WAV만 사용할 수 있습니다.',
      'REALTIME_AUDIO_FORMAT_UNSUPPORTED',
      415,
    );
  }
  return {
    durationMs: Math.round((dataBytes / format.byteRate) * 1000),
    sampleRate: format.sampleRate,
    dataBytes,
  };
}

function readRealtimeTranscriptionUpload(req, {
  maxAudioBytes = DEFAULT_MAX_AUDIO_BYTES,
} = {}) {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers['content-type'] || '');
    if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
      reject(transcriptionError(
        'multipart/form-data 음성 요청이 필요합니다.',
        'REALTIME_MULTIPART_REQUIRED',
        415,
      ));
      return;
    }

    let parser;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: {
          files: 2,
          fileSize: maxAudioBytes,
          fields: 4,
          fieldSize: 256,
          parts: 5,
        },
      });
    } catch (_) {
      reject(transcriptionError(
        '음성 업로드 형식이 올바르지 않습니다.',
        'REALTIME_MULTIPART_INVALID',
        400,
      ));
      return;
    }

    const fields = {};
    const chunks = [];
    let audioType = '';
    let audioName = '';
    let fileSeen = false;
    let fileTooLarge = false;
    let settled = false;

    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    parser.on('field', (name, value) => {
      if (!['session_id', 'input_item_id', 'duration_ms'].includes(name) || fields[name] !== undefined) {
        fail(transcriptionError(
          '음성 요청 필드가 올바르지 않습니다.',
          'REALTIME_AUDIO_FIELD_INVALID',
          400,
        ));
        return;
      }
      fields[name] = String(value);
    });
    parser.on('file', (name, file, info) => {
      if (name !== 'audio' || fileSeen) {
        file.resume();
        fail(transcriptionError(
          '한 턴에는 audio 파일 하나만 보낼 수 있습니다.',
          'REALTIME_AUDIO_FILE_LIMIT',
          400,
        ));
        return;
      }
      fileSeen = true;
      audioType = String(info.mimeType || '').toLowerCase();
      audioName = String(info.filename || '').slice(0, 120);
      file.on('limit', () => {
        fileTooLarge = true;
      });
      file.on('data', chunk => {
        if (!fileTooLarge) chunks.push(Buffer.from(chunk));
      });
      file.on('error', () => {
        fail(transcriptionError(
          '음성 업로드를 읽지 못했습니다.',
          'REALTIME_AUDIO_UPLOAD_FAILED',
          400,
        ));
      });
    });
    parser.on('filesLimit', () => {
      fail(transcriptionError(
        '한 턴에는 음성 파일 하나만 보낼 수 있습니다.',
        'REALTIME_AUDIO_FILE_LIMIT',
        400,
      ));
    });
    parser.on('fieldsLimit', () => {
      fail(transcriptionError(
        '음성 요청 필드가 너무 많습니다.',
        'REALTIME_AUDIO_FIELD_LIMIT',
        400,
      ));
    });
    parser.on('partsLimit', () => {
      fail(transcriptionError(
        '음성 요청 항목이 너무 많습니다.',
        'REALTIME_AUDIO_PART_LIMIT',
        400,
      ));
    });
    parser.on('error', () => {
      fail(transcriptionError(
        '음성 업로드 형식이 올바르지 않습니다.',
        'REALTIME_MULTIPART_INVALID',
        400,
      ));
    });
    parser.on('close', () => {
      if (settled) return;
      if (fileTooLarge) {
        fail(transcriptionError(
          '음성 턴이 업로드 상한을 넘었습니다.',
          'REALTIME_AUDIO_TOO_LARGE',
          413,
        ));
        return;
      }
      if (!fileSeen || chunks.length === 0) {
        fail(transcriptionError(
          '음성 파일이 필요합니다.',
          'REALTIME_AUDIO_REQUIRED',
          400,
        ));
        return;
      }
      settled = true;
      resolve({
        audio: Buffer.concat(chunks),
        mimeType: audioType,
        filename: audioName,
        sessionId: fields.session_id || '',
        inputItemId: fields.input_item_id || '',
        claimedDurationMs: Number(fields.duration_ms || 0),
      });
    });
    req.once('aborted', () => {
      fail(transcriptionError(
        '음성 업로드가 중단되었습니다.',
        'REALTIME_AUDIO_UPLOAD_ABORTED',
        400,
      ));
    });
    req.pipe(parser);
  });
}

function createOpenAITranscriptionProvider({
  apiKey,
  baseUrl,
  model = DEFAULT_MODEL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = global.fetch,
} = {}) {
  const resolvedApiKey = String(apiKey || '').trim();
  const resolvedModel = String(model || DEFAULT_MODEL).trim();
  const resolvedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_TIMEOUT_MS;

  return async function transcribeAudio({ audio, mimeType, durationMs }) {
    if (!resolvedApiKey || typeof fetchImpl !== 'function') {
      throw transcriptionError(
        '보정 전사 기능을 사용할 수 없습니다.',
        'REALTIME_TRANSCRIPTION_UNAVAILABLE',
        503,
      );
    }
    const form = new FormData();
    form.set('model', resolvedModel);
    form.set('file', new Blob([audio], { type: mimeType }), 'voice-turn.wav');
    form.append('languages[]', 'ko');
    form.append('languages[]', 'en');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), resolvedTimeoutMs);
    let response;
    try {
      response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${resolvedApiKey}` },
        body: form,
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw transcriptionError(
          '보정 전사 시간이 초과되었습니다.',
          'REALTIME_TRANSCRIPTION_TIMEOUT',
          504,
        );
      }
      throw transcriptionError(
        '보정 전사 서버에 연결하지 못했습니다.',
        'REALTIME_TRANSCRIPTION_UPSTREAM_UNAVAILABLE',
        502,
      );
    } finally {
      clearTimeout(timer);
    }

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new RealtimeTranscriptionError('보정 전사를 완료하지 못했습니다.', {
        code: response.status === 429
          ? 'REALTIME_TRANSCRIPTION_RATE_LIMITED'
          : 'REALTIME_TRANSCRIPTION_UPSTREAM_REJECTED',
        status: response.status === 429 ? 429 : 502,
        upstreamStatus: response.status,
        upstreamCode: String(body?.error?.code || body?.error?.type || '').slice(0, 80),
      });
    }
    const text = String(body?.text || '').trim();
    if (!text) {
      const error = transcriptionError(
        '보정 전사 결과가 비어 있습니다.',
        'REALTIME_TRANSCRIPTION_EMPTY',
        422,
      );
      // 빈 전사 원인 판별용 bounded 진단. 오디오와 전사 내용은 남기지 않는다.
      error.emptyDurationMs = Number.isFinite(durationMs) ? durationMs : null;
      error.emptyAudioBytes = audio?.length ?? null;
      throw error;
    }
    return {
      correctedTranscript: text,
      model: resolvedModel,
      usage: normalizeUsage(body?.usage),
    };
  };
}

function createRealtimeTranscriptionService({
  enabled = false,
  apiKey,
  baseUrl,
  model = DEFAULT_MODEL,
  sessionTtlMs = 5 * 60 * 1000,
  maxAudioBytes = DEFAULT_MAX_AUDIO_BYTES,
  maxDurationMs = DEFAULT_MAX_DURATION_MS,
  maxPendingTurns = DEFAULT_MAX_PENDING_TURNS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = global.fetch,
  transcribeAudio,
  now = () => Date.now(),
} = {}) {
  const resolvedModel = String(model || DEFAULT_MODEL).trim();
  const available = enabled === true && Boolean(String(apiKey || '').trim() || transcribeAudio);
  const sessions = new Map();
  const provider = transcribeAudio || createOpenAITranscriptionProvider({
    apiKey,
    baseUrl,
    model: resolvedModel,
    timeoutMs,
    fetchImpl,
  });

  function cleanupExpired() {
    const current = now();
    for (const [id, session] of sessions) {
      if (session.expiresAt <= current && session.pendingCount === 0) sessions.delete(id);
    }
  }

  function createSession() {
    if (!available) return '';
    cleanupExpired();
    const id = crypto.randomBytes(24).toString('base64url');
    sessions.set(id, {
      expiresAt: now() + sessionTtlMs,
      pendingCount: 0,
      tail: Promise.resolve(),
      turns: new Map(),
    });
    return id;
  }

  async function transcribe({
    sessionId,
    turnId,
    inputItemId,
    audio,
    mimeType,
    claimedDurationMs = 0,
  } = {}) {
    if (!available) {
      throw transcriptionError(
        '보정 전사 기능이 비활성화되어 있습니다.',
        'REALTIME_TRANSCRIPTION_DISABLED',
        503,
      );
    }
    cleanupExpired();
    const cleanSessionId = String(sessionId || '').trim();
    const cleanTurnId = String(turnId || '').trim();
    const cleanInputItemId = String(inputItemId || '').trim();
    if (!SAFE_ID_RE.test(cleanSessionId) || !SAFE_ID_RE.test(cleanTurnId) || !SAFE_ID_RE.test(cleanInputItemId)) {
      throw transcriptionError(
        '음성 턴 식별자가 올바르지 않습니다.',
        'REALTIME_TRANSCRIPTION_ID_INVALID',
        400,
      );
    }
    const session = sessions.get(cleanSessionId);
    if (!session || session.expiresAt <= now()) {
      sessions.delete(cleanSessionId);
      throw transcriptionError(
        '음성 보정 세션이 만료되었습니다.',
        'REALTIME_TRANSCRIPTION_SESSION_EXPIRED',
        410,
      );
    }
    if (!Buffer.isBuffer(audio) || audio.length === 0) {
      throw transcriptionError('음성 파일이 필요합니다.', 'REALTIME_AUDIO_REQUIRED', 400);
    }
    if (audio.length > maxAudioBytes) {
      throw transcriptionError(
        '음성 턴이 업로드 상한을 넘었습니다.',
        'REALTIME_AUDIO_TOO_LARGE',
        413,
      );
    }
    const cleanMimeType = String(mimeType || '').toLowerCase();
    if (!SUPPORTED_AUDIO_TYPES.has(cleanMimeType)) {
      throw transcriptionError(
        '지원하지 않는 음성 형식입니다.',
        'REALTIME_AUDIO_FORMAT_UNSUPPORTED',
        415,
      );
    }
    const wav = inspectPcmWav(audio);
    if (wav.durationMs < 100 || wav.durationMs > maxDurationMs) {
      throw transcriptionError(
        '음성 턴 길이가 허용 범위를 벗어났습니다.',
        'REALTIME_AUDIO_DURATION_INVALID',
        413,
      );
    }
    if (
      Number.isFinite(claimedDurationMs)
      && claimedDurationMs > 0
      && Math.abs(claimedDurationMs - wav.durationMs) > 2000
    ) {
      throw transcriptionError(
        '음성 턴 길이 정보가 일치하지 않습니다.',
        'REALTIME_AUDIO_DURATION_MISMATCH',
        400,
      );
    }

    const audioSha256 = crypto.createHash('sha256').update(audio).digest('hex');
    const existing = session.turns.get(cleanInputItemId);
    if (existing) {
      if (existing.audioSha256 !== audioSha256 || existing.turnId !== cleanTurnId) {
        throw transcriptionError(
          '같은 음성 item에 다른 오디오가 전달되었습니다.',
          'REALTIME_TRANSCRIPTION_CONFLICT',
          409,
        );
      }
      return existing.promise.then(result => ({ ...result, duplicate: true }));
    }
    if (session.pendingCount >= maxPendingTurns) {
      throw transcriptionError(
        '보정할 음성 턴이 밀려 있습니다.',
        'REALTIME_TRANSCRIPTION_BACKLOG',
        429,
      );
    }

    session.pendingCount += 1;
    const run = session.tail
      .catch(() => {})
      .then(() => provider({
        audio,
        mimeType: cleanMimeType,
        durationMs: wav.durationMs,
        inputItemId: cleanInputItemId,
      }))
      .then(result => {
        const correctedTranscript = String(result?.correctedTranscript || '').trim();
        if (!correctedTranscript) {
          const error = transcriptionError(
            '보정 전사 결과가 비어 있습니다.',
            'REALTIME_TRANSCRIPTION_EMPTY',
            422,
          );
          error.emptyDurationMs = wav.durationMs;
          error.emptyAudioBytes = audio.length;
          throw error;
        }
        return {
          correctedTranscript,
          model: String(result?.model || resolvedModel),
          usage: normalizeUsage(result?.usage),
          durationMs: wav.durationMs,
          audioSha256,
          duplicate: false,
        };
      })
      .finally(() => {
        session.pendingCount -= 1;
      });
    session.tail = run.catch(() => {});
    const record = {
      turnId: cleanTurnId,
      audioSha256,
      promise: run,
    };
    session.turns.set(cleanInputItemId, record);
    try {
      return await run;
    } catch (error) {
      if (session.turns.get(cleanInputItemId) === record) {
        session.turns.delete(cleanInputItemId);
      }
      throw error;
    }
  }

  function publicConfig() {
    return {
      correctionEnabled: available,
      canonicalTranscriptionModel: available ? resolvedModel : '',
      maxTurnSeconds: Math.floor(maxDurationMs / 1000),
      maxTurnBytes: maxAudioBytes,
    };
  }

  return {
    createSession,
    publicConfig,
    transcribe,
  };
}

module.exports = {
  DEFAULT_MAX_AUDIO_BYTES,
  DEFAULT_MAX_DURATION_MS,
  DEFAULT_MAX_PENDING_TURNS,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
  RealtimeTranscriptionError,
  createOpenAITranscriptionProvider,
  createRealtimeTranscriptionService,
  inspectPcmWav,
  normalizeUsage,
  readRealtimeTranscriptionUpload,
};
