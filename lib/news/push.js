'use strict';

// 재확인 질문의 Web Push 전달 (설계 11.5).
//
// **전달 루프는 만들지 않는다.** claim·retry·410 만료·lease·overlap guard는 도메인과
// 무관해서 `createAssistantPushDispatcher`가 그대로 처리하고, 이 파일은 그 dispatcher가
// 요구하는 service 표면과 자기 상태표만 갖는다. 구독과 transport는 일정·메일과 공유한다.
// 메일 push.js가 같은 선례를 남겼고, 범용 notification framework를 만들지 않는다는
// 설계 3절 대안 D와 같은 결정이다.
//
// **Push는 정본이 아니라 전달 채널이다.** 정본은 candidate 상태와 `shared-main`에
// 저장된 proactive 메시지다. 여기서 무슨 일이 나도 그 둘은 남는다.
//
// **payload에는 관심 주제도 질문 문면도 싣지 않는다.** 잠금화면에 "초경량 로컬 LLM
// 계속 챙겨볼까?"가 뜨면 옆 사람이 사용자의 관심사를 읽는다. 메일에서 잠금화면
// 미리보기를 아예 없앤 것과 같은 이유이고, 넣을 수 있는 경로가 있으면 버그 하나로 샌다.

const { DEFAULT_QUIET_HOURS, quietHoursReleaseAt } = require('../mail/quiet-hours');

// 설계 11.5. **이 목록이 늘어나는 변경은 privacy 결정이다.**
const NEWS_PUSH_PAYLOAD_KEYS = ['version', 'type', 'candidateId', 'url'];

const DAY_SECONDS = 24 * 60 * 60;
// 하루가 지난 재확인 질문은 보내지 않는다. 어제 물어보려던 것이 오늘 울리면
// 사용자는 자기가 뭘 놓쳤는지부터 헤매게 된다.
const DEFAULT_TTL_SECONDS = DAY_SECONDS;
const DEFAULT_LEASE_SECONDS = 30;

function buildNewsPushPayload(claim) {
  if (!Number.isSafeInteger(claim?.candidateId) || claim.candidateId <= 0) {
    const error = new Error('News push payload의 candidateId가 올바르지 않습니다.');
    error.code = 'NEWS_PUSH_INVALID_TARGET';
    throw error;
  }
  return JSON.stringify({
    version: 1,
    type: 'news_review',
    candidateId: claim.candidateId,
    // 알림을 누르면 새 화면이 아니라 기존 채팅으로 간다(설계 11.5).
    url: '/',
  });
}

function buildNewsSendOptions(claim) {
  return {
    // 재확인은 급한 것이 아니다. 일정 알림과 같은 urgency를 주지 않는다.
    urgency: 'normal',
    topic: `news-review-${claim.candidateId}`.slice(0, 32),
  };
}

function createNewsPushService(db, options = {}) {
  if (!db?.prepare || typeof db.transaction !== 'function') {
    throw new TypeError('SQLite DB 연결이 필요합니다.');
  }
  const enabled = options.enabled === true;
  const clock = typeof options.now === 'function' ? options.now : () => Math.floor(Date.now() / 1000);
  const quietHours = typeof options.quietHours === 'function'
    ? options.quietHours
    : () => DEFAULT_QUIET_HOURS;
  const ttlSeconds = Number.isInteger(options.ttlSeconds) && options.ttlSeconds > 0
    ? options.ttlSeconds
    : DEFAULT_TTL_SECONDS;
  const leaseSeconds = Number.isInteger(options.leaseSeconds) && options.leaseSeconds > 0
    ? options.leaseSeconds
    : DEFAULT_LEASE_SECONDS;

  function captureNow(value) {
    const current = value === undefined ? clock() : value;
    if (!Number.isFinite(current)) throw new TypeError('Push 시계가 올바르지 않습니다.');
    return Math.floor(current);
  }

  const activeSubscriptions = db.prepare(
    "SELECT id FROM assistant_push_subscriptions WHERE status = 'active'",
  );
  const insertDelivery = db.prepare(`
    INSERT INTO news_push_deliveries (
      candidate_id, subscription_id, status, next_attempt_at, expires_at, created_at, updated_at
    ) VALUES (@candidateId, @subscriptionId, 'pending', @nextAttemptAt, @expiresAt, @now, @now)
    ON CONFLICT(candidate_id, subscription_id) DO NOTHING
  `);

  const recoverLeases = db.prepare(`
    UPDATE news_push_deliveries
    SET status = 'pending', lease_until = NULL, updated_at = @now
    WHERE status = 'sending' AND lease_until <= @now
  `);
  const failExpired = db.prepare(`
    UPDATE news_push_deliveries
    SET status = 'failed', lease_until = NULL,
        last_error_code = 'DELIVERY_TTL_EXPIRED', updated_at = @now
    WHERE status IN ('pending', 'retry') AND expires_at <= @now
  `);
  // 이미 답을 받았거나 만료된 질문은 더 보내지 않는다. 사용자가 답한 뒤에 그
  // 질문이 다른 기기에서 울리면 두 번 묻는 것과 같다.
  const skipSettled = db.prepare(`
    UPDATE news_push_deliveries
    SET status = 'skipped', lease_until = NULL,
        last_error_code = 'TARGET_INACTIVE', updated_at = @now
    WHERE status IN ('pending', 'retry')
      AND candidate_id IN (
        SELECT id FROM news_review_candidates WHERE state NOT IN ('pending', 'delivered')
      )
  `);
  const selectClaimCandidate = db.prepare(`
    SELECT d.id
    FROM news_push_deliveries d
    JOIN news_review_candidates c ON c.id = d.candidate_id
    JOIN assistant_push_subscriptions s ON s.id = d.subscription_id
    WHERE d.status IN ('pending', 'retry')
      AND d.next_attempt_at <= @now
      AND d.expires_at > @now
      AND c.state IN ('pending', 'delivered')
      AND s.status = 'active'
    ORDER BY d.next_attempt_at ASC, d.id ASC
    LIMIT 1
  `);
  const claimDelivery = db.prepare(`
    UPDATE news_push_deliveries
    SET status = 'sending', lease_until = @leaseUntil,
        attempt_count = attempt_count + 1, last_attempt_at = @now, updated_at = @now
    WHERE id = @id AND status IN ('pending', 'retry') AND next_attempt_at <= @now
  `);
  const getClaimedDelivery = db.prepare(`
    SELECT d.id, d.candidate_id AS candidateId, d.subscription_id AS subscriptionId,
           d.attempt_count AS attemptCount, d.expires_at AS expiresAt,
           d.lease_until AS leaseUntil, s.endpoint, s.p256dh, s.auth
    FROM news_push_deliveries d
    JOIN assistant_push_subscriptions s ON s.id = d.subscription_id
    WHERE d.id = ?
    LIMIT 1
  `);
  const getSendableClaim = db.prepare(`
    SELECT d.id
    FROM news_push_deliveries d
    JOIN news_review_candidates c ON c.id = d.candidate_id
    JOIN assistant_push_subscriptions s ON s.id = d.subscription_id
    WHERE d.id = @id AND d.lease_until = @leaseUntil AND d.status = 'sending'
      AND d.expires_at > @now
      AND c.state IN ('pending', 'delivered')
      AND s.status = 'active'
    LIMIT 1
  `);

  const settleAccepted = db.prepare(`
    UPDATE news_push_deliveries
    SET status = 'accepted', lease_until = NULL, accepted_at = @now,
        last_http_status = @httpStatus, last_error_code = NULL, updated_at = @now
    WHERE id = @id AND status = 'sending' AND lease_until = @leaseUntil
  `);
  const settleRetry = db.prepare(`
    UPDATE news_push_deliveries
    SET status = 'retry', lease_until = NULL, next_attempt_at = @nextAttemptAt,
        last_http_status = @httpStatus, last_error_code = @errorCode, updated_at = @now
    WHERE id = @id AND status = 'sending' AND lease_until = @leaseUntil
  `);
  const settleFailed = db.prepare(`
    UPDATE news_push_deliveries
    SET status = 'failed', lease_until = NULL,
        last_http_status = @httpStatus, last_error_code = @errorCode, updated_at = @now
    WHERE id = @id AND status = 'sending' AND lease_until = @leaseUntil
  `);
  const settleExpired = db.prepare(`
    UPDATE news_push_deliveries
    SET status = 'expired', lease_until = NULL,
        last_http_status = @httpStatus, last_error_code = 'SUBSCRIPTION_EXPIRED', updated_at = @now
    WHERE id = @id AND status = 'sending' AND lease_until = @leaseUntil
  `);
  const settleSkippedClaim = db.prepare(`
    UPDATE news_push_deliveries
    SET status = 'skipped', lease_until = NULL,
        last_error_code = 'TARGET_INACTIVE', updated_at = @now
    WHERE id = @id AND status = 'sending' AND lease_until = @leaseUntil
  `);
  const markCandidateDelivered = db.prepare(`
    UPDATE news_review_candidates
    SET state = 'delivered', delivered_at = COALESCE(delivered_at, @now)
    WHERE id = @candidateId AND state = 'pending'
  `);

  // 구독 상태는 공유 표다. 성공·실패·만료 처리는 일정·메일과 같은 뜻이어야 한다.
  const markSubscriptionSuccess = db.prepare(`
    UPDATE assistant_push_subscriptions
    SET failure_count = 0, last_success_at = @now, updated_at = @now
    WHERE id = @subscriptionId AND status = 'active'
  `);
  const incrementSubscriptionFailure = db.prepare(`
    UPDATE assistant_push_subscriptions
    SET failure_count = failure_count + 1, updated_at = @now
    WHERE id = @subscriptionId AND status = 'active'
  `);
  const expireSubscription = db.prepare(`
    UPDATE assistant_push_subscriptions
    SET status = 'expired', failure_count = failure_count + 1, updated_at = @now
    WHERE id = @subscriptionId AND status = 'active'
  `);
  const expireOtherDeliveries = db.prepare(`
    UPDATE news_push_deliveries
    SET status = 'expired', lease_until = NULL,
        last_error_code = 'SUBSCRIPTION_EXPIRED', updated_at = @now
    WHERE subscription_id = @subscriptionId AND id != @id AND status IN ('pending', 'retry')
  `);

  const claimTransaction = db.transaction(now => {
    recoverLeases.run({ now });
    failExpired.run({ now });
    skipSettled.run({ now });
    const row = selectClaimCandidate.get({ now });
    if (!row) return null;
    const leaseUntil = now + leaseSeconds;
    if (claimDelivery.run({ id: row.id, now, leaseUntil }).changes !== 1) return null;
    return getClaimedDelivery.get(row.id);
  });
  const acceptTransaction = db.transaction((claim, httpStatus, now) => {
    const changed = settleAccepted.run({
      id: claim.id, leaseUntil: claim.leaseUntil, httpStatus, now,
    }).changes;
    if (changed === 1) {
      markSubscriptionSuccess.run({ subscriptionId: claim.subscriptionId, now });
      // 한 기기라도 받았으면 질문은 전달된 것이다.
      markCandidateDelivered.run({ candidateId: claim.candidateId, now });
    }
    return changed === 1;
  });
  const expireTransaction = db.transaction((claim, httpStatus, now) => {
    const changed = settleExpired.run({
      id: claim.id, leaseUntil: claim.leaseUntil, httpStatus, now,
    }).changes;
    if (changed === 1) {
      expireSubscription.run({ subscriptionId: claim.subscriptionId, now });
      expireOtherDeliveries.run({ subscriptionId: claim.subscriptionId, id: claim.id, now });
    }
    return changed === 1;
  });

  /**
   * 한 candidate를 살아 있는 기기 전부에 건다.
   *
   * 조용한 시간이면 보류 큐를 따로 만들지 않고 `next_attempt_at`만 미룬다
   * (`lib/mail/quiet-hours.js`, 설계 13.3의 방식 그대로).
   */
  const enqueue = db.transaction(({ candidateId, now }) => {
    const releaseAt = quietHoursReleaseAt(now, quietHours());
    const subscriptions = activeSubscriptions.all();
    let created = 0;
    subscriptions.forEach(subscription => {
      const changes = insertDelivery.run({
        candidateId,
        subscriptionId: subscription.id,
        nextAttemptAt: releaseAt,
        // TTL은 만들어진 시각 기준이다. 조용한 시간에 밀렸다고 수명이 늘면
        // 아침에 어제 질문이 되살아난다.
        expiresAt: now + ttlSeconds,
        now,
      }).changes;
      created += changes;
    });
    return created;
  });

  return {
    payloadKeys: [...NEWS_PUSH_PAYLOAD_KEYS],

    enqueueCandidate(candidateId, nowValue) {
      if (!enabled) return 0;
      return enqueue({ candidateId, now: captureNow(nowValue) });
    },

    claim(nowValue) {
      if (!enabled) return null;
      return claimTransaction(captureNow(nowValue));
    },

    isClaimSendable(claim, nowValue) {
      if (!claim) return false;
      return Boolean(getSendableClaim.get({
        id: claim.id, leaseUntil: claim.leaseUntil, now: captureNow(nowValue),
      }));
    },

    accept(claim, httpStatus, nowValue) {
      return acceptTransaction(claim, Number(httpStatus) || 201, captureNow(nowValue));
    },

    retry(claim, { httpStatus = null, errorCode = 'PUSH_RETRY', nextAttemptAt }, nowValue) {
      const now = captureNow(nowValue);
      if (!Number.isFinite(nextAttemptAt) || nextAttemptAt >= claim.expiresAt) {
        return this.fail(claim, { httpStatus, errorCode: 'DELIVERY_TTL_EXPIRED' }, now);
      }
      const changed = settleRetry.run({
        id: claim.id,
        leaseUntil: claim.leaseUntil,
        nextAttemptAt: Math.max(now + 1, Math.floor(nextAttemptAt)),
        httpStatus: Number(httpStatus) || null,
        errorCode: String(errorCode).slice(0, 80),
        now,
      }).changes;
      if (changed === 1) incrementSubscriptionFailure.run({ subscriptionId: claim.subscriptionId, now });
      return changed === 1;
    },

    fail(claim, { httpStatus = null, errorCode = 'PUSH_FAILED' }, nowValue) {
      const now = captureNow(nowValue);
      const changed = settleFailed.run({
        id: claim.id,
        leaseUntil: claim.leaseUntil,
        httpStatus: Number(httpStatus) || null,
        errorCode: String(errorCode).slice(0, 80),
        now,
      }).changes;
      if (changed === 1) incrementSubscriptionFailure.run({ subscriptionId: claim.subscriptionId, now });
      return changed === 1;
    },

    expire(claim, httpStatus, nowValue) {
      return expireTransaction(claim, Number(httpStatus) || null, captureNow(nowValue));
    },

    skipClaim(claim, nowValue) {
      return settleSkippedClaim.run({
        id: claim.id, leaseUntil: claim.leaseUntil, now: captureNow(nowValue),
      }).changes === 1;
    },
  };
}

module.exports = {
  NEWS_PUSH_PAYLOAD_KEYS,
  buildNewsPushPayload,
  buildNewsSendOptions,
  createNewsPushService,
};
