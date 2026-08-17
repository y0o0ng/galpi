'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const { createMailStore } = require('../lib/mail/store');

function createDatabase() {
  const db = new Database(':memory:');
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
    CREATE TABLE auto_save_decisions (
      id INTEGER PRIMARY KEY, decision TEXT NOT NULL, action TEXT
    );
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

function createStore(now = 1786949400) {
  const db = createDatabase();
  const clock = { value: now };
  const store = createMailStore(db, { now: () => clock.value });
  return { db, store, clock };
}

test('registering an account is idempotent and creates its cursor row', () => {
  const { db, store } = createStore();

  const first = store.registerAccount({ provider: 'naver', address: 'Me@Naver.com' });
  const second = store.registerAccount({ provider: 'naver', address: 'me@naver.com' });

  // 주소는 정규화해서 저장하므로 대소문자가 달라도 같은 계정이다.
  assert.equal(first.id, second.id);
  assert.equal(first.address, 'me@naver.com');
  assert.equal(first.status, 'active');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mail_accounts').get().n, 1);

  const state = store.getSyncState(first.id);
  assert.equal(state.accountId, first.id);
  assert.equal(state.baselineComplete, 0);
  assert.equal(state.gmailHistoryId, null);
  assert.equal(state.imapLastUid, null);

  assert.throws(() => store.registerAccount({ provider: 'outlook', address: 'a@b.com' }), /provider/);
  db.close();
});

test('the same message arriving twice is stored once even when its UID changed', () => {
  const { db, store } = createStore();
  const account = store.registerAccount({ provider: 'naver', address: 'me@naver.com' });

  const base = {
    accountId: account.id,
    provider: 'naver',
    identityKind: 'rfc_message_id',
    identityKey: '<interview@aitrainer.example.com>',
    imapUidValidity: '0',
    receivedAt: 1786949400,
    subject: '면접 일정',
  };

  const first = store.saveMessage({ ...base, imapUid: 16575 });
  assert.equal(first.inserted, true);

  // UIDVALIDITY가 늘 '0'인 네이버에서는 재번호를 감지할 수 없다. 그래도 identity가
  // 같으면 같은 메일이므로 두 번째 저장은 조용히 무시된다 — replay가 안전한 이유다.
  const replay = store.saveMessage({ ...base, imapUid: 42 });
  assert.equal(replay.inserted, false);
  assert.equal(replay.message.id, first.message.id);
  assert.equal(replay.message.imapUid, 16575, 'locator는 최초 저장값을 유지한다');
  assert.equal(store.countMessages(account.id), 1);

  // 반대로 UID가 같아도 identity가 다르면 다른 메일이다.
  const other = store.saveMessage({
    ...base, identityKey: '<other@example.com>', imapUid: 16575,
  });
  assert.equal(other.inserted, true);
  assert.equal(store.countMessages(account.id), 2);
  db.close();
});

test('baseline messages land outside the analysis queue', () => {
  const { db, store } = createStore();
  const account = store.registerAccount({ provider: 'gmail', address: 'me@gmail.com' });

  const old = store.saveMessage({
    accountId: account.id, provider: 'gmail', identityKind: 'gmail_message',
    identityKey: 'g-old', gmailMessageId: 'g-old', receivedAt: 1786000000, isBaseline: true,
  });
  const fresh = store.saveMessage({
    accountId: account.id, provider: 'gmail', identityKind: 'gmail_message',
    identityKey: 'g-new', gmailMessageId: 'g-new', receivedAt: 1786949400,
  });

  // 최초 연결에서 끌어온 과거 메일은 dedup 기반선일 뿐이라 분석·알림으로 승격되지 않는다.
  assert.equal(old.message.isBaseline, 1);
  assert.equal(old.message.analysisState, 'skipped');
  assert.equal(fresh.message.isBaseline, 0);
  assert.equal(fresh.message.analysisState, 'pending');

  assert.equal(store.getSyncState(account.id).baselineComplete, 0);
  store.completeBaseline(account.id);
  assert.equal(store.getSyncState(account.id).baselineComplete, 1);
  db.close();
});

test('cursors move only when asked and keep the raw UIDVALIDITY naver sends', () => {
  const { db, store } = createStore();
  const gmail = store.registerAccount({ provider: 'gmail', address: 'me@gmail.com' });
  const naver = store.registerAccount({ provider: 'naver', address: 'me@naver.com' });

  store.saveMessage({
    accountId: gmail.id, provider: 'gmail', identityKind: 'gmail_message',
    identityKey: 'g1', gmailMessageId: 'g1', receivedAt: 1786949400,
  });
  // 저장만으로는 커서가 움직이지 않는다. 커서는 "여기까지 확실히 저장했다"는 뜻이라
  // 페이지 전량 소비가 끝난 뒤에 따로 커밋한다.
  assert.equal(store.getSyncState(gmail.id).gmailHistoryId, null);

  store.commitGmailCursor(gmail.id, '987654');
  assert.equal(store.getSyncState(gmail.id).gmailHistoryId, '987654');

  store.commitImapCursor(naver.id, { mailbox: 'INBOX', uidValidity: '0', lastUid: 16600 });
  const state = store.getSyncState(naver.id);
  assert.equal(state.imapMailbox, 'INBOX');
  assert.equal(state.imapUidValidity, '0');
  assert.equal(state.imapLastUid, 16600);
  db.close();
});

test('due accounts respect per-account scheduling and drop out on auth failure', () => {
  const { db, store, clock } = createStore(1000);
  const gmail = store.registerAccount({ provider: 'gmail', address: 'me@gmail.com' });
  const naver = store.registerAccount({ provider: 'naver', address: 'me@naver.com' });

  assert.deepEqual(store.listDueAccounts(1000).map(a => a.id), [gmail.id, naver.id]);

  store.markSynced(gmail.id, 1300);
  assert.deepEqual(store.listDueAccounts(1000).map(a => a.id), [naver.id]);
  assert.deepEqual(store.listDueAccounts(1300).map(a => a.id), [naver.id, gmail.id]);

  // 인증 실패는 재시도로 풀리지 않으므로 계정을 세운다. 다른 계정은 계속 돈다.
  clock.value = 1400;
  store.markAccountError(naver.id, {
    status: 'auth_required', errorCode: 'invalid_grant', nextSyncAt: 1400,
  });
  assert.deepEqual(store.listDueAccounts(2000).map(a => a.id), [gmail.id]);

  const stored = store.getAccount(naver.id);
  assert.equal(stored.status, 'auth_required');
  assert.equal(stored.lastErrorCode, 'invalid_grant');

  // 같은 오류를 매 tick마다 알리지 않는다. 첫 번째만 알림을 가져간다.
  assert.equal(store.claimAuthAlert(naver.id), true);
  assert.equal(store.claimAuthAlert(naver.id), false);

  // 재인증에 성공하면 상태와 알림 자리가 함께 비워진다.
  store.markSynced(naver.id, 1700);
  assert.equal(store.getAccount(naver.id).status, 'active');
  assert.equal(store.getAccount(naver.id).authAlertSentAt, null);
  assert.equal(store.claimAuthAlert(naver.id), true);
  db.close();
});
