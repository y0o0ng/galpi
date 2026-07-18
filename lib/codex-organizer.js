'use strict';

const MAX_JOB_ERROR_CHARS = 1500;

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
  const recoverJobs = db.prepare(`
    UPDATE codex_jobs
    SET status = 'pending',
        error = '서버 재시작 후 대기열 복구',
        started_at = NULL,
        finished_at = NULL
    WHERE status = 'running'
  `);
  const resetRunningNotes = db.prepare(`
    UPDATE notes
    SET codex_status = 'pending', updated_at = strftime('%s','now')
    WHERE archived = 0 AND codex_status = 'running'
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
      AND codex_status IN ('pending', 'queued', 'running')
  `);

  return db.transaction(() => {
    const runningJobs = selectRunningJobs.all();
    const recoveredJobs = recoverJobs.run().changes;
    const resetNotes = resetRunningNotes.run().changes;
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
      recoveredJobs,
      recoveredRunningJobIds: runningJobs.map(job => job.id),
      resetNotes,
      normalizedStatuses,
      queuedNotes,
      pendingJobs: pendingJobs.length,
    };
  })();
}

module.exports = {
  compactError,
  formatCodexJobError,
  isCodexInfrastructureError,
  isCodexRunnerError,
  redactCodexNoteNames,
  recoverInterruptedCodexJobs,
  validateOrganizedCodexOutput,
};
