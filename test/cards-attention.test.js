'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {deriveAttention,searchAttention}=require('../lib/cards/attention');
const {createWebService}=require('../lib/web/service');
const {createCardsWorker}=require('../lib/cards/worker');
const NOW=Date.parse('2026-10-10T12:00:00Z')/1000;
const candidate={title:'원래 제목',summary:'원래 요약',attention_query:'New product launch'};
const article={url:'https://news.example.com/story',title:'New product launch',snippet:'Published October 9, 2026. New product launch has 12 comments.',publishedDate:'2026-10-09',original_published_at:'2026-10-09T00:00:00Z',date_kind:'original_publish',content:'New product launch has 12 comments.'};
const proof={url:article.url,role:'original_news',related:true,independent:true,duplicate_group:'article-1',outlet_group:'publisher-1',published_at:'2026-10-09',date_quote:null,quote:'New product launch',metrics:[],reason:'독립 기사예요.'};
function searches(results=[article],status='ok'){return ['news','community','sns'].map(channel=>({candidate_index:0,channel,query:channel,status:channel==='news'?status:'ok',error:status==='ok'?null:'WEB_FAILED',max_results:5,results:channel==='news'?results:[]}));}
function derive(evidence,packet=searches(),status='verified'){return deriveAttention({checks:[{candidate_index:0,status,limits:'전체 웹 총량이 아니에요.',evidence}],candidates:[candidate],searches:packet,now:NOW})[0];}
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cards-attention-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}

test('기사·공식 발표·재배포와 canonical URL/동일 게시글 중복을 구분하고 건수는 서버가 계산한다',()=>{
  const duplicate={...article,url:article.url+'?utm_source=a'};
  const republished={...article,url:'https://other.example.com/reprint'};
  const official={...article,url:'https://vendor.example.com/announcement'};
  const packet=searches([article,duplicate,republished,official]);
  const result=derive([proof,{...proof,url:duplicate.url},{...proof,url:republished.url,role:'syndicated_news',independent:false},{...proof,url:official.url,role:'official',independent:false}],packet);
  assert.deepEqual(result.attention.counts,{news_articles:1,independent_outlets:1,community_posts:0,sns_posts:0});
  assert.equal(result.title,candidate.title);assert.equal(result.summary,candidate.summary);
  assert.deepEqual(result.attention.evidence.map(item=>item.counted),[true,false,false,false]);
  assert.equal(result.attention.count_basis,'confirmed_lower_bound');
});

test('다른 URL에 같은 기사/게시글 그룹을 붙이면 중복 집계하지 않고 같은 호스트 매체 수도 부풀리지 않는다',()=>{
  const second={...article,url:'https://news.example.com/second'},third={...article,url:'https://alias.example.com/reprint'};
  const result=derive([proof,{...proof,url:second.url,duplicate_group:'article-2',outlet_group:'invented-second-name'},{...proof,url:third.url}],searches([article,second,third]));
  assert.equal(result.attention.counts.news_articles,2);assert.equal(result.attention.counts.independent_outlets,1);
  assert.equal(result.attention.evidence[2].exclusion,'duplicate');
});

test('검색 밖 URL·없는 인용·지원 없는 수치는 근거 전체를 제외하고 원문 요약을 바꾸지 않는다',()=>{
  for(const [evidence,code] of [
    [{...proof,url:'https://invented.example.com/fake'},'CARDS_ATTENTION_URL'],
    [{...proof,quote:'없는 관련 문장'},'CARDS_ATTENTION_QUOTE'],
    [{...proof,metrics:[{name:'comments',value:1200,quote:'12 comments'}]},'CARDS_ATTENTION_METRIC'],
    [{...proof,metrics:[{name:'likes',value:12,quote:'12 comments'}]},'CARDS_ATTENTION_METRIC']
  ]){
    const result=derive([evidence]);assert.equal(result.attention.counts.news_articles,0);assert.deepEqual(result.attention.evidence,[]);
    assert.equal(result.attention.rejected_evidence[0].validation_error,code);assert.equal(result.attention.status,'unverified');assert.equal(result.title,candidate.title);
    assert.ok(result.attention.limits.includes('전체 반응이 0이라는 뜻이 아니에요'));
  }
  const mixed={...article,snippet:'12 comments and 30 likes',content:''};
  assert.equal(derive([{...proof,metrics:[{name:'likes',value:12,quote:'12 comments and 30 likes'}]}],searches([mixed])).attention.rejected_evidence[0].validation_error,'CARDS_ATTENTION_METRIC');
  assert.deepEqual(derive([{...proof,metrics:[{name:'comments',value:12,quote:'12 comments'}]}]).attention.evidence[0].metrics,[{name:'comments',value:12,quote:'12 comments'}]);
});

test('HTML 링크 추출 공백만 정규화하고 단어·숫자·문장부호 자체가 다른 인용은 허용하지 않는다',()=>{
  const item={...article,content:'New product launch in Sasovo , Ryazan. 12 comments.'};
  assert.equal(derive([{...proof,quote:'New product launch in Sasovo, Ryazan.'}],searches([item])).attention.counts.news_articles,1);
  assert.equal(derive([{...proof,quote:'New product launch in Sasovo Ryazan.'}],searches([item])).attention.counts.news_articles,0);
  assert.equal(derive([{...proof,quote:'New product launch in Sasovo, Moscow.'}],searches([item])).attention.counts.news_articles,0);
});

test('검색 추정일·오래된 날짜·수정일은 확인 집계에서 제외하고 명시된 원문 날짜만 확인한다',()=>{
  const estimated={...article,date_kind:'unknown',original_published_at:null,snippet:'New product launch',content:''};
  const result=derive([proof],searches([estimated]));assert.equal(result.attention.counts.news_articles,0);assert.equal(result.attention.status,'unverified');
  assert.equal(result.attention.evidence[0].date_confirmed,false);
  assert.equal(derive([{...proof,published_at:'2025-10-09'}]).attention.counts.news_articles,0);
  const modified={...estimated,snippet:'Updated October 9, 2026. New product launch'};
  assert.equal(derive([{...proof,date_quote:'October 9, 2026'}],searches([modified])).attention.counts.news_articles,0);
  assert.equal(derive([{...proof,date_quote:'October 9, 2026'}],searches([{...estimated,snippet:article.snippet}])).attention.counts.news_articles,1);
});

test('성공한 제한 검색의 0건과 실패한 검색의 미확인을 구분하며 실패를 무관심으로 바꾸지 않는다',()=>{
  const empty=derive([],searches([]));assert.equal(empty.attention.counts.news_articles,0);assert.equal(empty.attention.status,'unverified');
  const failed=derive([],searches([],'failed'));assert.equal(failed.attention.counts.news_articles,null);assert.equal(failed.attention.counts.independent_outlets,null);
  assert.equal(failed.attention.searches[0].status,'failed');assert.ok(failed.attention.scope.includes('최소 건수'));
});

test('각 후보마다 세 채널 최대5개만 검색하고 같은 URL 원문은 한 번 읽으며 실패 날짜는 unknown으로 남긴다',async()=>{
  const calls=[],reads=[];
  const web={search:async(query,options)=>{calls.push({query,options});return {results:[article]};}};
  const fetchImpl=async url=>{reads.push(url);return {ok:true,status:200,url,headers:{get:()=>null},text:async()=>'<script type="application/ld+json">{"datePublished":"2026-10-09"}</script><article>New product launch has 12 comments.</article>'};};
  const packet=await searchAttention({candidates:[candidate,candidate,candidate],web,now:NOW,fetchImpl});
  assert.equal(calls.length,9);assert.equal(reads.length,1);assert.ok(calls.every(call=>call.options.maxResults===5&&call.options.timeRange==='week'&&call.options.searchDepth==='basic'));
  assert.equal(packet[0].results[0].date_kind,'original_publish');
  const failed=await searchAttention({candidates:[candidate],web,now:NOW,fetchImpl:async()=>{throw new Error('blocked');}});
  assert.equal(failed[0].results[0].date_kind,'unknown');assert.equal(failed[0].results[0].fetch_status,'failed');
});

test('기존 shared 검색 예산은 그대로 적용하고 한도 초과 뒤 나머지 채널은 미실행으로 남긴다',async()=>{
  let credits=0,requests=0;
  const web=createWebService({enabled:true,apiKey:'test',monthlyCreditSoftLimit:2,getUsage:()=>({credits}),addUsage:(_,value)=>{credits+=value;},fetchImpl:async()=>{requests++;return {ok:true,json:async()=>({results:[]})};}});
  const packet=await searchAttention({candidates:[candidate,candidate,candidate],web,now:NOW});
  assert.equal(credits,2);assert.equal(requests,2);assert.equal(packet.filter(item=>item.status==='ok').length,2);
  assert.equal(packet[2].error,'WEB_MONTHLY_BUDGET_EXHAUSTED');assert.equal(packet[3].status,'not_run');assert.equal(packet.length,9);
});

test('워커는 후보 검증에 기존 web 인스턴스를 전달하고 새 data_json 구조를 그대로 저장한다',async t=>{
  const root=temp(t),web={search:async()=>({results:[]})};let got,stored;
  const store={claimManual:()=>null,usedTopics:()=>[],expireStale(){},claimRun:()=>true,saveBatch:result=>{stored=result;},failRun:(_,error)=>{throw error;},claimUpload:()=>null};
  const worker=createCardsWorker({store,config:{enabled:true,productionEnabled:false,uploadEnabled:false,workRoot:root},web,now:()=>NOW,
    collect:async()=>[],select:async args=>{got=args.web;return {candidates:[derive([])],shortageReason:'자료 부족'};}});
  await worker.tick();assert.equal(got,web);assert.equal(stored.candidates[0].attention.status,'unverified');assert.equal(stored.candidates[0].title,candidate.title);
});
