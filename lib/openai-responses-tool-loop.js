'use strict';

const { extractResponseText } = require('./openai-model-catalog');

function toOpenAIResponsesTool(tool) {
  const name = String(tool?.name || '').trim();
  if (!name) throw new TypeError('도구 이름이 필요합니다.');
  const inputSchema = tool.input_schema || tool.parameters || {
    type: 'object',
    properties: {},
  };
  return {
    type: 'function',
    name,
    description: String(tool.description || '').trim(),
    parameters: inputSchema,
    // 기존 Anthropic 도구 스키마의 best-effort 동작을 그대로 보존한다.
    strict: false,
  };
}

function incompleteResponseError(response) {
  const status = String(response?.status || 'unknown');
  const error = new Error(`OpenAI Responses 응답이 완료되지 않았습니다: ${status}`);
  error.code = 'INCOMPLETE_MODEL_RESPONSE';
  error.responseStatus = status;
  return error;
}

function toolLoopExhaustedError() {
  const error = new Error('OpenAI Responses 도구 반복이 종료되지 않았습니다.');
  error.code = 'TOOL_LOOP_EXHAUSTED';
  return error;
}

function toolOutputText(result) {
  const content = String(result?.content || '');
  if (!result?.isError) return content;
  return JSON.stringify({
    success: false,
    error: content.slice(0, 1000) || '도구 실행에 실패했습니다.',
  });
}

async function runOpenAIResponsesToolLoop({
  createResponse,
  model,
  maxOutputTokens,
  input,
  instructions = '',
  reasoningEffort = 'medium',
  reasoningContext = 'current_turn',
  safetyIdentifier = null,
  getTools,
  executeTool,
  maxToolRounds = 2,
} = {}) {
  if (typeof createResponse !== 'function') {
    throw new TypeError('OpenAI Responses 생성 함수가 필요합니다.');
  }
  if (typeof getTools !== 'function' || typeof executeTool !== 'function') {
    throw new TypeError('도구 목록과 실행 함수가 필요합니다.');
  }

  const runningInput = Array.isArray(input) ? [...input] : [];
  const boundedRounds = Math.max(0, Math.min(4, Math.trunc(Number(maxToolRounds) || 0)));
  const responses = [];

  for (let round = 0; round <= boundedRounds; round += 1) {
    const tools = round < boundedRounds
      ? (getTools() || []).map(toOpenAIResponsesTool)
      : [];
    const request = {
      model,
      input: runningInput,
      store: false,
      max_output_tokens: maxOutputTokens,
    };
    if (instructions) request.instructions = instructions;
    if (reasoningEffort || reasoningContext) {
      request.reasoning = {
        ...(reasoningEffort ? { effort: reasoningEffort } : {}),
        ...(reasoningContext ? { context: reasoningContext } : {}),
      };
    }
    if (safetyIdentifier) request.safety_identifier = safetyIdentifier;
    if (tools.length > 0) request.tools = tools;

    const response = await createResponse(request);
    responses.push(response);
    if (response?.status && response.status !== 'completed') {
      throw incompleteResponseError(response);
    }

    const outputItems = Array.isArray(response?.output) ? response.output : [];
    const functionCalls = tools.length > 0
      ? outputItems.filter(item => item?.type === 'function_call')
      : [];

    if (functionCalls.length === 0) {
      const outputText = extractResponseText(response);
      if (!outputText) {
        const error = new Error('OpenAI Responses 최종 텍스트가 비어 있습니다.');
        error.code = 'INCOMPLETE_MODEL_RESPONSE';
        throw error;
      }
      return {
        response,
        responses,
        outputText,
        toolRounds: round,
      };
    }

    runningInput.push(...outputItems);
    for (const functionCall of functionCalls) {
      let args;
      try {
        args = JSON.parse(functionCall.arguments || '{}');
      } catch {
        args = {};
      }
      let result;
      try {
        result = await executeTool({
          id: functionCall.id,
          callId: functionCall.call_id,
          name: functionCall.name,
          input: args,
        });
      } catch (error) {
        result = {
          isError: true,
          content: String(error?.message || '도구 실행에 실패했습니다.').slice(0, 500),
        };
      }
      runningInput.push({
        type: 'function_call_output',
        call_id: functionCall.call_id,
        output: toolOutputText(result),
      });
    }
  }

  throw toolLoopExhaustedError();
}

module.exports = {
  runOpenAIResponsesToolLoop,
  toOpenAIResponsesTool,
};
