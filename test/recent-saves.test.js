'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { compactText, createRecentSavesReader } = require('../lib/recent-saves');

function createDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE notes (
      filename TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      note_type TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE auto_save_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      decision TEXT NOT NULL,
      reason TEXT NOT NULL,
      question TEXT NOT NULL,
      answer_excerpt TEXT NOT NULL,
      qa_id TEXT,
      note_filename TEXT,
      note_title TEXT,
      action TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

test('compactText normalizes whitespace and bounds long questions', () => {
  assert.equal(compactText('  질문\n  내용   정리  '), '질문 내용 정리');
  assert.equal(compactText('abcdefghij', 6), 'abcde…');
});

test('recent saves returns current active topic targets and excludes unrelated decisions', t => {
  const db = createDatabase();
  t.after(() => db.close());
  const insertNote = db.prepare('INSERT INTO notes VALUES (?, ?, ?, ?)');
  insertNote.run('active.md', '현재 토픽 제목', 'topic', 0);
  insertNote.run('archived.md', '보관 토픽', 'topic', 1);
  insertNote.run('highlight.md', '수동 하이라이트', 'highlight', 0);
  const insertDecision = db.prepare(`
    INSERT INTO auto_save_decisions (
      decision, reason, question, answer_excerpt, qa_id,
      note_filename, note_title, action, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertDecision.run('save', 'semantic_signal', '첫 질문', '첫 답변', 'qa-1', 'active.md', '이전 제목', 'created', 100);
  insertDecision.run('save', 'semantic_signal', '  최근\n질문  ', '최근 답변', 'qa-2', 'active.md', '이전 제목', 'appended', 200);
  insertDecision.run('skip', 'weak_signal', '제외 질문', '제외 답변', null, null, null, null, 300);
  insertDecision.run('save', 'semantic_signal', '보관 질문', '보관 답변', 'qa-3', 'archived.md', '보관 토픽', 'created', 400);
  insertDecision.run('save', 'manual_save', '하이라이트 질문', '답변', 'qa-4', 'highlight.md', '수동 하이라이트', 'created', 500);

  const listRecentSaves = createRecentSavesReader(db);
  const rows = listRecentSaves();

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.qaId), ['qa-2', 'qa-1']);
  assert.equal(rows[0].text, '최근 질문');
  assert.equal(rows[0].action, 'appended');
  assert.deepEqual(rows[0].note, { filename: 'active.md', title: '현재 토픽 제목' });
});

test('recent saves falls back to memo content and enforces the requested limit', t => {
  const db = createDatabase();
  t.after(() => db.close());
  db.prepare("INSERT INTO notes VALUES ('memo.md', '메모 토픽', 'topic', 0)").run();
  const insert = db.prepare(`
    INSERT INTO auto_save_decisions (
      decision, reason, question, answer_excerpt, qa_id,
      note_filename, note_title, action, created_at
    ) VALUES ('save', 'manual_memo', '', ?, ?, 'memo.md', '메모 토픽', 'appended', ?)
  `);
  insert.run('첫 메모', 'qa-1', 100);
  insert.run('둘째 메모', 'qa-2', 200);

  const rows = createRecentSavesReader(db)(1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].text, '둘째 메모');
});
