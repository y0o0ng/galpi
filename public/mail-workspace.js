'use strict';

(function register(global) {
  const providers = { gmail: 'Gmail', naver: 'Naver', works: 'Works' };
  const folders = [
    ['all', '전체 메일', 'mail'], ['inbox', '받은편지함', 'inbox'], ['sent', '보낸편지함', 'send'],
    ['drafts', '임시보관함', 'draft'], ['archive', '보관함', 'archive'], ['junk', '스팸함', 'spam'], ['trash', '휴지통', 'trash'],
  ];
  const unifiedRoles = ['all', 'inbox', 'sent', 'drafts', 'junk', 'trash'];
  const smart = [
    ['중요', 'star', 'important'], ['조치 필요', 'action', 'action_required'], ['일정', 'calendar', 'schedule'],
    ['마감', 'deadline', 'deadline'], ['무시', 'muted', 'ignore'], ['미분류', 'unsorted', 'unclassified'],
  ];
  const actions = [
    ['읽음', 'read', 'set_read', true], ['안 읽음', 'unread', 'set_read', false],
    ['중요', 'star', 'set_starred', true], ['보관', 'archive', 'archive'], ['휴지통', 'trash', 'trash'],
    ['이동', 'move', 'move'],
  ];
  const smartTabs = {
    important: [['전체', 'all'], ['시온 분류', ''], ['내가 표시', 'starred']],
    action_required: [['전체', ''], ['답장', 'reply'], ['확인', 'confirm'], ['제출', 'submit']],
    deadline: [['다가오는 마감', 'upcoming'], ['지난 마감', 'past']],
    ignore: [['전체', 'all'], ['시온 판정', ''], ['분석 제외 규칙', 'rules']],
    unclassified: [['전체', ''], ['분석 대기', 'pending'], ['분석 실패', 'failed']],
  };
  const limit = 13;
  const SMART_REFRESH_MS = 15000;
  const ANALYSIS_POLL_MS = 5000;
  const zone = { timeZone: 'Asia/Seoul' };
  const day = new Intl.DateTimeFormat('en-CA', { ...zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const clock = new Intl.DateTimeFormat('ko', { ...zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const date = new Intl.DateTimeFormat('ko', { ...zone, month: 'long', day: 'numeric' });
  const labels = new Intl.NumberFormat('ko');

  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function icon(name, size) {
    const slot = node('span', 'mw-icon');
    slot.style.setProperty('--mw-icon-size', size + 'px');
    slot.setAttribute('aria-hidden', 'true');
    if (name) {
      const img = node('img');
      img.src = '/assets/figma/mail-workspace/' + name + '.svg';
      img.alt = '';
      slot.append(img);
    }
    return slot;
  }

  function button(className, label, handler, { glyph, size = 18, iconOnly = false } = {}) {
    const control = node('button', className);
    control.type = 'button';
    control.disabled = !handler;
    if (handler) control.addEventListener('click', handler);
    if (glyph !== undefined) control.append(icon(glyph, size));
    if (iconOnly) control.setAttribute('aria-label', label);
    else control.append(node('span', '', label));
    return control;
  }

  function roleOf(box) {
    if (box.inbox) return 'inbox';
    if (box.kind === 'all') return 'all';
    if (box.kind === 'label' && box.type === 'system') {
      return { SENT: 'sent', DRAFT: 'drafts', SPAM: 'junk', TRASH: 'trash' }[box.providerId];
    }
    return box.specialUse?.replace(/^\\/, '').toLowerCase();
  }

  function timeOf(value) {
    if (!Number.isFinite(value)) return '';
    const message = new Date(value * 1000);
    const now = new Date();
    if (day.format(message) === day.format(now)) return clock.format(message);
    if (day.format(message) === day.format(now.getTime() - 86400000)) return '어제';
    return date.format(message);
  }

  function create({ mount, apiFetch, showToast }) {
    let accounts = [];
    const boxes = new Map();
    const expanded = new Set();
    const selected = new Set();
    const unknown = new Set();
    let scope = { role: 'inbox', title: '받은편지함' };
    let history = [];
    let page = 0;
    let writing = false;
    let loading = false;
    let writeDenied = false;
    let listError = null;
    let actionError = null;
    let inboxUnread = null;
    let screen = null;
    let searchTerm = '';
    let appliedFilters = {};
    let searchEditing = false;
    let smartVariant = 0;
    let smartRefreshTimer;
    let smartRefreshRequest;
    let analysisTotal = 0;
    let analysisCountVersion = 0;
    let analysisChecking = false;
    let analysisRun;
    let analysisToastTimer;
    const narrow = global.matchMedia('(max-width: 1100px)');

    const sidebar = node('aside', 'mw-sidebar');
    sidebar.setAttribute('aria-label', '메일함');
    sidebar.id = 'mail-workspace-mailboxes';
    const shade = node('div', 'mw-shade');
    shade.setAttribute('aria-hidden', 'true');
    shade.addEventListener('click', () => toggleMailboxes(false));
    const main = node('div', 'mw-main');
    const header = node('header', 'mw-header');
    const toolbar = node('div', 'mw-toolbar');
    const rows = node('div', 'mw-rows');
    rows.setAttribute('aria-label', '메일 목록');
    const footer = node('footer', 'mw-pagination');
    const notices = node('div', 'mw-list-notices');
    const compose = button('mw-compose mw-compose-fab', '메일 쓰기', () => messageViews.openCompose({ kind: 'new' }), { glyph: 'compose' });
    const operationNotice = node('div', 'mw-operation-notices');
    const analysisNotice = node('div', 'mw-analysis-notice');
    analysisNotice.hidden = true;
    analysisNotice.setAttribute('role', 'status');
    const extra = node('div', 'mw-extra');
    extra.hidden = true;
    main.append(header, notices, toolbar, rows, footer, compose, extra);
    mount.replaceChildren(sidebar, main, shade, operationNotice, analysisNotice);

    function toggleMailboxes(open, restoreFocus = true) {
      const opened = open && narrow.matches;
      mount.classList.toggle('mw-mailboxes-open', opened);
      main.inert = opened;
      header.querySelector('.mw-menu')?.setAttribute('aria-expanded', String(opened));
      if (opened) {
        const close = sidebar.querySelector('.mw-close');
        const firstFolder = sidebar.querySelector('[aria-current="page"]');
        (close.getClientRects().length ? close : firstFolder)?.focus();
      } else if (restoreFocus) header.querySelector('.mw-menu')?.focus();
    }

    narrow.addEventListener('change', () => toggleMailboxes(false, false));
    mount.addEventListener('keydown', event => {
      if (event.key === 'Escape' && mount.classList.contains('mw-mailboxes-open')) {
        event.preventDefault();
        toggleMailboxes(false);
      }
    });
    new MutationObserver(syncSmartRefresh).observe(mount, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('visibilitychange', syncSmartRefresh);

    async function request(endpoint, options = {}, { binary = false } = {}) {
      const { json, ...init } = options;
      const response = await apiFetch((endpoint.startsWith('/api/') ? '' : '/api/mail-client') + endpoint, {
        cache: 'no-store', ...init,
        ...(json ? { body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } } : {}),
      });
      if (binary && response.ok) return response.blob();
      const data = await response.json().catch(() => ({}));
      if ((!response.ok || data.success === false) && !data.state) {
        throw Object.assign(new Error(data.code || '메일 요청을 완료하지 못했어.'), { code: data.code, status: response.status });
      }
      return data;
    }

    function get(endpoint, params = {}, options) {
      const query = new URLSearchParams(params).toString();
      return request(endpoint + (query ? '?' + query : ''), options);
    }

    function requestId() {
      return global.crypto.randomUUID?.()
        || Array.from(global.crypto.getRandomValues(new Uint32Array(4)), value => value.toString(36)).join('-');
    }

    function show(screenName, content) {
      screen = screenName;
      mount.dataset.screen = screenName;
      extra.hidden = false;
      extra.replaceChildren(content);
      stopSmartRefresh();
      toggleMailboxes(false, false);
      renderSidebar(history[page]?.messages.filter(message => message.read === false).length);
      main.scrollTop = 0;
    }

    function close() {
      screen = null;
      delete mount.dataset.screen;
      extra.hidden = true;
      extra.replaceChildren();
      renderPage();
    }

    function openSent(id) {
      const account = accounts.find(item => item.id === id);
      const target = account && mailboxFor('sent', account);
      if (target) changeScope({ ...target, role: 'sent', title: '보낸편지함' });
      else showToast('이 계정의 보낸편지함을 찾을 수 없어.');
    }

    function renderAnalyzeButton(slot = sidebar.querySelector('.mw-analyze-slot')) {
      if (!slot) return;
      const state = analysisRun ? 'running' : analysisTotal ? 'idle' : 'disabled';
      const caption = analysisRun ? `분석 중 ${labels.format(analysisRun.finished)}/${labels.format(analysisRun.total)}`
        : analysisTotal ? '분석 ' + labels.format(analysisTotal) : '분석';
      const control = button('mw-analyze', caption, state === 'idle' && !analysisChecking ? askAnalysis : null,
        { glyph: 'analyze-' + state, size: 14 });
      control.dataset.state = state;
      slot.replaceChildren(control);
    }

    async function updateAnalysisCount() {
      const version = ++analysisCountVersion;
      const data = await get('/smart/analysis-targets').catch(() => null);
      if (version !== analysisCountVersion || !data) return;
      analysisTotal = data.total;
      renderAnalyzeButton();
    }

    async function askAnalysis() {
      if (analysisChecking || analysisRun) return;
      const origin = scope;
      const originScreen = screen;
      analysisChecking = true;
      renderAnalyzeButton();
      ++analysisCountVersion;
      const data = await get('/smart/analysis-targets', { snapshot: 1 }).catch(() => null);
      analysisChecking = false;
      if (!Array.isArray(data?.messageIds)) {
        renderAnalyzeButton();
        if (mount.classList.contains('active')) showToast('분석 대상을 확인하지 못했어.');
        return;
      }
      const ids = [...new Set(data.messageIds)];
      analysisTotal = ids.length;
      renderAnalyzeButton();
      if (!ids.length || origin !== scope || originScreen !== screen || !mount.classList.contains('active')) return;

      const dialog = node('dialog', 'mw-analysis-dialog');
      const title = node('h2', '', `미분류 ${labels.format(ids.length)}통을 분석할까?`);
      title.id = 'mw-analysis-heading';
      dialog.setAttribute('aria-labelledby', title.id);
      const footer = node('footer', 'mw-popover-footer');
      footer.append(button('mw-popover-secondary', '취소', () => dialog.close()), button('mw-popover-primary', '분석', () => {
        dialog.close();
        if (!analysisRun) void runAnalysis(ids);
      }));
      dialog.append(title, node('p', '', '분석이 끝나면 스마트 메일함이 갱신돼.'), footer);
      dialog.addEventListener('close', () => {
        dialog.remove();
        sidebar.querySelector('.mw-analyze:not(:disabled)')?.focus();
      }, { once: true });
      mount.append(dialog);
      dialog.showModal();
    }

    async function runAnalysis(ids) {
      global.clearTimeout(analysisToastTimer);
      analysisNotice.hidden = true;
      analysisRun = { total: ids.length, finished: 0 };
      let done = 0;
      let failed = 0;
      let remaining = 0;
      const pending = new Set();
      renderAnalyzeButton();

      function record(id, states) {
        if (states.some(state => state === 'pending' || state === 'analyzing')) { pending.add(id); return; }
        pending.delete(id);
        if (states.length === 2 && states.every(state => state === 'done')) done += 1;
        else if (states.includes('failed')) failed += 1;
        else remaining += 1;
        analysisRun.finished += 1;
      }

      for (let start = 0; start < ids.length; start += 10) {
        const batch = ids.slice(start, start + 10);
        const response = await request('/smart/analyze', { method: 'POST', json: { messageIds: batch, kind: 'both' } }).catch(() => null);
        if (!Array.isArray(response?.results)) { batch.forEach(id => pending.add(id)); continue; }
        const results = new Map(response.results.map(result => [result.id, result.jobs]));
        for (const id of batch) record(id, (results.get(id) || []).map(job => job.state));
        renderAnalyzeButton();
      }

      let unanswered = 0;
      while (pending.size) {
        await new Promise(resolve => global.setTimeout(resolve, ANALYSIS_POLL_MS));
        const active = [...pending];
        let answered = false;
        for (let start = 0; start < active.length; start += 10) {
          const batch = active.slice(start, start + 10);
          const response = await get('/smart/results', { messageIds: batch.join(','), statusOnly: 1 }).catch(() => null);
          for (const result of response?.results || []) {
            if (!batch.includes(result.id) || !pending.has(result.id)) continue;
            answered = true;
            record(result.id, [result.classificationStatus?.state, result.calendarStatus?.state]);
          }
        }
        unanswered = answered ? 0 : unanswered + 1;
        if (unanswered >= 3) for (const id of pending) record(id, []);
        renderAnalyzeButton();
      }

      analysisRun = null;
      analysisTotal = 0;
      renderAnalyzeButton();
      void updateAnalysisCount();
      const summary = [labels.format(done) + '통 분석했어', failed ? labels.format(failed) + '통 실패' : '',
        remaining ? labels.format(remaining) + '통 미처리' : ''].filter(Boolean).join(' · ');
      analysisNotice.replaceChildren(icon(failed || remaining ? 'alert' : 'analyze-done', 18), node('span', '', summary));
      if (failed || remaining) analysisNotice.append(button('mw-analysis-more', '미분류 보기', () => {
        if (loading || writing) return;
        analysisNotice.hidden = true;
        changeScope({ filter: 'unclassified', title: '미분류' });
      }));
      analysisNotice.hidden = false;
      analysisToastTimer = global.setTimeout(() => { analysisNotice.hidden = true; }, 7000);
      if (canRefreshSmart()) { stopSmartRefresh(); void refreshSmart(); }
      else if (screen === 'calendar' && mount.classList.contains('active')) auxiliary?.refreshCalendar();
    }

    const viewApi = {
      node, button, icon, providers, timeOf, get, request, show, close, accounts: () => accounts,
      openMove, mutate, openSent, requestId, notify: showToast, popover,
      openMessage: message => messageViews.detail(message, [], 0, { title: '메일', role: 'other' }),
      searchHistory: value => {
        searchTerm = value;
        changeScope({ role: 'inbox', title: '검색 결과', search: true, contactEmail: value });
      },
      toggleMailboxes, refreshAccounts: accountsChanged,
      compose: options => messageViews.openCompose(options),
      makeRow: row,
    };
    const messageViews = global.MailWorkspaceMessage.create(viewApi);
    const auxiliary = global.MailWorkspaceSecondary?.create(viewApi);

    function messages() {
      return history[page]?.messages || [];
    }

    function verified(message) {
      return Number.isSafeInteger(message.id) && message.id > 0 && !message.stale && !message.detailError;
    }

    function actionable(message) {
      return verified(message) && !unknown.has(message.id);
    }

    function mailboxFor(role, account) {
      const candidates = account ? [account] : accounts;
      const matches = candidates.flatMap(account => (boxes.get(account.id) || [])
        .filter(box => box.selectable && roleOf(box) === role).map(box => ({ account, box })));
      if (matches.length === 1) return matches[0];
      return null;
    }

    function changeScope(next) {
      if (loading || writing) return;
      if (screen) close();
      scope = next;
      if (!next.search) searchTerm = '';
      if (!next.keepFilters) appliedFilters = {};
      smartVariant = 0;
      listError = null;
      actionError = null;
      toggleMailboxes(false, false);
      history = [];
      page = 0;
      selected.clear();
      void loadPage();
    }

    function inbox(account) {
      const box = account ? mailboxFor('inbox', account)?.box : null;
      if (account && !box) return;
      changeScope({ role: 'inbox', title: '받은편지함', account, box });
    }

    function navRow(label, glyph, handler, active = false, count) {
      const control = button('mw-folder', label, handler, { glyph });
      control.dataset.selected = active ? 'Yes' : 'No';
      control.dataset.showCount = String(count != null);
      if (active) control.setAttribute('aria-current', 'page');
      if (count != null) control.append(node('span', 'mw-folder-count', labels.format(count)));
      return control;
    }

    function problemSources() {
      if (listError?.code === 'MAIL_CLIENT_AUTH_REQUIRED' && scope.account) {
        return [{ accountId: scope.account.id, provider: scope.account.provider, failure: { code: listError.code } }];
      }
      const current = history[page];
      // An account without the folder in a unified view is not a problem.
      return (current?.sources || [current?.source]).filter(source => source && source.status !== 'fresh'
        && source.failure?.code !== 'MAIL_CLIENT_MAILBOX_UNAVAILABLE');
    }

    function accountRow(account, expanded, toggle) {
      const label = button('mw-account', providers[account.provider], toggle,
        { glyph: expanded ? 'chevron-down' : 'chevron-right', size: 16 });
      label.dataset.accountId = account.id;
      if (toggle) label.setAttribute('aria-expanded', String(expanded));
      const address = node('span', 'mw-address', account.address);
      address.title = account.address;
      label.append(address);
      return label;
    }

    function popover(anchor, title) {
      const panel = node('dialog', 'mw-popover');
      panel.setAttribute('aria-label', title);
      panel.append(node('h2', '', title));
      const rect = anchor.getBoundingClientRect();
      panel.style.setProperty('--mw-popover-right', Math.max(12, global.innerWidth - rect.right) + 'px');
      panel.style.setProperty('--mw-popover-top', rect.bottom + 8 + 'px');
      panel.addEventListener('close', () => panel.remove(), { once: true });
      panel.addEventListener('click', event => {
        if (event.target !== panel) return;
        const bounds = panel.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right
          || event.clientY < bounds.top || event.clientY > bounds.bottom) panel.close();
      });
      mount.append(panel);
      return panel;
    }

    function gmailMoveSource(message, folderScope = scope) {
      if (message.provider !== 'gmail') return undefined;
      if (folderScope.search) return null;
      if (folderScope.role === 'all' && folderScope.box?.kind === 'all') return 'all';
      if (folderScope.role === 'inbox' && message.labelIds?.includes('INBOX')) return 'label:INBOX';
      if (folderScope.account?.id === message.accountId && folderScope.box?.type === 'user'
        && message.labelIds?.includes(folderScope.box.providerId)) return folderScope.box.id;
      return null;
    }

    function openMove(anchor, items, folderScope = scope) {
      const accountId = items[0]?.accountId;
      const sameAccount = accountId && items.every(message => message.accountId === accountId);
      const canMove = sameAccount && items.every(message => gmailMoveSource(message, folderScope) !== null);
      const panel = popover(anchor, '이동할 폴더');
      const expandedAccounts = new Set(accountId && sameAccount ? [accountId] : []);
      const list = node('div', 'mw-popover-folders');
      const footer = node('footer', 'mw-popover-footer');
      let destination = null;
      const confirm = button('mw-popover-primary', '이동', () => {
        if (!destination || !canMove) return;
        panel.close();
        void mutate(items, 'move', destination, folderScope);
      });
      confirm.disabled = true;
      if (!sameAccount) panel.append(node('p', '', '같은 제공처의 메일만 한 번에 이동할 수 있어.'));
      else if (!canMove) panel.append(node('p', '', '메일이 속한 폴더에서 이동할 수 있어.'));
      panel.append(list, footer);
      footer.append(button('mw-popover-secondary', '취소', () => panel.close()), confirm);
      function renderFolders(keepFocus) {
        list.replaceChildren();
        for (const account of accounts) {
          const isExpanded = expandedAccounts.has(account.id);
          const itemsForAccount = (boxes.get(account.id) || []).filter(box => box.selectable && (account.provider === 'gmail'
            ? box.kind === 'label' && box.type === 'user' : box.kind === 'folder'));
          const heading = accountRow(account, isExpanded, itemsForAccount.length ? () => {
            if (isExpanded) expandedAccounts.delete(account.id);
            else expandedAccounts.add(account.id);
            renderFolders(account.id);
          } : null);
          list.append(heading);
          if (!isExpanded) continue;
          for (const box of itemsForAccount) {
            const sourceIsTarget = items.some(message => account.provider === 'gmail'
              ? gmailMoveSource(message, folderScope) === box.id : message.folderPath === box.path);
            const eligible = canMove && account.id === accountId && !sourceIsTarget;
            const isSelected = destination?.accountId === account.id && destination.id === box.id;
            const glyph = folders.find(([role]) => role === roleOf(box))?.[2] || 'folder';
            const control = navRow(box.name, glyph, eligible ? () => {
              destination = { accountId: account.id, id: box.id };
              confirm.disabled = false;
              renderFolders();
              list.querySelector('[aria-pressed="true"]')?.focus();
            } : null, isSelected);
            control.removeAttribute('aria-current');
            control.setAttribute('aria-pressed', String(isSelected));
            control.classList.add('mw-account-folder');
            list.append(control);
          }
        }
        if (keepFocus) list.querySelector('[data-account-id="' + keepFocus + '"]')?.focus();
      }
      renderFolders();
      panel.showModal();
    }

    function renderSidebar(unread) {
      const top = node('div', 'mw-sidebar-head');
      const compactHead = node('div', 'mw-mailbox-head');
      compactHead.append(node('h2', '', '메일함'), button('mw-close', '메일함 메뉴 닫기', () => toggleMailboxes(false),
        { glyph: 'close', size: 22, iconOnly: true }));
      top.append(node('h2', 'mw-sidebar-title', '메일'), button('mw-compose', '메일 쓰기',
        () => messageViews.openCompose({ kind: 'new' }), { glyph: 'compose' }));
      const standard = node('nav', 'mw-nav');
      standard.setAttribute('aria-label', '기본 메일함');
      for (const [role, title, glyph] of folders) {
        const target = role === 'inbox' ? null : mailboxFor(role, scope.account);
        const handler = role === 'inbox' ? () => inbox()
          : !scope.account && unifiedRoles.includes(role) ? () => changeScope({ role, title })
            : role === 'all' && scope.account && !target ? () => changeScope({ role, title, account: scope.account })
              : target && (() => changeScope({ ...target, role, title }));
        const count = role === 'inbox' ? inboxUnread : role === 'drafts' && scope.role === role && unread != null ? messages().length : null;
        const control = navRow(title, glyph, handler, (!screen || screen === 'detail' || screen === 'compose') && scope.role === role, count);
        control.dataset.mailboxRole = role;
        standard.append(control);
      }

      const smartNav = node('nav', 'mw-nav');
      smartNav.setAttribute('aria-label', '스마트 메일함');
      const smartHeading = node('div', 'mw-smart-heading');
      const analyzeSlot = node('span', 'mw-analyze-slot');
      analyzeSlot.setAttribute('aria-live', 'polite');
      renderAnalyzeButton(analyzeSlot);
      smartHeading.append(node('h3', 'mw-nav-title', '스마트 메일함'), analyzeSlot);
      smartNav.append(smartHeading);
      for (const [label, glyph, filter] of smart) {
        const run = filter === 'schedule' ? auxiliary?.calendar : () => changeScope({ filter, title: label });
        smartNav.append(navRow(label, glyph, run,
          (filter === 'schedule' && screen === 'calendar') || (!screen && scope.filter === filter)));
      }

      const accountNav = node('nav', 'mw-nav');
      accountNav.setAttribute('aria-label', '계정');
      accountNav.append(node('h3', 'mw-nav-title', '계정'));
      const problems = problemSources();
      for (const account of accounts.filter(account => account.status !== 'disabled')) {
        const custom = (boxes.get(account.id) || []).filter(box => box.selectable && (
          (box.kind === 'label' && box.type === 'user') || (box.kind === 'folder' && !roleOf(box))
        ));
        const label = accountRow(account, expanded.has(account.id), custom.length ? () => {
          if (expanded.has(account.id)) expanded.delete(account.id);
          else expanded.add(account.id);
          renderSidebar(unread);
          sidebar.querySelector('[data-account-id="' + account.id + '"]')?.focus();
        } : null);
        if (problems.some(source => source.accountId === account.id)) label.append(icon('account-alert-dot', 6));
        accountNav.append(label);
        if (!expanded.has(account.id)) continue;
        for (const box of custom) {
          const active = scope.account?.id === account.id && scope.box?.id === box.id;
          const child = navRow(box.name, 'folder', () => changeScope({ account, box, title: box.name }), active);
          child.classList.add('mw-account-folder');
          accountNav.append(child);
        }
      }
      const bottom = node('div', 'mw-sidebar-bottom');
      bottom.append(navRow('연락처', 'contacts', auxiliary?.contacts, screen === 'contacts'),
        navRow('메일 설정', 'settings', auxiliary?.settings, screen === 'settings'));
      sidebar.replaceChildren(compactHead, top, standard, smartNav, accountNav, bottom);
    }

    function renderHeader(unread) {
      const menu = button('mw-menu', '메일함 메뉴 열기', () => toggleMailboxes(true), { glyph: 'menu', size: 22, iconOnly: true });
      menu.setAttribute('aria-expanded', String(mount.classList.contains('mw-mailboxes-open')));
      menu.setAttribute('aria-controls', sidebar.id);
      const heading = node('h1', '', scope.title);
      heading.tabIndex = -1;
      const title = node('div', 'mw-title');
      const total = node('span', 'mw-unread', listCaption(unread));
      total.title = '현재 페이지 기준';
      title.append(heading, total);
      const chips = node('div', 'mw-chips');
      chips.setAttribute('role', 'group');
      chips.setAttribute('aria-label', '계정 범위');
      if (scope.role) {
        for (const [provider, name] of [['', '전체'], ...Object.entries(providers)]) {
          const account = accounts.find(item => item.provider === provider);
          const target = account ? mailboxFor(scope.role, account) : null;
          const unifiedOpen = !provider && unifiedRoles.includes(scope.role);
          const accountAll = scope.role === 'all' && account != null && !target;
          const canOpen = unifiedOpen || target || accountAll;
          const active = !provider ? !scope.account : account != null && scope.account?.id === account.id;
          const chip = button('mw-chip', name, (scope.search ? (!provider || account) : canOpen) && !writing && !loading ? () => {
            if (scope.search) searchFor(searchTerm, account, scope.contactEmail);
            else if (scope.role === 'inbox') inbox(account);
            else if (unifiedOpen) changeScope({ role: scope.role, title: scope.title });
            else if (accountAll) changeScope({ role: 'all', title: scope.title, account });
            else changeScope({ ...target, role: scope.role, title: scope.title });
          } : null);
          chip.setAttribute('aria-pressed', String(active));
          chips.append(chip);
        }
      }
      if (scope.filter) {
        for (const [index, [label, key]] of (smartTabs[scope.filter] || []).entries()) {
          const control = button('mw-chip', label, key !== null && !loading && !writing ? () => {
            smartVariant = index;
            page = 0;
            void loadPage(null, true);
          } : null);
          control.setAttribute('aria-pressed', String(smartVariant === index));
          chips.append(control);
        }
      }
      const search = node('form', 'mw-search');
      const input = node('input');
      input.type = 'search';
      input.placeholder = '메일 검색';
      input.value = searchTerm;
      input.setAttribute('aria-label', '메일 검색');
      input.maxLength = 160;
      function searchFor(value, account = scope.account, contactEmail = null) {
        searchTerm = value.trim();
        if (searchTerm) changeScope({ title: '검색 결과', role: 'inbox', account, search: true, keepFilters: true, contactEmail });
        else inbox(account);
      }
      search.addEventListener('submit', event => {
        event.preventDefault();
        searchFor(input.value);
      });
      const searchScope = button('mw-search-scope', scope.account ? providers[scope.account.provider] : '전체 계정', () => {
        const dialog = popover(searchScope, '검색 범위');
        const group = node('div', 'mw-popover-folders');
        for (const account of [null, ...accounts.filter(item => item.status !== 'disabled')]) {
          group.append(navRow(account ? providers[account.provider] : '전체 계정', undefined, () => {
            dialog.close();
            if (input.value.trim()) searchFor(input.value, account, input.value.trim() === searchTerm ? scope.contactEmail : null);
            else inbox(account);
          }, (scope.account?.id ?? null) === (account?.id ?? null)));
        }
        dialog.append(group);
        dialog.showModal();
      }, { glyph: 'chevron-down', size: 14 });
      search.append(icon('search', 18), input);
      if (searchTerm) search.append(button('mw-clear-search', '검색어 지우기', () => searchFor(''),
        { glyph: 'close', size: 14, iconOnly: true }));
      search.append(searchScope);
      const compactSearch = button('mw-compact-search', '메일 검색', () => {
        searchEditing = !searchEditing;
        renderHeader(unread);
        if (searchEditing) header.querySelector('input')?.focus();
      }, { glyph: 'search', size: 22, iconOnly: true });
      header.classList.toggle('mw-search-editing', searchEditing);
      header.replaceChildren(menu, title, node('span', 'mw-spacer'), ...(scope.role || scope.filter ? [chips] : []), search, compactSearch);
    }

    function listCaption(unread) {
      if (unread == null) return '';
      if (scope.search) return '‘' + searchTerm + '’ · ' + (scope.account ? providers[scope.account.provider] : '전체 계정')
        + ' · ' + labels.format(history[page]?.total ?? messages().length) + '건';
      if (scope.role === 'drafts') return '초안 ' + labels.format(messages().length) + '개';
      if (scope.role === 'trash' && !messages().length) return '0개';
      const prefix = !scope.role ? providers[scope.account?.provider] + ' · ' : '';
      return prefix + '안 읽음 ' + labels.format(unread);
    }

    function openFilters(anchor) {
      const panel = popover(anchor, '필터');
      const form = node('form', 'mw-filter-form');
      form.addEventListener('submit', event => event.preventDefault());
      const values = { ...appliedFilters };
      function group(label, field, choices, multiple = false) {
        const section = node('fieldset');
        const options = node('div', 'mw-filter-options');
        section.append(node('legend', '', label), options);
        for (const [caption, value] of choices) {
          const option = button('mw-pill', caption, () => {
            if (multiple) values[value] = !values[value];
            else values[field] = value;
            paint();
          });
          function paint() {
            for (const item of options.children) {
              const pressed = multiple ? Boolean(values[item.dataset.value]) : (values[field] || '') === item.dataset.value;
              item.setAttribute('aria-pressed', String(pressed));
            }
            dates.hidden = values.period !== 'custom';
          }
          option.dataset.value = value;
          option.setAttribute('aria-pressed', String(multiple ? Boolean(values[value]) : (values[field] || '') === value));
          options.append(option);
        }
        return section;
      }
      const dates = node('div', 'mw-filter-options');
      const fromDay = node('input');
      const toDay = node('input');
      fromDay.type = toDay.type = 'date';
      fromDay.setAttribute('aria-label', '시작 날짜');
      toDay.setAttribute('aria-label', '종료 날짜');
      fromDay.value = values.from || '';
      toDay.value = values.until || '';
      dates.hidden = values.period !== 'custom';
      dates.append(fromDay, toDay);
      form.append(group('읽음 상태', 'read', [['전체', ''], ['안 읽음', 'unread'], ['읽음', 'read']]),
        group('표시', null, [['중요표시', 'starred'], ['첨부 있음', 'attachments']], true),
        group('기간', 'period', [['전체', ''], ['1주', 'week'], ['1개월', 'month'], ['직접 지정', 'custom']]), dates);
      const sender = node('input');
      sender.placeholder = '이름 또는 이메일 주소';
      sender.setAttribute('aria-label', '보낸 사람');
      sender.value = values.sender || '';
      const senderGroup = node('label', 'mw-filter-sender');
      senderGroup.append(node('span', '', '보낸 사람'), sender);
      form.append(senderGroup);
      const footer = node('footer', 'mw-popover-footer');
      footer.append(button('mw-popover-secondary', '초기화', () => {
        appliedFilters = {};
        panel.close();
        changeScope({ ...scope });
      }), button('mw-popover-primary', '적용', () => {
        if (values.period === 'custom' && fromDay.value && toDay.value && fromDay.value > toDay.value) {
          toDay.setCustomValidity('종료 날짜는 시작 날짜 다음이어야 해.');
          toDay.reportValidity();
          toDay.setCustomValidity('');
          return;
        }
        const dates = values.period === 'custom' ? { from: fromDay.value, until: toDay.value } : {};
        appliedFilters = Object.fromEntries(Object.entries({ ...values, ...dates, sender: sender.value.trim() }).filter(([, value]) => value));
        panel.close();
        changeScope({ ...scope, keepFilters: true });
      }));
      panel.append(form, footer);
      panel.showModal();
    }

    function renderToolbar() {
      const available = messages().filter(actionable);
      const all = available.length > 0 && available.every(message => selected.has(message.id));
      const count = available.filter(message => selected.has(message.id)).length;
      const toggle = button('mw-select-page', all ? '페이지 선택 해제' : '페이지 선택', available.length && !writing && !loading ? () => {
        selected.clear();
        if (!all) available.forEach(message => selected.add(message.id));
        renderPage();
        toolbar.querySelector('.mw-select-page').focus();
      } : null, { glyph: count && !actionError ? 'checkbox-on' : 'checkbox-off', size: 20, iconOnly: true });
      toggle.setAttribute('aria-pressed', String(all));
      const group = node('div', 'mw-actions');
      toolbar.classList.toggle('mw-muted-controls', (loading && !history[page]) || (scope.role === 'trash' && !messages().length));
      for (const [label, glyph, action, value] of actions) {
        if (scope.role === 'drafts' && action !== 'trash') continue;
        const control = button('mw-action', label, count && action && !writeDenied && !writing && !loading ? () => {
          const items = available.filter(message => selected.has(message.id));
          if (action === 'move') openMove(control, items);
          else void mutate(items, action, value);
        } : null, { glyph, size: 16 });
        if (action === 'set_starred') control.title = '선택한 메일에 별표 표시';
        group.append(control);
      }
      const selection = [toggle];
      toggle.append(icon('chevron-down', 14));
      if (count > 0 && !actionError) selection.push(node('span', 'mw-selection', labels.format(count) + '개 선택'));
      const filter = button('mw-action', '필터', scope.filter ? null : () => openFilters(filter), { glyph: 'filter', size: 16 });
      if (Object.keys(appliedFilters).length) filter.setAttribute('aria-pressed', 'true');
      toolbar.replaceChildren(...selection, node('span', 'mw-rule'), group, node('span', 'mw-spacer'), filter,
        button('mw-square', '새로고침', !loading && !writing ? () => void loadPage(null, true) : null,
          { glyph: 'refresh', iconOnly: true }));
    }

    function row(message) {
      const unread = message.read === false;
      const checked = selected.has(message.id);
      const el = node('div', 'mw-row');
      if (message.id != null) el.dataset.messageId = message.id;
      el.dataset.checked = checked ? 'Yes' : 'No';
      el.dataset.state = unread ? 'Unread' : 'Read';
      el.dataset.attachment = String(message.hasAttachments === true);
      el.dataset.starred = String(message.starred === true);
      el.dataset.showThread = 'false';
      const subject = message.subject || '(제목 없음)';
      const select = button('mw-row-select', subject + (checked ? ' 선택 해제' : ' 선택'),
        actionable(message) && !writing && !loading ? () => {
          if (checked) selected.delete(message.id);
          else selected.add(message.id);
          renderPage();
          rows.querySelector('[data-message-id="' + message.id + '"] .mw-row-select')?.focus();
        } : null, { glyph: checked ? 'checkbox-on' : 'checkbox-off', size: 20, iconOnly: true });
      select.setAttribute('aria-pressed', String(checked));
      const star = button('mw-row-star', subject + (message.starred ? ' 별표 해제' : ' 별표'),
        actionable(message) && !writeDenied && !writing && !loading ? () => void mutate([message], 'set_starred', !message.starred) : null,
        { glyph: message.starred ? 'star-on' : 'star', size: 20, iconOnly: true });
      star.setAttribute('aria-pressed', String(message.starred === true));
      const isDraft = scope.role === 'drafts';
      const address = (isDraft ? message.to : message.from)?.[0];
      const name = address?.name || address?.address || '';
      const from = node('span', 'mw-sender', isDraft && name ? '받는 사람 · ' + name : name);
      const content = node('span', 'mw-content');
      const open = scope.role === 'drafts' && !scope.search && Number.isSafeInteger(message.id) ? () => void openDraft(message)
        : Number.isSafeInteger(message.id) ? () => messageViews.detail(message, messages(), messages().indexOf(message), scope) : null;
      const subjectControl = button('mw-subject', subject, open);
      content.append(subjectControl);
      el.append(select, star, node('span', 'mw-unread-dot'), from, content);
      if (message.hasAttachments === true) {
        const attachment = icon('paperclip', 16);
        attachment.classList.add('mw-attachment');
        el.append(attachment);
      }
      el.append(node('span', 'mw-provider', providers[message.provider] || ''), node('span', 'mw-time', timeOf(message.receivedAt)));
      if (!actionable(message)) el.title = '현재 메일 위치 또는 변경 결과를 확인할 수 없어.';
      return el;
    }

    function renderFooter() {
      const count = messages().length;
      const offset = history.slice(0, page).reduce((sum, entry) => sum + entry.messages.length, 0);
      const first = Math.max(0, page - 2);
      const last = Math.min(first + 5, history.length + Number(Boolean(history.at(-1)?.nextCursor)));
      const current = history[page];
      const range = count ? labels.format(offset + 1) + '–' + labels.format(offset + count) : '';
      const total = count && current?.nextCursor === null && history.slice(0, page + 1).every(entry => !entry.incomplete)
        ? ' / ' + labels.format(offset + count) : '';
      const parts = [node('span', '', range + total),
        node('span', 'mw-spacer'), button('mw-square', '이전 페이지', page > 0 && !loading && !writing ? () => go(page - 1) : null,
          { glyph: 'chevron-left', iconOnly: true })];
      for (let i = first; i < last; i++) {
        const control = button('mw-square', String(i + 1), i !== page && !loading && !writing ? () => go(i) : null);
        if (i === page) control.setAttribute('aria-current', 'page');
        parts.push(control);
      }
      parts.push(button('mw-square', '다음 페이지', page + 1 < last && !loading && !writing ? () => go(page + 1) : null,
        { glyph: 'chevron-right', iconOnly: true }));
      footer.hidden = !history[page] || (!count && !history[page].nextCursor && !page);
      footer.replaceChildren(...parts);
    }

    function renderRows() {
      rows.setAttribute('aria-busy', String(loading));
      const items = messages();
      const skeleton = loading && !history[page];
      const emptyTrash = !loading && !listError && scope.role === 'trash' && history[page] && !history[page].incomplete && !items.length;
      const emptySearch = !loading && !listError && scope.search && history[page] && !items.length;
      rows.classList.toggle('mw-empty-trash', Boolean(emptyTrash || emptySearch));
      if (skeleton) {
        rows.replaceChildren(...Array.from({ length: 10 }, () => {
          const line = node('div', 'mw-skeleton');
          line.setAttribute('aria-hidden', 'true');
          line.append(...Array.from({ length: 5 }, () => node('span')));
          return line;
        }));
      } else if (emptyTrash) rows.replaceChildren(icon('trash', 24), node('p', '', '휴지통이 비어 있어'));
      else if (emptySearch) rows.replaceChildren(icon('search', 24), node('p', '', '검색 결과가 없어'));
      else rows.replaceChildren(...items.map(row));
    }

    function renderNotices() {
      const current = history[page];
      const unhealthy = problemSources();
      const auth = unhealthy.filter(source => source.failure?.code === 'MAIL_CLIENT_AUTH_REQUIRED');
      const other = unhealthy.filter(source => !auth.includes(source));
      notices.replaceChildren();
      function notice(text, label, onClick) {
        const box = node('div', 'mw-list-notice');
        box.setAttribute('role', 'status');
        const action = button('mw-notice-action', label, onClick);
        if (label === '다시 로그인') action.classList.add('mw-reconnect');
        box.append(icon('alert', 18), node('span', '', text), action);
        notices.append(box);
      }
      if (auth.length) {
        const names = auth.map(source => providers[source.provider]).filter(Boolean).join(', ');
        const targets = accounts.filter(account => auth.some(source => source.accountId === account.id));
        notice(names + ' 로그인이 만료됐어. 다시 로그인할 때까지 ' + names + ' 새 메일을 못 가져와.', '다시 로그인', auxiliary && targets.length ? () => auxiliary.reauthenticate(targets) : null);
      }
      if ((listError && !auth.length) || other.length || (current?.incomplete && !auth.length)) {
        const names = other.map(source => providers[source.provider]).filter(Boolean).join(', ');
        const text = listError ? '메일 목록을 불러오지 못했어.'
          : (names ? names + ' · ' : '') + '일부 메일이 최신 상태가 아닐 수 있어.';
        notice(text, '지금 다시 시도', loading || writing ? null : () => void loadPage(null, true));
      }
      operationNotice.replaceChildren();
      if (actionError) {
        const { items, value, action = 'set_read', folderScope = scope } = actionError;
        const box = node('div', 'mw-operation-notice');
        box.setAttribute('role', 'status');
        const unchanged = messages().filter(message => items.includes(message.id)).every(message => message.read === !value);
        const destination = action === 'move' ? (boxes.get(value.accountId) || []).find(box => box.id === value.id)?.name : null;
        const text = action === 'move'
          ? (destination ? '‘' + destination + '’로 옮기지 못했어. 메일은 원래 자리에 있어.' : '메일을 옮기지 못했어.')
          : !unchanged ? '읽음 상태를 바꾸지 못했어.' : value
            ? '읽음으로 바꾸지 못했어. 메일은 그대로 안 읽음이야.'
            : '안 읽음으로 바꾸지 못했어. 메일은 그대로 읽음이야.';
        box.append(icon('alert', 18), node('span', '', text),
        button('mw-notice-action', '다시 시도', loading || writing ? null : () => {
          const targets = messages().filter(message => items.includes(message.id) && actionable(message));
          if (targets.length) void mutate(targets, action, value, folderScope);
        }));
        operationNotice.append(box);
      }
    }

    function renderPage(background = false) {
      const current = history[page];
      const unread = current ? current.messages.filter(message => message.read === false).length : null;
      if (scope.role === 'inbox' && !scope.account && !page && unread != null) inboxUnread = unread;
      renderRows();
      if (background) header.querySelector('.mw-unread').textContent = listCaption(unread);
      else {
        renderSidebar(unread);
        renderHeader(unread);
      }
      renderToolbar();
      renderFooter();
      renderNotices();
      syncSmartRefresh();
    }

    function smartParams(cursor) {
      const variant = smartTabs[scope.filter]?.[smartVariant]?.[1];
      return { limit, filter: scope.filter, ...(variant ? { variant } : {}), ...(cursor ? { cursor } : {}) };
    }

    function canRefreshSmart() {
      return scope.filter && !screen && !loading && !writing && !document.hidden
        && mount.classList.contains('active') && !mount.classList.contains('mw-mailboxes-open');
    }

    function stopSmartRefresh() {
      global.clearTimeout(smartRefreshTimer);
      smartRefreshTimer = undefined;
      smartRefreshRequest?.abort();
      smartRefreshRequest = undefined;
    }

    function syncSmartRefresh() {
      if (!canRefreshSmart()) stopSmartRefresh();
      else if (!smartRefreshTimer && !smartRefreshRequest) {
        smartRefreshTimer = global.setTimeout(refreshSmart, SMART_REFRESH_MS);
      }
    }

    async function refreshSmart() {
      smartRefreshTimer = undefined;
      if (!canRefreshSmart()) return;
      if (mount.querySelector('dialog[open]')) { syncSmartRefresh(); return; }
      const controller = new AbortController();
      smartRefreshRequest = controller;
      try {
        const result = await get('/smart/messages', smartParams(history[page - 1]?.nextCursor), { signal: controller.signal });
        if (smartRefreshRequest !== controller || !canRefreshSmart() || result.incomplete || !Array.isArray(result.messages)
          || mount.querySelector('dialog[open]')) return;
        if (!listError && JSON.stringify(history[page]) === JSON.stringify(result)) return;
        if (history[page]?.nextCursor !== result.nextCursor) history.length = page + 1;
        history[page] = result;
        const visible = new Set(result.messages.map(message => message.id));
        for (const id of selected) if (!visible.has(id)) selected.delete(id);
        listError = null;
        renderPage(true);
      } catch {
        // A later refresh can recover while the last successful page stays visible.
      } finally {
        if (smartRefreshRequest === controller) {
          smartRefreshRequest = undefined;
          syncSmartRefresh();
        }
      }
    }

    async function loadPage(cursor, refresh = false) {
      if (loading || writing) return;
      stopSmartRefresh();
      loading = true;
      listError = null;
      actionError = null;
      renderPage();
      try {
        const params = { limit };
        if (cursor) params.cursor = cursor;
        let endpoint = '/inbox';
        const unified = (!scope.account || scope.role === 'all') && !scope.box && !scope.search && unifiedRoles.includes(scope.role);
        if (unified) {
          endpoint = '/unified/' + scope.role;
          if (scope.account) params.accountId = scope.account.id;
        }
        if (scope.account && scope.box) {
          endpoint = '/accounts/' + scope.account.id + '/messages';
          params.mailbox = scope.box.id;
        }
        if (scope.search || Object.keys(appliedFilters).length) {
          endpoint = '/search';
          delete params.mailbox;
          if (!scope.search) {
            if (scope.box?.id) params.mailbox = scope.box.id;
            else if (scope.role === 'inbox') params.inbox = '1';
            else if (unified) params.role = scope.role;
          }
          if (scope.account) params.accountId = scope.account.id;
          if (scope.contactEmail) params.contactEmail = scope.contactEmail;
          else if (scope.search) params.q = searchTerm;
          Object.assign(params, appliedFilters);
        } else if (scope.filter) {
          endpoint = '/smart/messages';
          Object.assign(params, smartParams(cursor));
        }
        const result = await get(endpoint, params);
        if (endpoint !== '/smart/messages' && !analysisRun) void updateAnalysisCount();
        if (!cursor) history = [];
        history.push(result);
        page = history.length - 1;
        selected.clear();
        if (refresh && !result.incomplete) {
          for (const message of result.messages.filter(verified)) unknown.delete(message.id);
        }
      } catch (error) {
        if (cursor && error.code === 'MAIL_CLIENT_CURSOR_INVALID') {
          history = [];
          page = 0;
          selected.clear();
        }
        listError = error;
      } finally {
        loading = false;
        renderPage();
      }
    }

    function go(index) {
      if (loading || writing) return;
      if (history[index]) {
        stopSmartRefresh();
        selected.clear();
        listError = null;
        actionError = null;
        page = index;
        renderPage();
      } else if (history[page]?.nextCursor) {
        void loadPage(history[page].nextCursor);
      }
    }

    async function mutate(items, action, value, folderScope = scope, origin = 'user') {
      if (writing || loading || writeDenied || !items.length || items.some(message => !actionable(message))) return;
      const automatic = origin === 'auto';
      writing = true;
      actionError = null;
      renderPage();
      let refresh = false;
      try {
        const operations = items.map(message => {
          const operation = { messageId: message.id, action };
          if (action === 'move') {
            operation.targetMailbox = value;
            const source = gmailMoveSource(message, folderScope);
            if (source) operation.sourceMailbox = source;
          } else if (value !== undefined) operation.value = value;
          if (automatic) operation.origin = origin;
          return operation;
        });
        const response = await apiFetch('/api/mail-client/messages/actions', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: requestId(),
            operations,
          }),
        });
        const data = await response.json();
        if (data.code === 'MAIL_CLIENT_WRITE_DISABLED') {
          writeDenied = true;
          if (!automatic) showToast('이 환경에서는 메일 상태를 변경할 수 없어.');
          return;
        }
        const failures = [];
        for (const message of items) {
          const result = data.results?.find(receipt => receipt.messageId === message.id);
          if (result?.state === 'confirmed') {
            if (result.code === 'MAIL_CLIENT_MANUAL_UNREAD_PRESERVED') continue;
            if (action === 'set_read') message.read = value;
            if (action === 'set_starred') message.starred = value;
            if ((action === 'archive' && scope.role === 'inbox') || (action === 'trash' && scope.role !== 'trash')) {
              history[page].messages = messages().filter(item => item.id !== message.id);
            }
            refresh = true;
          } else if (result?.state === 'failed') failures.push(message.id);
          else unknown.add(message.id);
          if (!failures.includes(message.id) || !['set_read', 'move'].includes(action)) selected.delete(message.id);
        }
        if (automatic) return data.results;
        if (items.some(message => unknown.has(message.id))) showToast('결과를 확인할 수 없는 메일이 있어. 새로고침으로 확인해 줘.');
        else if (failures.length && ['set_read', 'move'].includes(action) && !refresh) {
          actionError = { items: failures, action, value, folderScope };
        }
        else if (failures.length) showToast(action === 'move' ? '선택한 메일을 모두 옮기지 못했어.' : '일부 메일을 변경하지 못했어.');
        return data.results;
      } catch {
        items.forEach(message => unknown.add(message.id));
        if (!automatic) {
          selected.clear();
          showToast('메일 변경 결과를 확인하지 못했어. 새로고침으로 확인해 줘.');
        }
      } finally {
        writing = false;
        if (refresh) void loadPage();
        else renderPage();
      }
    }

    async function openDraft(message) {
      try {
        const data = await get('/accounts/' + message.accountId + '/messages/' + message.id + '/draft');
        messageViews.openCompose({ kind: 'new', draft: { ...data.draft, accountId: message.accountId } });
      } catch { showToast('이 초안을 열지 못했어.'); }
    }

    async function refreshAccounts(reset = false) {
      accounts = (await get('/accounts')).accounts;
      boxes.clear();
      if (reset) expanded.clear();
      await Promise.all(accounts.filter(account => !['disabled', 'auth_required'].includes(account.status)).map(async account => {
        try {
          const data = await get('/accounts/' + account.id + '/mailboxes');
          boxes.set(account.id, data.mailboxes);
          if (account.provider === 'gmail' && reset) expanded.add(account.id);
        } catch {
          // A folder lookup can fail independently of the unified inbox.
        }
      }));
    }

    async function accountsChanged() {
      try { await refreshAccounts(); }
      catch { showToast('메일 계정 목록을 갱신하지 못했어.'); return; }
      if (scope.account && accounts.find(account => account.id === scope.account.id)?.status === 'disabled') {
        scope = { role: 'inbox', title: '받은편지함' };
        searchTerm = '';
        appliedFilters = {};
      }
      inboxUnread = null;
      history = [];
      page = 0;
      selected.clear();
      renderSidebar();
      void loadPage();
    }

    async function open(message = null) {
      if (loading || writing) return true;
      try { await refreshAccounts(true); }
      catch (error) {
        if (error.code !== 'MAIL_CLIENT_DISABLED') showToast('메일 계정을 확인하지 못했어.');
        return false;
      }
      if (screen) close();
      scope = { role: 'inbox', title: '받은편지함' };
      searchTerm = '';
      appliedFilters = {};
      inboxUnread = null;
      toggleMailboxes(false, false);
      selected.clear();
      history = [];
      page = 0;
      void loadPage();
      if (Number.isSafeInteger(message?.id)) messageViews.detail({ id: message.id, accountId: message.accountId }, [], 0, scope);
      return true;
    }

    return { open };
  }

  global.MailWorkspace = { create };
})(window);
