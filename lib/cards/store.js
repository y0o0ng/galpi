'use strict';
const {randomUUID}=require('node:crypto');
const {kstDay}=require('../reels/worker');
const { fail } = require('./runner');
function createCardsStore(db,{now=()=>Math.floor(Date.now()/1000)}={}) {
  const query = (sql,...args)=>db.prepare(sql).get(...args);
  const all = (sql,...args)=>db.prepare(sql).all(...args);
  const run = (sql,...args)=>db.prepare(sql).run(...args);
  const getJob=id=>query('SELECT j.*,c.data_json FROM cards_jobs j JOIN cards_candidates c ON c.id=j.candidate_id WHERE j.id=?',id);
  const decode = row=>({...row,candidate:JSON.parse(row.data_json)});
  const manualKey='cards.manual_topic';
  const manual=()=>{const row=query('SELECT value_json FROM app_settings WHERE key=?',manualKey);return row?JSON.parse(row.value_json):null;};
  const saveManual=value=>run('INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,version=version+1,updated_at=excluded.updated_at',manualKey,JSON.stringify(value),now());
  const submitManual=db.transaction(({message,id,revision})=>{
    if(typeof message!=='string'||!message.trim()||message.length>2000)throw fail('CARDS_TOPIC_INVALID');
    let current=manual();
    if(current&&(id!==current.id||revision!==current.revision))throw fail('CARDS_TOPIC_STALE');
    if(current&&['queued','reviewing'].includes(current.status))throw fail('CARDS_TOPIC_BUSY');
    if(!current||current.status==='approved')current={id:randomUUID(),revision:0,messages:[]};
    const next={...current,revision:current.revision+1,status:'queued',candidate:null,errorCode:null,jobId:null,
      messages:[...current.messages,{role:'user',text:message.trim(),at:now()}]};saveManual(next);return next;
  });
  const approveManual=db.transaction(({id,revision})=>{
    const current=manual();if(!current||current.id!==id||current.revision!==revision)throw fail('CARDS_TOPIC_STALE');
    if(current.status!=='ready'||!current.candidate)throw fail('CARDS_NOT_PENDING');
    const day=`${kstDay(now())}-manual-${current.id}`;
    run("INSERT INTO cards_runs(day,outcome,attempts,created_at,finished_at) VALUES(?,'ok',1,?,?)",day,now(),now());
    const candidateId=Number(run("INSERT INTO cards_candidates(batch_id,position,data_json,status,created_at) VALUES(?,1,?,'candidate',?)",day,JSON.stringify(current.candidate),now()).lastInsertRowid);
    const result=select(candidateId);current.status='approved';current.jobId=result.jobId;saveManual(current);
    run('INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?)',`cards.manual_topic.${current.id}`,JSON.stringify(current),now());return result;
  });
  const saveBatch=db.transaction(({day,candidates,shortageReason})=>{
    candidates.forEach((c,i)=>run('INSERT INTO cards_candidates(batch_id,position,data_json,created_at) VALUES(?,?,?,?)',day,i+1,JSON.stringify(c),now()));
    run("UPDATE cards_runs SET outcome='ok',shortage_reason=?,finished_at=? WHERE day=?",shortageReason,now(),day);
  });
  const select=db.transaction(id=>{
    const c=query('SELECT * FROM cards_candidates WHERE id=?',id);
    if(!c) throw fail('CARDS_NOT_FOUND');
    if(run("UPDATE cards_candidates SET status='selected' WHERE id=? AND status IN ('candidate','held')",id).changes!==1) throw fail('CARDS_NOT_PENDING');
    run("UPDATE cards_candidates SET status='dropped' WHERE batch_id=? AND id!=? AND status IN ('candidate','held')",c.batch_id,id);
    const jobId=Number(run("INSERT INTO cards_jobs(candidate_id,created_at) VALUES(?,?)",id,now()).lastInsertRowid);
    return {id,jobId};
  });
  const claim=db.transaction(()=>{
    if(query("SELECT 1 FROM cards_jobs WHERE status='producing'")) return null;
    const row=query("SELECT id FROM cards_jobs WHERE status='queued' OR (status='failed' AND attempts<3 AND finished_at<=?) ORDER BY id LIMIT 1",now()-3600);
    if(!row) return null;
    run("UPDATE cards_jobs SET status='producing',attempts=attempts+1,finished_at=NULL WHERE id=?",row.id);
    return decode(getJob(row.id));
  });
  const approve=db.transaction((id,validate)=>{
    const row=getJob(id); if(!row) throw fail('CARDS_NOT_FOUND');
    if(row.status!=='ready') throw fail('CARDS_NOT_PENDING');
    validate(JSON.parse(row.record_json));
    run("UPDATE cards_jobs SET status='approved',decided_at=? WHERE id=?",now(),id); return {id,status:'approved'};
  });
  const claimUpload=db.transaction(()=>{
    if(query("SELECT 1 FROM cards_jobs WHERE publish_status='uploading'"))return null;
    const row=query("SELECT id FROM cards_jobs WHERE status='approved' AND publish_status='pending' ORDER BY id LIMIT 1");
    if(!row)return null;
    run("UPDATE cards_jobs SET publish_status='uploading' WHERE id=?",row.id);return getJob(row.id);
  });
  return {
    claimRun(day) {
      if(run("INSERT OR IGNORE INTO cards_runs(day,outcome,attempts,created_at) VALUES(?,'started',1,?)",day,now()).changes)return true;
      return run("UPDATE cards_runs SET outcome='started',attempts=attempts+1 WHERE day=? AND outcome='failed' AND attempts<3 AND finished_at<=?",day,now()-3600).changes===1;
    },saveBatch,selectCandidate:select,
    failRun(day,error){run("UPDATE cards_runs SET outcome='failed',error_code=?,finished_at=? WHERE day=?",error.code||'CARDS_FAILED',now(),day);},
    decideBatch(day,action){
      const status=action==='hold'?'held':'dropped';
      if(!run("UPDATE cards_candidates SET status=? WHERE batch_id=? AND status IN ('candidate','held')",status,day).changes)throw fail('CARDS_NOT_PENDING');
      return {batchId:day,status};
    },
    latestBatch(){const row=query('SELECT * FROM cards_runs ORDER BY day DESC LIMIT 1');if(!row)return null;
      const cards=all('SELECT * FROM cards_candidates WHERE batch_id=? ORDER BY position',row.day).map(decode);
      const status=row.outcome==='started'?'collecting':row.outcome==='failed'?'failed':!cards.length?'empty':cards.some(c=>c.status==='selected')?'selected':cards.some(c=>c.status==='candidate')?'candidate':cards.some(c=>c.status==='held')?'held':'dropped';
      return {batchId:row.day,status,cards,shortageReason:row.shortage_reason,errorCode:row.error_code};},
    expireStale(){run("UPDATE cards_candidates SET status='dropped' WHERE status IN ('candidate','held') AND created_at<=?",now()-3*86400);},
    claimProduction:claim,getJob,latestJob(){const r=query('SELECT id FROM cards_jobs ORDER BY id DESC LIMIT 1');return r?getJob(r.id):null;},
    plan(id,{workDir,outDir,date}){run('UPDATE cards_jobs SET work_dir=?,out_dir=?,date=? WHERE id=? AND work_dir IS NULL',workDir,outDir,date,id);return getJob(id);},
    finishOk(id,record){run("UPDATE cards_jobs SET status='ready',record_json=?,stage=NULL,error_code=NULL,finished_at=? WHERE id=? AND status='producing'",JSON.stringify(record),now(),id);},
    finishFailed(id,error,record){const blocked=/BLOCKED|FIX_LIMIT|INPUT_CHANGED|ARTIFACT_CHANGED/.test(error.code||'');
      run('UPDATE cards_jobs SET status=?,error_code=?,record_json=COALESCE(?,record_json),finished_at=? WHERE id=? AND status=\'producing\'',blocked?'blocked':'failed',error.code||'CARDS_FAILED',record?JSON.stringify(record):null,now(),id);},
    stage(id,name){run('UPDATE cards_jobs SET stage=? WHERE id=?',name,id);},
    approve,
    discard(id){if(!run("UPDATE cards_jobs SET status='discarded',decided_at=? WHERE id=? AND status IN ('ready','failed','blocked','queued')",now(),id).changes)throw fail('CARDS_NOT_PENDING');return {id,status:'discarded'};},
    retry(id){if(!run("UPDATE cards_jobs SET status='queued',attempts=0 WHERE id=? AND status IN ('failed','blocked')",id).changes)throw fail('CARDS_NOT_PENDING');return {id,status:'queued'};},
    manualTopic:manual,submitManual,approveManual,
    claimManual:db.transaction(()=>{const current=manual();if(current?.status!=='queued')return null;current.status='reviewing';saveManual(current);return current;}),
    finishManual({id,revision,feedback,candidate,errorCode}){const current=manual();if(!current||current.id!==id||current.revision!==revision||current.status!=='reviewing')throw fail('CARDS_TOPIC_STALE');
      current.status=candidate?'ready':'feedback';current.candidate=candidate||null;current.errorCode=errorCode||null;current.messages.push({role:'assistant',text:feedback,at:now()});saveManual(current);},
    recoverManual(){const current=manual();if(current?.status==='reviewing'){current.status='feedback';current.candidate=null;current.errorCode='CARDS_INTERRUPTED';current.messages.push({role:'assistant',text:'확인 중 서버가 재시작돼 중단됐어. 다시 메시지를 보내면 확인을 이어갈게.',at:now()});saveManual(current);}},
    usedTopics(){return all("SELECT c.data_json FROM cards_jobs j JOIN cards_candidates c ON c.id=j.candidate_id WHERE j.status IN ('ready','approved','discarded') AND j.record_json IS NOT NULL ORDER BY j.id DESC LIMIT 30").map(r=>{const c=JSON.parse(r.data_json);return {title:c.title,url:c.anchor_url};});},
    enqueueUpload(id){run("UPDATE cards_jobs SET publish_status='pending' WHERE id=? AND status='approved' AND publish_status IS NULL",id);},claimUpload,
    finishUpload(id,result){run('UPDATE cards_jobs SET publish_status=?,remote_url=?,publish_error=? WHERE id=? AND publish_status=\'uploading\'',result.ok?'done':'failed',result.url||null,result.code||null,id);},
    markInterrupted(){run("UPDATE cards_jobs SET status='failed',error_code='CARDS_INTERRUPTED',finished_at=? WHERE status='producing'",now());
      run("UPDATE cards_runs SET outcome='failed',error_code='CARDS_INTERRUPTED',finished_at=? WHERE outcome='started'",now());
      run("UPDATE cards_jobs SET publish_status='unknown',publish_error='CARDS_UPLOAD_INTERRUPTED' WHERE publish_status='uploading'");},
  };
}
module.exports={createCardsStore};
