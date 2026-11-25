'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { questions, parseResponse, requestDecision, metrics, main } = require('../scripts/evaluate-mail-decisions');
const { FIXTURES } = require('./fixtures/mail-decisions/fixtures');

function response() {
  return { model: 'gpt-6-luna', answers: questions.map(q => q.type === 'predicate'
    ? { name: q.name, type: q.type, probability: 0.8 }
    : { name: q.name, type: q.type, choice: q.choices[0].value, confidence: 0.7,
      probabilities: q.choices.map((c, i) => ({ value: c.value, probability: i ? 0 : 1 })) }) };
}

test('matches typed answers by name and preserves predicate probability', () => {
  const data = response();
  data.answers.reverse();
  const parsed = parseResponse(data);
  assert.equal(parsed.category.choice, 'urgent');
  assert.equal(parsed.action_required.probability, 0.8);
  assert.equal(parsed.action_required.confidence, undefined);
});

test('rejects invalid choices, missing answers, refusal and malformed responses', () => {
  const badChoice = response(); badChoice.answers[0].choice = 'other';
  assert.throws(() => parseResponse(badChoice), /invalid_response/);
  const missing = response(); missing.answers.pop();
  assert.throws(() => parseResponse(missing), /invalid_response/);
  const refusal = response(); refusal.answers[2] = { name: 'action_required', type: 'refusal' };
  assert.throws(() => parseResponse(refusal), /refusal/);
  assert.throws(() => parseResponse({}), /invalid_response/);
});

test('handles HTTP errors and timeout', async () => {
  await assert.rejects(requestDecision({}, 'key', async () => ({ ok: false, status: 429 })), /http_429/);
  const aborting = (_url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' }))));
  await assert.rejects(requestDecision({}, 'key', aborting, 5), /timeout/);
});

test('counts risk per run and excludes boundary fields', () => {
  const fixture = { id: 'x', expected: { category: 'important', mode: 'batch', attention: 'action_required' }, boundary: ['mode'] };
  const data = response(); data.answers[0].choice = 'ignore'; data.answers[2].probability = 0.1;
  const answers = parseResponse(data);
  const result = metrics([fixture], [{ id: 'x', run: 1, answers }, { id: 'x', run: 2, answers }], 2);
  assert.equal(result.ignoreRisk.length, 2);
  assert.equal(result.actionMissed.length, 2);
  assert.equal(result.mode.total, 0);
  assert.equal(result.stable, 1);
});

test('dry run makes no network calls or database changes', async () => {
  let calls = 0;
  await main(['--only', FIXTURES[0].id], { fetcher: async () => { calls++; } });
  assert.equal(calls, 0);
});
