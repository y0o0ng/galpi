'use strict';

(function setupAgentPanel(global) {
  const state = {
    initialized: false,
    enabled: false,
    apiFetch: null,
    openCreate: null,
    openTasks: null,
    container: null,
    requestId: 0,
  };

  const countLabels = [
    ['overdue', '지연'],
    ['today', '오늘'],
    ['upcoming', '예정'],
    ['inbox', 'Inbox'],
  ];

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
    const [year, month, day] = String(value || '').split('-').map(Number);
    if (!year || !month || !day) return { weekday: '', day: '' };
    const date = new Date(Date.UTC(year, month - 1, day));
    return {
      weekday: new Intl.DateTimeFormat('ko-KR', { weekday: 'narrow', timeZone: 'UTC' }).format(date),
      day: String(day),
    };
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
    state.container.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'panel-empty-state';
    empty.textContent = '준비 중';
    state.container.appendChild(empty);
  }

  function renderLoading() {
    state.container.innerHTML = '';
    const skeleton = document.createElement('div');
    skeleton.className = 'schedule-agent-block schedule-agent-skeleton';
    skeleton.setAttribute('aria-label', '일정 요약을 불러오는 중');
    skeleton.innerHTML = '<span></span><span></span><span></span><span></span>';
    state.container.appendChild(skeleton);
  }

  function renderError(message) {
    state.container.innerHTML = '';
    const block = document.createElement('section');
    block.className = 'schedule-agent-block schedule-agent-error';
    const title = document.createElement('strong');
    title.textContent = '일정 요약을 불러오지 못했습니다.';
    const detail = document.createElement('p');
    detail.textContent = message;
    block.append(title, detail, button('다시 시도', refresh));
    state.container.appendChild(block);
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
    const status = document.createElement('span');
    status.className = 'schedule-agent-status';
    status.textContent = '알림 준비 중';
    header.append(title, status);
    return header;
  }

  function makeWeek(data) {
    const section = document.createElement('section');
    section.className = 'schedule-agent-section';
    const heading = document.createElement('h3');
    heading.textContent = '이번 주';
    const strip = document.createElement('div');
    strip.className = 'schedule-agent-week';
    strip.setAttribute('aria-label', '이번 주 마감 일정 수');
    const week = Array.isArray(data.week) ? data.week.slice(0, 7) : [];
    week.forEach(item => {
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
      strip.appendChild(day);
    });
    section.append(heading, strip);
    if (week.length > 0 && week.every(item => Number(item.count) === 0)) {
      const empty = document.createElement('p');
      empty.className = 'schedule-agent-week-empty';
      empty.textContent = '이번 주 마감 없음';
      section.appendChild(empty);
    }
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

  function renderSummary(data) {
    state.container.innerHTML = '';
    const block = document.createElement('section');
    block.className = 'schedule-agent-block';
    block.append(makeHeader());

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
    } else {
      block.append(makeWeek(data), makeCounts(counts), makePreview(data.preview), makeNextReminder(data.nextReminder));
    }

    const actions = document.createElement('div');
    actions.className = 'schedule-agent-actions';
    actions.append(
      button('일정 추가', state.openCreate, true),
      button('전체 일정', state.openTasks),
    );
    block.appendChild(actions);
    state.container.appendChild(block);
  }

  async function refresh() {
    if (!state.initialized || !state.enabled) return;
    const requestId = ++state.requestId;
    renderLoading();
    try {
      const response = await state.apiFetch('/api/tasks/summary');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '서버 요청에 실패했습니다.');
      if (requestId !== state.requestId) return;
      renderSummary(data);
    } catch (error) {
      if (requestId !== state.requestId) return;
      renderError(error.message);
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

  function init({ apiFetch, enabled, openCreate, openTasks }) {
    if (state.initialized) return;
    const container = document.getElementById('agent-panel-content');
    if (
      typeof apiFetch !== 'function'
      || typeof openCreate !== 'function'
      || typeof openTasks !== 'function'
      || !container
    ) {
      throw new TypeError('AgentPanel 초기화 인자가 올바르지 않습니다.');
    }
    state.apiFetch = apiFetch;
    state.enabled = enabled === true;
    state.openCreate = openCreate;
    state.openTasks = openTasks;
    state.container = container;
    state.initialized = true;
    if (state.enabled) refresh();
    else renderUnavailable();
  }

  global.AgentPanel = { init, show, refresh };
})(window);
