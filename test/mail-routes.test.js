'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { registerMailRoutes } = require('../lib/mail/routes');

// Express 없이 등록된 핸들러만 꺼내 쓰는 최소 대역.
function createFakeApp() {
  const routes = new Map();
  return {
    get(path, handler) { routes.set(`GET ${path}`, handler); },
    post(path, handler) { routes.set(`POST ${path}`, handler); },
    put(path, handler) { routes.set(`PUT ${path}`, handler); },
    async call(key, req = {}) {
      req.params = req.params || {};
      const handler = routes.get(key);
      if (!handler) throw new Error(`등록되지 않은 route: ${key}`);
      let status = 200;
      let body = null;
      const res = {
        status(code) { status = code; return res; },
        json(payload) { body = payload; return res; },
      };
      await handler(req, res);
      return { status, body };
    },
    has(key) { return routes.has(key); },
  };
}

const EMPTY_ANALYSIS = { pending: 0, analyzing: 0, done: 0, failed: 0, skipped: 0 };

function createFakeStore(accounts = [], states = new Map(), overrides = {}) {
  return {
    listAccounts: () => accounts,
    getSyncState: id => states.get(id) || null,
    countMessages: () => 3,
    analysisSummary: () => EMPTY_ANALYSIS,
    listStrandedAnalysis: () => [],
    requeueFailedAnalysis: () => 0,
    getMailSettings: () => ({
      notificationsEnabled: true,
      quietHours: { enabled: true, start: '23:00', end: '07:00' },
    }),
    saveMailSettings: patch => ({
      notificationsEnabled: true,
      quietHours: { enabled: true, start: '23:00', end: '07:00' },
      ...patch,
    }),
    findAttentionById: () => ({ id: 1, state: 'open', notifySeq: 1, snoozedUntil: null }),
    resolveAttention: () => ({ changed: true, state: 'done' }),
    snoozeAttention: (id, until) => ({ changed: true, state: 'snoozed', snoozedUntil: until }),
    ...overrides,
  };
}

test('the status route stays closed while the flag is off', async () => {
  const app = createFakeApp();
  registerMailRoutes({ app, store: createFakeStore(), config: { enabled: false } });

  const response = await app.call('GET /api/mail/status');
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'MAIL_AGENT_DISABLED');
});

test('the status route reports each account cursor without touching mail content', async () => {
  const app = createFakeApp();
  const accounts = [{
    id: 1, provider: 'naver', address: 'me@naver.com', status: 'active',
    lastSyncAt: 1786949400, nextSyncAt: 1786949700, lastErrorCode: null,
  }];
  const states = new Map([[1, {
    baselineComplete: 1, gmailHistoryId: null, imapUidValidity: '0', imapLastUid: 16600,
  }]]);
  registerMailRoutes({
    app, store: createFakeStore(accounts, states), config: { enabled: true },
  });

  const response = await app.call('GET /api/mail/status');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.accounts, [{
    id: 1,
    provider: 'naver',
    address: 'me@naver.com',
    status: 'active',
    lastSyncAt: 1786949400,
    nextSyncAt: 1786949700,
    lastErrorCode: null,
    baselineComplete: true,
    gmailHistoryId: null,
    imapUidValidity: '0',
    imapLastUid: 16600,
    messages: 3,
  }]);

  // 상태 화면은 커서와 개수만 본다. 제목·발신자는 이 경로로 나가지 않는다.
  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.includes('subject'), false);
  assert.equal(serialized.includes('sender'), false);
});

test('a store failure answers with a code instead of leaking the error', async () => {
  const app = createFakeApp();
  const store = createFakeStore([], new Map(), {
    listAccounts() { throw Object.assign(new Error('디스크에 me@naver.com 기록 실패'), { code: 'SQLITE_IOERR' }); },
  });
  registerMailRoutes({ app, store, config: { enabled: true } });

  const response = await app.call('GET /api/mail/status');
  assert.equal(response.status, 500);
  assert.equal(response.body.code, 'MAIL_STATUS_FAILED');
  // 원문 메시지에는 주소가 섞일 수 있다. 응답으로 흘리지 않는다.
  assert.equal(JSON.stringify(response.body).includes('me@naver.com'), false);
});

test('registration refuses a half-built wiring instead of failing at request time', () => {
  const app = createFakeApp();
  assert.throws(() => registerMailRoutes({ app, store: null, config: {} }), /Mail store/);
  assert.throws(() => registerMailRoutes({ app, store: createFakeStore(), config: null }), /Mail 설정/);
  assert.equal(app.has('GET /api/mail/status'), false);
});

test('the requeue route stays closed while the flag is off', async () => {
  const app = createFakeApp();
  registerMailRoutes({ app, store: createFakeStore(), config: { enabled: false } });

  const response = await app.call('POST /api/mail/analysis/requeue');
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'MAIL_AGENT_DISABLED');
});

test('requeueing stranded analysis wakes the worker instead of waiting a cycle', async () => {
  const app = createFakeApp();
  let woken = 0;
  const store = createFakeStore([], new Map(), { requeueFailedAnalysis: () => 4 });
  registerMailRoutes({ app, store, config: { enabled: true }, onRequeued: () => { woken += 1; } });

  const response = await app.call('POST /api/mail/analysis/requeue');
  assert.equal(response.status, 200);
  assert.equal(response.body.requeued, 4);
  assert.equal(woken, 1);
});

test('requeueing nothing does not wake the worker', async () => {
  const app = createFakeApp();
  let woken = 0;
  registerMailRoutes({
    app, store: createFakeStore(), config: { enabled: true }, onRequeued: () => { woken += 1; },
  });

  const response = await app.call('POST /api/mail/analysis/requeue');
  assert.equal(response.body.requeued, 0);
  assert.equal(woken, 0);
});

test('the status route surfaces stranded analysis as a count and a code, not as mail content', async () => {
  const app = createFakeApp();
  const store = createFakeStore([], new Map(), {
    analysisSummary: () => ({ pending: 2, analyzing: 1, done: 9, failed: 3, skipped: 4 }),
    listStrandedAnalysis: () => [
      { id: 12, accountId: 1, attemptCount: 5, lastError: 'MAIL_LLM_FAILED', receivedAt: 1786949400 },
    ],
  });
  registerMailRoutes({ app, store, config: { enabled: true } });

  const response = await app.call('GET /api/mail/status');
  assert.equal(response.body.analysis.failed, 3);
  assert.deepEqual(response.body.stranded, [
    { id: 12, accountId: 1, attemptCount: 5, lastError: 'MAIL_LLM_FAILED', receivedAt: 1786949400 },
  ]);
  // 좌초 목록도 제목·발신자를 싣지 않는다. 사람이 할 수 있는 일은 다시 돌리는 것뿐이다.
  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.includes('subject'), false);
  assert.equal(serialized.includes('sender'), false);
});

test('attention actions stay closed while the flag is off', async () => {
  const app = createFakeApp();
  registerMailRoutes({ app, store: createFakeStore(), config: { enabled: false } });

  for (const key of ['POST /api/mail/attention/:id/done', 'POST /api/mail/attention/:id/snooze']) {
    const response = await app.call(key, { params: { id: '1' } });
    assert.equal(response.status, 503);
    assert.equal(response.body.code, 'MAIL_AGENT_DISABLED');
  }
});

test('done is idempotent and reports what actually changed', async () => {
  const app = createFakeApp();
  const store = createFakeStore([], new Map(), {
    resolveAttention: () => ({ changed: false, state: 'done' }),
  });
  registerMailRoutes({ app, store, config: { enabled: true } });

  const response = await app.call('POST /api/mail/attention/:id/done', { params: { id: '7' } });
  assert.equal(response.status, 200);
  // 두 번 눌러도 오류가 아니다. 바뀐 것이 없다는 사실만 알린다.
  assert.deepEqual(response.body, { success: true, changed: false, state: 'done' });
});

test('an unknown attention is a 404, not a silent success', async () => {
  const app = createFakeApp();
  registerMailRoutes({
    app, store: createFakeStore([], new Map(), { findAttentionById: () => null }), config: { enabled: true },
  });

  const response = await app.call('POST /api/mail/attention/:id/done', { params: { id: '99' } });
  assert.equal(response.status, 404);
  assert.equal(response.body.code, 'MAIL_ATTENTION_NOT_FOUND');
});

test('a bad id is refused before the store is touched', async () => {
  const app = createFakeApp();
  let looked = 0;
  registerMailRoutes({
    app,
    store: createFakeStore([], new Map(), { findAttentionById: () => { looked += 1; return null; } }),
    config: { enabled: true },
  });

  for (const id of ['0', '-1', 'abc', '']) {
    const response = await app.call('POST /api/mail/attention/:id/done', { params: { id } });
    assert.equal(response.status, 400, id);
    assert.equal(response.body.code, 'MAIL_INVALID_ATTENTION');
  }
  assert.equal(looked, 0);
});

test('snoozing something already finished is a conflict, not a quiet no-op', async () => {
  const app = createFakeApp();
  registerMailRoutes({
    app,
    store: createFakeStore([], new Map(), {
      snoozeAttention: () => ({ changed: false, state: 'done' }),
    }),
    config: { enabled: true },
  });

  const response = await app.call('POST /api/mail/attention/:id/snooze', {
    params: { id: '3' }, body: { until: 1787000000 },
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'MAIL_ATTENTION_NOT_SNOOZABLE');
  assert.equal(response.body.state, 'done');
});

test('a snooze time the store refuses comes back as the store said', async () => {
  const app = createFakeApp();
  registerMailRoutes({
    app,
    store: createFakeStore([], new Map(), {
      snoozeAttention: () => {
        const error = new Error('snooze 시각은 현재보다 뒤여야 합니다.');
        error.code = 'MAIL_INVALID_SNOOZE';
        error.statusCode = 400;
        throw error;
      },
    }),
    config: { enabled: true },
  });

  const response = await app.call('POST /api/mail/attention/:id/snooze', {
    params: { id: '3' }, body: { until: 1 },
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'MAIL_INVALID_SNOOZE');
});
