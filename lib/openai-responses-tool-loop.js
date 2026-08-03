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

/**
 * 스트리밍 응답을 소비하면서 텍스트 조각을 흘려보내고, 완성된 응답 객체를 돌려준다.
 * 호출부의 나머지 로직이 비스트리밍과 같도록 반환 형태를 맞춘다.
 */
async function collectStreamedResponse(createResponseStream, request, onDelta) {
  const stream = await createResponseStream({ ...request, stream: true });
  let finalResponse = null;
  let streamedText = false;
  for await (const event of stream) {
    if (event?.type === 'response.output_text.delta') {
      const delta = String(event.delta || '');
      if (delta) {
        streamedText = true;
        onDelta(delta);
      }
    }
    // created·completed·failed 모두 전체 응답을 실어 보낸다. 마지막 것을 쓴다.
    if (event?.response) finalResponse = event.response;
  }
  if (!finalResponse) {
    const error = new Error('OpenAI Responses 스트림이 응답 없이 끝났습니다.');
    error.code = 'INCOMPLETE_MODEL_RESPONSE';
    throw error;
  }
  return { response: finalResponse, streamedText };
}

async function runOpenAIResponsesToolLoop({
  createResponse,
  createResponseStream,
  onDelta,
  onDiscardedText,
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

    const streaming = typeof createResponseStream === 'function' && typeof onDelta === 'function';
    const collected = streaming
      ? await collectStreamedResponse(createResponseStream, request, onDelta)
      : { response: await createResponse(request), streamedText: false };
    const response = collected.response;
    responses.push(response);
    if (response?.status && response.status !== 'completed') {
      throw incompleteResponseError(response);
    }

    const outputItems = Array.isArray(response?.output) ? response.output : [];
    const functionCalls = tools.length > 0
      ? outputItems.filter(item => item?.type === 'function_call')
      : [];

    // 텍스트를 흘려보낸 뒤 도구를 부르면 그 텍스트는 최종 답변이 아니다. 실측에서는
    // 도구 라운드가 텍스트를 내지 않았지만, 모델이 바뀌면 달라질 수 있어 알린다.
    if (collected.streamedText && functionCalls.length > 0) onDiscardedText?.();

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
