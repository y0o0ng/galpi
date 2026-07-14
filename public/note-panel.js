'use strict';

(function setupNotePanel(global) {
  const state = {
    initialized: false,
    loaded: false,
    requestId: 0,
    mode: 'list',
    notes: [],
    apiFetch: null,
  };

  const backIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>';

  function elements() {
    return {
      form: document.getElementById('note-panel-search'),
      query: document.getElementById('note-panel-query'),
      content: document.getElementById('note-panel-content'),
    };
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

  function renderList() {
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
  }

  async function loadNotes() {
    const requestId = ++state.requestId;
    renderLoading();
    try {
      const response = await state.apiFetch('/api/vault/notes?limit=100');
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '노트 목록을 불러오지 못했습니다.');
      if (requestId !== state.requestId) return;
      state.notes = (Array.isArray(data.notes) ? data.notes : []).filter(note => note.noteType !== 'paper');
      state.loaded = true;
      renderList();
    } catch (error) {
      if (requestId !== state.requestId) return;
      renderError(error.message, loadNotes);
    }
  }

  async function openNote(note, onBack = renderList) {
    state.mode = 'detail';
    const requestId = ++state.requestId;
    renderLoading();
    try {
      const response = await state.apiFetch(`/api/vault/note/${encodeURIComponent(note.filename)}`);
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '노트를 읽지 못했습니다.');
      if (requestId !== state.requestId || state.mode !== 'detail') return;

      const { content } = elements();
      content.innerHTML = '';
      content.scrollTop = 0;
      content.appendChild(makeSectionHead(noteTypeLabel(note.noteType), null, onBack));
      const article = document.createElement('article');
      article.className = 'knowledge-note-detail';
      article.innerHTML = DOMPurify.sanitize(marked.parse(data.note.content || ''));
      content.appendChild(article);
    } catch (error) {
      if (requestId !== state.requestId) return;
      renderError(error.message, onBack);
    }
  }

  function open(note) {
    if (!note?.filename) return;
    openNote({ ...note, noteType: note.noteType || 'topic' }, loadNotes);
  }

  function show() {
    if (!state.loaded) loadNotes();
  }

  function init({ apiFetch }) {
    if (state.initialized) return;
    state.initialized = true;
    state.apiFetch = apiFetch;
    const el = elements();
    el.form.addEventListener('submit', event => {
      event.preventDefault();
      renderList();
    });
    el.query.addEventListener('input', () => {
      if (state.loaded) renderList();
    });
  }

  global.NotePanel = { init, show, loadNotes, open };
})(window);
