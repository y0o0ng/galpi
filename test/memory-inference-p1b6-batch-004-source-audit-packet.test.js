'use strict';

// Blind fresh source-audit packet for the 41 batch-004 top-up surfaces.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-batch-004-source-audit-packet');

const PACKET_SHA256 = '4f7cc2890d795a3dfabb20856cafc2d2a5e9d4948854911a35f04330240b0c3c';
const build = (overrides = {}) => builder.buildSourceAuditPacket({ ...builder.loadCanonicalInputs(), ...overrides });

test('the packet is deterministic and binds the canonical inputs', () => {
  const packet = build();
  assert.equal(sha256RawBytes(builder.packetBytes(packet)), PACKET_SHA256);
  assert.equal(packet.status, 'BLIND_SOURCE_AUDIT_PACKET_NOT_RUN');
  assert.equal(packet.sourceBatch.rawSha256, builder.CANONICAL_INPUTS.batch.rawSha256);
  assert.equal(packet.sourceAuditProtocol.rawSha256, builder.CANONICAL_INPUTS.sourceAuditProtocol.rawSha256);
});

test('drifted inputs fail closed', () => {
  for (const key of Object.keys(builder.CANONICAL_INPUTS)) {
    const raw = builder.loadCanonicalInputs()[key];
    assert.throws(() => build({ [key]: Buffer.concat([raw, Buffer.from(' ')]) }), /not the canonical evidence/, key);
  }
});

test('41 opaque rows, sorted, each with the full episode and one TARGET', () => {
  const packet = build();
  const ids = packet.rows.map(row => row.auditRowId);
  assert.equal(new Set(ids).size, builder.EXPECTED_ROWS);
  assert.deepEqual(ids, ids.toSorted());
  for (const row of packet.rows) {
    assert.deepEqual(Object.keys(row), ['auditRowId', 'sourceEpisode', 'selectedBundle']);
    assert.match(row.auditRowId, /^p1b6-b004-audit-[0-9a-f]{16}$/u);
    assert.equal(row.selectedBundle.split('[TARGET]').length, 2);
  }
});

test('the packet leaks no identity, skeleton, split, pattern, label or disposition', () => {
  const text = JSON.stringify(build());
  for (const value of ['p1b6-item-', 'p1b6-se-', 'p1b6-sf-', 'p1b6-sk-', 'surface-family', 'semanticSkeletonId',
    'splitAssignment', 'discoursePattern', 'targetAnchorRole', 'CLEAR', 'ESCALATE', 'TRAIN', 'DEV', 'CANONICAL',
    'ELLIPTICAL_REPLY', 'INTERLEAVED', 'RULE_RESULT', 'APPLICABILITY_STATUS', 'CATEGORY_MEMBERSHIP',
    '"PASS"', '"FAIL"', '"UNCERTAIN"', 'disposition']) {
    assert.equal(text.includes(value), false, value);
  }
});

const RECEIPT = path.join(__dirname, '..', 'fixtures', builder.RECEIPT_FIXTURE);
const RAW = path.join(os.homedir(), 'p1b6-b004-source-audit-results.json');
const synthetic = mutate => {
  const results = build().rows.map(row => ({ auditRowId: row.auditRowId, disposition: 'PASS', reason: 'r' }));
  mutate(results);
  return Buffer.from(JSON.stringify({ results }));
};

test('audit results are bound to the packet rows and fail closed on drift', () => {
  assert.equal(builder.buildSourceAuditReceipt(synthetic(() => {})).status, 'COMPLETE_PASS');
  const needsFix = builder.buildSourceAuditReceipt(synthetic(rows => { rows[0].disposition = 'UNCERTAIN'; }));
  assert.equal(needsFix.status, 'COMPLETE_NEEDS_FIX');
  assert.equal(needsFix.failClosedRows.length, 1);
  assert.match(needsFix.failClosedRows[0].itemId, /^p1b6-item-b004-\d{3}$/u);
  assert.throws(() => builder.buildSourceAuditReceipt(synthetic(rows => rows.pop())), /exactly the packet rows/);
  assert.throws(() => builder.buildSourceAuditReceipt(synthetic(rows => { rows[0].reason = ''; })), /malformed/);
});

test('the committed audit receipt records 40 PASS / 1 UNCERTAIN (008) and opens no semantic gate', () => {
  const receipt = JSON.parse(fs.readFileSync(RECEIPT));
  assert.equal(receipt.status, 'COMPLETE_NEEDS_FIX');
  assert.equal(receipt.auditPacketSha256, PACKET_SHA256);
  assert.deepEqual(receipt.summary, { total: 41, PASS: 40, FAIL: 0, UNCERTAIN: 1 });
  assert.deepEqual(receipt.failClosedRows.map(row => row.itemId), ['p1b6-item-b004-008']);
  assert.equal(receipt.rawResultArtifact.committed, false);
  for (const key of ['semanticReviewOccurred', 'humanReviewOccurred', 'datasetAcceptancePerformed',
    'heldOutReleasePerformed', 'trainingOccurred']) {
    assert.equal(receipt.authority[key], false, key);
  }
});

test('the audit receipt equals the raw result bytes when they are supplied', { skip: !fs.existsSync(RAW) }, () => {
  assert.deepEqual(builder.buildSourceAuditReceipt(fs.readFileSync(RAW)), JSON.parse(fs.readFileSync(RECEIPT)));
});
