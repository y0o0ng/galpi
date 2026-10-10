'use strict';
const { API_VERSION } = require('./instagram');
const { createFollowerStore, followersForPeriod } = require('./instagram-followers');
const DAY = 86400;

function failure(code) { return Object.assign(new Error(code), { code }); }

function reelViews(body) {
  if (!Array.isArray(body?.data)) throw failure('INSTAGRAM_INSIGHTS_BAD_RESPONSE');
  const metric = body.data.find(item => item.name === 'views');
  if (!metric) return null;
  if (metric.period !== 'day') throw failure('INSTAGRAM_INSIGHTS_BAD_RESPONSE');
  const groups = metric.total_value?.breakdowns;
  if (!Array.isArray(groups)) throw failure('INSTAGRAM_INSIGHTS_BAD_RESPONSE');
  const values = [];
  for (const group of groups) {
    if (!Array.isArray(group.dimension_keys) || !Array.isArray(group.results)) throw failure('INSTAGRAM_INSIGHTS_BAD_RESPONSE');
    const index = group.dimension_keys.indexOf('media_product_type');
    if (index < 0) continue;
    for (const result of group.results) {
      if (!Array.isArray(result.dimension_values)) throw failure('INSTAGRAM_INSIGHTS_BAD_RESPONSE');
      if (result.dimension_values?.[index] === 'REEL') values.push(result.value);
    }
  }
  if (!values.length) return null;
  if (values.length !== 1 || !Number.isSafeInteger(values[0]) || values[0] < 0) throw failure('INSTAGRAM_INSIGHTS_BAD_RESPONSE');
  return values[0];
}

function createInstagramInsightsService({ userId, tokens, followersFile = null, fetch: fetchImpl = globalThis.fetch, now = () => Math.floor(Date.now() / 1000) }) {
  const followerStore = followersFile ? createFollowerStore({ file: followersFile, userId }) : null;
  let followerRetryAt = 0, followerPending = null, followerError = null, timer = null;
  let cached = null;
  let retryAt = 0;
  let pending = null;
  let errorCode = null;
  async function read(path, params, token) {
    let response;
    try {
      response = await fetchImpl(`https://graph.instagram.com/${API_VERSION}/${path}?${new URLSearchParams(params)}`, {
        headers: { Authorization: `Bearer ${token}` }, redirect: 'manual', signal: AbortSignal.timeout(15000),
      });
    } catch { throw failure('INSTAGRAM_INSIGHTS_NETWORK'); }
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.error) {
      const code = body?.error?.code;
      throw failure([10, 190, 200].includes(code) || [401, 403].includes(response.status) ? 'INSTAGRAM_INSIGHTS_AUTH' : 'INSTAGRAM_INSIGHTS_PROVIDER');
    }
    if (!body || typeof body !== 'object') throw failure('INSTAGRAM_INSIGHTS_BAD_RESPONSE');
    return body;
  }
  async function recordFollowers() {
    if (!followerStore || !tokens?.get() || !/^\d+$/.test(String(userId || ''))) return;
    if (followerPending) return followerPending;
    if (now() < followerRetryAt) return;
    followerPending = (async () => {
      try {
        const body = await read(userId, { fields: 'followers_count' }, tokens.get());
        if (!Number.isSafeInteger(body.followers_count) || body.followers_count < 0) throw failure('INSTAGRAM_INSIGHTS_BAD_RESPONSE');
        followerStore.record({ observedAt: now(), total: body.followers_count });
        followerError = null; followerRetryAt = now() + 3600;
      } catch (error) { followerError = error.code || 'INSTAGRAM_FOLLOWERS_STORAGE'; followerRetryAt = now() + 300; }
    })().finally(() => { followerPending = null; });
    return followerPending;
  }

  function withFollowers(data) {
    let samples = [];
    try { samples = followerStore?.read() || []; }
    catch { followerError = 'INSTAGRAM_FOLLOWERS_STORAGE'; }
    const latest = followersForPeriod(samples, 0, now() + 1);
    return { ...data, followers: { metric: 'followers_count', scope: 'account_total', status: followerError ? 'unavailable' : latest ? 'ready' : 'empty', errorCode: followerError, latest },
      points: data.points.map(point => ({ ...point, followers: followersForPeriod(samples, point.startAt, point.endAt) })) };
  }

  async function collect(token) {
    const at = now();
    // reach의 값은 쓰지 않는다. Meta 일별 end_time으로 경계만 읽어 DST·지연을 보존한다.
    const calendar = await read(`${userId}/insights`, { metric: 'reach', period: 'day', metric_type: 'time_series', since: String(at - 10 * DAY), until: String(at) }, token);
    if (!Array.isArray(calendar.data)) throw failure('INSTAGRAM_INSIGHTS_BAD_RESPONSE');
    const dates = calendar.data.find(item => item.name === 'reach')?.values || [];
    if (!Array.isArray(dates)) throw failure('INSTAGRAM_INSIGHTS_BAD_RESPONSE');
    const ends = dates.map(item => Date.parse(item.end_time) / 1000);
    if (ends.some(value => !Number.isSafeInteger(value))) throw failure('INSTAGRAM_INSIGHTS_BAD_RESPONSE');
    const boundaries = [...new Set(ends.filter(value => value <= at))].sort((a, b) => a - b).slice(-8);
    const points = [];
    for (let i = 1; i < boundaries.length; i++) {
      const startAt = boundaries[i - 1], endAt = boundaries[i];
      const hours = (endAt - startAt) / 3600;
      if (![23, 24, 25].includes(hours)) throw failure('INSTAGRAM_INSIGHTS_BAD_RESPONSE');
      // Meta until은 해당 집계일을 포함한다. 다음 날 첫 초를 빼서 경계일 중복을 막는다.
      const body = await read(`${userId}/insights`, { metric: 'views', period: 'day', metric_type: 'total_value', breakdown: 'media_product_type', since: String(startAt), until: String(endAt - 1) }, token);
      points.push({ startAt, endAt, views: reelViews(body) });
    }
    return { status: points.some(point => point.views !== null) ? 'ready' : 'empty', basis: 'meta_day', metric: 'views', scope: 'account_reels', fetchedAt: now(), points };
  }
  return {
    start() {
      if (timer || !followerStore) return;
      void recordFollowers();
      timer = setInterval(() => { void recordFollowers(); }, 3600000);
      timer.unref?.();
    },
    stop() { clearInterval(timer); timer = null; },
    recordFollowers,
    async latest() {
      const token = tokens?.get();
      if (!token || !/^\d+$/.test(String(userId || ''))) return { status: 'disconnected', points: [] };
      await recordFollowers();
      if (pending) return pending.then(withFollowers);
      if (now() < retryAt) {
        if (errorCode) {
          if (cached) return withFollowers({ ...cached, status: 'stale', errorCode });
          throw failure(errorCode);
        }
        return withFollowers(cached);
      }
      pending = collect(token).then(value => {
        cached = value; errorCode = null; retryAt = now() + 3600; return value;
      }).catch(error => {
        errorCode = error.code || 'INSTAGRAM_INSIGHTS_PROVIDER'; retryAt = now() + 300;
        if (cached) return { ...cached, status: 'stale', errorCode };
        throw failure(errorCode);
      }).finally(() => { pending = null; });
      return pending.then(withFollowers);
    },
  };
}
module.exports = { createInstagramInsightsService, reelViews };
