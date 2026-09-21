#!/usr/bin/env node
'use strict';

// Batch-003 combined blind HUMAN packet: the 34 mandatory HUMAN-routed rows and the
// deterministic 32-row clean-agreement calibration sample, mixed in one 66-row packet.
//
// Both populations are reconstructed from canonical artifacts: the audited batch, the
// source-audit receipt, the pinned v2 catalog and the exact raw strong-model result bytes, run
// through the existing strong-model reconciliation and calibration selector. Nothing is taken
// from a supplied list or role mapping.
//
// The HUMAN reviewer sees an opaque row ID and the selected bundle only. Which population a row
// belongs to is restored after result validation, from the same derivation, never from the
// result file or its order.
//
// HUMAN result reconciliation is implemented here before review so its semantics are
// preregistered. It executes nothing on its own and creates no acceptance, freeze or selection.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const { RENDERER_IDENTITY, renderHumanReviewText } = require('../lib/memory-inference-p1b6-surfaces');
const strongModel = require('./build-memory-inference-p1b6-batch-003-strong-model-review-packet');

const ROOT = path.resolve(__dirname, '..');
const PACKET_IDENTITY =
  'xion-local-memory-inference-p1b6-batch-003-human-adjudication-calibration-packet-v1';
const PROTOCOL_PATH =
  'fixtures/local-memory-inference-p1b6-batch-003-human-adjudication-calibration-protocol.json';
const PROTOCOL_IDENTITY = 'p1b6-batch-003-human-adjudication-calibration-review-v1';
const RECONCILIATION_PATH =
  'fixtures/local-memory-inference-p1b6-strong-model-semantic-review-batch-003-attempt-001.json';
const RECONCILIATION_ATTEMPT_ID = 'p1b6-strong-model-semantic-review-batch-003-attempt-001';
const STRONG_MODEL_RESULT_SHA256 =
  '148c272fa77174ce51d61d7cf5adce959061623715078284a5e6a7b0cfcdb2de';

const EXPECTED_AGREEMENTS = 267;
const EXPECTED_ROUTED = 34;
const EXPECTED_ROWS = EXPECTED_ROUTED + strongModel.CALIBRATION_SIZE;
const REFERENCE_LABELS = Object.freeze(['CLEAR', 'ESCALATE']);
const ROLE = Object.freeze({ ROUTED: 'MANDATORY_ADJUDICATION', CALIBRATION: 'CALIBRATION' });

function fail(message) {
  throw new TypeError(`P1-B6 batch-003 HUMAN adjudication/calibration packet ${message}`);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function parseJsonBytes(bytes, what) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) fail(`${what} must be raw bytes`);
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    return fail(`${what} is not valid JSON`);
  }
}

function loadProtocol(root = ROOT) {
  const bytes = fs.readFileSync(path.join(root, PROTOCOL_PATH));
  const protocol = JSON.parse(bytes.toString('utf8'));
  if (protocol.protocolIdentity !== PROTOCOL_IDENTITY
    || protocol.isHumanProtocol !== true
    || protocol.reviewer.knowsIntendedAnswer !== false
    || protocol.reviewer.knowsRowRole !== false
    || protocol.semanticAuthority.rawSha256 !== strongModel.CATALOG_SHA256
    || protocol.strongModelReconciliation.rawResultSha256 !== STRONG_MODEL_RESULT_SHA256
    || protocol.calibrationSemantics.promotesProvenance !== false
    || protocol.calibrationSemantics.extrapolatedToUnreviewedRows !== false) {
    fail('protocol is not the preregistered batch-003 HUMAN adjudication/calibration protocol');
  }
  return { protocol, sha256: sha256RawBytes(bytes) };
}

function loadReconciliationReceipt(root = ROOT) {
  const receipt = JSON.parse(fs.readFileSync(path.join(root, RECONCILIATION_PATH), 'utf8'));
  if (receipt.attemptId !== RECONCILIATION_ATTEMPT_ID
    || receipt.rawResultArtifact.sha256 !== STRONG_MODEL_RESULT_SHA256
    || receipt.currentReferenceAuthority.rawSha256 !== strongModel.CATALOG_SHA256
    || receipt.reconciliation.agreements !== EXPECTED_AGREEMENTS
    || receipt.reconciliation.humanAdjudicationRouted !== EXPECTED_ROUTED) {
    fail('committed strong-model reconciliation receipt is not the expected attempt');
  }
  return receipt;
}

// The committed receipt is a summary; only the exact raw result bytes can drive the derivation.
function readStrongModelResults(rawResultBytes, root = ROOT) {
  if (!Buffer.isBuffer(rawResultBytes) && !(rawResultBytes instanceof Uint8Array)) {
    fail('strong-model results must be the raw result artifact bytes');
  }
  const receipt = loadReconciliationReceipt(root);
  if (sha256RawBytes(rawResultBytes) !== receipt.rawResultArtifact.sha256) {
    fail('strong-model result bytes are not the reconciled raw artifact');
  }
  const artifact = parseJsonBytes(rawResultBytes, 'strong-model result artifact');
  if (!exactKeys(artifact, ['results']) || !Array.isArray(artifact.results)) {
    fail('strong-model result artifact shape is invalid');
  }
  return artifact.results;
}

// A separate namespace so a HUMAN row can never be confused with a strong-model, audit or
// historical primary-HUMAN row.
function humanReviewRowId(batchSha256, itemId) {
  return `p1b6-hacreview-${crypto.createHash('sha256')
    .update(`${PROTOCOL_IDENTITY}\0${batchSha256}\0${itemId}`).digest('hex').slice(0, 16)}`;
}

// The authorization gate. Only derivePopulations writes to this set, and only after the exact
// raw strong-model bytes passed the SHA check, so neither parsed rows nor a hand-built role or
// reference mapping can become a population the packet builder or reconciliation will accept.
const authorizedPopulations = new WeakSet();

// Pure derivation from already-parsed results. It still has to reproduce the committed
// reconciliation exactly (267 / 34 and the same routed items), but it authorizes nothing: its
// output is never admitted by requireAuthorized.
function computePopulations(rawBatchBytes, auditReceipt, results, catalogBytes, root = ROOT) {
  const receipt = loadReconciliationReceipt(root);
  const reconciled = strongModel.reconcileBatch003(rawBatchBytes, auditReceipt, results,
    catalogBytes, root);
  if (reconciled.agreements.length !== EXPECTED_AGREEMENTS
    || reconciled.humanAdjudication.length !== EXPECTED_ROUTED) {
    fail(`reconciliation is not ${EXPECTED_AGREEMENTS} agreements / ${EXPECTED_ROUTED} routes`);
  }
  const routedIds = reconciled.humanAdjudication.map(row => row.itemId).sort();
  if (JSON.stringify(routedIds) !== JSON.stringify([...receipt.routedItemIds].sort())) {
    fail('derived routed rows do not match the committed reconciliation');
  }
  const calibrationIds = strongModel.selectCalibrationSample(reconciled.agreements)
    .map(row => row.itemId);
  const routedSet = new Set(routedIds);
  if (calibrationIds.some(itemId => routedSet.has(itemId))) {
    fail('routed and calibration populations overlap');
  }

  const { references } = strongModel.buildCanonicalReviewReferences(rawBatchBytes, auditReceipt,
    catalogBytes, root);
  const byItemId = new Map(references.map(row => [row.itemId, row]));
  const calibrationSet = new Set(calibrationIds);
  const rows = [
    ...routedIds.map(itemId => [itemId, ROLE.ROUTED]),
    ...calibrationIds.map(itemId => [itemId, ROLE.CALIBRATION]),
  ].map(([itemId, role]) => {
    if (strongModel.EXPECTED_FAILED_ITEM_IDS.includes(itemId)) {
      fail(`source-audit FAIL row entered the HUMAN population: ${itemId}`);
    }
    const reference = byItemId.get(itemId);
    return Object.freeze({
      reviewRowId: humanReviewRowId(reconciled.batchSha256, itemId),
      itemId,
      role,
      semanticSkeletonId: reference.semanticSkeletonId,
      referenceLabel: reference.referenceLabel,
    });
  }).sort((left, right) => (left.reviewRowId < right.reviewRowId ? -1 : 1));
  if (rows.length !== EXPECTED_ROWS || new Set(rows.map(row => row.reviewRowId)).size !== EXPECTED_ROWS) {
    fail(`HUMAN population is not exactly ${EXPECTED_ROWS} unique rows`);
  }

  return Object.freeze({
    batchSha256: reconciled.batchSha256,
    catalogSha256: reconciled.catalogSha256,
    rawBatchBytes: Buffer.from(rawBatchBytes),
    rows: Object.freeze(rows),
    unreviewedAgreements: Object.freeze(reconciled.agreements
      .filter(row => !calibrationSet.has(row.itemId)).map(row => Object.freeze({ ...row }))),
  });
}

function derivePopulations(rawBatchBytes, auditReceipt, rawStrongModelResultBytes, catalogBytes,
  root = ROOT) {
  const results = readStrongModelResults(rawStrongModelResultBytes, root);
  const populations = computePopulations(rawBatchBytes, auditReceipt, results, catalogBytes, root);
  authorizedPopulations.add(populations);
  return populations;
}

function requireAuthorized(populations) {
  if (!authorizedPopulations.has(populations)) {
    fail('populations must come from derivePopulations over the exact raw strong-model bytes');
  }
}

// Only the opaque ID and the canonical rendering reach the reviewer. Pure; authorizes nothing.
function packetRows(populations) {
  const batch = JSON.parse(populations.rawBatchBytes.toString('utf8'));
  const items = new Map(batch.items.map(item => [item.itemId, item]));
  return populations.rows.map(row => ({
    reviewRowId: row.reviewRowId,
    selectedBundle: renderHumanReviewText(batch, items.get(row.itemId)),
  }));
}

function buildPacketFromPopulations(populations, root = ROOT) {
  requireAuthorized(populations);
  const protocol = loadProtocol(root);
  const batch = JSON.parse(populations.rawBatchBytes.toString('utf8'));
  return {
    name: PACKET_IDENTITY,
    sourceBatch: { identity: batch.name, sha256: populations.batchSha256 },
    rendererIdentity: RENDERER_IDENTITY,
    reviewProtocol: { identity: PROTOCOL_IDENTITY, sha256: protocol.sha256 },
    rows: packetRows(populations),
  };
}

function buildHumanPacket(rawBatchBytes, auditReceipt, rawStrongModelResultBytes, catalogBytes,
  root = ROOT) {
  return buildPacketFromPopulations(
    derivePopulations(rawBatchBytes, auditReceipt, rawStrongModelResultBytes, catalogBytes, root),
    root);
}

// --- Prospective HUMAN result reconciliation ---------------------------------------------------
//
// Not executed here: no HUMAN result exists. Every row must be present and well formed before
// anything is produced; unlike the strong-model step there is no partial routing, because a
// missing HUMAN answer has nowhere further to go.

function validateHumanResults(populations, rawHumanResultBytes) {
  const artifact = parseJsonBytes(rawHumanResultBytes, 'HUMAN result artifact');
  if (!exactKeys(artifact, ['results']) || !Array.isArray(artifact.results)) {
    fail('HUMAN result artifact must be an object whose only key is results');
  }
  const known = new Set(populations.rows.map(row => row.reviewRowId));
  const byRowId = new Map();
  for (const row of artifact.results) {
    if (!exactKeys(row, ['reviewRowId', 'disposition', 'decision', 'reason'])) {
      fail('HUMAN result row must carry exactly reviewRowId, disposition, decision and reason');
    }
    if (!known.has(row.reviewRowId)) fail(`unknown HUMAN review row: ${String(row.reviewRowId)}`);
    if (byRowId.has(row.reviewRowId)) fail(`duplicate HUMAN review row: ${row.reviewRowId}`);
    if (!['KEEP', 'FIX', 'REJECT'].includes(row.disposition)) {
      fail(`invalid HUMAN disposition: ${String(row.disposition)}`);
    }
    if (row.disposition === 'KEEP' ? !REFERENCE_LABELS.includes(row.decision) : row.decision !== null) {
      fail(`HUMAN decision is inconsistent with ${row.disposition}: ${row.reviewRowId}`);
    }
    if (typeof row.reason !== 'string' || row.reason.trim() === '') {
      fail(`HUMAN reason is empty: ${row.reviewRowId}`);
    }
    byRowId.set(row.reviewRowId, row);
  }
  if (byRowId.size !== known.size) fail(`HUMAN results are missing ${known.size - byRowId.size} rows`);
  return byRowId;
}

// Routed rows keep the existing adjudication contract. Calibration rows are QA evidence only:
// a match leaves provenance CATALOG_STRONG_MODEL_CONFIRMED, anything else fails that one
// realization closed, and neither ever touches an unsampled agreement row.
function classify(role, human, referenceLabel) {
  const match = human.disposition === 'KEEP' && human.decision === referenceLabel;
  if (role === ROLE.ROUTED) {
    if (match) {
      return { outcome: 'HUMAN_KEEP_MATCHING_REFERENCE', provenance: 'HUMAN_ADJUDICATED', eligibility: 'ELIGIBLE' };
    }
    const outcome = human.disposition === 'KEEP' ? 'HUMAN_KEEP_OPPOSING_REFERENCE' : `HUMAN_${human.disposition}`;
    return { outcome, provenance: null, eligibility: 'INELIGIBLE' };
  }
  if (match) {
    return { outcome: 'CALIBRATION_MATCH', provenance: 'CATALOG_STRONG_MODEL_CONFIRMED', eligibility: 'PROVISIONAL' };
  }
  const outcome = human.disposition === 'KEEP'
    ? 'CALIBRATION_DECISION_MISMATCH' : `CALIBRATION_${human.disposition}`;
  return { outcome, provenance: null, eligibility: 'INELIGIBLE' };
}

function reconcileHumanResults(populations, rawHumanResultBytes) {
  requireAuthorized(populations);
  return classifyHumanResults(populations, rawHumanResultBytes);
}

// Pure classification of HUMAN results against a population. Authorizes nothing; production
// reaches it only through reconcileHumanResults.
function classifyHumanResults(populations, rawHumanResultBytes) {
  const byRowId = validateHumanResults(populations, rawHumanResultBytes);
  const reconciled = populations.rows.map(row => {
    const human = byRowId.get(row.reviewRowId);
    return {
      itemId: row.itemId,
      reviewRowId: row.reviewRowId,
      semanticSkeletonId: row.semanticSkeletonId,
      referenceLabel: row.referenceLabel,
      humanDisposition: human.disposition,
      humanDecision: human.decision,
      humanReason: human.reason,
      ...classify(row.role, human, row.referenceLabel),
    };
  });
  const byRole = role => reconciled
    .filter((_, index) => populations.rows[index].role === role)
    .sort((left, right) => (left.itemId < right.itemId ? -1 : 1));
  const count = rows => rows.reduce((totals, row) => {
    totals[row.outcome] = (totals[row.outcome] ?? 0) + 1;
    return totals;
  }, {});
  const adjudication = byRole(ROLE.ROUTED);
  const calibration = byRole(ROLE.CALIBRATION);
  return {
    humanResultSha256: sha256RawBytes(rawHumanResultBytes),
    catalogSha256: populations.catalogSha256,
    adjudication,
    calibration,
    summary: { adjudication: count(adjudication), calibration: count(calibration) },
    // Carried through unchanged: calibration says nothing about these rows.
    unreviewedAgreements: populations.unreviewedAgreements,
  };
}

function parseArgs(argv) {
  const flags = ['--input', '--audit-receipt', '--strong-model-results', '--output'];
  const usage = 'Usage: --input <surface-batch.json> --audit-receipt <receipt.json> '
    + '--strong-model-results <raw-results.json> --output <human-packet.json>';
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flags.includes(flag) || !value || Object.hasOwn(values, flag)) throw new Error(usage);
    values[flag] = value;
  }
  if (flags.some(flag => !values[flag])) throw new Error(usage);
  return {
    inputPath: values['--input'],
    receiptPath: values['--audit-receipt'],
    resultsPath: values['--strong-model-results'],
    outputPath: values['--output'],
  };
}

function main(argv = process.argv.slice(2)) {
  const { inputPath, receiptPath, resultsPath, outputPath } = parseArgs(argv);
  if (fs.existsSync(outputPath)) throw new Error(`Existing output will not be overwritten: ${outputPath}`);
  const packet = buildHumanPacket(fs.readFileSync(inputPath),
    JSON.parse(fs.readFileSync(receiptPath, 'utf8')), fs.readFileSync(resultsPath));
  const bytes = strongModel.packetBytes(packet);
  fs.writeFileSync(outputPath, bytes, { flag: 'wx' });
  process.stdout.write(`Built P1-B6 batch-003 HUMAN adjudication/calibration packet: ${outputPath}\n`
    + `rows ${packet.rows.length}, sha256 ${sha256RawBytes(bytes)}\n`);
  return 0;
}

module.exports = {
  EXPECTED_ROWS,
  PACKET_IDENTITY,
  PROTOCOL_IDENTITY,
  PROTOCOL_PATH,
  ROLE,
  STRONG_MODEL_RESULT_SHA256,
  buildHumanPacket,
  buildPacketFromPopulations,
  derivePopulations,
  humanReviewRowId,
  loadProtocol,
  main,
  parseArgs,
  readStrongModelResults,
  reconcileHumanResults,
  // Pure logic for unit tests. None of it can produce a population the gate above admits.
  unauthorized: Object.freeze({ classifyHumanResults, computePopulations, packetRows }),
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`P1-B6 batch-003 HUMAN adjudication/calibration packet build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
