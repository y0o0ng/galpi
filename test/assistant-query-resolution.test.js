'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AMBIGUOUS_RETRIEVAL_NOTICE,
  createRetrievalQueryResolver,
  needsConversationalResolution,
  normalizeConversation,
} = require('../lib/assistant-query-resolution');

function createResolver(handler) {
  const calls = [];
  const resolver = createRetrievalQueryResolver({
    callModel: async request => {
      calls.push(request);
      return handler(request, calls.length);
    },
  });
  return { resolver, calls };
}

const SCHEDULE_CONVERSATION = [
  { role: 'user', content: '수원에서 군대 사람들 만난 건 언제지?' },
  { role: 'assistant', content: '8월 20일이야.' },
];

test('일정 후속 턴은 resolved로 지시 대상을 복원한다', async () => {
  const { resolver, calls } = createResolver(() => ({
    outcome: 'resolved',
    query: '2026년 8월 20일 수원에서 군대 사람들을 만난 날 저녁 일정',
  }));

  const result = await resolver.resolve({
    userText: '그때 저녁에는 뭐 했었지?',
    recentConversation: SCHEDULE_CONVERSATION,
  });

  assert.equal(result.outcome, 'resolved');
  assert.match(result.retrievalQuery, /8월 20일/);
  assert.match(result.retrievalQuery, /수원/);
  assert.equal(calls.length, 1);
  // 어휘 방아쇠(`일정!`)는 어디에도 없다. 지시어만으로 해석 단계가 열린다.
  assert.doesNotMatch(JSON.stringify(calls[0]), /일정!/);
});

test('어시스턴트가 처음 꺼낸 날짜도 해석 근거가 된다', async () => {
  const { resolver, calls } = createResolver(() => ({
    outcome: 'resolved',
    query: '2026년 8월 20일 정보처리기사 실기 시험 준비',
  }));

  const result = await resolver.resolve({
    userText: '그거 준비 뭐 했더라?',
    recentConversation: [
      { role: 'user', content: '이번 달에 시험 있었나?' },
      { role: 'assistant', content: '8월 20일에 정보처리기사 실기가 있었어.' },
    ],
  });

  assert.equal(result.outcome, 'resolved');
  assert.match(result.retrievalQuery, /정보처리기사/);
  // 어시스턴트 발화가 입력에 실려야 그 날짜를 복원할 수 있다.
  assert.match(calls[0].input, /어시스턴트: 8월 20일에 정보처리기사/);
});

test('자체 완결 질문은 모델을 부르지 않고 원문 그대로 통과한다', async () => {
  const { resolver, calls } = createResolver(() => {
    throw new Error('자체 완결 질문에는 해석 모델을 부르지 않아야 합니다.');
  });

  const result = await resolver.resolve({
    userText: 'EODHD 무료 플랜 하루 호출 한도가 얼마야?',
    recentConversation: SCHEDULE_CONVERSATION,
  });

  assert.deepEqual(result, {
    outcome: 'pass',
    retrievalQuery: 'EODHD 무료 플랜 하루 호출 한도가 얼마야?',
    error: null,
  });
  assert.equal(calls.length, 0);
});

test('대화 이어가기는 no_retrieval로 corpus를 건드리지 않는다', async () => {
  const { resolver, calls } = createResolver(() => ({ outcome: 'no_retrieval', query: '' }));

  const result = await resolver.resolve({
    userText: '응 그래서?',
    recentConversation: SCHEDULE_CONVERSATION,
  });

  assert.equal(result.outcome, 'no_retrieval');
  assert.equal(result.retrievalQuery, null);
  assert.equal(calls.length, 1);
});

test('지시 대상을 못 고르면 ambiguous로 fail-close한다', async () => {
  const { resolver } = createResolver(() => ({ outcome: 'ambiguous', query: '' }));

  const result = await resolver.resolve({
    userText: '그거는?',
    recentConversation: [
      { role: 'user', content: '오늘 할 일이랑 메일 둘 다 정리해줘.' },
      { role: 'assistant', content: '할 일 3개와 메일 2통을 정리했어.' },
    ],
  });

  assert.equal(result.outcome, 'ambiguous');
  assert.equal(result.retrievalQuery, null);
  assert.match(AMBIGUOUS_RETRIEVAL_NOTICE, /되물어라/);
});

test('해석 실패는 원문 검색으로 되돌아가지 않고 ambiguous가 된다', async () => {
  for (const handler of [
    () => { throw new Error('timeout'); },
    () => ({ outcome: 'resolved', query: '' }),
    () => ({ outcome: 'weird', query: '뭔가' }),
    () => null,
  ]) {
    const { resolver } = createResolver(handler);
    const result = await resolver.resolve({
      userText: '그때 뭐 했었지?',
      recentConversation: SCHEDULE_CONVERSATION,
    });
    assert.equal(result.outcome, 'ambiguous');
    assert.equal(result.retrievalQuery, null);
    assert.ok(result.error);
  }
});

test('주제가 바뀐 자립 질문은 이전 해석을 물려받지 않는다', async () => {
  const { resolver, calls } = createResolver(() => ({
    outcome: 'resolved',
    query: '2026년 8월 20일 수원 군대 모임',
  }));

  const first = await resolver.resolve({
    userText: '그때 뭐 했었지?',
    recentConversation: SCHEDULE_CONVERSATION,
  });
  assert.equal(first.outcome, 'resolved');

  const second = await resolver.resolve({
    userText: '기상청 격자 변환식은 어디에 정리돼 있어?',
    recentConversation: [
      ...SCHEDULE_CONVERSATION,
      { role: 'user', content: '그때 뭐 했었지?' },
      { role: 'assistant', content: '수원에서 군대 사람들이랑 저녁 먹었어.' },
    ],
  });

  assert.equal(second.outcome, 'pass');
  assert.equal(second.retrievalQuery, '기상청 격자 변환식은 어디에 정리돼 있어?');
  assert.equal(calls.length, 1);
});

test('최근 대화가 없으면 해석 단계를 열지 않는다', async () => {
  const { resolver, calls } = createResolver(() => {
    throw new Error('대화가 없으면 해석 모델을 부르지 않아야 합니다.');
  });

  const result = await resolver.resolve({ userText: '그때 뭐 했었지?', recentConversation: [] });
  assert.equal(result.outcome, 'pass');
  assert.equal(calls.length, 0);
});

test('저렴한 게이트는 지시어와 짧은 이어가기만 통과시킨다', () => {
  for (const text of [
    '그때 뭐 했었지?',
    '그 때 저녁에는?',
    '그거 어떻게 됐어?',
    '거기 다시 가?',
    '아까 말한 거 다시 알려줘',
    '응 그래서?',
    '어때?',
  ]) {
    assert.equal(needsConversationalResolution(text), true, text);
  }

  for (const text of [
    'EODHD 무료 플랜 하루 호출 한도가 얼마야?',
    '기상청 격자 변환식은 어디에 정리돼 있어?',
    // `그 거리`의 `그 거`를 지시어로 읽지 않는다.
    '그 거리가 몇 킬로미터인지 계산해줘',
    '그런데 오늘 서울 날씨는 어때 보여? 우산 챙길지 정해야 해',
    '더블린 물가 정리한 노트 찾아줘',
  ]) {
    assert.equal(needsConversationalResolution(text), false, text);
  }
});

test('해석 입력은 최근 6개 메시지와 메시지당 400자로 묶는다', () => {
  const conversation = Array.from({ length: 12 }, (unused, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `메시지${index}`.padEnd(900, '가'),
  }));
  const normalized = normalizeConversation([
    ...conversation,
    { role: 'system', content: '무시된다' },
    { role: 'user', content: '   ' },
  ]);

  assert.equal(normalized.length, 6);
  assert.equal(normalized[0].content.length, 400);
  assert.equal(normalized.at(-1).content.startsWith('메시지11'), true);
});
