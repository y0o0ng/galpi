'use strict';

const crypto = require('crypto');

const CONTEXT_LOOKUP_TOOL = 'galpi_context_lookup';
const NOTE_SEARCH_TOOL = 'galpi_note_search';
const NOTE_READ_TOOL = 'galpi_note_read';
const SCHEDULE_READ_TOOL = 'schedule_read';
const CURRENT_TIME_TOOL = 'galpi_current_time';
const DEFAULT_MAX_CALLS_PER_TURN = 2;
const DEFAULT_MAX_CONTEXT_CHARS = 8000;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_SESSION_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ARGUMENT_BYTES = 8 * 1024;

const REALTIME_READ_TOOLS = Object.freeze([
  {
    type: 'function',
    name: CURRENT_TIME_TOOL,
    description: [
      '조회 전용 도구다.',
      '사용자가 지금 날짜, 요일 또는 정확한 현재 시각을 물으면 호출해',
      '갈피 서버가 확인한 Asia/Seoul(KST) 현재 시각을 읽는다.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    type: 'function',
    name: CONTEXT_LOOKUP_TOOL,
    description: [
      '조회 전용 도구다.',
      '사용자가 자신의 과거 결정, 저장한 지식, 이전에 나눈 구체적인 내용을 물을 때만',
      '갈피의 검증된 기억 청크를 읽는다. 일반 상식이나 현재 대화만으로 답할 수 있으면 호출하지 않는다.',
      '결과가 없으면 추측하지 말고 기억에서 찾지 못했다고 말한다.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description: '사용자의 질문을 의미가 보존되도록 간결하게 정리한 검색 질의',
        },
      },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: NOTE_SEARCH_TOOL,
    description: [
      '조회 전용 도구다.',
      '사용자가 자신의 시, 일기, 강의 노트처럼 저장된 노트나 문서의 목록을 둘러보거나',
      '그중 하나를 골라 읽어 달라고 하면 먼저 이 도구로 노트를 찾는다.',
      '결과의 filename만 galpi_note_read에 전달한다.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description: '찾을 노트의 짧은 제목, 종류 또는 주제. 예: 시, 강의 노트',
        },
      },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: NOTE_READ_TOOL,
    description: [
      '조회 전용 도구다.',
      'galpi_note_search가 반환한 정확한 filename의 노트를 읽는다.',
      'topic 노트는 기존의 검증된 QA 청크 단위로 읽는다.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        filename: {
          type: 'string',
          description: 'galpi_note_search 결과에 포함된 정확한 Markdown filename',
        },
      },
      required: ['filename'],
    },
  },
  {
    type: 'function',
    name: SCHEDULE_READ_TOOL,
    description: [
      '조회 전용 도구다.',
      '현재 갈피 일정 DB의 활성 일정만 읽는다.',
      '완료, 취소, 삭제, 등록, 수정은 할 수 없으며 과거 일정 조회에도 사용하지 않는다.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
]);

class RealtimeToolError extends Error {
  constructor(message, {
    code = 'REALTIME_TOOL_FAILED',
    status = 500,
  } = {}) {
    super(message);
    this.name = 'RealtimeToolError';
    this.code = code;
    this.status = status;
  }
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function validateOpaqueId(value, label) {
  const resolved = String(value || '').trim();
  if (!resolved || resolved.length > 160 || !/^[A-Za-z0-9_.:-]+$/.test(resolved)) {
    throw new RealtimeToolError(`${label} 식별자가 올바르지 않습니다.`, {
      code: 'INVALID_REALTIME_TOOL_REQUEST',
      status: 400,
    });
  }
  return resolved;
}

function parseArguments(value, maxBytes) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value ?? {});
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    throw new RealtimeToolError('도구 인자가 허용 크기를 넘었습니다.', {
      code: 'REALTIME_TOOL_ARGUMENTS_TOO_LARGE',
      status: 413,
    });
  }
  try {
    const parsed = JSON.parse(raw || '{}');
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
    return { raw, parsed };
  } catch {
    throw new RealtimeToolError('도구 인자가 올바른 JSON 객체가 아닙니다.', {
      code: 'INVALID_REALTIME_TOOL_ARGUMENTS',
      status: 400,
    });
  }
}

function normalizeProviderResult(value) {
  if (typeof value === 'string') {
    return { content: value, found: Boolean(value.trim()) };
  }
  const content = String(value?.content || '');
  return {
    content,
    found: value?.found === undefined ? Boolean(content.trim()) : value.found === true,
  };
}

function formatCurrentTime(nowMs) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(nowMs))
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  );
  return {
    found: true,
    content: [
      '<current_time timezone="Asia/Seoul">',
      `${parts.year}-${parts.month}-${parts.day} ${parts.weekday} ${parts.hour}:${parts.minute}:${parts.second} KST`,
      '</current_time>',
    ].join('\n'),
  };
}

async function withTimeout(task, timeoutMs) {
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve().then(task),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new RealtimeToolError(
          '읽기 도구 응답 시간이 초과됐습니다.',
          { code: 'REALTIME_TOOL_TIMEOUT', status: 504 },
        )), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function createRealtimeToolDispatcher({
  enabled = false,
  lookupContext,
  searchNotes,
  readNote,
  readSchedule,
  maxCallsPerTurn = DEFAULT_MAX_CALLS_PER_TURN,
  maxContextChars = DEFAULT_MAX_CONTEXT_CHARS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  sessionTtlMs = DEFAULT_SESSION_TTL_MS,
  maxArgumentBytes = DEFAULT_MAX_ARGUMENT_BYTES,
  now = () => Date.now(),
  createId = () => crypto.randomBytes(24).toString('base64url'),
} = {}) {
  const available = enabled === true
    && typeof lookupContext === 'function'
    && typeof searchNotes === 'function'
    && typeof readNote === 'function'
    && typeof readSchedule === 'function';
  const resolvedMaxCalls = clampInteger(
    maxCallsPerTurn,
    DEFAULT_MAX_CALLS_PER_TURN,
    1,
    8,
  );
  const resolvedMaxChars = clampInteger(
    maxContextChars,
    DEFAULT_MAX_CONTEXT_CHARS,
    256,
    20000,
  );
  const resolvedTimeoutMs = clampInteger(timeoutMs, DEFAULT_TIMEOUT_MS, 250, 30000);
  const resolvedSessionTtlMs = clampInteger(
    sessionTtlMs,
    DEFAULT_SESSION_TTL_MS,
    30000,
    15 * 60 * 1000,
  );
  const resolvedMaxArgumentBytes = clampInteger(
    maxArgumentBytes,
    DEFAULT_MAX_ARGUMENT_BYTES,
    512,
    64 * 1024,
  );
  const sessions = new Map();

  function pruneExpired() {
    const current = now();
    for (const [sessionId, session] of sessions) {
      if (session.expiresAt <= current) sessions.delete(sessionId);
    }
  }

  function createSession() {
    if (!available) return '';
    pruneExpired();
    const sessionId = validateOpaqueId(createId(), '세션');
    sessions.set(sessionId, {
      expiresAt: now() + resolvedSessionTtlMs,
      calls: new Map(),
      turns: new Map(),
      tail: Promise.resolve(),
    });
    return sessionId;
  }

  function destroySession(sessionId) {
    if (!sessionId) return false;
    return sessions.delete(String(sessionId));
  }

  function getSession(sessionId) {
    if (!available) {
      throw new RealtimeToolError('Realtime 읽기 도구가 비활성화되어 있습니다.', {
        code: 'REALTIME_TOOLS_DISABLED',
        status: 503,
      });
    }
    pruneExpired();
    const resolvedSessionId = validateOpaqueId(sessionId, '세션');
    const session = sessions.get(resolvedSessionId);
    if (!session) {
      throw new RealtimeToolError('Realtime 읽기 세션이 만료됐습니다.', {
        code: 'REALTIME_TOOL_SESSION_EXPIRED',
        status: 410,
      });
    }
    return session;
  }

  async function executeLocked({
    sessionId,
    turnId,
    callId,
    name,
    arguments: argumentValue,
  } = {}, session) {
    const resolvedTurnId = validateOpaqueId(turnId, '턴');
    const resolvedCallId = validateOpaqueId(callId, '호출');
    const resolvedName = String(name || '').trim();
    if (![
      CURRENT_TIME_TOOL,
      CONTEXT_LOOKUP_TOOL,
      NOTE_SEARCH_TOOL,
      NOTE_READ_TOOL,
      SCHEDULE_READ_TOOL,
    ].includes(resolvedName)) {
      throw new RealtimeToolError('허용되지 않은 Realtime 도구입니다.', {
        code: 'REALTIME_TOOL_NOT_ALLOWED',
        status: 403,
      });
    }
    const { raw: rawArguments, parsed: parsedArguments } = parseArguments(
      argumentValue,
      resolvedMaxArgumentBytes,
    );
    const callFingerprint = `${resolvedName}\n${rawArguments}`;
    const priorCall = session.calls.get(resolvedCallId);
    if (priorCall) {
      if (priorCall.fingerprint !== callFingerprint) {
        throw new RealtimeToolError('같은 호출 ID의 내용이 일치하지 않습니다.', {
          code: 'REALTIME_TOOL_CALL_CONFLICT',
          status: 409,
        });
      }
      return priorCall.result;
    }

    const turn = session.turns.get(resolvedTurnId) || { calls: 0, contextChars: 0 };
    if (turn.calls >= resolvedMaxCalls) {
      throw new RealtimeToolError('한 턴의 읽기 도구 호출 한도를 넘었습니다.', {
        code: 'REALTIME_TOOL_CALL_LIMIT',
        status: 429,
      });
    }
    const remainingChars = Math.max(0, resolvedMaxChars - turn.contextChars);
    if (remainingChars === 0) {
      throw new RealtimeToolError('한 턴의 읽기 컨텍스트 한도를 넘었습니다.', {
        code: 'REALTIME_TOOL_CONTEXT_LIMIT',
        status: 429,
      });
    }

    let run;
    if (resolvedName === CURRENT_TIME_TOOL) {
      if (Object.keys(parsedArguments).length > 0) {
        throw new RealtimeToolError('현재 시각 조회에는 인자가 필요하지 않습니다.', {
          code: 'INVALID_REALTIME_TOOL_ARGUMENTS',
          status: 400,
        });
      }
      run = () => formatCurrentTime(now());
    } else if (resolvedName === CONTEXT_LOOKUP_TOOL || resolvedName === NOTE_SEARCH_TOOL) {
      if (Object.keys(parsedArguments).some(key => key !== 'query')) {
        throw new RealtimeToolError('검색 인자가 올바르지 않습니다.', {
          code: 'INVALID_REALTIME_TOOL_ARGUMENTS',
          status: 400,
        });
      }
      const query = String(parsedArguments.query || '').replace(/\s+/g, ' ').trim();
      if (!query || query.length > 1000) {
        throw new RealtimeToolError('검색 질의는 1~1,000자여야 합니다.', {
          code: 'INVALID_REALTIME_TOOL_ARGUMENTS',
          status: 400,
        });
      }
      run = resolvedName === CONTEXT_LOOKUP_TOOL
        ? () => lookupContext(query)
        : () => searchNotes(query);
    } else if (resolvedName === NOTE_READ_TOOL) {
      if (Object.keys(parsedArguments).some(key => key !== 'filename')) {
        throw new RealtimeToolError('노트 읽기 인자가 올바르지 않습니다.', {
          code: 'INVALID_REALTIME_TOOL_ARGUMENTS',
          status: 400,
        });
      }
      const filename = String(parsedArguments.filename || '').trim();
      if (
        !filename
        || filename.length > 255
        || filename.includes('\0')
        || filename.includes('/')
        || filename.includes('\\')
        || !filename.endsWith('.md')
      ) {
        throw new RealtimeToolError('노트 filename이 올바르지 않습니다.', {
          code: 'INVALID_REALTIME_TOOL_ARGUMENTS',
          status: 400,
        });
      }
      run = () => readNote(filename);
    } else {
      if (Object.keys(parsedArguments).length > 0) {
        throw new RealtimeToolError('일정 조회에는 인자가 필요하지 않습니다.', {
          code: 'INVALID_REALTIME_TOOL_ARGUMENTS',
          status: 400,
        });
      }
      run = () => readSchedule();
    }

    turn.calls += 1;
    session.turns.set(resolvedTurnId, turn);
    const providerResult = normalizeProviderResult(await withTimeout(run, resolvedTimeoutMs));
    const content = providerResult.content.slice(0, remainingChars);
    const result = Object.freeze({
      ok: true,
      tool: resolvedName,
      status: providerResult.found ? 'found' : 'no_match',
      content,
      contextChars: content.length,
      truncated: content.length < providerResult.content.length,
      remainingContextChars: remainingChars - content.length,
    });
    turn.contextChars += content.length;
    session.calls.set(resolvedCallId, {
      fingerprint: callFingerprint,
      result,
    });
    return result;
  }

  async function execute(request = {}) {
    const session = getSession(request.sessionId);
    const previous = session.tail;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const tail = previous.then(() => gate);
    session.tail = tail;
    await previous;
    try {
      return await executeLocked(request, session);
    } finally {
      release();
      if (session.tail === tail) session.tail = Promise.resolve();
    }
  }

  return {
    createSession,
    destroySession,
    execute,
    isEnabled: () => available,
    sessionCount: () => sessions.size,
    tools: available ? REALTIME_READ_TOOLS : [],
  };
}

module.exports = {
  CONTEXT_LOOKUP_TOOL,
  CURRENT_TIME_TOOL,
  DEFAULT_MAX_CALLS_PER_TURN,
  DEFAULT_MAX_CONTEXT_CHARS,
  DEFAULT_SESSION_TTL_MS,
  DEFAULT_TIMEOUT_MS,
  NOTE_READ_TOOL,
  NOTE_SEARCH_TOOL,
  REALTIME_READ_TOOLS,
  RealtimeToolError,
  SCHEDULE_READ_TOOL,
  createRealtimeToolDispatcher,
};
