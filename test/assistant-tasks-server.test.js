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
const API_TOKEN = 'assistant-tasks-test-token';

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
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`테스트 서버가 일찍 종료됐습니다: ${logs.join('')}`);
    try {
      const response = await fetch(`${url}/api/config`);
      if (response.ok) return;
    } catch { /* 기동 대기 */ }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`테스트 서버 기동 시간이 초과됐습니다: ${logs.join('')}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('테스트 서버 종료 시간 초과')), 3000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

function kstDateTimeAfter(seconds) {
  const date = new Date(Date.now() + seconds * 1000 + 9 * 60 * 60 * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  const second = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}:${second}+09:00`;
}

async function startServer(t, enabled) {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'assistant-tasks-server-'));
  const vaultPath = path.join(appRoot, 'vault');
  await fs.mkdir(vaultPath);
  await fs.copyFile(path.join(ROOT, 'server.js'), path.join(appRoot, 'server.js'));
  for (const name of ['lib', 'scripts', 'public', 'config', '.codex', 'node_modules']) {
    await fs.symlink(path.join(ROOT, name), path.join(appRoot, name), 'dir');
  }
  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  const logs = [];
  const child = spawn(process.execPath, ['server.js'], {
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
      ASSISTANT_TASKS_ENABLED: enabled ? 'true' : 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => logs.push(chunk.toString()));
  child.stderr.on('data', chunk => logs.push(chunk.toString()));
  t.after(async () => {
    await stopServer(child);
    await fs.rm(appRoot, { recursive: true, force: true });
  });
  await waitForServer(child, url, logs);
  return { appRoot, url };
}

async function api(url, pathname, options = {}, authenticated = true) {
  const headers = { ...options.headers };
  if (authenticated) headers['X-API-Token'] = API_TOKEN;
  const response = await fetch(`${url}${pathname}`, { ...options, headers });
  const body = await response.json();
  return { response, body };
}

test('task routes stay authenticated and return 503 while the feature flag is off', async t => {
  const { url } = await startServer(t, false);
  const unauthorized = await api(url, '/api/tasks', {}, false);
  assert.equal(unauthorized.response.status, 401);

  const disabled = await api(url, '/api/tasks');
  assert.equal(disabled.response.status, 503);
  assert.equal(disabled.body.code, 'TASKS_DISABLED');

  const config = await api(url, '/api/config');
  assert.equal(config.response.status, 200);
  assert.equal(config.body.tasksEnabled, false);
});

test('task routes expose the independent store with JSON, idempotency, and lifecycle contracts', async t => {
  const { appRoot, url } = await startServer(t, true);
  const config = await api(url, '/api/config');
  assert.equal(config.body.tasksEnabled, true);

  const notJson = await api(url, '/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'not-json',
  });
  assert.equal(notJson.response.status, 415);
  assert.equal(notJson.body.code, 'JSON_REQUIRED');

  const malformed = await api(url, '/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  assert.equal(malformed.response.status, 400);
  assert.equal(malformed.body.code, 'INVALID_JSON');

  const reminderAt = kstDateTimeAfter(60 * 60);
  const dueAt = kstDateTimeAfter(2 * 60 * 60);
  const payload = {
    clientRequestId: 'web-server-create1',
    title: '서버 일정',
    detail: 'API 경계 확인',
    due: { kind: 'datetime', at: dueAt },
    reminderAt,
  };
  const created = await api(url, '/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.task.version, 1);
  assert.equal(created.body.reminder.status, 'pending');

  const replayed = await api(url, '/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(replayed.response.status, 200);
  assert.equal(replayed.body.replayed, true);
  assert.equal(replayed.body.task.id, created.body.task.id);

  const conflict = await api(url, `/api/tasks/${created.body.task.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedVersion: 2, title: '충돌' }),
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.code, 'TASK_VERSION_CONFLICT');
  assert.equal(conflict.body.task.version, 1);

  const listed = await api(url, '/api/tasks?view=all');
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.tasks.length, 1);
  assert.equal(listed.body.tasks[0].reminder.id, created.body.reminder.id);
  const summary = await api(url, '/api/tasks/summary');
  assert.equal(summary.response.status, 200);
  assert.equal(summary.body.counts.overdue + summary.body.counts.today + summary.body.counts.upcoming, 1);

  const completed = await api(url, `/api/tasks/${created.body.task.id}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedVersion: 1 }),
  });
  assert.equal(completed.response.status, 200);
  assert.equal(completed.body.task.lifecycle, 'closed');
  const history = await api(url, '/api/tasks?view=history&status=done');
  assert.equal(history.body.tasks.length, 1);

  const deleted = await api(url, `/api/tasks/${created.body.task.id}/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedVersion: 2 }),
  });
  assert.equal(deleted.body.task.lifecycle, 'deleted');
  const normal = await api(url, '/api/tasks?view=all');
  const trash = await api(url, '/api/tasks?view=trash');
  assert.equal(normal.body.tasks.length, 0);
  assert.equal(trash.body.tasks.length, 1);

  const db = new Database(path.join(appRoot, 'galpi.db'), { readonly: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assistant_tasks').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assistant_reminders').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notes').get().count, 0);
  db.close();
});
