#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const readline = require('node:readline/promises');
const {
  REVIEW_PROTOCOL_VERSION,
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
      throw new Error('Usage: --input <candidate-fixture.json> --output <completed-receipt.json>');
    }
    parsed[flag] = value;
  }
  if (!parsed['--input'] || !parsed['--output']) {
    throw new Error('Usage: --input <candidate-fixture.json> --output <completed-receipt.json>');
  }
  return { inputPath: parsed['--input'], outputPath: parsed['--output'] };
}

function helpText() {
  return [
    'Usage: npm run review:memory-inference-p1b6-skeleton-pass1 -- --input <candidate-fixture.json> --output <completed-receipt.json>',
    '',
    `Protocol: ${REVIEW_PROTOCOL_VERSION}`,
    '모든 후보의 독립 disposition/ambiguity 응답이 끝난 뒤에만 output을 새로 만듭니다.',
  ].join('\n');
}

async function askUntilValid(ask, prompt, parseChoice) {
  let result = null;
  while (!result) result = parseChoice(await ask(prompt));
  return result;
}

async function conductBlindPass1Review(rawFixtureBytes, options) {
  const { ask, outputPath, completedAt } = options;
  const fixture = parseSkeletonCandidateFixture(rawFixtureBytes);
  const reviewsById = new Map();
  for (const canonicalIndex of deterministicReviewOrder(fixture)) {
    const candidate = fixture.candidates[canonicalIndex];
    const disposition = await askUntilValid(
      ask,
      `${renderBlindReviewPrompt(candidate)}\n\nDisposition\n1. KEEP\n2. FIX\n3. REJECT\n> `,
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
  process.stdout.write('P1-B6 blind HUMAN skeleton Pass-1: 완료 전에는 receipt를 저장하지 않습니다.\n\n');
  try {
    await conductBlindPass1Review(rawFixtureBytes, {
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
  conductBlindPass1Review,
  helpText,
  main,
  parseAmbiguityChoice,
  parseArgs,
  parseDispositionChoice,
};

if (require.main === module) {
  main().then(
    exitCode => { process.exitCode = exitCode; },
    error => {
      console.error(`P1-B6 blind skeleton Pass-1 failed: ${error.message}`);
      process.exitCode = 1;
    },
  );
}
