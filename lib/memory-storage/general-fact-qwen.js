'use strict';

const { GENERAL_FACT_PROPOSAL_SCHEMA, normalizeProposal } = require('./general-fact');

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

// Explicit local development adapter; no credentials, external endpoint or provider fallback.
function createQwenGeneralFactProposer({ fetch = globalThis.fetch } = {}) {
  return async function proposeTransition(request) {
    if (request?.promptVersion !== 'general-fact-transition-proposal-v1'
        || typeof request.instructions !== 'string' || !request.instructions.trim()
        || typeof request.input !== 'string' || !request.input.trim()) fail('INVALID_PROPOSER_REQUEST');
    let response;
    try {
      const result = await fetch('http://127.0.0.1:18767/v1/chat/completions', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(900_000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen3-4b-q4-k-m', stream: false, max_tokens: 1024,
          temperature: 0.7, top_p: 0.8,
          chat_template_kwargs: { enable_thinking: false },
          messages: [{ role: 'system', content: request.instructions }, { role: 'user', content: request.input }],
          response_format: { type: 'json_schema', json_schema: {
            name: 'general_fact_transition_proposal', strict: true, schema: GENERAL_FACT_PROPOSAL_SCHEMA,
          } },
        }),
      });
      if (!result.ok) fail('QWEN_PROPOSER_CALL_FAILED');
      response = await result.json();
    } catch { fail('QWEN_PROPOSER_CALL_FAILED'); }
    if (response?.model !== 'qwen3-4b-q4-k-m' || response.choices?.length !== 1
        || response.choices[0].finish_reason !== 'stop') fail('INCOMPLETE_PROPOSER_RESPONSE');
    const text = response.choices[0].message?.content;
    if (typeof text !== 'string' || !text.trim()) fail('EMPTY_PROPOSER_RESPONSE');
    let proposal;
    try { proposal = JSON.parse(text); } catch { fail('INVALID_TRANSITION_PROPOSAL'); }
    return normalizeProposal(proposal);
  };
}

module.exports = { createQwenGeneralFactProposer };
