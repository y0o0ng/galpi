'use strict';

// Anchor-quality follow-up for aebbf047 (5 REANCHOR) and 869c7127 (4 PASS). Structure only; the
// fresh audit and v3 review judge the reanchored bundles.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { computeFragments, decodeSpan } = require('../lib/memory-inference-p1b6-surfaces');
const builder = require('../scripts/build-memory-inference-p1b6-batch-003-anchor-quality-resolution');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, 'fixtures', file));
const artifacts = () => builder.verifySources(builder.loadSources());
const receipt = JSON.parse(read(builder.RECEIPT_FILE));
const candidate = JSON.parse(read(builder.CANDIDATE_FILE));
const SK_REANCHOR = 'p1b6-sk-aebbf047d6864a35';
const SK_PASS = 'p1b6-sk-869c71279b6b8a33';
const item = number => `p1b6-item-b003-${number}`;
const historicalItem = (current, id) => current.batch.items.find(row => row.itemId === id);
const historicalEpisode = (current, id) => current.batch.sourceEpisodes.find(row => row.sourceEpisodeId === id);

test('committed artifacts are exactly the builder output', () => {
  const { receipt: builtReceipt, candidate: builtCandidate } = builder.buildArtifacts(artifacts());
  assert.deepEqual(builder.artifactBytes(builtReceipt), read(builder.RECEIPT_FILE));
  assert.deepEqual(builder.artifactBytes(builtCandidate), read(builder.CANDIDATE_FILE));
});

test('nine rows: five REANCHOR on aebbf047, four PASS on 869c7127', () => {
  assert.equal(receipt.rows.length, 9);
  const reanchor = receipt.rows.filter(row => row.disposition === 'REANCHOR');
  const pass = receipt.rows.filter(row => row.disposition === 'ANCHOR_QUALITY_PASS');
  assert.deepEqual(reanchor.map(row => row.itemId), ['224', '225', '226', '227', '228'].map(item));
  assert.deepEqual(pass.map(row => row.itemId), ['192', '193', '194', '195'].map(item));
  assert.equal(reanchor.every(row => row.semanticSkeletonId === SK_REANCHOR), true);
  assert.equal(pass.every(row => row.semanticSkeletonId === SK_PASS && !Object.hasOwn(row, 'approvedAnchorText')), true);
  assert.deepEqual(receipt.summary, { total: 9, REANCHOR: 5, ANCHOR_QUALITY_PASS: 4 });
});

test('population drift or a relabelled skeleton fails closed', () => {
  const current = artifacts();
  const dropped = structuredClone(current);
  dropped.batch.items = dropped.batch.items.filter(row => row.itemId !== item('195'));
  assert.throws(() => builder.deriveRows(dropped), /population drifted/);
  const relabelled = structuredClone(current);
  relabelled.v3.candidates.find(row => row.semanticSkeletonId === SK_REANCHOR).humanLabel = 'ESCALATE';
  assert.throws(() => builder.deriveRows(relabelled), /not the frozen active v3 CLEAR skeleton/);
  const moved = structuredClone(current);
  historicalItem(moved, item('192')).anchorSpanRef.startByte += 1;
  assert.throws(() => builder.deriveRows(moved), /current anchor drifted/);
});

test('recorded current anchors decode from the historical bytes', () => {
  const current = artifacts();
  for (const row of receipt.rows) {
    const old = historicalItem(current, row.itemId);
    const turn = historicalEpisode(current, old.sourceEpisodeId).turns.find(entry => entry.turnId === old.anchorSpanRef.turnId);
    assert.equal(decodeSpan(turn.text, old.anchorSpanRef), row.currentAnchorText, row.itemId);
  }
});

test('869c7127 rows are untouched and have no candidate copy', () => {
  assert.equal(candidate.items.some(row => row.semanticSkeletonId === SK_PASS), false);
  assert.equal(JSON.stringify(candidate).includes(SK_PASS), false);
  assert.equal(sha256RawBytes(read(builder.SOURCES.batch.fixture)), builder.SOURCES.batch.rawSha256);
});

test('reanchored rows: approved text, exact decode, inside the old evidence, only anchorSpanRef changed', () => {
  const current = artifacts();
  assert.deepEqual(candidate.items.map(row => [row.itemId, decodeSpan(
    candidate.sourceEpisodes.find(ep => ep.sourceEpisodeId === row.sourceEpisodeId)
      .turns.find(turn => turn.turnId === row.anchorSpanRef.turnId).text, row.anchorSpanRef)]), [
    [item('224'), '이번 출장비'],
    [item('225'), '이번 프로젝트 인력'],
    [item('226'), '재고'],
    [item('227'), '이번 달 광고 예산'],
    [item('228'), '내 연차'],
  ]);
  for (const row of candidate.items) {
    const old = historicalItem(current, row.itemId);
    const { anchorSpanRef, ...rest } = row;
    const { anchorSpanRef: oldAnchor, ...oldRest } = old;
    assert.deepEqual(rest, oldRest, row.itemId);
    assert.notDeepEqual(anchorSpanRef, oldAnchor, row.itemId);
    assert.equal(old.evidenceSpanRefs.some(span => span.turnId === anchorSpanRef.turnId
      && span.startByte <= anchorSpanRef.startByte && span.endByte >= anchorSpanRef.endByte), true, row.itemId);
    const episode = candidate.sourceEpisodes.find(ep => ep.sourceEpisodeId === row.sourceEpisodeId);
    assert.deepEqual(episode, historicalEpisode(current, row.sourceEpisodeId), row.itemId);
    assert.equal(computeFragments(row, episode).length, computeFragments(old, episode).length, row.itemId);
  }
});

test('no historical provenance transfers; fresh gates are pending; no authority is claimed', () => {
  for (const row of candidate.items) {
    for (const key of ['disposition', 'decision', 'provenance', 'eligibility', 'referenceLabel', 'auditRowId']) {
      assert.equal(Object.hasOwn(row, key), false, key);
    }
  }
  assert.deepEqual(candidate.pending,
    { freshSourceAudit: true, freshV3SemanticReview: true, humanAdjudicationWhereRouted: true });
  assert.equal(candidate.status, 'ANCHOR_REPAIR_CANDIDATE_AWAITING_FRESH_SOURCE_AUDIT_AND_V3_REVIEW');
  for (const [key, value] of Object.entries(candidate.authority)) assert.equal(value, false, key);
  for (const [key, value] of Object.entries(receipt.authority)) assert.equal(value, false, key);
});

test('pinned inputs, v3 and the accepted pool are unchanged', () => {
  for (const pinned of Object.values(builder.SOURCES)) {
    assert.equal(sha256RawBytes(read(pinned.fixture)), pinned.rawSha256, pinned.fixture);
  }
  assert.equal(receipt.acceptedPool.cumulativeAcceptedSurfacePool, 93);
  assert.equal(JSON.parse(read('local-memory-inference-p1b6-batch-002-acceptance.json'))
    .corpusGrowth.cumulativeAcceptedSurfacePool, 93);
});
