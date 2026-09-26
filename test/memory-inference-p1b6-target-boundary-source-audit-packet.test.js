'use strict';

// Blind fresh source-audit packet for the TARGET-boundary candidates tb1-001 / tb1-002.

const test = require('node:test');
const assert = require('node:assert/strict');
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
