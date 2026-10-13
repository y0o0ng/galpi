'use strict';
// 3회차: 사실 묶음 → Opus medium이 대본·설계·빌드 → 근거 기계 검사 → Sonnet 사실 범위 검토 → 멈춤.
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const REPO = '/Users/chanyongs21/Desktop/galpi';
const prod = require(`${REPO}/lib/reels/production.js`);
const { renderPrompt } = require(`${REPO}/lib/reels/candidates.js`);

const HERE = __dirname;
const reelsDir = `${REPO}/reels`;
const workDir = `${HERE}/work`;
const trialDir = `${reelsDir}/prompts/motion_trial`;
const card = { id: 27 };
const p = prod.planPaths({ card, reelsDir, workDir, episodeDir: 'ep13_c27m_px' });
const defs = prod.stageDefs({ card, reelsDir, workDir, p });
const grammar = fs.readFileSync(`${trialDir}/grammar.md`, 'utf8').trim();
const facts = `${workDir}/facts.md`;
const claims = `${p.episodeFull}/claims.json`;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const record = [];

function claude(def, prompt, timeoutMs) {
  return new Promise((resolve, reject) => {
    const args = [...prod.claudeArgs(def), ...(def.effort ? ['--effort', def.effort] : [])];
    const child = spawn('claude', args, {
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
  log('▶', name, def.model, def.effort || '(기본)');
  const out = await claude(def, renderPrompt(fs.readFileSync(`${trialDir}/${template}.md`, 'utf8'), values), timeoutMs);
  let info = {};
  try { const e = JSON.parse(out); info = { cost: e.total_cost_usd, turns: e.num_turns, ms: e.duration_ms, isError: e.is_error, result: String(e.result || '').slice(0, 1500) }; } catch {}
  const failure = info.isError ? ['CLAUDE_ERROR', info.result] : await check(since);
  record.push({ stage: name, ...info, failure });
  fs.writeFileSync(`${workDir}/trial${process.env.RUN || 4}.json`, JSON.stringify(record, null, 2));
  log(failure ? '✗' : '✓', name, `$${info.cost?.toFixed?.(2)}`, failure || '');
  if (failure) throw new Error(`${name} 실패: ${failure}`);
}

// 영상의 모든 문장·훅·원리가 claims.json에 그대로 있고, 적힌 행 번호가 사실 묶음에 있는지.
function checkClaims() {
  if (!fs.existsSync(claims)) return 'claims.json 없음';
  const c = JSON.parse(fs.readFileSync(claims, 'utf8'));
  const n = JSON.parse(fs.readFileSync(`${p.episodeFull}/narration.ko.json`, 'utf8'));
  const rows = new Set([...fs.readFileSync(facts, 'utf8').matchAll(/^\| (G?\d+) \|/gm)].map(m => m[1]));
  const bad = [];
  const ids = (where, list) => (list || []).forEach(id => { if (!rows.has(String(id))) bad.push(`${where}: 없는 행 ${id}`); });
  if (c.hook?.title !== n.hook?.title || c.hook?.sub !== n.hook?.sub) bad.push('훅이 narration과 다름');
  ids('hook', c.hook?.facts);
  if (JSON.stringify(c.principle?.lines) !== JSON.stringify(n.principle)) bad.push('원리가 narration과 다름');
  ids('principle', c.principle?.facts);
  const said = Object.entries(n.scenes).flatMap(([scene, ss]) => ss.map(text => `${scene}|${text}`));
  const listed = (c.sentences || []).map(s => `${s.scene}|${s.text}`);
  if (said.join('\n') !== listed.join('\n')) bad.push(`문장 목록이 narration과 다름 (narration ${said.length}, claims ${listed.length})`);
  for (const s of c.sentences || []) {
    if (!['fact', 'analogy', 'link'].includes(s.kind)) bad.push(`종류 없음: ${s.text}`);
    if (s.kind === 'fact' && !(s.facts || []).length) bad.push(`근거 없는 사실 문장: ${s.text}`);
    ids(s.text, s.facts);
  }
  for (const w of c.screen_text || []) ids(w.text, w.facts);
  return bad.length ? bad.slice(0, 6).join(' / ') : null;
}

async function main() {
  const T = 60 * 1000;
  const writer = { ...defs.build, model: process.env.WRITER_MODEL || 'opus', effort: process.env.WRITER_EFFORT };
  await stage('write_build', writer, process.env.TEMPLATE || 'write_build', {
    episode: p.episodeNo, repo: p.repo, grammar, facts_path: facts, episode_dir: p.episodeDir, out_name: p.outName,
    frames_dir: p.framesDir, report_path: p.report,
  }, async since => (await prod.CHECKS.build({ p, since })) || (checkClaims() && ['CLAIMS', checkClaims()]), 100 * T);
  if (process.env.SKIP_FC) { log('끝(사실 검토 생략).', '총 $' + record.reduce((s, r) => s + (r.cost || 0), 0).toFixed(2)); return; }
  fs.copyFileSync(claims, `${workDir}/claims.json`);
  const out = `${workDir}/fact_check.md`;
  const outRule = `//${out.replace(/^\/+/, '')}`;
  const checker = { model: 'sonnet', effort: 'medium', cwd: workDir, tools: 'Read,Glob,Grep,Write', addDirs: [workDir],
    allowed: [`Read(//${workDir.replace(/^\/+/, '')}/**)`, `Edit(${outRule})`, `Write(${outRule})`], denied: [] };
  await stage('fact_check', checker, 'fact_check', { episode: p.episodeNo, facts_path: facts, claims_path: `${workDir}/claims.json`, out_path: out },
    async () => (/^PASS \d+ \/ FAIL \d+/.test(fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '') ? null : '형식 틀림'), 20 * T);
  log('끝.', fs.readFileSync(out, 'utf8').split('\n', 1)[0], '총 $' + record.reduce((s, r) => s + (r.cost || 0), 0).toFixed(2));
}
main().catch(e => { log('중단:', e.message); process.exit(1); });
