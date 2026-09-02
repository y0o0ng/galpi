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

const ROOT = path.resolve(__dirname, '..');
const API_TOKEN = 'github-wiring-test-token';

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

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(value));
}

function textResponse(index) {
  return {
    id: `resp_${index}`,
    object: 'response',
    status: 'completed',
    model: 'gpt-5.6-terra',
    output_text: '확인했어.',
    output: [{
      type: 'message',
      id: `msg_${index}`,
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: '확인했어.', annotations: [] }],
    }],
    usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
  };
}

async function startServer(t, { githubEnabled }) {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'github-wiring-server-'));
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
    if (req.url !== '/v1/responses') return sendJson(res, 404, { error: { message: 'not found' } });
    responseRequests.push(body);
    return sendJson(res, 200, textResponse(responseRequests.length));
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
      OPENAI_API_KEY: 'test-key',
      OPENAI_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`,
      GPT_RESPONSES_ENABLED: 'true',
      GPT_CHAT_BOOTSTRAP_MODEL: 'gpt-5.6-terra',
      MODEL_CATALOG_REFRESH_ENABLED: 'false',
      API_TOKEN,
      HOST: '127.0.0.1',
      PORT: String(port),
      VAULT_PATH: vaultPath,
      BACKUP_DIR: path.join(appRoot, 'backups'),
      CODEX_RUNNER_MODE: 'heuristic',
      ASSISTANT_TASKS_ENABLED: 'false',
      WEB_PUSH_ENABLED: 'false',
      MAIL_AGENT_ENABLED: 'false',
      NEWS_AGENT_ENABLED: 'false',
      GITHUB_MCP_CHAT_ENABLED: githubEnabled ? 'true' : 'false',
      GITHUB_MCP_TOKEN: '',
      GITHUB_MCP_REPOSITORY: '',
      CONTEXT_N: '2',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => logs.push(chunk.toString()));
  child.stderr.on('data', chunk => logs.push(chunk.toString()));
  t.after(async () => {
    if (child.exitCode === null) {
      await new Promise(resolve => {
        child.once('exit', resolve);
        child.kill('SIGTERM');
      });
    }
    await new Promise(resolve => provider.close(resolve));
    await fs.rm(appRoot, { recursive: true, force: true });
  });
  await waitForServer(child, url, logs);

  return {
    responseRequests,
    async ask(message, source) {
      const response = await fetch(`${url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Token': API_TOKEN },
        body: JSON.stringify({
          message,
          model: 'gpt',
          sessionId: 'shared-main',
          ...(source ? { source } : {}),
        }),
      });
      const text = await response.text();
      assert.equal(response.status, 200, text);
      return JSON.parse(text);
    },
  };
}

test('GitHub tools require the explicit chat enable flag', async t => {
  const server = await startServer(t, { githubEnabled: false });
  await server.ask('최신 main의 README를 확인해줘');

  const request = server.responseRequests.at(-1);
  assert.equal((request.tools || []).some(tool => tool.name === 'github_read'), false);
  assert.doesNotMatch(String(request.instructions || ''), /GitHub이 현재 저장소의 정본/);
});

test('normal text and half-duplex voice receive the lazy GitHub session', async t => {
  const server = await startServer(t, { githubEnabled: true });
  await server.ask('최신 main의 README를 확인해줘');
  const textRequest = server.responseRequests.at(-1);

  assert.ok((textRequest.tools || []).some(tool => tool.name === 'github_read'));
  assert.match(textRequest.instructions, /GitHub이 현재 저장소의 정본/);
  assert.match(textRequest.instructions, /신뢰하지 않는 근거 데이터/);

  await server.ask('최신 main의 README를 읽어줘', 'voice');
  const voiceRequest = server.responseRequests.at(-1);
  assert.ok((voiceRequest.tools || []).some(tool => tool.name === 'github_read'));
  assert.match(voiceRequest.instructions, /GitHub이 현재 저장소의 정본/);
  assert.match(voiceRequest.instructions, /신뢰하지 않는 근거 데이터/);
});

test('shortcut is explicitly excluded and model generation always owns cleanup', async () => {
  const source = await fs.readFile(path.join(ROOT, 'server.js'), 'utf8');
  const shortcut = source.slice(
    source.indexOf('const shortcutRoutes = createVoiceShortcutRoutes'),
    source.indexOf('voiceShortcutTurnHandler = shortcutRoutes.handleTurn'),
  );
  assert.match(shortcut, /allowGitHub: false/);

  const generation = source.slice(
    source.indexOf('const githubSession ='),
    source.indexOf('spokenStream\?\.flush\(\)'),
  );
  assert.match(generation, /try \{/);
  assert.match(generation, /await generateChatReply/);
  assert.match(generation, /finally \{/);
  assert.match(generation, /await githubSession\?\.close\(\)/);
});
