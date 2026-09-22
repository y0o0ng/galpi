'use strict';

// Batch-003 combined blind HUMAN packet: 34 mandatory routes + 32 calibration rows.
//
// No HUMAN result exists. These tests pin the derivation, the blindness of the packet and the
// preregistered result semantics. The raw strong-model result bytes are not committed, so
// the pure logic is exercised through `combined.unauthorized` with results rebuilt from the
// committed reconciliation. Those populations are never admitted by the production gate; only
// the exact raw bytes are, checked when P1B6_B003_SM_RESULTS points at them.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { renderHumanReviewText } = require('../lib/memory-inference-p1b6-surfaces');
const strongModel = require('../scripts/build-memory-inference-p1b6-batch-003-strong-model-review-packet');
const humanPacket = require('../scripts/build-memory-inference-p1b6-human-review-packet');
const combined = require('../scripts/build-memory-inference-p1b6-batch-003-human-adjudication-calibration-packet');

const pure = combined.unauthorized;

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file));
const readJson = file => JSON.parse(read(file));

const BATCH = 'fixtures/local-memory-inference-p1b6-surface-batch-003.json';
const AUDIT = 'fixtures/local-memory-inference-p1b6-source-audit-batch-003-attempt-001.json';
const RECONCILIATION =
  'fixtures/local-memory-inference-p1b6-strong-model-semantic-review-batch-003-attempt-001.json';
const CATALOG = 'fixtures/local-memory-inference-p1b6-skeleton-effective-current-v2.json';
const FAILED = strongModel.EXPECTED_FAILED_ITEM_IDS;
const RAW_RESULTS = process.env.P1B6_B003_SM_RESULTS;
const PACKET_SHA256 = '4750a467b521975f60f6bf5fd776ff6cfd80ad5be1efa04a485e389532988ed0';

const UNCHANGED = Object.freeze({
  [BATCH]: '90b453c3680bccaa537fd0d23db74bbc303882e1a35a2ddcea0b75b013fcaa68',
  [AUDIT]: '3c840476bea6eccb522800248a3ace277b26a5334ec56b5f6b10bbf4d5821221',
  [RECONCILIATION]: '9b65327a4ce6d1923391253659c1acc3bb373bb54acdc7872e3ce74d52337074',
  [CATALOG]: 'f1e780195441246402ca389da188b1f7b8c4970f42fc1e6e3de2f436a3e9377c',
  'fixtures/local-memory-inference-p1b6-skeleton-effective-current.json':
    '48490b6e4e1494856ef3268d944da16093c4735d207e07c1fd9e8bbf69df2559',
  'fixtures/local-memory-inference-p1b6-skeleton-exact56.json':
    '772f07bd679a9c98ea65feaa164ec7a9c1f3e3fb33632052ef076f8301999602',
  'fixtures/local-memory-inference-p1b6-skeleton-semantic-contract-v2-receipt.json':
    'a12063c38eee6245122e655126708c904319b4a7467cf82084acdea17a293344',
  'fixtures/local-memory-inference-p1b6-large-batch-review-authority-amendment.json':
    '821b0cb07580b4c2ac776014d88c78333263900759ca94d1746b4934964ffc0e',
  'fixtures/local-memory-inference-p1b6-strong-model-semantic-review-protocol.json':
    '2f97028fe5bb9612a0750140754136785f99d07f93f7924c697a5b67990c16c4',
  'fixtures/local-memory-inference-p1b6-surface-batch-003-authoring-protocol.json':
    '33c39777583009aaaa570718ae26741b6a2562e2006d4a4e428c60d47bdcc447',
  'scripts/build-memory-inference-p1b6-human-review-packet.js':
    '74db840d5be654446c619cbbb8b7c0e00f70ef491cc5969a3c150275b2c4c12c',
  'scripts/build-memory-inference-p1b6-batch-003-strong-model-review-packet.js':
    'e429b59e5eb53b60c97dfe7e941250646e9d4b6cb9f0e6fa666a087cdc02fd0f',
  'fixtures/local-memory-inference-p1b6-primary-human-review-batch-001-attempt-001.json':
    '816a24aec8ca429fad3582dfd972bffb6437c9d41d7ddebd393674fb48d4d8e2',
});
const HISTORICAL_BATCH_001_002 = [
  'fixtures/local-memory-inference-p1b6-smoke-batch-001-acceptance.json',
  'fixtures/local-memory-inference-p1b6-batch-002-acceptance.json',
  'fixtures/local-memory-inference-p1b6-primary-human-accepted-current-batch-002.json',
  'fixtures/local-memory-inference-p1b6-primary-human-review-batch-002-attempt-001.json',
  'fixtures/local-memory-inference-p1b6-skeleton-semantic-amendment-receipt.json',
  'fixtures/local-memory-inference-p1b6-surface-batch-003-materialization-receipt.json',
];

// Results rebuilt from the committed reconciliation: agreement everywhere except the committed
// routed rows, which disagree. This is test input, not a stand-in for the raw artifact.
function rebuiltResults() {
  const { references } = strongModel.buildCanonicalReviewReferences(read(BATCH), readJson(AUDIT));
  const routed = new Set(readJson(RECONCILIATION).routedItemIds);
  return references.map(row => ({
    reviewRowId: row.reviewRowId,
    disposition: 'KEEP',
    decision: routed.has(row.itemId)
      ? (row.referenceLabel === 'CLEAR' ? 'ESCALATE' : 'CLEAR') : row.referenceLabel,
    reason: 'rebuilt test row',
  }));
}

let cached;
function populations() {
  cached ??= pure.computePopulations(read(BATCH), readJson(AUDIT), rebuiltResults());
  return cached;
}

const bytes = value => Buffer.from(JSON.stringify(value), 'utf8');
const answer = (row, disposition, decision) => ({
  reviewRowId: row.reviewRowId, disposition, decision, reason: 'short reason',
});
const opposite = label => (label === 'CLEAR' ? 'ESCALATE' : 'CLEAR');
const allMatching = pops => pops.rows.map(row => answer(row, 'KEEP', row.referenceLabel));

test('the protocol is a blind HUMAN protocol bound to v2 and the exact strong-model bytes', () => {
  const { protocol } = combined.loadProtocol();
  assert.equal(protocol.protocolIdentity, combined.PROTOCOL_IDENTITY);
  assert.equal(protocol.status, 'PREREGISTERED_NOT_RUN');
  assert.equal(protocol.semanticAuthority.rawSha256, strongModel.CATALOG_SHA256);
  assert.equal(protocol.strongModelReconciliation.rawResultSha256,
    combined.STRONG_MODEL_RESULT_SHA256);
  assert.equal(readJson(RECONCILIATION).rawResultArtifact.sha256,
    combined.STRONG_MODEL_RESULT_SHA256);
  assert.deepEqual(protocol.population,
    { ...protocol.population, rows: 66, mandatoryRouted: 34, calibration: 32 });
  for (const blind of ['row role', 'routing reason', 'strong-model decision', 'reference label',
    'item ID', 'semanticSkeletonId', 'boundary class', 'split', 'calibration stratum']) {
    assert.equal(protocol.blindFields.some(field => field.includes(blind)), true, blind);
  }
  for (const phrase of ['naturally dominant', 'naturally and positively licenses',
    'Unknown is not ambiguity', 'effective-time rule', 'new premise']) {
    assert.equal(protocol.question.includes(phrase), true, phrase);
  }
  assert.deepEqual(protocol.outputContract.required,
    ['reviewRowId', 'disposition', 'decision', 'reason']);
  assert.equal(protocol.calibrationSemantics.promotesProvenance, false);
  assert.equal(protocol.calibrationSemantics.extrapolatedToUnreviewedRows, false);
  assert.equal(JSON.stringify(protocol).includes('p1b6-item-b003-'), false);
});

test('only the exact raw strong-model bytes can drive the derivation', () => {
  const receipt = readJson(RECONCILIATION);
  const reject = (value, pattern) => assert.throws(
    () => combined.derivePopulations(read(BATCH), readJson(AUDIT), value), pattern);
  // The committed summary, the whole receipt, parsed results and re-serialized results all fail.
  reject(bytes(receipt.rawResultSummary), /not the reconciled raw artifact/);
  reject(read(RECONCILIATION), /not the reconciled raw artifact/);
  reject({ results: rebuiltResults() }, /must be the raw result artifact bytes/);
  reject(bytes({ results: rebuiltResults() }), /not the reconciled raw artifact/);
  assert.throws(() => combined.buildHumanPacket(read(BATCH), readJson(AUDIT),
    bytes(receipt.rawResultSummary)), /not the reconciled raw artifact/);
});

test('derived populations are 34 routed + 32 calibration, disjoint, with no audit FAIL row', () => {
  const pops = populations();
  const receipt = readJson(RECONCILIATION);
  const routed = pops.rows.filter(row => row.role === combined.ROLE.ROUTED);
  const calibration = pops.rows.filter(row => row.role === combined.ROLE.CALIBRATION);

  assert.equal(pops.rows.length, 66);
  assert.equal(routed.length, 34);
  assert.equal(calibration.length, 32);
  assert.deepEqual(routed.map(row => row.itemId).sort(), [...receipt.routedItemIds].sort());

  // Calibration is the existing canonical selector over the reconciled agreements.
  const reconciled = strongModel.reconcileBatch003(read(BATCH), readJson(AUDIT), rebuiltResults());
  assert.equal(reconciled.agreements.length, 267);
  assert.equal(reconciled.humanAdjudication.length, 34);
  assert.deepEqual(calibration.map(row => row.itemId).sort(),
    strongModel.selectCalibrationSample(reconciled.agreements).map(row => row.itemId));

  const ids = new Set(pops.rows.map(row => row.itemId));
  assert.equal(ids.size, 66);
  for (const failed of FAILED) assert.equal(ids.has(failed), false, failed);

  assert.equal(pops.unreviewedAgreements.length, 235);
  for (const row of pops.unreviewedAgreements) {
    assert.equal(ids.has(row.itemId), false);
    assert.equal(row.provenance, 'CATALOG_STRONG_MODEL_CONFIRMED');
    assert.equal(row.eligibility, 'PROVISIONAL');
  }
});

test('results that do not reproduce the committed reconciliation fail closed', () => {
  const flipped = rebuiltResults();
  const routed = new Set(readJson(RECONCILIATION).routedItemIds);
  const { references } = strongModel.buildCanonicalReviewReferences(read(BATCH), readJson(AUDIT));
  const agreementRow = references.find(row => !routed.has(row.itemId));
  const target = flipped.find(row => row.reviewRowId === agreementRow.reviewRowId);
  target.decision = opposite(target.decision);
  assert.throws(() => pure.computePopulations(read(BATCH), readJson(AUDIT),
    flipped), /not 267 agreements \/ 34 routes/);

  // Same counts, different routed rows: swap one routed and one agreeing row.
  const swapped = rebuiltResults();
  const routedRow = references.find(row => routed.has(row.itemId));
  for (const ref of [agreementRow, routedRow]) {
    const row = swapped.find(entry => entry.reviewRowId === ref.reviewRowId);
    row.decision = opposite(row.decision);
  }
  assert.throws(() => pure.computePopulations(read(BATCH), readJson(AUDIT),
    swapped), /do not match the committed reconciliation/);
});

test('the packet shows only an opaque row ID and the canonical selected bundle', () => {
  const pops = populations();
  const rows = pure.packetRows(pops);
  const batch = readJson(BATCH);
  const items = new Map(batch.items.map(item => [item.itemId, item]));

  assert.equal(rows.length, 66);
  rows.forEach((row, index) => {
    assert.deepEqual(Object.keys(row), ['reviewRowId', 'selectedBundle']);
    assert.equal(row.selectedBundle, renderHumanReviewText(batch, items.get(pops.rows[index].itemId)));
  });

  // No row's role, answer or origin appears anywhere in the rows.
  const text = JSON.stringify(rows);
  const catalog = readJson(CATALOG);
  const leaks = [
    'MANDATORY_ADJUDICATION', 'CALIBRATION', 'DECISION_DISAGREEMENT', 'KEEP', 'provenance',
    'referenceLabel', 'boundaryClass', 'semanticSkeletonId', 'itemId', 'split', 'TRAIN',
    'FINAL_HELD_OUT', 'p1b6-smreview-', 'p1b6-review-', 'p1b6-sk-', 'p1b6-item-',
    'p1b6-episode-', 'PASS', 'routed', 'calibration',
    ...new Set(catalog.candidates.map(row => row.boundaryClass)),
  ];
  for (const leak of leaks) assert.equal(text.includes(leak), false, leak);
  assert.equal(/"(CLEAR|ESCALATE)"/u.test(text), false);
});

test('row IDs are deterministic, namespaced, and ordered by ID rather than source order', () => {
  const pops = populations();
  const ids = pops.rows.map(row => row.reviewRowId);
  assert.equal(new Set(ids).size, 66);
  assert.equal(ids.every(id => /^p1b6-hacreview-[0-9a-f]{16}$/u.test(id)), true);
  assert.deepEqual(ids, [...ids].sort());
  for (const row of pops.rows) {
    assert.equal(row.reviewRowId, combined.humanReviewRowId(pops.batchSha256, row.itemId));
    assert.notEqual(row.reviewRowId.slice(-16),
      strongModel.opaqueReviewRowId(pops.batchSha256, row.itemId).slice(-16));
    assert.notEqual(row.reviewRowId.slice(-16),
      humanPacket.opaqueReviewRowId(pops.batchSha256, row.itemId).slice(-16));
  }
  const itemOrder = pops.rows.map(row => row.itemId);
  assert.notDeepEqual(itemOrder, [...itemOrder].sort());
  assert.deepEqual(pure.packetRows(populations()),
    pure.packetRows(pure.computePopulations(read(BATCH), readJson(AUDIT), rebuiltResults())));
});

test('the public API authorizes a HUMAN population only from the exact raw bytes', () => {
  // The export surface is closed: no trusted-results entry point or authorization flag exists.
  assert.deepEqual(Object.keys(combined).sort(), [
    'EXPECTED_ROWS', 'PACKET_IDENTITY', 'PROTOCOL_IDENTITY', 'PROTOCOL_PATH', 'ROLE',
    'STRONG_MODEL_RESULT_SHA256', 'buildHumanPacket', 'buildPacketFromPopulations',
    'derivePopulations', 'humanReviewRowId', 'loadProtocol', 'main', 'parseArgs',
    'readStrongModelResults', 'reconcileHumanResults', 'unauthorized',
  ]);
  assert.deepEqual(Object.keys(pure).sort(),
    ['classifyHumanResults', 'computePopulations', 'packetRows']);

  const receipt = readJson(RECONCILIATION);
  const substitutes = {
    'committed receipt': read(RECONCILIATION),
    'receipt summary': bytes(receipt.rawResultSummary),
    'parsed synthetic rows': { results: rebuiltResults() },
    'parsed synthetic array': rebuiltResults(),
    'reserialized synthetic rows': Buffer.from(
      `${JSON.stringify({ results: rebuiltResults() }, null, 2)}\n`, 'utf8'),
  };
  for (const [label, value] of Object.entries(substitutes)) {
    assert.throws(() => combined.derivePopulations(read(BATCH), readJson(AUDIT), value),
      /raw result artifact bytes|not the reconciled raw artifact/, label);
    assert.throws(() => combined.buildHumanPacket(read(BATCH), readJson(AUDIT), value),
      /raw result artifact bytes|not the reconciled raw artifact/, label);
  }

  // Pure derivation over synthetic rows, a copy of it, or a hand-built role/reference mapping is
  // refused by both production consumers.
  const synthetic = populations();
  const handBuilt = {
    ...synthetic,
    rows: synthetic.rows.map(row => ({ ...row, role: combined.ROLE.CALIBRATION,
      referenceLabel: 'CLEAR' })),
  };
  const valid = bytes({ results: allMatching(synthetic) });
  for (const [label, candidate] of Object.entries({ synthetic, copy: { ...synthetic }, handBuilt })) {
    assert.throws(() => combined.buildPacketFromPopulations(candidate),
      /exact raw strong-model bytes/, label);
    assert.throws(() => combined.reconcileHumanResults(candidate, valid),
      /exact raw strong-model bytes/, label);
  }
});

test('HUMAN results fail closed on duplicate, unknown, missing or malformed rows', () => {
  const pops = populations();
  const reject = (mutate, pattern, label) => {
    const results = allMatching(pops);
    const artifact = mutate(results) ?? { results };
    assert.throws(() => pure.classifyHumanResults(pops, bytes(artifact)), pattern, label);
  };
  reject(results => { results.push({ ...results[0] }); }, /duplicate HUMAN review row/, 'dup');
  reject(results => { results[0].reviewRowId = 'p1b6-hacreview-0000000000000000'; },
    /unknown HUMAN review row/, 'unknown');
  reject(results => { results[0].reviewRowId = strongModel.opaqueReviewRowId(pops.batchSha256,
    pops.rows[0].itemId); }, /unknown HUMAN review row/, 'strong-model id');
  reject(results => { results.pop(); }, /missing 1 rows/, 'missing');
  reject(results => ({ results, reviewer: 'x' }), /only key is results/, 'container');
  reject(results => results, /only key is results/, 'bare array');
  reject(results => { results[0].disposition = 'ACCEPT'; }, /invalid HUMAN disposition/, 'enum');
  reject(results => { results[0].decision = null; }, /inconsistent with KEEP/, 'keep null');
  reject(results => { Object.assign(results[0], { disposition: 'FIX', decision: 'CLEAR' }); },
    /inconsistent with FIX/, 'fix decision');
  reject(results => { results[0].reason = '  '; }, /reason is empty/, 'reason');
  reject(results => { delete results[0].reason; }, /exactly reviewRowId/, 'shape');
  assert.throws(() => pure.classifyHumanResults(pops, '{"results":[]}'), /raw bytes/);
  assert.throws(() => pure.classifyHumanResults(pops, Buffer.from('{')), /not valid JSON/);
});

test('HUMAN results cannot supply role, reference, identity or provenance', () => {
  const pops = populations();
  const smuggled = {
    role: 'CALIBRATION', referenceLabel: 'CLEAR', itemId: pops.rows[0].itemId,
    semanticSkeletonId: pops.rows[0].semanticSkeletonId, boundaryClass: 'x',
    provenance: 'HUMAN_ADJUDICATED', eligibility: 'ELIGIBLE',
  };
  for (const [key, value] of Object.entries(smuggled)) {
    const results = allMatching(pops);
    results[0][key] = value;
    assert.throws(() => pure.classifyHumanResults(pops, bytes({ results })),
      /exactly reviewRowId/, key);
  }
});

test('routed and calibration outcomes follow their distinct preregistered contracts', () => {
  const pops = populations();
  const routed = pops.rows.filter(row => row.role === combined.ROLE.ROUTED);
  const calibration = pops.rows.filter(row => row.role === combined.ROLE.CALIBRATION);
  const plan = new Map();
  const assign = (rows, choices) => rows.slice(0, choices.length)
    .forEach((row, index) => plan.set(row.reviewRowId, choices[index]));
  const choices = ['MATCH', 'OPPOSE', 'FIX', 'REJECT'];
  assign(routed, choices);
  assign(calibration, choices);
  const results = pops.rows.map(row => {
    const choice = plan.get(row.reviewRowId) ?? 'MATCH';
    if (choice === 'MATCH') return answer(row, 'KEEP', row.referenceLabel);
    if (choice === 'OPPOSE') return answer(row, 'KEEP', opposite(row.referenceLabel));
    return answer(row, choice, null);
  }).reverse();
  const out = pure.classifyHumanResults(pops, bytes({ results }));
  const find = (list, row) => list.find(entry => entry.itemId === row.itemId);

  assert.equal(out.adjudication.length, 34);
  assert.equal(out.calibration.length, 32);
  assert.deepEqual(
    [0, 1, 2, 3].map(index => {
      const { outcome, provenance, eligibility } = find(out.adjudication, routed[index]);
      return [outcome, provenance, eligibility];
    }),
    [
      ['HUMAN_KEEP_MATCHING_REFERENCE', 'HUMAN_ADJUDICATED', 'ELIGIBLE'],
      ['HUMAN_KEEP_OPPOSING_REFERENCE', null, 'INELIGIBLE'],
      ['HUMAN_FIX', null, 'INELIGIBLE'],
      ['HUMAN_REJECT', null, 'INELIGIBLE'],
    ]);
  assert.deepEqual(
    [0, 1, 2, 3].map(index => {
      const { outcome, provenance, eligibility } = find(out.calibration, calibration[index]);
      return [outcome, provenance, eligibility];
    }),
    [
      ['CALIBRATION_MATCH', 'CATALOG_STRONG_MODEL_CONFIRMED', 'PROVISIONAL'],
      ['CALIBRATION_DECISION_MISMATCH', null, 'INELIGIBLE'],
      ['CALIBRATION_FIX', null, 'INELIGIBLE'],
      ['CALIBRATION_REJECT', null, 'INELIGIBLE'],
    ]);

  // An opposing HUMAN decision is recorded, never written back as the reference label.
  const opposed = find(out.adjudication, routed[1]);
  assert.equal(opposed.referenceLabel, routed[1].referenceLabel);
  assert.notEqual(opposed.humanDecision, opposed.referenceLabel);
  assert.equal(sha256RawBytes(read(CATALOG)), UNCHANGED[CATALOG]);

  // Calibration never yields HUMAN_ADJUDICATED; adjudication never yields calibration outcomes.
  assert.equal(out.calibration.some(row => row.provenance === 'HUMAN_ADJUDICATED'), false);
  assert.equal(out.adjudication.some(row => row.outcome.startsWith('CALIBRATION_')), false);
  assert.deepEqual(out.summary.calibration, {
    CALIBRATION_MATCH: 29, CALIBRATION_DECISION_MISMATCH: 1, CALIBRATION_FIX: 1,
    CALIBRATION_REJECT: 1,
  });
  // Hidden role is restored from the derivation, so result order is irrelevant.
  assert.deepEqual(pure.classifyHumanResults(pops, bytes({ results: results.reverse() })).adjudication,
    out.adjudication);
});

test('calibration results are not extrapolated to the 235 unreviewed agreements', () => {
  const pops = populations();
  const clean = pure.classifyHumanResults(pops, bytes({ results: allMatching(pops) }));
  const allDefective = pops.rows.map(row => answer(row, 'REJECT', null));
  const defective = pure.classifyHumanResults(pops, bytes({ results: allDefective }));
  assert.equal(clean.calibration.every(row => row.provenance === 'CATALOG_STRONG_MODEL_CONFIRMED'),
    true);
  assert.equal(defective.calibration.every(row => row.eligibility === 'INELIGIBLE'), true);
  assert.deepEqual(defective.unreviewedAgreements, clean.unreviewedAgreements);
  assert.equal(clean.unreviewedAgreements.length, 235);
  assert.equal(clean.unreviewedAgreements.every(row => row.provenance
    === 'CATALOG_STRONG_MODEL_CONFIRMED' && row.eligibility === 'PROVISIONAL'), true);
});

test('the canonical design says the sample is drawn and the HUMAN review is done', () => {
  const design = read(
    'docs/Memory research/local-memory-inference/local-memory-inference-p1b6-design.md')
    .toString('utf8');
  const start = design.indexOf('### Strong-model semantic review against v2');
  const end = design.indexOf('## Closed Selection and Freeze Constraints');
  assert.equal(start > 0 && end > start, true);
  const current = design.slice(start, end);

  // The packet is recorded as built, so the section cannot also deny that the sample was drawn.
  assert.equal(current.includes(PACKET_SHA256), true);
  assert.equal(/no calibration draw/iu.test(current), false);
  assert.equal(current.includes('calibration sample selection: **DONE**'), true);
  // The executed attempt replaced the NOT RUN claims; nothing downstream is claimed as done.
  assert.equal(current.includes('HUMAN calibration review: **DONE**'), true);
  assert.equal(current.includes('HUMAN adjudication of the 34 routed rows: **DONE**'), true);
  assert.equal(/HUMAN (calibration review|adjudication[^:]*): \*\*NOT RUN\*\*/u.test(current), false);
  assert.equal(current.includes('resolution of the 26 ineligible realizations: **DONE**'), true);
});

test('historical artifacts, builders and semantic contract v2 are unchanged', () => {
  for (const [file, sha] of Object.entries(UNCHANGED)) {
    assert.equal(sha256RawBytes(read(file)), sha, file);
  }
  for (const file of HISTORICAL_BATCH_001_002) {
    assert.equal(fs.existsSync(path.join(ROOT, file)), true, file);
  }
  // The issued 301-row strong-model packet still rebuilds byte-identically.
  assert.equal(sha256RawBytes(strongModel.packetBytes(strongModel.buildStrongModelReviewPacket(
    read(BATCH), readJson(AUDIT)))),
  '91b0276d0301eb0d8193868d7bfbe011bfe9132fdf3501ec1151fb8689cd57ca');
  // The generic historical HUMAN builder still refuses the COMPLETE_NEEDS_FIX audit.
  assert.throws(() => humanPacket.buildHumanReviewPacket(read(BATCH), readJson(AUDIT)),
    /receipt binding is invalid|not an all-PASS result/);
  const labels = readJson(CATALOG).candidates.map(row => row.humanLabel);
  assert.equal(labels.filter(label => label === 'CLEAR').length, 45);
  assert.equal(labels.filter(label => label === 'ESCALATE').length, 11);
});

test('the exact raw strong-model bytes reproduce the same 66-row packet',
  { skip: !RAW_RESULTS && 'P1B6_B003_SM_RESULTS is not set; raw bytes are not committed' }, () => {
    const raw = fs.readFileSync(RAW_RESULTS);
    assert.equal(sha256RawBytes(raw), combined.STRONG_MODEL_RESULT_SHA256);
    const real = combined.derivePopulations(read(BATCH), readJson(AUDIT), raw);
    assert.deepEqual(real.rows, populations().rows);
    const packet = combined.buildHumanPacket(read(BATCH), readJson(AUDIT), raw);
    assert.equal(sha256RawBytes(strongModel.packetBytes(packet)), PACKET_SHA256);
    assert.deepEqual(combined.buildPacketFromPopulations(real), packet);

    // The header names only the packet, batch, renderer and protocol.
    assert.deepEqual(Object.keys(packet),
      ['name', 'sourceBatch', 'rendererIdentity', 'reviewProtocol', 'rows']);
    assert.equal(packet.name, combined.PACKET_IDENTITY);
    assert.deepEqual(packet.sourceBatch,
      { identity: readJson(BATCH).name, sha256: real.batchSha256 });
    assert.deepEqual(packet.reviewProtocol,
      { identity: combined.PROTOCOL_IDENTITY, sha256: combined.loadProtocol().sha256 });
    assert.deepEqual(packet.rows, pure.packetRows(real));

    // The authorized population is the one production reconciliation accepts.
    const out = combined.reconcileHumanResults(real, bytes({ results: allMatching(real) }));
    assert.equal(out.adjudication.length + out.calibration.length, 66);
  });
