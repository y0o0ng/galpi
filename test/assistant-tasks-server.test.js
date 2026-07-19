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

async function startServer(t, enabled, pushEnabled = false) {
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
      WEB_PUSH_ENABLED: pushEnabled ? 'true' : 'false',
      WEB_PUSH_CANONICAL_ORIGIN: 'https://galpi-test.example.ts.net',
      WEB_PUSH_VAPID_SUBJECT: 'mailto:test@example.com',
      WEB_PUSH_VAPID_PUBLIC_KEY: 'A'.repeat(87),
      WEB_PUSH_VAPID_PRIVATE_KEY: 'B'.repeat(43),
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

  const pushConfig = await api(url, '/api/push/config');
  assert.deepEqual(pushConfig.body, {
    enabled: false,
    publicKey: null,
    canonicalOrigin: null,
    install: { display: 'standalone', iosHomeScreenRequired: true },
  });
});

test('task routes expose the independent store with JSON, idempotency, and lifecycle contracts', async t => {
  const { appRoot, url } = await startServer(t, true, true);
  const config = await api(url, '/api/config');
  assert.equal(config.body.tasksEnabled, true);

  const unauthorizedPush = await api(url, '/api/push/config', {}, false);
  assert.equal(unauthorizedPush.response.status, 401);
  const pushConfig = await api(url, '/api/push/config');
  assert.deepEqual(pushConfig.body, {
    enabled: true,
    publicKey: 'A'.repeat(87),
    canonicalOrigin: 'https://galpi-test.example.ts.net',
    install: { display: 'standalone', iosHomeScreenRequired: true },
  });
  const pushBody = {
    endpoint: 'https://web.push.apple.com/test-device',
    keys: { p256dh: 'C'.repeat(87), auth: 'D'.repeat(22) },
    deviceLabel: '통합 테스트',
  };
  const pushCreated = await api(url, '/api/push/subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pushBody),
  });
  assert.equal(pushCreated.response.status, 201, JSON.stringify(pushCreated.body));
  assert.equal(pushCreated.body.status, 'active');
  assert.equal('endpoint' in pushCreated.body, false);
  assert.equal('keys' in pushCreated.body, false);
  const pushReplayed = await api(url, '/api/push/subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pushBody),
  });
  assert.equal(pushReplayed.response.status, 200);
  assert.equal(pushReplayed.body.replayed, true);
  const pushRejected = await api(url, '/api/push/subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...pushBody, endpoint: 'https://example.com/not-a-push-service' }),
  });
  assert.equal(pushRejected.response.status, 400);
  assert.equal(pushRejected.body.code, 'PUSH_ENDPOINT_NOT_ALLOWED');
  const pushRevoked = await api(url, `/api/push/subscriptions/${pushCreated.body.id}`, { method: 'DELETE' });
  assert.equal(pushRevoked.response.status, 200);
  assert.equal(pushRevoked.body.status, 'revoked');

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
  assert.equal(summary.body.calendar.length, 3);
  assert.ok(summary.body.calendar.every(week => week.days.length === 7));
  const nextCenter = summary.body.calendar[2].startDate;
  const nextCalendar = await api(url, `/api/tasks/summary?calendarCenter=${nextCenter}`);
  assert.equal(nextCalendar.response.status, 200);
  assert.equal(nextCalendar.body.calendarCenter, nextCenter);
  const invalidCenter = summary.body.calendar[1].days[6].date;
  const invalidCalendar = await api(url, `/api/tasks/summary?calendarCenter=${invalidCenter}`);
  assert.equal(invalidCalendar.response.status, 400);
  assert.equal(invalidCalendar.body.code, 'INVALID_CALENDAR_WEEK');

  const alertPayload = {
    ...payload,
    clientRequestId: 'web-server-alert01',
    title: '발화 알림',
  };
  const alertTask = await api(url, '/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(alertPayload),
  });
  assert.equal(alertTask.response.status, 201, JSON.stringify(alertTask.body));
  const writableDb = new Database(path.join(appRoot, 'galpi.db'));
  writableDb.prepare(`
    UPDATE assistant_reminders
    SET status = 'fired', fired_at = ?, updated_at = ?
    WHERE id = ?
  `).run(12345, 12345, alertTask.body.reminder.id);
  writableDb.close();
  const notifications = await api(url, '/api/notifications');
  const taskNotification = notifications.body.notifications.find(item => item.type === 'task_reminder');
  assert.deepEqual(taskNotification, {
    id: `task-reminder:${alertTask.body.reminder.id}`,
    source: 'task',
    type: 'task_reminder',
    reminderId: alertTask.body.reminder.id,
    taskId: alertTask.body.task.id,
    taskVersion: 1,
    title: '발화 알림',
    remindAt: alertTask.body.reminder.remindAt,
    firedAt: 12345,
  });
  const acknowledged = await api(url, `/api/reminders/${alertTask.body.reminder.id}/acknowledge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(acknowledged.body.reminder.status, 'acknowledged');
  const afterAcknowledge = await api(url, '/api/notifications');
  assert.equal(afterAcknowledge.body.notifications.some(item => item.type === 'task_reminder'), false);

  const completed = await api(url, `/api/tasks/${created.body.task.id}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedVersion: 1 }),
  });
  assert.equal(completed.response.status, 200);
  assert.equal(completed.body.task.lifecycle, 'closed');
  const history = await api(url, '/api/tasks?view=history&status=done');
  assert.equal(history.body.tasks.length, 1);

  const scheduleFilename = `xion-schedule-${dueAt.slice(0, 7)}.md`;
  const blockedArchive = await api(url, '/api/notes/archive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: scheduleFilename }),
  });
  assert.equal(blockedArchive.response.status, 500);
  assert.match(blockedArchive.body.error, /에이전트 소유 노트/);

  const deleted = await api(url, `/api/tasks/${created.body.task.id}/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedVersion: 2 }),
  });
  assert.equal(deleted.body.task.lifecycle, 'deleted');
  const normal = await api(url, '/api/tasks?view=all');
  const trash = await api(url, '/api/tasks?view=trash');
  assert.deepEqual(normal.body.tasks.map(task => task.title), ['발화 알림']);
  assert.equal(trash.body.tasks.length, 1);

  const db = new Database(path.join(appRoot, 'galpi.db'), { readonly: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assistant_tasks').get().count, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assistant_reminders').get().count, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages').get().count, 0);
  assert.deepEqual(
    db.prepare(`
      SELECT note_type AS noteType, owner_agent AS ownerAgent
      FROM notes
    `).get(),
    { noteType: 'schedule_history', ownerAgent: 'schedule' },
  );
  const scheduleNote = await fs.readFile(
    path.join(appRoot, 'vault', scheduleFilename),
    'utf8',
  );
  assert.doesNotMatch(scheduleNote, /서버 일정/);
  assert.deepEqual(
    db.prepare('SELECT status, endpoint FROM assistant_push_subscriptions').get(),
    { status: 'revoked', endpoint: pushBody.endpoint },
  );
  db.close();
});
