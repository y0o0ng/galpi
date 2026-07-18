'use strict';

const path = require('node:path');
const Database = require('better-sqlite3');
const { auditNoteIndex, formatNoteIndexAudit } = require('../lib/note-index-audit');
const { parseArguments } = require('./audit-topic-store');

const ROOT = path.resolve(__dirname, '..');

function helpText() {
  return [
    'Usage: node scripts/audit-note-index.js [options]',
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
    const report = await auditNoteIndex({ db, vaultPath });
    process.stdout.write(`${options.json ? JSON.stringify(report, null, 2) : formatNoteIndexAudit(report)}\n`);
    return report.healthy ? 0 : 1;
  } finally {
    db.close();
  }
}

module.exports = { helpText, main };

if (require.main === module) {
  main()
    .then(code => { process.exitCode = code; })
    .catch(error => {
      console.error(`Note index audit failed: ${error.message}`);
      process.exitCode = 1;
    });
}
