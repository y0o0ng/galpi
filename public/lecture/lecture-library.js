'use strict';

// 강의 노트 목록 화면: Notes 홈 · 폴더(과목 강의 타임라인·자료 목록) · 새 강의 시트 · PDF 올리기.
// 설계 정본은 docs/Lecture-note-system_Design_v4.3.md §4.3·§6.5·§10.1.1이다.
(function (global) {
  const { el, svg, api, jsonOptions, formatDay, kindLabel, Recorder, toast, ICON_BACK, ICON_PLUS, ICON_CHEVRON, ICON_SEARCH, ICON_MORE, ICON_STAR } = global.LectureCommon;

  // view: 과목 폴더는 'home'(강의 타임라인)과 'docs'(자료 목록)를 오간다. 일반 폴더는 자료 목록뿐이다.
  const state = { containers: [], container: null, documents: [], sessions: [], view: 'home', search: '', loaded: false };

  const root = () => document.getElementById('lecture-root');
  const head = () => document.getElementById('lecture-head');
  const openViewer = (...args) => global.LectureViewer.open(...args);

  // ─── Notes 홈 ──────────────────────────────────────────────────────────────

  async function show() {
    Recorder().resume();
    if (global.LectureViewer.isOpen()) return;
    if (state.container) return openContainer(state.container.id);
    try {
      state.containers = (await api('/api/lecture/containers')).containers;
      state.loaded = true;
    } catch (error) {
      if (!state.loaded) root().replaceChildren(el('p', 'lecture-empty', error.message));
      return;
    }
    renderHome();
  }

  function renderHome() {
    const title = el('div');
    title.append(el('h1', '', 'Notes'), el('p', 'lecture-sub', `폴더 ${state.containers.length}개`));
    const add = el('button', 'lecture-pill');
    add.type = 'button';
    add.append(svg(ICON_PLUS), document.createTextNode('새 폴더'));
    add.addEventListener('click', () => openFolderDialog(add));
    // 필체 등록: 포스트잇 손글씨 OCR을 위한 표본 모으기.
    const handwriting = el('button', 'lecture-pill is-plain', '필체 등록');
    handwriting.type = 'button';
    handwriting.addEventListener('click', () => global.LectureHandwriting.open());
    const actions = el('div', 'lecture-actions');
    actions.append(handwriting, add);
    head().replaceChildren(title, actions);

    const search = el('label', 'lecture-search');
    const input = el('input');
    input.type = 'search';
    input.placeholder = '폴더 검색';
    input.value = state.search;
    input.addEventListener('input', () => { state.search = input.value; renderFolderGrid(grid); });
    search.append(svg(ICON_SEARCH), input);
    const grid = el('div', 'lecture-folder-grid');
    renderFolderGrid(grid);
    const trash = el('button', 'lecture-docs-link lecture-trash-link');
    trash.type = 'button';
    trash.append(el('strong', '', '최근 삭제'), el('span', 'lecture-docs-names', '30일 동안 되돌릴 수 있어'), svg(ICON_CHEVRON));
    trash.addEventListener('click', openTrash);
    root().replaceChildren(search, grid, trash);
  }

  // ─── 최근 삭제(2026-09-30 사용자 결정: 30일 보관) ────────────────────────────

  async function openTrash() {
    let items;
    try { ({ items } = await api('/api/lecture/trash')); } catch (error) { return toast(error.message); }
    const back = el('button', 'lecture-back');
    back.type = 'button';
    back.append(svg(ICON_BACK), document.createTextNode('Notes'));
    back.addEventListener('click', show);
    const title = el('div');
    title.append(back, el('h1', '', '최근 삭제'), el('p', 'lecture-sub', '지운 자료와 강의는 30일 뒤 완전히 지워져. 강의를 완전히 지우면 그 강의 중에 쓴 필기도 함께 지워져.'));
    head().replaceChildren(title);
    const list = el('div', 'lecture-doc-list');
    if (!items.length) list.append(el('p', 'lecture-empty', '최근 삭제한 항목이 없어.'));
    const now = Date.now() / 1000;
    items.forEach(item => {
      const row = el('div', 'lecture-doc-row lecture-trash-row');
      const name = item.type === 'folder' ? item.title : item.type === 'session'
        ? `${dateOf(item.title).getMonth() + 1}월 ${dateOf(item.title).getDate()}일 강의 · ${item.detail < 60000 ? '1분 미만' : `${Math.round(item.detail / 60000)}분`}`
        : item.title;
      const days = Math.max(0, Math.ceil((item.purgeAt - now) / 86400));
      const info = el('div');
      const where = item.type === 'folder' ? `${item.detail === 'course' ? '과목' : '일반'} 폴더 · 안의 자료·강의 포함` : `${item.containerName} · ${item.type === 'session' ? '강의' : kindLabel(item.detail)}`;
      info.append(el('strong', '', name), el('span', 'lecture-meta', `${where} · ${days}일 남음`));
      const restore = el('button', 'lecture-pill is-plain', '되돌리기');
      restore.type = 'button';
      restore.addEventListener('click', async () => {
        try { await api(`/api/lecture/trash/${item.type}/${item.id}/restore`, { method: 'POST' }); openTrash(); } catch (error) { toast(error.message); }
      });
      const purge = el('button', 'lecture-pill is-danger', '바로 삭제');
      purge.type = 'button';
      purge.addEventListener('click', async () => {
        const warning = { folder: '안의 자료·강의·필기·녹음이 모두 완전히 지워져.', session: '녹음과 그 강의 중에 쓴 필기가 완전히 지워져.', document: '필기까지 완전히 지워져.' }[item.type];
        if (!confirm(`'${name}'을 완전히 지울까? ${warning} 되돌릴 수 없어.`)) return;
        try { await api(`/api/lecture/trash/${item.type}/${item.id}`, { method: 'DELETE' }); openTrash(); } catch (error) { toast(error.message); }
      });
      const actions = el('div', 'lecture-actions');
      actions.append(restore, purge);
      row.append(info, actions);
      list.append(row);
    });
    root().replaceChildren(list);
  }

  // 폴더 `…` 메뉴(Figma `폴더 ··· 메뉴 상태` 44:57): 폴더 정보와 이름 변경·삭제.
  function folderMenuButton(item) {
    const button = el('button', 'lecture-more');
    button.type = 'button';
    button.setAttribute('aria-label', `${item.name} 메뉴`);
    button.append(svg(ICON_MORE));
    button.addEventListener('click', event => {
      event.stopPropagation();
      document.querySelector('.lecture-item-menu')?.remove();
      const menu = el('div', 'lecture-item-menu lecture-folder-menu');
      const heading = el('div', 'lecture-folder-menu-head');
      heading.append(el('strong', '', item.name), el('span', '', item.type === 'course' ? '과목' : '일반'));
      const stamp = seconds => {
        const date = new Date(seconds * 1000);
        const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        return date.toDateString() === new Date().toDateString() ? `오늘 ${time}` : `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}. ${time}`;
      };
      const rows = [['생성', stamp(item.createdAt)], ['최근 수정', stamp(item.lastActivityAt)],
        ...(item.type === 'course' ? [['자료', `${item.documentCount}개`], ['강의', `${item.sessionCount}개`]] : [['노트', `${item.blankCount}개`], ['자료', `${item.pdfCount}개`]])];
      const info = el('dl', 'lecture-folder-menu-info');
      rows.forEach(([label, value]) => info.append(el('dt', '', label), el('dd', '', value)));
      const rename = el('button', '', '이름 변경');
      rename.type = 'button';
      rename.addEventListener('click', () => {
        menu.remove();
        askName({ heading: '이름 변경', label: '폴더 이름', value: item.name, maxLength: 60, submitText: '저장', anchor: button, run: async name => {
          await api(`/api/lecture/containers/${item.id}`, jsonOptions('PATCH', { name }));
          show();
        } });
      });
      const remove = el('button', 'is-danger', '삭제');
      remove.type = 'button';
      remove.addEventListener('click', async () => {
        menu.remove();
        const recording = ['starting', 'recording'].includes(Recorder().state.status) && Recorder().state.containerId === item.id;
        if (recording) return toast('녹음 중인 폴더는 지울 수 없어. 먼저 일시정지해줘.');
        if (!confirm(`'${item.name}' 폴더를 삭제할까? 안의 자료와 강의도 함께 최근 삭제로 가고, 30일 동안 되돌릴 수 있어.`)) return;
        try {
          await api(`/api/lecture/containers/${item.id}`, { method: 'DELETE' });
          if (Recorder().state.containerId === item.id) Recorder().forgetSession(Recorder().state.session?.id);
          show();
        } catch (error) { toast(error.message); }
      });
      menu.append(heading, info, el('hr', 'lecture-menu-divider'), rename, remove);
      document.body.append(menu);
      const box = button.getBoundingClientRect();
      menu.style.top = `${Math.min(box.bottom + 6, innerHeight - menu.offsetHeight - 16)}px`;
      menu.style.left = `${Math.max(16, box.right - menu.offsetWidth)}px`;
      setTimeout(() => document.addEventListener('pointerdown', function close(e) {
        if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('pointerdown', close); }
      }), 0);
    });
    return button;
  }

  // 이름 하나를 묻는 작은 창(폴더 이름 변경·새 노트). run이 실패하면 창을 닫지 않고 알린다.
  function askName({ heading, label, value, maxLength, submitText, anchor, run }) {
    const dialog = el('dialog', 'lecture-dialog');
    const form = el('form');
    form.method = 'dialog';
    const name = el('input');
    name.required = true;
    name.maxLength = maxLength;
    name.value = value;
    name.setAttribute('aria-label', label);
    const actions = el('div', 'lecture-dialog-actions');
    const cancel = el('button', 'lecture-pill is-plain', '취소');
    cancel.type = 'button';
    cancel.addEventListener('click', () => dialog.close());
    const submit = el('button', 'lecture-pill', submitText);
    submit.type = 'submit';
    actions.append(cancel, submit);
    form.append(el('h2', '', heading), name, actions);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      try {
        await run(name.value.trim());
        dialog.close();
      } catch (error) { toast(error.message); }
    });
    dialog.append(form);
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    const rect = anchor.getBoundingClientRect();
    dialog.style.top = `${rect.bottom + 8}px`;
    dialog.style.left = `${Math.max(16, Math.min(rect.right - dialog.offsetWidth, innerWidth - dialog.offsetWidth - 16))}px`;
    name.select();
  }

  // 목록 항목의 `…` 메뉴. 자료·강의는 지금 삭제뿐이다.
  function itemMenuButton(label, actions) {
    const button = el('button', 'lecture-more');
    button.type = 'button';
    button.setAttribute('aria-label', `${label} 메뉴`);
    button.append(svg(ICON_MORE));
    button.addEventListener('click', event => {
      event.stopPropagation();
      document.querySelector('.lecture-item-menu')?.remove();
      const menu = el('div', 'lecture-item-menu');
      actions.forEach(({ text, danger, run }) => {
        const action = el('button', danger ? 'is-danger' : '', text);
        action.type = 'button';
        action.addEventListener('click', () => { menu.remove(); run(); });
        menu.append(action);
      });
      document.body.append(menu);
      const box = button.getBoundingClientRect();
      menu.style.top = `${box.bottom + 6}px`;
      menu.style.left = `${Math.max(16, box.right - menu.offsetWidth)}px`;
      setTimeout(() => document.addEventListener('pointerdown', function close(e) {
        if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('pointerdown', close); }
      }), 0);
    });
    return button;
  }

  async function trashItem(type, id, name, extra) {
    if (!confirm(`'${name}'을 삭제할까? 최근 삭제에서 30일 동안 되돌릴 수 있어.${extra || ''}`)) return;
    try {
      await api(`/api/lecture/${type === 'session' ? 'sessions' : 'documents'}/${id}`, { method: 'DELETE' });
      if (type === 'session') Recorder().forgetSession(id);
      openContainer(state.container.id);
    } catch (error) { toast(error.message); }
  }

  function renderFolderGrid(grid) {
    const query = state.search.trim().toLowerCase();
    const items = state.containers.filter(item => !query || item.name.toLowerCase().includes(query));
    if (!items.length) {
      grid.replaceChildren(el('p', 'lecture-empty', state.containers.length ? '맞는 폴더가 없어.' : '과목이나 일반 폴더를 만들어서 시작해.'));
      return;
    }
    grid.replaceChildren(...items.map(item => {
      // 안에 별·`…` 버튼이 있어 카드 자체는 button이 아니라 div다.
      const card = el('div', `lecture-folder-card is-${item.type}`);
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
      const top = el('div', 'lecture-folder-top');
      // 즐겨찾기는 메뉴가 아니라 카드의 별을 직접 눌러 켜고 끈다(Figma `Folder Card` Favorite=On/Off).
      const star = el('button', `lecture-star${item.favorite ? ' is-on' : ''}`);
      star.type = 'button';
      star.setAttribute('aria-pressed', String(Boolean(item.favorite)));
      star.setAttribute('aria-label', '즐겨찾기');
      star.append(svg(ICON_STAR));
      star.addEventListener('click', async event => {
        event.stopPropagation();
        try {
          await api(`/api/lecture/containers/${item.id}`, jsonOptions('PATCH', { favorite: !item.favorite }));
          state.containers = (await api('/api/lecture/containers')).containers;
          renderFolderGrid(grid);
        } catch (error) { toast(error.message); }
      });
      top.append(el('span', 'lecture-dot'), el('strong', '', item.name), el('span', 'lecture-tag', item.type === 'course' ? '과목' : '일반'), star, folderMenuButton(item));
      card.append(top, el('span', 'lecture-folder-recent', item.lastDocumentTitle || '아직 자료가 없어'));
      const meta = item.lastDocumentAt ? `${formatDay(item.lastDocumentAt)} 수정 · ${kindLabel(item.lastDocumentKind)}` : `${formatDay(item.createdAt)} 생성`;
      card.append(el('span', 'lecture-meta', meta));
      card.addEventListener('click', () => { state.view = 'home'; openContainer(item.id); });
      return card;
    }));
  }

  function openFolderDialog(anchor) {
    const dialog = el('dialog', 'lecture-dialog');
    const form = el('form');
    form.method = 'dialog';
    const name = el('input');
    name.required = true;
    name.maxLength = 60;
    name.placeholder = '이름';
    name.setAttribute('aria-label', '폴더 이름');
    const types = el('div', 'lecture-segment');
    [['course', '과목'], ['general', '일반']].forEach(([value, label], index) => {
      const option = el('label');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'type';
      radio.value = value;
      radio.checked = index === 0;
      option.append(radio, el('span', '', label));
      types.append(option);
    });
    const actions = el('div', 'lecture-dialog-actions');
    const cancel = el('button', 'lecture-pill is-plain', '취소');
    cancel.type = 'button';
    cancel.addEventListener('click', () => dialog.close());
    const submit = el('button', 'lecture-pill', '만들기');
    submit.type = 'submit';
    actions.append(cancel, submit);
    form.append(el('h2', '', '새 폴더'), el('p', 'lecture-sub', '유형은 만든 뒤 바꿀 수 없어.'), name, types, actions);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      submit.disabled = true;
      try {
        const { container } = await api('/api/lecture/containers', jsonOptions('POST', { name: name.value, type: form.elements.type.value }));
        dialog.close();
        await openContainer(container.id);
      } catch (error) {
        toast(error.message);
        submit.disabled = false;
      }
    });
    dialog.append(form);
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    // Figma의 `새 강의`처럼 누른 버튼 바로 아래에서 펼친다. 오른쪽 끝을 버튼에 맞춘다.
    const rect = anchor.getBoundingClientRect();
    dialog.style.top = `${rect.bottom + 8}px`;
    dialog.style.left = `${Math.max(16, rect.right - dialog.offsetWidth)}px`;
    const close = () => dialog.close();
    window.addEventListener('resize', close, { once: true });
    dialog.addEventListener('click', event => {
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
    });
    name.focus();
  }

  // ─── 폴더 홈 ───────────────────────────────────────────────────────────────

  async function openContainer(id) {
    try {
      const [{ containers }, { documents }, { sessions }] = await Promise.all([
        api('/api/lecture/containers'),
        api(`/api/lecture/containers/${id}/documents`),
        api(`/api/lecture/containers/${id}/sessions`),
      ]);
      state.containers = containers;
      state.container = containers.find(item => item.id === id) || null;
      state.documents = documents;
      state.sessions = sessions;
    } catch (error) {
      state.container = null;
      toast(error.message);
      return show();
    }
    if (!state.container) return show();
    renderContainer();
  }

  function renderContainer() {
    if (state.container.type === 'course' && state.view === 'home') return renderCourseHome();
    const container = state.container;
    const inCourse = container.type === 'course';
    const back = el('button', 'lecture-back');
    back.type = 'button';
    back.append(svg(ICON_BACK), document.createTextNode(inCourse ? container.name : 'Notes'));
    back.addEventListener('click', () => {
      if (inCourse) { state.view = 'home'; return renderContainer(); }
      state.container = null;
      return show();
    });
    const title = el('div');
    title.append(back, el('h1', '', inCourse ? '자료' : container.name), el('p', 'lecture-sub', inCourse ? `${container.name} · 자료 ${state.documents.length}` : `일반 · 자료 ${state.documents.length}`));

    const actions = el('div', 'lecture-actions');
    const blank = el('button', 'lecture-pill is-plain');
    blank.type = 'button';
    blank.append(svg(ICON_PLUS), document.createTextNode('새 노트'));
    blank.addEventListener('click', () => askName({ heading: '새 노트', label: '노트 이름', value: '새 노트', maxLength: 120, submitText: '만들기', anchor: blank, run: async title => {
      const { document: doc } = await api(`/api/lecture/containers/${container.id}/blank`, jsonOptions('POST', { title }));
      openViewer(doc.id);
    } }));
    actions.append(blank, ...uploadButton('lecture-pill'));
    head().replaceChildren(title, actions);

    const list = el('div', 'lecture-doc-list');
    list.id = 'lecture-doc-list';
    if (!state.documents.length) list.append(el('p', 'lecture-empty', 'PDF 자료를 추가하거나 새 노트를 만들어.'));
    state.documents.forEach(doc => {
      const row = el('div', 'lecture-doc-row has-menu');
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      const pages = doc.kind === 'blank' ? ` · ${doc.blankPages}쪽` : '';
      const info = el('div');
      info.append(el('strong', '', doc.title), el('span', 'lecture-meta', `${kindLabel(doc.kind)}${pages} · ${formatDay(doc.updatedAt)} 수정`));
      row.append(info, itemMenuButton(doc.title, [{ text: '삭제', danger: true, run: () => trashItem('document', doc.id, doc.title) }]));
      row.addEventListener('click', () => openViewer(doc.id));
      list.append(row);
    });
    root().replaceChildren(list);
  }

  function uploadButton(className) {
    const file = el('input');
    file.type = 'file';
    file.accept = 'application/pdf,.pdf';
    file.hidden = true;
    file.addEventListener('change', () => uploadPdf(file));
    const upload = el('button', className);
    upload.type = 'button';
    upload.append(svg(ICON_PLUS), document.createTextNode('자료 추가'));
    upload.addEventListener('click', () => file.click());
    return [upload, file];
  }

  // ─── Course Home: 강의 타임라인(Figma Course Home v0.5 · `Timeline Item` 144:122) ─────────────

  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const dateOf = localDate => new Date(`${localDate}T00:00:00`);

  function renderCourseHome() {
    const container = state.container;
    const back = el('button', 'lecture-back');
    back.type = 'button';
    back.append(svg(ICON_BACK), document.createTextNode('Notes'));
    back.addEventListener('click', () => { state.container = null; show(); });
    const title = el('div');
    title.append(back, el('h1', '', container.name), el('p', 'lecture-sub', `강의 ${state.sessions.filter(session => session.partCount > 0).length} · 자료 ${state.documents.length}`));
    const actions = el('div', 'lecture-actions');
    const lecture = el('button', 'lecture-pill');
    lecture.type = 'button';
    lecture.append(svg(ICON_PLUS), document.createTextNode('새 강의'));
    lecture.addEventListener('click', openNewLectureSheet);
    actions.append(lecture, ...uploadButton('lecture-pill is-plain'));
    head().replaceChildren(title, actions);

    // 마이크 권한 실패 등으로 녹음 없이 남은 Session은 오늘 것이 아니면 보이지 않는다.
    const today = Recorder().localDate();
    const sessions = state.sessions.filter(session => session.partCount > 0 || session.localDate === today);
    const body = el('div', 'lecture-course');
    const timeline = el('div', 'lecture-timeline');
    if (!sessions.length) timeline.append(el('p', 'lecture-empty', '아직 녹음한 강의가 없어. 자료를 열고 마이크를 누르면 여기에 쌓여.'));
    let month = null;
    sessions.forEach((session, index) => {
      const date = dateOf(session.localDate);
      if (date.getMonth() !== month) {
        month = date.getMonth();
        timeline.append(el('p', 'lecture-month', `${month + 1}월`));
      }
      // 마이크가 이어 붙는 오늘의 가장 최근 Session 하나만 진행 중이다. 목록이 최신순이라 오늘 것 중 첫째다.
      const live = session.localDate === today && sessions.findIndex(item => item.localDate === today) === index;
      const item = el('div', `lecture-tl-item${live ? ' is-live' : ''}`);
      const day = el('div', 'lecture-tl-date');
      day.append(el('strong', '', String(date.getDate())), el('span', '', WEEKDAYS[date.getDay()]));
      const rail = el('div', 'lecture-tl-rail');
      rail.append(el('span', 'lecture-tl-dot'), el('span', 'lecture-tl-line'));
      const card = el('div', 'lecture-tl-card');
      const minutes = Math.round(session.recordedMs / 60000);
      const length = session.recordedMs < 60000 ? '1분 미만' : `${minutes}분`;
      const cardHead = el('div', 'lecture-tl-head');
      // 제목·소개문은 전사 뒤 소개문 요약이 채운다(§11.4). 그 전에는 순번과 안내만 보인다.
      cardHead.append(el('strong', '', `강의 ${sessions.length - index}`), el('span', 'lecture-tl-status', live ? `오늘 · ${length}` : `${length} · 전사 대기`));
      card.append(cardHead, el('p', 'lecture-tl-intro', '전사가 끝나면 소개문이 생겨요.'));
      if (session.documents.length) {
        const chips = el('div', 'lecture-tl-docs');
        session.documents.forEach(doc => {
          const chip = el('button', 'lecture-chip', doc.title);
          chip.type = 'button';
          // 강의에서 자료로 들어가면 그 강의의 첫 구간으로 재생 위치를 맞춘다(§12.2 강의 진입).
          chip.addEventListener('click', event => { event.stopPropagation(); openViewer(doc.id, { playSession: session.id }); });
          chips.append(chip);
        });
        card.append(chips);
        card.addEventListener('click', () => openViewer(session.documents[0].id, { playSession: session.id }));
        card.setAttribute('role', 'button');
        card.tabIndex = 0;
      }
      // 녹음 중인 강의는 지울 수 없다.
      const recordingThis = ['starting', 'recording'].includes(Recorder().state.status) && Recorder().state.session?.id === session.id;
      cardHead.append(itemMenuButton(`강의 ${sessions.length - index}`, [{
        text: '삭제',
        danger: true,
        run: () => (recordingThis ? toast('녹음 중인 강의는 지울 수 없어. 먼저 일시정지해줘.') : trashItem('session', session.id, `강의 ${sessions.length - index}`, ' 그 강의 중에 쓴 필기도 함께 숨겨져.')),
      }]));
      item.append(day, rail, card);
      timeline.append(item);
    });

    const docs = el('button', 'lecture-docs-link');
    docs.type = 'button';
    docs.append(el('strong', '', '자료'), el('span', 'lecture-docs-count', `${state.documents.length}개`), el('span', 'lecture-docs-names', state.documents.map(doc => doc.title).join(' · ')), svg(ICON_CHEVRON));
    docs.addEventListener('click', () => { state.view = 'docs'; renderContainer(); });
    body.append(timeline, docs);
    root().replaceChildren(body);
  }

  // `+ 새 강의`: 자료를 고르거나 새 백지 노트로 연다. 그 뷰어의 첫 녹음만 오늘 Session과 따로 기록된다(§6.5).
  function openNewLectureSheet() {
    const dialog = el('dialog', 'lecture-sheet');
    const close = () => dialog.close();
    const list = el('div', 'lecture-sheet-docs');
    [...state.documents].sort((a, b) => b.updatedAt - a.updatedAt).forEach(doc => {
      const row = el('button', 'lecture-sheet-doc');
      row.type = 'button';
      const pages = doc.kind === 'blank' ? `${doc.blankPages}쪽` : 'PDF';
      const updated = new Date(doc.updatedAt * 1000);
      row.append(el('strong', '', doc.title), el('span', '', `${pages} · 최근 ${updated.getMonth() + 1}/${updated.getDate()}`));
      row.addEventListener('click', () => { close(); openViewer(doc.id, { newLecture: true }); });
      list.append(row);
    });
    if (!state.documents.length) list.append(el('p', 'lecture-meta', '아직 자료가 없어.'));
    const blank = el('button', 'lecture-sheet-blank');
    blank.type = 'button';
    blank.append(svg(ICON_PLUS), document.createTextNode('자료 없이 백지 노트로 시작'));
    blank.addEventListener('click', async () => {
      try {
        const { document: doc } = await api(`/api/lecture/containers/${state.container.id}/blank`, jsonOptions('POST', {}));
        close();
        openViewer(doc.id, { newLecture: true });
      } catch (error) { toast(error.message); }
    });
    dialog.append(el('h2', '', '새 강의'), el('p', 'lecture-sheet-hint', '오늘 강의와 따로 기록돼. 마이크는 자료를 연 뒤에 직접 눌러.'), el('p', 'lecture-sheet-section', '자료 고르기'), list, blank);
    dialog.addEventListener('click', event => {
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
    });
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  }

  async function uploadPdf(input) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const pending = el('div', 'lecture-doc-row is-pending');
    pending.append(el('strong', '', file.name), el('span', 'lecture-meta', '올리는 중…'));
    document.getElementById('lecture-doc-list')?.prepend(pending);
    const form = new FormData();
    form.append('file', file, file.name);
    try {
      await api(`/api/lecture/containers/${state.container.id}/documents`, { method: 'POST', body: form });
      await openContainer(state.container.id);
    } catch (error) {
      pending.remove();
      toast(error.message);
    }
  }

  global.LectureNotes = {
    show,
    // 뷰어를 닫으면 보던 폴더를 다시 그린다.
    refresh() { if (state.container) openContainer(state.container.id); },
  };
})(window);
