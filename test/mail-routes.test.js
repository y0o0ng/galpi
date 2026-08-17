'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { registerMailRoutes } = require('../lib/mail/routes');

// Express 없이 등록된 핸들러만 꺼내 쓰는 최소 대역.
function createFakeApp() {
  const routes = new Map();
  return {
    get(path, handler) { routes.set(`GET ${path}`, handler); },
    async call(key, req = {}) {
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

function createFakeStore(accounts = [], states = new Map()) {
  return {
    listAccounts: () => accounts,
    getSyncState: id => states.get(id) || null,
    countMessages: () => 3,
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
  const store = {
    listAccounts() { throw Object.assign(new Error('디스크에 me@naver.com 기록 실패'), { code: 'SQLITE_IOERR' }); },
    getSyncState: () => null,
    countMessages: () => 0,
  };
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
