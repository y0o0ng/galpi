'use strict';
const fs=require('node:fs'),path=require('node:path');
const {canonicalizeUrl}=require('../news/normalize');
const {normalizePublicWebUrl}=require('../web/service');
const {fail,promptFor}=require('./runner');
const WEEK=7*86400;
const str=max=>({type:'string',maxLength:max}), nullable=max=>({type:['string','null'],maxLength:max});
const ROLES=['original_news','syndicated_news','official','community_post','sns_post','other','unknown'];
const METRICS=['comments','upvotes','points','likes','reposts','views'];
const evidenceFields={url:str(2000),role:{type:'string',enum:ROLES},related:{type:'boolean'},independent:{type:'boolean'},duplicate_group:str(200),outlet_group:str(200),
  published_at:nullable(40),date_quote:nullable(200),quote:str(1000),reason:str(700),metrics:{type:'array',maxItems:6,items:{type:'object',additionalProperties:false,required:['name','value','quote'],properties:{name:{type:'string',enum:METRICS},value:{type:'integer',minimum:0},quote:str(500)}}}};
const checkFields={candidate_index:{type:'integer',minimum:0,maximum:2},status:{type:'string',enum:['verified','weak','unverified']},limits:str(1000),evidence:{type:'array',maxItems:15,items:{type:'object',additionalProperties:false,required:Object.keys(evidenceFields),properties:evidenceFields}}};
const ATTENTION_SCHEMA={type:'object',additionalProperties:false,required:['checks'],properties:{checks:{type:'array',maxItems:3,items:{type:'object',additionalProperties:false,required:Object.keys(checkFields),properties:checkFields}}}};
const CHANNELS=[['news',''],['community',' (site:news.ycombinator.com/item OR site:reddit.com/r/)'],['sns',' (site:x.com OR site:twitter.com OR site:bsky.app OR site:threads.net)']];
function publication(raw) {
  const dates=[...raw.matchAll(/"datePublished"\s*:\s*"([^"<>]+)"/gi)].map(match=>({value:match[1],quote:match[0]}));
  for(const tag of raw.match(/<meta\b[^>]*>/gi)||[])if(/(?:article:published_time|datePublished|pubdate|publishdate)/i.test(tag)){
    const value=/\bcontent\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];if(value)dates.unshift({value,quote:tag});
  }
  const found=dates.find(item=>Number.isFinite(Date.parse(item.value)));
  return found?{original_published_at:new Date(Date.parse(found.value)).toISOString(),publication_quote:found.quote,date_kind:'original_publish'}:{original_published_at:null,publication_quote:null,date_kind:'unknown'};
}
async function readOriginal(url,fetchImpl) {
  try {
    let current=normalizePublicWebUrl(url),response;const signal=AbortSignal.timeout(15000);
    for(let i=0;i<5;i++){
      normalizePublicWebUrl(current);response=await fetchImpl(current,{signal,redirect:'manual'});
      if(response.status<300||response.status>=400||!response.headers?.get('location'))break;
      current=new URL(response.headers.get('location'),current).href;
    }
    if(!response.ok)return {fetch_status:'failed',fetch_error:'HTTP_'+response.status,content:'',...publication('')};
    normalizePublicWebUrl(response.url||current);let raw='';
    if(response.body?.getReader){const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0;try{while(bytes<1000000){const next=await reader.read();if(next.done)break;bytes+=next.value.length;raw+=decoder.decode(next.value,{stream:true});}}finally{await reader.cancel();}}
    else raw=await response.text();
    raw=raw.slice(0,1000000);
    const content=(/<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/i.exec(raw)?.[1]||raw).replace(/<(?:script|style)\b[\s\S]*?<\/(?:script|style)>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,6000);
    return {fetch_status:'ok',fetch_error:null,page_url:response.url||current,content,...publication(raw)};
  }catch(error){return {fetch_status:'failed',fetch_error:error.code||error.name,content:'',...publication('')};}
}
async function searchAttention({candidates,web,now,fetchImpl=fetch,signal}) {
  const searches=[];let budgetStopped=false;
  // Sequential requests retain the web service's shared budget and cache accounting.
  for(let index=0;index<candidates.length;index++)for(const [channel,suffix] of CHANNELS){
    if(signal?.aborted)throw fail('CARDS_ABORTED');
    const query=candidates[index].attention_query+suffix;
    const entry={candidate_index:index,channel,query,max_results:5,time_range:'week',search_depth:'basic',checked_at:new Date(now*1000).toISOString()};
    if(budgetStopped){searches.push({...entry,status:'not_run',error:'WEB_MONTHLY_BUDGET_EXHAUSTED',results:[]});continue;}
    try{
      if(!web?.search)throw fail('WEB_SEARCH_UNAVAILABLE');
      const result=await web.search(query,{topic:channel==='news'?'news':'general',timeRange:'week',searchDepth:'basic',maxResults:5});
      const results=(result.results||[]).slice(0,5).map(item=>{normalizePublicWebUrl(item.url);return {...item};});
      searches.push({...entry,status:'ok',error:null,cached:!!result.cached,credits:result.credits??null,charged_credits:result.cached?0:result.credits??null,retrieved_at:result.retrievedAt||entry.checked_at,results});
    }catch(error){if(error.code==='WEB_MONTHLY_BUDGET_EXHAUSTED')budgetStopped=true;searches.push({...entry,status:'failed',error:error.code||'WEB_SEARCH_FAILED',results:[]});}
  }
  const originals=new Map();
  for(const search of searches)for(const item of search.results)originals.set(canonicalizeUrl(item.url),item.url);
  const pages=new Map(await Promise.all([...originals].map(async([canonical,url])=>[canonical,await readOriginal(url,fetchImpl)])));
  for(const search of searches)search.results=search.results.map(item=>({...item,...pages.get(canonicalizeUrl(item.url))}));
  if(signal?.aborted)throw fail('CARDS_ABORTED');
  return searches;
}
const normalizedQuote=value=>String(value||'').replace(/\s+/g,' ').replace(/\s+([,.;:!?])/g,'$1').trim();
const metricLabels={comments:/comments?|댓글/i,upvotes:/upvotes?|추천/i,points:/points?|점수/i,likes:/likes?|좋아요/i,reposts:/reposts?|retweets?|재게시|리트윗/i,views:/views?|조회/i};
function dateConfirmed(evidence,item,now){
  const timestamp=Date.parse(evidence.published_at)/1000;
  if(!Number.isFinite(timestamp)||timestamp<now-WEEK||timestamp>now+60)return false;
  const day=new Date(timestamp*1000).toISOString().slice(0,10);
  if(item.date_kind==='original_publish'&&item.original_published_at?.slice(0,10)===day)return true;
  // Search-provider publishedDate alone is estimated, never original-post confirmation.
  if(!evidence.date_quote)return false;
  const text=`${item.title||''}\n${item.snippet||''}\n${item.content||''}`,position=text.indexOf(evidence.date_quote);
  if(position<0||/updated|modified|수정|크롤링/i.test(text.slice(Math.max(0,position-35),position+evidence.date_quote.length)))return false;
  const literal=/\d{4}-\d{2}-\d{2}|[A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4}/.exec(evidence.date_quote)?.[0];
  const literalTime=literal ? Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(literal)?literal:literal+' UTC') : NaN;
  return Number.isFinite(literalTime)&&new Date(literalTime).toISOString().slice(0,10)===day;
}
function deriveAttention({checks,candidates,searches,now}){
  if(!Array.isArray(checks)||checks.length!==candidates.length)throw fail('CARDS_ATTENTION_CHECKS');
  const seenChecks=new Set();
  return candidates.map((candidate,index)=>{
    const check=checks.find(item=>item.candidate_index===index);
    if(!check||seenChecks.has(check.candidate_index)||!['verified','weak','unverified'].includes(check.status)||!Array.isArray(check.evidence)||check.evidence.length>15)throw fail('CARDS_ATTENTION_CHECKS');
    seenChecks.add(check.candidate_index);
    const searched=searches.filter(item=>item.candidate_index===index),known=new Map();
    for(const search of searched)for(const item of search.results)known.set(canonicalizeUrl(item.url),item);
    const rejected=[];
    const counts={news_articles:0,independent_outlets:0,community_posts:0,sns_posts:0},seenUrls=new Set(),seenGroups=new Set(),outlets=new Set(),publisherGroups=new Map();
    const evidence=check.evidence.map(raw=>{
      const key=canonicalizeUrl(raw.url),item=known.get(key);
      let invalid=!item?'CARDS_ATTENTION_URL':!ROLES.includes(raw.role)||!Array.isArray(raw.metrics)?'CARDS_ATTENTION_FORMAT':null;
      if(invalid){let url=null;try{url=normalizePublicWebUrl(raw.url);}catch{}rejected.push({url,validation_error:invalid,counted:false});return null;}
      const text=`${item.title||''}\n${item.snippet||''}\n${item.content||''}`;
      if(raw.related&&(!raw.quote?.trim()||!normalizedQuote(text).includes(normalizedQuote(raw.quote))))invalid='CARDS_ATTENTION_QUOTE';
      const metricNames=new Set();
      for(const metric of raw.metrics){
        const normalized=metric.quote?.replace(/,/g,'');
        const number=`(?<![\\d.])${metric.value}(?![\\d.])`,label=metricLabels[metric.name]?.source;
        const adjacent=label&&new RegExp(`(?:${number}\\s*(?:개(?:의)?\\s*)?(?:${label})|(?:${label})\\s*(?:count\\s*)?[:：]?\\s*${number})`,'i').test(normalized);
        if(!METRICS.includes(metric.name)||metricNames.has(metric.name)||!Number.isSafeInteger(metric.value)||metric.value<0||!metric.quote||!normalizedQuote(text).includes(normalizedQuote(metric.quote))
          ||!adjacent)invalid='CARDS_ATTENTION_METRIC';
        metricNames.add(metric.name);
      }
      if(invalid){rejected.push({url:item.url,validation_error:invalid,counted:false});return null;}
      const confirmedDate=dateConfirmed(raw,item,now),group=raw.duplicate_group?.trim()||key;
      const eligible=raw.related&&confirmedDate&&(raw.role==='original_news'&&raw.independent||['community_post','sns_post'].includes(raw.role));
      const counted=!!eligible&&!seenUrls.has(key)&&!seenGroups.has(group);
      if(counted){
        seenUrls.add(key);seenGroups.add(group);
        if(raw.role==='original_news'){
          counts.news_articles++;const host=new URL(item.url).hostname.replace(/^www\./,'');
          if(!publisherGroups.has(host))publisherGroups.set(host,raw.outlet_group?.trim().toLowerCase()||host);
          outlets.add(publisherGroups.get(host));
        }else counts[raw.role==='community_post'?'community_posts':'sns_posts']++;
      }
      return {...raw,url:item.url,date_confirmed:confirmedDate,counted,metrics_status:raw.metrics.length?'confirmed':'unknown',exclusion:counted?null:!raw.related?'unrelated':!confirmedDate?'date_unknown_or_outside_window':!eligible?'not_independent_or_not_a_post':'duplicate'};
    }).filter(Boolean);
    counts.independent_outlets=outlets.size;
    for(const [channel,key] of [['news','news_articles'],['community','community_posts'],['sns','sns_posts']])if(!searched.some(item=>item.channel===channel&&item.status==='ok')&&counts[key]===0){counts[key]=null;if(channel==='news')counts.independent_outlets=null;}
    const confirmed=Object.values(counts).some(value=>value>0);
    return {...candidate,attention:{status:confirmed?check.status:'unverified',model_status:check.status,counts,count_basis:'confirmed_lower_bound',evidence,rejected_evidence:rejected,
      searches:searched.map(({results,...metadata})=>({...metadata,result_count:results.length})),checked_at:new Date(now*1000).toISOString(),limits:check.limits+(rejected.length?`\n서버 URL·인용·지표 대조에서 ${rejected.length}개 근거를 제외했어요 (${[...new Set(rejected.map(item=>item.validation_error))].join(', ')}). 제외·접근 실패는 전체 반응이 0이라는 뜻이 아니에요.`:''),
      scope:'이번 후보별 뉴스·커뮤니티·SNS 각 1회, 최대 5개 검색 결과에서 확인한 최소 건수예요. 전체 웹 총량이나 인기 점수가 아니에요.'}};
  });
}
async function verifyAttention({config,candidates,today,now,cwd,web,runner,signal,fetchImpl}){
  const searches=await searchAttention({candidates,web,now,fetchImpl,signal});
  fs.writeFileSync(path.join(cwd,'attention-searches.json'),JSON.stringify(searches,null,2));
  const schema=JSON.parse(JSON.stringify(ATTENTION_SCHEMA));
  schema.properties.checks.minItems=candidates.length;schema.properties.checks.maxItems=candidates.length;
  schema.properties.checks.items.properties.candidate_index.maximum=candidates.length-1;
  const result=await runner({config,model:config.candidateModel,reasoningEffort:'medium',cwd:path.join(cwd,'attention-agent'),signal,schema,
    prompt:promptFor(config.root,'verify_attention_cards',{today,candidates:JSON.stringify(candidates),searches:JSON.stringify(searches)})+`\n서버 확정: checks는 정확히 ${candidates.length}개이고 candidate_index ${candidates.map((_,i)=>i).join(', ')}를 각각 한 번씩 모두 포함해요. 근거가 없거나 weak/unverified인 후보도 항목을 생략하지 않아요.\n`});
  fs.writeFileSync(path.join(cwd,'attention-model.json'),JSON.stringify(result.response,null,2));
  return {candidates:deriveAttention({checks:result.response.checks,candidates,searches,now}),usage:result.usage};
}
module.exports={ATTENTION_SCHEMA,searchAttention,deriveAttention,verifyAttention};
