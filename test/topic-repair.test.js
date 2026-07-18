'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const {
  applyTopicRepair,
  readTopicRepairPlan,
} = require('../lib/topic-repair');
const { parseApplyArguments } = require('../scripts/apply-topic-repair');
const { parseTopicNote } = require('../lib/topic-store');

function qaEntry(qaId, question, answer, stamp = '2026-07-16 09:00') {
  return [
    `### ${stamp} · Claude`,
    `<!-- qa_id: ${qaId} -->`,
    `**Q:** ${question}`,
    '',
    `**A:** ${answer}`,
  ].join('\n');
}

function topicNote(title, entries, archived = false) {
  return [
    '---',
    `title: "${title}"`,
    'note_type: topic',
    `archived: ${archived}`,
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

function chunkContent(question, answer) {
  return `Q: ${question}\nA: ${answer}`;
}

async function createRepairFixture(t, { failTitleUpdate = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'topic-repair-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dbPath = path.join(root, 'galpi.db');
  const vaultPath = path.join(root, 'vault');
  const backupDir = path.join(root, 'backups');
  await fs.mkdir(vaultPath);

  await fs.writeFile(path.join(vaultPath, 'm60.md'), topicNote('M60', [
    qaEntry('qa-a111', '같은 질문', '같은 답변'),
  ]));
  await fs.writeFile(path.join(vaultPath, 'perfume.md'), topicNote('Perfume', [
    qaEntry('qa-a111', '같은 질문', '같은 답변'),
  ]));
  await fs.writeFile(path.join(vaultPath, 'topic.md'), topicNote('Current Title', [
    qaEntry('qa-b222', '현재 질문', '현재 답변'),
  ]));
  await fs.writeFile(path.join(vaultPath, 'archived.md'), topicNote('Archived', [
    qaEntry('qa-d444', '보관 질문', '보관 답변'),
  ], true));

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      note_type TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      codex_status TEXT NOT NULL DEFAULT 'pending',
      source_session TEXT,
      source_message TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
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
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE auto_save_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      source_user_message,
      source_assistant_message,
      model TEXT,
      decision TEXT NOT NULL,
      reason TEXT NOT NULL,
      question TEXT NOT NULL,
      answer_excerpt TEXT NOT NULL,
      qa_id TEXT,
      note_filename TEXT,
      note_title TEXT,
      action TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);
  const insertNote = db.prepare(`
    INSERT INTO notes (filename, title, note_type, archived)
    VALUES (?, ?, 'topic', ?)
  `);
  insertNote.run('m60.md', 'M60', 0);
  insertNote.run('perfume.md', 'Perfume', 0);
  insertNote.run('topic.md', 'Current Title', 0);
  insertNote.run('archived.md', 'Archived', 1);

  const insertChunk = db.prepare(`
    INSERT INTO note_chunks (
      chunk_id, note_filename, note_title, chunk_type, content, embedding
    ) VALUES (?, ?, ?, 'topic_qa', ?, '[]')
  `);
  insertChunk.run('qa-a111', 'm60.md', 'M60', chunkContent('같은 질문', '같은 답변'));
  insertChunk.run('qa-b222', 'topic.md', 'Cached Title', chunkContent('현재 질문', '현재 답변'));
  insertChunk.run('qa-c333', 'topic.md', 'Current Title', chunkContent('사라진 질문', '사라진 답변'));
  insertChunk.run('qa-d444', 'archived.md', 'Archived', chunkContent('보관 질문', '보관 답변'));
  db.prepare(`
    INSERT INTO auto_save_decisions (
      decision, reason, question, answer_excerpt,
      qa_id, note_filename, note_title, action
    ) VALUES ('save', 'semantic_signal', '', '', 'qa-a111', 'm60.md', 'M60', 'created')
  `).run();
  if (failTitleUpdate) {
    db.exec(`
      CREATE TRIGGER fail_title_update
      BEFORE UPDATE OF note_title ON note_chunks
      WHEN NEW.note_title = 'Current Title'
      BEGIN
        SELECT RAISE(ABORT, 'forced title update failure');
      END
    `);
  }
  db.close();

  return { root, dbPath, vaultPath, backupDir };
}

function createTestBackupRecorder() {
  const calls = [];
  async function createBackup({ dbPath, vaultPath, backupDir }) {
    calls.push({ dbPath, vaultPath, backupDir });
    await fs.mkdir(backupDir, { recursive: true });
    const dbDest = path.join(backupDir, 'galpi-test.db');
    const vaultDest = path.join(backupDir, 'vault-test.tar.gz');
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      await db.backup(dbDest);
    } finally {
      db.close();
    }
    await fs.writeFile(vaultDest, 'test vault backup');
    return {
      backupDir,
      dbDest,
      vaultDest,
      stamp: 'test',
      pruned: 0,
    };
  }
  return { calls, createBackup };
}

test('repair apply rejects stale input and missing manual approval before backup', async t => {
  const fixture = await createRepairFixture(t);
  const backup = createTestBackupRecorder();
  const { plan } = await readTopicRepairPlan(fixture);

  await assert.rejects(
    applyTopicRepair({
      ...fixture,
      expectedInputSha256: plan.inputSha256,
      approvedOperationIds: [],
      confirmServiceStopped: false,
      createBackup: backup.createBackup,
    }),
    /서버가 중지됐다는 확인/,
  );
  await assert.rejects(
    applyTopicRepair({
      ...fixture,
      expectedInputSha256: '0'.repeat(64),
      approvedOperationIds: [],
      confirmServiceStopped: true,
      createBackup: backup.createBackup,
    }),
    /입력 hash가 현재 상태와 다릅니다/,
  );
  await assert.rejects(
    applyTopicRepair({
      ...fixture,
      expectedInputSha256: plan.inputSha256,
      approvedOperationIds: [],
      confirmServiceStopped: true,
      createBackup: backup.createBackup,
    }),
    /수동 승인이 필요합니다/,
  );
  assert.equal(backup.calls.length, 0);

  const db = new Database(fixture.dbPath, { readonly: true });
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='schema_version'").get().count,
    0,
  );
  db.close();
});

test('repair apply backs up, migrates, applies approved operations, and reaches a clean plan', async t => {
  const fixture = await createRepairFixture(t);
  const backup = createTestBackupRecorder();
  const before = await readTopicRepairPlan(fixture);
  const duplicate = before.plan.operations.find(operation => operation.kind === 'duplicate_file_qa');

  const result = await applyTopicRepair({
    ...fixture,
    expectedInputSha256: before.plan.inputSha256,
    approvedOperationIds: [duplicate.id],
    confirmServiceStopped: true,
    createBackup: backup.createBackup,
  });

  assert.equal(result.appliedOperations, 3);
  assert.equal(result.finalPlan.status, 'clean');
  assert.equal(result.finalAudit.healthy, true);
  assert.equal(backup.calls.length, 1);

  const backupDb = new Database(result.backup.dbDest, { readonly: true });
  assert.equal(
    backupDb.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='schema_version'").get().count,
    0,
  );
  backupDb.close();

  const db = new Database(fixture.dbPath, { readonly: true });
  assert.deepEqual(
    db.prepare('SELECT version FROM schema_version ORDER BY version').all(),
    [{ version: 1 }, { version: 2 }],
  );
  assert.deepEqual(
    db.prepare(`
      SELECT chunk_id AS chunkId, note_title AS noteTitle, index_status AS indexStatus
      FROM note_chunks
      WHERE chunk_id IN ('qa-b222', 'qa-c333')
      ORDER BY chunk_id
    `).all(),
    [
      { chunkId: 'qa-b222', noteTitle: 'Current Title', indexStatus: 'ready' },
      { chunkId: 'qa-c333', noteTitle: 'Current Title', indexStatus: 'source_missing' },
    ],
  );
  db.close();

  const duplicateRaw = await fs.readFile(path.join(fixture.vaultPath, 'perfume.md'), 'utf8');
  const ownerRaw = await fs.readFile(path.join(fixture.vaultPath, 'm60.md'), 'utf8');
  assert.deepEqual(parseTopicNote(duplicateRaw, { filename: 'perfume.md' }).entries, []);
  assert.deepEqual(
    parseTopicNote(ownerRaw, { filename: 'm60.md' }).entries.map(entry => entry.qaId),
    ['qa-a111'],
  );
  assert.deepEqual(result.finalAudit.observations.archivedChunks, [{
    chunkId: 'qa-d444',
    filename: 'archived.md',
  }]);
  assert.deepEqual(result.finalAudit.observations.sourceMissingChunks, [{
    chunkId: 'qa-c333',
    filename: 'topic.md',
  }]);
});

test('repair apply restores files and the pre-migration DB when a DB operation fails', async t => {
  const fixture = await createRepairFixture(t, { failTitleUpdate: true });
  const backup = createTestBackupRecorder();
  const originalDuplicate = await fs.readFile(path.join(fixture.vaultPath, 'perfume.md'), 'utf8');
  const before = await readTopicRepairPlan(fixture);
  const duplicate = before.plan.operations.find(operation => operation.kind === 'duplicate_file_qa');

  await assert.rejects(
    applyTopicRepair({
      ...fixture,
      expectedInputSha256: before.plan.inputSha256,
      approvedOperationIds: [duplicate.id],
      confirmServiceStopped: true,
      createBackup: backup.createBackup,
    }),
    /forced title update failure/,
  );

  assert.equal(
    await fs.readFile(path.join(fixture.vaultPath, 'perfume.md'), 'utf8'),
    originalDuplicate,
  );
  const db = new Database(fixture.dbPath, { readonly: true });
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='schema_version'").get().count,
    0,
  );
  assert.equal(
    db.prepare("SELECT note_title AS title FROM note_chunks WHERE chunk_id='qa-b222'").get().title,
    'Cached Title',
  );
  db.close();
});

test('apply CLI parser requires explicit flags and supports repeated operation approvals', () => {
  assert.deepEqual(parseApplyArguments([
    '--apply',
    '--confirm-service-stopped',
    '--input-sha256', 'a'.repeat(64),
    '--approve-operation', 'duplicate-file-qa:qa-a111',
    '--approve-operation', 'manual:two',
    '--db', './test.db',
    '--vault', './vault',
    '--backup-dir', './backups',
    '--json',
  ]), {
    apply: true,
    confirmServiceStopped: true,
    inputSha256: 'a'.repeat(64),
    approvedOperationIds: ['duplicate-file-qa:qa-a111', 'manual:two'],
    dbPath: path.resolve('./test.db'),
    vaultPath: path.resolve('./vault'),
    backupDir: path.resolve('./backups'),
    json: true,
    help: false,
  });
  assert.throws(() => parseApplyArguments(['--approve-operation']), /작업 ID/);
  assert.throws(() => parseApplyArguments(['--unknown']), /알 수 없는 인자/);
});
