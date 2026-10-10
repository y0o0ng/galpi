'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  COVERED_CONCEPTS, FIELD_LIMITS, buildPrompt, claudeArgs, generateCandidates, renderPrompt, validateCards,
} = require('../lib/reels/candidates');

const ITEMS = ['a', 'b', 'c', 'd'].map(name => ({
  source: 'S', title: `title ${name}`, url: `https://example.com/${name}`, published_at: '2026-10-01T00:00:00.000Z', summary: '',
}));

function card(name, extra = {}) {
  return {
    title: `title ${name}`, url: `https://example.com/${name}`, published_at: '2026-10-01',
    why: 'w', concept: 'c', bridge: 'b', template: '단계', hook_paradox: 'p', hook_term: 't', hook_subtitle: 's', risk: 'r', everyday_door: 'e',
    ...extra,
  };
}

// 뉴스 없는 유입용 카드.
const Q = card('q', { title: '하품은 왜 옮을까?', url: '', published_at: '없음' });

// 실제 claude를 절대 실행하지 않는다. spawn을 가짜로 바꿔 인자와 stdin만 잡는다.
function fakeSpawn({ stdout = '', code = 0, hang = false } = {}) {
  const calls = [];
  const spawn = (bin, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = () => { child.killed = true; };
    const call = { bin, args, options, stdin: '', child };
    child.stdin = Object.assign(new EventEmitter(), { end: text => { call.stdin = text; } });
    calls.push(call);
    if (!hang) {
      setImmediate(() => {
        child.stdout.emit('data', stdout);
        child.emit('close', code);
      });
    }
    return child;
  };
  spawn.calls = calls;
  return spawn;
}

const OK = JSON.stringify({ structured_output: { cards: [card('a'), card('b'), Q] } });
const args = { items: ITEMS, covered: COVERED_CONCEPTS, today: '2026-10-02', bin: '/fake/claude' };

test('claude 인자: 도구를 끄고 스키마·세션 비저장·MCP 차단을 건다', () => {
  const list = claudeArgs();
  assert.equal(list[list.indexOf('--tools') + 1], '');
  assert.equal(list[list.indexOf('--model') + 1], 'opus');
  assert.ok(list.includes('--no-session-persistence'));
  assert.ok(list.includes('--strict-mcp-config'));
  assert.ok(list.includes('-p'));
  assert.equal(JSON.parse(list[list.indexOf('--json-schema') + 1]).properties.cards.minItems, 3);
});

test('프롬프트는 stdin으로 가고 환경에는 로그인 상태 외 비밀이 없다', async () => {
  const spawn = fakeSpawn({ stdout: OK });
  const cards = await generateCandidates({ ...args, spawn });
  assert.equal(cards.length, 3);
  const [call] = spawn.calls;
  assert.equal(call.bin, '/fake/claude');
  assert.ok(call.args.includes('--tools'));
  assert.match(call.stdin, /비신뢰 데이터/);
  assert.match(call.stdin, /https:\/\/example\.com\/a/);
  assert.deepEqual(Object.keys(call.options.env).sort(), ['HOME', 'LANG', 'PATH']);
});

test('프롬프트 칸 규칙: 빈 칸·없는 칸이면 실패한다', () => {
  assert.throws(() => renderPrompt('{{a}} {{b}}', { a: 1 }), /빈 칸/);
  assert.throws(() => renderPrompt('{{a}}', { a: 1, z: 2 }), /초과/);
  // 값 안의 {{...}}는 다시 채우지 않는다.
  assert.equal(renderPrompt('{{a}}', { a: '{{b}}' }), '{{b}}');
  const prompt = buildPrompt({ today: '2026-10-02', covered: ['x'], items: ITEMS });
  assert.doesNotMatch(prompt, /\{\{/);
});

test('뉴스 2장 + 유입용 1장이어야 하고, 지어낸 URL 카드는 버린다', () => {
  assert.deepEqual(validateCards({ cards: [card('a'), card('b'), Q] }, ITEMS).map(c => c.url), [ITEMS[0].url, ITEMS[1].url, '']);
  // 유입용은 모델이 앞에 둬도 3번째로 가고, 넘치는 카드는 자른다.
  assert.equal(validateCards({ cards: [Q, card('a'), card('b'), card('c')] }, ITEMS)[2].url, '');
  assert.throws(() => validateCards({ cards: [card('a'), card('b'), card('c')] }, ITEMS), { code: 'REELS_CARDS_INVALID' });
  assert.throws(() => validateCards({ cards: [card('a'), Q, Q] }, ITEMS), { code: 'REELS_CARDS_INVALID' });
  assert.throws(
    () => validateCards({ cards: [card('a'), card('x', { url: 'https://evil.example/x' }), Q] }, ITEMS),
    { code: 'REELS_CARDS_INVALID' },
  );
  // 같은 URL 중복, 길이 초과, 빈 필드도 그 카드만 버린다.
  assert.throws(() => validateCards({ cards: [card('a'), card('a'), Q] }, ITEMS), { code: 'REELS_CARDS_INVALID' });
  assert.throws(
    () => validateCards({ cards: [card('a'), card('b'), card('q', { url: '', risk: 'x'.repeat(FIELD_LIMITS.risk + 1) })] }, ITEMS),
    { code: 'REELS_CARDS_INVALID' },
  );
  assert.throws(() => validateCards({ cards: [card('a'), card('b'), card('q', { url: '', why: ' ' })] }, ITEMS), { code: 'REELS_CARDS_INVALID' });
  assert.throws(() => validateCards({}, ITEMS), { code: 'REELS_CARDS_INVALID' });
});

test('result 문자열 JSON도 받고, 종료 코드·깨진 JSON·시간 초과는 실패 코드로 끝난다', async () => {
  const viaResult = JSON.stringify({ result: JSON.stringify({ cards: [card('a'), card('b'), Q] }) });
  assert.equal((await generateCandidates({ ...args, spawn: fakeSpawn({ stdout: viaResult }) })).length, 3);
  await assert.rejects(generateCandidates({ ...args, spawn: fakeSpawn({ code: 1 }) }), { code: 'REELS_CLAUDE_EXIT' });
  await assert.rejects(generateCandidates({ ...args, spawn: fakeSpawn({ stdout: 'not json' }) }), { code: 'REELS_OUTPUT_PARSE' });
  await assert.rejects(
    generateCandidates({ ...args, spawn: fakeSpawn({ stdout: JSON.stringify({ is_error: true, result: 'x' }) }) }),
    { code: 'REELS_CLAUDE_ERROR', detail: 'x' },   // 실패 이유(CLI 오류 문구)를 남긴다
  );
  const hung = fakeSpawn({ hang: true });
  await assert.rejects(generateCandidates({ ...args, spawn: hung, timeoutMs: 20 }), { code: 'REELS_CLAUDE_TIMEOUT' });
  assert.equal(hung.calls[0].child.killed, true);
});
