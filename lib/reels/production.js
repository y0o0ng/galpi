'use strict';

// 선택된 후보 한 편을 처음부터 끝까지 만든다(설계 v0.2 7장 "2단계 실행"). 2a는 수동 실행만 — 스케줄·DB 기록·화면은 2b.
//
// **단계마다 `claude -p`를 새로 부르고, 결과 파일이 실제로 있는지 코드가 확인한다.** 실패하면 거기서 멈추고 이유를 남긴다.
// 도구 권한이 이 파일의 안전장치다: `--restricted` 위에 단계별 `--tools`(켤 수 있는 도구)와 `--allowedTools`(그중 승인할 것)를
// 얹고, `dontAsk`라 승인 목록에 없는 건 전부 거절된다. 뉴스 원문이 셸 쓰는 에이전트에 닿지 않는다(1장 원칙).

const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn: nodeSpawn } = require('node:child_process');
const { errorDetail, renderPrompt } = require('./candidates');

const MIN = 60 * 1000;
const TIMEOUT_MS = { script: 40 * MIN, review: 40 * MIN, build: 90 * MIN, visual: 20 * MIN, fix: 45 * MIN };
const DOC_NAME = 'XION Reels Agent — 설계 v0.2.md';

function reelsError(message, code) {
  return Object.assign(new Error(message), { code });
}

const abs = p => `//${path.resolve(p).replace(/^\/+/, '')}`; // 권한 규칙의 절대 경로 접두는 `//`
const rules = (tool, paths) => paths.map(p => `${tool}(${abs(p)})`);
const writeRules = paths => [...rules('Edit', paths), ...rules('Write', paths)];
const subtree = dir => `${dir}/**`;

// skipDir: 이 편 자신의 폴더(재시도 때 이미 만들어져 있다)는 "앞 편"에서 뺀다.
function nextEpisode(reelsDir, skipDir) {
  const nums = fs.readdirSync(path.join(reelsDir, 'episodes')).filter(name => name !== skipDir)
    .map(name => /^ep(\d+)_.*_px$/.exec(name)).filter(Boolean).map(m => Number(m[1]));
  if (!nums.length) throw reelsError('앞 편 도트판이 없습니다.', 'REELS_NO_EPISODES');
  const prev = Math.max(...nums);
  const pad = n => String(n).padStart(2, '0');
  return { num: prev + 1, pad, prevPad: pad(prev) };
}

function cardMarkdown(card) {
  const field = (label, value) => `- ${label}: ${value ?? ''}`;
  return [
    field('제목', card.title), field('원문 URL', card.source_url), field('발행', card.published_at),
    field('이유', card.why), field('개념', card.concept), field('연결', card.bridge),
    field('템플릿', card.template), field('훅 역설', card.hook_paradox), field('훅 용어', card.hook_term),
    field('훅 부제', card.hook_subtitle), field('위험·불확실', card.risk),
  ].join('\n');
}

// episodeDir를 주면(DB에 기록된 편) 번호를 다시 세지 않고 그 폴더 이름을 그대로 쓴다 — 재시도에서 번호가 밀리지 않게.
function planPaths({ card, reelsDir, workDir, episodeDir: fixedDir }) {
  const ep = nextEpisode(reelsDir, fixedDir);
  if (fixedDir) ep.num = Number(/^ep(\d+)_/.exec(fixedDir)[1]);
  const repo = path.dirname(reelsDir);
  const episodeDir = fixedDir || `ep${ep.pad(ep.num)}_c${card.id}_px`;
  const outName = `ep${ep.pad(ep.num)}_px_preview`;
  const media = path.join(reelsDir, 'media');
  return {
    repo, episodeNo: String(ep.num), episodeDir, outName,
    py: path.join(reelsDir, '.venv', 'bin', 'python'),
    episodeFull: path.join(reelsDir, 'episodes', episodeDir),
    mp4: path.join(media, `${outName}.mp4`),
    cover: path.join(media, `${outName}_cover.png`),
    framesDir: path.join(media, 'frames', `ep${ep.pad(ep.num)}_px`),
    referenceFrames: path.join(media, 'frames', `ep${ep.prevPad}_px`),
    doc: path.join(workDir, 'design.md'),
    srcDir: path.join(workDir, 'src'),
    draft: path.join(workDir, 'draft.md'),
    final: path.join(workDir, 'final.md'),
    caption: path.join(workDir, 'caption.txt'),
    report: path.join(workDir, 'build_report.md'),
    visual: path.join(workDir, 'visual_review.md'),
    handoff: path.join(reelsDir, 'px', 'reels-pixel-handoff.md'),
  };
}

// 단계 정의. args = 단계별 도구 권한(공통 인자는 claudeArgs가 붙인다).
function stageDefs({ card, reelsDir, workDir, p }) {
  const py = p.py;
  const webTools = 'Read,Write,Edit,Glob,Grep,WebSearch,WebFetch,Bash';
  const readOnlyDirs = [path.join(reelsDir, 'px'), path.join(reelsDir, 'episodes')];
  const writerBash = [`Bash(${py} ${reelsDir}/factcheck.py:*)`, `Bash(${py} ${reelsDir}/px/secs.py:*)`];
  const researchPerms = {
    model: 'opus', cwd: workDir, addDirs: readOnlyDirs, tools: webTools,
    allowed: ['WebSearch', 'WebFetch', ...writerBash, ...writeRules([subtree(workDir)])],
    denied: [],
  };
  const buildBash = [`Bash(${py}:*)`, `Bash(nice -n 19 ${py}:*)`];
  const builderPerms = {
    model: 'sonnet', cwd: reelsDir, addDirs: [workDir], tools: 'Read,Write,Edit,Glob,Grep,Bash',
    allowed: [
      ...buildBash,
      ...writeRules([subtree(p.episodeFull), `${p.mp4}`, `${p.cover}`, subtree(p.framesDir), p.report]),
    ],
    denied: writeRules([subtree(path.join(reelsDir, 'px'))]), // 공용 코드는 읽기 전용(deny가 allow보다 앞선다)
  };
  return {
    script: {
      ...researchPerms, template: 'script',
      values: {
        episode: p.episodeNo, doc_path: p.doc, repo: p.repo, candidate_card: cardMarkdown(card),
        src_dir: p.srcDir, out_path: p.draft,
      },
    },
    review: {
      ...researchPerms, template: 'review',
      values: { episode: p.episodeNo, draft_path: p.draft, src_dir: p.srcDir, doc_path: p.doc, repo: p.repo, out_path: p.final },
    },
    build: {
      ...builderPerms, template: 'build_px',
      values: {
        episode: p.episodeNo, repo: p.repo, final_path: p.final, episode_dir: p.episodeDir, out_name: p.outName,
        frames_dir: p.framesDir, report_path: p.report,
      },
    },
    visual: {
      model: 'opus', cwd: workDir, tools: 'Read,Glob,Grep,Write', template: 'review_visual',
      addDirs: [p.framesDir, p.referenceFrames, p.episodeFull, path.join(reelsDir, 'px')],
      allowed: [
        ...rules('Read', [p.framesDir, p.referenceFrames, p.episodeFull, path.join(reelsDir, 'px')].map(subtree)),
        ...writeRules([p.visual]),
      ],
      denied: [],
      values: {
        episode: p.episodeNo, frames_dir: p.framesDir, build_report: p.report, final_path: p.final,
        episode_path: p.episodeFull, handoff_path: p.handoff, reference_frames: p.referenceFrames, out_path: p.visual,
      },
    },
    fix: {
      ...builderPerms, template: 'fix_px',
      values: {
        episode: p.episodeNo, repo: p.repo, episode_dir: p.episodeDir, review_path: p.visual, report_path: p.report,
        out_name: p.outName, frames_dir: p.framesDir,
      },
    },
  };
}

function claudeArgs(stage) {
  const args = [
    '-p', '--model', stage.model, '--restricted', '--output-format', 'json', '--no-session-persistence',
    '--strict-mcp-config', '--permission-mode', 'dontAsk', '--permission-prompts', 'none',
    '--tools', stage.tools,
  ];
  if (stage.addDirs?.length) args.push('--add-dir', ...stage.addDirs);
  args.push('--allowedTools', ...stage.allowed);
  if (stage.denied?.length) args.push('--disallowedTools', ...stage.denied);
  return args;
}

// candidates.js의 runClaude와 같은 원칙: 환경 세 개만, stderr 폐기. 다만 cwd가 고정이라 따로 둔다.
// claude는 렌더용 파이썬 같은 자식을 또 띄운다. 새 프로세스 그룹으로 띄워 시간 초과·중단 때 그룹째 끈다 —
// 2026-10-03 러너만 멈추고 claude가 혼자 살아남았다.
function runClaude({ bin, args, cwd, prompt, spawn = nodeSpawn, timeoutMs, signal }) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd, env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG }, stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    const killTree = sig => {
      try { process.kill(-child.pid, sig); } catch { child.kill(sig); }
    };
    const onAbort = () => {
      killTree('SIGTERM');
      setTimeout(() => killTree('SIGKILL'), 5000).unref?.();
      finish(reject, reelsError('제작이 중단됐습니다.', 'REELS_ABORTED'));
    };
    let stdout = '';
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn(value);
    };
    const timer = setTimeout(() => {
      killTree('SIGKILL');
      finish(reject, reelsError('claude 호출 시간이 초과됐습니다.', 'REELS_CLAUDE_TIMEOUT'));
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', () => {});
    child.on('error', () => finish(reject, reelsError('claude를 실행하지 못했습니다.', 'REELS_CLAUDE_SPAWN')));
    child.on('close', code => {
      if (code !== 0) finish(reject, Object.assign(reelsError(`claude가 ${code}로 끝났습니다.`, 'REELS_CLAUDE_EXIT'), { detail: errorDetail(stdout) }));
      else finish(resolve, stdout);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function usage(stdout) {
  try {
    const e = JSON.parse(stdout);
    if (e?.is_error) return { isError: true, detail: errorDetail(stdout) };
    const out = {};
    for (const key of ['total_cost_usd', 'duration_ms', 'num_turns']) if (typeof e?.[key] === 'number') out[key] = e[key];
    // 거절된 도구 호출은 실패 원인을 보려고 짧게 남긴다(명령·경로만, 최대 5개).
    const denied = (Array.isArray(e?.permission_denials) ? e.permission_denials : []).slice(0, 5)
      .map(d => `${d.tool_name}: ${d.tool_input?.command ?? d.tool_input?.file_path ?? ''}`.slice(0, 160));
    if (denied.length) out.denied = denied;
    return out;
  } catch {
    return {};
  }
}

const sh = (file, args, cwd) => new Promise(resolve => {
  execFile(file, args, { cwd, timeout: 5 * MIN, env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG } },
    (error, stdout) => resolve({ ok: !error, stdout: String(stdout) }));
});

const exists = file => fs.existsSync(file) && fs.statSync(file).size > 0;
const fresh = (file, since) => exists(file) && fs.statSync(file).mtimeMs >= since;

// 단계 성공 조건. 통과하면 null, 아니면 [코드, 짧은 이유].
// final.md의 `## 게시 문구` 절을 caption.txt로 꺼낸다. 캡션의 링크는 전부 대본의 나머지(사실 확인 목록)에 있어야 한다 —
// factcheck를 통과한 출처만 게시물에 실리게.
function writeCaption(p) {
  const text = fs.readFileSync(p.final, 'utf8');
  const m = text.match(/^## 게시 문구[ \t]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  const caption = m?.[1].trim();
  if (!caption) return ['REELS_NO_CAPTION', 'final.md에 "## 게시 문구" 절이 없습니다.'];
  const rest = text.replace(m[0], '');
  const stray = (caption.match(/https?:\/\/[^\s)>\]]+/g) || []).map(u => u.replace(/[.,;:]+$/, '')).filter(u => !rest.includes(u));
  if (stray.length) return ['REELS_CAPTION_SOURCE', `사실 확인 목록에 없는 링크: ${stray[0]}`.slice(0, 200)];
  fs.writeFileSync(p.caption, `${caption}\n`);
  return null;
}

const CHECKS = {
  script: async ({ p }) => (exists(p.draft) ? null : ['REELS_NO_DRAFT', 'draft.md가 없습니다.']),
  review: async ({ p, workDir, reelsDir }) => {
    if (!exists(p.final)) return ['REELS_NO_FINAL', 'final.md가 없습니다.'];
    const result = await sh(p.py, [path.join(reelsDir, 'factcheck.py'), p.final], workDir);
    if (!(result.ok && /, 0 missing/.test(result.stdout))) return ['REELS_FACTCHECK', 'factcheck가 0 missing이 아닙니다.'];
    return writeCaption(p);
  },
  build: async ({ p, since }) => {
    if (!fresh(p.mp4, since)) return ['REELS_NO_MP4', 'mp4가 새로 생성되지 않았습니다.'];
    if (!fresh(p.cover, since)) return ['REELS_NO_COVER', '표지 png가 새로 생성되지 않았습니다.'];
    return exists(p.report) ? null : ['REELS_NO_REPORT', '제작 보고서가 없습니다.'];
  },
  visual: async ({ p }) => {
    if (!exists(p.visual)) return ['REELS_NO_VISUAL', '시각 검토 파일이 없습니다.'];
    return mustCount(p.visual) === null ? ['REELS_VISUAL_FORMAT', '첫 줄이 "MUST n / NICE m"이 아닙니다.'] : null;
  },
  fix: async ({ p, since }) => (fresh(p.mp4, since) ? null : ['REELS_NO_MP4', '수정 뒤 mp4가 다시 생성되지 않았습니다.']),
};

function mustCount(file) {
  const match = /^MUST (\d+) \/ NICE (\d+)/.exec(fs.readFileSync(file, 'utf8').split('\n', 1)[0].trim());
  return match ? Number(match[1]) : null;
}

// 단계 하나: claude 호출 → 성공 조건 확인. 던지지 않고 { ok, extra }로 돌려준다.
async function execStage({ def, name, p, workDir, reelsDir, bin, spawn, signal }) {
  const since = Date.now();
  try {
    const prompt = renderPrompt(fs.readFileSync(path.join(reelsDir, 'prompts', `${def.template}.md`), 'utf8'), def.values);
    const stdout = await runClaude({ bin, args: claudeArgs(def), cwd: def.cwd, prompt, spawn, timeoutMs: TIMEOUT_MS[name], signal });
    const info = usage(stdout);
    if (info.isError) throw Object.assign(reelsError('claude가 오류를 돌려줬습니다.', 'REELS_CLAUDE_ERROR'), { detail: info.detail });
    const failure = await CHECKS[name]({ p, since, workDir, reelsDir });
    return failure ? { ok: false, extra: { code: failure[0], reason: failure[1], ...info } } : { ok: true, extra: info };
  } catch (error) {
    return { ok: false, extra: { code: error.code ?? 'REELS_ERROR', reason: String(error.detail ?? error.message).slice(0, 200) } };
  }
}

// from: 앞 단계 결과가 작업 폴더에 남아 있으면 그 단계부터 다시 돈다(앞 단계는 성공 조건만 다시 확인).
async function produceEpisode({ card, reelsDir, workDir, episodeDir, bin, spawn, now = () => new Date(), from = 'script', signal }) {
  fs.mkdirSync(workDir, { recursive: true });
  const p = planPaths({ card, reelsDir, workDir, episodeDir });
  fs.mkdirSync(p.srcDir, { recursive: true });
  // 설계 문서는 reels 밖이라 작업 폴더에 복사해 읽기 범위를 작업 폴더로 가둔다.
  fs.copyFileSync(path.join(p.repo, 'docs', DOC_NAME), p.doc);
  const defs = stageDefs({ card, reelsDir, workDir, p });
  const record = { candidateId: card.id, episodeDir: p.episodeDir, startedAt: now().toISOString(), stages: [], outcome: 'running' };
  const recordPath = path.join(workDir, 'production.json');
  if (fs.existsSync(recordPath)) fs.renameSync(recordPath, path.join(workDir, `production-${Date.now()}.json`));
  const save = () => fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  const order = ['script', 'review', 'build', 'visual', 'fix'];
  if (!order.includes(from)) throw new Error(`알 수 없는 단계: ${from}`);

  for (const name of order) {
    const entry = { stage: name, startedAt: now().toISOString() };
    record.stages.push(entry);
    const done = (result, extra = {}) => {
      Object.assign(entry, { result, endedAt: now().toISOString() }, extra);
      save();
    };
    if (order.indexOf(name) < order.indexOf(from)) {
      const failure = await CHECKS[name]({ p, since: 0, workDir, reelsDir });
      if (failure) { done('failed', { code: failure[0], reason: failure[1] }); record.outcome = 'failed'; break; }
      done('kept');
      continue;
    }
    if (name === 'fix' && mustCount(p.visual) === 0) { done('skipped'); continue; }
    const result = await execStage({ def: defs[name], name, p, workDir, reelsDir, bin, spawn, signal });
    done(result.ok ? 'ok' : 'failed', result.extra);
    if (!result.ok) { record.outcome = 'failed'; break; }
  }
  if (record.outcome === 'running') record.outcome = 'ok';
  record.endedAt = now().toISOString();
  save();
  return record;
}

// 검토 2의 사람 의견 → 바로 수정(설계 v0.2 4장). 의견을 [MUST] 한 줄로 fix에 넘기고 → 시각 검토를 다시 → MUST가 남으면 fix 한 번 더.
// 단계 정의·권한·성공 조건은 제작과 같은 것을 쓴다(fix의 review_path만 다르다). 결과는 production.json과 따로 revision-<n>.json이다.
async function reviseEpisode({ card, reelsDir, workDir, episodeDir, note, n, bin, spawn, now = () => new Date(), signal }) {
  const p = planPaths({ card, reelsDir, workDir, episodeDir });
  const num = n ?? fs.readdirSync(workDir).filter(name => /^revision-\d+\.json$/.test(name)).length + 1;
  const humanReview = path.join(workDir, `human_review_${num}.md`);
  fs.writeFileSync(humanReview, `MUST 1 / NICE 0\n- [MUST] 사람 검토 의견: ${note}\n`);
  const defs = stageDefs({ card, reelsDir, workDir, p });
  const fixWith = reviewPath => ({ ...defs.fix, values: { ...defs.fix.values, review_path: reviewPath } });
  const record = { n: num, note, startedAt: now().toISOString(), stages: [], outcome: 'running' };
  const save = () => fs.writeFileSync(path.join(workDir, `revision-${num}.json`), `${JSON.stringify(record, null, 2)}\n`);
  const step = async (name, def) => {
    const entry = { stage: name, startedAt: now().toISOString() };
    record.stages.push(entry);
    const result = await execStage({ def, name, p, workDir, reelsDir, bin, spawn, signal });
    Object.assign(entry, { result: result.ok ? 'ok' : 'failed', endedAt: now().toISOString() }, result.extra);
    save();
    return result.ok;
  };
  const failed = () => { record.outcome = 'failed'; };
  if (!await step('fix', fixWith(humanReview))) failed();
  else {
    fs.rmSync(p.visual, { force: true }); // 앞 시각 검토가 남아 있으면 새 검토를 못 가려낸다
    if (!await step('visual', defs.visual)) failed();
    else if (mustCount(p.visual) > 0 && !await step('fix', fixWith(p.visual))) failed();
  }
  if (record.outcome === 'running') record.outcome = 'ok';
  record.endedAt = now().toISOString();
  save();
  return record;
}

function parseArgs(argv) {
  const get = flag => argv[argv.indexOf(flag) + 1];
  const opt = flag => (argv.includes(flag) ? get(flag) : undefined);
  return { db: get('--db'), candidate: Number(get('--candidate')), from: opt('--from'), work: opt('--work') };
}

async function main() {
  const { db: dbPath, candidate, from, work } = parseArgs(process.argv.slice(2));
  if (!dbPath || !candidate) throw new Error('usage: node lib/reels/production.js --db <galpi.db> --candidate <id> [--from <단계>] [--work <작업 폴더>]');
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });
  const card = db.prepare('SELECT * FROM reels_candidates WHERE id = ?').get(candidate);
  db.close();
  if (!card) throw new Error(`후보 ${candidate}이 없습니다.`);
  const reelsDir = path.join(__dirname, '..', '..', 'reels');
  const day = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const workDir = work ? path.resolve(work) : path.join(reelsDir, 'work', `${day}-c${card.id}`);
  const controller = new AbortController();
  for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => controller.abort());
  const record = await produceEpisode({ card, reelsDir, workDir, bin: process.env.CLAUDE_BIN || 'claude', from, signal: controller.signal });
  console.log(JSON.stringify(record, null, 2));
  process.exitCode = record.outcome === 'ok' ? 0 : 1;
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exit(1); });

module.exports = { CHECKS, claudeArgs, nextEpisode, planPaths, produceEpisode, reviseEpisode, stageDefs };
