'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  buildRetrievalShadowReport,
  formatRetrievalShadowReport,
  percentile,
} = require('../lib/assistant-retrieval-report');
const { sha256 } = require('../lib/content-hash');
const {
  helpText,
  parseArguments,
  parseSince,
} = require('../scripts/report-retrieval-shadow');
const {
  formatReview: formatPolicyReview,
  parseArguments: parsePolicyArguments,
} = require('../scripts/review-retrieval-policy');

function createReportDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE assistant_retrieval_shadow_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      mode TEXT NOT NULL,
      query_sha256 TEXT,
      notes_json TEXT NOT NULL,
      chunks_json TEXT NOT NULL,
      context_chars INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE note_chunks (
      chunk_id TEXT PRIMARY KEY,
      note_filename TEXT NOT NULL,
      content TEXT NOT NULL,
      index_status TEXT NOT NULL DEFAULT 'ready'
    );
    CREATE TABLE notes (
      filename TEXT PRIMARY KEY,
      ai_readable INTEGER NOT NULL DEFAULT 1
    );
  `);

  const insertRun = db.prepare(`
    INSERT INTO assistant_retrieval_shadow_runs (
      session_id, mode, query_sha256, notes_json, chunks_json,
      context_chars, latency_ms, error, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const deployHash = sha256('마지막 배포 결말은?');
  const unknownHash = sha256('내 볼트와 무관한 질문');
  const deployNotes = JSON.stringify([{ filename: 'deploy.md', score: 0.8 }]);
  const deployChunks = JSON.stringify([
    { chunkId: 'qa-deploy', noteFilename: 'deploy.md', score: 0.72 },
    { chunkId: 'qa-backup', noteFilename: 'deploy.md', score: 0.51 },
  ]);
  insertRun.run('session-1', 'council-debate:a1b', deployHash, deployNotes, deployChunks, 2400, 10, null, 100);
  insertRun.run('session-1', 'council-synthesis:a1b', deployHash, deployNotes, deployChunks, 2400, 20, null, 105);
  insertRun.run('session-duplicate', 'chat:a1b', deployHash, deployNotes, deployChunks, 2400, 25, null, 120);
  insertRun.run('session-2', 'chat:a1b', unknownHash, '[]', '[]', 0, 30, null, 200);
  insertRun.run('session-old', 'chat', null, '[]', '[]', 0, 99, null, 50);

  db.prepare(`
    INSERT INTO messages (session_id, role, content, created_at)
    VALUES (?, 'user', ?, ?)
  `).run('session-1', '마지막 배포 결말은?', 110);
  db.prepare(`
    INSERT INTO messages (session_id, role, content, created_at)
    VALUES (?, 'user', ?, ?)
  `).run('session-duplicate', '마지막 배포 결말은?', 130);
  db.prepare(`
    INSERT INTO messages (session_id, role, content, created_at)
    VALUES (?, 'user', ?, ?)
  `).run('session-2', '내 볼트와 무관한 질문', 210);
  db.prepare(`
    INSERT INTO notes (filename) VALUES ('deploy.md')
  `).run();
  db.prepare(`
    INSERT INTO note_chunks (chunk_id, note_filename, content)
    VALUES (?, ?, ?)
  `).run('qa-deploy', 'deploy.md', 'Q: 최종 배포 결과는?\nA: 서비스가 정상 기동했다.');
  db.prepare(`
    INSERT INTO note_chunks (chunk_id, note_filename, content)
    VALUES (?, ?, ?)
  `).run('qa-backup', 'deploy.md', 'Q: 배포 전 백업은?\nA: 동시 백업을 만들었다.');
  return db;
}

test('retrieval shadow report aggregates A1b runs and keeps default output private', () => {
  const db = createReportDatabase();
  db.pragma('query_only = ON');
  const report = buildRetrievalShadowReport({ db });

  assert.equal(report.runs, 4);
  assert.equal(report.reviewableUniqueQueries, 2);
  assert.equal(report.runsWithoutQueryHash, 0);
  assert.deepEqual(report.incrementalShadowLatencyMs, {
    average: 21.3,
    p50: 20,
    p95: 30,
    maximum: 30,
  });
  assert.equal(report.abstentions, 1);
  assert.equal(report.saturatedRuns, 0);
  assert.equal(report.selectedChunks.maximum, 2);
  assert.equal(report.reviews, undefined);

  const output = formatRetrievalShadowReport(report);
  assert.match(output, /검토 가능한 고유 질문 2개/);
  assert.doesNotMatch(output, /마지막 배포|최종 배포|배포 전 백업/);
  db.close();
});

test('review mode links hashes to messages and shows selected QA questions only on opt-in', () => {
  const db = createReportDatabase();
  db.pragma('query_only = ON');
  const report = buildRetrievalShadowReport({
    db,
    includeReview: true,
    reviewLimit: 10,
  });

  assert.equal(report.reviews.length, 2);
  const deployReview = report.reviews.find(review => review.query === '마지막 배포 결말은?');
  assert.ok(deployReview);
  assert.deepEqual(deployReview.traceIds, [1, 2, 3]);
  assert.deepEqual(
    deployReview.evidence.map(item => item.question),
    ['최종 배포 결과는?', '배포 전 백업은?'],
  );
  assert.doesNotMatch(JSON.stringify(deployReview), /서비스가 정상 기동|동시 백업을 만들었다/);

  const output = formatRetrievalShadowReport(report);
  assert.match(output, /질문: 마지막 배포 결말은\?/);
  assert.match(output, /Q: 최종 배포 결과는\?/);

  db.pragma('query_only = OFF');
  db.prepare("UPDATE notes SET ai_readable = 0 WHERE filename = 'deploy.md'").run();
  db.pragma('query_only = ON');
  const hiddenReport = buildRetrievalShadowReport({ db, includeReview: true, reviewLimit: 10 });
  const hiddenDeployReview = hiddenReport.reviews.find(review => review.query === '마지막 배포 결말은?');
  assert.ok(hiddenDeployReview.evidence.every(item => item.question === null));
  db.close();
});

test('report arguments parse KST dates and keep content review explicit', () => {
  assert.equal(parseSince('2026-07-18'), Date.parse('2026-07-18T00:00:00+09:00') / 1000);
  assert.deepEqual(
    parseArguments(['--since', '2026-07-18', '--review', '--limit', '30', '--json']),
    {
      dbPath: null,
      sinceEpoch: Date.parse('2026-07-18T00:00:00+09:00') / 1000,
      allModes: false,
      review: true,
      reviewLimit: 30,
      json: true,
      help: false,
    },
  );
  assert.throws(() => parseArguments(['--limit', '0']), /1~100/);
  assert.match(helpText(), /기본 출력에는 질문·노트 본문이 없습니다/);
  assert.match(helpText(), /readonly\/query_only/);
  assert.equal(percentile([10, 20, 30, 40], 0.95), 40);
});

test('policy replay keeps generated embeddings and question output explicit', () => {
  const options = parsePolicyArguments([
    '--db', './test.db',
    '--vault', './vault',
    '--limit', '77',
    '--embed-missing',
    '--env', './.env',
    '--json',
  ]);
  assert.equal(options.limit, 77);
  assert.equal(options.embedMissing, true);
  assert.match(options.dbPath, /test\.db$/);
  assert.match(options.vaultPath, /vault$/);
  assert.match(options.envPath, /\.env$/);
  assert.throws(() => parsePolicyArguments(['--limit', '101']), /1~100/);

  const output = formatPolicyReview({
    sourceRuns: 1,
    uniqueQueries: 1,
    comparableQueries: 1,
    missingEmbeddings: 0,
    baseline: { selectedQueries: 1, selectedChunks: 1, abstentions: 0 },
    replacement: { selectedQueries: 0, selectedChunks: 0, abstentions: 1 },
    changedQueries: 1,
    reviews: [{ query: '개인 질문', evidence: [], baseline: [], replacement: [] }],
  }, false);
  assert.doesNotMatch(output, /개인 질문/);
  assert.match(output, /--review/);
});
