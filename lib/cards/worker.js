'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { kstDay, RUN_AT_KST_SECONDS } = require('../reels/worker');
const { collectCrawlerItems } = require('./crawler');
const { selectCrawlerCandidates } = require('./ranked');
const { reviewManualTopic } = require('./manual');
const { produceCard, verifySnapshot } = require('./production');
function createCardsWorker({store,config,web,pushService,pushDispatcher,uploader,collect=collectCrawlerItems,
  select=selectCrawlerCandidates,reviewTopic=reviewManualTopic,produce=produceCard,now=()=>Math.floor(Date.now()/1000),onError=()=>{},intervalMs=5*60*1000}) {
  let collecting=null,reviewing=null,producing=null,uploading=null,timer=null,controller=null,collectionController=null,topicController=null;
  async function collectRun(force=false) {
    const time=now();store.expireStale();
    if(!config.enabled||(!force&&(time+9*3600)%86400<RUN_AT_KST_SECONDS))return;
    const day=kstDay(time-RUN_AT_KST_SECONDS);if(!store.claimRun(day))return;
    collectionController=new AbortController();
    try {
      const items=await collect({web,config,now:time,signal:collectionController.signal});
      const result=await select({config,items,web,today:day,now:time,cwd:path.join(config.workRoot,'candidates',day),signal:collectionController.signal,usedTopics:store.usedTopics()});
      store.saveBatch({day,...result});if(result.candidates.length)pushService?.enqueueBatch(day,now());else pushService?.enqueueEmpty(day,now());void pushDispatcher?.tick();
    } catch(error){store.failRun(day,error);pushService?.enqueueFailure(day,now());void pushDispatcher?.tick();onError(error);}finally{collectionController=null;}
  }
  async function manualRun(){
    if(!config.enabled)return;
    const dialogue=store.claimManual();if(!dialogue)return;topicController=new AbortController();
    try{const result=await reviewTopic({dialogue,config,web,today:kstDay(now()),now:now(),cwd:path.join(config.workRoot,'manual',dialogue.id,`revision-${dialogue.revision}`),signal:topicController.signal});store.finishManual({...dialogue,...result});pushService?.enqueueTopic(dialogue.id,dialogue.revision,now());void pushDispatcher?.tick();}
    catch(error){store.finishManual({...dialogue,candidate:null,errorCode:error.code||'CARDS_FAILED',feedback:'근거 확인을 완료하지 못했어요. 내용이나 링크를 보충해서 다시 보내주세요.'});pushService?.enqueueTopic(dialogue.id,dialogue.revision,now());void pushDispatcher?.tick();onError(error);}
    finally{topicController=null;}
  }
  async function productionRun() {
    const kstSecond=(now()+9*3600)%86400;
    if(!config.productionEnabled||kstSecond<3*3600||kstSecond>=7*3600)return;
    let job=store.claimProduction();if(!job)return;
    job=store.plan(job.id,{workDir:path.join(config.workRoot,`card-${job.id}`),outDir:path.join(config.mediaRoot,`card-${job.id}`),date:kstDay(now())});
    controller=new AbortController();
    try {
      const record=await produce({candidate:JSON.parse(job.data_json),cardId:job.id,date:job.date,config,
        workDir:job.work_dir,outDir:job.out_dir,signal:controller.signal,onStage:name=>store.stage(job.id,name)});
      store.finishOk(job.id,record);pushService?.enqueueEpisode(job.id,now());void pushDispatcher?.tick();
    } catch(error){let record;try{record=JSON.parse(fs.readFileSync(path.join(job.work_dir,'production.json'),'utf8'));}catch{}
      store.finishFailed(job.id,error,record);pushService?.enqueueProductionFailure(job.id,now());void pushDispatcher?.tick();onError(error);
    }finally{controller=null;}
  }
  async function uploadRun() {
    if(!config.uploadEnabled||!uploader)return;
    const job=store.claimUpload();if(!job)return;
    try {
      const record=JSON.parse(job.record_json);verifySnapshot(record.snapshot);
      await uploader.refreshTokenIfDue();
      const result=await uploader.uploadCarousel({imagePaths:record.jpeg,caption:record.caption});
      store.finishUpload(job.id,{ok:true,url:result.permalink||result.mediaId});
    }catch(error){store.finishUpload(job.id,{ok:false,code:error.code||'CARDS_UPLOAD_FAILED'});onError(error);}
  }
  const worker={
    collectNow(){if(!collecting)collecting=collectRun(true).catch(onError).finally(()=>{collecting=null;});return collecting;},
    tickManual(){if(!reviewing)reviewing=manualRun().catch(onError).finally(()=>{reviewing=null;});return reviewing;},
    tickUpload(){if(!uploading)uploading=uploadRun().catch(onError).finally(()=>{uploading=null;});return uploading;},
    tick(){
      if(!collecting)collecting=collectRun().catch(onError).finally(()=>{collecting=null;});
      if(!producing)producing=productionRun().catch(onError).finally(()=>{producing=null;});
      return Promise.all([collecting,producing,this.tickUpload(),this.tickManual()]);
    },
    start(){if(timer)return;store.markInterrupted();store.recoverManual();void uploader?.cleanup().catch(onError);void this.tick();
      timer=setInterval(()=>void this.tick(),intervalMs);timer.unref?.();},
    stop(){if(timer)clearInterval(timer);timer=null;controller?.abort();collectionController?.abort();topicController?.abort();},
  };return worker;
}
module.exports={createCardsWorker};
