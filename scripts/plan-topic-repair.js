'use strict';

const path = require('node:path');
const Database = require('better-sqlite3');
const {
  auditTopicStore,
  buildTopicRepairPlan,
  formatTopicRepairPlan,
} = require('../lib/topic-store');
const { resolveRuntimePaths } = require('../lib/runtime-paths');
const { parseArguments } = require('./audit-topic-store');

const ROOT = path.resolve(__dirname, '..');

function helpText() {
  return [
    'Usage: node scripts/plan-topic-repair.js [options]',
    '',
    'Options:',
    '  --db <path>       SQLite DB 경로 (기본: GALPI_DATA_DIR/galpi.db)',
    '  --vault <path>    vault 경로 (기본: VAULT_PATH 또는 ./galpi-vault)',
    '  --json            JSON 출력',
    '  -h, --help        도움말',
    '',
    '이 명령은 복구 근거와 예정 작업만 출력합니다.',
    'SQLite를 readonly/query_only로 열며 파일이나 DB를 수정하지 않습니다.',
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
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    const audit = await auditTopicStore({ db, vaultPath });
    const plan = buildTopicRepairPlan(audit);
    const output = options.json ? JSON.stringify(plan, null, 2) : formatTopicRepairPlan(plan);
    process.stdout.write(`${output}\n`);
    return plan.status === 'manual_review' ? 1 : 0;
  } finally {
    db.close();
  }
}

module.exports = { helpText, main };

if (require.main === module) {
  main()
    .then(code => { process.exitCode = code; })
    .catch(error => {
      console.error(`Topic repair planning failed: ${error.message}`);
      process.exitCode = 1;
    });
}
