'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SCHEDULE_PREPARE_TOOL,
  createSchedulePrepareSession,
  scheduleSystemPrompt,
} = require('../lib/assistant-schedule-tools');
const { runClaudeToolLoop } = require('../lib/claude-tool-loop');

test('schedule prepare session exposes one no-write tool and preserves the validated candidate', () => {
  const capturedAt = Math.floor(Date.parse('2026-07-19T12:00:00+09:00') / 1000);
  const calls = [];
  const store = {
    prepare(input, options) {
      calls.push({ input, options });
      return { capturedAt: options.capturedAt, timezone: 'Asia/Seoul', task: input };
    },
  };
  const session = createSchedulePrepareSession(store, {
    capturedAt,
    clientRequestId: 'chat-task:00000000-0000-4000-8000-000000000001',
  });

  assert.deepEqual(session.getToolDefinitions(), [SCHEDULE_PREPARE_TOOL]);
  assert.match(session.systemPrompt, /마지막 <user_question>/);
  assert.match(session.systemPrompt, /저장이 아니라 확인 후보 준비/);
  assert.match(session.systemPrompt, /2026-07-19T12:00:00\+09:00/);

  const result = session.execute('schedule_prepare', {
    title: '보고서 제출',
    detail: '최종본',
    due: { kind: 'datetime', at: '2026-07-20T18:00:00+09:00' },
    reminderAt: '2026-07-20T17:00:00+09:00',
  });
  assert.equal(result.isError, undefined);
  assert.equal(JSON.parse(result.content).persisted, false);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    input: {
      clientRequestId: 'chat-task:00000000-0000-4000-8000-000000000001',
      title: '보고서 제출',
      detail: '최종본',
      due: { kind: 'datetime', at: '2026-07-20T18:00:00+09:00' },
      reminderAt: '2026-07-20T17:00:00+09:00',
    },
    options: { capturedAt },
  });
  assert.deepEqual(session.getCandidate().task, calls[0].input);
  assert.deepEqual(session.getToolDefinitions(), []);

  const duplicate = session.execute('schedule_prepare', {
    title: '두 번째 후보',
    due: { kind: 'none' },
  });
  assert.equal(duplicate.isError, true);
  assert.equal(calls.length, 1);
});

test('schedule prompt forbids context-triggered writes and implicit reminders', () => {
  const prompt = scheduleSystemPrompt(Math.floor(Date.parse('2026-07-19T12:00:00+09:00') / 1000));
  assert.match(prompt, /<context>.*만으로는 호출하지 않는다/s);
  assert.match(prompt, /수정, 완료, 취소, 삭제 요청에는 호출하지 않는다/);
  assert.match(prompt, /임의의 알림은 만들지 않는다/);
  assert.match(prompt, /확정할 수 없으면 도구를 호출하지 말고 짧게 되묻는다/);
});

test('Claude tool loop returns a final reply while the prepared candidate stays unpersisted', async () => {
  const capturedAt = Math.floor(Date.parse('2026-07-19T12:00:00+09:00') / 1000);
  let prepareCalls = 0;
  const session = createSchedulePrepareSession({
    prepare(input, options) {
      prepareCalls += 1;
      return { capturedAt: options.capturedAt, timezone: 'Asia/Seoul', task: input };
    },
  }, {
    capturedAt,
    clientRequestId: 'chat-task:00000000-0000-4000-8000-000000000002',
  });
  const requests = [];
  const responses = [
    {
      content: [{
        type: 'tool_use',
        id: 'tool-1',
        name: 'schedule_prepare',
        input: { title: '병원 예약', due: { kind: 'date', date: '2026-07-22' } },
      }],
    },
    { content: [{ type: 'text', text: '아래 내용을 확인하고 등록해줘.' }] },
  ];

  const result = await runClaudeToolLoop({
    createMessage: async request => {
      requests.push(request);
      return responses.shift();
    },
    model: 'claude-test',
    maxTokens: 500,
    messages: [{ role: 'user', content: '<user_question>병원 예약 일정 만들어줘</user_question>' }],
    system: session.systemPrompt,
    getTools: () => session.getToolDefinitions(),
    executeTool: toolUse => session.execute(toolUse.name, toolUse.input),
  });

  assert.equal(result.toolRounds, 1);
  assert.equal(prepareCalls, 1);
  assert.equal(requests[0].tools[0].name, 'schedule_prepare');
  assert.equal(requests[1].tools, undefined);
  assert.equal(session.getCandidate().task.title, '병원 예약');
});

