'use strict';

const sessionId      = crypto.randomUUID();
let currentModel     = 'claude';
let isLoading        = false;
let councilMode      = false;
let councilAvailable = false;

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

  document.getElementById('send-btn').addEventListener('click', sendMessage);

  document.getElementById('input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  document.getElementById('input').addEventListener('input', autoResize);
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
      body:    JSON.stringify({ message: text, model: currentModel, sessionId }),
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
  const container = appendCouncilLoading('두 AI가 생각 중…');

  try {
    const res = await fetch('/api/council/debate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ question: text, sessionId }),
    });
    const data = await res.json();
    if (data.error) { appendCouncilError(container, data.error); return; }
    showDebate(container, text, data.claudeReply, data.gptReply, data.claudeError, data.gptError);
  } catch (_) {
    appendCouncilError(container, '서버에 연결할 수 없습니다.');
  } finally {
    isLoading = false;
    document.getElementById('send-btn').disabled = false;
    inputEl.focus();
  }
}

function appendCouncilLoading(msg) {
  const group = document.createElement('div');
  group.className = 'council-group';

  const tag = document.createElement('div');
  tag.className = 'council-tag';
  tag.textContent = '의회';

  const wrap = document.createElement('div');
  wrap.className = 'council-loading';
  wrap.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';

  const txt = document.createElement('span');
  txt.className = 'loading-text';
  txt.textContent = msg;
  wrap.appendChild(txt);

  group.append(tag, wrap);
  getMessages().appendChild(group);
  scrollDown();
  return group;
}

function showDebate(container, question, claudeReply, gptReply, claudeError, gptError) {
  container.innerHTML = '';

  const tag = document.createElement('div');
  tag.className = 'council-tag';
  tag.textContent = '의회';

  const section = document.createElement('div');
  section.className = 'debate-section';

  section.append(
    claudeReply ? makeDebateAnswer('Claude', claudeReply) : makeDebateError('Claude', claudeError),
    gptReply    ? makeDebateAnswer('GPT', gptReply)       : makeDebateError('GPT', gptError),
    makePicker(container, section, question, claudeReply, gptReply),
  );

  container.append(tag, section);
  scrollDown();
}

function makeDebateAnswer(modelName, reply) {
  const details = document.createElement('details');
  details.className = 'debate-answer';
  details.open = true;

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

function makePicker(container, section, question, claudeReply, gptReply) {
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
    const available = model === 'claude' ? !!claudeReply : !!gptReply;
    if (!available) {
      btn.disabled = true;
      btn.title = '이 모델의 응답이 없어 종합할 수 없습니다.';
    } else {
      btn.addEventListener('click', () => {
        pickerBtns.querySelectorAll('.synth-btn').forEach(b => b.disabled = true);
        chooseSynthesizer(container, section, question, claudeReply, gptReply, model);
      });
    }
    pickerBtns.appendChild(btn);
  });

  picker.append(pickerLabel, pickerBtns);
  return picker;
}

async function chooseSynthesizer(container, section, question, claudeReply, gptReply, synthesizer) {
  const label = synthesizer === 'claude' ? 'Claude' : 'GPT';

  const loadingWrap = document.createElement('div');
  loadingWrap.className = 'council-loading synthesis-loading';
  loadingWrap.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
  const txt = document.createElement('span');
  txt.className = 'loading-text';
  txt.textContent = `${label}가 종합 중…`;
  loadingWrap.appendChild(txt);
  section.appendChild(loadingWrap);
  scrollDown();

  try {
    const res = await fetch('/api/council/synthesize', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ question, claudeReply, gptReply, synthesizer, sessionId }),
    });
    const data = await res.json();
    loadingWrap.remove();
    if (data.error) { appendCouncilError(container, data.error); return; }
    showSynthesis(section, question, claudeReply, gptReply, data);
  } catch (_) {
    loadingWrap.remove();
    appendCouncilError(container, '서버에 연결할 수 없습니다.');
  }
}

function showSynthesis(section, question, claudeReply, gptReply, data) {
  // 개별 답변 접기
  section.querySelectorAll('.debate-answer').forEach(d => d.open = false);

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
    claudeReply,
    gptReply,
    divergence:         data.divergence,
    synthesis:          data.synthesis,
    synthesizer:        data.synthesizer,
    synthesizerModelId: data.synthesizerModelId,
    messageId:          data.messageId,
  }));

  synthSection.append(synthLabel, synthBubble, saveBtn);
  section.appendChild(synthSection);
  scrollDown();
}

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

function appendCouncilError(container, msg) {
  const err = document.createElement('div');
  err.className = 'error-msg';
  err.textContent = `⚠️ ${msg}`;
  container.appendChild(err);
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
