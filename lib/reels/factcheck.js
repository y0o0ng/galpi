'use strict';

const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');

const RETRY_MS = 5 * 60 * 1000;
const MAX_RETRIES = 3;
const urlsIn = text => [...new Set((text.match(/https?:\/\/[^\s)|>`\]]+/g) || []).map(u => u.replace(/[.,;:]+$/, '')))];

function validReport(report) {
  return report?.version === 1 && Number.isInteger(report.rows) && report.rows > 0
    && Array.isArray(report.claims) && report.claims.length >= report.rows
    && report.claims.every(c => typeof c.row === 'string' && typeof c.claim === 'string'
      && typeof c.quote === 'string' && Array.isArray(c.sources) && c.sources.every(u => typeof u === 'string')
      && ['matched', 'mismatch', 'source_unavailable', 'missing_quote'].includes(c.status)
      && (c.status === 'matched' ? c.found === true && typeof c.url === 'string' && c.quote.length > 0 : c.found !== true))
    && Array.isArray(report.sources) && report.sources.every(u => typeof u === 'string')
    && Array.isArray(report.fetch_errors) && report.fetch_errors.every(e => typeof e.url === 'string' && typeof e.reason === 'string');
}

// 정상 보고서의 종료 코드 1은 검사 결과이며, 프로세스 실행 오류가 아니다.
async function checkFacts({ py, factcheck, finalPath, cwd, signal, onProgress = () => {},
  run = promisify(execFile), pause = ms => delay(ms, undefined, { signal }), excludedSources = [] }) {
  const history = [];
  let executionRetries = 0;
  let sourceRetries = 0;
  while (true) {
    signal?.throwIfAborted();
    let output, error;
    try {
      output = await run(py, [factcheck, finalPath, '--report'], {
        cwd, timeout: RETRY_MS, maxBuffer: 4 * 1024 * 1024, signal,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG, CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN },
      });
    } catch (e) { error = e; output = e; }
    signal?.throwIfAborted();
    let report;
    try { report = JSON.parse(output?.stdout); } catch {}
    const executionError = (error && (error.code !== 1 || error.killed || error.signal)) || !validReport(report);
    history.push({ at: new Date().toISOString(), code: error?.code ?? 0, signal: error?.signal ?? null,
      stdout: String(output?.stdout ?? '').slice(0, 65536), stderr: String(output?.stderr ?? '').slice(0, 65536),
      executionError: Boolean(executionError), reason: executionError ? String(error?.message ?? '정상적인 검사 보고서가 없습니다.').slice(0, 500) : null });
    const progress = { history: [...history], executionRetries, sourceRetries };
    onProgress(progress);
    if (executionError) {
      if (executionRetries < MAX_RETRIES) {
        executionRetries += 1;
        await pause(RETRY_MS);
        continue;
      }
      return { ...progress, rewrite: true, code: 'REELS_FACTCHECK_EXEC',
        reason: '검사 실행 재시도 소진: 기존 출처 전체 제외 후 대본 재작성',
        excludeAllSources: true, excludedSources: [...new Set([...excludedSources, ...urlsIn(fs.readFileSync(finalPath, 'utf8'))])], mismatches: [] };
    }
    if (report.fetch_errors.length && sourceRetries < MAX_RETRIES) {
      sourceRetries += 1;
      await pause(RETRY_MS);
      continue;
    }
    const unavailable = report.fetch_errors.map(e => e.url);
    const reused = urlsIn(fs.readFileSync(finalPath, 'utf8')).filter(u => excludedSources.includes(u));
    const mismatches = report.claims.filter(c => c.status === 'mismatch' || c.status === 'missing_quote'
      || (c.status === 'source_unavailable' && c.sources.some(u => !unavailable.includes(u))))
      .map(c => c.status === 'source_unavailable' ? { ...c, status: 'mismatch' } : c);
    const failure = unavailable.length || reused.length || mismatches.length || report.claims.some(c => c.found !== true);
    return { ...progress, ...report, rewrite: Boolean(failure),
      code: failure ? unavailable.length ? 'REELS_FACTCHECK_SOURCE' : 'REELS_FACTCHECK' : null,
      reason: failure ? `출처 확인 실패 ${unavailable.length}개, 인용 불일치·누락 ${mismatches.length}개, 제외 출처 재사용 ${reused.length}개` : null,
      excludedSources: [...new Set([...excludedSources, ...unavailable, ...reused])], mismatches };
  }
}

module.exports = { checkFacts };
