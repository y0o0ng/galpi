'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const surfaces = require('../lib/memory-inference-p1b6-surfaces');
const historicalHuman = require('../scripts/build-memory-inference-p1b6-human-review-packet');
const candidateBuilder = require('../scripts/build-memory-inference-p1b6-surface-repair-candidate');
const auditPacketBuilder =
  require('../scripts/build-memory-inference-p1b6-surface-repair-source-audit-packet');
const humanBuilder =
  require('../scripts/build-memory-inference-p1b6-surface-repair-human-review-packet');

const ROOT = path.resolve(__dirname, '..');
const fixture = file => path.join(ROOT, 'fixtures', file);
const read = file => fs.readFileSync(fixture(file));
const readJson = file => JSON.parse(read(file));

const AUDIT_RECEIPT = humanBuilder.AUDIT_RECEIPT_FIXTURE;
const CANDIDATE = candidateBuilder.CANDIDATE_FILE;
const BATCH_002 = 'local-memory-inference-p1b6-surface-batch-002.json';
const REJECTED = 'p1b6-item-b002-050';

const AUDIT_PACKET_SHA256 = '9586be2fde0822d4c8025f4aa7cd3ad4833b37e18ee0a5111275233816224356';
const AUDIT_RECEIPT_SHA256 = 'd08bf4488d4fa4a89c8f03172c4569405093051e939fea395a85b5fafda254b9';
const RAW_RESULT_SHA256 = 'fd4d11a21ea9ee960b7f990df9d0207c4768d122e3c6afdb1dffab013f17f4aa';
// Reused, never broadened. Drift here means historical contracts moved.
const UNCHANGED = Object.freeze({
  'lib/memory-inference-p1b6-surfaces.js':
    '4b6dabf2280529b138efe124f32252c2ff7a2b9a118d7eb2c2b3341c7c56f1b7',
  'fixtures/local-memory-inference-p1b6-skeleton-exact56.json':
    '772f07bd679a9c98ea65feaa164ec7a9c1f3e3fb33632052ef076f8301999602',
  'fixtures/local-memory-inference-p1b6-surface-batch-002.json':
    'ed68a562a67deee4d8e92d3e4841362d9589f876480d174a043d822cbf61e80c',
  'fixtures/local-memory-inference-p1b6-source-audit-protocol.json':
    '63a2c70c3af608d60fb817f092e16c62986b1b5ba09a6d19300fa34e24582a1d',
  'fixtures/local-memory-inference-p1b6-surface-repair-candidate-batch-002.json':
    'd59d0dec225d3f4fea74952da10e05b8f0be01942a3aa6e15ea58d659e22abb3',
});

const receipt = () => readJson(AUDIT_RECEIPT);
const build = (row = receipt()) => humanBuilder.buildRepairHumanReviewPacket(row);
const artifactBytes = candidateBuilder.artifactBytes;

test('the fresh 12/12 PASS result materializes into a valid audit receipt', () => {
  assert.equal(sha256RawBytes(read(AUDIT_RECEIPT)), AUDIT_RECEIPT_SHA256);
  const committed = receipt();
  assert.equal(committed.name, humanBuilder.AUDIT_RECEIPT_IDENTITY);
  assert.equal(committed.attemptId, humanBuilder.AUDIT_ATTEMPT_ID);
  assert.equal(committed.status, 'COMPLETE_PASS');
  assert.deepEqual(committed.summary, { total: 12, PASS: 12, FAIL: 0, UNCERTAIN: 0 });
  assert.equal(committed.rows.length, 12);
  assert.equal(committed.rows.every(row => row.disposition === 'PASS'), true);
  assert.equal(committed.rows.every(row => row.reason.trim().length > 0), true);

  // It binds to the exact reviewed bytes on every side.
  assert.equal(committed.auditPacketSha256, AUDIT_PACKET_SHA256);
  assert.equal(committed.auditPacketIdentity, auditPacketBuilder.PACKET_IDENTITY);
  assert.equal(committed.auditedRepairCandidate.rawSha256,
    auditPacketBuilder.CANONICAL_INPUTS.repairCandidate.rawSha256);
  assert.equal(committed.sourceAuditProtocol.sha256,
    auditPacketBuilder.CANONICAL_INPUTS.sourceAuditProtocol.rawSha256);
  assert.equal(committed.rawResultArtifact.filename, humanBuilder.RAW_RESULT_FILENAME);
  assert.equal(committed.rawResultArtifact.sha256, RAW_RESULT_SHA256);

  // Exactly the canonical opaque audit IDs, each once.
  const packet = auditPacketBuilder.buildRepairSourceAuditPacket(
    auditPacketBuilder.loadCanonicalInputs());
  assert.equal(sha256RawBytes(humanBuilder.packetBytes(packet)), AUDIT_PACKET_SHA256);
  assert.deepEqual(committed.rows.map(row => row.auditRowId).toSorted(),
    packet.rows.map(row => row.auditRowId).toSorted());

  // Freshness, and authority no wider than what happened.
  assert.equal(committed.freshness.freshJudgmentsForEveryRow, true);
  assert.equal(committed.freshness.historicalSourceAuditResultInherited, false);
  assert.equal(committed.authority.sourceBundleGatePassedForRepairedCandidates, true);
  for (const [key, value] of Object.entries(committed.authority)) {
    if (key !== 'sourceBundleGatePassedForRepairedCandidates') assert.equal(value, false, key);
  }

  // Execution provenance is recorded conservatively, not guessed.
  assert.equal(committed.auditorExecutionProvenance.model, 'NOT_RECOVERABLE_FROM_RESULT_ARTIFACT');
  assert.equal(committed.auditorExecutionProvenance.reasoningSetting,
    'NOT_RECOVERABLE_FROM_RESULT_ARTIFACT');
  assert.equal(committed.auditorExecutionProvenance.evidenceBasis.includes('USER_SUPPLIED'), true);

  assert.doesNotThrow(() => build());
});

test('the audit gate fails closed on a drifted, incomplete, or non-PASS result', () => {
  const reject = (mutate, label) => {
    const drifted = structuredClone(receipt());
    mutate(drifted);
    assert.throws(() => build(drifted), /P1-B6/, label);
  };

  reject(r => { r.rows.pop(); }, 'missing audit row');
  reject(r => { r.rows[1] = structuredClone(r.rows[0]); }, 'duplicate audit row');
  reject(r => { r.rows[0].auditRowId = 'p1b6-repair-audit-0000000000000000'; }, 'unknown audit row');
  reject(r => {
    r.rows.push(structuredClone(r.rows[0]));
    r.summary.total = 13;
    r.summary.PASS = 13;
  }, 'extra audit row');
  reject(r => { r.rows[0].disposition = 'FAIL'; r.summary.PASS = 11; r.summary.FAIL = 1; },
    'a FAIL result');
  reject(r => {
    r.rows[0].disposition = 'UNCERTAIN'; r.summary.PASS = 11; r.summary.UNCERTAIN = 1;
  }, 'an UNCERTAIN result');
  reject(r => { r.rows[0].reason = ''; }, 'empty reason');
  reject(r => { r.rows[0].reason = '   '; }, 'whitespace-only reason');
  reject(r => { r.status = 'COMPLETE_NEEDS_FIX'; }, 'non-PASS status');
  reject(r => { r.summary.PASS = 11; }, 'summary drift');

  // Binding drift on every pinned side.
  reject(r => { r.auditPacketSha256 = `${AUDIT_PACKET_SHA256.slice(0, -1)}0`; }, 'wrong packet SHA');
  reject(r => { r.auditPacketIdentity = 'xion-local-memory-inference-p1b6-source-audit-packet-v1'; },
    'historical packet identity');
  reject(r => { r.auditedRepairCandidate.rawSha256 = AUDIT_PACKET_SHA256; },
    'wrong candidate SHA');
  reject(r => { r.auditedRepairCandidate.identity = 'xion-wrong-candidate-v1'; },
    'wrong candidate identity');
  reject(r => { r.sourceAuditProtocol.sha256 = AUDIT_PACKET_SHA256; }, 'wrong protocol SHA');
  reject(r => { r.sourceAuditProtocol.identity = 'p1b6-source-bundle-completeness-audit-v2'; },
    'wrong protocol identity');
  reject(r => { r.name = 'xion-wrong-receipt-v1'; }, 'wrong receipt identity');
  reject(r => { r.attemptId = 'p1b6-source-audit-batch-002-attempt-001'; }, 'historical attempt id');

  // External result raw-byte drift, recorded and supplied.
  reject(r => { r.rawResultArtifact.sha256 = `${RAW_RESULT_SHA256.slice(0, -1)}0`; },
    'recorded result SHA drift');
  reject(r => { r.rawResultArtifact.filename = 'something-else.json'; }, 'result filename drift');
  assert.throws(() => humanBuilder.verifyRawResultArtifact(
    Buffer.from(JSON.stringify({ rows: [] }), 'utf8')),
  /not the reviewed evidence/, 'supplied result bytes drift');
  assert.throws(() => humanBuilder.verifyRawResultArtifact(undefined), /were not supplied/);

  // Inherited historical audit results.
  reject(r => { r.freshness.historicalSourceAuditResultInherited = true; }, 'claims inheritance');
  reject(r => { r.freshness.freshJudgmentsForEveryRow = false; }, 'denies fresh judgments');
  reject(r => { r.rows[0].auditRowId = 'p1b6-audit-1111111111111111'; },
    'historical audit ID namespace');

  // Authority no wider than what happened.
  reject(r => { r.authority.humanSemanticReviewOccurred = true; }, 'claims HUMAN review');
  reject(r => { r.authority.humanGoldAssignedOrFrozen = true; }, 'claims gold');
  reject(r => { r.authority.datasetAcceptancePerformed = true; }, 'claims acceptance');
  reject(r => { r.authority.heldOutReleasePerformed = true; }, 'claims HELD_OUT release');
  reject(r => { r.authority.trainingOccurred = true; }, 'claims training');
  reject(r => { r.authority.sourceBundleGatePassedForRepairedCandidates = false; },
    'denies the gate it records');

  assert.doesNotThrow(() => build());
});

test('the HUMAN packet holds exactly 12 blind rows and nothing else', () => {
  const packet = build();
  assert.equal(packet.name, humanBuilder.PACKET_IDENTITY);
  assert.equal(packet.status, 'BLIND_PRIMARY_HUMAN_REVIEW_PACKET_NOT_RUN');
  assert.equal(packet.rows.length, 12);
  assert.equal(packet.sourceAuditPrerequisite.attemptId, humanBuilder.AUDIT_ATTEMPT_ID);
  assert.equal(packet.sourceAuditPrerequisite.allRowsPassed, true);

  for (const row of packet.rows) {
    assert.deepEqual(Object.keys(row).toSorted(), ['reviewRowId', 'selectedBundle']);
    assert.equal(typeof row.selectedBundle, 'string');
    assert.equal(row.selectedBundle.length > 0, true);
  }

  // Deterministic, and sorted by opaque review ID as the primary-HUMAN convention requires.
  assert.deepEqual(humanBuilder.packetBytes(build()), humanBuilder.packetBytes(packet));
  assert.deepEqual(packet.rows.map(row => row.reviewRowId),
    packet.rows.map(row => row.reviewRowId).toSorted());
});

test('the HUMAN packet leaks no identity, semantics, audit reason, or expected answer', () => {
  const packet = build();
  const serialized = JSON.stringify(packet);
  const candidate = readJson(CANDIDATE);
  const resolution = readJson(candidateBuilder.RECEIPT_FILE);
  const auditReceipt = receipt();

  assert.equal(serialized.includes('p1b6-item-'), false);
  assert.equal(serialized.includes('p1b6-sk-'), false);
  assert.equal(serialized.includes('p1b6-se-'), false);
  assert.equal(serialized.includes('p1b6-sf-'), false);
  assert.equal(serialized.includes('p1b6-surface-family-'), false);
  assert.equal(serialized.includes(REJECTED), false);
  for (const item of candidate.items) {
    for (const value of [item.itemId, item.semanticSkeletonId, item.sourceEpisodeId,
      item.surfaceFamilyId]) {
      assert.equal(serialized.includes(value), false, value);
    }
  }

  // No split, boundary class, discourse pattern, or label vocabulary.
  for (const token of ['TRAIN', 'DEV', 'FINAL_HELD_OUT', 'SCOPE / APPLICABILITY',
    'COMPLEMENTARY EVIDENCE', 'REVISION / CONFLICT', 'FINALITY / COMMITMENT', 'PERSISTENCE',
    'humanLabel', 'CLEAR', 'ESCALATE', 'KEEP', 'splitAssignment', 'boundaryClass',
    'discoursePattern', 'anchorText', 'anchorSpanRef', 'evidenceSpanRefs',
    'historicalDiscoursePattern']) {
    assert.equal(serialized.includes(token), false, token);
  }
  for (const pattern of surfaces.DISCOURSE_PATTERNS) {
    assert.equal(serialized.includes(pattern), false, pattern);
  }

  // No source-audit reason or per-row audit signal may prime the semantic reviewer. The
  // uniform top-level gate status is provenance, not a per-row signal, so it stays.
  for (const row of auditReceipt.rows) {
    assert.equal(serialized.includes(row.reason), false, 'audit reason');
    assert.equal(serialized.includes(row.auditRowId), false, 'audit row id');
  }
  assert.equal(serialized.includes('reason'), false);
  assert.equal(serialized.includes('disposition'), false);
  for (const row of packet.rows) {
    assert.equal(JSON.stringify(row).includes('PASS'), false, 'per-row audit disposition');
  }

  // No repair rationale, intended reading, routing, or REPAIR/REJECT metadata.
  for (const row of resolution.decisions) {
    if (row.decision !== 'REPAIR') continue;
    assert.equal(serialized.includes(row.repairRationale), false, `${row.itemId} rationale`);
    for (const reading of row.intendedUnresolvedReadings) {
      assert.equal(serialized.includes(reading), false, `${row.itemId} reading`);
    }
  }
  for (const token of ['REPAIR', 'REJECT', 'SURFACE_COLLAPSES_AMBIGUITY',
    'SKELETON_SEMANTICS_NEEDS_REVISION', 'CONSERVATIVE_PRAGMATIC_INTERPRETATION',
    'mismatch', 'rejectedItemIds', 'expectedAnswer']) {
    assert.equal(serialized.includes(token), false, token);
  }

  // The rejected realization's text never appears, and no full source episode is exposed.
  const rejectedEpisode = readJson(BATCH_002).sourceEpisodes
    .find(row => row.sourceEpisodeId === 'p1b6-se-b002-050');
  for (const turn of rejectedEpisode.turns) {
    assert.equal(serialized.includes(turn.text), false, 'rejected source text');
  }
  assert.equal(serialized.includes('sourceEpisode'), false);
  const interruption = candidate.sourceEpisodes
    .find(row => row.sourceEpisodeId === 'p1b6-se-b002-049').turns[1];
  assert.equal(serialized.includes(interruption.text), false, 'non-evidence turn text');
});

test('each HUMAN selectedBundle is byte-identical to the audited bundle for the same row', () => {
  const inputs = auditPacketBuilder.loadCanonicalInputs();
  const auditPacket = auditPacketBuilder.buildRepairSourceAuditPacket(inputs);
  const candidate = readJson(CANDIDATE);
  const candidateSha = auditPacketBuilder.CANONICAL_INPUTS.repairCandidate.rawSha256;
  const packet = build();
  const byReviewId = new Map(packet.rows.map(row => [row.reviewRowId, row.selectedBundle]));
  const auditedByAuditId = new Map(auditPacket.rows.map(row => [row.auditRowId, row.selectedBundle]));

  assert.equal(byReviewId.size, 12);
  for (const item of candidate.items) {
    const reviewRowId = humanBuilder.opaqueReviewRowId(candidateSha, item.itemId);
    const auditRowId = auditPacketBuilder.opaqueAuditRowId(candidateSha, item.itemId);
    assert.equal(byReviewId.get(reviewRowId), auditedByAuditId.get(auditRowId), item.itemId);
  }
});

test('opaque review IDs are deterministic, unique, and never reuse a historical review ID', () => {
  const candidateSha = auditPacketBuilder.CANONICAL_INPUTS.repairCandidate.rawSha256;
  const candidate = readJson(CANDIDATE);
  const ids = candidate.items.map(item => humanBuilder.opaqueReviewRowId(candidateSha, item.itemId));

  assert.equal(new Set(ids).size, 12);
  assert.deepEqual(ids, candidate.items
    .map(item => humanBuilder.opaqueReviewRowId(candidateSha, item.itemId)));
  assert.equal(ids.every(id => id.startsWith(`${humanBuilder.REVIEW_ID_NAMESPACE}-`)), true);
  assert.equal(ids.some(id => id.startsWith('p1b6-review-')), false);

  // Candidate byte drift moves the whole namespace.
  const drifted = candidate.items
    .map(item => humanBuilder.opaqueReviewRowId(`${candidateSha.slice(0, -1)}0`, item.itemId));
  assert.equal(ids.some(id => drifted.includes(id)), false);

  // Disjoint from the historical primary-HUMAN review namespace, by construction and by value.
  const historicalBatchSha = sha256RawBytes(read(BATCH_002));
  for (const item of candidate.items) {
    assert.notEqual(humanBuilder.opaqueReviewRowId(candidateSha, item.itemId),
      historicalHuman.opaqueReviewRowId(historicalBatchSha, item.itemId), item.itemId);
  }
  const committedHistoricalIds = new Set([
    'local-memory-inference-p1b6-primary-human-review-batch-002-attempt-001.json',
    'local-memory-inference-p1b6-primary-human-rereview-batch-002-attempt-002.json',
    'local-memory-inference-p1b6-primary-human-rereview-batch-002-attempt-003.json',
    'local-memory-inference-p1b6-primary-human-review-batch-001-attempt-001.json',
  ].flatMap(file => readJson(file).rows.map(row => row.reviewRowId)));
  assert.equal(committedHistoricalIds.size > 0, true);
  assert.equal(ids.some(id => committedHistoricalIds.has(id)), false);
});

test('the packet is written deterministically and never silently overwritten', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b6-repair-human-'));
  const outputPath = path.join(dir, 'packet.json');
  try {
    const first = humanBuilder.writeRepairHumanReviewPacket(outputPath);
    const bytes = fs.readFileSync(outputPath);
    assert.equal(sha256RawBytes(bytes), first.rawSha256);
    assert.deepEqual(JSON.parse(bytes.toString('utf8')), build());

    assert.throws(() => humanBuilder.writeRepairHumanReviewPacket(outputPath),
      /will not be overwritten/);
    assert.equal(humanBuilder.writeRepairHumanReviewPacket(path.join(dir, 'again.json')).rawSha256,
      first.rawSha256);

    assert.throws(() => humanBuilder.parseArgs([]), /Usage/);
    assert.throws(() => humanBuilder.parseArgs(['--output']), /Usage/);
    assert.deepEqual(humanBuilder.parseArgs(['--output', 'p.json']), { outputPath: 'p.json' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('no HUMAN decision is synthesized and historical contracts are untouched', () => {
  // The builder embeds no semantic label vocabulary at all, so it cannot hold an expected
  // answer or an authoritative decision map for the blind review.
  const source = fs.readFileSync(path.join(ROOT,
    'scripts/build-memory-inference-p1b6-surface-repair-human-review-packet.js'), 'utf8');
  const code = source.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  for (const token of ['CLEAR', 'ESCALATE', 'decisionMap', 'expectedAnswer', 'expectedLabel']) {
    assert.equal(code.includes(token), false, token);
  }
  const packet = build();
  for (const row of packet.rows) {
    assert.equal(Object.hasOwn(row, 'disposition'), false);
    assert.equal(Object.hasOwn(row, 'decision'), false);
  }

  for (const [file, sha] of Object.entries(UNCHANGED)) {
    assert.equal(sha256RawBytes(fs.readFileSync(path.join(ROOT, file))), sha, file);
  }

  // The historical validator still refuses the repair candidate's shape.
  assert.throws(() => surfaces.validateSurfaceBatch(readJson(CANDIDATE)),
    /top-level keys mismatch/);

  assert.equal(require('../package.json')
    .scripts['build:memory-inference-p1b6-surface-repair-human-review-packet'],
  'node scripts/build-memory-inference-p1b6-surface-repair-human-review-packet.js');
});
