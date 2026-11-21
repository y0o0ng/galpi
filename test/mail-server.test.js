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
const API_TOKEN = 'mail-server-test-token';

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
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
    child.kill('SIGTERM');
  });
}

async function startServer(t, mailEnabled, clientEnabled = false, writesEnabled = false, smartEnabled = false) {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mail-server-'));
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
      MAIL_AGENT_ENABLED: mailEnabled ? 'true' : 'false',
      MAIL_CLIENT_ENABLED: clientEnabled ? 'true' : 'false',
      MAIL_CLIENT_WRITE_ENABLED: writesEnabled ? 'true' : 'false',
      MAIL_CLIENT_SEND_ENABLED: 'false',
      MAIL_CLIENT_SMART_ENABLED: smartEnabled ? 'true' : 'false',
      // 자격증명은 넣지 않는다. 계정이 하나도 없으므로 provider는 호출되지 않는다.
      MAIL_GMAIL_CLIENT_ID: '',
      MAIL_GMAIL_CLIENT_SECRET: '',
      MAIL_GMAIL_REFRESH_TOKEN: '',
      MAIL_GMAIL_MODIFY_REFRESH_TOKEN: '',
      NAVER_MAIL_USER: '',
      NAVER_MAIL_APP_PASSWORD: '',
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
  return { appRoot, url, logs };
}

async function api(url, pathname) {
  const response = await fetch(`${url}${pathname}`, { headers: { 'X-API-Token': API_TOKEN } });
  return { response, body: await response.json() };
}

test('the schema lands even while the mail agent stays off', async t => {
  const { appRoot, url, logs } = await startServer(t, false);

  const { response, body } = await api(url, '/api/mail/status');
  assert.equal(response.status, 503);
  assert.equal(body.code, 'MAIL_AGENT_DISABLED');
  // 플래그가 꺼져 있으면 worker를 만들지도 않는다.
  assert.equal(logs.join('').includes('Provider 동기화 worker'), false);

  // 표는 migration으로 생기고 비어 있다. 플래그는 동작만 가른다.
  const db = new Database(path.join(appRoot, 'galpi.db'), { readonly: true });
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name LIKE 'mail_%'
    ORDER BY name
  `).all().map(row => row.name);
  assert.deepEqual(tables, [
    'mail_accounts', 'mail_attention', 'mail_client_action_receipts', 'mail_client_cache',
    'mail_client_compose_receipts', 'mail_client_contacts', 'mail_client_messages', 'mail_client_read_overrides', 'mail_messages',
    'mail_notification_batches', 'mail_preferences',
    'mail_push_deliveries', 'mail_reply_attempts', 'mail_sync_state',
    'mail_workspace_analysis_jobs', 'mail_workspace_calendar_events', 'mail_workspace_sources',
  ]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mail_accounts').get().n, 0);
  db.close();
});

test('Mail Client uses the existing HTTP authentication and runs independently from the Mail Agent', async t => {
  const { url, logs } = await startServer(t, false, true);
  const unauthenticated = await fetch(url + '/api/mail-client/accounts');
  assert.equal(unauthenticated.status, 401);
  const { response, body } = await api(url, '/api/mail-client/accounts');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(body, { success: true, accounts: [] });
  const reader = await fetch(url + '/mail-message-frame');
  assert.match(reader.headers.get('content-security-policy'), /img-src blob:;/);
  assert.equal(reader.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(reader.headers.get('cache-control'), 'no-store');
  const readerWithImages = await fetch(url + '/mail-message-frame?images=1');
  assert.match(readerWithImages.headers.get('content-security-policy'), /default-src 'none';.*img-src blob: https: http:;/);
  assert.match((await fetch(url + '/')).headers.get('content-security-policy'), /img-src 'self' data: blob:;/);
  assert.equal((await fetch(url + '/api/mail-client/messages/1/inline-images/0')).status, 401);
  assert.equal((await api(url, '/api/mail-client/messages/1/inline-images/0')).body.code, 'MAIL_CLIENT_MESSAGE_NOT_FOUND');
  assert.equal((await api(url, '/api/mail-client/inbox?limit=100')).response.status, 400);
  const contactsPath = '/api/mail-client/contacts';
  assert.equal((await fetch(url + contactsPath)).status, 401);
  assert.deepEqual((await api(url, contactsPath)).body, { success: true, contacts: [], total: 0, collectionEnabled: false });
  assert.equal((await fetch(url + contactsPath + '/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries: [{ email: 'example@example.com' }] }),
  })).status, 401);
  assert.equal((await api(url, '/api/mail/status')).body.code, 'MAIL_AGENT_DISABLED');
  assert.equal(logs.join('').includes('Provider 동기화 worker'), false);
  const rejectedWrite = await fetch(url + '/api/mail-client/inbox', {
    method: 'POST', headers: { 'X-API-Token': API_TOKEN },
  });
  assert.equal(rejectedWrite.status, 404);
});

test('Mail Client actions require both flags and the existing token, and return per-message outcomes', async t => {
  async function post(url, path, body, authenticated = true) {
    const response = await fetch(url + '/api/mail-client/messages' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authenticated ? { 'X-API-Token': API_TOKEN } : {}) },
      body: JSON.stringify(body),
    });
    return { response, body: await response.json() };
  }
  const readOnly = await startServer(t, false, true, false);
  const writeOnly = await startServer(t, false, false, true);
  const enabled = await startServer(t, false, true, true);
  const noAuth = await fetch(enabled.url + '/api/mail-client/accounts/1/send', { method: 'POST' });
  assert.equal(noAuth.status, 401);
  assert.equal(noAuth.headers.get('cache-control'), 'no-store');
  const noSend = await fetch(enabled.url + '/api/mail-client/accounts/1/send', {
    method: 'POST', headers: { 'X-API-Token': API_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: 'disabled-send', compose: { kind: 'new', text: 'test' } }),
  });
  assert.equal(noSend.status, 503);
  assert.equal((await noSend.json()).code, 'MAIL_CLIENT_SEND_DISABLED');
  for (const server of [readOnly, writeOnly]) {
    assert.equal((await post(server.url, '/1/actions', { requestId: 'disabled', action: 'trash' })).body.code,
      'MAIL_CLIENT_WRITE_DISABLED');
  }
  const input = { requestId: 'missing', action: 'trash' };
  assert.equal((await post(enabled.url, '/1/actions', input, false)).response.status, 401);
  const missing = await post(enabled.url, '/1/actions', input);
  assert.equal(missing.response.status, 404);
  assert.equal(missing.response.headers.get('cache-control'), 'no-store');
  assert.equal(missing.body.result.state, 'failed');
  assert.equal(missing.body.result.code, 'MAIL_CLIENT_MESSAGE_NOT_FOUND');
  assert.equal((await post(enabled.url, '/1/actions', { ...input, action: 'archive' })).response.status, 409);
  const batch = await post(enabled.url, '/actions', {
    requestId: 'missing-batch',
    operations: [{ messageId: 1, action: 'trash' }, { messageId: 2, action: 'archive' }],
  });
  assert.equal(batch.response.status, 200);
  assert.equal(batch.body.success, false);
  assert.deepEqual(batch.body.results.map(row => row.state), ['failed', 'failed']);
});

test('turning the flag on starts the worker and opens the status route', async t => {
  const { url, logs } = await startServer(t, true);

  const { response, body } = await api(url, '/api/mail/status');
  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    success: true,
    enabled: true,
    accounts: [],
    // 분석 큐는 비어 있어도 항상 보인다. 좌초 개수가 0인 것과 화면에 안 나오는 것은 다르다.
    analysis: { pending: 0, analyzing: 0, done: 0, failed: 0, skipped: 0 },
    stranded: [],
  });

  // 계정이 없어도 worker는 돈다. 첫 tick이 아무 계정도 집지 않을 뿐이다.
  assert.equal(logs.join('').includes('Provider 동기화 worker 실행 중'), true);
});

test('Workspace smart endpoints default off, require read enablement and authenticate independently of writes', async t => {
  const defaultOff = await startServer(t, false, true);
  const parentOff = await startServer(t, false, false, false, true);
  const enabled = await startServer(t, false, true, false, true);
  const smartPath = '/api/mail-client/smart';
  for (const server of [defaultOff, parentOff]) {
    const { body, response } = await api(server.url, smartPath + '/messages?filter=unclassified');
    assert.equal(response.status, 503);
    assert.equal(body.code, 'MAIL_CLIENT_SMART_DISABLED');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const unauthorized = await fetch(enabled.url + smartPath + '/results?messageIds=1');
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get('cache-control'), 'no-store');
  const page = await api(enabled.url, smartPath + '/messages?filter=unclassified');
  assert.equal(page.response.status, 200);
  assert.equal(page.body.coverage.scope, 'observed_workspace');
  const post = await fetch(enabled.url + smartPath + '/analyze', {
    method: 'POST', headers: { 'X-API-Token': API_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageIds: [99], kind: 'both' }),
  });
  assert.equal(post.status, 202);
  assert.equal(post.headers.get('cache-control'), 'no-store');
  const { results } = await post.json();
  assert.deepEqual(results[0].error, { code: 'MAIL_CLIENT_MESSAGE_NOT_FOUND', statusCode: 404 });
  const missing = await api(enabled.url, smartPath + '/calendar/99');
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.code, 'MAIL_CLIENT_SMART_EVENT_NOT_FOUND');
  const db = new Database(path.join(enabled.appRoot, 'galpi.db'), { readonly: true });
  try {
    for (const table of ['mail_workspace_analysis_jobs', 'mail_messages', 'assistant_tasks', 'assistant_reminders']) {
      assert.equal(db.prepare('SELECT count(*) AS n FROM ' + table).get().n, 0);
    }
  } finally { db.close(); }
});
