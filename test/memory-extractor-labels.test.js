'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { partition, prepare, importReports, draft, createLabelStore, createLabelServer } = require('../lib/memory-storage/extractor-labels');
const { writePrivateArtifact } = require('../lib/memory-storage/bundle-builder');

function sourceDb(t, sizes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'labels-'));
  fs.chmodSync(dir, 0o700);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'source.db');
  const db = new Database(file);
  db.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, created_at INTEGER)');
  let id = 10_000, at = 1_000_000;
  const groups = sizes.map(size => {
    at += 10_000;
    const first = id;
    for (let i = 0; i < size; i++) db.prepare('INSERT INTO messages VALUES (?,?,?,?,?)').run(id++, 'shared-main', i % 2 ? 'assistant' : 'user', `문장 ${first} ${i} 소설을 쓰고 있어`, at + i);
    return { firstMessageId: first, lastMessageId: id - 1, messageCount: size };
  });
  db.close();
  return { dir, file, groups };
}

test('evaluation holds only unseen 6-24 message sessions and never overlaps training', () => {
  const rows = [], add = (first, n, start, blank = false) => { for (let i = 0; i < n; i++) rows.push({ id: first + i, created_at: start + i, blank: blank && i === 1 ? 1 : 0 }); };
  add(1, 6, 0); add(101, 6, 10_000); add(201, 30, 20_000); add(301, 3, 30_000); add(401, 6, 40_000, true); add(1684, 6, 50_000);
  const out = partition(rows, [{ firstMessageId: 101, lastMessageId: 106 }]);
  assert.deepEqual(out.eval.map(e => e.firstMessageId), [1]);
  assert.deepEqual(out.train.map(e => e.firstMessageId), [101, 201, 301, 1684]);
  assert.equal(out.blankSessions, 1);
});

function prepared(t) {
  const { dir, file, groups } = sourceDb(t, [...Array(10).fill(6), 30, 2]);
  const out = path.join(dir, 'out');
  fs.mkdirSync(out, { mode: 0o700 });
  assert.deepEqual(prepare(file, out, []), { train: 2, eval: 10, blankSessions: 0 });
  return { dir, out, groups };
}

const stages = { selectBundles: async () => ({ anchors: [] }), assessAmbiguity: async () => ({ disposition: 'CLEAR', reason: 'r' }),
  assessDurability: async () => ({ disposition: 'WRITE', reason: '단계' }),
  extractCandidate: async input => ({ disposition: 'EXTRACTED', semanticFamily: 'project', evidenceTurnIds: [input.bundle.anchorSpanRef.turnId],
    payload: { subject: 'USER', kind: 'CLAIM', status: null, claimText: '소설을 쓰고 있어', projectMention: '소설' } }) };

async function drafted(t) {
  const ctx = prepared(t);
  const manifest = JSON.parse(fs.readFileSync(path.join(ctx.out, 'manifest.json'), 'utf8'));
  const anchored = { ...stages, selectBundles: async request => {
    const turns = JSON.parse(request.input).turns;
    return { anchors: [{ turnId: turns[0].turnId, text: turns[0].text }] };
  } };
  const results = await draft(ctx.out, 'train', 10, { stages: anchored, selectBundles: anchored.selectBundles });
  assert.deepEqual(results.map(r => r.rows), [1, 1]);
  assert.equal(results[0].episodeId, manifest.episodes.find(e => e.split === 'train' && e.messageCount === 30).episodeId, 'long sessions draft first');
  await draft(ctx.out, 'eval', 1, { stages: anchored, selectBundles: anchored.selectBundles });
  return ctx;
}

test('labels stay in their split, latest decision wins, and bad gold is refused', async t => {
  const { out } = await drafted(t);
  const store = createLabelStore(out, 'train');
  const first = store.next();
  assert.equal(first.total, 2); assert.equal(first.labeled, 0); assert.equal(first.item.episodeId.startsWith('train-'), true);
  assert.equal(createLabelStore(out, 'eval').next().item.episodeId.startsWith('eval-'), true);
  store.save({ itemId: first.item.itemId, decision: 'APPROVE' });
  assert.equal(store.next().labeled, 1);
  assert.notEqual(store.next().item.itemId, first.item.itemId);
  assert.throws(() => store.save({ itemId: 'nope', decision: 'APPROVE' }), /INVALID_LABEL/);
  const payload = { subject: 'USER', kind: 'CLAIM', status: null, claimText: '다른 말', projectMention: '원문에 없는 이름' };
  assert.throws(() => store.save({ itemId: first.item.itemId, decision: 'EDIT',
    gold: { disposition: 'EXTRACTED', semanticFamily: 'project', payload, evidenceTurnIds: [first.item.anchor.turnId] } }), /MENTION_NOT_IN_EVIDENCE/);
  assert.throws(() => store.save({ itemId: first.item.itemId, decision: 'NO_STORE', gold: { disposition: 'DEFERRED' } }), /INVALID_LABEL/);
  store.save({ itemId: first.item.itemId, decision: 'NO_STORE', gold: null, reason: '요청 앵커' });
  const previous = store.next('');
  assert.equal(previous.item.itemId, first.item.itemId); assert.equal(previous.label.decision, 'NO_STORE'); assert.equal(previous.label.reason, '요청 앵커');
  assert.equal(store.next().labeled, 1);
  assert.equal(fs.existsSync(path.join(out, 'labels-eval.jsonl')), false);
  assert.equal(fs.statSync(path.join(out, 'labels-train.jsonl')).mode & 0o777, 0o600);
});

test('the durability queue shows what Luna dropped and keeps its labels apart', async t => {
  const { out } = prepared(t);
  const dropped = { ...stages, assessDurability: async () => ({ disposition: 'NO_WRITE', reason: '일시적' }), selectBundles: async request => {
    const turns = JSON.parse(request.input).turns;
    return { anchors: [{ turnId: turns[0].turnId, text: turns[0].text }] };
  } };
  await draft(out, 'train', 1, { stages: dropped, selectBundles: dropped.selectBundles });
  assert.equal(createLabelStore(out, 'train').next().total, 0);
  const store = createLabelStore(out, 'train', 'durability');
  const view = store.next();
  assert.equal(view.total, 1); assert.equal(view.item.draft, null);
  assert.throws(() => store.save({ itemId: view.item.itemId, decision: 'APPROVE' }), /INVALID_LABEL/);
  store.save({ itemId: view.item.itemId, decision: 'NO_STORE', gold: null });
  assert.equal(store.next().labeled, 1);
  assert.equal(fs.existsSync(path.join(out, 'labels-train-durability.jsonl')), true);
  assert.equal(fs.existsSync(path.join(out, 'labels-train.jsonl')), false);
});

test('earlier reports are reused only for the byte-identical episode', async t => {
  const { dir, out } = prepared(t);
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  const earlierDir = path.join(dir, 'earlier'); fs.mkdirSync(earlierDir, { mode: 0o700 });
  const [hit, miss] = manifest.episodes.filter(e => e.split === 'eval');
  writePrivateArtifact(path.join(earlierDir, 'manifest.json'), { episodes: [hit, { ...miss, episodeSha256: 'x' }] });
  for (const n of ['01', '02']) writePrivateArtifact(path.join(earlierDir, `episode-${n}.report.json`), { results: [] });
  assert.deepEqual(importReports(out, earlierDir, earlierDir), { imported: 1 });
  assert.equal(fs.existsSync(path.join(out, 'reports', `${hit.episodeId}.json`)), true);
  assert.equal(fs.existsSync(path.join(out, 'reports', `${miss.episodeId}.json`)), false);
});

test('label server needs its token and local origin, and round-trips a decision', async t => {
  const { out } = await drafted(t);
  const server = createLabelServer(createLabelStore(out, 'train'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const view = await (await fetch(`${base}/api/next`)).json();
  assert.equal((await fetch(`${base}/api/label`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  const token = (await (await fetch(`${base}/app.js`)).text()).match(/TOKEN="([a-f0-9]+)"/)[1];
  const saved = await fetch(`${base}/api/label`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Label-Token': token }, body: JSON.stringify({ itemId: view.item.itemId, decision: 'APPROVE' }) });
  assert.equal(saved.status, 200);
  assert.equal((await (await fetch(`${base}/api/next`)).json()).labeled, 1);
});
