'use strict';

// Reviewed-pool ledger v4: ledger v3 with the accepted-row v3 migration applied.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const v1 = require('../scripts/build-memory-inference-p1b6-reviewed-pool-ledger');
const builder = require('../scripts/build-memory-inference-p1b6-reviewed-pool-ledger-v4');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'fixtures', file));
const ledger = JSON.parse(read(builder.LEDGER_FILE));
const shortage = JSON.parse(read(builder.SHORTAGE_FILE));

test('committed v4 ledger and shortage are exactly the builder output; pinned inputs unchanged', () => {
  const built = builder.buildArtifacts();
  assert.deepEqual(v1.artifactBytes(built.ledger), read(builder.LEDGER_FILE));
  assert.deepEqual(v1.artifactBytes(built.shortage), read(builder.SHORTAGE_FILE));
  for (const [, rawSha256, fixture] of Object.values(builder.SOURCES)) assert.equal(sha256RawBytes(read(fixture)), rawSha256, fixture);
});

test('migration applied: 2 rows migrate with the v3 label, 10 leave, no in-pool label differs from v3', () => {
  assert.equal(ledger.summary.inPool, 379);
  assert.deepEqual(ledger.summary.v3Migration.migrated, ['p1b6-item-b002-051', 'p1b6-item-b002-063']);
  assert.equal(ledger.summary.v3Migration.ineligible.length, 10);
  assert.deepEqual(ledger.summary.inPoolLabelDiffersFromV3, []);
  const migrated = ledger.rows.find(row => row.itemId === 'p1b6-item-b002-051');
  assert.deepEqual([migrated.referenceLabel, migrated.humanGoldLabel, migrated.provenance], ['CLEAR', 'ESCALATE', 'CATALOG_STRONG_MODEL_CONFIRMED']);
});

test('shortage v4: DEV 1 and HELD per-skeleton 4 make the minimum top-up 5', () => {
  assert.deepEqual(shortage.lowerBounds, { total: 1, splitAware: 5, language: 2, fragments: 5 });
  assert.equal(shortage.minimumTopUpLowerBound, 5);
  assert.deepEqual(shortage.heldSkeletons.filter(row => row.needTo5).map(row => [row.semanticSkeletonId, row.needTo5]),
    [['p1b6-sk-2fa39ece4157b2b8', 2], ['p1b6-sk-869c71279b6b8a33', 1], ['p1b6-sk-a19bb9e94e9a416b', 1]]);
});
