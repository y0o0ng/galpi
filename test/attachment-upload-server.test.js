'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const { LATEST_SCHEMA_VERSION } = require('../lib/database-migrations');

const ROOT = path.resolve(__dirname, '..');
const API_TOKEN = 'attachment-admin-token';

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

function attachmentForm() {
  const form = new FormData();
  form.set('file', new Blob(['서버 통합 첨부'], { type: 'text/plain' }), '통합.txt');
  return form;
}

test('attachment route is authenticated, feature-flagged, and stores only in the data directory', async t => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'attachment-upload-server-'));
  const vaultPath = path.join(appRoot, 'vault');
  await fs.mkdir(vaultPath);
  await fs.copyFile(path.join(ROOT, 'server.js'), path.join(appRoot, 'server.js'));
  for (const name of ['lib', 'scripts', 'public', 'config', '.codex', 'node_modules']) {
    await fs.symlink(path.join(ROOT, name), path.join(appRoot, name), 'dir');
  }

  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  const logs = [];
  const child = spawn(process.execPath, ['server.js'], {
    cwd: appRoot,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: 'test-key',
      GPT_RESPONSES_ENABLED: 'false',
      MODEL_CATALOG_REFRESH_ENABLED: 'false',
      ASSISTANT_TASKS_ENABLED: 'false',
      WEB_PUSH_ENABLED: 'false',
      VOICE_SHORTCUT_ENABLED: 'false',
      VOICE_HALFDUPLEX_ENABLED: 'false',
      ATTACHMENTS_ENABLED: 'true',
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
    await fs.rm(appRoot, { recursive: true, force: true });
  });

  await waitForServer(child, url, logs);
  const configResponse = await fetch(`${url}/api/config`, {
    headers: { 'X-API-Token': API_TOKEN },
  });
  const config = await configResponse.json();
  assert.deepEqual(config.attachments, {
    enabled: true,
    maxFilesPerMessage: 6,
    maxDocumentsPerMessage: 1,
    maxPdfBytes: 20 * 1024 * 1024,
    maxImageBytes: 10 * 1024 * 1024,
    maxImageBytesPerMessage: 12 * 1024 * 1024,
    maxTextBytes: 2 * 1024 * 1024,
    orphanRetentionMinutes: 60,
  });

  const unauthorized = await fetch(`${url}/api/attachments`, {
    method: 'POST',
    body: attachmentForm(),
  });
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).error, 'API 토큰이 필요합니다.');

  const uploaded = await fetch(`${url}/api/attachments`, {
    method: 'POST',
    headers: { 'X-API-Token': API_TOKEN },
    body: attachmentForm(),
  });
  const body = await uploaded.json();
  assert.equal(uploaded.status, 201, JSON.stringify(body));
  assert.equal(uploaded.headers.get('cache-control'), 'no-store');
  assert.equal(body.filename, '통합.txt');

  const dbPath = path.join(appRoot, 'galpi.db');
  const writable = new Database(dbPath);
  assert.equal(
    writable.prepare('SELECT MAX(version) AS version FROM schema_version').get().version,
    LATEST_SCHEMA_VERSION
  );
  const stored = writable.prepare(`
    SELECT a.id, a.lifecycle_status AS lifecycleStatus,
           b.stored_path AS storedPath, b.status, b.sha256
    FROM attachments a JOIN attachment_blobs b ON b.id = a.blob_id
  `).get();
  assert.equal(stored.id, body.attachmentId);
  assert.equal(stored.lifecycleStatus, 'uploaded_unattached');
  assert.equal(stored.status, 'ready');
  assert.equal(
    await fs.realpath(path.dirname(stored.storedPath)),
    await fs.realpath(path.join(appRoot, 'attachments', 'tmp')),
  );
  assert.equal((await fs.readFile(stored.storedPath, 'utf8')), '서버 통합 첨부');
  assert.equal(logs.join('').includes('서버 통합 첨부'), false);

  writable.prepare("INSERT INTO sessions (id) VALUES ('shared-main')").run();
  const userMessageId = Number(writable.prepare(`
    INSERT INTO messages (session_id, role, content)
    VALUES ('shared-main', 'user', '이 문서를 읽어줘')
  `).run().lastInsertRowid);
  writable.prepare(`
    UPDATE attachments
    SET session_id = 'shared-main', lifecycle_status = 'attached_temporary', attached_at = 1
    WHERE id = ?
  `).run(body.attachmentId);
  writable.prepare(`
    INSERT INTO message_attachments (
      message_id, attachment_id, origin_user_turn_index, replay_window_turns
    ) VALUES (?, ?, 1, 10)
  `).run(userMessageId, body.attachmentId);
  writable.prepare(`
    INSERT INTO attachment_documents (
      attachment_id, content_sha256, parser_version, parse_status,
      line_count, char_count, chunk_count, parsed_at
    ) VALUES (?, ?, 'text-v1', 'ready', 1, 9, 1, 1)
  `).run(body.attachmentId, stored.sha256);
  writable.prepare(`
    INSERT INTO attachment_chunks (
      chunk_id, attachment_id, chunk_index, line_start, line_end,
      content, content_sha256
    ) VALUES ('atch_server_library_0001', ?, 0, 1, 1, '서버 통합 첨부', ?)
  `).run(body.attachmentId, crypto.createHash('sha256').update('서버 통합 첨부').digest('hex'));
  writable.close();

  // 임시 첨부 원본 열기: 인증과 대화 경계를 지키고 본문을 그대로 돌려준다.
  const unauthorizedOriginal = await fetch(
    `${url}/api/attachments/${body.attachmentId}/original?sessionId=shared-main`,
  );
  assert.equal(unauthorizedOriginal.status, 401);
  const wrongSessionOriginal = await fetch(
    `${url}/api/attachments/${body.attachmentId}/original?sessionId=other-session`,
    { headers: { 'X-API-Token': API_TOKEN } },
  );
  assert.equal(wrongSessionOriginal.status, 409);
  assert.equal((await wrongSessionOriginal.json()).code, 'ATTACHMENT_SESSION_MISMATCH');

  const original = await fetch(
    `${url}/api/attachments/${body.attachmentId}/original?sessionId=shared-main`,
    { headers: { 'X-API-Token': API_TOKEN } },
  );
  assert.equal(original.status, 200);
  // Express가 text/*에 charset을 붙인다. 업로드에서 UTF-8을 검증하므로 맞는 값이다.
  assert.match(original.headers.get('content-type'), /^text\/plain(; charset=utf-8)?$/);
  assert.equal(original.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(original.headers.get('cache-control'), 'no-store');
  // 텍스트는 브라우저가 렌더하지 않도록 내려받게 하고 한글 이름을 함께 보낸다.
  assert.match(original.headers.get('content-disposition'), /^attachment;/);
  assert.match(original.headers.get('content-disposition'), /filename\*=UTF-8''%ED%86%B5%ED%95%A9/);
  assert.equal(await original.text(), '서버 통합 첨부');

  const missingOriginal = await fetch(
    `${url}/api/attachments/att_00000000000000000000000000000000/original?sessionId=shared-main`,
    { headers: { 'X-API-Token': API_TOKEN } },
  );
  assert.equal(missingOriginal.status, 404);

  const unauthorizedPromotion = await fetch(`${url}/api/attachments/${body.attachmentId}/library`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'shared-main' }),
  });
  assert.equal(unauthorizedPromotion.status, 401);
  const wrongSession = await fetch(`${url}/api/attachments/${body.attachmentId}/library`, {
    method: 'POST',
    headers: { 'X-API-Token': API_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'other-session' }),
  });
  assert.equal(wrongSession.status, 409);
  assert.equal((await wrongSession.json()).code, 'ATTACHMENT_SESSION_MISMATCH');

  const promoted = await fetch(`${url}/api/attachments/${body.attachmentId}/library`, {
    method: 'POST',
    headers: { 'X-API-Token': API_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'shared-main' }),
  });
  const promotedBody = await promoted.json();
  assert.equal(promoted.status, 200, JSON.stringify(promotedBody));
  assert.equal(promotedBody.status, 'library');
  assert.equal(promotedBody.duplicate, false);
  assert.equal(Object.hasOwn(promotedBody, 'noteContent'), false);

  // 승격 뒤에도 열린다. 서재 자료는 대화와 무관하다.
  const libraryOriginal = await fetch(
    `${url}/api/attachments/${body.attachmentId}/original?sessionId=other-session`,
    { headers: { 'X-API-Token': API_TOKEN } },
  );
  assert.equal(libraryOriginal.status, 200);
  assert.equal(await libraryOriginal.text(), '서버 통합 첨부');

  const db = new Database(dbPath, { readonly: true });
  t.after(() => db.close());
  assert.deepEqual(db.prepare(`
    SELECT scope, lifecycle_status AS status FROM attachments WHERE id = ?
  `).get(body.attachmentId), { scope: 'library', status: 'library' });
  const library = db.prepare(`
    SELECT li.note_filename AS noteFilename, b.stored_path AS storedPath
    FROM attachment_library_items li
    JOIN attachments a ON a.id = li.attachment_id
    JOIN attachment_blobs b ON b.id = a.blob_id
    WHERE li.attachment_id = ?
  `).get(body.attachmentId);
  assert.equal(library.noteFilename, promotedBody.noteFilename);
  assert.equal((await fs.readFile(library.storedPath, 'utf8')), '서버 통합 첨부');
  assert.match(await fs.readFile(path.join(vaultPath, library.noteFilename), 'utf8'), /attachment_state: library/);
  await assert.rejects(fs.access(stored.storedPath), error => error.code === 'ENOENT');
});
