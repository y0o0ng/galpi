'use strict';

const path = require('node:path');
const Database = require('better-sqlite3');
const { auditTopicStore, formatTopicStoreAudit } = require('../lib/topic-store');

const ROOT = path.resolve(__dirname, '..');

function parseArguments(argv) {
  const options = { dbPath: null, vaultPath: null, json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      options.json = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument === '--db') {
      if (!argv[index + 1]) throw new Error('--db 뒤에 파일 경로가 필요합니다.');
      options.dbPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (argument === '--vault') {
      if (!argv[index + 1]) throw new Error('--vault 뒤에 폴더 경로가 필요합니다.');
      options.vaultPath = path.resolve(argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`알 수 없는 인자입니다: ${argument}`);
    }
  }
  return options;
}

function helpText() {
  return [
    'Usage: node scripts/audit-topic-store.js [options]',
    '',
    'Options:',
    '  --db <path>       SQLite DB 경로 (기본: ./galpi.db)',
    '  --vault <path>    vault 경로 (기본: VAULT_PATH 또는 ./galpi-vault)',
    '  --json            JSON 출력',
    '  -h, --help        도움말',
    '',
    '이 명령은 SQLite를 readonly/query_only로 열며 파일이나 DB를 수정하지 않습니다.',
  ].join('\n');
}

async function main(argv = process.argv.slice(2)) {
  require('dotenv').config({ path: path.join(ROOT, '.env') });
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${helpText()}\n`);
    return 0;
  }

  const dbPath = options.dbPath || path.join(ROOT, 'galpi.db');
  const vaultPath = options.vaultPath
    || (process.env.VAULT_PATH ? path.resolve(process.env.VAULT_PATH) : path.join(ROOT, 'galpi-vault'));
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    const report = await auditTopicStore({ db, vaultPath });
    const output = options.json ? JSON.stringify(report, null, 2) : formatTopicStoreAudit(report);
    process.stdout.write(`${output}\n`);
    return report.healthy ? 0 : 1;
  } finally {
    db.close();
  }
}

module.exports = { parseArguments, helpText, main };

if (require.main === module) {
  main()
    .then(code => { process.exitCode = code; })
    .catch(error => {
      console.error(`Topic store audit failed: ${error.message}`);
      process.exitCode = 1;
    });
}
