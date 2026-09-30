'use strict';

// Reviewed-pool ledger v2: v1 plus the 41 batch-004 rows; v1 stays byte-identical.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const v1 = require('../scripts/build-memory-inference-p1b6-reviewed-pool-ledger');
const builder = require('../scripts/build-memory-inference-p1b6-reviewed-pool-ledger-v2');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'fixtures', file));
const ledger = JSON.parse(read(builder.LEDGER_FILE));
const shortage = JSON.parse(read(builder.SHORTAGE_FILE));

test('committed v2 ledger and shortage are exactly the builder output; pinned inputs unchanged', () => {
  const built = builder.buildArtifacts();
  assert.deepEqual(v1.artifactBytes(built.ledger), read(builder.LEDGER_FILE));
  assert.deepEqual(v1.artifactBytes(built.shortage), read(builder.SHORTAGE_FILE));
  for (const [, rawSha256, fixture] of Object.values(builder.SOURCES)) assert.equal(sha256RawBytes(read(fixture)), rawSha256, fixture);
  const raw = builder.loadSources();
  assert.throws(() => builder.verifySources({ ...raw, human: Buffer.concat([raw.human, Buffer.from(' ')]) }), /not the pinned artifact/);
});

test('batch-004 rows: 38 in pool; 008 audit-excluded; 009 and 037 ineligible by owner resolution', () => {
  const rows = new Map(ledger.rows.filter(row => row.source === 'batch-004').map(row => [row.itemId.slice(-3), row]));
  assert.equal(rows.size, 41);
  assert.deepEqual(ledger.summary.batch004.byStatus, { PROVISIONAL: 37, EXCLUDED_AUDIT_UNCERTAIN: 1, INELIGIBLE: 2, HUMAN_ADJUDICATED: 1 });
  assert.equal(rows.get('008').status, 'EXCLUDED_AUDIT_UNCERTAIN');
  for (const slot of ['009', '037']) assert.equal(rows.get(slot).inPool, false, slot);
  assert.equal(rows.get('032').provenance, 'HUMAN_ADJUDICATED');
  assert.deepEqual(builder.OWNER_RESOLUTIONS.map(row => row.itemId), ['p1b6-item-b004-009', 'p1b6-item-b004-037']);
  assert.deepEqual(ledger.rows.slice(0, 401), JSON.parse(read(builder.SOURCES.ledgerV1[2])).rows);
  assert.equal(ledger.summary.inPool, 387);
});

test('shortage v2: only EN is short, by one; nothing authored or accepted', () => {
  assert.deepEqual(shortage.lowerBounds, { total: 0, splitAware: 0, language: 1, fragments: 0 });
  assert.equal(shortage.minimumTopUpLowerBound, 1);
  assert.equal(shortage.pool.language.EN.deficit, 1);
  for (const [key, value] of Object.entries(shortage.authority)) assert.equal(value, false, key);
});
