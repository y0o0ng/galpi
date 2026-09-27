'use strict';

// First fresh realizations of the v3 replacement skeletons 53ab6351 / 0768ea20. These tests pin
// structure and authored shape only; semantic ambiguity is for the fresh audit and v3 review.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { computeFragments, decodeSpan } = require('../lib/memory-inference-p1b6-surfaces');
const { renderCandidateBundle } = require('../scripts/build-memory-inference-p1b6-surface-repair-source-audit-packet');
const builder = require('../scripts/build-memory-inference-p1b6-v3-replacement-candidate');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, 'fixtures', file));
const artifacts = () => builder.verifySources(builder.loadSources());
const candidate = JSON.parse(read(builder.CANDIDATE_FILE));
const SK_WORK = 'p1b6-sk-53ab63517113df16';
const SK_AXIS = 'p1b6-sk-0768ea2028f18511';
const itemOn = skeletonId => candidate.items.find(row => row.semanticSkeletonId === skeletonId);
const episodeOf = row => candidate.sourceEpisodes.find(entry => entry.sourceEpisodeId === row.sourceEpisodeId);

test('committed fixture bytes are exactly the builder output', () => {
  assert.deepEqual(builder.artifactBytes(builder.buildCandidate(artifacts())), read(builder.CANDIDATE_FILE));
});

test('exactly two fresh candidates, one per replacement skeleton', () => {
  assert.equal(candidate.items.length, 2);
  assert.equal(candidate.sourceEpisodes.length, 2);
  assert.deepEqual(candidate.items.map(row => row.semanticSkeletonId).toSorted(), [SK_AXIS, SK_WORK].toSorted());
  const doubled = structuredClone(builder.AUTHORED);
  doubled[1].semanticSkeletonId = SK_WORK;
  assert.throws(() => builder.buildCandidate(artifacts(), doubled), /exactly one row per replacement skeleton/);
});

test('both skeletons are active v3 TRAIN / APPROXIMATION / RANGE / ESCALATE with their contrast slots', () => {
  const current = artifacts();
  const retired = new Set(current.v3.retiredSkeletons.map(row => row.retiredSkeletonId));
  for (const id of [SK_WORK, SK_AXIS]) {
    const skeleton = current.v3.candidates.find(row => row.semanticSkeletonId === id);
    assert.equal(retired.has(id), false);
    assert.deepEqual([skeleton.splitAssignment, skeleton.boundaryClass, skeleton.humanLabel],
      ['TRAIN', 'APPROXIMATION / RANGE', 'ESCALATE']);
    assert.equal(episodeOf(itemOn(id)).splitAssignment, 'TRAIN');
  }
  assert.equal(current.v3.candidates.find(row => row.semanticSkeletonId === SK_WORK).contrastGroupId,
    'p1b6-cg-084af1a6a0723538');
  assert.equal(Object.hasOwn(current.v3.candidates.find(row => row.semanticSkeletonId === SK_AXIS), 'contrastGroupId'), false);
  const relabelled = structuredClone(current);
  relabelled.v3.candidates.find(row => row.semanticSkeletonId === SK_AXIS).humanLabel = 'CLEAR';
  assert.throws(() => builder.buildCandidate(relabelled), /not the frozen active v3 replacement skeleton/);
});

test('no retired skeleton, historical ID or review provenance is carried', () => {
  const text = JSON.stringify(candidate);
  for (const retired of ['p1b6-sk-f58debd8f04f5c60', 'p1b6-sk-28736b74c85fcc93']) {
    assert.equal(text.includes(retired), false, retired);
  }
  const current = artifacts();
  const known = new Set([current.batch, current.repairCandidate, current.targetBoundaryCandidate]
    .flatMap(artifact => [...artifact.items.flatMap(row => [row.itemId, row.surfaceFamilyId]),
      ...artifact.sourceEpisodes.flatMap(row => [row.sourceEpisodeId, row.sourceFamilyId])]));
  for (const row of candidate.items) {
    const episode = episodeOf(row);
    for (const id of [row.itemId, row.surfaceFamilyId, episode.sourceEpisodeId, episode.sourceFamilyId]) {
      assert.match(id, /-rp1-\d{3}$/u);
      assert.equal(known.has(id), false, id);
    }
    for (const key of ['provenance', 'humanDecision', 'referenceLabel', 'eligibility', 'disposition', 'targetAnchorRole']) {
      assert.equal(Object.hasOwn(row, key), false, key);
    }
  }
  // Historical retired-sibling text is not reused.
  const siblings = new Set(current.batch.items
    .filter(row => ['p1b6-sk-f58debd8f04f5c60', 'p1b6-sk-28736b74c85fcc93'].includes(row.semanticSkeletonId))
    .map(row => row.sourceEpisodeId));
  const oldTurns = new Set(current.batch.sourceEpisodes.filter(row => siblings.has(row.sourceEpisodeId))
    .flatMap(row => row.turns.map(turn => turn.text)));
  for (const episode of candidate.sourceEpisodes) {
    for (const turn of episode.turns) assert.equal(oldTurns.has(turn.text), false, turn.text);
  }
  for (const [key, value] of Object.entries(candidate.authority)) assert.equal(value, false, key);
  assert.deepEqual(candidate.pending,
    { freshSourceAudit: true, freshV3SemanticReview: true, humanAdjudicationWhereRouted: true });
  assert.equal(candidate.status, 'FRESH_REALIZATION_CANDIDATE_AWAITING_SOURCE_AUDIT_AND_V3_REVIEW');
});

test('anchors decode exactly, sit inside selected evidence, and render as one TARGET', () => {
  for (const row of candidate.items) {
    const episode = episodeOf(row);
    const turn = episode.turns.find(entry => entry.turnId === row.anchorSpanRef.turnId);
    assert.equal(decodeSpan(turn.text, row.anchorSpanRef), row.anchorText);
    assert.equal(row.evidenceSpanRefs.some(span => span.turnId === row.anchorSpanRef.turnId), true);
    const fragments = computeFragments(row, episode).length;
    assert.equal(fragments >= 1 && fragments <= 5, true);
    const bundle = renderCandidateBundle(candidate, row);
    assert.equal(bundle.split('[TARGET]').length, 2);
    assert.equal(bundle.includes(`[TARGET]${row.anchorText}[/TARGET]`), true);
  }
});

test('cross-batch leakage is rejected', () => {
  const current = artifacts();
  const reused = structuredClone(builder.AUTHORED);
  reused[0].turns[0][1] = current.batch.sourceEpisodes.flatMap(row => row.turns).find(turn => turn.text.length > 20).text;
  assert.throws(() => builder.buildCandidate(current, reused), /reused/);
});

test('53ab6351: work-vs-time readings, both dimensions active, TARGET names neither', () => {
  const row = itemOn(SK_WORK);
  assert.deepEqual(row.intendedUnresolvedReadings, ['작업량이 약 절반 남아 있음', '마감까지 주어진 시간이 약 절반 남아 있음']);
  assert.match(row.anchorText, /반/);
  for (const word of ['작업', '일', '기간', '시간', '주', '마감', '개']) {
    assert.equal(row.anchorText.includes(word), false, word);
  }
  const visible = episodeOf(row).turns.map(turn => turn.text).join(' ');
  assert.match(visible, /작업이 20개/);
  assert.match(visible, /4주/);
});

test('0768ea20: horizontal-vs-vertical readings, both axes visible, TARGET has amount and unit only', () => {
  const row = itemOn(SK_AXIS);
  assert.deepEqual(row.intendedUnresolvedReadings, ['가로 차이가 약 5cm', '세로 차이가 약 5cm']);
  assert.match(row.anchorText, /5cm/);
  for (const word of ['가로', '세로', '높이', '폭', '너비', '길이가']) {
    assert.equal(row.anchorText.includes(word), false, word);
  }
  const visible = episodeOf(row).turns.map(turn => turn.text).join(' ');
  assert.match(visible, /가로 60cm/);
  assert.match(visible, /세로 35cm/);
});

test('v3 catalog, v3 receipt and the accepted pool are unchanged', () => {
  for (const pinned of Object.values(builder.SOURCES)) {
    assert.equal(sha256RawBytes(read(pinned.fixture)), pinned.rawSha256, pinned.fixture);
  }
  const acceptance = JSON.parse(read('local-memory-inference-p1b6-batch-002-acceptance.json'));
  assert.equal(sha256RawBytes(read('local-memory-inference-p1b6-batch-002-acceptance.json')),
    'c03b8dcf4ddcb2c5f8b193cde8247b9ad64b8ea676da51cab1d709795b273598');
  assert.equal(acceptance.corpusGrowth.cumulativeAcceptedSurfacePool, 93);
});
