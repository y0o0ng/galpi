'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

const LIBRARY_DIR = '_attachments';
const ATTACHMENT_ID_PATTERN = /^att_[a-f0-9]{32}$/;
// 업로드가 받아주는 형식만 되돌려준다. 브라우저가 원본을 실행 가능한 문서로
// 해석할 여지를 남기지 않는다.
const SERVABLE_MIME_TYPES = new Set([
  'application/pdf',
  'text/markdown',
  'text/x-markdown',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
// PDF·이미지만 브라우저에 맡기고 텍스트류는 내려받게 한다.
const INLINE_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

class AttachmentOriginalError extends Error {
  constructor(message, { code = 'ATTACHMENT_ORIGINAL_FAILED', status = 400 } = {}) {
    super(message);
    this.name = 'AttachmentOriginalError';
    this.code = code;
    this.status = status;
  }
}

function originalError(message, code, status = 400) {
  return new AttachmentOriginalError(message, { code, status });
}

function isInsideDirectory(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * 한글 파일명이 그대로 헤더에 들어가면 깨지므로 ASCII 대체본과 RFC 5987 형식을
 * 함께 준다.
 */
function contentDisposition(disposition, filename) {
  const safe = String(filename || 'attachment').replace(/[\r\n]/g, ' ');
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'attachment';
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

function createAttachmentOriginalService(db, {
  enabled = false,
  tmpDir,
  vaultPath = null,
} = {}) {
  if (!db?.prepare || typeof db.transaction !== 'function') {
    throw new TypeError('SQLite DB 연결이 필요합니다.');
  }
  if (!tmpDir) throw new TypeError('첨부 temporary 경로가 필요합니다.');

  const resolvedTmpDir = path.resolve(tmpDir);
  const resolvedLibraryDir = vaultPath ? path.resolve(vaultPath, LIBRARY_DIR) : null;

  const getAttachment = db.prepare(`
    SELECT a.id, a.session_id AS sessionId, a.scope,
           a.lifecycle_status AS lifecycleStatus,
           a.original_name AS filename, a.kind,
           b.mime_type AS mimeType, b.size_bytes AS sizeBytes,
           b.stored_path AS storedPath, b.status AS blobStatus
    FROM attachments a
    JOIN attachment_blobs b ON b.id = a.blob_id
    WHERE a.id = ?
    LIMIT 1
  `);

  async function resolveOriginal({ attachmentId, sessionId } = {}) {
    if (!enabled) {
      throw originalError('첨부파일 기능이 비활성화되어 있습니다.', 'ATTACHMENT_DISABLED', 503);
    }
    const normalizedId = String(attachmentId || '').trim();
    if (!ATTACHMENT_ID_PATTERN.test(normalizedId)) {
      throw originalError('첨부파일 ID가 올바르지 않습니다.', 'ATTACHMENT_IDS_INVALID');
    }
    const row = getAttachment.get(normalizedId);
    if (!row) throw originalError('첨부파일을 찾을 수 없습니다.', 'ATTACHMENT_NOT_FOUND', 404);
    if (row.blobStatus !== 'ready') {
      throw originalError('첨부 원본을 사용할 수 없습니다.', 'ATTACHMENT_BLOB_NOT_READY', 409);
    }
    if (!SERVABLE_MIME_TYPES.has(String(row.mimeType || ''))) {
      throw originalError('되돌려줄 수 없는 첨부 형식입니다.', 'ATTACHMENT_TYPE_UNSUPPORTED', 415);
    }

    // 임시 첨부는 그 대화 안에서만, 서재 첨부는 영구 자료라 대화와 무관하게 연다.
    if (row.scope === 'temporary') {
      if (!['uploaded_unattached', 'attached_temporary'].includes(row.lifecycleStatus)) {
        throw originalError('이 첨부파일은 더 이상 열 수 없습니다.', 'ATTACHMENT_NOT_AVAILABLE', 409);
      }
      const normalizedSessionId = String(sessionId || '').trim();
      if (row.sessionId && row.sessionId !== normalizedSessionId) {
        throw originalError('다른 대화의 첨부파일입니다.', 'ATTACHMENT_SESSION_MISMATCH', 409);
      }
      if (!isInsideDirectory(resolvedTmpDir, row.storedPath)) {
        throw originalError('첨부 저장 경로를 검증하지 못했습니다.', 'ATTACHMENT_STORAGE_INVALID', 409);
      }
    } else if (row.scope === 'library') {
      if (row.lifecycleStatus !== 'library') {
        throw originalError('이 첨부파일은 더 이상 열 수 없습니다.', 'ATTACHMENT_NOT_AVAILABLE', 409);
      }
      if (!resolvedLibraryDir || !isInsideDirectory(resolvedLibraryDir, row.storedPath)) {
        throw originalError('첨부 저장 경로를 검증하지 못했습니다.', 'ATTACHMENT_STORAGE_INVALID', 409);
      }
    } else {
      throw originalError('이 첨부파일은 더 이상 열 수 없습니다.', 'ATTACHMENT_NOT_AVAILABLE', 409);
    }

    let stat;
    try {
      stat = await fsp.stat(row.storedPath);
    } catch {
      throw originalError('첨부 원본을 찾을 수 없습니다.', 'ATTACHMENT_STORAGE_MISSING', 409);
    }
    // 전체 해시는 다시 계산하지 않는다. 승격과 모델 입력 경로가 이미 확인하며,
    // 열 때마다 20MiB PDF를 통째로 읽는 비용이 크다.
    if (!stat.isFile() || stat.size !== row.sizeBytes) {
      throw originalError('첨부 원본이 저장 기록과 다릅니다.', 'ATTACHMENT_STORAGE_INVALID', 409);
    }

    const inline = INLINE_MIME_TYPES.has(row.mimeType);
    return {
      attachmentId: row.id,
      filename: row.filename,
      kind: row.kind,
      scope: row.scope,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      storedPath: row.storedPath,
      contentDisposition: contentDisposition(inline ? 'inline' : 'attachment', row.filename),
    };
  }

  return { resolveOriginal };
}

module.exports = {
  AttachmentOriginalError,
  INLINE_MIME_TYPES,
  SERVABLE_MIME_TYPES,
  contentDisposition,
  createAttachmentOriginalService,
};
