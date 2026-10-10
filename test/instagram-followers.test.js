'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFollowerStore, followersForPeriod } = require('../lib/reels/instagram-followers');
const { createInstagramInsightsService } = require('../lib/reels/instagram-insights');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'galpi-followers-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'private', 'history.json');
  return { file, store: createFollowerStore({ file, userId: '123' }) };
}
test('observations survive restart with private permissions; invalid storage is never overwritten', t => {
  const { file, store } = fixture(t);
  store.record({ observedAt: 100, total: 54, private: 'SECRET' });
  assert.equal(fs.readFileSync(file, 'utf8').includes('SECRET'), false); store.record({ observedAt: 200, total: 53 });
  assert.deepEqual(createFollowerStore({ file, userId: '123' }).read(), [{ observedAt: 100, total: 54 }, { observedAt: 200, total: 53 }]);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.throws(() => createFollowerStore({ file, userId: '456' }).record({ observedAt: 300, total: 99 }), /STORAGE/);
  fs.writeFileSync(file, 'corrupt'); assert.throws(() => store.record({ observedAt: 300, total: 99 }), /STORAGE/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'corrupt');
});
test('daily totals use the last actual observation, preserve decreases and never fill gaps', () => {
  const samples = [{ observedAt: 10, total: 54 }, { observedAt: 19, total: 53 }, { observedAt: 20, total: 52 }];
  assert.deepEqual(followersForPeriod(samples, 10, 20), samples[1]);
  assert.deepEqual(followersForPeriod(samples, 20, 30), samples[2]);
  assert.equal(followersForPeriod(samples, 30, 40), null);
  assert.equal(followersForPeriod([{ observedAt: 20, total: 0 }], 20, 30).total, 0);
});
test('hourly collection runs without dashboard visits and stops cleanly', async t => {
  const { file, store } = fixture(t); let now = 1000, total = 54, calls = 0;
  t.mock.timers.enable({ apis: ['setInterval'] });
  const service = createInstagramInsightsService({ userId: '123', tokens: { get: () => 'SECRET' }, followersFile: file, now: () => now,
    fetch: async url => { calls++; assert.equal(new URL(url).searchParams.get('fields'), 'followers_count'); return { ok: true, json: async () => ({ followers_count: total }) }; } });
  service.start(); await service.recordFollowers(); assert.equal(calls, 1);
  now += 3600; total = 53; t.mock.timers.tick(3600000); await service.recordFollowers();
  assert.deepEqual(store.read().map(x => x.total), [54, 53]); assert.equal(calls, 2);
  service.stop(); now += 3600; t.mock.timers.tick(3600000); assert.equal(calls, 2);
});
test('follower failure leaves views available and does not invent a zero', async t => {
  const { file, store } = fixture(t); let now = 1791633069;
  const service = createInstagramInsightsService({ userId: '123', tokens: { get: () => 'SECRET' }, followersFile: file, now: () => now,
    fetch: async url => {
      const q = new URL(url).searchParams;
      if (q.has('fields')) return { ok: true, json: async () => ({ followers_count: '54' }) };
      if (q.get('metric') === 'reach') return { ok: true, json: async () => ({ data: [{ name: 'reach', values: [{ end_time: '2026-10-09T07:00:00Z' }, { end_time: '2026-10-10T07:00:00Z' }] }] }) };
      return { ok: true, json: async () => ({ data: [{ name: 'views', period: 'day', total_value: { breakdowns: [{ dimension_keys: ['media_product_type'], results: [{ dimension_values: ['REEL'], value: 12 }] }] } }] }) };
    } });
  const data = await service.latest(); assert.equal(data.status, 'ready'); assert.equal(data.points[0].views, 12);
  assert.equal(data.followers.status, 'unavailable'); assert.equal(data.followers.latest, null); assert.equal(data.points[0].followers, null);
  assert.deepEqual(store.read(), []);
});
