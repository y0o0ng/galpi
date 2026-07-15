'use strict';

async function runClaudeToolLoop({
  createMessage,
  model,
  maxTokens,
  messages,
  system = '',
  getTools,
  executeTool,
  maxToolRounds = 2,
} = {}) {
  if (typeof createMessage !== 'function') throw new TypeError('Claude 메시지 생성 함수가 필요합니다.');
  if (typeof getTools !== 'function' || typeof executeTool !== 'function') {
    throw new TypeError('도구 목록과 실행 함수가 필요합니다.');
  }
  const conversation = Array.isArray(messages) ? [...messages] : [];
  const boundedRounds = Math.max(0, Math.min(4, Math.trunc(Number(maxToolRounds) || 0)));

  for (let round = 0; round <= boundedRounds; round += 1) {
    const tools = round < boundedRounds ? getTools() : [];
    const request = {
      model,
      max_tokens: maxTokens,
      messages: conversation,
    };
    if (system) request.system = system;
    if (tools.length > 0) request.tools = tools;
    const response = await createMessage(request);
    const toolUses = tools.length > 0
      ? (Array.isArray(response?.content) ? response.content : []).filter(block => block?.type === 'tool_use')
      : [];
    if (toolUses.length === 0) return { response, toolRounds: round };

    const toolResults = [];
    for (const toolUse of toolUses) {
      try {
        const result = await executeTool(toolUse);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          ...(result?.isError ? { is_error: true } : {}),
          content: String(result?.content || ''),
        });
      } catch (error) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          is_error: true,
          content: String(error?.message || '도구 실행에 실패했습니다.').slice(0, 500),
        });
      }
    }
    conversation.push(
      { role: 'assistant', content: response.content },
      { role: 'user', content: toolResults },
    );
  }

  throw new Error('Claude 도구 반복이 종료되지 않았습니다.');
}

module.exports = { runClaudeToolLoop };
