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

function pcmWav({ seconds = 1, amplitude = 0.2 } = {}) {
  const sampleRate = 16000;
  const samples = Math.round(seconds * sampleRate);
  const buffer = Buffer.alloc(44 + (samples * 2));
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + (samples * 2), 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    buffer.writeInt16LE(Math.round(Math.sin(index / 20) * amplitude * 0x7fff), 44 + (index * 2));
  }
  return buffer;
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
    const body = await readBody(req);
    providerRequests.push({
      url: req.url,
      authorization: req.headers.authorization,
      safetyIdentifier: req.headers['openai-safety-identifier'],
      body,
    });
    if (req.url === '/v1/embeddings') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        object: 'list',
        data: [{ object: 'embedding', index: 0, embedding: [1, 0, 0] }],
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: 1, total_tokens: 1 },
      }));
      return;
    }
    if (req.url === '/v1/audio/transcriptions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        text: '서버가 보정한 음성 문장',
        usage: {
          input_tokens: 10,
          input_token_details: { audio_tokens: 10 },
          output_tokens: 5,
          total_tokens: 15,
        },
      }));
      return;
    }
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
      OPENAI_REALTIME_READ_TOOLS_ENABLED: 'true',
      OPENAI_REALTIME_CORRECTION_ENABLED: 'true',
      OPENAI_REALTIME_CANONICAL_TRANSCRIPTION_MODEL: 'gpt-transcribe',
      GPT_RESPONSES_ENABLED: 'false',
      MODEL_CATALOG_REFRESH_ENABLED: 'false',
      ASSISTANT_RETRIEVAL_A2_ENABLED: 'true',
      API_TOKEN,
      HOST: '127.0.0.1',
      PORT: String(port),
      VAULT_PATH: vaultPath,
      BACKUP_DIR: path.join(appRoot, 'backups'),
      CODEX_RUNNER_MODE: 'heuristic',
      ASSISTANT_TASKS_ENABLED: 'true',
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
    voice: 'cedar',
    maxSessionSeconds: 300,
    maxOutputTokens: 4096,
    readToolsEnabled: true,
    correctionEnabled: true,
    canonicalTranscriptionModel: 'gpt-transcribe',
    maxTurnSeconds: 120,
    maxTurnBytes: 8388608,
    finalizeEnabled: false,
  });
  assert.doesNotMatch(JSON.stringify(config), /server-only-realtime-key/);

  await fs.mkdir(path.join(vaultPath, '_system'));
  await fs.writeFile(path.join(vaultPath, '_system', 'memory.md'), [
    '# 사용자 메모리',
    '',
    '- 대답은 친구처럼 편하게 반말로 해줘',
    '- 설명은 결론부터 간결하게 해줘',
    '- 좋아하는 음식은 냉면',
  ].join('\n'));
  await fs.writeFile(path.join(vaultPath, 'poems.md'), [
    '---',
    'title: "시"',
    'note_type: topic',
    'archived: false',
    'codex_status: processed',
    'ai_readable: true',
    '---',
    '# 시',
    '',
    '볼트 전문은 QA 청크 회수에 사용하지 않는다.',
  ].join('\n'));
  const seedDb = new Database(path.join(appRoot, 'galpi.db'));
  seedDb.prepare('INSERT OR IGNORE INTO sessions (id) VALUES (?)').run('shared-main');
  const insertMessage = seedDb.prepare(`
    INSERT INTO messages (session_id, role, content, model, created_at)
    VALUES ('shared-main', ?, ?, 'GPT', ?)
  `);
  [
    ['user', '오래된 질문', 1],
    ['assistant', '오래된 답변', 2],
    ['user', '첫 번째 최근 질문', 3],
    ['assistant', '첫 번째 최근 답변', 4],
    ['user', '두 번째 최근 질문', 5],
    ['assistant', '두 번째 최근 답변', 6],
    ['user', '세 번째 최근 질문', 7],
    ['assistant', '세 번째 최근 답변', 8],
    ['user', '아직 답이 없는 질문', 9],
  ].forEach(([role, content, createdAt]) => insertMessage.run(role, content, createdAt));
  seedDb.prepare(`
    INSERT INTO notes (
      filename, title, note_type, archived, codex_status, index_status, ai_readable
    ) VALUES (?, ?, 'topic', 0, 'processed', 'ready', 1)
  `).run('poems.md', '시');
  seedDb.prepare(`
    INSERT INTO note_chunks (
      chunk_id, note_filename, note_title, chunk_type, content, index_status
    ) VALUES (?, ?, ?, 'topic_qa', ?, 'ready')
  `).run('qa-poem-1', 'poems.md', '시', 'Q: 마음에 드는 시를 보여줘\nA: QA 청크에서 읽은 한 편의 시');
  seedDb.close();

  const db = new Database(path.join(appRoot, 'galpi.db'), { readonly: true });
  const applicationTables = [
    'messages',
    'notes',
    'assistant_tasks',
    'assistant_task_events',
    'assistant_reminders',
    'assistant_retrieval_shadow_runs',
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
  const toolSessionId = response.headers.get('x-galpi-realtime-tool-session');
  assert.match(toolSessionId, /^[A-Za-z0-9_-]+$/);
  const correctionSessionId = response.headers.get('x-galpi-realtime-correction-session');
  assert.match(correctionSessionId, /^[A-Za-z0-9_-]+$/);
  assert.equal(await response.text(), 'v=0\r\no=provider-answer\r\n');
  assert.equal(providerRequests.length, 1);
  assert.equal(providerRequests[0].url, '/v1/realtime/calls');
  assert.equal(providerRequests[0].authorization, 'Bearer server-only-realtime-key');
  assert.match(providerRequests[0].safetyIdentifier, /^[a-f0-9]{64}$/);
  const multipartBody = providerRequests[0].body.toString('utf8');
  assert.match(multipartBody, /v=0\r\no=browser-offer/);
  assert.match(multipartBody, /gpt-realtime-2\.1-mini/);
  assert.match(multipartBody, /"voice":"cedar"/);
  assert.match(multipartBody, /gpt-4o-mini-transcribe/);
  assert.match(multipartBody, /친구처럼 편하게 반말/);
  assert.match(multipartBody, /결론부터 간결하게/);
  assert.doesNotMatch(multipartBody, /좋아하는 음식은 냉면/);
  assert.doesNotMatch(multipartBody, /오래된 질문/);
  assert.match(multipartBody, /첫 번째 최근 질문/);
  assert.match(multipartBody, /세 번째 최근 답변/);
  assert.doesNotMatch(multipartBody, /아직 답이 없는 질문/);
  assert.match(multipartBody, /galpi_context_lookup/);
  assert.match(multipartBody, /galpi_current_time/);
  assert.match(multipartBody, /galpi_note_search/);
  assert.match(multipartBody, /galpi_note_read/);
  assert.match(multipartBody, /schedule_read/);
  assert.doesNotMatch(multipartBody, /"name":"(?:note_save|task_create|task_complete|task_cancel|codex[^"]*)"/i);

  const unauthorizedTool = await fetch(`${url}/api/voice/realtime/tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(unauthorizedTool.status, 401);

  const schedulePayload = {
    sessionId: toolSessionId,
    turnId: 'turn-1',
    callId: 'call-1',
    name: 'schedule_read',
    arguments: '{}',
  };
  const scheduleResponse = await fetch(`${url}/api/voice/realtime/tool`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Token': API_TOKEN,
    },
    body: JSON.stringify(schedulePayload),
  });
  assert.equal(scheduleResponse.status, 200);
  const scheduleOutput = (await scheduleResponse.json()).output;
  assert.equal(scheduleOutput.status, 'no_match');
  assert.match(scheduleOutput.content, /활성 일정: 없음/);

  const duplicateResponse = await fetch(`${url}/api/voice/realtime/tool`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Token': API_TOKEN,
    },
    body: JSON.stringify(schedulePayload),
  });
  assert.equal(duplicateResponse.status, 200);
  assert.deepEqual((await duplicateResponse.json()).output, scheduleOutput);

  const memoryResponse = await fetch(`${url}/api/voice/realtime/tool`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Token': API_TOKEN,
    },
    body: JSON.stringify({
      sessionId: toolSessionId,
      turnId: 'turn-1',
      callId: 'call-2',
      name: 'galpi_context_lookup',
      arguments: '{"query":"저장하지 않은 미지의 질문"}',
    }),
  });
  assert.equal(memoryResponse.status, 200);
  const memoryOutput = (await memoryResponse.json()).output;
  assert.equal(memoryOutput.status, 'no_match');
  assert.equal(memoryOutput.content, '');
  assert.equal(providerRequests.filter(request => request.url === '/v1/embeddings').length, 1);

  const noteSearchResponse = await fetch(`${url}/api/voice/realtime/tool`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Token': API_TOKEN,
    },
    body: JSON.stringify({
      sessionId: toolSessionId,
      turnId: 'turn-note',
      callId: 'call-note-search',
      name: 'galpi_note_search',
      arguments: '{"query":"시"}',
    }),
  });
  assert.equal(noteSearchResponse.status, 200);
  const noteSearchOutput = (await noteSearchResponse.json()).output;
  assert.equal(noteSearchOutput.status, 'found');
  assert.match(noteSearchOutput.content, /poems\.md/);

  const noteReadResponse = await fetch(`${url}/api/voice/realtime/tool`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Token': API_TOKEN,
    },
    body: JSON.stringify({
      sessionId: toolSessionId,
      turnId: 'turn-note',
      callId: 'call-note-read',
      name: 'galpi_note_read',
      arguments: '{"filename":"poems.md"}',
    }),
  });
  assert.equal(noteReadResponse.status, 200);
  const noteReadOutput = (await noteReadResponse.json()).output;
  assert.equal(noteReadOutput.status, 'found');
  assert.match(noteReadOutput.content, /QA 청크에서 읽은 한 편의 시/);
  assert.doesNotMatch(noteReadOutput.content, /볼트 전문은 QA 청크 회수에 사용하지 않는다/);

  const limitedResponse = await fetch(`${url}/api/voice/realtime/tool`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Token': API_TOKEN,
    },
    body: JSON.stringify({
      sessionId: toolSessionId,
      turnId: 'turn-1',
      callId: 'call-3',
      name: 'schedule_read',
      arguments: '{}',
    }),
  });
  assert.equal(limitedResponse.status, 429);
  assert.equal((await limitedResponse.json()).code, 'REALTIME_TOOL_CALL_LIMIT');

  const unauthorizedCorrection = await fetch(
    `${url}/api/voice/realtime/turns/1/transcribe`,
    {
      method: 'POST',
      body: new FormData(),
    },
  );
  assert.equal(unauthorizedCorrection.status, 401);

  const correctionAudio = pcmWav();
  const correctionForm = () => {
    const form = new FormData();
    form.set('session_id', correctionSessionId);
    form.set('input_item_id', 'input-correction-1');
    form.set('duration_ms', '1000');
    form.set('audio', new Blob([correctionAudio], { type: 'audio/wav' }), 'turn.wav');
    return form;
  };
  const correctionResponse = await fetch(
    `${url}/api/voice/realtime/turns/1/transcribe`,
    {
      method: 'POST',
      headers: { 'X-API-Token': API_TOKEN },
      body: correctionForm(),
    },
  );
  const correctionPayload = await correctionResponse.json();
  assert.equal(
    correctionResponse.status,
    200,
    `${JSON.stringify(correctionPayload)}\n${logs.join('')}`,
  );
  assert.deepEqual(correctionPayload, {
    correctedTranscript: '서버가 보정한 음성 문장',
    model: 'gpt-transcribe',
    usage: {
      input_tokens: 10,
      input_token_details: { audio_tokens: 10 },
      output_tokens: 5,
      total_tokens: 15,
    },
    durationMs: 1000,
    duplicate: false,
  });

  const duplicateCorrection = await fetch(
    `${url}/api/voice/realtime/turns/1/transcribe`,
    {
      method: 'POST',
      headers: { 'X-API-Token': API_TOKEN },
      body: correctionForm(),
    },
  );
  assert.equal(duplicateCorrection.status, 200);
  assert.equal((await duplicateCorrection.json()).duplicate, true);
  assert.equal(
    providerRequests.filter(request => request.url === '/v1/audio/transcriptions').length,
    1,
  );
  const transcriptionRequest = providerRequests.find(
    request => request.url === '/v1/audio/transcriptions',
  );
  assert.equal(transcriptionRequest.authorization, 'Bearer server-only-realtime-key');
  assert.match(transcriptionRequest.body.toString('latin1'), /gpt-transcribe/);

  const conflictForm = new FormData();
  conflictForm.set('session_id', correctionSessionId);
  conflictForm.set('input_item_id', 'input-correction-1');
  conflictForm.set('duration_ms', '1000');
  conflictForm.set(
    'audio',
    new Blob([pcmWav({ amplitude: 0.8 })], { type: 'audio/wav' }),
    'turn.wav',
  );
  const conflictCorrection = await fetch(
    `${url}/api/voice/realtime/turns/1/transcribe`,
    {
      method: 'POST',
      headers: { 'X-API-Token': API_TOKEN },
      body: conflictForm,
    },
  );
  assert.equal(conflictCorrection.status, 409);
  assert.equal((await conflictCorrection.json()).code, 'REALTIME_TRANSCRIPTION_CONFLICT');

  assert.deepEqual(tableCounts(db, applicationTables), beforeCounts);
  assert.deepEqual(await fs.readdir(vaultPath), beforeVault);
  db.close();
});

test('R2c-1 finalization writes one corrected pair and drops throat-clear turns', async t => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'realtime-finalize-'));
  const vaultPath = path.join(appRoot, 'vault');
  await fs.mkdir(vaultPath);
  await fs.copyFile(path.join(ROOT, 'server.js'), path.join(appRoot, 'server.js'));
  for (const name of ['lib', 'scripts', 'public', 'config', '.codex', 'node_modules']) {
    await fs.symlink(path.join(ROOT, name), path.join(appRoot, name), 'dir');
  }

  let correctedText = '내일 오후 회의가 몇 시였는지 알려줄 수 있어?';
  const provider = http.createServer(async (req, res) => {
    await readBody(req);
    if (req.url === '/v1/embeddings') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        object: 'list',
        data: [{ object: 'embedding', index: 0, embedding: [1, 0, 0] }],
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: 1, total_tokens: 1 },
      }));
      return;
    }
    if (req.url === '/v1/audio/transcriptions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text: correctedText }));
      return;
    }
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
      OPENAI_REALTIME_CORRECTION_ENABLED: 'true',
      OPENAI_REALTIME_FINALIZE_ENABLED: 'true',
      OPENAI_REALTIME_CANONICAL_TRANSCRIPTION_MODEL: 'gpt-transcribe',
      GPT_RESPONSES_ENABLED: 'false',
      MODEL_CATALOG_REFRESH_ENABLED: 'false',
      API_TOKEN,
      HOST: '127.0.0.1',
      PORT: String(port),
      VAULT_PATH: vaultPath,
      BACKUP_DIR: path.join(appRoot, 'backups'),
      CODEX_RUNNER_MODE: 'heuristic',
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

  const configResponse = await fetch(`${url}/api/config`, {
    headers: { 'X-API-Token': API_TOKEN },
  });
  assert.equal((await configResponse.json()).realtimeVoice.finalizeEnabled, true);

  const sdp = await fetch(`${url}/api/voice/realtime/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp', 'X-API-Token': API_TOKEN },
    body: 'v=0\r\no=caller\r\n',
  });
  const correctionSessionId = sdp.headers.get('x-galpi-realtime-correction-session');

  const correct = async (inputItemId, audio) => {
    const form = new FormData();
    form.set('session_id', correctionSessionId);
    form.set('input_item_id', inputItemId);
    form.set('duration_ms', '1000');
    form.set('audio', new Blob([audio], { type: 'audio/wav' }), 'turn.wav');
    const response = await fetch(
      `${url}/api/voice/realtime/turns/${inputItemId}/transcribe`,
      { method: 'POST', headers: { 'X-API-Token': API_TOKEN }, body: form },
    );
    return { status: response.status, body: await response.json() };
  };
  const reportAssistant = async (inputItemId, payload) => {
    const response = await fetch(
      `${url}/api/voice/realtime/turns/${inputItemId}/assistant`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Token': API_TOKEN },
        body: JSON.stringify({
          session_id: correctionSessionId,
          input_item_id: inputItemId,
          ...payload,
        }),
      },
    );
    return { status: response.status, body: await response.json() };
  };

  const db = new Database(path.join(appRoot, 'galpi.db'), { readonly: true });
  const messages = () => db
    .prepare('SELECT id, session_id, role, content FROM messages ORDER BY id ASC')
    .all();

  // 보정만 도착한 동안에는 아무것도 저장하지 않는다.
  const firstCorrection = await correct('item-real', pcmWav());
  assert.equal(firstCorrection.status, 200);
  assert.equal(firstCorrection.body.receipt.finalized, false);
  assert.equal(messages().length, 0);

  const finalize = await reportAssistant('item-real', {
    final_response_id: 'resp-real',
    assistant_transcript: '내일 오후 3시야. 회의실은 2층으로 잡혀 있어.',
    assistant_status: 'completed',
  });
  assert.equal(finalize.status, 200, JSON.stringify(finalize.body));
  assert.equal(finalize.body.receipt.finalized, true);

  const savedPair = messages();
  assert.equal(savedPair.length, 2);
  assert.deepEqual(savedPair.map(row => row.role), ['user', 'assistant']);
  assert.deepEqual(savedPair.map(row => row.session_id), ['shared-main', 'shared-main']);
  assert.ok(savedPair[0].id < savedPair[1].id);
  assert.equal(savedPair[0].content, correctedText);

  // 같은 턴을 다시 보고해도 message를 늘리지 않는다.
  const repeated = await reportAssistant('item-real', {
    final_response_id: 'resp-real',
    assistant_transcript: '내일 오후 3시야. 회의실은 2층으로 잡혀 있어.',
    assistant_status: 'completed',
  });
  assert.equal(repeated.body.receipt.userMessageId, finalize.body.receipt.userMessageId);
  assert.equal(messages().length, 2);

  // 헛기침 턴은 보정본이 있어도 저장하지 않는다.
  correctedText = '음.';
  const throatClear = await correct('item-cough', pcmWav({ amplitude: 0.3 }));
  assert.equal(throatClear.status, 200);
  const discarded = await reportAssistant('item-cough', { assistant_status: 'cancelled' });
  assert.equal(discarded.body.receipt.discarded, true);
  assert.equal(discarded.body.receipt.userMessageId, null);
  assert.equal(messages().length, 2);

  const receipts = db.prepare(`
    SELECT input_item_id AS inputItemId, status, error_code AS errorCode
    FROM realtime_turn_receipts ORDER BY input_item_id
  `).all();
  assert.deepEqual(receipts, [
    { inputItemId: 'item-cough', status: 'discarded', errorCode: 'empty_turn' },
    { inputItemId: 'item-real', status: 'finalized', errorCode: null },
  ]);

  const badStatus = await reportAssistant('item-real', { assistant_status: 'bogus' });
  assert.equal(badStatus.status, 400);
  assert.equal(badStatus.body.code, 'REALTIME_FINALIZE_INVALID_STATUS');

  const unauthorized = await fetch(`${url}/api/voice/realtime/turns/item-real/assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: 'x', input_item_id: 'y', assistant_status: 'completed' }),
  });
  assert.equal(unauthorized.status, 401);

  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notes').get().count, 0);
  db.close();
});
