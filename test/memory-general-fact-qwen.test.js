'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createQwenGeneralFactProposer } = require('../lib/memory-storage/general-fact-qwen');
const { GENERAL_FACT_PROPOSAL_SCHEMA } = require('../lib/memory-storage/general-fact');
const { buildGeneralFactProposalRequest } = require('../lib/memory-storage/general-fact-proposer');

const request = buildGeneralFactProposalRequest({ schemaVersion: 1, newEvidence: [], evidence: [] });
const proposal = { changeClass: null, transition: 'CREATE', evidenceIds: ['ev1_synthetic'], rationale: 'Synthetic rationale' };
const completed = content => ({ model: 'qwen3-4b-q4-k-m',
  choices: [{ finish_reason: 'stop', message: { content } }] });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

test('local adapter sends original instructions/replay once, with schema, no tools or credentials', async () => {
  let calls = 0;
  const proposer = createQwenGeneralFactProposer({ fetch: async (url, options) => {
    calls++;
    assert.equal(url, 'http://127.0.0.1:18767/v1/chat/completions');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error', 'must not follow an external redirect');
    assert.ok(options.signal);
    assert.deepEqual(options.headers, { 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(options.body), {
      model: 'qwen3-4b-q4-k-m', stream: false, max_tokens: 1024,
      temperature: 0.7, top_p: 0.8, chat_template_kwargs: { enable_thinking: false },
      messages: [{ role: 'system', content: request.instructions }, { role: 'user', content: request.input }],
      response_format: { type: 'json_schema', json_schema: {
        name: 'general_fact_transition_proposal', strict: true, schema: GENERAL_FACT_PROPOSAL_SCHEMA,
      } },
    });
    return json(completed(JSON.stringify(proposal)));
  } });
  assert.equal(calls, 0);
  assert.deepEqual(await proposer(request), proposal);
  assert.equal(calls, 1);
});

for (const status of [400, 429, 500, 302]) {
  test(`HTTP ${status} fails once without retry, fallback or error-body disclosure`, async () => {
    let calls = 0;
    const proposer = createQwenGeneralFactProposer({ fetch: async () => {
      calls++; return json({ error: 'private server details' }, status);
    } });
    await assert.rejects(proposer(request), { code: 'QWEN_PROPOSER_CALL_FAILED', message: 'QWEN_PROPOSER_CALL_FAILED' });
    assert.equal(calls, 1);
  });
}

test('unavailable server/timeout does not retry or fall back', async () => {
  let calls = 0;
  const proposer = createQwenGeneralFactProposer({ fetch: async () => {
    calls++; throw new Error('private network details');
  } });
  await assert.rejects(proposer(request), { code: 'QWEN_PROPOSER_CALL_FAILED' });
  assert.equal(calls, 1);
});

for (const [value, code] of [
  [{ ...completed('{}'), model: 'other-model' }, 'INCOMPLETE_PROPOSER_RESPONSE'],
  [{ model: 'qwen3-4b-q4-k-m', choices: [] }, 'INCOMPLETE_PROPOSER_RESPONSE'],
  [{ model: 'qwen3-4b-q4-k-m', choices: [{ finish_reason: 'length' }] }, 'INCOMPLETE_PROPOSER_RESPONSE'],
  [completed(''), 'EMPTY_PROPOSER_RESPONSE'],
  [completed('```json\n{}\n```'), 'INVALID_TRANSITION_PROPOSAL'],
  [completed(JSON.stringify({ ...proposal, approved: true })), 'INVALID_TRANSITION_PROPOSAL'],
  [completed(JSON.stringify({ ...proposal, evidenceIds: [] })), 'INVALID_TRANSITION_PROPOSAL'],
]) {
  test(`invalid local output fails closed: ${code}`, async () => {
    let calls = 0;
    const proposer = createQwenGeneralFactProposer({ fetch: async () => { calls++; return json(value); } });
    await assert.rejects(proposer(request), { code });
    assert.equal(calls, 1);
  });
}

test('invalid prompt makes no local call', async () => {
  const proposer = createQwenGeneralFactProposer({ fetch: () => assert.fail('Must not call server') });
  for (const value of [null, {}, { ...request, promptVersion: 'other' }, { ...request, input: '' }]) {
    await assert.rejects(proposer(value), { code: 'INVALID_PROPOSER_REQUEST' });
  }
});
