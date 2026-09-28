'use strict';

// Reviewed-pool ledger (owner pool rule A) and the marginal shortage receipt.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-reviewed-pool-ledger');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, 'fixtures', file));
const ledger = JSON.parse(read(builder.LEDGER_FILE));
const shortage = JSON.parse(read(builder.SHORTAGE_FILE));
const rowOf = itemId => ledger.rows.find(row => row.itemId === itemId);
const b003 = n => `p1b6-item-b003-${n}`;

test('committed ledger and shortage receipt are exactly the builder output', () => {
  const { ledger: built, shortage: builtShortage } = builder.buildArtifacts();
  assert.deepEqual(builder.artifactBytes(built), read(builder.LEDGER_FILE));
  assert.deepEqual(builder.artifactBytes(builtShortage), read(builder.SHORTAGE_FILE));
});

test('every accepted, batch-003 and fresh candidate row appears exactly once', () => {
  assert.equal(ledger.rows.length, 93 + 304 + 4);
  assert.equal(new Set(ledger.rows.map(row => row.itemId)).size, ledger.rows.length);
  const batch = JSON.parse(read(builder.SOURCES.batch[2]));
  for (const item of batch.items) assert.equal(Boolean(rowOf(item.itemId)), true, item.itemId);
  for (const id of ['p1b6-item-tb1-001', 'p1b6-item-tb1-002', 'p1b6-item-rp1-001', 'p1b6-item-rp1-002']) {
    assert.equal(rowOf(id).status, 'PROVISIONAL', id);
  }
});

test('pool rule A: in-pool statuses only, retired-skeleton acceptances out and flagged', () => {
  for (const row of ledger.rows) {
    assert.equal(row.inPool, Object.hasOwn(builder.IN_POOL, row.status), row.itemId);
    assert.equal(row.inPool || builder.OUT_OF_POOL.includes(row.status), true, row.itemId);
  }
  const retiredAccepted = ledger.rows.filter(row => row.status === 'ACCEPTED_ON_RETIRED_SKELETON');
  assert.deepEqual(retiredAccepted.map(row => row.itemId), ['p1b6-item-b001-030', 'p1b6-item-b002-021',
    'p1b6-item-b002-026', 'p1b6-item-b002-031', 'p1b6-item-b002-036', 'p1b6-item-b002-041']);
  assert.equal(retiredAccepted.every(row => !row.inPool), true);
  const flagged = ledger.rows.filter(row => row.humanGoldDiffersFromV3);
  assert.equal(flagged.length, 12);
  assert.equal(flagged.every(row => row.inPool && row.referenceLabel === row.humanGoldLabel), true);
});

test('batch-003 rows carry the status of their latest committed layer', () => {
  const expect = {
    INELIGIBLE: ['224', '225'],
    // v2 HUMAN adjudications on skeletons v3 left unchanged, plus the two anchor-repair promotions.
    HUMAN_ADJUDICATED: ['114', '155', '161', '164', '226', '227', '241', '245', '254', '256', '258'],
    REPAIR_HUMAN_MATCHING_V3: ['162', '214'],
    OWNER_RESOLUTION_LABEL: ['040', '103', '231', '259'],
    EXCLUDED_AUDIT_FAIL: ['002', '006', '109'],
    SURFACE_REJECTED: ['242', '244', '246', '248', '249'],
  };
  for (const [status, ids] of Object.entries(expect)) {
    assert.deepEqual(ledger.rows.filter(row => row.status === status && row.itemId.includes('-b003-'))
      .map(row => row.itemId).sort(), ids.map(b003), status);
  }
  assert.equal(rowOf(b003('228')).status, 'PROVISIONAL');
  assert.equal(ledger.rows.filter(row => row.status === 'INELIGIBLE_TARGET_BOUNDARY').length, 16);
  assert.equal(ledger.rows.filter(row => row.status === 'HISTORICAL_RETIRED_SKELETON').length, 20);
  // The pooled anchor and repair rows are described from their repaired surfaces.
  assert.match(rowOf(b003('226')).source, /anchor-repair-candidate/);
  assert.match(rowOf(b003('162')).source, /repair-candidate/);
});

test('no in-pool row sits on a retired or unknown skeleton', () => {
  const v3 = JSON.parse(read(builder.SOURCES.v3[2]));
  const active = new Set(v3.candidates.map(row => row.semanticSkeletonId));
  for (const row of ledger.rows.filter(entry => entry.inPool)) {
    assert.equal(active.has(row.semanticSkeletonId), true, row.itemId);
    assert.notEqual(row.splitAssignment, null, row.itemId);
  }
});

test('the shortage receipt measures marginal deficits without a label target', () => {
  assert.equal(shortage.pool.total, 349);
  assert.equal(shortage.pool.total, ledger.summary.inPool);
  assert.deepEqual(Object.fromEntries(Object.entries(shortage.pool.split).map(([key, cell]) => [key, cell.pool])),
    { TRAIN: 208, DEV: 58, FINAL_HELD_OUT: 83 });
  assert.deepEqual(shortage.lowerBounds, { total: 31, splitAware: 34, language: 31, fragments: 31 });
  assert.equal(shortage.minimumTopUpLowerBound, 34);
  assert.equal(shortage.heldPerSkeletonNeed, 0);
  assert.deepEqual(shortage.zeroCoveredActiveSkeletons, []);
  assert.equal(shortage.frozenConstraints.labelBalance, 'ABOLISHED_BY_SEMANTIC_CONTRACT_V3_NOT_MEASURED');
  assert.equal(Object.hasOwn(shortage.pool, 'label'), false);
});

test('drifted inputs fail closed and no authority is claimed', () => {
  const raw = builder.loadSources();
  assert.throws(() => builder.buildArtifacts({ ...raw, targetBoundary: Buffer.concat([raw.targetBoundary, Buffer.from(' ')]) }),
    /not the pinned artifact/);
  for (const pinned of Object.values(builder.SOURCES)) {
    assert.equal(sha256RawBytes(read(pinned[2])), pinned[1], pinned[2]);
  }
  for (const [key, value] of Object.entries(ledger.authority)) assert.equal(value, false, key);
  for (const [key, value] of Object.entries(shortage.authority)) assert.equal(value, false, key);
});

test('pooled batch-003 rows sit on skeletons whose v2 and v3 labels agree, or were re-reviewed under v3', () => {
  const v2 = JSON.parse(read('local-memory-inference-p1b6-skeleton-effective-current-v2.json'));
  const v3 = JSON.parse(read(builder.SOURCES.v3[2]));
  const v2Label = new Map(v2.candidates.map(row => [row.semanticSkeletonId, row.humanLabel]));
  const v3Label = new Map(v3.candidates.map(row => [row.semanticSkeletonId, row.humanLabel]));
  const reversed = new Set(v3.amendedSkeletonIds);
  for (const row of ledger.rows.filter(entry => entry.inPool && entry.itemId.includes('-b003-'))) {
    assert.equal(row.referenceLabel, v3Label.get(row.semanticSkeletonId), row.itemId);
    if (!reversed.has(row.semanticSkeletonId)) {
      assert.equal(v2Label.get(row.semanticSkeletonId), v3Label.get(row.semanticSkeletonId), row.itemId);
    }
  }
});
