#!/usr/bin/env node
'use strict';

const path = require('node:path');
const Database = require('better-sqlite3');
const {
  buildD0Sensitivity,
  buildOnlineEligibleVolume,
  formatMemoryP0Report,
} = require('../lib/memory-p0-research');
const {
  EMBEDDING_MODEL,
  buildHistoricalReplayCorpus,
} = require('./review-retrieval-policy');
const { resolveRuntimePaths } = require('../lib/runtime-paths');

const ROOT = path.resolve(__dirname, '..');

function parseAsOf(value) {
  const input = String(value || '').trim();
  if (!input) throw new Error('--as-of 뒤에 날짜나 시각이 필요합니다.');
  const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(input)
    ? Date.parse(`${input}T12:00:00+09:00`)
    : Date.parse(input);
  if (!Number.isFinite(timestamp)) throw new Error(`날짜를 해석할 수 없습니다: ${input}`);
  return timestamp;
}

function parseArguments(argv) {
  const options = {
    dbPath: null,
    vaultPath: null,
    asOf: null,
    limit: 77,
    embedMissing: false,
    envPath: null,
    baselineCommit: 'unknown',
    review: false,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--db') {
      if (!argv[index + 1]) throw new Error('--db 뒤에 파일 경로가 필요합니다.');
      options.dbPath = path.resolve(argv[++index]);
    } else if (argument === '--vault') {
      if (!argv[index + 1]) throw new Error('--vault 뒤에 디렉터리 경로가 필요합니다.');
      options.vaultPath = path.resolve(argv[++index]);
    } else if (argument === '--as-of') {
      options.asOf = parseAsOf(argv[++index]);
    } else if (argument === '--limit') {
      options.limit = Number.parseInt(argv[++index], 10);
      if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) {
        throw new Error('--limit은 1~100 사이 정수여야 합니다.');
      }
    } else if (argument === '--embed-missing') {
      options.embedMissing = true;
    } else if (argument === '--env') {
      if (!argv[index + 1]) throw new Error('--env 뒤에 파일 경로가 필요합니다.');
      options.envPath = path.resolve(argv[++index]);
    } else if (argument === '--baseline-commit') {
      const commit = String(argv[++index] || '').trim();
      if (!/^[0-9a-f]{7,40}$/i.test(commit)) throw new Error('유효한 baseline commit이 필요합니다.');
      options.baselineCommit = commit;
    } else if (argument === '--review') {
      options.review = true;
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
    'Usage: npm run research:memory-p0 -- [options]',
    '',
    'Options:',
    '  --db <path>               SQLite DB 경로 (기본: GALPI_DATA_DIR/galpi.db)',
    '  --vault <path>            Vault 경로 (기본: VAULT_PATH)',
    '  --as-of <date|time>       28일 window 기준 KST 날짜 또는 ISO 시각',
    '  --limit <1-100>           historical unique-query 한도 (기본: 77)',
    '  --embed-missing           누락 query embedding을 OpenAI에서 in-memory 생성',
    '  --env <path>              OpenAI 환경 파일 경로',
    '  --baseline-commit <sha>   receipt에 기록할 latest main commit',
    '  --review                  질문과 양 arm의 chunk 식별자를 명시적으로 표시',
    '  --json                    JSON 출력',
    '  -h, --help                도움말',
    '',
    '기본 출력에는 질문·노트 본문·파일명이 없습니다.',
    'Galpi persistent state는 readonly/query_only로 열고 DB/Vault에 쓰지 않습니다.',
    '--embed-missing은 production과 같은 text-embedding-3-small 외부 호출을 수행하지만 저장하지 않습니다.',
    'P0-B answer generation은 이 명령의 범위가 아닙니다.',
  ].join('\n');
}

function openResearchDatabase(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  return db;
}

function createEmbeddingProvider(options) {
  if (!options.embedMissing) return null;
  require('dotenv').config({ path: options.envPath || path.join(ROOT, '.env') });
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return async inputs => {
    try {
      const response = await client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: inputs.map(input => String(input || '').slice(0, 8000)),
        encoding_format: 'float',
      });
      return [...response.data]
        .sort((left, right) => left.index - right.index)
        .map(item => item.embedding);
    } catch {
      return [];
    }
  };
}

async function runMemoryP0Research({
  db,
  vaultPath,
  asOf = Date.now(),
  limit = 77,
  embedMissing = null,
  baselineCommit = 'unknown',
  includeReview = false,
} = {}) {
  const beforeChanges = db.prepare('SELECT total_changes() AS count').get().count;
  const p01 = buildOnlineEligibleVolume(db, { asOf });
  const corpus = await buildHistoricalReplayCorpus(db, vaultPath, limit, {
    embedMissing,
    embeddingModel: EMBEDDING_MODEL,
  });
  const p02 = await buildD0Sensitivity(corpus, { includeReview });
  const afterChanges = db.prepare('SELECT total_changes() AS count').get().count;
  return {
    baselineCommit,
    generatedAt: Math.floor(Date.now() / 1000),
    p01,
    p02,
    safety: {
      galpiPersistentState: 'read-only',
      sqliteReadonly: true,
      sqliteQueryOnly: db.pragma('query_only', { simple: true }) === 1,
      connectionChanges: afterChanges - beforeChanges,
      productionDbWrite: false,
      vaultWrite: false,
      schemaChange: false,
      productionBehaviorChange: false,
      externalEffect: embedMissing
        ? `OpenAI ${EMBEDDING_MODEL} embedding request; in-memory result only`
        : 'none',
      answerGeneration: false,
    },
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${helpText()}\n`);
    return null;
  }
  if (!options.embedMissing) {
    require('dotenv').config({ path: options.envPath || path.join(ROOT, '.env') });
  }
  const runtimePaths = resolveRuntimePaths({ appRoot: ROOT });
  const dbPath = options.dbPath || runtimePaths.dbPath;
  const vaultPath = options.vaultPath || runtimePaths.vaultPath;
  const db = openResearchDatabase(dbPath);
  try {
    const report = await runMemoryP0Research({
      db,
      vaultPath,
      asOf: options.asOf ?? Date.now(),
      limit: options.limit,
      embedMissing: createEmbeddingProvider(options),
      baselineCommit: options.baselineCommit,
      includeReview: options.review,
    });
    process.stdout.write(`${options.json
      ? JSON.stringify(report, null, 2)
      : formatMemoryP0Report(report)}\n`);
    return report;
  } finally {
    db.close();
  }
}

module.exports = {
  createEmbeddingProvider,
  helpText,
  main,
  openResearchDatabase,
  parseArguments,
  parseAsOf,
  runMemoryP0Research,
};

if (require.main === module) {
  main().catch(error => {
    console.error(`Memory P0-A measurement failed: ${error.message}`);
    process.exitCode = 1;
  });
}
