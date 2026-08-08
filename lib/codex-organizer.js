'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');

const MAX_JOB_ERROR_CHARS = 1500;
const CODEX_STORAGE_ERROR_CODES = new Set([
  'EACCES',
  'EBUSY',
  'EDQUOT',
  'EIO',
  'EMFILE',
  'ENFILE',
  'ENOENT',
  'ENOMEM',
  'ENOSPC',
  'ENOTDIR',
  'EPERM',
  'EROFS',
  'ESTALE',
  'EXDEV',
]);

function collectErrorParts(error) {
  const parts = [];
  let current = error;
  const seen = new Set();

  while (current && !seen.has(current)) {
    seen.add(current);
    if (typeof current === 'string') {
      parts.push(current);
      break;
    }
    if (current.code) parts.push(String(current.code));
    if (current.message) parts.push(String(current.message));
    if (current.stderr) parts.push(String(current.stderr));
    if (current.stdout) parts.push(String(current.stdout));
    current = current.cause;
  }

  return parts.join('\n');
}

function isCodexInfrastructureError(error) {
  const code = String(error?.code || error?.cause?.code || '').toUpperCase();
  if (
    error?.killed ||
    error?.cause?.killed ||
    [
      'ENOENT',
      'EACCES',
      'ETIMEDOUT',
      'ECONNRESET',
      'ENETUNREACH',
      'EAI_AGAIN',
      'ENOSPC',
      'EIO',
      'EROFS',
      'EMFILE',
      'ENFILE',
      'ENOMEM',
      'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
    ].includes(code)
  ) {
    return true;
  }

  const text = collectErrorParts(error).toLowerCase();
  return (
    text.includes('usage limit') ||
    text.includes('purchase more credits') ||
    text.includes('try again at') ||
    text.includes('rate limit') ||
    text.includes('enoent') ||
    text.includes('eacces') ||
    text.includes('no such file or directory') ||
    text.includes('command not found') ||
    text.includes(': not found') ||
    text.includes('cannot execute') ||
    text.includes('permission denied') ||
    text.includes('timed out') ||
    text.includes('timeout') ||
    text.includes('not logged in') ||
    text.includes('login required') ||
    text.includes('authentication failed') ||
    text.includes('unauthorized') ||
    /model[^\n]*(?:not found|unavailable|does not exist)/.test(text) ||
    text.includes('service unavailable')
  );
}

function isCodexRunnerError(error) {
  let current = error;
  const seen = new Set();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (String(current.codexFailureKind || '').startsWith('runner_')) return true;
    current = current.cause;
  }
  return false;
}

function isCodexRetryableJobError(error) {
  let current = error;
  const seen = new Set();
  while (current && !seen.has(current)) {
    seen.add(current);
    const kind = String(current.codexFailureKind || '');
    if (kind.startsWith('runner_') || kind.startsWith('storage_')) return true;
    current = current.cause;
  }
  return false;
}

function createCodexStorageError(cause, message = 'Codex vault 저장소를 사용할 수 없습니다') {
  const code = String(cause?.code || '').toUpperCase();
  const error = new Error(`${message}${code ? ` (${code})` : ''}.`);
  error.codexFailureKind = 'storage_infrastructure';
  error.codexStorageCode = code || null;
  return error;
}

function createCodexRecoveryRequiredError(restoreFailure, priorFailure = null) {
  const code = String(
    restoreFailure?.codexStorageCode || restoreFailure?.code || '',
  ).toUpperCase();
  const error = new Error(
    `Codex vault snapshot 자동 복구를 확인할 수 없습니다${code ? ` (${code})` : ''}. ` +
    '수동 복구가 필요합니다.',
  );
  error.codexFailureKind = 'recovery_required';
  error.codexStorageCode = code || null;
  error.priorCodexFailureKind = priorFailure?.codexFailureKind || 'execution';
  return error;
}

function normalizeCodexStorageError(error, message = 'Codex vault 작업 중 저장소 오류가 발생했습니다') {
  let current = error;
  const seen = new Set();
  while (current && !seen.has(current)) {
    seen.add(current);
    const kind = String(current.codexFailureKind || '');
    if (kind.startsWith('runner_') || kind.startsWith('storage_')) return error;
    const code = String(current.code || '').toUpperCase();
    if (CODEX_STORAGE_ERROR_CODES.has(code)) {
      return createCodexStorageError({ code }, message);
    }
    current = current.cause;
  }
  return error;
}

function isCodexRecoveryRequiredError(error) {
  let current = error;
  const seen = new Set();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current.codexFailureKind === 'recovery_required') return true;
    current = current.cause;
  }
  return false;
}

async function inspectCodexVaultRoot(vaultPath, expectedIdentity = null) {
  try {
    const stat = await fs.stat(vaultPath);
    if (!stat.isDirectory()) {
      const error = new Error('vault 루트가 디렉터리가 아닙니다.');
      error.code = 'ENOTDIR';
      throw error;
    }
    await fs.access(
      vaultPath,
      fsSync.constants.R_OK | fsSync.constants.W_OK | fsSync.constants.X_OK,
    );
    if (
      expectedIdentity &&
      (stat.dev !== expectedIdentity.dev || stat.ino !== expectedIdentity.ino)
    ) {
      const error = new Error('vault 루트가 검사 도중 교체됐습니다.');
      error.code = 'ESTALE';
      throw error;
    }
    return { dev: stat.dev, ino: stat.ino };
  } catch (cause) {
    if (String(cause?.codexFailureKind || '').startsWith('storage_')) throw cause;
    throw createCodexStorageError(cause);
  }
}

function compactError(error, maxChars = MAX_JOB_ERROR_CHARS) {
  const text = collectErrorParts(error)
    .replace(/\s+/g, ' ')
    .replace(/\b(?:sk|sess|token)-[A-Za-z0-9._-]+\b/gi, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .trim();
  if (!text) return '원인 미상';
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

function formatCodexJobError(failures, total) {
  const list = Array.isArray(failures) ? failures : [];
  const first = list.find(item => item?.error)?.error;
  return `${list.length}/${Number(total) || list.length}개 노트 정리 실패 — ${compactError(first)}`;
}

function redactCodexNoteNames(error, filenames, maxChars = MAX_JOB_ERROR_CHARS) {
  let text = compactError(error, maxChars);
  for (const filename of Array.isArray(filenames) ? filenames : []) {
    const safeName = String(filename || '').trim();
    if (!safeName) continue;
    text = text.split(safeName).join('[노트]');
    const stem = safeName.replace(/\.md$/i, '');
    if (stem && stem !== safeName) text = text.split(stem).join('[노트]');
  }
  return text;
}

function markerBody(raw, startMarker, endMarker) {
  const text = String(raw || '');
  const start = text.indexOf(startMarker);
  if (start < 0) return null;
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (end < 0) return null;
  return text.slice(start + startMarker.length, end).trim();
}

function parseNoteType(raw) {
  const match = String(raw || '').match(/^---\n[\s\S]*?^note_type:\s*([^\n]+)$/m);
  return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : null;
}

function validateOrganizedCodexOutput(raw) {
  const errors = [];
  const noteType = parseNoteType(raw);
  const tags = markerBody(raw, '<!-- CODEX-TAGS-START -->', '<!-- CODEX-TAGS-END -->');

  if (tags === null) {
    errors.push('CODEX-TAGS 마커가 없습니다.');
  } else {
    const tagMatches = tags.match(/#[\p{L}\p{N}_-]+/gu) || [];
    const uniqueTags = new Set(tagMatches);
    if (uniqueTags.size < 3 || uniqueTags.size > 8) {
      errors.push(`CODEX 태그가 3~8개여야 합니다: ${uniqueTags.size}개`);
    }
  }

  if (noteType === 'topic') {
    const summary = markerBody(raw, '<!-- CODEX-SUMMARY-START -->', '<!-- CODEX-SUMMARY-END -->');
    if (!summary) {
      errors.push('topic CODEX-SUMMARY가 비어 있습니다.');
    } else if (/Codex 정리 대기/.test(summary)) {
      errors.push('topic CODEX-SUMMARY placeholder가 남아 있습니다.');
    }
  }

  return errors;
}

function recoverInterruptedCodexJobs(db) {
  const selectRunningJobs = db.prepare(`
    SELECT id, note_filenames_json AS noteFilenamesJson
    FROM codex_jobs
    WHERE status = 'running'
    ORDER BY id ASC
  `);
  const selectPendingJobs = db.prepare(`
    SELECT id, note_filenames_json AS noteFilenamesJson
    FROM codex_jobs
    WHERE status = 'pending'
    ORDER BY id ASC
  `);
  const quarantineJobs = db.prepare(`
    UPDATE codex_jobs
    SET status = 'failed',
        error = '서버 중단으로 변경 검증을 완료하지 못했습니다. 수동 복구가 필요합니다.',
        finished_at = strftime('%s','now')
    WHERE status = 'running'
  `);
  const quarantineRunningNotes = db.prepare(`
    UPDATE notes
    SET codex_status = 'recovery_required', updated_at = strftime('%s','now')
    WHERE archived = 0 AND codex_status = 'running'
  `);
  const quarantineJobNote = db.prepare(`
    UPDATE notes
    SET codex_status = 'recovery_required', updated_at = strftime('%s','now')
    WHERE filename = ?
      AND archived = 0
      AND codex_status != 'recovery_required'
  `);
  const normalizeLegacySuccess = db.prepare(`
    UPDATE notes
    SET codex_status = 'processed', updated_at = strftime('%s','now')
    WHERE codex_status = 'success'
  `);
  const queueJobNote = db.prepare(`
    UPDATE notes
    SET codex_status = 'queued', updated_at = strftime('%s','now')
    WHERE filename = ?
      AND archived = 0
      AND codex_status IN ('pending', 'queued')
  `);

  return db.transaction(() => {
    const runningJobs = selectRunningJobs.all();
    const quarantinedJobs = quarantineJobs.run().changes;
    let quarantinedNotes = 0;
    runningJobs.forEach(job => {
      let filenames = [];
      try {
        filenames = JSON.parse(job.noteFilenamesJson);
      } catch {
        filenames = [];
      }
      if (!Array.isArray(filenames)) return;
      filenames.forEach(filename => {
        quarantinedNotes += quarantineJobNote.run(filename).changes;
      });
    });
    quarantinedNotes += quarantineRunningNotes.run().changes;
    const normalizedStatuses = normalizeLegacySuccess.run().changes;
    const pendingJobs = selectPendingJobs.all();
    let queuedNotes = 0;

    pendingJobs.forEach(job => {
      let filenames = [];
      try {
        filenames = JSON.parse(job.noteFilenamesJson);
      } catch {
        filenames = [];
      }
      if (!Array.isArray(filenames)) return;
      filenames.forEach(filename => {
        queuedNotes += queueJobNote.run(filename).changes;
      });
    });

    return {
      quarantinedJobs,
      quarantinedRunningJobIds: runningJobs.map(job => job.id),
      quarantinedNotes,
      normalizedStatuses,
      queuedNotes,
      pendingJobs: pendingJobs.length,
    };
  })();
}

// 정리 job에 지금 넣을 수 있는 노트다.
//
// `pending`만 고르면 안 된다. 재시도 가능한 실패는 노트를 `queued`로 되돌리고 job은
// `failed`로 끝나는데, 그러면 그 노트들이 어느 job에도 다시 들어가지 못하고 영영
// 갇힌다. 살아 있는(`pending`·`running`) job이 들고 있지 않은 `queued`는 다시 집는다.
const QUEUEABLE_NOTES_WHERE = `
  archived = 0 AND ai_readable = 1
  AND codex_status IN ('pending', 'queued')
  AND NOT EXISTS (
    SELECT 1
    FROM codex_jobs j, json_each(j.note_filenames_json) v
    WHERE j.status IN ('pending', 'running') AND v.value = notes.filename
  )
`;

function createCodexQueueReader(db) {
  if (!db?.prepare) throw new TypeError('SQLite DB 연결이 필요합니다.');
  const selectQueueable = db.prepare(`
    SELECT filename, title, note_type AS noteType, codex_status AS codexStatus
    FROM notes
    WHERE ${QUEUEABLE_NOTES_WHERE}
    ORDER BY created_at ASC, id ASC
  `);
  const countStranded = db.prepare(`
    SELECT COUNT(*) AS count
    FROM notes
    WHERE ${QUEUEABLE_NOTES_WHERE} AND codex_status = 'queued'
  `);
  return {
    listQueueable: () => selectQueueable.all(),
    countStranded: () => countStranded.get().count,
  };
}

module.exports = {
  createCodexQueueReader,
  compactError,
  createCodexRecoveryRequiredError,
  createCodexStorageError,
  formatCodexJobError,
  inspectCodexVaultRoot,
  isCodexInfrastructureError,
  isCodexRecoveryRequiredError,
  isCodexRetryableJobError,
  isCodexRunnerError,
  normalizeCodexStorageError,
  redactCodexNoteNames,
  recoverInterruptedCodexJobs,
  validateOrganizedCodexOutput,
};
