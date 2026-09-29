'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const OpenAI = require('openai');
const {
  validateInputs, makePlan, durableCreate, readJournal, prepare, execute, finalize,
} = require('../scripts/run-memory-p0-b-generation');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => `${JSON.stringify(value, null, 2)}\n`;
const stackSha = 'c092d529cbcf41636cb45aa00e964056037db44cd9ca6f9f8764dc3b8b5af201';

function frozenFixture() {
  const cases = Array.from({ length: 66 }, (_, i) => {
    const traceId = i + 1;
    const base = { model: 'gpt-6-luna', instructions: 'fixed', store: false,
      max_output_tokens: 8192, reasoning: { effort: 'medium', context: 'current_turn' } };
    return { traceId, messageId: 1000 + i, target: `question ${i}`,
      historicalRequestTime: 100 + i, shared: { schedule: '', history: [{ role: 'user', content: 'prior' }] },
      hardRequest: { ...base, input: [{ role: 'user', content: `secret-${i} H` }] },
      globalRequest: { ...base, input: [{ role: 'user', content: `secret-${i} G` }] },
      answerStackSha256: stackSha };
  });
  const bundle = { schemaVersion: 1, answerStackSha256: stackSha, cases };
  const bundleBytes = Buffer.from(canonical(bundle));
  const manifest = { schemaVersion: 1, answerStackSha256: stackSha,
    privateBundleSha256: hash(bundleBytes),
    scheduleContextPolicy: 'OMITTED_IDENTICALLY_FOR_ALL_P0B_CASES',
    counts: { GENERATION_READY: 66, INDETERMINATE_TOOL_REPLAY: 13 },
    cases: [
      ...cases.map(item => ({ traceId: item.traceId, messageId: item.messageId,
        disposition: 'GENERATION_READY', privateCaseSha256: hash(canonical(item)) })),
      ...Array.from({ length: 13 }, (_, i) => ({ traceId: 100 + i, messageId: 2000 + i,
        disposition: 'INDETERMINATE_TOOL_REPLAY' })),
    ] };
  const manifestBytes = Buffer.from(canonical(manifest));
  const expected = { manifestSha256: hash(manifestBytes), bundleSha256: hash(bundleBytes),
    stackSha256: stackSha };
  return { bundle, bundleBytes, manifest, manifestBytes, expected };
}

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p0b-generation-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('frozen input validation fails before API on manifest, bundle, stack or case corruption', () => {
  const { bundle, bundleBytes, manifest, manifestBytes, expected } = frozenFixture();
  assert.equal(validateInputs(manifestBytes, bundleBytes, expected).bundle.cases.length, 66);
  assert.throws(() => validateInputs(Buffer.from(`${manifestBytes} `), bundleBytes, expected), /SHA/);
  assert.throws(() => validateInputs(manifestBytes, Buffer.from(`${bundleBytes} `), expected), /SHA/);
  assert.throws(() => validateInputs(manifestBytes, bundleBytes,
    { ...expected, stackSha256: 'bad' }), /stack/);
  const damaged = structuredClone(bundle);
  damaged.cases[0].target = 'changed';
  const damagedBytes = Buffer.from(canonical(damaged));
  assert.throws(() => validateInputs(manifestBytes, damagedBytes,
    { ...expected, bundleSha256: hash(damagedBytes) }), /schema|case/);
  assert.equal(manifest.cases.filter(item => item.disposition === 'INDETERMINATE_TOOL_REPLAY').length, 13);
});

test('all 264 slots and blind assignment are frozen before the first one-shot call', async t => {
  const { bundle } = frozenFixture();
  const dir = tempDir(t);
  const plan = makePlan(bundle);
  assert.equal(plan.slots.length, 264);
  assert.equal(new Set(plan.slots.map(item => item.slotId)).size, 264);
  assert.ok(plan.slots.every(item => item.traceId <= 66));
  assert.deepEqual(makePlan(bundle), plan);
  const prepared = prepare(dir, bundle);
  const mappingBytes = fs.readFileSync(prepared.files.mapping);
  const calls = [];
  const client = { responses: { create: async (request, options) => {
    assert.equal(options.maxRetries, 0);
    assert.ok(fs.existsSync(prepared.files.plan));
    assert.ok(fs.existsSync(prepared.files.mapping));
    assert.ok(fs.readFileSync(prepared.files.mapping).equals(mappingBytes));
    assert.equal(request.model, 'gpt-6-luna');
    assert.equal(request.store, false);
    assert.deepEqual(request.reasoning, { effort: 'medium', context: 'current_turn' });
    assert.equal(request.max_output_tokens, 8192);
    assert.equal('tools' in request, false);
    calls.push(request);
    return { status: 'completed', output_text: 'private-answer', model: 'gpt-6-luna' };
  } } };
  const journal = await execute({ bundle, prepared, client });
  assert.equal(calls.length, 264);
  assert.deepEqual(calls.map(item => hash(canonical(item))), plan.slots.map(item => item.requestSha256));
  const result = finalize({ bundle, prepared, journal, codeCommit: 'a'.repeat(40) });
  assert.equal(result.manifest.generationCompleteCases, 66);
  assert.equal(result.manifest.preexistingToolIndeterminate, 13);
  assert.equal(result.manifest.successfulSlots, 264);
  assert.equal(result.manifest.failedSlots, 0);
  assert.equal(result.manifest.maxRetries, 0);
  assert.doesNotMatch(result.manifestBytes, /private-answer|secret-|question /);
  const packet = JSON.parse(result.packetBytes);
  assert.equal(packet.cases.length, 66);
  assert.ok(packet.cases.every(item => item.groupX.length === 2 && item.groupY.length === 2
    && Object.values(item.decision).every(value => value === null)));
  assert.doesNotMatch(result.packetBytes, /HARD-GATED|GLOBAL-SOFT-PRIOR|hardContext|globalContext|retrievalScore/);
  assert.deepEqual(finalize({ bundle, prepared, journal, codeCommit: 'a'.repeat(40) }).manifest, result.manifest);
});

test('failure, orphan dispatch and unstarted slots never create a replacement attempt', async t => {
  const { bundle } = frozenFixture();
  const prepared = prepare(tempDir(t), bundle);
  const [failed, orphan, unstarted] = prepared.plan.slots;
  for (const slot of [failed, orphan]) {
    const fd = fs.openSync(prepared.files.journal, 'a');
    fs.writeSync(fd, `${JSON.stringify({ slotId: slot.slotId, event: 'DISPATCHING' })}\n`);
    if (slot === failed) fs.writeSync(fd, `${JSON.stringify({ slotId: slot.slotId,
      event: 'FAILURE', errorCode: '429' })}\n`);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  }
  const calls = [];
  const journal = await execute({ bundle, prepared, client: { responses: {
    create: async request => { calls.push(request); return { status: 'completed', output_text: 'ok' }; },
  } } });
  assert.equal(journal.states.get(failed.slotId), 'FAILURE');
  assert.equal(journal.states.get(orphan.slotId), 'AMBIGUOUS_AFTER_DISPATCH');
  assert.equal(journal.states.get(unstarted.slotId), 'SUCCESS');
  assert.equal(calls.length, 262);
  assert.equal(readJournal(prepared.files.journal, prepared.plan).states.size, 264);
  assert.equal((await execute({ bundle, prepared, client: { responses: {
    create: async () => { throw new Error('duplicate call'); },
  } } })).states.size, 264);
});

test('non-completed and empty text are failures, with no retry', async t => {
  const { bundle } = frozenFixture();
  const prepared = prepare(tempDir(t), bundle);
  prepared.plan.slots = prepared.plan.slots.slice(0, 2);
  const replies = [{ status: 'incomplete', output_text: 'partial' },
    { status: 'completed', output_text: '' }];
  let calls = 0;
  const journal = await execute({ bundle, prepared, client: { responses: {
    create: async () => replies[calls++],
  } } });
  assert.equal(calls, 2);
  assert.deepEqual([...journal.states.values()], ['FAILURE', 'FAILURE']);
  assert.equal(journal.records[1].errorCode, 'NON_COMPLETED_RESPONSE');
  assert.equal(journal.records[3].errorCode, 'EMPTY_FINAL_TEXT');
});

test('installed OpenAI SDK makes one request with maxRetries=0 for 429, 500 and transport failure', async () => {
  for (const outcome of [429, 500, 'timeout']) {
    let attempts = 0;
    const client = new OpenAI({ apiKey: 'test', baseURL: 'https://example.test/v1', maxRetries: 0,
      fetch: async () => {
        attempts += 1;
        if (outcome === 'timeout') throw new Error('timeout');
        return new Response('{}', { status: outcome, headers: { 'content-type': 'application/json' } });
      } });
    await assert.rejects(client.responses.create({ model: 'gpt-6-luna', input: 'synthetic' },
      { maxRetries: 0 }));
    assert.equal(attempts, 1);
  }
});

test('durable journal rejects invalid transitions and never prints raw answers', t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'journal.jsonl');
  durableCreate(file, `${JSON.stringify({ slotId: 'a', event: 'SUCCESS', responseText: 'private-answer' })}\n`);
  assert.throws(() => readJournal(file, { slots: [{ slotId: 'a' }] }), /transition/);
  assert.equal(fs.statSync(file).mode & 0o077, 0);
});
