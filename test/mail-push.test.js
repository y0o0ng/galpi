'use strict';

// Mail delivery 상태 기계. 기기별로 상태가 갈리는 것과 같은 회차가 두 번 나가지
// 않는 것이 핵심이고, 전달 루프 자체는 기존 dispatcher를 그대로 재사용한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const { createAssistantPushDispatcher } = require('../lib/assistant-push');
const {
  buildMailPushPayload,
  buildMailSendOptions,
  createMailPushService,
} = require('../lib/mail/push');

const NOW = Math.floor(Date.parse('2026-08-18T14:00:00+09:00') / 1000); // 낮 — quiet hours 밖

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

function setup({ subscriptions = 2, enabled = true, settings } = {}) {
  const db = createDatabase();
  const clock = { value: NOW };
  for (let i = 0; i < subscriptions; i += 1) {
    db.prepare(`
      INSERT INTO assistant_push_subscriptions (endpoint, p256dh, auth)
      VALUES (?, 'p', 'a')
    `).run(`https://web.push.apple.com/device-${i}`);
  }
  const service = createMailPushService(db, {
    enabled,
    now: () => clock.value,
    settings: settings || (() => ({ notificationsEnabled: true, quietHours: { enabled: false } })),
  });
  return { db, clock, service };
}

// mail_messages 없이 Attention 행만 만든다. 이 파일은 전달만 검증한다.
function seedAttention(db, { state = 'open', notifySeq = 1 } = {}) {
  const accountId = db.prepare(`
    INSERT INTO mail_accounts (provider, address) VALUES ('naver', 'me@naver.com')
  `).run().lastInsertRowid;
  const messageId = db.prepare(`
    INSERT INTO mail_messages (account_id, identity_kind, identity_key, received_at)
    VALUES (?, 'rfc_message_id', '<a@example.com>', ?)
  `).run(accountId, NOW - 600).lastInsertRowid;
  return db.prepare(`
    INSERT INTO mail_attention (mail_message_id, state, notify_seq, snoozed_until, resolved_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    messageId, state, notifySeq,
    state === 'snoozed' ? NOW + 3600 : null,
    state === 'done' ? NOW : null,
  ).lastInsertRowid;
}

function makeDispatcher(service, transport, clock) {
  return createAssistantPushDispatcher(service, {
    now: () => clock.value,
    transport,
    buildPayload: claim => buildMailPushPayload(claim),
    buildSendOptions: buildMailSendOptions,
  });
}

function recordingTransport(reply = () => ({ statusCode: 201 })) {
  const calls = [];
  return {
    calls,
    async send(subscription, payload, delivery) {
      calls.push({ subscription, payload, delivery });
      const result = reply(calls.length, subscription);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

test('one attention fans out to every active device exactly once', () => {
  const { db, clock, service } = setup({ subscriptions: 2 });
  const attentionId = seedAttention(db);

  const first = service.enqueue({ targetKind: 'attention', targetId: attentionId, notifySeq: 1 }, clock.value);
  assert.deepEqual(first, { subscriptions: 2, created: 2 });

  // 같은 tick이 재실행돼도 같은 회차가 다시 들어가지 않는다.
  const again = service.enqueue({ targetKind: 'attention', targetId: attentionId, notifySeq: 1 }, clock.value);
  assert.equal(again.created, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mail_push_deliveries').get().n, 2);

  // 회차가 오르면 새 delivery다. snooze 재알림이 이 경로를 쓴다.
  const next = service.enqueue({ targetKind: 'attention', targetId: attentionId, notifySeq: 2 }, clock.value);
  assert.equal(next.created, 2);
  db.close();
});

test('one device accepting does not settle the other', async () => {
  const { db, clock, service } = setup({ subscriptions: 2 });
  seedAttention(db);
  service.enqueue({ targetKind: 'attention', targetId: 1, notifySeq: 1 }, clock.value);

  // 첫 기기는 201, 둘째는 503이라 재시도로 남는다.
  const transport = recordingTransport(index => (index === 1
    ? { statusCode: 201 }
    : Object.assign(new Error('unavailable'), { statusCode: 503 })));
  await makeDispatcher(service, transport, clock).tick();

  const rows = db.prepare('SELECT subscription_id AS sub, status, attempt_count AS n FROM mail_push_deliveries ORDER BY subscription_id').all();
  assert.deepEqual(rows.map(r => r.status), ['accepted', 'retry']);
  assert.equal(rows[1].n, 1);
  // 재시도는 미래로 밀린다. 같은 tick에서 무한 반복하지 않는다.
  const retryAt = db.prepare('SELECT next_attempt_at AS at FROM mail_push_deliveries WHERE status = ?').get('retry').at;
  assert.ok(retryAt > clock.value);
  db.close();
});

test('the payload the transport sees is the routing-only contract', async () => {
  const { db, clock, service } = setup({ subscriptions: 1 });
  seedAttention(db);
  service.enqueue({ targetKind: 'attention', targetId: 1, notifySeq: 1 }, clock.value);

  const transport = recordingTransport();
  await makeDispatcher(service, transport, clock).tick();

  const payload = JSON.parse(transport.calls[0].payload);
  assert.deepEqual(Object.keys(payload).sort(), ['notifySeq', 'targetId', 'targetKind', 'type', 'url', 'version']);
  assert.equal(payload.type, 'mail_attention');
  // topic은 payload가 아니라 헤더다. 대상별로 갈려야 이전 알림을 합칠 수 있다.
  assert.equal(transport.calls[0].delivery.topic, 'mail-attention-1');
  assert.equal(transport.calls[0].delivery.urgency, 'normal');
  assert.ok(transport.calls[0].delivery.ttl > 0);
  db.close();
});

test('a dead subscription expires alone and leaves the other device working', async () => {
  const { db, clock, service } = setup({ subscriptions: 2 });
  seedAttention(db);
  service.enqueue({ targetKind: 'attention', targetId: 1, notifySeq: 1 }, clock.value);

  const transport = recordingTransport(index => (index === 1
    ? Object.assign(new Error('gone'), { statusCode: 410 })
    : { statusCode: 201 }));
  await makeDispatcher(service, transport, clock).tick();

  const deliveries = db.prepare('SELECT subscription_id AS sub, status FROM mail_push_deliveries ORDER BY subscription_id').all();
  assert.deepEqual(deliveries.map(d => d.status), ['expired', 'accepted']);
  const subs = db.prepare('SELECT id, status FROM assistant_push_subscriptions ORDER BY id').all();
  assert.deepEqual(subs.map(s => s.status), ['expired', 'active']);
  db.close();
});

test('a worker killed mid-send loses its lease and the delivery comes back', () => {
  const { db, clock, service } = setup({ subscriptions: 1 });
  seedAttention(db);
  service.enqueue({ targetKind: 'attention', targetId: 1, notifySeq: 1 }, clock.value);

  const claim = service.claim(clock.value);
  assert.ok(claim);
  assert.equal(db.prepare('SELECT status FROM mail_push_deliveries').get().status, 'sending');
  // lease가 살아 있는 동안에는 아무도 못 집는다.
  assert.equal(service.claim(clock.value), null);

  clock.value += 61;
  const again = service.claim(clock.value);
  assert.equal(again.id, claim.id);
  assert.equal(again.attemptCount, 2);
  // 회수된 뒤 늦게 돌아온 옛 worker는 남의 결과를 덮지 못한다.
  assert.equal(service.accept(claim, 201, clock.value), false);
  assert.equal(db.prepare('SELECT status FROM mail_push_deliveries').get().status, 'sending');
  db.close();
});

test('a target the user already handled is skipped instead of sent', async () => {
  const { db, clock, service } = setup({ subscriptions: 1 });
  const attentionId = seedAttention(db);
  service.enqueue({ targetKind: 'attention', targetId: attentionId, notifySeq: 1 }, clock.value);

  // claim 전에 완료 처리된 경우.
  db.prepare("UPDATE mail_attention SET state = 'done', resolved_at = ? WHERE id = ?").run(clock.value, attentionId);

  const transport = recordingTransport();
  await makeDispatcher(service, transport, clock).tick();

  assert.equal(transport.calls.length, 0);
  assert.equal(db.prepare('SELECT status FROM mail_push_deliveries').get().status, 'skipped');
  db.close();
});

test('a stale notify_seq never rings after a newer round exists', async () => {
  const { db, clock, service } = setup({ subscriptions: 1 });
  const attentionId = seedAttention(db);
  service.enqueue({ targetKind: 'attention', targetId: attentionId, notifySeq: 1 }, clock.value);
  // snooze wake가 회차를 올린 상태.
  db.prepare('UPDATE mail_attention SET notify_seq = 2 WHERE id = ?').run(attentionId);
  service.enqueue({ targetKind: 'attention', targetId: attentionId, notifySeq: 2 }, clock.value);

  const transport = recordingTransport();
  await makeDispatcher(service, transport, clock).tick();

  const rows = db.prepare('SELECT notify_seq AS seq, status FROM mail_push_deliveries ORDER BY notify_seq').all();
  assert.deepEqual(rows, [{ seq: 1, status: 'skipped' }, { seq: 2, status: 'accepted' }]);
  assert.equal(transport.calls.length, 1);
  assert.equal(JSON.parse(transport.calls[0].payload).notifySeq, 2);
  db.close();
});

test('a batch delivery does not depend on any attention row', async () => {
  const { db, clock, service } = setup({ subscriptions: 1 });
  const batchId = db.prepare(`
    INSERT INTO mail_notification_batches (opened_at, due_at, item_count) VALUES (?, ?, 4)
  `).run(NOW - 900, NOW).lastInsertRowid;
  service.enqueue({ targetKind: 'batch', targetId: batchId, notifySeq: 1 }, clock.value);

  const transport = recordingTransport();
  await makeDispatcher(service, transport, clock).tick();

  assert.equal(db.prepare('SELECT status FROM mail_push_deliveries').get().status, 'accepted');
  const payload = JSON.parse(transport.calls[0].payload);
  assert.equal(payload.targetKind, 'batch');
  // 개수는 payload에 실리지 않는다. item_count가 4여도 어디에도 없어야 한다.
  assert.equal(transport.calls[0].payload.includes('4'), false);
  db.close();
});

test('quiet hours delay the push without delaying the attention', () => {
  const night = Math.floor(Date.parse('2026-08-19T02:00:00+09:00') / 1000);
  const { db, clock, service } = setup({
    subscriptions: 1,
    settings: () => ({ notificationsEnabled: true, quietHours: { enabled: true, start: '23:00', end: '07:00' } }),
  });
  clock.value = night;
  seedAttention(db);
  service.enqueue({ targetKind: 'attention', targetId: 1, notifySeq: 1 }, night);

  const row = db.prepare('SELECT next_attempt_at AS at, expires_at AS exp FROM mail_push_deliveries').get();
  const morning = Math.floor(Date.parse('2026-08-19T07:00:00+09:00') / 1000);
  assert.equal(row.at, morning);
  // 보류한 만큼 만료도 밀어야 한다. 아니면 풀리기 전에 만료된다.
  assert.ok(row.exp > morning);
  // 아직은 아무도 못 집는다.
  assert.equal(service.claim(night), null);
  assert.ok(service.claim(morning));
  db.close();
});

test('turning mail notifications off stops delivery without touching attention', () => {
  const { db, clock, service } = setup({
    subscriptions: 2,
    settings: () => ({ notificationsEnabled: false, quietHours: { enabled: false } }),
  });
  seedAttention(db);

  const result = service.enqueue({ targetKind: 'attention', targetId: 1, notifySeq: 1 }, clock.value);
  assert.deepEqual(result, { subscriptions: 0, created: 0, suppressed: 'NOTIFICATIONS_OFF' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mail_push_deliveries').get().n, 0);
  // Attention은 그대로 남는다. Push를 끈 것이지 판단을 끈 것이 아니다.
  assert.equal(db.prepare('SELECT state FROM mail_attention').get().state, 'open');
  db.close();
});

test('a delivery past its ttl expires instead of ringing late', () => {
  const { db, clock, service } = setup({ subscriptions: 1 });
  seedAttention(db);
  service.enqueue({ targetKind: 'attention', targetId: 1, notifySeq: 1 }, clock.value);

  clock.value += 24 * 60 * 60 + 60;
  assert.equal(service.claim(clock.value), null);
  const row = db.prepare('SELECT status, last_error_code AS code FROM mail_push_deliveries').get();
  assert.equal(row.status, 'expired');
  assert.equal(row.code, 'DELIVERY_TTL_EXPIRED');
  db.close();
});
