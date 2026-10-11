'use strict';

// 후보 배치의 Web Push 전달. lib/news/push.js와 같은 모양이다 — claim·retry·410 만료·lease는
// `createAssistantPushDispatcher`가 처리하고, 여기는 그 dispatcher가 요구하는 service 표면과
// 자기 상태표만 갖는다. 구독과 transport는 일정·메일·뉴스와 공유한다.
//
// **payload에는 주제 문구를 싣지 않는다.** 잠금화면에 기사·개념 제목이 뜨면 옆 사람이 읽는다.
// **이 목록이 늘어나는 변경은 privacy 결정이다.**
// delivery kind는 후보·편으로 유지하고 batch_id 접미사로 없음·실패·주제 피드백을 구분한다.
const { DEFAULT_QUIET_HOURS, quietHoursReleaseAt } = require('../mail/quiet-hours');

const CARDS_PUSH_PAYLOAD_KEYS = ['version', 'type', 'batchId', 'url'];

const CARDS_EPISODE_PUSH_PAYLOAD_KEYS = ['version', 'type', 'episodeId', 'url'];

const DAY_SECONDS = 24 * 60 * 60;
// 하루 지난 후보 알림은 보내지 않는다. 다음 날 배치가 곧 온다.
const TTL_SECONDS = DAY_SECONDS;
const LEASE_SECONDS = 30;

function buildCardsPushPayload(claim) {
  if (claim?.kind === 'episode') {
    const failed=/^([1-9]\d{0,9})-failed-[1-3]$/.exec(String(claim.batchId||''));
    if(failed)return JSON.stringify({version:1,type:'cards_episode_failed',episodeId:Number(failed[1]),url:'/?panel=agents'});
    if (!/^[1-9]\d{0,9}(-r[1-9]\d{0,3})?$/.test(String(claim.batchId ?? ''))) {
      throw Object.assign(new Error('Cards push payload의 episodeId가 올바르지 않습니다.'), { code: 'CARDS_PUSH_INVALID_TARGET' });
    }
    return JSON.stringify({ version: 1, type: 'cards_episode', episodeId: Number.parseInt(claim.batchId, 10), url: '/?panel=agents' });
  }
  if(/^topic-[0-9a-f-]{36}-r[1-9]\d{0,6}$/.test(String(claim?.batchId||'')))return JSON.stringify({version:1,type:claim.topicError?'cards_topic_failed':'cards_topic_reviewed',batchId:claim.batchId,url:'/?panel=agents'});
  const outcome=/^(\d{4}-\d{2}-\d{2})-(empty|failed-\d)$/.exec(String(claim?.batchId||''));
  if(outcome)return JSON.stringify({version:1,type:outcome[2]==='empty'?'cards_candidates_empty':'cards_candidates_failed',batchId:outcome[1],url:'/?panel=agents'});
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(claim?.batchId ?? ''))) {
    throw Object.assign(new Error('Cards push payload의 batchId가 올바르지 않습니다.'), { code: 'CARDS_PUSH_INVALID_TARGET' });
  }
  return JSON.stringify({ version: 1, type: 'cards_candidates', batchId: claim.batchId, url: '/?panel=agents' });
}

// topic은 주지 않는다. 하루 한 번이라 합칠 이전 알림이 없다(문자열을 만들면 dispatcher가 해시한다).
function buildCardsSendOptions() {
  return { urgency: 'normal' };
}

function createCardsPushService(db, options = {}) {
  if (!db?.prepare || typeof db.transaction !== 'function') throw new TypeError('SQLite DB 연결이 필요합니다.');
  const clock = typeof options.now === 'function' ? options.now : () => Math.floor(Date.now() / 1000);
  const quietHours = typeof options.quietHours === 'function' ? options.quietHours : () => DEFAULT_QUIET_HOURS;

  function captureNow(value) {
    const current = value === undefined ? clock() : value;
    if (!Number.isFinite(current)) throw new TypeError('Push 시계가 올바르지 않습니다.');
    return Math.floor(current);
  }

  // 배치에 아직 결정 전 카드가 있을 때, 편은 아직 검토 대기(ready)일 때만 보낼 가치가 있다. 이미 결정했다면 울리지 않는다.
  const OPEN_BATCH = `(
    (d.kind = 'candidates' AND EXISTS (
      SELECT 1 FROM cards_candidates c WHERE c.batch_id = d.batch_id AND c.status = 'candidate'
    )) OR
    (d.kind = 'candidates' AND EXISTS (
      SELECT 1 FROM cards_runs r WHERE
        (d.batch_id = r.day || '-empty' AND r.outcome = 'ok' AND NOT EXISTS (SELECT 1 FROM cards_candidates c WHERE c.batch_id=r.day)) OR
        (d.batch_id = r.day || '-failed-' || r.attempts AND r.outcome = 'failed')
    )) OR
    (d.kind = 'candidates' AND EXISTS (
      SELECT 1 FROM app_settings a WHERE a.key='cards.manual_topic'
        AND d.batch_id='topic-' || json_extract(a.value_json,'$.id') || '-r' || json_extract(a.value_json,'$.revision')
        AND json_extract(a.value_json,'$.status') IN ('ready','feedback')
    )) OR
    (d.kind = 'episode' AND EXISTS (
      SELECT 1 FROM cards_jobs e WHERE d.batch_id=CAST(e.id AS TEXT) || '-failed-' || e.attempts AND e.status IN ('failed','blocked')
    )) OR
    (d.kind = 'episode' AND EXISTS (
      SELECT 1 FROM cards_jobs e WHERE CAST(e.id AS TEXT) = CASE WHEN instr(d.batch_id, '-r') > 0 THEN substr(d.batch_id, 1, instr(d.batch_id, '-r') - 1) ELSE d.batch_id END
        AND e.status = 'ready'
    ))
  )`;

  const activeSubscriptions = db.prepare("SELECT id FROM assistant_push_subscriptions WHERE status = 'active'");
  const insertDelivery = db.prepare(`
    INSERT INTO cards_push_deliveries (batch_id, kind, subscription_id, status, next_attempt_at, expires_at, created_at, updated_at)
    VALUES (@batchId, @kind, @subscriptionId, 'pending', @nextAttemptAt, @expiresAt, @now, @now)
    ON CONFLICT(batch_id, subscription_id) DO NOTHING
  `);
  const recoverLeases = db.prepare(`
    UPDATE cards_push_deliveries SET status = 'pending', lease_until = NULL, updated_at = @now
    WHERE status = 'sending' AND lease_until <= @now
  `);
  const failExpired = db.prepare(`
    UPDATE cards_push_deliveries
    SET status = 'failed', lease_until = NULL, last_error_code = 'DELIVERY_TTL_EXPIRED', updated_at = @now
    WHERE status IN ('pending', 'retry') AND expires_at <= @now
  `);
  const skipSettled = db.prepare(`
    UPDATE cards_push_deliveries AS d
    SET status = 'skipped', lease_until = NULL, last_error_code = 'TARGET_INACTIVE', updated_at = @now
    WHERE status IN ('pending', 'retry') AND NOT ${OPEN_BATCH}
  `);
  const selectClaim = db.prepare(`
    SELECT d.id
    FROM cards_push_deliveries d
    JOIN assistant_push_subscriptions s ON s.id = d.subscription_id
    WHERE d.status IN ('pending', 'retry') AND d.next_attempt_at <= @now AND d.expires_at > @now
      AND s.status = 'active' AND ${OPEN_BATCH}
    ORDER BY d.next_attempt_at ASC, d.id ASC
    LIMIT 1
  `);
  const claimDelivery = db.prepare(`
    UPDATE cards_push_deliveries
    SET status = 'sending', lease_until = @leaseUntil,
        attempt_count = attempt_count + 1, last_attempt_at = @now, updated_at = @now
    WHERE id = @id AND status IN ('pending', 'retry') AND next_attempt_at <= @now
  `);
  const getClaimed = db.prepare(`
    SELECT d.id, d.batch_id AS batchId, d.kind, d.subscription_id AS subscriptionId,
           d.attempt_count AS attemptCount, d.expires_at AS expiresAt,
           d.lease_until AS leaseUntil, s.endpoint, s.p256dh, s.auth,
           (SELECT json_extract(value_json,'$.errorCode') FROM app_settings WHERE key='cards.manual_topic') AS topicError
    FROM cards_push_deliveries d
    JOIN assistant_push_subscriptions s ON s.id = d.subscription_id
    WHERE d.id = ?
  `);
  const getSendable = db.prepare(`
    SELECT d.id
    FROM cards_push_deliveries d
    JOIN assistant_push_subscriptions s ON s.id = d.subscription_id
    WHERE d.id = @id AND d.lease_until = @leaseUntil AND d.status = 'sending'
      AND d.expires_at > @now AND s.status = 'active' AND ${OPEN_BATCH}
  `);
  const settle = status => db.prepare(`
    UPDATE cards_push_deliveries
    SET status = '${status}', lease_until = NULL, last_http_status = @httpStatus,
        last_error_code = @errorCode, updated_at = @now
        ${status === 'accepted' ? ', accepted_at = @now' : ''}
    WHERE id = @id AND status = 'sending' AND lease_until = @leaseUntil
  `);
  const settleAccepted = settle('accepted');
  const settleFailed = settle('failed');
  const settleExpired = settle('expired');
  const settleSkipped = settle('skipped');
  const settleRetry = db.prepare(`
    UPDATE cards_push_deliveries
    SET status = 'retry', lease_until = NULL, next_attempt_at = @nextAttemptAt,
        last_http_status = @httpStatus, last_error_code = @errorCode, updated_at = @now
    WHERE id = @id AND status = 'sending' AND lease_until = @leaseUntil
  `);

  // 구독 상태는 공유 표다. 성공·실패·만료는 일정·메일·뉴스와 같은 뜻이어야 한다.
  const subscriptionSuccess = db.prepare(`
    UPDATE assistant_push_subscriptions SET failure_count = 0, last_success_at = @now, updated_at = @now
    WHERE id = @subscriptionId AND status = 'active'
  `);
  const subscriptionFailure = db.prepare(`
    UPDATE assistant_push_subscriptions SET failure_count = failure_count + 1, updated_at = @now
    WHERE id = @subscriptionId AND status = 'active'
  `);
  const subscriptionExpire = db.prepare(`
    UPDATE assistant_push_subscriptions SET status = 'expired', failure_count = failure_count + 1, updated_at = @now
    WHERE id = @subscriptionId AND status = 'active'
  `);
  const expireOthers = db.prepare(`
    UPDATE cards_push_deliveries
    SET status = 'expired', lease_until = NULL, last_error_code = 'SUBSCRIPTION_EXPIRED', updated_at = @now
    WHERE subscription_id = @subscriptionId AND id != @id AND status IN ('pending', 'retry')
  `);

  const claimTx = db.transaction(now => {
    recoverLeases.run({ now });
    failExpired.run({ now });
    skipSettled.run({ now });
    const row = selectClaim.get({ now });
    if (!row) return null;
    if (claimDelivery.run({ id: row.id, now, leaseUntil: now + LEASE_SECONDS }).changes !== 1) return null;
    return getClaimed.get(row.id);
  });
  const params = (claim, httpStatus, errorCode, now) => ({
    id: claim.id, leaseUntil: claim.leaseUntil, httpStatus: Number(httpStatus) || null,
    errorCode: errorCode ? String(errorCode).slice(0, 80) : null, now,
  });
  const acceptTx = db.transaction((claim, httpStatus, now) => {
    const changed = settleAccepted.run(params(claim, httpStatus || 201, null, now)).changes;
    if (changed === 1) subscriptionSuccess.run({ subscriptionId: claim.subscriptionId, now });
    return changed === 1;
  });
  const expireTx = db.transaction((claim, httpStatus, now) => {
    const changed = settleExpired.run(params(claim, httpStatus, 'SUBSCRIPTION_EXPIRED', now)).changes;
    if (changed === 1) {
      subscriptionExpire.run({ subscriptionId: claim.subscriptionId, now });
      expireOthers.run({ subscriptionId: claim.subscriptionId, id: claim.id, now });
    }
    return changed === 1;
  });
  // 조용한 시간이면 보류 큐 없이 next_attempt_at만 미룬다. TTL은 만들어진 시각 기준이다.
  const enqueue = db.transaction(({ batchId, kind, now }) => {
    const releaseAt = quietHoursReleaseAt(now, quietHours());
    let created = 0;
    activeSubscriptions.all().forEach(subscription => {
      created += insertDelivery.run({
        batchId, kind, subscriptionId: subscription.id, nextAttemptAt: releaseAt, expiresAt: now + TTL_SECONDS, now,
      }).changes;
    });
    return created;
  });

  return {
    // 공용 dispatcher는 service.enabled가 참일 때만 돈다. 이 서비스는 플래그가 켜졌을 때만 만들어진다(server.js).
    enabled: true,
    payloadKeys: [...CARDS_PUSH_PAYLOAD_KEYS],
    enqueueBatch: (batchId, nowValue) => enqueue({ batchId, kind: 'candidates', now: captureNow(nowValue) }),
    enqueueEmpty: (day, nowValue) => enqueue({batchId:`${day}-empty`,kind:'candidates',now:captureNow(nowValue)}),
    enqueueFailure(day,nowValue){const row=db.prepare('SELECT attempts FROM cards_runs WHERE day=?').get(day);return row?enqueue({batchId:`${day}-failed-${row.attempts}`,kind:'candidates',now:captureNow(nowValue)}):0;},
    enqueueTopic: (id, revision, nowValue) => enqueue({batchId:`topic-${id}-r${revision}`,kind:'candidates',now:captureNow(nowValue)}),
    enqueueProductionFailure(id,nowValue){const row=db.prepare('SELECT attempts FROM cards_jobs WHERE id=?').get(id);return row?enqueue({batchId:`${id}-failed-${row.attempts}`,kind:'episode',now:captureNow(nowValue)}):0;},
    // 수정(n번째)마다 한 번씩: delivery 키를 `<id>-r<n>`으로 둬 기존 UNIQUE(batch_id, subscription_id)를 그대로 지킨다.
    enqueueEpisode: (episodeId, nowValue, revision = 0) => enqueue({
      batchId: revision ? `${episodeId}-r${revision}` : String(episodeId), kind: 'episode', now: captureNow(nowValue),
    }),
    claim: nowValue => claimTx(captureNow(nowValue)),
    isClaimSendable(claim, nowValue) {
      return Boolean(claim && getSendable.get({ id: claim.id, leaseUntil: claim.leaseUntil, now: captureNow(nowValue) }));
    },
    accept: (claim, httpStatus, nowValue) => acceptTx(claim, httpStatus, captureNow(nowValue)),
    retry(claim, { httpStatus = null, errorCode = 'PUSH_RETRY', nextAttemptAt }, nowValue) {
      const now = captureNow(nowValue);
      if (!Number.isFinite(nextAttemptAt) || nextAttemptAt >= claim.expiresAt) {
        return this.fail(claim, { httpStatus, errorCode: 'DELIVERY_TTL_EXPIRED' }, now);
      }
      const changed = settleRetry.run({
        ...params(claim, httpStatus, errorCode, now), nextAttemptAt: Math.max(now + 1, Math.floor(nextAttemptAt)),
      }).changes;
      if (changed === 1) subscriptionFailure.run({ subscriptionId: claim.subscriptionId, now });
      return changed === 1;
    },
    fail(claim, { httpStatus = null, errorCode = 'PUSH_FAILED' }, nowValue) {
      const now = captureNow(nowValue);
      const changed = settleFailed.run(params(claim, httpStatus, errorCode, now)).changes;
      if (changed === 1) subscriptionFailure.run({ subscriptionId: claim.subscriptionId, now });
      return changed === 1;
    },
    expire: (claim, httpStatus, nowValue) => expireTx(claim, httpStatus, captureNow(nowValue)),
    skipClaim: (claim, nowValue) => settleSkipped.run(params(claim, null, 'TARGET_INACTIVE', captureNow(nowValue))).changes === 1,
  };
}

module.exports = {
  CARDS_EPISODE_PUSH_PAYLOAD_KEYS,
  CARDS_PUSH_PAYLOAD_KEYS,
  buildCardsPushPayload,
  buildCardsSendOptions,
  createCardsPushService,
};
