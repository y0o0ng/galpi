'use strict';
const fs=require('node:fs'),path=require('node:path');
const {CANDIDATE_SCHEMA,validateCandidates,collectCardsItems}=require('./candidates');
const {runCodex,promptFor,fail}=require('./runner');
const {verifyAttention}=require('./attention');
const RANK_SCHEMA={type:'object',additionalProperties:false,required:['general','practitioner'],properties:{}};
for(const audience of ['general','practitioner'])RANK_SCHEMA.properties[audience]={type:'array',maxItems:audience==='general'?10:5,items:{type:'object',additionalProperties:false,required:['id','reason'],properties:{id:{type:'integer',minimum:0,maximum:14},reason:{type:'string',maxLength:500}}}};
async function generateRankedCandidates({config,items,today,now,cwd,web,signal,runner=runCodex,collect=collectCardsItems,fetchImpl,usedTopics=[]}){
  fs.mkdirSync(cwd,{recursive:true});const dir=fs.mkdtempSync(path.join(cwd,'ranked-')),pool=[],invalid=[],attempts=[];let sources=[...items];
  const remaining=()=>({general:10-pool.filter(c=>c.audience==='general').length,practitioner:5-pool.filter(c=>c.audience==='practitioner').length});
  const persist=()=>fs.writeFileSync(path.join(dir,'pool.json'),JSON.stringify({pool,invalid,attempts},null,2));
  for(let round=0;round<4;round++){
    const quota=remaining();if(!quota.general&&!quota.practitioner)break;
    if(signal?.aborted)throw fail('CARDS_ABORTED');
    if(Number.isFinite(web?.softLimit)&&Number(web.getUsage()?.credits)>=web.softLimit)break;
    if(round&&round===2){const fresh=await collect({web,now,fetchImpl});sources=[...new Map([...sources,...fresh].map(i=>[i.url,i])).values()];}
    if(!sources.length)break;
    const schema=JSON.parse(JSON.stringify(CANDIDATE_SCHEMA));schema.properties.candidates.maxItems=quota.general+quota.practitioner;schema.properties.candidates.items.properties.audience.enum=Object.keys(quota).filter(a=>quota[a]>0);
    const attempt=path.join(dir,`draft-${round}`),result=await runner({config,model:config.candidateModel,cwd:attempt,signal,schema,reasoningEffort:'medium',prompt:promptFor(config.root,'candidates_cards',{today,items:JSON.stringify(sources)})+'\n## 서버 확정 슬롯\n남은 슬롯 '+JSON.stringify(quota)+'만 제안해요. 이미 확보한 소식은 중복하지 않아요: '+JSON.stringify(pool.map(c=>({title:c.title,url:c.anchor_url})))+'\n자료에 없는 URL을 쓰지 않아요. 부족하면 확보한 후보와 이유만 출력해요.'});
    fs.mkdirSync(attempt,{recursive:true});fs.writeFileSync(path.join(attempt,'draft.json'),JSON.stringify(result.response,null,2));
    const entry={round,quota,usage:result.usage,accepted:0,rejected:0};
    for(const candidate of result.response.candidates||[]){
      try{validateCandidates({candidates:[candidate],shortage_reason:'개별 검증'},sources,now,{quota,excludedAnchors:pool.map(c=>c.anchor_url)});
        if(pool.filter(c=>c.audience===candidate.audience).length>=(candidate.audience==='general'?10:5))throw fail('CARDS_CANDIDATE_AUDIENCE');
        pool.push(candidate);entry.accepted++;
      }catch(error){invalid.push({candidate,error_code:error.code||'CARDS_CANDIDATES_INVALID'});entry.rejected++;}
    }
    attempts.push(entry);persist();
  }
  if(!pool.length){const result={candidates:[],shortageReason:'이번 수집에서 출처를 확인할 수 있는 주제를 찾지 못했어요. 직접 주제를 제안할 수 있어요.'};fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));return result;}
  return rankCandidatePool({config,pool,today,now,dir,web,signal,runner,fetchImpl,usedTopics});
}
async function rankCandidatePool({config,pool,today,now,dir,web,signal,runner=runCodex,fetchImpl,usedTopics=[]}){
  const checked=[];
  for(let i=0;i<pool.length;i+=3){const batch=path.join(dir,`attention-${i}`);fs.mkdirSync(batch,{recursive:true});const result=await verifyAttention({config,candidates:pool.slice(i,i+3),today,now,cwd:batch,web,runner,signal,fetchImpl});checked.push(...result.candidates);}
  fs.writeFileSync(path.join(dir,'checked.json'),JSON.stringify(checked,null,2));
  return rankCheckedCandidates({config,checked,dir,signal,runner,usedTopics});
}
async function rankCheckedCandidates({config,checked,dir,signal,runner=runCodex,usedTopics=[]}){
  fs.mkdirSync(dir,{recursive:true});
  const schema=JSON.parse(JSON.stringify(RANK_SCHEMA));
  for(const audience of ['general','practitioner']){
    const ids=checked.map((c,id)=>c.audience===audience?id:null).filter(id=>id!==null);
    schema.properties[audience].minItems=ids.length;schema.properties[audience].maxItems=ids.length;
    if(ids.length)schema.properties[audience].items.properties.id.enum=ids;
  }
  const prompt=promptFor(config.root,'rank_candidates_cards',{candidates:JSON.stringify(checked.map((c,id)=>({id,...c}))),used_topics:JSON.stringify(usedTopics)});
  for(let attempt=0;attempt<3;attempt++){
    const ranking=await runner({config,model:config.candidateModel,cwd:path.join(dir,attempt?`rank-retry-${attempt}`:'rank'),schema,signal,reasoningEffort:'medium',prompt:prompt+(attempt?'\n이전 출력은 ID가 중복되거나 누락되어 거부됐어요. 아래 모든 ID를 각각 정확히 한 번만 나열하고 동일 ID를 반복하지 마세요.':'')});
    const selected=[],ranked={general:[],practitioner:[]},seen=new Set();let invalid=false;
    for(const audience of ['general','practitioner']){
      const rows=ranking.response[audience];
      if(!Array.isArray(rows)||rows.length!==checked.filter(c=>c.audience===audience).length){invalid=true;break;}
      for(const row of rows){const c=checked[row.id];if(!c||c.audience!==audience||seen.has(row.id)||typeof row.reason!=='string'){invalid=true;break;}seen.add(row.id);ranked[audience].push({...c,rank:ranked[audience].length+1,rank_reason:row.reason});}
      if(invalid)break;selected.push(...ranked[audience].slice(0,audience==='general'?2:1));
    }
    if(invalid){fs.writeFileSync(path.join(dir,`invalid-rank-${attempt}.json`),JSON.stringify(ranking.response,null,2));continue;}
    const result={candidates:selected,shortageReason:selected.length<3?`확인 가능한 후보 ${selected.length}개만 제공해요. 직접 주제를 제안할 수도 있어요.`:'',poolCounts:{general:ranked.general.length,practitioner:ranked.practitioner.length}};
    fs.writeFileSync(path.join(dir,'ranking.json'),JSON.stringify(ranked,null,2));fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));return result;
  }
  throw fail('CARDS_RANK_INVALID');
}
module.exports={generateRankedCandidates,rankCandidatePool,rankCheckedCandidates,RANK_SCHEMA};

// Regular discovery uses one selection call; legacy ranked runs stay readable.
async function selectCrawlerCandidates({config,items,today,now,cwd,signal,runner=runCodex,usedTopics=[]}) {
  fs.mkdirSync(cwd,{recursive:true});const dir=fs.mkdtempSync(path.join(cwd,'crawler-'));
  fs.writeFileSync(path.join(dir,'collection.json'),JSON.stringify({items,sources:items.collectionReport||[]},null,2));
  if(!items.length)return {candidates:[],shortageReason:'수집 가능한 자료가 없어요. 직접 주제를 제안할 수 있어요.'};
  const schema=JSON.parse(JSON.stringify(CANDIDATE_SCHEMA));
  schema.properties.candidates.items.required.push('selected_id');
  schema.properties.candidates.items.properties.selected_id={type:'integer',enum:items.map(i=>i.id)};
  const packet=items.map(i=>({id:i.id,title:i.title,url:i.url,summary:i.summary.slice(0,300),source:i.source,
    date:i.published_at,date_kind:i.date_kind,news_urls:i.attention.evidence.filter(e=>e.role==='original_news'&&e.url!==i.url).map(e=>e.url),
    hn:i.attention.evidence.filter(e=>e.role==='community_post').map(e=>({url:e.url,metrics:Object.fromEntries(e.metrics.map(m=>[m.name,m.value]))}))}));
  const result=await runner({config,model:config.candidateModel,reasoningEffort:'medium',selectionOnly:true,cwd:dir,signal,schema,
    prompt:promptFor(config.root,'select_crawled_cards',{today,items:JSON.stringify(packet),used_topics:JSON.stringify(usedTopics)})});
  const candidates=(result.response.candidates||[]).map(candidate=>{
    const item=items.find(i=>i.id===candidate.selected_id);if(!item)throw fail('CARDS_CANDIDATE_SOURCE');
    const {selected_id,...value}=candidate;return {...value,anchor_url:item.url,attention:item.attention};
  });
  const known=items.flatMap(i=>[{url:i.url},...i.attention.evidence.map(e=>({url:e.url}))]);
  const checked=validateCandidates({...result.response,candidates},known,now);
  const output={candidates:checked,shortageReason:result.response.shortage_reason,usage:result.usage};
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(output,null,2));return output;
}
module.exports.selectCrawlerCandidates=selectCrawlerCandidates;
