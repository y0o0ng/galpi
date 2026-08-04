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
const API_TOKEN = 'gpt-responses-test-token';

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
    if (child.exitCode !== null) {
      throw new Error(`테스트 서버가 일찍 종료됐습니다: ${logs.join('')}`);
    }
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

async function api(url, pathname, options = {}) {
  const response = await fetch(`${url}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Token': API_TOKEN,
      ...options.headers,
    },
  });
  return {
    response,
    body: await response.json(),
  };
}

test('GPT Responses chat snapshots the model and commits each exchange atomically', async t => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gpt-responses-server-'));
  const vaultPath = path.join(appRoot, 'vault');
  await fs.mkdir(vaultPath);
  await fs.copyFile(path.join(ROOT, 'server.js'), path.join(appRoot, 'server.js'));
  for (const name of ['lib', 'scripts', 'public', 'config', '.codex', 'node_modules']) {
    await fs.symlink(path.join(ROOT, name), path.join(appRoot, name), 'dir');
  }

  let responseMode = 'completed';
  const responseRequests = [];
  let inspectedAttachmentId = null;
  const attachmentStatesAtProvider = [];
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
      if (inspectedAttachmentId) {
        const probeDb = new Database(path.join(appRoot, 'galpi.db'), { readonly: true });
        attachmentStatesAtProvider.push(probeDb.prepare(`
          SELECT lifecycle_status AS status
          FROM attachments WHERE id = ?
        `).get(inspectedAttachmentId)?.status || null);
        probeDb.close();
      }
      if (responseMode === 'incomplete') {
        return sendJson(res, 200, {
          id: 'resp_incomplete',
          object: 'response',
          status: 'incomplete',
          model: body.model,
          output: [],
        });
      }
      return sendJson(res, 200, {
        id: `resp_${responseRequests.length}`,
        object: 'response',
        status: 'completed',
        model: body.model,
        output_text: '통합 응답',
        output: [{
          type: 'message',
          id: `msg_${responseRequests.length}`,
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: '통합 응답', annotations: [] }],
        }],
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          total_tokens: 12,
        },
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
  const serverEnv = {
      ...process.env,
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: 'test-key',
      OPENAI_BASE_URL: providerUrl,
      GPT_RESPONSES_ENABLED: 'true',
      GPT_CHAT_BOOTSTRAP_MODEL: 'gpt-5.6-terra',
      GPT_CHAT_REASONING_EFFORT: 'medium',
      ASSISTANT_RETRIEVAL_A2_ENABLED: 'true',
      MODEL_CATALOG_REFRESH_ENABLED: 'false',
      API_TOKEN,
      HOST: '127.0.0.1',
      PORT: String(port),
      VAULT_PATH: vaultPath,
      BACKUP_DIR: path.join(appRoot, 'backups'),
      CODEX_RUNNER_MODE: 'heuristic',
      ASSISTANT_TASKS_ENABLED: 'false',
      WEB_PUSH_ENABLED: 'false',
      ATTACHMENTS_ENABLED: 'true',
      CONTEXT_N: '2',
  };
  const startTestServer = () => {
    const processHandle = spawn(process.execPath, ['server.js'], {
      cwd: appRoot,
      env: serverEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    processHandle.stdout.on('data', chunk => logs.push(chunk.toString()));
    processHandle.stderr.on('data', chunk => logs.push(chunk.toString()));
    return processHandle;
  };
  let child = startTestServer();

  t.after(async () => {
    await stopServer(child);
    await new Promise(resolve => provider.close(resolve));
    await fs.rm(appRoot, { recursive: true, force: true });
  });

  await waitForServer(child, url, logs);
  const topicFilename = 'retrieval-topic.md';
  await fs.writeFile(path.join(vaultPath, topicFilename), [
    '---',
    'title: 특수회수키워드',
    'note_type: topic',
    'archived: false',
    '---',
    '# 특수회수키워드',
    'LEGACY_FULL_NOTE_SECRET',
    'Q: 특수회수키워드',
    'A: CHUNK_ONLY_EVIDENCE',
  ].join('\n'));
  let db = new Database(path.join(appRoot, 'galpi.db'));
  db.prepare(`
    INSERT INTO notes (
      filename, title, note_type, archived, codex_status,
      index_status, ai_readable, embedding
    ) VALUES (?, ?, 'topic', 0, 'processed', 'ready', 1, ?)
  `).run(topicFilename, '특수회수키워드', JSON.stringify([1, 0]));
  db.prepare(`
    INSERT INTO note_chunks (
      chunk_id, note_filename, note_title, chunk_type, content,
      embedding, index_status
    ) VALUES (?, ?, ?, 'topic_qa', ?, ?, 'ready')
  `).run(
    'qa-gpt-retrieval',
    topicFilename,
    '특수회수키워드',
    'Q: 특수회수키워드\nA: CHUNK_ONLY_EVIDENCE',
    JSON.stringify([1, 0]),
  );
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count
    FROM note_chunks c
    JOIN notes n ON n.filename = c.note_filename
    WHERE c.chunk_type = 'topic_qa'
      AND c.index_status = 'ready'
      AND n.note_type = 'topic'
      AND n.archived = 0
      AND n.ai_readable = 1
      AND n.codex_status NOT IN ('running', 'recovery_required')
  `).get().count, 1);
  db.close();
  await stopServer(child);
  child = startTestServer();
  await waitForServer(child, url, logs);
  db = new Database(path.join(appRoot, 'galpi.db'));

  const catalog = await api(url, '/api/models/chat');
  assert.equal(catalog.response.status, 200);
  assert.equal(catalog.body.selection, 'auto:balanced');
  assert.equal(catalog.body.resolvedModelId, 'gpt-5.6-terra');
  const config = await api(url, '/api/config');
  assert.equal(config.body.retrievalA2Enabled, true);

  const first = await api(url, '/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      message: '특수회수키워드',
      model: 'gpt',
      sessionId: 'shared-main',
    }),
  });
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.model, 'GPT');
  assert.equal(first.body.modelId, 'gpt-5.6-terra');
  assert.equal(first.body.modelSelection, 'auto:balanced');
  assert.equal(first.body.catalogGeneration, 0);
  assert.equal(first.body.runtimeGeneration, 'gpt-single-v1');
  assert.equal(first.body.reasoningEffort, 'medium');

  const firstRequest = responseRequests[0];
  assert.equal(firstRequest.store, false);
  assert.deepEqual(firstRequest.reasoning, {
    effort: 'medium',
    context: 'current_turn',
  });
  assert.match(firstRequest.safety_identifier, /^[a-f0-9]{64}$/);
  const retrievalTrace = db.prepare(`
    SELECT notes_json AS notesJson, chunks_json AS chunksJson, error
    FROM assistant_retrieval_shadow_runs
    ORDER BY id DESC
    LIMIT 1
  `).get();
  assert.equal(retrievalTrace.error, null);
  const persistedRetrievalRows = db.prepare(`
    SELECT c.chunk_id AS chunkId, c.embedding AS chunkEmbedding,
           c.index_status AS chunkStatus, n.embedding AS noteEmbedding,
           n.codex_status AS codexStatus, n.index_status AS noteStatus
    FROM note_chunks c
    JOIN notes n ON n.filename = c.note_filename
    WHERE c.chunk_id = 'qa-gpt-retrieval'
  `).all();
  assert.notEqual(
    retrievalTrace.chunksJson,
    '[]',
    JSON.stringify({ retrievalTrace, persistedRetrievalRows }),
  );
  assert.match(JSON.stringify(firstRequest.input), /<retrieval>/);
  assert.match(JSON.stringify(firstRequest.input), /CHUNK_ONLY_EVIDENCE/);
  assert.doesNotMatch(JSON.stringify(firstRequest.input), /LEGACY_FULL_NOTE_SECRET/);

  const rowsAfterSuccess = db.prepare(`
    SELECT role, model, model_selection AS modelSelection,
           model_catalog_generation AS catalogGeneration,
           runtime_generation AS runtimeGeneration,
           reasoning_effort AS reasoningEffort
    FROM messages
    ORDER BY id
  `).all();
  assert.equal(rowsAfterSuccess.length, 2);
  assert.deepEqual(rowsAfterSuccess[1], {
    role: 'assistant',
    model: 'gpt-5.6-terra',
    modelSelection: 'auto:balanced',
    catalogGeneration: 0,
    runtimeGeneration: 'gpt-single-v1',
    reasoningEffort: 'medium',
  });
  assert.equal(
    db.prepare(`
      SELECT mode
      FROM assistant_retrieval_shadow_runs
      ORDER BY id DESC
      LIMIT 1
    `).get().mode,
    'chat:gpt-single-v1:a2',
  );

  responseMode = 'incomplete';
  const failedQuestion = '이 요청은 완결되지 않아 저장되면 안 돼.';
  const failed = await api(url, '/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      message: failedQuestion,
      model: 'gpt',
      sessionId: 'shared-main',
    }),
  });
  assert.equal(failed.response.status, 502, JSON.stringify(failed.body));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages').get().count, 2);

  responseMode = 'completed';
  const recovered = await api(url, '/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      message: '실패 이후 정상 요청이야.',
      model: 'gpt',
      sessionId: 'shared-main',
    }),
  });
  assert.equal(recovered.response.status, 200, JSON.stringify(recovered.body));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages').get().count, 4);
  assert.doesNotMatch(JSON.stringify(responseRequests.at(-1).input), new RegExp(failedQuestion));

  const form = new FormData();
  form.set(
    'file',
    new Blob(['ATTACHMENT_MODEL_SECRET'], { type: 'text/plain' }),
    '연결자료.txt',
  );
  const uploadResponse = await fetch(`${url}/api/attachments`, {
    method: 'POST',
    headers: { 'X-API-Token': API_TOKEN },
    body: form,
  });
  const uploadBody = await uploadResponse.json();
  assert.equal(uploadResponse.status, 201, JSON.stringify(uploadBody));
  inspectedAttachmentId = uploadBody.attachmentId;

  responseMode = 'incomplete';
  const failedAttachment = await api(url, '/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      message: '실패하는 첨부 연결 턴',
      model: 'gpt',
      sessionId: 'shared-main',
      attachmentIds: [uploadBody.attachmentId],
    }),
  });
  assert.equal(failedAttachment.response.status, 502, JSON.stringify(failedAttachment.body));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM message_attachments').get().count, 0);
  assert.equal(db.prepare(`
    SELECT lifecycle_status AS status FROM attachments WHERE id = ?
  `).get(uploadBody.attachmentId).status, 'uploaded_unattached');

  responseMode = 'completed';
  const linked = await api(url, '/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      message: '첨부 연결 턴',
      model: 'gpt',
      sessionId: 'shared-main',
      attachmentIds: [uploadBody.attachmentId],
    }),
  });
  assert.equal(linked.response.status, 200, JSON.stringify(linked.body));
  assert.equal(linked.body.attachments[0].attachmentId, uploadBody.attachmentId);
  assert.doesNotMatch(JSON.stringify(responseRequests.at(-1).input), /ATTACHMENT_MODEL_SECRET/);
  const linkedRow = db.prepare(`
    SELECT ma.origin_user_turn_index AS originTurn,
           ma.replay_window_turns AS replayTurns,
           a.lifecycle_status AS status, b.stored_path AS storedPath
    FROM message_attachments ma
    JOIN attachments a ON a.id = ma.attachment_id
    JOIN attachment_blobs b ON b.id = a.blob_id
    WHERE ma.attachment_id = ?
  `).get(uploadBody.attachmentId);
  assert.deepEqual({
    originTurn: linkedRow.originTurn,
    replayTurns: linkedRow.replayTurns,
    status: linkedRow.status,
  }, { originTurn: 3, replayTurns: 2, status: 'attached_temporary' });

  const history = await api(url, '/api/sessions/shared-main');
  const linkedMessage = history.body.messages.find(message => message.content === '첨부 연결 턴');
  assert.equal(linkedMessage.attachments[0].filename, '연결자료.txt');
  assert.equal(linkedMessage.attachments[0].expired, false);

  const providerCallsBeforeMismatch = responseRequests.length;
  const mismatch = await api(url, '/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      message: '다른 세션 재사용',
      model: 'gpt',
      sessionId: 'other-session',
      attachmentIds: [uploadBody.attachmentId],
    }),
  });
  assert.equal(mismatch.response.status, 409, JSON.stringify(mismatch.body));
  assert.equal(responseRequests.length, providerCallsBeforeMismatch);

  const fourth = await api(url, '/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: '넷째 턴', model: 'gpt', sessionId: 'shared-main' }),
  });
  assert.equal(fourth.response.status, 200, JSON.stringify(fourth.body));
  assert.equal(attachmentStatesAtProvider.at(-1), 'attached_temporary');

  const fifth = await api(url, '/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: '다섯째 턴', model: 'gpt', sessionId: 'shared-main' }),
  });
  assert.equal(fifth.response.status, 200, JSON.stringify(fifth.body));
  assert.equal(attachmentStatesAtProvider.at(-1), 'deleted');
  await assert.rejects(fs.stat(linkedRow.storedPath), error => error.code === 'ENOENT');
  const expiredHistory = await api(url, '/api/sessions/shared-main');
  const expiredMessage = expiredHistory.body.messages.find(message => message.content === '첨부 연결 턴');
  assert.equal(expiredMessage.attachments[0].expired, true);
  db.close();
});
