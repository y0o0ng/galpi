require('dotenv').config();
const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs/promises');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const rateLimit = require('express-rate-limit');

// ─── 설정 ────────────────────────────────────────────────────────────────────

const VAULT_PATH = process.env.VAULT_PATH ? path.resolve(process.env.VAULT_PATH) : null;
const CONTEXT_N  = parseInt(process.env.CONTEXT_N  || '10');
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const GPT_MODEL    = process.env.GPT_MODEL    || 'gpt-4o';
const PORT         = parseInt(process.env.PORT || '3000');
const COUNCIL_TOKEN_LIMITS = {
  compressedFirst: 900,
  fullFirst:       4096,
  deepFirst:       2500,
  review:          800,
  synthesis:       5000,
};

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
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
});
app.use('/api/', apiLimiter);

// 세션별 대화 기록 (재시작 시 초기화됨)
const sessions = {};

// ─── 채팅 ────────────────────────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { message, model, sessionId } = req.body;
  if (!message || !model || !sessionId) {
    return res.status(400).json({ error: '필수 항목이 빠졌습니다.' });
  }
  if (model !== 'claude' && model !== 'gpt') return res.status(400).json({ error: '알 수 없는 모델입니다.' });
  if (model === 'claude' && !HAS_CLAUDE)     return res.status(400).json({ error: 'Claude 키가 없습니다.' });
  if (model === 'gpt'    && !HAS_GPT)        return res.status(400).json({ error: 'GPT 키가 없습니다.' });
  if (message.length > 10000)                return res.status(400).json({ error: '메시지가 너무 깁니다 (최대 10,000자).' });

  if (!sessions[sessionId]) sessions[sessionId] = [];
  const history = sessions[sessionId];
  history.push({ role: 'user', content: message });

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
    sessions[sessionId] = sessions[sessionId].slice(-(CONTEXT_N * 2));

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

  title = title.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const now    = new Date();
  const pad    = (n) => String(n).padStart(2, '0');
  const dateId = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const slug   = title.replace(/\s+/g, '-').replace(/[^\w가-힣\-]/g, '');
  const rand   = Math.random().toString(36).slice(2, 6);
  const fileId = `${dateId}-${rand}-${slug}`;
  const createdStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const calloutAnswer = answer.split('\n').map(l => `> ${l}`).join('\n');

  const noteContent = `---
id: ${fileId}
title: "${title.replace(/"/g, "'")}"
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

// ─── 의회 모드 프롬프트 빌더 ──────────────────────────────────────────────────

function normalizeCouncilDraftMode(value) {
  if (value === 'full' || value === 'deep') return value;
  return 'compressed';
}

// 1차 답변 프롬프트
function buildFirstAnswerPrompt(question, mode) {
  if (mode === 'full') {
    return `사용자 질문에 대해 독립적으로 최선의 답변을 작성하라.

규칙:
- 압축 형식을 강제하지 않는다.
- 질문이 시, 에세이, 문장 다듬기, 말투 조정, 카피라이팅, 창작처럼 뉘앙스가 중요한 작업일 수 있음을 고려한다.
- 충분한 길이와 자연스러운 문체로 답한다.
- 최종 종합에서 비교 가능하도록 핵심 의도와 선택 이유가 드러나게 한다.
- 불필요한 인사나 과한 완충 표현은 피한다.
- 답변은 반드시 완결한다. 길어질 것 같으면 범위를 줄여서라도 마지막 문장까지 마무리한다.

사용자 질문:
${question}`;
  }

  if (mode === 'deep') {
    return `최종 상호 검토와 종합을 위한 분석 초안을 작성하라.
목표는 깊이 있는 판단 재료를 제공하되, 장문 완성 답변을 만들지 않는 것이다.

규칙:
- 목표 분량은 700~1,000토큰이다. 필요하면 더 짧게 써도 된다.
- 질문 해결에 필요한 핵심 주장, 근거, 예외, 리스크, 선택 기준을 중심으로 작성한다.
- 불필요한 인사, 완충 표현, 반복 설명을 쓰지 않는다.
- 최종 사용자에게 직접 보여줄 답변이 아니므로 완성된 문체보다 검토 가능한 판단 재료를 우선한다.
- 코드 질문이면 실행 가능한 핵심 코드와 주의점 중심으로 작성한다.
- 글쓰기 질문이면 후보 방향, 톤, 표현상 선택지를 중심으로 작성하되 최종 원고처럼 길게 쓰지 않는다.
- 답변은 반드시 완결한다. 길어질 것 같으면 항목 수를 줄여서라도 끝까지 마무리한다.

사용자 질문:
${question}`;
  }

  // compressed (기본값)
  return `너는 최종 답변을 위한 내부 검토용 초안을 작성한다.
목표는 토큰 절약과 판단 재료 제공이다.

규칙:
- 목표 분량은 150~250토큰이다.
- 코드, 문장 초안, 비교표처럼 답변의 핵심 산출물이 길이를 필요로 하는 경우에만 400토큰 안팎까지 허용한다.
- 인사, 완충 표현, 반복 설명을 쓰지 않는다.
- 질문 해결에 필요한 핵심 내용만 남긴다.
- 구조는 질문 유형에 맞게 자유롭게 선택한다.
  - 분석/판단 질문: 핵심 주장, 근거, 리스크 중심
  - 코드 질문: 필요한 코드와 최소 설명 중심
  - 글쓰기/문장 다듬기: 후보 문안 또는 수정 방향 중심
  - 비교 질문: 차이와 선택 기준 중심
- 최종 사용자에게 직접 보여줄 답변이 아니므로 문체보다 정보 밀도를 우선한다.
- 답변은 반드시 완결한다. 길어질 것 같으면 세부 근거를 줄여서라도 마지막 항목까지 마무리한다.

사용자 질문:
${question}`;
}

// 상호 검토 프롬프트
function buildReviewPrompt(question, ownAnswer, otherAnswer, mode) {
  const modeRule = mode === 'full'
    ? '- 문체, 톤, 뉘앙스, 표현 손실, 사용자 의도와의 어긋남도 함께 평가한다.'
    : mode === 'deep'
    ? '- 논리의 빈틈, 근거 강도, 빠진 리스크, 최종 판단에 필요한 선택 기준을 우선 평가한다.'
    : '- 정보 밀도, 정확성, 누락 위험을 우선 평가한다.';

  return `상대 답변을 압축 검토하라.

질문:
${question}

내 답변:
${ownAnswer}

상대 답변:
${otherAnswer}

형식:
합의:
- ...
차이:
- ...
누락:
- ...
최종 종합에 반영할 점:
- ...

규칙:
- 짧게.
- 중복 금지.
- 평가만.
- 새 장문 답변 작성 금지.
- 질문 유형에 맞게 정확성, 실용성, 문체, 누락 위험 중 중요한 기준을 우선 평가.
- 반드시 완결된 검토를 작성한다. 길어질 것 같으면 각 항목을 1개씩만 남긴다.
${modeRule}`;
}

// 최종 종합 프롬프트
function buildSynthesisPrompt(question, claudeReply, gptReply, claudeReview, gptReview) {
  const hasReview = !!(claudeReview || gptReview);
  const reviewSection = hasReview
    ? `[Claude의 GPT 답변 검토]
${claudeReview || '검토 없음'}

[GPT의 Claude 답변 검토]
${gptReview || '검토 없음'}

`
    : '';

  return `아래는 동일한 질문에 대한 두 AI의 1차 답변${hasReview ? '과 상호 검토' : ''}다.

질문:
${question}

[Claude 1차 답변]
${claudeReply}

[GPT 1차 답변]
${gptReply}

${reviewSection}최종 답변을 작성하라.

규칙:
- 최종 답변은 사용자에게 직접 보여주는 답변이다.
- 압축 문체를 쓰지 않는다.
- 자연스럽고 읽기 좋은 정상 말투로 작성한다.
- 두 1차 답변과 상호 검토를 모두 반영한다.
- 단순히 두 답변을 섞지 말고 비판적으로 판단한다.
- 반드시 우선순위를 정하고 1순위 결론을 제시한다.
- 불확실한 부분은 명확히 표시한다.
- 분석형 질문이면 결론, 근거, 리스크가 선명해야 한다.
- 코드 질문이면 실행 가능성과 간결함을 우선한다.
- 글쓰기형 질문이면 최종 문장의 완성도, 톤, 뉘앙스를 우선한다.

아래 형식을 지켜라.

<갈린_지점>
두 답변과 상호 검토에서 실제로 갈린 핵심 포인트를 최대 3개 정리한다.
실질적으로 차이가 없다면 "두 답변의 관점이 대체로 일치합니다"라고 적는다.
</갈린_지점>

<종합>
사용자에게 보여줄 최종 답변만 작성한다.
갈린 지점 분석을 반복하지 않는다.
이 블록 안에 <갈린_지점> 태그를 포함하지 않는다.
</종합>`;
}

// ─── 의회 모드 ────────────────────────────────────────────────────────────────

// 1단계: 1차 답변 생성
app.post('/api/council/debate', async (req, res) => {
  const { question, sessionId, councilDraftMode } = req.body;
  if (!question || !sessionId) return res.status(400).json({ error: '필수 항목 누락' });
  if (!HAS_CLAUDE || !HAS_GPT) return res.status(400).json({ error: '의회 모드는 Claude와 GPT 키가 모두 필요합니다.' });

  const mode = normalizeCouncilDraftMode(councilDraftMode);

  if (!sessions[sessionId]) sessions[sessionId] = [];
  const history = sessions[sessionId];

  // 1차 답변 프롬프트 (mode에 따라 분기)
  const firstAnswerPrompt = buildFirstAnswerPrompt(question, mode);
  const context = [...history.slice(-CONTEXT_N), { role: 'user', content: firstAnswerPrompt }];
  const maxTokens = mode === 'compressed'
    ? COUNCIL_TOKEN_LIMITS.compressedFirst
    : mode === 'deep'
    ? COUNCIL_TOKEN_LIMITS.deepFirst
    : COUNCIL_TOKEN_LIMITS.fullFirst;

  try {
    const [claudeResult, gptResult] = await Promise.allSettled([
      anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        messages: context,
      }),
      openai.chat.completions.create({
        model: GPT_MODEL,
        messages: context,
        max_completion_tokens: maxTokens,
      }),
    ]);

    const claudeReply = claudeResult.status === 'fulfilled' ? claudeResult.value.content[0].text         : null;
    const gptReply    = gptResult.status    === 'fulfilled' ? gptResult.value.choices[0].message.content : null;
    const claudeError = claudeResult.status === 'rejected'  ? claudeResult.reason.message                : null;
    const gptError    = gptResult.status    === 'rejected'  ? gptResult.reason.message                  : null;

    if (!claudeReply && !gptReply) {
      return res.status(500).json({ error: '두 모델 모두 응답하지 못했습니다.' });
    }

    res.json({ claudeReply, gptReply, claudeError, gptError, councilDraftMode: mode });
  } catch (err) {
    console.error('의회 토론 오류:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 2단계: 상호 검토
app.post('/api/council/review', async (req, res) => {
  const { question, claudeReply, gptReply, councilDraftMode, sessionId } = req.body;
  if (!question || !claudeReply || !gptReply || !sessionId) {
    return res.status(400).json({ error: '필수 항목 누락' });
  }

  const mode = normalizeCouncilDraftMode(councilDraftMode);

  // 상호 검토 프롬프트 (Claude는 GPT를, GPT는 Claude를 검토)
  const claudeReviewPrompt = buildReviewPrompt(question, claudeReply, gptReply, mode);
  const gptReviewPrompt    = buildReviewPrompt(question, gptReply, claudeReply, mode);

  try {
    const [claudeResult, gptResult] = await Promise.allSettled([
      anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: COUNCIL_TOKEN_LIMITS.review,
        messages: [{ role: 'user', content: claudeReviewPrompt }],
      }),
      openai.chat.completions.create({
        model: GPT_MODEL,
        messages: [{ role: 'user', content: gptReviewPrompt }],
        max_completion_tokens: COUNCIL_TOKEN_LIMITS.review,
      }),
    ]);

    const claudeReview      = claudeResult.status === 'fulfilled' ? claudeResult.value.content[0].text         : null;
    const gptReview         = gptResult.status    === 'fulfilled' ? gptResult.value.choices[0].message.content : null;
    const claudeReviewError = claudeResult.status === 'rejected'  ? claudeResult.reason.message                : null;
    const gptReviewError    = gptResult.status    === 'rejected'  ? gptResult.reason.message                  : null;

    res.json({ claudeReview, gptReview, claudeReviewError, gptReviewError });
  } catch (err) {
    console.error('상호 검토 오류:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 3단계: 최종 종합
app.post('/api/council/synthesize', async (req, res) => {
  const { question, claudeReply, gptReply, claudeReview, gptReview, synthesizer, sessionId } = req.body;
  if (!question || !claudeReply || !gptReply || !synthesizer || !sessionId) {
    return res.status(400).json({ error: '필수 항목 누락' });
  }

  // 최종 종합 프롬프트 (검토 결과 포함, 항상 자연스러운 사용자용 답변)
  const synthPrompt = buildSynthesisPrompt(question, claudeReply, gptReply, claudeReview, gptReview);

  function parseSynthesisResponse(text) {
    const divMatch   = text.match(/<갈린_지점>([\s\S]*?)<\/갈린_지점>/);
    const synthMatch = text.match(/<종합>([\s\S]*?)<\/종합>/);
    let synthesis = synthMatch ? synthMatch[1].trim() : text.trim();
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
        model: CLAUDE_MODEL, max_tokens: COUNCIL_TOKEN_LIMITS.synthesis,
        messages: [{ role: 'user', content: synthPrompt }],
      });
      rawText   = r.content[0].text;
      usedModel = CLAUDE_MODEL;
    } else {
      const r = await openai.chat.completions.create({
        model: GPT_MODEL,
        messages: [{ role: 'user', content: synthPrompt }],
        max_completion_tokens: COUNCIL_TOKEN_LIMITS.synthesis,
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

// 의회 노트 저장
app.post('/api/council/save-note', async (req, res) => {
  const {
    question, claudeReply, gptReply, claudeReview, gptReview,
    divergence, synthesis, synthesizer, synthesizerModelId,
    sessionId, messageId, councilDraftMode,
  } = req.body;
  if (!question || !claudeReply || !gptReply || !synthesis) {
    return res.status(400).json({ error: '필수 항목 누락' });
  }

  const mode = normalizeCouncilDraftMode(councilDraftMode);

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
  const rand   = Math.random().toString(36).slice(2, 6);
  const fileId = `${dateId}-${rand}-${slug}`;
  const createdStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const fmtCallout = (text) => text.split('\n').map(l => `> ${l}`).join('\n');

  const reviewSection = (claudeReview || gptReview) ? `
> [!note]- Claude의 GPT 검토
${claudeReview ? fmtCallout(claudeReview) : '> 검토 없음'}

> [!note]- GPT의 Claude 검토
${gptReview ? fmtCallout(gptReview) : '> 검토 없음'}
` : '';

  const noteContent = `---
id: ${fileId}
title: "${title.replace(/"/g, "'")}"
aliases: []
created: ${createdStr}
mode: council
note_type: council
draft_mode: ${mode}
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

> [!note]- Claude 1차 답변
${fmtCallout(claudeReply)}

> [!note]- GPT 1차 답변
${fmtCallout(gptReply)}
${reviewSection}
---
*생성: ${createdStr} · 의회 모드 (${mode}) · 최종 종합자: ${synthesizer} (${synthesizerModelId})*
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

app.listen(PORT, '127.0.0.1', () => {
  console.log('\n✅ AI 의회 서버 실행 중');
  console.log(`   로컬:     http://localhost:${PORT}`);
  console.log(`   볼트:     ${VAULT_PATH}`);
  console.log(`   Claude:   ${CLAUDE_MODEL}`);
  console.log(`   GPT:      ${GPT_MODEL}`);
  console.log(`   컨텍스트: 최근 ${CONTEXT_N}개 메시지\n`);
});
