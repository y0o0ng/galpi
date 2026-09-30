'use strict';

const OpenAI = require('openai');
const { extractResponseText } = require('../openai-model-catalog');
const { GENERAL_FACT_PROPOSAL_SCHEMA, normalizeProposal } = require('./general-fact');

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

// Explicit development adapter. Importing it neither loads credentials nor calls a provider.
function createOpenAIGeneralFactProposer({ apiKey, fetch } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new TypeError('Explicit OpenAI API key required');
  const client = new OpenAI({ apiKey, baseURL: 'https://api.openai.com/v1', maxRetries: 0, timeout: 60_000,
    ...(fetch ? { fetch } : {}) });

  return async function proposeTransition(request) {
    if (request?.promptVersion !== 'general-fact-transition-proposal-v1'
        || typeof request.instructions !== 'string' || !request.instructions.trim()
        || typeof request.input !== 'string' || !request.input.trim()) fail('INVALID_PROPOSER_REQUEST');
    let response;
    try {
      response = await client.responses.create({
        model: 'gpt-6-luna', reasoning: { effort: 'medium', context: 'current_turn' },
        max_output_tokens: 4096, store: false,
        instructions: request.instructions, input: request.input,
        text: { format: { type: 'json_schema', name: 'general_fact_transition_proposal', strict: true,
          schema: GENERAL_FACT_PROPOSAL_SCHEMA } },
      }, { maxRetries: 0 });
    } catch { fail('OPENAI_PROPOSER_CALL_FAILED'); }
    if (response?.status !== 'completed') fail('INCOMPLETE_PROPOSER_RESPONSE');
    if (response.output?.some(item => item.type === 'message'
        && item.content?.some(part => part.type === 'refusal'))) fail('PROPOSER_REFUSAL');
    const text = extractResponseText(response);
    if (!text) fail('EMPTY_PROPOSER_RESPONSE');
    let proposal;
    try { proposal = JSON.parse(text); } catch { fail('INVALID_TRANSITION_PROPOSAL'); }
    // Provider schema enforcement is not a substitute for our own boundary validation.
    return normalizeProposal(proposal);
  };
}

module.exports = { createOpenAIGeneralFactProposer };
