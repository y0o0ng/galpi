'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const { createGoogleTokenSource } = require('../mail/gmail');
const { createFollowerStore } = require('./instagram-followers');
const DAY = 86400;
const fail = code => Object.assign(new Error(code), { code });
function pacificDay(at) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(at * 1000));
  const value = type => parts.find(part => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
function shiftDay(day, offset) { return new Date(Date.parse(day + 'T12:00:00Z') + offset * DAY * 1000).toISOString().slice(0, 10); }
function reportPoints(body, startDate, endDate) {
  const expected = ['day', 'creatorContentType', 'views'];
  if (!Array.isArray(body?.columnHeaders) || body.columnHeaders.length !== 3 || body.columnHeaders.some((column, i) => column?.name !== expected[i]) || (body.rows !== undefined && !Array.isArray(body.rows))) throw fail('YOUTUBE_INSIGHTS_BAD_RESPONSE');
  const views = new Map(); let latestDay = null;
  for (const row of body.rows || []) {
    if (!Array.isArray(row) || row.length !== 3 || typeof row[0] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row[0]) || !Number.isFinite(Date.parse(row[0] + 'T12:00:00Z')) || shiftDay(row[0], 0) !== row[0] || row[0] < startDate || row[0] > endDate || typeof row[1] !== 'string' || !Number.isSafeInteger(row[2]) || row[2] < 0) throw fail('YOUTUBE_INSIGHTS_BAD_RESPONSE');
    if (!latestDay || row[0] > latestDay) latestDay = row[0];
    if (row[1].toUpperCase() !== 'SHORTS') continue;
    if (views.has(row[0])) throw fail('YOUTUBE_INSIGHTS_BAD_RESPONSE');
    views.set(row[0], row[2]);
  }
  if (!latestDay) return [];
  return Array.from({ length: 7 }, (_, i) => { const day = shiftDay(latestDay, i - 6); return { day, views: views.get(day) ?? null }; });
}
function createYoutubeInsightsService({ credentials, subscriberDir = null, fetch: fetchImpl = globalThis.fetch, now = () => Math.floor(Date.now() / 1000) }) {
  const tokens = createGoogleTokenSource({ credentials, fetch: (url, init) => fetchImpl(url, { ...init, signal: AbortSignal.timeout(15000) }), now });
  let cache = null, retryAt = 0, pending = null, errorCode = null;
  let subscriberRetryAt = 0, subscriberPending = null, subscriberError = null, store = null, timer = null;
  const configured = () => credentials?.clientId && credentials?.clientSecret && credentials?.refreshToken;
  async function read(url) {
    let token; try { token = await tokens.getAccessToken(); } catch (error) { throw fail(error.code === 'MAIL_AUTH_REQUIRED' ? 'YOUTUBE_INSIGHTS_AUTH' : 'YOUTUBE_INSIGHTS_UNAVAILABLE'); }
    let response; try { response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual', signal: AbortSignal.timeout(15000) }); } catch { throw fail('YOUTUBE_INSIGHTS_NETWORK'); }
    if (!response.ok) throw fail(response.status === 401 || response.status === 403 ? 'YOUTUBE_INSIGHTS_AUTH' : 'YOUTUBE_INSIGHTS_UNAVAILABLE');
    let body; try { body = await response.json(); } catch { throw fail('YOUTUBE_INSIGHTS_BAD_RESPONSE'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('YOUTUBE_INSIGHTS_BAD_RESPONSE');
    return body;
  }
  async function recordSubscribers() {
    if (!configured() || !subscriberDir) return;
    if (subscriberPending) return subscriberPending;
    if (now() < subscriberRetryAt) return;
    subscriberPending = (async () => {
      try {
        const body = await read('https://www.googleapis.com/youtube/v3/channels?part=id,statistics&mine=true');
        if (!Array.isArray(body.items) || body.items.length !== 1 || !/^[A-Za-z0-9_-]+$/.test(body.items[0].id || '')) throw fail('YOUTUBE_INSIGHTS_CHANNEL');
        const channel = body.items[0];
        store = createFollowerStore({ file: path.join(subscriberDir, `youtube-subscribers-${crypto.createHash('sha256').update(channel.id).digest('hex').slice(0,16)}.json`), userId: channel.id });
        if (channel.statistics?.hiddenSubscriberCount !== false) throw fail('YOUTUBE_SUBSCRIBERS_HIDDEN');
        const raw = channel.statistics.subscriberCount;
        if (typeof raw !== 'string' || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw fail('YOUTUBE_INSIGHTS_BAD_RESPONSE');
        store.record({ observedAt: now(), total: Number(raw) });
        subscriberError = null; subscriberRetryAt = now() + 3600;
      } catch (error) { subscriberError = error.code?.startsWith('YOUTUBE_') ? error.code : 'YOUTUBE_SUBSCRIBERS_STORAGE'; subscriberRetryAt = now() + 300; }
    })().finally(() => { subscriberPending = null; });
    return subscriberPending;
  }
  function withSubscribers(data) {
    let samples = []; try { samples = store?.read() || []; } catch { subscriberError = 'YOUTUBE_SUBSCRIBERS_STORAGE'; }
    const byDay = new Map();
    for (const sample of samples) { if (sample.observedAt > now()) continue; const day = pacificDay(sample.observedAt); const previous = byDay.get(day); if (!previous || sample.observedAt >= previous.observedAt) byDay.set(day, sample); }
    const latest = [...byDay.values()].reduce((a, b) => !a || b.observedAt >= a.observedAt ? b : a, null);
    const points = data.points.map(point => ({ ...point, subscribers: byDay.get(point.day) || null }));
    if (latest) {
      const lastDay = pacificDay(latest.observedAt);
      const firstDay = points.length ? shiftDay(points.at(-1).day, 1) : [...byDay.keys()].sort().filter(day => day >= shiftDay(lastDay, -6))[0];
      for (let day = firstDay; day && day <= lastDay; day = shiftDay(day, 1)) points.push({ day, views: null, subscribers: byDay.get(day) || null });
    }
    return { ...data, subscribers: { status: subscriberError ? 'unavailable' : latest ? 'ready' : 'empty', errorCode: subscriberError, scope: 'channel_total', precision: 'three_significant_figures', latest: latest ? { ...latest, day: pacificDay(latest.observedAt) } : null }, points };
  }
  async function collect() {
    const endDate = shiftDay(pacificDay(now()), -1), startDate = shiftDay(endDate, -13);
    const params = new URLSearchParams({ ids: 'channel==MINE', startDate, endDate, dimensions: 'day,creatorContentType', metrics: 'views', sort: 'day' });
    const points = reportPoints(await read(`https://youtubeanalytics.googleapis.com/v2/reports?${params}`), startDate, endDate);
    return { status: points.some(point => point.views !== null) ? 'ready' : 'empty', scope: 'channel_shorts', basis: 'youtube_day', timeZone: 'America/Los_Angeles', metric: 'views', fetchedAt: now(), points };
  }
  return {
    recordSubscribers,
    start() { if (timer || !subscriberDir || !configured()) return; void recordSubscribers(); timer = setInterval(() => { void recordSubscribers(); }, 3600000); timer.unref?.(); },
    stop() { clearInterval(timer); timer = null; },
    async latest() {
      if (!configured()) return { status: 'disconnected', points: [] };
      await recordSubscribers();
      if (pending) return pending.then(withSubscribers);
      if (now() < retryAt) { if (errorCode) { if (cache) return withSubscribers({ ...cache, status: 'stale', errorCode }); throw fail(errorCode); } return withSubscribers(cache); }
      pending = collect().then(data => { cache = data; errorCode = null; retryAt = now() + 3600; return data; }).catch(error => { errorCode = error.code || 'YOUTUBE_INSIGHTS_UNAVAILABLE'; retryAt = now() + 300; if (cache) return { ...cache, status: 'stale', errorCode }; throw fail(errorCode); }).finally(() => { pending = null; });
      return pending.then(withSubscribers);
    },
  };
}
module.exports = { createYoutubeInsightsService, reportPoints, pacificDay };
