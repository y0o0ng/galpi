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

async function startServer(t, mailEnabled) {
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
      // 자격증명은 넣지 않는다. 계정이 하나도 없으므로 provider는 호출되지 않는다.
      MAIL_GMAIL_CLIENT_ID: '',
      MAIL_GMAIL_CLIENT_SECRET: '',
      MAIL_GMAIL_REFRESH_TOKEN: '',
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
    'mail_accounts', 'mail_attention', 'mail_messages',
    'mail_notification_batches', 'mail_preferences',
    'mail_push_deliveries', 'mail_sync_state',
  ]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mail_accounts').get().n, 0);
  db.close();
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
