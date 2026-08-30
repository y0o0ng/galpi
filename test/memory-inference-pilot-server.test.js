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

const {
  GUARD_SCOPES,
  REASON_CODES,
  WORKLOAD_TYPES,
  hashSourceEvent,
} = require('../lib/memory-inference-pilot');

const ROOT = path.resolve(__dirname, '..');
const API_TOKEN = 'memory-inference-pilot-server-test-token';

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

async function waitFor(read, describe) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = read();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`${describe} 대기 시간이 초과됐습니다.`);
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
  return { response, body: await response.json() };
}

function responsePayload(body, text, suffix) {
  return {
    id: `resp_${suffix}`,
    object: 'response',
    status: 'completed',
    model: body.model,
    output_text: text,
    output: [{
      type: 'message',
      id: `msg_${suffix}`,
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text, annotations: [] }],
    }],
    usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
  };
}

function observationsForQuestion(db, sessionId, question) {
  const user = db.prepare(`
    SELECT id FROM messages
    WHERE session_id = ? AND role = 'user' AND content = ?
    ORDER BY id DESC LIMIT 1
  `).get(sessionId, question);
  if (!user) return [];
  const assistant = db.prepare(`
    SELECT id FROM messages
    WHERE session_id = ? AND role = 'assistant' AND id > ?
    ORDER BY id ASC LIMIT 1
  `).get(sessionId, user.id);
  if (!assistant) return [];
  const sourceEventSha256 = hashSourceEvent({
    sessionId,
    userMessageId: user.id,
    assistantMessageId: assistant.id,
  });
  return db.prepare(`
    SELECT workload_type AS workloadType, opportunity,
           hard_gated AS hardGated, local_eligible AS localEligible,
           guard_scope AS guardScope, reason_code AS reasonCode
    FROM research_memory_inference_observations
    WHERE source_event_sha256 = ?
    ORDER BY id ASC
  `).all(sourceEventSha256);
}

function expectedEligible(workloadType) {
  return {
    workloadType,
    opportunity: 1,
    hardGated: 0,
    localEligible: 1,
    guardScope: GUARD_SCOPES.NONE,
    reasonCode: REASON_CODES.NONE,
  };
}

function expectedGuarded(workloadType, reasonCode) {
  return {
    workloadType,
    opportunity: 1,
    hardGated: 1,
    localEligible: 0,
    guardScope: GUARD_SCOPES.CURRENT_PRODUCTION_ELIGIBILITY,
    reasonCode,
  };
}

test('production chat wiring records the exact Pilot P0 opportunities and stays fail-open', async t => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-pilot-server-'));
  const vaultPath = path.join(appRoot, 'vault');
  await fs.mkdir(vaultPath);
  await fs.copyFile(path.join(ROOT, 'server.js'), path.join(appRoot, 'server.js'));
  for (const name of ['lib', 'scripts', 'public', 'config', '.codex', 'node_modules']) {
    await fs.symlink(path.join(ROOT, name), path.join(appRoot, name), 'dir');
  }

  let responseMode = 'no-save';
  let responseSequence = 0;
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
    if (req.url !== '/v1/responses') return sendJson(res, 404, { error: 'not found' });

    responseSequence += 1;
    if (responseMode === 'schedule') {
      const hasToolOutput = body.input.some(item => item?.type === 'function_call_output');
      if (!hasToolOutput) {
        return sendJson(res, 200, {
          id: `resp_schedule_tool_${responseSequence}`,
          object: 'response',
          status: 'completed',
          model: body.model,
          output: [{
            type: 'function_call',
            id: 'fc_schedule_prepare',
            call_id: 'call_schedule_prepare',
            name: 'schedule_prepare',
            arguments: JSON.stringify({
              title: '합성 일정',
              due: { kind: 'date', date: '2030-01-15' },
            }),
            status: 'completed',
          }],
        });
      }
      return sendJson(res, 200, responsePayload(body, '일정 후보를 준비했어.', responseSequence));
    }

    const text = responseMode === 'save'
      ? '합성 프로젝트의 설계 결정과 기준을 장기적으로 기록하는 답변이다. '.repeat(12)
      : '짧은 응답';
    return sendJson(res, 200, responsePayload(body, text, responseSequence));
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
      ASSISTANT_TASKS_ENABLED: 'true',
      WEB_PUSH_ENABLED: 'false',
      ATTACHMENTS_ENABLED: 'true',
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
  const db = new Database(path.join(appRoot, 'galpi.db'));
  t.after(() => db.close());

  responseMode = 'save';
  const saveQuestion = '합성 장기 프로젝트의 설계 결정을 기록해줘.';
  const saved = await api(url, '/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: saveQuestion, model: 'gpt', sessionId: 'pilot-save' }),
  });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
  const saveRows = await waitFor(() => {
    const rows = observationsForQuestion(db, 'pilot-save', saveQuestion);
    return rows.length === 3 ? rows : null;
  }, 'SAVE observation');
  assert.deepEqual(saveRows, [
    expectedEligible(WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE),
    expectedEligible(WORKLOAD_TYPES.AMBIGUITY_ESCALATION),
    expectedEligible(WORKLOAD_TYPES.STRUCTURED_EXTRACTION),
  ]);
  await waitFor(() => db.prepare(`
    SELECT COUNT(*) AS count FROM auto_save_decisions
    WHERE session_id = 'pilot-save' AND decision = 'save'
  `).get().count === 1, '기존 SAVE decision');

  responseMode = 'no-save';
  const noSaveQuestion = '이 답은 자동 저장하지 마.';
  const notSaved = await api(url, '/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: noSaveQuestion, model: 'gpt', sessionId: 'pilot-no-save' }),
  });
  assert.equal(notSaved.response.status, 200, JSON.stringify(notSaved.body));
  const noSaveRows = await waitFor(() => {
    const rows = observationsForQuestion(db, 'pilot-no-save', noSaveQuestion);
    return rows.length === 2 ? rows : null;
  }, 'NO_SAVE observation');
  assert.deepEqual(noSaveRows, [
    expectedEligible(WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE),
    expectedEligible(WORKLOAD_TYPES.AMBIGUITY_ESCALATION),
  ]);
  await waitFor(() => db.prepare(`
    SELECT COUNT(*) AS count FROM auto_save_decisions
    WHERE session_id = 'pilot-no-save' AND decision = 'skip' AND reason = 'answer_too_short'
  `).get().count === 1, '기존 NO_SAVE decision');

  const voiceQuestion = '음성 출처의 합성 질문';
  const voice = await api(url, '/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      message: voiceQuestion,
      model: 'gpt',
      sessionId: 'pilot-voice',
      source: 'voice',
    }),
  });
  assert.equal(voice.response.status, 200, JSON.stringify(voice.body));
  assert.deepEqual(observationsForQuestion(db, 'pilot-voice', voiceQuestion), [
    expectedGuarded(
      WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE,
      REASON_CODES.CURRENT_VOICE_AUTO_SAVE_DISABLED,
    ),
    expectedGuarded(
      WORKLOAD_TYPES.AMBIGUITY_ESCALATION,
      REASON_CODES.CURRENT_VOICE_AUTO_SAVE_DISABLED,
    ),
  ]);

  responseMode = 'schedule';
  const scheduleQuestion = '2030년 1월 15일 합성 일정을 등록해줘.';
  const schedule = await api(url, '/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: scheduleQuestion, model: 'gpt', sessionId: 'pilot-schedule' }),
  });
  assert.equal(schedule.response.status, 200, JSON.stringify(schedule.body));
  assert.equal(schedule.body.scheduleCandidate.task.title, '합성 일정');
  assert.deepEqual(observationsForQuestion(db, 'pilot-schedule', scheduleQuestion), [
    expectedGuarded(
      WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE,
      REASON_CODES.CURRENT_SCHEDULE_CANDIDATE,
    ),
    expectedGuarded(
      WORKLOAD_TYPES.AMBIGUITY_ESCALATION,
      REASON_CODES.CURRENT_SCHEDULE_CANDIDATE,
    ),
  ]);

  responseMode = 'no-save';
  const form = new FormData();
  form.set('file', new Blob(['합성 임시 첨부'], { type: 'text/plain' }), 'pilot.txt');
  const uploadResponse = await fetch(`${url}/api/attachments`, {
    method: 'POST',
    headers: { 'X-API-Token': API_TOKEN },
    body: form,
  });
  const upload = await uploadResponse.json();
  assert.equal(uploadResponse.status, 201, JSON.stringify(upload));
  const attachmentQuestion = '임시 첨부를 참고한 합성 질문';
  const attachment = await api(url, '/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      message: attachmentQuestion,
      model: 'gpt',
      sessionId: 'pilot-attachment',
      attachmentIds: [upload.attachmentId],
    }),
  });
  assert.equal(attachment.response.status, 200, JSON.stringify(attachment.body));
  assert.deepEqual(observationsForQuestion(db, 'pilot-attachment', attachmentQuestion), [
    expectedGuarded(
      WORKLOAD_TYPES.WRITE_CANDIDATE_TRIAGE,
      REASON_CODES.CURRENT_TEMPORARY_ATTACHMENT_CONTEXT,
    ),
    expectedGuarded(
      WORKLOAD_TYPES.AMBIGUITY_ESCALATION,
      REASON_CODES.CURRENT_TEMPORARY_ATTACHMENT_CONTEXT,
    ),
  ]);

  const observationCountBeforeManual = db.prepare(`
    SELECT COUNT(*) AS count FROM research_memory_inference_observations
  `).get().count;
  const memo = await api(url, '/api/vault/save-document', {
    method: 'POST',
    body: JSON.stringify({
      content: '합성 수동 메모 내용',
      originalText: '합성 수동 메모 내용',
      sessionId: 'pilot-manual-memo',
    }),
  });
  assert.equal(memo.response.status, 200, JSON.stringify(memo.body));
  const forced = await api(url, '/api/save-note', {
    method: 'POST',
    body: JSON.stringify({
      question: '합성 강제 저장 질문',
      answer: '합성 강제 저장 답변',
      model: 'gpt-5.6-terra',
      sessionId: 'pilot-forced-save',
    }),
  });
  assert.equal(forced.response.status, 200, JSON.stringify(forced.body));
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM research_memory_inference_observations
  `).get().count, observationCountBeforeManual);

  const messagesBeforeFailure = db.prepare('SELECT COUNT(*) AS count FROM messages').get().count;
  const decisionsBeforeFailure = db.prepare('SELECT COUNT(*) AS count FROM auto_save_decisions').get().count;
  db.exec('DROP TABLE research_memory_inference_observations');
  const failureQuestion = '관찰 저장 실패에서도 기존 결정을 유지해.';
  const failOpen = await api(url, '/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: failureQuestion, model: 'gpt', sessionId: 'pilot-fail-open' }),
  });
  assert.equal(failOpen.response.status, 200, JSON.stringify(failOpen.body));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages').get().count, messagesBeforeFailure + 2);
  await waitFor(() => db.prepare(`
    SELECT COUNT(*) AS count FROM auto_save_decisions
  `).get().count === decisionsBeforeFailure + 1, 'fail-open production decision');
  assert.deepEqual(db.prepare(`
    SELECT decision, reason FROM auto_save_decisions
    WHERE session_id = 'pilot-fail-open'
  `).get(), { decision: 'skip', reason: 'answer_too_short' });
  await waitFor(
    () => /local memory inference 관찰 기록 실패: SQLITE_ERROR/u.test(logs.join('')),
    'compact instrumentation failure log',
  );
});
