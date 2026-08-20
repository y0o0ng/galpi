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
    if (item.type === 'manual_check') return item.retryable ? '재정리' : '확인 완료';
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

  async function retryNote(item, card) {
    const filename = item.note?.filename;
    if (!filename) {
      state.showToast('이 알림에 노트 정보가 없어');
      return;
    }
    [...card.querySelectorAll('button')].forEach(button => { button.disabled = true; });
    try {
      const response = await state.apiFetch('/api/organize/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filenames: [filename] }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '재정리를 시작하지 못했습니다.');
      state.showToast(data.retried > 0 ? '다시 정리하고 있어' : '다시 정리할 노트가 없어');
      await refresh();
    } catch (error) {
      state.showToast(error.message);
      [...card.querySelectorAll('button')].forEach(button => { button.disabled = false; });
    }
  }

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

  // provider 표시 이름. 세 번째 provider가 생기면서 `gmail이냐 아니냐`의 이진 분기가
  // 틀린 답을 내게 됐다(웍스가 `Naver`로 보였다). 이름은 한 곳에서만 정한다.
  const PROVIDER_LABELS = { gmail: 'Gmail', naver: 'Naver', works: 'Works' };
  const providerLabel = provider => PROVIDER_LABELS[provider] || provider || '메일';

  const REASON_LABELS = {
    action_required: '행동 필요',
    attachment_check: '첨부 확인 필요',
    low_confidence: '확인 필요',
  };

  /**
   * 메일 카드. **받은편지함이 아니다** — 목록에 서 있는 것은 제목·요약·행동·기한이고,
   * 본문은 사용자가 그 메일을 눌렀을 때만 Provider에서 읽어온다(설계 10.2·23).
   * 저장된 본문을 꺼내는 것이 아니라서 카드가 사라지면 본문도 함께 사라진다.
   */
  function makeMailCard(item) {
    const card = document.createElement('article');
    card.className = 'notification-card type-mail_attention';

    const top = document.createElement('div');
    top.className = 'notification-card-top';
    const badge = document.createElement('span');
    badge.className = 'notification-badge';
    badge.textContent = REASON_LABELS[item.reasonKind] || '메일';
    const source = document.createElement('span');
    source.className = 'notification-source';
    source.textContent = providerLabel(item.provider);
    top.append(badge, source);

    // 메일을 누르면 본문이 열린다(설계 10.2·23). 본문은 저장돼 있지 않아서 그때
    // Provider에서 읽어오고, 접었다 펴는 동안에는 이미 읽은 것을 다시 읽지 않는다.
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'mail-open';
    open.setAttribute('aria-expanded', 'false');
    const who = document.createElement('div');
    who.className = 'notification-note';
    who.textContent = item.sender || '보낸사람 없음';
    const subject = document.createElement('div');
    subject.className = 'notification-text';
    subject.textContent = item.title || '(제목 없음)';
    open.append(who, subject);

    card.append(top, open);

    if (item.text) {
      const summary = document.createElement('div');
      summary.className = 'notification-text mail-summary';
      summary.textContent = item.text;
      card.appendChild(summary);
    }
    const deadline = formatDeadline(item);
    if (item.action || deadline) {
      const line = document.createElement('div');
      line.className = 'notification-reasons mail-action';
      const entry = document.createElement('li');
      entry.textContent = [deadline, item.action].filter(Boolean).join(' · ');
      line.appendChild(entry);
      card.appendChild(line);
    }

    const body = document.createElement('div');
    body.className = 'mail-body';
    body.hidden = true;
    card.appendChild(body);
    open.addEventListener('click', () => toggleBody(item, open, body));

    const actions = document.createElement('div');
    actions.className = 'notification-actions';
    actions.append(
      makeMailAction('완료', () => mailAction(item, 'done')),
      makeMailAction('나중에', () => mailAction(item, 'snooze')),
    );
    // 기한이 있는 메일만 일정이 될 수 있다. 지난 기한은 task API가 거절하므로
    // 눌러도 실패할 버튼을 만들지 않는다(설계 15).
    if (scheduleCandidateFrom(item)) {
      actions.appendChild(makeMailAction('일정 등록', () => openScheduleCandidate(item, card, actions)));
    }
    // 규칙 편집기를 사용자에게 관리시키지 않는다(설계 11). 사용자가 "이건 알림
    // 필요 없다"고 느끼는 자리가 여기라서, 가장 좁은 범위(발신자 하나)를 그 자리에서
    // 만든다. 판단과 Attention은 그대로 남고 다음부터 알림만 조용해진다.
    if (item.senderAddress) {
      actions.appendChild(makeMailAction('알림 끄기', () => suppressSender(item)));
    }
    card.appendChild(actions);
    return card;
  }

  function makeMailAction(label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'notification-action';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  /**
   * 본문 열기(설계 10.2·23). 본문 컬럼이 없으므로 이 버튼이 Provider 왕복 하나다.
   * 그래서 한 번 읽은 것은 카드가 살아 있는 동안 다시 읽지 않고, 카드가 사라지면
   * 본문도 함께 사라진다 — 어디에도 저장하지 않는다.
   */
  async function toggleBody(item, trigger, body) {
    if (!body.hidden) {
      body.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      return;
    }
    body.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    if (body.dataset.loaded === 'true' || body.dataset.loading === 'true') return;

    body.dataset.loading = 'true';
    body.replaceChildren(makeBodyMessage('본문을 읽는 중이야…'));
    try {
      const response = await state.apiFetch(`/api/mail/messages/${item.mailMessageId}/body`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '본문을 읽지 못했습니다.');
      body.replaceChildren(...renderBody(data));
      body.dataset.loaded = 'true';
    } catch (error) {
      // 다시 눌러볼 수 있게 loaded로 표시하지 않는다.
      body.replaceChildren(makeBodyMessage(error.message, true));
    } finally {
      delete body.dataset.loading;
    }
  }

  function makeBodyMessage(text, isError = false) {
    const message = document.createElement('p');
    message.className = isError ? 'mail-body-message error' : 'mail-body-message';
    message.textContent = text;
    return message;
  }

  function renderBody(data) {
    const nodes = [];
    const text = document.createElement('p');
    // HTML은 그리지 않는다. 텍스트로만 넣어서 원격 이미지·추적 픽셀이 들어올
    // 구멍을 만들지 않는다(설계 19·21).
    text.className = 'mail-body-text';
    text.textContent = data.body || '(본문 없음)';
    nodes.push(text);
    if (data.truncated) {
      nodes.push(makeBodyMessage(`앞 ${data.body.length}자만 보여주고 있어 (원본 ${data.bodyLength}자).`));
    }
    // 이름과 크기까지다. 여는 것은 첨부 트랙의 일이다.
    for (const attachment of data.attachments || []) {
      const line = document.createElement('p');
      line.className = 'mail-body-attachment';
      const size = Number.isFinite(attachment.size) ? ` (${Math.max(1, Math.round(attachment.size / 1024))}KB)` : '';
      line.textContent = `${attachment.filename || '이름 없는 첨부'}${size}`;
      nodes.push(line);
    }
    return nodes;
  }

  /**
   * 메일에서 일정 후보를 만든다(설계 15). 판단이 이미 뽑아둔 기한을 그대로 쓰므로
   * 모델을 다시 부르지 않는다. 만드는 것은 후보일 뿐이고 저장은 사용자가 `등록`을
   * 눌러야 기존 task API에서 일어난다 — Mail Agent가 별도 생성 경로를 만들지 않는다.
   */
  function scheduleCandidateFrom(item) {
    const now = Math.floor(Date.now() / 1000);
    let due = null;
    if (item.deadlineKind === 'date' && item.deadlineDate) {
      if (item.deadlineDate >= kstDateOf(now)) due = { kind: 'date', date: item.deadlineDate };
    } else if (item.deadlineKind === 'datetime' && Number.isSafeInteger(item.deadlineAt)) {
      if (item.deadlineAt > now) due = { kind: 'datetime', at: kstDateTimeOf(item.deadlineAt) };
    }
    if (!due) return null;
    return {
      task: {
        // 같은 메일은 같은 키다. 두 번 눌러도 일정이 둘이 되지 않는다.
        clientRequestId: `mail-attention:${item.attentionId}`,
        title: item.title || '(제목 없음)',
        detail: [item.sender, item.text, item.action].filter(Boolean).join(' · '),
        due,
        // 알림은 기본 알림에 맡긴다. 기한이 있는 일정은 서버가 하나를 붙인다.
        reminderAt: null,
      },
    };
  }

  function kstDateOf(epochSeconds) {
    return kstParts(epochSeconds).date;
  }

  function kstDateTimeOf(epochSeconds) {
    const parts = kstParts(epochSeconds);
    return `${parts.date}T${parts.time}:00+09:00`;
  }

  function kstParts(epochSeconds) {
    const shifted = new Date((Number(epochSeconds) + 9 * 60 * 60) * 1000);
    const pad = value => String(value).padStart(2, '0');
    return {
      date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
      time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
    };
  }

  function openScheduleCandidate(item, card, actions) {
    if (card.querySelector('.task-candidate-card')) return;
    const candidate = scheduleCandidateFrom(item);
    const cardNode = candidate ? global.TaskPanel?.makeScheduleCandidateCard(candidate) : null;
    if (!cardNode) {
      state.showToast('일정 후보를 만들지 못했어');
      return;
    }
    card.insertBefore(cardNode, actions);
  }

  // 기본 미루기는 3시간이다. 사용자가 시각을 고르는 UI는 아직 만들지 않는다 —
  // 값이 필요해지면 그때 연다.
  const SNOOZE_SECONDS = 3 * 60 * 60;

  async function mailAction(item, kind) {
    try {
      const response = await state.apiFetch(`/api/mail/attention/${item.attentionId}/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind === 'snooze'
          ? { until: Math.floor(Date.now() / 1000) + SNOOZE_SECONDS }
          : {}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '처리하지 못했습니다.');
      state.showToast(kind === 'done' ? '완료로 표시했어' : '3시간 뒤에 다시 알려줄게');
      // 목록에서 즉시 빼서 화면과 서버가 어긋나 보이지 않게 한다.
      state.notifications = state.notifications.filter(entry => entry.id !== item.id);
      renderItems();
    } catch (error) {
      state.showToast(error.message);
    }
  }

  // 알림만 끈다. 이 발신자의 메일은 계속 분석되고 기록되며 Attention도 그대로
  // 생긴다(설계 11.1). 되돌리는 곳은 에이전트 탭 Mail 상세다.
  async function suppressSender(item) {
    try {
      const response = await state.apiFetch('/api/mail/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: item.accountId ?? null,
          preferenceType: 'sender',
          target: item.senderAddress,
          action: 'suppress_notification',
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '알림 설정을 바꾸지 못했습니다.');
      state.showToast(`${item.senderAddress}는 이제 알리지 않을게`);
    } catch (error) {
      state.showToast(error.message);
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

    // 왜 멈췄는지 그대로 보여준다. 이유 없이 "수동 확인"만 있으면 사람이 할 수
    // 있는 일이 없다.
    const reasons = document.createElement('ul');
    reasons.className = 'notification-reasons';
    (Array.isArray(item.reasons) ? item.reasons : []).forEach(reason => {
      const line = document.createElement('li');
      line.textContent = reason;
      reasons.appendChild(line);
    });
    reasons.hidden = reasons.childElementCount === 0;

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
      if (item.type === 'manual_check' && item.retryable) {
        retryNote(item, card);
        return;
      }
      decide(item, 'approve', card);
    });
    actions.appendChild(approve);

    // 다시 돌려도 안 되면 그냥 정리된 것으로 두는 길을 남긴다.
    if (item.type === 'manual_check' && item.retryable) {
      const settle = document.createElement('button');
      settle.type = 'button';
      settle.className = 'notification-action';
      settle.textContent = '정리된 것으로 두기';
      settle.addEventListener('click', () => decide(item, 'approve', card));
      actions.appendChild(settle);
    }

    if (item.ignorable !== false) {
      const ignore = document.createElement('button');
      ignore.type = 'button';
      ignore.className = 'notification-action';
      ignore.textContent = '무시';
      ignore.addEventListener('click', () => decide(item, 'ignore', card));
      actions.appendChild(ignore);
    }
    footer.append(file, actions);
    card.append(top, note, text, reasons, footer);
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
    items.forEach(item => content.appendChild(
      item.source === 'mail' ? makeMailCard(item) : makeNotificationCard(item),
    ));
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

  // 홈에서 열 때만 필터를 지정한다. 인자가 없으면 사용자가 마지막에 고른 필터를 둔다.
  function show(filter) {
    if (!state.initialized) return;
    // selectFilter는 이미 받아둔 목록만 다시 그린다. 홈에서 곧바로 열면 그 목록이
    // 비어 있을 수 있으므로 필터를 세운 뒤 항상 다시 읽는다.
    if (filter) selectFilter(filter);
    refresh();
  }

  function init({ apiFetch, showToast, onSplit, openNote }) {
    if (state.initialized) return;
    const el = elements();
    if (
      typeof apiFetch !== 'function'
      || typeof showToast !== 'function'
      || typeof onSplit !== 'function'
      || typeof openNote !== 'function'
      || !el.panel || !el.refresh || !el.content || el.tabs.length !== 5
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
