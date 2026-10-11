'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/agent-panel.js'),'utf8');
const labels=source.match(/const REELS_STATUS = [^;]+;/)[0]+'\n'+source.match(/const EPISODE_STATUS = \{[\s\S]*?\};/)[0];
const status=source.slice(source.indexOf('    const reelsStatus ='),source.indexOf('    content.append(makeAgentRow'));
function label(episode,batch={status:'selected'}){return vm.runInNewContext(labels+'\n'+status+'\nreelsStatus',{state:{reels:{}},episode,batch});}
test('릴스 알약은 주제 선택 이후 제작·검토 상태를 표시한다',()=>{
 assert.equal(label(null),'제작 대기');assert.equal(label({status:'producing'}),'만드는 중');assert.equal(label({status:'revising'}),'고치는 중');assert.equal(label({status:'ready'}),'검토 대기');assert.equal(label({status:'failed'}),'실패');
});
test('승인된 릴스 알약은 실제 플랫폼 업로드 상태를 표시한다',()=>{
 const run=statuses=>label({status:'approved',uploads:statuses.map(status=>({status}))});
 assert.equal(run([]),'게시 대기');assert.equal(run(['pending','pending']),'게시 대기');assert.equal(run(['uploading','done']),'게시 중');assert.equal(run(['done','pending']),'일부 게시 완료');assert.equal(run(['done','done']),'게시 완료');assert.equal(run(['failed','done']),'게시 실패');
});
