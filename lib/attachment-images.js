'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const ATTACHMENT_ID_PATTERN = /^att_[a-f0-9]{32}$/;
const DEFAULT_MAX_IMAGES_PER_TURN = 8;
const DEFAULT_MAX_TURN_BYTES = 12 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function isInsideDirectory(root, target) {
  const relative = path.relative(root, path.resolve(target));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function createAttachmentImageService(db, {
  enabled = false,
  tmpDir,
  maxImagesPerTurn = DEFAULT_MAX_IMAGES_PER_TURN,
  maxTurnBytes = DEFAULT_MAX_TURN_BYTES,
} = {}) {
  if (!db?.prepare || typeof db.transaction !== 'function') {
    throw new TypeError('SQLite DB 연결이 필요합니다.');
  }
  if (!tmpDir) throw new TypeError('첨부 temporary 경로가 필요합니다.');

  const resolvedTmpDir = path.resolve(tmpDir);
  const boundedMaxImages = Math.max(1, Math.trunc(Number(maxImagesPerTurn) || DEFAULT_MAX_IMAGES_PER_TURN));
  const boundedMaxBytes = Math.max(1, Math.trunc(Number(maxTurnBytes) || DEFAULT_MAX_TURN_BYTES));

  // 이번 턴에 새로 붙은 이미지는 아직 message_attachments에 없다. 문서 후보와 같은
  // 이유로 명시 ID를 먼저 보고, 그다음 replay 창에 살아 있는 것을 최신순으로 본다.
  const getCurrentImage = db.prepare(`
    SELECT a.id AS attachmentId, a.original_name AS filename,
           b.mime_type AS mimeType, b.size_bytes AS sizeBytes,
           b.sha256, b.stored_path AS storedPath
    FROM attachments a
    JOIN attachment_blobs b ON b.id = a.blob_id
    WHERE a.id = @attachmentId
      AND a.kind = 'image'
      AND a.scope = 'temporary'
      AND a.lifecycle_status IN ('uploaded_unattached', 'attached_temporary')
      AND b.status = 'ready'
      AND (a.session_id IS NULL OR a.session_id = @sessionId)
    LIMIT 1
  `);
  const listReplayImages = db.prepare(`
    SELECT a.id AS attachmentId, a.original_name AS filename,
           b.mime_type AS mimeType, b.size_bytes AS sizeBytes,
           b.sha256, b.stored_path AS storedPath,
           MAX(m.id) AS latestMessageId, MIN(ma.position) AS position
    FROM attachments a
    JOIN attachment_blobs b ON b.id = a.blob_id
    JOIN message_attachments ma ON ma.attachment_id = a.id
    JOIN messages m ON m.id = ma.message_id
    WHERE a.session_id = @sessionId
      AND m.session_id = @sessionId
      AND a.kind = 'image'
      AND a.scope = 'temporary'
      AND a.lifecycle_status = 'attached_temporary'
      AND b.status = 'ready'
    GROUP BY a.id
    ORDER BY latestMessageId DESC, position ASC, a.id ASC
  `);

  function collectRows({ sessionId, attachmentIds = [] } = {}) {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!enabled || !normalizedSessionId) return [];
    const rows = [];
    const seen = new Set();
    for (const attachmentId of Array.isArray(attachmentIds) ? attachmentIds : []) {
      const normalizedId = String(attachmentId || '').trim();
      if (!ATTACHMENT_ID_PATTERN.test(normalizedId) || seen.has(normalizedId)) continue;
      const row = getCurrentImage.get({
        attachmentId: normalizedId,
        sessionId: normalizedSessionId,
      });
      if (!row) continue;
      rows.push({ ...row, currentTurn: true });
      seen.add(normalizedId);
    }
    for (const row of listReplayImages.all({ sessionId: normalizedSessionId })) {
      if (seen.has(row.attachmentId)) continue;
      rows.push({ ...row, currentTurn: false });
      seen.add(row.attachmentId);
    }
    return rows;
  }

  async function loadVerifiedImage(row) {
    if (!IMAGE_MIME_TYPES.has(String(row.mimeType || ''))) return null;
    if (!isInsideDirectory(resolvedTmpDir, row.storedPath)) return null;
    let bytes;
    try {
      bytes = await fsp.readFile(row.storedPath);
    } catch {
      return null;
    }
    if (bytes.length !== row.sizeBytes) return null;
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== row.sha256) return null;
    return {
      attachmentId: row.attachmentId,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      currentTurn: row.currentTurn,
      dataUrl: `data:${row.mimeType};base64,${bytes.toString('base64')}`,
    };
  }

  /**
   * 이번 턴 첨부와 replay 창 안의 이미지를 최신순으로 예산까지 채워 돌려준다.
   * 예산에서 밀린 이미지는 모델이 본 척하지 않도록 호출부가 알려야 하므로
   * 개수를 따로 반환한다.
   */
  async function listTurnImages({ sessionId, attachmentIds = [] } = {}) {
    const rows = collectRows({ sessionId, attachmentIds });
    const selected = [];
    let usedBytes = 0;
    let omittedForBudget = 0;
    let skippedInvalid = 0;

    for (const row of rows) {
      if (selected.length >= boundedMaxImages || usedBytes + row.sizeBytes > boundedMaxBytes) {
        omittedForBudget += 1;
        continue;
      }
      const image = await loadVerifiedImage(row);
      if (!image) {
        skippedInvalid += 1;
        continue;
      }
      selected.push(image);
      usedBytes += image.sizeBytes;
    }

    // 예산은 이번 턴 → 최신 replay 순으로 채우지만, 모델에는 대화 순서대로
    // 보여준다. 이번 턴 첨부는 collectRows가 사용자가 올린 순서 그대로 모으므로
    // 뒤집으면 안 되고, replay만 최신순을 뒤집어 오래된 것부터 놓는다.
    const currentTurn = selected.filter(image => image.currentTurn);
    const replayed = selected.filter(image => !image.currentTurn).reverse();
    return {
      images: [...replayed, ...currentTurn],
      omittedForBudget,
      skippedInvalid,
      usedBytes,
    };
  }

  function hasTemporaryImages({ sessionId, attachmentIds = [] } = {}) {
    return collectRows({ sessionId, attachmentIds }).length > 0;
  }

  return {
    hasTemporaryImages,
    listTurnImages,
    limits: () => ({ maxImagesPerTurn: boundedMaxImages, maxTurnBytes: boundedMaxBytes }),
  };
}

module.exports = {
  DEFAULT_MAX_IMAGES_PER_TURN,
  DEFAULT_MAX_TURN_BYTES,
  createAttachmentImageService,
};
