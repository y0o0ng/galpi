'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { fail, promptFor, runCodex } = require('./runner');
const { normalizePublicWebUrl } = require('../web/service');
const { hash, manuscript, section, snapshot, verifySnapshot, validateDeck, within, python, checkFacts } = require('./production');
const PREFIX = 'cards_integrated_trial/';
const OUTPUTS = ['manuscript.md','deck.json','caption.txt','report.md','self-review.md','art.py','render_episode.py','assets.json'];
const VISUAL_REVIEW_POLICY = `
## 통합 흐름의 시각 판정 범위 — 이 지시가 분리형 지침보다 우선한다
출처 NEEDS_FIX는 시각 BLOCKED 사유가 아니다. 출처 보고서의 S 항목을 V MUST로 복제하지 않고, 시각 검토는 이미지·배치·가독성·브랜드·원고와 이미지의 일치만 독립적으로 판정한다.
이 편의 문구·그림·배치·렌더 코드 수정이나 원고 보완으로 해결 가능한 문제는 NEEDS_FIX다. 필수 자료·이미지를 확인할 수 없거나 허용된 편 수정 범위로 해결할 수 없을 때만 BLOCKED다.
시각 문제가 없으면 시각 PASS로 판정한다. 이는 출처 문제의 해결이나 게시 승인이 아니며 서버는 두 검토의 현재 입력 PASS를 모두 요구한다.
보고서를 완료했으면 최종 JSON status는 ok다. 보고서의 PASS/NEEDS_FIX/BLOCKED는 작품의 판정이고 JSON status는 보고서 작성 완료 여부다. 보고서 자체를 완료할 수 없을 때만 JSON status를 blocked로 반환한다.
`;
// 출처 검토에는 게시 문구와 사실만 전달한다. 제작 경로나 시각 규격은 입력이 아니다.
const TEXT_KEYS = new Set(['mode','topic','date','source','cards','title','subtitle','body','statement','text','items','columns','name','names','label','labels','rows','value','values','unit','note','notes','attribution','criterion','criteria','condition','conditions','caption','purpose','question','answer','description','detail','details','summary','takeaway','meaning','content','art','photo']);
function postedText(value) {
  if (Array.isArray(value)) return value.map(postedText);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key,v]) => TEXT_KEYS.has(key) && (!['art','photo'].includes(key) || (v && typeof v === 'object'))).map(([key,v]) => [key,postedText(v)]));
}
function files(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root,{withFileTypes:true}).flatMap(entry => {
    const file = path.join(root,entry.name);
    if (entry.isSymbolicLink()) { within(file,root); throw fail('CARDS_SYMLINK'); }
    return entry.isDirectory() ? files(file) : [file];
  });
}
function validateAgentResult(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).length !== 2
    || !['ok','blocked'].includes(value.status) || typeof value.message !== 'string') throw fail('CARDS_AGENT_RESPONSE');
  if (value.status === 'blocked') throw fail('CARDS_AGENT_BLOCKED', value.message);
}
function parseReview(text, prefix) {
  const counts = /^MUST (\d+) \/ NICE (\d+)\s*$/m.exec(text);
  const status = /^판정:\s*(PASS|NEEDS_FIX|BLOCKED)\s*$/m.exec(text)?.[1];
  if (!counts || !status) throw fail('CARDS_REVIEW_FORMAT');
  const must = Number(counts[1]), nice = Number(counts[2]);
  if (status !== 'BLOCKED' && (status === 'PASS') !== (must === 0)) throw fail('CARDS_REVIEW_CONTRADICTION');
  // NICE의 ID는 개수 검사에서 제외한다. ID는 보고서의 항목 제목에서 센다.
  const ids = [...text.matchAll(new RegExp(`^\\s*(?:#{1,6}\\s*)?(?:[-*]\\s*)?(?:\\*\\*)?(${prefix}\\d+)\\b[^\\n]*\\bMUST\\b`, 'gm'))].map(m => m[1]);
  if (new Set(ids).size !== must) throw fail('CARDS_REVIEW_COUNT');
  return { status, must, nice };
}
function assets(assembly) {
  const data = JSON.parse(fs.readFileSync(path.join(assembly,'assets.json'),'utf8'));
  if (!Array.isArray(data)) throw fail('CARDS_ASSETS_INVALID');
  for (const asset of data) {
    if (!asset.file || !['photo','pixel'].includes(asset.kind)) throw fail('CARDS_ASSETS_INVALID');
    within(path.resolve(assembly,asset.file),assembly);
    if (asset.source_url) normalizePublicWebUrl(asset.source_url);
    if (asset.kind === 'photo' && (!asset.source_url || !asset.provider?.trim() || !asset.usage_terms?.trim())) throw fail('CARDS_PHOTO_SOURCE');
  }
  return {metadata:data.map(asset => Object.fromEntries(['kind','source_url','provider','usage_terms','caption','purpose'].filter(key=>Object.hasOwn(asset,key)).map(key=>[key,asset[key]]))),
    assetFiles:new Set(data.map(asset=>asset.file))};
}
function sourceInput(data, metadata, sources) {
  metadata = metadata.map(asset=>Object.fromEntries(['source_url','provider','usage_terms','caption'].filter(key=>Object.hasOwn(asset,key)).map(key=>[key,asset[key]])));
  const text = `## 조립 원고\n\n\`\`\`json\n${JSON.stringify(postedText(data.deck),null,2)}\n\`\`\`\n\n## 게시 캡션\n${data.caption}\n\n## 사실 확인 목록\n${section(data.text,'사실 확인 목록')}\n`;
  const originals = files(sources).filter(file => /\.(txt|md|html?|json|xml|csv)$/i.test(file) && path.basename(file) !== 'source-map.json');
  const mapFile=path.join(sources,'source-map.json');
  const mapping=fs.existsSync(mapFile) ? Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(mapFile,'utf8'))).map(([url,file])=>[url,path.relative(sources,file)])) : {};
  const digest = hash(JSON.stringify({text,metadata,mapping,originals:originals.map(file=>[path.relative(sources,file),hash(fs.readFileSync(file))])}));
  return { text, metadata, originals, digest };
}
async function produceIntegrated({candidate,cardId,date,config,workDir,outDir,signal,runner=runCodex,onStage=()=>{}}) {
  workDir = path.resolve(workDir); outDir = path.resolve(outDir);
  const assembly = path.join(workDir,'assembly'), sources = path.join(workDir,'sources');
  for (const dir of [workDir,outDir,assembly,sources]) fs.mkdirSync(dir,{recursive:true});
  const contractFiles = ['README','create','review_sources','review_visual','fix'].map(name => path.join(config.root,'reels/prompts',PREFIX+name+'.md'));
  contractFiles.push(...['script_cards_news','script_cards_compare','review_cards','review_visual_cards'].map(name => path.join(config.root,'reels/prompts',name+'.md')),
    ...['README.md','design-v0.2.md','render.py','render_job.py','finalize_integrated.py'].map(name => path.join(config.root,'reels/cards',name)),path.join(config.root,'reels/px/sprite.py'),
    config.font,config.boldFont,path.join(config.root,'reels/px/fonts/DNFBitBitv2.otf'));
  const contract = snapshot(contractFiles);
  const identity = hash(JSON.stringify({pipeline:'integrated-v1',candidate,cardId,date,createModel:config.scriptModel,reviewModel:config.reviewModel,fixModel:config.buildModel,effort:'medium',contract}));
  const recordPath = path.join(workDir,'production.json');
  let record = fs.existsSync(recordPath) ? JSON.parse(fs.readFileSync(recordPath,'utf8')) : {identity,pipeline:'integrated-v1',stages:[],outcome:'running'};
  if (record.identity !== identity) throw fail('CARDS_INPUT_CHANGED');
  const persist = () => { fs.writeFileSync(recordPath+'.tmp',JSON.stringify(record,null,2));fs.renameSync(recordPath+'.tmp',recordPath); };
  if (record.outcome === 'ok') { verifySnapshot(record.snapshot); return record; }
  const currentFiles = () => [...files(assembly),...files(sources),...files(outDir)];
  function checkpoint(name, entry) {
    const dir = path.join(workDir,'checkpoints',name);
    fs.mkdirSync(dir,{recursive:true});
    const mapping = {};
    for (const [label,root] of [['assembly',assembly],['sources',sources],['images',outDir]]) for (const original of files(root)) {
      const saved = path.join(dir,label,path.relative(root,original)); fs.mkdirSync(path.dirname(saved),{recursive:true});fs.copyFileSync(original,saved);mapping[original]=saved;
    }
    entry.outputs = snapshot(Object.values(mapping)); record.checkpoint = {name,mapping,outputs:entry.outputs};record.currentSnapshot=snapshot(currentFiles());
  }
  // 중단된 수정만 마지막 완성 checkpoint로 되돌린다. 확정 파일의 변조는 복원으로 숨기지 않는다.
  if (record.checkpoint) {
    verifySnapshot(record.checkpoint.outputs);
    if (record.stages.at(-1)?.name.startsWith('fix-') && record.stages.at(-1).result !== 'ok') {
      const archive = path.join(workDir,'interrupted',String(record.stages.length));
      for (const [label,root] of [['assembly',assembly],['sources',sources],['images',outDir]]) {
        fs.cpSync(root,path.join(archive,label),{recursive:true});fs.rmSync(root,{recursive:true,force:true});fs.mkdirSync(root,{recursive:true});
      }
      for (const [original,saved] of Object.entries(record.checkpoint.mapping)) {fs.mkdirSync(path.dirname(original),{recursive:true});fs.copyFileSync(saved,original);}
      record.restorations ||= [];record.restorations.push({at:new Date().toISOString(),checkpoint:record.checkpoint.name,archive});
    } else verifySnapshot(record.currentSnapshot);
  }
  const createPromptPath = path.join(workDir,'create-prompt.md');
  const createPrompt = promptFor(config.root,PREFIX+'create',{card_id:String(cardId),candidate_card:JSON.stringify(candidate),mode:candidate.mode,date,
    work_dir:assembly,out_dir:outDir,src_dir:sources,repo:config.root,python:config.python,font_path:config.font,bold_font_path:config.boldFont});
  if (!fs.existsSync(createPromptPath)) fs.writeFileSync(createPromptPath,createPrompt);
  else if (fs.readFileSync(createPromptPath,'utf8') !== createPrompt) throw fail('CARDS_INPUT_CHANGED');
  async function invoke(name, model, cwd, prompt, writable, images, check, readOnly={}) {
    const entry = {name,model,reasoningEffort:'medium',startedAt:new Date().toISOString(),result:'running',promptSha256:hash(prompt)};
    record.stages.push(entry);persist();onStage(name);
    const started = performance.now();
    try {
      const result = await runner({config,model,cwd,prompt,writable,images,signal,reasoningEffort:'medium'});entry.usage=result.usage;
      verifySnapshot(contract); if (Object.keys(readOnly).length) verifySnapshot(readOnly);
      validateAgentResult(result.response);
      await check(entry);entry.result='ok';
    } catch (error) {entry.result='failed';entry.code=error.code||'CARDS_FAILED';throw error;}
    finally {entry.finishedAt=new Date().toISOString();entry.durationMs=performance.now()-started;persist();}
    return entry;
  }
  async function validateAndFinalize() {
    for (const name of OUTPUTS) if (!fs.existsSync(path.join(assembly,name)) || !fs.statSync(path.join(assembly,name)).size) throw fail('CARDS_STAGE_OUTPUT');
    const data = manuscript(path.join(assembly,'manuscript.md'),candidate.mode,date);
    const {metadata,assetFiles} = assets(assembly);
    validateDeck(path.join(assembly,'deck.json'),data.deck,assembly,data.caption,assetFiles);
    const claims = await checkFacts(config,path.join(assembly,'manuscript.md'),sources,signal,metadata);
    currentFiles(); // symlink로 작업 경계 밖 파일을 읽거나 finalizer 쓰기를 우회하지 않는다.
    // 임의 episode Python은 Codex sandbox 안에서만 실행된다. 서버는 공용 프레임/규격만 확정한다.
    await python(config,[path.join(config.root,'reels/cards/finalize_integrated.py'),path.join(assembly,'deck.json'),'--out',outDir,'--font',config.font,'--bold-font',config.boldFont],signal);
    const images = data.deck.cards.map((_,i) => path.join(outDir,String(i+1).padStart(2,'0')+'.png'));
    const mobile = images.map(file => path.join(outDir,'mobile',path.basename(file)));
    const jpeg = images.map(file => path.join(outDir,'jpeg',path.basename(file,'.png')+'.jpg'));
    return {data,metadata,claims,images,mobile,jpeg};
  }
  async function review(kind,round,state,sourceReviewPath) {
    const input = sourceInput(state.data,state.metadata,sources);
    const digest = kind === 'source' ? input.digest : hash(JSON.stringify({deck:postedText(state.data.deck),metadata:state.metadata,images:[...state.images,...state.mobile].map(file=>hash(fs.readFileSync(file)))}));
    const policySha256=kind==='visual'?hash(VISUAL_REVIEW_POLICY):null;
    const previous = [...record.stages].reverse().find(entry=>entry.kind===kind && entry.result==='ok' && entry.inputSha256===digest
      && (kind!=='visual'||entry.policySha256===policySha256));
    if (previous) {verifySnapshot(previous.outputs);return previous;}
    const name = `${kind}-${round}`, attempts = record.stages.filter(entry=>entry.name===name).length;
    const cwd = path.join(workDir,name,`attempt-${attempts+1}`), report = path.join(cwd,'review.md');fs.mkdirSync(cwd,{recursive:true});
    let prompt, readonly, packetFiles=[];
    if (kind === 'source') {
      const packet = path.join(cwd,'input'), raw = path.join(packet,'sources');fs.mkdirSync(raw,{recursive:true});
      fs.writeFileSync(path.join(packet,'manuscript.md'),input.text);fs.writeFileSync(path.join(packet,'deck.json'),JSON.stringify(postedText(state.data.deck),null,2));
      fs.writeFileSync(path.join(packet,'caption.txt'),state.data.caption);fs.writeFileSync(path.join(packet,'assets.json'),JSON.stringify(input.metadata,null,2));
      for (const file of input.originals) {const target=path.join(raw,path.relative(sources,file));fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(file,target);}
      const originalMap = path.join(sources,'source-map.json');
      if (fs.existsSync(originalMap)) {
        const mapping=JSON.parse(fs.readFileSync(originalMap,'utf8'));
        fs.writeFileSync(path.join(raw,'source-map.json'),JSON.stringify(Object.fromEntries(Object.entries(mapping).filter(([,file])=>input.originals.includes(path.resolve(file))).map(([url,file])=>[url,path.join(raw,path.relative(sources,file))])),null,2));
      }
      prompt = promptFor(config.root,PREFIX+'review_sources',{card_id:String(cardId),candidate_card:JSON.stringify(candidate),mode:candidate.mode,work_dir:packet,src_dir:raw,repo:config.root,out_path:report});
      packetFiles=files(packet);readonly=snapshot([...currentFiles(),...packetFiles]);
    } else {
      prompt = promptFor(config.root,PREFIX+'review_visual',{card_id:String(cardId),candidate_card:JSON.stringify(candidate),work_dir:assembly,images_dir:outDir,source_review_path:sourceReviewPath,repo:config.root,out_path:report})+VISUAL_REVIEW_POLICY;
      readonly = snapshot(currentFiles());
    }
    return invoke(name,config.reviewModel,cwd,prompt,[],kind==='visual' ? state.images.flatMap((file,i)=>[file,state.mobile[i]]) : [],entry=>{
      entry.kind=kind;entry.inputSha256=digest;entry.report=report;entry.verdict=parseReview(fs.readFileSync(report,'utf8'),kind==='source'?'S':'V');entry.outputs=snapshot([report,...packetFiles]);
      if(kind==='visual')entry.policySha256=policySha256;
    },readonly);
  }
  try {
    record.outcome='running';delete record.code;delete record.detail;persist();
    if (!record.stages.some(entry=>entry.name==='create' && entry.result==='ok')) {
      // 이전 생성이 중단된 경우의 이미지/파일은 보존하고 새 생성부터 시작한다.
      if (record.stages.some(entry=>entry.name==='create')) {
        const archive=path.join(workDir,'interrupted','create-'+record.stages.length);
        for (const [label,root] of [['assembly',assembly],['sources',sources],['images',outDir]]) {fs.cpSync(root,path.join(archive,label),{recursive:true});fs.rmSync(root,{recursive:true,force:true});fs.mkdirSync(root,{recursive:true});}
      }
      await invoke('create',config.scriptModel,assembly,createPrompt,[outDir,sources],[],async entry=>{await validateAndFinalize();checkpoint('create-'+record.stages.length,entry);});
    }
    let sourceReview, visualReview, state;
    for (let round=0;round<=2;round++) {
      const completedFix = record.stages.some(entry=>entry.name===`fix-${round+1}` && entry.result==='ok');
      // 재개는 현재 checkpoint 다음 검토부터 시작한다.
      if (completedFix) continue;
      state = await validateAndFinalize();record.currentSnapshot=snapshot(currentFiles());persist();
      sourceReview = await review('source',round,state);
      if (sourceReview.verdict.status==='BLOCKED') throw fail('CARDS_SOURCE_BLOCKED');
      visualReview = await review('visual',round,state,sourceReview.report);
      if (visualReview.verdict.status==='BLOCKED') throw fail('CARDS_VISUAL_BLOCKED');
      if (sourceReview.verdict.status==='PASS' && visualReview.verdict.status==='PASS') break;
      if (round===2) throw fail('CARDS_FIX_LIMIT');
      const name=`fix-${round+1}`;
      const prompt=promptFor(config.root,PREFIX+'fix',{card_id:String(cardId),work_dir:assembly,out_dir:outDir,src_dir:sources,source_review_path:sourceReview.report,visual_review_path:visualReview.report,create_prompt_path:createPromptPath});
      await invoke(name,config.buildModel,assembly,prompt,[outDir,sources],[],async entry=>{await validateAndFinalize();checkpoint(name+'-'+record.stages.length,entry);},snapshot([sourceReview.report,visualReview.report,createPromptPath]));
    }
    // 최종 파일이 실제 독립 PASS와 같은 입력인지 확인하고 승인용 전체 hash를 잠근다.
    state = await validateAndFinalize();
    const sourceDigest=sourceInput(state.data,state.metadata,sources).digest;
    const visualDigest=hash(JSON.stringify({deck:postedText(state.data.deck),metadata:state.metadata,images:[...state.images,...state.mobile].map(file=>hash(fs.readFileSync(file)))}));
    if (sourceReview.inputSha256!==sourceDigest || visualReview.inputSha256!==visualDigest) throw fail('CARDS_REVIEW_INPUT_CHANGED');
    verifySnapshot(sourceReview.outputs);verifySnapshot(visualReview.outputs);
    record.outcome='ok';record.images=state.images;record.jpeg=state.jpeg;record.caption=state.data.caption;record.claims=state.claims;
    record.reviews={source:{report:sourceReview.report,inputSha256:sourceDigest},visual:{report:visualReview.report,inputSha256:visualDigest}};
    record.snapshot=snapshot([...currentFiles(),...Object.keys(sourceReview.outputs),...Object.keys(visualReview.outputs),createPromptPath]);record.currentSnapshot=snapshot(currentFiles());persist();return record;
  } catch(error) {record.outcome='failed';record.code=error.code||'CARDS_FAILED';record.detail=String(error.message).slice(0,500);persist();throw error;}
}
module.exports = { produceIntegrated, parseReview, validateAgentResult, postedText };
