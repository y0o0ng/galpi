#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const {
  RUNNER_VERSION, SCORING_VERSION, PHASES, RUNTIME, TIMEOUT_MS, PREFLIGHT_TIMEOUT_MS,
  check, exactKeys, loadInputs, stageIds, stageRecord, stageContract, skipAfter,
  parseStageContent, scoreArmCase, summarizeCalls, summarizeArm,
} = require('./run-memory-inference-p1b3-decomposed-pipeline');

const COMBINER_VERSION = 'xion-local-memory-inference-p1b3-decomposed-pipeline-combiner-v1';
const COMBINED_REPORT_VERSION = 'xion-local-memory-inference-p1b3-decomposed-pipeline-combined-report-v1';
const TRANSITIONS = Object.freeze([
  'UNCHANGED_CORRECT', 'FIXED', 'REGRESSION', 'UNCHANGED_WRONG', 'NONCOMPARABLE_RUNTIME',
]);

function same(actual, expected, message) {
  check(isDeepStrictEqual(actual, expected), `report mismatch: ${message}`);
}

function validateArmResult(arm, result, candidate, humanGold, extractionGold) {
  same(Object.keys(result.stages), stageIds(arm), `${arm} stage IDs/order`);
  let previous;
  for (const id of stageIds(arm)) {
    const recorded = result.stages[id];
    const skipReason = skipAfter(previous);
    const expected = stageRecord(id, candidate, skipReason);
    if (skipReason === null) {
      check(Number.isFinite(recorded.latencyMs) && recorded.latencyMs >= 0, 'invalid stage latency');
      expected.attempted = true;
      expected.latencyMs = recorded.latencyMs;
      if (typeof recorded.rawAssistantContent === 'string') {
        expected.completed = true;
        expected.rawAssistantContent = recorded.rawAssistantContent;
        Object.assign(expected, parseStageContent(recorded.rawAssistantContent,
          stageContract(id, candidate).specification));
      } else {
        const error = recorded.runtimeError;
        check(exactKeys(error, ['state', 'code']) && (
          (error.state === 'TIMEOUT' && error.code === 'LOCAL_ENDPOINT_TIMEOUT')
          || (error.state === 'UNAVAILABLE' && error.code === 'LOCAL_ENDPOINT_UNAVAILABLE')
          || (error.state === 'RUNNER_ERROR' && (
            ['LOCAL_RUNTIME_FAILURE', 'LOCAL_RUNTIME_INVALID_JSON', 'LOCAL_RUNTIME_RESPONSE_INVALID'].includes(error.code)
            || /^LOCAL_HTTP_\d{3}$/u.test(error.code)
          ))
        ), 'invalid runtime error');
        expected.runtimeError = error;
      }
    }
    same(recorded, expected, `${arm}/${candidate.caseId}/${id} stage contract/control flow`);
    previous = expected;
  }
  const rescored = scoreArmCase(arm, result.stages, humanGold, extractionGold);
  same(result, rescored, `${arm}/${candidate.caseId} scoring`);
  return rescored;
}

function validatePhaseReport(report, phaseId, inputs) {
  const phase = PHASES[phaseId];
  same(report.reportVersion, phase.reportVersion, 'report version');
  same(report.phase, phaseId, 'phase');
  same(report.runnerVersion, RUNNER_VERSION, 'runner version');
  same(report.scoringVersion, SCORING_VERSION, 'scoring version');
  check(/^[a-f0-9]{40}$/u.test(report.galpiCommit), 'invalid report commit');
  check(typeof report.generatedAt === 'string' && Number.isFinite(Date.parse(report.generatedAt)),
    'invalid report generation timestamp');
  same(report.inputs, inputs.provenance, 'frozen input identities/SHA-256');
  same(report.model, phase.model, 'frozen model configuration');
  same(report.runtime, RUNTIME, 'runtime family/version');
  same(report.timeoutMs, TIMEOUT_MS, 'timeout');
  same(report.automaticReruns, false, 'automatic reruns');
  same(report.preflight, { success: true, status: 'ok', timeoutMs: PREFLIGHT_TIMEOUT_MS }, 'preflight');
  same(report.observations.map(row => row.caseId), inputs.candidates.cases.map(row => row.caseId), 'case IDs/order');
  for (const [index, row] of report.observations.entries()) {
    same(Object.keys(row.arms), phase.arms, 'arm IDs/order');
    const humanGold = inputs.human.labels[index].label;
    same(row.humanGoldLabel, humanGold, 'resolved HUMAN gold');
    for (const arm of phase.arms) {
      validateArmResult(arm, row.arms[arm], inputs.candidates.cases[index], humanGold,
        inputs.authoring.cases[row.caseId].extractionGold);
    }
  }
  const counts = summarizeCalls(report.observations.flatMap(row => (
    phase.arms.flatMap(arm => Object.values(row.arms[arm].stages))
  )));
  same(report.execution, {
    casesPlanned: 60, maxPossibleCalls: phase.maxPossibleCalls,
    callsPlanned: counts.callsPlanned, callsAttempted: counts.callsAttempted,
    callsCompleted: counts.callsCompleted, invalidStructuredOutputs: counts.invalidStructuredOutputs,
    runtimeFailures: counts.runtimeFailures,
  }, 'call counts');
  const summaries = Object.fromEntries(phase.arms.map(arm => [
    arm, summarizeArm(arm, report.observations.map(row => row.arms[arm])),
  ]));
  same(report.armSummaries, summaries, 'arm summaries');
  return report;
}

function pairedTransition(left, right) {
  if (left.runtimeFailures || right.runtimeFailures) return 'NONCOMPARABLE_RUNTIME';
  if (left.endToEndSuccess && right.endToEndSuccess) return 'UNCHANGED_CORRECT';
  if (!left.endToEndSuccess && right.endToEndSuccess) return 'FIXED';
  if (left.endToEndSuccess && !right.endToEndSuccess) return 'REGRESSION';
  return 'UNCHANGED_WRONG';
}

function combineReports(report4b, report1p7b) {
  // Recompute from stage evidence and frozen inputs, never trust supplied score/count flags.
  const inputs = loadInputs();
  validatePhaseReport(report4b, '4b', inputs);
  validatePhaseReport(report1p7b, '1.7b', inputs);
  same(report4b.galpiCommit, report1p7b.galpiCommit, 'Galpi commits');
  const pairs = [['L4', 'D4'], ['D4', 'D1.7'], ['L4', 'D1.7']];
  const pairedComparisons = Object.fromEntries(pairs.map(([left, right]) => [
    `${left}->${right}`, Object.fromEntries(TRANSITIONS.map(category => [category, 0])),
  ]));
  const observations = report4b.observations.map((row, index) => {
    const arms = { ...row.arms, ...report1p7b.observations[index].arms };
    const transitions = {};
    for (const [left, right] of pairs) {
      const pair = `${left}->${right}`;
      transitions[pair] = pairedTransition(arms[left], arms[right]);
      pairedComparisons[pair][transitions[pair]] += 1;
    }
    return { caseId: row.caseId, humanGoldLabel: row.humanGoldLabel, arms, transitions };
  });
  const armSummaries = Object.fromEntries(['L4', 'D4', 'D1.7'].map(arm => [
    arm, summarizeArm(arm, observations.map(row => row.arms[arm])),
  ]));
  const runtimeFailures = Object.values(armSummaries).reduce((sum, arm) => sum + arm.runtimeFailures, 0);
  const d = armSummaries['D1.7'];
  const netSuccessfulCases = d.endToEndSuccess - armSummaries.L4.endToEndSuccess;
  const trainingTrigger = {
    rule: 'D1.7 end-to-end success rate minus L4 end-to-end success rate >= 10 percentage points',
    deltaPercentagePoints: netSuccessfulCases * 100 / 60,
    netSuccessfulCases,
    zeroRuntimeFailures: runtimeFailures === 0,
    zeroUnsafeNonEscalation: d.unsafeNonEscalation === 0,
    zeroFalseNoWrite: d.falseNoWrite === 0,
    zeroSchemaValidExtractionWrongValue: d.schemaValidExtractionWrongValue === 0,
    atLeastTenPercentagePoints: netSuccessfulCases >= 6,
    moreFixesThanRegressions: pairedComparisons['L4->D1.7'].FIXED > pairedComparisons['L4->D1.7'].REGRESSION,
  };
  const signal = trainingTrigger.zeroUnsafeNonEscalation && trainingTrigger.zeroFalseNoWrite
    && trainingTrigger.zeroSchemaValidExtractionWrongValue && trainingTrigger.atLeastTenPercentagePoints
    && trainingTrigger.moreFixesThanRegressions;
  return {
    reportVersion: COMBINED_REPORT_VERSION, combinerVersion: COMBINER_VERSION,
    runnerVersion: RUNNER_VERSION, scoringVersion: SCORING_VERSION, galpiCommit: report4b.galpiCommit,
    inputs: inputs.provenance, runtime: RUNTIME, timeoutMs: TIMEOUT_MS, automaticReruns: false,
    sourceReports: [report4b, report1p7b].map(report => ({
      reportVersion: report.reportVersion, phase: report.phase, generatedAt: report.generatedAt,
      model: report.model, preflight: report.preflight, execution: report.execution,
    })),
    observations, armSummaries, pairedComparisons, runtimeFailures, trainingTrigger,
    finalDisposition: runtimeFailures > 0 ? 'INDETERMINATE_RUNTIME'
      : signal ? 'SPECIALIZED_TRAINING_WORTH_INVESTIGATING' : 'NO_SPECIALIZED_TRAINING_SIGNAL',
  };
}

function parseArguments(argv) {
  const options = {};
  const names = { '--4b-report': 'report4b', '--1p7b-report': 'report1p7b' };
  for (let index = 0; index < argv.length; index += 2) {
    const key = names[argv[index]];
    check(key && !Object.hasOwn(options, key) && argv[index + 1]
      && !argv[index + 1].startsWith('--'), 'expected --4b-report PATH --1p7b-report PATH');
    options[key] = argv[index + 1];
  }
  check(options.report4b && options.report1p7b, 'both phase reports are required');
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const combined = combineReports(
    JSON.parse(fs.readFileSync(options.report4b, 'utf8')),
    JSON.parse(fs.readFileSync(options.report1p7b, 'utf8')),
  );
  process.stdout.write(`${JSON.stringify(combined, null, 2)}\n`);
  return combined.finalDisposition === 'INDETERMINATE_RUNTIME' ? 1 : 0;
}

module.exports = {
  COMBINER_VERSION, COMBINED_REPORT_VERSION, TRANSITIONS,
  validatePhaseReport, pairedTransition, combineReports, parseArguments, main,
};

if (require.main === module) {
  try { process.exitCode = main(); } catch (error) {
    console.error(`P1-B3 combination failed: ${error.message}`);
    process.exitCode = 1;
  }
}
