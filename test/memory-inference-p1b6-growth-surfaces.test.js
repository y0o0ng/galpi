'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const surfaces = require('../lib/memory-inference-p1b6-surfaces');
const audit = require('../scripts/build-memory-inference-p1b6-source-audit-packet');
const humanReview = require('../scripts/build-memory-inference-p1b6-human-review-packet');
const humanRereview = require('../scripts/build-memory-inference-p1b6-human-rereview-packet');

const ROOT = path.resolve(__dirname, '..');
const fixture = file => path.join(ROOT, 'fixtures', file);
const read = file => fs.readFileSync(fixture(file));
const readJson = file => JSON.parse(read(file));
const BATCH_001 = 'local-memory-inference-p1b6-surface-batch-001.json';
const BATCH_002 = 'local-memory-inference-p1b6-surface-batch-002.json';
const PROTOCOL_002 = 'local-memory-inference-p1b6-surface-batch-002-authoring-protocol.json';
const ACCEPTANCE = 'local-memory-inference-p1b6-smoke-batch-001-acceptance.json';
const EXACT56 = 'local-memory-inference-p1b6-skeleton-exact56.json';
const AUDIT_ATTEMPT_002 = 'local-memory-inference-p1b6-source-audit-batch-002-attempt-001.json';
const AUDIT_ATTEMPT_002_CURRENT =
  'local-memory-inference-p1b6-source-audit-batch-002-attempt-002.json';
const HUMAN_ATTEMPT_002 = 'local-memory-inference-p1b6-primary-human-review-batch-002-attempt-001.json';
const HUMAN_PACKET_002_SHA256 = 'e949dceb77e68dde278ef448eb17380645064573e187eb1cba7b24c673069fa5';
const AUDIT_RESULT_002 = path.join(os.homedir(), 'Downloads',
  'p1b6-source-audit-batch-002-attempt-001-results.json');
const AUDIT_RESULT_002_SHA256 = '896c06622228ade18bfe2a5a486f5266332fed8957ff70e93debe999eb77af6f';
const FOCUSED_AUDIT_RESULT_002 = path.join(os.homedir(), 'Downloads',
  'p1b6-source-audit-results.json');
const FOCUSED_AUDIT_RESULT_002_SHA256 =
  '62ab6fb085a504b1e4d6c5e5660cecea546109bd151cb4cbfcc26deb79404dad';
const REREVIEW_PACKET_002_SHA256 =
  'f582776c81a51fb08f2e5cfe697b51be939aeb6533659e6038d80d391fffd2c9';
const REREVIEW_ATTEMPT_002 =
  'local-memory-inference-p1b6-primary-human-rereview-batch-002-attempt-002.json';
const REREVIEW_RECEIPT_002_SHA256 =
  '141070c2e1485294a64c73d69de12dee867ce81ba1b66a3b9b189d61d84d67f3';
const EFFECTIVE_002 =
  'local-memory-inference-p1b6-primary-human-effective-current-batch-002.json';
const EFFECTIVE_002_SHA256 =
  'd0e5dcc2da7d1f87b4886d6e5b6726c1053c88fdc4cdf8fbd144a47c3cddf38f';
const MISMATCHES_002 =
  'local-memory-inference-p1b6-primary-human-reconciliation-mismatches-batch-002.json';
const MISMATCHES_002_SHA256 =
  '9a02ecfec486a6b5f5d1f586b2a2482dafc94a8b2f642e71e23f3653020129f5';
const EXACT56_SHA256 = '772f07bd679a9c98ea65feaa164ec7a9c1f3e3fb33632052ef076f8301999602';
const ADJUDICATION_002 =
  'local-memory-inference-p1b6-pragmatic-adjudication-batch-002.json';
const ADJUDICATION_002_SHA256 =
  'dd8697b890f41a3541c38b7101bd93ee697889bdaa9ceafea114d2d7feef4967';
const ADJUDICATION_RECEIPT_002 =
  'local-memory-inference-p1b6-pragmatic-adjudication-batch-002-receipt.json';
const ADJUDICATION_RECEIPT_002_SHA256 =
  'cf05f5073fc30f19078aab1a0c081b59face607a041387bf5421ffa2af8bbdaa';
const REREVIEW_003_PACKET_SHA256 =
  '165d8d02ca6f5d36a22f4a8baa4d5ee7d19b059b6e2a944cbc5e1a19554973c2';
const REREVIEW_003_ROW_IDS = [
  'p1b6-rereview-2c251b9d9e952944',
  'p1b6-rereview-a0c1900947d7341b',
  'p1b6-rereview-f53ff2ec780365d2',
];
const EFFECTIVE_001 =
  'local-memory-inference-p1b6-primary-human-effective-current-batch-001.json';
const REREVIEW_IDS_002 = [
  'p1b6-rereview-02acbfe8ee8d6bcc',
  'p1b6-rereview-27a2b7b3013ce07d',
  'p1b6-rereview-4dc89a20b64524ef',
  'p1b6-rereview-b8bc096f17086620',
];
const rawBatch002 = read(BATCH_002);
const batch001 = readJson(BATCH_001);
const batch002 = JSON.parse(rawBatch002);
const protocol = readJson(PROTOCOL_002);
const acceptance = readJson(ACCEPTANCE);
const exact56 = readJson(EXACT56);
const auditReceipt002 = readJson(AUDIT_ATTEMPT_002);
const currentAuditReceipt002 = readJson(AUDIT_ATTEMPT_002_CURRENT);
const humanReceipt002 = readJson(HUMAN_ATTEMPT_002);
const rereviewReceipt002 = readJson(REREVIEW_ATTEMPT_002);
const effectiveBatch001 = readJson(EFFECTIVE_001);
const skeletons = new Map(exact56.candidates.map(row => [row.semanticSkeletonId, row]));
const PRE_REPAIR_BATCH_SHA256 = '552a11e4c976c514f27ee36afe0fa5546dcc921a465b24180c831771f9d02334';
const REPAIRED_BATCH_SHA256 = 'ed68a562a67deee4d8e92d3e4841362d9589f876480d174a043d822cbf61e80c';
const PRE_REPAIR_AUDIT_PACKET_SHA256 = 'fb3f40c471299aeed79a5cab4da588e8c10602775ed91552e5ace887d4257072';
const REPAIRED_AUDIT_PACKET_SHA256 = '822c889903016a95ccfdff41f705863cd7116e0798d25915f4c445a894964f4d';
const CURRENT_AUDIT_RECEIPT_SHA256 =
  'c88f41043279c739d03c557fa35b73ae86f3890e0310b4993d9b67332ada889d';
const FRESH_AUDIT_IDS = [
  'p1b6-audit-6ba7424ec855cbc6',
  'p1b6-audit-df6e0ea243bc52c6',
  'p1b6-audit-7425eb9b4037de9a',
  'p1b6-audit-965879c6fddf478f',
];
const CARRY_REASON_PREFIX = 'Carried forward from batch-002 source-audit attempt 001 after exact sourceEpisode and selectedBundle equality. Prior reason: ';
const PRE_NATURALNESS_ITEMS_SHA256 = '82667f84fe81bb70941a9ff80ca26e83ace0c063cb8576ccce2fb5ffe7a92794';
const PRE_NATURALNESS_BUNDLES_SHA256 = 'c80817d06a6d7f5fb4198533310748f4f3a7d673c1c45007770b60e1a18b10cb';
const PRE_NATURALNESS_TURN_STRUCTURE_SHA256 = '8934a22407461a016f7bafa3b6b2a0c597e2dc4f47829f72db14451c207bbd54';
const PRE_NATURALNESS_BATCH_SHA256 = 'db212aae0c1e5c5943cfe68b15cfa106f7a1cc8bd454a8d30320ab0c6a290456';
const HISTORICAL_ANCHORS = {
  'p1b6-item-b002-010': { turnId: 't5', startByte: 0, endByte: 6 },
  'p1b6-item-b002-014': { turnId: 't7', startByte: 0, endByte: 14 },
  'p1b6-item-b002-018': { turnId: 't3', startByte: 0, endByte: 6 },
  'p1b6-item-b002-050': { turnId: 't1', startByte: 36, endByte: 59 },
};
const REPAIRED_ANCHORS = {
  'p1b6-item-b002-010': [{ turnId: 't1', startByte: 0, endByte: 13 }, '사진 백업'],
  'p1b6-item-b002-014': [{ turnId: 't1', startByte: 45, endByte: 58 }, '자막 설정'],
  'p1b6-item-b002-018': [{ turnId: 't1', startByte: 0, endByte: 9 }, '회의록'],
  'p1b6-item-b002-050': [{ turnId: 't1', startByte: 0, endByte: 32 }, '사무실에서 쓰는 노트북'],
};

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

function batchBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function restoreHistoricalAnchors(value) {
  const restored = structuredClone(value);
  for (const [itemId, anchorSpanRef] of Object.entries(HISTORICAL_ANCHORS)) {
    restored.items.find(item => item.itemId === itemId).anchorSpanRef = anchorSpanRef;
  }
  return restored;
}

const preRepairBatch002 = restoreHistoricalAnchors(batch002);
const rawPreRepairBatch002 = batchBytes(preRepairBatch002);

function buildBatch002Effective() {
  const rawOriginalPacket = humanReview.packetBytes(
    humanReview.buildHumanReviewPacket(rawPreRepairBatch002, auditReceipt002),
  );
  const rawRereviewPacket = humanRereview.packetBytes(humanRereview.buildBatch002RereviewPacket(
    rawBatch002, currentAuditReceipt002, rawOriginalPacket, humanReceipt002,
  ));
  return {
    ...humanRereview.buildBatch002EffectiveHumanDecisionSet(
      rawBatch002, currentAuditReceipt002, rawOriginalPacket, humanReceipt002,
      rawRereviewPacket, rereviewReceipt002, read(EXACT56),
    ),
    rawOriginalPacket,
    rawRereviewPacket,
  };
}

test('batch-002 validates as the 64-item current adaptive-growth tranche', () => {
  assert.equal(batch002.name, 'xion-local-memory-inference-p1b6-surface-batch-002-v1');
  assert.equal(batch002.batchId, 'p1b6-surface-batch-002');
  assert.equal(batch002.items.length, 64);
  assert.equal(batch002.sourceEpisodes.length, 64);
  assert.equal(surfaces.validateSurfaceBatch(batch002), batch002);
  assert.equal(sha256RawBytes(rawBatch002), REPAIRED_BATCH_SHA256);
  assert.equal(protocol.outputBatch.sha256, sha256RawBytes(rawBatch002));
  assert.equal(protocol.trancheSize, 64);
  assert.equal(protocol.authority.sourceAuditCompleted, true);
  assert.equal(protocol.authority.humanReviewCompleted, false);
  assert.equal(protocol.authority.finalCorpusHumanGoldFrozen, false);
  assert.equal(protocol.authority.trainingOccurred, false);
  assert.equal(sha256RawBytes(rawPreRepairBatch002), PRE_REPAIR_BATCH_SHA256);
  assert.equal(jsonSha256(preRepairBatch002.items), PRE_NATURALNESS_ITEMS_SHA256);
  assert.equal(jsonSha256(preRepairBatch002.items.map(item =>
    surfaces.renderHumanReviewText(preRepairBatch002, item))), PRE_NATURALNESS_BUNDLES_SHA256);
  assert.equal(jsonSha256(batch002.sourceEpisodes.map(episode => ({
    sourceEpisodeId: episode.sourceEpisodeId,
    turns: episode.turns.map(turn => ({ turnId: turn.turnId, role: turn.role })),
  }))), PRE_NATURALNESS_TURN_STRUCTURE_SHA256);
});

test('batch-002 repair changes exactly the four prescribed anchor spans', () => {
  const priorItems = new Map(preRepairBatch002.items.map(item => [item.itemId, item]));
  const episodes = new Map(batch002.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  const changed = batch002.items.filter(item =>
    JSON.stringify(item) !== JSON.stringify(priorItems.get(item.itemId)));
  assert.deepEqual(changed.map(item => item.itemId), Object.keys(REPAIRED_ANCHORS));
  assert.deepEqual(batch002.sourceEpisodes, preRepairBatch002.sourceEpisodes);

  for (const item of changed) {
    const [expectedAnchor, expectedPhrase] = REPAIRED_ANCHORS[item.itemId];
    const prior = priorItems.get(item.itemId);
    assert.deepEqual(item.anchorSpanRef, expectedAnchor);
    assert.deepEqual({ ...item, anchorSpanRef: prior.anchorSpanRef }, prior);
    assert.deepEqual(item.evidenceSpanRefs, prior.evidenceSpanRefs);
    const turn = episodes.get(item.sourceEpisodeId).turns
      .find(row => row.turnId === item.anchorSpanRef.turnId);
    const bytes = Buffer.from(turn.text);
    assert.equal(bytes.subarray(item.anchorSpanRef.startByte, item.anchorSpanRef.endByte)
      .toString('utf8'), expectedPhrase);
    assert.equal(Buffer.byteLength(bytes.subarray(0, item.anchorSpanRef.startByte)
      .toString('utf8')), item.anchorSpanRef.startByte);
    assert.equal(Buffer.byteLength(bytes.subarray(0, item.anchorSpanRef.endByte)
      .toString('utf8')), item.anchorSpanRef.endByte);
    assert.ok(item.evidenceSpanRefs.some(span => span.turnId === item.anchorSpanRef.turnId
      && span.startByte <= item.anchorSpanRef.startByte
      && span.endByte >= item.anchorSpanRef.endByte));
    assert.match(surfaces.renderHumanReviewText(batch002, item),
      new RegExp(`\\[TARGET\\]${expectedPhrase}\\[/TARGET\\]`, 'u'));
  }

  const historicalPacket = humanReview.buildHumanReviewPacket(rawPreRepairBatch002, auditReceipt002);
  const historicalBundles = new Map(preRepairBatch002.items.map(item => [
    item.itemId,
    historicalPacket.rows.find(row => row.reviewRowId
      === humanReview.opaqueReviewRowId(PRE_REPAIR_BATCH_SHA256, item.itemId)).selectedBundle,
  ]));
  assert.deepEqual(batch002.items.filter(item => surfaces.renderHumanReviewText(batch002, item)
    !== historicalBundles.get(item.itemId)).map(item => item.itemId), Object.keys(REPAIRED_ANCHORS));
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

test('batch-002 source-audit attempt-002 packet is fresh, complete, and result-free', () => {
  const batchSha256 = sha256RawBytes(rawBatch002);
  const packet = audit.buildAuditPacket(rawBatch002);
  const packetBytes = batchBytes(packet);
  const priorPacket = audit.buildAuditPacket(rawPreRepairBatch002);
  const episodes = new Map(batch002.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  assert.equal(batchSha256, REPAIRED_BATCH_SHA256);
  assert.equal(sha256RawBytes(packetBytes), REPAIRED_AUDIT_PACKET_SHA256);
  assert.deepEqual(packet.sourceBatch, {
    identity: batch002.name, batchId: batch002.batchId, sha256: batchSha256,
  });
  assert.equal(packet.rows.length, 64);
  assert.equal(new Set(packet.rows.map(row => row.auditRowId)).size, 64);
  assert.ok(packet.rows.every((row, index) => row.auditRowId !== priorPacket.rows[index].auditRowId));
  assert.ok(packet.rows.every((row, index) => row.auditRowId
    !== audit.opaqueAuditRowId(PRE_NATURALNESS_BATCH_SHA256, batch002.items[index].itemId)));
  assert.equal(packet.rows.filter((row, index) =>
    row.selectedBundle !== priorPacket.rows[index].selectedBundle).length, 4);
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
  assert.equal(protocol.authority.sourceAuditCompleted, true);
  assert.equal(protocol.authority.humanReviewCompleted, false);
  assert.equal(protocol.authority.trainingOccurred, false);
});

test('batch-002 source-audit attempt-001 receipt remains exact historical authority', () => {
  const packet = audit.buildAuditPacket(rawPreRepairBatch002);
  const expectedIds = new Set(packet.rows.map(row => row.auditRowId));
  assert.equal(auditReceipt002.name,
    'xion-local-memory-inference-p1b6-source-audit-batch-002-attempt-001-receipt-v1');
  assert.equal(auditReceipt002.attemptId, 'p1b6-source-audit-batch-002-attempt-001');
  assert.equal(auditReceipt002.status, 'COMPLETE_PASS');
  assert.equal(auditReceipt002.auditPacketSha256,
    'fb3f40c471299aeed79a5cab4da588e8c10602775ed91552e5ace887d4257072');
  assert.equal(auditReceipt002.auditedSourceBatch.rawSha256,
    '552a11e4c976c514f27ee36afe0fa5546dcc921a465b24180c831771f9d02334');
  assert.deepEqual(auditReceipt002.summary, { total: 64, PASS: 64, FAIL: 0, UNCERTAIN: 0 });
  assert.equal(auditReceipt002.rawResultArtifact.sha256, AUDIT_RESULT_002_SHA256);
  assert.equal(auditReceipt002.rows.length, 64);
  assert.equal(new Set(auditReceipt002.rows.map(row => row.auditRowId)).size, 64);
  assert.deepEqual(new Set(auditReceipt002.rows.map(row => row.auditRowId)), expectedIds);
  assert.ok(auditReceipt002.rows.every(row => row.disposition === 'PASS'
    && typeof row.reason === 'string' && row.reason.trim()));
  assert.equal(auditReceipt002.authority.sourceBundleGatePassed, true);
  assert.equal(auditReceipt002.authority.humanSemanticReviewOccurred, false);
  assert.equal(auditReceipt002.authority.surfaceHumanGoldAssigned, false);
  assert.equal(auditReceipt002.authority.trainingOccurred, false);
  assert.equal(sha256RawBytes(batchBytes(packet)), PRE_REPAIR_AUDIT_PACKET_SHA256);
  assert.doesNotThrow(() => humanReview.validateAuditReceipt(auditReceipt002, rawPreRepairBatch002));
  assert.throws(() => humanReview.validateAuditReceipt(auditReceipt002, rawBatch002),
    /binding is invalid/u);
  if (fs.existsSync(AUDIT_RESULT_002)) {
    const rawResult = fs.readFileSync(AUDIT_RESULT_002);
    const result = JSON.parse(rawResult);
    assert.equal(sha256RawBytes(rawResult), AUDIT_RESULT_002_SHA256);
    assert.deepEqual(Object.keys(result), ['rows']);
    assert.equal(result.rows.length, 64);
    assert.deepEqual(new Set(result.rows.map(row => row.auditRowId)), expectedIds);
    assert.ok(result.rows.every(row => Object.keys(row).join(',') === 'auditRowId,disposition,reason'
      && row.disposition === 'PASS' && typeof row.reason === 'string' && row.reason.trim()));
  }
});

test('batch-002 source-audit attempt-002 combines four fresh and 60 exact carry-forward PASS rows', () => {
  const currentPacket = audit.buildAuditPacket(rawBatch002);
  const priorPacket = audit.buildAuditPacket(rawPreRepairBatch002);
  const currentIds = currentPacket.rows.map(row => row.auditRowId);
  const receiptRows = new Map(currentAuditReceipt002.rows.map(row => [row.auditRowId, row]));
  const priorRows = new Map(auditReceipt002.rows.map(row => [row.auditRowId, row]));
  const changedIds = [];
  let carriedCount = 0;

  for (const [index, row] of currentPacket.rows.entries()) {
    const priorPacketRow = priorPacket.rows[index];
    const sourceEqual = JSON.stringify(row.sourceEpisode)
      === JSON.stringify(priorPacketRow.sourceEpisode);
    const bundleEqual = row.selectedBundle === priorPacketRow.selectedBundle;
    if (!sourceEqual || !bundleEqual) changedIds.push(row.auditRowId);
    const receiptRow = receiptRows.get(row.auditRowId);
    assert.equal(receiptRow.disposition, 'PASS');
    if (FRESH_AUDIT_IDS.includes(row.auditRowId)) {
      assert.equal(sourceEqual, true);
      assert.equal(bundleEqual, false);
      assert.equal(receiptRow.reason.startsWith(CARRY_REASON_PREFIX), false);
    } else {
      const priorReceiptRow = priorRows.get(priorPacketRow.auditRowId);
      assert.equal(sourceEqual, true);
      assert.equal(bundleEqual, true);
      assert.equal(priorReceiptRow.disposition, 'PASS');
      assert.equal(receiptRow.reason, CARRY_REASON_PREFIX + priorReceiptRow.reason);
      carriedCount += 1;
    }
  }

  assert.deepEqual(changedIds, FRESH_AUDIT_IDS);
  assert.equal(carriedCount, 60);
  assert.equal(sha256RawBytes(read(AUDIT_ATTEMPT_002_CURRENT)),
    CURRENT_AUDIT_RECEIPT_SHA256);
  assert.equal(currentAuditReceipt002.status, 'COMPLETE_PASS');
  assert.equal(currentAuditReceipt002.auditPacketSha256, REPAIRED_AUDIT_PACKET_SHA256);
  assert.equal(currentAuditReceipt002.rawResultArtifact.sha256,
    FOCUSED_AUDIT_RESULT_002_SHA256);
  assert.deepEqual(currentAuditReceipt002.summary,
    { total: 64, PASS: 64, FAIL: 0, UNCERTAIN: 0 });
  assert.deepEqual(currentAuditReceipt002.rows.map(row => row.auditRowId), currentIds);
  assert.equal(new Set(currentIds).size, 64);
  assert.doesNotThrow(() => humanReview.validateAuditReceipt(currentAuditReceipt002, rawBatch002));
  assert.throws(() => humanReview.validateAuditReceipt(auditReceipt002, rawBatch002),
    /binding is invalid/u);

  if (fs.existsSync(FOCUSED_AUDIT_RESULT_002)) {
    const rawResult = fs.readFileSync(FOCUSED_AUDIT_RESULT_002);
    const result = JSON.parse(rawResult);
    assert.equal(sha256RawBytes(rawResult), FOCUSED_AUDIT_RESULT_002_SHA256);
    assert.equal(result.length, 4);
    assert.equal(new Set(result.map(row => row.auditRowId)).size, 4);
    assert.deepEqual(result.map(row => row.auditRowId), FRESH_AUDIT_IDS);
    assert.ok(result.every(row => Object.keys(row).join(',')
      === 'auditRowId,disposition,reason'
      && row.disposition === 'PASS' && typeof row.reason === 'string' && row.reason.trim()));
    assert.deepEqual(result, FRESH_AUDIT_IDS.map(id => receiptRows.get(id)));
  }
});

test('generalized primary HUMAN builder fails closed on stale or non-PASS batch-002 receipts', () => {
  const changedReceipt = mutator => {
    const value = structuredClone(auditReceipt002);
    mutator(value);
    return value;
  };
  assert.throws(() => humanReview.buildHumanReviewPacket(rawPreRepairBatch002, changedReceipt(value => {
    value.status = 'COMPLETE_NEEDS_FIX';
  })), /binding is invalid/u);
  assert.throws(() => humanReview.buildHumanReviewPacket(rawPreRepairBatch002, changedReceipt(value => {
    value.auditedSourceBatch.rawSha256 = '0'.repeat(64);
  })), /binding is invalid/u);
  assert.throws(() => humanReview.buildHumanReviewPacket(rawPreRepairBatch002, changedReceipt(value => {
    value.rows.pop();
  })), /all-PASS/u);
  assert.throws(() => humanReview.buildHumanReviewPacket(rawPreRepairBatch002, changedReceipt(value => {
    value.rows[1] = structuredClone(value.rows[0]);
  })), /incomplete, stale, or not all PASS/u);
  assert.throws(() => humanReview.buildHumanReviewPacket(rawPreRepairBatch002, changedReceipt(value => {
    value.rows[0].disposition = 'FAIL';
  })), /not all PASS/u);
  assert.throws(() => humanReview.buildHumanReviewPacket(rawPreRepairBatch002, changedReceipt(value => {
    value.attemptId = 'p1b6-source-audit-batch-001-attempt-001';
    value.name = 'xion-local-memory-inference-p1b6-source-audit-batch-001-attempt-001-receipt-v1';
  })), /binding is invalid/u);
  assert.throws(() => humanReview.buildHumanReviewPacket(rawBatch002, auditReceipt002),
    /binding is invalid/u);
});

test('batch-002 historical primary HUMAN review packet remains blind and deterministic', () => {
  const packet = humanReview.buildHumanReviewPacket(rawPreRepairBatch002, auditReceipt002);
  const expected = new Map(preRepairBatch002.items.map(item => [
    humanReview.opaqueReviewRowId(PRE_REPAIR_BATCH_SHA256, item.itemId),
    surfaces.renderHumanReviewText(preRepairBatch002, item),
  ]));
  assert.deepEqual(Object.keys(packet), [
    'name', 'sourceBatch', 'rendererIdentity', 'sourceAuditAttempt', 'rows',
  ]);
  assert.deepEqual(packet.sourceBatch, {
    identity: batch002.name,
    sha256: PRE_REPAIR_BATCH_SHA256,
  });
  assert.equal(packet.sourceAuditAttempt, 'p1b6-source-audit-batch-002-attempt-001');
  assert.equal(packet.rows.length, 64);
  assert.equal(new Set(packet.rows.map(row => row.reviewRowId)).size, 64);
  assert.deepEqual(packet.rows.map(row => row.reviewRowId),
    packet.rows.map(row => row.reviewRowId).toSorted());
  for (const row of packet.rows) {
    assert.deepEqual(Object.keys(row), ['reviewRowId', 'selectedBundle']);
    assert.equal(row.selectedBundle, expected.get(row.reviewRowId));
  }
  assert.deepEqual(humanReview.buildHumanReviewPacket(rawPreRepairBatch002, auditReceipt002), packet);
  assert.equal(sha256RawBytes(humanReview.packetBytes(packet)),
    HUMAN_PACKET_002_SHA256);
  const serialized = JSON.stringify(packet);
  for (const field of [
    'itemId', 'auditRowId', 'sourceEpisodeId', 'semanticSkeletonId', 'humanLabel',
    'boundaryClass', 'splitAssignment', 'language', 'discoursePattern',
    'sourceFamilyId', 'surfaceFamilyId', 'reason', 'disposition', 'decision',
    'sourceEpisode', 'turns',
  ]) assert.equal(serialized.includes(`"${field}"`), false, field);
  assert.equal(acceptance.accepted.length, 30);
  assert.equal(protocol.authority.humanReviewCompleted, false);
  assert.equal(protocol.authority.finalCorpusHumanGoldFrozen, false);
  assert.equal(protocol.authority.trainingOccurred, false);
});

test('batch-002 focused HUMAN re-review packet contains only the four historical FIX surfaces', () => {
  const originalPacket = humanReview.buildHumanReviewPacket(rawPreRepairBatch002, auditReceipt002);
  const rawOriginalPacket = humanReview.packetBytes(originalPacket);
  const packet = humanRereview.buildBatch002RereviewPacket(
    rawBatch002, currentAuditReceipt002, rawOriginalPacket, humanReceipt002,
  );
  const fixIds = new Set(humanReceipt002.rows.filter(row => row.disposition === 'FIX')
    .map(row => row.reviewRowId));
  const affected = batch002.items.filter(item => fixIds.has(humanReview.opaqueReviewRowId(
    PRE_REPAIR_BATCH_SHA256, item.itemId,
  )));
  assert.deepEqual(affected.map(item => item.itemId), Object.keys(REPAIRED_ANCHORS));
  assert.equal(sha256RawBytes(rawOriginalPacket), HUMAN_PACKET_002_SHA256);
  assert.equal(sha256RawBytes(humanRereview.packetBytes(packet)), REREVIEW_PACKET_002_SHA256);
  assert.deepEqual(Object.keys(packet), [
    'name', 'sourceBatch', 'rendererIdentity', 'sourceAuditAttempt',
    'originalPrimaryHumanAttempt', 'originalPrimaryHumanPacketSha256', 'rows',
  ]);
  assert.equal(packet.name, humanRereview.PACKET_IDENTITY);
  assert.deepEqual(packet.sourceBatch, { identity: batch002.name, sha256: REPAIRED_BATCH_SHA256 });
  assert.equal(packet.rendererIdentity, surfaces.RENDERER_IDENTITY);
  assert.equal(packet.sourceAuditAttempt, 'p1b6-source-audit-batch-002-attempt-002');
  assert.equal(packet.originalPrimaryHumanAttempt,
    'p1b6-primary-human-review-batch-002-attempt-001');
  assert.equal(packet.originalPrimaryHumanPacketSha256, HUMAN_PACKET_002_SHA256);
  assert.equal(packet.rows.length, 4);
  assert.equal(new Set(packet.rows.map(row => row.reviewRowId)).size, 4);
  assert.deepEqual(packet.rows.map(row => row.reviewRowId),
    packet.rows.map(row => row.reviewRowId).toSorted());

  const expected = new Map(affected.map(item => [
    humanRereview.opaqueRereviewRowId(REPAIRED_BATCH_SHA256, item.itemId),
    surfaces.renderHumanReviewText(batch002, item),
  ]));
  for (const row of packet.rows) {
    assert.deepEqual(Object.keys(row), ['reviewRowId', 'selectedBundle']);
    assert.equal(row.selectedBundle, expected.get(row.reviewRowId));
  }
  const targetPhrases = packet.rows.map(row =>
    /\[TARGET\]([^[]+)\[\/TARGET\]/u.exec(row.selectedBundle)?.[1]).toSorted();
  assert.deepEqual(targetPhrases,
    ['사진 백업', '자막 설정', '회의록', '사무실에서 쓰는 노트북'].toSorted());
  const serialized = JSON.stringify(packet);
  for (const field of [
    'itemId', 'sourceEpisodeId', 'semanticSkeletonId', 'disposition', 'decision',
    'reason', 'auditRowId', 'splitAssignment', 'intendedLabel', 'humanLabel',
    'boundaryClass', 'discoursePattern', 'sourceFamilyId', 'surfaceFamilyId',
  ]) assert.equal(serialized.includes(`"${field}"`), false, field);

  const staleReceipt = structuredClone(currentAuditReceipt002);
  staleReceipt.rows.pop();
  assert.throws(() => humanRereview.buildBatch002RereviewPacket(
    rawBatch002, staleReceipt, rawOriginalPacket, humanReceipt002,
  ), /all-PASS/u);
});

test('batch-002 primary HUMAN receipt records the exact completed blind review', () => {
  const packet = humanReview.buildHumanReviewPacket(rawPreRepairBatch002, auditReceipt002);
  const packetIds = packet.rows.map(row => row.reviewRowId);
  const receiptIds = humanReceipt002.rows.map(row => row.reviewRowId);
  assert.equal(sha256RawBytes(read(HUMAN_ATTEMPT_002)),
    '6c2d8fabaf6c9caa4d86b5d4252d4e96801648c414b65ab0454e61c66ed0de4c');
  assert.equal(sha256RawBytes(humanReview.packetBytes(packet)), HUMAN_PACKET_002_SHA256);
  assert.equal(humanReceipt002.name,
    'xion-local-memory-inference-p1b6-primary-human-review-batch-002-attempt-001-receipt-v1');
  assert.equal(humanReceipt002.attemptId, 'p1b6-primary-human-review-batch-002-attempt-001');
  assert.equal(humanReceipt002.status, 'COMPLETE_NEEDS_FIX');
  assert.deepEqual(humanReceipt002.primaryHumanReviewPacket, {
    identity: humanReview.PACKET_IDENTITY,
    rawSha256: HUMAN_PACKET_002_SHA256,
  });
  assert.deepEqual(humanReceipt002.reviewedSourceBatch, {
    identity: batch002.name,
    rawSha256: PRE_REPAIR_BATCH_SHA256,
  });
  assert.equal(humanReceipt002.rendererIdentity, surfaces.RENDERER_IDENTITY);
  assert.deepEqual(humanReceipt002.sourceAuditPrerequisite, {
    attemptId: auditReceipt002.attemptId,
    status: 'COMPLETE_PASS',
    allRowsPassed: true,
  });
  assert.equal(humanReceipt002.rows.length, 64);
  assert.equal(new Set(receiptIds).size, 64);
  assert.deepEqual(receiptIds, packetIds);
  assert.deepEqual(receiptIds, receiptIds.toSorted());
  assert.deepEqual(humanReceipt002.rows.reduce((summary, row) => {
    summary[row.disposition] += 1;
    summary[row.decision] += 1;
    return summary;
  }, { KEEP: 0, FIX: 0, REJECT: 0, CLEAR: 0, ESCALATE: 0 }), {
    KEEP: 60, FIX: 4, REJECT: 0, CLEAR: 55, ESCALATE: 9,
  });
  assert.deepEqual(humanReceipt002.summary, {
    total: 64, KEEP: 60, FIX: 4, REJECT: 0, CLEAR: 55, ESCALATE: 9,
  });
  assert.deepEqual(humanReceipt002.rows.filter(row => row.disposition === 'FIX')
    .map(row => row.reviewRowId), [
    'p1b6-review-00b24c2af0afb84a',
    'p1b6-review-093bff64daa31e49',
    'p1b6-review-11f3ff710421ae61',
    'p1b6-review-49feb65692c796b9',
  ]);
  assert.deepEqual(humanReceipt002.rows.filter(row => row.decision === 'ESCALATE')
    .map(row => row.reviewRowId), [
    'p1b6-review-056fdea622f1b814',
    'p1b6-review-0b85ca9a10860f2d',
    'p1b6-review-168661d6b37f974d',
    'p1b6-review-196ba36ad052d3f5',
    'p1b6-review-566fe94c1416cf9d',
    'p1b6-review-6180b0d378704f9b',
    'p1b6-review-8cedcbf53724f0c9',
    'p1b6-review-b2325591b6559cda',
    'p1b6-review-c39aba4078c12eaa',
  ]);
  assert.deepEqual(Object.fromEntries(humanReceipt002.rows.filter(row => row.disposition === 'FIX')
    .map(row => [row.reviewRowId, row.reason])), {
    'p1b6-review-00b24c2af0afb84a':
      'The TARGET span `배터리가 네 시간` is too narrow and behaves like an attribute/value selector rather than a candidate/topic focus marker; the semantic status is still CLEAR from the visible bundle.',
    'p1b6-review-093bff64daa31e49':
      'The TARGET span `응, 그렇게` is a generic acknowledgement and is too weak to serve as the candidate/topic focus marker; the semantic status is still CLEAR from the visible bundle.',
    'p1b6-review-11f3ff710421ae61':
      'The TARGET span `좋아` is a generic acknowledgement and is too weak to serve as the candidate/topic focus marker; the semantic status is still CLEAR from the visible bundle.',
    'p1b6-review-49feb65692c796b9':
      'The TARGET span `그래` is a generic acknowledgement and is too weak to serve as the candidate/topic focus marker; the semantic status is still CLEAR from the visible bundle.',
  });
  assert.ok(humanReceipt002.rows.filter(row => row.disposition === 'FIX')
    .every(row => Object.keys(row).join(',') === 'reviewRowId,disposition,decision,reason'
      && typeof row.reason === 'string' && row.reason.trim()));
  assert.ok(humanReceipt002.rows.filter(row => row.disposition === 'KEEP')
    .every(row => Object.keys(row).join(',') === 'reviewRowId,disposition,decision'));
  assert.deepEqual(humanReceipt002.authority, {
    reviewCompletedForAllPresentedRows: true,
    acceptedKeepCount: 60,
    unresolvedFixCount: 4,
    humanReviewGateClosed: false,
    surfaceHumanGoldFrozen: false,
    decisionsSource: 'REPOSITORY_OWNER_PRIMARY_HUMAN_REVIEWER',
    modelInferenceUsedForHumanDecisions: false,
    trainingOccurred: false,
  });
  const serialized = JSON.stringify(humanReceipt002);
  for (const field of [
    'itemId', 'sourceEpisodeId', 'semanticSkeletonId', 'splitAssignment',
    'boundaryClass', 'humanLabel', 'skeletonLabel', 'generatorRationale',
    'selectedBundle', 'discoursePattern', 'sourceFamilyId', 'surfaceFamilyId',
  ]) assert.equal(serialized.includes(`"${field}"`), false, field);
  assert.equal(acceptance.accepted.length, 30);
});

test('batch-002 focused HUMAN re-review receipt records the completed four-row repair review', () => {
  const originalPacket = humanReview.buildHumanReviewPacket(rawPreRepairBatch002, auditReceipt002);
  const rawOriginalPacket = humanReview.packetBytes(originalPacket);
  const rawRereviewPacket = humanRereview.packetBytes(humanRereview.buildBatch002RereviewPacket(
    rawBatch002, currentAuditReceipt002, rawOriginalPacket, humanReceipt002,
  ));
  assert.equal(sha256RawBytes(rawBatch002), REPAIRED_BATCH_SHA256);
  assert.equal(sha256RawBytes(read(AUDIT_ATTEMPT_002_CURRENT)), CURRENT_AUDIT_RECEIPT_SHA256);
  assert.equal(sha256RawBytes(rawRereviewPacket), REREVIEW_PACKET_002_SHA256);

  const { packet, rows } = humanRereview.validateBatch002RereviewReceipt(
    rawBatch002, currentAuditReceipt002, rawOriginalPacket, humanReceipt002,
    rawRereviewPacket, rereviewReceipt002,
  );
  assert.deepEqual(packet.rows.map(row => row.reviewRowId), REREVIEW_IDS_002);
  assert.deepEqual(packet.rows.map(row => row.reviewRowId),
    packet.rows.map(row => row.reviewRowId).toSorted());
  assert.equal(rows.size, 4);
  assert.deepEqual(Object.keys(rereviewReceipt002), [
    'name', 'attemptId', 'status', 'primaryHumanRereviewPacket', 'reviewedSourceBatch',
    'rendererIdentity', 'sourceAuditPrerequisite', 'originalPrimaryHumanReview',
    'summary', 'authority', 'rows',
  ]);
  assert.equal(rereviewReceipt002.name,
    'xion-local-memory-inference-p1b6-primary-human-rereview-batch-002-attempt-002-receipt-v1');
  assert.equal(rereviewReceipt002.attemptId, 'p1b6-primary-human-rereview-batch-002-attempt-002');
  assert.equal(rereviewReceipt002.status, 'COMPLETE_PASS');
  assert.deepEqual(rereviewReceipt002.primaryHumanRereviewPacket, {
    identity: humanRereview.PACKET_IDENTITY,
    rawSha256: REREVIEW_PACKET_002_SHA256,
  });
  assert.deepEqual(rereviewReceipt002.reviewedSourceBatch, {
    identity: batch002.name,
    rawSha256: REPAIRED_BATCH_SHA256,
  });
  assert.equal(rereviewReceipt002.rendererIdentity, surfaces.RENDERER_IDENTITY);
  assert.deepEqual(rereviewReceipt002.sourceAuditPrerequisite, {
    attemptId: 'p1b6-source-audit-batch-002-attempt-002',
    status: 'COMPLETE_PASS',
    allRowsPassed: true,
  });
  assert.deepEqual(rereviewReceipt002.originalPrimaryHumanReview, {
    attemptId: 'p1b6-primary-human-review-batch-002-attempt-001',
    receiptIdentity:
      'xion-local-memory-inference-p1b6-primary-human-review-batch-002-attempt-001-receipt-v1',
  });
  assert.deepEqual(rereviewReceipt002.summary, {
    total: 4, KEEP: 4, FIX: 0, REJECT: 0, CLEAR: 4, ESCALATE: 0,
  });
  assert.deepEqual(rereviewReceipt002.authority, {
    reviewCompletedForAllPresentedRows: true,
    acceptedKeepCount: 4,
    unresolvedFixCount: 0,
    primaryHumanReviewGateClosed: false,
    surfaceHumanGoldFrozen: false,
    decisionsSource: 'REPOSITORY_OWNER_PRIMARY_HUMAN_REVIEWER',
    modelInferenceUsedForHumanDecisions: false,
    trainingOccurred: false,
  });
  assert.deepEqual(rereviewReceipt002.rows.map(row => row.reviewRowId), REREVIEW_IDS_002);
  for (const row of rereviewReceipt002.rows) {
    assert.deepEqual(Object.keys(row), ['reviewRowId', 'disposition', 'decision']);
    assert.equal(row.disposition, 'KEEP');
    assert.equal(row.decision, 'CLEAR');
  }
  const serialized = JSON.stringify(rereviewReceipt002);
  for (const field of [
    'itemId', 'sourceEpisodeId', 'semanticSkeletonId', 'splitAssignment', 'boundaryClass',
    'humanLabel', 'skeletonLabel', 'intendedLabel', 'generatorRationale', 'selectedBundle',
    'discoursePattern', 'sourceFamilyId', 'surfaceFamilyId', 'reason',
  ]) assert.equal(serialized.includes(`"${field}"`), false, field);

  const staleReceipt = structuredClone(rereviewReceipt002);
  staleReceipt.rows[0].decision = 'ESCALATE';
  assert.throws(() => humanRereview.validateBatch002RereviewReceipt(
    rawBatch002, currentAuditReceipt002, rawOriginalPacket, humanReceipt002,
    rawRereviewPacket, staleReceipt,
  ), /rows are invalid, stale, or duplicate/u);
});

test('batch-002 pre-reconciliation HUMAN overlay is 64 KEEP with 55 CLEAR and 9 ESCALATE', () => {
  const originalBundles = new Map(preRepairBatch002.items.map(item => [
    humanReview.opaqueReviewRowId(PRE_REPAIR_BATCH_SHA256, item.itemId),
    surfaces.renderHumanReviewText(preRepairBatch002, item),
  ]));
  const historical = new Map(humanReceipt002.rows.map(row => [row.reviewRowId, row]));
  const rereview = new Map(rereviewReceipt002.rows.map(row => [row.reviewRowId, row]));
  let inherited = 0;
  let repaired = 0;
  const overlay = batch002.items.map(item => {
    const originalId = humanReview.opaqueReviewRowId(PRE_REPAIR_BATCH_SHA256, item.itemId);
    const changed = originalBundles.get(originalId)
      !== surfaces.renderHumanReviewText(batch002, item);
    if (changed) {
      repaired += 1;
      const row = rereview.get(humanRereview.opaqueRereviewRowId(REPAIRED_BATCH_SHA256, item.itemId));
      assert.ok(row, item.itemId);
      return row;
    }
    inherited += 1;
    const row = historical.get(originalId);
    assert.ok(row, item.itemId);
    assert.equal(row.disposition, 'KEEP');
    return row;
  });
  assert.equal(inherited, 60);
  assert.equal(repaired, 4);
  assert.deepEqual(overlay.reduce((summary, row) => {
    summary[row.disposition] += 1;
    summary[row.decision] += 1;
    return summary;
  }, { total: overlay.length, KEEP: 0, FIX: 0, REJECT: 0, CLEAR: 0, ESCALATE: 0 }), {
    total: 64, KEEP: 64, FIX: 0, REJECT: 0, CLEAR: 55, ESCALATE: 9,
  });
  assert.equal(overlay.filter(row => row.disposition === 'FIX').length, 0);
});

test('batch-002 effective current HUMAN decisions are mechanically rebuilt from both sources', () => {
  const { artifact, inheritedCount, repairedCount } = buildBatch002Effective();
  assert.equal(sha256RawBytes(rawBatch002), REPAIRED_BATCH_SHA256);
  assert.equal(sha256RawBytes(read(AUDIT_ATTEMPT_002_CURRENT)), CURRENT_AUDIT_RECEIPT_SHA256);
  assert.equal(sha256RawBytes(read(REREVIEW_ATTEMPT_002)), REREVIEW_RECEIPT_002_SHA256);
  assert.equal(sha256RawBytes(read(EXACT56)), EXACT56_SHA256);

  assert.deepEqual(JSON.parse(read(EFFECTIVE_002)), artifact);
  assert.equal(sha256RawBytes(read(EFFECTIVE_002)), EFFECTIVE_002_SHA256);
  assert.deepEqual(Object.keys(artifact), Object.keys(effectiveBatch001));
  assert.equal(artifact.name,
    'xion-local-memory-inference-p1b6-primary-human-effective-current-batch-002-v1');
  assert.deepEqual(artifact.currentSourceBatch,
    { identity: batch002.name, rawSha256: REPAIRED_BATCH_SHA256 });
  assert.equal(artifact.rendererIdentity, surfaces.RENDERER_IDENTITY);
  assert.equal(artifact.originalPrimaryHumanAttempt,
    'p1b6-primary-human-review-batch-002-attempt-001');
  assert.equal(artifact.focusedPrimaryHumanRereviewAttempt,
    'p1b6-primary-human-rereview-batch-002-attempt-002');

  assert.equal(artifact.rows.length, 64);
  assert.equal(new Set(artifact.rows.map(row => row.itemId)).size, 64);
  assert.deepEqual(artifact.rows.map(row => row.itemId),
    batch002.items.map(item => item.itemId).toSorted());
  assert.deepEqual(artifact.rows.map(row => row.itemId),
    artifact.rows.map(row => row.itemId).toSorted());
  for (const row of artifact.rows) {
    assert.deepEqual(Object.keys(row), ['itemId', 'disposition', 'decision']);
    assert.equal(row.disposition, 'KEEP');
    assert.ok(['CLEAR', 'ESCALATE'].includes(row.decision));
  }
  assert.deepEqual(artifact.summary, {
    total: 64, KEEP: 64, FIX: 0, REJECT: 0, CLEAR: 55, ESCALATE: 9,
  });
  assert.equal(inheritedCount, 60);
  assert.equal(repairedCount, 4);

  const historical = new Map(humanReceipt002.rows.map(row => [row.reviewRowId, row]));
  const rereview = new Map(rereviewReceipt002.rows.map(row => [row.reviewRowId, row]));
  const rows = new Map(artifact.rows.map(row => [row.itemId, row]));
  const repairedItems = Object.keys(REPAIRED_ANCHORS);
  for (const item of batch002.items) {
    const originalId = humanReview.opaqueReviewRowId(PRE_REPAIR_BATCH_SHA256, item.itemId);
    const source = repairedItems.includes(item.itemId)
      ? rereview.get(humanRereview.opaqueRereviewRowId(REPAIRED_BATCH_SHA256, item.itemId))
      : historical.get(originalId);
    assert.equal(rows.get(item.itemId).decision, source.decision, item.itemId);
  }
});

test('batch-002 frozen exact56 reconciliation is recomputed and drives the artifact status', () => {
  const { artifact, reconciliation } = buildBatch002Effective();
  const rows = new Map(artifact.rows.map(row => [row.itemId, row]));
  let matchCount = 0;
  for (const item of batch002.items) {
    const skeleton = skeletons.get(item.semanticSkeletonId);
    assert.ok(skeleton, item.itemId);
    assert.ok(['CLEAR', 'ESCALATE'].includes(skeleton.humanLabel), item.itemId);
    if (rows.get(item.itemId).decision === skeleton.humanLabel) matchCount += 1;
  }
  const mismatchCount = batch002.items.length - matchCount;
  assert.equal(artifact.reconciliation.exact56Sha256, EXACT56_SHA256);
  assert.equal(artifact.reconciliation.matchCount, matchCount);
  assert.equal(artifact.reconciliation.mismatchCount, mismatchCount);
  assert.equal(matchCount + mismatchCount, 64);
  assert.equal(reconciliation.matchCount, matchCount);

  assert.equal(artifact.status,
    mismatchCount === 0 ? 'COMPLETE_PASS' : 'RECONCILIATION_NEEDS_FIX');
  assert.deepEqual(artifact.authority, {
    sourceBundleGatePassed: true,
    humanReviewCompleted: mismatchCount === 0,
    surfaceHumanGoldFrozen: false,
    trainingOccurred: false,
  });
  assert.equal(protocol.authority.humanReviewCompleted, mismatchCount === 0);

  assert.equal(matchCount, 40);
  assert.equal(mismatchCount, 24);
  assert.equal(artifact.status, 'RECONCILIATION_NEEDS_FIX');
});

test('batch-002 reconciliation leaves every HUMAN and frozen skeleton label untouched', () => {
  const { artifact } = buildBatch002Effective();
  assert.deepEqual(JSON.parse(read(EXACT56)), exact56);
  assert.equal(sha256RawBytes(read(HUMAN_ATTEMPT_002)),
    '6c2d8fabaf6c9caa4d86b5d4252d4e96801648c414b65ab0454e61c66ed0de4c');
  assert.equal(sha256RawBytes(read(REREVIEW_ATTEMPT_002)), REREVIEW_RECEIPT_002_SHA256);

  const diagnostic = JSON.parse(read(MISMATCHES_002));
  assert.equal(sha256RawBytes(read(MISMATCHES_002)), MISMATCHES_002_SHA256);
  assert.deepEqual(diagnostic,
    humanRereview.buildBatch002MismatchDiagnostic(buildBatch002Effective()));
  assert.equal(diagnostic.mismatches.length, artifact.reconciliation.mismatchCount);
  assert.deepEqual(diagnostic.mismatches.map(row => row.itemId),
    diagnostic.mismatches.map(row => row.itemId).toSorted());
  assert.deepEqual(diagnostic.authority, {
    humanDecisionsAltered: false,
    frozenSkeletonLabelsAltered: false,
    acceptanceOrRejectionPerformed: false,
    surfacesRepaired: false,
    neverExposedToBlindHumanReview: true,
  });
  const rows = new Map(artifact.rows.map(row => [row.itemId, row]));
  for (const row of diagnostic.mismatches) {
    assert.deepEqual(Object.keys(row), [
      'itemId', 'semanticSkeletonId', 'splitAssignment',
      'currentHumanDecision', 'frozenSkeletonHumanLabel',
    ]);
    assert.equal(row.currentHumanDecision, rows.get(row.itemId).decision);
    assert.equal(row.frozenSkeletonHumanLabel,
      skeletons.get(row.semanticSkeletonId).humanLabel);
    assert.equal(row.splitAssignment, skeletons.get(row.semanticSkeletonId).splitAssignment);
    assert.notEqual(row.currentHumanDecision, row.frozenSkeletonHumanLabel);
  }
  const serialized = JSON.stringify(artifact);
  for (const field of [
    'humanLabel', 'skeletonLabel', 'semanticSkeletonId', 'splitAssignment',
    'boundaryClass', 'selectedBundle', 'reason', 'sourceEpisodeId',
  ]) assert.equal(serialized.includes(`"${field}"`), false, field);
});

test('batch-002 pragmatic adjudication packet is exactly the 24 mismatches in 10 skeleton groups', () => {
  const effective = buildBatch002Effective();
  const packet = humanRereview.buildBatch002PragmaticAdjudicationPacket(
    effective, effective.rawOriginalPacket, effective.rawRereviewPacket, read(MISMATCHES_002),
  );
  assert.equal(sha256RawBytes(read(ADJUDICATION_002)), ADJUDICATION_002_SHA256);
  assert.deepEqual(JSON.parse(read(ADJUDICATION_002)), packet);

  assert.equal(sha256RawBytes(rawBatch002), REPAIRED_BATCH_SHA256);
  assert.equal(sha256RawBytes(read(EXACT56)), EXACT56_SHA256);
  assert.equal(sha256RawBytes(read(EFFECTIVE_002)), EFFECTIVE_002_SHA256);
  assert.equal(sha256RawBytes(read(MISMATCHES_002)), MISMATCHES_002_SHA256);

  const canonical = new Map(JSON.parse(read(MISMATCHES_002)).mismatches
    .map(row => [row.itemId, row.semanticSkeletonId]));
  assert.equal(canonical.size, 24);
  const items = packet.skeletonGroups.flatMap(group => group.items.map(row => row.itemId));
  assert.equal(items.length, 24);
  assert.equal(packet.skeletonGroups.length, 10);
  assert.equal(new Set(packet.skeletonGroups.map(group => group.semanticSkeletonId)).size, 10);
  assert.deepEqual(items.toSorted(), [...canonical.keys()].toSorted());
  assert.deepEqual(packet.summary, { mismatchItems: 24, skeletonGroups: 10 });
  assert.equal(packet.interpretationRule, 'CONSERVATIVE_PRAGMATIC_INTERPRETATION');
  assert.deepEqual(packet.adjudicationTaxonomy, [
    'SKELETON_SEMANTICS_NEEDS_REVISION', 'SURFACE_COLLAPSES_AMBIGUITY',
    'HUMAN_DECISION_NEEDS_REREVIEW', 'UNRESOLVED',
  ]);

  const batchItems = new Map(batch002.items.map(item => [item.itemId, item]));
  for (const group of packet.skeletonGroups) {
    const skeleton = skeletons.get(group.semanticSkeletonId);
    assert.deepEqual(Object.keys(group), ['semanticSkeletonId', 'splitAssignment',
      'boundaryClass', 'candidateFocus', 'semanticRelations', 'items']);
    assert.equal(group.splitAssignment, skeleton.splitAssignment);
    assert.equal(group.boundaryClass, skeleton.boundaryClass);
    assert.equal(group.candidateFocus, skeleton.candidateFocus);
    assert.deepEqual(group.semanticRelations, skeleton.semanticRelations);
    assert.deepEqual(group.items.map(row => row.itemId), group.items.map(row => row.itemId).toSorted());
    for (const row of group.items) {
      assert.deepEqual(Object.keys(row), ['itemId', 'selectedBundle']);
      assert.equal(canonical.get(row.itemId), group.semanticSkeletonId, row.itemId);
      assert.equal(row.selectedBundle,
        surfaces.renderHumanReviewText(batch002, batchItems.get(row.itemId)), row.itemId);
    }
  }
});

test('batch-002 pragmatic adjudication packet leaks no label, decision, or adjudication result', () => {
  const serialized = read(ADJUDICATION_002).toString('utf8');
  for (const field of [
    'currentHumanDecision', 'frozenSkeletonHumanLabel', 'humanLabel', 'skeletonLabel',
    'intendedLabel', 'generatorIntendedLabel', 'decision', 'disposition',
    'adjudication', 'adjudicationOutcome', 'result', 'recommendation',
  ]) assert.equal(serialized.includes(`"${field}"`), false, field);
  const packet = JSON.parse(serialized);
  assert.equal(packet.status, 'DIAGNOSTIC_ONLY_AWAITING_SEMANTIC_ADJUDICATION');
  assert.deepEqual(packet.authority, {
    humanDecisionsAltered: false,
    frozenSkeletonLabelsAltered: false,
    acceptanceOrRejectionPerformed: false,
    surfacesRepaired: false,
    adjudicationPerformed: false,
    neverExposedToBlindHumanReview: true,
  });
  const effective = JSON.parse(read(EFFECTIVE_002));
  assert.equal(effective.authority.humanReviewCompleted, false);
  assert.equal(effective.status, 'RECONCILIATION_NEEDS_FIX');
  assert.equal(acceptance.accepted.length, 30);
  assert.equal(fs.existsSync(fixture(
    'local-memory-inference-p1b6-smoke-batch-002-acceptance.json')), false);
});

test('batch-002 pragmatic adjudication packet fails closed on a non-mismatch or missing item', () => {
  const effective = buildBatch002Effective();
  const spliced = structuredClone(effective);
  const clean = spliced.artifact.rows.find(row => row.itemId === 'p1b6-item-b002-001');
  clean.decision = clean.decision === 'CLEAR' ? 'ESCALATE' : 'CLEAR';
  assert.throws(() => humanRereview.buildBatch002PragmaticAdjudicationPacket(
    spliced, effective.rawOriginalPacket, effective.rawRereviewPacket, read(MISMATCHES_002),
  ), /mismatch/);
});

test('batch-002 adjudication binds to the canonical mismatch diagnostic raw bytes', () => {
  const effective = buildBatch002Effective();
  const args = [effective.rawOriginalPacket, effective.rawRereviewPacket];
  assert.equal(sha256RawBytes(read(MISMATCHES_002)), MISMATCHES_002_SHA256);
  assert.deepEqual(humanRereview.validateBatch002MismatchDiagnostic(effective, read(MISMATCHES_002)),
    JSON.parse(read(MISMATCHES_002)));

  // A diagnostic whose bytes are not the canonical ones is refused outright.
  const retagged = humanRereview.packetBytes({
    ...JSON.parse(read(MISMATCHES_002)), status: 'DIAGNOSTIC_ONLY',
  });
  assert.notEqual(sha256RawBytes(retagged), MISMATCHES_002_SHA256);
  assert.throws(() => humanRereview.buildBatch002PragmaticAdjudicationPacket(
    effective, ...args, retagged,
  ), /mismatch diagnostic bytes are invalid/);

  // Count-preserving substitution: flip one clean row into a mismatch and one mismatch row
  // back into a match. The mismatch count stays 24 but the set differs, so it must fail.
  const substituted = structuredClone(effective);
  const rows = new Map(substituted.artifact.rows.map(row => [row.itemId, row]));
  const flip = row => { row.decision = row.decision === 'CLEAR' ? 'ESCALATE' : 'CLEAR'; };
  flip(rows.get('p1b6-item-b002-001'));
  flip(rows.get('p1b6-item-b002-022'));
  assert.equal(humanRereview.buildBatch002MismatchDiagnostic(substituted).mismatches.length, 24);
  assert.notDeepEqual(
    humanRereview.buildBatch002MismatchDiagnostic(substituted).mismatches.map(row => row.itemId),
    JSON.parse(read(MISMATCHES_002)).mismatches.map(row => row.itemId));
  assert.throws(() => humanRereview.buildBatch002PragmaticAdjudicationPacket(
    substituted, ...args, read(MISMATCHES_002),
  ), /does not bind to the current artifacts/);
  assert.throws(() => humanRereview.validateBatch002PragmaticAdjudicationReceipt(
    substituted, ...args, read(MISMATCHES_002), read(EFFECTIVE_002),
    read(ADJUDICATION_RECEIPT_002),
  ), /does not bind to the current artifacts/);
});

test('batch-002 semantic adjudication receipt routes exactly the canonical 24 mismatches', () => {
  const effective = buildBatch002Effective();
  const { receipt, revisionSkeletons } = humanRereview.validateBatch002PragmaticAdjudicationReceipt(
    effective, effective.rawOriginalPacket, effective.rawRereviewPacket,
    read(MISMATCHES_002), read(EFFECTIVE_002), read(ADJUDICATION_RECEIPT_002),
  );
  assert.equal(sha256RawBytes(read(ADJUDICATION_RECEIPT_002)), ADJUDICATION_RECEIPT_002_SHA256);
  assert.deepEqual(JSON.parse(read(ADJUDICATION_RECEIPT_002)), receipt);
  assert.equal(receipt.name, humanRereview.BATCH002_ADJUDICATION_RECEIPT_IDENTITY);
  assert.equal(receipt.status, 'COMPLETE_WITH_HUMAN_REREVIEW_REQUIRED');
  assert.equal(receipt.interpretationRule, 'CONSERVATIVE_PRAGMATIC_INTERPRETATION');

  assert.deepEqual(receipt.summary, {
    total: 24,
    SKELETON_SEMANTICS_NEEDS_REVISION: 10,
    SURFACE_COLLAPSES_AMBIGUITY: 11,
    HUMAN_DECISION_NEEDS_REREVIEW: 3,
    UNRESOLVED: 0,
  });

  // Every row is one of the canonical 24, each appears exactly once, nothing else enters.
  const canonical = JSON.parse(read(MISMATCHES_002)).mismatches.map(row => row.itemId);
  assert.equal(canonical.length, 24);
  assert.equal(receipt.rows.length, 24);
  assert.deepEqual(receipt.rows.map(row => row.itemId), canonical.toSorted());
  assert.deepEqual(receipt.rows.map(row => row.itemId), receipt.rows.map(row => row.itemId).toSorted());
  assert.equal(new Set(receipt.rows.map(row => row.itemId)).size, 24);
  for (const row of receipt.rows) {
    assert.deepEqual(Object.keys(row), ['itemId', 'outcome']);
    assert.equal(canonical.includes(row.itemId), true, row.itemId);
    assert.equal(humanRereview.ADJUDICATION_TAXONOMY.includes(row.outcome), true, row.outcome);
  }
  const byOutcome = outcome => receipt.rows.filter(row => row.outcome === outcome)
    .map(row => row.itemId);
  assert.deepEqual(byOutcome('HUMAN_DECISION_NEEDS_REREVIEW'),
    ['p1b6-item-b002-027', 'p1b6-item-b002-040', 'p1b6-item-b002-061']);
  assert.equal(byOutcome('UNRESOLVED').length, 0);

  // The receipt binds to every canonical artifact and assigns no HUMAN gold.
  assert.equal(receipt.currentSourceBatch.rawSha256, REPAIRED_BATCH_SHA256);
  assert.equal(receipt.exact56.rawSha256, EXACT56_SHA256);
  assert.equal(receipt.effectiveHumanDecisionArtifact.rawSha256, EFFECTIVE_002_SHA256);
  assert.equal(receipt.mismatchDiagnostic.rawSha256, MISMATCHES_002_SHA256);
  assert.equal(receipt.pragmaticAdjudicationPacket.rawSha256, ADJUDICATION_002_SHA256);
  assert.equal(receipt.authority.humanGoldAssigned, false);
  assert.equal(receipt.authority.humanDecisionsAltered, false);
  assert.equal(receipt.authority.frozenSkeletonLabelsAltered, false);
  assert.equal(receipt.authority.exact56Amended, false);
  assert.equal(receipt.authority.surfacesRepaired, false);
  assert.equal(receipt.authority.acceptanceOrRejectionPerformed, false);
  for (const field of ['decision', 'disposition', 'humanLabel', 'currentHumanDecision',
    'frozenSkeletonHumanLabel', 'selectedBundle']) {
    assert.equal(read(ADJUDICATION_RECEIPT_002).toString('utf8').includes(`"${field}"`), false, field);
  }

  // The 10 revision rows span exactly three unique frozen skeletons; none is amended here.
  const skeletonOf = new Map(JSON.parse(read(MISMATCHES_002)).mismatches
    .map(row => [row.itemId, row.semanticSkeletonId]));
  assert.deepEqual(receipt.pendingResolutions.exact56SemanticAmendment.semanticSkeletonIds,
    [...new Set(byOutcome('SKELETON_SEMANTICS_NEEDS_REVISION').map(id => skeletonOf.get(id)))].toSorted());
  assert.deepEqual(revisionSkeletons,
    receipt.pendingResolutions.exact56SemanticAmendment.semanticSkeletonIds);
  assert.equal(receipt.pendingResolutions.exact56SemanticAmendment.semanticSkeletonIds.length, 3);
  assert.equal(receipt.pendingResolutions.surfaceRepairOrDatasetRejection.itemCount, 11);
  assert.equal(receipt.pendingResolutions.freshBlindHumanRereview.itemCount, 3);
});

test('batch-002 semantic adjudication receipt fails closed on tampered routing', () => {
  const effective = buildBatch002Effective();
  const args = [effective.rawOriginalPacket, effective.rawRereviewPacket,
    read(MISMATCHES_002), read(EFFECTIVE_002)];
  const receipt = JSON.parse(read(ADJUDICATION_RECEIPT_002));

  // A non-mismatch item may not enter the receipt.
  const injected = structuredClone(receipt);
  injected.rows[0] = { itemId: 'p1b6-item-b002-001', outcome: 'UNRESOLVED' };

  // Counts may not drift from 10 / 11 / 3 / 0.
  const recounted = structuredClone(receipt);
  recounted.rows.find(row => row.outcome === 'HUMAN_DECISION_NEEDS_REREVIEW').outcome =
    'SURFACE_COLLAPSES_AMBIGUITY';

  // The receipt may not claim authority it does not have.
  const overreaching = structuredClone(receipt);
  overreaching.authority.humanGoldAssigned = true;

  for (const tampered of [injected, recounted, overreaching]) {
    assert.throws(() => humanRereview.validateBatch002PragmaticAdjudicationReceipt(
      effective, ...args, humanRereview.packetBytes(tampered)),
    /semantic adjudication receipt bytes are invalid/);
  }
});

test('count-preserving routing reassignment cannot change the attempt-003 population', () => {
  const effective = buildBatch002Effective();
  const args = [effective.rawOriginalPacket, effective.rawRereviewPacket,
    read(MISMATCHES_002), read(EFFECTIVE_002)];
  const canonical = JSON.parse(read(ADJUDICATION_RECEIPT_002));

  // Swap one HUMAN_DECISION_NEEDS_REREVIEW row with one SURFACE_COLLAPSES_AMBIGUITY row.
  // Every aggregate check still passes: same 24 item IDs, same 10/11/3/0 counts, same
  // batch / Exact56 / mismatch-diagnostic metadata. Only WHO faces the blind review moves.
  const swapped = structuredClone(canonical);
  const rowFor = itemId => swapped.rows.find(row => row.itemId === itemId);
  const moveOut = rowFor('p1b6-item-b002-027');
  const moveIn = rowFor('p1b6-item-b002-022');
  assert.equal(moveOut.outcome, 'HUMAN_DECISION_NEEDS_REREVIEW');
  assert.equal(moveIn.outcome, 'SURFACE_COLLAPSES_AMBIGUITY');
  [moveOut.outcome, moveIn.outcome] = [moveIn.outcome, moveOut.outcome];

  const rawSwapped = humanRereview.packetBytes(swapped);
  assert.deepEqual(swapped.rows.map(row => row.itemId), canonical.rows.map(row => row.itemId));
  assert.deepEqual(swapped.summary, canonical.summary);
  assert.deepEqual(swapped.currentSourceBatch, canonical.currentSourceBatch);
  assert.deepEqual(swapped.exact56, canonical.exact56);
  assert.deepEqual(swapped.mismatchDiagnostic, canonical.mismatchDiagnostic);
  for (const outcome of humanRereview.ADJUDICATION_TAXONOMY) {
    assert.equal(swapped.rows.filter(row => row.outcome === outcome).length,
      canonical.rows.filter(row => row.outcome === outcome).length, outcome);
  }
  assert.notEqual(sha256RawBytes(rawSwapped), ADJUDICATION_RECEIPT_002_SHA256);

  // Both receipt consumers refuse the mutated bytes outright.
  assert.throws(() => humanRereview.validateBatch002PragmaticAdjudicationReceipt(
    effective, ...args, rawSwapped), /semantic adjudication receipt bytes are invalid/);
  assert.throws(() => humanRereview.buildBatch002RereviewAttempt003Packet(
    rawBatch002, currentAuditReceipt002, rawSwapped),
  /semantic adjudication receipt bytes are invalid/);

  // The canonical receipt still validates and still yields exactly the same three rows.
  assert.doesNotThrow(() => humanRereview.validateBatch002PragmaticAdjudicationReceipt(
    effective, ...args, read(ADJUDICATION_RECEIPT_002)));
  const packet = humanRereview.buildBatch002RereviewAttempt003Packet(
    rawBatch002, currentAuditReceipt002, read(ADJUDICATION_RECEIPT_002));
  assert.deepEqual(packet.rows.map(row => row.reviewRowId).toSorted(), REREVIEW_003_ROW_IDS);
  assert.equal(sha256RawBytes(humanRereview.packetBytes(packet)), REREVIEW_003_PACKET_SHA256);
});

test('batch-002 attempt-003 blind packet is exactly the three re-review rows and leaks nothing', () => {
  const rawReceipt = read(ADJUDICATION_RECEIPT_002);
  const packet = humanRereview.buildBatch002RereviewAttempt003Packet(
    rawBatch002, currentAuditReceipt002, rawReceipt,
  );
  const rawPacket = humanRereview.packetBytes(packet);
  assert.equal(sha256RawBytes(rawPacket), REREVIEW_003_PACKET_SHA256);
  assert.equal(packet.name, 'xion-local-memory-inference-p1b6-primary-human-rereview-packet-v1');
  assert.equal(packet.attemptId, 'p1b6-primary-human-rereview-batch-002-attempt-003');
  assert.equal(packet.sourceBatch.sha256, REPAIRED_BATCH_SHA256);
  assert.equal(packet.rendererIdentity, surfaces.RENDERER_IDENTITY);

  // Exactly three rows, derived mechanically from the receipt outcomes, not hard-coded here.
  const expected = JSON.parse(rawReceipt).rows
    .filter(row => row.outcome === 'HUMAN_DECISION_NEEDS_REREVIEW').map(row => row.itemId);
  assert.deepEqual(expected, ['p1b6-item-b002-027', 'p1b6-item-b002-040', 'p1b6-item-b002-061']);
  assert.equal(packet.rows.length, 3);
  assert.deepEqual(packet.rows.map(row => row.reviewRowId).toSorted(), REREVIEW_003_ROW_IDS);
  assert.deepEqual(packet.rows.map(row => row.reviewRowId),
    expected.map(itemId => humanRereview.opaqueRereviewRowId(REPAIRED_BATCH_SHA256, itemId)).toSorted());

  // HUMAN-facing rows carry only an opaque ID and the canonical renderer output.
  const batchItems = new Map(batch002.items.map(item => [item.itemId, item]));
  const bundles = new Map(expected.map(itemId => [
    humanRereview.opaqueRereviewRowId(REPAIRED_BATCH_SHA256, itemId),
    surfaces.renderHumanReviewText(batch002, batchItems.get(itemId)),
  ]));
  for (const row of packet.rows) {
    assert.deepEqual(Object.keys(row), ['reviewRowId', 'selectedBundle']);
    assert.equal(row.selectedBundle, bundles.get(row.reviewRowId), row.reviewRowId);
  }

  // No adjudication, skeleton, or prior-label leakage reaches the blind reviewer.
  const serialized = rawPacket.toString('utf8');
  for (const field of ['itemId', 'semanticSkeletonId', 'splitAssignment', 'boundaryClass',
    'decision', 'disposition', 'humanLabel', 'skeletonLabel', 'intendedLabel', 'outcome',
    'currentHumanDecision', 'frozenSkeletonHumanLabel', 'adjudication', 'recommendation',
    'expectedAnswer']) assert.equal(serialized.includes(`"${field}"`), false, field);
  assert.equal(/p1b6-item-b002/.test(serialized), false);
  assert.equal(/p1b6-sk-/.test(serialized), false);

  // The blind review has not been performed: no attempt-003 decision receipt exists.
  assert.equal(fs.existsSync(fixture(
    'local-memory-inference-p1b6-primary-human-rereview-batch-002-attempt-003.json')), false);
});

test('batch-002 acceptance and gold freeze have not been opened', () => {
  assert.equal(fs.existsSync(fixture(
    'local-memory-inference-p1b6-smoke-batch-002-acceptance.json')), false);
  assert.equal(acceptance.accepted.length, 30);
  assert.equal(protocol.authority.sourceAuditCompleted, true);
  assert.equal(protocol.authority.finalCorpusHumanGoldFrozen, false);
  assert.equal(protocol.authority.trainingOccurred, false);
  assert.equal(effectiveBatch001.authority.surfaceHumanGoldFrozen, false);
  // Semantic adjudication is routing, not acceptance: nothing downstream opened.
  assert.equal(JSON.parse(read(EFFECTIVE_002)).authority.humanReviewCompleted, false);
  assert.equal(JSON.parse(read(ADJUDICATION_RECEIPT_002)).authority.humanGoldAssigned, false);
  for (const file of [
    'local-memory-inference-p1b6-primary-human-rereview-batch-002-attempt-003.json',
    'local-memory-inference-p1b6-smoke-batch-002-acceptance.json',
  ]) assert.equal(fs.existsSync(fixture(file)), false, file);
});

test('batch-001, smoke acceptance, exact56, and all historical evidence remain byte-identical', () => {
  const hashes = {
    [BATCH_001]: '2a4605f5550118754c315e26700aef1be96a3129a3ef0065fd2accdad5352a36',
    [BATCH_002]: REPAIRED_BATCH_SHA256,
    [AUDIT_ATTEMPT_002_CURRENT]: CURRENT_AUDIT_RECEIPT_SHA256,
    [REREVIEW_ATTEMPT_002]:
      '141070c2e1485294a64c73d69de12dee867ce81ba1b66a3b9b189d61d84d67f3',
    'local-memory-inference-p1b6-surface-batch-001-authoring-protocol.json':
      '3591d7db8b98ed7ee016533346908122832068e470dfdfd61a685e1670c13909',
    [ACCEPTANCE]: '449318d5d3895fca87257a40b7d47b6d8d8eb3df8e9817fff5998a34d658bb5c',
    [EXACT56]: '772f07bd679a9c98ea65feaa164ec7a9c1f3e3fb33632052ef076f8301999602',
    [AUDIT_ATTEMPT_002]: '3cd73b58ed803d468ed0d668412dcbf46fb330f65f0adaa1859e5502279b619b',
    [HUMAN_ATTEMPT_002]: '6c2d8fabaf6c9caa4d86b5d4252d4e96801648c414b65ab0454e61c66ed0de4c',
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
    [EFFECTIVE_002]: EFFECTIVE_002_SHA256,
    [MISMATCHES_002]: MISMATCHES_002_SHA256,
    [ADJUDICATION_002]: ADJUDICATION_002_SHA256,
    [ADJUDICATION_RECEIPT_002]: ADJUDICATION_RECEIPT_002_SHA256,
  };
  for (const [file, expected] of Object.entries(hashes)) assert.equal(sha256RawBytes(read(file)), expected, file);
});
