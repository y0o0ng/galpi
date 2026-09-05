#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const {
  PHASES, RUNTIME, TIMEOUT_MS, endpointUrls, preflight, invokeStage,
  stageRecord, skipAfter, scoreArmCase, summarizeCalls, summarizeArm,
} = require('./run-memory-inference-p1b3-decomposed-pipeline');
const {
  TRANSITIONS, pairedTransition,
} = require('./combine-memory-inference-p1b3-decomposed-pipeline');

const ROOT = path.resolve(__dirname, '..');
const RUNNER_VERSION = 'xion-local-memory-inference-p1b4-role-split-hybrid-runner-v2';
const SCORING_VERSION = 'xion-local-memory-inference-p1b4-role-split-hybrid-scoring-v1';
const REPORT_VERSION = 'xion-local-memory-inference-p1b4-role-split-hybrid-report-v2';
const {
  SOURCE_COMMIT, SOURCE_ARTIFACTS, INPUT_SHA256, check, validateSourceReports, loadSources,
  validateAmbiguityReport,
} = require('./run-memory-inference-p1b4-ambiguity-recalibration');

async function runHybridCase(candidate, humanGold, extractionGold, sourceAmbiguity, options, counts) {
  const stages = { ambiguity: structuredClone(sourceAmbiguity) };
  const stageOrigins = { ambiguity: 'REUSED_P1B4A' };
  let previous = stages.ambiguity;
  for (const stageId of ['binary', 'extraction']) {
    const skipReason = skipAfter(previous);
    stages[stageId] = skipReason === null
      ? await invokeStage(stageId, candidate, { ...options, model: PHASES['4b'].model }, counts)
      : stageRecord(stageId, candidate, skipReason);
    stageOrigins[stageId] = stages[stageId].invoked ? 'NEW' : 'SKIPPED';
    previous = stages[stageId];
  }
  // HYBRID has exactly the existing D-arm topology/scoring. This does not
  // execute Stage 1 again: the only possible new calls above are 4B downstream.
  return { ...scoreArmCase('D1.7', stages, humanGold, extractionGold), stageOrigins };
}

function progression(baseline, hybrid, paired, runtimeFailures) {
  const conditions = {
    zeroRuntimeFailures: runtimeFailures === 0,
    endToEndNotWorse: hybrid.endToEndSuccess >= baseline.endToEndSuccess,
    moreFixesThanRegressions: paired.FIXED > paired.REGRESSION,
    unsafeNonEscalationNotWorse: hybrid.unsafeNonEscalation <= baseline.unsafeNonEscalation,
    falseNoWriteNotWorse: hybrid.falseNoWrite <= baseline.falseNoWrite,
    schemaValidExtractionWrongValueNotWorse:
      hybrid.schemaValidExtractionWrongValue <= baseline.schemaValidExtractionWrongValue,
  };
  return {
    conditions,
    finalDisposition: runtimeFailures > 0 ? 'INDETERMINATE_RUNTIME'
      : Object.values(conditions).every(Boolean) ? 'RAW_EPISODE_SUCCESSOR_OPEN'
        : 'NO_RAW_EPISODE_SUCCESSOR_SIGNAL',
  };
}

async function runHybrid(options) {
  check(Object.keys(options).every(key => ['endpoint', 'ambiguityReport', 'commit', 'fetchImpl'].includes(key)),
    'unsupported runner option');
  const commit = options.commit ?? execFileSync('git', ['rev-parse', 'HEAD'],
    { cwd: ROOT, encoding: 'utf8' }).trim();
  check(/^[a-f0-9]{40}$/u.test(commit), 'commit must be a full Galpi SHA');
  check(typeof options.ambiguityReport === 'string' && options.ambiguityReport.length > 0, 'ambiguity-report is required');
  const source = loadSources();
  const { inputs, combined, provenance } = source;
  const ambiguityBytes = fs.readFileSync(options.ambiguityReport);
  const ambiguityReport = validateAmbiguityReport(JSON.parse(ambiguityBytes), source);
  check(ambiguityReport.galpiCommit === commit, 'B4A/B4B experiment commit mismatch');
  if (ambiguityReport.execution.runtimeFailures !== 0) {
    throw Object.assign(new Error('P1-B4A source comparison INDETERMINATE_RUNTIME'),
      { code: 'INDETERMINATE_RUNTIME' });
  }
  const urls = endpointUrls(options.endpoint);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const readiness = await preflight(urls.health, fetchImpl);
  const counts = { callsPlanned: 0, callsAttempted: 0, callsCompleted: 0,
    invalidStructuredOutputs: 0, runtimeFailures: 0 };
  const paired = Object.fromEntries(TRANSITIONS.map(category => [category, 0]));
  const observations = [];
  for (const [index, candidate] of inputs.candidates.cases.entries()) {
    const source = combined.observations[index];
    const humanGoldLabel = inputs.human.labels[index].label;
    const hybrid = await runHybridCase(candidate, humanGoldLabel,
      inputs.authoring.cases[candidate.caseId].extractionGold,
      ambiguityReport.observations[index].ambiguity,
      { endpoint: urls.completion, fetchImpl }, counts);
    const transition = pairedTransition(source.arms.L4, hybrid);
    paired[transition] += 1;
    observations.push({ caseId: candidate.caseId, humanGoldLabel, arms: { HYBRID: hybrid },
      baselineL4: source.arms.L4, transition });
  }
  const cases = observations.map(row => row.arms.HYBRID);
  const hybridSummary = summarizeArm('D1.7', cases);
  const sourceCalls = summarizeCalls(cases.map(row => row.stages.ambiguity));
  const newStages = Object.fromEntries(['binary', 'extraction'].map(id => [
    id, summarizeCalls(cases.map(row => row.stages[id])),
  ]));
  const runtimeFailures = combined.runtimeFailures + ambiguityReport.execution.runtimeFailures + counts.runtimeFailures;
  const decision = progression(combined.armSummaries.L4, hybridSummary, paired, runtimeFailures);
  return {
    reportVersion: REPORT_VERSION, runnerVersion: RUNNER_VERSION, scoringVersion: SCORING_VERSION,
    generatedAt: new Date().toISOString(), galpiCommit: commit,
    diagnosticType: 'ADAPTIVE_CONSUMED_FIXTURE', inputs: inputs.provenance,
    source: { galpiCommit: SOURCE_COMMIT, artifacts: provenance,
      ambiguityArm: 'P1-B4A', ambiguityModel: PHASES['1.7b'].model,
      ambiguityReport: { identity: ambiguityReport.reportVersion,
        runnerVersion: ambiguityReport.runnerVersion, scoringVersion: ambiguityReport.scoringVersion,
        promptVersion: ambiguityReport.promptVersion, galpiCommit: ambiguityReport.galpiCommit,
        sha256: createHash('sha256').update(ambiguityBytes).digest('hex'), revalidated: true },
      baselineArm: 'L4', combinedRecomputed: true, runtimeFailures: combined.runtimeFailures },
    model: PHASES['4b'].model, runtime: RUNTIME, timeoutMs: TIMEOUT_MS,
    automaticReruns: false, preflight: readiness,
    execution: {
      casesPlanned: 60, sourceAmbiguityCallsReused: 60,
      newCallsPlanned: counts.callsPlanned, newCallsAttempted: counts.callsAttempted,
      newCallsCompleted: counts.callsCompleted,
      newInvalidStructuredOutputs: counts.invalidStructuredOutputs,
      newRuntimeFailures: counts.runtimeFailures,
      sourceAmbiguity: sourceCalls, newStages,
      counterfactualHybridStageCalls: sourceCalls.callsAttempted + counts.callsAttempted,
      latencyBasis: 'Reused P1-B4A ambiguity plus new P1-B4B stages; counterfactual, not wall-clock server-switch latency',
    },
    observations, armSummaries: { HYBRID: hybridSummary }, baselineL4Summary: combined.armSummaries.L4,
    pairedComparisons: { 'L4->HYBRID': paired }, runtimeFailures,
    progressionRule: decision.conditions, finalDisposition: decision.finalDisposition,
  };
}

function parseArguments(argv) {
  const options = {};
  const names = { '--endpoint': 'endpoint', '--ambiguity-report': 'ambiguityReport', '--commit': 'commit' };
  for (let index = 0; index < argv.length; index += 2) {
    const key = names[argv[index]];
    check(key && !Object.hasOwn(options, key) && argv[index + 1]
      && !argv[index + 1].startsWith('--'), 'expected --endpoint URL --ambiguity-report PATH [--commit SHA]');
    options[key] = argv[index + 1];
  }
  check(options.endpoint && options.ambiguityReport, 'endpoint and ambiguity-report are required');
  endpointUrls(options.endpoint);
  if (options.commit !== undefined) check(/^[a-f0-9]{40}$/u.test(options.commit), 'invalid commit SHA');
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const report = await runHybrid(parseArguments(argv));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.finalDisposition === 'INDETERMINATE_RUNTIME' ? 1 : 0;
}

module.exports = {
  RUNNER_VERSION, SCORING_VERSION, REPORT_VERSION, SOURCE_COMMIT, SOURCE_ARTIFACTS, INPUT_SHA256,
  validateSourceReports, loadSources, runHybridCase, progression, runHybrid, parseArguments, main,
};

if (require.main === module) {
  main().then(code => { process.exitCode = code; }, error => {
    console.error(`P1-B4 runner failed: ${error.message}`);
    process.exitCode = 1;
  });
}
