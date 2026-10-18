'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Database=require('better-sqlite3');
const {migrations}=require('../lib/database-migrations');
const {createCardsStore}=require('../lib/cards/store');
const {createCardsWorker}=require('../lib/cards/worker');
const {createCardsPushService,buildCardsPushPayload}=require('../lib/cards/push');
const {registerCardsRoutes}=require('../lib/cards/routes');
const {validateCandidates,collectCardsItems,generateCandidates}=require('../lib/cards/candidates');
const {cardsConfig}=require('../lib/cards/config');
const {parseVisual,produceCard,verifySnapshot,checkFacts}=require('../lib/cards/production');
const {createInstagramUploader}=require('../lib/reels/instagram');
const NOW=Date.parse('2026-10-10T10:00:00Z')/1000;
const URL='https://example.com/release';
const item={url:URL,announced_at:'2026-10-06T00:00:00Z',date_kind:'original_publish'};
const candidate={title:'새 기술',summary:'발표 내용',audience:'general',attention_query:'New technology release',mode:'news',format_reason:'발표를 설명해요.',reader_question:'무엇이 달라졌나요?',why_interest:'도구가 바뀌어요.',risk:'회사 발표예요.',anchor_url:URL,announced_at:'2026-10-06',sources:[{title:'공식 발표',url:URL,published_at:'2026-10-06'}],compare_targets:[],compare_axes:[]};
function setup(t){
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');
  db.exec('CREATE TABLE assistant_push_subscriptions(id INTEGER PRIMARY KEY,status TEXT,endpoint TEXT,p256dh TEXT,auth TEXT,failure_count INTEGER DEFAULT 0,last_success_at INTEGER,updated_at INTEGER)');
  db.exec("CREATE TABLE app_settings(key TEXT PRIMARY KEY,value_json TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,updated_at INTEGER)");
  migrations.find(m=>m.version===43).up(db);t.after(()=>db.close());
  let clock=NOW;const store=createCardsStore(db,{now:()=>clock});
  return {db,store,now:()=>clock,setTime:value=>{clock=value;}};
}
function save(store){assert.equal(store.claimRun('2026-10-10'),true);store.saveBatch({day:'2026-10-10',candidates:[candidate],shortageReason:'검증용 단일 후보'});return store.latestBatch().cards[0].id;}
function temp(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'cards-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}

test('후보 초안·화제성 검증은 Luna medium, 제작·검토는 6.1이다',async t=>{
  const config=cardsConfig({CARDS_SCRIPT_MODEL:'gpt-6.1-sol'}),calls=[];
  const result=await generateCandidates({config,items:[item],today:'2026-10-10',now:NOW,cwd:temp(t),collect:async()=>[],web:{search:async()=>({results:[]})},runner:async args=>{
    calls.push([args.model,args.reasoningEffort]);return {response:args.cwd.endsWith('attention-agent')?{checks:[{candidate_index:0,status:'unverified',limits:'이번 검색에서 확인하지 못했어요.',evidence:[]}]}:{candidates:[candidate],shortage_reason:'검증용 단일 후보'},usage:{}};
  }});
  assert.deepEqual(calls,[['gpt-6-luna','medium'],['gpt-6-luna','medium']]);assert.deepEqual(result.candidates,[]);assert.match(result.shortageReason,/화제성 근거 부족 후보 1개/);
  assert.equal(config.scriptModel,'gpt-6.1-sol');assert.equal(config.reviewModel,'gpt-6.1-sol');assert.equal(config.buildModel,'gpt-6.1-sol');assert.equal(config.buildReasoningEffort,'medium');
});

test('화제성 verified만 선택 목록에 남기고 weak·unverified는 원본과 제외 이유를 보존한다',async t=>{
  for(const status of ['verified','weak','unverified']){
    const cwd=temp(t),config=cardsConfig({});
    const proof={url:URL,role:'original_news',related:true,independent:true,duplicate_group:'one',outlet_group:'example',published_at:'2026-10-06',date_quote:'2026-10-06',quote:'New release',metrics:[],reason:'관련 기사예요.'};
    const result=await generateCandidates({config,items:[item],today:'2026-10-10',now:NOW,cwd,collect:async()=>[],
      web:{search:async()=>({results:[{url:URL,title:'New release',snippet:'Published 2026-10-06'}]})},
      fetchImpl:async()=>({ok:true,status:200,text:async()=>'<article>New release</article><script>{"datePublished":"2026-10-06"}</script>'}),
      runner:async args=>({response:args.cwd.endsWith('attention-agent')?{checks:[{candidate_index:0,status,limits:'제한된 검색이에요.',evidence:[proof]}]}:{candidates:[candidate],shortage_reason:'단일 후보'},usage:{}})});
    const saved=JSON.parse(fs.readFileSync(path.join(cwd,'candidates.json'),'utf8'));
    assert.equal(result.candidates.length,status==='verified'?1:0);
    assert.equal(saved.excluded_candidates.length,status==='verified'?0:1);
    const retained=(status==='verified'?saved.candidates:saved.excluded_candidates)[0];
    assert.equal(retained.title,candidate.title);assert.equal(retained.attention.status,status);
    if(status!=='verified')assert.match(result.shortageReason,/화제성 근거 부족 후보 1개/);
  }
});

function retryCandidates(t,{batches,statuses={},initialCount=12,fresh=[],budget=null}={}){
  const cwd=temp(t),config=cardsConfig({}),calls=[],searchCalls=[],collectCalls=[];let draft=[],credits=0,stage=0;
  const make=(id,audience=id%3===2?'practitioner':'general')=>({...candidate,title:`기술 ${id}`,audience,anchor_url:URL+'/'+id,attention_query:`Technology release ${id}`,sources:[{...candidate.sources[0],url:URL+'/'+id}]});
  const all=Array.from({length:20},(_,id)=>make(id));
  const items=all.slice(0,initialCount).map(c=>({...item,url:c.anchor_url}));
  const fetchImpl=async url=>({ok:true,status:200,url,headers:{get:()=>null},text:async()=>'<article>New release</article><script>{"datePublished":"2026-10-06"}</script>'});
  const web={search:async(query,options)=>{searchCalls.push({query,options});credits++;return {credits:1,results:draft.map(c=>({url:c.anchor_url,title:'New release',snippet:'Published 2026-10-06'}))};}};
  if(budget!==null){web.getUsage=()=>({credits});web.softLimit=budget;}
  const run=()=>generateCandidates({config,items,today:'2026-10-10',now:NOW,cwd,web,fetchImpl,
    collect:async args=>{collectCalls.push(args);return fresh.map(id=>({...item,url:all[id].anchor_url}));},
    runner:async args=>{
      calls.push(args);
      if(args.cwd.endsWith('attention-agent'))return {response:{checks:draft.map((c,index)=>({candidate_index:index,status:statuses[c.anchor_url]||'verified',limits:'한정 검색이에요.',evidence:[{
        url:c.anchor_url,role:'original_news',related:true,independent:true,duplicate_group:c.anchor_url,outlet_group:'example',published_at:'2026-10-06',date_quote:null,quote:'New release',metrics:[],reason:'관련 기사예요.'}]}))},usage:{input_tokens:1}};
      draft=batches[stage++].map(value=>typeof value==='number'?all[value]:value);
      return {response:{candidates:draft,shortage_reason:draft.length<args.schema.properties.candidates.maxItems?'이번 자료의 후보가 부족해요.':''},usage:{input_tokens:1}};
    }});
  return {cwd,all,web,calls,searchCalls,collectCalls,run};
}

test('확인된 후보를 유지하고 남은 audience만 독립 재탐색해 2+1을 채우면 즉시 멈춘다',async t=>{
  const job=retryCandidates(t,{batches:[[0,1,2],[3]],statuses:{[URL+'/1']:'weak'}}),result=await job.run();
  assert.deepEqual(result.candidates.map(c=>c.anchor_url),[URL+'/0',URL+'/3',URL+'/2']);assert.equal(result.shortageReason,'');
  assert.equal(job.calls.length,4);assert.equal(new Set(job.calls.map(c=>c.cwd)).size,4);
  const retry=job.calls[2];assert.equal(retry.schema.properties.candidates.maxItems,1);assert.deepEqual(retry.schema.properties.candidates.items.properties.audience.enum,['general']);
  assert.ok(retry.prompt.includes('"general":1,"practitioner":0'));assert.ok(retry.prompt.includes(URL+'/1'));assert.ok(retry.prompt.includes(URL+'/0'));
  assert.ok(job.calls.every(c=>c.model==='gpt-6-luna'&&c.reasoningEffort==='medium'));assert.equal(job.collectCalls.length,0);
  const saved=JSON.parse(fs.readFileSync(path.join(job.cwd,'candidates.json')));assert.equal(saved.attempts.length,2);assert.equal(saved.excluded_candidates.length,1);
  for(const attempt of saved.attempts)for(const file of ['items.json','candidates-draft.json','attention-model.json','attention-searches.json','candidates.json'])assert.ok(fs.existsSync(path.join(attempt.cwd,file)));
});

test('최초 원문 풀이 소진되면 기존 수집기로 새 자료를 확보해 빈 슬롯만 채운다',async t=>{
  const job=retryCandidates(t,{batches:[[0,1,2],[3]],initialCount:3,fresh:[3],statuses:{[URL+'/1']:'unverified'}}),result=await job.run();
  assert.equal(result.candidates.length,3);assert.equal(job.collectCalls.length,1);assert.equal(job.collectCalls[0].web,job.web);
  const attempts=JSON.parse(fs.readFileSync(path.join(job.cwd,'attempts.json')));assert.equal(attempts[1].refreshed_collection,true);assert.ok(fs.existsSync(path.join(attempts[1].cwd,'collection.json')));
});

test('최초+세 번 모두 확인 실패면 네 라운드에서 멈추고 통과분만 반환한다',async t=>{
  const statuses=Object.fromEntries(Array.from({length:12},(_,i)=>[URL+'/'+i,'weak']));
  const job=retryCandidates(t,{batches:[[0,1,2],[3,4,5],[6,7,8],[9,10,11]],statuses}),result=await job.run();
  assert.deepEqual(result.candidates,[]);assert.equal(job.calls.length,8);assert.match(result.shortageReason,/최대 3회 재탐색/);
  const saved=JSON.parse(fs.readFileSync(path.join(job.cwd,'candidates.json')));assert.equal(saved.attempts.length,4);assert.equal(saved.excluded_candidates.length,12);
  assert.equal(new Set(saved.attempts.map(a=>a.cwd)).size,4);
});

test('검색 예산 소진은 이미 통과한 후보를 유지하고 추가 수집·모델 호출 없이 종료한다',async t=>{
  const job=retryCandidates(t,{batches:[[0,1,2]],budget:9,statuses:{[URL+'/1']:'weak',[URL+'/2']:'unverified'}}),result=await job.run();
  assert.deepEqual(result.candidates.map(c=>c.anchor_url),[URL+'/0']);assert.match(result.shortageReason,/검색 예산이 소진/);
  assert.equal(job.calls.length,2);assert.equal(job.searchCalls.length,9);assert.equal(job.collectCalls.length,0);
});

test('새 원문도 없으면 같은 anchor를 재호출하지 않고 부족 이유와 통과분만 남긴다',async t=>{
  const job=retryCandidates(t,{batches:[[0,1,2]],initialCount:3,statuses:{[URL+'/1']:'weak'}}),result=await job.run();
  assert.equal(result.candidates.length,2);assert.equal(job.calls.length,2);assert.equal(job.collectCalls.length,1);assert.match(result.shortageReason,/원문을 확보하지 못/);
});

test('금지 anchor의 추적 URL 변형이나 초과 quota는 validation fail로 끝내고 통과 원본을 보존한다',async t=>{
  for(const kind of ['duplicate','quota']){
    const job=retryCandidates(t,{batches:[[0,1,2],[]],statuses:{[URL+'/1']:'weak'}});
    // 두 번째 새 세션만 계약을 어기는 응답을 반환하도록 fixture의 배열을 바꾼다.
    const batches=kind==='duplicate'?[[0,1,2],[{...job.all[0],anchor_url:job.all[0].anchor_url+'?utm_source=repeat'}]]:[[0,1,2],[3,4]];
    const bad=retryCandidates(t,{batches,statuses:{[URL+'/1']:'weak'}});
    await assert.rejects(bad.run(),{code:kind==='duplicate'?'CARDS_CANDIDATE_DUPLICATE':'CARDS_CANDIDATES_INVALID'});
    assert.equal(bad.calls.length,3);const saved=JSON.parse(fs.readFileSync(path.join(bad.cwd,'candidates.json')));assert.equal(saved.candidates.length,2);
    assert.equal(saved.attempts.at(-1).status,'failed');assert.ok(fs.existsSync(path.join(saved.attempts.at(-1).cwd,'candidates-draft.json')));
  }
});

test('입력 자료 밖 출처 초안은 통과분을 유지하고 남은 횟수 안에서 재탐색한다',async t=>{
  const invalid={...candidate,anchor_url:URL+'/3',sources:[{title:'미수집 출처',url:'https://example.com/not-collected',published_at:null}]};
  const job=retryCandidates(t,{batches:[[0,1,2],[invalid],[3]],statuses:{[URL+'/1']:'weak'}}),result=await job.run();
  assert.equal(result.candidates.length,3);assert.equal(job.calls.length,5);
  const saved=JSON.parse(fs.readFileSync(path.join(job.cwd,'candidates.json')));
  assert.equal(saved.attempts[1].status,'invalid_sources');assert.equal(saved.attempts[1].error_code,'CARDS_CANDIDATE_SOURCE');
  assert.ok(result.candidates.every(c=>c.sources.every(s=>s.url!=='https://example.com/not-collected')));
});

test('후보: 2 일반인 + 1 실무자, 발표일 제한 없음, 오래된 비교 보조 자료, 부족 이유',()=>{
  const old={...item,url:'https://example.com/old',announced_at:'2026-01-01T00:00:00Z'};
  const a={...candidate,mode:'compare',compare_targets:['A','B'],compare_axes:['가격','기능'],sources:[...candidate.sources,{title:'이전 버전',url:old.url,published_at:'2026-01-01'}]};
  assert.equal(validateCandidates({candidates:[a],shortage_reason:'자료 부족'},[item,old],NOW).length,1);
  assert.equal(validateCandidates({candidates:[{...a,anchor_url:old.url,announced_at:'2026-01-01'}],shortage_reason:'부족'},[item,old],NOW).length,1);
  assert.equal(validateCandidates({candidates:[{...candidate,announced_at:''}],shortage_reason:'부족'},[{...item,announced_at:null,date_kind:'unknown'}],NOW).length,1);
  assert.throws(()=>validateCandidates({candidates:[candidate],shortage_reason:''},[item],NOW),{code:'CARDS_CANDIDATE_SHORTAGE'});
  const items=[item,{...item,url:URL+'2'},{...item,url:URL+'3'}];
  const cards=items.map((i,n)=>({...candidate,anchor_url:i.url,audience:n===2?'practitioner':'general',sources:[{...candidate.sources[0],url:i.url}]}));
  assert.equal(validateCandidates({candidates:cards,shortage_reason:''},items,NOW).length,3);
  assert.throws(()=>validateCandidates({candidates:cards.map(c=>({...c,audience:'general'})),shortage_reason:''},items,NOW),{code:'CARDS_CANDIDATE_AUDIENCE'});
});

test('수집: 오래되거나 날짜 없는 원문도 보존하고 원문 날짜를 추정하지 않는다',async()=>{
  const web={search:async()=>({results:[{title:'새 소식',url:URL,snippet:'설명'},{title:'이전 기준',url:URL+'/old'},{title:'날짜 없음',url:URL+'/unknown'}]})};
  const fetchImpl=async url=>({ok:true,url:String(url),text:async()=>String(url).endsWith('/unknown')?'<p>날짜 없는 원문 본문</p>':String(url).includes('example.com')?`<script type="application/ld+json">{"datePublished":"${String(url).endsWith('/old')?'2025-01-01':'2026-10-06'}"}</script><p>원문 본문</p>`:'<rss/>'});
  const items=await collectCardsItems({web,now:NOW,fetchImpl});
  assert.equal(items.length,3);assert.equal(items[0].date_kind,'original_publish');
  assert.equal(items.find(i=>i.url.endsWith('/unknown')).announced_at,null);
  assert.equal(items.find(i=>i.url.endsWith('/unknown')).date_kind,'unknown');
  assert.equal(items.find(i=>i.url.endsWith('/old')).announced_at.slice(0,10),'2025-01-01');
});

test('저장소·워커: 사람 선택 전 미제작, 시간 창, 승인 전 미게시, 승인 뒤 딱 한 번 게시',async t=>{
  const {store,now,setTime}=setup(t);const root=temp(t);let count=0,posts=0;
  const config={enabled:false,productionEnabled:true,uploadEnabled:true,workRoot:root,mediaRoot:root};
  const image=path.join(root,'image.jpg');fs.writeFileSync(image,'approved');
  const record={outcome:'ok',jpeg:[image],snapshot:{[image]:require('../lib/cards/production').hash(fs.readFileSync(image))},caption:'설명'};
  const worker=createCardsWorker({store,config,now,produce:async()=>{count++;return record;},uploader:{refreshTokenIfDue:async()=>{},uploadCarousel:async()=>{posts++;return {permalink:'https://www.instagram.com/p/test/'};}}});
  setTime(Date.parse('2026-10-11T19:00:00Z')/1000);await worker.tick();assert.equal(count,0);
  const id=save(store);const selected=store.selectCandidate(id);
  setTime(Date.parse('2026-10-11T01:00:00Z')/1000);await worker.tick();assert.equal(count,0);
  setTime(Date.parse('2026-10-11T17:59:59Z')/1000);await worker.tick();assert.equal(count,0);
  setTime(Date.parse('2026-10-11T22:00:00Z')/1000);await worker.tick();assert.equal(count,0);
  setTime(Date.parse('2026-10-11T18:00:00Z')/1000);await worker.tick();assert.equal(count,1);assert.equal(posts,0);
  store.approve(selected.jobId,r=>verifySnapshot(r.snapshot));store.enqueueUpload(selected.jobId);
  await worker.tickUpload();await worker.tickUpload();assert.equal(posts,1);assert.equal(store.latestJob().publish_status,'done');
});

test('카드 후보 탐색은 릴스와 동일하게 저녁 7시부터 시작한다',async t=>{
  const {store,now,setTime}=setup(t);let collections=0;
  const config={enabled:true,productionEnabled:false,uploadEnabled:false,workRoot:temp(t),naverClientId:'id',naverClientSecret:'secret'};
  const worker=createCardsWorker({store,now,config,
    collect:async args=>{assert.equal(args.config,config);collections++;return [];},select:async()=>({candidates:[],shortageReason:'시험'})});
  setTime(Date.parse('2026-10-11T09:59:59Z')/1000);await worker.tick();assert.equal(collections,0);
  setTime(Date.parse('2026-10-11T10:00:00Z')/1000);await worker.tick();assert.equal(collections,1);
  await worker.tick();assert.equal(collections,1);
});

test('재시작: 게시 중이면 unknown으로 멈추고 자동 재전송하지 않는다',t=>{
  const {store}=setup(t);const job=store.selectCandidate(save(store));store.claimProduction();store.finishOk(job.jobId,{outcome:'ok'});
  store.approve(job.jobId,()=>{});store.enqueueUpload(job.jobId);store.claimUpload();store.markInterrupted();
  assert.equal(store.latestJob().publish_status,'unknown');assert.equal(store.claimUpload(),null);
});

test('푸시: 카드 전용 테이블, 비공개 payload, 승인된 결과에는 보내지 않는다',t=>{
  const {db,store}=setup(t);db.prepare("INSERT INTO assistant_push_subscriptions(id,status) VALUES(1,'active')").run();
  const push=createCardsPushService(db,{now:()=>NOW,quietHours:()=>({enabled:false})});save(store);
  assert.equal(push.enqueueBatch('2026-10-10',NOW),1);const claim=push.claim(NOW);
  assert.equal(JSON.parse(buildCardsPushPayload(claim)).type,'cards_candidates');assert.equal(buildCardsPushPayload(claim).includes(candidate.title),false);
  store.selectCandidate(store.latestBatch().cards[0].id);assert.equal(push.isClaimSendable(claim,NOW),false);
});

test('검토 판정: MUST가 있는 PASS와 누락된 항목을 거부한다',()=>{
  assert.deepEqual(parseVisual('MUST 0 / NICE 1\n판정: PASS\nN1. 개선'),{status:'PASS',must:0,nice:1});
  assert.throws(()=>parseVisual('MUST 1 / NICE 0\n판정: PASS\nM1. 오류'),{code:'CARDS_VISUAL_CONTRADICTION'});
  assert.throws(()=>parseVisual('MUST 2 / NICE 0\n판정: NEEDS_FIX\nM1. 오류'),{code:'CARDS_VISUAL_COUNT'});
});

const deck={mode:'news',topic:'검증',date:'2026-10-10',source:'검증 자료',cards:[
  {layout:'cover',title:'새 기술',body:'새로운 발표예요.'},
  {layout:'story',title:'무슨 일?',composition:'text',body:'공식 자료로 확인해요.'},
  {layout:'story',title:'주의할 점',composition:'text',body:'조건을 함께 읽어요.'},
  {layout:'closing',title:'한 줄 정리',statement:'확인하고\n사용해요.',body:'발표와 검증을 구분해요.'}]};
deck.cards.forEach(card=>{card.eyebrow='TECH NEWS';});
const quote='This release is a public preview of our new model.';
function manuscript(){return `## 조립 원고\n\n\`\`\`json\n${JSON.stringify(deck)}\n\`\`\`\n\n## 게시 캡션\n설명해요.  \n원문: ${URL}\n\n## 사실 확인 목록\n| ID | 주장 | 출처 | 인용 |\n| C1 | 발표 | ${URL} | "${quote}" |\n\n## 검토 결과\n판정: PASS\n`;}

function integratedRunner(t,{sourceFix=false,imageFix=false,interrupt=false,blocked=false,visualBlocked=false,sourceCarryBlock=false,mutateReview=false,alwaysFix=false,photo=false,extraMetadata=false,agentBlocked=false,report="READY_FOR_REVIEW\n"}={}){
  const root=temp(t),config=cardsConfig({},path.resolve(__dirname,'..'));
  const workDir=path.join(root,'work'),outDir=path.join(root,'images'),calls=[];
  let firstInterruption=interrupt;
  const writeProduct=()=>{
    const assembly=path.join(workDir,'assembly'),srcDir=path.join(workDir,'sources');
    fs.mkdirSync(srcDir,{recursive:true});fs.writeFileSync(path.join(srcDir,'source.txt'),quote);
    fs.writeFileSync(path.join(srcDir,'source-map.json'),JSON.stringify({[URL]:path.join(srcDir,'source.txt')}));
    fs.writeFileSync(path.join(assembly,'manuscript.md'),manuscript());fs.writeFileSync(path.join(assembly,'deck.json'),JSON.stringify(deck));
    fs.writeFileSync(path.join(assembly,'caption.txt'),`설명해요.\n원문: ${URL}`);fs.writeFileSync(path.join(assembly,'report.md'),report);
    fs.writeFileSync(path.join(assembly,'self-review.md'),'01~04 원본/390 확인 기록');fs.writeFileSync(path.join(assembly,'art.py'),'# test');
    fs.writeFileSync(path.join(assembly,'render_episode.py'),"raise Exception('server must never execute episode')");fs.writeFileSync(path.join(assembly,'assets.json'),'[]');
    require('node:child_process').execFileSync(config.python,[path.join(config.root,'reels/cards/render_job.py'),path.join(assembly,'deck.json'),'--out',outDir,'--font',config.font,'--bold-font',config.boldFont]);
    if(photo){
      fs.copyFileSync(path.join(outDir,'01.png'),path.join(assembly,'photo.png'));
      fs.writeFileSync(path.join(assembly,'assets.json'),JSON.stringify([{file:photo==='outside'?path.join(root,'outside.png'):'photo.png',kind:'photo',source_url:URL,provider:'공식 발표',usage_terms:photo==='missing'?'':'보도용 허용',caption:'제품',purpose:'실물 확인'}]));
      if(photo==='outside')fs.copyFileSync(path.join(outDir,'01.png'),path.join(root,'outside.png'));
    }
    if(extraMetadata){
      const license='https://creativecommons.org/licenses/by/4.0/',caption=`설명해요.\n원문: ${URL}\n이용 조건: CC BY 4.0 ${license}`;
      const actual=JSON.parse(fs.readFileSync(path.join(assembly,'deck.json')));actual.caption=caption;actual.cards[1].history_art='history.png';
      fs.copyFileSync(path.join(outDir,'01.png'),path.join(assembly,'history.png'));fs.writeFileSync(path.join(assembly,'deck.json'),JSON.stringify(actual));
      fs.writeFileSync(path.join(assembly,'caption.txt'),caption);fs.writeFileSync(path.join(assembly,'manuscript.md'),manuscript().replace(`설명해요.  \n원문: ${URL}`,caption));
      const metadata=JSON.parse(fs.readFileSync(path.join(assembly,'assets.json')));metadata[0].usage_terms='CC BY 4.0 '+license;
      metadata.push({file:'history.png',kind:'pixel'});fs.writeFileSync(path.join(assembly,'assets.json'),JSON.stringify(metadata));
    }
  };
  const runner=async args=>{
    const name=args.cwd===path.join(workDir,'assembly') ? (calls.some(call=>call.name==='create')?'fix-'+(calls.filter(call=>call.name.startsWith('fix')).length+1):'create') : path.basename(path.dirname(args.cwd));
    calls.push({name,args});fs.mkdirSync(args.cwd,{recursive:true});
    if(name==='create')writeProduct();
    else if(name.startsWith('fix')){
      if(firstInterruption){firstInterruption=false;fs.writeFileSync(path.join(args.cwd,'manuscript.md'),'partial');throw Object.assign(new Error('interrupted'),{code:'CARDS_AGENT_EXIT'});}
      if(sourceFix){
        const file=path.join(args.cwd,'manuscript.md');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('설명해요.','조건을 확인해요.'));
        fs.writeFileSync(path.join(args.cwd,'caption.txt'),`조건을 확인해요.\n원문: ${URL}`);
      }
      if(imageFix)require('node:child_process').execFileSync(config.python,['-c',"from PIL import Image; import sys; p=sys.argv[1]; im=Image.open(p).convert('RGB'); im.putpixel((500,700),(255,0,0)); im.save(p)",path.join(outDir,'01.png')]);
    } else {
      if(name.startsWith('source')){
        assert.deepEqual(args.images,[]);assert.deepEqual(args.writable,[]);
        assert.ok(!args.prompt.includes(outDir));assert.ok(!args.prompt.includes(path.join(workDir,'assembly')));assert.ok(!args.prompt.includes('render_episode.py'));
        const input=JSON.parse(fs.readFileSync(path.join(args.cwd,'input','deck.json')));assert.equal(input.cards[0].layout,undefined);assert.equal(input.cards[0].title,deck.cards[0].title);
        assert.equal(fs.existsSync(path.join(args.cwd,'input','art.py')),false);
        const metadata=JSON.parse(fs.readFileSync(path.join(args.cwd,'input','assets.json')));assert.ok(metadata.every(asset=>!['file','kind','purpose'].some(key=>Object.hasOwn(asset,key))));if(photo===true)assert.equal(metadata[0].source_url,URL);
      } else {
        assert.equal(args.images.length,8);
        if(sourceCarryBlock&&sourceFix&&name==='visual-0'&&!args.prompt.includes('출처 NEEDS_FIX는 시각 BLOCKED 사유가 아니다')) {
          fs.writeFileSync(path.join(args.cwd,'review.md'),'판정: BLOCKED\nMUST 1 / NICE 0\n### V1 — MUST\n출처 수정이 미해결');
          return {response:{status:'blocked',message:'출처 수정이 미해결'}};
        }
      }
      if(mutateReview)fs.appendFileSync(path.join(workDir,'assembly','caption.txt'),'changed');
      const needs=(sourceFix&&name==='source-0')||(imageFix&&name==='visual-0')||(alwaysFix&&name.startsWith('visual'));
      const prefix=name.startsWith('source')?'S':'V';
      fs.writeFileSync(path.join(args.cwd,'review.md'),blocked||(visualBlocked&&name.startsWith('visual'))?'판정: BLOCKED\nMUST 0 / NICE 0':needs?`판정: NEEDS_FIX\nMUST 1 / NICE 0\n### ${prefix}1 — MUST\n수정`:'판정: PASS\nMUST 0 / NICE 1\n### N1 — NICE\n선택 개선');
    }
    return {response:{status:agentBlocked&&name==='create'?'blocked':'ok',message:'test'},usage:{input_tokens:1,output_tokens:1}};
  };
  return {root,config,workDir,outDir,calls,run:()=>produceCard({candidate,cardId:1,date:deck.date,config,workDir,outDir,runner})};
}

test('통합: create → 텍스트 전용 출처 → 실제 이미지 시각 검토, 서버 임의 코드 미실행·최종 hash',async t=>{
  const job=integratedRunner(t,{report:'# 제작 보고서\n\n상태: **READY_FOR_REVIEW**\n'}),record=await job.run();
  assert.deepEqual(job.calls.map(call=>call.name),['create','source-0','visual-0']);
  assert.ok(job.calls.every(call=>call.args.model==='gpt-6.1-sol'&&call.args.reasoningEffort==='medium'));
  assert.equal(record.outcome,'ok');assert.equal(record.images.length,4);assert.equal(record.jpeg.length,4);verifySnapshot(record.snapshot);
  await job.run();assert.equal(job.calls.length,3);
  fs.writeFileSync(record.jpeg[0],'changed');await assert.rejects(job.run(),{code:'CARDS_ARTIFACT_CHANGED'});
});

test('문구만 수정하면 출처만 새로 검토하고 동일 bitmap 시각 PASS를 재사용한다',async t=>{
  const job=integratedRunner(t,{sourceFix:true});const record=await job.run();
  assert.deepEqual(job.calls.map(call=>call.name),['create','source-0','visual-0','fix-1','source-1']);
  assert.ok(record.caption.includes('조건을 확인해요.'));assert.ok(record.reviews.visual.report.includes('visual-0'));
});

test('출처 NEEDS_FIX를 시각 BLOCKED로 넘기지 않고 수정·출처 재검토까지 이어간다',async t=>{
  const job=integratedRunner(t,{sourceFix:true,sourceCarryBlock:true}),record=await job.run();
  assert.deepEqual(job.calls.map(call=>call.name),['create','source-0','visual-0','fix-1','source-1']);
  assert.equal(record.outcome,'ok');assert.ok(record.caption.includes('조건을 확인해요.'));
  const visual=job.calls.find(call=>call.name==='visual-0');
  assert.ok(visual.args.prompt.includes('원고 보완으로 해결 가능한 문제는 NEEDS_FIX'));
  assert.ok(visual.args.prompt.includes('보고서를 완료했으면 최종 JSON status는 ok'));
});

test('이전 판정 범위의 시각 검토만 다시 받고 생성·출처 결과는 그대로 재사용한다',async t=>{
  const job=integratedRunner(t),record=await job.run();
  record.outcome='failed';delete record.stages.find(s=>s.kind==='visual').policySha256;
  fs.writeFileSync(path.join(job.workDir,'production.json'),JSON.stringify(record));
  const resumed=await job.run();assert.equal(resumed.outcome,'ok');
  assert.deepEqual(job.calls.map(call=>call.name),['create','source-0','visual-0','visual-0']);
  assert.ok(resumed.stages.at(-1).policySha256);verifySnapshot(resumed.snapshot);
});

test('이미지만 수정하면 출처 PASS를 재사용하고 시각 검토를 다시 받는다',async t=>{
  const job=integratedRunner(t,{imageFix:true});const record=await job.run();
  assert.deepEqual(job.calls.map(call=>call.name),['create','source-0','visual-0','fix-1','visual-1']);
  assert.ok(record.reviews.source.report.includes('source-0'));verifySnapshot(record.snapshot);
});

test('중단된 수정은 원본 checkpoint로 복원 후 수정부터 재개하고 실패 영수증을 보존한다',async t=>{
  const job=integratedRunner(t,{imageFix:true,interrupt:true});await assert.rejects(job.run(),{code:'CARDS_AGENT_EXIT'});
  const record=await job.run();assert.equal(record.outcome,'ok');assert.equal(job.calls.filter(call=>call.name==='create').length,1);
  assert.equal(record.restorations.length,1);assert.ok(record.stages.some(stage=>stage.name==='fix-1'&&stage.result==='failed'));
  assert.ok(record.stages.some(stage=>stage.name==='fix-1'&&stage.result==='ok'));verifySnapshot(record.snapshot);
});

test('출처 BLOCKED는 시각이나 제작 완료로 덮지 않고 검토의 원본 수정도 거부한다',async t=>{
  const blocked=integratedRunner(t,{blocked:true});await assert.rejects(blocked.run(),{code:'CARDS_SOURCE_BLOCKED'});
  assert.deepEqual(blocked.calls.map(call=>call.name),['create','source-0']);
  const changed=integratedRunner(t,{mutateReview:true});await assert.rejects(changed.run(),{code:'CARDS_ARTIFACT_CHANGED'});
});

test('시각 자료를 확인할 수 없는 BLOCKED는 자동 수정이나 완료로 넘기지 않는다',async t=>{
  const job=integratedRunner(t,{visualBlocked:true});await assert.rejects(job.run(),{code:'CARDS_VISUAL_BLOCKED'});
  assert.deepEqual(job.calls.map(call=>call.name),['create','source-0','visual-0']);
});

test('통합 판정은 S/V MUST 개수와 NICE를 구분하고 사진 경로/메타데이터를 검사한다',t=>{
  const {parseReview,postedText}=require('../lib/cards/integrated');
  assert.deepEqual(parseReview('판정: PASS\nMUST 0 / NICE 1\n### S1 · NICE · 설명','S'),{status:'PASS',must:0,nice:1});
  assert.throws(()=>parseReview('판정: PASS\nMUST 1 / NICE 0\n### V1 · MUST · 오류','V'),{code:'CARDS_REVIEW_CONTRADICTION'});
  assert.throws(()=>parseReview('판정: NEEDS_FIX\nMUST 2 / NICE 0\n### S1 · MUST · 오류','S'),{code:'CARDS_REVIEW_COUNT'});
  assert.deepEqual(postedText({art:'asset.png',photo:{file:'photo.jpg',caption:'실제 제품'},content:{text:'라벨',x:42},title:'제목'}),{photo:{caption:'실제 제품'},content:{text:'라벨'},title:'제목'});
  const root=temp(t),assembly=path.join(root,'assembly');fs.mkdirSync(assembly);const external=path.join(root,'outside.jpg');fs.writeFileSync(external,'photo');
  fs.writeFileSync(path.join(assembly,'caption.txt'),'설명');fs.writeFileSync(path.join(assembly,'deck.json'),JSON.stringify({title:'제목',photo:external}));
  assert.throws(()=>require('../lib/cards/production').validateDeck(path.join(assembly,'deck.json'),{title:'제목'},assembly,'설명'),{code:'CARDS_PATH_OUTSIDE_JOB'});
});

test('최대 두 번 수정해도 MUST가 남으면 완료하지 않고 반복을 끝낸다',async t=>{
  const job=integratedRunner(t,{alwaysFix:true});await assert.rejects(job.run(),{code:'CARDS_FIX_LIMIT'});
  const record=JSON.parse(fs.readFileSync(path.join(job.workDir,'production.json')));assert.equal(record.outcome,'failed');
  assert.equal(record.stages.filter(stage=>stage.name.startsWith('fix-')).length,2);
  assert.equal(record.stages.filter(stage=>stage.name.startsWith('visual-')).length,1); // 같은 bitmap은 같은 NEEDS_FIX를 재사용한다.
});

test('사진 파일은 편 내부에만 두고 출처 검토에는 경로 없는 원URL/사용 조건만 준다',async t=>{
  const valid=integratedRunner(t,{photo:true});const record=await valid.run();assert.ok(record.snapshot[path.join(valid.workDir,'assembly','photo.png')]);
  const missing=integratedRunner(t,{photo:'missing'});await assert.rejects(missing.run(),{code:'CARDS_PHOTO_SOURCE'});
  const outside=integratedRunner(t,{photo:'outside'});await assert.rejects(outside.run(),{code:'CARDS_PATH_OUTSIDE_JOB'});
});

test('사진 캡션·등록 그림·이용허락 링크가 함께 있어도 통합 검증과 독립 검토를 끝낸다',async t=>{
  const job=integratedRunner(t,{photo:true,extraMetadata:true}),record=await job.run();
  assert.equal(record.outcome,'ok');assert.ok(record.caption.includes('이용 조건: CC BY 4.0'));
  assert.deepEqual(job.calls.map(c=>c.name),['create','source-0','visual-0']);verifySnapshot(record.snapshot);
});

test('출처 검사는 인용이 없는 사실 행을 통과시키지 않는다',async t=>{
  const root=temp(t),config=cardsConfig({},path.resolve(__dirname,'..'));const file=path.join(root,'draft.md');
  fs.writeFileSync(file,'## 사실 확인 목록\n| C1 | 주장 | 출처 | 직접 확인 |\n');
  await assert.rejects(checkFacts(config,file,root),{code:'CARDS_FACTCHECK_FAILED'});
});

test('중복 캡션은 원고와 같을 때만 허용하고 게시 문구·미등록 추가 필드는 계속 거부한다',t=>{
  const {validateDeck}=require('../lib/cards/production'),root=temp(t),file=path.join(root,'deck.json');
  const expected={cards:[{title:'원고 제목'}]},caption='게시 문구\n원문 링크';
  fs.writeFileSync(path.join(root,'caption.txt'),caption+'\n');
  fs.writeFileSync(file,JSON.stringify({...expected,caption:caption+'  \n'}));
  assert.equal(validateDeck(file,expected,root,caption).caption,caption+'  \n');
  fs.writeFileSync(file,JSON.stringify({...expected,caption:'바뀐 게시 문구'}));
  assert.throws(()=>validateDeck(file,expected,root,caption),{code:'CARDS_CAPTION_MISMATCH'});
  fs.writeFileSync(file,JSON.stringify({cards:[{title:'변경된 제목'}],caption}));
  assert.throws(()=>validateDeck(file,expected,root,caption),{code:'CARDS_COPY_MISMATCH'});
  fs.writeFileSync(file,JSON.stringify({...expected,unexpected:'추가 주장',caption}));
  assert.throws(()=>validateDeck(file,expected,root,caption),{code:'CARDS_COPY_MISMATCH'});
});

test('추가 그림 참조는 등록된 파일만 허용하고 작업 밖 경로는 계속 차단한다',t=>{
  const {validateDeck}=require('../lib/cards/production'),root=temp(t),file=path.join(root,'deck.json');
  const expected={cards:[{title:'원고 제목'}]};fs.writeFileSync(path.join(root,'caption.txt'),'게시 문구');fs.writeFileSync(path.join(root,'history.png'),'image');
  fs.writeFileSync(file,JSON.stringify({cards:[{title:'원고 제목',history_art:'history.png'}]}));
  assert.doesNotThrow(()=>validateDeck(file,expected,root,'게시 문구',new Set(['history.png'])));
  assert.throws(()=>validateDeck(file,expected,root,'게시 문구'),{code:'CARDS_COPY_MISMATCH'});
  const outside=path.join(temp(t),'outside.png');fs.writeFileSync(outside,'image');
  fs.writeFileSync(file,JSON.stringify({cards:[{title:'원고 제목',history_art:outside}]}));
  assert.throws(()=>validateDeck(file,expected,root,'게시 문구',new Set([outside])),{code:'CARDS_PATH_OUTSIDE_JOB'});
});

test('사진 이용허락 링크는 등록된 사진의 이용조건 행에서만 사실 인용과 구분한다',async t=>{
  const root=temp(t),config=cardsConfig({},path.resolve(__dirname,'..')),file=path.join(root,'draft.md'),license='https://creativecommons.org/licenses/by/4.0/';
  const source=path.join(root,'source.txt');fs.writeFileSync(source,quote);fs.writeFileSync(path.join(root,'source-map.json'),JSON.stringify({[URL]:source}));
  const metadata=[{kind:'photo',source_url:'https://example.com/photo.jpg',provider:'작가',usage_terms:'CC BY 4.0 '+license}];
  fs.writeFileSync(file,manuscript().replace('원문: '+URL,'원문: '+URL+'\n이용 조건: CC BY 4.0 '+license));
  assert.ok((await checkFacts(config,file,root,undefined,metadata)).every(c=>c.found));
  await assert.rejects(checkFacts(config,file,root),{code:'CARDS_CAPTION_SOURCE'});
  await assert.rejects(checkFacts(config,file,root,undefined,[{...metadata[0],kind:'pixel'}]),{code:'CARDS_CAPTION_SOURCE'});
  fs.writeFileSync(file,manuscript().replace('원문: '+URL,'원문: '+URL+'\n주장의 근거: '+license));
  await assert.rejects(checkFacts(config,file,root,undefined,metadata),{code:'CARDS_CAPTION_SOURCE'});
  fs.writeFileSync(file,manuscript().replace('원문: '+URL,'원문: '+URL+'\n이용 조건: https://other.example/license'));
  await assert.rejects(checkFacts(config,file,root,undefined,metadata),{code:'CARDS_CAPTION_SOURCE'});
  fs.writeFileSync(file,manuscript().replace(quote,'This claim is not in the original.'));
  await assert.rejects(checkFacts(config,file,root,undefined,metadata),{code:'CARDS_CHECK_FAILED'});
});

test('캐러셀: JPEG 공개, 자식 순서 보존, parent만 게시, publish는 자동 재시도 없음',async t=>{
  const root=temp(t),images=[1,2].map(i=>path.join(root,`${i}.jpg`));images.forEach((f,i)=>fs.writeFileSync(f,`JPEG${i}`));
  let port,creates=0,publishes=0,stopped=0;const children=[];
  const uploader=createInstagramUploader({userId:'user',tokens:{get:()=> 'secret'},tmpRoot:path.join(root,'public'),
    startTunnel:async p=>{port=p;return {origin:'https://example.trycloudflare.com',stop:()=>stopped++};},publicDnsReady:async()=>true,sleep:async()=>{},
    fetch:async(url,init={})=>{
      if(url.endsWith('/media')){
        const form=new URLSearchParams(init.body);creates++;
        if(form.get('image_url')){children.push(`c${creates}`);const publicUrl=new globalThis.URL(form.get('image_url'));
          const response=await fetch(`http://127.0.0.1:${port}${publicUrl.pathname}`);assert.equal(response.headers.get('content-type'),'image/jpeg');assert.equal(await response.text(),`JPEG${creates-1}`);
          assert.equal(form.get('is_carousel_item'),'true');
        }else{assert.equal(form.get('media_type'),'CAROUSEL');assert.equal(form.get('children'),children.join(','));}
        return {ok:true,json:async()=>({id:`c${creates}`})};
      }
      if(url.includes('status_code'))return {ok:true,json:async()=>({status_code:'FINISHED'})};
      if(url.endsWith('/media_publish')){publishes++;return {ok:false,status:503,json:async()=>({})};}
      throw new Error('unexpected');
    }});
  await assert.rejects(uploader.uploadCarousel({imagePaths:images,caption:'설명'}),{code:'REELS_IG_HTTP_503'});
  assert.equal(creates,3);assert.equal(publishes,1);assert.equal(stopped,1);assert.deepEqual(fs.readdirSync(path.join(root,'public')),[]);
});

test('승인 API: 결과 변조 시 승인과 게시 큐를 모두 거부한다',t=>{
  const {store}=setup(t),root=temp(t),image=path.join(root,'image.jpg');fs.writeFileSync(image,'approved');
  const job=store.selectCandidate(save(store));store.claimProduction();
  const record={outcome:'ok',images:[image],caption:'설명',snapshot:require('../lib/cards/production').snapshot([image])};store.finishOk(job.jobId,record);
  const handlers=new Map(),app={get:(p,h)=>handlers.set('GET '+p,h),post:(p,h)=>handlers.set('POST '+p,h)};let notified=0;
  registerCardsRoutes({app,store,config:{enabled:true,productionEnabled:true,uploadEnabled:true,mediaRoot:root},onUpload:()=>notified++});
  fs.writeFileSync(image,'modified');let status=200,result;const res={status:n=>{status=n;return res;},json:v=>{result=v;return res;}};
  handlers.get('POST /api/cards/jobs/:id/approve')({params:{id:String(job.jobId)}},res);
  assert.equal(status,409);assert.equal(result.code,'CARDS_ARTIFACT_CHANGED');assert.equal(store.latestJob().status,'ready');assert.equal(store.claimUpload(),null);assert.equal(notified,0);
});

test('수동 카드 게시: 업로드 env가 true여도 꺼지고 완성본 JPEG만 인증 경로에서 순서대로 내려받는다',t=>{
  assert.equal(cardsConfig({CARDS_INSTAGRAM_UPLOAD_ENABLED:'true'}).uploadEnabled,false);
  const {store}=setup(t),root=temp(t),png=path.join(root,'01.png'),jpeg=path.join(root,'01.jpg');
  fs.writeFileSync(png,'PNG');fs.writeFileSync(jpeg,'JPEG');
  const job=store.selectCandidate(save(store));store.claimProduction();
  const record={outcome:'ok',images:[png],jpeg:[jpeg],caption:'첫 줄\n둘째 줄',snapshot:require('../lib/cards/production').snapshot([png,jpeg])};store.finishOk(job.jobId,record);
  const handlers=new Map(),app={get:(p,h)=>handlers.set('GET '+p,h),post:(p,h)=>handlers.set('POST '+p,h)};
  registerCardsRoutes({app,store,config:{enabled:true,productionEnabled:true,uploadEnabled:false,mediaRoot:root}});
  const output=require('../lib/cards/routes').jobJson(store.latestJob());
  assert.deepEqual(output.downloads,[`/api/cards/jobs/${job.jobId}/images/1?download=1`]);
  let sent,status=200,result;const res={set:()=>{},status:n=>{status=n;return res;},json:v=>{result=v;return res;},download:(file,name)=>{sent={file,name};}};
  const image=handlers.get('GET /api/cards/jobs/:id/images/:page');
  image({params:{id:String(job.jobId),page:'1'},query:{download:'1'}},res);
  assert.deepEqual(sent,{file:fs.realpathSync(jpeg),name:`sionwhy-${job.jobId}-01.jpg`});
  handlers.get('POST /api/cards/jobs/:id/approve')({params:{id:String(job.jobId)}},res);
  assert.equal(store.latestJob().status,'approved');assert.equal(store.claimUpload(),null);
  fs.writeFileSync(jpeg,'changed');sent=null;
  image({params:{id:String(job.jobId),page:'1'},query:{download:'1'}},res);
  assert.equal(status,409);assert.equal(result.code,'CARDS_ARTIFACT_CHANGED');assert.equal(sent,null);
});

test('CLI는 지정한 xhigh와 기본 medium을 실제 프로세스 인자로 전달한다',async t=>{
  const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
  for(const effort of ['xhigh',undefined]){
    let argv;
    const spawn=(bin,args)=>{
      argv=args;const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>{};
      child.stdin.on('finish',()=>{fs.writeFileSync(args[args.indexOf('-o')+1],JSON.stringify({status:'ok',message:'test'}));queueMicrotask(()=>child.emit('close',0));});return child;
    };
    await require('../lib/cards/runner').runCodex({config:{bin:'fake'},model:'gpt-6-luna',cwd:temp(t),prompt:'test',reasoningEffort:effort,spawn});
    assert.ok(argv.includes(`model_reasoning_effort="${effort||'medium'}"`));
  }
});

test('CLI 작업 폴더가 Git checkout 안이면 공용 코드 쓰기 권한을 주지 않고 거부한다',t=>{
  const root=temp(t);fs.mkdirSync(path.join(root,'.git'));
  assert.throws(()=>require('../lib/cards/runner').runCodex({config:{},model:'gpt-5.6-sol',cwd:path.join(root,'job'),prompt:'test'}),{code:'CARDS_WORKSPACE_NOT_ISOLATED'});
});

 test('통합 제작 응답 JSON의 blocked는 독립 검토 전에 차단한다',async t=>{
 const job=integratedRunner(t,{agentBlocked:true});await assert.rejects(job.run(),{code:'CARDS_AGENT_BLOCKED'});assert.deepEqual(job.calls.map(call=>call.name),['create']);
 });


 test('고정 JSON은 ok/blocked와 문자열 message만 허용한다',()=>{
 const {validateAgentResult}=require('../lib/cards/integrated');
 assert.doesNotThrow(()=>validateAgentResult({status:'ok',message:'완료'}));
 assert.throws(()=>validateAgentResult({status:'blocked',message:'원문 없음'}),{code:'CARDS_AGENT_BLOCKED'});
 for(const value of [null,[],{},'ok',{status:'READY_FOR_REVIEW',message:''},{status:'ok'},{status:'ok',message:1},{status:'ok',message:'',extra:true}])assert.throws(()=>validateAgentResult(value),{code:'CARDS_AGENT_RESPONSE'});
 });

test('19시 경계는 새벽 강제 수집과 저녁 정규 수집을 다른 회차로 구분한다',async t=>{
  const {store,now,setTime}=setup(t);const days=[];
  const worker=createCardsWorker({store,now,config:{enabled:true,productionEnabled:false,workRoot:temp(t)},
    collect:async()=>[],select:async({today})=>{days.push(today);return {candidates:[candidate],shortageReason:''};}});
  setTime(Date.parse('2026-10-11T00:45:00+09:00')/1000);await worker.collectNow();
  assert.equal(store.latestBatch().batchId,'2026-10-10');
  setTime(Date.parse('2026-10-11T18:59:59+09:00')/1000);await worker.tick();
  assert.equal(days.length,1);
  setTime(Date.parse('2026-10-11T19:00:00+09:00')/1000);await worker.tick();await worker.tick();
  assert.deepEqual(days,['2026-10-10','2026-10-11']);
});
