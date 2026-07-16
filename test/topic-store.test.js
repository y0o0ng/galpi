'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  auditTopicStore,
  formatTopicStoreAudit,
  parseQaLog,
  parseTopicNote,
} = require('../lib/topic-store');
const { parseArguments } = require('../scripts/audit-topic-store');

function qaEntry(qaId, question, answer, stamp = '2026-07-16 09:00') {
  return [
    `### ${stamp} · Claude`,
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

function createDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL
    );
    CREATE TABLE notes (
      filename TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      note_type TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE note_chunks (
      chunk_id TEXT NOT NULL,
      note_filename TEXT NOT NULL,
      note_title TEXT NOT NULL,
      chunk_type TEXT NOT NULL,
      source_session TEXT,
      source_user_message,
      source_assistant_message,
      embedding TEXT
    );
  `);
  return db;
}

test('topic parser uses date heading plus qa_id and keeps date headings inside answers', () => {
  const first = qaEntry(
    'qa-a111',
    '첫 질문',
    '첫 답변\n\n### 2026-07-15 회고\n이 제목은 답변 내용이다.'
  );
  const second = qaEntry('qa-b222', '둘째 질문', '둘째 답변', '2026-07-16 10:00');
  const raw = topicNote('파서 테스트', [first, second]);
  const parsed = parseTopicNote(raw, { filename: 'topic.md' });

  assert.equal(parsed.parseable, true);
  assert.deepEqual(parsed.entries.map(entry => entry.qaId), ['qa-a111', 'qa-b222']);
  assert.match(parsed.entries[0].content, /### 2026-07-15 회고/);

  const withCrLfAndTrailingSpaces = raw
    .split('\n')
    .map(line => `${line}  `)
    .join('\r\n');
  assert.equal(
    parseTopicNote(withCrLfAndTrailingSpaces, { filename: 'topic.md' }).contentSha256,
    parsed.contentSha256
  );
});

test('topic parser reports malformed markers, missing ids, orphan ids, and duplicate ids', () => {
  const duplicateMarkers = parseQaLog([
    '<!-- QA-LOG-START -->',
    '<!-- QA-LOG-START -->',
    qaEntry('qa-a111', '질문', '답변'),
    '<!-- QA-LOG-END -->',
  ].join('\n'));
  assert.equal(duplicateMarkers.parseable, false);
  assert.ok(duplicateMarkers.issues.some(item => item.code === 'qa_log_start_count'));

  const missingId = parseQaLog([
    '<!-- QA-LOG-START -->',
    '### 2026-07-16 09:00 · Claude',
    '**Q:** ID 없는 질문',
    '',
    '**A:** 답변',
    '<!-- QA-LOG-END -->',
  ].join('\n'));
  assert.equal(missingId.parseable, false);
  assert.ok(missingId.issues.some(item => item.code === 'qa_id_missing'));

  const orphanId = parseQaLog([
    '<!-- QA-LOG-START -->',
    qaEntry('qa-a111', '질문', '답변'),
    '<!-- qa_id: qa-b222 -->',
    '<!-- QA-LOG-END -->',
  ].join('\n'));
  assert.equal(orphanId.parseable, false);
  assert.ok(orphanId.issues.some(item => item.code === 'qa_id_orphan_marker'));

  const duplicateIds = parseQaLog([
    '<!-- QA-LOG-START -->',
    qaEntry('qa-a111', '첫 질문', '첫 답변'),
    qaEntry('qa-a111', '둘째 질문', '둘째 답변', '2026-07-16 10:00'),
    '<!-- QA-LOG-END -->',
  ].join('\n'));
  assert.equal(duplicateIds.parseable, false);
  assert.ok(duplicateIds.issues.some(item => item.code === 'qa_id_duplicate_in_note'));
});

test('topic store audit separates repairable drift from unverifiable notes', async t => {
  const vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'topic-store-audit-'));
  t.after(() => fs.rm(vaultPath, { recursive: true, force: true }));
  const db = createDatabase();
  t.after(() => db.close());

  await fs.writeFile(path.join(vaultPath, 'alpha.md'), topicNote('Alpha Current', [
    qaEntry('qa-a111', '일치 질문', '일치 답변'),
    qaEntry('qa-b222', '파일 전용 질문', '파일 전용 답변', '2026-07-16 10:00'),
  ]));
  await fs.writeFile(path.join(vaultPath, 'beta.md'), topicNote('Beta', [
    qaEntry('qa-c333', '배정 질문', '배정 답변'),
  ]));
  await fs.writeFile(path.join(vaultPath, 'untracked.md'), topicNote('Untracked', [
    qaEntry('qa-d444', '미추적 질문', '미추적 답변'),
  ]));
  await fs.writeFile(path.join(vaultPath, 'bad.md'), topicNote('Bad', [
    '### 2026-07-16 09:00 · Claude\n**Q:** ID 없음\n\n**A:** 확인 불가',
  ]));

  const insertNote = db.prepare('INSERT INTO notes VALUES (?, ?, ?, ?)');
  insertNote.run('alpha.md', 'Alpha DB', 'topic', 0);
  insertNote.run('beta.md', 'Beta', 'topic', 0);
  insertNote.run('missing.md', 'Missing', 'topic', 0);
  insertNote.run('bad.md', 'Bad', 'topic', 0);
  insertNote.run('archived.md', 'Archived', 'topic', 1);
  insertNote.run('highlight.md', 'Highlight', 'highlight', 0);
  db.prepare("INSERT INTO sessions VALUES ('session-1')").run();
  db.prepare("INSERT INTO messages VALUES (1, 'session-1'), (2, 'session-1')").run();

  const insertChunk = db.prepare(`
    INSERT INTO note_chunks (
      chunk_id, note_filename, note_title, chunk_type,
      source_session, source_user_message, source_assistant_message, embedding
    ) VALUES (?, ?, ?, 'topic_qa', ?, ?, ?, ?)
  `);
  insertChunk.run('qa-a111', 'alpha.md', 'Alpha Cached', 'session-1', 1, 2, '[]');
  insertChunk.run('qa-e555', 'alpha.md', 'Alpha Current', 'session-1', null, 'not-an-id', null);
  insertChunk.run('qa-c333', 'alpha.md', 'Alpha Current', null, null, null, '[]');
  insertChunk.run('qa-f666', 'bad.md', 'Bad', null, null, null, '[]');
  insertChunk.run('qa-a777', 'archived.md', 'Archived', null, null, null, '[]');
  insertChunk.run('qa-a888', 'orphan.md', 'Orphan', null, null, null, '[]');
  insertChunk.run('qa-a999', 'highlight.md', 'Highlight', null, null, null, '[]');

  const report = await auditTopicStore({ db, vaultPath });
  const repeated = await auditTopicStore({ db, vaultPath });

  assert.deepEqual(repeated, report);
  assert.equal(report.healthy, false);
  assert.deepEqual(report.summary, {
    vaultActiveTopics: 4,
    dbActiveTopics: 4,
    auditedTopics: 5,
    fileQaEntries: 4,
    dbActiveTopicChunks: 4,
    matchedQa: 1,
    malformedTopics: 2,
    fileOnlyQa: 2,
    dbOnlyChunks: 1,
    assignmentDrift: 1,
    duplicateFileQaIds: 0,
    duplicateDbChunkIds: 0,
    chunkTitleDrift: 1,
    sourceReferenceErrors: 1,
    orphanChunks: 1,
    archivedChunks: 1,
    missingEmbeddings: 1,
    unverifiableChunks: 1,
  });
  assert.deepEqual(report.findings.fileOnlyQa.map(item => item.qaId), ['qa-b222', 'qa-d444']);
  assert.deepEqual(report.findings.dbOnlyChunks.map(item => item.chunkId), ['qa-e555']);
  assert.deepEqual(report.findings.assignmentDrift, [{
    qaId: 'qa-c333',
    fileFilename: 'beta.md',
    dbFilename: 'alpha.md',
  }]);
  assert.equal(report.findings.sourceReferenceErrors[0].reason, 'invalid_format');
  assert.match(
    report.notes.find(note => note.filename === 'alpha.md').qaEntries[0].contentSha256,
    /^[a-f0-9]{64}$/
  );
  assert.match(formatTopicStoreAudit(report), /Topic store audit: needs attention/);

  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notes').get().count, 6);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM note_chunks').get().count, 7);
});

test('topic store audit passes a matching topic without changing data', async t => {
  const vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'topic-store-healthy-'));
  t.after(() => fs.rm(vaultPath, { recursive: true, force: true }));
  const db = createDatabase();
  t.after(() => db.close());

  await fs.writeFile(path.join(vaultPath, 'topic.md'), topicNote('Topic', [
    qaEntry('qa-a111', '질문', '답변'),
  ]));
  db.prepare("INSERT INTO notes VALUES ('topic.md', 'Topic', 'topic', 0)").run();
  db.prepare("INSERT INTO sessions VALUES ('session-1')").run();
  db.prepare("INSERT INTO messages VALUES (1, 'session-1'), (2, 'session-1')").run();
  db.prepare(`
    INSERT INTO note_chunks VALUES (
      'qa-a111', 'topic.md', 'Topic', 'topic_qa', 'session-1', 1, 2, '[]'
    )
  `).run();

  const report = await auditTopicStore({ db, vaultPath });
  assert.equal(report.healthy, true);
  assert.equal(report.summary.matchedQa, 1);
  assert.match(formatTopicStoreAudit(report), /Topic store audit: passed/);
});

test('topic store audit reports the same qa_id appearing in multiple topic files', async t => {
  const vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'topic-store-duplicate-'));
  t.after(() => fs.rm(vaultPath, { recursive: true, force: true }));
  const db = createDatabase();
  t.after(() => db.close());

  await fs.writeFile(path.join(vaultPath, 'a.md'), topicNote('A', [
    qaEntry('qa-a111', '첫 질문', '첫 답변'),
  ]));
  await fs.writeFile(path.join(vaultPath, 'b.md'), topicNote('B', [
    qaEntry('qa-a111', '복제 질문', '복제 답변'),
  ]));
  db.prepare("INSERT INTO notes VALUES ('a.md', 'A', 'topic', 0), ('b.md', 'B', 'topic', 0)").run();
  db.prepare(`
    INSERT INTO note_chunks VALUES (
      'qa-a111', 'a.md', 'A', 'topic_qa', NULL, NULL, NULL, '[]'
    )
  `).run();

  const report = await auditTopicStore({ db, vaultPath });
  assert.equal(report.healthy, false);
  assert.deepEqual(report.findings.duplicateFileQaIds, [{
    qaId: 'qa-a111',
    filenames: ['a.md', 'b.md'],
  }]);
  assert.equal(report.summary.matchedQa, 0);
  assert.equal(report.summary.fileOnlyQa, 0);
  assert.equal(report.summary.dbOnlyChunks, 0);
});

test('topic audit CLI arguments reject unknown or incomplete options', () => {
  assert.deepEqual(parseArguments(['--json', '--db', './test.db', '--vault', './vault']), {
    dbPath: path.resolve('./test.db'),
    vaultPath: path.resolve('./vault'),
    json: true,
    help: false,
  });
  assert.throws(() => parseArguments(['--db']), /파일 경로/);
  assert.throws(() => parseArguments(['--write']), /알 수 없는 인자/);
});
