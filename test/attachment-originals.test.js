'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const {
  contentDisposition,
  createAttachmentOriginalService,
} = require('../lib/attachment-originals');
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
      role TEXT NOT NULL, content TEXT NOT NULL, model TEXT,
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

async function seed(db, {
  id,
  bytes,
  filename,
  mimeType,
  storedPath,
  kind = 'markdown',
  scope = 'temporary',
  lifecycleStatus = 'attached_temporary',
  sessionId = 'shared-main',
  blobStatus = 'ready',
}) {
  await fsp.mkdir(path.dirname(storedPath), { recursive: true });
  await fsp.writeFile(storedPath, bytes, { mode: 0o600 });
  const blobId = Number(db.prepare(`
    INSERT INTO attachment_blobs (
      sha256, stored_name, stored_path, mime_type, size_bytes, storage_scope, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.createHash('sha256').update(bytes).digest('hex'),
    path.basename(storedPath),
    storedPath,
    mimeType,
    bytes.length,
    scope === 'library' ? 'library' : 'temporary',
    blobStatus,
  ).lastInsertRowid);
  db.prepare(`
    INSERT INTO attachments (
      id, blob_id, original_name, kind, session_id, scope, lifecycle_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, blobId, filename, kind, sessionId, scope, lifecycleStatus);
}

async function withFixture(t, prefix) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  const tmpDir = path.join(root, 'attachments', 'tmp');
  const vaultPath = path.join(root, 'vault');
  await fsp.mkdir(tmpDir, { recursive: true });
  await fsp.mkdir(path.join(vaultPath, '_attachments', '2026', '08'), { recursive: true });
  const db = createDatabase();
  t.after(async () => {
    db.close();
    await fsp.rm(root, { recursive: true, force: true });
  });
  return { root, tmpDir, vaultPath, db };
}

test('임시 첨부는 같은 대화에서만, 서재 첨부는 대화와 무관하게 열린다', async t => {
  const { tmpDir, vaultPath, db } = await withFixture(t, 'attachment-originals-');
  const temporaryId = 'att_11111111111111111111111111111111';
  const libraryId = 'att_22222222222222222222222222222222';
  await seed(db, {
    id: temporaryId,
    bytes: Buffer.from('# 임시 문서'),
    filename: '임시 자료.md',
    mimeType: 'text/markdown',
    storedPath: path.join(tmpDir, `${temporaryId}.md`),
  });
  await seed(db, {
    id: libraryId,
    bytes: Buffer.from('PNG인 척'),
    filename: '사진.png',
    mimeType: 'image/png',
    kind: 'image',
    scope: 'library',
    lifecycleStatus: 'library',
    storedPath: path.join(vaultPath, '_attachments', '2026', '08', 'attlib_x.png'),
  });
  const service = createAttachmentOriginalService(db, { enabled: true, tmpDir, vaultPath });

  const temporary = await service.resolveOriginal({
    attachmentId: temporaryId,
    sessionId: 'shared-main',
  });
  assert.equal(temporary.mimeType, 'text/markdown');
  assert.equal(temporary.sizeBytes, Buffer.from('# 임시 문서').length);
  // 텍스트류는 브라우저가 렌더하지 않도록 내려받게 한다.
  assert.match(temporary.contentDisposition, /^attachment;/);

  await assert.rejects(
    service.resolveOriginal({ attachmentId: temporaryId, sessionId: 'other-session' }),
    error => error.code === 'ATTACHMENT_SESSION_MISMATCH',
  );

  const library = await service.resolveOriginal({
    attachmentId: libraryId,
    sessionId: 'other-session',
  });
  assert.equal(library.scope, 'library');
  // 이미지·PDF는 브라우저에 맡긴다.
  assert.match(library.contentDisposition, /^inline;/);
});

test('만료·경로 이탈·크기 불일치는 모두 닫힌다', async t => {
  const { root, tmpDir, vaultPath, db } = await withFixture(t, 'attachment-originals-guard-');
  const expiredId = 'att_33333333333333333333333333333333';
  const outsideId = 'att_44444444444444444444444444444444';
  const changedId = 'att_55555555555555555555555555555555';
  const libraryOutsideId = 'att_66666666666666666666666666666666';
  await seed(db, {
    id: expiredId,
    bytes: Buffer.from('만료'),
    filename: '만료.md',
    mimeType: 'text/markdown',
    lifecycleStatus: 'expired',
    storedPath: path.join(tmpDir, `${expiredId}.md`),
  });
  await seed(db, {
    id: outsideId,
    bytes: Buffer.from('바깥'),
    filename: '바깥.md',
    mimeType: 'text/markdown',
    storedPath: path.join(root, 'outside.md'),
  });
  const changedPath = path.join(tmpDir, `${changedId}.md`);
  await seed(db, {
    id: changedId,
    bytes: Buffer.from('원본'),
    filename: '변경.md',
    mimeType: 'text/markdown',
    storedPath: changedPath,
  });
  await fsp.writeFile(changedPath, Buffer.from('길이가 달라진 내용'));
  // 서재 첨부인데 Vault 밖을 가리키는 경우도 막는다.
  await seed(db, {
    id: libraryOutsideId,
    bytes: Buffer.from('서재 바깥'),
    filename: '바깥.png',
    mimeType: 'image/png',
    kind: 'image',
    scope: 'library',
    lifecycleStatus: 'library',
    storedPath: path.join(root, 'library-outside.png'),
  });

  const service = createAttachmentOriginalService(db, { enabled: true, tmpDir, vaultPath });
  for (const [id, code] of [
    [expiredId, 'ATTACHMENT_NOT_AVAILABLE'],
    [outsideId, 'ATTACHMENT_STORAGE_INVALID'],
    [changedId, 'ATTACHMENT_STORAGE_INVALID'],
    [libraryOutsideId, 'ATTACHMENT_STORAGE_INVALID'],
  ]) {
    await assert.rejects(
      service.resolveOriginal({ attachmentId: id, sessionId: 'shared-main' }),
      error => error.code === code,
      `${id} → ${code}`,
    );
  }

  await assert.rejects(
    service.resolveOriginal({ attachmentId: 'not-an-id', sessionId: 'shared-main' }),
    error => error.code === 'ATTACHMENT_IDS_INVALID',
  );
  await assert.rejects(
    service.resolveOriginal({
      attachmentId: 'att_99999999999999999999999999999999',
      sessionId: 'shared-main',
    }),
    error => error.code === 'ATTACHMENT_NOT_FOUND',
  );

  const disabled = createAttachmentOriginalService(db, { enabled: false, tmpDir, vaultPath });
  await assert.rejects(
    disabled.resolveOriginal({ attachmentId: expiredId, sessionId: 'shared-main' }),
    error => error.code === 'ATTACHMENT_DISABLED',
  );
});

test('Vault 경로를 모르면 서재 원본을 열지 않는다', async t => {
  const { tmpDir, vaultPath, db } = await withFixture(t, 'attachment-originals-novault-');
  const id = 'att_77777777777777777777777777777777';
  await seed(db, {
    id,
    bytes: Buffer.from('서재'),
    filename: '서재.png',
    mimeType: 'image/png',
    kind: 'image',
    scope: 'library',
    lifecycleStatus: 'library',
    storedPath: path.join(vaultPath, '_attachments', '2026', '08', 'attlib_y.png'),
  });
  const service = createAttachmentOriginalService(db, { enabled: true, tmpDir });
  await assert.rejects(
    service.resolveOriginal({ attachmentId: id, sessionId: 'shared-main' }),
    error => error.code === 'ATTACHMENT_STORAGE_INVALID',
  );
});

test('한글 파일명은 ASCII 대체본과 RFC 5987을 함께 보낸다', () => {
  const header = contentDisposition('inline', '사분면 이미지.png');
  assert.match(header, /^inline; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
  assert.match(header, /filename\*=UTF-8''%EC%82%AC%EB%B6%84%EB%A9%B4/);
  // 개행이나 따옴표로 헤더를 깨뜨릴 수 없다.
  const nasty = contentDisposition('attachment', 'a"b\\c\r\nX: y.md');
  assert.equal(/[\r\n]/.test(nasty), false, '헤더에 개행이 남으면 안 된다');
  const quoted = nasty.match(/^attachment; filename="([^"]*)"; filename\*=/);
  assert.ok(quoted, `quoted 형식이 아니다: ${nasty}`);
  assert.equal(/["\\]/.test(quoted[1]), false, '따옴표 안에 따옴표나 역슬래시가 남으면 안 된다');
  assert.equal(quoted[1], 'a_b_c  X: y.md');
});
