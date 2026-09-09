#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const { performance } = require('node:perf_hooks');
const {
  PHASES, RUNTIME, TIMEOUT_MS, PREFLIGHT_TIMEOUT_MS, exactKeys, stageContract,
  buildStagePrompt, endpointUrls, requestText, preflight, parseStageContent,
} = require('./run-memory-inference-p1b3-decomposed-pipeline');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE_FILE = 'fixtures/local-memory-inference-p1b6-anchor-marker-pilot.json';
const FIXTURE_IDENTITY = 'xion-local-memory-inference-p1b6-anchor-marker-pilot-v1';
const FIXTURE_SHA256 = 'e530ea9d2b1b2ea5ce42557a9cbb9828f97d14f6ab431e7dbb71ebbc825196e0';
const RUNNER_VERSION = 'xion-local-memory-inference-p1b6-anchor-marker-pilot-runner-v1';
const PROMPT_VERSION = 'xion-local-memory-inference-p1b6-anchor-marker-pilot-prompt-v1';
const RENDERER_VERSION = 'xion-local-memory-inference-p1b6-anchor-marker-renderer-v1';
const SCORING_VERSION = 'xion-local-memory-inference-p1b6-anchor-marker-pilot-scoring-v1';
const REPORT_VERSION = 'xion-local-memory-inference-p1b6-anchor-marker-pilot-report-v1';
const TASK_VERSION = 'p1b6-anchor-marker-pilot-v1';
const VARIANTS = Object.freeze(['A', 'B']);
const MODEL = PHASES['1.7b'].model;
const SPECIFICATION = stageContract('ambiguity').specification;
const SYSTEM_SCAFFOLD = buildStagePrompt('ambiguity', { inputPayload: { evidence: '' } }).messages[0].content;
const REQUEST_SETTINGS = Object.freeze({
  temperature: 0, max_tokens: 128, stream: false,
  chat_template_kwargs: Object.freeze({ enable_thinking: false }),
  response_format: Object.freeze({ type: 'json_object' }),
});
const INSTRUCTION = `The visible conversation contains one candidate/topic under judgment.
Text enclosed by [TARGET]...[/TARGET] marks source-grounded mentions of that candidate/topic.

The marker tells you WHAT TOPIC to judge. It does not by itself assert a full proposition, resolve a referent, select an attribute/value, or supply a semantic answer.

If multiple TARGET spans appear, they are explicit source mentions marked as the same candidate/topic for this input.

Return CLEAR when the visible target and evidence establish one sufficiently resolved decision-relevant semantic interpretation for downstream durability classification.

An explicitly tentative, undecided, provisional, temporary, approximate, negative, quoted/example-only, or non-user state may be CLEAR when that status itself is unambiguously established.

Return ESCALATE only when a materially relevant semantic status of the target cannot be determined from the visible evidence.

Do not treat missing durability/persistence evidence as ambiguity when the current semantic state itself is clear.
Do not treat absence of evidence as evidence of absence.
Do not infer omitted conversation.
Do not decide durability.
Do not perform extraction.
Do not resolve ambiguity yourself.`;

function check(condition, message) {
  if (!condition) throw new TypeError(`P1-B6 anchor-marker pilot ${message}`);
}

function quoteCount(text, quote) {
  return text.split(quote).length - 1;
}

function stripTargetTags(text) {
  return text.replaceAll('[TARGET]', '').replaceAll('[/TARGET]', '');
}

function renderEvidence(pilotCase, variant) {
  check(VARIANTS.includes(variant), 'variant must be A or B');
  const selected = variant === 'A' ? [pilotCase.representativeMention] : pilotCase.explicitMentions;
  return pilotCase.turns.map(turn => {
    let text = turn.text;
    for (const mention of selected.filter(row => row.turnId === turn.turnId)) {
      text = text.replace(mention.quote, `[TARGET]${mention.quote}[/TARGET]`);
    }
    return `${turn.role}: ${text}`;
  }).join('\n');
}

function validateFixture(fixture) {
  check(exactKeys(fixture, ['name', 'cases']), 'fixture keys mismatch');
  check(fixture.name === FIXTURE_IDENTITY, 'fixture identity mismatch');
  check(Array.isArray(fixture.cases) && fixture.cases.length === 20, 'fixture must contain 20 cases');
  const expectedIds = Array.from({ length: 20 }, (_, index) => String(index + 1).padStart(3, '0'));
  check(isDeepStrictEqual(fixture.cases.map(row => row.caseId), expectedIds), 'case IDs/order mismatch');

  const gold = { CLEAR: 0, ESCALATE: 0 };
  for (const pilotCase of fixture.cases) {
    check(exactKeys(pilotCase,
      ['caseId', 'humanGoldDecision', 'turns', 'representativeMention', 'explicitMentions']),
    `case keys mismatch: ${pilotCase.caseId}`);
    check(Object.hasOwn(gold, pilotCase.humanGoldDecision), `invalid gold: ${pilotCase.caseId}`);
    gold[pilotCase.humanGoldDecision] += 1;
    check(Array.isArray(pilotCase.turns) && pilotCase.turns.length > 0, `missing turns: ${pilotCase.caseId}`);
    const turnIds = new Set();
    for (const turn of pilotCase.turns) {
      check(exactKeys(turn, ['turnId', 'role', 'text']), `turn keys mismatch: ${pilotCase.caseId}`);
      check(/^t[1-9]\d*$/u.test(turn.turnId) && !turnIds.has(turn.turnId), `invalid turn ID: ${pilotCase.caseId}`);
      check(['USER', 'ASSISTANT'].includes(turn.role) && typeof turn.text === 'string' && turn.text.length > 0,
        `invalid turn: ${pilotCase.caseId}/${turn.turnId}`);
      check(!turn.text.includes('[TARGET]') && !turn.text.includes('[/TARGET]'), `source contains marker: ${pilotCase.caseId}`);
      turnIds.add(turn.turnId);
    }
    check(Array.isArray(pilotCase.explicitMentions) && pilotCase.explicitMentions.length >= 2,
      `at least two mentions required: ${pilotCase.caseId}`);
    const mentionKeys = new Set();
    for (const mention of pilotCase.explicitMentions) {
      check(exactKeys(mention, ['turnId', 'quote']) && turnIds.has(mention.turnId)
        && typeof mention.quote === 'string' && mention.quote.length > 0,
      `invalid mention: ${pilotCase.caseId}`);
      const turn = pilotCase.turns.find(row => row.turnId === mention.turnId);
      check(quoteCount(turn.text, mention.quote) === 1, `mention quote must occur once: ${pilotCase.caseId}/${mention.turnId}`);
      const key = `${mention.turnId}\0${mention.quote}`;
      check(!mentionKeys.has(key), `duplicate mention: ${pilotCase.caseId}`);
      mentionKeys.add(key);
    }
    check(isDeepStrictEqual(pilotCase.representativeMention, pilotCase.explicitMentions[0]),
      `representative mention must be first: ${pilotCase.caseId}`);
    check(stripTargetTags(renderEvidence(pilotCase, 'A')) === stripTargetTags(renderEvidence(pilotCase, 'B')),
      `A/B evidence bytes differ: ${pilotCase.caseId}`);
  }
  check(isDeepStrictEqual(gold, { CLEAR: 13, ESCALATE: 7 }), 'gold distribution mismatch');
  return fixture;
}

function loadFixture() {
  const bytes = fs.readFileSync(path.join(ROOT, FIXTURE_FILE));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  check(sha256 === FIXTURE_SHA256, 'fixture raw SHA-256 mismatch');
  return {
    fixture: validateFixture(JSON.parse(bytes)),
    provenance: {
      file: FIXTURE_FILE,
      identity: FIXTURE_IDENTITY,
      sha256,
    },
  };
}

function buildPilotPrompt(pilotCase, variant) {
  return {
    promptVersion: PROMPT_VERSION,
    taskSpecificationVersion: TASK_VERSION,
    outputSchemaVersion: SPECIFICATION.outputSchemaVersion,
    messages: [
      { role: 'system', content: SYSTEM_SCAFFOLD },
      { role: 'user', content: [
        'WORKLOAD: ambiguity_escalation',
        `TASK_SPECIFICATION: ${TASK_VERSION}`,
        `INSTRUCTION: ${INSTRUCTION}`,
        `OUTPUT_SCHEMA: ${JSON.stringify(SPECIFICATION.outputSchema)}`,
        `INPUT: ${JSON.stringify({ evidence: renderEvidence(pilotCase, variant) })}`,
      ].join('\n') },
    ],
  };
}

function emptyResult(caseId, variant) {
  return {
    caseId, variant, attempted: true, completed: false,
    promptVersion: PROMPT_VERSION, rendererVersion: RENDERER_VERSION,
    taskSpecificationVersion: TASK_VERSION,
    outputSchemaVersion: SPECIFICATION.outputSchemaVersion,
    latencyMs: null, schemaStatus: null, structuredOutput: null,
  };
}

async function invokeVariant(pilotCase, variant, endpoint, fetchImpl) {
  const result = emptyResult(pilotCase.caseId, variant);
  const startedAt = performance.now();
  let response;
  try {
    response = await requestText(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL.modelId,
        messages: buildPilotPrompt(pilotCase, variant).messages, ...REQUEST_SETTINGS }),
    }, fetchImpl, TIMEOUT_MS);
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

function scoreRecord(pilotCase, variant, result) {
  const decision = result.runtimeError ? 'RUNTIME_FAILURE'
    : result.schemaStatus === 'VALID' ? result.structuredOutput.decision : 'INVALID';
  return {
    caseId: pilotCase.caseId, variant, humanGoldDecision: pilotCase.humanGoldDecision,
    result, decision, correct: decision === pilotCase.humanGoldDecision,
  };
}

function pairRecords(records) {
  const pairs = [];
  for (let index = 0; index < records.length; index += 2) {
    const a = records[index];
    const b = records[index + 1];
    check(a.caseId === b.caseId && a.variant === 'A' && b.variant === 'B', 'raw pair order mismatch');
    const classification = a.correct
      ? b.correct ? 'STABLE_CORRECT' : 'REGRESSION'
      : b.correct ? 'FIXED' : 'STABLE_WRONG';
    const bothValid = ['CLEAR', 'ESCALATE'].includes(a.decision) && ['CLEAR', 'ESCALATE'].includes(b.decision);
    pairs.push({
      caseId: a.caseId, humanGoldDecision: a.humanGoldDecision,
      aDecision: a.decision, bDecision: b.decision, classification,
      schemaValidDecisionChanged: bothValid ? a.decision !== b.decision : null,
    });
  }
  return pairs;
}

function summarize(records, pairs) {
  const variantSummary = variant => {
    const rows = records.filter(row => row.variant === variant);
    return Object.fromEntries([
      ['correct', rows.filter(row => row.correct).length],
      ...['CLEAR', 'ESCALATE', 'INVALID', 'RUNTIME_FAILURE']
        .map(decision => [decision, rows.filter(row => row.decision === decision).length]),
    ]);
  };
  const pairCounts = Object.fromEntries(['STABLE_CORRECT', 'STABLE_WRONG', 'FIXED', 'REGRESSION']
    .map(label => [label, pairs.filter(row => row.classification === label).length]));
  return {
    cases: pairs.length,
    humanGold: { CLEAR: records.filter(row => row.variant === 'A' && row.humanGoldDecision === 'CLEAR').length,
      ESCALATE: records.filter(row => row.variant === 'A' && row.humanGoldDecision === 'ESCALATE').length },
    variants: { A: variantSummary('A'), B: variantSummary('B') },
    pairs: pairCounts,
    schemaValidDecisionChanges: pairs.filter(row => row.schemaValidDecisionChanged === true).length,
    runtimeFailures: records.filter(row => row.decision === 'RUNTIME_FAILURE').length,
  };
}

function mechanicalDisposition(summary) {
  if (summary.runtimeFailures > 0) return 'INDETERMINATE_RUNTIME';
  if (summary.pairs.REGRESSION > 0 || summary.pairs.FIXED < 2) return 'SINGLE_REQUIRED';
  return 'REPEATED_REVIEW_ELIGIBLE';
}

function assembleReport(records, galpiCommit, generatedAt, source) {
  const pairs = pairRecords(records);
  const summary = summarize(records, pairs);
  return {
    reportVersion: REPORT_VERSION, runnerVersion: RUNNER_VERSION,
    promptVersion: PROMPT_VERSION, rendererVersion: RENDERER_VERSION,
    scoringVersion: SCORING_VERSION, taskSpecificationVersion: TASK_VERSION,
    outputSchemaVersion: SPECIFICATION.outputSchemaVersion,
    galpiCommit, generatedAt,
    fixture: { ...source.provenance, caseCount: source.fixture.cases.length },
    pilotBoundary: {
      calibrationOnly: true, fullSourceEqualsVisibleEvidence: true,
      outsideSupervised380: true, noSemanticSkeletonIds: true,
      futureSupervisedReuseForbidden: true, trainingBaseSelectionOpen: true,
    },
    model: MODEL, runtime: RUNTIME, requestSettings: REQUEST_SETTINGS,
    timeoutMs: TIMEOUT_MS, automaticReruns: false,
    preflight: { success: true, status: 'ok', timeoutMs: PREFLIGHT_TIMEOUT_MS },
    execution: {
      casesPlanned: 20, callsPlanned: 40,
      callsAttempted: records.filter(row => row.result.attempted).length,
      callsCompleted: records.filter(row => row.result.completed).length,
      invalidStructuredOutputs: records.filter(row => row.decision === 'INVALID').length,
      runtimeFailures: summary.runtimeFailures,
    },
    records, pairs, summary,
    mechanicalDisposition: mechanicalDisposition(summary),
  };
}

function validRuntimeError(error) {
  return exactKeys(error, ['state', 'code']) && (
    (error.state === 'TIMEOUT' && error.code === 'LOCAL_ENDPOINT_TIMEOUT')
    || (error.state === 'UNAVAILABLE' && error.code === 'LOCAL_ENDPOINT_UNAVAILABLE')
    || (error.state === 'RUNNER_ERROR' && (
      ['LOCAL_RUNTIME_FAILURE', 'LOCAL_RUNTIME_INVALID_JSON', 'LOCAL_RUNTIME_RESPONSE_INVALID'].includes(error.code)
      || /^LOCAL_HTTP_\d{3}$/u.test(error.code)
    ))
  );
}

function validateReport(report, source = loadFixture()) {
  check(typeof report.galpiCommit === 'string' && /^[a-f0-9]{40}$/u.test(report.galpiCommit), 'invalid report commit');
  check(typeof report.generatedAt === 'string' && Number.isFinite(Date.parse(report.generatedAt)), 'invalid report timestamp');
  const expectedOrder = source.fixture.cases.flatMap(row => VARIANTS.map(variant => `${row.caseId}${variant}`));
  check(Array.isArray(report.records) && isDeepStrictEqual(
    report.records.map(row => `${row.caseId}${row.variant}`), expectedOrder), 'record order mismatch');

  const records = report.records.map((row, index) => {
    const pilotCase = source.fixture.cases[Math.floor(index / 2)];
    const variant = VARIANTS[index % 2];
    const recorded = row.result;
    const expected = emptyResult(pilotCase.caseId, variant);
    check(Number.isFinite(recorded.latencyMs) && recorded.latencyMs >= 0, 'invalid record latency');
    expected.latencyMs = recorded.latencyMs;
    if (typeof recorded.rawAssistantContent === 'string') {
      expected.completed = true;
      expected.rawAssistantContent = recorded.rawAssistantContent;
      Object.assign(expected, parseStageContent(recorded.rawAssistantContent, SPECIFICATION));
    } else {
      check(validRuntimeError(recorded.runtimeError), 'invalid runtime error');
      expected.runtimeError = recorded.runtimeError;
    }
    check(isDeepStrictEqual(recorded, expected), `raw record mismatch: ${pilotCase.caseId}${variant}`);
    return scoreRecord(pilotCase, variant, expected);
  });
  const recomputed = assembleReport(records, report.galpiCommit, report.generatedAt, source);
  check(isDeepStrictEqual(report, recomputed), 'report identity/provenance/scoring/count mismatch');
  return recomputed;
}

async function runPilot(options) {
  check(options && Object.keys(options).every(key => ['endpoint', 'commit', 'fetchImpl'].includes(key)),
    'unsupported option');
  const galpiCommit = options.commit
    ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  check(/^[a-f0-9]{40}$/u.test(galpiCommit), 'commit must be a full Galpi SHA');
  const source = loadFixture();
  const urls = endpointUrls(options.endpoint);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  await preflight(urls.health, fetchImpl);
  const records = [];
  for (const pilotCase of source.fixture.cases) {
    for (const variant of VARIANTS) {
      records.push(scoreRecord(pilotCase, variant,
        await invokeVariant(pilotCase, variant, urls.completion, fetchImpl)));
    }
  }
  const report = assembleReport(records, galpiCommit, new Date().toISOString(), source);
  check(report.execution.callsAttempted === 40, 'planned/attempted invariant');
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
  const report = await runPilot(parseArguments(argv));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.mechanicalDisposition === 'INDETERMINATE_RUNTIME' ? 1 : 0;
}

module.exports = {
  FIXTURE_FILE, FIXTURE_IDENTITY, FIXTURE_SHA256, RUNNER_VERSION, PROMPT_VERSION, RENDERER_VERSION,
  SCORING_VERSION, REPORT_VERSION, TASK_VERSION, VARIANTS, MODEL, RUNTIME,
  TIMEOUT_MS, PREFLIGHT_TIMEOUT_MS, SPECIFICATION, REQUEST_SETTINGS, INSTRUCTION,
  stripTargetTags, renderEvidence, validateFixture, loadFixture, buildPilotPrompt,
  scoreRecord, pairRecords, summarize, mechanicalDisposition, assembleReport,
  validateReport, runPilot, parseArguments, main,
};

if (require.main === module) {
  main().then(code => { process.exitCode = code; }, error => {
    console.error(`P1-B6 anchor-marker pilot failed: ${error.message}`);
    process.exitCode = 1;
  });
}
