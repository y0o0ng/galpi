'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const Database = require('better-sqlite3');
const { createMemoryEvidenceRegistry } = require('./evidence-registry');
const { createGeneralFactReviewStore } = require('./general-fact-review');

const ROOT = path.resolve(__dirname, '../..');
const PORT = 8766;
const TABLES = ['messages', 'memory_evidence_refs', 'memory_general_fact_candidates',
  'memory_general_fact_states', 'memory_general_fact_transitions',
  'memory_general_fact_transition_evidence', 'memory_general_fact_reviews'];

function openDevelopmentDb(filename) {
  const resolved = fs.realpathSync(filename);
  const parent = fs.realpathSync(path.dirname(resolved));
  const stat = fs.statSync(resolved);
  const directory = fs.statSync(parent);
  if (path.basename(resolved) !== 'general-fact-development.db'
      || resolved.startsWith(`${fs.realpathSync(ROOT)}${path.sep}`)
      || resolved.startsWith('/home/pi/galpi/')
      || !stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600
      || (directory.mode & 0o777) !== 0o700
      || (process.getuid && (stat.uid !== process.getuid() || directory.uid !== process.getuid()))) {
    throw new Error('Use an owner-private development DB outside the repository (directory 0700, file 0600).');
  }
  // Inspect only a private development file. No runtime paths, migrations or data reconstruction.
  const db = new Database(resolved, { fileMustExist: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()
      .map(row => row.name);
    if (TABLES.some(name => !tables.includes(name))
        || tables.some(name => !TABLES.includes(name))) {
      throw new Error('Expected only the development messages and LTM tables; no production DB or automatic migration.');
    }
    db.pragma('foreign_keys = ON');
    if (db.pragma('foreign_keys', { simple: true }) !== 1) throw new Error('Foreign keys are required.');
    return db;
  } catch (error) { db.close(); throw error; }
}

const HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>기억 변경 검토</title>
<link rel="stylesheet" href="/style.css"><script defer src="/app.js"></script></head>
<body><main><header><p class="eyebrow">XION · 개발용 검토</p><h1>기억을 바꾸기 전에</h1>
<p>원문 근거와 변경 제안을 확인해줘. 설명이 그럴듯하다는 것만으로 승인하지 않아도 돼.</p>
<p class="muted">승인하면 개발 DB의 사실과 근거 연결을 함께 저장해. 보류·제안 거절은 기존 사실과 후보를 남겨 둬.</p>
</header><div id="notice" role="status" aria-live="polite"></div><div id="app"></div></main></body></html>`;

const CSS = `:root{color-scheme:light;--ink:#2f3437;--muted:#686864;--line:#deded8;--paper:#fbfbfa}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 -apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif}
main{max-width:1040px;margin:auto;padding:48px 24px 80px}header{max-width:760px;margin-bottom:32px}
h1{font-size:32px;letter-spacing:-.035em;line-height:1.2;margin:8px 0 20px}h2{font-size:20px;line-height:1.4;margin:0 0 16px}h3{font-size:16px;margin:0 0 8px}
p{margin:8px 0 16px}.eyebrow,.muted{color:var(--muted)}.eyebrow{font-size:12px;letter-spacing:.09em}.muted{font-size:14px}
section{padding:24px 0;border-top:1px solid var(--line)}.pair{display:grid;grid-template-columns:1fr 1fr;gap:32px}.pair>div{min-width:0}
pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 24px}.value{font-size:22px;letter-spacing:-.025em}.proposal{background:#f0f2ed;padding:24px;border-radius:12px}
details{border-top:1px solid var(--line);padding:16px 0}summary{cursor:pointer;font-weight:600}details pre{font:13px/1.7 ui-monospace,monospace;margin-top:16px}
label{display:block;margin-bottom:8px;font-size:14px}select,textarea,button{font:inherit;border:1px solid var(--line);border-radius:10px;background:white;color:var(--ink)}
select{max-width:100%;padding:10px}textarea{width:100%;min-height:92px;padding:12px;resize:vertical}button{min-height:44px;padding:10px 18px;cursor:pointer}
button.primary{background:var(--ink);color:white;border-color:var(--ink)}button:disabled{opacity:.45;cursor:default}button:focus-visible,summary:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid #899b82;outline-offset:3px}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:16px}.error{color:#92392e}#notice:not(:empty){padding:12px 0}nav{margin-bottom:24px}
@media(max-width:650px){main{padding:32px 16px 56px}.pair{grid-template-columns:1fr;gap:20px}h1{font-size:28px}.actions button{flex:1 1 100%}}`;

const APP = `const app=document.getElementById('app'),notice=document.getElementById('notice');
const names={CREATE:'새 사실 형성',SUPERSEDE:'현실 변화 반영',REVISE:'이전 주장 정정',INVALIDATE:'대체 값 없이 이전 주장 무효화',NO_CHANGE:'기존 사실 유지',WORLD_UPDATE:'현실이 바뀜',CORRECTION:'이전 주장이 잘못됨',ADDITIONAL_CONTEXT:'맥락 추가',EXPANSION:'확장',CONTRADICTION:'모순',TEMPORAL_SCOPE_CHANGE:'시간 범위 변경',INTERPRETATION_REVISION:'해석 수정',AMBIGUOUS:'모호함',UNRESOLVED:'미해결',HISTORICAL:'유효했던 과거 사실로 보존',CORRECTED:'잘못된 이전 주장으로 보존',INVALIDATED:'무효화된 이전 주장으로 보존',CURRENT:'현재 사실 그대로 유지'};
const supersedeEffect='새 값은 현재 사실로 저장하고, 기존 값과 원문 근거는 과거 이력으로 함께 보존해. 기존 값을 삭제하거나 이전 발언이 틀렸다고 판정하는 동작이 아니야.';
function el(tag,text,cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;}
function value(text,empty){return text===null?empty:text;}
function sourceList(container,items,selected){if(!items.length)container.append(el('p','연결된 근거 없음','muted'));
for(const item of items){const s=item.source;container.append(el('p',(s.role==='user'?'사용자':'비서')+' · 메시지 '+s.id+' · '+new Date(s.createdAt*1000).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' KST'+(selected.includes(item.evidenceRef.evidenceId)?' · 제안에 선택된 근거':''),'muted'),el('pre',s.content));}}
function section(title){const s=el('section');s.append(el('h2',title));app.append(s);return s;}
async function request(url,options){const response=await fetch(url,{cache:'no-store',...options});const data=await response.json();if(!response.ok)throw Error(data.error==='STALE_REVIEW'?'검토 이후 상태가 달라졌어. 새 검토가 필요해.':data.error==='REVIEW_DECISION_CONFLICT'?'이미 다른 판단이 저장된 검토야.':'검토를 열거나 저장할 수 없어. 원문과 검토 상태를 다시 확인해줘.');return data;}
async function show(reviewId){app.replaceChildren();try{const data=await request('/api/review?reviewId='+encodeURIComponent(reviewId));render(data);}catch(error){notice.textContent=error.message;notice.className='error';await queue(false);}}
async function queue(clear=true){if(clear)app.replaceChildren();const items=await request('/api/pending');
if(!items.length){app.append(el('p','대기 중인 검토가 없어. 새 제안은 별도 개발 단계에서 준비해줘.'));return;}
const nav=el('nav');const label=el('label','대기 중인 검토 '+items.length+'개');label.htmlFor='reviews';const select=el('select');select.id='reviews';select.append(el('option','검토 선택'));
items.forEach((item,i)=>{const option=el('option','검토 '+(i+1)+' · '+item.reviewId);option.value=item.reviewId;select.append(option);});
select.addEventListener('change',()=>{if(select.selectedIndex>0){notice.textContent='';show(select.value);}});nav.append(label,select);app.append(nav);}
function render({review,replayPackage:r,preview}){
const back=el('button','검토 목록');back.type='button';back.addEventListener('click',()=>queue().catch(failed));app.append(back);
const incoming=section('1. 새 후보와 원문 근거');incoming.append(el('p','사용자 · 주 사용 노트북','muted'),el('pre',value(r.candidate.payload.value,'대체 값 없는 검토 후보'),'value'));
sourceList(incoming,r.newEvidence,review.proposal.evidenceIds);
const existing=section('2. 기존 사실과 원래 지지 근거');existing.append(el('pre',value(preview.currentValue,'현재 등록된 사실 없음'),'value'));sourceList(existing,r.originalSupport,review.proposal.evidenceIds);
const proposed=section('3. 변경 제안 · 아직 저장되지 않음');proposed.classList.add('proposal');
proposed.append(el('p',names[review.proposal.transition]+' · '+(review.proposal.changeClass===null?'최초 형성':names[review.proposal.changeClass])));
const pair=el('div',undefined,'pair');for(const [heading,text] of [['승인 전 현재 값',value(preview.currentValue,'등록된 사실 없음')],['승인 후 현재 값',value(preview.resultingCurrentValue,'현재 사실 없음')]]){const col=el('div');col.append(el('h3',heading),el('pre',text,'value'));pair.append(col);}proposed.append(pair);
if(preview.previousStateDisposition)proposed.append(el('p','승인 후 기존 값의 지위: '+names[preview.previousStateDisposition],'muted'));
if(review.proposal.transition==='SUPERSEDE')proposed.append(el('p',supersedeEffect));
const rationale=section('4. 제안의 판단 이유');rationale.append(el('pre',review.proposal.rationale),el('p','이 이유 역시 검토할 제안이야. 원문이 실제로 지지하는지 확인해줘.','muted'));
const details=el('details');details.append(el('summary','전체 상태 이력 · 반대 근거 · 미해결 후보 · 원문 보기'));
details.append(el('pre',JSON.stringify({states:r.states,history:r.history,counterEvidence:r.counterEvidence,unresolvedCandidates:r.unresolvedCandidates,assumptions:r.assumptions},null,2)));
sourceList(details,r.evidence,review.proposal.evidenceIds);app.append(details);
const decision=section('내 판단');const form=el('form');const label=el('label','판단 이유 (선택)');label.htmlFor='reason';const reason=el('textarea');reason.id='reason';reason.maxLength=2000;
const actions=el('div',undefined,'actions');let busy=false;
for(const [choice,text,prompt] of [['APPROVE','승인','이 제안의 의미 판단을 승인하고 개발 DB의 사실을 변경할까?'],['HOLD','보류','판단을 보류할까? 기존 사실과 후보는 그대로 남아.'],['REJECT_PROPOSAL','제안 거절','이 변경 제안을 거절할까? 근거와 후보를 삭제하는 것은 아니야.']]){
const button=el('button',text,choice==='APPROVE'?'primary':undefined);button.type='button';
button.addEventListener('click',async()=>{if(busy||!confirm(prompt+(choice==='APPROVE'&&review.proposal.transition==='SUPERSEDE'?' '+supersedeEffect:'')+' 제출한 판단은 수정하지 않아.'))return;busy=true;actions.querySelectorAll('button').forEach(b=>b.disabled=true);
try{await request('/api/decision',{method:'POST',headers:{'Content-Type':'application/json','X-Review-Token':REVIEW_TOKEN},body:JSON.stringify({reviewId:review.reviewId,choice,packageSha256:review.packageSha256,reason:reason.value})});notice.className='';notice.textContent='저장됨';await queue();}
catch(error){failed(error);busy=false;actions.querySelectorAll('button').forEach(b=>b.disabled=false);}});actions.append(button);}
form.addEventListener('submit',event=>event.preventDefault());form.append(label,reason,actions);decision.append(form);}
function failed(error){notice.className='error';notice.textContent=error.message;}
queue().catch(failed);`;

function createReviewServer(reviews) {
  const token = randomBytes(32).toString('hex');
  const displayed = new Map();
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    const send = (status, data, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
    };
    const port = server.address().port;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!hosts.includes(req.headers.host)
        || (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))
        || (req.headers.origin && !hosts.map(host => `http://${host}`).includes(req.headers.origin))) {
      return send(403, { error: 'LOCAL_ORIGIN_REQUIRED' });
    }
    try {
      if (req.method === 'GET' && req.url === '/') return send(200, HTML, 'text/html; charset=utf-8');
      if (req.method === 'GET' && req.url === '/style.css') return send(200, CSS, 'text/css; charset=utf-8');
      if (req.method === 'GET' && req.url === '/app.js') return send(200,
        `const REVIEW_TOKEN=${JSON.stringify(token)};\n${APP}`, 'text/javascript; charset=utf-8');
      if (req.method === 'GET' && req.url === '/api/pending') return send(200, reviews.listPending());
      if (req.method === 'GET' && req.url.startsWith('/api/review?')) {
        const url = new URL(req.url, `http://${hosts[0]}`);
        if (url.pathname !== '/api/review' || [...url.searchParams.keys()].join(',') !== 'reviewId') {
          return send(400, { error: 'INVALID_REVIEW_REQUEST' });
        }
        const view = reviews.read(url.searchParams.get('reviewId'));
        if (view.review.decision !== null) return send(409, { error: 'REVIEW_ALREADY_DECIDED' });
        displayed.set(view.review.reviewId, view.review.packageSha256);
        return send(200, view);
      }
      if (req.method !== 'POST' || req.url !== '/api/decision') return send(404, { error: 'NOT_FOUND' });
      if (req.headers['x-review-token'] !== token || req.headers['content-type'] !== 'application/json') {
        return send(403, { error: 'REVIEW_TOKEN_REQUIRED' });
      }
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 16384) return send(413, { error: 'REQUEST_TOO_LARGE' });
        chunks.push(chunk);
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return send(400, { error: 'INVALID_JSON' }); }
      if (!input || typeof input !== 'object' || Array.isArray(input)
          || Object.keys(input).some(key => !['reviewId', 'choice', 'packageSha256', 'reason'].includes(key))
          || typeof input.reviewId !== 'string' || !displayed.has(input.reviewId)
          || displayed.get(input.reviewId) !== input.packageSha256) {
        return send(400, { error: 'DISPLAYED_REVIEW_REQUIRED' });
      }
      const { reviewId, ...decision } = input;
      const result = reviews.decide(reviewId, decision);
      return send(200, { saved: true, reviewId: result.reviewId, decision: result.decision });
    } catch (error) {
      // Never log owning-source text, SQL exception bodies or raw replay content.
      return send(409, { error: /^[A-Z_]+$/.test(error.code || '') ? error.code : 'REVIEW_UNAVAILABLE' });
    }
  });
  return server;
}

function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) {
    process.stdout.write('Usage: npm run review:memory-general-fact -- --development-db <private-dir>/general-fact-development.db\n');
    return;
  }
  if (argv.length !== 2 || argv[0] !== '--development-db' || !argv[1]) throw new Error('Expected --development-db <private-dir>/general-fact-development.db');
  const db = openDevelopmentDb(argv[1]);
  let server;
  try { server = createReviewServer(createGeneralFactReviewStore(db, createMemoryEvidenceRegistry(db))); }
  catch (error) { db.close(); throw error; }
  server.on('close', () => db.close());
  server.on('error', () => { db.close(); process.stderr.write('Development review server could not start.\n'); process.exitCode = 1; });
  server.listen(PORT, '127.0.0.1', () => process.stdout.write(`http://127.0.0.1:${PORT}\nDevelopment DB only; no automatic migrations or model calls.\n`));
  return server;
}

module.exports = { openDevelopmentDb, createReviewServer, main, HTML, CSS, APP };
if (require.main === module) {
  try { main(); } catch { process.stderr.write('Development review could not start. Check --development-db, permissions and the existing LTM schema.\n'); process.exitCode = 1; }
}
