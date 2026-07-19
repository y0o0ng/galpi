'use strict';

function createAssistantScheduler(db, options = {}) {
  if (!db?.prepare || typeof db.transaction !== 'function') {
    throw new TypeError('SQLite DB 연결이 필요합니다.');
  }
  const clock = typeof options.now === 'function' ? options.now : () => Math.floor(Date.now() / 1000);
  const intervalMs = Number.isInteger(options.intervalMs) && options.intervalMs > 0
    ? options.intervalMs
    : 60_000;
  const batchSize = Number.isInteger(options.batchSize) && options.batchSize > 0
    ? Math.min(options.batchSize, 100)
    : 100;
  const onError = typeof options.onError === 'function' ? options.onError : () => {};
  const onReminderFired = typeof options.onReminderFired === 'function'
    ? options.onReminderFired
    : () => {};

  const selectDue = db.prepare(`
    SELECT r.id
    FROM assistant_reminders r
    JOIN assistant_tasks t ON t.id = r.task_id
    WHERE r.status = 'pending'
      AND r.remind_at <= ?
      AND t.status = 'active'
      AND t.lifecycle = 'active'
    ORDER BY r.remind_at ASC, r.id ASC
    LIMIT ?
  `);
  const fireReminder = db.prepare(`
    UPDATE assistant_reminders
    SET status = 'fired', fired_at = @now, updated_at = @now
    WHERE id = @id
      AND status = 'pending'
      AND EXISTS (
        SELECT 1
        FROM assistant_tasks t
        WHERE t.id = assistant_reminders.task_id
          AND t.status = 'active'
          AND t.lifecycle = 'active'
      )
  `);
  const fireDue = db.transaction(now => {
    const rows = selectDue.all(now, batchSize);
    const firedIds = [];
    for (const row of rows) {
      if (fireReminder.run({ id: row.id, now }).changes === 1) {
        onReminderFired(row.id, now);
        firedIds.push(row.id);
      }
    }
    return firedIds;
  });

  let timer = null;
  let ticking = false;

  function captureNow(value) {
    const current = value === undefined ? clock() : value;
    if (!Number.isFinite(current)) throw new TypeError('scheduler 시계가 올바르지 않습니다.');
    return Math.floor(current);
  }

  function tick(value) {
    const now = captureNow(value);
    if (ticking) return { capturedAt: now, firedIds: [], skipped: true };
    ticking = true;
    try {
      return { capturedAt: now, firedIds: fireDue(now), skipped: false };
    } finally {
      ticking = false;
    }
  }

  function runScheduledTick() {
    try {
      tick();
    } catch (error) {
      onError(error);
    }
  }

  return {
    tick,
    start() {
      if (timer) return false;
      runScheduledTick();
      timer = setInterval(runScheduledTick, intervalMs);
      timer.unref?.();
      return true;
    },
    stop() {
      if (!timer) return false;
      clearInterval(timer);
      timer = null;
      return true;
    },
    isRunning() {
      return timer !== null;
    },
  };
}

module.exports = { createAssistantScheduler };
