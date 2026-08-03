'use strict';

// 단일 사용자 비서: 모든 기기가 같은 대화를 이어가도록 고정 세션 ID를 공유한다.
// (지식/노트는 원래 서버에서 공유되고, 이 값으로 라이브 대화 thread까지 기기 간 공유)
const sessionId = 'shared-main';
// 이름 변경 뒤에도 기존 브라우저 기록과 토큰을 그대로 이어 쓴다.
const uiHistoryKey = `councilUiHistory:${sessionId}`;
const activeNotesKey = `councilActiveNotes:${sessionId}`;
const apiTokenKey = 'councilApiToken';
const PROGRESS_STAGE_LABELS = Object.freeze({
  context: '기억 찾는 중…',
  evidence: '근거 확인 중…',
  web_search: '웹 검색 중…',
  paper_search: '논문 전문 검색 중…',
  paper_read: '논문 전문 읽는 중…',
  schedule_prepare: '일정 확인 중…',
  answer: '답변 작성 중…',
  council_draft: 'Claude 초안 작성 중…',
  council_critique: 'GPT 검증 중…',
  council_review: '심층 재검증 중…',
  council_synthesis: 'Claude가 최종 정리 중…',
});
let isLoading        = false;
let councilDraftMode = 'compressed'; // 'compressed' | 'full' | 'deep'
let activeNotes      = loadStoredActiveNotes(); // 활성 참조 노트 목록
let isRestoringHistory = false;
let tasksEnabled = false;
let taskRefreshTimer = null;
const slashCommands = [
  { command: '/search ', title: '노트 검색', description: 'vault에서 관련 노트를 찾아 필요한 항목을 선택' },
  { command: '/paper ', title: '논문 검색', description: 'Semantic Scholar에서 관련 논문 검색' },
  { command: '/web ', title: '웹 검색', description: '외부 웹 검색 결과를 같은 근거로 모델에 주입' },
  { command: '/save ', title: '문서 저장', description: '입력한 내용을 옵시디언 노트로 저장' },
  { command: '/embed', title: '임베딩 생성', description: '모든 노트의 시맨틱 검색용 임베딩 생성' },
  { command: '/organize', title: '정리 상태', description: 'Codex 정리 대기 노트 상태 조회' },
  { command: '/organize process', title: '대기 job 실행', description: '이미 큐에 있는 Codex 정리 job 하나를 수동 실행' },
  { command: '/organize all', title: '전체 재정리', description: '모든 활성 노트를 Codex로 다시 정리' },
  { command: '/archive ', title: '노트 보관', description: '검색어로 노트를 찾아 _archive로 보관' },
  { command: '/archived', title: '보관함', description: '숨긴(보관한) 노트 목록 — 복원 가능' },
  { command: '/backup', title: '백업', description: '볼트+DB를 지금 백업 (자동: 하루 1회, 7일 보관)' },
  { command: '/sync', title: '볼트 동기화', description: '옵시디언 직접 편집 반영 — 신규 노트 등록 + 삭제 노트 정리' },
  { command: '/graph report', title: '그래프 리포트', description: '연결/고립/큰 토픽 요약 리포트 생성' },
  { command: '/audit', title: '시스템 검사', description: '검증, 정리 상태, 알림, 고립 토픽을 한 번에 점검' },
  { command: '/merge', title: '토픽 병합', description: '유사한 토픽 병합 후보 — 검색 카드의 "병합"으로 직접 묶기도 가능' },
  { command: '/split ', title: '노트 분리', description: '노트의 Q&A를 제목별로 골라 새 토픽으로 분리 (제목으로 노트 검색)' },
  { command: '/notifications', title: '알림센터', description: '서재에서 Codex 제안과 시스템 알림 보기' },
  { command: '/task ', title: '일정 추가', description: 'LLM 없이 할 일과 알림을 직접 등록', feature: 'tasks' },
  { command: '/today', title: '오늘 일정', description: '오늘과 지연된 할 일을 바로 보기', feature: 'tasks' },
  { command: '/memory', title: '메모리 보기', description: '항상 참조되는 사용자 메모리 목록 표시' },
  { command: '/memory add ', title: '메모리 추가', description: '항상 참조할 말투, 선호, 규칙 저장' },
  { command: '/memory remove ', title: '메모리 삭제', description: '번호로 메모리 항목 삭제' },
  { command: '/memory clear', title: '메모리 초기화', description: '저장된 사용자 메모리 전체 삭제' },
];
const ASSISTANT_TOOL_GROUPS = [
  { label: '검색', commands: ['/search ', '/web '] },
  { label: '서재', commands: ['/notifications', '/memory', '/memory add '] },
  { label: '관리', commands: ['/organize', '/graph report', '/audit', '/organize all'] },
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

async function readProgressResponse(response, onStage = () => {}, onSpeech = null) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/x-ndjson')) return response.json();

  let buffer = '';
  let terminalEvent = null;

  const consumeLine = line => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'stage' && PROGRESS_STAGE_LABELS[event.stage]) {
      onStage(event.stage);
    } else if (event.type === 'speech') {
      // 음성만 소비한다. 화면 답변은 아래 result 한 번으로 그린다.
      onSpeech?.(event.text);
    } else if (event.type === 'result' || event.type === 'error') {
      terminalEvent = event;
    }
  };

  const consumeText = (text, flush = false) => {
    buffer += text;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    lines.forEach(consumeLine);
    if (flush && buffer.trim()) {
      consumeLine(buffer);
      buffer = '';
    }
  };

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      consumeText(decoder.decode(value, { stream: true }));
    }
    consumeText(decoder.decode(), true);
  } else {
    consumeText(await response.text(), true);
  }

  if (!terminalEvent) throw new Error('서버 진행 응답이 완료되지 않았습니다.');
  if (terminalEvent.type === 'error') {
    return { error: terminalEvent.error || '요청 처리 중 오류가 발생했습니다.' };
  }
  return terminalEvent.data;
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
  document.body.dataset.activeModel = 'gpt';

  try {
    const config = await apiFetch('/api/config').then(r => r.json());
    if (ensureApiToken(config)) return;
    tasksEnabled = config.tasksEnabled === true;
    initPaperPanel();
    document.getElementById('model-indicator').textContent =
      `XION · ${config.gptChatBootstrapModel}`;
    renderWebUsagePill(config.webSearch);
    window.VoiceRealtime?.init({
      apiFetch,
      showToast,
      config: config.realtimeVoice,
    });
    window.VoiceHalfDuplexUi?.init({
      apiFetch,
      showToast,
      config: config.halfDuplexVoice,
      // 음성 턴도 텍스트와 같은 경로로 보내 shared-main에 저장되고 메인 채팅에 그려진다.
      askAssistant: (transcript, onSpeech) =>
        sendSingleMessage({ overrideText: transcript, source: 'voice', onSpeech }),
      // 말로 등록·취소할 때 음성이 새 요청을 만들지 않고 카드 버튼과 같은 경로를 부른다.
      pendingConfirmation: () => window.TaskPanel?.getPendingScheduleConfirmation() || null,
    });
    window.ChatModelPicker?.init({
      apiFetch,
      showToast,
      isAnswering: () => isLoading,
    });
  } catch (_) {
    initPaperPanel();
    appendError('서버에 연결할 수 없습니다. node server.js가 실행 중인지 확인해주세요.');
  }

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
  openInitialPanelFromUrl();
  startTaskRefresh();
  setInterval(pollForUpdates, 7000);
  updateNotesBar();
}

function initAssistantTools() {
  const toggle = document.getElementById('assistant-tools-toggle');
  const menu = document.getElementById('assistant-tools-menu');
  if (!toggle || !menu) return;

  ASSISTANT_TOOL_GROUPS.forEach(group => {
    const section = document.createElement('section');
    section.className = 'assistant-tools-group';

    const label = document.createElement('span');
    label.className = 'assistant-tools-label';
    label.textContent = group.label;
    section.appendChild(label);

    group.commands.forEach(command => {
      const item = slashCommands.find(candidate => candidate.command === command);
      if (!item) return;
      const button = document.createElement('button');
      button.className = 'assistant-tools-item';
      button.type = 'button';
      button.textContent = item.title;
      button.addEventListener('click', () => runAssistantTool(command));
      section.appendChild(button);
    });

    menu.appendChild(section);
  });

  toggle.addEventListener('click', event => {
    event.stopPropagation();
    setAssistantToolsOpen(menu.hidden);
  });

  document.addEventListener('click', event => {
    if (!event.target.closest('#assistant-tools')) setAssistantToolsOpen(false);
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || menu.hidden) return;
    setAssistantToolsOpen(false);
    toggle.focus();
  });
}

function setAssistantToolsOpen(open) {
  const toggle = document.getElementById('assistant-tools-toggle');
  const menu = document.getElementById('assistant-tools-menu');
  if (!toggle || !menu) return;
  menu.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'XION 도구 닫기' : 'XION 도구 열기');
}

function runAssistantTool(command) {
  const input = document.getElementById('input');
  if (!input) return;
  setAssistantToolsOpen(false);
  input.value = command;
  input.focus();
  input.dispatchEvent(new Event('input', { bubbles: true }));
  if (!command.endsWith(' ')) sendMessage();
}

function renderWebUsagePill(webSearch) {
  const pill = document.getElementById('web-usage-pill');
  if (!pill) return;

  if (!webSearch?.enabled) {
    pill.textContent = 'Web off';
    pill.classList.remove('warn');
    pill.title = '외부 검색 비활성화';
    return;
  }

  const credits = Number(webSearch.usage?.credits || 0);
  const softLimit = Number(webSearch.softLimit || 0);
  const requestCount = Number(webSearch.usage?.requestCount || 0);
  pill.textContent = softLimit > 0 ? `Web ${credits}/${softLimit}` : `Web ${credits}`;
  pill.classList.toggle('warn', softLimit > 0 && credits >= softLimit * 0.8);
  pill.title = `이번 달 ${webSearch.provider || 'web'} 사용량: ${credits} credits / ${softLimit || 'limit 없음'} · ${requestCount} requests`;
}

async function refreshWebUsagePill() {
  try {
    const config = await apiFetch('/api/config').then(r => r.json());
    if (!config.requiresApiToken) renderWebUsagePill(config.webSearch);
  } catch (_) {
    // 사용량 갱신 실패는 답변 흐름을 막지 않는다.
  }
}

// ─── 히스토리 복원 ───────────────────────────────────────────────────────────

let lastRenderedMsgId = 0;
let lastRenderedSaveSignature = '';
let renderedSavedMessageIds = new Set();

function getNoteSaveSignature(messages) {
  return messages
    .filter(message => message.noteSaved)
    .map(message => message.id)
    .join(',');
}

function rememberMessageSaved(messageId) {
  const id = Number(messageId);
  if (!Number.isSafeInteger(id) || id <= 0) return;
  renderedSavedMessageIds.add(String(id));
  lastRenderedSaveSignature = [...renderedSavedMessageIds]
    .map(Number)
    .sort((a, b) => a - b)
    .join(',');
}

function syncRenderedSaveButtons(messages) {
  renderedSavedMessageIds = new Set(
    messages
      .filter(message => message.noteSaved)
      .map(message => String(message.id))
  );
  document.querySelectorAll('.save-btn[data-message-id]').forEach(button => {
    if (renderedSavedMessageIds.has(button.dataset.messageId)) {
      markSaveButtonSaved(button);
    }
  });
  lastRenderedSaveSignature = getNoteSaveSignature(messages);
}

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
        appendHistoryBubble(msg.content, msg.model, msg.id, lastUserContent, msg.noteSaved);
      }
    });
  } finally {
    isRestoringHistory = false;
  }
  lastRenderedMsgId = messages.length ? (messages[messages.length - 1].id || 0) : 0;
  syncRenderedSaveButtons(messages);
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

// 다른 기기에서 온 새 메시지 자동 반영: 7초마다, 탭 보일 때만, 메시지나 저장 상태가 바뀌었을 때 다시 그림.
async function pollForUpdates() {
  if (document.hidden || isLoading) return;
  if (document.querySelector('.council-loading')) return;
  try {
    const res = await apiFetch(`/api/sessions/${sessionId}`);
    if (!res.ok) return;
    const { messages } = await res.json();
    if (!messages || messages.length === 0) return;
    const latestId = messages[messages.length - 1].id || 0;
    const saveSignature = getNoteSaveSignature(messages);
    if (latestId === lastRenderedMsgId && saveSignature === lastRenderedSaveSignature) return;
    if (latestId === lastRenderedMsgId) {
      syncRenderedSaveButtons(messages);
      return;
    }
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

function appendHistoryBubble(content, model, messageId, question, noteSaved = false) {
  const councilData = parseCouncilTranscript(content, model);
  if (councilData) {
    renderRestoredCouncilMessage(councilData, messageId, noteSaved);
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
    if (Number.isSafeInteger(Number(messageId)) && Number(messageId) > 0) {
      saveBtn.dataset.messageId = String(messageId);
    }
    if (noteSaved) {
      markSaveButtonSaved(saveBtn);
    } else {
      saveBtn.addEventListener('click', () => showSaveConfirm(saveBtn, () => saveNote(saveBtn, {
        question,
        reply:   content,
        model:   model || 'AI',
        modelId: null,
        messageId,
      })));
    }
    group.appendChild(saveBtn);
  }

  getMessages().appendChild(group);
  scrollDown();
}

function parseCouncilTranscript(content, model) {
  const text = String(content || '');
  const modelText = String(model || '');
  if (!modelText.includes('의회') && !/^## 질문\n/.test(text)) return null;

  // 섹션 구분자(\n\n---\n\n)는 종합 본문 속 마크다운 수평선과 형태가 같다.
  // 뒤에 실제 의회 헤딩이 오는 구분자에서만 쪼개야 본문 수평선에서 잘리지 않는다.
  const SECTION_HEADINGS = ['질문', 'Claude 초안', 'GPT 검증', '의회 설정', 'Claude 수정 초안', 'GPT 재검증', '검증 반영', '종합', 'Web sources'];
  const sectionSep = new RegExp(`\\n\\n---\\n\\n(?=## (?:${SECTION_HEADINGS.join('|')})(?:\\n|$))`);
  const sections = text.split(sectionSep).map(section => section.trim()).filter(Boolean);
  const getSection = (heading) => {
    const section = sections.find(item => item.startsWith(`## ${heading}`));
    const match = section?.match(/^## [^\n]+\n([\s\S]*)$/);
    return match ? match[1].trim() : null;
  };

  const SENTINEL = '응답 없음';
  const synthesisSection = sections.find(item => item.startsWith('## 종합'));
  const synthesisMatch = synthesisSection?.match(/^## 종합\n([\s\S]*)$/);
  const question = getSection('질문');
  const claudeDraftRaw = getSection('Claude 초안');
  const claudeDraft = claudeDraftRaw === SENTINEL ? null : claudeDraftRaw;
  const gptCritiqueRaw = getSection('GPT 검증');
  const gptCritique = gptCritiqueRaw === '검증 없음' ? null : gptCritiqueRaw;
  const synthesis = synthesisMatch ? synthesisMatch[1].trim() : null;
  if (!question || !synthesis || !claudeDraft) return null;

  const settingsRaw = getSection('의회 설정');
  const parsedMode = settingsRaw?.match(/draftMode: (.+)/)?.[1]?.trim() || null;

  return {
    question,
    claudeDraft,
    gptCritique,
    revisedDraft: getSection('Claude 수정 초안'),
    gptCritique2: getSection('GPT 재검증'),
    divergence: getSection('검증 반영'),
    synthesis,
    synthesizerModelId: null,
    councilDraftMode: parsedMode || 'compressed',
  };
}

function renderRestoredCouncilMessage(data, messageId = null, noteSaved = false) {
  const container = document.createElement('div');
  container.className = 'council-group';

  const tag = document.createElement('div');
  tag.className = 'council-tag';
  tag.textContent = '의회';

  const body = document.createElement('div');
  body.className = 'council-body';

  if (data.claudeDraft) body.appendChild(makeDebateAnswer('Claude 초안', data.claudeDraft, false));
  if (data.gptCritique) body.appendChild(makeDebateAnswer('GPT 검증', data.gptCritique, false));

  if (data.revisedDraft || data.gptCritique2) {
    const reviews = document.createElement('div');
    reviews.className = 'reviews-section';
    if (data.revisedDraft) reviews.appendChild(makeReview('Claude 수정 초안', data.revisedDraft));
    if (data.gptCritique2) reviews.appendChild(makeReview('GPT 재검증', data.gptCritique2));
    body.appendChild(reviews);
  }

  appendSynthesisSection(body, data.question, {
    claudeDraft: data.claudeDraft,
    gptCritique: data.gptCritique,
    councilDraftMode: data.councilDraftMode,
    webSources: [],
  }, {
    revisedDraft: data.revisedDraft,
    gptCritique2: data.gptCritique2,
  }, {
    divergence: data.divergence,
    synthesis: data.synthesis,
    synthesizerModelId: data.synthesizerModelId,
    messageId,
    noteSaved,
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

// ─── 메시지 전송 디스패처 ────────────────────────────────────────────────────

function sendMessage() {
  const inputEl = document.getElementById('input');
  const text = inputEl.value.trim();
  hideCommandPalette();
  if (text === '/task' || text.startsWith('/task ')) {
    inputEl.value = '';
    inputEl.style.height = 'auto';
    if (!tasksEnabled) {
      showToast('일정 기능이 아직 비활성화되어 있어');
      return;
    }
    openTaskComposer(text.slice(5).trim());
    return;
  }
  if (text === '/today') {
    inputEl.value = '';
    inputEl.style.height = 'auto';
    if (!tasksEnabled) {
      showToast('일정 기능이 아직 비활성화되어 있어');
      return;
    }
    openTaskList('today');
    return;
  }
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
  if (text === '/paper' || text.startsWith('/paper ')) {
    const query = text.slice(6).trim();
    inputEl.value = '';
    inputEl.style.height = 'auto';
    if (query) handlePaperSearch(query);
    else appendError('논문 검색어를 입력해주세요.');
    return;
  }
  if (text.startsWith('/web ')) {
    const query = text.slice(5).trim();
    inputEl.value = '';
    inputEl.style.height = 'auto';
    if (query) {
      const opts = { overrideText: query, displayText: `/web ${query}`, webSearch: true };
      sendSingleMessage(opts);
    }
    return;
  }
  if (text === '/organize all') {
    inputEl.value = '';
    inputEl.style.height = 'auto';
    handleOrganizeAll(true);
    return;
  }
  if (text === '/organize process') {
    inputEl.value = '';
    inputEl.style.height = 'auto';
    handleOrganizeProcess();
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
  if (text.startsWith('/split ')) {
    const query = text.slice(7).trim();
    inputEl.value = '';
    inputEl.style.height = 'auto';
    handleSplit(query);
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
  sendSingleMessage();
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

  const availableCommands = slashCommands.filter(command => command.feature !== 'tasks' || tasksEnabled);
  const matched = availableCommands.filter(cmd => cmd.command.startsWith(value) || value.startsWith(cmd.command.trim()));
  const commands = matched.length > 0 ? matched : availableCommands;
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

// 음성처럼 UI 밖에서 부르는 호출자를 위해 결과를 돌려준다. 거절 사유를 구분해야
// 음성 루프가 "잠깐만"과 "못 만들었어"를 다르게 복구할 수 있다.
async function sendSingleMessage(options = {}) {
  if (isLoading) return { ok: false, reason: 'busy' };
  const inputEl = document.getElementById('input');
  const text = (options.overrideText ?? inputEl.value).trim();
  if (!text) return { ok: false, reason: 'empty' };

  if (!options.overrideText) inputEl.value = '';
  inputEl.style.height = 'auto';
  isLoading = true;
  document.getElementById('send-btn').disabled = true;
  document.querySelector('.welcome')?.remove();

  appendUserBubble(options.displayText || text);
  const loadingEl = appendLoading(PROGRESS_STAGE_LABELS.context);
  document.dispatchEvent(new Event('pet:thinking'));

  try {
    document.dispatchEvent(new Event('pet:building'));
    const res = await apiFetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message: text, model: 'gpt', sessionId, activeNotes, webSearch: !!options.webSearch, source: options.source, progress: true }),
    });
    const data = await readProgressResponse(
      res,
      stage => updateLoadingStage(loadingEl, stage),
      options.onSpeech,
    );
    loadingEl.remove();
    if (data.error) {
      appendError(data.error);
      return { ok: false, reason: 'error' };
    }
    appendAssistantBubble({ ...data, question: text });
    if (Array.isArray(data.webSources) && data.webSources.length > 0) refreshWebUsagePill();
    lastRenderedMsgId = data.messageId || lastRenderedMsgId; // 방금 보낸 건 폴링이 다시 안 그리게
    document.dispatchEvent(new Event('pet:happy'));
    return { ok: true, reply: data.reply || '', spokenRemaining: data.spokenRemaining || '' };
  } catch (_) {
    loadingEl.remove();
    appendError('서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해주세요.');
    return { ok: false, reason: 'error' };
  } finally {
    isLoading = false;
    document.getElementById('send-btn').disabled = false;
    // 핸즈프리 음성 턴에서 focus를 잡으면 모바일 키보드가 올라온다.
    if (!options.overrideText) inputEl.focus();
  }
}

// ─── 의회 모드 ────────────────────────────────────────────────────────────────

async function sendCouncilMessage(options = {}) {
  if (isLoading) return;
  const inputEl = document.getElementById('input');
  const text = (options.overrideText ?? inputEl.value).trim();
  if (!text) return;

  if (!options.overrideText) inputEl.value = '';
  inputEl.style.height = 'auto';
  isLoading = true;
  document.getElementById('send-btn').disabled = true;
  document.querySelector('.welcome')?.remove();

  appendUserBubble(options.displayText || text);

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
  const loadingEl = createCouncilLoadingEl(PROGRESS_STAGE_LABELS.context);
  body.appendChild(loadingEl);
  scrollDown();
  document.dispatchEvent(new Event('pet:building'));

  try {
    // ── 1단계: Claude 초안 + GPT 비평 ──────────────────────────────
    const debateRes = await apiFetch('/api/council/debate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ question: text, sessionId, councilDraftMode, activeNotes, webSearch: !!options.webSearch, progress: true }),
    });
    const debateData = await readProgressResponse(debateRes, stage => updateLoadingStage(loadingEl, stage));

    if (debateData.error) {
      loadingEl.remove();
      appendCouncilError(body, debateData.error);
      return;
    }

    renderInitialAnswers(body, loadingEl, debateData);
    if (Array.isArray(debateData.webSources) && debateData.webSources.length > 0) refreshWebUsagePill();

    // ── 2단계: 심층 재비평 루프 (Claude 수정 → GPT 재비평) ─────────
    let reviewData = { revisedDraft: null, gptCritique2: null };

    if (councilDraftMode === 'deep' && debateData.claudeDraft && debateData.gptCritique) {
      updateLoadingText(loadingEl, PROGRESS_STAGE_LABELS.council_review);

      try {
        const reviewRes = await apiFetch('/api/council/review', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            question: text,
            claudeDraft: debateData.claudeDraft,
            gptCritique: debateData.gptCritique,
            councilDraftMode,
            sessionId,
            activeNotes,
            webSources: debateData.webSources || [],
            paperEvidenceRefs: debateData.paperEvidenceRefs || [],
          }),
        });
        reviewData = await reviewRes.json();
        if (!reviewData.error) renderReviews(body, loadingEl, reviewData);
      } catch (_) {
        // 재비평 실패는 전체 실패로 만들지 않음
      }
    }

    loadingEl.remove();

    // ── 3단계: Claude 최종 (종합자 고정 — 선택 없음) ───────────────
    if (debateData.claudeDraft) {
      await finalizeCouncil(container, body, text, debateData, reviewData);
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

function createProgressDots() {
  const dots = document.createElement('span');
  dots.className = 'progress-dots';
  dots.setAttribute('aria-hidden', 'true');
  dots.innerHTML = '<span></span><span></span><span></span>';
  return dots;
}

function createCouncilLoadingEl(msg) {
  const wrap = document.createElement('div');
  wrap.className = 'council-loading';
  wrap.setAttribute('role', 'status');
  wrap.setAttribute('aria-live', 'polite');
  const txt = document.createElement('span');
  txt.className = 'loading-text';
  txt.textContent = msg;
  wrap.append(createProgressDots(), txt);
  return wrap;
}

function updateLoadingText(loadingEl, msg) {
  const txt = loadingEl.querySelector('.loading-text');
  if (txt) txt.textContent = msg;
}

function updateLoadingStage(loadingEl, stage) {
  const label = PROGRESS_STAGE_LABELS[stage];
  if (label) updateLoadingText(loadingEl, label);
}

// ── 1차 답변 렌더링 ────────────────────────────────────────────────────────

function renderInitialAnswers(body, loadingEl, debateData) {
  const isCompressed = debateData.councilDraftMode !== 'full';

  // Claude 초안 (앞무대)
  const draftEl = debateData.claudeDraft
    ? makeDebateAnswer('Claude 초안', debateData.claudeDraft, !isCompressed)
    : makeDebateError('Claude 초안', debateData.claudeError);
  body.insertBefore(draftEl, loadingEl);

  // GPT 검증 (없으면 Claude 단독 강등 안내)
  const critiqueEl = debateData.gptCritique
    ? makeDebateAnswer('GPT 검증', debateData.gptCritique, false)
    : makeDebateNote('GPT 검증', 'GPT 검증 없이 Claude 단독으로 진행합니다.');
  body.insertBefore(critiqueEl, loadingEl);

  scrollDown();
}

function makeDebateNote(modelName, msg) {
  const div = document.createElement('div');
  div.className = 'debate-answer';
  const label = makeModelLabel(modelName);
  const note = document.createElement('div');
  note.className = 'bubble md review-bubble';
  note.style.opacity = '0.7';
  note.textContent = msg;
  div.append(label, note);
  return div;
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

  if (reviewData.revisedDraft) {
    section.appendChild(makeReview('Claude 수정 초안', reviewData.revisedDraft));
  }
  if (reviewData.gptCritique2) {
    section.appendChild(makeReview('GPT 재검증', reviewData.gptCritique2));
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

// ── 최종 (Claude 고정, 선택 없음) ───────────────────────────────────────────

async function finalizeCouncil(container, body, question, debateData, reviewData) {
  const loadingEl = createCouncilLoadingEl(PROGRESS_STAGE_LABELS.council_synthesis);
  body.appendChild(loadingEl);
  scrollDown();

  try {
    const res = await apiFetch('/api/council/synthesize', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        question,
        claudeDraft:  debateData.claudeDraft,
        gptCritique:  debateData.gptCritique,
        revisedDraft: reviewData.revisedDraft,
        gptCritique2: reviewData.gptCritique2,
        sessionId,
        councilDraftMode: debateData.councilDraftMode || councilDraftMode,
        webSources: debateData.webSources || [],
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
  saveUiMessage('assistant', buildCouncilTranscript(question, debateData, reviewData, data), '의회');
  scrollDown();
}

function appendSynthesisSection(body, question, debateData, reviewData, data) {
  const synthSection = document.createElement('div');
  synthSection.className = 'synthesis-section';

  // 검증 반영 (GPT 지적 중 기각한 것 + 이유)
  if (data.divergence) {
    const divLabel = document.createElement('div');
    divLabel.className = 'model-label divergence-label';
    divLabel.textContent = '검증 반영';

    const divBubble = document.createElement('div');
    divBubble.className = 'bubble md divergence-bubble';
    divBubble.innerHTML = DOMPurify.sanitize(marked.parse(data.divergence));

    synthSection.append(divLabel, divBubble);
  }

  // 종합
  const synthLabel = document.createElement('div');
  synthLabel.className = 'model-label synthesis-label';
  synthLabel.textContent = '종합';

  const synthBubble = document.createElement('div');
  synthBubble.className = 'bubble md synthesis-bubble';
  synthBubble.innerHTML = DOMPurify.sanitize(marked.parse(data.synthesis));

  const saveBtn = document.createElement('button');
  saveBtn.className = 'save-btn icon-save-btn';
  saveBtn.title = '노트로 저장';
  saveBtn.setAttribute('aria-label', '노트로 저장');
  saveBtn.innerHTML = saveIconSvg();
  if (Number.isSafeInteger(Number(data.messageId)) && Number(data.messageId) > 0) {
    saveBtn.dataset.messageId = String(data.messageId);
  }
  const noteDraftMode = debateData.councilDraftMode || councilDraftMode;
  if (data.noteSaved) {
    markSaveButtonSaved(saveBtn);
  } else {
    saveBtn.addEventListener('click', () => showSaveConfirm(saveBtn, () => saveCouncilNote(saveBtn, {
      question,
      claudeDraft:      debateData.claudeDraft,
      gptCritique:      debateData.gptCritique,
      revisedDraft:     reviewData.revisedDraft,
      gptCritique2:     reviewData.gptCritique2,
      divergence:       data.divergence,
      synthesis:        data.synthesis,
      messageId:        data.messageId,
      councilDraftMode: noteDraftMode,
      webSources:       debateData.webSources || [],
    })));
    if (!isRestoringHistory) watchMessageSaveState(saveBtn, data.messageId);
  }

  synthSection.append(synthLabel, synthBubble, saveBtn);
  body.appendChild(synthSection);
}

function buildCouncilTranscript(question, debateData, reviewData, data) {
  const sections = [
    `## 질문\n${question}`,
    `## Claude 초안\n${debateData.claudeDraft || '응답 없음'}`,
    `## GPT 검증\n${debateData.gptCritique || '검증 없음'}`,
    `## 의회 설정\ndraftMode: ${debateData.councilDraftMode || 'compressed'}`,
  ];

  if (reviewData.revisedDraft) sections.push(`## Claude 수정 초안\n${reviewData.revisedDraft}`);
  if (reviewData.gptCritique2) sections.push(`## GPT 재검증\n${reviewData.gptCritique2}`);

  if (data.divergence) sections.push(`## 검증 반영\n${data.divergence}`);
  sections.push(`## 종합\n${data.synthesis}`);
  if (Array.isArray(debateData.webSources) && debateData.webSources.length > 0) {
    const sources = debateData.webSources
      .map((source, index) => `${index + 1}. ${source.title || source.url}\n${source.url}`)
      .join('\n\n');
    sections.push(`## Web sources\n${sources}`);
  }
  return sections.join('\n\n---\n\n');
}

// ── 노트 저장 ──────────────────────────────────────────────────────────────

function markSaveButtonSaved(btn) {
  btn.disabled = true;
  btn.innerHTML = checkIconSvg();
  btn.title = '저장됨';
  btn.setAttribute('aria-label', '저장됨');
  btn.classList.remove('error');
  btn.classList.add('saved');
  rememberMessageSaved(btn.dataset.messageId);
}

function watchMessageSaveState(btn, messageId) {
  const id = Number(messageId);
  if (!Number.isSafeInteger(id) || id <= 0) return;

  [1500, 4000].forEach(delay => {
    setTimeout(async () => {
      if (!btn.isConnected || btn.disabled || btn.classList.contains('saved')) return;
      try {
        const res = await apiFetch(`/api/messages/${id}/save-status`);
        if (!res.ok) return;
        const result = await res.json();
        if (result.saved) markSaveButtonSaved(btn);
      } catch (_) {
        // 기존 7초 히스토리 폴링이 최종 상태를 다시 확인한다.
      }
    }, delay);
  });
}

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
      rememberMessageSaved(data.messageId);
      markSaveButtonSaved(btn);
      showToast(result.duplicate ? `이미 저장된 노트야: ${result.title}` : `저장됨: ${result.title}`);
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

async function handlePaperSearch(query) {
  document.querySelector('.welcome')?.remove();
  appendUserBubble(`/paper ${query}`);
  if (!initPaperPanel()) {
    appendError('논문 패널을 불러오지 못했습니다.');
    return;
  }
  await window.PaperPanel.search(query);
}

function initPaperPanel() {
  if (
    !window.PaperPanel
    || !window.NotificationPanel
    || !window.TaskPanel
    || !window.AgentPanel
    || !window.PushClient
  ) return false;
  try {
    window.PushClient.init({ apiFetch });
    window.TaskPanel.init({
      apiFetch,
      showToast,
      onChanged: handleTaskChanged,
      enabled: tasksEnabled,
    });
    window.NotificationPanel.init({
      apiFetch,
      showToast,
      onSplit: filename => {
        window.PaperPanel?.close();
        renderSplitPanel(filename);
      },
      openNote: note => {
        window.PaperPanel?.open('notes');
        window.NotePanel?.open(note);
      },
    });
    window.AgentPanel.init({
      apiFetch,
      enabled: tasksEnabled,
      pushClient: window.PushClient,
      showToast,
    });
    window.PaperPanel.init({
      apiFetch,
      showToast,
      contextNotes: {
        makeToggle: makeContextNoteToggle,
      },
      icons: {
        save: saveIconSvg,
        check: checkIconSvg,
        loading: loadingIconSvg,
      },
    });
    return true;
  } catch (error) {
    console.warn('논문 패널 초기화 실패:', error.message);
    return false;
  }
}

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

async function handleOrganizeProcess() {
  if (isLoading) return;
  isLoading = true;
  document.getElementById('send-btn').disabled = true;
  document.querySelector('.welcome')?.remove();
  appendUserBubble('/organize process');

  document.dispatchEvent(new Event('pet:building'));
  const loadingEl = appendLoading();
  try {
    const res = await apiFetch('/api/organize/process', { method: 'POST' });
    const data = await res.json();
    loadingEl.remove();

    if (!res.ok || data.success === false) {
      appendError(data.error || 'Codex 정리 job 실행에 실패했습니다.');
      return;
    }

    renderOrganizeProcessResult(data);
    document.dispatchEvent(new Event(data.status === 'processed' ? 'pet:happy' : 'pet:error'));
  } catch (_) {
    loadingEl.remove();
    appendError('서버에 연결할 수 없습니다.');
  } finally {
    isLoading = false;
    document.getElementById('send-btn').disabled = false;
    document.getElementById('input').focus();
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
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const statusLabels = {
    pending: '대기',
    running: '실행 중',
    processed: '완료',
    success: '완료',
    failed: '실패',
    needs_manual_check: '수동 확인',
    recovery_required: '원본 복구 필요',
  };
  const jobRows = jobs.map(job => {
    const status = statusLabels[job.status] || job.status || '알 수 없음';
    const attempts = Number.isFinite(Number(job.attemptCount)) ? Number(job.attemptCount) : 0;
    const error = String(job.error || '').trim();
    return `#${job.id} ${status} · 시도 ${attempts}회${error ? `\n  오류: ${error}` : ''}`;
  });
  const runner = data.runner && typeof data.runner === 'object' ? data.runner : null;
  const runnerSummary = runner
    ? `정리 실행기: ${runner.ok ? '정상' : '보류'} (${runner.mode || 'unknown'}${runner.version ? ` · ${runner.version}` : ''})`
    : null;
  const runnerError = runner?.error ? `실행기 오류: ${runner.error}` : null;

  bubble.textContent = [
    runnerSummary,
    runnerError,
    `자동 큐 기준: ${data.autoQueueThreshold || 5}개`,
    `실행 배치: ${data.jobBatchSize || 2}개/job`,
    `정리 대기: ${data.pending || 0}개`,
    `큐 대기: ${data.queued || 0}개`,
    `실행 중: ${data.running || 0}개`,
    `완료: ${data.processed || 0}개`,
    `실패: ${data.failed || 0}개`,
    `수동 확인: ${data.needsManualCheck || 0}개`,
    `원본 복구 필요: ${data.recoveryRequired || 0}개`,
    rows.length ? `\n대기 노트:\n${rows.join('\n')}${more}` : '\n대기 노트 없음',
    jobRows.length ? `\n최근 job:\n${jobRows.join('\n')}` : '\n최근 job 없음',
  ].filter(Boolean).join('\n');

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

  const processedCount = Array.isArray(data.notes) ? data.notes.length : 0;
  const failedCount = Array.isArray(data.failed) ? data.failed.length : 0;
  const skippedCount = Number(data.skippedCount) || 0;
  const statusLabel = data.recoveryRequired
    ? '수동 복구 필요'
    : data.status === 'processed'
    ? (skippedCount > 0 && processedCount === 0 ? '건너뜀' : '완료')
    : data.status === 'pending'
    ? '환경 복구 후 재시도 대기'
    : '실패';
  bubble.textContent = data.processed
    ? [
        `정리 job #${data.jobId} ${statusLabel}`,
        `처리: ${processedCount}개`,
        `실패: ${failedCount}개`,
        skippedCount > 0 ? `건너뜀: ${skippedCount}개` : '',
        data.error ? `오류: ${data.error}` : '',
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
  const skippedCount = batches.reduce((sum, batch) => sum + (Number(batch.skippedCount) || 0), 0);
  const batchRows = batches.map(batch =>
    `${batch.index}. ${batch.status} ` +
    `(처리 ${batch.processedCount || 0} · 실패 ${batch.failedCount || 0} · 건너뜀 ${batch.skippedCount || 0})`
  );
  const failedRows = failed.slice(0, 10).map(item => `- ${item.filename}: ${item.error}`);
  const moreFailed = failed.length > 10 ? `\n...외 ${failed.length - 10}개` : '';

  bubble.textContent = data.processed
    ? [
        '전체 재정리 완료',
        `상태: ${data.status}`,
        `처리: ${data.processedCount || 0}개`,
        `실패: ${data.failedCount || 0}개`,
        `건너뜀: ${skippedCount}개`,
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
  header.textContent = `${results.length}개 발견 — 필요한 노트만 컨텍스트에 추가하거나, 체크해서 병합`;
  wrap.appendChild(header);

  results.forEach(note => {
    wrap.appendChild(makeNoteCard(note));
  });

  // 노트를 체크하는 순간 병합 트레이가 뜨고, 체크할 때마다 카운트 갱신 (이벤트 위임)
  wrap.addEventListener('change', e => {
    if (!e.target.classList.contains('note-card-check')) return;
    e.target.closest('.note-card')?.classList.toggle('note-card-selected', e.target.checked);
    updateMergeTray(wrap);
  });
  wrap.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const tray = wrap.querySelector('.merge-tray:not(.is-hiding)');
    if (tray) clearTraySelection(wrap, tray);
  });

  getMessages().appendChild(wrap);
  scrollDown();
}

// 체크된 노트 수에 따라 병합 트레이를 띄우거나(없으면 생성) 카운트만 갱신
const checkedCount = wrap => wrap.querySelectorAll('.note-card-check:checked').length;

async function updateMergeTray(wrap) {
  let tray = wrap.querySelector('.merge-tray:not(.is-hiding)');

  if (checkedCount(wrap) === 0) {
    if (tray) closeMergeTray(tray);
    return;
  }

  if (!tray) {
    const built = await buildMergeTray(wrap); // 토픽 로드(async) 동안 상태가 바뀔 수 있음
    if (checkedCount(wrap) === 0) return;     // 기다리는 사이 모두 해제됨
    // 동시 호출이 먼저 트레이를 넣었으면 새로 만든 건 버림 (중복 방지)
    tray = wrap.querySelector('.merge-tray:not(.is-hiding)');
    if (!tray) { tray = built; wrap.querySelector('.search-header').after(tray); }
  }
  tray.querySelector('.merge-tray-count').innerHTML = `<b>${checkedCount(wrap)}개</b> 선택됨`;
}

function closeMergeTray(tray) {
  tray.classList.add('is-hiding');
  tray.addEventListener('animationend', () => tray.remove(), { once: true });
  setTimeout(() => tray.remove(), 250); // reduced-motion 등 애니메이션 미발생 대비
}

// ── 노트 분리 (/split) — merge 대칭: 한 노트의 Q&A를 골라 새/기존 토픽으로 떼기 ──
async function handleSplit(query) {
  const q = String(query || '').trim();
  if (!q) { showToast('분리할 노트 제목을 입력해줘 — 예: /split 주식 시장'); return; }
  let notes = [];
  try {
    notes = (await apiFetch('/api/topics').then(r => r.json())).topics || [];
  } catch (_) { showToast('노트 목록을 불러오지 못했어'); return; }
  const lower = q.toLowerCase();
  const matches = notes.filter(n => n.filename === q || String(n.title || '').toLowerCase().includes(lower));
  if (matches.length === 0) { showToast(`"${q}"에 맞는 노트가 없어`); return; }
  if (matches.length > 1) {
    const exact = matches.find(n => String(n.title || '').toLowerCase() === lower);
    if (!exact) {
      showToast(`여러 개 매칭(${matches.length}) — 더 정확히: ${matches.slice(0, 3).map(n => n.title).join(' / ')}`);
      return;
    }
    return renderSplitPanel(exact.filename);
  }
  return renderSplitPanel(matches[0].filename);
}

async function renderSplitPanel(filename) {
  let data, topics = [];
  try {
    data = await apiFetch(`/api/notes/${encodeURIComponent(filename)}/qa-entries`).then(r => r.json());
    topics = (await apiFetch('/api/topics').then(r => r.json())).topics || [];
  } catch (_) { showToast('노트를 불러오지 못했어'); return; }
  if (!data.success) { showToast(data.error || '노트 조회 실패'); return; }
  if (!data.entries.length) { showToast('이 노트엔 분리할 Q&A가 없어'); return; }

  const panel = document.createElement('div');
  panel.className = 'split-panel';

  const head = document.createElement('div');
  head.className = 'split-panel-head';
  head.textContent = `${data.title} — Q&A ${data.entries.length}개, 체크해서 분리`;
  panel.appendChild(head);

  const list = document.createElement('div');
  list.className = 'split-qa-list';
  data.entries.forEach(e => {
    const row = document.createElement('label');
    row.className = 'split-qa-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'split-qa-check';
    cb.dataset.qaid = e.qaId;
    const text = document.createElement('span');
    text.className = 'split-qa-q';
    text.textContent = e.question;
    row.append(cb, text);
    list.appendChild(row);
  });
  panel.appendChild(list);

  // 트레이 (merge-tray 스타일 재활용): 대상 토픽 선택 / 새 토픽 직접 입력
  const tray = document.createElement('div');
  tray.className = 'merge-tray';

  const select = document.createElement('select');
  select.className = 'merge-tray-field';
  select.setAttribute('aria-label', '분리할 대상 토픽');
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
  titleInput.className = 'merge-tray-field merge-tray-title';
  titleInput.placeholder = '새 토픽 제목 (비우면 자동)';
  titleInput.setAttribute('aria-label', '새 토픽 제목');
  const syncTitle = () => { titleInput.hidden = select.value !== '__new__'; };
  select.addEventListener('change', syncTitle);
  syncTitle();

  const ok = document.createElement('button');
  ok.className = 'merge-btn merge-btn--primary';
  ok.textContent = '분리 실행';
  ok.addEventListener('click', () => runSplit(filename, panel, { select, titleInput, ok }));

  const controls = document.createElement('div');
  controls.className = 'merge-tray-controls';
  controls.append(select, titleInput, ok);
  tray.appendChild(controls);
  panel.appendChild(tray);

  getMessages().appendChild(panel);
  scrollDown();
}

async function runSplit(filename, panel, { select, titleInput, ok }) {
  const qaIds = [...panel.querySelectorAll('.split-qa-check:checked')].map(c => c.dataset.qaid);
  if (qaIds.length === 0) { showToast('분리할 Q&A를 체크해줘'); return; }

  ok.disabled = true;
  ok.textContent = '분리 중…';
  const targetFilename = select.value === '__new__' ? null : select.value;
  const newTitle = select.value === '__new__' ? titleInput.value.trim() : null;
  try {
    const res = await apiFetch('/api/notes/split', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceFilename: filename, qaIds, targetFilename, newTitle }),
    });
    const data = await res.json();
    if (!data.success) {
      showToast(data.error || '분리 실패');
      ok.disabled = false;
      ok.textContent = '분리 실행';
      return;
    }
    const where = data.createdNew ? `새 토픽 "${data.title}"` : `"${data.title}"`;
    showToast(`${data.movedCount}개를 ${where}(으)로 분리${data.sourceDeleted ? ' · 빈 원본 삭제' : ''}`);
    panel.remove();
  } catch (_) {
    showToast('서버 연결 오류');
    ok.disabled = false;
    ok.textContent = '분리 실행';
  }
}

// 검색 결과에서 체크한 노트들을 한 번에 병합하는 트레이 (target 토픽 선택 / 새 토픽 직접 입력)
async function buildMergeTray(wrap) {
  let topics = [];
  try { topics = (await apiFetch('/api/topics').then(r => r.json())).topics || []; } catch (_) { /* 목록 없어도 새 토픽은 가능 */ }

  const tray = document.createElement('div');
  tray.className = 'merge-tray';
  tray.setAttribute('role', 'group');
  tray.setAttribute('aria-label', '선택한 노트 병합');

  const count = document.createElement('span');
  count.className = 'merge-tray-count';
  count.setAttribute('aria-live', 'polite');

  const select = document.createElement('select');
  select.className = 'merge-tray-field';
  select.setAttribute('aria-label', '병합할 대상 토픽');
  const optNew = document.createElement('option');
  optNew.value = '__new__';
  optNew.textContent = '+ 새 토픽으로';
  select.appendChild(optNew);
  topics.forEach(t => {
    const o = document.createElement('option');
    o.value = t.filename;
    o.textContent = t.title;
    select.appendChild(o);
  });

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'merge-tray-field merge-tray-title';
  titleInput.placeholder = '새 토픽 제목 (비우면 자동)';
  titleInput.setAttribute('aria-label', '새 토픽 제목');
  const syncTitle = () => { titleInput.hidden = select.value !== '__new__'; };
  select.addEventListener('change', syncTitle);
  syncTitle();

  const ok = document.createElement('button');
  ok.className = 'merge-btn merge-btn--primary';
  ok.textContent = '병합 실행';
  ok.addEventListener('click', () => runTrayMerge(wrap, tray, { select, titleInput, ok }));

  const cancel = document.createElement('button');
  cancel.className = 'merge-btn merge-btn--ghost';
  cancel.textContent = '취소';
  cancel.addEventListener('click', () => clearTraySelection(wrap, tray));

  const actions = document.createElement('div');
  actions.className = 'merge-tray-actions';
  actions.append(cancel, ok);

  const head = document.createElement('div');
  head.className = 'merge-tray-head';
  head.append(count, actions);

  const controls = document.createElement('div');
  controls.className = 'merge-tray-controls';
  controls.append(select, titleInput);

  tray.append(head, controls);
  return tray;
}

// 실행 시점에 선택 상태를 다시 읽어 병합 (트레이 열어둔 채 선택을 바꿔도 정확)
async function runTrayMerge(wrap, tray, { select, titleInput, ok }) {
  const filenames = [...wrap.querySelectorAll('.note-card-check:checked')].map(c => c.dataset.filename);
  if (filenames.length === 0) { showToast('병합할 노트를 체크해주세요'); return; }

  ok.disabled = true;
  ok.textContent = '병합 중…';
  const targetFilename = select.value === '__new__' ? null : select.value;
  const newTitle = select.value === '__new__' ? titleInput.value.trim() : null;
  try {
    const res = await apiFetch('/api/notes/merge', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ filenames, targetFilename, newTitle }),
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.createdNew ? `새 토픽 "${data.title}"으로 ${filenames.length}개 병합` : `"${data.title}"에 ${filenames.length}개 병합`);
      filenames.forEach(fn => {
        wrap.querySelector(`.note-card[data-filename="${fn}"]`)?.remove();
        removeActiveNote(fn);
      });
      tray.remove();
      updateNotesBar();
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
}

// 취소: 선택 전부 해제 + 하이라이트 제거 + 트레이 닫기
function clearTraySelection(wrap, tray) {
  wrap.querySelectorAll('.note-card-check:checked').forEach(c => {
    c.checked = false;
    c.closest('.note-card')?.classList.remove('note-card-selected');
  });
  closeMergeTray(tray);
}

function makeNoteCard(note) {
  const card = document.createElement('div');
  card.className = 'note-card';
  card.dataset.filename = note.filename;
  card.classList.toggle('note-card-context-active', isActiveNote(note.filename));

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'note-card-check';
  checkbox.dataset.filename = note.filename;
  checkbox.title = '병합 선택';

  const title = document.createElement('div');
  title.className = 'note-card-title';
  title.textContent = note.title;

  const excerpt = document.createElement('div');
  excerpt.className = 'note-card-excerpt';
  excerpt.textContent = note.excerpt;

  const contextBtn = makeContextNoteToggle(note);

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

  const actions = document.createElement('div');
  actions.className = 'note-card-actions';
  actions.append(contextBtn, archiveBtn, mergeBtn);

  card.append(checkbox, title, excerpt, actions);
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

  const missingNotes = Array.isArray(data.missingNotes) ? data.missingNotes : [];
  const missingRows = missingNotes.slice(0, 10).map(n => `- ${n.title || n.filename}`);
  const moreMissing = missingNotes.length > 10 ? `\n...외 ${missingNotes.length - 10}개` : '';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = [
    '볼트 동기화 완료',
    `등록: ${data.registered ?? 0}개`,
    `원문 누락 표시: ${data.missing ?? 0}개`,
    missingRows.length ? `\n누락된 노트:\n${missingRows.join('\n')}${moreMissing}` : '',
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
    `정리 상태: pending ${counts.pending || 0}, queued ${counts.queued || 0}, failed ${counts.failed || 0}, manual ${counts.needsManualCheck || 0}, recovery ${counts.recoveryRequired || 0}`,
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
  if (card.querySelector('.merge-tray')) return; // 이미 열림

  let topics = [];
  try {
    const res = await apiFetch('/api/topics');
    topics = (await res.json()).topics || [];
  } catch (_) {
    showToast('토픽 목록을 불러오지 못했습니다.');
    return;
  }

  const picker = document.createElement('div');
  picker.className = 'merge-tray';
  picker.setAttribute('role', 'group');
  picker.setAttribute('aria-label', '이 노트를 병합');

  const label = document.createElement('span');
  label.className = 'merge-tray-count';
  label.textContent = '이 노트를 병합';

  const select = document.createElement('select');
  select.className = 'merge-tray-field';
  select.setAttribute('aria-label', '병합할 대상 토픽');
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
  titleInput.className = 'merge-tray-field merge-tray-title';
  titleInput.placeholder = '새 토픽 제목 (비우면 자동)';
  titleInput.setAttribute('aria-label', '새 토픽 제목');
  const syncTitle = () => { titleInput.hidden = select.value !== '__new__'; };
  select.addEventListener('change', syncTitle);
  syncTitle();

  const ok = document.createElement('button');
  ok.className = 'merge-btn merge-btn--primary';
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
  cancel.className = 'merge-btn merge-btn--ghost';
  cancel.textContent = '취소';
  cancel.addEventListener('click', () => picker.remove());

  const actions = document.createElement('div');
  actions.className = 'merge-tray-actions';
  actions.append(cancel, ok);

  const head = document.createElement('div');
  head.className = 'merge-tray-head';
  head.append(label, actions);

  const controls = document.createElement('div');
  controls.className = 'merge-tray-controls';
  controls.append(select, titleInput);

  picker.append(head, controls);
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

function openNotificationsPanel() {
  if (!initPaperPanel()) return;
  window.PaperPanel.open('notifications');
}

function openTaskComposer(initialTitle = '') {
  if (!initPaperPanel()) return;
  window.PaperPanel.open('agents');
  return window.AgentPanel.openTasks({ compose: true, initialTitle });
}

function openTaskList(view = 'today', options = {}) {
  if (!initPaperPanel()) return;
  window.PaperPanel.open('agents');
  return window.AgentPanel.openTasks({ view, ...options });
}

function openInitialPanelFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('panel') === 'agents' || params.get('notification') === 'tasks') {
    openTaskList('today', { focusReminders: params.get('taskView') === 'reminders' || params.get('notification') === 'tasks' });
  } else if (params.get('panel') === 'notifications') {
    openNotificationsPanel();
  }
}

function refreshTaskViews() {
  if (!tasksEnabled || document.visibilityState !== 'visible') return;
  const panel = document.getElementById('agent-panel');
  if (panel && !panel.hidden) window.AgentPanel?.refresh();
}

function handleTaskChanged() {
  if (!tasksEnabled) return;
  const panel = document.getElementById('agent-panel');
  if (panel && !panel.hidden) window.AgentPanel?.refresh();
}

function startTaskRefresh() {
  if (!tasksEnabled || taskRefreshTimer) return;
  taskRefreshTimer = setInterval(refreshTaskViews, 60_000);
  window.addEventListener('focus', refreshTaskViews);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshTaskViews();
  });
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
  const filename = String(note?.filename || '').trim();
  if (!filename || isActiveNote(filename)) return false;
  const title = String(note?.title || filename).trim() || filename;
  activeNotes.push({ filename, title });
  saveActiveNotes();
  refreshActiveNotesUi();
  return true;
}

function removeActiveNote(filename) {
  const next = activeNotes.filter(n => n.filename !== filename);
  if (next.length === activeNotes.length) return false;
  activeNotes = next;
  saveActiveNotes();
  refreshActiveNotesUi();
  return true;
}

function isActiveNote(filename) {
  return activeNotes.some(note => note.filename === filename);
}

function toggleActiveNote(note) {
  if (!note?.filename) return false;
  if (isActiveNote(note.filename)) removeActiveNote(note.filename);
  else addActiveNote(note);
  return isActiveNote(note.filename);
}

function refreshActiveNotesUi() {
  updateNotesBar();
  syncContextNoteControls();
}

function makeContextNoteToggle(note) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'context-note-toggle';
  button.dataset.contextFilename = note.filename;
  button.dataset.contextBlocked = String(
    ['running', 'recovery_required'].includes(note.codexStatus),
  );
  button.disabled = button.dataset.contextBlocked === 'true';
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    toggleActiveNote(note);
  });
  syncContextNoteToggle(button);
  return button;
}

function syncContextNoteToggle(button) {
  if (button.dataset.contextBlocked === 'true') {
    button.classList.remove('active');
    button.setAttribute('aria-pressed', 'false');
    button.title = '정리 중이거나 원본 복구가 필요한 노트는 컨텍스트에 추가할 수 없음';
    button.setAttribute('aria-label', button.title);
    button.innerHTML = '<span>컨텍스트 사용 불가</span>';
    return;
  }
  const active = isActiveNote(button.dataset.contextFilename);
  button.classList.toggle('active', active);
  button.setAttribute('aria-pressed', String(active));
  button.title = active ? '컨텍스트에서 제거' : '컨텍스트에 추가';
  button.setAttribute('aria-label', button.title);
  button.innerHTML = active
    ? `${checkIconSvg()}<span>컨텍스트 제거</span>`
    : `${plusIconSvg()}<span>컨텍스트 추가</span>`;
}

function syncContextNoteControls() {
  document.querySelectorAll('.context-note-toggle[data-context-filename]').forEach(syncContextNoteToggle);
  document.querySelectorAll('.note-card[data-filename]').forEach(card => {
    card.classList.toggle('note-card-context-active', isActiveNote(card.dataset.filename));
  });
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
      rememberMessageSaved(data.messageId);
      markSaveButtonSaved(btn);
      showToast(result.duplicate ? `이미 저장된 노트야: ${result.title}` : `저장됨: ${result.title}`);
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
      <p>안녕하세요!<br>XION이 이어서 이야기할게.</p>
      <p style="margin-top:10px;font-size:12px;opacity:0.7">입력창의 모델 버튼에서 다음 답변 모델을 바꿀 수 있어.</p>
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
  const actualModel = data.modelId || data.model;

  const label = makeModelLabel(actualModel);

  const bubble = document.createElement('div');
  bubble.className = 'bubble md';
  bubble.innerHTML = DOMPurify.sanitize(marked.parse(data.reply));

  const candidateCard = data.scheduleCandidate
    ? window.TaskPanel?.makeScheduleCandidateCard(data.scheduleCandidate)
    : null;

  group.append(label, bubble);
  if (candidateCard) {
    group.appendChild(candidateCard);
    getMessages().appendChild(group);
    saveUiMessage('assistant', data.reply, actualModel);
    scrollDown();
    return;
  }

  const saveBtn = document.createElement('button');
  saveBtn.className = 'save-btn icon-save-btn';
  saveBtn.title = '노트로 저장';
  saveBtn.setAttribute('aria-label', '노트로 저장');
  saveBtn.innerHTML = saveIconSvg();
  if (Number.isSafeInteger(Number(data.messageId)) && Number(data.messageId) > 0) {
    saveBtn.dataset.messageId = String(data.messageId);
  }
  saveBtn.addEventListener('click', () => showSaveConfirm(saveBtn, () => saveNote(saveBtn, {
    ...data,
    model: actualModel,
  })));

  group.appendChild(saveBtn);
  getMessages().appendChild(group);
  watchMessageSaveState(saveBtn, data.messageId);
  saveUiMessage('assistant', data.reply, actualModel);
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
    if (renderedSavedMessageIds.has(saveBtn.dataset.messageId)) markSaveButtonSaved(saveBtn);
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

function plusIconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>`;
}

function loadingIconSvg() {
  return `<svg class="spin-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.2-8.6"></path></svg>`;
}

function appendLoading(statusText = '') {
  const wrap = document.createElement('div');
  wrap.className = 'msg-group assistant loading-wrap';
  if (statusText) {
    wrap.classList.add('has-status');
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');
    const txt = document.createElement('span');
    txt.className = 'loading-text';
    txt.textContent = statusText;
    wrap.append(createProgressDots(), txt);
  } else {
    wrap.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
  }
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
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#151A18' : '#F3F5F2');
  document.getElementById('icon-moon').style.display = dark ? 'none' : '';
  document.getElementById('icon-sun').style.display  = dark ? ''     : 'none';
}

// ─── 실행 ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => { init(); initTheme(); initAssistantTools(); });
