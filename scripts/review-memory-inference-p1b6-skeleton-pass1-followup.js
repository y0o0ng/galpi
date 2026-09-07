#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const readline = require('node:readline/promises');
const {
  FOLLOWUP_CANDIDATE_FIXTURE_NAME,
  FOLLOWUP_REVIEW_PROTOCOL_VERSION,
  FOLLOWUP_REVIEW_RECEIPT_NAME,
  buildCompletedReviewReceipt,
  deterministicReviewOrder,
  parseSkeletonCandidateFixture,
  renderBlindReviewPrompt,
  sha256RawBytes,
} = require('../lib/memory-inference-p1b6-skeletons');

function parseDispositionChoice(value) {
  return ({ 1: 'KEEP', 2: 'FIX', 3: 'REJECT' })[String(value).trim()] || null;
}

function parseAmbiguityChoice(value) {
  return ({ 1: 'CLEAR', 2: 'ESCALATE' })[String(value).trim()] || null;
}

function parseArgs(argv) {
  if (argv.length === 1 && ['-h', '--help'].includes(argv[0])) return { help: true };
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--input', '--output'].includes(flag) || !value || Object.hasOwn(parsed, flag)) {
      throw new Error('Usage: --input <followup-candidate-fixture.json> --output <completed-followup-receipt.json>');
    }
    parsed[flag] = value;
  }
  if (!parsed['--input'] || !parsed['--output']) {
    throw new Error('Usage: --input <followup-candidate-fixture.json> --output <completed-followup-receipt.json>');
  }
  return { inputPath: parsed['--input'], outputPath: parsed['--output'] };
}

function helpText() {
  return [
    'Usage: npm run review:memory-inference-p1b6-skeleton-pass1-followup -- --input <followup-candidate-fixture.json> --output <completed-followup-receipt.json>',
    '',
    `Protocol: ${FOLLOWUP_REVIEW_PROTOCOL_VERSION}`,
    '4건 follow-up 후보의 독립 disposition/ambiguity 응답이 끝난 뒤에만 output을 새로 만듭니다.',
  ].join('\n');
}

async function askUntilValid(ask, prompt, parseChoice) {
  let result = null;
  while (!result) result = parseChoice(await ask(prompt));
  return result;
}

function parseFollowupFixture(rawFixtureBytes) {
  const fixture = parseSkeletonCandidateFixture(rawFixtureBytes, {
    fixtureName: FOLLOWUP_CANDIDATE_FIXTURE_NAME,
    minCandidates: 4,
  });
  if (fixture.candidates.length !== 4) {
    throw new TypeError('P1-B6 Pass-1 follow-up fixture에는 정확히 4개 candidate가 있어야 합니다.');
  }
  return fixture;
}

async function conductBlindFollowupReview(rawFixtureBytes, options) {
  const { ask, outputPath, completedAt } = options;
  const fixture = parseFollowupFixture(rawFixtureBytes);
  const reviewsById = new Map();
  const order = deterministicReviewOrder(fixture, {
    fixtureName: FOLLOWUP_CANDIDATE_FIXTURE_NAME,
    protocolVersion: FOLLOWUP_REVIEW_PROTOCOL_VERSION,
  });
  for (let position = 0; position < order.length; position += 1) {
    const candidate = fixture.candidates[order[position]];
    const disposition = await askUntilValid(
      ask,
      `Case ${position + 1}/${order.length}\n\n${renderBlindReviewPrompt(candidate)}\n\nDisposition\n1. KEEP\n2. FIX\n3. REJECT\n> `,
      parseDispositionChoice,
    );
    const ambiguityLabel = await askUntilValid(
      ask,
      'Ambiguity label\n1. CLEAR\n2. ESCALATE\n> ',
      parseAmbiguityChoice,
    );
    reviewsById.set(candidate.semanticSkeletonId, { disposition, ambiguityLabel });
  }
  const receipt = buildCompletedReviewReceipt({
    fixture,
    fixtureSha256: sha256RawBytes(rawFixtureBytes),
    reviewsById,
    completedAt: completedAt || new Date().toISOString(),
    fixtureName: FOLLOWUP_CANDIDATE_FIXTURE_NAME,
    protocolVersion: FOLLOWUP_REVIEW_PROTOCOL_VERSION,
    receiptName: FOLLOWUP_REVIEW_RECEIPT_NAME,
  });
  fs.writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return receipt;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${helpText()}\n`);
    return 0;
  }
  if (fs.existsSync(args.outputPath)) {
    throw new Error(`기존 output을 덮어쓰지 않습니다: ${args.outputPath}`);
  }
  const rawFixtureBytes = fs.readFileSync(args.inputPath);
  const review = readline.createInterface({ input: process.stdin, output: process.stdout });
  process.stdout.write('P1-B6 blind HUMAN skeleton Pass-1 follow-up: 완료 전에는 receipt를 저장하지 않습니다.\n\n');
  try {
    await conductBlindFollowupReview(rawFixtureBytes, {
      ask: prompt => review.question(prompt),
      outputPath: args.outputPath,
    });
  } finally {
    review.close();
  }
  process.stdout.write(`완료: ${args.outputPath}\n`);
  return 0;
}

module.exports = {
  conductBlindFollowupReview,
  helpText,
  main,
  parseAmbiguityChoice,
  parseArgs,
  parseDispositionChoice,
  parseFollowupFixture,
};

if (require.main === module) {
  main().then(
    exitCode => { process.exitCode = exitCode; },
    error => {
      console.error(`P1-B6 blind skeleton Pass-1 follow-up failed: ${error.message}`);
      process.exitCode = 1;
    },
  );
}
