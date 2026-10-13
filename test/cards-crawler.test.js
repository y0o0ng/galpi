'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {collectCrawlerItems,groupItems,FEEDS}=require('../lib/cards/crawler');
const {selectCrawlerCandidates}=require('../lib/cards/ranked');
const {cardsConfig}=require('../lib/cards/config');
const NOW=Date.parse('2026-10-12T00:00:00Z')/1000;
const item={title:'A concrete useful new app release',url:'https://example.com/release',summary:'기기 안에서 처리해요.',source:'Google',role:'official',published_at:'2026-10-06T00:00:00Z'};
const response=text=>({ok:true,status:200,text:async()=>typeof text==='string'?text:JSON.stringify(text)});
test('수집은 피드 실패를 기록하고 공식 HN API 수치만 집계하며 LLM·Tavily를 기본 호출하지 않는다',async()=>{
 let search=0;
 const xml='<rss><channel><item><title>A concrete useful new app release</title><link>https://example.com/release</link><pubDate>Tue, 06 Oct 2026 00:00:00 GMT</pubDate><description>새 앱</description></item></channel></rss>';
 const fetchImpl=async url=>{
  if(url.includes('algolia'))return response({hits:[{objectID:'1'},{objectID:'2'}]});
  if(url.includes('/item/1.'))return response({id:1,type:'story',time:NOW-60,title:item.title,url:item.url,score:120,descendants:0});
  if(url.includes('/item/2.'))throw new Error('OFFLINE');
  if(url===FEEDS[0].url)throw new Error('FEED_DOWN');return response(xml.replace('</channel>',xml.match(/<item>[\s\S]*?<\/item>/)[0]+'</channel>'));
 };
 const items=await collectCrawlerItems({now:NOW,fetchImpl,web:{search:async()=>{search++;return {results:[]};}}});
 assert.equal(search,0);assert.equal(items.length,1);
 const hn=items[0].attention.evidence.find(e=>e.role==='community_post');assert.deepEqual(hn.metrics,[{name:'points',value:120},{name:'comments',value:0}]);
 assert.equal(items[0].attention.counts.sns_posts,null);assert.equal(items[0].attention.counts.independent_outlets,null);
 assert.ok(items.collectionReport.some(r=>r.error==='FEED_DOWN'));
});
test('URL 변형은 합치지만 제목이 다른 사건의 기사 수·독립성을 추정하지 않는다',()=>{
 const result=groupItems([item,{...item,url:item.url+'?utm_source=x'}, {...item,title:'Other news from the same company',url:'https://example.com/other'}],NOW);
 assert.equal(result.length,2);assert.equal(result[0].attention.evidence.length,1);
 assert.equal(result[0].attention.counts.community_posts,null);
 assert.equal(groupItems([{...item,url:'http://127.0.0.1/private'}],NOW).length,0);
});
test('선택 호출은 한 번·읽기 전용이며 뉴스 출처는 선택 ID로 확정하고 비교의 자료 밖 URL은 거부한다',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cards-crawler-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const items=groupItems([item],NOW),candidate={selected_id:0,same_event:[],title:'새 앱',summary:'기기 안에서 처리해요.',audience:'general',mode:'news',format_reason:'새 앱 소식',reader_question:'무엇을 할 수 있나요?',why_interest:'직접 써볼 수 있어요.',attention_query:'new app',anchor_url:item.url,announced_at:'',sources:[{title:item.title,url:item.url,published_at:null}],compare_targets:[],compare_axes:[],risk:'피드 요약만 확인했어요.'};let calls=0;
 const runner=async args=>{calls++;assert.equal(args.selectionOnly,true);assert.ok(args.prompt.length<10000);return {response:{candidates:[candidate],shortage_reason:'한 개만 확보'},usage:{input_tokens:100}};};
 const result=await selectCrawlerCandidates({config:cardsConfig({}),items,today:'2026-10-12',now:NOW,cwd:root,runner});
 assert.equal(calls,1);assert.deepEqual(result.candidates[0].attention.evidence,items[0].attention.evidence);
 assert.deepEqual(result.candidates[0].attention.grouping,{method:'model_selected_event',anchor_id:0,matches:[]});
 candidate.sources[0].url='https://invented.example/story';
 const recovered=await selectCrawlerCandidates({config:cardsConfig({}),items,today:'2026-10-12',now:NOW,cwd:root,runner});
 assert.deepEqual(recovered.candidates[0].sources,[{title:item.title,url:item.url,published_at:item.published_at}]);
 candidate.mode='compare';candidate.compare_targets=['새 앱','다른 앱'];candidate.compare_axes=['실행 방식','지원 기기'];
 await assert.rejects(selectCrawlerCandidates({config:cardsConfig({}),items,today:'2026-10-12',now:NOW,cwd:root,runner}),{code:'CARDS_CANDIDATE_SOURCE'});
 candidate.selected_id=99;
 await assert.rejects(selectCrawlerCandidates({config:cardsConfig({}),items,today:'2026-10-12',now:NOW,cwd:root,runner}),{code:'CARDS_CANDIDATE_SOURCE'});
 calls=0;await selectCrawlerCandidates({config:cardsConfig({}),items:[],today:'2026-10-12',now:NOW,cwd:root,runner});assert.equal(calls,0);
});

test('선택 CLI는 읽기 전용·검색 비활성이고 제작 기본 권한은 그대로다',async t=>{
 const {runCodex}=require('../lib/cards/runner'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cards-selection-cli-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const selectionOnly of [true,false]) {
  let args;
  const spawn=(_bin,a)=>{args=a;const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
   child.stdin.on('finish',()=>{fs.writeFileSync(a[a.indexOf('-o')+1],JSON.stringify({status:'ok',message:'done'}));child.emit('close',0);});return child;};
  await runCodex({config:{bin:'fake'},model:'test',cwd:root,prompt:'select',spawn,selectionOnly});
  assert.equal(args[args.indexOf('--sandbox')+1],selectionOnly?'read-only':'workspace-write');
  assert.ok(args.includes(`web_search="${selectionOnly?'disabled':'live'}"`));
 }
});

test('선택된 사건의 근거만 합쳐 기사·매체·HN을 집계하고 잘못된 ID·중복 후보는 거부한다',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cards-event-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const news={...item,role:'original_news',source:'News',url:'https://press-a.example/new'};
 const items=groupItems([news,{...news,title:'다른 제목으로 보도한 동일한 앱 출시',url:'https://press-b.example/new'},
  {...news,title:'같은 업체의 별개 제품 출시 소식',url:'https://press-a.example/other'}],NOW);
 const hn={url:'https://news.ycombinator.com/item?id=1',role:'community_post',outlet_group:'Hacker News',published_at:item.published_at,metrics:[{name:'points',value:20},{name:'comments',value:0}]};
 items[0].attention.evidence.push(hn);items[1].attention.evidence.push(hn,{...items[0].attention.evidence[0],url:news.url+'?utm_source=x'});
 const candidate={selected_id:0,same_event:[{id:1,reason:'동일 앱의 같은 출시를 보도해요.'}],title:'새 앱 출시',summary:'동일 사건이에요.',audience:'general',mode:'news',format_reason:'출시 소식',reader_question:'무엇이 바뀌었나요?',why_interest:'새 기능',attention_query:'앱 출시',anchor_url:news.url,announced_at:'',sources:[{title:news.title,url:news.url,published_at:null},{title:items[1].title,url:items[1].url,published_at:null}],compare_targets:[],compare_axes:[],risk:'요약 기준'};
 let rows=[candidate],calls=0;
 const run=()=>selectCrawlerCandidates({config:cardsConfig({}),items,today:'2026-10-12',now:NOW,cwd:root,runner:async()=>{calls++;return {response:{candidates:rows,shortage_reason:'두 후보 미확보'}};}});
 const result=await run(),attention=result.candidates[0].attention;
 assert.equal(calls,1);assert.equal(attention.counts.news_articles,2);assert.equal(attention.observed_outlets,2);
 assert.equal(attention.counts.community_posts,1);assert.equal(attention.counts.independent_outlets,null);
 assert.deepEqual(attention.evidence.find(e=>e.role==='community_post').metrics,hn.metrics);
 assert.equal(items[0].attention.evidence.length,2);assert.ok(!attention.evidence.some(e=>e.url===items[2].url));
 for(const same_event of [[null],[{id:99,reason:'없는 ID'}],[{id:0,reason:'기준 ID 반복'}],[{id:1,reason:' '}],[{id:1,reason:'동일 사건'},{id:1,reason:'중복'}]]){
  rows=[{...candidate,same_event}];await assert.rejects(run(),{code:'CARDS_EVENT_GROUP_INVALID'});
 }
 rows=[{...candidate,same_event:[]}];
 const ungrouped=await run();assert.deepEqual(ungrouped.candidates[0].sources.map(s=>s.url),[news.url]);
 assert.deepEqual(ungrouped.candidates[0].attention.grouping.matches,[]);
 rows=[candidate,{...candidate,selected_id:1,same_event:[],anchor_url:items[1].url}];
 await assert.rejects(run(),{code:'CARDS_CANDIDATE_DUPLICATE'});
});

test('뉴스의 출처 목록 불일치는 사건 묶음으로 해결하고 기준 자료 우선 최대 6개만 전달한다',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cards-source-group-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const items=groupItems(Array.from({length:8},(_,i)=>({...item,title:'서로 다른 제목의 기사 '+i,url:`https://press-${i}.example/event`,role:'original_news',date_kind:i===1?'naver_provided':i===2?'submission':'feed'})),NOW);
 const candidate={selected_id:0,same_event:items.slice(1,7).map(i=>({id:i.id,reason:'같은 사건의 기사'})),title:'새 앱',summary:'확인된 소식',audience:'general',mode:'news',format_reason:'새 앱 소식',reader_question:'무엇이 달라졌나요?',why_interest:'새 기능',attention_query:'new app',anchor_url:'https://invented.example/anchor',announced_at:'',sources:[{title:'묶음에서 빠진 출처',url:items[7].url,published_at:'2099-01-01'}],compare_targets:[],compare_axes:[],risk:'요약 기준'};
 let calls=0;const result=await selectCrawlerCandidates({config:cardsConfig({}),items,today:'2026-10-12',now:NOW,cwd:root,runner:async()=>{calls++;return {response:{candidates:[candidate],shortage_reason:'한 개만 확보'}};}});
 const saved=result.candidates[0];assert.equal(calls,1);assert.equal(saved.anchor_url,items[0].url);
 assert.deepEqual(saved.sources.map(s=>s.url),items.slice(0,6).map(i=>i.url));
 assert.equal(saved.sources[0].title,items[0].title);assert.equal(saved.sources[0].published_at,item.published_at);
 assert.equal(saved.sources[1].published_at,null);assert.equal(saved.sources[2].published_at,null);
 assert.equal(saved.attention.counts.news_articles,7);assert.ok(!saved.attention.evidence.some(e=>e.url===items[7].url));
 assert.equal(candidate.sources[0].url,items[7].url);
});

test('모든 소스 접근 실패를 후보 없음으로 숨기지 않는다',async()=>{
 await assert.rejects(collectCrawlerItems({now:NOW,fetchImpl:async()=>{throw new Error('OFFLINE');}}),{code:'CARDS_COLLECTION_FAILED'});
});

test('네이버는 원문 URL·최근 제공 날짜만 수집하고 검색 전체 건수를 반응 수치로 쓰지 않는다',async()=>{
 let calls=0;
 const config=cardsConfig({NAVER_CLIENT_ID:'test-id',NAVER_CLIENT_SECRET:'test-secret'});
 const items=await collectCrawlerItems({now:NOW,config,fetchImpl:async(url,options)=>{
  if(!url.startsWith('https://naverapihub.apigw.ntruss.com/')){assert.equal(options.headers,undefined);throw new Error('OFFLINE');}
  calls++;assert.equal(options.headers['X-NCP-APIGW-API-KEY'],'test-secret');
  assert.equal(new URL(url).searchParams.get('sort'),'date');
  return response({total:999999,items:[
   {title:'새로운 <b>AI</b> 앱 &quot;출시&quot;',originallink:'https://example.kr/new',link:'https://n.news.naver.com/new',description:'<b>새</b> 기능',pubDate:'Sun, 11 Oct 2026 10:00:00 +0900'},
   {title:'오래된 기사',originallink:'https://example.kr/old',pubDate:'Sun, 01 Feb 2026 10:00:00 +0900'},
   {title:'잘못된 날짜',originallink:'https://example.kr/invalid',pubDate:'bad'},
  ]});
 }});
 assert.equal(calls,6);assert.equal(items.length,1);assert.equal(items[0].url,'https://example.kr/new');
 assert.equal(items[0].title,'새로운 AI 앱 "출시"');assert.equal(items[0].date_kind,'naver_provided');
 assert.equal(items[0].attention.counts.news_articles,1);assert.equal(items[0].attention.observed_outlets,1);
 assert.equal(items.collectionReport.filter(r=>r.source==='Naver News'&&r.count===1).length,6);
});

test('네이버 인증 리다이렉트는 키를 전달하지 않고 실패로 기록한다',async()=>{
 let requests=0;
 await assert.rejects(collectCrawlerItems({now:NOW,config:{naverClientId:'id',naverClientSecret:'secret'},fetchImpl:async url=>{
  if(!url.startsWith('https://naverapihub.apigw.ntruss.com/'))throw new Error('OFFLINE');
  requests++;return {ok:false,status:302,headers:{get:()=> 'https://other.example/steal'}};
 }}),{code:'CARDS_COLLECTION_FAILED'});
 assert.equal(requests,6);
});
