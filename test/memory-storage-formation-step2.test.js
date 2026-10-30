'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { GENERAL_FACT_ATTRIBUTES } = require('../lib/memory-storage/general-fact');
const { attachAnchorWindows } = require('../lib/memory-storage/bundle-builder');
const { createFormationLunaStages } = require('../lib/memory-storage/formation-openai');
const { anchorsFor, guardDb, gate } = require('../lib/memory-storage/formation-step2');

const episode = { schemaVersion: 1, sourceDomain: 'conversation_message', sessionId: 'shared-main', firstMessageId: 1, lastMessageId: 2,
  turns: [{ turnId: 'm1', messageId: 1, role: 'USER', text: '내 전공은 물리학', createdAt: 1 },
    { turnId: 'm2', messageId: 2, role: 'ASSISTANT', text: '알겠어', createdAt: 2 }] };
const built = attachAnchorWindows(episode, { anchors: [{ turnId: 'm1', text: '물리학' }] });
const input = { bundle: built.bundles[0], evidence: episode.turns };
const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const complete = value => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });

test('registry defines string attributes and MULTI affiliation', () => {
  assert.deepEqual(Object.keys(GENERAL_FACT_ATTRIBUTES), ['primary_laptop', 'academic_major', 'affiliation', 'residence_area', 'primary_phone']);
  for (const [key, value] of Object.entries(GENERAL_FACT_ATTRIBUTES)) assert.deepEqual([value.valueType, value.cardinality], ['string', key === 'affiliation' ? 'MULTI' : 'SINGLE']);
});
test('frozen anchors reconstruct the same bundle identities', () => {
  assert.deepEqual(anchorsFor(episode, built), [{ turnId: 'm1', text: '물리학' }]);
  const corrupted = structuredClone(built); corrupted.bundles[0].bundleId = 'bad';
  assert.throws(() => anchorsFor(episode, corrupted), /BUNDLE_ID_MISMATCH/);
});
test('guard refuses source DB bytes even at a different path', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'formation-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = path.join(dir, 'copy.db'); fs.writeFileSync(db, 'synthetic');
  const sha = createHash('sha256').update('synthetic').digest('hex');
  assert.throws(() => guardDb(db, { episodes: [{ sourceDbSha256: sha }] }), /SOURCE_DB_FORBIDDEN/);
  assert.doesNotThrow(() => guardDb(db, { episodes: [{ sourceDbSha256: '0'.repeat(64) }] }));
});
test('Luna request shape, stage inputs and output validation', async () => {
  const bodies = [], values = [{ disposition: 'CLEAR', reason: '명확함' }, { disposition: 'WRITE', reason: '지속' },
    { disposition: 'EXTRACTED', reason: null, semanticFamily: 'general_fact', payload: { subject: 'USER', attributeKey: 'academic_major', value: '물리학' }, evidenceTurnIds: ['m1'] }];
  const stages = createFormationLunaStages({ apiKey: 'fake', fetch: async (_url, options) => {
    bodies.push(JSON.parse(options.body)); assert.equal(new Headers(options.headers).get('x-stainless-retry-count'), '0');
    return response(complete(values.shift()));
  } });
  await stages.assessAmbiguity(input); await stages.assessDurability(input);
  await stages.extractCandidate({ ...input, durabilityReason: '지속' });
  for (const body of bodies) {
    assert.equal(body.model, 'gpt-6-luna'); assert.deepEqual(body.reasoning, { effort: 'medium', context: 'current_turn' });
    assert.equal(body.store, false); assert.equal(body.text.format.strict, true);
    assert.deepEqual(JSON.parse(body.input).anchor, { turnId: 'm1', text: '물리학' });
  }
  assert.equal(JSON.parse(bodies[1].input).durabilityReason, undefined);
  assert.match(bodies[1].instructions, /각 앵커를 그 자체로 판정/);
  assert.match(bodies[1].instructions, /사용자 목표, 현재 단계, 주요 결정, 장애는 WRITE/);
  assert.match(bodies[1].instructions, /세부 설계 항목이나 문서의 세부 항목은 NO_WRITE/);
  assert.match(bodies[1].instructions, /원문은 나중에 직접 검색/);
  assert.equal(JSON.parse(bodies[2].input).durabilityReason, '지속');
  assert.ok(JSON.parse(bodies[2].input).attributes.primary_phone);
  const retraction = createFormationLunaStages({ apiKey: 'fake', fetch: async () => response(complete({ disposition: 'EXTRACTED', reason: null,
    semanticFamily: 'general_fact', payload: { subject: 'USER', attributeKey: 'primary_laptop', value: null }, evidenceTurnIds: ['m1'] })) });
  assert.equal((await retraction.extractCandidate({ ...input, durabilityReason: '철회' })).payload.value, null);
  const bad = createFormationLunaStages({ apiKey: 'fake', fetch: async () => response(complete({ disposition: 'CLEAR', reason: '' })) });
  await assert.rejects(bad.assessAmbiguity(input), /INVALID_FORMATION_RESPONSE/);
  const incomplete = createFormationLunaStages({ apiKey: 'fake', fetch: async () => response({ status: 'incomplete' }) });
  await assert.rejects(incomplete.assessAmbiguity(input), /INCOMPLETE_FORMATION_RESPONSE/);
});
test('gate counts escalated keep anchors as not kept and applies thresholds', () => {
  const rows = Array.from({ length: 37 }, (_, i) => ({ bundle: { bundleId: `b${i}` }, status: i < 30 ? 'EXTRACTION_DEFERRED' : 'NO_WRITE',
    ambiguity: { disposition: 'CLEAR' }, durability: { disposition: i < 30 ? 'WRITE' : 'NO_WRITE' }, extraction: i < 30 ? { disposition: 'DEFERRED', reason: 'unsupported' } : null }));
  const sets = { keepSet: rows.slice(0, 30).map((r, i) => ({ id: `k${i}`, bundleId: r.bundle.bundleId })),
    operationalSet: rows.slice(30).map((r, i) => ({ id: `o${i}`, bundleId: r.bundle.bundleId })) };
  for (const row of rows.slice(0, 6)) { row.status = 'MEANING_DEFERRED'; row.ambiguity.disposition = 'ESCALATE'; row.durability = null; row.extraction = null; }
  assert.equal(gate([{ results: rows }], sets).gate, 'PASS');
  rows[6].ambiguity.disposition = 'ESCALATE'; rows[6].durability = null;
  assert.equal(gate([{ results: rows }], sets).gate, 'FAIL');
});
