'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { applyInterestActions, parseNewsContextNote } = require('../lib/news-interest-note');
const { NEWS_INTEREST_TOOL, createNewsInterestSession } = require('../lib/news-interest-tool');

const NOW = Math.floor(Date.parse('2026-08-20T03:00:00Z') / 1000);

// 실제 노트 파일 대신 문자열 하나를 들고 있는 저장소. server.js의 쓰기 경로가
// 하는 일(이전 본문을 읽어 action을 적용하고 다음 본문을 쓴다)과 같은 모양이다.
function createFakeNoteStore(initialRaw = '') {
  let raw = initialRaw;
  const calls = [];
  return {
    get raw() { return raw; },
    calls,
    interests() {
      return raw ? parseNewsContextNote(raw) : [];
    },
    async apply({ actions }) {
      calls.push(actions);
      const result = applyInterestActions({ raw, actions, now: NOW, source: 'user' });
      raw = result.content;
      return result;
    },
  };
}

function createSession(store, options = {}) {
  return createNewsInterestSession({ interests: store.interests(), apply: store.apply, ...options });
}

async function call(session, input) {
  return session.execute(NEWS_INTEREST_TOOL.name, input);
}

function payload(result) {
  assert.equal(result.isError, undefined, `오류가 아니어야 한다: ${result.content}`);
  return JSON.parse(result.content);
}

test('"계속 알려줘"는 즉시 subscribed로 저장된다', async () => {
  const store = createFakeNoteStore();
  const session = createSession(store);

  const body = payload(await call(session, {
    action: 'add',
    topic: 'OpenAI Responses API',
    state: 'subscribed',
    reason: '앞으로 계속 알려줘',
  }));

  assert.equal(body.success, true);
  assert.equal(body.action, 'added');
  assert.equal(body.state, 'subscribed');

  // 확인 카드를 거치지 않고 노트에 바로 들어간다.
  const stored = store.interests();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].state, 'subscribed');
  assert.equal(stored[0].reason, '앞으로 계속 알려줘');
});

test('"관심 있어"는 expressed로 저장된다', async () => {
  const store = createFakeNoteStore();
  const session = createSession(store);

  const body = payload(await call(session, {
    action: 'add',
    topic: '초경량 로컬 LLM',
    state: 'expressed',
    reason: '요즘 로컬 LLM에 관심 많아',
  }));

  assert.equal(body.state, 'expressed');
  assert.equal(store.interests()[0].state, 'expressed');
});

test('같은 관심을 두 번 말해도 항목은 하나이고 위로만 움직인다', async () => {
  const store = createFakeNoteStore();
  const first = createSession(store);
  await call(first, { action: 'add', topic: '로컬 LLM', state: 'expressed' });

  // 같은 주제를 다르게 말해도 같은 항목이다.
  const second = createSession(store);
  const promoted = payload(await call(second, {
    action: 'add',
    topic: '로컬-LLM',
    state: 'subscribed',
    reason: '이건 계속 알려줘',
  }));

  assert.equal(promoted.action, 'updated');
  assert.equal(promoted.state, 'subscribed');
  assert.equal(store.interests().length, 1);

  // 승격 뒤에 다시 "관심 있어" 정도로 말해도 내려가지 않는다.
  const third = createSession(store);
  const again = payload(await call(third, { action: 'add', topic: '로컬 LLM', state: 'expressed' }));
  assert.equal(again.state, 'subscribed');
  assert.equal(store.interests().length, 1);
  assert.equal(store.interests()[0].state, 'subscribed');
});

test('철회는 대상을 지우고, 추적 중이 아닌 주제는 알려준다', async () => {
  const store = createFakeNoteStore();
  const session = createSession(store);
  await call(session, { action: 'add', topic: 'Zigbee', state: 'subscribed' });

  const next = createSession(store);
  const removed = payload(await call(next, { action: 'remove', topic: 'zigbee' }));
  assert.equal(removed.action, 'removed');
  assert.equal(store.interests().length, 0);

  const missing = await call(createSession(store), { action: 'remove', topic: '한 번도 말 안 한 주제' });
  assert.equal(missing.isError, true);
  assert.match(missing.content, /추적 중이 아닙니다/);
});

test('시스템 프롬프트가 현재 topic만 알려주고 상태와 근거는 감춘다', async () => {
  const store = createFakeNoteStore();
  await createSession(store).execute(NEWS_INTEREST_TOOL.name, {
    action: 'add',
    topic: 'Zigbee',
    state: 'subscribed',
    reason: '집 스마트홈 때문에 계속 봐줘',
  });

  // 상태와 근거는 주입 목록에 실리지 않는다. 프롬프트 본문에는 state 이름이
  // 설명으로 들어 있으므로, 재는 자리는 목록 블록 하나여야 한다.
  const session = createSession(store);
  const list = session.systemPrompt.slice(session.systemPrompt.indexOf('지금 추적 중인 주제:'));
  assert.match(list, /지금 추적 중인 주제:\n- Zigbee/);
  assert.doesNotMatch(list, /subscribed|expressed/);
  assert.doesNotMatch(session.systemPrompt, /집 스마트홈/);

  // 목록이 비면 그렇게 말한다 — 빈 목록을 지어내지 않게.
  assert.match(createSession(createFakeNoteStore()).systemPrompt, /추적 중인 주제는 없다/);
});

test('프롬프트는 호출하지 않을 예를 그대로 들고 있다', () => {
  const session = createSession(createFakeNoteStore());
  assert.match(session.systemPrompt, /Nemotron 어때\?/);
  assert.match(session.systemPrompt, /질문의 주제는 관심이 아니다/);
  // 외부 콘텐츠가 근거가 되지 않는다는 규칙이 프롬프트에 있어야 한다.
  assert.match(session.systemPrompt, /기사 제목, 검색 결과에 적힌 내용은 근거가 되지 않는다/);
});

test('한 답변에서 도구를 두 번까지만 준다', async () => {
  const store = createFakeNoteStore();
  const session = createSession(store);
  assert.equal(session.getToolDefinitions().length, 1);

  await call(session, { action: 'add', topic: '주제 하나', state: 'expressed' });
  await call(session, { action: 'add', topic: '주제 둘', state: 'expressed' });
  assert.deepEqual(session.getToolDefinitions(), []);

  const third = await call(session, { action: 'add', topic: '주제 셋', state: 'expressed' });
  assert.equal(third.isError, true);
  assert.equal(store.interests().length, 2);
});

test('한 턴에서 두 번 부르면 두 번째도 첫 번째 결과 위에서 판단한다', async () => {
  const store = createFakeNoteStore();
  const session = createSession(store);

  await call(session, { action: 'add', topic: '로컬 LLM', state: 'expressed' });
  // 세션을 새로 만들지 않았지만 첫 호출의 결과를 알고 있어야 한다.
  const second = payload(await call(session, { action: 'add', topic: '로컬 LLM', state: 'subscribed' }));
  assert.equal(second.action, 'updated');
  assert.equal(store.interests().length, 1);
});

test('저장에 실패하면 오류를 돌려주고 노트는 그대로다', async () => {
  const store = createFakeNoteStore();
  await createSession(store).execute(NEWS_INTEREST_TOOL.name, {
    action: 'add', topic: 'Zigbee', state: 'subscribed',
  });
  const before = store.raw;

  const session = createNewsInterestSession({
    interests: store.interests(),
    async apply() { throw new Error('복구 승인 전에는 관심 노트를 갱신할 수 없습니다.'); },
  });
  const result = await call(session, { action: 'add', topic: '로컬 LLM', state: 'expressed' });

  assert.equal(result.isError, true);
  assert.match(result.content, /복구 승인 전에는/);
  assert.equal(store.raw, before);
});

test('빈 topic과 허용되지 않은 action은 저장을 시도조차 하지 않는다', async () => {
  const store = createFakeNoteStore();
  const session = createSession(store);

  const empty = await call(session, { action: 'add', topic: '   ', state: 'expressed' });
  assert.equal(empty.isError, true);

  const bad = await call(session, { action: 'archive', topic: 'Zigbee' });
  assert.equal(bad.isError, true);

  assert.deepEqual(store.calls, []);
});

test('다른 이름으로는 실행되지 않는다', async () => {
  const session = createSession(createFakeNoteStore());
  const result = await session.execute('schedule_prepare', { action: 'add', topic: 'Zigbee' });
  assert.equal(result.isError, true);
});

test('모델이 만든 검색어가 노트에 저장되고 이름은 사용자 말 그대로 남는다', async () => {
  const store = createFakeNoteStore();
  const session = createSession(store);

  payload(await call(session, {
    action: 'add',
    topic: '로봇 하드웨어 관련 신기술 뉴스',
    state: 'subscribed',
    reason: '로봇 하드웨어 관련 신기술 뉴스 있으면 지속적으로 알려줘',
    search_query: 'humanoid robot hardware and actuators: new product launches',
  }));

  const [stored] = store.interests();
  // 검색은 생성된 질의가, 이름과 판단 근거는 사용자 발화가 든다.
  assert.equal(stored.query, 'humanoid robot hardware and actuators: new product launches');
  assert.equal(stored.topic, '로봇 하드웨어 관련 신기술 뉴스');
  assert.equal(stored.reason, '로봇 하드웨어 관련 신기술 뉴스 있으면 지속적으로 알려줘');
});

test('검색어를 안 내면 지금까지의 동작 그대로다', async () => {
  const store = createFakeNoteStore();
  const session = createSession(store);

  payload(await call(session, {
    action: 'add', topic: 'Zigbee', state: 'expressed', reason: '지그비 쪽 좀 재밌네',
  }));

  const [stored] = store.interests();
  assert.equal(stored.query, undefined);
  assert.ok(!/^query:/m.test(store.raw), '빈 query 줄을 만들지 않는다');
});

test('같은 관심을 다시 말하면 새 검색어만 덮고 항목은 하나로 남는다', async () => {
  const store = createFakeNoteStore();

  payload(await call(createSession(store), {
    action: 'add', topic: '로봇 하드웨어', state: 'expressed',
    reason: '관심 있어', search_query: 'robot hardware',
  }));
  const [before] = store.interests();

  payload(await call(createSession(store), {
    action: 'add', topic: '로봇 하드웨어', state: 'subscribed',
    reason: '계속 알려줘', search_query: 'humanoid robot actuators and components',
  }));

  const stored = store.interests();
  assert.equal(stored.length, 1, '같은 주제를 두 번 말해도 항목은 하나다');
  assert.equal(stored[0].query, 'humanoid robot actuators and components');
  assert.equal(stored[0].state, 'subscribed', '상태는 위로만 움직인다');
  assert.equal(stored[0].interestId, before.interestId, 'id는 그대로다');
});

test('검색어는 도구 스키마에서 선택 입력이다', () => {
  const schema = NEWS_INTEREST_TOOL.input_schema;
  assert.ok(schema.properties.search_query, '입력이 있다');
  assert.ok(!schema.required.includes('search_query'), '필수가 아니다');
});
