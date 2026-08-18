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
    scheduleError: '',
    codex: null,
    codexError: '',
    codexSaving: false,
    organize: null,
    organizeRunning: false,
    mail: null,
    mailError: '',
    mailRequeueRunning: false,
    mailSettings: null,
    mailSettingsSaving: false,
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

  // 카드 자리를 그대로 잡아둔다. 예전 블록 스켈레톤(390px)을 쓰면 로딩 중에만
  // 화면이 세 배로 길어졌다가 줄어든다.
  function renderLoading() {
    state.container.replaceChildren();
    const cards = document.createElement('div');
    cards.className = 'agent-cards';
    for (let index = 0; index < 3; index += 1) {
      const skeleton = document.createElement('div');
      skeleton.className = 'agent-card schedule-agent-skeleton';
      skeleton.setAttribute('aria-label', '에이전트 상태를 불러오는 중');
      skeleton.innerHTML = '<span></span><span></span>';
      cards.appendChild(skeleton);
    }
    state.container.appendChild(cards);
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

  function makeCodexSelect(labelText, value, models, name) {
    const field = document.createElement('label');
    field.className = 'codex-model-field';
    const label = document.createElement('span');
    label.textContent = labelText;
    const select = document.createElement('select');
    select.name = name;
    select.disabled = state.codexSaving || models.length === 0;
    const options = [...models];
    if (value && !options.some(model => model.id === value)) {
      options.unshift({ id: value, displayName: value, unavailable: true });
    }
    options.forEach(model => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = `${model.displayName || model.id}${model.unavailable ? ' · 현재 목록 없음' : ''}`;
      option.selected = model.id === value;
      select.appendChild(option);
    });
    field.append(label, select);
    return field;
  }

  async function saveCodexModels(block) {
    if (!state.codex || state.codexSaving) return;
    const general = block.querySelector('select[name="generalModel"]')?.value;
    const deep = block.querySelector('select[name="deepModel"]')?.value;
    if (!general || !deep) return;
    state.codexSaving = true;
    renderCodexDetail();
    try {
      const response = await state.apiFetch('/api/settings/codex-models', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': `"${state.codex.settings.general.version}"`,
        },
        body: JSON.stringify({
          generalModel: general,
          deepModel: deep,
          deepVersion: state.codex.settings.deep.version,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Codex 모델을 저장하지 못했습니다.');
      state.codex = data;
      state.codexError = '';
      state.showToast('다음 Codex 작업부터 새 모델을 쓸게');
    } catch (error) {
      state.codexError = error.message;
      state.showToast(error.message);
      await loadCodexData().catch(() => {});
    } finally {
      state.codexSaving = false;
      renderCodexDetail();
    }
  }

  async function refreshCodexCatalog() {
    if (state.codexSaving) return;
    state.codexSaving = true;
    renderCodexDetail();
    try {
      const response = await state.apiFetch('/api/models/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surface: 'codex' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.code || 'Codex 모델 목록 갱신에 실패했습니다.');
      await loadCodexData();
      state.codexError = '';
      state.showToast('Codex 모델 목록을 갱신했어');
    } catch (error) {
      state.codexError = error.message;
      state.showToast(error.message);
    } finally {
      state.codexSaving = false;
      renderCodexDetail();
    }
  }

  function makeCodexBlock() {
    const block = document.createElement('section');
    block.className = 'codex-agent-block';
    const head = document.createElement('div');
    head.className = 'schedule-agent-head';
    const title = document.createElement('div');
    const kicker = document.createElement('span');
    kicker.className = 'schedule-agent-kicker';
    kicker.textContent = 'CODEX LIBRARIAN';
    const heading = document.createElement('h2');
    heading.textContent = '사서 Codex';
    title.append(kicker, heading);
    const status = document.createElement('span');
    status.className = 'schedule-agent-status';
    status.textContent = state.codex?.runner?.ok ? 'CLI 정상' : 'CLI 확인 필요';
    status.classList.toggle('danger', state.codex?.runner?.ok !== true);
    head.append(title, status);

    const description = document.createElement('p');
    description.className = 'codex-agent-description';
    description.textContent = '노트 정리와 연결을 담당해. 변경은 실행 중 작업이 아니라 다음 작업부터 적용돼.';
    block.append(head, description);

    if (!state.codex) {
      const error = document.createElement('p');
      error.className = 'codex-agent-message danger';
      error.textContent = state.codexError || 'Codex 모델 목록을 불러오지 못했습니다.';
      block.appendChild(error);
      const retry = button('다시 시도', refresh);
      retry.classList.add('codex-agent-retry');
      block.appendChild(retry);
      return block;
    }

    const models = Array.isArray(state.codex.models) ? state.codex.models : [];
    const fields = document.createElement('div');
    fields.className = 'codex-model-fields';
    fields.append(
      makeCodexSelect('일반 정리 모델', state.codex.settings.general.value, models, 'generalModel'),
      makeCodexSelect('깊은 재정리 모델', state.codex.settings.deep.value, models, 'deepModel'),
    );
    block.appendChild(fields);

    const message = document.createElement('p');
    message.className = 'codex-agent-message';
    if (state.codexError) {
      message.textContent = state.codexError;
      message.classList.add('danger');
    } else if (state.codex.catalog?.status === 'stale') {
      message.textContent = '목록 갱신에 실패해 마지막 정상 목록을 사용 중이야.';
      message.classList.add('warn');
    } else if (models.length === 0) {
      message.textContent = '모델 목록을 먼저 갱신해줘.';
      message.classList.add('warn');
    } else {
      message.textContent = `${models.length}개 모델 · 선택한 정확한 ID를 유지해.`;
    }
    block.appendChild(message);

    const queueable = Number(state.organize?.queueable) || 0;
    const stranded = Number(state.organize?.stranded) || 0;
    const waitingJobs = Number(state.organize?.waitingJobs) || 0;
    const stalled = (state.organize?.stalledNotes || []).length;
    const canOrganize = queueable > 0 || waitingJobs > 0;
    if (state.organize) {
      const queue = document.createElement('p');
      queue.className = 'codex-agent-message';
      const parts = [];
      // 밀려 있는 job이 먼저다. 실패 뒤 멈춰 있어 새 저장이 있어야 다시 도는 상태다.
      if (stalled > 0) parts.push(`멈춘 노트 ${stalled}개`);
      if (waitingJobs > 0) parts.push(`밀려 있는 정리 ${waitingJobs}건`);
      if (queueable > 0) {
        parts.push(stranded > 0
          ? `대기 노트 ${queueable}개(그중 ${stranded}개는 지난 실패로 멈춤)`
          : `대기 노트 ${queueable}개 · 자동 시작은 ${state.organize.autoQueueThreshold}개부터`);
      }
      queue.textContent = parts.length > 0 ? parts.join(' · ') : '정리 대기 중인 노트 없음';
      if (waitingJobs > 0 || stranded > 0 || stalled > 0) queue.classList.add('warn');
      block.appendChild(queue);
    }

    const actions = document.createElement('div');
    actions.className = 'codex-agent-actions';
    const refreshButton = button('목록 갱신', refreshCodexCatalog);
    const organizeButton = button(
      state.organizeRunning ? '시작하는 중…' : '대기열 정리',
      organizeQueuedNotes,
    );
    const saveButton = button(state.codexSaving ? '저장 중…' : '변경 저장', () => saveCodexModels(block), true);
    refreshButton.disabled = state.codexSaving;
    organizeButton.disabled = state.organizeRunning || state.codexSaving || !canOrganize;
    saveButton.disabled = state.codexSaving || models.length === 0;
    if (stalled > 0) {
      const retryButton = button(
        state.organizeRunning ? '시작하는 중…' : `멈춘 ${stalled}개 다시`,
        retryStalledNotes,
      );
      retryButton.disabled = state.organizeRunning || state.codexSaving;
      actions.append(refreshButton, organizeButton, retryButton, saveButton);
    } else {
      actions.append(refreshButton, organizeButton, saveButton);
    }
    block.appendChild(actions);
    return block;
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
      if (state.mode !== 'schedule') return;
      state.summary = data;
      state.calendarLoading = false;
      renderScheduleDetail();
    } catch (error) {
      state.showToast(error.message);
      state.calendarLoading = false;
      if (state.mode === 'schedule') renderScheduleDetail();
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
    head.appendChild(heading);

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

  function makeScheduleBlock(data) {
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
    return block;
  }

  // 카드 하나. 데이터를 인자로 받아 DOM만 돌려준다. 패널 바깥(V6 등)에서 그대로
  // 가져다 쓸 수 있게 전역 state를 읽지 않는다.
  //
  // 카드 전체가 button 하나다. 안에 또 버튼을 넣으면 중첩이 되고 모바일 타깃도 잘게
  // 쪼개지므로, 복구 버튼은 카드가 아니라 상세 화면에 둔다. 개입이 필요한 상태는
  // 카드에서 상태점과 문구로만 알린다.
  function makeAgentCard({ title, tone = 'ok', status, metric, detail, onOpen, ariaLabel }) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'agent-card';
    if (ariaLabel) card.setAttribute('aria-label', ariaLabel);
    card.addEventListener('click', onOpen);

    const head = document.createElement('span');
    head.className = 'agent-card-head';
    const heading = document.createElement('span');
    heading.className = 'agent-card-title';
    heading.textContent = title;
    const statusWrap = document.createElement('span');
    statusWrap.className = 'schedule-agent-status agent-card-status';
    const dot = document.createElement('span');
    dot.className = `agent-card-dot ${tone}`;
    const statusText = document.createElement('span');
    statusText.textContent = status;
    statusWrap.append(dot, statusText);
    head.append(heading, statusWrap);
    card.appendChild(head);

    const metricLine = document.createElement('span');
    metricLine.className = 'agent-card-metric';
    metricLine.textContent = metric;
    card.appendChild(metricLine);

    if (detail) {
      const detailLine = document.createElement('span');
      detailLine.className = 'agent-card-detail';
      detailLine.textContent = detail;
      card.appendChild(detailLine);
    }
    return card;
  }

  function makeScheduleCard() {
    if (!state.enabled) {
      return makeAgentCard({
        title: '일정',
        tone: 'off',
        status: '꺼짐',
        metric: '일정 기능이 꺼져 있어',
        onOpen: () => {},
      });
    }
    if (state.scheduleError || !state.summary) {
      return makeAgentCard({
        title: '일정',
        tone: 'danger',
        status: '오류',
        metric: state.scheduleError || '일정 요약을 불러오지 못했어',
        detail: '눌러서 다시 시도',
        onOpen: refresh,
      });
    }
    const counts = state.summary.counts || {};
    const overdue = Number(counts.overdue) || 0;
    const next = state.summary.nextReminder;
    return makeAgentCard({
      title: '일정',
      tone: overdue > 0 ? 'warn' : 'ok',
      status: overdue > 0 ? `지연 ${overdue}` : '정상',
      metric: `오늘 ${Number(counts.today) || 0} · 지연 ${overdue} · 예정 ${Number(counts.upcoming) || 0}`,
      detail: next
        ? `다음 알림 ${formatDateTime(next.remindAt)} · ${next.title || '제목 없는 일정'}`
        : '예정된 알림 없음',
      onOpen: openSchedule,
      ariaLabel: '일정 에이전트 열기',
    });
  }

  function makeMailCard() {
    if (state.mail?.disabled) {
      return makeAgentCard({
        title: 'Mail',
        tone: 'off',
        status: '꺼짐',
        metric: 'MAIL_AGENT_ENABLED가 꺼져 있어',
        onOpen: openMail,
        ariaLabel: 'Mail 에이전트 열기',
      });
    }
    if (state.mailError || !state.mail) {
      return makeAgentCard({
        title: 'Mail',
        tone: 'danger',
        status: '오류',
        metric: state.mailError || 'Mail 상태를 불러오지 못했어',
        detail: '눌러서 다시 시도',
        onOpen: refresh,
      });
    }
    const accounts = Array.isArray(state.mail.accounts) ? state.mail.accounts : [];
    const analysis = state.mail.analysis || {};
    const stranded = Number(analysis.failed) || 0;
    // 재인증은 사람이 직접 해야 풀린다. 분석 좌초보다 먼저 알린다.
    const authRequired = accounts.filter(account => account.status === 'auth_required');
    const broken = accounts.filter(account => account.status === 'error' || account.status === 'disabled');
    let tone = 'ok';
    let status = accounts.length ? '정상' : '계정 없음';
    if (authRequired.length) { tone = 'danger'; status = '재인증 필요'; }
    else if (broken.length) { tone = 'danger'; status = '오류'; }
    else if (stranded > 0) { tone = 'warn'; status = `멈춤 ${stranded}`; }
    else if (!accounts.length) tone = 'off';
    return makeAgentCard({
      title: 'Mail',
      tone,
      status,
      metric: accounts.length
        ? accounts.map(account => `${account.provider === 'gmail' ? 'Gmail' : 'Naver'} ${account.status === 'active' ? '●' : '○'}`).join(' · ')
        : '등록된 계정 없음',
      detail: `분석 대기 ${Number(analysis.pending) || 0}${stranded > 0 ? ` · 멈춤 ${stranded}` : ''}`,
      onOpen: openMail,
      ariaLabel: 'Mail 에이전트 열기',
    });
  }

  function makeCodexCard() {
    if (!state.organize) {
      return makeAgentCard({
        title: '사서 Codex',
        tone: 'danger',
        status: '오류',
        metric: state.codexError || 'Codex 상태를 불러오지 못했어',
        detail: '눌러서 다시 시도',
        onOpen: refresh,
      });
    }
    const queueable = Number(state.organize.queueable) || 0;
    const stalled = (state.organize.stalledNotes || []).length;
    const recovery = Number(state.organize.recoveryRequired) || 0;
    // runner는 organize/status에도 들어 있다. 카드 때문에 모델 카탈로그까지
    // 부르지 않는다. 그것은 상세에서만 필요하다.
    const runnerOk = state.organize.runner?.ok === true;
    let tone = 'ok';
    let status = 'CLI 정상';
    // 복구 필요는 원본이 위태로운 상태라 fail-close로 정리 전체가 멈춘다. 제일 위다.
    if (recovery > 0) { tone = 'danger'; status = `복구 필요 ${recovery}`; }
    else if (!runnerOk) { tone = 'danger'; status = 'CLI 확인 필요'; }
    else if (stalled > 0) { tone = 'warn'; status = `멈춤 ${stalled}`; }
    return makeAgentCard({
      title: '사서 Codex',
      tone,
      status,
      metric: `대기 ${queueable} · 멈춤 ${stalled}`,
      detail: state.codexError || '모델 설정과 대기열 정리',
      onOpen: openCodex,
      ariaLabel: '사서 Codex 열기',
    });
  }

  // 첫 화면은 카드만 세운다. 상세 데이터는 카드를 눌렀을 때 그 화면이 쓴다 .
  // 에이전트가 늘어도 여는 비용이 카드 수만큼만 는다.
  function renderSummary() {
    state.container.replaceChildren();
    const cards = document.createElement('div');
    cards.className = 'agent-cards';
    cards.append(makeScheduleCard(), makeMailCard(), makeCodexCard());
    state.container.appendChild(cards);
  }

  // 사용자가 만지는 값은 둘뿐이다. 잠금화면 미리보기 설정은 없앴다. 그 설정이
  // 있으면 서버에 민감 내용을 payload에 넣는 분기가 존재하게 된다(설계 13.1).
  function makeMailSettings() {
    const section = document.createElement('section');
    section.className = 'schedule-agent-section';
    const heading = document.createElement('h3');
    heading.textContent = '알림';
    section.appendChild(heading);

    if (!state.mailSettings) {
      const message = document.createElement('p');
      message.className = 'codex-agent-message';
      message.textContent = '설정을 불러오지 못했어.';
      section.appendChild(message);
      return section;
    }

    const { notificationsEnabled, quietHours } = state.mailSettings;
    const summary = document.createElement('p');
    summary.className = 'codex-agent-message';
    summary.textContent = notificationsEnabled
      ? `Push 켜짐 · 방해 금지 ${quietHours.enabled ? `${quietHours.start}~${quietHours.end}` : '꺼짐'}`
      : 'Push 꺼짐 · 판단과 Attention은 그대로 쌓여';
    section.appendChild(summary);

    const actions = document.createElement('div');
    actions.className = 'codex-agent-actions';
    const togglePush = button(
      notificationsEnabled ? 'Push 끄기' : 'Push 켜기',
      () => saveMailSettings({ notificationsEnabled: !notificationsEnabled }),
    );
    const toggleQuiet = button(
      quietHours.enabled ? '방해 금지 끄기' : '방해 금지 켜기',
      () => saveMailSettings({ quietHours: { ...quietHours, enabled: !quietHours.enabled } }),
    );
    togglePush.disabled = state.mailSettingsSaving;
    toggleQuiet.disabled = state.mailSettingsSaving;
    actions.append(togglePush, toggleQuiet);
    section.appendChild(actions);
    return section;
  }

  function makeDetailHead(titleText, ariaLabel) {
    const head = document.createElement('div');
    head.className = 'schedule-agent-workspace-head';
    const back = button('<', openSummary);
    back.classList.add('schedule-agent-back');
    back.setAttribute('aria-label', ariaLabel);
    back.title = ariaLabel;
    const title = document.createElement('strong');
    title.textContent = titleText;
    head.append(back, title);
    return head;
  }

  // 달력·counts·미리보기는 통째로 일정 상세가 된다. 요약에서 내려온 것이지 새로
  // 만든 화면이 아니다. `일정 추가`·`전체 일정` 버튼도 그대로 붙어 있다.
  function renderScheduleDetail() {
    state.container.replaceChildren();
    const workspace = document.createElement('section');
    workspace.className = 'schedule-agent-workspace';
    workspace.appendChild(makeDetailHead('일정 에이전트', '에이전트 요약으로 돌아가기'));
    if (!state.enabled) {
      const message = document.createElement('p');
      message.className = 'codex-agent-message warn';
      message.textContent = '일정 기능이 꺼져 있어.';
      workspace.appendChild(message);
    } else if (state.scheduleError || !state.summary) {
      const message = document.createElement('p');
      message.className = 'codex-agent-message danger';
      message.textContent = state.scheduleError || '일정 요약을 불러오지 못했습니다.';
      const retry = button('다시 시도', refresh);
      retry.classList.add('codex-agent-retry');
      workspace.append(message, retry);
    } else {
      workspace.appendChild(makeScheduleBlock(state.summary));
    }
    state.container.appendChild(workspace);
  }

  function renderCodexDetail() {
    state.container.replaceChildren();
    const workspace = document.createElement('section');
    workspace.className = 'schedule-agent-workspace';
    workspace.append(makeDetailHead('사서 Codex', '에이전트 요약으로 돌아가기'), makeCodexBlock());
    state.container.appendChild(workspace);
  }

  function renderMailDetail() {
    state.container.replaceChildren();
    const workspace = document.createElement('section');
    workspace.className = 'schedule-agent-workspace';
    workspace.append(makeDetailHead('Mail 에이전트', '에이전트 요약으로 돌아가기'), makeMailBlock());
    state.container.appendChild(workspace);
  }

  // 운영과 복구만 둔다. 사용자가 실제로 처리할 Attention은 알림 탭의 몫이고
  // 여기에 두 번째 받은편지함을 만들지 않는다(설계 23절).
  function makeMailBlock() {
    const block = document.createElement('section');
    block.className = 'codex-agent-block';
    const description = document.createElement('p');
    description.className = 'codex-agent-description';
    description.textContent = '메일 동기화와 분석 상태야. 확인할 메일 자체는 알림 탭에 있어.';
    block.appendChild(description);

    if (state.mail?.disabled) {
      const message = document.createElement('p');
      message.className = 'codex-agent-message warn';
      message.textContent = 'MAIL_AGENT_ENABLED가 꺼져 있어 동기화와 분석이 돌지 않아.';
      block.appendChild(message);
      return block;
    }
    if (state.mailError || !state.mail) {
      const message = document.createElement('p');
      message.className = 'codex-agent-message danger';
      message.textContent = state.mailError || 'Mail 상태를 불러오지 못했습니다.';
      const retry = button('다시 시도', refresh);
      retry.classList.add('codex-agent-retry');
      block.append(message, retry);
      return block;
    }

    const accounts = Array.isArray(state.mail.accounts) ? state.mail.accounts : [];
    if (accounts.length === 0) {
      const message = document.createElement('p');
      message.className = 'codex-agent-message warn';
      message.textContent = '등록된 계정이 없어. scripts/register-mail-account.js로 등록해줘.';
      block.appendChild(message);
    }
    accounts.forEach(account => {
      const line = document.createElement('p');
      line.className = 'codex-agent-message';
      const label = account.provider === 'gmail' ? 'Gmail' : 'Naver';
      const parts = [`${label} ${account.address}`, account.status];
      if (account.lastSyncAt) parts.push(`마지막 동기화 ${formatDateTime(account.lastSyncAt)}`);
      if (account.lastErrorCode) parts.push(account.lastErrorCode);
      parts.push(`메시지 ${account.messages}`);
      line.textContent = parts.join(' · ');
      if (account.status !== 'active') line.classList.add(account.status === 'auth_required' ? 'danger' : 'warn');
      block.appendChild(line);
    });

    const analysis = state.mail.analysis || {};
    const failed = Number(analysis.failed) || 0;
    const queue = document.createElement('p');
    queue.className = 'codex-agent-message';
    queue.textContent = `분석 대기 ${Number(analysis.pending) || 0} · 진행 ${Number(analysis.analyzing) || 0}`
      + ` · 완료 ${Number(analysis.done) || 0} · 멈춤 ${failed} · 건너뜀 ${Number(analysis.skipped) || 0}`;
    if (failed > 0) queue.classList.add('warn');
    block.appendChild(queue);

    block.appendChild(makeMailSettings());

    // 좌초한 분석은 열어봐야 고칠 것이 없다. 사람이 할 수 있는 일은 다시 돌리는 것뿐이라
    // 사유 코드까지만 보여주고 제목·발신자는 싣지 않는다(설계 19절).
    if (failed > 0) {
      const actions = document.createElement('div');
      actions.className = 'codex-agent-actions';
      const requeue = button(
        state.mailRequeueRunning ? '되돌리는 중…' : `멈춘 ${failed}개 다시`,
        requeueMailAnalysis,
        true,
      );
      requeue.disabled = state.mailRequeueRunning;
      actions.appendChild(requeue);
      block.appendChild(actions);
    }
    return block;
  }

  async function loadCodexData() {
    const [modelResponse, organizeResponse] = await Promise.all([
      state.apiFetch('/api/models/codex'),
      state.apiFetch('/api/organize/status'),
    ]);
    const data = await modelResponse.json().catch(() => ({}));
    if (!modelResponse.ok) throw new Error(data.error || 'Codex 모델 목록을 불러오지 못했습니다.');
    state.codex = data;
    // 정리 대기 상태를 못 읽어도 모델 설정은 계속 쓸 수 있어야 한다.
    state.organize = organizeResponse.ok
      ? await organizeResponse.json().catch(() => null)
      : null;
    return true;
  }

  // 대기열에 남은 노트를 자동 큐 문턱과 무관하게 지금 돌린다. 재시도 가능한 실패로
  // `queued`에 갇힌 노트가 다시 job에 들어가는 유일한 사용자 경로다.
  // 같은 이유로 여러 개가 한꺼번에 멈추는 일이 흔하다. 하나씩 누르지 않아도 되게 한다.
  async function retryStalledNotes() {
    if (state.organizeRunning) return;
    state.organizeRunning = true;
    renderCodexDetail();
    try {
      const response = await state.apiFetch('/api/organize/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '재정리를 시작하지 못했습니다.');
      state.showToast(data.retried > 0 ? `멈춘 노트 ${data.retried}개를 다시 정리해` : '다시 정리할 노트가 없어');
      state.codexError = '';
    } catch (error) {
      state.codexError = error.message;
      state.showToast(error.message);
    } finally {
      state.organizeRunning = false;
      await refresh();
    }
  }

  async function organizeQueuedNotes() {
    if (state.organizeRunning) return;
    state.organizeRunning = true;
    renderCodexDetail();
    try {
      const response = await state.apiFetch('/api/organize/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '정리를 시작하지 못했습니다.');
      state.showToast(data.created
        ? `노트 ${data.notes?.length || 0}개 정리를 시작했어`
        : data.resumed
          ? '밀려 있던 정리를 다시 시작했어'
          : '정리할 노트가 없어');
      state.codexError = '';
    } catch (error) {
      state.codexError = error.message;
      state.showToast(error.message);
    } finally {
      state.organizeRunning = false;
      await refresh();
    }
  }

  // 카드에 필요한 것만 읽는다. 요약 화면이 세 에이전트의 상세 데이터를 전부 끌어오면
  // 에이전트가 늘 때마다 여는 비용이 그만큼 는다.
  async function loadScheduleSummary() {
    const requestId = ++state.requestId;
    const query = state.summary?.calendarCenter
      ? `?calendarCenter=${encodeURIComponent(state.summary.calendarCenter)}`
      : '';
    const response = await state.apiFetch(`/api/tasks/summary${query}`);
    const summary = await response.json().catch(() => ({}));
    if (requestId !== state.requestId) return false;
    if (!response.ok) throw new Error(summary.error || '일정 요약을 불러오지 못했습니다.');
    state.summary = summary;
    return true;
  }

  async function loadCodexStatus() {
    const response = await state.apiFetch('/api/organize/status');
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Codex 상태를 불러오지 못했습니다.');
    state.organize = data;
    return true;
  }

  // 플래그가 꺼진 것은 오류가 아니다. 503을 실패로 다루면 카드가 빨갛게 뜨고
  // 사람이 고칠 것이 없는데 고치려 들게 된다.
  async function loadMailData() {
    const response = await state.apiFetch('/api/mail/status');
    const data = await response.json().catch(() => ({}));
    if (response.status === 503 && data.code === 'MAIL_AGENT_DISABLED') {
      state.mail = { disabled: true };
      return true;
    }
    if (!response.ok) throw new Error(data.error || 'Mail 상태를 불러오지 못했습니다.');
    state.mail = data;
    return true;
  }

  async function loadMailSettings() {
    const response = await state.apiFetch('/api/mail/settings');
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return false;
    state.mailSettings = data.settings || null;
    return true;
  }

  async function saveMailSettings(patch) {
    if (state.mailSettingsSaving) return;
    state.mailSettingsSaving = true;
    renderMailDetail();
    try {
      const response = await state.apiFetch('/api/mail/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '설정을 저장하지 못했습니다.');
      state.mailSettings = data.settings;
      state.showToast('알림 설정을 바꿨어');
    } catch (error) {
      state.showToast(error.message);
    } finally {
      state.mailSettingsSaving = false;
      renderMailDetail();
    }
  }

  async function requeueMailAnalysis() {
    if (state.mailRequeueRunning) return;
    state.mailRequeueRunning = true;
    renderMailDetail();
    try {
      const response = await state.apiFetch('/api/mail/analysis/requeue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '분석 대기열을 되돌리지 못했습니다.');
      state.showToast(data.requeued > 0 ? `멈춘 분석 ${data.requeued}개를 다시 넣었어` : '되돌릴 분석이 없어');
      state.mailError = '';
    } catch (error) {
      state.mailError = error.message;
      state.showToast(error.message);
    } finally {
      state.mailRequeueRunning = false;
      await refresh();
    }
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
    const taskContent = document.createElement('div');
    taskContent.id = 'agent-task-content';
    const head = document.createElement('div');
    head.className = 'schedule-agent-workspace-head';
    const back = button('<', openSummary);
    back.classList.add('schedule-agent-back');
    back.setAttribute('aria-label', '일정 요약으로 돌아가기');
    back.title = '일정 요약으로 돌아가기';
    const title = document.createElement('strong');
    title.textContent = '일정 관리';
    const add = button('+', () => global.TaskPanel.render(taskContent, { compose: true }), true);
    add.classList.add('schedule-agent-add');
    add.setAttribute('aria-label', '일정 추가');
    add.title = '일정 추가';
    head.append(back, title, add);
    const reminders = document.createElement('div');
    reminders.id = 'agent-task-reminders';
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

  function openSchedule() {
    state.mode = 'schedule';
    renderScheduleDetail();
    refresh();
  }

  function openCodex() {
    state.mode = 'codex';
    renderCodexDetail();
    refresh();
  }

  function openMail() {
    state.mode = 'mail';
    renderMailDetail();
    refresh();
  }

  async function refresh() {
    if (!state.initialized) return;
    if (state.mode === 'tasks') {
      try {
        if (!state.enabled || !await loadAgentData()) return;
        renderWorkspaceReminders();
        await global.TaskPanel.refresh();
      } catch (error) {
        renderWorkspaceReminders(error.message);
      }
      return;
    }
    // 상세 화면은 자기 데이터만 다시 읽는다. 한 에이전트를 보는 동안 나머지 API를
    // 부를 이유가 없다.
    if (state.mode === 'schedule') {
      const result = await Promise.allSettled([
        state.enabled ? loadAgentData() : Promise.resolve(false),
      ]);
      state.scheduleError = result[0].status === 'rejected' ? result[0].reason.message : '';
      renderScheduleDetail();
      return;
    }
    if (state.mode === 'codex') {
      const result = await Promise.allSettled([loadCodexData()]);
      state.codexError = result[0].status === 'rejected' ? result[0].reason.message : '';
      renderCodexDetail();
      return;
    }
    if (state.mode === 'mail') {
      const [mail] = await Promise.allSettled([loadMailData(), loadMailSettings()]);
      state.mailError = mail.status === 'rejected' ? mail.reason.message : '';
      renderMailDetail();
      return;
    }
    renderLoading();
    // 한 에이전트가 죽어도 나머지 카드는 살아 있어야 한다.
    const [scheduleResult, codexResult, mailResult] = await Promise.allSettled([
      state.enabled ? loadScheduleSummary() : Promise.resolve(false),
      loadCodexStatus(),
      loadMailData(),
    ]);
    state.scheduleError = scheduleResult.status === 'rejected'
      ? scheduleResult.reason.message
      : '';
    state.codexError = codexResult.status === 'rejected'
      ? codexResult.reason.message
      : '';
    state.mailError = mailResult.status === 'rejected'
      ? mailResult.reason.message
      : '';
    renderSummary();
  }

  function show() {
    if (!state.initialized) return;
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
  }

  global.AgentPanel = { init, show, refresh, openTasks };
})(window);
