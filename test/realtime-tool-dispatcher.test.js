'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CONTEXT_LOOKUP_TOOL,
  CURRENT_TIME_TOOL,
  NOTE_READ_TOOL,
  NOTE_SEARCH_TOOL,
  REALTIME_READ_TOOLS,
  RealtimeToolError,
  SCHEDULE_READ_TOOL,
  createRealtimeToolDispatcher,
} = require('../lib/realtime-tool-dispatcher');

test('Realtime read dispatcher exposes only current time, memory, note browse, and active schedule tools', () => {
  assert.deepEqual(
    REALTIME_READ_TOOLS.map(tool => tool.name),
    [CURRENT_TIME_TOOL, CONTEXT_LOOKUP_TOOL, NOTE_SEARCH_TOOL, NOTE_READ_TOOL, SCHEDULE_READ_TOOL],
  );
  const serialized = JSON.stringify(REALTIME_READ_TOOLS);
  assert.doesNotMatch(serialized, /create|register|complete|cancel|save|codex/i);
  assert.match(serialized, /조회 전용/);
});

test('Realtime current time tool returns server-authoritative KST time without arguments', async () => {
  const fixedNow = Date.parse('2026-07-30T17:34:56.000Z');
  const dispatcher = createRealtimeToolDispatcher({
    enabled: true,
    lookupContext: async () => '',
    searchNotes: async () => '',
    readNote: async () => '',
    readSchedule: async () => '',
    now: () => fixedNow,
    createId: () => 'session-time',
  });
  const sessionId = dispatcher.createSession();
  const result = await dispatcher.execute({
    sessionId,
    turnId: 'turn-time',
    callId: 'call-time',
    name: CURRENT_TIME_TOOL,
    arguments: '{}',
  });
  assert.equal(result.status, 'found');
  assert.match(result.content, /2026-07-31 Fri 02:34:56 KST/);
  assert.match(result.content, /timezone="Asia\/Seoul"/);

  await assert.rejects(
    dispatcher.execute({
      sessionId,
      turnId: 'turn-time',
      callId: 'call-time-invalid',
      name: CURRENT_TIME_TOOL,
      arguments: '{"timezone":"UTC"}',
    }),
    error => error.code === 'INVALID_REALTIME_TOOL_ARGUMENTS' && error.status === 400,
  );
});

test('Realtime read dispatcher is idempotent and enforces two calls and 8,000 chars per turn', async () => {
  const calls = [];
  const dispatcher = createRealtimeToolDispatcher({
    enabled: true,
    lookupContext: async query => {
      calls.push(['memory', query]);
      return { content: 'M'.repeat(6000), found: true };
    },
    searchNotes: async query => JSON.stringify({ query }),
    readNote: async filename => filename,
    readSchedule: () => {
      calls.push(['schedule']);
      return { content: 'S'.repeat(3000), found: true };
    },
    createId: () => 'session-1',
  });
  const sessionId = dispatcher.createSession();

  const memory = await dispatcher.execute({
    sessionId,
    turnId: 'turn-1',
    callId: 'call-1',
    name: CONTEXT_LOOKUP_TOOL,
    arguments: '{"query":"지난 프로젝트 결정"}',
  });
  assert.equal(memory.contextChars, 6000);
  assert.equal(memory.remainingContextChars, 2000);

  const duplicate = await dispatcher.execute({
    sessionId,
    turnId: 'turn-1',
    callId: 'call-1',
    name: CONTEXT_LOOKUP_TOOL,
    arguments: '{"query":"지난 프로젝트 결정"}',
  });
  assert.equal(duplicate, memory);
  assert.equal(calls.length, 1);

  const schedule = await dispatcher.execute({
    sessionId,
    turnId: 'turn-1',
    callId: 'call-2',
    name: SCHEDULE_READ_TOOL,
    arguments: '{}',
  });
  assert.equal(schedule.contextChars, 2000);
  assert.equal(schedule.truncated, true);
  assert.equal(schedule.remainingContextChars, 0);

  await assert.rejects(
    dispatcher.execute({
      sessionId,
      turnId: 'turn-1',
      callId: 'call-3',
      name: SCHEDULE_READ_TOOL,
      arguments: '{}',
    }),
    error => error instanceof RealtimeToolError
      && error.code === 'REALTIME_TOOL_CALL_LIMIT'
      && error.status === 429,
  );

  const nextTurn = await dispatcher.execute({
    sessionId,
    turnId: 'turn-2',
    callId: 'call-4',
    name: SCHEDULE_READ_TOOL,
    arguments: '{}',
  });
  assert.equal(nextTurn.contextChars, 3000);
});

test('concurrent Realtime tool calls share one serialized context budget', async () => {
  const dispatcher = createRealtimeToolDispatcher({
    enabled: true,
    lookupContext: async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return 'M'.repeat(6000);
    },
    searchNotes: async query => query,
    readNote: async filename => filename,
    readSchedule: () => 'S'.repeat(3000),
    createId: () => 'session-concurrent',
  });
  const sessionId = dispatcher.createSession();
  const [memory, schedule] = await Promise.all([
    dispatcher.execute({
      sessionId,
      turnId: 'turn-1',
      callId: 'call-memory',
      name: CONTEXT_LOOKUP_TOOL,
      arguments: '{"query":"기억"}',
    }),
    dispatcher.execute({
      sessionId,
      turnId: 'turn-1',
      callId: 'call-schedule',
      name: SCHEDULE_READ_TOOL,
      arguments: '{}',
    }),
  ]);
  assert.equal(memory.contextChars + schedule.contextChars, 8000);
  assert.equal(schedule.truncated, true);
});

test('Realtime read dispatcher rejects unknown tools, conflicting calls, timeout, and expired sessions', async () => {
  let currentTime = 1000;
  const dispatcher = createRealtimeToolDispatcher({
    enabled: true,
    lookupContext: () => new Promise(() => {}),
    searchNotes: async query => query,
    readNote: async filename => filename,
    readSchedule: () => '',
    timeoutMs: 250,
    sessionTtlMs: 30000,
    now: () => currentTime,
    createId: () => 'session-2',
  });
  const sessionId = dispatcher.createSession();

  await assert.rejects(
    dispatcher.execute({
      sessionId,
      turnId: 'turn-1',
      callId: 'call-unknown',
      name: 'note_save',
      arguments: '{}',
    }),
    error => error.code === 'REALTIME_TOOL_NOT_ALLOWED' && error.status === 403,
  );
  await assert.rejects(
    dispatcher.execute({
      sessionId,
      turnId: 'turn-1',
      callId: 'call-timeout',
      name: CONTEXT_LOOKUP_TOOL,
      arguments: '{"query":"기억"}',
    }),
    error => error.code === 'REALTIME_TOOL_TIMEOUT' && error.status === 504,
  );

  const schedule = await dispatcher.execute({
    sessionId,
    turnId: 'turn-1',
    callId: 'call-schedule',
    name: SCHEDULE_READ_TOOL,
    arguments: '{}',
  });
  assert.equal(schedule.status, 'no_match');
  await assert.rejects(
    dispatcher.execute({
      sessionId,
      turnId: 'turn-2',
      callId: 'call-schedule',
      name: SCHEDULE_READ_TOOL,
      arguments: '{"extra":true}',
    }),
    error => error.code === 'REALTIME_TOOL_CALL_CONFLICT' && error.status === 409,
  );

  currentTime += 30001;
  await assert.rejects(
    dispatcher.execute({
      sessionId,
      turnId: 'turn-2',
      callId: 'call-expired',
      name: SCHEDULE_READ_TOOL,
      arguments: '{}',
    }),
    error => error.code === 'REALTIME_TOOL_SESSION_EXPIRED' && error.status === 410,
  );
});

test('disabled Realtime read dispatcher creates no sessions and fails closed', async () => {
  const dispatcher = createRealtimeToolDispatcher({
    enabled: false,
    lookupContext: async () => 'memory',
    searchNotes: async () => 'notes',
    readNote: async () => 'note',
    readSchedule: () => 'schedule',
  });
  assert.deepEqual(dispatcher.tools, []);
  assert.equal(dispatcher.createSession(), '');
  await assert.rejects(
    dispatcher.execute({
      sessionId: 'session',
      turnId: 'turn',
      callId: 'call',
      name: SCHEDULE_READ_TOOL,
      arguments: '{}',
    }),
    error => error.code === 'REALTIME_TOOLS_DISABLED' && error.status === 503,
  );
});

test('Realtime note browse validates search and read arguments and shares the turn budget', async () => {
  const calls = [];
  const dispatcher = createRealtimeToolDispatcher({
    enabled: true,
    lookupContext: async () => '',
    searchNotes: async query => {
      calls.push(['search', query]);
      return '{"noteCandidates":[{"filename":"poems.md","title":"시"}]}';
    },
    readNote: async filename => {
      calls.push(['read', filename]);
      return 'Q: 시를 보여줘\nA: 한 편의 시';
    },
    readSchedule: async () => '',
    createId: () => 'session-notes',
  });
  const sessionId = dispatcher.createSession();

  const search = await dispatcher.execute({
    sessionId,
    turnId: 'turn-1',
    callId: 'call-search',
    name: NOTE_SEARCH_TOOL,
    arguments: '{"query":"시"}',
  });
  assert.equal(search.status, 'found');

  const read = await dispatcher.execute({
    sessionId,
    turnId: 'turn-1',
    callId: 'call-read',
    name: NOTE_READ_TOOL,
    arguments: '{"filename":"poems.md"}',
  });
  assert.equal(read.status, 'found');
  assert.deepEqual(calls, [
    ['search', '시'],
    ['read', 'poems.md'],
  ]);

  await assert.rejects(
    dispatcher.execute({
      sessionId,
      turnId: 'turn-2',
      callId: 'call-invalid',
      name: NOTE_READ_TOOL,
      arguments: '{"filename":"../poems.md"}',
    }),
    error => error.code === 'INVALID_REALTIME_TOOL_ARGUMENTS' && error.status === 400,
  );
});
