'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { noteContentSha256 } = require('../lib/note-index-state');
const { applyTopicQaRemoval, readTopicQaRemovalPlan } = require('../lib/topic-qa-removal');
const { parseTopicNote } = require('../lib/topic-store');
const { parseTarget } = require('../scripts/remove-topic-qa');

function qaEntry(qaId, question, answer) {
  return [
    '### 2026-07-19 10:00 · Claude',
    `<!-- qa_id: ${qaId} -->`,
    `**Q:** ${question}`,
    '',
    `**A:** ${answer}`,
  ].join('\n');
}

function topicNote(title, entries) {
  return [
    '---',
    `title: "${title}"`,
    'note_type: topic',
    'archived: false',
    '---',
    '',
    `# ${title}`,
    '',
    '## Q&A 로그',
    '<!-- QA-LOG-START -->',
    '',
    entries.join('\n\n'),
    '',
    '<!-- QA-LOG-END -->',
    '',
  ].join('\n');
}

async function createFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'topic-qa-removal-'));
  const vaultPath = path.join(root, 'vault');
  const dbPath = path.join(root, 'galpi.db');
  await fs.mkdir(vaultPath);
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL
    );
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      note_type TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      codex_status TEXT NOT NULL DEFAULT 'ready',
      source_session TEXT,
      source_message TEXT,
      embedding TEXT,
      content_sha256 TEXT,
      indexed_sha256 TEXT,
      index_status TEXT NOT NULL DEFAULT 'ready',
      updated_at INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE note_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chunk_id TEXT UNIQUE NOT NULL,
      note_filename TEXT NOT NULL,
      note_title TEXT NOT NULL,
      chunk_type TEXT NOT NULL,
      content TEXT NOT NULL,
      source_session TEXT,
      source_user_message INTEGER,
      source_assistant_message INTEGER,
      embedding TEXT,
      index_status TEXT NOT NULL DEFAULT 'ready',
      updated_at INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE auto_save_decisions (
      id INTEGER PRIMARY KEY,
      qa_id TEXT,
      note_filename TEXT,
      source_user_message INTEGER,
      source_assistant_message INTEGER,
      decision TEXT,
      action TEXT
    );
  `);

  const specs = [
    {
      filename: 'sleep.md',
      title: '숙면 대행 서비스',
      keepQaId: 'qa-11111111-1111-4111-8111-111111111111',
      keepUser: 11,
      keepAssistant: 12,
      qaId: 'qa-33333333-3333-4333-8333-333333333333',
      decisionId: 141,
      userMessageId: 333,
      assistantMessageId: 334,
    },
    {
      filename: 'poem.md',
      title: '시',
      keepQaId: 'qa-22222222-2222-4222-8222-222222222222',
      keepUser: 21,
      keepAssistant: 22,
      qaId: 'qa-44444444-4444-4444-8444-444444444444',
      decisionId: 142,
      userMessageId: 335,
      assistantMessageId: 336,
    },
  ];

  for (const spec of specs) {
    const raw = topicNote(spec.title, [
      qaEntry(spec.keepQaId, '남길 질문', '남길 답변'),
      qaEntry(spec.qaId, '잘못 저장된 질문', '잘못 저장된 답변'),
    ]);
    await fs.writeFile(path.join(vaultPath, spec.filename), raw);
    const contentSha256 = noteContentSha256({
      filename: spec.filename,
      title: spec.title,
      noteType: 'topic',
      raw,
    });
    db.prepare(`
      INSERT INTO notes (
        filename, title, note_type, source_session, source_message,
        embedding, content_sha256, indexed_sha256
      ) VALUES (?, ?, 'topic', 'session', ?, '[1,0]', ?, ?)
    `).run(spec.filename, spec.title, spec.assistantMessageId, contentSha256, contentSha256);
    db.prepare(`
      INSERT INTO note_chunks (
        chunk_id, note_filename, note_title, chunk_type, content, source_session,
        source_user_message, source_assistant_message, embedding, updated_at
      ) VALUES (?, ?, ?, 'topic_qa', 'keep', 'session', ?, ?, '[1,0]', 1)
    `).run(spec.keepQaId, spec.filename, spec.title, spec.keepUser, spec.keepAssistant);
    db.prepare(`
      INSERT INTO note_chunks (
        chunk_id, note_filename, note_title, chunk_type, content, source_session,
        source_user_message, source_assistant_message, embedding, updated_at
      ) VALUES (?, ?, ?, 'topic_qa', 'remove', 'session', ?, ?, '[1,0]', 2)
    `).run(spec.qaId, spec.filename, spec.title, spec.userMessageId, spec.assistantMessageId);
    db.prepare(`
      INSERT INTO auto_save_decisions VALUES (?, ?, ?, ?, ?, 'save', 'appended')
    `).run(
      spec.decisionId,
      spec.qaId,
      spec.filename,
      spec.userMessageId,
      spec.assistantMessageId,
    );
    db.prepare("INSERT INTO messages VALUES (?, 'session', 'user', ?)")
      .run(spec.userMessageId, `원본 질문 ${spec.userMessageId}`);
    db.prepare("INSERT INTO messages VALUES (?, 'session', 'assistant', ?)")
      .run(spec.assistantMessageId, `원본 답변 ${spec.assistantMessageId}`);

    const entry = parseTopicNote(raw, { filename: spec.filename }).entries
      .find(item => item.qaId === spec.qaId);
    spec.entryContentSha256 = entry.contentSha256;
  }
  db.close();

  return { dbPath, vaultPath, targets: specs.map(spec => ({
    filename: spec.filename,
    qaId: spec.qaId,
    entryContentSha256: spec.entryContentSha256,
    decisionId: spec.decisionId,
    userMessageId: spec.userMessageId,
    assistantMessageId: spec.assistantMessageId,
  })) };
}

test('hash-guarded removal deletes two saved QAs but preserves source messages', async t => {
  const fixture = await createFixture(t);
  const plan = await readTopicQaRemovalPlan(fixture);
  let backedUp = false;
  const result = await applyTopicQaRemoval({
    ...fixture,
    expectedInputSha256: plan.inputSha256,
    confirmServiceStopped: true,
    createBackup: async () => {
      backedUp = true;
      const dbDest = path.join(fixture.vaultPath, 'backup.db');
      const vaultDest = path.join(fixture.vaultPath, 'backup.tar.gz');
      await Promise.all([
        fs.writeFile(dbDest, 'db backup'),
        fs.writeFile(vaultDest, 'vault backup'),
      ]);
      return { dbDest, vaultDest };
    },
  });

  assert.equal(backedUp, true);
  assert.equal(result.removedQaCount, 2);
  assert.equal(result.preservedMessageCount, 4);
  assert.equal(result.pendingNoteCount, 2);

  const db = new Database(fixture.dbPath, { readonly: true });
  t.after(() => db.close());
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages').get().count, 4);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM note_chunks').get().count, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM auto_save_decisions').get().count, 0);
  for (const target of fixture.targets) {
    const raw = await fs.readFile(path.join(fixture.vaultPath, target.filename), 'utf8');
    const parsed = parseTopicNote(raw, { filename: target.filename });
    assert.equal(parsed.entries.some(entry => entry.qaId === target.qaId), false);
    assert.equal(parsed.entries.length, 1);
    const note = db.prepare(`
      SELECT content_sha256 AS contentSha256, indexed_sha256 AS indexedSha256,
             index_status AS indexStatus, embedding
      FROM notes WHERE filename = ?
    `).get(target.filename);
    assert.equal(note.contentSha256, parsed.contentSha256);
    assert.equal(note.indexedSha256, null);
    assert.equal(note.indexStatus, 'pending');
    assert.equal(note.embedding, null);
  }
});

test('CLI target parser keeps all six approval fields', () => {
  assert.deepEqual(
    parseTarget(`topic.md|qa-one|${'a'.repeat(64)}|7|8|9`),
    {
      filename: 'topic.md',
      qaId: 'qa-one',
      entryContentSha256: 'a'.repeat(64),
      decisionId: '7',
      userMessageId: '8',
      assistantMessageId: '9',
    },
  );
});
