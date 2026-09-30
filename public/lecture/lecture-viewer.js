'use strict';

// 강의 노트 Document Viewer: 페이지·PDF 렌더·확대·`강의·복습` 모드·마이크·필기 저장과 충돌 처리.
// 설계 정본은 docs/Lecture-note-system_Design_v4.3.md §6·§7·§8, 구현 기록은 §17이다.
(function (global) {
  const { el, svg, api, jsonOptions, Recorder, clock, toast, isRecordingHere, ICON_BACK, ICON_PLUS, ICON_MIC, ICON_RECORDING } = global.LectureCommon;
  const { bindInk, drawInk } = global.LectureInk;

  const PDFJS_BASE = '/lib/pdfjs/';
  const BLANK_ASPECT = Math.SQRT2;
  const MAX_ZOOM = 3;
  // iPad Safari 캔버스 면적 한도(16,777,216)보다 조금 아래. 넘으면 해상도를 낮춰 그린다.
  const MAX_CANVAS_PIXELS = 16000000;
  const UPLOAD_DELAY_MS = 2000;
  const UPLOAD_INTERVAL_MS = 20000;

  let viewer = null;

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

  async function openViewer(documentId, { newLecture = false } = {}) {
    if (viewer) return;
    const v = {
      documentId, newLecture, doc: null, container: null, pdf: null, sizes: [], pages: [],
      body: { pages: {} }, baseRevision: 0, dirty: false, changeSeq: 0,
      uploading: false, conflict: null, offline: false,
      zoom: 1, stroke: null, erasing: false,
      uploadTimer: null, draftTimer: null, interval: null,
    };
    viewer = v;
    v.changed = () => markChanged(v);
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
      // `+ 새 강의`로 열었으면 오늘의 기존 Session을 붙이지 않는다. 첫 녹음이 새 Session을 만든다.
      v.session = v.newLecture ? null : await Recorder().todaySession(v.container.id).catch(() => null);
      if (viewer !== v) return;
      if (v.session) logDocumentOpen(v);
      // 녹음 중이거나 오늘 이 과목 Session이 있으면 `강의`, 아니면 `복습`으로 연다(§8.2).
      setMode(v, isRecordingHere(v) || v.session || v.newLecture ? 'lecture' : 'review');
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
    v.modeToggle = el('div', 'lecture-mode');
    v.modeToggle.hidden = true;
    const left = el('div', 'lecture-viewer-left');
    left.append(v.back, v.modeToggle);
    header.append(left, center, v.mic);
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


  // `강의·복습` 토글. 새 흔적의 소속을 정하고 녹음 중에는 `강의`로 잠긴다(§8.2). 일반 폴더에는 없다.
  function setMode(v, mode) {
    v.mode = mode;
    v.pens.setMode(mode);
    renderModeToggle(v);
  }

  function renderModeToggle(v) {
    const locked = isRecordingHere(v);
    v.modeToggle.hidden = false;
    v.modeToggle.classList.toggle('is-locked', locked);
    v.modeToggle.replaceChildren(...[['lecture', '강의'], ['review', '복습']].map(([mode, label]) => {
      const button = el('button', mode === v.mode ? 'active' : '');
      button.type = 'button';
      button.disabled = locked && mode !== 'lecture';
      button.setAttribute('aria-pressed', String(mode === v.mode));
      if (mode === 'review') button.append(el('span', 'lecture-mode-dot'));
      button.append(document.createTextNode(label));
      button.addEventListener('click', () => { if (!locked && mode !== v.mode) setMode(v, mode); });
      return button;
    }));
    if (locked) v.modeToggle.title = '녹음 중에는 강의 필기로 고정돼';
    else v.modeToggle.removeAttribute('title');
  }

  function onRecorderChange(v) {
    const recorder = Recorder().state;
    if (isRecordingHere(v) && v.mode !== 'lecture') setMode(v, 'lecture');
    else renderModeToggle(v);
    // 이 뷰어에서 첫 녹음을 시작하면 그때 생긴 Session을 붙이고 자료 열기를 남긴다.
    if (!v.session && !v.newLecture && recorder.session?.containerId === v.container.id) {
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
      try {
        await Recorder().start(v.container, { forceNew: v.newLecture });
        if (v.newLecture) {
          v.newLecture = false;
          v.session = Recorder().state.session;
          logDocumentOpen(v);
        }
      } catch (error) { toast(error.message); }
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
    global.LectureNotes.refresh();
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
  global.LectureViewer = { open: openViewer, isOpen: () => Boolean(viewer) };
})(window);
