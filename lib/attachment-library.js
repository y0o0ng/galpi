'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { ATTACHMENT_ID_PATTERN } = require('./attachment-lifecycle');
const { noteContentSha256 } = require('./note-index-state');
const { commitFileDatabaseMutation } = require('./topic-mutation');

const LIBRARY_DIR = '_attachments';
const MAX_PREVIEW_CHARS = 1600;
const SUPPORTED_KINDS = new Set(['pdf', 'text', 'markdown', 'image']);

class AttachmentLibraryError extends Error {
  constructor(message, { code = 'ATTACHMENT_LIBRARY_FAILED', status = 400 } = {}) {
    super(message);
    this.name = 'AttachmentLibraryError';
    this.code = code;
    this.status = status;
  }
}

function libraryError(message, code, status = 400) {
  return new AttachmentLibraryError(message, { code, status });
}

function isInsideDirectory(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function sha256File(filepath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filepath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

function yamlString(value) {
  return JSON.stringify(String(value || '').normalize('NFC'))
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
}

function titleFromFilename(filename) {
  const basename = path.basename(String(filename || '').normalize('NFC'), path.extname(String(filename || '')))
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return basename || '저장한 첨부파일';
}

function kstParts(nowValue) {
  const date = new Date(nowValue);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).map(item => [item.type, item.value]));
  return {
    year: parts.year,
    month: parts.month,
    created: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`,
  };
}

function compactPreview(chunks) {
  const text = (Array.isArray(chunks) ? chunks : [])
    .slice(0, 4)
    .map(chunk => String(chunk?.content || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
  return text.slice(0, MAX_PREVIEW_CHARS).trim();
}

function escapeMarkdownText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function humanBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes}바이트`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * 이미지는 파싱 산출물이 없어서 분량·구간·미리보기를 만들 수 없다. 원본 임베드와
 * 파일 정보만 결정론적으로 적고, 캡션은 Codex 마커 안을 비워 남긴다.
 */
function buildImageLibraryNote({
  attachmentId,
  title,
  filename,
  mimeType,
  storedName,
  sha256,
  sizeBytes,
  created,
}) {
  const safeTitle = escapeMarkdownText(title);
  const safeFilename = escapeMarkdownText(filename.replace(/\r?\n/g, ' '));
  return `---
id: attachment-${attachmentId.slice(4)}
title: ${yamlString(title)}
aliases: [${yamlString(filename)}]
created: ${created}
updated: ${created}
note_type: attachment
archived: false
codex_status: processed
ai_readable: true
attachment_id: ${attachmentId}
attachment_state: library
document_format: image
mime_type: ${yamlString(mimeType)}
source_filename: ${yamlString(filename)}
stored_filename: ${yamlString(storedName)}
content_sha256: ${sha256}
parse_status: not_applicable
page_count: null
line_count: null
char_count: null
---

# ${safeTitle}

## 원본 이미지

![[${storedName}]]

## 요약

<!-- CODEX-SUMMARY-START -->
사용자가 서재에 저장한 이미지다. 파일 이름은 ${safeFilename}이고 크기는 ${humanBytes(sizeBytes)}다.
<!-- CODEX-SUMMARY-END -->

## 파일 정보

- 원본 이름: ${safeFilename}
- 형식: 이미지 (${escapeMarkdownText(mimeType)})
- 크기: ${humanBytes(sizeBytes)}
- 파싱 상태: 해당 없음
- 검색 상태: 노트 제목과 파일 이름으로만 검색됨
`;
}

function buildAttachmentLibraryNote({
  attachmentId,
  title,
  filename,
  kind,
  mimeType,
  storedName,
  sha256,
  document,
  chunks,
  created,
}) {
  const headings = [...new Set((Array.isArray(chunks) ? chunks : [])
    .map(chunk => String(chunk?.heading || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean))].slice(0, 8);
  const preview = compactPreview(chunks);
  const extent = document.pageCount
    ? `${document.pageCount}페이지`
    : document.lineCount
      ? `${document.lineCount}줄`
      : `${document.charCount || 0}자`;
  const headingText = headings.length > 0
    ? ` 주요 구간: ${headings.map(escapeMarkdownText).join(', ')}.`
    : '';
  const safeTitle = escapeMarkdownText(title);
  const safeFilename = escapeMarkdownText(filename.replace(/\r?\n/g, ' '));
  const safePreview = preview
    ? preview.split('\n\n').map(part => `> ${escapeMarkdownText(part)}`).join('\n>\n')
    : '미리보기를 만들 수 없는 문서다.';

  return `---
id: attachment-${attachmentId.slice(4)}
title: ${yamlString(title)}
aliases: [${yamlString(filename)}]
created: ${created}
updated: ${created}
note_type: attachment
archived: false
codex_status: processed
ai_readable: true
attachment_id: ${attachmentId}
attachment_state: library
document_format: ${kind}
mime_type: ${yamlString(mimeType)}
source_filename: ${yamlString(filename)}
stored_filename: ${yamlString(storedName)}
content_sha256: ${sha256}
parse_status: ${document.parseStatus}
parser_version: ${yamlString(document.parserVersion)}
page_count: ${document.pageCount || 'null'}
line_count: ${document.lineCount || 'null'}
char_count: ${document.charCount || 'null'}
---

# ${safeTitle}

## 원본

![[${storedName}]]

## 요약

<!-- CODEX-SUMMARY-START -->
사용자가 서재에 저장한 ${kind.toUpperCase()} 문서로, 분량은 ${extent}다.${headingText}
<!-- CODEX-SUMMARY-END -->

## 파일 정보

- 원본 이름: ${safeFilename}
- 형식: ${kind.toUpperCase()}
- 분량: ${extent}
- 파싱 상태: 완료
- 검색 상태: 사용 가능

## 문서 미리보기

${safePreview}
`;
}

function createAttachmentLibraryService(db, {
  enabled = false,
  tmpDir,
  vaultPath,
  now = Date.now,
  onNoteCreated = null,
} = {}) {
  if (!db?.prepare || typeof db.transaction !== 'function') {
    throw new TypeError('SQLite DB 연결이 필요합니다.');
  }
  if (!tmpDir || !vaultPath) throw new TypeError('첨부 temporary 경로와 Vault 경로가 필요합니다.');
  if (onNoteCreated !== null && typeof onNoteCreated !== 'function') {
    throw new TypeError('노트 생성 callback이 올바르지 않습니다.');
  }

  const resolvedTmpDir = path.resolve(tmpDir);
  const resolvedVaultPath = path.resolve(vaultPath);
  const running = new Map();
  const getAttachment = db.prepare(`
    SELECT a.id, a.session_id AS sessionId, a.scope, a.attached_at AS attachedAt,
           a.lifecycle_status AS lifecycleStatus, a.original_name AS filename, a.kind,
           b.id AS blobId, b.stored_name AS storedName, b.stored_path AS storedPath,
           b.mime_type AS mimeType, b.size_bytes AS sizeBytes, b.sha256,
           b.storage_scope AS blobScope, b.status AS blobStatus,
           li.note_filename AS noteFilename, n.title AS noteTitle
    FROM attachments a
    JOIN attachment_blobs b ON b.id = a.blob_id
    LEFT JOIN attachment_library_items li ON li.attachment_id = a.id
    LEFT JOIN notes n ON n.filename = li.note_filename
    WHERE a.id = ?
    LIMIT 1
  `);
  const getDocument = db.prepare(`
    SELECT content_sha256 AS contentSha256, parser_version AS parserVersion,
           parse_status AS parseStatus, page_count AS pageCount,
           line_count AS lineCount, char_count AS charCount, chunk_count AS chunkCount
    FROM attachment_documents
    WHERE attachment_id = ?
    LIMIT 1
  `);
  const listChunks = db.prepare(`
    SELECT heading, content
    FROM attachment_chunks
    WHERE attachment_id = ?
    ORDER BY chunk_index ASC
    LIMIT 4
  `);
  const findLibraryBlob = db.prepare(`
    SELECT id, stored_name AS storedName, stored_path AS storedPath,
           size_bytes AS sizeBytes, sha256
    FROM attachment_blobs
    WHERE sha256 = ? AND mime_type = ?
      AND storage_scope = 'library' AND status = 'ready'
    ORDER BY id ASC
    LIMIT 1
  `);
  const insertLibraryBlob = db.prepare(`
    INSERT INTO attachment_blobs (
      sha256, stored_name, stored_path, mime_type, size_bytes,
      storage_scope, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'library', 'ready', ?, ?)
  `);
  const insertNote = db.prepare(`
    INSERT INTO notes (
      filename, title, note_type, archived, codex_status,
      source_session, content_sha256, index_status, ai_readable
    ) VALUES (?, ?, 'attachment', 0, 'processed', ?, ?, 'pending', 1)
  `);
  const updateAttachment = db.prepare(`
    UPDATE attachments
    SET blob_id = ?, scope = 'library', lifecycle_status = 'library',
        promoted_at = ?, expired_at = NULL, deleted_at = NULL, updated_at = ?
    WHERE id = ? AND blob_id = ? AND session_id = ?
      AND scope = 'temporary' AND lifecycle_status = 'attached_temporary'
  `);
  const insertLibraryItem = db.prepare(`
    INSERT INTO attachment_library_items (attachment_id, note_filename, created_at)
    VALUES (?, ?, ?)
  `);
  const countBlobReferences = db.prepare(`
    SELECT COUNT(*) AS count
    FROM attachments
    WHERE blob_id = ? AND lifecycle_status NOT IN ('failed', 'deleted')
  `);
  const markBlobDeleted = db.prepare(`
    UPDATE attachment_blobs
    SET status = 'deleted', updated_at = ?
    WHERE id = ? AND storage_scope = 'temporary' AND status = 'ready'
  `);

  async function verifyFile(row, root) {
    if (!isInsideDirectory(root, row.storedPath)) {
      throw libraryError('첨부 저장 경로를 검증하지 못했습니다.', 'ATTACHMENT_STORAGE_INVALID', 409);
    }
    let stat;
    try {
      stat = await fsp.stat(row.storedPath);
    } catch {
      throw libraryError('첨부 원본을 찾을 수 없습니다.', 'ATTACHMENT_STORAGE_MISSING', 409);
    }
    if (!stat.isFile() || stat.size !== row.sizeBytes || await sha256File(row.storedPath) !== row.sha256) {
      throw libraryError('첨부 원본이 저장 기록과 다릅니다.', 'ATTACHMENT_STORAGE_INVALID', 409);
    }
  }

  async function expectedExistingContent(filepath, nextContent) {
    try {
      const existing = await fsp.readFile(filepath);
      if (!existing.equals(Buffer.isBuffer(nextContent) ? nextContent : Buffer.from(nextContent))) {
        throw libraryError('서재 저장 경로에 다른 파일이 이미 있습니다.', 'ATTACHMENT_LIBRARY_COLLISION', 409);
      }
      return existing;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function promoteOne({ attachmentId, sessionId }) {
    if (!enabled) throw libraryError('첨부 서재 저장 기능이 비활성화되어 있습니다.', 'ATTACHMENT_DISABLED', 503);
    if (!ATTACHMENT_ID_PATTERN.test(String(attachmentId || ''))) {
      throw libraryError('첨부파일 ID가 올바르지 않습니다.', 'ATTACHMENT_ID_INVALID');
    }
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId || normalizedSessionId.length > 120) {
      throw libraryError('대화 ID가 올바르지 않습니다.', 'ATTACHMENT_SESSION_INVALID');
    }

    const row = getAttachment.get(attachmentId);
    if (!row) throw libraryError('첨부파일을 찾을 수 없습니다.', 'ATTACHMENT_NOT_FOUND', 404);
    if (row.sessionId !== normalizedSessionId) {
      throw libraryError('다른 대화의 첨부파일은 저장할 수 없습니다.', 'ATTACHMENT_SESSION_MISMATCH', 409);
    }
    if (row.scope === 'library' && row.lifecycleStatus === 'library' && row.noteFilename) {
      return {
        attachmentId: row.id,
        status: 'library',
        duplicate: true,
        noteFilename: row.noteFilename,
        title: row.noteTitle,
      };
    }
    if (row.scope !== 'temporary' || row.lifecycleStatus !== 'attached_temporary') {
      throw libraryError('현재 대화에 연결된 임시 첨부만 저장할 수 있습니다.', 'ATTACHMENT_NOT_AVAILABLE', 409);
    }
    if (!SUPPORTED_KINDS.has(row.kind)) {
      throw libraryError('서재에 저장할 수 없는 첨부 형식입니다.', 'ATTACHMENT_TYPE_UNSUPPORTED', 415);
    }
    if (row.blobScope !== 'temporary' || row.blobStatus !== 'ready') {
      throw libraryError('첨부 원본을 사용할 수 없습니다.', 'ATTACHMENT_BLOB_NOT_READY', 409);
    }
    // 이미지는 파싱 산출물이 없으므로 문서 준비 조건을 적용하지 않는다.
    const isImage = row.kind === 'image';
    const document = isImage ? null : getDocument.get(row.id);
    if (!isImage && (!document || document.parseStatus !== 'ready' || document.contentSha256 !== row.sha256)) {
      throw libraryError('파싱이 완료된 문서만 서재에 저장할 수 있습니다.', 'ATTACHMENT_DOCUMENT_NOT_READY', 409);
    }
    await verifyFile(row, resolvedTmpDir);

    const chunks = isImage ? [] : listChunks.all(row.id);
    const timestamp = Math.floor(now() / 1000);
    const sourceTimestamp = Number.isInteger(row.attachedAt) ? row.attachedAt : timestamp;
    const parts = kstParts(sourceTimestamp * 1000);
    const title = titleFromFilename(row.filename);
    const noteFilename = `attachment-${row.id.slice(4)}.md`;
    const notePath = path.join(resolvedVaultPath, noteFilename);
    let libraryBlob = findLibraryBlob.get(row.sha256, row.mimeType);
    if (libraryBlob) await verifyFile(libraryBlob, path.join(resolvedVaultPath, LIBRARY_DIR));

    const storedName = libraryBlob?.storedName
      || `attlib_${row.sha256.slice(0, 24)}${path.extname(row.storedName).toLowerCase()}`;
    const libraryRelativePath = libraryBlob
      ? path.relative(resolvedVaultPath, libraryBlob.storedPath).split(path.sep).join('/')
      : `${LIBRARY_DIR}/${parts.year}/${parts.month}/${storedName}`;
    const libraryPath = libraryBlob?.storedPath || path.join(resolvedVaultPath, ...libraryRelativePath.split('/'));
    const noteContent = isImage
      ? buildImageLibraryNote({
        attachmentId: row.id,
        title,
        filename: row.filename,
        mimeType: row.mimeType,
        storedName,
        sha256: row.sha256,
        sizeBytes: row.sizeBytes,
        created: parts.created,
      })
      : buildAttachmentLibraryNote({
        attachmentId: row.id,
        title,
        filename: row.filename,
        kind: row.kind,
        mimeType: row.mimeType,
        storedName,
        sha256: row.sha256,
        document,
        chunks,
        created: parts.created,
      });
    const contentSha256 = noteContentSha256({
      filename: noteFilename,
      title,
      noteType: 'attachment',
      raw: noteContent,
    });
    const sourceBytes = libraryBlob ? null : await fsp.readFile(row.storedPath);
    const changes = [];
    if (!libraryBlob) {
      changes.push({
        filepath: libraryPath,
        expectedContent: await expectedExistingContent(libraryPath, sourceBytes),
        nextContent: sourceBytes,
        mode: 0o600,
      });
    }
    changes.push({
      filepath: notePath,
      expectedContent: await expectedExistingContent(notePath, noteContent),
      nextContent: noteContent,
      mode: 0o600,
    });

    let oldBlobDeleted = false;
    await commitFileDatabaseMutation({
      db,
      changes,
      async verifyFiles() {
        if (!libraryBlob) {
          await verifyFile({
            storedPath: libraryPath,
            sizeBytes: row.sizeBytes,
            sha256: row.sha256,
          }, path.join(resolvedVaultPath, LIBRARY_DIR));
        }
        const writtenNote = await fsp.readFile(notePath, 'utf8');
        if (writtenNote !== noteContent) {
          throw libraryError('Attachment 노트 검증에 실패했습니다.', 'ATTACHMENT_NOTE_INVALID', 500);
        }
      },
      applyDatabase() {
        const libraryBlobId = libraryBlob?.id || Number(insertLibraryBlob.run(
          row.sha256,
          storedName,
          libraryPath,
          row.mimeType,
          row.sizeBytes,
          timestamp,
          timestamp,
        ).lastInsertRowid);
        if (insertNote.run(noteFilename, title, normalizedSessionId, contentSha256).changes !== 1) {
          throw new Error('Attachment 노트를 등록하지 못했습니다.');
        }
        if (updateAttachment.run(
          libraryBlobId,
          timestamp,
          timestamp,
          row.id,
          row.blobId,
          normalizedSessionId,
        ).changes !== 1) {
          throw libraryError('첨부파일 상태가 변경되었습니다.', 'ATTACHMENT_STATE_CONFLICT', 409);
        }
        insertLibraryItem.run(row.id, noteFilename, timestamp);
        if (countBlobReferences.get(row.blobId).count === 0) {
          oldBlobDeleted = markBlobDeleted.run(timestamp, row.blobId).changes === 1;
        }
      },
    });

    let temporaryCleanupPending = false;
    if (oldBlobDeleted) {
      try {
        await fsp.unlink(row.storedPath);
      } catch (error) {
        if (error?.code !== 'ENOENT') temporaryCleanupPending = true;
      }
    }
    const result = {
      attachmentId: row.id,
      status: 'library',
      duplicate: false,
      noteFilename,
      title,
      libraryPath: libraryRelativePath,
      temporaryCleanupPending,
      noteContent,
      contentSha256,
    };
    if (onNoteCreated) {
      try { onNoteCreated(result); } catch { /* 승격 정본은 이미 확정됐다. */ }
    }
    return result;
  }

  function promote(input) {
    const key = `${String(input?.attachmentId || '')}\u0000${String(input?.sessionId || '')}`;
    const existing = running.get(key);
    if (existing) return existing;
    const operation = promoteOne(input).finally(() => running.delete(key));
    running.set(key, operation);
    return operation;
  }

  return { promote };
}

module.exports = {
  AttachmentLibraryError,
  LIBRARY_DIR,
  MAX_PREVIEW_CHARS,
  buildAttachmentLibraryNote,
  buildImageLibraryNote,
  createAttachmentLibraryService,
  titleFromFilename,
};
