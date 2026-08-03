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
// 한 번에 읽는 조각 수. 예전 3은 답변이 4,000자 문서이던 시절의 맛보기 분량이었다.
// 음성 답변이 몇 문장으로 짧아진 뒤로는 500자짜리도 잘라 매번 되묻게 만들었다.
// 이제는 글자 수(maxChars)만으로 가둔다. 이 값은 TTS 호출 수 상한 역할만 한다.
// 닫는 말도 호출 하나이므로 MAX_SEGMENTS에서 한 자리를 비워 둔다.
const MAX_SPOKEN_SEGMENTS = MAX_SEGMENTS - 1;
// 핸즈프리로 쓸 때는 화면을 못 본다. 화면과 이어 듣기를 모두 안내한다.
const SPOKEN_CLOSING = '화면에 정리해뒀어. 더 들으려면 말해줘.';
// 이어 들을 때는 한 번 묻고 나머지를 끝까지 읽는다. 세 문장씩 끊어 되묻으면
// 핸즈프리로는 매번 다시 말해야 해서 듣는 것보다 대답하는 일이 많아진다.
// 조각을 이만큼씩 묶는다. 작으면 TTS 호출만 늘고 크면 첫 소리가 늦는다.
const CONTINUED_SEGMENT_CHARS = 400;
// 조각별 음량을 맞추는 기준. 사용자가 전체적으로 더 크길 원해 목표를 높게 잡았다.
const WAV_HEADER_BYTES = 44;
const TARGET_RMS = 0.18;
const PEAK_CEILING = 0.97;
const MAX_GAIN = 6;

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
  return `${trimmed} ${SPOKEN_CLOSING}`;
}

function splitIntoSentences(text) {
  const sentences = [];
  let current = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    current += char;
    if (!SEGMENT_BREAK_CHARS.includes(char)) continue;
    const previous = text[index - 1] || '';
    const next = text[index + 1] || '';
    // 소수점과 줄임표는 문장 끝이 아니다. "3.5", "음..."에서 끊지 않는다.
    if (char === '.' && /\d/.test(previous) && /\d/.test(next)) continue;
    if (char === '.' && next === '.') continue;
    const trimmed = current.trim();
    if (trimmed) sentences.push(trimmed);
    current = '';
  }
  const tail = current.trim();
  if (tail) sentences.push(tail);
  return sentences;
}

// 너무 짧은 조각은 앞뒤로 붙인다. "응." 하나 때문에 왕복을 늘릴 이유가 없다.
function mergeShortSentences(sentences, minSegmentChars) {
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
  return merged;
}

/**
 * 지금 읽을 조각과 아직 안 읽은 나머지를 함께 돌려준다.
 * 나머지를 그대로 다시 넣으면 이어서 읽을 수 있다. 서버는 상태를 갖지 않는다.
 */
function planSpokenSegments(fullText, {
  maxChars = DEFAULT_MAX_CHARS,
  minSegmentChars = MIN_SEGMENT_CHARS,
  maxSegments = MAX_SPOKEN_SEGMENTS,
} = {}) {
  const text = String(fullText || '').replace(/\s+/g, ' ').trim();
  if (!text) return { segments: [], remaining: '' };

  const merged = mergeShortSentences(splitIntoSentences(text), minSegmentChars);
  const segments = [];
  let chars = 0;
  for (const sentence of merged) {
    if (segments.length >= maxSegments) break;
    if (segments.length && chars + sentence.length > maxChars) break;
    segments.push(sentence);
    chars += sentence.length;
  }
  const remaining = merged.slice(segments.length).join(' ');
  if (segments.length && remaining) segments.push(SPOKEN_CLOSING);
  return { segments, remaining };
}

/**
 * 이어 듣기용. 남은 내용을 상한 없이 끝까지 조각으로 나눈다.
 * 되묻지 않으므로 닫는 말도 붙지 않고 나머지도 남지 않는다.
 */
function planContinuedSegments(fullText, { segmentChars = CONTINUED_SEGMENT_CHARS } = {}) {
  return planSpokenSegments(fullText, {
    maxChars: Infinity,
    maxSegments: Infinity,
    minSegmentChars: segmentChars,
  });
}

// 기존 호출부를 위한 얇은 이름. 나머지가 필요하면 planSpokenSegments를 쓴다.
function splitSpokenSegments(fullText, options) {
  return planSpokenSegments(fullText, options).segments;
}

/**
 * 스트리밍 중에 쓰는 점진 분할기. 텍스트가 도착할 때마다 완성된 조각만 내준다.
 * 전체가 도착한 뒤 나누는 splitSpokenSegments와 달리 상한을 직접 지켜야 한다.
 */
function createSpokenSegmenter({
  maxChars = DEFAULT_MAX_CHARS,
  minSegmentChars = MIN_SEGMENT_CHARS,
  // selectSpokenText가 3문장에서 끊는 것과 같은 양만 읽는다. 이 값이 없으면
  // 스트리밍이 문서 개요를 한참 읽다가 글자 수 상한에서 뚝 끊긴다.
  maxSegments = MAX_SPOKEN_SEGMENTS,
} = {}) {
  let buffer = '';
  let emittedChars = 0;
  let emittedSegments = 0;
  let closed = false;

  function take(segment) {
    emittedChars += segment.length;
    emittedSegments += 1;
    return segment;
  }

  return {
    push(text) {
      const out = [];
      // 닫힌 뒤에도 남는 글이 있는지는 세어 둔다. end에서 닫는 말이 필요한지 정한다.
      buffer += String(text || '');
      if (closed) return out;
      let index = 0;
      while (index < buffer.length) {
        const char = buffer[index];
        if (SEGMENT_BREAK_CHARS.includes(char)) {
          const previous = buffer[index - 1] || '';
          const next = buffer[index + 1];
          // 다음 글자가 아직 안 왔으면 소수점·줄임표인지 판단할 수 없다. 더 기다린다.
          if (next === undefined) break;
          const isDecimal = char === '.' && /\d/.test(previous) && /\d/.test(next);
          const isEllipsis = char === '.' && next === '.';
          if (!isDecimal && !isEllipsis) {
            const candidate = buffer.slice(0, index + 1).trim();
            // 너무 짧으면 다음 문장까지 붙여서 내보낸다.
            if (candidate.length >= minSegmentChars) {
              buffer = buffer.slice(index + 1);
              index = 0;
              out.push(take(candidate));
              // 상한에 닿으면 여기서 멈추되 닫는 말은 end로 미룬다. 답변이 마침
              // 여기서 끝났다면 "자세한 건 화면에" 하고 덧붙일 이유가 없다.
              if (emittedSegments >= maxSegments || emittedChars >= maxChars) {
                closed = true;
                return out;
              }
              continue;
            }
          }
        }
        index += 1;
      }
      return out;
    },

    // 아직 읽지 않은 나머지. 그대로 다시 넣으면 이어서 읽을 수 있다.
    remaining() { return buffer.trim(); },

    // 스트림이 끝나면 남은 꼬리를 처리한다. 상한에서 멈춘 뒤였다면 읽지 않고
    // 화면을 가리키며 닫고, 그냥 끝난 것이라면 꼬리를 마저 읽는다.
    end() {
      const tail = buffer.trim();
      buffer = '';
      if (closed) return tail ? [SPOKEN_CLOSING] : [];
      closed = true;
      if (!tail) return [];
      if (emittedChars + tail.length <= maxChars) return [take(tail)];
      return [take(tail.slice(0, Math.max(0, maxChars - emittedChars))), SPOKEN_CLOSING];
    },
  };
}

/**
 * 스트리밍 답변을 조각으로 잘라 흘려보내고, 아직 읽지 않은 나머지를 남긴다.
 * 도구 호출이 뒤따르면 그 앞의 텍스트는 최종 답변이 아니므로 세어만 두고 버린다.
 */
function createSpokenProgressStream(emit, { onDiscarded = () => {}, maxChars } = {}) {
  let segmenter = createSpokenSegmenter(maxChars ? { maxChars } : {});
  let emitted = 0;
  // end()가 버퍼를 비우므로 나머지는 flush 시점에 붙잡아 둔다. 순서를 바꾸면 항상 빈 값이 된다.
  let tail = '';
  return {
    delta(text) {
      for (const segment of segmenter.push(text)) {
        emitted += 1;
        emit(segment);
      }
    },
    discarded() {
      // 실측에서는 도구 라운드가 텍스트를 내지 않았다. 실제로 생기면 빈도를 봐야 한다.
      onDiscarded(emitted);
      segmenter = createSpokenSegmenter(maxChars ? { maxChars } : {});
      emitted = 0;
      tail = '';
    },
    flush() {
      tail = emitted > 0 ? segmenter.remaining() : '';
      for (const segment of segmenter.end()) emit(segment);
    },
    // 아직 읽지 않은 나머지. 사용자가 "계속"이라고 하면 이것부터 이어 읽는다.
    remaining() { return tail; },
    get emitted() { return emitted; },
  };
}

/**
 * 조각마다 TTS를 따로 부르면 요청별로 음량이 달라져 한 문장만 작게 들린다.
 * 같은 기준으로 맞춘다. 귀는 RMS를 따라가므로 RMS를 목표로 하되,
 * 피크가 넘치면 클리핑이 나므로 이득을 그만큼 깎는다.
 */
function normalizeWavLoudness(buffer, {
  targetRms = TARGET_RMS,
  peakCeiling = PEAK_CEILING,
  maxGain = MAX_GAIN,
} = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length <= WAV_HEADER_BYTES) return buffer;
  // 16비트 PCM만 다룬다. 그 밖의 형식은 건드리지 않고 그대로 돌려준다.
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.readUInt16LE(34) !== 16) return buffer;

  const samples = Math.floor((buffer.length - WAV_HEADER_BYTES) / 2);
  if (samples <= 0) return buffer;

  let sumSquares = 0;
  let peak = 0;
  for (let index = 0; index < samples; index += 1) {
    const value = buffer.readInt16LE(WAV_HEADER_BYTES + (index * 2)) / 32768;
    sumSquares += value * value;
    const magnitude = Math.abs(value);
    if (magnitude > peak) peak = magnitude;
  }
  const out = Buffer.from(buffer);
  // provider는 스트리밍으로 만들어 길이를 0xFFFFFFFF로 적어 보낸다. 그대로 두면
  // 재생기가 데이터가 더 온다고 믿고 ended를 쏘지 않아 턴이 끝나지 않는다.
  out.writeUInt32LE(out.length - 8, 4);
  out.writeUInt32LE(out.length - WAV_HEADER_BYTES, 40);

  const rms = Math.sqrt(sumSquares / samples);
  if (rms <= 0 || peak <= 0) return out;

  const gain = Math.min(targetRms / rms, peakCeiling / peak, maxGain);
  // 이미 목표에 가까우면 표본은 그대로 두고 헤더만 고친 것을 돌려준다.
  if (Math.abs(gain - 1) < 0.02) return out;

  for (let index = 0; index < samples; index += 1) {
    const offset = WAV_HEADER_BYTES + (index * 2);
    const scaled = Math.round(out.readInt16LE(offset) * gain);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, scaled)), offset);
  }
  return out;
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
    planSpokenSegments: text => planSpokenSegments(text, { maxChars }),
    planContinuedSegments: text => planContinuedSegments(text),
    createSpokenSegmenter: () => createSpokenSegmenter({ maxChars }),
    createSpokenProgressStream: (emit, options) =>
      createSpokenProgressStream(emit, { ...options, maxChars }),

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
      // 음량을 맞추려면 조각 전체가 필요하다. 조각은 짧아서 버퍼링 비용이 작다.
      const raw = Buffer.from(await response.arrayBuffer());
      return { spoken, audio: normalizeWavLoudness(raw) };
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
  MAX_SPOKEN_SEGMENTS,
  TARGET_RMS,
  SPOKEN_CLOSING,
  CONTINUED_SEGMENT_CHARS,
  createSpokenProgressStream,
  createSpokenSegmenter,
  createVoiceTtsService,
  planContinuedSegments,
  planSpokenSegments,
  normalizeWavLoudness,
  selectSpokenText,
  splitSpokenSegments,
};
