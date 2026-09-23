'use strict';

// Blind v3 HUMAN review packet for the two repaired batch-003 candidates (162, 214).
//
// Constructing the packet is not the review: nothing here produces a HUMAN decision, ingests a
// result or accepts a row. These tests pin the gate on the completed source audit, the v3
// protocol, blindness, and that the visible bundles are exactly the audited bytes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-batch-003-repair-human-review-packet');
const auditBuilder = require('../scripts/build-memory-inference-p1b6-batch-003-repair-source-audit-packet');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file));
const readJson = file => JSON.parse(read(file));
const artifactBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');

const PACKET_SHA256 = '2d58d919f94ce32520b9fd4e74974581364fb7b291a0ee148fe89ae795e381a7';
const RECEIPT = 'fixtures/local-memory-inference-p1b6-batch-003-repair-source-audit-attempt-001.json';
const PROTOCOL = 'fixtures/local-memory-inference-p1b6-batch-003-repair-human-review-protocol.json';
const CANDIDATE = 'fixtures/local-memory-inference-p1b6-surface-repair-candidate-batch-003.json';
const V3 = 'fixtures/local-memory-inference-p1b6-skeleton-effective-current-v3.json';
const UNCHANGED = Object.freeze({
  'scripts/build-memory-inference-p1b6-surface-repair-human-review-packet.js':
    'afa7b4d87d144d6c810ced0c40cac014c395619ff0e28b1d116d32fc16689ce7',
  'scripts/build-memory-inference-p1b6-human-review-packet.js':
    '74db840d5be654446c619cbbb8b7c0e00f70ef491cc5969a3c150275b2c4c12c',
  'scripts/build-memory-inference-p1b6-batch-003-repair-source-audit-packet.js':
    '5df5dcd25c633057b5b33a50ef08c6e6508e273368dff0f24e7424d853886437',
  'scripts/build-memory-inference-p1b6-batch-003-repair-candidate.js':
    '2aa60c251b2357b0060551bbe25029f4ccf73be137ad1371e4195fc4e04c9492',
  'fixtures/local-memory-inference-p1b6-batch-003-human-adjudication-calibration-protocol.json':
    '171ee15d02a0dd674ed72f6910654ce0fe58242700415ded7e91ec858e55e001',
  'test/memory-inference-p1b6-surface-repair-human-review-packet.test.js':
    '33f12d18cf7304b914f3fe085ed9a40dbff41ecdf52206d01d93f030ff7522aa',
  'fixtures/local-memory-inference-p1b6-surface-batch-003.json':
    '90b453c3680bccaa537fd0d23db74bbc303882e1a35a2ddcea0b75b013fcaa68',
});

const inputs = () => builder.loadCanonicalInputs();
const build = (overrides = {}) => builder.buildRepairHumanReviewPacket({ ...inputs(), ...overrides });
const validate = change => {
  const receipt = readJson(RECEIPT);
  change(receipt);
  return () => builder.validateAuditReceipt(receipt);
};

test('exact canonical inputs are pinned by raw SHA and the packet is deterministic', () => {
  assert.equal(sha256RawBytes(read(RECEIPT)),
    '60191c33f71a7531488ff7767fe281538a3498028944fae370c7b39e098f7b13');
  for (const pinned of Object.values(builder.CANONICAL_INPUTS)) {
    assert.equal(sha256RawBytes(read(`fixtures/${pinned.fixture}`)), pinned.rawSha256, pinned.fixture);
  }
  for (const pinned of Object.values(auditBuilder.CANONICAL_INPUTS)) {
    assert.equal(sha256RawBytes(read(`fixtures/${pinned.fixture}`)), pinned.rawSha256, pinned.fixture);
  }
  const packet = build();
  assert.equal(sha256RawBytes(builder.packetBytes(packet)), PACKET_SHA256);
  assert.deepEqual(builder.packetBytes(build()), builder.packetBytes(packet));
  assert.equal(packet.status, 'BLIND_HUMAN_REVIEW_PACKET_NOT_RUN');
  assert.deepEqual(packet.reviewProtocol, {
    identity: builder.CANONICAL_INPUTS.reviewProtocol.identity,
    protocolIdentity: readJson(PROTOCOL).protocolIdentity,
    rawSha256: sha256RawBytes(read(PROTOCOL)),
  });
  assert.deepEqual(packet.semanticAuthority, {
    identity: 'xion-local-memory-inference-p1b6-skeleton-effective-current-v3',
    rawSha256: sha256RawBytes(read(V3)),
  });
  assert.equal(packet.reviewedRepairCandidate.rawSha256, sha256RawBytes(read(CANDIDATE)));
  assert.deepEqual(packet.sourceAuditPrerequisite, {
    attemptId: 'p1b6-batch-003-repair-source-audit-attempt-001',
    receiptRawSha256: sha256RawBytes(read(RECEIPT)),
    status: 'COMPLETE_PASS',
    allRowsPassed: true,
  });
});

test('the committed audit receipt validates against the rebuilt audit packet', () => {
  const auditPacket = builder.validateAuditReceipt(readJson(RECEIPT));
  assert.equal(sha256RawBytes(builder.packetBytes(auditPacket)),
    'b32f57a45ad9728a5f1636e9b0298776a38b757ccfb02b1b47b95e4a622ba679');
});

test('missing, duplicate, unknown or non-PASS audit rows fail closed', () => {
  const rowError = /incomplete, unknown, duplicated, or not all PASS|exactly one row/;
  assert.throws(validate(r => { r.rows.pop(); }), rowError);
  assert.throws(validate(r => { r.rows[1] = { ...r.rows[0] }; }), rowError);
  assert.throws(validate(r => { r.rows[0].auditRowId = 'p1b6-b003-repair-audit-0000000000000000'; }), rowError);
  assert.throws(validate(r => { r.rows.push({ ...r.rows[0] }); }), rowError);
  for (const disposition of ['FAIL', 'UNCERTAIN', 'pass']) {
    assert.throws(validate(r => { r.rows[0].disposition = disposition; }), rowError);
  }
  assert.throws(validate(r => { r.rows[1].reason = '  '; }), rowError);
  assert.throws(validate(r => { r.rows[0].extra = true; }), rowError);
});

test('receipt status or summary drift fails closed', () => {
  assert.throws(validate(r => { r.status = 'COMPLETE_NEEDS_FIX'; }), /rebuilt audit packet/);
  for (const summary of [
    { total: 2, PASS: 1, FAIL: 1, UNCERTAIN: 0 },
    { total: 2, PASS: 1, FAIL: 0, UNCERTAIN: 1 },
    { total: 3, PASS: 3, FAIL: 0, UNCERTAIN: 0 },
    { total: 2, PASS: 2, FAIL: 0 },
  ]) {
    assert.throws(validate(r => { r.summary = summary; }), /2 PASS \/ 0 FAIL \/ 0 UNCERTAIN/);
  }
});

test('candidate, packet, v3, protocol and raw-result drift in the receipt fail closed', () => {
  assert.throws(validate(r => { r.auditedRepairCandidate.rawSha256 = 'a'.repeat(64); }), /repair candidate/);
  assert.throws(validate(r => { r.auditPacketSha256 = 'a'.repeat(64); }), /rebuilt audit packet/);
  assert.throws(validate(r => { r.auditPacketIdentity += '-x'; }), /rebuilt audit packet/);
  assert.throws(validate(r => { r.semanticAuthority.rawSha256 = 'a'.repeat(64); }), /semantic authority v3/);
  assert.throws(validate(r => {
    r.semanticAuthority.identity = 'xion-local-memory-inference-p1b6-skeleton-effective-current-v2';
  }), /semantic authority v3/);
  assert.throws(validate(r => { r.sourceAuditProtocol.sha256 = 'a'.repeat(64); }), /source-audit protocol/);
  assert.throws(validate(r => { r.sourceAuditProtocol.identity = 'other'; }), /source-audit protocol/);
  assert.throws(validate(r => { r.rawResultArtifact.sha256 = 'a'.repeat(64); }), /raw result/);
});

test('freshness inheritance and authority overclaim fail closed', () => {
  const inherit = /inherits or claims to inherit/;
  assert.throws(validate(r => { r.freshness.freshJudgmentsForEveryRow = false; }), inherit);
  assert.throws(validate(r => { r.freshness.historicalSourceAuditResultInherited = true; }), inherit);
  const overclaim = /claims authority it does not have/;
  for (const key of Object.keys(readJson(RECEIPT).authority)) {
    if (key === 'sourceBundleGatePassedForRepairedCandidates') {
      assert.throws(validate(r => { r.authority[key] = false; }), overclaim);
    } else {
      assert.throws(validate(r => { r.authority[key] = true; }), overclaim, key);
    }
  }
  assert.throws(validate(r => { r.authority.referenceLabelFrozen = false; }), overclaim);
});

test('drift in the pinned receipt, protocol or audit inputs fails the build', () => {
  for (const key of Object.keys(builder.CANONICAL_INPUTS)) {
    const drifted = JSON.parse(inputs()[key].toString('utf8'));
    drifted.driftMarker = true;
    assert.throws(() => build({ [key]: artifactBytes(drifted) }), /not the canonical evidence/, key);
    assert.throws(() => build({ [key]: undefined }), /were not supplied/, key);
  }
  for (const key of Object.keys(auditBuilder.CANONICAL_INPUTS)) {
    const audit = { ...inputs().audit, [key]: Buffer.concat([inputs().audit[key], Buffer.from(' ')]) };
    assert.throws(() => build({ audit }), /not the canonical evidence/, key);
  }
  assert.throws(() => builder.buildRepairHumanReviewPacket(undefined), /were not supplied/);
});

test('the protocol binds exactly v3 and carries its rules without an expected answer', () => {
  const protocol = readJson(PROTOCOL);
  const v3 = readJson(V3);
  assert.equal(builder.validateProtocol(protocol), protocol);
  assert.deepEqual(protocol.semanticContract.semanticAuthority,
    { identity: v3.name, rawSha256: sha256RawBytes(read(V3)) });
  assert.deepEqual(protocol.semanticContract.semanticContractReceipt, v3.semanticContractReceipt);
  assert.equal(protocol.semanticContract.interpretationRuleIdentity, v3.interpretationRule.identity);
  for (const key of ['clear', 'escalate', 'uncertaintyDistinction', 'targetBoundary', 'pragmaticResolution']) {
    assert.equal(protocol.question[key], v3.interpretationRule[key], key);
  }
  assert.equal(protocol.question.noAddedPremise, v3.interpretationRule.retainedV2Clauses.noAddedPremise);
  // The superseded v2 rule appears only in the note explaining why it is not used.
  assert.equal(JSON.stringify(protocol.question).includes('Unknown is not ambiguity'), false);
  assert.equal(JSON.stringify(protocol.question).includes('unknownIsNotAmbiguity'), false);
  // No row, item or expected label appears anywhere in the protocol.
  const text = JSON.stringify(protocol);
  for (const value of ['162', '214', 'p1b6-item-', 'p1b6-sk-', 'mug', '연장', 'expectedDecision']) {
    assert.equal(text.includes(value), false, value);
  }
  assert.deepEqual(protocol.outputContract.allowedOutcomes, [
    { disposition: 'KEEP', decision: 'CLEAR' },
    { disposition: 'KEEP', decision: 'ESCALATE' },
    { disposition: 'FIX', decision: null },
    { disposition: 'REJECT', decision: null },
  ]);
  assert.match(protocol.constraints.join(' '), /does NOT silently relabel the skeleton.*automatically accept the surface/);

  for (const change of [
    p => { p.semanticContract.semanticAuthority.rawSha256 = 'a'.repeat(64); },
    p => { p.semanticContract.semanticAuthority.identity = 'xion-local-memory-inference-p1b6-skeleton-effective-current-v2'; },
    p => { p.semanticContract.semanticContractReceipt.rawSha256 = 'a'.repeat(64); },
    p => { p.semanticContract.interpretationRuleIdentity = 'P1B6_SEMANTIC_CONTRACT_V2'; },
    p => { p.status = 'COMPLETE'; },
  ]) {
    const drifted = readJson(PROTOCOL);
    change(drifted);
    assert.throws(() => builder.validateProtocol(drifted), /does not bind semantic contract v3/);
  }
});

test('exactly two rows with deterministic, unique opaque IDs in a new namespace, sorted', () => {
  const packet = build();
  assert.equal(packet.rows.length, 2);
  const sha = auditBuilder.CANONICAL_INPUTS.repairCandidate.rawSha256;
  const ids = auditBuilder.EXPECTED_ITEM_IDS.map(itemId => builder.opaqueReviewRowId(sha, itemId));
  assert.deepEqual(packet.rows.map(row => row.reviewRowId), ids.toSorted());
  assert.equal(new Set(ids).size, 2);
  for (const row of packet.rows) {
    assert.match(row.reviewRowId, /^p1b6-b003-repair-review-[0-9a-f]{16}$/u);
    assert.deepEqual(Object.keys(row), ['reviewRowId', 'selectedBundle']);
    for (const prior of ['p1b6-review-', 'p1b6-rereview-', 'p1b6-hacreview-', 'p1b6-repair-review-',
      'p1b6-audit-', 'p1b6-repair-audit-', 'p1b6-b003-repair-audit-']) {
      assert.equal(row.reviewRowId.startsWith(prior), false, prior);
    }
  }
});

test('selected bundles are the audited bytes and no source episode is present', () => {
  const packet = build();
  const auditPacket = auditBuilder.buildRepairSourceAuditPacket(auditBuilder.loadCanonicalInputs());
  const sha = auditBuilder.CANONICAL_INPUTS.repairCandidate.rawSha256;
  for (const itemId of auditBuilder.EXPECTED_ITEM_IDS) {
    const reviewRow = packet.rows.find(row => row.reviewRowId === builder.opaqueReviewRowId(sha, itemId));
    const auditRow = auditPacket.rows.find(row => row.auditRowId === auditBuilder.opaqueAuditRowId(sha, itemId));
    assert.equal(Buffer.from(reviewRow.selectedBundle).equals(Buffer.from(auditRow.selectedBundle)), true);
    assert.equal(reviewRow.selectedBundle.split('[TARGET]').length, 2);
  }
  const text = JSON.stringify(packet);
  assert.equal(text.includes('sourceEpisode'), false);
  assert.equal(text.includes('turns'), false);
  // Turns outside the bundles (e.g. 정수기 in 162, 지갑 in 214) never reach the packet.
  for (const value of ['정수기', '지갑', '영수증']) assert.equal(text.includes(value), false, value);
});

test('the packet leaks no identity, label, history, audit reason, rationale or reading', () => {
  const packet = build();
  const text = JSON.stringify(packet);
  const rowsText = JSON.stringify(packet.rows);
  const candidate = readJson(CANDIDATE);
  const resolution = readJson('fixtures/local-memory-inference-p1b6-batch-003-resolution-receipt.json');
  const v3 = readJson(V3);
  const skeletons = new Set(candidate.items.map(row => row.semanticSkeletonId));
  const forbidden = [
    ...candidate.items.flatMap(row => [row.itemId, row.sourceEpisodeId, row.surfaceFamilyId,
      row.semanticSkeletonId, row.discoursePattern, row.historicalDiscoursePattern,
      ...row.intendedUnresolvedReadings]),
    ...candidate.sourceEpisodes.flatMap(row => [row.sourceFamilyId]),
    ...v3.candidates.filter(row => skeletons.has(row.semanticSkeletonId))
      .flatMap(row => [row.candidateFocus, row.interpretationContract]),
    ...resolution.decisions.filter(row => row.resolution === 'SURFACE_REPAIR')
      .flatMap(row => [row.rationale]),
    ...readJson(RECEIPT).rows.map(row => row.reason),
    'p1b6-item-', 'p1b6-se-', 'p1b6-sf-', 'p1b6-sk-', 'b003-162', 'b003-214',
    'SURFACE_REPAIR', 'humanDecision', 'humanLabel', 'referenceLabel', 'expected', 'rationale',
    'boundary', 'splitAssignment', 'IDENTITY', 'ELLIPSIS', 'REFERENT',
  ].filter(Boolean);
  for (const value of forbidden) assert.equal(text.includes(value), false, value);
  // No answer or history anywhere in the rows.
  for (const value of ['CLEAR', 'ESCALATE', 'KEEP', 'FIX', 'REJECT', 'PASS', 'FAIL', 'UNCERTAIN',
    'TRAIN', 'DEV', 'FINAL_HELD_OUT', 'v2']) {
    assert.equal(rowsText.includes(value), false, value);
  }
  // The header carries only artifact bindings.
  assert.deepEqual(Object.keys(packet), ['name', 'status', 'reviewProtocol', 'semanticAuthority',
    'reviewedRepairCandidate', 'rendererIdentity', 'sourceAuditPrerequisite', 'rows']);
  assert.equal(/"(CLEAR|ESCALATE)"/u.test(text), false);
});

test('162 and 214 repaired wording remains pinned', () => {
  const bundles = build().rows.map(row => row.selectedBundle).toSorted();
  assert.deepEqual(bundles, [
    [
      'ASSISTANT: 다음 달 정기권을 연장할까요?',
      'ASSISTANT: 아니면 주차권을 연장할까요?',
      'USER: 응, [TARGET]연장해 줘[/TARGET].',
    ].join('\n---\n'),
    [
      'USER: 지난달 회의실에 있던 [TARGET]파란 mug[/TARGET]는 손잡이에 흠집이 있었어.',
      'USER: 어제 휴게실에서도 흠집 있는 파란 mug를 봤어.',
      'USER: 그런데 어제 것은 바닥에 이름이 적혀 있더라.',
    ].join('\n---\n'),
  ].toSorted());
});

test('the CLI needs an explicit path, refuses to overwrite and prints SHA and row count', () => {
  assert.throws(() => builder.main([]), /Usage/);
  assert.throws(() => builder.main(['--output']), /Usage/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b6-b003-human-'));
  const output = path.join(dir, 'packet.json');
  assert.deepEqual(builder.writeRepairHumanReviewPacket(output), { rawSha256: PACKET_SHA256, rowCount: 2 });
  assert.equal(sha256RawBytes(fs.readFileSync(output)), PACKET_SHA256);
  assert.throws(() => builder.writeRepairHumanReviewPacket(output), /will not be overwritten/);
  fs.rmSync(dir, { recursive: true });
});

test('historical builders and artifacts are unchanged by packet construction', () => {
  build();
  for (const [file, sha] of Object.entries(UNCHANGED)) {
    assert.equal(sha256RawBytes(read(file)), sha, file);
  }
});
