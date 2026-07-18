#!/usr/bin/env node
'use strict';

const path = require('node:path');
const Database = require('better-sqlite3');
const {
  buildRetrievalShadowReport,
  formatRetrievalShadowReport,
} = require('../lib/assistant-retrieval-report');

const ROOT = path.resolve(__dirname, '..');

function parseSince(value) {
  const input = String(value || '').trim();
  if (!input) throw new Error('--since 뒤에 날짜가 필요합니다.');
  const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(input)
    ? Date.parse(`${input}T00:00:00+09:00`)
    : Date.parse(input);
  if (!Number.isFinite(timestamp)) throw new Error(`날짜를 해석할 수 없습니다: ${input}`);
  return Math.floor(timestamp / 1000);
}

function parseArguments(argv) {
  const options = {
    dbPath: null,
    sinceEpoch: null,
    allModes: false,
    review: false,
    reviewLimit: 20,
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
      options.sinceEpoch = parseSince(argv[index + 1]);
      index += 1;
    } else if (argument === '--all-modes') {
      options.allModes = true;
    } else if (argument === '--review') {
      options.review = true;
    } else if (argument === '--limit') {
      const limit = Number.parseInt(argv[index + 1], 10);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new Error('--limit은 1~100 사이 정수여야 합니다.');
      }
      options.reviewLimit = limit;
      index += 1;
    } else if (argument === '--json') {
      options.json = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`알 수 없는 인자입니다: ${argument}`);
    }
  }
  return options;
}

function helpText() {
  return [
    'Usage: npm run report:retrieval-shadow -- [options]',
    '',
    'Options:',
    '  --db <path>       SQLite DB 경로 (기본: ./galpi.db)',
    '  --since <date>    KST 날짜 또는 ISO 시각 이후만 집계',
    '  --all-modes       A1b 이전 shadow 실행도 포함',
    '  --review          질문과 선택된 Q&A를 명시적으로 표시',
    '  --limit <1-100>   review할 고유 질문 수 (기본: 20)',
    '  --json            JSON 출력',
    '  -h, --help        도움말',
    '',
    '기본 출력에는 질문·노트 본문이 없습니다.',
    '--review에서만 기존 messages와 query hash를 연결해 개인 내용을 터미널에 표시합니다.',
    '이 명령은 SQLite를 readonly/query_only로 열며 파일이나 DB를 수정하지 않습니다.',
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${helpText()}\n`);
    return 0;
  }

  const dbPath = options.dbPath || path.join(ROOT, 'galpi.db');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    const report = buildRetrievalShadowReport({
      db,
      sinceEpoch: options.sinceEpoch,
      allModes: options.allModes,
      includeReview: options.review,
      reviewLimit: options.reviewLimit,
    });
    const output = options.json
      ? JSON.stringify(report, null, 2)
      : formatRetrievalShadowReport(report);
    process.stdout.write(`${output}\n`);
    return 0;
  } finally {
    db.close();
  }
}

module.exports = { helpText, main, parseArguments, parseSince };

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`Retrieval shadow report failed: ${error.message}`);
    process.exitCode = 1;
  }
}
