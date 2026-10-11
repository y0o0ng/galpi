 'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/agent-panel.js'),'utf8');
const functions=source.slice(source.indexOf('  function downloadCardBlob('),source.indexOf('  function makeCardJobCard('));
function setup({ios=false,failAt=-1}={}){
  const events=[],toasts=[],shared=[];
  const context={File,Blob,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{}},setTimeout:fn=>{fn();},
    navigator:{userAgent:ios?'iPhone':'desktop',canShare:()=>ios,share:async data=>shared.push(data.files)},
    document:{body:{appendChild:()=>{}},createElement:()=>({click(){events.push(['download',this.download]);},remove(){}})},
    state:{apiFetch:async url=>{events.push(['fetch',url]);return {ok:events.filter(e=>e[0]==='fetch').length!==failAt,blob:async()=>new Blob(['image'])};},showToast:value=>toasts.push(value)}};
  vm.createContext(context);vm.runInContext(functions,context);return {...context,events,toasts,shared};
}
test('이미지 버튼 한 번으로 인증된 JPEG를 페이지 순서대로 하나씩 내려받는다',async()=>{
  const ui=setup(),control={textContent:'이미지 다운로드',disabled:false};
  await ui.saveCardImages({id:12,downloads:['/1','/2','/3']},control);
  assert.deepEqual(ui.events,[['fetch','/1'],['download','sionwhy-12-01.jpg'],['fetch','/2'],['download','sionwhy-12-02.jpg'],['fetch','/3'],['download','sionwhy-12-03.jpg']]);
  assert.equal(control.disabled,false);assert.equal(control.textContent,'이미지 다운로드');
});
test('iPhone은 한 번의 공유 시트에 순서대로 모으고 다운로드 실패면 뒤 페이지를 보내지 않는다',async()=>{
  const ui=setup({ios:true});await ui.saveCardImages({id:12,downloads:['/1','/2']},{textContent:'저장'});
  assert.deepEqual(Array.from(ui.shared[0],f=>f.name),['sionwhy-12-01.jpg','sionwhy-12-02.jpg']);
  const failed=setup({failAt:2}),control={textContent:'저장'};await failed.saveCardImages({id:12,downloads:['/1','/2','/3']},control);
  assert.equal(failed.events.filter(e=>e[0]==='fetch').length,2);assert.equal(control.disabled,false);assert.match(failed.toasts[0],/받지 못/);
});
test('재시도 대기 중에는 지난 오류를 숨기고 실제 실패 상태에서만 표시한다',()=>{
 const fn=source.slice(source.indexOf('  function makeCardJobCard('),source.indexOf('  async function loadCards('));
 function render(status){const messages=[];const context={state:{cardJob:{id:2,title:'카드',status,images:[],claims:[],caption:'',errorCode:'CARDS_BUILD_BLOCKED'}},document:{createElement:()=>({appendChild(){},append(){}})},refresh(){},releaseCardMedia(){},agentSummaryHead(){return {};},agentSummaryMessage(text){messages.push(text);return {};},button(){return {};}};
 vm.createContext(context);vm.runInContext(fn,context);context.makeCardJobCard();return messages;}
 assert.equal(render('queued').some(text=>text.includes('CARDS_BUILD_BLOCKED')),false);
 assert.equal(render('producing').some(text=>text.includes('CARDS_BUILD_BLOCKED')),false);
 assert.equal(render('blocked').some(text=>text.includes('CARDS_BUILD_BLOCKED')),true);
});
