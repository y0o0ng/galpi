'use strict';

(function register(global) {
  function create(ui) {
    const { node, button, icon, providers, timeOf, get, request, show, accounts, openMessage, compose, makeRow, notify, searchHistory, toggleMailboxes } = ui;
    const sources = [['', '전체'], ['gmail', 'Gmail'], ['naver', 'Naver'], ['works', 'Works'], ['csv', 'CSV'], ['observed', '메일에서 수집']];
    const sourceLabels = Object.fromEntries(sources);
    const contactPicker = node('input');
    contactPicker.type = 'file';
    contactPicker.accept = '.csv,text/csv';
    contactPicker.hidden = true;
    const kst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
    const calendarDate = new Intl.DateTimeFormat('ko', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' });
    const time = new Intl.DateTimeFormat('ko', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const labels = { personal: '개인', official: '공식', deadline: '마감' };
    let refreshCalendar;
    const preferenceLabels = { suppress_notification: '알림 억제', skip_analysis: '분석 제외',
      always_notify: '중요로 알림', archive_quietly: '조용히 보관' };

    function control(text, action, glyph, className = 'mw-outlined') {
      return button(className, text, action, { glyph, size: 16 });
    }

    function section(title, action) {
      const panel = node('section', 'mw-view-card mw-settings-card');
      const head = node('header', 'mw-settings-head');
      head.append(node('h2', '', title));
      if (action) head.append(action);
      panel.append(head);
      return panel;
    }

    function badge(source) { return node('span', 'mw-pill', sourceLabels[source] || source); }

    function searchForm(label, action) {
      const form = node('form', 'mw-search');
      const input = node('input');
      input.type = 'search';
      input.placeholder = label;
      input.setAttribute('aria-label', label);
      input.maxLength = 160;
      form.append(icon('search', 18), input);
      form.addEventListener('submit', event => { event.preventDefault(); action(input.value.trim()); });
      return { form, input };
    }

    function chips(choices, active, handler) {
      const group = node('div', 'mw-chips');
      for (const [key, label] of choices) {
        const chip = button('mw-chip', label, () => handler(key));
        chip.setAttribute('aria-pressed', String(key === active));
        group.append(chip);
      }
      return group;
    }

    function contacts() {
      const panel = node('section', 'mw-aux mw-contacts');
      show('contacts', panel);
      let source = '';
      let query = '';
      let token = 0;
      let nextOffset;
      let loading = false;
      const seen = new Set();
      const head = node('header', 'mw-aux-head');
      const total = node('span', 'mw-muted');
      const filters = node('div');
      const table = node('div', 'mw-view-card mw-contact-list');
      const observer = new IntersectionObserver(([entry]) => {
        if (!panel.isConnected) observer.disconnect();
        else if (entry.isIntersecting && entry.target === table.lastElementChild && nextOffset !== undefined) void load(nextOffset, token);
      });
      const { form, input } = searchForm('이름·이메일·소속 검색', value => { query = value; void refresh(); });
      input.addEventListener('search', () => { if (!input.value) { query = ''; void refresh(); } });
      const menu = button('mw-menu mw-compact-only', '메일함 메뉴 열기', () => toggleMailboxes(true),
        { glyph: 'menu', size: 22, iconOnly: true });
      const compactSearch = button('mw-compact-search mw-compact-only', '연락처 검색', () => {
        head.classList.toggle('mw-contact-search-open');
        if (head.classList.contains('mw-contact-search-open')) input.focus();
      }, { glyph: 'search', size: 22, iconOnly: true });
      const title = node('div', 'mw-title');
      title.append(node('h1', '', '연락처'), total);
      head.append(menu, title, node('span', 'mw-spacer'), form, compactSearch,
        control('CSV 가져오기', () => pickCsv(contacts), 'download'));
      panel.append(head, filters, table);
      void refresh();

      function refresh() {
        const sequence = ++token;
        observer.disconnect();
        seen.clear();
        nextOffset = undefined;
        loading = false;
        filters.replaceChildren(chips(sources, source, value => { source = value; void refresh(); }));
        total.textContent = '';
        const heading = node('div', 'mw-contact-row mw-contact-columns');
        heading.append(node('span'), ...['이름','이메일','소속','출처'].map(label => node('span', '', label)));
        table.replaceChildren(heading);
        void load(0, sequence);
      }

      async function load(offset, sequence) {
        if (loading) return;
        loading = true;
        const params = { limit: 200, ...(offset ? { offset } : {}), ...(query ? { q: query } : {}), ...(source ? { source } : {}) };
        const result = await get('/contacts', params).catch(() => null);
        if (sequence !== token || !panel.isConnected) return;
        loading = false;
        if (!result) return;
        total.textContent = result.total.toLocaleString('ko') + '명';
        nextOffset = result.nextOffset > offset ? result.nextOffset : undefined;
        for (const entry of result.contacts) {
          const email = entry.email.toLowerCase();
          if (seen.has(email)) continue;
          seen.add(email);
          const row = button('mw-contact-row', '', () => void contactDetail(entry));
          row.replaceChildren(node('span', 'mw-avatar', (entry.name || entry.email).slice(0, 1)),
            node('strong', '', entry.name || entry.email), node('span', 'mw-contact-email', entry.email),
            node('span', 'mw-contact-company', entry.organization || '—'), badge(entry.source));
          table.append(row);
        }
        observer.disconnect();
        if (nextOffset !== undefined) observer.observe(table.lastElementChild);
      }
    }

    async function contactDetail(entry) {
      const panel = node('section', 'mw-aux mw-contact-detail');
      show('contacts', panel);
      const top = node('header', 'mw-aux-head');
      top.append(control('연락처', contacts, 'arrow-left', 'mw-view-action'), node('span', 'mw-spacer'),
        button('mw-square mw-compact-only', '연락처 메뉴', null, { glyph: 'more', iconOnly: true }));
      const card = node('div', 'mw-view-card');
      const info = node('header', 'mw-contact-profile');
      const heading = node('div');
      heading.append(node('h1', '', entry.name || entry.email), node('p', 'mw-muted', entry.organization || ''));
      info.append(node('span', 'mw-avatar', (entry.name || entry.email).slice(0, 1)), heading, node('span', 'mw-spacer'),
        control('메일 쓰기', () => compose({ kind: 'new', to: entry.email, onReturn: () => contactDetail(entry) }), 'compose', 'mw-popover-primary'));
      const attributes = node('dl', 'mw-contact-attributes');
      for (const [label, value] of [['이메일', entry.email], ['소속', entry.organization || '—'], ['출처', sourceLabels[entry.source] || '']]) {
        attributes.append(node('dt', 'mw-muted', label), node('dd', '', value));
      }
      const history = node('section', 'mw-contact-history');
      card.append(info, attributes, history);
      panel.append(top, card);
      const data = await get('/search', { contactEmail: entry.email, limit: 13 }).catch(() => null);
      if (!panel.isConnected) return;
      const title = node('header', 'mw-settings-head');
      title.append(node('h2', '', '주고받은 메일'), node('span', 'mw-muted', data ? data.total + '통' : ''));
      const list = node('div', 'mw-rows');
      const more = control('모두 보기', data ? () => searchHistory(entry.email) : null, undefined, 'mw-view-action');
      title.append(node('span', 'mw-spacer'), more);
      list.replaceChildren(...(data?.messages || []).slice(0, 3).map(makeRow));
      history.append(title, list);
    }

    function pickCsv(onDone) {
      if (!contactPicker.isConnected) document.getElementById('mail-workspace').append(contactPicker);
      contactPicker.value = '';
      contactPicker.onchange = () => {
        if (contactPicker.files[0]) void csvDialog(contactPicker.files[0], onDone);
      };
      contactPicker.click();
    }

    function parseCsv(value) {
      const rows = [];
      let row = [], cell = '', quoted = false;
      for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (quoted) {
          if (ch === '"' && value[i + 1] === '"') { cell += '"'; i++; }
          else if (ch === '"') quoted = false;
          else cell += ch;
        } else if (ch === '"' && !cell.length) quoted = true;
        else if (ch === ',') { row.push(cell); cell = ''; }
        else if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && value[i + 1] === '\n') i++;
          row.push(cell);
          if (row.some(item => item.trim())) rows.push(row);
          row = []; cell = '';
        } else cell += ch;
      }
      if (quoted) throw new Error('열 따옴표가 닫히지 않았어.');
      row.push(cell);
      if (row.some(item => item.trim())) rows.push(row);
      return rows;
    }

    async function csvDialog(file, onDone) {
      if (file.size > 1024 ** 2) { notify('CSV 파일은 최대 1MB까지 가져올 수 있어.'); return; }
      let rows;
      try {
        const data = await file.arrayBuffer();
        let text;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); }
        catch { text = new TextDecoder('euc-kr').decode(data); }
        rows = parseCsv(text);
      } catch { notify('CSV 파일을 읽지 못했어.'); return; }
      if (rows.length < 2 || rows.length > 1001 || rows[0].length > 24) {
        notify('헤더를 포함한 CSV 연락처 1~1,000개를 가져올 수 있어.');
        return;
      }
      const [columns, ...entries] = rows;
      const targets = [['', '가져오지 않음'], ['name', '이름'], ['email', '이메일'], ['organization', '소속']];
      const panel = node('dialog', 'mw-csv-dialog mw-view-card');
      panel.setAttribute('aria-label', 'CSV에서 연락처 가져오기');
      panel.addEventListener('close', () => panel.remove(), { once: true });
      const heading = node('header', 'mw-aux-head');
      heading.append(node('h2', '', 'CSV에서 연락처 가져오기'), node('span', 'mw-spacer'),
        button('mw-square', '닫기', () => panel.close(), { glyph: 'close', iconOnly: true }));
      const fileRow = node('div', 'mw-csv-file');
      fileRow.append(icon('paperclip', 16), node('strong', '', file.name), node('span', 'mw-muted', entries.length + '명'),
        node('span', 'mw-spacer'), control('다른 파일', () => { panel.close(); pickCsv(onDone); }, undefined, 'mw-view-action'));
      const pairs = node('div', 'mw-view-card mw-csv-columns');
      const mapping = columns.map((column, index) => {
        const select = node('select');
        select.setAttribute('aria-label', column + ' 열 맞추기');
        const normalized = column.toLowerCase().replace(/[^a-z가-힣]/g, '');
        const match = /email|이메일|메일주소/.test(normalized) ? 'email' : /organization|company|소속|회사/.test(normalized)
          ? 'organization' : /name|이름|성명/.test(normalized) ? 'name' : '';
        for (const [value, label] of targets) {
          const option = node('option', '', label);
          option.value = value;
          option.selected = value === match;
          select.append(option);
        }
        const row = node('div', 'mw-csv-pair');
        const sample = node('div');
        sample.append(node('strong', '', column), node('p', 'mw-muted', entries[0]?.[index] || ''));
        row.append(sample, icon('chevron-right', 14), select);
        pairs.append(row);
        select.addEventListener('change', () => void preview());
        return select;
      });
      const description = node('p', 'mw-muted');
      const cancel = control('취소', () => panel.close(), undefined, 'mw-popover-secondary');
      const submit = control('가져오기', async () => {
        submit.disabled = true;
        try {
          const data = await request('/contacts/import', { method: 'POST', json: { entries: items() } });
          panel.close();
          notify('연락처 ' + data.created + '명을 가져왔어.');
          onDone();
        } catch { notify('연락처를 가져오지 못했어.'); await preview(); }
      }, undefined, 'mw-popover-primary');
      const bottom = node('footer', 'mw-popover-footer');
      bottom.append(cancel, submit);
      panel.append(heading, fileRow, node('p', 'mw-muted', '열 맞추기'), pairs, description, bottom);
      document.getElementById('mail-workspace').append(panel);
      panel.showModal();
      let sequence = 0;
      function items() {
        return entries.map(row => Object.fromEntries(mapping.flatMap((select, index) => select.value
          ? [[select.value, (row[index] || '').trim()]] : [])));
      }
      async function preview() {
        const version = ++sequence;
        submit.disabled = true;
        const chosen = mapping.map(item => item.value).filter(Boolean);
        if (!chosen.includes('email') || new Set(chosen).size !== chosen.length) {
          description.textContent = '이메일 열을 하나 지정하고, 각 항목에 한 열만 맞춰 줘.';
          return;
        }
        const result = await request('/contacts/import', { method: 'POST', json: { entries: items(), preview: true } }).catch(() => null);
        if (!panel.isConnected || sequence !== version) return;
        description.textContent = result ? '새 연락처 ' + result.created + '명 · 이미 있는 ' + result.skipped
          + '명은 건너뛰어' + (result.invalid ? ' · 주소 오류 ' + result.invalid + '명' : '') : '가져올 연락처를 확인하지 못했어.';
        submit.querySelector('span:last-child').textContent = result ? result.created + '명 가져오기' : '가져오기';
        submit.disabled = !result?.created;
      }
      await preview();
    }

    function settings() {
      const panel = node('section', 'mw-aux mw-settings');
      show('settings', panel);
      const grid = node('div', 'mw-settings-grid');
      const left = node('div');
      const right = node('div');
      grid.append(left, right);
      panel.append(node('h1', '', '메일 설정'), grid);
      let preferenceView = '';
      let state = null;
      let preferences = [];
      let settingsData = null;
      let directory = null;
      void refresh();

      async function refresh() {
        [state, settingsData, directory] = await Promise.all([
          get('/api/mail/status').catch(() => null),
          get('/api/mail/settings').then(data => data.settings).catch(() => null),
          get('/contacts', { limit: 1 }).catch(() => null),
        ]);
        preferences = await get('/api/mail/preferences').then(data => data.preferences || []).catch(() => []);
        if (panel.isConnected) render();
      }

      function health(text, tone) {
        const badge = node('span', 'mw-pill', text);
        badge.dataset.tone = tone;
        return badge;
      }

      function settingsLine(title, caption, ...buttons) {
        const row = node('div', 'mw-settings-line');
        const text = node('div', 'mw-settings-description');
        text.append(node('strong', '', title), node('p', 'mw-muted', caption));
        row.append(text, ...buttons);
        return row;
      }

      function render() {
        const linked = section('연결 계정', control('계정 추가', null));
        for (const account of state?.accounts || accounts()) {
          const active = account.status === 'active';
          linked.append(settingsLine((account.provider === 'works' ? 'NAVER WORKS' : providers[account.provider]) + '  ' + account.address,
            account.lastSyncAt ? '마지막 동기화 ' + timeOf(account.lastSyncAt) : '',
            health(active ? '• 연결됨' : '• 연결 확인 필요', active ? 'ok' : 'warn'), control('관리', null, undefined, 'mw-view-action')));
        }
        const contactList = section('연락처' + (directory ? '  ' + directory.total + '명' : ''), control('CSV 가져오기', () => pickCsv(refresh), 'download'));
        contactList.append(settingsLine('Gmail 연락처', '', health('미연결', 'off')),
          settingsLine('Naver 주소록', '직접 동기화 없음 · CSV로 가져와 줘', control('CSV 가져오기', () => pickCsv(refresh), undefined, 'mw-view-action'), health('미연결', 'off')),
          settingsLine('Works 조직도', '조직 관리자 승인 후 연결돼', control('다시 확인', null, undefined, 'mw-view-action'), health('권한 필요', 'warn')),
          settingsLine('CSV에서 가져옴', directory ? directory.total + '명' : ''),
          settingsLine('주고받은 사람을 연락처에 모으기', '', switchControl('메일에서 수집', directory?.collectionEnabled,
            directory ? async () => {
              try {
                await request('/contacts/settings', { method: 'PUT', json: { enabled: !directory.collectionEnabled } });
                await refresh();
              } catch { notify('연락처 설정을 저장하지 못했어.'); }
            } : null)));
        const rules = section('자동 분류 규칙', control('규칙 추가', null));
        rules.append(chips([['','전체'], ['sender','발신자'], ['domain','도메인'], ['skip_analysis','분석 제외'],
          ['suppress_notification','알림 억제']], preferenceView, key => { preferenceView = key; render(); }));
        for (const rule of preferences.filter(item => !preferenceView || [item.preferenceType, item.action].includes(preferenceView))) {
          const remove = control('해제', async () => {
            try { await request('/api/mail/preferences/' + rule.id, { method: 'DELETE' }); await refresh(); }
            catch { notify('규칙을 해제하지 못했어.'); }
          }, undefined, 'mw-view-action');
          rules.append(settingsLine(rule.value || rule.target || '', '', node('span', 'mw-muted',
            rule.preferenceType === 'domain' ? '도메인' : '발신자'), node('span', '', preferenceLabels[rule.action] || rule.action), remove));
        }
        const queue = section('시온 에이전트');
        const stats = node('div', 'mw-agent-stats');
        for (const [key, name] of [['pending', '분석 대기'], ['analyzing', '분석 중'], ['done', '완료'], ['failed', '실패']]) {
          const stat = node('div');
          stat.append(node('span', 'mw-muted', name), node('strong', '', state?.analysis?.[key]?.toLocaleString('ko') || '—'));
          stats.append(stat);
        }
        queue.append(stats, settingsLine('', state?.analysis?.failed ? '실패한 분석을 다시 처리할 수 있어.' : '실패한 분석이 없어.',
          control('다시 처리', state?.analysis?.failed ? async () => {
            try { await request('/api/mail/analysis/requeue', { method: 'POST' }); await refresh(); }
            catch { notify('분석 대기열을 갱신하지 못했어.'); }
          } : null)));
        const notifications = section('알림');
        const push = settingsData?.notificationsEnabled;
        const quiet = settingsData?.quietHours;
        async function update(patch) {
          try { settingsData = (await request('/api/mail/settings', { method: 'PUT', json: patch })).settings; render(); }
          catch { notify('설정을 저장하지 못했어.'); }
        }
        notifications.append(settingsLine('Push 알림', '시온이 확인된 메일로 고른 것만 알려 줘',
          switchControl('Push 알림', push, settingsData ? () => update({ notificationsEnabled: !push }) : null)),
        settingsLine('방해 금지 시간', quiet ? quiet.start + ' – ' + quiet.end + ' · 이 시간엔 모아서 아침에 알려 줘' : '',
          switchControl('방해 금지 시간', quiet?.enabled, quiet ? () => update({ quietHours: { ...quiet, enabled: !quiet.enabled } }) : null)));
        left.replaceChildren(linked, ...(directory ? [contactList] : []), rules);
        right.replaceChildren(queue, notifications);
      }

      function switchControl(label, enabled, handler) {
        const control = button('mw-toggle', label, handler, { iconOnly: true });
        control.setAttribute('role', 'switch');
        control.setAttribute('aria-checked', String(Boolean(enabled)));
        return control;
      }
    }

    function calendar() {
      const panel = node('section', 'mw-aux mw-calendar');
      show('calendar', panel);
      const today = kst.format(new Date());
      let selected = today;
      let month = today.slice(0, 7);
      let events = [];
      let token = 0;
      let failed = false;
      const header = node('header', 'mw-aux-head');
      const work = node('div', 'mw-calendar-grid');
      const grid = node('div', 'mw-view-card mw-calendar-month');
      const right = node('div', 'mw-calendar-right');
      const dayPanel = node('aside', 'mw-view-card mw-calendar-day');
      const undated = node('aside', 'mw-view-card mw-calendar-undated');
      const undatedCount = node('span', 'mw-muted');
      const undatedTitle = node('header', 'mw-calendar-undated-title');
      undatedTitle.append(node('h2', '', '미확정'), undatedCount);
      const undatedItems = node('div', 'mw-calendar-undated-items');
      undatedItems.tabIndex = 0;
      undatedItems.setAttribute('aria-label', '미확정 일정');
      undated.append(undatedTitle, undatedItems);
      right.append(dayPanel, undated);
      work.append(grid, right);
      panel.append(header, work);
      let undatedVersion = 0;
      let undatedCursor = null;
      let undatedLoading = false;
      const undatedIds = new Set();
      const observer = new IntersectionObserver(([entry]) => {
        if (!panel.isConnected) observer.disconnect();
        else if (entry.isIntersecting && entry.target === undatedItems.lastElementChild && undatedCursor) {
          void fetchUndated(undatedCursor);
        }
      }, { root: undatedItems });
      refreshCalendar = () => {
        if (!panel.isConnected) return;
        void fetchMonth();
        void fetchUndated();
      };
      render();
      refreshCalendar();

      async function fetchUndated(cursor) {
        if (cursor && undatedLoading) return;
        const sequence = cursor ? undatedVersion : ++undatedVersion;
        undatedLoading = true;
        try {
          const result = await get('/smart/calendar', { section: 'unresolved', limit: 13, ...(cursor ? { cursor } : {}) });
          if (sequence !== undatedVersion || !panel.isConnected) return;
          if (!cursor) {
            undatedItems.replaceChildren();
            undatedIds.clear();
          }
          for (const event of result.events) {
            if (undatedIds.has(event.id)) continue;
            undatedIds.add(event.id);
            const card = node('article', 'mw-calendar-event');
            card.append(node('strong', '', event.title), node('p', 'mw-muted', '“' + event.originalDateText + '”'), openOriginal(event));
            undatedItems.append(card);
          }
          undatedCount.textContent = Math.max(result.total ?? 0, undatedIds.size) + '개';
          undatedCursor = result.nextCursor;
          observer.disconnect();
          if (undatedCursor && undatedItems.lastElementChild) observer.observe(undatedItems.lastElementChild);
        } catch {
          if (sequence === undatedVersion && panel.isConnected && !undatedIds.size) {
            undatedItems.replaceChildren(node('p', 'mw-muted', '일정을 연결하지 못했어.'));
          }
        } finally {
          if (sequence === undatedVersion) undatedLoading = false;
        }
      }

      async function fetchMonth() {
        const version = ++token;
        events = [];
        failed = false;
        render();
        try {
          let cursor = null;
          do {
            const result = await get('/smart/calendar', { month, limit: 25, ...(cursor ? { cursor } : {}) });
            if (version !== token || !panel.isConnected) return;
            events.push(...result.events);
            cursor = result.nextCursor;
          } while (cursor);
        } catch { if (version !== token || !panel.isConnected) return; failed = true; }
        if (version === token && panel.isConnected) render();
      }

      function step(offset) {
        const base = new Date(month + '-01T00:00:00Z');
        base.setUTCMonth(base.getUTCMonth() + offset);
        selected = offset ? base.toISOString().slice(0, 10) : today;
        month = selected.slice(0, 7);
        void fetchMonth();
      }

      function onDate(day) { return events.filter(event => event.startDate <= day && (event.endDate || event.startDate) >= day); }
      function kindBadge(kind) {
        const chip = node('span', 'mw-event', labels[kind] || '');
        chip.dataset.kind = kind;
        return chip;
      }

      function openOriginal(event) {
        const action = control('원본 메일 열기', async () => {
          const data = await get('/smart/calendar/' + event.id).catch(() => null);
          if (!panel.isConnected) return;
          if (data?.event?.messageId) openMessage({ id: data.event.messageId });
          else notify('원본 메일을 확인하지 못했어.');
        }, undefined, 'mw-view-action');
        action.append(icon('chevron-right', 14));
        return action;
      }

      function render() {
        const [year, number] = month.split('-').map(Number);
        const legend = node('div', 'mw-calendar-legend');
        legend.append(...Object.keys(labels).map(kindBadge));
        const controls = node('div', 'mw-calendar-controls');
        controls.append(control('오늘', () => step(0)),
          button('mw-square', '이전 달', () => step(-1), { glyph: 'chevron-left', iconOnly: true }),
          node('strong', '', year + '년 ' + number + '월'),
          button('mw-square', '다음 달', () => step(1), { glyph: 'chevron-right', iconOnly: true }));
        header.replaceChildren(button('mw-menu', '메일함 메뉴 열기', () => toggleMailboxes(true), { glyph: 'menu', size: 22, iconOnly: true }),
          node('h1', '', '일정'), legend, controls);
        grid.replaceChildren(...['월','화','수','목','금','토','일'].map(day => node('span', 'mw-weekday', day)));
        const first = new Date(Date.UTC(year, number - 1, 1));
        const shift = (first.getUTCDay() + 6) % 7;
        for (let i = 0; i < 42; i++) {
          const date = new Date(Date.UTC(year, number - 1, 1 + i - shift));
          const key = date.toISOString().slice(0, 10);
          const cell = button('mw-calendar-date', String(date.getUTCDate()), () => { selected = key; render(); });
          cell.dataset.otherMonth = String(!key.startsWith(month));
          cell.dataset.today = String(key === today);
          cell.setAttribute('aria-pressed', String(key === selected));
          cell.setAttribute('aria-label', key);
          for (const item of onDate(key)) {
            const entry = node('span', 'mw-event', item.title);
            entry.dataset.kind = item.kind;
            cell.append(entry);
          }
          grid.append(cell);
        }
        const dayEvents = onDate(selected);
        dayPanel.replaceChildren(node('h2', '', calendarDate.format(new Date(selected + 'T00:00:00+09:00'))),
          node('p', 'mw-muted', failed ? '일정을 연결하지 못했어.' : '메일에서 찾은 일정 ' + dayEvents.length + '개'));
        const dayItems = node('div', 'mw-calendar-day-items');
        for (const item of dayEvents) {
          const event = node('article', 'mw-calendar-event');
          const row = node('div');
          row.append(kindBadge(item.kind), node('span', 'mw-muted', item.startAt ? time.format(item.startAt * 1000) : ''));
          const account = accounts().find(account => account.id === item.accountId);
          event.append(row, node('strong', '', item.title), node('p', 'mw-muted', providers[account?.provider] || ''),
            openOriginal(item));
          dayItems.append(event);
        }
        dayPanel.append(dayItems);
      }
    }

    return { contacts, settings, calendar, refreshCalendar: () => refreshCalendar?.() };
  }

  global.MailWorkspaceSecondary = { create };
})(window);
