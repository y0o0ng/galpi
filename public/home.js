'use strict';

(function setupHomeDashboard(global) {
  const FOCUSABLE_CARDS = new Set(['tasks', 'calendar', 'mail', 'notifications', 'dday', 'notes']);
  const LOCATION_KEY = 'councilLastLocation';
  const WEATHER_CACHE_MS = 15 * 60 * 1000;
  const LOCATION_FALLBACK_MAX_AGE_MS = 6 * 60 * 60 * 1000;
  const state = {
    initialized: false,
    apiFetch: null,
    showToast: null,
    route: 'home',
    homeView: 'overview',
    focusedCard: null,
    notesView: 'notes',
    selectedDate: null,
    summary: null,
    tasks: [],
    completedToday: 0,
    completedTasks: [],
    notifications: [],
    recentSaves: [],
    mail: null,
    notes: [],
    weather: null,
    weatherAt: 0,
    weatherEnabled: false,
  };

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }

  function action(label, handler, primary = false) {
    const button = node('button', `home-card-action${primary ? ' primary' : ''}`, label);
    button.type = 'button';
    button.addEventListener('click', event => {
      event.stopPropagation();
      handler();
    });
    return button;
  }

  function formatDateTime(seconds) {
    if (!Number.isFinite(Number(seconds))) return '예정 없음';
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', weekday: 'short',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(Number(seconds) * 1000));
  }

  function updateClock() {
    const target = document.getElementById('home-now');
    if (!target) return;
    target.textContent = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'long',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date());
  }

  function card(id, title, meta, content, { focusable = true } = {}) {
    const article = node('article', `home-card home-card-${id}`);
    article.dataset.cardId = id;
    const head = node('header', 'home-card-head');
    head.append(node('h2', '', title), node('span', '', meta || ''));
    article.append(head, content);
    if (focusable && FOCUSABLE_CARDS.has(id)) {
      article.classList.add('focusable');
      article.tabIndex = 0;
      article.setAttribute('role', 'button');
      article.setAttribute('aria-label', `${title} 자세히 보기`);
      const focus = () => setFocusedCard(id);
      article.addEventListener('click', event => {
        if (!event.target.closest('button, a, input, select, textarea')) {
          event.stopPropagation();
          focus();
        }
      });
      article.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          focus();
        }
      });
    }
    return article;
  }

  function counts() {
    return state.summary?.counts || {};
  }

  function renderWeather() {
    const body = node('div', 'weather-card-content');
    const line = node('div', 'weather-main');
    line.append(node('span', 'weather-symbol', state.weather?.icon || '–'), node('strong', '', state.weather ? `${Math.round(state.weather.temperature)}°` : '—°'));
    body.append(line, node('p', 'priority-p3', state.weather?.message || (state.weatherEnabled ? '현재 위치의 날씨를 확인하고 있어.' : '날씨 정보 없음')));
    return card('weather', '날씨', state.weather?.sourceLabel || '', body, { focusable: false });
  }

  function taskRows(limit = 5) {
    const list = node('div', 'home-task-list');
    const today = kstDate(Date.now() / 1000);
    const rows = [
      ...state.completedTasks.map(task => ({ taskId: task.id, title: task.title, dueAt: task.dueAt, bucket: 'done' })),
      ...state.tasks.filter(task => taskDate(task) && taskDate(task) <= today)
        .map(task => ({ taskId: task.id, title: task.title, dueAt: task.dueAt, bucket: taskDate(task) < today ? 'overdue' : 'today' })),
    ].sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0)).slice(0, limit);
    if (!rows.length && Array.isArray(state.summary?.preview)) rows.push(...state.summary.preview.slice(0, limit));
    if (!rows.length) list.append(node('p', 'home-card-empty', '오늘 확인할 일정 없음'));
    rows.forEach(item => {
      const row = node('div', 'home-task-row');
      row.classList.toggle('done', item.bucket === 'done');
      row.append(node('span', `task-dot ${item.bucket}`), node('time', '', item.dueAt ? formatDateTime(item.dueAt).split(' ').slice(-1)[0] : ''), node('strong', '', item.title || '제목 없는 일정'));
      const task = state.tasks.find(entry => entry.id === item.taskId);
      if (state.focusedCard === 'tasks' && task && item.bucket !== 'done') {
        const controls = node('div', 'home-task-row-actions');
        const complete = action('완료', () => global.TaskPanel?.completeFromHome(task, complete));
        controls.append(complete, action('지연', () => {
          const host = document.querySelector('.home-card-tasks .home-focus-extra');
          if (host) global.TaskPanel?.editFromHome(task, host);
        }));
        row.append(controls);
      }
      list.append(row);
    });
    return list;
  }

  function renderTasks() {
    const body = node('div', 'tasks-card-content');
    const total = Number(counts().overdue || 0) + Number(counts().today || 0);
    const summary = node('div', 'home-count-summary');
    summary.append(node('strong', '', String(total)), node('span', '', '할 일'), node('p', '', `지연 ${counts().overdue || 0} · 예정 ${counts().upcoming || 0}`));
    const progressTotal = total + state.completedToday;
    if (progressTotal) {
      const progress = node('div', 'home-task-progress');
      progress.setAttribute('role', 'progressbar');
      progress.setAttribute('aria-label', '오늘 일정 완료율');
      progress.setAttribute('aria-valuemin', '0');
      progress.setAttribute('aria-valuemax', String(progressTotal));
      progress.setAttribute('aria-valuenow', String(state.completedToday));
      const fill = node('div', 'home-task-progress-fill');
      fill.style.width = `${state.completedToday / progressTotal * 100}%`;
      progress.append(fill);
      summary.insertBefore(progress, summary.lastChild);
    }
    body.append(summary, taskRows(state.focusedCard === 'tasks' ? 8 : 5));
    if (state.focusedCard === 'tasks') {
      body.append(node('div', 'home-focus-extra'));
    }
    return card('tasks', '할일', 'Today', body);
  }

  function kstDate(seconds) {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(Number(seconds) * 1000));
    const part = type => parts.find(item => item.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  function taskDate(task) {
    if (task?.dueKind === 'date') return task.dueDate || '';
    return task?.dueKind === 'datetime' && task.dueAt ? kstDate(task.dueAt) : '';
  }

  function monthDays() {
    const [year, month] = (state.selectedDate || kstDate(Date.now() / 1000)).split('-').map(Number);
    const first = new Date(Date.UTC(year, month - 1, 1));
    const mondayOffset = (first.getUTCDay() + 6) % 7;
    const start = new Date(Date.UTC(year, month - 1, 1 - mondayOffset));
    const weeks = Math.ceil((mondayOffset + new Date(Date.UTC(year, month, 0)).getUTCDate()) / 7);
    return Array.from({ length: weeks * 7 }, (_, index) => {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + index);
      const key = [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0')].join('-');
      return { date, key, inMonth: date.getUTCMonth() === month - 1, year, month: month - 1 };
    });
  }

  function renderCalendar() {
    const body = node('div', 'calendar-card-content');
    const days = monthDays();
    const month = days.find(item => item.inMonth);
    const monthHead = node('div', 'calendar-month-head');
    monthHead.append(node('strong', '', `${month.month + 1}월`), node('span', '', `${month.year}년`));
    const grid = node('div', `calendar-month-grid${days.length === 42 ? ' six-weeks' : ''}`);
    ['월', '화', '수', '목', '금', '토', '일'].forEach(label => grid.append(node('span', 'calendar-weekday', label)));
    const today = kstDate(Date.now() / 1000);
    const compactAnchor = state.selectedDate || today;
    const compactWeek = Math.max(0, Math.floor(days.findIndex(item => item.key === compactAnchor) / 7));
    const compactPairStart = Math.min(compactWeek, days.length / 7 - 2);
    days.forEach(item => {
      const day = node('button', 'calendar-day');
      day.type = 'button';
      day.append(node('span', 'calendar-day-number', String(item.date.getUTCDate())));
      day.classList.toggle('outside', !item.inMonth);
      day.classList.toggle('saturday', item.date.getUTCDay() === 6);
      day.classList.toggle('sunday', item.date.getUTCDay() === 0);
      day.classList.toggle('today', item.key === today);
      day.classList.toggle('selected', item.key === state.selectedDate);
      day.classList.toggle('outside-compact-week', Math.floor(days.indexOf(item) / 7) !== compactWeek);
      day.classList.toggle('outside-compact-pair', Math.floor(days.indexOf(item) / 7) < compactPairStart || Math.floor(days.indexOf(item) / 7) > compactPairStart + 1);
      const hasEvent = state.tasks.some(task => taskDate(task) === item.key);
      if (hasEvent) day.append(node('i', '', ''));
      day.addEventListener('click', event => {
        event.stopPropagation();
        state.selectedDate = item.key;
        if (state.focusedCard !== 'calendar') setFocusedCard('calendar');
        else renderOverview();
      });
      grid.append(day);
    });
    const selectedKey = state.selectedDate || today;
    const allSelectedTasks = state.tasks.filter(task => taskDate(task) === selectedKey);
    const selectedTasks = allSelectedTasks.slice(0, 4);
    const agenda = node('div', 'calendar-agenda');
    const selectedLabel = new Intl.DateTimeFormat('ko-KR', { timeZone: 'UTC', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(`${selectedKey}T00:00:00Z`));
    agenda.append(node('strong', '', `${state.focusedCard === 'calendar' ? '' : `${selectedLabel} · `}일정 ${allSelectedTasks.length}개`));
    selectedTasks.forEach(task => {
      const row = node('p', 'calendar-event-row');
      row.append(node('time', '', task.dueAt ? formatDateTime(task.dueAt).split(' ').slice(-1)[0] : ''), node('span', '', task.title));
      agenda.append(row);
    });
    if (!selectedTasks.length) agenda.append(node('p', 'home-card-empty', '등록된 일정 없음'));
    body.append(monthHead, grid, agenda);
    if (state.focusedCard === 'calendar') {
      const actions = node('div', 'home-card-actions');
      actions.append(
        node('span', 'calendar-selected-date', selectedLabel),
        node('span', 'calendar-action-divider'),
        action('전체 일정', () => openTaskPanel({ view: 'today' })),
        node('span', 'calendar-action-divider'),
        action('일정 추가하기', () => openTaskPanel({ compose: true })),
      );
      body.append(actions, node('div', 'home-focus-extra'));
    }
    return card('calendar', '달력', '', body);
  }

  function mailNotifications() {
    return state.notifications.filter(item => item.source === 'mail');
  }

  function renderMail() {
    const body = node('div', 'mail-card-content');
    const analysis = state.mail?.analysis || {};
    const summary = node('div', 'home-count-summary');
    summary.append(node('strong', '', String(mailNotifications().length)), node('span', '', '새 메일'));
    const list = node('div', 'home-mail-list');
    mailNotifications().slice(0, 4).forEach(item => {
      const row = node('div', 'home-mail-row');
      row.append(node('strong', '', item.sender || item.senderAddress || '메일'), node('span', '', item.subject || item.title || item.text || '확인할 메일'));
      list.append(row);
    });
    if (!list.childElementCount) list.append(node('p', 'home-card-empty', `분석 대기 ${analysis.pending || 0} · 완료 ${analysis.done || 0}`));
    body.append(summary, list);
    if (state.focusedCard === 'mail') body.append(node('div', 'home-focus-extra'));
    return card('mail', '메일', 'Today', body);
  }

  function renderNotifications() {
    const body = node('div', 'notification-card-content');
    const summary = node('div', 'home-count-summary');
    summary.append(node('strong', '', String(state.notifications.length)), node('span', '', '새 알림'));
    const list = node('ul', 'home-notification-list');
    const groups = [
      ['일정 알림', state.notifications.filter(item => item.type === 'task_reminder').length, () => openTasks({ focusReminders: true })],
      ['시스템 알림', state.notifications.filter(item => item.source === 'system' || item.source === 'codex').length, () => mountNotification('system')],
      ['새 메일', mailNotifications().length, () => setFocusedCard('mail')],
      ['최근 저장', state.recentSaves.length, () => mountNotification('saves')],
    ];
    groups.forEach(([label, value, handler]) => {
      const item = node('li');
      if (state.focusedCard === 'notifications') {
        const button = action('', handler);
        button.append(node('span', '', label), node('span', '', `${value}개`));
        item.append(button);
      } else item.append(node('span', '', label), node('span', '', `${value}개`));
      list.append(item);
    });
    body.append(summary, list);
    if (state.focusedCard === 'notifications') {
      const detail = node('div', 'home-notification-groups');
      const system = state.notifications.filter(item => item.source === 'system' || item.source === 'codex');
      const mail = mailNotifications();
      const reminders = state.notifications.filter(item => item.type === 'task_reminder');
      const groups = [
        ['시스템 알림', system.length, [
          ['병합 검토', system.filter(item => item.type === 'merge').length],
          ['분리 검토', system.filter(item => item.type === 'split').length],
          ['기타', system.filter(item => !['merge', 'split'].includes(item.type)).length],
        ]],
        ['새 메일', mail.length, [
          ['Gmail', mail.filter(item => item.provider === 'gmail').length],
          ['Works', mail.filter(item => item.provider === 'works').length],
          ['Naver', mail.filter(item => item.provider === 'naver').length],
        ]],
        ['일정 알림', reminders.length, [['일정 알림', reminders.length]]],
        ['강의 노트', '준비 중', [['전사 완료', '준비 중']]],
      ];
      groups.forEach(([label, value, rows]) => {
        const group = node('div', 'home-notification-group');
        const heading = node('div', 'home-notification-group-head');
        heading.append(node('strong', '', label), node('span', '', typeof value === 'number' ? `${value}개` : value));
        group.append(heading);
        rows.forEach(([name, count]) => {
          const row = node('div', 'home-notification-detail-row');
          row.append(node('span', '', name), node('span', '', typeof count === 'number' ? String(count) : count));
          group.append(row);
        });
        detail.append(group);
      });
      body.append(detail, node('div', 'home-focus-extra'));
    }
    return card('notifications', '알림', 'Today', body);
  }

  function ddayItems() {
    const dayNumber = value => {
      const [year, month, day] = value.split('-').map(Number);
      return Date.UTC(year, month - 1, day) / 86400000;
    };
    const today = dayNumber(kstDate(Date.now() / 1000));
    return state.tasks.filter(task => task.lifecycle === 'active' && taskDate(task)).map(task => ({
      task,
      days: dayNumber(taskDate(task)) - today,
    })).filter(item => item.days >= 0).sort((a, b) => a.days - b.days).slice(0, 3);
  }

  function renderDday() {
    const body = node('div', 'dday-card-content');
    const items = ddayItems();
    const list = state.focusedCard === 'dday' ? node('div', 'dday-focus-list') : body;
    items.forEach(item => {
      const row = node('div', 'dday-row');
      row.append(node('strong', '', item.days === 0 ? 'D-Day' : `D-${item.days}`), node('span', '', item.task.title));
      list.append(row);
    });
    if (!items.length) list.append(node('p', 'home-card-empty', '다가오는 일정 없음'));
    if (state.focusedCard === 'dday') {
      const management = node('div', 'dday-management');
      const head = node('div', 'dday-management-head');
      head.append(node('strong', '', 'D-Day 관리'), action('+ 추가', () => openTaskPanel({ compose: true })));
      management.append(head);
      items.forEach(item => {
        const row = node('div', 'dday-management-row');
        const label = node('div');
        label.append(node('strong', '', item.task.title), node('span', '', taskDate(item.task)));
        const edit = action('수정', () => {
          const host = document.querySelector('.home-card-dday .home-focus-extra');
          if (host) global.TaskPanel?.editFromHome(item.task, host);
        });
        const remove = action('삭제', () => global.TaskPanel?.deleteFromHome(item.task, remove));
        row.append(label, edit, remove);
        management.append(row);
      });
      body.append(list, management, node('div', 'home-focus-extra'));
    }
    return card('dday', '다가오는 날', '', body);
  }

  function renderLecture() {
    const body = node('div', 'lecture-card-content');
    body.append(node('strong', '', '준비 중'), node('p', '', '강의 노트 런타임이 연결되면 여기에 최근 처리 상태가 표시돼.'));
    return card('lecture', '강의 노트', '', body, { focusable: false });
  }

  function renderNotes() {
    const body = node('div', 'notes-card-content');
    const list = node('div', 'home-notes-list');
    state.notes.slice(0, 3).forEach(note => {
      const item = node('button', 'home-note-row');
      item.type = 'button';
      item.append(node('strong', '', note.title || note.filename), node('span', '', note.noteType || '노트'));
      item.addEventListener('click', event => {
        event.stopPropagation();
        global.NotePanel?.queueOpen(note);
        setFocusedCard('notes');
      });
      list.append(item);
    });
    if (!list.childElementCount) list.append(node('p', 'home-card-empty', '저장된 노트 없음'));
    if (state.focusedCard !== 'notes') body.append(list);
    if (state.focusedCard === 'notes') {
      const tabs = node('nav', 'home-library-tabs');
      tabs.setAttribute('aria-label', '노트 보기 선택');
      tabs.append(action('노트', () => mountLibrary('notes'), true), node('span', 'home-library-divider'), action('논문', () => mountLibrary('papers')));
      body.append(node('div', 'home-focus-extra'));
      const article = card('notes', '노트', '최근 저장 노트', body);
      article.querySelector('.home-card-head').replaceChildren(tabs, node('span', 'home-library-meta', '최근 저장 노트'));
      return article;
    }
    return card('notes', '노트', '최근 저장 노트', body);
  }

  function parkSharedPanels() {
    const notification = document.getElementById('notification-panel');
    const store = document.getElementById('shared-panel-store');
    if (notification && store && notification.parentElement !== store) store.appendChild(notification);
    const knowledge = document.getElementById('knowledge-panel');
    const note = document.getElementById('note-panel');
    const paper = document.getElementById('paper-panel');
    if (knowledge && note && note.parentElement !== knowledge) knowledge.appendChild(note);
    if (knowledge && paper && paper.parentElement !== knowledge) knowledge.appendChild(paper);
  }

  function mountLibrary(tab = state.notesView, host = document.querySelector('.home-card-notes .home-focus-extra')) {
    if (!host) return;
    state.notesView = tab;
    const note = document.getElementById('note-panel');
    const paper = document.getElementById('paper-panel');
    if (!document.getElementById('home-note-detail')) note.append(node('div', 'home-library-detail'));
    if (!document.getElementById('home-paper-detail')) paper.append(node('div', 'home-library-detail'));
    note.lastElementChild.id = 'home-note-detail';
    paper.lastElementChild.id = 'home-paper-detail';
    host.append(note, paper);
    const [noteTab, paperTab] = host.closest('.home-card-notes').querySelectorAll('.home-library-tabs button');
    noteTab?.classList.toggle('primary', tab === 'notes');
    paperTab?.classList.toggle('primary', tab === 'papers');
    noteTab?.setAttribute('aria-pressed', String(tab === 'notes'));
    paperTab?.setAttribute('aria-pressed', String(tab === 'papers'));
    host.closest('.home-card-notes').querySelector('.home-library-meta').textContent = tab === 'notes' ? '최근 저장 노트' : '저장된 논문';
    global.PaperPanel?.setTab(tab);
  }

  function mountNotification(filter) {
    const host = document.querySelector(`.home-card-${state.focusedCard} .home-focus-extra`);
    const panel = document.getElementById('notification-panel');
    if (!host || !panel) return;
    host.appendChild(panel);
    panel.hidden = false;
    global.NotificationPanel?.show(filter);
  }

  function renderOverview() {
    const grid = document.getElementById('home-grid');
    if (!grid) return;
    parkSharedPanels();
    grid.className = state.focusedCard ? `has-focus focus-${state.focusedCard}` : '';
    const left = node('div', 'home-grid-column home-grid-left');
    const right = node('div', 'home-grid-column home-grid-right');
    left.append(renderWeather(), renderTasks(), renderLecture(), renderNotes());
    right.append(renderCalendar(), renderNotifications(), renderMail(), renderDday());
    grid.replaceChildren(left, right);
    grid.querySelectorAll('.home-card').forEach(item => item.classList.toggle('focused', item.dataset.cardId === state.focusedCard));
    const collapse = document.getElementById('home-focus-collapse');
    collapse.hidden = !state.focusedCard;
    if (state.focusedCard === 'mail') mountNotification('mail');
    if (state.focusedCard === 'notes') mountLibrary();
  }

  function transitionOverview(nextCard) {
    const grid = document.getElementById('home-grid');
    const previousFocus = state.focusedCard;
    const anchorId = nextCard || previousFocus;
    const before = new Map([...grid.querySelectorAll('.home-card')].map(card => [card.dataset.cardId, card.getBoundingClientRect()]));
    state.focusedCard = nextCard;
    renderOverview();
    const phone = matchMedia('(max-width: 640px)').matches;
    if (phone && anchorId && before.has(anchorId)) {
      const current = grid.querySelector(`[data-card-id="${anchorId}"]`)?.getBoundingClientRect();
      if (current) document.getElementById('home-page').scrollTop += current.top - before.get(anchorId).top;
    }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    grid.querySelectorAll('.home-card').forEach(card => {
      const previous = before.get(card.dataset.cardId);
      if (!previous) return;
      const current = card.getBoundingClientRect();
      if (!current.width || !current.height) return;
      card.animate([
        { transform: `translate(${previous.left - current.left}px, ${previous.top - current.top}px)`, width: `${previous.width}px`, height: `${previous.height}px` },
        { transform: 'none', width: `${current.width}px`, height: `${current.height}px` },
      ], { duration: 320, easing: 'cubic-bezier(.2,.7,.2,1)' });
    });
  }

  function setFocusedCard(id) {
    if (!FOCUSABLE_CARDS.has(id) || state.focusedCard === id) return;
    transitionOverview(id);
    document.querySelector(`.home-card[data-card-id="${id}"]`)?.focus({ preventScroll: true });
  }

  function collapseFocus() {
    if (!state.focusedCard) return;
    transitionOverview(null);
  }

  function openTaskPanel(options) {
    const host = document.querySelector(`.home-card-${state.focusedCard} .home-focus-extra`);
    if (!host) return;
    host.replaceChildren();
    global.TaskPanel?.render(host, options);
  }

  function moveLibraryForRoute(route) {
    const note = document.getElementById('note-panel');
    const paper = document.getElementById('paper-panel');
    if (!note || !paper) return;
    if (route === 'notes') {
      document.getElementById('notes-page-views').append(note, paper);
      global.PaperPanel?.setTab('notes');
    } else if (route === 'chat') {
      document.getElementById('knowledge-panel').append(note, paper);
      global.PaperPanel?.setTab('notes');
    }
  }

  function setHomeView(view) {
    state.homeView = view === 'agents' ? 'agents' : 'overview';
    document.querySelectorAll('[data-home-view]').forEach(button => {
      const active = button.dataset.homeView === state.homeView;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const overview = document.getElementById('home-overview');
    const agents = document.getElementById('home-agents');
    overview.hidden = state.homeView !== 'overview';
    agents.hidden = state.homeView !== 'agents';
    overview.classList.toggle('active', state.homeView === 'overview');
    agents.classList.toggle('active', state.homeView === 'agents');
    if (state.homeView === 'agents') global.AgentPanel?.show();
    else renderOverview();
  }

  function setRoute(route, homeView) {
    if (!['home', 'chat', 'notes', 'settings'].includes(route)) route = 'home';
    state.route = route;
    document.body.dataset.productRoute = route;
    document.querySelectorAll('[data-product-page]').forEach(page => page.classList.toggle('active', page.dataset.productPage === route));
    document.querySelectorAll('[data-product-route]').forEach(button => button.classList.toggle('active', button.dataset.productRoute === route));
    global.PaperPanel?.close();
    moveLibraryForRoute(route);
    if (route === 'home') setHomeView(homeView || state.homeView);
    if (route === 'notes') global.NotePanel?.show();
  }

  function storedLocation() {
    try {
      const value = JSON.parse(localStorage.getItem(LOCATION_KEY));
      return Number.isFinite(value?.lat) && Number.isFinite(value?.lon)
        && Date.now() - Number(value.savedAt) < LOCATION_FALLBACK_MAX_AGE_MS ? value : null;
    } catch { return null; }
  }

  async function currentLocation() {
    if (!navigator.geolocation) return storedLocation();
    try {
      const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
        resolve, reject, { enableHighAccuracy: false, timeout: 5000, maximumAge: WEATHER_CACHE_MS },
      ));
      const value = { lat: position.coords.latitude, lon: position.coords.longitude, savedAt: Date.now() };
      localStorage.setItem(LOCATION_KEY, JSON.stringify(value));
      return value;
    } catch { return storedLocation(); }
  }

  async function loadWeather() {
    if (!state.weatherEnabled) return;
    if (state.weather && Date.now() - state.weatherAt < WEATHER_CACHE_MS) return;
    const location = await currentLocation();
    if (!location) return;
    const response = await state.apiFetch(`/api/weather?lat=${encodeURIComponent(location.lat)}&lon=${encodeURIComponent(location.lon)}`);
    if (!response.ok) return;
    state.weather = await response.json();
    state.weatherAt = Date.now();
    if (state.route === 'home' && state.homeView === 'overview') renderOverview();
  }

  async function refresh() {
    const requests = await Promise.allSettled([
      state.apiFetch('/api/tasks/summary'),
      state.apiFetch('/api/tasks?view=all&limit=100'),
      state.apiFetch('/api/tasks?view=history&status=done&limit=100'),
      state.apiFetch('/api/notifications'),
      state.apiFetch('/api/mail/status'),
      state.apiFetch('/api/vault/notes?excludeNoteType=paper&limit=6'),
    ]);
    const read = async (result, fallback) => {
      if (result.status !== 'fulfilled' || !result.value.ok) return fallback;
      return result.value.json().catch(() => fallback);
    };
    const [summary, tasks, completed, notifications, mail, notes] = await Promise.all([
      read(requests[0], null), read(requests[1], {}), read(requests[2], {}),
      read(requests[3], {}), read(requests[4], null), read(requests[5], {}),
    ]);
    state.summary = summary;
    state.tasks = Array.isArray(tasks?.tasks) ? tasks.tasks : [
      ...(tasks?.overdue || []), ...(tasks?.today || []), ...(tasks?.upcoming || []),
    ];
    state.completedTasks = (completed?.tasks || []).filter(task => task.closedAt && kstDate(task.closedAt) === kstDate(Date.now() / 1000));
    state.completedToday = state.completedTasks.length;
    state.notifications = Array.isArray(notifications?.notifications) ? notifications.notifications : [];
    state.recentSaves = Array.isArray(notifications?.recentSaves) ? notifications.recentSaves : [];
    state.mail = mail;
    state.notes = Array.isArray(notes?.notes) ? notes.notes : [];
    if (state.route === 'home' && state.homeView === 'overview') renderOverview();
    void loadWeather().catch(() => {});
  }

  function openNotifications(filter = 'all') {
    setRoute('home', 'overview');
    setFocusedCard(filter === 'mail' ? 'mail' : 'notifications');
    if (filter !== 'mail') mountNotification(filter);
  }

  function openTasks(options = {}) {
    if (options.focusReminders) {
      setRoute('home', 'agents');
      global.AgentPanel?.openTasks(options);
      return;
    }
    setRoute('home', 'overview');
    setFocusedCard(options.compose ? 'calendar' : 'tasks');
    openTaskPanel(options.compose ? { compose: true, initialTitle: options.initialTitle || '' } : { view: options.view || 'today' });
  }

  function handleInitialUrl() {
    const params = new URLSearchParams(global.location.search);
    if (params.get('panel') === 'agents' || params.get('notification') === 'tasks') {
      openTasks({ view: 'today', focusReminders: params.get('taskView') === 'reminders' || params.get('notification') === 'tasks' });
    } else if (params.get('panel') === 'notifications') {
      openNotifications(params.get('notification') === 'mail' ? 'mail' : 'all');
    }
  }

  function init({ apiFetch, showToast, weatherEnabled = false }) {
    if (state.initialized) return;
    state.apiFetch = apiFetch;
    state.showToast = showToast;
    state.weatherEnabled = weatherEnabled;
    document.querySelectorAll('[data-product-route]').forEach(button => button.addEventListener('click', () => {
      if (button.dataset.homeCardTarget === 'notifications') openNotifications();
      else setRoute(button.dataset.productRoute, button.dataset.homeViewTarget);
    }));
    document.querySelectorAll('[data-home-view]').forEach(button => button.addEventListener('click', () => setHomeView(button.dataset.homeView)));
    document.querySelectorAll('.shell-theme-button').forEach(button => button.addEventListener('click', () => document.getElementById('theme-toggle')?.click()));
    document.getElementById('home-focus-collapse').addEventListener('click', collapseFocus);
    document.getElementById('home-page').addEventListener('click', event => {
      if (state.focusedCard && !event.target.closest('.home-card.focused') && !event.target.closest('#home-focus-collapse')) collapseFocus();
    });
    state.initialized = true;
    updateClock();
    setInterval(updateClock, 60000);
    setRoute('home', 'overview');
    void refresh();
  }

  global.HomeDashboard = { init, refresh, setRoute, setHomeView, setFocusedCard, openNotifications, openTasks, handleInitialUrl };
})(window);
