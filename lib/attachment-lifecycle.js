'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const MAX_ATTACHMENTS_PER_MESSAGE = 1;
const ATTACHMENT_ID_PATTERN = /^att_[a-f0-9]{32}$/;

class AttachmentLifecycleError extends Error {
  constructor(message, { code = 'ATTACHMENT_LIFECYCLE_FAILED', status = 400 } = {}) {
    super(message);
    this.name = 'AttachmentLifecycleError';
    this.code = code;
    this.status = status;
  }
}

function lifecycleError(message, code, status = 400) {
  return new AttachmentLifecycleError(message, { code, status });
}

function normalizeAttachmentIds(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw lifecycleError('attachmentIds는 배열이어야 합니다.', 'ATTACHMENT_IDS_INVALID');
  }
  if (value.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw lifecycleError('한 메시지에는 첨부파일 하나만 연결할 수 있습니다.', 'ATTACHMENT_LIMIT');
  }
  const ids = value.map(item => String(item || '').trim());
  if (ids.some(id => !ATTACHMENT_ID_PATTERN.test(id)) || new Set(ids).size !== ids.length) {
    throw lifecycleError('첨부파일 ID가 올바르지 않습니다.', 'ATTACHMENT_IDS_INVALID');
  }
  return ids;
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

function createAttachmentLifecycleService(db, {
  enabled = false,
  tmpDir,
  replayWindowTurns = 10,
  now = Date.now,
} = {}) {
  if (!db?.prepare || typeof db.transaction !== 'function') {
    throw new TypeError('SQLite DB 연결이 필요합니다.');
  }
  if (!tmpDir) throw new TypeError('첨부 temporary 경로가 필요합니다.');
  if (!Number.isInteger(replayWindowTurns) || replayWindowTurns < 1 || replayWindowTurns > 1000) {
    throw new TypeError('첨부 replay 사용자 턴 수가 올바르지 않습니다.');
  }

  const resolvedTmpDir = path.resolve(tmpDir);
  const activeAttachmentIds = new Set();
  const getAttachment = db.prepare(`
    SELECT a.id, a.session_id AS sessionId, a.lifecycle_status AS lifecycleStatus,
           a.original_name AS filename, a.kind,
           b.id AS blobId, b.stored_path AS storedPath, b.mime_type AS mimeType,
           b.size_bytes AS sizeBytes, b.sha256, b.status AS blobStatus
    FROM attachments a
    JOIN attachment_blobs b ON b.id = a.blob_id
    WHERE a.id = ?
    LIMIT 1
  `);
  const countUserTurns = db.prepare(`
    SELECT COUNT(*) AS count
    FROM messages
    WHERE session_id = ? AND role = 'user'
  `);
  const getMessage = db.prepare(`
    SELECT session_id AS sessionId, role
    FROM messages
    WHERE id = ?
    LIMIT 1
  `);
  const findExpiredCandidates = db.prepare(`
    SELECT a.id
    FROM attachments a
    JOIN message_attachments ma ON ma.attachment_id = a.id
    WHERE a.session_id = ?
      AND a.scope = 'temporary'
      AND a.lifecycle_status = 'attached_temporary'
    GROUP BY a.id
    HAVING MAX(ma.origin_user_turn_index + ma.replay_window_turns) <= ?
  `);
  const markExpired = db.prepare(`
    UPDATE attachments
    SET lifecycle_status = 'expired', expired_at = ?, updated_at = ?
    WHERE id = ? AND lifecycle_status = 'attached_temporary'
  `);
  const getExpiredAttachment = db.prepare(`
    SELECT a.id, a.blob_id AS blobId, b.stored_path AS storedPath
    FROM attachments a
    JOIN attachment_blobs b ON b.id = a.blob_id
    WHERE a.id = ? AND a.lifecycle_status = 'expired'
    LIMIT 1
  `);
  const countOtherActiveBlobReferences = db.prepare(`
    SELECT COUNT(*) AS count
    FROM attachments
    WHERE blob_id = ? AND id <> ?
      AND lifecycle_status NOT IN ('expired', 'failed', 'deleted')
  `);
  const markAttachmentDeleted = db.prepare(`
    UPDATE attachments
    SET lifecycle_status = 'deleted', deleted_at = ?, updated_at = ?
    WHERE id = ? AND lifecycle_status = 'expired'
  `);
  const markBlobDeleted = db.prepare(`
    UPDATE attachment_blobs
    SET status = 'deleted', updated_at = ?
    WHERE id = ? AND status = 'ready'
  `);
  const updateAttached = db.prepare(`
    UPDATE attachments
    SET session_id = ?, lifecycle_status = 'attached_temporary',
        attached_at = COALESCE(attached_at, ?), updated_at = ?
    WHERE id = ?
      AND lifecycle_status IN ('uploaded_unattached', 'attached_temporary')
      AND (session_id IS NULL OR session_id = ?)
  `);
  const insertMessageAttachment = db.prepare(`
    INSERT INTO message_attachments (
      message_id, attachment_id, position,
      origin_user_turn_index, replay_window_turns, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const listSessionAttachments = db.prepare(`
    SELECT ma.message_id AS messageId, ma.position,
           a.id AS attachmentId, a.original_name AS filename, a.kind,
           a.lifecycle_status AS status,
           b.mime_type AS mimeType, b.size_bytes AS sizeBytes
    FROM message_attachments ma
    JOIN messages m ON m.id = ma.message_id
    JOIN attachments a ON a.id = ma.attachment_id
    JOIN attachment_blobs b ON b.id = a.blob_id
    WHERE m.session_id = ?
    ORDER BY m.created_at ASC, m.id ASC, ma.position ASC
  `);

  function assertAttachable(row, sessionId) {
    if (!row) {
      throw lifecycleError('첨부파일을 찾을 수 없습니다.', 'ATTACHMENT_NOT_FOUND', 404);
    }
    if (!['uploaded_unattached', 'attached_temporary'].includes(row.lifecycleStatus)) {
      throw lifecycleError('이 첨부파일은 더 이상 연결할 수 없습니다.', 'ATTACHMENT_NOT_AVAILABLE', 409);
    }
    if (row.blobStatus !== 'ready') {
      throw lifecycleError('첨부 원본을 사용할 수 없습니다.', 'ATTACHMENT_BLOB_NOT_READY', 409);
    }
    if (row.sessionId && row.sessionId !== sessionId) {
      throw lifecycleError('다른 대화에 연결된 첨부파일입니다.', 'ATTACHMENT_SESSION_MISMATCH', 409);
    }
    if (!isInsideDirectory(resolvedTmpDir, row.storedPath)) {
      throw lifecycleError('첨부 저장 경로를 검증하지 못했습니다.', 'ATTACHMENT_STORAGE_INVALID', 409);
    }
  }

  async function verifyStoredBlob(row) {
    let stat;
    try {
      stat = await fsp.stat(row.storedPath);
    } catch {
      throw lifecycleError('첨부 원본을 찾을 수 없습니다.', 'ATTACHMENT_STORAGE_MISSING', 409);
    }
    if (!stat.isFile() || stat.size !== row.sizeBytes) {
      throw lifecycleError('첨부 원본 크기가 저장 기록과 다릅니다.', 'ATTACHMENT_STORAGE_INVALID', 409);
    }
    if (await sha256File(row.storedPath) !== row.sha256) {
      throw lifecycleError('첨부 원본 해시가 저장 기록과 다릅니다.', 'ATTACHMENT_STORAGE_INVALID', 409);
    }
  }

  async function beginChatRequest({ sessionId, attachmentIds }) {
    const ids = normalizeAttachmentIds(attachmentIds);
    if (ids.length === 0) {
      return { attachmentIds: ids, release() {} };
    }
    if (!enabled) {
      throw lifecycleError('첨부파일 기능이 비활성화되어 있습니다.', 'ATTACHMENT_DISABLED', 503);
    }

    const row = getAttachment.get(ids[0]);
    assertAttachable(row, sessionId);
    if (activeAttachmentIds.has(row.id)) {
      throw lifecycleError('첨부파일이 다른 요청에서 사용 중입니다.', 'ATTACHMENT_BUSY', 409);
    }
    activeAttachmentIds.add(row.id);
    try {
      await verifyStoredBlob(row);
    } catch (error) {
      activeAttachmentIds.delete(row.id);
      throw error;
    }

    let released = false;
    return {
      attachmentIds: ids,
      release() {
        if (released) return;
        released = true;
        activeAttachmentIds.delete(row.id);
      },
    };
  }

  const markCandidatesExpired = db.transaction((ids, timestamp) => {
    let changed = 0;
    for (const id of ids) changed += markExpired.run(timestamp, timestamp, id).changes;
    return changed;
  });

  function cleanupExpired(attachmentIds) {
    const timestamp = Math.floor(now() / 1000);
    let attachments = 0;
    let blobs = 0;
    let errors = 0;
    for (const attachmentId of attachmentIds) {
      if (activeAttachmentIds.has(attachmentId)) continue;
      const row = getExpiredAttachment.get(attachmentId);
      if (!row) continue;
      const hasOtherReferences = countOtherActiveBlobReferences.get(row.blobId, row.id).count > 0;
      if (!hasOtherReferences) {
        if (!isInsideDirectory(resolvedTmpDir, row.storedPath)) {
          errors += 1;
          continue;
        }
        try {
          fs.unlinkSync(row.storedPath);
        } catch (error) {
          if (error.code !== 'ENOENT') {
            errors += 1;
            continue;
          }
        }
      }
      db.transaction(() => {
        if (!hasOtherReferences) {
          blobs += markBlobDeleted.run(timestamp, row.blobId).changes;
        }
        attachments += markAttachmentDeleted.run(timestamp, timestamp, row.id).changes;
      })();
    }
    return { attachments, blobs, errors };
  }

  function expireBeforeUpcomingTurn(sessionId) {
    if (!enabled) {
      return { upcomingUserTurnIndex: null, expired: 0, attachments: 0, blobs: 0, errors: 0 };
    }
    const upcomingUserTurnIndex = countUserTurns.get(sessionId).count + 1;
    const candidateIds = findExpiredCandidates
      .all(sessionId, upcomingUserTurnIndex)
      .map(row => row.id)
      .filter(id => !activeAttachmentIds.has(id));
    const timestamp = Math.floor(now() / 1000);
    const expired = markCandidatesExpired(candidateIds, timestamp);
    return {
      upcomingUserTurnIndex,
      expired,
      ...cleanupExpired(candidateIds),
    };
  }

  function attachToUserMessage({ sessionId, userMessageId, attachmentIds }) {
    const ids = normalizeAttachmentIds(attachmentIds);
    if (ids.length === 0) return [];
    if (!enabled) {
      throw lifecycleError('첨부파일 기능이 비활성화되어 있습니다.', 'ATTACHMENT_DISABLED', 503);
    }
    const message = getMessage.get(userMessageId);
    if (!message || message.role !== 'user' || message.sessionId !== sessionId) {
      throw lifecycleError('첨부를 연결할 사용자 메시지가 올바르지 않습니다.', 'ATTACHMENT_MESSAGE_INVALID', 409);
    }
    const originUserTurnIndex = countUserTurns.get(sessionId).count;
    const timestamp = Math.floor(now() / 1000);
    return ids.map((id, position) => {
      const row = getAttachment.get(id);
      assertAttachable(row, sessionId);
      if (!activeAttachmentIds.has(id)) {
        throw lifecycleError('첨부 요청 lease가 만료되었습니다.', 'ATTACHMENT_LEASE_MISSING', 409);
      }
      if (updateAttached.run(sessionId, timestamp, timestamp, id, sessionId).changes !== 1) {
        throw lifecycleError('첨부파일 상태가 변경되었습니다.', 'ATTACHMENT_STATE_CONFLICT', 409);
      }
      insertMessageAttachment.run(
        userMessageId,
        id,
        position,
        originUserTurnIndex,
        replayWindowTurns,
        timestamp,
      );
      return {
        attachmentId: id,
        filename: row.filename,
        kind: row.kind,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        status: 'attached_temporary',
      };
    });
  }

  function listForSession(sessionId) {
    const grouped = new Map();
    for (const row of listSessionAttachments.all(sessionId)) {
      const list = grouped.get(row.messageId) || [];
      list.push({
        attachmentId: row.attachmentId,
        filename: row.filename,
        kind: row.kind,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        status: row.status,
        expired: row.status === 'expired' || row.status === 'deleted',
      });
      grouped.set(row.messageId, list);
    }
    return grouped;
  }

  return {
    attachToUserMessage,
    beginChatRequest,
    cleanupExpired,
    expireBeforeUpcomingTurn,
    isAttachmentActive: attachmentId => activeAttachmentIds.has(attachmentId),
    listForSession,
  };
}

module.exports = {
  ATTACHMENT_ID_PATTERN,
  AttachmentLifecycleError,
  MAX_ATTACHMENTS_PER_MESSAGE,
  createAttachmentLifecycleService,
  normalizeAttachmentIds,
};
