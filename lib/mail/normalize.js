'use strict';

// 원문 바이트를 LLM 입력으로 쓸 수 있는 텍스트로 바꾼다. 파싱·정제만 하고 판단은 하지 않는다.
//
// 설계 단일 기준은 docs/xion-mail-agent-design-final.md 10.1이다. 파서는 postal-mime이고
// HTML→text는 자체 구현이다 — mailparser는 발송 스택(nodemailer) 전체를 끌고 오고,
// inline 이미지를 base64 data: URI로 본문에 주입하며, 트래킹 픽셀 URL을 텍스트에 남긴다.
// 마지막 항목은 19절의 "외부 tracking image 자동 로딩 금지"와 방향이 어긋난다.

const PostalMime = require('postal-mime').default;

// 뉴스레터 하나가 수십만 자인 경우는 흔하다. 절단 사실은 값으로 남겨서 분석 단계가
// "판단 불가"를 선택할 수 있게 한다(설계 10.1).
const DEFAULT_MAX_BODY_CHARS = 16_000;

// 인용 답장이 길면 원문보다 인용이 커진다. 앞부분만 남기고 나머지는 개수만 알린다.
const QUOTE_KEEP_LINES = 5;
const QUOTE_COLLAPSE_THRESHOLD = 10;
// 트래킹 URL은 한 줄이 수백 자다. 링크가 있었다는 사실만 남기면 판단에 충분하다.
const MAX_INLINE_URL_CHARS = 120;

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

// 내용까지 통째로 버리는 태그. 여기 텍스트는 사람이 읽는 본문이 아니다.
const DROPPED_CONTENT_TAGS = /<(script|style|head|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const BLOCK_TAGS = /<\/?(?:p|div|br|hr|tr|li|ul|ol|table|thead|tbody|tfoot|h[1-6]|blockquote|section|article|header|footer|pre|form)\b[^>]*>/gi;
const CELL_TAGS = /<\/?(?:td|th)\b[^>]*>/gi;
const ANCHOR = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;

function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? match : named;
  });
}

function shortenUrl(url) {
  const text = String(url).trim();
  if (text.length <= MAX_INLINE_URL_CHARS) return text;
  return `${text.slice(0, MAX_INLINE_URL_CHARS)}…`;
}

/**
 * HTML을 LLM이 읽을 평문으로 바꾼다.
 *
 * 이 변환기는 우리가 유지보수한다. 이상한 HTML에서 출력이 나빠질 수 있지만 이 출력은
 * LLM 입력이지 화면 렌더링이 아니다. 실패는 "텍스트가 지저분해짐"으로 끝나고
 * 안전 경로에 있지 않다(설계 10.1).
 */
function htmlToText(html) {
  let out = String(html ?? '');
  out = out.replace(/<!--[\s\S]*?-->/g, ' ');
  out = out.replace(DROPPED_CONTENT_TAGS, ' ');
  // 링크 텍스트를 남기고 URL은 뒤에 붙인다. img의 src는 아래 일반 태그 제거에서
  // 통째로 사라지므로 트래킹 픽셀 URL이 텍스트로 들어오지 않는다.
  out = out.replace(ANCHOR, (match, dq, sq, bare, inner) => {
    const url = shortenUrl(dq ?? sq ?? bare ?? '');
    const label = decodeEntities(inner.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
    if (!url) return label;
    if (!label || label === url) return url;
    return `${label} [${url}]`;
  });
  out = out.replace(CELL_TAGS, ' ');
  out = out.replace(BLOCK_TAGS, '\n');
  out = out.replace(/<[^>]*>/g, '');
  out = decodeEntities(out);
  return out
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// 서명 구분선(RFC 3676의 "-- ")부터는 본문이 아니다. 마지막 구분선만 자른다 —
// 앞쪽 "--"는 인용된 서명이거나 그냥 구분선일 수 있다.
function stripSignature(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 1; i -= 1) {
    if (/^--\s?$/.test(lines[i])) return lines.slice(0, i).join('\n').trimEnd();
  }
  return text;
}

// 인용 블록이 길면 앞부분만 남긴다. 지운 것이 아니라 접은 것이므로 몇 줄인지 알린다.
function collapseQuotes(text) {
  const lines = text.split('\n');
  const out = [];
  let block = [];
  const flush = () => {
    if (!block.length) return;
    if (block.length > QUOTE_COLLAPSE_THRESHOLD) {
      out.push(...block.slice(0, QUOTE_KEEP_LINES));
      out.push(`[인용 ${block.length - QUOTE_KEEP_LINES}줄 생략]`);
    } else {
      out.push(...block);
    }
    block = [];
  };
  for (const line of lines) {
    if (/^\s*>/.test(line)) block.push(line);
    else {
      flush();
      out.push(line);
    }
  }
  flush();
  return out.join('\n');
}

function findHeaderEnd(buffer) {
  const crlf = buffer.indexOf('\r\n\r\n');
  const lf = buffer.indexOf('\n\n');
  if (crlf >= 0 && (lf < 0 || crlf < lf)) return { headerEnd: crlf, bodyStart: crlf + 4 };
  if (lf >= 0) return { headerEnd: lf, bodyStart: lf + 2 };
  return null;
}

function isStrictUtf8(buffer) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * charset 선언이 없는 EUC-KR 메일을 파싱 전에 보정한다 (설계 10.1).
 *
 * 실측에서 이런 메일은 postal-mime과 mailparser가 **둘 다** 깨졌다. 자동 감지가 없어서
 * 파서를 바꿔도 해결되지 않으므로 raw 단계에서 고친다. multipart는 파트별로 판단해야
 * 하므로 제외한다.
 *
 * 알려진 한계: 본문이 quoted-printable/base64로 인코딩돼 있으면 raw 바이트가 전부
 * ASCII라 이 규칙에 걸리지 않는다. 설계가 정한 좁은 규칙 그대로이고, 여기서 문자셋
 * 자동 감지 라이브러리를 도입하지 않는다.
 */
function repairMissingCharset(buffer) {
  const split = findHeaderEnd(buffer);
  if (!split) return buffer;
  const headerText = buffer.subarray(0, split.headerEnd).toString('latin1');
  const contentType = /^content-type:[ \t]*([^\r\n]*(?:\r?\n[ \t][^\r\n]*)*)/im.exec(headerText);
  const value = contentType ? contentType[1].replace(/\r?\n[ \t]+/g, ' ') : '';
  if (/multipart\//i.test(value)) return buffer;
  if (/charset\s*=/i.test(value)) return buffer;

  const body = buffer.subarray(split.bodyStart);
  if (!body.some(byte => byte > 0x7f)) return buffer;
  if (isStrictUtf8(body)) return buffer;

  const patchedHeader = contentType
    ? headerText.replace(contentType[0], `${contentType[0]}; charset=euc-kr`)
    : `Content-Type: text/plain; charset=euc-kr\r\n${headerText}`;
  return Buffer.concat([
    Buffer.from(patchedHeader, 'latin1'),
    buffer.subarray(split.headerEnd, buffer.length),
  ]);
}

function headerValue(headers, name) {
  const target = name.toLowerCase();
  for (const header of headers || []) {
    if (String(header?.key || '').toLowerCase() === target) return String(header.value ?? '');
  }
  return null;
}

function toAddress(entry) {
  if (!entry) return null;
  const address = String(entry.address || '').trim().toLowerCase();
  const name = String(entry.name || '').trim();
  if (!address && !name) return null;
  return { name: name || null, address: address || null };
}

/**
 * 원문 바이트 하나를 분석 입력으로 바꾼다.
 *
 * @param {Buffer|Uint8Array|string} raw  provider가 다시 읽어온 RFC822 원문
 * @returns {Promise<object>} 판단하지 않은 사실만 들어 있는 객체
 */
async function normalizeMail(raw, options = {}) {
  const maxBodyChars = Number.isSafeInteger(options.maxBodyChars) && options.maxBodyChars > 0
    ? options.maxBodyChars
    : DEFAULT_MAX_BODY_CHARS;
  const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw ?? '');
  const parsed = await PostalMime.parse(repairMissingCharset(buffer));

  // postal-mime은 HTML 전용 메일에서 text를 주지 않는다. fallback이 없으면 광고·뉴스레터
  // 대부분이 빈 본문으로 분석된다.
  const plain = typeof parsed.text === 'string' ? parsed.text.trim() : '';
  const bodySource = plain ? 'text' : (parsed.html ? 'html' : 'empty');
  const rawBody = plain || (parsed.html ? htmlToText(parsed.html) : '');

  const reduced = collapseQuotes(stripSignature(rawBody.replace(/\r\n?/g, '\n')))
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const truncated = reduced.length > maxBodyChars;

  const attachments = (parsed.attachments || [])
    // inline 이미지는 첨부가 아니라 본문 장식이다. 사용자가 "첨부가 있다"고 느끼는 것만 센다.
    .filter(item => item?.disposition !== 'inline' && !item?.related)
    .map(item => ({
      filename: item?.filename || null,
      mimeType: item?.mimeType || null,
      size: Number.isFinite(item?.content?.byteLength) ? item.content.byteLength : null,
    }));

  return {
    subject: parsed.subject || null,
    from: toAddress(parsed.from),
    to: (parsed.to || []).map(toAddress).filter(Boolean),
    messageId: parsed.messageId || null,
    date: parsed.date || null,
    listUnsubscribe: headerValue(parsed.headers, 'list-unsubscribe') !== null,
    hasAttachments: attachments.length > 0,
    attachments,
    bodySource,
    body: truncated ? reduced.slice(0, maxBodyChars) : reduced,
    bodyLength: reduced.length,
    truncated,
  };
}

module.exports = {
  DEFAULT_MAX_BODY_CHARS,
  htmlToText,
  normalizeMail,
  repairMissingCharset,
};
