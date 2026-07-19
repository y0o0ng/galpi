'use strict';

(function setupNotificationPanel(global) {
  const state = {
    initialized: false,
    requestId: 0,
    filter: 'all',
    notifications: [],
    recentSaves: [],
    apiFetch: null,
    showToast: null,
    onSplit: null,
    openNote: null,
  };

  function elements() {
    return {
      panel: document.getElementById('notification-panel'),
      refresh: document.getElementById('notification-panel-refresh'),
      tabs: [...document.querySelectorAll('#notification-panel [data-notification-filter]')],
      content: document.getElementById('notification-panel-content'),
    };
  }

  function emptyState(message, danger = false) {
    const empty = document.createElement('div');
    empty.className = `notification-empty${danger ? ' danger' : ''}`;
    empty.textContent = message;
    return empty;
  }

  function renderLoading() {
    const { content } = elements();
    content.replaceChildren();
    const skeleton = document.createElement('div');
    skeleton.className = 'notification-panel-skeleton';
    skeleton.setAttribute('aria-label', '알림을 불러오는 중');
    skeleton.innerHTML = '<span></span><span></span><span></span>';
    content.appendChild(skeleton);
  }

  function formatRecentSaveTime(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    return new Intl.DateTimeFormat('ko-KR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(seconds * 1000));
  }

  function makeRecentSaveCard(item) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'notification-card type-save recent-save-card';
    card.setAttribute('aria-label', `${item.note?.title || '토픽'} 열기`);

    const top = document.createElement('div');
    top.className = 'notification-card-top';
    const badge = document.createElement('span');
    badge.className = 'notification-badge';
    badge.textContent = item.action === 'created' ? '새 토픽' : '토픽에 추가';
    const time = document.createElement('span');
    time.className = 'notification-source';
    time.textContent = formatRecentSaveTime(item.createdAt);
    top.append(badge, time);

    const note = document.createElement('div');
    note.className = 'notification-note';
    note.textContent = item.note?.title || '대상 토픽 없음';
    const text = document.createElement('div');
    text.className = 'notification-text';
    text.textContent = item.text || '저장 내용 없음';
    const file = document.createElement('div');
    file.className = 'notification-file recent-save-file';
    file.textContent = item.note?.filename || '';

    card.append(top, note, text, file);
    card.addEventListener('click', () => {
      if (item.note?.filename) state.openNote({ ...item.note, noteType: 'topic' });
    });
    return card;
  }

  function primaryActionLabel(item) {
    if (item.type === 'merge') return '병합 실행';
    if (item.type === 'split') return '분리 검토';
    if (item.type === 'policy' && item.executable) return '정책 적용';
    if (item.type === 'manual_check') return '확인 완료';
    return '검토 완료';
  }

  function doneMessage(item) {
    if (item.type === 'merge') return '병합됨';
    if (item.type === 'split' && item.executable) return '분리됨';
    if (item.type === 'policy' && item.executable) return '정책 파일에 반영됨';
    if (item.type === 'manual_check') return '확인 완료, 동기화됨';
    return '검토 완료';
  }

  async function decide(item, action, card) {
    const buttons = [...card.querySelectorAll('button')];
    buttons.forEach(button => { button.disabled = true; });
    try {
      const response = await state.apiFetch(
        `/api/notifications/${encodeURIComponent(item.id)}/${action}`,
        { method: 'POST' },
      );
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '알림 처리 실패');
      state.notifications = state.notifications.filter(notification => notification.id !== item.id);
      renderItems();
      state.showToast(action === 'approve' ? doneMessage(item) : '무시됨');
    } catch (error) {
      state.showToast(error.message || '서버 연결 오류');
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  function makeNotificationCard(item) {
    const card = document.createElement('article');
    card.className = `notification-card type-${item.type || 'review'}`;

    const top = document.createElement('div');
    top.className = 'notification-card-top';
    const badge = document.createElement('span');
    badge.className = 'notification-badge';
    badge.textContent = item.title || '알림';
    const source = document.createElement('span');
    source.className = 'notification-source';
    source.textContent = item.source || 'system';
    top.append(badge, source);

    const note = document.createElement('div');
    note.className = 'notification-note';
    note.textContent = item.note?.title || '관련 노트 없음';
    const text = document.createElement('div');
    text.className = 'notification-text';
    text.textContent = item.text || '';

    const footer = document.createElement('div');
    footer.className = 'notification-footer';
    const file = document.createElement('span');
    file.className = 'notification-file';
    file.textContent = item.note?.filename || '';
    const actions = document.createElement('div');
    actions.className = 'notification-card-actions';

    const approve = document.createElement('button');
    approve.type = 'button';
    approve.className = 'notification-action primary';
    approve.textContent = primaryActionLabel(item);
    approve.addEventListener('click', () => {
      if (item.type === 'split') {
        if (item.note?.filename) state.onSplit(item.note.filename);
        else state.showToast('이 제안에 노트 정보가 없어');
        return;
      }
      decide(item, 'approve', card);
    });
    actions.appendChild(approve);

    if (item.ignorable !== false) {
      const ignore = document.createElement('button');
      ignore.type = 'button';
      ignore.className = 'notification-action';
      ignore.textContent = '무시';
      ignore.addEventListener('click', () => decide(item, 'ignore', card));
      actions.appendChild(ignore);
    }
    footer.append(file, actions);
    card.append(top, note, text, footer);
    return card;
  }

  function renderItems() {
    const { content } = elements();
    content.replaceChildren();
    if (state.filter === 'saves') {
      if (state.recentSaves.length === 0) {
        content.appendChild(emptyState('최근 토픽 저장 기록이 없습니다.'));
        return;
      }
      state.recentSaves.forEach(item => content.appendChild(makeRecentSaveCard(item)));
      return;
    }

    const items = state.notifications.filter(item => state.filter === 'all' || item.source === state.filter);
    if (items.length === 0) {
      content.appendChild(emptyState('표시할 알림이 없습니다.'));
      return;
    }
    items.forEach(item => content.appendChild(makeNotificationCard(item)));
  }

  function selectFilter(filter) {
    state.filter = filter;
    elements().tabs.forEach(tab => {
      const active = tab.dataset.notificationFilter === filter;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    renderItems();
  }

  async function refresh() {
    const requestId = ++state.requestId;
    renderLoading();
    try {
      const response = await state.apiFetch('/api/notifications');
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || '알림을 불러오지 못했습니다.');
      if (requestId !== state.requestId) return;
      state.notifications = (Array.isArray(data.notifications) ? data.notifications : [])
        .filter(item => item.type !== 'task_reminder');
      state.recentSaves = Array.isArray(data.recentSaves) ? data.recentSaves : [];
      renderItems();
    } catch (error) {
      if (requestId !== state.requestId) return;
      elements().content.replaceChildren(emptyState(error.message || '서버에 연결할 수 없습니다.', true));
    }
  }

  function show() {
    if (state.initialized) refresh();
  }

  function init({ apiFetch, showToast, onSplit, openNote }) {
    if (state.initialized) return;
    const el = elements();
    if (
      typeof apiFetch !== 'function'
      || typeof showToast !== 'function'
      || typeof onSplit !== 'function'
      || typeof openNote !== 'function'
      || !el.panel || !el.refresh || !el.content || el.tabs.length !== 4
    ) {
      throw new TypeError('알림 패널 초기화 인자가 올바르지 않습니다.');
    }
    state.apiFetch = apiFetch;
    state.showToast = showToast;
    state.onSplit = onSplit;
    state.openNote = openNote;
    el.refresh.addEventListener('click', refresh);
    el.tabs.forEach(tab => tab.addEventListener('click', () => selectFilter(tab.dataset.notificationFilter)));
    state.initialized = true;
    selectFilter('all');
  }

  global.NotificationPanel = { init, show, refresh };
})(window);
