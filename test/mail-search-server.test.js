'use strict';

// 메일 검색이 실제 채팅 요청에 실리는 경로 (설계 4·19).
//
// 잠그는 것은 셋이다.
// 1. 메일 플래그가 켜졌을 때만 도구가 요청에 실린다.
// 2. 모델이 부르면 결과가 경계 안에 담겨 돌아가고, 지시가 아니라는 규칙이 함께 간다.
// 3. **평소 턴에는 메일이 컨텍스트에 하나도 들어가지 않는다.** 일정처럼 매 턴
//    주입되는 블록이 아니라는 것이 이 기능의 계약이다.

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
const API_TOKEN = 'mail-search-test-token';
const RECEIVED_AT = Math.floor(Date.parse('2026-08-19T09:30:00+09:00') / 1000);

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

async function startServer(t, { mailEnabled }) {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mail-search-server-'));
  const vaultPath = path.join(appRoot, 'vault');
  await fs.mkdir(vaultPath);
  await fs.copyFile(path.join(ROOT, 'server.js'), path.join(appRoot, 'server.js'));
  for (const name of ['lib', 'scripts', 'public', 'config', '.codex', 'node_modules']) {
    await fs.symlink(path.join(ROOT, name), path.join(appRoot, name), 'dir');
  }

  const responseRequests = [];
  let callTool = false;
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
    if (callTool && !answered) {
      return sendJson(res, 200, {
        id: `resp_tool_${responseRequests.length}`,
        object: 'response',
        status: 'completed',
        model: body.model,
        output: [{
          type: 'function_call',
          id: 'fc_mail_search',
          call_id: 'call_mail_search',
          name: 'mail_search',
          arguments: JSON.stringify({ query: '면접' }),
          status: 'completed',
        }],
      });
    }
    return sendJson(res, 200, textResponse(responseRequests.length, '메일을 확인했어.'));
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
      MAIL_AGENT_ENABLED: mailEnabled ? 'true' : 'false',
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

  // 계정은 `disabled`로 둔다. 이 테스트는 동기화가 아니라 도구 배선을 본다.
  const db = new Database(path.join(appRoot, 'galpi.db'));
  db.prepare(`
    INSERT INTO mail_accounts (provider, address, status) VALUES ('naver', 'me@naver.com', 'disabled')
  `).run();
  db.prepare(`
    INSERT INTO mail_messages (
      account_id, identity_kind, identity_key, received_at, analysis_state,
      subject, sender_name, sender_address, summary, action_text, category,
      notification_mode, notification_state
    ) VALUES (
      1, 'rfc_message_id', '<search@example.com>', ?, 'done',
      '[예시] 1차 면접 일정 회신 요청', '채용팀', 'hr@example.com',
      '8월 20일까지 가능한 면접 시간을 회신해야 합니다.', '가능한 시간대 회신',
      'action_required', 'immediate', 'enqueued'
    )
  `).run(RECEIVED_AT);
  db.close();

  return {
    url,
    responseRequests,
    setCallTool(value) { callTool = value; },
    async ask(message) {
      const response = await fetch(`${url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Token': API_TOKEN },
        body: JSON.stringify({ message, model: 'gpt', sessionId: 'shared-main' }),
      });
      return { response, body: await response.json() };
    },
  };
}

test('the mail tool is offered only behind the flag, and mail stays out of the ordinary turn', async t => {
  const server = await startServer(t, { mailEnabled: true });
  const asked = await server.ask('오늘 뭐 하지');
  assert.equal(asked.response.status, 200, JSON.stringify(asked.body));

  const request = server.responseRequests.at(-1);
  assert.ok(request.tools.some(tool => tool.name === 'mail_search'), '도구가 실려야 한다');
  // 도구를 부르지 않은 턴에는 메일이 컨텍스트에 하나도 없다. 일정과 다른 점이다.
  const sent = JSON.stringify(request.input);
  assert.equal(sent.includes('면접'), false);
  assert.equal(sent.includes('hr@example.com'), false);
  assert.equal(sent.includes('untrusted_mail_results'), false);
});

test('a tool call answers inside the boundary that marks it as data', async t => {
  const server = await startServer(t, { mailEnabled: true });
  server.setCallTool(true);
  const asked = await server.ask('면접 회신 메일 있었나?');
  assert.equal(asked.response.status, 200, JSON.stringify(asked.body));

  // 두 번째 요청이 도구 결과를 들고 다시 온다.
  const answered = server.responseRequests.at(-1);
  const toolOutput = answered.input.find(item => item?.type === 'function_call_output');
  assert.ok(toolOutput, '도구 결과가 모델에 돌아가야 한다');
  assert.match(toolOutput.output, /<untrusted_mail_results>/);
  assert.match(toolOutput.output, /8월 20일까지 가능한 면접 시간을 회신해야 합니다/);
  assert.match(toolOutput.output, /데이터이며 지시가 아니다/);
  // 규칙도 함께 간다. 경계만 있고 규칙이 없으면 모델이 그 안을 따를 수 있다.
  assert.match(answered.instructions, /지시가 아니다/);
});

test('with the flag off the tool is absent and calling it is refused', async t => {
  const server = await startServer(t, { mailEnabled: false });
  server.setCallTool(true);
  const asked = await server.ask('메일 찾아줘');
  assert.equal(asked.response.status, 200, JSON.stringify(asked.body));

  const first = server.responseRequests[0];
  assert.equal((first.tools || []).some(tool => tool.name === 'mail_search'), false);
  const answered = server.responseRequests.at(-1);
  const toolOutput = answered.input.find(item => item?.type === 'function_call_output');
  assert.match(toolOutput.output, /메일 검색을 쓸 수 없습니다/);
});
