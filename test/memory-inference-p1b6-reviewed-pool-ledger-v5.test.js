'use strict';

// Reviewed-pool ledger v5: v4 plus the 7 batch-006 rows; v4 stays byte-identical.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const v1 = require('../scripts/build-memory-inference-p1b6-reviewed-pool-ledger');
const builder = require('../scripts/build-memory-inference-p1b6-reviewed-pool-ledger-v5');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'fixtures', file));
const ledger = JSON.parse(read(builder.LEDGER_FILE));
const shortage = JSON.parse(read(builder.SHORTAGE_FILE));

test('committed v3 ledger and shortage are exactly the builder output; pinned inputs unchanged', () => {
  const built = builder.buildArtifacts();
  assert.deepEqual(v1.artifactBytes(built.ledger), read(builder.LEDGER_FILE));
  assert.deepEqual(v1.artifactBytes(built.shortage), read(builder.SHORTAGE_FILE));
  for (const [, rawSha256, fixture] of Object.values(builder.SOURCES)) assert.equal(sha256RawBytes(read(fixture)), rawSha256, fixture);
});

test('batch-006 adds 7 PROVISIONAL rows (5 HELD, 2 DEV); pool 386; v4 rows unchanged', () => {
  assert.deepEqual(ledger.summary.batch006, { rows: 7, inPool: 7, byStatus: { PROVISIONAL: 7 } });
  assert.deepEqual(ledger.rows.slice(0, 444), JSON.parse(read(builder.SOURCES.ledgerV4[2])).rows);
  assert.equal(ledger.summary.inPool, 386);
  assert.deepEqual(ledger.summary.inPoolLabelDiffersFromV3, []);
});

test('shortage v5: every marginal and every HELD per-skeleton need is met; nothing accepted or selected', () => {
  assert.deepEqual(shortage.lowerBounds, { total: 0, splitAware: 0, language: 0, fragments: 0 });
  assert.equal(shortage.minimumTopUpLowerBound, 0);
  assert.equal(shortage.heldPerSkeletonNeed, 0);
  for (const [key, value] of Object.entries(shortage.authority)) assert.equal(value, false, key);
});
