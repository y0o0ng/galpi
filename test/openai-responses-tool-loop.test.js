'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runOpenAIResponsesToolLoop,
  toOpenAIResponsesTool,
} = require('../lib/openai-responses-tool-loop');

test('Responses tool adapter preserves Anthropic schemas in explicit non-strict mode', () => {
  assert.deepEqual(toOpenAIResponsesTool({
    name: 'paper_fulltext_search',
    description: 'Search a paper.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  }), {
    type: 'function',
    name: 'paper_fulltext_search',
    description: 'Search a paper.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    strict: false,
  });
});

test('Responses tool loop preserves every output item and exact call_id', async () => {
  const requests = [];
  const executed = [];
  const responses = [
    {
      id: 'resp_1',
      status: 'completed',
      model: 'gpt-5.6-terra',
      output: [
        { type: 'reasoning', id: 'rs_1', encrypted_content: 'opaque' },
        {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_exact',
          name: 'web_search',
          arguments: '{"query":"latest"}',
        },
      ],
    },
    {
      id: 'resp_2',
      status: 'completed',
      model: 'gpt-5.6-terra',
      output_text: '최종 답변',
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: '최종 답변' }],
      }],
    },
  ];

  const result = await runOpenAIResponsesToolLoop({
    createResponse: async request => {
      requests.push(structuredClone(request));
      return responses.shift();
    },
    model: 'gpt-5.6-terra',
    maxOutputTokens: 1000,
    input: [{ role: 'user', content: '질문' }],
    instructions: '도구 규칙',
    reasoningEffort: 'medium',
    getTools: () => [{
      name: 'web_search',
      description: 'Search',
      input_schema: { type: 'object', properties: { query: { type: 'string' } } },
    }],
    executeTool: async call => {
      executed.push(call);
      return { content: '{"results":[]}' };
    },
    maxToolRounds: 2,
  });

  assert.equal(result.outputText, '최종 답변');
  assert.equal(result.toolRounds, 1);
  assert.equal(requests[0].store, false);
  assert.equal(requests[0].reasoning.effort, 'medium');
  assert.equal(requests[0].reasoning.context, 'current_turn');
  assert.equal(requests[0].tools[0].strict, false);
  assert.equal(requests[1].input[1].type, 'reasoning');
  assert.equal(requests[1].input[2].type, 'function_call');
  assert.equal(requests[1].input[3].type, 'function_call_output');
  assert.equal(requests[1].input[3].call_id, 'call_exact');
  assert.deepEqual(executed, [{
    id: 'fc_1',
    callId: 'call_exact',
    name: 'web_search',
    input: { query: 'latest' },
  }]);
});

test('Responses tool loop returns directly when no tool is used', async () => {
  let calls = 0;
  const result = await runOpenAIResponsesToolLoop({
    createResponse: async () => {
      calls += 1;
      return {
        status: 'completed',
        output: [{
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '초록으로 충분함' }],
        }],
      };
    },
    model: 'gpt-5.6-terra',
    maxOutputTokens: 1000,
    input: [],
    getTools: () => [{ name: 'paper_fulltext_search' }],
    executeTool: async () => ({ content: '' }),
  });
  assert.equal(calls, 1);
  assert.equal(result.outputText, '초록으로 충분함');
  assert.equal(result.toolRounds, 0);
});

test('Responses tool loop serializes executor failures as function outputs', async () => {
  const requests = [];
  const result = await runOpenAIResponsesToolLoop({
    createResponse: async request => {
      requests.push(structuredClone(request));
      if (requests.length === 1) {
        return {
          status: 'completed',
          output: [{
            type: 'function_call',
            id: 'fc_bad',
            call_id: 'call_bad',
            name: 'paper_fulltext_search',
            arguments: '{}',
          }],
        };
      }
      return {
        status: 'completed',
        output_text: '전문 미확보',
        output: [],
      };
    },
    model: 'gpt-5.6-terra',
    maxOutputTokens: 1000,
    input: [],
    getTools: () => [{ name: 'paper_fulltext_search' }],
    executeTool: async () => { throw new Error('blocked'); },
  });
  const output = JSON.parse(requests[1].input.at(-1).output);
  assert.deepEqual(output, { success: false, error: 'blocked' });
  assert.equal(result.outputText, '전문 미확보');
});

test('Responses tool loop rejects incomplete and empty final responses', async () => {
  await assert.rejects(
    runOpenAIResponsesToolLoop({
      createResponse: async () => ({ status: 'incomplete', output: [] }),
      model: 'gpt-5.6-terra',
      maxOutputTokens: 100,
      input: [],
      getTools: () => [],
      executeTool: async () => ({}),
    }),
    error => error.code === 'INCOMPLETE_MODEL_RESPONSE',
  );
  await assert.rejects(
    runOpenAIResponsesToolLoop({
      createResponse: async () => ({ status: 'completed', output: [] }),
      model: 'gpt-5.6-terra',
      maxOutputTokens: 100,
      input: [],
      getTools: () => [],
      executeTool: async () => ({}),
    }),
    error => error.code === 'INCOMPLETE_MODEL_RESPONSE',
  );
});

// ─── 스트리밍 (C2) ────────────────────────────────────────────────────────

function streamOf(events) {
  return (async function* generate() {
    for (const event of events) yield event;
  })();
}

test('streaming forwards text deltas and still returns the completed response', async () => {
  const deltas = [];
  const requests = [];
  const response = {
    status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '안녕. 반가워.' }] }],
  };
  const result = await runOpenAIResponsesToolLoop({
    createResponse: async () => { throw new Error('스트리밍이면 부르면 안 된다'); },
    createResponseStream: async request => {
      requests.push(request);
      return streamOf([
        { type: 'response.created', response: { status: 'in_progress' } },
        { type: 'response.output_text.delta', delta: '안녕. ' },
        { type: 'response.output_text.delta', delta: '반가워.' },
        { type: 'response.completed', response },
      ]);
    },
    onDelta: text => deltas.push(text),
    model: 'gpt-5.6-terra',
    input: [],
    getTools: () => [],
    executeTool: async () => ({ content: '' }),
    maxToolRounds: 0,
  });

  assert.equal(requests[0].stream, true);
  assert.deepEqual(deltas, ['안녕. ', '반가워.']);
  assert.equal(result.outputText, '안녕. 반가워.');
});

test('text streamed before a tool call is reported so it can be dropped', async () => {
  const deltas = [];
  let discarded = 0;
  const withTool = {
    status: 'completed',
    output: [
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '찾아볼게.' }] },
      { type: 'function_call', call_id: 'c1', name: 'web_search', arguments: '{}' },
    ],
  };
  const final = {
    status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '결과는 이래.' }] }],
  };
  let round = 0;
  const result = await runOpenAIResponsesToolLoop({
    createResponse: async () => { throw new Error('스트리밍이면 부르면 안 된다'); },
    createResponseStream: async () => {
      round += 1;
      return round === 1
        ? streamOf([
          { type: 'response.output_text.delta', delta: '찾아볼게.' },
          { type: 'response.completed', response: withTool },
        ])
        : streamOf([
          { type: 'response.output_text.delta', delta: '결과는 이래.' },
          { type: 'response.completed', response: final },
        ]);
    },
    onDelta: text => deltas.push(text),
    onDiscardedText: () => { discarded += 1; },
    model: 'gpt-5.6-terra',
    input: [],
    getTools: () => [{ name: 'web_search', description: '', input_schema: { type: 'object', properties: {} } }],
    executeTool: async () => ({ content: '검색 결과' }),
    maxToolRounds: 1,
  });

  // 도구 앞의 텍스트는 최종 답변이 아니다. 알려야 조각을 버릴 수 있다.
  assert.equal(discarded, 1);
  assert.deepEqual(deltas, ['찾아볼게.', '결과는 이래.']);
  assert.equal(result.outputText, '결과는 이래.');
});

test('without an onDelta the loop keeps using the non-streaming call', async () => {
  let streamCalls = 0;
  let plainCalls = 0;
  const response = {
    status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '안녕' }] }],
  };
  await runOpenAIResponsesToolLoop({
    createResponse: async () => { plainCalls += 1; return response; },
    createResponseStream: async () => { streamCalls += 1; return streamOf([]); },
    model: 'gpt-5.6-terra',
    input: [],
    getTools: () => [],
    executeTool: async () => ({ content: '' }),
    maxToolRounds: 0,
  });

  // 텍스트 채팅은 기존 경로를 그대로 쓴다. 회귀 위험을 만들지 않는다.
  assert.equal(plainCalls, 1);
  assert.equal(streamCalls, 0);
});

test('a stream that ends without a response fails instead of returning nothing', async () => {
  await assert.rejects(() => runOpenAIResponsesToolLoop({
    createResponse: async () => ({}),
    createResponseStream: async () => streamOf([{ type: 'response.output_text.delta', delta: 'x' }]),
    onDelta: () => {},
    model: 'gpt-5.6-terra',
    input: [],
    getTools: () => [],
    executeTool: async () => ({ content: '' }),
    maxToolRounds: 0,
  }), error => error.code === 'INCOMPLETE_MODEL_RESPONSE');
});
