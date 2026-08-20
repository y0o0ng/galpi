'use strict';

// 관심 등록이 실제 채팅 요청에 실리는 경로 (설계 6.1·9).
//
// 잠그는 것은 넷이다.
// 1. 뉴스 플래그가 켜졌을 때만 도구가 요청에 실린다.
// 2. 모델이 부르면 노트가 그 자리에서 생긴다 — 확인 카드를 거치지 않는다.
// 3. **프롬프트에 실리는 것은 topic뿐이다.** state와 reason은 노트에만 있다.
// 4. 만들어진 노트가 `owner_agent: news`와 CODEX 마커를 갖춘다.

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
const API_TOKEN = 'news-interest-test-token';

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

function textResponse(index, text) {
  return {
    id: `resp_${index}`,
    object: 'response',
    status: 'completed',
    model: 'gpt-5.6-terra',
    output_text: text,
    output: [{
      type: 'message',
      id: `msg_${index}`,
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text, annotations: [] }],
    }],
    usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
  };
}

async function startServer(t, { newsEnabled }) {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'news-interest-server-'));
  const vaultPath = path.join(appRoot, 'vault');
  await fs.mkdir(vaultPath);
  await fs.copyFile(path.join(ROOT, 'server.js'), path.join(appRoot, 'server.js'));
  for (const name of ['lib', 'scripts', 'public', 'config', '.codex', 'node_modules']) {
    await fs.symlink(path.join(ROOT, name), path.join(appRoot, name), 'dir');
  }

  const responseRequests = [];
  let toolCall = null;
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
    const answered = body.input.some(item => item?.type === 'function_call_output');
    if (toolCall && !answered) {
      return sendJson(res, 200, {
        id: `resp_tool_${responseRequests.length}`,
        object: 'response',
        status: 'completed',
        model: body.model,
        output: [{
          type: 'function_call',
          id: 'fc_news',
          call_id: 'call_news',
          name: 'news_interest_prepare',
          arguments: JSON.stringify(toolCall),
          status: 'completed',
        }],
      });
    }
    return sendJson(res, 200, textResponse(responseRequests.length, '알겠어, 지켜볼게.'));
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
      NEWS_AGENT_ENABLED: newsEnabled ? 'true' : 'false',
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

  async function ask(message) {
    const response = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': API_TOKEN },
      body: JSON.stringify({ message, model: 'gpt', sessionId: 'shared-main' }),
    });
    // body는 한 번만 읽는다. assert의 메시지 인자는 통과할 때도 평가되므로
    // 여기서 text()를 부르면 아래 json()이 빈 스트림을 만난다.
    const text = await response.text();
    assert.equal(response.status, 200, text);
    return JSON.parse(text);
  }

  async function readNote() {
    try {
      return await fs.readFile(path.join(vaultPath, 'xion-news-context.md'), 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  return {
    ask,
    readNote,
    logs,
    responseRequests,
    setToolCall(value) { toolCall = value; },
    toolNames() {
      return responseRequests.flatMap(body => (body.tools || []).map(tool => tool.name));
    },
    instructions() {
      return responseRequests.map(body => String(body.instructions || '')).join('\n');
    },
  };
}

test('플래그가 꺼져 있으면 관심 도구가 요청에 실리지 않는다', async t => {
  const server = await startServer(t, { newsEnabled: false });
  await server.ask('요즘 로컬 LLM에 관심 많아.');

  assert.ok(server.responseRequests.length > 0, '요청이 있어야 한다');
  assert.ok(!server.toolNames().includes('news_interest_prepare'));
  // 프롬프트에도 관심 규칙이 실리지 않는다.
  assert.doesNotMatch(server.instructions(), /news_interest_prepare/);
  assert.equal(await server.readNote(), null);
});

test('플래그가 켜지면 도구가 실리고, 모델이 부르면 노트가 그 자리에서 생긴다', async t => {
  const server = await startServer(t, { newsEnabled: true });

  // 아직 아무것도 없을 때: 도구는 있고, 프롬프트는 목록이 비었다고 말한다.
  server.setToolCall(null);
  await server.ask('안녕');
  assert.ok(server.toolNames().includes('news_interest_prepare'));
  assert.match(server.instructions(), /추적 중인 주제는 없다/);
  assert.equal(await server.readNote(), null);

  // 모델이 부르면 확인 카드 없이 저장된다.
  server.setToolCall({
    action: 'add',
    topic: '초경량 로컬 LLM',
    state: 'subscribed',
    reason: '앞으로 계속 알려줘',
  });
  await server.ask('초경량 로컬 LLM 소식 앞으로 계속 알려줘.');

  const note = await server.readNote();
  assert.ok(note, '관심 노트가 만들어져야 한다');
  assert.match(note, /owner_agent: news/);
  assert.match(note, /note_type: news_context/);
  assert.match(note, /### 초경량 로컬 LLM/);
  assert.match(note, /state: subscribed/);
  assert.match(note, /reason: 앞으로 계속 알려줘/);
  // Codex가 나중에 손댈 자리가 갖춰져 있어야 정리를 통과한다.
  assert.match(note, /<!-- CODEX-TAGS-START -->/);
  assert.match(note, /<!-- CODEX-LINKS-START -->/);
});

test('다음 턴 프롬프트에는 topic만 실리고 상태와 근거는 실리지 않는다', async t => {
  const server = await startServer(t, { newsEnabled: true });
  server.setToolCall({
    action: 'add',
    topic: 'Zigbee',
    state: 'subscribed',
    reason: '집 스마트홈 때문에 계속 봐줘',
  });
  await server.ask('Zigbee 소식 계속 챙겨줘.');

  server.setToolCall(null);
  const before = server.responseRequests.length;
  await server.ask('오늘 날씨 어때?');

  const later = server.responseRequests
    .slice(before)
    .map(body => String(body.instructions || ''))
    .join('\n');
  const list = later.slice(later.indexOf('지금 추적 중인 주제:'));
  assert.match(list, /- Zigbee/);
  assert.doesNotMatch(list, /subscribed/);
  assert.doesNotMatch(later, /집 스마트홈/);
});
