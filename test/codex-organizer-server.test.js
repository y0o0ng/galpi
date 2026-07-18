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

async function waitForDatabaseState(child, databasePath, logs, label, predicate) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`${label} 확인 전 서버가 종료됐습니다: ${logs.join('')}`);
    }
    const db = new Database(databasePath, { readonly: true });
    try {
      const result = predicate(db);
      if (result) return result;
    } finally {
      db.close();
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`${label} 확인 시간이 초과됐습니다: ${logs.join('')}`);
}

async function waitForFile(child, filepath, logs) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`파일 생성 확인 전 서버가 종료됐습니다: ${logs.join('')}`);
    }
    try {
      await fs.access(filepath);
      return;
    } catch { /* 생성 대기 */ }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`파일 생성 확인 시간이 초과됐습니다: ${filepath}\n${logs.join('')}`);
}

async function writeSlowSuccessfulCodexRunner(runnerPath, delayMs = 350) {
  await fs.writeFile(runnerPath, [
    `#!${process.execPath}`,
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const args = process.argv.slice(2);",
    "if (args[0] === '--version') { console.log('codex-cli mutation-test'); process.exit(0); }",
    "if (args[0] === 'login') { console.log('Logged in using test'); process.exit(0); }",
    "const root = args[args.indexOf('-C') + 1];",
    "const prompt = fs.readFileSync(0, 'utf8');",
    "const targetBlock = (prompt.split('대상 파일:\\n')[1] || '').split('\\n\\n목표:')[0];",
    "const targets = targetBlock.split('\\n').filter(line => line.startsWith('- ')).map(line => line.slice(2).trim());",
    "const notes = targets.map(filename => ({ filename, raw: fs.readFileSync(path.join(root, filename), 'utf8') }));",
    "fs.writeFileSync(process.env.RUNNER_SIGNAL_PATH, 'started');",
    `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${delayMs});`,
    "for (const note of notes) {",
    "  let raw = note.raw.replace(/(?<=<!-- CODEX-SUMMARY-START -->)[\\s\\S]*?(?=<!-- CODEX-SUMMARY-END -->)/, '\\n동시 vault 변경은 정리 snapshot이 끝난 뒤 직렬로 실행된다.\\n');",
    "  raw = raw.replace(/(?<=<!-- CODEX-TAGS-START -->)[\\s\\S]*?(?=<!-- CODEX-TAGS-END -->)/, '\\n#갈피 #정리 #직렬화\\n');",
    "  fs.writeFileSync(path.join(root, note.filename), raw);",
    "}",
    '',
  ].join('\n'));
  await fs.chmod(runnerPath, 0o755);
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

  const filenames = [
    'organizer-regression.md',
    'organizer-regression-2.md',
    'organizer-regression-3.md',
  ];
  const filename = filenames[0];
  const originalNote = pendingTopicNote();
  await Promise.all(filenames.map(name => fs.writeFile(path.join(vaultPath, name), originalNote)));

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
  assert.equal(queue.body.notes.length, 2);
  const firstJobFilenames = queue.body.notes.map(note => note.filename);
  assert.ok(firstJobFilenames.every(name => filenames.includes(name)));
  const tailFilename = filenames.find(name => !firstJobFilenames.includes(name));
  assert.ok(tailFilename);

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
  assert.equal(processResult.body.failed.length, 2);
  assert.match(processResult.body.error, /ENOENT|no such file|definitely-missing-codex/i);
  assert.match(processResult.body.failed[0].error, /ENOENT|no such file|definitely-missing-codex/i);

  const status = await api(url, '/api/organize/status');
  assert.equal(status.response.status, 200, JSON.stringify(status.body));
  assert.equal(status.body.autoQueueThreshold, 5);
  assert.equal(status.body.jobBatchSize, 2);
  assert.equal(status.body.pending, 1);
  assert.equal(status.body.queued, 2);
  assert.equal(status.body.needsManualCheck, 0);
  assert.equal(status.body.runner.ok, false);
  assert.match(status.body.runner.error, /ENOENT|no such file|definitely-missing-codex/i);

  const retryJob = status.body.jobs.find(job => job.id === queue.body.jobId);
  assert.equal(retryJob.status, 'pending');
  assert.equal(retryJob.attemptCount, 1);
  assert.match(retryJob.error, /ENOENT|no such file|definitely-missing-codex/i);

  const retryResult = await api(url, '/api/organize/process', { method: 'POST', body: '{}' });
  assert.equal(retryResult.response.status, 200, JSON.stringify(retryResult.body));
  assert.equal(retryResult.body.jobId, queue.body.jobId);
  assert.equal(retryResult.body.status, 'pending');

  const databasePath = path.join(appRoot, 'galpi.db');
  const db = new Database(databasePath, { readonly: true });
  const noteStatuses = db.prepare(
    `SELECT filename, codex_status AS codexStatus
     FROM notes
     WHERE filename IN (?, ?, ?)
     ORDER BY filename`,
  ).all(...filenames);
  const job = db.prepare('SELECT status, attempt_count AS attemptCount, error FROM codex_jobs WHERE id = ?')
    .get(queue.body.jobId);
  const jobCount = db.prepare('SELECT COUNT(*) AS count FROM codex_jobs').get().count;
  db.close();
  const statusByFilename = new Map(noteStatuses.map(note => [note.filename, note.codexStatus]));
  firstJobFilenames.forEach(name => assert.equal(statusByFilename.get(name), 'queued'));
  assert.equal(statusByFilename.get(tailFilename), 'pending');
  assert.equal(job.status, 'pending');
  assert.equal(job.attemptCount, 2);
  assert.match(job.error, /ENOENT|no such file|definitely-missing-codex/i);
  assert.equal(jobCount, 1);

  for (const name of filenames) {
    assert.equal(await fs.readFile(path.join(vaultPath, name), 'utf8'), originalNote);
  }

  // 경로를 고친 뒤에도 현재 job 완료와 다음 batch 저장 사이가 원자적이어야 한다.
  // 후속 job INSERT를 강제로 실패시켜 완료만 커밋되는 crash gap이 없는지 재현한다.
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
    "const prompt = fs.readFileSync(0, 'utf8');",
    "const targetBlock = (prompt.split('대상 파일:\\n')[1] || '').split('\\n\\n목표:')[0];",
    "const targets = targetBlock.split('\\n').filter(line => line.startsWith('- ')).map(line => line.slice(2).trim());",
    "if (targets.length === 0) throw new Error('target filenames missing');",
    "for (const filename of targets) {",
    "  const notePath = path.join(root, filename);",
    "  let raw = fs.readFileSync(notePath, 'utf8');",
    "  raw = raw.replace(/(?<=<!-- CODEX-SUMMARY-START -->)[\\s\\S]*?(?=<!-- CODEX-SUMMARY-END -->)/, '\\n실행기 복구 뒤 같은 job이 정리를 완료했다.\\n');",
    "  raw = raw.replace(/(?<=<!-- CODEX-TAGS-START -->)[\\s\\S]*?(?=<!-- CODEX-TAGS-END -->)/, '\\n#갈피 #정리 #복구\\n');",
    "  fs.writeFileSync(notePath, raw);",
    "}",
    '',
  ].join('\n'));
  await fs.chmod(missingCodexBin, 0o755);

  const failpointDb = new Database(databasePath);
  failpointDb.exec(`
    CREATE TRIGGER block_codex_tail_job
    BEFORE INSERT ON codex_jobs
    WHEN (SELECT COUNT(*) FROM codex_jobs) >= 1
    BEGIN
      SELECT RAISE(ABORT, 'test tail insert interruption');
    END
  `);
  failpointDb.close();

  const recoveryPort = await availablePort();
  const recoveryUrl = `http://127.0.0.1:${recoveryPort}`;
  const startRecoveryServer = () => {
    const server = spawn(process.execPath, ['server.js'], {
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
        CODEX_BIN: missingCodexBin,
        CODEX_RUNNER_MODE: 'codex',
        CODEX_RUNNER_TIMEOUT_MS: '1000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', chunk => logs.push(chunk.toString()));
    server.stderr.on('data', chunk => logs.push(chunk.toString()));
    return server;
  };

  child = startRecoveryServer();

  await waitForServer(child, recoveryUrl, logs);
  await waitForRunnerHealth(child, recoveryUrl, logs, true);
  const interruptedState = await waitForDatabaseState(
    child,
    databasePath,
    logs,
    '후속 batch 저장 중단 상태',
    currentDb => {
      const currentJob = currentDb.prepare(
        'SELECT status, attempt_count AS attemptCount FROM codex_jobs WHERE id = ?',
      ).get(queue.body.jobId);
      const currentNotes = currentDb.prepare(
        `SELECT filename, codex_status AS codexStatus
         FROM notes
         WHERE filename IN (?, ?, ?)`,
      ).all(...filenames);
      const currentStatuses = new Map(currentNotes.map(note => [note.filename, note.codexStatus]));
      const firstBatchProcessed = firstJobFilenames.every(name => currentStatuses.get(name) === 'processed');
      if (
        currentJob?.status === 'running' &&
        currentJob.attemptCount === 3 &&
        firstBatchProcessed &&
        currentStatuses.get(tailFilename) === 'pending'
      ) {
        return { currentJob, currentStatuses };
      }
      return null;
    },
  );
  assert.equal(interruptedState.currentJob.status, 'running');

  // 강제 중단 후 재시작하면 running job부터 되돌리고, 성공과 함께 다음 1개 job을 저장·실행한다.
  await stopServer(child);
  child = null;
  const resumeDb = new Database(databasePath);
  resumeDb.exec('DROP TRIGGER block_codex_tail_job');
  resumeDb.close();

  child = startRecoveryServer();
  await waitForServer(child, recoveryUrl, logs);
  await waitForRunnerHealth(child, recoveryUrl, logs, true);
  const recoveredState = await waitForDatabaseState(
    child,
    databasePath,
    logs,
    '배치 chain 복구 완료',
    currentDb => {
      const currentNotes = currentDb.prepare(
        `SELECT filename, codex_status AS codexStatus
         FROM notes
         WHERE filename IN (?, ?, ?)`,
      ).all(...filenames);
      const currentJobs = currentDb.prepare(
        `SELECT id, status, attempt_count AS attemptCount, error
         FROM codex_jobs
         ORDER BY id ASC`,
      ).all();
      if (
        currentNotes.length === filenames.length &&
        currentNotes.every(note => note.codexStatus === 'processed') &&
        currentJobs.length === 2 &&
        currentJobs.every(currentJob => currentJob.status === 'processed')
      ) {
        return { currentNotes, currentJobs };
      }
      return null;
    },
  );

  const recoveredJob = recoveredState.currentJobs.find(currentJob => currentJob.id === queue.body.jobId);
  const recoveredTailJob = recoveredState.currentJobs.find(currentJob => currentJob.id !== queue.body.jobId);
  assert.deepEqual(recoveredJob, {
    id: queue.body.jobId,
    status: 'processed',
    attemptCount: 4,
    error: null,
  });
  assert.ok(recoveredTailJob);
  assert.deepEqual(
    {
      status: recoveredTailJob.status,
      attemptCount: recoveredTailJob.attemptCount,
      error: recoveredTailJob.error,
    },
    { status: 'processed', attemptCount: 1, error: null },
  );
  for (const name of filenames) {
    assert.match(await fs.readFile(path.join(vaultPath, name), 'utf8'), /#갈피 #정리 #복구/);
  }
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

  const filenames = [
    'organizer-regression.md',
    'organizer-regression-2.md',
    'organizer-regression-3.md',
  ];
  const originalNote = pendingTopicNote();
  await Promise.all(filenames.map(filename => fs.writeFile(path.join(vaultPath, filename), originalNote)));
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

  // 첫 2개만 직접 queue한다. 검증 실패 뒤에도 남은 1개가 후속 job으로 이어져야 한다.
  const fixtureDb = new Database(path.join(appRoot, 'galpi.db'));
  const jobId = fixtureDb.prepare(
    "INSERT INTO codex_jobs (status, note_filenames_json) VALUES ('pending', ?)",
  ).run(JSON.stringify(filenames.slice(0, 2))).lastInsertRowid;
  filenames.slice(0, 2).forEach(filename => {
    fixtureDb.prepare("UPDATE notes SET codex_status = 'queued' WHERE filename = ?").run(filename);
  });
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
  assert.equal(processResult.body.failed.length, 2);
  assert.match(processResult.body.error, /CODEX 태그가 3~8개|placeholder/i);

  const completedChain = await waitForDatabaseState(
    child,
    path.join(appRoot, 'galpi.db'),
    logs,
    '검증 실패 후속 batch 완료',
    currentDb => {
      const notes = currentDb.prepare(
        `SELECT filename, codex_status AS codexStatus
         FROM notes
         WHERE filename IN (?, ?, ?)`,
      ).all(...filenames);
      const jobs = currentDb.prepare(
        `SELECT id, status, attempt_count AS attemptCount, error
         FROM codex_jobs
         ORDER BY id ASC`,
      ).all();
      if (
        notes.length === filenames.length &&
        notes.every(note => note.codexStatus === 'needs_manual_check') &&
        jobs.length === 2 &&
        jobs.every(job => job.status === 'failed')
      ) {
        return { notes, jobs };
      }
      return null;
    },
  );

  const status = await api(url, '/api/organize/status');
  assert.equal(status.response.status, 200, JSON.stringify(status.body));
  assert.equal(status.body.pending, 0);
  assert.equal(status.body.needsManualCheck, 3);
  assert.equal(status.body.runner.ok, true);

  const failedJob = status.body.jobs.find(job => job.id === jobId);
  assert.equal(failedJob.status, 'failed');
  assert.equal(failedJob.attemptCount, 1);
  assert.match(failedJob.error, /CODEX 태그가 3~8개|placeholder/i);
  const failedTailJob = completedChain.jobs.find(job => job.id !== jobId);
  assert.ok(failedTailJob);
  assert.equal(failedTailJob.attemptCount, 1);
  assert.match(failedTailJob.error, /CODEX 태그가 3~8개|placeholder/i);

  const db = new Database(path.join(appRoot, 'galpi.db'), { readonly: true });
  const job = db.prepare('SELECT status, error FROM codex_jobs WHERE id = ?').get(jobId);
  db.close();
  assert.equal(job.status, 'failed');
  assert.match(job.error, /CODEX 태그가 3~8개|placeholder/i);
  for (const filename of filenames) {
    assert.equal(await fs.readFile(path.join(vaultPath, filename), 'utf8'), originalNote);
  }
});

test('Codex serializes current mutations and skips an archived tail target', async t => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-organizer-mutation-server-'));
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

  const filenames = [
    'organizer-mutation.md',
    'organizer-mutation-2.md',
    'organizer-mutation-3.md',
  ];
  await Promise.all(filenames.map(filename => (
    fs.writeFile(path.join(vaultPath, filename), pendingTopicNote())
  )));
  const runnerSignalPath = path.join(appRoot, 'runner-started');
  const slowRunner = path.join(appRoot, 'slow-codex');
  await writeSlowSuccessfulCodexRunner(slowRunner);

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
      CODEX_BIN: slowRunner,
      CODEX_RUNNER_MODE: 'codex',
      CODEX_RUNNER_TIMEOUT_MS: '2000',
      RUNNER_SIGNAL_PATH: runnerSignalPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => logs.push(chunk.toString()));
  child.stderr.on('data', chunk => logs.push(chunk.toString()));

  await waitForServer(child, url, logs);
  await waitForRunnerHealth(child, url, logs, true);
  const sync = await api(url, '/api/notes/sync', { method: 'POST', body: '{}' });
  assert.equal(sync.response.status, 200, JSON.stringify(sync.body));
  const queue = await api(url, '/api/organize/queue', { method: 'POST', body: '{}' });
  assert.equal(queue.response.status, 200, JSON.stringify(queue.body));
  assert.equal(queue.body.created, true);
  assert.equal(queue.body.notes.length, 2);
  const firstJobFilenames = queue.body.notes.map(note => note.filename);
  const currentFilename = firstJobFilenames[0];
  const tailFilename = filenames.find(filename => !firstJobFilenames.includes(filename));
  assert.ok(tailFilename);

  await waitForFile(child, runnerSignalPath, logs);
  let currentArchiveSettled = false;
  let tailArchiveSettled = false;
  const currentArchivePromise = api(url, '/api/notes/archive', {
    method: 'POST',
    body: JSON.stringify({ filename: currentFilename }),
  }).then(result => {
    currentArchiveSettled = true;
    return result;
  });
  const tailArchivePromise = api(url, '/api/notes/archive', {
    method: 'POST',
    body: JSON.stringify({ filename: tailFilename }),
  }).then(result => {
    tailArchiveSettled = true;
    return result;
  });
  await new Promise(resolve => setTimeout(resolve, 75));
  assert.equal(currentArchiveSettled, false, '현재 파일 mutation은 Codex snapshot 처리 뒤까지 기다려야 한다.');
  assert.equal(tailArchiveSettled, false, '후속 파일 mutation도 현재 Codex job 뒤까지 기다려야 한다.');

  const [currentArchive, tailArchive] = await Promise.all([currentArchivePromise, tailArchivePromise]);
  assert.equal(currentArchive.response.status, 200, JSON.stringify(currentArchive.body));
  assert.equal(tailArchive.response.status, 200, JSON.stringify(tailArchive.body));

  const databasePath = path.join(appRoot, 'galpi.db');
  const completedState = await waitForDatabaseState(
    child,
    databasePath,
    logs,
    '보관된 tail 제외 완료',
    currentDb => {
      const notes = currentDb.prepare(
        `SELECT filename, archived, codex_status AS codexStatus
         FROM notes
         WHERE filename IN (?, ?, ?)`,
      ).all(...filenames);
      const jobs = currentDb.prepare(
        `SELECT id, status, attempt_count AS attemptCount, error
         FROM codex_jobs
         ORDER BY id ASC`,
      ).all();
      if (
        notes.length === filenames.length &&
        jobs.length === 2 &&
        jobs.every(job => job.status === 'processed')
      ) {
        return { notes, jobs };
      }
      return null;
    },
  );

  const archivedPath = path.join(vaultPath, '_archive', currentFilename);
  await assert.rejects(fs.access(path.join(vaultPath, currentFilename)), error => error?.code === 'ENOENT');
  await assert.rejects(fs.access(path.join(vaultPath, tailFilename)), error => error?.code === 'ENOENT');
  const archivedRaw = await fs.readFile(archivedPath, 'utf8');
  assert.match(archivedRaw, /동시 vault 변경은 정리 snapshot이 끝난 뒤 직렬로 실행된다/);

  const notesByFilename = new Map(completedState.notes.map(note => [note.filename, note]));
  assert.deepEqual(notesByFilename.get(currentFilename), {
    filename: currentFilename,
    archived: 1,
    codexStatus: 'processed',
  });
  assert.deepEqual(notesByFilename.get(tailFilename), {
    filename: tailFilename,
    archived: 1,
    codexStatus: 'processed',
  });
  const activeFilename = filenames.find(filename => (
    filename !== currentFilename && filename !== tailFilename
  ));
  assert.deepEqual(notesByFilename.get(activeFilename), {
    filename: activeFilename,
    archived: 0,
    codexStatus: 'processed',
  });

  const firstJob = completedState.jobs.find(job => job.id === queue.body.jobId);
  const skippedTailJob = completedState.jobs.find(job => job.id !== queue.body.jobId);
  assert.deepEqual(firstJob, {
    id: queue.body.jobId,
    status: 'processed',
    attemptCount: 1,
    error: null,
  });
  assert.ok(skippedTailJob);
  assert.equal(skippedTailJob.status, 'processed');
  assert.equal(skippedTailJob.attemptCount, 0);
  assert.equal(skippedTailJob.error, null);

  // 수동 process 응답도 all-stale job의 실제 skip 수를 노출한다.
  const skippedFixtureDb = new Database(databasePath);
  const skippedJobId = skippedFixtureDb.prepare(
    "INSERT INTO codex_jobs (status, note_filenames_json) VALUES ('pending', ?)",
  ).run(JSON.stringify([tailFilename])).lastInsertRowid;
  skippedFixtureDb.close();
  const skippedProcess = await api(url, '/api/organize/process', { method: 'POST', body: '{}' });
  assert.equal(skippedProcess.response.status, 200, JSON.stringify(skippedProcess.body));
  assert.equal(skippedProcess.body.jobId, skippedJobId);
  assert.equal(skippedProcess.body.status, 'processed');
  assert.equal(skippedProcess.body.skippedCount, 1);

  // active DB 행의 원본 하나가 사라져도 같은 job의 정상 노트는 독립적으로 처리한다.
  const missingFilename = 'organizer-missing.md';
  const healthyFilename = 'organizer-healthy.md';
  await Promise.all([
    fs.writeFile(path.join(vaultPath, missingFilename), pendingTopicNote()),
    fs.writeFile(path.join(vaultPath, healthyFilename), pendingTopicNote()),
  ]);
  const resync = await api(url, '/api/notes/sync', { method: 'POST', body: '{}' });
  assert.equal(resync.response.status, 200, JSON.stringify(resync.body));
  await fs.rm(path.join(vaultPath, missingFilename));

  const missingQueue = await api(url, '/api/organize/queue', { method: 'POST', body: '{}' });
  assert.equal(missingQueue.response.status, 200, JSON.stringify(missingQueue.body));
  assert.deepEqual(
    new Set(missingQueue.body.notes.map(note => note.filename)),
    new Set([missingFilename, healthyFilename]),
  );
  const isolatedMissing = await waitForDatabaseState(
    child,
    databasePath,
    logs,
    'missing 원본 단독 격리',
    currentDb => {
      const missing = currentDb.prepare(
        'SELECT codex_status AS codexStatus FROM notes WHERE filename = ?',
      ).get(missingFilename);
      const healthy = currentDb.prepare(
        'SELECT codex_status AS codexStatus FROM notes WHERE filename = ?',
      ).get(healthyFilename);
      const job = currentDb.prepare(
        'SELECT status, attempt_count AS attemptCount, error FROM codex_jobs WHERE id = ?',
      ).get(missingQueue.body.jobId);
      if (
        missing?.codexStatus === 'needs_manual_check' &&
        healthy?.codexStatus === 'processed' &&
        job?.status === 'failed'
      ) {
        return { missing, healthy, job };
      }
      return null;
    },
  );
  assert.equal(isolatedMissing.job.attemptCount, 1);
  assert.match(isolatedMissing.job.error, /원본 파일을 찾을 수 없습니다/);
  assert.match(
    await fs.readFile(path.join(vaultPath, healthyFilename), 'utf8'),
    /#갈피 #정리 #직렬화/,
  );
});

test('/organize all revalidates future batches after a queued archive', async t => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-organizer-all-mutation-server-'));
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

  const filenames = [
    'organizer-all-mutation.md',
    'organizer-all-mutation-2.md',
    'organizer-all-mutation-3.md',
    'organizer-all-mutation-4.md',
  ];
  await Promise.all(filenames.map(filename => (
    fs.writeFile(path.join(vaultPath, filename), pendingTopicNote())
  )));
  const runnerSignalPath = path.join(appRoot, 'runner-started');
  const slowRunner = path.join(appRoot, 'slow-codex');
  await writeSlowSuccessfulCodexRunner(slowRunner);

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
      CODEX_BIN: slowRunner,
      CODEX_RUNNER_MODE: 'codex',
      CODEX_RUNNER_TIMEOUT_MS: '2000',
      RUNNER_SIGNAL_PATH: runnerSignalPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => logs.push(chunk.toString()));
  child.stderr.on('data', chunk => logs.push(chunk.toString()));

  await waitForServer(child, url, logs);
  await waitForRunnerHealth(child, url, logs, true);
  const sync = await api(url, '/api/notes/sync', { method: 'POST', body: '{}' });
  assert.equal(sync.response.status, 200, JSON.stringify(sync.body));

  const databasePath = path.join(appRoot, 'galpi.db');
  const orderingDb = new Database(databasePath, { readonly: true });
  const orderedFilenames = orderingDb.prepare(
    `SELECT filename
     FROM notes
     WHERE archived = 0
     ORDER BY created_at ASC, id ASC`,
  ).all().map(note => note.filename);
  orderingDb.close();
  const futureFilename = orderedFilenames[2];
  const missingFilename = orderedFilenames[3];
  assert.ok(futureFilename);
  assert.ok(missingFilename);
  await fs.rm(path.join(vaultPath, missingFilename));

  const organizeAllPromise = api(url, '/api/organize/all', { method: 'POST', body: '{}' });
  await waitForFile(child, runnerSignalPath, logs);
  let archiveSettled = false;
  const archivePromise = api(url, '/api/notes/archive', {
    method: 'POST',
    body: JSON.stringify({ filename: futureFilename }),
  }).then(result => {
    archiveSettled = true;
    return result;
  });
  await new Promise(resolve => setTimeout(resolve, 75));
  assert.equal(archiveSettled, false, '미래 batch archive는 현재 batch 뒤까지 기다려야 한다.');

  const [organizeAll, archive] = await Promise.all([organizeAllPromise, archivePromise]);
  assert.equal(organizeAll.response.status, 200, JSON.stringify(organizeAll.body));
  assert.equal(archive.response.status, 200, JSON.stringify(archive.body));
  assert.equal(organizeAll.body.processedCount, 2);
  assert.equal(organizeAll.body.failedCount, 1);
  assert.equal(organizeAll.body.batches.length, 2);
  assert.equal(organizeAll.body.batches[0].status, 'processed');
  assert.equal(organizeAll.body.batches[1].status, 'failed');
  assert.equal(organizeAll.body.batches[1].failedCount, 1);
  assert.equal(organizeAll.body.batches[1].skippedCount, 1);
  assert.match(organizeAll.body.failed[0].error, /원본 파일을 찾을 수 없습니다/);

  await assert.rejects(fs.access(path.join(vaultPath, futureFilename)), error => error?.code === 'ENOENT');
  await fs.access(path.join(vaultPath, '_archive', futureFilename));
  const db = new Database(databasePath, { readonly: true });
  const notes = db.prepare(
    `SELECT filename, archived, codex_status AS codexStatus
     FROM notes
     WHERE filename IN (?, ?, ?, ?)`,
  ).all(...filenames);
  db.close();
  const futureNote = notes.find(note => note.filename === futureFilename);
  assert.deepEqual(futureNote, {
    filename: futureFilename,
    archived: 1,
    codexStatus: 'processed',
  });
  const missingNote = notes.find(note => note.filename === missingFilename);
  assert.deepEqual(missingNote, {
    filename: missingFilename,
    archived: 0,
    codexStatus: 'needs_manual_check',
  });
  assert.equal(notes.filter(note => note.codexStatus === 'needs_manual_check').length, 1);
});
