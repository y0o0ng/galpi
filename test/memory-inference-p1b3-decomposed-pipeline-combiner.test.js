'use strict';

const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const {
  runPhase, loadInputs,
} = require('../scripts/run-memory-inference-p1b3-decomposed-pipeline');
const {
  COMBINER_VERSION, COMBINED_REPORT_VERSION, TRANSITIONS,
  combineReports, pairedTransition, parseArguments,
} = require('../scripts/combine-memory-inference-p1b3-decomposed-pipeline');

mock.method(globalThis, 'fetch', () => { throw new Error('Real network forbidden in P1-B3 tests'); });
test.after(() => mock.restoreAll());
const inputs = loadInputs();
const noWriteIds = inputs.human.labels.filter(row => row.label === 'NO_WRITE').map(row => row.caseId);
const writeId = inputs.human.labels.find(row => row.label === 'WRITE_CANDIDATE').caseId;
const escalateId = inputs.human.labels.find(row => row.label === 'ESCALATE').caseId;

// Synthetic reports stay in memory; every call, including readiness, uses this fake.
async function fakeReport(phase, override = () => undefined) {
  let arm;
  return runPhase({ phase, endpoint: 'http://p1b3.invalid/v1', commit: 'a'.repeat(40),
    fetchImpl: async (url, init) => {
      if (init.method === 'GET') return { ok: true, status: 200, text: async () => '{"status":"ok"}' };
      const message = JSON.parse(init.body).messages[1].content;
      const input = JSON.parse(message.slice(message.lastIndexOf('\nINPUT: ') + 8));
      const index = inputs.candidates.cases.findIndex(row => row.inputPayload.evidence === input.evidence);
      const candidate = inputs.candidates.cases[index];
      const gold = inputs.human.labels[index].label;
      const stage = message.includes('TASK_SPECIFICATION: p1b3-binary') ? 'binary'
        : message.includes('TASK_SPECIFICATION: p1b1-ambiguity') ? 'ambiguity'
          : message.includes('TASK_SPECIFICATION: p1b1-write') ? 'triage' : 'extraction';
      if (stage === 'triage') arm = 'L4';
      if (stage === 'ambiguity') arm = phase === '4b' ? 'D4' : 'D1.7';
      let output = override({ arm, stage, caseId: candidate.caseId, gold });
      if (output instanceof Error) throw output;
      if (output === undefined) output = stage === 'extraction'
        ? inputs.authoring.cases[candidate.caseId].extractionGold
        : { decision: stage === 'ambiguity' ? gold === 'ESCALATE' ? 'ESCALATE' : 'CLEAR' : gold };
      const content = typeof output === 'string' ? output : JSON.stringify(output);
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) };
    },
  });
}

function l4Failures(count) {
  return ({ arm, stage, caseId }) => arm === 'L4' && stage === 'triage'
    && noWriteIds.slice(0, count).includes(caseId) ? { decision: 'ESCALATE' } : undefined;
}

test('deterministic combination preserves three arms, all pairs, input provenance, and no-signal disposition', async () => {
  const four = await fakeReport('4b');
  const small = await fakeReport('1.7b');
  const combined = combineReports(four, small);
  assert.equal(combined.reportVersion, COMBINED_REPORT_VERSION);
  assert.equal(combined.combinerVersion, COMBINER_VERSION);
  assert.deepEqual(combined.inputs, inputs.provenance);
  assert.deepEqual(Object.keys(combined.armSummaries), ['L4', 'D4', 'D1.7']);
  assert.deepEqual(combined.observations.map(row => row.caseId), inputs.candidates.cases.map(row => row.caseId));
  for (const pair of ['L4->D4', 'D4->D1.7', 'L4->D1.7']) {
    assert.deepEqual(combined.pairedComparisons[pair], {
      UNCHANGED_CORRECT: 60, FIXED: 0, REGRESSION: 0, UNCHANGED_WRONG: 0, NONCOMPARABLE_RUNTIME: 0,
    });
  }
  assert.equal(combined.finalDisposition, 'NO_SPECIALIZED_TRAINING_SIGNAL');
  assert.equal(combined.runtimeFailures, 0);
  assert.equal(JSON.stringify(combineReports(four, small)), JSON.stringify(combined));
});

test('paired categories include semantic invalidity as comparable and runtime only as noncomparable', () => {
  const success = { endToEndSuccess: true, runtimeFailures: 0 };
  const failure = { endToEndSuccess: false, runtimeFailures: 0 };
  const runtime = { endToEndSuccess: false, runtimeFailures: 1 };
  assert.deepEqual([
    pairedTransition(success, success), pairedTransition(failure, success),
    pairedTransition(success, failure), pairedTransition(failure, failure), pairedTransition(runtime, success),
  ], TRANSITIONS);
  assert.equal(pairedTransition(success, runtime), 'NONCOMPARABLE_RUNTIME');
  assert.equal(pairedTransition(runtime, runtime), 'NONCOMPARABLE_RUNTIME');
});

test('raw invalid JSON/schema remains semantic FIXED/REGRESSION/UNCHANGED_WRONG in real combiner paths', async () => {
  const four = await fakeReport('4b', ({ arm, stage, caseId }) => arm === 'L4' && stage === 'triage'
    && noWriteIds.slice(0, 2).includes(caseId) ? 'invalid JSON' : undefined);
  const small = await fakeReport('1.7b', ({ stage, caseId }) => stage === 'ambiguity'
    && noWriteIds.slice(1, 3).includes(caseId) ? { extra: 'invalid schema' } : undefined);
  const combined = combineReports(four, small);
  assert.deepEqual(combined.pairedComparisons['L4->D1.7'], {
    UNCHANGED_CORRECT: 57, FIXED: 1, REGRESSION: 1, UNCHANGED_WRONG: 1, NONCOMPARABLE_RUNTIME: 0,
  });
  assert.equal(combined.finalDisposition, 'NO_SPECIALIZED_TRAINING_SIGNAL');
});

test('the +10 percentage-point trigger passes at exactly +6 cases and fails at +5', async () => {
  const small = await fakeReport('1.7b');
  for (const count of [5, 6, 7]) {
    const combined = combineReports(await fakeReport('4b', l4Failures(count)), small);
    assert.equal(combined.trainingTrigger.netSuccessfulCases, count);
    assert.equal(combined.trainingTrigger.deltaPercentagePoints, count * 100 / 60);
    assert.equal(combined.trainingTrigger.atLeastTenPercentagePoints, count >= 6);
    assert.match(combined.trainingTrigger.rule, />= 10 percentage points/u);
    assert.equal(combined.finalDisposition, count >= 6
      ? 'SPECIALIZED_TRAINING_WORTH_INVESTIGATING' : 'NO_SPECIALIZED_TRAINING_SIGNAL');
  }
  const withRegression = await fakeReport('1.7b', ({ stage, caseId }) => stage === 'ambiguity'
    && caseId === noWriteIds[7] ? '{}' : undefined);
  const combined = combineReports(await fakeReport('4b', l4Failures(7)), withRegression);
  assert.equal(combined.trainingTrigger.netSuccessfulCases, 6);
  assert.equal(combined.pairedComparisons['L4->D1.7'].FIXED, 7);
  assert.equal(combined.pairedComparisons['L4->D1.7'].REGRESSION, 1);
  assert.equal(combined.finalDisposition, 'SPECIALIZED_TRAINING_WORTH_INVESTIGATING');
});

test('each D1.7 safety-zero veto independently prevents a training signal despite enough improvement', async () => {
  const four = await fakeReport('4b', l4Failures(12));
  const variants = [
    ['zeroUnsafeNonEscalation', ({ caseId, stage }) => caseId === escalateId
      ? stage === 'ambiguity' ? { decision: 'CLEAR' }
        : stage === 'binary' ? { decision: 'WRITE_CANDIDATE' } : undefined : undefined],
    ['zeroFalseNoWrite', ({ caseId, stage }) => caseId === writeId && stage === 'binary'
      ? { decision: 'NO_WRITE' } : undefined],
    ['zeroSchemaValidExtractionWrongValue', ({ caseId, stage }) => caseId === writeId && stage === 'extraction'
      ? { preferredMode: 'wrong' } : undefined],
  ];
  for (const [gate, override] of variants) {
    const combined = combineReports(four, await fakeReport('1.7b', override));
    assert.equal(combined.trainingTrigger[gate], false);
    assert.equal(combined.trainingTrigger.atLeastTenPercentagePoints, true);
    assert.equal(combined.finalDisposition, 'NO_SPECIALIZED_TRAINING_SIGNAL');
  }
});

test('any runtime failure in any arm dominates the trigger and only affected pairs are noncomparable', async () => {
  for (const failingArm of ['L4', 'D4', 'D1.7']) {
    const failure = ({ arm, caseId, stage }) => arm === failingArm && caseId === noWriteIds[0]
      && ['triage', 'ambiguity'].includes(stage) ? new TypeError('fake offline') : undefined;
    const four = await fakeReport('4b', request => failure(request) ?? l4Failures(10)(request));
    const small = await fakeReport('1.7b', failure);
    const combined = combineReports(four, small);
    assert.equal(combined.runtimeFailures, 1);
    assert.equal(combined.trainingTrigger.atLeastTenPercentagePoints, true);
    assert.equal(combined.finalDisposition, 'INDETERMINATE_RUNTIME');
    for (const [pair, counts] of Object.entries(combined.pairedComparisons)) {
      assert.equal(counts.NONCOMPARABLE_RUNTIME, pair.split('->').includes(failingArm) ? 1 : 0);
    }
  }
});

test('combiner rejects mismatched provenance, altered stage contracts, missing/reordered cases/arms, and forged scoring', async () => {
  const four = await fakeReport('4b');
  const small = await fakeReport('1.7b');
  for (const mutate of [
    value => { value.galpiCommit = 'b'.repeat(40); },
    value => { value.runnerVersion = 'other'; },
    value => { value.scoringVersion = 'other'; },
    value => { value.reportVersion = 'other'; },
    value => { value.phase = '4b'; },
    value => { value.runtime.family = 'other'; },
    value => { value.runtime.version = 'other'; },
    value => { value.timeoutMs = 60000; },
    value => { value.automaticReruns = true; },
    value => { value.preflight.success = false; },
    value => { value.model.modelId = 'other'; },
    value => { value.model.artifactId = 'other'; },
    value => { value.model.quantization = 'Q4'; },
    value => { value.model.modelSizeClass = '~4B'; },
    ...['candidates', 'human', 'authoring'].flatMap(key => [
      value => { value.inputs[key].identity = 'other'; },
      value => { value.inputs[key].sha256 = '0'.repeat(64); },
    ]),
    value => { value.observations.pop(); },
    value => { value.observations.reverse(); },
    value => { value.observations[0].caseId = value.observations[1].caseId; },
    value => { value.observations[0].humanGoldLabel = 'ESCALATE'; },
    value => { value.observations[0].arms.D4 = value.observations[0].arms['D1.7']; },
    value => { delete value.observations[0].arms['D1.7']; },
    value => { value.observations[0].arms['D1.7'].endToEndSuccess = false; },
    value => { value.observations[0].arms['D1.7'].runtimeFailures = 1; },
    value => { value.observations[0].arms['D1.7'].stages.ambiguity.promptVersion = 'other'; },
    value => { value.observations[0].arms['D1.7'].stages.ambiguity.outputSchemaVersion = 'other'; },
    value => { value.observations[0].arms['D1.7'].stages.ambiguity.taskSpecificationVersion = 'other'; },
    value => { value.observations[0].arms['D1.7'].stages.ambiguity.rawAssistantContent = '{}'; },
    value => { value.observations[0].arms['D1.7'].stages.ambiguity.attempted = false; },
    value => { value.observations[0].arms['D1.7'].stages.ambiguity.latencyMs = -1; },
    value => { value.observations[0].arms['D1.7'].stages.extraction.invoked = true; },
    value => { value.execution.callsAttempted += 1; },
    value => { value.armSummaries['D1.7'].endToEndSuccess -= 1; },
  ]) {
    const modified = structuredClone(small);
    mutate(modified);
    assert.throws(() => combineReports(four, modified));
  }
  const missingD4 = structuredClone(four);
  delete missingD4.observations[0].arms.D4;
  assert.throws(() => combineReports(missingD4, small));
  const both4 = structuredClone(four);
  const both1 = structuredClone(small);
  both4.inputs.human.sha256 = both1.inputs.human.sha256 = '0'.repeat(64);
  assert.throws(() => combineReports(both4, both1), /identities\/SHA-256/);
});

test('combiner CLI accepts only the two report paths and has no inference option', () => {
  assert.deepEqual(parseArguments(['--4b-report', '/tmp/fake4.json', '--1p7b-report', '/tmp/fake1.json']),
    { report4b: '/tmp/fake4.json', report1p7b: '/tmp/fake1.json' });
  for (const args of [[], ['--4b-report', 'x'], ['--4b-report', 'x', '--1p7b-report'],
    ['--4b-report', 'x', '--1p7b-report', 'y', '--endpoint', 'http://p1b3.invalid'],
    ['--4b-report', 'x', '--1p7b-report', 'y', '--4b-report', 'z']]) {
    assert.throws(() => parseArguments(args));
  }
  assert.equal(require('../package.json').scripts['research:memory-inference-p1b3-combine'],
    'node scripts/combine-memory-inference-p1b3-decomposed-pipeline.js');
});
