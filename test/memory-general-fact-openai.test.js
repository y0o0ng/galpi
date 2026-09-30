'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { migrations } = require('../lib/database-migrations');
const { GENERAL_FACT_PROPOSAL_SCHEMA, normalizeProposal, createGeneralFactStore } = require('../lib/memory-storage/general-fact');
const { createMemoryEvidenceRegistry } = require('../lib/memory-storage/evidence-registry');
const { buildGeneralFactProposalRequest, createGeneralFactReviewHandler } = require('../lib/memory-storage/general-fact-proposer');
const { createOpenAIGeneralFactProposer } = require('../lib/memory-storage/general-fact-openai');

const request = buildGeneralFactProposalRequest({ schemaVersion: 1, newEvidence: [], evidence: [] });
const proposal = { changeClass: null, transition: 'CREATE', evidenceIds: ['ev1_synthetic'], rationale: 'Synthetic rationale' };
const complete = value => ({ status: 'completed', model: 'gpt-6-luna', output: [
  { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(value) }] },
] });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

test('real SDK builds fixed Responses request, no tools/stream/store/retry and no import-time dispatch', async () => {
  let calls = 0;
  const proposer = createOpenAIGeneralFactProposer({ apiKey: 'synthetic-key', fetch: async (url, options) => {
    calls++;
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);
    assert.deepEqual(body, {
      model: 'gpt-6-luna', reasoning: { effort: 'medium', context: 'current_turn' }, max_output_tokens: 4096,
      store: false, instructions: request.instructions, input: request.input,
      text: { format: { type: 'json_schema', name: 'general_fact_transition_proposal', strict: true,
        schema: GENERAL_FACT_PROPOSAL_SCHEMA } },
    });
    assert.ok(options.signal);
    assert.equal(new Headers(options.headers).get('x-stainless-retry-count'), '0');
    return json(complete(proposal));
  } });
  assert.equal(calls, 0);
  assert.deepEqual(await proposer(request), proposal);
  assert.equal(calls, 1);
});

for (const status of [401, 408, 409, 429, 500]) {
  test(`SDK HTTP ${status} dispatches once with no retry and no provider error disclosure`, async () => {
    let calls = 0;
    const proposer = createOpenAIGeneralFactProposer({ apiKey: 'synthetic-key', fetch: async () => {
      calls++;
      return json({ error: { message: 'secret provider body', code: 'secret' } }, status);
    } });
    await assert.rejects(proposer(request), { code: 'OPENAI_PROPOSER_CALL_FAILED', message: 'OPENAI_PROPOSER_CALL_FAILED' });
    assert.equal(calls, 1);
  });
}

for (const name of ['Error', 'AbortError']) {
  test(`${name} network/timeout error is not retried`, async () => {
    let calls = 0;
    const proposer = createOpenAIGeneralFactProposer({ apiKey: 'synthetic-key', fetch: async () => {
      calls++; throw Object.assign(new Error('secret network details'), { name });
    } });
    await assert.rejects(proposer(request), { code: 'OPENAI_PROPOSER_CALL_FAILED' });
    assert.equal(calls, 1);
  });
}

for (const [value, code] of [
  [{ status: 'incomplete', output_text: JSON.stringify(proposal) }, 'INCOMPLETE_PROPOSER_RESPONSE'],
  [{ output_text: JSON.stringify(proposal) }, 'INCOMPLETE_PROPOSER_RESPONSE'],
  [{ status: 'completed', output: [] }, 'EMPTY_PROPOSER_RESPONSE'],
  [{ status: 'completed', output_text: JSON.stringify(proposal), output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'private refusal' }] }] }, 'PROPOSER_REFUSAL'],
  [{ status: 'completed', output_text: '```json\n{}\n```' }, 'INVALID_TRANSITION_PROPOSAL'],
  [complete({ ...proposal, approved: true }), 'INVALID_TRANSITION_PROPOSAL'],
  [complete({ ...proposal, evidenceIds: [] }), 'INVALID_TRANSITION_PROPOSAL'],
]) {
  test(`bad provider response fails closed: ${code}`, async () => {
    let calls = 0;
    const proposer = createOpenAIGeneralFactProposer({ apiKey: 'synthetic-key', fetch: async () => { calls++; return json(value); } });
    await assert.rejects(proposer(request), { code });
    assert.equal(calls, 1);
  });
}

test('shared strict schema enums remain accepted by the existing proposal validator', () => {
  assert.ok(Object.isFrozen(GENERAL_FACT_PROPOSAL_SCHEMA.properties));
  assert.equal(GENERAL_FACT_PROPOSAL_SCHEMA.additionalProperties, false);
  for (const changeClass of GENERAL_FACT_PROPOSAL_SCHEMA.properties.changeClass.enum) {
    assert.equal(normalizeProposal({ ...proposal, changeClass }).changeClass, changeClass);
  }
  for (const transition of GENERAL_FACT_PROPOSAL_SCHEMA.properties.transition.enum) {
    assert.equal(normalizeProposal({ ...proposal, transition }).transition, transition);
  }
});

test('explicit credentials and expected prompt required; malformed requests make zero calls', async () => {
  assert.throws(() => createOpenAIGeneralFactProposer(), /Explicit OpenAI API key/);
  let calls = 0;
  const proposer = createOpenAIGeneralFactProposer({ apiKey: 'synthetic-key', fetch: async () => { calls++; } });
  for (const value of [null, {}, { ...request, promptVersion: 'other' }, { ...request, input: '' }, { ...request, instructions: null }]) {
    await assert.rejects(proposer(value), { code: 'INVALID_PROPOSER_REQUEST' });
  }
  assert.equal(calls, 0);
});

test('SDK response only creates a persisted review; no derived state/provenance commit', async t => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.pragma('foreign_keys = ON');
  db.exec("CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, created_at INTEGER); INSERT INTO messages VALUES (1, 'synthetic', 'user', '내 주 사용 노트북은 A야.', 100)");
  for (const name of ['memory_evidence_refs', 'memory_general_fact_storage', 'memory_general_fact_reviews']) migrations.find(item => item.name === name).up(db);
  const registry = createMemoryEvidenceRegistry(db);
  const candidate = { schemaVersion: 1, semanticFamily: 'general_fact', payload: { subject: 'USER', attributeKey: 'primary_laptop', value: 'A' },
    sources: [{ sourceDomain: 'conversation_message', sourceKey: '1' }] };
  const proposeTransition = createOpenAIGeneralFactProposer({ apiKey: 'synthetic-key', fetch: async (url, options) => {
    const replay = JSON.parse(JSON.parse(options.body).input).replayPackage;
    return json(complete({ ...proposal, evidenceIds: [replay.newEvidence[0].evidenceRef.evidenceId] }));
  } });
  const handler = createGeneralFactReviewHandler({ db, evidenceRegistry: registry, proposeTransition });
  const result = await handler({ candidate, evidenceRefs: registry.registerSources(candidate.sources) });
  assert.equal(result.reason, 'HUMAN_REVIEW_REQUIRED');
  assert.equal(result.review.decision, null);
  assert.equal(createGeneralFactStore(db, registry).readTarget('USER', 'primary_laptop').currentState, null);
  assert.equal(db.prepare('SELECT count(*) AS n FROM memory_general_fact_transitions').get().n, 0);
  assert.equal(db.prepare('SELECT content FROM messages').get().content, '내 주 사용 노트북은 A야.');
});
