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
    instagramInsights: null,
    instagramInsightsError: '',
    instagramInsightsLoading: false,
    youtubeInsights: null,
    youtubeInsightsError: '',
    youtubeInsightsLoading: false,
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
    attention: [],
    attentionError: '',
    attentionExpanded: false,
    mailPreferences: null,
    mailPreferenceSaving: false,
    news: null,
    reels: null,
    reelsError: '',
    reelsEpisodeError: '',
    reelsRenderedKey: null,
    returnAgent: null,
    cards: null,
    cardJob: null,
    cardMedia: null,
    reelsEpisode: null,
    reelsMedia: null,
    weatherEnabled: false,
    weather: null,
    weatherAt: 0,
  };

  // 첫 화면에 펼치는 Attention 수. 지식 패널이 350px 고정이고 메일 항목 하나가
  // 100px 안팎이라, 세 장을 펼치면 `오늘`이 첫 화면 밖으로 밀린다(설계 8절).
  const HOME_ATTENTION_LIMIT = 2;

  // 뉴스는 `확인할 것`도 `오늘`도 아니다. 후속 행동이 없는 읽을거리라 첫 화면을
  // 차지하면 안 된다(설계 14.4). 그래서 둘 뒤에 오고 개수도 적게 든다.
  const HOME_NEWS_LIMIT = 3;

  // 홈은 60초마다 자동 refresh한다. 캐시가 없으면 기상청을 시간당 60번 부른다.
  // 그래서 이 15분은 선택이 아니다(설계 22절).
  const WEATHER_CACHE_MS = 15 * 60 * 1000;
  // 격자가 5km 단위라 GPS급 정밀도가 필요 없다. 고정밀을 강제로 깨워 전력과
  // 응답 시간을 더 쓰지 않는다(설계 4절).
  const LOCATION_OPTIONS = { enableHighAccuracy: false, timeout: 5000, maximumAge: WEATHER_CACHE_MS };
  // `council` 접두사는 제품명이 갈피로 바뀐 뒤에도 기존 키가 일부러 유지하는
  // 관례다. 날씨만 다른 접두사를 쓰면 저장소에 규칙이 둘이 된다(설계 5절).
  const LOCATION_KEY = 'councilLastLocation';
  // 위치 자체의 보존기간이 아니라 **잘못된 지역 날씨를 자신 있게 보여주지 않기
  // 위한 fallback 제한**이다. 좌표 행은 다음 성공 때까지 그대로 남는다.
  const LOCATION_FALLBACK_MAX_AGE_MS = 6 * 60 * 60 * 1000;

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

  function renderCodexSurface() {
    if (state.mode === 'summary') renderSummary();
    else renderCodexDetail();
  }

  function renderMailSurface() {
    if (state.mode === 'summary') renderSummary();
    else renderMailDetail();
  }

  function renderUnavailable() {
    state.container.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'panel-empty-state';
    empty.textContent = '준비 중';
    state.container.appendChild(empty);
  }

  // 홈 자리를 그대로 잡아둔다. 예전 블록 스켈레톤(390px)을 쓰면 로딩 중에만
  // 화면이 세 배로 길어졌다가 줄어든다.
  function renderLoading() {
    state.container.replaceChildren();
    const skeleton = document.createElement('div');
    skeleton.className = 'home-skeleton schedule-agent-skeleton';
    skeleton.setAttribute('aria-label', '홈을 불러오는 중');
    skeleton.innerHTML = '<span></span><span></span>';
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
    renderCodexSurface();
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
      renderCodexSurface();
    }
  }

  async function refreshCodexCatalog() {
    if (state.codexSaving) return;
    state.codexSaving = true;
    renderCodexSurface();
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
      renderCodexSurface();
    }
  }

  function codexCanRun() {
    return !state.codexError && state.codex?.runner?.ok === true
      && state.organize?.runner?.ok === true && Number(state.organize.recoveryRequired) === 0;
  }

  function detailCard(titleText, ...children) {
    const section = document.createElement('section');
    section.className = 'agent-detail-card';
    const title = document.createElement('h3');
    title.textContent = titleText;
    section.append(title, ...children);
    return section;
  }

  function detailText(text, tone = '') {
    const line = document.createElement('p');
    line.className = `codex-agent-message ${tone}`;
    line.textContent = text;
    return line;
  }

  function detailColumns(left, right) {
    const grid = document.createElement('div');
    grid.className = 'agent-detail-columns';
    for (const cards of [left, right]) {
      const column = document.createElement('div');
      column.className = 'agent-detail-column';
      column.append(...cards);
      grid.appendChild(column);
    }
    return grid;
  }

  function makeCodexBlock() {
    const block = document.createElement('section');
    block.className = 'agent-detail-body codex-detail';
    if (!state.codex) {
      block.appendChild(detailCard('상태 확인 필요', detailText(state.codexError || 'Codex 상태를 불러오지 못했어.', 'danger'), button('다시 시도', refresh)));
      return block;
    }
    const queueable = state.organize?.queueable;
    const waiting = state.organize?.waitingJobs;
    const stalled = state.organize?.stalledNotes?.length;
    const recovery = Number(state.organize?.recoveryRequired) || 0;
    if (!codexCanRun()) block.appendChild(detailCard(recovery ? '원본 수동 복구 필요' : 'CLI와 정리 상태 확인 필요',
      detailText(recovery ? '원본을 복구하기 전에는 정리와 재시도를 실행할 수 없어.' : state.codexError || '정상 상태를 확인한 뒤에 정리를 실행할 수 있어.', 'danger')));
    const metrics = agentMetrics([['정리 대기', queueable], ['진행 대기', waiting], ['멈춘 노트', stalled], ['자동 시작', state.organize?.autoQueueThreshold]]);
    metrics.classList.add('agent-detail-metrics');
    block.appendChild(metrics);
    const organizeButton = button(state.organizeRunning ? '시작하는 중…' : '대기열 정리', organizeQueuedNotes, true);
    organizeButton.disabled = state.organizeRunning || state.codexSaving || !codexCanRun() || !(queueable || waiting);
    const queue = detailCard('정리 대기열');
    if (state.organize) {
      for (const [label, value] of [['대기 중인 노트', `${queueable}개`], ['진행 대기 작업', `${waiting}건`], ['좌초 / 복구 필요', `${state.organize.stranded} / ${recovery}개`]]) {
        const line = detailText(label);
        line.classList.add('agent-queue-line');
        const count = document.createElement('strong');
        count.textContent = value;
        line.appendChild(count);
        queue.appendChild(line);
      }
    } else queue.appendChild(detailText('정리 상태를 불러오지 못했어.'));
    queue.append(organizeButton, button('상태 새로고침', refresh));
    if (stalled > 0) {
      const retry = button(`멈춘 ${stalled}개 다시`, retryStalledNotes);
      retry.disabled = state.organizeRunning || state.codexSaving || !codexCanRun();
      queue.appendChild(retry);
    }
    const catalog = detailCard('CLI와 모델 카탈로그', detailText(state.codex.runner?.ok ? 'CLI 정상' : 'CLI 확인 필요', state.codex.runner?.ok ? '' : 'danger'),
      detailText(state.codex.catalog?.status === 'stale' ? '목록 갱신에 실패해 마지막 정상 목록을 사용 중이야.' : '정확한 모델 ID를 유지해.'), button('목록 갱신', refreshCodexCatalog));
    catalog.querySelector('button').disabled = state.codexSaving;
    const models = Array.isArray(state.codex.models) ? state.codex.models : [];
    const settings = detailCard('사용 모델',
      makeCodexSelect('일반 정리 모델', state.codex.settings.general.value, models, 'generalModel'),
      makeCodexSelect('깊은 재정리 모델', state.codex.settings.deep.value, models, 'deepModel'));
    const save = button(state.codexSaving ? '저장 중…' : '변경 저장', () => saveCodexModels(settings), true);
    save.disabled = state.codexSaving || !models.length || !!state.codexError;
    settings.appendChild(save);
    block.appendChild(detailColumns([queue, catalog], [settings, detailCard('모델 설정 안내', detailText('모델 변경은 다음 작업부터 적용돼.'))]));
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
      if (!viewport.isConnected || state.mode !== 'schedule' || state.calendarLoading) return;
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
    block.className = 'agent-detail-body schedule-detail';
    if (['denied', 'unsupported', 'insecure'].includes(state.pushState.status)) {
      block.appendChild(detailCard('알림 상태 확인 필요', detailText(state.pushState.label, 'warn')));
    }
    if (Number(data.counts?.overdue) > 0) block.appendChild(detailCard('지연된 일정이 있어', detailText(`지연 ${data.counts.overdue}건`, 'warn')));
    const metrics = makeCounts(data.counts);
    metrics.classList.add('agent-detail-metrics');
    block.appendChild(metrics);
    const calendar = detailCard(weekRangeLabel(data.calendar?.[1]), makeCalendar(data));
    const reminders = detailCard(`확인할 알림 ${state.reminders.length}건`, makeReminderSection(state.reminders), makeNextReminder(data.nextReminder));
    const tasks = detailCard('전체 일정', detailText('추가·변경·완료는 기존 일정 관리 화면에서.'),
      button('일정 추가', () => openTasks({ compose: true, initialTitle: '' }), true), button('전체 일정', () => openTasks({ view: 'today' })));
    if (state.pushState.status === 'available') {
      const push = button('알림 켜기', () => enablePush(push));
      tasks.appendChild(push);
    }
    block.appendChild(detailColumns([calendar, reminders], [detailCard('오늘과 지연', makePreview(data.preview)), tasks]));
    return block;
  }

  // 카드 하나. 데이터를 인자로 받아 DOM만 돌려준다. 패널 바깥(V6 등)에서 그대로
  // 가져다 쓸 수 있게 전역 state를 읽지 않는다.
  //
  // 카드 전체가 button 하나다. 안에 또 버튼을 넣으면 중첩이 되고 모바일 타깃도 잘게
  // 쪼개지므로, 복구 버튼은 카드가 아니라 상세 화면에 둔다. 개입이 필요한 상태는
  // 카드에서 상태점과 문구로만 알린다.
  /**
   * 에이전트 한 줄. 홈에서 정상인 에이전트는 이름과 상태까지만 차지한다. 개입이
   * 필요한 상태(warn·danger)일 때만 이유 한 줄을 더 편다(설계 6·7절). 운영 세부값은
   * 상세의 몫이라 여기에 오지 않는다.
   */
  function makeAgentRow({ title, tone = 'ok', status, metric, onOpen, ariaLabel }) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'agent-rail-entry';
    if (ariaLabel) row.setAttribute('aria-label', ariaLabel);
    row.addEventListener('click', () => { state.returnAgent = title; onOpen(); });

    const head = document.createElement('span');
    head.className = 'agent-rail-head';
    const dot = document.createElement('img');
    dot.className = `agent-card-dot ${tone}`;
    dot.src = `assets/figma/agent-status-${['danger', 'warn'].includes(tone) ? tone : 'ok'}.svg`;
    dot.alt = '';
    const heading = document.createElement('span');
    heading.className = 'agent-rail-title';
    heading.textContent = title;
    const statusText = document.createElement('span');
    statusText.className = `agent-rail-status ${tone}`;
    statusText.textContent = status;
    statusText.appendChild(dot);
    head.append(heading, statusText);
    row.appendChild(head);

    return row;
  }

  function makeScheduleRow() {
    if (!state.enabled) {
      return makeAgentRow({
        title: '일정 에이전트',
        tone: 'off',
        status: '꺼짐',
        metric: '일정 기능이 꺼져 있어',
        onOpen: openSchedule,
      });
    }
    if (state.scheduleError || !state.summary) {
      return makeAgentRow({
        title: '일정 에이전트',
        tone: 'danger',
        status: '오류',
        metric: state.scheduleError || '일정 요약을 불러오지 못했어',
        onOpen: openSchedule,
      });
    }
    const counts = state.summary.counts || {};
    const overdue = Number(counts.overdue) || 0;
    const next = state.summary.nextReminder;
    return makeAgentRow({
      title: '일정 에이전트',
      tone: overdue > 0 ? 'warn' : 'ok',
      status: overdue > 0 ? `지연 ${overdue}` : state.pushState.label,
      metric: `오늘 ${Number(counts.today) || 0} · 지연 ${overdue} · 예정 ${Number(counts.upcoming) || 0}`,
      onOpen: openSchedule,
      ariaLabel: '일정 에이전트 열기',
    });
  }

  function makeMailRow() {
    if (state.mail?.disabled) {
      return makeAgentRow({
        title: 'Mail 에이전트',
        tone: 'off',
        status: '꺼짐',
        metric: 'MAIL_AGENT_ENABLED가 꺼져 있어',
        onOpen: openMail,
        ariaLabel: 'Mail 에이전트 열기',
      });
    }
    if (state.mailError || !state.mail) {
      return makeAgentRow({
        title: 'Mail 에이전트',
        tone: 'danger',
        status: '오류',
        metric: state.mailError || 'Mail 상태를 불러오지 못했어',
        onOpen: openMail,
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
    return makeAgentRow({
      title: 'Mail 에이전트',
      tone,
      status,
      metric: accounts.length
        ? accounts.map(account => `${providerLabel(account.provider)} ${account.status === 'active' ? '●' : '○'}`).join(' · ')
        : '등록된 계정 없음',
      onOpen: openMail,
      ariaLabel: 'Mail 에이전트 열기',
    });
  }

  function makeCodexRow() {
    if (state.codexError || !state.organize) {
      return makeAgentRow({
        title: '사서 Codex',
        tone: 'danger',
        status: '오류',
        metric: state.codexError || 'Codex 상태를 불러오지 못했어',
        onOpen: openCodex,
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
    return makeAgentRow({
      title: '사서 Codex',
      tone,
      status,
      metric: `대기 ${queueable} · 멈춤 ${stalled}`,
      onOpen: openCodex,
      ariaLabel: '사서 Codex 열기',
    });
  }

  // provider 표시 이름. 세 번째 provider가 생기면서 `gmail이냐 아니냐`의 이진 분기가
  // 틀린 답을 내게 됐다(웍스가 `Naver`로 보였다). 이름은 한 곳에서만 정한다.
  const PROVIDER_LABELS = { gmail: 'Gmail', naver: 'Naver', works: 'Works' };
  const providerLabel = provider => PROVIDER_LABELS[provider] || provider || '메일';

  const REASON_LABELS = {
    action_required: '행동 필요',
    attachment_check: '첨부 확인 필요',
    low_confidence: '확인 필요',
  };

  function formatDeadline(item) {
    if (item.deadlineKind === 'date' && item.deadlineDate) return `${item.deadlineDate}까지`;
    if (item.deadlineKind === 'datetime' && Number.isSafeInteger(item.deadlineAt)) {
      return `${new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(new Date(item.deadlineAt * 1000))}까지`;
    }
    return '';
  }

  // 인사는 KST 시각으로 고른다. 브라우저 timezone을 쓰면 같은 순간에 기기마다
  // 다른 인사가 나온다. 이 제품의 시각 기준은 한 곳뿐이다.
  function greeting(now = new Date()) {
    const hour = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false,
    }).format(now));
    if (hour < 5) return '늦은 밤이야';
    if (hour < 11) return '좋은 아침';
    if (hour < 17) return '좋은 오후';
    if (hour < 22) return '좋은 저녁';
    return '늦은 밤이야';
  }

  /**
   * 인사 + 온도 / 날짜 / 생활 문구의 3행. **새 카드도 새 섹션도 만들지 않는다.**
   * 날씨는 날짜와 같은 성격의 오늘의 주변 맥락이라 머리줄에만 붙는다(설계 1·20절).
   *
   * 좌우 2열로 나누지 않는다. 지식 패널이 데스크톱에서 350px 고정이라 오른쪽 열이
   * 실질 200px가 되고 그 폭에서 브리핑 문구가 감겨 머리가 3줄 이상으로 커진다.
   */
  function makeHomeHead() {
    const head = document.createElement('div');
    head.className = 'home-head';

    const top = document.createElement('div');
    top.className = 'home-head-top';
    const hello = document.createElement('span');
    hello.className = 'home-greeting';
    hello.textContent = greeting();
    top.appendChild(hello);
    if (state.weather) {
      const now = document.createElement('span');
      now.className = 'home-weather-now';
      now.textContent = `${state.weather.icon} ${state.weather.temperature}°`;
      top.appendChild(now);
    }

    const date = document.createElement('strong');
    date.className = 'home-date';
    date.textContent = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'long',
    }).format(new Date());
    head.append(top, date);

    // 실패는 문구 없이 숨김이다. 홈은 diagnostics 화면이 아니다(설계 21절).
    if (state.weather?.message) {
      const message = document.createElement('p');
      message.className = 'home-weather-message';
      message.textContent = state.weather.message;
      head.appendChild(message);
    }
    return head;
  }

  function makeHomeSection(titleText, extra) {
    const section = document.createElement('section');
    section.className = 'home-section';
    const head = document.createElement('div');
    head.className = 'home-section-head';
    const title = document.createElement('strong');
    title.className = 'home-section-title';
    title.textContent = titleText;
    head.appendChild(title);
    if (extra) {
      const note = document.createElement('span');
      note.className = 'home-section-note';
      note.textContent = extra;
      head.appendChild(note);
    }
    section.appendChild(head);
    return section;
  }

  /**
   * 홈의 Attention 항목. **알림 탭 카드의 복제가 아니다**. 요약과 처리 버튼은 빼고
   * 배지·제목·시각까지만 둔다. 처리는 각 책임 화면이 맡는다(설계 2·4절).
   *
   * 메일 Attention과 울린 일정 알림이 같은 목록에 들어온다. 둘 다 "잊으면 안 될
   * 후속 행동이 남았다"는 같은 뜻이라 사용자에게는 한 자리여야 한다.
   */
  function makeAttentionItem(item) {
    const isTask = item.type === 'task_reminder';
    const entry = document.createElement('button');
    entry.type = 'button';
    entry.className = 'home-attention';
    entry.setAttribute('aria-label', `${item.title || '제목 없음'} ${isTask ? '일정' : '알림'} 열기`);
    entry.addEventListener('click', isTask
      ? () => openTasks({ view: 'today', focusReminders: true })
      : openMailAttention);

    const top = document.createElement('span');
    top.className = 'home-attention-top';
    const badge = document.createElement('span');
    badge.className = 'home-attention-badge';
    badge.textContent = isTask ? '일정 알림' : (REASON_LABELS[item.reasonKind] || '메일');
    top.appendChild(badge);
    if (!isTask) {
      const source = document.createElement('span');
      source.className = 'home-attention-source';
      source.textContent = providerLabel(item.provider);
      top.appendChild(source);
    }

    const subject = document.createElement('span');
    subject.className = 'home-attention-title';
    subject.textContent = item.title || (isTask ? '제목 없는 일정' : '(제목 없음)');
    entry.append(top, subject);

    const meta = isTask
      ? formatDateTime(item.remindAt)
      : [formatDeadline(item), item.action].filter(Boolean).join(' · ');
    if (meta) {
      const line = document.createElement('span');
      line.className = 'home-attention-meta';
      line.textContent = meta;
      entry.appendChild(line);
    }
    return entry;
  }

  function makeAttentionSection() {
    if (state.attentionError) {
      const section = makeHomeSection('확인할 것');
      const failed = document.createElement('p');
      failed.className = 'home-empty danger';
      failed.textContent = '확인할 것을 불러오지 못했어';
      section.appendChild(failed);
      return section;
    }
    if (!state.attention.length) return null;
    const hidden = state.attention.length - HOME_ATTENTION_LIMIT;
    const section = makeHomeSection('확인할 것', `${state.attention.length}건`);
    const shown = state.attentionExpanded
      ? state.attention
      : state.attention.slice(0, HOME_ATTENTION_LIMIT);
    shown.forEach(item => section.appendChild(makeAttentionItem(item)));
    // 나머지는 여기서 편다. 알림 탭은 일정 알림을 빼고 보여주므로 그쪽으로 보내면
    // 접힌 일정 알림을 볼 수 있는 곳이 없어진다.
    if (hidden > 0) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'home-more';
      more.textContent = state.attentionExpanded ? '접기' : `+${hidden}건 더`;
      more.addEventListener('click', () => {
        state.attentionExpanded = !state.attentionExpanded;
        renderSummary();
      });
      section.appendChild(more);
    }
    return section;
  }

  function makeTodaySection() {
    if (!state.enabled || state.scheduleError || !state.summary) return null;
    const counts = state.summary.counts || {};
    const overdue = Number(counts.overdue) || 0;
    const today = Number(counts.today) || 0;
    // 알림이 울린 일정은 이미 `확인할 것`에 올라가 있다. 같은 일정을 두 자리에
    // 보여주면 편집된 브리핑이 아니라 같은 목록의 반복이 된다.
    const promoted = new Set(state.attention
      .filter(item => item.type === 'task_reminder')
      .map(item => item.taskId));
    const preview = (Array.isArray(state.summary.preview) ? state.summary.preview : [])
      .filter(task => !promoted.has(task.taskId));
    const next = state.summary.nextReminder;
    if (!overdue && !today && !next) return null;
    if (!preview.length && !next) return null;

    const section = makeHomeSection('오늘', overdue > 0 ? `지연 ${overdue}` : '');
    preview.slice(0, 2).forEach(task => {
      const entry = document.createElement('button');
      entry.type = 'button';
      entry.className = 'home-today';
      entry.setAttribute('aria-label', `${task.title || '제목 없는 일정'} 열기`);
      entry.addEventListener('click', () => openTasks({ view: 'today' }));
      const title = document.createElement('span');
      title.className = 'home-today-title';
      title.textContent = task.title || '제목 없는 일정';
      const meta = document.createElement('span');
      meta.className = 'home-today-meta';
      meta.textContent = task.bucket === 'overdue'
        ? '지연'
        : task.dueKind === 'datetime' ? formatDateTime(task.dueAt) : '오늘';
      entry.append(title, meta);
      section.appendChild(entry);
    });
    if (next) {
      const line = document.createElement('p');
      line.className = 'home-note';
      line.textContent = `다음 알림 ${formatDateTime(next.remindAt)}`;
      section.appendChild(line);
    }
    return section;
  }

  // 새 소식이 없으면 영역 자체를 만들지 않는다(설계 14.2). 빈 카드를 띄워
  // "오늘은 뉴스가 없어"라고 말하는 것은 정보가 아니라 장식이다.
  function makeNewsSection() {
    const articles = Array.isArray(state.news?.articles) ? state.news.articles : [];
    if (!articles.length) return null;

    const section = makeHomeSection('알아둘 것');
    articles.slice(0, HOME_NEWS_LIMIT).forEach(article => {
      const entry = document.createElement('a');
      entry.className = 'home-news';
      entry.href = article.url;
      entry.target = '_blank';
      entry.rel = 'noopener noreferrer';
      entry.setAttribute('aria-label', `${article.title} 열기`);

      const title = document.createElement('span');
      title.className = 'home-news-title';
      title.textContent = article.title;

      // 왜 가져왔는지가 제목 바로 아래 있다. 이것이 없으면 추천 피드다(설계 15).
      const why = document.createElement('span');
      why.className = 'home-news-why';
      why.textContent = [article.topic, article.source].filter(Boolean).join(' · ');

      entry.append(title, why);
      section.appendChild(entry);
    });
    return section;
  }

  // 홈의 정상 상태는 정보가 적은 상태다. 확인할 것도 오늘 할 일도 없으면 조용히 끝낸다.
  function makeQuietLine() {
    const line = document.createElement('p');
    line.className = 'home-empty';
    line.textContent = '오늘은 따로 확인할 일이 없어.';
    return line;
  }

  const REELS_STATUS = { candidate: '선택 대기', held: '보류 중', selected: '선택됨', dropped: '거절됨' };

  // 후보 텍스트는 모델이 만든 비신뢰 문자열이라 textContent로만 넣는다.
  function makeReelsAgentCard() {
    const batch = state.reels?.batch;
    const block = document.createElement('section');
    block.className = 'agents-operational-card reels-agent-card';
    block.appendChild(agentSummaryHead('Reels 에이전트', '오늘의 영상 주제 후보 3개 중 하나를 골라.',
      batch ? REELS_STATUS[batch.status] : '후보 없음', refresh));
    if (!batch) {
      block.appendChild(agentSummaryMessage('아직 후보가 없어. 하루 한 번 저녁 7시에 올라와.'));
      return block;
    }
    const open = batch.status === 'candidate' || batch.status === 'held';
    const list = document.createElement('div');
    list.className = 'reels-cards';
    batch.cards.forEach(card => {
      const item = document.createElement('article');
      item.className = 'reels-card';
      // 유입용 카드는 원문이 없어 링크 대신 글자로 둔다.
      const title = document.createElement(card.url ? 'a' : 'p');
      title.className = 'reels-card-title';
      if (card.url) {
        title.href = card.url;
        title.target = '_blank';
        title.rel = 'noopener noreferrer';
      }
      title.textContent = card.title;
      const lines = [card.why, card.everydayDoor && `일상의 문: ${card.everydayDoor}`,
        `${card.concept}: ${card.bridge}`, `${card.template} · ${card.hookParadox} / ${card.hookTerm} / ${card.hookSubtitle}`, `위험·불확실: ${card.risk}`]
        .filter(Boolean).map(text => {
          const line = document.createElement('p');
          line.textContent = text;
          return line;
        });
      item.append(title, ...lines);
      if (open) item.appendChild(button('이걸로', () => decideReels(`/api/reels/candidates/${card.id}/select`), true));
      list.appendChild(item);
    });
    block.appendChild(list);
    if (open) {
      const actions = document.createElement('div');
      actions.className = 'agent-summary-actions reels-actions';
      actions.append(button('전부 거절', () => decideReels(`/api/reels/batches/${batch.batchId}/reject`)));
      if (batch.status === 'candidate') actions.appendChild(button('보류', () => decideReels(`/api/reels/batches/${batch.batchId}/hold`)));
      block.appendChild(actions);
    }
    return block;
  }

  async function decideReels(path) {
    const response = await state.apiFetch(path, { method: 'POST' });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      state.showToast(data.error || '처리하지 못했어.');
    }
    await refresh();
  }

  function releaseCardMedia() {
    const media = state.cardMedia; state.cardMedia = null;
    media?.urls.forEach(url => url && URL.revokeObjectURL(url));
  }

  function makeCardsAgentCard() {
    const batch = state.cards?.batch;
    const block = document.createElement('section');
    block.className = 'agents-operational-card cards-agent-card';
    block.appendChild(agentSummaryHead('카드뉴스 에이전트', '최근 일주일 기술 소식에서 한 주제를 골라.',
      batch ? REELS_STATUS[batch.status] : '후보 없음', refresh));
    if (!batch) { block.appendChild(agentSummaryMessage('후보는 저녁 7시에 올라와.')); return block; }
    const open = ['candidate', 'held'].includes(batch.status);
    const list = document.createElement('div'); list.className = 'reels-cards';
    batch.cards.forEach(row => {
      const card = row.candidate;
      const item = document.createElement('article'); item.className = 'reels-card';
      const title = document.createElement('p'); title.className = 'reels-card-title'; title.textContent = card.title;
      item.appendChild(title);
      for (const text of [`${card.audience === 'general' ? '일반인용' : '실무자용'} · ${card.mode === 'news' ? '뉴스 브리프' : '기술 비교'}`,
        card.summary, card.reader_question, card.format_reason]) {
        const line = document.createElement('p'); line.textContent = text; item.appendChild(line);
      }
      if (open) item.appendChild(button('이걸로', () => decideReels(`/api/cards/candidates/${row.id}/select`), true));
      list.appendChild(item);
    });
    block.appendChild(list);
    if (batch.shortageReason) block.appendChild(agentSummaryMessage(batch.shortageReason));
    if (batch.errorCode) block.appendChild(agentSummaryMessage('후보를 가져오지 못했어. 다음 수집 때 다시 시도해.'));
    if (open) {
      const actions = document.createElement('div'); actions.className = 'agent-summary-actions reels-actions';
      actions.append(button('전부 거절', () => decideReels(`/api/cards/batches/${batch.batchId}/reject`)));
      if (batch.status === 'candidate') actions.appendChild(button('보류', () => decideReels(`/api/cards/batches/${batch.batchId}/hold`)));
      block.appendChild(actions);
    }
    return block;
  }

  function makeCardJobCard() {
    const job = state.cardJob; if (!job) { releaseCardMedia(); return null; }
    const labels = { queued: '제작 대기', producing: '만드는 중', ready: '승인 대기', failed: '실행 중단', blocked: '수정 필요', approved: '승인됨', discarded: '폐기됨' };
    const stages = { script: '대본 작성', review: '대본 검토', build: '이미지 조립', 'visual-0': '완성본 검토', 'visual-1': '수정본 검토', 'visual-2': '수정본 검토', 'fix-1': '이미지 수정', 'fix-2': '이미지 수정' };
    const block = document.createElement('section'); block.className = 'agents-operational-card cards-agent-card';
    block.appendChild(agentSummaryHead('시온의 원리노트', job.title, labels[job.status] || job.status, refresh));
    const body = document.createElement('div'); body.className = 'reels-episode-body';
    if (job.status === 'producing') body.appendChild(agentSummaryMessage(stages[job.stage] || '제작 중이야.'));
    if (job.images.length) {
      const holder = document.createElement('div'); holder.className = 'cards-carousel'; holder.tabIndex = 0;
      holder.setAttribute('aria-label', '카드뉴스 이미지. 옆으로 넘겨 볼 수 있어.');
      const key = `${job.id}:${job.finishedAt}`;
      if (state.cardMedia?.key !== key) {
        releaseCardMedia(); const media = { key, urls: [] }; state.cardMedia = media;
        media.ready = Promise.all(job.images.map(async (url, i) => {
          const response = await state.apiFetch(url); if (!response.ok) return;
          const blob = URL.createObjectURL(await response.blob());
          if (state.cardMedia !== media) { URL.revokeObjectURL(blob); return; }
          media.urls[i] = blob;
        })).catch(() => {});
      }
      const media = state.cardMedia;
      void media.ready.then(() => {
        if (!holder.isConnected || state.cardMedia !== media) return;
        media.urls.forEach((url, i) => { if (!url) return; const image = document.createElement('img');
          image.src = url; image.alt = `${job.title} · ${i+1}장`; image.width = 1080; image.height = 1350; holder.appendChild(image); });
      });
      body.appendChild(holder);
    } else releaseCardMedia();
    if (job.caption) { const caption = document.createElement('p'); caption.className = 'reels-caption'; caption.textContent = job.caption; body.appendChild(caption); }
    if (job.claims.length) body.appendChild(reelsClaims(job.claims));
    const actions = document.createElement('div'); actions.className = 'agent-summary-actions';
    if (job.status === 'ready') actions.append(button('승인', () => decideReels(`/api/cards/jobs/${job.id}/approve`), true));
    if (['failed', 'blocked'].includes(job.status)) actions.append(button('다시 시도', () => decideReels(`/api/cards/jobs/${job.id}/retry`)));
    if (['ready', 'failed', 'blocked', 'queued'].includes(job.status)) actions.append(button('폐기', () => decideReels(`/api/cards/jobs/${job.id}/discard`)));
    if (job.publishStatus) {
      const labels = { pending: '게시 대기', uploading: '게시 중', done: '게시 완료', failed: '게시 실패', unknown: '게시 여부 확인 필요' };
      const line = document.createElement('p'); line.textContent = labels[job.publishStatus]; body.appendChild(line);
      if (['failed', 'unknown'].includes(job.publishStatus)) body.appendChild(agentSummaryMessage('중복 게시를 막기 위해 자동 재전송하지 않아. Instagram에서 게시 여부를 확인해줘.'));
      if (job.remoteUrl) { const link = document.createElement('a'); link.href = job.remoteUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Instagram에서 보기'; body.appendChild(link); }
    }
    if (job.errorCode) body.appendChild(agentSummaryMessage(`실행이 멈췄어. ${job.errorCode}`));
    body.appendChild(actions); block.appendChild(body); return block;
  }

  async function loadCards() {
    const results = await Promise.allSettled(['/api/cards/latest', '/api/cards/jobs/latest'].map(async url => {
      const response = await state.apiFetch(url); return response.ok ? response.json() : null;
    }));
    state.cards = results[0].status === 'fulfilled' ? results[0].value : null;
    state.cardJob = results[1].status === 'fulfilled' ? results[1].value?.job || null : null;
  }

  // --- Reels 편 (검토 2) ------------------------------------------------------
  // 캡션·주장·인용·제목·의견·오류는 모델이 만든 비신뢰 문자열이라 전부 textContent로만 넣는다.
  const EPISODE_STATUS = {
    producing: '만드는 중', revising: '고치는 중', ready: '검토 대기', failed: '실패',
    approved: '승인됨', discarded: '폐기됨',
  };

  function releaseReelsMedia() {
    const media = state.reelsMedia;
    state.reelsMedia = null;
    if (!media) return;
    [media.video, media.cover].forEach(url => url && URL.revokeObjectURL(url));
  }

  // 같은 편·같은 결과면 blob을 재사용한다. 수정이 끝나면 영상 URL은 같고 finishedAt만 바뀌므로 그걸 열쇠에 넣는다.
  async function loadReelsMedia(episode) {
    const key = `${episode.id}:${episode.finishedAt}`;
    if (state.reelsMedia?.key !== key) {
      releaseReelsMedia();
      const media = { key, video: null, cover: null };
      state.reelsMedia = media;
      media.ready = Promise.all([['video', episode.videoUrl], ['cover', episode.coverUrl]].map(async ([key, url]) => {
        if (!url) return;
        const response = await state.apiFetch(url);
        if (response.ok) {
          const url = URL.createObjectURL(await response.blob());
          if (state.reelsMedia === media) media[key] = url;
          else URL.revokeObjectURL(url);
        }
      })).catch(() => {});
    }
    const media = state.reelsMedia;
    await media.ready;
    return media;
  }

  function svgIcon(kind) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('class', `reels-check ${kind}`);
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', kind === 'ok' ? 'M3.5 8.5l3 3 6-7' : kind === 'warn' ? 'M8 3.5v5.5M8 11.8v.4' : 'M4 8h8');
    svg.appendChild(path);
    return svg;
  }

  function reelsClaims(claims) {
    const wrap = document.createElement('div');
    wrap.className = 'reels-claims';
    const list = document.createElement('ul');
    list.hidden = true;
    claims.forEach(item => {
      const row = document.createElement('li');
      const mark = svgIcon(item.found === true ? 'ok' : item.found === false ? 'warn' : 'none');
      const body = document.createElement('div');
      const claim = document.createElement('p');
      claim.textContent = item.claim || '';
      body.appendChild(claim);
      if (item.source) {
        const source = /^https?:\/\//i.test(item.url || '') ? document.createElement('a') : document.createElement('span');
        source.className = 'reels-claim-source';
        source.textContent = item.source;
        if (source.tagName === 'A') {
          source.href = item.url;
          source.target = '_blank';
          source.rel = 'noopener noreferrer';
        }
        body.appendChild(source);
      }
      if (item.quote) {
        const quote = document.createElement('small');
        quote.textContent = item.quote;
        body.appendChild(quote);
      }
      row.append(mark, body);
      list.appendChild(row);
    });
    const toggle = button(`사실 확인 ${claims.length}개`, () => {
      list.hidden = !list.hidden;
      toggle.setAttribute('aria-expanded', String(!list.hidden));
    });
    toggle.setAttribute('aria-expanded', 'false');
    wrap.append(toggle, list);
    return wrap;
  }

  function reelsVideoBlock(episode, folded) {
    const holder = document.createElement('div');
    holder.className = 'reels-video';
    const mount = async () => {
      const media = await loadReelsMedia(episode);
      if (!media.video || !holder.isConnected) return;
      const video = document.createElement('video');
      video.controls = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.src = media.video;
      if (media.cover) video.poster = media.cover;
      holder.replaceChildren(video);
    };
    if (!folded) {
      void mount();
      return holder;
    }
    holder.classList.add('folded');
    const open = button('영상 펼치기', () => { open.remove(); void mount(); });
    holder.appendChild(open);
    return holder;
  }

  async function reelsEpisodePost(episode, action, body) {
    const response = await state.apiFetch(`/api/reels/episodes/${episode.id}/${action}`, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { method: 'POST' });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      state.showToast(data.error || '처리하지 못했어.');
    }
    await refresh();
  }

  function reelsReviseForm(episode) {
    const form = document.createElement('div');
    form.className = 'reels-revise';
    form.hidden = true;
    const area = document.createElement('textarea');
    area.maxLength = 1000;
    area.rows = 3;
    area.placeholder = '어디를 어떻게 고칠지 적어줘';
    const count = document.createElement('small');
    count.textContent = '0/1000';
    area.addEventListener('input', () => { count.textContent = `${area.value.length}/1000`; });
    const send = button('보내기', () => {
      if (!area.value.trim()) return;
      send.disabled = true;
      void reelsEpisodePost(episode, 'revise', { note: area.value.trim() });
    }, true);
    const cancel = button('취소', () => { form.hidden = true; });
    const row = document.createElement('div');
    row.className = 'agent-summary-actions';
    row.append(send, cancel);
    form.append(area, count, row);
    return form;
  }

  const UPLOAD_STATUS = { pending: '대기', uploading: '올리는 중', done: '완료', failed: '실패' };
  const UPLOAD_PLATFORM = { youtube: '유튜브', instagram: '인스타그램' };

  function reelsUploadLines(episode) {
    return (Array.isArray(episode.uploads) ? episode.uploads : []).map(upload => {
      const line = document.createElement('div');
      line.className = 'reels-upload';
      const label = document.createElement('small');
      label.textContent = `${UPLOAD_PLATFORM[upload.platform] || upload.platform} · ${upload.manual ? '수동 게시' : (UPLOAD_STATUS[upload.status] || upload.status)}`;
      line.appendChild(label);
      if (upload.status === 'done' && /^https:\/\/(youtu\.be|www\.instagram\.com)\//.test(upload.remoteUrl || '')) {
        const link = document.createElement('a');
        link.href = upload.remoteUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = '열기';
        line.appendChild(link);
      }
      if (upload.status === 'failed') {
        const error = document.createElement('small');
        error.className = 'reels-error';
        error.textContent = [upload.errorCode, upload.errorDetail].filter(Boolean).join(' · ') || '알 수 없는 오류';
        line.append(error,
          button('다시 시도', () => reelsEpisodePost(episode, `uploads/${upload.platform}/retry`)),
          // 손으로 올렸으면 완료로 돌려 다시 시도(중복 게시)를 막는다.
          button('수동 게시함', () => {
            if (confirm(`${UPLOAD_PLATFORM[upload.platform] || upload.platform}에 직접 올렸어? 완료로 표시하고 다시 시도를 없앤다.`)) reelsEpisodePost(episode, `uploads/${upload.platform}/manual`);
          }));
      }
      return line;
    });
  }

  // 유튜브 쇼츠 썸네일은 API로 넣으면 회색으로 남아 스튜디오에서 직접 올린다. 영상은 자동 게시가 실패했을 때 손으로 올린다. 그 파일을 폰에 바로 받게 한다.
  // iPhone 홈 화면 앱은 a[download]가 잘 안 먹어서 공유 시트(이미지·동영상 저장)를 먼저 쓰고, 안 되면 내려받기로 넘어간다.
  const REELS_MEDIA = {
    cover: { url: 'coverUrl', name: 'cover.png', type: 'image/png', fail: '커버를 받지 못했어' },
    video: { url: 'videoUrl', name: 'video.mp4', type: 'video/mp4', fail: '영상을 받지 못했어' },
  };
  async function saveReelsMedia(episode, kind) {
    const media = REELS_MEDIA[kind];
    try {
      const response = await state.apiFetch(episode[media.url]);
      if (!response.ok) throw new Error(kind);
      const file = new File([await response.blob()], `sionwhy-${episode.id}-${media.name}`, { type: media.type });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error) {
      if (error?.name !== 'AbortError') state.showToast(media.fail);
    }
  }

  function makeReelsEpisodeCard() {
    const episode = state.reelsEpisode;
    if (!episode) return null;
    const block = document.createElement('section');
    block.className = 'agents-operational-card reels-episode-card';
    block.dataset.mediaKey = `${episode.id}:${episode.finishedAt}:${episode.status}`;
    const desc = episode.status === 'revising' ? (episode.revisionNote || '') : (episode.title || '');
    block.appendChild(agentSummaryHead('Reels 편', desc, EPISODE_STATUS[episode.status] || episode.status, refresh));
    const body = document.createElement('div');
    body.className = 'reels-episode-body';
    block.appendChild(body);
    if (episode.status === 'producing' || episode.status === 'revising') return block;
    if (episode.status === 'failed') {
      const error = document.createElement('p');
      error.className = 'reels-error';
      error.textContent = [episode.errorCode, episode.errorDetail].filter(Boolean).join(' · ') || '알 수 없는 오류';
      const tries = document.createElement('small');
      tries.textContent = `시도 ${Number(episode.attempts) || 0}/3`;
      body.append(error, tries);
      return block;
    }
    const decided = episode.status === 'approved' || episode.status === 'discarded';
    body.appendChild(reelsVideoBlock(episode, decided));
    if (episode.caption) {
      const caption = document.createElement('div');
      caption.className = 'reels-caption';
      caption.textContent = episode.caption;
      body.append(caption, button('캡션 복사', async () => {
        try {
          await navigator.clipboard.writeText(episode.caption);
          state.showToast('캡션을 복사했어');
        } catch {
          state.showToast('복사하지 못했어');
        }
      }));
    }
    if (episode.videoUrl) body.appendChild(button('영상 저장', () => saveReelsMedia(episode, 'video')));
    if (episode.coverUrl) body.appendChild(button('커버 저장', () => saveReelsMedia(episode, 'cover')));
    if (Array.isArray(episode.claims) && episode.claims.length) body.appendChild(reelsClaims(episode.claims));
    const last = Array.isArray(episode.revisions) ? episode.revisions[episode.revisions.length - 1] : null;
    if (last) {
      const line = document.createElement('small');
      line.className = 'reels-last-revision';
      line.textContent = `지난 수정 ${last.outcome === 'ok' ? '성공' : '실패'}: ${last.note || ''}${last.outcome === 'ok' ? '' : ` (${[last.errorCode, last.errorDetail].filter(Boolean).join(' · ')})`}`;
      body.appendChild(line);
    }
    if (episode.status === 'approved') {
      body.append(...reelsUploadLines(episode));
      if (!episode.uploads?.length) body.appendChild(detailText('게시 상태 미연결'));
    }
    if (episode.status === 'ready') {
      const form = reelsReviseForm(episode);
      const actions = document.createElement('div');
      actions.className = 'agent-summary-actions reels-actions';
      actions.append(
        button('승인', () => reelsEpisodePost(episode, 'approve'), true),
        button('수정 요청', () => { form.hidden = !form.hidden; if (!form.hidden) form.querySelector('textarea').focus(); }),
        button('폐기', () => { if (confirm('이 편을 폐기할까?')) void reelsEpisodePost(episode, 'discard'); }),
      );
      body.append(actions, form);
    }
    return block;
  }

  function agentSummaryHead(titleText, description, statusText, onOpen, compactDescription = description) {
    const head = document.createElement('header');
    head.className = 'agent-summary-head';
    const title = button(titleText, onOpen);
    title.className = 'agent-summary-title';
    const note = document.createElement('p');
    const full = document.createElement('span');
    full.textContent = description;
    const compact = document.createElement('span');
    compact.className = 'agent-summary-compact-description';
    compact.textContent = compactDescription;
    note.append(full, compact);
    const status = document.createElement('span');
    status.className = 'schedule-agent-status';
    status.textContent = statusText;
    head.append(title, note, status);
    return head;
  }

  function agentMetrics(entries) {
    const list = document.createElement('dl');
    list.className = 'agent-summary-metric-list';
    entries.forEach(([label, value]) => {
      const item = document.createElement('div');
      const term = document.createElement('dt');
      term.textContent = label;
      const number = document.createElement('dd');
      number.textContent = value == null ? '확인 필요' : String(Number(value) || 0);
      item.append(term, number);
      list.appendChild(item);
    });
    return list;
  }

  function agentSummaryMessage(message, onRetry) {
    const wrapper = document.createElement('div');
    wrapper.className = 'agent-summary-unavailable';
    const text = document.createElement('p');
    text.textContent = message;
    wrapper.appendChild(text);
    if (onRetry) wrapper.appendChild(button('다시 시도', onRetry));
    return wrapper;
  }

  function makePerformanceChart(platform) {
    const youtube = platform === 'youtube';
    const error = youtube ? state.youtubeInsightsError : state.instagramInsightsError;
    const loading = youtube ? state.youtubeInsightsLoading : state.instagramInsightsLoading;
    const section = document.createElement('section');
    section.className = youtube ? 'youtube-insights' : 'instagram-insights';
    const title = document.createElement('h4');
    title.textContent = youtube ? '유튜브' : '인스타그램';
    const header = document.createElement('div'); header.className = 'instagram-chart-header';
    header.appendChild(title); section.appendChild(header);
    const data = youtube ? state.youtubeInsights : state.instagramInsights;
    if (!data || data.status === 'disconnected') {
      section.appendChild(detailText(error || (loading ? '조회수를 불러오는 중이야.' : '데이터 미연결')));
      return section;
    }
    if (error || data.status === 'stale') section.appendChild(detailText('지금 조회하지 못해 마지막 조회 결과를 표시해.', 'danger'));
    const dayLabel = at => new Date(at * 1000).toISOString().slice(0, 10);
    const points = (data.points || []).map(point => ({ ...point, day: youtube ? point.day : dayLabel(point.endAt), followers: youtube ? point.subscribers : point.followers }));
    const followerData = youtube ? data.subscribers : data.followers;
    const latestFollower = followerData?.latest;
    if (latestFollower && (youtube || !points.length || latestFollower.observedAt >= points[points.length - 1].endAt)) {
      const day = youtube ? latestFollower.day : dayLabel(latestFollower.observedAt + 9 * 3600);
      const sameDay = points.find(point => point.day === day);
      if (sameDay) sameDay.followers = latestFollower;
      else if (!points.length || day > points[points.length - 1].day) points.push({ startAt: null, endAt: latestFollower.observedAt, day, views: null, followers: latestFollower, observationOnly: true });
    }
    const legend = document.createElement('p');
    legend.className = 'instagram-series-legend';
    const viewsLegend = document.createElement('span'); viewsLegend.textContent = '조회수 (회)';
    const followersLegend = document.createElement('span'); followersLegend.textContent = youtube ? '구독자 (명·유튜브 제공)' : '팔로워 (명)';
    legend.append(viewsLegend, followersLegend); header.appendChild(legend);
    if (followerData?.status === 'unavailable') section.appendChild(detailText(youtube ? '구독자 조회·기록 실패. 저장된 관측값만 표시해.' : '팔로워 조회·기록 실패. 저장된 관측값만 표시해.', 'danger'));
    else if (!latestFollower) section.appendChild(detailText(youtube ? '구독자 기록 전 · 과거 총수는 미제공' : '팔로워 기록 전 · 과거 총수는 미제공'));
    if (!points.some(point => point.views !== null || point.followers)) {
      section.appendChild(detailText(youtube ? '유튜브가 아직 일별 Shorts 조회수를 반환하지 않았어.' : '인스타가 아직 일별 Reels 조회수를 반환하지 않았어.'));
      return section;
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 560 200');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', youtube ? '채널 전체 Shorts 조회수는 왼쪽 축, 누적 구독자는 오른쪽 축. YouTube 집계일(미국 태평양 시간) 기준. 구독자는 API에서 유효 숫자 세 자리로 내림한 관측 총수.' : '계정 전체 Reels 조회수는 왼쪽 축, 누적 팔로워는 오른쪽 축. 조회수는 Meta 집계 종료일, 최신 팔로워는 한국 시간 관측일 기준.');
    const draw = (tag, attrs, text) => {
      const node = document.createElementNS(svg.namespaceURI, tag);
      Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
      if (text !== undefined) node.textContent = text;
      svg.appendChild(node);
      return node;
    };
    const axisMax = value => {
      const step = 10 ** Math.floor(Math.log10(Math.max(1, value)));
      return Math.ceil(Math.max(1, value) / step) * step;
    };
    const viewsMax = axisMax(Math.max(0, ...points.map(point => point.views || 0)));
    const followersMax = axisMax(Math.max(0, ...points.map(point => point.followers?.total || 0)));
    const width = 480 / points.length;
    for (let tick = 0; tick <= 4; tick++) {
      const y = 160 - tick * 130 / 4;
      draw('line', { class: 'chart-grid', x1: 40, y1: y, x2: 520, y2: y, stroke: 'var(--hairline)' });
    }
    draw('line', { class: 'chart-axis', x1: 40, y1: 30, x2: 40, y2: 160, stroke: 'var(--hairline)' });
    draw('line', { class: 'chart-axis', x1: 520, y1: 30, x2: 520, y2: 160, stroke: 'var(--hairline)' });
    [['views', viewsMax, 'var(--brand)', 4, 'start'], ['followers', followersMax, 'var(--council)', 556, 'end']].forEach(([series, max, color, axisX, anchor]) => {
      const values = points.map(point => series === 'views' ? point.views : point.followers?.total ?? null);
      if (!values.some(value => value !== null)) return;
      for (let tick = 0; tick <= 4; tick++) {
        draw('text', { class: 'chart-tick', x: axisX, y: 164 - tick * 130 / 4, fill: color, 'text-anchor': anchor, 'font-size': 10 }, (max * tick / 4).toLocaleString('ko-KR', { maximumFractionDigits: 2 }));
      }
      const coordinates = values.map((value, index) => ({ value, x: 40 + width * (index + .5), y: 160 - (value === null ? 0 : value / max * 130) }));
      let trend = '', connected = false;
      coordinates.forEach(({ value, x, y }) => {
        if (value === null) { connected = false; return; }
        trend += `${connected ? 'L' : 'M'}${x},${y} `; connected = true;
      });
      draw('path', { class: `${series}-trend`, d: trend, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
      coordinates.forEach(({ value, x, y }, index) => {
        if (value === null) return;
        const dot = draw('circle', { class: `${series}-point`, cx: x, cy: y, r: 3, fill: color });
        const tooltip = document.createElementNS(svg.namespaceURI, 'title');
        tooltip.textContent = `${points[index].day} · ${series === 'views' ? '조회수' : youtube ? '구독자' : '팔로워'} ${value.toLocaleString('ko-KR')}${series === 'views' ? '회' : '명'}`;
        dot.appendChild(tooltip);
      });
    });
    points.forEach((point, index) => draw('text', { x: 40 + width * (index + .5), y: 184, 'text-anchor': 'middle', fill: 'var(--ai-text)', 'font-size': 10 }, point.day.slice(5).replace('-', '/')));
    section.appendChild(svg);
    return section;
  }

  async function loadInstagramInsights() {
    state.instagramInsightsLoading = true;
    try {
      const response = await state.apiFetch('/api/reels/instagram/insights');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '인스타 성과를 불러오지 못했어.');
      state.instagramInsights = data;
    } finally { state.instagramInsightsLoading = false; }
  }

  async function loadYoutubeInsights() {
    state.youtubeInsightsLoading = true;
    try {
      const response = await state.apiFetch('/api/reels/youtube/insights');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '유튜브 성과를 불러오지 못했어.');
      state.youtubeInsights = data;
    } finally { state.youtubeInsightsLoading = false; }
  }

  function renderSummary() {
    releaseReelsMedia();
    releaseCardMedia();
    state.container.replaceChildren();
    const layout = document.createElement('div');
    layout.className = 'agents-dashboard';
    const board = document.createElement('section');
    board.className = 'agent-detail-card agents-data-board';
    board.setAttribute('aria-label', '성과 추세');
    board.append(makePerformanceChart('instagram'), makePerformanceChart('youtube'));
    const rail = document.createElement('nav');
    rail.className = 'agents-status-rail';
    rail.setAttribute('aria-label', '에이전트 현황');
    const heading = document.createElement('h2');
    heading.textContent = '에이전트 현황';
    heading.className = 'agents-status-heading';
    const content = document.createElement('div');
    content.className = 'agent-content-rail';
    const { episode, batch } = reelsCycle();
    const reelsStatus = state.reelsError || state.reelsEpisodeError ? '확인 필요'
      : episode ? EPISODE_STATUS[episode.status] || '확인 필요'
      : batch ? REELS_STATUS[batch.status] : state.reels ? '후보 없음' : '꺼짐';
    content.append(makeAgentRow({ title: 'Reels · Shorts', status: reelsStatus,
      tone: state.reelsError || state.reelsEpisodeError || episode?.status === 'failed' ? 'danger' : episode?.status === 'ready' || batch?.status === 'candidate' ? 'warn' : !state.reels && !episode ? 'off' : 'ok', onOpen: openReels }),
      makeAgentRow({ title: '카드 뉴스',
        status: state.cardJob ? ({ queued: '제작 대기', producing: '만드는 중', ready: '승인 대기', failed: '실행 중단', blocked: '수정 필요', approved: '승인됨', discarded: '폐기됨' }[state.cardJob.status] || '확인 필요')
          : state.cards?.batch ? REELS_STATUS[state.cards.batch.status] || '확인 필요' : '미연결',
        tone: ['failed', 'blocked'].includes(state.cardJob?.status) ? 'danger' : state.cardJob?.status === 'ready' ? 'warn' : state.cards || state.cardJob ? 'ok' : 'off', onOpen: openCards }));
    rail.append(heading, makeMailRow(), makeScheduleRow(), makeCodexRow(), content);
    layout.append(board, rail);
    state.container.appendChild(layout);
    if (state.returnAgent) {
      [...rail.querySelectorAll('button')].find(item => item.querySelector('.agent-rail-title')?.textContent === state.returnAgent)?.focus();
      state.returnAgent = null;
    }
  }

  // 후보 batchId의 KST 날짜를 기준으로 19시부터 다음 날 19시까지 한 사이클이다.
  function reelsCycle(now = Date.now()) {
    const id = new Date(now - 10 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const batch = state.reels?.batch?.batchId === id ? state.reels.batch : null;
    const episode = state.reelsEpisode?.batchId === id ? state.reelsEpisode : null;
    const active = !episode ? (batch?.status === 'selected' ? 2 : 1) : episode.status === 'discarded' ? 1
      : ['producing', 'revising', 'failed'].includes(episode.status) ? 2 : episode.status === 'ready' ? 3 : episode.status === 'approved' ? 4 : 1;
    return { id, batch, episode, active };
  }

  function renderReelsDetail() {
    const previous = state.container.querySelector('.reels-workspace');
    const cycle = new Date(Date.now() - 10 * 3600000).toISOString().slice(0, 10);
    const key = JSON.stringify([cycle, state.reels, state.reelsEpisode, state.reelsError, state.reelsEpisodeError, state.cards, state.cardJob]);
    if (previous && state.reelsRenderedKey === key) return;
    const workspace = document.createElement('section');
    workspace.className = 'agent-detail-workspace reels-workspace';
    workspace.appendChild(makeDetailHead('Reels · Shorts', 'Agents로 돌아가기'));
    const cards = detailCard('카드 뉴스');
    if (state.cards) cards.appendChild(makeCardsAgentCard());
    const cardJob = makeCardJobCard();
    if (cardJob) cards.appendChild(cardJob);
    if (!state.cards && !cardJob) cards.appendChild(detailText('미연결'));
    const columns = detailColumns([], [cards]);
    columns.classList.add('reels-workflow-columns');
    const stages = columns.firstElementChild;
    const { batch, episode, active } = reelsCycle();
    ['주제 선정', '영상 제작', '영상 검토', '게시'].forEach((label, index) => {
      const step = index + 1;
      const stage = document.createElement('section');
      stage.className = 'agent-detail-card reels-stage';
      stage.dataset.step = step;
      const heading = document.createElement('h3');
      heading.textContent = `0${step} / ${label}`;
      stage.appendChild(heading);
      if (step === active) {
        stage.classList.add('active');
        stage.setAttribute('aria-current', 'step');
      }
      if (step === active && step === 1) {
        if (state.reelsError) stage.appendChild(detailText(state.reelsError, 'danger'));
        if (batch) stage.appendChild(makeReelsAgentCard());
        else stage.appendChild(detailText(state.reels ? '오늘 주제 후보를 기다리는 중이야.' : '주제 후보 미연결'));
      } else if (step === active && episode && ((step === 2 && ['producing', 'revising', 'failed'].includes(episode.status))
        || (step === 3 && ['ready', 'discarded'].includes(episode.status)) || (step === 4 && episode.status === 'approved'))) {
        stage.appendChild(makeReelsEpisodeCard());
      } else if (step === active) {
        stage.appendChild(detailText(state.reelsEpisodeError || '아직 이 단계의 영상이 없어.'));
      }
      if (step < active) heading.appendChild(svgIcon('ok'));
      if (step === active) stage.appendChild(button('새로고침', refresh));
      stages.appendChild(stage);
    });
    if (state.reelsEpisodeError) workspace.appendChild(detailCard('영상 상태 확인 필요', detailText(state.reelsEpisodeError, 'danger')));
    workspace.appendChild(columns);
    const oldCard = previous?.querySelector('.reels-episode-card');
    const newCard = workspace.querySelector('.reels-episode-card');
    const video = oldCard?.querySelector('.reels-video');
    if (video && newCard && oldCard.dataset.mediaKey === newCard.dataset.mediaKey) {
      // 영상 DOM을 분리하면 브라우저가 재생을 멈춘다. 같은 결과는 플레이어 밖만 갱신한다.
      oldCard.firstElementChild.replaceWith(newCard.firstElementChild);
      const body = oldCard.querySelector('.reels-episode-body');
      [...body.children].forEach(child => { if (child !== video) child.remove(); });
      [...newCard.querySelector('.reels-episode-body').children].forEach(child => {
        if (!child.classList.contains('reels-video')) body.appendChild(child);
      });
      const selector = '.reels-workflow-columns > .agent-detail-column:last-child';
      previous.querySelector(selector).replaceChildren(...workspace.querySelector(selector).children);
    } else {
      state.container.replaceChildren(workspace);
    }
    state.reelsRenderedKey = key;
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
    for (const [labelText, enabled, patch] of [
      ['Push 알림', notificationsEnabled, { notificationsEnabled: !notificationsEnabled }],
      ['방해 금지', quietHours.enabled, { quietHours: { ...quietHours, enabled: !quietHours.enabled } }],
    ]) {
      const row = document.createElement('div');
      row.className = 'mail-setting-row';
      const label = document.createElement('span');
      label.textContent = labelText;
      const status = document.createElement('span');
      status.className = 'agent-rail-status';
      status.textContent = enabled ? '켜짐' : '꺼짐';
      const toggle = button(enabled ? '끄기' : '켜기', () => saveMailSettings(patch));
      toggle.setAttribute('aria-label', `${labelText === 'Push 알림' ? 'Push' : labelText} ${enabled ? '끄기' : '켜기'}`);
      toggle.disabled = state.mailSettingsSaving;
      row.append(label, status, toggle);
      section.appendChild(row);
    }
    section.appendChild(detailText(`방해 금지 시간 ${quietHours.start}~${quietHours.end} KST`));
    return section;
  }

  const PREFERENCE_LABELS = {
    sender: '발신자',
    domain: '도메인',
    category: '분류',
  };

  const PREFERENCE_ACTION_LABELS = {
    suppress_notification: '알림 끔',
    always_notify: '꼭 알림',
    skip_analysis: '분석 안 함',
  };

  /**
   * 알림 규칙 목록(설계 8.5·11). 만드는 곳은 알림 카드의 `알림 끄기` 한 동작과
   * 사용자가 직접 말한 대화뿐이고, 여기는 그것을 확인하고 되돌리는 자리다.
   * 사용자가 규칙을 조립하게 하지 않으므로 편집기를 만들지 않는다.
   *
   * action으로 거르지 않는다. 대화로 만든 `always_notify`·`skip_analysis`가 여기
   * 안 보이면 만든 사람이 그것을 지울 자리가 없어진다.
   */
  function makeMailPreferences() {
    const section = document.createElement('section');
    section.className = 'schedule-agent-section';
    const heading = document.createElement('h3');
    heading.textContent = '메일 알림 규칙';
    section.appendChild(heading);

    if (!state.mailPreferences) {
      const message = document.createElement('p');
      message.className = 'codex-agent-message';
      message.textContent = '목록을 불러오지 못했어.';
      section.appendChild(message);
      return section;
    }
    if (!state.mailPreferences.length) {
      const message = document.createElement('p');
      message.className = 'codex-agent-message';
      message.textContent = '아직 없어. 알림 탭 메일 카드의 `알림 끄기`나 대화로 만들 수 있어.';
      section.appendChild(message);
      return section;
    }

    for (const item of state.mailPreferences) {
      const row = document.createElement('div');
      row.className = 'codex-agent-actions';
      const label = document.createElement('p');
      label.className = 'codex-agent-message';
      const scope = PREFERENCE_LABELS[item.preferenceType] || item.preferenceType;
      const effect = PREFERENCE_ACTION_LABELS[item.action] || item.action;
      label.textContent = `${scope} · ${item.target} · ${effect}`;
      const remove = button('되돌리기', () => removeMailPreference(item.id));
      remove.disabled = state.mailPreferenceSaving;
      row.append(label, remove);
      section.appendChild(row);
    }
    return section;
  }

  function makeDetailHead(titleText, ariaLabel) {
    const head = document.createElement('header');
    head.className = 'agent-detail-head';
    const back = button('Agents', openSummary);
    back.className = 'agent-detail-back';
    back.setAttribute('aria-label', ariaLabel);
    const icon = document.createElement('img');
    icon.src = 'assets/figma/left.svg';
    icon.alt = '';
    back.prepend(icon);
    const row = document.createElement('div');
    row.className = 'agent-detail-title-row';
    const title = document.createElement('h2');
    title.textContent = titleText;
    title.tabIndex = -1;
    row.appendChild(title);
    const statusRow = titleText === 'Mail 에이전트' ? makeMailRow() : titleText === '사서 Codex' ? makeCodexRow() : titleText === '일정 에이전트' ? makeScheduleRow() : null;
    if (statusRow) row.appendChild(statusRow.querySelector('.agent-rail-status'));
    const descriptions = {
      'Mail 에이전트': '메일 수집·분석 상태와 설정 · 실제 메일은 알림에서 확인',
      '일정 에이전트': '주간 일정·리마인더·마감 확인',
      '사서 Codex': '노트 정리 대기열·모델·CLI 상태 · 설정 변경은 다음 작업부터 반영',
    };
    head.append(back, row);
    if (descriptions[titleText]) head.appendChild(detailText(descriptions[titleText]));
    return head;
  }

  // 달력·counts·미리보기는 통째로 일정 상세가 된다. 요약에서 내려온 것이지 새로
  // 만든 화면이 아니다. `일정 추가`·`전체 일정` 버튼도 그대로 붙어 있다.
  function renderScheduleDetail() {
    state.container.replaceChildren();
    const workspace = document.createElement('section');
    workspace.className = 'schedule-agent-workspace agent-detail-workspace';
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
    workspace.className = 'schedule-agent-workspace agent-detail-workspace';
    workspace.append(makeDetailHead('사서 Codex', '에이전트 요약으로 돌아가기'), makeCodexBlock());
    state.container.appendChild(workspace);
  }

  function renderMailDetail() {
    state.container.replaceChildren();
    const workspace = document.createElement('section');
    workspace.className = 'schedule-agent-workspace agent-detail-workspace';
    workspace.append(makeDetailHead('Mail 에이전트', '에이전트 요약으로 돌아가기'), makeMailBlock());
    state.container.appendChild(workspace);
  }

  // 운영과 복구만 둔다. 사용자가 실제로 처리할 Attention은 알림 탭의 몫이고
  // 여기에 두 번째 받은편지함을 만들지 않는다(설계 23절).
  function makeMailBlock() {
    const block = document.createElement('section');
    block.className = 'agent-detail-body mail-detail';
    if (state.mail?.disabled || state.mailError || !state.mail) {
      block.appendChild(detailCard('메일 상태', detailText(state.mailError || (state.mail?.disabled ? '메일 동기화와 분석이 꺼져 있어.' : 'Mail 상태를 불러오지 못했어.'), 'warn'), button('다시 시도', refresh)));
      return block;
    }
    const accounts = detailCard('연결 계정');
    const items = Array.isArray(state.mail.accounts) ? state.mail.accounts : [];
    if (!items.length) accounts.appendChild(detailText('등록된 메일 계정이 없어.'));
    items.forEach(account => {
      accounts.appendChild(detailText(`${providerLabel(account.provider)} · ${account.address}`));
      accounts.appendChild(detailText(`${account.status} · ${account.lastSyncAt ? formatDateTime(account.lastSyncAt) : '동기화 전'}${account.lastErrorCode ? ` · ${account.lastErrorCode}` : ''}`, account.status === 'auth_required' ? 'danger' : ''));
    });
    if (items.some(account => account.status === 'auth_required')) block.appendChild(detailCard('메일 재인증 필요', detailText('계정 인증을 확인해줘. 자동 재인증은 제공되지 않아.', 'danger')));
    const analysis = state.mail.analysis || {};
    const failed = Number(analysis.failed) || 0;
    const queue = detailCard('메일 분석 상태', agentMetrics([['대기', analysis.pending], ['진행', analysis.analyzing], ['완료', analysis.done], ['건너뜀', analysis.skipped]]));
    const left = [accounts, queue, detailCard('메일 확인은 알림에서', detailText('확인할 메일 자체는 알림 화면에 있어.'), button('알림에서 확인', openMailAttention))];
    const right = [detailCard('알림 설정', makeMailSettings()), detailCard('저장된 선호 규칙', makeMailPreferences())];
    if (failed > 0) {
      const retry = button(state.mailRequeueRunning ? '되돌리는 중…' : `멈춘 ${failed}개 다시`, requeueMailAnalysis, true);
      retry.disabled = state.mailRequeueRunning;
      right.push(detailCard('분석 복구', detailText(`멈춘 분석 ${failed}건`, 'warn'), retry));
    }
    block.appendChild(detailColumns(left, right));
    return block;
  }

  async function loadCodexData() {
    state.codex = null;
    state.organize = null;
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
    if (state.organizeRunning || state.codexSaving || !codexCanRun()) return;
    state.organizeRunning = true;
    renderCodexSurface();
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
    if (state.organizeRunning || state.codexSaving || !codexCanRun()) return;
    state.organizeRunning = true;
    renderCodexSurface();
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

  // 홈의 `확인할 것`은 알림 탭과 같은 응답을 읽는다. 메일 전용 API를 따로 만들지
  // 않는다(설계 3절). `snoozed`는 서버가 애초에 주지 않는다. 사용자가 지금 안 보겠다고
  // 한 것을 홈 최상단에 다시 올리지 않는다(설계 4절).
  //
  // 울린 일정 알림을 메일 앞에 둔다. 그것은 시각이 이미 지난 것이고 메일 기한은
  // 며칠 뒤일 수 있다. 같은 목록 안에서는 급한 쪽이 위여야 한다.
  async function loadHomeAttention() {
    const response = await state.apiFetch('/api/notifications');
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '확인할 것을 불러오지 못했습니다.');
    const items = Array.isArray(data.notifications) ? data.notifications : [];
    state.attention = [
      ...items.filter(item => item.type === 'task_reminder'),
      ...items.filter(item => item.source === 'mail'),
    ];
    return true;
  }

  // 플래그가 꺼진 것은 오류가 아니다. 메일과 같은 이유로 503을 실패로 다루지 않는다.
  async function loadNewsBriefing() {
    const response = await state.apiFetch('/api/news/briefing');
    const data = await response.json().catch(() => ({}));
    if (response.status === 503 && data.code === 'NEWS_AGENT_DISABLED') {
      state.news = null;
      return true;
    }
    if (!response.ok) throw new Error(data.error || '뉴스를 불러오지 못했습니다.');
    state.news = data;
    return true;
  }

  // 플래그가 꺼진 것은 오류가 아니다. 꺼져 있으면 카드 자체를 그리지 않는다.
  async function loadReelsLatest() {
    state.reels = null;
    const response = await state.apiFetch('/api/reels/latest');
    const data = await response.json().catch(() => ({}));
    if (response.status === 503 && data.code === 'REELS_AGENT_DISABLED') {
      state.reels = null;
      return true;
    }
    if (!response.ok) throw new Error(data.error || 'Reels 후보를 불러오지 못했습니다.');
    state.reels = data;
    return true;
  }

  async function loadReelsEpisode() {
    state.reelsEpisode = null;
    const response = await state.apiFetch('/api/reels/episodes/latest');
    const data = await response.json().catch(() => ({}));
    if (response.status === 503 && data.code === 'REELS_PRODUCTION_DISABLED') return true;
    if (!response.ok) throw new Error(data.error || '영상 제작 상태를 불러오지 못했어.');
    state.reelsEpisode = data.episode || null;
    return true;
  }

  // --- 날씨 -----------------------------------------------------------------
  //
  // **홈 렌더의 대기 대상이 아니다.** 위치 획득이 최대 5초라 `Promise.allSettled`
  // 배열에 넣으면 홈 전체가 그만큼 늦어진다. 먼저 렌더하고 도착하면 머리줄만
  // 갱신한다(설계 19절).

  function readLastLocation() {
    try {
      const saved = JSON.parse(localStorage.getItem(LOCATION_KEY) || 'null');
      if (!Number.isFinite(saved?.lat) || !Number.isFinite(saved?.lon)) return null;
      // `capturedAt`이 없으면 나이를 잴 수 없다. `NaN > MAX`는 false라, 없는 채로
      // 두면 언제 찍힌지 모르는 좌표가 stale 검사를 그냥 통과한다.
      if (!Number.isFinite(saved.capturedAt)) return null;
      return saved;
    } catch {
      return null;
    }
  }

  function saveLastLocation(location) {
    try {
      localStorage.setItem(LOCATION_KEY, JSON.stringify(location));
    } catch {
      // 저장이 막혀도 이번 조회는 그대로 쓴다.
    }
  }

  /**
   * `getCurrentPosition()`만 쓴다. **`watchPosition()`은 쓰지 않는다.** 홈 브리핑
   * 하나 때문에 위치를 계속 따라다니게 되고, 그건 v1이 만들지 않기로 한 것이다.
   *
   * 위치 이력은 어디에도 쌓이지 않는다. 마지막 좌표 한 건만 기기에 남는다(설계 5·6절).
   */
  function currentLocation() {
    return new Promise(resolve => {
      const fallback = () => {
        const saved = readLastLocation();
        // 너무 오래된 좌표로 다른 동네 날씨를 자신 있게 보여주지 않는다.
        if (!saved || Date.now() - saved.capturedAt > LOCATION_FALLBACK_MAX_AGE_MS) return resolve(null);
        resolve({ lat: saved.lat, lon: saved.lon });
      };
      if (!navigator.geolocation?.getCurrentPosition) return fallback();
      navigator.geolocation.getCurrentPosition(
        position => {
          const location = {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            accuracy: position.coords.accuracy,
            capturedAt: Date.now(),
          };
          saveLastLocation(location);
          resolve({ lat: location.lat, lon: location.lon });
        },
        fallback,
        LOCATION_OPTIONS,
      );
    });
  }

  // 실패하면 영역이 없을 뿐이라 오류 상태를 만들지 않는다. 위치 권한을 거부했을
  // 때도 toast를 반복해 띄우지 않는다(설계 21절).
  async function refreshWeather(requestId) {
    if (!state.weatherEnabled) return;
    if (state.weather && Date.now() - state.weatherAt < WEATHER_CACHE_MS) return;
    let briefing = null;
    try {
      const location = await currentLocation();
      if (!location) return;
      const query = `?lat=${encodeURIComponent(location.lat)}&lon=${encodeURIComponent(location.lon)}`;
      const response = await state.apiFetch(`/api/weather${query}`);
      if (!response.ok) return;
      briefing = await response.json();
      if (!Number.isFinite(briefing?.temperature)) return;
    } catch {
      return;
    }
    // 늦게 온 응답이 이미 다른 화면을 덮지 않게 기존 staleness 가드를 같이 쓴다.
    if (requestId !== state.requestId) return;
    state.weather = briefing;
    state.weatherAt = Date.now();
    if (state.mode !== 'summary') return;
    // `renderSummary()`는 전부 다시 그리므로 스크롤이 튄다. 머리 노드만 바꾼다.
    const head = state.container.querySelector('.home-head');
    if (head) head.replaceWith(makeHomeHead());
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
    state.mailSettings = null;
    const response = await state.apiFetch('/api/mail/settings');
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return false;
    state.mailSettings = data.settings || null;
    return true;
  }

  async function loadMailPreferences() {
    state.mailPreferences = null;
    const response = await state.apiFetch('/api/mail/preferences');
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return false;
    state.mailPreferences = Array.isArray(data.preferences) ? data.preferences : [];
    return true;
  }

  async function removeMailPreference(id) {
    if (state.mailPreferenceSaving) return;
    state.mailPreferenceSaving = true;
    renderMailSurface();
    try {
      const response = await state.apiFetch(`/api/mail/preferences/${id}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '되돌리지 못했습니다.');
      state.showToast('규칙을 지웠어');
      await loadMailPreferences();
    } catch (error) {
      state.showToast(error.message);
    } finally {
      state.mailPreferenceSaving = false;
      renderMailSurface();
    }
  }

  async function saveMailSettings(patch) {
    if (state.mailSettingsSaving) return;
    state.mailSettingsSaving = true;
    renderMailSurface();
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
      renderMailSurface();
    }
  }

  async function requeueMailAnalysis() {
    if (state.mailRequeueRunning) return;
    state.mailRequeueRunning = true;
    renderMailSurface();
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
    workspace.className = 'schedule-agent-workspace agent-detail-workspace';
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

  async function openCards() {
    await openReels();
    state.container.querySelector('.reels-workflow-columns > .agent-detail-column:last-child')?.scrollIntoView({ block: 'start' });
  }

  async function openReels() {
    state.mode = 'reels';
    renderReelsDetail();
    await refresh();
    if (state.mode === 'reels') state.container.querySelector('.agent-detail-head h2')?.focus();
  }

  function openSummary() {
    releaseReelsMedia();
    releaseCardMedia();
    state.mode = 'summary';
    state.focusReminders = false;
    refresh();
  }

  async function openSchedule() {
    state.mode = 'schedule';
    renderScheduleDetail();
    await refresh();
    if (state.mode === 'schedule') state.container.querySelector('.agent-detail-head h2')?.focus();
  }

  async function openCodex() {
    state.mode = 'codex';
    renderCodexDetail();
    await refresh();
    if (state.mode === 'codex') state.container.querySelector('.agent-detail-head h2')?.focus();
  }

  async function openMail() {
    state.mode = 'mail';
    renderMailDetail();
    await refresh();
    if (state.mode === 'mail') state.container.querySelector('.agent-detail-head h2')?.focus();
  }

  // 홈은 무엇을 봐야 하는지만 말한다. 완료·미루기는 알림 탭이 맡으므로 그쪽 메일
  // 필터를 열어준다(설계 2절).
  function openMailAttention() {
    global.HomeDashboard?.openNotifications('mail');
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
      if (state.mode === 'schedule') renderScheduleDetail();
      return;
    }
    if (state.mode === 'codex') {
      const result = await Promise.allSettled([loadCodexData()]);
      state.codexError = result[0].status === 'rejected' ? result[0].reason.message : '';
      if (state.mode === 'codex') renderCodexDetail();
      return;
    }
    if (state.mode === 'mail') {
      const [mail] = await Promise.allSettled([
        loadMailData(), loadMailSettings(), loadMailPreferences(),
      ]);
      state.mailError = mail.status === 'rejected' ? mail.reason.message : '';
      if (state.mode === 'mail') renderMailDetail();
      return;
    }
    if (state.mode === 'reels') {
      const results = await Promise.allSettled([loadReelsLatest(), loadReelsEpisode(), loadCards()]);
      state.reelsError = results[0].status === 'rejected' ? results[0].reason.message : '';
      state.reelsEpisodeError = results[1].status === 'rejected' ? results[1].reason.message : '';
      if (state.mode === 'reels') renderReelsDetail();
      return;
    }
    renderLoading();
    const performance = Promise.allSettled([loadInstagramInsights(), loadYoutubeInsights()]);
    // 한 소스가 죽어도 나머지 영역은 살아 있어야 한다.
    const [scheduleResult, codexResult, mailResult, , , reelsResult, episodeResult] = await Promise.allSettled([
      state.enabled ? loadAgentData() : Promise.resolve(false),
      loadCodexData(),
      loadMailData(),
      loadMailSettings(),
      loadMailPreferences(),
      loadReelsLatest(),
      loadReelsEpisode(),
      loadCards(),
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
    state.reelsError = reelsResult.status === 'rejected' ? reelsResult.reason.message : '';
    state.reelsEpisodeError = episodeResult.status === 'rejected' ? episodeResult.reason.message : '';
    if (state.mode === 'summary') renderSummary();
    const [instagramResult, youtubeResult] = await performance;
    state.instagramInsightsError = instagramResult.status === 'rejected' ? instagramResult.reason.message : '';
    state.youtubeInsightsError = youtubeResult.status === 'rejected' ? youtubeResult.reason.message : '';
    if (state.mode === 'summary') renderSummary();
  }

  function show() {
    if (!state.initialized) return;
    refresh();
  }

  function init({ apiFetch, enabled, pushClient, showToast, weatherEnabled }) {
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
    state.weatherEnabled = weatherEnabled === true;
    state.pushClient = pushClient;
    state.pushState = pushClient.getState();
    state.showToast = showToast;
    state.container = container;
    let cycleId = reelsCycle().id;
    setInterval(() => {
      const next = reelsCycle().id;
      if (next === cycleId) return;
      cycleId = next;
      releaseReelsMedia();
      if (['summary', 'reels'].includes(state.mode) && state.container.offsetParent !== null) void refresh();
    }, 1000);
    state.initialized = true;
  }

  global.AgentPanel = { init, show, refresh, openTasks };
})(window);
