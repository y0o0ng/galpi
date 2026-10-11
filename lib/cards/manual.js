'use strict';
const fs=require('node:fs'),path=require('node:path');
const {CANDIDATE_SCHEMA,validateCandidates}=require('./candidates');
const {runCodex,promptFor,fail}=require('./runner');
const SCHEMA={type:'object',additionalProperties:false,required:['verdict','feedback','candidates','checks'],properties:{
  verdict:{type:'string',enum:['ready','needs_revision']},feedback:{type:'string',maxLength:3000},candidates:{...CANDIDATE_SCHEMA.properties.candidates,maxItems:1},
  checks:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,required:['claim','url','quote'],properties:{claim:{type:'string',maxLength:500},url:{type:'string',maxLength:2000},quote:{type:'string',maxLength:500}}}}}};
async function reviewManualTopic({dialogue,config,web,today,now,cwd,signal,runner=runCodex}){
  fs.mkdirSync(cwd,{recursive:true});const user=dialogue.messages.filter(m=>m.role==='user');
  const query=(user[0].text+' '+user.at(-1).text).replace(/\s+/g,' ').slice(0,180),items=[],searches=[];
  for(const q of [query,query+' 공식 원문 official source']){
    try{const r=await web.search(q,{topic:'general',searchDepth:'basic',maxResults:5});searches.push({query:q,status:'ok',results:r.results});items.push(...r.results);}catch(error){searches.push({query:q,error:error.code||'WEB_FAILED'});}
  }
  const unique=[...new Map(items.map(i=>[i.url,i])).values()];
  for(const item of unique.slice(0,4)){try{const r=await web.fetch(item.url,{query});item.content=r.content.slice(0,12000);}catch(error){item.fetch_error=error.code||'WEB_FAILED';}}
  fs.writeFileSync(path.join(cwd,'sources.json'),JSON.stringify({searches,items:unique},null,2));
  const result=await runner({config,model:config.candidateModel,reasoningEffort:'medium',cwd,signal,schema:SCHEMA,prompt:promptFor(config.root,'manual_topic_cards',{today,messages:JSON.stringify(dialogue.messages),items:JSON.stringify(unique)})});
  const value=result.response;
  if(!value.feedback?.trim()||!['ready','needs_revision'].includes(value.verdict))throw fail('CARDS_TOPIC_REVIEW_INVALID');
  if(value.verdict==='needs_revision')return {feedback:value.feedback,candidate:null};
  if(value.candidates?.length!==1||!value.checks?.length)throw fail('CARDS_TOPIC_REVIEW_INVALID');
  const candidate=value.candidates[0];validateCandidates({candidates:[candidate],shortage_reason:'사람 제안 단일 후보'},unique,now,{quota:{general:1,practitioner:1}});
  const norm=t=>String(t||'').replace(/\s+/g,' ').trim();
  for(const check of value.checks){const item=unique.find(i=>i.url===check.url);if(!item||!check.claim.trim()||!check.quote.trim()||!norm((item.title||'')+' '+(item.snippet||'')+' '+(item.content||'')).includes(norm(check.quote)))throw fail('CARDS_TOPIC_SOURCE_INVALID');}
  if(!value.checks.some(c=>c.url===candidate.anchor_url))throw fail('CARDS_TOPIC_SOURCE_INVALID');
  fs.writeFileSync(path.join(cwd,'checks.json'),JSON.stringify(value.checks,null,2));
  return {feedback:value.feedback,candidate};
}
module.exports={reviewManualTopic};
