'use strict';
// 움직임 문법 시험 실행기(스크래치 전용). 운영 production.js의 단계 정의·권한·성공 조건을 그대로 쓰고
// 프롬프트만 reels/prompts/motion_trial/로 바꾼다. 순서: redesign → build → (띠) → visual → fix → (띠) → visual 2.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const REPO = '/Users/chanyongs21/Desktop/galpi';
const prod = require(`${REPO}/lib/reels/production.js`);
const { renderPrompt } = require(`${REPO}/lib/reels/candidates.js`);

const HERE = __dirname;
const reelsDir = `${REPO}/reels`;
const workDir = `${HERE}/work`;
const refDir = `${HERE}/reference`;
const trialDir = `${reelsDir}/prompts/motion_trial`;
const FF = `${reelsDir}/.venv/lib/python3.12/site-packages/imageio_ffmpeg/binaries/ffmpeg-macos-x86_64-v7.1`;
const card = { id: 27 };
const episodeDir = 'ep13_c27m_px';
const grammar = fs.readFileSync(`${trialDir}/grammar.md`, 'utf8').trim();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const p = prod.planPaths({ card, reelsDir, workDir, episodeDir });
p.referenceFrames = refDir;
const defs = prod.stageDefs({ card, reelsDir, workDir, p });
const record = [];
const save = () => fs.writeFileSync(`${workDir}/trial.json`, JSON.stringify(record, null, 2));

function claude(def, prompt, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', [...prod.claudeArgs(def), ...(def.effort ? ['--effort', def.effort] : [])], {
      cwd: def.cwd, stdio: ['pipe', 'pipe', 'ignore'], detached: true,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG, USER: process.env.USER },
    });
    let out = '';
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} reject(new Error('timeout')); }, timeoutMs);
    child.stdout.on('data', c => { out += c; });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`exit ${code}: ${out.slice(-400)}`)); });
    child.stdin.end(prompt);
  });
}

async function stage(name, def, template, values, check, timeoutMs) {
  const since = Date.now();
  log('▶', name);
  const prompt = renderPrompt(fs.readFileSync(`${trialDir}/${template}.md`, 'utf8'), values);
  const out = await claude(def, prompt, timeoutMs);
  let info = {};
  try { const e = JSON.parse(out); info = { cost: e.total_cost_usd, turns: e.num_turns, ms: e.duration_ms, isError: e.is_error,
    denied: (e.permission_denials || []).slice(0, 5).map(d => `${d.tool_name}: ${d.tool_input?.command ?? d.tool_input?.file_path ?? ''}`.slice(0, 160)),
    result: String(e.result || '').slice(0, 1500) }; } catch {}
  const failure = info.isError ? ['CLAUDE_ERROR', info.result] : await check(since);
  record.push({ stage: name, ...info, failure });
  save();
  log(failure ? '✗' : '✓', name, `$${info.cost?.toFixed?.(2)}`, failure || '');
  if (failure) throw new Error(`${name} 실패: ${failure}`);
}

// 바꾸면 안 되는 절이 원본과 같은지, 내레이션·화면 글자가 그대로인지 기계로 확인한다.
function sections(text) {
  const out = {};
  const parts = text.split(/^(?=## )/m);
  for (const part of parts) { const h = part.split('\n', 1)[0].trim(); out[h] = part.trimEnd(); }
  return out;
}
// 3절 표의 마지막 칸(내레이션)만 본다. 실측 줄의 "S1 5.20" 같은 것은 표 밖이라 빠진다.
const narration = text => text.split('\n').filter(l => /^\|/.test(l) && !/^\|\s*-/.test(l))
  .map(l => l.replace(/\|\s*$/, '').split('|').pop().trim())
  .flatMap(cell => [...cell.matchAll(/S(\d+) (.+?)(?= S\d+ |$)/g)].map(m => `S${m[1]} ${m[2].trim()}`));
const screenWords = text => {
  const m = text.match(/### 화면 글자 목록\n+([\s\S]*?)(?=\n### |\n## )/);
  return m ? [...m[1].matchAll(/`([^`]+)`/g)].map(x => x[1]) : null;
};
function checkRedesign() {
  if (!fs.existsSync(p.final)) return 'final.md 없음';
  const a = fs.readFileSync(`${workDir}/final-original.md`, 'utf8');
  const b = fs.readFileSync(p.final, 'utf8');
  const sa = sections(a), sb = sections(b);
  for (const h of Object.keys(sa)) {
    if (/^## [0124]\. |^## 게시 문구/.test(h) && sa[h] !== sb[h]) return `절이 바뀜: ${h}`;
  }
  const na = narration(sa[Object.keys(sa).find(h => h.startsWith('## 3.'))]);
  const nb = narration(sb[Object.keys(sb).find(h => h.startsWith('## 3.'))] || '');
  if (na.join('\n') !== nb.join('\n')) return `내레이션이 바뀜 (원본 ${na.length}문장, 새 ${nb.length}문장)`;
  const wa = new Set(screenWords(a)); const wb = screenWords(b);
  if (!wb) return '화면 글자 목록 없음';
  const extra = wb.filter(w => !wa.has(w));
  return extra.length ? `새 화면 글자: ${extra.join(', ')}` : null;
}

// mp4에서 움직임 띠(0.25초 × 8칸 = 2초씩)와 멈춤 측정을 만든다.
function motion(tag) {
  const dir = path.join(p.framesDir, 'motion');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  execFileSync(FF, ['-v', 'error', '-i', p.mp4, '-vf', 'fps=4,scale=216:384:flags=neighbor,tile=8x1', `${dir}/strip_%03d.png`]);
  for (const f of fs.readdirSync(dir).filter(f => f.startsWith('strip_'))) {
    const n = Number(f.slice(6, 9));
    fs.renameSync(`${dir}/${f}`, `${dir}/strip_${String(n).padStart(3, '0')}_${(n - 1) * 2}s.png`);
  }
  // 12fps, 그림 영역(장면 y 0~250 → 출력 y 200~1450)만, 완전히 같은 프레임이 이어진 구간을 잰다.
  const W = 108, H = 125;
  const raw = execFileSync(FF, ['-v', 'error', '-i', p.mp4, '-vf', `fps=12,crop=1080:1250:0:200,scale=${W}:${H}:flags=neighbor,format=gray`,
    '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 });
  const n = raw.length / (W * H);
  const runs = []; let start = null;
  for (let i = 1; i < n; i++) {
    const same = raw.subarray(i * W * H, (i + 1) * W * H).equals(raw.subarray((i - 1) * W * H, i * W * H));
    if (same && start === null) start = i - 1;
    if ((!same || i === n - 1) && start !== null) { const len = (i - start) / 12; if (len > 1) runs.push([start / 12, len]); start = null; }
  }
  const total = n / 12;
  const lines = [`# 멈춤 측정 (${tag})`, '', `길이 ${total.toFixed(1)}초. 그림 영역이 1초 넘게 완전히 같은 구간(엔딩 도장 4.2초 포함):`, '',
    ...(runs.length ? runs.map(([s, l]) => `- ${s.toFixed(2)}초부터 ${l.toFixed(2)}초`) : ['- 없음'])];
  fs.writeFileSync(`${dir}/stillness.md`, `${lines.join('\n')}\n`);
  fs.copyFileSync(`${workDir}/original_review.md`, `${dir}/original_review.md`);
  log('motion', tag, runs.length ? runs.map(([s, l]) => `${s.toFixed(1)}+${l.toFixed(1)}`).join(' ') : '멈춤 없음');
}
const must = () => Number(/^MUST (\d+)/.exec(fs.readFileSync(p.visual, 'utf8'))?.[1] ?? NaN);

async function main() {
  const only = process.argv[2]; // 이어 돌리기: build | visual
  const order = ['redesign', 'build', 'visual', 'fix', 'visual2'];
  const from = only ? order.indexOf(only) : 0;
  const T = 60 * 1000;
  if (from <= 0) {
    const redesignDef = { ...defs.script, addDirs: [...defs.script.addDirs, refDir] };
    await stage('redesign', redesignDef, 'redesign', {
      episode: p.episodeNo, grammar, repo: p.repo, out_path: p.final,
      original_final: `${workDir}/final-original.md`, original_review: `${workDir}/original_review.md`, reference_dir: refDir,
    }, async () => checkRedesign(), 40 * T);
  }
  if (from <= 1) await stage('build', { ...defs.build, effort: process.env.BUILD_EFFORT, model: process.env.BUILD_MODEL || defs.build.model }, 'build_px', { ...defs.build.values, grammar }, s => prod.CHECKS.build({ p, since: s }), 90 * T);
  if (from <= 2) {
    motion('build');
    fs.rmSync(p.visual, { force: true });
    await stage('visual', defs.visual, 'review_visual', { ...defs.visual.values, grammar }, async () => prod.CHECKS.visual({ p }), 25 * T);
  }
  if (must() > 0) {
    fs.copyFileSync(p.visual, `${workDir}/visual_review_1.md`);
    await stage('fix', defs.fix, 'fix_px', { ...defs.fix.values, grammar }, s => prod.CHECKS.fix({ p, since: s }), 45 * T);
    motion('fix');
    fs.rmSync(p.visual, { force: true });
    await stage('visual2', defs.visual, 'review_visual', { ...defs.visual.values, grammar }, async () => prod.CHECKS.visual({ p }), 25 * T);
  }
  log('끝. MUST', must(), '총 비용 $' + record.reduce((s, r) => s + (r.cost || 0), 0).toFixed(2));
}
main().catch(e => { log('중단:', e.message); process.exit(1); });
