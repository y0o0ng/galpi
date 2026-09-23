'use strict';

// Fresh blind v3 strong-model review packet for the 24 batch-003 surfaces left on the three
// skeletons v3 reversed from CLEAR to ESCALATE.
//
// Constructing the packet is not the review: nothing here runs a model, ingests a result or
// accepts a row. These tests pin the mechanical population, inherited source-audit PASS, the v3
// protocol, blindness, byte continuity with the historical packet, the preregistered routing and
// historical immutability.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const builder = require('../scripts/build-memory-inference-p1b6-batch-003-targeted-v3-strong-model-review-packet');
const historical = require('../scripts/build-memory-inference-p1b6-batch-003-strong-model-review-packet');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file));
const readJson = file => JSON.parse(read(file));
const fixture = key => `fixtures/${builder.CANONICAL_INPUTS[key].fixture}`;
const artifactBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');

const PACKET_SHA256 = '665755e2e9704240d55d99749af68c17c5882f3c73a9f0867286883f82db1b74';
const PLAN = 'fixtures/local-memory-inference-p1b6-batch-003-v3-rereconciliation-plan.json';
const PLAN_SHA256 = 'ab0db3a730b5f2abc00d3209755f492f9a2f7bbf08ef9c4986b98e3e6ec1a887';
const item = number => `p1b6-item-b003-${number}`;
const EXPECTED_IDS = [
  '071', '073', '074', '075', '076', '077', '078', '079', '080', '081', '082',
  '143', '144',
  '229', '230', '232', '233', '234', '235', '236', '237', '238', '239', '240',
].map(item);
const CORRECTED = ['072', '142', '145', '231'].map(item);
const UNCHANGED = Object.freeze({
  'fixtures/local-memory-inference-p1b6-surface-batch-003.json':
    '90b453c3680bccaa537fd0d23db74bbc303882e1a35a2ddcea0b75b013fcaa68',
  'fixtures/local-memory-inference-p1b6-source-audit-batch-003-attempt-001.json':
    '3c840476bea6eccb522800248a3ace277b26a5334ec56b5f6b10bbf4d5821221',
  'fixtures/local-memory-inference-p1b6-strong-model-semantic-review-protocol.json':
    '2f97028fe5bb9612a0750140754136785f99d07f93f7924c697a5b67990c16c4',
  'scripts/build-memory-inference-p1b6-batch-003-strong-model-review-packet.js':
    'e429b59e5eb53b60c97dfe7e941250646e9d4b6cb9f0e6fa666a087cdc02fd0f',
  'fixtures/local-memory-inference-p1b6-strong-model-semantic-review-batch-003-attempt-001.json':
    '9b65327a4ce6d1923391253659c1acc3bb373bb54acdc7872e3ce74d52337074',
  'fixtures/local-memory-inference-p1b6-batch-003-human-adjudication-calibration-attempt-001.json':
    '0adbba1789bb91025f277701c51cbf82139092f147966053277573c3f0dbbe6a',
  'scripts/reconcile-memory-inference-p1b6-batch-003-human-adjudication-calibration.js':
    '097b82eee78a8d69803f5bb89b075e2a949da8e9cbda5d47a5d55ee29cb38497',
  'fixtures/local-memory-inference-p1b6-skeleton-effective-current-v2.json':
    'f1e780195441246402ca389da188b1f7b8c4970f42fc1e6e3de2f436a3e9377c',
  'fixtures/local-memory-inference-p1b6-skeleton-effective-current-v3.json':
    '89a48264d6b09710f976a4ab85235ff161cf81ff44896e37553d5dc7753c65b9',
  'fixtures/local-memory-inference-p1b6-skeleton-semantic-contract-v3-receipt.json':
    '10f8a10eb3325b86c9d9282fc951ee53b2037918c4258c89a7694822df9a98e1',
  'fixtures/local-memory-inference-p1b6-batch-003-resolution-receipt.json':
    '61c29218a360bf914c6453758c7fc243e629f1b5d400e38426d9d18720cb1ffe',
  'lib/memory-inference-p1b6-surfaces.js':
    '4b6dabf2280529b138efe124f32252c2ff7a2b9a118d7eb2c2b3341c7c56f1b7',
});

const inputs = () => builder.loadCanonicalInputs();
const build = (overrides = {}) => builder.buildTargetedReviewPacket({ ...inputs(), ...overrides });
// Parsed artifacts plus the mechanically mapped audit dispositions, for the pure derivation.
function parsed() {
  const raw = inputs();
  const { batch, dispositions } = historical.validateAuditReceipt(
    JSON.parse(raw.sourceAuditReceipt.toString('utf8')), raw.batch);
  return {
    batch,
    dispositions: new Map(dispositions),
    v3Receipt: JSON.parse(raw.v3Receipt.toString('utf8')),
    v3Catalog: JSON.parse(raw.v3Catalog.toString('utf8')),
    resolutionReceipt: JSON.parse(raw.resolutionReceipt.toString('utf8')),
  };
}

test('population is mechanically fixed at the 24 expected rows, 11 / 2 / 11', () => {
  const population = builder.derivePopulation(parsed());
  assert.deepEqual(population.map(row => row.itemId).toSorted(), EXPECTED_IDS);
  const counts = {};
  for (const row of population) counts[row.semanticSkeletonId] = (counts[row.semanticSkeletonId] ?? 0) + 1;
  assert.deepEqual(counts, builder.EXPECTED_PER_SKELETON);
  for (const itemId of CORRECTED) assert.equal(population.some(row => row.itemId === itemId), false);
  const v3Receipt = readJson(fixture('v3Receipt'));
  const retired = v3Receipt.retirements.flatMap(row => [row.retiredSkeletonId, row.replacementSkeletonId]);
  assert.equal(population.some(row => retired.includes(row.semanticSkeletonId)), false);
});

test('no caller-supplied list or label can alter the population', () => {
  for (const extra of [{ itemIds: [item('072')] }, { exclusions: [] }, { skeletonIds: [] }, { labels: {} }]) {
    assert.throws(() => build(extra), /does not accept caller inputs/);
  }
  assert.throws(() => builder.buildTargetedReviewPacket(undefined), /were not supplied/);
});

test('every targeted row maps to source-audit PASS; a non-PASS target fails closed', () => {
  const base = parsed();
  for (const itemId of EXPECTED_IDS) assert.equal(base.dispositions.get(itemId), 'PASS', itemId);
  for (const disposition of ['FAIL', 'UNCERTAIN', undefined]) {
    const dispositions = new Map(base.dispositions);
    dispositions.set(item('229'), disposition);
    assert.throws(() => builder.derivePopulation({ ...base, dispositions }), /not source-audit PASS/);
  }
  // Through the real receipt, flipping a target row to FAIL breaks the audited 002/006/109 set.
  const receipt = readJson(fixture('sourceAuditReceipt'));
  const batchSha = builder.CANONICAL_INPUTS.batch.rawSha256;
  const auditId = require('../scripts/build-memory-inference-p1b6-source-audit-packet')
    .opaqueAuditRowId(batchSha, item('229'));
  receipt.rows.find(row => row.auditRowId === auditId).disposition = 'FAIL';
  assert.throws(() => historical.validateAuditReceipt(receipt, inputs().batch), /P1-B6/);
});

test('audit receipt, batch, source-audit protocol and resolution drift fail closed', () => {
  for (const key of Object.keys(builder.CANONICAL_INPUTS)) {
    const drifted = JSON.parse(inputs()[key].toString('utf8'));
    drifted.driftMarker = true;
    assert.throws(() => build({ [key]: artifactBytes(drifted) }), /not the canonical evidence/, key);
    assert.throws(() => build({ [key]: undefined }), /were not supplied/, key);
  }
  // Binding checks inside the hardened audit validator the builder relies on.
  const receipt = readJson(fixture('sourceAuditReceipt'));
  receipt.sourceAuditProtocol.sha256 = 'a'.repeat(64);
  assert.throws(() => historical.validateAuditReceipt(receipt, inputs().batch), /binding is invalid/);
  const other = readJson(fixture('sourceAuditReceipt'));
  other.auditPacketSha256 = 'a'.repeat(64);
  assert.throws(() => historical.validateAuditReceipt(other, inputs().batch), /binding is invalid/);
});

test('the three v3 reversals are derived mechanically and drift fails', () => {
  const base = parsed();
  assert.deepEqual(base.v3Receipt.amendments.map(row => row.semanticSkeletonId).toSorted(),
    Object.keys(builder.EXPECTED_PER_SKELETON));
  for (const change of [
    receipt => { receipt.amendments[0].toHumanLabel = 'CLEAR'; },
    receipt => { receipt.amendments[1].fromHumanLabel = 'ESCALATE'; },
    receipt => { receipt.amendments[2].reversesV2Amendment = false; },
    receipt => { receipt.amendments.pop(); },
  ]) {
    const v3Receipt = structuredClone(base.v3Receipt);
    change(v3Receipt);
    assert.throws(() => builder.derivePopulation({ ...base, v3Receipt }), /three CLEAR -> ESCALATE reversals/);
  }
  const v3Catalog = structuredClone(base.v3Catalog);
  v3Catalog.candidates.find(row => row.semanticSkeletonId === 'p1b6-sk-5269c91fcfb6c2cd').humanLabel = 'CLEAR';
  assert.throws(() => builder.derivePopulation({ ...base, v3Catalog }), /catalog label disagrees/);

  const dropped = structuredClone(base.resolutionReceipt);
  dropped.decisions = dropped.decisions.filter(row => row.itemId !== item('231'));
  assert.throws(() => builder.derivePopulation({ ...base, resolutionReceipt: dropped }), /do not match the v3 amendments/);
  const touched = structuredClone(base.resolutionReceipt);
  touched.decisions.push({ itemId: item('073'), resolution: 'SURFACE_REJECT' });
  assert.throws(() => builder.derivePopulation({ ...base, resolutionReceipt: touched }), /resolved another way/);
});

test('the protocol quotes v3 exactly, binds v3 and the amendment, and names no row or answer', () => {
  const protocol = readJson(fixture('protocol'));
  const v3 = readJson(fixture('v3Catalog'));
  assert.equal(protocol.protocolIdentity, builder.PROTOCOL_IDENTITY);
  for (const key of ['clear', 'escalate', 'uncertaintyDistinction', 'targetBoundary', 'pragmaticResolution']) {
    assert.equal(protocol.question[key], v3.interpretationRule[key], key);
  }
  assert.equal(protocol.question.noAddedPremise, v3.interpretationRule.retainedV2Clauses.noAddedPremise);
  assert.deepEqual(protocol.semanticContract.semanticAuthority,
    { identity: v3.name, rawSha256: builder.CANONICAL_INPUTS.v3Catalog.rawSha256 });
  assert.deepEqual(protocol.semanticContract.semanticContractReceipt,
    { identity: builder.CANONICAL_INPUTS.v3Receipt.identity, rawSha256: builder.CANONICAL_INPUTS.v3Receipt.rawSha256 });
  assert.deepEqual(protocol.authorizedBy, {
    identity: builder.CANONICAL_INPUTS.reviewAuthorityAmendment.identity,
    amendmentId: 'p1b6-large-batch-review-authority-v1',
    rawSha256: builder.CANONICAL_INPUTS.reviewAuthorityAmendment.rawSha256,
  });
  assert.equal(protocol.reviewer.humanGoldAuthority, false);
  assert.equal(protocol.reviewer.knowsIntendedAnswer, false);
  assert.equal(protocol.reviewer.knowsReferenceLabel, false);
  assert.equal(protocol.reviewer.freshSessionRequired, true);
  assert.deepEqual(protocol.outputContract.allowedOutcomes, [
    { disposition: 'KEEP', decision: 'CLEAR' },
    { disposition: 'KEEP', decision: 'ESCALATE' },
    { disposition: 'FIX', decision: null },
    { disposition: 'REJECT', decision: null },
  ]);
  const text = JSON.stringify(protocol);
  for (const value of ['unknownIsNotAmbiguity', 'Unknown is not ambiguity', 'p1b6-item-', 'p1b6-sk-',
    ...Object.keys(builder.EXPECTED_PER_SKELETON).map(id => id.slice(8, 16)),
    'revers', 'amended', 'humanLabel', 'referenceLabel', 'v2', 'mostly', 'expected']) {
    assert.equal(text.includes(value), false, value);
  }
});

test('rows expose only an opaque ID and the bundle, with no hidden metadata', () => {
  const packet = build();
  assert.deepEqual(Object.keys(packet),
    ['name', 'status', 'sourceBatch', 'rendererIdentity', 'reviewProtocol', 'rows']);
  assert.equal(packet.status, 'BLIND_STRONG_MODEL_REVIEW_PACKET_NOT_RUN');
  const batch = readJson(fixture('batch'));
  const v3 = readJson(fixture('v3Catalog'));
  const targets = batch.items.filter(row => EXPECTED_IDS.includes(row.itemId));
  const episodes = new Set(targets.map(row => row.sourceEpisodeId));
  const skeletons = v3.candidates.filter(row => targets.some(t => t.semanticSkeletonId === row.semanticSkeletonId));
  const forbidden = [
    ...targets.flatMap(row => [row.itemId, row.sourceEpisodeId, row.surfaceFamilyId, row.semanticSkeletonId]),
    ...batch.sourceEpisodes.filter(row => episodes.has(row.sourceEpisodeId)).flatMap(row => [row.sourceFamilyId]),
    ...skeletons.flatMap(row => [row.candidateFocus, row.interpretationContract, row.boundaryClass]),
    'p1b6-item-', 'p1b6-se-', 'p1b6-sf-', 'p1b6-sk-', 'CLEAR', 'ESCALATE', 'KEEP', 'FIX', 'REJECT',
    'PASS', 'FAIL', 'UNCERTAIN', 'TRAIN', 'DEV', 'FINAL_HELD_OUT', 'HUMAN', 'CATALOG_', 'CALIBRATION',
    'rereconciliation', 'v3-rereconciliation-plan', 'splitAssignment', 'provenance', 'reference', 'expected',
  ].filter(Boolean);
  const text = JSON.stringify(packet);
  for (const value of forbidden) assert.equal(text.includes(value), false, value);
  for (const row of packet.rows) {
    assert.deepEqual(Object.keys(row), ['reviewRowId', 'selectedBundle']);
    assert.equal(row.selectedBundle.split('[TARGET]').length, 2);
  }
  // No full source episode: bundles are selected evidence only.
  assert.equal(text.includes('turns'), false);
});

test('each bundle is byte-identical to the historical packet bundle for the same item', () => {
  const raw = inputs();
  const historicalPacket = historical.buildStrongModelReviewPacket(raw.batch,
    JSON.parse(raw.sourceAuditReceipt.toString('utf8')));
  const byHistoricalId = new Map(historicalPacket.rows.map(row => [row.reviewRowId, row.selectedBundle]));
  const packet = build();
  const batchSha = builder.CANONICAL_INPUTS.batch.rawSha256;
  for (const itemId of EXPECTED_IDS) {
    const fresh = packet.rows.find(row => row.reviewRowId === builder.opaqueReviewRowId(batchSha, itemId));
    const old = byHistoricalId.get(historical.opaqueReviewRowId(batchSha, itemId));
    assert.equal(typeof old, 'string', itemId);
    assert.equal(Buffer.from(fresh.selectedBundle).equals(Buffer.from(old)), true, itemId);
  }
});

test('opaque IDs are deterministic, unique, sorted and in a fresh namespace', () => {
  const packet = build();
  assert.equal(packet.rows.length, 24);
  assert.equal(sha256RawBytes(builder.packetBytes(packet)), PACKET_SHA256);
  assert.deepEqual(builder.packetBytes(build()), builder.packetBytes(packet));
  const ids = packet.rows.map(row => row.reviewRowId);
  assert.deepEqual(ids, ids.toSorted());
  assert.equal(new Set(ids).size, 24);
  const batchSha = builder.CANONICAL_INPUTS.batch.rawSha256;
  assert.deepEqual(EXPECTED_IDS.map(itemId => builder.opaqueReviewRowId(batchSha, itemId)).toSorted(), ids);
  for (const id of ids) {
    assert.match(id, /^p1b6-v3smreview-[0-9a-f]{16}$/u);
    for (const prior of ['p1b6-smreview-', 'p1b6-review-', 'p1b6-rereview-', 'p1b6-hacreview-',
      'p1b6-repair-review-', 'p1b6-b003-repair-review-', 'p1b6-audit-', 'p1b6-repair-audit-',
      'p1b6-b003-repair-audit-']) {
      assert.equal(id.startsWith(prior), false, prior);
    }
  }
  // Historical v2 IDs for the same items never reappear.
  const old = new Set(EXPECTED_IDS.map(itemId => historical.opaqueReviewRowId(batchSha, itemId)));
  assert.equal(ids.some(id => old.has(id)), false);
});

test('the internal plan binds every canonical input and preregisters routing and calibration', () => {
  assert.equal(sha256RawBytes(read(PLAN)), PLAN_SHA256);
  const plan = readJson(PLAN);
  const bound = {
    historicalSourceBatch: 'batch', sourceAuditReceipt: 'sourceAuditReceipt',
    semanticContractV3Receipt: 'v3Receipt', semanticAuthorityV3: 'v3Catalog',
    resolutionReceipt: 'resolutionReceipt', reviewAuthorityAmendment: 'reviewAuthorityAmendment',
    strongModelReviewProtocol: 'protocol',
  };
  assert.deepEqual(Object.keys(plan.inputs), Object.keys(bound));
  for (const [planKey, key] of Object.entries(bound)) {
    const pinned = builder.CANONICAL_INPUTS[key];
    assert.deepEqual(plan.inputs[planKey], { identity: pinned.identity, rawSha256: pinned.rawSha256 }, planKey);
  }
  assert.equal(plan.population.callerSuppliedListsAccepted, false);
  assert.equal(plan.population.expectedCount, builder.EXPECTED_COUNT);
  assert.deepEqual(plan.population.expectedPerSkeleton, builder.EXPECTED_PER_SKELETON);
  assert.equal(plan.sourceAuditInheritance.freshSourceAudit, false);
  assert.equal(plan.historicalSemanticEvidence.preserved, true);
  assert.equal(plan.historicalSemanticEvidence.transferredAsV3Decision, false);
  assert.equal(plan.freshSemanticReviewRequiredForAll, true);

  // The recorded historical evidence matches the committed v2 HUMAN attempt.
  const human = readJson('fixtures/local-memory-inference-p1b6-batch-003-human-adjudication-calibration-attempt-001.json');
  const inTarget = rows => rows.map(row => row.itemId).filter(id => EXPECTED_IDS.includes(id)).toSorted();
  assert.deepEqual(inTarget(human.adjudicationRows), plan.historicalSemanticEvidence.v2HumanAdjudicatedItemIds);
  assert.deepEqual(inTarget(human.calibrationRows), plan.historicalSemanticEvidence.v2HumanCalibrationItemIds);
  assert.equal(EXPECTED_IDS.length - 4 - 1, plan.historicalSemanticEvidence.v2UnsampledCatalogStrongModelConfirmedCount);

  const { cleanAgreement, mandatoryHumanAdjudication, calibration, humanSemantics } = plan.routing;
  assert.deepEqual(cleanAgreement, {
    condition: 'disposition KEEP and decision equal to the v3 reference label',
    provenance: 'CATALOG_STRONG_MODEL_CONFIRMED',
    eligibility: 'PROVISIONAL',
    createsHumanGold: false,
  });
  assert.deepEqual(mandatoryHumanAdjudication.routeWhen, [
    'disposition FIX', 'disposition REJECT',
    'KEEP decision differs from the v3 reference label', 'result missing or invalid',
  ]);
  assert.equal(calibration.population, 'FRESH_V3_CLEAN_AGREEMENT_ROWS_ONLY');
  assert.equal(calibration.hashDomain, 'p1b6-b003-v3-rereconciliation-calibration-v1');
  assert.deepEqual(calibration.sizeRange, [0, 3]);
  assert.equal(calibration.substituteAcrossSkeletons, false);
  assert.equal(calibration.disjointFromMandatoryHuman, true);
  assert.equal(calibration.extrapolatedToUnsampledAgreements, false);
  assert.match(calibration.rule, /each of the three amended skeletons separately.*exactly one.*lowest sha256/);
  assert.match(humanSemantics.calibration.KEEP_matching_v3_reference, /not promoted to HUMAN_ADJUDICATED or HUMAN gold/);
  assert.equal(humanSemantics.mandatory.KEEP_matching_v3_reference, 'HUMAN_ADJUDICATED; eligible');
  assert.equal(Object.values(plan.authority).every(value => value === false), true);
  // The selector's hash is well defined for every target row (no ties within a skeleton).
  const hash = itemId => crypto.createHash('sha256').update(`${calibration.hashDomain}\0${itemId}`).digest('hex');
  assert.equal(new Set(EXPECTED_IDS.map(hash)).size, EXPECTED_IDS.length);
});

test('the CLI needs an explicit path, refuses to overwrite and prints SHA and row count', () => {
  assert.throws(() => builder.main([]), /Usage/);
  assert.throws(() => builder.main(['--input', 'x']), /Usage/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b6-v3sm-'));
  const output = path.join(dir, 'packet.json');
  assert.deepEqual(builder.writeTargetedReviewPacket(output), { rawSha256: PACKET_SHA256, rowCount: 24 });
  assert.throws(() => builder.writeTargetedReviewPacket(output), /will not be overwritten/);
  fs.rmSync(dir, { recursive: true });
});

test('historical artifacts and builders are unchanged by packet construction', () => {
  build();
  for (const [file, sha] of Object.entries(UNCHANGED)) {
    assert.equal(sha256RawBytes(read(file)), sha, file);
  }
});
