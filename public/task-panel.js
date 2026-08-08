'use strict';

(function setupTaskPanel(global) {
  const state = {
    initialized: false,
    enabled: false,
    seriesEnabled: false,
    apiFetch: null,
    showToast: null,
    onChanged: null,
    container: null,
    view: 'today',
    mode: 'list',
    requestId: 0,
    // 음성이 말로 등록·취소할 수 있는, 아직 답을 받지 않은 일정 후보 카드.
    pendingCandidate: null,
  };

  const views = [
    ['today', '오늘'],
    ['upcoming', '예정'],
    ['inbox', 'Inbox'],
    ['series', '반복'],
    ['history', '종결'],
    ['trash', '삭제'],
  ];

  const WEEKDAYS = [[1, '월'], [2, '화'], [3, '수'], [4, '목'], [5, '금'], [6, '토'], [7, '일']];

  const REMINDER_LEADS = [
    ['', '기본'],
    ['300', '5분 전'],
    ['600', '10분 전'],
    ['1800', '30분 전'],
    ['3600', '1시간 전'],
    ['7200', '2시간 전'],
    ['86400', '하루 전'],
  ];

  function weekdayNames(value) {
    return String(value || '').split(',').filter(Boolean)
      .map(day => WEEKDAYS.find(item => item[0] === Number(day))?.[1])
      .filter(Boolean);
  }

  function recurrenceLabel(series) {
    if (!series) return '';
    const time = series.timeKind === 'datetime' && series.timeOfDay
      ? ` ${series.timeOfDay.slice(0, 5)}`
      : '';
    if (series.freq === 'daily') return `매일${time}`;
    if (series.freq === 'weekdays') return `평일${time}`;
    if (series.freq === 'weekly') {
      const days = weekdayNames(series.byWeekday);
      return days.length ? `매주 ${days.join('·')}${time}` : `매주${time}`;
    }
    if (series.freq === 'monthly') return `매월 ${series.byMonthday}일${time}`;
    return '반복';
  }

  function makeRequestKey(prefix) {
    const value = global.crypto?.randomUUID?.()
      || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${value}`;
  }

  function kstDateParts(epochSeconds) {
    const date = new Date((Number(epochSeconds) + 9 * 60 * 60) * 1000);
    return {
      date: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`,
      time: `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`,
    };
  }

  function inputDateTimeEpoch(date, time) {
    const value = `${date}T${time}:00+09:00`;
    const epoch = Math.floor(Date.parse(value) / 1000);
    return Number.isFinite(epoch) ? { value, epoch } : null;
  }

  function todayKst() {
    return kstDateParts(Math.floor(Date.now() / 1000)).date;
  }

  function latestAllowed(now) {
    const current = kstDateParts(now);
    const [year, month, day] = current.date.split('-').map(Number);
    const latestYear = year + 10;
    const lastDay = new Date(Date.UTC(latestYear, month, 0)).getUTCDate();
    const date = `${latestYear}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
    const time = current.time;
    return { date, epoch: inputDateTimeEpoch(date, time).epoch };
  }

  function codePointLength(value) {
    return [...value].length;
  }

  function formatDate(value) {
    if (!value) return '';
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) return value;
    return `${year}. ${month}. ${day}.`;
  }

  function formatDateTime(epochSeconds) {
    const value = Number(epochSeconds);
    if (!Number.isFinite(value)) return '';
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value * 1000));
  }

  function formatDue(task) {
    if (task.dueKind === 'date') return formatDate(task.dueDate);
    if (task.dueKind === 'datetime') return formatDateTime(task.dueAt);
    return '없음';
  }

  async function readResponse(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '일정 요청에 실패했습니다.');
    return data;
  }

  function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    return state.apiFetch(path, { ...options, headers }).then(readResponse);
  }

  function actionButton(label, action, primary = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `task-action${primary ? ' primary' : ''}`;
    button.textContent = label;
    button.addEventListener('click', action);
    return button;
  }

  function renderUnavailable(container) {
    container.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'notification-empty';
    empty.textContent = '일정 기능이 아직 비활성화되어 있습니다.';
    container.appendChild(empty);
  }

  function renderLoading(container) {
    container.innerHTML = '';
    const skeleton = document.createElement('div');
    skeleton.className = 'task-panel-skeleton';
    skeleton.setAttribute('aria-label', '일정을 불러오는 중');
    skeleton.innerHTML = '<span></span><span></span><span></span>';
    container.appendChild(skeleton);
  }

  function renderError(container, message, retry) {
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'notification-empty danger task-panel-error';
    const text = document.createElement('p');
    text.textContent = message;
    const button = actionButton('다시 시도', retry);
    wrap.append(text, button);
    container.appendChild(wrap);
  }

  function renderHeader(container) {
    const nav = document.createElement('div');
    nav.className = 'task-view-tabs';
    nav.setAttribute('role', 'tablist');
    views
      .filter(([value]) => value !== 'series' || state.seriesEnabled)
      .forEach(([value, label]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'task-view-tab';
        button.dataset.taskView = value;
        button.textContent = label;
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', String(state.view === value));
        button.classList.toggle('active', state.view === value);
        button.addEventListener('click', () => {
          state.view = value;
          render(container, { view: value });
        });
        nav.appendChild(button);
      });
    container.appendChild(nav);
  }

  function dueFromForm(form) {
    const kind = form.elements.dueKind.value;
    if (kind === 'none') return { kind: 'none' };
    const date = form.elements.dueDate.value;
    if (!date) throw new Error('마감 날짜를 입력해주세요.');
    if (kind === 'date') return { kind: 'date', date };
    const time = form.elements.dueTime.value;
    if (!time) throw new Error('마감 시각을 입력해주세요.');
    const parsed = inputDateTimeEpoch(date, time);
    if (!parsed) throw new Error('마감 시각을 확인해주세요.');
    return { kind: 'datetime', at: parsed.value, epoch: parsed.epoch };
  }

  function reminderFromForm(form) {
    if (!form.elements.reminderEnabled.checked) return null;
    const date = form.elements.reminderDate.value;
    const time = form.elements.reminderTime.value;
    if (!date || !time) throw new Error('알림 날짜와 시각을 입력해주세요.');
    const parsed = inputDateTimeEpoch(date, time);
    if (!parsed) throw new Error('알림 시각을 확인해주세요.');
    return parsed;
  }

  // 서버가 최종 판정자다. 여기서는 서버가 반드시 거절할 값만 먼저 걸러내고,
  // 회차 날짜 계산은 하지 않는다. 규칙 엔진이 두 벌이 되면 화면과 실제 회차가
  // 어긋난 뒤에야 그 사실이 드러난다.
  function recurrenceFromForm(form, series = null) {
    const freq = form.elements.recurrenceFreq.value;
    const timeKind = form.elements.dueKind.value === 'datetime' ? 'datetime' : 'date';
    const startDate = form.elements.dueDate.value;
    if (!startDate) throw new Error('반복 시작 날짜를 입력해주세요.');
    if (!series && startDate < todayKst()) throw new Error('반복 시작일은 오늘보다 빠를 수 없습니다.');

    const rule = { freq, startDate, timeKind, endDate: form.elements.endDate.value || null };
    if (rule.endDate && rule.endDate < startDate) {
      throw new Error('반복 종료일은 시작일보다 빠를 수 없습니다.');
    }
    if (freq === 'weekly') {
      rule.byWeekday = [...form.querySelectorAll('input[name="byWeekday"]:checked')].map(box => Number(box.value));
      if (rule.byWeekday.length === 0) throw new Error('반복할 요일을 하나 이상 골라주세요.');
    }
    if (freq === 'monthly') {
      rule.byMonthday = Number(form.elements.byMonthday.value);
      if (!Number.isInteger(rule.byMonthday) || rule.byMonthday < 1 || rule.byMonthday > 31) {
        throw new Error('매월 반복 날짜는 1일부터 31일 사이로 정해주세요.');
      }
    }
    if (timeKind === 'datetime') {
      const time = form.elements.dueTime.value;
      if (!time) throw new Error('반복할 시각을 입력해주세요.');
      rule.timeOfDay = `${time}:00`;
      const lead = form.elements.reminderLead.value;
      rule.reminderLeadSeconds = lead === '' ? null : Number(lead);
    }
    return rule;
  }

  function sameDue(task, due) {
    if (!task || task.dueKind !== due.kind) return false;
    if (due.kind === 'none') return true;
    if (due.kind === 'date') return task.dueDate === due.date;
    return task.dueAt === due.epoch;
  }

  function validateNewTimes(task, due, reminder) {
    const now = Math.floor(Date.now() / 1000);
    const latest = latestAllowed(now);
    if (!sameDue(task, due)) {
      if (due.kind === 'date' && due.date < todayKst()) throw new Error('마감 날짜는 오늘보다 빠를 수 없습니다.');
      if (due.kind === 'datetime' && due.epoch < now) throw new Error('마감 시각은 과거일 수 없습니다.');
      if (due.kind === 'date' && due.date > latest.date) throw new Error('마감 날짜는 10년 이내로 정해주세요.');
      if (due.kind === 'datetime' && due.epoch > latest.epoch) throw new Error('마감 시각은 10년 이내로 정해주세요.');
    }
    const sameReminder = task?.reminder && reminder && task.reminder.remindAt === reminder.epoch;
    if (reminder && !sameReminder && reminder.epoch < now + 60) {
      throw new Error('알림은 현재보다 1분 이후로 정해주세요.');
    }
    if (reminder && !sameReminder && reminder.epoch > latest.epoch) {
      throw new Error('알림은 10년 이내로 정해주세요.');
    }
  }

  function createFormField(labelText, control, helperText = '') {
    const field = document.createElement('label');
    field.className = 'task-form-field';
    const label = document.createElement('span');
    label.className = 'task-form-label';
    label.textContent = labelText;
    field.append(label, control);
    if (helperText) {
      const helper = document.createElement('small');
      helper.textContent = helperText;
      field.appendChild(helper);
    }
    return field;
  }

  // 알림을 따로 걸지 않아도 서버가 기본 알림을 잡는다. 그 사실을 여기서 말해주지 않으면
  // 화면이 '알림 없음'이라고 거짓말한다. 규칙은 서버의 `autoRemindAt`과 같아야 한다.
  function defaultReminderSummary(kind, date, time) {
    if (kind === 'none' || !date) return '알림 없음';
    if (kind === 'date') return `기본 알림 ${formatDate(date)} 09:00 KST`;
    if (!time) return '기본 알림 마감 10분 전';
    const [hour, minute] = time.split(':').map(Number);
    const shifted = new Date(Date.UTC(2000, 0, 1, hour, minute - 10));
    const stamp = `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`;
    const sameDay = shifted.getUTCDate() === 1;
    return sameDay
      ? `기본 알림 ${formatDate(date)} ${stamp} KST`
      : `기본 알림 마감 10분 전 (${stamp} KST)`;
  }

  function setDateTimeInputs(task, dueDate, dueTime, reminderDate, reminderTime) {
    if (task?.dueKind === 'date') dueDate.value = task.dueDate;
    if (task?.dueKind === 'datetime') {
      const parts = kstDateParts(task.dueAt);
      dueDate.value = parts.date;
      dueTime.value = parts.time;
    }
    if (task?.reminder) {
      const parts = kstDateParts(task.reminder.remindAt);
      reminderDate.value = parts.date;
      reminderTime.value = parts.time;
    }
  }

  function renderComposer(container, task = null, initialTitle = '', series = null) {
    state.mode = 'compose';
    container.innerHTML = '';
    const form = document.createElement('form');
    form.className = 'task-form';
    form.noValidate = true;
    // 이미 만들어진 단발 일정을 반복으로 바꾸지는 않는다. 회차를 뒤늦게 만들면
    // 그 일정의 기한과 시리즈 규칙 중 무엇이 정본인지 알 수 없다.
    const canRecur = !task;

    const head = document.createElement('div');
    head.className = 'task-form-head';
    const heading = document.createElement('strong');
    heading.textContent = series ? '반복 수정' : task ? '일정 수정' : '일정 추가';
    const close = actionButton('목록으로', () => render(container));
    head.append(heading, close);

    const title = document.createElement('input');
    title.name = 'title';
    title.type = 'text';
    title.required = true;
    title.autocomplete = 'off';
    title.value = series?.title || task?.title || initialTitle;
    const titleField = createFormField('제목', title);
    const titleCount = document.createElement('small');
    titleCount.className = 'task-char-count';
    titleField.appendChild(titleCount);

    const detail = document.createElement('textarea');
    detail.name = 'detail';
    detail.rows = 3;
    detail.value = series?.detail || task?.detail || '';
    const detailField = createFormField('설명', detail, '선택 사항');
    const detailCount = document.createElement('small');
    detailCount.className = 'task-char-count';
    detailField.appendChild(detailCount);

    const recurrence = document.createElement('select');
    recurrence.name = 'recurrenceFreq';
    [
      ['none', '반복 안 함'], ['daily', '매일'], ['weekdays', '평일'],
      ['weekly', '매주 요일'], ['monthly', '매월 n일'],
    ].forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      recurrence.appendChild(option);
    });
    recurrence.value = series?.freq || 'none';
    const recurrenceField = createFormField('반복', recurrence);
    recurrenceField.hidden = !canRecur;

    const weekdayGroup = document.createElement('div');
    weekdayGroup.className = 'task-weekday-group';
    const selectedWeekdays = new Set(
      String(series?.byWeekday || '').split(',').filter(Boolean).map(Number)
    );
    WEEKDAYS.forEach(([value, label]) => {
      const item = document.createElement('label');
      item.className = 'task-weekday';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.name = 'byWeekday';
      box.value = String(value);
      box.checked = selectedWeekdays.has(value);
      const text = document.createElement('span');
      text.textContent = label;
      item.append(box, text);
      weekdayGroup.appendChild(item);
    });
    const weekdayField = createFormField('요일', weekdayGroup, '하나 이상 고르기');

    const monthday = document.createElement('input');
    monthday.name = 'byMonthday';
    monthday.type = 'number';
    monthday.min = '1';
    monthday.max = '31';
    monthday.value = series?.byMonthday ? String(series.byMonthday) : '1';
    const monthdayField = createFormField('날짜', monthday, '없는 달은 그 달을 건너뜁니다');

    const endDate = document.createElement('input');
    endDate.name = 'endDate';
    endDate.type = 'date';
    endDate.value = series?.endDate || '';
    const endDateField = createFormField('반복 종료일', endDate, '비우면 계속 반복');

    const reminderLead = document.createElement('select');
    reminderLead.name = 'reminderLead';
    REMINDER_LEADS.forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      reminderLead.appendChild(option);
    });
    reminderLead.value = series?.reminderLeadSeconds === null || series?.reminderLeadSeconds === undefined
      ? ''
      : String(series.reminderLeadSeconds);
    const reminderLeadField = createFormField('회차 알림', reminderLead, '기본은 시각 10분 전');

    const dueKind = document.createElement('select');
    dueKind.name = 'dueKind';
    [['none', '없음'], ['date', '날짜만'], ['datetime', '날짜와 시각']].forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      dueKind.appendChild(option);
    });
    dueKind.value = series?.timeKind || task?.dueKind || 'none';
    const dueKindField = createFormField('마감', dueKind);

    const dueDate = document.createElement('input');
    dueDate.name = 'dueDate';
    dueDate.type = 'date';
    const dueTime = document.createElement('input');
    dueTime.name = 'dueTime';
    dueTime.type = 'time';
    dueTime.step = '60';
    const dueDateField = createFormField('마감 날짜', dueDate);
    const dueGrid = document.createElement('div');
    dueGrid.className = 'task-form-grid';
    dueGrid.append(dueDateField, createFormField('마감 시각', dueTime));
    if (series) dueDate.value = series.startDate;

    const reminderToggle = document.createElement('label');
    reminderToggle.className = 'task-reminder-toggle';
    const reminderEnabled = document.createElement('input');
    reminderEnabled.name = 'reminderEnabled';
    reminderEnabled.type = 'checkbox';
    // 기본 알림은 사용자가 건 것이 아니다. 체크박스가 켜져 있으면 '내가 정한 시각'이라는
    // 뜻이어야 해서 origin으로 판정한다.
    reminderEnabled.checked = task?.reminder?.origin === 'user';
    const reminderText = document.createElement('span');
    reminderText.textContent = '알림 사용';
    reminderToggle.append(reminderEnabled, reminderText);

    const reminderDate = document.createElement('input');
    reminderDate.name = 'reminderDate';
    reminderDate.type = 'date';
    const reminderTime = document.createElement('input');
    reminderTime.name = 'reminderTime';
    reminderTime.type = 'time';
    reminderTime.step = '60';
    const reminderGrid = document.createElement('div');
    reminderGrid.className = 'task-form-grid task-reminder-fields';
    reminderGrid.append(createFormField('알림 날짜', reminderDate), createFormField('알림 시각', reminderTime));
    setDateTimeInputs(task, dueDate, dueTime, reminderDate, reminderTime);
    if (series?.timeOfDay) dueTime.value = series.timeOfDay.slice(0, 5);

    const summary = document.createElement('p');
    summary.className = 'task-form-summary';
    const error = document.createElement('p');
    error.className = 'task-form-error';
    error.setAttribute('aria-live', 'polite');
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'task-submit';
    submit.textContent = task ? '수정 저장' : '일정 만들기';

    function isRecurring() {
      return canRecur && recurrence.value !== 'none';
    }

    function updateVisibility() {
      const recurring = isRecurring();
      // 반복에는 "기한 없음"이 없다. 회차마다 날짜가 있어야 회차가 성립한다.
      if (recurring && dueKind.value === 'none') dueKind.value = 'date';
      dueKind.options[0].hidden = recurring;
      dueKindField.querySelector('.task-form-label').textContent = recurring ? '회차 시각' : '마감';
      dueDateField.querySelector('.task-form-label').textContent = recurring ? '시작 날짜' : '마감 날짜';

      weekdayField.hidden = !recurring || recurrence.value !== 'weekly';
      monthdayField.hidden = !recurring || recurrence.value !== 'monthly';
      endDateField.hidden = !recurring;
      reminderLeadField.hidden = !recurring || dueKind.value !== 'datetime';
      reminderToggle.hidden = recurring;

      dueGrid.hidden = dueKind.value === 'none';
      dueTime.closest('.task-form-field').hidden = dueKind.value !== 'datetime';
      reminderGrid.hidden = recurring || !reminderEnabled.checked;

      if (recurring) {
        const preview = recurrenceLabel({
          freq: recurrence.value,
          byWeekday: [...form.querySelectorAll('input[name="byWeekday"]:checked')]
            .map(box => box.value).join(','),
          byMonthday: Number(monthday.value),
          timeKind: dueKind.value,
          timeOfDay: dueTime.value ? `${dueTime.value}:00` : '',
        });
        const span = endDate.value
          ? `${formatDate(dueDate.value)}부터 ${formatDate(endDate.value)}까지`
          : `${formatDate(dueDate.value)}부터`;
        const lead = REMINDER_LEADS.find(item => item[0] === reminderLead.value)?.[1] || '기본';
        summary.textContent = dueDate.value
          ? `${preview} · ${span} / 회차 알림 ${lead}`
          : `${preview} / 시작 날짜 미정`;
      } else {
        const dueText = dueKind.value === 'none'
          ? '마감 없음'
          : dueDate.value
            ? `마감 ${formatDate(dueDate.value)}${dueKind.value === 'datetime' && dueTime.value ? ` ${dueTime.value} KST` : ''}`
            : '마감 날짜 미정';
        const reminderSummary = reminderEnabled.checked
          ? reminderDate.value && reminderTime.value
            ? `알림 ${formatDate(reminderDate.value)} ${reminderTime.value} KST`
            : '알림 시각 미정'
          : defaultReminderSummary(dueKind.value, dueDate.value, dueTime.value);
        summary.textContent = `${dueText} / ${reminderSummary}`;
      }
      submit.textContent = recurring
        ? (series ? '반복 저장' : '반복 만들기')
        : (task ? '수정 저장' : '일정 만들기');
      titleCount.textContent = `${codePointLength(title.value)}/200`;
      detailCount.textContent = `${codePointLength(detail.value)}/2000`;
    }

    [
      recurrence, monthday, endDate, reminderLead, dueKind, dueDate, dueTime,
      reminderEnabled, reminderDate, reminderTime, title, detail,
    ].forEach(input => input.addEventListener('input', updateVisibility));
    weekdayGroup.addEventListener('change', updateVisibility);
    recurrence.addEventListener('change', updateVisibility);
    dueKind.addEventListener('change', updateVisibility);
    updateVisibility();

    const clientRequestId = makeRequestKey('web-task');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      error.textContent = '';
      const cleanTitle = title.value.normalize('NFC').trim();
      if (!cleanTitle) {
        error.textContent = '제목을 입력해주세요.';
        title.focus();
        return;
      }
      if (codePointLength(cleanTitle) > 200) {
        error.textContent = '제목은 200자 이내로 입력해주세요.';
        title.focus();
        return;
      }
      if (codePointLength(detail.value.normalize('NFC').trim()) > 2000) {
        error.textContent = '설명은 2,000자 이내로 입력해주세요.';
        detail.focus();
        return;
      }
      try {
        if (isRecurring()) {
          const rule = recurrenceFromForm(form, series);
          submit.disabled = true;
          submit.textContent = '저장 중';
          if (series) {
            await request(`/api/task-series/${series.id}`, {
              method: 'PATCH',
              body: JSON.stringify({
                expectedVersion: series.version,
                title: cleanTitle,
                detail: detail.value.normalize('NFC').trim(),
                recurrence: rule,
              }),
            });
            state.showToast('반복을 수정했어');
          } else {
            await request('/api/task-series', {
              method: 'POST',
              body: JSON.stringify({
                clientRequestId,
                title: cleanTitle,
                detail: detail.value.normalize('NFC').trim(),
                recurrence: rule,
              }),
            });
            state.showToast('반복 일정을 만들었어');
          }
          state.onChanged?.();
          render(container, { view: 'series' });
          return;
        }
        const due = dueFromForm(form);
        const reminder = reminderFromForm(form);
        validateNewTimes(task, due, reminder);
        submit.disabled = true;
        submit.textContent = task ? '저장 중' : '만드는 중';
        if (task) {
          const payload = {
            expectedVersion: task.version,
            title: cleanTitle,
            detail: detail.value.normalize('NFC').trim(),
            reminderChange: { action: 'keep' },
          };
          if (!sameDue(task, due)) {
            payload.due = due.kind === 'datetime' ? { kind: 'datetime', at: due.at } : due;
          }
          if (!reminder && task.reminder) payload.reminderChange = { action: 'remove' };
          if (reminder && (!task.reminder || reminder.epoch !== task.reminder.remindAt)) {
            payload.reminderChange = { action: 'replace', at: reminder.value };
          }
          await request(`/api/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
          state.showToast('일정을 수정했어');
        } else {
          await request('/api/tasks', {
            method: 'POST',
            body: JSON.stringify({
              clientRequestId,
              title: cleanTitle,
              detail: detail.value.normalize('NFC').trim(),
              due: due.kind === 'datetime' ? { kind: 'datetime', at: due.at } : due,
              reminderAt: reminder?.value || null,
            }),
          });
          state.showToast('일정을 만들었어');
        }
        state.onChanged?.();
        render(container);
      } catch (requestError) {
        error.textContent = requestError.message;
        submit.disabled = false;
        updateVisibility();
      }
    });

    form.append(
      head, titleField, detailField, recurrenceField, weekdayField, monthdayField,
      dueKindField, dueGrid, endDateField, reminderLeadField,
      reminderToggle, reminderGrid, summary, error, submit,
    );
    container.appendChild(form);
    title.focus();
  }

  async function mutateTask(task, action, button) {
    const labels = { complete: '완료했어', cancel: '취소했어', reopen: '다시 열었어', delete: '삭제했어', restore: '복원했어' };
    button.disabled = true;
    try {
      await request(`/api/tasks/${task.id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ expectedVersion: task.version }),
      });
      state.showToast(labels[action] || '일정을 변경했어');
      state.onChanged?.();
      render(state.container);
    } catch (error) {
      state.showToast(error.message);
      button.disabled = false;
    }
  }

  async function loadSeries(id) {
    const data = await request('/api/task-series');
    const found = data.series.find(item => item.id === id);
    if (!found) throw new Error('반복 일정을 찾을 수 없습니다.');
    return found;
  }

  async function openSeriesEditor(id) {
    try {
      renderComposer(state.container, null, '', await loadSeries(id));
    } catch (error) {
      state.showToast(error.message);
    }
  }

  async function endSeries(id) {
    try {
      const series = await loadSeries(id);
      await request(`/api/task-series/${series.id}/end`, {
        method: 'POST',
        body: JSON.stringify({ expectedVersion: series.version }),
      });
      state.showToast('반복을 종료했어');
      state.onChanged?.();
      render(state.container);
    } catch (error) {
      state.showToast(error.message);
    }
  }

  // 회차 하나를 고치는 것과 반복 전체를 고치는 것은 결과가 다르다. 라벨만 보고
  // 누르면 미래 전부가 바뀔 수 있어서 한 번 더 고르게 한다.
  function chooseScope(actions, { thisLabel, seriesLabel, onThis, onSeries }) {
    const previous = [...actions.children];
    actions.replaceChildren(
      actionButton(thisLabel, onThis, true),
      actionButton(seriesLabel, onSeries),
      actionButton('되돌리기', () => actions.replaceChildren(...previous)),
    );
  }

  function taskCard(task, bucket = '') {
    const card = document.createElement('article');
    card.className = 'task-card';
    const top = document.createElement('div');
    top.className = 'task-card-top';
    const title = document.createElement('strong');
    title.textContent = task.title;
    top.appendChild(title);
    if (bucket) {
      const status = document.createElement('span');
      status.className = `task-bucket ${bucket}`;
      status.textContent = bucket === 'overdue' ? '지연' : '오늘';
      top.appendChild(status);
    }
    if (task.series) {
      const badge = document.createElement('span');
      badge.className = 'task-series-badge';
      badge.textContent = recurrenceLabel(task.series);
      top.appendChild(badge);
    }

    const meta = document.createElement('div');
    meta.className = 'task-card-meta';
    if (task.dueKind !== 'none') {
      const due = document.createElement('span');
      due.textContent = `마감 ${formatDue(task)}`;
      meta.appendChild(due);
    }
    if (task.reminder) {
      const reminder = document.createElement('span');
      reminder.textContent = `알림 ${formatDateTime(task.reminder.remindAt)}`;
      meta.appendChild(reminder);
    }
    if (task.series && task.series.remaining > 0) {
      const remaining = document.createElement('span');
      remaining.textContent = `다음 회차 ${task.series.remaining}개`;
      meta.appendChild(remaining);
    }
    meta.hidden = meta.childElementCount === 0;

    const detail = document.createElement('p');
    detail.className = 'task-card-detail';
    detail.textContent = task.detail;
    detail.hidden = !task.detail;

    const actions = document.createElement('div');
    actions.className = 'task-card-actions';
    const addMutation = (label, action, primary = false) => {
      const button = actionButton(label, () => mutateTask(task, action, button), primary);
      actions.appendChild(button);
    };
    if (task.lifecycle === 'active' && task.series) {
      addMutation('완료', 'complete', true);
      actions.appendChild(actionButton('수정', () => chooseScope(actions, {
        thisLabel: '이번 회차만',
        seriesLabel: '이후 전체',
        onThis: () => renderComposer(state.container, task),
        onSeries: () => openSeriesEditor(task.series.id),
      })));
      actions.appendChild(actionButton('취소', () => chooseScope(actions, {
        thisLabel: '이번 회차 건너뛰기',
        seriesLabel: '반복 종료',
        onThis: event => mutateTask(task, 'cancel', event.currentTarget),
        onSeries: () => endSeries(task.series.id),
      })));
      addMutation('삭제', 'delete');
    } else if (task.lifecycle === 'active') {
      addMutation('완료', 'complete', true);
      actions.appendChild(actionButton('수정', () => renderComposer(state.container, task)));
      addMutation('취소', 'cancel');
      addMutation('삭제', 'delete');
    } else if (task.lifecycle === 'closed') {
      addMutation('다시 열기', 'reopen', true);
      addMutation('삭제', 'delete');
    } else {
      addMutation('복원', 'restore', true);
    }
    card.append(top, meta, detail, actions);
    return card;
  }

  function taskSection(titleText, tasks, bucket = '') {
    const section = document.createElement('section');
    section.className = 'task-list-section';
    const heading = document.createElement('h3');
    heading.textContent = `${titleText} ${tasks.length}`;
    section.appendChild(heading);
    tasks.forEach(task => section.appendChild(taskCard(task, bucket)));
    return section;
  }

  function seriesCard(series) {
    const card = document.createElement('article');
    card.className = 'task-card task-series-card';
    const top = document.createElement('div');
    top.className = 'task-card-top';
    const title = document.createElement('strong');
    title.textContent = series.title;
    const badge = document.createElement('span');
    badge.className = 'task-series-badge';
    badge.textContent = recurrenceLabel(series);
    top.append(title, badge);

    const meta = document.createElement('div');
    meta.className = 'task-card-meta';
    const span = document.createElement('span');
    span.textContent = series.endDate
      ? `${formatDate(series.startDate)} ~ ${formatDate(series.endDate)}`
      : `${formatDate(series.startDate)}부터`;
    meta.appendChild(span);
    if (series.timeKind === 'datetime') {
      const lead = document.createElement('span');
      const seconds = series.reminderLeadSeconds;
      lead.textContent = seconds === null || seconds === undefined
        ? '회차 알림 기본'
        : `회차 알림 ${REMINDER_LEADS.find(item => item[0] === String(seconds))?.[1] || `${seconds}초 전`}`;
      meta.appendChild(lead);
    }

    const detail = document.createElement('p');
    detail.className = 'task-card-detail';
    detail.textContent = series.detail;
    detail.hidden = !series.detail;

    const actions = document.createElement('div');
    actions.className = 'task-card-actions';
    if (series.status === 'active') {
      actions.append(
        actionButton('수정', () => openSeriesEditor(series.id), true),
        actionButton('종료', () => chooseScope(actions, {
          thisLabel: '반복 종료',
          seriesLabel: '그대로 두기',
          onThis: () => endSeries(series.id),
          onSeries: () => render(state.container),
        })),
      );
    } else {
      const ended = document.createElement('span');
      ended.className = 'task-series-ended';
      ended.textContent = '종료된 반복';
      actions.appendChild(ended);
    }
    card.append(top, meta, detail, actions);
    return card;
  }

  function renderSeriesList(container, data) {
    container.innerHTML = '';
    renderHeader(container);
    const content = document.createElement('div');
    content.className = 'task-list';
    const active = data.series || [];
    if (active.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'notification-empty';
      empty.textContent = '반복 일정이 없습니다.';
      content.appendChild(empty);
    } else {
      const section = document.createElement('section');
      section.className = 'task-list-section';
      const heading = document.createElement('h3');
      heading.textContent = `반복 ${active.length}`;
      section.appendChild(heading);
      active.forEach(series => section.appendChild(seriesCard(series)));
      content.appendChild(section);
    }
    container.appendChild(content);
  }

  function renderList(container, data) {
    container.innerHTML = '';
    renderHeader(container);
    const content = document.createElement('div');
    content.className = 'task-list';
    if (state.view === 'today') {
      if (data.overdue?.length) content.appendChild(taskSection('지연', data.overdue, 'overdue'));
      if (data.today?.length) content.appendChild(taskSection('오늘', data.today, 'today'));
      if (!data.overdue?.length && !data.today?.length) {
        const empty = document.createElement('div');
        empty.className = 'notification-empty';
        empty.textContent = '오늘 마감하거나 지연된 일정이 없습니다.';
        content.appendChild(empty);
      }
    } else if (!data.tasks?.length) {
      const empty = document.createElement('div');
      empty.className = 'notification-empty';
      empty.textContent = state.view === 'upcoming' ? '예정된 일정이 없습니다.'
        : state.view === 'inbox' ? '기한 없는 일정이 없습니다.'
          : state.view === 'history' ? '종결된 일정이 없습니다.' : '삭제된 일정이 없습니다.';
      content.appendChild(empty);
    } else {
      const labels = { upcoming: '예정', inbox: 'Inbox', history: '종결됨', trash: '삭제됨' };
      content.appendChild(taskSection(labels[state.view], data.tasks));
    }
    container.appendChild(content);
  }

  async function render(container, options = {}) {
    state.container = container;
    if (!state.enabled) {
      renderUnavailable(container);
      return;
    }
    if (options.compose) {
      renderComposer(container, null, options.initialTitle || '');
      return;
    }
    state.mode = 'list';
    if (options.view) state.view = options.view;
    const requestId = ++state.requestId;
    renderLoading(container);
    try {
      if (state.view === 'series') {
        const data = await request('/api/task-series');
        if (requestId !== state.requestId) return;
        renderSeriesList(container, data);
        return;
      }
      const data = await request(`/api/tasks?view=${encodeURIComponent(state.view)}&limit=100`);
      if (requestId !== state.requestId) return;
      renderList(container, data);
    } catch (error) {
      if (requestId !== state.requestId) return;
      renderError(container, error.message, () => render(container));
    }
  }

  function refresh() {
    if (!state.enabled || !state.container || state.mode === 'compose') return Promise.resolve();
    return render(state.container);
  }

  function makeReminderCard(item) {
    const card = document.createElement('article');
    card.className = 'notification-card type-task-reminder task-reminder-card';
    const top = document.createElement('div');
    top.className = 'notification-card-top';
    const badge = document.createElement('span');
    badge.className = 'notification-badge';
    badge.textContent = '일정 알림';
    const time = document.createElement('span');
    time.className = 'notification-source';
    time.textContent = formatDateTime(item.remindAt);
    top.append(badge, time);
    const title = document.createElement('div');
    title.className = 'notification-note';
    title.textContent = item.title || '제목 없는 일정';
    const text = document.createElement('div');
    text.className = 'notification-text';
    text.textContent = '확인하거나 1시간 뒤에 다시 알릴 수 있습니다.';
    const actions = document.createElement('div');
    actions.className = 'task-reminder-actions';
    const snoozeRequestKey = makeRequestKey('web-snooze');

    async function run(button, path, body, success) {
      [...actions.querySelectorAll('button')].forEach(itemButton => { itemButton.disabled = true; });
      try {
        await request(path, { method: 'POST', body: JSON.stringify(body) });
        state.showToast(success);
        state.onChanged?.();
      } catch (error) {
        state.showToast(error.message);
        [...actions.querySelectorAll('button')].forEach(itemButton => { itemButton.disabled = false; });
        button.focus();
      }
    }
    const acknowledge = actionButton('확인', event => run(
      event.currentTarget,
      `/api/reminders/${item.reminderId}/acknowledge`,
      {},
      '알림을 확인했어',
    ), true);
    const snooze = actionButton('1시간 뒤', event => run(
      event.currentTarget,
      `/api/reminders/${item.reminderId}/snooze`,
      { requestKey: snoozeRequestKey, minutes: 60 },
      '1시간 뒤에 다시 알릴게',
    ));
    const complete = actionButton('완료', event => run(
      event.currentTarget,
      `/api/tasks/${item.taskId}/complete`,
      { expectedVersion: item.taskVersion },
      '일정을 완료했어',
    ));
    actions.append(acknowledge, snooze, complete);
    card.append(top, title, text, actions);
    return card;
  }

  function formatCandidateDateTime(value) {
    const epoch = Math.floor(Date.parse(value) / 1000);
    if (!Number.isFinite(epoch)) return String(value || '');
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(epoch * 1000));
  }

  function makeScheduleCandidateCard(candidate) {
    const input = candidate?.task;
    if (
      !state.enabled || !state.apiFetch || !input
      || typeof input.clientRequestId !== 'string'
      || typeof input.title !== 'string'
      || typeof input.detail !== 'string'
      || !input.due || typeof input.due !== 'object'
      || !['none', 'date', 'datetime'].includes(input.due.kind)
      || (input.reminderAt !== null && typeof input.reminderAt !== 'string')
    ) return null;

    const payload = JSON.parse(JSON.stringify(input));
    const card = document.createElement('article');
    card.className = 'task-candidate-card';
    card.setAttribute('aria-label', '일정 등록 전 확인');

    const heading = document.createElement('strong');
    heading.className = 'task-candidate-heading';
    heading.textContent = '일정 등록 전 확인';
    const title = document.createElement('div');
    title.className = 'task-candidate-title';
    title.textContent = payload.title;
    const detail = document.createElement('p');
    detail.className = 'task-candidate-detail';
    detail.textContent = payload.detail;
    detail.hidden = !payload.detail;

    const meta = document.createElement('div');
    meta.className = 'task-candidate-meta';
    const due = document.createElement('span');
    due.textContent = payload.due.kind === 'date'
      ? `마감 ${formatDate(payload.due.date)}`
      : payload.due.kind === 'datetime'
        ? `마감 ${formatCandidateDateTime(payload.due.at)} KST`
        : '마감 없음';
    const reminder = document.createElement('span');
    reminder.textContent = payload.reminderAt
      ? `알림 ${formatCandidateDateTime(payload.reminderAt)} KST`
      : '알림 없음';
    meta.append(due, reminder);

    const status = document.createElement('p');
    status.className = 'task-candidate-status';
    status.setAttribute('aria-live', 'polite');
    status.textContent = '아직 저장되지 않았어.';
    const actions = document.createElement('div');
    actions.className = 'task-candidate-actions';

    // 카드가 답을 받으면 더는 음성 확인 대상이 아니다. 늦게 온 "응"이 다른 카드를
    // 건드리지 않도록 여기서 지운다.
    function releasePending() {
      if (state.pendingCandidate?.id === payload.clientRequestId) state.pendingCandidate = null;
    }

    function runCancel() {
      releasePending();
      actions.remove();
      card.classList.add('is-cancelled');
      status.textContent = '등록하지 않았어.';
    }

    async function runConfirm() {
      cancel.disabled = true;
      confirm.disabled = true;
      confirm.textContent = '등록 중';
      status.classList.remove('error');
      status.textContent = '일정을 등록하고 있어.';
      try {
        await request('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
        releasePending();
        actions.remove();
        card.classList.add('is-confirmed');
        status.textContent = '일정을 등록했어.';
        state.showToast('일정을 만들었어');
        state.onChanged?.();
      } catch (error) {
        cancel.disabled = false;
        confirm.disabled = false;
        confirm.textContent = '등록';
        status.classList.add('error');
        status.textContent = error.message;
        state.showToast(error.message);
        throw error;
      }
    }

    const cancel = actionButton('취소', runCancel);
    const confirm = actionButton('등록', runConfirm, true);
    actions.append(cancel, confirm);
    card.append(heading, title, detail, meta, status, actions);

    // 음성이 자기 요청을 새로 만들지 않고 버튼과 똑같은 경로를 부르게 한다.
    state.pendingCandidate = {
      id: payload.clientRequestId,
      title: payload.title,
      confirm: runConfirm,
      cancel: runCancel,
    };
    return card;
  }

  // 아직 등록도 취소도 되지 않은 가장 최근 카드. 없으면 null이다.
  function getPendingScheduleConfirmation() {
    return state.pendingCandidate;
  }

  function init({ apiFetch, showToast, onChanged, enabled, seriesEnabled = false }) {
    if (state.initialized) return;
    if (typeof apiFetch !== 'function' || typeof showToast !== 'function') {
      throw new TypeError('TaskPanel 초기화 인자가 올바르지 않습니다.');
    }
    state.apiFetch = apiFetch;
    state.showToast = showToast;
    state.onChanged = typeof onChanged === 'function' ? onChanged : () => {};
    state.enabled = enabled === true;
    state.seriesEnabled = state.enabled && seriesEnabled === true;
    state.initialized = true;
  }

  global.TaskPanel = {
    init, render, refresh, makeReminderCard,
    makeScheduleCandidateCard, getPendingScheduleConfirmation,
  };
})(window);
