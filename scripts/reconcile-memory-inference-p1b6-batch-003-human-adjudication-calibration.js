#!/usr/bin/env node
'use strict';

// Reconciles the executed batch-003 combined blind HUMAN review (attempt 001) into a receipt.
//
// Hidden roles come only from the authorized population, which needs the exact raw strong-model
// result bytes; the HUMAN result file cannot supply them. The HUMAN bytes are hashed before
// parsing and must be the reviewed artifact. Classification is the preregistered
// reconcileHumanResults; nothing here reimplements it.
//
// It repairs nothing, accepts nothing, freezes nothing and selects nothing.

const fs = require('node:fs');
const { sha256RawBytes } = require('../lib/memory-inference-p1b6-skeletons');
const strongModel = require('./build-memory-inference-p1b6-batch-003-strong-model-review-packet');
const combined = require('./build-memory-inference-p1b6-batch-003-human-adjudication-calibration-packet');

const ATTEMPT_ID = 'p1b6-batch-003-human-adjudication-calibration-attempt-001';
const RECEIPT_NAME = `xion-local-memory-inference-${ATTEMPT_ID}-receipt-v1`;
const HUMAN_RESULT_FILENAME = 'p1b6-batch-003-human-adjudication-calibration-results.json';
const HUMAN_RESULT_SHA256 = '2515be0eb8b48b313ee6ae3080cbd293332fd4cc6188a04cb76dab4aec8c98ad';
const PACKET_SHA256 = '4750a467b521975f60f6bf5fd776ff6cfd80ad5be1efa04a485e389532988ed0';
const TEMPLATE_REASON = /^Reviewer marked (CLEAR|ESCALATE); no additional reason provided\.$/u;
const STRONG_MODEL_ATTEMPT_ID = 'p1b6-strong-model-semantic-review-batch-003-attempt-001';

function fail(message) {
  throw new TypeError(`P1-B6 batch-003 HUMAN reconciliation ${message}`);
}

function tally(values) {
  return values.reduce((totals, value) => {
    totals[value] = (totals[value] ?? 0) + 1;
    return totals;
  }, {});
}

function buildReceipt(rawBatchBytes, auditReceipt, rawStrongModelResultBytes, rawHumanResultBytes) {
  // Bind the exact reviewed bytes before anything parses them.
  if (!Buffer.isBuffer(rawHumanResultBytes)
    || sha256RawBytes(rawHumanResultBytes) !== HUMAN_RESULT_SHA256) {
    fail('HUMAN result bytes are not the reviewed attempt-001 artifact');
  }
  const populations = combined.derivePopulations(rawBatchBytes, auditReceipt,
    rawStrongModelResultBytes);
  const packet = combined.buildPacketFromPopulations(populations);
  const packetSha256 = sha256RawBytes(strongModel.packetBytes(packet));
  if (packetSha256 !== PACKET_SHA256) fail('authorized population no longer renders the issued packet');

  const out = combined.reconcileHumanResults(populations, rawHumanResultBytes);
  const rows = [...out.adjudication, ...out.calibration];
  if (out.adjudication.length !== 34 || out.calibration.length !== 32) {
    fail('hidden composition is not 34 adjudication + 32 calibration');
  }
  const { protocol, sha256: protocolSha256 } = combined.loadProtocol();
  const batch = JSON.parse(Buffer.from(rawBatchBytes).toString('utf8'));
  const resolutionRequired = rows.filter(row => row.eligibility === 'INELIGIBLE')
    .sort((left, right) => (left.itemId < right.itemId ? -1 : 1));
  const mismatchesBySkeleton = {};
  for (const row of resolutionRequired) {
    (mismatchesBySkeleton[row.semanticSkeletonId] ??= []).push(row.itemId);
  }

  return {
    name: RECEIPT_NAME,
    attemptId: ATTEMPT_ID,
    status: resolutionRequired.length ? 'COMPLETE_NEEDS_RESOLUTION' : 'COMPLETE_RECONCILED_CLEAN',
    reviewProtocol: { identity: protocol.protocolIdentity, sha256: protocolSha256 },
    reviewPacket: {
      identity: packet.name, sha256: packetSha256, rows: packet.rows.length, committed: false,
    },
    reviewedSourceBatch: { identity: batch.name, rawSha256: populations.batchSha256 },
    sourceAuditAttempt: strongModel.AUDIT_ATTEMPT_ID,
    strongModelReconciliation: {
      attemptId: STRONG_MODEL_ATTEMPT_ID,
      rawResultSha256: combined.STRONG_MODEL_RESULT_SHA256,
      rawResultCommitted: false,
    },
    currentReferenceAuthority: {
      identity: strongModel.CATALOG_IDENTITY, rawSha256: populations.catalogSha256,
    },
    rawHumanResultArtifact: {
      filename: HUMAN_RESULT_FILENAME, sha256: out.humanResultSha256, committed: false,
      note: 'Decisions and reasons are carried verbatim per row below; the raw bytes are bound by SHA and not committed.',
    },
    decisionsSource: 'REPOSITORY_OWNER_BLIND_HUMAN_REVIEWER',
    reviewIndependence: {
      packetBlindToRowRole: true,
      packetCarriedNoReferenceLabelModelDecisionOrRoutingReason: true,
      roleMappingRecomputableFromCommittedArtifacts: true,
      note: 'Blindness is at packet level. Row roles are a deterministic function of committed artifacts; whether the reviewer consulted them is not recorded and is not claimed either way.',
    },
    rawResultSummary: {
      total: rows.length,
      dispositions: tally(rows.map(row => row.humanDisposition)),
      decisions: tally(rows.filter(row => row.humanDecision).map(row => row.humanDecision)),
    },
    // Verbatim reasons are kept as given; this only counts the one exact template that carries
    // no semantic reason, so later repair analysis knows which rows have no stated rationale.
    templateReasons: {
      pattern: 'Reviewer marked <CLEAR|ESCALATE>; no additional reason provided.',
      count: rows.filter(row => TEMPLATE_REASON.test(row.humanReason)).length,
      amongResolutionRequired: resolutionRequired
        .filter(row => TEMPLATE_REASON.test(row.humanReason)).length,
    },
    composition: { total: rows.length, mandatoryAdjudication: 34, calibration: 32 },
    reconciliation: {
      adjudication: out.summary.adjudication,
      calibration: out.summary.calibration,
      eligibility: tally(rows.map(row => `${row.eligibility}${row.provenance ? ` ${row.provenance}` : ''}`)),
      resolutionRequiredItemIds: resolutionRequired.map(row => row.itemId),
      resolutionRequiredBySkeleton: mismatchesBySkeleton,
    },
    adjudicationRows: out.adjudication,
    calibrationRows: out.calibration,
    unsampledAgreements: {
      count: out.unreviewedAgreements.length,
      provenance: 'CATALOG_STRONG_MODEL_CONFIRMED',
      eligibility: 'PROVISIONAL',
      calibrationExtrapolated: false,
      allUnchanged: out.unreviewedAgreements.every(row => row.provenance
        === 'CATALOG_STRONG_MODEL_CONFIRMED' && row.eligibility === 'PROVISIONAL'),
      itemIds: out.unreviewedAgreements.map(row => row.itemId).sort(),
    },
    authority: {
      humanReviewExecuted: true,
      calibrationExtrapolatedToUnsampledRows: false,
      calibrationPromotedToHumanAdjudicated: false,
      catalogAmended: false,
      referenceLabelsChanged: false,
      surfacesRepaired: false,
      surfaceAcceptancePerformed: false,
      referenceLabelFreezePerformed: false,
      finalSelectionPerformed: false,
      heldSecondReviewPerformed: false,
      trainingOrEvaluationOccurred: false,
    },
  };
}

function receiptBytes(receipt) {
  return Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
}

function main(argv = process.argv.slice(2)) {
  const flags = ['--input', '--audit-receipt', '--strong-model-results', '--human-results', '--output'];
  const usage = `Usage: ${flags.map(flag => `${flag} <path>`).join(' ')}`;
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!flags.includes(argv[index]) || !argv[index + 1] || Object.hasOwn(values, argv[index])) {
      throw new Error(usage);
    }
    values[argv[index]] = argv[index + 1];
  }
  if (flags.some(flag => !values[flag])) throw new Error(usage);
  const output = values['--output'];
  if (fs.existsSync(output)) throw new Error(`Existing output will not be overwritten: ${output}`);
  const receipt = buildReceipt(fs.readFileSync(values['--input']),
    JSON.parse(fs.readFileSync(values['--audit-receipt'], 'utf8')),
    fs.readFileSync(values['--strong-model-results']), fs.readFileSync(values['--human-results']));
  fs.writeFileSync(output, receiptBytes(receipt), { flag: 'wx' });
  process.stdout.write(`Wrote ${output} (${receipt.status})\n`);
  return 0;
}

module.exports = {
  ATTEMPT_ID, HUMAN_RESULT_SHA256, PACKET_SHA256, buildReceipt, main, receiptBytes,
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`P1-B6 batch-003 HUMAN reconciliation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
