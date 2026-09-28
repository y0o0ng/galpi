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
const { attachmentBlocker, diagnose } = require('../scripts/diagnose-memory-p0-b-generation-blockers');

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

function scheduleFixture(t, filename = ':memory:') {
  const db = new Database(filename);
  t.after(() => { if (db.open) db.close(); });
  db.exec(`
    CREATE TABLE assistant_tasks (id INTEGER PRIMARY KEY, title TEXT, detail TEXT,
      status TEXT, lifecycle TEXT, due_kind TEXT, due_date TEXT, due_at INTEGER,
      series_id INTEGER, version INTEGER, created_at INTEGER);
    CREATE TABLE assistant_task_events (id INTEGER PRIMARY KEY, task_id INTEGER,
      event_type TEXT, from_status TEXT, to_status TEXT, from_lifecycle TEXT,
      to_lifecycle TEXT, task_version INTEGER, occurred_at INTEGER);
    CREATE TABLE assistant_reminders (id INTEGER PRIMARY KEY, task_id INTEGER,
      remind_at INTEGER, status TEXT, created_at INTEGER, fired_at INTEGER,
      acknowledged_at INTEGER, cancelled_at INTEGER);
    CREATE TABLE assistant_task_series (id INTEGER PRIMARY KEY, freq TEXT,
      by_weekday TEXT, by_monthday INTEGER, time_kind TEXT, time_of_day TEXT,
      status TEXT, version INTEGER, created_at INTEGER, updated_at INTEGER,
      ended_at INTEGER);
  `);
  const addTask = (id, transitions, fields = {}) => {
    let before = { status: null, lifecycle: null };
    transitions.forEach(([type, at, status, lifecycle], index) => {
      db.prepare(`INSERT INTO assistant_task_events
        (task_id,event_type,from_status,to_status,from_lifecycle,to_lifecycle,task_version,occurred_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(id, type, before.status, status,
        before.lifecycle, lifecycle, index + 1, at);
      before = { status, lifecycle };
    });
    db.prepare(`INSERT INTO assistant_tasks
      (id,title,detail,status,lifecycle,due_kind,due_date,due_at,series_id,version,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, fields.title || `task ${id}`, fields.detail || '',
      before.status, before.lifecycle, fields.dueKind || 'date', fields.dueDate || '2026-09-30',
      fields.dueAt ?? null, fields.seriesId ?? null, transitions.length, transitions[0][1]);
  };
  const at = createdAt => historicalSchedule(db, { createdAt }, { ASSISTANT_TASKS_ENABLED: 'true' });
  return { db, addTask, at };
}

test('historical schedule excludes completed, deleted and unrelated past tasks', t => {
  const { db, addTask, at } = scheduleFixture(t);
  assert.deepEqual(historicalSchedule(db, { createdAt: 100 }, { ASSISTANT_TASKS_ENABLED: 'false' }),
    { reconstructable: true, kind: 'DISABLED', text: '' });
  addTask(1, [['created', 10, 'active', 'active'], ['completed', 20, 'done', 'closed']]);
  addTask(2, [['created', 15, 'active', 'active'], ['deleted', 30, 'active', 'deleted']]);
  addTask(3, [['created', 5, 'active', 'active'], ['completed', 6, 'done', 'closed'],
    ['reopened', 110, 'active', 'active'], ['updated', 120, 'active', 'active']]);
  assert.equal(at(100).kind, 'EMPTY');
  assert.equal(Object.hasOwn(at(100), 'reason'), false);
  assert.match(at(100).text, /활성 일정: 없음/);
  assert.equal(at(100).reconstructable, true);
});

test('historical active task uses retained fields only without a later update', t => {
  const { addTask, at } = scheduleFixture(t);
  addTask(1, [['created', 10, 'active', 'active']], { title: 'stable title' });
  assert.equal(at(100).kind, 'ACTIVE');
  assert.equal(Object.hasOwn(at(100), 'reason'), false);
  assert.match(at(100).text, /stable title/);
});

test('completion after target preserves target-time active task and reminder', t => {
  const { db, addTask, at } = scheduleFixture(t);
  addTask(1, [['created', 10, 'active', 'active'], ['completed', 120, 'done', 'closed']]);
  db.prepare(`INSERT INTO assistant_reminders VALUES (1,1,90,'cancelled',10,NULL,NULL,120)`).run();
  assert.equal(at(100).kind, 'ACTIVE');
  assert.match(at(100).text, /알림: .*pending/);
});

test('later field update is unrecoverable but earlier update is retained', t => {
  const { addTask, at } = scheduleFixture(t);
  addTask(1, [['created', 10, 'active', 'active'], ['updated', 90, 'active', 'active']],
    { title: 'after earlier edit' });
  assert.match(at(100).text, /after earlier edit/);
  addTask(2, [['created', 20, 'active', 'active'], ['updated', 110, 'active', 'active']]);
  assert.equal(at(100).reason, 'TASK_LATER_FIELD_UPDATE');
});

test('reopened and restored events determine active status at target', t => {
  const { addTask, at } = scheduleFixture(t);
  addTask(1, [['created', 10, 'active', 'active'], ['completed', 20, 'done', 'closed'],
    ['reopened', 30, 'active', 'active']]);
  addTask(2, [['created', 10, 'active', 'active'], ['deleted', 20, 'active', 'deleted'],
    ['restored', 30, 'active', 'active']]);
  assert.match(at(40).text, /활성 일정: 2개/);
  assert.equal(at(25).kind, 'EMPTY');
});

test('later reminder cancellation reconstructs target-time live reminder', t => {
  const { db, addTask, at } = scheduleFixture(t);
  addTask(1, [['created', 10, 'active', 'active']]);
  db.prepare(`INSERT INTO assistant_reminders VALUES (1,1,90,'cancelled',10,80,NULL,120)`).run();
  assert.match(at(100).text, /알림: .*fired/);
});

test('same-second task or reminder mutation fails closed', t => {
  const { db, addTask, at } = scheduleFixture(t);
  addTask(1, [['created', 10, 'active', 'active']]);
  db.prepare(`INSERT INTO assistant_reminders VALUES (1,1,90,'cancelled',10,NULL,NULL,100)`).run();
  assert.equal(at(100).reason, 'REMINDER_SAME_SECOND');
  db.prepare('DELETE FROM assistant_reminders').run();
  addTask(2, [['created', 20, 'active', 'active'], ['completed', 100, 'done', 'closed']]);
  assert.equal(at(100).reason, 'TASK_EVENT_SAME_SECOND');
});

test('later series rule change or end fails closed only while affected', t => {
  const { db, addTask, at } = scheduleFixture(t);
  db.prepare(`INSERT INTO assistant_task_series VALUES
    (1,'daily',NULL,NULL,'date',NULL,'ended',3,10,120,120)`).run();
  addTask(1, [['created', 10, 'active', 'active'], ['completed', 40, 'done', 'closed']],
    { seriesId: 1 });
  assert.equal(at(100).reason, 'SERIES_ENDED_AFTER_TARGET');
  assert.equal(at(130).kind, 'EMPTY');
});

test('later series rule edit lacks a historical snapshot; later materialization alone does not change rule', t => {
  const { db, addTask, at } = scheduleFixture(t);
  db.prepare(`INSERT INTO assistant_task_series VALUES
    (1,'daily',NULL,NULL,'date',NULL,'active',2,10,120,NULL)`).run();
  addTask(1, [['created', 20, 'active', 'active']], { seriesId: 1 });
  assert.equal(at(100).reason, 'SERIES_HISTORICAL_RULE_UNAVAILABLE');
  db.prepare('UPDATE assistant_task_series SET version=1 WHERE id=1').run();
  assert.equal(at(100).kind, 'ACTIVE');
  assert.match(at(100).text, /반복 #1 매일/);
  db.prepare("UPDATE assistant_task_series SET version=2, updated_at=100, status='ended', ended_at=100 WHERE id=1").run();
  assert.equal(at(100).reason, 'SERIES_END_SAME_SECOND');
});

test('schedule diagnostic reasons cover creation overlap and broken event chronology', t => {
  const { db, addTask, at } = scheduleFixture(t);
  db.prepare(`INSERT INTO assistant_task_series VALUES
    (1,'daily',NULL,NULL,'date',NULL,'active',1,100,100,NULL)`).run();
  assert.equal(at(100).reason, 'SERIES_CREATED_SAME_SECOND');
  db.prepare('DELETE FROM assistant_task_series').run();
  addTask(1, [['created', 100, 'active', 'active']]);
  assert.equal(at(100).reason, 'TASK_CREATED_SAME_SECOND');
  db.prepare('DELETE FROM assistant_task_events').run();
  db.prepare('DELETE FROM assistant_tasks').run();
  addTask(2, [['created', 10, 'active', 'active']]);
  db.prepare('UPDATE assistant_task_events SET task_version=3 WHERE task_id=2').run();
  assert.equal(at(100).reason, 'TASK_EVENT_CHAIN_INVALID');
});

test('schedule diagnostic distinguishes overlapping reminders and missing series rule', t => {
  const { db, addTask, at } = scheduleFixture(t);
  addTask(1, [['created', 10, 'active', 'active']], { seriesId: 99 });
  assert.equal(at(100).reason, 'MISSING_SERIES_RULE');
  db.prepare('UPDATE assistant_tasks SET series_id=NULL WHERE id=1').run();
  db.prepare(`INSERT INTO assistant_reminders VALUES (1,1,90,'cancelled',10,NULL,NULL,120)`).run();
  db.prepare(`INSERT INTO assistant_reminders VALUES (2,1,95,'cancelled',20,NULL,NULL,130)`).run();
  assert.equal(at(100).reason, 'MULTIPLE_HISTORICAL_LIVE_REMINDERS');
});

test('historical schedule sorts retained active tasks as production all-view does', t => {
  const { addTask, at } = scheduleFixture(t);
  addTask(1, [['created', 10, 'active', 'active']], { title: 'later date', dueDate: '2026-10-01' });
  addTask(2, [['created', 20, 'active', 'active']], { title: 'earlier date', dueDate: '2026-09-30' });
  const text = at(100).text;
  assert.ok(text.indexOf('earlier date') < text.indexOf('later date'));
});

test('attachment blocker preserves target, prefix and both-case precedence', () => {
  assert.equal(attachmentBlocker(1, 0), 'TARGET_ATTACHMENT_UNREPLAYABLE');
  assert.equal(attachmentBlocker(0, 2), 'PREFIX_ATTACHMENT_UNREPLAYABLE');
  assert.equal(attachmentBlocker(1, 2), 'TARGET_AND_PREFIX_ATTACHMENT_UNREPLAYABLE');
  assert.equal(attachmentBlocker(0, 0), null);
});

test('blocker diagnostic keeps all 79 frozen dispositions, privacy and deterministic readonly output', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p0b-blocker-diagnostic-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'test.db');
  const { db, addTask } = scheduleFixture(t, filename);
  db.exec(`
    CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, created_at INTEGER);
    CREATE TABLE attachment_blobs (id INTEGER PRIMARY KEY, status TEXT);
    CREATE TABLE attachments (id TEXT PRIMARY KEY, blob_id INTEGER, scope TEXT, lifecycle_status TEXT);
    CREATE TABLE message_attachments (message_id INTEGER, attachment_id TEXT, position INTEGER);
  `);
  const manifestBytes = fs.readFileSync(path.join(root, 'fixtures/memory-r3-p0b-generation-input-freeze.json'));
  const manifest = JSON.parse(manifestBytes);
  const historicalDispositions = manifest.cases.map(item => item.disposition);
  const blocked = manifest.cases.filter(item => item.disposition === 'INDETERMINATE_TOOL_REPLAY');
  const scheduleCases = blocked.filter(item => item.scheduleReplay === 'UNRECOVERABLE');
  const attachmentCases = blocked.filter(item => item.scheduleReplay === 'ACTIVE');
  const cutoff = Math.floor((Math.max(...scheduleCases.map(item => item.targetCreatedAt))
    + Math.min(...attachmentCases.map(item => item.targetCreatedAt))) / 2);
  db.prepare(`INSERT INTO assistant_task_series VALUES
    (1,'daily',NULL,NULL,'date',NULL,'ended',2,1,?,?)`).run(cutoff, cutoff);
  addTask(1, [['created', cutoff + 1, 'active', 'active']]);
  const insertMessage = db.prepare('INSERT INTO messages VALUES (?, ?, ?)');
  blocked.forEach(item => insertMessage.run(item.messageId, 'session', item.targetCreatedAt));
  db.prepare("INSERT INTO attachment_blobs VALUES (1,'deleted'),(2,'deleted')").run();
  db.prepare("INSERT INTO attachments VALUES ('a',1,'temporary','deleted'),('b',2,'temporary','deleted')").run();
  db.prepare('INSERT INTO message_attachments VALUES (?, ?, 0)').run(attachmentCases[0].messageId, 'a');
  const secondPrefixId = attachmentCases[1].prefixMessageIds
    .find(id => id !== attachmentCases[0].messageId
      && !attachmentCases[0].prefixMessageIds.includes(id));
  db.prepare('INSERT INTO message_attachments VALUES (?, ?, 0)').run(secondPrefixId, 'b');
  assert.throws(() => diagnose({ db, manifestBytes,
    baselineCommit: 'a'.repeat(40), implementationCommit: 'b'.repeat(40) }), /readonly/);
  db.close();
  const readonly = new Database(filename, { readonly: true, fileMustExist: true });
  t.after(() => readonly.close());
  readonly.pragma('query_only=ON');
  const options = { db: readonly, manifestBytes,
    baselineCommit: 'a'.repeat(40), implementationCommit: 'b'.repeat(40) };
  const first = diagnose(options);
  const second = diagnose(options);
  assert.equal(first.bytes, second.bytes);
  assert.deepEqual(first.artifact.blockerCounts, {
    PREFIX_ATTACHMENT_UNREPLAYABLE: 1,
    SERIES_ENDED_AFTER_TARGET: 59,
    TARGET_ATTACHMENT_UNREPLAYABLE: 1,
  });
  assert.deepEqual(first.artifact.scheduleBlockerCounts, { SERIES_ENDED_AFTER_TARGET: 59 });
  assert.deepEqual(first.artifact.attachmentOnlyCounts, {
    PREFIX_ATTACHMENT_UNREPLAYABLE: 1, TARGET_ATTACHMENT_UNREPLAYABLE: 1,
  });
  assert.equal(first.artifact.cases.length, 79);
  assert.equal(first.artifact.cases.filter(item => item.blocker === null).length, 18);
  assert.deepEqual(manifest.cases.map(item => item.disposition), historicalDispositions);
  assert.equal(first.artifact.safety.totalChangesDelta, 0);
  assert.equal(first.artifact.safety.externalApiCalls, 0);
  assert.equal(first.artifact.safety.answerGenerations, 0);
  assert.doesNotMatch(first.bytes, /"(?:question|answer|title|filename|content|scope)"\s*:/i);
  assert.throws(() => diagnose({ ...options, manifestBytes: Buffer.from(`${manifestBytes} `) }), /SHA/);
});

test('private bundle CLI refuses a repository-tracked destination', async () => {
  await assert.rejects(main([
    '--db', 'unused', '--vault', 'unused', '--census', 'unused',
    '--code-commit', 'a'.repeat(40),
    '--manifest-output', 'unused',
    '--private-output', path.join(root, 'fixtures/private.json'),
  ]), /repository 밖/);
});
