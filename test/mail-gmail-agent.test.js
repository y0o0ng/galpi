'use strict';

// createGmailProvider → createMailAgent 실제 경로. baseline 구간과 신규 메일의
// 경계가 여기서만 드러난다.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const { createMailStore } = require('../lib/mail/store');
const { createMailAgent } = require('../lib/mail/agent');
const { createGmailProvider, createGoogleTokenSource } = require('../lib/mail/gmail');

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

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function messageBody(id, receivedAtSeconds) {
  return {
    id, threadId: `t-${id}`, labelIds: ['INBOX'],
    internalDate: String(receivedAtSeconds * 1000),
    payload: {
      headers: [
        { name: 'Message-ID', value: `<${id}@mail.gmail.com>` },
        { name: 'From', value: 'Someone <someone@example.com>' },
        { name: 'To', value: 'me@gmail.com' },
        { name: 'Subject', value: `제목 ${id}` },
      ],
    },
  };
}

// T0에 /profile을 잡고, 그 뒤에 도착한 메일이 최근 목록에 섞여 들어오는 상황을 만든다.
function createRacyGmail({ clock, cursorCaptureAt, lateMessageAt }) {
  const state = { profileCalls: 0, historyCalls: 0 };
  const messages = new Map([
    ['old-1', messageBody('old-1', cursorCaptureAt - 3600)],
    ['old-2', messageBody('old-2', cursorCaptureAt - 60)],
    ['late-1', messageBody('late-1', lateMessageAt)],
  ]);
  const fetchImpl = async url => {
    const target = String(url);
    if (target.includes('oauth2.googleapis.com/token')) {
      return jsonResponse({ access_token: 'tok', expires_in: 3600 });
    }
    if (target.includes('/profile')) {
      state.profileCalls += 1;
      // 커서를 잡는 순간이 T0다.
      clock.value = cursorCaptureAt;
      return jsonResponse({ historyId: '100' });
    }
    if (target.includes('/messages?')) {
      // 목록을 만드는 사이에 새 메일이 도착했다.
      clock.value = lateMessageAt + 1;
      return jsonResponse({ messages: [{ id: 'old-1' }, { id: 'old-2' }, { id: 'late-1' }] });
    }
    if (target.includes('/history?')) {
      state.historyCalls += 1;
      // H0 이후의 변경으로 그 새 메일이 다시 나온다.
      return jsonResponse({
        history: [{ messagesAdded: [{ message: { id: 'late-1', labelIds: ['INBOX'] } }] }],
        historyId: '200',
      });
    }
    const match = /\/messages\/([^?]+)/.exec(target);
    if (match) return jsonResponse(messages.get(decodeURIComponent(match[1])));
    throw new Error(`대역이 모르는 요청: ${target}`);
  };
  return { fetchImpl, state };
}

function setup({ cursorCaptureAt, lateMessageAt }) {
  const db = createDatabase();
  const clock = { value: cursorCaptureAt - 10 };
  const store = createMailStore(db, { now: () => clock.value });
  const { fetchImpl, state } = createRacyGmail({ clock, cursorCaptureAt, lateMessageAt });
  const agent = createMailAgent({
    store,
    providers: {
      gmail: createGmailProvider({
        fetch: fetchImpl,
        now: () => clock.value,
        tokenSource: createGoogleTokenSource({
          credentials: { clientId: 'c', clientSecret: 's', refreshToken: 'r' },
          fetch: fetchImpl,
          now: () => clock.value,
        }),
      }),
    },
    now: () => clock.value,
    credentials: () => ({}),
  });
  const account = store.registerAccount({ provider: 'gmail', address: 'me@gmail.com' });
  return { db, store, agent, account, clock, state };
}

test('mail that arrives after the baseline cursor is not buried as baseline', async () => {
  const cursorCaptureAt = 1786949400;
  const lateMessageAt = cursorCaptureAt + 5;
  const { db, store, agent, account } = setup({ cursorCaptureAt, lateMessageAt });

  await agent.tick();

  const rows = db.prepare(`
    SELECT identity_key AS id, is_baseline AS isBaseline, analysis_state AS state
    FROM mail_messages ORDER BY identity_key
  `).all();

  // 최초 연결 전부터 있던 메일은 기반선일 뿐이다.
  assert.deepEqual(rows.filter(r => r.id.startsWith('old')), [
    { id: 'old-1', isBaseline: 1, state: 'skipped' },
    { id: 'old-2', isBaseline: 1, state: 'skipped' },
  ]);

  // 커서를 잡은 뒤 도착한 메일은 진짜 신규다. baseline으로 묻히면 다음 history에서
  // 다시 만나도 dedup이 판단 상태를 건드리지 않아 영원히 skipped로 남는다.
  const late = rows.find(r => r.id === 'late-1');
  assert.deepEqual(late, { id: 'late-1', isBaseline: 0, state: 'pending' });

  assert.equal(store.getSyncState(account.id).baselineComplete, 1);
  assert.equal(store.getSyncState(account.id).gmailHistoryId, '100');
  db.close();
});

test('the next incremental round leaves that message analyzable', async () => {
  const cursorCaptureAt = 1786949400;
  const lateMessageAt = cursorCaptureAt + 5;
  const { db, store, agent, clock, account } = setup({ cursorCaptureAt, lateMessageAt });

  await agent.tick();
  clock.value = cursorCaptureAt + 400;
  const second = await agent.tick();

  // 두 번째 tick은 H0부터의 incremental이고 같은 메일을 다시 준다.
  assert.equal(second.results[0].mode, 'incremental');
  assert.equal(second.results[0].saved, 0, 'identity가 중복을 막는다');

  const late = db.prepare(`
    SELECT is_baseline AS isBaseline, analysis_state AS state
    FROM mail_messages WHERE identity_key = 'late-1'
  `).get();
  assert.deepEqual(late, { isBaseline: 0, state: 'pending' });
  assert.equal(store.getSyncState(account.id).gmailHistoryId, '200');
  db.close();
});
