'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const surfaces = require('../lib/memory-inference-p1b6-surfaces');
const audit = require('../scripts/build-memory-inference-p1b6-source-audit-packet');

const ROOT = path.resolve(__dirname, '..');
const fixture = file => path.join(ROOT, 'fixtures', file);
const read = file => fs.readFileSync(fixture(file));
const readJson = file => JSON.parse(read(file));
const BATCH_001 = 'local-memory-inference-p1b6-surface-batch-001.json';
const BATCH_002 = 'local-memory-inference-p1b6-surface-batch-002.json';
const PROTOCOL_002 = 'local-memory-inference-p1b6-surface-batch-002-authoring-protocol.json';
const ACCEPTANCE = 'local-memory-inference-p1b6-smoke-batch-001-acceptance.json';
const EXACT56 = 'local-memory-inference-p1b6-skeleton-exact56.json';
const rawBatch002 = read(BATCH_002);
const batch001 = readJson(BATCH_001);
const batch002 = JSON.parse(rawBatch002);
const protocol = readJson(PROTOCOL_002);
const acceptance = readJson(ACCEPTANCE);
const exact56 = readJson(EXACT56);
const skeletons = new Map(exact56.candidates.map(row => [row.semanticSkeletonId, row]));
const PRE_NATURALNESS_ITEMS_SHA256 = '82667f84fe81bb70941a9ff80ca26e83ace0c063cb8576ccce2fb5ffe7a92794';
const PRE_NATURALNESS_BUNDLES_SHA256 = 'c80817d06a6d7f5fb4198533310748f4f3a7d673c1c45007770b60e1a18b10cb';
const PRE_NATURALNESS_TURN_STRUCTURE_SHA256 = '8934a22407461a016f7bafa3b6b2a0c597e2dc4f47829f72db14451c207bbd54';
const PRE_NATURALNESS_BATCH_SHA256 = 'db212aae0c1e5c5943cfe68b15cfa106f7a1cc8bd454a8d30320ab0c6a290456';

const ORDERS = {
  splits: ['TRAIN', 'DEV', 'FINAL_HELD_OUT'],
  labels: ['CLEAR', 'ESCALATE'],
  languages: ['KO', 'MIXED', 'EN'],
  fragments: ['1', '2', '3', '4', '5'],
};

function counts(values, order) {
  return Object.fromEntries(order.map(key => [key, values.filter(value => String(value) === key).length]));
}

function largestRemainder(finalTargets, current, size, order) {
  const deficits = Object.fromEntries(order.map(key => [key,
    Math.max(0, finalTargets[key] - current[key])]));
  const totalDeficit = Object.values(deficits).reduce((sum, value) => sum + value, 0);
  const result = {};
  const fractions = [];
  let allocated = 0;
  for (const [canonicalIndex, key] of order.entries()) {
    const raw = size * deficits[key] / totalDeficit;
    result[key] = Math.floor(raw);
    allocated += result[key];
    fractions.push({ key, fraction: raw - result[key], canonicalIndex });
  }
  fractions.sort((left, right) => right.fraction - left.fraction
    || left.canonicalIndex - right.canonicalIndex);
  for (let index = 0; index < size - allocated; index += 1) result[fractions[index].key] += 1;
  return result;
}

function acceptedSeedCoverage() {
  const items = new Map(batch001.items.map(item => [item.itemId, item]));
  const episodes = new Map(batch001.sourceEpisodes.map(episode => [episode.sourceEpisodeId, episode]));
  const acceptedItems = acceptance.accepted.map(row => items.get(row.itemId));
  const semanticSkeletons = Object.fromEntries(exact56.candidates.map(row => [row.semanticSkeletonId, 0]));
  for (const item of acceptedItems) semanticSkeletons[item.semanticSkeletonId] += 1;
  return {
    total: acceptedItems.length,
    splits: counts(acceptedItems.map(item => skeletons.get(item.semanticSkeletonId).splitAssignment), ORDERS.splits),
    skeletonAuthoringLabels: counts(acceptedItems.map(item =>
      skeletons.get(item.semanticSkeletonId).humanLabel), ORDERS.labels),
    semanticSkeletons,
    languages: counts(acceptedItems.map(item => episodes.get(item.sourceEpisodeId).language), ORDERS.languages),
    fragments: counts(acceptedItems.map(item => surfaces.computeFragments(
      item, episodes.get(item.sourceEpisodeId),
    ).length), ORDERS.fragments),
    boundaryClasses: counts(acceptedItems.map(item =>
      skeletons.get(item.semanticSkeletonId).boundaryClass), surfaces.BOUNDARY_CLASSES),
  };
}

function expectedSkeletonPlan(coverage, splitTargets, labelTargets) {
  const planned = new Map(exact56.candidates.map(row => [row.semanticSkeletonId, 0]));
  for (const split of ORDERS.splits) {
    const cellTargets = largestRemainder(labelTargets, { CLEAR: 0, ESCALATE: 0 },
      splitTargets[split], ORDERS.labels);
    for (const label of ORDERS.labels) {
      const candidates = exact56.candidates.filter(row =>
        row.splitAssignment === split && row.humanLabel === label);
      const zeroCoverage = candidates.filter(row => coverage.semanticSkeletons[row.semanticSkeletonId] === 0)
        .toSorted((left, right) => left.semanticSkeletonId.localeCompare(right.semanticSkeletonId));
      for (const row of zeroCoverage) planned.set(row.semanticSkeletonId, 1);
      let cellCount = zeroCoverage.length;
      while (cellCount < cellTargets[label]) {
        const chosen = candidates.toSorted((left, right) =>
          coverage.semanticSkeletons[left.semanticSkeletonId]
            - coverage.semanticSkeletons[right.semanticSkeletonId]
          || planned.get(left.semanticSkeletonId) - planned.get(right.semanticSkeletonId)
          || left.semanticSkeletonId.localeCompare(right.semanticSkeletonId))[0];
        planned.set(chosen.semanticSkeletonId, planned.get(chosen.semanticSkeletonId) + 1);
        cellCount += 1;
      }
    }
  }
  return planned;
}

function normalizedConversation(turns) {
  return turns.map(turn => `${turn.role}:${turn.text.normalize('NFKC').toLowerCase()
    .replace(/\p{N}+/gu, '#').replace(/[^\p{L}#]+/gu, '')}`).join('|');
}

function jsonSha256(value) {
  return sha256RawBytes(Buffer.from(JSON.stringify(value)));
}

test('batch-002 validates as the 64-item current adaptive-growth tranche', () => {
  assert.equal(batch002.name, 'xion-local-memory-inference-p1b6-surface-batch-002-v1');
  assert.equal(batch002.batchId, 'p1b6-surface-batch-002');
  assert.equal(batch002.items.length, 64);
  assert.equal(batch002.sourceEpisodes.length, 64);
  assert.equal(surfaces.validateSurfaceBatch(batch002), batch002);
  assert.equal(protocol.outputBatch.sha256, sha256RawBytes(rawBatch002));
  assert.equal(protocol.trancheSize, 64);
  assert.equal(protocol.authority.sourceAuditCompleted, false);
  assert.equal(protocol.authority.humanReviewCompleted, false);
  assert.equal(protocol.authority.finalCorpusHumanGoldFrozen, false);
  assert.equal(protocol.authority.trainingOccurred, false);
  assert.equal(jsonSha256(batch002.items), PRE_NATURALNESS_ITEMS_SHA256);
  assert.equal(jsonSha256(batch002.items.map(item =>
    surfaces.renderHumanReviewText(batch002, item))), PRE_NATURALNESS_BUNDLES_SHA256);
  assert.equal(jsonSha256(batch002.sourceEpisodes.map(episode => ({
    sourceEpisodeId: episode.sourceEpisodeId,
    turns: episode.turns.map(turn => ({ turnId: turn.turnId, role: turn.role })),
  }))), PRE_NATURALNESS_TURN_STRUCTURE_SHA256);
});

test('accepted seed coverage and all tranche marginals are mechanically derived and satisfied', () => {
  const coverage = acceptedSeedCoverage();
  assert.deepEqual(protocol.acceptedSeedCoverage, coverage);
  assert.equal(coverage.total, 30);
  const zeroCoverage = new Set(exact56.candidates.filter(row =>
    coverage.semanticSkeletons[row.semanticSkeletonId] === 0).map(row => row.semanticSkeletonId));
  assert.equal(zeroCoverage.size, 26);
  assert.equal(protocol.zeroAcceptedSkeletonCount, 26);
  const batchSkeletonIds = new Set(batch002.items.map(item => item.semanticSkeletonId));
  for (const skeletonId of zeroCoverage) assert.equal(batchSkeletonIds.has(skeletonId), true);

  const splitTargets = largestRemainder(
    { TRAIN: 240, DEV: 60, FINAL_HELD_OUT: 80 }, coverage.splits, 64, ORDERS.splits,
  );
  const labelTargets = largestRemainder(
    { CLEAR: 190, ESCALATE: 190 }, coverage.skeletonAuthoringLabels, 64, ORDERS.labels,
  );
  const languageTargets = largestRemainder(
    { KO: 266, MIXED: 76, EN: 38 }, coverage.languages, 64, ORDERS.languages,
  );
  const fragmentTargets = largestRemainder(
    { 1: 70, 2: 100, 3: 120, 4: 70, 5: 20 }, coverage.fragments, 64, ORDERS.fragments,
  );
  const summary = surfaces.summarizeSurfaceBatch(batch002);
  assert.deepEqual(protocol.trancheTargets.splits, splitTargets);
  assert.deepEqual(summary.splits, splitTargets);
  assert.deepEqual(protocol.trancheTargets.skeletonAuthoringLabels, labelTargets);
  assert.deepEqual(counts(batch002.items.map(item =>
    skeletons.get(item.semanticSkeletonId).humanLabel), ORDERS.labels), labelTargets);
  assert.deepEqual(protocol.trancheTargets.languages, languageTargets);
  assert.deepEqual(summary.languages, languageTargets);
  assert.deepEqual(protocol.trancheTargets.fragments, fragmentTargets);
  assert.deepEqual(summary.fragments, fragmentTargets);
  assert.deepEqual(summary.discoursePatterns, protocol.trancheTargets.discoursePatterns);
  assert.ok(Object.values(summary.discoursePatterns).every(value => value === 8));

  const expectedPlan = expectedSkeletonPlan(coverage, splitTargets, labelTargets);
  assert.deepEqual(counts(batch002.items.map(item => item.semanticSkeletonId),
    [...expectedPlan.keys()]), Object.fromEntries(expectedPlan));
});

test('batch-002 identities, conversations, and families do not leak across batches or splits', () => {
  for (const [current, prior] of [
    [batch002.items.map(row => row.itemId), batch001.items.map(row => row.itemId)],
    [batch002.sourceEpisodes.map(row => row.sourceEpisodeId), batch001.sourceEpisodes.map(row => row.sourceEpisodeId)],
    [batch002.sourceEpisodes.map(row => row.sourceFamilyId), batch001.sourceEpisodes.map(row => row.sourceFamilyId)],
    [batch002.items.map(row => row.surfaceFamilyId), batch001.items.map(row => row.surfaceFamilyId)],
  ]) {
    assert.equal(new Set(current).size, current.length);
    const priorSet = new Set(prior);
    assert.ok(current.every(value => !priorSet.has(value)));
  }
  assert.ok(batch002.items.every(row => /^p1b6-item-b002-/u.test(row.itemId)
    && /^p1b6-se-b002-/u.test(row.sourceEpisodeId)
    && /^p1b6-surface-family-b002-/u.test(row.surfaceFamilyId)));
  assert.ok(batch002.sourceEpisodes.every(row => /^p1b6-se-b002-/u.test(row.sourceEpisodeId)
    && /^p1b6-sf-b002-/u.test(row.sourceFamilyId)));

  const priorConversations = new Set(batch001.sourceEpisodes.map(row => normalizedConversation(row.turns)));
  const pilot = readJson('local-memory-inference-p1b6-anchor-marker-pilot.json');
  for (const row of pilot.cases) priorConversations.add(normalizedConversation(row.turns));
  const currentConversations = batch002.sourceEpisodes.map(row => normalizedConversation(row.turns));
  assert.equal(new Set(currentConversations).size, currentConversations.length);
  assert.ok(currentConversations.every(value => !priorConversations.has(value)));

  const episodes = new Map(batch002.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  const sourceSplits = new Map();
  const surfaceSplits = new Map();
  for (const episode of batch002.sourceEpisodes) {
    assert.equal(sourceSplits.get(episode.sourceFamilyId) || episode.splitAssignment,
      episode.splitAssignment);
    sourceSplits.set(episode.sourceFamilyId, episode.splitAssignment);
  }
  for (const item of batch002.items) {
    const split = episodes.get(item.sourceEpisodeId).splitAssignment;
    assert.equal(split, skeletons.get(item.semanticSkeletonId).splitAssignment);
    assert.equal(surfaceSplits.get(item.surfaceFamilyId) || split, split);
    surfaceSplits.set(item.surfaceFamilyId, split);
  }
});

test('batch-002 does not reuse exact sentence-length source scaffolding across episodes', () => {
  const seen = new Map();
  for (const episode of batch002.sourceEpisodes) {
    for (const turn of episode.turns) {
      const normalized = turn.text.normalize('NFKC').trim();
      // Twelve Unicode code points catches sentence-like stock turns while allowing short acknowledgements.
      if (Array.from(normalized).length < 12) continue;
      assert.equal(seen.has(normalized), false,
        `non-trivial exact turn reused across ${seen.get(normalized)} and ${episode.sourceEpisodeId}`);
      seen.set(normalized, episode.sourceEpisodeId);
    }
  }
});

test('batch-002 evidence, anchors, fragments, and renderer stay canonical', () => {
  assert.equal(sha256RawBytes(fs.readFileSync(path.join(ROOT,
    'lib/memory-inference-p1b6-surfaces.js'))),
  '4b6dabf2280529b138efe124f32252c2ff7a2b9a118d7eb2c2b3341c7c56f1b7');
  assert.equal(surfaces.RENDERER_IDENTITY, 'xion-local-memory-inference-p1b6-surface-renderer-v1');
  const episodes = new Map(batch002.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  for (const item of batch002.items) {
    const episode = episodes.get(item.sourceEpisodeId);
    assert.ok(item.evidenceSpanRefs.some(span => span.turnId === item.anchorSpanRef.turnId
      && span.startByte <= item.anchorSpanRef.startByte && span.endByte >= item.anchorSpanRef.endByte));
    assert.ok([1, 2, 3, 4, 5].includes(surfaces.computeFragments(item, episode).length));
    const rendered = surfaces.renderHumanReviewText(batch002, item);
    assert.equal((rendered.match(/\[TARGET\]/gu) || []).length, 1);
    assert.equal((rendered.match(/\[\/TARGET\]/gu) || []).length, 1);
  }
});

test('batch-002 source-audit attempt-001 packet is fresh, complete, and unrun', () => {
  const batchSha256 = sha256RawBytes(rawBatch002);
  const packet = audit.buildAuditPacket(rawBatch002);
  const packetBytes = Buffer.from(`${JSON.stringify(packet, null, 2)}\n`);
  const episodes = new Map(batch002.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  assert.equal(batchSha256, '552a11e4c976c514f27ee36afe0fa5546dcc921a465b24180c831771f9d02334');
  assert.equal(sha256RawBytes(packetBytes),
    'fb3f40c471299aeed79a5cab4da588e8c10602775ed91552e5ace887d4257072');
  assert.deepEqual(packet.sourceBatch, {
    identity: batch002.name, batchId: batch002.batchId, sha256: batchSha256,
  });
  assert.equal(packet.rows.length, 64);
  assert.equal(new Set(packet.rows.map(row => row.auditRowId)).size, 64);
  assert.ok(packet.rows.every((row, index) => row.auditRowId
    !== audit.opaqueAuditRowId(PRE_NATURALNESS_BATCH_SHA256, batch002.items[index].itemId)));
  assert.equal(jsonSha256(packet.rows.map(row => row.selectedBundle)),
    PRE_NATURALNESS_BUNDLES_SHA256);
  for (const [index, row] of packet.rows.entries()) {
    const item = batch002.items[index];
    assert.deepEqual(Object.keys(row), ['auditRowId', 'sourceEpisode', 'selectedBundle']);
    assert.deepEqual(Object.keys(row.sourceEpisode), ['turns']);
    assert.equal(row.auditRowId, audit.opaqueAuditRowId(batchSha256, item.itemId));
    assert.deepEqual(row.sourceEpisode.turns, episodes.get(item.sourceEpisodeId).turns);
    assert.equal(row.selectedBundle, surfaces.renderHumanReviewText(batch002, item));
  }
  const serialized = JSON.stringify(packet);
  for (const forbidden of ['disposition', 'reason', 'result', 'humanGoldDecision', 'intendedLabel']) {
    assert.equal(serialized.includes(`"${forbidden}"`), false);
  }
  assert.equal(protocol.authority.sourceAuditCompleted, false);
  assert.equal(protocol.authority.humanReviewCompleted, false);
  assert.equal(protocol.authority.trainingOccurred, false);
});

test('batch-001, smoke acceptance, exact56, and all historical evidence remain byte-identical', () => {
  const hashes = {
    [BATCH_001]: '2a4605f5550118754c315e26700aef1be96a3129a3ef0065fd2accdad5352a36',
    'local-memory-inference-p1b6-surface-batch-001-authoring-protocol.json':
      '3591d7db8b98ed7ee016533346908122832068e470dfdfd61a685e1670c13909',
    [ACCEPTANCE]: '449318d5d3895fca87257a40b7d47b6d8d8eb3df8e9817fff5998a34d658bb5c',
    [EXACT56]: '772f07bd679a9c98ea65feaa164ec7a9c1f3e3fb33632052ef076f8301999602',
    'local-memory-inference-p1b6-source-audit-batch-001-attempt-001.json':
      '95026b2f6b274e5d909faba96c6cb7345e1286b9f6824450b971936fd685677b',
    'local-memory-inference-p1b6-source-audit-batch-001-attempt-002.json':
      '30d87b5949dbbf68624cfa28bd04977dc5248ae561c8e3410ab18604d90cded4',
    'local-memory-inference-p1b6-source-audit-batch-001-attempt-003.json':
      '8e91b91866f6f958dd5877ceeddd8717a5946b308fa7c591e097fd6ed52ca9e2',
    'local-memory-inference-p1b6-source-audit-batch-001-attempt-004.json':
      'a49e9a08fd2eb4da78c4a394734aa3cead2cb69505b91e87344ffafba609b162',
    'local-memory-inference-p1b6-primary-human-review-batch-001-attempt-001.json':
      '816a24aec8ca429fad3582dfd972bffb6437c9d41d7ddebd393674fb48d4d8e2',
    'local-memory-inference-p1b6-primary-human-rereview-batch-001-attempt-002.json':
      '2c41dcd1c36231039958839a35e53cab187c5bbd1caf992d5c6f96aca30fd21e',
    'local-memory-inference-p1b6-primary-human-effective-current-batch-001.json':
      '44832509f04ffb81a0772e9fda9adcbbea43305315a5d05948819b2c845b162a',
    'local-memory-inference-p1b6-anchor-marker-pilot.json':
      'e530ea9d2b1b2ea5ce42557a9cbb9828f97d14f6ab431e7dbb71ebbc825196e0',
    'local-memory-inference-p1b6-anchor-marker-pilot-report.json':
      'ce43e493cb037779a52e682498769ec87e2ae614846a769e3eebe4b561da49e1',
  };
  for (const [file, expected] of Object.entries(hashes)) assert.equal(sha256RawBytes(read(file)), expected, file);
});
