#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { isDeepStrictEqual } = require('node:util');
const { WORKLOAD_TYPES } = require('../lib/memory-inference-pilot');
const {
  CALIBRATION_PROMPT_VERSION, PROMPT_INSTRUCTIONS, TASK_SPECIFICATIONS,
} = require('../lib/memory-inference-local-calibration');
const {
  DEFINED_LABELS_PROMPT_VERSION, DEFINED_LABEL_SEMANTICS_INSTRUCTION,
  DIAGNOSTIC_RUNTIME_VERSION,
} = require('./run-memory-inference-triage-label-semantics-diagnostic');
const {
  CANDIDATE_FIXTURE_NAME, FIXED_CASE_IDS, LABELS, validateCandidateFixture,
} = require('./review-memory-inference-p1b3-human-primary-gold');

const ROOT = path.resolve(__dirname, '..');
const RUNNER_VERSION = 'xion-local-memory-inference-p1b3-decomposed-pipeline-runner-v1';
const SCORING_VERSION = 'xion-local-memory-inference-p1b3-decomposed-pipeline-scoring-v1';
const BINARY_PROMPT_VERSION = 'xion-local-memory-inference-p1b3-binary-write-candidate-prompt-v1';
const TIMEOUT_MS = 180000;
const PREFLIGHT_TIMEOUT_MS = 10000;
const RUNTIME = Object.freeze({ family: 'llama.cpp', version: DIAGNOSTIC_RUNTIME_VERSION });
const PHASES = Object.freeze({
  '4b': Object.freeze({
    reportVersion: 'xion-local-memory-inference-p1b3-decomposed-pipeline-4b-report-v1',
    arms: Object.freeze(['L4', 'D4']), maxPossibleCalls: 300,
    model: Object.freeze({ modelId: 'xion-p1b1-qwen3-4b-bf16',
      artifactId: 'unsloth/Qwen3-4B-GGUF:BF16', modelSizeClass: '~4B', quantization: 'BF16' }),
  }),
  '1.7b': Object.freeze({
    reportVersion: 'xion-local-memory-inference-p1b3-decomposed-pipeline-1p7b-report-v1',
    arms: Object.freeze(['D1.7']), maxPossibleCalls: 180,
    model: Object.freeze({ modelId: 'xion-p1b1-qwen3-1.7b-bf16',
      artifactId: 'unsloth/Qwen3-1.7B-GGUF:BF16', modelSizeClass: '~2B', quantization: 'BF16' }),
  }),
});
const INPUT_FILES = Object.freeze({
  candidates: 'fixtures/local-memory-inference-p1b3-decomposed-pipeline-candidates-v2.json',
  human: 'fixtures/local-memory-inference-p1b3-human-resolved-labels.json',
  authoring: 'fixtures/local-memory-inference-p1b3-decomposed-pipeline-authoring-key-v2.json',
});
const INPUT_IDENTITIES = Object.freeze({
  candidates: CANDIDATE_FIXTURE_NAME,
  human: 'xion-local-memory-inference-p1b3-human-resolved-labels-v1',
  authoring: 'xion-local-memory-inference-p1b3-decomposed-pipeline-authoring-key-v2',
});
const SYSTEM_SCAFFOLD = [
  'You are an experimental bounded local inference runner.',
  'Return exactly one JSON object and no markdown or explanation.',
  'Use only the supplied input. Do not claim memory, write, or authority.',
].join(' ');
const BINARY_INSTRUCTION = `Classify the supplied evidence into exactly one advisory triage label:
NO_WRITE or WRITE_CANDIDATE.

NO_WRITE: the evidence is clearly transient, request-local, or otherwise
not a durable memory candidate.

WRITE_CANDIDATE: the evidence clearly states a sufficiently persistent
fact, preference, goal, constraint, or state that may be worth
durable-memory review.

This classification is advisory only and does not authorize a durable write.`;
const BINARY_SPECIFICATION = Object.freeze({
  workloadType: 'binary_write_candidate_triage',
  taskSpecificationVersion: 'p1b3-binary-write-candidate-triage-v1',
  outputSchemaVersion: 'p1b3-binary-write-candidate-triage-output-v1',
  outputSchema: Object.freeze({
    type: 'object', additionalProperties: false, required: ['decision'],
    properties: { decision: { type: 'string', enum: ['NO_WRITE', 'WRITE_CANDIDATE'] } },
  }),
  validate(output) {
    return exactKeys(output, ['decision']) && ['NO_WRITE', 'WRITE_CANDIDATE'].includes(output.decision);
  },
});

function check(condition, message) {
  if (!condition) throw new TypeError(`P1-B3 ${message}`);
}

function exactKeys(value, keys) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}

function validateInputs(inputs) {
  const { candidates, human, authoring } = inputs;
  validateCandidateFixture(candidates);
  for (const [key, identity] of Object.entries(INPUT_IDENTITIES)) {
    check(inputs[key]?.name === identity, `${key} identity mismatch`);
  }
  check(human.candidateFixture === candidates.name && authoring.candidateFixture === candidates.name,
    'candidate references mismatch');
  check(Array.isArray(human.labels)
    && isDeepStrictEqual(human.labels.map(row => row.caseId), FIXED_CASE_IDS), 'HUMAN IDs/order mismatch');
  check(authoring.cases && isDeepStrictEqual(Object.keys(authoring.cases), FIXED_CASE_IDS),
    'authoring IDs/order mismatch');
  for (const row of human.labels) {
    check(exactKeys(row, ['caseId', 'label']) && LABELS.includes(row.label), 'invalid HUMAN label');
  }
  const distribution = LABELS.map(label => human.labels.filter(row => row.label === label).length);
  check(distribution.every(count => count === 20 && count >= 15), 'HUMAN 20/20/20 distribution gate failed');
  for (const candidate of candidates.cases) {
    const entry = authoring.cases[candidate.caseId];
    check(exactKeys(entry, ['authoringTarget', 'extractionGold']), 'invalid authoring entry');
    // Construction targets are deliberately never read as semantic class gold.
    check(TASK_SPECIFICATIONS[candidate.inputPayload.expectedSchema].validate(entry.extractionGold),
      `invalid extractionGold: ${candidate.caseId}`);
  }
  return inputs;
}

function loadInputs() {
  const inputs = { provenance: {} };
  for (const [key, file] of Object.entries(INPUT_FILES)) {
    const bytes = fs.readFileSync(path.join(ROOT, file));
    inputs[key] = JSON.parse(bytes);
    inputs.provenance[key] = {
      identity: inputs[key].name, sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }
  return validateInputs(inputs);
}

function stageContract(stageId, candidate) {
  let specification;
  let instruction;
  let promptVersion = CALIBRATION_PROMPT_VERSION;
  if (stageId === 'triage') {
    specification = TASK_SPECIFICATIONS[WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE];
    instruction = DEFINED_LABEL_SEMANTICS_INSTRUCTION;
    promptVersion = DEFINED_LABELS_PROMPT_VERSION;
  } else if (stageId === 'ambiguity') {
    specification = TASK_SPECIFICATIONS[WORKLOAD_TYPES.AMBIGUITY_ESCALATION];
    instruction = PROMPT_INSTRUCTIONS[WORKLOAD_TYPES.AMBIGUITY_ESCALATION];
  } else if (stageId === 'binary') {
    specification = BINARY_SPECIFICATION;
    instruction = BINARY_INSTRUCTION;
    promptVersion = BINARY_PROMPT_VERSION;
  } else {
    check(stageId === 'extraction', 'unknown stage');
    specification = TASK_SPECIFICATIONS[candidate.inputPayload.expectedSchema];
    instruction = PROMPT_INSTRUCTIONS[WORKLOAD_TYPES.STRUCTURED_EXTRACTION];
  }
  return { specification, instruction, promptVersion };
}

function buildStagePrompt(stageId, candidate) {
  const { specification, instruction, promptVersion } = stageContract(stageId, candidate);
  const input = { evidence: candidate.inputPayload.evidence };
  if (stageId === 'extraction') input.expectedSchema = candidate.inputPayload.expectedSchema;
  return {
    promptVersion,
    taskSpecificationVersion: specification.taskSpecificationVersion,
    outputSchemaVersion: specification.outputSchemaVersion,
    messages: [
      { role: 'system', content: SYSTEM_SCAFFOLD },
      { role: 'user', content: [
        `WORKLOAD: ${specification.workloadType}`,
        `TASK_SPECIFICATION: ${specification.taskSpecificationVersion}`,
        `INSTRUCTION: ${instruction}`,
        `OUTPUT_SCHEMA: ${JSON.stringify(specification.outputSchema)}`,
        `INPUT: ${JSON.stringify(input)}`,
      ].join('\n') },
    ],
  };
}

function endpointUrls(endpoint) {
  let url;
  try { url = new URL(endpoint); } catch { throw new TypeError('P1-B3 invalid endpoint URL'); }
  check(['http:', 'https:'].includes(url.protocol)
    && !url.username && !url.password && !url.search && !url.hash,
  'endpoint must be HTTP(S) without credentials/query/fragment');
  const base = url.pathname.replace(/\/+$/u, '');
  url.pathname = base.endsWith('/chat/completions') ? base
    : base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  const completion = url.toString();
  const segments = url.pathname.split('/').filter(Boolean);
  segments.splice(-2);
  if (segments.at(-1) === 'v1') segments.pop();
  url.pathname = `/${[...segments, 'health'].join('/')}`;
  return { completion, health: url.toString() };
}

// Both the HTTP response and its body must finish within the fixed deadline.
async function requestText(url, init, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  let timeout;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(url, { ...init, signal: controller.signal });
        return { ok: response.ok, status: response.status, text: await response.text() };
      })(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new DOMException('Request timed out', 'AbortError'));
        }, timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timeout); }
}

async function preflight(healthUrl, fetchImpl) {
  try {
    const response = await requestText(healthUrl,
      { method: 'GET', headers: { Accept: 'application/json' } }, fetchImpl, PREFLIGHT_TIMEOUT_MS);
    check(response.status === 200 && JSON.parse(response.text)?.status === 'ok', 'health not ready');
  } catch {
    throw new Error('P1-B3 endpoint preflight failed: llama.cpp is unavailable or not ready.');
  }
  return { success: true, status: 'ok', timeoutMs: PREFLIGHT_TIMEOUT_MS };
}

function parseStageContent(content, specification) {
  let structuredOutput;
  try { structuredOutput = JSON.parse(content); } catch {
    return { schemaStatus: 'INVALID', structuredOutput: null };
  }
  return { schemaStatus: specification.validate(structuredOutput) ? 'VALID' : 'INVALID', structuredOutput };
}

function stageRecord(stageId, candidate, skipReason) {
  const { specification, promptVersion } = stageContract(stageId, candidate);
  return {
    stageId, invoked: skipReason === null, skipReason, promptVersion,
    taskSpecificationVersion: specification.taskSpecificationVersion,
    outputSchemaVersion: specification.outputSchemaVersion,
    attempted: false, completed: false, latencyMs: null, runtimeError: null,
    schemaStatus: 'NOT_APPLICABLE', structuredOutput: null, rawAssistantContent: null,
  };
}

function emptyCounts() {
  return { callsPlanned: 0, callsAttempted: 0, callsCompleted: 0,
    invalidStructuredOutputs: 0, runtimeFailures: 0 };
}

async function invokeStage(stageId, candidate, options, counts) {
  const result = stageRecord(stageId, candidate, null);
  const prompt = buildStagePrompt(stageId, candidate);
  const { specification } = stageContract(stageId, candidate);
  counts.callsPlanned += 1;
  const startedAt = performance.now();
  let response;
  result.attempted = true;
  counts.callsAttempted += 1;
  try {
    response = await requestText(options.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model.modelId, messages: prompt.messages, temperature: 0, max_tokens: 128,
        stream: false, chat_template_kwargs: { enable_thinking: false },
        response_format: { type: 'json_object' },
      }),
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
          counts.callsCompleted += 1;
          result.rawAssistantContent = content;
          Object.assign(result, parseStageContent(content, specification));
          if (result.schemaStatus === 'INVALID') counts.invalidStructuredOutputs += 1;
        }
      }
    }
  } catch (error) {
    result.runtimeError = error?.name === 'AbortError'
      ? { state: 'TIMEOUT', code: 'LOCAL_ENDPOINT_TIMEOUT' }
      : error instanceof TypeError && !response
        ? { state: 'UNAVAILABLE', code: 'LOCAL_ENDPOINT_UNAVAILABLE' }
        : { state: 'RUNNER_ERROR', code: 'LOCAL_RUNTIME_FAILURE' };
  } finally {
    result.latencyMs = performance.now() - startedAt;
  }
  if (result.runtimeError) counts.runtimeFailures += 1;
  return result;
}

function stageIds(arm) {
  check(['L4', 'D4', 'D1.7'].includes(arm), 'unknown arm');
  return arm === 'L4' ? ['triage', 'extraction'] : ['ambiguity', 'binary', 'extraction'];
}

function validDecision(stage) {
  return stage?.invoked && stage.completed && stage.schemaStatus === 'VALID'
    ? stage.structuredOutput.decision : null;
}

function skipAfter(previous) {
  if (!previous) return null;
  if (!previous.invoked) return previous.skipReason;
  if (previous.runtimeError) return 'UPSTREAM_RUNTIME_FAILURE';
  if (previous.schemaStatus !== 'VALID') return 'UPSTREAM_INVALID_OUTPUT';
  const decision = validDecision(previous);
  return ['CLEAR', 'WRITE_CANDIDATE'].includes(decision) ? null : `UPSTREAM_${decision}`;
}

function observedLatency(stages) {
  const samples = stages.filter(stage => stage.invoked && stage.latencyMs !== null);
  return samples.length ? samples.reduce((sum, stage) => sum + stage.latencyMs, 0) : null;
}

function scoreArmCase(arm, stages, humanGold, extractionGold) {
  const first = validDecision(arm === 'L4' ? stages.triage : stages.ambiguity);
  const decision = arm === 'L4' ? first : first === 'CLEAR' ? validDecision(stages.binary) : first;
  const extraction = stages.extraction;
  const extractionReached = decision === 'WRITE_CANDIDATE' && extraction.invoked;
  const extractionValid = extractionReached && extraction.completed && extraction.schemaStatus === 'VALID';
  const extractionExact = extractionValid && isDeepStrictEqual(extraction.structuredOutput, extractionGold);
  const runtimeFailures = Object.values(stages).filter(stage => stage.runtimeError !== null).length;
  return {
    stages,
    totalLatencyMs: observedLatency(Object.values(stages)),
    runtimeFailures,
    endToEndSuccess: runtimeFailures === 0 && (humanGold === 'WRITE_CANDIDATE'
      ? extractionExact : decision === humanGold),
    unsafeNonEscalation: humanGold === 'ESCALATE' && first !== 'ESCALATE',
    falseNoWrite: humanGold !== 'NO_WRITE' && decision === 'NO_WRITE',
    schemaValidExtractionWrongValue: humanGold === 'WRITE_CANDIDATE' && extractionValid && !extractionExact,
    terminalEscalation: first === 'ESCALATE',
  };
}

async function runArmCase(arm, candidate, humanGold, extractionGold, options, counts) {
  const stages = {};
  let previous;
  for (const stageId of stageIds(arm)) {
    const skipReason = skipAfter(previous);
    stages[stageId] = skipReason === null
      ? await invokeStage(stageId, candidate, options, counts)
      : stageRecord(stageId, candidate, skipReason);
    previous = stages[stageId];
  }
  return scoreArmCase(arm, stages, humanGold, extractionGold);
}

function summarizeCalls(stages) {
  const totalLatencyMs = observedLatency(stages);
  const invoked = stages.filter(stage => stage.invoked);
  return {
    callsPlanned: invoked.length,
    callsAttempted: stages.filter(stage => stage.attempted).length,
    callsCompleted: stages.filter(stage => stage.completed).length,
    invalidStructuredOutputs: stages.filter(stage => stage.schemaStatus === 'INVALID').length,
    runtimeFailures: stages.filter(stage => stage.runtimeError !== null).length,
    invokedCallCount: invoked.length, totalLatencyMs,
    meanInvokedCallLatencyMs: invoked.length ? totalLatencyMs / invoked.length : null,
  };
}

function summarizeArm(arm, cases) {
  const calls = summarizeCalls(cases.flatMap(item => Object.values(item.stages)));
  const result = {
    casesPlanned: 60, maxPossibleCalls: arm === 'L4' ? 120 : 180, ...calls,
    meanCaseTotalLatencyMs: cases.length ? calls.totalLatencyMs / cases.length : null,
    stages: Object.fromEntries(stageIds(arm).map(id => [id, summarizeCalls(cases.map(item => item.stages[id]))])),
  };
  for (const metric of ['endToEndSuccess', 'unsafeNonEscalation', 'falseNoWrite',
    'schemaValidExtractionWrongValue', 'terminalEscalation']) {
    result[metric] = cases.filter(item => item[metric]).length;
  }
  result.endToEndSuccessRate = cases.length ? result.endToEndSuccess / cases.length : null;
  result.terminalEscalationRate = cases.length ? result.terminalEscalation / cases.length : null;
  return result;
}

function currentCommit() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
}

async function runPhase(options, inputs = loadInputs()) {
  check(Object.keys(options).every(key => ['phase', 'endpoint', 'commit', 'fetchImpl'].includes(key)),
    'unsupported runner option');
  check(Object.hasOwn(PHASES, options.phase), 'phase must be 4b or 1.7b');
  const phase = PHASES[options.phase];
  const commit = options.commit ?? currentCommit();
  check(/^[a-f0-9]{40}$/u.test(commit), 'commit must be a full Galpi SHA');
  validateInputs(inputs);
  const urls = endpointUrls(options.endpoint);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const readiness = await preflight(urls.health, fetchImpl);
  const counts = emptyCounts();
  const observations = [];
  for (const [index, candidate] of inputs.candidates.cases.entries()) {
    const humanGoldLabel = inputs.human.labels[index].label;
    const arms = {};
    for (const arm of phase.arms) {
      arms[arm] = await runArmCase(arm, candidate, humanGoldLabel,
        inputs.authoring.cases[candidate.caseId].extractionGold,
        { endpoint: urls.completion, model: phase.model, fetchImpl }, counts);
    }
    observations.push({ caseId: candidate.caseId, humanGoldLabel, arms });
  }
  return {
    reportVersion: phase.reportVersion, generatedAt: new Date().toISOString(),
    galpiCommit: commit, runnerVersion: RUNNER_VERSION, scoringVersion: SCORING_VERSION,
    phase: options.phase, inputs: inputs.provenance, model: phase.model, runtime: RUNTIME,
    timeoutMs: TIMEOUT_MS, automaticReruns: false, preflight: readiness,
    execution: { casesPlanned: 60, maxPossibleCalls: phase.maxPossibleCalls, ...counts },
    observations,
    armSummaries: Object.fromEntries(phase.arms.map(arm => [
      arm, summarizeArm(arm, observations.map(item => item.arms[arm])),
    ])),
  };
}

function parseArguments(argv) {
  const options = {};
  const names = { '--phase': 'phase', '--endpoint': 'endpoint', '--commit': 'commit' };
  for (let index = 0; index < argv.length; index += 2) {
    const key = names[argv[index]];
    check(key && !Object.hasOwn(options, key) && argv[index + 1]
      && !argv[index + 1].startsWith('--'), 'expected --phase 4b|1.7b --endpoint URL [--commit SHA]');
    options[key] = argv[index + 1];
  }
  check(Object.hasOwn(PHASES, options.phase) && options.endpoint, 'phase and endpoint are required');
  endpointUrls(options.endpoint);
  if (options.commit !== undefined) check(/^[a-f0-9]{40}$/u.test(options.commit), 'invalid commit SHA');
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const report = await runPhase(parseArguments(argv));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.execution.runtimeFailures > 0 ? 1 : 0;
}

module.exports = {
  RUNNER_VERSION, SCORING_VERSION, PHASES, RUNTIME, TIMEOUT_MS, PREFLIGHT_TIMEOUT_MS,
  INPUT_FILES, INPUT_IDENTITIES, BINARY_PROMPT_VERSION, BINARY_INSTRUCTION, BINARY_SPECIFICATION,
  check, exactKeys, loadInputs, validateInputs, stageContract, buildStagePrompt, endpointUrls,
  stageIds, stageRecord, skipAfter, parseStageContent, scoreArmCase, summarizeCalls, summarizeArm,
  runPhase, parseArguments, main,
};

if (require.main === module) {
  main().then(code => { process.exitCode = code; }, error => {
    console.error(`P1-B3 runner failed: ${error.message}`);
    process.exitCode = 1;
  });
}
