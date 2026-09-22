'use strict';

// P1-B6 batch-003 26-row resolution and the 162 / 214 repair candidates.
//
// The receipt records a final disposition for exactly the rows HUMAN reconciliation attempt-001
// made ineligible. These tests pin that population, the quoted historical HUMAN evidence, the
// repaired text, and the absence of any acceptance, transfer or historical mutation.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const resolution = require('../scripts/build-memory-inference-p1b6-batch-003-repair-candidate');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, 'fixtures', file));
const readJson = file => JSON.parse(read(file));

const RECEIPT_SHA256 = '61c29218a360bf914c6453758c7fc243e629f1b5d400e38426d9d18720cb1ffe';
const CANDIDATE_SHA256 = '8f6254946eef8d8d0920485bde431ca137a83577a5060889f3676b8857b4aa9b';
const HISTORICAL = Object.freeze({
  'local-memory-inference-p1b6-surface-batch-003-authoring-protocol.json':
    '33c39777583009aaaa570718ae26741b6a2562e2006d4a4e428c60d47bdcc447',
  'local-memory-inference-p1b6-surface-batch-003-materialization-receipt.json':
    '6f6efdff15cb488cb1f63d075f15bda10350a92c0c9176d0f9e19a9b289b2fa0',
  'local-memory-inference-p1b6-batch-003-human-adjudication-calibration-protocol.json':
    '171ee15d02a0dd674ed72f6910654ce0fe58242700415ded7e91ec858e55e001',
  'local-memory-inference-p1b6-strong-model-semantic-review-protocol.json':
    '2f97028fe5bb9612a0750140754136785f99d07f93f7924c697a5b67990c16c4',
  'local-memory-inference-p1b6-large-batch-review-authority-amendment.json':
    '821b0cb07580b4c2ac776014d88c78333263900759ca94d1746b4934964ffc0e',
  'local-memory-inference-p1b6-surface-repair-candidate-batch-002.json':
    'd59d0dec225d3f4fea74952da10e05b8f0be01942a3aa6e15ea58d659e22abb3',
});

const build = (receipt = read(resolution.RECEIPT_FILE), sources = resolution.loadSources()) =>
  resolution.buildRepairCandidate(receipt, sources);
const withReceipt = mutate => {
  const receipt = readJson(resolution.RECEIPT_FILE);
  mutate(receipt);
  return Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
};

test('every pinned historical input and batch-003 stay byte-identical', () => {
  for (const pinned of Object.values(resolution.SOURCES)) {
    assert.equal(sha256RawBytes(read(pinned.fixture)), pinned.rawSha256, pinned.fixture);
  }
  for (const [file, sha] of Object.entries(HISTORICAL)) {
    assert.equal(sha256RawBytes(read(file)), sha, file);
  }
  assert.equal(resolution.SOURCES.batch.rawSha256,
    '90b453c3680bccaa537fd0d23db74bbc303882e1a35a2ddcea0b75b013fcaa68');
  assert.equal(resolution.SOURCES.human.rawSha256,
    '0adbba1789bb91025f277701c51cbf82139092f147966053277573c3f0dbbe6a');

  const sources = resolution.loadSources();
  sources.batch = Buffer.concat([sources.batch, Buffer.from(' ')]);
  assert.throws(() => build(undefined, sources), /not the pinned artifact/);
});

test('the receipt covers exactly the 26 reconciliation-required rows', () => {
  const receipt = readJson(resolution.RECEIPT_FILE);
  const human = readJson(resolution.SOURCES.human.fixture);
  assert.deepEqual(receipt.decisions.map(row => row.itemId),
    human.reconciliation.resolutionRequiredItemIds);
  assert.equal(receipt.decisions.length, 26);
  assert.deepEqual(receipt.summary, {
    total: 26,
    REFERENCE_UPHELD_REVIEWER_CORRECTION: 3,
    SEMANTIC_CONTRACT_CORRECTION: 4,
    SURFACE_REPAIR: 2,
    SURFACE_REJECT: 5,
    SKELETON_RETIRED: 12,
  });
  const labels = Object.fromEntries(receipt.decisions.map(row => [row.itemId.slice(-3),
    [row.resolution, row.resolvedLabel]]));
  assert.deepEqual(labels['040'], ['REFERENCE_UPHELD_REVIEWER_CORRECTION', 'ESCALATE']);
  assert.deepEqual(labels['103'], ['REFERENCE_UPHELD_REVIEWER_CORRECTION', 'ESCALATE']);
  assert.deepEqual(labels['259'], ['REFERENCE_UPHELD_REVIEWER_CORRECTION', 'CLEAR']);
  for (const id of ['072', '142', '145', '231']) {
    assert.deepEqual(labels[id], ['SEMANTIC_CONTRACT_CORRECTION', 'ESCALATE'], id);
  }

  assert.throws(() => build(withReceipt(row => { row.decisions.pop(); })),
    /exactly one sorted row/);
  assert.throws(() => build(withReceipt(row => {
    row.decisions.push({ ...row.decisions[0], itemId: 'p1b6-item-b003-001' });
  })), /exactly one sorted row/);
  assert.throws(() => build(withReceipt(row => {
    row.decisions.find(entry => entry.itemId.endsWith('242')).resolution = 'SURFACE_REPAIR';
  })), /rows are not the authorized set/);
  assert.throws(() => build(withReceipt(row => {
    row.decisions.find(entry => entry.itemId.endsWith('259')).resolvedLabel = 'ESCALATE';
  })), /inconsistent with its resolution/);
});

test('reviewer corrections quote the historical HUMAN decision and do not rewrite it', () => {
  const receipt = readJson(resolution.RECEIPT_FILE);
  const human = readJson(resolution.SOURCES.human.fixture);
  const rows = new Map([...human.adjudicationRows, ...human.calibrationRows]
    .map(row => [row.itemId, row]));
  for (const row of receipt.decisions) {
    const historical = rows.get(row.itemId);
    assert.equal(row.historicalHumanDecision, historical.humanDecision, row.itemId);
    assert.equal(row.historicalReferenceLabel, historical.referenceLabel, row.itemId);
    assert.equal(historical.eligibility, 'INELIGIBLE', row.itemId);
  }
  // 040 and 103: the HUMAN said CLEAR, the upheld reference says ESCALATE, and the historical
  // row still says CLEAR.
  for (const id of ['040', '103']) {
    assert.equal(rows.get(`p1b6-item-b003-${id}`).humanDecision, 'CLEAR');
  }
  assert.throws(() => build(withReceipt(row => {
    row.decisions[0].historicalHumanDecision = 'ESCALATE';
  })), /does not quote the historical reconciliation row/);
});

test('the repair candidate holds exactly 162 and 214 with the approved text', () => {
  const committed = read(resolution.CANDIDATE_FILE);
  assert.deepEqual(Buffer.from(`${JSON.stringify(build(), null, 2)}\n`, 'utf8'), committed);
  assert.equal(sha256RawBytes(committed), CANDIDATE_SHA256);
  assert.equal(sha256RawBytes(read(resolution.RECEIPT_FILE)), RECEIPT_SHA256);
  const candidate = readJson(resolution.CANDIDATE_FILE);
  assert.deepEqual(candidate.items.map(row => row.itemId),
    ['p1b6-item-b003-162', 'p1b6-item-b003-214']);
  assert.equal(candidate.provenance.resolutionReceipt.rawSha256, RECEIPT_SHA256);
  assert.equal(candidate.interpretationRule, 'P1B6_SEMANTIC_CONTRACT_V3');

  const text = id => candidate.sourceEpisodes.find(row => row.sourceEpisodeId === `p1b6-se-b003-${id}`)
    .turns.map(turn => turn.text);
  const t162 = text('162');
  assert.equal(t162.some(line => /두 번 봤어|결론만/u.test(line)), false);
  assert.deepEqual(candidate.items[0].evidenceSpanRefs.map(span => span.turnId), ['t2', 't4', 't6']);
  assert.deepEqual(candidate.items[0].evidenceSpanRefs.map(span =>
    t162[Number(span.turnId.slice(1)) - 1]), [
    '지난달 회의실에 있던 파란 mug는 손잡이에 흠집이 있었어.',
    '어제 휴게실에서도 흠집 있는 파란 mug를 봤어.',
    '그런데 어제 것은 바닥에 이름이 적혀 있더라.',
  ]);
  assert.deepEqual(candidate.items[0].anchorSpanRef, { turnId: 't2', startByte: 30, endByte: 40 });

  const t214 = text('214');
  assert.equal(t214.includes('아니면 주차권을 연장할까요?'), true);
  assert.equal(t214.some(line => /더 정확히는|도 같이/u.test(line)), false);
  assert.deepEqual([t214[0], t214[2], t214[4]],
    ['다음 달 정기권을 연장할까요?', '아니면 주차권을 연장할까요?', '응, 연장해 줘.']);
  assert.equal(candidate.items[1].anchorText, '연장해 줘');

  // No HUMAN decision rides on the repaired text, and nothing is accepted.
  assert.equal(JSON.stringify(candidate).includes('humanDecision"'), false);
  assert.deepEqual(candidate.pending, { freshSourceAudit: true, freshBlindHumanReviewUnderV3: true });
  assert.equal(Object.values(candidate.authority).every(value => value === false), true);
});

test('rejected and retired rows stay historical and never transfer', () => {
  const receipt = readJson(resolution.RECEIPT_FILE);
  const batch = readJson(resolution.SOURCES.batch.fixture);
  const v3 = readJson(resolution.SOURCES.v3.fixture);
  const rejected = receipt.decisions.filter(row => row.resolution === 'SURFACE_REJECT');
  assert.deepEqual(rejected.map(row => row.itemId.slice(-3)), ['242', '244', '246', '248', '249']);
  assert.equal(rejected.every(row => row.resolvedLabel === null), true);
  // The historical rows are still in the frozen batch; the be0efa30 skeleton is untouched.
  for (const row of rejected) {
    assert.equal(batch.items.some(entry => entry.itemId === row.itemId), true);
  }
  assert.equal(v3.candidates.some(row => row.semanticSkeletonId === 'p1b6-sk-be0efa305956d111'
    && row.humanLabel === 'ESCALATE'), true);

  const siblings = receipt.retiredSkeletonSurfaces;
  assert.deepEqual(siblings.map(row => row.historicalItemIds.length), [8, 12]);
  assert.deepEqual(siblings[0].historicalItemIds.map(id => id.slice(-3)),
    ['059', '060', '061', '062', '063', '064', '065', '066']);
  assert.deepEqual(siblings[1].historicalItemIds.map(id => Number(id.slice(-3))),
    Array.from({ length: 12 }, (_, index) => 289 + index));
  assert.equal(siblings.every(row => row.transferredToReplacement === false), true);
  // No batch-003 surface points at a replacement skeleton.
  const replacements = siblings.map(row => row.replacementSkeletonId);
  assert.equal(batch.items.some(row => replacements.includes(row.semanticSkeletonId)), false);

  assert.throws(() => build(withReceipt(row => {
    row.retiredSkeletonSurfaces[0].transferredToReplacement = true;
  })), /retired-skeleton surface historical/);
  assert.throws(() => build(withReceipt(row => {
    row.retiredSkeletonSurfaces[1].historicalItemIds.pop();
  })), /retired-skeleton surface historical/);
});

test('no acceptance, HELD release or training authority is claimed', () => {
  const receipt = readJson(resolution.RECEIPT_FILE);
  assert.equal(Object.values(receipt.authority).every(value => value === false), true);
  assert.equal(receipt.pending.repairCandidateFreshSourceAudit, true);
  assert.equal(receipt.pending.repairCandidateFreshBlindHumanReviewUnderV3, true);
  assert.equal(receipt.pending.replacementSkeletonSurfaceAuthoring, true);
  for (const claim of [true, 'true', 1]) {
    assert.throws(() => build(withReceipt(row => { row.authority.datasetAcceptancePerformed = claim; })),
      /claims authority/);
  }
  assert.throws(() => build(withReceipt(row => { row.pending.repairCandidateFreshSourceAudit = false; })),
    /fresh gates pending/);
  assert.throws(() => build(withReceipt(row => { row.inputs.priorSemanticAuthority.rawSha256 = 'x'.repeat(64); })),
    /does not bind the canonical/);
});
