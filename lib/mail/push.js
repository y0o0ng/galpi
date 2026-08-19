'use strict';

// Mail Push의 delivery 정본. claim/settle/payload 생성만 맡는다.
//
// **개별 Push의 대상은 Attention이 아니라 메일 자체다**(schema v20). `notification_mode`와
// Attention은 서로 다른 축이라 — 전자는 "알릴 가치가 있는가", 후자는 "잊으면 안 되는
// 후속 행동이 있는가" — 한쪽이 다른 쪽의 존재를 강제하면 안 된다. Attention이 있는
// 메일만 그 lifecycle(snooze·done)을 회차로 따라간다.
//
// 구독(`assistant_push_subscriptions`)과 network transport는 일정과 공유하고,
// delivery 상태표만 도메인별로 나눈다(설계 8.6). 전달 루프(retry·410 만료·lease·
// overlap guard)는 `createAssistantPushDispatcher`를 그대로 재사용하며, 이 파일은
// 그 dispatcher가 요구하는 service 표면을 맞춘다.
//
// SQL을 store.js가 아니라 여기 두는 이유는 `assistant-push.js`가 자기 delivery 표를
// 소유하는 것과 같은 선례를 따르기 위해서다. 상태 기계를 두 파일로 쪼개지 않는다.
//
// 같은 이유로 `mail_messages.notification_state`와 `batch_id`도 이 파일이 소유한다.
// 그 두 컬럼은 메일의 정체성이나 판단이 아니라 "Push 라우팅을 어디까지 했나"의
// 기록이다. store.js는 계정·커서·분석 큐를 계속 맡는다.

const { DEFAULT_QUIET_HOURS, quietHoursReleaseAt } = require('./quiet-hours');

// 설계 13.1. **이 목록이 늘어나는 변경은 privacy 결정이다.**
const MAIL_PUSH_PAYLOAD_KEYS = ['version', 'type', 'targetKind', 'targetId', 'notifySeq', 'url'];
const TARGET_KINDS = new Set(['message', 'batch']);

// delivery가 살아 있는 기간. 이 시각을 넘기면 보내지 않는다 — 어제 온 메일 알림이
// 오늘 울리는 것보다 안 울리는 편이 낫다.
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_LEASE_SECONDS = 60;
// 설계 13.2. "짧은 시간 안에 묶는다" 같은 모호한 계약을 없애고 값으로 정의한다.
const BATCH_WINDOW_SECONDS = 15 * 60;

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
    // 타입은 하나다. 개별 메일과 batch는 targetKind로 가른다 — 잠금화면 문구는 같다.
    type: 'mail_attention',
    targetKind,
    targetId: id,
    notifySeq: seq,
    url: targetKind === 'message'
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
  // 선호 조회도 같은 이유로 받는다. 좁은 순서(sender > domain > category)를 정하는
  // 쿼리는 store.js 한 곳에 있고, 여기서 다시 만들면 두 곳이 조용히 달라진다.
  const readPreferences = typeof options.preferences === 'function'
    ? options.preferences
    : () => [];

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
          -- Attention이 있는 메일만 그 lifecycle을 따른다. Attention이 없는 메일은
          -- 알릴 가치가 있다는 판단만으로 나가므로 여기서 걸러지지 않는다.
          target_kind = 'message'
          AND EXISTS (SELECT 1 FROM mail_attention a
                      WHERE a.mail_message_id = mail_push_deliveries.target_id)
          AND NOT EXISTS (SELECT 1 FROM mail_attention a
                          WHERE a.mail_message_id = mail_push_deliveries.target_id
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
        OR NOT EXISTS (SELECT 1 FROM mail_attention a WHERE a.mail_message_id = d.target_id)
        OR EXISTS (SELECT 1 FROM mail_attention a
                   WHERE a.mail_message_id = d.target_id
                     AND a.state = 'open' AND a.notify_seq = d.notify_seq)
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

  // ── 라우팅 (설계 13.2) ────────────────────────────────────────────────────
  // 판단이 끝났는데 아직 알림 경로를 정하지 않은 메일. Attention 존재 여부는 보지
  // 않는다 — notification_mode와 Attention은 서로 다른 축이다.
  const selectRoutable = db.prepare(`
    SELECT id, notification_mode AS mode, account_id AS accountId,
           sender_address AS senderAddress, category
    FROM mail_messages
    WHERE analysis_state = 'done'
      AND notification_state = 'pending'
      AND notification_mode IN ('immediate', 'batch', 'silent')
    ORDER BY received_at ASC, id ASC
    LIMIT @limit
  `);
  const markRouted = db.prepare(`
    UPDATE mail_messages
    SET notification_state = @state, batch_id = @batchId, updated_at = @now
    WHERE id = @id AND notification_state = 'pending'
  `);
  const selectOpenBatch = db.prepare(`
    SELECT id FROM mail_notification_batches WHERE state = 'open' ORDER BY id ASC LIMIT 1
  `);
  const insertBatch = db.prepare(`
    INSERT INTO mail_notification_batches (state, opened_at, due_at, created_at, updated_at)
    VALUES ('open', @now, @dueAt, @now, @now)
  `);
  const bumpBatchCount = db.prepare(`
    UPDATE mail_notification_batches
    SET item_count = item_count + 1, updated_at = @now
    WHERE id = @id AND state = 'open'
  `);
  const selectDueBatches = db.prepare(`
    SELECT id, item_count AS itemCount FROM mail_notification_batches
    WHERE state = 'open' AND due_at <= @now
    ORDER BY id ASC
  `);
  const closeEmptyBatch = db.prepare(`
    UPDATE mail_notification_batches
    SET state = 'empty', updated_at = @now WHERE id = @id AND state = 'open'
  `);
  const startBatchDelivery = db.prepare(`
    UPDATE mail_notification_batches
    SET state = 'delivering', updated_at = @now WHERE id = @id AND state = 'open'
  `);
  const finishBatchDelivery = db.prepare(`
    UPDATE mail_notification_batches
    SET state = 'delivered', delivered_at = @now, updated_at = @now
    WHERE id = @id AND state = 'delivering'
  `);

  const enqueueTransaction = db.transaction((params) => {
    const subscriptions = selectActiveSubscriptions.all();
    let created = 0;
    for (const subscription of subscriptions) {
      created += insertDelivery.run({ ...params, subscriptionId: subscription.id }).changes;
    }
    return { subscriptions: subscriptions.length, created };
  });

  // 라우팅 한 건은 원자적이다. 갈라 놓으면 delivery는 만들어졌는데 메일은 아직
  // pending인 상태가 생기고, 다음 tick이 같은 메일을 또 라우팅한다.
  const routeOneTransaction = db.transaction((message, now, releaseAt, expiresAt, notificationsOn) => {
    if (message.mode === 'silent' || !notificationsOn) {
      // 알림을 꺼둔 동안 온 메일도 라우팅은 끝낸다. 나중에 켰다고 과거 메일이
      // 한꺼번에 울리면 안 된다.
      markRouted.run({ id: message.id, state: 'suppressed', batchId: null, now });
      return 'suppressed';
    }
    if (message.mode === 'batch') {
      const batchId = selectOpenBatch.get()?.id
        ?? insertBatch.run({ now, dueAt: now + BATCH_WINDOW_SECONDS }).lastInsertRowid;
      markRouted.run({ id: message.id, state: 'batched', batchId, now });
      bumpBatchCount.run({ id: batchId, now });
      return 'batched';
    }
    markRouted.run({ id: message.id, state: 'enqueued', batchId: null, now });
    enqueueTransaction({
      targetKind: 'message',
      targetId: message.id,
      notifySeq: 1,
      nextAttemptAt: releaseAt,
      expiresAt,
      now,
    });
    return 'immediate';
  });

  const flushOneTransaction = db.transaction((batch, now, releaseAt, expiresAt) => {
    if (batch.itemCount === 0) {
      closeEmptyBatch.run({ id: batch.id, now });
      return { empty: true, created: 0 };
    }
    if (startBatchDelivery.run({ id: batch.id, now }).changes !== 1) return { empty: false, created: 0 };
    const { created } = enqueueTransaction({
      targetKind: 'batch',
      targetId: batch.id,
      notifySeq: 1,
      nextAttemptAt: releaseAt,
      expiresAt,
      now,
    });
    finishBatchDelivery.run({ id: batch.id, now });
    return { empty: false, created };
  });

  /**
   * 선호를 얹은 알림 경로(설계 11.1). 판단(`category`)과 Attention은 건드리지 않고
   * 마지막 라우팅만 바꾸므로, 알림을 끈 메일도 나중에 검색으로 찾을 수 있다.
   *
   * 지금 집행하는 것은 `suppress_notification` 하나다. `always_notify`와
   * `skip_analysis`는 사용자가 명시적으로 말해야 저장되는 값이고 그 통로가 아직
   * 없어서, 행이 생겨도 여기서 임의로 승격하지 않는다.
   */
  function effectiveMode(message) {
    if (!Number.isSafeInteger(message.accountId)) return message.mode;
    const sender = String(message.senderAddress || '').toLowerCase();
    const matched = readPreferences({
      accountId: message.accountId,
      senderAddress: sender,
      senderDomain: sender.includes('@') ? sender.slice(sender.lastIndexOf('@') + 1) : '',
      category: message.category || null,
    });
    if (!Array.isArray(matched) || !matched.length) return message.mode;
    return matched.some(item => item?.action === 'suppress_notification')
      ? 'silent'
      : message.mode;
  }

  function deliveryWindow(now) {
    const settings = readSettings() || {};
    const releaseAt = quietHoursReleaseAt(now, settings.quietHours);
    return {
      notificationsOn: settings.notificationsEnabled !== false,
      releaseAt,
      // 보류된 만큼 만료도 밀어야 한다. 아니면 quiet hours가 끝나기 전에 만료된다.
      expiresAt: releaseAt + ttlSeconds,
    };
  }

  return {
    get enabled() { return enabled; },

    /**
     * 판단이 끝난 메일의 알림 경로를 정한다(설계 13.2).
     *
     * silent는 조용히 묻고, immediate는 지금 기기별로 큐에 넣고, batch는 열린 창에
     * 붙인다. **Attention이 있는지는 보지 않는다** — 알릴 가치와 후속 행동은 다른
     * 축이고, 한쪽이 다른 쪽을 강제하면 `important/batch`인데 Attention이 없는
     * 정상 메일이 전달 경로에서 사라진다.
     *
     * notification_mode가 비어 있으면 집지 않는다. 라우팅이 임의로 정하는 것보다
     * 다음 tick에 다시 보는 편이 낫다.
     */
    routePending(nowValue, { limit = 50 } = {}) {
      const now = captureNow(nowValue);
      const window = deliveryWindow(now);
      const counts = { routed: 0, immediate: 0, batched: 0, suppressed: 0 };
      for (const message of selectRoutable.all({ limit })) {
        const outcome = routeOneTransaction(
          { ...message, mode: effectiveMode(message) },
          now, window.releaseAt, window.expiresAt, window.notificationsOn,
        );
        counts.routed += 1;
        counts[outcome] += 1;
      }
      return counts;
    },

    /**
     * 창이 닫힌 batch를 요약 알림 한 벌로 내보낸다.
     *
     * 항목이 0이면 Push 없이 닫는다. 개수는 payload에 싣지 않는다(설계 13.1) —
     * batch의 가치는 개수 표시가 아니라 Push N개를 1개로 줄이는 것이다.
     */
    flushDueBatches(nowValue) {
      const now = captureNow(nowValue);
      const window = deliveryWindow(now);
      const counts = { flushed: 0, empty: 0, created: 0 };
      for (const batch of selectDueBatches.all({ now })) {
        if (!window.notificationsOn) {
          // 알림이 꺼져 있으면 창만 닫는다. 켜는 순간 옛 batch가 울리면 안 된다.
          closeEmptyBatch.run({ id: batch.id, now });
          counts.empty += 1;
          continue;
        }
        const result = flushOneTransaction(batch, now, window.releaseAt, window.expiresAt);
        if (result.empty) counts.empty += 1;
        else counts.flushed += 1;
        counts.created += result.created;
      }
      return counts;
    },

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
  BATCH_WINDOW_SECONDS,
  DEFAULT_LEASE_SECONDS,
  DEFAULT_TTL_SECONDS,
  MAIL_PUSH_PAYLOAD_KEYS,
  buildMailPushPayload,
  buildMailSendOptions,
  createMailPushService,
};
