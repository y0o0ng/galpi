'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { migrations } = require('../lib/database-migrations');
const { applyModuleMigrations } = require('../lib/memory-storage/migrations');
const { createMemoryEvidenceRegistry } = require('../lib/memory-storage/evidence-registry');
const { createMemoryStorageRouter } = require('../lib/memory-storage/router');
const { createProjectStore } = require('../lib/memory-storage/project');
const { createProjectReviewStore } = require('../lib/memory-storage/project-review');
const { createProjectReviewHandler } = require('../lib/memory-storage/project-proposer');
const { createOpenAIProjectProposer } = require('../lib/memory-storage/project-openai');
const { createReviewServer, APP } = require('../lib/memory-storage/review-ui');

function fixture(t) {
  const db = new Database(':memory:'); t.after(() => db.close()); db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE messages(id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL)');
  for (const name of ['memory_evidence_refs', 'memory_general_fact_storage', 'memory_general_fact_reviews']) migrations.find(m => m.name === name).up(db);
  applyModuleMigrations(db);
  const registry = createMemoryEvidenceRegistry(db), store = createProjectStore(db, registry), reviews = createProjectReviewStore(db, registry);
  let proposal;
  const handler = createProjectReviewHandler({ db, evidenceRegistry: registry, proposeTransition: async request => {
    const replay = JSON.parse(request.input).replayPackage;
    return { ...proposal, evidenceIds: replay.newEvidence.map(e => e.evidenceRef.evidenceId), rationale: 'synthetic' };
  } });
  const route = createMemoryStorageRouter({ evidenceRegistry: registry, transitionHandlers: new Map([['project', handler]]) });
  let id = 0;
  const candidate = (kind, value, mention = 'project') => {
    id++; db.prepare('INSERT INTO messages VALUES(?,?,?,?,?)').run(id, 's', 'user', `synthetic source ${id}`, id);
    return { schemaVersion: 1, semanticFamily: 'project', payload: { subject: 'USER', projectMention: mention, kind,
      status: kind === 'STATUS' ? value : null, claimText: kind === 'CLAIM' ? value : null }, sources: [{ sourceDomain: 'conversation_message', sourceKey: String(id) }] };
  };
  const propose = async (candidateInput, targetProjectId, targetClaimId, transition, changeClass) => {
    proposal = { targetProjectId, targetClaimId, transition, changeClass }; return route(candidateInput);
  };
  const decide = (result, choice = 'APPROVE', rejectionTag) => reviews.decide(result.review.reviewId,
    { choice, packageSha256: result.review.packageSha256, ...(rejectionTag ? { rejectionTag } : {}) });
  return { db, store, reviews, candidate, propose, decide };
}

test('project CREATE, EXPAND, status SUPERSEDE, claim REVISE and INVALIDATE preserve provenance', async t => {
  const f = fixture(t);
  const create = await f.propose(f.candidate('STATUS', 'PLANNED', 'Galpi'), 'NEW', null, 'CREATE', null);
  assert.equal(f.store.readProjects().length, 0); f.decide(create);
  let project = f.store.readProjects()[0], id = project.projectId;
  const expansion = await f.propose(f.candidate('CLAIM', 'build a memory', '갈피'), id, null, 'EXPAND', 'EXPANSION');
  f.decide(expansion);
  project = f.store.readProjects()[0]; const claimId = project.currentClaims[0].stateId;
  f.decide(await f.propose(f.candidate('STATUS', 'ACTIVE'), id, null, 'SUPERSEDE', 'WORLD_UPDATE'));
  f.decide(await f.propose(f.candidate('CLAIM', 'build a safe memory'), id, claimId, 'REVISE', 'CORRECTION'));
  project = f.store.readProjects()[0];
  assert.deepEqual(project.aliases, ['Galpi', '갈피', 'project']);
  assert.equal(project.currentStatus.value, 'ACTIVE');
  assert.equal(project.states.find(s => s.value === 'PLANNED').status, 'HISTORICAL');
  assert.equal(project.states.find(s => s.value === 'build a memory').status, 'CORRECTED');
  f.decide(await f.propose(f.candidate('CLAIM', 'withdraw claim'), id, project.currentClaims[0].stateId, 'INVALIDATE', 'CORRECTION'));
  project = f.store.readProjects()[0]; assert.equal(project.currentClaims.length, 0);
  assert.equal(project.states.find(s => s.value === 'build a safe memory').status, 'INVALIDATED');
  assert.equal(project.history.length, 5);
});

test('ambiguous stays pending, FORK fails closed, stale approval fails and rejection tag persists', async t => {
  const f = fixture(t);
  const ambiguous = await f.propose(f.candidate('CLAIM', 'uncertain'), 'NEW', null, 'KEEP_AMBIGUOUS', 'AMBIGUOUS');
  assert.equal(ambiguous.reason, 'KEEP_AMBIGUOUS'); assert.equal(f.store.readProjects().length, 0);
  await assert.rejects(f.propose(f.candidate('CLAIM', 'fork'), 'NEW', null, 'FORK', 'AMBIGUOUS'), /UNSUPPORTED_TRANSITION/);
  const a = await f.propose(f.candidate('STATUS', 'PLANNED', 'a'), 'NEW', null, 'CREATE', null);
  const b = await f.propose(f.candidate('STATUS', 'PLANNED', 'b'), 'NEW', null, 'CREATE', null);
  f.decide(a);
  assert.throws(() => f.decide(b), /STALE_REVIEW/);
  const c = await f.propose(f.candidate('STATUS', 'PLANNED', 'c'), 'NEW', null, 'CREATE', null);
  assert.throws(() => f.decide(c, 'REJECT_PROPOSAL'), /INVALID_REVIEW_DECISION/);
  assert.equal(f.decide(c, 'REJECT_PROPOSAL', 'WRONG_TARGET').rejectionTag, 'WRONG_TARGET');
});

test('project approval rolls back all derived writes on provenance failure', async t => {
  const f = fixture(t);
  const result = await f.propose(f.candidate('STATUS', 'PLANNED'), 'NEW', null, 'CREATE', null);
  f.db.exec("CREATE TRIGGER fail_project_evidence BEFORE INSERT ON memory_project_transition_evidence BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
  assert.throws(() => f.decide(result), /synthetic failure/);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM memory_projects').get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM memory_project_states').get().n, 0);
  assert.equal(f.reviews.get(result.review.reviewId).decision, null);
  assert.equal(f.db.prepare('SELECT status FROM memory_project_candidates WHERE candidate_id=?').get(result.candidateId).status, 'PENDING');
});

test('changed owning source prevents project approval without changing stored state', async t => {
  const f = fixture(t);
  const result = await f.propose(f.candidate('STATUS', 'PLANNED'), 'NEW', null, 'CREATE', null);
  f.db.prepare('UPDATE messages SET content=? WHERE id=1').run('changed synthetic');
  assert.throws(() => f.decide(result), /integrity mismatch/);
  assert.equal(f.store.readProjects().length, 0);
  assert.equal(f.reviews.get(result.review.reviewId).decision, null);
});

test('a first status on an existing claim-only project uses CREATE without creating another project', async t => {
  const f = fixture(t);
  f.decide(await f.propose(f.candidate('CLAIM', 'initial claim'), 'NEW', null, 'CREATE', null));
  const project = f.store.readProjects()[0];
  const review = await f.propose(f.candidate('STATUS', 'ACTIVE'), project.projectId, null, 'CREATE', null);
  f.decide(review);
  assert.equal(f.store.readProjects().length, 1);
  assert.equal(f.store.readProjects()[0].currentStatus.value, 'ACTIVE');
  await assert.rejects(f.propose(f.candidate('STATUS', 'DONE'), project.projectId, null, 'CREATE', null), /INVALID_TRANSITION_TARGET/);
});

test('project Luna proposer uses one strict medium call with synthetic fetch', async () => {
  let calls = 0, body;
  const value = { targetProjectId: 'NEW', targetClaimId: null, transition: 'CREATE', changeClass: null, evidenceIds: ['ev'], rationale: 'synthetic' };
  const proposer = createOpenAIProjectProposer({ apiKey: 'fake', fetch: async (_url, options) => {
    calls++; body = JSON.parse(options.body);
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }), { headers: { 'content-type': 'application/json' } });
  } });
  assert.deepEqual(await proposer({ promptVersion: 'project-transition-proposal-v1', instructions: 'test', input: '{}' }), value);
  assert.equal(calls, 1); assert.equal(body.model, 'gpt-6-luna'); assert.equal(body.reasoning.effort, 'medium');
  assert.equal(body.text.format.strict, true); assert.equal(body.store, false);
  let failures = 0;
  const failing = createOpenAIProjectProposer({ apiKey: 'fake', fetch: async () => { failures++; return new Response('error', { status: 500 }); } });
  await assert.rejects(failing({ promptVersion: 'project-transition-proposal-v1', instructions: 'test', input: '{}' }), /OPENAI_PROPOSER_CALL_FAILED/);
  assert.equal(failures, 1);
});

test('project review UI exposes selected project and touched claim and stores rejection tag', async t => {
  const f = fixture(t);
  f.decide(await f.propose(f.candidate('STATUS', 'ACTIVE', 'first alias'), 'NEW', null, 'CREATE', null));
  let p = f.store.readProjects()[0];
  f.decide(await f.propose(f.candidate('CLAIM', 'original claim', 'second alias'), p.projectId, null, 'EXPAND', 'EXPANSION'));
  p = f.store.readProjects()[0];
  const pending = await f.propose(f.candidate('CLAIM', 'changed claim'), p.projectId, p.currentClaims[0].stateId, 'REVISE', 'CORRECTION');
  const server = createReviewServer(f.reviews);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const script = await (await fetch(`${base}/app.js`)).text();
  const token = /^const REVIEW_TOKEN="([a-f0-9]+)";/.exec(script)[1];
  const response = await fetch(`${base}/api/review?reviewId=${pending.review.reviewId}`);
  const view = await response.json();
  assert.equal(view.preview.project.projectId, p.projectId);
  assert.deepEqual(view.preview.project.aliases, ['first alias', 'second alias']);
  assert.equal(view.preview.touched.value, 'original claim');
  assert.equal(view.replayPackage.originalSupport[0].source.content, 'synthetic source 2');
  assert.match(APP, /선택한 프로젝트/); assert.match(APP, /변경 대상 주장/);
  const decision = await fetch(`${base}/api/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Review-Token': token },
    body: JSON.stringify({ reviewId: pending.review.reviewId, choice: 'REJECT_PROPOSAL', packageSha256: view.review.packageSha256, rejectionTag: 'WRONG_CONTENT' }) });
  assert.equal(decision.status, 200);
  assert.equal(f.reviews.get(pending.review.reviewId).rejectionTag, 'WRONG_CONTENT');
});

test('UI keeps the HUMAN decision when next preparation fails', async t => {
  const f = fixture(t);
  const pending = await f.propose(f.candidate('STATUS', 'PLANNED'), 'NEW', null, 'CREATE', null);
  let calls = 0;
  const server = createReviewServer(f.reviews, undefined, 'luna', async () => { calls++; throw Error('private provider details'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const script = await (await fetch(`${base}/app.js`)).text(), token = /^const REVIEW_TOKEN="([a-f0-9]+)";/.exec(script)[1];
  const view = await (await fetch(`${base}/api/review?reviewId=${pending.review.reviewId}`)).json();
  const response = await fetch(`${base}/api/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Review-Token': token },
    body: JSON.stringify({ reviewId: pending.review.reviewId, choice: 'APPROVE', packageSha256: view.review.packageSha256 }) });
  const result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.saved, true); assert.equal(result.nextPreparation.status, 'PREPARATION_FAILED');
  assert.equal(JSON.stringify(result).includes('private provider details'), false);
  assert.equal(f.reviews.get(pending.review.reviewId).decision, 'APPROVE'); assert.equal(calls, 1);
});
