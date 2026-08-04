'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { once } = require('node:events');
const Database = require('better-sqlite3');
const express = require('express');

const {
  AttachmentUploadError,
  createAttachmentUploadService,
  readSingleAttachmentUpload,
} = require('../lib/attachment-upload');
const { runDatabaseMigrations } = require('../lib/database-migrations');

function createDatabase() {
  const db = new Database(':memory:');
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
  return db;
}

async function startUploadServer(service) {
  const app = express();
  app.post('/api/attachments', async (req, res) => {
    try {
      res.status(201).json(await service.upload(req));
    } catch (error) {
      res.status(error instanceof AttachmentUploadError ? error.status : 500).json({
        code: error.code || 'ATTACHMENT_UPLOAD_FAILED',
      });
    }
  });
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
  };
}

async function upload(url, bytes, { filename, type }) {
  const form = new FormData();
  form.set('file', new Blob([bytes], { type }), filename);
  const response = await fetch(`${url}/api/attachments`, { method: 'POST', body: form });
  return { response, body: await response.json() };
}

test('temporary attachment upload validates content, deduplicates blobs, and deletes expired orphans', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'attachment-upload-'));
  const tmpDir = path.join(root, 'attachments', 'tmp');
  const db = createDatabase();
  let currentMs = Date.parse('2026-08-04T00:00:00Z');
  const activeAttachmentIds = new Set();
  const service = createAttachmentUploadService(db, {
    enabled: true,
    tmpDir,
    limits: { image: 12 },
    now: () => currentMs,
    isAttachmentActive: id => activeAttachmentIds.has(id),
  });
  const { server, url } = await startUploadServer(service);
  t.after(async () => {
    service.stop();
    await new Promise(resolve => server.close(resolve));
    db.close();
    await fsp.rm(root, { recursive: true, force: true });
  });

  const first = await upload(url, Buffer.from('안전한 UTF-8 메모'), {
    filename: '메모.txt',
    type: 'text/plain',
  });
  assert.equal(first.response.status, 201, JSON.stringify(first.body));
  assert.match(first.body.attachmentId, /^att_[a-f0-9]{32}$/);
  assert.equal(first.body.filename, '메모.txt');
  assert.equal(first.body.status, 'uploaded_unattached');
  assert.equal(first.body.orphanExpiresAt, '2026-08-04T01:00:00.000Z');

  let rows = db.prepare(`
    SELECT a.id, a.original_name AS originalName, a.lifecycle_status AS lifecycleStatus,
           b.stored_path AS storedPath, b.sha256, b.status
    FROM attachments a JOIN attachment_blobs b ON b.id = a.blob_id
  `).all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].originalName, '메모.txt');
  assert.equal(rows[0].lifecycleStatus, 'uploaded_unattached');
  assert.equal(rows[0].status, 'ready');
  assert.equal(path.dirname(rows[0].storedPath), tmpDir);
  assert.equal(fs.statSync(rows[0].storedPath).mode & 0o777, 0o600);

  const duplicate = await upload(url, Buffer.from('안전한 UTF-8 메모'), {
    filename: '복사본.txt',
    type: 'text/plain',
  });
  assert.equal(duplicate.response.status, 201, JSON.stringify(duplicate.body));
  assert.notEqual(duplicate.body.attachmentId, first.body.attachmentId);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM attachments').get().count, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM attachment_blobs').get().count, 1);
  assert.equal((await fsp.readdir(tmpDir)).filter(name => !name.endsWith('.partial')).length, 1);

  const markdown = await upload(url, Buffer.from('안전한 UTF-8 메모'), {
    filename: '같은내용.md',
    type: 'text/markdown',
  });
  assert.equal(markdown.response.status, 201, JSON.stringify(markdown.body));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM attachments').get().count, 3);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM attachment_blobs').get().count, 2);
  assert.equal((await fsp.readdir(tmpDir)).filter(name => !name.endsWith('.partial')).length, 2);

  const disguised = await upload(url, Buffer.from('not a png'), {
    filename: '위장.png',
    type: 'image/png',
  });
  assert.equal(disguised.response.status, 415);
  assert.equal(disguised.body.code, 'ATTACHMENT_SIGNATURE_INVALID');

  const tooLarge = await upload(url, Buffer.from([
    0xff, 0xd8, 0xff, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  ]), {
    filename: '큰사진.jpg',
    type: 'image/jpeg',
  });
  assert.equal(tooLarge.response.status, 413);
  assert.equal(tooLarge.body.code, 'ATTACHMENT_TOO_LARGE');

  const invalidText = await upload(url, Buffer.from([0xff, 0xfe]), {
    filename: '잘못된.txt',
    type: 'text/plain',
  });
  assert.equal(invalidText.response.status, 415);
  assert.equal(invalidText.body.code, 'ATTACHMENT_TEXT_INVALID');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM attachments').get().count, 3);
  assert.equal((await fsp.readdir(tmpDir)).some(name => name.endsWith('.partial')), false);

  const firstSha256 = db.prepare(`
    SELECT b.sha256
    FROM attachments a JOIN attachment_blobs b ON b.id = a.blob_id
    WHERE a.id = ?
  `).get(first.body.attachmentId).sha256;
  db.prepare(`
    INSERT INTO attachment_documents (
      attachment_id, content_sha256, parser_version, parse_status,
      line_count, char_count, chunk_count, parsed_at
    ) VALUES (?, ?, 'test-parser', 'ready', 1, 10, 1, 1)
  `).run(first.body.attachmentId, firstSha256);
  db.prepare(`
    INSERT INTO attachment_chunks (
      chunk_id, attachment_id, chunk_index, line_start, line_end,
      content, content_sha256
    ) VALUES ('atch_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ?, 0, 1, 1, '임시 청크', ?)
  `).run(
    first.body.attachmentId,
    crypto.createHash('sha256').update('임시 청크').digest('hex'),
  );

  const stalePartial = path.join(tmpDir, 'stale.partial');
  await fsp.writeFile(stalePartial, 'partial');
  const old = new Date(currentMs - (61 * 60 * 1000));
  await fsp.utimes(stalePartial, old, old);
  currentMs += 61 * 60 * 1000;
  activeAttachmentIds.add(first.body.attachmentId);
  assert.deepEqual(service.cleanupOrphans(), { attachments: 2, blobs: 1, partials: 1 });
  activeAttachmentIds.clear();
  assert.deepEqual(service.cleanupOrphans(), { attachments: 1, blobs: 1, partials: 0 });
  rows = db.prepare(`
    SELECT lifecycle_status AS lifecycleStatus FROM attachments ORDER BY id
  `).all();
  assert.deepEqual(rows, [
    { lifecycleStatus: 'deleted' },
    { lifecycleStatus: 'deleted' },
    { lifecycleStatus: 'deleted' },
  ]);
  assert.deepEqual(
    db.prepare('SELECT status FROM attachment_blobs ORDER BY id').all(),
    [{ status: 'deleted' }, { status: 'deleted' }],
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM attachment_documents').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM attachment_chunks').get().count, 0);
  assert.deepEqual(await fsp.readdir(tmpDir), []);
});

test('disabled and interrupted uploads create no DB rows or partial files', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'attachment-upload-disabled-'));
  const tmpDir = path.join(root, 'tmp');
  const db = createDatabase();
  const service = createAttachmentUploadService(db, { enabled: false, tmpDir });
  const { server, url } = await startUploadServer(service);
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
    await fsp.rm(root, { recursive: true, force: true });
  });

  const disabled = await upload(url, Buffer.from('hello'), {
    filename: 'note.txt',
    type: 'text/plain',
  });
  assert.equal(disabled.response.status, 503);
  assert.equal(disabled.body.code, 'ATTACHMENT_DISABLED');
  assert.equal(fs.existsSync(tmpDir), false);

  await fsp.mkdir(tmpDir, { recursive: true });
  const boundary = 'galpi-aborted-boundary';
  const req = new PassThrough();
  req.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };
  const pending = readSingleAttachmentUpload(req, { tmpDir });
  req.write(
    `--${boundary}\r\n` +
    'Content-Disposition: form-data; name="file"; filename="note.txt"\r\n' +
    'Content-Type: text/plain\r\n\r\n' +
    '업로드 도중',
  );
  req.emit('aborted');
  req.end();
  await assert.rejects(pending, error => error.code === 'ATTACHMENT_UPLOAD_ABORTED');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(await fsp.readdir(tmpDir), []);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM attachments').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM attachment_blobs').get().count, 0);
});
