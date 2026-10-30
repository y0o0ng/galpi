'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');
const { sampleEpisodes, sample, run, prepareNext, advanceAfterDecision, gate, gateCommand } = require('../lib/memory-storage/formation-step2b');
const { createFormationLunaStages } = require('../lib/memory-storage/formation-openai');
const { attachAnchorWindows, writePrivateArtifact } = require('../lib/memory-storage/bundle-builder');
const { migrations } = require('../lib/database-migrations');
const { applyModuleMigrations } = require('../lib/memory-storage/migrations');
const { createMemoryEvidenceRegistry } = require('../lib/memory-storage/evidence-registry');
const { createProjectReviewStore } = require('../lib/memory-storage/project-review');
const { createReviewServer } = require('../lib/memory-storage/review-ui');

test('2b sampler excludes both earlier samples and probes, selects by hash, then orders by time', () => {
  const rows = [];
  const firstIds = [1684, 100, ...Array.from({ length: 20 }, (_, i) => 3000 + i * 10)];
  firstIds.forEach((first, group) => {
    for (let i = 0; i < 6; i++) rows.push({ id: first + i, created_at: group * 2000 + i });
  });
  const manifest = { episodes: [{ session: 'shared-main', firstMessageId: 101, lastMessageId: 103, messageCount: 3 }] };
  const result = sampleEpisodes(rows, manifest);
  const digest = first => createHash('sha256').update(`formation-loop-step2b-v1\0${first}\0${first + 5}`).digest('hex');
  const expected = firstIds.slice(2).sort((a, b) => digest(a).localeCompare(digest(b))).slice(0, 15).sort((a, b) => a - b);
  assert.deepEqual(result.map(entry => entry.firstMessageId), expected);
  assert.throws(() => sampleEpisodes(rows, { episodes: [{ session: 'shared-main', firstMessageId: 103, lastMessageId: 101, messageCount: 3 }] }), /STEP1_EPISODE_NOT_FOUND/);
  const nonmonotonic = rows.map(row => ({ ...row, id: row.id === 103 ? 99 : row.id }));
  const earlier = { episodes: [{ session: 'shared-main', firstMessageId: 101, lastMessageId: 99, messageCount: 3 }] };
  assert.ok(!sampleEpisodes(nonmonotonic, earlier).some(entry => entry.firstMessageId === 100));
});

test('run processes one episode, freezes an attempt and refuses undecided earlier reviews', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-step2b-run-')); fs.chmodSync(dir, 0o700);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const inputDir = path.join(dir, 'episodes'), outputDir = path.join(dir, 'results');
  fs.mkdirSync(inputDir, { mode: 0o700 }); fs.mkdirSync(outputDir, { mode: 0o700 });
  const entries = [];
  for (let i = 0; i < 15; i++) {
    const id = i + 1;
    const episode = { schemaVersion: 1, sourceDomain: 'conversation_message', sessionId: 'shared-main', firstMessageId: id, lastMessageId: id,
      turns: [{ turnId: `m${id}`, messageId: id, role: 'USER', text: `synthetic project ${id}`, createdAt: id }] };
    const episodeSha256 = writePrivateArtifact(path.join(inputDir, `episode-${String(id).padStart(2, '0')}.json`), episode);
    entries.push({ session: 'shared-main', episodeSha256, sourceDbSha256: 'a'.repeat(64) });
  }
  writePrivateArtifact(path.join(inputDir, 'manifest.json'), { sourceFileIdentitySha256: 'b'.repeat(64), episodes: entries });
  const dbPath = path.join(dir, 'general-fact-development.db');
  const db = new Database(dbPath); fs.chmodSync(dbPath, 0o600); db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE messages(id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL)');
  for (const name of ['memory_evidence_refs', 'memory_general_fact_storage', 'memory_general_fact_reviews']) migrations.find(m => m.name === name).up(db);
  applyModuleMigrations(db); db.close();
  let calls = 0;
  const adapters = { selectBundles: async request => { calls++; const input = JSON.parse(request.input); return { anchors: [{ turnId: input.turns[0].turnId, text: input.turns[0].text }] }; },
    stages: { assessAmbiguity: async () => ({ disposition: 'CLEAR', reason: 'test' }), assessDurability: async () => ({ disposition: 'WRITE', reason: 'test' }),
      extractCandidate: async ({ evidence }) => ({ disposition: 'EXTRACTED', semanticFamily: 'project',
        payload: { subject: 'USER', projectMention: 'synthetic project', kind: 'CLAIM', status: null, claimText: 'synthetic' }, evidenceTurnIds: [evidence[0].turnId] }) },
    generalProposer: async () => { throw Error('unexpected'); }, projectProposer: async request => ({ targetProjectId: 'NEW', targetClaimId: null,
      transition: 'CREATE', changeClass: null, displayName: 'synthetic', evidenceIds: JSON.parse(request.input).replayPackage.newEvidence.map(e => e.evidenceRef.evidenceId), rationale: 'test' }) };
  await run(inputDir, dbPath, outputDir, 1, adapters);
  assert.equal(calls, 1);
  await assert.rejects(run(inputDir, dbPath, outputDir, 1, adapters), /EPISODE_ALREADY_ATTEMPTED/);
  await assert.rejects(run(inputDir, dbPath, outputDir, 2, adapters), /EARLIER_REVIEW_UNDECIDED/);
  assert.equal(calls, 1);
  const reviewDb = new Database(dbPath); reviewDb.pragma('foreign_keys = ON');
  const reviews = createProjectReviewStore(reviewDb, createMemoryEvidenceRegistry(reviewDb));
  const pending = reviews.listPending()[0];
  reviews.decide(pending.reviewId, { choice: 'HOLD', packageSha256: pending.packageSha256 }); reviewDb.close();
  await run(inputDir, dbPath, outputDir, 2, adapters);
  assert.equal(calls, 2);
  const againDb = new Database(dbPath); againDb.pragma('foreign_keys = ON');
  const again = createProjectReviewStore(againDb, createMemoryEvidenceRegistry(againDb));
  const next = again.listPending()[0];
  again.decide(next.reviewId, { choice: 'HOLD', packageSha256: next.packageSha256 }); againDb.close();
  await assert.rejects(run(inputDir, dbPath, outputDir, 3, { ...adapters, selectBundles: async () => { throw Error('failure'); } }), /BUNDLE_SELECTOR_CALL_FAILED/);
  fs.unlinkSync(path.join(outputDir, 'episode-03.report.json.attempt.json'));
  await assert.rejects(run(inputDir, dbPath, outputDir, 3, adapters), /EPISODE_ALREADY_ATTEMPTED/);
  fs.appendFileSync(path.join(outputDir, 'episode-01.report.json'), ' ');
  await assert.rejects(run(inputDir, dbPath, outputDir, 4, adapters), /REPORT_INTEGRITY_MISMATCH/);
});

test('2b gate uses prepared project and MULTI reviews as denominator, tags and overlap', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ status: 'REVIEW_PREPARED', reviewId: `project_review_${i}`,
    candidateId: `c${i}`, packageSha256: `p${i}`, candidate: { semanticFamily: 'project', payload: {} } }));
  const decisions = rows.map((row, i) => ({ candidateId: row.candidateId, packageSha256: row.packageSha256,
    decision: i < 7 ? 'APPROVE' : 'REJECT_PROPOSAL', rejectionTag: i < 7 ? null : 'OTHER' }));
  const store = { get: id => decisions[Number(id.split('_').at(-1))] };
  const projects = [{ projectId: 'a', aliases: ['same'] }, { projectId: 'b', aliases: ['same'] }];
  assert.equal(gate([{ results: rows }], store, store, projects).gate, 'PASS');
  assert.equal(gate([{ results: [...rows, { status: 'WAITING' }] }], store, store, projects).gate, 'FAIL');
  assert.deepEqual(gate([{ results: rows }], store, store, projects).duplicateProjects, [['a', 'b']]);
  decisions[9].rejectionTag = 'WRONG_TARGET';
  assert.equal(gate([{ results: rows }], store, store, projects).gate, 'FAIL');
  decisions[9].rejectionTag = 'OTHER'; decisions[6].decision = 'HOLD';
  assert.equal(gate([{ results: rows }], store, store, projects).gate, 'FAIL');
});

test('whole episode extracts first, then each UI decision proposes the next candidate against the committed project', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-step2b-sequential-')); fs.chmodSync(dir, 0o700);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const inputDir = path.join(dir, 'episodes'), outputDir = path.join(dir, 'results');
  fs.mkdirSync(inputDir, { mode: 0o700 }); fs.mkdirSync(outputDir, { mode: 0o700 });
  const entries = [];
  for (let i = 0; i < 15; i++) {
    const ids = i === 0 ? [1, 2, 3] : [i + 3];
    const episode = { schemaVersion: 1, sourceDomain: 'conversation_message', sessionId: 'shared-main', firstMessageId: ids[0], lastMessageId: ids.at(-1),
      turns: ids.map(id => ({ turnId: `m${id}`, messageId: id, role: 'USER', text: `synthetic project claim ${id}`, createdAt: id })) };
    entries.push({ session: 'shared-main', episodeSha256: writePrivateArtifact(path.join(inputDir, `episode-${String(i + 1).padStart(2, '0')}.json`), episode), sourceDbSha256: 'a'.repeat(64) });
  }
  writePrivateArtifact(path.join(inputDir, 'manifest.json'), { sourceFileIdentitySha256: 'b'.repeat(64), episodes: entries });
  const dbPath = path.join(dir, 'general-fact-development.db');
  const setup = new Database(dbPath); fs.chmodSync(dbPath, 0o600); setup.pragma('foreign_keys = ON');
  setup.exec('CREATE TABLE messages(id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL)');
  for (const name of ['memory_evidence_refs', 'memory_general_fact_storage', 'memory_general_fact_reviews']) migrations.find(m => m.name === name).up(setup);
  applyModuleMigrations(setup); setup.close();
  const events = [];
  const adapters = {
    selectBundles: async request => ({ anchors: JSON.parse(request.input).turns.map(turn => ({ turnId: turn.turnId, text: turn.text })) }),
    stages: { assessAmbiguity: async () => ({ disposition: 'CLEAR', reason: 'test' }), assessDurability: async () => ({ disposition: 'WRITE', reason: 'test' }),
      extractCandidate: async ({ bundle }) => { const id = bundle.anchorSpanRef.turnId; events.push(`extract-${id}`); return { disposition: 'EXTRACTED', semanticFamily: 'project',
        payload: { subject: 'USER', projectMention: 'synthetic project', kind: 'CLAIM', status: null, claimText: `claim ${id}` }, evidenceTurnIds: [id] }; } },
    generalProposer: async () => assert.fail('unexpected general fact'),
    projectProposer: async request => { const replay = JSON.parse(request.input).replayPackage; events.push(`propose-${replay.candidate.payload.claimText}`);
      if (replay.candidate.payload.claimText === 'claim m3') throw Error('synthetic provider failure');
      return { targetProjectId: replay.projects.length ? replay.projects[0].projectId : 'NEW', targetClaimId: null,
        transition: replay.projects.length ? 'EXPAND' : 'CREATE', changeClass: replay.projects.length ? 'EXPANSION' : null,
        displayName: replay.projects.length ? null : 'synthetic',
        evidenceIds: replay.newEvidence.map(e => e.evidenceRef.evidenceId), rationale: 'test' }; },
  };
  const first = await run(inputDir, dbPath, outputDir, 1, adapters);
  assert.deepEqual(events, ['extract-m1', 'extract-m2', 'extract-m3', 'propose-claim m1']);
  assert.equal(first.next.status, 'REVIEW_PREPARED');
  assert.equal((await prepareNext(inputDir, dbPath, outputDir, 1, adapters)).status, 'AWAITING_REVIEW');
  await assert.rejects(run(inputDir, dbPath, outputDir, 2, adapters), /EARLIER_REVIEW_UNDECIDED/);
  const db = new Database(dbPath); db.pragma('foreign_keys = ON'); t.after(() => db.close());
  const reviews = createProjectReviewStore(db, createMemoryEvidenceRegistry(db));
  const server = createReviewServer(reviews, undefined, 'luna', id => advanceAfterDecision(db, inputDir, dbPath, outputDir, id, adapters));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const script = await (await fetch(`${base}/app.js`)).text(), token = /^const REVIEW_TOKEN="([a-f0-9]+)";/.exec(script)[1];
  async function approve(id) {
    const view = await (await fetch(`${base}/api/review?reviewId=${id}`)).json();
    const response = await fetch(`${base}/api/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Review-Token': token },
      body: JSON.stringify({ reviewId: id, choice: 'APPROVE', packageSha256: view.review.packageSha256 }) });
    assert.equal(response.status, 200); return response.json();
  }
  const decided = await approve(first.next.reviewId);
  assert.equal(decided.nextPreparation.status, 'REVIEW_PREPARED');
  assert.deepEqual(events, ['extract-m1', 'extract-m2', 'extract-m3', 'propose-claim m1', 'propose-claim m2']);
  assert.equal(await advanceAfterDecision(db, inputDir, dbPath, outputDir, first.next.reviewId, adapters), null);
  assert.equal(events.length, 5);
  const second = reviews.read(decided.nextPreparation.reviewId);
  assert.equal(second.review.proposal.transition, 'EXPAND');
  assert.equal(second.preview.project.currentClaims[0].value, 'claim m1');
  await assert.rejects(run(inputDir, dbPath, outputDir, 2, adapters), /EARLIER_REVIEW_UNDECIDED/);
  assert.equal((await approve(decided.nextPreparation.reviewId)).nextPreparation.status, 'PROCESSING_ERROR');
  assert.equal(events.filter(event => event === 'propose-claim m3').length, 1);
  assert.equal((await prepareNext(inputDir, dbPath, outputDir, 1, adapters)).status, 'COMPLETE');
  assert.equal(events.filter(event => event === 'propose-claim m3').length, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM memory_projects').get().n, 1);
  const noWrite = { ...adapters, stages: { ...adapters.stages, assessDurability: async () => ({ disposition: 'NO_WRITE', reason: 'test' }) } };
  for (let number = 2; number <= 15; number++) await run(inputDir, dbPath, outputDir, number, noWrite);
  const summary = gateCommand(inputDir, dbPath, outputDir);
  assert.equal(summary.gate, 'PASS'); assert.equal(summary.prepared, 2); assert.equal(summary.outcomes.PROCESSING_ERROR, 1);
});

test('2b sampler writes only private artifacts with chronological synthetic episodes', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-step2b-'));
  fs.chmodSync(dir, 0o700);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source.db');
  const db = new Database(source);
  db.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, created_at INTEGER)');
  const insert = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?)');
  const start = Date.parse('2026-08-01T00:00:00+09:00') / 1000;
  for (let group = 0; group < 17; group++) for (let i = 0; i < 6; i++) {
    const id = 3000 + group * 10 + i;
    insert.run(id, 'shared-main', 'user', `synthetic ${id}`, start + group * 2000 + i);
  }
  db.close();
  fs.chmodSync(source, 0o600);
  const step1 = { episodes: [{ session: 'shared-main', firstMessageId: 3000, lastMessageId: 3005, messageCount: 6 }] };
  fs.writeFileSync(`${source}-wal`, 'pending');
  assert.throws(() => sample(source, dir, step1), /SOURCE_DB_HAS_WAL/);
  fs.unlinkSync(`${source}-wal`);
  const manifest = sample(source, dir, step1);
  assert.equal(manifest.episodes.length, 15);
  const ids = manifest.episodes.map(entry => entry.firstMessageId);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  const manifestPath = path.join(dir, 'manifest.json');
  assert.equal(fs.statSync(manifestPath).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(manifestPath, 'utf8').includes('synthetic'), false);
  assert.equal(fs.statSync(path.join(dir, 'episode-01.json')).mode & 0o777, 0o600);
  assert.throws(() => sample(source, dir, step1), /EEXIST/);
});

test('extractor accepts project candidates and rejects malformed kind-specific fields', async () => {
  const episode = { schemaVersion: 1, sourceDomain: 'conversation_message', sessionId: 'shared-main', firstMessageId: 1, lastMessageId: 1,
    turns: [{ turnId: 'm1', messageId: 1, role: 'USER', text: '나는 프로젝트를 연구해', createdAt: 1 }] };
  const bundle = attachAnchorWindows(episode, { anchors: [{ turnId: 'm1', text: '프로젝트' }] }).bundles[0];
  const input = { bundle, evidence: episode.turns, durabilityReason: '계속 연구' };
  const payload = { subject: 'USER', projectMention: '프로젝트', kind: 'CLAIM', status: null, claimText: '연구해' };
  const extraction = value => ({ disposition: 'EXTRACTED', reason: null, semanticFamily: 'project', payload: value, evidenceTurnIds: ['m1'] });
  let answer = extraction(payload), request;
  const stages = createFormationLunaStages({ apiKey: 'fake', enableProjects: true, fetch: async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant',
      content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] }), { headers: { 'content-type': 'application/json' } });
  } });
  assert.deepEqual((await stages.extractCandidate(input)).payload, payload);
  assert.equal(request.text.format.strict, true);
  assert.match(request.instructions, /한 번들의 앵커를 표현하는 후보 하나/);
  assert.match(request.instructions, /프로젝트를 지칭하는 원문 표현 그대로/);
  assert.match(request.instructions, /표현을 조합하거나 새로 만들지 않고/);
  const oldStages = createFormationLunaStages({ apiKey: 'fake', fetch: async () => new Response(JSON.stringify({ status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] }),
  { headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(oldStages.extractCandidate(input), /INVALID_FORMATION_RESPONSE/);
  answer = extraction({ ...payload, kind: 'STATUS', status: 'ACTIVE', claimText: null });
  assert.equal((await stages.extractCandidate(input)).payload.status, 'ACTIVE');
  answer = extraction({ ...payload, projectMention: null });
  assert.equal((await stages.extractCandidate(input)).payload.projectMention, null);
  const assistantContext = { ...input, evidence: [...input.evidence, { turnId: 'm2', role: 'ASSISTANT', text: '알파 작업' }] };
  answer = { ...extraction({ ...payload, projectMention: '알파' }), evidenceTurnIds: ['m1'] };
  await assert.rejects(stages.extractCandidate(assistantContext), /INVALID_FORMATION_RESPONSE/);
  answer.evidenceTurnIds.push('m2');
  assert.equal((await stages.extractCandidate(assistantContext)).payload.projectMention, '알파');
  for (const invalid of [{ ...payload, status: 'ACTIVE' }, { ...payload, projectMention: ' ' },
    { ...payload, projectMention: '만든 프로젝트명' },
    { ...payload, kind: 'STATUS', status: 'UNKNOWN', claimText: null }, { ...payload, projectId: 'invented' }]) {
    answer = extraction(invalid);
    await assert.rejects(stages.extractCandidate(input), /INVALID_FORMATION_RESPONSE/);
  }
});
