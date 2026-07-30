'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const API_TOKEN = 'realtime-route-test-token';

async function availablePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForServer(child, url, logs) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`테스트 서버가 일찍 종료됐습니다: ${logs.join('')}`);
    }
    try {
      const response = await fetch(`${url}/api/config`);
      if (response.ok) return;
    } catch (_) {
      // 기동 중에는 연결 실패가 정상이다.
    }
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

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function tableCounts(db, tables) {
  return Object.fromEntries(tables.map(table => [
    table,
    db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
  ]));
}

test('authenticated Realtime route proxies only SDP and leaves application state untouched', async t => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'realtime-route-'));
  const vaultPath = path.join(appRoot, 'vault');
  await fs.mkdir(vaultPath);
  await fs.copyFile(path.join(ROOT, 'server.js'), path.join(appRoot, 'server.js'));
  for (const name of ['lib', 'scripts', 'public', 'config', '.codex', 'node_modules']) {
    await fs.symlink(path.join(ROOT, name), path.join(appRoot, name), 'dir');
  }

  const providerRequests = [];
  const provider = http.createServer(async (req, res) => {
    providerRequests.push({
      url: req.url,
      authorization: req.headers.authorization,
      safetyIdentifier: req.headers['openai-safety-identifier'],
      body: await readBody(req),
    });
    res.writeHead(201, { 'Content-Type': 'application/sdp' });
    res.end('v=0\r\no=provider-answer\r\n');
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');

  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  const logs = [];
  const child = spawn(process.execPath, ['server.js'], {
    cwd: appRoot,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: 'server-only-realtime-key',
      OPENAI_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`,
      OPENAI_REALTIME_ENABLED: 'true',
      OPENAI_REALTIME_MODEL: 'gpt-realtime-2.1-mini',
      OPENAI_REALTIME_TRANSCRIPTION_MODEL: 'gpt-4o-mini-transcribe',
      GPT_RESPONSES_ENABLED: 'false',
      MODEL_CATALOG_REFRESH_ENABLED: 'false',
      ASSISTANT_RETRIEVAL_A2_ENABLED: 'false',
      API_TOKEN,
      HOST: '127.0.0.1',
      PORT: String(port),
      VAULT_PATH: vaultPath,
      BACKUP_DIR: path.join(appRoot, 'backups'),
      CODEX_RUNNER_MODE: 'heuristic',
      ASSISTANT_TASKS_ENABLED: 'false',
      WEB_PUSH_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => logs.push(chunk.toString()));
  child.stderr.on('data', chunk => logs.push(chunk.toString()));

  t.after(async () => {
    await stopServer(child);
    await new Promise(resolve => provider.close(resolve));
    await fs.rm(appRoot, { recursive: true, force: true });
  });

  await waitForServer(child, url, logs);
  const forwardedConfigResponse = await fetch(`${url}/api/config`, {
    headers: { 'X-Forwarded-For': '203.0.113.42' },
  });
  assert.equal(forwardedConfigResponse.status, 200);
  assert.deepEqual(await forwardedConfigResponse.json(), { requiresApiToken: true });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.doesNotMatch(logs.join(''), /ERR_ERL_UNEXPECTED_X_FORWARDED_FOR/);

  const configResponse = await fetch(`${url}/api/config`, {
    headers: { 'X-API-Token': API_TOKEN },
  });
  const config = await configResponse.json();
  assert.deepEqual(config.realtimeVoice, {
    enabled: true,
    model: 'gpt-realtime-2.1-mini',
    voice: 'marin',
    maxSessionSeconds: 300,
  });
  assert.doesNotMatch(JSON.stringify(config), /server-only-realtime-key/);

  const db = new Database(path.join(appRoot, 'galpi.db'), { readonly: true });
  const applicationTables = [
    'messages',
    'notes',
    'assistant_tasks',
    'assistant_task_events',
    'assistant_reminders',
  ];
  const beforeCounts = tableCounts(db, applicationTables);
  const beforeVault = await fs.readdir(vaultPath);

  const unauthorized = await fetch(`${url}/api/voice/realtime/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: 'v=0\r\no=unauthorized\r\n',
  });
  assert.equal(unauthorized.status, 401);

  const response = await fetch(`${url}/api/voice/realtime/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/sdp',
      'X-API-Token': API_TOKEN,
    },
    body: 'v=0\r\no=browser-offer\r\n',
  });
  assert.equal(response.status, 201);
  assert.match(response.headers.get('content-type'), /application\/sdp/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-galpi-realtime-model'), 'gpt-realtime-2.1-mini');
  assert.equal(await response.text(), 'v=0\r\no=provider-answer\r\n');
  assert.equal(providerRequests.length, 1);
  assert.equal(providerRequests[0].url, '/v1/realtime/calls');
  assert.equal(providerRequests[0].authorization, 'Bearer server-only-realtime-key');
  assert.match(providerRequests[0].safetyIdentifier, /^[a-f0-9]{64}$/);
  const multipartBody = providerRequests[0].body.toString('utf8');
  assert.match(multipartBody, /v=0\r\no=browser-offer/);
  assert.match(multipartBody, /gpt-realtime-2\.1-mini/);
  assert.match(multipartBody, /gpt-4o-mini-transcribe/);

  assert.deepEqual(tableCounts(db, applicationTables), beforeCounts);
  assert.deepEqual(await fs.readdir(vaultPath), beforeVault);
  db.close();
});
