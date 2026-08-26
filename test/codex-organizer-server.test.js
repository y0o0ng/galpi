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

function organizedTopicNote(summary = 'Codex 정리 결과가 허용 구역 안에 안전하게 반영됐다.') {
  return pendingTopicNote()
    .replace('- Codex 정리 대기: 테스트 항목이 쌓여 있다.', summary)
    .replace(
      '<!-- CODEX-TAGS-START -->\n<!-- CODEX-TAGS-END -->',
      '<!-- CODEX-TAGS-START -->\n#갈피 #정리 #안전성\n<!-- CODEX-TAGS-END -->',
    );
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

// 상한이 10초다. 실제 서버를 띄우는 테스트 파일이 8개라 node --test가 병렬로
// 돌리면 기동이 느려지고, 짧은 상한은 부하 때문에 빨개진다. 서버가 먼저 죽으면
// 아래 exitCode 검사가 즉시 잡으므로 상한을 늘려도 실패가 늦게 드러나지 않는다.
async function waitForServer(child, url, logs) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
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

// 기동 대기와 같은 이유로 넉넉하다. 상한이 1초였는데 runner 사전 점검은 실제
// 프로세스를 띄우므로 부하가 걸리면 그 안에 안 끝난다.
async function waitForRunnerHealth(child, url, logs, expectedOk) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
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
  for (let attempt = 0; attempt < 400; attempt += 1) {
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
  for (let attempt = 0; attempt < 400; attempt += 1) {
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
  for (let attempt = 0; attempt < 400; attempt += 1) {
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

async function writeLinkedCodexRunner(runnerPath) {
  await fs.writeFile(runnerPath, [
    `#!${process.execPath}`,
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const args = process.argv.slice(2);",
    "if (args[0] === '--version') { console.log('codex-cli atomic-finalize-test'); process.exit(0); }",
    "if (args[0] === 'login') { console.log('Logged in using test'); process.exit(0); }",
    "const root = args[args.indexOf('-C') + 1];",
    "const prompt = fs.readFileSync(0, 'utf8');",
    "const targetBlock = (prompt.split('대상 파일:\\n')[1] || '').split('\\n\\n목표:')[0];",
    "const targets = targetBlock.split('\\n').filter(line => line.startsWith('- ')).map(line => line.slice(2).trim());",
    "for (let index = 0; index < targets.length; index += 1) {",
    "  const filename = targets[index];",
    "  const other = targets[(index + 1) % targets.length];",
    "  const filepath = path.join(root, filename);",
    "  let raw = fs.readFileSync(filepath, 'utf8');",
    "  raw = raw.replace(/(?<=<!-- CODEX-SUMMARY-START -->)[\\s\\S]*?(?=<!-- CODEX-SUMMARY-END -->)/, '\\n최종 파일과 파생 링크, job 종료는 하나의 DB transaction으로 확정된다.\\n');",
    "  raw = raw.replace(/(?<=<!-- CODEX-TAGS-START -->)[\\s\\S]*?(?=<!-- CODEX-TAGS-END -->)/, '\\n#갈피 #정리 #원자성\\n');",
    "  const otherBase = other.replace(/\\.md$/, '');",
    "  const links = `\\n**[회귀 검증]**\\n- 80 [[${otherBase}|Organizer Regression]] — 원자적 job 종료 검증\\n`;",
    "  raw = raw.replace(/(?<=<!-- CODEX-LINKS-START -->)[\\s\\S]*?(?=<!-- CODEX-LINKS-END -->)/, links);",
    "  fs.writeFileSync(filepath, raw);",
    "}",
    '',
  ].join('\n'));
  await fs.chmod(runnerPath, 0o755);
}

async function writeUnsafeCodexRunner(runnerPath, delayMs = 350) {
  await fs.writeFile(runnerPath, [
    `#!${process.execPath}`,
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const args = process.argv.slice(2);",
    "if (args[0] === '--version') { console.log('codex-cli unsafe-restore-test'); process.exit(0); }",
    "if (args[0] === 'login') { console.log('Logged in using test'); process.exit(0); }",
    "const root = args[args.indexOf('-C') + 1];",
    "const prompt = fs.readFileSync(0, 'utf8');",
    "const targetBlock = (prompt.split('대상 파일:\\n')[1] || '').split('\\n\\n목표:')[0];",
    "const targets = targetBlock.split('\\n').filter(line => line.startsWith('- ')).map(line => line.slice(2).trim());",
    "for (const filename of targets) {",
    "  const filepath = path.join(root, filename);",
    "  const raw = fs.readFileSync(filepath, 'utf8');",
    "  fs.writeFileSync(filepath, raw.replace('**Q:**', '**Q:** [UNSAFE OUTSIDE CODEX]'));",
    "}",
    "fs.writeFileSync(process.env.RUNNER_SIGNAL_PATH, 'mutated');",
    `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${delayMs});`,
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
  fixtureDb.prepare(`
    UPDATE app_settings
    SET value_json = '"gpt-5.6-sol"', version = version + 1
    WHERE key = 'codex.general_model'
  `).run();
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
  assert.equal(queuedJob.modelSelection, 'gpt-5.6-sol');
  assert.equal(queuedJob.modelId, 'gpt-5.6-sol');
  assert.equal(queuedJob.modelCatalogGeneration, 0);

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

  // 경로를 고친 뒤에도 최종 edge·노트 상태·현재 job 완료·다음 batch 저장이 원자적이어야 한다.
  // 후속 job INSERT를 강제로 실패시켜 최종 노트 상태까지 함께 rollback되는지 재현한다.
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
      const firstBatchRolledBack = firstJobFilenames.every(
        name => currentStatuses.get(name) === 'needs_manual_check',
      );
      if (
        currentJob?.status === 'running' &&
        currentJob.attemptCount === 3 &&
        firstBatchRolledBack &&
        currentStatuses.get(tailFilename) === 'pending'
      ) {
        return { currentJob, currentStatuses };
      }
      return null;
    },
  );
  assert.equal(interruptedState.currentJob.status, 'running');
  for (const name of firstJobFilenames) {
    assert.match(await fs.readFile(path.join(vaultPath, name), 'utf8'), /Codex 정리 대기/);
  }

  // 강제 중단 후 재시작하면 안전을 추정해 재실행하지 않고 running job 대상 전체를 격리한다.
  await stopServer(child);
  child = null;
  const resumeDb = new Database(databasePath);
  resumeDb.exec('DROP TRIGGER block_codex_tail_job');
  resumeDb.close();

  child = startRecoveryServer();
  await waitForServer(child, recoveryUrl, logs);
  await waitForRunnerHealth(child, recoveryUrl, logs, true);
  const quarantinedState = await waitForDatabaseState(
    child,
    databasePath,
    logs,
    '중단 job 수동 복구 격리',
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
      const currentStatuses = new Map(currentNotes.map(note => [note.filename, note.codexStatus]));
      const interruptedJob = currentJobs.find(currentJob => currentJob.id === queue.body.jobId);
      if (
        currentNotes.length === filenames.length &&
        firstJobFilenames.every(name => currentStatuses.get(name) === 'recovery_required') &&
        currentStatuses.get(tailFilename) === 'pending' &&
        currentJobs.length === 1 &&
        interruptedJob?.status === 'failed'
      ) {
        return { currentNotes, currentJobs };
      }
      return null;
    },
  );

  const recoveredJob = quarantinedState.currentJobs[0];
  assert.deepEqual(recoveredJob, {
    id: queue.body.jobId,
    status: 'failed',
    attemptCount: 3,
    error: '서버 중단으로 변경 검증을 완료하지 못했습니다. 수동 복구가 필요합니다.',
  });

  const blockedProcess = await api(recoveryUrl, '/api/organize/process', { method: 'POST', body: '{}' });
  assert.equal(blockedProcess.response.status, 409, JSON.stringify(blockedProcess.body));
  const notifications = await api(recoveryUrl, '/api/notifications');
  const recoveryNotifications = notifications.body.notifications.filter(item => item.recoveryRequired);
  assert.equal(recoveryNotifications.length, firstJobFilenames.length);
  for (const notification of recoveryNotifications) {
    const approval = await api(
      recoveryUrl,
      `/api/notifications/${notification.id}/approve`,
      { method: 'POST', body: '{}' },
    );
    assert.equal(approval.response.status, 200, JSON.stringify(approval.body));
  }

  const tailQueue = await api(recoveryUrl, '/api/organize/queue', { method: 'POST', body: '{}' });
  assert.equal(tailQueue.response.status, 200, JSON.stringify(tailQueue.body));
  assert.deepEqual(tailQueue.body.notes.map(note => note.filename), [tailFilename]);
  await waitForJobStatus(child, recoveryUrl, logs, tailQueue.body.jobId, 'processed');
  for (const name of firstJobFilenames) {
    assert.match(await fs.readFile(path.join(vaultPath, name), 'utf8'), /Codex 정리 대기/);
  }
  assert.match(await fs.readFile(path.join(vaultPath, tailFilename), 'utf8'), /#갈피 #정리 #복구/);
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
  let searchSettled = false;
  const searchPromise = api(url, '/api/vault/search?q=Organizer').then(result => {
    searchSettled = true;
    return result;
  });
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
  assert.equal(searchSettled, true, 'AI note reads must not wait for the Codex mutation queue.');
  assert.equal(currentArchiveSettled, false, '현재 파일 mutation은 Codex snapshot 처리 뒤까지 기다려야 한다.');
  assert.equal(tailArchiveSettled, false, '후속 파일 mutation도 현재 Codex job 뒤까지 기다려야 한다.');

  const [concurrentSearch, currentArchive, tailArchive] = await Promise.all([
    searchPromise,
    currentArchivePromise,
    tailArchivePromise,
  ]);
  assert.equal(concurrentSearch.response.status, 200, JSON.stringify(concurrentSearch.body));
  assert.ok(concurrentSearch.body.results.some(note => note.filename === tailFilename));
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

  // 파일 접근 권한 같은 저장소 장애는 노트를 manual로 소진하지 않고 같은 job을 보존한다.
  const unreadableFilename = 'organizer-unreadable.md';
  const retryHealthyFilename = 'organizer-retry-healthy.md';
  await Promise.all([
    fs.writeFile(path.join(vaultPath, unreadableFilename), pendingTopicNote()),
    fs.writeFile(path.join(vaultPath, retryHealthyFilename), pendingTopicNote()),
  ]);
  const permissionSync = await api(url, '/api/notes/sync', { method: 'POST', body: '{}' });
  assert.equal(permissionSync.response.status, 200, JSON.stringify(permissionSync.body));
  await fs.chmod(path.join(vaultPath, unreadableFilename), 0o000);

  const permissionQueue = await api(url, '/api/organize/queue', { method: 'POST', body: '{}' });
  assert.equal(permissionQueue.response.status, 200, JSON.stringify(permissionQueue.body));
  const permissionBlocked = await waitForDatabaseState(
    child,
    databasePath,
    logs,
    '파일 접근 장애 job 보존',
    currentDb => {
      const job = currentDb.prepare(
        'SELECT status, attempt_count AS attemptCount, error FROM codex_jobs WHERE id = ?',
      ).get(permissionQueue.body.jobId);
      const notes = currentDb.prepare(
        `SELECT filename, codex_status AS codexStatus
         FROM notes
         WHERE filename IN (?, ?)`,
      ).all(unreadableFilename, retryHealthyFilename);
      if (
        job?.status === 'pending' &&
        job.attemptCount === 1 &&
        notes.length === 2 &&
        notes.every(note => note.codexStatus === 'queued')
      ) {
        return { job, notes };
      }
      return null;
    },
  );
  assert.match(permissionBlocked.job.error, /저장소에 접근할 수 없습니다 \(EACCES\)/);
  await new Promise(resolve => setTimeout(resolve, 100));
  const retryGuardDb = new Database(databasePath, { readonly: true });
  const guardedAttemptCount = retryGuardDb.prepare(
    'SELECT attempt_count AS attemptCount FROM codex_jobs WHERE id = ?',
  ).get(permissionQueue.body.jobId).attemptCount;
  retryGuardDb.close();
  assert.equal(guardedAttemptCount, 1, '공용 저장소 장애를 자동으로 무한 재시도하면 안 된다.');

  await fs.chmod(path.join(vaultPath, unreadableFilename), 0o644);
  const permissionRetry = await api(url, '/api/organize/process', { method: 'POST', body: '{}' });
  assert.equal(permissionRetry.response.status, 200, JSON.stringify(permissionRetry.body));
  assert.equal(permissionRetry.body.status, 'processed');
  const permissionRecovered = await waitForDatabaseState(
    child,
    databasePath,
    logs,
    '파일 접근 장애 복구',
    currentDb => {
      const job = currentDb.prepare(
        'SELECT status, attempt_count AS attemptCount FROM codex_jobs WHERE id = ?',
      ).get(permissionQueue.body.jobId);
      return job?.status === 'processed' && job.attemptCount === 2 ? job : null;
    },
  );
  assert.equal(permissionRecovered.attemptCount, 2);

  // vault 루트 자체가 사라져도 같은 pending job을 한 번만 시도하고 복구 후 재개한다.
  const storageFilename = 'organizer-storage-recovery.md';
  await fs.writeFile(path.join(vaultPath, storageFilename), pendingTopicNote());
  const storageSync = await api(url, '/api/notes/sync', { method: 'POST', body: '{}' });
  assert.equal(storageSync.response.status, 200, JSON.stringify(storageSync.body));
  const storageFixtureDb = new Database(databasePath);
  const storageJobId = storageFixtureDb.prepare(
    "INSERT INTO codex_jobs (status, note_filenames_json) VALUES ('pending', ?)",
  ).run(JSON.stringify([storageFilename])).lastInsertRowid;
  storageFixtureDb.prepare(
    "UPDATE notes SET codex_status = 'queued' WHERE filename = ?",
  ).run(storageFilename);
  storageFixtureDb.close();

  await new Promise(resolve => setTimeout(resolve, 100));
  const offlineVaultPath = `${vaultPath}-offline`;
  await fs.rename(vaultPath, offlineVaultPath);
  let storageBlocked;
  try {
    storageBlocked = await api(url, '/api/organize/process', { method: 'POST', body: '{}' });
  } finally {
    await fs.rename(offlineVaultPath, vaultPath);
  }
  assert.equal(storageBlocked.response.status, 200, JSON.stringify(storageBlocked.body));
  assert.equal(storageBlocked.body.status, 'pending');
  assert.match(storageBlocked.body.error, /vault 저장소를 사용할 수 없습니다 \(ENOENT\)/);
  await new Promise(resolve => setTimeout(resolve, 100));
  const storageGuardDb = new Database(databasePath, { readonly: true });
  const storageGuard = storageGuardDb.prepare(
    `SELECT status, attempt_count AS attemptCount, error
     FROM codex_jobs
     WHERE id = ?`,
  ).get(storageJobId);
  storageGuardDb.close();
  assert.equal(storageGuard.status, 'pending');
  assert.equal(storageGuard.attemptCount, 1);

  const storageRetry = await api(url, '/api/organize/process', { method: 'POST', body: '{}' });
  assert.equal(storageRetry.response.status, 200, JSON.stringify(storageRetry.body));
  assert.equal(storageRetry.body.status, 'processed');
  const storageRecoveredDb = new Database(databasePath, { readonly: true });
  const storageRecovered = storageRecoveredDb.prepare(
    'SELECT status, attempt_count AS attemptCount, error FROM codex_jobs WHERE id = ?',
  ).get(storageJobId);
  storageRecoveredDb.close();
  assert.deepEqual(storageRecovered, { status: 'processed', attemptCount: 2, error: null });

  // preflight 뒤 runner가 파일 권한 오류로 실패해도 snapshot 복원 성공 시 같은 job을 보존한다.
  const midrunFilenames = [
    'organizer-midrun-storage.md',
    'organizer-midrun-storage-2.md',
  ];
  await Promise.all(midrunFilenames.map(filename => (
    fs.writeFile(path.join(vaultPath, filename), pendingTopicNote())
  )));
  const midrunSync = await api(url, '/api/notes/sync', { method: 'POST', body: '{}' });
  assert.equal(midrunSync.response.status, 200, JSON.stringify(midrunSync.body));
  await fs.rm(runnerSignalPath, { force: true });
  const midrunQueue = await api(url, '/api/organize/queue', { method: 'POST', body: '{}' });
  assert.equal(midrunQueue.response.status, 200, JSON.stringify(midrunQueue.body));
  assert.deepEqual(
    new Set(midrunQueue.body.notes.map(note => note.filename)),
    new Set(midrunFilenames),
  );
  await waitForFile(child, runnerSignalPath, logs);

  let midrunBlocked;
  await Promise.all(midrunFilenames.map(filename => (
    fs.chmod(path.join(vaultPath, filename), 0o000)
  )));
  try {
    midrunBlocked = await waitForDatabaseState(
      child,
      databasePath,
      logs,
      '실행 중 저장소 장애 job 보존',
      currentDb => {
        const job = currentDb.prepare(
          'SELECT status, attempt_count AS attemptCount, error FROM codex_jobs WHERE id = ?',
        ).get(midrunQueue.body.jobId);
        const notes = currentDb.prepare(
          `SELECT filename, codex_status AS codexStatus
           FROM notes
           WHERE filename IN (?, ?)`,
        ).all(...midrunFilenames);
        if (
          job?.status === 'pending' &&
          job.attemptCount === 1 &&
          notes.length === 2 &&
          notes.every(note => note.codexStatus === 'queued')
        ) {
          return { job, notes };
        }
        return null;
      },
    );
  } finally {
    await Promise.all(midrunFilenames.map(async filename => {
      try { await fs.chmod(path.join(vaultPath, filename), 0o644); } catch { /* test cleanup */ }
    }));
  }
  assert.match(midrunBlocked.job.error, /EACCES|permission denied/i);
  assert.doesNotMatch(midrunBlocked.job.error, new RegExp(vaultPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  midrunFilenames.forEach(filename => assert.doesNotMatch(midrunBlocked.job.error, new RegExp(filename)));
  const midrunStatus = await api(url, '/api/organize/status');
  assert.equal(midrunStatus.response.status, 200, JSON.stringify(midrunStatus.body));
  assert.ok(midrunStatus.body.runner.error);
  assert.doesNotMatch(midrunStatus.body.runner.error, new RegExp(vaultPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  midrunFilenames.forEach(filename => (
    assert.doesNotMatch(midrunStatus.body.runner.error, new RegExp(filename))
  ));
  await new Promise(resolve => setTimeout(resolve, 100));
  const midrunGuardDb = new Database(databasePath, { readonly: true });
  const midrunAttemptCount = midrunGuardDb.prepare(
    'SELECT attempt_count AS attemptCount FROM codex_jobs WHERE id = ?',
  ).get(midrunQueue.body.jobId).attemptCount;
  midrunGuardDb.close();
  assert.equal(midrunAttemptCount, 1, '실행 중 저장소 장애도 자동 반복하면 안 된다.');

  const midrunRetry = await api(url, '/api/organize/process', { method: 'POST', body: '{}' });
  assert.equal(midrunRetry.response.status, 200, JSON.stringify(midrunRetry.body));
  assert.equal(midrunRetry.body.status, 'processed');
  const midrunRecoveredDb = new Database(databasePath, { readonly: true });
  const midrunRecovered = midrunRecoveredDb.prepare(
    'SELECT status, attempt_count AS attemptCount, error FROM codex_jobs WHERE id = ?',
  ).get(midrunQueue.body.jobId);
  midrunRecoveredDb.close();
  assert.deepEqual(midrunRecovered, { status: 'processed', attemptCount: 2, error: null });

  // 금지 구역 변경 뒤 root 교체로 snapshot 복원이 불가능하면 자동 재시도를 금지한다.
  const unsafeFilenames = [
    'organizer-recovery-required.md',
    'organizer-recovery-required-2.md',
  ];
  await Promise.all(unsafeFilenames.map(filename => (
    fs.writeFile(path.join(vaultPath, filename), pendingTopicNote())
  )));
  const unsafeSync = await api(url, '/api/notes/sync', { method: 'POST', body: '{}' });
  assert.equal(unsafeSync.response.status, 200, JSON.stringify(unsafeSync.body));
  await writeUnsafeCodexRunner(slowRunner);
  await fs.rm(runnerSignalPath, { force: true });
  const unsafeQueue = await api(url, '/api/organize/queue', { method: 'POST', body: '{}' });
  assert.equal(unsafeQueue.response.status, 200, JSON.stringify(unsafeQueue.body));
  assert.deepEqual(
    new Set(unsafeQueue.body.notes.map(note => note.filename)),
    new Set(unsafeFilenames),
  );
  await waitForFile(child, runnerSignalPath, logs);

  const replacedVaultPath = `${vaultPath}-replaced`;
  await fs.rename(vaultPath, replacedVaultPath);
  await fs.mkdir(vaultPath);
  await Promise.all(unsafeFilenames.map(filename => (
    fs.writeFile(path.join(vaultPath, filename), pendingTopicNote())
  )));
  let unsafeBlocked;
  try {
    unsafeBlocked = await waitForDatabaseState(
      child,
      databasePath,
      logs,
      'snapshot 수동 복구 격리',
      currentDb => {
        const job = currentDb.prepare(
          'SELECT status, attempt_count AS attemptCount, error FROM codex_jobs WHERE id = ?',
        ).get(unsafeQueue.body.jobId);
        const notes = currentDb.prepare(
          `SELECT filename, codex_status AS codexStatus
           FROM notes
           WHERE filename IN (?, ?)`,
        ).all(...unsafeFilenames);
        if (
          job?.status === 'failed' &&
          job.attemptCount === 1 &&
          notes.length === 2 &&
          notes.every(note => note.codexStatus === 'recovery_required')
        ) {
          return { job, notes };
        }
        return null;
      },
    );
  } finally {
    await fs.rm(vaultPath, { recursive: true, force: true });
    await fs.rename(replacedVaultPath, vaultPath);
  }
  assert.match(unsafeBlocked.job.error, /snapshot 자동 복구.*ESTALE.*수동 복구/);
  assert.doesNotMatch(unsafeBlocked.job.error, new RegExp(vaultPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  unsafeFilenames.forEach(filename => {
    assert.doesNotMatch(unsafeBlocked.job.error, new RegExp(filename));
  });
  const unsafeRaw = await fs.readFile(path.join(vaultPath, unsafeFilenames[0]), 'utf8');
  assert.match(unsafeRaw, /UNSAFE OUTSIDE CODEX/);

  const blockedRetry = await api(url, '/api/organize/process', { method: 'POST', body: '{}' });
  assert.equal(blockedRetry.response.status, 409, JSON.stringify(blockedRetry.body));
  const blockedQueue = await api(url, '/api/organize/queue', { method: 'POST', body: '{}' });
  assert.equal(blockedQueue.response.status, 409, JSON.stringify(blockedQueue.body));
  const blockedAll = await api(url, '/api/organize/all', { method: 'POST', body: '{}' });
  assert.equal(blockedAll.response.status, 409, JSON.stringify(blockedAll.body));

  // 일반 UI 직접 열람은 복구를 위해 유지하지만 AI/MCP용 목록·읽기와 검색에서는 격리한다.
  const directList = await api(url, '/api/vault/notes?limit=100');
  assert.equal(
    directList.body.notes.filter(note => unsafeFilenames.includes(note.filename)).length,
    unsafeFilenames.length,
  );
  const aiList = await api(url, '/api/vault/notes?limit=100&forAi=true');
  assert.equal(aiList.body.notes.some(note => unsafeFilenames.includes(note.filename)), false);
  const aiLimitedList = await api(url, '/api/vault/notes?limit=1&forAi=true');
  assert.equal(aiLimitedList.body.notes.length, 1, 'AI 목록은 격리 필터 뒤에 limit을 적용해야 한다.');
  assert.equal(unsafeFilenames.includes(aiLimitedList.body.notes[0].filename), false);
  const directRead = await api(url, `/api/vault/note/${unsafeFilenames[0]}`);
  assert.match(directRead.body.note.content, /UNSAFE OUTSIDE CODEX/);
  const aiRead = await api(url, `/api/vault/note/${unsafeFilenames[0]}?forAi=true`);
  assert.equal(aiRead.response.status, 409, JSON.stringify(aiRead.body));
  const search = await api(url, '/api/vault/search?q=UNSAFE%20OUTSIDE%20CODEX');
  assert.equal(search.body.results.some(note => unsafeFilenames.includes(note.filename)), false);
  const blockedArchive = await api(url, '/api/notes/archive', {
    method: 'POST',
    body: JSON.stringify({ filename: unsafeFilenames[0] }),
  });
  assert.equal(blockedArchive.response.status, 500, JSON.stringify(blockedArchive.body));

  const unsafeSyncAgain = await api(url, '/api/notes/sync', { method: 'POST', body: '{}' });
  assert.equal(unsafeSyncAgain.response.status, 200, JSON.stringify(unsafeSyncAgain.body));
  const unsafeGuardDb = new Database(databasePath, { readonly: true });
  const unsafeStatuses = unsafeGuardDb.prepare(
    `SELECT filename, codex_status AS codexStatus
     FROM notes
     WHERE filename IN (?, ?)`,
  ).all(...unsafeFilenames);
  unsafeGuardDb.close();
  assert.equal(unsafeStatuses.every(note => note.codexStatus === 'recovery_required'), true);
  assert.match(
    await fs.readFile(path.join(vaultPath, unsafeFilenames[0]), 'utf8'),
    /UNSAFE OUTSIDE CODEX/,
  );

  // 복구 승인은 선택 노트 하나만 sync하고, 그 사이 생긴 관련 없는 수동 편집은 흡수하지 않는다.
  const unrelatedFilename = 'organizer-recovery-unrelated.md';
  const unrelatedPath = path.join(vaultPath, unrelatedFilename);
  await fs.writeFile(unrelatedPath, pendingTopicNote());
  const unrelatedSync = await api(url, '/api/notes/sync', { method: 'POST', body: '{}' });
  assert.equal(unrelatedSync.response.status, 200, JSON.stringify(unrelatedSync.body));
  const unrelatedBeforeDb = new Database(databasePath, { readonly: true });
  const unrelatedHashBefore = unrelatedBeforeDb.prepare(
    'SELECT content_sha256 AS contentSha256 FROM notes WHERE filename = ?',
  ).get(unrelatedFilename).contentSha256;
  unrelatedBeforeDb.close();
  await fs.writeFile(
    unrelatedPath,
    pendingTopicNote().replace('같은 pending job의 queued 상태로 복구해야 한다.', '선택 복구 승인과 무관한 수동 편집이다.'),
  );

  const unsafeNotifications = await api(url, '/api/notifications');
  const recoveryItems = unsafeNotifications.body.notifications.filter(item => (
    item.recoveryRequired && unsafeFilenames.includes(item.note?.filename)
  ));
  assert.equal(recoveryItems.length, unsafeFilenames.length);
  const ignoredRecovery = await api(
    url,
    `/api/notifications/${recoveryItems[0].id}/ignore`,
    { method: 'POST', body: '{}' },
  );
  assert.equal(ignoredRecovery.response.status, 400, JSON.stringify(ignoredRecovery.body));

  await Promise.all(unsafeFilenames.map(filename => (
    fs.writeFile(path.join(vaultPath, filename), pendingTopicNote())
  )));
  for (const item of recoveryItems) {
    const approval = await api(url, `/api/notifications/${item.id}/approve`, {
      method: 'POST',
      body: '{}',
    });
    assert.equal(approval.response.status, 200, JSON.stringify(approval.body));
  }
  const unrelatedAfterDb = new Database(databasePath, { readonly: true });
  const unrelatedHashAfter = unrelatedAfterDb.prepare(
    'SELECT content_sha256 AS contentSha256 FROM notes WHERE filename = ?',
  ).get(unrelatedFilename).contentSha256;
  unrelatedAfterDb.close();
  assert.equal(unrelatedHashAfter, unrelatedHashBefore);
  const approvedStatus = await api(url, '/api/organize/status');
  assert.equal(approvedStatus.body.recoveryRequired, 0);

  // 최종 edge/processed 반영과 job 종료가 한 transaction이므로 종료 UPDATE 실패 시 모두 rollback한다.
  const atomicDb = new Database(databasePath);
  atomicDb.prepare("UPDATE notes SET codex_status = 'processed' WHERE filename = ?").run(unrelatedFilename);
  atomicDb.exec(`
    CREATE TRIGGER fail_atomic_job_finalize
    BEFORE UPDATE OF status ON codex_jobs
    WHEN OLD.status = 'running' AND NEW.status = 'processed'
    BEGIN
      SELECT RAISE(ABORT, 'forced job finalize failure');
    END;
  `);
  atomicDb.close();

  const atomicFilenames = [
    'organizer-atomic-finalize-a.md',
    'organizer-atomic-finalize-b.md',
  ];
  await Promise.all(atomicFilenames.map(filename => (
    fs.writeFile(path.join(vaultPath, filename), pendingTopicNote())
  )));
  const atomicSync = await api(url, '/api/notes/sync', { method: 'POST', body: '{}' });
  assert.equal(atomicSync.response.status, 200, JSON.stringify(atomicSync.body));
  await writeLinkedCodexRunner(slowRunner);
  const atomicQueue = await api(url, '/api/organize/queue', { method: 'POST', body: '{}' });
  assert.equal(atomicQueue.response.status, 200, JSON.stringify(atomicQueue.body));
  assert.deepEqual(
    new Set(atomicQueue.body.notes.map(note => note.filename)),
    new Set(atomicFilenames),
  );
  const atomicFailure = await waitForDatabaseState(
    child,
    databasePath,
    logs,
    '최종 job transaction rollback',
    currentDb => {
      const job = currentDb.prepare('SELECT status, error FROM codex_jobs WHERE id = ?')
        .get(atomicQueue.body.jobId);
      const notes = currentDb.prepare(
        `SELECT filename, codex_status AS codexStatus
         FROM notes
         WHERE filename IN (?, ?)`,
      ).all(...atomicFilenames);
      if (
        job?.status === 'failed' &&
        notes.length === 2 &&
        notes.every(note => note.codexStatus === 'needs_manual_check')
      ) return { job, notes };
      return null;
    },
  );
  assert.match(atomicFailure.job.error, /forced job finalize failure/);
  const atomicVerifyDb = new Database(databasePath);
  const atomicEdgeCount = atomicVerifyDb.prepare(
    `SELECT COUNT(*) AS count
     FROM note_edges
     WHERE source_filename IN (?, ?)`,
  ).get(...atomicFilenames).count;
  atomicVerifyDb.exec('DROP TRIGGER fail_atomic_job_finalize');
  atomicVerifyDb.close();
  assert.equal(atomicEdgeCount, 0);
  for (const filename of atomicFilenames) {
    assert.match(
      await fs.readFile(path.join(vaultPath, filename), 'utf8'),
      /Codex 정리 대기/,
    );
  }
});

test('final output read stays inside the snapshot recovery boundary', async t => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-organizer-final-boundary-'));
  let child = null;
  t.after(async () => {
    if (child) await stopServer(child);
    await fs.rm(appRoot, { recursive: true, force: true });
  });

  const vaultPath = path.join(appRoot, 'vault');
  await fs.mkdir(vaultPath);
  await fs.copyFile(path.join(ROOT, 'server.js'), path.join(appRoot, 'server.js'));
  for (const name of ['lib', 'public', 'config', '.codex', 'node_modules']) {
    await fs.symlink(path.join(ROOT, name), path.join(appRoot, name), 'dir');
  }
  const scriptsPath = path.join(appRoot, 'scripts');
  await fs.mkdir(scriptsPath);
  await fs.symlink(path.join(ROOT, 'scripts', 'backup.js'), path.join(scriptsPath, 'backup.js'));
  await fs.writeFile(path.join(scriptsPath, 'validate-codex-edit.js'), [
    `#!${process.execPath}`,
    "'use strict';",
    "const fs = require('node:fs');",
    "fs.writeFileSync(process.env.FINAL_VALIDATION_SIGNAL_PATH, 'validating');",
    'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);',
    '',
  ].join('\n'));

  const filename = 'organizer-final-boundary.md';
  await fs.writeFile(path.join(vaultPath, filename), pendingTopicNote());
  const runnerSignalPath = path.join(appRoot, 'runner-started');
  const finalValidationSignalPath = path.join(appRoot, 'final-validation-started');
  const runnerPath = path.join(appRoot, 'valid-codex');
  await writeSlowSuccessfulCodexRunner(runnerPath, 10);

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
      CODEX_BIN: runnerPath,
      CODEX_RUNNER_MODE: 'codex',
      CODEX_RUNNER_TIMEOUT_MS: '2000',
      RUNNER_SIGNAL_PATH: runnerSignalPath,
      FINAL_VALIDATION_SIGNAL_PATH: finalValidationSignalPath,
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
  await waitForFile(child, finalValidationSignalPath, logs);

  const originalVaultPath = `${vaultPath}-original`;
  await fs.rename(vaultPath, originalVaultPath);
  await fs.mkdir(vaultPath);
  await fs.writeFile(
    path.join(vaultPath, filename),
    organizedTopicNote('교체된 vault도 형식 검증만으로는 정상처럼 보인다.'),
  );

  const databasePath = path.join(appRoot, 'galpi.db');
  const quarantined = await waitForDatabaseState(
    child,
    databasePath,
    logs,
    '최종 읽기 root 교체 격리',
    currentDb => {
      const job = currentDb.prepare(
        'SELECT status, attempt_count AS attemptCount, error FROM codex_jobs WHERE id = ?',
      ).get(queue.body.jobId);
      const note = currentDb.prepare(
        'SELECT codex_status AS codexStatus FROM notes WHERE filename = ?',
      ).get(filename);
      return job?.status === 'failed' && note?.codexStatus === 'recovery_required'
        ? { job, note }
        : null;
    },
  );
  assert.equal(quarantined.job.attemptCount, 1);
  assert.match(quarantined.job.error, /snapshot 자동 복구.*ESTALE.*수동 복구/);
  assert.equal(
    await fs.readFile(path.join(vaultPath, filename), 'utf8'),
    organizedTopicNote('교체된 vault도 형식 검증만으로는 정상처럼 보인다.'),
  );
});

test('SIGKILL after an unsafe edit quarantines the interrupted job on restart', async t => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-organizer-crash-recovery-'));
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
  const filename = 'organizer-crash-recovery.md';
  await fs.writeFile(path.join(vaultPath, filename), pendingTopicNote());
  const runnerSignalPath = path.join(appRoot, 'unsafe-runner-mutated');
  const runnerPath = path.join(appRoot, 'unsafe-codex');
  await writeUnsafeCodexRunner(runnerPath, 1000);
  const logs = [];

  const startServer = async () => {
    const port = await availablePort();
    const url = `http://127.0.0.1:${port}`;
    const server = spawn(process.execPath, ['server.js'], {
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
        CODEX_BIN: runnerPath,
        CODEX_RUNNER_MODE: 'codex',
        CODEX_RUNNER_TIMEOUT_MS: '3000',
        RUNNER_SIGNAL_PATH: runnerSignalPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', chunk => logs.push(chunk.toString()));
    server.stderr.on('data', chunk => logs.push(chunk.toString()));
    await waitForServer(server, url, logs);
    await waitForRunnerHealth(server, url, logs, true);
    return { server, url };
  };

  let started = await startServer();
  child = started.server;
  const sync = await api(started.url, '/api/notes/sync', { method: 'POST', body: '{}' });
  assert.equal(sync.response.status, 200, JSON.stringify(sync.body));
  const queue = await api(started.url, '/api/organize/queue', { method: 'POST', body: '{}' });
  assert.equal(queue.response.status, 200, JSON.stringify(queue.body));
  await waitForFile(child, runnerSignalPath, logs);
  assert.match(await fs.readFile(path.join(vaultPath, filename), 'utf8'), /UNSAFE OUTSIDE CODEX/);

  const crashed = child;
  const crashExit = once(crashed, 'exit');
  crashed.kill('SIGKILL');
  await crashExit;
  child = null;

  const databasePath = path.join(appRoot, 'galpi.db');
  const interruptedDb = new Database(databasePath, { readonly: true });
  assert.deepEqual(
    interruptedDb.prepare(
      'SELECT status, attempt_count AS attemptCount FROM codex_jobs WHERE id = ?',
    ).get(queue.body.jobId),
    { status: 'running', attemptCount: 1 },
  );
  assert.equal(
    interruptedDb.prepare(
      'SELECT codex_status AS codexStatus FROM notes WHERE filename = ?',
    ).get(filename).codexStatus,
    'running',
  );
  interruptedDb.close();

  started = await startServer();
  child = started.server;
  const recoveredDb = new Database(databasePath, { readonly: true });
  const recoveredJob = recoveredDb.prepare(
    'SELECT status, attempt_count AS attemptCount, error FROM codex_jobs WHERE id = ?',
  ).get(queue.body.jobId);
  const recoveredNote = recoveredDb.prepare(
    'SELECT codex_status AS codexStatus FROM notes WHERE filename = ?',
  ).get(filename);
  recoveredDb.close();
  assert.deepEqual(recoveredJob, {
    status: 'failed',
    attemptCount: 1,
    error: '서버 중단으로 변경 검증을 완료하지 못했습니다. 수동 복구가 필요합니다.',
  });
  assert.equal(recoveredNote.codexStatus, 'recovery_required');

  const blocked = await api(started.url, '/api/organize/process', { method: 'POST', body: '{}' });
  assert.equal(blocked.response.status, 409, JSON.stringify(blocked.body));
  await new Promise(resolve => setTimeout(resolve, 150));
  const stableDb = new Database(databasePath, { readonly: true });
  assert.equal(
    stableDb.prepare('SELECT attempt_count AS attemptCount FROM codex_jobs WHERE id = ?')
      .get(queue.body.jobId).attemptCount,
    1,
  );
  stableDb.close();
  assert.match(await fs.readFile(path.join(vaultPath, filename), 'utf8'), /UNSAFE OUTSIDE CODEX/);
});

test('heuristic final notes and job completion commit atomically', async t => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-organizer-heuristic-atomic-'));
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
    'organizer-heuristic-atomic-a.md',
    'organizer-heuristic-atomic-b.md',
  ];
  const candidateFilename = 'organizer-heuristic-candidate.md';
  await Promise.all([...filenames, candidateFilename].map(filename => (
    fs.writeFile(path.join(vaultPath, filename), pendingTopicNote())
  )));

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
      CODEX_RUNNER_MODE: 'heuristic',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => logs.push(chunk.toString()));
  child.stderr.on('data', chunk => logs.push(chunk.toString()));
  await waitForServer(child, url, logs);

  const sync = await api(url, '/api/notes/sync', { method: 'POST', body: '{}' });
  assert.equal(sync.response.status, 200, JSON.stringify(sync.body));
  const databasePath = path.join(appRoot, 'galpi.db');
  const failpointDb = new Database(databasePath);
  failpointDb.prepare("UPDATE notes SET codex_status = 'processed' WHERE filename = ?")
    .run(candidateFilename);
  failpointDb.exec(`
    CREATE TRIGGER fail_heuristic_job_finalize
    BEFORE UPDATE OF status ON codex_jobs
    WHEN OLD.status = 'running' AND NEW.status = 'processed'
    BEGIN
      SELECT RAISE(ABORT, 'forced heuristic finalize failure');
    END;
  `);
  failpointDb.close();

  const queue = await api(url, '/api/organize/queue', { method: 'POST', body: '{}' });
  assert.equal(queue.response.status, 200, JSON.stringify(queue.body));
  assert.deepEqual(new Set(queue.body.notes.map(note => note.filename)), new Set(filenames));
  const quarantined = await waitForDatabaseState(
    child,
    databasePath,
    logs,
    'heuristic 최종 transaction rollback',
    currentDb => {
      const job = currentDb.prepare('SELECT status, error FROM codex_jobs WHERE id = ?')
        .get(queue.body.jobId);
      const notes = currentDb.prepare(
        `SELECT filename, codex_status AS codexStatus
         FROM notes
         WHERE filename IN (?, ?)`,
      ).all(...filenames);
      if (
        job?.status === 'failed' &&
        notes.length === 2 &&
        notes.every(note => note.codexStatus === 'recovery_required')
      ) return { job, notes };
      return null;
    },
  );
  assert.match(quarantined.job.error, /forced heuristic finalize failure/);
  const verifyDb = new Database(databasePath, { readonly: true });
  const edgeCount = verifyDb.prepare(
    `SELECT COUNT(*) AS count
     FROM note_edges
     WHERE source_filename IN (?, ?)`,
  ).get(...filenames).count;
  verifyDb.close();
  assert.equal(edgeCount, 0);
  const blocked = await api(url, '/api/organize/process', { method: 'POST', body: '{}' });
  assert.equal(blocked.response.status, 409, JSON.stringify(blocked.body));
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
