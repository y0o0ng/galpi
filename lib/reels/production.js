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

function nextEpisode(reelsDir) {
  const nums = fs.readdirSync(path.join(reelsDir, 'episodes'))
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

function planPaths({ card, reelsDir, workDir }) {
  const ep = nextEpisode(reelsDir);
  const repo = path.dirname(reelsDir);
  const episodeDir = `ep${ep.pad(ep.num)}_c${card.id}_px`;
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
function runClaude({ bin, args, cwd, prompt, spawn = nodeSpawn, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd, env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
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
  });
}

function usage(stdout) {
  try {
    const e = JSON.parse(stdout);
    if (e?.is_error) return { isError: true, detail: errorDetail(stdout) };
    const out = {};
    for (const key of ['total_cost_usd', 'duration_ms', 'num_turns']) if (typeof e?.[key] === 'number') out[key] = e[key];
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
const CHECKS = {
  script: async ({ p }) => (exists(p.draft) ? null : ['REELS_NO_DRAFT', 'draft.md가 없습니다.']),
  review: async ({ p, workDir, reelsDir }) => {
    if (!exists(p.final)) return ['REELS_NO_FINAL', 'final.md가 없습니다.'];
    const result = await sh(p.py, [path.join(reelsDir, 'factcheck.py'), p.final], workDir);
    return result.ok && /, 0 missing/.test(result.stdout) ? null : ['REELS_FACTCHECK', 'factcheck가 0 missing이 아닙니다.'];
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

// from: 앞 단계 결과가 작업 폴더에 남아 있으면 그 단계부터 다시 돈다(앞 단계는 성공 조건만 다시 확인).
async function produceEpisode({ card, reelsDir, workDir, bin, spawn, now = () => new Date(), from = 'script' }) {
  fs.mkdirSync(workDir, { recursive: true });
  const p = planPaths({ card, reelsDir, workDir });
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
    const since = Date.now();
    try {
      const def = defs[name];
      const prompt = renderPrompt(fs.readFileSync(path.join(reelsDir, 'prompts', `${def.template}.md`), 'utf8'), def.values);
      const stdout = await runClaude({ bin, args: claudeArgs(def), cwd: def.cwd, prompt, spawn, timeoutMs: TIMEOUT_MS[name] });
      const info = usage(stdout);
      if (info.isError) throw Object.assign(reelsError('claude가 오류를 돌려줬습니다.', 'REELS_CLAUDE_ERROR'), { detail: info.detail });
      const failure = await CHECKS[name]({ p, since, workDir, reelsDir });
      if (failure) {
        done('failed', { code: failure[0], reason: failure[1], ...info });
        record.outcome = 'failed';
        break;
      }
      done('ok', info);
    } catch (error) {
      done('failed', { code: error.code ?? 'REELS_ERROR', reason: String(error.detail ?? error.message).slice(0, 200) });
      record.outcome = 'failed';
      break;
    }
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
  const record = await produceEpisode({ card, reelsDir, workDir, bin: process.env.CLAUDE_BIN || 'claude', from });
  console.log(JSON.stringify(record, null, 2));
  process.exitCode = record.outcome === 'ok' ? 0 : 1;
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exit(1); });

module.exports = { CHECKS, claudeArgs, nextEpisode, planPaths, produceEpisode, stageDefs };
