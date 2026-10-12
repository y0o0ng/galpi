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
test('선택 호출은 정확히 한 번·읽기 전용이며 수집 근거는 서버가 붙이고 자료 밖 URL은 거부한다',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cards-crawler-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const items=groupItems([item],NOW),candidate={selected_id:0,title:'새 앱',summary:'기기 안에서 처리해요.',audience:'general',mode:'news',format_reason:'새 앱 소식',reader_question:'무엇을 할 수 있나요?',why_interest:'직접 써볼 수 있어요.',attention_query:'new app',anchor_url:item.url,announced_at:'',sources:[{title:item.title,url:item.url,published_at:null}],compare_targets:[],compare_axes:[],risk:'피드 요약만 확인했어요.'};let calls=0;
 const runner=async args=>{calls++;assert.equal(args.selectionOnly,true);assert.ok(args.prompt.length<10000);return {response:{candidates:[candidate],shortage_reason:'한 개만 확보'},usage:{input_tokens:100}};};
 const result=await selectCrawlerCandidates({config:cardsConfig({}),items,today:'2026-10-12',now:NOW,cwd:root,runner});
 assert.equal(calls,1);assert.deepEqual(result.candidates[0].attention,items[0].attention);
 candidate.sources[0].url='https://invented.example/story';
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

test('모든 소스 접근 실패를 후보 없음으로 숨기지 않는다',async()=>{
 await assert.rejects(collectCrawlerItems({now:NOW,fetchImpl:async()=>{throw new Error('OFFLINE');}}),{code:'CARDS_COLLECTION_FAILED'});
});
