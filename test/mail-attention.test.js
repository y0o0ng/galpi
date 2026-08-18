'use strict';

// Attention lifecycle (설계 12·13.4). OPEN → SNOOZED → OPEN(재알림) → DONE.
//
// 회차(`notify_seq`)가 과거 delivery와 새 delivery를 가른다. wake에서 회차만 오르고
// 알림이 안 나가면 DB가 잡아주지 못하므로 그 둘을 한 트랜잭션에 묶는다.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const { createMailStore } = require('../lib/mail/store');
const { createMailPushService } = require('../lib/mail/push');

const NOW = Math.floor(Date.parse('2026-08-18T14:00:00+09:00') / 1000);

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

let seed = 0;
function setup({ subscriptions = 1 } = {}) {
  const db = createDatabase();
  const clock = { value: NOW };
  for (let i = 0; i < subscriptions; i += 1) {
    db.prepare("INSERT INTO assistant_push_subscriptions (endpoint, p256dh, auth) VALUES (?, 'p', 'a')")
      .run(`https://web.push.apple.com/device-${i}`);
  }
  const store = createMailStore(db, { now: () => clock.value });
  const account = store.registerAccount({ provider: 'naver', address: 'me@naver.com' });
  const push = createMailPushService(db, {
    enabled: true,
    now: () => clock.value,
    settings: () => ({ notificationsEnabled: true, quietHours: { enabled: false } }),
  });
  return { db, clock, store, push, account };
}

function seedAttention(db, accountId) {
  seed += 1;
  const messageId = db.prepare(`
    INSERT INTO mail_messages (
      account_id, identity_kind, identity_key, received_at, analysis_state, notification_mode
    ) VALUES (?, 'rfc_message_id', ?, ?, 'done', 'immediate')
  `).run(accountId, `<a${seed}@example.com>`, NOW - 600).lastInsertRowid;
  const attentionId = db.prepare('INSERT INTO mail_attention (mail_message_id) VALUES (?)')
    .run(messageId).lastInsertRowid;
  return { messageId, attentionId };
}

const attentionRow = (db, id) => db.prepare(`
  SELECT state, notify_seq AS notifySeq, snoozed_until AS snoozedUntil, resolved_at AS resolvedAt
  FROM mail_attention WHERE id = ?
`).get(id);

test('snooze parks an open attention with a wake time', () => {
  const { db, clock, store, account } = setup();
  const { attentionId } = seedAttention(db, account.id);
  const until = clock.value + 3600;

  const result = store.snoozeAttention(attentionId, until, clock.value);
  assert.equal(result.changed, true);
  assert.deepEqual(attentionRow(db, attentionId), {
    state: 'snoozed', notifySeq: 1, snoozedUntil: until, resolvedAt: null,
  });
  db.close();
});

test('waking a snoozed attention raises the round and re-notifies in one step', () => {
  const { db, clock, store, push, account } = setup({ subscriptions: 2 });
  const { messageId, attentionId } = seedAttention(db, account.id);
  push.enqueue({ targetKind: 'message', targetId: messageId, notifySeq: 1 }, clock.value);
  store.snoozeAttention(attentionId, clock.value + 3600, clock.value);

  // 아직 시간이 안 됐다.
  assert.deepEqual(store.wakeDueAttention(clock.value, () => {}), { woken: 0 });

  clock.value += 3601;
  const woken = [];
  const result = store.wakeDueAttention(clock.value, item => {
    woken.push(item);
    push.enqueue({ targetKind: 'message', targetId: item.mailMessageId, notifySeq: item.notifySeq }, clock.value);
  });

  assert.deepEqual(result, { woken: 1 });
  assert.deepEqual(woken, [{ attentionId, mailMessageId: messageId, notifySeq: 2 }]);
  assert.deepEqual(attentionRow(db, attentionId), {
    state: 'open', notifySeq: 2, snoozedUntil: null, resolvedAt: null,
  });
  // 회차가 갈려서 과거 delivery와 새 delivery가 섞이지 않는다. 기기 2대 × 회차 2 = 4.
  const rows = db.prepare('SELECT notify_seq AS seq, COUNT(*) AS n FROM mail_push_deliveries GROUP BY 1 ORDER BY 1').all();
  assert.deepEqual(rows, [{ seq: 1, n: 2 }, { seq: 2, n: 2 }]);
  db.close();
});

test('a wake that cannot notify rolls back the round too', () => {
  // 회차만 오르고 알림이 안 나가면 사용자는 영영 못 받고 DB는 그것을 모른다.
  const { db, clock, store, account } = setup();
  const { attentionId } = seedAttention(db, account.id);
  store.snoozeAttention(attentionId, clock.value + 60, clock.value);
  clock.value += 61;

  assert.throws(() => store.wakeDueAttention(clock.value, () => {
    throw new Error('enqueue failed');
  }), /enqueue failed/);

  // 상태가 그대로라 다음 tick이 다시 시도한다.
  assert.deepEqual(attentionRow(db, attentionId), {
    state: 'snoozed', notifySeq: 1, snoozedUntil: clock.value - 1, resolvedAt: null,
  });
  db.close();
});

test('done closes the attention from either state and is idempotent', () => {
  const { db, clock, store, account } = setup();
  const open = seedAttention(db, account.id);
  const snoozed = seedAttention(db, account.id);
  store.snoozeAttention(snoozed.attentionId, clock.value + 3600, clock.value);

  assert.equal(store.resolveAttention(open.attentionId, clock.value).changed, true);
  assert.equal(store.resolveAttention(snoozed.attentionId, clock.value).changed, true);
  for (const id of [open.attentionId, snoozed.attentionId]) {
    const row = attentionRow(db, id);
    assert.equal(row.state, 'done');
    assert.equal(row.resolvedAt, clock.value);
    assert.equal(row.snoozedUntil, null);
  }

  // 두 번 눌러도 오류가 아니다. 이미 끝난 것은 끝난 것이다.
  const again = store.resolveAttention(open.attentionId, clock.value + 5);
  assert.equal(again.changed, false);
  assert.equal(again.state, 'done');
  assert.equal(attentionRow(db, open.attentionId).resolvedAt, clock.value, '해결 시각을 덮지 않는다');
  db.close();
});

test('a finished attention cannot be snoozed back to life', () => {
  const { db, clock, store, account } = setup();
  const { attentionId } = seedAttention(db, account.id);
  store.resolveAttention(attentionId, clock.value);

  const result = store.snoozeAttention(attentionId, clock.value + 3600, clock.value);
  assert.equal(result.changed, false);
  assert.equal(result.state, 'done');
  assert.equal(attentionRow(db, attentionId).state, 'done');
  db.close();
});

test('a done attention stops its unsent pushes from ever going out', () => {
  const { db, clock, store, push, account } = setup();
  const { messageId, attentionId } = seedAttention(db, account.id);
  push.enqueue({ targetKind: 'message', targetId: messageId, notifySeq: 1 }, clock.value);

  store.resolveAttention(attentionId, clock.value);

  // claim이 자격을 다시 보므로 아직 안 나간 것은 여기서 끝난다.
  assert.equal(push.claim(clock.value), null);
  assert.equal(db.prepare('SELECT status FROM mail_push_deliveries').get().status, 'skipped');
  db.close();
});

test('a snoozed attention holds its current round back until the wake', () => {
  const { db, clock, store, push, account } = setup();
  const { messageId, attentionId } = seedAttention(db, account.id);
  push.enqueue({ targetKind: 'message', targetId: messageId, notifySeq: 1 }, clock.value);
  store.snoozeAttention(attentionId, clock.value + 3600, clock.value);

  assert.equal(push.claim(clock.value), null);
  assert.equal(db.prepare('SELECT status FROM mail_push_deliveries').get().status, 'skipped');

  // 깨어나면 새 회차로 다시 알린다. 미룬 것이 사라진 것이 아니다.
  clock.value += 3601;
  store.wakeDueAttention(clock.value, item => {
    push.enqueue({ targetKind: 'message', targetId: item.mailMessageId, notifySeq: item.notifySeq }, clock.value);
  });
  const claim = push.claim(clock.value);
  assert.equal(claim.notifySeq, 2);
  db.close();
});

test('waking never touches an attention the user already finished', () => {
  const { db, clock, store, account } = setup();
  const { attentionId } = seedAttention(db, account.id);
  store.snoozeAttention(attentionId, clock.value + 60, clock.value);
  store.resolveAttention(attentionId, clock.value);

  clock.value += 61;
  assert.deepEqual(store.wakeDueAttention(clock.value, () => {
    throw new Error('깨우면 안 된다');
  }), { woken: 0 });
  assert.equal(attentionRow(db, attentionId).state, 'done');
  db.close();
});

test('snooze refuses a wake time that is not in the future', () => {
  const { db, clock, store, account } = setup();
  const { attentionId } = seedAttention(db, account.id);
  // 과거로 미루면 다음 tick이 즉시 깨워서 미룬 의미가 없다.
  for (const until of [clock.value, clock.value - 1, 0, -5, 1.5, null]) {
    assert.throws(() => store.snoozeAttention(attentionId, until, clock.value), /snooze/i, String(until));
  }
  assert.equal(attentionRow(db, attentionId).state, 'open');
  db.close();
});

// ── 알림 설정 (설계 4.1) ──────────────────────────────────────────────────────
// preview 설정은 없앴으므로(13.1) 사용자가 만지는 값은 둘뿐이다.

test('mail settings start at the values the design fixed', () => {
  const { db, store } = setup();
  assert.deepEqual(store.getMailSettings(), {
    notificationsEnabled: true,
    quietHours: { enabled: true, start: '23:00', end: '07:00' },
  });
  db.close();
});

test('settings round-trip through app_settings without a table of their own', () => {
  const { db, store } = setup();
  store.saveMailSettings({
    notificationsEnabled: false,
    quietHours: { enabled: true, start: '22:30', end: '08:00' },
  });

  assert.deepEqual(store.getMailSettings(), {
    notificationsEnabled: false,
    quietHours: { enabled: true, start: '22:30', end: '08:00' },
  });
  // 기존 표를 공유한다. 메일 전용 표를 만들지 않는다.
  const keys = db.prepare("SELECT key FROM app_settings WHERE key LIKE 'mail.%' ORDER BY key").all();
  assert.deepEqual(keys.map(k => k.key), ['mail.notifications_enabled', 'mail.quiet_hours']);
  db.close();
});

test('a broken shape is refused instead of stored', () => {
  const { db, store } = setup();
  for (const bad of [
    { notificationsEnabled: 'yes' },
    { quietHours: { enabled: true, start: '25:00', end: '07:00' } },
    { quietHours: { enabled: true, start: '23:00' } },
    { quietHours: { enabled: 'on', start: '23:00', end: '07:00' } },
    { quietHours: 'off' },
  ]) {
    assert.throws(() => store.saveMailSettings(bad), /설정/, JSON.stringify(bad));
  }
  // 거부됐으므로 기본값 그대로다.
  assert.equal(store.getMailSettings().notificationsEnabled, true);
  db.close();
});

test('a stored value that went bad falls back instead of silencing push', () => {
  const { db, store } = setup();
  db.prepare("INSERT INTO app_settings (key, value_json) VALUES ('mail.quiet_hours', '{oops')").run();
  // 깨진 설정 때문에 알림이 영영 안 나가면 안 된다. 기본값으로 읽는다.
  assert.deepEqual(store.getMailSettings().quietHours, { enabled: true, start: '23:00', end: '07:00' });
  db.close();
});
