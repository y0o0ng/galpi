'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sampleEpisodes, scoringTemplate, score } = require('../lib/memory-storage/formation-step1');
const { attachAnchorWindows, buildAnchorDiscoveryRequest } = require('../lib/memory-storage/bundle-builder');
const { runFormationEpisode } = require('../lib/memory-storage/formation-runner');

function episode(n) {
  return { schemaVersion: 1, sourceDomain: 'conversation_message', sessionId: 'shared-main', firstMessageId: 1, lastMessageId: n,
    turns: Array.from({ length: n }, (_, i) => ({ turnId: `m${i + 1}`, messageId: i + 1,
      role: 'USER', text: `unique ${i + 1}`, createdAt: i })) };
}
test('sampler splits at 30 minutes, filters size and excluded IDs, and orders deterministically', () => {
  const rows = [];
  let time = 0;
  for (const [start, count] of [[1, 6], [20, 5], [40, 25], [1684, 6], [100, 6], [120, 6]]) {
    for (let i = 0; i < count; i++) rows.push({ id: start + i, created_at: time + i });
    time += count - 1 + 1800;
  }
  const result = sampleEpisodes(rows);
  assert.deepEqual(new Set(result.map(x => x.firstMessageId)), new Set([1, 100, 120]));
  assert.deepEqual(result, sampleEpisodes(rows));
  const crypto = require('node:crypto');
  const hashes = result.map(x => crypto.createHash('sha256').update(`formation-loop-step1-v1\0${x.firstMessageId}\0${x.lastMessageId}`).digest('hex'));
  assert.deepEqual(hashes, [...hashes].sort());
});
test('fixed windows use whole short episode and clipped long window; anchors must be unique', () => {
  const get = (n, turnId) => attachAnchorWindows(episode(n), { anchors: [{ turnId, text: `unique ${turnId.slice(1)}` }] }).bundles[0].evidenceSpanRefs.map(x => x.turnId);
  assert.equal(get(16, 'm1').length, 16);
  assert.deepEqual(get(17, 'm1'), ['m1', 'm2', 'm3', 'm4', 'm5']);
  assert.equal(get(17, 'm9').length, 9);
  assert.deepEqual(get(17, 'm17'), ['m13', 'm14', 'm15', 'm16', 'm17']);
  const e = episode(6); e.turns[0].text = 'repeat repeat';
  assert.throws(() => attachAnchorWindows(e, { anchors: [{ turnId: 'm1', text: 'repeat' }] }), /ANCHOR_NOT_UNIQUE/);
  assert.equal(buildAnchorDiscoveryRequest(e).promptVersion, 'memory-anchor-discovery-user-state-v1');
});
test('anchors pass unchanged formation runner with fixed evidence', async () => {
  const result = await runFormationEpisode(episode(17), { anchorWindows: true,
    selectBundles: async () => ({ anchors: [{ turnId: 'm1', text: 'unique 1' }] }),
    assessAmbiguity: async ({ evidence }) => { assert.equal(evidence.length, 5); return { disposition: 'ESCALATE', reason: 'test' }; },
    assessDurability: async () => {}, extractCandidate: async () => {}, prepareReview: async () => {} });
  assert.equal(result.results[0].status, 'MEANING_DEFERRED');
});
test('scoring counts duplicates and enforces both gates', () => {
  const ref = '## episode-01\n\n기억할 것:\n- first\n- second\n';
  const discoveries = [{ episode: '01', bundles: [{ bundleId: 'a' }, { bundleId: 'b' }] }];
  const s = scoringTemplate(ref, discoveries);
  s.references[0].coveringAnchor = 'episode-01-anchor-1'; s.references[1].coveringAnchor = 'episode-01-anchor-2';
  s.anchors[0].scope = 'IN'; s.anchors[1].scope = 'IN'; s.anchors[1].duplicateOf = s.anchors[0].id;
  assert.equal(score(ref, discoveries, s).duplicateAnchors, 1);
  assert.equal(score(ref, discoveries, s).gate, 'PASS');
  s.anchors[1].scope = 'OUT'; assert.equal(score(ref, discoveries, s).gate, 'FAIL');
  s.anchors[1].scope = 'IN'; s.references[1].coveringAnchor = 'MISSED'; assert.equal(score(ref, discoveries, s).gate, 'FAIL');
});
test('sampling and private reference lifecycle use synthetic SQLite and preserve frozen hash', () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const Database = require('better-sqlite3'); const { main } = require('../lib/memory-storage/formation-step1');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'formation-step1-')); fs.chmodSync(dir, 0o700);
  try {
    const dbPath = path.join(dir, 'source.db'); const db = new Database(dbPath);
    db.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, created_at INTEGER)');
    const insert = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?)');
    const start = Date.parse('2026-08-01T00:00:00+09:00') / 1000;
    for (let group = 0; group < 15; group++) for (let i = 0; i < 6; i++) {
      const id = group * 10 + i + 1;
      insert.run(id, 'shared-main', 'user', `synthetic ${id}`, start + group * 2000 + i);
    }
    db.close();
    const manifest = main(['sample', dbPath, dir]); assert.equal(manifest.episodes.length, 15);
    const ref = path.join(dir, 'references.md'); main(['template', dir, ref]);
    assert.equal(fs.statSync(ref).mode & 0o777, 0o600);
    const frozen = path.join(dir, 'freeze.json'); const digest = main(['freeze', ref, frozen]);
    assert.equal(digest.sha256.length, 64);
    assert.throws(() => main(['freeze', ref, frozen]), /EEXIST/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
