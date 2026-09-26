'use strict';

// Blind fresh source-audit packet for the TARGET-boundary candidates tb1-001 / tb1-002.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-target-boundary-source-audit-packet');

const PACKET_SHA256 = '457d84682420f443e2bc3becc88b51b8c2e01e51c7be53c2b12ec4a5e73af712';
const build = (overrides = {}) => builder.buildSourceAuditPacket({ ...builder.loadCanonicalInputs(), ...overrides });

test('the packet is deterministic and binds the canonical inputs', () => {
  const packet = build();
  assert.equal(sha256RawBytes(builder.packetBytes(packet)), PACKET_SHA256);
  assert.equal(packet.status, 'BLIND_SOURCE_AUDIT_PACKET_NOT_RUN');
  assert.equal(packet.candidate.rawSha256, builder.CANONICAL_INPUTS.candidate.rawSha256);
  assert.equal(packet.resolutionReceipt.rawSha256, builder.CANONICAL_INPUTS.resolutionReceipt.rawSha256);
  assert.equal(packet.sourceAuditProtocol.rawSha256, builder.CANONICAL_INPUTS.sourceAuditProtocol.rawSha256);
});

test('drifted inputs fail closed', () => {
  for (const key of Object.keys(builder.CANONICAL_INPUTS)) {
    const raw = builder.loadCanonicalInputs()[key];
    assert.throws(() => build({ [key]: Buffer.concat([raw, Buffer.from(' ')]) }), /not the canonical evidence/, key);
  }
});

test('two opaque rows, sorted, mapped to tb1-001 and tb1-002', () => {
  const packet = build();
  const ids = packet.rows.map(row => row.auditRowId);
  assert.deepEqual(ids, ids.toSorted());
  const sha = builder.CANONICAL_INPUTS.candidate.rawSha256;
  assert.deepEqual(builder.EXPECTED_ITEM_IDS.map(id => builder.opaqueAuditRowId(sha, id)).toSorted(), ids);
  for (const row of packet.rows) {
    assert.deepEqual(Object.keys(row), ['auditRowId', 'sourceEpisode', 'selectedBundle']);
    assert.match(row.auditRowId, /^p1b6-tb1-audit-[0-9a-f]{16}$/u);
    assert.equal(row.selectedBundle.split('[TARGET]').length, 2);
  }
});

test('the packet leaks no identity, skeleton, role, reading or label', () => {
  const text = JSON.stringify(build());
  for (const value of ['p1b6-item-', 'p1b6-se-', 'p1b6-sf-', 'p1b6-sk-', 'surface-family', 'targetAnchorRole',
    'RULE_RESULT', 'CATEGORY_MEMBERSHIP', 'intendedUnresolvedReadings', 'in fact classified',
    'CLEAR', 'ESCALATE', 'TRAIN', 'DEV', 'splitAssignment', 'semanticSkeletonId']) {
    assert.equal(text.includes(value), false, value);
  }
});

const RECEIPT = path.join(__dirname, '..', 'fixtures', builder.RECEIPT_FIXTURE);
const RAW = path.join(os.homedir(), 'p1b6-tb1-source-audit-results.json');
const synthetic = mutate => {
  const results = build().rows.map(row => ({ auditRowId: row.auditRowId, disposition: 'PASS', reason: 'r' }));
  mutate(results);
  return Buffer.from(JSON.stringify({ results }));
};

test('audit results are bound to the packet rows and fail closed on drift', () => {
  assert.equal(builder.buildSourceAuditReceipt(synthetic(() => {})).status, 'COMPLETE_PASS');
  const fail = builder.buildSourceAuditReceipt(synthetic(rows => { rows[0].disposition = 'UNCERTAIN'; }));
  assert.equal(fail.status, 'COMPLETE_NEEDS_FIX');
  assert.equal(fail.authority.sourceBundleGatePassedForCandidates, false);
  assert.throws(() => builder.buildSourceAuditReceipt(synthetic(rows => rows.pop())), /exactly the packet rows/);
  assert.throws(() => builder.buildSourceAuditReceipt(synthetic(rows => { rows[0].reason = ''; })), /malformed/);
  assert.throws(() => builder.buildSourceAuditReceipt(synthetic(rows => { rows[0].decision = 'CLEAR'; })), /malformed/);
});

test('the committed audit receipt records 2/2 PASS and opens no semantic gate', () => {
  const receipt = JSON.parse(fs.readFileSync(RECEIPT));
  assert.equal(receipt.status, 'COMPLETE_PASS');
  assert.equal(receipt.auditPacketSha256, PACKET_SHA256);
  assert.deepEqual(receipt.summary, { total: 2, PASS: 2, FAIL: 0, UNCERTAIN: 0 });
  assert.equal(receipt.rawResultArtifact.committed, false);
  assert.equal(receipt.freshness.historicalSourceAuditResultInherited, false);
  assert.equal(receipt.authority.sourceBundleGatePassedForCandidates, true);
  for (const key of ['semanticReviewOccurred', 'humanReviewOccurred', 'datasetAcceptancePerformed',
    'heldOutReleasePerformed', 'trainingOccurred']) {
    assert.equal(receipt.authority[key], false, key);
  }
});

test('the audit receipt equals the raw result bytes when they are supplied', { skip: !fs.existsSync(RAW) }, () => {
  assert.deepEqual(builder.buildSourceAuditReceipt(fs.readFileSync(RAW)), JSON.parse(fs.readFileSync(RECEIPT)));
});
