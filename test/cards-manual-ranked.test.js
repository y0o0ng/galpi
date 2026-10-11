'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Database=require('better-sqlite3'),{migrations}=require('../lib/database-migrations'),{createCardsStore}=require('../lib/cards/store');
const {reviewManualTopic}=require('../lib/cards/manual'),{generateRankedCandidates}=require('../lib/cards/ranked'),{createCardsWorker}=require('../lib/cards/worker'),{cardsConfig}=require('../lib/cards/config');
const NOW=Date.parse('2026-10-11T00:00:00Z')/1000,URL='https://example.com/release';
const candidate={title:'AI 보안 사건',summary:'확인된 사건',audience:'general',attention_query:'AI security event',mode:'news',format_reason:'사건을 설명해요.',reader_question:'무엇이 달라졌나요?',why_interest:'보안 영향',risk:'조사 중',anchor_url:URL,announced_at:'',sources:[{title:'원문',url:URL,published_at:null}],compare_targets:[],compare_axes:[]};
function setup(t){const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY,value_json TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,updated_at INTEGER)');migrations.find(m=>m.version===43).up(db);t.after(()=>db.close());return {db,store:createCardsStore(db,{now:()=>NOW})};}
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cards-topic-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
test('후보 0개는 empty, 1개는 선택 가능하고 수집 중·실패와 구분한다',t=>{
 const {store}=setup(t);store.claimRun('2026-10-11');assert.equal(store.latestBatch().status,'collecting');store.saveBatch({day:'2026-10-11',candidates:[],shortageReason:'없음'});assert.equal(store.latestBatch().status,'empty');
 store.claimRun('2026-10-12');store.failRun('2026-10-12',{code:'NETWORK'});assert.equal(store.latestBatch().status,'failed');store.claimRun('2026-10-13');store.saveBatch({day:'2026-10-13',candidates:[candidate],shortageReason:'1개'});assert.equal(store.latestBatch().status,'candidate');assert.ok(store.selectCandidate(store.latestBatch().cards[0].id).jobId);
});
test('직접 제안: 루나 피드백→수정→현재 ready 승인만 원자적으로 제작 대기로 넘긴다',t=>{
 const {store,db}=setup(t);let d=store.submitManual({message:'은행 해킹',id:null,revision:0});assert.equal(store.latestJob(),null);assert.throws(()=>store.approveManual(d),{code:'CARDS_NOT_PENDING'});
 const claimed=store.claimManual();store.finishManual({...claimed,feedback:'AI 활용은 추정이에요.',candidate:null});d=store.manualTopic();assert.equal(d.status,'feedback');
 d=store.submitManual({message:'추정이라고 표시하자',id:d.id,revision:d.revision});store.claimManual();store.finishManual({...d,feedback:'확인했어요.',candidate});assert.equal(store.latestJob(),null);
 assert.throws(()=>store.approveManual({...d,revision:1}),{code:'CARDS_TOPIC_STALE'});const result=store.approveManual(d);assert.equal(store.getJob(result.jobId).status,'queued');assert.throws(()=>store.approveManual(d),{code:'CARDS_NOT_PENDING'});
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cards_jobs').get().n,1);assert.equal(store.manualTopic().messages.length,4);assert.ok(db.prepare('SELECT key FROM app_settings WHERE key=?').get('cards.manual_topic.'+d.id));
});
test('수정은 이전 ready를 무효화하고 중복 요청·오래된 결과·재시작 중단을 막는다',t=>{
 const {store}=setup(t);const d=store.submitManual({message:'제안',id:null,revision:0});store.claimManual();store.finishManual({...d,feedback:'가능',candidate});const next=store.submitManual({message:'다른 조건',id:d.id,revision:d.revision});assert.equal(next.candidate,null);
 assert.throws(()=>store.approveManual(d),{code:'CARDS_TOPIC_STALE'});assert.throws(()=>store.submitManual({message:'중복',id:next.id,revision:next.revision}),{code:'CARDS_TOPIC_BUSY'});store.claimManual();assert.throws(()=>store.finishManual({...d,feedback:'옛 결과',candidate}),{code:'CARDS_TOPIC_STALE'});store.recoverManual();assert.equal(store.manualTopic().status,'feedback');assert.equal(store.manualTopic().candidate,null);
});
test('직접 확인: 제공 원문 인용과 URL만 ready로 승인 가능, 모르는 출처는 거부',async t=>{
 const config=cardsConfig({}),cwd=temp(t),dialogue={messages:[{role:'user',text:'AI 보안 사건이 맞아?'}]};const web={search:async()=>({results:[{url:URL,title:'원문',snippet:'AI security event confirmed'}]}),fetch:async()=>({content:'AI security event confirmed'})};
 const runner=async()=>({response:{verdict:'ready',feedback:'확인했어요.',candidates:[candidate],checks:[{claim:'사건 확인',url:URL,quote:'AI security event confirmed'}]}});
 assert.equal((await reviewManualTopic({dialogue,config,web,today:'2026-10-11',now:NOW,cwd,runner})).candidate.title,candidate.title);
 await assert.rejects(reviewManualTopic({dialogue,config,web,today:'2026-10-11',now:NOW,cwd,runner:async()=>{const r=await runner();r.response.checks[0].quote='not present';return r;}}),{code:'CARDS_TOPIC_SOURCE_INVALID'});
});
test('넓은 후보 순위: weak 1개도 남기고 0개는 모델 호출 없이 반환한다',async t=>{
 const config=cardsConfig({}),cwd=temp(t);let calls=0;const item={url:URL,title:'원문'},web={search:async()=>({results:[]})};
 const runner=async args=>{calls++;if(args.cwd.endsWith('rank'))return {response:{general:[{id:0,reason:'독자가 궁금해해요.'}],practitioner:[]}};if(args.cwd.endsWith('attention-agent'))return {response:{checks:[{candidate_index:0,status:'weak',limits:'반응 제한적',evidence:[]}]}};return {response:{candidates:[candidate],shortage_reason:'1개만'},usage:{}};};
 const r=await generateRankedCandidates({config,items:[item],today:'2026-10-11',now:NOW,cwd,web,collect:async()=>[],runner});assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].attention.status,'unverified');assert.equal(r.candidates[0].rank,1);assert.match(r.shortageReason,/1개/);
 calls=0;const empty=await generateRankedCandidates({config,items:[],today:'2026-10-11',now:NOW,cwd,web,runner});assert.equal(empty.candidates.length,0);assert.equal(calls,0);
});
test('워커 직접 제안은 제작 시간과 무관하게 확인하지만 승인 전에는 미제작',async t=>{
 const {store}=setup(t);const d=store.submitManual({message:'제안',id:null,revision:0});let builds=0;
 const worker=createCardsWorker({store,config:{enabled:true,productionEnabled:true,uploadEnabled:false,workRoot:temp(t)},now:()=>NOW,reviewTopic:async()=>({feedback:'확인',candidate}),produce:async()=>{builds++;}});
 await worker.tickManual();assert.equal(store.manualTopic().status,'ready');assert.equal(builds,0);store.approveManual(d);await worker.tickManual();assert.equal(builds,0);
});
test('API는 직접 제안 후 현재 검토본 승인만 허용하고 잘못된 입력·오래된 승인을 거부한다',t=>{
 const {store}=setup(t),handlers=new Map();let wake=0;
 require('../lib/cards/routes').registerCardsRoutes({app:{get:(p,f)=>handlers.set('GET '+p,f),post:(p,f)=>handlers.set('POST '+p,f)},store,config:{enabled:true,productionEnabled:true},onTopic:()=>wake++});
 const res=()=>({statusCode:200,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}});
 const invalid=res();handlers.get('POST /api/cards/topic/messages')({body:{message:''}},invalid);assert.equal(invalid.statusCode,400);assert.equal(wake,0);
 const r=res();handlers.get('POST /api/cards/topic/messages')({body:{message:'주제',id:null,revision:0}},r);assert.equal(wake,1);assert.equal(r.body.dialogue.status,'queued');assert.equal(store.latestJob(),null);
 const d=store.claimManual();store.finishManual({...d,feedback:'확인',candidate});const stale=res();handlers.get('POST /api/cards/topic/approve')({body:{id:d.id,revision:0}},stale);assert.equal(stale.statusCode,409);
 const approved=res();handlers.get('POST /api/cards/topic/approve')({body:{id:d.id,revision:d.revision}},approved);assert.ok(approved.body.jobId);assert.equal(store.latestJob().status,'queued');
});
test('넓은 순위는 10+5 모두를 검토한 뒤 각각 2+1을 선택한다',async t=>{
 const config=cardsConfig({}),cwd=temp(t),all=Array.from({length:15},(_,id)=>({...candidate,title:'주제 '+id,audience:id<10?'general':'practitioner',anchor_url:URL+'/'+id,sources:[{title:'원문',url:URL+'/'+id,published_at:null}]}));
 const runner=async args=>{
  if(args.cwd.endsWith('rank'))return {response:{general:Array.from({length:10},(_,id)=>({id:9-id,reason:'순위'})),practitioner:Array.from({length:5},(_,id)=>({id:14-id,reason:'순위'}))}};
  if(args.cwd.endsWith('attention-agent')){assert.equal(args.schema.properties.checks.minItems,3);assert.equal(args.schema.properties.checks.maxItems,3);return {response:{checks:Array.from({length:3},(_,candidate_index)=>({candidate_index,status:'weak',limits:'제한적',evidence:[]}))}};}
  assert.equal(args.schema.properties.candidates.maxItems,15);return {response:{candidates:all,shortage_reason:''}};
 };
 const result=await generateRankedCandidates({config,items:all.map(c=>({url:c.anchor_url})),today:'2026-10-11',now:NOW,cwd,web:{search:async()=>({results:[]})},runner});
 assert.deepEqual(result.candidates.map(c=>c.title),['주제 9','주제 8','주제 14']);assert.deepEqual(result.poolCounts,{general:10,practitioner:5});
});
test('상황별 카드 푸시는 없는 후보·실패·피드백을 구분하고 지난 상태는 보내지 않는다',t=>{
 const {db,store}=setup(t);db.exec("CREATE TABLE assistant_push_subscriptions(id INTEGER PRIMARY KEY,status TEXT,endpoint TEXT,p256dh TEXT,auth TEXT,failure_count INTEGER DEFAULT 0,last_success_at INTEGER,updated_at INTEGER);INSERT INTO assistant_push_subscriptions(id,status) VALUES(1,'active')");
 const {createCardsPushService,buildCardsPushPayload}=require('../lib/cards/push'),push=createCardsPushService(db,{now:()=>NOW,quietHours:()=>({enabled:false})});
 store.claimRun('2026-10-11');store.saveBatch({day:'2026-10-11',candidates:[],shortageReason:'없음'});push.enqueueEmpty('2026-10-11',NOW);let c=push.claim(NOW);assert.equal(JSON.parse(buildCardsPushPayload(c)).type,'cards_candidates_empty');push.accept(c,201,NOW);
 store.claimRun('2026-10-12');store.failRun('2026-10-12',{code:'FAIL'});push.enqueueFailure('2026-10-12',NOW);c=push.claim(NOW);assert.equal(JSON.parse(buildCardsPushPayload(c)).type,'cards_candidates_failed');
 store.saveBatch({day:'2026-10-12',candidates:[candidate],shortageReason:''});assert.equal(push.isClaimSendable(c,NOW),false);
 const d=store.submitManual({message:'SECRET_TOPIC',id:null,revision:0});store.claimManual();store.finishManual({...d,feedback:'SECRET_FEEDBACK',candidate});push.enqueueTopic(d.id,d.revision,NOW);c=push.claim(NOW);const raw=buildCardsPushPayload(c);assert.equal(JSON.parse(raw).type,'cards_topic_reviewed');assert.ok(!raw.includes('SECRET'));store.approveManual(d);assert.equal(push.isClaimSendable(c,NOW),false);
});
test('실제 서비스 워커 알림 문구는 후보·없음·실패·피드백·완성본 상황과 맞는다',async()=>{
 const vm=require('node:vm'),handlers={},shown=[],waits=[];
 const self={addEventListener:(name,fn)=>{handlers[name]=fn;},location:{origin:'https://example.com'},registration:{showNotification:async(title,options)=>shown.push({title,...options})}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/sw.js'),'utf8'),{self,URL});
 const types=['cards_candidates','cards_candidates_empty','cards_candidates_failed','cards_topic_reviewed','cards_topic_failed','cards_episode','cards_episode_failed'];
 for(const type of types)handlers.push({data:{json:()=>({type,batchId:'2026-10-11',episodeId:1,url:'/?panel=agents'})},waitUntil:p=>waits.push(p)});
 await Promise.all(waits);assert.equal(shown.length,7);assert.match(shown[0].body,/하나 골라/);assert.match(shown[1].body,/주제를 찾지 못/);assert.match(shown[2].body,/수집을 완료하지 못/);assert.match(shown[3].body,/승인하거나 수정/);assert.match(shown[4].body,/확인을 완료하지 못/);assert.match(shown[5].body,/제작이 완료/);assert.match(shown[6].body,/제작을 완료하지 못/);
});
test('순위 ID 중복은 원문·화제성 재수집 없이 재검토하고 최대 두 번 수정한다',async t=>{
 const {rankCheckedCandidates}=require('../lib/cards/ranked'),checked=[candidate,{...candidate,title:'다른 주제'}];let calls=0;
 const runner=async args=>{calls++;assert.equal(args.schema.properties.general.minItems,2);return {response:{general:calls===1?[{id:0,reason:'중복'},{id:0,reason:'중복'}]:[{id:1,reason:'높은 순위'},{id:0,reason:'다음'}],practitioner:[]}};};
 const result=await rankCheckedCandidates({config:cardsConfig({}),checked,dir:temp(t),runner});assert.equal(calls,2);assert.equal(result.candidates[0].title,'다른 주제');
 calls=0;await assert.rejects(rankCheckedCandidates({config:cardsConfig({}),checked,dir:temp(t),runner:async()=>{calls++;return {response:{general:[],practitioner:[]}};}}),{code:'CARDS_RANK_INVALID'});assert.equal(calls,3);
});
test('제작 실패 푸시는 현재 실패만 보내고 재시도하면 지난 실패를 막는다',t=>{
 const {db,store}=setup(t);db.exec("CREATE TABLE assistant_push_subscriptions(id INTEGER PRIMARY KEY,status TEXT,endpoint TEXT,p256dh TEXT,auth TEXT,failure_count INTEGER DEFAULT 0,last_success_at INTEGER,updated_at INTEGER);INSERT INTO assistant_push_subscriptions(id,status) VALUES(1,'active')");
 store.claimRun('2026-10-11');store.saveBatch({day:'2026-10-11',candidates:[candidate]});const {jobId}=store.selectCandidate(store.latestBatch().cards[0].id);store.claimProduction();store.finishFailed(jobId,{code:'MODEL_EXIT'},{});
 const {createCardsPushService,buildCardsPushPayload}=require('../lib/cards/push'),push=createCardsPushService(db,{now:()=>NOW,quietHours:()=>({enabled:false})});push.enqueueProductionFailure(jobId);const c=push.claim();assert.equal(JSON.parse(buildCardsPushPayload(c)).type,'cards_episode_failed');assert.equal(push.isClaimSendable(c),true);store.retry(jobId);assert.equal(push.isClaimSendable(c),false);
});
