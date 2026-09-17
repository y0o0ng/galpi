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
const { sha256 } = require('../lib/content-hash');
const { createModelCatalogStore } = require('../lib/model-catalog-store');
const { buildOpenAIModelCatalogPayload } = require('../lib/openai-model-catalog');

// PNG 서명만 맞으면 업로드 검증을 통과한다. 이미지 회수 경로는 디코딩하지 않는다.
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

const ROOT = path.resolve(__dirname, '..');
const API_TOKEN = 'query-resolution-test-token';
const RESOLVED_QUERY = '2026년 8월 20일 수원에서 군대 사람들을 만난 날 저녁 일정';

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

function completedResponse(text) {
  return {
    id: 'resp_test',
    object: 'response',
    status: 'completed',
    model: 'gpt-5.6-terra',
    output_text: text,
    output: [{
      type: 'message',
      id: 'msg_test',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text, annotations: [] }],
    }],
    usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
  };
}

test('검색 질의 해석은 원문을 그대로 두고 회수 경로 전체에 같은 질의를 흘린다', async t => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'query-resolution-server-'));
  const vaultPath = path.join(appRoot, 'vault');
  await fs.mkdir(vaultPath);
  await fs.copyFile(path.join(ROOT, 'server.js'), path.join(appRoot, 'server.js'));
  for (const name of ['lib', 'scripts', 'public', 'config', '.codex', 'node_modules']) {
    await fs.symlink(path.join(ROOT, name), path.join(appRoot, name), 'dir');
  }

  const embeddingInputs = [];
  const resolverRequests = [];
  const chatRequests = [];
  // 해석기가 무엇을 돌려줄지 테스트가 턴마다 정한다.
  let nextResolution = null;
  let nextAnswer = '알겠어.';

  const provider = http.createServer(async (req, res) => {
    const body = await readJson(req);
    if (req.url === '/v1/embeddings') {
      embeddingInputs.push(body.input);
      // 회수 경로가 실제로 어떤 질의를 임베딩했는지 구분되게 만든다.
      const embedding = String(body.input).includes('수원') ? [1, 0] : [0, 1];
      return sendJson(res, 200, {
        object: 'list',
        data: [{ object: 'embedding', index: 0, embedding }],
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: 1, total_tokens: 1 },
      });
    }
    if (req.url !== '/v1/responses') return sendJson(res, 404, { error: { message: 'not found' } });

    if (body.text?.format?.name === 'retrieval_query_resolution') {
      resolverRequests.push(body);
      if (nextResolution === 'error') return sendJson(res, 500, { error: { message: 'boom' } });
      return sendJson(res, 200, completedResponse(JSON.stringify(nextResolution)));
    }
    const serialized = JSON.stringify(body.input);
    if (serialized.includes('<user_question>')) chatRequests.push(body);
    return sendJson(res, 200, completedResponse(nextAnswer));
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
      CONTEXT_N: '5',
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

  // 일정 기록 projection(비topic)과 topic 청크를 함께 둔다. 해석된 질의가 노트
  // 랭킹과 A2 전역 회수 양쪽에 똑같이 닿는지 한 턴에서 본다.
  const scheduleNote = 'xion-schedule-2026-08.md';
  await fs.writeFile(path.join(vaultPath, scheduleNote), [
    '---',
    'title: 2026년 8월 일정 기록',
    'note_type: schedule_history',
    'archived: false',
    '---',
    '# 2026년 8월 일정 기록',
    '## 완료',
    '- 8월 20일 수원 군대 사람들 모임 · 저녁 SCHEDULE_HISTORY_EVIDENCE',
  ].join('\n'));
  const topicNote = 'suwon-topic.md';
  await fs.writeFile(path.join(vaultPath, topicNote), [
    '---',
    'title: 수원 군대 모임',
    'note_type: topic',
    'archived: false',
    '---',
    '# 수원 군대 모임',
    'Q: 수원 군대 사람들 모임 저녁',
    'A: CHUNK_ONLY_EVIDENCE',
  ].join('\n'));

  const db = new Database(path.join(appRoot, 'galpi.db'));
  const insertNote = db.prepare(`
    INSERT INTO notes (
      filename, title, note_type, archived, codex_status,
      index_status, ai_readable, embedding
    ) VALUES (?, ?, ?, 0, 'processed', 'ready', 1, ?)
  `);
  insertNote.run(scheduleNote, '2026년 8월 일정 기록', 'schedule_history', JSON.stringify([1, 0]));
  insertNote.run(topicNote, '수원 군대 모임', 'topic', JSON.stringify([1, 0]));
  db.prepare(`
    INSERT INTO note_chunks (
      chunk_id, note_filename, note_title, chunk_type, content, embedding, index_status
    ) VALUES (?, ?, ?, 'topic_qa', ?, ?, 'ready')
  `).run(
    'qa-suwon',
    topicNote,
    '수원 군대 모임',
    'Q: 수원 군대 사람들 모임 저녁\nA: CHUNK_ONLY_EVIDENCE',
    JSON.stringify([1, 0]),
  );
  // 교차 세션 과거 대화. 해석된 질의의 임베딩으로만 걸린다.
  db.prepare('INSERT INTO sessions (id) VALUES (?)').run('old-session');
  db.prepare(`
    INSERT INTO messages (session_id, role, content, embedding, created_at)
    VALUES (?, 'user', ?, ?, 1800000000)
  `).run('old-session', '수원에서 군대 사람들이랑 뭐 했었는지 기억나?', JSON.stringify([1, 0]));
  db.prepare(`
    INSERT INTO messages (session_id, role, content, created_at)
    VALUES (?, 'assistant', ?, 1800000001)
  `).run('old-session', 'PAST_TURN_MARKER');
  db.close();

  const chat = async (message, extra = {}) => {
    const response = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': API_TOKEN },
      body: JSON.stringify({ message, model: 'gpt', sessionId: 'shared-main', ...extra }),
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  };
  const traceRows = () => {
    const probe = new Database(path.join(appRoot, 'galpi.db'), { readonly: true });
    const rows = probe.prepare(`
      SELECT query_sha256 AS querySha256, resolution_outcome AS resolutionOutcome,
             retrieval_query_sha256 AS retrievalQuerySha256, chunks_json AS chunksJson,
             error
      FROM assistant_retrieval_shadow_runs
      ORDER BY id ASC
    `).all();
    probe.close();
    return rows;
  };

  await t.test('첫 자립 질문은 해석기를 부르지 않는다', async () => {
    nextAnswer = '8월 20일 수원에서 만났어.';
    await chat('군대 사람들 만난 게 언제였지?');

    assert.equal(resolverRequests.length, 0);
    assert.equal(embeddingInputs.at(-1), '군대 사람들 만난 게 언제였지?');
    const trace = traceRows().at(-1);
    assert.equal(trace.resolutionOutcome, 'pass');
    assert.equal(trace.querySha256, sha256('군대 사람들 만난 게 언제였지?'));
    assert.equal(trace.retrievalQuerySha256, trace.querySha256);
  });

  await t.test('어시스턴트가 세운 지시 대상을 resolved 질의가 복원한다', async () => {
    nextResolution = { outcome: 'resolved', query: RESOLVED_QUERY };
    nextAnswer = '삼겹살 먹었어.';
    await chat('그때 뭐 했었지?');

    // 해석기는 어시스턴트 발화까지 본다.
    assert.equal(resolverRequests.length, 1);
    assert.match(resolverRequests[0].input[1].content, /어시스턴트: 8월 20일 수원에서 만났어\./);

    // 임베딩 · 노트 랭킹 · 과거 대화 검색 · A2 전역 회수가 모두 같은 질의를 쓴다.
    assert.equal(embeddingInputs.at(-1), RESOLVED_QUERY);
    const request = JSON.stringify(chatRequests.at(-1).input);
    assert.match(request, /SCHEDULE_HISTORY_EVIDENCE/);
    assert.match(request, /<retrieval>/);
    assert.match(request, /CHUNK_ONLY_EVIDENCE/);
    assert.match(request, /PAST_TURN_MARKER/);
    // 원문은 모델이 보는 사용자 발화 자리에 그대로 남는다.
    assert.match(request, /<user_question>\\n그때 뭐 했었지\?\\n<\/user_question>/);
    assert.doesNotMatch(request, /<user_question>[^<]*8월 20일/);

    const trace = traceRows().at(-1);
    assert.equal(trace.resolutionOutcome, 'resolved');
    assert.equal(trace.querySha256, sha256('그때 뭐 했었지?'));
    assert.equal(trace.retrievalQuerySha256, sha256(RESOLVED_QUERY));
    assert.notEqual(trace.chunksJson, '[]');

    const probe = new Database(path.join(appRoot, 'galpi.db'), { readonly: true });
    const stored = probe.prepare(`
      SELECT content FROM messages
      WHERE session_id = 'shared-main' AND role = 'user'
      ORDER BY id DESC LIMIT 1
    `).get();
    probe.close();
    assert.equal(stored.content, '그때 뭐 했었지?');
  });

  await t.test('no_retrieval 턴은 corpus를 건드리지 않고 대화만 쓴다', async () => {
    const embeddingCalls = embeddingInputs.length;
    nextResolution = { outcome: 'no_retrieval', query: '' };
    nextAnswer = '삼겹살이었어.';
    await chat('응 그래서?');

    assert.equal(embeddingInputs.length, embeddingCalls);
    const request = JSON.stringify(chatRequests.at(-1).input);
    assert.doesNotMatch(request, /<retrieval>/);
    assert.doesNotMatch(request, /SCHEDULE_HISTORY_EVIDENCE/);
    assert.doesNotMatch(request, /<retrieval_status>/);
    // 답변 생성은 평소대로 최근 대화를 본다.
    assert.match(request, /그때 뭐 했었지\?/);

    const trace = traceRows().at(-1);
    assert.equal(trace.resolutionOutcome, 'no_retrieval');
    assert.equal(trace.retrievalQuerySha256, null);
    assert.equal(trace.chunksJson, '[]');
  });

  await t.test('ambiguous 턴은 원문 검색으로 되돌아가지 않고 되묻게 한다', async () => {
    const embeddingCalls = embeddingInputs.length;
    nextResolution = { outcome: 'ambiguous', query: '' };
    nextAnswer = '어떤 걸 말하는 거야?';
    await chat('그거는?');

    assert.equal(embeddingInputs.length, embeddingCalls);
    const request = JSON.stringify(chatRequests.at(-1).input);
    assert.match(request, /<retrieval_status>/);
    assert.doesNotMatch(request, /SCHEDULE_HISTORY_EVIDENCE/);
    assert.doesNotMatch(request, /<retrieval>\\n/);

    const trace = traceRows().at(-1);
    assert.equal(trace.resolutionOutcome, 'ambiguous');
    assert.equal(trace.retrievalQuerySha256, null);
  });

  await t.test('해석 실패도 fail-close로 기록된다', async () => {
    const embeddingCalls = embeddingInputs.length;
    nextResolution = 'error';
    nextAnswer = '무엇을 말하는지 알려줘.';
    await chat('그거 다시 알려줘');

    assert.equal(embeddingInputs.length, embeddingCalls);
    const trace = traceRows().at(-1);
    assert.equal(trace.resolutionOutcome, 'ambiguous');
    assert.equal(trace.retrievalQuerySha256, null);
    assert.ok(trace.error);
  });

  await t.test('근거로 삼을 대화가 없으면 원문 검색 없이 닫는다', async () => {
    const embeddingCalls = embeddingInputs.length;
    const resolverCalls = resolverRequests.length;
    nextAnswer = '무엇을 말하는지 알려줘.';
    const response = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': API_TOKEN },
      // 대화가 하나도 없는 새 세션이다.
      body: JSON.stringify({ message: '그때 뭐 했었지?', model: 'gpt', sessionId: 'fresh-session' }),
    });
    assert.equal(response.status, 200, JSON.stringify(await response.json()));

    // 근거가 없으면 해석 모델도 부르지 않고 corpus도 돌리지 않는다.
    assert.equal(resolverRequests.length, resolverCalls);
    assert.equal(embeddingInputs.length, embeddingCalls);
    const request = JSON.stringify(chatRequests.at(-1).input);
    assert.match(request, /<retrieval_status>/);
    assert.doesNotMatch(request, /SCHEDULE_HISTORY_EVIDENCE/);
    assert.doesNotMatch(request, /CHUNK_ONLY_EVIDENCE/);
    assert.match(request, /<user_question>\\n그때 뭐 했었지\?\\n<\/user_question>/);

    const trace = traceRows().at(-1);
    assert.equal(trace.resolutionOutcome, 'ambiguous');
    assert.equal(trace.querySha256, sha256('그때 뭐 했었지?'));
    assert.equal(trace.retrievalQuerySha256, null);
    assert.equal(trace.chunksJson, '[]');
  });

  await t.test('이번 턴 첨부가 있으면 첨부 경로의 기존 계약을 그대로 둔다', async () => {
    const form = new FormData();
    form.set('file', new Blob(['ATTACHMENT_TURN_EVIDENCE'], { type: 'text/plain' }), '첨부.txt');
    const uploadResponse = await fetch(`${url}/api/attachments`, {
      method: 'POST',
      headers: { 'X-API-Token': API_TOKEN },
      body: form,
    });
    const uploadBody = await uploadResponse.json();
    assert.equal(uploadResponse.status, 201, JSON.stringify(uploadBody));

    const resolverCalls = resolverRequests.length;
    nextAnswer = '첨부 내용을 봤어.';
    const body = await chat('이거 뭐야?', { attachmentIds: [uploadBody.attachmentId] });
    assert.equal(body.attachments[0].attachmentId, uploadBody.attachmentId);

    // `이거`를 최근 대화로 다시 해석하지 않는다. 대상은 이번 턴 첨부다.
    assert.equal(resolverRequests.length, resolverCalls);
    assert.equal(embeddingInputs.at(-1), '이거 뭐야?');
    const request = JSON.stringify(chatRequests.at(-1).input);
    assert.match(request, /<current_attachments>/);
    assert.match(request, /첨부\.txt/);
    assert.doesNotMatch(request, /<retrieval_status>/);

    const trace = traceRows().at(-1);
    assert.equal(trace.resolutionOutcome, 'pass');
    assert.equal(trace.querySha256, sha256('이거 뭐야?'));
    assert.equal(trace.retrievalQuerySha256, trace.querySha256);
  });

  await t.test('replay로 남은 이전 턴 이미지는 해석 단계를 건너뛰게 하지 않는다', async () => {
    // 이미지가 붙은 턴은 이미지 입력이 검증된 모델을 요구한다.
    const seed = new Database(path.join(appRoot, 'galpi.db'));
    createModelCatalogStore(seed).saveSuccess(
      'openai_api',
      await buildOpenAIModelCatalogPayload({
        models: [{ id: 'gpt-5.6-terra' }],
        probeModel: async () => {},
        probeImageInput: async () => {},
      }),
      { payloadVersion: 2 },
    );
    seed.close();

    const form = new FormData();
    form.set('file', new Blob([PNG_BYTES], { type: 'image/png' }), 'replay.png');
    const uploadResponse = await fetch(`${url}/api/attachments`, {
      method: 'POST',
      headers: { 'X-API-Token': API_TOKEN },
      body: form,
    });
    const uploadBody = await uploadResponse.json();
    assert.equal(uploadResponse.status, 201, JSON.stringify(uploadBody));

    // 1) 이전 턴에 이미지를 붙인다. 그 턴은 해석 단계를 열지 않는다.
    const resolverCallsBeforeImageTurn = resolverRequests.length;
    nextAnswer = '사진 봤어.';
    const imageTurn = await chat('이거 봐봐', { attachmentIds: [uploadBody.attachmentId] });
    assert.equal(imageTurn.attachments[0].attachmentId, uploadBody.attachmentId);
    assert.equal(resolverRequests.length, resolverCallsBeforeImageTurn);

    // 2) 사이에 첨부 없는 무관한 턴을 하나 둔다.
    nextAnswer = '응.';
    await chat('알겠어 고마워');

    // 3) 새 첨부가 없는 대화 의존 발화.
    const resolverCalls = resolverRequests.length;
    nextResolution = { outcome: 'resolved', query: RESOLVED_QUERY };
    nextAnswer = '삼겹살 먹었어.';
    await chat('그때 뭐 했었지?');

    const request = JSON.stringify(chatRequests.at(-1).input);
    // replay 창이 살아 있어 이전 턴 이미지가 아직 이 턴에 실린다.
    assert.match(request, /"type":"input_image"/);
    assert.match(request, /replay\.png/);
    // 그런데도 해석 단계는 열리고, 해석된 질의가 회수에 그대로 쓰인다.
    assert.equal(resolverRequests.length, resolverCalls + 1);
    assert.equal(embeddingInputs.at(-1), RESOLVED_QUERY);
    assert.match(request, /SCHEDULE_HISTORY_EVIDENCE/);
    assert.match(request, /<user_question>\\n그때 뭐 했었지\?\\n<\/user_question>/);

    const trace = traceRows().at(-1);
    assert.equal(trace.resolutionOutcome, 'resolved');
    assert.equal(trace.querySha256, sha256('그때 뭐 했었지?'));
    assert.equal(trace.retrievalQuerySha256, sha256(RESOLVED_QUERY));
  });

  await t.test('주제를 바꾼 자립 질문은 이전 해석을 물려받지 않는다', async () => {
    const resolverCalls = resolverRequests.length;
    nextAnswer = '그 노트는 없어.';
    await chat('기상청 격자 변환식 알려줘');

    assert.equal(resolverRequests.length, resolverCalls);
    assert.equal(embeddingInputs.at(-1), '기상청 격자 변환식 알려줘');
    const request = JSON.stringify(chatRequests.at(-1).input);
    assert.doesNotMatch(request, /SCHEDULE_HISTORY_EVIDENCE/);
    assert.doesNotMatch(request, /CHUNK_ONLY_EVIDENCE/);

    const trace = traceRows().at(-1);
    assert.equal(trace.resolutionOutcome, 'pass');
    assert.equal(trace.querySha256, sha256('기상청 격자 변환식 알려줘'));
    assert.equal(trace.retrievalQuerySha256, trace.querySha256);
  });
});
