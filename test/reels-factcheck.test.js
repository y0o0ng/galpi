'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { checkFacts } = require('../lib/reels/factcheck');

const A = 'https://e.com/a';
const B = 'https://e.com/b';
const quote = 'The quick brown fox jumps over the lazy dog.';
const claim = (status = 'matched', sources = [A]) => ({ row: '1', claim: 'a claim', quote, source: sources.join(' / '),
  url: sources[0], sources, found: status === 'matched', status });
const report = (claims = [claim()], fetch_errors = []) => ({ version: 1, rows: claims.length, claims, fetch_errors,
  sources: [...new Set(claims.flatMap(c => c.sources))] });
const output = data => ({ stdout: JSON.stringify(data), stderr: '' });
const executionError = () => Object.assign(new Error('python unavailable'), { code: 'ENOENT', stderr: 'missing python' });
function setup(t, sequence, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reels-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const finalPath = path.join(dir, 'final.md');
  fs.writeFileSync(finalPath, `## 사실 확인 목록\n${A}\n${B}\n`);
  const waits = [], progress = [], calls = [];
  const options = { py: '/python', factcheck: '/checker', finalPath, cwd: dir,
    run: async (...args) => {
      calls.push(args);
      const next = sequence[Math.min(calls.length - 1, sequence.length - 1)];
      if (next instanceof Error) throw next;
      return output(next);
    }, pause: async ms => { waits.push(ms); }, onProgress: p => progress.push(p), ...extra };
  return { waits, progress, calls, options };
}

test('인용 불일치의 종료 코드 1은 실행 오류가 아니며 5분 재검사를 하지 않는다', async t => {
  const data = report([claim('mismatch')]);
  const ctx = setup(t, [Object.assign(new Error('exit 1'), { code: 1, ...output(data) })]);
  const result = await checkFacts(ctx.options);
  assert.equal(result.code, 'REELS_FACTCHECK');
  assert.deepEqual(result.mismatches, data.claims);
  assert.equal(result.history[0].executionError, false);
  assert.deepEqual(ctx.waits, []);
});

test('실행 오류가 있으면 부분 보고서의 접속 실패·인용 불일치를 판정하지 않는다', async t => {
  const broken = Object.assign(executionError(), output(report([claim('mismatch')], [{ url: B, reason: '403' }])));
  const ctx = setup(t, [broken, report()]);
  const result = await checkFacts(ctx.options);
  assert.equal(result.rewrite, false);
  assert.deepEqual(result.excludedSources, []);
  assert.deepEqual(ctx.waits, [300000]);
});

test('실행 오류는 최초 + 3회 재검사 뒤 기존 출처 전체를 제외한다', async t => {
  const ctx = setup(t, [executionError()]);
  const result = await checkFacts(ctx.options);
  assert.equal(ctx.calls.length, 4);
  assert.deepEqual(ctx.waits, [300000, 300000, 300000]);
  assert.equal(result.excludeAllSources, true);
  assert.equal(result.code, 'REELS_FACTCHECK_EXEC');
  assert.deepEqual(result.excludedSources, [A, B]);
  assert.equal(result.history.length, 4);
  assert.equal(ctx.progress.length, 4);
});

test('접속 실패가 회복되면 대본 재작성 없이 통과한다', async t => {
  const ctx = setup(t, [report([claim('source_unavailable')], [{ url: A, reason: '403' }]), report()]);
  const result = await checkFacts(ctx.options);
  assert.equal(result.rewrite, false);
  assert.deepEqual(ctx.waits, [300000]);
});

test('접속 실패 소진과 인용 불일치는 함께 대본 재작성에 전달한다', async t => {
  const unavailable = claim('source_unavailable');
  const mismatch = { ...claim('mismatch', [B]), row: '2' };
  const ctx = setup(t, [report([unavailable, mismatch], [{ url: A, reason: '403' }])]);
  const result = await checkFacts(ctx.options);
  assert.equal(ctx.calls.length, 4);
  assert.equal(result.code, 'REELS_FACTCHECK_SOURCE');
  assert.deepEqual(result.excludedSources, [A]);
  assert.deepEqual(result.mismatches, [mismatch]);
  assert.equal(result.sourceRetries, 3);
  assert.equal(result.executionRetries, 0);
});

test('인용 불일치가 없으면 접속 실패 출처만 제외한다', async t => {
  const ctx = setup(t, [report([claim('source_unavailable')], [{ url: A, reason: 'timeout' }])]);
  const result = await checkFacts(ctx.options);
  assert.deepEqual(result.excludedSources, [A]);
  assert.deepEqual(result.mismatches, []);
});

test('접속 실패 출처를 제외한 뒤 읽은 나머지 출처에도 없는 인용은 불일치에 포함한다', async t => {
  const ctx = setup(t, [report([claim('source_unavailable', [A, B])], [{ url: A, reason: '403' }])]);
  const result = await checkFacts(ctx.options);
  assert.deepEqual(result.excludedSources, [A]);
  assert.equal(result.mismatches.length, 1);
  assert.equal(result.mismatches[0].status, 'mismatch');
});

test('새 대본이 제외한 출처를 재사용하면 통과하지 않는다', async t => {
  const ctx = setup(t, [report()], { excludedSources: [A] });
  const result = await checkFacts(ctx.options);
  assert.equal(result.rewrite, true);
  assert.match(result.reason, /재사용 1개/);
});

test('빈 보고서·형식 오류·시간 초과는 실행 오류로 재검사한다', async t => {
  for (const bad of [{ version: 1, rows: 0, claims: [], fetch_errors: [], sources: [] },
    { garbage: true }, Object.assign(new Error('timed out'), { code: 1, killed: true, ...output(report()) })]) {
    const ctx = setup(t, [bad, report()]);
    const result = await checkFacts(ctx.options);
    assert.equal(result.history[0].executionError, true);
    assert.equal(result.rewrite, false);
    assert.deepEqual(ctx.waits, [300000]);
  }
});

test('중단은 5분 대기·재검사를 끝내고 출처 제외로 변환하지 않는다', async t => {
  const controller = new AbortController();
  const ctx = setup(t, [executionError()], { signal: controller.signal, pause: async () => {
    controller.abort(); controller.signal.throwIfAborted();
  } });
  await assert.rejects(checkFacts(ctx.options), { name: 'AbortError' });
  assert.equal(ctx.calls.length, 1);
});

test('접속 재검사 중 실행 오류가 나면 실행 재검사를 먼저 하고 두 예산을 별도로 제한한다', async t => {
  const sourceFailure = report([claim('source_unavailable')], [{ url: A, reason: '403' }]);
  const ctx = setup(t, [sourceFailure, executionError(), sourceFailure]);
  const result = await checkFacts(ctx.options);
  assert.equal(ctx.calls.length, 5);
  assert.equal(result.executionRetries, 1);
  assert.equal(result.sourceRetries, 3);
  assert.equal(result.history[1].executionError, true);
  assert.deepEqual(result.excludedSources, [A]);
});

const py = path.join(__dirname, '..', 'reels', '.venv', 'bin', 'python');
test('실제 Python 보고서: 일부 출처 미확인은 불일치가 아니고 한 출처 일치로 인용 확인', { skip: !fs.existsSync(py) }, () => {
  const code = `import sys,runpy,json,io
sys.dont_write_bytecode=True
m=runpy.run_path(sys.argv[1])
def fetch(url):
    if url.endswith('/b'): raise RuntimeError('403 forbidden')
    return 'The quick brown fox jumps over the lazy dog.'
m['check'].__globals__['fetch']=fetch
report={}
md='## 검토 결과\\n사실 확인 목록을 검토했다\\n| 99 | PASS | 설명 |\\n## 4. 사실 확인 목록\\n| 1 | first | https://e.com/a https://e.com/b | "The quick brown fox jumps over the lazy dog." |\\n| 2 | second | https://e.com/a https://e.com/b | "This quotation is absent from the source document." |\\n| 3 | third | https://e.com/a | "This quotation is absent from the source document." |\\n## 제작 제약\\n| 77 | ignored | table |'
m['check'](md,{},out=io.StringIO(),report=report)
print(json.dumps(report))`;
  const data = JSON.parse(execFileSync(py, ['-c', code, path.join(__dirname, '..', 'reels', 'factcheck.py')], { encoding: 'utf8' }));
  assert.deepEqual(data.claims.map(c => c.status), ['matched', 'source_unavailable', 'mismatch']);
  assert.equal(data.rows, 3);
  assert.deepEqual(data.fetch_errors, [{ url: B, reason: '403 forbidden' }]);
});
