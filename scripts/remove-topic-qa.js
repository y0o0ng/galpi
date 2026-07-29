'use strict';

const path = require('node:path');
const { applyTopicQaRemoval, readTopicQaRemovalPlan } = require('../lib/topic-qa-removal');
const { runBackup } = require('./backup');
const { resolveRuntimePaths } = require('../lib/runtime-paths');

const ROOT = path.resolve(__dirname, '..');

function parseTarget(value) {
  const [filename, qaId, entryContentSha256, decisionId, userMessageId, assistantMessageId, ...rest] = String(value || '').split('|');
  if (rest.length > 0 || !assistantMessageId) {
    throw new Error('--target은 filename|qaId|entrySha256|decisionId|userMessageId|assistantMessageId 형식이어야 합니다.');
  }
  return { filename, qaId, entryContentSha256, decisionId, userMessageId, assistantMessageId };
}

function parseArguments(argv) {
  const options = {
    apply: false,
    confirmServiceStopped: false,
    expectedInputSha256: null,
    dbPath: null,
    vaultPath: null,
    backupDir: null,
    targets: [],
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') options.apply = true;
    else if (argument === '--confirm-service-stopped') options.confirmServiceStopped = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (['--expected-input-sha256', '--db', '--vault', '--backup-dir', '--target'].includes(argument)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} 뒤에 값이 필요합니다.`);
      if (argument === '--expected-input-sha256') options.expectedInputSha256 = value;
      else if (argument === '--db') options.dbPath = path.resolve(value);
      else if (argument === '--vault') options.vaultPath = path.resolve(value);
      else if (argument === '--backup-dir') options.backupDir = path.resolve(value);
      else options.targets.push(parseTarget(value));
      index += 1;
    } else throw new Error(`알 수 없는 인자입니다: ${argument}`);
  }
  return options;
}

function helpText() {
  return [
    'Usage: node scripts/remove-topic-qa.js --target <spec> [--target <spec>] [options]',
    '',
    '기본 실행은 hash 검증 계획만 출력하고 파일과 DB를 수정하지 않습니다.',
    'target: filename|qaId|entrySha256|decisionId|userMessageId|assistantMessageId',
    '',
    'Apply options:',
    '  --apply                         실제 삭제',
    '  --confirm-service-stopped       서버 중지 확인 (적용 시 필수)',
    '  --expected-input-sha256 <hash>  승인한 계획 입력 hash (적용 시 필수)',
    '  --backup-dir <path>             백업 폴더',
    '',
    'Common options:',
    '  --db <path>                     SQLite DB 경로',
    '  --vault <path>                  vault 경로',
    '  --json                          JSON 출력',
    '  -h, --help                      도움말',
  ].join('\n');
}

async function main(argv = process.argv.slice(2)) {
  require('dotenv').config({ path: path.join(ROOT, '.env') });
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${helpText()}\n`);
    return 0;
  }
  const runtimePaths = resolveRuntimePaths({ appRoot: ROOT });
  const dbPath = options.dbPath || runtimePaths.dbPath;
  const vaultPath = options.vaultPath || runtimePaths.vaultPath;

  if (!options.apply) {
    const plan = await readTopicQaRemovalPlan({ dbPath, vaultPath, targets: options.targets });
    process.stdout.write(`${JSON.stringify(plan, null, options.json ? 2 : 0)}\n`);
    return 0;
  }

  const result = await applyTopicQaRemoval({
    dbPath,
    vaultPath,
    targets: options.targets,
    expectedInputSha256: options.expectedInputSha256,
    confirmServiceStopped: options.confirmServiceStopped,
    createBackup: values => runBackup({
      ...values,
      projectDir: ROOT,
      backupDir: options.backupDir,
    }),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

module.exports = { helpText, main, parseArguments, parseTarget };

if (require.main === module) {
  main()
    .then(code => { process.exitCode = code; })
    .catch(error => {
      console.error(`Topic Q&A removal failed: ${error.message}`);
      process.exitCode = 1;
    });
}
