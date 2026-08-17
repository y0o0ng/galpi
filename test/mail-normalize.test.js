'use strict';

// 정규화 계약 회귀. 설계 10.1과 Phase 2 검증 시나리오 9·10·11을 값으로 잠근다.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_MAX_BODY_CHARS,
  htmlToText,
  normalizeMail,
  repairMissingCharset,
} = require('../lib/mail/normalize');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'mail-mime');
const fixture = name => fs.readFileSync(path.join(FIXTURE_DIR, name));

test('a declared EUC-KR quoted-printable mail survives parsing intact', async () => {
  const mail = await normalizeMail(fixture('euckr-declared-qp.eml'));
  assert.strictEqual(mail.subject, '한글입니다');
  assert.match(mail.body, /한글 본문입니다/);
  assert.strictEqual(mail.bodySource, 'text');
});

test('an EUC-KR mail with no declared charset is repaired before parsing', async () => {
  const mail = await normalizeMail(fixture('charset-undeclared-euckr.eml'));
  assert.match(mail.body, /한글 본문입니다/);
});

test('healthy UTF-8 and multipart mail is left alone by the charset repair', () => {
  // 보정이 일어나면 헤더 바이트가 바뀐다. 같은 버퍼가 그대로 나오면 건드리지 않은 것이다.
  const utf8 = Buffer.from(
    'Content-Type: text/plain; charset=UTF-8\r\n\r\n한글 본문\r\n',
    'utf8',
  );
  assert.ok(repairMissingCharset(utf8).equals(utf8));

  const undeclaredUtf8 = Buffer.from('Content-Type: text/plain\r\n\r\n한글 본문\r\n', 'utf8');
  assert.ok(repairMissingCharset(undeclaredUtf8).equals(undeclaredUtf8));

  const multipart = fixture('gmail-multipart-alternative.eml');
  assert.ok(repairMissingCharset(multipart).equals(multipart));
});

test('multipart/alternative uses the text part and drops everything after the signature', async () => {
  const mail = await normalizeMail(fixture('gmail-multipart-alternative.eml'));
  assert.strictEqual(mail.bodySource, 'text');
  assert.strictEqual(mail.subject, '면접 상담 시간 선택');
  assert.strictEqual(mail.from.address, 'recruiting@example.com');
  assert.strictEqual(mail.listUnsubscribe, true);
  assert.match(mail.body, /8월 19일까지/);
  assert.doesNotMatch(mail.body, /채용팀 드림/);
});

test('an RFC2231 korean filename is counted as a real attachment', async () => {
  const mail = await normalizeMail(fixture('rfc2231-korean-attachment.eml'));
  assert.strictEqual(mail.hasAttachments, true);
  assert.strictEqual(mail.attachments.length, 1);
  assert.strictEqual(mail.attachments[0].filename, '수강신청.pdf');
});

test('a long quoted block is collapsed and says how many lines it folded', async () => {
  const mail = await normalizeMail(fixture('thread-references.eml'));
  assert.match(mail.body, /확인했습니다/);
  assert.match(mail.body, /> 목요일 오후 2시/);
  assert.match(mail.body, /\[인용 7줄 생략\]/);
  assert.doesNotMatch(mail.body, /이상입니다/);
});

test('normalization still finishes when the mail has no Message-ID', async () => {
  const mail = await normalizeMail(fixture('no-message-id.eml'));
  assert.strictEqual(mail.messageId, null);
  assert.match(mail.body, /9,900원/);
});

test('an HTML-only mail is never empty and never carries a tracking URL into the text', async () => {
  const mail = await normalizeMail(fixture('nested-related-html-only.eml'));
  assert.strictEqual(mail.bodySource, 'html');
  assert.match(mail.body, /이번 주 특가를 확인하세요/);
  // script / style / head 내용은 사람이 읽는 본문이 아니다.
  assert.doesNotMatch(mail.body, /alert/);
  assert.doesNotMatch(mail.body, /color:red/);
  assert.doesNotMatch(mail.body, /숨은 제목/);
  assert.doesNotMatch(mail.body, /숨은 주석/);
  // img의 src는 텍스트로 옮기지 않는다 (설계 19절 tracking image).
  assert.doesNotMatch(mail.body, /track\.example\.com/);
  // 표 셀은 공백으로 갈라야 "상품가격"이 되지 않는다.
  assert.match(mail.body, /상품 가격/);
  assert.match(mail.body, /노트북 1,200,000원/);
  assert.match(mail.body, /특가 보기 \[https:\/\/shop\.example\.com\/sale\]/);
  // 엔티티 디코딩은 한 번만 한다. &amp;nbsp;가 공백이 되면 원문이 무엇이었는지 사라진다.
  assert.match(mail.body, /<재고> 소진 시 &nbsp; 종료!/);
  // inline 이미지는 첨부가 아니다.
  assert.strictEqual(mail.hasAttachments, false);
});

test('an oversized URL is shortened instead of pasted whole', () => {
  const long = `https://track.example.com/${'a'.repeat(400)}`;
  const text = htmlToText(`<a href="${long}">클릭</a>`);
  assert.match(text, /^클릭 \[https:\/\/track\.example\.com\/a+…\]$/);
  assert.ok(text.length < 200);
});

test('a huge body is truncated and says so as a value', async () => {
  const paragraph = '<p>특가 상품 안내입니다. 지금 확인하세요.</p>';
  const huge = Buffer.from([
    'From: news@shop.example.com',
    'To: me@gmail.com',
    'Subject: huge',
    'Date: Mon, 17 Aug 2026 15:00:00 +0900',
    'Message-ID: <huge@shop.example.com>',
    'Content-Type: text/html; charset=UTF-8',
    '',
    `<html><body>${paragraph.repeat(8000)}</body></html>`,
    '',
  ].join('\r\n'), 'utf8');
  assert.ok(huge.length > 200_000);

  const mail = await normalizeMail(huge);
  assert.strictEqual(mail.truncated, true);
  assert.strictEqual(mail.body.length, DEFAULT_MAX_BODY_CHARS);
  assert.ok(mail.bodyLength > DEFAULT_MAX_BODY_CHARS);

  const shorter = await normalizeMail(huge, { maxBodyChars: 500 });
  assert.strictEqual(shorter.body.length, 500);
});
