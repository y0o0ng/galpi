'use strict';

// 본문을 여는 읽기 경로 (설계 10.2·23).
//
// 잠그는 것은 넷이다.
// 1. 본문을 저장하지 않는다 — store에는 좌표를 묻기만 한다.
// 2. 분석과 같은 경로·같은 상한을 쓴다. 화면과 판단이 다른 텍스트를 보지 않는다.
// 3. 계정 상태가 나쁘면 Provider를 부르지 않고 코드로 끝난다.
// 4. 한 계정에서 동시에 하나만 읽는다.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createMailBodyReader } = require('../lib/mail/body');
const { DEFAULT_MAX_BODY_CHARS } = require('../lib/mail/normalize');

const RAW = Buffer.from([
  'From: 교무팀 <notice@korea.ac.kr>',
  'To: me@korea.ac.kr',
  'Subject: =?UTF-8?B?7IiY6rCV7Iug7LKt?=',
  'Content-Type: text/plain; charset=utf-8',
  '',
  '정정 기간은 8월 21일까지입니다.',
  '',
  '-- ',
  '교무팀 드림',
].join('\r\n'));

function createReader(overrides = {}) {
  const calls = [];
  const locator = overrides.locator === undefined ? {
    id: 7, accountId: 3, provider: 'works',
    accountAddress: 'me@korea.ac.kr', accountStatus: 'active',
    gmailMessageId: null, imapUid: 4211, imapUidValidity: '7',
  } : overrides.locator;
  const store = {
    findMessageLocator(id) {
      calls.push(['findMessageLocator', id]);
      return locator;
    },
  };
  const providers = overrides.providers || {
    works: {
      fetchRaw(target, options) {
        calls.push(['fetchRaw', target, options]);
        return overrides.raw !== undefined ? overrides.raw : RAW;
      },
    },
  };
  const reader = createMailBodyReader({
    store, providers, credentials: account => ({ user: account.address }),
    ...(overrides.maxBodyChars ? { maxBodyChars: overrides.maxBodyChars } : {}),
  });
  return { reader, calls, store };
}

test('an open reads the mail through the locator and hands back text, never a stored body', async () => {
  const { reader, calls, store } = createReader();
  const result = await reader.read(7);

  assert.match(result.body, /정정 기간은 8월 21일까지입니다/);
  assert.equal(result.bodySource, 'text');
  assert.equal(result.truncated, false);
  // store에 쓰는 경로가 없다. 있는 것은 좌표를 묻는 읽기 하나뿐이다(설계 23).
  assert.deepEqual(Object.keys(store), ['findMessageLocator']);
  assert.deepEqual(calls[0], ['findMessageLocator', 7]);
  // IMAP provider에는 UID 좌표가, 자격증명은 계정 주소로 풀려서 간다.
  assert.deepEqual(calls[1][1], { imapUid: 4211, imapUidValidity: '7' });
  assert.deepEqual(calls[1][2], { credentials: { user: 'me@korea.ac.kr' } });
});

test('gmail is read by its message id and unwrapped from the provider envelope', async () => {
  const seen = [];
  const { reader } = createReader({
    locator: {
      id: 9, accountId: 1, provider: 'gmail',
      accountAddress: 'me@gmail.com', accountStatus: 'active',
      gmailMessageId: '18f9', imapUid: null, imapUidValidity: null,
    },
    providers: {
      gmail: {
        fetchRaw(id) {
          seen.push(id);
          // Gmail provider는 라벨과 함께 봉투로 준다. IMAP은 버퍼 그대로다.
          return { raw: RAW, labels: ['INBOX'] };
        },
      },
    },
  });

  const result = await reader.read(9);
  assert.deepEqual(seen, ['18f9']);
  assert.match(result.body, /정정 기간/);
});

test('the screen sees the same cap the judgement saw', async () => {
  const long = Buffer.from([
    'Subject: long',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'ㄱ'.repeat(DEFAULT_MAX_BODY_CHARS + 500),
  ].join('\r\n'));
  const { reader } = createReader({ raw: long });

  const result = await reader.read(7);
  // 새 상한을 만들지 않는다. 만들면 화면과 판단이 다른 텍스트를 본다.
  assert.equal(result.body.length, DEFAULT_MAX_BODY_CHARS);
  assert.equal(result.truncated, true);
  assert.ok(result.bodyLength > DEFAULT_MAX_BODY_CHARS);
});

test('attachments come back as names and sizes, not as files to open', async () => {
  const withFile = Buffer.from([
    'Subject: notice',
    'Content-Type: multipart/mixed; boundary=x',
    '',
    '--x',
    'Content-Type: text/plain; charset=utf-8',
    '',
    '첨부를 확인해주세요.',
    '--x',
    'Content-Type: application/pdf; name="notice.pdf"',
    'Content-Disposition: attachment; filename="notice.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from('pdf-bytes').toString('base64'),
    '--x--',
  ].join('\r\n'));
  const { reader } = createReader({ raw: withFile });

  const result = await reader.read(7);
  assert.deepEqual(result.attachments, [{ filename: 'notice.pdf', size: 9 }]);
});

test('a dead account is answered from the row, without touching the provider', async () => {
  for (const [status, code] of [['disabled', 'MAIL_ACCOUNT_DISABLED'], ['auth_required', 'MAIL_ACCOUNT_AUTH_REQUIRED']]) {
    const { reader, calls } = createReader({
      locator: {
        id: 7, accountId: 3, provider: 'works', accountAddress: 'me@korea.ac.kr',
        accountStatus: status, imapUid: 1, imapUidValidity: '1', gmailMessageId: null,
      },
    });
    await assert.rejects(() => reader.read(7), error => {
      assert.equal(error.code, code);
      assert.equal(error.statusCode, 409);
      return true;
    });
    assert.equal(calls.some(call => call[0] === 'fetchRaw'), false, status);
  }
});

test('a mail that is not there is a bounded error, not a provider call', async () => {
  const { reader, calls } = createReader({ locator: null });
  await assert.rejects(() => reader.read(404), error => {
    assert.equal(error.code, 'MAIL_MESSAGE_NOT_FOUND');
    assert.equal(error.statusCode, 404);
    return true;
  });
  assert.equal(calls.some(call => call[0] === 'fetchRaw'), false);
});

test('one account opens one body at a time, so a double tap does not open two connections', async () => {
  const pending = [];
  const { reader } = createReader({
    providers: {
      works: {
        fetchRaw() {
          return new Promise(resolve => pending.push(() => resolve(RAW)));
        },
      },
    },
  });

  const first = reader.read(7);
  await assert.rejects(() => reader.read(7), error => {
    assert.equal(error.code, 'MAIL_BODY_BUSY');
    assert.equal(error.statusCode, 429);
    return true;
  });
  assert.equal(pending.length, 1, '두 번째 누름이 연결을 하나 더 열지 않는다');

  pending[0]();
  await first;

  // 끝나면 자리를 돌려준다. 한 번 막힌 계정이 영영 막히면 그게 더 나쁜 고장이다.
  const second = reader.read(7);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 2);
  pending[1]();
  await second;
});
