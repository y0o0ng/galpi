'use strict';

// 강의 노트 Document Viewer: 페이지·PDF 렌더·확대·`강의·복습` 모드·마이크·필기 저장과 충돌 처리.
// 설계 정본은 docs/Lecture-note-system_Design_v4.3.md §6·§7·§8, 구현 기록은 §17이다.
(function (global) {
  const { el, svg, api, jsonOptions, Recorder, clock, toast, isRecordingHere, ICON_BACK, ICON_PLUS } = global.LectureCommon;
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

  // playSession·playAt: 강의 카드·`다른 자료`에서 들어오면 그 강의의 해당 위치로 재생 위치를 맞춘다(§12.2).
  async function openViewer(documentId, { newLecture = false, playSession = null, playAt = 0 } = {}) {
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
    v.markers = { add: kind => addMarker(v, kind) };
    v.el = buildViewerShell(v);
    document.body.append(v.el);
    document.body.classList.add('lecture-viewer-open');
    renderLive();
    try {
      const [{ document: doc, container, hiddenSessionIds }, server, draft] = await Promise.all([
        api(`/api/lecture/documents/${documentId}`),
        api(`/api/lecture/documents/${documentId}/annotations`),
        readDraft(documentId),
      ]);
      v.doc = doc;
      v.container = container;
      v.hiddenSessionIds = new Set(hiddenSessionIds || []);
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
    // 포스트잇은 자료 필기에 들어 있어 필기와 함께 저장된다. `시온에게 묻기`는 선택을 붙인 포스트잇을 연다(L3a).
    v.sticky = global.LectureSticky.attach(v);
    v.texts = global.LectureText.attach(v);
    // 포스트잇 시온 Q&A(L3b). 답이 오면 말풍선·열린 카드를 다시 그린다.
    v.qa = global.LectureQa.create(v, { onChange: () => v.sticky.refresh() });
    v.lasso = global.LectureLasso.create(v, { onAsk: (page, selection) => v.sticky.create(page, [selection.bbox[2], selection.bbox[1]], selection) });
    buildPages(v);
    v.qa.load();
    if (v.container?.type === 'course') {
      // `+ 새 강의`로 열었으면 오늘의 기존 Session을 붙이지 않는다. 첫 녹음이 새 Session을 만든다.
      v.session = v.newLecture ? null : await Recorder().todaySession(v.container.id).catch(() => null);
      if (viewer !== v) return;
      if (v.session) logDocumentOpen(v);
      // 녹음 중이거나 오늘 이 과목 Session이 있으면 `강의`, 아니면 `복습`으로 연다(§8.2).
      setMode(v, isRecordingHere(v) || v.session || v.newLecture ? 'lecture' : 'review');
      v.unsubscribe = Recorder().subscribe(() => onRecorderChange(v));
      // 복습 사이드바(L2). 이 자료를 보며 녹음한 강의들을 이어 듣는다.
      v.review = global.LectureReview.attach(v, {
        goToPage: page => v.pages[page - 1]?.el.scrollIntoView({ block: 'start' }),
        openDocumentAt: (documentId, sessionId, t) => {
          closeViewer();
          openViewer(documentId, { playSession: sessionId, playAt: t });
        },
        redrawInk: () => v.pages.forEach(page => { if (page.visible) drawInk(v, page); }),
        onToggle: open => v.sideButton.classList.toggle('active', open),
      });
      v.main.append(v.review.el);
      v.sideButton.hidden = false;
      v.onStrokeTap = stroke => {
        if (!v.review.jump(stroke.source_session_id, stroke.t_ms)) toast('이 획을 쓴 때의 녹음이 없어.');
      };
      await v.review.load();
      if (viewer !== v) return;
      if (playSession) v.review.jump(playSession, playAt);
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
    // Figma `System / Bar_Right`: 복습 사이드바 열기·닫기. 과목 자료에서만 보인다.
    v.sideButton = el('button', 'lecture-side-button');
    v.sideButton.type = 'button';
    v.sideButton.hidden = true;
    v.sideButton.setAttribute('aria-label', '강의 사이드바');
    v.sideButton.append(svg('<svg viewBox="0 0 24 24" width="24" height="24" fill="none"><path d="M15 4L15 20M15 4H7.2002C6.08009 4 5.51962 4 5.0918 4.21799C4.71547 4.40973 4.40973 4.71547 4.21799 5.0918C4 5.51962 4 6.08009 4 7.2002V16.8002C4 17.9203 4 18.4796 4.21799 18.9074C4.40973 19.2837 4.71547 19.5905 5.0918 19.7822C5.51921 20 6.07901 20 7.19694 20L15 20M15 4H16.8002C17.9203 4 18.4796 4 18.9074 4.21799C19.2837 4.40973 19.5905 4.71547 19.7822 5.0918C20 5.5192 20 6.079 20 7.19691L20 16.8031C20 17.921 20 18.48 19.7822 18.9074C19.5905 19.2837 19.2837 19.5905 18.9074 19.7822C18.48 20 17.921 20 16.8031 20H15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'));
    v.sideButton.addEventListener('click', () => {
      if (v.review.isOpen()) v.review.close();
      else v.review.open();
    });
    const tools = el('div', 'lecture-viewer-tools');
    tools.append(v.mic, v.sideButton);
    header.append(left, center, tools);
    v.alert = el('div', 'lecture-alert');
    v.alert.hidden = true;

    v.banner = el('div', 'lecture-conflict');
    v.banner.hidden = true;

    v.scroller = el('div', 'lecture-scroller');
    v.pagesEl = el('div', 'lecture-pages');
    v.scroller.append(v.pagesEl);
    // Pencil은 그리고 손가락은 스크롤한다. Safari는 stylus 터치도 스크롤로 먹으므로 그것만 막는다.
    // 버튼(`시온에게 묻기`·말풍선·포스트잇 카드)과 입력칸(텍스트 상자·포스트잇 타이핑)은 막지 않는다 — 막으면
    // Pencil 탭이 click·포커스가 되지 않는다.
    const stylus = event => !event.target.closest?.('button, input, [contenteditable]') && [...event.touches].some(touch => touch.touchType === 'stylus');
    v.scroller.addEventListener('touchstart', event => {
      if (stylus(event)) event.preventDefault();
      else if (event.touches.length === 2) startPinch(v, event);
    }, { passive: false });
    v.scroller.addEventListener('touchmove', event => {
      if (stylus(event)) event.preventDefault();
      else if (v.pinch && event.touches.length === 2) { event.preventDefault(); movePinch(v, event); }
    }, { passive: false });
    v.scroller.addEventListener('touchend', event => { if (v.pinch && event.touches.length < 2) endPinch(v); });
    v.scroller.addEventListener('touchcancel', () => { if (v.pinch) endPinch(v); });
    v.scroller.addEventListener('scroll', () => requestAnimationFrame(() => updatePageIndicator(v)), { passive: true });

    v.pens = global.LecturePens.buildRail({
      toast,
      onSticky: () => v.sticky?.createAtView(currentPage(v)),
      onText: () => v.texts?.createAtView(currentPage(v)),
      onSelect: on => { if (!on) v.lasso?.clear(); },
    });
    v.rail = v.pens.el;
    v.indicator = el('div', 'lecture-page-pill', '');
    v.main = el('div', 'lecture-viewer-body');
    v.main.append(v.scroller);
    shell.append(header, v.banner, v.alert, v.main, v.rail, v.indicator);

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
    v.sticky.render();
    v.texts.render();
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
    v.sticky.layout();
    v.texts.layout();
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

  // Figma `Record Control`(160:67)의 경로. 마이크는 대기일 때 가운데, 시간·상태 글자가 붙으면 위로 올라간다.
  const MIC_PATHS = y => `<path d="M25 ${10 + y}C25 ${8.34315 + y} 23.6569 ${7 + y} 22 ${7 + y}C20.3431 ${7 + y} 19 ${8.34315 + y} 19 ${10 + y}V${15 + y}C19 ${16.6569 + y} 20.3431 ${18 + y} 22 ${18 + y}C23.6569 ${18 + y} 25 ${16.6569 + y} 25 ${15 + y}V${10 + y}Z" stroke="currentColor" stroke-width="2"/><path d="M28.5 ${15 + y}C28.5 ${16.7239 + y} 27.8152 ${18.3772 + y} 26.5962 ${19.5962 + y}C25.3772 ${20.8152 + y} 23.7239 ${21.5 + y} 22 ${21.5 + y}C20.2761 ${21.5 + y} 18.6228 ${20.8152 + y} 17.4038 ${19.5962 + y}C16.1848 ${18.3772 + y} 15.5 ${16.7239 + y} 15.5 ${15 + y}M22 ${21.5 + y}V${25 + y}" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;
  const RECORDING_PATHS = '<circle cx="22" cy="16" r="10" stroke="currentColor" stroke-width="2"/><rect x="18" y="12" width="8" height="8" rx="2" fill="currentColor"/>';
  const STAR_PATHS = '<path d="M18.0001 14.9167L20.1667 19.3334L25.0834 20.0834L21.5001 23.5001L22.3334 28.3334L18.0001 26.0834L13.6667 28.3334L14.5001 23.5001L10.9167 20.0834L15.8334 19.3334L18.0001 14.9167Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>';
  const LATER_PATHS = '<g transform="translate(-36 0)"><path d="M54 29.5C58.1421 29.5 61.5 26.1421 61.5 22C61.5 17.8579 58.1421 14.5 54 14.5C49.8579 14.5 46.5 17.8579 46.5 22C46.5 26.1421 49.8579 29.5 54 29.5Z" stroke="currentColor" stroke-width="1.5"/><path d="M51.9167 19.9166C51.9181 19.5414 52.0207 19.1734 52.2139 18.8516C52.407 18.5298 52.6835 18.2662 53.0142 18.0886C53.3448 17.911 53.7172 17.826 54.0921 17.8426C54.4671 17.8592 54.8306 17.9768 55.1442 18.1829C55.4578 18.389 55.71 18.676 55.874 19.0135C56.038 19.3511 56.1077 19.7267 56.0759 20.1006C56.0441 20.4746 55.9118 20.833 55.6931 21.138C55.4744 21.4429 55.1774 21.6832 54.8334 21.8333C54.3334 22.0833 54.0001 22.5 54.0001 23.0833V23.6666" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M53.9999 27.0833C54.5062 27.0833 54.9166 26.6729 54.9166 26.1667C54.9166 25.6604 54.5062 25.25 53.9999 25.25C53.4937 25.25 53.0833 25.6604 53.0833 26.1667C53.0833 26.6729 53.4937 27.0833 53.9999 27.0833Z" fill="currentColor"/></g>';
  const iconSvg = (paths, width = 44) => svg(`<svg viewBox="0 0 ${width} 44" width="${width}" height="44" fill="none">${paths}</svg>`);

  function renderMic(v) {
    const recorder = Recorder().state;
    const elsewhere = ['starting', 'recording'].includes(recorder.status) && recorder.containerId !== v.container.id;
    const mine = recorder.containerId === v.container.id;
    const recorded = mine ? Recorder().elapsedMs() : (v.session?.recordedMs || 0);
    // 오늘 녹음이 있으면 초록 마이크와 누적 시간(`State=Paused`), 없으면 회색 마이크(`State=Idle`)다.
    let status = mine ? recorder.status : 'idle';
    if (status === 'idle' && recorded) status = 'paused';
    const button = el('button', `lecture-mic is-${status}`);
    button.type = 'button';
    button.disabled = elsewhere || status === 'starting';
    const label = { idle: '녹음 시작', paused: '이어 녹음', interrupted: '이어 녹음', starting: '녹음 시작 확인 중', recording: '일시정지' }[status];
    button.setAttribute('aria-label', elsewhere ? `${recorder.containerName} 녹음 중` : label);
    button.append(iconSvg(status === 'recording' ? RECORDING_PATHS : MIC_PATHS(status === 'idle' ? 6 : 0)));
    const caption = status === 'starting' ? '시작 중' : status === 'idle' ? '' : clock(recorded);
    button.append(el('span', 'lecture-mic-time', caption));
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
    // 녹음 중에는 녹음 표시 옆에 `★`·`?` 버튼이 보인다 — 원형 메뉴를 몰라도 마커를 남길 수 있다(§6.4).
    if (mine && recorder.status === 'recording') {
      const marker = (kind, paths, text) => {
        const node = el('button', 'lecture-marker');
        node.type = 'button';
        node.setAttribute('aria-label', text);
        node.append(iconSvg(paths, 36));
        node.addEventListener('click', () => addMarker(v, kind));
        return node;
      };
      v.mic.replaceChildren(marker('important', STAR_PATHS, '★ 중요'), marker('later', LATER_PATHS, '? 나중에 볼 것'), el('span', 'lecture-mic-divider'), button);
    } else {
      v.mic.replaceChildren(button);
    }

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

  // ─── 마커(§6.4) ───────────────────────────────────────────────────────────
  // 녹음 중에만 남긴다. 남긴 직후 `★ 중요 · 32:18 · 취소` 알림을 띄우고, 거기서 바로 지울 수 있다.
  const MARKER_TOAST_MS = 4000;
  const markerLabel = { important: '★ 중요', later: '? 나중에 볼 것' };

  function addMarker(v, kind) {
    const session = Recorder().state.session;
    if (!isRecordingHere(v) || !session) return;
    const key = Recorder().addMarker(session, kind, v.documentId, currentPage(v));
    document.querySelector('.lecture-marker-toast')?.remove();
    const note = el('div', 'lecture-marker-toast');
    const cancel = el('button', '', '취소');
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      Recorder().cancelMarker(session, key);
      note.remove();
    });
    note.append(el('span', '', `${markerLabel[kind]} · ${clock(Recorder().elapsedMs())}`), cancel);
    document.body.append(note);
    setTimeout(() => note.remove(), MARKER_TOAST_MS);
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
      v.sticky.render();
      v.texts.render();
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
    v.review?.destroy();
    v.qa?.destroy();
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
