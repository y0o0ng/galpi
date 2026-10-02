'use strict';

// 수집 목록 → Opus 1회(도구 없음) → 카드 3장. 설계 v0.2 1장 "LLM 호출".
//
// **수정하지 않은 Claude Code CLI를 하위 프로세스로 실행하고 출력만 받는다.** OAuth 토큰·
// 자격증명 파일은 읽지 않고 환경변수로 옮기지도 않는다(HOME의 로그인 상태를 CLI가 스스로 쓴다).
// **`--tools ""`(도구 전부 끔)가 이 호출의 안전장치다.** 기사에 숨은 지시가 있어도 실행할 도구가 없다.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn: nodeSpawn } = require('node:child_process');

const PROMPT_PATH = path.join(__dirname, '..', '..', 'reels', 'prompts', 'candidates-server.md');
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const SLOT = /\{\{(\w+)\}\}/g;

// 설계 v0.2 부록의 1~4편. 새 편이 늘면 selected 개념과 함께 여기가 아니라 설계 문서를 먼저 고친다.
const COVERED_CONCEPTS = ['하모닉 드라이브', '투기적 실행·Spectre', '자연 순환', '라이프니츠 계단 드럼'];

// 모델 출력은 비신뢰 입력이다. 길이 상한은 저장·표시 모두를 지킨다.
const FIELD_LIMITS = {
  title: 200,
  url: 500,
  published_at: 40,
  why: 200,
  concept: 120,
  bridge: 400,
  template: 60,
  hook_paradox: 120,
  hook_term: 80,
  hook_subtitle: 120,
  risk: 400,
};

const CARD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['cards'],
  properties: {
    cards: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: Object.keys(FIELD_LIMITS),
        properties: Object.fromEntries(
          Object.entries(FIELD_LIMITS).map(([key, max]) => [key, { type: 'string', minLength: 1, maxLength: max }]),
        ),
      },
    },
  },
};

function reelsError(message, code) {
  return Object.assign(new Error(message), { code });
}

// reels/prompts/render.py와 같은 규칙: 빈 칸이 남거나 템플릿에 없는 칸을 넘기면 실패한다.
function renderPrompt(template, values) {
  const slots = new Set([...template.matchAll(SLOT)].map(match => match[1]));
  const missing = [...slots].filter(name => !(name in values));
  const extra = Object.keys(values).filter(name => !slots.has(name));
  if (missing.length || extra.length) {
    throw reelsError(`프롬프트 칸이 맞지 않습니다: 빈 칸 ${missing} 초과 ${extra}`, 'REELS_PROMPT_SLOTS');
  }
  return template.replace(SLOT, (_m, name) => String(values[name]));
}

function buildPrompt({ today, covered, items }) {
  return renderPrompt(fs.readFileSync(PROMPT_PATH, 'utf8'), {
    today,
    covered: covered.join(', '),
    items: JSON.stringify(items),
  });
}

/** 카드가 3장이 안 되면 던진다. URL이 수집 목록에 없던 카드는 지어낸 링크라 버린다. */
function validateCards(output, items) {
  const known = new Set(items.map(item => item.url));
  const seen = new Set();
  const cards = [];
  for (const raw of Array.isArray(output?.cards) ? output.cards : []) {
    const card = {};
    let ok = true;
    for (const [key, max] of Object.entries(FIELD_LIMITS)) {
      const value = typeof raw?.[key] === 'string' ? raw[key].trim() : '';
      if (!value || value.length > max) ok = false;
      card[key] = value;
    }
    if (!ok || !known.has(card.url) || seen.has(card.url)) continue;
    seen.add(card.url);
    cards.push(card);
  }
  if (cards.length < 3) throw reelsError(`유효한 카드가 ${cards.length}장뿐입니다.`, 'REELS_CARDS_INVALID');
  return cards.slice(0, 3);
}

function claudeArgs() {
  return [
    '-p', '--model', 'opus', '--tools', '',
    '--output-format', 'json', '--json-schema', JSON.stringify(CARD_SCHEMA),
    '--no-session-persistence', '--strict-mcp-config',
  ];
}

function runClaude({ bin, prompt, spawn = nodeSpawn, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'reels-'));
  return new Promise((resolve, reject) => {
    // ANTHROPIC_API_KEY 같은 값이 로그인 상태를 덮지 않도록 환경을 통째로 넘기지 않는다.
    const child = spawn(bin, claudeArgs(), {
      cwd,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fs.rmSync(cwd, { recursive: true, force: true });
      fn(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, reelsError('claude 호출 시간이 초과됐습니다.', 'REELS_CLAUDE_TIMEOUT'));
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', () => {}); // 내용은 쓰지도 남기지도 않는다.
    child.on('error', () => finish(reject, reelsError('claude를 실행하지 못했습니다.', 'REELS_CLAUDE_SPAWN')));
    child.on('close', code => {
      if (code !== 0) finish(reject, reelsError(`claude가 ${code}로 끝났습니다.`, 'REELS_CLAUDE_EXIT'));
      else finish(resolve, stdout);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}

function parseOutput(stdout) {
  let envelope;
  try {
    envelope = JSON.parse(stdout);
    if (envelope?.is_error) throw new Error('claude error');
    if (envelope?.structured_output && typeof envelope.structured_output === 'object') {
      return envelope.structured_output;
    }
    return typeof envelope?.result === 'string' ? JSON.parse(envelope.result) : envelope;
  } catch {
    throw reelsError('claude 출력을 해석하지 못했습니다.', 'REELS_OUTPUT_PARSE');
  }
}

async function generateCandidates({ items, covered, today, bin, spawn, timeoutMs }) {
  const prompt = buildPrompt({ today, covered, items });
  const stdout = await runClaude({ bin, prompt, spawn, timeoutMs });
  return validateCards(parseOutput(stdout), items);
}

module.exports = {
  CARD_SCHEMA,
  COVERED_CONCEPTS,
  FIELD_LIMITS,
  buildPrompt,
  claudeArgs,
  generateCandidates,
  renderPrompt,
  validateCards,
};
