'use strict';

const crypto = require('node:crypto');

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TEXT_CHARS = 2000;
const DEFAULT_PENDING_RETRY_SECONDS = 30;
const MAX_ATTEMPTS = 3;

const SHORTCUT_RESPONSE_FORMAT = {
  type: 'json_schema',
  name: 'voice_shortcut_turn',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      answer: { type: 'string' },
      canContinue: { type: 'boolean' },
    },
    required: ['answer', 'canContinue'],
  },
};

const SHORTCUT_CONVERSATION_CONTROL_SYSTEM_PROMPT = `이 요청은 화면 없는 iPhone 음성 단축어에서 왔다.
최종 canContinue는 이 답변 직후 iPhone이 마이크를 다시 열고 다음 사용자 발화를 기다리는 것이 자연스러운지를 뜻한다.
대화 맥락에서 사용자의 마지막 말이 대화를 끝내거나 잠시 멈추려는 뜻을 명확하거나 강하게 보일 때만 canContinue를 false로 둔다.
요청이나 도구 작업이 완료됐다는 사실만으로 false로 두지 않는다. 애매하면 반드시 true로 둔다.
canContinue가 false이면 answer를 자연스럽게 닫고, 새 질문이나 다음 대화를 권하는 말을 덧붙이지 않는다.
canContinue가 true여도 대화를 이어가기 위한 불필요한 질문을 만들지 않는다.`;

class VoiceShortcutError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = 'VoiceShortcutError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function shortcutError(message, code, statusCode = 400) {
  throw new VoiceShortcutError(message, code, statusCode);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function captureInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    shortcutError(`${field} ID가 올바르지 않습니다.`, 'SHORTCUT_INVALID_ID');
  }
  return number;
}

function ensureExactFields(input, allowed, code = 'SHORTCUT_INVALID_FIELDS') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    shortcutError('요청 본문 형식이 올바르지 않습니다.', code);
  }
  const allowedSet = new Set(allowed);
  if (Object.keys(input).some(key => !allowedSet.has(key))) {
    shortcutError('허용되지 않은 요청 항목이 있습니다.', code);
  }
}

function normalizeCredentialInput(input) {
  ensureExactFields(input, ['subscriptionId']);
  return { subscriptionId: captureInteger(input.subscriptionId, 'Push 구독') };
}

function normalizeTurnInput(input) {
  ensureExactFields(input, ['text', 'requestId']);
  if (typeof input.text !== 'string') {
    shortcutError('질문 텍스트가 필요합니다.', 'SHORTCUT_INVALID_TEXT');
  }
  const text = input.text.normalize('NFC').trim();
  const textLength = [...text].length;
  if (textLength < 1 || textLength > MAX_TEXT_CHARS) {
    shortcutError('질문은 2,000자 이내여야 합니다.', 'SHORTCUT_INVALID_TEXT');
  }
  if (typeof input.requestId !== 'string' || !UUID_PATTERN.test(input.requestId)) {
    shortcutError('requestId는 UUID여야 합니다.', 'SHORTCUT_INVALID_REQUEST_ID');
  }
  const requestId = input.requestId.toLowerCase();
  return {
    text,
    requestId,
    requestSha256: sha256(JSON.stringify({ text })),
  };
}

function invalidShortcutResponse() {
  const error = new Error('단축어 응답 형식이 올바르지 않습니다.');
  error.code = 'SHORTCUT_RESPONSE_INVALID';
  return error;
}

function parseShortcutResponse(outputText) {
  let parsed;
  try {
    parsed = JSON.parse(typeof outputText === 'string' ? outputText : '');
  } catch {
    throw invalidShortcutResponse();
  }
  const keys = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? Object.keys(parsed)
    : [];
  if (
    keys.length !== 2
    || !Object.hasOwn(parsed, 'answer')
    || !Object.hasOwn(parsed, 'canContinue')
    || typeof parsed.answer !== 'string'
    || !parsed.answer.trim()
    || typeof parsed.canContinue !== 'boolean'
  ) {
    throw invalidShortcutResponse();
  }
  return {
    answer: parsed.answer.trim(),
    canContinue: parsed.canContinue,
  };
}

function publicCredential(row, extra = {}) {
  return {
    id: row.id,
    subscriptionId: row.subscriptionId,
    tokenPrefix: row.tokenPrefix,
    status: row.status,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    ...extra,
  };
}

function createVoiceShortcutService(db, options = {}) {
  if (!db?.prepare || typeof db.transaction !== 'function') {
    throw new TypeError('SQLite DB 연결이 필요합니다.');
  }
  const enabled = options.enabled === true;
  const clock = typeof options.now === 'function'
    ? options.now
    : () => Math.floor(Date.now() / 1000);
  const randomToken = typeof options.randomToken === 'function'
    ? options.randomToken
    : () => crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const randomConversationId = typeof options.randomConversationId === 'function'
    ? options.randomConversationId
    : () => crypto.randomBytes(16).toString('base64url');
  const pendingRetrySeconds = Number.isInteger(options.pendingRetrySeconds)
    && options.pendingRetrySeconds >= 1
    ? options.pendingRetrySeconds
    : DEFAULT_PENDING_RETRY_SECONDS;

  function now() {
    const value = clock();
    if (!Number.isFinite(value)) throw new TypeError('단축어 시계가 올바르지 않습니다.');
    return Math.floor(value);
  }

  function requireEnabled() {
    if (!enabled) {
      shortcutError('잠금화면 음성 단축어가 비활성화되어 있습니다.', 'VOICE_SHORTCUT_DISABLED', 503);
    }
  }

  const getActiveSubscription = db.prepare(`
    SELECT id
    FROM assistant_push_subscriptions
    WHERE id = ? AND status = 'active'
    LIMIT 1
  `);
  const getCredentialBySubscription = db.prepare(`
    SELECT id, subscription_id AS subscriptionId, token_prefix AS tokenPrefix,
           status, created_at AS createdAt, last_used_at AS lastUsedAt,
           revoked_at AS revokedAt
    FROM assistant_shortcut_credentials
    WHERE subscription_id = ?
    LIMIT 1
  `);
  const upsertCredential = db.prepare(`
    INSERT INTO assistant_shortcut_credentials (
      subscription_id, token_sha256, token_prefix, status,
      created_at, last_used_at, revoked_at
    ) VALUES (
      @subscriptionId, @tokenSha256, @tokenPrefix, 'active',
      @currentTime, NULL, NULL
    )
    ON CONFLICT(subscription_id) DO UPDATE SET
      token_sha256 = excluded.token_sha256,
      token_prefix = excluded.token_prefix,
      status = 'active',
      created_at = excluded.created_at,
      last_used_at = NULL,
      revoked_at = NULL
  `);
  const getCredentialById = db.prepare(`
    SELECT id, subscription_id AS subscriptionId, token_prefix AS tokenPrefix,
           status, created_at AS createdAt, last_used_at AS lastUsedAt,
           revoked_at AS revokedAt
    FROM assistant_shortcut_credentials
    WHERE id = ?
    LIMIT 1
  `);
  const revokeCredential = db.prepare(`
    UPDATE assistant_shortcut_credentials
    SET status = 'revoked', revoked_at = @currentTime
    WHERE id = @id AND status = 'active'
  `);
  const authenticateCredential = db.prepare(`
    SELECT c.id, c.subscription_id AS subscriptionId,
           c.token_prefix AS tokenPrefix, c.status,
           c.created_at AS createdAt, c.last_used_at AS lastUsedAt,
           c.revoked_at AS revokedAt
    FROM assistant_shortcut_credentials c
    JOIN assistant_push_subscriptions s ON s.id = c.subscription_id
    WHERE c.token_sha256 = ? AND c.status = 'active' AND s.status = 'active'
    LIMIT 1
  `);
  const markCredentialUsed = db.prepare(`
    UPDATE assistant_shortcut_credentials
    SET last_used_at = ?
    WHERE id = ? AND status = 'active'
  `);
  const getReceiptRow = db.prepare(`
    SELECT r.id, r.credential_id AS credentialId, r.request_id AS requestId,
           r.request_sha256 AS requestSha256, r.status,
           r.conversation_id AS conversationId, r.attempt_count AS attemptCount,
           r.user_message_id AS userMessageId,
           r.assistant_message_id AS assistantMessageId,
           r.can_continue AS canContinue,
           r.created_at AS createdAt, r.updated_at AS updatedAt,
           m.content AS answer
    FROM voice_shortcut_receipts r
    LEFT JOIN messages m ON m.id = r.assistant_message_id AND m.role = 'assistant'
    WHERE r.credential_id = ? AND r.request_id = ?
    LIMIT 1
  `);
  const insertReceipt = db.prepare(`
    INSERT INTO voice_shortcut_receipts (
      credential_id, request_id, request_sha256, status,
      conversation_id, attempt_count, created_at, updated_at
    ) VALUES (
      @credentialId, @requestId, @requestSha256, 'pending',
      @conversationId, 1, @currentTime, @currentTime
    )
  `);
  const retryReceipt = db.prepare(`
    UPDATE voice_shortcut_receipts
    SET attempt_count = attempt_count + 1, updated_at = @currentTime
    WHERE id = @id AND status = 'pending' AND attempt_count < ${MAX_ATTEMPTS}
  `);
  const completeReceipt = db.prepare(`
    UPDATE voice_shortcut_receipts
    SET status = 'completed', user_message_id = @userMessageId,
        assistant_message_id = @assistantMessageId,
        can_continue = @canContinue,
        updated_at = @currentTime, completed_at = @currentTime
    WHERE credential_id = @credentialId
      AND request_id = @requestId
      AND request_sha256 = @requestSha256
      AND status = 'pending'
      AND EXISTS (
        SELECT 1 FROM messages
        WHERE id = @userMessageId AND session_id = 'shared-main' AND role = 'user'
      )
      AND EXISTS (
        SELECT 1 FROM messages
        WHERE id = @assistantMessageId AND session_id = 'shared-main' AND role = 'assistant'
      )
  `);

  function getReceipt(credentialId, requestId) {
    const row = getReceiptRow.get(credentialId, requestId);
    return row ? { ...row, canContinue: row.canContinue === 1 } : null;
  }

  const issueTransaction = db.transaction(input => {
    requireEnabled();
    const { subscriptionId } = normalizeCredentialInput(input);
    if (!getActiveSubscription.get(subscriptionId)) {
      shortcutError('활성 Push 구독을 찾을 수 없습니다.', 'SHORTCUT_SUBSCRIPTION_INACTIVE', 404);
    }
    const existing = getCredentialBySubscription.get(subscriptionId);
    const token = randomToken();
    if (!TOKEN_PATTERN.test(token)) throw new TypeError('단축어 token 생성기가 올바르지 않습니다.');
    const currentTime = now();
    upsertCredential.run({
      subscriptionId,
      tokenSha256: sha256(token),
      tokenPrefix: token.slice(0, 8),
      currentTime,
    });
    return publicCredential(getCredentialBySubscription.get(subscriptionId), {
      token,
      replaced: Boolean(existing),
    });
  });

  const revokeTransaction = db.transaction(idValue => {
    requireEnabled();
    const id = captureInteger(idValue, '단축어 자격증명');
    const current = getCredentialById.get(id);
    if (!current) {
      shortcutError('단축어 자격증명을 찾을 수 없습니다.', 'SHORTCUT_CREDENTIAL_NOT_FOUND', 404);
    }
    if (current.status === 'revoked') return publicCredential(current, { unchanged: true });
    revokeCredential.run({ id, currentTime: now() });
    return publicCredential(getCredentialById.get(id), { unchanged: false });
  });

  const claimTransaction = db.transaction((credentialIdValue, turn) => {
    requireEnabled();
    const credentialId = captureInteger(credentialIdValue, '단축어 자격증명');
    const currentTime = now();
    const existing = getReceipt(credentialId, turn.requestId);
    if (existing) {
      if (existing.requestSha256 !== turn.requestSha256) {
        shortcutError('같은 requestId에 다른 질문을 보낼 수 없습니다.', 'SHORTCUT_REQUEST_CONFLICT', 409);
      }
      if (existing.status === 'completed') {
        if (!existing.answer || !existing.assistantMessageId) {
          shortcutError('완료 기록을 복구하지 못했습니다.', 'SHORTCUT_RECEIPT_CORRUPT', 500);
        }
        return { kind: 'replay', ...existing };
      }
      if (existing.attemptCount >= MAX_ATTEMPTS) {
        shortcutError('이 요청은 자동 재시도 한도를 넘었습니다.', 'SHORTCUT_RETRY_EXHAUSTED', 409);
      }
      if (existing.updatedAt > currentTime - pendingRetrySeconds) {
        shortcutError('같은 요청을 처리하고 있습니다.', 'SHORTCUT_REQUEST_IN_PROGRESS', 409);
      }
      if (retryReceipt.run({ id: existing.id, currentTime }).changes !== 1) {
        shortcutError('같은 요청을 처리하고 있습니다.', 'SHORTCUT_REQUEST_IN_PROGRESS', 409);
      }
      return { kind: 'new', ...getReceipt(credentialId, turn.requestId), retry: true };
    }

    const conversationId = randomConversationId();
    if (typeof conversationId !== 'string' || conversationId.length < 22 || conversationId.length > 64) {
      throw new TypeError('단축어 conversation ID 생성기가 올바르지 않습니다.');
    }
    insertReceipt.run({
      credentialId,
      requestId: turn.requestId,
      requestSha256: turn.requestSha256,
      conversationId,
      currentTime,
    });
    return { kind: 'new', ...getReceipt(credentialId, turn.requestId), retry: false };
  });

  return {
    enabled,
    publicConfig() {
      return { enabled };
    },
    issueCredential(input) {
      return issueTransaction(input);
    },
    revokeCredential(id) {
      return revokeTransaction(id);
    },
    authenticate(tokenValue) {
      requireEnabled();
      const token = typeof tokenValue === 'string' ? tokenValue : '';
      if (!TOKEN_PATTERN.test(token)) {
        shortcutError('단축어 인증이 필요합니다.', 'SHORTCUT_AUTH_REQUIRED', 401);
      }
      const credential = authenticateCredential.get(sha256(token));
      if (!credential) {
        shortcutError('단축어 인증이 필요합니다.', 'SHORTCUT_AUTH_REQUIRED', 401);
      }
      const currentTime = now();
      markCredentialUsed.run(currentTime, credential.id);
      return { ...publicCredential(credential), lastUsedAt: currentTime };
    },
    normalizeTurnInput,
    claimRequest(credentialId, turn) {
      return claimTransaction(credentialId, turn);
    },
    completeRequest({
      credentialId,
      requestId,
      requestSha256,
      userMessageId,
      assistantMessageId,
      canContinue,
    }) {
      if (typeof canContinue !== 'boolean') {
        throw new TypeError('canContinue는 boolean이어야 합니다.');
      }
      const changed = completeReceipt.run({
        credentialId,
        requestId,
        requestSha256,
        userMessageId,
        assistantMessageId,
        canContinue: canContinue ? 1 : 0,
        currentTime: now(),
      }).changes;
      if (changed !== 1) {
        shortcutError('단축어 응답 저장을 확정하지 못했습니다.', 'SHORTCUT_FINALIZE_CONFLICT', 409);
      }
      return getReceipt(credentialId, requestId);
    },
  };
}

module.exports = {
  MAX_ATTEMPTS,
  MAX_TEXT_CHARS,
  SHORTCUT_CONVERSATION_CONTROL_SYSTEM_PROMPT,
  SHORTCUT_RESPONSE_FORMAT,
  VoiceShortcutError,
  createVoiceShortcutService,
  normalizeCredentialInput,
  normalizeTurnInput,
  parseShortcutResponse,
};
