'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { claudeArgs, nextEpisode, produceEpisode, stageDefs, planPaths } = require('../lib/reels/production');

const REAL_PROMPTS = path.join(__dirname, '..', 'reels', 'prompts');
const CARD = { id: 7, title: 't', source_url: 'https://e.com/a', published_at: '2026-10-01', why: 'w', concept: 'c', bridge: 'b', template: '단계', hook_paradox: 'p', hook_term: 'h', hook_subtitle: 's', risk: 'r' };

// 임시 저장소: 앞 편 3편(번호 최대 3), 프롬프트 실물, 가짜 파이썬(factcheck 결과를 파일로 조절).
function fixture({ factcheck = '1 rows, 0 missing' } = {}) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'reels-prod-'));
  const reelsDir = path.join(repo, 'reels');
  fs.mkdirSync(path.join(repo, 'docs'));
  fs.writeFileSync(path.join(repo, 'docs', 'XION Reels Agent — 설계 v0.2.md'), 'doc');
  for (const n of ['01', '03', '02']) fs.mkdirSync(path.join(reelsDir, 'episodes', `ep${n}_x_px`), { recursive: true });
  fs.mkdirSync(path.join(reelsDir, 'episodes', 'ep09_manim')); // _px가 아니면 번호에서 빠진다
  fs.mkdirSync(path.join(reelsDir, 'media'), { recursive: true });
  fs.mkdirSync(path.join(reelsDir, 'px'));
  fs.cpSync(REAL_PROMPTS, path.join(reelsDir, 'prompts'), { recursive: true, filter: s => !s.includes('__pycache__') });
  fs.mkdirSync(path.join(reelsDir, '.venv', 'bin'), { recursive: true });
  const py = path.join(reelsDir, '.venv', 'bin', 'python');
  const ok = factcheck.includes(', 0 missing');
  fs.writeFileSync(py, `#!/bin/sh\necho '${factcheck}'\nexit ${ok ? 0 : 1}\n`, { mode: 0o755 });
  return { repo, reelsDir, workDir: path.join(reelsDir, 'work', '2026-10-04-c7') };
}

const MP4 = (reelsDir) => path.join(reelsDir, 'media', 'ep04_px_preview.mp4');

// 단계마다 handler가 파일을 만든다. 실제 claude는 부르지 않는다.
function fakeSpawn(handler, { stdout = JSON.stringify({ result: 'ok', total_cost_usd: 1.5, duration_ms: 10, num_turns: 3 }), code = 0 } = {}) {
  const calls = [];
  const spawn = (bin, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    const call = { bin, args, options, stdin: '' };
    child.stdin = Object.assign(new EventEmitter(), { end: text => { call.stdin = text; } });
    calls.push(call);
    setImmediate(() => {
      handler(call, calls.length);
      child.stdout.emit('data', stdout);
      child.emit('close', code);
    });
    return child;
  };
  spawn.calls = calls;
  return spawn;
}

const FINAL = '# 대본\n- **[A]** 출처, https://e.com/a\n\n## 게시 문구\n훅\n한 줄이에요.\n\n출처:\nA https://e.com/a\n\n#시온의원리노트\n';
const write = (file, text = 'x') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

function happy(f, { must = 2 } = {}) {
  return (_call, n) => {
    if (n === 1) write(path.join(f.workDir, 'draft.md'));
    if (n === 2) write(path.join(f.workDir, 'final.md'), FINAL);
    if (n === 3) {
      write(MP4(f.reelsDir)); write(MP4(f.reelsDir).replace('.mp4', '_cover.png'));
      write(path.join(f.workDir, 'build_report.md'));
    }
    if (n === 4) write(path.join(f.workDir, 'visual_review.md'), `MUST ${must} / NICE 1\n- ...`);
    if (n === 5) write(MP4(f.reelsDir));
  };
}

const run = (f, spawn) => produceEpisode({ card: CARD, reelsDir: f.reelsDir, workDir: f.workDir, bin: '/fake/claude', spawn });
const flag = (args, name) => args[args.indexOf(name) + 1];
const listAfter = (args, name) => {
  const out = [];
  for (let i = args.indexOf(name) + 1; i < args.length && !args[i].startsWith('--'); i += 1) out.push(args[i]);
  return out;
};

test('편 번호는 _px 폴더의 최대값 + 1이고 참고 프레임은 앞 편이다', () => {
  const f = fixture();
  assert.equal(nextEpisode(f.reelsDir).num, 4);
  const p = planPaths({ card: CARD, reelsDir: f.reelsDir, workDir: f.workDir });
  assert.equal(p.episodeDir, 'ep04_c7_px');
  assert.equal(p.outName, 'ep04_px_preview');
  assert.ok(p.referenceFrames.endsWith('media/frames/ep03_px'));
});

test('다섯 단계가 순서대로 돌고 단계마다 같은 안전 인자와 환경 세 개만 간다', async () => {
  const f = fixture();
  const spawn = fakeSpawn(happy(f));
  const record = await run(f, spawn);
  assert.equal(record.outcome, 'ok');
  assert.deepEqual(record.stages.map(s => [s.stage, s.result]), [['script', 'ok'], ['review', 'ok'], ['build', 'ok'], ['visual', 'ok'], ['fix', 'ok']]);
  assert.equal(record.stages[0].total_cost_usd, 1.5);
  assert.deepEqual(spawn.calls.map(c => flag(c.args, '--model')), ['opus', 'opus', 'sonnet', 'opus', 'sonnet']);
  for (const call of spawn.calls) {
    for (const a of ['-p', '--restricted', '--no-session-persistence', '--strict-mcp-config']) assert.ok(call.args.includes(a), a);
    assert.equal(flag(call.args, '--output-format'), 'json');
    assert.equal(flag(call.args, '--permission-mode'), 'dontAsk');
    assert.equal(flag(call.args, '--permission-prompts'), 'none');
    assert.deepEqual(Object.keys(call.options.env).sort(), ['HOME', 'LANG', 'PATH']);
    assert.ok(!/\{\{\w+\}\}/.test(call.stdin));
  }
  assert.ok(fs.existsSync(path.join(f.workDir, 'production.json')));
});

test('단계별 도구: 웹은 대본·검토만, 시각 검토는 읽기와 결과 파일 쓰기만', async () => {
  const f = fixture();
  const spawn = fakeSpawn(happy(f));
  await run(f, spawn);
  const tools = spawn.calls.map(c => flag(c.args, '--tools'));
  assert.equal(tools[0], 'Read,Write,Edit,Glob,Grep,WebSearch,WebFetch,Bash');
  assert.equal(tools[1], tools[0]);
  assert.equal(tools[2], 'Read,Write,Edit,Glob,Grep,Bash');
  assert.equal(tools[3], 'Read,Glob,Grep,Write');
  assert.equal(tools[4], tools[2]);
  const py = path.join(f.reelsDir, '.venv', 'bin', 'python');
  const [script, , build, visual] = spawn.calls.map(c => listAfter(c.args, '--allowedTools'));
  assert.ok(script.includes('WebSearch') && script.includes('WebFetch'));
  assert.ok(script.includes(`Bash(${py} ${f.reelsDir}/factcheck.py:*)`));
  assert.ok(script.includes(`Bash(${py} ${f.reelsDir}/px/secs.py:*)`));
  assert.ok(!script.some(r => r === 'Bash' || r === 'Edit' || r === 'Write'), '맨몸 도구 승인 금지');
  assert.ok(script.includes(`Edit(//${f.workDir.slice(1)}/**)`));
  assert.ok(!build.some(r => /Web/.test(r)));
  assert.ok(build.includes(`Bash(nice -n 19 ${py}:*)`));
  assert.ok(build.includes(`Edit(//${path.join(f.reelsDir, 'episodes', 'ep04_c7_px').slice(1)}/**)`));
  assert.ok(!visual.some(r => /^Bash|Web/.test(r)));
  assert.deepEqual(visual.filter(r => /^(Edit|Write)/.test(r)), [`Edit(//${path.join(f.workDir, 'visual_review.md').slice(1)})`, `Write(//${path.join(f.workDir, 'visual_review.md').slice(1)})`]);
  // 공용 px는 deny
  assert.ok(listAfter(spawn.calls[2].args, '--disallowedTools').includes(`Edit(//${path.join(f.reelsDir, 'px').slice(1)}/**)`));
  // 제작은 reels 디렉터리, 대본·검토·시각은 작업 폴더에서 돈다
  assert.deepEqual(spawn.calls.map(c => c.options.cwd), [f.workDir, f.workDir, f.reelsDir, f.workDir, f.reelsDir]);
});

test('MUST가 0이면 수정 단계를 건너뛴다', async () => {
  const f = fixture();
  const spawn = fakeSpawn(happy(f, { must: 0 }));
  const record = await run(f, spawn);
  assert.equal(record.outcome, 'ok');
  assert.equal(spawn.calls.length, 4);
  assert.equal(record.stages[4].result, 'skipped');
});

test('결과 파일이 없으면 거기서 멈추고 이유를 기록한다', async () => {
  const f = fixture();
  const spawn = fakeSpawn(() => {}); // 아무 파일도 안 만든다
  const record = await run(f, spawn);
  assert.equal(record.outcome, 'failed');
  assert.equal(spawn.calls.length, 1);
  assert.equal(record.stages[0].result, 'failed');
  assert.equal(record.stages[0].code, 'REELS_NO_DRAFT');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.workDir, 'production.json'), 'utf8')).outcome, 'failed');
});

test('factcheck가 0 missing이 아니면 검토 단계에서 멈춘다', async () => {
  const f = fixture({ factcheck: '3 rows, 2 missing' });
  const record = await run(f, fakeSpawn(happy(f)));
  assert.equal(record.stages[1].code, 'REELS_FACTCHECK');
  assert.equal(record.stages.length, 2);
});

test('build는 단계 시작 이전에 있던 mp4를 성공으로 치지 않는다', async () => {
  const f = fixture();
  write(MP4(f.reelsDir)); // 옛 파일
  fs.utimesSync(MP4(f.reelsDir), 1, 1);
  const base = happy(f);
  const record = await run(f, fakeSpawn((c, n) => { if (n !== 3) base(c, n); }));
  assert.equal(record.stages[2].code, 'REELS_NO_MP4');
});

test('시각 검토 첫 줄 형식이 틀리면 멈춘다', async () => {
  const f = fixture();
  const base = happy(f);
  const record = await run(f, fakeSpawn((c, n) => { base(c, n); if (n === 4) write(path.join(f.workDir, 'visual_review.md'), '문제 없음\n'); }));
  assert.equal(record.stages[3].code, 'REELS_VISUAL_FORMAT');
});

test('claude 오류·비정상 종료는 짧은 이유만 남긴다', async () => {
  const f = fixture();
  const err = JSON.stringify({ is_error: true, result: 'Usage limit reached '.repeat(30) });
  const record = await run(f, fakeSpawn(() => {}, { stdout: err }));
  assert.equal(record.stages[0].code, 'REELS_CLAUDE_ERROR');
  assert.ok(record.stages[0].reason.length <= 200);
  const f2 = fixture();
  const rec2 = await run(f2, fakeSpawn(() => {}, { code: 1, stdout: err }));
  assert.equal(rec2.stages[0].code, 'REELS_CLAUDE_EXIT');
});

test('프롬프트 칸이 맞지 않으면 claude를 부르기 전에 실패한다', async () => {
  const f = fixture();
  fs.appendFileSync(path.join(f.reelsDir, 'prompts', 'script.md'), '\n{{unknown_slot}}\n');
  const spawn = fakeSpawn(happy(f));
  const record = await run(f, spawn);
  assert.equal(spawn.calls.length, 0);
  assert.equal(record.stages[0].code, 'REELS_PROMPT_SLOTS');
});

test('실제 프롬프트 다섯 개의 칸이 단계 값과 정확히 맞는다', () => {
  const f = fixture();
  const p = planPaths({ card: CARD, reelsDir: f.reelsDir, workDir: f.workDir });
  const defs = stageDefs({ card: CARD, reelsDir: f.reelsDir, workDir: f.workDir, p });
  const { renderPrompt } = require('../lib/reels/candidates');
  for (const def of Object.values(defs)) {
    const text = renderPrompt(fs.readFileSync(path.join(REAL_PROMPTS, `${def.template}.md`), 'utf8'), def.values);
    assert.ok(text.length > 100);
  }
  assert.ok(claudeArgs(defs.script).includes('--restricted'));
});

test('from: 앞 단계 결과가 남아 있으면 그 단계부터 다시 돌고 옛 기록은 남긴다', async () => {
  const f = fixture();
  write(path.join(f.workDir, 'draft.md')); write(path.join(f.workDir, 'final.md'), FINAL);
  write(path.join(f.workDir, 'production.json'), '{"outcome":"failed"}');
  const build = happy(f);
  const spawn = fakeSpawn((call, n) => build(call, n + 2));          // 첫 호출이 build
  const record = await produceEpisode({ card: CARD, reelsDir: f.reelsDir, workDir: f.workDir, bin: '/fake/claude', spawn, from: 'build' });
  assert.equal(record.outcome, 'ok');
  assert.deepEqual(record.stages.map(s => s.result), ['kept', 'kept', 'ok', 'ok', 'ok']);
  assert.equal(spawn.calls.length, 3);
  assert.equal(flag(spawn.calls[0].args, '--model'), 'sonnet');
  assert.ok(fs.readdirSync(f.workDir).some(n => /^production-\d+\.json$/.test(n)));
});

test('from: 앞 단계 결과가 없으면 claude를 부르지 않고 멈춘다', async () => {
  const f = fixture();
  const spawn = fakeSpawn(() => {});
  const record = await produceEpisode({ card: CARD, reelsDir: f.reelsDir, workDir: f.workDir, bin: '/fake/claude', spawn, from: 'build' });
  assert.equal(record.outcome, 'failed');
  assert.equal(record.stages[0].code, 'REELS_NO_DRAFT');
  assert.equal(spawn.calls.length, 0);
});

test('게시 문구: 검토 단계가 caption.txt를 꺼내고, 절이 없거나 목록 밖 링크가 있으면 멈춘다', async () => {
  const ok = fixture();
  await run(ok, fakeSpawn(happy(ok)));
  assert.equal(fs.readFileSync(path.join(ok.workDir, 'caption.txt'), 'utf8'), '훅\n한 줄이에요.\n\n출처:\nA https://e.com/a\n\n#시온의원리노트\n');

  for (const [final, code] of [['# 대본\n', 'REELS_NO_CAPTION'],
    [FINAL.replace('A https://e.com/a\n\n#', 'B https://evil.example/x\n\n#'), 'REELS_CAPTION_SOURCE']]) {
    const f = fixture();
    const base = happy(f);
    const record = await run(f, fakeSpawn((call, n) => (n === 2 ? write(path.join(f.workDir, 'final.md'), final) : base(call, n))));
    assert.equal(record.outcome, 'failed');
    assert.equal(record.stages[1].code, code);
    assert.equal(fs.existsSync(path.join(f.workDir, 'caption.txt')), false);
  }
});

test('거절된 도구 호출을 단계 기록에 짧게 남긴다', async () => {
  const f = fixture();
  const stdout = JSON.stringify({ result: 'ok', num_turns: 2, permission_denials: [
    { tool_name: 'Bash', tool_input: { command: 'cd /x && python a.py' } },
    { tool_name: 'Write', tool_input: { file_path: '/etc/passwd', content: 'nope' } }] });
  const record = await run(f, fakeSpawn(() => {}, { stdout }));
  assert.deepEqual(record.stages[0].denied, ['Bash: cd /x && python a.py', 'Write: /etc/passwd']);
});
