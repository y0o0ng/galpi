'use strict';

// Reviewed-pool ledger v6: v5 under semantic contract v4; v5 stays byte-identical.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const v1 = require('../scripts/build-memory-inference-p1b6-reviewed-pool-ledger');
const builder = require('../scripts/build-memory-inference-p1b6-reviewed-pool-ledger-v6');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'fixtures', file));
const ledger = JSON.parse(read(builder.LEDGER_FILE));
const shortage = JSON.parse(read(builder.SHORTAGE_FILE));

test('committed v6 ledger and shortage are exactly the builder output; pinned inputs unchanged', () => {
  const built = builder.buildArtifacts();
  assert.deepEqual(v1.artifactBytes(built.ledger), read(builder.LEDGER_FILE));
  assert.deepEqual(v1.artifactBytes(built.shortage), read(builder.SHORTAGE_FILE));
  for (const [, rawSha256, fixture] of Object.values(builder.SOURCES)) assert.equal(sha256RawBytes(read(fixture)), rawSha256, fixture);
});

test('v4 moves 32 rows: 23 leave the pool, cc054a42 9 stay as ESCALATE; pool 363', () => {
  assert.deepEqual(ledger.summary.v4.byStatus, { INELIGIBLE: 23, PROVISIONAL: 4, HUMAN_ADJUDICATED: 5 });
  assert.equal(ledger.summary.inPool, 363);
  const cc = ledger.rows.filter(row => row.semanticSkeletonId === 'p1b6-sk-cc054a4227cdafef' && row.inPool);
  assert.equal(cc.length, 9);
  assert.equal(cc.every(row => row.referenceLabel === 'ESCALATE'), true);
  const v5 = JSON.parse(read(builder.SOURCES.ledgerV5[2])).rows;
  ledger.rows.forEach((row, index) => { if (!row.v4Outcome) assert.deepEqual(row, v5[index], row.itemId); });
});

test('shortage v6: top-up lower bound 21 (TRAIN 11, DEV 7, HELD 11e63b75 2 + a19bb9e9 1); nothing accepted or selected', () => {
  assert.equal(shortage.minimumTopUpLowerBound, 21);
  assert.deepEqual(shortage.heldSkeletons.filter(row => row.needTo5).map(row => [row.semanticSkeletonId, row.needTo5]),
    [['p1b6-sk-11e63b75bdf266dd', 2], ['p1b6-sk-a19bb9e94e9a416b', 1]]);
  assert.deepEqual(shortage.zeroCoveredActiveSkeletons, ['p1b6-sk-43016ef6da889a87', 'p1b6-sk-5fc872afb058b370']);
  for (const [key, value] of Object.entries(shortage.authority)) assert.equal(value, false, key);
});
