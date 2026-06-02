'use strict';

const sessionId = (() => {
  const stored = localStorage.getItem('councilSessionId');
  if (stored) return stored;
  const newId = crypto.randomUUID();
  localStorage.setItem('councilSessionId', newId);
  return newId;
})();
let currentModel     = 'claude';
let isLoading        = false;
let councilMode      = false;
let councilAvailable = false;
let councilDraftMode = 'compressed'; // 'compressed' | 'full' | 'deep'
let activeNotes     = [];            // 활성 참조 노트 목록

// ─── 초기화 ──────────────────────────────────────────────────────────────────

async function init() {
  showWelcome();

  try {
    const config = await fetch('/api/config').then(r => r.json());
    document.getElementById('model-indicator').textContent =
      `Claude: ${config.claudeModel}  |  GPT: ${config.gptModel}`;

    if (!config.hasClaude) {
      const btn = document.querySelector('[data-model="claude"]');
      btn.disabled = true;
      btn.title = 'ANTHROPIC_API_KEY가 .env에 없습니다';
      btn.style.opacity = '0.4';
      btn.style.cursor = 'not-allowed';
      if (currentModel === 'claude') selectModel('gpt');
    }
    if (!config.hasGpt) {
      const btn = document.querySelector('[data-model="gpt"]');
      btn.disabled = true;
      btn.title = 'OPENAI_API_KEY가 .env에 없습니다';
      btn.style.opacity = '0.4';
      btn.style.cursor = 'not-allowed';
      if (currentModel === 'gpt') selectModel('claude');
    }

    const councilBtn = document.querySelector('.council-btn');
    if (config.hasClaude && config.hasGpt) {
      councilAvailable = true;
      councilBtn.classList.remove('disabled');
      councilBtn.title = '의회 모드';
      councilBtn.addEventListener('click', toggleCouncil);
    } else {
      councilBtn.title = 'Claude와 GPT 키가 모두 필요합니다';
    }
  } catch (_) {
    appendError('서버에 연결할 수 없습니다. node server.js가 실행 중인지 확인해주세요.');
  }

  document.querySelectorAll('.model-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (councilMode) return;
      selectModel(btn.dataset.model);
    });
  });

  // 의회 답변 방식 토글: 빠름(compressed) / 기본(full) / 심층(deep)
  document.querySelectorAll('.mode-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      councilDraftMode = btn.dataset.mode;
      document.querySelectorAll('.mode-opt').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === councilDraftMode);
      });
    });
  });

  document.getElementById('send-btn').addEventListener('click', sendMessage);

  document.getElementById('input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  document.getElementById('input').addEventListener('input', autoResize);

  await loadHistory();
}

// ─── 히스토리 복원 ───────────────────────────────────────────────────────────

async function loadHistory() {
  try {
    const res = await fetch(`/api/sessions/${sessionId}`);
    if (!res.ok) return;
    const { messages } = await res.json();
    if (!messages || messages.length === 0) return;

    document.querySelector('.welcome')?.remove();
    messages.forEach(msg => {
      if (msg.role === 'user') {
        appendUserBubble(msg.content);
      } else {
        appendHistoryBubble(msg.content, msg.model);
      }
    });
  } catch (_) {}
}

function appendHistoryBubble(content, model) {
  const group = document.createElement('div');
  group.className = 'msg-group assistant';

  const label = document.createElement('div');
  label.className = 'model-label';
  label.textContent = model || 'AI';

  const bubble = document.createElement('div');
  bubble.className = 'bubble md';
  bubble.innerHTML = DOMPurify.sanitize(marked.parse(content));

  group.append(label, bubble);
  getMessages().appendChild(group);
  scrollDown();
}

// ─── 모델 선택 ────────────────────────────────────────────────────────────────

function selectModel(model) {
  currentModel = model;
  document.querySelectorAll('.model-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.model === model);
  });
}

function toggleCouncil() {
  if (!councilAvailable) return;
  councilMode = !councilMode;
  document.querySelector('.council-btn').classList.toggle('active', councilMode);
  document.querySelectorAll('.model-btn').forEach(b => {
    if (!b.disabled) {
      b.style.opacity       = councilMode ? '0.4' : '';
      b.style.pointerEvents = councilMode ? 'none' : '';
    }
  });
}

// ─── 메시지 전송 디스패처 ────────────────────────────────────────────────────

function sendMessage() {
  const inputEl = document.getElementById('input');
  const text = inputEl.value.trim();
  if (text === '/memory' || text.startsWith('/memory ')) {
    inputEl.value = '';
    inputEl.style.height = 'auto';
    handleMemoryCommand(text);
    return;
  }
  if (text.startsWith('/search ')) {
    const query = text.slice(8).trim();
    inputEl.value = '';
    inputEl.style.height = 'auto';
    if (query) handleSearch(query);
    return;
  }
  if (councilMode) sendCouncilMessage();
  else sendSingleMessage();
}

// ─── 단일 모드 ────────────────────────────────────────────────────────────────

async function sendSingleMessage() {
  if (isLoading) return;
  const inputEl = document.getElementById('input');
  const text = inputEl.value.trim();
  if (!text) return;

  inputEl.value = '';
  inputEl.style.height = 'auto';
  isLoading = true;
  document.getElementById('send-btn').disabled = true;
  document.querySelector('.welcome')?.remove();

  appendUserBubble(text);
  const loadingEl = appendLoading();

  try {
    const res = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message: text, model: currentModel, sessionId, activeNotes }),
    });
    const data = await res.json();
    loadingEl.remove();
    if (data.error) appendError(data.error);
    else appendAssistantBubble({ ...data, question: text });
  } catch (_) {
    loadingEl.remove();
    appendError('서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해주세요.');
  } finally {
    isLoading = false;
    document.getElementById('send-btn').disabled = false;
    inputEl.focus();
  }
}

// ─── 의회 모드 ────────────────────────────────────────────────────────────────

async function sendCouncilMessage() {
  if (isLoading) return;
  const inputEl = document.getElementById('input');
  const text = inputEl.value.trim();
  if (!text) return;

  inputEl.value = '';
  inputEl.style.height = 'auto';
  isLoading = true;
  document.getElementById('send-btn').disabled = true;
  document.querySelector('.welcome')?.remove();

  appendUserBubble(text);

  // 의회 컨테이너 생성
  const container = document.createElement('div');
  container.className = 'council-group';
  const tag = document.createElement('div');
  tag.className = 'council-tag';
  tag.textContent = '의회';
  const body = document.createElement('div');
  body.className = 'council-body';
  container.append(tag, body);
  getMessages().appendChild(container);

  // 로딩 인디케이터
  const loadingEl = createCouncilLoadingEl('1차 답변 생성 중…');
  body.appendChild(loadingEl);
  scrollDown();

  try {
    // ── 1단계: 1차 답변 ────────────────────────────────────────────
    const debateRes = await fetch('/api/council/debate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ question: text, sessionId, councilDraftMode, activeNotes }),
    });
    const debateData = await debateRes.json();

    if (debateData.error) {
      loadingEl.remove();
      appendCouncilError(body, debateData.error);
      return;
    }

    renderInitialAnswers(body, loadingEl, debateData);

    // ── 2단계: 상호 검토 (심층 모드 + 두 답변 모두 있을 때만) ────
    let reviewData = { claudeReview: null, gptReview: null };

    if (councilDraftMode === 'deep' && debateData.claudeReply && debateData.gptReply) {
      updateLoadingText(loadingEl, '상호 검토 중…');

      try {
        const reviewRes = await fetch('/api/council/review', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            question: text,
            claudeReply: debateData.claudeReply,
            gptReply:    debateData.gptReply,
            councilDraftMode,
            sessionId,
          }),
        });
        reviewData = await reviewRes.json();
        if (!reviewData.error) renderReviews(body, loadingEl, reviewData);
      } catch (_) {
        // 검토 실패는 전체 실패로 만들지 않음
      }
    }

    loadingEl.remove();

    // ── 3단계: 종합자 선택 ─────────────────────────────────────────
    if (debateData.claudeReply && debateData.gptReply) {
      renderPicker(container, body, text, debateData, reviewData);
    }

  } catch (_) {
    loadingEl.remove();
    appendCouncilError(body, '서버에 연결할 수 없습니다.');
  } finally {
    isLoading = false;
    document.getElementById('send-btn').disabled = false;
    inputEl.focus();
  }
}

// ── 로딩 헬퍼 ──────────────────────────────────────────────────────────────

function createCouncilLoadingEl(msg) {
  const wrap = document.createElement('div');
  wrap.className = 'council-loading';
  wrap.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
  const txt = document.createElement('span');
  txt.className = 'loading-text';
  txt.textContent = msg;
  wrap.appendChild(txt);
  return wrap;
}

function updateLoadingText(loadingEl, msg) {
  const txt = loadingEl.querySelector('.loading-text');
  if (txt) txt.textContent = msg;
}

// ── 1차 답변 렌더링 ────────────────────────────────────────────────────────

function renderInitialAnswers(body, loadingEl, debateData) {
  const isCompressed = debateData.councilDraftMode !== 'full';

  ['claude', 'gpt'].forEach(model => {
    const reply = model === 'claude' ? debateData.claudeReply : debateData.gptReply;
    const error = model === 'claude' ? debateData.claudeError : debateData.gptError;
    const name  = model === 'claude' ? 'Claude' : 'GPT';
    const el    = reply
      ? makeDebateAnswer(name, reply, !isCompressed)
      : makeDebateError(name, error);
    body.insertBefore(el, loadingEl);
  });

  scrollDown();
}

function makeDebateAnswer(modelName, reply, open = true) {
  const details = document.createElement('details');
  details.className = 'debate-answer';
  details.open = open;

  const summary = document.createElement('summary');
  summary.className = 'model-label debate-summary';
  summary.textContent = modelName;

  const bubble = document.createElement('div');
  bubble.className = 'bubble md';
  bubble.innerHTML = DOMPurify.sanitize(marked.parse(reply));

  details.append(summary, bubble);
  return details;
}

function makeDebateError(modelName, errorMsg) {
  const div = document.createElement('div');
  div.className = 'debate-answer';

  const label = document.createElement('div');
  label.className = 'model-label';
  label.textContent = modelName;

  const err = document.createElement('div');
  err.className = 'error-msg';
  err.textContent = `⚠️ ${modelName} 응답 실패: ${errorMsg || '알 수 없는 오류'}`;

  div.append(label, err);
  return div;
}

// ── 상호 검토 렌더링 ────────────────────────────────────────────────────────

function renderReviews(body, loadingEl, reviewData) {
  const section = document.createElement('div');
  section.className = 'reviews-section';

  if (reviewData.claudeReview) {
    section.appendChild(makeReview('Claude의 GPT 검토', reviewData.claudeReview));
  }
  if (reviewData.gptReview) {
    section.appendChild(makeReview('GPT의 Claude 검토', reviewData.gptReview));
  }

  if (section.children.length > 0) {
    body.insertBefore(section, loadingEl);
    scrollDown();
  }
}

function makeReview(label, review) {
  const details = document.createElement('details');
  details.className = 'review-answer';
  details.open = false; // 검토는 기본 접힘

  const summary = document.createElement('summary');
  summary.className = 'model-label debate-summary review-summary';
  summary.textContent = label;

  const bubble = document.createElement('div');
  bubble.className = 'bubble md review-bubble';
  bubble.innerHTML = DOMPurify.sanitize(marked.parse(review));

  details.append(summary, bubble);
  return details;
}

// ── 종합자 선택 ────────────────────────────────────────────────────────────

function renderPicker(container, body, question, debateData, reviewData) {
  const picker = document.createElement('div');
  picker.className = 'synthesizer-picker';

  const pickerLabel = document.createElement('div');
  pickerLabel.className = 'picker-label';
  pickerLabel.textContent = '누가 종합할까요?';

  const pickerBtns = document.createElement('div');
  pickerBtns.className = 'picker-btns';

  ['claude', 'gpt'].forEach(model => {
    const btn = document.createElement('button');
    btn.className = 'synth-btn';
    btn.textContent = model === 'claude' ? 'Claude가 종합' : 'GPT가 종합';
    const available = model === 'claude' ? !!debateData.claudeReply : !!debateData.gptReply;
    if (!available) {
      btn.disabled = true;
      btn.title = '이 모델의 응답이 없어 종합할 수 없습니다.';
    } else {
      btn.addEventListener('click', () => {
        pickerBtns.querySelectorAll('.synth-btn').forEach(b => b.disabled = true);
        chooseSynthesizer(container, body, question, debateData, reviewData, model);
      });
    }
    pickerBtns.appendChild(btn);
  });

  picker.append(pickerLabel, pickerBtns);
  body.appendChild(picker);
  scrollDown();
}

async function chooseSynthesizer(container, body, question, debateData, reviewData, synthesizer) {
  const label = synthesizer === 'claude' ? 'Claude' : 'GPT';

  const loadingEl = createCouncilLoadingEl(`${label}가 최종 종합 중…`);
  body.appendChild(loadingEl);
  scrollDown();

  try {
    const res = await fetch('/api/council/synthesize', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        question,
        claudeReply:  debateData.claudeReply,
        gptReply:     debateData.gptReply,
        claudeReview: reviewData.claudeReview,
        gptReview:    reviewData.gptReview,
        synthesizer,
        sessionId,
        councilDraftMode,
      }),
    });
    const data = await res.json();
    loadingEl.remove();
    if (data.error) { appendCouncilError(body, data.error); return; }
    renderSynthesis(body, question, debateData, reviewData, data);
  } catch (_) {
    loadingEl.remove();
    appendCouncilError(body, '서버에 연결할 수 없습니다.');
  }
}

// ── 종합 결과 렌더링 ───────────────────────────────────────────────────────

function renderSynthesis(body, question, debateData, reviewData, data) {
  // 1차 답변 및 검토 접기
  body.querySelectorAll('.debate-answer, .review-answer').forEach(d => d.open = false);

  const synthSection = document.createElement('div');
  synthSection.className = 'synthesis-section';

  // 갈린 지점
  if (data.divergence) {
    const divLabel = document.createElement('div');
    divLabel.className = 'model-label divergence-label';
    divLabel.textContent = '갈린 지점';

    const divBubble = document.createElement('div');
    divBubble.className = 'bubble md divergence-bubble';
    divBubble.innerHTML = DOMPurify.sanitize(marked.parse(data.divergence));

    synthSection.append(divLabel, divBubble);
  }

  // 종합
  const synthLabel = document.createElement('div');
  synthLabel.className = 'model-label synthesis-label';
  synthLabel.textContent = `종합 (${data.synthesizer})`;

  const synthBubble = document.createElement('div');
  synthBubble.className = 'bubble md synthesis-bubble';
  synthBubble.innerHTML = DOMPurify.sanitize(marked.parse(data.synthesis));

  const saveBtn = document.createElement('button');
  saveBtn.className = 'save-btn';
  saveBtn.textContent = '노트로 저장';
  saveBtn.addEventListener('click', () => saveCouncilNote(saveBtn, {
    question,
    claudeReply:        debateData.claudeReply,
    gptReply:           debateData.gptReply,
    claudeReview:       reviewData.claudeReview,
    gptReview:          reviewData.gptReview,
    divergence:         data.divergence,
    synthesis:          data.synthesis,
    synthesizer:        data.synthesizer,
    synthesizerModelId: data.synthesizerModelId,
    messageId:          data.messageId,
    councilDraftMode,
  }));

  synthSection.append(synthLabel, synthBubble, saveBtn);
  body.appendChild(synthSection);
  scrollDown();
}

// ── 노트 저장 ──────────────────────────────────────────────────────────────

async function saveCouncilNote(btn, data) {
  btn.disabled = true;
  btn.textContent = '저장 중…';
  try {
    const res = await fetch('/api/council/save-note', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...data, sessionId }),
    });
    const result = await res.json();
    if (result.success) {
      btn.textContent = '✓ 저장됨';
      btn.classList.add('saved');
      showToast(`저장됨: ${result.title}`);
    } else {
      btn.textContent = '다시 시도';
      btn.classList.add('error');
      btn.disabled = false;
      showToast(`오류: ${result.error}`);
    }
  } catch (_) {
    btn.textContent = '다시 시도';
    btn.classList.add('error');
    btn.disabled = false;
    showToast('서버 연결 오류');
  }
}

// ─── 볼트 검색 ────────────────────────────────────────────────────────────────

async function handleSearch(query) {
  document.querySelector('.welcome')?.remove();
  appendUserBubble(`/search ${query}`);

  const loadingEl = appendLoading();
  try {
    const res  = await fetch(`/api/vault/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    loadingEl.remove();

    if (data.error) { appendError(data.error); return; }
    if (!data.results || data.results.length === 0) {
      appendError(`"${query}" 관련 노트를 찾지 못했습니다.`);
      return;
    }

    renderSearchResults(data.results);
  } catch (_) {
    loadingEl.remove();
    appendError('서버에 연결할 수 없습니다.');
  }
}

function renderSearchResults(results) {
  const wrap = document.createElement('div');
  wrap.className = 'search-results';

  const header = document.createElement('div');
  header.className = 'search-header';
  header.textContent = `${results.length}개 노트 발견 — 모두 컨텍스트에 추가됨`;
  wrap.appendChild(header);

  results.forEach(note => {
    addActiveNote(note);
    wrap.appendChild(makeNoteCard(note));
  });

  getMessages().appendChild(wrap);
  scrollDown();
  updateNotesBar();
}

function makeNoteCard(note) {
  const card = document.createElement('div');
  card.className = 'note-card';
  card.dataset.filename = note.filename;

  const title = document.createElement('div');
  title.className = 'note-card-title';
  title.textContent = note.title;

  const excerpt = document.createElement('div');
  excerpt.className = 'note-card-excerpt';
  excerpt.textContent = note.excerpt;

  const removeBtn = document.createElement('button');
  removeBtn.className = 'note-card-remove';
  removeBtn.textContent = '컨텍스트 제거';
  removeBtn.addEventListener('click', () => {
    removeActiveNote(note.filename);
    card.classList.toggle('note-card-inactive', !activeNotes.find(n => n.filename === note.filename));
    removeBtn.textContent = '제거됨';
    removeBtn.disabled = true;
  });

  card.append(title, excerpt, removeBtn);
  return card;
}

function addActiveNote(note) {
  if (!activeNotes.find(n => n.filename === note.filename)) {
    activeNotes.push({ filename: note.filename, title: note.title });
  }
}

function removeActiveNote(filename) {
  activeNotes = activeNotes.filter(n => n.filename !== filename);
  updateNotesBar();
}

function updateNotesBar() {
  const bar = document.getElementById('notes-bar');
  if (!bar) return;
  bar.innerHTML = '';
  if (activeNotes.length === 0) { bar.style.display = 'none'; return; }

  bar.style.display = 'flex';
  activeNotes.forEach(note => {
    const chip = document.createElement('div');
    chip.className = 'note-chip';

    const label = document.createElement('span');
    label.textContent = note.title;

    const x = document.createElement('button');
    x.className = 'note-chip-x';
    x.textContent = '×';
    x.addEventListener('click', () => {
      removeActiveNote(note.filename);
      // 채팅의 해당 카드도 비활성 표시
      const card = document.querySelector(`.note-card[data-filename="${note.filename}"]`);
      if (card) {
        card.classList.add('note-card-inactive');
        const btn = card.querySelector('.note-card-remove');
        if (btn) { btn.textContent = '제거됨'; btn.disabled = true; }
      }
    });

    chip.append(label, x);
    bar.appendChild(chip);
  });
}

// ─── 사용자 메모리 ───────────────────────────────────────────────────────────

async function handleMemoryCommand(command) {
  document.querySelector('.welcome')?.remove();
  appendUserBubble(command);

  const [, action, ...rest] = command.split(/\s+/);
  const value = rest.join(' ').trim();
  const loadingEl = appendLoading();

  try {
    let res;
    if (!action) {
      res = await fetch('/api/memory');
    } else if (action === 'add') {
      if (!value) {
        loadingEl.remove();
        appendError('저장할 메모리를 입력해주세요. 예: /memory add 앞으로 말 편하게 해');
        return;
      }
      res = await fetch('/api/memory', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ content: value }),
      });
    } else if (action === 'remove') {
      if (!value) {
        loadingEl.remove();
        appendError('삭제할 메모리 번호를 입력해주세요. 예: /memory remove 1');
        return;
      }
      res = await fetch(`/api/memory/${encodeURIComponent(value)}`, { method: 'DELETE' });
    } else if (action === 'clear') {
      res = await fetch('/api/memory', { method: 'DELETE' });
    } else {
      loadingEl.remove();
      appendError('사용법: /memory, /memory add 내용, /memory remove 번호, /memory clear');
      return;
    }

    const data = await res.json();
    loadingEl.remove();
    if (data.error) { appendError(data.error); return; }
    renderMemoryResult(data.items || [], action);
  } catch (_) {
    loadingEl.remove();
    appendError('메모리 요청 중 서버 연결 오류가 발생했습니다.');
  }
}

function renderMemoryResult(items, action) {
  const group = document.createElement('div');
  group.className = 'msg-group assistant';

  const label = document.createElement('div');
  label.className = 'model-label';
  label.textContent = 'Memory';

  const bubble = document.createElement('div');
  bubble.className = 'bubble md';

  const title = action === 'add'
    ? '메모리를 저장했습니다.'
    : action === 'remove'
    ? '메모리를 삭제했습니다.'
    : action === 'clear'
    ? '메모리를 모두 삭제했습니다.'
    : '저장된 메모리';

  const body = items.length > 0
    ? items.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
    : '저장된 메모리가 없습니다.';

  bubble.textContent = `${title}\n\n${body}`;
  group.append(label, bubble);
  getMessages().appendChild(group);
  scrollDown();
}

function appendCouncilError(body, msg) {
  const err = document.createElement('div');
  err.className = 'error-msg';
  err.textContent = `⚠️ ${msg}`;
  body.appendChild(err);
  scrollDown();
}

// ─── 단일 모드 노트 저장 ─────────────────────────────────────────────────────

async function saveNote(btn, data) {
  btn.disabled = true;
  btn.textContent = '저장 중…';

  try {
    const res = await fetch('/api/save-note', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question:  data.question,
        answer:    data.reply,
        model:     data.model,
        modelId:   data.modelId,
        sessionId,
        messageId: data.messageId,
      }),
    });
    const result = await res.json();
    if (result.success) {
      btn.textContent = '✓ 저장됨';
      btn.classList.add('saved');
      showToast(`저장됨: ${result.title}`);
    } else {
      btn.textContent = '다시 시도';
      btn.classList.add('error');
      btn.disabled = false;
      showToast(`오류: ${result.error}`);
    }
  } catch (_) {
    btn.textContent = '다시 시도';
    btn.classList.add('error');
    btn.disabled = false;
    showToast('서버 연결 오류');
  }
}

// ─── UI 헬퍼 ─────────────────────────────────────────────────────────────────

function getMessages() { return document.getElementById('messages'); }

function scrollDown() {
  const chat = document.getElementById('chat');
  chat.scrollTop = chat.scrollHeight;
}

function showWelcome() {
  getMessages().innerHTML = `
    <div class="welcome">
      <p>안녕하세요!<br>질문을 입력하면 Claude 또는 GPT가 답해줍니다.</p>
      <p style="margin-top:10px;font-size:12px;opacity:0.7">상단 버튼으로 모델을 선택하세요</p>
    </div>`;
}

function appendUserBubble(text) {
  const group = document.createElement('div');
  group.className = 'msg-group user';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  group.appendChild(bubble);
  getMessages().appendChild(group);
  scrollDown();
}

function appendAssistantBubble(data) {
  const group = document.createElement('div');
  group.className = 'msg-group assistant';

  const label = document.createElement('div');
  label.className = 'model-label';
  label.textContent = data.model;

  const bubble = document.createElement('div');
  bubble.className = 'bubble md';
  bubble.innerHTML = DOMPurify.sanitize(marked.parse(data.reply));

  const saveBtn = document.createElement('button');
  saveBtn.className = 'save-btn';
  saveBtn.textContent = '노트로 저장';
  saveBtn.addEventListener('click', () => saveNote(saveBtn, data));

  group.append(label, bubble, saveBtn);
  getMessages().appendChild(group);
  scrollDown();
}

function appendLoading() {
  const wrap = document.createElement('div');
  wrap.className = 'msg-group assistant loading-wrap';
  wrap.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
  getMessages().appendChild(wrap);
  scrollDown();
  return wrap;
}

function appendError(text) {
  const div = document.createElement('div');
  div.className = 'error-msg';
  div.textContent = `⚠️ ${text}`;
  getMessages().appendChild(div);
  scrollDown();
}

function showToast(text) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2900);
}

function autoResize(e) {
  e.target.style.height = 'auto';
  e.target.style.height = Math.min(e.target.scrollHeight, 130) + 'px';
}

// ─── 실행 ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
