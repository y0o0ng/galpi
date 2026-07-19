'use strict';

(function setupAgentPanel(global) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const state = {
    initialized: false,
    enabled: false,
    apiFetch: null,
    pushClient: null,
    pushState: { status: 'checking', label: '확인 중' },
    showToast: null,
    container: null,
    requestId: 0,
    mode: 'summary',
    summary: null,
    reminders: [],
    taskOptions: { view: 'today' },
    focusReminders: false,
    calendarLoading: false,
    calendarSettleTimer: null,
  };

  const countLabels = [
    ['overdue', '지연'],
    ['today', '오늘'],
    ['upcoming', '예정'],
    ['inbox', 'Inbox'],
  ];

  function parseDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }

  function formatDateValue(date) {
    return [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, '0'),
      String(date.getUTCDate()).padStart(2, '0'),
    ].join('-');
  }

  function addDays(value, days) {
    const date = parseDate(value);
    if (!date) return value;
    date.setTime(date.getTime() + days * DAY_MS);
    return formatDateValue(date);
  }

  function formatDateTime(epochSeconds) {
    const value = Number(epochSeconds);
    if (!Number.isFinite(value)) return '예정 없음';
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: 'short',
      day: 'numeric',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value * 1000));
  }

  function weekLabel(value) {
    const date = parseDate(value);
    if (!date) return { weekday: '', day: '' };
    return {
      weekday: new Intl.DateTimeFormat('ko-KR', { weekday: 'narrow', timeZone: 'UTC' }).format(date),
      day: String(date.getUTCDate()),
    };
  }

  function weekRangeLabel(week) {
    const first = parseDate(week?.days?.[0]?.date);
    const last = parseDate(week?.days?.[6]?.date);
    if (!first || !last) return '날짜';
    const firstYear = first.getUTCFullYear();
    const firstMonth = first.getUTCMonth() + 1;
    const lastYear = last.getUTCFullYear();
    const lastMonth = last.getUTCMonth() + 1;
    if (firstYear !== lastYear) {
      return `${firstYear}년 ${firstMonth}월 ${first.getUTCDate()}일-${lastYear}년 ${lastMonth}월 ${last.getUTCDate()}일`;
    }
    if (firstMonth !== lastMonth) {
      return `${firstYear}년 ${firstMonth}월 ${first.getUTCDate()}일-${lastMonth}월 ${last.getUTCDate()}일`;
    }
    return `${firstYear}년 ${firstMonth}월 ${first.getUTCDate()}-${last.getUTCDate()}일`;
  }

  function button(label, action, primary = false) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `schedule-agent-action${primary ? ' primary' : ''}`;
    element.textContent = label;
    element.addEventListener('click', action);
    return element;
  }

  function renderUnavailable() {
    state.container.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'panel-empty-state';
    empty.textContent = '준비 중';
    state.container.appendChild(empty);
  }

  function renderLoading() {
    state.container.replaceChildren();
    const skeleton = document.createElement('div');
    skeleton.className = 'schedule-agent-block schedule-agent-skeleton';
    skeleton.setAttribute('aria-label', '일정 요약을 불러오는 중');
    skeleton.innerHTML = '<span></span><span></span><span></span><span></span>';
    state.container.appendChild(skeleton);
  }

  function renderError(message) {
    state.container.replaceChildren();
    const block = document.createElement('section');
    block.className = 'schedule-agent-block schedule-agent-error';
    const title = document.createElement('strong');
    title.textContent = '일정 요약을 불러오지 못했습니다.';
    const detail = document.createElement('p');
    detail.textContent = message;
    block.append(title, detail, button('다시 시도', refresh));
    state.container.appendChild(block);
  }

  async function enablePush(buttonElement) {
    buttonElement.disabled = true;
    try {
      const enabled = await state.pushClient.enable();
      state.pushState = state.pushClient.getState();
      if (enabled) state.showToast('일정 알림을 켰어');
      await refresh();
    } catch (error) {
      state.showToast(`알림 설정 실패: ${error.message}`);
      await refresh();
    }
  }

  function makeHeader() {
    const header = document.createElement('div');
    header.className = 'schedule-agent-head';
    const title = document.createElement('div');
    const kicker = document.createElement('span');
    kicker.className = 'schedule-agent-kicker';
    kicker.textContent = 'XION TASKS';
    const heading = document.createElement('h2');
    heading.textContent = '일정 에이전트';
    title.append(kicker, heading);
    let status;
    if (state.pushState.status === 'available') {
      status = document.createElement('button');
      status.type = 'button';
      status.className = 'schedule-agent-status schedule-agent-push-action';
      status.addEventListener('click', () => enablePush(status));
    } else {
      status = document.createElement('span');
      status.className = 'schedule-agent-status';
    }
    status.textContent = state.pushState.label;
    header.append(title, status);
    return header;
  }

  function makeWeekPage(week) {
    const page = document.createElement('div');
    page.className = 'schedule-agent-week-page';
    page.setAttribute('aria-label', weekRangeLabel(week));
    const grid = document.createElement('div');
    grid.className = 'schedule-agent-week';
    (week?.days || []).slice(0, 7).forEach(item => {
      const label = weekLabel(item.date);
      const day = document.createElement('div');
      day.className = 'schedule-agent-day';
      day.classList.toggle('today', item.isToday === true);
      if (item.isToday === true) day.setAttribute('aria-current', 'date');
      const weekday = document.createElement('span');
      weekday.textContent = label.weekday;
      const date = document.createElement('strong');
      date.textContent = label.day;
      const count = document.createElement('span');
      count.className = 'schedule-agent-day-count';
      count.textContent = String(Number(item.count) || 0);
      day.append(weekday, date, count);
      grid.appendChild(day);
    });
    page.appendChild(grid);
    return page;
  }

  async function loadCalendarCenter(center) {
    if (state.calendarLoading || !center) return;
    state.calendarLoading = true;
    state.container.querySelector('.schedule-agent-calendar')?.setAttribute('aria-busy', 'true');
    try {
      const response = await state.apiFetch(`/api/tasks/summary?calendarCenter=${encodeURIComponent(center)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '날짜를 불러오지 못했습니다.');
      if (state.mode !== 'summary') return;
      state.summary = data;
      state.calendarLoading = false;
      renderSummary();
    } catch (error) {
      state.showToast(error.message);
      state.calendarLoading = false;
      if (state.mode === 'summary') renderSummary();
    } finally {
      state.calendarLoading = false;
    }
  }

  function settleCalendar(viewport) {
    clearTimeout(state.calendarSettleTimer);
    state.calendarSettleTimer = setTimeout(() => {
      if (!viewport.isConnected || state.mode !== 'summary' || state.calendarLoading) return;
      const width = viewport.clientWidth;
      if (!width) return;
      const pageIndex = Math.max(0, Math.min(2, Math.round(viewport.scrollLeft / width)));
      if (pageIndex !== 1) {
        loadCalendarCenter(addDays(state.summary.calendarCenter, (pageIndex - 1) * 7));
      }
    }, 120);
  }

  function scrollCalendar(delta) {
    const viewport = state.container.querySelector('.schedule-agent-calendar-viewport');
    if (!viewport || state.calendarLoading) return;
    const reduceMotion = global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    viewport.scrollTo({
      left: viewport.clientWidth * (1 + delta),
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
    if (reduceMotion) settleCalendar(viewport);
  }

  function makeCalendar(data) {
    const section = document.createElement('section');
    section.className = 'schedule-agent-section schedule-agent-calendar';
    section.setAttribute('aria-busy', String(state.calendarLoading));
    const head = document.createElement('div');
    head.className = 'schedule-agent-calendar-head';
    const centerWeek = data.calendar?.[1];
    const heading = document.createElement('h3');
    heading.textContent = weekRangeLabel(centerWeek);
    const controls = document.createElement('div');
    controls.className = 'schedule-agent-calendar-actions';
    const previous = button('이전', () => scrollCalendar(-1));
    const today = button('오늘', () => loadCalendarCenter(data.currentWeekStart));
    const next = button('다음', () => scrollCalendar(1));
    previous.classList.add('schedule-agent-calendar-action');
    today.classList.add('schedule-agent-calendar-action');
    next.classList.add('schedule-agent-calendar-action');
    today.disabled = data.calendarCenter === data.currentWeekStart;
    controls.append(previous, today, next);
    head.append(heading, controls);

    const viewport = document.createElement('div');
    viewport.className = 'schedule-agent-calendar-viewport';
    viewport.setAttribute('aria-label', '주간 일정 날짜');
    viewport.tabIndex = 0;
    const track = document.createElement('div');
    track.className = 'schedule-agent-calendar-track';
    (data.calendar || []).slice(0, 3).forEach(week => track.appendChild(makeWeekPage(week)));
    viewport.appendChild(track);
    viewport.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        scrollCalendar(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        scrollCalendar(1);
      }
    });
    section.append(head, viewport);
    requestAnimationFrame(() => {
      if (!viewport.isConnected) return;
      viewport.scrollLeft = viewport.clientWidth;
      requestAnimationFrame(() => {
        if (viewport.isConnected) {
          viewport.addEventListener('scroll', () => settleCalendar(viewport), { passive: true });
        }
      });
    });
    return section;
  }

  function makeCounts(counts = {}) {
    const list = document.createElement('dl');
    list.className = 'schedule-agent-counts';
    countLabels.forEach(([key, label]) => {
      const item = document.createElement('div');
      const term = document.createElement('dt');
      term.textContent = label;
      const value = document.createElement('dd');
      value.textContent = String(Number(counts[key]) || 0);
      item.append(term, value);
      list.appendChild(item);
    });
    return list;
  }

  function makePreview(items) {
    const section = document.createElement('section');
    section.className = 'schedule-agent-section schedule-agent-preview';
    const heading = document.createElement('h3');
    heading.textContent = '오늘과 지연';
    section.appendChild(heading);
    const tasks = Array.isArray(items) ? items.slice(0, 3) : [];
    if (tasks.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'schedule-agent-muted';
      empty.textContent = '지금 확인할 마감 일정 없음';
      section.appendChild(empty);
      return section;
    }
    const list = document.createElement('ul');
    tasks.forEach(task => {
      const item = document.createElement('li');
      const bucket = document.createElement('span');
      bucket.className = `schedule-agent-bucket ${task.bucket || ''}`;
      bucket.textContent = task.bucket === 'overdue' ? '지연' : '오늘';
      const title = document.createElement('strong');
      title.textContent = task.title || '제목 없는 일정';
      item.append(bucket, title);
      list.appendChild(item);
    });
    section.appendChild(list);
    return section;
  }

  function makeNextReminder(item) {
    const section = document.createElement('section');
    section.className = 'schedule-agent-next';
    const label = document.createElement('span');
    label.textContent = '다음 알림';
    const value = document.createElement('strong');
    value.textContent = item
      ? `${formatDateTime(item.remindAt)} · ${item.title || '제목 없는 일정'}`
      : '예정 없음';
    section.append(label, value);
    return section;
  }

  function makeReminderSection(items, limit = Infinity) {
    const section = document.createElement('section');
    section.className = 'schedule-agent-reminders';
    const heading = document.createElement('h3');
    heading.textContent = `확인할 알림 ${items.length}`;
    section.appendChild(heading);
    items.slice(0, limit).forEach(item => section.appendChild(global.TaskPanel.makeReminderCard(item)));
    if (items.length > limit) {
      const more = button('알림 모두 보기', () => openTasks({ view: 'today', focusReminders: true }));
      more.classList.add('schedule-agent-reminder-more');
      section.appendChild(more);
    }
    return section;
  }

  function renderSummary() {
    const data = state.summary;
    if (!data) return;
    state.container.replaceChildren();
    const block = document.createElement('section');
    block.className = 'schedule-agent-block';
    block.appendChild(makeHeader());
    if (state.reminders.length > 0) block.appendChild(makeReminderSection(state.reminders, 3));

    const counts = data.counts || {};
    const total = countLabels.reduce((sum, [key]) => sum + (Number(counts[key]) || 0), 0);
    if (total === 0) {
      const empty = document.createElement('div');
      empty.className = 'schedule-agent-empty';
      const title = document.createElement('strong');
      title.textContent = '등록된 일정 없음';
      const description = document.createElement('p');
      description.textContent = '기억해둘 약속이나 할 일을 바로 추가할 수 있어.';
      empty.append(title, description);
      block.appendChild(empty);
    }
    block.appendChild(makeCalendar(data));
    if (total > 0) block.append(makeCounts(counts), makePreview(data.preview), makeNextReminder(data.nextReminder));

    const actions = document.createElement('div');
    actions.className = 'schedule-agent-actions';
    actions.append(
      button('일정 추가', () => openTasks({ compose: true, initialTitle: '' }), true),
      button('전체 일정', () => openTasks({ view: 'today' })),
    );
    block.appendChild(actions);
    state.container.appendChild(block);
  }

  async function loadAgentData() {
    const requestId = ++state.requestId;
    const query = state.summary?.calendarCenter
      ? `?calendarCenter=${encodeURIComponent(state.summary.calendarCenter)}`
      : '';
    const [summaryResponse, notificationResponse, pushState] = await Promise.all([
      state.apiFetch(`/api/tasks/summary${query}`),
      state.apiFetch('/api/notifications'),
      state.pushClient.refresh(),
    ]);
    const [summary, notifications] = await Promise.all([
      summaryResponse.json().catch(() => ({})),
      notificationResponse.json().catch(() => ({})),
    ]);
    if (requestId !== state.requestId) return false;
    if (!summaryResponse.ok) throw new Error(summary.error || '일정 요약을 불러오지 못했습니다.');
    if (!notificationResponse.ok) throw new Error(notifications.error || '일정 알림을 불러오지 못했습니다.');
    state.summary = summary;
    state.reminders = (Array.isArray(notifications.notifications) ? notifications.notifications : [])
      .filter(item => item.type === 'task_reminder');
    state.pushState = pushState;
    return true;
  }

  function renderWorkspaceReminders(errorMessage = '') {
    const host = document.getElementById('agent-task-reminders');
    if (!host) return;
    host.replaceChildren();
    if (errorMessage) {
      host.hidden = false;
      host.appendChild((() => {
        const empty = document.createElement('div');
        empty.className = 'notification-empty danger';
        empty.textContent = errorMessage;
        return empty;
      })());
      return;
    }
    if (state.reminders.length === 0) {
      host.hidden = !state.focusReminders;
      if (state.focusReminders) {
        const empty = document.createElement('div');
        empty.className = 'notification-empty';
        empty.textContent = '확인할 새 일정 알림이 없습니다.';
        host.appendChild(empty);
      }
      return;
    }
    host.hidden = false;
    host.appendChild(makeReminderSection(state.reminders));
  }

  function renderTaskWorkspace() {
    state.container.replaceChildren();
    const workspace = document.createElement('section');
    workspace.className = 'schedule-agent-workspace';
    const head = document.createElement('div');
    head.className = 'schedule-agent-workspace-head';
    const back = button('요약', openSummary);
    back.classList.add('schedule-agent-back');
    const title = document.createElement('strong');
    title.textContent = '일정 관리';
    head.append(back, title);
    const reminders = document.createElement('div');
    reminders.id = 'agent-task-reminders';
    const taskContent = document.createElement('div');
    taskContent.id = 'agent-task-content';
    workspace.append(head, reminders, taskContent);
    state.container.appendChild(workspace);
    renderWorkspaceReminders();
    global.TaskPanel.render(taskContent, state.taskOptions);
  }

  async function openTasks(options = {}) {
    if (!state.initialized || !state.enabled) return;
    state.mode = 'tasks';
    state.taskOptions = options.compose
      ? { compose: true, initialTitle: options.initialTitle || '' }
      : { view: options.view || 'today' };
    state.focusReminders = options.focusReminders === true;
    renderTaskWorkspace();
    try {
      if (await loadAgentData()) renderWorkspaceReminders();
    } catch (error) {
      renderWorkspaceReminders(error.message);
    }
  }

  function openSummary() {
    state.mode = 'summary';
    state.focusReminders = false;
    refresh();
  }

  async function refresh() {
    if (!state.initialized || !state.enabled) return;
    if (state.mode === 'summary') renderLoading();
    try {
      if (!await loadAgentData()) return;
      if (state.mode === 'summary') renderSummary();
      else {
        renderWorkspaceReminders();
        await global.TaskPanel.refresh();
      }
    } catch (error) {
      if (state.mode === 'summary') renderError(error.message);
      else renderWorkspaceReminders(error.message);
    }
  }

  function show() {
    if (!state.initialized) return;
    if (!state.enabled) {
      renderUnavailable();
      return;
    }
    refresh();
  }

  function init({ apiFetch, enabled, pushClient, showToast }) {
    if (state.initialized) return;
    const container = document.getElementById('agent-panel-content');
    if (
      typeof apiFetch !== 'function'
      || typeof pushClient?.refresh !== 'function'
      || typeof pushClient?.enable !== 'function'
      || typeof showToast !== 'function'
      || typeof global.TaskPanel?.render !== 'function'
      || typeof global.TaskPanel?.refresh !== 'function'
      || typeof global.TaskPanel?.makeReminderCard !== 'function'
      || !container
    ) {
      throw new TypeError('AgentPanel 초기화 인자가 올바르지 않습니다.');
    }
    state.apiFetch = apiFetch;
    state.enabled = enabled === true;
    state.pushClient = pushClient;
    state.pushState = pushClient.getState();
    state.showToast = showToast;
    state.container = container;
    state.initialized = true;
    if (!state.enabled) renderUnavailable();
  }

  global.AgentPanel = { init, show, refresh, openTasks };
})(window);
