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
const { createModelCatalogStore } = require('../lib/model-catalog-store');
const { buildOpenAIModelCatalogPayload } = require('../lib/openai-model-catalog');

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

// 상한이 10초다. 실제 서버를 띄우는 테스트 파일이 8개라 node --test가 병렬로
// 돌리면 기동이 느려지고, 짧은 상한은 부하 때문에 빨개진다. 서버가 먼저 죽으면
// 아래 exitCode 검사가 즉시 잡으므로 상한을 늘려도 실패가 늦게 드러나지 않는다.
async function waitForServer(child, url, logs) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
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
      if (responseMode === 'attachment-tool') {
        const hasToolOutput = body.input.some(item => item?.type === 'function_call_output');
        if (!hasToolOutput) {
          return sendJson(res, 200, {
            id: `resp_attachment_tool_${responseRequests.length}`,
            object: 'response',
            status: 'completed',
            model: body.model,
            output: [{
              type: 'function_call',
              id: 'fc_attachment_search',
              call_id: 'call_attachment_search',
              name: 'attachment_document_search',
              arguments: JSON.stringify({
                attachmentId: inspectedAttachmentId,
                query: 'ATTACHMENT MODEL SECRET',
                mode: 'focused',
              }),
              status: 'completed',
            }],
          });
        }
        return sendJson(res, 200, {
          id: `resp_attachment_answer_${responseRequests.length}`,
          object: 'response',
          status: 'completed',
          model: body.model,
          output_text: '첨부 근거를 확인했어. [연결자료.txt, lines 1-1]',
          output: [{
            type: 'message',
            id: `msg_attachment_${responseRequests.length}`,
            role: 'assistant',
            status: 'completed',
            content: [{
              type: 'output_text',
              text: '첨부 근거를 확인했어. [연결자료.txt, lines 1-1]',
              annotations: [],
            }],
          }],
          usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
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
  assert.deepEqual(db.prepare(`
    SELECT parse_status AS status, chunk_count AS chunkCount
    FROM attachment_documents WHERE attachment_id = ?
  `).get(uploadBody.attachmentId), { status: 'ready', chunkCount: 1 });
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM attachment_chunks WHERE attachment_id = ?
  `).get(uploadBody.attachmentId).count, 1);

  responseMode = 'attachment-tool';
  const providerCallsBeforeLinked = responseRequests.length;
  const autoSaveDecisionsBeforeLinked = db.prepare(`
    SELECT COUNT(*) AS count FROM auto_save_decisions
  `).get().count;
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
  assert.deepEqual(linked.body.attachmentDocuments, {
    used: true,
    evidenceRefs: [{
      attachmentId: uploadBody.attachmentId,
      chunkIds: [db.prepare(`
        SELECT chunk_id AS chunkId
        FROM attachment_chunks
        WHERE attachment_id = ?
      `).get(uploadBody.attachmentId).chunkId],
    }],
    calls: 1,
    contextChars: linked.body.attachmentDocuments.contextChars,
  });
  assert.ok(linked.body.attachmentDocuments.contextChars > 0);
  const linkedRequests = responseRequests.slice(providerCallsBeforeLinked);
  assert.equal(linkedRequests.length, 2);
  assert.doesNotMatch(JSON.stringify(linkedRequests[0].input), /ATTACHMENT_MODEL_SECRET/);
  assert.ok(linkedRequests[0].tools.some(tool => tool.name === 'attachment_document_search'));
  assert.match(linkedRequests[0].instructions, /신뢰하지 않는 사용자 제공 데이터/);
  assert.match(linkedRequests[0].instructions, /지시대명사만으로 물었고/);
  assert.match(JSON.stringify(linkedRequests[0].input), /<current_attachments>/);
  assert.match(JSON.stringify(linkedRequests[0].input), /사용자가 이번 턴에 첨부한 파일: 연결자료\.txt/);
  assert.doesNotMatch(JSON.stringify(responseRequests[0].input), /<current_attachments>/);
  assert.equal(db.prepare(`
    SELECT content FROM messages WHERE role = 'user' ORDER BY id DESC LIMIT 1
  `).get().content, '첨부 연결 턴');
  assert.match(JSON.stringify(linkedRequests[1].input), /ATTACHMENT_MODEL_SECRET/);
  assert.doesNotMatch(JSON.stringify(linkedRequests[1].input), /stored_path|content_sha256/);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM auto_save_decisions
  `).get().count, autoSaveDecisionsBeforeLinked);
  responseMode = 'completed';
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
  assert.equal(fourth.body.attachmentDocuments.used, false);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM auto_save_decisions
  `).get().count, autoSaveDecisionsBeforeLinked);

  const fifth = await api(url, '/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: '다섯째 턴', model: 'gpt', sessionId: 'shared-main' }),
  });
  assert.equal(fifth.response.status, 200, JSON.stringify(fifth.body));
  assert.equal(attachmentStatesAtProvider.at(-1), 'deleted');
  await assert.rejects(fs.stat(linkedRow.storedPath), error => error.code === 'ENOENT');
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM attachment_documents WHERE attachment_id = ?
  `).get(uploadBody.attachmentId).count, 0);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM attachment_chunks WHERE attachment_id = ?
  `).get(uploadBody.attachmentId).count, 0);
  const expiredHistory = await api(url, '/api/sessions/shared-main');
  const expiredMessage = expiredHistory.body.messages.find(message => message.content === '첨부 연결 턴');
  assert.equal(expiredMessage.attachments[0].expired, true);

  // Exercise the same exact unknown selection through real HTTP chat and title calls.
  const payload = await buildOpenAIModelCatalogPayload({
    models: [{ id: 'gpt-6-astra' }, { id: 'gpt-5.6-terra' }],
    probeModel: async () => {}, probeImageInput: async () => {},
  });
  createModelCatalogStore(db).saveSuccess('openai_api', payload, { payloadVersion: 2 });
  const exact = await api(url, '/api/settings/chat-model', {
    method: 'PUT', headers: { 'If-Match': '"1"' },
    body: JSON.stringify({ selection: 'gpt-6-astra' }),
  });
  assert.equal(exact.response.status, 200);
  const exactChat = await api(url, '/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: '수동 모델 검증', model: 'gpt', sessionId: 'shared-main' }),
  });
  assert.equal(exactChat.response.status, 200);
  assert.equal(exactChat.body.modelId, 'gpt-6-astra');
  assert.equal(responseRequests.at(-1).model, 'gpt-6-astra');

  await t.test('invalid save inputs return 400 without writes or terminating the server', async () => {
    const beforeRequests = responseRequests.length;
    const beforeMessages = db.prepare('SELECT COUNT(*) AS count FROM messages').get().count;
    const beforeChunks = db.prepare('SELECT COUNT(*) AS count FROM note_chunks').get().count;
    const beforeDecisions = db.prepare('SELECT COUNT(*) AS count FROM auto_save_decisions').get().count;
    const beforeFiles = await fs.readdir(vaultPath);
    for (const [route, valid, fields] of [
      ['/api/vault/save-document', { content: '저장할 메모' }, ['content', 'originalText', 'sessionId']],
      ['/api/save-note', { question: '저장할 질문', answer: '저장할 답변' },
        ['question', 'answer', 'model', 'sessionId', 'messageId']],
    ]) {
      for (const field of fields) {
        // A JSON object can shadow toString and throw during String(value).
        for (const value of [{ toString: null }, {}, [], true]) {
          const invalid = await api(url, route, {
            method: 'POST', body: JSON.stringify({ ...valid, [field]: value }),
          });
          assert.equal(invalid.response.status, 400, `${route}: ${field}=${JSON.stringify(value)}`);
        }
      }
    }
    for (const messageId of ['', 'invalid', -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const invalid = await api(url, '/api/save-note', {
        method: 'POST', body: JSON.stringify({ question: '질문', answer: '답변', messageId }),
      });
      assert.equal(invalid.response.status, 400, `messageId=${JSON.stringify(messageId)}`);
    }
    assert.equal(responseRequests.length, beforeRequests);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages').get().count, beforeMessages);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM note_chunks').get().count, beforeChunks);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM auto_save_decisions').get().count, beforeDecisions);
    assert.deepEqual(await fs.readdir(vaultPath), beforeFiles);
    assert.equal(child.exitCode, null);
    assert.equal((await api(url, '/api/sessions/shared-main')).response.status, 200);
  });

  // The earlier retrieval fixture deliberately has no writable QA-LOG; create a new topic here.
  db.prepare('UPDATE notes SET embedding = NULL').run();
  const beforeTitle = responseRequests.length;
  const saved = await api(url, '/api/save-note', {
    method: 'POST',
    body: JSON.stringify({ question: '독립적인 제목 검증', answer: '수동 모델로 제목을 만든다.',
      model: 'gpt', sessionId: 'metadata-test' }),
  });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
  const titleCalls = responseRequests.slice(beforeTitle);
  assert.ok(titleCalls.length > 0);
  for (const request of titleCalls) {
    assert.equal(request.model, 'gpt-6-astra');
    assert.deepEqual(request.reasoning, { effort: 'medium', context: 'current_turn' });
    assert.equal(request.max_output_tokens, 8192);
  }

  const memo = await api(url, '/api/vault/save-document', {
    method: 'POST', body: JSON.stringify({ content: '  정상 메모 저장  ',
      originalText: '저장: 정상 메모 저장', sessionId: 'save-validation-test' }),
  });
  assert.equal(memo.response.status, 200, JSON.stringify(memo.body));
  assert.equal(memo.body.success, true);
  assert.match(await fs.readFile(path.join(vaultPath, memo.body.filename), 'utf8'), /정상 메모 저장/);
  const memoHistory = await api(url, '/api/sessions/save-validation-test');
  assert.equal(memoHistory.body.messages[0].content, '저장: 정상 메모 저장');
  assert.equal(memoHistory.body.messages[1].content, `노트 저장됨: ${memo.body.title}`);

  // Both numeric API IDs and IDs restored from DOM datasets remain idempotent.
  const messageId = exactChat.body.messageId;
  assert.ok(Number.isSafeInteger(messageId));
  const saveBody = { question: '수동 모델 검증', answer: exactChat.body.reply, model: 'gpt',
    sessionId: 'shared-main', messageId };
  const firstSave = await api(url, '/api/save-note', { method: 'POST', body: JSON.stringify(saveBody) });
  assert.equal(firstSave.response.status, 200, JSON.stringify(firstSave.body));
  const chunksAfterSave = db.prepare('SELECT COUNT(*) AS count FROM note_chunks').get().count;
  for (const id of [messageId, String(messageId)]) {
    const duplicate = await api(url, '/api/save-note', {
      method: 'POST', body: JSON.stringify({ ...saveBody, messageId: id }),
    });
    assert.equal(duplicate.response.status, 200, JSON.stringify(duplicate.body));
    assert.equal(duplicate.body.duplicate, true);
    assert.equal(duplicate.body.filename, firstSave.body.filename);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM note_chunks').get().count, chunksAfterSave);

  await t.test('tokenless loopback API rejects foreign Host and Origin without weakening token authentication', async () => {
    const request = (pathname, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
      const req = http.request(`${url}${pathname}`, {
        method, headers: { 'Content-Type': 'application/json', ...headers },
      }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
      });
      req.on('error', reject);
      req.end(method === 'POST' ? JSON.stringify({ content: '로컬 인증 경계 테스트' }) : undefined);
    });
    const foreign = { Host: 'galpi.example.test', Origin: 'https://galpi.example.test' };
    assert.equal((await request('/api/vault/notes', foreign)).status, 401);
    assert.equal((await request('/api/vault/notes', { ...foreign, 'X-API-Token': API_TOKEN })).status, 200);
    assert.equal((await request('/api/vault/notes', { ...foreign, Authorization: `Bearer ${API_TOKEN}` })).status, 200);
    assert.deepEqual((await request('/api/config', foreign)).body, { requiresApiToken: true });

    await stopServer(child);
    serverEnv.API_TOKEN = '';
    child = startTestServer();
    await waitForServer(child, url, logs);
    const beforeFiles = await fs.readdir(vaultPath);
    const beforeRequests = responseRequests.length;
    for (const headers of [
      { Host: 'foreign.example' },
      { Host: 'foreign.example', Origin: url, 'X-Forwarded-Host': `127.0.0.1:${port}` },
      { Origin: 'https://foreign.example' },
      { Origin: 'null' },
      { Origin: `https://127.0.0.1:${port}` },
      { Origin: `http://127.0.0.1:${port + 1}` },
      { 'Sec-Fetch-Site': 'cross-site' },
      { 'Sec-Fetch-Site': 'same-site' },
    ]) {
      assert.equal((await request('/api/vault/notes', headers)).status, 401, JSON.stringify(headers));
      assert.equal((await request('/api/vault/save-document', headers, 'POST')).status, 401, JSON.stringify(headers));
    }
    assert.equal((await request('/api/config', foreign)).status, 401);
    assert.deepEqual(await fs.readdir(vaultPath), beforeFiles);
    assert.equal(responseRequests.length, beforeRequests);
    assert.equal((await request('/api/vault/notes')).status, 200, 'local CLI has no Origin');
    for (const Host of [`localhost:${port}`, `[::1]:${port}`]) {
      assert.equal((await request('/api/vault/notes', { Host, Origin: `http://${Host}`, 'Sec-Fetch-Site': 'same-origin' })).status, 200);
    }
    assert.equal((await request('/api/config', { Origin: url })).body.requiresApiToken, false);
    const localSave = await request('/api/vault/save-document', { Origin: url, 'Sec-Fetch-Site': 'same-origin' }, 'POST');
    assert.equal(localSave.status, 200);
    assert.match(await fs.readFile(path.join(vaultPath, localSave.body.filename), 'utf8'), /로컬 인증 경계 테스트/);
  });
  db.close();
});
