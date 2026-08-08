'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const { createAssistantScheduler } = require('../lib/assistant-scheduler');
const { AssistantTaskError, createAssistantTaskStore } = require('../lib/assistant-tasks');
const {
  MATERIALIZE_MAX_ROWS,
  createAssistantTaskSeriesStore,
} = require('../lib/assistant-task-series');

function epoch(value) {
  return Math.floor(Date.parse(value) / 1000);
}

// 2026-08-10은 월요일이다. 모든 테스트가 이 시각을 기준으로 움직인다.
const MONDAY_0900 = epoch('2026-08-10T09:00:00+09:00');

function createContext(startNow = MONDAY_0900) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      note_type TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      codex_status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE auto_save_decisions (
      id INTEGER PRIMARY KEY,
      decision TEXT NOT NULL,
      action TEXT
    );
    CREATE TABLE note_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chunk_id TEXT UNIQUE NOT NULL,
      note_filename TEXT NOT NULL,
      note_title TEXT NOT NULL,
      chunk_type TEXT NOT NULL,
      content TEXT NOT NULL,
      source_session TEXT,
      source_user_message INTEGER,
      source_assistant_message INTEGER,
      embedding TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE assistant_retrieval_shadow_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      mode TEXT NOT NULL,
      notes_json TEXT NOT NULL,
      chunks_json TEXT NOT NULL,
      context_chars INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);
  runDatabaseMigrations(db);

  const clock = { now: startNow };
  const now = () => clock.now;
  const taskStore = createAssistantTaskStore(db, { now });
  const seriesStore = createAssistantTaskSeriesStore(db, { now, taskStore });
  return { db, clock, taskStore, seriesStore };
}

function seriesInput(overrides = {}, recurrence = {}) {
  return {
    clientRequestId: 'series-req-0001',
    title: '운동',
    ...overrides,
    recurrence: {
      freq: 'weekly',
      byWeekday: [1, 3, 5],
      startDate: '2026-08-10',
      timeKind: 'datetime',
      timeOfDay: '19:30:00',
      ...recurrence,
    },
  };
}

function occurrenceDates(result) {
  return result.occurrences.map(item => item.occurrenceDate);
}

test('시리즈를 만들면 회차가 창 안에서 함께 생긴다', () => {
  const { seriesStore } = createContext();
  const result = seriesStore.create(seriesInput());

  assert.equal(result.replayed, false);
  assert.equal(result.series.freq, 'weekly');
  assert.equal(result.series.byWeekday, '1,3,5');
  assert.equal(result.series.status, 'active');
  assert.equal(result.series.materializedThrough, '2026-10-09');
  assert.deepEqual(occurrenceDates(result).slice(0, 5), [
    '2026-08-10', '2026-08-12', '2026-08-14', '2026-08-17', '2026-08-19',
  ]);
  // 오늘 포함 61일 창에 월·수·금이 27회 들어간다.
  assert.equal(result.occurrences.length, 27);
});

test('회차는 series_id와 occurrence_date를 가진 평범한 task 행이다', () => {
  const { db, seriesStore } = createContext();
  const { series } = seriesStore.create(seriesInput());

  const first = db.prepare(`
    SELECT client_request_id AS clientRequestId, title, due_kind AS dueKind,
           due_at AS dueAt, status, lifecycle, series_id AS seriesId,
           occurrence_date AS occurrenceDate, overridden
    FROM assistant_tasks WHERE occurrence_date = '2026-08-12'
  `).get();
  assert.deepEqual(first, {
    clientRequestId: `series:${series.id}:2026-08-12`,
    title: '운동',
    dueKind: 'datetime',
    dueAt: epoch('2026-08-12T19:30:00+09:00'),
    status: 'active',
    lifecycle: 'active',
    seriesId: series.id,
    occurrenceDate: '2026-08-12',
    overridden: 0,
  });

  // 회차마다 자기 알림이 하나씩 붙는다. one_live_per_task UNIQUE가 그대로 성립한다.
  const reminders = db.prepare(`
    SELECT COUNT(*) AS count FROM assistant_reminders
    WHERE task_id IN (SELECT id FROM assistant_tasks WHERE series_id = ?)
      AND status = 'pending'
  `).get(series.id);
  assert.equal(reminders.count, 27);
});

test('기본 알림 계약이 회차에도 그대로 적용된다', () => {
  const { db, seriesStore } = createContext();
  const { series } = seriesStore.create(seriesInput());

  const reminder = db.prepare(`
    SELECT r.remind_at AS remindAt, r.origin
    FROM assistant_reminders r
    JOIN assistant_tasks t ON t.id = r.task_id
    WHERE t.series_id = ? AND t.occurrence_date = '2026-08-12'
  `).get(series.id);
  // 시각이 있는 기한이라 10분 전이고, 사용자가 정한 값이 아니라 기본 알림이다.
  assert.equal(reminder.remindAt, epoch('2026-08-12T19:20:00+09:00'));
  assert.equal(reminder.origin, 'auto');
});

test('알림 앞당김을 정하면 회차마다 그 시각의 사용자 알림이 된다', () => {
  const { db, seriesStore } = createContext();
  const { series } = seriesStore.create(seriesInput({}, { reminderLeadSeconds: 2 * 60 * 60 }));

  const reminder = db.prepare(`
    SELECT r.remind_at AS remindAt, r.origin
    FROM assistant_reminders r
    JOIN assistant_tasks t ON t.id = r.task_id
    WHERE t.series_id = ? AND t.occurrence_date = '2026-08-12'
  `).get(series.id);
  assert.equal(reminder.remindAt, epoch('2026-08-12T17:30:00+09:00'));
  assert.equal(reminder.origin, 'user');
});

test('날짜만 반복하는 시리즈는 날짜 기한 회차를 만든다', () => {
  const { db, seriesStore } = createContext();
  seriesStore.create(seriesInput({}, {
    freq: 'daily', byWeekday: undefined, timeKind: 'date', timeOfDay: undefined,
  }));

  const row = db.prepare(`
    SELECT due_kind AS dueKind, due_date AS dueDate, due_at AS dueAt
    FROM assistant_tasks WHERE occurrence_date = '2026-08-11'
  `).get();
  assert.deepEqual(row, { dueKind: 'date', dueDate: '2026-08-11', dueAt: null });
});

test('오늘 이미 지난 시각의 회차는 만들지 않는다', () => {
  // 월요일 20:00에 만든 19:30 반복은 오늘 회차를 건너뛴다.
  const { seriesStore } = createContext(epoch('2026-08-10T20:00:00+09:00'));
  const result = seriesStore.create(seriesInput());
  assert.equal(occurrenceDates(result)[0], '2026-08-12');
});

test('materialize를 다시 돌려도 회차가 늘지 않는다', () => {
  const { db, seriesStore } = createContext();
  const { series } = seriesStore.create(seriesInput());
  const before = db.prepare('SELECT COUNT(*) AS count FROM assistant_tasks').get().count;

  seriesStore.materialize(series.id);
  seriesStore.materialize(series.id);
  const again = seriesStore.materialize(series.id);

  assert.deepEqual(again.created, []);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assistant_tasks').get().count, before);
});

test('하루가 지나면 창 끝에 회차가 이어 붙는다', () => {
  const { clock, seriesStore } = createContext();
  const { series } = seriesStore.create(seriesInput({}, {
    freq: 'daily', byWeekday: undefined,
  }));
  assert.equal(seriesStore.get(series.id).occurrences.length, 61);

  clock.now += 24 * 60 * 60;
  const grown = seriesStore.materializeDue();
  assert.equal(grown.length, 1);
  assert.deepEqual(grown[0].created.map(task => task.occurrenceDate), ['2026-10-10']);
});

test('창이 아직 찬 시리즈는 tick 대상에서 빠진다', () => {
  const { seriesStore } = createContext();
  seriesStore.create(seriesInput());
  assert.deepEqual(seriesStore.materializeDue(), []);
});

test('드문 규칙도 최소 4회는 확보한다', () => {
  const { seriesStore } = createContext();
  // 60일 창에는 8월 31일 하나뿐이지만 다음 4회까지 창을 늘린다.
  const result = seriesStore.create(seriesInput({}, {
    freq: 'monthly', byWeekday: undefined, byMonthday: 31,
  }));
  assert.deepEqual(occurrenceDates(result), [
    '2026-08-31', '2026-10-31', '2026-12-31', '2027-01-31',
  ]);
});

test('종료일이 있으면 그 뒤로 회차를 만들지 않는다', () => {
  const { clock, seriesStore } = createContext();
  const result = seriesStore.create(seriesInput({}, {
    freq: 'daily', byWeekday: undefined, endDate: '2026-08-13',
  }));
  assert.deepEqual(occurrenceDates(result), [
    '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13',
  ]);

  clock.now += 30 * 24 * 60 * 60;
  assert.deepEqual(seriesStore.materializeDue(), []);
});

test('같은 요청 재전송은 새 시리즈도 새 회차도 만들지 않는다', () => {
  const { db, seriesStore } = createContext();
  const first = seriesStore.create(seriesInput());
  const replay = seriesStore.create(seriesInput());

  assert.equal(replay.replayed, true);
  assert.equal(replay.series.id, first.series.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assistant_task_series').get().count, 1);
  assert.equal(replay.occurrences.length, first.occurrences.length);
});

test('같은 요청 ID로 다른 규칙을 보내면 409다', () => {
  const { seriesStore } = createContext();
  seriesStore.create(seriesInput());
  assert.throws(
    () => seriesStore.create(seriesInput({}, { timeOfDay: '20:00:00' })),
    error => error instanceof AssistantTaskError && error.code === 'SERIES_CREATE_CONFLICT' && error.statusCode === 409
  );
});

test('요일 목록은 중복을 지우고 오름차순으로 고정한다', () => {
  const { seriesStore } = createContext();
  const { series } = seriesStore.create(seriesInput({}, { byWeekday: [5, 1, 3, 1] }));
  assert.equal(series.byWeekday, '1,3,5');
});

test('잘못된 반복 규칙은 거부한다', () => {
  const { seriesStore } = createContext();
  const rejects = (recurrence, code) => assert.throws(
    () => seriesStore.create(seriesInput({ clientRequestId: `series-req-${code}` }, recurrence)),
    error => error instanceof AssistantTaskError && error.code === code,
    code
  );

  rejects({ freq: 'yearly' }, 'INVALID_RECURRENCE_FREQ');
  rejects({ byWeekday: [] }, 'INVALID_RECURRENCE_WEEKDAY');
  rejects({ byWeekday: [0] }, 'INVALID_RECURRENCE_WEEKDAY');
  rejects({ byWeekday: [8] }, 'INVALID_RECURRENCE_WEEKDAY');
  rejects({ freq: 'monthly', byWeekday: undefined, byMonthday: 32 }, 'INVALID_RECURRENCE_MONTHDAY');
  rejects({ startDate: '2026-08-09' }, 'RECURRENCE_START_IN_PAST');
  rejects({ startDate: '2026-02-30' }, 'INVALID_DUE_DATE');
  rejects({ endDate: '2026-08-09' }, 'INVALID_RECURRENCE_END');
  rejects({ timeKind: 'weekly' }, 'INVALID_RECURRENCE_TIME_KIND');
  rejects({ timeOfDay: '25:00:00' }, 'INVALID_RECURRENCE_TIME');
  rejects({ timeOfDay: '7:30:00' }, 'INVALID_RECURRENCE_TIME');
  rejects({ timeKind: 'date', timeOfDay: '19:30:00' }, 'INVALID_RECURRENCE_TIME');
  // 날짜만 반복하는 일정에는 앞당길 기준 시각이 없다.
  rejects({ timeKind: 'date', timeOfDay: undefined, reminderLeadSeconds: 600 }, 'INVALID_RECURRENCE_REMINDER');
  rejects({ reminderLeadSeconds: -1 }, 'INVALID_RECURRENCE_REMINDER');
  rejects({ reminderLeadSeconds: 31 * 24 * 60 * 60 }, 'INVALID_RECURRENCE_REMINDER');
});

test('단발 일정은 반복 열이 비어 있고 회차 조회에 섞이지 않는다', () => {
  const { db, taskStore, seriesStore } = createContext();
  const { series } = seriesStore.create(seriesInput());
  taskStore.create({
    clientRequestId: 'single-task-0001',
    title: '단발',
    due: { kind: 'date', date: '2026-08-11' },
  });

  assert.deepEqual(db.prepare(`
    SELECT series_id AS seriesId, occurrence_date AS occurrenceDate, overridden
    FROM assistant_tasks WHERE client_request_id = 'single-task-0001'
  `).get(), { seriesId: null, occurrenceDate: null, overridden: 0 });
  assert.ok(seriesStore.listOccurrences(series.id).every(item => item.occurrenceDate !== null));
});

test('회차는 기존 목록·달력 조회에 그대로 들어온다', () => {
  const { taskStore, seriesStore } = createContext();
  seriesStore.create(seriesInput({}, { freq: 'daily', byWeekday: undefined }));

  const today = taskStore.list({ view: 'today' });
  assert.equal(today.today.length, 1);
  assert.equal(today.today[0].title, '운동');

  const summary = taskStore.summary();
  assert.equal(summary.week.find(day => day.date === '2026-08-11').count, 1);
  assert.equal(summary.nextReminder.title, '운동');
});

test('없는 시리즈 조회는 404다', () => {
  const { seriesStore } = createContext();
  assert.throws(
    () => seriesStore.get(9999),
    error => error instanceof AssistantTaskError && error.code === 'SERIES_NOT_FOUND' && error.statusCode === 404
  );
});

// --- C2b: override, 규칙 변경, 놓친 회차 ---

function activeOccurrences(seriesStore, seriesId) {
  return seriesStore.listOccurrences(seriesId)
    .filter(item => item.status === 'active')
    .map(item => item.occurrenceDate);
}

test('회차를 직접 고치면 손댄 회차로 표시된다', () => {
  const { taskStore, seriesStore } = createContext();
  const { series } = seriesStore.create(seriesInput());
  const target = seriesStore.listOccurrences(series.id)
    .find(item => item.occurrenceDate === '2026-08-19');

  const { task } = taskStore.update(target.id, {
    expectedVersion: 1,
    due: { kind: 'datetime', at: '2026-08-19T20:00:00+09:00' },
  });
  assert.equal(task.overridden, 1);
  assert.equal(task.dueAt, epoch('2026-08-19T20:00:00+09:00'));
});

test('단발 일정은 고쳐도 손댄 표시가 붙지 않는다', () => {
  const { taskStore } = createContext();
  const created = taskStore.create({
    clientRequestId: 'single-task-0002',
    title: '단발',
    due: { kind: 'date', date: '2026-08-11' },
  });
  const { task } = taskStore.update(created.task.id, {
    expectedVersion: 1,
    due: { kind: 'date', date: '2026-08-12' },
  });
  assert.equal(task.overridden, 0);
});

test('규칙을 바꾸면 손대지 않은 미래 회차만 새 규칙으로 다시 생긴다', () => {
  const { taskStore, seriesStore } = createContext();
  const { series } = seriesStore.create(seriesInput());
  const before = seriesStore.listOccurrences(series.id);

  // 하나는 시간을 옮기고, 하나는 건너뛰고, 하나는 완료한다.
  const moved = before.find(item => item.occurrenceDate === '2026-08-19');
  const skipped = before.find(item => item.occurrenceDate === '2026-08-21');
  const done = before.find(item => item.occurrenceDate === '2026-08-12');
  taskStore.update(moved.id, {
    expectedVersion: 1,
    due: { kind: 'datetime', at: '2026-08-19T20:00:00+09:00' },
  });
  taskStore.transition(skipped.id, 'cancel', { expectedVersion: 1 });
  taskStore.transition(done.id, 'complete', { expectedVersion: 1 });

  const result = seriesStore.update(series.id, {
    expectedVersion: 1,
    recurrence: { timeOfDay: '07:00:00' },
  });
  assert.equal(result.unchanged, false);
  assert.equal(result.series.timeOfDay, '07:00:00');

  const after = new Map(seriesStore.listOccurrences(series.id).map(item => [item.occurrenceDate, item]));
  // 손대지 않은 회차는 새 시각으로 다시 생겼다.
  assert.equal(after.get('2026-08-17').dueAt, epoch('2026-08-17T07:00:00+09:00'));
  // 사용자가 옮긴 회차, 건너뛴 회차, 완료한 회차는 그대로다.
  assert.equal(after.get('2026-08-19').dueAt, epoch('2026-08-19T20:00:00+09:00'));
  assert.equal(after.get('2026-08-19').overridden, 1);
  assert.equal(after.get('2026-08-21').status, 'cancelled');
  assert.equal(after.get('2026-08-12').status, 'done');
  // 시각을 앞당기면 오늘 회차가 사라질 수 있다. 지금이 09:00이라 오늘 07:00은
  // 이미 지났고, 손대지 않은 회차라 지워진 뒤 새 시각으로 다시 만들어지지 않는다.
  assert.equal(after.has('2026-08-10'), false);
  assert.deepEqual(
    [...after.keys()].sort(),
    before.map(item => item.occurrenceDate).filter(date => date !== '2026-08-10').sort()
  );
});

test('시각을 뒤로 미루면 오늘 회차가 그 시각으로 남는다', () => {
  const { seriesStore } = createContext();
  const { series } = seriesStore.create(seriesInput());

  seriesStore.update(series.id, { expectedVersion: 1, recurrence: { timeOfDay: '22:00:00' } });
  const today = seriesStore.listOccurrences(series.id)
    .find(item => item.occurrenceDate === '2026-08-10');
  assert.equal(today.status, 'active');
  assert.equal(today.dueAt, epoch('2026-08-10T22:00:00+09:00'));
});

test('주기를 바꾸면 회차 날짜가 통째로 갈린다', () => {
  const { seriesStore } = createContext();
  const { series } = seriesStore.create(seriesInput());

  seriesStore.update(series.id, {
    expectedVersion: 1,
    recurrence: { freq: 'weekly', byWeekday: [2] },
  });
  const dates = activeOccurrences(seriesStore, series.id);
  assert.deepEqual(dates.slice(0, 3), ['2026-08-11', '2026-08-18', '2026-08-25']);
  assert.ok(dates.every(date => !['2026-08-10', '2026-08-12'].includes(date)));
});

test('주기를 바꾸면 그 주기가 쓰지 않는 필드는 함께 비워진다', () => {
  const { seriesStore } = createContext();
  const { series } = seriesStore.create(seriesInput());

  const result = seriesStore.update(series.id, {
    expectedVersion: 1,
    recurrence: { freq: 'monthly', byMonthday: 15 },
  });
  assert.equal(result.series.byWeekday, null);
  assert.equal(result.series.byMonthday, 15);
  assert.deepEqual(activeOccurrences(seriesStore, series.id).slice(0, 2), ['2026-08-15', '2026-09-15']);
});

test('주기만 바꾸고 필요한 필드를 빠뜨리면 거부한다', () => {
  const { seriesStore } = createContext();
  const { series } = seriesStore.create(seriesInput());
  assert.throws(
    () => seriesStore.update(series.id, { expectedVersion: 1, recurrence: { freq: 'monthly' } }),
    error => error instanceof AssistantTaskError && error.code === 'INVALID_RECURRENCE_MONTHDAY'
  );
});

test('제목만 바꾸면 회차를 다시 만들지 않는다', () => {
  const { seriesStore } = createContext();
  const { series } = seriesStore.create(seriesInput());
  const before = seriesStore.listOccurrences(series.id).map(item => item.id);

  const result = seriesStore.update(series.id, { expectedVersion: 1, title: '아침 운동' });
  assert.equal(result.series.title, '아침 운동');
  assert.equal(result.removed, 0);
  assert.deepEqual(seriesStore.listOccurrences(series.id).map(item => item.id), before);
});

test('바뀐 것이 없는 수정은 회차도 버전도 건드리지 않는다', () => {
  const { seriesStore } = createContext();
  const { series } = seriesStore.create(seriesInput());
  const result = seriesStore.update(series.id, { expectedVersion: 1, title: '운동' });
  assert.equal(result.unchanged, true);
  assert.equal(result.series.version, 1);
});

test('시작일이 과거로 내려간 시리즈도 계속 수정할 수 있다', () => {
  const { clock, seriesStore } = createContext();
  const { series } = seriesStore.create(seriesInput());
  clock.now += 30 * 24 * 60 * 60;

  const result = seriesStore.update(series.id, {
    expectedVersion: 1,
    recurrence: { timeOfDay: '07:00:00' },
  });
  assert.equal(result.series.startDate, '2026-08-10');
  assert.equal(result.series.timeOfDay, '07:00:00');
});

test('시리즈 버전이 다르면 409다', () => {
  const { seriesStore } = createContext();
  const { series } = seriesStore.create(seriesInput());
  assert.throws(
    () => seriesStore.update(series.id, { expectedVersion: 7, title: '다른 이름' }),
    error => error instanceof AssistantTaskError && error.code === 'SERIES_VERSION_CONFLICT' && error.statusCode === 409
  );
});

test('반복을 종료하면 미래 회차는 사라지고 지난 기록은 남는다', () => {
  const { taskStore, seriesStore } = createContext();
  const { series } = seriesStore.create(seriesInput());
  const done = seriesStore.listOccurrences(series.id)
    .find(item => item.occurrenceDate === '2026-08-10');
  taskStore.transition(done.id, 'complete', { expectedVersion: 1 });

  const result = seriesStore.end(series.id, { expectedVersion: 1 });
  assert.equal(result.series.status, 'ended');
  assert.equal(result.series.endedAt, MONDAY_0900);
  assert.equal(result.occurrences.length, 1);
  assert.equal(result.occurrences[0].occurrenceDate, '2026-08-10');
  assert.equal(result.occurrences[0].status, 'done');
});

test('종료한 반복은 더 자라지도 수정되지도 않는다', () => {
  const { clock, seriesStore } = createContext();
  const { series } = seriesStore.create(seriesInput());
  seriesStore.end(series.id, { expectedVersion: 1 });

  clock.now += 10 * 24 * 60 * 60;
  assert.deepEqual(seriesStore.materializeDue(), []);
  assert.deepEqual(seriesStore.listOccurrences(series.id), []);
  assert.throws(
    () => seriesStore.update(series.id, { expectedVersion: 2, title: '다시' }),
    error => error instanceof AssistantTaskError && error.code === 'SERIES_NOT_EDITABLE'
  );
});

test('종료 재요청은 멱등이다', () => {
  const { seriesStore } = createContext();
  const { series } = seriesStore.create(seriesInput());
  seriesStore.end(series.id, { expectedVersion: 1 });
  const again = seriesStore.end(series.id, { expectedVersion: 1 });
  assert.equal(again.unchanged, true);
  assert.equal(again.series.status, 'ended');
});

test('며칠 꺼져 있었어도 남는 놓친 회차는 하나다', () => {
  const { clock, seriesStore } = createContext();
  const { series } = seriesStore.create(seriesInput({}, {
    freq: 'daily', byWeekday: undefined,
  }));

  // 8월 10일 09:00에서 8월 15일 09:00으로 건너뛴다. 10~14일 회차 다섯이 지났다.
  clock.now = epoch('2026-08-15T09:00:00+09:00');
  const cancelled = seriesStore.sweepMissed();
  assert.equal(cancelled.length, 4);

  const past = seriesStore.listOccurrences(series.id)
    .filter(item => item.occurrenceDate < '2026-08-15');
  assert.deepEqual(
    past.filter(item => item.status === 'active').map(item => item.occurrenceDate),
    ['2026-08-14']
  );
  assert.ok(past.filter(item => item.status === 'cancelled').length === 4);
});

test('놓친 회차 정리는 서버가 한 일로 남는다', () => {
  const { db, clock, seriesStore } = createContext();
  seriesStore.create(seriesInput({}, { freq: 'daily', byWeekday: undefined }));
  clock.now = epoch('2026-08-13T09:00:00+09:00');
  seriesStore.sweepMissed();

  const actors = db.prepare(`
    SELECT DISTINCT actor_type AS actorType
    FROM assistant_task_events WHERE event_type = 'cancelled'
  `).all();
  assert.deepEqual(actors, [{ actorType: 'system' }]);
});

test('아직 오늘 회차 하나만 지났으면 정리하지 않는다', () => {
  const { clock, seriesStore } = createContext();
  const { series } = seriesStore.create(seriesInput({}, {
    freq: 'daily', byWeekday: undefined,
  }));

  // 하루만 지나면 지난 회차가 8월 10일 하나뿐이라 유예가 남는다.
  clock.now = epoch('2026-08-11T09:00:00+09:00');
  assert.deepEqual(seriesStore.sweepMissed(), []);
  assert.ok(activeOccurrences(seriesStore, series.id).includes('2026-08-10'));
});

test('정리는 단발 일정과 다른 시리즈를 건드리지 않는다', () => {
  const { clock, taskStore, seriesStore } = createContext();
  seriesStore.create(seriesInput({}, { freq: 'daily', byWeekday: undefined }));
  const single = taskStore.create({
    clientRequestId: 'single-task-0003',
    title: '단발',
    due: { kind: 'date', date: '2026-08-11' },
  });

  clock.now = epoch('2026-08-15T09:00:00+09:00');
  seriesStore.sweepMissed();
  assert.equal(taskStore.get(single.task.id).task.status, 'active');
});

test('사용자가 이미 완료한 지난 회차는 정리 대상이 아니다', () => {
  const { clock, taskStore, seriesStore } = createContext();
  const { series } = seriesStore.create(seriesInput({}, {
    freq: 'daily', byWeekday: undefined,
  }));
  const first = seriesStore.listOccurrences(series.id)
    .find(item => item.occurrenceDate === '2026-08-10');
  taskStore.transition(first.id, 'complete', { expectedVersion: 1 });

  clock.now = epoch('2026-08-15T09:00:00+09:00');
  seriesStore.sweepMissed();
  assert.equal(taskStore.get(first.id).task.status, 'done');
});

// --- C2c: 목록 접기와 scheduler 연결 ---

test('목록은 시리즈당 가장 이른 회차 하나로 접힌다', () => {
  const { taskStore, seriesStore } = createContext();
  seriesStore.create(seriesInput({}, { freq: 'daily', byWeekday: undefined }));
  taskStore.create({
    clientRequestId: 'single-task-0004',
    title: '단발',
    due: { kind: 'date', date: '2026-08-20' },
  });

  const all = taskStore.list({ view: 'all' });
  const occurrences = all.tasks.filter(task => task.seriesId !== null);
  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0].occurrenceDate, '2026-08-10');
  assert.equal(all.tasks.filter(task => task.seriesId === null).length, 1);
});

test('접힌 회차에 시리즈 규칙과 남은 회차 수가 실린다', () => {
  const { taskStore, seriesStore } = createContext();
  const { series } = seriesStore.create(seriesInput());

  const shown = taskStore.list({ view: 'all' }).tasks.find(task => task.seriesId !== null);
  assert.deepEqual(shown.series, {
    id: series.id,
    freq: 'weekly',
    byWeekday: '1,3,5',
    byMonthday: null,
    timeKind: 'datetime',
    timeOfDay: '19:30:00',
    status: 'active',
    remaining: 26,
  });
});

test('단발 일정에는 시리즈가 붙지 않는다', () => {
  const { taskStore } = createContext();
  taskStore.create({
    clientRequestId: 'single-task-0005',
    title: '단발',
    due: { kind: 'date', date: '2026-08-11' },
  });
  assert.equal(taskStore.list({ view: 'all' }).tasks[0].series, null);
});

test('놓친 회차가 있으면 그것이 접힌 자리에 보인다', () => {
  const { clock, taskStore, seriesStore } = createContext();
  seriesStore.create(seriesInput({}, { freq: 'daily', byWeekday: undefined }));

  clock.now = epoch('2026-08-13T09:00:00+09:00');
  seriesStore.sweepMissed();
  const today = taskStore.list({ view: 'today' });
  assert.equal(today.overdue.length, 1);
  assert.equal(today.overdue[0].occurrenceDate, '2026-08-12');
});

test('건수는 접히고 달력의 날짜별 건수는 접히지 않는다', () => {
  const { taskStore, seriesStore } = createContext();
  seriesStore.create(seriesInput({}, { freq: 'daily', byWeekday: undefined }));

  const summary = taskStore.summary();
  // 목록에 보이는 것은 오늘 회차 하나뿐이다.
  assert.deepEqual(summary.counts, { overdue: 0, today: 1, upcoming: 0, inbox: 0 });
  assert.equal(summary.preview.length, 1);
  assert.equal(summary.preview[0].series.remaining, 60);
  // 달력은 그날 몇 건인지를 답해야 하므로 매일 1건이 그대로 세어진다.
  assert.ok(summary.week.every(day => day.count === 1));
});

test('종결된 회차 목록은 접지 않는다', () => {
  const { taskStore, seriesStore } = createContext();
  const { series } = seriesStore.create(seriesInput());
  for (const date of ['2026-08-10', '2026-08-12', '2026-08-14']) {
    const item = seriesStore.listOccurrences(series.id).find(row => row.occurrenceDate === date);
    taskStore.transition(item.id, 'complete', { expectedVersion: 1 });
  }
  assert.equal(taskStore.list({ view: 'history' }).tasks.length, 3);
});

test('scheduler tick이 회차를 늘리고 놓친 회차를 정리한다', () => {
  const { db, clock, seriesStore } = createContext();
  const { series } = seriesStore.create(seriesInput({}, {
    freq: 'daily', byWeekday: undefined,
  }));
  const scheduler = createAssistantScheduler(db, {
    now: () => clock.now,
    beforeFire: now => ({
      cancelled: seriesStore.sweepMissed(now),
      materialized: seriesStore.materializeDue(now),
    }),
  });

  clock.now = epoch('2026-08-14T09:00:00+09:00');
  const result = scheduler.tick();
  assert.equal(result.maintenance.cancelled.length, 3);
  assert.deepEqual(
    result.maintenance.materialized[0].created.map(task => task.occurrenceDate),
    ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']
  );
  assert.equal(seriesStore.get(series.id).series.materializedThrough, '2026-10-13');
});

// 반복 쪽 버그 하나가 모든 일정의 알림을 조용히 멈추면 안 된다.
test('회차 유지보수가 실패해도 알림은 나간다', () => {
  const { db, clock, taskStore } = createContext();
  taskStore.create({
    clientRequestId: 'single-task-0006',
    title: '단발',
    due: { kind: 'datetime', at: '2026-08-10T10:00:00+09:00' },
    reminderAt: '2026-08-10T09:30:00+09:00',
  });
  const errors = [];
  const scheduler = createAssistantScheduler(db, {
    now: () => clock.now,
    onError: error => errors.push(error.message),
    beforeFire: () => { throw new Error('회차 생성 실패'); },
  });

  clock.now = epoch('2026-08-10T09:30:00+09:00');
  const result = scheduler.tick();
  assert.deepEqual(errors, ['회차 생성 실패']);
  assert.equal(result.maintenance, null);
  assert.equal(result.firedIds.length, 1);
});

test('반복이 꺼져 있으면 tick 응답 모양이 예전 그대로다', () => {
  const { db, clock } = createContext();
  const scheduler = createAssistantScheduler(db, { now: () => clock.now });
  assert.deepEqual(scheduler.tick(), {
    capturedAt: clock.now,
    firedIds: [],
    skipped: false,
  });
});

// --- C2e: 시온 자연어 후보 ---

const { createSchedulePrepareSession } = require('../lib/assistant-schedule-tools');
const { buildActiveScheduleContext } = require('../lib/assistant-schedule-notes');

function session(ctx, overrides = {}) {
  return createSchedulePrepareSession(ctx.taskStore, {
    capturedAt: ctx.clock.now,
    clientRequestId: 'chat-task:c2e',
    seriesStore: ctx.seriesStore,
    ...overrides,
  });
}

test('반복 생성 후보는 저장하지 않는다', () => {
  const ctx = createContext();
  const s = session(ctx);
  const result = s.execute('schedule_prepare', {
    title: '아침 운동',
    recurrence: { freq: 'weekly', byWeekday: [1, 3], startDate: '2026-08-10', timeKind: 'datetime', timeOfDay: '07:00:00' },
  });

  assert.equal(JSON.parse(result.content).persisted, false);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS c FROM assistant_task_series').get().c, 0);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS c FROM assistant_tasks').get().c, 0);

  const candidate = s.getCandidate();
  assert.equal(candidate.kind, 'series');
  assert.deepEqual(candidate.series.recurrence.byWeekday, [1, 3]);
  // 후보가 생기면 이 답변에서 도구가 닫힌다.
  assert.deepEqual(s.getToolDefinitions(), []);
});

test('due와 recurrence를 함께 보내거나 둘 다 빠뜨리면 되묻게 만든다', () => {
  const ctx = createContext();
  const both = session(ctx).execute('schedule_prepare', {
    title: '운동',
    due: { kind: 'date', date: '2026-08-11' },
    recurrence: { freq: 'daily', startDate: '2026-08-10', timeKind: 'date' },
  });
  assert.equal(both.isError, true);

  const s = session(ctx);
  const neither = s.execute('schedule_prepare', { title: '운동' });
  assert.equal(neither.isError, true);
  // 기한 없는 일정이 조용히 만들어지지 않는다.
  assert.equal(s.getCandidate(), null);
});

test('화면 없는 단축어에는 반복도 override도 열지 않는다', () => {
  const ctx = createContext();
  const s = session(ctx, { persistImmediately: true });
  const names = s.getToolDefinitions().map(tool => tool.name);
  assert.deepEqual(names, ['schedule_prepare']);
  assert.equal('recurrence' in s.getToolDefinitions()[0].input_schema.properties, false);
  assert.deepEqual(s.getToolDefinitions()[0].input_schema.required, ['title', 'due']);
  assert.equal(s.execute('schedule_override_prepare', { action: 'end', seriesId: 1 }).isError, true);
});

test('반복이 꺼져 있으면 override 도구가 아예 없다', () => {
  const ctx = createContext();
  const s = createSchedulePrepareSession(ctx.taskStore, {
    capturedAt: ctx.clock.now,
    clientRequestId: 'chat-task:c2e-off',
  });
  assert.deepEqual(s.getToolDefinitions().map(tool => tool.name), ['schedule_prepare']);
  assert.doesNotMatch(s.systemPrompt, /schedule_override_prepare/);
});

test('회차 건너뛰기 후보는 대상을 확인하고도 저장하지 않는다', () => {
  const ctx = createContext();
  const { series } = ctx.seriesStore.create(seriesInput());
  const target = ctx.seriesStore.listOccurrences(series.id)
    .find(item => item.occurrenceDate === '2026-08-12');

  const s = session(ctx);
  const result = s.execute('schedule_override_prepare', { action: 'skip', taskId: target.id });
  const body = JSON.parse(result.content);
  assert.equal(body.persisted, false);
  assert.equal(body.override.action, 'skip');
  assert.equal(body.override.occurrenceDate, '2026-08-12');
  assert.equal(body.override.recurrenceLabel, '매주 월·수·금 19:30');
  // 후보만 만들었을 뿐 회차는 그대로 살아 있다.
  assert.equal(ctx.taskStore.get(target.id).task.status, 'active');
});

test('회차 시각 옮기기 후보는 시리즈의 시각 종류를 지킨다', () => {
  const ctx = createContext();
  const { series } = ctx.seriesStore.create(seriesInput());
  const target = ctx.seriesStore.listOccurrences(series.id)
    .find(item => item.occurrenceDate === '2026-08-12');

  const ok = session(ctx).execute('schedule_override_prepare', {
    action: 'reschedule',
    taskId: target.id,
    due: { kind: 'datetime', at: '2026-08-12T21:00:00+09:00' },
  });
  assert.equal(JSON.parse(ok.content).override.due.at, '2026-08-12T21:00:00+09:00');

  // 시각이 있는 반복에 날짜만 주면 막힌다.
  assert.throws(
    () => session(ctx).execute('schedule_override_prepare', {
      action: 'reschedule', taskId: target.id, due: { kind: 'date', date: '2026-08-13' },
    }),
    error => error instanceof AssistantTaskError && error.code === 'OVERRIDE_DUE_KIND_MISMATCH'
  );
});

test('반복이 아닌 일정과 없는 회차는 후보가 되지 않는다', () => {
  const ctx = createContext();
  const single = ctx.taskStore.create({
    clientRequestId: 'single-task-c2e',
    title: '단발',
    due: { kind: 'date', date: '2026-08-11' },
  });

  assert.throws(
    () => session(ctx).execute('schedule_override_prepare', { action: 'skip', taskId: single.task.id }),
    error => error instanceof AssistantTaskError && error.code === 'NOT_AN_OCCURRENCE'
  );
  assert.throws(
    () => session(ctx).execute('schedule_override_prepare', { action: 'skip', taskId: 9999 }),
    error => error instanceof AssistantTaskError && error.code === 'TASK_NOT_FOUND'
  );
  assert.throws(
    () => session(ctx).execute('schedule_override_prepare', { action: 'end', seriesId: 9999 }),
    error => error instanceof AssistantTaskError && error.code === 'SERIES_NOT_FOUND'
  );
});

test('이미 종결된 회차와 종료된 반복은 후보가 되지 않는다', () => {
  const ctx = createContext();
  const { series } = ctx.seriesStore.create(seriesInput());
  const target = ctx.seriesStore.listOccurrences(series.id)
    .find(item => item.occurrenceDate === '2026-08-12');
  ctx.taskStore.transition(target.id, 'complete', { expectedVersion: 1 });
  assert.throws(
    () => session(ctx).execute('schedule_override_prepare', { action: 'skip', taskId: target.id }),
    error => error instanceof AssistantTaskError && error.code === 'OCCURRENCE_NOT_ACTIVE'
  );

  ctx.seriesStore.end(series.id, { expectedVersion: 1 });
  assert.throws(
    () => session(ctx).execute('schedule_override_prepare', { action: 'end', seriesId: series.id }),
    error => error instanceof AssistantTaskError && error.code === 'SERIES_NOT_EDITABLE'
  );
});

test('이후 전체 변경 후보는 지금 규칙과 바뀔 규칙을 함께 보여준다', () => {
  const ctx = createContext();
  const { series } = ctx.seriesStore.create(seriesInput());
  const result = session(ctx).execute('schedule_override_prepare', {
    action: 'series_update',
    seriesId: series.id,
    recurrence: { timeOfDay: '08:00:00' },
  });
  const body = JSON.parse(result.content);
  assert.equal(body.override.recurrenceLabel, '매주 월·수·금 19:30');
  assert.equal(body.override.nextRecurrenceLabel, '매주 월·수·금 08:00');
  assert.equal(body.override.expectedVersion, 1);
  // 후보일 뿐이라 시리즈는 아직 그대로다.
  assert.equal(ctx.seriesStore.get(series.id).series.timeOfDay, '19:30:00');
});

test('한 답변에서 후보는 하나뿐이다', () => {
  const ctx = createContext();
  const { series } = ctx.seriesStore.create(seriesInput());
  const s = session(ctx);
  s.execute('schedule_override_prepare', { action: 'end', seriesId: series.id });
  const second = s.execute('schedule_prepare', {
    title: '다른 일정', due: { kind: 'date', date: '2026-08-20' },
  });
  assert.equal(second.isError, true);
  assert.deepEqual(s.getToolDefinitions(), []);
});

// 대상을 제목 문자열로 고르면 같은 제목이 둘일 때 조용히 틀린다.
test('컨텍스트가 회차와 시리즈 식별자를 준다', () => {
  const ctx = createContext();
  ctx.seriesStore.create(seriesInput());
  ctx.taskStore.create({
    clientRequestId: 'single-task-ctx',
    title: '단발',
    due: { kind: 'date', date: '2026-08-11' },
  });
  const snapshot = ctx.taskStore.list({ view: 'all' });
  const context = buildActiveScheduleContext({ capturedAt: ctx.clock.now, tasks: snapshot.tasks });

  const occurrence = snapshot.tasks.find(task => task.seriesId !== null);
  const single = snapshot.tasks.find(task => task.seriesId === null);
  assert.match(context, new RegExp(`\\[#${occurrence.id}\\] \\[반복 #${occurrence.seriesId} 매주 월·수·금 19:30, 다음 회차 26개\\] 운동`));
  assert.match(context, new RegExp(`\\[#${single.id}\\] 단발`));
  assert.doesNotMatch(context, new RegExp(`\\[#${single.id}\\] \\[반복`));
});

// --- C2f: 컨텍스트 접기와 월별 노트 압축 ---

const { buildScheduleHistoryNote } = require('../lib/assistant-schedule-notes');

test('컨텍스트는 반복을 회차 하나로 접고 남은 개수를 적는다', () => {
  const ctx = createContext();
  ctx.seriesStore.create(seriesInput({}, { freq: 'daily', byWeekday: undefined }));
  const snapshot = ctx.taskStore.list({ view: 'all', limit: 20 });
  const context = buildActiveScheduleContext(snapshot);

  // 매일 반복 61회차가 한 줄이다.
  assert.equal(context.split('\n').filter(line => line.startsWith('- ')).length, 1);
  assert.match(context, /활성 일정: 1개/);
  assert.match(context, /\[반복 #1 매일 19:30, 다음 회차 60개\]/);
  assert.match(context, /반복 일정은 가장 이른 회차 하나만 실린다/);
  assert.ok(context.length < 6000);
});

test('월별 노트는 같은 시리즈의 회차를 한 항목으로 묶는다', () => {
  const ctx = createContext();
  const { series } = ctx.seriesStore.create(seriesInput());
  const closed = [];
  for (const date of ['2026-08-10', '2026-08-12', '2026-08-14', '2026-08-17']) {
    const item = ctx.seriesStore.listOccurrences(series.id).find(row => row.occurrenceDate === date);
    ctx.taskStore.transition(item.id, 'complete', { expectedVersion: 1 });
    closed.push(ctx.taskStore.get(item.id).task);
  }
  const single = ctx.taskStore.create({
    clientRequestId: 'single-task-c2f',
    title: '치과',
    due: { kind: 'date', date: '2026-08-13' },
  });
  ctx.taskStore.transition(single.task.id, 'complete', { expectedVersion: 1 });

  const note = buildScheduleHistoryNote({
    monthKey: '2026-08',
    tasks: [...closed, ctx.taskStore.get(single.task.id).task],
    updatedAt: ctx.clock.now,
  });

  // 회차 넷이 한 줄, 단발은 그대로 자기 줄이다.
  assert.match(note, /- \*\*반복 4회 · 19:30\*\* · 운동/);
  assert.match(note, /- 날짜: 10·12·14·17일/);
  assert.match(note, /- \*\*2026-08-13\*\* · 치과/);
  assert.equal(note.split('\n').filter(line => line.startsWith('- **')).length, 2);
});

test('회차만 따로 고친 제목은 묶이지 않는다', () => {
  const ctx = createContext();
  const { series } = ctx.seriesStore.create(seriesInput());
  const rows = ctx.seriesStore.listOccurrences(series.id);
  const renamed = rows.find(row => row.occurrenceDate === '2026-08-12');
  ctx.taskStore.update(renamed.id, { expectedVersion: 1, title: '운동 (헬스장)' });

  const closed = [];
  for (const date of ['2026-08-10', '2026-08-12', '2026-08-14']) {
    const item = ctx.seriesStore.listOccurrences(series.id).find(row => row.occurrenceDate === date);
    const current = ctx.taskStore.get(item.id).task;
    ctx.taskStore.transition(item.id, 'complete', { expectedVersion: current.version });
    closed.push(ctx.taskStore.get(item.id).task);
  }
  const note = buildScheduleHistoryNote({ monthKey: '2026-08', tasks: closed, updatedAt: ctx.clock.now });

  assert.match(note, /- \*\*반복 2회 · 19:30\*\* · 운동\n {2}- 날짜: 10·14일/);
  assert.match(note, /- \*\*반복 1회 · 19:30\*\* · 운동 \(헬스장\)/);
});

test('묶은 노트를 다시 만들어도 같은 글이 나온다', () => {
  const ctx = createContext();
  const { series } = ctx.seriesStore.create(seriesInput());
  const closed = [];
  for (const date of ['2026-08-14', '2026-08-10', '2026-08-12']) {
    const item = ctx.seriesStore.listOccurrences(series.id).find(row => row.occurrenceDate === date);
    ctx.taskStore.transition(item.id, 'complete', { expectedVersion: 1 });
    closed.push(ctx.taskStore.get(item.id).task);
  }
  const build = tasks => buildScheduleHistoryNote({ monthKey: '2026-08', tasks, updatedAt: ctx.clock.now });
  // 들어오는 순서가 달라도 결과가 같아야 재생성이 안전하다.
  assert.equal(build(closed), build([...closed].reverse()));
  assert.match(build(closed), /- 날짜: 10·12·14일/);
});

test('취소된 회차는 취소 구역에서 따로 묶인다', () => {
  const ctx = createContext();
  const { series } = ctx.seriesStore.create(seriesInput());
  const tasks = [];
  for (const [date, action] of [['2026-08-10', 'complete'], ['2026-08-12', 'cancel'], ['2026-08-14', 'cancel']]) {
    const item = ctx.seriesStore.listOccurrences(series.id).find(row => row.occurrenceDate === date);
    ctx.taskStore.transition(item.id, action, { expectedVersion: 1 });
    tasks.push(ctx.taskStore.get(item.id).task);
  }
  const note = buildScheduleHistoryNote({ monthKey: '2026-08', tasks, updatedAt: ctx.clock.now });
  const completed = note.split('## 취소')[0];
  const cancelled = note.split('## 취소')[1];
  assert.match(completed, /- \*\*반복 1회 · 19:30\*\* · 운동/);
  assert.match(cancelled, /- \*\*반복 2회 · 19:30\*\* · 운동\n {2}- 날짜: 12·14일/);
});

test('오래전에 시작한 반복도 시온이 만든 후보로 바꿀 수 있다', () => {
  const ctx = createContext();
  const { series } = ctx.seriesStore.create(seriesInput());
  // 시리즈가 한 달 동안 돌아서 시작일이 과거로 내려갔다.
  ctx.clock.now += 30 * 24 * 60 * 60;

  const prepared = ctx.seriesStore.prepareOverride({
    action: 'series_update',
    seriesId: series.id,
    recurrence: { timeOfDay: '08:00:00' },
  }, { capturedAt: ctx.clock.now });

  // 카드가 그대로 보내는 payload가 적용돼야 한다.
  const applied = ctx.seriesStore.update(series.id, {
    expectedVersion: prepared.override.expectedVersion,
    recurrence: prepared.override.recurrence,
  });
  assert.equal(applied.series.timeOfDay, '08:00:00');
  assert.equal(applied.series.startDate, '2026-08-10');
});

test('시작일을 실제로 과거로 옮기는 것은 여전히 막는다', () => {
  const ctx = createContext();
  const { series } = ctx.seriesStore.create(seriesInput());
  ctx.clock.now += 30 * 24 * 60 * 60;
  assert.throws(
    () => ctx.seriesStore.update(series.id, {
      expectedVersion: 1,
      recurrence: { startDate: '2026-08-01' },
    }),
    error => error instanceof AssistantTaskError && error.code === 'RECURRENCE_START_IN_PAST'
  );
});

test('뒤로 옮긴 회차가 있으면 그것이 남는 놓친 회차다', () => {
  const ctx = createContext();
  const { series } = ctx.seriesStore.create(seriesInput({}, {
    freq: 'daily', byWeekday: undefined,
  }));
  const rows = ctx.seriesStore.listOccurrences(series.id);
  const moved = rows.find(row => row.occurrenceDate === '2026-08-11');
  // 11일 회차만 13일 저녁으로 옮긴다. 회차 날짜는 여전히 11일이다.
  ctx.taskStore.update(moved.id, {
    expectedVersion: 1,
    due: { kind: 'datetime', at: '2026-08-13T22:00:00+09:00' },
  });

  ctx.clock.now = epoch('2026-08-14T09:00:00+09:00');
  ctx.seriesStore.sweepMissed();

  const after = ctx.seriesStore.listOccurrences(series.id)
    .filter(item => item.occurrenceDate <= '2026-08-13' && item.status === 'active');
  assert.deepEqual(after.map(item => item.occurrenceDate), ['2026-08-11']);
  assert.equal(ctx.taskStore.get(moved.id).task.status, 'active');
});
