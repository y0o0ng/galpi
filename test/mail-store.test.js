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

test('a second account for the same provider is refused with a readable reason', () => {
  const { db, store } = createStore();
  const first = store.registerAccount({ provider: 'naver', address: 'me@naver.com' });

  // 자격증명이 provider당 한 세트라 두 번째 계정은 결국 첫 계정의 사서함을 읽는다.
  // v1 범위는 Gmail 1 + Naver 1이다.
  assert.throws(
    () => store.registerAccount({ provider: 'naver', address: 'other@naver.com' }),
    error => {
      assert.equal(error.code, 'MAIL_PROVIDER_ACCOUNT_LIMIT');
      assert.match(error.message, /me@naver\.com/);
      return true;
    },
  );

  // 같은 주소를 다시 등록하는 것은 여전히 멱등이다.
  assert.equal(store.registerAccount({ provider: 'naver', address: 'me@naver.com' }).id, first.id);

  // 다른 provider는 막히지 않는다. 둘을 합쳐 최대 두 계정이다.
  const gmail = store.registerAccount({ provider: 'gmail', address: 'me@gmail.com' });
  assert.equal(store.listAccounts().length, 2);

  // store를 우회해도 DB가 막는다.
  assert.throws(() => db.prepare(`
    INSERT INTO mail_accounts (provider, address) VALUES ('gmail', 'sneaky@gmail.com')
  `).run(), /UNIQUE/);
  void gmail;
  db.close();
});

test('re-enabling an account retries now instead of waiting out the old schedule', () => {
  const { db, store, clock } = createStore(1000);
  const account = store.registerAccount({ provider: 'gmail', address: 'me@gmail.com' });

  store.markAccountError(account.id, {
    status: 'auth_required', errorCode: 'MAIL_AUTH_REQUIRED', nextSyncAt: 1300,
  }, 1000);
  assert.equal(store.claimAuthAlert(account.id, 1000), true);

  clock.value = 1100;
  store.setAccountStatus(account.id, 'active');

  const reenabled = store.getAccount(account.id);
  // 자격증명을 고치고 되살렸는데 옛 일정 때문에 몇 분을 더 기다리면, 고쳐진 건지
  // 아직 깨진 건지 사람이 알 수 없다. 지금 다시 시도한다.
  assert.equal(reenabled.status, 'active');
  assert.equal(reenabled.nextSyncAt, 1100);
  assert.deepEqual(store.listDueAccounts(1100).map(a => a.id), [account.id]);

  // 지난 실패의 흔적도 함께 지운다. 남겨두면 성공할 때까지 화면이 옛 오류를 보여준다.
  assert.equal(reenabled.lastErrorCode, null);
  assert.equal(reenabled.authAlertSentAt, null);

  // 끄는 방향은 일정을 건드리지 않는다. 다시 켤 때 판단하면 된다.
  store.setAccountStatus(account.id, 'disabled');
  assert.equal(store.getAccount(account.id).nextSyncAt, 1100);
  db.close();
});

// ── 분석 큐 (설계 9.2) ────────────────────────────────────────────────────────

function seedMessage(store, account, overrides = {}) {
  return store.saveMessage({
    accountId: account.id,
    identityKind: 'rfc_message_id',
    identityKey: `<${overrides.key || 'a'}@example.com>`,
    imapUid: 100,
    imapUidValidity: '0',
    receivedAt: 1786949400,
    subject: '면접 일정',
    ...overrides,
  }).message;
}

test('a claim is atomic, so two overlapping workers never take the same mail', () => {
  const { db, store, clock } = createStore();
  const account = store.registerAccount({ provider: 'naver', address: 'me@naver.com' });
  seedMessage(store, account, { key: 'one' });

  const first = store.claimAnalysisJobs(clock.value, { limit: 5 });
  const second = store.claimAnalysisJobs(clock.value, { limit: 5 });

  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  assert.equal(first[0].attemptCount, 1);
  assert.equal(first[0].leaseUntil, clock.value + 180);
  assert.equal(first[0].provider, 'naver');
  assert.equal(first[0].imapUid, 100);
  db.close();
});

test('a worker killed mid-analysis loses its lease and the mail comes back', () => {
  const { db, store, clock } = createStore();
  const account = store.registerAccount({ provider: 'naver', address: 'me@naver.com' });
  seedMessage(store, account, { key: 'crash' });

  const [claimed] = store.claimAnalysisJobs(clock.value, { leaseSeconds: 60 });
  assert.equal(store.analysisSummary().analyzing, 1);

  // 여기서 프로세스가 죽었다고 친다. lease가 끝나기 전에는 아무도 못 집는다.
  clock.value += 59;
  assert.equal(store.claimAnalysisJobs(clock.value).length, 0);

  clock.value += 2;
  const [again] = store.claimAnalysisJobs(clock.value);
  assert.equal(again.id, claimed.id);
  assert.equal(again.attemptCount, 2);

  // 회수된 뒤 늦게 돌아온 옛 worker는 남의 판단을 덮지 못한다.
  const stale = store.completeAnalysis(claimed.id, {
    leaseUntil: claimed.leaseUntil, category: 'info', notificationMode: 'silent',
  }, clock.value);
  assert.equal(stale.settled, false);
  assert.equal(store.analysisSummary().analyzing, 1);
  db.close();
});

test('retryable failures back off and the cap ends in failed, not in a silent drop', () => {
  const { db, store, clock } = createStore();
  const account = store.registerAccount({ provider: 'naver', address: 'me@naver.com' });
  const message = seedMessage(store, account, { key: 'flaky' });

  const backoffs = [];
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const [job] = store.claimAnalysisJobs(clock.value);
    assert.equal(job.attemptCount, attempt);
    const outcome = store.failAnalysis(job.id, {
      leaseUntil: job.leaseUntil,
      errorCode: 'MAIL_LLM_FAILED',
      attemptCount: job.attemptCount,
    }, clock.value);
    assert.equal(outcome.changed, true);
    if (attempt < 5) {
      assert.equal(outcome.state, 'pending');
      backoffs.push(outcome.nextAttemptAt - clock.value);
      // backoff가 지나기 전에는 후보가 아니다.
      assert.equal(store.claimAnalysisJobs(clock.value).length, 0);
      clock.value = outcome.nextAttemptAt;
    } else {
      assert.equal(outcome.state, 'failed');
    }
  }

  assert.deepEqual(backoffs, [60, 120, 240, 480]);
  assert.equal(store.analysisSummary().failed, 1);

  // failed는 버린 것이 아니라 사람이 보는 상태다. 되돌리면 시도 횟수도 같이 풀린다.
  const stranded = store.listStrandedAnalysis();
  assert.equal(stranded.length, 1);
  assert.equal(stranded[0].id, message.id);
  assert.equal(stranded[0].attemptCount, 5);
  assert.equal(stranded[0].lastError, 'MAIL_LLM_FAILED');

  assert.equal(store.requeueFailedAnalysis(clock.value), 1);
  const [revived] = store.claimAnalysisJobs(clock.value);
  assert.equal(revived.id, message.id);
  assert.equal(revived.attemptCount, 1);
  db.close();
});

test('a finished judgement carries its provenance and its attention in one transaction', () => {
  const { db, store, clock } = createStore();
  const account = store.registerAccount({ provider: 'gmail', address: 'me@gmail.com' });
  seedMessage(store, account, { key: 'interview', threadId: 't-1' });

  const [job] = store.claimAnalysisJobs(clock.value);
  const result = store.completeAnalysis(job.id, {
    leaseUntil: job.leaseUntil,
    analyzerModel: 'gpt-5.6-luna',
    analyzerPromptVersion: 'mail-analysis-v1',
    category: 'action_required',
    importance: 0.91,
    summary: '면접 가능 시간 선택 요청',
    actionText: '8월 19일까지 가능한 면접 시간을 회신해야 함',
    deadlineKind: 'date',
    deadlineDate: '2026-08-19',
    notificationMode: 'immediate',
    decisionReason: '채용 관련 메일이며 명시된 기한이 존재함',
    decisionConfidence: 0.92,
    attentionReason: 'action_required',
    threadRef: 't-1',
  }, clock.value);

  assert.equal(result.settled, true);
  assert.equal(result.attention.reasonKind, 'action_required');
  assert.equal(result.attention.state, 'open');
  assert.equal(result.attention.threadRef, 't-1');
  assert.equal(result.attention.notifySeq, 1);

  const row = db.prepare('SELECT * FROM mail_messages WHERE id = ?').get(job.id);
  assert.equal(row.analysis_state, 'done');
  assert.equal(row.analysis_lease_until, null);
  assert.equal(row.analyzer_model, 'gpt-5.6-luna');
  assert.equal(row.analyzer_prompt_version, 'mail-analysis-v1');
  assert.equal(row.analyzed_at, clock.value);
  // 날짜만 말한 메일에 23:59를 만들어 붙이지 않는다.
  assert.equal(row.deadline_kind, 'date');
  assert.equal(row.deadline_date, '2026-08-19');
  assert.equal(row.deadline_at, null);
  db.close();
});

test('a datetime deadline stores an epoch and never a bare date', () => {
  const { db, store, clock } = createStore();
  const account = store.registerAccount({ provider: 'gmail', address: 'me@gmail.com' });
  seedMessage(store, account, { key: 'meeting' });

  const [job] = store.claimAnalysisJobs(clock.value);
  store.completeAnalysis(job.id, {
    leaseUntil: job.leaseUntil,
    category: 'important',
    notificationMode: 'batch',
    deadlineKind: 'datetime',
    // 모델이 날짜 문자열을 함께 보내도 datetime 행에는 들어가지 않는다.
    deadlineDate: '2026-08-19',
    deadlineAt: 1787184000,
  }, clock.value);

  const row = db.prepare('SELECT * FROM mail_messages WHERE id = ?').get(job.id);
  assert.equal(row.deadline_kind, 'datetime');
  assert.equal(row.deadline_date, null);
  assert.equal(row.deadline_at, 1787184000);
  db.close();
});

test('a category or attention reason the schema does not know is refused before the write', () => {
  const { db, store, clock } = createStore();
  const account = store.registerAccount({ provider: 'gmail', address: 'me@gmail.com' });
  seedMessage(store, account, { key: 'bogus' });
  const [job] = store.claimAnalysisJobs(clock.value);

  assert.throws(
    () => store.completeAnalysis(job.id, { leaseUntil: job.leaseUntil, category: 'spam' }, clock.value),
    /category/,
  );
  assert.throws(
    () => store.completeAnalysis(job.id, { leaseUntil: job.leaseUntil, notificationMode: 'shout' }, clock.value),
    /알림 모드/,
  );
  assert.throws(
    () => store.completeAnalysis(job.id, { leaseUntil: job.leaseUntil, attentionReason: 'because' }, clock.value),
    /Attention/,
  );
  // 거부됐으므로 lease는 그대로다. 다음 정산이 여전히 가능하다.
  assert.equal(store.analysisSummary().analyzing, 1);
  db.close();
});

test('a mail that turned out not to be ours is skipped, not stranded', () => {
  const { db, store, clock } = createStore();
  const account = store.registerAccount({ provider: 'gmail', address: 'me@gmail.com' });
  seedMessage(store, account, { key: 'trashed' });

  const [job] = store.claimAnalysisJobs(clock.value);
  assert.equal(store.skipAnalysis(job.id, {
    leaseUntil: job.leaseUntil, errorCode: 'MAIL_MESSAGE_EXCLUDED',
  }, clock.value), true);

  const summary = store.analysisSummary();
  assert.equal(summary.skipped, 1);
  assert.equal(summary.failed, 0);
  // 되살리기는 failed만 건드린다. 의도적으로 건너뛴 것을 다시 큐에 넣지 않는다.
  assert.equal(store.requeueFailedAnalysis(clock.value), 0);
  db.close();
});

test('an account that is not active never lets the analysis worker touch its provider', () => {
  // 인증이 끊긴 계정의 pending을 계속 집으면 매 tick 실패하며 재시도 상한을 태우고
  // 좌초로 남는다. 사람이 할 일은 재인증인데 화면에는 분석 실패로 보인다.
  for (const status of ['auth_required', 'disabled', 'error']) {
    const { db, store, clock } = createStore();
    const account = store.registerAccount({ provider: 'naver', address: 'me@naver.com' });
    const message = seedMessage(store, account, { key: status });

    store.setAccountStatus(account.id, status, clock.value);
    assert.deepEqual(store.claimAnalysisJobs(clock.value), [], `${status}: 집으면 안 된다`);

    // 행은 버리지도 실패시키지도 않는다. 그대로 pending으로 기다린다.
    const row = db.prepare('SELECT * FROM mail_messages WHERE id = ?').get(message.id);
    assert.equal(row.analysis_state, 'pending', status);
    assert.equal(row.analysis_attempt_count, 0, `${status}: 시도 횟수를 태우지 않는다`);
    assert.equal(store.analysisSummary().pending, 1, status);

    // 다시 켜면 별도 장치 없이 그 자리에서 재개된다.
    store.setAccountStatus(account.id, 'active', clock.value);
    const [claimed] = store.claimAnalysisJobs(clock.value);
    assert.equal(claimed.id, message.id, status);
    assert.equal(claimed.attemptCount, 1, status);
    db.close();
  }
});

test('one dead account does not stop analysis for a healthy one', () => {
  const { db, store, clock } = createStore();
  const naver = store.registerAccount({ provider: 'naver', address: 'me@naver.com' });
  const gmail = store.registerAccount({ provider: 'gmail', address: 'me@gmail.com' });
  const stuck = seedMessage(store, naver, { key: 'stuck' });
  const healthy = seedMessage(store, gmail, { key: 'healthy' });

  store.setAccountStatus(naver.id, 'auth_required', clock.value);
  const claimed = store.claimAnalysisJobs(clock.value, { limit: 5 });

  assert.deepEqual(claimed.map(job => job.id), [healthy.id]);
  assert.equal(
    db.prepare('SELECT analysis_state AS s FROM mail_messages WHERE id = ?').get(stuck.id).s,
    'pending',
  );
  db.close();
});
