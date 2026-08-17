'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildMessageIdentity, IDENTITY_KINDS } = require('../lib/mail/agent');

test('gmail keeps its own stable message id as identity', () => {
  const identity = buildMessageIdentity({ provider: 'gmail', gmailMessageId: '18f0c1abc' });
  assert.deepEqual(identity, { kind: IDENTITY_KINDS.GMAIL, key: '18f0c1abc' });

  assert.throws(
    () => buildMessageIdentity({ provider: 'gmail' }),
    /Gmail 메시지 ID/,
  );
});

test('imap uses Message-ID and never the UID', () => {
  const base = {
    provider: 'naver',
    messageId: '<20260817091233.KR1@bank.example.kr>',
    from: '국민은행 <noreply@bank.example.kr>',
    subject: '본인확인 안내',
    date: 'Mon, 17 Aug 2026 09:12:33 +0900',
  };

  const first = buildMessageIdentity({ ...base, imapUid: 16575 });
  const afterRenumber = buildMessageIdentity({ ...base, imapUid: 42 });

  // UID가 통째로 바뀌는 resync 뒤에도 같은 메일은 같은 identity여야 한다.
  assert.equal(first.kind, IDENTITY_KINDS.MESSAGE_ID);
  assert.equal(first.key, afterRenumber.key);

  // 꺾쇠와 공백은 서버·클라이언트마다 붙었다 떨어졌다 한다. 벗겨서 같은 값으로 만든다.
  assert.equal(
    buildMessageIdentity({ ...base, messageId: '  20260817091233.KR1@bank.example.kr ' }).key,
    first.key,
  );
});

test('a message without Message-ID falls back to a deterministic fingerprint', () => {
  const mail = {
    provider: 'naver',
    from: '광고 <ad@spammy.example.com>',
    subject: '특가 세일',
    date: 'Mon, 17 Aug 2026 12:00:00 +0900',
    to: 'me@naver.com',
    rawDigest: 'a'.repeat(64),
  };

  const identity = buildMessageIdentity(mail);
  assert.equal(identity.kind, IDENTITY_KINDS.FINGERPRINT);
  assert.match(identity.key, /^[0-9a-f]{64}$/);

  // 같은 메일을 다시 읽으면 반드시 같은 값이 나와야 한다. 이게 깨지면 replay마다
  // 새 행이 생겨 dedup이 통째로 무너진다.
  assert.equal(buildMessageIdentity({ ...mail }).key, identity.key);

  // 표시 형식만 다른 재료는 같은 값으로 접힌다.
  assert.equal(buildMessageIdentity({ ...mail, from: 'AD@Spammy.Example.com' }).key, identity.key);
  assert.equal(buildMessageIdentity({ ...mail, subject: ' 특가   세일 ' }).key, identity.key);
  assert.equal(
    buildMessageIdentity({ ...mail, date: '2026-08-17T12:00:00+09:00' }).key,
    identity.key,
    '같은 시각을 가리키는 다른 표기는 같은 재료다',
  );
});

test('the fingerprint separates mail that from|subject|date alone would collide', () => {
  const base = {
    provider: 'naver',
    from: 'newsletter@example.com',
    subject: '주간 소식',
    date: 'Mon, 17 Aug 2026 09:00:00 +0900',
    to: 'me@naver.com',
  };

  // 같은 발신자가 같은 제목·같은 시각에 보내는 정기 메일은 흔하다. 본문이 다르면
  // 다른 메일이므로 digest가 그것을 갈라야 한다.
  const monday = buildMessageIdentity({ ...base, rawDigest: 'digest-week-33' });
  const nextWeek = buildMessageIdentity({ ...base, rawDigest: 'digest-week-34' });
  assert.notEqual(monday.key, nextWeek.key);

  // 수신자와 스레드 헤더도 재료다.
  assert.notEqual(
    buildMessageIdentity({ ...base, rawDigest: 'digest-week-33', to: 'other@naver.com' }).key,
    monday.key,
  );
  assert.notEqual(
    buildMessageIdentity({ ...base, rawDigest: 'digest-week-33', inReplyTo: '<prev@example.com>' }).key,
    monday.key,
  );
});

test('a fingerprint is refused rather than guessed when the digest is missing', () => {
  // digest 없이 만들면 from|subject|date만으로 접혀서 서로 다른 메일이 한 행이 된다.
  // 그런 identity를 조용히 만들어내는 것보다 거절하는 편이 낫다.
  assert.throws(
    () => buildMessageIdentity({
      provider: 'naver', from: 'a@b.com', subject: '제목', date: 'Mon, 17 Aug 2026 12:00:00 +0900',
    }),
    /본문 digest/,
  );
});

test('References keeps every id instead of collapsing to the first address', () => {
  const base = {
    provider: 'naver',
    from: 'recruit@aitrainer.example.com',
    subject: 'Re: 면접',
    date: 'Tue, 18 Aug 2026 09:00:00 +0900',
    rawDigest: 'b'.repeat(64),
  };

  // References는 주소 목록이 아니라 공백으로 이어진 Message-ID들이다. 주소로 다루면
  // 첫 항목만 남아 스레드가 다른 메일이 같은 재료를 갖게 된다.
  assert.notEqual(
    buildMessageIdentity({ ...base, references: '<a@x.com> <b@x.com>' }).key,
    buildMessageIdentity({ ...base, references: '<a@x.com> <c@x.com>' }).key,
  );
});
