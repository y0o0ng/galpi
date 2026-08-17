#!/usr/bin/env node
'use strict';

// MAIL-2 fixture 회귀 게이트 (설계 24 Phase 2).
//
// 오프라인 테스트(test/mail-analyze.test.js)는 fake 모델로 파이프라인 계약을 잠근다.
// 이 스크립트는 그것과 반대로 **실제 모델의 판단 품질**을 잰다. 네트워크·API 키·비용이
// 붙으므로 `node --test`에 넣지 않는다 — 무관한 커밋에서 빨개지거나 CI가 키에 묶이면
// 게이트를 믿을 수 없게 된다.
//
//   npm run eval:mail-fixtures
//   npm run eval:mail-fixtures -- --model gpt-5.6-terra
//
// 기대값은 test/fixtures/mail-decisions/fixtures.js에 **결과를 보기 전에** 고정돼 있다.
// 숫자가 나쁘다고 그 파일을 고치지 않는다.

require('dotenv').config();

const Database = require('better-sqlite3');
const OpenAI = require('openai');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const { createMailStore } = require('../lib/mail/store');
const { createMailAnalyzer } = require('../lib/mail/analyze');
const { FIXTURES } = require('../test/fixtures/mail-decisions/fixtures');

const NOW = Math.floor(Date.parse('2026-08-17T09:10:00+09:00') / 1000);

function parseArgs(argv) {
  const args = { model: process.env.MAIL_ANALYZER_MODEL || 'gpt-5.6-luna', only: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--model') args.model = argv[i + 1];
    if (argv[i] === '--only') args.only = argv[i + 1];
  }
  return args;
}

// mail_* 표는 migration이 만들지만 그 migration이 기존 표를 참조한다. 평가용 빈 DB에
// 필요한 최소 선행 표만 세운다.
function createDatabase() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, model TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY, filename TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
      note_type TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
      codex_status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE auto_save_decisions (id INTEGER PRIMARY KEY, decision TEXT NOT NULL, action TEXT);
    CREATE TABLE note_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, chunk_id TEXT UNIQUE NOT NULL,
      note_filename TEXT NOT NULL, note_title TEXT NOT NULL, chunk_type TEXT NOT NULL,
      content TEXT NOT NULL, source_session TEXT, source_user_message INTEGER,
      source_assistant_message INTEGER, embedding TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE assistant_retrieval_shadow_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, mode TEXT NOT NULL,
      notes_json TEXT NOT NULL, chunks_json TEXT NOT NULL,
      context_chars INTEGER NOT NULL DEFAULT 0, latency_ms INTEGER NOT NULL DEFAULT 0,
      error TEXT, created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);
  runDatabaseMigrations(db);
  return db;
}

function senderOf(raw) {
  const header = /^From:[ \t]*(.+)$/m.exec(raw.toString('latin1'));
  const value = header ? header[1].trim() : '';
  const angled = /<([^>]+)>/.exec(value);
  return (angled ? angled[1] : value).trim().toLowerCase();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY가 없습니다. .env를 확인하세요.');
    process.exit(1);
  }
  const fixtures = args.only ? FIXTURES.filter(f => f.id === args.only) : FIXTURES;
  if (!fixtures.length) {
    console.error(`fixture를 찾지 못했습니다: ${args.only}`);
    process.exit(1);
  }

  const db = createDatabase();
  const store = createMailStore(db, { now: () => NOW });
  const account = store.registerAccount({ provider: 'gmail', address: 'me@gmail.com' }, NOW);
  const bodies = new Map();
  for (const fixture of fixtures) {
    const saved = store.saveMessage({
      accountId: account.id,
      identityKind: 'gmail_message',
      identityKey: fixture.id,
      gmailMessageId: fixture.id,
      senderAddress: senderOf(fixture.raw),
      receivedAt: NOW - 600,
    }, NOW);
    bodies.set(fixture.id, fixture.raw);
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const latencies = [];
  const analyzer = createMailAnalyzer({
    store,
    now: () => NOW,
    model: args.model,
    batchSize: fixtures.length,
    providers: {
      gmail: {
        async fetchRaw(id) { return { raw: bodies.get(id), labels: ['INBOX'] }; },
      },
    },
    callModel: async ({ model, system, input, schema, schemaName }) => {
      const started = Date.now();
      const response = await openai.responses.create({
        model,
        input: [{ role: 'system', content: system }, { role: 'user', content: input }],
        store: false,
        text: { format: { type: 'json_schema', name: schemaName, strict: true, schema } },
      });
      latencies.push(Date.now() - started);
      return JSON.parse(response.output_text);
    },
    onError: (error, context) => {
      console.error(`  ! 분석 실패 message=${context?.mailMessageId} ${error?.code || error?.message}`);
    },
  });

  console.log(`model=${args.model} fixtures=${fixtures.length}\n`);
  await analyzer.tick(NOW);

  const rows = db.prepare(`
    SELECT identity_key AS id, analysis_state AS state, category, notification_mode AS mode,
           deadline_kind AS deadlineKind, deadline_date AS deadlineDate, deadline_at AS deadlineAt,
           decision_confidence AS confidence, summary
    FROM mail_messages
  `).all();
  const byId = new Map(rows.map(row => [row.id, row]));

  const metrics = {
    analyzed: 0,
    categoryHit: 0,
    modeHit: 0,
    deadlineHit: 0,
    attentionHit: 0,
    // 설계 24가 이름 붙인 다섯 가지 변화량.
    falsePositive: 0,      // 조용해야 할 메일이 울렸다
    falseNegative: 0,      // 울려야 할 메일이 조용했다
    immediateFalseAlarm: 0, // immediate가 아니어야 하는데 immediate다
    deadlineFalseAlarm: 0,  // 기한 종류가 어긋났다
    actionMissed: 0,        // action_required Attention이 안 생겼다
  };
  const misses = [];

  for (const fixture of fixtures) {
    const row = byId.get(fixture.id);
    if (!row || row.state !== 'done') {
      misses.push(`${fixture.id}: 분석이 끝나지 않았다 (state=${row?.state ?? '없음'})`);
      continue;
    }
    metrics.analyzed += 1;
    const attention = store.findAttentionByMessage(
      db.prepare('SELECT id FROM mail_messages WHERE identity_key = ?').get(fixture.id).id,
    );
    const actual = {
      category: row.category,
      mode: row.mode,
      deadline: row.deadlineKind,
      attention: attention?.reasonKind ?? null,
    };
    const want = fixture.expected;

    if (actual.category === want.category) metrics.categoryHit += 1;
    if (actual.mode === want.mode) metrics.modeHit += 1;
    if (actual.deadline === want.deadline) metrics.deadlineHit += 1;
    if (actual.attention === want.attention) metrics.attentionHit += 1;

    if (want.mode === 'silent' && actual.mode !== 'silent') metrics.falsePositive += 1;
    if (want.mode !== 'silent' && actual.mode === 'silent') metrics.falseNegative += 1;
    if (want.mode !== 'immediate' && actual.mode === 'immediate') metrics.immediateFalseAlarm += 1;
    if (want.deadline !== actual.deadline) metrics.deadlineFalseAlarm += 1;
    if (want.attention === 'action_required' && actual.attention !== 'action_required') {
      metrics.actionMissed += 1;
    }

    const diff = ['category', 'mode', 'deadline', 'attention']
      .filter(key => actual[key] !== want[key])
      .map(key => `${key}: ${want[key]} → ${actual[key]}`);
    const mark = diff.length ? '✗' : '✓';
    console.log(`${mark} ${fixture.id}`);
    if (diff.length) {
      console.log(`    ${diff.join(' | ')}`);
      console.log(`    conf=${row.confidence} summary=${row.summary || ''}`);
      misses.push(`${fixture.id}: ${diff.join(' | ')}`);
    }
  }

  const total = fixtures.length;
  const pct = value => `${value}/${total} (${Math.round((value / total) * 100)}%)`;
  console.log('\n── 결과 ──');
  console.log(`분석 완료          ${pct(metrics.analyzed)}`);
  console.log(`category 일치      ${pct(metrics.categoryHit)}`);
  console.log(`notification 일치  ${pct(metrics.modeHit)}`);
  console.log(`deadline 일치      ${pct(metrics.deadlineHit)}`);
  console.log(`attention 일치     ${pct(metrics.attentionHit)}`);
  console.log('');
  console.log(`false positive       ${metrics.falsePositive}`);
  console.log(`false negative       ${metrics.falseNegative}`);
  console.log(`immediate 오탐       ${metrics.immediateFalseAlarm}`);
  console.log(`deadline 오탐        ${metrics.deadlineFalseAlarm}`);
  console.log(`action_required 누락 ${metrics.actionMissed}`);
  if (latencies.length) {
    const sorted = [...latencies].sort((a, b) => a - b);
    console.log(`\n지연 median ${sorted[Math.floor(sorted.length / 2)]}ms · max ${sorted.at(-1)}ms`);
  }
  db.close();

  // 판정은 사람이 한다. 이 스크립트는 통과 문턱을 스스로 정하지 않는다 —
  // 문턱을 코드에 박으면 결과를 본 뒤 그 숫자를 고치고 싶어진다.
  process.exitCode = misses.length ? 1 : 0;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
