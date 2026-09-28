'use strict';

// Blind fresh source-audit packet for the five aebbf047 anchor-only repair candidates.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-batch-003-anchor-repair-source-audit-packet');
const historicalAudit = require('../scripts/build-memory-inference-p1b6-source-audit-packet');

const PACKET_SHA256 = 'c75e53e09b3eb7dcb8685cc727c92d71792d38124268b7a8c035b1fa2059fe00';
const build = (overrides = {}) => builder.buildSourceAuditPacket({ ...builder.loadCanonicalInputs(), ...overrides });

test('the packet is deterministic and binds the canonical inputs', () => {
  const packet = build();
  assert.equal(sha256RawBytes(builder.packetBytes(packet)), PACKET_SHA256);
  assert.equal(packet.status, 'BLIND_SOURCE_AUDIT_PACKET_NOT_RUN');
  assert.equal(packet.candidate.rawSha256, builder.CANONICAL_INPUTS.candidate.rawSha256);
  assert.equal(packet.sourceAuditProtocol.rawSha256, builder.CANONICAL_INPUTS.sourceAuditProtocol.rawSha256);
});

test('drifted inputs fail closed', () => {
  for (const key of Object.keys(builder.CANONICAL_INPUTS)) {
    const raw = builder.loadCanonicalInputs()[key];
    assert.throws(() => build({ [key]: Buffer.concat([raw, Buffer.from(' ')]) }), /not the canonical evidence/, key);
  }
});

test('five opaque rows, sorted, mapped to 224-228, disjoint from the historical audit IDs', () => {
  const packet = build();
  const ids = packet.rows.map(row => row.auditRowId);
  assert.equal(ids.length, 5);
  assert.deepEqual(ids, ids.toSorted());
  const sha = builder.CANONICAL_INPUTS.candidate.rawSha256;
  assert.deepEqual(builder.EXPECTED_ITEM_IDS.map(id => builder.opaqueAuditRowId(sha, id)).toSorted(), ids);
  const batchSha = '90b453c3680bccaa537fd0d23db74bbc303882e1a35a2ddcea0b75b013fcaa68';
  const old = new Set(builder.EXPECTED_ITEM_IDS.map(id => historicalAudit.opaqueAuditRowId(batchSha, id)));
  for (const row of packet.rows) {
    assert.deepEqual(Object.keys(row), ['auditRowId', 'sourceEpisode', 'selectedBundle']);
    assert.match(row.auditRowId, /^p1b6-b003-anchor-audit-[0-9a-f]{16}$/u);
    assert.equal(old.has(row.auditRowId), false);
    assert.equal(row.selectedBundle.split('[TARGET]').length, 2);
  }
});

test('the packet leaks no identity, skeleton, label, old anchor or resolution metadata', () => {
  const text = JSON.stringify(build());
  for (const value of ['p1b6-item-', 'p1b6-se-', 'p1b6-sf-', 'p1b6-sk-', 'surface-family', 'aebbf047',
    'CLEAR', 'ESCALATE', 'DEV', 'REANCHOR', 'ANCHOR_QUALITY', 'approvedAnchorText', 'currentAnchorText']) {
    assert.equal(text.includes(value), false, value);
  }
});

const RECEIPT = path.join(__dirname, '..', 'fixtures', builder.RECEIPT_FIXTURE);
const RAW = path.join(os.homedir(), 'p1b6-b003-anchor-source-audit-results.json');
const synthetic = mutate => {
  const results = build().rows.map(row => ({ auditRowId: row.auditRowId, disposition: 'PASS', reason: 'r' }));
  mutate(results);
  return Buffer.from(JSON.stringify({ results }));
};

test('audit results are bound to the packet rows and fail closed on drift', () => {
  assert.equal(builder.buildSourceAuditReceipt(synthetic(() => {})).status, 'COMPLETE_PASS');
  const needsFix = builder.buildSourceAuditReceipt(synthetic(rows => { rows[0].disposition = 'UNCERTAIN'; }));
  assert.equal(needsFix.status, 'COMPLETE_NEEDS_FIX');
  assert.equal(needsFix.authority.sourceBundleGatePassedForCandidates, false);
  assert.throws(() => builder.buildSourceAuditReceipt(synthetic(rows => rows.pop())), /exactly the packet rows/);
  assert.throws(() => builder.buildSourceAuditReceipt(synthetic(rows => { rows[0].reason = ''; })), /malformed/);
});

test('the committed audit receipt records 5/5 PASS and opens no semantic gate', () => {
  const receipt = JSON.parse(fs.readFileSync(RECEIPT));
  assert.equal(receipt.status, 'COMPLETE_PASS');
  assert.equal(receipt.auditPacketSha256, PACKET_SHA256);
  assert.deepEqual(receipt.summary, { total: 5, PASS: 5, FAIL: 0, UNCERTAIN: 0 });
  assert.equal(receipt.rawResultArtifact.committed, false);
  assert.equal(receipt.freshness.historicalSourceAuditResultInherited, false);
  for (const key of ['semanticReviewOccurred', 'humanReviewOccurred', 'datasetAcceptancePerformed',
    'heldOutReleasePerformed', 'trainingOccurred']) {
    assert.equal(receipt.authority[key], false, key);
  }
});

test('the audit receipt equals the raw result bytes when they are supplied', { skip: !fs.existsSync(RAW) }, () => {
  assert.deepEqual(builder.buildSourceAuditReceipt(fs.readFileSync(RAW)), JSON.parse(fs.readFileSync(RECEIPT)));
});
