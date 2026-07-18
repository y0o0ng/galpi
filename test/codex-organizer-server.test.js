'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const API_TOKEN = 'codex-organizer-server-test-token';

function pendingTopicNote() {
  return [
    '---',
    'id: organizer-regression',
    'title: "Organizer Regression"',
    'aliases: ["Organizer Regression"]',
    'created: 2026-07-18 17:00',
    'updated: 2026-07-18 17:00',
    'note_type: topic',
    'archived: false',
    'codex_status: pending',
    'ai_readable: true',
    'knowledge_type: topic',
    'confidence: medium',
    '---',
    '',
    '# Organizer Regression',
    '',
    '## 요약',
    '<!-- CODEX-SUMMARY-START -->',
    '- Codex 정리 대기: 테스트 항목이 쌓여 있다.',
    '<!-- CODEX-SUMMARY-END -->',
    '',
    '## Q&A 로그',
    '<!-- QA-LOG-START -->',
    '',
    '### 2026-07-18 17:00 · Claude',
    '<!-- qa_id: qa-a111 -->',
    '**Q:** 실행기가 없을 때 노트 상태는 어떻게 복구해야 하나?',
    '',
    '**A:** 수동 검토로 격리하지 말고 같은 pending job의 queued 상태로 복구해야 한다.',
    '',
    '<!-- QA-LOG-END -->',
    '',
    '## 태그',
    '<!-- CODEX-TAGS-START -->',
    '<!-- CODEX-TAGS-END -->',
    '',
    '## 연결',
    '<!-- CODEX-LINKS-START -->',
    '<!-- CODEX-LINKS-END -->',
    '',
    '## 제안',
    '<!-- CODEX-PROPOSALS-START -->',
    '<!-- CODEX-PROPOSALS-END -->',
    '',
  ].join('\n');
}

async function availablePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  await once(server, 'close');
  return port;
}

async function waitForServer(child, url, logs) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`테스트 서버가 일찍 종료됐습니다: ${logs.join('')}`);
    }
    try {
      const response = await fetch(`${url}/api/config`);
      if (response.ok) return;
    } catch { /* 기동 대기 */ }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`테스트 서버 기동 시간이 초과됐습니다: ${logs.join('')}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('테스트 서버 종료 시간 초과')), 3000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

async function api(url, pathname, options = {}) {
  const response = await fetch(`${url}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Token': API_TOKEN,
      ...options.headers,
    },
  });
  const body = await response.json();
  return { response, body };
}

async function waitForRunnerHealth(child, url, logs, expectedOk) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`runner 상태 확인 전 서버가 종료됐습니다: ${logs.join('')}`);
    }
    const status = await api(url, '/api/organize/status');
    if (status.body.runner?.checkedAt && status.body.runner.ok === expectedOk) return status.body;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Codex runner 사전 점검 상태(${expectedOk})가 반영되지 않았습니다: ${logs.join('')}`);
}

async function waitForJobStatus(child, url, logs, jobId, expectedStatus) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`job 상태 확인 전 서버가 종료됐습니다: ${logs.join('')}`);
    }
    const status = await api(url, '/api/organize/status');
    const job = status.body.jobs?.find(item => item.id === jobId);
    if (job?.status === expectedStatus) return job;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Codex job #${jobId} 상태가 ${expectedStatus}(으)로 바뀌지 않았습니다: ${logs.join('')}`);
}

test('missing Codex runner keeps the same job retryable and exposes the infrastructure root cause', async t => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-organizer-server-'));
  let child = null;
  t.after(async () => {
    if (child) await stopServer(child);
    await fs.rm(appRoot, { recursive: true, force: true });
  });

  const vaultPath = path.join(appRoot, 'vault');
  await fs.mkdir(vaultPath);
  await fs.copyFile(path.join(ROOT, 'server.js'), path.join(appRoot, 'server.js'));
  for (const name of ['lib', 'scripts', 'public', 'config', '.codex', 'node_modules']) {
    await fs.symlink(path.join(ROOT, name), path.join(appRoot, name), 'dir');
  }

  const filename = 'organizer-regression.md';
  const originalNote = pendingTopicNote();
  await fs.writeFile(path.join(vaultPath, filename), originalNote);

  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  const logs = [];
  const missingCodexBin = path.join(appRoot, 'definitely-missing-codex');
  child = spawn(process.execPath, ['server.js'], {
    cwd: appRoot,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: 'test-key',
      OPENAI_API_KEY: '',
      API_TOKEN,
      HOST: '127.0.0.1',
      PORT: String(port),
      VAULT_PATH: vaultPath,
      BACKUP_DIR: path.join(appRoot, 'backups'),
      CODEX_AUTO_QUEUE_THRESHOLD: '5',
      CODEX_BIN: missingCodexBin,
      CODEX_RUNNER_MODE: 'codex',
      CODEX_RUNNER_TIMEOUT_MS: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => logs.push(chunk.toString()));
  child.stderr.on('data', chunk => logs.push(chunk.toString()));

  await waitForServer(child, url, logs);
  const preflightStatus = await waitForRunnerHealth(child, url, logs, false);
  assert.equal(preflightStatus.runner.mode, 'codex');
  assert.match(preflightStatus.runner.error, /ENOENT|no such file|definitely-missing-codex/i);

  const blockedAll = await api(url, '/api/organize/all', { method: 'POST', body: '{}' });
  assert.equal(blockedAll.response.status, 503, JSON.stringify(blockedAll.body));
  assert.match(blockedAll.body.error, /ENOENT|no such file|definitely-missing-codex/i);

  const sync = await api(url, '/api/notes/sync', { method: 'POST', body: '{}' });
  assert.equal(sync.response.status, 200, JSON.stringify(sync.body));

  const fixtureDb = new Database(path.join(appRoot, 'galpi.db'));
  const decisionId = fixtureDb.prepare(`
    INSERT INTO auto_save_decisions (
      decision, reason, question, answer_excerpt,
      note_filename, note_title, action, organize_queued
    ) VALUES ('save', 'semantic_signal', ?, ?, ?, ?, 'appended', 0)
  `).run(
    'runner 장애 복구 테스트',
    'pending 상태를 유지한다.',
    filename,
    'Organizer Regression',
  ).lastInsertRowid;
  fixtureDb.close();

  const queue = await api(url, '/api/organize/queue', { method: 'POST', body: '{}' });
  assert.equal(queue.response.status, 200, JSON.stringify(queue.body));
  assert.equal(queue.body.created, true);
  assert.equal(queue.body.notes.length, 1);
  assert.equal(queue.body.notes[0].filename, filename);

  const queueStateDb = new Database(path.join(appRoot, 'galpi.db'), { readonly: true });
  const queuedDecision = queueStateDb.prepare(
    'SELECT organize_queued AS organizeQueued FROM auto_save_decisions WHERE id = ?',
  ).get(decisionId);
  queueStateDb.close();
  assert.equal(queuedDecision.organizeQueued, 1);

  // 사전 점검이 실패한 runner는 백그라운드에서 모델 실행을 시도하지 않는다.
  await new Promise(resolve => setTimeout(resolve, 75));
  const queuedStatus = await api(url, '/api/organize/status');
  const queuedJob = queuedStatus.body.jobs.find(job => job.id === queue.body.jobId);
  assert.equal(queuedJob.status, 'pending');
  assert.equal(queuedJob.attemptCount, 0);

  // 명시적 수동 실행은 runner를 다시 시도하며, 실행 장애는 같은 job의 재시도 대기로 복구한다.
  const processResult = await api(url, '/api/organize/process', { method: 'POST', body: '{}' });
  assert.equal(processResult.response.status, 200, JSON.stringify(processResult.body));
  assert.equal(processResult.body.success, true);
  assert.equal(processResult.body.processed, true);
  assert.equal(processResult.body.status, 'pending');
  assert.equal(processResult.body.failed.length, 1);
  assert.match(processResult.body.error, /ENOENT|no such file|definitely-missing-codex/i);
  assert.match(processResult.body.failed[0].error, /ENOENT|no such file|definitely-missing-codex/i);

  const status = await api(url, '/api/organize/status');
  assert.equal(status.response.status, 200, JSON.stringify(status.body));
  assert.equal(status.body.pending, 0);
  assert.equal(status.body.queued, 1);
  assert.equal(status.body.needsManualCheck, 0);
  assert.equal(status.body.runner.ok, false);
  assert.match(status.body.runner.error, /ENOENT|no such file|definitely-missing-codex/i);

  const retryJob = status.body.jobs.find(job => job.id === queue.body.jobId);
  assert.equal(retryJob.status, 'pending');
  assert.equal(retryJob.attemptCount, 1);
  assert.match(retryJob.error, /ENOENT|no such file|definitely-missing-codex/i);

  const duplicateQueue = await api(url, '/api/organize/queue', { method: 'POST', body: '{}' });
  assert.equal(duplicateQueue.response.status, 200, JSON.stringify(duplicateQueue.body));
  assert.equal(duplicateQueue.body.created, false);

  const retryResult = await api(url, '/api/organize/process', { method: 'POST', body: '{}' });
  assert.equal(retryResult.response.status, 200, JSON.stringify(retryResult.body));
  assert.equal(retryResult.body.jobId, queue.body.jobId);
  assert.equal(retryResult.body.status, 'pending');

  const db = new Database(path.join(appRoot, 'galpi.db'), { readonly: true });
  const note = db.prepare('SELECT codex_status AS codexStatus FROM notes WHERE filename = ?').get(filename);
  const job = db.prepare('SELECT status, attempt_count AS attemptCount, error FROM codex_jobs WHERE id = ?')
    .get(queue.body.jobId);
  db.close();
  assert.equal(note.codexStatus, 'queued');
  assert.equal(job.status, 'pending');
  assert.equal(job.attemptCount, 2);
  assert.match(job.error, /ENOENT|no such file|definitely-missing-codex/i);

  assert.equal(await fs.readFile(path.join(vaultPath, filename), 'utf8'), originalNote);

  // 경로를 고친 뒤 재시작하면 보존된 같은 job을 startup worker가 자동으로 완료한다.
  await stopServer(child);
  child = null;
  await fs.writeFile(missingCodexBin, [
    `#!${process.execPath}`,
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const args = process.argv.slice(2);",
    "if (args[0] === '--version') { console.log('codex-cli recovery-test'); process.exit(0); }",
    "if (args[0] === 'login') { console.log('Logged in using test'); process.exit(0); }",
    "const root = args[args.indexOf('-C') + 1];",
    `const notePath = path.join(root, ${JSON.stringify(filename)});`,
    "let raw = fs.readFileSync(notePath, 'utf8');",
    "raw = raw.replace(/(?<=<!-- CODEX-SUMMARY-START -->)[\\s\\S]*?(?=<!-- CODEX-SUMMARY-END -->)/, '\\n실행기 복구 뒤 같은 job이 정리를 완료했다.\\n');",
    "raw = raw.replace(/(?<=<!-- CODEX-TAGS-START -->)[\\s\\S]*?(?=<!-- CODEX-TAGS-END -->)/, '\\n#갈피 #정리 #복구\\n');",
    "fs.writeFileSync(notePath, raw);",
    '',
  ].join('\n'));
  await fs.chmod(missingCodexBin, 0o755);

  const recoveryPort = await availablePort();
  const recoveryUrl = `http://127.0.0.1:${recoveryPort}`;
  child = spawn(process.execPath, ['server.js'], {
    cwd: appRoot,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: 'test-key',
      OPENAI_API_KEY: '',
      API_TOKEN,
      HOST: '127.0.0.1',
      PORT: String(recoveryPort),
      VAULT_PATH: vaultPath,
      BACKUP_DIR: path.join(appRoot, 'backups'),
      CODEX_AUTO_QUEUE_THRESHOLD: '5',
      CODEX_BIN: missingCodexBin,
      CODEX_RUNNER_MODE: 'codex',
      CODEX_RUNNER_TIMEOUT_MS: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => logs.push(chunk.toString()));
  child.stderr.on('data', chunk => logs.push(chunk.toString()));

  await waitForServer(child, recoveryUrl, logs);
  await waitForRunnerHealth(child, recoveryUrl, logs, true);
  await waitForJobStatus(child, recoveryUrl, logs, queue.body.jobId, 'processed');

  const recoveredDb = new Database(path.join(appRoot, 'galpi.db'), { readonly: true });
  const recoveredNote = recoveredDb.prepare(
    'SELECT codex_status AS codexStatus FROM notes WHERE filename = ?',
  ).get(filename);
  const recoveredJob = recoveredDb.prepare(
    'SELECT status, attempt_count AS attemptCount, error FROM codex_jobs WHERE id = ?',
  ).get(queue.body.jobId);
  recoveredDb.close();
  assert.equal(recoveredNote.codexStatus, 'processed');
  assert.deepEqual(recoveredJob, { status: 'processed', attemptCount: 3, error: null });
  assert.match(await fs.readFile(path.join(vaultPath, filename), 'utf8'), /#갈피 #정리 #복구/);
});

test('exit-zero runner with no edits fails output validation instead of marking the note processed', async t => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-organizer-noop-server-'));
  let child = null;
  t.after(async () => {
    if (child) await stopServer(child);
    await fs.rm(appRoot, { recursive: true, force: true });
  });

  const vaultPath = path.join(appRoot, 'vault');
  await fs.mkdir(vaultPath);
  await fs.copyFile(path.join(ROOT, 'server.js'), path.join(appRoot, 'server.js'));
  for (const name of ['lib', 'scripts', 'public', 'config', '.codex', 'node_modules']) {
    await fs.symlink(path.join(ROOT, name), path.join(appRoot, name), 'dir');
  }

  const filename = 'organizer-regression.md';
  const originalNote = pendingTopicNote();
  await fs.writeFile(path.join(vaultPath, filename), originalNote);
  const noopRunner = path.join(appRoot, 'noop-codex');
  await fs.writeFile(noopRunner, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "codex-cli test"; exit 0; fi',
    'if [ "$1" = "login" ]; then echo "Logged in using test"; exit 0; fi',
    'sleep 0.3',
    'exit 0',
    '',
  ].join('\n'));
  await fs.chmod(noopRunner, 0o755);

  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  const logs = [];
  child = spawn(process.execPath, ['server.js'], {
    cwd: appRoot,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: 'test-key',
      OPENAI_API_KEY: '',
      API_TOKEN,
      HOST: '127.0.0.1',
      PORT: String(port),
      VAULT_PATH: vaultPath,
      BACKUP_DIR: path.join(appRoot, 'backups'),
      CODEX_AUTO_QUEUE_THRESHOLD: '5',
      CODEX_BIN: noopRunner,
      CODEX_RUNNER_MODE: 'codex',
      CODEX_RUNNER_TIMEOUT_MS: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => logs.push(chunk.toString()));
  child.stderr.on('data', chunk => logs.push(chunk.toString()));

  await waitForServer(child, url, logs);
  const preflightStatus = await waitForRunnerHealth(child, url, logs, true);
  assert.equal(preflightStatus.runner.mode, 'codex');
  assert.equal(preflightStatus.runner.error, null);

  const sync = await api(url, '/api/notes/sync', { method: 'POST', body: '{}' });
  assert.equal(sync.response.status, 200, JSON.stringify(sync.body));

  // 백그라운드 worker 경합 없이 명시적 process 경로만 검증하도록 job을 DB에 직접 대기시킨다.
  const fixtureDb = new Database(path.join(appRoot, 'galpi.db'));
  const jobId = fixtureDb.prepare(
    "INSERT INTO codex_jobs (status, note_filenames_json) VALUES ('pending', ?)",
  ).run(JSON.stringify([filename])).lastInsertRowid;
  fixtureDb.prepare("UPDATE notes SET codex_status = 'queued' WHERE filename = ?").run(filename);
  fixtureDb.close();

  const processPromise = api(url, '/api/organize/process', { method: 'POST', body: '{}' });
  await waitForJobStatus(child, url, logs, jobId, 'running');
  const concurrentProcess = await api(url, '/api/organize/process', { method: 'POST', body: '{}' });
  assert.equal(concurrentProcess.response.status, 409, JSON.stringify(concurrentProcess.body));
  assert.match(concurrentProcess.body.error, /이미 Codex 정리가 실행 중/);

  const processResult = await processPromise;
  assert.equal(processResult.response.status, 200, JSON.stringify(processResult.body));
  assert.equal(processResult.body.success, true);
  assert.equal(processResult.body.processed, true);
  assert.equal(processResult.body.status, 'failed');
  assert.equal(processResult.body.failed.length, 1);
  assert.match(processResult.body.error, /CODEX 태그가 3~8개|placeholder/i);

  const status = await api(url, '/api/organize/status');
  assert.equal(status.response.status, 200, JSON.stringify(status.body));
  assert.equal(status.body.pending, 0);
  assert.equal(status.body.needsManualCheck, 1);
  assert.equal(status.body.runner.ok, true);

  const failedJob = status.body.jobs.find(job => job.id === jobId);
  assert.equal(failedJob.status, 'failed');
  assert.equal(failedJob.attemptCount, 1);
  assert.match(failedJob.error, /CODEX 태그가 3~8개|placeholder/i);

  const db = new Database(path.join(appRoot, 'galpi.db'), { readonly: true });
  const note = db.prepare('SELECT codex_status AS codexStatus FROM notes WHERE filename = ?').get(filename);
  const job = db.prepare('SELECT status, error FROM codex_jobs WHERE id = ?').get(jobId);
  db.close();
  assert.equal(note.codexStatus, 'needs_manual_check');
  assert.equal(job.status, 'failed');
  assert.match(job.error, /CODEX 태그가 3~8개|placeholder/i);
  assert.equal(await fs.readFile(path.join(vaultPath, filename), 'utf8'), originalNote);
});
