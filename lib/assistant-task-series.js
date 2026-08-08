'use strict';

const {
  internals: {
    taskError,
    normalizeText,
    validateRequestKey,
    validateExpectedVersion,
    validateId,
    parseKstDate,
    parseKstDateTime,
    kstDate,
    kstDateTime,
    latestAllowed,
    hashPayload,
  },
} = require('./assistant-tasks');
const {
  RECURRENCE_FREQS,
  occurrenceDatesBetween,
  nextOccurrenceDates,
  addDays,
  maxDate,
} = require('./task-recurrence');

const KST_TIMEZONE = 'Asia/Seoul';

// 회차를 미리 만들어 두는 창이다. 달력이 3주를 보여주고 스와이프로 새 중앙 주를
// 다시 조회하므로 60일이면 앞으로 여러 번 넘겨도 채워져 있다. 이 창 밖의 달력에는
// 반복이 비어 보이고, 그것이 가상 회차 확장을 만들지 않는 대가다.
const MATERIALIZE_WINDOW_DAYS = 60;
// 매월 31일처럼 드문 규칙은 60일 안에 회차가 없을 수 있어서 최소 개수를 함께 본다.
const MATERIALIZE_MIN_OCCURRENCES = 4;
// 한 번의 materialize가 만드는 회차 안전 상한. 규칙 넷 중 창을 가장 빽빽하게
// 채우는 매일 반복이 61행(오늘 포함 61일)이라 그 위로 여유를 둔 값이다.
const MATERIALIZE_MAX_ROWS = 70;
// 알림을 기한보다 얼마나 앞당길 수 있는지. 30일을 넘는 값은 기한과 무관한 별도
// 약속이라 반복 시리즈가 대신 잡아주지 않는다.
const MAX_REMINDER_LEAD_SECONDS = 30 * 24 * 60 * 60;

const SERIES_COLUMNS = `
  id,
  client_request_id AS clientRequestId,
  create_payload_sha256 AS createPayloadSha256,
  title,
  detail,
  freq,
  by_weekday AS byWeekday,
  by_monthday AS byMonthday,
  start_date AS startDate,
  end_date AS endDate,
  time_kind AS timeKind,
  time_of_day AS timeOfDay,
  reminder_lead_seconds AS reminderLeadSeconds,
  status,
  timezone,
  version,
  materialized_through AS materializedThrough,
  created_at AS createdAt,
  updated_at AS updatedAt,
  ended_at AS endedAt
`;

function validateFreq(value) {
  if (!RECURRENCE_FREQS.includes(value)) {
    taskError('반복 주기는 daily, weekdays, weekly, monthly 중 하나여야 합니다.', 'INVALID_RECURRENCE_FREQ');
  }
  return value;
}

// ISO 요일을 중복 없이 오름차순으로 고정한다. `3,1,1`과 `1,3`이 다른 시리즈로
// 저장되면 같은 규칙이 서명도 목록 표시도 달라진다.
function validateByWeekday(value) {
  if (!Array.isArray(value) || value.length === 0) {
    taskError('매주 반복에는 요일을 하나 이상 골라야 합니다.', 'INVALID_RECURRENCE_WEEKDAY');
  }
  const days = [...new Set(value)];
  if (!days.every(day => Number.isInteger(day) && day >= 1 && day <= 7)) {
    taskError('요일은 1(월)부터 7(일) 사이의 정수여야 합니다.', 'INVALID_RECURRENCE_WEEKDAY');
  }
  return days.sort((a, b) => a - b);
}

function validateByMonthday(value) {
  if (!Number.isInteger(value) || value < 1 || value > 31) {
    taskError('매월 반복 날짜는 1부터 31 사이의 정수여야 합니다.', 'INVALID_RECURRENCE_MONTHDAY');
  }
  return value;
}

function validateTimeOfDay(value) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}:\d{2}$/.test(value)) {
    taskError('시각은 HH:mm:ss 형식이어야 합니다.', 'INVALID_RECURRENCE_TIME');
  }
  const [hour, minute, second] = value.split(':').map(Number);
  if (hour > 23 || minute > 59 || second > 59) {
    taskError('실제 시각이 아닙니다.', 'INVALID_RECURRENCE_TIME');
  }
  return value;
}

function validateReminderLead(value, timeKind) {
  if (value === undefined || value === null) return null;
  // 날짜만 있는 반복에는 앞당길 기준 시각이 없다. 그 경우 기본 알림 계약이
  // 당일 09:00 KST를 잡아준다.
  if (timeKind !== 'datetime') {
    taskError('알림 앞당김은 시각이 있는 반복에서만 설정할 수 있습니다.', 'INVALID_RECURRENCE_REMINDER');
  }
  if (!Number.isInteger(value) || value < 0 || value > MAX_REMINDER_LEAD_SECONDS) {
    taskError('알림 앞당김은 0초부터 30일 사이여야 합니다.', 'INVALID_RECURRENCE_REMINDER');
  }
  return value;
}

function canonicalSeriesPayload(series) {
  return JSON.stringify({
    title: series.title,
    detail: series.detail,
    freq: series.freq,
    byWeekday: series.byWeekday,
    byMonthday: series.byMonthday,
    startDate: series.startDate,
    endDate: series.endDate,
    timeKind: series.timeKind,
    timeOfDay: series.timeOfDay,
    reminderLeadSeconds: series.reminderLeadSeconds,
  });
}

// 규칙 전체를 한 번에 판정한다. 수정은 현재 규칙 위에 바뀐 필드만 얹은 뒤
// 그 결과를 통째로 다시 검증하므로, 주기만 바꾸고 필요한 필드를 빠뜨린 요청이
// 조용히 통과하지 않는다.
function normalizeRule(rule, now, { checkStartDate = true } = {}) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    taskError('recurrence 형식이 올바르지 않습니다.', 'INVALID_RECURRENCE');
  }
  const freq = validateFreq(rule.freq);
  const byWeekday = freq === 'weekly' ? validateByWeekday(rule.byWeekday) : null;
  const byMonthday = freq === 'monthly' ? validateByMonthday(rule.byMonthday) : null;

  const today = kstDate(now);
  const latest = latestAllowed(now);
  const startDate = parseKstDate(rule.startDate).value;
  // 이미 돌고 있는 시리즈의 anchor는 과거에 있는 것이 정상이다. 그래서 시작일
  // 범위는 사용자가 이번 요청에서 직접 준 경우에만 본다.
  if (checkStartDate && startDate < today) {
    taskError('반복 시작일은 과거일 수 없습니다.', 'RECURRENCE_START_IN_PAST');
  }
  if (startDate > latest.date) taskError('반복 시작일은 10년 이내여야 합니다.', 'RECURRENCE_START_TOO_FAR');

  let endDate = null;
  if (rule.endDate !== undefined && rule.endDate !== null) {
    endDate = parseKstDate(rule.endDate).value;
    if (endDate < startDate) taskError('반복 종료일은 시작일보다 빠를 수 없습니다.', 'INVALID_RECURRENCE_END');
    if (endDate > latest.date) taskError('반복 종료일은 10년 이내여야 합니다.', 'RECURRENCE_END_TOO_FAR');
  }

  const timeKind = rule.timeKind === undefined ? 'date' : rule.timeKind;
  if (!['date', 'datetime'].includes(timeKind)) {
    taskError('recurrence.timeKind는 date 또는 datetime이어야 합니다.', 'INVALID_RECURRENCE_TIME_KIND');
  }
  const timeOfDay = timeKind === 'datetime' ? validateTimeOfDay(rule.timeOfDay) : null;
  if (timeKind === 'date' && rule.timeOfDay !== undefined && rule.timeOfDay !== null) {
    taskError('날짜만 반복하는 일정에는 시각을 둘 수 없습니다.', 'INVALID_RECURRENCE_TIME');
  }
  const reminderLeadSeconds = validateReminderLead(rule.reminderLeadSeconds, timeKind);

  return { freq, byWeekday, byMonthday, startDate, endDate, timeKind, timeOfDay, reminderLeadSeconds };
}

function normalizeCreateInput(input, now) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    taskError('반복 일정 요청 본문이 올바르지 않습니다.', 'INVALID_SERIES_INPUT');
  }
  const payload = {
    title: normalizeText(input.title, '제목', 200, { required: true }),
    detail: input.detail === undefined ? '' : normalizeText(input.detail, '설명', 2000),
    ...normalizeRule(input.recurrence, now),
  };
  return {
    clientRequestId: validateRequestKey(input.clientRequestId),
    ...payload,
    createPayloadSha256: hashPayload(canonicalSeriesPayload(payload)),
  };
}

function normalizePatchInput(input, current, now) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    taskError('반복 일정 수정 요청 본문이 올바르지 않습니다.', 'INVALID_SERIES_INPUT');
  }
  const next = { expectedVersion: validateExpectedVersion(input.expectedVersion) };
  if (Object.prototype.hasOwnProperty.call(input, 'title')) {
    next.title = normalizeText(input.title, '제목', 200, { required: true });
  }
  if (Object.prototype.hasOwnProperty.call(input, 'detail')) {
    next.detail = normalizeText(input.detail, '설명', 2000);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'recurrence')) {
    const patch = input.recurrence;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      taskError('recurrence 형식이 올바르지 않습니다.', 'INVALID_RECURRENCE');
    }
    // 현재 규칙 위에 준 필드만 얹는다. 주기가 바뀌면 그 주기가 쓰지 않는 열은
    // 함께 비워야 아래 검증이 옛 주기의 값을 남겨두지 않는다.
    const merged = {
      freq: patch.freq ?? current.freq,
      byWeekday: current.byWeekday === null ? null : current.byWeekday.split(',').map(Number),
      byMonthday: current.byMonthday,
      startDate: current.startDate,
      endDate: current.endDate,
      timeKind: current.timeKind,
      timeOfDay: current.timeOfDay,
      reminderLeadSeconds: current.reminderLeadSeconds,
      ...patch,
    };
    if (merged.freq !== current.freq) {
      if (!Object.prototype.hasOwnProperty.call(patch, 'byWeekday')) merged.byWeekday = undefined;
      if (!Object.prototype.hasOwnProperty.call(patch, 'byMonthday')) merged.byMonthday = undefined;
    }
    if (merged.timeKind === 'date' && !Object.prototype.hasOwnProperty.call(patch, 'timeOfDay')) {
      merged.timeOfDay = undefined;
      if (!Object.prototype.hasOwnProperty.call(patch, 'reminderLeadSeconds')) {
        merged.reminderLeadSeconds = undefined;
      }
    }
    next.recurrence = normalizeRule(merged, now, {
      checkStartDate: Object.prototype.hasOwnProperty.call(patch, 'startDate'),
    });
  }
  return next;
}

function toRule(series) {
  return {
    freq: series.freq,
    byWeekday: typeof series.byWeekday === 'string'
      ? series.byWeekday.split(',').map(Number)
      : series.byWeekday,
    byMonthday: series.byMonthday,
    startDate: series.startDate,
    endDate: series.endDate,
  };
}

function createAssistantTaskSeriesStore(db, options = {}) {
  if (!db?.prepare || typeof db.transaction !== 'function') {
    throw new TypeError('SQLite DB 연결이 필요합니다.');
  }
  const taskStore = options.taskStore;
  if (typeof taskStore?.create !== 'function') {
    throw new TypeError('회차를 만들 일정 저장소가 필요합니다.');
  }
  const clock = typeof options.now === 'function' ? options.now : () => Math.floor(Date.now() / 1000);
  const captureNow = () => {
    const value = clock();
    if (!Number.isFinite(value)) throw new TypeError('테스트 시계가 올바르지 않습니다.');
    return Math.floor(value);
  };

  const getSeriesById = db.prepare(`SELECT ${SERIES_COLUMNS} FROM assistant_task_series WHERE id = ? LIMIT 1`);
  const getSeriesByRequestId = db.prepare(`
    SELECT ${SERIES_COLUMNS} FROM assistant_task_series WHERE client_request_id = ? LIMIT 1
  `);
  const getSeriesByStatus = db.prepare(`SELECT ${SERIES_COLUMNS} FROM assistant_task_series WHERE status = ?`);
  const insertSeries = db.prepare(`
    INSERT INTO assistant_task_series (
      client_request_id, create_payload_sha256, title, detail,
      freq, by_weekday, by_monthday, start_date, end_date,
      time_kind, time_of_day, reminder_lead_seconds, created_at, updated_at
    ) VALUES (
      @clientRequestId, @createPayloadSha256, @title, @detail,
      @freq, @byWeekday, @byMonthday, @startDate, @endDate,
      @timeKind, @timeOfDay, @reminderLeadSeconds, @now, @now
    )
  `);
  const setMaterializedThrough = db.prepare(`
    UPDATE assistant_task_series
    SET materialized_through = @through, updated_at = @now
    WHERE id = @id
  `);
  const writeSeries = db.prepare(`
    UPDATE assistant_task_series
    SET title = @title,
        detail = @detail,
        freq = @freq,
        by_weekday = @byWeekday,
        by_monthday = @byMonthday,
        start_date = @startDate,
        end_date = @endDate,
        time_kind = @timeKind,
        time_of_day = @timeOfDay,
        reminder_lead_seconds = @reminderLeadSeconds,
        status = @status,
        version = @version,
        materialized_through = @materializedThrough,
        updated_at = @now,
        ended_at = @endedAt
    WHERE id = @id AND version = @expectedVersion
  `);

  // 규칙에서 파생됐을 뿐 사용자가 손댄 적 없는 미래 회차다. 사용자가 건너뛰거나
  // 완료하거나 고친 회차는 status나 overridden이 달라서 여기에 걸리지 않는다.
  //
  // 취소가 아니라 물리 삭제인 이유는 두 가지다. `series:{id}:{날짜}`가 이미 쓰인
  // ID로 남으면 같은 날짜에 새 규칙의 회차를 만들 수 없어 규칙 변경이 시리즈의
  // 회차를 통째로 없앤다. 그리고 아무도 본 적 없는 파생 행을 취소로 남기면
  // 월별 노트의 취소 구역이 하지도 않은 일로 가득 찬다.
  const selectRemovableOccurrences = db.prepare(`
    SELECT id
    FROM assistant_tasks
    WHERE series_id = @seriesId
      AND overridden = 0
      AND status = 'active'
      AND lifecycle = 'active'
      AND (
        (due_kind = 'date' AND due_date >= @today) OR
        (due_kind = 'datetime' AND due_at > @now)
      )
      AND NOT EXISTS (
        SELECT 1 FROM assistant_reminders r
        WHERE r.task_id = assistant_tasks.id AND r.status != 'pending'
      )
      AND NOT EXISTS (
        SELECT 1 FROM assistant_push_deliveries d
        JOIN assistant_reminders r ON r.id = d.reminder_id
        WHERE r.task_id = assistant_tasks.id
      )
  `);
  const deleteOccurrenceReminders = db.prepare('DELETE FROM assistant_reminders WHERE task_id = ?');
  const deleteOccurrenceEvents = db.prepare('DELETE FROM assistant_task_events WHERE task_id = ?');
  const deleteOccurrence = db.prepare('DELETE FROM assistant_tasks WHERE id = ?');

  // 놓친 회차 정리 대상. 기한이 이미 지난 활성 회차만 본다.
  const selectPastOccurrences = db.prepare(`
    SELECT t.id, t.series_id AS seriesId, t.occurrence_date AS occurrenceDate, t.version
    FROM assistant_tasks t
    JOIN assistant_task_series s ON s.id = t.series_id
    WHERE t.series_id IS NOT NULL
      AND t.status = 'active'
      AND t.lifecycle = 'active'
      AND (
        (t.due_kind = 'date' AND t.due_date < @today) OR
        (t.due_kind = 'datetime' AND t.due_at < @now)
      )
    ORDER BY t.series_id ASC, t.occurrence_date ASC, t.id ASC
  `);
  const getOccurrenceByDate = db.prepare(`
    SELECT id FROM assistant_tasks WHERE series_id = ? AND occurrence_date = ? LIMIT 1
  `);
  const getOccurrences = db.prepare(`
    SELECT id, occurrence_date AS occurrenceDate, status, lifecycle,
           due_kind AS dueKind, due_date AS dueDate, due_at AS dueAt, overridden
    FROM assistant_tasks
    WHERE series_id = ?
    ORDER BY occurrence_date ASC, id ASC
  `);
  const getPendingWindow = db.prepare(`
    SELECT ${SERIES_COLUMNS}
    FROM assistant_task_series
    WHERE status = 'active'
      AND (materialized_through IS NULL OR materialized_through < ?)
  `);

  // 회차 하나를 기존 일정 생성 경로로 만든다. 검증·이벤트·알림·멱등이 전부
  // 단발 일정과 같은 코드다. `series:{id}:{날짜}`가 client_request_id라서
  // materializer가 몇 번 돌아도 같은 회차가 늘지 않는다.
  function createOccurrence(series, occurrenceDate, now) {
    // 그 날짜에 회차가 이미 있으면 건드리지 않는다. 사용자가 완료했거나 건너뛰었거나
    // 직접 고친 회차가 여기 걸리고, 규칙이 바뀌어도 그 결정이 남는 이유다.
    // 기존 create의 멱등에 기대면 새 규칙의 payload가 달라 409가 난다.
    if (getOccurrenceByDate.get(series.id, occurrenceDate)) return null;

    const due = series.timeKind === 'date'
      ? { kind: 'date', date: occurrenceDate }
      : { kind: 'datetime', at: `${occurrenceDate}T${series.timeOfDay}+09:00` };

    // 이미 지나간 회차는 만들지 않는다. Pi가 며칠 꺼져 있다가 올라와도 지난
    // 날짜의 회차가 새로 생기지 않는다.
    if (series.timeKind === 'date') {
      if (occurrenceDate < kstDate(now)) return null;
    } else if (parseKstDateTime(due.at, '회차 시각').epoch <= now) {
      return null;
    }

    let reminderAt = null;
    if (series.reminderLeadSeconds !== null && series.timeKind === 'datetime') {
      const remindEpoch = parseKstDateTime(due.at, '회차 시각').epoch - series.reminderLeadSeconds;
      // 앞당긴 시각이 이미 코앞이면 그 값으로는 만들 수 없다. 이때는 기본 알림
      // 계약이 대신 잡아주고, 그것도 지났으면 이 회차에는 알림이 없다.
      if (remindEpoch >= now + 60) reminderAt = remindEpoch;
    }

    return taskStore.create({
      clientRequestId: `series:${series.id}:${occurrenceDate}`,
      title: series.title,
      detail: series.detail,
      due,
      reminderAt: reminderAt === null ? null : kstDateTime(reminderAt),
    }, { series: { id: series.id, occurrenceDate } });
  }

  const materializeTransaction = db.transaction((series, now) => {
    const today = kstDate(now);
    const rule = toRule(series);
    const anchorFrom = maxDate(today, series.startDate);
    const horizonEnd = addDays(today, MATERIALIZE_WINDOW_DAYS);

    // 최소 개수는 **오늘 기준** 다음 4회다. 이미 만든 지점에서 세면 부를 때마다
    // 창이 그만큼 더 밀려서 회차가 끝없이 늘어난다. 오늘과 규칙만 보는 값이라야
    // 같은 날 몇 번을 불러도 창 끝이 같다.
    const upcoming = nextOccurrenceDates(rule, anchorFrom, MATERIALIZE_MIN_OCCURRENCES);
    const windowEnd = upcoming.length > 0 ? maxDate(horizonEnd, upcoming.at(-1)) : horizonEnd;
    const from = series.materializedThrough
      ? maxDate(anchorFrom, addDays(series.materializedThrough, 1))
      : anchorFrom;

    const dates = from > windowEnd
      ? []
      : occurrenceDatesBetween(rule, from, windowEnd, { limit: MATERIALIZE_MAX_ROWS });
    const created = [];
    for (const date of dates) {
      const result = createOccurrence(series, date, now);
      if (result && !result.replayed) created.push(result.task);
    }

    // 상한에 걸려 잘렸으면 창 끝까지 만들었다고 기록하면 안 된다. 그러면 잘린
    // 뒤쪽 회차를 영영 다시 보지 않는다.
    const through = dates.length >= MATERIALIZE_MAX_ROWS ? dates.at(-1) : windowEnd;
    if (through !== series.materializedThrough) {
      setMaterializedThrough.run({ id: series.id, through, now });
    }
    return { seriesId: series.id, materializedThrough: through, created };
  });

  const createTransaction = db.transaction((normalized, now) => {
    const existing = getSeriesByRequestId.get(normalized.clientRequestId);
    if (existing) {
      if (existing.createPayloadSha256 !== normalized.createPayloadSha256) {
        taskError('같은 clientRequestId가 다른 반복 일정 요청에 이미 사용됐습니다.', 'SERIES_CREATE_CONFLICT', 409);
      }
      return { series: existing, occurrences: getOccurrences.all(existing.id), replayed: true };
    }
    const inserted = insertSeries.run({
      ...normalized,
      byWeekday: normalized.byWeekday === null ? null : normalized.byWeekday.join(','),
      now,
    });
    const series = getSeriesById.get(Number(inserted.lastInsertRowid));
    materializeTransaction(series, now);
    return {
      series: getSeriesById.get(series.id),
      occurrences: getOccurrences.all(series.id),
      replayed: false,
    };
  });

  function requireSeries(id) {
    const series = getSeriesById.get(id);
    if (!series) taskError('반복 일정을 찾을 수 없습니다.', 'SERIES_NOT_FOUND', 404);
    return series;
  }

  function removeUntouchedOccurrences(seriesId, now) {
    const rows = selectRemovableOccurrences.all({ seriesId, today: kstDate(now), now });
    for (const row of rows) {
      deleteOccurrenceReminders.run(row.id);
      deleteOccurrenceEvents.run(row.id);
      deleteOccurrence.run(row.id);
    }
    return rows.length;
  }

  function writeSeriesRow(current, next, now) {
    const values = {
      ...current, ...next,
      id: current.id,
      expectedVersion: current.version,
      version: current.version + 1,
      now,
    };
    const result = writeSeries.run(values);
    if (result.changes !== 1) {
      taskError('다른 변경이 먼저 적용됐습니다.', 'SERIES_VERSION_CONFLICT', 409);
    }
    return getSeriesById.get(current.id);
  }

  const updateTransaction = db.transaction((id, patch, now) => {
    const current = requireSeries(id);
    if (current.status !== 'active') {
      taskError('종료된 반복 일정은 수정할 수 없습니다.', 'SERIES_NOT_EDITABLE', 409);
    }
    if (current.version !== patch.expectedVersion) {
      taskError('다른 변경이 먼저 적용됐습니다.', 'SERIES_VERSION_CONFLICT', 409);
    }

    const rule = patch.recurrence ?? null;
    const next = {
      title: patch.title ?? current.title,
      detail: patch.detail ?? current.detail,
      freq: rule?.freq ?? current.freq,
      byWeekday: rule ? (rule.byWeekday === null ? null : rule.byWeekday.join(',')) : current.byWeekday,
      byMonthday: rule ? rule.byMonthday : current.byMonthday,
      startDate: rule?.startDate ?? current.startDate,
      endDate: rule ? rule.endDate : current.endDate,
      timeKind: rule?.timeKind ?? current.timeKind,
      timeOfDay: rule ? rule.timeOfDay : current.timeOfDay,
      reminderLeadSeconds: rule ? rule.reminderLeadSeconds : current.reminderLeadSeconds,
    };
    const changed = Object.keys(next).filter(key => next[key] !== current[key]);
    if (changed.length === 0) {
      return { series: current, occurrences: getOccurrences.all(current.id), unchanged: true, removed: 0 };
    }

    // 제목·설명만 바뀌었으면 회차 날짜는 그대로다. 이미 만든 회차의 제목은
    // 지금 고치지 않는다 — 회차마다 사용자가 따로 고쳤을 수 있어서 일괄로
    // 덮어쓰면 그 결정을 지운다. 새로 만드는 회차부터 새 제목을 쓴다.
    const rescheduled = changed.some(key => key !== 'title' && key !== 'detail');
    const removed = rescheduled ? removeUntouchedOccurrences(current.id, now) : 0;
    const updated = writeSeriesRow(current, {
      ...next,
      materializedThrough: rescheduled ? null : current.materializedThrough,
    }, now);
    if (rescheduled) materializeTransaction(updated, now);

    return {
      series: getSeriesById.get(current.id),
      occurrences: getOccurrences.all(current.id),
      unchanged: false,
      removed,
    };
  });

  const endTransaction = db.transaction((id, expectedVersion, now) => {
    const current = requireSeries(id);
    if (current.status === 'ended') {
      return { series: current, occurrences: getOccurrences.all(current.id), unchanged: true, removed: 0 };
    }
    if (current.version !== expectedVersion) {
      taskError('다른 변경이 먼저 적용됐습니다.', 'SERIES_VERSION_CONFLICT', 409);
    }
    const removed = removeUntouchedOccurrences(current.id, now);
    const series = writeSeriesRow(current, { status: 'ended', endedAt: now }, now);
    return { series, occurrences: getOccurrences.all(current.id), unchanged: false, removed };
  });

  // 기한이 지난 회차가 둘 이상 쌓여 있으면 가장 최근 것 하나만 남기고 나머지를
  // 취소한다. Pi가 며칠 꺼져 있어도 사용자에게 보이는 놓친 회차는 늘 하나다.
  //
  // 판정이 "그보다 나중 회차도 이미 지났을 때"라 자연히 한 회차만큼 유예가
  // 생긴다. 어제 회차를 오늘 아침에 완료 표시하는 것은 계속 된다.
  function sweepMissed(nowValue) {
    const now = nowValue === undefined ? captureNow() : Math.floor(nowValue);
    const bySeries = new Map();
    for (const row of selectPastOccurrences.all({ today: kstDate(now), now })) {
      if (!bySeries.has(row.seriesId)) bySeries.set(row.seriesId, []);
      bySeries.get(row.seriesId).push(row);
    }
    const cancelled = [];
    for (const rows of bySeries.values()) {
      for (const row of rows.slice(0, -1)) {
        try {
          taskStore.transition(row.id, 'cancel', { expectedVersion: row.version }, { actorType: 'system' });
          cancelled.push(row.id);
        } catch (error) {
          // 사용자가 같은 순간에 그 회차를 건드렸으면 이번 tick은 건너뛰고
          // 다음 tick에서 다시 본다.
          if (error?.code !== 'SERIES_VERSION_CONFLICT' && error?.code !== 'TASK_VERSION_CONFLICT') throw error;
        }
      }
    }
    return cancelled;
  }

  return {
    create(input) {
      const now = captureNow();
      return createTransaction(normalizeCreateInput(input, now), now);
    },

    get(idValue) {
      const series = requireSeries(validateId(idValue, '반복 일정'));
      return { series, occurrences: getOccurrences.all(series.id) };
    },

    update(idValue, input) {
      const id = validateId(idValue, '반복 일정');
      const now = captureNow();
      return updateTransaction(id, normalizePatchInput(input, requireSeries(id), now), now);
    },

    end(idValue, input) {
      const id = validateId(idValue, '반복 일정');
      return endTransaction(id, validateExpectedVersion(input?.expectedVersion), captureNow());
    },

    sweepMissed,

    list(options = {}) {
      const now = captureNow();
      const status = options.status || 'active';
      if (!['active', 'ended'].includes(status)) {
        taskError('반복 일정 status가 올바르지 않습니다.', 'INVALID_SERIES_STATUS');
      }
      return {
        capturedAt: now,
        timezone: KST_TIMEZONE,
        status,
        series: getSeriesByStatus.all(status).sort((a, b) => b.id - a.id),
      };
    },

    listOccurrences(idValue) {
      return getOccurrences.all(requireSeries(validateId(idValue, '반복 일정')).id);
    },

    materialize(idValue) {
      const now = captureNow();
      return materializeTransaction(requireSeries(validateId(idValue, '반복 일정')), now);
    },

    // scheduler tick이 부르는 자리다. 창이 아직 찬 시리즈는 조회에서 빠지므로
    // 평소 tick에서는 대상이 0건이다.
    materializeDue(nowValue) {
      const now = nowValue === undefined ? captureNow() : Math.floor(nowValue);
      const horizonEnd = addDays(kstDate(now), MATERIALIZE_WINDOW_DAYS);
      return getPendingWindow.all(horizonEnd)
        .map(series => materializeTransaction(series, now))
        .filter(result => result.created.length > 0);
    },
  };
}

module.exports = {
  MATERIALIZE_WINDOW_DAYS,
  MATERIALIZE_MIN_OCCURRENCES,
  MATERIALIZE_MAX_ROWS,
  createAssistantTaskSeriesStore,
};
