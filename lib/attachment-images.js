'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const ATTACHMENT_ID_PATTERN = /^att_[a-f0-9]{32}$/;
const DEFAULT_MAX_IMAGES_PER_TURN = 8;
const DEFAULT_MAX_TURN_BYTES = 12 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const LIBRARY_DIR = '_attachments';

function isInsideDirectory(root, target) {
  const relative = path.relative(root, path.resolve(target));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function createAttachmentImageService(db, {
  enabled = false,
  tmpDir,
  vaultPath = null,
  maxImagesPerTurn = DEFAULT_MAX_IMAGES_PER_TURN,
  maxTurnBytes = DEFAULT_MAX_TURN_BYTES,
} = {}) {
  if (!db?.prepare || typeof db.transaction !== 'function') {
    throw new TypeError('SQLite DB 연결이 필요합니다.');
  }
  if (!tmpDir) throw new TypeError('첨부 temporary 경로가 필요합니다.');

  const resolvedTmpDir = path.resolve(tmpDir);
  // 서재로 승격된 이미지의 원본은 tmp가 아니라 Vault 안에 있다.
  const resolvedLibraryDir = vaultPath ? path.resolve(vaultPath, LIBRARY_DIR) : null;
  const boundedMaxImages = Math.max(1, Math.trunc(Number(maxImagesPerTurn) || DEFAULT_MAX_IMAGES_PER_TURN));
  const boundedMaxBytes = Math.max(1, Math.trunc(Number(maxTurnBytes) || DEFAULT_MAX_TURN_BYTES));

  // 이번 턴에 새로 붙은 이미지는 아직 message_attachments에 없다. 문서 후보와 같은
  // 이유로 명시 ID를 먼저 보고, 그다음 replay 창에 살아 있는 것을 최신순으로 본다.
  const getCurrentImage = db.prepare(`
    SELECT a.id AS attachmentId, a.original_name AS filename, a.scope,
           b.mime_type AS mimeType, b.size_bytes AS sizeBytes,
           b.sha256, b.stored_path AS storedPath
    FROM attachments a
    JOIN attachment_blobs b ON b.id = a.blob_id
    WHERE a.id = @attachmentId
      AND a.kind = 'image'
      AND b.status = 'ready'
      AND (
        (a.scope = 'temporary' AND a.lifecycle_status IN ('uploaded_unattached', 'attached_temporary'))
        OR (a.scope = 'library' AND a.lifecycle_status = 'library')
      )
      AND (a.session_id IS NULL OR a.session_id = @sessionId)
    LIMIT 1
  `);
  const countUserTurns = db.prepare(`
    SELECT COUNT(*) AS count FROM messages WHERE session_id = ? AND role = 'user'
  `);
  // 서재로 승격된 이미지는 만료되지 않으므로 replay 창을 여기서 직접 건다.
  // 임시 이미지도 만료 계산과 같은 식이라 조건을 하나로 쓴다.
  const listReplayImages = db.prepare(`
    SELECT a.id AS attachmentId, a.original_name AS filename, a.scope,
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
      AND b.status = 'ready'
      AND (
        (a.scope = 'temporary' AND a.lifecycle_status = 'attached_temporary')
        OR (a.scope = 'library' AND a.lifecycle_status = 'library')
      )
    GROUP BY a.id
    HAVING MAX(ma.origin_user_turn_index + ma.replay_window_turns) > @upcomingUserTurnIndex
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
      rows.push({ ...row, currentTurn: true, inputIndex: rows.length });
      seen.add(normalizedId);
    }
    const upcomingUserTurnIndex = countUserTurns.get(normalizedSessionId).count + 1;
    for (const row of listReplayImages.all({
      sessionId: normalizedSessionId,
      upcomingUserTurnIndex,
    })) {
      if (seen.has(row.attachmentId)) continue;
      rows.push({ ...row, currentTurn: false });
      seen.add(row.attachmentId);
    }
    return rows;
  }

  function hasAllowedPath(row) {
    if (row.scope === 'library') {
      return !!resolvedLibraryDir && isInsideDirectory(resolvedLibraryDir, row.storedPath);
    }
    return isInsideDirectory(resolvedTmpDir, row.storedPath);
  }

  async function loadVerifiedImage(row) {
    if (!IMAGE_MIME_TYPES.has(String(row.mimeType || ''))) return null;
    if (!hasAllowedPath(row)) return null;
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
      scope: row.scope,
      currentTurn: row.currentTurn,
      latestMessageId: row.latestMessageId ?? null,
      position: row.position ?? 0,
      inputIndex: row.inputIndex ?? 0,
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

    // 예산은 이번 턴 → 최신 replay 순으로 채우지만 출력은 대화 순서다. 한 메시지에
    // 여러 장이 붙어 있을 수 있으므로 통째로 뒤집지 않고 (메시지, position)으로
    // 다시 정렬한다. 이번 턴 첨부는 사용자가 올린 순서 그대로 맨 뒤에 둔다.
    const replayed = selected
      .filter(image => !image.currentTurn)
      .sort((a, b) => a.latestMessageId - b.latestMessageId || a.position - b.position);
    const currentTurn = selected
      .filter(image => image.currentTurn)
      .sort((a, b) => a.inputIndex - b.inputIndex);
    return {
      images: [...replayed, ...currentTurn],
      omittedForBudget,
      skippedInvalid,
      usedBytes,
    };
  }

  /**
   * 자동 topic 저장을 막을지 판단한다. 서재로 승격된 이미지는 영구 자료라
   * 경계 밖이므로 임시 이미지만 센다. U3a가 문서에 정한 것과 같은 규칙이다.
   */
  function hasTemporaryImages({ sessionId, attachmentIds = [] } = {}) {
    return collectRows({ sessionId, attachmentIds })
      .some(row => row.scope === 'temporary');
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
