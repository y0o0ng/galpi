'use strict';

// Blind fresh source-audit packet for the 2 batch-005 EN top-up surfaces.

const test = require('node:test');
const assert = require('node:assert/strict');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-batch-005-source-audit-packet');

const PACKET_SHA256 = 'bcc144bda59e754ce8082958126ce67a2a3baf4bf73233b3806e3f9202d6bd2f';
const build = (overrides = {}) => builder.buildSourceAuditPacket({ ...builder.loadCanonicalInputs(), ...overrides });

test('the packet is deterministic and binds the canonical inputs; drift fails closed', () => {
  const packet = build();
  assert.equal(sha256RawBytes(builder.packetBytes(packet)), PACKET_SHA256);
  assert.equal(packet.status, 'BLIND_SOURCE_AUDIT_PACKET_NOT_RUN');
  for (const key of Object.keys(builder.CANONICAL_INPUTS)) {
    const raw = builder.loadCanonicalInputs()[key];
    assert.throws(() => build({ [key]: Buffer.concat([raw, Buffer.from(' ')]) }), /not the canonical evidence/, key);
  }
});

test('2 sorted opaque rows with the full episode, one TARGET and no leaked metadata', () => {
  const packet = build();
  const ids = packet.rows.map(row => row.auditRowId);
  assert.equal(new Set(ids).size, builder.EXPECTED_ROWS);
  assert.deepEqual(ids, ids.toSorted());
  for (const row of packet.rows) {
    assert.deepEqual(Object.keys(row), ['auditRowId', 'sourceEpisode', 'selectedBundle']);
    assert.match(row.auditRowId, /^p1b6-b005-audit-[0-9a-f]{16}$/u);
    assert.equal(row.selectedBundle.split('[TARGET]').length, 2);
  }
  const text = JSON.stringify(packet);
  for (const value of ['p1b6-item-', 'p1b6-se-', 'p1b6-sf-', 'p1b6-sk-', 'semanticSkeletonId', 'CLEAR', 'ESCALATE',
    'TRAIN', 'CANONICAL', 'CONTEXT_FIRST', '"PASS"', '"FAIL"', '"UNCERTAIN"', 'disposition']) {
    assert.equal(text.includes(value), false, value);
  }
});
