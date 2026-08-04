'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const API_TOKEN = 'attachment-admin-token';

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
    if (child.exitCode !== null) throw new Error(`테스트 서버가 종료됐습니다: ${logs.join('')}`);
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

function attachmentForm() {
  const form = new FormData();
  form.set('file', new Blob(['서버 통합 첨부'], { type: 'text/plain' }), '통합.txt');
  return form;
}

test('attachment route is authenticated, feature-flagged, and stores only in the data directory', async t => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'attachment-upload-server-'));
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
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: 'test-key',
      GPT_RESPONSES_ENABLED: 'false',
      MODEL_CATALOG_REFRESH_ENABLED: 'false',
      ASSISTANT_TASKS_ENABLED: 'false',
      WEB_PUSH_ENABLED: 'false',
      VOICE_SHORTCUT_ENABLED: 'false',
      VOICE_HALFDUPLEX_ENABLED: 'false',
      ATTACHMENTS_ENABLED: 'true',
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

  t.after(async () => {
    await stopServer(child);
    await fs.rm(appRoot, { recursive: true, force: true });
  });

  await waitForServer(child, url, logs);
  const configResponse = await fetch(`${url}/api/config`, {
    headers: { 'X-API-Token': API_TOKEN },
  });
  const config = await configResponse.json();
  assert.deepEqual(config.attachments, {
    enabled: true,
    maxFilesPerMessage: 1,
    maxPdfBytes: 20 * 1024 * 1024,
    maxImageBytes: 10 * 1024 * 1024,
    maxTextBytes: 2 * 1024 * 1024,
    orphanRetentionMinutes: 60,
  });

  const unauthorized = await fetch(`${url}/api/attachments`, {
    method: 'POST',
    body: attachmentForm(),
  });
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).error, 'API 토큰이 필요합니다.');

  const uploaded = await fetch(`${url}/api/attachments`, {
    method: 'POST',
    headers: { 'X-API-Token': API_TOKEN },
    body: attachmentForm(),
  });
  const body = await uploaded.json();
  assert.equal(uploaded.status, 201, JSON.stringify(body));
  assert.equal(uploaded.headers.get('cache-control'), 'no-store');
  assert.equal(body.filename, '통합.txt');

  const db = new Database(path.join(appRoot, 'galpi.db'), { readonly: true });
  t.after(() => db.close());
  assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_version').get().version, 12);
  const stored = db.prepare(`
    SELECT a.id, a.lifecycle_status AS lifecycleStatus,
           b.stored_path AS storedPath, b.status
    FROM attachments a JOIN attachment_blobs b ON b.id = a.blob_id
  `).get();
  assert.equal(stored.id, body.attachmentId);
  assert.equal(stored.lifecycleStatus, 'uploaded_unattached');
  assert.equal(stored.status, 'ready');
  assert.equal(
    await fs.realpath(path.dirname(stored.storedPath)),
    await fs.realpath(path.join(appRoot, 'attachments', 'tmp')),
  );
  assert.equal((await fs.readFile(stored.storedPath, 'utf8')), '서버 통합 첨부');
  assert.equal(logs.join('').includes('서버 통합 첨부'), false);
});
