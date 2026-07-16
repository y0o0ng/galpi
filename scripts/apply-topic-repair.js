'use strict';

const path = require('node:path');
const {
  applyTopicRepair,
  formatTopicRepairResult,
  readTopicRepairPlan,
} = require('../lib/topic-repair');
const { formatTopicRepairPlan } = require('../lib/topic-store');
const { runBackup } = require('./backup');

const ROOT = path.resolve(__dirname, '..');

function parseApplyArguments(argv) {
  const options = {
    apply: false,
    confirmServiceStopped: false,
    inputSha256: null,
    approvedOperationIds: [],
    dbPath: null,
    vaultPath: null,
    backupDir: null,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') {
      options.apply = true;
    } else if (argument === '--confirm-service-stopped') {
      options.confirmServiceStopped = true;
    } else if (argument === '--json') {
      options.json = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument === '--input-sha256') {
      if (!argv[index + 1]) throw new Error('--input-sha256 뒤에 hash가 필요합니다.');
      options.inputSha256 = argv[index + 1];
      index += 1;
    } else if (argument === '--approve-operation') {
      if (!argv[index + 1]) throw new Error('--approve-operation 뒤에 작업 ID가 필요합니다.');
      options.approvedOperationIds.push(argv[index + 1]);
      index += 1;
    } else if (argument === '--db') {
      if (!argv[index + 1]) throw new Error('--db 뒤에 파일 경로가 필요합니다.');
      options.dbPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (argument === '--vault') {
      if (!argv[index + 1]) throw new Error('--vault 뒤에 폴더 경로가 필요합니다.');
      options.vaultPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (argument === '--backup-dir') {
      if (!argv[index + 1]) throw new Error('--backup-dir 뒤에 폴더 경로가 필요합니다.');
      options.backupDir = path.resolve(argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`알 수 없는 인자입니다: ${argument}`);
    }
  }
  return options;
}

function helpText() {
  return [
    'Usage: node scripts/apply-topic-repair.js [options]',
    '',
    '기본 실행은 최신 복구 계획만 출력하며 파일과 DB를 수정하지 않습니다.',
    '',
    'Apply options:',
    '  --apply                         실제 적용',
    '  --confirm-service-stopped       서버 중지 확인 (적용 시 필수)',
    '  --input-sha256 <hash>            승인한 계획 입력 hash (적용 시 필수)',
    '  --approve-operation <id>         수동 작업 승인 (여러 번 지정 가능)',
    '  --backup-dir <path>              백업 폴더',
    '',
    'Common options:',
    '  --db <path>                      SQLite DB 경로',
    '  --vault <path>                   vault 경로',
    '  --json                           JSON 출력',
    '  -h, --help                       도움말',
  ].join('\n');
}

async function main(argv = process.argv.slice(2)) {
  require('dotenv').config({ path: path.join(ROOT, '.env') });
  const options = parseApplyArguments(argv);
  if (options.help) {
    process.stdout.write(`${helpText()}\n`);
    return 0;
  }

  const dbPath = options.dbPath || path.join(ROOT, 'council.db');
  const vaultPath = options.vaultPath
    || (process.env.VAULT_PATH ? path.resolve(process.env.VAULT_PATH) : path.join(ROOT, 'ai-council-vault'));

  if (!options.apply) {
    const { plan } = await readTopicRepairPlan({ dbPath, vaultPath });
    process.stdout.write(`${options.json ? JSON.stringify(plan, null, 2) : formatTopicRepairPlan(plan)}\n`);
    return plan.status === 'manual_review' ? 1 : 0;
  }

  const result = await applyTopicRepair({
    dbPath,
    vaultPath,
    backupDir: options.backupDir,
    expectedInputSha256: options.inputSha256,
    approvedOperationIds: options.approvedOperationIds,
    confirmServiceStopped: options.confirmServiceStopped,
    createBackup: values => runBackup({ ...values, projectDir: ROOT }),
  });
  process.stdout.write(`${options.json ? JSON.stringify(result, null, 2) : formatTopicRepairResult(result)}\n`);
  return 0;
}

module.exports = { helpText, main, parseApplyArguments };

if (require.main === module) {
  main()
    .then(code => { process.exitCode = code; })
    .catch(error => {
      console.error(`Topic repair apply failed: ${error.message}`);
      process.exitCode = 1;
    });
}
