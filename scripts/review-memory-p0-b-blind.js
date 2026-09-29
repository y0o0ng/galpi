#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_MANIFEST = path.join(ROOT, 'fixtures/memory-r3-p0b-generation-freeze.json');
const JOURNAL = 'galpi-p0b-human-adjudication-journal.jsonl';
const FINAL = 'galpi-p0b-human-adjudication.json';
const PROTOCOL = 'xion-r3-p0b-primary-blind-human-v1';
const EXPECTED_PACKET_SHA256 = '092a91d11c9ee2d8c235ed59051d60fbfc9a4b9d1a7797f91c5b08cef6d4c707';
const EXPECTED_MANIFEST_SHA256 = '885481e55e0ece3beccdbaa104d237b088af0be17f2bbcd3507de2c82ec1d192';
const PAIRS = ['X1_Y1', 'X1_Y2', 'X2_Y1', 'X2_Y2'];
const WITHIN = ['STABLE', 'MATERIAL_DIFFERENCE', 'UNSURE'];
const CROSS = ['MATERIAL', 'NO_MATERIAL', 'UNSURE'];
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => object(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function validatePacket(bytes, expectedSha) {
  if (sha256(bytes) !== expectedSha) throw new Error('blind packet SHA256 불일치');
  let packet;
  try { packet = JSON.parse(bytes); } catch { throw new Error('blind packet JSON 오류'); }
  if (!exactKeys(packet, ['schemaVersion', 'rubric', 'cases']) || packet.schemaVersion !== 1
      || !exactKeys(packet.rubric, ['material', 'notMaterial', 'instruction'])
      || ![packet.rubric.material, packet.rubric.notMaterial].every(values =>
        Array.isArray(values) && values.length > 0 && values.every(value => typeof value === 'string'))
      || typeof packet.rubric.instruction !== 'string'
      || !Array.isArray(packet.cases) || packet.cases.length !== 66) {
    throw new Error('blind packet schema/count 불일치');
  }
  const seen = new Set();
  for (const item of packet.cases) {
    if (!exactKeys(item, ['blindCaseNumber', 'originalRequest', 'historicalRequestTime',
      'boundedConversationHistory', 'groupX', 'groupY', 'decision'])
      || !Number.isInteger(item.blindCaseNumber) || item.blindCaseNumber < 1
      || item.blindCaseNumber > 66 || seen.has(item.blindCaseNumber)
      || typeof item.originalRequest !== 'string' || !item.originalRequest.trim()
      || !Number.isFinite(item.historicalRequestTime)
      || !Array.isArray(item.boundedConversationHistory)
      || !item.boundedConversationHistory.every(entry => exactKeys(entry, ['role', 'content'])
        && ['user', 'assistant'].includes(entry.role) && typeof entry.content === 'string')
      || ![item.groupX, item.groupY].every(group => Array.isArray(group) && group.length === 2
        && group.every(answer => typeof answer === 'string' && answer.trim()))
      || !exactKeys(item.decision, ['withinXStable', 'withinYStable', 'crossArmMateriality',
        'finalLabel', 'reason']) || !Object.values(item.decision).every(value => value === null)) {
      throw new Error('blind packet case 구조/decision 불일치');
    }
    seen.add(item.blindCaseNumber);
  }
  packet.cases.sort((a, b) => a.blindCaseNumber - b.blindCaseNumber);
  return packet;
}

function loadPacket(packetPath, manifestPath = DEFAULT_MANIFEST) {
  const manifestBytes = fs.readFileSync(manifestPath);
  if (sha256(manifestBytes) !== EXPECTED_MANIFEST_SHA256) {
    throw new Error('generation manifest SHA256 불일치');
  }
  const manifest = JSON.parse(manifestBytes);
  if (manifest.schemaVersion !== 1 || manifest.generationCompleteCases !== 66
      || manifest.generationFailureCases !== 0 || manifest.preexistingToolIndeterminate !== 13
      || manifest.humanAdjudications !== 0 || manifest.blindPacketSha256 !== EXPECTED_PACKET_SHA256) {
      throw new Error('generation manifest 상태 불일치');
  }
  checkPrivateFile(packetPath);
  return { packet: validatePacket(fs.readFileSync(packetPath), manifest.blindPacketSha256),
    packetSha256: manifest.blindPacketSha256 };
}

function deriveDecision(raw) {
  if (!exactKeys(raw, ['blindCaseNumber', 'withinX', 'withinY', 'crossComparisons'])
      || !Number.isInteger(raw.blindCaseNumber) || !WITHIN.includes(raw.withinX)
      || !WITHIN.includes(raw.withinY)) throw new Error('판단 입력 형식 오류');
  const stable = raw.withinX === 'STABLE' && raw.withinY === 'STABLE';
  if (stable) {
    if (!exactKeys(raw.crossComparisons, PAIRS)
        || !PAIRS.every(pair => CROSS.includes(raw.crossComparisons[pair]))) {
      throw new Error('네 cross-pair 판단이 모두 필요합니다.');
    }
  } else if (raw.crossComparisons !== null) {
    throw new Error('within-group이 stable하지 않으면 cross-pair 판단은 null이어야 합니다.');
  }
  if (raw.withinX === 'UNSURE' || raw.withinY === 'UNSURE'
      || (stable && PAIRS.some(pair => raw.crossComparisons[pair] === 'UNSURE'))) {
    return { finalLabel: 'INDETERMINATE', reason: 'INDETERMINATE_ADJUDICATION' };
  }
  if (!stable) return { finalLabel: 'INDETERMINATE', reason: 'INDETERMINATE_NONDETERMINISM' };
  if (PAIRS.every(pair => raw.crossComparisons[pair] === 'MATERIAL')) {
    return { finalLabel: 'MATERIAL_CHANGE', reason: null };
  }
  if (PAIRS.every(pair => raw.crossComparisons[pair] === 'NO_MATERIAL')) {
    return { finalLabel: 'NO_MATERIAL_CHANGE', reason: null };
  }
  return { finalLabel: 'INDETERMINATE', reason: 'INDETERMINATE_NONDETERMINISM' };
}

function privateOutputDir(outputDir, repoRoot = ROOT) {
  const absolute = path.resolve(outputDir);
  const root = fs.realpathSync(repoRoot);
  if (absolute === root || absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error('output directory는 저장소 밖이어야 합니다.');
  }
  fs.mkdirSync(absolute, { recursive: true, mode: 0o700 });
  const real = fs.realpathSync(absolute);
  if (real === root || real.startsWith(`${root}${path.sep}`)) {
    throw new Error('output directory는 저장소 밖이어야 합니다.');
  }
  const stat = fs.statSync(real);
  if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700
      || (process.getuid && stat.uid !== process.getuid())) {
    throw new Error('private output directory는 현재 사용자 소유 mode 0700이어야 합니다.');
  }
  return real;
}

function checkPrivateFile(filename) {
  if (fs.existsSync(filename) && (fs.statSync(filename).mode & 0o777) !== 0o600) {
    throw new Error('private file은 mode 0600이어야 합니다.');
  }
}

function reviewState({ packet, packetSha256, outputDir, repoRoot = ROOT, now = () => new Date() }) {
  const dir = privateOutputDir(outputDir, repoRoot);
  const journalPath = path.join(dir, JOURNAL);
  const finalPath = path.join(dir, FINAL);
  checkPrivateFile(journalPath);
  checkPrivateFile(finalPath);
  const rows = [];
  if (fs.existsSync(journalPath)) {
    const journal = fs.readFileSync(journalPath, 'utf8');
    if (journal && !journal.endsWith('\n')) throw new Error('journal 마지막 줄이 불완전합니다.');
    for (const line of journal.split('\n').slice(0, -1)) {
      let row;
      try { row = JSON.parse(line); } catch { throw new Error('journal JSON 오류'); }
      const raw = { blindCaseNumber: row.blindCaseNumber, withinX: row.withinX,
        withinY: row.withinY, crossComparisons: row.crossComparisons };
      const derived = deriveDecision(raw);
      if (!exactKeys(row, ['blindCaseNumber', 'withinX', 'withinY', 'crossComparisons',
        'finalLabel', 'reason', 'submittedAt', 'packetSha256'])
        || row.blindCaseNumber !== rows.length + 1 || row.packetSha256 !== packetSha256
        || row.finalLabel !== derived.finalLabel || row.reason !== derived.reason
        || typeof row.submittedAt !== 'string' || !Number.isFinite(Date.parse(row.submittedAt))) {
        throw new Error('journal 순서/내용 불일치');
      }
      rows.push(row);
    }
  }
  if (rows.length > 66) throw new Error('journal case count 초과');
  if (rows.length < 66 && fs.existsSync(finalPath)) {
    throw new Error('완료 artifact와 journal 진행 상태 불일치');
  }

  function finalBytes() {
    return Buffer.from(`${JSON.stringify({ schemaVersion: 1, protocol: PROTOCOL,
      blindPacketSha256: packetSha256, reviewedCaseCount: 66,
      humanAdjudicationCompleted: true, completedAt: rows[65].submittedAt,
      cases: rows.map(({ blindCaseNumber, withinX, withinY, crossComparisons,
        finalLabel, reason }) => ({ blindCaseNumber, withinX, withinY, crossComparisons,
        finalLabel, reason })) }, null, 2)}\n`);
  }
  function completeOnce() {
    if (rows.length !== 66) return;
    const bytes = finalBytes();
    if (fs.existsSync(finalPath)) {
      if (!fs.readFileSync(finalPath).equals(bytes)) throw new Error('기존 final artifact 불일치');
      return;
    }
    const temp = path.join(dir, `.${FINAL}.${crypto.randomUUID()}.tmp`);
    const fd = fs.openSync(temp, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    try { fs.linkSync(temp, finalPath); } finally { fs.unlinkSync(temp); }
    const dirFd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  }
  completeOnce();

  function submit(raw) {
    const derived = deriveDecision(raw);
    const index = raw.blindCaseNumber - 1;
    if (index < rows.length) {
      const previous = rows[index];
      const same = raw.withinX === previous.withinX && raw.withinY === previous.withinY
        && (raw.crossComparisons === null
          ? previous.crossComparisons === null
          : PAIRS.every(pair => raw.crossComparisons[pair] === previous.crossComparisons[pair]));
      if (!same) {
        const error = new Error('이미 제출한 case의 판단을 변경할 수 없습니다.');
        error.statusCode = 409;
        throw error;
      }
      completeOnce();
      return { saved: true, duplicate: true };
    }
    if (index !== rows.length || rows.length === 66) {
      const error = new Error('현재 순서의 case만 제출할 수 있습니다.');
      error.statusCode = 409;
      throw error;
    }
    const row = { ...raw, ...derived, submittedAt: now().toISOString(), packetSha256 };
    const fd = fs.openSync(journalPath, 'a', 0o600);
    try {
      fs.writeFileSync(fd, `${JSON.stringify(row)}\n`);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    rows.push(row);
    completeOnce();
    return { saved: true };
  }

  function current() {
    return { progress: { reviewed: rows.length, total: 66 },
      currentCase: rows.length < 66 ? packet.cases[rows.length] : null };
  }
  return { current, submit, journalPath, finalPath };
}

const HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>시온 P0-B 블라인드 검토</title><link rel="stylesheet" href="/style.css"></head><body><main id="app"><p>검토 화면을 불러오는 중…</p></main><script src="/app.js" defer></script></body></html>`;
const CSS = `:root{font:16px/1.55 system-ui,-apple-system,sans-serif;color:#20211f;background:#f7f7f4}*{box-sizing:border-box}body{margin:0}main{max-width:1250px;margin:auto;padding:24px}.card,.answer,.question{background:white;border:1px solid #deded8;border-radius:12px;padding:20px;margin:0 0 20px}.lead{background:#eef3ef}.lead p{margin:.4em 0}.muted{color:#61655e}.case-head{display:flex;justify-content:space-between;align-items:baseline}.history-item{border-left:3px solid #b7c8bd;padding:4px 12px;margin:12px 0;white-space:pre-wrap}.history-item.assistant{border-color:#c8c2b7}.text{white-space:pre-wrap;overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.answer{min-width:0}.answer h3{margin-top:0}.question legend{font-weight:700;margin-bottom:8px}.question small{display:block;color:#555;margin:8px 0 12px;white-space:pre-line}.choices{display:flex;flex-wrap:wrap;gap:10px}.choices label{border:1px solid #bcc4bb;border-radius:9px;padding:10px;cursor:pointer}.choices label:has(input:checked){background:#dbeadf;border-color:#51745b}button{border:0;border-radius:9px;background:#244d32;color:white;font:inherit;padding:12px 20px;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}.error{color:#a51e1e}h1,h2{line-height:1.25}@media(max-width:750px){main{padding:14px}.grid{grid-template-columns:1fr}.card,.answer,.question{padding:16px}}`;
const APP = String.raw`'use strict';
const app = document.getElementById('app');
const choices = {};
const pairs = ['X1_Y1', 'X1_Y2', 'X2_Y1', 'X2_Y2'];
const withinHelp = '표현, 길이, 말투가 달라도 사실·추천·확신 정도·행동·핵심 이유가 같으면 “같음”.\n그중 하나라도 이후 판단이나 행동을 바꿀 정도로 달라지면 “실질적으로 다름”.\n확신이 없으면 억지로 고르지 말고 “판단 어려움”.';
const materialHelp = '실질적 차이: 기억한 사실, 추천·우선순위, 확신과 유보·추가 질문, 행동, 이후 판단을 바꿀 핵심 이유.\n실질적 차이가 아님: 말투·문체, 문장 순서, 설명 길이, 같은 뜻의 표현, 결론에 영향 없는 주변 설명.';
function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function add(parent, ...children) {
  for (const child of children) parent.append(child);
  return parent;
}
function card(title, text, cls = '') {
  const section = el('section', undefined, 'card ' + cls);
  return add(section, el('h2', title), el('div', text, 'text'));
}
function question(root, key, title, help, options, onChange) {
  const field = el('fieldset', undefined, 'question');
  add(field, el('legend', title), el('small', help));
  const row = el('div', undefined, 'choices');
  for (const [value, label] of options) {
    const wrap = el('label');
    const radio = el('input');
    radio.type = 'radio';
    radio.name = key;
    radio.value = value;
    radio.addEventListener('change', () => { choices[key] = value; onChange(); });
    add(wrap, radio, document.createTextNode(' ' + label));
    row.append(wrap);
  }
  field.append(row);
  root.append(field);
}
function render(state) {
  app.replaceChildren();
  const lead = el('section', undefined, 'card lead');
  add(lead, el('h2', '이 실험에서 보는 것'),
    el('p', '두 기억 검색 방식이 최종 답변의 “의미”를 바꿨는지만 판단한다.'),
    el('p', '어느 답이 더 좋거나 정확한지는 고르지 않는다.'),
    el('p', '말투·길이·표현만 달라진 것은 실질적 차이가 아니다. 사실, 추천, 확신 정도, 행동, 또는 이후 판단을 바꿀 핵심 이유가 달라졌다면 실질적 차이로 본다.'));
  app.append(lead, el('p', '진행: ' + state.progress.reviewed + ' / ' + state.progress.total, 'muted'));
  if (!state.currentCase) {
    app.append(card('66 / 66 판정 완료', 'Primary blind HUMAN adjudication이 저장됐다. 다음 단계에서 별도로 결과를 검증하고 집계한다.'));
    return;
  }
  const c = state.currentCase;
  Object.keys(choices).forEach(key => delete choices[key]);
  app.append(el('h1', 'Case ' + c.blindCaseNumber + ' / 66'));
  app.append(card('당시 요청 시각', new Date(c.historicalRequestTime * 1000)
    .toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })));
  app.append(card('원래 요청', c.originalRequest));
  const history = el('section', undefined, 'card');
  history.append(el('h2', '이전 대화 맥락'));
  if (c.boundedConversationHistory.length === 0) history.append(el('p', '이전 대화 없음'));
  for (const item of c.boundedConversationHistory) {
    const row = el('div', undefined, 'history-item ' + item.role);
    add(row, el('strong', item.role === 'user' ? '사용자' : '시온'),
      el('div', item.content, 'text'));
    history.append(row);
  }
  app.append(history);
  for (const [name, group] of [['X', c.groupX], ['Y', c.groupY]]) {
    app.append(el('h2', 'Group ' + name));
    const grid = el('div', undefined, 'grid');
    group.forEach((answer, index) => grid.append(card(name + (index + 1), answer, 'answer')));
    app.append(grid);
  }
  app.append(el('h2', '1. 그룹 안에서 답변이 안정적인가?'));
  const form = el('form');
  const cross = el('section');
  const submit = el('button', '판단 제출');
  submit.type = 'submit';
  const notice = el('p', '', 'muted');
  const withinOptions = [['STABLE', '같음'], ['MATERIAL_DIFFERENCE', '실질적으로 다름'],
    ['UNSURE', '판단 어려움']];
  function validate() {
    submit.disabled = !(choices.withinX && choices.withinY);
    if (!submit.disabled && choices.withinX === 'STABLE' && choices.withinY === 'STABLE') {
      submit.disabled = !pairs.every(pair => choices[pair]);
    }
  }
  function update() {
    cross.replaceChildren();
    if (choices.withinX === 'STABLE' && choices.withinY === 'STABLE') {
      cross.append(el('h2', '2. 그룹 사이의 네 쌍을 각각 비교해줘'));
      cross.append(el('p', materialHelp, 'text muted'));
      for (const pair of pairs) question(cross, pair, pair.replace('_', ' ↔ '),
        '이 두 답변 사이에 실질적인 차이가 있는가?',
        [['MATERIAL', '차이 있음'], ['NO_MATERIAL', '차이 없음'], ['UNSURE', '판단 어려움']], validate);
    } else {
      for (const pair of pairs) delete choices[pair];
    }
    validate();
  }
  question(form, 'withinX', 'X1과 X2는 실질적으로 같은 답변인가?',
    withinHelp, withinOptions, update);
  question(form, 'withinY', 'Y1과 Y2는 실질적으로 같은 답변인가?',
    withinHelp, withinOptions, update);
  add(form, cross, submit, notice);
  validate();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled || !confirm('이 case의 판단을 제출할까?\n\n제출 후 primary review 판단은 수정하지 않는다.')) return;
    submit.disabled = true;
    const stable = choices.withinX === 'STABLE' && choices.withinY === 'STABLE';
    const crossComparisons = stable
      ? Object.fromEntries(pairs.map(pair => [pair, choices[pair]])) : null;
    try {
      const response = await fetch('/api/decision', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Review-Token': REVIEW_TOKEN },
        body: JSON.stringify({ blindCaseNumber: c.blindCaseNumber,
          withinX: choices.withinX, withinY: choices.withinY, crossComparisons }) });
      if (!response.ok) throw Error('저장 실패 (' + response.status + ')');
      const next = await fetch('/api/state', { cache: 'no-store' });
      if (!next.ok) throw Error('진행 상태를 읽을 수 없음');
      render(await next.json());
      const saved = el('p', '저장됨', 'muted');
      app.prepend(saved);
      setTimeout(() => saved.remove(), 2000);
    } catch (error) {
      notice.textContent = error.message;
      notice.className = 'error';
      submit.disabled = false;
    }
  });
  app.append(form);
}
fetch('/api/state', { cache: 'no-store' })
  .then(response => {
    if (!response.ok) throw Error('검토 상태를 읽을 수 없음');
    return response.json();
  })
  .then(render)
  .catch(error => { app.replaceChildren(el('p', error.message, 'error')); });`;

function createServer(review, token = crypto.randomBytes(32).toString('hex')) {
  return http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'");
    const send = (code, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(code, { 'Content-Type': type });
      res.end(body);
    };
    if (req.method === 'GET' && req.url === '/') return send(200, HTML, 'text/html; charset=utf-8');
    if (req.method === 'GET' && req.url === '/style.css') return send(200, CSS, 'text/css; charset=utf-8');
    if (req.method === 'GET' && req.url === '/app.js') {
      return send(200, `const REVIEW_TOKEN=${JSON.stringify(token)};\n${APP}`, 'text/javascript; charset=utf-8');
    }
    if (req.method === 'GET' && req.url === '/api/state') return send(200, JSON.stringify(review.current()));
    if (req.method !== 'POST' || req.url !== '/api/decision') return send(404, '{}');
    if (req.headers['content-type'] !== 'application/json'
        || req.headers['x-review-token'] !== token
        || (req.headers.origin && !['http://127.0.0.1:8765', 'http://localhost:8765'].includes(req.headers.origin))) {
      return send(403, '{}');
    }
    let body = '';
    let tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body) > 4096) tooLarge = true;
    });
    req.on('end', () => {
      if (tooLarge) return send(413, '{}');
      let parsed;
      try { parsed = JSON.parse(body); } catch { return send(400, '{}'); }
      try { send(200, JSON.stringify(review.submit(parsed))); }
      catch (error) { send(error.statusCode || 400, JSON.stringify({ error: error.message })); }
    });
  });
}

function parseArgs(argv) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { help: true };
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--packet', '--output-dir', '--manifest', '--repo-root'].includes(argv[i]) || !argv[i + 1]
        || Object.hasOwn(args, argv[i])) throw new Error('Usage: --packet <private packet> --output-dir <private directory> [--manifest <committed manifest>] [--repo-root <repository>]');
    args[argv[i]] = argv[i + 1];
  }
  if (!args['--packet'] || !args['--output-dir']) throw new Error('Usage: --packet <private packet> --output-dir <private directory> [--manifest <committed manifest>]');
  return { packetPath: args['--packet'], outputDir: args['--output-dir'],
    manifestPath: args['--manifest'] || DEFAULT_MANIFEST, repoRoot: args['--repo-root'] || ROOT };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) { process.stdout.write('Usage: npm run review:memory-p0b-blind -- --packet <private packet> --output-dir <private directory>\n'); return; }
  const { packet, packetSha256 } = loadPacket(args.packetPath, args.manifestPath);
  const review = reviewState({ packet, packetSha256, outputDir: args.outputDir,
    repoRoot: args.repoRoot });
  const server = createServer(review);
  server.listen(8765, '127.0.0.1', () => {
    process.stdout.write('http://127.0.0.1:8765\nPi에서 SSH로 실행했다면 로컬 포트 포워딩으로 개인 브라우저에서 접속해.\n');
  });
  return server;
}

module.exports = { validatePacket, loadPacket, deriveDecision, privateOutputDir,
  reviewState, createServer, parseArgs, main, HTML, CSS, APP, JOURNAL, FINAL };
if (require.main === module) {
  try { main(); } catch (error) { console.error(`blind review 시작 실패: ${error.message}`); process.exitCode = 1; }
}
