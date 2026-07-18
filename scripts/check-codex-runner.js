'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TIMEOUT_MS = 10_000;

require('dotenv').config({ path: path.join(ROOT, '.env') });

function safeLine(value, fallback, preferredPattern = null) {
  const lines = String(value || '')
    .split(/\r?\n/)
    .map(part => part.trim())
    .filter(Boolean);
  const line = (preferredPattern && lines.find(part => preferredPattern.test(part))) || lines[0];
  if (!line) return fallback;
  return line
    .replace(/\b(?:sk|sess|token)-[A-Za-z0-9._-]+\b/gi, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .slice(0, 200);
}

function runCheck(codexBin, label, args) {
  const preferredPattern = args[0] === 'login'
    ? /(?:not )?logged in|login required|authentication/i
    : null;
  const result = spawnSync(codexBin, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: TIMEOUT_MS,
  });

  if (result.error) {
    const code = result.error.code || 'SPAWN_ERROR';
    throw new Error(`${label}: ${code}`);
  }
  if (result.status !== 0) {
    const detail = safeLine(
      `${result.stderr || ''}\n${result.stdout || ''}`,
      `exit ${result.status}`,
      preferredPattern,
    );
    throw new Error(`${label}: ${detail}`);
  }

  return safeLine(`${result.stdout || ''}\n${result.stderr || ''}`, '정상', preferredPattern);
}

function main() {
  const codexBin = String(process.env.CODEX_BIN || 'codex').trim();
  if (!codexBin) throw new Error('CODEX_BIN이 비어 있습니다.');
  if (!path.isAbsolute(codexBin)) {
    throw new Error('CODEX_BIN은 systemd에서도 같은 파일을 쓰도록 절대 경로여야 합니다.');
  }

  const version = runCheck(codexBin, '버전 확인 실패', ['--version']);
  const login = runCheck(codexBin, '로그인 확인 실패', ['login', 'status']);
  process.stdout.write(`Codex runner 정상: ${version}; ${login}\n`);
}

try {
  main();
} catch (error) {
  console.error(`Codex runner 점검 실패: ${safeLine(error.message, '원인 미상')}`);
  process.exitCode = 1;
}
