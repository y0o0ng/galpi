'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { collectReelsItems } = require('../reels/collect');
const { canonicalizeUrl } = require('../news/normalize');
const { normalizePublicWebUrl } = require('../web/service');
const { verifyAttention } = require('./attention');
const { fail, promptFor, runCodex } = require('./runner');
const WEEK = 7 * 86400;
const QUERIES = [
  ['general', 'major AI and software technology news this week'],
  ['news', '이번주 한국 기술 AI 보안 해킹 금융권 뉴스'],
  ['news', '이번주 반도체 로봇 하드웨어 에너지 기술 뉴스'],
  ['general', '이번주 개발자 프로그래밍 오픈소스 도구 업데이트 뉴스'],
  ['news', 'semiconductor computing hardware new release this week'],
  ['news', 'robotics energy materials technology breakthrough this week'],
  ['general', 'popular programming language developer tool new release this week'],
];
const string = max => ({ type:'string', maxLength:max });
const fields = { title:string(200), summary:string(500), audience:{ type:'string',enum:['general','practitioner'] },
  attention_query:string(200), mode:{type:'string',enum:['news','compare']}, format_reason:string(400), reader_question:string(240), why_interest:string(400),
  anchor_url:string(2000), announced_at:string(40), sources:{type:'array',maxItems:6,items:{type:'object',additionalProperties:false,
    required:['title','url','published_at'],properties:{title:string(200),url:string(2000),published_at:{type:['string','null']}}}},
  compare_targets:{type:'array',maxItems:2,items:string(200)},compare_axes:{type:'array',maxItems:6,items:string(200)},risk:string(700) };
const CANDIDATE_SCHEMA = {type:'object',additionalProperties:false,required:['candidates','shortage_reason'],properties:{
  candidates:{type:'array',maxItems:3,items:{type:'object',additionalProperties:false,required:Object.keys(fields),properties:fields}},shortage_reason:string(500)}};
// 원문 날짜는 참고값이다. 최근 언급 여부는 독립 화제성 검증에서 확인한다.
async function collectCardsItems({ web, now = Math.floor(Date.now()/1000), fetchImpl = fetch }) {
  const free = await collectReelsItems({ now, fetchImpl, windowSeconds:WEEK });
  const settled = await Promise.allSettled(QUERIES.map(([topic,query]) => web.search(query,{topic,timeRange:'week',searchDepth:'basic',maxResults:10})));
  const all = [...free.map(i=>({...i,date_kind:i.source==='Hacker News'?'submission':'feed'}))];
  for (const r of settled) if (r.status==='fulfilled') for (const i of r.value.results) all.push({
    title:i.title,url:i.url,summary:i.snippet || i.content || '',source:'Tavily',published_at:i.publishedDate,date_kind:'estimated'});
  const unique = [...new Map(all.filter(i=>canonicalizeUrl(i.url)).map(i=>[canonicalizeUrl(i.url),i])).values()]
    .sort((a,b)=>(b.published_at||'').localeCompare(a.published_at||'')).slice(0,100);
  const enriched = await Promise.allSettled(unique.map(async item => {
    normalizePublicWebUrl(item.url);
    let url=item.url,response;
    const signal=AbortSignal.timeout(15000);
    for(let n=0;n<5;n++){
      normalizePublicWebUrl(url);response=await fetchImpl(url,{signal,redirect:'manual'});
      if(response.status<300||response.status>=400||!response.headers?.get('location'))break;
      url=new URL(response.headers.get('location'),url).href;
    }
    if (!response.ok) return null;
    normalizePublicWebUrl(response.url || item.url);
    let raw='';
    if(response.body?.getReader){
      const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0;
      try{while(bytes<1000000){const next=await reader.read();if(next.done)break;bytes+=next.value.length;raw+=decoder.decode(next.value,{stream:true});}}
      finally{await reader.cancel();}
    }else raw=await response.text();
    raw=raw.slice(0,1000000);
    const dates = [...raw.matchAll(/"datePublished"\s*:\s*"([^"<>]+)"/gi)].map(m=>m[1]);
    for (const tag of raw.match(/<meta\b[^>]*>/gi)||[]) {
      if (!/(?:article:published_time|datePublished|pubdate|publishdate)/i.test(tag)) continue;
      const value = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]; if(value) dates.unshift(value);
    }
    const published = dates.map(Date.parse).find(Number.isFinite);
    const hasDate=Number.isFinite(published)&&published/1000<=now+60;
    return {...item,announced_at:hasDate?new Date(published).toISOString():null,date_kind:hasDate?'original_publish':'unknown',
      summary:(item.summary+' '+((/<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/i.exec(raw)?.[1])||raw)).replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,3000)};
  }));
  return enriched.filter(r=>r.status==='fulfilled'&&r.value).map(r=>r.value);
}
function validateCandidates(output, items, now, {quota={general:2,practitioner:1},excludedAnchors=[]}={}) {
  const target=quota.general+quota.practitioner,banned=new Set(excludedAnchors.map(canonicalizeUrl));
  if (!Array.isArray(output?.candidates)||output.candidates.length>target) throw fail('CARDS_CANDIDATES_INVALID');
  const known = new Map(items.map(i=>[i.url,i])), seen = new Set(), count={general:0,practitioner:0};
  for (const c of output.candidates) {
    const item=known.get(c.anchor_url),anchor=canonicalizeUrl(c.anchor_url);
    if(banned.has(anchor))throw fail('CARDS_CANDIDATE_DUPLICATE');
    if (!item) throw fail('CARDS_CANDIDATE_SOURCE');
    if (seen.has(anchor)) throw fail('CARDS_CANDIDATE_DUPLICATE');
    if (typeof c.announced_at!=='string'||c.announced_at.length>40) throw fail('CARDS_CANDIDATE_TEXT');
    seen.add(anchor);
    if (!['news','compare'].includes(c.mode)||!Object.hasOwn(count,c.audience)) throw fail('CARDS_CANDIDATE_TYPE');
    count[c.audience]++;
    for (const key of ['title','summary','format_reason','reader_question','why_interest','risk','attention_query'])
      if (typeof c[key]!=='string'||c[key].length>fields[key].maxLength||(['title','summary','format_reason','reader_question','attention_query'].includes(key)&&!c[key].trim())) throw fail('CARDS_CANDIDATE_TEXT');
    if (!Array.isArray(c.sources)||!c.sources.length||c.sources.length>6||!c.sources.some(s=>s.url===c.anchor_url)) throw fail('CARDS_CANDIDATE_SOURCE');
    for (const source of c.sources) {
      if(!known.has(source.url)||typeof source.title!=='string'||!source.title.trim()||source.title.length>200
        ||(source.published_at!==null&&(typeof source.published_at!=='string'||!Number.isFinite(Date.parse(source.published_at))))) throw fail('CARDS_CANDIDATE_SOURCE');
    }
    if (!Array.isArray(c.compare_targets)||!Array.isArray(c.compare_axes)||c.compare_axes.length>6
      ||[...c.compare_targets,...c.compare_axes].some(v=>typeof v!=='string'||!v.trim()||v.length>200)
      || (c.mode==='compare'&&(c.compare_targets.length!==2||c.compare_axes.length<2))
      || (c.mode==='news'&&(c.compare_targets.length||c.compare_axes.length))) throw fail('CARDS_CANDIDATE_COMPARE');
  }
  if (count.general>quota.general||count.practitioner>quota.practitioner||(output.candidates.length===target&&(count.general!==quota.general||count.practitioner!==quota.practitioner))) throw fail('CARDS_CANDIDATE_AUDIENCE');
  if(typeof output.shortage_reason!=='string'||output.shortage_reason.length>500)throw fail('CARDS_CANDIDATE_SHORTAGE');
  if (output.candidates.length<target&&!output.shortage_reason?.trim()) throw fail('CARDS_CANDIDATE_SHORTAGE');
  return [...output.candidates].sort((a,b)=>Number(a.audience==='practitioner')-Number(b.audience==='practitioner'));
}
async function generateCandidates({ config, items, today, now, cwd, web, fetchImpl, signal, runner=runCodex, collect=collectCardsItems }) {
  fs.mkdirSync(cwd,{recursive:true});
  const runDir=fs.mkdtempSync(path.join(cwd,'run-')),accepted=[],excluded=[],attempts=[],seen=new Set(),notes=[];
  let pool=[...items],stopReason='',usage=null,attentionUsage=null;
  const remaining=()=>({general:2-accepted.filter(c=>c.audience==='general').length,practitioner:1-accepted.filter(c=>c.audience==='practitioner').length});
  const budgetExhausted=()=>typeof web?.getUsage==='function'&&Number.isFinite(web.softLimit)&&Number(web.getUsage()?.credits)>=web.softLimit;
  const available=()=>pool.filter(item=>!seen.has(canonicalizeUrl(item.url)));
  const persist=error=>{
    const quota=remaining(),shortage=accepted.length===3?'':[stopReason,notes.at(-1),excluded.length?`화제성 근거 부족 후보 ${excluded.length}개를 제외했어요.`:'',`남은 슬롯: 일반인 ${quota.general}개, 실무자 ${quota.practitioner}개. 확인된 후보만 제공해요.`].filter(Boolean).join(' ');
    const output={candidates:[...accepted].sort((a,b)=>Number(a.audience==='practitioner')-Number(b.audience==='practitioner')),excluded_candidates:excluded,shortage_reason:shortage,attempts,run_dir:runDir};
    if(error)output.error_code=error.code||'CARDS_FAILED';
    fs.writeFileSync(path.join(runDir,'result.json'),JSON.stringify(output,null,2));
    fs.writeFileSync(path.join(cwd,'candidates.json'),JSON.stringify(output,null,2));
    fs.writeFileSync(path.join(cwd,'attempts.json'),JSON.stringify(attempts,null,2));
    return output;
  };
  try{
    for(let round=0;round<4&&accepted.length<3;round++){
      if(signal?.aborted)throw fail('CARDS_ABORTED');
      if(budgetExhausted()){stopReason='공유 검색 예산이 소진되어 빈 슬롯의 추가 탐색을 멈췄어요.';break;}
      const attemptDir=path.join(runDir,`attempt-${round}`);fs.mkdirSync(attemptDir,{recursive:true});
      const entry={round,cwd:attemptDir,quota:remaining(),excluded_anchors:[...seen],started_at:new Date().toISOString(),status:'running'};attempts.push(entry);
      if(!available().length){
        const fresh=await collect({web,now,fetchImpl});
        fs.writeFileSync(path.join(attemptDir,'collection.json'),JSON.stringify(fresh,null,2));
        pool=[...new Map([...pool,...fresh].map(item=>[item.url,item])).values()];entry.refreshed_collection=true;
        if(budgetExhausted()){entry.status='budget_exhausted';stopReason='공유 검색 예산이 소진되어 빈 슬롯의 추가 탐색을 멈췄어요.';break;}
        if(!available().length){entry.status='no_new_sources';stopReason='추가 수집에서도 이미 검토한 소식 외의 원문을 확보하지 못했어요.';break;}
      }
      const input=pool.filter(item=>!seen.has(canonicalizeUrl(item.url)));
      fs.writeFileSync(path.join(attemptDir,'items.json'),JSON.stringify(input,null,2));
      const prompt=promptFor(config.root,'candidates_cards',{today,items:JSON.stringify(input)})+`\n\n## 이번 탐색 슬롯 — 서버 확정\n이번 호출은 남은 슬롯만 채워요: ${JSON.stringify(entry.quota)}. 기존 문서의 전체 2+1 구성보다 이 남은 수가 우선이에요.\n이미 통과했거나 제외된 anchor는 다시 제안하지 않아요: ${JSON.stringify(entry.excluded_anchors)}. 추적 파라미터·뉴스/비교 형식·audience를 바꿔 같은 소식을 재제안하지 않아요.\n이번 슬롯 수를 확보했으면 shortage_reason은 빈 문자열이고, 못 채웠으면 부족 이유를 적어요. 원문 근거·날짜·형식 기준은 그대로 적용해요.\n`;
      const schema={...CANDIDATE_SCHEMA,properties:{...CANDIDATE_SCHEMA.properties,candidates:{...CANDIDATE_SCHEMA.properties.candidates,maxItems:entry.quota.general+entry.quota.practitioner,
        items:{...CANDIDATE_SCHEMA.properties.candidates.items,properties:{...fields,audience:{type:'string',enum:Object.keys(entry.quota).filter(key=>entry.quota[key]>0)}}}}}};
      const result=await runner({config,model:config.candidateModel,cwd:attemptDir,signal,schema,reasoningEffort:'medium',prompt});
      entry.usage=result.usage;usage=result.usage;
      fs.writeFileSync(path.join(attemptDir,'candidates-draft.json'),JSON.stringify(result.response,null,2));
      let draft;
      try{draft=validateCandidates(result.response,pool,now,{quota:entry.quota,excludedAnchors:entry.excluded_anchors});}
      catch(error){
        if(error.code!=='CARDS_CANDIDATE_SOURCE')throw error;
        entry.status='invalid_sources';entry.error_code=error.code;entry.finished_at=new Date().toISOString();
        notes.push('입력 자료 밖 출처가 포함된 초안은 제외했어요. 출처는 수집 자료의 URL만 사용해요.');
        if(round===3)stopReason='최초 탐색과 최대 3회 재탐색을 마쳤지만 출처 조건을 만족하는 후보를 모두 확보하지 못했어요.';
        persist();continue;
      }
      draft.forEach(candidate=>seen.add(canonicalizeUrl(candidate.anchor_url)));
      if(result.response.shortage_reason)notes.push(result.response.shortage_reason);
      const attention=draft.length?await verifyAttention({config,candidates:draft,today,now,cwd:attemptDir,web,fetchImpl,runner,signal}):{candidates:[],usage:null};
      entry.attention_usage=attention.usage;attentionUsage=attention.usage;
      const passed=attention.candidates.filter(candidate=>candidate.attention.status==='verified'),rejected=attention.candidates.filter(candidate=>candidate.attention.status!=='verified');
      accepted.push(...passed);excluded.push(...rejected);entry.accepted_anchors=passed.map(candidate=>candidate.anchor_url);entry.excluded_anchors_after_review=rejected.map(candidate=>candidate.anchor_url);entry.status='ok';entry.finished_at=new Date().toISOString();
      fs.writeFileSync(path.join(attemptDir,'candidates.json'),JSON.stringify({candidates:passed,excluded_candidates:rejected,shortage_reason:result.response.shortage_reason},null,2));
      persist();
      const searchesPath=path.join(attemptDir,'attention-searches.json');
      if(fs.existsSync(searchesPath)&&JSON.parse(fs.readFileSync(searchesPath,'utf8')).some(search=>search.error==='WEB_MONTHLY_BUDGET_EXHAUSTED')){stopReason='공유 검색 예산이 소진되어 빈 슬롯의 추가 탐색을 멈췄어요.';break;}
      if(round===3&&accepted.length<3)stopReason='최초 탐색과 최대 3회 재탐색을 마쳤지만 필요한 화제성 확인 후보를 모두 확보하지 못했어요.';
    }
    const output=persist();return {candidates:output.candidates,shortageReason:output.shortage_reason,usage,attentionUsage};
  }catch(error){const entry=attempts.at(-1);if(entry&&entry.status==='running'){entry.status='failed';entry.error_code=error.code||'CARDS_FAILED';entry.finished_at=new Date().toISOString();}persist(error);throw error;}
}

module.exports={CANDIDATE_SCHEMA,WEEK,collectCardsItems,generateCandidates,validateCandidates};
