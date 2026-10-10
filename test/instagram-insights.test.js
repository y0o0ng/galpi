'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInstagramInsightsService, reelViews } = require('../lib/reels/instagram-insights');
const { registerReelsRoutes } = require('../lib/reels/routes');
const { API_VERSION } = require('../lib/reels/instagram');
const metric = value => ({ data: [{ name: 'views', period: 'day', total_value: { value: 999, breakdowns: [{ dimension_keys: ['media_product_type'], results: [{ dimension_values: ['FEED'], value: 999 }, { dimension_values: ['REEL'], value }] }] } }] });
const ends = ['2026-11-01T07:00:00Z', '2026-11-02T08:00:00Z', '2026-11-03T08:00:00Z'];
function fixture() {
  const calls = [];
  const state = { now: Date.parse('2026-11-04T12:00:00Z') / 1000, fail: false };
  const service = createInstagramInsightsService({ userId: '123', tokens: { get: () => 'PRIVATE_TOKEN' }, now: () => state.now, fetch: async (url, options) => {
    const parsed = new URL(url); calls.push({ parsed, options });
    if (state.fail) return { ok: false, status: 403, json: async () => ({ error: { code: 200, message: 'PRIVATE_TOKEN secret provider message' } }) };
    return { ok: true, json: async () => parsed.searchParams.get('metric') === 'reach' ? { data: [{ name: 'reach', values: ends.map(end_time => ({ value: 99999, end_time })) }] } : metric(42) };
  } });
  return { service, calls, state };
}
test('reads only REEL views and keeps missing values distinct from zero', () => {
  assert.equal(reelViews(metric(42)), 42);
  assert.equal(reelViews(metric(0)), 0);
  assert.equal(reelViews({ data: [] }), null);
  assert.equal(reelViews({ data: [{ name: 'views', period: 'day', total_value: { breakdowns: [] } }] }), null);
  for (const value of [-1, '42', null, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => reelViews(metric(value)), /BAD_RESPONSE/);
  const duplicate = metric(1); duplicate.data[0].total_value.breakdowns[0].results.push({ dimension_values: ['REEL'], value: 1 });
  assert.throws(() => reelViews(duplicate), /BAD_RESPONSE/);
});
test('Meta boundaries survive DST; concurrent callers share one request and cache', async () => {
  const { service, calls } = fixture();
  const [a, b] = await Promise.all([service.latest(), service.latest()]);
  assert.deepEqual(a, b); assert.equal(a.points.length, 2); assert.equal(a.points[0].endAt - a.points[0].startAt, 25 * 3600);
  assert.equal(a.points[0].views, 42); assert.equal(a.scope, 'account_reels'); assert.equal(calls.length, 3);
  assert.equal(calls[1].parsed.searchParams.get('since'), String(a.points[0].startAt));
  assert.equal(calls[1].parsed.searchParams.get('until'), String(a.points[0].endAt - 1));
  for (const call of calls) {
    assert.equal(call.parsed.origin, 'https://graph.instagram.com');
    assert.ok(call.parsed.pathname.startsWith('/' + API_VERSION + '/123/'));
    assert.equal(call.options.headers.Authorization, 'Bearer PRIVATE_TOKEN');
    assert.equal(call.parsed.searchParams.has('access_token'), false);
    assert.equal(call.options.redirect, 'manual');
  }
  await service.latest(); assert.equal(calls.length, 3);
});
test('failed refresh preserves the timestamp and marks stale without exposing provider content', async () => {
  const { service, state, calls } = fixture(); const original = await service.latest();
  state.now += 3601; state.fail = true;
  const stale = await service.latest();
  assert.equal(stale.status, 'stale'); assert.equal(stale.fetchedAt, original.fetchedAt);
  assert.equal(stale.errorCode, 'INSTAGRAM_INSIGHTS_AUTH');
  assert.equal(JSON.stringify(stale).includes('PRIVATE_TOKEN'), false);
  await service.latest(); assert.equal(calls.length, 4);
});
test('missing credentials make no calls; initial failure has only a safe code', async () => {
  const off = createInstagramInsightsService({ userId: '123', tokens: { get: () => '' }, fetch: () => assert.fail('must not fetch') });
  assert.equal((await off.latest()).status, 'disconnected');
  const { service, state, calls } = fixture(); state.fail = true;
  await assert.rejects(service.latest(), { message: 'INSTAGRAM_INSIGHTS_AUTH' });
  await assert.rejects(service.latest(), { message: 'INSTAGRAM_INSIGHTS_AUTH' }); assert.equal(calls.length, 1);
});
test('gaps in Meta calendar fail closed instead of aggregating multiple days as one', async () => {
  const service = createInstagramInsightsService({ userId: '123', tokens: { get: () => 'token' }, now: () => Date.parse('2026-11-04T12:00:00Z') / 1000, fetch: async () => ({ ok: true, json: async () => ({ data: [{ name: 'reach', values: [{ end_time: ends[0] }, { end_time: ends[2] }] }] }) }) });
  await assert.rejects(service.latest(), /BAD_RESPONSE/);
});
test('read-only insight route works independently of publishing flag and sanitizes failures', async () => {
  const routes = new Map(); const app = { get: (p, f) => routes.set(p, f), post() {} };
  let fail = false;
  registerReelsRoutes({ app, store: { latestBatch() {} }, config: { enabled: false }, instagramInsights: { latest: async () => { if (fail) throw new Error('SECRET'); return { status: 'ready', points: [] }; } } });
  const res = { code: 200, set() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await routes.get('/api/reels/instagram/insights')({}, res); assert.equal(res.code, 200);
  fail = true; await routes.get('/api/reels/instagram/insights')({}, res); assert.equal(res.code, 503);
  assert.equal(JSON.stringify(res.body).includes('SECRET'), false);
});
