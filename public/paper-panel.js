'use strict';

(function setupPaperPanel(global) {
  const state = {
    initialized: false,
    requestId: 0,
    mode: 'saved',
    apiFetch: null,
    showToast: null,
    icons: null,
    contextNotes: null,
    activeTab: 'notes',
  };

  const backIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>';

  function normalizeExternalUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
    } catch {
      return '';
    }
  }

  function arxivPdfUrl(value) {
    const id = String(value || '').trim();
    if (!id || !/^[a-z0-9._/-]+$/i.test(id)) return '';
    return `https://arxiv.org/pdf/${id.split('/').map(encodeURIComponent).join('/')}`;
  }

  function paperFullTextUrl(paper) {
    return normalizeExternalUrl(paper?.openAccessPdfUrl) || arxivPdfUrl(paper?.arxivId);
  }

  function makeExternalLink(url, label) {
    const link = document.createElement('a');
    link.className = 'paper-external-link';
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = `${label} ↗`;
    return link;
  }

  function makePaperActions(fullTextUrl, sourceUrl = '') {
    const actions = document.createElement('div');
    actions.className = 'paper-panel-actions';
    if (fullTextUrl) actions.appendChild(makeExternalLink(fullTextUrl, '원문 PDF'));
    if (sourceUrl && sourceUrl !== fullTextUrl) actions.appendChild(makeExternalLink(sourceUrl, '논문 페이지'));
    return actions;
  }

  function elements() {
    return {
      panel: document.getElementById('knowledge-panel'),
      backdrop: document.getElementById('knowledge-panel-backdrop'),
      toggle: document.getElementById('knowledge-panel-toggle'),
      close: document.getElementById('knowledge-panel-close'),
      tabs: [...document.querySelectorAll('[data-panel-tab]')],
      notes: document.getElementById('note-panel'),
      agents: document.getElementById('agent-panel'),
      papers: document.getElementById('paper-panel'),
      form: document.getElementById('paper-panel-search'),
      query: document.getElementById('paper-panel-query'),
      content: document.getElementById('paper-panel-content'),
    };
  }

  function open(tab = state.activeTab) {
    const el = elements();
    setTab(tab);
    el.panel.classList.add('open');
    el.backdrop.hidden = false;
    el.toggle.setAttribute('aria-expanded', 'true');
    document.body.classList.add('knowledge-panel-open');
  }

  function close() {
    const el = elements();
    el.panel.classList.remove('open');
    el.backdrop.hidden = true;
    el.toggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('knowledge-panel-open');
  }

  function setTab(tab) {
    const el = elements();
    state.activeTab = tab;
    el.tabs.forEach(button => {
      const active = button.dataset.panelTab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    el.notes.hidden = tab !== 'notes';
    el.agents.hidden = tab !== 'agents';
    el.papers.hidden = tab !== 'papers';
    if (tab === 'notes') global.NotePanel?.show();
  }

  function makeSectionHead(title, count, onBack) {
    const head = document.createElement('div');
    head.className = 'paper-panel-section-head';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'paper-panel-section-title';
    if (onBack) {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'paper-panel-back';
      back.title = '저장된 논문으로 돌아가기';
      back.setAttribute('aria-label', '저장된 논문으로 돌아가기');
      back.innerHTML = backIcon;
      back.addEventListener('click', onBack);
      titleWrap.appendChild(back);
    }

    const label = document.createElement('strong');
    label.textContent = title;
    titleWrap.appendChild(label);
    head.appendChild(titleWrap);

    if (Number.isInteger(count)) {
      const countEl = document.createElement('span');
      countEl.textContent = String(count);
      head.appendChild(countEl);
    }
    return head;
  }

  function renderLoading(title) {
    const { content } = elements();
    content.innerHTML = '';
    content.scrollTop = 0;
    content.appendChild(makeSectionHead(title));
    const skeleton = document.createElement('div');
    skeleton.className = 'paper-panel-skeleton';
    skeleton.innerHTML = '<span></span><span></span><span></span>';
    content.appendChild(skeleton);
  }

  function renderError(message, retry) {
    const { content } = elements();
    content.innerHTML = '';
    content.scrollTop = 0;
    const wrap = document.createElement('div');
    wrap.className = 'panel-empty-state panel-error-state';
    const text = document.createElement('p');
    text.textContent = message;
    wrap.appendChild(text);
    if (retry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '다시 시도';
      button.addEventListener('click', retry);
      wrap.appendChild(button);
    }
    content.appendChild(wrap);
  }

  function formatUpdatedAt(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    return new Intl.DateTimeFormat('ko-KR', {
      month: 'short',
      day: 'numeric',
    }).format(new Date(seconds * 1000));
  }

  function codexStatusLabel(status) {
    if (status === 'processed') return '정리됨';
    if (status === 'running') return '정리 중';
    if (status === 'queued') return '정리 대기';
    if (status === 'recovery_required') return '원본 복구 필요';
    if (status === 'failed' || status === 'needs_manual_check') return '확인 필요';
    return '정리 대기';
  }

  function makeSavedPaperCard(note) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'paper-library-card';

    const meta = document.createElement('span');
    meta.className = 'paper-library-meta';
    meta.textContent = [formatUpdatedAt(note.updatedAt), codexStatusLabel(note.codexStatus)].filter(Boolean).join(' · ');

    const title = document.createElement('strong');
    title.textContent = note.title;

    card.append(meta, title);
    card.addEventListener('click', () => openSavedPaper(note));
    return card;
  }

  async function loadSavedPapers() {
    state.mode = 'saved';
    const requestId = ++state.requestId;
    elements().query.value = '';
    renderLoading('저장된 논문');
    try {
      const response = await state.apiFetch('/api/vault/notes?noteType=paper&limit=100');
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '논문 목록을 불러오지 못했습니다.');
      if (requestId !== state.requestId || state.mode !== 'saved') return;

      const notes = Array.isArray(data.notes) ? data.notes : [];
      const { content } = elements();
      content.innerHTML = '';
      content.scrollTop = 0;
      content.appendChild(makeSectionHead('저장된 논문', notes.length));
      if (notes.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'panel-empty-state';
        empty.textContent = '저장된 논문 없음';
        content.appendChild(empty);
        return;
      }

      const list = document.createElement('div');
      list.className = 'paper-panel-list';
      notes.forEach(note => list.appendChild(makeSavedPaperCard(note)));
      content.appendChild(list);
    } catch (error) {
      if (requestId !== state.requestId) return;
      renderError(error.message, loadSavedPapers);
    }
  }

  async function openSavedPaper(note) {
    state.mode = 'detail';
    const requestId = ++state.requestId;
    renderLoading('논문');
    try {
      const response = await state.apiFetch(`/api/vault/note/${encodeURIComponent(note.filename)}`);
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '논문을 읽지 못했습니다.');
      if (requestId !== state.requestId || state.mode !== 'detail') return;

      const { content } = elements();
      content.innerHTML = '';
      content.scrollTop = 0;
      content.appendChild(makeSectionHead('논문', null, loadSavedPapers));

      const metadata = data.note.metadata || {};
      const fullTextUrl = normalizeExternalUrl(metadata.open_access_pdf_url) || arxivPdfUrl(metadata.arxiv_id);
      const sourceUrl = normalizeExternalUrl(metadata.url);
      const actions = makePaperActions(fullTextUrl, sourceUrl);
      actions.prepend(state.contextNotes.makeToggle({
        filename: note.filename,
        title: data.note.title || note.title || note.filename,
      }));
      content.appendChild(actions);

      const article = document.createElement('article');
      article.className = 'knowledge-note-detail';
      article.innerHTML = DOMPurify.sanitize(marked.parse(data.note.content || ''));
      content.appendChild(article);
    } catch (error) {
      if (requestId !== state.requestId) return;
      renderError(error.message, loadSavedPapers);
    }
  }

  function formatAuthors(authors) {
    if (!Array.isArray(authors) || authors.length === 0) return '저자 정보 없음';
    if (authors.length <= 3) return authors.join(', ');
    return `${authors.slice(0, 3).join(', ')} 외 ${authors.length - 3}명`;
  }

  function markSaved(button) {
    button.disabled = true;
    button.innerHTML = state.icons.check();
    button.title = '저장됨';
    button.setAttribute('aria-label', '저장됨');
    button.classList.remove('error');
    button.classList.add('saved');
  }

  async function savePaper(button, paper) {
    button.disabled = true;
    button.innerHTML = state.icons.loading();
    try {
      const response = await state.apiFetch('/api/papers/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paper }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '논문 저장에 실패했습니다.');
      paper.saved = true;
      markSaved(button);
      state.showToast(data.duplicate ? `이미 저장된 논문이야: ${data.title}` : `논문 저장됨: ${data.title}`);
    } catch (error) {
      button.disabled = false;
      button.innerHTML = state.icons.save();
      button.title = '다시 시도';
      button.setAttribute('aria-label', '다시 시도');
      button.classList.add('error');
      state.showToast(`오류: ${error.message}`);
    }
  }

  function makeSearchResultCard(paper) {
    const card = document.createElement('article');
    card.className = 'paper-panel-result';

    const top = document.createElement('div');
    top.className = 'paper-panel-result-top';
    const meta = document.createElement('span');
    const year = Number.isInteger(paper.year) ? paper.year : '연도 미상';
    const citations = Number(paper.citationCount || 0).toLocaleString('ko-KR');
    meta.textContent = `${year} · 인용 ${citations}`;

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'save-btn icon-save-btn panel-paper-save';
    save.title = '논문 노트로 저장';
    save.setAttribute('aria-label', '논문 노트로 저장');
    save.innerHTML = state.icons.save();
    if (paper.saved) markSaved(save);
    else save.addEventListener('click', () => savePaper(save, paper));
    top.append(meta, save);

    const title = document.createElement('a');
    title.className = 'paper-panel-result-title';
    title.href = paper.url;
    title.target = '_blank';
    title.rel = 'noopener noreferrer';
    title.textContent = paper.title;

    const authors = document.createElement('div');
    authors.className = 'paper-panel-result-authors';
    authors.textContent = formatAuthors(paper.authors);

    card.append(top, title, authors);
    const summaryText = paper.tldr || paper.abstract;
    if (summaryText) {
      const summary = document.createElement('p');
      summary.textContent = summaryText;
      card.appendChild(summary);
    }
    const fullTextUrl = paperFullTextUrl(paper);
    if (fullTextUrl) card.appendChild(makePaperActions(fullTextUrl));
    return card;
  }

  async function search(query) {
    const cleanQuery = String(query || '').replace(/\s+/g, ' ').trim();
    if (!cleanQuery) {
      await loadSavedPapers();
      return;
    }

    open('papers');
    const el = elements();
    el.query.value = cleanQuery;
    state.mode = 'search';
    const requestId = ++state.requestId;
    renderLoading('검색 결과');
    try {
      const response = await state.apiFetch(`/api/papers/search?q=${encodeURIComponent(cleanQuery)}`);
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '논문 검색에 실패했습니다.');
      if (requestId !== state.requestId || state.mode !== 'search') return;

      const papers = Array.isArray(data.results) ? data.results : [];
      const { content } = elements();
      content.innerHTML = '';
      content.scrollTop = 0;
      content.appendChild(makeSectionHead('검색 결과', papers.length, loadSavedPapers));
      if (papers.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'panel-empty-state';
        empty.textContent = '검색 결과 없음';
        content.appendChild(empty);
        return;
      }

      const list = document.createElement('div');
      list.className = 'paper-panel-list';
      papers.forEach(paper => list.appendChild(makeSearchResultCard(paper)));
      content.appendChild(list);
    } catch (error) {
      if (requestId !== state.requestId) return;
      renderError(error.message, () => search(cleanQuery));
    }
  }

  function init({ apiFetch, showToast, icons, contextNotes }) {
    if (state.initialized) return;
    const el = elements();
    const required = [
      el.panel, el.backdrop, el.toggle, el.close, el.notes, el.agents,
      el.papers, el.form, el.query, el.content,
    ];
    if (
      typeof apiFetch !== 'function'
      || typeof showToast !== 'function'
      || typeof contextNotes?.makeToggle !== 'function'
      || !icons?.save || !icons?.check || !icons?.loading
      || required.some(item => !item)
      || el.tabs.length === 0
    ) {
      throw new Error('논문 패널 필수 요소를 찾지 못했습니다.');
    }

    global.NotePanel?.init({ apiFetch, contextNotes });
    state.apiFetch = apiFetch;
    state.showToast = showToast;
    state.icons = icons;
    state.contextNotes = contextNotes;
    el.toggle.addEventListener('click', () => {
      if (el.panel.classList.contains('open')) close();
      else open();
    });
    el.close.addEventListener('click', close);
    el.backdrop.addEventListener('click', close);
    el.tabs.forEach(button => button.addEventListener('click', () => setTab(button.dataset.panelTab)));
    el.form.addEventListener('submit', event => {
      event.preventDefault();
      search(el.query.value);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && el.panel.classList.contains('open')) close();
    });

    state.initialized = true;
    loadSavedPapers();
    setTab('notes');
  }

  global.PaperPanel = { init, open, close, search, loadSavedPapers };
})(window);
