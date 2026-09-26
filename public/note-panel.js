'use strict';

(function setupNotePanel(global) {
  const state = {
    initialized: false,
    loaded: false,
    requestId: 0,
    mode: 'list',
    listScrollTop: 0,
    pendingOpen: null,
    notes: [],
    apiFetch: null,
    contextNotes: null,
  };

  const backIcon = '<img src="assets/figma/left.svg" width="16" height="16" alt="" aria-hidden="true">';

  function elements() {
    return {
      form: document.getElementById('note-panel-search'),
      query: document.getElementById('note-panel-query'),
      content: document.getElementById('note-panel-content'),
    };
  }

  function splitDetail() {
    return document.getElementById('note-panel')?.closest('.home-card-notes.focused')
      && matchMedia('(min-width: 641px)').matches
      ? document.getElementById('home-note-detail') : null;
  }

  function formatUpdatedAt(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    return new Intl.DateTimeFormat('ko-KR', {
      month: 'short',
      day: 'numeric',
    }).format(new Date(seconds * 1000));
  }

  function noteTypeLabel(noteType) {
    const labels = {
      topic: '토픽',
      highlight: '하이라이트',
      single_manual: '수동 저장',
      council: '의회',
      user_manual: '사용자 노트',
      legacy: '이전 노트',
    };
    return labels[noteType] || '노트';
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
      back.title = '노트 목록으로 돌아가기';
      back.setAttribute('aria-label', '노트 목록으로 돌아가기');
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

  function renderLoading() {
    const { content } = elements();
    content.innerHTML = '';
    content.scrollTop = 0;
    content.appendChild(makeSectionHead('최근 노트'));
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
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '다시 시도';
    button.addEventListener('click', retry);
    wrap.append(text, button);
    content.appendChild(wrap);
  }

  function makeNoteCard(note) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'note-library-card';

    const meta = document.createElement('span');
    meta.className = 'paper-library-meta';
    meta.textContent = [noteTypeLabel(note.noteType), formatUpdatedAt(note.updatedAt)].filter(Boolean).join(' · ');

    const title = document.createElement('strong');
    title.textContent = note.title || note.filename;

    card.append(meta, title);
    card.addEventListener('click', () => openNote(note));
    return card;
  }

  function renderList(restore = false) {
    state.mode = 'list';
    const query = elements().query.value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('ko-KR');
    const notes = query
      ? state.notes.filter(note => String(note.title || '').toLocaleLowerCase('ko-KR').includes(query))
      : state.notes;
    const { content } = elements();
    content.innerHTML = '';
    content.scrollTop = 0;
    content.appendChild(makeSectionHead(query ? '검색 결과' : '최근 노트', notes.length));

    if (notes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'panel-empty-state';
      empty.textContent = query ? '검색 결과 없음' : '저장된 노트 없음';
      content.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'paper-panel-list';
    notes.forEach(note => list.appendChild(makeNoteCard(note)));
    content.appendChild(list);
    if (restore === true) content.scrollTop = state.listScrollTop;
  }

  async function loadNotes() {
    const requestId = ++state.requestId;
    renderLoading();
    try {
      const response = await state.apiFetch('/api/vault/notes?excludeNoteType=paper&limit=100');
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '노트 목록을 불러오지 못했습니다.');
      if (requestId !== state.requestId) return;
      state.notes = Array.isArray(data.notes) ? data.notes : [];
      state.loaded = true;
      renderList();
      const requested = state.pendingOpen;
      state.pendingOpen = null;
      if (requested) void openNote(requested);
      else if (splitDetail() && state.notes[0]) void openNote(state.notes[0]);
    } catch (error) {
      if (requestId !== state.requestId) return;
      renderError(error.message, loadNotes);
    }
  }

  async function openNote(note, onBack = () => renderList(true)) {
    state.mode = 'detail';
    const requestId = ++state.requestId;
    const detail = splitDetail();
    if (!detail) state.listScrollTop = elements().content.scrollTop;
    if (detail) detail.textContent = '노트를 읽는 중이야…';
    else renderLoading();
    try {
      const response = await state.apiFetch(`/api/vault/note/${encodeURIComponent(note.filename)}`);
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '노트를 읽지 못했습니다.');
      if (requestId !== state.requestId || state.mode !== 'detail') return;

      const content = detail || elements().content;
      content.innerHTML = '';
      content.scrollTop = 0;
      content.appendChild(makeSectionHead(noteTypeLabel(note.noteType), null, detail ? null : onBack));
      const actions = document.createElement('div');
      actions.className = 'paper-panel-actions';
      actions.appendChild(state.contextNotes.makeToggle({
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
      if (detail) detail.textContent = error.message;
      else renderError(error.message, onBack);
    }
  }

  function open(note) {
    if (!note?.filename) return;
    openNote({ ...note, noteType: note.noteType || 'topic' }, loadNotes);
  }

  function queueOpen(note) {
    state.pendingOpen = note?.filename ? note : null;
  }

  function show() {
    loadNotes();
  }

  function init({ apiFetch, contextNotes }) {
    if (state.initialized) return;
    const el = elements();
    if (
      typeof apiFetch !== 'function'
      || typeof contextNotes?.makeToggle !== 'function'
      || !el.form
      || !el.query
      || !el.content
    ) {
      throw new Error('노트 패널 필수 요소를 찾지 못했습니다.');
    }
    state.apiFetch = apiFetch;
    state.contextNotes = contextNotes;
    el.form.addEventListener('submit', event => {
      event.preventDefault();
      renderList();
    });
    el.query.addEventListener('input', () => {
      if (state.loaded) renderList();
    });
    state.initialized = true;
  }

  global.NotePanel = { init, show, loadNotes, open, queueOpen, noteTypeLabel, formatUpdatedAt };
})(window);
