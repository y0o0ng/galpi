'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const skeletons = require('../lib/memory-inference-p1b6-skeletons');
const reviewer = require('../scripts/review-memory-inference-p1b6-skeleton-pass1');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE_PATH = path.join(
  ROOT,
  'test/fixtures/local-memory-inference-p1b6-skeleton-candidates-test.json',
);
const REVIEWER_SOURCE = path.join(ROOT, 'scripts/review-memory-inference-p1b6-skeleton-pass1.js');

function fixtureBytes() {
  return fs.readFileSync(FIXTURE_PATH);
}

function loadFixture() {
  return skeletons.parseSkeletonCandidateFixture(fixtureBytes());
}

function changedFixture(fixture, candidateIndex, patch) {
  const copy = structuredClone(fixture);
  Object.assign(copy.candidates[candidateIndex], patch);
  return copy;
}

function completeReviews(fixture) {
  return new Map(fixture.candidates.map((candidate, index) => [
    candidate.semanticSkeletonId,
    {
      disposition: skeletons.DISPOSITIONS[index % skeletons.DISPOSITIONS.length],
      ambiguityLabel: skeletons.AMBIGUITY_LABELS[index % skeletons.AMBIGUITY_LABELS.length],
    },
  ]));
}

test('P1-B6 skeleton fixture accepts only the frozen exact abstract schema', () => {
  const fixture = loadFixture();
  assert.equal(skeletons.validateSkeletonCandidateFixture(fixture), fixture);
  assert.equal(fixture.name, skeletons.CANDIDATE_FIXTURE_NAME);
  assert.deepEqual(skeletons.SPLIT_ASSIGNMENTS, ['TRAIN', 'DEV', 'FINAL_HELD_OUT']);
  assert.deepEqual(skeletons.AMBIGUITY_LABELS, ['CLEAR', 'ESCALATE']);
  assert.equal(skeletons.BOUNDARY_CLASSES.length, 8);

  for (const prohibited of [
    'language',
    'fragmentCount',
    'sourceText',
    'turnRefs',
    'anchorSpanRefs',
    'extractionSchema',
    'durabilityLabel',
    'modelOutput',
    'historicalFailureAnnotation',
    'surfaceDomain',
    'trainingSettings',
  ]) {
    assert.throws(
      () => skeletons.validateSkeletonCandidateFixture(changedFixture(fixture, 0, { [prohibited]: 'forbidden' })),
      /candidate keys/,
      prohibited,
    );
  }
  assert.throws(
    () => skeletons.validateSkeletonCandidateFixture({ ...fixture, metadata: {} }),
    /name과 candidates만/,
  );
  for (const candidates of [[], fixture.candidates.slice(0, 1)]) {
    assert.throws(
      () => skeletons.validateSkeletonCandidateFixture({ ...fixture, candidates }),
      /최소 2개 candidate/,
    );
  }
});

test('P1-B6 skeleton validation rejects duplicate IDs, semantic IDs, invalid enums, and bad relation counts', () => {
  const fixture = loadFixture();
  assert.throws(
    () => skeletons.validateSkeletonCandidateFixture(changedFixture(fixture, 1, {
      semanticSkeletonId: fixture.candidates[0].semanticSkeletonId,
    })),
    /중복 semanticSkeletonId/,
  );
  for (const patch of [
    { semanticSkeletonId: 'p1b6-sk-train-clear' },
    { splitAssignment: 'TEST' },
    { boundaryClass: 'OTHER' },
    { intendedLabel: 'NO_WRITE' },
  ]) {
    assert.throws(() => skeletons.validateSkeletonCandidateFixture(changedFixture(fixture, 0, patch)));
  }
  for (const semanticRelations of [['one'], ['1', '2', '3', '4', '5', '6']]) {
    assert.throws(
      () => skeletons.validateSkeletonCandidateFixture(changedFixture(fixture, 0, { semanticRelations })),
      /2–5개/,
    );
  }
  for (const patch of [
    { candidateFocus: ' ' },
    { candidateFocus: 'x'.repeat(skeletons.MAX_FOCUS_LENGTH + 1) },
    { semanticRelations: ['valid', 'x'.repeat(skeletons.MAX_RELATION_LENGTH + 1)] },
    { decisionBasis: '' },
    { decisionBasis: 'x'.repeat(skeletons.MAX_DECISION_BASIS_LENGTH + 1) },
    { contrastGroupId: undefined },
    { contrastGroupId: 'finality-train-clear' },
  ]) assert.throws(() => skeletons.validateSkeletonCandidateFixture(changedFixture(fixture, 0, patch)));
});

test('contrast-group members must stay in one split', () => {
  const fixture = loadFixture();
  assert.throws(
    () => skeletons.validateSkeletonCandidateFixture(changedFixture(fixture, 1, {
      splitAssignment: 'DEV',
    })),
    /contrast group은 하나의 split/,
  );
});

test('blind prompt shows the fixed ambiguity rubric and only candidate focus/relations', () => {
  const candidate = loadFixture().candidates[0];
  const prompt = skeletons.renderBlindReviewPrompt(candidate);
  assert.equal(prompt.startsWith(skeletons.FIXED_AMBIGUITY_RUBRIC), true);
  assert.match(prompt, /Explicit user uncertainty, tentativeness, provisionality, temporariness, approximation, or negative status may be CLEAR/u);
  assert.match(prompt, /ESCALATE only when materially different decision-relevant interpretations remain unresolved/u);
  assert.match(prompt, /CLEAR does not mean durable or memory-worthy/u);
  assert.equal(prompt.includes(candidate.candidateFocus), true);
  let cursor = -1;
  for (const relation of candidate.semanticRelations) {
    const next = prompt.indexOf(relation);
    assert.ok(next > cursor);
    cursor = next;
  }
  for (const hidden of [
    candidate.semanticSkeletonId,
    candidate.splitAssignment,
    candidate.boundaryClass,
    candidate.decisionBasis,
    candidate.contrastGroupId,
  ]) assert.equal(prompt.includes(hidden), false, hidden);

  const hiddenMetadataChanged = {
    ...candidate,
    semanticSkeletonId: 'p1b6-sk-ffffffffffffffff',
    splitAssignment: 'DEV',
    boundaryClass: 'REFERENT',
    intendedLabel: candidate.intendedLabel === 'CLEAR' ? 'ESCALATE' : 'CLEAR',
    decisionBasis: 'A different hidden decision basis.',
    contrastGroupId: 'p1b6-cg-ffffffffffffffff',
  };
  assert.equal(skeletons.renderBlindReviewPrompt(hiddenMetadataChanged), prompt);

  const source = fs.readFileSync(REVIEWER_SOURCE, 'utf8');
  assert.doesNotMatch(source, /authoring.?key|historical.*(?:report|output)|catalog.*\.json|fixtures\//iu);
  assert.doesNotMatch(source, /boundaryClass|intendedLabel|decisionBasis|contrastGroupId|splitAssignment/u);
});

test('review order is a deterministic complete non-authoring-order permutation', () => {
  const fixture = loadFixture();
  const first = skeletons.deterministicReviewOrder(fixture);
  const second = skeletons.deterministicReviewOrder(fixture);
  assert.deepEqual(first, second);
  assert.deepEqual([...first].sort((a, b) => a - b), fixture.candidates.map((_, index) => index));
  assert.notDeepEqual(first, fixture.candidates.map((_, index) => index));

  const alreadyHashOrdered = structuredClone(fixture);
  alreadyHashOrdered.candidates.sort((left, right) => {
    const digest = candidate => crypto.createHash('sha256')
      .update(`${skeletons.REVIEW_PROTOCOL_VERSION}\0${candidate.semanticSkeletonId}`)
      .digest('hex');
    return digest(left).localeCompare(digest(right))
      || left.semanticSkeletonId.localeCompare(right.semanticSkeletonId);
  });
  assert.notDeepEqual(
    skeletons.deterministicReviewOrder(alreadyHashOrdered),
    alreadyHashOrdered.candidates.map((_, index) => index),
  );
});

test('receipt binds raw fixture bytes and rejects stale or modified provenance', () => {
  const raw = fixtureBytes();
  const fixture = skeletons.parseSkeletonCandidateFixture(raw);
  const receipt = skeletons.buildCompletedReviewReceipt({
    fixture,
    fixtureSha256: skeletons.sha256RawBytes(raw),
    reviewsById: completeReviews(fixture),
    completedAt: '2026-09-07T00:00:00.000Z',
  });
  assert.equal(receipt.candidateFixtureSha256, skeletons.sha256RawBytes(raw));
  assert.equal(skeletons.validateCompletedReviewReceipt(receipt, raw), receipt);

  const modifiedRaw = Buffer.from(raw.toString('utf8').replace(
    'Present status of a contemplated action',
    'Present status of a contemplated activity',
  ));
  skeletons.parseSkeletonCandidateFixture(modifiedRaw);
  assert.notEqual(skeletons.sha256RawBytes(modifiedRaw), receipt.candidateFixtureSha256);
  assert.throws(
    () => skeletons.validateCompletedReviewReceipt(receipt, modifiedRaw),
    /provenance/,
  );
});

test('interrupted review writes nothing and never mutates candidate bytes or fixture', async () => {
  const rawBefore = fixtureBytes();
  const fixture = loadFixture();
  const fixtureBefore = structuredClone(fixture);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xion-p1b6-pass1-partial-'));
  const outputPath = path.join(directory, 'receipt.json');
  let calls = 0;
  await assert.rejects(
    reviewer.conductBlindPass1Review(rawBefore, {
      outputPath,
      ask: async () => {
        calls += 1;
        if (calls === 5) throw new Error('synthetic interruption');
        return '1';
      },
    }),
    /synthetic interruption/,
  );
  assert.equal(fs.existsSync(outputPath), false);
  assert.deepEqual(fixture, fixtureBefore);
  assert.deepEqual(fixtureBytes(), rawBefore);
});

test('complete review writes one canonical-order result per candidate and output is write-once', async () => {
  const raw = fixtureBytes();
  const fixture = loadFixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xion-p1b6-pass1-complete-'));
  const outputPath = path.join(directory, 'receipt.json');
  const prompts = [];
  const receipt = await reviewer.conductBlindPass1Review(
    raw,
    {
      outputPath,
      completedAt: '2026-09-07T00:00:00.000Z',
      ask: async prompt => {
        prompts.push(prompt);
        return prompt.startsWith('Ambiguity label') ? '2' : '1';
      },
    },
  );
  assert.equal(prompts.length, fixture.candidates.length * 2);
  assert.equal(
    prompts.filter(prompt => prompt.includes(skeletons.FIXED_AMBIGUITY_RUBRIC)).length,
    fixture.candidates.length,
  );
  assert.equal(receipt.name, skeletons.REVIEW_RECEIPT_NAME);
  assert.equal(receipt.protocolVersion, skeletons.REVIEW_PROTOCOL_VERSION);
  assert.equal(receipt.candidateFixture, skeletons.CANDIDATE_FIXTURE_NAME);
  assert.deepEqual(
    receipt.results.map(result => result.semanticSkeletonId),
    fixture.candidates.map(candidate => candidate.semanticSkeletonId),
  );
  assert.equal(new Set(receipt.results.map(result => result.semanticSkeletonId)).size, fixture.candidates.length);
  assert.ok(receipt.results.every(result => result.disposition === 'KEEP'));
  assert.ok(receipt.results.every(result => result.ambiguityLabel === 'ESCALATE'));
  assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, 'utf8')), receipt);
  await assert.rejects(
    reviewer.conductBlindPass1Review(raw, {
      outputPath,
      ask: async () => '1',
    }),
    /EEXIST/,
  );
});

test('only fixed disposition and ambiguity choices are accepted', () => {
  assert.deepEqual(skeletons.DISPOSITIONS, ['KEEP', 'FIX', 'REJECT']);
  assert.equal(reviewer.parseDispositionChoice('1'), 'KEEP');
  assert.equal(reviewer.parseDispositionChoice('2'), 'FIX');
  assert.equal(reviewer.parseDispositionChoice('3'), 'REJECT');
  assert.equal(reviewer.parseDispositionChoice('KEEP'), null);
  assert.equal(reviewer.parseDispositionChoice('4'), null);
  assert.equal(reviewer.parseAmbiguityChoice('1'), 'CLEAR');
  assert.equal(reviewer.parseAmbiguityChoice('2'), 'ESCALATE');
  assert.equal(reviewer.parseAmbiguityChoice('CLEAR'), null);
  assert.equal(reviewer.parseAmbiguityChoice('3'), null);
  assert.throws(() => skeletons.validateDisposition('OTHER'));
  assert.throws(() => skeletons.validateAmbiguityLabel('NO_WRITE'));
});

test('CLI accepts only explicit input/output paths and package script is narrow', () => {
  assert.deepEqual(reviewer.parseArgs(['--input', 'in.json', '--output', 'out.json']), {
    inputPath: 'in.json',
    outputPath: 'out.json',
  });
  assert.throws(() => reviewer.parseArgs([]), /Usage/);
  assert.throws(() => reviewer.parseArgs(['--input', 'in.json']), /Usage/);
  assert.throws(() => reviewer.parseArgs(['--input', 'in.json', '--output', 'out.json', '--threshold', '1']), /Usage/);
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(
    packageJson.scripts['review:memory-inference-p1b6-skeleton-pass1'],
    'node scripts/review-memory-inference-p1b6-skeleton-pass1.js',
  );
});
