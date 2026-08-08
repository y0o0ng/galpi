'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
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
