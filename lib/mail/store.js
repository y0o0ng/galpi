'use strict';

// Mail Agent의 DB 정본. 계정·커서·메시지의 상태 전이는 전부 여기서 트랜잭션으로 일어난다.
// provider(gmail/naver/works)는 이 파일을 모르고, agent만 호출한다.
//
// 설계 단일 기준은 docs/xion-mail-agent-design-final.md 8절이다.

const PROVIDERS = new Set(['gmail', 'naver', 'works']);
const IDENTITY_KINDS = new Set(['gmail_message', 'rfc_message_id', 'fingerprint']);
const ACCOUNT_STATUSES = new Set(['active', 'auth_required', 'error', 'disabled']);
const CATEGORIES = new Set(['urgent', 'action_required', 'important', 'info', 'ignore']);
const NOTIFICATION_MODES = new Set(['immediate', 'batch', 'silent']);
const ATTENTION_REASONS = new Set(['action_required', 'attachment_check', 'low_confidence']);
const PREFERENCE_TYPES = new Set(['sender', 'domain', 'category']);
// 설계 8.5가 고정한 세 값이다. 지금 라우팅이 집행하는 것은 `suppress_notification`
// 하나이고, 나머지 둘은 사용자가 명시적으로 말해야 저장되는 값이라 대화 경로가
// 열릴 때 함께 연다. 만들 통로가 없는 값을 미리 집행하지 않는다(설계 11.1).
const PREFERENCE_ACTIONS = new Set(['suppress_notification', 'always_notify', 'skip_analysis']);

// 검색 결과는 대화 컨텍스트로 들어간다. 상한이 없으면 넓은 질문 하나가 답변을
// 메일 목록 낭독으로 만든다.
const DEFAULT_SEARCH_RESULTS = 8;
const MAX_SEARCH_RESULTS = 20;

// 사용자가 만지는 알림 설정. 미리보기(숨김/표시)는 2026-08-18에 없앴다 — 설정이
// 있으면 서버에 민감 내용을 payload에 넣는 분기가 존재하고, 그 분기가 있는 한
// 버그 하나로 샌다(설계 13.1). 그래서 남은 값은 둘뿐이다.
//
// 기존 `app_settings` 표를 공유하고 메일 전용 표를 만들지 않는다. `model-settings.js`의
// allowlist에 메일 key를 섞지도 않는다 — 그 모듈은 모델 설정만 맡는다.
const MAIL_SETTING_KEYS = {
  notificationsEnabled: 'mail.notifications_enabled',
  quietHours: 'mail.quiet_hours',
};
const DEFAULT_MAIL_SETTINGS = {
  notificationsEnabled: true,
  quietHours: { enabled: true, start: '23:00', end: '07:00' },
};

const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function validateQuietHours(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw mailError('quiet hours 설정 모양이 올바르지 않습니다.', 'MAIL_INVALID_SETTING');
  }
  if (typeof value.enabled !== 'boolean') {
    throw mailError('quiet hours 설정의 enabled는 boolean이어야 합니다.', 'MAIL_INVALID_SETTING');
  }
  for (const field of ['start', 'end']) {
    if (!CLOCK_PATTERN.test(String(value[field] ?? ''))) {
      throw mailError(`quiet hours 설정의 ${field}는 HH:MM이어야 합니다.`, 'MAIL_INVALID_SETTING');
    }
  }
  return { enabled: value.enabled, start: value.start, end: value.end };
}

// lease는 "본문 재조회 + LLM 한 번"보다 넉넉해야 한다. 짧으면 살아 있는 worker의 일을
// 다른 tick이 뺏어 같은 메일을 두 번 분석한다.
const DEFAULT_ANALYSIS_LEASE_SECONDS = 180;
// 상한을 넘으면 failed로 끝내고 사람에게 보인다(설계 9.2).
const DEFAULT_MAX_ANALYSIS_ATTEMPTS = 5;
const MAX_ANALYSIS_BACKOFF_SECONDS = 60 * 60;

// assistant_push_deliveries와 같은 곡선이다. 여기만 다른 규칙을 쓸 이유가 없다.
function analysisBackoffSeconds(attemptCount) {
  const attempt = Math.max(1, Number(attemptCount) || 1);
  return Math.min(60 * (2 ** (attempt - 1)), MAX_ANALYSIS_BACKOFF_SECONDS);
}

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
  // 다시 켠다는 것은 "지금 다시 해보라"는 뜻이다. 옛 일정을 그대로 두면 자격증명을
  // 고쳐놓고도 몇 분간 아무 일이 없어서 고쳐진 건지 아닌지 알 수 없고, 지난 오류가
  // 남아 있으면 다음 성공까지 화면이 낡은 사유를 보여준다.
  const reactivateAccount = db.prepare(`
    UPDATE mail_accounts
    SET status = 'active', next_sync_at = @now,
        last_error_code = NULL, last_error_at = NULL, auth_alert_sent_at = NULL,
        updated_at = @now
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

  // ── 분석 큐 (설계 9.2) ─────────────────────────────────────────────────────
  // 갈피 Codex queue의 stranded job을 반복하지 않는다. 실패한 작업이 아무도 집지 않는
  // 상태로 남거나, 프로세스가 죽어 analyzing에 영원히 갇히는 경로를 만들지 않는다.

  // 죽은 worker가 들고 있던 일은 lease가 끝나면 회수한다. 이것이 없으면 프로세스
  // 강제 종료 한 번이 그 메일을 영구히 analyzing으로 못박는다.
  const reclaimExpiredLeases = db.prepare(`
    UPDATE mail_messages
    SET analysis_state = 'pending', analysis_lease_until = NULL,
        analysis_next_attempt_at = @now,
        analysis_last_error = 'WORKER_LEASE_EXPIRED', updated_at = @now
    WHERE analysis_state = 'analyzing' AND analysis_lease_until <= @now
  `);
  // 계정이 active가 아니면 분석도 provider를 때리지 않는다. listDueAccounts가 이미
  // active만 집는데 분석만 계정 상태를 안 보면, 인증이 끊긴 계정의 pending이 매 tick
  // 실패해 재시도 상한을 태우고 좌초로 남는다 — 사람이 할 일은 재인증인데 화면에는
  // 분석 실패로 보인다. 행은 pending 그대로 두고 집지만 않으므로, 계정이 다시 active가
  // 되면 별도 장치 없이 그 자리에서 재개된다.
  const selectAnalysisCandidates = db.prepare(`
    SELECT m.id
    FROM mail_messages m
    JOIN mail_accounts a ON a.id = m.account_id
    WHERE m.analysis_state = 'pending' AND m.analysis_next_attempt_at <= @now
      AND a.status = 'active'
    ORDER BY m.analysis_next_attempt_at ASC, m.id ASC
    LIMIT @limit
  `);
  // 집는 것과 상태 전이가 한 문장이다. 두 tick이 겹쳐도 changes가 1인 쪽만 이긴다.
  const claimAnalysis = db.prepare(`
    UPDATE mail_messages
    SET analysis_state = 'analyzing', analysis_lease_until = @leaseUntil,
        analysis_attempt_count = analysis_attempt_count + 1,
        updated_at = @now
    WHERE id = @id AND analysis_state = 'pending' AND analysis_next_attempt_at <= @now
  `);
  const selectAnalysisJob = db.prepare(`
    SELECT m.id, m.account_id AS accountId, a.provider AS provider, a.address AS accountAddress,
           m.gmail_message_id AS gmailMessageId,
           m.imap_uid AS imapUid, m.imap_uid_validity AS imapUidValidity,
           m.thread_id AS threadId, m.subject, m.sender_name AS senderName,
           m.sender_address AS senderAddress, m.received_at AS receivedAt,
           m.has_attachments AS hasAttachments,
           m.analysis_attempt_count AS attemptCount,
           m.analysis_lease_until AS leaseUntil
    FROM mail_messages m
    JOIN mail_accounts a ON a.id = m.account_id
    WHERE m.id = ?
  `);

  // 판단 결과와 provenance는 한 문장에서 같이 들어간다. 판단만 남고 어떤 모델·프롬프트가
  // 냈는지 모르는 행이 생기면 나중에 오탐을 되짚을 수 없다(설계 10.5).
  // lease 조건이 붙어 있어서, 회수된 뒤 늦게 돌아온 worker는 남의 판단을 덮지 못한다.
  const settleAnalysisDone = db.prepare(`
    UPDATE mail_messages
    SET analysis_state = 'done', analysis_lease_until = NULL,
        analysis_last_error = NULL,
        analyzed_at = @now, analyzer_model = @analyzerModel,
        analyzer_prompt_version = @promptVersion,
        category = @category, importance = @importance,
        summary = @summary, action_text = @actionText,
        deadline_kind = @deadlineKind, deadline_date = @deadlineDate, deadline_at = @deadlineAt,
        notification_mode = @notificationMode,
        decision_reason = @decisionReason, decision_confidence = @decisionConfidence,
        needs_attachment_analysis = @needsAttachmentAnalysis,
        updated_at = @now
    WHERE id = @id AND analysis_state = 'analyzing' AND analysis_lease_until = @leaseUntil
  `);
  const settleAnalysisRetry = db.prepare(`
    UPDATE mail_messages
    SET analysis_state = 'pending', analysis_lease_until = NULL,
        analysis_next_attempt_at = @nextAttemptAt,
        analysis_last_error = @errorCode, updated_at = @now
    WHERE id = @id AND analysis_state = 'analyzing' AND analysis_lease_until = @leaseUntil
  `);
  const settleAnalysisFailed = db.prepare(`
    UPDATE mail_messages
    SET analysis_state = 'failed', analysis_lease_until = NULL,
        analysis_last_error = @errorCode, updated_at = @now
    WHERE id = @id AND analysis_state = 'analyzing' AND analysis_lease_until = @leaseUntil
  `);
  const settleAnalysisSkipped = db.prepare(`
    UPDATE mail_messages
    SET analysis_state = 'skipped', analysis_lease_until = NULL,
        analysis_last_error = @errorCode, updated_at = @now
    WHERE id = @id AND analysis_state = 'analyzing' AND analysis_lease_until = @leaseUntil
  `);
  // 사람이 누르는 `대기열 다시 처리`. attempt_count를 0으로 되돌리지 않으면 되살린
  // 즉시 다시 상한에 걸린다.
  const requeueFailedAnalysis = db.prepare(`
    UPDATE mail_messages
    SET analysis_state = 'pending', analysis_attempt_count = 0,
        analysis_next_attempt_at = @now, analysis_lease_until = NULL,
        updated_at = @now
    WHERE analysis_state = 'failed'
  `);
  const countAnalysisStates = db.prepare(`
    SELECT analysis_state AS state, COUNT(*) AS total
    FROM mail_messages
    GROUP BY analysis_state
  `);
  const selectStrandedAnalysis = db.prepare(`
    SELECT m.id, m.account_id AS accountId,
           m.analysis_attempt_count AS attemptCount,
           m.analysis_last_error AS lastError, m.received_at AS receivedAt
    FROM mail_messages m
    WHERE m.analysis_state = 'failed'
    ORDER BY m.received_at DESC, m.id DESC
    LIMIT @limit
  `);

  // 힌트 재료 (설계 9.3). 판단이 아니라 모델이 참고할 사실만 센다.
  // 자기 자신은 빼고 센다 — 방금 저장한 메일 때문에 처음 온 발신자가 senderKnown이 된다.
  const countSenderHistory = db.prepare(`
    SELECT
      SUM(CASE WHEN sender_address = @senderAddress THEN 1 ELSE 0 END) AS senderCount,
      SUM(CASE WHEN sender_address LIKE @domainPattern THEN 1 ELSE 0 END) AS domainCount
    FROM mail_messages
    WHERE account_id = @accountId AND id != @excludeId
  `);
  const countThreadHistory = db.prepare(`
    SELECT COUNT(*) AS total FROM mail_messages
    WHERE account_id = @accountId AND thread_id = @threadId AND id != @excludeId
  `);
  // account_id가 NULL인 행은 모든 계정에 적용한다.
  const selectPreferences = db.prepare(`
    SELECT id, account_id AS accountId, preference_type AS preferenceType,
           target, action, weight, note
    FROM mail_preferences
    WHERE (account_id IS NULL OR account_id = @accountId)
      AND (
        (preference_type = 'sender' AND target = @senderAddress) OR
        (preference_type = 'domain' AND target = @senderDomain) OR
        (preference_type = 'category' AND @category IS NOT NULL AND target = @category)
      )
    ORDER BY
      -- 좁은 규칙이 먼저다. sender > domain > category (설계 11.3).
      CASE preference_type WHEN 'sender' THEN 0 WHEN 'domain' THEN 1 ELSE 2 END,
      id ASC
  `);

  // ── 검색 (설계 4·11.1) ─────────────────────────────────────────────────────
  // **본문 검색이 아니다.** 본문은 저장하지 않으므로(설계 23) 찾을 수 있는 것은
  // 제목·발신자와 판단이 남긴 요약·행동·분류·기한이다.
  //
  // silent로 판정했거나 사용자가 알림을 끈 발신자의 메일도 그대로 나온다. 알림을
  // 껐다는 이유로 기록을 잃지 않는 것이 설계 11.1의 계약이다.
  const searchMessages = db.prepare(`
    SELECT m.id, m.subject, m.sender_name AS senderName, m.sender_address AS senderAddress,
           m.summary, m.action_text AS actionText, m.category, m.importance,
           m.deadline_kind AS deadlineKind, m.deadline_date AS deadlineDate,
           m.deadline_at AS deadlineAt, m.received_at AS receivedAt,
           m.has_attachments AS hasAttachments,
           acc.provider,
           a.state AS attentionState
    FROM mail_messages m
    JOIN mail_accounts acc ON acc.id = m.account_id
    LEFT JOIN mail_attention a ON a.mail_message_id = m.id
    WHERE (@query IS NULL OR (
        m.subject LIKE @like ESCAPE '\\'
        OR m.sender_name LIKE @like ESCAPE '\\'
        OR m.sender_address LIKE @like ESCAPE '\\'
        OR m.summary LIKE @like ESCAPE '\\'
        OR m.action_text LIKE @like ESCAPE '\\'
      ))
      AND (@category IS NULL OR m.category = @category)
      AND (@sender IS NULL OR m.sender_address = @sender)
      AND (@since IS NULL OR m.received_at >= @since)
      AND (@until IS NULL OR m.received_at <= @until)
      AND (@needsAction = 0 OR a.state = 'open')
    ORDER BY m.received_at DESC, m.id DESC
    LIMIT @limit
  `);

  const insertAttention = db.prepare(`
    INSERT INTO mail_attention (mail_message_id, thread_ref, reason_kind, created_at, updated_at)
    VALUES (@mailMessageId, @threadRef, @reasonKind, @now, @now)
    ON CONFLICT(mail_message_id) DO NOTHING
  `);
  // ── Attention lifecycle (설계 12·13.4) ────────────────────────────────────
  // Attention은 "사용자가 잊으면 안 되는 후속 행동"의 정본이다. Push 전달 기록과
  // 다른 축이라 여기(store)가 소유하고, 전달은 회차로만 연결된다.
  const snoozeAttention = db.prepare(`
    UPDATE mail_attention
    SET state = 'snoozed', snoozed_until = @until, resolved_at = NULL, updated_at = @now
    WHERE id = @id AND state = 'open'
  `);
  const resolveAttention = db.prepare(`
    UPDATE mail_attention
    SET state = 'done', snoozed_until = NULL, resolved_at = @now, updated_at = @now
    WHERE id = @id AND state IN ('open', 'snoozed')
  `);
  const selectDueSnoozed = db.prepare(`
    SELECT id, mail_message_id AS mailMessageId, notify_seq AS notifySeq
    FROM mail_attention
    WHERE state = 'snoozed' AND snoozed_until <= @now
    ORDER BY snoozed_until ASC, id ASC
  `);
  // 깨우면서 회차를 올린다. 회차가 과거 delivery와 새 delivery를 가르는 값이라
  // 이 증가와 재알림이 갈라지면 사용자는 영영 못 받고 DB는 그것을 모른다.
  const wakeAttention = db.prepare(`
    UPDATE mail_attention
    SET state = 'open', snoozed_until = NULL, notify_seq = notify_seq + 1, updated_at = @now
    WHERE id = @id AND state = 'snoozed'
  `);
  // 알림 탭에 합류할 Attention. **메일함이 아니라 주의가 필요한 것만** 보여준다
  // (설계 4.2). snoozed는 사용자가 스스로 미룬 것이라 목록에서도 빠진다.
  const selectOpenAttention = db.prepare(`
    SELECT a.id AS attentionId, a.reason_kind AS reasonKind, a.notify_seq AS notifySeq,
           m.id AS mailMessageId, m.subject, m.sender_name AS senderName,
           m.sender_address AS senderAddress, m.summary, m.action_text AS actionText,
           m.deadline_kind AS deadlineKind, m.deadline_date AS deadlineDate,
           m.deadline_at AS deadlineAt, m.received_at AS receivedAt,
           m.account_id AS accountId, acc.provider
    FROM mail_attention a
    JOIN mail_messages m ON m.id = a.mail_message_id
    JOIN mail_accounts acc ON acc.id = m.account_id
    WHERE a.state = 'open'
    ORDER BY m.received_at DESC, a.id DESC
    LIMIT @limit
  `);

  const selectSetting = db.prepare('SELECT value_json AS valueJson FROM app_settings WHERE key = ?');
  const upsertSetting = db.prepare(`
    INSERT INTO app_settings (key, value_json, updated_at)
    VALUES (@key, @valueJson, @now)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      version = version + 1,
      updated_at = excluded.updated_at
  `);
  // 두 값을 함께 저장한다. 하나만 들어간 상태로 끝나면 화면과 서버가 어긋난다.
  const saveSettings = db.transaction((writes, now) => {
    for (const [key, value] of writes) {
      upsertSetting.run({ key, valueJson: JSON.stringify(value), now });
    }
  });

  // ── Preference 쓰기 (설계 8.5·11) ──────────────────────────────────────────
  // 읽기(이번 메일에 매칭되는 선호)는 위 `selectPreferences`가 이미 맡는다. 여기는
  // 사용자가 만들고 지우는 경로다.
  const insertPreference = db.prepare(`
    INSERT INTO mail_preferences (
      account_id, preference_type, target, action, note, created_at, updated_at
    ) VALUES (@accountId, @preferenceType, @target, @action, @note, @now, @now)
    ON CONFLICT(account_id, preference_type, target, action) DO NOTHING
  `);
  const selectPreference = db.prepare(`
    SELECT id, account_id AS accountId, preference_type AS preferenceType,
           target, action, note, created_at AS createdAt
    FROM mail_preferences
    WHERE account_id IS @accountId AND preference_type = @preferenceType
      AND target = @target AND action = @action
  `);
  const selectAllPreferences = db.prepare(`
    SELECT p.id, p.account_id AS accountId, p.preference_type AS preferenceType,
           p.target, p.action, p.note, p.created_at AS createdAt,
           a.provider
    FROM mail_preferences p
    LEFT JOIN mail_accounts a ON a.id = p.account_id
    ORDER BY p.created_at DESC, p.id DESC
  `);
  const deletePreference = db.prepare('DELETE FROM mail_preferences WHERE id = ?');

  const selectAttentionById = db.prepare(`
    SELECT id, mail_message_id AS mailMessageId, state, notify_seq AS notifySeq,
           snoozed_until AS snoozedUntil, resolved_at AS resolvedAt
    FROM mail_attention WHERE id = ?
  `);
  const selectAttentionByMessage = db.prepare(`
    SELECT id, mail_message_id AS mailMessageId, thread_ref AS threadRef,
           state, reason_kind AS reasonKind, notify_seq AS notifySeq
    FROM mail_attention
    WHERE mail_message_id = ?
  `);

  // 같은 스레드에 아직 살아 있는 Attention (설계 27). `open`과 `snoozed`가 대상이고
  // `done`은 아니다. 끝낸 스레드에 새 메일이 오면 그것은 새로운 후속 행동이다.
  //
  // `thread_ref`가 NULL인 것끼리는 절대 묶지 않는다. 네이버는 표준 thread id가 없어
  // 전부 NULL이라, NULL을 같은 값으로 취급하면 남남인 메일이 한 Attention에 들어간다.
  const selectLivingThreadAttention = db.prepare(`
    SELECT id FROM mail_attention
    WHERE thread_ref IS NOT NULL AND thread_ref = @threadRef
      AND state IN ('open', 'snoozed')
    ORDER BY id ASC LIMIT 1
  `);
  // 대상 메일만 최신으로 옮긴다. 카드가 스레드의 지금 상태를 보여줘야 하기 때문이다.
  // 상태·회차·미룬 시각은 건드리지 않는다 — 그것들은 사용자가 정한 값이다.
  const repointAttention = db.prepare(`
    UPDATE mail_attention
    SET mail_message_id = @mailMessageId, updated_at = @now
    WHERE id = @id
  `);

  // 판단과 Attention은 같은 트랜잭션에서 끝난다. 갈라 놓으면 사이에서 죽었을 때
  // "행동이 필요하다"고 판단해 놓고 어디에도 남지 않은 메일이 생긴다.
  const settleAnalysisTransaction = db.transaction((params, attention) => {
    if (settleAnalysisDone.run(params).changes !== 1) return { settled: false, attention: null };
    if (!attention) return { settled: true, attention: null };
    // 스레드 묶기는 Attention 축에서만 일어난다. 알림 라우팅은 메일마다 그대로
    // 판단되며(v20에서 갈라놓은 다른 축) 이 경로가 건드리지 않는다.
    const living = attention.threadRef ? selectLivingThreadAttention.get(attention) : null;
    if (living) {
      repointAttention.run({ id: living.id, mailMessageId: attention.mailMessageId, now: attention.now });
      return { settled: true, attention: selectAttentionByMessage.get(params.id) };
    }
    insertAttention.run(attention);
    return { settled: true, attention: selectAttentionByMessage.get(params.id) };
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
      const id = requireInteger(accountId, 'accountId');
      const now = captureNow(nowValue);
      if (status === 'active') return reactivateAccount.run({ id, now }).changes === 1;
      return setAccountStatus.run({ id, status, now }).changes === 1;
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

    /**
     * 분석할 메일을 lease와 함께 집는다.
     *
     * 회수를 먼저 하는 이유는 죽은 worker의 일이 이번 tick의 후보가 되어야 하기 때문이다.
     * 나중에 하면 매 tick이 한 박자씩 늦게 회수한다.
     */
    claimAnalysisJobs(nowValue, { limit = 5, leaseSeconds = DEFAULT_ANALYSIS_LEASE_SECONDS } = {}) {
      const now = captureNow(nowValue);
      reclaimExpiredLeases.run({ now });
      const leaseUntil = now + leaseSeconds;
      const claimed = [];
      for (const row of selectAnalysisCandidates.all({ now, limit })) {
        if (claimAnalysis.run({ id: row.id, now, leaseUntil }).changes !== 1) continue;
        claimed.push(selectAnalysisJob.get(row.id));
      }
      return claimed;
    },

    reclaimExpiredAnalysisLeases(nowValue) {
      return reclaimExpiredLeases.run({ now: captureNow(nowValue) }).changes;
    },

    /**
     * 판단을 확정하고, 필요하면 같은 트랜잭션에서 Attention을 만든다.
     *
     * `leaseUntil`은 집을 때 받은 값 그대로여야 한다. 그래야 lease가 회수된 뒤 늦게
     * 돌아온 worker가 다른 worker의 판단을 덮어쓰지 못한다.
     */
    completeAnalysis(id, decision, nowValue) {
      const now = captureNow(nowValue);
      const messageId = requireInteger(id, 'id');
      const category = decision?.category ?? null;
      if (category !== null && !CATEGORIES.has(category)) {
        throw mailError('지원하지 않는 category입니다.', 'MAIL_INVALID_CATEGORY');
      }
      const notificationMode = decision?.notificationMode ?? null;
      if (notificationMode !== null && !NOTIFICATION_MODES.has(notificationMode)) {
        throw mailError('지원하지 않는 알림 모드입니다.', 'MAIL_INVALID_NOTIFICATION_MODE');
      }
      const reasonKind = decision?.attentionReason ?? null;
      if (reasonKind !== null && !ATTENTION_REASONS.has(reasonKind)) {
        throw mailError('지원하지 않는 Attention 사유입니다.', 'MAIL_INVALID_ATTENTION_REASON');
      }
      return settleAnalysisTransaction({
        id: messageId,
        leaseUntil: requireInteger(decision?.leaseUntil, 'leaseUntil'),
        now,
        analyzerModel: optionalText(decision?.analyzerModel, 80),
        promptVersion: optionalText(decision?.analyzerPromptVersion, 40),
        category,
        importance: Number.isFinite(decision?.importance) ? decision.importance : null,
        summary: optionalText(decision?.summary, 500),
        actionText: optionalText(decision?.actionText, 500),
        // 날짜만 말한 메일에 시각을 만들어 붙이지 않는다(설계 8.3 Deadline 계약).
        deadlineKind: decision?.deadlineKind || 'none',
        deadlineDate: decision?.deadlineKind === 'date' ? optionalText(decision.deadlineDate, 10) : null,
        deadlineAt: decision?.deadlineKind === 'datetime' && Number.isSafeInteger(decision.deadlineAt)
          ? decision.deadlineAt
          : null,
        notificationMode,
        decisionReason: optionalText(decision?.decisionReason, 500),
        decisionConfidence: Number.isFinite(decision?.decisionConfidence) ? decision.decisionConfidence : null,
        needsAttachmentAnalysis: decision?.needsAttachmentAnalysis ? 1 : 0,
      }, reasonKind ? {
        mailMessageId: messageId,
        // v1에서는 Gmail thread_id를 그대로 넣고 네이버는 NULL이다. 이 값을 읽어
        // 동작을 바꾸는 로직은 아직 없다(설계 8.4).
        threadRef: optionalText(decision?.threadRef, 128),
        reasonKind,
        now,
      } : null);
    },

    /**
     * 실패를 정산한다. 상한 안이면 backoff 후 pending, 넘으면 failed다.
     *
     * failed는 버린 것이 아니라 사람이 보는 상태다. 에이전트 탭이 개수와 함께 노출하고
     * `대기열 다시 처리`가 되살린다.
     */
    failAnalysis(id, { leaseUntil, errorCode = 'MAIL_ANALYSIS_FAILED', attemptCount, maxAttempts = DEFAULT_MAX_ANALYSIS_ATTEMPTS }, nowValue) {
      const now = captureNow(nowValue);
      const params = {
        id: requireInteger(id, 'id'),
        leaseUntil: requireInteger(leaseUntil, 'leaseUntil'),
        errorCode: String(errorCode).slice(0, 200),
        now,
      };
      if (Number(attemptCount) >= maxAttempts) {
        return { state: 'failed', changed: settleAnalysisFailed.run(params).changes === 1 };
      }
      const nextAttemptAt = now + analysisBackoffSeconds(attemptCount);
      return {
        state: 'pending',
        nextAttemptAt,
        changed: settleAnalysisRetry.run({ ...params, nextAttemptAt }).changes === 1,
      };
    },

    // 분석 대상이 아니라고 판명된 경우다 — 사용자가 휴지통으로 옮겼거나 skip_analysis
    // preference에 걸린 메일이 재시도 상한까지 돌다가 좌초로 보이면 안 된다.
    skipAnalysis(id, { leaseUntil, errorCode = 'MAIL_ANALYSIS_SKIPPED' }, nowValue) {
      return settleAnalysisSkipped.run({
        id: requireInteger(id, 'id'),
        leaseUntil: requireInteger(leaseUntil, 'leaseUntil'),
        errorCode: String(errorCode).slice(0, 200),
        now: captureNow(nowValue),
      }).changes === 1;
    },

    requeueFailedAnalysis(nowValue) {
      return requeueFailedAnalysis.run({ now: captureNow(nowValue) }).changes;
    },

    analysisSummary() {
      const summary = { pending: 0, analyzing: 0, done: 0, failed: 0, skipped: 0 };
      for (const row of countAnalysisStates.all()) summary[row.state] = row.total;
      return summary;
    },

    listStrandedAnalysis(limit = 20) {
      return selectStrandedAnalysis.all({ limit });
    },

    // 이 발신자·도메인·스레드를 전에 본 적이 있는가. 참고 정보일 뿐 판단이 아니다.
    senderHistory({ accountId, senderAddress, senderDomain, threadId, excludeId }) {
      const address = String(senderAddress || '').toLowerCase();
      const domain = String(senderDomain || '').toLowerCase();
      const row = countSenderHistory.get({
        accountId: requireInteger(accountId, 'accountId'),
        senderAddress: address,
        domainPattern: domain ? `%@${domain}` : ' ',
        excludeId: Number.isSafeInteger(excludeId) ? excludeId : 0,
      });
      const threadCount = threadId
        ? countThreadHistory.get({
          accountId,
          threadId: String(threadId),
          excludeId: Number.isSafeInteger(excludeId) ? excludeId : 0,
        }).total
        : 0;
      return {
        senderCount: row?.senderCount || 0,
        domainCount: row?.domainCount || 0,
        threadCount,
      };
    },

    findMatchingPreferences({ accountId, senderAddress, senderDomain, category = null }) {
      return selectPreferences.all({
        accountId: requireInteger(accountId, 'accountId'),
        senderAddress: String(senderAddress || '').toLowerCase(),
        senderDomain: String(senderDomain || '').toLowerCase(),
        category,
      });
    },

    /**
     * `내일 다시 알려줘`. 상태만 바꾸고 아직 안 나간 Push는 claim 단계가 자격을
     * 다시 보면서 건너뛴다.
     *
     * 과거 시각으로는 미룰 수 없다. 다음 tick이 즉시 깨워서 미룬 의미가 없다.
     */
    snoozeAttention(id, until, nowValue) {
      const now = captureNow(nowValue);
      const attentionId = requireInteger(id, 'attentionId');
      if (!Number.isSafeInteger(until) || until <= now) {
        throw mailError('snooze 시각은 현재보다 뒤여야 합니다.', 'MAIL_INVALID_SNOOZE');
      }
      const changed = snoozeAttention.run({ id: attentionId, until, now }).changes === 1;
      return { changed, ...selectAttentionById.get(attentionId) };
    },

    // 두 번 눌러도 오류가 아니다. 이미 끝난 것은 끝난 것이고 해결 시각을 덮지 않는다.
    resolveAttention(id, nowValue) {
      const now = captureNow(nowValue);
      const attentionId = requireInteger(id, 'attentionId');
      const changed = resolveAttention.run({ id: attentionId, now }).changes === 1;
      return { changed, ...selectAttentionById.get(attentionId) };
    },

    /**
     * 깨어날 때가 된 Attention을 OPEN으로 되돌리고 재알림까지 한다.
     *
     * `onWake`는 **같은 트랜잭션 안에서** 불린다. 재알림에 실패하면 회차 증가도
     * 함께 되돌아가 다음 tick이 다시 시도한다 — 회차만 오르고 알림이 안 나가는
     * 상태를 DB가 잡아줄 방법이 없기 때문이다.
     */
    wakeDueAttention(nowValue, onWake) {
      const now = captureNow(nowValue);
      const wake = db.transaction(item => {
        if (wakeAttention.run({ id: item.id, now }).changes !== 1) return false;
        onWake({
          attentionId: item.id,
          mailMessageId: item.mailMessageId,
          notifySeq: item.notifySeq + 1,
        });
        return true;
      });
      let woken = 0;
      for (const item of selectDueSnoozed.all({ now })) {
        if (wake(item)) woken += 1;
      }
      return { woken };
    },

    /**
     * 저장된 값이 깨졌으면 기본값으로 읽는다. 깨진 설정 하나가 알림을 영구히
     * 침묵시키는 것이 늦게 울리는 것보다 나쁘다.
     */
    getMailSettings() {
      const read = (key, fallback, parse) => {
        const row = selectSetting.get(key);
        if (!row) return fallback;
        try {
          return parse(JSON.parse(row.valueJson));
        } catch {
          return fallback;
        }
      };
      return {
        notificationsEnabled: read(
          MAIL_SETTING_KEYS.notificationsEnabled,
          DEFAULT_MAIL_SETTINGS.notificationsEnabled,
          value => (typeof value === 'boolean' ? value : DEFAULT_MAIL_SETTINGS.notificationsEnabled),
        ),
        quietHours: read(
          MAIL_SETTING_KEYS.quietHours,
          DEFAULT_MAIL_SETTINGS.quietHours,
          value => validateQuietHours(value),
        ),
      };
    },

    // 모양을 먼저 검증한다. 깨진 값을 저장하면 읽을 때 조용히 기본값으로 떨어져서
    // 사용자가 바꾼 줄 알고 있는데 안 바뀐 상태가 된다.
    saveMailSettings(input, nowValue) {
      const now = captureNow(nowValue);
      const patch = input && typeof input === 'object' ? input : {};
      const writes = [];
      if (patch.notificationsEnabled !== undefined) {
        if (typeof patch.notificationsEnabled !== 'boolean') {
          throw mailError('알림 On/Off 설정은 boolean이어야 합니다.', 'MAIL_INVALID_SETTING');
        }
        writes.push([MAIL_SETTING_KEYS.notificationsEnabled, patch.notificationsEnabled]);
      }
      if (patch.quietHours !== undefined) {
        writes.push([MAIL_SETTING_KEYS.quietHours, validateQuietHours(patch.quietHours)]);
      }
      saveSettings(writes, now);
      return this.getMailSettings();
    },

    /**
     * 알림 탭이 쓰는 목록. 기존 notification item과 같은 모양으로 맞춰 `/api/notifications`에
     * 합류시킨다 — 메일 전용 polling API를 하나 더 만들지 않는다(설계 22.3).
     *
     * 본문은 담지 않는다. 카드가 보여줄 것은 제목·요약·행동·기한까지이고 메일함
     * 브라우징은 이 화면의 일이 아니다(설계 23).
     */
    listAttentionNotifications(limit = 20) {
      return selectOpenAttention.all({ limit }).map(item => ({
        id: `mail-attention:${item.attentionId}`,
        source: 'mail',
        type: 'mail_attention',
        attentionId: item.attentionId,
        mailMessageId: item.mailMessageId,
        reasonKind: item.reasonKind,
        notifySeq: item.notifySeq,
        provider: item.provider,
        title: item.subject || '(제목 없음)',
        sender: item.senderName || item.senderAddress || null,
        // 카드의 `알림 끄기`가 만들 선호의 target이다. 화면에 그리는 이름과 달리
        // 규칙은 주소로만 좁힐 수 있다(설계 3.4).
        senderAddress: item.senderAddress || null,
        accountId: item.accountId,
        text: item.summary || null,
        action: item.actionText || null,
        deadlineKind: item.deadlineKind,
        deadlineDate: item.deadlineDate,
        deadlineAt: item.deadlineAt,
        receivedAt: item.receivedAt,
      }));
    },

    findAttentionById(id) {
      return selectAttentionById.get(requireInteger(id, 'attentionId')) || null;
    },

    findAttentionByMessage(mailMessageId) {
      return selectAttentionByMessage.get(requireInteger(mailMessageId, 'mailMessageId')) || null;
    },

    /**
     * 판단이 남긴 것을 찾는다. 본문은 저장하지 않으므로 본문 검색이 아니다(설계 23).
     *
     * 상한이 있는 이유는 이 결과가 대화 컨텍스트로 들어가기 때문이다. 넓은 질문이
     * 수십 통을 끌어오면 답변이 메일 목록 낭독이 된다.
     */
    searchMessages(input = {}) {
      const rawQuery = typeof input.query === 'string' ? input.query.trim() : '';
      // LIKE 와일드카드를 사용자 문자열로 받지 않는다. `%`만 쳐도 전건 조회가 된다.
      const escaped = rawQuery.replace(/[\\%_]/g, match => `\\${match}`);
      const category = typeof input.category === 'string' && CATEGORIES.has(input.category)
        ? input.category
        : null;
      const sender = typeof input.senderAddress === 'string' && input.senderAddress.trim()
        ? input.senderAddress.trim().toLowerCase()
        : null;
      const bound = value => (Number.isSafeInteger(value) ? value : null);
      const limit = Number.isSafeInteger(input.limit)
        ? Math.min(Math.max(input.limit, 1), MAX_SEARCH_RESULTS)
        : DEFAULT_SEARCH_RESULTS;
      return searchMessages.all({
        query: rawQuery || null,
        like: rawQuery ? `%${escaped}%` : null,
        category,
        sender,
        since: bound(input.since),
        until: bound(input.until),
        needsAction: input.needsAction === true ? 1 : 0,
        limit,
      });
    },

    // 같은 선호를 두 번 눌러도 오류가 아니다. 이미 있으면 그것을 돌려준다.
    addPreference(input) {
      const preferenceType = requireText(input?.preferenceType, 'preferenceType', 16);
      if (!PREFERENCE_TYPES.has(preferenceType)) {
        throw mailError('지원하지 않는 preference 종류입니다.', 'MAIL_INVALID_PREFERENCE');
      }
      const action = requireText(input?.action, 'action', 32);
      if (!PREFERENCE_ACTIONS.has(action)) {
        throw mailError('지원하지 않는 preference action입니다.', 'MAIL_INVALID_PREFERENCE');
      }
      const target = preferenceType === 'category'
        ? requireText(input?.target, 'target', 32)
        : requireText(input?.target, 'target', 320).toLowerCase();
      if (preferenceType === 'category' && !CATEGORIES.has(target)) {
        throw mailError('지원하지 않는 category입니다.', 'MAIL_INVALID_PREFERENCE');
      }
      const accountId = input?.accountId === undefined || input?.accountId === null
        ? null
        : requireInteger(input.accountId, 'accountId');
      const params = {
        accountId, preferenceType, target, action,
        note: optionalText(input?.note, 200),
      };
      const created = insertPreference.run({ ...params, now: captureNow(input?.now) }).changes === 1;
      return { created, preference: selectPreference.get(params) };
    },

    listPreferences() {
      return selectAllPreferences.all();
    },

    removePreference(id) {
      return { removed: deletePreference.run(requireInteger(id, 'preferenceId')).changes === 1 };
    },

  };
}

module.exports = {
  DEFAULT_ANALYSIS_LEASE_SECONDS,
  DEFAULT_MAX_ANALYSIS_ATTEMPTS,
  analysisBackoffSeconds,
  createMailStore,
};
