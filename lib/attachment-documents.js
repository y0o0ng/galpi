'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { TextDecoder } = require('node:util');

const {
  DEFAULT_CHUNK_MAX_CHARS,
  DEFAULT_CHUNK_TARGET_CHARS,
  DEFAULT_MAX_PDF_BYTES,
  DEFAULT_MAX_PDF_PAGES,
  PAPER_PARSER_VERSION,
  PaperFullTextError,
  buildPaperChunks,
  extractPdfPages,
} = require('./paper-fulltext');

const ATTACHMENT_DOCUMENT_PARSER_VERSION = `attachment-document-v1:${PAPER_PARSER_VERSION}`;
const DEFAULT_MAX_TEXT_BYTES = 2 * 1024 * 1024;
const DEFAULT_PARSE_TIMEOUT_MS = 30_000;
const ATTACHMENT_ID_PATTERN = /^att_[a-f0-9]{32}$/;

class AttachmentDocumentError extends Error {
  constructor(message, { code = 'ATTACHMENT_PARSE_FAILED', status = 422, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AttachmentDocumentError';
    this.code = code;
    this.status = status;
  }
}

function documentError(message, code, status = 422, cause = null) {
  return new AttachmentDocumentError(message, { code, status, cause });
}

function isInsideDirectory(root, target) {
  const relative = path.relative(root, path.resolve(target));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function decodeTextDocument(input, maxBytes = DEFAULT_MAX_TEXT_BYTES) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (buffer.length === 0) {
    throw documentError('텍스트 첨부가 비어 있습니다.', 'ATTACHMENT_TEXT_EMPTY');
  }
  if (buffer.length > maxBytes) {
    throw documentError('텍스트 첨부가 2MB 제한을 초과했습니다.', 'ATTACHMENT_TEXT_TOO_LARGE', 413);
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (error) {
    throw documentError(
      '텍스트 첨부는 UTF-8 형식이어야 합니다.',
      'ATTACHMENT_TEXT_INVALID',
      415,
      error,
    );
  }
  if (text.includes('\0')) {
    throw documentError('텍스트 첨부에 허용되지 않는 바이트가 있습니다.', 'ATTACHMENT_TEXT_INVALID', 415);
  }
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    throw documentError('텍스트 첨부에서 읽을 내용을 찾지 못했습니다.', 'ATTACHMENT_TEXT_EMPTY');
  }
  return normalized;
}

function markdownHeading(line) {
  const match = String(line || '').match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
  if (!match) return null;
  return match[1].replace(/\s+/g, ' ').trim().slice(0, 240) || null;
}

function splitBoundedLine(value, maxChars) {
  const text = String(value || '').trim();
  if (text.length <= maxChars) return text ? [text] : [];
  const parts = [];
  let remaining = text;
  while (remaining.length > maxChars) {
    let end = remaining.lastIndexOf(' ', maxChars);
    if (end < Math.floor(maxChars * 0.6)) end = maxChars;
    parts.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function buildTextChunks(text, {
  markdown = false,
  targetChars = DEFAULT_CHUNK_TARGET_CHARS,
  maxChars = DEFAULT_CHUNK_MAX_CHARS,
} = {}) {
  const resolvedTarget = Math.max(200, Math.trunc(Number(targetChars) || DEFAULT_CHUNK_TARGET_CHARS));
  const resolvedMax = Math.max(resolvedTarget, Math.trunc(Number(maxChars) || DEFAULT_CHUNK_MAX_CHARS));
  const lines = String(text || '').split('\n');
  const chunks = [];
  let heading = null;
  let units = [];
  let unitChars = 0;

  function flush() {
    if (units.length === 0) return;
    const content = units.map(unit => unit.text).join('\n').trim();
    if (content) {
      chunks.push({
        ordinal: chunks.length,
        heading,
        pageStart: null,
        pageEnd: null,
        lineStart: units[0].line,
        lineEnd: units.at(-1).line,
        content,
      });
    }
    units = [];
    unitChars = 0;
  }

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const nextHeading = markdown ? markdownHeading(rawLine) : null;
    if (nextHeading) {
      flush();
      heading = nextHeading;
      return;
    }
    const line = rawLine.replace(/[\t ]+/g, ' ').trim();
    if (!line) {
      if (unitChars >= resolvedTarget) flush();
      return;
    }
    for (const part of splitBoundedLine(line, resolvedMax)) {
      const nextChars = unitChars + part.length + (units.length > 0 ? 1 : 0);
      if (units.length > 0 && nextChars > resolvedMax) flush();
      units.push({ line: lineNumber, text: part });
      unitChars += part.length + (units.length > 1 ? 1 : 0);
      if (unitChars >= resolvedMax) flush();
    }
  });
  flush();
  return { chunks, lineCount: lines.length, charCount: String(text || '').length };
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(documentError(
      '첨부 문서 파싱 시간이 초과됐습니다.',
      'ATTACHMENT_PARSE_TIMEOUT',
      504,
    )), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function createAttachmentDocumentService(db, {
  enabled = false,
  tmpDir,
  extractPages = extractPdfPages,
  parserVersion = ATTACHMENT_DOCUMENT_PARSER_VERSION,
  parseTimeoutMs = DEFAULT_PARSE_TIMEOUT_MS,
  maxTextBytes = DEFAULT_MAX_TEXT_BYTES,
  maxPdfBytes = DEFAULT_MAX_PDF_BYTES,
  maxPdfPages = DEFAULT_MAX_PDF_PAGES,
} = {}) {
  if (!db?.prepare || typeof db.transaction !== 'function') {
    throw new TypeError('SQLite DB 연결이 필요합니다.');
  }
  if (!tmpDir) throw new TypeError('첨부 temporary 경로가 필요합니다.');
  if (!Number.isInteger(parseTimeoutMs) || parseTimeoutMs < 1) {
    throw new TypeError('첨부 파싱 timeout이 올바르지 않습니다.');
  }

  const resolvedTmpDir = path.resolve(tmpDir);
  const parsing = new Map();
  const recovered = db.prepare(`
    UPDATE attachment_documents
    SET parse_status = 'failed', page_count = NULL, line_count = NULL,
        char_count = NULL, chunk_count = 0,
        error_code = 'parse_interrupted',
        error_message = '서버 재시작으로 문서 파싱이 중단되었습니다.',
        parsed_at = NULL, updated_at = strftime('%s','now')
    WHERE parse_status = 'parsing'
  `).run().changes;
  const getAttachment = db.prepare(`
    SELECT a.id, a.original_name AS filename, a.kind, a.scope,
           a.lifecycle_status AS lifecycleStatus,
           b.sha256, b.stored_path AS storedPath,
           b.size_bytes AS sizeBytes, b.status AS blobStatus
    FROM attachments a
    JOIN attachment_blobs b ON b.id = a.blob_id
    WHERE a.id = ?
    LIMIT 1
  `);
  const getDocument = db.prepare(`
    SELECT attachment_id AS attachmentId, content_sha256 AS contentSha256,
           parser_version AS parserVersion, parse_status AS status,
           page_count AS pageCount, line_count AS lineCount,
           char_count AS charCount, chunk_count AS chunkCount,
           error_code AS errorCode, error_message AS errorMessage,
           parsed_at AS parsedAt
    FROM attachment_documents
    WHERE attachment_id = ?
  `);
  const markParsing = db.prepare(`
    INSERT INTO attachment_documents (
      attachment_id, content_sha256, parser_version, parse_status
    ) VALUES (?, ?, ?, 'parsing')
    ON CONFLICT(attachment_id) DO UPDATE SET
      content_sha256 = excluded.content_sha256,
      parser_version = excluded.parser_version,
      parse_status = 'parsing',
      page_count = NULL,
      line_count = NULL,
      char_count = NULL,
      chunk_count = 0,
      error_code = NULL,
      error_message = NULL,
      parsed_at = NULL,
      updated_at = strftime('%s','now')
  `);
  const markFailed = db.prepare(`
    UPDATE attachment_documents
    SET parse_status = @status,
        page_count = NULL,
        line_count = NULL,
        char_count = NULL,
        chunk_count = 0,
        error_code = @errorCode,
        error_message = @errorMessage,
        parsed_at = NULL,
        updated_at = strftime('%s','now')
    WHERE attachment_id = @attachmentId
  `);
  const deleteChunks = db.prepare('DELETE FROM attachment_chunks WHERE attachment_id = ?');
  const insertChunk = db.prepare(`
    INSERT INTO attachment_chunks (
      chunk_id, attachment_id, chunk_index, heading,
      page_start, page_end, line_start, line_end,
      content, content_sha256
    ) VALUES (
      @chunkId, @attachmentId, @chunkIndex, @heading,
      @pageStart, @pageEnd, @lineStart, @lineEnd,
      @content, @contentSha256
    )
  `);
  const markReady = db.prepare(`
    UPDATE attachment_documents
    SET parse_status = 'ready',
        page_count = @pageCount,
        line_count = @lineCount,
        char_count = @charCount,
        chunk_count = @chunkCount,
        error_code = NULL,
        error_message = NULL,
        parsed_at = strftime('%s','now'),
        updated_at = strftime('%s','now')
    WHERE attachment_id = @attachmentId
  `);
  const finishParsing = db.transaction(({ attachmentId, parsed }) => {
    deleteChunks.run(attachmentId);
    parsed.chunks.forEach((chunk, chunkIndex) => {
      const contentSha256 = sha256(chunk.content);
      insertChunk.run({
        chunkId: `atch_${sha256(`${attachmentId}\0${chunkIndex}\0${contentSha256}`).slice(0, 32)}`,
        attachmentId,
        chunkIndex,
        heading: chunk.heading || null,
        pageStart: chunk.pageStart || null,
        pageEnd: chunk.pageEnd || null,
        lineStart: chunk.lineStart || null,
        lineEnd: chunk.lineEnd || null,
        content: chunk.content,
        contentSha256,
      });
    });
    markReady.run({
      attachmentId,
      pageCount: parsed.pageCount || null,
      lineCount: parsed.lineCount || null,
      charCount: parsed.charCount,
      chunkCount: parsed.chunks.length,
    });
  });
  const listChunks = db.prepare(`
    SELECT c.chunk_id AS chunkId, c.chunk_index AS chunkIndex,
           c.heading, c.page_start AS pageStart, c.page_end AS pageEnd,
           c.line_start AS lineStart, c.line_end AS lineEnd, c.content
    FROM attachment_chunks c
    JOIN attachment_documents d ON d.attachment_id = c.attachment_id
    JOIN attachments a ON a.id = d.attachment_id
    WHERE c.attachment_id = ?
      AND d.parse_status = 'ready'
      AND a.scope = 'temporary'
      AND a.lifecycle_status IN ('uploaded_unattached', 'attached_temporary')
    ORDER BY c.chunk_index ASC
  `);

  async function verifyAttachment(row) {
    if (!row) throw documentError('첨부파일을 찾을 수 없습니다.', 'ATTACHMENT_NOT_FOUND', 404);
    if (row.kind === 'image') return false;
    if (!['pdf', 'text', 'markdown'].includes(row.kind)) {
      throw documentError('읽을 수 없는 첨부 형식입니다.', 'ATTACHMENT_TYPE_UNSUPPORTED', 415);
    }
    if (row.scope !== 'temporary'
      || !['uploaded_unattached', 'attached_temporary'].includes(row.lifecycleStatus)) {
      throw documentError('이 첨부파일은 더 이상 읽을 수 없습니다.', 'ATTACHMENT_NOT_AVAILABLE', 409);
    }
    if (row.blobStatus !== 'ready' || !isInsideDirectory(resolvedTmpDir, row.storedPath)) {
      throw documentError('첨부 원본을 사용할 수 없습니다.', 'ATTACHMENT_STORAGE_INVALID', 409);
    }
    let stat;
    try {
      stat = await fsp.stat(row.storedPath);
    } catch (error) {
      throw documentError('첨부 원본을 찾을 수 없습니다.', 'ATTACHMENT_STORAGE_MISSING', 409, error);
    }
    if (!stat.isFile() || stat.size !== row.sizeBytes || await sha256File(row.storedPath) !== row.sha256) {
      throw documentError('첨부 원본이 저장 기록과 다릅니다.', 'ATTACHMENT_STORAGE_INVALID', 409);
    }
    return true;
  }

  async function parseAttachment(row) {
    const bytes = await fsp.readFile(row.storedPath);
    if (row.kind === 'pdf') {
      const extracted = await extractPages(bytes, {
        maxBytes: maxPdfBytes,
        maxPages: maxPdfPages,
      });
      const chunks = buildPaperChunks(extracted.pages, { title: row.filename }).map(chunk => ({
        heading: chunk.section,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        lineStart: null,
        lineEnd: null,
        content: chunk.content,
      }));
      return {
        pageCount: extracted.pageCount,
        lineCount: null,
        charCount: extracted.charCount,
        chunks,
      };
    }
    const text = decodeTextDocument(bytes, maxTextBytes);
    const parsed = buildTextChunks(text, { markdown: row.kind === 'markdown' });
    return { pageCount: null, ...parsed };
  }

  async function runEnsureParsed(attachmentId) {
    if (!enabled) return null;
    const row = getAttachment.get(attachmentId);
    if (!await verifyAttachment(row)) return null;
    const existing = getDocument.get(attachmentId);
    if (
      existing?.status === 'ready'
      && existing.contentSha256 === row.sha256
      && existing.parserVersion === parserVersion
      && existing.chunkCount > 0
    ) {
      return { ...existing, parsedNow: false, reused: true };
    }

    markParsing.run(attachmentId, row.sha256, parserVersion);
    try {
      const parsed = await withTimeout(parseAttachment(row), parseTimeoutMs);
      if (!parsed.charCount || parsed.chunks.length === 0) {
        throw documentError(
          '첨부 문서에서 검색 가능한 텍스트를 찾지 못했습니다.',
          row.kind === 'pdf' ? 'ATTACHMENT_PDF_NEEDS_OCR' : 'ATTACHMENT_TEXT_EMPTY',
        );
      }
      finishParsing({ attachmentId, parsed });
      return { ...getDocument.get(attachmentId), parsedNow: true, reused: false };
    } catch (error) {
      const needsOcr = error instanceof PaperFullTextError && error.code === 'pdf_text_empty'
        || error?.code === 'ATTACHMENT_PDF_NEEDS_OCR';
      const normalized = error instanceof AttachmentDocumentError
        ? error
        : needsOcr
          ? documentError('PDF에 읽을 수 있는 텍스트가 없어 OCR이 필요합니다.', 'ATTACHMENT_PDF_NEEDS_OCR')
          : documentError('첨부 문서를 읽지 못했습니다.', 'ATTACHMENT_PARSE_FAILED', 422, error);
      deleteChunks.run(attachmentId);
      markFailed.run({
        attachmentId,
        status: needsOcr ? 'needs_ocr' : 'failed',
        errorCode: normalized.code,
        errorMessage: String(normalized.message).slice(0, 1000),
      });
      throw normalized;
    }
  }

  function ensureParsed(attachmentId) {
    const normalizedId = String(attachmentId || '').trim();
    if (!ATTACHMENT_ID_PATTERN.test(normalizedId)) {
      return Promise.reject(documentError('첨부파일 ID가 올바르지 않습니다.', 'ATTACHMENT_IDS_INVALID'));
    }
    if (parsing.has(normalizedId)) return parsing.get(normalizedId);
    const run = runEnsureParsed(normalizedId).finally(() => parsing.delete(normalizedId));
    parsing.set(normalizedId, run);
    return run;
  }

  return {
    ensureParsed,
    getDocument: attachmentId => getDocument.get(attachmentId) || null,
    listChunks: attachmentId => listChunks.all(attachmentId),
    recovered,
  };
}

module.exports = {
  ATTACHMENT_DOCUMENT_PARSER_VERSION,
  AttachmentDocumentError,
  DEFAULT_MAX_TEXT_BYTES,
  DEFAULT_PARSE_TIMEOUT_MS,
  buildTextChunks,
  createAttachmentDocumentService,
  decodeTextDocument,
};
