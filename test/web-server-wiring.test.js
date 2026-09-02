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
const API_TOKEN = 'web-wiring-test-token';
const WEB_TOOL_NAMES = ['web_search', 'web_fetch'];

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

async function startServer(t, { webEnabled, responseMode = 'final' }) {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'web-wiring-server-'));
  const vaultPath = path.join(appRoot, 'vault');
  await fs.mkdir(vaultPath);
  await fs.copyFile(path.join(ROOT, 'server.js'), path.join(appRoot, 'server.js'));
  for (const name of ['lib', 'scripts', 'public', '.codex', 'node_modules']) {
    await fs.symlink(path.join(ROOT, name), path.join(appRoot, name), 'dir');
  }
  await fs.mkdir(path.join(appRoot, 'config'));
  const policy = JSON.parse(await fs.readFile(path.join(ROOT, 'config/codex-policy.json'), 'utf8'));
  policy.webSearch.enabled = webEnabled;
  await fs.writeFile(path.join(appRoot, 'config/codex-policy.json'), JSON.stringify(policy));
  const preloadPath = path.join(appRoot, 'redirect-tavily.js');
  await fs.writeFile(preloadPath, [
    "'use strict';",
    'const originalFetch = globalThis.fetch;',
    'globalThis.fetch = (input, options) => {',
    "  const url = String(input);",
    "  if (url === 'https://api.tavily.com/extract') {",
    "    return originalFetch(`${process.env.TEST_TAVILY_BASE_URL}/tavily/extract`, options);",
    '  }',
    '  return originalFetch(input, options);',
    '};',
  ].join('\n'));

  const responseRequests = [];
  const tavilyRequests = [];
  const provider = http.createServer(async (req, res) => {
    const body = await readJson(req);
    if (req.url === '/tavily/extract') {
      tavilyRequests.push({ body, authorization: req.headers.authorization });
      return sendJson(res, 200, {
        results: [{ url: body.urls, raw_content: '# Direct page\nFetched evidence.' }],
        failed_results: [],
        usage: { credits: 1 },
      });
    }
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
    if (responseMode === 'fetch' && !body.input.some(item => item?.type === 'function_call_output')) {
      return sendJson(res, 200, {
        id: 'resp_fetch_call',
        object: 'response',
        status: 'completed',
        model: 'gpt-5.6-terra',
        output: [{
          type: 'function_call',
          id: 'fc_fetch',
          call_id: 'call_fetch',
          name: 'web_fetch',
          arguments: JSON.stringify({ url: 'https://example.com/direct' }),
          status: 'completed',
        }],
      });
    }
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
      GITHUB_MCP_CHAT_ENABLED: 'false',
      TAVILY_API_KEY: 'offline-test-key',
      TEST_TAVILY_BASE_URL: `http://127.0.0.1:${provider.address().port}`,
      NODE_OPTIONS: `--require=${preloadPath}`,
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
    tavilyRequests,
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

test('disabled web policy exposes neither web model tool', async t => {
  const server = await startServer(t, { webEnabled: false });
  await server.ask('최신 외부 정보를 확인해줘');
  const request = server.responseRequests.at(-1);
  assert.deepEqual((request.tools || []).filter(tool => WEB_TOOL_NAMES.includes(tool.name)), []);
  assert.doesNotMatch(String(request.instructions || ''), /web_fetch는/);
});

test('normal text and half-duplex voice receive web_search and web_fetch', async t => {
  const server = await startServer(t, { webEnabled: true });
  await server.ask('최신 외부 정보를 확인해줘');
  const textRequest = server.responseRequests.at(-1);
  assert.deepEqual(
    (textRequest.tools || []).map(tool => tool.name).filter(name => WEB_TOOL_NAMES.includes(name)),
    WEB_TOOL_NAMES,
  );
  assert.match(textRequest.instructions, /web_fetch는 사용자가 준 공개 URL/);
  assert.match(textRequest.instructions, /신뢰하지 않는 외부 근거 데이터/);

  await server.ask('이 URL을 읽어줘', 'voice');
  const voiceRequest = server.responseRequests.at(-1);
  assert.deepEqual(
    (voiceRequest.tools || []).map(tool => tool.name).filter(name => WEB_TOOL_NAMES.includes(name)),
    WEB_TOOL_NAMES,
  );
  assert.match(voiceRequest.instructions, /web_fetch는 사용자가 준 공개 URL/);
});

test('direct fetch execution returns the fetched URL through existing chat provenance', async t => {
  const server = await startServer(t, { webEnabled: true, responseMode: 'fetch' });
  const result = await server.ask('https://example.com/direct 읽어줘');
  assert.equal(server.tavilyRequests.length, 1);
  assert.equal(server.tavilyRequests[0].authorization, 'Bearer offline-test-key');
  assert.deepEqual(server.tavilyRequests[0].body, {
    urls: 'https://example.com/direct',
    extract_depth: 'basic',
    format: 'markdown',
    include_images: false,
    include_usage: true,
  });
  assert.equal(result.webSources[0].url, 'https://example.com/direct');
  const toolOutput = server.responseRequests[1].input.find(item => item.type === 'function_call_output');
  assert.match(toolOutput.output, /untrusted_web_evidence/);
});

test('server delegates web tools to one session, keeps news on service, and excludes shortcut', async () => {
  const source = await fs.readFile(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(source, /toolUse\.name === 'web_search' \|\| toolUse\.name === 'web_fetch'/);
  assert.match(source, /webToolSession\.execute\(toolUse\.name, toolUse\.input\)/);
  assert.match(source, /search: \(query, options\) => webService\.search\(query, options\)/);

  const normalRoute = source.slice(
    source.indexOf("app.post('/api/chat'"),
    source.indexOf("app.post('/api/vault/save-document'"),
  );
  assert.match(normalRoute, /allowWebTools: true/);

  const shortcut = source.slice(
    source.indexOf('const shortcutRoutes = createVoiceShortcutRoutes'),
    source.indexOf('voiceShortcutTurnHandler = shortcutRoutes.handleTurn'),
  );
  assert.match(shortcut, /allowWebTools: false/);
});
