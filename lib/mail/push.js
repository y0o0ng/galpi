'use strict';

// Mail Push의 delivery 정본. claim/settle/payload 생성만 맡는다.
//
// 구독(`assistant_push_subscriptions`)과 network transport는 일정과 공유하고,
// delivery 상태표만 도메인별로 나눈다(설계 8.6). 전달 루프(retry·410 만료·lease·
// overlap guard)는 `createAssistantPushDispatcher`를 그대로 재사용하며, 이 파일은
// 그 dispatcher가 요구하는 service 표면을 맞춘다.
//
// SQL을 store.js가 아니라 여기 두는 이유는 `assistant-push.js`가 자기 delivery 표를
// 소유하는 것과 같은 선례를 따르기 위해서다. 상태 기계를 두 파일로 쪼개지 않는다.

const { DEFAULT_QUIET_HOURS, quietHoursReleaseAt } = require('./quiet-hours');

// 설계 13.1. **이 목록이 늘어나는 변경은 privacy 결정이다.**
const MAIL_PUSH_PAYLOAD_KEYS = ['version', 'type', 'targetKind', 'targetId', 'notifySeq', 'url'];
const TARGET_KINDS = new Set(['attention', 'batch']);

// delivery가 살아 있는 기간. 이 시각을 넘기면 보내지 않는다 — 어제 온 메일 알림이
// 오늘 울리는 것보다 안 울리는 편이 낫다.
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_LEASE_SECONDS = 60;

function pushError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireId(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw pushError(`Mail push payload의 ${field}가 올바르지 않습니다.`, 'MAIL_PUSH_INVALID_TARGET');
  }
  return value;
}

/**
 * Push payload를 만든다. **메일에서 파생된 값은 인자로도 받지 않는다** — 받을 수
 * 없으면 실을 수도 없다. 허용 key 여섯 외에는 어떤 것도 넣지 않는다(설계 13.1).
 */
function buildMailPushPayload({ targetKind, targetId, notifySeq } = {}) {
  if (!TARGET_KINDS.has(targetKind)) {
    throw pushError('Mail push payload의 targetKind가 올바르지 않습니다.', 'MAIL_PUSH_INVALID_TARGET');
  }
  const id = requireId(targetId, 'targetId');
  const seq = requireId(notifySeq, 'notifySeq');
  return JSON.stringify({
    version: 1,
    // 타입은 하나다. attention과 batch는 targetKind로 가른다 — 잠금화면 문구는 같다.
    type: 'mail_attention',
    targetKind,
    targetId: id,
    notifySeq: seq,
    url: targetKind === 'attention'
      ? `/?panel=notifications&notification=mail&mail=${id}`
      : '/?panel=notifications&notification=mail',
  });
}

// Web Push 헤더의 topic. payload가 아니라 라우팅 메타데이터라 계약에 걸리지 않는다.
// 같은 대상의 이전 알림을 서버가 합칠 수 있게 해준다.
function buildMailSendOptions(claim) {
  return {
    urgency: 'normal',
    topic: `mail-${claim.targetKind}-${claim.targetId}`.slice(0, 32),
  };
}

function createMailPushService(db, options = {}) {
  if (!db?.prepare || typeof db.transaction !== 'function') {
    throw new TypeError('SQLite DB 연결이 필요합니다.');
  }
  const clock = typeof options.now === 'function' ? options.now : () => Math.floor(Date.now() / 1000);
  const ttlSeconds = Number.isSafeInteger(options.ttlSeconds) && options.ttlSeconds > 0
    ? options.ttlSeconds
    : DEFAULT_TTL_SECONDS;
  const leaseSeconds = Number.isSafeInteger(options.leaseSeconds) && options.leaseSeconds > 0
    ? options.leaseSeconds
    : DEFAULT_LEASE_SECONDS;
  const enabled = options.enabled === true;
  // 설정은 호출부가 준다. 이 파일이 app_settings를 읽으면 설정 계층과 전달 계층이 붙는다.
  const readSettings = typeof options.settings === 'function'
    ? options.settings
    : () => ({ notificationsEnabled: true, quietHours: DEFAULT_QUIET_HOURS });

  function captureNow(value) {
    const current = value === undefined ? clock() : value;
    if (!Number.isFinite(current)) throw new TypeError('Mail push 시계가 올바르지 않습니다.');
    return Math.floor(current);
  }

  const selectActiveSubscriptions = db.prepare(`
    SELECT id FROM assistant_push_subscriptions WHERE status = 'active' ORDER BY id ASC
  `);
  // 같은 회차를 두 번 넣지 않는다. UNIQUE가 정본이고 여기서는 조용히 넘어간다 —
  // worker tick이 재실행돼도 중복 Push가 없어야 한다.
  const insertDelivery = db.prepare(`
    INSERT INTO mail_push_deliveries (
      target_kind, target_id, notify_seq, subscription_id,
      next_attempt_at, expires_at, created_at, updated_at
    ) VALUES (@targetKind, @targetId, @notifySeq, @subscriptionId, @nextAttemptAt, @expiresAt, @now, @now)
    ON CONFLICT(target_kind, target_id, notify_seq, subscription_id) DO NOTHING
  `);

  // 죽은 worker가 들고 있던 delivery를 되찾는다.
  const recoverLeases = db.prepare(`
    UPDATE mail_push_deliveries
    SET status = 'retry', lease_until = NULL, next_attempt_at = @now,
        last_error_code = 'WORKER_LEASE_EXPIRED', updated_at = @now
    WHERE status = 'sending' AND lease_until <= @now AND expires_at > @now
  `);
  const failExpired = db.prepare(`
    UPDATE mail_push_deliveries
    SET status = 'expired', lease_until = NULL,
        last_error_code = 'DELIVERY_TTL_EXPIRED', updated_at = @now
    WHERE expires_at <= @now
      AND (status IN ('pending', 'retry') OR (status = 'sending' AND lease_until <= @now))
  `);
  // 사용자가 이미 처리했거나 미룬 대상의 아직 안 나간 Push는 보내지 않는다.
  // 회차가 이미 지난 delivery도 마찬가지다 — snooze로 notify_seq가 올라갔다는 뜻이다.
  const skipIneligible = db.prepare(`
    UPDATE mail_push_deliveries
    SET status = 'skipped', lease_until = NULL,
        last_error_code = 'TARGET_INACTIVE', updated_at = @now
    WHERE status IN ('pending', 'retry')
      AND (
        NOT EXISTS (SELECT 1 FROM assistant_push_subscriptions s
                    WHERE s.id = mail_push_deliveries.subscription_id AND s.status = 'active')
        OR (
          target_kind = 'attention'
          AND NOT EXISTS (SELECT 1 FROM mail_attention a
                          WHERE a.id = mail_push_deliveries.target_id
                            AND a.state = 'open'
                            AND a.notify_seq = mail_push_deliveries.notify_seq)
        )
      )
  `);

  const selectCandidate = db.prepare(`
    SELECT d.id
    FROM mail_push_deliveries d
    JOIN assistant_push_subscriptions s ON s.id = d.subscription_id
    WHERE d.status IN ('pending', 'retry')
      AND d.next_attempt_at <= @now
      AND d.expires_at > @now
      AND s.status = 'active'
    ORDER BY d.next_attempt_at ASC, d.id ASC
    LIMIT 1
  `);
  const claimDelivery = db.prepare(`
    UPDATE mail_push_deliveries
    SET status = 'sending', lease_until = @leaseUntil,
        attempt_count = attempt_count + 1,
        last_attempt_at = @now, updated_at = @now
    WHERE id = @id AND status IN ('pending', 'retry')
      AND next_attempt_at <= @now AND expires_at > @now
  `);
  const getClaimed = db.prepare(`
    SELECT d.id, d.target_kind AS targetKind, d.target_id AS targetId,
           d.notify_seq AS notifySeq, d.subscription_id AS subscriptionId,
           d.attempt_count AS attemptCount, d.expires_at AS expiresAt,
           d.lease_until AS leaseUntil,
           s.endpoint, s.p256dh, s.auth
    FROM mail_push_deliveries d
    JOIN assistant_push_subscriptions s ON s.id = d.subscription_id
    WHERE d.id = ?
  `);
  // 보내기 직전에 다시 본다. claim과 send 사이에 사용자가 완료를 눌렀을 수 있다.
  const isSendable = db.prepare(`
    SELECT 1 FROM mail_push_deliveries d
    JOIN assistant_push_subscriptions s ON s.id = d.subscription_id
    WHERE d.id = @id AND d.status = 'sending' AND d.lease_until = @leaseUntil
      AND d.expires_at > @now AND s.status = 'active'
      AND (
        d.target_kind = 'batch'
        OR EXISTS (SELECT 1 FROM mail_attention a
                   WHERE a.id = d.target_id AND a.state = 'open' AND a.notify_seq = d.notify_seq)
      )
  `);

  // 모든 정산은 lease로 fencing한다. 회수된 뒤 늦게 돌아온 worker가 남의 결과를 덮지 못한다.
  const settle = {
    accepted: db.prepare(`
      UPDATE mail_push_deliveries
      SET status = 'accepted', lease_until = NULL, last_http_status = @httpStatus,
          last_error_code = NULL, accepted_at = @now, updated_at = @now
      WHERE id = @id AND status = 'sending' AND lease_until = @leaseUntil
    `),
    retry: db.prepare(`
      UPDATE mail_push_deliveries
      SET status = 'retry', lease_until = NULL, next_attempt_at = @nextAttemptAt,
          last_http_status = @httpStatus, last_error_code = @errorCode, updated_at = @now
      WHERE id = @id AND status = 'sending' AND lease_until = @leaseUntil
    `),
    failed: db.prepare(`
      UPDATE mail_push_deliveries
      SET status = 'failed', lease_until = NULL, last_http_status = @httpStatus,
          last_error_code = @errorCode, updated_at = @now
      WHERE id = @id AND status = 'sending' AND lease_until = @leaseUntil
    `),
    expired: db.prepare(`
      UPDATE mail_push_deliveries
      SET status = 'expired', lease_until = NULL, last_http_status = @httpStatus,
          last_error_code = 'SUBSCRIPTION_EXPIRED', updated_at = @now
      WHERE id = @id AND status = 'sending' AND lease_until = @leaseUntil
    `),
    skipped: db.prepare(`
      UPDATE mail_push_deliveries
      SET status = 'skipped', lease_until = NULL,
          last_error_code = 'TARGET_INACTIVE', updated_at = @now
      WHERE id = @id AND status = 'sending' AND lease_until = @leaseUntil
    `),
  };
  // 구독 하나가 죽어도 다른 기기 delivery는 건드리지 않는다.
  const expireSubscription = db.prepare(`
    UPDATE assistant_push_subscriptions
    SET status = 'expired', updated_at = @now WHERE id = @id AND status = 'active'
  `);

  const enqueueTransaction = db.transaction((params) => {
    const subscriptions = selectActiveSubscriptions.all();
    let created = 0;
    for (const subscription of subscriptions) {
      created += insertDelivery.run({ ...params, subscriptionId: subscription.id }).changes;
    }
    return { subscriptions: subscriptions.length, created };
  });

  return {
    get enabled() { return enabled; },

    /**
     * 한 대상의 한 회차를 구독 기기 수만큼 큐에 넣는다.
     *
     * quiet hours는 별도 보류 큐가 아니라 `next_attempt_at`으로 표현한다(설계 13.3).
     * Attention은 이미 만들어져 있고 여기서 늦추는 것은 Push뿐이다.
     */
    enqueue({ targetKind, targetId, notifySeq }, nowValue) {
      if (!TARGET_KINDS.has(targetKind)) {
        throw pushError('지원하지 않는 target 종류입니다.', 'MAIL_PUSH_INVALID_TARGET');
      }
      const now = captureNow(nowValue);
      const settings = readSettings() || {};
      if (settings.notificationsEnabled === false) {
        return { subscriptions: 0, created: 0, suppressed: 'NOTIFICATIONS_OFF' };
      }
      const releaseAt = quietHoursReleaseAt(now, settings.quietHours);
      return enqueueTransaction({
        targetKind,
        targetId: requireId(targetId, 'targetId'),
        notifySeq: requireId(notifySeq, 'notifySeq'),
        nextAttemptAt: releaseAt,
        // 보류된 만큼 만료도 밀어야 한다. 아니면 quiet hours가 끝나기 전에 만료된다.
        expiresAt: releaseAt + ttlSeconds,
        now,
      });
    },

    // dispatcher가 요구하는 표면. 이름과 인자는 assistant push service와 같다.
    claim(nowValue) {
      const now = captureNow(nowValue);
      recoverLeases.run({ now });
      failExpired.run({ now });
      skipIneligible.run({ now });
      const candidate = selectCandidate.get({ now });
      if (!candidate) return null;
      const leaseUntil = now + leaseSeconds;
      if (claimDelivery.run({ id: candidate.id, now, leaseUntil }).changes !== 1) return null;
      return getClaimed.get(candidate.id);
    },

    isClaimSendable(claim, nowValue) {
      return !!isSendable.get({
        id: claim.id, leaseUntil: claim.leaseUntil, now: captureNow(nowValue),
      });
    },

    skipClaim(claim, nowValue) {
      return settle.skipped.run({
        id: claim.id, leaseUntil: claim.leaseUntil, now: captureNow(nowValue),
      }).changes === 1;
    },

    accept(claim, httpStatus, nowValue) {
      return settle.accepted.run({
        id: claim.id, leaseUntil: claim.leaseUntil, httpStatus: httpStatus ?? null,
        now: captureNow(nowValue),
      }).changes === 1;
    },

    retry(claim, { httpStatus = null, errorCode = 'PUSH_RETRY', nextAttemptAt }, nowValue) {
      return settle.retry.run({
        id: claim.id, leaseUntil: claim.leaseUntil, httpStatus,
        errorCode: String(errorCode).slice(0, 80),
        nextAttemptAt: Math.floor(nextAttemptAt), now: captureNow(nowValue),
      }).changes === 1;
    },

    fail(claim, { httpStatus = null, errorCode = 'PUSH_FAILED' }, nowValue) {
      return settle.failed.run({
        id: claim.id, leaseUntil: claim.leaseUntil, httpStatus,
        errorCode: String(errorCode).slice(0, 80), now: captureNow(nowValue),
      }).changes === 1;
    },

    // 410/404는 그 구독이 죽은 것이다. 구독을 세우고 그 기기의 delivery만 끝낸다.
    expire(claim, httpStatus, nowValue) {
      const now = captureNow(nowValue);
      const done = settle.expired.run({
        id: claim.id, leaseUntil: claim.leaseUntil, httpStatus: httpStatus ?? null, now,
      }).changes === 1;
      expireSubscription.run({ id: claim.subscriptionId, now });
      return done;
    },
  };
}

module.exports = {
  DEFAULT_LEASE_SECONDS,
  DEFAULT_TTL_SECONDS,
  MAIL_PUSH_PAYLOAD_KEYS,
  buildMailPushPayload,
  buildMailSendOptions,
  createMailPushService,
};
