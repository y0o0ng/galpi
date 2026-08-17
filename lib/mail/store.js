'use strict';

// Mail Agent의 DB 정본. 계정·커서·메시지의 상태 전이는 전부 여기서 트랜잭션으로 일어난다.
// provider(gmail/naver)는 이 파일을 모르고, agent만 호출한다.
//
// 설계 단일 기준은 docs/xion-mail-agent-design-final.md 8절이다.

const PROVIDERS = new Set(['gmail', 'naver']);
const IDENTITY_KINDS = new Set(['gmail_message', 'rfc_message_id', 'fingerprint']);
const ACCOUNT_STATUSES = new Set(['active', 'auth_required', 'error', 'disabled']);

function mailError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function requireText(value, field, max) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > max) {
    throw mailError(`${field} 값이 올바르지 않습니다.`, 'MAIL_INVALID_FIELD');
  }
  return text;
}

function optionalText(value, max) {
  if (value === undefined || value === null) return null;
  const text = String(value);
  return text.length > max ? text.slice(0, max) : text;
}

function requireInteger(value, field) {
  if (!Number.isSafeInteger(value)) {
    throw mailError(`${field} 값이 올바르지 않습니다.`, 'MAIL_INVALID_FIELD');
  }
  return value;
}

function createMailStore(db, options = {}) {
  if (!db?.prepare || typeof db.transaction !== 'function') {
    throw new TypeError('SQLite DB 연결이 필요합니다.');
  }
  const clock = typeof options.now === 'function' ? options.now : () => Math.floor(Date.now() / 1000);

  function captureNow(value) {
    const current = value === undefined ? clock() : value;
    if (!Number.isFinite(current)) throw new TypeError('Mail store 시계가 올바르지 않습니다.');
    return Math.floor(current);
  }

  const insertAccount = db.prepare(`
    INSERT INTO mail_accounts (provider, address, status, next_sync_at, created_at, updated_at)
    VALUES (@provider, @address, 'active', @now, @now, @now)
    ON CONFLICT(provider, address) DO NOTHING
  `);
  const selectAccountByAddress = db.prepare(`
    SELECT id, provider, address, status,
           next_sync_at AS nextSyncAt, last_sync_at AS lastSyncAt,
           last_error_code AS lastErrorCode, last_error_at AS lastErrorAt,
           auth_alert_sent_at AS authAlertSentAt
    FROM mail_accounts
    WHERE provider = ? AND address = ?
  `);
  const selectAccountById = db.prepare(`
    SELECT id, provider, address, status,
           next_sync_at AS nextSyncAt, last_sync_at AS lastSyncAt,
           last_error_code AS lastErrorCode, last_error_at AS lastErrorAt,
           auth_alert_sent_at AS authAlertSentAt
    FROM mail_accounts
    WHERE id = ?
  `);
  const selectAccounts = db.prepare(`
    SELECT id, provider, address, status,
           next_sync_at AS nextSyncAt, last_sync_at AS lastSyncAt,
           last_error_code AS lastErrorCode, last_error_at AS lastErrorAt,
           auth_alert_sent_at AS authAlertSentAt
    FROM mail_accounts
    ORDER BY id ASC
  `);
  const selectDueAccounts = db.prepare(`
    SELECT id, provider, address, status, next_sync_at AS nextSyncAt
    FROM mail_accounts
    WHERE status = 'active' AND next_sync_at <= @now
    ORDER BY next_sync_at ASC, id ASC
    LIMIT @limit
  `);
  const insertSyncState = db.prepare(`
    INSERT INTO mail_sync_state (account_id, updated_at)
    VALUES (?, ?)
    ON CONFLICT(account_id) DO NOTHING
  `);
  const selectSyncState = db.prepare(`
    SELECT account_id AS accountId,
           gmail_history_id AS gmailHistoryId,
           imap_mailbox AS imapMailbox,
           imap_uid_validity AS imapUidValidity,
           imap_last_uid AS imapLastUid,
           baseline_complete AS baselineComplete
    FROM mail_sync_state
    WHERE account_id = ?
  `);

  const selectAccountByProvider = db.prepare(`
    SELECT id, address FROM mail_accounts WHERE provider = ? LIMIT 1
  `);

  const registerAccount = db.transaction((input, now) => {
    // 자격증명이 provider당 한 세트라 두 번째 계정은 결국 첫 계정의 사서함을 읽는다.
    // DB 인덱스가 이미 막지만, 사람이 읽을 수 있는 이유를 여기서 먼저 준다.
    const existing = selectAccountByProvider.get(input.provider);
    if (existing && existing.address !== input.address) {
      throw mailError(
        `${input.provider} 계정은 하나만 등록할 수 있습니다. 이미 ${existing.address}가 등록되어 있습니다.`,
        'MAIL_PROVIDER_ACCOUNT_LIMIT',
        409,
      );
    }
    insertAccount.run({ provider: input.provider, address: input.address, now });
    const account = selectAccountByAddress.get(input.provider, input.address);
    insertSyncState.run(account.id, now);
    return account;
  });

  const markSynced = db.prepare(`
    UPDATE mail_accounts
    SET status = 'active', last_sync_at = @now, next_sync_at = @nextSyncAt,
        last_error_code = NULL, last_error_at = NULL, auth_alert_sent_at = NULL,
        updated_at = @now
    WHERE id = @id
  `);
  const markAccountError = db.prepare(`
    UPDATE mail_accounts
    SET status = @status, last_error_code = @errorCode, last_error_at = @now,
        next_sync_at = @nextSyncAt, updated_at = @now
    WHERE id = @id
  `);
  const markAuthAlertSent = db.prepare(`
    UPDATE mail_accounts
    SET auth_alert_sent_at = @now, updated_at = @now
    WHERE id = @id AND auth_alert_sent_at IS NULL
  `);
  const setAccountStatus = db.prepare(`
    UPDATE mail_accounts
    SET status = @status, updated_at = @now
    WHERE id = @id
  `);

  // 커서는 "여기까지 읽었다"가 아니라 "여기까지 확실히 저장했다"는 뜻이다.
  // 그래서 전진은 메시지 저장이 끝난 뒤에만, 이 함수로만 일어난다.
  const commitGmailCursor = db.prepare(`
    UPDATE mail_sync_state
    SET gmail_history_id = @historyId, updated_at = @now
    WHERE account_id = @accountId
  `);
  const commitImapCursor = db.prepare(`
    UPDATE mail_sync_state
    SET imap_mailbox = @mailbox, imap_uid_validity = @uidValidity,
        imap_last_uid = @lastUid, updated_at = @now
    WHERE account_id = @accountId
  `);
  const completeBaseline = db.prepare(`
    UPDATE mail_sync_state
    SET baseline_complete = 1, updated_at = @now
    WHERE account_id = @accountId
  `);

  // 같은 메일을 다시 만나면 identity와 판단 상태는 그대로 두고 locator만 갱신한다.
  // resync 뒤에는 옛 UID가 죽어 있으므로, 갱신하지 않으면 나중에 본문을 다시 읽으려는
  // 재분석·원문 열기가 사라진 좌표를 들고 가서 조용히 실패한다.
  // is_baseline과 analysis_state는 건드리지 않는다 — 과거 메일이 재발견을 핑계로
  // 분석 큐에 올라오면 안 된다.
  const insertMessage = db.prepare(`
    INSERT INTO mail_messages (
      account_id, identity_kind, identity_key,
      gmail_message_id, imap_uid_validity, imap_uid, thread_id,
      sender_name, sender_address, subject, received_at,
      has_attachments, is_baseline,
      analysis_state, analysis_next_attempt_at,
      created_at, updated_at
    ) VALUES (
      @accountId, @identityKind, @identityKey,
      @gmailMessageId, @imapUidValidity, @imapUid, @threadId,
      @senderName, @senderAddress, @subject, @receivedAt,
      @hasAttachments, @isBaseline,
      @analysisState, @now,
      @now, @now
    )
    ON CONFLICT(account_id, identity_key) DO UPDATE SET
      gmail_message_id = excluded.gmail_message_id,
      imap_uid_validity = excluded.imap_uid_validity,
      imap_uid = excluded.imap_uid,
      updated_at = excluded.updated_at
  `);
  const selectMessageByIdentity = db.prepare(`
    SELECT m.id, m.account_id AS accountId, a.provider AS provider,
           m.identity_kind AS identityKind, m.identity_key AS identityKey,
           m.imap_uid AS imapUid, m.imap_uid_validity AS imapUidValidity,
           m.gmail_message_id AS gmailMessageId, m.is_baseline AS isBaseline,
           m.analysis_state AS analysisState, m.received_at AS receivedAt
    FROM mail_messages m
    JOIN mail_accounts a ON a.id = m.account_id
    WHERE m.account_id = ? AND m.identity_key = ?
  `);
  const countMessages = db.prepare(`
    SELECT COUNT(*) AS total FROM mail_messages WHERE account_id = ?
  `);

  // ON CONFLICT DO UPDATE는 새로 넣었을 때도 고쳤을 때도 changes가 1이라
  // 그 값으로는 둘을 가를 수 없다. 먼저 있는지 보고 판정한다.
  const saveMessageTransaction = db.transaction((params) => {
    const before = selectMessageByIdentity.get(params.accountId, params.identityKey);
    insertMessage.run(params);
    return {
      message: selectMessageByIdentity.get(params.accountId, params.identityKey),
      inserted: !before,
    };
  });

  return {
    registerAccount(input) {
      const provider = requireText(input?.provider, 'provider', 16);
      if (!PROVIDERS.has(provider)) {
        throw mailError('지원하지 않는 provider입니다.', 'MAIL_UNKNOWN_PROVIDER');
      }
      const address = requireText(input?.address, 'address', 320).toLowerCase();
      return registerAccount({ provider, address }, captureNow(input?.now));
    },

    listAccounts() {
      return selectAccounts.all();
    },

    getAccount(id) {
      return selectAccountById.get(requireInteger(id, 'accountId')) || null;
    },

    // 계정별 next_sync_at이 지난 것만 준다. 한 계정이 죽어도 다른 계정은 계속 돈다.
    listDueAccounts(nowValue, limit = 10) {
      return selectDueAccounts.all({ now: captureNow(nowValue), limit });
    },

    getSyncState(accountId) {
      return selectSyncState.get(requireInteger(accountId, 'accountId')) || null;
    },

    markSynced(accountId, nextSyncAt, nowValue) {
      const now = captureNow(nowValue);
      return markSynced.run({
        id: requireInteger(accountId, 'accountId'),
        nextSyncAt: requireInteger(nextSyncAt, 'nextSyncAt'),
        now,
      }).changes === 1;
    },

    // 인증 실패는 재시도로 풀리지 않는다. 계정을 auth_required로 세우고 sync를 멈춘다.
    markAccountError(accountId, { status = 'error', errorCode = 'MAIL_SYNC_FAILED', nextSyncAt }, nowValue) {
      if (!ACCOUNT_STATUSES.has(status)) {
        throw mailError('지원하지 않는 계정 상태입니다.', 'MAIL_INVALID_STATUS');
      }
      const now = captureNow(nowValue);
      return markAccountError.run({
        id: requireInteger(accountId, 'accountId'),
        status,
        errorCode: String(errorCode).slice(0, 80),
        nextSyncAt: requireInteger(nextSyncAt, 'nextSyncAt'),
        now,
      }).changes === 1;
    },

    // 같은 인증 오류를 매 tick마다 알리지 않기 위해 첫 번째만 true를 준다.
    claimAuthAlert(accountId, nowValue) {
      return markAuthAlertSent.run({
        id: requireInteger(accountId, 'accountId'),
        now: captureNow(nowValue),
      }).changes === 1;
    },

    setAccountStatus(accountId, status, nowValue) {
      if (!ACCOUNT_STATUSES.has(status)) {
        throw mailError('지원하지 않는 계정 상태입니다.', 'MAIL_INVALID_STATUS');
      }
      return setAccountStatus.run({
        id: requireInteger(accountId, 'accountId'),
        status,
        now: captureNow(nowValue),
      }).changes === 1;
    },

    commitGmailCursor(accountId, historyId, nowValue) {
      return commitGmailCursor.run({
        accountId: requireInteger(accountId, 'accountId'),
        historyId: requireText(historyId, 'historyId', 64),
        now: captureNow(nowValue),
      }).changes === 1;
    },

    commitImapCursor(accountId, { mailbox, uidValidity, lastUid }, nowValue) {
      return commitImapCursor.run({
        accountId: requireInteger(accountId, 'accountId'),
        mailbox: requireText(mailbox, 'mailbox', 200),
        // 네이버는 '0'을 준다. 값 자체를 판정에 쓰지 않고 그대로 보관만 한다.
        uidValidity: String(uidValidity ?? ''),
        lastUid: requireInteger(lastUid, 'lastUid'),
        now: captureNow(nowValue),
      }).changes === 1;
    },

    completeBaseline(accountId, nowValue) {
      return completeBaseline.run({
        accountId: requireInteger(accountId, 'accountId'),
        now: captureNow(nowValue),
      }).changes === 1;
    },

    // 같은 메일을 다시 만나면 새 행을 만들지 않는다. cursor replay가 안전한 이유가
    // 이것이다. provider는 받지 않는다 — 계정이 이미 정하고 있다.
    // baseline 구간의 메일은 분석 큐에 들어가지 않도록 skipped로 들어간다.
    saveMessage(input, nowValue) {
      const now = captureNow(nowValue);
      const identityKind = requireText(input?.identityKind, 'identityKind', 32);
      if (!IDENTITY_KINDS.has(identityKind)) {
        throw mailError('지원하지 않는 identity 종류입니다.', 'MAIL_INVALID_IDENTITY');
      }
      const accountId = requireInteger(input?.accountId, 'accountId');
      const identityKey = requireText(input?.identityKey, 'identityKey', 500);
      const isBaseline = input?.isBaseline ? 1 : 0;

      return saveMessageTransaction({
        accountId,
        identityKind,
        identityKey,
        gmailMessageId: optionalText(input?.gmailMessageId, 128),
        imapUidValidity: optionalText(input?.imapUidValidity, 32),
        imapUid: Number.isSafeInteger(input?.imapUid) ? input.imapUid : null,
        threadId: optionalText(input?.threadId, 128),
        senderName: optionalText(input?.senderName, 200),
        senderAddress: optionalText(input?.senderAddress, 320),
        subject: optionalText(input?.subject, 500),
        receivedAt: requireInteger(input?.receivedAt, 'receivedAt'),
        hasAttachments: input?.hasAttachments ? 1 : 0,
        isBaseline,
        analysisState: isBaseline ? 'skipped' : 'pending',
        now,
      });
    },

    findMessageByIdentity(accountId, identityKey) {
      return selectMessageByIdentity.get(
        requireInteger(accountId, 'accountId'),
        requireText(identityKey, 'identityKey', 500),
      ) || null;
    },

    countMessages(accountId) {
      return countMessages.get(requireInteger(accountId, 'accountId')).total;
    },
  };
}

module.exports = { createMailStore };
