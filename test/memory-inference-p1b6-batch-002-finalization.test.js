'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const humanPacketBuilder =
  require('../scripts/build-memory-inference-p1b6-surface-repair-human-review-packet');
const finalization = require('../scripts/build-memory-inference-p1b6-batch-002-finalization');

const ROOT = path.resolve(__dirname, '..');
const fixture = file => path.join(ROOT, 'fixtures', file);
const read = file => fs.readFileSync(fixture(file));
const readJson = file => JSON.parse(read(file));

const REJECTED = finalization.REJECTED_ITEM_ID;
const BATCH_002 = 'local-memory-inference-p1b6-surface-batch-002.json';
const CANDIDATE = 'local-memory-inference-p1b6-surface-repair-candidate-batch-002.json';
const HUMAN_V2 = 'local-memory-inference-p1b6-primary-human-effective-current-batch-002-v2.json';
const CATALOG = 'local-memory-inference-p1b6-skeleton-effective-current.json';
const HUMAN_RECEIPT =
  'local-memory-inference-p1b6-surface-repair-primary-human-review-batch-002-attempt-001.json';
const CORRECTION =
  'local-memory-inference-p1b6-surface-repair-human-review-provenance-correction.json';

const SURFACE_SUCCESSOR_SHA256 =
  '9701db8902ae99dc5c08cffb176bf9247443884910e3002b77548ac5436157d1';
const HUMAN_SUCCESSOR_SHA256 =
  '32b2221e2cefdb9a1a7e47efa1f5accd3d2a915c3f418578dc8f1c314b5281c4';
const ACCEPTANCE_SHA256 = 'c03b8dcf4ddcb2c5f8b193cde8247b9ad64b8ea676da51cab1d709795b273598';

// Historical artifacts this step must leave byte-identical.
const UNCHANGED = Object.freeze({
  'lib/memory-inference-p1b6-surfaces.js':
    '4b6dabf2280529b138efe124f32252c2ff7a2b9a118d7eb2c2b3341c7c56f1b7',
  'fixtures/local-memory-inference-p1b6-skeleton-exact56.json':
    '772f07bd679a9c98ea65feaa164ec7a9c1f3e3fb33632052ef076f8301999602',
  [`fixtures/${BATCH_002}`]:
    'ed68a562a67deee4d8e92d3e4841362d9589f876480d174a043d822cbf61e80c',
  [`fixtures/${CATALOG}`]:
    '48490b6e4e1494856ef3268d944da16093c4735d207e07c1fd9e8bbf69df2559',
  [`fixtures/${CANDIDATE}`]:
    'd59d0dec225d3f4fea74952da10e05b8f0be01942a3aa6e15ea58d659e22abb3',
  [`fixtures/${HUMAN_V2}`]:
    'a96fc01393c79057d292cf10b565589e7448b86289eb52b8cd1c63657af2ed05',
  [`fixtures/${HUMAN_RECEIPT}`]:
    'cab70e8a277189e0eee1847adcc89e114139363f20cebb95d39c7153fac30f04',
  'fixtures/local-memory-inference-p1b6-surface-repair-source-audit-batch-002-attempt-001.json':
    'd08bf4488d4fa4a89c8f03172c4569405093051e939fea395a85b5fafda254b9',
  'fixtures/local-memory-inference-p1b6-smoke-batch-001-acceptance.json':
    '449318d5d3895fca87257a40b7d47b6d8d8eb3df8e9817fff5998a34d658bb5c',
});

const inputs = () => finalization.loadCanonicalInputs();
const build = (supplied = inputs()) => finalization.buildBatch002Finalization(supplied);
const bytes = finalization.artifactBytes;

test('the committed artifacts regenerate deterministically from canonical inputs', () => {
  const built = build();
  assert.equal(sha256RawBytes(bytes(built.surfaceSuccessor)), SURFACE_SUCCESSOR_SHA256);
  assert.equal(sha256RawBytes(bytes(built.humanSuccessor)), HUMAN_SUCCESSOR_SHA256);
  assert.equal(sha256RawBytes(bytes(built.acceptance)), ACCEPTANCE_SHA256);
  assert.deepEqual(bytes(built.surfaceSuccessor), read(finalization.SURFACE_SUCCESSOR_FILE));
  assert.deepEqual(bytes(built.humanSuccessor), read(finalization.HUMAN_SUCCESSOR_FILE));
  assert.deepEqual(bytes(built.acceptance), read(finalization.ACCEPTANCE_FILE));
  assert.deepEqual(bytes(build().surfaceSuccessor), bytes(built.surfaceSuccessor));
});

test('the population is exactly 51 inherited + 12 repaired + 1 rejected', () => {
  const { surfaceSuccessor, acceptance } = build();
  const historical = readJson(BATCH_002);
  const candidate = readJson(CANDIDATE);

  assert.equal(historical.items.length, 64);
  assert.equal(surfaceSuccessor.items.length, 63);
  assert.equal(new Set(surfaceSuccessor.items.map(row => row.itemId)).size, 63);
  assert.deepEqual(surfaceSuccessor.coverage, {
    reviewedOriginal: 64, inherited: 51, repaired: 12, rejected: 1, total: 63,
    humanDecisionCounts: { CLEAR: 39, ESCALATE: 24 },
  });

  const origins = surfaceSuccessor.items.reduce((counts, row) => {
    counts[row.realizationOrigin] = (counts[row.realizationOrigin] || 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(origins,
    { INHERITED_HISTORICAL_BATCH_002: 51, REPAIRED_PHASE_B_CANDIDATE: 12 });

  // 050 is absent from the successor and present exactly once in the rejected set.
  assert.equal(surfaceSuccessor.items.some(row => row.itemId === REJECTED), false);
  assert.equal(acceptance.accepted.some(row => row.itemId === REJECTED), false);
  assert.deepEqual(acceptance.rejected.map(row => row.itemId), [REJECTED]);
  assert.equal(acceptance.rejected[0].rejectedScope, 'CURRENT_SURFACE_REALIZATION_ONLY');
  assert.equal(acceptance.rejected[0].skeletonAmended, false);
  assert.equal(acceptance.rejected[0].replacementAuthored, false);

  // The rejection reason is the existing Phase B one, not a newly invented one.
  const resolution = readJson('local-memory-inference-p1b6-surface-repair-resolution-batch-002-receipt.json');
  assert.equal(acceptance.rejected[0].reason,
    resolution.decisions.find(row => row.itemId === REJECTED).rejectionRationale);

  // Every successor item ID came from one of the two canonical sources.
  const known = new Set([...historical.items, ...candidate.items].map(row => row.itemId));
  assert.equal(surfaceSuccessor.items.every(row => known.has(row.itemId)), true);
});

test('inherited and repaired rows are carried verbatim from their canonical sources', () => {
  const { surfaceSuccessor } = build();
  const historicalItems = new Map(readJson(BATCH_002).items.map(row => [row.itemId, row]));
  const historicalEpisodes = new Map(readJson(BATCH_002).sourceEpisodes
    .map(row => [row.sourceEpisodeId, row]));
  const candidateItems = new Map(readJson(CANDIDATE).items.map(row => [row.itemId, row]));
  const candidateEpisodes = new Map(readJson(CANDIDATE).sourceEpisodes
    .map(row => [row.sourceEpisodeId, row]));
  const successorEpisodes = new Map(surfaceSuccessor.sourceEpisodes
    .map(row => [row.sourceEpisodeId, row]));

  const added = ['realizationOrigin', 'humanDecision', 'humanDecisionSource'];
  for (const row of surfaceSuccessor.items) {
    const repaired = row.realizationOrigin === 'REPAIRED_PHASE_B_CANDIDATE';
    const source = repaired ? candidateItems.get(row.itemId) : historicalItems.get(row.itemId);
    assert.equal(Boolean(source), true, row.itemId);

    // Item content is identical once the three acceptance annotations are removed.
    const carried = { ...row };
    for (const key of added) delete carried[key];
    assert.deepEqual(carried, source, row.itemId);

    // Episodes, including repaired offsets and text, are byte-identical to their source.
    const sourceEpisode = repaired
      ? candidateEpisodes.get(row.sourceEpisodeId)
      : historicalEpisodes.get(row.sourceEpisodeId);
    assert.deepEqual(successorEpisodes.get(row.sourceEpisodeId), sourceEpisode, row.itemId);
  }
});

test('no old HUMAN decision reaches repaired text and fresh IDs map mechanically', () => {
  const { surfaceSuccessor, humanSuccessor } = build();
  const candidate = readJson(CANDIDATE);
  const receipt = readJson(HUMAN_RECEIPT);
  const oldDecisions = new Map(readJson(HUMAN_V2).rows.map(row => [row.itemId, row.decision]));
  const candidateSha = finalization.CANONICAL_INPUTS.repairCandidate.rawSha256;

  // The opaque fresh review IDs map back to exactly the 12 repair item IDs.
  const mapped = new Map(candidate.items
    .map(item => [humanPacketBuilder.opaqueReviewRowId(candidateSha, item.itemId), item.itemId]));
  assert.equal(mapped.size, 12);
  assert.equal(receipt.rows.length, 12);
  assert.equal(receipt.rows.every(row => mapped.has(row.reviewRowId)), true);
  assert.deepEqual(receipt.rows.map(row => mapped.get(row.reviewRowId)).toSorted(),
    candidate.items.map(item => item.itemId).toSorted());

  const freshByItem = new Map(receipt.rows.map(row => [mapped.get(row.reviewRowId), row.decision]));
  const repairedIds = new Set(candidate.items.map(item => item.itemId));

  for (const row of surfaceSuccessor.items) {
    if (!repairedIds.has(row.itemId)) {
      assert.equal(row.humanDecision, oldDecisions.get(row.itemId), row.itemId);
      assert.equal(row.humanDecisionSource,
        finalization.CANONICAL_INPUTS.historicalHuman.identity, row.itemId);
      continue;
    }
    assert.equal(row.humanDecision, freshByItem.get(row.itemId), row.itemId);
    assert.equal(row.humanDecisionSource,
      finalization.CANONICAL_INPUTS.humanReviewReceipt.identity, row.itemId);
  }

  // Every one of the 13 excluded historical decisions was CLEAR, and none of them survived onto
  // repaired text: the repaired rows all carry the fresh ESCALATE instead.
  for (const itemId of [...repairedIds, REJECTED]) {
    assert.equal(oldDecisions.get(itemId), 'CLEAR', itemId);
  }
  assert.equal(humanSuccessor.rows.filter(row => repairedIds.has(row.itemId))
    .every(row => row.decision === 'ESCALATE'), true);
  assert.equal(humanSuccessor.authority.oldHumanDecisionsTransferredToRepairedText, false);
  assert.equal(humanSuccessor.rows.some(row => row.itemId === REJECTED), false);
});

test('effective HUMAN successor, reconciliation and acceptance agree mechanically', () => {
  const { humanSuccessor, acceptance, surfaceSuccessor } = build();
  assert.deepEqual(humanSuccessor.summary,
    { total: 63, KEEP: 63, FIX: 0, REJECT: 0, CLEAR: 39, ESCALATE: 24 });
  assert.deepEqual(humanSuccessor.summary, finalization.EXPECTED_HUMAN_SUMMARY);

  // Reconciliation is recomputed here against the effective-current catalog, not copied.
  const labels = new Map(readJson(CATALOG).candidates
    .map(row => [row.semanticSkeletonId, row.humanLabel]));
  const mismatches = surfaceSuccessor.items
    .filter(row => labels.get(row.semanticSkeletonId) !== row.humanDecision);
  assert.deepEqual(mismatches.map(row => row.itemId), []);
  assert.equal(humanSuccessor.reconciliation.matchCount, 63);
  assert.equal(humanSuccessor.reconciliation.mismatchCount, 0);
  assert.equal(humanSuccessor.reconciliation.against,
    'xion-local-memory-inference-p1b6-skeleton-effective-current-v1');
  assert.equal(acceptance.reconciliation.historicalExact56Role,
    'IMMUTABLE_PROVENANCE_NOT_SEMANTIC_AUTHORITY');

  assert.deepEqual(acceptance.summary,
    { reviewed: 64, accepted: 63, rejected: 1, unresolved: 0 });
  assert.equal(acceptance.accepted.length, 63);
  assert.equal(acceptance.corpusGrowth.smokeBatch001Accepted, 30);
  assert.equal(acceptance.corpusGrowth.batch002Accepted, 63);
  assert.equal(acceptance.corpusGrowth.cumulativeAcceptedSurfacePool, 93);
  assert.equal(finalization.EXPECTED_CUMULATIVE_ACCEPTED_POOL, 93);

  // Accepted rows carry their authoritative decision, matching the surface successor.
  const byItem = new Map(surfaceSuccessor.items.map(row => [row.itemId, row.humanDecision]));
  for (const row of acceptance.accepted) {
    assert.equal(row.decision, byItem.get(row.itemId), row.itemId);
  }

  // Nothing downstream was opened.
  for (const key of ['finalCorpusHumanGoldFrozen', 'heldRepeatedReviewCompleted',
    'heldOutReleasePerformed', 'finalSelectionPerformed', 'trainingOccurred',
    'finalModelOutputsInspected', 'p1b6CorpusComplete', 'repairedRowsIndependentlyConfirmed']) {
    assert.equal(acceptance.authority[key], false, key);
  }
});

test('the provenance correction narrows authorship without claiming independence', () => {
  const correction = readJson(CORRECTION);
  assert.equal(sha256RawBytes(read(CORRECTION)),
    finalization.CANONICAL_INPUTS.provenanceCorrection.rawSha256);

  // It names the historical receipt by identity and raw SHA, and leaves its bytes alone.
  assert.equal(correction.correctedArtifact.rawSha256,
    finalization.CANONICAL_INPUTS.humanReviewReceipt.rawSha256);
  assert.equal(correction.correctedArtifact.bytesAmended, false);
  assert.equal(correction.authority.historicalReceiptBytesAltered, false);
  assert.equal(correction.authority.humanDecisionsAltered, false);

  // It identifies the exact inaccurate claim and corrects only literal authorship.
  assert.equal(correction.inaccurateClaim.field,
    'reviewIndependence.reviewerAuthoredTheRepairs');
  assert.equal(correction.inaccurateClaim.recordedValue, true);
  assert.equal(correction.correction.reviewerPersonallyAuthoredAllTwelveRepairedSurfaceTexts,
    false);
  assert.equal(correction.correction.reviewerPerformedFinalHumanJudgments, true);
  assert.equal(correction.correction.interpretationRule
    .includes('MUST NOT be interpreted as literal surface-text authorship'), true);

  // The real limitation survives the correction, and independence is never claimed.
  assert.equal(correction.preservedLimitation.reviewerKnewEveryPresentedRowWasARepair, true);
  assert.equal(correction.preservedLimitation.reviewerKnewThePurposeWasToRestoreAmbiguity, true);
  assert.equal(correction.preservedLimitation.reviewerIndependentConfirmationEstablished, false);
  assert.equal(correction.preservedLimitation.statement.includes('does NOT establish'), true);
  assert.equal(correction.authority.reviewerIndependenceClaimed, false);

  // The 12 HUMAN decisions are untouched by the correction.
  const receipt = readJson(HUMAN_RECEIPT);
  assert.equal(receipt.rows.length, 12);
  assert.equal(receipt.rows.every(row => row.disposition === 'KEEP'
    && row.decision === 'ESCALATE'), true);
  assert.equal(JSON.stringify(correction).includes('reviewRowId'), false);

  // The successor and acceptance both carry the correction forward, still non-independent.
  const { humanSuccessor, acceptance } = build();
  assert.equal(humanSuccessor.reviewIndependence.repairedRowsIndependentlyConfirmed, false);
  assert.equal(acceptance.bindings.humanReviewProvenanceCorrection.rawSha256,
    finalization.CANONICAL_INPUTS.provenanceCorrection.rawSha256);
});

test('finalization fails closed on drift, a reintroduced 050, or an inherited decision', () => {
  for (const key of Object.keys(finalization.CANONICAL_INPUTS)) {
    const byteDrift = inputs();
    const marked = JSON.parse(byteDrift[key].toString('utf8'));
    marked.driftMarker = true;
    byteDrift[key] = bytes(marked);
    assert.throws(() => build(byteDrift), /bytes are not the canonical evidence/, `${key} bytes`);

    const identityDrift = inputs();
    const renamed = JSON.parse(identityDrift[key].toString('utf8'));
    renamed.name = 'xion-local-memory-inference-p1b6-not-canonical-v1';
    identityDrift[key] = bytes(renamed);
    assert.throws(() => build(identityDrift),
      /bytes are not the canonical evidence|identity is not canonical/, `${key} identity`);

    const missing = inputs();
    delete missing[key];
    assert.throws(() => build(missing), /bytes were not supplied/, `${key} missing`);
  }
  assert.throws(() => finalization.buildBatch002Finalization(undefined), /were not supplied/);

  // A correction that claims independence or erases the limitation is refused on content.
  for (const mutate of [
    c => { c.authority.reviewerIndependenceClaimed = true; },
    c => { c.preservedLimitation.reviewerIndependentConfirmationEstablished = true; },
    c => { c.preservedLimitation.statement = 'Independently confirmed.'; },
    c => { c.correction.reviewerPersonallyAuthoredAllTwelveRepairedSurfaceTexts = true; },
    c => { c.correctedArtifact.bytesAmended = true; },
    c => { c.authority.humanDecisionsAltered = true; },
  ]) {
    const drifted = structuredClone(readJson(CORRECTION));
    mutate(drifted);
    assert.throws(() => finalization.verifyProvenanceCorrection(bytes(drifted),
      finalization.CANONICAL_INPUTS.humanReviewReceipt.rawSha256),
    /P1-B6 batch-002 finalization/, 'correction content');
  }
  assert.doesNotThrow(() => build());
});

test('historical artifacts stay byte-identical and nothing downstream is opened', () => {
  for (const [file, sha] of Object.entries(UNCHANGED)) {
    assert.equal(sha256RawBytes(fs.readFileSync(path.join(ROOT, file))), sha, file);
  }

  // The historical 64-row batch and its 64-row HUMAN artifact are not superseded in place.
  assert.equal(readJson(BATCH_002).items.length, 64);
  assert.equal(readJson(HUMAN_V2).rows.length, 64);
  const { surfaceSuccessor, humanSuccessor } = build();
  assert.equal(surfaceSuccessor.authority.historicalBatchSuperseded, false);
  assert.equal(humanSuccessor.supersededScope.rawSha256,
    finalization.CANONICAL_INPUTS.historicalHuman.rawSha256);

  // The smoke batch-001 acceptance is not reopened.
  const smoke = readJson('local-memory-inference-p1b6-smoke-batch-001-acceptance.json');
  assert.equal(smoke.summary.accepted, 30);
  assert.equal(smoke.summary.rejected, 2);

  for (const artifact of [surfaceSuccessor, humanSuccessor]) {
    assert.equal(artifact.authority.finalCorpusHumanGoldFrozen, false);
    assert.equal(artifact.authority.heldOutReleasePerformed, false);
    assert.equal(artifact.authority.finalSelectionPerformed, false);
    assert.equal(artifact.authority.trainingOccurred, false);
  }
});
