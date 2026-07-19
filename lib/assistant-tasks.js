'use strict';

const crypto = require('node:crypto');

const KST_TIMEZONE = 'Asia/Seoul';
const KST_OFFSET_SECONDS = 9 * 60 * 60;
const DAY_SECONDS = 24 * 60 * 60;
const REQUEST_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

const TASK_COLUMNS = `
  id,
  client_request_id AS clientRequestId,
  create_payload_sha256 AS createPayloadSha256,
  title,
  detail,
  status,
  lifecycle,
  deleted_from_lifecycle AS deletedFromLifecycle,
  due_kind AS dueKind,
  due_date AS dueDate,
  due_at AS dueAt,
  timezone,
  reminder_version AS reminderVersion,
  version,
  created_at AS createdAt,
  updated_at AS updatedAt,
  completed_at AS completedAt,
  cancelled_at AS cancelledAt,
  closed_at AS closedAt,
  deleted_at AS deletedAt
`;

const REMINDER_COLUMNS = `
  id,
  task_id AS taskId,
  remind_at AS remindAt,
  status,
  occurrence_key AS occurrenceKey,
  snoozed_from_id AS snoozedFromId,
  snooze_request_key AS snoozeRequestKey,
  fired_at AS firedAt,
  acknowledged_at AS acknowledgedAt,
  acknowledgement_action AS acknowledgementAction,
  cancellation_reason AS cancellationReason,
  cancelled_at AS cancelledAt,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

class AssistantTaskError extends Error {
  constructor(message, code, statusCode = 400, task = null) {
    super(message);
    this.name = 'AssistantTaskError';
    this.code = code;
    this.statusCode = statusCode;
    this.task = task;
  }
}

function taskError(message, code, statusCode = 400, task = null) {
  throw new AssistantTaskError(message, code, statusCode, task);
}

function codePointLength(value) {
  return [...value].length;
}

function normalizeText(value, field, maxLength, { required = false } = {}) {
  if (typeof value !== 'string') taskError(`${field}은 문자열이어야 합니다.`, 'INVALID_TASK_INPUT');
  const normalized = value.normalize('NFC').trim();
  const length = codePointLength(normalized);
  if (required && length === 0) taskError(`${field}을 입력해주세요.`, 'INVALID_TASK_INPUT');
  if (length > maxLength) taskError(`${field}은 ${maxLength}자 이하여야 합니다.`, 'INVALID_TASK_INPUT');
  return normalized;
}

function validateRequestKey(value, field = 'clientRequestId') {
  if (typeof value !== 'string' || !REQUEST_KEY_PATTERN.test(value)) {
    taskError(`${field} 형식이 올바르지 않습니다.`, 'INVALID_REQUEST_KEY');
  }
  return value;
}

function validateExpectedVersion(value) {
  if (!Number.isInteger(value) || value < 1) {
    taskError('expectedVersion은 1 이상의 정수여야 합니다.', 'INVALID_TASK_VERSION');
  }
  return value;
}

function validateId(value, label) {
  const id = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(id) || id < 1) taskError(`${label} ID가 올바르지 않습니다.`, 'INVALID_ID');
  return id;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isValidDateParts(year, month, day) {
  return year >= 1970 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function formatDateParts(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseKstDate(value) {
  if (typeof value !== 'string') taskError('날짜 형식이 올바르지 않습니다.', 'INVALID_DUE_DATE');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) taskError('날짜는 YYYY-MM-DD 형식이어야 합니다.', 'INVALID_DUE_DATE');
  const [year, month, day] = match.slice(1).map(Number);
  if (!isValidDateParts(year, month, day)) taskError('실제 달력에 존재하지 않는 날짜입니다.', 'INVALID_DUE_DATE');
  return { value, year, month, day };
}

function localKstEpoch({ year, month, day, hour = 0, minute = 0, second = 0 }) {
  return Math.floor(Date.UTC(year, month - 1, day, hour - 9, minute, second) / 1000);
}

function parseKstDateTime(value, field = '시각') {
  if (typeof value !== 'string') taskError(`${field} 형식이 올바르지 않습니다.`, 'INVALID_DATETIME');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\+09:00$/.exec(value);
  if (!match) {
    taskError(`${field}은 YYYY-MM-DDTHH:mm:ss+09:00 형식이어야 합니다.`, 'INVALID_DATETIME');
  }
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  if (
    !isValidDateParts(year, month, day) ||
    hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59
  ) {
    taskError(`${field}이 실제 KST 달력 시각이 아닙니다.`, 'INVALID_DATETIME');
  }
  return { value, year, month, day, hour, minute, second, epoch: localKstEpoch({ year, month, day, hour, minute, second }) };
}

function kstParts(epoch) {
  const date = new Date((epoch + KST_OFFSET_SECONDS) * 1000);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

function kstDate(epoch) {
  const parts = kstParts(epoch);
  return formatDateParts(parts.year, parts.month, parts.day);
}

function latestAllowed(now) {
  const parts = kstParts(now);
  const year = parts.year + 10;
  const day = Math.min(parts.day, daysInMonth(year, parts.month));
  return {
    date: formatDateParts(year, parts.month, day),
    epoch: localKstEpoch({ ...parts, year, day }),
  };
}

function validateDue(due, now, checkRange = true) {
  const input = due === undefined || due === null ? { kind: 'none' } : due;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    taskError('due 형식이 올바르지 않습니다.', 'INVALID_DUE');
  }
  if (input.kind === 'none') return { dueKind: 'none', dueDate: null, dueAt: null };
  const latest = latestAllowed(now);
  if (input.kind === 'date') {
    const parsed = parseKstDate(input.date);
    const today = kstDate(now);
    if (checkRange && parsed.value < today) taskError('새 기한은 과거 날짜일 수 없습니다.', 'DUE_IN_PAST');
    if (checkRange && parsed.value > latest.date) taskError('새 기한은 10년 이내여야 합니다.', 'DUE_TOO_FAR');
    return { dueKind: 'date', dueDate: parsed.value, dueAt: null };
  }
  if (input.kind === 'datetime') {
    const parsed = parseKstDateTime(input.at, '기한');
    if (checkRange && parsed.epoch < now) taskError('새 기한은 과거 시각일 수 없습니다.', 'DUE_IN_PAST');
    if (checkRange && parsed.epoch > latest.epoch) taskError('새 기한은 10년 이내여야 합니다.', 'DUE_TOO_FAR');
    return { dueKind: 'datetime', dueDate: null, dueAt: parsed.epoch };
  }
  taskError('due.kind는 none, date, datetime 중 하나여야 합니다.', 'INVALID_DUE');
}

function validateReminderAt(value, now, checkRange = true) {
  if (value === undefined || value === null) return null;
  const parsed = parseKstDateTime(value, '알림 시각');
  if (checkRange && parsed.epoch < now + 60) taskError('새 알림은 현재보다 60초 이후여야 합니다.', 'REMINDER_TOO_SOON');
  if (checkRange && parsed.epoch > latestAllowed(now).epoch) taskError('새 알림은 10년 이내여야 합니다.', 'REMINDER_TOO_FAR');
  return parsed.epoch;
}

function canonicalCreatePayload({ title, detail, dueKind, dueDate, dueAt, reminderAt }) {
  return JSON.stringify({ title, detail, dueKind, dueDate, dueAt, reminderAt });
}

function hashPayload(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeCreateInput(input, now, checkRange = true) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    taskError('task 요청 본문이 올바르지 않습니다.', 'INVALID_TASK_INPUT');
  }
  const clientRequestId = validateRequestKey(input.clientRequestId);
  const title = normalizeText(input.title, '제목', 200, { required: true });
  const detail = input.detail === undefined ? '' : normalizeText(input.detail, '설명', 2000);
  const due = validateDue(input.due, now, checkRange);
  const reminderAt = validateReminderAt(input.reminderAt, now, checkRange);
  const payload = { title, detail, ...due, reminderAt };
  return {
    clientRequestId,
    ...payload,
    createPayloadSha256: hashPayload(canonicalCreatePayload(payload)),
  };
}

function normalizePatchInput(input, now) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    taskError('수정 요청 본문이 올바르지 않습니다.', 'INVALID_TASK_INPUT');
  }
  const normalized = { expectedVersion: validateExpectedVersion(input.expectedVersion) };
  if (Object.prototype.hasOwnProperty.call(input, 'title')) {
    normalized.title = normalizeText(input.title, '제목', 200, { required: true });
  }
  if (Object.prototype.hasOwnProperty.call(input, 'detail')) {
    normalized.detail = normalizeText(input.detail, '설명', 2000);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'due')) normalized.due = validateDue(input.due, now);

  const change = input.reminderChange;
  if (change === undefined) {
    normalized.reminderChange = { action: 'keep' };
  } else if (!change || typeof change !== 'object' || Array.isArray(change)) {
    taskError('reminderChange 형식이 올바르지 않습니다.', 'INVALID_REMINDER_CHANGE');
  } else if (change.action === 'keep' || change.action === 'remove') {
    normalized.reminderChange = { action: change.action };
  } else if (change.action === 'replace') {
    normalized.reminderChange = { action: 'replace', remindAt: validateReminderAt(change.at, now) };
    if (normalized.reminderChange.remindAt === null) {
      taskError('교체할 알림 시각이 필요합니다.', 'INVALID_REMINDER_CHANGE');
    }
  } else {
    taskError('reminderChange.action은 keep, replace, remove 중 하나여야 합니다.', 'INVALID_REMINDER_CHANGE');
  }
  return normalized;
}

function occurrenceKey(taskId, reminderVersion, remindAt) {
  return `task:${taskId}:v${reminderVersion}:${remindAt}`;
}

function snoozeOccurrenceKey(taskId, parentId, requestKey) {
  const digest = crypto.createHash('sha256').update(requestKey, 'utf8').digest('hex');
  return `task:${taskId}:snooze:${parentId}:${digest}`;
}

function taskDueEpoch(task) {
  if (task.dueKind === 'datetime') return task.dueAt;
  if (task.dueKind === 'date') {
    const { year, month, day } = parseKstDate(task.dueDate);
    return localKstEpoch({ year, month, day });
  }
  return Number.POSITIVE_INFINITY;
}

function compareDueTasks(a, b) {
  const dueDelta = taskDueEpoch(a) - taskDueEpoch(b);
  if (dueDelta !== 0) return dueDelta;
  if (a.dueKind !== b.dueKind) return a.dueKind === 'datetime' ? -1 : 1;
  return a.id - b.id;
}

function comparePreviewTasks(a, b) {
  const aDate = a.dueKind === 'date' ? a.dueDate : kstDate(a.dueAt);
  const bDate = b.dueKind === 'date' ? b.dueDate : kstDate(b.dueAt);
  if (aDate !== bDate) return aDate.localeCompare(bDate);
  if (a.dueKind !== b.dueKind) return a.dueKind === 'datetime' ? -1 : 1;
  if (a.dueKind === 'datetime' && a.dueAt !== b.dueAt) return a.dueAt - b.dueAt;
  return a.id - b.id;
}

function bucketForTask(task, now, today, tomorrowEpoch) {
  if (task.dueKind === 'none') return 'inbox';
  if (task.dueKind === 'date') {
    if (task.dueDate < today) return 'overdue';
    if (task.dueDate === today) return 'today';
    return 'upcoming';
  }
  if (task.dueAt < now) return 'overdue';
  if (task.dueAt < tomorrowEpoch) return 'today';
  return 'upcoming';
}

function createAssistantTaskStore(db, options = {}) {
  if (!db?.prepare || typeof db.transaction !== 'function') {
    throw new TypeError('SQLite DB 연결이 필요합니다.');
  }
  const clock = typeof options.now === 'function' ? options.now : () => Math.floor(Date.now() / 1000);
  const onTaskInactive = typeof options.onTaskInactive === 'function'
    ? options.onTaskInactive
    : () => {};
  const onReminderResolved = typeof options.onReminderResolved === 'function'
    ? options.onReminderResolved
    : () => {};
  const onTaskChanged = typeof options.onTaskChanged === 'function'
    ? options.onTaskChanged
    : () => {};
  const captureNow = () => {
    const value = clock();
    if (!Number.isFinite(value)) throw new TypeError('테스트 시계가 올바르지 않습니다.');
    return Math.floor(value);
  };

  const getTaskById = db.prepare(`SELECT ${TASK_COLUMNS} FROM assistant_tasks WHERE id = ? LIMIT 1`);
  const getTaskByRequestId = db.prepare(`SELECT ${TASK_COLUMNS} FROM assistant_tasks WHERE client_request_id = ? LIMIT 1`);
  const getTasksByLifecycle = db.prepare(`SELECT ${TASK_COLUMNS} FROM assistant_tasks WHERE lifecycle = ?`);
  const getLiveReminder = db.prepare(`
    SELECT ${REMINDER_COLUMNS}
    FROM assistant_reminders
    WHERE task_id = ? AND status IN ('pending', 'fired')
    ORDER BY id ASC
    LIMIT 1
  `);
  const getReminderById = db.prepare(`SELECT ${REMINDER_COLUMNS} FROM assistant_reminders WHERE id = ? LIMIT 1`);
  const getSnoozeChild = db.prepare(`
    SELECT ${REMINDER_COLUMNS}
    FROM assistant_reminders
    WHERE snoozed_from_id = ? AND snooze_request_key = ?
    LIMIT 1
  `);
  const getReminderBySnoozeKey = db.prepare(`
    SELECT ${REMINDER_COLUMNS}
    FROM assistant_reminders
    WHERE snooze_request_key = ?
    LIMIT 1
  `);
  const insertTask = db.prepare(`
    INSERT INTO assistant_tasks (
      client_request_id, create_payload_sha256, title, detail,
      due_kind, due_date, due_at, created_at, updated_at
    ) VALUES (
      @clientRequestId, @createPayloadSha256, @title, @detail,
      @dueKind, @dueDate, @dueAt, @now, @now
    )
  `);
  const writeTask = db.prepare(`
    UPDATE assistant_tasks
    SET title = @title,
        detail = @detail,
        status = @status,
        lifecycle = @lifecycle,
        deleted_from_lifecycle = @deletedFromLifecycle,
        due_kind = @dueKind,
        due_date = @dueDate,
        due_at = @dueAt,
        reminder_version = @reminderVersion,
        version = @version,
        updated_at = @updatedAt,
        completed_at = @completedAt,
        cancelled_at = @cancelledAt,
        closed_at = @closedAt,
        deleted_at = @deletedAt
    WHERE id = @id AND version = @expectedVersion
  `);
  const insertEvent = db.prepare(`
    INSERT INTO assistant_task_events (
      task_id, event_type, from_status, to_status,
      from_lifecycle, to_lifecycle, task_version, actor_type, occurred_at
    ) VALUES (
      @taskId, @eventType, @fromStatus, @toStatus,
      @fromLifecycle, @toLifecycle, @taskVersion, @actorType, @occurredAt
    )
  `);
  const insertReminder = db.prepare(`
    INSERT INTO assistant_reminders (
      task_id, remind_at, occurrence_key, snoozed_from_id,
      snooze_request_key, created_at, updated_at
    ) VALUES (
      @taskId, @remindAt, @occurrenceKey, @snoozedFromId,
      @snoozeRequestKey, @now, @now
    )
  `);
  const cancelLiveReminders = db.prepare(`
    UPDATE assistant_reminders
    SET status = 'cancelled', cancellation_reason = @reason,
        cancelled_at = @now, updated_at = @now
    WHERE task_id = @taskId AND status IN ('pending', 'fired')
  `);
  const completePendingReminders = db.prepare(`
    UPDATE assistant_reminders
    SET status = 'cancelled', cancellation_reason = 'task_completed',
        cancelled_at = @now, updated_at = @now
    WHERE task_id = @taskId AND status = 'pending'
  `);
  const completeFiredReminders = db.prepare(`
    UPDATE assistant_reminders
    SET status = 'acknowledged', acknowledged_at = @now,
        acknowledgement_action = 'completed', updated_at = @now
    WHERE task_id = @taskId AND status = 'fired'
  `);
  const acknowledgeReminder = db.prepare(`
    UPDATE assistant_reminders
    SET status = 'acknowledged', acknowledged_at = @now,
        acknowledgement_action = @action, updated_at = @now
    WHERE id = @id AND status = 'fired'
  `);
  const getNextPendingReminder = db.prepare(`
    SELECT r.id AS reminderId, r.task_id AS taskId, t.title, r.remind_at AS remindAt
    FROM assistant_reminders r
    JOIN assistant_tasks t ON t.id = r.task_id
    WHERE r.status = 'pending' AND r.remind_at > ?
      AND t.status = 'active' AND t.lifecycle = 'active'
    ORDER BY r.remind_at ASC, r.id ASC
    LIMIT 1
  `);
  const getFiredNotifications = db.prepare(`
    SELECT r.id AS reminderId, r.task_id AS taskId, t.version AS taskVersion,
           t.title, r.remind_at AS remindAt, r.fired_at AS firedAt
    FROM assistant_reminders r
    JOIN assistant_tasks t ON t.id = r.task_id
    WHERE r.status = 'fired'
      AND t.status = 'active'
      AND t.lifecycle = 'active'
    ORDER BY r.fired_at DESC, r.id ASC
    LIMIT ?
  `);

  function currentResult(task, extra = {}) {
    return { task, reminder: getLiveReminder.get(task.id) || null, ...extra };
  }

  function withLiveReminder(task) {
    return { ...task, reminder: getLiveReminder.get(task.id) || null };
  }

  function requireTask(id) {
    const task = getTaskById.get(id);
    if (!task) taskError('일정을 찾을 수 없습니다.', 'TASK_NOT_FOUND', 404);
    return task;
  }

  function writeCurrentTask(current, next, eventType, now) {
    const values = {
      ...current,
      ...next,
      id: current.id,
      expectedVersion: current.version,
      version: current.version + 1,
      updatedAt: now,
    };
    const result = writeTask.run(values);
    if (result.changes !== 1) {
      const latest = getTaskById.get(current.id) || null;
      taskError('다른 변경이 먼저 적용됐습니다.', 'TASK_VERSION_CONFLICT', 409, latest);
    }
    insertEvent.run({
      taskId: current.id,
      eventType,
      fromStatus: current.status,
      toStatus: values.status,
      fromLifecycle: current.lifecycle,
      toLifecycle: values.lifecycle,
      taskVersion: values.version,
      actorType: 'user',
      occurredAt: now,
    });
    const updated = getTaskById.get(current.id);
    onTaskChanged(current, updated, eventType, now);
    return updated;
  }

  const createTransaction = db.transaction((normalized, now) => {
    const existing = getTaskByRequestId.get(normalized.clientRequestId);
    if (existing) {
      if (existing.createPayloadSha256 !== normalized.createPayloadSha256) {
        taskError('같은 clientRequestId가 다른 일정 생성 요청에 이미 사용됐습니다.', 'TASK_CREATE_CONFLICT', 409, existing);
      }
      return currentResult(existing, { replayed: true });
    }

    const inserted = insertTask.run({ ...normalized, now });
    const taskId = Number(inserted.lastInsertRowid);
    insertEvent.run({
      taskId,
      eventType: 'created',
      fromStatus: null,
      toStatus: 'active',
      fromLifecycle: null,
      toLifecycle: 'active',
      taskVersion: 1,
      actorType: 'user',
      occurredAt: now,
    });
    if (normalized.reminderAt !== null) {
      insertReminder.run({
        taskId,
        remindAt: normalized.reminderAt,
        occurrenceKey: occurrenceKey(taskId, 1, normalized.reminderAt),
        snoozedFromId: null,
        snoozeRequestKey: null,
        now,
      });
    }
    return currentResult(getTaskById.get(taskId), { replayed: false });
  });

  const updateTransaction = db.transaction((id, patch, now) => {
    const current = requireTask(id);
    if (current.lifecycle !== 'active' || current.status !== 'active') {
      taskError('종결되거나 삭제된 일정은 수정할 수 없습니다.', 'TASK_NOT_EDITABLE', 409, current);
    }
    if (current.version !== patch.expectedVersion) {
      taskError('다른 변경이 먼저 적용됐습니다.', 'TASK_VERSION_CONFLICT', 409, current);
    }

    const next = {
      title: patch.title ?? current.title,
      detail: patch.detail ?? current.detail,
      dueKind: patch.due?.dueKind ?? current.dueKind,
      dueDate: patch.due === undefined ? current.dueDate : patch.due.dueDate,
      dueAt: patch.due === undefined ? current.dueAt : patch.due.dueAt,
    };
    const taskFieldsChanged = (
      next.title !== current.title || next.detail !== current.detail ||
      next.dueKind !== current.dueKind || next.dueDate !== current.dueDate || next.dueAt !== current.dueAt
    );
    const live = getLiveReminder.get(id) || null;
    const reminderAction = patch.reminderChange.action;
    const reminderChanged = reminderAction === 'replace' || (reminderAction === 'remove' && live !== null);

    if (!taskFieldsChanged && !reminderChanged) return currentResult(current, { unchanged: true });

    const reminderVersion = current.reminderVersion + (reminderChanged ? 1 : 0);
    if (reminderChanged && live) {
      cancelLiveReminders.run({
        taskId: id,
        reason: reminderAction === 'replace' ? 'replaced' : 'removed',
        now,
      });
      onReminderResolved(live.id, now);
    }
    const updated = writeCurrentTask(current, { ...next, reminderVersion }, 'updated', now);
    if (reminderAction === 'replace') {
      insertReminder.run({
        taskId: id,
        remindAt: patch.reminderChange.remindAt,
        occurrenceKey: occurrenceKey(id, reminderVersion, patch.reminderChange.remindAt),
        snoozedFromId: null,
        snoozeRequestKey: null,
        now,
      });
    }
    return currentResult(updated, { unchanged: false });
  });

  const transitionTransaction = db.transaction((id, action, expectedVersion, now) => {
    const current = requireTask(id);
    const alreadyTarget = (
      (action === 'complete' && current.status === 'done' && current.lifecycle === 'closed') ||
      (action === 'cancel' && current.status === 'cancelled' && current.lifecycle === 'closed') ||
      (action === 'reopen' && current.status === 'active' && current.lifecycle === 'active') ||
      (action === 'delete' && current.lifecycle === 'deleted') ||
      (action === 'restore' && current.lifecycle !== 'deleted')
    );
    if (alreadyTarget) return currentResult(current, { unchanged: true });
    if (current.version !== expectedVersion) {
      taskError('다른 변경이 먼저 적용됐습니다.', 'TASK_VERSION_CONFLICT', 409, current);
    }

    let next;
    let eventType;
    if (action === 'complete' || action === 'cancel') {
      if (current.status !== 'active' || current.lifecycle !== 'active') {
        taskError('활성 일정만 완료하거나 취소할 수 있습니다.', 'INVALID_TASK_TRANSITION', 409, current);
      }
      const completed = action === 'complete';
      next = {
        status: completed ? 'done' : 'cancelled',
        lifecycle: 'closed',
        completedAt: completed ? now : null,
        cancelledAt: completed ? null : now,
        closedAt: now,
      };
      eventType = completed ? 'completed' : 'cancelled';
      if (completed) {
        completePendingReminders.run({ taskId: id, now });
        completeFiredReminders.run({ taskId: id, now });
      } else {
        cancelLiveReminders.run({ taskId: id, reason: 'task_cancelled', now });
      }
      onTaskInactive(id, now);
    } else if (action === 'reopen') {
      if (current.lifecycle !== 'closed' || !['done', 'cancelled'].includes(current.status)) {
        taskError('종결된 일정만 다시 열 수 있습니다.', 'INVALID_TASK_TRANSITION', 409, current);
      }
      next = {
        status: 'active', lifecycle: 'active', completedAt: null,
        cancelledAt: null, closedAt: null,
      };
      eventType = 'reopened';
    } else if (action === 'delete') {
      if (!['active', 'closed'].includes(current.lifecycle)) {
        taskError('삭제할 수 없는 일정 상태입니다.', 'INVALID_TASK_TRANSITION', 409, current);
      }
      next = {
        lifecycle: 'deleted', deletedFromLifecycle: current.lifecycle, deletedAt: now,
      };
      eventType = 'deleted';
      cancelLiveReminders.run({ taskId: id, reason: 'task_deleted', now });
      onTaskInactive(id, now);
    } else if (action === 'restore') {
      if (current.lifecycle !== 'deleted' || !['active', 'closed'].includes(current.deletedFromLifecycle)) {
        taskError('복원할 수 없는 일정 상태입니다.', 'INVALID_TASK_TRANSITION', 409, current);
      }
      next = {
        lifecycle: current.deletedFromLifecycle,
        deletedFromLifecycle: null,
        deletedAt: null,
      };
      eventType = 'restored';
    } else {
      taskError('지원하지 않는 일정 상태 전이입니다.', 'INVALID_TASK_TRANSITION');
    }

    return currentResult(writeCurrentTask(current, next, eventType, now), { unchanged: false });
  });

  const acknowledgeTransaction = db.transaction((id, now) => {
    const reminder = getReminderById.get(id);
    if (!reminder) taskError('알림을 찾을 수 없습니다.', 'REMINDER_NOT_FOUND', 404);
    if (reminder.status === 'acknowledged' && reminder.acknowledgementAction === 'seen') {
      return { reminder, unchanged: true };
    }
    if (reminder.status !== 'fired') {
      taskError('발화된 알림만 확인할 수 있습니다.', 'REMINDER_NOT_ACKNOWLEDGEABLE', 409);
    }
    const result = acknowledgeReminder.run({ id, action: 'seen', now });
    if (result.changes !== 1) taskError('알림 상태가 먼저 변경됐습니다.', 'REMINDER_STATE_CONFLICT', 409);
    onReminderResolved(id, now);
    return { reminder: getReminderById.get(id), unchanged: false };
  });

  const snoozeTransaction = db.transaction((id, requestKey, now) => {
    const existing = getSnoozeChild.get(id, requestKey);
    if (existing) return { reminder: existing, replayed: true };
    const keyOwner = getReminderBySnoozeKey.get(requestKey);
    if (keyOwner) taskError('같은 requestKey가 다른 알림에 이미 사용됐습니다.', 'SNOOZE_REQUEST_CONFLICT', 409);

    const parent = getReminderById.get(id);
    if (!parent) taskError('알림을 찾을 수 없습니다.', 'REMINDER_NOT_FOUND', 404);
    const task = requireTask(parent.taskId);
    if (task.status !== 'active' || task.lifecycle !== 'active') {
      taskError('활성 일정의 발화된 알림만 미룰 수 있습니다.', 'REMINDER_NOT_SNOOZABLE', 409, task);
    }
    if (parent.status !== 'fired') {
      taskError('발화된 알림만 미룰 수 있습니다.', 'REMINDER_NOT_SNOOZABLE', 409, task);
    }
    const acknowledged = acknowledgeReminder.run({ id, action: 'snoozed', now });
    if (acknowledged.changes !== 1) taskError('알림 상태가 먼저 변경됐습니다.', 'REMINDER_STATE_CONFLICT', 409);
    onReminderResolved(id, now);
    const remindAt = now + 60 * 60;
    const inserted = insertReminder.run({
      taskId: parent.taskId,
      remindAt,
      occurrenceKey: snoozeOccurrenceKey(parent.taskId, id, requestKey),
      snoozedFromId: id,
      snoozeRequestKey: requestKey,
      now,
    });
    return { reminder: getReminderById.get(Number(inserted.lastInsertRowid)), replayed: false };
  });

  return {
    create(input) {
      const now = captureNow();
      const existing = input && typeof input === 'object' && !Array.isArray(input) &&
        typeof input.clientRequestId === 'string'
        ? getTaskByRequestId.get(input.clientRequestId)
        : null;
      return createTransaction(normalizeCreateInput(input, now, !existing), now);
    },

    update(idValue, input) {
      const id = validateId(idValue, '일정');
      const now = captureNow();
      return updateTransaction(id, normalizePatchInput(input, now), now);
    },

    transition(idValue, action, input) {
      const id = validateId(idValue, '일정');
      const expectedVersion = validateExpectedVersion(input?.expectedVersion);
      return transitionTransaction(id, action, expectedVersion, captureNow());
    },

    list(options = {}) {
      const now = captureNow();
      const view = options.view || 'today';
      if (!['today', 'upcoming', 'inbox', 'all', 'history', 'trash'].includes(view)) {
        taskError('지원하지 않는 일정 목록 view입니다.', 'INVALID_TASK_VIEW');
      }
      const limit = options.limit === undefined ? 100 : Number(options.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        taskError('limit은 1부터 100 사이의 정수여야 합니다.', 'INVALID_TASK_LIMIT');
      }
      if (view !== 'history' && options.status !== undefined) {
        taskError('status 필터는 history view에서만 사용할 수 있습니다.', 'INVALID_TASK_STATUS_FILTER');
      }

      if (view === 'history') {
        const status = options.status || 'all';
        if (!['done', 'cancelled', 'all'].includes(status)) {
          taskError('history status가 올바르지 않습니다.', 'INVALID_TASK_STATUS_FILTER');
        }
        const tasks = getTasksByLifecycle.all('closed')
          .filter(task => status === 'all' || task.status === status)
          .sort((a, b) => b.closedAt - a.closedAt || b.id - a.id)
          .slice(0, limit)
          .map(withLiveReminder);
        return { capturedAt: now, timezone: KST_TIMEZONE, view, tasks };
      }
      if (view === 'trash') {
        const tasks = getTasksByLifecycle.all('deleted')
          .sort((a, b) => b.deletedAt - a.deletedAt || b.id - a.id)
          .slice(0, limit)
          .map(withLiveReminder);
        return { capturedAt: now, timezone: KST_TIMEZONE, view, tasks };
      }

      const today = kstDate(now);
      const parts = kstParts(now);
      const tomorrowEpoch = localKstEpoch({ year: parts.year, month: parts.month, day: parts.day }) + DAY_SECONDS;
      const tasks = getTasksByLifecycle.all('active');
      const bucketed = tasks.map(task => ({ task, bucket: bucketForTask(task, now, today, tomorrowEpoch) }));
      if (view === 'today') {
        const overdue = bucketed.filter(item => item.bucket === 'overdue').map(item => item.task)
          .sort(compareDueTasks).slice(0, limit).map(withLiveReminder);
        const dueToday = bucketed.filter(item => item.bucket === 'today').map(item => item.task)
          .sort(compareDueTasks).slice(0, limit).map(withLiveReminder);
        return { capturedAt: now, timezone: KST_TIMEZONE, view, overdue, today: dueToday };
      }
      if (view === 'upcoming') {
        return {
          capturedAt: now, timezone: KST_TIMEZONE, view,
          tasks: bucketed.filter(item => item.bucket === 'upcoming').map(item => item.task)
            .sort(compareDueTasks).slice(0, limit).map(withLiveReminder),
        };
      }
      if (view === 'inbox') {
        return {
          capturedAt: now, timezone: KST_TIMEZONE, view,
          tasks: bucketed.filter(item => item.bucket === 'inbox').map(item => item.task)
            .sort((a, b) => b.updatedAt - a.updatedAt || b.id - a.id)
            .slice(0, limit).map(withLiveReminder),
        };
      }
      return {
        capturedAt: now, timezone: KST_TIMEZONE, view,
        tasks: tasks.sort((a, b) => {
          if (a.dueKind === 'none' && b.dueKind !== 'none') return 1;
          if (a.dueKind !== 'none' && b.dueKind === 'none') return -1;
          if (a.dueKind === 'none') return b.updatedAt - a.updatedAt || b.id - a.id;
          return compareDueTasks(a, b);
        }).slice(0, limit).map(withLiveReminder),
      };
    },

    summary(options = {}) {
      const now = captureNow();
      const parts = kstParts(now);
      const todayStart = localKstEpoch({ year: parts.year, month: parts.month, day: parts.day });
      const tomorrowEpoch = todayStart + DAY_SECONDS;
      const today = kstDate(now);
      const tasks = getTasksByLifecycle.all('active');
      const bucketed = tasks.map(task => ({ task, bucket: bucketForTask(task, now, today, tomorrowEpoch) }));
      const counts = { overdue: 0, today: 0, upcoming: 0, inbox: 0 };
      bucketed.forEach(item => { counts[item.bucket] += 1; });

      const dayOfWeek = new Date((todayStart + KST_OFFSET_SECONDS) * 1000).getUTCDay();
      const mondayStart = todayStart - ((dayOfWeek + 6) % 7) * DAY_SECONDS;
      let calendarCenterStart = mondayStart;
      if (options.calendarCenter !== undefined) {
        const center = parseKstDate(options.calendarCenter);
        calendarCenterStart = localKstEpoch(center);
        const centerDay = new Date((calendarCenterStart + KST_OFFSET_SECONDS) * 1000).getUTCDay();
        if (centerDay !== 1) {
          taskError('calendarCenter는 월요일이어야 합니다.', 'INVALID_CALENDAR_WEEK');
        }
      }
      const makeWeek = start => ({
        startDate: kstDate(start),
        days: Array.from({ length: 7 }, (_, index) => {
          const date = kstDate(start + index * DAY_SECONDS);
          return {
            date,
            count: tasks.filter(task => (
              task.dueKind === 'date' ? task.dueDate === date :
                task.dueKind === 'datetime' ? kstDate(task.dueAt) === date : false
            )).length,
            isToday: date === today,
          };
        }),
      });
      const calendar = [-1, 0, 1].map(offset => makeWeek(calendarCenterStart + offset * 7 * DAY_SECONDS));
      const week = calendar[1].days;
      const preview = bucketed
        .filter(item => item.bucket === 'overdue' || item.bucket === 'today')
        .sort((a, b) => {
          if (a.bucket !== b.bucket) return a.bucket === 'overdue' ? -1 : 1;
          return comparePreviewTasks(a.task, b.task);
        })
        .slice(0, 3)
        .map(({ task, bucket }) => ({
          taskId: task.id,
          title: task.title,
          bucket,
          dueKind: task.dueKind,
          dueDate: task.dueDate,
          dueAt: task.dueAt,
        }));
      return {
        capturedAt: now,
        timezone: KST_TIMEZONE,
        counts,
        currentWeekStart: kstDate(mondayStart),
        calendarCenter: kstDate(calendarCenterStart),
        calendar,
        week,
        preview,
        nextReminder: getNextPendingReminder.get(now) || null,
      };
    },

    listFiredNotifications(limit = 100) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        taskError('알림 limit은 1부터 100 사이의 정수여야 합니다.', 'INVALID_TASK_LIMIT');
      }
      return getFiredNotifications.all(limit).map(item => ({
        id: `task-reminder:${item.reminderId}`,
        source: 'task',
        type: 'task_reminder',
        ...item,
      }));
    },

    acknowledgeReminder(idValue) {
      return acknowledgeTransaction(validateId(idValue, '알림'), captureNow());
    },

    snoozeReminder(idValue, input) {
      const id = validateId(idValue, '알림');
      if (input?.minutes !== 60) taskError('C1에서는 1시간 미루기만 지원합니다.', 'INVALID_SNOOZE_MINUTES');
      const requestKey = validateRequestKey(input?.requestKey, 'requestKey');
      return snoozeTransaction(id, requestKey, captureNow());
    },

    get(idValue) {
      const task = requireTask(validateId(idValue, '일정'));
      return currentResult(task);
    },
  };
}

module.exports = {
  AssistantTaskError,
  KST_TIMEZONE,
  createAssistantTaskStore,
};
