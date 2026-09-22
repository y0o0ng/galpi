'use strict';

// Blind source-audit packet for the two repaired batch-003 candidates (162, 214).
//
// Constructing the packet is not the audit: nothing here produces a disposition, a HUMAN packet
// or an acceptance. These tests pin the population, the canonical bindings, blindness, source
// completeness and the repair wording.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const packetBuilder = require('../scripts/build-memory-inference-p1b6-batch-003-repair-source-audit-packet');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file));
const readJson = file => JSON.parse(read(file));
const artifactBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');

const PACKET_SHA256 = 'b32f57a45ad9728a5f1636e9b0298776a38b757ccfb02b1b47b95e4a622ba679';
const CANDIDATE = 'fixtures/local-memory-inference-p1b6-surface-repair-candidate-batch-003.json';
const UNCHANGED = Object.freeze({
  'fixtures/local-memory-inference-p1b6-surface-batch-003.json':
    '90b453c3680bccaa537fd0d23db74bbc303882e1a35a2ddcea0b75b013fcaa68',
  'scripts/build-memory-inference-p1b6-surface-repair-source-audit-packet.js':
    'f950707607269227cb676cc64e3ca1f8e648a59c9073945ffe4e0d40b285103a',
});

const inputs = () => packetBuilder.loadCanonicalInputs();
const build = (overrides = {}) => packetBuilder.buildRepairSourceAuditPacket({ ...inputs(), ...overrides });

test('the packet binds the exact canonical inputs and is deterministic', () => {
  for (const pinned of Object.values(packetBuilder.CANONICAL_INPUTS)) {
    assert.equal(sha256RawBytes(read(`fixtures/${pinned.fixture}`)), pinned.rawSha256, pinned.fixture);
  }
  const packet = build();
  assert.equal(sha256RawBytes(packetBuilder.packetBytes(packet)), PACKET_SHA256);
  assert.deepEqual(packetBuilder.packetBytes(build()), packetBuilder.packetBytes(packet));
  assert.equal(packet.status, 'BLIND_SOURCE_AUDIT_PACKET_NOT_RUN');
  assert.equal(packet.repairCandidate.rawSha256, packetBuilder.CANONICAL_INPUTS.repairCandidate.rawSha256);
  assert.equal(packet.resolutionReceipt.rawSha256, packetBuilder.CANONICAL_INPUTS.resolutionReceipt.rawSha256);
  assert.equal(packet.semanticAuthority.rawSha256, packetBuilder.CANONICAL_INPUTS.semanticAuthority.rawSha256);
  assert.equal(packet.sourceAuditProtocol.rawSha256,
    '63a2c70c3af608d60fb817f092e16c62986b1b5ba09a6d19300fa34e24582a1d');
});

test('exactly two rows, mapped to 162 and 214 in candidate order', () => {
  const packet = build();
  assert.equal(packet.rows.length, 2);
  const sha = packetBuilder.CANONICAL_INPUTS.repairCandidate.rawSha256;
  assert.deepEqual(packet.rows.map(row => row.auditRowId), packetBuilder.EXPECTED_ITEM_IDS
    .map(itemId => packetBuilder.opaqueAuditRowId(sha, itemId)));
  for (const row of packet.rows) {
    assert.match(row.auditRowId, /^p1b6-b003-repair-audit-[0-9a-f]{16}$/u);
    assert.deepEqual(Object.keys(row), ['auditRowId', 'sourceEpisode', 'selectedBundle']);
    assert.deepEqual(Object.keys(row.sourceEpisode), ['turns']);
  }
  // No rejected or retired row can enter: the population is exactly the two repaired items.
  const receipt = readJson('fixtures/local-memory-inference-p1b6-batch-003-resolution-receipt.json');
  const excluded = receipt.decisions.filter(row => row.resolution !== 'SURFACE_REPAIR')
    .map(row => packetBuilder.opaqueAuditRowId(sha, row.itemId));
  assert.equal(packet.rows.some(row => excluded.includes(row.auditRowId)), false);
});

test('drift in any canonical input, or a noncanonical candidate, fails closed', () => {
  for (const key of Object.keys(packetBuilder.CANONICAL_INPUTS)) {
    const drifted = JSON.parse(inputs()[key].toString('utf8'));
    drifted.driftMarker = true;
    assert.throws(() => build({ [key]: artifactBytes(drifted) }), /not the canonical evidence/, key);
    assert.throws(() => build({ [key]: undefined }), /were not supplied/, key);
  }
  // Provenance pointing at a different receipt or authority is a different candidate.
  for (const change of [
    candidate => { candidate.provenance.resolutionReceipt.rawSha256 = 'a'.repeat(64); },
    candidate => { candidate.provenance.semanticAuthority.identity = 'xion-local-memory-inference-p1b6-skeleton-effective-current-v2'; },
  ]) {
    const candidate = readJson(CANDIDATE);
    change(candidate);
    assert.throws(() => build({ repairCandidate: artifactBytes(candidate) }), /not the canonical evidence/);
  }
  // A plausible-looking candidate with internally consistent fields but other text still fails.
  const plausible = readJson(CANDIDATE);
  plausible.sourceEpisodes[1].turns[2].text = '더 정확히는, 주차권도 같이 연장할까요?';
  assert.throws(() => build({ repairCandidate: artifactBytes(plausible) }), /not the canonical evidence/);
  assert.throws(() => packetBuilder.buildRepairSourceAuditPacket(undefined), /were not supplied/);
});

test('the packet leaks no identity, label, decision or repair metadata', () => {
  const packet = build();
  const text = JSON.stringify(packet.rows);
  const candidate = readJson(CANDIDATE);
  const receipt = readJson('fixtures/local-memory-inference-p1b6-batch-003-resolution-receipt.json');
  const forbidden = [
    ...candidate.items.flatMap(row => [row.itemId, row.sourceEpisodeId, row.surfaceFamilyId,
      row.semanticSkeletonId, row.discoursePattern, row.historicalDiscoursePattern,
      ...row.intendedUnresolvedReadings]),
    ...candidate.sourceEpisodes.flatMap(row => [row.sourceFamilyId, row.splitAssignment]),
    ...receipt.decisions.filter(row => row.resolution === 'SURFACE_REPAIR')
      .flatMap(row => [row.rationale, row.resolution]),
    'p1b6-item-', 'p1b6-se-', 'p1b6-sf-', 'p1b6-sk-', 'surface-family', 'CLEAR', 'ESCALATE',
    'KEEP', 'FIX', 'REJECT', 'PASS', 'FAIL', 'UNCERTAIN', 'TRAIN', 'DEV', 'FINAL_HELD_OUT',
    'REVISION', 'REFERENT', 'boundary', 'humanDecision', 'humanLabel', 'strongModel', 'expected',
  ];
  for (const value of forbidden) assert.equal(text.includes(value), false, value);
  // The header carries only artifact bindings, never per-row semantics.
  assert.deepEqual(Object.keys(packet), ['name', 'status', 'repairCandidate', 'resolutionReceipt',
    'semanticAuthority', 'sourceAuditProtocol', 'rendererIdentity', 'freshnessContract', 'rows']);
});

test('each row carries the complete repaired episode and the exact selected bundle', () => {
  const packet = build();
  const candidate = readJson(CANDIDATE);
  candidate.items.forEach((item, index) => {
    const row = packet.rows[index];
    const episode = candidate.sourceEpisodes.find(entry => entry.sourceEpisodeId === item.sourceEpisodeId);
    assert.deepEqual(row.sourceEpisode.turns, episode.turns);
    const turns = new Map(episode.turns.map(turn => [turn.turnId, turn]));
    const expected = item.evidenceSpanRefs.map(span => {
      const turn = turns.get(span.turnId);
      const bytes = Buffer.from(turn.text, 'utf8');
      let text = bytes.subarray(span.startByte, span.endByte).toString('utf8');
      if (span.turnId === item.anchorSpanRef.turnId) {
        text = `${bytes.subarray(0, item.anchorSpanRef.startByte)}[TARGET]${
          bytes.subarray(item.anchorSpanRef.startByte, item.anchorSpanRef.endByte)}[/TARGET]${
          bytes.subarray(item.anchorSpanRef.endByte)}`;
      }
      return `${turn.role}: ${text}`;
    }).join('\n---\n');
    assert.equal(row.selectedBundle, expected);
    assert.equal(row.selectedBundle.split('[TARGET]').length, 2);
    assert.equal(row.selectedBundle.split('[/TARGET]').length, 2);
    assert.equal(/\[TARGET\](.*?)\[\/TARGET\]/u.exec(row.selectedBundle)[1], item.anchorText);
  });
});

test('162 drops the same-instance turn and 214 carries the alternative question', () => {
  const [row162, row214] = build().rows;
  const all162 = JSON.stringify(row162);
  assert.equal(all162.includes('결론만 말하면 그 mug를 두 번 봤어.'), false);
  assert.equal(row162.selectedBundle, [
    'USER: 지난달 회의실에 있던 [TARGET]파란 mug[/TARGET]는 손잡이에 흠집이 있었어.',
    'USER: 어제 휴게실에서도 흠집 있는 파란 mug를 봤어.',
    'USER: 그런데 어제 것은 바닥에 이름이 적혀 있더라.',
  ].join('\n---\n'));
  const all214 = JSON.stringify(row214);
  assert.equal(all214.includes('아니면 주차권을 연장할까요?'), true);
  assert.equal(/더 정확히는|도 같이/u.test(all214), false);
  assert.equal(row214.selectedBundle, [
    'ASSISTANT: 다음 달 정기권을 연장할까요?',
    'ASSISTANT: 아니면 주차권을 연장할까요?',
    'USER: 응, [TARGET]연장해 줘[/TARGET].',
  ].join('\n---\n'));
});

test('the CLI needs an explicit path, refuses to overwrite and prints the SHA', () => {
  assert.throws(() => packetBuilder.main([]), /Usage/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b6-b003-audit-'));
  const output = path.join(dir, 'packet.json');
  assert.equal(packetBuilder.writeRepairSourceAuditPacket(output), PACKET_SHA256);
  assert.equal(sha256RawBytes(fs.readFileSync(output)), PACKET_SHA256);
  assert.throws(() => packetBuilder.writeRepairSourceAuditPacket(output), /will not be overwritten/);
  fs.rmSync(dir, { recursive: true });
});

test('historical and canonical artifacts are unchanged by packet construction', () => {
  build();
  for (const [file, sha] of Object.entries(UNCHANGED)) {
    assert.equal(sha256RawBytes(read(file)), sha, file);
  }
  for (const pinned of Object.values(packetBuilder.CANONICAL_INPUTS)) {
    assert.equal(sha256RawBytes(read(`fixtures/${pinned.fixture}`)), pinned.rawSha256);
  }
});
