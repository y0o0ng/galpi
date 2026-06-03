'use strict';

const sessionId = (() => {
  const stored = localStorage.getItem('councilSessionId');
  if (stored) return stored;
  const newId = crypto.randomUUID();
  localStorage.setItem('councilSessionId', newId);
  return newId;
})();
const uiHistoryKey = `councilUiHistory:${sessionId}`;
const activeNotesKey = `councilActiveNotes:${sessionId}`;
let currentModel     = 'claude';
let isLoading        = false;
let councilMode      = false;
let councilAvailable = false;
let councilDraftMode = 'compressed'; // 'compressed' | 'full' | 'deep'
let activeNotes      = loadStoredActiveNotes(); // 활성 참조 노트 목록
let isRestoringHistory = false;
const slashCommands = [
  { command: '/search ', title: '노트 검색', description: 'vault에서 관련 노트를 찾아 활성 컨텍스트에 추가' },
  { command: '/save ', title: '문서 저장', description: '입력한 내용을 옵시디언 노트로 저장' },
  { command: '/organize', title: '정리 상태', description: 'Codex 정리 대기 노트 상태 조회' },
  { command: '/organize run', title: '정리 큐 생성', description: '정리 대기 노트를 Codex job queue에 추가' },
  { command: '/organize process', title: '정리 실행', description: '대기 중인 Codex job 하나를 처리' },
  { command: '/organize all', title: '전체 재정리', description: '모든 활성 노트를 Codex로 다시 정리' },
  { command: '/memory', title: '메모리 보기', description: '항상 참조되는 사용자 메모리 목록 표시' },
  { command: '/memory add ', title: '메모리 추가', description: '항상 참조할 말투, 선호, 규칙 저장' },
  { command: '/memory remove ', title: '메모리 삭제', description: '번호로 메모리 항목 삭제' },
  { command: '/memory clear', title: '메모리 초기화', description: '저장된 사용자 메모리 전체 삭제' },
];

// ─── 초기화 ──────────────────────────────────────────────────────────────────

async function init() {
  showWelcome();
  document.body.dataset.activeModel = currentModel;
  document.querySelector('.council-mode-toggle').classList.add('disabled');

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
    if (e.key === 'Escape') hideCommandPalette();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  document.getElementById('input').addEventListener('input', e => {
    autoResize(e);
    updateCommandPalette(e.target.value);
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#command-palette') && !e.target.closest('#input')) {
      hideCommandPalette();
    }
  });

  await loadHistory();
  updateNotesBar();
}

// ─── 히스토리 복원 ───────────────────────────────────────────────────────────

async function loadHistory() {
  try {
    const res = await fetch(`/api/sessions/${sessionId}`);
    if (!res.ok) {
      restoreLocalUiHistory();
      return;
    }
    const { messages } = await res.json();
    if (!messages || messages.length === 0) {
      restoreLocalUiHistory();
      return;
    }

    document.querySelector('.welcome')?.remove();
    isRestoringHistory = true;
    try {
      let lastUserContent = null;
      messages.forEach(msg => {
        if (msg.role === 'user') {
          lastUserContent = msg.content;
          appendUserBubble(msg.content);
        } else {
          appendHistoryBubble(msg.content, msg.model, msg.id, lastUserContent);
        }
      });
    } finally {
      isRestoringHistory = false;
    }
  } catch (_) {
    restoreLocalUiHistory();
  }
}

function restoreLocalUiHistory() {
  const history = loadUiHistory();
  if (history.length === 0) return;

  document.querySelector('.welcome')?.remove();
  isRestoringHistory = true;
  try {
    let lastUserContent = null;
    history.forEach(msg => {
      if (msg.role === 'user') {
        lastUserContent = msg.content;
        appendUserBubble(msg.content);
      } else {
        appendHistoryBubble(msg.content, msg.model, null, lastUserContent);
      }
    });
  } finally {
    isRestoringHistory = false;
  }
}

function appendHistoryBubble(content, model, messageId, question) {
  const councilData = parseCouncilTranscript(content, model);
  if (councilData) {
    renderRestoredCouncilMessage(councilData, messageId);
    return;
  }

  const group = document.createElement('div');
  group.className = 'msg-group assistant';

  const label = makeModelLabel(model || 'AI');

  const bubble = document.createElement('div');
  bubble.className = 'bubble md';
  bubble.innerHTML = DOMPurify.sanitize(marked.parse(content));

  group.append(label, bubble);

  if (question) {
    const saveBtn = document.createElement('button');
    saveBtn.className = 'save-btn icon-save-btn';
    saveBtn.title = '노트로 저장';
    saveBtn.setAttribute('aria-label', '노트로 저장');
    saveBtn.innerHTML = saveIconSvg();
    saveBtn.addEventListener('click', () => showSaveConfirm(saveBtn, () => saveNote(saveBtn, {
      question,
      reply:   content,
      model:   model || 'AI',
      modelId: null,
      messageId,
    })));
    group.appendChild(saveBtn);
  }

  getMessages().appendChild(group);
  scrollDown();
}

function parseCouncilTranscript(content, model) {
  const text = String(content || '');
  const modelText = String(model || '');
  if (!modelText.includes('의회') && !/^## 질문\n/.test(text)) return null;

  const sections = text.split(/\n\n---\n\n/).map(section => section.trim()).filter(Boolean);
  const getSection = (heading) => {
    const section = sections.find(item => item.startsWith(`## ${heading}`));
    const match = section?.match(/^## [^\n]+\n([\s\S]*)$/);
    return match ? match[1].trim() : null;
  };

  const SENTINEL = '응답 없음';
  const synthesisSection = sections.find(item => item.startsWith('## 종합'));
  const synthesisMatch = synthesisSection?.match(/^## 종합 \(([^)]+)\)\n([\s\S]*)$/);
  const question = getSection('질문');
  const claudeReplyRaw = getSection('Claude 1차 답변');
  const gptReplyRaw    = getSection('GPT 1차 답변');
  const claudeReply = claudeReplyRaw === SENTINEL ? null : claudeReplyRaw;
  const gptReply    = gptReplyRaw    === SENTINEL ? null : gptReplyRaw;
  const synthesis = synthesisMatch ? synthesisMatch[2].trim() : null;
  if (!question || !synthesis || (!claudeReply && !gptReply)) return null;

  const settingsRaw = getSection('의회 설정');
  const parsedMode = settingsRaw?.match(/draftMode: (.+)/)?.[1]?.trim() || null;

  return {
    question,
    claudeReply,
    gptReply,
    claudeReview: getSection('Claude의 GPT 검토'),
    gptReview: getSection('GPT의 Claude 검토'),
    divergence: getSection('갈린 지점'),
    synthesis,
    synthesizer: synthesisMatch ? synthesisMatch[1].trim() : modelText.replace(/\s*\(의회\)\s*$/, '') || 'AI',
    synthesizerModelId: null,
    councilDraftMode: parsedMode || 'compressed',
  };
}

function renderRestoredCouncilMessage(data, messageId = null) {
  const container = document.createElement('div');
  container.className = 'council-group';

  const tag = document.createElement('div');
  tag.className = 'council-tag';
  tag.textContent = '의회';

  const body = document.createElement('div');
  body.className = 'council-body';

  if (data.claudeReply) body.appendChild(makeDebateAnswer('Claude', data.claudeReply, false));
  if (data.gptReply) body.appendChild(makeDebateAnswer('GPT', data.gptReply, false));

  if (data.claudeReview || data.gptReview) {
    const reviews = document.createElement('div');
    reviews.className = 'reviews-section';
    if (data.claudeReview) reviews.appendChild(makeReview('Claude의 GPT 검토', data.claudeReview));
    if (data.gptReview) reviews.appendChild(makeReview('GPT의 Claude 검토', data.gptReview));
    body.appendChild(reviews);
  }

  appendSynthesisSection(body, data.question, {
    claudeReply: data.claudeReply,
    gptReply: data.gptReply,
    councilDraftMode: data.councilDraftMode,
  }, {
    claudeReview: data.claudeReview,
    gptReview: data.gptReview,
  }, {
    divergence: data.divergence,
    synthesis: data.synthesis,
    synthesizer: data.synthesizer,
    synthesizerModelId: data.synthesizerModelId,
    messageId,
  });

  container.append(tag, body);
  getMessages().appendChild(container);
  scrollDown();
}

function loadUiHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(uiHistoryKey) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveUiMessage(role, content, model = null) {
  if (isRestoringHistory) return;
  const history = loadUiHistory();
  history.push({ role, content, model });
  localStorage.setItem(uiHistoryKey, JSON.stringify(history.slice(-100)));
}

function loadStoredActiveNotes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(activeNotesKey) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveActiveNotes() {
  localStorage.setItem(activeNotesKey, JSON.stringify(activeNotes));
}

// ─── 모델 선택 ────────────────────────────────────────────────────────────────

function selectModel(model) {
  currentModel = model;
  document.querySelectorAll('.model-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.model === model);
  });
  document.body.dataset.activeModel = model;
}

function toggleCouncil() {
  if (!councilAvailable) return;
  councilMode = !councilMode;
  document.querySelector('.council-btn').classList.toggle('active', councilMode);
  document.querySelector('.council-mode-toggle').classList.toggle('disabled', !councilMode);
  document.querySelectorAll('.model-btn').forEach(b => {
    if (!b.disabled) {
      b.style.opacity       = councilMode ? '0.4' : '';
      b.style.pointerEvents = councilMode ? 'none' : '';
    }
  });
  document.body.dataset.activeModel = councilMode ? 'council' : currentModel;
}

// ─── 메시지 전송 디스패처 ────────────────────────────────────────────────────

function sendMessage() {
  const inputEl = document.getElementById('input');
  const text = inputEl.value.trim();
  hideCommandPalette();
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
  if (text === '/organize run') {
    inputEl.value = '';
    inputEl.style.height = 'auto';
    handleOrganizeRun(true);
    return;
  }
  if (text === '/organize process') {
    inputEl.value = '';
    inputEl.style.height = 'auto';
    handleOrganizeProcess(true);
    return;
  }
  if (text === '/organize all') {
    inputEl.value = '';
    inputEl.style.height = 'auto';
    handleOrganizeAll(true);
    return;
  }
  if (text === '/organize') {
    inputEl.value = '';
    inputEl.style.height = 'auto';
    handleOrganizeStatus();
    return;
  }
  if (text.startsWith('/save ')) {
    const content = text.slice(6).trim();
    inputEl.value = '';
    inputEl.style.height = 'auto';
    if (content) handleDocumentSave(text, content);
    return;
  }
  const saveContent = extractSaveRequestContent(text);
  if (saveContent) {
    inputEl.value = '';
    inputEl.style.height = 'auto';
    handleDocumentSave(text, saveContent);
    return;
  }
  if (councilMode) sendCouncilMessage();
  else sendSingleMessage();
}

function extractSaveRequestContent(text) {
  const trimmed = text.trim();
  const patterns = [
    /\s*(?:저장해줘|저장해둬|저장해놔|저장해 두자|저장해 줘|노트로 저장해줘|노트로 저장해둬|옵시디언에 넣어줘|옵시디언에 저장해줘)\s*$/u,
    /^\s*(?:저장해줘|저장해둬|노트로 저장해줘|옵시디언에 넣어줘)[:\s]+/u,
  ];

  for (const pattern of patterns) {
    if (!pattern.test(trimmed)) continue;
    const content = trimmed.replace(pattern, '').trim();
    return content.length >= 8 ? content : null;
  }

  return null;
}

// ─── 슬래시 명령어 팔레트 ─────────────────────────────────────────────────────

function updateCommandPalette(value) {
  const palette = document.getElementById('command-palette');
  if (!palette) return;

  if (!value.startsWith('/')) {
    hideCommandPalette();
    return;
  }

  const matched = slashCommands.filter(cmd => cmd.command.startsWith(value) || value.startsWith(cmd.command.trim()));
  const commands = matched.length > 0 ? matched : slashCommands;
  renderCommandPalette(commands);
}

function renderCommandPalette(commands) {
  const palette = document.getElementById('command-palette');
  if (!palette) return;

  palette.innerHTML = '';
  commands.forEach(cmd => {
    const item = document.createElement('button');
    item.className = 'command-item';
    item.type = 'button';

    const command = document.createElement('span');
    command.className = 'command-name';
    command.textContent = cmd.command.trim();

    const meta = document.createElement('span');
    meta.className = 'command-meta';
    meta.textContent = `${cmd.title} · ${cmd.description}`;

    item.append(command, meta);
    item.addEventListener('click', () => {
      const input = document.getElementById('input');
      input.value = cmd.command;
      input.focus();
      input.selectionStart = input.selectionEnd = input.value.length;
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 130) + 'px';
      hideCommandPalette();
    });
    palette.appendChild(item);
  });

  palette.style.display = 'flex';
}

function hideCommandPalette() {
  const palette = document.getElementById('command-palette');
  if (palette) palette.style.display = 'none';
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
  document.dispatchEvent(new Event('pet:thinking'));

  try {
    document.dispatchEvent(new Event('pet:building'));
    const res = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message: text, model: currentModel, sessionId, activeNotes }),
    });
    const data = await res.json();
    loadingEl.remove();
    if (data.error) appendError(data.error);
    else {
      appendAssistantBubble({ ...data, question: text });
      document.dispatchEvent(new Event('pet:happy'));
    }
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
  document.dispatchEvent(new Event('pet:building'));

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
    document.dispatchEvent(new Event('pet:happy'));

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

  const summary = makeModelLabel(modelName, 'summary');
  summary.className = 'model-label debate-summary';

  const bubble = document.createElement('div');
  bubble.className = 'bubble md';
  bubble.innerHTML = DOMPurify.sanitize(marked.parse(reply));

  details.append(summary, bubble);
  return details;
}

function makeDebateError(modelName, errorMsg) {
  const div = document.createElement('div');
  div.className = 'debate-answer';

  const label = makeModelLabel(modelName);

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
        councilDraftMode: debateData.councilDraftMode || councilDraftMode,
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

  appendSynthesisSection(body, question, debateData, reviewData, data);
  saveUiMessage('assistant', buildCouncilTranscript(question, debateData, reviewData, data), `종합 (${data.synthesizer})`);
  scrollDown();
}

function appendSynthesisSection(body, question, debateData, reviewData, data) {
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
  saveBtn.className = 'save-btn icon-save-btn';
  saveBtn.title = '노트로 저장';
  saveBtn.setAttribute('aria-label', '노트로 저장');
  saveBtn.innerHTML = saveIconSvg();
  const noteDraftMode = debateData.councilDraftMode || councilDraftMode;
  saveBtn.addEventListener('click', () => showSaveConfirm(saveBtn, () => saveCouncilNote(saveBtn, {
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
    councilDraftMode:   noteDraftMode,
  })));

  synthSection.append(synthLabel, synthBubble, saveBtn);
  body.appendChild(synthSection);
}

function buildCouncilTranscript(question, debateData, reviewData, data) {
  const sections = [
    `## 질문\n${question}`,
    `## Claude 1차 답변\n${debateData.claudeReply || '응답 없음'}`,
    `## GPT 1차 답변\n${debateData.gptReply || '응답 없음'}`,
    `## 의회 설정\ndraftMode: ${debateData.councilDraftMode || 'compressed'}`,
  ];

  if (reviewData.claudeReview || reviewData.gptReview) {
    sections.push(`## Claude의 GPT 검토\n${reviewData.claudeReview || '검토 없음'}`);
    sections.push(`## GPT의 Claude 검토\n${reviewData.gptReview || '검토 없음'}`);
  }

  if (data.divergence) sections.push(`## 갈린 지점\n${data.divergence}`);
  sections.push(`## 종합 (${data.synthesizer})\n${data.synthesis}`);
  return sections.join('\n\n---\n\n');
}

// ── 노트 저장 ──────────────────────────────────────────────────────────────

async function saveCouncilNote(btn, data) {
  btn.disabled = true;
  btn.innerHTML = loadingIconSvg();
  try {
    const res = await fetch('/api/council/save-note', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...data, sessionId }),
    });
    const result = await res.json();
    if (result.success) {
      btn.innerHTML = checkIconSvg();
      btn.title = '저장됨';
      btn.setAttribute('aria-label', '저장됨');
      btn.classList.add('saved');
      showToast(`저장됨: ${result.title}`);
    } else {
      btn.innerHTML = saveIconSvg();
      btn.title = '다시 시도';
      btn.setAttribute('aria-label', '다시 시도');
      btn.classList.add('error');
      btn.disabled = false;
      showToast(`오류: ${result.error}`);
    }
  } catch (_) {
    btn.innerHTML = saveIconSvg();
    btn.title = '다시 시도';
    btn.setAttribute('aria-label', '다시 시도');
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

async function handleOrganizeStatus() {
  document.querySelector('.welcome')?.remove();
  appendUserBubble('/organize');

  const loadingEl = appendLoading();
  try {
    const res = await fetch('/api/organize/status');
    const data = await res.json();
    loadingEl.remove();

    if (data.error) {
      appendError(data.error);
      return;
    }

    renderOrganizeStatus(data);
  } catch (_) {
    loadingEl.remove();
    appendError('서버에 연결할 수 없습니다.');
  }
}

async function handleOrganizeRun(showUserCommand = false) {
  if (isLoading) return;
  isLoading = true;
  document.getElementById('send-btn').disabled = true;
  document.querySelector('.welcome')?.remove();
  if (showUserCommand) appendUserBubble('/organize run');

  document.dispatchEvent(new Event('pet:thinking'));
  const loadingEl = appendLoading();
  try {
    const res = await fetch('/api/organize/queue', { method: 'POST' });
    const data = await res.json();
    loadingEl.remove();

    if (data.error) {
      appendError(data.error);
      return;
    }

    renderOrganizeQueueResult(data);
    document.dispatchEvent(new Event('pet:happy'));
  } catch (_) {
    loadingEl.remove();
    appendError('서버에 연결할 수 없습니다.');
  } finally {
    isLoading = false;
    document.getElementById('send-btn').disabled = false;
    document.getElementById('input').focus();
  }
}

async function handleOrganizeProcess(showUserCommand = false) {
  if (isLoading) return;
  isLoading = true;
  document.getElementById('send-btn').disabled = true;
  document.querySelector('.welcome')?.remove();
  if (showUserCommand) appendUserBubble('/organize process');

  document.dispatchEvent(new Event('pet:building'));
  const loadingEl = appendLoading();
  try {
    const res = await fetch('/api/organize/process', { method: 'POST' });
    const data = await res.json();
    loadingEl.remove();

    if (data.error && !data.processed) {
      appendError(data.error);
      return;
    }

    renderOrganizeProcessResult(data);
    document.dispatchEvent(new Event('pet:happy'));
  } catch (_) {
    loadingEl.remove();
    appendError('서버에 연결할 수 없습니다.');
  } finally {
    isLoading = false;
    document.getElementById('send-btn').disabled = false;
    document.getElementById('input').focus();
  }
}

async function handleOrganizeAll(showUserCommand = false) {
  if (isLoading) return;
  isLoading = true;
  document.getElementById('send-btn').disabled = true;
  document.querySelector('.welcome')?.remove();
  if (showUserCommand) appendUserBubble('/organize all');

  document.dispatchEvent(new Event('pet:building'));
  const loadingEl = appendLoading();
  try {
    const res = await fetch('/api/organize/all', { method: 'POST' });
    const data = await res.json();
    loadingEl.remove();

    if (data.error) {
      appendError(data.error);
      return;
    }

    renderOrganizeAllResult(data);
    document.dispatchEvent(new Event(data.failedCount > 0 ? 'pet:error' : 'pet:happy'));
  } catch (_) {
    loadingEl.remove();
    appendError('서버에 연결할 수 없습니다.');
  } finally {
    isLoading = false;
    document.getElementById('send-btn').disabled = false;
    document.getElementById('input').focus();
  }
}

function renderOrganizeStatus(data) {
  const group = document.createElement('div');
  group.className = 'msg-group assistant';

  const label = makeModelLabel('Organize');

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  const notes = Array.isArray(data.notes) ? data.notes : [];
  const rows = notes.slice(0, 10).map((note, index) =>
    `${index + 1}. ${note.title} (${note.noteType})`
  );
  const more = notes.length > 10 ? `\n...외 ${notes.length - 10}개` : '';

  bubble.textContent = [
    `자동 큐 기준: ${data.autoQueueThreshold || 5}개`,
    `정리 대기: ${data.pending || 0}개`,
    `큐 대기: ${data.queued || 0}개`,
    `실행 중: ${data.running || 0}개`,
    `완료: ${data.processed || 0}개`,
    `실패: ${data.failed || 0}개`,
    `수동 확인: ${data.needsManualCheck || 0}개`,
    rows.length ? `\n대기 노트:\n${rows.join('\n')}${more}` : '\n대기 노트 없음',
  ].join('\n');

  group.append(label, bubble);

  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const runnableJobs = jobs.filter(job => job.status === 'pending');

  if (notes.length > 0 || runnableJobs.length > 0) {
    const actionRow = document.createElement('div');
    actionRow.className = 'organize-actions';

    if (notes.length > 0) {
      const queueBtn = document.createElement('button');
      queueBtn.className = 'save-btn';
      queueBtn.textContent = '정리 큐에 넣기';
      queueBtn.addEventListener('click', () => handleOrganizeRun(false));
      actionRow.appendChild(queueBtn);
    }

    if (runnableJobs.length > 0) {
      const processBtn = document.createElement('button');
      processBtn.className = 'save-btn';
      processBtn.textContent = '정리';
      processBtn.addEventListener('click', () => handleOrganizeProcess(false));
      actionRow.appendChild(processBtn);
    }

    group.appendChild(actionRow);
  }

  getMessages().appendChild(group);
  saveUiMessage('assistant', bubble.textContent, 'Organize');
  scrollDown();
}

function renderOrganizeQueueResult(data) {
  const group = document.createElement('div');
  group.className = 'msg-group assistant';

  const label = makeModelLabel('Organize');

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  const notes = Array.isArray(data.notes) ? data.notes : [];
  const rows = notes.map((note, index) =>
    `${index + 1}. ${note.title} (${note.noteType})`
  );

  bubble.textContent = data.created
    ? [
        `정리 job 생성됨: #${data.jobId}`,
        `상태: ${data.status}`,
        rows.length ? `\n큐에 들어간 노트:\n${rows.join('\n')}` : '',
      ].filter(Boolean).join('\n')
    : (data.message || '정리 대기 노트가 없습니다.');

  group.append(label, bubble);
  getMessages().appendChild(group);
  saveUiMessage('assistant', bubble.textContent, 'Organize');
  scrollDown();
}

function renderOrganizeProcessResult(data) {
  const group = document.createElement('div');
  group.className = 'msg-group assistant';

  const label = makeModelLabel('Organize');

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  const notes = Array.isArray(data.notes) ? data.notes : [];
  const failed = Array.isArray(data.failed) ? data.failed : [];
  const rows = notes.map((note, index) => `${index + 1}. ${note.title}`);
  const failedRows = failed.map(item => `- ${item.filename}: ${item.error}`);

  bubble.textContent = data.processed
    ? [
        `정리 job 처리됨: #${data.jobId}`,
        `상태: ${data.status}`,
        rows.length ? `\n처리한 노트:\n${rows.join('\n')}` : '',
        failedRows.length ? `\n수동 확인 필요:\n${failedRows.join('\n')}` : '',
      ].filter(Boolean).join('\n')
    : (data.message || '실행할 정리 job이 없습니다.');

  group.append(label, bubble);
  getMessages().appendChild(group);
  saveUiMessage('assistant', bubble.textContent, 'Organize');
  scrollDown();
}

function renderOrganizeAllResult(data) {
  const group = document.createElement('div');
  group.className = 'msg-group assistant';

  const label = makeModelLabel('Organize');

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  const batches = Array.isArray(data.batches) ? data.batches : [];
  const failed = Array.isArray(data.failed) ? data.failed : [];
  const batchRows = batches.map(batch =>
    `${batch.index}. ${batch.status} (${batch.processedCount || 0}/${batch.filenames?.length || 0})`
  );
  const failedRows = failed.slice(0, 10).map(item => `- ${item.filename}: ${item.error}`);
  const moreFailed = failed.length > 10 ? `\n...외 ${failed.length - 10}개` : '';

  bubble.textContent = data.processed
    ? [
        '전체 재정리 완료',
        `상태: ${data.status}`,
        `처리: ${data.processedCount || 0}개`,
        `실패: ${data.failedCount || 0}개`,
        batchRows.length ? `\n배치:\n${batchRows.join('\n')}` : '',
        failedRows.length ? `\n수동 확인 필요:\n${failedRows.join('\n')}${moreFailed}` : '',
      ].filter(Boolean).join('\n')
    : (data.message || '재정리할 노트가 없습니다.');

  group.append(label, bubble);
  getMessages().appendChild(group);
  saveUiMessage('assistant', bubble.textContent, 'Organize');
  scrollDown();
}

async function handleDocumentSave(originalText, content) {
  if (isLoading) return;
  isLoading = true;
  document.getElementById('send-btn').disabled = true;
  document.querySelector('.welcome')?.remove();
  appendUserBubble(originalText);

  const loadingEl = appendLoading();
  try {
    const res = await fetch('/api/vault/save-document', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ content, originalText, sessionId }),
    });
    const data = await res.json();
    loadingEl.remove();

    if (data.error) {
      appendError(data.error);
      return;
    }

    if (data.filename && data.title) {
      addActiveNote({ filename: data.filename, title: data.title });
      updateNotesBar();
    }
    renderDocumentSaveResult(data);
  } catch (_) {
    loadingEl.remove();
    appendError('서버에 연결할 수 없습니다.');
  } finally {
    isLoading = false;
    document.getElementById('send-btn').disabled = false;
    document.getElementById('input').focus();
  }
}

function renderDocumentSaveResult(data) {
  const group = document.createElement('div');
  group.className = 'msg-group assistant';

  const label = document.createElement('div');
  label.className = 'model-label';
  label.textContent = '저장';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = `노트 저장됨: ${data.title}`;

  group.append(label, bubble);
  getMessages().appendChild(group);
  saveUiMessage('assistant', bubble.textContent, '저장');
  scrollDown();
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
    saveActiveNotes();
  }
}

function removeActiveNote(filename) {
  activeNotes = activeNotes.filter(n => n.filename !== filename);
  saveActiveNotes();
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
  saveUiMessage('assistant', bubble.textContent, 'Memory');
  scrollDown();
}

function appendCouncilError(body, msg) {
  const err = document.createElement('div');
  err.className = 'error-msg';
  err.textContent = `⚠️ ${msg}`;
  body.appendChild(err);
  scrollDown();
  document.dispatchEvent(new Event('pet:error'));
}

// ─── 단일 모드 노트 저장 ─────────────────────────────────────────────────────

async function saveNote(btn, data) {
  btn.disabled = true;
  btn.innerHTML = loadingIconSvg();

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
      btn.innerHTML = checkIconSvg();
      btn.title = '저장됨';
      btn.setAttribute('aria-label', '저장됨');
      btn.classList.add('saved');
      showToast(`저장됨: ${result.title}`);
    } else {
      btn.innerHTML = saveIconSvg();
      btn.title = '다시 시도';
      btn.setAttribute('aria-label', '다시 시도');
      btn.classList.add('error');
      btn.disabled = false;
      showToast(`오류: ${result.error}`);
    }
  } catch (_) {
    btn.innerHTML = saveIconSvg();
    btn.title = '다시 시도';
    btn.setAttribute('aria-label', '다시 시도');
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
  saveUiMessage('user', text);
  scrollDown();
}

function appendAssistantBubble(data) {
  const group = document.createElement('div');
  group.className = 'msg-group assistant';

  const label = makeModelLabel(data.model);

  const bubble = document.createElement('div');
  bubble.className = 'bubble md';
  bubble.innerHTML = DOMPurify.sanitize(marked.parse(data.reply));

  const saveBtn = document.createElement('button');
  saveBtn.className = 'save-btn icon-save-btn';
  saveBtn.title = '노트로 저장';
  saveBtn.setAttribute('aria-label', '노트로 저장');
  saveBtn.innerHTML = saveIconSvg();
  saveBtn.addEventListener('click', () => showSaveConfirm(saveBtn, () => saveNote(saveBtn, data)));

  group.append(label, bubble, saveBtn);
  getMessages().appendChild(group);
  saveUiMessage('assistant', data.reply, data.model);
  scrollDown();
}

function showSaveConfirm(saveBtn, onConfirm) {
  const parent = saveBtn.parentNode;
  const confirm = document.createElement('span');
  confirm.className = 'save-confirm';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'save-confirm-cancel';
  cancelBtn.textContent = '취소';
  cancelBtn.addEventListener('click', () => {
    confirm.replaceWith(saveBtn);
  });

  const okBtn = document.createElement('button');
  okBtn.className = 'save-confirm-ok';
  okBtn.textContent = '저장';
  okBtn.addEventListener('click', () => {
    confirm.replaceWith(saveBtn);
    onConfirm();
  });

  confirm.append(cancelBtn, okBtn);
  saveBtn.replaceWith(confirm);
}

const ICON_CLAUDE = '/lib/icons/sX8kIHSVvTDsFMiq9VQtQRczlnC6Ao5W6GvDvETovqQIJ1wxbLKydnVC-kBFsRoucWrclKkEW0ohQcJx3jm_pg.svg';
const ICON_GPT    = '/lib/icons/9yf4h0kNu7QBf_SABY4CQJ8IFmv9Kby2YRVNQADCntaBn8kQyiAMcGNT9JgMcI2Ec2NCqTTIx6eg9TZK7h1NbQ.svg';

function makeModelLabel(modelName, tag = 'div') {
  const el = document.createElement(tag);
  el.className = 'model-label';

  const nameLower = (modelName || '').toLowerCase();
  const iconSrc = nameLower.includes('claude') ? ICON_CLAUDE
                : nameLower.includes('gpt')    ? ICON_GPT
                : null;

  if (iconSrc) {
    const img = document.createElement('img');
    img.src = iconSrc;
    img.width = 18;
    img.height = 18;
    img.className = 'model-logo-label' + (iconSrc === ICON_GPT ? ' logo-gpt' : '');
    img.setAttribute('aria-hidden', 'true');
    el.appendChild(img);
  }

  const text = document.createElement('span');
  text.textContent = modelName || 'AI';
  el.appendChild(text);

  return el;
}

function saveIconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>`;
}

function checkIconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>`;
}

function loadingIconSvg() {
  return `<svg class="spin-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.2-8.6"></path></svg>`;
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
  document.dispatchEvent(new Event('pet:error'));
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

// ─── 테마 토글 ────────────────────────────────────────────────────────────────

function initTheme() {
  const saved = localStorage.getItem('councilTheme');
  const isDark = saved === 'dark';
  applyTheme(isDark);

  document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') !== 'dark';
    applyTheme(next);
    localStorage.setItem('councilTheme', next ? 'dark' : 'light');
  });
}

function applyTheme(dark) {
  if (dark) {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  document.getElementById('icon-moon').style.display = dark ? 'none' : '';
  document.getElementById('icon-sun').style.display  = dark ? ''     : 'none';
}

// ─── 실행 ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => { init(); initTheme(); initPet(); });
