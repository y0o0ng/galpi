'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const { createAttachmentLifecycleService } = require('../lib/attachment-lifecycle');
const { runDatabaseMigrations } = require('../lib/database-migrations');

function createDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      last_active INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY, filename TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
      note_type TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
      codex_status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE auto_save_decisions (
      id INTEGER PRIMARY KEY, decision TEXT NOT NULL, action TEXT
    );
    CREATE TABLE note_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, chunk_id TEXT UNIQUE NOT NULL,
      note_filename TEXT NOT NULL, note_title TEXT NOT NULL,
      chunk_type TEXT NOT NULL, content TEXT NOT NULL, source_session TEXT,
      source_user_message INTEGER, source_assistant_message INTEGER,
      embedding TEXT, created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
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
  db.prepare("INSERT INTO sessions (id) VALUES ('shared-main'), ('other-session')").run();
  return db;
}

async function seedAttachment(db, tmpDir, { id, content, filename = '자료.txt' }) {
  const bytes = Buffer.from(content);
  const storedName = `${id}.txt`;
  const storedPath = path.join(tmpDir, storedName);
  await fsp.writeFile(storedPath, bytes, { mode: 0o600 });
  const blobId = Number(db.prepare(`
    INSERT INTO attachment_blobs (
      sha256, stored_name, stored_path, mime_type, size_bytes
    ) VALUES (?, ?, ?, 'text/plain', ?)
  `).run(
    crypto.createHash('sha256').update(bytes).digest('hex'),
    storedName,
    storedPath,
    bytes.length,
  ).lastInsertRowid);
  db.prepare(`
    INSERT INTO attachments (id, blob_id, original_name, kind)
    VALUES (?, ?, ?, 'text')
  `).run(id, blobId, filename);
  return { blobId, storedPath };
}

function insertTurn(db, lifecycle, { sessionId = 'shared-main', attachmentIds = [], text }) {
  return db.transaction(() => {
    const userMessageId = Number(db.prepare(`
      INSERT INTO messages (session_id, role, content)
      VALUES (?, 'user', ?)
    `).run(sessionId, text).lastInsertRowid);
    db.prepare(`
      INSERT INTO messages (session_id, role, content, model)
      VALUES (?, 'assistant', '답변', 'test')
    `).run(sessionId);
    const attachments = lifecycle.attachToUserMessage({
      sessionId,
      userMessageId,
      attachmentIds,
    });
    return { userMessageId, attachments };
  })();
}

test('temporary attachment links atomically, snapshots replay turns, and expires before the boundary call', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'attachment-lifecycle-'));
  const tmpDir = path.join(root, 'attachments', 'tmp');
  await fsp.mkdir(tmpDir, { recursive: true });
  const db = createDatabase();
  const attachmentId = 'att_11111111111111111111111111111111';
  const { blobId, storedPath } = await seedAttachment(db, tmpDir, {
    id: attachmentId,
    content: 'replay 자료',
  });
  const sharedId = 'att_22222222222222222222222222222222';
  db.prepare(`
    INSERT INTO attachments (id, blob_id, original_name, kind)
    VALUES (?, ?, '같은 원본.txt', 'text')
  `).run(sharedId, blobId);
  const lifecycle = createAttachmentLifecycleService(db, {
    enabled: true,
    tmpDir,
    replayWindowTurns: 2,
    now: () => Date.parse('2026-08-04T00:00:00Z'),
  });
  t.after(async () => {
    db.close();
    await fsp.rm(root, { recursive: true, force: true });
  });

  const firstLease = await lifecycle.beginChatRequest({
    sessionId: 'shared-main',
    attachmentIds: [attachmentId],
  });
  assert.equal(lifecycle.expireBeforeUpcomingTurn('shared-main').upcomingUserTurnIndex, 1);
  const first = insertTurn(db, lifecycle, {
    attachmentIds: firstLease.attachmentIds,
    text: '첫 턴',
  });
  firstLease.release();
  assert.equal(first.attachments[0].attachmentId, attachmentId);
  assert.deepEqual(db.prepare(`
    SELECT origin_user_turn_index AS originTurn, replay_window_turns AS replayTurns
    FROM message_attachments WHERE message_id = ?
  `).get(first.userMessageId), { originTurn: 1, replayTurns: 2 });
  const sourceSha256 = db.prepare(`
    SELECT sha256 FROM attachment_blobs WHERE id = ?
  `).get(blobId).sha256;
  db.prepare(`
    INSERT INTO attachment_documents (
      attachment_id, content_sha256, parser_version, parse_status,
      line_count, char_count, chunk_count, parsed_at
    ) VALUES (?, ?, 'test-parser', 'ready', 1, 8, 1, 1)
  `).run(attachmentId, sourceSha256);
  db.prepare(`
    INSERT INTO attachment_chunks (
      chunk_id, attachment_id, chunk_index, line_start, line_end,
      content, content_sha256
    ) VALUES ('atch_11111111111111111111111111111111', ?, 0, 1, 1, 'replay 자료', ?)
  `).run(attachmentId, crypto.createHash('sha256').update('replay 자료').digest('hex'));

  assert.equal(lifecycle.expireBeforeUpcomingTurn('shared-main').expired, 0);
  insertTurn(db, lifecycle, { text: '둘째 턴' });

  const reattachLease = await lifecycle.beginChatRequest({
    sessionId: 'shared-main',
    attachmentIds: [attachmentId],
  });
  assert.equal(lifecycle.expireBeforeUpcomingTurn('shared-main').expired, 0);
  const third = insertTurn(db, lifecycle, {
    attachmentIds: reattachLease.attachmentIds,
    text: '셋째 턴에 다시 첨부',
  });
  reattachLease.release();
  assert.deepEqual(db.prepare(`
    SELECT origin_user_turn_index AS originTurn, replay_window_turns AS replayTurns
    FROM message_attachments WHERE message_id = ?
  `).get(third.userMessageId), { originTurn: 3, replayTurns: 2 });

  assert.equal(lifecycle.expireBeforeUpcomingTurn('shared-main').expired, 0);
  insertTurn(db, lifecycle, { text: '넷째 턴' });
  const expiration = lifecycle.expireBeforeUpcomingTurn('shared-main');
  assert.deepEqual(expiration, {
    upcomingUserTurnIndex: 5,
    expired: 1,
    attachments: 1,
    blobs: 0,
    errors: 0,
  });
  assert.equal(db.prepare('SELECT lifecycle_status AS status FROM attachments WHERE id = ?').get(attachmentId).status, 'deleted');
  assert.equal(db.prepare('SELECT status FROM attachment_blobs WHERE id = ?').get(blobId).status, 'ready');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM attachment_documents').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM attachment_chunks').get().count, 0);
  assert.equal((await fsp.stat(storedPath)).isFile(), true);
  assert.equal(lifecycle.listForSession('shared-main').get(first.userMessageId)[0].expired, true);
});

test('attachment lease rejects cross-session reuse and changed source bytes', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'attachment-lifecycle-guard-'));
  const tmpDir = path.join(root, 'tmp');
  await fsp.mkdir(tmpDir, { recursive: true });
  const db = createDatabase();
  const attachmentId = 'att_33333333333333333333333333333333';
  const { storedPath } = await seedAttachment(db, tmpDir, {
    id: attachmentId,
    content: '원본',
  });
  const lifecycle = createAttachmentLifecycleService(db, {
    enabled: true,
    tmpDir,
    replayWindowTurns: 10,
  });
  t.after(async () => {
    db.close();
    await fsp.rm(root, { recursive: true, force: true });
  });

  const lease = await lifecycle.beginChatRequest({
    sessionId: 'shared-main',
    attachmentIds: [attachmentId],
  });
  insertTurn(db, lifecycle, { attachmentIds: lease.attachmentIds, text: '연결' });
  lease.release();
  await assert.rejects(
    lifecycle.beginChatRequest({ sessionId: 'other-session', attachmentIds: [attachmentId] }),
    error => error.code === 'ATTACHMENT_SESSION_MISMATCH' && error.status === 409,
  );

  await fsp.writeFile(storedPath, '변조');
  await assert.rejects(
    lifecycle.beginChatRequest({ sessionId: 'shared-main', attachmentIds: [attachmentId] }),
    error => error.code === 'ATTACHMENT_STORAGE_INVALID' && error.status === 409,
  );
});

test('library promotion lease blocks replay expiry and accepts an idempotent library retry', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'attachment-library-lease-'));
  const tmpDir = path.join(root, 'tmp');
  await fsp.mkdir(tmpDir, { recursive: true });
  const db = createDatabase();
  const attachmentId = 'att_66666666666666666666666666666666';
  await seedAttachment(db, tmpDir, { id: attachmentId, content: '승격할 문서' });
  const lifecycle = createAttachmentLifecycleService(db, {
    enabled: true,
    tmpDir,
    replayWindowTurns: 1,
  });
  t.after(async () => {
    db.close();
    await fsp.rm(root, { recursive: true, force: true });
  });

  const chatLease = await lifecycle.beginChatRequest({
    sessionId: 'shared-main',
    attachmentIds: [attachmentId],
  });
  insertTurn(db, lifecycle, { attachmentIds: chatLease.attachmentIds, text: '첫 턴' });
  chatLease.release();
  insertTurn(db, lifecycle, { text: '둘째 턴' });

  const promotionLease = await lifecycle.beginLibraryPromotion({
    sessionId: 'shared-main',
    attachmentId,
  });
  assert.equal(promotionLease.alreadyLibrary, false);
  assert.equal(lifecycle.isAttachmentActive(attachmentId), true);
  assert.equal(lifecycle.expireBeforeUpcomingTurn('shared-main').expired, 0);
  db.prepare(`
    UPDATE attachments SET scope = 'library', lifecycle_status = 'library'
    WHERE id = ?
  `).run(attachmentId);
  promotionLease.release();

  const retry = await lifecycle.beginLibraryPromotion({ sessionId: 'shared-main', attachmentId });
  assert.equal(retry.alreadyLibrary, true);
  assert.equal(lifecycle.isAttachmentActive(attachmentId), false);
  await assert.rejects(
    lifecycle.beginLibraryPromotion({ sessionId: 'other-session', attachmentId }),
    error => error.code === 'ATTACHMENT_SESSION_MISMATCH',
  );
});

test('missing attachment lease rolls back both messages and linkage', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'attachment-lifecycle-rollback-'));
  const tmpDir = path.join(root, 'tmp');
  await fsp.mkdir(tmpDir, { recursive: true });
  const db = createDatabase();
  const attachmentId = 'att_44444444444444444444444444444444';
  await seedAttachment(db, tmpDir, { id: attachmentId, content: 'transaction' });
  const lifecycle = createAttachmentLifecycleService(db, {
    enabled: true,
    tmpDir,
    replayWindowTurns: 10,
  });
  t.after(async () => {
    db.close();
    await fsp.rm(root, { recursive: true, force: true });
  });

  assert.throws(
    () => insertTurn(db, lifecycle, { attachmentIds: [attachmentId], text: 'rollback' }),
    error => error.code === 'ATTACHMENT_LEASE_MISSING',
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM message_attachments').get().count, 0);
  assert.equal(db.prepare('SELECT lifecycle_status AS status FROM attachments').get().status, 'uploaded_unattached');
});

test('document preparation runs inside the lease and a failure releases it for retry', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'attachment-lifecycle-prepare-'));
  const tmpDir = path.join(root, 'tmp');
  await fsp.mkdir(tmpDir, { recursive: true });
  const db = createDatabase();
  const attachmentId = 'att_55555555555555555555555555555555';
  await seedAttachment(db, tmpDir, { id: attachmentId, content: '준비할 문서' });
  let calls = 0;
  const lifecycle = createAttachmentLifecycleService(db, {
    enabled: true,
    tmpDir,
    replayWindowTurns: 10,
    async prepareAttachment(id) {
      calls += 1;
      assert.equal(id, attachmentId);
      if (calls === 1) throw new Error('parse failed');
    },
  });
  t.after(async () => {
    db.close();
    await fsp.rm(root, { recursive: true, force: true });
  });

  await assert.rejects(
    lifecycle.beginChatRequest({ sessionId: 'shared-main', attachmentIds: [attachmentId] }),
    /parse failed/,
  );
  assert.equal(lifecycle.isAttachmentActive(attachmentId), false);
  const lease = await lifecycle.beginChatRequest({
    sessionId: 'shared-main',
    attachmentIds: [attachmentId],
  });
  assert.equal(calls, 2);
  assert.equal(lifecycle.isAttachmentActive(attachmentId), true);
  lease.release();
  assert.equal(lifecycle.isAttachmentActive(attachmentId), false);
});
