'use strict';

require('dotenv').config();
const OpenAI = require('openai');

const { probeOpenAIResponsesModel } = require('../lib/openai-model-catalog');

async function main() {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    console.error(JSON.stringify({
      success: false,
      code: 'OPENAI_API_KEY_MISSING',
    }));
    process.exitCode = 2;
    return;
  }

  const modelId = String(
    process.env.GPT_CHAT_BOOTSTRAP_MODEL || 'gpt-5.6-terra',
  ).trim();
  const baseURL = String(process.env.OPENAI_BASE_URL || '').trim();
  const client = new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });

  try {
    const result = await probeOpenAIResponsesModel(client, modelId);
    console.log(JSON.stringify({
      success: true,
      requestedModelId: modelId,
      returnedModelId: result.modelId,
      checks: ['responses', 'function_call', 'final_text'],
    }));
  } catch (error) {
    console.error(JSON.stringify({
      success: false,
      requestedModelId: modelId,
      code: String(error?.code || error?.name || 'OPENAI_RESPONSES_SMOKE_FAILED'),
      status: Number(error?.status || error?.statusCode || 0) || null,
    }));
    process.exitCode = 1;
  }
}

void main();
