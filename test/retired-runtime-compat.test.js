'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { once } = require('node:events');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const API_TOKEN = 'retired-runtime-test-token';
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} is missing`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) {
      return source.slice(start, index + 1);
    }
  }
  throw new Error(`${name} is not closed`);
}

const loadFunction = (source, name, context = {}) => (
  vm.runInNewContext(`(${functionSource(source, name)})`, context)
);

async function availablePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await once(child, 'exit');
}

test('active sources contain only half-duplex voice and historical Council readers', () => {
  const server = read('server.js');
  const app = read('public/app.js');
  const html = read('public/index.html');

  assert.doesNotMatch(server, /require\(['"]\.\/lib\/realtime-/);
  assert.doesNotMatch(server, /legacy\/voice-realtime/);
  assert.doesNotMatch(server, /realtimeVoice\s*:/);
  assert.doesNotMatch(server, /\/api\/council\/(?:debate|review|synthesize|save-note)/);
  assert.match(server, /registerVoiceHalfDuplexRoutes\(\{ app, voiceTts, voiceTranscriptions \}\)/);

  assert.doesNotMatch(html, /voice-realtime(?:\.js|-panel|-button)/);
  assert.doesNotMatch(app, /VoiceRealtime|\/api\/council\//);
  assert.match(app, /`councilUiHistory:\$\{sessionId\}`/);
  assert.match(app, /`councilActiveNotes:\$\{sessionId\}`/);
  assert.match(app, /'councilApiToken'/);
  assert.match(app, /parseCouncilTranscript[\s\S]*renderRestoredCouncilMessage/);

  for (const relative of [
    'legacy/voice-realtime/lib/realtime-session.js',
    'legacy/voice-realtime/lib/realtime-tool-dispatcher.js',
    'legacy/voice-realtime/lib/realtime-turn-store.js',
    'legacy/voice-realtime/public/voice-realtime.js',
  ]) assert.equal(fs.existsSync(path.join(ROOT, relative)), true);
});

test('old Council transcripts still parse and contribute synthesis-only model history', () => {
  const transcript = [
    '## 질문\n어떻게 할까?',
    '## Claude 초안\n초안',
    '## GPT 검증\n검증',
    '## 의회 설정\ndraftMode: deep',
    '## 종합\n최종 결론',
  ].join('\n\n---\n\n');
  const parseCouncilTranscript = loadFunction(read('public/app.js'), 'parseCouncilTranscript');
  assert.deepEqual(
    JSON.parse(JSON.stringify(parseCouncilTranscript(transcript, '의회'))),
    {
      question: '어떻게 할까?',
      claudeDraft: '초안',
      gptCritique: '검증',
      revisedDraft: null,
      gptCritique2: null,
      divergence: null,
      synthesis: '최종 결론',
      synthesizerModelId: null,
      councilDraftMode: 'deep',
    },
  );

  const server = read('server.js');
  const extractCouncilSynthesis = loadFunction(server, 'extractCouncilSynthesis');
  assert.equal(extractCouncilSynthesis(transcript), '최종 결론');
  const formatHistoryForModelContext = loadFunction(server, 'formatHistoryForModelContext', {
    normalizeMessageTimestamp: value => value,
    buildElapsedDayMarker: () => '',
    extractCouncilSynthesis,
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(formatHistoryForModelContext([
      { role: 'user', content: '어떻게 할까?', createdAt: 1 },
      { role: 'assistant', content: transcript, model: '의회', createdAt: 2 },
    ]))),
    [
      { role: 'user', content: '어떻게 할까?' },
      { role: 'assistant', content: '최종 결론' },
    ],
  );
});

test('Realtime and Council tombstones return 410 without provider calls', async t => {
  const appRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'retired-runtime-'));
  const vaultPath = path.join(appRoot, 'vault');
  await fsp.mkdir(vaultPath);
  await fsp.copyFile(path.join(ROOT, 'server.js'), path.join(appRoot, 'server.js'));
  for (const name of ['lib', 'scripts', 'public', 'config', '.codex', 'node_modules']) {
    await fsp.symlink(path.join(ROOT, name), path.join(appRoot, name), 'dir');
  }

  let providerCalls = 0;
  const provider = http.createServer((_req, res) => {
    providerCalls += 1;
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');

  const port = await availablePort();
  const logs = [];
  const child = spawn(process.execPath, ['server.js'], {
    cwd: appRoot,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: 'unused-provider-key',
      OPENAI_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`,
      GPT_RESPONSES_ENABLED: 'false',
      MODEL_CATALOG_REFRESH_ENABLED: 'false',
      VOICE_HALFDUPLEX_ENABLED: 'false',
      API_TOKEN,
      HOST: '127.0.0.1',
      PORT: String(port),
      VAULT_PATH: vaultPath,
      BACKUP_DIR: path.join(appRoot, 'backups'),
      CODEX_RUNNER_MODE: 'heuristic',
      ASSISTANT_TASKS_ENABLED: 'false',
      MAIL_AGENT_ENABLED: 'false',
      NEWS_AGENT_ENABLED: 'false',
      WEATHER_ENABLED: 'false',
      WEB_PUSH_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => logs.push(chunk.toString()));
  child.stderr.on('data', chunk => logs.push(chunk.toString()));
  t.after(async () => {
    await stopServer(child);
    await new Promise(resolve => provider.close(resolve));
    await fsp.rm(appRoot, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`server exited: ${logs.join('')}`);
    try {
      const response = await fetch(`${baseUrl}/api/config`, {
        headers: { 'X-API-Token': API_TOKEN },
      });
      if (response.ok) break;
    } catch (_) { /* still starting */ }
    await new Promise(resolve => setTimeout(resolve, 25));
    if (attempt === 399) throw new Error(`server did not start: ${logs.join('')}`);
  }

  const request = route => fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'X-API-Token': API_TOKEN, 'Content-Type': 'application/json' },
    body: '{}',
  });
  for (const route of [
    '/api/voice/realtime/session',
    '/api/voice/realtime/anything',
    '/api/council/debate',
    '/api/council/review',
  ]) {
    const response = await request(route);
    assert.equal(response.status, 410, route);
    const body = await response.json();
    assert.equal(body.code, route.includes('/council/') ? 'COUNCIL_RETIRED' : 'VOICE_REALTIME_RETIRED');
    if (route.includes('/council/')) assert.equal(body.replacement, '/api/chat');
  }
  assert.equal(providerCalls, 0);
});
