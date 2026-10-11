'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {verifySnapshot}=require('./production');
function jobJson(row){
  if(!row)return null;
  const record=row.record_json?JSON.parse(row.record_json):null;
  return {id:row.id,title:JSON.parse(row.data_json).title,status:row.status,stage:row.stage,errorCode:row.error_code,
    finishedAt:row.finished_at,caption:record?.caption||null,claims:record?.claims||[],
    images:(record?.images||[]).map((_,i)=>`/api/cards/jobs/${row.id}/images/${i+1}`),
    downloads:record?.outcome==='ok'&&['ready','approved'].includes(row.status)?(record.jpeg||[]).map((_,i)=>`/api/cards/jobs/${row.id}/images/${i+1}?download=1`):[],
    publishStatus:row.publish_status,publishError:row.publish_error,
    remoteUrl:/^https:\/\/(www\.)?instagram\.com\//.test(row.remote_url||'')?row.remote_url:null};
}
function registerCardsRoutes({app,store,config,onUpload=()=>{},onTopic=()=>{}}){
  const id=value=>/^[1-9]\d{0,9}$/.test(String(value))?Number(value):null;
  function guard(res,production=false){if(production?config.productionEnabled:config.enabled)return false;
    res.status(503).json({code:'CARDS_DISABLED',error:'카드뉴스가 아직 활성화되지 않았어.'});return true;}
  function act(res,fn){try{return res.json(fn());}catch(error){const status={CARDS_NOT_FOUND:404,CARDS_NOT_PENDING:409,CARDS_ARTIFACT_CHANGED:409,CARDS_TOPIC_STALE:409,CARDS_TOPIC_BUSY:409,CARDS_TOPIC_INVALID:400}[error.code]||500;
    return res.status(status).json({code:error.code||'CARDS_FAILED',error:'요청을 처리하지 못했어.'});}}
  app.get('/api/cards/topic',(_req,res)=>{if(!guard(res))res.json({dialogue:store.manualTopic()});});
  app.post('/api/cards/topic/messages',(req,res)=>{if(guard(res))return;return act(res,()=>{const dialogue=store.submitManual(req.body||{});onTopic();return {dialogue};});});
  app.post('/api/cards/topic/approve',(req,res)=>{if(guard(res,true))return;return act(res,()=>store.approveManual(req.body||{}));});
  app.get('/api/cards/latest',(_req,res)=>{if(!guard(res))res.json({batch:store.latestBatch()});});
  app.post('/api/cards/candidates/:id/select',(req,res)=>{if(guard(res))return;const n=id(req.params.id);
    if(!n)return res.status(400).json({code:'CARDS_ID_INVALID'});return act(res,()=>store.selectCandidate(n));});
  for(const action of ['hold','reject'])app.post(`/api/cards/batches/:batchId/${action}`,(req,res)=>{
    if(guard(res))return;if(!/^\d{4}-\d{2}-\d{2}$/.test(req.params.batchId))return res.status(400).json({code:'CARDS_ID_INVALID'});
    return act(res,()=>store.decideBatch(req.params.batchId,action));});
  app.get('/api/cards/jobs/latest',(_req,res)=>{if(!guard(res,true))res.json({job:jobJson(store.latestJob())});});
  for(const action of ['approve','discard','retry'])app.post(`/api/cards/jobs/:id/${action}`,(req,res)=>{
    if(guard(res,true))return;const n=id(req.params.id);if(!n)return res.status(400).json({code:'CARDS_ID_INVALID'});
    return act(res,()=>{const result=action==='approve'?store.approve(n,record=>{if(record.outcome!=='ok')throw new Error('unreviewed');verifySnapshot(record.snapshot);}):store[action](n);
      if(action==='approve'&&config.uploadEnabled){store.enqueueUpload(n);onUpload();}return result;});});
  app.get('/api/cards/jobs/:id/images/:page',(req,res)=>{
    if(guard(res,true))return;const row=store.getJob(id(req.params.id)||0),page=id(req.params.page);
    const record=row?.record_json?JSON.parse(row.record_json):null;
    const download=req.query?.download==='1';
    if(download){
      if(record?.outcome!=='ok'||!['ready','approved'].includes(row?.status))return res.status(409).json({code:'CARDS_NOT_READY'});
      try{verifySnapshot(record.snapshot);}catch(error){return res.status(409).json({code:error.code||'CARDS_ARTIFACT_CHANGED'});}
    }
    const file=page&&(download?record?.jpeg:record?.images)?.[page-1];
    const root=fs.existsSync(config.mediaRoot)?fs.realpathSync(config.mediaRoot)+path.sep:null;
    let resolved;try{resolved=file&&fs.realpathSync(file);}catch{}
    if(!root||!resolved?.startsWith(root))return res.status(404).json({code:'CARDS_NOT_FOUND'});
    res.set('Cache-Control','no-store');
    if(download)return res.download(resolved,`sionwhy-${row.id}-${String(page).padStart(2,'0')}.jpg`,error=>{if(error&&!res.headersSent)res.status(404).json({code:'CARDS_NOT_FOUND'});});
    res.sendFile(resolved,error=>{if(error&&!res.headersSent)res.status(404).json({code:'CARDS_NOT_FOUND'});});
  });
}
module.exports={jobJson,registerCardsRoutes};
