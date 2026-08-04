'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const Busboy = require('busboy');

const MIB = 1024 * 1024;
const DEFAULT_LIMITS = Object.freeze({
  pdf: 20 * MIB,
  image: 10 * MIB,
  text: 2 * MIB,
  markdown: 2 * MIB,
});
const DEFAULT_ORPHAN_RETENTION_MS = 60 * 60 * 1000;
const ABSOLUTE_MAX_BYTES = Math.max(...Object.values(DEFAULT_LIMITS));

const FORMATS = Object.freeze({
  '.pdf': { kind: 'pdf', mimeTypes: new Set(['application/pdf']), storedExtension: '.pdf' },
  '.md': {
    kind: 'markdown',
    mimeTypes: new Set(['text/markdown', 'text/x-markdown']),
    storedExtension: '.md',
  },
  '.txt': { kind: 'text', mimeTypes: new Set(['text/plain']), storedExtension: '.txt' },
  '.jpg': { kind: 'image', mimeTypes: new Set(['image/jpeg']), storedExtension: '.jpg' },
  '.jpeg': { kind: 'image', mimeTypes: new Set(['image/jpeg']), storedExtension: '.jpg' },
  '.png': { kind: 'image', mimeTypes: new Set(['image/png']), storedExtension: '.png' },
  '.webp': { kind: 'image', mimeTypes: new Set(['image/webp']), storedExtension: '.webp' },
});

class AttachmentUploadError extends Error {
  constructor(message, { code = 'ATTACHMENT_UPLOAD_FAILED', status = 400 } = {}) {
    super(message);
    this.name = 'AttachmentUploadError';
    this.code = code;
    this.status = status;
  }
}

function uploadError(message, code, status = 400) {
  return new AttachmentUploadError(message, { code, status });
}

function normalizeOriginalName(value) {
  const basename = path.basename(String(value || '').normalize('NFC'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (!basename || basename.length > 255) {
    throw uploadError('첨부파일 이름이 올바르지 않습니다.', 'ATTACHMENT_FILENAME_INVALID');
  }
  return basename;
}

function classifyAttachment(filename, mimeType) {
  const originalName = normalizeOriginalName(filename);
  const extension = path.extname(originalName).toLowerCase();
  const format = FORMATS[extension];
  const normalizedMime = String(mimeType || '').toLowerCase().split(';', 1)[0].trim();
  if (!format || !format.mimeTypes.has(normalizedMime)) {
    throw uploadError(
      '지원하지 않거나 파일 형식과 MIME이 일치하지 않습니다.',
      'ATTACHMENT_TYPE_UNSUPPORTED',
      415,
    );
  }
  return { ...format, originalName, mimeType: normalizedMime };
}

function hasValidSignature(kind, mimeType, prefix) {
  if (kind === 'pdf') return prefix.subarray(0, 5).equals(Buffer.from('%PDF-'));
  if (kind === 'text' || kind === 'markdown') return true;
  if (mimeType === 'image/jpeg') {
    return prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return prefix.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === 'image/webp') {
    return prefix.subarray(0, 4).toString('ascii') === 'RIFF'
      && prefix.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

async function validateStoredFile(candidate, maxBytes) {
  if (candidate.sizeBytes <= 0) {
    throw uploadError('빈 첨부파일은 업로드할 수 없습니다.', 'ATTACHMENT_EMPTY');
  }
  if (candidate.sizeBytes > maxBytes) {
    throw uploadError('첨부파일이 형식별 업로드 상한을 넘었습니다.', 'ATTACHMENT_TOO_LARGE', 413);
  }
  if (!hasValidSignature(candidate.kind, candidate.mimeType, candidate.prefix)) {
    throw uploadError(
      '파일 내용이 확장자와 일치하지 않습니다.',
      'ATTACHMENT_SIGNATURE_INVALID',
      415,
    );
  }
  if (candidate.kind === 'text' || candidate.kind === 'markdown') {
    const content = await fsp.readFile(candidate.partialPath);
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(content);
    } catch {
      throw uploadError('텍스트 첨부는 UTF-8 형식이어야 합니다.', 'ATTACHMENT_TEXT_INVALID', 415);
    }
    if (content.includes(0)) {
      throw uploadError('텍스트 첨부에 허용되지 않는 바이트가 있습니다.', 'ATTACHMENT_TEXT_INVALID', 415);
    }
  }
}

async function syncFile(filePath) {
  const handle = await fsp.open(filePath, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function readSingleAttachmentUpload(req, {
  tmpDir,
  limits = DEFAULT_LIMITS,
  randomBytes = crypto.randomBytes,
} = {}) {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers['content-type'] || '');
    if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
      reject(uploadError(
        'multipart/form-data 첨부 요청이 필요합니다.',
        'ATTACHMENT_MULTIPART_REQUIRED',
        415,
      ));
      return;
    }

    let parser;
    try {
      parser = Busboy({
        headers: req.headers,
        defParamCharset: 'utf8',
        limits: {
          files: 1,
          fileSize: ABSOLUTE_MAX_BYTES,
          fields: 0,
          parts: 2,
        },
      });
    } catch {
      reject(uploadError('첨부 업로드 형식이 올바르지 않습니다.', 'ATTACHMENT_MULTIPART_INVALID'));
      return;
    }

    let fileSeen = false;
    let settled = false;
    let fileResult = null;
    let partialPath = null;
    let activeOutput = null;

    const removePartial = () => {
      if (!partialPath) return;
      try { fs.unlinkSync(partialPath); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    };
    const fail = error => {
      if (settled) return;
      settled = true;
      if (activeOutput) {
        activeOutput.once('close', () => {
          try { removePartial(); } catch { /* 다음 orphan 정리에서 회수 */ }
        });
        activeOutput.destroy();
      } else {
        try { removePartial(); } catch { /* 다음 orphan 정리에서 회수 */ }
      }
      reject(error);
    };

    parser.on('file', (fieldName, file, info) => {
      if (settled) {
        file.resume();
        return;
      }
      if (fieldName !== 'file' || fileSeen) {
        file.resume();
        fail(uploadError('첨부파일은 file 필드 하나만 보낼 수 있습니다.', 'ATTACHMENT_FILE_LIMIT'));
        return;
      }
      fileSeen = true;

      let format;
      try {
        format = classifyAttachment(info.filename, info.mimeType);
      } catch (error) {
        file.resume();
        fail(error);
        return;
      }

      const attachmentId = `att_${randomBytes(16).toString('hex')}`;
      const storedName = `${attachmentId}${format.storedExtension}`;
      partialPath = path.join(tmpDir, `${storedName}.partial`);
      const finalPath = path.join(tmpDir, storedName);
      const hash = crypto.createHash('sha256');
      const prefixChunks = [];
      let prefixBytes = 0;
      let sizeBytes = 0;
      let truncated = false;
      const output = fs.createWriteStream(partialPath, { flags: 'wx', mode: 0o600 });
      activeOutput = output;

      file.on('limit', () => { truncated = true; });
      file.on('data', chunk => {
        const bytes = Buffer.from(chunk);
        sizeBytes += bytes.length;
        hash.update(bytes);
        if (prefixBytes < 16) {
          const needed = 16 - prefixBytes;
          const piece = bytes.subarray(0, needed);
          prefixChunks.push(piece);
          prefixBytes += piece.length;
        }
      });
      file.on('error', () => {
        output.destroy();
        fail(uploadError('첨부파일 업로드가 중단되었습니다.', 'ATTACHMENT_UPLOAD_FAILED'));
      });
      output.on('error', () => {
        file.resume();
        fail(uploadError('첨부파일을 저장하지 못했습니다.', 'ATTACHMENT_STORAGE_FAILED', 500));
      });

      fileResult = new Promise((resolveFile, rejectFile) => {
        output.on('finish', () => {
          activeOutput = null;
          if (truncated) {
            rejectFile(uploadError('첨부파일이 업로드 상한을 넘었습니다.', 'ATTACHMENT_TOO_LARGE', 413));
            return;
          }
          resolveFile({
            ...format,
            attachmentId,
            storedName,
            partialPath,
            finalPath,
            sizeBytes,
            sha256: hash.digest('hex'),
            prefix: Buffer.concat(prefixChunks),
          });
        });
      });
      file.pipe(output);
    });
    parser.on('filesLimit', () => {
      fail(uploadError('한 번에 첨부파일 하나만 보낼 수 있습니다.', 'ATTACHMENT_FILE_LIMIT'));
    });
    parser.on('fieldsLimit', () => {
      fail(uploadError('첨부 요청에는 추가 필드를 보낼 수 없습니다.', 'ATTACHMENT_FIELD_LIMIT'));
    });
    parser.on('partsLimit', () => {
      fail(uploadError('첨부 요청 항목이 너무 많습니다.', 'ATTACHMENT_PART_LIMIT'));
    });
    parser.on('error', () => {
      fail(uploadError('첨부 업로드 형식이 올바르지 않습니다.', 'ATTACHMENT_MULTIPART_INVALID'));
    });
    parser.on('close', async () => {
      if (settled) return;
      if (!fileSeen || !fileResult) {
        fail(uploadError('첨부파일이 필요합니다.', 'ATTACHMENT_FILE_REQUIRED'));
        return;
      }
      try {
        const candidate = await fileResult;
        await validateStoredFile(candidate, limits[candidate.kind]);
        await syncFile(candidate.partialPath);
        settled = true;
        resolve(candidate);
      } catch (error) {
        fail(error instanceof AttachmentUploadError
          ? error
          : uploadError('첨부파일을 저장하지 못했습니다.', 'ATTACHMENT_STORAGE_FAILED', 500));
      }
    });
    req.once('aborted', () => {
      fail(uploadError('첨부파일 업로드가 중단되었습니다.', 'ATTACHMENT_UPLOAD_ABORTED'));
    });
    req.once('error', () => {
      fail(uploadError('첨부파일 업로드를 읽지 못했습니다.', 'ATTACHMENT_UPLOAD_FAILED'));
    });
    req.pipe(parser);
  });
}

function createAttachmentUploadService(db, {
  enabled = false,
  tmpDir,
  limits = DEFAULT_LIMITS,
  orphanRetentionMs = DEFAULT_ORPHAN_RETENTION_MS,
  cleanupIntervalMs = 15 * 60 * 1000,
  now = Date.now,
  randomBytes = crypto.randomBytes,
  isAttachmentActive = () => false,
} = {}) {
  if (!db?.prepare || typeof db.transaction !== 'function') {
    throw new TypeError('SQLite DB 연결이 필요합니다.');
  }
  if (!tmpDir) throw new TypeError('첨부 temporary 경로가 필요합니다.');

  const resolvedTmpDir = path.resolve(tmpDir);
  const resolvedLimits = { ...DEFAULT_LIMITS, ...limits };
  let cleanupTimer = null;

  const findReadyBlob = db.prepare(`
    SELECT id, stored_path AS storedPath, stored_name AS storedName,
           mime_type AS mimeType, size_bytes AS sizeBytes
    FROM attachment_blobs
    WHERE sha256 = ? AND mime_type = ?
      AND storage_scope = 'temporary' AND status = 'ready'
    ORDER BY id ASC
    LIMIT 1
  `);
  const insertBlob = db.prepare(`
    INSERT INTO attachment_blobs (
      sha256, stored_name, stored_path, mime_type, size_bytes,
      storage_scope, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'temporary', 'ready', ?, ?)
  `);
  const insertAttachment = db.prepare(`
    INSERT INTO attachments (
      id, blob_id, original_name, kind, scope, lifecycle_status,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'temporary', 'uploaded_unattached', ?, ?)
  `);
  const insertUpload = db.transaction((candidate, createdAt) => {
    let blob = findReadyBlob.get(candidate.sha256, candidate.mimeType);
    if (blob && (!fs.existsSync(blob.storedPath) || blob.sizeBytes !== candidate.sizeBytes)) {
      db.prepare(`
        UPDATE attachment_blobs
        SET status = 'deleted', updated_at = ?
        WHERE id = ? AND status = 'ready'
      `).run(createdAt, blob.id);
      blob = null;
    }
    const blobId = blob
      ? blob.id
      : Number(insertBlob.run(
        candidate.sha256,
        candidate.storedName,
        candidate.finalPath,
        candidate.mimeType,
        candidate.sizeBytes,
        createdAt,
        createdAt,
      ).lastInsertRowid);
    insertAttachment.run(
      candidate.attachmentId,
      blobId,
      candidate.originalName,
      candidate.kind,
      createdAt,
      createdAt,
    );
    return { blobId, reusedBlob: !!blob, storedPath: blob?.storedPath || candidate.finalPath };
  });

  async function upload(req) {
    if (!enabled) {
      throw uploadError('첨부파일 기능이 비활성화되어 있습니다.', 'ATTACHMENT_DISABLED', 503);
    }
    await fsp.mkdir(resolvedTmpDir, { recursive: true, mode: 0o700 });
    const candidate = await readSingleAttachmentUpload(req, {
      tmpDir: resolvedTmpDir,
      limits: resolvedLimits,
      randomBytes,
    });
    const createdAt = Math.floor(now() / 1000);
    let finalizedNewFile = false;
    try {
      const existing = findReadyBlob.get(candidate.sha256, candidate.mimeType);
      if (existing && fs.existsSync(existing.storedPath) && existing.sizeBytes === candidate.sizeBytes) {
        await fsp.unlink(candidate.partialPath);
      } else {
        await fsp.rename(candidate.partialPath, candidate.finalPath);
        finalizedNewFile = true;
      }
      const stored = insertUpload(candidate, createdAt);
      if (stored.reusedBlob && finalizedNewFile) {
        await fsp.unlink(candidate.finalPath).catch(() => {});
        finalizedNewFile = false;
      }
      return {
        attachmentId: candidate.attachmentId,
        filename: candidate.originalName,
        mimeType: candidate.mimeType,
        sizeBytes: candidate.sizeBytes,
        status: 'uploaded_unattached',
        orphanExpiresAt: new Date((createdAt * 1000) + orphanRetentionMs).toISOString(),
      };
    } catch (error) {
      await fsp.unlink(candidate.partialPath).catch(() => {});
      if (finalizedNewFile) await fsp.unlink(candidate.finalPath).catch(() => {});
      if (error instanceof AttachmentUploadError) throw error;
      throw uploadError('첨부파일을 저장하지 못했습니다.', 'ATTACHMENT_STORAGE_FAILED', 500);
    }
  }

  function cleanupOrphans() {
    if (!enabled) return { attachments: 0, blobs: 0, partials: 0 };
    const currentMs = now();
    const threshold = Math.floor((currentMs - orphanRetentionMs) / 1000);
    const candidates = db.prepare(`
      SELECT a.id, a.blob_id AS blobId, b.stored_path AS storedPath
      FROM attachments a
      JOIN attachment_blobs b ON b.id = a.blob_id
      WHERE a.lifecycle_status = 'uploaded_unattached'
        AND a.created_at <= ?
      ORDER BY a.created_at ASC, a.id ASC
    `).all(threshold);
    let attachmentsDeleted = 0;
    let blobsDeleted = 0;
    const deleteOne = db.transaction(row => {
      const current = db.prepare(`
        SELECT lifecycle_status AS lifecycleStatus
        FROM attachments WHERE id = ?
      `).get(row.id);
      if (current?.lifecycleStatus !== 'uploaded_unattached') return;
      const otherActive = db.prepare(`
        SELECT COUNT(*) AS count
        FROM attachments
        WHERE blob_id = ? AND id <> ?
          AND lifecycle_status NOT IN ('expired', 'failed', 'deleted')
      `).get(row.blobId, row.id).count;
      if (otherActive === 0) {
        try { fs.unlinkSync(row.storedPath); } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        db.prepare(`
          UPDATE attachment_blobs
          SET status = 'deleted', updated_at = ?
          WHERE id = ? AND status = 'ready'
        `).run(Math.floor(currentMs / 1000), row.blobId);
        blobsDeleted += 1;
      }
      db.prepare('DELETE FROM attachment_chunks WHERE attachment_id = ?').run(row.id);
      db.prepare('DELETE FROM attachment_documents WHERE attachment_id = ?').run(row.id);
      db.prepare(`
        UPDATE attachments
        SET lifecycle_status = 'deleted', deleted_at = ?, updated_at = ?
        WHERE id = ? AND lifecycle_status = 'uploaded_unattached'
      `).run(Math.floor(currentMs / 1000), Math.floor(currentMs / 1000), row.id);
      attachmentsDeleted += 1;
    });
    for (const candidate of candidates) {
      if (!isAttachmentActive(candidate.id)) deleteOne(candidate);
    }

    let partialsDeleted = 0;
    try {
      for (const entry of fs.readdirSync(resolvedTmpDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.partial')) continue;
        const filePath = path.join(resolvedTmpDir, entry.name);
        if (fs.statSync(filePath).mtimeMs > currentMs - orphanRetentionMs) continue;
        fs.unlinkSync(filePath);
        partialsDeleted += 1;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return { attachments: attachmentsDeleted, blobs: blobsDeleted, partials: partialsDeleted };
  }

  function start() {
    if (!enabled || cleanupTimer) return;
    fs.mkdirSync(resolvedTmpDir, { recursive: true, mode: 0o700 });
    cleanupOrphans();
    cleanupTimer = setInterval(cleanupOrphans, cleanupIntervalMs);
    cleanupTimer.unref?.();
  }

  function stop() {
    if (!cleanupTimer) return;
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }

  return {
    cleanupOrphans,
    publicConfig: () => ({
      enabled: !!enabled,
      maxFilesPerMessage: 1,
      maxPdfBytes: resolvedLimits.pdf,
      maxImageBytes: resolvedLimits.image,
      maxTextBytes: Math.min(resolvedLimits.text, resolvedLimits.markdown),
      orphanRetentionMinutes: Math.round(orphanRetentionMs / 60000),
    }),
    start,
    stop,
    upload,
  };
}

module.exports = {
  ABSOLUTE_MAX_BYTES,
  AttachmentUploadError,
  DEFAULT_LIMITS,
  DEFAULT_ORPHAN_RETENTION_MS,
  classifyAttachment,
  createAttachmentUploadService,
  readSingleAttachmentUpload,
};
