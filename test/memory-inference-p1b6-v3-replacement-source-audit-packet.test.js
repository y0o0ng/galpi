'use strict';

// Blind fresh source-audit packet for the v3 replacement candidates rp1-001 / rp1-002.

const test = require('node:test');
const assert = require('node:assert/strict');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-v3-replacement-source-audit-packet');

const PACKET_SHA256 = '306290286bc26d534e84d83f6dbe5f6015ce7a38439216abf02b382652067d76';
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

test('two opaque rows, sorted, mapped to rp1-001 and rp1-002', () => {
  const packet = build();
  const ids = packet.rows.map(row => row.auditRowId);
  assert.deepEqual(ids, ids.toSorted());
  const sha = builder.CANONICAL_INPUTS.candidate.rawSha256;
  assert.deepEqual(builder.EXPECTED_ITEM_IDS.map(id => builder.opaqueAuditRowId(sha, id)).toSorted(), ids);
  for (const row of packet.rows) {
    assert.deepEqual(Object.keys(row), ['auditRowId', 'sourceEpisode', 'selectedBundle']);
    assert.match(row.auditRowId, /^p1b6-rp1-audit-[0-9a-f]{16}$/u);
    assert.equal(row.selectedBundle.split('[TARGET]').length, 2);
  }
});

test('the packet leaks no identity, skeleton, reading or label', () => {
  const text = JSON.stringify(build());
  for (const value of ['p1b6-item-', 'p1b6-se-', 'p1b6-sf-', 'p1b6-sk-', 'surface-family', 'intendedUnresolvedReadings',
    '작업량이 약 절반', '가로 차이가', 'CLEAR', 'ESCALATE', 'TRAIN', 'splitAssignment', 'semanticSkeletonId',
    'f58debd8', '28736b74', 'APPROXIMATION']) {
    assert.equal(text.includes(value), false, value);
  }
});
