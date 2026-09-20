#!/usr/bin/env node
'use strict';

// Batch-003 blind strong-model semantic-review packet.
//
// The large-batch review-authority amendment replaced exhaustive per-surface HUMAN review for
// newly authored growth batches. The reviewable population is therefore the source-audit PASS
// rows, reviewed blind by a fresh separate strong model against the existing P1-B6 task; the
// effective-current skeleton catalog stays the reference-label authority and HUMAN work is
// reserved for disagreement, FIX, REJECT and a deterministic calibration sample.
//
// This builder is batch-003 scoped on purpose. The historical generic HUMAN review packet
// builder still requires an all-PASS COMPLETE_PASS receipt and is left untouched.
//
// It executes no review, creates no HUMAN decision, assigns no label, accepts nothing and
// trains nothing.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const {
  RENDERER_IDENTITY,
  renderHumanReviewText,
  validateSurfaceBatch,
} = require('../lib/memory-inference-p1b6-surfaces');
const sourceAudit = require('./build-memory-inference-p1b6-source-audit-packet');

const ROOT = path.resolve(__dirname, '..');
const PACKET_IDENTITY =
  'xion-local-memory-inference-p1b6-batch-003-strong-model-semantic-review-packet-v1';
const PROTOCOL_PATH =
  'fixtures/local-memory-inference-p1b6-strong-model-semantic-review-protocol.json';
const PROTOCOL_IDENTITY = 'p1b6-strong-model-semantic-realization-review-v1';
const AMENDMENT_PATH =
  'fixtures/local-memory-inference-p1b6-large-batch-review-authority-amendment.json';
const AMENDMENT_IDENTITY = 'p1b6-large-batch-review-authority-v1';
const AUDIT_ATTEMPT_ID = 'p1b6-source-audit-batch-003-attempt-001';
const AUDITED_BATCH_SHA256 =
  '90b453c3680bccaa537fd0d23db74bbc303882e1a35a2ddcea0b75b013fcaa68';

// The audit outcome this builder is allowed to consume. Anything else fails closed.
const EXPECTED_TOTAL = 304;
const EXPECTED_PASS = 301;
const EXPECTED_FAIL = 3;
const EXPECTED_FAILED_ITEM_IDS = Object.freeze([
  'p1b6-item-b003-002', 'p1b6-item-b003-006', 'p1b6-item-b003-109',
]);

// Packet provenance and current reconciliation authority are deliberately separate.
//
// The issued blind packet binds the review-authority amendment that was in force when it was
// built, and its bytes must stay reproducible even though the semantic reference catalog moved
// afterwards. Reconciliation, by contrast, always reads the CURRENT reference catalog, which is
// semantic contract v2 at 45 CLEAR / 11 ESCALATE. Changing the catalog changes which answers
// count as agreement; it never changes a review row ID or a rendered bundle.
const CATALOG_PATH = 'fixtures/local-memory-inference-p1b6-skeleton-effective-current-v2.json';
const CATALOG_IDENTITY = 'xion-local-memory-inference-p1b6-skeleton-effective-current-v2';
const CATALOG_SHA256 = 'f1e780195441246402ca389da188b1f7b8c4970f42fc1e6e3de2f436a3e9377c';

const CALIBRATION_SIZE = 32;
const CALIBRATION_HASH_DOMAIN = 'p1b6-large-batch-human-calibration-v1';
const REFERENCE_LABELS = Object.freeze(['CLEAR', 'ESCALATE']);

function fail(message) {
  throw new TypeError(`P1-B6 batch-003 strong-model review packet ${message}`);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function packetBytes(packet) {
  return Buffer.from(`${JSON.stringify(packet, null, 2)}\n`, 'utf8');
}

function loadProtocol(root = ROOT) {
  const bytes = fs.readFileSync(path.join(root, PROTOCOL_PATH));
  const protocol = JSON.parse(bytes.toString('utf8'));
  if (protocol.protocolIdentity !== PROTOCOL_IDENTITY
    || protocol.isHumanProtocol !== false
    || protocol.isSourceAuditProtocol !== false
    || protocol.authorizedBy !== AMENDMENT_IDENTITY
    || protocol.reviewer.humanGoldAuthority !== false
    || protocol.reviewer.knowsIntendedAnswer !== false) {
    fail('protocol is not the preregistered strong-model semantic-review protocol');
  }
  return { protocol, sha256: sha256RawBytes(bytes) };
}

function loadAmendment(root = ROOT) {
  const bytes = fs.readFileSync(path.join(root, AMENDMENT_PATH));
  const amendment = JSON.parse(bytes.toString('utf8'));
  if (amendment.amendmentId !== AMENDMENT_IDENTITY
    || amendment.retroactive !== false
    || amendment.historicalAuthority.retroactiveRelabelAuthorized !== false) {
    fail('review-authority amendment is missing or not prospective');
  }
  return { amendment, sha256: sha256RawBytes(bytes) };
}

// Opaque IDs live in their own namespace so a strong-model row can never be confused with an
// audit row or a historical HUMAN review row.
function opaqueReviewRowId(batchSha256, itemId) {
  return `p1b6-smreview-${crypto.createHash('sha256')
    .update(`${PROTOCOL_IDENTITY}\0${batchSha256}\0${itemId}`).digest('hex').slice(0, 16)}`;
}

// Rebuilding the 304-row audit packet costs ~3s, and reconciliation revalidates on every call.
// Validation is a pure function of the batch bytes, the receipt and two frozen on-disk
// artifacts, so the verdict is memoized by content hash. Nothing is skipped: a different batch
// or a different receipt is a different key and runs the full check. The batch is re-parsed per
// call so no caller can mutate a shared object.
const verdictCache = new Map();

// Fails closed on every binding, not just the batch bytes: a receipt that drifted from the
// canonical packet, protocol or outcome must not be able to produce a review population.
function validateAuditReceipt(receipt, rawBatchBytes) {
  const batch = validateSurfaceBatch(JSON.parse(Buffer.from(rawBatchBytes).toString('utf8')));
  const batchSha256 = sha256RawBytes(rawBatchBytes);
  if (batchSha256 !== AUDITED_BATCH_SHA256) fail('batch bytes are not the audited batch');

  const cacheKey = `${batchSha256}\0${crypto.createHash('sha256')
    .update(JSON.stringify(receipt) ?? 'undefined').digest('hex')}`;
  const cached = verdictCache.get(cacheKey);
  if (cached) {
    if (cached.error) throw cached.error;
    return { batch, batchSha256, dispositions: cached.dispositions };
  }
  try {
    return { batch, ...validateAuditReceiptUncached(receipt, batch, batchSha256, rawBatchBytes,
      cacheKey) };
  } catch (error) {
    verdictCache.set(cacheKey, { error });
    throw error;
  }
}

function validateAuditReceiptUncached(receipt, batch, batchSha256, rawBatchBytes, cacheKey) {
  const protocol = sourceAudit.loadProtocol();
  const auditPacket = sourceAudit.buildAuditPacket(rawBatchBytes);
  const auditPacketSha256 = sha256RawBytes(packetBytes(auditPacket));

  if (!exactKeys(receipt, [
    'name', 'attemptId', 'status', 'auditPacketIdentity', 'auditPacketSha256',
    'sourceAuditProtocol', 'auditedSourceBatch', 'rawResultArtifact',
    'auditorExecutionProvenance', 'summary', 'failedItems', 'authority', 'rows',
  ]) || receipt.attemptId !== AUDIT_ATTEMPT_ID
    || receipt.status !== 'COMPLETE_NEEDS_FIX'
    || receipt.auditPacketIdentity !== sourceAudit.PACKET_IDENTITY
    || receipt.auditPacketSha256 !== auditPacketSha256
    || receipt.sourceAuditProtocol.identity !== sourceAudit.PROTOCOL_IDENTITY
    || receipt.sourceAuditProtocol.sha256 !== protocol.sha256
    || receipt.auditedSourceBatch.identity !== batch.name
    || receipt.auditedSourceBatch.batchId !== batch.batchId
    || receipt.auditedSourceBatch.rawSha256 !== batchSha256
    || auditPacket.sourceBatch.sha256 !== batchSha256
    || auditPacket.rendererIdentity !== RENDERER_IDENTITY) {
    fail('source-audit receipt binding is invalid');
  }

  if (!exactKeys(receipt.summary, ['total', 'PASS', 'FAIL', 'UNCERTAIN'])
    || receipt.summary.total !== EXPECTED_TOTAL || receipt.summary.PASS !== EXPECTED_PASS
    || receipt.summary.FAIL !== EXPECTED_FAIL || receipt.summary.UNCERTAIN !== 0
    || !Array.isArray(receipt.rows) || receipt.rows.length !== EXPECTED_TOTAL) {
    fail('source-audit outcome is not the audited 301 PASS / 3 FAIL / 0 UNCERTAIN result');
  }

  // Map opaque audit IDs back to items mechanically; a hard-coded mapping is never trusted.
  const byAuditRowId = new Map(batch.items
    .map(item => [sourceAudit.opaqueAuditRowId(batchSha256, item.itemId), item.itemId]));
  const dispositions = new Map();
  for (const row of receipt.rows) {
    if (!exactKeys(row, ['auditRowId', 'disposition', 'reason'])
      || typeof row.reason !== 'string' || row.reason.trim() === ''
      || !byAuditRowId.has(row.auditRowId) || dispositions.has(row.auditRowId)) {
      fail('source-audit rows are incomplete, stale, or duplicated');
    }
    if (!['PASS', 'FAIL', 'UNCERTAIN'].includes(row.disposition)) {
      fail(`unknown source-audit disposition: ${row.disposition}`);
    }
    dispositions.set(byAuditRowId.get(row.auditRowId), row.disposition);
  }
  if (dispositions.size !== EXPECTED_TOTAL) fail('source-audit is missing a row');

  const failed = [...dispositions.entries()]
    .filter(([, disposition]) => disposition !== 'PASS').map(([itemId]) => itemId).sort();
  if (JSON.stringify(failed) !== JSON.stringify([...EXPECTED_FAILED_ITEM_IDS])) {
    fail(`failed rows are not the audited 002 / 006 / 109 set: ${failed.join(', ')}`);
  }
  if (JSON.stringify([...receipt.failedItems.itemIds].sort())
    !== JSON.stringify([...EXPECTED_FAILED_ITEM_IDS])) {
    fail('receipt failedItems do not match the mechanically mapped failures');
  }
  verdictCache.set(cacheKey, { dispositions });
  return { batchSha256, dispositions, auditPacketSha256 };
}

function buildStrongModelReviewPacket(rawBatchBytes, receipt, root = ROOT) {
  const { batch, batchSha256, dispositions } = validateAuditReceipt(receipt, rawBatchBytes);
  const protocol = loadProtocol(root);
  const amendment = loadAmendment(root);

  const eligible = batch.items.filter(item => dispositions.get(item.itemId) === 'PASS');
  if (eligible.length !== EXPECTED_PASS) fail('eligible population is not exactly 301 rows');

  // Opaque ordering, not source item order: the packet must not leak batch position.
  const rows = eligible.map(item => ({
    reviewRowId: opaqueReviewRowId(batchSha256, item.itemId),
    selectedBundle: renderHumanReviewText(batch, item),
  })).sort((left, right) => (left.reviewRowId < right.reviewRowId ? -1 : 1));
  if (new Set(rows.map(row => row.reviewRowId)).size !== EXPECTED_PASS) {
    fail('opaque review row IDs collided');
  }

  return {
    name: PACKET_IDENTITY,
    sourceBatch: { identity: batch.name, sha256: batchSha256 },
    rendererIdentity: RENDERER_IDENTITY,
    sourceAuditAttempt: receipt.attemptId,
    reviewProtocol: { identity: protocol.protocol.protocolIdentity, sha256: protocol.sha256 },
    reviewAuthorityAmendment: {
      identity: amendment.amendment.amendmentId, sha256: amendment.sha256,
    },
    rows,
  };
}

// --- Prospective reconciliation ---------------------------------------------------------------
//
// Not executed here: no strong-model result exists yet. These are the mechanical rules the next
// step runs, implemented now so that step is mechanical rather than a fresh judgment call.
//
// The reference population is DERIVED, never supplied. A caller that could hand in an itemId,
// boundaryClass or referenceLabel could silently decide what counts as agreement and how the
// calibration sample is stratified, which would put the frozen source of truth in the caller's
// hands. So the only public entry point takes raw artifacts and derives everything itself.

function loadEffectiveCurrentCatalog(catalogBytes, root = ROOT) {
  const bytes = catalogBytes === undefined
    ? fs.readFileSync(path.join(root, CATALOG_PATH)) : Buffer.from(catalogBytes);
  const sha256 = sha256RawBytes(bytes);
  if (sha256 !== CATALOG_SHA256) fail('effective-current catalog bytes are not the pinned catalog');
  const catalog = JSON.parse(bytes.toString('utf8'));
  if (catalog.name !== CATALOG_IDENTITY || !Array.isArray(catalog.candidates)) {
    fail('effective-current catalog identity is invalid');
  }
  return { catalog, sha256 };
}

// Every field a reconciliation decision depends on comes from a frozen artifact here: the item
// from the audited batch, the skeleton from that item, and the boundary class and reference
// label from the pinned effective-current catalog.
function buildCanonicalReviewReferences(rawBatchBytes, auditReceipt, catalogBytes, root = ROOT) {
  const { batch, batchSha256, dispositions } = validateAuditReceipt(auditReceipt, rawBatchBytes);
  const { catalog, sha256 } = loadEffectiveCurrentCatalog(catalogBytes, root);
  const skeletons = new Map(catalog.candidates.map(row => [row.semanticSkeletonId, row]));

  const references = batch.items
    .filter(item => dispositions.get(item.itemId) === 'PASS')
    .map(item => {
      const skeleton = skeletons.get(item.semanticSkeletonId);
      if (!skeleton) fail(`item has no effective-current skeleton: ${item.itemId}`);
      if (!REFERENCE_LABELS.includes(skeleton.humanLabel)) {
        fail(`effective-current reference label is invalid: ${item.semanticSkeletonId}`);
      }
      return Object.freeze({
        reviewRowId: opaqueReviewRowId(batchSha256, item.itemId),
        itemId: item.itemId,
        semanticSkeletonId: item.semanticSkeletonId,
        boundaryClass: skeleton.boundaryClass,
        referenceLabel: skeleton.humanLabel,
      });
    });

  if (references.length !== EXPECTED_PASS) {
    fail(`canonical reference population is not exactly ${EXPECTED_PASS} rows`);
  }
  if (new Set(references.map(row => row.reviewRowId)).size !== EXPECTED_PASS
    || new Set(references.map(row => row.itemId)).size !== EXPECTED_PASS) {
    fail('canonical reference population is not unique');
  }
  return Object.freeze({
    batchSha256, catalogSha256: sha256, references: Object.freeze(references),
  });
}

// Artifact integrity versus row-level defects are different failures on purpose.
//
// A duplicate or unknown reviewRowId means the result artifact does not correspond to the packet
// that was issued, so nothing in it can be trusted and the whole thing fails closed. A row that
// is simply missing, or malformed while its identity is valid, is a defect in one expected
// answer; the prospective contract routes that item to HUMAN rather than discarding the run.
function validateStrongModelResults(results, references) {
  if (!Array.isArray(results)) fail('strong-model results must be an array');
  const known = new Set(references.map(row => row.reviewRowId));
  const seen = new Set();
  const byRowId = new Map();
  for (const row of results) {
    const rowId = row && typeof row === 'object' ? row.reviewRowId : undefined;
    if (typeof rowId !== 'string' || !known.has(rowId)) {
      fail(`strong-model result row is not a known batch-003 review row: ${String(rowId)}`);
    }
    if (seen.has(rowId)) fail(`strong-model result duplicates a review row: ${rowId}`);
    seen.add(rowId);
    byRowId.set(rowId, row);
  }
  return byRowId;
}

function isWellFormedResult(row) {
  return exactKeys(row, ['reviewRowId', 'disposition', 'decision', 'reason'])
    && typeof row.reason === 'string' && row.reason.trim() !== ''
    && ['KEEP', 'FIX', 'REJECT'].includes(row.disposition)
    && (row.disposition === 'KEEP'
      ? REFERENCE_LABELS.includes(row.decision)
      : row.decision === null);
}

// The only public reconciliation path. References are derived here, not accepted.
function reconcileBatch003(rawBatchBytes, auditReceipt, results, catalogBytes, root = ROOT) {
  const canonical = buildCanonicalReviewReferences(rawBatchBytes, auditReceipt, catalogBytes, root);
  const byRowId = validateStrongModelResults(results, canonical.references);

  const agreements = [];
  const humanAdjudication = [];
  for (const reference of canonical.references) {
    const row = byRowId.get(reference.reviewRowId);
    if (!row || !isWellFormedResult(row)) {
      humanAdjudication.push({ itemId: reference.itemId, route: 'MISSING_OR_INVALID_RESULT' });
      continue;
    }
    if (row.disposition !== 'KEEP') {
      humanAdjudication.push({ itemId: reference.itemId, route: row.disposition });
      continue;
    }
    if (row.decision !== reference.referenceLabel) {
      humanAdjudication.push({ itemId: reference.itemId, route: 'DECISION_DISAGREEMENT' });
      continue;
    }
    agreements.push({
      itemId: reference.itemId,
      boundaryClass: reference.boundaryClass,
      referenceLabel: reference.referenceLabel,
      provenance: 'CATALOG_STRONG_MODEL_CONFIRMED',
      eligibility: 'PROVISIONAL',
    });
  }
  return {
    batchSha256: canonical.batchSha256,
    catalogSha256: canonical.catalogSha256,
    agreements,
    humanAdjudication,
  };
}

// Production calibration entry point: the sample can only ever be drawn from rows this module
// reconciled itself, so no caller-authored boundary class or reference label reaches it.
function selectBatch003CalibrationSample(rawBatchBytes, auditReceipt, results, catalogBytes,
  root = ROOT) {
  const { agreements } = reconcileBatch003(rawBatchBytes, auditReceipt, results, catalogBytes,
    root);
  return selectCalibrationSample(agreements);
}

function calibrationHash(itemId) {
  return crypto.createHash('sha256')
    .update(`${CALIBRATION_HASH_DOMAIN}\0${itemId}`).digest('hex');
}

// Deterministic calibration sample over the clean-agreement population only. One row from every
// populated cell first, then largest-remainder over each cell's remaining population. The number
// of populated cells is whatever the agreement population actually has; it is not an invariant,
// because a disagreement can empty a cell.
function selectCalibrationSample(agreements, size = CALIBRATION_SIZE) {
  if (!Array.isArray(agreements) || agreements.length < size) {
    fail(`clean-agreement population is smaller than the ${size}-row calibration sample`);
  }
  const cells = new Map();
  for (const row of agreements) {
    // Shape guard, not a substitute for the production path: calibration is reachable in
    // production only through selectBatch003CalibrationSample, which reconciles first.
    if (!exactKeys(row, ['itemId', 'boundaryClass', 'referenceLabel', 'provenance', 'eligibility'])
      || row.provenance !== 'CATALOG_STRONG_MODEL_CONFIRMED'
      || row.eligibility !== 'PROVISIONAL'
      || !REFERENCE_LABELS.includes(row.referenceLabel)) {
      fail('calibration input is not a reconciled clean-agreement row');
    }
    const key = `${row.boundaryClass} ${row.referenceLabel}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(row);
  }
  // Canonical (boundaryClass, label) ordering decides every tie.
  const keys = [...cells.keys()].sort((left, right) => {
    const [leftClass, leftLabel] = left.split(' ');
    const [rightClass, rightLabel] = right.split(' ');
    if (leftClass !== rightClass) return leftClass < rightClass ? -1 : 1;
    return REFERENCE_LABELS.indexOf(leftLabel) - REFERENCE_LABELS.indexOf(rightLabel);
  });
  if (keys.length > size) fail('populated cells outnumber the calibration sample size');

  for (const key of keys) {
    cells.get(key).sort((left, right) => {
      const leftHash = calibrationHash(left.itemId);
      const rightHash = calibrationHash(right.itemId);
      if (leftHash !== rightHash) return leftHash < rightHash ? -1 : 1;
      return left.itemId < right.itemId ? -1 : 1;
    });
  }

  const take = new Map(keys.map(key => [key, 1]));
  let remaining = size - keys.length;
  if (remaining > 0) {
    const pool = keys.map(key => ({ key, left: cells.get(key).length - 1 }));
    const total = pool.reduce((sum, entry) => sum + entry.left, 0);
    if (total < remaining) fail('clean-agreement cells cannot fill the calibration sample');
    const quotas = pool.map(entry => ({
      key: entry.key,
      whole: Math.floor((entry.left * remaining) / total),
      remainder: (entry.left * remaining) % total,
      left: entry.left,
    }));
    for (const quota of quotas) {
      const grant = Math.min(quota.whole, quota.left);
      take.set(quota.key, take.get(quota.key) + grant);
      quota.left -= grant;
      remaining -= grant;
    }
    // Largest remainder, ties broken by the canonical cell order the keys already carry.
    const ranked = quotas.filter(quota => quota.left > 0)
      .sort((left, right) => right.remainder - left.remainder
        || keys.indexOf(left.key) - keys.indexOf(right.key));
    let cursor = 0;
    while (remaining > 0) {
      if (!ranked.length) fail('clean-agreement cells cannot fill the calibration sample');
      const entry = ranked[cursor % ranked.length];
      if (entry.left > 0) {
        take.set(entry.key, take.get(entry.key) + 1);
        entry.left -= 1;
        remaining -= 1;
      }
      cursor += 1;
      if (cursor > ranked.length * size) fail('calibration allocation did not converge');
    }
  }

  const selected = keys.flatMap(key => cells.get(key).slice(0, take.get(key)));
  if (selected.length !== size) fail('calibration selection did not produce the exact size');
  return selected.sort((left, right) => (left.itemId < right.itemId ? -1 : 1));
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--input', '--audit-receipt', '--output'].includes(flag)
      || !value || Object.hasOwn(values, flag)) {
      throw new Error('Usage: --input <surface-batch.json> --audit-receipt <receipt.json> --output <review-packet.json>');
    }
    values[flag] = value;
  }
  if (!values['--input'] || !values['--audit-receipt'] || !values['--output']) {
    throw new Error('Usage: --input <surface-batch.json> --audit-receipt <receipt.json> --output <review-packet.json>');
  }
  return {
    inputPath: values['--input'],
    receiptPath: values['--audit-receipt'],
    outputPath: values['--output'],
  };
}

function writeStrongModelReviewPacket(inputPath, receiptPath, outputPath) {
  if (fs.existsSync(outputPath)) throw new Error(`Existing output will not be overwritten: ${outputPath}`);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  const packet = buildStrongModelReviewPacket(fs.readFileSync(inputPath), receipt);
  fs.writeFileSync(outputPath, packetBytes(packet), { flag: 'wx' });
  return packet;
}

function main(argv = process.argv.slice(2)) {
  const { inputPath, receiptPath, outputPath } = parseArgs(argv);
  writeStrongModelReviewPacket(inputPath, receiptPath, outputPath);
  process.stdout.write(`Built P1-B6 batch-003 strong-model review packet: ${outputPath}\n`);
  return 0;
}

module.exports = {
  AMENDMENT_IDENTITY,
  AUDITED_BATCH_SHA256,
  AUDIT_ATTEMPT_ID,
  CALIBRATION_HASH_DOMAIN,
  CALIBRATION_SIZE,
  EXPECTED_FAILED_ITEM_IDS,
  EXPECTED_PASS,
  PACKET_IDENTITY,
  PROTOCOL_IDENTITY,
  PROTOCOL_PATH,
  CATALOG_IDENTITY,
  CATALOG_SHA256,
  buildCanonicalReviewReferences,
  buildStrongModelReviewPacket,
  calibrationHash,
  loadAmendment,
  loadEffectiveCurrentCatalog,
  loadProtocol,
  main,
  opaqueReviewRowId,
  packetBytes,
  parseArgs,
  reconcileBatch003,
  selectBatch003CalibrationSample,
  selectCalibrationSample,
  validateStrongModelResults,
  validateAuditReceipt,
  writeStrongModelReviewPacket,
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`P1-B6 batch-003 strong-model review packet build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
