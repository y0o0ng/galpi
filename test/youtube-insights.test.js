'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createYoutubeInsightsService, reportPoints, pacificDay } = require('../lib/reels/youtube-insights');
const { registerReelsRoutes } = require('../lib/reels/routes');
const headers = ['day', 'creatorContentType', 'views'].map(name => ({ name }));
const report = rows => ({ columnHeaders: headers, rows });
const credentials = { clientId: 'ID', clientSecret: 'PRIVATE_SECRET', refreshToken: 'PRIVATE_REFRESH' };
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'galpi-youtube-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const state = { now: Date.parse('2026-10-10T14:00:00Z') / 1000, fail: false, total: '55', channel: 'UC_TEST', hidden: false };
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url: new URL(url), options });
    if (url.includes('oauth2')) return { ok: true, json: async () => ({ access_token: 'PRIVATE_ACCESS', expires_in: 3600 }) };
    if (state.fail) return { ok: false, status: 403, json: async () => ({ error: { message: 'PRIVATE_SECRET provider body' } }) };
    return { ok: true, json: async () => url.includes('/channels?') ? { items: state.multiple ? [{ id: 'UC_A' }, { id: 'UC_B' }] : [{ id: state.channel, statistics: { subscriberCount: state.total, hiddenSubscriberCount: state.hidden } }] } : report([['2026-10-07', 'VIDEO_ON_DEMAND', 999], ['2026-10-08', 'SHORTS', 123], ['2026-10-09', 'SHORTS', 0]]) };
  };
  const create = () => createYoutubeInsightsService({ credentials, subscriberDir: dir, fetch, now: () => state.now });
  return { service: create(), create, state, calls, dir };
}
test('only Shorts rows count; gaps, zero and delayed latest day remain distinct', () => {
  const points = reportPoints(report([['2026-10-07','VIDEO_ON_DEMAND',999], ['2026-10-08','SHORTS',0], ['2026-10-09','SHORTS',42]]), '2026-10-01', '2026-10-10');
  assert.equal(points.length, 7); assert.equal(points.at(-1).day, '2026-10-09'); assert.equal(points.at(-1).views,42); assert.equal(points.at(-2).views,0); assert.equal(points.at(-3).views,null);
  assert.deepEqual(reportPoints({ columnHeaders: headers }, '2026-10-01','2026-10-10'), []);
  for (const rows of [null,[['2026-02-30','SHORTS',1]],[['2026-10-09','SHORTS','1']],[['2026-10-09','SHORTS',-1]],[['2026-10-09','SHORTS',1],['2026-10-09','SHORTS',2]],[['2026-10-11','SHORTS',1]]]) assert.throws(()=>reportPoints(report(rows),'2026-10-01','2026-10-10'), /BAD_RESPONSE/);
});
test('Pacific dates preserve midnight and daylight saving boundaries', () => {
  assert.equal(pacificDay(Date.parse('2026-10-10T06:59:59Z')/1000),'2026-10-09'); assert.equal(pacificDay(Date.parse('2026-10-10T07:00:00Z')/1000),'2026-10-10');
  assert.equal(pacificDay(Date.parse('2026-11-02T07:59:59Z')/1000),'2026-11-01'); assert.equal(pacificDay(Date.parse('2026-11-02T08:00:00Z')/1000),'2026-11-02');
});
test('coalesces requests, reads owner channel, and persists actual subscriber totals privately', async t => {
  const {service,create,state,calls,dir}=fixture(t); const [a,b]=await Promise.all([service.latest(), service.latest()]); assert.deepEqual(a,b); assert.equal(calls.length,3);
  const query=calls.find(c=>c.url.hostname==='youtubeanalytics.googleapis.com');assert.equal(query.url.searchParams.get('ids'),'channel==MINE');assert.equal(query.url.searchParams.get('dimensions'),'day,creatorContentType');assert.equal(query.url.searchParams.get('endDate'),'2026-10-09');assert.equal(query.options.headers.Authorization,'Bearer PRIVATE_ACCESS');assert.equal(query.options.redirect,'manual');assert.equal(query.url.searchParams.has('access_token'),false);
  assert.equal(a.subscribers.latest.total,55); assert.equal(a.subscribers.latest.day,'2026-10-10');assert.equal(a.subscribers.precision,'three_significant_figures');assert.equal(a.points.filter(p=>p.subscribers).length,1);assert.equal(a.points.at(-1).views,null);assert.equal(a.points.at(-1).day,'2026-10-10');
  const file=path.join(dir,fs.readdirSync(dir)[0]);assert.equal(fs.statSync(file).mode&0o777,0o600);
  state.now += 3601; state.total='54'; await create().latest();const samples=JSON.parse(fs.readFileSync(file)).samples;assert.deepEqual(samples.map(s=>s.total),[55,54]);assert.equal(fs.readFileSync(file,'utf8').includes('PRIVATE'),false);
});
test('failure retains stale actual timestamp, throttles retries and exposes no provider secrets', async t => {
  const {service,state,calls}=fixture(t);const a=await service.latest();state.now+=3601;state.fail=true;const b=await service.latest();assert.equal(b.status,'stale');assert.equal(b.fetchedAt,a.fetchedAt);assert.equal(b.subscribers.latest.total,55);assert.equal(b.subscribers.status,'unavailable');assert.equal(JSON.stringify(b).includes('PRIVATE'),false);const count=calls.length;await service.latest();assert.equal(calls.length,count);
  const off=createYoutubeInsightsService({credentials:{},fetch:()=>assert.fail('no call')});assert.equal((await off.latest()).status,'disconnected');
});
test('hidden, malformed and multiple-channel counts never write zero or overwrite history', async t => {
  const {service,state,dir,create}=fixture(t);await service.latest();const file=path.join(dir,fs.readdirSync(dir)[0]);const before=fs.readFileSync(file,'utf8');
  state.now+=3601;state.hidden=true;let result=await create().latest();assert.equal(result.subscribers.status,'unavailable');assert.equal(result.subscribers.latest.total,55);assert.equal(fs.readFileSync(file,'utf8'),before);
  state.hidden=false;state.total='not a count';result=await create().latest();assert.equal(result.status,'ready');assert.equal(result.subscribers.status,'unavailable');assert.equal(fs.readFileSync(file,'utf8'),before);
  state.multiple=true;result=await create().latest();assert.equal(result.subscribers.errorCode,'YOUTUBE_INSIGHTS_CHANNEL');assert.equal(fs.readFileSync(file,'utf8'),before);state.multiple=false;
  fs.writeFileSync(file,'corrupt');state.total='54';result=await create().latest();assert.equal(result.subscribers.errorCode,'YOUTUBE_SUBSCRIBERS_STORAGE');assert.equal(fs.readFileSync(file,'utf8'),'corrupt');
});
test('subscriber history remains daily while views lag and missing days are not filled', async t => {
  const {service,state,create}=fixture(t);await service.latest();state.now+=2*86400;state.total='53';const data=await create().latest();
  assert.equal(data.points.find(p=>p.day==='2026-10-10').subscribers.total,55);assert.equal(data.points.find(p=>p.day==='2026-10-11').subscribers,null);assert.equal(data.points.find(p=>p.day==='2026-10-12').subscribers.total,53);assert.equal(data.points.at(-1).views,null);
});
test('hourly collection runs without opening the dashboard and stop clears its timer', async t => {
  const {service,state}=fixture(t);const original=global.setInterval,clear=global.clearInterval;let callback,cleared=false;
  t.after(()=>{global.setInterval=original;global.clearInterval=clear;});global.setInterval=(fn,delay)=>{assert.equal(delay,3600000);callback=fn;return{unref(){}}};global.clearInterval=()=>{cleared=true};
  service.start();await service.recordSubscribers();assert.equal(typeof callback,'function');state.now+=3601;state.total='54';callback();await service.recordSubscribers();assert.equal((await service.latest()).subscribers.latest.total,54);service.stop();assert.equal(cleared,true);
});
test('read route ignores publishing flag and sanitizes errors', async () => {
  const routes=new Map();const app={get:(p,f)=>routes.set(p,f),post(){}};let fail=false;
  registerReelsRoutes({app,store:{latestBatch(){}},config:{enabled:false},youtubeInsights:{latest:async()=>{if(fail)throw Object.assign(new Error('PRIVATE'),{code:'YOUTUBE_INSIGHTS_AUTH'});return{status:'ready',points:[]}}}});
  const res={code:200,set(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
  await routes.get('/api/reels/youtube/insights')({},res);assert.equal(res.code,200);fail=true;await routes.get('/api/reels/youtube/insights')({},res);assert.equal(res.code,503);assert.equal(res.body.code,'YOUTUBE_INSIGHTS_AUTH');assert.equal(JSON.stringify(res.body).includes('PRIVATE'),false);
});
