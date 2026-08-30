#!/usr/bin/env node
'use strict';

const path = require('node:path');
const Database = require('better-sqlite3');
const {
  COVERAGE_STATUSES,
  buildMemoryInferencePilotReport,
  formatMemoryInferencePilotReport,
} = require('../lib/memory-inference-pilot-report');
const { resolveRuntimePaths } = require('../lib/runtime-paths');

const ROOT = path.resolve(__dirname, '..');

function parseKstDate(value, optionName) {
  const input = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input)) {
    throw new Error(`${optionName}은 YYYY-MM-DD KST 날짜여야 합니다.`);
  }
  const timestamp = Date.parse(`${input}T00:00:00+09:00`);
  if (!Number.isFinite(timestamp)) throw new Error(`${optionName} 날짜를 해석할 수 없습니다.`);
  const epoch = Math.floor(timestamp / 1000);
  const normalized = new Date((epoch + 9 * 60 * 60) * 1000).toISOString().slice(0, 10);
  if (normalized !== input) throw new Error(`${optionName} 날짜가 존재하지 않습니다.`);
  return epoch;
}

function parseArguments(argv) {
  const options = {
    dbPath: null,
    startEpoch: null,
    endEpoch: null,
    coverageStatus: COVERAGE_STATUSES.INCOMPLETE,
    instrumentationFailureCount: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--db') {
      if (!argv[index + 1]) throw new Error('--db 뒤에 파일 경로가 필요합니다.');
      options.dbPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (argument === '--since') {
      options.startEpoch = parseKstDate(argv[index + 1], '--since');
      index += 1;
    } else if (argument === '--until') {
      options.endEpoch = parseKstDate(argv[index + 1], '--until');
      index += 1;
    } else if (argument === '--coverage') {
      const value = String(argv[index + 1] || '').toUpperCase();
      if (!Object.values(COVERAGE_STATUSES).includes(value)) {
        throw new Error('--coverage는 complete 또는 incomplete여야 합니다.');
      }
      options.coverageStatus = value;
      index += 1;
    } else if (argument === '--instrumentation-failures') {
      const value = Number.parseInt(argv[index + 1], 10);
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error('--instrumentation-failures는 0 이상의 정수여야 합니다.');
      }
      options.instrumentationFailureCount = value;
      index += 1;
    } else if (argument === '--json') {
      options.json = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`알 수 없는 인자입니다: ${argument}`);
    }
  }
  if (!options.help && (!Number.isSafeInteger(options.startEpoch) || !Number.isSafeInteger(options.endEpoch))) {
    throw new Error('--since와 --until KST 날짜가 모두 필요합니다.');
  }
  if (!options.help && options.endEpoch <= options.startEpoch) {
    throw new Error('--until은 --since보다 뒤여야 합니다.');
  }
  if (
    !options.help
    && options.coverageStatus === COVERAGE_STATUSES.COMPLETE
    && options.instrumentationFailureCount !== 0
  ) {
    throw new Error('complete coverage를 선언하려면 --instrumentation-failures가 독립 검토 결과 정확히 0이어야 합니다.');
  }
  return options;
}

function helpText() {
  return [
    'Usage: npm run report:memory-inference-pilot -- --since YYYY-MM-DD --until YYYY-MM-DD [options]',
    '',
    'Options:',
    '  --db <path>                         SQLite DB (기본: GALPI_DATA_DIR/galpi.db)',
    '  --since <YYYY-MM-DD>                포함할 첫 KST 날짜',
    '  --until <YYYY-MM-DD>                제외할 KST 날짜',
    '  --coverage <complete|incomplete>    window coverage (기본: incomplete)',
    '  --instrumentation-failures <N>      독립 로그 검토로 확인한 실패 수(COMPLETE는 정확히 0)',
    '  --json                              JSON 출력',
    '  -h, --help                          도움말',
    '',
    '이 명령은 observed-production ledger만 readonly/query_only로 집계합니다.',
    'synthetic/private replay case는 production frequency에 포함하지 않습니다.',
    'ledger만으로 coverage를 증명할 수 없어 기본값은 INCOMPLETE이며 누락 incidence를 추정하지 않습니다.',
    'COMPLETE는 실패 수가 정확히 0이고 window의 observation contract가 current version으로 일관될 때만 허용됩니다.',
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  require('dotenv').config({ path: path.join(ROOT, '.env') });
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${helpText()}\n`);
    return 0;
  }
  const dbPath = options.dbPath || resolveRuntimePaths({ appRoot: ROOT }).dbPath;
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    const report = buildMemoryInferencePilotReport({
      db,
      startEpoch: options.startEpoch,
      endEpoch: options.endEpoch,
      coverageStatus: options.coverageStatus,
      instrumentationFailureCount: options.instrumentationFailureCount,
    });
    const output = options.json
      ? JSON.stringify(report, null, 2)
      : formatMemoryInferencePilotReport(report);
    process.stdout.write(`${output}\n`);
    return 0;
  } finally {
    db.close();
  }
}

module.exports = { helpText, main, parseArguments, parseKstDate };

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`Memory inference Pilot P0 report failed: ${error.message}`);
    process.exitCode = 1;
  }
}
