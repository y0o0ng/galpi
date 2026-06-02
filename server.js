require('dotenv').config();
const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs/promises');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');

// ─── 설정 ────────────────────────────────────────────────────────────────────

const VAULT_PATH = process.env.VAULT_PATH ? path.resolve(process.env.VAULT_PATH) : null;
const CONTEXT_N  = parseInt(process.env.CONTEXT_N  || '10');
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const GPT_MODEL    = process.env.GPT_MODEL    || 'gpt-4o';
const PORT         = parseInt(process.env.PORT || '3000');

if (!VAULT_PATH) {
  console.error('❌ .env 파일에 VAULT_PATH가 없습니다. .env.example을 참고해 .env를 만들어주세요.');
  process.exit(1);
}

// ─── API 클라이언트 ──────────────────────────────────────────────────────────

const HAS_CLAUDE = !!process.env.ANTHROPIC_API_KEY;
const HAS_GPT    = !!process.env.OPENAI_API_KEY;

if (!HAS_CLAUDE && !HAS_GPT) {
  console.error('❌ .env 파일에 API 키가 하나도 없습니다. ANTHROPIC_API_KEY 또는 OPENAI_API_KEY를 추가해주세요.');
  process.exit(1);
}

const anthropic = HAS_CLAUDE ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
const openai    = HAS_GPT    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })    : null;

// ─── 앱 ─────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 세션별 대화 기록 (1차: 서버 메모리에만 보관, 재시작 시 초기화됨)
const sessions = {};

// ─── 채팅 ────────────────────────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { message, model, sessionId } = req.body;
  if (!message || !model || !sessionId) {
    return res.status(400).json({ error: '필수 항목이 빠졌습니다.' });
  }

  if (!sessions[sessionId]) sessions[sessionId] = [];
  const history = sessions[sessionId];
  history.push({ role: 'user', content: message });

  // 최근 N개만 AI에게 전달 (토큰 관리)
  const context = history.slice(-CONTEXT_N);

  try {
    let reply, usedModel;

    if (model === 'claude') {
      const response = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 8192,
        messages: context,
      });
      reply = response.content[0].text;
      usedModel = CLAUDE_MODEL;
    } else {
      const response = await openai.chat.completions.create({
        model: GPT_MODEL,
        messages: context,
      });
      reply = response.choices[0].message.content;
      usedModel = GPT_MODEL;
    }

    history.push({ role: 'assistant', content: reply });

    res.json({
      reply,
      model: model === 'claude' ? 'Claude' : 'GPT',
      modelId: usedModel,
      messageId: uuidv4(),
    });
  } catch (err) {
    console.error('API 오류:', err.message);
    const hint = err.message?.includes('API key') || err.message?.includes('auth')
      ? 'API 키를 확인해주세요 (.env 파일).'
      : err.message?.includes('model')
      ? `모델명을 확인해주세요. 현재 설정: ${model === 'claude' ? CLAUDE_MODEL : GPT_MODEL}`
      : err.message;
    res.status(500).json({ error: hint });
  }
});

// ─── 노트 저장 ────────────────────────────────────────────────────────────────

app.post('/api/save-note', async (req, res) => {
  const { question, answer, model, modelId, sessionId, messageId } = req.body;
  if (!question || !answer) {
    return res.status(400).json({ error: '질문과 답변이 필요합니다.' });
  }

  // 제목 생성: 답한 모델에게 요청 (실패 시 질문 앞 40자)
  let title = question.replace(/\n/g, ' ').slice(0, 40).trim();
  try {
    const titlePrompt = `다음 질문에 대한 옵시디언 노트 제목을 한국어로 10~20자 이내로 지어줘. 제목 텍스트만 반환해. 따옴표나 특수문자 없이.\n\n질문: ${question}`;
    if (model === 'Claude') {
      const r = await anthropic.messages.create({
        model: CLAUDE_MODEL, max_tokens: 60,
        messages: [{ role: 'user', content: titlePrompt }],
      });
      title = r.content[0].text.trim();
    } else {
      const r = await openai.chat.completions.create({
        model: GPT_MODEL,
        messages: [{ role: 'user', content: titlePrompt }],
      });
      title = r.choices[0].message.content.trim();
    }
  } catch (e) {
    console.warn('제목 생성 실패, 질문 앞부분 사용:', e.message);
  }

  // 파일명 안전 처리
  title = title.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const now    = new Date();
  const pad    = (n) => String(n).padStart(2, '0');
  const dateId = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const slug   = title.replace(/\s+/g, '-').replace(/[^\w가-힣\-]/g, '');
  const fileId = `${dateId}-${slug}`;
  const createdStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  // 여러 줄 답변을 callout 형식으로 변환 (각 줄 앞에 "> " 추가)
  const calloutAnswer = answer.split('\n').map(l => `> ${l}`).join('\n');

  const noteContent = `---
id: ${fileId}
title: ${title}
aliases: []
created: ${createdStr}
mode: single
note_type: single_manual
archived: false
models:
  claude: ${CLAUDE_MODEL}
  gpt: ${GPT_MODEL}
final_synthesizer: none
source_session: ${sessionId || 'unknown'}
source_message: ${messageId || 'unknown'}
---

# ${title}

## ❓ 질문
${question}

## 결론
${answer}

## 🏷️ 주제 태그
<!-- CODEX-TAGS-START -->
<!-- CODEX-TAGS-END -->

## 🔗 연결
<!-- CODEX-LINKS-START -->
<!-- CODEX-LINKS-END -->

> [!note]- 원본 답변
> **모델:** ${model}
${calloutAnswer}

---
*생성: ${createdStr} · 단일 모드 · 최종 종합자: 없음*
`;

  const filepath = path.join(VAULT_PATH, fileId + '.md');

  // path traversal 방지
  if (!filepath.startsWith(VAULT_PATH + path.sep) && filepath !== VAULT_PATH) {
    return res.status(400).json({ error: '잘못된 경로입니다.' });
  }

  try {
    // 안전한 쓰기: 임시 파일 → atomic rename → 존재 확인
    const tmpPath = filepath + '.tmp';
    await fs.writeFile(tmpPath, noteContent, 'utf8');
    await fs.rename(tmpPath, filepath);
    await fs.access(filepath);

    res.json({ success: true, filename: fileId + '.md', title });
  } catch (err) {
    console.error('노트 저장 오류:', err.message);
    res.status(500).json({ error: `노트 저장 실패: ${err.message}` });
  }
});

// ─── 프론트엔드가 활성 모델명 확인용 ────────────────────────────────────────

app.get('/api/config', (_req, res) => {
  res.json({
    claudeModel: CLAUDE_MODEL,
    gptModel:    GPT_MODEL,
    contextN:    CONTEXT_N,
    hasClaude:   HAS_CLAUDE,
    hasGpt:      HAS_GPT,
  });
});

// ─── 의회 모드 ────────────────────────────────────────────────────────────────

app.post('/api/council/debate', async (req, res) => {
  const { question, sessionId } = req.body;
  if (!question || !sessionId) return res.status(400).json({ error: '필수 항목 누락' });
  if (!HAS_CLAUDE || !HAS_GPT) return res.status(400).json({ error: '의회 모드는 Claude와 GPT 키가 모두 필요합니다.' });

  if (!sessions[sessionId]) sessions[sessionId] = [];
  const history = sessions[sessionId];
  const context = [...history.slice(-CONTEXT_N), { role: 'user', content: question }];

  try {
    const [claudeRes, gptRes] = await Promise.all([
      anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 8192,
        messages: context,
      }),
      openai.chat.completions.create({
        model: GPT_MODEL,
        messages: context,
      }),
    ]);

    res.json({
      claudeReply: claudeRes.content[0].text,
      gptReply:    gptRes.choices[0].message.content,
    });
  } catch (err) {
    console.error('의회 토론 오류:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/council/synthesize', async (req, res) => {
  const { question, claudeReply, gptReply, synthesizer, sessionId } = req.body;
  if (!question || !claudeReply || !gptReply || !synthesizer || !sessionId) {
    return res.status(400).json({ error: '필수 항목 누락' });
  }

  const synthPrompt = `다음은 동일한 질문에 대한 두 AI의 답변입니다.

질문: ${question}

[Claude 답변]
${claudeReply}

[GPT 답변]
${gptReply}

아래 형식을 정확히 지켜 답해주세요. 태그를 그대로 사용하세요.

<갈린_지점>
두 답변이 서로 다르게 접근하거나 결론이 갈린 핵심 포인트를 최대 3개 짚어주세요. 각 포인트마다 어느 쪽 관점이 더 타당한지, 그 이유도 함께 적어주세요. 만약 두 답변이 실질적으로 동일하다면 "두 답변의 관점이 일치합니다"라고만 적어주세요.
</갈린_지점>

<종합>
이 블록 안에는 오직 최종 답변 텍스트만 작성하세요. <갈린_지점> 태그나 갈린 지점 분석 내용을 이 블록 안에 포함하지 마세요. 갈린 지점에서 더 타당한 관점을 채택하고 두 답변의 장점을 통합한 최종 답변을 작성해주세요. 단순히 두 답변을 붙이는 것이 아니라 비판적으로 검토해 더 나은 답을 만들어주세요. 반드시 우선순위를 정하고 1순위 선택지를 제시하세요. 불확실한 부분은 따로 표시하세요. 양쪽 의견을 단순 병렬하지 마세요.
</종합>`;

  function parseSynthesisResponse(text) {
    const divMatch   = text.match(/<갈린_지점>([\s\S]*?)<\/갈린_지점>/);
    const synthMatch = text.match(/<종합>([\s\S]*?)<\/종합>/);
    let synthesis = synthMatch ? synthMatch[1].trim() : text.trim();
    // GPT가 <종합> 안에 <갈린_지점> 블록을 반복하는 경우 제거
    synthesis = synthesis.replace(/<갈린_지점>[\s\S]*?<\/갈린_지점>/g, '').trim();
    return {
      divergence: divMatch ? divMatch[1].trim() : null,
      synthesis,
    };
  }

  try {
    let rawText, usedModel;
    if (synthesizer === 'claude') {
      const r = await anthropic.messages.create({
        model: CLAUDE_MODEL, max_tokens: 8192,
        messages: [{ role: 'user', content: synthPrompt }],
      });
      rawText   = r.content[0].text;
      usedModel = CLAUDE_MODEL;
    } else {
      const r = await openai.chat.completions.create({
        model: GPT_MODEL,
        messages: [{ role: 'user', content: synthPrompt }],
      });
      rawText   = r.choices[0].message.content;
      usedModel = GPT_MODEL;
    }

    const { divergence, synthesis } = parseSynthesisResponse(rawText);

    if (!sessions[sessionId]) sessions[sessionId] = [];
    sessions[sessionId].push({ role: 'user',      content: question  });
    sessions[sessionId].push({ role: 'assistant', content: synthesis });

    res.json({
      divergence,
      synthesis,
      synthesizer:        synthesizer === 'claude' ? 'Claude' : 'GPT',
      synthesizerModelId: usedModel,
      messageId:          uuidv4(),
    });
  } catch (err) {
    console.error('종합 오류:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/council/save-note', async (req, res) => {
  const { question, claudeReply, gptReply, divergence, synthesis, synthesizer, synthesizerModelId, sessionId, messageId } = req.body;
  if (!question || !claudeReply || !gptReply || !synthesis) {
    return res.status(400).json({ error: '필수 항목 누락' });
  }

  let title = question.replace(/\n/g, ' ').slice(0, 40).trim();
  try {
    const titlePrompt = `다음 질문에 대한 옵시디언 노트 제목을 한국어로 10~20자 이내로 지어줘. 제목 텍스트만 반환해. 따옴표나 특수문자 없이.\n\n질문: ${question}`;
    if (synthesizer === 'Claude') {
      const r = await anthropic.messages.create({
        model: CLAUDE_MODEL, max_tokens: 60,
        messages: [{ role: 'user', content: titlePrompt }],
      });
      title = r.content[0].text.trim();
    } else {
      const r = await openai.chat.completions.create({
        model: GPT_MODEL,
        messages: [{ role: 'user', content: titlePrompt }],
      });
      title = r.choices[0].message.content.trim();
    }
  } catch (e) {
    console.warn('제목 생성 실패:', e.message);
  }

  title = title.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const now    = new Date();
  const pad    = (n) => String(n).padStart(2, '0');
  const dateId = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const slug   = title.replace(/\s+/g, '-').replace(/[^\w가-힣\-]/g, '');
  const fileId = `${dateId}-${slug}`;
  const createdStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const fmtCallout = (text) => text.split('\n').map(l => `> ${l}`).join('\n');

  const noteContent = `---
id: ${fileId}
title: ${title}
aliases: []
created: ${createdStr}
mode: council
note_type: council
archived: false
models:
  claude: ${CLAUDE_MODEL}
  gpt: ${GPT_MODEL}
final_synthesizer: ${synthesizer}
source_session: ${sessionId || 'unknown'}
source_message: ${messageId || 'unknown'}
---

# ${title}

## ❓ 질문
${question}

## ⚡ 갈린 지점
${divergence || '분석 없음'}

## 결론
${synthesis}

## 🏷️ 주제 태그
<!-- CODEX-TAGS-START -->
<!-- CODEX-TAGS-END -->

## 🔗 연결
<!-- CODEX-LINKS-START -->
<!-- CODEX-LINKS-END -->

> [!note]- Claude 원본 답변
${fmtCallout(claudeReply)}

> [!note]- GPT 원본 답변
${fmtCallout(gptReply)}

---
*생성: ${createdStr} · 의회 모드 · 최종 종합자: ${synthesizer} (${synthesizerModelId})*
`;

  const filepath = path.join(VAULT_PATH, fileId + '.md');
  if (!filepath.startsWith(VAULT_PATH + path.sep) && filepath !== VAULT_PATH) {
    return res.status(400).json({ error: '잘못된 경로입니다.' });
  }

  try {
    const tmpPath = filepath + '.tmp';
    await fs.writeFile(tmpPath, noteContent, 'utf8');
    await fs.rename(tmpPath, filepath);
    await fs.access(filepath);
    res.json({ success: true, filename: fileId + '.md', title });
  } catch (err) {
    console.error('노트 저장 오류:', err.message);
    res.status(500).json({ error: `노트 저장 실패: ${err.message}` });
  }
});

// ─── 서버 시작 ────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n✅ AI 의회 서버 실행 중');
  console.log(`   로컬:     http://localhost:${PORT}`);
  console.log(`   볼트:     ${VAULT_PATH}`);
  console.log(`   Claude:   ${CLAUDE_MODEL}`);
  console.log(`   GPT:      ${GPT_MODEL}`);
  console.log(`   컨텍스트: 최근 ${CONTEXT_N}개 메시지\n`);
});
