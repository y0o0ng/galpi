'use strict';

// 본문을 화면에 열어주는 읽기 경로 (설계 10.2·23).
//
// **본문 컬럼은 없다.** 저장하지 않기로 한 것을 위해 열 때마다 Provider에서 다시
// 읽는다. 그래서 이 파일은 분석이 쓰는 것과 정확히 같은 경로를 쓴다 —
// `provider.fetchRaw` → `normalizeMail`. 상한도 분석과 같은 기본값을 그대로 쓴다.
// 새 값을 만들면 화면이 보여주는 텍스트와 판단이 본 텍스트가 조용히 갈라진다.
//
// **읽어도 메일함은 바뀌지 않는다.** IMAP은 `EXAMINE`(read-only) + `BODY.PEEK`이고
// Gmail은 읽기 전용 scope다. 본문 열기가 읽음 처리가 되지 않는 것은 이 파일의
// 조심성이 아니라 그 두 구조가 보장한다(설계 6.2).
//
// **한 계정에서 동시에 하나만 읽는다.** 화면에서 연타하면 IMAP 연결이 그만큼
// 열리고, 그 연결은 동기화 worker가 쓰는 것과 같은 계정 몫이다.

const { normalizeMail } = require('./normalize');

function bodyError(message, code, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

const ACCOUNT_STATUS_ERRORS = {
  disabled: () => bodyError('꺼져 있는 계정의 메일입니다.', 'MAIL_ACCOUNT_DISABLED', 409),
  auth_required: () => bodyError('계정 재인증이 필요합니다.', 'MAIL_ACCOUNT_AUTH_REQUIRED', 409),
};

function createMailBodyReader({ store, providers = {}, credentials, maxBodyChars } = {}) {
  if (typeof store?.findMessageLocator !== 'function') {
    throw new TypeError('Mail store가 필요합니다.');
  }
  const credentialsFor = typeof credentials === 'function' ? credentials : () => ({});
  const reading = new Set();

  async function fetchRaw(locator) {
    const provider = providers[locator.provider];
    if (typeof provider?.fetchRaw !== 'function') {
      throw bodyError('provider 구현이 없습니다.', 'MAIL_PROVIDER_MISSING', 500);
    }
    const account = {
      id: locator.accountId,
      provider: locator.provider,
      address: locator.accountAddress,
    };
    const credential = credentialsFor(account);
    return locator.provider === 'gmail'
      ? provider.fetchRaw(locator.gmailMessageId, { credentials: credential })
      : provider.fetchRaw(
        { imapUid: locator.imapUid, imapUidValidity: locator.imapUidValidity },
        { credentials: credential },
      );
  }

  return {
    async read(id) {
      const locator = store.findMessageLocator(id);
      if (!locator) throw bodyError('메일을 찾을 수 없습니다.', 'MAIL_MESSAGE_NOT_FOUND', 404);
      const statusError = ACCOUNT_STATUS_ERRORS[locator.accountStatus];
      if (statusError) throw statusError();
      if (reading.has(locator.accountId)) {
        throw bodyError('이 계정의 메일을 읽는 중입니다. 잠시 뒤에 다시 눌러줘.', 'MAIL_BODY_BUSY', 429);
      }

      reading.add(locator.accountId);
      try {
        const result = await fetchRaw(locator);
        // Gmail provider는 `{ raw, labels }`를, IMAP provider는 raw 버퍼를 준다.
        const raw = result?.raw !== undefined ? result.raw : result;
        const normalized = await normalizeMail(raw, { maxBodyChars });
        return {
          body: normalized.body,
          bodySource: normalized.bodySource,
          bodyLength: normalized.bodyLength,
          truncated: normalized.truncated,
          // 이름과 크기까지다. 여는 것은 첨부 트랙의 일이고 여기서 열지 않는다.
          attachments: normalized.attachments.map(item => ({
            filename: item.filename,
            size: item.size,
          })),
        };
      } finally {
        reading.delete(locator.accountId);
      }
    },
  };
}

module.exports = { createMailBodyReader };
