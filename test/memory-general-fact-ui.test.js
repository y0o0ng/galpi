'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const Database = require('better-sqlite3');
const { migrations } = require('../lib/database-migrations');
const { createMemoryEvidenceRegistry } = require('../lib/memory-storage/evidence-registry');
const { createGeneralFactStore } = require('../lib/memory-storage/general-fact');
const { createGeneralFactReviewStore } = require('../lib/memory-storage/general-fact-review');
const { openDevelopmentDb, createReviewServer, main, HTML, CSS, APP } = require('../lib/memory-storage/review-ui');
const { createDevelopmentCandidateInput } = require('../lib/memory-storage/candidate-input');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'general-fact-ui-'));
  fs.chmodSync(dir, 0o700);
  const filename = path.join(dir, 'general-fact-development.db');
  const db = new Database(filename);
  fs.chmodSync(filename, 0o600);
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, created_at INTEGER)');
  for (const name of ['memory_evidence_refs', 'memory_general_fact_storage', 'memory_general_fact_reviews']) {
    migrations.find(item => item.name === name).up(db);
  }
  db.prepare('INSERT INTO messages VALUES (1, ?, ?, ?, 100)').run('synthetic', 'user', '<img src=x onerror=alert(1)> synthetic source');
  const registry = createMemoryEvidenceRegistry(db);
  const store = createGeneralFactStore(db, registry);
  const reviews = createGeneralFactReviewStore(db, registry);
  const candidate = { schemaVersion: 1, semanticFamily: 'general_fact',
    payload: { subject: 'USER', attributeKey: 'primary_laptop', value: 'Synthetic Laptop' },
    sources: [{ sourceDomain: 'conversation_message', sourceKey: '1' }] };
  const replay = store.prepare({ candidate, evidenceRefs: registry.registerSources(candidate.sources) }).replayPackage;
  const review = reviews.create({ candidateId: replay.candidateId, replaySha256: replay.replaySha256,
    proposal: { changeClass: null, transition: 'CREATE', rationale: 'Synthetic proposal only',
      evidenceIds: replay.newEvidence.map(item => item.evidenceRef.evidenceId) } });
  t.after(() => { if (db.open) db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, filename, db, review, reviews, store };
}

async function serving(t, reviews, prepareInput, proposer) {
  const server = createReviewServer(reviews, prepareInput, proposer);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const script = await (await fetch(`${base}/app.js`)).text();
  const token = /^const REVIEW_TOKEN="([a-f0-9]+)";/.exec(script)[1];
  const post = (body, headers = {}) => fetch(`${base}/api/decision`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Review-Token': token, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const input = (body, headers = {}) => fetch(`${base}/api/candidate-input`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Review-Token': token, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { server, base, post, input };
}

function candidateInput(payload = { subject: 'USER', attributeKey: 'primary_laptop', value: 'Synthetic New Laptop' }) {
  return { submissionId: randomUUID(), sourceText: '<img src=x onerror=alert(1)> synthetic new source', payload };
}

function proposed(request, transition = 'CREATE', changeClass = null) {
  return { transition, changeClass, rationale: 'Synthetic input proposal',
    evidenceIds: JSON.parse(request.input).replayPackage.newEvidence.map(item => item.evidenceRef.evidenceId) };
}

test('default review mode exposes no input form capability or model ingress', async t => {
  const f = fixture(t);
  const { base, input } = await serving(t, f.reviews);
  assert.deepEqual(await (await fetch(`${base}/api/input-config`)).json(), { enabled: false, attributes: {} });
  assert.equal((await input(candidateInput())).status, 404);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM messages').get().n, 1);
});

test('explicit input saves owning source/candidate before one proposal and requires separate HUMAN decision', async t => {
  const f = fixture(t);
  let calls = 0;
  const prepare = createDevelopmentCandidateInput({ db: f.db, evidenceRegistry: createMemoryEvidenceRegistry(f.db),
    proposeTransition: request => { calls++;
      assert.equal(f.db.prepare('SELECT count(*) AS n FROM messages').get().n, 2);
      assert.equal(f.db.prepare('SELECT count(*) AS n FROM memory_general_fact_candidates').get().n, 2);
      const replay = JSON.parse(request.input).replayPackage;
      assert.equal(replay.newEvidence[0].source.content, '<img src=x onerror=alert(1)> synthetic new source');
      assert.equal(replay.currentState, null);
      return proposed(request);
    } });
  const { base, input, post } = await serving(t, f.reviews, prepare);
  const config = await (await fetch(`${base}/api/input-config`)).json();
  assert.equal(config.enabled, true);
  assert.deepEqual(Object.keys(config.attributes), ['primary_laptop']);
  const body = candidateInput();
  const response = await input(body); assert.equal(response.status, 200);
  const result = await response.json(); assert.equal(calls, 1);
  assert.equal(f.reviews.get(result.reviewId).decision, null);
  assert.equal(f.store.readTarget('USER', 'primary_laptop').currentState, null);
  assert.equal(JSON.stringify(result).includes('synthetic new source'), false);
  assert.equal((await input(body)).status, 409); assert.equal(calls, 1);
  const view = await (await fetch(`${base}/api/review?reviewId=${result.reviewId}`)).json();
  assert.equal(view.replayPackage.newEvidence[0].source.content, body.sourceText);
  assert.equal((await post({ reviewId: result.reviewId, choice: 'APPROVE', packageSha256: view.review.packageSha256 })).status, 200);
  assert.equal(f.store.readTarget('USER', 'primary_laptop').currentState.value, body.payload.value);
  const rows = f.db.prepare('SELECT * FROM messages ORDER BY id').all();
  assert.equal(rows[0].content, '<img src=x onerror=alert(1)> synthetic source');
  assert.equal(rows[1].content, body.sourceText);
});

test('input validation, CSRF and body limits fail before writes/provider calls', async t => {
  const f = fixture(t);
  const prepare = createDevelopmentCandidateInput({ db: f.db, evidenceRegistry: createMemoryEvidenceRegistry(f.db),
    proposeTransition: () => assert.fail('Must not call provider') });
  const { input } = await serving(t, f.reviews, prepare);
  for (const value of [null, {}, { ...candidateInput(), submissionId: 'not-a-uuid' },
    { ...candidateInput(), sourceText: '' }, { ...candidateInput(), sourceText: 'a'.repeat(8001) },
    { ...candidateInput(), approved: true }, candidateInput({ subject: 'OTHER', attributeKey: 'primary_laptop', value: 'X' }),
    candidateInput({ subject: 'USER', attributeKey: 'invented', value: 'X' }),
    candidateInput({ subject: 'USER', attributeKey: 'primary_laptop', value: '' }),
    candidateInput({ subject: 'USER', attributeKey: 'primary_laptop', value: 'X', scope: 'now' })]) {
    assert.ok((await input(value)).status >= 400);
  }
  assert.equal((await input(candidateInput(), { 'X-Review-Token': 'wrong' })).status, 403);
  assert.equal((await input(candidateInput(), { Origin: 'https://other.invalid' })).status, 403);
  assert.equal((await input('{invalid')).status, 400);
  assert.equal((await input('a'.repeat(32769))).status, 413);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM messages').get().n, 1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM memory_general_fact_candidates').get().n, 1);
});

test('call failure/unsupported proposal persist pending input and cannot repeat after restart', async t => {
  const f = fixture(t);
  for (const unsupported of [false, true]) {
    let calls = 0;
    const body = candidateInput();
    const prepare = createDevelopmentCandidateInput({ db: f.db, evidenceRegistry: createMemoryEvidenceRegistry(f.db),
      proposeTransition: request => { calls++; if (!unsupported) throw new Error('private-provider-body');
        return proposed(request, 'KEEP_AMBIGUOUS', 'UNRESOLVED'); } });
    await assert.rejects(prepare(body), { code: unsupported ? 'UNSUPPORTED_TRANSITION' : 'PROPOSER_CALL_FAILED' });
    assert.equal(calls, 1);
    const sessionId = `general-fact-development-input:${body.submissionId}`;
    assert.equal(f.db.prepare('SELECT content FROM messages WHERE session_id = ?').get(sessionId).content, body.sourceText);
    const second = openDevelopmentDb(f.filename);
    try {
      const restarted = createDevelopmentCandidateInput({ db: second, evidenceRegistry: createMemoryEvidenceRegistry(second),
        proposeTransition: () => assert.fail('No retry') });
      await assert.rejects(restarted(body), { code: 'CANDIDATE_INPUT_ALREADY_SUBMITTED' });
    } finally { second.close(); }
  }
  assert.equal(f.store.readTarget('USER', 'primary_laptop').currentState, null);
});

for (const [blocker, transition, changeClass] of [
  ['UNSUPPORTED_TRANSITION', 'KEEP_AMBIGUOUS', 'AMBIGUOUS'],
  ['INVALID_TRANSITION_TARGET', 'SUPERSEDE', 'EXPANSION'],
]) for (const proposer of ['luna', 'qwen']) test(`${proposer} frontend explains ${blocker} as preserved pending evidence`, async t => {
  const f = fixture(t);
  f.reviews.decide(f.review.reviewId, { choice: blocker === 'INVALID_TRANSITION_TARGET' ? 'HOLD' : 'APPROVE', packageSha256: f.review.packageSha256 });
  const before = f.store.readTarget('USER', 'primary_laptop');
  let calls = 0;
  const prepare = createDevelopmentCandidateInput({ db: f.db, evidenceRegistry: createMemoryEvidenceRegistry(f.db),
    proposeTransition: request => { calls++; return proposed(request, transition, changeClass); } });
  const { base } = await serving(t, f.reviews, prepare, proposer);
  const script = await (await fetch(`${base}/app.js`)).text();
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.handlers = {}; this.value = ''; this.checked = false; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren() { this.children = []; }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    setAttribute() {}
    reportValidity() { return true; }
  }
  const app = new Element('main'), panel = new Element('section'), notice = new Element('div');
  const context = vm.createContext({
    document: { getElementById: id => ({ app, notice, 'candidate-input': panel })[id], createElement: tag => new Element(tag) },
    crypto: { randomUUID }, confirm: () => true,
    fetch: (url, options) => fetch(`${base}${url}`, options),
  });
  await vm.runInContext(script, context);
  const descendants = node => [node, ...node.children.flatMap(descendants)];
  const nodes = descendants(panel);
  const modelName = proposer === 'qwen' ? 'Qwen' : 'Luna';
  assert.ok(nodes.some(node => node.textContent === modelName+' 제안 준비'));
  const explanation = nodes.find(node => node.tag === 'p' && node.textContent?.startsWith('제안 준비를 누르면'));
  if (proposer === 'qwen') {
    assert.match(explanation.textContent, /로컬 서버/);
    assert.match(explanation.textContent, /외부 API는 호출하지 않아/);
    assert.doesNotMatch(explanation.textContent, /OpenAI|Luna/);
  }
  nodes.find(node => node.id === 'source-text').value = 'Synthetic uncertain device relation';
  nodes.find(node => node.id === 'attribute-key').value = 'primary_laptop';
  nodes.find(node => node.id === 'candidate-value').value = 'Synthetic Different Laptop';
  const submit = nodes.find(node => node.tag === 'form').handlers.submit;
  await submit({ preventDefault() {} });
  const status = nodes.find(node => node.tag === 'p' && node.textContent?.startsWith(modelName+' 제안은 보류'));
  assert.ok(status);
  assert.match(status.textContent, /검토 카드는 만들지 않았어/);
  assert.match(status.textContent, /원문·후보·제안은 보존/);
  assert.doesNotMatch(status.textContent, /검토를 열거나 저장할 수 없어/);
  if (blocker === 'INVALID_TRANSITION_TARGET') {
    assert.match(status.textContent, /현재 사실의 유무/);
    assert.match(status.textContent, /최초 형성은 CREATE/);
  }
  await submit({ preventDefault() {} });
  assert.equal(calls, 1, 'no automatic retry or repeat submission');
  assert.deepEqual(f.reviews.listPending(), []);
  const pending = f.db.prepare("SELECT pending_reason, proposal_json FROM memory_general_fact_candidates WHERE status = 'PENDING' AND pending_reason = ?").all(blocker);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].pending_reason, blocker);
  assert.equal(JSON.parse(pending[0].proposal_json).transition, transition);
  assert.deepEqual(f.store.readTarget('USER', 'primary_laptop').states, before.states);
});

test('source/candidate preflight rolls back together and parallel input is rejected without writes', async t => {
  const f = fixture(t);
  let release, calls = 0;
  const prepare = createDevelopmentCandidateInput({ db: f.db, evidenceRegistry: createMemoryEvidenceRegistry(f.db),
    proposeTransition: request => { calls++; return new Promise(resolve => { release = () => resolve(proposed(request)); }); } });
  const firstBody = candidateInput();
  const first = prepare(firstBody);
  await assert.rejects(prepare(candidateInput()), { code: 'CANDIDATE_INPUT_IN_PROGRESS' });
  await assert.rejects(prepare(firstBody), { code: 'CANDIDATE_INPUT_ALREADY_SUBMITTED' });
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM messages').get().n, 2);
  release(); await first; assert.equal(calls, 1);
  f.db.exec("CREATE TRIGGER deny_candidate BEFORE INSERT ON memory_general_fact_candidates BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
  await assert.rejects(prepare(candidateInput()));
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM messages').get().n, 2);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM memory_evidence_refs').get().n, 2);
  assert.equal(calls, 1);
});

test('null input stays a retraction candidate; approved state/support is available in next proposal', async t => {
  const f = fixture(t);
  f.reviews.decide(f.review.reviewId, { choice: 'APPROVE', packageSha256: f.review.packageSha256 });
  const before = f.store.readTarget('USER', 'primary_laptop');
  const prepare = createDevelopmentCandidateInput({ db: f.db, evidenceRegistry: createMemoryEvidenceRegistry(f.db),
    proposeTransition: request => {
      const replay = JSON.parse(request.input).replayPackage;
      assert.equal(replay.candidate.payload.value, null);
      assert.equal(replay.currentState.value, 'Synthetic Laptop');
      assert.equal(replay.originalSupport[0].source.id, 1);
      return proposed(request, 'INVALIDATE', 'CORRECTION');
    } });
  const result = await prepare(candidateInput({ subject: 'USER', attributeKey: 'primary_laptop', value: null }));
  assert.equal(f.reviews.get(result.reviewId).decision, null);
  assert.deepEqual(f.store.readTarget('USER', 'primary_laptop').states, before.states);
});

test('development DB is existing, private and outside the repo; no automatic schema creation', t => {
  const f = fixture(t);
  const before = f.db.prepare('SELECT name, sql FROM sqlite_master ORDER BY name').all();
  const opened = openDevelopmentDb(f.filename);
  assert.equal(opened.pragma('foreign_keys', { simple: true }), 1);
  opened.close();
  assert.deepEqual(f.db.prepare('SELECT name, sql FROM sqlite_master ORDER BY name').all(), before);
  assert.throws(() => openDevelopmentDb(path.join(f.dir, 'missing.db')));
  assert.equal(fs.existsSync(path.join(f.dir, 'missing.db')), false);
  fs.chmodSync(f.filename, 0o644);
  assert.throws(() => openDevelopmentDb(f.filename), /private/);
  fs.chmodSync(f.filename, 0o600);
  fs.chmodSync(f.dir, 0o755);
  assert.throws(() => openDevelopmentDb(f.filename), /private/);
  fs.chmodSync(f.dir, 0o700);
  const linked = path.join(f.dir, 'linked.db');
  fs.linkSync(f.filename, linked);
  assert.throws(() => openDevelopmentDb(f.filename), /private/);
  fs.unlinkSync(linked);
  fs.renameSync(f.filename, path.join(f.dir, 'galpi.db'));
  assert.throws(() => openDevelopmentDb(path.join(f.dir, 'galpi.db')), /private/);
});

test('production-shaped or incomplete DB fails without adding tables', t => {
  const f = fixture(t);
  f.db.exec('CREATE TABLE assistant_tasks (id INTEGER)');
  assert.throws(() => openDevelopmentDb(f.filename), /no production DB/);
  f.db.exec('DROP TABLE assistant_tasks; DROP TABLE memory_general_fact_reviews');
  assert.throws(() => openDevelopmentDb(f.filename), /automatic migration/);
  assert.equal(f.db.prepare("SELECT name FROM sqlite_master WHERE name = 'memory_general_fact_reviews'").get(), undefined);
  assert.throws(() => main([]), /development-db/);
  assert.throws(() => main(['--db', f.filename]), /development-db/);
});

test('explicit Qwen startup avoids OpenAI configuration and makes no model call', t => {
  const f = fixture(t);
  const listen = http.Server.prototype.listen;
  const oldKey = process.env.OPENAI_API_KEY, oldUrl = process.env.OPENAI_BASE_URL;
  // Do not claim the owner's real review port; exercise startup before any submission.
  http.Server.prototype.listen = function () { return this; };
  process.env.OPENAI_API_KEY = '';
  process.env.OPENAI_BASE_URL = 'https://must-not-be-used.invalid';
  let server;
  try {
    server = main(['--development-db', f.filename, '--candidate-input', '--proposer', 'qwen']);
    assert.ok(server instanceof http.Server);
    assert.throws(() => main(['--development-db', f.filename, '--candidate-input', '--proposer', 'other']));
    assert.throws(() => main(['--development-db', f.filename, '--proposer', 'qwen']));
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM messages').get().n, 1);
  } finally {
    if (server) server.emit('close');
    http.Server.prototype.listen = listen;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
    if (oldUrl === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = oldUrl;
  }
});

test('display has four information groups and full replay without mutating the source or state', async t => {
  const f = fixture(t);
  const before = f.db.prepare('SELECT * FROM messages').all();
  const { base } = await serving(t, f.reviews);
  const pending = await (await fetch(`${base}/api/pending`)).json();
  assert.equal(pending[0].reviewId, f.review.reviewId);
  const view = await (await fetch(`${base}/api/review?reviewId=${f.review.reviewId}`)).json();
  assert.equal(view.preview.isProposal, true);
  assert.equal(view.replayPackage.newEvidence[0].source.content, before[0].content);
  assert.deepEqual(view.replayPackage.evidence[0], view.replayPackage.newEvidence[0]);
  assert.equal(view.review.proposal.rationale, 'Synthetic proposal only');
  assert.equal(f.store.readTarget('USER', 'primary_laptop').currentState, null);
  assert.deepEqual(f.db.prepare('SELECT * FROM messages').all(), before);
  const page = await fetch(base);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.equal(page.headers.get('access-control-allow-origin'), null);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await page.text()).includes(before[0].content), false);
});

for (const choice of ['APPROVE', 'HOLD', 'REJECT_PROPOSAL']) {
  test(`${choice} uses existing HUMAN backend, survives reopen and cannot be overwritten`, async t => {
    const f = fixture(t);
    const { base, post } = await serving(t, f.reviews);
    const decision = { reviewId: f.review.reviewId, packageSha256: f.review.packageSha256, choice, reason: 'synthetic human choice' };
    assert.equal((await post(decision)).status, 400, 'must actually display before deciding');
    await fetch(`${base}/api/review?reviewId=${f.review.reviewId}`);
    assert.equal((await post(decision)).status, 200);
    assert.equal((await post(decision)).status, 200, 'identical retransmission is idempotent');
    assert.equal((await post({ ...decision, reason: 'changed' })).status, 409);
    assert.equal(f.reviews.get(f.review.reviewId).decision, choice);
    assert.equal(f.store.readTarget('USER', 'primary_laptop').revision, choice === 'APPROVE' ? 1 : 0);
    assert.deepEqual(await (await fetch(`${base}/api/pending`)).json(), []);
    const second = openDevelopmentDb(f.filename);
    try {
      const reopened = createGeneralFactReviewStore(second, createMemoryEvidenceRegistry(second));
      assert.equal(reopened.get(f.review.reviewId).decision, choice);
      assert.deepEqual(reopened.listPending(), []);
    } finally { second.close(); }
  });
}

test('forged decisions, CSRF, rebinding, unsupported routes and oversized bodies fail without writes', async t => {
  const f = fixture(t);
  const { base, post } = await serving(t, f.reviews);
  await fetch(`${base}/api/review?reviewId=${f.review.reviewId}`);
  const decision = { reviewId: f.review.reviewId, choice: 'APPROVE', packageSha256: f.review.packageSha256 };
  for (const extra of [{ approved: true }, { proposal: {} }, { choice: 'AUTO_APPROVE' }, { packageSha256: 'a'.repeat(64) }]) {
    assert.ok((await post({ ...decision, ...extra })).status >= 400);
  }
  assert.equal((await post(decision, { 'X-Review-Token': 'wrong' })).status, 403);
  assert.equal((await post(decision, { Origin: 'https://other.invalid' })).status, 403);
  assert.equal((await fetch(`${base}/app.js`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  const wrongHostStatus = await new Promise((resolve, reject) => {
    http.get(`${base}/api/pending`, { headers: { Host: 'other.invalid' } }, response => {
      response.resume(); resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(wrongHostStatus, 403);
  assert.equal((await post('{not json')).status, 400);
  assert.equal((await post('x'.repeat(17000))).status, 413);
  assert.equal((await fetch(`${base}/../package.json`)).status, 404);
  assert.equal((await fetch(`${base}/api/review?reviewId=x&reviewId=y`)).status, 400);
  assert.equal(f.reviews.get(f.review.reviewId).decision, null);
});

test('stale or changed source fails closed at display and approval; exception text is never served', async t => {
  const f = fixture(t);
  const { base, post } = await serving(t, f.reviews);
  await fetch(`${base}/api/review?reviewId=${f.review.reviewId}`);
  f.db.prepare('UPDATE messages SET content = ?').run('synthetic mutation must not be served');
  const error = await fetch(`${base}/api/review?reviewId=${f.review.reviewId}`);
  assert.equal(error.status, 409);
  assert.equal((await error.text()).includes('synthetic mutation'), false);
  assert.equal((await post({ reviewId: f.review.reviewId, choice: 'APPROVE', packageSha256: f.review.packageSha256 })).status, 409);
  assert.equal(f.reviews.get(f.review.reviewId).decision, null);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM memory_general_fact_states').get().n, 0);
});

test('frontend safely renders sources, requires confirmation and submits only raw HUMAN choices', () => {
  assert.doesNotThrow(() => new vm.Script(APP));
  assert.match(HTML, /lang="ko"/);
  assert.match(APP, /node\.textContent=text/);
  assert.doesNotMatch(APP, /innerHTML|insertAdjacentHTML|localStorage|sessionStorage|https?:\/\//);
  for (const text of ['새 후보와 원문 근거', '기존 사실과 원래 지지 근거', '변경 제안', '제안의 판단 이유', 'counterEvidence', 'unresolvedCandidates', 'r.evidence']) assert.ok(APP.includes(text));
  assert.match(APP, /confirm\(prompt/);
  assert.match(APP, /packageSha256:review.packageSha256/);
  assert.match(APP, /reason:reason.value/);
  assert.match(CSS, /focus-visible/);
  assert.match(CSS, /grid-template-columns:1fr/);
  const code = fs.readFileSync(require.resolve('../lib/memory-storage/review-ui'), 'utf8');
  assert.match(code, /server\.listen\(PORT, '127\.0\.0\.1'/);
  assert.doesNotMatch(code, /require\(['"].*(openai|dotenv|database-migrations|server|runtime-paths|vault)/);
});

test('SUPERSEDE display and approval confirmation explain current value plus preserved history', async () => {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.handlers = {}; this.classList = { add() {} }; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren() { this.children = []; }
    addEventListener(name, handler) { this.handlers[name] = handler; }
  }
  const app = new Element('main'), notice = new Element('div');
  let confirmation;
  const context = vm.createContext({
    document: { getElementById: id => id === 'app' ? app : notice, createElement: tag => new Element(tag) },
    fetch: async () => ({ ok: true, json: async () => [] }),
    confirm: text => { confirmation = text; return false; },
    view: { review: { proposal: { transition: 'SUPERSEDE', changeClass: 'WORLD_UPDATE', evidenceIds: [], rationale: 'Synthetic' } },
      preview: { currentValue: 'Old laptop', resultingCurrentValue: 'New laptop', previousStateDisposition: 'HISTORICAL' },
      replayPackage: { candidate: { payload: { value: 'New laptop' } }, newEvidence: [], originalSupport: [], evidence: [], states: [], history: [] } },
  });
  vm.runInContext(APP, context);
  vm.runInContext('render(view)', context);
  const descendants = node => [node, ...node.children.flatMap(descendants)];
  const nodes = descendants(app), text = nodes.map(node => node.textContent || '').join('\n');
  assert.match(text, /승인 전 현재 값\nOld laptop/);
  assert.match(text, /승인 후 현재 값\nNew laptop/);
  assert.match(text, /유효했던 과거 사실로 보존/);
  assert.match(text, /기존 값과 원문 근거는 과거 이력으로 함께 보존/);
  await nodes.find(node => node.tag === 'button' && node.textContent === '승인').handlers.click();
  assert.match(confirmation, /기존 값을 삭제하거나 이전 발언이 틀렸다고 판정하는 동작이 아니야/);
});
