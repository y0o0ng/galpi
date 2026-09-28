'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Database = require('better-sqlite3');
const {
  selectCensus, historicalPrefix, formatHistory, timeLine,
  contextMessage, pastMessages, assertOnlyD0Diff,
  historicalSchedule, main,
} = require('../scripts/freeze-memory-p0-b-generation-inputs');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

function productionFunction(name, context) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (!depth) return vm.runInNewContext(`(${source.slice(start, i + 1)})`, context);
  }
  throw new Error(`${name} 함수 끝을 찾지 못했습니다.`);
}

test('fixed census admits only the 79 frozen sensitive invocations', () => {
  const bytes = fs.readFileSync(path.join(root, 'fixtures/memory-r3-p0b-replay-census-freeze.json'));
  const census = JSON.parse(bytes);
  const cases = selectCensus(census, bytes);
  assert.equal(cases.length, 79);
  assert.ok(cases.every(item => item.disposition === 'REPLAY_SENSITIVE'));
  assert.throws(() => selectCensus(census, Buffer.from(`${bytes} `)), /hash/);
  assert.throws(() => selectCensus({ ...census, counts: { dispositions: { REPLAY_SENSITIVE: 78 } } }, bytes), /79건/);
});

test('same-session prefix uses canonical (created_at, id) order and excludes later messages', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p0b-input-history-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = new Database(path.join(dir, 'test.db'));
  t.after(() => db.close());
  db.exec(`CREATE TABLE messages (
    id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT,
    model TEXT, created_at INTEGER, embedding TEXT
  )`);
  const insert = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?)');
  insert.run(0, 'other', 'user', 'old cross-session candidate text', null, 90, '[1,0]');
  insert.run(1, 'same', 'user', 'old', null, 100, '[1,0]');
  insert.run(2, 'other', 'assistant', 'old answer', null, 91, null);
  insert.run(3, 'same', 'assistant', 'before', null, 101, null);
  insert.run(4, 'same', 'user', 'same second before', null, 102, '[1,0]');
  insert.run(5, 'same', 'user', 'target', null, 102, '[1,0]');
  insert.run(6, 'same', 'assistant', 'future same second', null, 102, null);
  insert.run(7, 'same', 'user', 'future', null, 103, '[1,0]');
  insert.run(8, 'other', 'user', 'backdated future candidate text', null, 90, '[1,0]');
  insert.run(9, 'other', 'assistant', 'backdated future answer', null, 91, null);
  const target = { id: 5, sessionId: 'same', createdAt: 102 };
  assert.deepEqual(historicalPrefix(db, target, 3).map(x => x.id), [3, 4]);
  assert.deepEqual(historicalPrefix(db, target, 20).map(x => x.id), [1, 3, 4]);
  assert.deepEqual(pastMessages(db, [1, 0], target).map(x => x.id), [0]);
});

test('history and context formatting match current production functions', () => {
  const normalizeMessageTimestamp = value => value === null ? null : Number(value);
  const buildElapsedDayMarker = (before, after) => before !== null && after > before
    && Math.floor((after - before) / 86400) >= 1
    ? `[${Math.floor((after - before) / 86400)}일 후]` : '';
  const extractCouncilSynthesis = productionFunction('extractCouncilSynthesis');
  const productionHistory = productionFunction('formatHistoryForModelContext', {
    normalizeMessageTimestamp, buildElapsedDayMarker, extractCouncilSynthesis,
  });
  const rows = [
    { role: 'user', content: '처음', createdAt: 100 },
    { role: 'assistant', content: '## 종합\n결론', model: '의회', createdAt: 101 },
    { role: 'user', content: '다음', createdAt: 86502 },
  ];
  assert.deepEqual(formatHistory(rows), JSON.parse(JSON.stringify(productionHistory(rows))));
  const epoch = Date.parse('2026-09-01T10:20:00+09:00') / 1000;
  assert.equal(timeLine(epoch, epoch - 86400), '[현재 시각: 2026-09-01 10:20 KST]\n[1일 후]');
  const context = {
    question: '오늘?', epoch, previous: epoch - 86400,
    memory: ['기억'], notes: [{ title: '제목', content: '본문', limit: 5000 }],
    past: [], schedule: '', d0: '<retrieval>\n근거\n</retrieval>',
  };
  const productionContext = productionFunction('buildContextMessage', {
    buildTimeContext: () => timeLine(context.epoch, context.previous),
    MAX_MEMORY_CHARS: 1200, MAX_NOTE_CONTEXT_CHARS: 5000,
    truncateNoteContext: value => value,
    buildWebContextBlock: () => '',
  });
  assert.equal(contextMessage(context), productionContext(
    context.question, [{ title: '제목', content: '본문' }], context.memory,
    context.past, null, new Date(epoch * 1000), context.previous,
    context.schedule, context.d0, '',
  ));
  assert.doesNotMatch(contextMessage(context), /2026-09-28/);
});

test('arm payloads have the same non-D0 canonical input and no tool definitions', () => {
  const shared = { model: 'gpt-6-luna', history: [{ role: 'user', content: '질문' }],
    instructions: '공통 지시', toolPolicy: 'LIVE_TOOLS_DISABLED' };
  const { left, right, commonHash } = assertOnlyD0Diff(shared, 'hard', 'global');
  assert.notEqual(left.d0Context, right.d0Context);
  assert.equal(left.history, right.history);
  assert.equal(typeof commonHash, 'string');
  assert.equal(Object.hasOwn(left, 'tools'), false);
  assert.equal(Object.hasOwn(right, 'tools'), false);
});

test('historical schedule fails closed when prior task state lacks a durable full snapshot', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p0b-schedule-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = new Database(path.join(dir, 'test.db'));
  t.after(() => db.close());
  db.exec('CREATE TABLE assistant_tasks (id INTEGER PRIMARY KEY, created_at INTEGER)');
  const target = { createdAt: 100 };
  assert.deepEqual(historicalSchedule(db, target, { ASSISTANT_TASKS_ENABLED: 'false' }),
    { reconstructable: true, text: '' });
  assert.match(historicalSchedule(db, target, { ASSISTANT_TASKS_ENABLED: 'true' }).text,
    /활성 일정: 없음/);
  db.prepare('INSERT INTO assistant_tasks VALUES (1, 100)').run();
  assert.equal(historicalSchedule(db, target, { ASSISTANT_TASKS_ENABLED: 'true' }).reconstructable, false);
});

test('private bundle CLI refuses a repository-tracked destination', async () => {
  await assert.rejects(main([
    '--db', 'unused', '--vault', 'unused', '--census', 'unused',
    '--code-commit', 'a'.repeat(40),
    '--manifest-output', 'unused',
    '--private-output', path.join(root, 'fixtures/private.json'),
  ]), /repository 밖/);
});
