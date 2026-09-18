'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const surfaces = require('../lib/memory-inference-p1b6-surfaces');
const historicalAudit = require('../scripts/build-memory-inference-p1b6-source-audit-packet');
const candidateBuilder = require('../scripts/build-memory-inference-p1b6-surface-repair-candidate');
const packetBuilder =
  require('../scripts/build-memory-inference-p1b6-surface-repair-source-audit-packet');

const ROOT = path.resolve(__dirname, '..');
const fixture = file => path.join(ROOT, 'fixtures', file);
const read = file => fs.readFileSync(fixture(file));
const readJson = file => JSON.parse(read(file));

const CANDIDATE = candidateBuilder.CANDIDATE_FILE;
const EFFECTIVE_CATALOG = 'local-memory-inference-p1b6-skeleton-effective-current.json';
const BATCH_002 = 'local-memory-inference-p1b6-surface-batch-002.json';
const REJECTED = 'p1b6-item-b002-050';

// The shared historical surface library must stay byte-identical: this gate reuses it, it does
// not broaden it.
const SURFACES_LIB_SHA256 = '4b6dabf2280529b138efe124f32252c2ff7a2b9a118d7eb2c2b3341c7c56f1b7';

const canonicalInputs = () => packetBuilder.loadCanonicalInputs();
const build = (inputs = canonicalInputs()) => packetBuilder.buildRepairSourceAuditPacket(inputs);
const artifactBytes = candidateBuilder.artifactBytes;

test('canonical inputs build a deterministic blind 12-row packet', () => {
  const packet = build();
  assert.equal(packet.name, packetBuilder.PACKET_IDENTITY);
  assert.equal(packet.status, 'BLIND_SOURCE_AUDIT_PACKET_NOT_RUN');
  assert.equal(packet.rows.length, 12);
  assert.equal(packet.repairCandidate.rawSha256,
    packetBuilder.CANONICAL_INPUTS.repairCandidate.rawSha256);
  assert.equal(packet.sourceAuditProtocol.identity, packetBuilder.PROTOCOL_IDENTITY);
  assert.equal(packet.sourceAuditProtocol.rawSha256,
    packetBuilder.CANONICAL_INPUTS.sourceAuditProtocol.rawSha256);
  assert.equal(packet.rendererIdentity, surfaces.RENDERER_IDENTITY);

  // Deterministic: same bytes in, same bytes out.
  assert.deepEqual(artifactBytes(build()), artifactBytes(packet));

  // Rows follow candidate order.
  const candidate = readJson(CANDIDATE);
  assert.deepEqual(packet.rows.map(row => row.auditRowId), candidate.items
    .map(item => packetBuilder.opaqueAuditRowId(
      packetBuilder.CANONICAL_INPUTS.repairCandidate.rawSha256, item.itemId)));

  // No audit decision was synthesized anywhere in the packet.
  const serialized = JSON.stringify(packet);
  for (const token of ['PASS', 'FAIL', 'UNCERTAIN', 'disposition']) {
    assert.equal(serialized.includes(token), false, token);
  }
});

test('the packet is blind: no identity, semantics, or gold metadata leaks', () => {
  const packet = build();
  const candidate = readJson(CANDIDATE);
  const receipt = readJson(candidateBuilder.RECEIPT_FILE);
  const serialized = JSON.stringify(packet);

  // Rows expose exactly three fields.
  for (const row of packet.rows) {
    assert.deepEqual(Object.keys(row).toSorted(),
      ['auditRowId', 'selectedBundle', 'sourceEpisode']);
    assert.deepEqual(Object.keys(row.sourceEpisode), ['turns']);
    for (const turn of row.sourceEpisode.turns) {
      assert.deepEqual(Object.keys(turn).toSorted(), ['role', 'text', 'turnId']);
    }
  }

  // No item ID, episode ID, family ID, or skeleton ID anywhere.
  assert.equal(serialized.includes('p1b6-item-'), false);
  assert.equal(serialized.includes('p1b6-sk-'), false);
  assert.equal(serialized.includes('p1b6-se-'), false);
  assert.equal(serialized.includes(REJECTED), false);
  for (const item of candidate.items) {
    assert.equal(serialized.includes(item.itemId), false, item.itemId);
    assert.equal(serialized.includes(item.semanticSkeletonId), false, item.semanticSkeletonId);
    assert.equal(serialized.includes(item.sourceEpisodeId), false, item.sourceEpisodeId);
    assert.equal(serialized.includes(item.surfaceFamilyId), false, item.surfaceFamilyId);
  }

  // No split, boundary class, discourse pattern, or HUMAN/skeleton label vocabulary.
  for (const token of ['TRAIN', 'DEV', 'FINAL_HELD_OUT', 'SCOPE / APPLICABILITY',
    'COMPLEMENTARY EVIDENCE', 'REVISION / CONFLICT', 'FINALITY / COMMITMENT',
    'humanLabel', 'CLEAR', 'ESCALATE', 'KEEP', 'splitAssignment', 'boundaryClass',
    'discoursePattern', 'anchorText', 'anchorSpanRef', 'evidenceSpanRefs']) {
    assert.equal(serialized.includes(token), false, token);
  }
  for (const pattern of surfaces.DISCOURSE_PATTERNS) {
    assert.equal(serialized.includes(pattern), false, pattern);
  }

  // No repair rationale, intended readings, or adjudication routing.
  for (const row of receipt.decisions) {
    if (row.decision !== 'REPAIR') continue;
    assert.equal(serialized.includes(row.repairRationale), false, `${row.itemId} rationale`);
    for (const reading of row.intendedUnresolvedReadings) {
      assert.equal(serialized.includes(reading), false, `${row.itemId} reading`);
    }
  }
  for (const token of ['SURFACE_COLLAPSES_AMBIGUITY', 'SKELETON_SEMANTICS_NEEDS_REVISION',
    'REPAIR', 'REJECT', 'rejectedItemIds', 'CONSERVATIVE_PRAGMATIC_INTERPRETATION']) {
    assert.equal(serialized.includes(token), false, token);
  }

  // The rejected realization's source text never appears.
  const rejectedEpisode = readJson(BATCH_002).sourceEpisodes
    .find(row => row.sourceEpisodeId === 'p1b6-se-b002-050');
  for (const turn of rejectedEpisode.turns) {
    assert.equal(serialized.includes(turn.text), false, 'rejected source text');
  }
});

test('every row carries the complete repaired episode and exactly one TARGET pair', () => {
  const packet = build();
  const candidate = readJson(CANDIDATE);
  const episodes = new Map(candidate.sourceEpisodes.map(row => [row.sourceEpisodeId, row]));

  packet.rows.forEach((row, index) => {
    const item = candidate.items[index];
    const episode = episodes.get(item.sourceEpisodeId);

    // Complete episode, including the unrelated interruption turns that are not evidence.
    assert.deepEqual(row.sourceEpisode.turns, episode.turns);
    const evidenceTurnIds = new Set(item.evidenceSpanRefs.map(span => span.turnId));
    if (episode.turns.length > evidenceTurnIds.size) {
      assert.equal(episode.turns.some(turn => !evidenceTurnIds.has(turn.turnId)), true,
        'non-evidence turns are still delivered to the auditor');
    }

    // Exactly one TARGET pair, in that order, and the marked text is source-grounded.
    assert.equal(row.selectedBundle.split('[TARGET]').length - 1, 1);
    assert.equal(row.selectedBundle.split('[/TARGET]').length - 1, 1);
    assert.equal(row.selectedBundle.indexOf('[TARGET]')
      < row.selectedBundle.indexOf('[/TARGET]'), true);
    const marked = row.selectedBundle.slice(
      row.selectedBundle.indexOf('[TARGET]') + '[TARGET]'.length,
      row.selectedBundle.indexOf('[/TARGET]'));
    assert.equal(marked, item.anchorText);

    // The bundle carries exactly the selected evidence, in source order, with role prefixes.
    const turns = new Map(episode.turns.map(turn => [turn.turnId, turn]));
    const stripped = row.selectedBundle.replaceAll('[TARGET]', '').replaceAll('[/TARGET]', '');
    assert.deepEqual(stripped.split(/\n(?:---\n)?/u), item.evidenceSpanRefs.map(span =>
      `${turns.get(span.turnId).role}: ${Buffer.from(turns.get(span.turnId).text, 'utf8')
        .subarray(span.startByte, span.endByte).toString('utf8')}`));
  });
});

test('the candidate renderer matches the canonical historical renderer', () => {
  // A test-only in-memory projection into the historical four-key surface-batch shape. It is
  // never written out and never becomes a real surface batch; it exists only to run the
  // canonical renderer over the same rows.
  const candidate = readJson(CANDIDATE);
  const projection = {
    name: 'xion-local-memory-inference-p1b6-surface-batch-002-v1',
    batchId: 'p1b6-surface-batch-002',
    sourceEpisodes: candidate.sourceEpisodes,
    items: candidate.items.map(({ anchorText, historicalDiscoursePattern, ...item }) => item),
  };
  assert.doesNotThrow(() => surfaces.validateSurfaceBatch(projection));

  const packet = build();
  projection.items.forEach((item, index) => {
    assert.equal(packet.rows[index].selectedBundle,
      surfaces.renderVisibleItem(projection, item), item.itemId);
  });
});

test('opaque audit IDs are deterministic, item-derived, and disjoint from the historical set', () => {
  const candidateSha = packetBuilder.CANONICAL_INPUTS.repairCandidate.rawSha256;
  const candidate = readJson(CANDIDATE);
  const ids = candidate.items.map(item => packetBuilder.opaqueAuditRowId(candidateSha, item.itemId));

  assert.equal(new Set(ids).size, 12);
  assert.deepEqual(ids, candidate.items
    .map(item => packetBuilder.opaqueAuditRowId(candidateSha, item.itemId)));
  assert.equal(ids.every(id => id.startsWith(`${packetBuilder.AUDIT_ID_NAMESPACE}-`)), true);

  // Any candidate byte change moves the whole identity namespace.
  const drifted = candidate.items
    .map(item => packetBuilder.opaqueAuditRowId(`${candidateSha.slice(0, -1)}0`, item.itemId));
  assert.equal(ids.some(id => drifted.includes(id)), false);

  // Disjoint from the historical batch-002 audit namespace, both by prefix and by value.
  const historicalIds = new Set(historicalAudit
    .buildAuditPacket(read(BATCH_002)).rows.map(row => row.auditRowId));
  assert.equal(historicalIds.size, 64);
  assert.equal(ids.some(id => historicalIds.has(id)), false);
  assert.equal([...historicalIds].every(id => id.startsWith('p1b6-audit-')), true);
  assert.equal(ids.some(id => id.startsWith('p1b6-audit-')), false);

  // Historical IDs for the same underlying items are not reused.
  for (const item of candidate.items) {
    assert.notEqual(packetBuilder.opaqueAuditRowId(candidateSha, item.itemId),
      historicalAudit.opaqueAuditRowId(
        sha256RawBytes(read(BATCH_002)), item.itemId), item.itemId);
  }
});

test('every canonical input fails closed on identity, raw-byte, or coordinated drift', () => {
  for (const key of Object.keys(packetBuilder.CANONICAL_INPUTS)) {
    const identityDrift = canonicalInputs();
    const renamed = JSON.parse(identityDrift[key].toString('utf8'));
    renamed.name = 'xion-local-memory-inference-p1b6-not-the-canonical-artifact-v1';
    identityDrift[key] = artifactBytes(renamed);
    assert.throws(() => build(identityDrift),
      /bytes are not the canonical evidence|identity is not canonical/, `${key} identity`);

    const byteDrift = canonicalInputs();
    const marked = JSON.parse(byteDrift[key].toString('utf8'));
    marked.driftMarker = true;
    byteDrift[key] = artifactBytes(marked);
    assert.throws(() => build(byteDrift), /bytes are not the canonical evidence/, `${key} bytes`);

    const missing = canonicalInputs();
    delete missing[key];
    assert.throws(() => build(missing), /bytes were not supplied/, `${key} missing`);
  }

  // Coordinated drift: the candidate changes AND its provenance is rewritten to match, plus the
  // resolution receipt is rewritten to carry the new candidate identity.
  const coordinated = canonicalInputs();
  const candidate = readJson(CANDIDATE);
  candidate.sourceEpisodes[0].turns[0].text = `${candidate.sourceEpisodes[0].turns[0].text} `;
  const driftedCandidateBytes = artifactBytes(candidate);
  const receipt = readJson(candidateBuilder.RECEIPT_FILE);
  receipt.repairCandidateArtifact.rawSha256 = sha256RawBytes(driftedCandidateBytes);
  coordinated.repairCandidate = driftedCandidateBytes;
  coordinated.resolutionReceipt = artifactBytes(receipt);
  assert.throws(() => build(coordinated), /bytes are not the canonical evidence/, 'coordinated');

  assert.throws(() => packetBuilder.buildRepairSourceAuditPacket(undefined),
    /were not supplied/);
  assert.doesNotThrow(() => build());
});

test('a drifted row set and stale span offsets both fail closed', () => {
  const candidate = readJson(CANDIDATE);
  const mutate = (change, label) => {
    const inputs = canonicalInputs();
    const drifted = structuredClone(candidate);
    change(drifted);
    inputs.repairCandidate = artifactBytes(drifted);
    assert.throws(() => build(inputs), /P1-B6/, label);
  };
  mutate(c => { c.items.pop(); }, 'missing repaired row');
  mutate(c => { c.items.push(structuredClone(c.items[0])); }, 'duplicate repaired row');
  mutate(c => {
    const extra = structuredClone(c.items[0]);
    extra.itemId = 'p1b6-item-b002-001';
    c.items.push(extra);
  }, 'extra unauthorized row');
  mutate(c => { c.items[0].anchorSpanRef.endByte += 1; }, 'stale anchor offsets');

  // Stale offsets are refused by the candidate validator the packet builder runs, so a
  // hypothetically correctly hashed candidate could still never be rendered.
  const stale = structuredClone(candidate);
  const historicalAnchor = readJson(BATCH_002).items
    .find(row => row.itemId === stale.items[0].itemId).anchorSpanRef;
  stale.items[0].anchorSpanRef = historicalAnchor;
  assert.throws(() => candidateBuilder.validateRepairCandidateBatch(
    stale, { effectiveCatalog: readJson(EFFECTIVE_CATALOG) }), /P1-B6 surface/);
});

test('the protocol stays authoritative and its gate is verified, not amended', () => {
  const protocol = readJson('local-memory-inference-p1b6-source-audit-protocol.json');
  assert.equal(sha256RawBytes(read('local-memory-inference-p1b6-source-audit-protocol.json')),
    packetBuilder.CANONICAL_INPUTS.sourceAuditProtocol.rawSha256);
  assert.equal(protocol.status, 'PREREGISTERED_NOT_RUN');
  assert.deepEqual(protocol.reviewGate,
    { eligibleForHumanSemanticReview: ['PASS'], failClosed: ['FAIL', 'UNCERTAIN'] });
  assert.deepEqual(protocol.outputContract.dispositionEnum, ['PASS', 'FAIL', 'UNCERTAIN']);

  const reject = (change, label) => {
    const drifted = structuredClone(protocol);
    change(drifted);
    assert.throws(() => packetBuilder.verifyProtocol(artifactBytes(drifted)), /P1-B6/, label);
  };
  reject(p => { p.protocolIdentity = 'p1b6-source-bundle-completeness-audit-v2'; }, 'identity');
  reject(p => { p.reviewGate.eligibleForHumanSemanticReview.push('UNCERTAIN'); }, 'widened gate');
  reject(p => { p.reviewGate.failClosed = []; }, 'fail-open gate');
  reject(p => { p.outputContract.dispositionEnum.push('CLEAR'); }, 'semantic disposition');
});

test('the shared historical surface library and its validator are untouched', () => {
  assert.equal(
    sha256RawBytes(fs.readFileSync(path.join(ROOT, 'lib/memory-inference-p1b6-surfaces.js'))),
    SURFACES_LIB_SHA256);

  // The candidate is still refused by the historical four-key validator, unprojected.
  assert.throws(() => surfaces.validateSurfaceBatch(readJson(CANDIDATE)),
    /top-level keys mismatch/);

  // The new builder is registered the same way the historical packet builder is.
  assert.equal(require('../package.json')
    .scripts['build:memory-inference-p1b6-surface-repair-source-audit-packet'],
  'node scripts/build-memory-inference-p1b6-surface-repair-source-audit-packet.js');
});

test('the packet is written deterministically and never silently overwritten', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b6-repair-audit-'));
  const outputPath = path.join(dir, 'packet.json');
  try {
    const first = packetBuilder.writeRepairSourceAuditPacket(outputPath);
    const bytes = fs.readFileSync(outputPath);
    assert.equal(sha256RawBytes(bytes), first.rawSha256);
    assert.deepEqual(JSON.parse(bytes.toString('utf8')), build());

    assert.throws(() => packetBuilder.writeRepairSourceAuditPacket(outputPath),
      /will not be overwritten/);

    const second = path.join(dir, 'packet-again.json');
    assert.equal(packetBuilder.writeRepairSourceAuditPacket(second).rawSha256, first.rawSha256);

    assert.throws(() => packetBuilder.parseArgs([]), /Usage/);
    assert.throws(() => packetBuilder.parseArgs(['--output']), /Usage/);
    assert.throws(() => packetBuilder.parseArgs(['--input', 'x', '--output', 'y']), /Usage/);
    assert.deepEqual(packetBuilder.parseArgs(['--output', 'p.json']), { outputPath: 'p.json' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
