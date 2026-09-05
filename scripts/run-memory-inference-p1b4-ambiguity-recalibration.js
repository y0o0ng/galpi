#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const { performance } = require('node:perf_hooks');
const {
  PHASES, RUNTIME, TIMEOUT_MS, PREFLIGHT_TIMEOUT_MS, loadInputs, endpointUrls,
  preflight, requestText, stageRecord, stageContract, buildStagePrompt,
  parseStageContent, summarizeCalls, exactKeys,
} = require('./run-memory-inference-p1b3-decomposed-pipeline');
const { combineReports } = require('./combine-memory-inference-p1b3-decomposed-pipeline');

const ROOT = path.resolve(__dirname, '..');
const RUNNER_VERSION = 'xion-local-memory-inference-p1b4-ambiguity-recalibration-runner-v1';
const SCORING_VERSION = 'xion-local-memory-inference-p1b4-ambiguity-recalibration-scoring-v1';
const PROMPT_VERSION = 'xion-local-memory-inference-p1b4-ambiguity-recalibration-prompt-v1';
const REPORT_VERSION = 'xion-local-memory-inference-p1b4-ambiguity-recalibration-report-v1';
const TASK_VERSION = 'p1b4-ambiguity-recalibration-v1';
// The old output schema is purely structural; only task/prompt semantics change.
const SPECIFICATION = stageContract('ambiguity').specification;
const INSTRUCTION = `Return CLEAR when the supplied evidence has one sufficiently clear
interpretation for downstream durability classification, even if that
interpretation is temporary, request-local, or would later be NO_WRITE.

Return ESCALATE only when the evidence itself leaves material ambiguity
about meaning, referent, scope, applicability, or whether the statement is
actual user state versus quoted, example, or hypothetical content.

Do not decide durability yourself. Do not resolve ambiguity yourself.`;
const REQUEST_SETTINGS = Object.freeze({
  temperature: 0, max_tokens: 128, stream: false,
  chat_template_kwargs: Object.freeze({ enable_thinking: false }),
  response_format: Object.freeze({ type: 'json_object' }),
});

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

function buildAmbiguityPrompt(candidate) {
  return {
    promptVersion: PROMPT_VERSION, taskSpecificationVersion: TASK_VERSION,
    outputSchemaVersion: SPECIFICATION.outputSchemaVersion,
    messages: [
      buildStagePrompt('ambiguity', candidate).messages[0],
      { role: 'user', content: [
        `WORKLOAD: ${SPECIFICATION.workloadType}`,
        `TASK_SPECIFICATION: ${TASK_VERSION}`,
        `INSTRUCTION: ${INSTRUCTION}`,
        `OUTPUT_SCHEMA: ${JSON.stringify(SPECIFICATION.outputSchema)}`,
        `INPUT: ${JSON.stringify({ evidence: candidate.inputPayload.evidence })}`,
      ].join('\n') },
    ],
  };
}

function ambiguityRecord(candidate) {
  return { ...stageRecord('ambiguity', candidate, null),
    promptVersion: PROMPT_VERSION, taskSpecificationVersion: TASK_VERSION };
}

async function invokeAmbiguity(candidate, options) {
  const result = ambiguityRecord(candidate);
  const startedAt = performance.now();
  result.attempted = true;
  let response;
  try {
    response = await requestText(options.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: PHASES['1.7b'].model.modelId,
        messages: buildAmbiguityPrompt(candidate).messages, ...REQUEST_SETTINGS }),
    }, options.fetchImpl, TIMEOUT_MS);
    if (!response.ok) {
      result.runtimeError = { state: 'RUNNER_ERROR', code: `LOCAL_HTTP_${response.status}` };
    } else {
      let envelope;
      try { envelope = JSON.parse(response.text); } catch {
        result.runtimeError = { state: 'RUNNER_ERROR', code: 'LOCAL_RUNTIME_INVALID_JSON' };
      }
      if (!result.runtimeError) {
        const content = envelope?.choices?.[0]?.message?.content;
        if (typeof content !== 'string') {
          result.runtimeError = { state: 'RUNNER_ERROR', code: 'LOCAL_RUNTIME_RESPONSE_INVALID' };
        } else {
          result.completed = true;
          result.rawAssistantContent = content;
          Object.assign(result, parseStageContent(content, SPECIFICATION));
        }
      }
    }
  } catch (error) {
    result.runtimeError = error?.name === 'AbortError'
      ? { state: 'TIMEOUT', code: 'LOCAL_ENDPOINT_TIMEOUT' }
      : error instanceof TypeError && !response
        ? { state: 'UNAVAILABLE', code: 'LOCAL_ENDPOINT_UNAVAILABLE' }
        : { state: 'RUNNER_ERROR', code: 'LOCAL_RUNTIME_FAILURE' };
  } finally { result.latencyMs = performance.now() - startedAt; }
  return result;
}

function scoreAmbiguity(caseId, humanGoldLabel, ambiguity) {
  const decision = ambiguity.runtimeError ? 'RUNTIME_FAILURE'
    : ambiguity.schemaStatus === 'VALID' ? ambiguity.structuredOutput.decision : 'INVALID';
  return {
    caseId, humanGoldLabel, ambiguity, decision,
    unsafeNonEscalation: humanGoldLabel === 'ESCALATE' && decision !== 'ESCALATE',
    unnecessaryEscalation: humanGoldLabel !== 'ESCALATE' && decision === 'ESCALATE',
  };
}

function summarizeAmbiguity(observations) {
  const decisions = rows => Object.fromEntries(['CLEAR', 'ESCALATE', 'INVALID', 'RUNTIME_FAILURE']
    .map(label => [label, rows.filter(row => row.decision === label).length]));
  return {
    ...summarizeCalls(observations.map(row => row.ambiguity)), ...decisions(observations),
    unsafeNonEscalation: observations.filter(row => row.unsafeNonEscalation).length,
    unnecessaryEscalation: observations.filter(row => row.unnecessaryEscalation).length,
    perHumanClass: Object.fromEntries(['NO_WRITE', 'WRITE_CANDIDATE', 'ESCALATE'].map(label => [
      label, decisions(observations.filter(row => row.humanGoldLabel === label)),
    ])),
  };
}

function assembleReport(observations, commit, generatedAt, source) {
  const summary = summarizeAmbiguity(observations);
  const historical = summarizeAmbiguity(source.combined.observations.map(row =>
    scoreAmbiguity(row.caseId, row.humanGoldLabel, row.arms['D1.7'].stages.ambiguity)));
  return {
    reportVersion: REPORT_VERSION, runnerVersion: RUNNER_VERSION, scoringVersion: SCORING_VERSION,
    promptVersion: PROMPT_VERSION, taskSpecificationVersion: TASK_VERSION,
    outputSchemaVersion: SPECIFICATION.outputSchemaVersion,
    galpiCommit: commit, generatedAt, phase: 'P1-B4A', diagnosticType: 'ADAPTIVE_CONSUMED_FIXTURE',
    inputs: source.inputs.provenance,
    historicalSource: { galpiCommit: SOURCE_COMMIT, artifacts: source.provenance, combinedRecomputed: true },
    model: PHASES['1.7b'].model, runtime: RUNTIME, requestSettings: REQUEST_SETTINGS,
    timeoutMs: TIMEOUT_MS, automaticReruns: false,
    preflight: { success: true, status: 'ok', timeoutMs: PREFLIGHT_TIMEOUT_MS },
    execution: { casesPlanned: 60, callsPlanned: summary.callsPlanned,
      callsAttempted: summary.callsAttempted, callsCompleted: summary.callsCompleted,
      invalidStructuredOutputs: summary.invalidStructuredOutputs, runtimeFailures: summary.runtimeFailures },
    observations, summary,
    historicalComparison: {
      baseline: 'P1-B3 D1.7 ambiguity; descriptive only', summary: historical,
      currentMinusHistorical: Object.fromEntries(['CLEAR', 'ESCALATE', 'unsafeNonEscalation', 'unnecessaryEscalation']
        .map(key => [key, summary[key] - historical[key]])),
    },
    // Completion is a runtime condition only, never a semantic performance entry gate.
    runtimeDisposition: summary.runtimeFailures ? 'INDETERMINATE_RUNTIME' : 'COMPLETE',
  };
}

function validateAmbiguityReport(report, source = loadSources()) {
  check(typeof report.galpiCommit === 'string' && /^[a-f0-9]{40}$/u.test(report.galpiCommit), 'invalid B4A commit');
  check(typeof report.generatedAt === 'string' && Number.isFinite(Date.parse(report.generatedAt)), 'invalid B4A timestamp');
  check(Array.isArray(report.observations) && isDeepStrictEqual(report.observations.map(row => row.caseId),
    source.inputs.candidates.cases.map(row => row.caseId)), 'B4A case IDs/order mismatch');
  const observations = report.observations.map((row, index) => {
    const candidate = source.inputs.candidates.cases[index];
    const recorded = row.ambiguity;
    const expected = ambiguityRecord(candidate);
    check(Number.isFinite(recorded.latencyMs) && recorded.latencyMs >= 0, 'invalid B4A stage latency');
    expected.attempted = true;
    expected.latencyMs = recorded.latencyMs;
    if (typeof recorded.rawAssistantContent === 'string') {
      expected.completed = true;
      expected.rawAssistantContent = recorded.rawAssistantContent;
      Object.assign(expected, parseStageContent(recorded.rawAssistantContent, SPECIFICATION));
    } else {
      const error = recorded.runtimeError;
      check(exactKeys(error, ['state', 'code']) && (
        (error.state === 'TIMEOUT' && error.code === 'LOCAL_ENDPOINT_TIMEOUT')
        || (error.state === 'UNAVAILABLE' && error.code === 'LOCAL_ENDPOINT_UNAVAILABLE')
        || (error.state === 'RUNNER_ERROR' && (
          ['LOCAL_RUNTIME_FAILURE', 'LOCAL_RUNTIME_INVALID_JSON', 'LOCAL_RUNTIME_RESPONSE_INVALID'].includes(error.code)
          || /^LOCAL_HTTP_\d{3}$/u.test(error.code)
        ))
      ), 'invalid B4A runtime error');
      expected.runtimeError = error;
    }
    check(isDeepStrictEqual(recorded, expected), `B4A raw stage/contract mismatch: ${row.caseId}`);
    return scoreAmbiguity(candidate.caseId, source.inputs.human.labels[index].label, expected);
  });
  const recomputed = assembleReport(observations, report.galpiCommit, report.generatedAt, source);
  check(isDeepStrictEqual(report, recomputed), 'B4A report identity/provenance/scoring/count mismatch');
  return recomputed;
}

async function runRecalibration(options) {
  check(Object.keys(options).every(key => ['endpoint', 'commit', 'fetchImpl'].includes(key)), 'unsupported B4A option');
  const commit = options.commit ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  check(/^[a-f0-9]{40}$/u.test(commit), 'commit must be a full Galpi SHA');
  const source = loadSources();
  const urls = endpointUrls(options.endpoint);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  await preflight(urls.health, fetchImpl);
  const observations = [];
  let callsPlanned = 0;
  for (const [index, candidate] of source.inputs.candidates.cases.entries()) {
    callsPlanned += 1;
    const stage = await invokeAmbiguity(candidate, { endpoint: urls.completion, fetchImpl });
    observations.push(scoreAmbiguity(candidate.caseId, source.inputs.human.labels[index].label, stage));
  }
  const report = assembleReport(observations, commit, new Date().toISOString(), source);
  check(report.execution.callsAttempted === callsPlanned, 'B4A planned/attempted invariant');
  return report;
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
  const report = await runRecalibration(parseArguments(argv));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.execution.runtimeFailures ? 1 : 0;
}

module.exports = {
  RUNNER_VERSION, SCORING_VERSION, PROMPT_VERSION, REPORT_VERSION, TASK_VERSION, SPECIFICATION,
  INSTRUCTION, REQUEST_SETTINGS, SOURCE_COMMIT, SOURCE_ARTIFACTS, INPUT_SHA256,
  check, validateSourceReports, loadSources, buildAmbiguityPrompt, ambiguityRecord,
  scoreAmbiguity, summarizeAmbiguity, validateAmbiguityReport, runRecalibration, parseArguments, main,
};

if (require.main === module) {
  main().then(code => { process.exitCode = code; }, error => {
    console.error(`P1-B4A runner failed: ${error.message}`);
    process.exitCode = 1;
  });
}
