'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const { createAssistantScheduler } = require('../lib/assistant-scheduler');
const {
  AssistantPushError,
  createAssistantPushDispatcher,
  createAssistantPushService,
} = require('../lib/assistant-push');
const { createAssistantTaskStore } = require('../lib/assistant-tasks');

function epoch(value) {
  return Math.floor(Date.parse(value) / 1000);
}

function createDatabase() {
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
  return db;
}

function createFiredReminder(db, now, overrides = {}) {
  const store = createAssistantTaskStore(db, { now: () => now });
  const created = store.create({
    clientRequestId: overrides.clientRequestId || 'push-task-0001',
    title: overrides.title || '비공개 일정 제목',
    detail: overrides.detail || '외부 전송 금지 상세',
    due: { kind: 'datetime', at: '2026-07-21T18:00:00+09:00' },
    reminderAt: '2026-07-20T12:00:00+09:00',
  });
  const firedAt = epoch('2026-07-20T03:00:00Z');
  db.prepare(`
    UPDATE assistant_reminders
    SET status = 'fired', fired_at = ?, updated_at = ?
    WHERE id = ?
  `).run(firedAt, firedAt, created.reminder.id);
  return { ...created, firedAt };
}

function subscriptionInput(path = 'device-1') {
  return {
    endpoint: `https://web.push.apple.com/${path}`,
    keys: { p256dh: 'B'.repeat(87), auth: 'C'.repeat(22) },
    deviceLabel: '아이폰 홈 화면',
  };
}

function assertPushError(fn, code, statusCode = 400) {
  assert.throws(fn, error => (
    error instanceof AssistantPushError && error.code === code && error.statusCode === statusCode
  ));
}

test('push subscriptions validate endpoints, redact keys, and revoke idempotently', () => {
  const db = createDatabase();
  const now = epoch('2026-07-20T03:00:00Z');
  const service = createAssistantPushService(db, { enabled: true, now: () => now });

  const created = service.register(subscriptionInput());
  assert.deepEqual(Object.keys(created).sort(), [
    'createdAt', 'deviceLabel', 'id', 'replayed', 'status', 'updatedAt',
  ]);
  assert.equal(created.status, 'active');
  assert.equal(created.replayed, false);
  assert.equal(
    db.prepare('SELECT endpoint FROM assistant_push_subscriptions WHERE id = ?').get(created.id).endpoint,
    subscriptionInput().endpoint,
  );

  const replayed = service.register(subscriptionInput());
  assert.equal(replayed.id, created.id);
  assert.equal(replayed.replayed, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assistant_push_subscriptions').get().count, 1);

  assertPushError(
    () => service.register({ ...subscriptionInput('http'), endpoint: 'http://web.push.apple.com/x' }),
    'PUSH_ENDPOINT_NOT_ALLOWED',
  );
  assertPushError(
    () => service.register({ ...subscriptionInput('ip'), endpoint: 'https://127.0.0.1/x' }),
    'PUSH_ENDPOINT_NOT_ALLOWED',
  );
  assertPushError(
    () => service.register({ ...subscriptionInput('other'), endpoint: 'https://example.com/x' }),
    'PUSH_ENDPOINT_NOT_ALLOWED',
  );
  assertPushError(
    () => service.register({ ...subscriptionInput('space'), endpoint: ' https://web.push.apple.com/x' }),
    'INVALID_PUSH_ENDPOINT',
  );
  assertPushError(
    () => service.register({ ...subscriptionInput('bad-key'), keys: { p256dh: 'bad', auth: 'C'.repeat(22) } }),
    'INVALID_PUSH_KEY',
  );

  const revoked = service.revoke(created.id);
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.unchanged, false);
  assert.equal(service.revoke(created.id).unchanged, true);

  const disabled = createAssistantPushService(db, { enabled: false, now: () => now });
  assertPushError(() => disabled.register(subscriptionInput('disabled')), 'WEB_PUSH_DISABLED', 503);
  db.close();
});

test('fired reminders enqueue once per active subscription without later-device backfill', () => {
  const db = createDatabase();
  const start = epoch('2026-07-19T03:00:00Z');
  const { reminder, firedAt } = createFiredReminder(db, start);
  const service = createAssistantPushService(db, { enabled: true, now: () => firedAt });
  service.register(subscriptionInput('device-a'));
  service.register(subscriptionInput('device-b'));

  assert.equal(service.enqueueReminder(reminder.id, firedAt), 2);
  assert.equal(service.enqueueReminder(reminder.id, firedAt), 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assistant_push_deliveries').get().count, 2);

  service.register(subscriptionInput('device-c'));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assistant_push_deliveries').get().count, 2);
  assert.equal(service.enqueueReminder(reminder.id, firedAt + 24 * 60 * 60), 0);
  db.close();
});

test('dispatcher sends only an opaque reminder reference and records provider acceptance', async () => {
  const db = createDatabase();
  const start = epoch('2026-07-19T03:00:00Z');
  const { reminder, firedAt } = createFiredReminder(db, start);
  let now = firedAt;
  const service = createAssistantPushService(db, { enabled: true, now: () => now });
  service.register(subscriptionInput());
  service.enqueueReminder(reminder.id, firedAt);

  const calls = [];
  const dispatcher = createAssistantPushDispatcher(service, {
    now: () => now,
    transport: {
      async send(subscription, payload, delivery) {
        calls.push({ subscription, payload, delivery });
        return { statusCode: 201 };
      },
    },
  });
  assert.deepEqual(await dispatcher.tick(), { processed: 1, skipped: false });

  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].payload), {
    version: 1,
    type: 'task_reminder',
    reminderId: reminder.id,
    url: '/?panel=agents&taskView=reminders',
  });
  assert.equal(calls[0].payload.includes('비공개 일정 제목'), false);
  assert.equal(calls[0].payload.includes('외부 전송 금지 상세'), false);
  assert.equal(calls[0].delivery.urgency, 'high');
  assert.equal(
    db.prepare('SELECT status FROM assistant_push_deliveries').get().status,
    'accepted',
  );
  assert.equal(
    db.prepare('SELECT status FROM assistant_reminders WHERE id = ?').get(reminder.id).status,
    'fired',
  );
  db.close();
});

test('dispatcher retries throttling and expires gone subscriptions', async () => {
  const db = createDatabase();
  const start = epoch('2026-07-19T03:00:00Z');
  const first = createFiredReminder(db, start);
  const second = createFiredReminder(db, start, {
    clientRequestId: 'push-task-0002',
    title: '두 번째 일정',
  });
  let now = first.firedAt;
  const service = createAssistantPushService(db, { enabled: true, now: () => now });
  service.register(subscriptionInput());
  service.enqueueReminder(first.reminder.id, now);
  service.enqueueReminder(second.reminder.id, now);

  let response = 'throttled';
  const dispatcher = createAssistantPushDispatcher(service, {
    now: () => now,
    batchSize: 1,
    random: () => 0,
    transport: {
      async send() {
        if (response === 'throttled') {
          const error = new Error('rate limited');
          error.statusCode = 429;
          error.headers = { 'retry-after': '120' };
          throw error;
        }
        const error = new Error('gone');
        error.statusCode = 410;
        throw error;
      },
    },
  });

  await dispatcher.tick();
  const retry = db.prepare(`
    SELECT status, attempt_count AS attemptCount, next_attempt_at AS nextAttemptAt
    FROM assistant_push_deliveries
    WHERE reminder_id = ?
  `).get(first.reminder.id);
  assert.deepEqual(retry, { status: 'retry', attemptCount: 1, nextAttemptAt: now + 120 });

  response = 'gone';
  await dispatcher.tick();
  assert.equal(
    db.prepare('SELECT status FROM assistant_push_deliveries WHERE reminder_id = ?').get(second.reminder.id).status,
    'expired',
  );
  assert.equal(db.prepare('SELECT status FROM assistant_push_subscriptions').get().status, 'expired');
  assert.equal(
    db.prepare('SELECT status FROM assistant_push_deliveries WHERE reminder_id = ?').get(first.reminder.id).status,
    'expired',
  );
  db.close();
});

test('dispatcher records permanent provider errors without retrying', async () => {
  const db = createDatabase();
  const start = epoch('2026-07-19T03:00:00Z');
  const { reminder, firedAt } = createFiredReminder(db, start);
  const service = createAssistantPushService(db, { enabled: true, now: () => firedAt });
  service.register(subscriptionInput());
  service.enqueueReminder(reminder.id, firedAt);
  const dispatcher = createAssistantPushDispatcher(service, {
    now: () => firedAt,
    transport: {
      async send() {
        const error = new Error('bad request');
        error.statusCode = 400;
        throw error;
      },
    },
  });

  assert.deepEqual(await dispatcher.tick(), { processed: 1, skipped: false });
  assert.deepEqual(
    db.prepare(`
      SELECT status, attempt_count AS attemptCount, last_http_status AS httpStatus
      FROM assistant_push_deliveries
    `).get(),
    { status: 'failed', attemptCount: 1, httpStatus: 400 },
  );
  assert.deepEqual(await dispatcher.tick(), { processed: 0, skipped: false });
  db.close();
});

test('delivery leases prevent concurrent claims and recover after expiry', () => {
  const db = createDatabase();
  const start = epoch('2026-07-19T03:00:00Z');
  const { reminder, firedAt } = createFiredReminder(db, start);
  const first = createAssistantPushService(db, { enabled: true, leaseSeconds: 30, now: () => firedAt });
  const second = createAssistantPushService(db, { enabled: true, leaseSeconds: 30, now: () => firedAt });
  first.register(subscriptionInput());
  first.enqueueReminder(reminder.id, firedAt);

  const firstClaim = first.claim(firedAt);
  assert.equal(firstClaim.attemptCount, 1);
  assert.equal(second.claim(firedAt), null);

  const recovered = second.claim(firedAt + 31);
  assert.equal(recovered.id, firstClaim.id);
  assert.equal(recovered.attemptCount, 2);
  assert.equal(first.accept(firstClaim, 201, firedAt + 31), false);
  db.close();
});

test('scheduler fire and push outbox enqueue commit or roll back together', () => {
  const now = epoch('2026-07-20T03:00:00Z');
  const db = createDatabase();
  const store = createAssistantTaskStore(db, { now: () => now - 24 * 60 * 60 });
  const created = store.create({
    clientRequestId: 'push-atomic-good1',
    title: '원자적 푸시',
    detail: '',
    due: { kind: 'datetime', at: '2026-07-21T18:00:00+09:00' },
    reminderAt: '2026-07-20T12:00:00+09:00',
  });
  const push = createAssistantPushService(db, { enabled: true, now: () => now });
  push.register(subscriptionInput());
  const scheduler = createAssistantScheduler(db, {
    now: () => now,
    onReminderFired: (id, firedAt) => push.enqueueReminder(id, firedAt),
  });

  assert.deepEqual(scheduler.tick().firedIds, [created.reminder.id]);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assistant_push_deliveries').get().count, 1);
  db.close();

  const failingDb = createDatabase();
  const failingStore = createAssistantTaskStore(failingDb, { now: () => now - 24 * 60 * 60 });
  const failing = failingStore.create({
    clientRequestId: 'push-atomic-fail1',
    title: '롤백할 푸시',
    detail: '',
    due: { kind: 'datetime', at: '2026-07-21T18:00:00+09:00' },
    reminderAt: '2026-07-20T12:00:00+09:00',
  });
  const failingScheduler = createAssistantScheduler(failingDb, {
    now: () => now,
    onReminderFired() {
      throw new Error('forced outbox failure');
    },
  });
  assert.throws(() => failingScheduler.tick(), /forced outbox failure/);
  assert.deepEqual(
    failingDb.prepare('SELECT status, fired_at AS firedAt FROM assistant_reminders WHERE id = ?')
      .get(failing.reminder.id),
    { status: 'pending', firedAt: null },
  );
  failingDb.close();
});

test('task and reminder resolution hooks skip unsent deliveries', () => {
  const db = createDatabase();
  const start = epoch('2026-07-19T03:00:00Z');
  const first = createFiredReminder(db, start);
  const second = createFiredReminder(db, start, { clientRequestId: 'push-hooks-0002' });
  const push = createAssistantPushService(db, { enabled: true, now: () => first.firedAt });
  push.register(subscriptionInput());
  push.enqueueReminder(first.reminder.id, first.firedAt);
  push.enqueueReminder(second.reminder.id, second.firedAt);
  const hookedStore = createAssistantTaskStore(db, {
    now: () => first.firedAt,
    onTaskInactive: (id, changedAt) => push.skipTask(id, changedAt),
    onReminderResolved: (id, changedAt) => push.skipReminder(id, changedAt),
  });

  hookedStore.acknowledgeReminder(first.reminder.id);
  hookedStore.transition(second.task.id, 'cancel', { expectedVersion: 1 });
  assert.deepEqual(
    db.prepare(`
      SELECT reminder_id AS reminderId, status, last_error_code AS errorCode
      FROM assistant_push_deliveries
      ORDER BY reminder_id
    `).all(),
    [
      { reminderId: first.reminder.id, status: 'skipped', errorCode: 'REMINDER_RESOLVED' },
      { reminderId: second.reminder.id, status: 'skipped', errorCode: 'TASK_INACTIVE' },
    ],
  );
  db.close();
});
