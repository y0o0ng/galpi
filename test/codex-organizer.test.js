'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const {
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
} = require('../lib/codex-organizer');

function note({ noteType = 'topic', summary = '정리된 핵심 요약', tags = '#갈피 #정리 #지식' } = {}) {
  return `---
title: "테스트"
note_type: ${noteType}
---

# 테스트

<!-- CODEX-SUMMARY-START -->
${summary}
<!-- CODEX-SUMMARY-END -->

<!-- CODEX-TAGS-START -->
${tags}
<!-- CODEX-TAGS-END -->`;
}

test('Codex 실행 환경 장애와 노트 검증 오류를 구분한다', () => {
  const missing = Object.assign(new Error('spawn failed'), { code: 'ENOENT' });
  const wrapped = new Error('Codex 실행 실패', { cause: missing });

  assert.equal(isCodexInfrastructureError(missing), true);
  assert.equal(isCodexInfrastructureError(wrapped), true);
  assert.equal(isCodexInfrastructureError(new Error('rate limit exceeded')), true);
  assert.equal(isCodexInfrastructureError(new Error('login required')), true);
  assert.equal(isCodexInfrastructureError(Object.assign(new Error('Command failed'), { killed: true })), true);
  assert.equal(isCodexInfrastructureError(new Error('/fixed/node: not found')), true);
  assert.equal(isCodexInfrastructureError(new Error('CODEX-TAGS 마커가 없습니다.')), false);

  const missingNote = Object.assign(new Error('vault/note.md 없음'), { code: 'ENOENT' });
  assert.equal(isCodexRunnerError(missingNote), false);
  assert.equal(isCodexRunnerError(new Error('topic-timeout.md: 출력 검증 실패')), false);
  missing.codexFailureKind = 'runner_infrastructure';
  assert.equal(isCodexRunnerError(wrapped), true);
  assert.equal(isCodexRetryableJobError(wrapped), true);

  const storage = new Error('vault storage unavailable');
  storage.codexFailureKind = 'storage_infrastructure';
  assert.equal(isCodexRunnerError(storage), false);
  assert.equal(isCodexRetryableJobError(storage), true);
  assert.equal(isCodexRetryableJobError(createCodexStorageError({ code: 'EIO' })), true);
});

test('vault 루트가 파일 검사 사이에 교체되면 개별 누락이 아닌 저장소 장애다', async t => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-vault-root-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const vaultPath = path.join(parent, 'vault');
  const offlinePath = path.join(parent, 'vault-offline');
  await fs.mkdir(vaultPath);

  const identity = await inspectCodexVaultRoot(vaultPath);
  await fs.rename(vaultPath, offlinePath);
  await fs.mkdir(vaultPath);

  await assert.rejects(
    inspectCodexVaultRoot(vaultPath, identity),
    error => (
      error.codexFailureKind === 'storage_infrastructure' &&
      /ESTALE/.test(error.message)
    ),
  );
});

test('vault I/O 오류는 경로를 버리고 재시도 가능한 저장소 오류로 정규화한다', () => {
  const raw = new Error('EIO: input/output error, open /private/vault/secret-note.md');
  raw.code = 'EIO';
  const normalized = normalizeCodexStorageError(raw);

  assert.equal(normalized.codexFailureKind, 'storage_infrastructure');
  assert.equal(normalized.codexStorageCode, 'EIO');
  assert.match(normalized.message, /저장소 오류.*\(EIO\)/);
  assert.doesNotMatch(normalized.message, /\/private\/vault|secret-note/);
});

test('snapshot 복원 실패는 자동 재시도할 수 없는 수동 복구 오류다', () => {
  const storage = createCodexStorageError({ code: 'EROFS' });
  const recovery = createCodexRecoveryRequiredError(storage, new Error('validation failed'));

  assert.equal(isCodexRecoveryRequiredError(recovery), true);
  assert.equal(isCodexRetryableJobError(recovery), false);
  assert.equal(recovery.codexStorageCode, 'EROFS');
  assert.match(recovery.message, /수동 복구가 필요/);
});

test('Codex job 오류는 원인을 보존하면서 길이를 제한한다', () => {
  const cause = Object.assign(new Error(`runner missing ${'x'.repeat(100)}`), { code: 'ENOENT' });
  const wrapped = new Error('Codex 실행 실패', { cause });
  const compact = compactError(wrapped, 60);

  assert.match(compact, /Codex 실행 실패/);
  assert.match(compact, /ENOENT/);
  assert.ok(compact.length <= 60);
  assert.ok(compact.endsWith('…'));
  assert.equal(compactError(new Error('Bearer sk-secret-value')), 'Bearer [redacted]');
  assert.equal(
    redactCodexNoteNames(new Error('topic-timeout.md: 검증 실패'), ['topic-timeout.md']),
    '[노트]: 검증 실패',
  );
  assert.match(formatCodexJobError([{ filename: 'note.md', error: wrapped }], 5), /^1\/5개 노트 정리 실패 —/);
});

test('Codex 출력은 실제 태그와 topic 요약을 요구한다', () => {
  assert.deepEqual(validateOrganizedCodexOutput(note()), []);
  assert.deepEqual(validateOrganizedCodexOutput(note({ noteType: 'highlight', summary: '' })), []);

  const missingTags = validateOrganizedCodexOutput(note({ tags: '' }));
  assert.ok(missingTags.some(error => /3~8개/.test(error)));

  const placeholder = validateOrganizedCodexOutput(note({ summary: 'Codex 정리 대기' }));
  assert.ok(placeholder.some(error => /placeholder/.test(error)));

  const tooManyTags = validateOrganizedCodexOutput(note({
    tags: '#하나 #둘 #셋 #넷 #다섯 #여섯 #일곱 #여덟 #아홉',
  }));
  assert.ok(tooManyTags.some(error => /9개/.test(error)));
});

test('재시작 복구는 검증이 끝나지 않은 job과 대상 노트를 수동 복구로 격리한다', t => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE notes (
      filename TEXT PRIMARY KEY,
      archived INTEGER NOT NULL DEFAULT 0,
      codex_status TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE codex_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL,
      note_filenames_json TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      started_at INTEGER,
      finished_at INTEGER
    );
  `);

  const insertNote = db.prepare('INSERT INTO notes (filename, archived, codex_status) VALUES (?, ?, ?)');
  insertNote.run('running-job.md', 0, 'running');
  insertNote.run('processed-running-job.md', 0, 'processed');
  insertNote.run('pending-job.md', 0, 'pending');
  insertNote.run('orphan-running.md', 0, 'running');
  insertNote.run('manual.md', 0, 'needs_manual_check');
  insertNote.run('legacy-success.md', 0, 'success');
  insertNote.run('archived-running.md', 1, 'running');

  const insertJob = db.prepare(`
    INSERT INTO codex_jobs (status, note_filenames_json, error, started_at)
    VALUES (?, ?, ?, 123)
  `);
  const runningJobId = Number(insertJob.run(
    'running',
    JSON.stringify(['running-job.md', 'processed-running-job.md']),
    null,
  ).lastInsertRowid);
  insertJob.run('pending', JSON.stringify(['pending-job.md']), '기존 오류');

  const result = recoverInterruptedCodexJobs(db);

  assert.deepEqual(result, {
    quarantinedJobs: 1,
    quarantinedRunningJobIds: [runningJobId],
    quarantinedNotes: 3,
    normalizedStatuses: 1,
    queuedNotes: 1,
    pendingJobs: 1,
  });
  assert.deepEqual(
    db.prepare('SELECT filename, codex_status AS status FROM notes ORDER BY filename').all(),
    [
      { filename: 'archived-running.md', status: 'running' },
      { filename: 'legacy-success.md', status: 'processed' },
      { filename: 'manual.md', status: 'needs_manual_check' },
      { filename: 'orphan-running.md', status: 'recovery_required' },
      { filename: 'pending-job.md', status: 'queued' },
      { filename: 'processed-running-job.md', status: 'recovery_required' },
      { filename: 'running-job.md', status: 'recovery_required' },
    ],
  );
  const quarantinedJob = db.prepare(
    'SELECT status, error, started_at AS startedAt, finished_at AS finishedAt FROM codex_jobs WHERE id = ?',
  ).get(runningJobId);
  assert.equal(quarantinedJob.status, 'failed');
  assert.equal(
    quarantinedJob.error,
    '서버 중단으로 변경 검증을 완료하지 못했습니다. 수동 복구가 필요합니다.',
  );
  assert.equal(quarantinedJob.startedAt, 123);
  assert.equal(Number.isInteger(quarantinedJob.finishedAt), true);
});
