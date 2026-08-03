'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const API_TOKEN = 'voice-shortcut-admin-token';

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

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(value));
}

async function requestJson(url, pathname, options = {}) {
  const response = await fetch(`${url}${pathname}`, options);
  return { response, body: await response.json() };
}

function adminRequest(url, pathname, options = {}) {
  return requestJson(url, pathname, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Token': API_TOKEN,
      ...options.headers,
    },
  });
}

function shortcutRequest(url, token, body) {
  return requestJson(url, '/api/voice/shortcut/turn', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

test('shortcut route uses scoped device auth and saves each shared turn exactly once', async t => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-shortcut-server-'));
  const vaultPath = path.join(appRoot, 'vault');
  await fs.mkdir(vaultPath);
  await fs.copyFile(path.join(ROOT, 'server.js'), path.join(appRoot, 'server.js'));
  for (const name of ['lib', 'scripts', 'public', 'config', '.codex', 'node_modules']) {
    await fs.symlink(path.join(ROOT, name), path.join(appRoot, name), 'dir');
  }

  const responseRequests = [];
  const provider = http.createServer(async (req, res) => {
    const body = await readJson(req);
    if (req.url === '/v1/embeddings') {
      return sendJson(res, 200, {
        object: 'list',
        data: [{ object: 'embedding', index: 0, embedding: [1, 0] }],
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: 1, total_tokens: 1 },
      });
    }
    if (req.url === '/v1/responses') {
      responseRequests.push(body);
      await new Promise(resolve => setTimeout(resolve, 40));
      const answer = '그 변경은 갈피 화면에서 확인해줘.';
      return sendJson(res, 200, {
        id: `resp_shortcut_${responseRequests.length}`,
        object: 'response',
        status: 'completed',
        model: body.model,
        output_text: answer,
        output: [{
          type: 'message',
          id: `msg_shortcut_${responseRequests.length}`,
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: answer, annotations: [] }],
        }],
        usage: { input_tokens: 10, output_tokens: 8, total_tokens: 18 },
      });
    }
    return sendJson(res, 404, { error: { message: 'not found' } });
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');

  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  const providerUrl = `http://127.0.0.1:${provider.address().port}/v1`;
  const logs = [];
  const child = spawn(process.execPath, ['server.js'], {
    cwd: appRoot,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: 'test-key',
      OPENAI_BASE_URL: providerUrl,
      GPT_RESPONSES_ENABLED: 'true',
      GPT_CHAT_BOOTSTRAP_MODEL: 'gpt-5.6-terra',
      GPT_CHAT_REASONING_EFFORT: 'medium',
      ASSISTANT_RETRIEVAL_A2_ENABLED: 'true',
      MODEL_CATALOG_REFRESH_ENABLED: 'false',
      ASSISTANT_TASKS_ENABLED: 'true',
      WEB_PUSH_ENABLED: 'false',
      VOICE_SHORTCUT_ENABLED: 'true',
      VOICE_HALFDUPLEX_ENABLED: 'false',
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
    await new Promise(resolve => provider.close(resolve));
    await fs.rm(appRoot, { recursive: true, force: true });
  });

  await waitForServer(child, url, logs);
  const dbPath = path.join(appRoot, 'galpi.db');
  let db = new Database(dbPath);
  const subscriptionId = Number(db.prepare(`
    INSERT INTO assistant_push_subscriptions (
      endpoint, p256dh, auth, status, device_label
    ) VALUES (
      'https://web.push.apple.com/shortcut-iphone', 'p256dh', 'auth', 'active', '찬용 아이폰'
    )
  `).run().lastInsertRowid);
  db.close();

  const config = await adminRequest(url, '/api/config');
  assert.equal(config.body.shortcutVoice.enabled, true);
  const issued = await adminRequest(url, '/api/voice/shortcut/credentials', {
    method: 'POST',
    body: JSON.stringify({ subscriptionId }),
  });
  assert.equal(issued.response.status, 201, JSON.stringify(issued.body));
  assert.match(issued.body.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(issued.response.headers.get('cache-control'), 'no-store');
  const { token } = issued.body;

  db = new Database(dbPath);
  const storedCredential = db.prepare(`
    SELECT id, token_sha256 AS tokenSha256, token_prefix AS tokenPrefix
    FROM assistant_shortcut_credentials
  `).get();
  assert.equal(storedCredential.tokenSha256, require('node:crypto').createHash('sha256').update(token).digest('hex'));
  assert.equal(storedCredential.tokenPrefix, token.slice(0, 8));
  assert.equal(JSON.stringify(storedCredential).includes(token), false);
  db.close();

  const missingAuth = await shortcutRequest(url, '', {
    text: '질문',
    requestId: '00000000-0000-4000-8000-000000000010',
  });
  assert.equal(missingAuth.response.status, 401);
  assert.equal(missingAuth.body.code, 'SHORTCUT_AUTH_REQUIRED');

  const adminTokenRejected = await shortcutRequest(url, API_TOKEN, {
    text: '질문',
    requestId: '00000000-0000-4000-8000-000000000011',
  });
  assert.equal(adminTokenRejected.response.status, 401);

  const invalidFields = await shortcutRequest(url, token, {
    text: '질문',
    requestId: '00000000-0000-4000-8000-000000000012',
    model: 'gpt-5.6-sol',
  });
  assert.equal(invalidFields.response.status, 400);
  assert.equal(invalidFields.body.code, 'SHORTCUT_INVALID_FIELDS');
  assert.equal(responseRequests.length, 0);

  const firstBody = {
    text: '내일 오전 9시에 일정을 등록해줘',
    requestId: '00000000-0000-4000-8000-000000000013',
  };
  const first = await shortcutRequest(url, token, firstBody);
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.deepEqual(Object.keys(first.body).sort(), [
    'answer', 'canContinue', 'conversationId', 'messageId',
  ]);
  assert.equal(first.body.answer, '그 변경은 갈피 화면에서 확인해줘.');
  assert.equal(first.body.canContinue, false);
  assert.equal(first.response.headers.get('cache-control'), 'no-store');
  assert.equal(responseRequests.length, 1);
  assert.match(responseRequests[0].instructions, /이 답변은 소리로 읽힌다/);
  assert.match(responseRequests[0].instructions, /잠금화면 음성 단축어/);
  assert.match(responseRequests[0].instructions, /일정·알림·메모·노트·설정·Codex/);
  assert.doesNotMatch(JSON.stringify(responseRequests[0].tools || []), /schedule_prepare/);

  const replay = await shortcutRequest(url, token, firstBody);
  assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
  assert.deepEqual(replay.body, first.body);
  assert.equal(responseRequests.length, 1);

  const conflict = await shortcutRequest(url, token, {
    ...firstBody,
    text: '다른 질문',
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.code, 'SHORTCUT_REQUEST_CONFLICT');
  assert.equal(responseRequests.length, 1);

  const concurrentBody = {
    text: '내 기억에서 중요한 것 하나 알려줘',
    requestId: '00000000-0000-4000-8000-000000000014',
  };
  const concurrent = await Promise.all([
    shortcutRequest(url, token, concurrentBody),
    shortcutRequest(url, token, concurrentBody),
  ]);
  assert.deepEqual(concurrent.map(result => result.response.status), [200, 200]);
  assert.deepEqual(concurrent[0].body, concurrent[1].body);
  assert.equal(responseRequests.length, 2);

  const scopedCannotChat = await requestJson(url, '/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message: '우회', model: 'gpt', sessionId: 'shared-main' }),
  });
  assert.equal(scopedCannotChat.response.status, 401);
  assert.equal(responseRequests.length, 2);

  const tooLarge = await requestJson(url, '/api/voice/shortcut/turn', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      text: '가'.repeat(9000),
      requestId: '00000000-0000-4000-8000-000000000015',
    }),
  });
  assert.equal(tooLarge.response.status, 413);
  assert.equal(tooLarge.body.code, 'SHORTCUT_BODY_TOO_LARGE');

  db = new Database(dbPath);
  assert.deepEqual(
    db.prepare('SELECT session_id AS sessionId, role FROM messages ORDER BY id').all(),
    [
      { sessionId: 'shared-main', role: 'user' },
      { sessionId: 'shared-main', role: 'assistant' },
      { sessionId: 'shared-main', role: 'user' },
      { sessionId: 'shared-main', role: 'assistant' },
    ],
  );
  assert.deepEqual(
    db.prepare(`
      SELECT status, attempt_count AS attemptCount,
             user_message_id IS NOT NULL AS hasUser,
             assistant_message_id IS NOT NULL AS hasAssistant
      FROM voice_shortcut_receipts
      ORDER BY id
    `).all(),
    [
      { status: 'completed', attemptCount: 1, hasUser: 1, hasAssistant: 1 },
      { status: 'completed', attemptCount: 1, hasUser: 1, hasAssistant: 1 },
    ],
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM auto_save_decisions').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM note_chunks').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assistant_tasks').get().count, 0);
  assert.ok(
    db.prepare('SELECT last_used_at AS lastUsedAt FROM assistant_shortcut_credentials').get().lastUsedAt,
  );
  const rateSubscriptionId = Number(db.prepare(`
    INSERT INTO assistant_push_subscriptions (
      endpoint, p256dh, auth, status, device_label
    ) VALUES (
      'https://web.push.apple.com/shortcut-rate-test', 'p256dh', 'auth', 'active', '속도 제한 기기'
    )
  `).run().lastInsertRowid);
  db.close();

  const rateCredential = await adminRequest(url, '/api/voice/shortcut/credentials', {
    method: 'POST',
    body: JSON.stringify({ subscriptionId: rateSubscriptionId }),
  });
  assert.equal(rateCredential.response.status, 201, JSON.stringify(rateCredential.body));
  const rateStatuses = [];
  for (let index = 0; index < 11; index += 1) {
    const result = await shortcutRequest(url, rateCredential.body.token, {
      text: '검증 전 속도 제한 요청',
      requestId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      model: 'client-owned',
    });
    rateStatuses.push(result.response.status);
  }
  assert.deepEqual(rateStatuses.slice(0, 10), Array(10).fill(400));
  assert.equal(rateStatuses[10], 429);
  assert.equal(responseRequests.length, 2);

  const revoked = await adminRequest(url, `/api/voice/shortcut/credentials/${issued.body.id}`, {
    method: 'DELETE',
  });
  assert.equal(revoked.response.status, 200);
  assert.equal(revoked.body.status, 'revoked');
  const afterRevoke = await shortcutRequest(url, token, {
    text: '이제 안 돼야 해',
    requestId: '00000000-0000-4000-8000-000000000016',
  });
  assert.equal(afterRevoke.response.status, 401);
  assert.equal(responseRequests.length, 2);
});
