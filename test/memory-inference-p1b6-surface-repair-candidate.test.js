'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const repair = require('../scripts/build-memory-inference-p1b6-surface-repair-candidate');

const ROOT = path.resolve(__dirname, '..');
const fixture = file => path.join(ROOT, 'fixtures', file);
const read = file => fs.readFileSync(fixture(file));
const readJson = file => JSON.parse(read(file));

const RECEIPT = repair.RECEIPT_FILE;
const CANDIDATE = repair.CANDIDATE_FILE;
const BATCH_002 = 'local-memory-inference-p1b6-surface-batch-002.json';
const EXACT56 = 'local-memory-inference-p1b6-skeleton-exact56.json';
const EFFECTIVE_CATALOG = 'local-memory-inference-p1b6-skeleton-effective-current.json';
const AMENDMENT_RECEIPT = 'local-memory-inference-p1b6-skeleton-semantic-amendment-receipt.json';
const ADJUDICATION_RECEIPT =
  'local-memory-inference-p1b6-pragmatic-adjudication-batch-002-receipt.json';
const HUMAN_002_V2 = 'local-memory-inference-p1b6-primary-human-effective-current-batch-002-v2.json';
const REREVIEW_003 = 'local-memory-inference-p1b6-primary-human-rereview-batch-002-attempt-003.json';

const RECEIPT_SHA256 = '792cb050b08375fd6dec9e8ce2b1a04787760123496b3dfed601aac984f4626d';
const CANDIDATE_SHA256 = 'd59d0dec225d3f4fea74952da10e05b8f0be01942a3aa6e15ea58d659e22abb3';
const REJECTED = 'p1b6-item-b002-050';

const historicalSources = () => Object.fromEntries(
  Object.entries(repair.HISTORICAL_SOURCES).map(([key, pinned]) => [key, read(pinned.fixture)]));
const rebuild = (rawReceipt = read(RECEIPT), sources = historicalSources()) =>
  repair.buildRepairCandidateBatch(rawReceipt, sources);
const rebuiltCandidate = () => rebuild();

test('historical raw-SHA-bound inputs are unchanged and still pinned by constant', () => {
  const onDisk = {
    exact56: [EXACT56, '772f07bd679a9c98ea65feaa164ec7a9c1f3e3fb33632052ef076f8301999602'],
    effectiveCatalog:
      [EFFECTIVE_CATALOG, '48490b6e4e1494856ef3268d944da16093c4735d207e07c1fd9e8bbf69df2559'],
    amendmentReceipt:
      [AMENDMENT_RECEIPT, '2778f64cf9f8f15bc85b7d015b706f5e87ad20e9dafc1249357477b235744977'],
    sourceBatch: [BATCH_002, 'ed68a562a67deee4d8e92d3e4841362d9589f876480d174a043d822cbf61e80c'],
    adjudicationReceipt:
      [ADJUDICATION_RECEIPT, 'cf05f5073fc30f19078aab1a0c081b59face607a041387bf5421ffa2af8bbdaa'],
    humanEffective: [HUMAN_002_V2, 'a96fc01393c79057d292cf10b565589e7448b86289eb52b8cd1c63657af2ed05'],
    humanRereview: [REREVIEW_003, '182fcad42d34a631fe77057cd19046ce125a06d933d68c39d870f2d366241aa3'],
  };
  for (const [key, [file, sha]] of Object.entries(onDisk)) {
    assert.equal(repair.HISTORICAL_SOURCES[key].rawSha256, sha, key);
    assert.equal(sha256RawBytes(read(file)), sha, key);
    assert.equal(readJson(file).name, repair.HISTORICAL_SOURCES[key].identity, key);
  }
  assert.doesNotThrow(() => rebuild());
});

test('the open mismatch set is derived from canonical artifacts, not from a source list', () => {
  const artifacts = Object.fromEntries(Object.entries(repair.HISTORICAL_SOURCES)
    .map(([key, pinned]) => [key, readJson(pinned.fixture)]));
  assert.deepEqual(repair.canonicalOpenMismatches(artifacts),
    [...repair.AUTHORIZED_REPAIR_ITEM_IDS, REJECTED].toSorted());
});

test('resolution receipt records exactly 12 REPAIR and 1 REJECT and claims nothing more', () => {
  assert.equal(sha256RawBytes(read(RECEIPT)), RECEIPT_SHA256);
  const { receipt } = repair.validateResolutionReceipt(read(RECEIPT), historicalSources());
  assert.deepEqual(receipt.summary, repair.EXPECTED_SUMMARY);
  assert.equal(receipt.decisions.length, 13);
  assert.deepEqual(receipt.decisions.filter(row => row.decision === 'REPAIR').map(r => r.itemId),
    [...repair.AUTHORIZED_REPAIR_ITEM_IDS]);
  assert.deepEqual(receipt.decisions.filter(row => row.decision === 'REJECT').map(r => r.itemId),
    [REJECTED]);

  // The rejection scopes to the current surface realization; no skeleton, no replacement.
  const rejection = receipt.decisions.find(row => row.itemId === REJECTED);
  assert.equal(rejection.rejectedScope, 'CURRENT_SURFACE_REALIZATION_ONLY');
  assert.equal(rejection.skeletonAmended, false);
  assert.equal(rejection.replacementAuthored, false);

  // Exactly two current blockers: fresh source audit and fresh blind HUMAN review. A
  // replacement surface for the rejected realization is explicitly NOT outstanding work.
  assert.equal(receipt.pending.freshSourceAudit, true);
  assert.equal(receipt.pending.freshBlindHumanReview, true);
  assert.equal(receipt.pending.replacementSurfaceForRejectedItem, false);
  for (const [key, value] of Object.entries(receipt.authority)) {
    if (key !== 'decisionsSource') assert.equal(value, false, key);
  }
});

test('resolution receipt validation fails closed on a drifting decision set', () => {
  const reject = (mutate, label) => {
    const receipt = structuredClone(readJson(RECEIPT));
    mutate(receipt);
    assert.throws(() => rebuild(repair.artifactBytes(receipt)), /surface repair/, label);
  };
  const repairRow = receipt => receipt.decisions.find(row => row.decision === 'REPAIR');

  reject(r => { r.decisions.push(structuredClone(repairRow(r))); }, 'duplicate repair decision');
  reject(r => {
    const extra = structuredClone(repairRow(r));
    extra.itemId = 'p1b6-item-b002-064';
    r.decisions.push(extra);
  }, 'unexpected 14th decision');
  for (const itemId of [...repair.AUTHORIZED_REPAIR_ITEM_IDS, REJECTED]) {
    reject(r => { r.decisions = r.decisions.filter(row => row.itemId !== itemId); },
      `omitted decision ${itemId}`);
  }
  reject(r => { repairRow(r).decision = 'REJECT'; }, 'repair flipped to rejection');
  reject(r => {
    r.decisions.find(row => row.itemId === REJECTED).decision = 'REPAIR';
  }, 'rejection flipped to repair');
  reject(r => { r.decisions.reverse(); }, 'decisions out of canonical order');
  reject(r => { repairRow(r).semanticSkeletonId = 'p1b6-sk-aebbf047d6864a35'; },
    'repaired row remapped to a different semantic skeleton');
  reject(r => { r.summary.REPAIR = 13; }, 'summary drift');
  reject(r => { r.pending.freshBlindHumanReview = false; }, 'claims blind review is done');
  reject(r => { r.pending.freshSourceAudit = false; }, 'claims the source audit is done');
  reject(r => { r.pending.replacementSurfaceForRejectedItem = true; },
    'makes a replacement surface for the rejected item mandatory pending work');
  reject(r => { r.authority.repairedRowsAccepted = true; }, 'claims acceptance');
  reject(r => { r.authority.humanGoldFrozen = true; }, 'claims gold freeze');
  reject(r => { r.authority.heldOutReleasePerformed = true; }, 'claims HELD_OUT release');
  reject(r => { r.authority.trainingOccurred = true; }, 'claims training');
  reject(r => { r.authority.historicalHumanDecisionsTransferredToRepairedText = true; },
    'claims HUMAN labels carried onto repaired text');
  reject(r => { r.authority.rejectedItemSkeletonAmended = true; }, 'claims skeleton amendment');
  reject(r => { r.repairCandidateArtifact.status = 'ACCEPTED'; }, 'candidate declared accepted');
  assert.doesNotThrow(() => rebuild());
});

test('every historical input is refused on identity, raw-byte, or coordinated drift', () => {
  for (const key of Object.keys(repair.HISTORICAL_SOURCES)) {
    // Identity drift.
    const identityDrift = historicalSources();
    const renamed = JSON.parse(identityDrift[key].toString('utf8'));
    renamed.name = 'xion-local-memory-inference-p1b6-not-the-canonical-artifact-v1';
    identityDrift[key] = repair.artifactBytes(renamed);
    assert.throws(() => rebuild(read(RECEIPT), identityDrift),
      /bytes are not the canonical historical evidence|identity is not canonical/, `${key} identity`);

    // Raw-byte drift on its own.
    const byteDrift = historicalSources();
    const marked = JSON.parse(byteDrift[key].toString('utf8'));
    marked.driftMarker = true;
    const markedBytes = repair.artifactBytes(marked);
    byteDrift[key] = markedBytes;
    assert.throws(() => rebuild(read(RECEIPT), byteDrift),
      /bytes are not the canonical historical evidence/, `${key} raw bytes`);

    // Coordinated drift: the source changes AND the receipt is rewritten to carry the new SHA.
    const coordinated = structuredClone(readJson(RECEIPT));
    repair.HISTORICAL_SOURCES[key].receiptField(coordinated).rawSha256 = sha256RawBytes(markedBytes);
    assert.notEqual(sha256RawBytes(markedBytes), repair.HISTORICAL_SOURCES[key].rawSha256);
    assert.throws(() => rebuild(repair.artifactBytes(coordinated), byteDrift),
      /bytes are not the canonical historical evidence/, `${key} coordinated`);

    // A receipt naming the wrong identity or the wrong canonical SHA is refused.
    for (const mutate of [
      binding => { binding.identity = 'xion-local-memory-inference-p1b6-wrong-identity-v1'; },
      binding => { binding.rawSha256 = CANDIDATE_SHA256; },
    ]) {
      const receipt = structuredClone(readJson(RECEIPT));
      mutate(repair.HISTORICAL_SOURCES[key].receiptField(receipt));
      assert.throws(() => rebuild(repair.artifactBytes(receipt)),
        /does not bind the canonical/, `${key} receipt binding`);
    }

    // Missing bytes fail closed rather than skipping verification.
    const missing = historicalSources();
    delete missing[key];
    assert.throws(() => rebuild(read(RECEIPT), missing), /bytes were not supplied/, `${key} missing`);
  }
  assert.throws(() => repair.buildRepairCandidateBatch(read(RECEIPT), undefined),
    /were not supplied/);
  assert.doesNotThrow(() => rebuild());
});

test('the repair candidate holds exactly the 12 authorized repaired rows', () => {
  assert.equal(sha256RawBytes(read(CANDIDATE)), CANDIDATE_SHA256);
  const candidate = readJson(CANDIDATE);
  assert.equal(candidate.name, repair.CANDIDATE_IDENTITY);
  assert.equal(candidate.status, repair.CANDIDATE_STATUS);
  assert.deepEqual(candidate.items.map(row => row.itemId), [...repair.AUTHORIZED_REPAIR_ITEM_IDS]);
  assert.equal(candidate.items.length, 12);
  assert.equal(candidate.sourceEpisodes.length, 12);
  assert.equal(candidate.items.some(row => row.itemId === REJECTED), false);

  // Provenance back to the historical rows stays explicit and semantic mapping is preserved.
  const historical = new Map(readJson(BATCH_002).items.map(row => [row.itemId, row]));
  for (const item of candidate.items) {
    const source = historical.get(item.itemId);
    assert.equal(item.semanticSkeletonId, source.semanticSkeletonId, item.itemId);
    assert.equal(item.sourceEpisodeId, source.sourceEpisodeId, item.itemId);
    assert.equal(item.surfaceFamilyId, source.surfaceFamilyId, item.itemId);
    assert.equal(item.historicalDiscoursePattern, source.discoursePattern, item.itemId);
  }

  // 047 states three TYPICAL membership signals. Recurring presence must not be strengthened
  // into 상주: the subject only stays in the building three days a week, so a 상주 rule would
  // leave the receipt's "two of the three signals" claim unrealized by the actual surface.
  const turns047 = candidate.sourceEpisodes
    .find(row => row.sourceEpisodeId === 'p1b6-se-b002-047').turns;
  const rule047 = turns047.find(row => row.role === 'ASSISTANT').text;
  assert.equal(rule047.includes('보통'), true, 'typical, not necessary-and-sufficient');
  assert.equal(rule047.includes('상주'), false, 'recurring presence, not 상주');
  for (const signal of ['장기 체류 등록', '주기적으로 건물에 머물', '개인 우편함']) {
    assert.equal(rule047.includes(signal), true, signal);
  }
  assert.equal(turns047.some(row => row.text.includes('매주 사흘은 그 건물에 머물러')), true);

  // It is not an effective-current successor: no 51 unaffected rows, no 050 placeholder.
  assert.equal(candidate.pending.freshSourceAudit, true);
  assert.equal(candidate.pending.freshBlindHumanReview, true);
  assert.deepEqual(candidate.provenance.rejectedItemIds, [REJECTED]);
  for (const [key, value] of Object.entries(candidate.authority)) {
    if (key !== 'decisionsSource') assert.equal(value, false, key);
  }

  // No HUMAN decision travelled with the repaired text.
  const serialized = JSON.stringify(candidate);
  for (const token of ['KEEP', 'CLEAR', 'ESCALATE', 'humanLabel', 'decision"']) {
    assert.equal(serialized.includes(token), false, token);
  }
});

test('repaired span offsets are recomputed and stale or invalid offsets fail closed', () => {
  const candidate = readJson(CANDIDATE);
  const historicalItems = new Map(readJson(BATCH_002).items.map(row => [row.itemId, row]));
  const options = { effectiveCatalog: readJson(EFFECTIVE_CATALOG) };
  assert.doesNotThrow(() => repair.validateRepairCandidateBatch(candidate, options));

  // Every anchor decodes to its recorded text in the REPAIRED source.
  const episodes = new Map(candidate.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));
  let movedOffsets = 0;
  for (const item of candidate.items) {
    const turn = episodes.get(item.sourceEpisodeId).turns
      .find(row => row.turnId === item.anchorSpanRef.turnId);
    const decoded = Buffer.from(turn.text, 'utf8')
      .subarray(item.anchorSpanRef.startByte, item.anchorSpanRef.endByte).toString('utf8');
    assert.equal(decoded, item.anchorText, item.itemId);
    const before = historicalItems.get(item.itemId).anchorSpanRef;
    if (before.startByte !== item.anchorSpanRef.startByte
      || before.endByte !== item.anchorSpanRef.endByte
      || before.turnId !== item.anchorSpanRef.turnId) movedOffsets += 1;
  }
  assert.equal(movedOffsets > 0, true, 'offsets were recomputed, not copied');

  const reject = (mutate, label) => {
    const drifted = structuredClone(candidate);
    mutate(drifted);
    // decodeSpan is the shared surface primitive, so either P1-B6 message is a fail-close.
    assert.throws(() => repair.validateRepairCandidateBatch(drifted, options),
      /P1-B6 surface/, label);
  };
  reject(c => { c.items[0].anchorSpanRef.startByte += 1; }, 'anchor start drift');
  reject(c => { c.items[0].anchorSpanRef.endByte += 1; }, 'anchor end drift');
  reject(c => { c.items[0].anchorSpanRef.startByte = 1; }, 'anchor inside a code point');
  reject(c => { c.items[0].anchorSpanRef.endByte = 100000; }, 'anchor past the turn');
  reject(c => { c.items[0].anchorSpanRef.endByte = c.items[0].anchorSpanRef.startByte; },
    'empty anchor span');
  reject(c => { c.items[0].evidenceSpanRefs[0].endByte -= 1; }, 'evidence is not a whole turn');
  reject(c => { c.items[0].evidenceSpanRefs.reverse(); }, 'evidence out of source order');
  reject(c => { c.items[0].evidenceSpanRefs = []; }, 'no evidence');
  reject(c => {
    const item = c.items.find(row => row.evidenceSpanRefs.length > 1);
    item.evidenceSpanRefs = item.evidenceSpanRefs
      .filter(span => span.turnId !== item.anchorSpanRef.turnId);
  }, 'anchor outside the selected evidence');
  reject(c => { c.items[0].anchorText = 'not the anchored text'; }, 'anchor text drift');

  // Stale offsets from the historical batch are exactly what must not validate.
  reject(c => {
    const item = c.items.find(row =>
      JSON.stringify(historicalItems.get(row.itemId).anchorSpanRef)
        !== JSON.stringify(row.anchorSpanRef));
    item.anchorSpanRef = structuredClone(historicalItems.get(item.itemId).anchorSpanRef);
  }, 'historical anchor offsets reused');
});

test('the repair candidate refuses the rejected row and any unauthorized row', () => {
  const candidate = readJson(CANDIDATE);
  const options = { effectiveCatalog: readJson(EFFECTIVE_CATALOG) };
  const reject = (mutate, pattern, label) => {
    const drifted = structuredClone(candidate);
    mutate(drifted);
    assert.throws(() => repair.validateRepairCandidateBatch(drifted, options), pattern, label);
  };

  // The rejected realization must never be materialized as a repair candidate.
  const historical = readJson(BATCH_002);
  const rejectedEpisode = historical.sourceEpisodes
    .find(row => row.sourceEpisodeId === 'p1b6-se-b002-050');
  reject(c => {
    c.sourceEpisodes.push(structuredClone(rejectedEpisode));
    const row = structuredClone(historical.items.find(item => item.itemId === REJECTED));
    row.anchorText = '사무실에서 쓰는 노트북';
    row.historicalDiscoursePattern = row.discoursePattern;
    c.items.push(row);
  }, /rejected realization must not appear/, 'rejected row materialized');

  // Any other row from the historical batch is unauthorized here.
  const unaffectedEpisode = historical.sourceEpisodes
    .find(row => row.sourceEpisodeId === 'p1b6-se-b002-001');
  reject(c => {
    c.sourceEpisodes.push(structuredClone(unaffectedEpisode));
    const row = structuredClone(historical.items.find(item => item.itemId === 'p1b6-item-b002-001'));
    row.anchorText = 'x';
    row.historicalDiscoursePattern = row.discoursePattern;
    c.items.push(row);
  }, /unauthorized row/, 'unaffected row copied in');

  reject(c => { c.items.pop(); }, /exactly the authorized repaired rows/, 'missing authorized row');
  reject(c => { c.items.push(structuredClone(c.items[0])); }, /duplicate or invalid repaired item/,
    'duplicate repaired row');
  reject(c => { c.status = 'ACCEPTED'; }, /identity or status is not canonical/, 'accepted status');
  reject(c => { c.name = 'xion-local-memory-inference-p1b6-skeleton-effective-current-v1'; },
    /identity or status is not canonical/, 'effective-current identity');
  reject(c => { c.authority.repairedRowsAccepted = true; }, /claims authority/, 'claims acceptance');
  reject(c => { c.items[0].semanticSkeletonId = 'p1b6-sk-not-a-real-skeleton'; },
    /unknown effective-current skeleton/, 'unknown skeleton');
  reject(c => {
    // A TRAIN episode carrying a FINAL_HELD_OUT skeleton must not validate.
    c.items[0].semanticSkeletonId = 'p1b6-sk-2fa39ece4157b2b8';
  }, /split mismatch/, 'split mismatch');
  reject(c => { c.sourceEpisodes[0].turns[0].text = 'has a [TARGET]marker[/TARGET]'; },
    /invalid repaired turn/, 'TARGET syntax in source');
  reject(c => { c.sourceEpisodes[0].turns[0].turnId = 't9'; }, /invalid repaired turn/,
    'turn ids out of sequence');

  assert.throws(() => repair.validateRepairCandidateBatch(candidate, {}),
    /needs the effective-current skeleton catalog/);
});

test('the receipt and the candidate are byte-stable and deterministically regenerated', () => {
  assert.deepEqual(repair.artifactBytes(readJson(RECEIPT)), read(RECEIPT));
  assert.deepEqual(repair.artifactBytes(rebuiltCandidate()), read(CANDIDATE));
  assert.deepEqual(repair.artifactBytes(rebuiltCandidate()),
    repair.artifactBytes(rebuiltCandidate()));
  assert.deepEqual(rebuiltCandidate(), readJson(CANDIDATE));
});
