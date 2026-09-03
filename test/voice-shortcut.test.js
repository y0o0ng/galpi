'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const {
  SHORTCUT_RESPONSE_FORMAT,
  VoiceShortcutError,
  createVoiceShortcutService,
  normalizeTurnInput,
  parseShortcutResponse,
} = require('../lib/voice-shortcut');

function createDatabase() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      last_active INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
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

function addSubscription(db, status = 'active') {
  return Number(db.prepare(`
    INSERT INTO assistant_push_subscriptions (endpoint, p256dh, auth, status)
    VALUES (?, 'key', 'auth', ?)
  `).run(`https://web.push.apple.com/${crypto.randomUUID()}`, status).lastInsertRowid);
}

function expectShortcutError(fn, code, statusCode) {
  assert.throws(fn, error => (
    error instanceof VoiceShortcutError
    && error.code === code
    && (statusCode === undefined || error.statusCode === statusCode)
  ));
}

test('shortcut credentials are one-time secrets bound to active push subscriptions', () => {
  const db = createDatabase();
  let currentTime = 1000;
  const tokens = ['A'.repeat(43), 'B'.repeat(43)];
  const service = createVoiceShortcutService(db, {
    enabled: true,
    now: () => currentTime,
    randomToken: () => tokens.shift(),
  });
  const subscriptionId = addSubscription(db);

  const first = service.issueCredential({ subscriptionId });
  assert.equal(first.token, 'A'.repeat(43));
  assert.equal(first.replaced, false);
  assert.equal(first.status, 'active');
  const stored = db.prepare(`
    SELECT token_sha256 AS tokenSha256, token_prefix AS tokenPrefix
    FROM assistant_shortcut_credentials
  `).get();
  assert.equal(stored.tokenSha256, crypto.createHash('sha256').update(first.token).digest('hex'));
  assert.equal(stored.tokenPrefix, 'A'.repeat(8));
  assert.equal(JSON.stringify(stored).includes(first.token), false);

  currentTime += 1;
  assert.equal(service.authenticate(first.token).id, first.id);
  assert.equal(
    db.prepare('SELECT last_used_at AS lastUsedAt FROM assistant_shortcut_credentials').get().lastUsedAt,
    currentTime,
  );

  const replacement = service.issueCredential({ subscriptionId });
  assert.equal(replacement.replaced, true);
  assert.equal(replacement.id, first.id);
  expectShortcutError(() => service.authenticate(first.token), 'SHORTCUT_AUTH_REQUIRED', 401);
  assert.equal(service.authenticate(replacement.token).id, first.id);

  const revoked = service.revokeCredential(first.id);
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.unchanged, false);
  assert.equal(service.revokeCredential(first.id).unchanged, true);
  expectShortcutError(() => service.authenticate(replacement.token), 'SHORTCUT_AUTH_REQUIRED', 401);

  const inactiveId = addSubscription(db, 'revoked');
  expectShortcutError(
    () => service.issueCredential({ subscriptionId: inactiveId }),
    'SHORTCUT_SUBSCRIPTION_INACTIVE',
    404,
  );
  const disabled = createVoiceShortcutService(db, { enabled: false });
  expectShortcutError(
    () => disabled.issueCredential({ subscriptionId }),
    'VOICE_SHORTCUT_DISABLED',
    503,
  );
  db.close();
});

test('shortcut turn input is normalized and rejects client-owned policy fields', () => {
  const requestId = '00000000-0000-4000-8000-000000000001';
  const normalized = normalizeTurnInput({ text: '  시온아  ', requestId: requestId.toUpperCase() });
  assert.deepEqual(normalized, {
    text: '시온아',
    requestId,
    requestSha256: crypto.createHash('sha256')
      .update(JSON.stringify({ text: '시온아' }))
      .digest('hex'),
  });
  expectShortcutError(
    () => normalizeTurnInput({ text: '질문', requestId, model: 'gpt' }),
    'SHORTCUT_INVALID_FIELDS',
  );
  expectShortcutError(
    () => normalizeTurnInput({ text: '질문', requestId, conversationId: 'client-session' }),
    'SHORTCUT_INVALID_FIELDS',
  );
  expectShortcutError(
    () => normalizeTurnInput({ text: '가'.repeat(2001), requestId }),
    'SHORTCUT_INVALID_TEXT',
  );
  expectShortcutError(
    () => normalizeTurnInput({ text: '질문', requestId: 'not-a-uuid' }),
    'SHORTCUT_INVALID_REQUEST_ID',
  );
});

test('shortcut structured response schema and parser expose only natural answer and boolean control', () => {
  assert.deepEqual(SHORTCUT_RESPONSE_FORMAT, {
    type: 'json_schema',
    name: 'voice_shortcut_turn',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        answer: { type: 'string' },
        canContinue: { type: 'boolean' },
      },
      required: ['answer', 'canContinue'],
    },
  });
  assert.deepEqual(
    parseShortcutResponse('{"answer":"  계속 말해줘.  ","canContinue":true}'),
    { answer: '계속 말해줘.', canContinue: true },
  );
  assert.deepEqual(
    parseShortcutResponse('{"answer":"응, 나중에 보자.","canContinue":false}'),
    { answer: '응, 나중에 보자.', canContinue: false },
  );

  for (const invalid of [
    'not-json',
    '[]',
    '{"canContinue":true}',
    '{"answer":"","canContinue":true}',
    '{"answer":"답"}',
    '{"answer":"답","canContinue":"true"}',
    '{"answer":"답","canContinue":true,"extra":"secret-provider-output"}',
  ]) {
    assert.throws(
      () => parseShortcutResponse(invalid),
      error => error.code === 'SHORTCUT_RESPONSE_INVALID'
        && error.message === '단축어 응답 형식이 올바르지 않습니다.'
        && !error.message.includes('secret-provider-output'),
    );
  }
});

test('shortcut receipts replay completed turns and bound pending retries', () => {
  const db = createDatabase();
  let currentTime = 2000;
  const token = 'C'.repeat(43);
  const service = createVoiceShortcutService(db, {
    enabled: true,
    now: () => currentTime,
    randomToken: () => token,
    randomConversationId: () => 'conversation-id-000001',
    pendingRetrySeconds: 30,
  });
  const credential = service.issueCredential({ subscriptionId: addSubscription(db) });
  const turn = service.normalizeTurnInput({
    text: '내일 일정 알려줘',
    requestId: '00000000-0000-4000-8000-000000000002',
  });
  const first = service.claimRequest(credential.id, turn);
  assert.equal(first.kind, 'new');
  assert.equal(first.attemptCount, 1);
  expectShortcutError(
    () => service.claimRequest(credential.id, turn),
    'SHORTCUT_REQUEST_IN_PROGRESS',
    409,
  );
  expectShortcutError(
    () => service.claimRequest(credential.id, { ...turn, requestSha256: 'f'.repeat(64) }),
    'SHORTCUT_REQUEST_CONFLICT',
    409,
  );

  currentTime += 31;
  assert.equal(service.claimRequest(credential.id, turn).attemptCount, 2);
  db.prepare("INSERT OR IGNORE INTO sessions (id) VALUES ('shared-main')").run();
  const userMessageId = Number(db.prepare(`
    INSERT INTO messages (session_id, role, content)
    VALUES ('shared-main', 'user', '내일 일정 알려줘')
  `).run().lastInsertRowid);
  const assistantMessageId = Number(db.prepare(`
    INSERT INTO messages (session_id, role, content, model)
    VALUES ('shared-main', 'assistant', '내일 일정은 없어.', 'gpt-test')
  `).run().lastInsertRowid);
  service.completeRequest({
    credentialId: credential.id,
    requestId: turn.requestId,
    requestSha256: turn.requestSha256,
    userMessageId,
    assistantMessageId,
    canContinue: true,
  });
  const replay = service.claimRequest(credential.id, turn);
  assert.equal(replay.kind, 'replay');
  assert.equal(replay.answer, '내일 일정은 없어.');
  assert.equal(replay.assistantMessageId, assistantMessageId);
  assert.equal(replay.canContinue, true);
  assert.equal(typeof replay.canContinue, 'boolean');

  const closingTurn = service.normalizeTurnInput({
    text: '오늘은 여기까지만 할게',
    requestId: '00000000-0000-4000-8000-000000000004',
  });
  service.claimRequest(credential.id, closingTurn);
  service.completeRequest({
    credentialId: credential.id,
    requestId: closingTurn.requestId,
    requestSha256: closingTurn.requestSha256,
    userMessageId,
    assistantMessageId,
    canContinue: false,
  });
  assert.equal(service.claimRequest(credential.id, closingTurn).canContinue, false);
  assert.throws(
    () => service.completeRequest({
      credentialId: credential.id,
      requestId: closingTurn.requestId,
      requestSha256: closingTurn.requestSha256,
      userMessageId,
      assistantMessageId,
    }),
    /canContinue는 boolean/,
  );

  const exhaustedTurn = service.normalizeTurnInput({
    text: '다른 질문',
    requestId: '00000000-0000-4000-8000-000000000003',
  });
  service.claimRequest(credential.id, exhaustedTurn);
  currentTime += 31;
  service.claimRequest(credential.id, exhaustedTurn);
  currentTime += 31;
  service.claimRequest(credential.id, exhaustedTurn);
  currentTime += 31;
  expectShortcutError(
    () => service.claimRequest(credential.id, exhaustedTurn),
    'SHORTCUT_RETRY_EXHAUSTED',
    409,
  );
  db.close();
});
