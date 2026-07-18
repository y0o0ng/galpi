'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { auditTopicStore, buildTopicRepairPlan, sha256 } = require('../lib/topic-store');

const WORKER = path.join(__dirname, 'fixtures', 'topic-mutation-crash-worker');

function qaEntry(qaId, question, answer) {
  return `### 2026-07-18 10:00 · Claude
<!-- qa_id: ${qaId} -->
**Q:** ${question}

**A:** ${answer}`;
}

function topicNote(title, entries) {
  return `---
title: "${title}"
note_type: topic
archived: false
---

# ${title}

<!-- QA-LOG-START -->

${entries.join('\n\n')}

<!-- QA-LOG-END -->`;
}

function chunkContent(question, answer) {
  return `Q: ${question}\nA: ${answer}`;
}

async function createFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'topic-crash-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const vaultPath = path.join(root, 'vault');
  const dbPath = path.join(root, 'galpi.db');
  await fs.mkdir(vaultPath);
  const sourceRaw = topicNote('Source', [qaEntry('qa-a111', 'source 질문', 'source 답변')]);
  const targetRaw = topicNote('Target', [qaEntry('qa-b222', 'target 질문', 'target 답변')]);
  await Promise.all([
    fs.writeFile(path.join(vaultPath, 'source.md'), sourceRaw),
    fs.writeFile(path.join(vaultPath, 'target.md'), targetRaw),
  ]);
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY, filename TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
      note_type TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE note_chunks (
      id INTEGER PRIMARY KEY, chunk_id TEXT UNIQUE NOT NULL, note_filename TEXT NOT NULL,
      note_title TEXT NOT NULL, chunk_type TEXT NOT NULL, content TEXT NOT NULL,
      source_session TEXT, source_user_message INTEGER, source_assistant_message INTEGER,
      embedding TEXT, content_sha256 TEXT, index_status TEXT NOT NULL DEFAULT 'ready'
    );
    CREATE TABLE mutation_markers (value TEXT NOT NULL);
    INSERT INTO notes VALUES (1, 'source.md', 'Source', 'topic', 0);
    INSERT INTO notes VALUES (2, 'target.md', 'Target', 'topic', 0);
  `);
  const insert = db.prepare(`
    INSERT INTO note_chunks (
      id, chunk_id, note_filename, note_title, chunk_type, content,
      embedding, content_sha256, index_status
    ) VALUES (?, ?, ?, ?, 'topic_qa', ?, '[]', ?, 'ready')
  `);
  const sourceChunk = chunkContent('source 질문', 'source 답변');
  const targetChunk = chunkContent('target 질문', 'target 답변');
  insert.run(1, 'qa-a111', 'source.md', 'Source', sourceChunk, sha256(sourceChunk));
  insert.run(2, 'qa-b222', 'target.md', 'Target', targetChunk, sha256(targetChunk));
  db.close();
  return { root, vaultPath, dbPath, sourceRaw, targetRaw };
}

async function crashAfterRename(fixture, changes) {
  const planPath = path.join(fixture.root, 'plan.json');
  await fs.writeFile(planPath, JSON.stringify({ changes }));
  const child = spawn(process.execPath, [WORKER, fixture.dbPath, planPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const [code, signal] = await once(child, 'exit');
  assert.equal(code, null);
  assert.equal(signal, 'SIGKILL');
}

async function readAudit(fixture) {
  const db = new Database(fixture.dbPath, { readonly: true });
  try {
    return await auditTopicStore({ db, vaultPath: fixture.vaultPath });
  } finally {
    db.close();
  }
}

test('hard process interruption after append rename is detected as a non-destructive reindex plan', async t => {
  const fixture = await createFixture(t);
  const appended = topicNote('Source', [
    qaEntry('qa-a111', 'source 질문', 'source 답변'),
    qaEntry('qa-c333', '추가 질문', '추가 답변'),
  ]);
  await crashAfterRename(fixture, [{
    filepath: path.join(fixture.vaultPath, 'source.md'),
    expectedContent: fixture.sourceRaw,
    nextContent: appended,
  }]);

  const audit = await readAudit(fixture);
  assert.deepEqual(audit.findings.fileOnlyQa, [{ qaId: 'qa-c333', filename: 'source.md' }]);
  const plan = buildTopicRepairPlan(audit);
  assert.ok(plan.operations.some(operation => operation.recommendation?.action === 'reindex_file_qa'));
  const db = new Database(fixture.dbPath, { readonly: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM mutation_markers').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM note_chunks').get().count, 2);
  db.close();
});

test('hard process interruption after split or merge shaped multi-file rename is detected without deleting DB evidence', async t => {
  const fixture = await createFixture(t);
  const nextSource = topicNote('Source', []);
  const nextTarget = topicNote('Target', [
    qaEntry('qa-b222', 'target 질문', 'target 답변'),
    qaEntry('qa-a111', 'source 질문', 'source 답변'),
  ]);
  await crashAfterRename(fixture, [
    {
      filepath: path.join(fixture.vaultPath, 'source.md'),
      expectedContent: fixture.sourceRaw,
      nextContent: nextSource,
    },
    {
      filepath: path.join(fixture.vaultPath, 'target.md'),
      expectedContent: fixture.targetRaw,
      nextContent: nextTarget,
    },
  ]);

  const audit = await readAudit(fixture);
  assert.deepEqual(audit.findings.assignmentDrift, [{
    qaId: 'qa-a111', fileFilename: 'target.md', dbFilename: 'source.md',
  }]);
  const plan = buildTopicRepairPlan(audit);
  assert.equal(plan.status, 'manual_review');
  const db = new Database(fixture.dbPath, { readonly: true });
  assert.deepEqual(db.prepare(`
    SELECT chunk_id AS chunkId, note_filename AS noteFilename
    FROM note_chunks ORDER BY chunk_id
  `).all(), [
    { chunkId: 'qa-a111', noteFilename: 'source.md' },
    { chunkId: 'qa-b222', noteFilename: 'target.md' },
  ]);
  db.close();
});
