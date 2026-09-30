'use strict';

// Blind fresh source-audit packet for the 41 batch-004 top-up surfaces.

const test = require('node:test');
const assert = require('node:assert/strict');
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
