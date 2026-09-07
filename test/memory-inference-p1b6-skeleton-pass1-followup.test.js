'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const skeletons = require('../lib/memory-inference-p1b6-skeletons');
const followup = require('../scripts/review-memory-inference-p1b6-skeleton-pass1-followup');

const ROOT = path.resolve(__dirname, '..');
const ORIGINAL_FIXTURE_PATH = path.join(ROOT, 'fixtures/local-memory-inference-p1b6-skeleton-candidates.json');
const ORIGINAL_RECEIPT_PATH = path.join(ROOT, 'fixtures/local-memory-inference-p1b6-skeleton-human-pass1-receipt.json');
const FOLLOWUP_FIXTURE_PATH = path.join(ROOT, 'fixtures/local-memory-inference-p1b6-skeleton-pass1-followup-candidates.json');
const FOLLOWUP_PROTOCOL_PATH = path.join(ROOT, 'fixtures/local-memory-inference-p1b6-skeleton-pass1-followup-protocol.json');

const ORIGINAL_FIXTURE_SHA = 'c849037cc086d2806c61f21da100a94cc502b5e41b903fc511db705d305277c9';
const ORIGINAL_RECEIPT_SHA = '428f802a283ad9cddec6370595ceb157c95573cadcc252529898f419fd6fec75';
const FOLLOWUP_FIXTURE_SHA = '9791a61d4d46d7b6257642eda3cf6a677821f60e0d22afad71af0a5567b646f2';
const STARTING_MAIN_SHA = '12162a4d57894fe76cbb79590b4864f164ccbe1c';
const FIX_IDS = [
  'p1b6-sk-11a3e916ff9b8129',
  'p1b6-sk-f2fb3e894c37caac',
  'p1b6-sk-4e7a29da8a3037a4',
];
const REJECT_IDS = [
  'p1b6-sk-eb1cd528d84aa3f2',
  'p1b6-sk-348ebfd24bb7d3f5',
];
const KEEP_CLEAR_CORRECTION_ID = 'p1b6-sk-43016ef6da889a87';
const DISCARDED_REPLACEMENT_ID = 'p1b6-sk-3622bd6548e4d782';
const REPLACEMENT_ID = 'p1b6-sk-95b3c63acff8f020';

function read(pathname) {
  return fs.readFileSync(pathname);
}

function json(pathname) {
  return JSON.parse(fs.readFileSync(pathname, 'utf8'));
}

function followupBytes() {
  return read(FOLLOWUP_FIXTURE_PATH);
}

function followupFixture() {
  return followup.parseFollowupFixture(followupBytes());
}

function resolveByPrefix(fixture, prefix) {
  const matches = fixture.candidates.filter(candidate => (
    candidate.semanticSkeletonId.startsWith(`p1b6-sk-${prefix}`)
  ));
  assert.equal(matches.length, 1, prefix);
  return matches[0];
}

test('original Pass-1 artifacts remain byte-identical and prefixes resolve uniquely', () => {
  assert.equal(skeletons.sha256RawBytes(read(ORIGINAL_FIXTURE_PATH)), ORIGINAL_FIXTURE_SHA);
  assert.equal(skeletons.sha256RawBytes(read(ORIGINAL_RECEIPT_PATH)), ORIGINAL_RECEIPT_SHA);

  const original = skeletons.parseSkeletonCandidateFixture(read(ORIGINAL_FIXTURE_PATH));
  const receipt = skeletons.validateCompletedReviewReceipt(json(ORIGINAL_RECEIPT_PATH), read(ORIGINAL_FIXTURE_PATH));
  assert.equal(original.candidates.length, 72);
  assert.equal(receipt.results.length, 72);
  assert.deepEqual(FIX_IDS, ['11a3', 'f2fb', '4e7a'].map(prefix => resolveByPrefix(original, prefix).semanticSkeletonId));
  assert.deepEqual(REJECT_IDS, ['eb1c', '348e'].map(prefix => resolveByPrefix(original, prefix).semanticSkeletonId));
  assert.equal(resolveByPrefix(original, '43016').semanticSkeletonId, KEEP_CLEAR_CORRECTION_ID);
});

test('follow-up fixture contains only three retained FIX IDs and one new held-out persistence replacement', () => {
  const original = skeletons.parseSkeletonCandidateFixture(read(ORIGINAL_FIXTURE_PATH));
  const fixture = followupFixture();
  assert.equal(skeletons.sha256RawBytes(followupBytes()), FOLLOWUP_FIXTURE_SHA);
  assert.equal(fixture.name, skeletons.FOLLOWUP_CANDIDATE_FIXTURE_NAME);
  assert.equal(fixture.candidates.length, 4);
  assert.deepEqual(fixture.candidates.slice(0, 3).map(candidate => candidate.semanticSkeletonId), FIX_IDS);
  assert.equal(fixture.candidates[3].semanticSkeletonId, REPLACEMENT_ID);
  assert.match(REPLACEMENT_ID, skeletons.SKELETON_ID_PATTERN);
  assert.equal(original.candidates.some(candidate => candidate.semanticSkeletonId === REPLACEMENT_ID), false);
  assert.equal(fixture.candidates.some(candidate => candidate.semanticSkeletonId === DISCARDED_REPLACEMENT_ID), false);
  assert.equal(fixture.candidates.some(candidate => candidate.semanticSkeletonId === REJECT_IDS[1]), false);
  assert.equal(fixture.candidates.some(candidate => candidate.semanticSkeletonId === REJECT_IDS[0]), false);
  assert.equal(fixture.candidates.filter(candidate => !original.candidates.some(old => old.semanticSkeletonId === candidate.semanticSkeletonId)).length, 1);

  const replacement = fixture.candidates.find(candidate => candidate.semanticSkeletonId === REPLACEMENT_ID);
  assert.equal(replacement.splitAssignment, 'FINAL_HELD_OUT');
  assert.equal(replacement.boundaryClass, 'PERSISTENCE / EXCEPTION');
  assert.equal(replacement.intendedLabel, 'CLEAR');
});

test('follow-up protocol records source provenance and intentionally omitted work', () => {
  const protocol = json(FOLLOWUP_PROTOCOL_PATH);
  assert.equal(protocol.startingMainSha, STARTING_MAIN_SHA);
  assert.equal(protocol.originalCandidateFixture.path, 'fixtures/local-memory-inference-p1b6-skeleton-candidates.json');
  assert.equal(protocol.originalCandidateFixture.sha256, ORIGINAL_FIXTURE_SHA);
  assert.equal(protocol.originalPass1Receipt.path, 'fixtures/local-memory-inference-p1b6-skeleton-human-pass1-receipt.json');
  assert.equal(protocol.originalPass1Receipt.sha256, ORIGINAL_RECEIPT_SHA);
  assert.equal(protocol.followupCandidateFixture.sha256, skeletons.sha256RawBytes(followupBytes()));
  assert.deepEqual(protocol.sourceDecisions.fixSourceIds, FIX_IDS);
  assert.deepEqual(protocol.sourceDecisions.rejectSourceIds, REJECT_IDS);
  assert.deepEqual(protocol.sourceDecisions.keepClearCorrection, {
    sourceId: KEEP_CLEAR_CORRECTION_ID,
    correctedDisposition: 'KEEP',
    correctedAmbiguityLabel: 'CLEAR',
  });
  assert.deepEqual(protocol.sourceDecisions.replacementMapping, {
    [REJECT_IDS[0]]: REPLACEMENT_ID,
  });
  assert.deepEqual(protocol.sourceDecisions.noReplacementSourceIds, [REJECT_IDS[1]]);
  assert.deepEqual(protocol.replacementGenerator, {
    provider: 'OpenAI',
    surface: 'Codex',
    model: 'gpt-5.5',
    exposedSettings: { reasoning: 'medium' },
    platformControlledSettings: ['temperature', 'sampling', 'decoding', 'seed'],
    settingsStatement: 'Temperature, sampling, decoding, and seed controls were not exposed as numeric settings in this Codex session; they are platform-controlled and not invented.',
  });
  assert.ok(protocol.excludedWork.some(line => line.includes('Pass 2 is not performed')));
  assert.ok(protocol.excludedWork.some(line => line.includes('Exact-56 catalog freeze is not performed')));
  assert.ok(protocol.excludedWork.some(line => line.includes('Surface generation')));
});

test('blind follow-up prompt exposes only rubric, focus, relations, and non-semantic progress', async () => {
  const fixture = followupFixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xion-p1b6-followup-blind-'));
  const outputPath = path.join(directory, 'receipt.json');
  const prompts = [];
  await followup.conductBlindFollowupReview(followupBytes(), {
    outputPath,
    completedAt: '2026-09-07T10:00:00.000Z',
    ask: async prompt => {
      prompts.push(prompt);
      return prompt.startsWith('Ambiguity label') ? '1' : '1';
    },
  });
  const candidatePrompts = prompts.filter(prompt => prompt.includes(skeletons.FIXED_AMBIGUITY_RUBRIC));
  assert.equal(candidatePrompts.length, 4);
  assert.deepEqual(candidatePrompts.map(prompt => prompt.match(/^Case \d\/4/u)?.[0]), [
    'Case 1/4',
    'Case 2/4',
    'Case 3/4',
    'Case 4/4',
  ]);
  for (const prompt of candidatePrompts) {
    assert.equal(prompt.includes('Candidate focus:'), true);
    assert.equal(prompt.includes('Semantic relations:'), true);
    for (const hidden of [
      ...fixture.candidates.map(candidate => candidate.semanticSkeletonId),
      'FINAL_HELD_OUT',
      'PERSISTENCE / EXCEPTION',
      'APPROXIMATION / RANGE',
      'REFERENT',
      'intendedLabel',
      'decisionBasis',
      'contrastGroupId',
      'splitAssignment',
      'previous HUMAN',
      'sourceId',
    ]) assert.equal(prompt.includes(hidden), false, hidden);
  }
});

test('follow-up order is deterministic, complete, and not authoring order', () => {
  const fixture = followupFixture();
  const order = skeletons.deterministicReviewOrder(fixture, {
    fixtureName: skeletons.FOLLOWUP_CANDIDATE_FIXTURE_NAME,
    protocolVersion: skeletons.FOLLOWUP_REVIEW_PROTOCOL_VERSION,
  });
  assert.deepEqual(order, skeletons.deterministicReviewOrder(fixture, {
    fixtureName: skeletons.FOLLOWUP_CANDIDATE_FIXTURE_NAME,
    protocolVersion: skeletons.FOLLOWUP_REVIEW_PROTOCOL_VERSION,
  }));
  assert.deepEqual([...order].sort((a, b) => a - b), [0, 1, 2, 3]);
  assert.notDeepEqual(order, [0, 1, 2, 3]);
});

test('interruption writes no follow-up receipt', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xion-p1b6-followup-partial-'));
  const outputPath = path.join(directory, 'receipt.json');
  let calls = 0;
  await assert.rejects(
    followup.conductBlindFollowupReview(followupBytes(), {
      outputPath,
      ask: async () => {
        calls += 1;
        if (calls === 3) throw new Error('synthetic interruption');
        return '1';
      },
    }),
    /synthetic interruption/,
  );
  assert.equal(fs.existsSync(outputPath), false);
  assert.equal(skeletons.sha256RawBytes(followupBytes()), FOLLOWUP_FIXTURE_SHA);
});

test('complete follow-up run writes four canonical-order results and receipt binds raw bytes', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xion-p1b6-followup-complete-'));
  const outputPath = path.join(directory, 'receipt.json');
  const prompts = [];
  const receipt = await followup.conductBlindFollowupReview(followupBytes(), {
    outputPath,
    completedAt: '2026-09-07T10:00:00.000Z',
    ask: async prompt => {
      prompts.push(prompt);
      return prompt.startsWith('Ambiguity label') ? '2' : '1';
    },
  });
  const fixture = followupFixture();
  assert.equal(prompts.length, 8);
  assert.equal(receipt.name, skeletons.FOLLOWUP_REVIEW_RECEIPT_NAME);
  assert.equal(receipt.protocolVersion, skeletons.FOLLOWUP_REVIEW_PROTOCOL_VERSION);
  assert.equal(receipt.candidateFixture, skeletons.FOLLOWUP_CANDIDATE_FIXTURE_NAME);
  assert.equal(receipt.candidateFixtureSha256, FOLLOWUP_FIXTURE_SHA);
  assert.deepEqual(
    receipt.results.map(result => result.semanticSkeletonId),
    fixture.candidates.map(candidate => candidate.semanticSkeletonId),
  );
  assert.ok(receipt.results.every(result => result.disposition === 'KEEP'));
  assert.ok(receipt.results.every(result => result.ambiguityLabel === 'ESCALATE'));
  assert.equal(skeletons.validateCompletedReviewReceipt(receipt, followupBytes(), {
    fixtureName: skeletons.FOLLOWUP_CANDIDATE_FIXTURE_NAME,
    protocolVersion: skeletons.FOLLOWUP_REVIEW_PROTOCOL_VERSION,
    receiptName: skeletons.FOLLOWUP_REVIEW_RECEIPT_NAME,
  }), receipt);
});

test('follow-up receipt rejects stale fixture provenance and output is write-once', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xion-p1b6-followup-write-once-'));
  const outputPath = path.join(directory, 'receipt.json');
  const receipt = await followup.conductBlindFollowupReview(followupBytes(), {
    outputPath,
    completedAt: '2026-09-07T10:00:00.000Z',
    ask: async prompt => (prompt.startsWith('Ambiguity label') ? '1' : '1'),
  });
  await assert.rejects(
    followup.conductBlindFollowupReview(followupBytes(), {
      outputPath,
      ask: async () => '1',
    }),
    /EEXIST/,
  );

  const staleRaw = Buffer.from(followupBytes().toString('utf8').replace(
    '끝이 지정되지 않은 현재 중지 상태',
    '현재 적용되는 끝 없는 중지 상태',
  ));
  followup.parseFollowupFixture(staleRaw);
  assert.notEqual(skeletons.sha256RawBytes(staleRaw), receipt.candidateFixtureSha256);
  assert.throws(
    () => skeletons.validateCompletedReviewReceipt(receipt, staleRaw, {
      fixtureName: skeletons.FOLLOWUP_CANDIDATE_FIXTURE_NAME,
      protocolVersion: skeletons.FOLLOWUP_REVIEW_PROTOCOL_VERSION,
      receiptName: skeletons.FOLLOWUP_REVIEW_RECEIPT_NAME,
    }),
    /provenance/,
  );
});

test('invalid follow-up choices re-prompt and package script is narrow', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xion-p1b6-followup-invalid-'));
  const outputPath = path.join(directory, 'receipt.json');
  const answers = ['bad', '1', 'CLEAR', '2', '1', '1', '1', '1', '1', '1'];
  await followup.conductBlindFollowupReview(followupBytes(), {
    outputPath,
    completedAt: '2026-09-07T10:00:00.000Z',
    ask: async () => answers.shift(),
  });
  assert.equal(answers.length, 0);
  assert.deepEqual(followup.parseArgs(['--input', 'in.json', '--output', 'out.json']), {
    inputPath: 'in.json',
    outputPath: 'out.json',
  });
  assert.throws(() => followup.parseArgs([]), /Usage/);
  assert.throws(() => followup.parseArgs(['--input', 'in.json']), /Usage/);
  assert.throws(() => followup.parseArgs(['--input', 'in.json', '--output', 'out.json', '--all', '1']), /Usage/);
  assert.equal(
    json(path.join(ROOT, 'package.json')).scripts['review:memory-inference-p1b6-skeleton-pass1-followup'],
    'node scripts/review-memory-inference-p1b6-skeleton-pass1-followup.js',
  );
});
