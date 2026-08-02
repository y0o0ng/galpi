'use strict';

const DEFAULT_MODEL = 'gpt-4o-mini-tts';
const DEFAULT_VOICE = 'echo';
// voice만으로는 톤이 평평해서 전달 방식을 따로 지시한다. 내용은 지시하지 않는다.
// 속도는 speed로 정하므로 여기서 빠르기를 다시 지시하지 않는다. 서로 싸운다.
const DEFAULT_INSTRUCTIONS = '밝고 활기찬 목소리로, 친한 친구에게 말하듯 자연스러운 반말로 읽어줘. 문장 끝을 또렷하게.';
// 실기기에서 고른 값이다. API 허용 범위는 0.25~4.0이고 그 밖은 400으로 거절된다.
const DEFAULT_SPEED = 1.3;
const MIN_SPEED = 0.25;
const MAX_SPEED = 4;
const DEFAULT_TIMEOUT_MS = 30 * 1000;
// 마이크를 끄고 재생하므로 긴 음성은 사용자를 붙잡아 둔다. 프롬프트가 아니라 코드로 막는다.
const DEFAULT_MAX_CHARS = 600;
const SENTENCE_END_RE = /[.!?。？！]|다\.|요\.|\n/;
// 조각 나누기용 경계. 첫 조각을 먼저 읽으면 전체 합성을 기다리지 않는다.
const SEGMENT_BREAK_CHARS = '.!?。！？\n';
// 이보다 짧은 조각은 앞뒤로 붙인다. 왕복만 늘고 빨라지지 않는다.
const MIN_SEGMENT_CHARS = 12;
// 조각이 늘수록 TTS 호출도 는다. 꼬리는 하나로 묶는다.
const MAX_SEGMENTS = 8;

class VoiceTtsError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'VoiceTtsError';
    this.code = code;
    this.status = status;
  }
}

function ttsError(message, code, status) {
  return new VoiceTtsError(message, code, status);
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
}

/**
 * 화면에 표시할 전체 답변에서 음성으로 읽을 앞부분만 잘라낸다.
 * 문장 경계에서 끊고, 상한을 넘으면 화면을 가리키며 닫는다.
 */
function selectSpokenText(fullText, { maxChars = DEFAULT_MAX_CHARS, maxSentences = 3 } = {}) {
  const text = String(fullText || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;

  let cut = '';
  let sentences = 0;
  for (let i = 0; i < text.length && i < maxChars; i += 1) {
    cut += text[i];
    if (SENTENCE_END_RE.test(text.slice(Math.max(0, i - 1), i + 1))) {
      sentences += 1;
      if (sentences >= maxSentences) break;
    }
  }
  const trimmed = cut.trim() || text.slice(0, maxChars);
  return `${trimmed} 자세한 건 화면에 정리해뒀어.`;
}

/**
 * 읽을 문장을 조각으로 나눈다. 첫 조각을 먼저 재생하면 전체 합성을 기다리지 않는다.
 * 상한과 닫는 말은 selectSpokenText 한 곳에서만 적용하고 여기서는 나누기만 한다.
 */
function splitSpokenSegments(fullText, {
  maxChars = DEFAULT_MAX_CHARS,
  minSegmentChars = MIN_SEGMENT_CHARS,
  maxSegments = MAX_SEGMENTS,
} = {}) {
  const spoken = selectSpokenText(fullText, { maxChars });
  if (!spoken) return [];

  const sentences = [];
  let current = '';
  for (let index = 0; index < spoken.length; index += 1) {
    const char = spoken[index];
    current += char;
    if (!SEGMENT_BREAK_CHARS.includes(char)) continue;
    const previous = spoken[index - 1] || '';
    const next = spoken[index + 1] || '';
    // 소수점과 줄임표는 문장 끝이 아니다. "3.5", "음..."에서 끊지 않는다.
    if (char === '.' && /\d/.test(previous) && /\d/.test(next)) continue;
    if (char === '.' && next === '.') continue;
    const trimmed = current.trim();
    if (trimmed) sentences.push(trimmed);
    current = '';
  }
  const tail = current.trim();
  if (tail) sentences.push(tail);
  if (!sentences.length) return [];

  // 너무 짧은 조각은 앞뒤로 붙인다. "응." 하나 때문에 왕복을 늘릴 이유가 없다.
  const merged = [];
  for (const sentence of sentences) {
    const previous = merged[merged.length - 1];
    if (previous && previous.length < minSegmentChars) {
      merged[merged.length - 1] = `${previous} ${sentence}`;
    } else {
      merged.push(sentence);
    }
  }
  while (merged.length > 1 && merged[merged.length - 1].length < minSegmentChars) {
    const last = merged.pop();
    merged[merged.length - 1] = `${merged[merged.length - 1]} ${last}`;
  }
  if (merged.length <= maxSegments) return merged;
  // 개수 상한을 넘으면 꼬리를 하나로 합쳐 호출 수를 묶는다.
  const head = merged.slice(0, maxSegments - 1);
  head.push(merged.slice(maxSegments - 1).join(' '));
  return head;
}

function createVoiceTtsService({
  enabled = false,
  apiKey,
  baseUrl,
  model = DEFAULT_MODEL,
  voice = DEFAULT_VOICE,
  instructions = DEFAULT_INSTRUCTIONS,
  speed = DEFAULT_SPEED,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxChars = DEFAULT_MAX_CHARS,
  fetchImpl = global.fetch,
} = {}) {
  const resolvedKey = String(apiKey || '').trim();
  const resolvedModel = String(model || DEFAULT_MODEL).trim();
  const resolvedVoice = String(voice || DEFAULT_VOICE).trim();
  const resolvedInstructions = String(instructions || '').trim();
  // 설정값이 범위를 벗어나면 매 턴이 400으로 죽는다. 프롬프트가 아니라 코드로 가둔다.
  const parsedSpeed = Number(speed);
  const resolvedSpeed = Number.isFinite(parsedSpeed)
    ? Math.min(MAX_SPEED, Math.max(MIN_SPEED, parsedSpeed))
    : DEFAULT_SPEED;
  const available = enabled === true && Boolean(resolvedKey) && typeof fetchImpl === 'function';

  return {
    available,
    publicConfig: () => ({
      halfDuplexEnabled: available,
      ttsModel: available ? resolvedModel : null,
      ttsVoice: available ? resolvedVoice : null,
      maxSpokenChars: maxChars,
    }),
    selectSpokenText: text => selectSpokenText(text, { maxChars }),
    splitSpokenSegments: text => splitSpokenSegments(text, { maxChars }),

    async speak(text) {
      if (!available) {
        throw ttsError('음성 출력 기능을 사용할 수 없습니다.', 'VOICE_TTS_UNAVAILABLE', 503);
      }
      const spoken = selectSpokenText(text, { maxChars });
      if (!spoken) {
        throw ttsError('읽을 내용이 없습니다.', 'VOICE_TTS_EMPTY_TEXT', 400);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/audio/speech`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resolvedKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: resolvedModel,
            voice: resolvedVoice,
            input: spoken,
            response_format: 'wav',
            speed: resolvedSpeed,
            ...(resolvedInstructions ? { instructions: resolvedInstructions } : {}),
          }),
          signal: controller.signal,
        });
      } catch (error) {
        throw ttsError(
          error?.name === 'AbortError' ? '음성 생성이 시간을 초과했습니다.' : '음성 생성에 실패했습니다.',
          error?.name === 'AbortError' ? 'VOICE_TTS_TIMEOUT' : 'VOICE_TTS_REQUEST_FAILED',
          504,
        );
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        // 오류 본문에 사용자 발화나 키가 섞이지 않도록 상태 코드만 올린다.
        throw ttsError('음성 생성 요청이 거절됐습니다.', 'VOICE_TTS_UPSTREAM_REJECTED', 502);
      }
      return { spoken, body: response.body };
    },
  };
}

module.exports = {
  MAX_SEGMENTS,
  MIN_SEGMENT_CHARS,
  DEFAULT_INSTRUCTIONS,
  DEFAULT_MAX_CHARS,
  DEFAULT_MODEL,
  DEFAULT_SPEED,
  DEFAULT_VOICE,
  VoiceTtsError,
  createVoiceTtsService,
  selectSpokenText,
  splitSpokenSegments,
};
