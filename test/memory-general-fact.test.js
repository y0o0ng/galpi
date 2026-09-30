'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { migrations } = require('../lib/database-migrations');
const { createMemoryEvidenceRegistry } = require('../lib/memory-storage/evidence-registry');
const { createMemoryStorageRouter } = require('../lib/memory-storage/router');
const { createGeneralFactStore, createGeneralFactHandler } = require('../lib/memory-storage/general-fact');

function fixture(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE messages (
    id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
    content TEXT NOT NULL, created_at INTEGER NOT NULL
  )`);
  for (const name of ['memory_evidence_refs', 'memory_general_fact_storage']) {
    migrations.find(item => item.name === name).up(db);
  }
  for (let id = 1; id <= 6; id += 1) {
    db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?)').run(id, 'session', 'user', `source-only-text-${id}`, 100);
  }
  const registry = createMemoryEvidenceRegistry(db);
  const store = createGeneralFactStore(db, registry);
  const candidate = (value, id = 1) => ({
    schemaVersion: 1, semanticFamily: 'general_fact',
    payload: { subject: 'USER', attributeKey: 'primary_laptop', value },
    sources: [{ sourceDomain: 'conversation_message', sourceKey: String(id) }],
  });
  const prepare = input => store.prepare({ candidate: input, evidenceRefs: registry.registerSources(input.sources) });
  const proposal = (replay, transition = 'CREATE', changeClass = null) => ({
    transition, changeClass, evidenceIds: replay.newEvidence.map(item => item.evidenceRef.evidenceId),
    rationale: 'Synthetic test judgment; not a semantic classifier',
  });
  const approved = { approved: true, reason: 'Synthetic approval' };
  const commit = (input, transition = 'CREATE', changeClass = null) => {
    const { replayPackage } = prepare(input);
    return store.commit(replayPackage, proposal(replayPackage, transition, changeClass), approved);
  };
  const target = () => store.readTarget('USER', 'primary_laptop');
  return { db, registry, store, candidate, prepare, proposal, approved, commit, target };
}

test('USER/string/registered SINGLE ingress rejects invented slots, scopes and other value systems', t => {
  const f = fixture(t);
  const original = f.candidate(' Intel MacBook Pro ');
  assert.equal(f.prepare(original).replayPackage.candidate.payload.value, original.payload.value);
  for (const payload of [
    { ...original.payload, subject: 'PERSON_X' },
    { ...original.payload, attributeKey: 'laptop' },
    { ...original.payload, scope: 'work' },
    ...[123, true, [], {}, '', ' '.repeat(2), 'x'.repeat(2001)].map(value => ({ ...original.payload, value })),
  ]) assert.throws(() => f.prepare({ ...original, payload }), /INVALID_GENERAL_FACT_CANDIDATE/);
  assert.throws(() => f.prepare({ ...original, sources: [{ sourceDomain: 'temporary_attachment', sourceKey: '1' }] }), /Unsupported/);
  assert.throws(() => f.store.prepare({ candidate: original, evidenceRefs: [] }), /INVALID_CANDIDATE_BINDING/);
});

test('CREATE atomically binds provenance without copying or changing owning source', t => {
  const f = fixture(t);
  const messages = f.db.prepare('SELECT * FROM messages').all();
  const result = f.commit(f.candidate('Intel MacBook Pro'));
  const state = f.target();
  assert.equal(result.status, 'COMMITTED');
  assert.equal(state.currentState.value, 'Intel MacBook Pro');
  assert.equal(state.currentState.status, 'CURRENT');
  assert.equal(state.history[0].changeClass, null);
  assert.equal(state.history[0].evidenceIds.length, 1);
  assert.deepEqual(f.db.prepare('SELECT * FROM messages').all(), messages);
  for (const table of ['candidates', 'states', 'transitions', 'transition_evidence']) {
    assert.equal(JSON.stringify(f.db.prepare(`SELECT * FROM memory_general_fact_${table}`).all()).includes('source-only-text'), false);
  }
});

test('WORLD_UPDATE preserves valid history while CORRECTION marks the previous claim corrected', t => {
  const f = fixture(t);
  f.commit(f.candidate('Intel MacBook Pro'));
  f.commit(f.candidate('M5 MacBook Air', 2), 'SUPERSEDE', 'WORLD_UPDATE');
  f.commit(f.candidate('M4 MacBook Air', 3), 'REVISE', 'CORRECTION');
  assert.deepEqual(Object.fromEntries(f.target().states.map(s => [s.value, s.status])), {
    'Intel MacBook Pro': 'HISTORICAL', 'M5 MacBook Air': 'CORRECTED', 'M4 MacBook Air': 'CURRENT',
  });
  assert.equal(f.target().revision, 3);
});

test('null candidate can INVALIDATE but cannot persist a null fact or silently CREATE a replacement', t => {
  const f = fixture(t);
  const nullReplay = f.prepare(f.candidate(null)).replayPackage;
  assert.throws(() => f.store.commit(nullReplay, f.proposal(nullReplay), f.approved), /REPLACEMENT_VALUE_REQUIRED/);
  f.commit(f.candidate('Old laptop', 2));
  f.commit(f.candidate(null, 3), 'INVALIDATE', 'CORRECTION');
  assert.equal(f.target().currentState, null);
  assert.equal(f.target().states[0].status, 'INVALIDATED');
  assert.equal(f.target().states.length, 1);
  f.commit(f.candidate('Replacement laptop', 4));
  assert.equal(f.target().currentState.value, 'Replacement laptop');
  assert.equal(f.target().revision, 3);
});

test('replay supplies owning sources, original support, history, counterevidence and unresolved candidates', t => {
  const f = fixture(t);
  f.commit(f.candidate('Old'));
  f.commit(f.candidate('Corrected', 2), 'REVISE', 'CORRECTION');
  const unresolved = f.prepare(f.candidate('Unresolved', 3));
  f.store.defer(unresolved.replayPackage.candidateId, 'VALIDATION_REJECTED');
  const replay = f.prepare(f.candidate('New', 4)).replayPackage;
  assert.equal(replay.newEvidence[0].source.content, 'source-only-text-4');
  assert.equal(replay.originalSupport[0].source.id, 2);
  assert.equal(replay.evidence.length, 4);
  assert.equal(replay.counterEvidence.length, 1);
  assert.equal(replay.history.length, 2);
  assert.equal(replay.unresolvedCandidates[0].reason, 'VALIDATION_REJECTED');
  assert.deepEqual(replay.assumptions, []);
  assert.ok(Object.isFrozen(replay.currentState));
  assert.ok(Object.isFrozen(replay.evidence[0].source));
});

test('equal/different strings do not classify change; NO_CHANGE requires explicit validated proposal', t => {
  const f = fixture(t);
  f.commit(f.candidate('Same'));
  const replay = f.prepare(f.candidate('Same', 2)).replayPackage;
  assert.equal(f.target().revision, 1);
  f.store.commit(replay, f.proposal(replay, 'NO_CHANGE', 'ADDITIONAL_CONTEXT'), f.approved);
  const after = f.prepare(f.candidate('Different', 3)).replayPackage;
  assert.equal(after.originalSupport.length, 1); // NO_CHANGE does not silently reinforce truth.
  assert.equal(after.originalSupport[0].source.id, 1);
  assert.equal(after.currentState.value, 'Same');
});

test('developer callbacks are mandatory; valid JSON is not semantic approval', async t => {
  const f = fixture(t);
  assert.throws(() => createGeneralFactHandler({ db: f.db, evidenceRegistry: f.registry }), /Explicit/);
  const handler = createGeneralFactHandler({
    db: f.db, evidenceRegistry: f.registry,
    proposeTransition: r => f.proposal(r),
    validateTransition: () => ({ approved: false, reason: 'Unsupported source meaning' }),
  });
  const route = createMemoryStorageRouter({ evidenceRegistry: f.registry, transitionHandlers: new Map([['general_fact', handler]]) });
  const result = await route(f.candidate('Rejected'));
  assert.equal(result.reason, 'VALIDATION_REJECTED');
  assert.equal(f.target().currentState, null);
  assert.equal(f.target().unresolvedCandidates.length, 1);
});

test('router dispatch and repeated accepted candidate are idempotent without repeating semantic work', async t => {
  const f = fixture(t);
  let calls = 0;
  const handler = createGeneralFactHandler({
    db: f.db, evidenceRegistry: f.registry,
    proposeTransition: r => { calls += 1; return f.proposal(r); }, validateTransition: () => f.approved,
  });
  const route = createMemoryStorageRouter({ evidenceRegistry: f.registry, transitionHandlers: new Map([['general_fact', handler]]) });
  const first = await route(f.candidate('Accepted'));
  assert.deepEqual(await route(f.candidate('Accepted')), first);
  assert.equal(calls, 1);
  assert.equal(f.target().states.length, 1);
});

test('unsupported transition preserves the classification/proposal and stable state', async t => {
  const f = fixture(t);
  f.commit(f.candidate('Stable'));
  const handler = createGeneralFactHandler({
    db: f.db, evidenceRegistry: f.registry,
    proposeTransition: r => f.proposal(r, 'EXPAND', 'EXPANSION'), validateTransition: () => f.approved,
  });
  await assert.rejects(handler({ candidate: f.candidate('Expanded', 2), evidenceRefs: f.registry.registerSources(f.candidate('Expanded', 2).sources) }), /UNSUPPORTED_TRANSITION/);
  const target = f.target();
  assert.equal(target.currentState.value, 'Stable');
  assert.equal(target.unresolvedCandidates[0].proposal.changeClass, 'EXPANSION');
  assert.equal(target.unresolvedCandidates[0].reason, 'UNSUPPORTED_TRANSITION');
});

test('proposer/validator errors preserve stable state and pending input', async t => {
  const f = fixture(t);
  f.commit(f.candidate('Stable'));
  for (const phase of ['propose', 'validate']) {
    const candidate = f.candidate(phase, phase === 'propose' ? 2 : 3);
    const handler = createGeneralFactHandler({
      db: f.db, evidenceRegistry: f.registry,
      proposeTransition: r => { if (phase === 'propose') throw new Error('offline'); return f.proposal(r, 'SUPERSEDE', 'WORLD_UPDATE'); },
      validateTransition: () => { throw new Error('offline'); },
    });
    await assert.rejects(handler({ candidate, evidenceRefs: f.registry.registerSources(candidate.sources) }), /offline/);
  }
  assert.equal(f.target().revision, 1);
  assert.equal(f.target().unresolvedCandidates.length, 2);
});

test('wrong class mapping, unknown support and old-only support fail closed', t => {
  const f = fixture(t);
  f.commit(f.candidate('Stable'));
  const r = f.prepare(f.candidate('New', 2)).replayPackage;
  assert.throws(() => f.store.commit(r, f.proposal(r, 'SUPERSEDE', 'CORRECTION'), f.approved), /UNSUPPORTED_CHANGE_MAPPING/);
  assert.throws(() => f.store.commit(r, f.proposal(r, 'REVISE', 'WORLD_UPDATE'), f.approved), /UNSUPPORTED_CHANGE_MAPPING/);
  for (const evidenceIds of [['unknown'], r.originalSupport.map(e => e.evidenceRef.evidenceId)]) {
    assert.throws(() => f.store.commit(r, { ...f.proposal(r, 'SUPERSEDE', 'WORLD_UPDATE'), evidenceIds }, f.approved), /INVALID_TRANSITION_EVIDENCE/);
  }
  assert.equal(f.target().revision, 1);
});

test('stale or tampered replay cannot commit a proposal approved against another snapshot', t => {
  const f = fixture(t);
  f.commit(f.candidate('Stable'));
  const r = f.prepare(f.candidate('New', 2)).replayPackage;
  const proposal = f.proposal(r, 'SUPERSEDE', 'WORLD_UPDATE');
  const forged = JSON.parse(JSON.stringify(r));
  forged.candidate.payload.value = 'Forged';
  assert.throws(() => f.store.commit(forged, proposal, f.approved), /STALE_REPLAY/);
  f.commit(f.candidate('Concurrent', 3), 'SUPERSEDE', 'WORLD_UPDATE');
  assert.throws(() => f.store.commit(r, proposal, f.approved), /STALE_REPLAY/);
  assert.equal(f.target().currentState.value, 'Concurrent');
});

test('changed or missing original support fails closed', t => {
  const f = fixture(t);
  f.commit(f.candidate('Stable'));
  f.db.prepare('UPDATE messages SET content = ? WHERE id = 1').run('Changed');
  assert.throws(() => f.prepare(f.candidate('New', 2)), /integrity mismatch/);
  f.db.prepare('DELETE FROM messages WHERE id = 1').run();
  assert.throws(() => f.prepare(f.candidate('New', 3)), /not found/);
  assert.equal(f.target().currentState.value, 'Stable');
  assert.equal(f.target().unresolvedCandidates.length, 2);
});

test('provenance failure rolls back state/transition together and retains pending candidate', t => {
  const f = fixture(t);
  f.commit(f.candidate('Stable'));
  const r = f.prepare(f.candidate('New', 2)).replayPackage;
  f.db.exec(`CREATE TRIGGER reject_provenance BEFORE INSERT ON memory_general_fact_transition_evidence
    BEGIN SELECT RAISE(ABORT, 'synthetic provenance failure'); END`);
  assert.throws(() => f.store.commit(r, f.proposal(r, 'SUPERSEDE', 'WORLD_UPDATE'), f.approved), /synthetic provenance failure/);
  assert.equal(f.target().states.length, 1);
  assert.equal(f.target().revision, 1);
  assert.equal(f.target().currentState.value, 'Stable');
  assert.equal(f.target().unresolvedCandidates.length, 1);
});

test('orphan state / invalid transition chronology fails closed instead of choosing latest row', t => {
  const f = fixture(t);
  const first = f.commit(f.candidate('Stable'));
  const r = f.prepare(f.candidate('Other', 2)).replayPackage;
  f.db.prepare('INSERT INTO memory_general_fact_states (state_id, candidate_id, value) VALUES (?, ?, ?)').run('orphan', r.candidateId, 'Other');
  assert.throws(f.target, /INVALID_STATE_HISTORY/);
  f.db.prepare('DELETE FROM memory_general_fact_states WHERE state_id = ?').run('orphan');
  f.db.prepare('UPDATE memory_general_fact_transitions SET revision = 3 WHERE transition_id = ?').run(first.transitionId);
  assert.throws(f.target, /INVALID_STATE_HISTORY/);
});

test('commit rejects malformed/denied approval even if caller bypasses handler', t => {
  const f = fixture(t);
  const r = f.prepare(f.candidate('New')).replayPackage;
  assert.throws(() => f.store.commit(r, f.proposal(r), { approved: true }), /INVALID_VALIDATION_RESULT/);
  assert.throws(() => f.store.commit(r, f.proposal(r), { approved: false, reason: 'denied' }), /VALIDATION_REJECTED/);
  assert.throws(() => f.store.commit(r, { ...f.proposal(r), evidenceIds: [] }, f.approved), /INVALID_TRANSITION_PROPOSAL/);
  assert.equal(f.target().revision, 0);
});

test('persisted claim and approval integrity is checked when rebuilding the target', t => {
  const f = fixture(t);
  const result = f.commit(f.candidate('Stable'));
  f.db.prepare('UPDATE memory_general_fact_states SET value = ? WHERE state_id = ?').run('Tampered', result.stateId);
  assert.throws(f.target, /INVALID_STATE_HISTORY/);
  f.db.prepare('UPDATE memory_general_fact_states SET value = ? WHERE state_id = ?').run('Stable', result.stateId);
  f.db.prepare('UPDATE memory_general_fact_candidates SET validation_json = ? WHERE candidate_id = ?')
    .run(JSON.stringify({ approved: false, reason: 'denied' }), result.candidateId);
  assert.throws(f.target, /INVALID_STATE_PROVENANCE/);
});

test('candidate integrity cannot silently rebind an existing accepted input', t => {
  const f = fixture(t);
  const input = f.candidate('Pending');
  const result = f.prepare(input);
  f.db.prepare('UPDATE memory_general_fact_candidates SET evidence_ids_json = ? WHERE candidate_id = ?')
    .run('[]', result.candidateId);
  assert.throws(() => f.prepare(input), /INVALID_CANDIDATE_BINDING/);
});
