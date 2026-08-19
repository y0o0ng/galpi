'use strict';

// 메일 검색 (설계 4·11.1·23). 찾는 것은 **판단이 남긴 것**이다.
//
// 본문은 DB에 없다. 그래서 이 검색은 메일함 grep이 아니라 제목·발신자와 요약·행동·
// 분류·기한을 찾는다. 알림을 껐거나 silent로 판정한 메일도 그대로 나온다.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const { createMailStore } = require('../lib/mail/store');

const NOW = Math.floor(Date.parse('2026-08-19T14:00:00+09:00') / 1000);
const DAY = 24 * 60 * 60;

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

let seed = 0;
function seedMail(db, row) {
  seed += 1;
  const id = db.prepare(`
    INSERT INTO mail_messages (
      account_id, identity_kind, identity_key, received_at, analysis_state,
      subject, sender_name, sender_address, summary, action_text,
      category, notification_mode, notification_state
    ) VALUES (1, 'rfc_message_id', ?, ?, 'done', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `<s${seed}@example.com>`, row.receivedAt ?? NOW - 600,
    row.subject, row.senderName ?? null, row.senderAddress,
    row.summary ?? null, row.actionText ?? null,
    row.category ?? 'info', row.mode ?? 'silent', row.state ?? 'suppressed',
  ).lastInsertRowid;
  if (row.attention) {
    // `done`은 해결 시각을 함께 가져야 한다는 것이 표의 CHECK다.
    db.prepare('INSERT INTO mail_attention (mail_message_id, state, resolved_at) VALUES (?, ?, ?)')
      .run(id, row.attention, row.attention === 'done' ? NOW - 60 : null);
  }
  return id;
}

function setup() {
  const db = createDatabase();
  db.prepare("INSERT INTO mail_accounts (provider, address) VALUES ('naver', 'me@naver.com')").run();
  return { db, store: createMailStore(db, { now: () => NOW }) };
}

test('search reads what the judgement left, not the mail body', () => {
  const { db, store } = setup();
  seedMail(db, {
    subject: '[예시] 1차 면접 일정 회신 요청',
    senderName: '채용팀',
    senderAddress: 'hr@example.com',
    summary: '8월 20일까지 가능한 면접 시간을 회신해야 합니다.',
    actionText: '가능한 시간대 회신',
    category: 'action_required',
  });

  // 제목·발신자·요약·행동 어디에 걸려도 찾는다.
  for (const query of ['면접', '채용팀', 'hr@example.com', '회신해야', '시간대']) {
    assert.equal(store.searchMessages({ query }).length, 1, query);
  }
  // 본문에만 있었을 문장은 애초에 저장되지 않으므로 찾을 수 없다.
  assert.equal(store.searchMessages({ query: '첨부한 지원서를 확인해 주세요' }).length, 0);
  db.close();
});

test('a mail the user silenced is still findable', () => {
  const { db, store } = setup();
  const silenced = seedMail(db, {
    subject: '구독 갱신 안내',
    senderAddress: 'billing@example.com',
    summary: '구독이 9월 1일에 갱신됩니다.',
    category: 'info',
    mode: 'silent',
    state: 'suppressed',
  });

  // 알림을 껐다는 이유로 기록을 잃지 않는다(설계 11.1).
  const found = store.searchMessages({ query: '구독' });
  assert.equal(found.length, 1);
  assert.equal(found[0].id, silenced);
  assert.equal(found[0].summary, '구독이 9월 1일에 갱신됩니다.');
  db.close();
});

test('filters narrow by category, sender, period, and open attention', () => {
  const { db, store } = setup();
  seedMail(db, {
    subject: '계약서 검토 요청',
    senderAddress: 'legal@example.com',
    category: 'action_required',
    attention: 'open',
    receivedAt: NOW - 3600,
  });
  seedMail(db, {
    subject: '주간 뉴스레터',
    senderAddress: 'news@example.com',
    category: 'info',
    receivedAt: NOW - 5 * DAY,
  });
  seedMail(db, {
    subject: '지난달 영수증',
    senderAddress: 'billing@example.com',
    category: 'info',
    attention: 'done',
    receivedAt: NOW - 40 * DAY,
  });

  assert.deepEqual(
    store.searchMessages({ category: 'action_required' }).map(m => m.subject),
    ['계약서 검토 요청'],
  );
  assert.deepEqual(
    store.searchMessages({ senderAddress: 'NEWS@example.com' }).map(m => m.subject),
    ['주간 뉴스레터'],
  );
  assert.deepEqual(
    store.searchMessages({ since: NOW - 2 * DAY }).map(m => m.subject),
    ['계약서 검토 요청'],
  );
  assert.deepEqual(
    store.searchMessages({ until: NOW - 30 * DAY }).map(m => m.subject),
    ['지난달 영수증'],
  );
  // 아직 처리하지 않은 것만. 이미 끝낸 Attention은 후속 행동이 남아 있지 않다.
  assert.deepEqual(
    store.searchMessages({ needsAction: true }).map(m => m.subject),
    ['계약서 검토 요청'],
  );
  db.close();
});

test('newest first, and the result count stays bounded', () => {
  const { db, store } = setup();
  for (let index = 0; index < 30; index += 1) {
    seedMail(db, {
      subject: `공지 ${index}`,
      senderAddress: 'notice@example.com',
      receivedAt: NOW - index * 60,
    });
  }
  const results = store.searchMessages({ query: '공지' });
  assert.equal(results.length, 8, '기본 상한');
  assert.equal(results[0].subject, '공지 0', '최신이 먼저');
  assert.equal(store.searchMessages({ query: '공지', limit: 100 }).length, 20, '상한을 넘길 수 없다');
  assert.equal(store.searchMessages({ query: '공지', limit: 0 }).length, 1);
  db.close();
});

test('wildcards typed by a person are matched as text, not as a pattern', () => {
  const { db, store } = setup();
  seedMail(db, { subject: '할인 100% 행사', senderAddress: 'ads@example.com' });
  seedMail(db, { subject: '평범한 공지', senderAddress: 'notice@example.com' });

  // `%`가 패턴으로 새면 전건이 나온다. 그래서 이스케이프한다.
  assert.deepEqual(store.searchMessages({ query: '%' }).map(m => m.subject), ['할인 100% 행사']);
  assert.equal(store.searchMessages({ query: '_' }).length, 0);
  db.close();
});
