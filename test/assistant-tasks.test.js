'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const { createAssistantScheduler } = require('../lib/assistant-scheduler');
const { AssistantTaskError, createAssistantTaskStore } = require('../lib/assistant-tasks');

function epoch(value) {
  return Math.floor(Date.parse(value) / 1000);
}

function createDatabase(filename = ':memory:') {
  const db = new Database(filename);
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
  return db;
}

function taskInput(overrides = {}) {
  return {
    clientRequestId: 'web-create-0001',
    title: ' 보고서 초안 ',
    detail: ' 1차 목차까지 ',
    due: { kind: 'datetime', at: '2026-07-20T18:00:00+09:00' },
    reminderAt: '2026-07-20T17:00:00+09:00',
    ...overrides,
  };
}

function assertTaskError(fn, code, statusCode = 400) {
  assert.throws(fn, error => (
    error instanceof AssistantTaskError && error.code === code && error.statusCode === statusCode
  ));
}

test('task create is transactional and retries by canonical payload after later edits', () => {
  const db = createDatabase();
  let now = epoch('2026-07-19T03:00:00Z');
  const store = createAssistantTaskStore(db, { now: () => now });

  const created = store.create(taskInput());
  assert.equal(created.replayed, false);
  assert.deepEqual(
    {
      title: created.task.title,
      detail: created.task.detail,
      status: created.task.status,
      lifecycle: created.task.lifecycle,
      dueKind: created.task.dueKind,
      dueAt: created.task.dueAt,
      version: created.task.version,
      reminderVersion: created.task.reminderVersion,
    },
    {
      title: '보고서 초안',
      detail: '1차 목차까지',
      status: 'active',
      lifecycle: 'active',
      dueKind: 'datetime',
      dueAt: epoch('2026-07-20T09:00:00Z'),
      version: 1,
      reminderVersion: 1,
    },
  );
  assert.equal(created.reminder.remindAt, epoch('2026-07-20T08:00:00Z'));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assistant_task_events').get().count, 1);

  const updated = store.update(created.task.id, {
    expectedVersion: 1,
    title: '보고서 최종 초안',
    reminderChange: { action: 'keep' },
  });
  assert.equal(updated.task.version, 2);
  assert.equal(updated.reminder.id, created.reminder.id);

  now = epoch('2026-07-21T03:00:00Z');
  const replayed = store.create(taskInput());
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.task.id, created.task.id);
  assert.equal(replayed.task.title, '보고서 최종 초안');
  assert.equal(replayed.task.version, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assistant_tasks').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assistant_reminders').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assistant_task_events').get().count, 2);

  assertTaskError(
    () => store.create(taskInput({ title: '다른 요청' })),
    'TASK_CREATE_CONFLICT',
    409,
  );
  db.close();
});

test('task inputs reject invalid bounds, calendar dates, offsets, and time ranges', () => {
  const db = createDatabase();
  const store = createAssistantTaskStore(db, { now: () => epoch('2026-07-19T03:00:00Z') });

  assertTaskError(() => store.create(taskInput({ clientRequestId: 'short' })), 'INVALID_REQUEST_KEY');
  assertTaskError(() => store.create(taskInput({ title: 'x'.repeat(201) })), 'INVALID_TASK_INPUT');
  assertTaskError(
    () => store.create(taskInput({ due: { kind: 'date', date: '2026-02-30' } })),
    'INVALID_DUE_DATE',
  );
  assertTaskError(
    () => store.create(taskInput({ due: { kind: 'datetime', at: '2026-07-20T18:00:00+00:00' } })),
    'INVALID_DATETIME',
  );
  assertTaskError(
    () => store.create(taskInput({ due: { kind: 'date', date: '2026-07-18' } })),
    'DUE_IN_PAST',
  );
  assertTaskError(
    () => store.create(taskInput({ reminderAt: '2026-07-19T12:00:59+09:00' })),
    'REMINDER_TOO_SOON',
  );
  assertTaskError(
    () => store.create(taskInput({ due: { kind: 'date', date: '2036-07-20' } })),
    'DUE_TOO_FAR',
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assistant_tasks').get().count, 0);
  db.close();
});

test('updates preserve reminder on keep and replace or remove it transactionally', () => {
  const db = createDatabase();
  let now = epoch('2026-07-19T03:00:00Z');
  const store = createAssistantTaskStore(db, { now: () => now });
  const created = store.create(taskInput());

  const kept = store.update(created.task.id, {
    expectedVersion: 1,
    due: { kind: 'date', date: '2026-07-21' },
    reminderChange: { action: 'keep' },
  });
  assert.equal(kept.task.reminderVersion, 1);
  assert.equal(kept.reminder.id, created.reminder.id);
  assert.equal(kept.reminder.remindAt, created.reminder.remindAt);

  now += 60;
  const replaced = store.update(created.task.id, {
    expectedVersion: 2,
    reminderChange: { action: 'replace', at: '2026-07-21T09:00:00+09:00' },
  });
  assert.equal(replaced.task.reminderVersion, 2);
  assert.notEqual(replaced.reminder.id, created.reminder.id);
  assert.deepEqual(
    db.prepare(`
      SELECT status, cancellation_reason AS reason
      FROM assistant_reminders WHERE id = ?
    `).get(created.reminder.id),
    { status: 'cancelled', reason: 'replaced' },
  );

  const removed = store.update(created.task.id, {
    expectedVersion: 3,
    reminderChange: { action: 'remove' },
  });
  assert.equal(removed.task.reminderVersion, 3);
  assert.equal(removed.reminder, null);
  const noOp = store.update(created.task.id, {
    expectedVersion: 4,
    reminderChange: { action: 'remove' },
  });
  assert.equal(noOp.unchanged, true);
  assert.equal(noOp.task.version, 4);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assistant_task_events').get().count, 4);
  db.close();
});

test('optimistic transitions preserve closed history, trash, restore, and idempotent retries', () => {
  const db = createDatabase();
  let now = epoch('2026-07-19T03:00:00Z');
  const store = createAssistantTaskStore(db, { now: () => now });
  const created = store.create(taskInput({ due: { kind: 'none' }, reminderAt: null }));

  assertTaskError(
    () => store.update(created.task.id, { expectedVersion: 2, title: '충돌' }),
    'TASK_VERSION_CONFLICT',
    409,
  );
  now += 10;
  const completed = store.transition(created.task.id, 'complete', { expectedVersion: 1 });
  assert.equal(completed.task.status, 'done');
  assert.equal(completed.task.lifecycle, 'closed');
  assert.equal(completed.task.version, 2);
  assert.equal(store.list({ view: 'history' }).tasks.length, 1);
  assert.equal(store.list({ view: 'all' }).tasks.length, 0);

  const completeRetry = store.transition(created.task.id, 'complete', { expectedVersion: 1 });
  assert.equal(completeRetry.unchanged, true);
  assert.equal(completeRetry.task.version, 2);

  now += 10;
  const deleted = store.transition(created.task.id, 'delete', { expectedVersion: 2 });
  assert.equal(deleted.task.lifecycle, 'deleted');
  assert.equal(deleted.task.deletedFromLifecycle, 'closed');
  assert.equal(store.list({ view: 'history' }).tasks.length, 0);
  assert.equal(store.list({ view: 'trash' }).tasks.length, 1);

  now += 10;
  const restored = store.transition(created.task.id, 'restore', { expectedVersion: 3 });
  assert.equal(restored.task.lifecycle, 'closed');
  assert.equal(restored.task.status, 'done');
  assert.equal(restored.reminder, null);

  now += 10;
  const reopened = store.transition(created.task.id, 'reopen', { expectedVersion: 4 });
  assert.equal(reopened.task.lifecycle, 'active');
  assert.equal(reopened.task.status, 'active');
  assert.equal(reopened.task.completedAt, null);
  assert.equal(reopened.reminder, null);
  assertTaskError(
    () => store.transition(created.task.id, 'cancel', { expectedVersion: 4 }),
    'TASK_VERSION_CONFLICT',
    409,
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assistant_task_events').get().count, 5);
  db.close();
});

test('complete and cancel clean live reminders without restoring them on reopen', () => {
  const db = createDatabase();
  let now = epoch('2026-07-19T03:00:00Z');
  const store = createAssistantTaskStore(db, { now: () => now });
  const pendingTask = store.create(taskInput({ clientRequestId: 'web-create-pending' }));
  const firedTask = store.create(taskInput({ clientRequestId: 'web-create-fired1' }));
  db.prepare(`
    UPDATE assistant_reminders
    SET status = 'fired', fired_at = ?, updated_at = ?
    WHERE id = ?
  `).run(now, now, firedTask.reminder.id);

  now += 10;
  store.transition(pendingTask.task.id, 'cancel', { expectedVersion: 1 });
  store.transition(firedTask.task.id, 'complete', { expectedVersion: 1 });
  assert.deepEqual(
    db.prepare(`
      SELECT status, cancellation_reason AS reason
      FROM assistant_reminders WHERE id = ?
    `).get(pendingTask.reminder.id),
    { status: 'cancelled', reason: 'task_cancelled' },
  );
  assert.deepEqual(
    db.prepare(`
      SELECT status, acknowledgement_action AS action
      FROM assistant_reminders WHERE id = ?
    `).get(firedTask.reminder.id),
    { status: 'acknowledged', action: 'completed' },
  );
  db.close();
});

test('reminder acknowledge and snooze are idempotent and require a fired active reminder', () => {
  const db = createDatabase();
  let now = epoch('2026-07-19T03:00:00Z');
  const store = createAssistantTaskStore(db, { now: () => now });
  const first = store.create(taskInput({ clientRequestId: 'web-reminder-ack1' }));
  const second = store.create(taskInput({ clientRequestId: 'web-reminder-snz1' }));
  assertTaskError(() => store.acknowledgeReminder(first.reminder.id), 'REMINDER_NOT_ACKNOWLEDGEABLE', 409);

  db.prepare(`
    UPDATE assistant_reminders
    SET status = 'fired', fired_at = ?, updated_at = ?
    WHERE id IN (?, ?)
  `).run(now, now, first.reminder.id, second.reminder.id);
  const acknowledged = store.acknowledgeReminder(first.reminder.id);
  assert.equal(acknowledged.reminder.acknowledgementAction, 'seen');
  assert.equal(store.acknowledgeReminder(first.reminder.id).unchanged, true);

  now += 30;
  const snoozed = store.snoozeReminder(second.reminder.id, {
    requestKey: 'web-snooze-0001',
    minutes: 60,
  });
  assert.equal(snoozed.replayed, false);
  assert.equal(snoozed.reminder.snoozedFromId, second.reminder.id);
  assert.equal(snoozed.reminder.remindAt, now + 3600);
  const replayed = store.snoozeReminder(second.reminder.id, {
    requestKey: 'web-snooze-0001',
    minutes: 60,
  });
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.reminder.id, snoozed.reminder.id);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM assistant_reminders WHERE snoozed_from_id = ?').get(second.reminder.id).count,
    1,
  );
  assertTaskError(
    () => store.snoozeReminder(second.reminder.id, { requestKey: 'web-snooze-0002', minutes: 60 }),
    'REMINDER_NOT_SNOOZABLE',
    409,
  );
  db.close();
});

test('KST list buckets and weekly summary use one captured clock', () => {
  const db = createDatabase();
  let now = epoch('2026-07-19T00:00:00+09:00');
  const store = createAssistantTaskStore(db, { now: () => now });
  store.create(taskInput({
    clientRequestId: 'web-bucket-old01', title: '곧 지연', detail: '',
    due: { kind: 'date', date: '2026-07-19' }, reminderAt: null,
  }));
  store.create(taskInput({
    clientRequestId: 'web-bucket-today', title: '오늘 날짜', detail: '',
    due: { kind: 'date', date: '2026-07-20' }, reminderAt: null,
  }));
  store.create(taskInput({
    clientRequestId: 'web-bucket-time1', title: '오늘 시각', detail: '',
    due: { kind: 'datetime', at: '2026-07-20T18:00:00+09:00' },
    reminderAt: '2026-07-20T17:00:00+09:00',
  }));
  store.create(taskInput({
    clientRequestId: 'web-bucket-next1', title: '예정', detail: '',
    due: { kind: 'date', date: '2026-07-21' }, reminderAt: null,
  }));
  store.create(taskInput({
    clientRequestId: 'web-bucket-inbox', title: '인박스', detail: '',
    due: { kind: 'none' }, reminderAt: null,
  }));

  now = epoch('2026-07-20T12:00:00+09:00');
  const today = store.list({ view: 'today' });
  assert.deepEqual(today.overdue.map(task => task.title), ['곧 지연']);
  assert.deepEqual(today.today.map(task => task.title), ['오늘 날짜', '오늘 시각']);
  assert.deepEqual(store.list({ view: 'upcoming' }).tasks.map(task => task.title), ['예정']);
  assert.deepEqual(store.list({ view: 'inbox' }).tasks.map(task => task.title), ['인박스']);

  const summary = store.summary();
  assert.equal(summary.capturedAt, now);
  assert.deepEqual(summary.counts, { overdue: 1, today: 2, upcoming: 1, inbox: 1 });
  assert.equal(summary.week.length, 7);
  assert.equal(summary.week[0].date, '2026-07-20');
  assert.equal(summary.week[0].count, 2);
  assert.equal(summary.week[0].isToday, true);
  assert.equal(summary.currentWeekStart, '2026-07-20');
  assert.equal(summary.calendarCenter, '2026-07-20');
  assert.deepEqual(summary.calendar.map(week => week.startDate), [
    '2026-07-13', '2026-07-20', '2026-07-27',
  ]);
  assert.ok(summary.calendar.every(week => week.days.length === 7));
  assert.deepEqual(summary.preview.map(item => item.title), ['곧 지연', '오늘 시각', '오늘 날짜']);
  assert.equal(summary.nextReminder.title, '오늘 시각');

  const later = store.summary({ calendarCenter: '2026-07-27' });
  assert.equal(later.calendarCenter, '2026-07-27');
  assert.deepEqual(later.calendar.map(week => week.startDate), [
    '2026-07-20', '2026-07-27', '2026-08-03',
  ]);
  assert.ok(later.week.every(day => day.isToday === false));
  assert.throws(
    () => store.summary({ calendarCenter: '2026-07-26' }),
    error => error.code === 'INVALID_CALENDAR_WEEK',
  );
  db.close();
});

test('scheduler catches up after reopen and repeated instances keep one stable fired receipt', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'assistant-scheduler-'));
  const dbPath = path.join(root, 'galpi.db');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const now = epoch('2026-07-19T03:00:00Z');
  let db = createDatabase(dbPath);
  const store = createAssistantTaskStore(db, { now: () => now });
  const created = store.create(taskInput());
  db.prepare('UPDATE assistant_reminders SET remind_at = ? WHERE id = ?').run(now - 30, created.reminder.id);
  db.close();

  db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  const first = createAssistantScheduler(db, { now: () => now });
  const second = createAssistantScheduler(db, { now: () => now + 10 });
  assert.deepEqual(first.tick(), { capturedAt: now, firedIds: [created.reminder.id], skipped: false });
  const firedAt = db.prepare('SELECT fired_at AS firedAt FROM assistant_reminders WHERE id = ?')
    .get(created.reminder.id).firedAt;
  assert.deepEqual(second.tick(), { capturedAt: now + 10, firedIds: [], skipped: false });
  assert.equal(
    db.prepare('SELECT fired_at AS firedAt FROM assistant_reminders WHERE id = ?').get(created.reminder.id).firedAt,
    firedAt,
  );

  const reopenedStore = createAssistantTaskStore(db, { now: () => now + 10 });
  const before = db.prepare('SELECT status, fired_at AS firedAt FROM assistant_reminders WHERE id = ?')
    .get(created.reminder.id);
  const notifications = reopenedStore.listFiredNotifications();
  const after = db.prepare('SELECT status, fired_at AS firedAt FROM assistant_reminders WHERE id = ?')
    .get(created.reminder.id);
  assert.deepEqual(after, before);
  assert.deepEqual(notifications, [{
    id: `task-reminder:${created.reminder.id}`,
    source: 'task',
    type: 'task_reminder',
    reminderId: created.reminder.id,
    taskId: created.task.id,
    taskVersion: 1,
    title: '보고서 초안',
    remindAt: now - 30,
    firedAt,
  }]);
  db.close();
});

test('scheduler runs every 30 seconds and keeps a reminder pending until its exact target time', t => {
  const db = createDatabase();
  const now = epoch('2026-07-19T03:00:00Z');
  const reminderAt = now + 30;
  let scheduledInterval = null;
  t.mock.method(global, 'setInterval', (_callback, intervalMs) => {
    scheduledInterval = intervalMs;
    return { unref() {} };
  });
  t.mock.method(global, 'clearInterval', () => {});
  const store = createAssistantTaskStore(db, { now: () => now });
  const created = store.create(taskInput());
  db.prepare('UPDATE assistant_reminders SET remind_at = ? WHERE id = ?')
    .run(reminderAt, created.reminder.id);
  const scheduler = createAssistantScheduler(db, { now: () => now });

  assert.equal(scheduler.start(), true);
  assert.equal(scheduledInterval, 30_000);
  assert.equal(scheduler.stop(), true);

  assert.deepEqual(scheduler.tick(reminderAt - 1), {
    capturedAt: reminderAt - 1,
    firedIds: [],
    skipped: false,
  });
  assert.deepEqual(scheduler.tick(reminderAt), {
    capturedAt: reminderAt,
    firedIds: [created.reminder.id],
    skipped: false,
  });
  assert.deepEqual(
    db.prepare('SELECT status, fired_at AS firedAt FROM assistant_reminders WHERE id = ?')
      .get(created.reminder.id),
    { status: 'fired', firedAt: reminderAt },
  );
  db.close();
});

test('scheduler rolls back the whole due batch when one fire update fails', () => {
  const db = createDatabase();
  const now = epoch('2026-07-19T03:00:00Z');
  const store = createAssistantTaskStore(db, { now: () => now });
  const first = store.create(taskInput({ clientRequestId: 'web-scheduler-one1' }));
  const second = store.create(taskInput({ clientRequestId: 'web-scheduler-two2' }));
  db.prepare('UPDATE assistant_reminders SET remind_at = ? WHERE id IN (?, ?)')
    .run(now - 30, first.reminder.id, second.reminder.id);
  db.exec(`
    CREATE TRIGGER fail_second_scheduler_fire
    BEFORE UPDATE OF status ON assistant_reminders
    WHEN OLD.id = ${second.reminder.id} AND NEW.status = 'fired'
    BEGIN
      SELECT RAISE(ABORT, 'forced scheduler failure');
    END;
  `);
  const scheduler = createAssistantScheduler(db, { now: () => now });
  assert.throws(() => scheduler.tick(), /forced scheduler failure/);
  assert.deepEqual(
    db.prepare('SELECT status, fired_at AS firedAt FROM assistant_reminders ORDER BY id').all(),
    [
      { status: 'pending', firedAt: null },
      { status: 'pending', firedAt: null },
    ],
  );
  db.exec('DROP TRIGGER fail_second_scheduler_fire');
  assert.deepEqual(scheduler.tick().firedIds, [first.reminder.id, second.reminder.id]);
  db.close();
});
