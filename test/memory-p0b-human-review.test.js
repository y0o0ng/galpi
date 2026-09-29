'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {
  validatePacket, loadPacket, deriveDecision, privateOutputDir, reviewState, createServer,
  HTML, APP, JOURNAL, FINAL,
} = require('../scripts/review-memory-p0-b-blind');

const packetSha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function packet() {
  return { schemaVersion: 1, rubric: { material: ['synthetic'], notMaterial: ['synthetic'],
    instruction: 'synthetic' }, cases: Array.from({ length: 66 }, (_, i) => ({
    blindCaseNumber: i + 1, originalRequest: `synthetic request ${i + 1}`,
    historicalRequestTime: 1780000000,
    boundedConversationHistory: [{ role: 'user', content: 'synthetic history' }],
    groupX: ['synthetic X1', 'synthetic X2'], groupY: ['synthetic Y1', 'synthetic Y2'],
    decision: { withinXStable: null, withinYStable: null, crossArmMateriality: null,
      finalLabel: null, reason: null },
  })) };
}
function validPacket(value = packet()) {
  const bytes = Buffer.from(JSON.stringify(value));
  return validatePacket(bytes, packetSha(bytes));
}
function choice(blindCaseNumber, withinX = 'STABLE', withinY = 'STABLE', cross = 'MATERIAL') {
  return { blindCaseNumber, withinX, withinY,
    crossComparisons: withinX === 'STABLE' && withinY === 'STABLE'
      ? { X1_Y1: cross, X1_Y2: cross, X2_Y1: cross, X2_Y2: cross } : null };
}
function setup(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'p0b-human-review-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repoRoot = path.join(base, 'repo');
  fs.mkdirSync(repoRoot);
  const outputDir = path.join(base, 'private');
  const args = { packet: validPacket(), packetSha256: 'a'.repeat(64), outputDir, repoRoot,
    now: () => new Date('2026-09-29T00:00:00.000Z') };
  return { base, repoRoot, outputDir, args };
}

test('packet identity, count, uniqueness, answer groups and empty decisions fail closed', () => {
  const bytes = Buffer.from(JSON.stringify(packet()));
  assert.throws(() => validatePacket(bytes, '0'.repeat(64)), /SHA256/);
  for (const mutate of [
    p => p.cases.pop(),
    p => { p.cases[1].blindCaseNumber = 1; },
    p => p.cases[0].groupX.pop(),
    p => p.cases[0].groupY.push('extra'),
    p => { p.cases[0].decision.finalLabel = 'MATERIAL_CHANGE'; },
    p => { p.cases[0].boundedConversationHistory[0].content = 42; },
  ]) {
    const p = packet(); mutate(p);
    assert.throws(() => validPacket(p));
  }
});

test('committed manifest packet SHA is pinned before private packet read', t => {
  const { base } = setup(t);
  const manifestPath = path.join(base, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1,
    generationCompleteCases: 66, generationFailureCases: 0,
    preexistingToolIndeterminate: 13, humanAdjudications: 0,
    blindPacketSha256: '0'.repeat(64) }));
  assert.throws(() => loadPacket(path.join(base, 'missing-private-packet'), manifestPath), /manifest/);
});

test('canonical HUMAN judgment derivation rejects malformed and uses exact stability rule', () => {
  assert.deepEqual(deriveDecision(choice(1, 'UNSURE', 'STABLE')),
    { finalLabel: 'INDETERMINATE', reason: 'INDETERMINATE_ADJUDICATION' });
  for (const pair of [['MATERIAL_DIFFERENCE', 'STABLE'], ['STABLE', 'MATERIAL_DIFFERENCE']]) {
    assert.deepEqual(deriveDecision(choice(1, ...pair)),
      { finalLabel: 'INDETERMINATE', reason: 'INDETERMINATE_NONDETERMINISM' });
  }
  assert.deepEqual(deriveDecision(choice(1)), { finalLabel: 'MATERIAL_CHANGE', reason: null });
  assert.deepEqual(deriveDecision(choice(1, 'STABLE', 'STABLE', 'NO_MATERIAL')),
    { finalLabel: 'NO_MATERIAL_CHANGE', reason: null });
  const mixed = choice(1); mixed.crossComparisons.X2_Y2 = 'NO_MATERIAL';
  assert.deepEqual(deriveDecision(mixed),
    { finalLabel: 'INDETERMINATE', reason: 'INDETERMINATE_NONDETERMINISM' });
  mixed.crossComparisons.X2_Y2 = 'UNSURE';
  assert.deepEqual(deriveDecision(mixed),
    { finalLabel: 'INDETERMINATE', reason: 'INDETERMINATE_ADJUDICATION' });
  const partial = choice(1); delete partial.crossComparisons.X2_Y2;
  assert.throws(() => deriveDecision(partial), /네 cross-pair/);
  const invalid = choice(1, 'UNSURE', 'STABLE'); invalid.crossComparisons = choice(1).crossComparisons;
  assert.throws(() => deriveDecision(invalid), /null/);
  assert.throws(() => deriveDecision({ ...choice(1), finalLabel: 'NO_MATERIAL_CHANGE' }), /형식/);
  assert.throws(() => deriveDecision({ ...choice(1), reason: null }), /형식/);
});

test('output is private and cannot be inside repository', t => {
  const { base, repoRoot } = setup(t);
  assert.throws(() => privateOutputDir(path.join(repoRoot, 'review'), repoRoot), /저장소 밖/);
  const dir = privateOutputDir(path.join(base, 'private'), repoRoot);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  fs.chmodSync(dir, 0o755);
  assert.throws(() => privateOutputDir(dir, repoRoot), /0700/);
});

test('journal is fsynced, resumes, and duplicate submissions cannot mutate', t => {
  const { args, outputDir } = setup(t);
  let review = reviewState(args);
  assert.equal(review.current().progress.reviewed, 0);
  assert.equal(fs.existsSync(path.join(outputDir, FINAL)), false);
  const first = choice(1);
  assert.deepEqual(review.submit(first), { saved: true });
  assert.equal(fs.statSync(path.join(outputDir, JOURNAL)).mode & 0o777, 0o600);
  const journal = fs.readFileSync(path.join(outputDir, JOURNAL), 'utf8');
  assert.equal(journal.trim().split('\n').length, 1);
  for (const secret of ['synthetic request', 'synthetic history', 'synthetic X1']) {
    assert.equal(journal.includes(secret), false);
  }
  assert.equal(review.current().currentCase.blindCaseNumber, 2);
  assert.deepEqual(review.submit(first), { saved: true, duplicate: true });
  assert.equal(fs.readFileSync(path.join(outputDir, JOURNAL), 'utf8'), journal);
  assert.throws(() => review.submit(choice(1, 'UNSURE', 'STABLE')), { statusCode: 409 });
  assert.throws(() => review.submit(choice(3)), { statusCode: 409 });
  review = reviewState(args);
  assert.equal(review.current().currentCase.blindCaseNumber, 2);
  assert.equal(fs.readFileSync(path.join(outputDir, JOURNAL), 'utf8'), journal);
});

test('final private artifact is created once only at 66/66 and has no packet text', t => {
  const { args, outputDir } = setup(t);
  let review = reviewState(args);
  for (let i = 1; i < 66; i += 1) review.submit(choice(i));
  assert.equal(fs.existsSync(path.join(outputDir, FINAL)), false);
  review.submit(choice(66));
  const finalBytes = fs.readFileSync(path.join(outputDir, FINAL));
  assert.equal(fs.statSync(path.join(outputDir, FINAL)).mode & 0o777, 0o600);
  const final = JSON.parse(finalBytes);
  assert.equal(final.reviewedCaseCount, 66);
  assert.equal(final.cases.length, 66);
  assert.equal(final.humanAdjudicationCompleted, true);
  for (const secret of ['synthetic request', 'synthetic history', 'synthetic X1']) {
    assert.equal(finalBytes.includes(secret), false);
  }
  fs.unlinkSync(path.join(outputDir, FINAL));
  assert.deepEqual(review.submit(choice(66)), { saved: true, duplicate: true });
  assert.deepEqual(fs.readFileSync(path.join(outputDir, FINAL)), finalBytes);
  review = reviewState(args);
  assert.equal(review.current().currentCase, null);
  assert.deepEqual(fs.readFileSync(path.join(outputDir, FINAL)), finalBytes);
});

test('corrupt, conflicting or out-of-order journal fails on restart', t => {
  const { args, outputDir } = setup(t);
  const review = reviewState(args);
  review.submit(choice(1));
  const file = path.join(outputDir, JOURNAL);
  const line = fs.readFileSync(file, 'utf8');
  fs.appendFileSync(file, line);
  assert.throws(() => reviewState(args), /순서/);
  fs.writeFileSync(file, line.trim());
  assert.throws(() => reviewState(args), /불완전/);
});

test('a premature final artifact cannot be paired with an incomplete journal', t => {
  const { args, outputDir } = setup(t);
  reviewState(args);
  fs.writeFileSync(path.join(outputDir, FINAL), '{}', { mode: 0o600 });
  assert.throws(() => reviewState(args), /완료 artifact/);
});

test('HTTP serves only current case, rejects forged labels, and contains no hidden study results', async t => {
  const { args } = setup(t);
  const review = reviewState(args);
  const server = createServer(review, 'test-token');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const state = await fetch(`${base}/api/state`);
  assert.equal(state.headers.get('cache-control'), 'no-store');
  assert.equal(state.headers.get('access-control-allow-origin'), null);
  const json = await state.json();
  assert.equal(json.progress.reviewed, 0);
  assert.equal(json.currentCase.blindCaseNumber, 1);
  assert.equal(JSON.stringify(json).includes('synthetic request 2'), false);
  const app = await (await fetch(`${base}/app.js`)).text();
  new vm.Script(app);
  assert.match(app, /historicalRequestTime \* 1000/);
  assert.match(app, /textContent/);
  assert.doesNotMatch(app, /innerHTML|HARD-GATED|GLOBAL-SOFT-PRIOR|retrievalScore|ΔA|GREEN|AMBER|RED/);
  assert.doesNotMatch(HTML, /HARD-GATED|GLOBAL-SOFT-PRIOR|M count|N count|U count/);
  const post = body => fetch(`${base}/api/decision`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Review-Token': 'test-token' },
    body: JSON.stringify(body) });
  assert.equal((await post({ ...choice(1), finalLabel: 'MATERIAL_CHANGE' })).status, 400);
  assert.equal((await post(choice(2))).status, 409);
  assert.equal((await post(choice(1))).status, 200);
  assert.equal((await post(choice(1, 'UNSURE', 'STABLE'))).status, 409);
  assert.equal((await fetch(`${base}/api/decision`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(choice(2)) })).status, 403);
  assert.equal((await fetch(`${base}/api/decision`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Review-Token': 'test-token' },
    body: ' '.repeat(5000) })).status, 413);
  assert.equal((await fetch(`${base}/not-a-route`)).status, 404);
  assert.equal(review.current().progress.reviewed, 1);
});
