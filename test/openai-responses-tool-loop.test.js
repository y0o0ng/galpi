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
