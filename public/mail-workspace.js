'use strict';

(function registerMailWorkspace(global) {
  const { element, component, icon, button, navItem, sourceTag, row, calendarEvent, notice, empty, providers, eventNames } =
    global.MailWorkspaceComponents;
  const BASE = '/api/mail-client';
  const LIST_LIMIT = 13;
  const SMART = [
    ['important', '중요', 'star'], ['action_required', '조치 필요', 'action'], ['schedule', '일정', 'calendar'],
    ['deadline', '마감', 'deadline'], ['ignore', '무시', 'muted'], ['unclassified', '미분류', 'unsorted'],
  ];
  const folderRoles = {
    all: ['전체 메일', 'mail'], inbox: ['받은편지함', 'inbox'], sent: ['보낸편지함', 'send'],
    drafts: ['임시보관함', 'draft'], archive: ['보관함', 'archive'], junk: ['스팸함', 'spam'], trash: ['휴지통', 'trash'],
  };
  const actionLabels = { set_read: '읽음', set_starred: '별표', archive: '보관', trash: '휴지통', move: '이동' };
  const errorLabels = {
    MAIL_CLIENT_AUTH_REQUIRED: '계정 인증이 만료됐어. 계정 연결을 확인해 줘.',
    MAIL_CLIENT_ACCOUNT_MISMATCH: '연결된 계정 정보를 확인해 줘.',
    MAIL_CLIENT_ACCOUNT_DISABLED: '이 메일 계정은 비활성 상태야.',
    MAIL_CLIENT_DISABLED: '메일 작업 화면이 비활성 상태야.',
    MAIL_CLIENT_WRITE_DISABLED: '메일 변경 기능이 비활성 상태야.',
    MAIL_CLIENT_SMART_DISABLED: '스마트 메일함이 비활성 상태야.',
    MAIL_CLIENT_SMART_MODEL_UNAVAILABLE: '메일 분석 모델을 사용할 수 없어.',
    MAIL_CLIENT_SMART_PREFERENCE_SKIP: '분석 제외 규칙이 적용됐어.',
    MAIL_CLIENT_SMART_MAILBOX_UNVERIFIED: '메일함의 분석 가능 여부를 확인하지 못했어.',
    MAIL_CLIENT_SMART_INELIGIBLE: '이 메일은 분석 대상에서 제외돼.',
    MAIL_CLIENT_LOCATION_STALE: '메일 위치나 원본이 바뀌었어. 목록에서 다시 열어 줘.',
    MAIL_CLIENT_LOCATION_UNVERIFIED: '메일의 현재 위치를 확인하지 못했어.',
    MAIL_CLIENT_MESSAGE_GONE: '제공자에서 원본 메일을 찾지 못했어.',
    MAIL_CLIENT_MESSAGE_NOT_FOUND: '원본 메일을 찾지 못했어.',
    MAIL_CLIENT_SOURCE_TOO_LARGE: '원본 메일이 조회 한도를 초과했어.',
    MAIL_CLIENT_CURSOR_INVALID: '목록이 갱신됐어. 첫 페이지를 다시 불러와 줘.',
    MAIL_CLIENT_MOVE_UNSUPPORTED: '이 계정은 이동 기능을 지원하지 않아.',
    MAIL_CLIENT_WRITE_MAILBOX_NOT_FOUND: '이 계정에서 사용할 수 있는 대상 폴더가 없어.',
    MAIL_CLIENT_WRITE_AUTH_REQUIRED: '메일 변경 권한을 확인해 줘.',
    MAIL_CLIENT_SMART_MODEL_OUTPUT_INVALID: '분석 결과를 검증하지 못했어.',
    MAIL_CLIENT_SMART_MODEL_OR_SOURCE_FAILED: '메일 분석 중 오류가 발생했어.',
    MAIL_CLIENT_SMART_LEASE_EXPIRED: '분석 처리 시간이 초과됐어.',
  };
  const jobLabels = { pending: '분석 대기', analyzing: '분석 중', done: '분석 완료', failed: '분석 실패', skipped: '분석 제외' };
  const dateReasons = {
    year_in_source: '원문에 연도가 명시됨', nearest_future: '수신일 뒤의 가장 가까운 날짜',
    nearest_past: '수신일 앞의 가장 가까운 날짜', nearest_date: '수신일에서 가장 가까운 날짜',
    same_date_as_start: '시작 날짜와 같음', relative_date: '상대 날짜 표현', tied_dates: '같은 거리에 있는 날짜가 여러 개',
    conflicting_direction: '미래와 과거 표현이 함께 있음', attachment_required: '첨부 확인 필요',
    unsupported_date: '날짜 표현을 해석할 수 없음', time_or_timezone_unresolved: '시각이나 시간대를 확인할 수 없음',
    invalid_date: '달력에 없는 날짜', invalid_time: '유효하지 않은 시각', ambiguous_meridiem: '오전·오후가 불명확함',
    invalid_timezone: '유효하지 않은 시간대', ambiguous_end_timezone: '종료 시각의 시간대가 불명확함',
    no_date_in_direction: '해당 방향에서 날짜를 찾을 수 없음', end_before_start: '종료 시각이 시작보다 빠름',
  };
  const dateTime = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const shortDate = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' });
  const shortTime = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const localDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
  const narrow = global.matchMedia('(max-width: 1100px)');

  function path(endpoint, params = {}) {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== null && value !== '') query.set(name, value);
    }
    return BASE + endpoint + (query.size ? '?' + query.toString() : '');
  }

  function role(mailbox) {
    if (mailbox.inbox) return 'inbox';
    if (mailbox.kind === 'all') return 'all';
    if (mailbox.kind === 'label' && mailbox.type === 'system') {
      return ({ SENT: 'sent', DRAFT: 'drafts', SPAM: 'junk', TRASH: 'trash' })[mailbox.providerId] || null;
    }
    return mailbox.specialUse?.toLowerCase().replace(/^\\/, '') || null;
  }

  function mailDate(timestamp, full = false) {
    if (!Number.isFinite(timestamp)) return '';
    const date = new Date(timestamp * 1000);
    if (full) return dateTime.format(date);
    return localDay.format(date) === localDay.format(new Date()) ? shortTime.format(date) : shortDate.format(date);
  }

  function addresses(list) {
    return (list || []).map(address => address.name && address.address
      ? address.name + ' <' + address.address + '>' : address.name || address.address).filter(Boolean).join(', ');
  }

  function messageFor(error, fallback) {
    return errorLabels[error?.code] || fallback;
  }

  function isVerified(message) {
    return Number.isSafeInteger(message.id) && message.id > 0 && !message.stale && !message.detailError;
  }

  function byteLabel(size) {
    if (!Number.isFinite(size)) return '';
    if (size < 1024) return size + ' B';
    if (size < 1024 ** 2) return (size / 1024).toFixed(1) + ' KB';
    return (size / 1024 ** 2).toFixed(1) + ' MB';
  }

  function create({ mount, apiFetch, config, onExit }) {
    const features = { write: config.writeEnabled === true, smart: config.smartEnabled === true };
    const nav = component(element('aside', 'm1-sidebar'), 'Mail / Side Nav', '453:957');
    nav.id = 'mail-workspace-folders';
    nav.setAttribute('aria-label', '메일함');
    const main = element('div', 'm1-main');
    const backdrop = button('메일함 메뉴 닫기', () => setDrawer(false), { glyph: 'close', iconOnly: true });
    backdrop.className = 'm1-backdrop';
    backdrop.tabIndex = -1;
    backdrop.hidden = true;
    const viewport = element('div', 'm1-layout');
    viewport.append(backdrop, nav, main);
    mount.replaceChildren(viewport);

    let shown = false;
    let drawer = false;
    let accounts = [];
    let accountsError = null;
    let accountLoad;
    let view = { type: 'inbox', title: '받은편지함' };
    const collections = new Map();
    const expanded = new Set();
    const pages = new Map();
    const selected = new Set();
    const jobStatus = new Map();
    const unconfirmed = new Set();
    const confirmedChanges = new Map();
    let detail = null;
    let eventDetail = null;
    let banner = null;
    let writing = false;
    let analyzing = false;
    let pollTimer;
    let pollGeneration = 0;
    let month = localDay.format(new Date()).slice(0, 7);
    let day = localDay.format(new Date());
    let calendar = null;
    let calendarVersion = 0;
    let scrollToRestore = null;
    let focusToRestore = null;
    let closeActionDialog = null;

    async function request(endpoint, params, payload) {
      const response = await apiFetch(path(endpoint, params), payload === undefined ? { cache: 'no-store' } : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), cache: 'no-store',
      });
      const data = await response.json();
      if (!response.ok || data.success === false) {
        throw Object.assign(new Error(data.code || 'MAIL_CLIENT_UI_REQUEST_FAILED'), { code: data.code });
      }
      return data;
    }

    function viewKey() {
      return JSON.stringify([view.type, view.accountId ?? null, view.mailbox ?? null, view.filter ?? null]);
    }

    function pageState() {
      const key = viewKey();
      if (!pages.has(key)) pages.set(key, { index: 0, stack: [], busy: false, error: null, scroll: 0 });
      return pages.get(key);
    }

    function stashScroll() {
      if (!detail && !eventDetail && view.type !== 'calendar') pageState().scroll = main.scrollTop;
    }

    function setDrawer(value, restoreFocus = true) {
      drawer = value && narrow.matches;
      viewport.classList.toggle('m1-drawer-open', drawer);
      backdrop.hidden = !drawer;
      nav.inert = narrow.matches && !drawer;
      main.inert = drawer;
      const trigger = main.querySelector('.m1-menu');
      if (trigger) trigger.setAttribute('aria-expanded', String(drawer));
      if (drawer) [...nav.querySelectorAll('button')].find(item => item.getClientRects().length)?.focus();
      else if (restoreFocus) trigger?.focus();
    }

    narrow.addEventListener('change', () => setDrawer(drawer, false));
    mount.addEventListener('keydown', event => {
      if (event.key === 'Escape' && drawer) { event.preventDefault(); setDrawer(false); }
    });

    function roleFolder(account, name) {
      const box = collections.get(account.id);
      if (box?.source?.status === 'stale') return null;
      const result = (box?.mailboxes || []).filter(folder => folder.selectable && role(folder) === name);
      return result.length === 1 ? result[0] : null;
    }

    function accountTabs(header) {
      const group = element('div', 'm1-account-tabs');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', '계정');
      const choices = [{ id: null, provider: null }, ...accounts];
      for (const account of choices) {
        const selectedAccount = account.id === (view.accountId ?? null);
        const option = button(providers[account.provider] || account.provider || '전체',
          () => chooseAccount(account.id), { disabled: account.status === 'disabled' });
        option.setAttribute('aria-pressed', String(selectedAccount));
        group.append(option);
      }
      header.append(group);
    }

    function renderNav() {
      const heading = element('div', 'm1-sidebar-head');
      const close = button('메일함 메뉴 닫기', () => setDrawer(false), { glyph: 'close', iconOnly: true });
      close.classList.add('m1-menu-close');
      const exit = button('Home Overview로 돌아가기', onExit, { glyph: 'arrow-left', iconOnly: true });
      exit.classList.add('m1-mail-exit');
      heading.append(element('h2', 'm1-mail-desktop-label', '메일'), element('h2', 'm1-mail-phone-label', '메일함'), close, exit);
      const folders = element('nav', 'm1-nav-group');
      folders.setAttribute('aria-label', '기본 메일함');
      for (const [id, [label, glyph]] of Object.entries(folderRoles)) {
        if (id !== 'inbox' && !accounts.some(account => roleFolder(account, id))) continue;
        const active = id === 'inbox' ? view.type === 'inbox' || view.role === 'inbox' : view.role === id;
        const item = navItem(label, glyph, active, () => chooseRole(id));
        if (id === 'inbox') item.classList.add('m1-inbox-item');
        folders.append(item);
      }

      const contents = [heading, folders];
      if (features.smart) {
        const smart = element('nav', 'm1-nav-group');
        smart.setAttribute('aria-label', '스마트 메일함');
        smart.append(element('div', 'm1-nav-heading', '스마트 메일함'));
        for (const [filter, label, glyph] of SMART) {
          smart.append(navItem(label, glyph, (filter === 'schedule' ? view.type === 'calendar' : view.filter === filter),
            () => selectView({ type: filter === 'schedule' ? 'calendar' : 'smart', title: label,
              ...(filter === 'schedule' ? {} : { filter }) })));
        }
        contents.push(smart);
      }

      const accountNav = element('nav', 'm1-nav-group m1-account-list');
      accountNav.setAttribute('aria-label', '계정별 폴더');
      accountNav.append(element('div', 'm1-nav-heading', '계정'));
      if (accountsError) accountNav.append(notice(messageFor(accountsError, '계정 목록을 불러오지 못했어.'), { retry: () => ensureAccounts(true) }));
      else if (accountLoad && !accounts.length) accountNav.append(element('p', 'm1-muted', '계정 불러오는 중'));
      else if (!accounts.length) accountNav.append(element('p', 'm1-muted', '연결된 메일 계정이 없어.'));
      for (const account of accounts) {
        const group = element('div', 'm1-account-group');
        const label = button(providers[account.provider] || account.provider, () => {
          if (expanded.has(account.id)) expanded.delete(account.id);
          else expanded.add(account.id);
          renderNav();
          nav.querySelector('[data-account="' + account.id + '"]')?.focus();
        }, { glyph: expanded.has(account.id) ? 'chevron-down' : 'chevron-right' });
        label.classList.add('m1-account-toggle');
        label.dataset.account = account.id;
        label.setAttribute('aria-expanded', String(expanded.has(account.id)));
        label.append(element('small', '', account.address));
        group.append(label);
        if (expanded.has(account.id)) {
          const entries = element('div', 'm1-account-folders');
          const list = collections.get(account.id);
          if (account.status === 'disabled') entries.append(element('p', 'm1-muted', '비활성 계정'));
          else if (list?.error) entries.append(notice(messageFor(list.error, '계정 폴더를 조회할 수 없어.'), { retry: () => loadMailboxes(account) }));
          else if (!list) entries.append(element('p', 'm1-muted', '폴더 불러오는 중'));
          else {
            if (list.source?.status === 'stale') entries.append(notice('캐시에 남은 폴더 목록이야.'));
            for (const folder of list.mailboxes) {
              if (!folder.selectable) continue;
              const type = role(folder);
              const display = folderRoles[type]?.[0] || folder.name;
              entries.append(navItem(display, folderRoles[type]?.[1] || 'folder',
                view.accountId === account.id && view.mailbox === folder.id,
                () => chooseMailbox(account, folder)));
            }
          }
          group.append(entries);
        }
        accountNav.append(group);
      }
      contents.push(accountNav);
      nav.replaceChildren(...contents);
    }

    async function loadMailboxes(account) {
      if (account.status === 'disabled') return;
      try {
        const data = await request('/accounts/' + account.id + '/mailboxes');
        collections.set(account.id, data);
      } catch (error) { collections.set(account.id, { error }); }
      if (shown) render();
    }

    function ensureAccounts(force = false) {
      if (accountLoad) return accountLoad;
      if (!force && accounts.length) return Promise.resolve();
      accountLoad = (async () => {
        try {
          ({ accounts } = await request('/accounts'));
          accountsError = null;
          if (!expanded.size) {
            const first = accounts.find(account => account.status !== 'disabled');
            if (first) expanded.add(first.id);
          }
          await Promise.all(accounts.map(loadMailboxes));
        } catch (error) {
          accountsError = error;
        } finally {
          accountLoad = null;
          if (shown) render();
        }
      })();
      return accountLoad;
    }

    function chooseMailbox(account, folder) {
      const type = role(folder);
      selectView({ type: 'mailbox', accountId: account.id, mailbox: folder.id, role: type,
        title: folderRoles[type]?.[0] || folder.name });
    }

    function chooseRole(id) {
      if (id === 'inbox') return chooseAccount(null, true);
      const candidates = accounts.filter(account => roleFolder(account, id));
      const current = candidates.find(account => account.id === view.accountId);
      if (current || candidates.length === 1) {
        const account = current || candidates[0];
        return chooseMailbox(account, roleFolder(account, id));
      }
      openChoices(folderRoles[id][0], candidates.map(account => ({
        label: (providers[account.provider] || account.provider) + ' · ' + account.address,
        run: () => chooseMailbox(account, roleFolder(account, id)),
      })));
    }

    function chooseAccount(id, forceInbox = false) {
      const account = accounts.find(item => item.id === id);
      if (!forceInbox && view.type === 'smart') return selectView({ ...view, accountId: id });
      if (id == null) return selectView({ type: 'inbox', title: '받은편지함' });
      const folder = account && roleFolder(account, forceInbox ? 'inbox' : view.role || 'inbox');
      if (folder) chooseMailbox(account, folder);
      else { banner = { message: '이 계정의 메일함 상태를 확인해 줘.' }; renderMain(); }
    }

    function selectView(next) {
      stashScroll();
      view = next;
      detail = null;
      eventDetail = null;
      banner = null;
      selected.clear();
      scrollToRestore = view.type === 'calendar' ? 0 : pageState().scroll;
      setDrawer(false, false);
      render();
      main.querySelector('h1')?.focus();
      if (view.type === 'calendar') void loadCalendar();
      else if (!pageState().stack.length) void loadPage(null, true);
    }

    async function loadPage(cursor, reload = false, verifyUnknown = false) {
      const current = pageState();
      const key = viewKey();
      const snapshot = view;
      if (current.busy) return;
      current.busy = true;
      current.error = null;
      const requestedAt = Date.now();
      renderMain();
      try {
        const endpoint = snapshot.type === 'inbox' ? '/inbox'
          : snapshot.type === 'smart' ? '/smart/messages' : '/accounts/' + snapshot.accountId + '/messages';
        const data = await request(endpoint, {
          mailbox: snapshot.mailbox, filter: snapshot.filter,
          accountId: snapshot.type === 'smart' ? snapshot.accountId : null, limit: LIST_LIMIT, cursor,
        });
        if (snapshot.type !== 'smart') {
          for (const message of data.messages) {
            if (isVerified(message) && confirmedChanges.get(message.id)?.at < requestedAt) confirmedChanges.delete(message.id);
          }
        }
        if (reload) {
          current.stack = [data];
          current.index = 0;
          if (verifyUnknown && data.source?.status !== 'stale' && data.source?.status !== 'unavailable' && !data.incomplete) {
            for (const message of data.messages) if (isVerified(message)) unconfirmed.delete(message.id);
          }
        } else {
          current.stack.push(data);
          current.index = current.stack.length - 1;
          current.scroll = 0;
          scrollToRestore = 0;
        }
      } catch (error) { current.error = error; }
      finally {
        current.busy = false;
        if (shown && viewKey() === key) renderMain();
      }
    }

    function pageMove(index) {
      const current = pageState();
      if (writing || current.busy) return;
      selected.clear();
      if (current.stack[index]) {
        current.index = index;
        scrollToRestore = 0;
        renderMain();
      } else {
        const cursor = current.stack[current.index]?.nextCursor;
        if (cursor) void loadPage(cursor);
      }
    }

    function rowJob(message) {
      if (unconfirmed.has(message.id)) return '변경 결과 확인 필요';
      const observed = jobStatus.get(message.id);
      const statuses = observed?.jobs || [message.classificationStatus, message.calendarStatus].filter(Boolean);
      const blocking = statuses.find(job => ['analyzing', 'pending', 'failed', 'skipped'].includes(job.state));
      if (blocking) {
        const reason = errorLabels[blocking.code];
        return reason ? jobLabels[blocking.state] + ' · ' + reason : jobLabels[blocking.state];
      }
      if (observed?.error) return '분석 확인 실패';
      if (observed && statuses.some(job => job.state === 'done')) {
        return statuses.some(job => job.source === 'agent') || message.classification?.source === 'agent'
          ? '기존 Agent 판단' : '분석 완료';
      }
      return '';
    }

    function statusList(page) {
      const out = [];
      const sources = page?.sources || (page?.source ? [page.source] : []);
      for (const source of sources.filter(item => item && item.status !== 'fresh')) {
        const label = providers[source.provider] || source.provider || '메일';
        const text = source.status === 'stale' ? '마지막으로 확인한 메일을 표시하고 있어.'
          : messageFor(source.failure, '제공자에 연결하지 못했어.');
        out.push(notice(label + ' · ' + text));
      }
      if (page?.incomplete) out.push(element('p', 'm1-muted', '일부 결과를 확인하지 못했어.'));
      if (page?.coverage?.complete === false) out.push(element('p', 'm1-muted', '탐색하고 분석한 메일 범위만 표시해.'));
      return out;
    }

    function listTitle(page) {
      const header = element('header', 'm1-main-head');
      const menu = button('메일함 메뉴', () => setDrawer(!drawer), { glyph: 'menu', iconOnly: true });
      menu.classList.add('m1-menu');
      menu.setAttribute('aria-expanded', String(drawer));
      menu.setAttribute('aria-controls', nav.id);
      const heading = element('div', 'm1-heading');
      const title = element('h1', '', view.title);
      title.tabIndex = -1;
      heading.append(title);
      if (page?.messages?.length) heading.append(element('span', 'm1-muted',
        '이 페이지 안 읽음 ' + page.messages.filter(message => message.read === false).length));
      header.append(menu, heading);
      if (view.type !== 'calendar') accountTabs(header);
      return header;
    }

    function toggleSelected(id) {
      if (selected.has(id)) selected.delete(id);
      else if (selected.size < LIST_LIMIT) selected.add(id);
      renderMain();
      main.querySelector('[data-message-id="' + id + '"] .m1-row-select')?.focus();
    }

    function renderList() {
      const current = pageState();
      const page = current.stack[current.index];
      const items = (page?.messages || []).flatMap(message => {
        const change = view.type === 'smart' ? confirmedChanges.get(message.id) : null;
        return change?.removed ? [] : [{ ...message, ...change?.flags }];
      });
      const marked = items.filter(message => selected.has(message.id));
      const header = listTitle(page);
      const toolbar = element('div', 'm1-toolbar');
      if (features.write && items.some(isVerified)) {
        const valid = items.filter(message => isVerified(message) && !unconfirmed.has(message.id));
        const all = valid.length && valid.every(message => selected.has(message.id));
        const select = button(all ? '페이지 선택 해제' : '페이지 선택', () => {
          selected.clear();
          if (!all) for (const message of valid) selected.add(message.id);
          renderMain();
          main.querySelector('.m1-select-page')?.focus();
        }, { glyph: all ? 'checkbox-on' : 'checkbox-off', iconOnly: true, disabled: writing || !valid.length });
        select.classList.add('m1-select-page');
        select.setAttribute('aria-pressed', String(Boolean(all)));
        toolbar.append(select);
        if (marked.length) {
          toolbar.append(element('span', 'm1-selection-count', '선택 ' + marked.length));
          appendActions(toolbar, marked);
        }
      }
      const gap = element('div', 'm1-toolbar-gap');
      toolbar.append(gap);
      if (features.smart) {
        const batch = (marked.length ? marked : items).filter(isVerified).slice(0, 10);
        if (batch.length) toolbar.append(button('메일 ' + batch.length + '개 분석', () => runAnalysis(batch),
          { variant: 'secondary', disabled: analyzing || writing || current.busy }));
      }
      toolbar.append(button('새로고침', () => { selected.clear(); void ensureAccounts(true); void loadPage(null, true, true); },
        { glyph: 'refresh', iconOnly: true, disabled: current.busy || writing }));
      const bits = [header, toolbar, ...statusList(page)];
      if (current.error) bits.push(notice(messageFor(current.error, '메일 목록을 불러오지 못했어.'), { retry: () => loadPage(null, true) }));
      if (!page && current.busy) bits.push(empty('메일 목록 불러오는 중', null, { loading: true }));
      else if (!items.length && !current.error && !page?.incomplete) bits.push(empty('메일함이 비어 있어.'));
      if (items.length) {
        const list = element('ul', 'm1-rows');
        list.classList.toggle('m1-selecting', Boolean(marked.length));
        for (const message of items) list.append(row({
          message, checked: selected.has(message.id), writable: features.write,
          pending: writing || !isVerified(message) || unconfirmed.has(message.id),
          open: () => openMessage(message.id, message.detailError),
          select: () => toggleSelected(message.id),
          star: () => change([message], 'set_starred', !message.starred),
          time: mailDate(message.receivedAt),
          preview: message.classification?.summary,
          analysis: rowJob(message),
        }));
        bits.push(list);
      }
      if (page && (page.nextCursor || current.index > 0)) {
        const pagination = element('nav', 'm1-pagination');
        pagination.setAttribute('aria-label', '메일 목록 페이지');
        pagination.append(button('이전 페이지', () => pageMove(current.index - 1),
          { glyph: 'chevron-left', iconOnly: true, disabled: !current.index || current.busy || writing }));
        const pageNumber = element('span', 'm1-current-page', String(current.index + 1));
        pageNumber.setAttribute('aria-current', 'page');
        pagination.append(pageNumber, button('다음 페이지', () => pageMove(current.index + 1),
          { glyph: 'chevron-right', iconOnly: true, disabled: !page.nextCursor || current.busy || writing }));
        bits.push(pagination);
      }
      return bits;
    }

    function appendActions(toolbar, items, detailMode = false) {
      const disabled = writing || items.some(message => !isVerified(message) || unconfirmed.has(message.id));
      const appendAction = (name, glyph, run, type) => {
        const control = button(name, run, { glyph, disabled });
        control.dataset.action = type;
        control.setAttribute('aria-label', name);
        toolbar.append(control);
      };
      if (!detailMode || !items[0].read) appendAction('읽음', 'mail-open', () => change(items, 'set_read', true), 'read');
      if (!detailMode || items[0].read) appendAction('안 읽음', 'mail', () => change(items, 'set_read', false), 'read');
      const starred = items.every(message => message.starred);
      appendAction(starred ? '별표 해제' : '별표', starred ? 'star-on' : 'star',
        () => change(items, 'set_starred', !starred), 'star');
      if (items.every(message => hasTarget(message, 'archive'))) appendAction('보관', 'archive', () => change(items, 'archive'), 'archive');
      if (items.every(message => hasTarget(message, 'trash'))) appendAction('휴지통', 'trash', () => change(items, 'trash'), 'trash');
      if (moveTargets(items).length) appendAction('이동', 'folder', () => chooseMove(items), 'move');
    }

    function hasTarget(message, target) {
      if (message.provider === 'gmail') return !message.labelIds?.includes('TRASH')
        && (target !== 'archive' || message.labelIds?.includes('INBOX'));
      const account = accounts.find(item => item.id === message.accountId);
      const folder = account && roleFolder(account, target);
      return Boolean(folder && folder.path !== message.folderPath);
    }

    function moveTargets(items) {
      if (!items.length || items.some(message => message.accountId !== items[0].accountId)) return [];
      const list = collections.get(items[0].accountId);
      if (list?.source?.status === 'stale') return [];
      return (list?.mailboxes || []).filter(folder => folder.selectable && (items[0].provider === 'gmail'
        ? folder.kind === 'label' && folder.type === 'user' && folder.id !== view.mailbox
        : folder.kind === 'folder' && items.every(message => message.folderPath !== folder.path)));
    }

    function openChoices(title, choices) {
      if (closeActionDialog) return;
      const previous = document.activeElement;
      const dialog = element('dialog', 'm1-dialog');
      dialog.setAttribute('aria-label', title);
      const heading = element('h2', '', title);
      const actions = element('div', 'm1-dialog-actions');
      closeActionDialog = () => dialog.close();
      dialog.addEventListener('close', () => {
        dialog.remove();
        closeActionDialog = null;
        if (previous?.isConnected) previous.focus();
      }, { once: true });
      dialog.append(heading, actions);
      for (const choice of choices) actions.append(button(choice.label, () => { dialog.close(); choice.run(); }, { variant: 'secondary' }));
      dialog.append(button('닫기', () => dialog.close(), { variant: 'ghost' }));
      mount.append(dialog);
      dialog.showModal();
    }

    function chooseMove(items) {
      openChoices('이동할 폴더', moveTargets(items).map(folder => ({
        label: folder.name, run: () => change(items, 'move', null, folder),
      })));
    }

    function chooseGmailMoveSource(message) {
      if (view.type === 'mailbox' && view.accountId === message.accountId) {
        const box = collections.get(message.accountId)?.mailboxes.find(folder => folder.id === view.mailbox);
        if (box?.kind === 'all' || (box && (box.inbox || box.type === 'user') && message.labelIds?.includes(box.providerId))) {
          return view.mailbox;
        }
      }
      if (message.labelIds?.includes('INBOX')) return 'label:INBOX';
      return 'all';
    }

    async function change(items, action, value, folder) {
      if (!features.write || writing || items.some(item => !isVerified(item) || unconfirmed.has(item.id))) return;
      const operations = items.map(message => {
        const operation = { messageId: message.id, action };
        if (action === 'set_read' || action === 'set_starred') operation.value = value;
        if (action === 'move') {
          operation.targetMailbox = { accountId: message.accountId, id: folder.id };
          if (message.provider === 'gmail') operation.sourceMailbox = chooseGmailMoveSource(message);
        }
        return operation;
      });
      writing = true;
      banner = null;
      const originView = viewKey();
      const originDetail = detail?.id;
      renderMain();
      let confirmed = 0;
      let failed = 0;
      let unknown = 0;
      let code;
      try {
        const response = await apiFetch(path('/messages/actions'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)),
              byte => byte.toString(16).padStart(2, '0')).join(''),
            operations,
          }), cache: 'no-store',
        });
        const data = await response.json();
        if (!Array.isArray(data.results)) {
          if (data.code && response.status < 500) code = data.code;
          else throw new Error('Receipt unavailable');
        }
        for (const [index, item] of items.entries()) {
          const result = data.results?.find(entry => entry.messageId === item.id);
          if (result?.state === 'confirmed') {
            confirmed += 1;
            selected.delete(item.id);
            const previous = confirmedChanges.get(item.id);
            const flags = { ...previous?.flags };
            if (action === 'set_read') flags.read = value;
            if (action === 'set_starred') flags.starred = value;
            if (item.provider === 'gmail' && action === 'archive') {
              flags.labelIds = (item.labelIds || []).filter(label => label !== 'INBOX');
            }
            if (item.provider === 'gmail' && action === 'move') {
              const source = operations[index].sourceMailbox.slice(6);
              const target = folder.id.slice(6);
              flags.labelIds = [...new Set([...(item.labelIds || []).filter(label => label !== source), target])];
            }
            const removed = action === 'trash' || (item.provider !== 'gmail' && (action === 'move' || action === 'archive'));
            if (removed || Object.keys(flags).length) {
              confirmedChanges.set(item.id, { at: Date.now(), flags, removed });
            }
          }
          else if (result?.state === 'failed' || code) { failed += 1; code = result?.code || code; }
          else { unknown += 1; unconfirmed.add(item.id); }
        }
      } catch {
        unknown = items.length;
        items.forEach(item => unconfirmed.add(item.id));
      } finally { writing = false; }
      if (unknown) banner = { message: '결과를 확인할 수 없는 메일 ' + unknown + '개가 있어. 제공자 상태를 확인한 뒤 목록을 새로고침해 줘.',
        operation: action === 'set_read' ? 'read' : 'move' };
      else if (failed) banner = { message: (confirmed ? confirmed + '개 반영 · ' : '') + messageFor({ code }, actionLabels[action] + ' 변경에 실패했어.'),
        operation: action === 'set_read' ? 'read' : 'move' };
      if (confirmed && originView === viewKey()) {
        if (originDetail && originDetail === detail?.id && ['set_read', 'set_starred'].includes(action)) {
          await fetchMessage(detail, false);
        } else if (originDetail && originDetail === detail?.id && !failed && !unknown) {
          back();
        }
        if (view.type !== 'calendar') await loadPage(null, true);
      }
      if (shown) renderMain();
    }

    function back() {
      if (detail) {
        focusToRestore = detail.id;
        eventDetail = detail.returnEvent;
        detail = null;
        scrollToRestore = view.type === 'calendar' ? 0 : pageState().scroll;
      } else if (eventDetail) eventDetail = null;
      else return onExit();
      renderMain();
    }

    function openMessage(id, code) {
      stashScroll();
      detail = { id, returnEvent: eventDetail, value: null, error: code ? { code } : null, busy: !code };
      eventDetail = null;
      banner = null;
      scrollToRestore = 0;
      renderMain();
      if (!code && Number.isSafeInteger(id) && id > 0) void fetchMessage(detail);
      else if (!code) {
        detail.busy = false;
        detail.error = { code: 'MAIL_CLIENT_LOCATION_UNVERIFIED' };
        renderMain();
      }
    }

    async function fetchMessage(target, showLoading = true) {
      const requestedAt = Date.now();
      if (showLoading) {
        target.busy = true;
        target.error = null;
        if (detail === target && shown) renderMain();
      }
      try {
        const { message } = await request('/messages/' + target.id);
        if (isVerified(message) && confirmedChanges.get(message.id)?.at < requestedAt) confirmedChanges.delete(message.id);
        target.value = message;
        target.error = null;
      } catch (error) {
        target.error = error;
        target.value = null;
      } finally {
        target.busy = false;
        if (detail === target && shown) {
          renderMain();
          if (showLoading) main.querySelector('h1')?.focus();
        }
      }
    }

    function renderDetail() {
      const header = element('div', 'm1-toolbar m1-detail-toolbar');
      const backButton = button('목록', back, { glyph: 'arrow-left' });
      backButton.classList.add('m1-detail-back');
      backButton.setAttribute('aria-label', '목록');
      backButton.append(element('span', 'm1-detail-back-phone', view.title));
      header.append(backButton);
      if (detail.value) {
        const items = view.type !== 'calendar' ? pageState().stack[pageState().index]?.messages || [] : [];
        const index = items.findIndex(item => item.id === detail.id);
        if (index >= 0) {
          header.append(button('이전 메일', () => openMessage(items[index - 1].id, items[index - 1].detailError),
            { glyph: 'chevron-left', iconOnly: true, disabled: !index || writing }));
          header.append(element('span', 'm1-muted', (index + 1) + ' / ' + items.length));
          header.append(button('다음 메일', () => openMessage(items[index + 1].id, items[index + 1].detailError),
            { glyph: 'chevron-right', iconOnly: true, disabled: index === items.length - 1 || writing }));
        }
        if (features.write) appendActions(header, [detail.value], true);
      }
      if (detail.busy && !detail.value) return [header, empty('메일 본문 불러오는 중', null, { loading: true })];
      if (detail.error || !detail.value) {
        return [header, notice(messageFor(detail.error, '메일 본문을 불러오지 못했어.'),
          { retry: detail.id && !['MAIL_CLIENT_MESSAGE_GONE', 'MAIL_CLIENT_LOCATION_STALE'].includes(detail.error?.code)
            ? () => fetchMessage(detail) : null })];
      }

      const mail = detail.value;
      const packet = element('article', 'm1-message');
      packet.dataset.figmaNode = '459:2394';
      const top = element('header', 'm1-message-title');
      const title = element('h1', '', mail.subject || '(제목 없음)');
      title.tabIndex = -1;
      top.append(title);
      if (mail.starred) top.append(icon('star-on'));
      const account = accounts.find(item => item.id === mail.accountId);
      top.append(sourceTag(mail.provider, [providers[mail.provider] || mail.provider, account?.address].filter(Boolean).join(' · ')));
      packet.append(top);

      const sender = mail.from?.[0];
      const senderLine = element('div', 'm1-message-sender');
      const senderName = sender?.name || sender?.address || '보낸 사람 없음';
      senderLine.append(element('span', 'm1-sender-avatar', Array.from(senderName)[0]), element('strong', '', senderName));
      if (sender?.name && sender.address) senderLine.append(element('span', 'm1-muted', sender.address));
      senderLine.append(element('time', 'm1-muted', mailDate(mail.receivedAt, true)));
      packet.append(senderLine);
      const envelope = element('dl', 'm1-envelope');
      const fields = [
        ['받는 사람', addresses(mail.to)], ['참조', addresses(mail.cc)],
        ['숨은 참조', addresses(mail.bcc)], ['답장 주소', addresses(mail.replyTo)],
      ];
      for (const [name, value] of fields) {
        if (value) envelope.append(element('dt', '', name), element('dd', '', value));
      }
      packet.append(envelope);

      if (mail.thread?.inReplyTo || mail.thread?.references?.length || mail.thread?.providerThreadId) {
        const thread = element('details', 'm1-thread');
        thread.append(element('summary', '', '스레드 정보'));
        const facts = [
          ['스레드 ID', mail.thread.providerThreadId], ['답장 대상', mail.thread.inReplyTo],
          ['참조 메시지', mail.thread.references?.join(' · ')],
        ];
        for (const [name, value] of facts) if (value) thread.append(element('p', '', name + ' · ' + value));
        packet.append(thread);
      }

      packet.append(element('div', 'm1-message-body',
        mail.body?.format === 'text' ? mail.body.text || '본문 없음' : '이 본문 형식은 표시할 수 없어.'));
      const files = (mail.attachments || []).filter(attachment => !attachment.inline);
      if (files.length) {
        const heading = element('h2', 'm1-files-heading');
        heading.append(icon('paperclip'), element('span', '', '첨부 ' + files.length + '개'));
        const list = element('ul', 'm1-attachments');
        for (const attachment of files) {
          const item = element('li', 'm1-attachment');
          const extension = attachment.filename?.split('.').at(-1);
          const type = extension && extension.length <= 5 && extension !== attachment.filename ? extension.toUpperCase() : '첨부';
          item.append(element('span', 'm1-file-type', type));
          const label = element('div', 'm1-file-label');
          label.append(element('strong', '', attachment.filename || '이름 없는 첨부'),
            element('small', 'm1-muted', byteLabel(attachment.size) || attachment.contentType));
          item.append(label);
          list.append(item);
        }
        packet.append(heading, list);
      }
      if (!features.write) return [header, packet];
      const footer = element('div', 'm1-detail-footer');
      appendActions(footer, [mail], true);
      return [header, packet, footer];
    }

    async function openAttention(id) {
      if (!Number.isSafeInteger(id) || id <= 0) return;
      stashScroll();
      const target = { id: null, value: null, error: null, busy: true };
      detail = target;
      eventDetail = null;
      renderMain();
      try {
        const { id: resolved } = await request('/attention/' + id);
        if (detail !== target || !shown) return;
        target.id = resolved;
        await fetchMessage(target);
      } catch (error) {
        if (detail !== target) return;
        target.error = error;
        target.busy = false;
        if (shown) renderMain();
      }
    }

    function readJobs(results) {
      for (const result of results) {
        const known = jobStatus.get(result.id);
        if (!result.error && result.classificationStatus && result.calendarStatus) {
          const fromStatuses = [
            { ...result.classificationStatus, kind: 'classification', source: result.classification?.source },
            { ...result.calendarStatus, kind: 'calendar' },
          ];
          jobStatus.set(result.id, {
            ...result, jobs: fromStatuses.filter(job => job.state !== 'unclassified').map(job => {
              const live = result.jobs?.find(value => value.kind === job.kind);
              return { ...live, ...job };
            }),
          });
        } else jobStatus.set(result.id, { ...known, ...result });
      }
    }

    function stopPolling() {
      clearTimeout(pollTimer);
      pollGeneration += 1;
    }

    function pollAnalysis(ids, generation = pollGeneration, step = 0) {
      const active = ids.filter(id => jobStatus.get(id)?.jobs?.some(job => job.state === 'pending' || job.state === 'analyzing'));
      if (!shown || generation !== pollGeneration || !active.length || step >= 20) return;
      pollTimer = setTimeout(async () => {
        try {
          const results = [];
          for (let index = 0; index < active.length; index += 10) {
            const response = await request('/smart/results', { messageIds: active.slice(index, index + 10).join(',') });
            results.push(...response.results);
            if (!shown || generation !== pollGeneration) return;
          }
          if (!shown || generation !== pollGeneration) return;
          readJobs(results);
          const errors = results.filter(result => result.error);
          if (errors.length) banner = { message: messageFor(errors[0].error, '일부 분석 상태를 확인할 수 없어.') };
          renderMain();
          pollAnalysis(ids, generation, step + 1);
        } catch (error) {
          if (!shown || generation !== pollGeneration) return;
          banner = { message: messageFor(error, '분석 상태를 불러오지 못했어.'),
            retry: () => pollAnalysis(ids, generation) };
          renderMain();
        }
      }, step < 5 ? 3000 : 6000);
    }

    async function runAnalysis(messages) {
      if (analyzing || !features.smart) return;
      const ids = messages.filter(isVerified).map(message => message.id).slice(0, 10);
      if (!ids.length) return;
      analyzing = true;
      banner = null;
      renderMain();
      try {
        const { results } = await request('/smart/analyze', null, { messageIds: ids, kind: 'both' });
        readJobs(results);
        const issue = results.find(result => result.error || result.jobs?.some(job => job.state === 'failed' || job.state === 'skipped'));
        if (issue) {
          const problem = issue.error || issue.jobs.find(job => job.state === 'failed' || job.state === 'skipped');
          banner = { message: messageFor(problem, '일부 메일의 분석을 시작하지 못했어.') };
        }
        stopPolling();
        pollAnalysis([...jobStatus.keys()]);
      } catch (error) { banner = { message: messageFor(error, '분석을 요청하지 못했어.') }; }
      finally { analyzing = false; if (shown) renderMain(); }
    }

    function isoDay(date) { return date.toISOString().slice(0, 10); }
    function labelDay(value) {
      const [year, monthNumber, date] = value.split('-').map(Number);
      return year + '년 ' + monthNumber + '월 ' + date + '일';
    }

    async function loadCalendar(section, cursor) {
      if (calendar?.busy) return;
      const requestedMonth = month;
      const version = ++calendarVersion;
      if (!section) calendar = { events: [], unresolved: { events: [] }, busy: true };
      else calendar.busy = true;
      calendar.error = null;
      renderMain();
      try {
        const data = await request('/smart/calendar', { month: requestedMonth, section, cursor, limit: 25 });
        if (version !== calendarVersion) return;
        if (!section) {
          calendar = { ...data, unresolved: data.unresolved || { events: [] } };
        } else if (section === 'unresolved') {
          calendar.unresolved.events.push(...data.events);
          calendar.unresolved.nextCursor = data.nextCursor;
        } else {
          calendar.events.push(...data.events);
          calendar.nextCursor = data.nextCursor;
        }
      } catch (error) { if (version === calendarVersion) calendar.error = error; }
      finally {
        if (version === calendarVersion) {
          calendar.busy = false;
          if (shown && view.type === 'calendar') renderMain();
        }
      }
    }

    function moveMonth(offset) {
      const [year, number] = month.split('-').map(Number);
      month = offset === 0 ? localDay.format(new Date()).slice(0, 7)
        : isoDay(new Date(Date.UTC(year, number - 1 + offset, 1))).slice(0, 7);
      day = offset === 0 ? localDay.format(new Date()) : month + '-01';
      eventDetail = null;
      calendar = null;
      void loadCalendar();
    }

    function dayEvents(dayKey) {
      return (calendar?.events || []).filter(event => event.startDate <= dayKey && (event.endDate || event.startDate) >= dayKey);
    }

    function eventCard(event) {
      const card = element('article', 'm1-event-card');
      const heading = element('div', 'm1-event-card-head');
      const kind = event.kind;
      heading.append(element('span', 'm1-micro-kind m1-event-' + kind, eventNames[kind] || '미정'));
      if (event.startAt) heading.append(element('time', 'm1-muted', shortTime.format(new Date(event.startAt * 1000))));
      card.append(heading, button(event.title, () => openCalendarEvent(event.id)));
      const account = accounts.find(item => item.id === event.accountId);
      if (account) card.append(sourceTag(account.provider));
      if (event.dateProvenance === 'inferred') card.append(element('small', 'm1-muted', '수신일 기준 연도 추론'));
      return card;
    }

    function calendarGrid() {
      const [year, number] = month.split('-').map(Number);
      const first = new Date(Date.UTC(year, number - 1, 1));
      const weekStart = 1 - ((first.getUTCDay() + 6) % 7);
      const grid = element('div', 'm1-calendar-grid');
      grid.setAttribute('aria-label', year + '년 ' + number + '월 메일 일정');
      const weekdays = ['월', '화', '수', '목', '금', '토', '일'];
      for (const weekday of weekdays) grid.append(element('div', 'm1-weekday', weekday));
      const today = localDay.format(new Date());
      for (let index = 0; index < 42; index++) {
        const date = new Date(Date.UTC(year, number - 1, weekStart + index));
        const key = isoDay(date);
        const cell = element('div', 'm1-day');
        cell.classList.toggle('m1-outside-month', !key.startsWith(month));
        cell.classList.toggle('m1-selected-day', day === key);
        const label = button(String(date.getUTCDate()), () => {
          day = key;
          eventDetail = null;
          renderMain();
          main.querySelector('.m1-selected-day .m1-day-button')?.focus();
        });
        label.classList.add('m1-day-button');
        label.setAttribute('aria-label', labelDay(key));
        label.setAttribute('aria-pressed', String(day === key));
        if (today === key) label.setAttribute('aria-current', 'date');
        cell.append(label);
        const events = dayEvents(key);
        for (const event of events.slice(0, 3)) cell.append(calendarEvent(event, () => { day = key; openCalendarEvent(event.id); }));
        if (events.length > 3) cell.append(element('span', 'm1-muted m1-calendar-more', '+' + (events.length - 3)));
        grid.append(cell);
      }
      return grid;
    }

    async function openCalendarEvent(id) {
      const target = { id, busy: true, value: null, error: null };
      eventDetail = target;
      renderMain();
      try {
        ({ event: target.value } = await request('/smart/calendar/' + id));
      } catch (error) { target.error = error; }
      finally {
        target.busy = false;
        if (eventDetail === target && shown && !detail) {
          renderMain();
          main.querySelector('.m1-calendar-aside h2')?.focus();
        }
      }
    }

    function renderEventDetails(aside) {
      if (eventDetail.busy) {
        aside.append(empty('일정 후보 불러오는 중', null, { loading: true }));
        return;
      }
      if (eventDetail.error) {
        aside.append(notice(messageFor(eventDetail.error, '일정 후보를 조회할 수 없어.'),
          { retry: () => openCalendarEvent(eventDetail.id) }));
        return;
      }
      const event = eventDetail.value;
      const account = accounts.find(item => item.id === event.accountId);
      const title = element('h2', '', event.title);
      title.tabIndex = -1;
      aside.append(title, element('span', 'm1-micro-kind m1-event-' + event.kind, eventNames[event.kind] || '미정'));
      if (account) aside.append(sourceTag(account.provider, [providers[account.provider], account.address].filter(Boolean).join(' · ')));
      const values = [
        ['원문 날짜', [event.originalDateText, event.originalEndText].filter(Boolean).join(' ~ ')],
        ['해석된 날짜', event.startDate
          ? (event.startAt ? mailDate(event.startAt, true) : labelDay(event.startDate)) + (event.dateProvenance === 'inferred' ? ' · 메일 수신일 기준 추론' : '')
          : '날짜 미확정'],
        ['날짜 출처', ({ explicit: '원문에 명시', inferred: '수신일 기준 추론', unresolved: '미확정' })[event.dateProvenance]],
        ['수신 기준일', event.referenceKstDate ? labelDay(event.referenceKstDate) : null],
        ['해석 근거', dateReasons[event.inferenceReason]],
        ['종료', event.endDate ? event.endAt ? mailDate(event.endAt, true) : labelDay(event.endDate) : null],
      ];
      const rows = element('dl', 'm1-event-facts');
      for (const [label, value] of values) if (value) rows.append(element('dt', '', label), element('dd', '', value));
      aside.append(rows);
      if (event.evidenceExcerpt) aside.append(element('blockquote', 'm1-evidence', event.evidenceExcerpt));
      aside.append(button('원본 메일 열기', () => openMessage(event.messageId), { glyph: 'chevron-right', variant: 'secondary' }));
    }

    function renderCalendar() {
      const header = listTitle(null);
      header.dataset.figmaNode = '463:3015';
      const tools = element('div', 'm1-calendar-tools');
      tools.append(button('오늘', () => moveMonth(0), { variant: 'secondary' }),
        button('이전 달', () => moveMonth(-1), { glyph: 'chevron-left', iconOnly: true }),
        element('strong', '', month.slice(0, 4) + '년 ' + Number(month.slice(5)) + '월'),
        button('다음 달', () => moveMonth(1), { glyph: 'chevron-right', iconOnly: true }));
      header.append(tools);
      const legend = element('div', 'm1-calendar-legend');
      for (const kind of ['personal', 'official', 'deadline']) {
        legend.append(element('span', 'm1-micro-kind m1-event-' + kind, eventNames[kind]));
      }
      const bits = [header, legend, ...statusList(calendar)];
      if (calendar?.error) bits.push(notice(messageFor(calendar.error, '메일 일정을 불러오지 못했어.'), { retry: () => loadCalendar() }));
      if (!calendar || (calendar.busy && !calendar.events.length)) {
        bits.push(empty('메일 일정 불러오는 중', null, { loading: true }));
      }
      const layout = element('div', 'm1-calendar-layout');
      layout.append(calendarGrid());
      const aside = element('section', 'm1-calendar-aside');
      if (eventDetail) {
        aside.append(button('선택한 날짜', back, { glyph: 'arrow-left' }));
        renderEventDetails(aside);
      } else {
        const currentEvents = dayEvents(day);
        aside.append(element('h2', '', labelDay(day)), element('p', 'm1-muted',
          currentEvents.length ? '메일에서 찾은 일정 ' + currentEvents.length + '개' : '이 날짜에 표시할 일정이 없어.'));
        for (const event of currentEvents) aside.append(eventCard(event));
        const unresolved = calendar?.unresolved;
        if (unresolved?.events.length) {
          const review = element('section', 'm1-unresolved');
          review.append(element('h3', '', '날짜 미확정'));
          unresolved.events.forEach(event => review.append(eventCard(event)));
          if (unresolved.nextCursor) review.append(button('미확정 후보 더 보기',
            () => loadCalendar('unresolved', unresolved.nextCursor), { disabled: calendar.busy }));
          aside.append(review);
        }
      }
      layout.append(aside);
      bits.push(layout);
      if (calendar?.nextCursor) bits.push(button('일정 후보 더 보기',
        () => loadCalendar('resolved', calendar.nextCursor), { disabled: calendar.busy }));
      return bits;
    }

    function renderMain() {
      if (!shown) return;
      const previousScroll = main.scrollTop;
      const previousFocus = main.contains(document.activeElement) ? document.activeElement : null;
      const focusLabel = previousFocus?.matches('button') ? previousFocus.getAttribute('aria-label') || previousFocus.textContent : null;
      const focusMessage = previousFocus?.closest('[data-message-id]')?.dataset.messageId;
      const parts = detail ? renderDetail() : view.type === 'calendar' ? renderCalendar() : renderList();
      if (banner) parts.splice(1, 0, notice(banner.message, banner));
      main.replaceChildren(...parts);
      main.scrollTop = scrollToRestore ?? previousScroll;
      scrollToRestore = null;
      if (focusToRestore) {
        main.querySelector('[data-message-id="' + focusToRestore + '"] .m1-row-open')?.focus({ preventScroll: true });
        focusToRestore = null;
      } else if (focusLabel) {
        const scope = focusMessage ? main.querySelector('[data-message-id="' + focusMessage + '"]') : main;
        const match = [...(scope?.querySelectorAll('button') || [])].find(child =>
          (child.getAttribute('aria-label') || child.textContent) === focusLabel);
        if (match && !match.disabled) match.focus({ preventScroll: true });
      }
    }

    function render() { renderNav(); renderMain(); }

    return {
      show(attentionId) {
        shown = true;
        setDrawer(false, false);
        render();
        void ensureAccounts();
        if (attentionId) { void openAttention(attentionId); return; }
        stopPolling();
        pollAnalysis([...jobStatus.keys()]);
        if (view.type === 'calendar') {
          if (!calendar) void loadCalendar();
        } else if (!pageState().stack.length) void loadPage(null, true);
        else if (!detail) {
          scrollToRestore = pageState().scroll;
          renderMain();
        }
        main.querySelector('h1')?.focus({ preventScroll: true });
      },
      hide() {
        stashScroll();
        shown = false;
        stopPolling();
        setDrawer(false, false);
        closeActionDialog?.();
      },
    };
  }

  global.MailWorkspace = { create };
})(window);
