'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const Database = require('better-sqlite3');
const { readConversationEpisode, readPrivateEpisode, writePrivateArtifact } = require('./bundle-builder');
const { canonicalJson, GENERAL_FACT_ATTRIBUTES } = require('./general-fact');
const { validateProjectPayload, STATUSES } = require('./project-candidate');
const { decodeSpan } = require('../memory-inference-p1b6-surfaces');
const { createOpenAIBundleSelector } = require('./bundle-openai');
const { createFormationLunaStages } = require('./formation-openai');
const { runFormationEpisode } = require('./formation-runner');

const SESSION = 'shared-main';
const DECISIONS = ['APPROVE', 'EDIT', 'NO_STORE'];
const hash = text => createHash('sha256').update(text).digest('hex');
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const padded = n => String(n).padStart(3, '0');
const RELABEL_NOTES = /취향|소유|소장/;

// Evaluation is every clean 6-24 message session no earlier run has seen; everything else trains.
function partition(rows, usedEpisodes) {
  const used = new Set(usedEpisodes.flatMap(e => [e.firstMessageId, e.lastMessageId]));
  const groups = [];
  let group = [];
  for (const row of rows) {
    if (group.length && row.created_at - group.at(-1).created_at >= 1800) { groups.push(group); group = []; }
    group.push(row);
  }
  if (group.length) groups.push(group);
  const entries = { train: [], eval: [] };
  let blank = 0;
  for (const items of groups) {
    if (items.some(row => row.blank)) { blank++; continue; }
    const entry = { firstMessageId: items[0].id, lastMessageId: items.at(-1).id, messageCount: items.length };
    const unseen = !items.some(row => (row.id >= 1684 && row.id <= 1707) || used.has(row.id));
    entries[items.length >= 6 && items.length <= 24 && unseen ? 'eval' : 'train'].push(entry);
  }
  return { ...entries, blankSessions: blank };
}

function prepare(sourcePath, dir, usedEpisodes) {
  const db = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    const rows = db.prepare('SELECT id, created_at, trim(content) = \'\' AS blank FROM messages WHERE session_id = ? ORDER BY created_at, id').all(SESSION);
    const { train, eval: evaluation, blankSessions } = partition(rows, usedEpisodes);
    if (evaluation.length !== 10) throw Error('UNEXPECTED_EVAL_SIZE');
    fs.mkdirSync(path.join(dir, 'episodes'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(dir, 'reports'), { recursive: true, mode: 0o700 });
    const episodes = [['train', train], ['eval', evaluation]].flatMap(([split, list]) => list.map((entry, i) => {
      const episodeId = `${split}-${padded(i + 1)}`;
      const episode = readConversationEpisode(db, { sessionId: SESSION, firstMessageId: entry.firstMessageId, lastMessageId: entry.lastMessageId });
      return { episodeId, split, ...entry, episodeSha256: writePrivateArtifact(path.join(dir, 'episodes', `${episodeId}.json`), episode) };
    }));
    writePrivateArtifact(path.join(dir, 'manifest.json'), { schemaVersion: 1, blankSessions, episodes });
    return { train: train.length, eval: evaluation.length, blankSessions };
  } finally { db.close(); }
}

const readManifest = dir => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const readEpisode = (dir, entry) => readPrivateEpisode(path.join(dir, 'episodes', `${entry.episodeId}.json`), entry.episodeSha256);
const reportFile = (dir, entry) => path.join(dir, 'reports', `${entry.episodeId}.json`);

// Reuse earlier drafts only for the byte-identical episode; anything else is drafted fresh.
function importReports(dir, runEpisodesDir, runResultsDir) {
  const earlier = JSON.parse(fs.readFileSync(path.join(runEpisodesDir, 'manifest.json'), 'utf8')).episodes;
  let imported = 0;
  for (const entry of readManifest(dir).episodes) {
    const index = earlier.findIndex(e => e.firstMessageId === entry.firstMessageId && e.lastMessageId === entry.lastMessageId);
    if (index < 0 || earlier[index].episodeSha256 !== entry.episodeSha256 || fs.existsSync(reportFile(dir, entry))) continue;
    const file = path.join(runResultsDir, `episode-${String(index + 1).padStart(2, '0')}.report.json`);
    if (!fs.existsSync(file)) continue;
    writePrivateArtifact(reportFile(dir, entry), JSON.parse(fs.readFileSync(file, 'utf8')));
    imported++;
  }
  return { imported };
}

// Long sessions first because no earlier sample reached them, then a stable hash order.
function draftOrder(entries) {
  return [...entries].sort((a, b) => (b.messageCount > 24) - (a.messageCount > 24)
    || hash(a.episodeId).localeCompare(hash(b.episodeId)));
}

async function draft(dir, split, limit, adapters = {}) {
  const manifest = readManifest(dir);
  const todo = draftOrder(manifest.episodes.filter(e => e.split === split && !fs.existsSync(reportFile(dir, e)))).slice(0, limit);
  let stages = adapters.stages, selectBundles = adapters.selectBundles;
  if (!stages || !selectBundles) {
    const envFile = path.resolve(__dirname, '../../.env');
    const env = { ...(fs.existsSync(envFile) ? require('dotenv').parse(fs.readFileSync(envFile)) : {}), ...process.env };
    if (env.OPENAI_BASE_URL?.trim()) throw Error('CUSTOM_OPENAI_ENDPOINT_UNSUPPORTED');
    stages = createFormationLunaStages({ apiKey: env.OPENAI_API_KEY, enableProjects: true });
    selectBundles = createOpenAIBundleSelector({ apiKey: env.OPENAI_API_KEY });
  }
  const done = [];
  for (const entry of todo) {
    try {
      const report = await runFormationEpisode(readEpisode(dir, entry), { ...stages, deferReview: true, anchorWindows: true, selectBundles });
      writePrivateArtifact(reportFile(dir, entry), report);
      done.push({ episodeId: entry.episodeId, rows: items(dir, entry).length });
    } catch (error) {
      // Error bodies may hold private text; only the code leaves this process.
      done.push({ episodeId: entry.episodeId, error: /^[A-Z_]+$/.test(error.message) ? error.message : 'DRAFT_FAILED' });
    }
  }
  return done;
}

// Only anchors Durability kept reach the Extractor; the durability queue reviews what it dropped.
function items(dir, entry, queue = 'extractor') {
  if (!fs.existsSync(reportFile(dir, entry))) return [];
  const episode = readEpisode(dir, entry);
  return JSON.parse(fs.readFileSync(reportFile(dir, entry), 'utf8')).results
    .filter(result => queue === 'durability' ? result.status === 'NO_WRITE'
      : result.extraction && ['CANDIDATE_READY', 'REVIEW_PREPARED', 'KEEP_AMBIGUOUS', 'EXTRACTION_DEFERRED'].includes(result.status))
    .map(result => {
      const span = result.bundle.anchorSpanRef;
      const turnIds = new Set(result.bundle.evidenceSpanRefs.map(ref => ref.turnId));
      const evidence = episode.turns.filter(turn => turnIds.has(turn.turnId));
      return { itemId: hash(`${entry.episodeId}\0${span.turnId}\0${span.startByte}\0${span.endByte}`), episodeId: entry.episodeId,
        anchor: { turnId: span.turnId, text: decodeSpan(evidence.find(turn => turn.turnId === span.turnId).text, span) },
        evidence: evidence.map(({ turnId, role, text, createdAt }) => ({ turnId, role, text, createdAt })),
        durabilityReason: result.durability.reason, draft: result.extraction ?? null };
    });
}

function validateGold(gold, item) {
  const turns = new Map(item.evidence.map(turn => [turn.turnId, turn]));
  if (gold?.disposition === 'DEFERRED') return { disposition: 'DEFERRED' };
  if (gold?.disposition !== 'EXTRACTED' || !Array.isArray(gold.evidenceTurnIds) || !gold.evidenceTurnIds.length
    || new Set(gold.evidenceTurnIds).size !== gold.evidenceTurnIds.length
    || gold.evidenceTurnIds.some(id => !turns.has(id))) throw Error('INVALID_LABEL');
  if (gold.semanticFamily === 'project') {
    try { validateProjectPayload(gold.payload); } catch { throw Error('INVALID_LABEL'); }
    if (gold.payload.projectMention !== null && !gold.evidenceTurnIds.some(id => turns.get(id).text.includes(gold.payload.projectMention))) throw Error('MENTION_NOT_IN_EVIDENCE');
  } else if (gold.semanticFamily !== 'general_fact' || gold.payload?.subject !== 'USER'
    || !Object.hasOwn(GENERAL_FACT_ATTRIBUTES, gold.payload?.attributeKey) || !nonempty(gold.payload?.value)
    || Object.keys(gold.payload).length !== 3) throw Error('INVALID_LABEL');
  return { disposition: 'EXTRACTED', semanticFamily: gold.semanticFamily, payload: gold.payload, evidenceTurnIds: gold.evidenceTurnIds };
}

// Append-only with last write per item winning, so a mistaken click can be redone.
// The relabel queue re-opens DEFERRED labels whose note now has a registered attribute.
function createLabelStore(dir, split, queue = 'extractor') {
  const file = path.join(dir, queue === 'durability' ? `labels-${split}-durability.jsonl` : `labels-${split}.jsonl`);
  const entries = readManifest(dir).episodes.filter(e => e.split === split);
  const fullLog = () => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const log = () => fullLog().filter(row => queue !== 'relabel' || row.relabel === true);
  const all = () => {
    const open = new Map(fullLog().filter(row => !row.relabel).map(row => [row.itemId, row]));
    return entries.flatMap(entry => items(dir, entry, queue === 'durability' ? queue : 'extractor'))
      .filter(item => queue !== 'relabel' || (open.get(item.itemId)?.gold?.disposition === 'DEFERRED' && RELABEL_NOTES.test(open.get(item.itemId).reason || '')))
      .sort((a, b) => hash(a.itemId).localeCompare(hash(b.itemId)));
  };
  const state = () => ({ queue: all(), labels: new Map(log().map(row => [row.itemId, row])) });
  return {
    next(previousOf) {
      const { queue: pool, labels } = state();
      let item, label = null;
      if (previousOf !== undefined) {
        const order = log().map(row => row.itemId);
        const at = previousOf ? order.lastIndexOf(previousOf) : order.length;
        const id = order[at - 1];
        item = id && pool.find(row => row.itemId === id);
        label = item ? labels.get(item.itemId) : null;
      } else {
        item = pool.find(row => !labels.has(row.itemId));
        if (item && queue === 'relabel') label = [...fullLog()].reverse().find(row => row.itemId === item.itemId);
      }
      return { item: item || null, label, total: pool.length, labeled: pool.filter(row => labels.has(row.itemId)).length, split, queue };
    },
    save(input) {
      const item = all().find(row => row.itemId === input?.itemId);
      if (!item || !DECISIONS.includes(input.decision) || (item.draft === null && input.decision === 'APPROVE')) throw Error('INVALID_LABEL');
      if (input.decision === 'NO_STORE' && input.gold !== null) throw Error('INVALID_LABEL');
      const gold = input.decision === 'NO_STORE' ? null : validateGold(input.decision === 'EDIT' ? input.gold
        : queue === 'relabel' ? [...fullLog()].reverse().find(row => row.itemId === item.itemId).gold : item.draft, item);
      if (input.reason !== undefined && typeof input.reason !== 'string') throw Error('INVALID_LABEL');
      fs.appendFileSync(file, `${JSON.stringify({ itemId: item.itemId, episodeId: item.episodeId, anchorTurnId: item.anchor.turnId, decision: input.decision,
        gold, draftSha256: hash(canonicalJson(item.draft)), reason: input.reason?.trim() || (queue === 'relabel' ? [...fullLog()].reverse().find(row => row.itemId === item.itemId)?.reason : null) || null,
        ...(queue === 'relabel' ? { relabel: true } : {}), labeledAt: new Date().toISOString() })}\n`, { mode: 0o600 });
      return { saved: true };
    },
  };
}

const HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Extractor 라벨</title><link rel="stylesheet" href="/style.css"></head><body><main id="main"></main><script src="/app.js"></script></body></html>`;
const CSS = `:root{color-scheme:light dark;--line:#8884;--mark:#f5c54266}body{margin:0;font:15px/1.6 -apple-system,sans-serif}main{max-width:720px;margin:auto;padding:16px}h2{font-size:13px;margin:20px 0 6px;opacity:.7}.turn{border-top:1px solid var(--line);padding:8px 0;white-space:pre-wrap;overflow-wrap:anywhere}.role{font-size:11px;opacity:.6;display:block}mark{background:var(--mark);color:inherit}.anchor{font-size:17px;font-weight:650}label{display:block;margin:8px 0 2px;font-size:13px}input,select,textarea{width:100%;box-sizing:border-box;font:inherit;padding:8px;border:1px solid var(--line);border-radius:10px;background:transparent;color:inherit}.check{display:flex;gap:8px;align-items:center}.check input{width:auto}.actions{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}button{font:inherit;min-height:44px;padding:0 16px;border:1px solid var(--line);border-radius:10px;background:transparent;color:inherit;cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}#notice{min-height:24px}`;
const APP = `const main=document.getElementById('main');
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const post=async body=>{const r=await fetch('/api/label',{method:'POST',headers:{'Content-Type':'application/json','X-Label-Token':TOKEN},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error);return d;};
const load=async url=>{const r=await fetch(url);render(await r.json());};
function field(form,labelText,node){const l=el('label',labelText);form.append(l,node);return node;}
function select(options,value){const s=el('select');for(const o of options){const op=el('option',o===''?'(없음)':o);op.value=o;s.append(op);}s.value=value??'';return s;}
function goldForm(item,initial,memo){const guess=/소유|소장/.test(memo||'')?'possession':/취향/.test(memo||'')?'preference':null;const form=el('div');const d=initial&&initial.disposition==='EXTRACTED'?initial:{semanticFamily:'project',payload:{kind:'CLAIM',status:null,claimText:'',projectMention:null},evidenceTurnIds:[item.anchor.turnId]};
const family=field(form,'종류',select(['project','general_fact','DEFERRED'],guess?'general_fact':initial&&initial.disposition==='DEFERRED'?'DEFERRED':d.semanticFamily));
const p=el('div'),g=el('div');form.append(p,g);const pl=d.semanticFamily==='project'?d.payload:{kind:'CLAIM',status:null,claimText:'',projectMention:null};const gl=d.semanticFamily==='general_fact'?d.payload:{attributeKey:guess||ATTRS[0],value:guess?item.anchor.text:''};
const kind=field(p,'형태',select(['STATUS','CLAIM','IDENTIFIED'],pl.kind));const status=field(p,'단계',select(['',...STATUSES],pl.status));const mention=field(p,'프로젝트 지칭 (근거에 있는 표현)',el('input'));mention.value=pl.projectMention??'';const claim=field(p,'주장',el('textarea'));claim.rows=2;claim.value=pl.claimText??'';
const attr=field(g,'속성',select(ATTRS,gl.attributeKey));const value=field(g,'값',el('input'));value.value=gl.value;
const boxes=el('div');form.append(el('label','근거 턴'),boxes);const checks=item.evidence.map(t=>{const w=el('label','','check');const c=el('input');c.type='checkbox';c.value=t.turnId;c.checked=d.evidenceTurnIds.includes(t.turnId);w.append(c,el('span',t.turnId+' '+t.role));boxes.append(w);return c;});
const sync=()=>{p.hidden=family.value!=='project';g.hidden=family.value!=='general_fact';boxes.hidden=family.value==='DEFERRED';};family.onchange=sync;sync();
form.read=()=>{if(family.value==='DEFERRED')return{disposition:'DEFERRED'};const ev=checks.filter(c=>c.checked).map(c=>c.value);if(family.value==='general_fact')return{disposition:'EXTRACTED',semanticFamily:'general_fact',payload:{subject:'USER',attributeKey:attr.value,value:value.value},evidenceTurnIds:ev};
return{disposition:'EXTRACTED',semanticFamily:'project',payload:{subject:'USER',kind:kind.value,status:kind.value==='STATUS'?status.value:null,claimText:kind.value==='CLAIM'?claim.value:null,projectMention:mention.value.trim()||null},evidenceTurnIds:ev};};return form;}
function render(view){main.replaceChildren();main.append(el('p',view.split+' '+view.labeled+' / '+view.total));
if(!view.item){main.append(el('p','표시할 항목이 없어.'));const back=el('button','이전 항목');back.onclick=()=>load('/api/previous');main.append(back);return;}
const item=view.item;main.append(el('h2','앵커'),el('p',item.anchor.text,'anchor'));
if(view.label)main.append(el('p','기존 결정: '+view.label.decision+(view.label.gold?' → '+(view.label.gold.semanticFamily||view.label.gold.disposition):'')+'. 다시 저장하면 이 결정을 대신해.'));
main.append(el('h2','Durability 이유'),el('p',item.durabilityReason),...(item.draft?[el('h2',view.queue==='relabel'?'Luna 첫 초안 (참고용)':'초안'),el('pre',JSON.stringify(item.draft,null,2))]:[el('p','Luna는 저장 안 함으로 봤어. 저장해야 하면 수정에서 후보를 적어 줘.')]));
const form=goldForm(item,view.label&&view.label.gold||item.draft,view.label&&view.label.reason);form.hidden=true;const reason=el('input');reason.placeholder='메모 (선택)';const notice=el('p','','');notice.id='notice';
const send=async(decision,gold)=>{try{await post({itemId:item.itemId,decision,gold,reason:reason.value});load('/api/next');}catch(e){notice.textContent='저장 안 됨: '+e.message;}};
const a=el('div','','actions');const approve=el('button',view.queue==='relabel'?'기존 결정 유지':'승인');approve.onclick=()=>send('APPROVE',undefined);const edit=el('button','수정');edit.onclick=()=>{if(form.hidden){form.hidden=false;edit.textContent='수정해서 저장';return;}send('EDIT',form.read());};const none=el('button','저장 안 함');none.onclick=()=>send('NO_STORE',null);const back=el('button','이전 항목');back.onclick=()=>load('/api/previous?of='+item.itemId);
a.append(...(item.draft?[approve]:[]),edit,none,back);main.append(form,reason,a,notice,el('h2','근거'));
for(const t of item.evidence){const d=el('div','','turn');d.append(el('span',t.turnId+' '+t.role,'role'));const at=t.turnId===item.anchor.turnId?t.text.indexOf(item.anchor.text):-1;if(at<0)d.append(t.text);else{d.append(t.text.slice(0,at),el('mark',item.anchor.text),t.text.slice(at+item.anchor.text.length));}main.append(d);}}
load('/api/next');`;

function createLabelServer(store) {
  const token = randomBytes(32).toString('hex');
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    const send = (status, data, type = 'application/json; charset=utf-8') => { res.writeHead(status, { 'Content-Type': type }); res.end(type.startsWith('application/json') ? JSON.stringify(data) : data); };
    const port = server.address().port, hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!hosts.includes(req.headers.host) || (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))
      || (req.headers.origin && !hosts.map(host => `http://${host}`).includes(req.headers.origin))) return send(403, { error: 'LOCAL_ORIGIN_REQUIRED' });
    try {
      const url = new URL(req.url, `http://${hosts[0]}`);
      if (req.method === 'GET' && url.pathname === '/') return send(200, HTML, 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/style.css') return send(200, CSS, 'text/css; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/app.js') return send(200, `const TOKEN=${JSON.stringify(token)},ATTRS=${JSON.stringify(Object.keys(GENERAL_FACT_ATTRIBUTES))},STATUSES=${JSON.stringify(STATUSES)};\n${APP}`, 'text/javascript; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/api/next') return send(200, store.next());
      if (req.method === 'GET' && url.pathname === '/api/previous') return send(200, store.next(url.searchParams.get('of') || ''));
      if (req.method !== 'POST' || url.pathname !== '/api/label') return send(404, { error: 'NOT_FOUND' });
      if (req.headers['x-label-token'] !== token || req.headers['content-type'] !== 'application/json') return send(403, { error: 'LABEL_TOKEN_REQUIRED' });
      const chunks = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 65536) return send(413, { error: 'REQUEST_TOO_LARGE' }); chunks.push(chunk); }
      return send(200, store.save(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    } catch (error) { return send(409, { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'LABEL_UNAVAILABLE' }); }
  });
  return server;
}

async function main(argv) {
  if (argv[0] === 'prepare' && argv.length >= 4) return prepare(argv[1], argv[2], argv.slice(3).flatMap(file => JSON.parse(fs.readFileSync(file, 'utf8')).episodes));
  if (argv[0] === 'import' && argv.length === 4) return importReports(argv[1], argv[2], argv[3]);
  if (argv[0] === 'draft' && argv.length === 4 && ['train', 'eval'].includes(argv[2])) return draft(argv[1], argv[2], Number(argv[3]));
  if (argv[0] === 'serve' && [3, 4].includes(argv.length) && ['train', 'eval'].includes(argv[2]) && [undefined, 'durability', 'relabel'].includes(argv[3])) {
    const port = { durability: 8768, relabel: 8769 }[argv[3]] ?? 8767;
    const server = createLabelServer(createLabelStore(argv[1], argv[2], argv[3]));
    await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
    return { url: `http://127.0.0.1:${port}` };
  }
  throw Error('INVALID_ARGUMENTS');
}

if (require.main === module) {
  main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(/^[A-Z_]+$/.test(error.message) ? error.message : 'EXTRACTOR_LABELS_FAILED'); process.exitCode = 1; });
}

module.exports = { partition, prepare, importReports, draft, items, createLabelStore, createLabelServer };
