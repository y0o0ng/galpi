'use strict';

// 강의 노트 L1a: Notes 홈 · 폴더 홈 · Document Viewer(PDF·백지 + 펜·지우개).
// 설계 정본은 docs/Lecture-note-system_Design_v4.3.md다. 필기 정본은 서버 revision이고
// 기기의 IndexedDB 사본은 업로드 전 작업본이다(§8.1·§8.3).
(function (global) {
  const PDFJS_BASE = '/lib/pdfjs/';
  const BLANK_ASPECT = Math.SQRT2;
  const PENS = [
    { color: '#1D2622', width: 0.0024 },
    { color: '#3B6FD8', width: 0.0024 },
    { color: '#D8453B', width: 0.0024 },
  ];
  const ERASER_RADIUS = 0.012;
  const UPLOAD_DELAY_MS = 2000;
  const UPLOAD_INTERVAL_MS = 20000;

  const state = { containers: [], container: null, documents: [], search: '', loaded: false };
  let viewer = null;

  const root = () => document.getElementById('lecture-root');
  const head = () => document.getElementById('lecture-head');

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function svg(markup, className = '') {
    const wrap = document.createElement('span');
    wrap.className = `lecture-icon ${className}`.trim();
    wrap.innerHTML = markup;
    wrap.setAttribute('aria-hidden', 'true');
    return wrap;
  }
  const ICON_BACK = '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_PLUS = '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const ICON_SEARCH = '<svg viewBox="0 0 16 16" width="16" height="16"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="m10.5 10.5 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
  const ICON_ERASER = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 15.5 13.5 6l5 5L9 20.5H5.5L4 19z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 10.5 14 15.5M9 20.5h11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  const penIcon = color => `<svg viewBox="0 0 40 16" width="40" height="16"><path d="M0 3h24v10H0z" fill="#FAFBF9" stroke="#1D2622" stroke-width="1"/><path d="M0 3h9v10H0z" fill="${color}"/><path d="M24 3l12 5-12 5z" fill="${color}" stroke="#1D2622" stroke-width="1" stroke-linejoin="round"/></svg>`;

  async function api(url, options) {
    const res = await global.apiFetch(url, options);
    const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    if (!res.ok) {
      const error = new Error(body?.error || `요청 실패 (${res.status})`);
      error.status = res.status;
      error.body = body;
      throw error;
    }
    return body;
  }
  const jsonOptions = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  function formatDay(seconds) {
    if (!seconds) return '';
    const date = new Date(seconds * 1000);
    return `${date.getMonth() + 1}월 ${date.getDate()}일`;
  }
  const kindLabel = kind => (kind === 'pdf' ? 'PDF' : '백지 노트');

  function toast(message) {
    const node = el('div', 'lecture-toast', message);
    document.body.append(node);
    setTimeout(() => node.remove(), 3200);
  }

  // ─── Notes 홈 ──────────────────────────────────────────────────────────────

  async function show() {
    if (viewer) return;
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
    head().replaceChildren(title, add);

    const search = el('label', 'lecture-search');
    const input = el('input');
    input.type = 'search';
    input.placeholder = '폴더 검색';
    input.value = state.search;
    input.addEventListener('input', () => { state.search = input.value; renderFolderGrid(grid); });
    search.append(svg(ICON_SEARCH), input);
    const grid = el('div', 'lecture-folder-grid');
    renderFolderGrid(grid);
    root().replaceChildren(search, grid);
  }

  function renderFolderGrid(grid) {
    const query = state.search.trim().toLowerCase();
    const items = state.containers.filter(item => !query || item.name.toLowerCase().includes(query));
    if (!items.length) {
      grid.replaceChildren(el('p', 'lecture-empty', state.containers.length ? '맞는 폴더가 없어.' : '과목이나 일반 폴더를 만들어서 시작해.'));
      return;
    }
    grid.replaceChildren(...items.map(item => {
      const card = el('button', `lecture-folder-card is-${item.type}`);
      card.type = 'button';
      const top = el('div', 'lecture-folder-top');
      top.append(el('span', 'lecture-dot'), el('strong', '', item.name), el('span', 'lecture-tag', item.type === 'course' ? '과목' : '일반'));
      card.append(top, el('span', 'lecture-folder-recent', item.lastDocumentTitle || '아직 자료가 없어'));
      const meta = item.lastDocumentAt ? `${formatDay(item.lastDocumentAt)} 수정 · ${kindLabel(item.lastDocumentKind)}` : `${formatDay(item.createdAt)} 생성`;
      card.append(el('span', 'lecture-meta', meta));
      card.addEventListener('click', () => openContainer(item.id));
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
      const [{ containers }, { documents }] = await Promise.all([
        api('/api/lecture/containers'),
        api(`/api/lecture/containers/${id}/documents`),
      ]);
      state.containers = containers;
      state.container = containers.find(item => item.id === id) || null;
      state.documents = documents;
    } catch (error) {
      state.container = null;
      toast(error.message);
      return show();
    }
    if (!state.container) return show();
    renderContainer();
  }

  function renderContainer() {
    const container = state.container;
    const back = el('button', 'lecture-back');
    back.type = 'button';
    back.append(svg(ICON_BACK), document.createTextNode('Notes'));
    back.addEventListener('click', () => { state.container = null; show(); });
    const title = el('div');
    title.append(back, el('h1', '', container.name), el('p', 'lecture-sub', `${container.type === 'course' ? '과목' : '일반'} · 자료 ${state.documents.length}`));

    const actions = el('div', 'lecture-actions');
    const blank = el('button', 'lecture-pill is-plain');
    blank.type = 'button';
    blank.append(svg(ICON_PLUS), document.createTextNode('새 노트'));
    blank.addEventListener('click', async () => {
      try {
        const { document: doc } = await api(`/api/lecture/containers/${container.id}/blank`, jsonOptions('POST', {}));
        openViewer(doc.id);
      } catch (error) { toast(error.message); }
    });
    const file = el('input');
    file.type = 'file';
    file.accept = 'application/pdf,.pdf';
    file.hidden = true;
    file.addEventListener('change', () => uploadPdf(file));
    const upload = el('button', 'lecture-pill');
    upload.type = 'button';
    upload.append(svg(ICON_PLUS), document.createTextNode('자료 추가'));
    upload.addEventListener('click', () => file.click());
    actions.append(blank, upload, file);
    head().replaceChildren(title, actions);

    const list = el('div', 'lecture-doc-list');
    list.id = 'lecture-doc-list';
    if (!state.documents.length) list.append(el('p', 'lecture-empty', 'PDF 자료를 추가하거나 새 노트를 만들어.'));
    state.documents.forEach(doc => {
      const row = el('button', 'lecture-doc-row');
      row.type = 'button';
      const pages = doc.kind === 'blank' ? ` · ${doc.blankPages}쪽` : '';
      row.append(el('strong', '', doc.title), el('span', 'lecture-meta', `${kindLabel(doc.kind)}${pages} · ${formatDay(doc.updatedAt)} 수정`));
      row.addEventListener('click', () => openViewer(doc.id));
      list.append(row);
    });
    root().replaceChildren(list);
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

  // ─── 기기 작업본(IndexedDB) ─────────────────────────────────────────────────

  let dbPromise = null;
  function draftStore(mode) {
    dbPromise ||= new Promise((resolve, reject) => {
      const request = indexedDB.open('galpi-lecture', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'documentId' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise.then(db => db.transaction('drafts', mode).objectStore('drafts'));
  }
  const idb = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const readDraft = async id => { try { return await idb((await draftStore('readonly')).get(id)); } catch { return null; } };
  const writeDraft = async draft => idb((await draftStore('readwrite')).put(draft));

  function deviceId() {
    let id = localStorage.getItem('galpi-lecture-device');
    if (!id) {
      id = `dev_${crypto.getRandomValues(new Uint32Array(2)).join('')}`;
      localStorage.setItem('galpi-lecture-device', id);
    }
    return id;
  }

  // ─── Document Viewer ──────────────────────────────────────────────────────

  let pdfjsPromise = null;
  function loadPdfjs() {
    pdfjsPromise ||= import(`${PDFJS_BASE}build/pdf.min.mjs`).then(lib => {
      lib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}build/pdf.worker.min.mjs`;
      return lib;
    });
    return pdfjsPromise;
  }

  async function openViewer(documentId) {
    if (viewer) return;
    const v = {
      documentId, doc: null, container: null, pdf: null, sizes: [], pages: [],
      body: { pages: {} }, baseRevision: 0, dirty: false, changeSeq: 0,
      uploading: false, conflict: null, offline: false,
      tool: { type: 'pen', pen: 0 }, stroke: null, erasing: false,
      uploadTimer: null, draftTimer: null, interval: null,
    };
    viewer = v;
    v.el = buildViewerShell(v);
    document.body.append(v.el);
    document.body.classList.add('lecture-viewer-open');
    try {
      const [{ document: doc, container }, server, draft] = await Promise.all([
        api(`/api/lecture/documents/${documentId}`),
        api(`/api/lecture/documents/${documentId}/annotations`),
        readDraft(documentId),
      ]);
      v.doc = doc;
      v.container = container;
      v.back.lastChild.textContent = container?.name || 'Notes';
      v.title.textContent = doc.title;
      // 올리지 못한 기기 작업본이 있으면 버리지 않는다. 같은 revision 위에서 쓴 것이면 이어서 올리고,
      // 그 사이 서버가 바뀌었으면 자동으로 합치지 않고 충돌로 알린다(§8.3).
      if (draft?.dirty) {
        v.body = draft.body;
        v.dirty = true;
        v.baseRevision = draft.baseRevision;
        if (draft.baseRevision !== server.revision) v.conflict = { revision: server.revision, body: server.body };
      } else {
        v.body = server.body;
        v.baseRevision = server.revision;
      }
      if (doc.kind === 'pdf') {
        const lib = await loadPdfjs();
        const res = await global.apiFetch(`/api/lecture/documents/${documentId}/file`);
        if (!res.ok) throw new Error('PDF를 불러오지 못했어.');
        v.pdf = await lib.getDocument({
          data: new Uint8Array(await res.arrayBuffer()),
          cMapUrl: `${PDFJS_BASE}cmaps/`,
          standardFontDataUrl: `${PDFJS_BASE}standard_fonts/`,
          wasmUrl: `${PDFJS_BASE}wasm/`,
          isEvalSupported: false,
        }).promise;
        for (let index = 1; index <= v.pdf.numPages; index += 1) {
          const viewport = (await v.pdf.getPage(index)).getViewport({ scale: 1 });
          v.sizes.push(viewport.height / viewport.width);
        }
      } else {
        v.sizes = Array.from({ length: doc.blankPages }, () => BLANK_ASPECT);
      }
    } catch (error) {
      toast(error.message);
      closeViewer();
      return;
    }
    if (viewer !== v) return;
    buildPages(v);
    renderStatus(v);
    v.interval = setInterval(() => upload(v), UPLOAD_INTERVAL_MS);
    if (v.dirty && !v.conflict) scheduleUpload(v);
  }

  function buildViewerShell(v) {
    const shell = el('div', 'lecture-viewer');
    const header = el('header', 'lecture-viewer-head');
    v.back = el('button', 'lecture-back');
    v.back.type = 'button';
    v.back.append(svg(ICON_BACK), el('span', '', ''));
    v.back.addEventListener('click', closeViewer);
    const center = el('div', 'lecture-viewer-title');
    v.title = el('strong', '', '불러오는 중…');
    v.status = el('span', 'lecture-meta', '');
    center.append(v.title, v.status);
    header.append(v.back, center, el('span'));

    v.banner = el('div', 'lecture-conflict');
    v.banner.hidden = true;

    v.scroller = el('div', 'lecture-scroller');
    v.pagesEl = el('div', 'lecture-pages');
    v.scroller.append(v.pagesEl);
    // Pencil은 그리고 손가락은 스크롤한다. Safari는 stylus 터치도 스크롤로 먹으므로 그것만 막는다.
    v.scroller.addEventListener('touchstart', event => {
      if ([...event.touches].some(touch => touch.touchType === 'stylus')) event.preventDefault();
    }, { passive: false });
    v.scroller.addEventListener('touchmove', event => {
      if ([...event.touches].some(touch => touch.touchType === 'stylus')) event.preventDefault();
    }, { passive: false });
    v.scroller.addEventListener('scroll', () => requestAnimationFrame(() => updatePageIndicator(v)), { passive: true });

    v.rail = buildRail(v);
    v.indicator = el('div', 'lecture-page-pill', '');
    shell.append(header, v.banner, v.scroller, v.rail, v.indicator);

    v.onVisibility = () => { if (document.visibilityState === 'hidden') flush(v); };
    document.addEventListener('visibilitychange', v.onVisibility);
    // window resize는 iPad 회전 중 레이아웃이 바뀌기 전 폭으로 올 때가 있어 스크롤 영역 자체를 본다.
    v.resizeObserver = new ResizeObserver(() => { if (v.pages.length) layoutPages(v); });
    v.resizeObserver.observe(v.scroller);
    return shell;
  }

  function buildRail(v) {
    const rail = el('div', 'lecture-rail');
    rail.setAttribute('role', 'toolbar');
    rail.setAttribute('aria-label', '필기 도구');
    const buttons = [];
    const select = tool => {
      v.tool = tool;
      buttons.forEach(({ button, match }) => button.classList.toggle('active', match(tool)));
    };
    PENS.forEach((pen, index) => {
      const button = el('button', 'lecture-rail-pen');
      button.type = 'button';
      button.setAttribute('aria-label', `펜 ${index + 1}`);
      button.append(svg(penIcon(pen.color)));
      button.addEventListener('click', () => select({ type: 'pen', pen: index }));
      buttons.push({ button, match: tool => tool.type === 'pen' && tool.pen === index });
      rail.append(button);
    });
    rail.append(el('span', 'lecture-rail-divider'));
    const eraser = el('button', 'lecture-rail-tool');
    eraser.type = 'button';
    eraser.setAttribute('aria-label', '지우개');
    eraser.append(svg(ICON_ERASER));
    eraser.addEventListener('click', () => select({ type: 'eraser' }));
    buttons.push({ button: eraser, match: tool => tool.type === 'eraser' });
    rail.append(eraser);
    select(v.tool);
    return rail;
  }

  function buildPages(v) {
    v.pages = v.sizes.map((aspect, index) => {
      const page = el('div', 'lecture-page');
      const base = el('canvas', 'lecture-page-base');
      const ink = el('canvas', 'lecture-page-ink');
      page.append(base, ink);
      page.dataset.page = String(index + 1);
      const entry = { number: index + 1, aspect, el: page, base, ink, visible: false, renderToken: 0 };
      bindInk(v, entry);
      return entry;
    });
    v.pagesEl.replaceChildren(...v.pages.map(page => page.el));
    if (v.doc.kind === 'blank') {
      const add = el('button', 'lecture-pill is-plain lecture-add-page');
      add.type = 'button';
      add.append(svg(ICON_PLUS), document.createTextNode('페이지 추가'));
      add.addEventListener('click', () => addBlankPage(v));
      v.pagesEl.append(add);
    }
    v.observer?.disconnect();
    // 화면 근처 페이지만 캔버스를 잡는다. 전부 잡으면 수십 쪽에서 iPad 캔버스 메모리가 넘친다.
    v.observer = new IntersectionObserver(entries => {
      entries.forEach(item => {
        const page = v.pages[Number(item.target.dataset.page) - 1];
        if (!page) return;
        if (item.isIntersecting) showPage(v, page);
        else hidePage(page);
      });
    }, { root: v.scroller, rootMargin: '100% 0px' });
    v.pageWidth = 0;
    layoutPages(v);
    v.pages.forEach(page => v.observer.observe(page.el));
  }

  function layoutPages(v) {
    const width = Math.min(v.scroller.clientWidth - 32, 900);
    if (width === v.pageWidth) return;
    // 폭이 바뀌면 페이지 높이도 바뀌므로, 보던 페이지와 그 안의 비율 위치를 다시 맞춘다.
    const anchor = v.pageWidth && v.pages.find(page => page.el.offsetTop + page.el.offsetHeight > v.scroller.scrollTop);
    const within = anchor ? (v.scroller.scrollTop - anchor.el.offsetTop) / anchor.el.offsetHeight : 0;
    v.pageWidth = width;
    v.pages.forEach(page => {
      page.el.style.width = `${width}px`;
      page.el.style.height = `${Math.round(width * page.aspect)}px`;
      if (page.visible) showPage(v, page);
    });
    if (anchor) v.scroller.scrollTop = anchor.el.offsetTop + within * anchor.el.offsetHeight;
    updatePageIndicator(v);
  }

  function showPage(v, page) {
    page.visible = true;
    const dpr = Math.min(global.devicePixelRatio || 1, 2);
    const width = Math.round(v.pageWidth * dpr);
    const height = Math.round(v.pageWidth * page.aspect * dpr);
    if (page.ink.width !== width || page.ink.height !== height) {
      page.ink.width = width;
      page.ink.height = height;
    }
    drawInk(v, page);
    if (v.pdf) renderPdfPage(v, page, width);
  }

  function hidePage(page) {
    page.visible = false;
    page.rendered = false;
    page.renderToken += 1;
    page.base.width = 0;
    page.base.height = 0;
    page.ink.width = 0;
    page.ink.height = 0;
  }

  async function renderPdfPage(v, page, width) {
    if (page.base.width === width && page.rendered) return;
    const token = ++page.renderToken;
    page.rendered = false;
    const pdfPage = await v.pdf.getPage(page.number);
    if (token !== page.renderToken || !page.visible) return;
    const viewport = pdfPage.getViewport({ scale: width / pdfPage.getViewport({ scale: 1 }).width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    try {
      await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    } catch { return; }
    if (token !== page.renderToken || !page.visible) return;
    page.base.width = canvas.width;
    page.base.height = canvas.height;
    page.base.getContext('2d').drawImage(canvas, 0, 0);
    page.rendered = true;
  }

  function updatePageIndicator(v) {
    if (!v.pages.length) return;
    const middle = v.scroller.getBoundingClientRect().top + v.scroller.clientHeight / 2;
    const current = v.pages.find(page => page.el.getBoundingClientRect().bottom >= middle) || v.pages[v.pages.length - 1];
    v.indicator.textContent = `${current.number} / ${v.pages.length}`;
  }

  async function addBlankPage(v) {
    try {
      const { document: doc } = await api(`/api/lecture/documents/${v.documentId}/pages`, jsonOptions('PATCH', { blankPages: v.pages.length + 1 }));
      v.doc = doc;
      v.sizes = Array.from({ length: doc.blankPages }, () => BLANK_ASPECT);
      buildPages(v);
      renderStatus(v);
      v.pages[v.pages.length - 1].el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) { toast(error.message); }
  }

  // ─── 필기 ─────────────────────────────────────────────────────────────────

  const pageStrokes = (v, number) => (v.body.pages[number] ||= []);

  function drawStroke(ctx, stroke, scale) {
    const points = stroke.points;
    if (!points.length) return;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = Math.max(stroke.width * scale, 1);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0][0] * scale, points[0][1] * scale, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(points[0][0] * scale, points[0][1] * scale);
    for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index][0] * scale, points[index][1] * scale);
    ctx.stroke();
  }

  function drawInk(v, page) {
    if (!page.ink.width) return;
    const ctx = page.ink.getContext('2d');
    ctx.clearRect(0, 0, page.ink.width, page.ink.height);
    (v.body.pages[page.number] || []).forEach(stroke => drawStroke(ctx, stroke, page.ink.width));
  }

  // 좌표는 페이지 폭을 1로 둔 값이다. 회전·크기 변화에도 같은 자리에 다시 그려진다.
  function pagePoint(page, event) {
    const rect = page.ink.getBoundingClientRect();
    const round = value => Math.round(value * 10000) / 10000;
    return [round((event.clientX - rect.left) / rect.width), round((event.clientY - rect.top) / rect.width), Math.round((event.pressure || 0.5) * 100) / 100];
  }

  function bindInk(v, page) {
    const canDraw = event => event.pointerType === 'pen' || (event.pointerType === 'mouse' && event.button === 0);
    page.ink.addEventListener('pointerdown', event => {
      if (!canDraw(event) || v.conflict) return;
      event.preventDefault();
      page.ink.setPointerCapture(event.pointerId);
      if (v.tool.type === 'eraser') {
        v.erasing = { page, pointerId: event.pointerId, last: pagePoint(page, event) };
        eraseAt(v, page, v.erasing.last);
        return;
      }
      const pen = PENS[v.tool.pen];
      v.stroke = {
        page,
        pointerId: event.pointerId,
        data: {
          id: `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          tool: 'pen',
          color: pen.color,
          width: pen.width,
          points: [pagePoint(page, event)],
          // L1b에서 녹음 Session이 생기면 여기에 source_session_id와 t_ms가 들어간다(§8.2).
          source_session_id: null,
          t_ms: null,
          created_at: Date.now(),
        },
      };
      drawStroke(page.ink.getContext('2d'), v.stroke.data, page.ink.width);
    });
    page.ink.addEventListener('pointermove', event => {
      if (v.erasing?.pointerId === event.pointerId) {
        // 이벤트 사이도 훑는다. 빠르게 문지르면 두 이벤트 사이에 있는 획을 건너뛴다.
        (event.getCoalescedEvents?.() || [event]).forEach(item => {
          const to = pagePoint(page, item);
          const from = v.erasing.last;
          const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / (ERASER_RADIUS / 2)));
          for (let step = 1; step <= steps; step += 1) {
            eraseAt(v, page, [from[0] + (to[0] - from[0]) * step / steps, from[1] + (to[1] - from[1]) * step / steps]);
          }
          v.erasing.last = to;
        });
        return;
      }
      const active = v.stroke;
      if (!active || active.pointerId !== event.pointerId) return;
      const ctx = page.ink.getContext('2d');
      const scale = page.ink.width;
      ctx.strokeStyle = active.data.color;
      ctx.lineWidth = Math.max(active.data.width * scale, 1);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let last = active.data.points[active.data.points.length - 1];
      ctx.moveTo(last[0] * scale, last[1] * scale);
      (event.getCoalescedEvents?.() || [event]).forEach(item => {
        last = pagePoint(page, item);
        active.data.points.push(last);
        ctx.lineTo(last[0] * scale, last[1] * scale);
      });
      ctx.stroke();
    });
    // pointercancel도 끝으로 본다. 실측에서 필기 도중 cancel이 났고, 그린 만큼은 남기는 편이 낫다.
    const end = event => {
      if (v.erasing?.pointerId === event.pointerId) {
        v.erasing = null;
        return;
      }
      const active = v.stroke;
      if (!active || active.pointerId !== event.pointerId) return;
      v.stroke = null;
      pageStrokes(v, page.number).push(active.data);
      markChanged(v);
    };
    page.ink.addEventListener('pointerup', end);
    page.ink.addEventListener('pointercancel', end);
  }

  function segmentDistance(point, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length)) : 0;
    return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
  }

  // 획 지우개다. 닿은 획을 통째로 지운다.
  function eraseAt(v, page, point) {
    const strokes = v.body.pages[page.number];
    if (!strokes?.length) return;
    const kept = strokes.filter(stroke => !stroke.points.some((current, index) => {
      const previous = stroke.points[index - 1] || current;
      return segmentDistance(point, previous, current) <= ERASER_RADIUS;
    }));
    if (kept.length === strokes.length) return;
    v.body.pages[page.number] = kept;
    drawInk(v, page);
    markChanged(v);
  }

  // ─── 저장 ─────────────────────────────────────────────────────────────────

  function markChanged(v) {
    v.dirty = true;
    v.changeSeq += 1;
    clearTimeout(v.draftTimer);
    v.draftTimer = setTimeout(() => saveDraft(v), 250);
    scheduleUpload(v);
    renderStatus(v);
  }

  function saveDraft(v) {
    return writeDraft({ documentId: v.documentId, body: v.body, baseRevision: v.baseRevision, dirty: v.dirty, savedAt: Date.now() })
      .catch(() => toast('기기에 필기를 저장하지 못했어.'));
  }

  function scheduleUpload(v) {
    clearTimeout(v.uploadTimer);
    v.uploadTimer = setTimeout(() => upload(v), UPLOAD_DELAY_MS);
  }

  async function upload(v) {
    if (!v.dirty || v.uploading || v.conflict) return;
    v.uploading = true;
    const seq = v.changeSeq;
    renderStatus(v);
    try {
      const res = await global.apiFetch(`/api/lecture/documents/${v.documentId}/annotations`, jsonOptions('PUT', { baseRevision: v.baseRevision, body: v.body, deviceId: deviceId() }));
      const result = await res.json().catch(() => ({}));
      if (res.status === 409) {
        v.conflict = { revision: result.revision, body: result.body };
      } else if (res.ok) {
        v.baseRevision = result.revision;
        v.offline = false;
        if (v.changeSeq === seq) v.dirty = false;
      } else {
        throw new Error(result.error);
      }
    } catch {
      v.offline = true;
    } finally {
      v.uploading = false;
    }
    await saveDraft(v);
    renderStatus(v);
    if (v.dirty && !v.conflict && !v.offline) scheduleUpload(v);
  }

  function flush(v) {
    if (!v.doc) return null;
    clearTimeout(v.draftTimer);
    saveDraft(v);
    return upload(v);
  }

  function renderStatus(v) {
    if (!v.doc) return;
    const pages = `${v.pages.length || v.sizes.length}쪽`;
    let status = '저장됨';
    if (v.conflict) status = '충돌 · 기기에 보관 중';
    else if (v.uploading) status = '저장 중…';
    else if (v.offline && v.dirty) status = '오프라인 · 기기에 보관 중';
    else if (v.dirty) status = '기기에 저장됨';
    v.status.textContent = `${pages} · ${status}`;
    renderConflict(v);
  }

  // 자동으로 합치거나 덮어쓰지 않는다. 어느 쪽을 남길지는 사용자가 고른다(§8.3).
  function renderConflict(v) {
    v.banner.hidden = !v.conflict;
    if (!v.conflict) return;
    const useServer = el('button', 'lecture-pill is-plain', '서버 필기 불러오기');
    useServer.type = 'button';
    useServer.addEventListener('click', () => {
      if (!confirm('이 기기에서 쓴 필기를 버리고 서버 필기로 바꿀까?')) return;
      v.body = v.conflict.body;
      v.baseRevision = v.conflict.revision;
      v.conflict = null;
      v.dirty = false;
      v.pages.forEach(page => drawInk(v, page));
      saveDraft(v);
      renderStatus(v);
    });
    const keepLocal = el('button', 'lecture-pill', '이 기기 필기로 저장');
    keepLocal.type = 'button';
    keepLocal.addEventListener('click', () => {
      if (!confirm('서버 필기를 이 기기 필기로 바꿀까? 서버에만 있던 획은 사라져.')) return;
      v.baseRevision = v.conflict.revision;
      v.conflict = null;
      upload(v);
    });
    v.banner.replaceChildren(el('span', '', '다른 기기에서 먼저 저장한 필기가 있어. 이 기기 필기는 그대로 보관 중이야.'), useServer, keepLocal);
  }

  function closeViewer() {
    const v = viewer;
    if (!v) return;
    viewer = null;
    flush(v);
    clearInterval(v.interval);
    clearTimeout(v.uploadTimer);
    v.observer?.disconnect();
    v.pdf?.destroy();
    document.removeEventListener('visibilitychange', v.onVisibility);
    v.resizeObserver.disconnect();
    v.el.remove();
    document.body.classList.remove('lecture-viewer-open');
    if (state.container) openContainer(state.container.id);
  }

  global.LectureNotes = { show };
})(window);
