'use strict';

// Reviewed-pool ledger v3: v2 plus the 2 batch-005 rows; v2 stays byte-identical.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const v1 = require('../scripts/build-memory-inference-p1b6-reviewed-pool-ledger');
const builder = require('../scripts/build-memory-inference-p1b6-reviewed-pool-ledger-v3');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'fixtures', file));
const ledger = JSON.parse(read(builder.LEDGER_FILE));
const shortage = JSON.parse(read(builder.SHORTAGE_FILE));

test('committed v3 ledger and shortage are exactly the builder output; pinned inputs unchanged', () => {
  const built = builder.buildArtifacts();
  assert.deepEqual(v1.artifactBytes(built.ledger), read(builder.LEDGER_FILE));
  assert.deepEqual(v1.artifactBytes(built.shortage), read(builder.SHORTAGE_FILE));
  for (const [, rawSha256, fixture] of Object.values(builder.SOURCES)) assert.equal(sha256RawBytes(read(fixture)), rawSha256, fixture);
});

test('batch-005 adds 2 PROVISIONAL rows; pool 389; v2 rows unchanged', () => {
  assert.deepEqual(ledger.summary.batch005, { rows: 2, inPool: 2, byStatus: { PROVISIONAL: 2 } });
  assert.deepEqual(ledger.rows.slice(0, 442), JSON.parse(read(builder.SOURCES.ledgerV2[2])).rows);
  assert.equal(ledger.summary.inPool, 389);
});

test('shortage v3: every marginal is met; nothing authored, accepted or selected', () => {
  assert.deepEqual(shortage.lowerBounds, { total: 0, splitAware: 0, language: 0, fragments: 0 });
  assert.equal(shortage.minimumTopUpLowerBound, 0);
  assert.equal(shortage.pool.language.EN.pool, 39);
  for (const [key, value] of Object.entries(shortage.authority)) assert.equal(value, false, key);
});
