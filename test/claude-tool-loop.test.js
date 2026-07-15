'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { runClaudeToolLoop } = require('../lib/claude-tool-loop');

test('Claude tool loop pairs every tool use and stops after two tool rounds', async () => {
  const requests = [];
  const responses = [
    {
      content: [
        { type: 'text', text: '검색하겠습니다.' },
        { type: 'tool_use', id: 'search-1', name: 'paper_fulltext_search', input: { paperId: 'p1' } },
        { type: 'tool_use', id: 'web-1', name: 'web_search', input: { query: 'current fact' } },
      ],
    },
    {
      content: [
        { type: 'tool_use', id: 'read-1', name: 'paper_fulltext_read', input: { paperId: 'p1', chunkId: 'c1' } },
      ],
    },
    { content: [{ type: 'text', text: '최종 답변' }] },
  ];
  const executed = [];
  let phase = 0;
  const result = await runClaudeToolLoop({
    createMessage: async request => {
      requests.push(structuredClone(request));
      return responses.shift();
    },
    model: 'claude-test',
    maxTokens: 1000,
    messages: [{ role: 'user', content: '질문' }],
    system: '도구 규칙',
    getTools: () => phase === 0
      ? [{ name: 'paper_fulltext_search' }, { name: 'web_search' }]
      : [{ name: 'paper_fulltext_read' }],
    executeTool: async toolUse => {
      executed.push(toolUse.id);
      if (toolUse.id === 'search-1') phase = 1;
      return { content: `result:${toolUse.id}` };
    },
    maxToolRounds: 2,
  });

  assert.equal(result.response.content[0].text, '최종 답변');
  assert.equal(result.toolRounds, 2);
  assert.deepEqual(executed, ['search-1', 'web-1', 'read-1']);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].tools.length, 2);
  assert.equal(requests[1].messages.at(-1).content.length, 2);
  assert.equal(requests[2].tools, undefined);
  assert.equal(requests[2].messages.at(-1).content[0].tool_use_id, 'read-1');
});

test('Claude tool loop returns directly without another call when no tool is used', async () => {
  let calls = 0;
  const result = await runClaudeToolLoop({
    createMessage: async () => {
      calls += 1;
      return { content: [{ type: 'text', text: '초록으로 충분한 답변' }] };
    },
    model: 'claude-test',
    maxTokens: 1000,
    messages: [{ role: 'user', content: '요약해줘' }],
    getTools: () => [{ name: 'paper_fulltext_search' }],
    executeTool: async () => ({ content: '' }),
    maxToolRounds: 2,
  });

  assert.equal(calls, 1);
  assert.equal(result.toolRounds, 0);
});

test('Claude tool loop returns an error result for executor failures', async () => {
  const requests = [];
  const result = await runClaudeToolLoop({
    createMessage: async request => {
      requests.push(request);
      return requests.length === 1
        ? { content: [{ type: 'tool_use', id: 'bad-1', name: 'paper_fulltext_search', input: {} }] }
        : { content: [{ type: 'text', text: '전문 미확보' }] };
    },
    model: 'claude-test',
    maxTokens: 1000,
    messages: [],
    getTools: () => [{ name: 'paper_fulltext_search' }],
    executeTool: async () => { throw new Error('blocked'); },
    maxToolRounds: 2,
  });

  assert.equal(result.response.content[0].text, '전문 미확보');
  assert.equal(requests[1].messages.at(-1).content[0].is_error, true);
  assert.equal(requests[1].messages.at(-1).content[0].content, 'blocked');
});
