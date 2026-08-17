'use strict';

// Naver IMAP provider. 메일을 정확하게 가져오고 커서를 해석하는 것까지만 한다.
// identity 판정·저장·알림은 agent와 store의 몫이다(설계 22절 책임 경계).
//
// 실측으로 확인한 서버 성질 두 가지가 이 파일의 형태를 정한다(설계 6.2).
//  - IDLE/CONDSTORE/QRESYNC가 없다 → UID 커서 폴링이 유일한 방법이다
//  - UIDVALIDITY를 항상 '0'으로 준다 → 그 값의 변화로 재번호를 감지할 수 없다

const { sha256 } = require('../content-hash');

const DEFAULT_HOST = 'imap.naver.com';
const DEFAULT_PORT = 993;
const DEFAULT_MAILBOX = 'INBOX';
// 최초 연결과 리셋 복구에서 훑을 최근 구간. 전체 메일함을 끌어오지 않기 위한 상한이다.
const DEFAULT_RECENT_WINDOW = 200;

const SYNC_MODES = {
  BASELINE: 'baseline',
  INCREMENTAL: 'incremental',
  RESYNC: 'resync',
};

// ImapFlow가 실제로 붙이는 코드다(라이브러리 소스 확인). 여기에 없는 것은
// 문자열로 추측하지 않고 fatal로 보낸다 — 잘못 retryable로 분류하면 고장난 설정을
// 5분마다 영원히 재시도한다.
const RETRYABLE_IMAP_CODES = new Set([
  'NoConnection', 'EConnectionClosed', 'ETIMEOUT', 'ETHROTTLE',
  'GREETING_TIMEOUT', 'UPGRADE_TIMEOUT', 'ClosedAfterConnectTLS', 'ClosedAfterConnectText',
  // node 소켓 계층에서 그대로 올라오는 것들
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'EHOSTUNREACH',
]);

/**
 * ImapFlow 오류를 Mail Agent가 아는 계약으로 바꾼다.
 *
 * 이 경계가 없으면 일시적 네트워크 장애조차 retryable 표시가 없어서 agent가 계정을
 * status='error'로 세우고, listDueAccounts가 active만 집으므로 그 계정이 영구히 멈춘다.
 */
function normalizeImapError(error) {
  if (error?.code && String(error.code).startsWith('MAIL_')) return error;
  // 인증 실패는 ImapFlow가 authenticationFailed로 표시한다. 재시도로 풀리지 않는다.
  if (error?.authenticationFailed) {
    const authError = new Error('네이버 메일 재인증이 필요합니다.');
    authError.code = 'MAIL_AUTH_REQUIRED';
    authError.retryable = false;
    authError.serverResponseCode = error.serverResponseCode || null;
    return authError;
  }
  const retryable = RETRYABLE_IMAP_CODES.has(String(error?.code || ''));
  const normalized = new Error(retryable
    ? '네이버 메일 연결이 일시적으로 실패했습니다.'
    : '네이버 메일 동기화가 실패했습니다.');
  normalized.code = retryable ? 'MAIL_IMAP_FAILED' : 'MAIL_IMAP_FATAL';
  normalized.retryable = retryable;
  normalized.imapCode = error?.code || null;
  return normalized;
}

function toPositiveInteger(value) {
  return Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
}

// 네이버가 주는 '0'은 값이 아니라 "안 준다"에 가깝다. 판정에 쓸 수 있는 것만 걸러낸다.
function usableUidValidity(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text || text === '0') return null;
  return text;
}

/**
 * 이번 tick에 무엇을 가져올지 정한다. 순수 함수라 서버 없이 검증할 수 있다.
 *
 * 리셋 신호가 둘인 이유는 네이버가 UIDVALIDITY를 안 주기 때문이다. 표준 경로만
 * 두면 이 서버에서는 영영 발동하지 않는다.
 */
function planImapSync({ state, mailbox, recentWindow = DEFAULT_RECENT_WINDOW } = {}) {
  const exists = Number.isSafeInteger(mailbox?.exists) ? mailbox.exists : 0;
  const uidNext = toPositiveInteger(mailbox?.uidNext);
  const storedLastUid = toPositiveInteger(state?.imapLastUid);
  const storedValidity = usableUidValidity(state?.imapUidValidity);
  const currentValidity = usableUidValidity(mailbox?.uidValidity);

  // 최근 구간만 훑는 sequence 범위. 빈 메일함이면 아무것도 가져오지 않는다.
  const window = exists === 0
    ? null
    : { type: 'seq', from: Math.max(1, exists - recentWindow + 1), to: exists };

  if (!state || state.baselineComplete !== 1) {
    return { mode: SYNC_MODES.BASELINE, range: window, reason: 'BASELINE' };
  }
  if (!storedLastUid) {
    return { mode: SYNC_MODES.RESYNC, range: window, reason: 'NO_CURSOR' };
  }
  if (storedValidity && currentValidity && storedValidity !== currentValidity) {
    return { mode: SYNC_MODES.RESYNC, range: window, reason: 'UIDVALIDITY_CHANGED' };
  }
  // 번호가 되감겼다. UIDVALIDITY를 못 믿는 이 서버에서 실제로 잡을 수 있는 신호다.
  if (uidNext && uidNext <= storedLastUid) {
    return { mode: SYNC_MODES.RESYNC, range: window, reason: 'UIDNEXT_REWOUND' };
  }
  return {
    mode: SYNC_MODES.INCREMENTAL,
    range: { type: 'uid', from: storedLastUid + 1, to: '*' },
    reason: 'CURSOR',
  };
}

function rangeToQuery(range) {
  if (!range) return null;
  return `${range.from}:${range.to}`;
}

function firstAddress(list) {
  const entry = Array.isArray(list) ? list[0] : null;
  return {
    name: entry?.name ? String(entry.name) : null,
    address: entry?.address ? String(entry.address) : null,
  };
}

function addressList(list) {
  return (Array.isArray(list) ? list : [])
    .map(entry => entry?.address)
    .filter(Boolean)
    .map(String);
}

function headerValue(headers, name) {
  if (!headers) return null;
  const text = Buffer.isBuffer(headers) ? headers.toString('latin1') : String(headers);
  const match = new RegExp(`^${name}:\\s*([^\\r\\n]*(?:\\r?\\n[ \\t][^\\r\\n]*)*)`, 'im').exec(text);
  return match ? match[1].replace(/\r?\n[ \t]+/g, ' ').trim() : null;
}

function toEpochSeconds(value) {
  if (Number.isSafeInteger(value)) return value;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ''));
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

/**
 * 저장된 locator로 원문 하나를 다시 읽는다. 본문은 DB에 없으므로 분석은 항상 여기를 거친다.
 *
 * UIDVALIDITY가 바뀌었으면 같은 UID가 **다른 메일**을 가리킨다. 그때 그냥 읽으면 엉뚱한
 * 메일을 분석해 놓고 성공으로 끝내므로, 읽지 않고 실패로 돌린다 — 다음 sync가 resync로
 * locator를 옮기고 나면 재시도가 성공한다.
 */
async function fetchRawByUid(client, { uid, uidValidity, mailbox = DEFAULT_MAILBOX } = {}) {
  const targetUid = toPositiveInteger(uid);
  if (!targetUid) {
    const error = new Error('IMAP UID가 필요합니다.');
    error.code = 'MAIL_MESSAGE_GONE';
    error.retryable = false;
    throw error;
  }
  const lock = await client.getMailboxLock(mailbox, { readOnly: true });
  try {
    const storedValidity = usableUidValidity(uidValidity);
    const currentValidity = usableUidValidity(client.mailbox?.uidValidity);
    if (storedValidity && currentValidity && storedValidity !== currentValidity) {
      const error = new Error('메일함이 재번호되어 저장된 UID를 쓸 수 없습니다.');
      error.code = 'MAIL_LOCATOR_STALE';
      error.retryable = true;
      throw error;
    }
    const download = await client.download(targetUid, undefined, { uid: true });
    if (!download?.content) {
      const error = new Error('메일 원문을 찾을 수 없습니다.');
      error.code = 'MAIL_MESSAGE_GONE';
      error.retryable = false;
      throw error;
    }
    const chunks = [];
    for await (const chunk of download.content) chunks.push(chunk);
    return Buffer.concat(chunks);
  } finally {
    await lock.release();
  }
}

/**
 * 계획한 범위의 메일을 정규화해 돌려준다. 저장하지도, 커서를 옮기지도 않는다 —
 * 그 둘은 저장이 끝난 뒤에 agent가 한다.
 */
async function fetchMailbox(client, { state, recentWindow = DEFAULT_RECENT_WINDOW, mailbox = DEFAULT_MAILBOX } = {}) {
  // 항상 read-only로 연다. EXAMINE이면 프로토콜 수준에서 상태 변경이 불가능해서
  // PEEK를 빠뜨린 fetch가 한 줄 섞여도 사용자의 읽음 상태가 바뀌지 않는다.
  // 계획과 수집을 같은 lock 안에서 끝낸다 — 사이에 메일함을 놓으면 그동안 도착한
  // 메일 때문에 계획의 근거와 실제 범위가 어긋난다.
  const lock = await client.getMailboxLock(mailbox, { readOnly: true });
  try {
    const box = client.mailbox || {};
    const plan = planImapSync({ state, mailbox: box, recentWindow });
    const query = rangeToQuery(plan.range);
    const messages = [];
    if (query) {
      for await (const row of client.fetch(query, {
        uid: true,
        envelope: true,
        size: true,
        headers: ['message-id', 'references', 'in-reply-to'],
      }, { uid: plan.range.type === 'uid' })) {
        const envelope = row.envelope || {};
        const from = firstAddress(envelope.from);
        const uid = Number(row.uid);
        messages.push({
          imapUid: uid,
          imapUidValidity: String(box.uidValidity ?? ''),
          messageId: envelope.messageId || headerValue(row.headers, 'message-id'),
          references: headerValue(row.headers, 'references'),
          inReplyTo: envelope.inReplyTo || headerValue(row.headers, 'in-reply-to'),
          from,
          to: addressList(envelope.to),
          subject: envelope.subject ? String(envelope.subject) : null,
          receivedAt: toEpochSeconds(envelope.date),
          size: Number.isSafeInteger(row.size) ? row.size : null,
          // digest는 연결이 살아 있는 동안 값으로 채운다(아래). lazy closure로 내보내면
          // 호출 시점이 logout 뒤가 되어 닫힌 연결에 명령을 보내게 된다.
          rawDigest: null,
        });
      }
    }
    messages.sort((a, b) => a.imapUid - b.imapUid);

    // Message-ID가 없는 메일만 원문을 받아 digest를 만든다. 실측 표본에서는 40/40이
    // Message-ID를 갖고 있어 이 경로는 거의 타지 않는다. 여기서 계산해 두는 이유는
    // 이 블록이 연결을 쥐고 있는 마지막 지점이기 때문이다.
    for (const message of messages) {
      if (message.messageId) continue;
      const download = await client.download(message.imapUid, undefined, { uid: true });
      const chunks = [];
      for await (const chunk of download.content) chunks.push(chunk);
      message.rawDigest = sha256(Buffer.concat(chunks).toString('latin1'));
    }

    return {
      mode: plan.mode,
      reason: plan.reason,
      mailbox,
      uidValidity: String(box.uidValidity ?? ''),
      uidNext: toPositiveInteger(box.uidNext),
      exists: Number.isSafeInteger(box.exists) ? box.exists : 0,
      messages,
      highestUid: messages.length ? messages[messages.length - 1].imapUid : null,
    };
  } finally {
    await lock.release();
  }
}

// 실제 ImapFlow 어댑터. 단위 테스트는 이 자리에 fake를 넣어 돌린다.
function createImapFlowClient(config = {}) {
  const { ImapFlow } = require('imapflow');
  return new ImapFlow({
    host: config.host || DEFAULT_HOST,
    port: config.port || DEFAULT_PORT,
    secure: true,
    auth: { user: config.user, pass: config.pass },
    // 원문 프로토콜 로그에는 제목·주소가 그대로 실린다(설계 19절 로그 privacy).
    logger: false,
    emitLogs: false,
  });
}

function createNaverProvider(options = {}) {
  const createClient = typeof options.createClient === 'function'
    ? options.createClient
    : createImapFlowClient;
  const recentWindow = toPositiveInteger(options.recentWindow) || DEFAULT_RECENT_WINDOW;
  const mailbox = options.mailbox || DEFAULT_MAILBOX;

  return {
    provider: 'naver',

    // 한 계정의 한 tick. 연결 → EXAMINE → fetch → 종료로 끝낸다.
    // IDLE이 없는 서버라 연결을 붙들고 있을 이점이 없다(설계 6.2).
    async sync({ credentials, state }) {
      return withClient(credentials, client => fetchMailbox(client, { state, recentWindow, mailbox }));
    },

    // 분석 한 건마다 연결을 새로 연다. sync와 같은 수명 규칙을 쓰는 대신 tick당
    // 분석 건수가 곧 연결 수가 되므로, 분석 batch 상한을 작게 유지한다.
    async fetchRaw({ imapUid, imapUidValidity } = {}, { credentials } = {}) {
      const raw = await withClient(credentials, client => fetchRawByUid(client, {
        uid: imapUid,
        uidValidity: imapUidValidity,
        mailbox,
      }));
      // IMAP flag는 사용자의 읽음 상태이지 provider의 분류가 아니다. Gmail 라벨과
      // 같은 자리에 넣으면 서로 다른 것이 한 이름으로 섞인다.
      return { raw, labels: [] };
    },
  };

  async function withClient(credentials, run) {
    const client = createClient({ ...credentials, mailbox });
    try {
      await client.connect();
    } catch (error) {
      throw normalizeImapError(error);
    }
    try {
      return await run(client);
    } catch (error) {
      throw normalizeImapError(error);
    } finally {
      // 종료 실패로 원래 오류를 덮지 않는다. 이미 끊긴 연결을 닫는 중일 수 있다.
      await client.logout().catch(() => {});
    }
  }
}

module.exports = {
  SYNC_MODES,
  DEFAULT_RECENT_WINDOW,
  planImapSync,
  fetchMailbox,
  fetchRawByUid,
  normalizeImapError,
  createNaverProvider,
};
