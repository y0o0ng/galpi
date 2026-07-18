'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  compactError,
  formatCodexJobError,
  isCodexInfrastructureError,
  isCodexRunnerError,
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

test('재시작 복구는 실행 중 job을 대기로 되돌리고 해당 노트만 다시 큐에 넣는다', t => {
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
  insertNote.run('pending-job.md', 0, 'pending');
  insertNote.run('orphan-running.md', 0, 'running');
  insertNote.run('manual.md', 0, 'needs_manual_check');
  insertNote.run('legacy-success.md', 0, 'success');
  insertNote.run('archived-running.md', 1, 'running');

  const insertJob = db.prepare(`
    INSERT INTO codex_jobs (status, note_filenames_json, error, started_at)
    VALUES (?, ?, ?, 123)
  `);
  const runningJobId = Number(insertJob.run('running', JSON.stringify(['running-job.md']), null).lastInsertRowid);
  insertJob.run('pending', JSON.stringify(['pending-job.md']), '기존 오류');

  const result = recoverInterruptedCodexJobs(db);

  assert.deepEqual(result, {
    recoveredJobs: 1,
    recoveredRunningJobIds: [runningJobId],
    resetNotes: 2,
    normalizedStatuses: 1,
    queuedNotes: 2,
    pendingJobs: 2,
  });
  assert.deepEqual(
    db.prepare('SELECT filename, codex_status AS status FROM notes ORDER BY filename').all(),
    [
      { filename: 'archived-running.md', status: 'running' },
      { filename: 'legacy-success.md', status: 'processed' },
      { filename: 'manual.md', status: 'needs_manual_check' },
      { filename: 'orphan-running.md', status: 'pending' },
      { filename: 'pending-job.md', status: 'queued' },
      { filename: 'running-job.md', status: 'queued' },
    ],
  );
  assert.deepEqual(
    db.prepare('SELECT status, error, started_at AS startedAt, finished_at AS finishedAt FROM codex_jobs WHERE id = ?').get(runningJobId),
    {
      status: 'pending',
      error: '서버 재시작 후 대기열 복구',
      startedAt: null,
      finishedAt: null,
    },
  );
});
