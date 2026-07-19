'use strict';

(function setupTaskPanel(global) {
  const state = {
    initialized: false,
    enabled: false,
    apiFetch: null,
    showToast: null,
    onChanged: null,
    container: null,
    view: 'today',
    mode: 'list',
    requestId: 0,
  };

  const views = [
    ['today', '오늘'],
    ['upcoming', '예정'],
    ['inbox', 'Inbox'],
    ['history', '종결'],
    ['trash', '삭제'],
  ];

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
    views.forEach(([value, label]) => {
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

  function renderComposer(container, task = null, initialTitle = '') {
    state.mode = 'compose';
    container.innerHTML = '';
    const form = document.createElement('form');
    form.className = 'task-form';
    form.noValidate = true;

    const head = document.createElement('div');
    head.className = 'task-form-head';
    const heading = document.createElement('strong');
    heading.textContent = task ? '일정 수정' : '일정 추가';
    const close = actionButton('목록으로', () => render(container));
    head.append(heading, close);

    const title = document.createElement('input');
    title.name = 'title';
    title.type = 'text';
    title.required = true;
    title.autocomplete = 'off';
    title.value = task?.title || initialTitle;
    const titleField = createFormField('제목', title);
    const titleCount = document.createElement('small');
    titleCount.className = 'task-char-count';
    titleField.appendChild(titleCount);

    const detail = document.createElement('textarea');
    detail.name = 'detail';
    detail.rows = 3;
    detail.value = task?.detail || '';
    const detailField = createFormField('설명', detail, '선택 사항');
    const detailCount = document.createElement('small');
    detailCount.className = 'task-char-count';
    detailField.appendChild(detailCount);

    const dueKind = document.createElement('select');
    dueKind.name = 'dueKind';
    [['none', '없음'], ['date', '날짜만'], ['datetime', '날짜와 시각']].forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      dueKind.appendChild(option);
    });
    dueKind.value = task?.dueKind || 'none';
    const dueKindField = createFormField('마감', dueKind);

    const dueDate = document.createElement('input');
    dueDate.name = 'dueDate';
    dueDate.type = 'date';
    const dueTime = document.createElement('input');
    dueTime.name = 'dueTime';
    dueTime.type = 'time';
    dueTime.step = '60';
    const dueGrid = document.createElement('div');
    dueGrid.className = 'task-form-grid';
    dueGrid.append(createFormField('마감 날짜', dueDate), createFormField('마감 시각', dueTime));

    const reminderToggle = document.createElement('label');
    reminderToggle.className = 'task-reminder-toggle';
    const reminderEnabled = document.createElement('input');
    reminderEnabled.name = 'reminderEnabled';
    reminderEnabled.type = 'checkbox';
    reminderEnabled.checked = Boolean(task?.reminder);
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

    const summary = document.createElement('p');
    summary.className = 'task-form-summary';
    const error = document.createElement('p');
    error.className = 'task-form-error';
    error.setAttribute('aria-live', 'polite');
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'task-submit';
    submit.textContent = task ? '수정 저장' : '일정 만들기';

    function updateVisibility() {
      dueGrid.hidden = dueKind.value === 'none';
      dueTime.closest('.task-form-field').hidden = dueKind.value !== 'datetime';
      reminderGrid.hidden = !reminderEnabled.checked;
      const dueText = dueKind.value === 'none'
        ? '마감 없음'
        : dueDate.value
          ? `마감 ${formatDate(dueDate.value)}${dueKind.value === 'datetime' && dueTime.value ? ` ${dueTime.value} KST` : ''}`
          : '마감 날짜 미정';
      const reminderSummary = reminderEnabled.checked
        ? reminderDate.value && reminderTime.value
          ? `알림 ${formatDate(reminderDate.value)} ${reminderTime.value} KST`
          : '알림 시각 미정'
        : '알림 없음';
      summary.textContent = `${dueText} / ${reminderSummary}`;
      titleCount.textContent = `${codePointLength(title.value)}/200`;
      detailCount.textContent = `${codePointLength(detail.value)}/2000`;
    }

    [dueKind, dueDate, dueTime, reminderEnabled, reminderDate, reminderTime, title, detail]
      .forEach(input => input.addEventListener('input', updateVisibility));
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
        submit.textContent = task ? '수정 저장' : '일정 만들기';
      }
    });

    form.append(
      head, titleField, detailField, dueKindField, dueGrid,
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
    if (task.lifecycle === 'active') {
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
    const cancel = actionButton('취소', () => {
      actions.remove();
      card.classList.add('is-cancelled');
      status.textContent = '등록하지 않았어.';
    });
    const confirm = actionButton('등록', async () => {
      cancel.disabled = true;
      confirm.disabled = true;
      confirm.textContent = '등록 중';
      status.classList.remove('error');
      status.textContent = '일정을 등록하고 있어.';
      try {
        await request('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
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
      }
    }, true);
    actions.append(cancel, confirm);
    card.append(heading, title, detail, meta, status, actions);
    return card;
  }

  function init({ apiFetch, showToast, onChanged, enabled }) {
    if (state.initialized) return;
    if (typeof apiFetch !== 'function' || typeof showToast !== 'function') {
      throw new TypeError('TaskPanel 초기화 인자가 올바르지 않습니다.');
    }
    state.apiFetch = apiFetch;
    state.showToast = showToast;
    state.onChanged = typeof onChanged === 'function' ? onChanged : () => {};
    state.enabled = enabled === true;
    state.initialized = true;
  }

  global.TaskPanel = { init, render, refresh, makeReminderCard, makeScheduleCandidateCard };
})(window);
