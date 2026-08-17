'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const { createMailStore } = require('../lib/mail/store');

function createDatabase() {
  const db = new Database(':memory:');
  // 운영은 server.js에서 foreign_keys를 켜고 실패하면 기동을 거부한다. 테스트가
  // 그것 없이 돌면 운영이 거부하는 행을 통과시킨다.
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

test('rediscovering a message keeps one row but moves its locator to the current UID', () => {
  const { db, store } = createStore();
  const account = store.registerAccount({ provider: 'naver', address: 'me@naver.com' });

  const base = {
    accountId: account.id,
    identityKind: 'rfc_message_id',
    identityKey: '<interview@aitrainer.example.com>',
    imapUidValidity: '0',
    receivedAt: 1786949400,
    subject: '면접 일정',
  };

  const first = store.saveMessage({ ...base, imapUid: 16575 });
  assert.equal(first.inserted, true);

  // 재번호 뒤 resync에서 같은 메일을 새 UID로 다시 만난 상황이다. 행은 하나로 유지하되
  // locator는 지금 좌표로 옮겨야 한다 — 옛 UID를 들고 있으면 나중에 본문을 다시 읽는
  // 재분석·원문 열기가 사라진 좌표를 찾아가 조용히 실패한다.
  const replay = store.saveMessage({ ...base, imapUid: 42 });
  assert.equal(replay.inserted, false);
  assert.equal(replay.message.id, first.message.id);
  assert.equal(replay.message.imapUid, 42, 'locator는 현재 UID로 갱신된다');
  assert.equal(store.countMessages(account.id), 1);

  // 반대로 UID가 같아도 identity가 다르면 다른 메일이다.
  const other = store.saveMessage({
    ...base, identityKey: '<other@example.com>', imapUid: 16575,
  });
  assert.equal(other.inserted, true);
  assert.equal(store.countMessages(account.id), 2);
  db.close();
});

test('rediscovery refreshes the locator without reopening judgement state', () => {
  const { db, store } = createStore();
  const account = store.registerAccount({ provider: 'naver', address: 'me@naver.com' });

  const base = {
    accountId: account.id,
    identityKind: 'rfc_message_id',
    identityKey: '<notice@korea.ac.kr>',
    imapUidValidity: '0',
    receivedAt: 1786949400,
  };
  const saved = store.saveMessage({ ...base, imapUid: 100, isBaseline: true });
  assert.equal(saved.message.analysisState, 'skipped');

  // 최초 연결에서 baseline으로 들어온 과거 메일이 resync에서 다시 잡혔다.
  // locator만 움직이고 분석 큐로는 올라오지 않아야 한다 — 올라오면 몇 달 치 과거
  // 메일이 재번호 한 번에 전부 알림이 된다.
  const again = store.saveMessage({ ...base, imapUid: 777, isBaseline: false });
  assert.equal(again.inserted, false);
  assert.equal(again.message.imapUid, 777);
  assert.equal(again.message.isBaseline, 1, 'baseline 표시는 유지된다');
  assert.equal(again.message.analysisState, 'skipped', '분석 큐로 승격되지 않는다');
  db.close();
});

test('a message belongs to whatever provider its account has', () => {
  const { db, store } = createStore();
  const naver = store.registerAccount({ provider: 'naver', address: 'me@naver.com' });
  const gmail = store.registerAccount({ provider: 'gmail', address: 'me@gmail.com' });

  // provider는 계정이 정한다. 메시지가 따로 들고 있으면 둘이 어긋난 행을 만들 수 있고
  // DB는 그걸 막을 방법이 없다 — mail_accounts.enabled를 두지 않은 것과 같은 이유다.
  const columns = db.prepare('PRAGMA table_info(mail_messages)').all().map(c => c.name);
  assert.equal(columns.includes('provider'), false);

  const saved = store.saveMessage({
    accountId: naver.id, identityKind: 'rfc_message_id',
    identityKey: '<a@example.com>', imapUid: 1, receivedAt: 1786949400,
  });
  assert.equal(saved.message.provider, 'naver');

  const other = store.saveMessage({
    accountId: gmail.id, identityKind: 'gmail_message',
    identityKey: 'g1', gmailMessageId: 'g1', receivedAt: 1786949400,
  });
  assert.equal(other.message.provider, 'gmail');

  // 없는 계정으로는 저장할 수 없다. 운영과 같은 foreign_keys 설정에서 확인한다.
  assert.throws(() => store.saveMessage({
    accountId: 9999, identityKind: 'gmail_message',
    identityKey: 'ghost', receivedAt: 1786949400,
  }), /FOREIGN KEY/);
  db.close();
});

test('baseline messages land outside the analysis queue', () => {
  const { db, store } = createStore();
  const account = store.registerAccount({ provider: 'gmail', address: 'me@gmail.com' });

  const old = store.saveMessage({
    accountId: account.id, identityKind: 'gmail_message',
    identityKey: 'g-old', gmailMessageId: 'g-old', receivedAt: 1786000000, isBaseline: true,
  });
  const fresh = store.saveMessage({
    accountId: account.id, identityKind: 'gmail_message',
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
    accountId: gmail.id, identityKind: 'gmail_message',
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
