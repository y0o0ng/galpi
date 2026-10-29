'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { cardMarkdown, claudeArgs, nextEpisode, produceEpisode, stageDefs, planPaths } = require('../lib/reels/production');

const REAL_PROMPTS = path.join(__dirname, '..', 'reels', 'prompts');
const CARD = { id: 7, title: 't', source_url: 'https://e.com/a', published_at: '2026-10-01', why: 'w', concept: 'c', bridge: 'b', template: '단계', hook_paradox: 'p', hook_term: 'h', hook_subtitle: 's', risk: 'r' };

// 임시 저장소: 앞 편 3편(번호 최대 3), 프롬프트 실물, 가짜 파이썬(factcheck 결과를 파일로 조절).
function fixture({ factcheck = '1 rows, 0 missing', textfit = '3 texts, 0 misfit' } = {}) {
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
  const report = { version: 1, rows: 1, sources: ['https://e.com/a'], fetch_errors: [],
    claims: [{ row: '1', claim: 'test claim', quote: 'a source quotation long enough to check',
      source: '[A]', url: 'https://e.com/a', sources: ['https://e.com/a'], found: ok, status: ok ? 'matched' : 'mismatch' }] };
  const fit = `case "$1" in *textfit.py) echo '${textfit}'; exit ${textfit.includes('넘침') ? 1 : 0};; esac\n`;
  fs.writeFileSync(py, `#!/bin/sh\n${fit}echo '${JSON.stringify(report)}'\nexit ${ok ? 0 : 1}\n`, { mode: 0o755 });
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
    // Linux 파일 시각 해상도보다 느리게 가짜 제작을 끝내 실제 단계 순서를 유지한다.
    setTimeout(() => {
      handler(call, calls.length);
      child.stdout.emit('data', stdout);
      child.emit('close', code);
    }, 20);
    return child;
  };
  spawn.calls = calls;
  return spawn;
}

const FINAL = '# 대본\n- **[A]** 출처, https://e.com/a\n\n## 게시 문구\n훅\n한 줄이에요.\n\n출처:\nA https://e.com/a\n\n#시온의원리노트\n';
const DRAFT = '# 대본\n\n## 4. 사실 확인 목록\n- 1\n';
const write = (file, text = 'x') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

function happy(f, { must = 2 } = {}) {
  return (_call, n) => {
    if (n === 1) write(path.join(f.workDir, 'draft.md'), DRAFT);
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
  assert.deepEqual(spawn.calls.map(c => flag(c.args, '--model')), ['opus', 'sonnet', 'opus', 'sonnet', 'sonnet']);
  assert.deepEqual(spawn.calls.map(c => flag(c.args, '--effort')), ['medium', 'medium', 'medium', 'medium', 'medium']);
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

test('사실 확인 목록 절이 없는(중간에 끊긴) 대본은 대본 단계에서 멈춘다 — 다음 재시도가 대본부터 돌게', async () => {
  const f = fixture();
  const spawn = fakeSpawn(() => write(path.join(f.workDir, 'draft.md'), '# 대본\n\n## 3. 장면\n| `array` |'));
  const record = await run(f, spawn);
  assert.equal(spawn.calls.length, 1);
  assert.equal(record.stages[0].code, 'REELS_DRAFT_INCOMPLETE');
  const kept = await produceEpisode({ card: CARD, reelsDir: f.reelsDir, workDir: f.workDir, bin: '/fake', spawn, from: 'review' });
  assert.equal(kept.stages[0].code, 'REELS_DRAFT_INCOMPLETE');
  assert.equal(spawn.calls.length, 1);
});

test('factcheck가 0 missing이 아니면 검토 단계에서 멈춘다', async () => {
  const f = fixture({ factcheck: '3 rows, 2 missing' });
  const record = await run(f, fakeSpawn(happy(f)));
  assert.equal(record.stages[1].code, 'REELS_FACTCHECK');
  assert.equal(record.stages.length, 2);
});

test('화면 문구가 넘치면 검토에서 멈추고, 재시도 검토에 넘친 문구가 전달된다', async () => {
  const f = fixture({ textfit: '넘침 statement: 아주 긴 진술 (3줄)' });
  const record = await run(f, fakeSpawn(happy(f)));
  assert.deepEqual(record.stages.map(s => [s.stage, s.result]), [['script', 'ok'], ['review', 'failed']]);
  assert.equal(record.stages[1].code, 'REELS_TEXT_FIT');
  assert.match(record.stages[1].reason, /아주 긴 진술/);
  const spawn = fakeSpawn(happy(f));
  await produceEpisode({ card: CARD, reelsDir: f.reelsDir, workDir: f.workDir, bin: '/fake', spawn, from: 'review', previousRecord: record });
  assert.match(spawn.calls[0].stdin, /화면 문구 넘침[\s\S]*아주 긴 진술/);
});

test('대본 재작성에는 DB 실패 근거와 보존한 이전 최종본이 대본·검토 양쪽에 전달된다', async () => {
  const f = fixture();
  write(path.join(f.workDir, 'final.md'), FINAL);
  const old = { stages: [{ stage: 'review', result: 'failed', factcheck: { rewrite: true,
    excludedSources: ['https://blocked.example/source'], fetch_errors: [{ url: 'https://blocked.example/source', reason: 'HTTP 403 forbidden' }],
    mismatches: [{ row: '3', claim: 'remove this claim', quote: 'absent quote' }] } }] };
  const spawn = fakeSpawn(happy(f));
  const record = await produceEpisode({ card: CARD, reelsDir: f.reelsDir, workDir: f.workDir, bin: '/fake', spawn, previousRecord: old });
  assert.equal(record.outcome, 'ok');
  assert.equal(fs.readFileSync(record.retryFeedback.previousFinal, 'utf8'), FINAL);
  for (const call of spawn.calls.slice(0, 2)) {
    assert.match(call.stdin, /https:\/\/blocked.example\/source/);
    assert.match(call.stdin, /remove this claim/);
    assert.match(call.stdin, /HTTP 403 forbidden/);
    assert.match(call.stdin, /인용만 교체하지 말고 대본에서 제외/);
    assert.ok(call.stdin.includes(record.retryFeedback.previousFinal));
  }
  const repeated = await produceEpisode({ card: CARD, reelsDir: f.reelsDir, workDir: f.workDir, bin: '/fake',
    spawn: fakeSpawn(happy(f)), previousRecord: record });
  assert.deepEqual(repeated.retryFeedback.excludedSources, ['https://blocked.example/source']);
});

test('실행 오류 소진은 기존 출처 전체 교체를 명시하며 오래된 초안을 재사용하지 않는다', async () => {
  const f = fixture();
  write(path.join(f.workDir, 'draft.md'), 'old draft');
  fs.utimesSync(path.join(f.workDir, 'draft.md'), 1, 1);
  write(path.join(f.workDir, 'final.md'), FINAL);
  const spawn = fakeSpawn(() => {});
  const record = await produceEpisode({ card: CARD, reelsDir: f.reelsDir, workDir: f.workDir, bin: '/fake', spawn, from: 'review',
    previousRecord: { stages: [{ stage: 'review', result: 'failed', factcheck: {
      rewrite: true, excludeAllSources: true, excludedSources: ['https://e.com/a'], mismatches: [],
    } }] } });
  assert.equal(record.outcome, 'failed');
  assert.equal(record.stages[0].stage, 'script');
  assert.match(record.stages[0].reason, /새로 작성되지/);
  assert.match(spawn.calls[0].stdin, /이전 최종본의 모든 출처를 제외/);
  assert.match(spawn.calls[0].stdin, /"excludeAllSources":true/);
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
  const real = planPaths({ card: CARD, reelsDir: path.dirname(REAL_PROMPTS), workDir: f.workDir });
  for (const k of ['pixelSkill', 'reviewSkill', 'contract']) assert.ok(fs.existsSync(real[k]), k);
});

function renderedPrompts() {
  const f = fixture();
  const p = planPaths({ card: CARD, reelsDir: f.reelsDir, workDir: f.workDir });
  const defs = stageDefs({ card: CARD, reelsDir: f.reelsDir, workDir: f.workDir, p });
  const { renderPrompt } = require('../lib/reels/candidates');
  return Object.fromEntries(Object.entries(defs).map(([name, def]) =>
    [name, renderPrompt(fs.readFileSync(path.join(REAL_PROMPTS, `${def.template}.md`), 'utf8'), def.values)]));
}

test('신규 형식 2: 대본 단계는 전달할 내용·화면 문구·제작 제약 표를 요구하고 문장 글자 수 규칙을 쓰지 않는다', () => {
  const { script, review } = renderedPrompts();
  for (const text of [script, review]) {
    assert.ok(text.includes('장면 | 전달할 내용 | 화면 문구 | 근거 행 | 제작 제약'));
    assert.ok(text.includes('## 게시 문구') || text.includes('사실 확인'));
  }
  assert.ok(!script.includes('secs.py'));                                // 문장별 카드·읽기 시간 검사는 옛 5px 형식
  assert.ok(!/px\/secs\.py "문장"/.test(review));
  assert.ok(script.includes('factcheck.py') && review.includes('factcheck.py') && review.includes('## 게시 문구'));   // 사실 확인·게시 문구는 그대로
  assert.ok(script.includes('시각적 사건 설계·좌표·카메라·시간은 쓰지 않는다'));     // 장면 설계는 대본이 아니라 build 몫
  assert.ok(!script.includes('시각적 사건 |'));
});

test('신규 형식 2: build는 format_version·타임라인·승인 문구 헬퍼·확장색 선언을, visual·fix는 4px 계약을 받는다', () => {
  const { build, visual, fix } = renderedPrompts();
  for (const key of ['format_version', '"duration"', 'T.say', '"palette"', '4×4', '하단 자막 박스', '90초']) assert.ok(build.includes(key), key);
  assert.ok(!build.includes('secs.py'));
  assert.ok(build.includes('reels/px/') && build.includes('읽기 전용'));    // 공용 코드 수정 금지 유지
  assert.ok(build.includes('hook`·`band`·`steps`·`compare`·`kicker`·`chip`·`cardt`는 옛 자막 형식 부품'));
  assert.ok(visual.includes('하단 고정 자막 박스') && visual.includes('MUST') && visual.includes('확장색'));
  assert.ok(fix.includes('palette') && fix.includes('T.say') && fix.includes('90초') && fix.includes('[NICE]'));
  assert.ok(!fix.includes('secs.py'));
});

test('기존 5px 에피소드는 새 형식으로 변환되지 않았다(format_version 표기 없음)', () => {
  const episodes = path.join(__dirname, '..', 'reels', 'episodes');
  // 형식 2 도입 전(2026-10-17)에 있던 편만 본다 — 이후의 새 편은 format_version 2가 정상이다.
  const legacy = ['ep01_harmonic_drive_px', 'ep02_speculative_execution_px', 'ep03_natural_circulation_px', 'ep04_stepped_drum_px', 'ep05_c3_px', 'ep06_c5_px', 'ep07_c7_px', 'ep08_c12_px'];
  const files = legacy.map(n => path.join(episodes, n, 'narration.ko.json')).filter(fs.existsSync);
  assert.ok(files.length > 0);
  for (const file of files) assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).format_version, undefined, file);
});

test('from: 앞 단계 결과가 남아 있으면 그 단계부터 다시 돌고 옛 기록은 남긴다', async () => {
  const f = fixture();
  write(path.join(f.workDir, 'draft.md'), DRAFT); write(path.join(f.workDir, 'final.md'), FINAL);
  write(path.join(f.workDir, 'production.json'), '{"outcome":"failed"}');
  const build = happy(f);
  const spawn = fakeSpawn((call, n) => build(call, n + 2));          // 첫 호출이 build
  const record = await produceEpisode({ card: CARD, reelsDir: f.reelsDir, workDir: f.workDir, bin: '/fake/claude', spawn, from: 'build' });
  assert.equal(record.outcome, 'ok');
  assert.deepEqual(record.stages.map(s => s.result), ['kept', 'kept', 'ok', 'ok', 'ok']);
  assert.equal(spawn.calls.length, 3);
  assert.equal(flag(spawn.calls[0].args, '--model'), 'opus');
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

test('결과 파일 없이 끝난 단계는 멈춘 사유와 마지막 보고 앞부분을 남기고 단계 결과는 failed 그대로다', async () => {
  const f = fixture();
  const stdout = JSON.stringify({ result: '보' + '고'.repeat(400), stop_reason: 'refusal', terminal_reason: 'completed', num_turns: 2 });
  const record = await run(f, fakeSpawn(() => {}, { stdout }));
  assert.equal(record.stages[0].result, 'failed');
  assert.equal(record.stages[0].stop_reason, 'refusal');
  assert.equal(record.stages[0].terminal_reason, 'completed');
  assert.equal(record.stages[0].final_message.length, 300);
});

test('중단 신호가 오면 claude 프로세스 그룹을 끄고 그 단계에서 멈춘다', async () => {
  const f = fixture();
  const killed = [];
  const spawn = (bin, args, options) => {
    assert.equal(options.detached, true);
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = Object.assign(new EventEmitter(), { end: () => {} });
    child.kill = sig => killed.push(sig);                 // pid가 없으면 그룹 대신 자식에게 직접
    spawn.count = (spawn.count || 0) + 1;
    return child;                                          // 스스로는 끝나지 않는다
  };
  const controller = new AbortController();
  const pending = produceEpisode({ card: CARD, reelsDir: f.reelsDir, workDir: f.workDir, bin: '/fake/claude', spawn, signal: controller.signal });
  setImmediate(() => controller.abort());
  const record = await pending;
  assert.equal(record.outcome, 'failed');
  assert.equal(record.stages.length, 1);
  assert.equal(record.stages[0].code, 'REELS_ABORTED');
  assert.equal(spawn.count, 1);
  assert.deepEqual(killed, ['SIGTERM']);
});

// ---- 사람 의견 → 바로 수정 ----

const { reviseEpisode } = require('../lib/reels/production');

async function ready(f) {
  await run(f, fakeSpawn(happy(f)));
  fs.rmSync(path.join(f.workDir, 'visual_review.md'));
}
const revise = (f, spawn, extra = {}) => reviseEpisode({
  card: CARD, reelsDir: f.reelsDir, workDir: f.workDir, episodeDir: 'ep04_c7_px', note: '제목이 작아요', bin: '/fake/claude', spawn, ...extra,
});

test('수정: fix(사람 의견) → visual → MUST가 있으면 fix 한 번 더, 기록은 revision-<n>.json', async () => {
  const f = fixture();
  await ready(f);
  const reviews = [];
  const spawn = fakeSpawn((call, n) => {
    if (n === 1) { reviews.push(fs.readFileSync(path.join(f.workDir, 'human_review_1.md'), 'utf8')); write(MP4(f.reelsDir)); }
    if (n === 2) write(path.join(f.workDir, 'visual_review.md'), 'MUST 1 / NICE 0\n- x');
    if (n === 3) write(MP4(f.reelsDir));
  });
  const record = await revise(f, spawn);
  assert.equal(record.outcome, 'ok');
  assert.deepEqual(record.stages.map(s => [s.stage, s.result]), [['fix', 'ok'], ['visual', 'ok'], ['fix', 'ok']]);
  assert.deepEqual(spawn.calls.map(c => flag(c.args, '--model')), ['sonnet', 'sonnet', 'sonnet']);
  assert.equal(reviews[0], 'MUST 1 / NICE 0\n- [MUST] 사람 검토 의견: 제목이 작아요\n');
  assert.ok(spawn.calls[0].stdin.includes(path.join(f.workDir, 'human_review_1.md')));
  assert.ok(spawn.calls[2].stdin.includes(path.join(f.workDir, 'visual_review.md')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.workDir, 'revision-1.json'), 'utf8')).outcome, 'ok');
  assert.ok(fs.existsSync(path.join(f.workDir, 'production.json')));
  await revise(f, fakeSpawn((call, n) => { if (n === 1) write(MP4(f.reelsDir)); if (n === 2) write(path.join(f.workDir, 'visual_review.md'), 'MUST 0 / NICE 0\n'); }));
  assert.ok(fs.existsSync(path.join(f.workDir, 'human_review_2.md'))); // 번호는 앞 기록 다음
});

test('수정: 시각 검토 MUST가 0이면 두 번째 fix가 없다', async () => {
  const f = fixture();
  await ready(f);
  const spawn = fakeSpawn((call, n) => {
    if (n === 1) write(MP4(f.reelsDir));
    if (n === 2) write(path.join(f.workDir, 'visual_review.md'), 'MUST 0 / NICE 2\n');
  });
  const record = await revise(f, spawn);
  assert.equal(record.outcome, 'ok');
  assert.equal(spawn.calls.length, 2);
});

test('수정: 첫 fix가 mp4를 못 만들면 거기서 실패하고 시각 검토를 돌리지 않는다', async () => {
  const f = fixture();
  await ready(f);
  const spawn = fakeSpawn(() => {});
  const record = await revise(f, spawn);
  assert.equal(record.outcome, 'failed');
  assert.equal(record.stages[0].code, 'REELS_NO_MP4');
  assert.equal(spawn.calls.length, 1);
});

test('cardMarkdown: 일상의 문은 값이 있을 때만 줄이 생기고 기존 행(빈 값)은 깨지지 않는다', () => {
  const old = cardMarkdown({ ...CARD, everyday_door: '' });
  assert.ok(!old.includes('일상의 문'));
  assert.ok(cardMarkdown({ ...CARD, everyday_door: '앱이 버벅여요' }).includes('- 일상의 문: 앱이 버벅여요'));
  assert.ok(cardMarkdown(CARD).includes('- 제목: t'));
});
