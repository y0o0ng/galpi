'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createGoogleTokenSource,
  createGmailProvider,
  isCollectableMessage,
} = require('../lib/mail/gmail');

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// 요청 URL을 순서대로 기록하는 최소 fetch 대역.
function createFakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    for (const route of routes) {
      if (route.match(String(url), init)) {
        if (typeof route.reply === 'function') return route.reply(String(url), calls.length);
        return route.reply;
      }
    }
    throw new Error(`대역이 모르는 요청: ${url}`);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function tokenRoute(body = { access_token: 'tok-1', expires_in: 3600 }, status = 200) {
  return { match: url => url.includes('oauth2.googleapis.com/token'), reply: jsonResponse(body, status) };
}

function messageBody(id, { labelIds = ['INBOX'], subject = '제목', internalDate = '1786949400000' } = {}) {
  return {
    id, threadId: `t-${id}`, labelIds, internalDate,
    payload: {
      headers: [
        { name: 'Message-ID', value: `<${id}@mail.gmail.com>` },
        { name: 'From', value: 'AI Trainer <recruit@aitrainer.example.com>' },
        { name: 'To', value: 'me@gmail.com' },
        { name: 'Subject', value: subject },
      ],
    },
  };
}

function createSource(fetchImpl, now = () => 1000) {
  return createGoogleTokenSource({
    credentials: { clientId: 'c', clientSecret: 's', refreshToken: 'r' },
    fetch: fetchImpl,
    now,
  });
}

test('the access token is refreshed ahead of expiry, not after a 401', async () => {
  let now = 1000;
  const fetchImpl = createFakeFetch([tokenRoute({ access_token: 'tok-1', expires_in: 3600 })]);
  const source = createSource(fetchImpl, () => now);

  assert.equal(await source.getAccessToken(), 'tok-1');
  assert.equal(fetchImpl.calls.length, 1);

  // 아직 여유가 있으면 다시 요청하지 않는다.
  now = 1000 + 3600 - 400;
  await source.getAccessToken();
  assert.equal(fetchImpl.calls.length, 1);

  // 만료 5분 전부터는 미리 갈아끼운다. 만료된 뒤 401을 보고 고치지 않는다.
  now = 1000 + 3600 - 200;
  await source.getAccessToken();
  assert.equal(fetchImpl.calls.length, 2);
});

test('overlapping ticks share one refresh instead of hammering google', async () => {
  let resolveToken;
  const fetchImpl = createFakeFetch([{
    match: url => url.includes('/token'),
    reply: new Promise(resolve => { resolveToken = () => resolve(jsonResponse({ access_token: 'tok-1', expires_in: 3600 })); }),
  }]);
  const source = createSource(fetchImpl);

  // 30초 worker tick과 5분 sync가 겹쳐도 refresh 요청은 하나만 나가야 한다.
  const pending = [source.getAccessToken(), source.getAccessToken(), source.getAccessToken()];
  resolveToken();
  const tokens = await Promise.all(pending);

  assert.deepEqual(tokens, ['tok-1', 'tok-1', 'tok-1']);
  assert.equal(fetchImpl.calls.length, 1);
});

test('invalid_grant asks for re-auth instead of being retried forever', async () => {
  const fetchImpl = createFakeFetch([tokenRoute({ error: 'invalid_grant' }, 400)]);
  const source = createSource(fetchImpl);

  // 이것을 네트워크 오류처럼 재시도하면 구글을 계속 때리면서 인증 문제를
  // 사용자에게 영영 알리지 않게 된다.
  await assert.rejects(() => source.getAccessToken(), error => {
    assert.equal(error.code, 'MAIL_AUTH_REQUIRED');
    assert.equal(error.retryable, false);
    return true;
  });
});

test('a 5xx during refresh stays retryable', async () => {
  const fetchImpl = createFakeFetch([tokenRoute({ error: 'backend_error' }, 503)]);
  const source = createSource(fetchImpl);
  await assert.rejects(() => source.getAccessToken(), error => {
    assert.equal(error.code, 'MAIL_TOKEN_REFRESH_FAILED');
    assert.equal(error.retryable, true);
    return true;
  });
});

test('history is collected across every page before the cursor is reported', async () => {
  const fetchImpl = createFakeFetch([
    tokenRoute(),
    {
      match: url => url.includes('/history?') && !url.includes('pageToken'),
      reply: jsonResponse({
        history: [{ messagesAdded: [{ message: { id: 'm1', labelIds: ['INBOX'] } }] }],
        nextPageToken: 'page-2',
        historyId: '111',
      }),
    },
    {
      match: url => url.includes('pageToken=page-2'),
      reply: jsonResponse({
        history: [{ messagesAdded: [{ message: { id: 'm2', labelIds: ['INBOX'] } }] }],
        historyId: '222',
      }),
    },
    { match: url => url.includes('/messages/m1'), reply: jsonResponse(messageBody('m1')) },
    { match: url => url.includes('/messages/m2'), reply: jsonResponse(messageBody('m2')) },
  ]);
  const provider = createGmailProvider({ fetch: fetchImpl, tokenSource: createSource(fetchImpl) });

  const result = await provider.sync({ state: { baselineComplete: 1, gmailHistoryId: '100' } });

  assert.equal(result.pages, 2);
  assert.deepEqual(result.messages.map(m => m.gmailMessageId), ['m1', 'm2']);
  // 커서는 마지막 페이지의 historyId다. 중간 값을 쓰면 나머지 페이지를 영영 건너뛴다.
  assert.equal(result.historyId, '222');

  // 요청에 수집 범위 계약이 실려 있어야 한다.
  const historyCall = fetchImpl.calls.find(c => c.url.includes('/history?'));
  assert.match(historyCall.url, /historyTypes=messageAdded/);
  assert.match(historyCall.url, /labelId=INBOX/);
});

test('mail I sent or drafted never enters the pipeline', () => {
  assert.equal(isCollectableMessage(['INBOX']), true);
  assert.equal(isCollectableMessage(['INBOX', 'IMPORTANT']), true);
  assert.equal(isCollectableMessage(['SENT']), false);
  assert.equal(isCollectableMessage(['DRAFT']), false);
  assert.equal(isCollectableMessage(['INBOX', 'SPAM']), false);
  assert.equal(isCollectableMessage(['INBOX', 'TRASH']), false);
  assert.equal(isCollectableMessage(['CHAT']), false);
  assert.equal(isCollectableMessage([]), false);
});

test('a message whose labels changed after history is dropped on the second check', async () => {
  const fetchImpl = createFakeFetch([
    tokenRoute(),
    {
      match: url => url.includes('/history?'),
      reply: jsonResponse({
        history: [{
          messagesAdded: [
            { message: { id: 'keep', labelIds: ['INBOX'] } },
            { message: { id: 'moved', labelIds: ['INBOX'] } },
          ],
        }],
        historyId: '300',
      }),
    },
    { match: url => url.includes('/messages/keep'), reply: jsonResponse(messageBody('keep')) },
    // history가 준 라벨과 실제 라벨이 어긋난 경우다. 필터 하나에만 기대면 새어 들어온다.
    {
      match: url => url.includes('/messages/moved'),
      reply: jsonResponse(messageBody('moved', { labelIds: ['TRASH'] })),
    },
  ]);
  const provider = createGmailProvider({ fetch: fetchImpl, tokenSource: createSource(fetchImpl) });

  const result = await provider.sync({ state: { baselineComplete: 1, gmailHistoryId: '100' } });
  assert.deepEqual(result.messages.map(m => m.gmailMessageId), ['keep']);
});

test('an expired history cursor resyncs a bounded window instead of failing', async () => {
  const fetchImpl = createFakeFetch([
    tokenRoute(),
    { match: url => url.includes('/history?'), reply: jsonResponse({ error: 'gone' }, 404) },
    { match: url => url.includes('/profile'), reply: jsonResponse({ historyId: '999' }) },
    {
      match: url => url.includes('/messages?'),
      reply: jsonResponse({ messages: [{ id: 'r1' }, { id: 'r2' }] }),
    },
    { match: url => url.includes('/messages/r1'), reply: jsonResponse(messageBody('r1')) },
    { match: url => url.includes('/messages/r2'), reply: jsonResponse(messageBody('r2')) },
  ]);
  const provider = createGmailProvider({
    fetch: fetchImpl, tokenSource: createSource(fetchImpl), recentWindow: 50,
  });

  const result = await provider.sync({ state: { baselineComplete: 1, gmailHistoryId: '100' } });

  assert.equal(result.reason, 'HISTORY_GONE');
  assert.equal(result.historyId, '999');
  assert.deepEqual(result.messages.map(m => m.gmailMessageId), ['r1', 'r2']);
  // 전체 메일함이 아니라 최근 구간만 다시 읽는다.
  assert.match(fetchImpl.calls.find(c => c.url.includes('/messages?')).url, /maxResults=50/);
});

test('the first sync takes the current cursor without replaying the past as new mail', async () => {
  const fetchImpl = createFakeFetch([
    tokenRoute(),
    { match: url => url.includes('/profile'), reply: jsonResponse({ historyId: '500' }) },
    { match: url => url.includes('/messages?'), reply: jsonResponse({ messages: [{ id: 'b1' }] }) },
    { match: url => url.includes('/messages/b1'), reply: jsonResponse(messageBody('b1')) },
  ]);
  const provider = createGmailProvider({ fetch: fetchImpl, tokenSource: createSource(fetchImpl) });

  const result = await provider.sync({ state: { baselineComplete: 0 } });
  assert.equal(result.mode, 'baseline');
  assert.equal(result.historyId, '500');
  // history를 부르지 않는다. 커서가 없으니 부를 수도 없다.
  assert.equal(fetchImpl.calls.some(c => c.url.includes('/history?')), false);
});

test('a normalized message keeps the headers the store needs', async () => {
  const fetchImpl = createFakeFetch([
    tokenRoute(),
    {
      match: url => url.includes('/history?'),
      reply: jsonResponse({
        history: [{ messagesAdded: [{ message: { id: 'm1', labelIds: ['INBOX'] } }] }],
        historyId: '2',
      }),
    },
    {
      match: url => url.includes('/messages/m1'),
      reply: jsonResponse(messageBody('m1', { subject: '면접 가능 시간 선택 요청' })),
    },
  ]);
  const provider = createGmailProvider({ fetch: fetchImpl, tokenSource: createSource(fetchImpl) });

  const [message] = (await provider.sync({ state: { baselineComplete: 1, gmailHistoryId: '1' } })).messages;
  assert.equal(message.subject, '면접 가능 시간 선택 요청');
  assert.equal(message.from.name, 'AI Trainer');
  assert.equal(message.from.address, 'recruit@aitrainer.example.com');
  assert.deepEqual(message.to, ['me@gmail.com']);
  assert.equal(message.threadId, 't-m1');
  // internalDate는 밀리초 문자열이다. 저장은 epoch seconds다.
  assert.equal(message.receivedAt, 1786949400);

  // metadata 요청에 우리가 쓰는 헤더가 실려 있어야 한다.
  const call = fetchImpl.calls.find(c => c.url.includes('/messages/m1'));
  assert.match(call.url, /format=metadata/);
  assert.match(call.url, /metadataHeaders=Message-ID/);
});

test('fetching a raw body asks for format=raw and comes back as bytes', async () => {
  const raw = Buffer.from('Subject: 원문\r\n\r\n본문입니다\r\n', 'utf8');
  const fetchImpl = createFakeFetch([
    tokenRoute(),
    {
      match: url => url.includes('/messages/m1'),
      reply: jsonResponse({ id: 'm1', labelIds: ['INBOX'], raw: raw.toString('base64url') }),
    },
  ]);
  const provider = createGmailProvider({ fetch: fetchImpl, tokenSource: createSource(fetchImpl) });

  const body = await provider.fetchRaw('m1');
  assert.ok(body.raw.equals(raw));
  assert.deepEqual(body.labels, ['INBOX']);
  assert.match(fetchImpl.calls.at(-1).url, /format=raw/);
});

test('a mail moved to trash after we stored it is refused instead of analyzed', async () => {
  const fetchImpl = createFakeFetch([
    tokenRoute(),
    {
      match: url => url.includes('/messages/m1'),
      reply: jsonResponse({ id: 'm1', labelIds: ['TRASH'], raw: 'aGk=' }),
    },
  ]);
  const provider = createGmailProvider({ fetch: fetchImpl, tokenSource: createSource(fetchImpl) });

  await assert.rejects(() => provider.fetchRaw('m1'), error => error.code === 'MAIL_MESSAGE_EXCLUDED');
});

test('a deleted message is a message-level 404, not an expired history cursor', async () => {
  // 같은 404를 커서 만료로 읽으면 재분석 실패 하나가 계정 전체 resync를 부른다.
  const fetchImpl = createFakeFetch([
    tokenRoute(),
    { match: url => url.includes('/messages/m1'), reply: jsonResponse({}, 404) },
  ]);
  const provider = createGmailProvider({ fetch: fetchImpl, tokenSource: createSource(fetchImpl) });

  await assert.rejects(() => provider.fetchRaw('m1'), error => error.code === 'MAIL_MESSAGE_GONE');
});
