#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const {
  PHASES, RUNTIME, TIMEOUT_MS, loadInputs, endpointUrls, preflight, invokeStage,
  stageRecord, skipAfter, scoreArmCase, summarizeCalls, summarizeArm,
} = require('./run-memory-inference-p1b3-decomposed-pipeline');
const {
  TRANSITIONS, combineReports, pairedTransition,
} = require('./combine-memory-inference-p1b3-decomposed-pipeline');

const ROOT = path.resolve(__dirname, '..');
const RUNNER_VERSION = 'xion-local-memory-inference-p1b4-role-split-hybrid-runner-v1';
const SCORING_VERSION = 'xion-local-memory-inference-p1b4-role-split-hybrid-scoring-v1';
const REPORT_VERSION = 'xion-local-memory-inference-p1b4-role-split-hybrid-report-v1';
const SOURCE_COMMIT = '5b1c54cc97faada4a11afd2bb2132f2596f2f751';
const SOURCE_ARTIFACTS = Object.freeze({
  report4b: Object.freeze({ file: 'fixtures/local-memory-inference-p1b3-4b-report.json',
    sha256: 'f1a438f0c72a0243d00f0d9ebfb41ceea9761e05d83e22a063a150a53fed089d' }),
  report1p7b: Object.freeze({ file: 'fixtures/local-memory-inference-p1b3-1p7b-report.json',
    sha256: '56d5d74795883d250c5d9249f2e1060a48ef06754b940059254ec8fd38c1a4fc' }),
  combined: Object.freeze({ file: 'fixtures/local-memory-inference-p1b3-combined-report.json',
    sha256: 'af1fb7a45f30003aa19551700ba41c1ad3e8612982934d8033f09bf6155d9f79' }),
});
const INPUT_SHA256 = Object.freeze({
  candidates: 'a6608642caad02c772941d58558bd9fc31ee86ef54fe342ee2713aa08cf62c8e',
  human: 'a6444c5fc4460cc499c3ac64060b4e87d9e7bed984b05376cae08655fb499f5d',
  authoring: 'e1ef730de0341fa3314e20425afefc38cfedeb59642be018c407d433646240ae',
});

function check(condition, message) {
  if (!condition) throw new TypeError(`P1-B4 ${message}`);
}

function validateSourceReports(reports, inputs = loadInputs()) {
  for (const [key, sha256] of Object.entries(INPUT_SHA256)) {
    check(inputs.provenance[key].sha256 === sha256, `${key} frozen input SHA-256 mismatch`);
  }
  // The frozen combiner validates both phases, reparses raw stage outputs, and
  // recomputes every score/count against the current exact frozen input bytes.
  const combined = combineReports(reports.report4b, reports.report1p7b);
  check(combined.galpiCommit === SOURCE_COMMIT, 'source execution commit mismatch');
  check(isDeepStrictEqual(combined, reports.combined), 'source combined report mismatch');
  if (combined.runtimeFailures !== 0) {
    // Fail before readiness or any new inference; never repair/rerun Stage 1.
    throw Object.assign(new Error('P1-B4 source comparison INDETERMINATE_RUNTIME'),
      { code: 'INDETERMINATE_RUNTIME' });
  }
  return combined;
}

function loadSources() {
  const inputs = loadInputs();
  const reports = {};
  const provenance = {};
  for (const [key, artifact] of Object.entries(SOURCE_ARTIFACTS)) {
    const bytes = fs.readFileSync(path.join(ROOT, artifact.file));
    reports[key] = JSON.parse(bytes);
    provenance[key] = { file: artifact.file, identity: reports[key].reportVersion,
      sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  const combined = validateSourceReports(reports, inputs);
  for (const [key, artifact] of Object.entries(SOURCE_ARTIFACTS)) {
    check(provenance[key].sha256 === artifact.sha256, `${key} source artifact bytes changed`);
  }
  return { inputs, combined, provenance };
}

async function runHybridCase(candidate, humanGold, extractionGold, sourceAmbiguity, options, counts) {
  const stages = { ambiguity: structuredClone(sourceAmbiguity) };
  const stageOrigins = { ambiguity: 'REUSED' };
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
  // execute a D1.7 arm: the only possible new calls above are 4B downstream.
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
  check(Object.keys(options).every(key => ['endpoint', 'commit', 'fetchImpl'].includes(key)),
    'unsupported runner option');
  const commit = options.commit ?? execFileSync('git', ['rev-parse', 'HEAD'],
    { cwd: ROOT, encoding: 'utf8' }).trim();
  check(/^[a-f0-9]{40}$/u.test(commit), 'commit must be a full Galpi SHA');
  const { inputs, combined, provenance } = loadSources();
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
      source.arms['D1.7'].stages.ambiguity,
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
  const runtimeFailures = combined.runtimeFailures + counts.runtimeFailures;
  const decision = progression(combined.armSummaries.L4, hybridSummary, paired, runtimeFailures);
  return {
    reportVersion: REPORT_VERSION, runnerVersion: RUNNER_VERSION, scoringVersion: SCORING_VERSION,
    generatedAt: new Date().toISOString(), galpiCommit: commit,
    diagnosticType: 'ADAPTIVE_CONSUMED_FIXTURE', inputs: inputs.provenance,
    source: { galpiCommit: SOURCE_COMMIT, artifacts: provenance,
      ambiguityArm: 'D1.7', ambiguityModel: PHASES['1.7b'].model,
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
      latencyBasis: 'Recorded source ambiguity plus invoked new stages; excludes model load/server switch',
    },
    observations, armSummaries: { HYBRID: hybridSummary }, baselineL4Summary: combined.armSummaries.L4,
    pairedComparisons: { 'L4->HYBRID': paired }, runtimeFailures,
    progressionRule: decision.conditions, finalDisposition: decision.finalDisposition,
  };
}

function parseArguments(argv) {
  const options = {};
  const names = { '--endpoint': 'endpoint', '--commit': 'commit' };
  for (let index = 0; index < argv.length; index += 2) {
    const key = names[argv[index]];
    check(key && !Object.hasOwn(options, key) && argv[index + 1]
      && !argv[index + 1].startsWith('--'), 'expected --endpoint URL [--commit SHA]');
    options[key] = argv[index + 1];
  }
  check(options.endpoint, 'endpoint is required');
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
