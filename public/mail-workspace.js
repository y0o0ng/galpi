'use strict';

(function register(global) {
  const providers = { gmail: 'Gmail', naver: 'Naver', works: 'Works' };
  const folders = [
    ['all', '전체 메일', 'mail'], ['inbox', '받은편지함', 'inbox'], ['sent', '보낸편지함', 'send'],
    ['drafts', '임시보관함', 'draft'], ['archive', '보관함', 'archive'], ['junk', '스팸함', 'spam'], ['trash', '휴지통', 'trash'],
  ];
  const smart = [
    ['중요', 'star'], ['조치 필요', 'action'], ['일정', 'calendar'],
    ['마감', 'deadline'], ['무시', 'muted'], ['미분류', 'unsorted'],
  ];
  const actions = [
    ['읽음', 'read', 'set_read', true], ['안 읽음', 'unread', 'set_read', false],
    ['중요', 'star', 'set_starred', true], ['보관', 'archive', 'archive'], ['휴지통', 'trash', 'trash'],
    ['이동', 'move', null],
  ];
  const limit = 13;
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

    const sidebar = node('aside', 'mw-sidebar');
    sidebar.setAttribute('aria-label', '메일함');
    const main = node('div', 'mw-main');
    const header = node('header', 'mw-header');
    const toolbar = node('div', 'mw-toolbar');
    const rows = node('div', 'mw-rows');
    rows.setAttribute('aria-label', '메일 목록');
    const footer = node('footer', 'mw-pagination');
    main.append(header, toolbar, rows, footer);
    mount.replaceChildren(sidebar, main);

    async function get(endpoint, params = {}) {
      const query = new URLSearchParams(params).toString();
      const response = await apiFetch('/api/mail-client' + endpoint + (query ? '?' + query : ''), { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success) throw Object.assign(new Error(data.code), { code: data.code });
      return data;
    }

    function messages() {
      return history[page]?.messages || [];
    }

    function verified(message) {
      return Number.isSafeInteger(message.id) && message.id > 0 && !message.stale && !message.detailError;
    }

    function actionable(message) {
      return verified(message) && !unknown.has(message.id);
    }

    function mailboxFor(role) {
      const candidates = scope.account ? [scope.account] : accounts;
      const matches = candidates.flatMap(account => (boxes.get(account.id) || [])
        .filter(box => box.selectable && roleOf(box) === role).map(box => ({ account, box })));
      if (matches.length === 1) return matches[0];
      return null;
    }

    function changeScope(next) {
      if (loading || writing) return;
      scope = next;
      history = [];
      page = 0;
      selected.clear();
      void loadPage();
    }

    function inbox(account) {
      const box = (boxes.get(account?.id) || []).find(candidate => candidate.inbox && candidate.selectable);
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

    function renderSidebar(unread) {
      const top = node('div', 'mw-sidebar-head');
      top.append(node('h2', '', '메일'), button('mw-compose', '메일 쓰기', null, { glyph: 'compose' }));
      const standard = node('nav', 'mw-nav');
      standard.setAttribute('aria-label', '기본 메일함');
      for (const [role, title, glyph] of folders) {
        const target = role === 'inbox' ? null : mailboxFor(role);
        const handler = role === 'inbox' ? () => inbox(scope.account)
          : target && (() => changeScope({ ...target, role, title }));
        standard.append(navRow(title, glyph, handler, scope.role === role, role === 'inbox' && scope.role === role ? unread : null));
      }

      const smartNav = node('nav', 'mw-nav');
      smartNav.setAttribute('aria-label', '스마트 메일함');
      smartNav.append(node('h3', 'mw-nav-title', '스마트 메일함'));
      for (const [label, glyph] of smart) smartNav.append(navRow(label, glyph, null));

      const accountNav = node('nav', 'mw-nav');
      accountNav.setAttribute('aria-label', '계정');
      accountNav.append(node('h3', 'mw-nav-title', '계정'));
      for (const account of accounts) {
        const custom = (boxes.get(account.id) || []).filter(box => box.selectable && (
          (box.kind === 'label' && box.type === 'user') || (box.kind === 'folder' && !roleOf(box))
        ));
        const label = button('mw-account', providers[account.provider], custom.length ? () => {
          if (expanded.has(account.id)) expanded.delete(account.id);
          else expanded.add(account.id);
          renderSidebar(unread);
          sidebar.querySelector('[data-account-id="' + account.id + '"]')?.focus();
        } : null, { glyph: expanded.has(account.id) && custom.length ? 'chevron-down' : 'chevron-right', size: 16 });
        label.dataset.accountId = account.id;
        if (custom.length) label.setAttribute('aria-expanded', String(expanded.has(account.id)));
        const address = node('span', 'mw-address', account.address);
        address.title = account.address;
        label.append(address);
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
      bottom.append(navRow('연락처', 'contacts', null), navRow('메일 설정', 'settings', null));
      sidebar.replaceChildren(top, standard, smartNav, accountNav, bottom);
    }

    function renderHeader(unread) {
      const heading = node('h1', '', scope.title);
      heading.tabIndex = -1;
      const total = node('span', 'mw-unread', unread == null ? '' : '안 읽음 ' + labels.format(unread));
      total.title = '현재 페이지의 안 읽은 메일';
      const chips = node('div', 'mw-chips');
      chips.setAttribute('role', 'group');
      chips.setAttribute('aria-label', '계정 범위');
      for (const [provider, name] of [['', '전체'], ...Object.entries(providers)]) {
        const account = accounts.find(item => item.provider === provider);
        const active = !provider ? !scope.account : account != null && scope.account?.id === account.id;
        const canOpen = !provider || (boxes.get(account?.id) || []).some(box => box.inbox && box.selectable);
        const chip = button('mw-chip', name, canOpen && !writing && !loading ? () => inbox(account) : null);
        chip.setAttribute('aria-pressed', String(active));
        chips.append(chip);
      }
      const search = node('div', 'mw-search');
      const input = node('input');
      input.type = 'search';
      input.disabled = true;
      input.placeholder = '메일 검색';
      input.setAttribute('aria-label', '메일 검색');
      search.append(icon('search', 18), input,
        button('mw-search-scope', '전체 계정', null, { glyph: 'chevron-down', size: 14 }));
      header.replaceChildren(heading, total, node('span', 'mw-spacer'), chips, search);
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
      } : null, { glyph: count ? 'checkbox-on' : 'checkbox-off', size: 20, iconOnly: true });
      toggle.setAttribute('aria-pressed', String(all));
      const group = node('div', 'mw-actions');
      for (const [label, glyph, action, value] of actions) {
        const control = button('mw-action', label, count && action && !writeDenied && !writing && !loading ? () => {
          void mutate(available.filter(message => selected.has(message.id)), action, value);
        } : null, { glyph, size: 16 });
        if (action === 'set_starred') control.title = '선택한 메일에 별표 표시';
        group.append(control);
      }
      const selection = [toggle];
      toggle.append(icon('chevron-down', 14));
      if (count > 0) selection.push(node('span', 'mw-selection', labels.format(count) + '개 선택'));
      toolbar.replaceChildren(...selection, node('span', 'mw-rule'), group, node('span', 'mw-spacer'),
        button('mw-action', '필터', null, { glyph: 'filter', size: 16 }),
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
      const sender = message.from?.[0];
      const from = node('span', 'mw-sender', sender?.name || sender?.address || '');
      const content = node('span', 'mw-content');
      content.append(node('span', 'mw-subject', subject));
      el.append(select, star, node('span', 'mw-unread-dot'), from, content);
      if (message.hasAttachments === true) el.append(icon('paperclip', 16));
      el.append(node('span', 'mw-provider', providers[message.provider] || ''), node('span', 'mw-time', timeOf(message.receivedAt)));
      if (!actionable(message)) el.title = '현재 메일 위치 또는 변경 결과를 확인할 수 없어.';
      return el;
    }

    function renderFooter() {
      const count = messages().length;
      const offset = history.slice(0, page).reduce((sum, entry) => sum + entry.messages.length, 0);
      const first = Math.max(0, page - 2);
      const last = Math.min(first + 5, history.length + Number(Boolean(history.at(-1)?.nextCursor)));
      const parts = [node('span', '', count ? labels.format(offset + 1) + '–' + labels.format(offset + count) : ''),
        node('span', 'mw-spacer'), button('mw-square', '이전 페이지', page > 0 && !loading && !writing ? () => go(page - 1) : null,
          { glyph: 'chevron-left', iconOnly: true })];
      for (let i = first; i < last; i++) {
        const control = button('mw-square', String(i + 1), i !== page && !loading && !writing ? () => go(i) : null);
        if (i === page) control.setAttribute('aria-current', 'page');
        parts.push(control);
      }
      parts.push(button('mw-square', '다음 페이지', page + 1 < last && !loading && !writing ? () => go(page + 1) : null,
        { glyph: 'chevron-right', iconOnly: true }));
      footer.replaceChildren(...parts);
    }

    function renderPage() {
      const current = history[page];
      const unread = current ? current.messages.filter(message => message.read === false).length : null;
      rows.setAttribute('aria-busy', String(loading));
      rows.replaceChildren(...messages().map(row));
      renderSidebar(unread);
      renderHeader(unread);
      renderToolbar();
      renderFooter();
    }

    async function loadPage(cursor, refresh = false) {
      if (loading || writing) return;
      loading = true;
      renderPage();
      try {
        const params = { limit };
        if (cursor) params.cursor = cursor;
        let endpoint = '/inbox';
        if (scope.account) {
          endpoint = '/accounts/' + scope.account.id + '/messages';
          params.mailbox = scope.box.id;
        }
        const result = await get(endpoint, params);
        if (!cursor) history = [];
        history.push(result);
        page = history.length - 1;
        selected.clear();
        if (refresh && !result.incomplete) {
          for (const message of result.messages.filter(verified)) unknown.delete(message.id);
        }
        const unavailable = (result.sources || [result.source]).filter(source => source && source.status !== 'fresh');
        if (unavailable.length || result.incomplete) {
          const names = unavailable.map(source => providers[source.provider]).filter(Boolean).join(', ');
          showToast((names ? names + ' · ' : '') + '일부 메일이 최신 상태가 아닐 수 있어.');
        }
      } catch (error) {
        if (cursor && error.code === 'MAIL_CLIENT_CURSOR_INVALID') {
          history = [];
          page = 0;
          selected.clear();
          showToast('메일 목록이 갱신됐어. 새로고침으로 첫 페이지를 열어 줘.');
        } else showToast('메일 목록을 불러오지 못했어.');
      } finally {
        loading = false;
        renderPage();
      }
    }

    function go(index) {
      if (loading || writing) return;
      if (history[index]) {
        selected.clear();
        page = index;
        renderPage();
      } else if (history[page]?.nextCursor) {
        void loadPage(history[page].nextCursor);
      }
    }

    async function mutate(items, action, value) {
      if (writing || loading || writeDenied || !items.length || items.some(message => !actionable(message))) return;
      writing = true;
      renderPage();
      let refresh = false;
      try {
        const operations = items.map(message => ({
          messageId: message.id, action, ...(value === undefined ? {} : { value }),
        }));
        const response = await apiFetch('/api/mail-client/messages/actions', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: global.crypto.randomUUID?.()
              || Array.from(global.crypto.getRandomValues(new Uint32Array(4)), value => value.toString(36)).join('-'),
            operations,
          }),
        });
        const data = await response.json();
        if (data.code === 'MAIL_CLIENT_WRITE_DISABLED') {
          writeDenied = true;
          showToast('이 환경에서는 메일 상태를 변경할 수 없어.');
          return;
        }
        let failures = 0;
        for (const message of items) {
          const result = data.results?.find(receipt => receipt.messageId === message.id);
          if (result?.state === 'confirmed') {
            if (action === 'set_read') message.read = value;
            if (action === 'set_starred') message.starred = value;
            if ((action === 'archive' && scope.role === 'inbox') || (action === 'trash' && scope.role !== 'trash')) {
              history[page].messages = messages().filter(item => item.id !== message.id);
            }
            refresh = true;
          } else if (result?.state === 'failed') failures++;
          else unknown.add(message.id);
          selected.delete(message.id);
        }
        if (items.some(message => unknown.has(message.id))) showToast('결과를 확인할 수 없는 메일이 있어. 새로고침으로 확인해 줘.');
        else if (failures) showToast('일부 메일을 변경하지 못했어.');
      } catch {
        items.forEach(message => unknown.add(message.id));
        selected.clear();
        showToast('메일 변경 결과를 확인하지 못했어. 새로고침으로 확인해 줘.');
      } finally {
        writing = false;
        if (refresh) void loadPage();
        else renderPage();
      }
    }

    async function open() {
      if (loading || writing) return true;
      try {
        const data = await get('/accounts');
        accounts = data.accounts;
      } catch (error) {
        if (error.code !== 'MAIL_CLIENT_DISABLED') showToast('메일 계정을 확인하지 못했어.');
        return false;
      }
      boxes.clear();
      expanded.clear();
      await Promise.all(accounts.filter(account => account.status !== 'disabled').map(async account => {
        try {
          const data = await get('/accounts/' + account.id + '/mailboxes');
          boxes.set(account.id, data.mailboxes);
          if (account.provider === 'gmail') expanded.add(account.id);
        } catch {
          // A folder lookup can fail independently of the unified inbox.
        }
      }));
      scope = { role: 'inbox', title: '받은편지함' };
      selected.clear();
      history = [];
      page = 0;
      void loadPage();
      return true;
    }

    return { open };
  }

  global.MailWorkspace = { create };
})(window);
