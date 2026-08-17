'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SYNC_MODES,
  planImapSync,
  fetchMailbox,
  createNaverProvider,
} = require('../lib/mail/naver');

// 실제 서버 없이 커서 판정을 검증하기 위한 최소 IMAP 대역. ImapFlow에서 우리가
// 실제로 쓰는 표면(getMailboxLock / mailbox / fetch / download)만 흉내낸다.
function createFakeClient({ mailbox, messages = [], onFetch } = {}) {
  const calls = { locks: [], fetches: [], downloads: [], connected: 0, loggedOut: 0 };
  return {
    calls,
    mailbox: null,
    async connect() { calls.connected += 1; },
    async logout() { calls.loggedOut += 1; },
    async getMailboxLock(path, options) {
      calls.locks.push({ path, options });
      this.mailbox = { ...mailbox };
      return { release: async () => { calls.locks.at(-1).released = true; } };
    },
    fetch(range, query, options) {
      calls.fetches.push({ range, query, options });
      if (onFetch) onFetch(range, query, options);
      const rows = messages;
      return (async function* generate() {
        for (const row of rows) yield row;
      })();
    },
    async download(uid) {
      calls.downloads.push(uid);
      return {
        content: (async function* generate() {
          yield Buffer.from(`raw-body-of-${uid}`, 'latin1');
        })(),
      };
    },
  };
}

function envelopeRow(uid, overrides = {}) {
  return {
    uid,
    size: 1024,
    envelope: {
      messageId: `<mail-${uid}@example.com>`,
      subject: `제목 ${uid}`,
      date: new Date('2026-08-17T09:12:33+09:00'),
      from: [{ name: '국민은행', address: 'noreply@bank.example.kr' }],
      to: [{ address: 'me@naver.com' }],
      ...overrides.envelope,
    },
    headers: Buffer.from('message-id: <mail-1@example.com>\r\n', 'latin1'),
    ...overrides,
  };
}

test('the first sync of an account only takes a bounded recent window', () => {
  const plan = planImapSync({
    state: { baselineComplete: 0, imapLastUid: null },
    mailbox: { exists: 3564, uidNext: 16601, uidValidity: '0' },
    recentWindow: 200,
  });

  // 최초 연결에서 3,564통을 전부 끌어오면 과거 메일이 통째로 알림 후보가 된다.
  assert.equal(plan.mode, SYNC_MODES.BASELINE);
  assert.deepEqual(plan.range, { type: 'seq', from: 3365, to: 3564 });
});

test('an empty mailbox asks for nothing', () => {
  const plan = planImapSync({
    state: { baselineComplete: 0 },
    mailbox: { exists: 0, uidNext: 1, uidValidity: '0' },
  });
  assert.equal(plan.range, null);
});

test('a healthy cursor asks only for what arrived after it', () => {
  const plan = planImapSync({
    state: { baselineComplete: 1, imapLastUid: 16600, imapUidValidity: '0' },
    mailbox: { exists: 3564, uidNext: 16601, uidValidity: '0' },
  });
  assert.equal(plan.mode, SYNC_MODES.INCREMENTAL);
  assert.deepEqual(plan.range, { type: 'uid', from: 16601, to: '*' });
});

test('a rewound uidNext is treated as a renumber even though naver never changes UIDVALIDITY', () => {
  // 네이버는 UIDVALIDITY를 늘 '0'으로 준다(실측). 표준 경로만 두면 이 서버에서는
  // 재번호를 영영 감지하지 못하므로 uidNext 역행을 신호로 쓴다.
  const plan = planImapSync({
    state: { baselineComplete: 1, imapLastUid: 16600, imapUidValidity: '0' },
    mailbox: { exists: 12, uidNext: 13, uidValidity: '0' },
    recentWindow: 200,
  });
  assert.equal(plan.mode, SYNC_MODES.RESYNC);
  assert.equal(plan.reason, 'UIDNEXT_REWOUND');
  assert.deepEqual(plan.range, { type: 'seq', from: 1, to: 12 });
});

test("'0' is not a UIDVALIDITY value, so it never triggers a resync by itself", () => {
  const plan = planImapSync({
    state: { baselineComplete: 1, imapLastUid: 100, imapUidValidity: '' },
    mailbox: { exists: 200, uidNext: 201, uidValidity: '0' },
  });
  // 저장값이 비어 있고 현재가 '0'이어도 그것만으로 전체를 다시 읽지 않는다.
  assert.equal(plan.mode, SYNC_MODES.INCREMENTAL);
});

test('a real UIDVALIDITY change still resyncs when a server does send one', () => {
  const plan = planImapSync({
    state: { baselineComplete: 1, imapLastUid: 100, imapUidValidity: '111' },
    mailbox: { exists: 200, uidNext: 201, uidValidity: '222' },
    recentWindow: 50,
  });
  assert.equal(plan.mode, SYNC_MODES.RESYNC);
  assert.equal(plan.reason, 'UIDVALIDITY_CHANGED');
});

test('a lost cursor resyncs instead of starting from zero', () => {
  const plan = planImapSync({
    state: { baselineComplete: 1, imapLastUid: null },
    mailbox: { exists: 40, uidNext: 41, uidValidity: '0' },
    recentWindow: 200,
  });
  assert.equal(plan.mode, SYNC_MODES.RESYNC);
  assert.equal(plan.reason, 'NO_CURSOR');
});

test('the mailbox is always opened read-only and messages come back normalized', async () => {
  const client = createFakeClient({
    mailbox: { exists: 2, uidNext: 103, uidValidity: '0' },
    messages: [envelopeRow(102), envelopeRow(101)],
  });

  const result = await fetchMailbox(client, {
    state: { baselineComplete: 1, imapLastUid: 100, imapUidValidity: '0' },
  });

  // EXAMINE으로 열지 않으면 PEEK를 빠뜨린 fetch 한 줄이 사용자의 읽음 상태를 바꾼다.
  assert.deepEqual(client.calls.locks[0].options, { readOnly: true });
  assert.equal(client.calls.locks[0].released, true);
  assert.equal(client.calls.fetches[0].range, '101:*');
  assert.equal(client.calls.fetches[0].options.uid, true);

  // 서버가 어떤 순서로 주든 UID 오름차순으로 정렬해 커서가 뒤로 가지 않게 한다.
  assert.deepEqual(result.messages.map(m => m.imapUid), [101, 102]);
  assert.equal(result.highestUid, 102);
  assert.equal(result.messages[0].messageId, '<mail-101@example.com>');
  assert.equal(result.messages[0].from.address, 'noreply@bank.example.kr');
  assert.equal(result.messages[0].to[0], 'me@naver.com');
  // Date를 epoch seconds로 접는다. 값을 손으로 적으면 시간대를 틀리기 쉬워 유도한다.
  assert.equal(
    result.messages[0].receivedAt,
    Math.floor(new Date('2026-08-17T09:12:33+09:00').getTime() / 1000),
  );
});

test('the raw body is downloaded only for mail that has no Message-ID', async () => {
  const withId = createFakeClient({
    mailbox: { exists: 1, uidNext: 102, uidValidity: '0' },
    messages: [envelopeRow(101)],
  });
  const kept = await fetchMailbox(withId, { state: { baselineComplete: 1, imapLastUid: 100 } });

  // Message-ID가 있으면 본문을 받을 이유가 없다.
  assert.deepEqual(withId.calls.downloads, []);
  assert.equal(kept.messages[0].rawDigest, null);

  const withoutId = createFakeClient({
    mailbox: { exists: 1, uidNext: 102, uidValidity: '0' },
    // envelope와 헤더 양쪽에 없어야 진짜로 Message-ID가 없는 메일이다.
    // envelope만 비우면 헤더에서 주워오므로 이 경로를 타지 않는다.
    messages: [envelopeRow(101, {
      envelope: { messageId: null },
      headers: Buffer.from('', 'latin1'),
    })],
  });
  const fallback = await fetchMailbox(withoutId, { state: { baselineComplete: 1, imapLastUid: 100 } });

  // digest는 연결을 쥐고 있는 이 블록 안에서 값으로 채워 내보낸다. lazy closure로
  // 내보내면 호출 시점이 logout 뒤가 된다.
  assert.deepEqual(withoutId.calls.downloads, [101]);
  assert.match(fallback.messages[0].rawDigest, /^[0-9a-f]{64}$/);
});

test('a sync connects, reads read-only, and always logs out', async () => {
  const client = createFakeClient({
    mailbox: { exists: 1, uidNext: 102, uidValidity: '0' },
    messages: [envelopeRow(101)],
  });
  const provider = createNaverProvider({ createClient: () => client });

  await provider.sync({ credentials: { user: 'me', pass: 'x' }, state: { baselineComplete: 1, imapLastUid: 100 } });
  assert.equal(client.calls.connected, 1);
  assert.equal(client.calls.loggedOut, 1);

  // 가져오는 도중 실패해도 연결은 닫는다. 5분마다 붙었다 끊는 구조라 연결이 새면
  // 서버가 먼저 우리를 막는다.
  const failing = createFakeClient({
    mailbox: { exists: 1, uidNext: 102, uidValidity: '0' },
    onFetch() { throw new Error('boom'); },
  });
  // 오류는 Mail Agent가 아는 계약으로 정규화돼 나간다. 그래야 agent가 재시도할지
  // 계정을 세울지 고를 수 있다.
  await assert.rejects(
    () => createNaverProvider({ createClient: () => failing })
      .sync({ credentials: {}, state: { baselineComplete: 1, imapLastUid: 100 } }),
    error => {
      assert.equal(error.code, 'MAIL_IMAP_FATAL');
      assert.equal(error.retryable, false);
      return true;
    },
  );
  assert.equal(failing.calls.loggedOut, 1);
});

test('a stored UID is re-read read-only and comes back as raw bytes', async () => {
  const client = createFakeClient({ mailbox: { exists: 10, uidNext: 20, uidValidity: '0' } });
  const provider = createNaverProvider({ createClient: () => client });

  const body = await provider.fetchRaw(
    { imapUid: 7, imapUidValidity: '0' },
    { credentials: { user: 'me', pass: 'p' } },
  );

  assert.equal(body.raw.toString('latin1'), 'raw-body-of-7');
  // IMAP flag는 provider 분류가 아니다. Gmail 라벨 자리에 섞지 않는다.
  assert.deepEqual(body.labels, []);
  assert.deepEqual(client.calls.locks.at(-1).options, { readOnly: true });
  assert.equal(client.calls.locks.at(-1).released, true);
  assert.equal(client.calls.loggedOut, 1);
});

test('a renumbered mailbox refuses the stale UID instead of reading a different mail', async () => {
  // 같은 UID가 다른 메일을 가리키는데 그냥 읽으면 엉뚱한 메일을 분석해 놓고 성공으로 끝난다.
  const client = createFakeClient({ mailbox: { exists: 10, uidNext: 20, uidValidity: '99' } });
  const provider = createNaverProvider({ createClient: () => client });

  await assert.rejects(
    () => provider.fetchRaw({ imapUid: 7, imapUidValidity: '42' }, { credentials: {} }),
    error => error.code === 'MAIL_LOCATOR_STALE' && error.retryable === true,
  );
  assert.equal(client.calls.downloads.length, 0);
  assert.equal(client.calls.locks.at(-1).released, true);
});

test("naver's '0' UIDVALIDITY never blocks a re-read by itself", async () => {
  const client = createFakeClient({ mailbox: { exists: 10, uidNext: 20, uidValidity: '0' } });
  const provider = createNaverProvider({ createClient: () => client });

  const body = await provider.fetchRaw({ imapUid: 3, imapUidValidity: '' }, { credentials: {} });
  assert.equal(body.raw.toString('latin1'), 'raw-body-of-3');
});
