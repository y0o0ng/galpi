'use strict';

// provider와 agent를 fake로 갈라놓고 보면 지나가지 않는 경계가 있다. 여기서는
// createNaverProvider → createMailAgent 실제 경로를 한 번에 통과시킨다.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const { createMailStore } = require('../lib/mail/store');
const { createMailAgent } = require('../lib/mail/agent');
const { createNaverProvider } = require('../lib/mail/naver');

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

// 실제 ImapFlow처럼 logout 뒤에는 아무 명령도 받지 않는다. 이것이 이 대역의 핵심이다.
function createClosingClient({ rows, mailbox } = {}) {
  const events = [];
  let open = false;
  function assertOpen(command) {
    if (!open) {
      const error = new Error(`연결이 닫힌 뒤 ${command}를 호출했습니다.`);
      error.code = 'NoConnection';
      throw error;
    }
  }
  return {
    events,
    mailbox: null,
    async connect() { open = true; events.push('connect'); },
    async logout() { open = false; events.push('logout'); },
    async getMailboxLock(path, options) {
      assertOpen('getMailboxLock');
      events.push(`lock:${options?.readOnly ? 'ro' : 'rw'}`);
      this.mailbox = { ...mailbox };
      return { release: async () => { events.push('release'); } };
    },
    fetch() {
      assertOpen('fetch');
      events.push('fetch');
      return (async function* generate() { for (const row of rows) yield row; })();
    },
    async download(uid) {
      assertOpen('download');
      events.push(`download:${uid}`);
      return {
        content: (async function* generate() {
          yield Buffer.from(`raw-${uid}`, 'latin1');
        })(),
      };
    },
  };
}

function createImapError(overrides = {}) {
  return Object.assign(new Error('imap failure'), overrides);
}

function row(uid, { messageId = `<mail-${uid}@example.com>` } = {}) {
  return {
    uid,
    size: 512,
    envelope: {
      messageId,
      subject: `제목 ${uid}`,
      date: new Date('2026-08-17T09:12:33+09:00'),
      from: [{ name: '발신자', address: 'sender@example.com' }],
      to: [{ address: 'me@naver.com' }],
    },
    headers: Buffer.from('', 'latin1'),
  };
}

function setup(client, { now = 1000 } = {}) {
  const db = createDatabase();
  const store = createMailStore(db, { now: () => now });
  const errors = [];
  const agent = createMailAgent({
    store,
    providers: { naver: createNaverProvider({ createClient: () => client }) },
    now: () => now,
    credentials: () => ({ user: 'u', pass: 'p' }),
    onError: error => errors.push(error),
  });
  const account = store.registerAccount({ provider: 'naver', address: 'me@naver.com' });
  store.completeBaseline(account.id);
  return { db, store, agent, account, errors };
}

test('a message without Message-ID gets its digest while the connection is still open', async () => {
  const client = createClosingClient({
    mailbox: { exists: 1, uidNext: 102, uidValidity: '0' },
    rows: [row(101, { messageId: null })],
  });
  const { db, store, agent, account, errors } = setup(client);

  const result = await agent.tick(1000);

  assert.deepEqual(errors, [], 'digest 경로에서 오류가 나면 안 된다');
  assert.equal(result.results[0].saved, 1);

  // download가 logout보다 먼저 일어나야 한다. 순서가 뒤집히면 실제 ImapFlow에서는
  // 닫힌 연결에 명령을 보내게 된다.
  const downloadAt = client.events.indexOf('download:101');
  const logoutAt = client.events.indexOf('logout');
  assert.ok(downloadAt >= 0, 'Message-ID가 없으면 raw를 받아야 한다');
  assert.ok(downloadAt < logoutAt, `download가 logout 뒤에 있었다: ${client.events.join(' → ')}`);

  const stored = db.prepare('SELECT identity_kind AS kind, identity_key AS key FROM mail_messages').get();
  assert.equal(stored.kind, 'fingerprint');
  assert.match(stored.key, /^[0-9a-f]{64}$/);
  assert.equal(store.countMessages(account.id), 1);
  db.close();
});

test('a normal message never costs a body download', async () => {
  const client = createClosingClient({
    mailbox: { exists: 2, uidNext: 103, uidValidity: '0' },
    rows: [row(101), row(102)],
  });
  const { db, store, agent, account } = setup(client);

  await agent.tick(1000);

  // Message-ID가 있으면 본문을 받을 이유가 없다. 실측에서 40/40이 이 경로다.
  assert.equal(client.events.some(event => event.startsWith('download:')), false);
  assert.equal(store.countMessages(account.id), 2);
  db.close();
});

test('an auth failure from IMAP parks the account instead of retrying it', async () => {
  const client = createClosingClient({ mailbox: { exists: 0, uidNext: 1, uidValidity: '0' }, rows: [] });
  // ImapFlow가 로그인 실패에 붙이는 실제 표시다.
  client.connect = async () => {
    throw createImapError({ authenticationFailed: true, serverResponseCode: 'AUTHENTICATIONFAILED' });
  };
  const { db, store, agent, account, errors } = setup(client);

  await agent.tick(1000);

  assert.equal(store.getAccount(account.id).status, 'auth_required');
  assert.equal(store.getAccount(account.id).lastErrorCode, 'MAIL_AUTH_REQUIRED');
  assert.equal(errors[0].retryable, false);
  db.close();
});

test('a dropped connection keeps the account active for the next round', async () => {
  const client = createClosingClient({ mailbox: { exists: 0, uidNext: 1, uidValidity: '0' }, rows: [] });
  // ImapFlow가 연결이 끊겼을 때 붙이는 코드다.
  client.connect = async () => { throw createImapError({ code: 'ECONNRESET' }); };
  const { db, store, agent, account, errors } = setup(client);

  await agent.tick(1000);

  // 이것이 status='error'가 되면 listDueAccounts가 active만 집으므로 계정이 영구히 멈춘다.
  assert.equal(store.getAccount(account.id).status, 'active');
  assert.equal(store.getAccount(account.id).lastErrorCode, 'MAIL_IMAP_FAILED');
  assert.equal(errors[0].retryable, true);
  assert.equal(store.getAccount(account.id).nextSyncAt, 1300);
  db.close();
});

test('an unknown failure is parked instead of being retried forever', async () => {
  const client = createClosingClient({ mailbox: { exists: 0, uidNext: 1, uidValidity: '0' }, rows: [] });
  client.connect = async () => { throw createImapError({ code: 'STARTTLS_INJECTION' }); };
  const { db, store, agent, account } = setup(client);

  await agent.tick(1000);

  assert.equal(store.getAccount(account.id).status, 'error');
  assert.equal(store.getAccount(account.id).lastErrorCode, 'MAIL_IMAP_FATAL');
  db.close();
});

test('a failure while fetching is normalized too, not just at connect', async () => {
  const client = createClosingClient({ mailbox: { exists: 1, uidNext: 102, uidValidity: '0' }, rows: [] });
  client.fetch = () => { throw createImapError({ code: 'ETIMEOUT' }); };
  const { db, store, agent, account } = setup(client);

  await agent.tick(1000);

  assert.equal(store.getAccount(account.id).status, 'active');
  assert.equal(store.getAccount(account.id).lastErrorCode, 'MAIL_IMAP_FAILED');
  // 실패해도 연결은 닫는다.
  assert.ok(client.events.includes('logout'));
  db.close();
});
