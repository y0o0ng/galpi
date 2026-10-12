'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn: nodeSpawn } = require('node:child_process');
const { renderPrompt } = require('../reels/candidates');
const RESULT_SCHEMA = { type: 'object', additionalProperties: false, required: ['status', 'message'], properties: {
  status: { type: 'string', enum: ['ok', 'blocked'] }, message: { type: 'string' },
} };
const fail = (code, message) => Object.assign(new Error(message || code), { code });

// 단계는 새 세션. 환경에 API 키를 넘기지 않고 기존 ChatGPT 로그인을 CLI가 사용한다.
function runCodex({ config, model, cwd, prompt, writable = [], images = [], schema = RESULT_SCHEMA, signal, reasoningEffort = 'medium',
  timeoutMs = 40 * 60 * 1000, spawn = nodeSpawn, selectionOnly = false }) {
  fs.mkdirSync(cwd, { recursive: true });
  for (let parent = fs.realpathSync(cwd); ; parent = path.dirname(parent)) {
    if (fs.existsSync(path.join(parent, '.git'))) throw fail('CARDS_WORKSPACE_NOT_ISOLATED');
    if (path.dirname(parent) === parent) break;
  }
  const schemaPath = path.join(cwd, 'response-schema.json');
  const responsePath = path.join(cwd, 'response.json');
  fs.writeFileSync(schemaPath, JSON.stringify(schema));
  fs.writeFileSync(path.join(cwd, 'prompt.md'), prompt);
  fs.rmSync(responsePath, { force: true });
  const args = ['exec', '--model', model, '-C', cwd, '--skip-git-repo-check', '--ephemeral', '--ignore-user-config',
    '--sandbox', selectionOnly ? 'read-only' : 'workspace-write', '-c', 'approval_policy="never"', '-c', `sandbox_workspace_write.network_access=${!selectionOnly}`,
    '-c', `web_search="${selectionOnly ? 'disabled' : 'live'}"`, '-c', `model_reasoning_effort="${reasoningEffort}"`, '--json', '--color', 'never',
    '--output-schema', schemaPath, '-o', responsePath];
  for (const dir of writable) args.push('--add-dir', dir);
  for (const image of images) args.push('--image', image);
  args.push('-');
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(fail('CARDS_ABORTED'));
    const child = spawn(config.bin, args, { cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: Object.fromEntries(['PATH', 'HOME', 'USER', 'LANG', 'CODEX_HOME'].filter(k => process.env[k]).map(k => [k, process.env[k]])) });
    let settled = false, buffer = '', usage = null, skipping = false;
    const stop = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
    const finish = (error, result) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(result);
    };
    const abort = () => { stop(); finish(fail('CARDS_ABORTED')); };
    const timer = setTimeout(() => { stop(); finish(fail('CARDS_AGENT_TIMEOUT')); }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => {
      let text = chunk.toString();
      if (skipping) {
        const at = text.indexOf('\n');
        if (at === -1) return;
        text = text.slice(at + 1); skipping = false;
      }
      buffer += text;
      let at;
      while ((at = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
        try { const event = JSON.parse(line); if (event.type === 'turn.completed') usage = event.usage; } catch { /* 진단은 저장하지 않는다 */ }
      }
      // 이미지 도구의 큰 JSONL 이벤트는 버리고 다음 줄부터 usage만 읽는다.
      if (buffer.length > 1024 * 1024) { buffer = ''; skipping = true; }
    });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.on('error', () => finish(fail('CARDS_AGENT_SPAWN')));
    child.on('close', code => {
      if (settled) return;
      if (code !== 0) return finish(fail('CARDS_AGENT_EXIT', `Codex exit ${code}`));
      try { finish(null, { response: JSON.parse(fs.readFileSync(responsePath, 'utf8')), usage }); }
      catch { finish(fail('CARDS_AGENT_RESPONSE')); }
    });
    child.stdin.end(prompt);
  });
}
function promptFor(root, name, values) {
  return renderPrompt(fs.readFileSync(path.join(root, 'reels/prompts', `${name}.md`), 'utf8'), values);
}
module.exports = { RESULT_SCHEMA, fail, promptFor, runCodex };
