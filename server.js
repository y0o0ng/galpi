require('dotenv').config();
const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs/promises');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');

// ─── 설정 ────────────────────────────────────────────────────────────────────

const VAULT_PATH = process.env.VAULT_PATH ? path.resolve(process.env.VAULT_PATH) : null;
const CONTEXT_N  = parseInt(process.env.CONTEXT_N  || '10');
const HISTORY_CONTEXT_MESSAGES = CONTEXT_N * 2; // 최근 10턴 내외를 user/assistant 메시지 쌍으로 전달
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const GPT_MODEL    = process.env.GPT_MODEL    || 'gpt-4o';
const PORT         = parseInt(process.env.PORT || '3000');
const GPT_LANGUAGE_SYSTEM = { role: 'system', content: '사용자가 쓴 언어로 답변하라. 한국어, 영어, 중국어, 일본어, 스페인어, 프랑스어, 독일어, 포르투갈어, 러시아어, 아랍어만 사용하라.' };

const COUNCIL_TOKEN_LIMITS = {
  compressedFirst: 900,
  fullFirst:       4096,
  deepFirst:       2500,
  review:          800,
  synthesis:       5000,
};
const MAX_ACTIVE_NOTES = 5;
const MAX_NOTE_CONTEXT_CHARS = 2000;
const MAX_MEMORY_ITEMS = 20;
const MAX_MEMORY_CHARS = 1200;
const MEMORY_DIR = '_system';
const MEMORY_FILE = 'memory.md';

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

// 세션별 대화 기록 (AI 컨텍스트용 인메모리)
const sessions = {};

// ─── SQLite DB ───────────────────────────────────────────────────────────────

const db = new Database(path.join(__dirname, 'council.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    last_active INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    model TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    note_type TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    codex_status TEXT NOT NULL DEFAULT 'pending',
    source_session TEXT,
    source_message TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_notes_codex_status ON notes(codex_status, archived);
  CREATE INDEX IF NOT EXISTS idx_notes_note_type ON notes(note_type);
`);

const stmtEnsureSession = db.prepare(`
  INSERT INTO sessions (id) VALUES (?)
  ON CONFLICT(id) DO UPDATE SET last_active = strftime('%s','now')
`);
const stmtInsertMessage = db.prepare(
  'INSERT INTO messages (session_id, role, content, model) VALUES (?, ?, ?, ?)'
);
const stmtUpsertNote = db.prepare(`
  INSERT INTO notes (
    filename, title, note_type, archived, codex_status,
    source_session, source_message
  ) VALUES (
    @filename, @title, @noteType, @archived, @codexStatus,
    @sourceSession, @sourceMessage
  )
  ON CONFLICT(filename) DO UPDATE SET
    title = excluded.title,
    note_type = excluded.note_type,
    archived = excluded.archived,
    codex_status = excluded.codex_status,
    source_session = excluded.source_session,
    source_message = excluded.source_message,
    updated_at = strftime('%s','now')
`);
const stmtGetMessages = db.prepare(
  'SELECT role, content, model FROM messages WHERE session_id = ? ORDER BY created_at ASC'
);
const stmtGetRecentMessages = db.prepare(`
  SELECT role, content, model FROM (
    SELECT role, content, model, created_at, id
    FROM messages
    WHERE session_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  )
  ORDER BY created_at ASC, id ASC
`);

function dbSaveMessage(sessionId, role, content, model = null) {
  stmtEnsureSession.run(sessionId);
  stmtInsertMessage.run(sessionId, role, content, model);
}

function dbUpsertNote({
  filename,
  title,
  noteType,
  archived = false,
  codexStatus = 'pending',
  sourceSession = null,
  sourceMessage = null,
}) {
  stmtUpsertNote.run({
    filename,
    title,
    noteType,
    archived: archived ? 1 : 0,
    codexStatus,
    sourceSession: sourceSession || null,
    sourceMessage: sourceMessage || null,
  });
}

function hydrateSessionFromDb(sessionId) {
  if (sessions[sessionId]) return sessions[sessionId];

  sessions[sessionId] = stmtGetRecentMessages
    .all(sessionId, HISTORY_CONTEXT_MESSAGES)
    .map(m => ({ role: m.role, content: m.content, model: m.model }));

  return sessions[sessionId];
}

function formatHistoryForModelContext(messages) {
  return messages.map(msg => {
    if (msg.role !== 'assistant' || !msg.model) {
      return { role: msg.role, content: msg.content };
    }

    const content = String(msg.model).includes('의회')
      ? extractCouncilSynthesis(msg.content)
      : msg.content;

    return {
      role: 'assistant',
      content: `[${msg.model}의 이전 답변]\n${content}`,
    };
  });
}

function buildCouncilTranscript({ question, claudeReply, gptReply, claudeReview, gptReview, divergence, synthesis, synthesizer }) {
  const sections = [
    `## 질문\n${question}`,
    `## Claude 1차 답변\n${claudeReply || '응답 없음'}`,
    `## GPT 1차 답변\n${gptReply || '응답 없음'}`,
  ];

  if (claudeReview || gptReview) {
    sections.push(`## Claude의 GPT 검토\n${claudeReview || '검토 없음'}`);
    sections.push(`## GPT의 Claude 검토\n${gptReview || '검토 없음'}`);
  }

  if (divergence) sections.push(`## 갈린 지점\n${divergence}`);
  sections.push(`## 종합 (${synthesizer})\n${synthesis}`);
  return sections.join('\n\n---\n\n');
}

function extractCouncilSynthesis(content) {
  const text = String(content || '');
  const match = text.match(/## 종합[^\n]*\n([\s\S]*)$/);
  return match ? match[1].trim() : text;
}

function sanitizeTitle(title, fallback = '저장한 문서') {
  const cleaned = String(title || fallback)
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return cleaned || fallback;
}

function createNoteIdentity(title) {
  const now    = new Date();
  const pad    = (n) => String(n).padStart(2, '0');
  const dateId = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const slug   = title.replace(/\s+/g, '-').replace(/[^\w가-힣\-]/g, '');
  const rand   = Math.random().toString(36).slice(2, 6);
  const fileId = `${dateId}-${rand}-${slug || 'note'}`;
  const createdStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return { fileId, createdStr };
}

async function writeVaultNote(fileId, noteContent) {
  const filepath = path.join(VAULT_PATH, fileId + '.md');
  if (!filepath.startsWith(VAULT_PATH + path.sep) && filepath !== VAULT_PATH) {
    throw new Error('잘못된 경로입니다.');
  }

  const tmpPath = filepath + '.tmp';
  await fs.writeFile(tmpPath, noteContent, 'utf8');
  await fs.rename(tmpPath, filepath);
  await fs.access(filepath);
}

async function saveVaultNoteRecord({
  fileId,
  title,
  noteType,
  noteContent,
  sessionId = null,
  messageId = null,
  codexStatus = 'pending',
}) {
  await writeVaultNote(fileId, noteContent);
  dbUpsertNote({
    filename: fileId + '.md',
    title,
    noteType,
    codexStatus,
    sourceSession: sessionId,
    sourceMessage: messageId,
  });
}

function parseJsonObject(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : raw;
  const objectMatch = body.match(/\{[\s\S]*\}/);
  return JSON.parse(objectMatch ? objectMatch[0] : body);
}

function normalizeTag(tag) {
  return String(tag || '')
    .replace(/^#+/, '')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .trim()
    .slice(0, 30);
}

function formatCodexTags(tags) {
  const normalized = [...new Set((Array.isArray(tags) ? tags : []).map(normalizeTag).filter(Boolean))]
    .slice(0, 8);
  return normalized.map(tag => `#${tag}`).join(' ');
}

function formatCodexLinks(links) {
  if (!Array.isArray(links) || links.length === 0) return '';

  const grouped = new Map();
  links.slice(0, 8).forEach(link => {
    const topic = String(link.topic || '관련 노트').replace(/\s+/g, ' ').trim().slice(0, 40);
    const title = String(link.title || '').replace(/[\[\]\n]/g, '').trim().slice(0, 80);
    if (!title) return;
    const reason = String(link.reason || '관련 내용').replace(/\s+/g, ' ').trim().slice(0, 100);
    const stars = '⭐'.repeat(Math.min(3, Math.max(1, Number.parseInt(link.strength, 10) || 1)));
    if (!grouped.has(topic)) grouped.set(topic, []);
    grouped.get(topic).push(`- ${stars} [[${title}]] — ${reason}`);
  });

  return [...grouped.entries()]
    .map(([topic, rows]) => `**[${topic}]**\n${rows.join('\n')}`)
    .join('\n\n');
}

// 지금은 GPT/Claude로 저장 메타데이터를 채우고, 나중에 Codex 정리 엔진으로 이 함수만 대체한다.
async function generateDocumentMetadata(content) {
  const fallbackTitle = sanitizeTitle(content.replace(/\n/g, ' ').slice(0, 40), '저장한 문서');
  const candidates = await searchVault(content);
  const candidateTitles = candidates.map(n => n.title).slice(0, 12);

  const prompt = `사용자가 아래 내용을 옵시디언 노트로 저장하려고 한다.
제목, 짧은 정리, 주제 태그, 기존 노트 연결 후보를 만들어라.

규칙:
- JSON 객체만 반환한다.
- title: 한국어 10~30자
- summary: 1~3문장
- tags: 한국어/영어 태그 3~8개, # 없이
- links: 기존 노트와 관련 있을 때만 작성
- links[].title은 "기존 노트 후보"에 있는 제목을 정확히 사용한다.
- links[].strength는 1~3 숫자다.

기존 노트 후보:
${candidateTitles.length ? candidateTitles.map(t => `- ${t}`).join('\n') : '- 없음'}

저장할 내용:
${content.slice(0, 6000)}

반환 형식:
{"title":"","summary":"","tags":[],"links":[{"topic":"","title":"","reason":"","strength":1}]}`;

  try {
    let text;
    if (HAS_GPT) {
      const r = await openai.chat.completions.create({
        model: GPT_MODEL,
        messages: [{ role: 'user', content: prompt }],
      });
      text = r.choices[0].message.content;
    } else if (HAS_CLAUDE) {
      const r = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      });
      text = r.content[0].text;
    }

    const parsed = parseJsonObject(text);
    const allowedTitles = new Set(candidateTitles);
    return {
      title:   sanitizeTitle(parsed.title, fallbackTitle),
      summary: String(parsed.summary || '').trim().slice(0, 800),
      tags:    Array.isArray(parsed.tags) ? parsed.tags : [],
      links:   Array.isArray(parsed.links)
        ? parsed.links.filter(link => allowedTitles.has(String(link.title || '').trim()))
        : [],
    };
  } catch (err) {
    console.warn('저장 메타데이터 생성 실패:', err.message);
    return { title: fallbackTitle, summary: '', tags: [], links: [] };
  }
}

function getMemoryPath() {
  return path.join(VAULT_PATH, MEMORY_DIR, MEMORY_FILE);
}

function formatMemoryFile(items) {
  const body = items.map(item => `- ${item}`).join('\n');
  return `---
type: system_memory
always_include: true
---

# 사용자 메모리

${body || '<!-- 비어 있음 -->'}
`;
}

async function readMemoryItems() {
  try {
    const raw = await fs.readFile(getMemoryPath(), 'utf8');
    return stripFrontmatter(raw)
      .split('\n')
      .map(line => line.match(/^\s*-\s+(.+)$/)?.[1]?.trim())
      .filter(Boolean)
      .slice(0, MAX_MEMORY_ITEMS);
  } catch {
    return [];
  }
}

async function writeMemoryItems(items) {
  const cleaned = [...new Set(
    items
      .map(item => String(item || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .map(item => item.slice(0, 180))
  )].slice(0, MAX_MEMORY_ITEMS);

  await fs.mkdir(path.join(VAULT_PATH, MEMORY_DIR), { recursive: true });
  await fs.writeFile(getMemoryPath(), formatMemoryFile(cleaned), 'utf8');
  return cleaned;
}

// ─── 채팅 ────────────────────────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { message, model, sessionId, activeNotes } = req.body;
  if (!message || !model || !sessionId) {
    return res.status(400).json({ error: '필수 항목이 빠졌습니다.' });
  }
  if (model !== 'claude' && model !== 'gpt') return res.status(400).json({ error: '알 수 없는 모델입니다.' });
  if (model === 'claude' && !HAS_CLAUDE)     return res.status(400).json({ error: 'Claude 키가 없습니다.' });
  if (model === 'gpt'    && !HAS_GPT)        return res.status(400).json({ error: 'GPT 키가 없습니다.' });
  if (message.length > 10000)                return res.status(400).json({ error: '메시지가 너무 깁니다 (최대 10,000자).' });

  hydrateSessionFromDb(sessionId);
  const history = sessions[sessionId];
  history.push({ role: 'user', content: message });

  // 사용자 메모리는 항상, 활성/자동 검색 노트는 질문별 참조로 주입
  const memoryItems = await readMemoryItems();
  const resolvedNotes = await getContextNotesForQuestion(message, activeNotes);
  const baseContext = formatHistoryForModelContext(history.slice(-HISTORY_CONTEXT_MESSAGES));
  const context = memoryItems.length > 0 || resolvedNotes.length > 0
    ? [...baseContext.slice(0, -1), { role: 'user', content: buildContextMessage(message, resolvedNotes, memoryItems) }]
    : baseContext;

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
        messages: [GPT_LANGUAGE_SYSTEM, ...context],
      });
      reply = response.choices[0].message.content;
      usedModel = GPT_MODEL;
    }

    history.push({ role: 'assistant', content: reply, model: model === 'claude' ? 'Claude' : 'GPT' });
    sessions[sessionId] = sessions[sessionId].slice(-HISTORY_CONTEXT_MESSAGES);

    dbSaveMessage(sessionId, 'user',      message, null);
    dbSaveMessage(sessionId, 'assistant', reply,   model === 'claude' ? 'Claude' : 'GPT');

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

app.post('/api/vault/save-document', async (req, res) => {
  const content = String(req.body?.content || '').trim();
  const originalText = String(req.body?.originalText || content).trim();
  const sessionId = String(req.body?.sessionId || 'unknown').trim();
  if (!content) return res.status(400).json({ error: '저장할 내용을 입력해주세요.' });
  if (content.length > 20000) return res.status(400).json({ error: '저장할 내용이 너무 깁니다 (최대 20,000자).' });

  try {
    const metadata = await generateDocumentMetadata(content);
    const title = sanitizeTitle(metadata.title);
    const { fileId, createdStr } = createNoteIdentity(title);
    const tagsBlock = formatCodexTags(metadata.tags);
    const linksBlock = formatCodexLinks(metadata.links);

    const noteContent = `---
id: ${fileId}
title: "${title.replace(/"/g, "'")}"
aliases: []
created: ${createdStr}
updated: ${createdStr}
mode: user_document
note_type: user_manual
archived: false
codex_status: pending
ai_readable: true
knowledge_type: user_document
confidence: medium
source_session: ${sessionId || 'unknown'}
source_message: unknown
---

# ${title}

## AI 회수 힌트
- 핵심 개념: ${title}
- 노트 성격: 사용자 저장 문서
- 다시 꺼낼 상황: 사용자가 이 문서나 아이디어를 바탕으로 후속 질문을 할 때
- 연결 후보: ${metadata.links?.length ? metadata.links.map(link => `[[${link.title}]]`).join(', ') : '정리 엔진이 추후 보강'}
- 신뢰도: medium

## 문서
${content}

## 정리
${metadata.summary || '정리 없음'}

## 🏷️ 주제 태그
<!-- CODEX-TAGS-START -->
${tagsBlock}
<!-- CODEX-TAGS-END -->

## 🔗 연결
<!-- CODEX-LINKS-START -->
${linksBlock}
<!-- CODEX-LINKS-END -->

---
*생성: ${createdStr} · 사용자 저장 문서 · 정리 엔진: ${HAS_GPT ? 'GPT' : HAS_CLAUDE ? 'Claude' : 'fallback'}*
`;

    await saveVaultNoteRecord({
      fileId,
      title,
      noteType: 'user_manual',
      noteContent,
      sessionId,
      codexStatus: 'pending',
    });

    if (sessionId && sessionId !== 'unknown') {
      hydrateSessionFromDb(sessionId);
      sessions[sessionId].push({ role: 'user', content: originalText });
      sessions[sessionId].push({ role: 'assistant', content: `노트 저장됨: ${title}`, model: '저장' });
      sessions[sessionId] = sessions[sessionId].slice(-HISTORY_CONTEXT_MESSAGES);
      dbSaveMessage(sessionId, 'user', originalText, null);
      dbSaveMessage(sessionId, 'assistant', `노트 저장됨: ${title}`, '저장');
    }

    res.json({
      success: true,
      filename: fileId + '.md',
      title,
      tags: metadata.tags,
      links: metadata.links,
    });
  } catch (err) {
    console.error('문서 저장 오류:', err.message);
    res.status(500).json({ error: `문서 저장 실패: ${err.message}` });
  }
});

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
updated: ${createdStr}
mode: single
note_type: single_manual
archived: false
codex_status: pending
ai_readable: true
knowledge_type: answer
confidence: medium
models:
  claude: ${CLAUDE_MODEL}
  gpt: ${GPT_MODEL}
final_synthesizer: none
source_session: ${sessionId || 'unknown'}
source_message: ${messageId || 'unknown'}
---

# ${title}

## AI 회수 힌트
- 핵심 개념: ${title}
- 노트 성격: 단일 답변 수동 저장
- 다시 꺼낼 상황: 같은 질문, 같은 주제의 후속 판단, 저장된 답변을 다시 참고할 때
- 연결 후보: 정리 엔진이 추후 보강
- 신뢰도: medium

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

  try {
    await saveVaultNoteRecord({
      fileId,
      title,
      noteType: 'single_manual',
      noteContent,
      sessionId,
      messageId,
      codexStatus: 'pending',
    });
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
    contextMessages: HISTORY_CONTEXT_MESSAGES,
    hasClaude:   HAS_CLAUDE,
    hasGpt:      HAS_GPT,
  });
});

// ─── 사용자 메모리 ───────────────────────────────────────────────────────────

app.get('/api/memory', async (_req, res) => {
  const items = await readMemoryItems();
  res.json({ items });
});

app.post('/api/memory', async (req, res) => {
  const content = String(req.body?.content || '').replace(/\s+/g, ' ').trim();
  if (!content) return res.status(400).json({ error: '저장할 메모리를 입력해주세요.' });

  const current = await readMemoryItems();
  const items = await writeMemoryItems([...current, content]);
  res.json({ success: true, items });
});

app.delete('/api/memory/:index', async (req, res) => {
  const index = Number.parseInt(req.params.index, 10);
  const current = await readMemoryItems();
  if (!Number.isInteger(index) || index < 1 || index > current.length) {
    return res.status(400).json({ error: '삭제할 메모리 번호가 올바르지 않습니다.' });
  }

  current.splice(index - 1, 1);
  const items = await writeMemoryItems(current);
  res.json({ success: true, items });
});

app.delete('/api/memory', async (_req, res) => {
  const items = await writeMemoryItems([]);
  res.json({ success: true, items });
});

// ─── 기존 노트 DB 등록 ───────────────────────────────────────────────────────

function shouldSkipBackfillFile(filename) {
  return (
    !filename.endsWith('.md') ||
    filename.startsWith('.') ||
    filename === MEMORY_FILE
  );
}

async function backfillNotesFromVault() {
  let files;
  try {
    files = await fs.readdir(VAULT_PATH);
  } catch (err) {
    throw new Error(`볼트 읽기 실패: ${err.message}`);
  }

  const result = { scanned: 0, registered: 0, skipped: 0 };

  for (const filename of files) {
    if (shouldSkipBackfillFile(filename)) {
      result.skipped += 1;
      continue;
    }

    result.scanned += 1;

    try {
      const raw = await fs.readFile(path.join(VAULT_PATH, filename), 'utf8');
      const fm = parseSimpleFrontmatter(raw);
      const archived = parseFrontmatterBoolean(fm.archived);

      dbUpsertNote({
        filename,
        title: fm.title || filename.replace(/\.md$/, ''),
        noteType: fm.note_type || 'legacy',
        archived,
        codexStatus: fm.codex_status || (archived ? 'processed' : 'pending'),
        sourceSession: fm.source_session || null,
        sourceMessage: fm.source_message || null,
      });

      result.registered += 1;
    } catch (err) {
      console.warn(`노트 backfill 실패 (${filename}):`, err.message);
      result.skipped += 1;
    }
  }

  return result;
}

app.post('/api/notes/backfill', async (_req, res) => {
  try {
    const result = await backfillNotesFromVault();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 볼트 검색 ───────────────────────────────────────────────────────────────
// 향후 벡터/임베딩 검색으로 교체 시 searchVault() 함수만 수정하면 됨

function stripFrontmatter(content) {
  return content.replace(/^---[\s\S]*?---\n?/, '').trim();
}

function parseSimpleFrontmatter(raw) {
  const match = String(raw || '').match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  return match[1].split('\n').reduce((acc, line) => {
    const parts = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!parts) return acc;

    const key = parts[1];
    const value = parts[2].trim().replace(/^"(.*)"$/, '$1');
    acc[key] = value;
    return acc;
  }, {});
}

function parseFrontmatterBoolean(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function parseNoteTitle(raw, filename) {
  const fm = parseSimpleFrontmatter(raw);
  return fm.title ? fm.title.trim() : filename.replace(/\.md$/, '');
}

async function readVaultNote(filename) {
  const safeName = path.basename(filename || '');
  if (!safeName || safeName !== filename || !safeName.endsWith('.md')) return null;

  const filepath = path.join(VAULT_PATH, safeName);
  if (!filepath.startsWith(VAULT_PATH + path.sep)) return null;

  try {
    const raw = await fs.readFile(filepath, 'utf8');
    return {
      filename: safeName,
      title:    parseNoteTitle(raw, safeName),
      content:  stripFrontmatter(raw),
    };
  } catch {
    return null;
  }
}

async function resolveActiveNotes(activeNotes) {
  if (!Array.isArray(activeNotes)) return [];
  const filenames = [...new Set(
    activeNotes
      .map(n => typeof n === 'string' ? n : n?.filename)
      .filter(Boolean)
      .slice(0, MAX_ACTIVE_NOTES)
  )];

  const notes = await Promise.all(filenames.map(readVaultNote));
  return notes.filter(Boolean);
}

async function getContextNotesForQuestion(question, activeNotes) {
  const active = await resolveActiveNotes(activeNotes);
  if (active.length >= MAX_ACTIVE_NOTES) return active;

  // 향후 임베딩/벡터 검색으로 교체할 때는 searchVault() 구현만 바꾸면 됨.
  const searched = await searchVault(question);
  const merged = [...active];
  for (const hit of searched) {
    if (merged.length >= MAX_ACTIVE_NOTES) break;
    if (merged.some(n => n.filename === hit.filename)) continue;
    const note = await readVaultNote(hit.filename);
    if (note) merged.push(note);
  }
  return merged;
}

async function searchVault(query) {
  const queryLower = query.toLowerCase();
  const terms = [...new Set(
    queryLower
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .map(t => t.trim())
      .filter(t => t.length >= 2)
      .filter(t => !['그리고', '그런데', '저번에', '우리가', '관련', '내용', '알려줘', '호출해줘', '불러와줘', '꺼내줘'].includes(t))
  )];
  let files;
  try {
    files = await fs.readdir(VAULT_PATH);
  } catch {
    return [];
  }

  const results = [];
  for (const filename of files.filter(f => f.endsWith('.md'))) {
    try {
      const raw = await fs.readFile(path.join(VAULT_PATH, filename), 'utf8');
      const title = parseNoteTitle(raw, filename);
      const body  = stripFrontmatter(raw);
      const titleLower = title.toLowerCase();
      const bodyLower = body.toLowerCase();

      let score = 0;
      if (titleLower.includes(queryLower)) score += 20;
      if (bodyLower.includes(queryLower)) score += 10;
      for (const term of terms) {
        if (titleLower.includes(term)) score += 6;
        if (bodyLower.includes(term)) score += 1;
      }

      if (score > 0) {
        const firstTermHit = terms.map(t => bodyLower.indexOf(t)).filter(i => i >= 0).sort((a, b) => a - b)[0];
        const idx     = bodyLower.indexOf(queryLower);
        const hitIdx  = idx >= 0 ? idx : (firstTermHit ?? 0);
        const start   = Math.max(0, hitIdx - 80);
        const excerpt = body.slice(start, start + 300).replace(/\n{3,}/g, '\n\n').trim();
        results.push({ filename, title, excerpt, score });
      }
    } catch { /* 파일 읽기 실패 시 스킵 */ }
  }
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ACTIVE_NOTES)
    .map(({ score, ...result }) => result);
}

app.get('/api/vault/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: '검색어를 입력해주세요.' });
  const results = await searchVault(q);
  res.json({ results });
});

// 사용자 메모리는 항상, activeNotes/자동 검색 노트는 질문별 참조로 주입하는 헬퍼
// 향후 벡터 검색으로 노트를 불러올 때도 이 함수를 그대로 사용
function buildContextMessage(question, activeNotes, memoryItems = []) {
  const memoryText = memoryItems.length > 0
    ? `사용자 메모리:\n${memoryItems.join('\n').slice(0, MAX_MEMORY_CHARS)}`
    : '';

  const noteBlock = activeNotes.map(n => {
    const body = n.content.length > MAX_NOTE_CONTEXT_CHARS
      ? n.content.slice(0, MAX_NOTE_CONTEXT_CHARS) + '\n...(이하 생략)'
      : n.content;
    return `[참조 노트: ${n.title}]\n${body}`;
  }).join('\n\n---\n\n');

  const noteText = noteBlock
    ? `참조 노트:\n${noteBlock}`
    : '';

  return `아래 사용자 메모리와 참조 노트를 우선 반영하여 질문에 답해줘.

${[memoryText, noteText].filter(Boolean).join('\n\n---\n\n')}

---

질문: ${question}`;
}

// ─── 세션 히스토리 ───────────────────────────────────────────────────────────

app.get('/api/sessions/:id', (req, res) => {
  const { id } = req.params;
  const messages = stmtGetMessages.all(id);

  // 인메모리 컨텍스트 복원 (서버 재시작 후 AI가 이전 대화 참고 가능)
  hydrateSessionFromDb(id);

  res.json({ messages });
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
  const { question, sessionId, councilDraftMode, activeNotes } = req.body;
  if (!question || !sessionId) return res.status(400).json({ error: '필수 항목 누락' });
  if (!HAS_CLAUDE || !HAS_GPT) return res.status(400).json({ error: '의회 모드는 Claude와 GPT 키가 모두 필요합니다.' });

  const mode = normalizeCouncilDraftMode(councilDraftMode);

  hydrateSessionFromDb(sessionId);
  const history = sessions[sessionId];

  // 1차 답변 프롬프트 (mode에 따라 분기, 사용자 메모리 + 활성/자동 검색 노트 주입)
  const memoryItems = await readMemoryItems();
  const resolvedNotes = await getContextNotesForQuestion(question, activeNotes);
  const effectiveQuestion = memoryItems.length > 0 || resolvedNotes.length > 0
    ? buildContextMessage(question, resolvedNotes, memoryItems)
    : question;
  const firstAnswerPrompt = buildFirstAnswerPrompt(effectiveQuestion, mode);
  const context = [...formatHistoryForModelContext(history.slice(-HISTORY_CONTEXT_MESSAGES)), { role: 'user', content: firstAnswerPrompt }];
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
        messages: [GPT_LANGUAGE_SYSTEM, ...context],
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
        messages: [GPT_LANGUAGE_SYSTEM, { role: 'user', content: gptReviewPrompt }],
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
        messages: [GPT_LANGUAGE_SYSTEM, { role: 'user', content: synthPrompt }],
        max_completion_tokens: COUNCIL_TOKEN_LIMITS.synthesis,
      });
      rawText   = r.choices[0].message.content;
      usedModel = GPT_MODEL;
    }

    const { divergence, synthesis } = parseSynthesisResponse(rawText);
    const synthLabel = synthesizer === 'claude' ? 'Claude' : 'GPT';
    const transcript = buildCouncilTranscript({
      question,
      claudeReply,
      gptReply,
      claudeReview,
      gptReview,
      divergence,
      synthesis,
      synthesizer: synthLabel,
    });

    hydrateSessionFromDb(sessionId);
    sessions[sessionId].push({ role: 'user',      content: question  });
    sessions[sessionId].push({ role: 'assistant', content: synthesis, model: `${synthLabel} (의회)` });
    sessions[sessionId] = sessions[sessionId].slice(-HISTORY_CONTEXT_MESSAGES);

    dbSaveMessage(sessionId, 'user',      question,  null);
    dbSaveMessage(sessionId, 'assistant', transcript, `${synthLabel} (의회)`);

    res.json({
      divergence,
      synthesis,
      synthesizer:        synthLabel,
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
updated: ${createdStr}
mode: council
note_type: council
draft_mode: ${mode}
archived: false
codex_status: pending
ai_readable: true
knowledge_type: council_synthesis
confidence: medium
models:
  claude: ${CLAUDE_MODEL}
  gpt: ${GPT_MODEL}
final_synthesizer: ${synthesizer}
source_session: ${sessionId || 'unknown'}
source_message: ${messageId || 'unknown'}
---

# ${title}

## AI 회수 힌트
- 핵심 개념: ${title}
- 노트 성격: 의회 모드 종합
- 다시 꺼낼 상황: 같은 주제의 중요한 판단, 찬반 비교, 이전 의회 결론을 다시 검토할 때
- 연결 후보: 정리 엔진이 추후 보강
- 신뢰도: medium

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

  try {
    await saveVaultNoteRecord({
      fileId,
      title,
      noteType: 'council',
      noteContent,
      sessionId,
      messageId,
      codexStatus: 'pending',
    });
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
  console.log(`   컨텍스트: 최근 ${CONTEXT_N}턴 내외 (${HISTORY_CONTEXT_MESSAGES}개 메시지)\n`);
});
