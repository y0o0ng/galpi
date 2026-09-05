#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const b3 = require('./run-memory-inference-p1b3-decomposed-pipeline');
const b4a = require('./run-memory-inference-p1b4-ambiguity-recalibration');
const b4b = require('./run-memory-inference-p1b4-role-split-hybrid-diagnostic');
const { TRANSITIONS, pairedTransition } = require('./combine-memory-inference-p1b3-decomposed-pipeline');

const ROOT = path.resolve(__dirname, '..');
const NORMALIZER_VERSION = 'xion-local-memory-inference-structured-output-normalizer-v1';
const RUNNER_VERSION = 'xion-local-memory-inference-p1b5-structured-output-normalization-runner-v1';
const SCORING_VERSION = 'xion-local-memory-inference-p1b5-structured-output-normalization-scoring-v1';
const REPORT_VERSION = 'xion-local-memory-inference-p1b5-structured-output-normalization-report-v1';
const SOURCE_COMMIT = '4e079617e96c7fae41ef92ad0d356c4d7b5a2e56';
const SOURCE_ARTIFACTS = Object.freeze({
  ambiguity: Object.freeze({ file: 'fixtures/local-memory-inference-p1b4-ambiguity-report.json',
    sha256: 'e77a7a6f9aa76c50e24d645f3e218f212295f05124e0a4da956c1cd68dc4cf70' }),
  hybrid: Object.freeze({ file: 'fixtures/local-memory-inference-p1b4-hybrid-report.json',
    sha256: '55e6b83906904afd7da42961e9c8eb22304addd2479ab072f6e3c02dd6245ccf' }),
});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function check(condition, message) {
  if (!condition) throw new TypeError(`P1-B5 ${message}`);
}
function same(actual, expected, message) {
  check(isDeepStrictEqual(actual, expected), message);
}

// Presentation envelope only. JSON and schema failures are never repaired.
function normalizeContent(raw) {
  check(typeof raw === 'string', 'assistant content must be a string');
  try {
    JSON.parse(raw);
    return { normalizedAssistantContent: raw, normalizationApplied: false, normalizationKind: 'NONE' };
  } catch { /* Only the one observed envelope may be removed below. */ }
  const fenced = /^```json(\r?\n[\s\S]*\r?\n)```$/u.exec(raw.trim());
  if (fenced && !fenced[1].includes('```')) {
    // Keep even the payload's boundary newlines; remove only fence markers.
    return { normalizedAssistantContent: fenced[1], normalizationApplied: true,
      normalizationKind: 'EXACT_JSON_CODE_FENCE_UNWRAP' };
  }
  return { normalizedAssistantContent: null, normalizationApplied: false, normalizationKind: 'NOT_NORMALIZABLE' };
}

function normalizedAmbiguity(original) {
  const normalized = normalizeContent(original.rawAssistantContent);
  const parsed = normalized.normalizedAssistantContent === null
    ? { schemaStatus: 'INVALID', structuredOutput: null }
    : b3.parseStageContent(normalized.normalizedAssistantContent, b4a.SPECIFICATION);
  return { ...structuredClone(original), ...normalized, ...parsed, interpretationVersion: NORMALIZER_VERSION };
}

// B4B had no standalone report validator. Reconstruct its frozen v2 report
// using strict parsing and existing scoring, without executing its runner.
function validateB4Reports(ambiguityBytes, hybrid, source = b4a.loadSources()) {
  const ambiguity = b4a.validateAmbiguityReport(JSON.parse(ambiguityBytes), source);
  same(ambiguity.galpiCommit, SOURCE_COMMIT, 'B4A execution commit mismatch');
  check(ambiguity.execution.runtimeFailures === 0, 'B4A source INDETERMINATE_RUNTIME');
  check(typeof hybrid.generatedAt === 'string' && Number.isFinite(Date.parse(hybrid.generatedAt)),
    'invalid B4B timestamp');
  same(hybrid.observations.map(row => row.caseId), source.inputs.candidates.cases.map(row => row.caseId),
    'B4B case IDs/order mismatch');
  const paired = Object.fromEntries(TRANSITIONS.map(key => [key, 0]));
  const observations = hybrid.observations.map((row, index) => {
    const candidate = source.inputs.candidates.cases[index];
    const humanGoldLabel = source.inputs.human.labels[index].label;
    const recorded = row.arms.HYBRID;
    const stages = { ambiguity: ambiguity.observations[index].ambiguity };
    const stageOrigins = { ambiguity: 'REUSED_P1B4A' };
    let previous = stages.ambiguity;
    for (const id of ['binary', 'extraction']) {
      const expected = b3.stageRecord(id, candidate, b3.skipAfter(previous));
      if (expected.invoked) {
        const stage = recorded.stages[id];
        check(stage.runtimeError === null && typeof stage.rawAssistantContent === 'string',
          'B4B source runtime failure or missing raw content');
        check(Number.isFinite(stage.latencyMs) && stage.latencyMs >= 0, 'invalid B4B latency');
        Object.assign(expected, { attempted: true, completed: true, latencyMs: stage.latencyMs,
          rawAssistantContent: stage.rawAssistantContent },
        b3.parseStageContent(stage.rawAssistantContent, b3.stageContract(id, candidate).specification));
      }
      stages[id] = expected;
      stageOrigins[id] = expected.invoked ? 'NEW' : 'SKIPPED';
      previous = expected;
    }
    const rescored = { ...b3.scoreArmCase('D1.7', stages, humanGoldLabel,
      source.inputs.authoring.cases[candidate.caseId].extractionGold), stageOrigins };
    const baselineL4 = source.combined.observations[index].arms.L4;
    const transition = pairedTransition(baselineL4, rescored);
    paired[transition] += 1;
    return { caseId: candidate.caseId, humanGoldLabel, arms: { HYBRID: rescored }, baselineL4, transition };
  });
  const cases = observations.map(row => row.arms.HYBRID);
  const summary = b3.summarizeArm('D1.7', cases);
  const sourceCalls = b3.summarizeCalls(cases.map(row => row.stages.ambiguity));
  const newStages = Object.fromEntries(['binary', 'extraction'].map(id => [
    id, b3.summarizeCalls(cases.map(row => row.stages[id])),
  ]));
  const counts = b3.summarizeCalls(cases.flatMap(row => [row.stages.binary, row.stages.extraction]));
  const decision = b4b.progression(source.combined.armSummaries.L4, summary, paired, 0);
  const expected = {
    reportVersion: b4b.REPORT_VERSION, runnerVersion: b4b.RUNNER_VERSION, scoringVersion: b4b.SCORING_VERSION,
    generatedAt: hybrid.generatedAt, galpiCommit: SOURCE_COMMIT,
    diagnosticType: 'ADAPTIVE_CONSUMED_FIXTURE', inputs: source.inputs.provenance,
    source: { galpiCommit: b4a.SOURCE_COMMIT, artifacts: source.provenance,
      ambiguityArm: 'P1-B4A', ambiguityModel: b3.PHASES['1.7b'].model,
      ambiguityReport: { identity: ambiguity.reportVersion, runnerVersion: ambiguity.runnerVersion,
        scoringVersion: ambiguity.scoringVersion, promptVersion: ambiguity.promptVersion,
        galpiCommit: SOURCE_COMMIT, sha256: sha256(ambiguityBytes), revalidated: true },
      baselineArm: 'L4', combinedRecomputed: true, runtimeFailures: 0 },
    model: b3.PHASES['4b'].model, runtime: b3.RUNTIME, timeoutMs: b3.TIMEOUT_MS,
    automaticReruns: false, preflight: { success: true, status: 'ok', timeoutMs: b3.PREFLIGHT_TIMEOUT_MS },
    execution: {
      casesPlanned: 60, sourceAmbiguityCallsReused: 60,
      newCallsPlanned: counts.callsPlanned, newCallsAttempted: counts.callsAttempted,
      newCallsCompleted: counts.callsCompleted, newInvalidStructuredOutputs: counts.invalidStructuredOutputs,
      newRuntimeFailures: 0, sourceAmbiguity: sourceCalls, newStages,
      counterfactualHybridStageCalls: sourceCalls.callsAttempted + counts.callsAttempted,
      latencyBasis: 'Reused P1-B4A ambiguity plus new P1-B4B stages; counterfactual, not wall-clock server-switch latency',
    },
    observations, armSummaries: { HYBRID: summary }, baselineL4Summary: source.combined.armSummaries.L4,
    pairedComparisons: { 'L4->HYBRID': paired }, runtimeFailures: 0,
    progressionRule: decision.conditions, finalDisposition: decision.finalDisposition,
  };
  same(hybrid, expected, 'B4B frozen report/raw output/scoring/provenance mismatch');
  return { b3: source, ambiguity, hybrid: expected };
}

function loadSources() {
  const source = b4a.loadSources();
  const bytes = Object.fromEntries(Object.entries(SOURCE_ARTIFACTS).map(([key, artifact]) => [
    key, fs.readFileSync(path.join(ROOT, artifact.file)),
  ]));
  const validated = validateB4Reports(bytes.ambiguity, JSON.parse(bytes.hybrid), source);
  const artifacts = Object.fromEntries(Object.entries(SOURCE_ARTIFACTS).map(([key, artifact]) => {
    same(sha256(bytes[key]), artifact.sha256, `${key} exact B4 artifact SHA-256 mismatch`);
    return [key, { ...artifact, identity: validated[key].reportVersion }];
  }));
  return { ...validated, artifacts };
}

async function runCase(candidate, humanGold, extractionGold, original, normalized, oldHybrid, options, counts) {
  const stages = { ambiguity: normalized };
  const stageOrigins = { ambiguity: 'REUSED_P1B4A' };
  const reuse = original.schemaStatus === 'VALID' && original.structuredOutput.decision === 'CLEAR';
  let previous = normalized;
  for (const id of ['binary', 'extraction']) {
    if (reuse) {
      stages[id] = structuredClone(oldHybrid.stages[id]);
      stageOrigins[id] = stages[id].invoked ? 'REUSED_P1B4B' : 'SKIPPED';
    } else {
      const skipReason = b3.skipAfter(previous);
      stages[id] = skipReason === null
        ? await b3.invokeStage(id, candidate, { ...options, model: b3.PHASES['4b'].model }, counts)
        : b3.stageRecord(id, candidate, skipReason);
      stageOrigins[id] = stages[id].invoked ? 'NEW' : 'SKIPPED';
    }
    previous = stages[id];
  }
  return { ...b3.scoreArmCase('D1.7', stages, humanGold, extractionGold), stageOrigins };
}

// The CLI always supplies pinned, fully validated sources. Kept callable with
// synthetic source records for fake-fetch zero-new-call/control-flow tests.
async function executeDiagnostic(source, options) {
  const normalized = source.ambiguity.observations.map(row => normalizedAmbiguity(row.ambiguity));
  const newlyReachable = normalized.filter((stage, index) => stage.schemaStatus === 'VALID'
    && stage.structuredOutput.decision === 'CLEAR'
    && source.ambiguity.observations[index].ambiguity.schemaStatus === 'INVALID').length;
  const normalization = {
    alreadyRawJson: normalized.filter(row => row.normalizationKind === 'NONE').length,
    codeFenceUnwrapped: normalized.filter(row => row.normalizationApplied).length,
    notNormalizable: normalized.filter(row => row.normalizationKind === 'NOT_NORMALIZABLE').length,
    schemaValidAfterNormalization: normalized.filter(row => row.schemaStatus === 'VALID').length,
  };
  const sourceDownstreamCallsReused = source.hybrid.observations.reduce((sum, row) => sum
    + ['binary', 'extraction'].filter(id => row.arms.HYBRID.stages[id].invoked).length, 0);
  const base = {
    runnerVersion: RUNNER_VERSION, scoringVersion: SCORING_VERSION, reportVersion: REPORT_VERSION,
    normalizerVersion: NORMALIZER_VERSION, normalizationScope: 'STAGE_1_ONLY',
    generatedAt: new Date().toISOString(), galpiCommit: options.commit,
    diagnosticType: 'ADAPTIVE_CONSUMED_FIXTURE', inputs: source.b3.inputs.provenance,
    source: { galpiCommit: SOURCE_COMMIT, artifacts: source.artifacts,
      b3Artifacts: source.b3.provenance, reportsRevalidated: true, runtimeFailures: 0 },
    model: b3.PHASES['4b'].model, runtime: b3.RUNTIME, timeoutMs: b3.TIMEOUT_MS,
    automaticReruns: false, normalization,
    latencyBasis: 'Counterfactual reused B4A + reused B4B + new B5 model stages; not wall-clock server-switch latency',
  };
  const execution = {
    casesPlanned: 60, sourceAmbiguityCallsReused: 60, sourceDownstreamCallsReused,
    newBinaryCallsPlanned: newlyReachable, newBinaryCallsAttempted: 0, newBinaryCallsCompleted: 0,
    newExtractionCallsPlanned: 0, newExtractionCallsAttempted: 0, newExtractionCallsCompleted: 0,
    newInvalidStructuredOutputs: 0, newRuntimeFailures: 0,
  };
  let readiness = { success: null, status: 'NOT_REQUIRED', timeoutMs: b3.PREFLIGHT_TIMEOUT_MS };
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  let endpoint;
  if (newlyReachable > 0) {
    check(options.endpoint, 'endpoint is required for newly reachable CLEAR cases');
    const urls = b3.endpointUrls(options.endpoint);
    endpoint = urls.completion;
    try { readiness = await b3.preflight(urls.health, fetchImpl); } catch {
      // Readiness is not an attempted semantic POST. Do not fabricate case scores.
      return { ...base, preflight: { success: false, status: 'FAILED', timeoutMs: b3.PREFLIGHT_TIMEOUT_MS },
        execution, readinessFailures: 1, requiredRuntimeFailures: 1,
        observations: [], armSummaries: null, pairedComparisons: null, progressionRule: null,
        finalDisposition: 'INDETERMINATE_RUNTIME' };
    }
  }
  const counts = { callsPlanned: 0, callsAttempted: 0, callsCompleted: 0,
    invalidStructuredOutputs: 0, runtimeFailures: 0 };
  const observations = [];
  const paired = Object.fromEntries(TRANSITIONS.map(key => [key, 0]));
  for (const [index, candidate] of source.b3.inputs.candidates.cases.entries()) {
    const humanGoldLabel = source.b3.inputs.human.labels[index].label;
    const original = source.ambiguity.observations[index].ambiguity;
    const hybrid = await runCase(candidate, humanGoldLabel,
      source.b3.inputs.authoring.cases[candidate.caseId].extractionGold, original, normalized[index],
      source.hybrid.observations[index].arms.HYBRID, { endpoint, fetchImpl }, counts);
    const baselineL4 = source.b3.combined.observations[index].arms.L4;
    const transition = pairedTransition(baselineL4, hybrid);
    paired[transition] += 1;
    observations.push({ caseId: candidate.caseId, humanGoldLabel,
      sourceAmbiguity: structuredClone(original), arms: { HYBRID: hybrid }, baselineL4, transition });
  }
  const cases = observations.map(row => row.arms.HYBRID);
  const newStages = Object.fromEntries(['binary', 'extraction'].map(id => [id,
    b3.summarizeCalls(cases.filter(row => row.stageOrigins[id] === 'NEW').map(row => row.stages[id])),
  ]));
  for (const id of ['binary', 'extraction']) {
    for (const name of ['Planned', 'Attempted', 'Completed']) {
      execution[`new${id === 'binary' ? 'Binary' : 'Extraction'}Calls${name}`] = newStages[id][`calls${name}`];
    }
  }
  execution.newInvalidStructuredOutputs = counts.invalidStructuredOutputs;
  execution.newRuntimeFailures = counts.runtimeFailures;
  check(counts.callsPlanned === counts.callsAttempted, 'new planned/attempted invariant');
  const summary = b3.summarizeArm('D1.7', cases);
  const decision = b4b.progression(source.b3.combined.armSummaries.L4, summary, paired, counts.runtimeFailures);
  return { ...base, preflight: readiness, execution: { ...execution, newStages,
    counterfactualHybridStageCalls: 60 + sourceDownstreamCallsReused + counts.callsAttempted },
  observations, armSummaries: { HYBRID: summary }, baselineL4Summary: source.b3.combined.armSummaries.L4,
  pairedComparisons: { 'L4->HYBRID': paired }, readinessFailures: 0, requiredRuntimeFailures: counts.runtimeFailures,
  progressionRule: decision.conditions, finalDisposition: decision.finalDisposition };
}

async function runNormalization(options) {
  check(Object.keys(options).every(key => ['endpoint', 'commit', 'fetchImpl'].includes(key)), 'unsupported option');
  const commit = options.commit ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  check(/^[a-f0-9]{40}$/u.test(commit), 'commit must be a full Galpi SHA');
  if (options.endpoint !== undefined) b3.endpointUrls(options.endpoint);
  const source = loadSources();
  return executeDiagnostic(source, { ...options, commit });
}

function parseArguments(argv) {
  const options = {};
  const names = { '--endpoint': 'endpoint', '--commit': 'commit' };
  for (let index = 0; index < argv.length; index += 2) {
    const key = names[argv[index]];
    check(key && !Object.hasOwn(options, key) && argv[index + 1] && !argv[index + 1].startsWith('--'),
      'expected [--endpoint URL] [--commit SHA]');
    options[key] = argv[index + 1];
  }
  if (options.endpoint !== undefined) b3.endpointUrls(options.endpoint);
  if (options.commit !== undefined) check(/^[a-f0-9]{40}$/u.test(options.commit), 'invalid commit');
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const report = await runNormalization(parseArguments(argv));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.finalDisposition === 'INDETERMINATE_RUNTIME' ? 1 : 0;
}

module.exports = { NORMALIZER_VERSION, RUNNER_VERSION, SCORING_VERSION, REPORT_VERSION,
  SOURCE_COMMIT, SOURCE_ARTIFACTS, normalizeContent, normalizedAmbiguity,
  validateB4Reports, loadSources, runCase, executeDiagnostic, runNormalization, parseArguments, main };

if (require.main === module) {
  main().then(code => { process.exitCode = code; }, error => {
    console.error(`P1-B5 runner failed: ${error.message}`);
    process.exitCode = 1;
  });
}
