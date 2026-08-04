'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { auditTopicStore, parseTopicNote, sha256 } = require('../lib/topic-store');

const ROOT = path.resolve(__dirname, '..');
const API_TOKEN = 'topic-mutation-test-token';

function qaEntry(qaId, question, answer, stamp = '2026-07-17 09:00') {
  return [
    `### ${stamp} · Claude`,
    `<!-- qa_id: ${qaId} -->`,
    `**Q:** ${question}`,
    '',
    `**A:** ${answer}`,
  ].join('\n');
}

function topicNote(id, title, entries) {
  return [
    '---',
    `id: ${id}`,
    `title: "${title}"`,
    `aliases: ["${title}"]`,
    'created: 2026-07-17 09:00',
    'updated: 2026-07-17 09:00',
    'note_type: topic',
    'archived: false',
    'codex_status: pending',
    '---',
    '',
    `# ${title}`,
    '',
    '## 요약',
    '<!-- CODEX-SUMMARY-START -->',
    '- 테스트 요약',
    '<!-- CODEX-SUMMARY-END -->',
    '',
    '## Q&A 로그',
    '<!-- QA-LOG-START -->',
    '',
    entries.join('\n\n'),
    '',
    '<!-- QA-LOG-END -->',
    '',
    '## 태그',
    '<!-- CODEX-TAGS-START -->',
    '<!-- CODEX-TAGS-END -->',
    '',
    '## 연결',
    '<!-- CODEX-LINKS-START -->',
    '<!-- CODEX-LINKS-END -->',
    '',
    '## 제안',
    '<!-- CODEX-PROPOSALS-START -->',
    '<!-- CODEX-PROPOSALS-END -->',
    '',
  ].join('\n');
}

function legacyNote(title) {
  return [
    '---',
    `title: "${title}"`,
    'note_type: highlight',
    'archived: false',
    'codex_status: pending',
    '---',
    '',
    `# ${title}`,
    '',
    '## 결론',
    '병합할 레거시 노트의 핵심 내용',
    '',
  ].join('\n');
}

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
  for (let attempt = 0; attempt < 80; attempt += 1) {
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
  if (child.exitCode !== null) return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('테스트 서버 종료 시간 초과')), 3000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill('SIGTERM');
  });
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
  const body = await response.json();
  return { response, body };
}

test('server routes share one mutation path for split, archive/restore, and merge', async t => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'topic-mutation-server-'));
  let child = null;
  t.after(async () => {
    if (child) await stopServer(child);
    await fs.rm(appRoot, { recursive: true, force: true });
  });
  const vaultPath = path.join(appRoot, 'vault');
  await fs.mkdir(vaultPath);
  await fs.copyFile(path.join(ROOT, 'server.js'), path.join(appRoot, 'server.js'));
  for (const name of ['lib', 'scripts', 'public', 'config', '.codex', 'node_modules']) {
    await fs.symlink(path.join(ROOT, name), path.join(appRoot, name), 'dir');
  }

  const sourceEntry = qaEntry('qa-a111', 'source 질문', 'source 답변');
  const targetEntry = qaEntry('qa-b222', 'target 질문', 'target 답변', '2026-07-17 10:00');
  await fs.writeFile(path.join(vaultPath, 'source.md'), topicNote('source', 'Source', [sourceEntry]));
  await fs.writeFile(path.join(vaultPath, 'target.md'), topicNote('target', 'Target', [targetEntry]));
  await fs.writeFile(path.join(vaultPath, 'legacy.md'), legacyNote('Legacy'));

  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  const logs = [];
  child = spawn(process.execPath, ['server.js'], {
    cwd: appRoot,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: 'test-key',
      OPENAI_API_KEY: '',
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

  await waitForServer(child, url, logs);
  const sync = await api(url, '/api/notes/sync', { method: 'POST', body: '{}' });
  assert.equal(sync.response.status, 200, JSON.stringify(sync.body));

  const dbPath = path.join(appRoot, 'galpi.db');
  const db = new Database(dbPath);
  const insertChunk = db.prepare(`
    INSERT INTO note_chunks (
      chunk_id, note_filename, note_title, chunk_type, content,
      embedding, content_sha256, index_status
    ) VALUES (?, ?, ?, 'topic_qa', ?, '[]', ?, 'ready')
  `);
  const sourceChunk = 'Q: source 질문\nA: source 답변';
  const targetChunk = 'Q: target 질문\nA: target 답변';
  const sourceMissingChunk = 'Q: 사라진 질문\nA: 사라진 답변';
  insertChunk.run('qa-a111', 'source.md', 'Source', sourceChunk, sha256(sourceChunk));
  insertChunk.run('qa-b222', 'target.md', 'Target', targetChunk, sha256(targetChunk));
  db.prepare("UPDATE note_chunks SET note_title = 'Stale Source' WHERE chunk_id = 'qa-a111'").run();
  db.prepare(`
    INSERT INTO note_chunks (
      chunk_id, note_filename, note_title, chunk_type, content,
      embedding, content_sha256, index_status
    ) VALUES (?, ?, ?, 'topic_qa', ?, '[]', ?, 'source_missing')
  `).run('qa-extra', 'source.md', 'Source', sourceMissingChunk, sha256(sourceMissingChunk));
  db.close();

  const graph = await api(url, '/api/graph/report', { method: 'POST', body: '{}' });
  assert.equal(graph.response.status, 200, JSON.stringify(graph.body));
  const graphRaw = await fs.readFile(path.join(vaultPath, '_system', 'GRAPH_REPORT.md'), 'utf8');
  assert.match(graphRaw, /\[\[source\|Source\]\]/);
  assert.doesNotMatch(graphRaw, /Stale Source/);

  const quarantineDb = new Database(dbPath);
  quarantineDb.prepare(
    "UPDATE notes SET codex_status = 'recovery_required' WHERE filename = 'source.md'",
  ).run();
  quarantineDb.close();
  const quarantinedSourceSplit = await api(url, '/api/notes/split', {
    method: 'POST',
    body: JSON.stringify({
      sourceFilename: 'source.md',
      qaIds: ['qa-a111'],
      targetFilename: 'target.md',
    }),
  });
  assert.equal(quarantinedSourceSplit.response.status, 400, JSON.stringify(quarantinedSourceSplit.body));
  assert.match(quarantinedSourceSplit.body.error, /수동 확인 또는 원본 복구/);
  const quarantinedSourceArchive = await api(url, '/api/notes/archive', {
    method: 'POST',
    body: JSON.stringify({ filename: 'source.md' }),
  });
  assert.equal(quarantinedSourceArchive.response.status, 500, JSON.stringify(quarantinedSourceArchive.body));
  const quarantinedSourceMerge = await api(url, '/api/notes/merge', {
    method: 'POST',
    body: JSON.stringify({ filenames: ['source.md'], targetFilename: 'target.md' }),
  });
  assert.equal(quarantinedSourceMerge.response.status, 500, JSON.stringify(quarantinedSourceMerge.body));

  const targetQuarantineDb = new Database(dbPath);
  targetQuarantineDb.prepare("UPDATE notes SET codex_status = 'pending' WHERE filename = 'source.md'").run();
  targetQuarantineDb.prepare(
    "UPDATE notes SET codex_status = 'recovery_required' WHERE filename = 'target.md'",
  ).run();
  targetQuarantineDb.close();
  const quarantinedTargetSplit = await api(url, '/api/notes/split', {
    method: 'POST',
    body: JSON.stringify({
      sourceFilename: 'source.md',
      qaIds: ['qa-a111'],
      targetFilename: 'target.md',
    }),
  });
  assert.equal(quarantinedTargetSplit.response.status, 400, JSON.stringify(quarantinedTargetSplit.body));
  assert.match(quarantinedTargetSplit.body.error, /수동 확인 또는 원본 복구/);
  const quarantinedTargetArchive = await api(url, '/api/notes/archive', {
    method: 'POST',
    body: JSON.stringify({ filename: 'target.md' }),
  });
  assert.equal(quarantinedTargetArchive.response.status, 500, JSON.stringify(quarantinedTargetArchive.body));
  const quarantinedTargetMerge = await api(url, '/api/notes/merge', {
    method: 'POST',
    body: JSON.stringify({ filenames: ['legacy.md'], targetFilename: 'target.md' }),
  });
  assert.equal(quarantinedTargetMerge.response.status, 500, JSON.stringify(quarantinedTargetMerge.body));
  const unquarantineDb = new Database(dbPath);
  unquarantineDb.prepare("UPDATE notes SET codex_status = 'pending' WHERE filename = 'target.md'").run();
  unquarantineDb.close();

  const blockedSplit = await api(url, '/api/notes/split', {
    method: 'POST',
    body: JSON.stringify({
      sourceFilename: 'source.md',
      qaIds: ['qa-a111'],
      targetFilename: 'target.md',
    }),
  });
  assert.equal(blockedSplit.response.status, 400, JSON.stringify(blockedSplit.body));
  assert.match(blockedSplit.body.error, /이동 대상 밖의 청크/);
  await fs.access(path.join(vaultPath, 'source.md'));
  assert.deepEqual(
    parseTopicNote(await fs.readFile(path.join(vaultPath, 'target.md'), 'utf8'), { filename: 'target.md' })
      .entries.map(entry => entry.qaId),
    ['qa-b222'],
  );

  const cleanupDb = new Database(dbPath);
  cleanupDb.prepare("DELETE FROM note_chunks WHERE chunk_id = 'qa-extra'").run();
  cleanupDb.close();

  const split = await api(url, '/api/notes/split', {
    method: 'POST',
    body: JSON.stringify({
      sourceFilename: 'source.md',
      qaIds: ['qa-a111'],
      targetFilename: 'target.md',
    }),
  });
  assert.equal(split.response.status, 200, JSON.stringify(split.body));
  assert.equal(split.body.sourceDeleted, true);
  await assert.rejects(fs.access(path.join(vaultPath, 'source.md')), { code: 'ENOENT' });

  const afterSplit = parseTopicNote(await fs.readFile(path.join(vaultPath, 'target.md'), 'utf8'), {
    filename: 'target.md',
  });
  assert.deepEqual(afterSplit.entries.map(entry => entry.qaId), ['qa-b222', 'qa-a111']);

  const archive = await api(url, '/api/notes/archive', {
    method: 'POST',
    body: JSON.stringify({ filename: 'target.md' }),
  });
  assert.equal(archive.response.status, 200, JSON.stringify(archive.body));
  await fs.access(path.join(vaultPath, '_archive', 'target.md'));

  const restore = await api(url, '/api/notes/restore', {
    method: 'POST',
    body: JSON.stringify({ filename: 'target.md' }),
  });
  assert.equal(restore.response.status, 200, JSON.stringify(restore.body));
  await fs.access(path.join(vaultPath, 'target.md'));

  const merge = await api(url, '/api/notes/merge', {
    method: 'POST',
    body: JSON.stringify({ filenames: ['legacy.md'], targetFilename: 'target.md' }),
  });
  assert.equal(merge.response.status, 200, JSON.stringify(merge.body));
  assert.deepEqual(merge.body.archived, ['legacy.md']);
  await fs.access(path.join(vaultPath, '_archive', 'legacy.md'));

  const finalTopic = parseTopicNote(await fs.readFile(path.join(vaultPath, 'target.md'), 'utf8'), {
    filename: 'target.md',
  });
  assert.equal(finalTopic.parseable, true);
  assert.equal(finalTopic.entries.length, 3);

  const finalDb = new Database(dbPath);
  finalDb.prepare("UPDATE note_chunks SET embedding = '[]' WHERE embedding IS NULL").run();
  const assignments = finalDb.prepare(`
    SELECT chunk_id AS chunkId, note_filename AS filename
    FROM note_chunks
    ORDER BY chunk_id
  `).all();
  assert.equal(assignments.length, 3);
  assert.ok(assignments.every(row => row.filename === 'target.md'));
  assert.equal(finalDb.prepare("SELECT archived FROM notes WHERE filename = 'legacy.md'").get().archived, 1);
  const audit = await auditTopicStore({ db: finalDb, vaultPath });
  finalDb.close();
  assert.equal(audit.healthy, true);
  assert.equal(audit.summary.fileQaEntries, 3);
  assert.equal(audit.summary.matchedQa, 3);

  await fs.rm(path.join(vaultPath, 'target.md'));
  const missingSync = await api(url, '/api/notes/sync', { method: 'POST', body: '{}' });
  assert.equal(missingSync.response.status, 200, JSON.stringify(missingSync.body));
  assert.equal(missingSync.body.missing, 1);
  const preservedDb = new Database(dbPath, { readonly: true });
  assert.equal(preservedDb.prepare("SELECT index_status AS status FROM notes WHERE filename='target.md'").get().status, 'missing');
  assert.equal(preservedDb.prepare("SELECT COUNT(*) AS count FROM note_chunks WHERE note_filename='target.md'").get().count, 3);
  preservedDb.close();
});

test('ai_readable false stays human-visible and is excluded from every server AI path', async t => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-readable-server-'));
  let child = null;
  t.after(async () => {
    if (child) await stopServer(child);
    await fs.rm(appRoot, { recursive: true, force: true });
  });

  const vaultPath = path.join(appRoot, 'vault');
  await fs.mkdir(vaultPath);
  await fs.copyFile(path.join(ROOT, 'server.js'), path.join(appRoot, 'server.js'));
  for (const name of ['lib', 'scripts', 'public', 'config', '.codex', 'node_modules']) {
    await fs.symlink(path.join(ROOT, name), path.join(appRoot, name), 'dir');
  }

  const visibleFilename = 'visible.md';
  const hiddenFilename = 'hidden.md';
  const visibleRaw = topicNote('visible', 'Visible Boundary', [
    qaEntry('qa-visible', 'VISIBLEBOUNDARY 일정은?', '읽을 수 있는 일정이다.'),
  ]).replace('codex_status: pending', 'codex_status: pending\nai_readable: true');
  const hiddenRaw = topicNote('hidden', 'Hidden Boundary', [
    qaEntry('qa-hidden', 'HIDDENBOUNDARY 비밀은?', 'AI에 전달하면 안 된다.'),
  ]).replace('codex_status: pending', 'codex_status: pending\nai_readable: false');
  await fs.writeFile(path.join(vaultPath, visibleFilename), visibleRaw);
  await fs.writeFile(path.join(vaultPath, hiddenFilename), hiddenRaw);
  const promptPath = path.join(appRoot, 'codex-prompt.txt');
  const runnerPath = path.join(appRoot, 'fake-codex');
  await fs.writeFile(runnerPath, [
    `#!${process.execPath}`,
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const args = process.argv.slice(2);",
    "if (args[0] === '--version') { console.log('codex-cli ai-readable-test'); process.exit(0); }",
    "if (args[0] === 'login') { console.log('Logged in using test'); process.exit(0); }",
    "const root = args[args.indexOf('-C') + 1];",
    "const prompt = fs.readFileSync(0, 'utf8');",
    "fs.writeFileSync(process.env.PROMPT_PATH, prompt);",
    "const targets = (prompt.split('대상 파일:\\n')[1] || '').split('\\n\\n목표:')[0]",
    "  .split('\\n').filter(line => line.startsWith('- ')).map(line => line.slice(2).trim());",
    "for (const filename of targets) {",
    "  const filepath = path.join(root, filename);",
    "  let raw = fs.readFileSync(filepath, 'utf8');",
    "  raw = raw.replace(/(?<=<!-- CODEX-TAGS-START -->)[\\s\\S]*?(?=<!-- CODEX-TAGS-END -->)/, '\\n#경계 #테스트 #허용\\n');",
    "  fs.writeFileSync(filepath, raw);",
    "}",
    '',
  ].join('\n'));
  await fs.chmod(runnerPath, 0o755);

  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  const logs = [];
  child = spawn(process.execPath, ['server.js'], {
    cwd: appRoot,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: 'test-key',
      OPENAI_API_KEY: '',
      API_TOKEN,
      HOST: '127.0.0.1',
      PORT: String(port),
      VAULT_PATH: vaultPath,
      BACKUP_DIR: path.join(appRoot, 'backups'),
      CODEX_BIN: runnerPath,
      CODEX_RUNNER_MODE: 'codex',
      PROMPT_PATH: promptPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => logs.push(chunk.toString()));
  child.stderr.on('data', chunk => logs.push(chunk.toString()));
  await waitForServer(child, url, logs);

  const sync = await api(url, '/api/notes/sync', { method: 'POST', body: '{}' });
  assert.equal(sync.response.status, 200, JSON.stringify(sync.body));

  const dbPath = path.join(appRoot, 'galpi.db');
  const db = new Database(dbPath, { readonly: true });
  assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_version').get().version, 15);
  assert.deepEqual(
    db.prepare('SELECT filename, ai_readable AS aiReadable FROM notes ORDER BY filename').all(),
    [
      { filename: hiddenFilename, aiReadable: 0 },
      { filename: visibleFilename, aiReadable: 1 },
    ],
  );
  db.close();

  const humanList = await api(url, '/api/vault/notes?limit=100');
  assert.deepEqual(
    new Set(humanList.body.notes.map(note => note.filename)),
    new Set([visibleFilename, hiddenFilename]),
  );
  const aiList = await api(url, '/api/vault/notes?limit=100&forAi=true');
  assert.deepEqual(aiList.body.notes.map(note => note.filename), [visibleFilename]);

  const humanRead = await api(url, `/api/vault/note/${hiddenFilename}`);
  assert.equal(humanRead.response.status, 200, JSON.stringify(humanRead.body));
  assert.match(humanRead.body.note.content, /HIDDENBOUNDARY/);
  const aiRead = await api(url, `/api/vault/note/${hiddenFilename}?forAi=true`);
  assert.equal(aiRead.response.status, 409, JSON.stringify(aiRead.body));

  const hiddenSearch = await api(url, '/api/vault/search?q=HIDDENBOUNDARY');
  assert.deepEqual(hiddenSearch.body.results, []);
  const visibleSearch = await api(url, '/api/vault/search?q=Visible%20Boundary');
  assert.deepEqual(visibleSearch.body.results.map(note => note.filename), [visibleFilename]);

  const hiddenMerge = await api(url, '/api/notes/merge', {
    method: 'POST',
    body: JSON.stringify({ filenames: [hiddenFilename], targetFilename: visibleFilename }),
  });
  assert.equal(hiddenMerge.response.status, 500, JSON.stringify(hiddenMerge.body));
  assert.match(hiddenMerge.body.error, /AI 읽기를 허용하지 않은 노트/);

  const queue = await api(url, '/api/organize/queue', { method: 'POST', body: '{}' });
  assert.equal(queue.response.status, 200, JSON.stringify(queue.body));
  assert.deepEqual(queue.body.notes.map(note => note.filename), [visibleFilename]);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      await fs.access(promptPath);
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  const codexPrompt = await fs.readFile(promptPath, 'utf8');
  assert.match(codexPrompt, /visible\.md/);
  assert.doesNotMatch(codexPrompt, /hidden\.md|Hidden Boundary|HIDDENBOUNDARY/);

  const graph = await api(url, '/api/graph/report', { method: 'POST', body: '{}' });
  assert.equal(graph.response.status, 200, JSON.stringify(graph.body));
  const graphRaw = await fs.readFile(path.join(vaultPath, '_system', 'GRAPH_REPORT.md'), 'utf8');
  assert.match(graphRaw, /Visible Boundary/);
  assert.doesNotMatch(graphRaw, /Hidden Boundary|HIDDENBOUNDARY/);
  assert.equal(await fs.readFile(path.join(vaultPath, hiddenFilename), 'utf8'), hiddenRaw);
});
