'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const { createMailStore } = require('../lib/mail/store');
const { createMailAgent } = require('../lib/mail/agent');

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

function imapMessage(uid, overrides = {}) {
  return {
    imapUid: uid,
    imapUidValidity: '0',
    messageId: `<mail-${uid}@example.com>`,
    from: { name: '국민은행', address: 'noreply@bank.example.kr' },
    to: ['me@naver.com'],
    subject: `제목 ${uid}`,
    receivedAt: 1786949400 + uid,
    ...overrides,
  };
}

function setup({ now = 1000, naverResults = [], gmailResults = [], analyzer = null, pushService = null } = {}) {
  const db = createDatabase();
  const clock = { value: now };
  const store = createMailStore(db, { now: () => clock.value });
  const calls = { naver: 0, gmail: 0, credentials: [] };
  const errors = [];
  const authAlerts = [];

  const providers = {
    naver: {
      async sync() {
        const next = naverResults[Math.min(calls.naver, naverResults.length - 1)];
        calls.naver += 1;
        if (next instanceof Error) throw next;
        if (typeof next === 'function') return next();
        return next;
      },
    },
    gmail: {
      async sync() {
        const next = gmailResults[Math.min(calls.gmail, gmailResults.length - 1)];
        calls.gmail += 1;
        if (next instanceof Error) throw next;
        if (typeof next === 'function') return next();
        return next;
      },
    },
  };

  const agent = createMailAgent({
    store,
    providers,
    analyzer,
    pushService,
    now: () => clock.value,
    syncIntervalSeconds: 300,
    credentials: account => { calls.credentials.push(account.id); return { user: 'u', pass: 'p' }; },
    onError: error => errors.push(error),
    onAuthRequired: (account, error) => authAlerts.push({ id: account.id, code: error.code }),
  });

  return { db, store, agent, clock, calls, errors, authAlerts };
}

test('a first sync stores the past as baseline and then moves the cursor', async () => {
  const { db, store, agent } = setup({
    naverResults: [{
      mode: 'baseline', reason: 'BASELINE', mailbox: 'INBOX', uidValidity: '0',
      uidNext: 103, messages: [imapMessage(101), imapMessage(102)], highestUid: 102,
    }],
  });
  const account = store.registerAccount({ provider: 'naver', address: 'me@naver.com' });

  const result = await agent.tick(1000);
  assert.deepEqual(result.results, [{
    accountId: account.id, mode: 'baseline', reason: 'BASELINE', saved: 2, skipped: 0,
  }]);

  // 최초 연결에서 끌어온 메일은 분석·알림 대상이 아니다.
  const rows = db.prepare('SELECT is_baseline AS isBaseline, analysis_state AS state FROM mail_messages').all();
  assert.deepEqual(rows, [
    { isBaseline: 1, state: 'skipped' },
    { isBaseline: 1, state: 'skipped' },
  ]);

  const state = store.getSyncState(account.id);
  assert.equal(state.baselineComplete, 1);
  assert.equal(state.imapLastUid, 102);
  assert.equal(store.getAccount(account.id).nextSyncAt, 1300);
  db.close();
});

test('replaying the same window after a crash adds nothing and keeps the cursor honest', async () => {
  const page = {
    mode: 'incremental', reason: 'CURSOR', mailbox: 'INBOX', uidValidity: '0',
    uidNext: 103, messages: [imapMessage(101), imapMessage(102)], highestUid: 102,
  };
  const { db, store, agent, clock } = setup({ naverResults: [page, page] });
  const account = store.registerAccount({ provider: 'naver', address: 'me@naver.com' });
  store.completeBaseline(account.id);

  const first = await agent.tick(1000);
  assert.equal(first.results[0].saved, 2);

  // 커서를 옮기기 전에 죽었다가 다시 같은 구간을 읽은 상황이다. identity가 막으므로
  // 새 행이 생기지 않는다 — 다시 읽는 것은 싸고 건너뛰는 것은 복구가 안 된다.
  clock.value = 1300;
  const second = await agent.tick(1300);
  assert.equal(second.results[0].saved, 0);
  assert.equal(second.results[0].skipped, 2);
  assert.equal(store.countMessages(account.id), 2);
  db.close();
});

test('an empty window still advances the cursor past the gap', async () => {
  const { db, store, agent } = setup({
    naverResults: [{
      mode: 'incremental', reason: 'CURSOR', mailbox: 'INBOX', uidValidity: '0',
      uidNext: 501, messages: [], highestUid: null,
    }],
  });
  const account = store.registerAccount({ provider: 'naver', address: 'me@naver.com' });
  store.completeBaseline(account.id);

  await agent.tick(1000);
  // 아무것도 못 봤어도 uidNext 앞까지는 확인한 것이다. 그러지 않으면 빈 구간을
  // 매 tick마다 다시 훑는다.
  assert.equal(store.getSyncState(account.id).imapLastUid, 500);
  db.close();
});

test('gmail commits the history cursor only after its messages are stored', async () => {
  const { db, store, agent } = setup({
    gmailResults: [{
      mode: 'incremental', reason: 'CURSOR', historyId: '222',
      messages: [{
        gmailMessageId: 'm1', threadId: 't1', subject: '면접',
        from: { name: 'AI Trainer', address: 'recruit@example.com' },
        to: ['me@gmail.com'], receivedAt: 1786949400,
      }],
    }],
  });
  const account = store.registerAccount({ provider: 'gmail', address: 'me@gmail.com' });
  store.completeBaseline(account.id);

  await agent.tick(1000);
  assert.equal(store.getSyncState(account.id).gmailHistoryId, '222');

  const row = store.findMessageByIdentity(account.id, 'm1');
  assert.equal(row.identityKind, 'gmail_message');
  assert.equal(row.provider, 'gmail');
  db.close();
});

test('a message without Message-ID falls back to a digest fingerprint', async () => {
  const { db, store, agent } = setup({
    naverResults: [{
      mode: 'incremental', reason: 'CURSOR', mailbox: 'INBOX', uidValidity: '0', uidNext: 102,
      // provider가 연결을 쥐고 있는 동안 채워 보낸 값이다. agent는 여기서 다시
      // 받아오지 않는다 — 그 시점은 이미 logout 뒤다.
      messages: [imapMessage(101, { messageId: null, rawDigest: 'a'.repeat(64) })],
      highestUid: 101,
    }],
  });
  const account = store.registerAccount({ provider: 'naver', address: 'me@naver.com' });
  store.completeBaseline(account.id);

  await agent.tick(1000);
  const row = db.prepare('SELECT identity_kind AS kind FROM mail_messages').get();
  assert.equal(row.kind, 'fingerprint');
  db.close();
});

test('one dead provider does not stop the other account', async () => {
  const { db, store, agent, errors } = setup({
    naverResults: [Object.assign(new Error('IMAP down'), { retryable: true, code: 'MAIL_IMAP_FAILED' })],
    gmailResults: [{ mode: 'incremental', reason: 'CURSOR', historyId: '9', messages: [] }],
  });
  const naver = store.registerAccount({ provider: 'naver', address: 'me@naver.com' });
  const gmail = store.registerAccount({ provider: 'gmail', address: 'me@gmail.com' });
  store.completeBaseline(naver.id);
  store.completeBaseline(gmail.id);

  const result = await agent.tick(1000);
  assert.equal(result.results.length, 2);
  assert.equal(errors.length, 1);

  // 일시적 실패는 계정을 세우지 않는다. 다음 주기에 그냥 다시 시도한다.
  assert.equal(store.getAccount(naver.id).status, 'active');
  assert.equal(store.getAccount(naver.id).lastErrorCode, 'MAIL_IMAP_FAILED');
  assert.equal(store.getSyncState(gmail.id).gmailHistoryId, '9');
  db.close();
});

test('re-auth is required once, not every tick', async () => {
  const authError = Object.assign(new Error('invalid_grant'), {
    code: 'MAIL_AUTH_REQUIRED', retryable: false,
  });
  const { db, store, agent, authAlerts, calls, clock } = setup({ gmailResults: [authError] });
  const account = store.registerAccount({ provider: 'gmail', address: 'me@gmail.com' });
  store.completeBaseline(account.id);

  await agent.tick(1000);
  assert.equal(store.getAccount(account.id).status, 'auth_required');
  assert.deepEqual(authAlerts, [{ id: account.id, code: 'MAIL_AUTH_REQUIRED' }]);

  // 세워진 계정은 due 목록에서 빠지므로 provider를 다시 부르지 않는다.
  // 같은 오류를 매 tick마다 다시 알리지도 않는다.
  clock.value = 5000;
  const later = await agent.tick(5000);
  assert.deepEqual(later.results, []);
  assert.equal(calls.gmail, 1);
  assert.equal(authAlerts.length, 1);
  db.close();
});

test('a second tick cannot start while the first is still running', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { db, store, agent, calls } = setup({
    naverResults: [async () => {
      await gate;
      return {
        mode: 'incremental', reason: 'CURSOR', mailbox: 'INBOX', uidValidity: '0',
        uidNext: 102, messages: [imapMessage(101)], highestUid: 101,
      };
    }],
  });
  const account = store.registerAccount({ provider: 'naver', address: 'me@naver.com' });
  store.completeBaseline(account.id);

  const first = agent.tick(1000);
  // 겹쳐 들어온 tick은 같은 계정을 두 번 동기화하지 않고 그대로 돌아간다.
  const overlapping = await agent.tick(1000);
  assert.deepEqual(overlapping, { capturedAt: 1000, results: [], skipped: true });

  release();
  await first;
  assert.equal(calls.naver, 1);
  assert.equal(store.countMessages(account.id), 1);
  db.close();
});

test('accounts are only touched when their own schedule is due', async () => {
  const page = {
    mode: 'incremental', reason: 'CURSOR', mailbox: 'INBOX', uidValidity: '0',
    uidNext: 102, messages: [], highestUid: null,
  };
  const { db, store, agent, calls } = setup({ naverResults: [page] });
  const account = store.registerAccount({ provider: 'naver', address: 'me@naver.com' });
  store.completeBaseline(account.id);

  await agent.tick(1000);
  assert.equal(calls.naver, 1);

  // worker tick은 30초마다 돌지만 Provider 호출은 계정별 5분 주기다.
  await agent.tick(1030);
  await agent.tick(1060);
  assert.equal(calls.naver, 1);

  await agent.tick(1300);
  assert.equal(calls.naver, 2);
  db.close();
});

test('stopping the worker ends the schedule instead of leaving a timer behind', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const page = {
    mode: 'incremental', reason: 'CURSOR', mailbox: 'INBOX', uidValidity: '0',
    uidNext: 102, messages: [], highestUid: null,
  };
  const { db, store, agent, calls } = setup({ naverResults: [page] });
  const account = store.registerAccount({ provider: 'naver', address: 'me@naver.com' });
  store.completeBaseline(account.id);

  assert.equal(agent.isRunning(), false);
  agent.start();
  assert.equal(agent.isRunning(), true);
  // start()는 즉시 한 번 돈다.
  await Promise.resolve();
  const afterStart = calls.naver;

  // 종료 뒤에는 시간이 흘러도 새 tick이 시작되지 않는다. SIGTERM 경로에서
  // server.js가 이 stop()을 부른다.
  assert.equal(agent.stop(), true);
  assert.equal(agent.isRunning(), false);
  t.mock.timers.tick(300_000);
  await Promise.resolve();
  assert.equal(calls.naver, afterStart);

  // 이미 멈춘 worker를 다시 멈추는 것은 아무 일도 하지 않는다.
  assert.equal(agent.stop(), false);
  db.close();
});

// ── 분석 단계 격리 (설계 22.2) ────────────────────────────────────────────────

test('the analysis step runs even when every account failed to sync', async () => {
  // 동기화가 통째로 죽어도 이미 저장된 메일의 판단은 계속 나와야 한다.
  const analysisTicks = [];
  const { db, store, agent, clock } = setup({
    naverResults: [Object.assign(new Error('down'), { retryable: true })],
    analyzer: { async tick(now) { analysisTicks.push(now); return { results: [{ outcome: 'done' }] }; } },
  });
  store.registerAccount({ provider: 'naver', address: 'me@naver.com' });

  const result = await agent.tick();
  assert.equal(result.results[0].outcome, 'retry');
  assert.deepEqual(analysisTicks, [clock.value]);
  assert.equal(result.analysis.results[0].outcome, 'done');
  db.close();
});

test('an exploding analyzer is reported but never stops the next sync', async () => {
  const { db, store, agent, errors, clock } = setup({
    naverResults: [{ mode: 'incremental', messages: [], highestUid: 5 }],
    analyzer: { async tick() { throw new Error('analyzer exploded'); } },
  });
  store.registerAccount({ provider: 'naver', address: 'me@naver.com' });

  const first = await agent.tick();
  assert.equal(first.analysis, null);
  assert.deepEqual(errors.map(e => e.message), ['analyzer exploded']);

  // tick이 예외로 끝나지 않았으므로 overlap guard가 풀려 다음 tick이 정상적으로 돈다.
  clock.value += 300;
  const second = await agent.tick();
  assert.equal(second.skipped, false);
  assert.equal(second.results[0].mode, 'incremental');
  db.close();
});

test('an agent with no analyzer keeps working exactly as MAIL-1 did', async () => {
  const { db, store, agent } = setup({
    naverResults: [{ mode: 'incremental', messages: [], highestUid: 5 }],
  });
  store.registerAccount({ provider: 'naver', address: 'me@naver.com' });

  const result = await agent.tick();
  assert.equal(result.analysis, null);
  assert.equal(result.results[0].mode, 'incremental');
  db.close();
});

test('routing and batch flush are isolated from each other and from sync', async () => {
  // 한 단계가 터져도 나머지가 돈다. 라우팅이 죽었다고 batch가 영영 안 닫히면
  // 사용자는 이유 없이 알림을 못 받는다.
  const calls = [];
  const errors = [];
  const { db, store, agent } = setup({
    naverResults: [{ mode: 'incremental', messages: [], highestUid: 5 }],
    analyzer: { async tick() { calls.push('analysis'); return { results: [] }; } },
    pushService: {
      routePending() { calls.push('route'); throw new Error('routing exploded'); },
      flushDueBatches() { calls.push('flush'); return { flushed: 1, empty: 0, created: 2 }; },
    },
  });
  store.registerAccount({ provider: 'naver', address: 'me@naver.com' });
  const agentWithErrors = agent;

  const result = await agentWithErrors.tick();
  assert.deepEqual(calls, ['analysis', 'route', 'flush']);
  assert.equal(result.routing, null, '터진 단계는 값이 없다');
  assert.deepEqual(result.batches, { flushed: 1, empty: 0, created: 2 });
  assert.equal(result.results[0].mode, 'incremental');
  db.close();
});

test('an agent with no push service keeps working as it did before', async () => {
  const { db, store, agent } = setup({
    naverResults: [{ mode: 'incremental', messages: [], highestUid: 5 }],
  });
  store.registerAccount({ provider: 'naver', address: 'me@naver.com' });

  const result = await agent.tick();
  assert.equal(result.routing, null);
  assert.equal(result.batches, null);
  assert.equal(result.results[0].mode, 'incremental');
  db.close();
});
