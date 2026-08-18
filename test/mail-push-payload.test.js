'use strict';

// Push payload 계약 (설계 13.1). 이 파일이 잠그는 불변식은 하나다 —
// **Mail Push는 메일 내용을 전달하지 않는다.**
//
// 개별 필드 부재만 확인하면 기존 필드에 내용을 끼워 넣는 것을 못 잡는다. 세 겹으로 본다.
// (1) key 집합 정확 일치 (2) 직렬화 문자열에 메일 내용 없음 (3) 값의 모양.

const test = require('node:test');
const assert = require('node:assert/strict');

const { MAIL_PUSH_PAYLOAD_KEYS, buildMailPushPayload } = require('../lib/mail/push');

const ALLOWED = ['notifySeq', 'targetId', 'targetKind', 'type', 'url', 'version'];

test('the allowed key list is exactly the six the design fixed', () => {
  assert.deepEqual([...MAIL_PUSH_PAYLOAD_KEYS].sort(), ALLOWED);
});

test('a message payload carries routing metadata and nothing else', () => {
  const raw = buildMailPushPayload({ targetKind: 'message', targetId: 12, notifySeq: 1 });
  assert.equal(typeof raw, 'string');
  const payload = JSON.parse(raw);

  // 1. key 집합. 누가 count·summary·subject를 더하면 여기서 깨진다.
  assert.deepEqual(Object.keys(payload).sort(), ALLOWED);

  assert.equal(payload.version, 1);
  assert.equal(payload.type, 'mail_attention');
  assert.equal(payload.targetKind, 'message');
  assert.equal(payload.targetId, 12);
  assert.equal(payload.notifySeq, 1);
  assert.equal(payload.url, '/?panel=notifications&notification=mail&mail=12');
});

test('a batch payload points at the mail filter, not at one mail', () => {
  const payload = JSON.parse(buildMailPushPayload({ targetKind: 'batch', targetId: 7, notifySeq: 1 }));
  assert.deepEqual(Object.keys(payload).sort(), ALLOWED);
  assert.equal(payload.targetKind, 'batch');
  assert.equal(payload.targetId, 7);
  // batch에서 특정 메일 하나로 이동하지 않는다.
  assert.equal(payload.url, '/?panel=notifications&notification=mail');
  assert.doesNotMatch(payload.url, /mail=/);
});

test('nothing derived from the mail reaches the payload', () => {
  // 실제 판단이 만들어내는 값들. 하나라도 문자열에 나타나면 실패다.
  const leaks = [
    '국민카드', 'noreply@bank.example.kr', '해외 승인 의심 거래 확인 요청',
    '카드 승인 시도가 감지되었습니다', 'urgent', 'action_required', 'immediate',
    '2026-08-19', '0.91',
  ];
  for (const target of [
    { targetKind: 'message', targetId: 12, notifySeq: 3 },
    { targetKind: 'batch', targetId: 7, notifySeq: 1 },
  ]) {
    const raw = buildMailPushPayload(target);
    for (const leak of leaks) {
      assert.equal(raw.includes(leak), false, `${target.targetKind}에 "${leak}"이 실렸다`);
    }
    // batch 개수도 메일 파생 metadata다. 숫자 키가 target/회차 둘뿐인지로 잠근다.
    const payload = JSON.parse(raw);
    const numeric = Object.entries(payload).filter(([, v]) => typeof v === 'number').map(([k]) => k);
    assert.deepEqual(numeric.sort(), ['notifySeq', 'targetId', 'version']);
  }
});

test('the values keep the shape the service worker relies on', () => {
  const payload = JSON.parse(buildMailPushPayload({ targetKind: 'message', targetId: 9, notifySeq: 2 }));
  assert.ok(Number.isSafeInteger(payload.targetId));
  assert.ok(Number.isSafeInteger(payload.notifySeq));
  // 절대 URL을 허용하면 same-origin 검증이 있어도 외부 origin이 payload에 들어온다.
  assert.ok(payload.url.startsWith('/'));
  assert.doesNotMatch(payload.url, /^https?:/);
});

test('a target the contract does not know is refused, not guessed', () => {
  for (const bad of [
    { targetKind: 'attention', targetId: 1, notifySeq: 1 },
    { targetKind: 'message', targetId: 0, notifySeq: 1 },
    { targetKind: 'message', targetId: 1, notifySeq: 0 },
    { targetKind: 'message', targetId: 1.5, notifySeq: 1 },
  ]) {
    assert.throws(() => buildMailPushPayload(bad), /payload/, JSON.stringify(bad));
  }
});

test('the payload stays small enough that size is never a question', () => {
  // 고정 6키라 크기가 상수다. 큰 targetId를 넣어도 한도 근처에 가지 않는다.
  const raw = buildMailPushPayload({ targetKind: 'message', targetId: 9_007_199_254_740_991, notifySeq: 999 });
  assert.ok(Buffer.byteLength(raw, 'utf8') < 200, `payload가 ${Buffer.byteLength(raw, 'utf8')}바이트다`);
});
