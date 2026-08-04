'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const {
  AttachmentDocumentError,
  buildTextChunks,
  createAttachmentDocumentService,
  decodeTextDocument,
} = require('../lib/attachment-documents');
const { runDatabaseMigrations } = require('../lib/database-migrations');
const { PaperFullTextError } = require('../lib/paper-fulltext');

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

async function seedAttachment(db, tmpDir, {
  id,
  kind,
  filename,
  mimeType,
  extension,
  bytes,
}) {
  const storedName = `${id}.${extension}`;
  const storedPath = path.join(tmpDir, storedName);
  await fsp.writeFile(storedPath, bytes, { mode: 0o600 });
  const blobId = db.prepare(`
    INSERT INTO attachment_blobs (
      sha256, stored_name, stored_path, mime_type, size_bytes
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    crypto.createHash('sha256').update(bytes).digest('hex'),
    storedName,
    storedPath,
    mimeType,
    bytes.length,
  ).lastInsertRowid;
  db.prepare(`
    INSERT INTO attachments (id, blob_id, original_name, kind)
    VALUES (?, ?, ?, ?)
  `).run(id, blobId, filename, kind);
  return { blobId, storedPath };
}

test('Markdown and TXT parsing preserve headings and bounded line ranges', () => {
  assert.equal(decodeTextDocument(Buffer.from('첫 줄\r\n둘째 줄')), '첫 줄\n둘째 줄');
  assert.throws(
    () => decodeTextDocument(Buffer.from([0xff, 0xfe])),
    error => error.code === 'ATTACHMENT_TEXT_INVALID',
  );

  const longBody = Array.from({ length: 30 }, (_, index) => `문장 ${index + 1} ${'내용 '.repeat(8)}`).join('\n');
  const parsed = buildTextChunks(`# 첫 장\n${longBody}\n\n## 둘째 장\n마지막 내용`, {
    markdown: true,
    targetChars: 220,
    maxChars: 300,
  });
  assert.ok(parsed.chunks.length > 2);
  assert.equal(parsed.chunks[0].heading, '첫 장');
  assert.equal(parsed.chunks.at(-1).heading, '둘째 장');
  assert.equal(parsed.chunks.at(-1).lineEnd, 34);
  assert.ok(parsed.chunks.every(chunk => chunk.content.length <= 300));
  assert.ok(parsed.chunks.every(chunk => chunk.lineStart <= chunk.lineEnd));
});

test('temporary Markdown parses once and reuses the exact source and parser version', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'attachment-documents-md-'));
  const tmpDir = path.join(root, 'tmp');
  await fsp.mkdir(tmpDir, { recursive: true });
  const db = createDatabase();
  const attachmentId = 'att_11111111111111111111111111111111';
  await seedAttachment(db, tmpDir, {
    id: attachmentId,
    kind: 'markdown',
    filename: '로드맵.md',
    mimeType: 'text/markdown',
    extension: 'md',
    bytes: Buffer.from('# 현재 단계\n\n첨부 U1 문서 읽기를 구현한다.\n\n## 제외\n\n이미지와 OCR은 아직 하지 않는다.'),
  });
  const service = createAttachmentDocumentService(db, { enabled: true, tmpDir });
  t.after(async () => {
    db.close();
    await fsp.rm(root, { recursive: true, force: true });
  });

  const first = await service.ensureParsed(attachmentId);
  assert.equal(first.status, 'ready');
  assert.equal(first.parsedNow, true);
  assert.equal(first.pageCount, null);
  assert.ok(first.lineCount > 0);
  assert.equal(first.chunkCount, 2);
  assert.deepEqual(service.listChunks(attachmentId).map(chunk => ({
    heading: chunk.heading,
    lineStart: chunk.lineStart,
    lineEnd: chunk.lineEnd,
  })), [
    { heading: '현재 단계', lineStart: 3, lineEnd: 3 },
    { heading: '제외', lineStart: 7, lineEnd: 7 },
  ]);

  const reused = await service.ensureParsed(attachmentId);
  assert.equal(reused.parsedNow, false);
  assert.equal(reused.reused, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM attachment_chunks').get().count, 2);

  assert.deepEqual(service.listCandidates({
    sessionId: 'shared-main',
    attachmentIds: [attachmentId],
  }).map(candidate => ({
    attachmentId: candidate.attachmentId,
    filename: candidate.filename,
    kind: candidate.kind,
    chunkCount: candidate.chunkCount,
  })), [{
    attachmentId,
    filename: '로드맵.md',
    kind: 'markdown',
    chunkCount: 2,
  }]);
  const focused = service.searchDocument({
    attachmentId,
    query: '지금 하지 않는 OCR 기능',
    mode: 'focused',
  });
  assert.equal(focused.length, 1);
  assert.equal(focused[0].heading, '제외');
  assert.equal(focused[0].lineStart, 7);
  assert.match(focused[0].text, /이미지와 OCR/);

  const overview = service.searchDocument({
    attachmentId,
    query: '전체 요약',
    mode: 'overview',
  });
  assert.deepEqual(overview.map(row => row.heading), ['현재 단계', '제외']);
  assert.deepEqual(service.readDocument({
    attachmentId,
    chunkId: focused[0].chunkId,
  }).map(row => row.heading), ['현재 단계']);

  const messageId = db.prepare(`
    INSERT INTO messages (session_id, role, content, created_at)
    VALUES ('shared-main', 'user', '첨부 연결', 1)
  `).run().lastInsertRowid;
  db.prepare(`
    UPDATE attachments
    SET session_id = 'shared-main', lifecycle_status = 'attached_temporary'
    WHERE id = ?
  `).run(attachmentId);
  db.prepare(`
    INSERT INTO message_attachments (
      message_id, attachment_id, origin_user_turn_index, replay_window_turns
    ) VALUES (?, ?, 1, 10)
  `).run(messageId, attachmentId);
  assert.deepEqual(service.listCandidates({
    sessionId: 'shared-main',
  }).map(candidate => candidate.attachmentId), [attachmentId]);
  assert.equal(service.hasTemporaryCandidates({ sessionId: 'shared-main' }), true);
  assert.deepEqual(service.listCandidates({
    sessionId: 'other-session',
    attachmentIds: [attachmentId],
  }), []);

  const libraryNoteFilename = `attachment-${attachmentId.slice(4)}.md`;
  db.prepare(`
    INSERT INTO notes (filename, title, note_type, codex_status)
    VALUES (?, '로드맵', 'attachment', 'processed')
  `).run(libraryNoteFilename);
  db.prepare(`
    UPDATE attachments
    SET scope = 'library', lifecycle_status = 'library'
    WHERE id = ?
  `).run(attachmentId);
  db.prepare(`
    INSERT INTO attachment_library_items (attachment_id, note_filename)
    VALUES (?, ?)
  `).run(attachmentId, libraryNoteFilename);
  assert.deepEqual(service.listCandidates({
    sessionId: 'shared-main',
    libraryNoteFilenames: [libraryNoteFilename],
  }).map(candidate => ({
    attachmentId: candidate.attachmentId,
    scope: candidate.scope,
  })), [{ attachmentId, scope: 'library' }]);
  assert.deepEqual(service.listCandidates({
    sessionId: 'shared-main',
    libraryNoteFilenames: ['not-resolved.md'],
  }), []);
  assert.equal(service.hasTemporaryCandidates({ sessionId: 'shared-main' }), false);
  assert.match(service.searchDocument({
    attachmentId,
    query: 'OCR',
    mode: 'focused',
  })[0].text, /이미지와 OCR/);
});

test('PDF parsing is single-flight and records page-scoped chunks', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'attachment-documents-pdf-'));
  const tmpDir = path.join(root, 'tmp');
  await fsp.mkdir(tmpDir, { recursive: true });
  const db = createDatabase();
  const attachmentId = 'att_22222222222222222222222222222222';
  await seedAttachment(db, tmpDir, {
    id: attachmentId,
    kind: 'pdf',
    filename: '보고서.pdf',
    mimeType: 'application/pdf',
    extension: 'pdf',
    bytes: Buffer.from('%PDF-1.7 test fixture'),
  });
  let calls = 0;
  const service = createAttachmentDocumentService(db, {
    enabled: true,
    tmpDir,
    async extractPages() {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      const pages = [
        { number: 1, text: `Introduction\n${'첫 페이지 근거 '.repeat(80)}` },
        { number: 2, text: `Conclusion\n${'둘째 페이지 결론 '.repeat(80)}` },
      ];
      return {
        pageCount: 2,
        pages,
        text: pages.map(page => page.text).join('\n\n'),
        charCount: pages.reduce((sum, page) => sum + page.text.length, 2),
      };
    },
  });
  t.after(async () => {
    db.close();
    await fsp.rm(root, { recursive: true, force: true });
  });

  const [first, second] = await Promise.all([
    service.ensureParsed(attachmentId),
    service.ensureParsed(attachmentId),
  ]);
  assert.equal(calls, 1);
  assert.equal(first.status, 'ready');
  assert.deepEqual(second, first);
  assert.equal(first.pageCount, 2);
  const chunks = service.listChunks(attachmentId);
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].heading, 'Introduction');
  assert.equal(chunks[0].pageStart, 1);
  assert.equal(chunks.at(-1).heading, 'Conclusion');
  assert.equal(chunks.at(-1).pageEnd, 2);
});

test('scanned PDF is marked needs_ocr without leaving stale chunks', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'attachment-documents-ocr-'));
  const tmpDir = path.join(root, 'tmp');
  await fsp.mkdir(tmpDir, { recursive: true });
  const db = createDatabase();
  const attachmentId = 'att_33333333333333333333333333333333';
  await seedAttachment(db, tmpDir, {
    id: attachmentId,
    kind: 'pdf',
    filename: '스캔.pdf',
    mimeType: 'application/pdf',
    extension: 'pdf',
    bytes: Buffer.from('%PDF-1.7 scanned fixture'),
  });
  const service = createAttachmentDocumentService(db, {
    enabled: true,
    tmpDir,
    async extractPages() {
      throw new PaperFullTextError('텍스트 없음', 'pdf_text_empty');
    },
  });
  t.after(async () => {
    db.close();
    await fsp.rm(root, { recursive: true, force: true });
  });

  await assert.rejects(
    service.ensureParsed(attachmentId),
    error => error instanceof AttachmentDocumentError
      && error.code === 'ATTACHMENT_PDF_NEEDS_OCR'
      && error.status === 422,
  );
  assert.deepEqual(service.getDocument(attachmentId), {
    attachmentId,
    contentSha256: crypto.createHash('sha256').update('%PDF-1.7 scanned fixture').digest('hex'),
    parserVersion: service.getDocument(attachmentId).parserVersion,
    status: 'needs_ocr',
    pageCount: null,
    lineCount: null,
    charCount: null,
    chunkCount: 0,
    errorCode: 'ATTACHMENT_PDF_NEEDS_OCR',
    errorMessage: 'PDF에 읽을 수 있는 텍스트가 없어 OCR이 필요합니다.',
    parsedAt: null,
  });
  assert.deepEqual(service.listChunks(attachmentId), []);
});

test('a parser that exceeds the hard timeout fails closed', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'attachment-documents-timeout-'));
  const tmpDir = path.join(root, 'tmp');
  await fsp.mkdir(tmpDir, { recursive: true });
  const db = createDatabase();
  const attachmentId = 'att_55555555555555555555555555555555';
  await seedAttachment(db, tmpDir, {
    id: attachmentId,
    kind: 'pdf',
    filename: '느린.pdf',
    mimeType: 'application/pdf',
    extension: 'pdf',
    bytes: Buffer.from('%PDF-1.7 slow fixture'),
  });
  const service = createAttachmentDocumentService(db, {
    enabled: true,
    tmpDir,
    parseTimeoutMs: 10,
    extractPages: () => new Promise(() => {}),
  });
  t.after(async () => {
    db.close();
    await fsp.rm(root, { recursive: true, force: true });
  });

  await assert.rejects(
    service.ensureParsed(attachmentId),
    error => error.code === 'ATTACHMENT_PARSE_TIMEOUT' && error.status === 504,
  );
  assert.equal(service.getDocument(attachmentId).status, 'failed');
  assert.equal(service.getDocument(attachmentId).errorCode, 'ATTACHMENT_PARSE_TIMEOUT');
  assert.deepEqual(service.listChunks(attachmentId), []);
});

test('service recovers an interrupted parse and stays inert while disabled', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'attachment-documents-recovery-'));
  const tmpDir = path.join(root, 'tmp');
  await fsp.mkdir(tmpDir, { recursive: true });
  const db = createDatabase();
  const attachmentId = 'att_44444444444444444444444444444444';
  await seedAttachment(db, tmpDir, {
    id: attachmentId,
    kind: 'text',
    filename: '중단.txt',
    mimeType: 'text/plain',
    extension: 'txt',
    bytes: Buffer.from('다시 읽을 수 있는 원문'),
  });
  db.prepare(`
    INSERT INTO attachment_documents (
      attachment_id, content_sha256, parser_version, parse_status
    ) VALUES (?, ?, 'old-parser', 'parsing')
  `).run(attachmentId, 'a'.repeat(64));
  const disabled = createAttachmentDocumentService(db, { enabled: false, tmpDir });
  t.after(async () => {
    db.close();
    await fsp.rm(root, { recursive: true, force: true });
  });

  assert.equal(disabled.recovered, 1);
  assert.equal(disabled.getDocument(attachmentId).status, 'failed');
  assert.equal(disabled.getDocument(attachmentId).errorCode, 'parse_interrupted');
  assert.equal(await disabled.ensureParsed(attachmentId), null);
  assert.equal(disabled.getDocument(attachmentId).status, 'failed');
});
