'use strict';

// 답변 생성은 최근 대화를 보지만 검색은 이번 발화 하나로 다시 시작한다. 그래서
// `그때 뭐 했었지?` 같은 후속 턴은 지시 대상이 빠진 채로 corpus에 나간다. 여기서
// 검색에만 쓸 자립 질의를 만들고, 원문은 그대로 둔다(설계 4.8).

const RESOLUTION_OUTCOMES = Object.freeze([
  'pass',
  'resolved',
  'no_retrieval',
  'ambiguous',
]);

// 모델은 pass를 고르지 않는다. 자체 완결 여부는 모델을 부르기 전에 게이트가 정한다.
const MODEL_OUTCOMES = Object.freeze(['resolved', 'no_retrieval', 'ambiguous']);

const RESOLUTION_SCHEMA_NAME = 'retrieval_query_resolution';
const RESOLUTION_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['outcome', 'query'],
  properties: {
    outcome: { type: 'string', enum: [...MODEL_OUTCOMES] },
    query: { type: 'string' },
  },
});

const RESOLVER_SYSTEM_PROMPT = `너는 개인 비서의 검색 질의 해석기다. 지금 사용자의 발화가 최근 대화에 의존할 때, 검색에만 쓸 자립적인 질의를 만든다. 답변을 쓰지 않는다.

outcome:
- resolved: 최근 대화에서 지시 대상(날짜·사람·사건·장소·주제)을 확실히 찾을 수 있다. query에 그 대상을 펼쳐 쓴 검색용 문장을 넣는다.
- no_retrieval: 최근 대화만으로 답할 수 있고 노트·기록 검색이 필요 없다. query는 빈 문자열.
- ambiguous: 지시 대상 후보가 여러 개거나 근거가 없다. query는 빈 문자열.

규칙:
- 어시스턴트 발화도 근거로 쓴다. 날짜나 이름을 어시스턴트가 먼저 말했을 수 있다.
- 추측으로 대상을 만들지 않는다. 확실하지 않으면 ambiguous다.
- 짧다는 이유만으로 억지 검색어를 만들지 않는다.
- query는 한 문장, 200자 이내. 질문 형식이 아니어도 된다.`;

// 지시 대상을 확정하지 못한 턴에도 답변 모델은 평소대로 대화를 본다. 검색이 없었다는
// 사실만 알려서 근거가 있는 척하지 않고 되묻게 한다.
const AMBIGUOUS_RETRIEVAL_NOTICE = [
  '<retrieval_status>',
  '이번 발화가 무엇을 가리키는지 최근 대화만으로 확정할 수 없어 노트·기록 검색을 하지 않았다.',
  '저장된 근거가 없으니 추측해서 답하지 말고, 무엇을 말하는지 짧게 되물어라.',
  '</retrieval_status>',
].join('\n');

const MAX_CONVERSATION_MESSAGES = 6;
const MAX_MESSAGE_CHARS = 400;
const MAX_RESOLVED_QUERY_CHARS = 200;
const MIN_RESOLVED_QUERY_CHARS = 2;
const CONTINUATION_MAX_CHARS = 15;

// `그 때`처럼 띄어 쓴 형태를 붙여 쓴 것과 같게 본다. 뒤따르는 의존명사를 열거해
// `그 거리`의 `그 거`까지 붙여버리는 것을 막는다.
const DEPENDENT_NOUNS = ['때', '날', '거', '것', '건', '걸', '게', '곳', '쪽', '분', '사람', '다음', '전', '후', '뒤'];
const DEMONSTRATIVE_SPACING_PATTERN = new RegExp(
  `([그이저])\\s+(?=(?:${DEPENDENT_NOUNS.join('|')})(?![가-힣]))`,
  'gu',
);

const ANAPHORA_STEMS = new Set([
  '그때', '그날', '그거', '그것', '그건', '그걸', '그게', '그곳', '그쪽', '그분',
  '그사람', '그다음', '그전', '그후', '그뒤', '거기', '걔', '걔네', '아까', '방금',
  '이거', '이것', '이건', '이걸', '저거', '저것',
]);

// 최근 대화를 이어받는 표현. 짧은 발화에서만 본다 — `또`나 `더`는 자체 완결 질문
// 안에도 흔히 들어간다.
const CONTINUATION_STEMS = new Set([
  '그래서', '그럼', '그래', '또', '계속', '더', '어때', '어땠', '왜', '응', '음', '맞아',
]);

const PARTICLE_SUFFIX_PATTERN = /^(?:들)?(?:에서|에게|한테|부터|까지|으로|이랑|말고|로|은|는|이|가|을|를|의|와|과|에|도|만|야|지|요|랑|다|냐|니)?$/u;

function normalizeDemonstrativeSpacing(text) {
  return String(text || '').replace(DEMONSTRATIVE_SPACING_PATTERN, '$1');
}

function matchesStem(token, stems) {
  for (const stem of stems) {
    if (token === stem) return true;
    if (token.startsWith(stem) && PARTICLE_SUFFIX_PATTERN.test(token.slice(stem.length))) {
      return true;
    }
  }
  return false;
}

// 자체 완결 질문에 resolver 모델 호출을 붙이면 모든 턴이 느려지고 비싸진다. 대화
// 의존 후보만 통과시키는 저렴한 어휘 게이트다.
function needsConversationalResolution(userText) {
  const text = normalizeDemonstrativeSpacing(userText).trim();
  if (!text) return false;
  const tokens = text.match(/[\p{L}\p{N}]+/gu) || [];
  if (tokens.some(token => matchesStem(token, ANAPHORA_STEMS))) return true;
  if (text.length > CONTINUATION_MAX_CHARS) return false;
  return tokens.some(token => matchesStem(token, CONTINUATION_STEMS));
}

function normalizeConversation(recentConversation) {
  return (Array.isArray(recentConversation) ? recentConversation : [])
    .filter(message => (
      message
      && (message.role === 'user' || message.role === 'assistant')
      && typeof message.content === 'string'
      && message.content.trim()
    ))
    .slice(-MAX_CONVERSATION_MESSAGES)
    .map(message => ({
      role: message.role,
      content: String(message.content).slice(0, MAX_MESSAGE_CHARS),
    }));
}

function buildResolverInput(userText, conversation) {
  const transcript = conversation
    .map(message => `${message.role === 'user' ? '사용자' : '어시스턴트'}: ${message.content}`)
    .join('\n');
  return [
    '<recent_conversation>',
    transcript,
    '</recent_conversation>',
    '',
    '<current_utterance>',
    String(userText).slice(0, MAX_MESSAGE_CHARS),
    '</current_utterance>',
  ].join('\n');
}

function normalizeModelResolution(parsed) {
  const outcome = MODEL_OUTCOMES.includes(parsed?.outcome) ? parsed.outcome : null;
  if (!outcome) return null;
  if (outcome !== 'resolved') return { outcome, retrievalQuery: null };
  const query = String(parsed.query || '').trim().slice(0, MAX_RESOLVED_QUERY_CHARS);
  // `resolved`라면서 질의가 비었으면 해석에 실패한 것이다. 원문으로 되돌리지 않는다.
  if (query.length < MIN_RESOLVED_QUERY_CHARS) return null;
  return { outcome, retrievalQuery: query };
}

function createRetrievalQueryResolver({ callModel, onError = () => {} } = {}) {
  if (typeof callModel !== 'function') throw new TypeError('질의 해석 모델 호출 함수가 필요합니다.');

  async function resolve({
    userText,
    recentConversation = [],
    hasCurrentTurnAttachment = false,
  } = {}) {
    const text = String(userText || '');
    // 이번 턴 첨부가 있으면 `이거`가 가리키는 것은 이미 정해져 있다. 첨부 경로는
    // 해석기가 보지 못하는 대상을 들고 있으므로, 그 턴은 해석 전 동작을 그대로 둔다.
    if (hasCurrentTurnAttachment) return { outcome: 'pass', retrievalQuery: text, error: null };

    const conversation = normalizeConversation(recentConversation);
    if (!text.trim() || !needsConversationalResolution(text)) {
      return { outcome: 'pass', retrievalQuery: text, error: null };
    }
    // 대화 의존 발화인데 근거로 삼을 대화가 없다. 지시 대상이 없는 원문을 corpus에
    // 던지지 않는다 — 해석 실패와 같은 fail-close다.
    if (conversation.length === 0) {
      return { outcome: 'ambiguous', retrievalQuery: null, error: null };
    }

    try {
      const parsed = await callModel({
        system: RESOLVER_SYSTEM_PROMPT,
        input: buildResolverInput(text, conversation),
        schema: RESOLUTION_SCHEMA,
        schemaName: RESOLUTION_SCHEMA_NAME,
      });
      const resolution = normalizeModelResolution(parsed);
      if (!resolution) {
        const error = new Error('질의 해석 응답을 해석할 수 없습니다.');
        error.code = 'RETRIEVAL_QUERY_RESOLUTION_MALFORMED';
        throw error;
      }
      return { ...resolution, error: null };
    } catch (error) {
      // fail-close. 원문을 corpus에 던지는 약한 fallback을 만들지 않는다.
      onError(error);
      return { outcome: 'ambiguous', retrievalQuery: null, error };
    }
  }

  return { resolve };
}

module.exports = {
  AMBIGUOUS_RETRIEVAL_NOTICE,
  MODEL_OUTCOMES,
  RESOLUTION_OUTCOMES,
  RESOLUTION_SCHEMA,
  RESOLUTION_SCHEMA_NAME,
  RESOLVER_SYSTEM_PROMPT,
  buildResolverInput,
  createRetrievalQueryResolver,
  needsConversationalResolution,
  normalizeConversation,
};
