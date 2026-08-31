#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  MODEL_SIZE_CLASSES,
  SCREENING_DECISIONS,
  loadCalibrationFixture,
  runCalibrationFixture,
} = require('../lib/memory-inference-local-calibration');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_FIXTURE = path.join(
  ROOT,
  'fixtures/local-memory-inference-p1b1-synthetic.json',
);

function requiredValue(argv, index, optionName) {
  if (!argv[index + 1] || argv[index + 1].startsWith('--')) {
    throw new Error(`${optionName} 뒤에 값이 필요합니다.`);
  }
  return argv[index + 1];
}

function parseArguments(argv) {
  const options = {
    endpoint: null,
    modelId: null,
    artifactId: null,
    quantization: null,
    modelSizeClass: null,
    runtimeFamily: 'llama.cpp',
    runtimeVersion: null,
    fixturePath: DEFAULT_FIXTURE,
    timeoutMs: 60_000,
    commit: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--endpoint') {
      options.endpoint = requiredValue(argv, index, '--endpoint'); index += 1;
    } else if (argument === '--model') {
      options.modelId = requiredValue(argv, index, '--model'); index += 1;
    } else if (argument === '--artifact') {
      options.artifactId = requiredValue(argv, index, '--artifact'); index += 1;
    } else if (argument === '--quantization') {
      options.quantization = requiredValue(argv, index, '--quantization'); index += 1;
    } else if (argument === '--model-size-class') {
      options.modelSizeClass = requiredValue(argv, index, '--model-size-class'); index += 1;
    } else if (argument === '--runtime-family') {
      options.runtimeFamily = requiredValue(argv, index, '--runtime-family'); index += 1;
    } else if (argument === '--runtime-version') {
      options.runtimeVersion = requiredValue(argv, index, '--runtime-version'); index += 1;
    } else if (argument === '--fixture') {
      options.fixturePath = path.resolve(requiredValue(argv, index, '--fixture')); index += 1;
    } else if (argument === '--timeout-ms') {
      options.timeoutMs = Number(requiredValue(argv, index, '--timeout-ms'));
      if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) {
        throw new Error('--timeout-ms는 1 이상의 정수여야 합니다.');
      }
      index += 1;
    } else if (argument === '--commit') {
      options.commit = requiredValue(argv, index, '--commit'); index += 1;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`알 수 없는 인자입니다: ${argument}`);
    }
  }
  if (!options.help) {
    for (const [name, value] of [
      ['--endpoint', options.endpoint], ['--model', options.modelId],
      ['--artifact', options.artifactId], ['--quantization', options.quantization],
      ['--model-size-class', options.modelSizeClass], ['--runtime-version', options.runtimeVersion],
    ]) {
      if (!value) throw new Error(`${name}이 필요합니다.`);
    }
    if (!Object.values(MODEL_SIZE_CLASSES).includes(options.modelSizeClass)) {
      throw new Error('--model-size-class는 sub-1B, ~2B, ~4B 중 하나여야 합니다.');
    }
    if (options.quantization !== 'BF16') {
      throw new Error('P1-B1 --quantization은 BF16이어야 합니다.');
    }
  }
  return options;
}

function helpText() {
  return [
    'Usage: npm run research:memory-inference-calibration -- [options]',
    '',
    'Required:',
    '  --endpoint <url>          별도로 실행 중인 OpenAI-compatible base URL',
    '  --model <id>              endpoint에 전달할 model ID',
    '  --artifact <id>           실제 model artifact/revision ID',
    '  --quantization <id>       P1-B1 capability probe는 BF16 고정',
    '  --model-size-class <id>   sub-1B | ~2B | ~4B',
    '  --runtime-version <id>    외부 runtime version/commit',
    '',
    'Optional:',
    '  --runtime-family <id>     기본: llama.cpp',
    `  --fixture <path>          기본: ${path.relative(ROOT, DEFAULT_FIXTURE)}`,
    '  --timeout-ms <N>          요청 안전 timeout, 기본 60000 (screening threshold 아님)',
    '  --commit <sha>            기본: 현재 Galpi git HEAD',
    '  -h, --help                도움말',
    '',
    '고정된 P1-B1 screening rule은 CLI로 조정할 수 없습니다.',
    'runtime/model을 다운로드·시작·종료하지 않고 DB/Vault/production state를 쓰지 않습니다.',
  ].join('\n');
}

function currentCommit() {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${helpText()}\n`);
    return 0;
  }
  const fixture = loadCalibrationFixture(options.fixturePath);
  const report = await runCalibrationFixture(fixture, {
    endpoint: options.endpoint,
    modelId: options.modelId,
    artifactId: options.artifactId,
    quantization: options.quantization,
    modelSizeClass: options.modelSizeClass,
    runtimeFamily: options.runtimeFamily,
    runtimeVersion: options.runtimeVersion,
    timeoutMs: options.timeoutMs,
    commit: options.commit || currentCommit(),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.workloads.some(item => (
    item.screeningDecision === SCREENING_DECISIONS.INDETERMINATE_RUNTIME
  )) ? 1 : 0;
}

module.exports = { DEFAULT_FIXTURE, helpText, main, parseArguments };

if (require.main === module) {
  main().then(
    exitCode => { process.exitCode = exitCode; },
    error => {
      console.error(`Memory inference Pilot P1-B1 calibration failed: ${error.message}`);
      process.exitCode = 1;
    },
  );
}
