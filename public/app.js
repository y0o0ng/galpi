'use strict';

// 단일 사용자 비서: 모든 기기가 같은 대화를 이어가도록 고정 세션 ID를 공유한다.
// (지식/노트는 원래 서버에서 공유되고, 이 값으로 라이브 대화 thread까지 기기 간 공유)
const sessionId = 'shared-main';
const uiHistoryKey = `councilUiHistory:${sessionId}`;
const activeNotesKey = `councilActiveNotes:${sessionId}`;
const apiTokenKey = 'councilApiToken';
const notificationPositionKey = 'councilNotificationPosition';
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
  { command: '/embed', title: '임베딩 생성', description: '모든 노트의 시맨틱 검색용 임베딩 생성' },
  { command: '/organize', title: '정리 상태', description: 'Codex 정리 대기 노트 상태 조회' },
  { command: '/organize all', title: '전체 재정리', description: '모든 활성 노트를 Codex로 다시 정리' },
  { command: '/archive ', title: '노트 보관', description: '검색어로 노트를 찾아 _archive로 보관' },
  { command: '/archived', title: '보관함', description: '숨긴(보관한) 노트 목록 — 복원 가능' },
  { command: '/backup', title: '백업', description: '볼트+DB를 지금 백업 (자동: 하루 1회, 7일 보관)' },
  { command: '/sync', title: '볼트 동기화', description: '옵시디언 직접 편집 반영 — 신규 노트 등록 + 삭제 노트 정리' },
  { command: '/graph report', title: '그래프 리포트', description: '연결/고립/큰 토픽 요약 리포트 생성' },
  { command: '/audit', title: '시스템 검사', description: '검증, 정리 상태, 알림, 고립 토픽을 한 번에 점검' },
  { command: '/merge', title: '토픽 병합', description: '유사한 토픽 병합 후보 — 검색 카드의 "병합"으로 직접 묶기도 가능' },
  { command: '/notifications', title: '알림센터', description: 'Codex 제안과 시스템 알림을 작은 패널로 보기' },
  { command: '/memory', title: '메모리 보기', description: '항상 참조되는 사용자 메모리 목록 표시' },
  { command: '/memory add ', title: '메모리 추가', description: '항상 참조할 말투, 선호, 규칙 저장' },
  { command: '/memory remove ', title: '메모리 삭제', description: '번호로 메모리 항목 삭제' },
  { command: '/memory clear', title: '메모리 초기화', description: '저장된 사용자 메모리 전체 삭제' },
];

function getApiToken() {
  return localStorage.getItem(apiTokenKey) || '';
}

function setApiToken(token) {
  const clean = String(token || '').trim();
  if (clean) localStorage.setItem(apiTokenKey, clean);
}

function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getApiToken();
  if (token) headers.set('X-API-Token', token);
  return fetch(url, { ...options, headers }).then(res => {
    if (res.status === 401) {
      localStorage.removeItem(apiTokenKey); // 잘못된 토큰 → 비우고 다시 입력받기
      showTokenGate();
    }
    return res;
  });
}


// 토큰이 필요한데 없으면 화면 안 입력칸(게이트)을 띄운다.
// window.prompt는 iOS Safari가 자동 로드 중에 막아버려서 못 씀.
function ensureApiToken(config) {
  if (!config?.requiresApiToken || getApiToken()) return false;
  showTokenGate();
  return true;
}

function showTokenGate() {
  getMessages().innerHTML = `
    <div style="max-width:340px;margin:60px auto;text-align:center;padding:24px;">
      <p style="margin-bottom:14px;opacity:0.85;">이 서버는 접속 토큰이 필요합니다.</p>
      <input id="token-input" type="password" placeholder="토큰 입력" autocomplete="off"
        style="width:100%;padding:11px;border:1px solid #ccc;border-radius:8px;font-size:16px;box-sizing:border-box;">
      <button id="token-submit"
        style="margin-top:10px;padding:10px 22px;border:none;border-radius:8px;background:#4a6cf7;color:#fff;font-size:15px;cursor:pointer;">입력</button>
      <p id="token-error" style="color:#e04848;font-size:13px;margin-top:8px;display:none;">토큰이 올바르지 않습니다.</p>
    </div>`;
  const input = document.getElementById('token-input');
  const submit = () => {
    const v = input.value.trim();
    if (!v) return;
    setApiToken(v);
    location.reload();
  };
  document.getElementById('token-submit').addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  input.focus();
}

// ─── 초기화 ──────────────────────────────────────────────────────────────────

async function init() {
  showWelcome();
  document.body.dataset.activeModel = currentModel;
  document.querySelector('.council-mode-toggle').classList.add('disabled');

  try {
    const config = await apiFetch('/api/config').then(r => r.json());
    if (ensureApiToken(config)) return;
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
  setInterval(pollForUpdates, 7000);
  updateNotesBar();
}

// ─── 히스토리 복원 ───────────────────────────────────────────────────────────

let lastRenderedMsgId = 0;

// 메시지 배열로 대화창을 처음부터 다시 그린다. (폴링 갱신과 공유)
function renderMessages(messages) {
  getMessages().innerHTML = '';
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
  lastRenderedMsgId = messages.length ? (messages[messages.length - 1].id || 0) : 0;
}

async function loadHistory() {
  try {
    const res = await apiFetch(`/api/sessions/${sessionId}`);
    if (!res.ok) { restoreLocalUiHistory(); return; }
    const { messages } = await res.json();
    if (!messages || messages.length === 0) { restoreLocalUiHistory(); return; }
    renderMessages(messages);
  } catch (_) {
    restoreLocalUiHistory();
  }
}

// 다른 기기에서 온 새 메시지 자동 반영: 7초마다, 탭 보일 때만, 최신 메시지 ID가 바뀌었을 때만 다시 그림.
async function pollForUpdates() {
  if (document.hidden || isLoading) return;
  if (document.querySelector('.synthesizer-picker') || document.querySelector('.council-loading')) return;
  try {
    const res = await apiFetch(`/api/sessions/${sessionId}`);
    if (!res.ok) return;
    const { messages } = await res.json();
    if (!messages || messages.length === 0) return;
    const latestId = messages[messages.length - 1].id || 0;
    if (latestId === lastRenderedMsgId) return;
    renderMessages(messages);
  } catch (_) { /* 조용히 무시 */ }
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
  if (text === '/organize all') {
    inputEl.value = '';
    inputEl.style.height = 'auto';
    handleOrganizeAll(true);
    return;
  }
  if (text === '/embed') {
    inputEl.value = '';
    inputEl.style.height = 'auto';
    handleEmbed();
    return;
  }
  if (text === '/organize') {
    inputEl.value = '';
    inputEl.style.height = 'auto';
    handleOrganizeStatus();
    return;
  }
  if (text === '/archived') {
    inputEl.value = '';
    inputEl.style.height = 'auto';
    handleArchivedList();
    return;
  }
  if (text.startsWith('/archive ')) {
    const query = text.slice(9).trim();
    inputEl.value = '';
    inputEl.style.height = 'auto';
    if (query) handleArchiveCommand(query);
    return;
  }
  if (text === '/backup') {
    inputEl.value = '';
    inputEl.style.height = 'auto';
    handleBackup();
    return;
  }
  if (text === '/sync') {
    inputEl.value = '';
    inputEl.style.height = 'auto';
    handleSync();
    return;
  }
  if (text === '/graph report') {
    inputEl.value = '';
    inputEl.style.height = 'auto';
    handleGraphReport();
    return;
  }
  if (text === '/audit') {
    inputEl.value = '';
    inputEl.style.height = 'auto';
    handleAudit();
    return;
  }
  if (text === '/merge') {
    inputEl.value = '';
    inputEl.style.height = 'auto';
    handleMergeCandidates();
    return;
  }
  if (text === '/notifications') {
    inputEl.value = '';
    inputEl.style.height = 'auto';
    openNotificationsPanel();
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
    const res = await apiFetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message: text, model: currentModel, sessionId, activeNotes }),
    });
    const data = await res.json();
    loadingEl.remove();
    if (data.error) appendError(data.error);
    else {
      appendAssistantBubble({ ...data, question: text });
      lastRenderedMsgId = data.messageId || lastRenderedMsgId; // 방금 보낸 건 폴링이 다시 안 그리게
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
    const debateRes = await apiFetch('/api/council/debate', {
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
        const reviewRes = await apiFetch('/api/council/review', {
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
    const res = await apiFetch('/api/council/synthesize', {
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
    const res = await apiFetch('/api/council/save-note', {
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
    const res  = await apiFetch(`/api/vault/search?q=${encodeURIComponent(query)}`);
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
    const res = await apiFetch('/api/organize/status');
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

async function handleEmbed() {
  if (isLoading) return;
  isLoading = true;
  document.getElementById('send-btn').disabled = true;
  document.querySelector('.welcome')?.remove();
  appendUserBubble('/embed');

  const loadingEl = appendLoading();
  document.dispatchEvent(new Event('pet:building'));
  try {
    const res = await apiFetch('/api/vault/embed-all', { method: 'POST' });
    const data = await res.json();
    loadingEl.remove();
    if (data.error) { appendError(data.error); return; }

    const group = document.createElement('div');
    group.className = 'msg-group assistant';
    group.append(makeModelLabel('Embed'));
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = data.message || `완료: ${data.embedded ?? 0}개 임베딩 생성`;
    group.appendChild(bubble);
    getMessages().appendChild(group);
    scrollDown();
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
    const res = await apiFetch('/api/organize/all', { method: 'POST' });
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
    const res = await apiFetch('/api/vault/save-document', {
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
  header.textContent = `${results.length}개 발견 — 컨텍스트로 쓰거나, 체크해서 병합`;

  const mergeSelBtn = document.createElement('button');
  mergeSelBtn.className = 'note-card-remove';
  mergeSelBtn.textContent = '선택 병합';
  mergeSelBtn.style.marginLeft = '8px';
  mergeSelBtn.addEventListener('click', () => openBatchMerge(wrap));
  header.appendChild(mergeSelBtn);

  wrap.appendChild(header);

  results.forEach(note => {
    addActiveNote(note);
    wrap.appendChild(makeNoteCard(note));
  });

  getMessages().appendChild(wrap);
  scrollDown();
  updateNotesBar();
}

// 검색 결과에서 체크한 노트들을 한 번에 병합 (새 토픽 제목 직접 입력 가능)
async function openBatchMerge(wrap) {
  const checked = [...wrap.querySelectorAll('.note-card-check:checked')].map(c => c.dataset.filename);
  if (checked.length === 0) { showToast('병합할 노트를 체크해주세요'); return; }
  if (wrap.querySelector('.batch-merge-config')) return; // 이미 열림

  let topics = [];
  try { topics = (await apiFetch('/api/topics').then(r => r.json())).topics || []; } catch (_) { /* 목록 없어도 새 토픽은 가능 */ }

  const cfg = document.createElement('div');
  cfg.className = 'batch-merge-config';
  cfg.style.cssText = 'margin:8px 0;padding:10px;border:1px solid #4a6cf7;border-radius:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;';

  const info = document.createElement('span');
  info.textContent = `${checked.length}개 병합 →`;

  const select = document.createElement('select');
  const optNew = document.createElement('option');
  optNew.value = '__new__';
  optNew.textContent = '+ 새 토픽으로';
  select.appendChild(optNew);
  topics.filter(t => !checked.includes(t.filename)).forEach(t => {
    const o = document.createElement('option');
    o.value = t.filename;
    o.textContent = t.title;
    select.appendChild(o);
  });

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.placeholder = '새 토픽 제목 (비우면 자동)';
  titleInput.style.cssText = 'padding:6px;border:1px solid #ccc;border-radius:6px;font-size:14px;';
  const syncTitle = () => { titleInput.style.display = select.value === '__new__' ? '' : 'none'; };
  select.addEventListener('change', syncTitle);
  syncTitle();

  const ok = document.createElement('button');
  ok.className = 'note-card-remove';
  ok.textContent = '병합 실행';
  ok.addEventListener('click', async () => {
    ok.disabled = true;
    ok.textContent = '병합 중…';
    const targetFilename = select.value === '__new__' ? null : select.value;
    const newTitle = select.value === '__new__' ? titleInput.value.trim() : null;
    try {
      const res = await apiFetch('/api/notes/merge', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ filenames: checked, targetFilename, newTitle }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.createdNew ? `새 토픽 "${data.title}"으로 ${checked.length}개 병합` : `"${data.title}"에 ${checked.length}개 병합`);
        checked.forEach(fn => {
          const c = wrap.querySelector(`.note-card[data-filename="${fn}"]`);
          if (c) c.remove();
          removeActiveNote(fn);
        });
        cfg.remove();
      } else {
        showToast(`오류: ${data.error}`);
        ok.disabled = false;
        ok.textContent = '병합 실행';
      }
    } catch (_) {
      showToast('서버 연결 오류');
      ok.disabled = false;
      ok.textContent = '병합 실행';
    }
  });

  const cancel = document.createElement('button');
  cancel.className = 'note-card-remove';
  cancel.textContent = '취소';
  cancel.addEventListener('click', () => cfg.remove());

  cfg.append(info, select, titleInput, ok, cancel);
  wrap.querySelector('.search-header').after(cfg);
}

function makeNoteCard(note) {
  const card = document.createElement('div');
  card.className = 'note-card';
  card.dataset.filename = note.filename;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'note-card-check';
  checkbox.dataset.filename = note.filename;
  checkbox.title = '병합 선택';
  checkbox.style.marginRight = '6px';

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

  const archiveBtn = document.createElement('button');
  archiveBtn.className = 'note-card-remove';
  archiveBtn.textContent = '보관';
  archiveBtn.title = '노트를 _archive로 숨김 (검색·그래프 제외, /archived에서 복원)';
  archiveBtn.addEventListener('click', () => archiveNoteFromUi(note.filename, archiveBtn, card));

  const mergeBtn = document.createElement('button');
  mergeBtn.className = 'note-card-remove';
  mergeBtn.textContent = '병합';
  mergeBtn.title = '이 노트를 다른 토픽에 흡수하거나 새 토픽으로 묶기';
  mergeBtn.addEventListener('click', () => mergeNoteFromCard(note.filename, card));

  card.append(checkbox, title, excerpt, removeBtn, archiveBtn, mergeBtn);
  return card;
}

async function archiveNoteFromUi(filename, btn, card) {
  btn.disabled = true;
  btn.textContent = '보관 중…';
  try {
    const res = await apiFetch('/api/notes/archive', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ filename }),
    });
    const data = await res.json();
    if (data.success) {
      removeActiveNote(filename);
      if (card) card.remove();
      showToast('보관됨 — /archived에서 복원 가능');
    } else {
      btn.disabled = false;
      btn.textContent = '보관';
      showToast(`오류: ${data.error}`);
    }
  } catch (_) {
    btn.disabled = false;
    btn.textContent = '보관';
    showToast('서버 연결 오류');
  }
}

async function handleArchiveCommand(query) {
  document.querySelector('.welcome')?.remove();
  appendUserBubble(`/archive ${query}`);

  const loadingEl = appendLoading();
  try {
    const res = await apiFetch(`/api/vault/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    loadingEl.remove();

    if (data.error) { appendError(data.error); return; }
    const results = Array.isArray(data.results) ? data.results : [];
    if (results.length === 0) {
      appendError(`"${query}" 관련 노트를 찾지 못했습니다.`);
      return;
    }

    if (results.length === 1) {
      await archiveNoteByFilename(results[0].filename, results[0].title);
      return;
    }

    renderArchiveCandidates(query, results);
  } catch (_) {
    loadingEl.remove();
    appendError('서버에 연결할 수 없습니다.');
  }
}

async function archiveNoteByFilename(filename, title) {
  try {
    const res = await apiFetch('/api/notes/archive', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ filename }),
    });
    const data = await res.json();
    if (data.success) {
      removeActiveNote(filename);
      showToast(`보관됨: ${title || filename}`);
      renderArchiveCommandResult(title || filename);
    } else {
      appendError(data.error || '보관 실패');
    }
  } catch (_) {
    appendError('서버 연결 오류');
  }
}

function renderArchiveCommandResult(title) {
  const group = document.createElement('div');
  group.className = 'msg-group assistant';
  group.append(makeModelLabel('Archive'));

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = `보관됨: ${title}\n/archived에서 복원할 수 있습니다.`;

  group.appendChild(bubble);
  getMessages().appendChild(group);
  saveUiMessage('assistant', bubble.textContent, 'Archive');
  scrollDown();
}

function renderArchiveCandidates(query, results) {
  const group = document.createElement('div');
  group.className = 'msg-group assistant';
  group.append(makeModelLabel('Archive'));

  const wrap = document.createElement('div');
  wrap.className = 'search-results';

  const header = document.createElement('div');
  header.className = 'search-header';
  header.textContent = `"${query}" 보관 후보 ${results.length}개`;
  wrap.appendChild(header);

  results.forEach(note => wrap.appendChild(renderNoteCard(note)));

  group.appendChild(wrap);
  getMessages().appendChild(group);
  scrollDown();
}

async function handleArchivedList() {
  document.querySelector('.welcome')?.remove();
  appendUserBubble('/archived');

  const loadingEl = appendLoading();
  try {
    const res = await apiFetch('/api/notes/archived');
    const data = await res.json();
    loadingEl.remove();
    if (data.error) { appendError(data.error); return; }
    renderArchivedList(Array.isArray(data.notes) ? data.notes : []);
  } catch (_) {
    loadingEl.remove();
    appendError('서버에 연결할 수 없습니다.');
  }
}

function renderArchivedList(notes) {
  const group = document.createElement('div');
  group.className = 'msg-group assistant';
  group.append(makeModelLabel('Archive'));

  if (notes.length === 0) {
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = '보관된 노트가 없습니다.';
    group.appendChild(bubble);
    getMessages().appendChild(group);
    scrollDown();
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'search-results';
  const header = document.createElement('div');
  header.className = 'search-header';
  header.textContent = `보관된 노트 ${notes.length}개`;
  wrap.appendChild(header);

  notes.forEach(note => {
    const card = document.createElement('div');
    card.className = 'note-card';
    card.dataset.filename = note.filename;

    const title = document.createElement('div');
    title.className = 'note-card-title';
    title.textContent = note.title;

    const meta = document.createElement('div');
    meta.className = 'note-card-excerpt';
    meta.textContent = note.noteType || '';

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'note-card-remove';
    restoreBtn.textContent = '복원';
    restoreBtn.addEventListener('click', () => restoreNoteFromUi(note.filename, restoreBtn, card));

    card.append(title, meta, restoreBtn);
    wrap.appendChild(card);
  });

  group.appendChild(wrap);
  getMessages().appendChild(group);
  scrollDown();
}

async function restoreNoteFromUi(filename, btn, card) {
  btn.disabled = true;
  btn.textContent = '복원 중…';
  try {
    const res = await apiFetch('/api/notes/restore', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ filename }),
    });
    const data = await res.json();
    if (data.success) {
      if (card) card.remove();
      showToast('복원됨');
    } else {
      btn.disabled = false;
      btn.textContent = '복원';
      showToast(`오류: ${data.error}`);
    }
  } catch (_) {
    btn.disabled = false;
    btn.textContent = '복원';
    showToast('서버 연결 오류');
  }
}

async function handleBackup() {
  if (isLoading) return;
  isLoading = true;
  document.getElementById('send-btn').disabled = true;
  document.querySelector('.welcome')?.remove();
  appendUserBubble('/backup');

  const loadingEl = appendLoading();
  document.dispatchEvent(new Event('pet:building'));
  try {
    const res = await apiFetch('/api/backup', { method: 'POST' });
    const data = await res.json();
    loadingEl.remove();
    if (data.error) { appendError(data.error); return; }
    renderBackupResult(data);
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

function renderBackupResult(data) {
  const group = document.createElement('div');
  group.className = 'msg-group assistant';
  group.append(makeModelLabel('Backup'));

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = [
    '백업 완료',
    `DB: ${data.dbFile}`,
    `볼트: ${data.vaultFile}`,
    `오래된 백업 ${data.pruned ?? 0}개 정리 (7일 보관)`,
    `위치: ${data.backupDir}`,
  ].join('\n');

  group.appendChild(bubble);
  getMessages().appendChild(group);
  saveUiMessage('assistant', bubble.textContent, 'Backup');
  scrollDown();
}

async function handleSync() {
  if (isLoading) return;
  isLoading = true;
  document.getElementById('send-btn').disabled = true;
  document.querySelector('.welcome')?.remove();
  appendUserBubble('/sync');

  const loadingEl = appendLoading();
  document.dispatchEvent(new Event('pet:building'));
  try {
    const res = await apiFetch('/api/notes/sync', { method: 'POST' });
    const data = await res.json();
    loadingEl.remove();
    if (data.error) { appendError(data.error); return; }
    renderSyncResult(data);
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

function renderSyncResult(data) {
  const group = document.createElement('div');
  group.className = 'msg-group assistant';
  group.append(makeModelLabel('Sync'));

  const prunedNotes = Array.isArray(data.prunedNotes) ? data.prunedNotes : [];
  const prunedRows = prunedNotes.slice(0, 10).map(n => `- ${n.title || n.filename}`);
  const morePruned = prunedNotes.length > 10 ? `\n...외 ${prunedNotes.length - 10}개` : '';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = [
    '볼트 동기화 완료',
    `등록: ${data.registered ?? 0}개`,
    `정리(삭제된 노트): ${data.pruned ?? 0}개`,
    prunedRows.length ? `\n정리된 노트:\n${prunedRows.join('\n')}${morePruned}` : '',
    '\n새 노트 시맨틱 검색까지 원하면 /embed 실행',
  ].filter(Boolean).join('\n');

  group.appendChild(bubble);
  getMessages().appendChild(group);
  saveUiMessage('assistant', bubble.textContent, 'Sync');
  scrollDown();
}

async function handleGraphReport() {
  if (isLoading) return;
  isLoading = true;
  document.getElementById('send-btn').disabled = true;
  document.querySelector('.welcome')?.remove();
  appendUserBubble('/graph report');

  const loadingEl = appendLoading();
  document.dispatchEvent(new Event('pet:building'));
  try {
    const res = await apiFetch('/api/graph/report', { method: 'POST' });
    const data = await res.json();
    loadingEl.remove();
    if (data.error) { appendError(data.error); return; }
    renderGraphReportResult(data);
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

function renderGraphReportResult(data) {
  const group = document.createElement('div');
  group.className = 'msg-group assistant';
  group.append(makeModelLabel('Graph'));

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = [
    '그래프 리포트 생성 완료',
    `파일: ${data.filename || '_system/GRAPH_REPORT.md'}`,
    `크기: ${data.chars || 0}자`,
  ].join('\n');

  group.appendChild(bubble);
  getMessages().appendChild(group);
  saveUiMessage('assistant', bubble.textContent, 'Graph');
  scrollDown();
}

async function handleAudit() {
  if (isLoading) return;
  isLoading = true;
  document.getElementById('send-btn').disabled = true;
  document.querySelector('.welcome')?.remove();
  appendUserBubble('/audit');

  const loadingEl = appendLoading();
  document.dispatchEvent(new Event('pet:building'));
  try {
    const res = await apiFetch('/api/audit');
    const data = await res.json();
    loadingEl.remove();
    if (data.error) { appendError(data.error); return; }
    renderAuditResult(data);
    document.dispatchEvent(new Event(data.ok ? 'pet:happy' : 'pet:error'));
  } catch (_) {
    loadingEl.remove();
    appendError('서버에 연결할 수 없습니다.');
  } finally {
    isLoading = false;
    document.getElementById('send-btn').disabled = false;
    document.getElementById('input').focus();
  }
}

function renderAuditResult(data) {
  const group = document.createElement('div');
  group.className = 'msg-group assistant';
  group.append(makeModelLabel('검사'));

  const issues = Array.isArray(data.issues) ? data.issues : [];
  const isolated = Array.isArray(data.isolatedTopics) ? data.isolatedTopics : [];
  const large = Array.isArray(data.largeTopics) ? data.largeTopics : [];
  const counts = data.statusCounts || {};

  const issueRows = issues.length
    ? issues.map(item => `- ${item.level.toUpperCase()} ${item.label}: ${item.message}`)
    : ['- 문제 없음'];
  const isolatedRows = isolated.slice(0, 5).map(item => `- ${item.title}`);
  const largeRows = large.slice(0, 5).map(item => `- ${item.title} (${item.qaCount})`);

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = [
    `검사 결과: ${data.ok ? 'OK' : '주의 필요'}`,
    `검증: ${data.validation?.ok ? '통과' : '실패'}`,
    `정책 파일: ${data.policy?.ok ? '정상' : '오류'}`,
    `정리 상태: pending ${counts.pending || 0}, queued ${counts.queued || 0}, failed ${counts.failed || 0}, manual ${counts.needsManualCheck || 0}`,
    `알림: ${(data.notifications || []).length}개`,
    '',
    '이슈',
    issueRows.join('\n'),
    isolatedRows.length ? `\n고립 토픽 후보\n${isolatedRows.join('\n')}` : '',
    largeRows.length ? `\n큰 토픽 후보\n${largeRows.join('\n')}` : '',
  ].filter(Boolean).join('\n');

  group.appendChild(bubble);
  getMessages().appendChild(group);
  saveUiMessage('assistant', bubble.textContent, '검사');
  scrollDown();
}

// ─── 토픽 병합 ────────────────────────────────────────────────────────────────

async function mergeNoteFromCard(filename, card) {
  if (card.querySelector('.merge-picker')) return; // 이미 열림

  let topics = [];
  try {
    const res = await apiFetch('/api/topics');
    topics = (await res.json()).topics || [];
  } catch (_) {
    showToast('토픽 목록을 불러오지 못했습니다.');
    return;
  }

  const picker = document.createElement('div');
  picker.className = 'merge-picker';

  const select = document.createElement('select');
  const optNew = document.createElement('option');
  optNew.value = '__new__';
  optNew.textContent = '+ 새 토픽으로';
  select.appendChild(optNew);
  topics.filter(t => t.filename !== filename).forEach(t => {
    const o = document.createElement('option');
    o.value = t.filename;
    o.textContent = t.title;
    select.appendChild(o);
  });

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.placeholder = '새 토픽 제목 (비우면 자동)';
  titleInput.style.cssText = 'padding:6px;border:1px solid #ccc;border-radius:6px;font-size:14px;';
  const syncTitle = () => { titleInput.style.display = select.value === '__new__' ? '' : 'none'; };
  select.addEventListener('change', syncTitle);
  syncTitle();

  const ok = document.createElement('button');
  ok.className = 'note-card-remove';
  ok.textContent = '병합 실행';
  ok.addEventListener('click', async () => {
    ok.disabled = true;
    ok.textContent = '병합 중…';
    const targetFilename = select.value === '__new__' ? null : select.value;
    const newTitle = select.value === '__new__' ? titleInput.value.trim() : null;
    try {
      const res = await apiFetch('/api/notes/merge', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ filenames: [filename], targetFilename, newTitle }),
      });
      const data = await res.json();
      if (data.success) {
        removeActiveNote(filename);
        card.remove();
        showToast(data.createdNew ? `새 토픽 "${data.title}"으로 병합됨` : `"${data.title}"에 병합됨`);
      } else {
        showToast(`오류: ${data.error}`);
        ok.disabled = false;
        ok.textContent = '병합 실행';
      }
    } catch (_) {
      showToast('서버 연결 오류');
      ok.disabled = false;
      ok.textContent = '병합 실행';
    }
  });

  const cancel = document.createElement('button');
  cancel.className = 'note-card-remove';
  cancel.textContent = '취소';
  cancel.addEventListener('click', () => picker.remove());

  picker.append(select, titleInput, ok, cancel);
  card.appendChild(picker);
}

async function handleMergeCandidates() {
  document.querySelector('.welcome')?.remove();
  appendUserBubble('/merge');

  const loadingEl = appendLoading();
  try {
    const res = await apiFetch('/api/notes/merge-candidates');
    const data = await res.json();
    loadingEl.remove();
    if (data.error) { appendError(data.error); return; }
    renderMergeCandidates(Array.isArray(data.candidates) ? data.candidates : []);
  } catch (_) {
    loadingEl.remove();
    appendError('서버에 연결할 수 없습니다.');
  }
}

function renderMergeCandidates(candidates) {
  const group = document.createElement('div');
  group.className = 'msg-group assistant';
  group.append(makeModelLabel('Merge'));

  if (candidates.length === 0) {
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = '병합 후보가 없습니다. 검색 결과 카드의 "병합" 버튼으로 직접 묶을 수 있어요.';
    group.appendChild(bubble);
    getMessages().appendChild(group);
    scrollDown();
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'search-results';
  const header = document.createElement('div');
  header.className = 'search-header';
  header.textContent = `병합 후보 ${candidates.length}쌍 (유사한 토픽)`;
  wrap.appendChild(header);

  candidates.forEach(c => {
    const card = document.createElement('div');
    card.className = 'note-card';

    const title = document.createElement('div');
    title.className = 'note-card-title';
    title.textContent = `${c.a.title} ↔ ${c.b.title}`;

    const meta = document.createElement('div');
    meta.className = 'note-card-excerpt';
    const tags = [];
    if (c.sources?.includes('codex')) tags.push('Codex 제안');
    if (typeof c.sim === 'number') tags.push(`유사도 ${c.sim}`);
    meta.textContent = `${tags.join(' · ')} · "${c.a.title}"에 "${c.b.title}" 흡수${c.reason ? ` — ${c.reason}` : ''}`;

    const btn = document.createElement('button');
    btn.className = 'note-card-remove';
    btn.textContent = '병합';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '병합 중…';
      try {
        const res = await apiFetch('/api/notes/merge', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ filenames: [c.b.filename], targetFilename: c.a.filename }),
        });
        const data = await res.json();
        if (data.success) {
          card.remove();
          showToast(`"${data.title}"으로 병합됨`);
        } else {
          showToast(`오류: ${data.error}`);
          btn.disabled = false;
          btn.textContent = '병합';
        }
      } catch (_) {
        showToast('서버 연결 오류');
        btn.disabled = false;
        btn.textContent = '병합';
      }
    });

    card.append(title, meta, btn);
    wrap.appendChild(card);
  });

  group.appendChild(wrap);
  getMessages().appendChild(group);
  scrollDown();
}

window.openNotificationsPanel = openNotificationsPanel;

async function openNotificationsPanel() {
  let panel = document.getElementById('notification-center');
  if (!panel) {
    panel = createNotificationsPanel();
    document.body.appendChild(panel);
  }
  applyNotificationPanelPosition(panel);
  panel.classList.add('open');
  await refreshNotificationsPanel(panel);
}

function closeNotificationsPanel() {
  document.getElementById('notification-center')?.classList.remove('open');
}

function createNotificationsPanel() {
  const panel = document.createElement('section');
  panel.id = 'notification-center';
  panel.setAttribute('aria-label', '알림센터');

  const head = document.createElement('div');
  head.className = 'notification-head';
  head.title = '드래그해서 위치 이동';

  const titleWrap = document.createElement('div');
  const kicker = document.createElement('div');
  kicker.className = 'notification-kicker';
  kicker.textContent = 'CLAWD';
  const title = document.createElement('div');
  title.className = 'notification-title';
  title.textContent = '알림센터';
  titleWrap.append(kicker, title);

  const actions = document.createElement('div');
  actions.className = 'notification-actions';
  const refresh = document.createElement('button');
  refresh.className = 'notification-icon-btn';
  refresh.type = 'button';
  refresh.title = '새로고침';
  refresh.textContent = '↻';
  refresh.addEventListener('click', () => refreshNotificationsPanel(panel));
  const close = document.createElement('button');
  close.className = 'notification-icon-btn';
  close.type = 'button';
  close.title = '닫기';
  close.textContent = '×';
  close.addEventListener('click', closeNotificationsPanel);
  actions.append(refresh, close);

  const tabs = document.createElement('div');
  tabs.className = 'notification-tabs';
  [
    ['all', '전체'],
    ['codex', 'Codex'],
    ['system', '시스템'],
  ].forEach(([value, label]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'notification-tab';
    btn.dataset.filter = value;
    btn.textContent = label;
    btn.addEventListener('click', () => {
      panel.dataset.filter = value;
      panel.querySelectorAll('.notification-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.filter === value);
      });
      renderNotificationItems(panel);
    });
    if (value === 'all') btn.classList.add('active');
    tabs.appendChild(btn);
  });

  const body = document.createElement('div');
  body.className = 'notification-body';

  head.append(titleWrap, actions);
  panel.append(head, tabs, body);
  panel.dataset.filter = 'all';
  panel._notifications = [];
  enableNotificationPanelDrag(panel, head);
  return panel;
}

function isNotificationMobileLayout() {
  return window.matchMedia('(max-width: 640px)').matches;
}

function loadNotificationPanelPosition() {
  try {
    const parsed = JSON.parse(localStorage.getItem(notificationPositionKey) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Number.isFinite(parsed.left) || !Number.isFinite(parsed.top)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function applyNotificationPanelPosition(panel) {
  if (isNotificationMobileLayout()) {
    panel.style.left = '';
    panel.style.top = '';
    panel.style.right = '';
    panel.style.bottom = '';
    return;
  }
  const pos = loadNotificationPanelPosition();
  if (!pos) return;
  const width = panel.offsetWidth || 380;
  const height = panel.offsetHeight || 420;
  const left = Math.max(8, Math.min(pos.left, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(pos.top, window.innerHeight - height - 8));
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';
}

function enableNotificationPanelDrag(panel, handle) {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  handle.addEventListener('pointerdown', e => {
    if (e.target.closest('button') || isNotificationMobileLayout()) return;
    const rect = panel.getBoundingClientRect();
    dragging = true;
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    panel.classList.add('dragging');
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    handle.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });

  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    const rect = panel.getBoundingClientRect();
    const left = Math.max(8, Math.min(e.clientX - offsetX, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(e.clientY - offsetY, window.innerHeight - rect.height - 8));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  });

  const endDrag = e => {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove('dragging');
    const rect = panel.getBoundingClientRect();
    localStorage.setItem(notificationPositionKey, JSON.stringify({ left: rect.left, top: rect.top }));
    try { handle.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
}

async function refreshNotificationsPanel(panel) {
  const body = panel.querySelector('.notification-body');
  body.innerHTML = '<div class="notification-empty">알림을 불러오는 중…</div>';
  try {
    const res = await apiFetch('/api/notifications');
    const data = await res.json();
    if (data.error) {
      body.innerHTML = `<div class="notification-empty danger">${escapeHtml(data.error)}</div>`;
      return;
    }
    panel._notifications = Array.isArray(data.notifications) ? data.notifications : [];
    renderNotificationItems(panel);
  } catch (_) {
    body.innerHTML = '<div class="notification-empty danger">서버에 연결할 수 없습니다.</div>';
  }
}

function renderNotificationItems(panel) {
  const body = panel.querySelector('.notification-body');
  const filter = panel.dataset.filter || 'all';
  const items = (panel._notifications || []).filter(item => {
    if (filter === 'all') return true;
    return item.source === filter;
  });

  if (items.length === 0) {
    body.innerHTML = '<div class="notification-empty">표시할 알림이 없습니다.</div>';
    return;
  }

  body.innerHTML = '';
  items.forEach(item => body.appendChild(makeNotificationCard(item)));
}

function makeNotificationCard(item) {
  const card = document.createElement('article');
  card.className = `notification-card type-${item.type || 'review'}`;

  const top = document.createElement('div');
  top.className = 'notification-card-top';

  const badge = document.createElement('span');
  badge.className = 'notification-badge';
  badge.textContent = item.title || '알림';

  const source = document.createElement('span');
  source.className = 'notification-source';
  source.textContent = item.source || 'system';
  top.append(badge, source);

  const note = document.createElement('div');
  note.className = 'notification-note';
  note.textContent = item.note?.title || '관련 노트 없음';

  const text = document.createElement('div');
  text.className = 'notification-text';
  text.textContent = item.text || '';

  const footer = document.createElement('div');
  footer.className = 'notification-footer';
  const file = document.createElement('span');
  file.className = 'notification-file';
  file.textContent = item.note?.filename || '';
  footer.appendChild(file);

  const actionWrap = document.createElement('div');
  actionWrap.className = 'notification-card-actions';

  const approve = document.createElement('button');
  approve.type = 'button';
  approve.className = 'notification-action primary';
  approve.textContent = notificationPrimaryActionLabel(item);
  approve.addEventListener('click', () => handleNotificationDecision(item, 'approve', card));

  const ignore = document.createElement('button');
  ignore.type = 'button';
  ignore.className = 'notification-action';
  ignore.textContent = '무시';
  ignore.addEventListener('click', () => handleNotificationDecision(item, 'ignore', card));

  actionWrap.append(approve, ignore);
  footer.appendChild(actionWrap);

  card.append(top, note, text, footer);
  return card;
}

function notificationPrimaryActionLabel(item) {
  if (item.type === 'merge') return '병합 실행';
  if (item.type === 'split' && item.executable) return '분리 실행';
  if (item.type === 'policy' && item.executable) return '정책 적용';
  return '검토 완료';
}

async function handleNotificationDecision(item, action, card) {
  const buttons = card.querySelectorAll('button');
  buttons.forEach(btn => { btn.disabled = true; });
  try {
    const res = await apiFetch(`/api/notifications/${encodeURIComponent(item.id)}/${action}`, { method: 'POST' });
    const data = await res.json();
    if (!data.success) {
      showToast(data.error || '알림 처리 실패');
      buttons.forEach(btn => { btn.disabled = false; });
      return;
    }

    const panel = document.getElementById('notification-center');
    if (panel) {
      panel._notifications = (panel._notifications || []).filter(n => n.id !== item.id);
      renderNotificationItems(panel);
    } else {
      card.remove();
    }
    showToast(action === 'approve' ? notificationDoneMessage(item) : '무시됨');
  } catch (_) {
    showToast('서버 연결 오류');
    buttons.forEach(btn => { btn.disabled = false; });
  }
}

function notificationDoneMessage(item) {
  if (item.type === 'merge') return '병합됨';
  if (item.type === 'split' && item.executable) return '분리됨';
  if (item.type === 'policy' && item.executable) return '정책 파일에 반영됨';
  return '검토 완료';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
      res = await apiFetch('/api/memory');
    } else if (action === 'add') {
      if (!value) {
        loadingEl.remove();
        appendError('저장할 메모리를 입력해주세요. 예: /memory add 앞으로 말 편하게 해');
        return;
      }
      res = await apiFetch('/api/memory', {
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
      res = await apiFetch(`/api/memory/${encodeURIComponent(value)}`, { method: 'DELETE' });
    } else if (action === 'clear') {
      res = await apiFetch('/api/memory', { method: 'DELETE' });
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
    const res = await apiFetch('/api/save-note', {
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
