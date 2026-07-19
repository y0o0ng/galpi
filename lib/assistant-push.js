'use strict';

const net = require('node:net');

const DAY_SECONDS = 24 * 60 * 60;
const DEFAULT_LEASE_SECONDS = 30;
const DEFAULT_BATCH_SIZE = 10;

class AssistantPushError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = 'AssistantPushError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function pushError(message, code, statusCode = 400) {
  throw new AssistantPushError(message, code, statusCode);
}

function codePointLength(value) {
  return [...value].length;
}

function validateId(value, field = '항목') {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) pushError(`${field} ID가 올바르지 않습니다.`, 'INVALID_PUSH_ID');
  return id;
}

function isAllowedPushHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'fcm.googleapis.com'
    || host === 'updates.push.services.mozilla.com'
    || host === 'web.push.apple.com'
    || host.endsWith('.push.apple.com')
    || host.endsWith('.notify.windows.com');
}

function validateEndpoint(value, allowHost = isAllowedPushHost) {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 2048
    || value.trim() !== value
  ) {
    pushError('Push endpoint 길이가 올바르지 않습니다.', 'INVALID_PUSH_ENDPOINT');
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    pushError('Push endpoint URL이 올바르지 않습니다.', 'INVALID_PUSH_ENDPOINT');
  }
  if (
    url.protocol !== 'https:'
    || url.username || url.password
    || (url.port && url.port !== '443')
    || url.hash
    || net.isIP(url.hostname) !== 0
    || !allowHost(url.hostname)
  ) {
    pushError('허용되지 않는 Push endpoint입니다.', 'PUSH_ENDPOINT_NOT_ALLOWED');
  }
  return value;
}

function validateBase64Url(value, field, minLength, maxLength) {
  if (
    typeof value !== 'string'
    || value.length < minLength
    || value.length > maxLength
    || !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    pushError(`${field} 값이 올바르지 않습니다.`, 'INVALID_PUSH_KEY');
  }
  return value;
}

function normalizeSubscription(input, allowHost) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    pushError('Push 구독 형식이 올바르지 않습니다.', 'INVALID_PUSH_SUBSCRIPTION');
  }
  const keys = input.keys;
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) {
    pushError('Push 구독 키가 필요합니다.', 'INVALID_PUSH_SUBSCRIPTION');
  }
  const deviceLabel = String(input.deviceLabel || '').normalize('NFC').trim();
  if (codePointLength(deviceLabel) > 80) {
    pushError('기기 이름은 80자 이내여야 합니다.', 'PUSH_DEVICE_LABEL_TOO_LONG');
  }
  return {
    endpoint: validateEndpoint(input.endpoint, allowHost),
    p256dh: validateBase64Url(keys.p256dh, 'p256dh', 40, 128),
    auth: validateBase64Url(keys.auth, 'auth', 8, 64),
    deviceLabel,
  };
}

function publicSubscription(row, extra = {}) {
  return {
    id: row.id,
    status: row.status,
    deviceLabel: row.deviceLabel,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...extra,
  };
}

function createAssistantPushService(db, options = {}) {
  if (!db?.prepare || typeof db.transaction !== 'function') {
    throw new TypeError('SQLite DB 연결이 필요합니다.');
  }
  const enabled = options.enabled === true;
  const clock = typeof options.now === 'function' ? options.now : () => Math.floor(Date.now() / 1000);
  const allowHost = typeof options.allowHost === 'function' ? options.allowHost : isAllowedPushHost;
  const deliveryTtlSeconds = Number.isInteger(options.deliveryTtlSeconds) && options.deliveryTtlSeconds > 0
    ? options.deliveryTtlSeconds
    : DAY_SECONDS;
  const leaseSeconds = Number.isInteger(options.leaseSeconds) && options.leaseSeconds > 0
    ? options.leaseSeconds
    : DEFAULT_LEASE_SECONDS;

  function captureNow(value) {
    const current = value === undefined ? clock() : value;
    if (!Number.isFinite(current)) throw new TypeError('Push 시계가 올바르지 않습니다.');
    return Math.floor(current);
  }

  const getSubscriptionByEndpoint = db.prepare(`
    SELECT id, status, device_label AS deviceLabel,
           created_at AS createdAt, updated_at AS updatedAt
    FROM assistant_push_subscriptions
    WHERE endpoint = ?
    LIMIT 1
  `);
  const getSubscriptionById = db.prepare(`
    SELECT id, status, device_label AS deviceLabel,
           created_at AS createdAt, updated_at AS updatedAt
    FROM assistant_push_subscriptions
    WHERE id = ?
    LIMIT 1
  `);
  const upsertSubscription = db.prepare(`
    INSERT INTO assistant_push_subscriptions (
      endpoint, p256dh, auth, status, device_label,
      failure_count, last_success_at, created_at, updated_at
    ) VALUES (
      @endpoint, @p256dh, @auth, 'active', @deviceLabel,
      0, NULL, @now, @now
    )
    ON CONFLICT(endpoint) DO UPDATE SET
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      status = 'active',
      device_label = excluded.device_label,
      failure_count = 0,
      updated_at = excluded.updated_at
  `);
  const revokeSubscription = db.prepare(`
    UPDATE assistant_push_subscriptions
    SET status = 'revoked', updated_at = @now
    WHERE id = @id AND status != 'revoked'
  `);
  const skipSubscriptionDeliveries = db.prepare(`
    UPDATE assistant_push_deliveries
    SET status = 'skipped', lease_until = NULL,
        last_error_code = 'SUBSCRIPTION_INACTIVE', updated_at = @now
    WHERE subscription_id = @subscriptionId AND status IN ('pending', 'retry')
  `);
  const getReminderForDelivery = db.prepare(`
    SELECT r.id, r.remind_at AS remindAt, r.status,
           t.status AS taskStatus, t.lifecycle AS taskLifecycle
    FROM assistant_reminders r
    JOIN assistant_tasks t ON t.id = r.task_id
    WHERE r.id = ?
    LIMIT 1
  `);
  const enqueueDeliveries = db.prepare(`
    INSERT INTO assistant_push_deliveries (
      reminder_id, subscription_id, status, attempt_count,
      next_attempt_at, expires_at, created_at, updated_at
    )
    SELECT @reminderId, s.id, 'pending', 0,
           @now, @expiresAt, @now, @now
    FROM assistant_push_subscriptions s
    WHERE s.status = 'active'
    ON CONFLICT(reminder_id, subscription_id) DO NOTHING
  `);
  const skipTaskDeliveries = db.prepare(`
    UPDATE assistant_push_deliveries
    SET status = 'skipped', lease_until = NULL,
        last_error_code = 'TASK_INACTIVE', updated_at = @now
    WHERE reminder_id IN (SELECT id FROM assistant_reminders WHERE task_id = @taskId)
      AND status IN ('pending', 'retry')
  `);
  const skipReminderDeliveries = db.prepare(`
    UPDATE assistant_push_deliveries
    SET status = 'skipped', lease_until = NULL,
        last_error_code = 'REMINDER_RESOLVED', updated_at = @now
    WHERE reminder_id = @reminderId AND status IN ('pending', 'retry')
  `);
  const recoverLeases = db.prepare(`
    UPDATE assistant_push_deliveries
    SET status = 'retry', lease_until = NULL, next_attempt_at = @now,
        last_error_code = 'WORKER_LEASE_EXPIRED', updated_at = @now
    WHERE status = 'sending' AND lease_until <= @now AND expires_at > @now
  `);
  const failExpiredDeliveries = db.prepare(`
    UPDATE assistant_push_deliveries
    SET status = 'failed', lease_until = NULL,
        last_error_code = 'DELIVERY_TTL_EXPIRED', updated_at = @now
    WHERE expires_at <= @now
      AND (status IN ('pending', 'retry') OR (status = 'sending' AND lease_until <= @now))
  `);
  const skipIneligibleDeliveries = db.prepare(`
    UPDATE assistant_push_deliveries
    SET status = 'skipped', lease_until = NULL,
        last_error_code = 'TARGET_INACTIVE', updated_at = @now
    WHERE status IN ('pending', 'retry')
      AND (
        NOT EXISTS (
          SELECT 1
          FROM assistant_reminders r
          JOIN assistant_tasks t ON t.id = r.task_id
          WHERE r.id = assistant_push_deliveries.reminder_id
            AND r.status = 'fired'
            AND t.status = 'active'
            AND t.lifecycle = 'active'
        )
        OR NOT EXISTS (
          SELECT 1 FROM assistant_push_subscriptions s
          WHERE s.id = assistant_push_deliveries.subscription_id AND s.status = 'active'
        )
      )
  `);
  const selectClaimCandidate = db.prepare(`
    SELECT d.id
    FROM assistant_push_deliveries d
    JOIN assistant_reminders r ON r.id = d.reminder_id
    JOIN assistant_tasks t ON t.id = r.task_id
    JOIN assistant_push_subscriptions s ON s.id = d.subscription_id
    WHERE d.status IN ('pending', 'retry')
      AND d.next_attempt_at <= @now
      AND d.expires_at > @now
      AND r.status = 'fired'
      AND t.status = 'active'
      AND t.lifecycle = 'active'
      AND s.status = 'active'
    ORDER BY d.next_attempt_at ASC, d.id ASC
    LIMIT 1
  `);
  const claimDelivery = db.prepare(`
    UPDATE assistant_push_deliveries
    SET status = 'sending', lease_until = @leaseUntil,
        attempt_count = attempt_count + 1,
        last_attempt_at = @now, updated_at = @now
    WHERE id = @id
      AND status IN ('pending', 'retry')
      AND next_attempt_at <= @now
      AND expires_at > @now
  `);
  const getClaimedDelivery = db.prepare(`
    SELECT d.id, d.reminder_id AS reminderId,
           d.subscription_id AS subscriptionId,
           d.attempt_count AS attemptCount, d.expires_at AS expiresAt,
           d.lease_until AS leaseUntil,
           s.endpoint, s.p256dh, s.auth
    FROM assistant_push_deliveries d
    JOIN assistant_push_subscriptions s ON s.id = d.subscription_id
    WHERE d.id = ?
    LIMIT 1
  `);
  const getSendableClaim = db.prepare(`
    SELECT d.id
    FROM assistant_push_deliveries d
    JOIN assistant_reminders r ON r.id = d.reminder_id
    JOIN assistant_tasks t ON t.id = r.task_id
    JOIN assistant_push_subscriptions s ON s.id = d.subscription_id
    WHERE d.id = @id AND d.status = 'sending' AND d.lease_until = @leaseUntil
      AND d.expires_at > @now
      AND r.status = 'fired'
      AND t.status = 'active' AND t.lifecycle = 'active'
      AND s.status = 'active'
    LIMIT 1
  `);
  const settleAccepted = db.prepare(`
    UPDATE assistant_push_deliveries
    SET status = 'accepted', lease_until = NULL,
        last_http_status = @httpStatus, last_error_code = NULL,
        accepted_at = @now, updated_at = @now
    WHERE id = @id AND status = 'sending' AND lease_until = @leaseUntil
  `);
  const markSubscriptionSuccess = db.prepare(`
    UPDATE assistant_push_subscriptions
    SET failure_count = 0, last_success_at = @now, updated_at = @now
    WHERE id = @subscriptionId AND status = 'active'
  `);
  const settleRetry = db.prepare(`
    UPDATE assistant_push_deliveries
    SET status = 'retry', lease_until = NULL,
        next_attempt_at = @nextAttemptAt,
        last_http_status = @httpStatus,
        last_error_code = @errorCode, updated_at = @now
    WHERE id = @id AND status = 'sending' AND lease_until = @leaseUntil
  `);
  const settleFailed = db.prepare(`
    UPDATE assistant_push_deliveries
    SET status = 'failed', lease_until = NULL,
        last_http_status = @httpStatus,
        last_error_code = @errorCode, updated_at = @now
    WHERE id = @id AND status = 'sending' AND lease_until = @leaseUntil
  `);
  const settleExpired = db.prepare(`
    UPDATE assistant_push_deliveries
    SET status = 'expired', lease_until = NULL,
        last_http_status = @httpStatus,
        last_error_code = 'SUBSCRIPTION_EXPIRED', updated_at = @now
    WHERE id = @id AND status = 'sending' AND lease_until = @leaseUntil
  `);
  const expireSubscription = db.prepare(`
    UPDATE assistant_push_subscriptions
    SET status = 'expired', failure_count = failure_count + 1, updated_at = @now
    WHERE id = @subscriptionId AND status = 'active'
  `);
  const expireOtherSubscriptionDeliveries = db.prepare(`
    UPDATE assistant_push_deliveries
    SET status = 'expired', lease_until = NULL,
        last_error_code = 'SUBSCRIPTION_EXPIRED', updated_at = @now
    WHERE subscription_id = @subscriptionId AND id != @id
      AND status IN ('pending', 'retry')
  `);
  const incrementSubscriptionFailure = db.prepare(`
    UPDATE assistant_push_subscriptions
    SET failure_count = failure_count + 1, updated_at = @now
    WHERE id = @subscriptionId AND status = 'active'
  `);
  const settleSkippedClaim = db.prepare(`
    UPDATE assistant_push_deliveries
    SET status = 'skipped', lease_until = NULL,
        last_error_code = 'TARGET_INACTIVE', updated_at = @now
    WHERE id = @id AND status = 'sending' AND lease_until = @leaseUntil
  `);

  const registerTransaction = db.transaction((normalized, now) => {
    const existing = getSubscriptionByEndpoint.get(normalized.endpoint);
    upsertSubscription.run({ ...normalized, now });
    const current = getSubscriptionByEndpoint.get(normalized.endpoint);
    return publicSubscription(current, { replayed: Boolean(existing) });
  });
  const revokeTransaction = db.transaction((id, now) => {
    const current = getSubscriptionById.get(id);
    if (!current) pushError('Push 구독을 찾을 수 없습니다.', 'PUSH_SUBSCRIPTION_NOT_FOUND', 404);
    if (current.status === 'revoked') return publicSubscription(current, { unchanged: true });
    revokeSubscription.run({ id, now });
    skipSubscriptionDeliveries.run({ subscriptionId: id, now });
    return publicSubscription(getSubscriptionById.get(id), { unchanged: false });
  });
  const claimTransaction = db.transaction(now => {
    recoverLeases.run({ now });
    failExpiredDeliveries.run({ now });
    skipIneligibleDeliveries.run({ now });
    const candidate = selectClaimCandidate.get({ now });
    if (!candidate) return null;
    const leaseUntil = now + leaseSeconds;
    if (claimDelivery.run({ id: candidate.id, now, leaseUntil }).changes !== 1) return null;
    return getClaimedDelivery.get(candidate.id);
  });
  const acceptTransaction = db.transaction((claim, httpStatus, now) => {
    const changed = settleAccepted.run({
      id: claim.id, leaseUntil: claim.leaseUntil, httpStatus, now,
    }).changes;
    if (changed === 1) markSubscriptionSuccess.run({ subscriptionId: claim.subscriptionId, now });
    return changed === 1;
  });
  const expireTransaction = db.transaction((claim, httpStatus, now) => {
    const changed = settleExpired.run({
      id: claim.id, leaseUntil: claim.leaseUntil, httpStatus, now,
    }).changes;
    if (changed === 1) {
      expireSubscription.run({ subscriptionId: claim.subscriptionId, now });
      expireOtherSubscriptionDeliveries.run({ subscriptionId: claim.subscriptionId, id: claim.id, now });
    }
    return changed === 1;
  });

  function failDelivery(claim, { httpStatus = null, errorCode: failureCode = 'PUSH_FAILED' }, now) {
    const changed = settleFailed.run({
      id: claim.id,
      leaseUntil: claim.leaseUntil,
      httpStatus: Number(httpStatus) || null,
      errorCode: String(failureCode).slice(0, 80),
      now,
    }).changes;
    if (changed === 1) incrementSubscriptionFailure.run({ subscriptionId: claim.subscriptionId, now });
    return changed === 1;
  }

  return {
    enabled,

    register(input) {
      if (!enabled) pushError('Web Push가 아직 활성화되지 않았습니다.', 'WEB_PUSH_DISABLED', 503);
      return registerTransaction(normalizeSubscription(input, allowHost), captureNow());
    },

    revoke(idValue) {
      if (!enabled) pushError('Web Push가 아직 활성화되지 않았습니다.', 'WEB_PUSH_DISABLED', 503);
      return revokeTransaction(validateId(idValue, '구독'), captureNow());
    },

    enqueueReminder(reminderIdValue, firedAtValue) {
      if (!enabled) return 0;
      const reminderId = validateId(reminderIdValue, '알림');
      const now = captureNow(firedAtValue);
      const reminder = getReminderForDelivery.get(reminderId);
      if (
        !reminder
        || reminder.status !== 'fired'
        || reminder.taskStatus !== 'active'
        || reminder.taskLifecycle !== 'active'
        || reminder.remindAt > now
      ) return 0;
      const expiresAt = reminder.remindAt + deliveryTtlSeconds;
      if (expiresAt <= now) return 0;
      return enqueueDeliveries.run({ reminderId, now, expiresAt }).changes;
    },

    skipTask(taskIdValue, nowValue) {
      if (!enabled) return 0;
      return skipTaskDeliveries.run({
        taskId: validateId(taskIdValue, '일정'), now: captureNow(nowValue),
      }).changes;
    },

    skipReminder(reminderIdValue, nowValue) {
      if (!enabled) return 0;
      return skipReminderDeliveries.run({
        reminderId: validateId(reminderIdValue, '알림'), now: captureNow(nowValue),
      }).changes;
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
        return failDelivery(claim, { httpStatus, errorCode: 'DELIVERY_TTL_EXPIRED' }, now);
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
      return failDelivery(claim, { httpStatus, errorCode }, captureNow(nowValue));
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

function errorCode(error) {
  const value = String(error?.code || error?.name || 'PUSH_NETWORK_ERROR').toUpperCase();
  return value.replace(/[^A-Z0-9_:-]/g, '_').slice(0, 80) || 'PUSH_NETWORK_ERROR';
}

function retryAfterSeconds(headers, now) {
  const raw = headers?.get?.('retry-after')
    ?? headers?.['retry-after']
    ?? headers?.['Retry-After'];
  if (raw === undefined || raw === null || raw === '') return null;
  if (/^\d+$/.test(String(raw).trim())) return Math.max(1, Number(raw));
  const epoch = Math.floor(Date.parse(String(raw)) / 1000);
  return Number.isFinite(epoch) ? Math.max(1, epoch - now) : null;
}

function createAssistantPushDispatcher(service, options = {}) {
  if (!service?.claim || !service?.accept) throw new TypeError('Push service가 필요합니다.');
  if (typeof options.transport?.send !== 'function') throw new TypeError('Push transport가 필요합니다.');
  const transport = options.transport;
  const clock = typeof options.now === 'function' ? options.now : () => Math.floor(Date.now() / 1000);
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const intervalMs = Number.isInteger(options.intervalMs) && options.intervalMs > 0
    ? options.intervalMs
    : 5_000;
  const batchSize = Number.isInteger(options.batchSize) && options.batchSize > 0
    ? Math.min(options.batchSize, 100)
    : DEFAULT_BATCH_SIZE;
  const onError = typeof options.onError === 'function' ? options.onError : () => {};
  let timer = null;
  let activeTick = null;

  function captureNow() {
    const value = clock();
    if (!Number.isFinite(value)) throw new TypeError('Push dispatcher 시계가 올바르지 않습니다.');
    return Math.floor(value);
  }

  async function deliver(claim) {
    const beforeSend = captureNow();
    if (!service.isClaimSendable(claim, beforeSend)) {
      service.skipClaim(claim, beforeSend);
      return 'skipped';
    }
    const ttl = Math.max(1, claim.expiresAt - beforeSend);
    const payload = JSON.stringify({
      version: 1,
      type: 'task_reminder',
      reminderId: claim.reminderId,
      url: '/?panel=agents&taskView=reminders',
    });
    try {
      const result = await transport.send({
        endpoint: claim.endpoint,
        keys: { p256dh: claim.p256dh, auth: claim.auth },
      }, payload, {
        ttl,
        urgency: 'high',
        topic: `task-${claim.reminderId}`.slice(0, 32),
      });
      const status = Number(result?.statusCode) || 201;
      if (status >= 200 && status < 300) {
        service.accept(claim, status, captureNow());
        return 'accepted';
      }
      const unexpected = new Error(`Push HTTP ${status}`);
      unexpected.statusCode = status;
      unexpected.headers = result?.headers;
      throw unexpected;
    } catch (error) {
      const now = captureNow();
      const status = Number(error?.statusCode) || null;
      if (status === 404 || status === 410) {
        service.expire(claim, status, now);
        return 'expired';
      }
      if (status === 408 || status === 429 || status >= 500 || status === null) {
        const retryAfter = retryAfterSeconds(error?.headers, now);
        const exponential = Math.min(60 * (2 ** Math.max(0, claim.attemptCount - 1)), 60 * 60);
        const delay = retryAfter ?? exponential + Math.floor(random() * 30);
        service.retry(claim, {
          httpStatus: status,
          errorCode: errorCode(error),
          nextAttemptAt: now + delay,
        }, now);
        return 'retry';
      }
      service.fail(claim, { httpStatus: status, errorCode: errorCode(error) }, now);
      return 'failed';
    }
  }

  async function tick() {
    if (!service.enabled) return { processed: 0, skipped: false };
    if (activeTick) return { processed: 0, skipped: true };
    const run = (async () => {
      let processed = 0;
      while (processed < batchSize) {
        const claim = service.claim(captureNow());
        if (!claim) break;
        await deliver(claim);
        processed += 1;
      }
      return { processed, skipped: false };
    })();
    activeTick = run;
    try {
      return await run;
    } finally {
      activeTick = null;
    }
  }

  function runTick() {
    tick().catch(onError);
  }

  return {
    tick,
    start() {
      if (!service.enabled || timer) return false;
      runTick();
      timer = setInterval(runTick, intervalMs);
      timer.unref?.();
      return true;
    },
    stop() {
      if (!timer) return false;
      clearInterval(timer);
      timer = null;
      return true;
    },
    async drain(timeoutMs = 1500) {
      if (!activeTick) return true;
      let timeout;
      const completed = await Promise.race([
        activeTick.then(() => true, () => true),
        new Promise(resolve => { timeout = setTimeout(() => resolve(false), timeoutMs); }),
      ]);
      clearTimeout(timeout);
      return completed;
    },
    isRunning() {
      return timer !== null;
    },
  };
}

module.exports = {
  AssistantPushError,
  createAssistantPushDispatcher,
  createAssistantPushService,
  isAllowedPushHost,
  retryAfterSeconds,
  validateEndpoint,
};
