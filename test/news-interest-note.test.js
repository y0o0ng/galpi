'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_INTERESTS,
  applyInterestActions,
  buildNewsContextNote,
  normalizeTopic,
  parseNewsContextNote,
} = require('../lib/news-interest-note');

function epoch(value) {
  return Math.floor(Date.parse(value) / 1000);
}

const NOW = epoch('2026-08-20T03:00:00Z'); // KST 2026-08-20 12:00

function noteWith(actions, options = {}) {
  return applyInterestActions({ raw: options.raw || '', actions, now: options.now || NOW, source: options.source });
}

function addAction(topic, state = 'expressed', extra = {}) {
  return { op: 'add', topic, state, reason: `${topic} 근거`, ...extra };
}

test('빈 입력에서 관심 노트를 만들고 다시 읽는다', () => {
  const empty = buildNewsContextNote({ interests: [], previousRaw: '', updatedAt: NOW });
  assert.match(empty, /owner_agent: news/);
  assert.match(empty, /note_type: news_context/);
  assert.match(empty, /ai_readable: true/);
  assert.match(empty, /codex_status: pending/);
  assert.match(empty, /updated: 2026-08-20/);
  assert.deepEqual(parseNewsContextNote(empty), []);

  const { content } = noteWith([addAction('OpenAI Responses API', 'subscribed')], { raw: empty });
  const parsed = parseNewsContextNote(content);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].topic, 'OpenAI Responses API');
  assert.equal(parsed[0].state, 'subscribed');
  assert.equal(parsed[0].lastSeen, '2026-08-20');
  assert.match(parsed[0].interestId, /^news-[0-9a-f]{4,}$/);
});

test('Codex 마커와 created는 이전 본문에서 그대로 옮긴다', () => {
  const previous = buildNewsContextNote({
    interests: [],
    previousRaw: '',
    updatedAt: epoch('2026-08-01T03:00:00Z'),
  })
    .replace('<!-- CODEX-TAGS-START -->\n<!-- CODEX-TAGS-END -->',
      '<!-- CODEX-TAGS-START -->\n#뉴스 #관심\n<!-- CODEX-TAGS-END -->')
    .replace('<!-- CODEX-LINKS-START -->\n<!-- CODEX-LINKS-END -->',
      '<!-- CODEX-LINKS-START -->\n- [[xion-home]]\n<!-- CODEX-LINKS-END -->');

  const { content } = noteWith([addAction('Zigbee')], { raw: previous });

  assert.match(content, /#뉴스 #관심/);
  assert.match(content, /\[\[xion-home\]\]/);
  assert.match(content, /created: 2026-08-01/);
  assert.match(content, /updated: 2026-08-20/);
});

test('XION-NEWS 마커가 없으면 파싱하지 않고 던진다', () => {
  assert.throws(
    () => parseNewsContextNote('---\ntitle: "손상된 노트"\n---\n\n본문만 있다.\n'),
    error => error.code === 'NEWS_NOTE_MARKER_MISSING',
  );
});

test('마커 밖 내용은 관심으로 읽지 않는다', () => {
  const { content } = noteWith([addAction('Zigbee')]);
  // Codex 영역에 관심처럼 생긴 문단이 들어와도 파서가 무시해야 한다.
  const polluted = content.replace(
    '<!-- CODEX-LINKS-START -->',
    '<!-- CODEX-LINKS-START -->\n### 가짜 관심\n<!-- interest_id: news-ffff -->\nstate: subscribed\nlast_seen: 2026-08-20',
  );
  const parsed = parseNewsContextNote(polluted);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].topic, 'Zigbee');
});

test('정규화 후 같은 topic은 두 항목이 되지 않는다', () => {
  const { content } = noteWith([addAction('로컬 LLM')]);

  for (const duplicate of ['로컬 LLM', '로컬  llm', '로컬-LLM', '로컬이 LLM']) {
    assert.throws(
      () => noteWith([addAction(duplicate)], { raw: content }),
      error => error.code === 'NEWS_TOPIC_DUPLICATE',
      `중복으로 잡혀야 한다: ${duplicate}`,
    );
  }

  // 다른 주제는 통과한다 — 정규화가 과하게 접으면 서로 다른 관심이 합쳐진다.
  const { interests } = noteWith([addAction('로컬 TTS')], { raw: content });
  assert.equal(interests.length, 2);
});

test('normalizeTopic은 같은 입력에 항상 같은 값을 준다', () => {
  assert.equal(normalizeTopic('Local  LLM'), normalizeTopic('local-llm'));
  assert.equal(normalizeTopic('the Local LLM'), normalizeTopic('Local LLM'));
  assert.notEqual(normalizeTopic('local llm'), normalizeTopic('local tts'));
  assert.equal(normalizeTopic('   '), '');
});

test('빈 topic은 거부한다', () => {
  assert.throws(
    () => noteWith([addAction('   ')]),
    error => error.code === 'NEWS_TOPIC_EMPTY',
  );
});

test('허용되지 않은 op과 state를 거부한다', () => {
  assert.throws(
    () => noteWith([{ op: 'archive', topic: 'Zigbee' }]),
    error => error.code === 'NEWS_ACTION_OP_INVALID',
  );
  assert.throws(
    () => noteWith([addAction('Zigbee', 'watching')]),
    error => error.code === 'NEWS_ACTION_STATE_INVALID',
  );
});

test('update/remove 대상이 정확히 하나가 아니면 거부한다', () => {
  const { content } = noteWith([addAction('Zigbee')]);
  assert.throws(
    () => noteWith([{ op: 'update', interestId: 'news-없는id', state: 'subscribed' }], { raw: content }),
    error => error.code === 'NEWS_ACTION_TARGET_INVALID',
  );
  assert.throws(
    () => noteWith([{ op: 'remove', interestId: 'news-없는id' }], { raw: content }),
    error => error.code === 'NEWS_ACTION_TARGET_INVALID',
  );
});

test('노트에 중복 interest_id가 있으면 읽기부터 실패한다', () => {
  const { content, interests } = noteWith([addAction('Zigbee')]);
  const duplicated = content.replace(
    `state: ${interests[0].state}`,
    `state: ${interests[0].state}\n\n### 사본\n<!-- interest_id: ${interests[0].interestId} -->\nstate: expressed\nlast_seen: 2026-08-20`,
  );
  assert.throws(
    () => parseNewsContextNote(duplicated),
    error => error.code === 'NEWS_INTEREST_ID_DUPLICATE',
  );
});

test('background는 subscribed를 지우거나 만들 수 없다', () => {
  const { content, interests } = noteWith([addAction('OpenAI API', 'subscribed')]);
  const id = interests[0].interestId;

  assert.throws(
    () => noteWith([{ op: 'remove', interestId: id }], { raw: content, source: 'background' }),
    error => error.code === 'NEWS_ACTION_REMOVE_FORBIDDEN',
  );
  assert.throws(
    () => noteWith([{ op: 'update', interestId: id, state: 'subscribed' }], { raw: content, source: 'background' }),
    error => error.code === 'NEWS_ACTION_STATE_FORBIDDEN',
  );
  assert.throws(
    () => noteWith([addAction('Zigbee', 'expressed')], { raw: content, source: 'background' }),
    error => error.code === 'NEWS_ACTION_STATE_FORBIDDEN',
  );

  // background가 할 수 있는 것: inferred 생성과 inferred 제거.
  const inferred = noteWith([addAction('Zigbee', 'inferred')], { raw: content, source: 'background' });
  assert.equal(inferred.interests.length, 2);
  const removed = noteWith(
    [{ op: 'remove', interestId: inferred.interests[1].interestId }],
    { raw: inferred.content, source: 'background' },
  );
  assert.equal(removed.interests.length, 1);

  // 사용자는 subscribed를 지울 수 있다.
  const byUser = noteWith([{ op: 'remove', interestId: id }], { raw: content });
  assert.equal(byUser.interests.length, 0);
});

test('하나라도 걸리면 아무것도 적용되지 않는다', () => {
  const { content } = noteWith([addAction('Zigbee')]);
  assert.throws(
    () => noteWith([addAction('로컬 LLM'), { op: 'remove', interestId: 'news-없는id' }], { raw: content }),
    error => error.code === 'NEWS_ACTION_TARGET_INVALID',
  );
  // 던진 뒤에도 이전 본문은 그대로다 — 호출부가 이 값을 계속 쓴다.
  assert.equal(parseNewsContextNote(content).length, 1);
});

test('관심사 상한을 넘기지 않는다', () => {
  let raw = '';
  for (let index = 0; index < MAX_INTERESTS; index += 1) {
    raw = noteWith([addAction(`주제 ${index}`)], { raw }).content;
  }
  assert.equal(parseNewsContextNote(raw).length, MAX_INTERESTS);
  assert.throws(
    () => noteWith([addAction('하나 더')], { raw }),
    error => error.code === 'NEWS_INTEREST_LIMIT',
  );
});

test('topic이 바뀌어도 interest_id는 그대로다', () => {
  const { content, interests } = noteWith([addAction('로컬 LLM')]);
  const id = interests[0].interestId;
  const renamed = noteWith([{ op: 'update', interestId: id, topic: '초경량 로컬 LLM' }], { raw: content });
  assert.equal(renamed.interests[0].interestId, id);
  assert.equal(renamed.interests[0].topic, '초경량 로컬 LLM');
});

test('update는 last_seen을 오늘로 옮기고 승격을 반영한다', () => {
  const { content, interests } = noteWith([addAction('Zigbee')], { now: epoch('2026-07-01T03:00:00Z') });
  assert.equal(interests[0].lastSeen, '2026-07-01');

  const promoted = noteWith(
    [{ op: 'update', interestId: interests[0].interestId, state: 'subscribed' }],
    { raw: content },
  );
  assert.equal(promoted.interests[0].state, 'subscribed');
  assert.equal(promoted.interests[0].lastSeen, '2026-08-20');
});

test('review_after와 aliases가 왕복한다', () => {
  const { content } = noteWith([
    addAction('로컬 LLM', 'expressed', { reviewAfter: '2026-09-20', aliases: ['local llm', '온디바이스 모델'] }),
  ]);
  const parsed = parseNewsContextNote(content);
  assert.equal(parsed[0].reviewAfter, '2026-09-20');
  assert.deepEqual(parsed[0].aliases, ['local llm', '온디바이스 모델']);
});

test('noop은 아무것도 바꾸지 않는다', () => {
  const { content } = noteWith([addAction('Zigbee')]);
  const after = noteWith([{ op: 'noop' }], { raw: content });
  assert.equal(after.interests.length, 1);
  assert.equal(after.interests[0].topic, 'Zigbee');
});

test('생성된 검색어는 노트에 보이는 자리에 남고 다시 읽힌다', () => {
  const { content } = noteWith([addAction('로봇 하드웨어 관련 신기술 뉴스', 'subscribed', {
    query: 'humanoid robot hardware and robotics components: new product launches',
  })]);
  // 사람이 볼 수 있어야 "왜 이런 게 왔지"를 되짚는다.
  assert.match(content, /^query: humanoid robot hardware and robotics components: new product launches$/m);

  const [interest] = parseNewsContextNote(content);
  assert.equal(interest.query, 'humanoid robot hardware and robotics components: new product launches');
  // 이름은 사용자가 말한 그대로 남는다.
  assert.equal(interest.topic, '로봇 하드웨어 관련 신기술 뉴스');
});

test('검색어가 없는 관심은 줄 자체가 생기지 않는다', () => {
  const { content } = noteWith([addAction('Zigbee')]);
  assert.ok(!/^query:/m.test(content), '빈 query 줄을 만들지 않는다');
  assert.equal(parseNewsContextNote(content)[0].query, undefined);
});

test('검색어는 수집이 자르는 길이를 넘지 않는다', () => {
  const long = 'robot '.repeat(60);
  const { content } = noteWith([addAction('로봇', 'expressed', { query: long })]);
  const saved = parseNewsContextNote(content)[0].query;
  // 자른 자리가 공백이면 다시 읽을 때 trim돼 180보다 짧아질 수 있다. 잠그는 것은
  // 상한이지 정확한 길이가 아니다 — normalize.js가 180에서 자르므로 그보다 길면 안 된다.
  assert.ok(saved.length <= 180, `${saved.length}자`);
  assert.ok(saved.length < long.trim().length, '실제로 잘렸다');
});

test('update는 준 것만 덮고 이름과 id는 그대로 둔다', () => {
  const first = noteWith([addAction('로봇 하드웨어', 'expressed', { query: 'robot hardware' })]);
  const [before] = parseNewsContextNote(first.content);

  const second = applyInterestActions({
    raw: first.content,
    actions: [{ op: 'update', interestId: before.interestId, query: 'humanoid robot actuators' }],
    now: NOW,
    source: 'user',
  });
  const [after] = parseNewsContextNote(second.content);

  assert.equal(after.query, 'humanoid robot actuators');
  assert.equal(after.topic, before.topic);
  assert.equal(after.interestId, before.interestId);
  assert.equal(after.state, before.state);
});
