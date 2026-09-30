'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const test = require('node:test');
const Database = require('better-sqlite3');
const { migrations } = require('../lib/database-migrations');
const { createMemoryEvidenceRegistry } = require('../lib/memory-storage/evidence-registry');
const { createGeneralFactStore } = require('../lib/memory-storage/general-fact');
const { createGeneralFactReviewStore } = require('../lib/memory-storage/general-fact-review');
const { openDevelopmentDb, createReviewServer, main, HTML, CSS, APP } = require('../lib/memory-storage/review-ui');

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

async function serving(t, reviews) {
  const server = createReviewServer(reviews);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const script = await (await fetch(`${base}/app.js`)).text();
  const token = /^const REVIEW_TOKEN="([a-f0-9]+)";/.exec(script)[1];
  const post = (body, headers = {}) => fetch(`${base}/api/decision`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Review-Token': token, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { server, base, post };
}

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
