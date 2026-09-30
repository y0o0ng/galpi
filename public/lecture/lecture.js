'use strict';

// 강의 노트 L1a: Notes 홈 · 폴더 홈 · Document Viewer(PDF·백지 + 펜·지우개).
// 설계 정본은 docs/Lecture-note-system_Design_v4.3.md다. 필기 정본은 서버 revision이고
// 기기의 IndexedDB 사본은 업로드 전 작업본이다(§8.1·§8.3).
(function (global) {
  const PDFJS_BASE = '/lib/pdfjs/';
  const BLANK_ASPECT = Math.SQRT2;
  // 지우개 크기 1.0의 반경(페이지 폭 비율). 확대해도 화면에서 같은 크기로 닿게 배율로 나눈다.
  const ERASER_RADIUS = 0.012;
  const MAX_ZOOM = 3;
  // iPad Safari 캔버스 면적 한도(16,777,216)보다 조금 아래. 넘으면 해상도를 낮춰 그린다.
  const MAX_CANVAS_PIXELS = 16000000;
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
  const ICON_MIC = '<svg viewBox="0 0 24 24" width="22" height="22"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const ICON_RECORDING = '<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="5.5" fill="currentColor"/></svg>';

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

  const Recorder = () => global.LectureRecorder;
  function clock(ms) {
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const pad = value => String(value).padStart(2, '0');
    return hours ? `${hours}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}` : `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`;
  }

  function toast(message) {
    const node = el('div', 'lecture-toast', message);
    document.body.append(node);
    setTimeout(() => node.remove(), 3200);
  }

  // ─── Notes 홈 ──────────────────────────────────────────────────────────────

  async function show() {
    Recorder().resume();
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

  const draftStore = async mode => (await global.LectureRecorder.openDb()).transaction('drafts', mode).objectStore('drafts');
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
      zoom: 1, stroke: null, erasing: false,
      uploadTimer: null, draftTimer: null, interval: null,
    };
    viewer = v;
    v.el = buildViewerShell(v);
    document.body.append(v.el);
    document.body.classList.add('lecture-viewer-open');
    renderLive();
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
        // 서버의 최신본을 이 기기가 썼다면(업로드는 도착했는데 응답 전에 앱이 죽은 경우) 작업본이 그 내용을
        // 이미 담고 있으므로 충돌이 아니다. 다른 기기가 쓴 경우만 충돌로 알린다.
        if (draft.baseRevision !== server.revision) {
          if (server.deviceId === deviceId()) v.baseRevision = server.revision;
          else v.conflict = { revision: server.revision, body: server.body };
        }
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
    if (v.container?.type === 'course') {
      v.session = await Recorder().todaySession(v.container.id).catch(() => null);
      if (viewer !== v) return;
      if (v.session) logDocumentOpen(v);
      v.unsubscribe = Recorder().subscribe(() => onRecorderChange(v));
      v.ticker = setInterval(() => {
        const time = v.mic.querySelector('.lecture-mic-time');
        if (time && Recorder().state.status === 'recording' && Recorder().state.containerId === v.container.id) time.textContent = clock(Recorder().elapsedMs());
      }, 1000);
      renderMic(v);
    }
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
    v.mic = el('div', 'lecture-mic-slot');
    header.append(v.back, center, v.mic);
    v.alert = el('div', 'lecture-alert');
    v.alert.hidden = true;

    v.banner = el('div', 'lecture-conflict');
    v.banner.hidden = true;

    v.scroller = el('div', 'lecture-scroller');
    v.pagesEl = el('div', 'lecture-pages');
    v.scroller.append(v.pagesEl);
    // Pencil은 그리고 손가락은 스크롤한다. Safari는 stylus 터치도 스크롤로 먹으므로 그것만 막는다.
    v.scroller.addEventListener('touchstart', event => {
      if ([...event.touches].some(touch => touch.touchType === 'stylus')) event.preventDefault();
      else if (event.touches.length === 2) startPinch(v, event);
    }, { passive: false });
    v.scroller.addEventListener('touchmove', event => {
      if ([...event.touches].some(touch => touch.touchType === 'stylus')) event.preventDefault();
      else if (v.pinch && event.touches.length === 2) { event.preventDefault(); movePinch(v, event); }
    }, { passive: false });
    v.scroller.addEventListener('touchend', event => { if (v.pinch && event.touches.length < 2) endPinch(v); });
    v.scroller.addEventListener('touchcancel', () => { if (v.pinch) endPinch(v); });
    v.scroller.addEventListener('scroll', () => requestAnimationFrame(() => updatePageIndicator(v)), { passive: true });

    v.pens = global.LecturePens.buildRail({ toast });
    v.rail = v.pens.el;
    v.indicator = el('div', 'lecture-page-pill', '');
    shell.append(header, v.banner, v.alert, v.scroller, v.rail, v.indicator);

    v.onVisibility = () => { if (document.visibilityState === 'hidden') flush(v); };
    document.addEventListener('visibilitychange', v.onVisibility);
    // window resize는 iPad 회전 중 레이아웃이 바뀌기 전 폭으로 올 때가 있어 스크롤 영역 자체를 본다.
    v.resizeObserver = new ResizeObserver(() => { if (v.pages.length) layoutPages(v); });
    v.resizeObserver.observe(v.scroller);
    return shell;
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

  function layoutPages(v, keepScroll = false) {
    const width = Math.round(Math.min(v.scroller.clientWidth - 32, 900) * v.zoom);
    if (width === v.pageWidth) return;
    // 폭이 바뀌면 페이지 높이도 바뀌므로, 보던 페이지와 그 안의 비율 위치를 다시 맞춘다.
    const anchor = !keepScroll && v.pageWidth && v.pages.find(page => page.el.offsetTop + page.el.offsetHeight > v.scroller.scrollTop);
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
    const cssArea = v.pageWidth * v.pageWidth * page.aspect;
    const dpr = Math.min(global.devicePixelRatio || 1, 2, Math.sqrt(MAX_CANVAS_PIXELS / cssArea));
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
    if (v.session && v.lastLoggedPage !== current.number) {
      v.lastLoggedPage = current.number;
      Recorder().logEvent(v.session, 'page_change', v.documentId, current.number);
    }
  }

  function currentPage(v) {
    return Number(v.indicator.textContent.split(' / ')[0]) || 1;
  }

  function logDocumentOpen(v) {
    v.lastLoggedPage = currentPage(v);
    Recorder().logEvent(v.session, 'document_open', v.documentId, v.lastLoggedPage);
  }

  // ─── 녹음(L1b) ────────────────────────────────────────────────────────────

  function onRecorderChange(v) {
    const recorder = Recorder().state;
    // 이 뷰어에서 첫 녹음을 시작하면 그때 생긴 Session을 붙이고 자료 열기를 남긴다.
    if (!v.session && recorder.session?.containerId === v.container.id) {
      v.session = recorder.session;
      logDocumentOpen(v);
    }
    renderMic(v);
    renderStatus(v);
  }

  function renderMic(v) {
    const recorder = Recorder().state;
    const elsewhere = ['starting', 'recording'].includes(recorder.status) && recorder.containerId !== v.container.id;
    const mine = recorder.containerId === v.container.id;
    const status = mine ? recorder.status : 'idle';
    const button = el('button', `lecture-mic is-${status}`);
    button.type = 'button';
    button.disabled = elsewhere || status === 'starting';
    const label = { idle: '녹음 시작', paused: '이어 녹음', interrupted: '이어 녹음', starting: '녹음 시작 확인 중', recording: '일시정지' }[status];
    button.setAttribute('aria-label', elsewhere ? `${recorder.containerName} 녹음 중` : label);
    button.append(svg(status === 'recording' ? ICON_RECORDING : ICON_MIC));
    const recorded = mine ? Recorder().elapsedMs() : (v.session?.recordedMs || 0);
    const time = el('span', 'lecture-mic-time', status === 'starting' ? '확인 중' : (recorded || status === 'recording' ? clock(recorded) : ''));
    button.append(time);
    button.addEventListener('click', async () => {
      if (status === 'recording') return Recorder().pause();
      try { await Recorder().start(v.container); } catch (error) { toast(error.message); }
    });
    v.mic.replaceChildren(button);

    v.alert.hidden = !(mine && recorder.status === 'interrupted');
    if (!v.alert.hidden) {
      const resume = el('button', 'lecture-pill');
      resume.type = 'button';
      resume.append(svg(ICON_PLUS), document.createTextNode('이어 녹음하기'));
      resume.addEventListener('click', async () => {
        try { await Recorder().start(v.container); } catch (error) { toast(error.message); }
      });
      const text = el('div');
      text.append(el('strong', '', '녹음이 중단됐어'), el('span', 'lecture-meta', `${clock(recorder.interruptedAtMs || 0)}까지 저장됨 · 그 뒤는 빈 구간으로 남아`));
      v.alert.replaceChildren(el('span', 'lecture-alert-dot'), text, resume);
    }
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
    ctx.globalAlpha = stroke.tool === 'highlighter' ? global.LecturePens.HIGHLIGHT_ALPHA : 1;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = Math.max(stroke.width * scale, 1);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0][0] * scale, points[0][1] * scale, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }
    ctx.beginPath();
    ctx.moveTo(points[0][0] * scale, points[0][1] * scale);
    for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index][0] * scale, points[index][1] * scale);
    ctx.stroke();
    ctx.globalAlpha = 1;
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
      v.pens.close();
      const pen = v.pens.current();
      if (pen.tool === 'eraser') {
        v.erasing = { page, pointerId: event.pointerId, last: pagePoint(page, event), radius: ERASER_RADIUS * pen.width / v.zoom };
        eraseAt(v, page, v.erasing.last, v.erasing.radius);
        return;
      }
      // 형광펜은 따로 겹친 캔버스에 불투명하게 그리고 그 캔버스를 반투명으로 보인다. 조각마다 반투명으로
      // 그리면 이음새가 진해진다. 획이 끝나면 페이지 잉크에 한 경로로 다시 그린다.
      const target = pen.tool === 'highlighter' ? liveCanvas(page) : page.ink;
      v.stroke = {
        page,
        pointerId: event.pointerId,
        data: {
          id: `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          tool: pen.tool,
          color: pen.color,
          width: Math.round(pen.width * global.LecturePens.WIDTH_UNIT * 100000) / 100000,
          points: [pagePoint(page, event)],
          // 오늘 이 과목 Session이 있으면 강의 필기다. 녹음이 멈춘 동안의 획도 Session 시각은 갖되
          // 오디오 위치는 recording_span 밖이라 없다(§8.2). `강의·복습` 토글은 아직 없다.
          source_session_id: v.session?.id ?? null,
          t_ms: v.session ? Recorder().sessionT(v.session, event.timeStamp) : null,
          created_at: Date.now(),
        },
      };
      v.stroke.target = target;
      drawStroke(target.getContext('2d'), { ...v.stroke.data, tool: 'pen' }, target.width);
    });
    page.ink.addEventListener('pointermove', event => {
      if (v.erasing?.pointerId === event.pointerId) {
        // 이벤트 사이도 훑는다. 빠르게 문지르면 두 이벤트 사이에 있는 획을 건너뛴다.
        (event.getCoalescedEvents?.() || [event]).forEach(item => {
          const to = pagePoint(page, item);
          const from = v.erasing.last;
          const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / (v.erasing.radius / 2)));
          for (let step = 1; step <= steps; step += 1) {
            eraseAt(v, page, [from[0] + (to[0] - from[0]) * step / steps, from[1] + (to[1] - from[1]) * step / steps], v.erasing.radius);
          }
          v.erasing.last = to;
        });
        return;
      }
      const active = v.stroke;
      if (!active || active.pointerId !== event.pointerId) return;
      const ctx = active.target.getContext('2d');
      const scale = active.target.width;
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
      if (active.target !== page.ink) {
        active.target.remove();
        drawInk(v, page);
      }
      markChanged(v);
    };
    page.ink.addEventListener('pointerup', end);
    page.ink.addEventListener('pointercancel', end);
  }

  function liveCanvas(page) {
    const canvas = el('canvas', 'lecture-page-live');
    canvas.width = page.ink.width;
    canvas.height = page.ink.height;
    canvas.style.opacity = String(global.LecturePens.HIGHLIGHT_ALPHA);
    page.el.append(canvas);
    return canvas;
  }

  // ─── 확대·축소 ────────────────────────────────────────────────────────────
  // 두 손가락 사이 지점을 기준으로 1~3배. 움직이는 동안은 CSS transform으로만 보이고,
  // 손을 떼면 페이지 폭을 실제로 바꿔 다시 그린다. 필기 좌표는 페이지 비율이라 그대로 맞는다.

  function pinchState(event, scroller) {
    const [a, b] = event.touches;
    const box = scroller.getBoundingClientRect();
    return {
      distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      x: (a.clientX + b.clientX) / 2 - box.left,
      y: (a.clientY + b.clientY) / 2 - box.top,
    };
  }

  function startPinch(v, event) {
    if (!v.pages.length || v.stroke) return;
    const start = pinchState(event, v.scroller);
    v.pinch = { start, scale: 1, current: start, originX: v.scroller.scrollLeft + start.x, originY: v.scroller.scrollTop + start.y };
    v.pagesEl.style.transformOrigin = `${v.pinch.originX}px ${v.pinch.originY}px`;
  }

  function movePinch(v, event) {
    const now = pinchState(event, v.scroller);
    const pinch = v.pinch;
    pinch.scale = Math.max(1 / v.zoom, Math.min(MAX_ZOOM / v.zoom, now.distance / pinch.start.distance));
    pinch.current = now;
    v.pagesEl.style.transform = `translate(${now.x - pinch.start.x}px, ${now.y - pinch.start.y}px) scale(${pinch.scale})`;
  }

  function endPinch(v) {
    const pinch = v.pinch;
    v.pinch = null;
    v.pagesEl.style.transform = '';
    v.pagesEl.style.transformOrigin = '';
    const zoom = Math.max(1, Math.min(MAX_ZOOM, v.zoom * pinch.scale));
    if (Math.abs(zoom - v.zoom) < 0.01) return;
    const factor = zoom / v.zoom;
    v.zoom = zoom;
    layoutPages(v, true);
    // 손가락 사이에 있던 내용이 손을 뗀 자리에 오게 스크롤을 맞춘다.
    v.scroller.scrollLeft = pinch.originX * factor - pinch.current.x;
    v.scroller.scrollTop = pinch.originY * factor - pinch.current.y;
  }

  function segmentDistance(point, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length)) : 0;
    return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
  }

  // 획 지우개다. 닿은 획을 통째로 지운다.
  // 획의 두께도 닿는 범위다. 굵은 형광펜은 가장자리를 문질러도 지워진다.
  function eraseAt(v, page, point, radius) {
    const strokes = v.body.pages[page.number];
    if (!strokes?.length) return;
    const kept = strokes.filter(stroke => !stroke.points.some((current, index) => {
      const previous = stroke.points[index - 1] || current;
      return segmentDistance(point, previous, current) <= radius + stroke.width / 2;
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
      if (res.status === 409 && result.deviceId === deviceId()) {
        // 앞선 업로드가 도착했는데 응답만 잃은 경우다. 이 기기 작업본이 그 위에 있으므로 다음 업로드로 잇는다.
        v.baseRevision = result.revision;
      } else if (res.status === 409) {
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
    const audio = { pending: '녹음 기기에 보관 중', uploading: '녹음 올리는 중…', failed: '녹음 전송 실패 · 기기에 보관 중' }[Recorder().state.upload];
    v.status.textContent = [pages, status, audio].filter(Boolean).join(' · ');
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
    clearInterval(v.ticker);
    v.unsubscribe?.();
    clearTimeout(v.uploadTimer);
    v.observer?.disconnect();
    v.pdf?.destroy();
    document.removeEventListener('visibilitychange', v.onVisibility);
    v.resizeObserver.disconnect();
    v.el.remove();
    document.body.classList.remove('lecture-viewer-open');
    renderLive();
    if (state.container) openContainer(state.container.id);
  }

  // 뷰어 밖(폴더·다른 탭)에서도 녹음 상태를 보이고 멈출 수 있게 한다. 모르는 채 녹음이 이어지면 안 된다.
  function renderLive() {
    const recorder = Recorder().state;
    let live = document.getElementById('lecture-live');
    const visible = !viewer && ['starting', 'recording', 'interrupted'].includes(recorder.status);
    if (!visible) { live?.remove(); return; }
    if (!live) {
      live = el('button', 'lecture-live');
      live.id = 'lecture-live';
      live.type = 'button';
      live.addEventListener('click', async () => {
        const current = Recorder().state;
        if (current.status === 'recording') return Recorder().pause();
        if (current.status === 'interrupted') {
          try { await Recorder().start({ id: current.containerId, name: current.containerName }); } catch (error) { toast(error.message); }
        }
      });
      document.body.append(live);
    }
    live.className = `lecture-live is-${recorder.status}`;
    const text = { starting: '녹음 시작 확인 중', recording: `녹음 중 · ${recorder.containerName} · ${clock(Recorder().elapsedMs())} · 눌러서 일시정지`, interrupted: `녹음이 중단됐어 · ${recorder.containerName} · 눌러서 이어 녹음` }[recorder.status];
    live.replaceChildren(el('span', 'lecture-alert-dot'), document.createTextNode(text));
  }
  if (global.LectureRecorder) {
    global.LectureRecorder.subscribe(renderLive);
    setInterval(() => { if (Recorder().state.status === 'recording') renderLive(); }, 1000);
  }

  global.LectureNotes = { show };
})(window);
