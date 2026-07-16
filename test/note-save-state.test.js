'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { createNoteSaveStateReader, savedNoteTypeForModel } = require('../lib/note-save-state');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      note_type TEXT NOT NULL,
      source_message TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE note_chunks (
      chunk_id TEXT PRIMARY KEY,
      note_filename TEXT NOT NULL,
      note_title TEXT NOT NULL,
      source_user_message INTEGER,
      source_assistant_message INTEGER,
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

test('savedNoteTypeForModel separates council notes from topic notes', () => {
  assert.equal(savedNoteTypeForModel('의회'), 'council');
  assert.equal(savedNoteTypeForModel('심층 의회'), 'council');
  assert.equal(savedNoteTypeForModel('Claude'), 'topic');
});

test('council auto topic does not hide the manual council save action', () => {
  const db = createDb();
  db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)')
    .run(10, 'shared', 'assistant', 'full council transcript', '의회', 10);
  db.prepare('INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?)')
    .run(1, 'topic.md', '자동 토픽', 'topic', '10', 10);
  db.prepare('INSERT INTO note_chunks VALUES (?, ?, ?, ?, ?, ?)')
    .run('chunk-1', 'topic.md', '자동 토픽', null, 10, 10);

  const reader = createNoteSaveStateReader(db);
  assert.equal(reader.findForMessage(10), null);
  assert.equal(reader.listSessionMessages('shared')[0].noteSaved, 0);
  assert.equal(reader.find(10, 'topic').filename, 'topic.md');

  db.prepare('INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?)')
    .run(2, 'council.md', '의회 전체', 'council', '10', 11);

  assert.equal(reader.findForMessage(10).filename, 'council.md');
  assert.equal(reader.listSessionMessages('shared')[0].noteSaved, 1);
  assert.equal(reader.find(10, 'council').filename, 'council.md');
  db.close();
});

test('regular assistant messages still use topic chunks as their saved state', () => {
  const db = createDb();
  db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)')
    .run(20, 'shared', 'assistant', 'answer', 'Claude', 20);
  db.prepare('INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?)')
    .run(1, 'topic.md', '토픽', 'topic', null, 20);
  db.prepare('INSERT INTO note_chunks VALUES (?, ?, ?, ?, ?, ?)')
    .run('chunk-2', 'topic.md', '토픽', null, 20, 20);

  const reader = createNoteSaveStateReader(db);
  assert.equal(reader.findForMessage(20).filename, 'topic.md');
  assert.equal(reader.listSessionMessages('shared')[0].noteSaved, 1);
  assert.throws(() => reader.find(20, 'paper'), /지원하지 않는/);
  db.close();
});

test('source_missing chunks do not mark an assistant response as saved', () => {
  const db = createDb();
  db.exec(`
    ALTER TABLE note_chunks
    ADD COLUMN index_status TEXT NOT NULL DEFAULT 'ready'
  `);
  db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)')
    .run(30, 'shared', 'assistant', 'answer', 'Claude', 30);
  db.prepare('INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?)')
    .run(1, 'topic.md', '토픽', 'topic', '30', 30);
  db.prepare(`
    INSERT INTO note_chunks (
      chunk_id, note_filename, note_title,
      source_user_message, source_assistant_message, updated_at, index_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('chunk-3', 'topic.md', '토픽', null, 30, 30, 'source_missing');

  const reader = createNoteSaveStateReader(db);
  assert.equal(reader.findForMessage(30), null);
  assert.equal(reader.listSessionMessages('shared')[0].noteSaved, 0);

  db.prepare("UPDATE note_chunks SET index_status = 'ready' WHERE chunk_id = 'chunk-3'").run();
  assert.equal(reader.findForMessage(30).filename, 'topic.md');
  assert.equal(reader.listSessionMessages('shared')[0].noteSaved, 1);
  db.close();
});
