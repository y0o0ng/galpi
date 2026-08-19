'use strict';

// 라우팅 상태 기계 (설계 13.2·13.3). 판단이 끝난 메일을 notification_mode에 따라
// 조용히 묻거나, 즉시 전달하거나, batch에 모은다.
//
// 핵심은 **notification_mode와 Attention이 서로 다른 축**이라는 것이다. 라우팅은
// Attention 존재 여부를 보지 않는다.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const { BATCH_WINDOW_SECONDS, createMailPushService } = require('../lib/mail/push');
const { createMailStore } = require('../lib/mail/store');

const NOW = Math.floor(Date.parse('2026-08-18T14:00:00+09:00') / 1000); // quiet hours 밖

function createDatabase() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, model TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY, filename TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
      note_type TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
      codex_status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE auto_save_decisions (id INTEGER PRIMARY KEY, decision TEXT NOT NULL, action TEXT);
    CREATE TABLE note_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, chunk_id TEXT UNIQUE NOT NULL,
      note_filename TEXT NOT NULL, note_title TEXT NOT NULL, chunk_type TEXT NOT NULL,
      content TEXT NOT NULL, source_session TEXT, source_user_message INTEGER,
      source_assistant_message INTEGER, embedding TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE assistant_retrieval_shadow_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, mode TEXT NOT NULL,
      notes_json TEXT NOT NULL, chunks_json TEXT NOT NULL,
      context_chars INTEGER NOT NULL DEFAULT 0, latency_ms INTEGER NOT NULL DEFAULT 0,
      error TEXT, created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);
  runDatabaseMigrations(db);
  return db;
}

function setup({ subscriptions = 1, settings } = {}) {
  const db = createDatabase();
  const clock = { value: NOW };
  for (let i = 0; i < subscriptions; i += 1) {
    db.prepare("INSERT INTO assistant_push_subscriptions (endpoint, p256dh, auth) VALUES (?, 'p', 'a')")
      .run(`https://web.push.apple.com/device-${i}`);
  }
  db.prepare("INSERT INTO mail_accounts (provider, address) VALUES ('naver', 'me@naver.com')").run();
  // 선호 조회는 store가 소유한다. 라우팅은 그 결과만 받는다(설계 11.1).
  const store = createMailStore(db, { now: () => clock.value });
  const service = createMailPushService(db, {
    enabled: true,
    now: () => clock.value,
    settings: settings || (() => ({ notificationsEnabled: true, quietHours: { enabled: false } })),
    preferences: input => store.findMatchingPreferences(input),
  });
  return { db, clock, service, store };
}

let seed = 0;
// 판단이 끝난 메일 하나. Attention은 선택이다.
function analysedMail(db, { mode, attention = false } = {}) {
  seed += 1;
  const messageId = db.prepare(`
    INSERT INTO mail_messages (
      account_id, identity_kind, identity_key, received_at,
      analysis_state, category, notification_mode
    ) VALUES (1, 'rfc_message_id', ?, ?, 'done', 'info', ?)
  `).run(`<m${seed}@example.com>`, NOW - 600, mode).lastInsertRowid;
  if (attention) {
    db.prepare('INSERT INTO mail_attention (mail_message_id) VALUES (?)').run(messageId);
  }
  return messageId;
}

const stateOf = (db, id) => db.prepare(
  'SELECT notification_state AS state, batch_id AS batchId FROM mail_messages WHERE id = ?',
).get(id);
const deliveryCount = db => db.prepare('SELECT COUNT(*) AS n FROM mail_push_deliveries').get().n;

test('silent judgement is recorded but never delivered', () => {
  const { db, clock, service } = setup();
  const id = analysedMail(db, { mode: 'silent' });

  const result = service.routePending(clock.value);
  assert.deepEqual(result, { routed: 1, immediate: 0, batched: 0, suppressed: 1 });
  assert.deepEqual(stateOf(db, id), { state: 'suppressed', batchId: null });
  assert.equal(deliveryCount(db), 0);
  // 판단 자체는 그대로 남는다. 조용한 것이지 지운 것이 아니다.
  assert.equal(db.prepare('SELECT category FROM mail_messages WHERE id = ?').get(id).category, 'info');
  db.close();
});

test('immediate fans out at once, with or without an attention', () => {
  const { db, clock, service } = setup({ subscriptions: 2 });
  const withAttention = analysedMail(db, { mode: 'immediate', attention: true });
  const withoutAttention = analysedMail(db, { mode: 'immediate', attention: false });

  const result = service.routePending(clock.value);
  assert.equal(result.immediate, 2);
  assert.equal(stateOf(db, withAttention).state, 'enqueued');
  assert.equal(stateOf(db, withoutAttention).state, 'enqueued');
  // 메일 2통 × 기기 2대.
  assert.equal(deliveryCount(db), 4);

  const targets = db.prepare('SELECT DISTINCT target_kind AS kind, target_id AS id FROM mail_push_deliveries ORDER BY target_id').all();
  assert.deepEqual(targets, [
    { kind: 'message', id: withAttention },
    { kind: 'message', id: withoutAttention },
  ]);
  db.close();
});

test('routing runs once per mail even if the tick repeats', () => {
  const { db, clock, service } = setup();
  analysedMail(db, { mode: 'immediate' });

  assert.equal(service.routePending(clock.value).routed, 1);
  // 두 번째 tick은 집을 것이 없다. pending이 아니기 때문이다.
  assert.deepEqual(service.routePending(clock.value), { routed: 0, immediate: 0, batched: 0, suppressed: 0 });
  assert.equal(deliveryCount(db), 1);
  db.close();
});

test('a mail whose analysis has not finished is not routed', () => {
  const { db, clock, service } = setup();
  db.prepare(`
    INSERT INTO mail_messages (account_id, identity_kind, identity_key, received_at, analysis_state)
    VALUES (1, 'rfc_message_id', '<pending@example.com>', ?, 'pending')
  `).run(NOW - 60);

  assert.equal(service.routePending(clock.value).routed, 0);
  db.close();
});

test('batch mails join one window instead of ringing one by one', () => {
  const { db, clock, service } = setup();
  const first = analysedMail(db, { mode: 'batch' });
  const second = analysedMail(db, { mode: 'batch', attention: true });

  const result = service.routePending(clock.value);
  assert.equal(result.batched, 2);
  assert.equal(deliveryCount(db), 0, 'batch는 지금 보내지 않는다');

  const batches = db.prepare('SELECT id, state, opened_at AS openedAt, due_at AS dueAt, item_count AS n FROM mail_notification_batches').all();
  assert.equal(batches.length, 1, '열린 batch 하나에 모인다');
  assert.equal(batches[0].state, 'open');
  assert.equal(batches[0].dueAt, batches[0].openedAt + BATCH_WINDOW_SECONDS);
  assert.equal(batches[0].n, 2);
  assert.equal(stateOf(db, first).batchId, batches[0].id);
  assert.equal(stateOf(db, second).batchId, batches[0].id);
  db.close();
});

test('a batch flushes into one summary push per device', () => {
  const { db, clock, service } = setup({ subscriptions: 2 });
  analysedMail(db, { mode: 'batch' });
  analysedMail(db, { mode: 'batch' });
  analysedMail(db, { mode: 'batch' });
  service.routePending(clock.value);

  // 아직 창이 열려 있다.
  assert.deepEqual(service.flushDueBatches(clock.value), { flushed: 0, empty: 0, created: 0 });
  assert.equal(deliveryCount(db), 0);

  clock.value += BATCH_WINDOW_SECONDS;
  const flush = service.flushDueBatches(clock.value);
  assert.equal(flush.flushed, 1);
  // 메일 3통이 기기당 Push 1개가 된다.
  assert.equal(flush.created, 2);
  assert.equal(deliveryCount(db), 2);

  const batch = db.prepare('SELECT id, state, delivered_at AS deliveredAt FROM mail_notification_batches').get();
  assert.equal(batch.state, 'delivered');
  assert.equal(batch.deliveredAt, clock.value);
  const rows = db.prepare('SELECT DISTINCT target_kind AS kind, target_id AS id FROM mail_push_deliveries').all();
  assert.deepEqual(rows, [{ kind: 'batch', id: batch.id }]);
  db.close();
});

test('mail arriving after a flush opens a new window', () => {
  const { db, clock, service } = setup();
  analysedMail(db, { mode: 'batch' });
  service.routePending(clock.value);
  clock.value += BATCH_WINDOW_SECONDS;
  service.flushDueBatches(clock.value);

  const later = analysedMail(db, { mode: 'batch' });
  service.routePending(clock.value);

  const batches = db.prepare('SELECT id, state FROM mail_notification_batches ORDER BY id').all();
  assert.deepEqual(batches.map(b => b.state), ['delivered', 'open']);
  assert.equal(stateOf(db, later).batchId, batches[1].id);
  db.close();
});

test('an empty batch closes without ringing', () => {
  const { db, clock, service } = setup();
  // 항목 없이 창만 열린 경우. 열자마자 메일이 사라지는 일은 드물지만 계약은 정한다.
  db.prepare('INSERT INTO mail_notification_batches (opened_at, due_at) VALUES (?, ?)')
    .run(NOW - BATCH_WINDOW_SECONDS, NOW);

  const flush = service.flushDueBatches(clock.value);
  assert.deepEqual(flush, { flushed: 0, empty: 1, created: 0 });
  assert.equal(db.prepare('SELECT state FROM mail_notification_batches').get().state, 'empty');
  assert.equal(deliveryCount(db), 0);
  db.close();
});

test('quiet hours hold the push but not the routing', () => {
  const night = Math.floor(Date.parse('2026-08-19T02:00:00+09:00') / 1000);
  const morning = Math.floor(Date.parse('2026-08-19T07:00:00+09:00') / 1000);
  const { db, clock, service } = setup({
    settings: () => ({ notificationsEnabled: true, quietHours: { enabled: true, start: '23:00', end: '07:00' } }),
  });
  clock.value = night;
  const id = analysedMail(db, { mode: 'immediate' });

  service.routePending(night);
  // 라우팅은 즉시 끝난다. 미룬 것은 전달뿐이다.
  assert.equal(stateOf(db, id).state, 'enqueued');
  assert.equal(db.prepare('SELECT next_attempt_at AS at FROM mail_push_deliveries').get().at, morning);
  assert.equal(service.claim(night), null);
  db.close();
});

test('routing does not depend on attention, and never creates one', () => {
  const { db, clock, service } = setup();
  analysedMail(db, { mode: 'immediate', attention: false });
  analysedMail(db, { mode: 'batch', attention: false });
  analysedMail(db, { mode: 'silent', attention: false });

  service.routePending(clock.value);
  clock.value += BATCH_WINDOW_SECONDS;
  service.flushDueBatches(clock.value);

  // Attention은 후속 행동의 정본이다. 알림을 보냈다고 만들어내지 않는다.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mail_attention').get().n, 0);
  assert.equal(deliveryCount(db), 2, 'immediate 1 + batch 1');
  db.close();
});

test('a mode the contract does not know is left alone, not guessed', () => {
  const { db, clock, service } = setup();
  // 분석은 끝났는데 mode가 비어 있는 행. 라우팅이 임의로 정하면 안 된다.
  const id = db.prepare(`
    INSERT INTO mail_messages (account_id, identity_kind, identity_key, received_at, analysis_state)
    VALUES (1, 'rfc_message_id', '<nomode@example.com>', ?, 'done')
  `).run(NOW - 60).lastInsertRowid;

  assert.equal(service.routePending(clock.value).routed, 0);
  assert.equal(stateOf(db, id).state, 'pending');
  assert.equal(deliveryCount(db), 0);
  db.close();
});

// ── Preference 적용 (설계 11.1·11.3) ─────────────────────────────────────────
// Preference는 **알림 라우팅** 선호다. 의미 판단을 지우지 않으므로 category와
// Attention은 그대로 남고 마지막 라우팅 단계만 달라진다.

function analysedMailFrom(db, { mode, sender, category = 'info' }) {
  seed += 1;
  return db.prepare(`
    INSERT INTO mail_messages (
      account_id, identity_kind, identity_key, received_at,
      analysis_state, category, notification_mode, sender_address
    ) VALUES (1, 'rfc_message_id', ?, ?, 'done', ?, ?, ?)
  `).run(`<p${seed}@example.com>`, NOW - 600, category, mode, sender).lastInsertRowid;
}

test('a suppressed sender is routed quiet without losing its judgement', () => {
  const { db, clock, service } = setup();
  db.prepare(`
    INSERT INTO mail_preferences (account_id, preference_type, target, action)
    VALUES (NULL, 'sender', 'news@example.com', 'suppress_notification')
  `).run();
  const suppressed = analysedMailFrom(db, { mode: 'immediate', sender: 'news@example.com' });
  const other = analysedMailFrom(db, { mode: 'immediate', sender: 'boss@example.com' });

  const result = service.routePending(clock.value);
  assert.deepEqual(result, { routed: 2, immediate: 1, batched: 0, suppressed: 1 });
  assert.equal(stateOf(db, suppressed).state, 'suppressed');
  assert.equal(stateOf(db, other).state, 'enqueued');
  // 억제는 알림만 끈다. 판단은 그대로 남아서 나중에 찾을 수 있다.
  assert.equal(
    db.prepare('SELECT category FROM mail_messages WHERE id = ?').get(suppressed).category,
    'info',
  );
  assert.equal(deliveryCount(db), 1, '억제된 메일은 전달을 만들지 않는다');
  db.close();
});

test('a domain rule catches the sender it covers, and a sender rule is narrower', () => {
  const { db, clock, service } = setup();
  db.prepare(`
    INSERT INTO mail_preferences (account_id, preference_type, target, action)
    VALUES (NULL, 'domain', 'ads.example.com', 'suppress_notification')
  `).run();
  const byDomain = analysedMailFrom(db, { mode: 'immediate', sender: 'anyone@ads.example.com' });
  const untouched = analysedMailFrom(db, { mode: 'immediate', sender: 'anyone@ads.example.org' });

  service.routePending(clock.value);
  assert.equal(stateOf(db, byDomain).state, 'suppressed');
  assert.equal(stateOf(db, untouched).state, 'enqueued');
  db.close();
});

test('a preference the routing layer does not enforce leaves the mode alone', () => {
  const { db, clock, service } = setup();
  // always_notify·skip_analysis는 저장 통로가 아직 없다. 행이 생겨도 라우팅이
  // 임의로 승격하지 않는다.
  db.prepare(`
    INSERT INTO mail_preferences (account_id, preference_type, target, action)
    VALUES (NULL, 'sender', 'boss@example.com', 'always_notify')
  `).run();
  const id = analysedMailFrom(db, { mode: 'silent', sender: 'boss@example.com' });

  service.routePending(clock.value);
  assert.equal(stateOf(db, id).state, 'suppressed', 'silent 그대로');
  assert.equal(deliveryCount(db), 0);
  db.close();
});
