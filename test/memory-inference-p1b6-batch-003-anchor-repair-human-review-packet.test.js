'use strict';

// Blind 5-row HUMAN packet for the aebbf047 anchor-repair candidates (4 mandatory + 1 calibration).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-batch-003-anchor-repair-human-review-packet');
const review = require('../scripts/build-memory-inference-p1b6-batch-003-anchor-repair-v3-review-packet');

const PACKET_SHA256 = '626557153094f0f5c79fe41c77fe787c7e0770a8e12fb42ab4553fdd24683f3f';
const receipt = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', builder.PINNED.reviewReceipt.fixture)));

test('population is the four mandatory rows plus the one calibration row', () => {
  assert.deepEqual(builder.derivePopulation(),
    ['224', '225', '226', '227', '228'].map(n => `p1b6-item-b003-${n}`));
  const moved = receipt();
  moved.calibrationItemIds = [];
  assert.throws(() => builder.derivePopulation(moved), /preregistered plan/);
});

test('the packet is deterministic, opaque, sorted, and hides row role', () => {
  const packet = builder.buildHumanReviewPacket();
  assert.equal(sha256RawBytes(builder.packetBytes(packet)), PACKET_SHA256);
  const ids = packet.rows.map(row => row.reviewRowId);
  assert.equal(ids.length, 5);
  assert.deepEqual(ids, ids.toSorted());
  const reviewed = new Set(review.buildReviewPacket().rows.map(row => row.selectedBundle));
  for (const row of packet.rows) {
    assert.deepEqual(Object.keys(row), ['reviewRowId', 'selectedBundle']);
    assert.match(row.reviewRowId, /^p1b6-b003-anchor-hreview-[0-9a-f]{16}$/u);
    assert.equal(reviewed.has(row.selectedBundle), true);
  }
  const text = JSON.stringify(packet);
  for (const value of ['p1b6-item-', 'p1b6-sk-', 'CLEAR', 'ESCALATE', 'KEEP', 'calibration', 'mandatory',
    'DECISION_DISAGREEMENT', 'v3smreview', 'reference', 'REANCHOR']) {
    assert.equal(text.includes(value), false, value);
  }
});

test('the protocol carries v3 and records the reviewer limitation', () => {
  const protocol = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', builder.PINNED.protocol.fixture)));
  const v3 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures',
    'local-memory-inference-p1b6-skeleton-effective-current-v3.json')));
  for (const key of ['clear', 'escalate', 'uncertaintyDistinction', 'targetBoundary', 'pragmaticResolution', 'noAddedPremise']) {
    assert.equal(protocol.question[key], key === 'noAddedPremise'
      ? v3.interpretationRule.retainedV2Clauses.noAddedPremise : v3.interpretationRule[key], key);
  }
  assert.equal(protocol.population.rows, 5);
  assert.equal(protocol.reviewer.decidedTheReanchoring, true);
  assert.match(protocol.reviewer.independenceNote, /not an independent confirmation/);
});

// HUMAN result ingestion: row routing drives the receipt-level promotion flag.
const MANDATORY = ['224', '225', '226', '227'].map(n => `p1b6-item-b003-${n}`);
const CALIBRATION = 'p1b6-item-b003-228';
const rowIdOf = itemId => builder.opaqueReviewRowId(builder.buildHumanReviewPacket().sourceCandidate.sha256, itemId);
const result = (overrides = {}) => Buffer.from(JSON.stringify({
  results: builder.buildHumanReviewPacket().rows.map(row => ({
    reviewRowId: row.reviewRowId, disposition: 'KEEP', decision: 'ESCALATE', reason: 'r',
    ...overrides[row.reviewRowId],
  })),
}));
const ingest = bytes => builder.buildHumanResultReceipt(bytes, '2026-09-28');
const byItem = built => new Map(built.rows.map(row => [row.itemId, row]));

test('a mandatory KEEP CLEAR matching v3 is HUMAN_ADJUDICATED and sets the promotion flag', () => {
  const built = ingest(result({ [rowIdOf(MANDATORY[0])]: { decision: 'CLEAR' } }));
  const row = byItem(built).get(MANDATORY[0]);
  assert.deepEqual([row.role, row.provenance, row.eligibility], ['mandatory', 'HUMAN_ADJUDICATED', 'ELIGIBLE']);
  assert.equal(built.authority.promotedToHumanAdjudicated, true);
  assert.equal(built.summary.humanAdjudicated, 1);
});

test('opposing, FIX or REJECT mandatory rows promote nothing', () => {
  const built = ingest(result({
    [rowIdOf(MANDATORY[1])]: { disposition: 'FIX', decision: null },
    [rowIdOf(MANDATORY[2])]: { disposition: 'REJECT', decision: null },
  }));
  assert.equal(built.rows.some(row => row.provenance === 'HUMAN_ADJUDICATED'), false);
  assert.equal(built.authority.promotedToHumanAdjudicated, false);
  assert.equal(built.summary.humanAdjudicated, 0);
  for (const itemId of MANDATORY) assert.equal(byItem(built).get(itemId).eligibility, 'INELIGIBLE', itemId);
});

test('a calibration match alone stays provisional and does not set the promotion flag', () => {
  const built = ingest(result({ [rowIdOf(CALIBRATION)]: { decision: 'CLEAR' } }));
  const row = byItem(built).get(CALIBRATION);
  assert.deepEqual([row.role, row.provenance, row.eligibility],
    ['calibration', 'CATALOG_STRONG_MODEL_CONFIRMED', 'PROVISIONAL']);
  assert.equal(built.authority.promotedToHumanAdjudicated, false);
  assert.equal(built.summary.humanAdjudicated, 0);
});

test('summary humanAdjudicated counts the HUMAN_ADJUDICATED rows exactly', () => {
  const built = ingest(result(Object.fromEntries([...MANDATORY.slice(0, 3), CALIBRATION]
    .map(itemId => [rowIdOf(itemId), { decision: 'CLEAR' }]))));
  assert.equal(built.summary.humanAdjudicated, built.rows.filter(row => row.provenance === 'HUMAN_ADJUDICATED').length);
  assert.equal(built.summary.humanAdjudicated, 3);
  assert.equal(built.authority.promotedToHumanAdjudicated, true);
});

test('unknown, missing or duplicate review row IDs fail closed', () => {
  const rows = JSON.parse(result().toString('utf8')).results;
  const encode = list => Buffer.from(JSON.stringify({ results: list }));
  const unknown = { ...rows[0], reviewRowId: 'p1b6-b003-anchor-hreview-0000000000000000' };
  assert.throws(() => ingest(encode([...rows.slice(1), unknown])), /exactly the packet rows/);
  assert.throws(() => ingest(encode(rows.slice(1))), /exactly the packet rows/);
  assert.throws(() => ingest(encode([...rows, rows[0]])), /exactly the packet rows/);
});

test('frozen packet, protocol and v3 review receipt bytes are unchanged', () => {
  const fixtures = path.join(__dirname, '..', 'fixtures');
  assert.equal(sha256RawBytes(builder.packetBytes(builder.buildHumanReviewPacket())), PACKET_SHA256);
  assert.equal(sha256RawBytes(fs.readFileSync(path.join(fixtures, builder.PINNED.protocol.fixture))),
    'cf8c20bb66b082897316476efeb76fd03e3f3f2264b2ccb3348bba34da95a1c7');
  assert.equal(sha256RawBytes(fs.readFileSync(path.join(fixtures, builder.PINNED.reviewReceipt.fixture))),
    '1195b6fc886dc81de010d1347f783a3f02269cd38c4fa1c0a241d4097acb6ca4');
});

const os = require('node:os');
const RAW = path.join(os.homedir(), 'p1b6-b003-anchor-human-review-results.json');
const HUMAN_RECEIPT = path.join(__dirname, '..', 'fixtures', builder.RECEIPT_FIXTURE);

test('the committed HUMAN receipt: 226/227 promoted, 228 provisional, 224/225 ineligible', () => {
  const built = JSON.parse(fs.readFileSync(HUMAN_RECEIPT));
  assert.equal(built.reviewPacket.sha256, PACKET_SHA256);
  assert.equal(built.reviewDate, '2026-09-28');
  assert.equal(built.rawResultArtifact.committed, false);
  assert.match(built.rawResultArtifact.sha256, /^[0-9a-f]{64}$/u);
  const rows = byItem(built);
  const shape = itemId => {
    const row = rows.get(itemId);
    return [row.role, row.disposition, row.decision, row.referenceLabel, row.provenance, row.eligibility];
  };
  for (const itemId of MANDATORY.slice(0, 2)) {
    assert.deepEqual(shape(itemId), ['mandatory', 'KEEP', 'ESCALATE', 'CLEAR', null, 'INELIGIBLE'], itemId);
  }
  for (const itemId of MANDATORY.slice(2)) {
    assert.deepEqual(shape(itemId), ['mandatory', 'KEEP', 'CLEAR', 'CLEAR', 'HUMAN_ADJUDICATED', 'ELIGIBLE'], itemId);
  }
  assert.deepEqual(shape(CALIBRATION),
    ['calibration', 'KEEP', 'CLEAR', 'CLEAR', 'CATALOG_STRONG_MODEL_CONFIRMED', 'PROVISIONAL']);
  assert.deepEqual(built.summary, { total: 5, matchingV3Reference: 3, humanAdjudicated: 2 });
  assert.equal(built.authority.promotedToHumanAdjudicated, true);
  for (const key of ['catalogAmendedByThisResult', 'surfaceAcceptancePerformed', 'referenceLabelFreezePerformed',
    'finalSelectionPerformed', 'trainingOrEvaluationOccurred']) {
    assert.equal(built.authority[key], false, key);
  }
  assert.equal(built.reviewer.independentConfirmation, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures',
    'local-memory-inference-p1b6-batch-002-acceptance.json'))).corpusGrowth.cumulativeAcceptedSurfacePool, 93);
});

test('the HUMAN receipt equals the raw result bytes, which hold exactly the packet rows',
  { skip: !fs.existsSync(RAW) }, () => {
    const raw = fs.readFileSync(RAW);
    const committed = JSON.parse(fs.readFileSync(HUMAN_RECEIPT));
    assert.equal(sha256RawBytes(raw), committed.rawResultArtifact.sha256);
    assert.deepEqual(JSON.parse(raw).results.map(row => row.reviewRowId).toSorted(),
      builder.buildHumanReviewPacket().rows.map(row => row.reviewRowId));
    assert.deepEqual(builder.buildHumanResultReceipt(raw, committed.reviewDate), committed);
  });
