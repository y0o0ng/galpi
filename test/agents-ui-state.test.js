'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/agent-panel.js'), 'utf8');
function helper(name, next, context) {
  const start = source.indexOf(`function ${name}(`);
  return vm.runInNewContext(`(${source.slice(start, source.indexOf(next, start)).trim()})`, context);
}

test('Codex queue and retry fail closed on missing status, bad runner and recovery', () => {
  const state = { codexError: '', codex: { runner: { ok: true } }, organize: { runner: { ok: true }, recoveryRequired: 0 } };
  const canRun = helper('codexCanRun', 'function detailCard', { state });
  assert.equal(canRun(), true);
  for (const change of [
    () => { state.codexError = 'unavailable'; },
    () => { state.codex.runner.ok = false; },
    () => { state.organize.runner.ok = false; },
    () => { state.organize.recoveryRequired = 1; },
    () => { state.organize.recoveryRequired = undefined; },
    () => { state.organize = null; },
  ]) {
    state.codexError = ''; state.codex.runner.ok = true;
    state.organize = { runner: { ok: true }, recoveryRequired: 0 };
    change();
    assert.ok(!canRun());
  }
});

test('Reels state fetch distinguishes disabled production from failed status and clears stale episodes', async () => {
  const state = { reelsEpisode: { status: 'approved' }, apiFetch: null };
  const start = source.indexOf('async function loadReelsEpisode(');
  const load = vm.runInNewContext(`(${source.slice(start, source.indexOf('// --- 날씨', start)).trim()})`, { state });
  state.apiFetch = async () => ({ ok: false, status: 503, json: async () => ({ code: 'REELS_PRODUCTION_DISABLED' }) });
  await load(); assert.equal(state.reelsEpisode, null);
  state.reelsEpisode = { status: 'approved' };
  state.apiFetch = async () => ({ ok: false, status: 500, json: async () => ({ error: 'unavailable' }) });
  await assert.rejects(load(), /unavailable/);
  assert.equal(state.reelsEpisode, null);
});

test('a media response arriving after leaving Reels is revoked rather than retained', async () => {
  const state = { reelsMedia: null, apiFetch: null };
  const revoked = [];
  let resolveResponse;
  state.apiFetch = () => new Promise(resolve => { resolveResponse = resolve; });
  const start = source.indexOf('async function loadReelsMedia(');
  const releaseStart = source.indexOf('function releaseReelsMedia(');
  const release = source.slice(releaseStart, source.indexOf('// 같은 편', releaseStart));
  const load = vm.runInNewContext(`${release}\n(${source.slice(start, source.indexOf('function svgIcon', start)).trim()})`, { state, URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL: url => revoked.push(url) } });
  const pending = load({ id: 9, finishedAt: 123, videoUrl: '/api/reels/episodes/9/video' });
  state.reelsMedia = null;
  resolveResponse({ ok: true, blob: async () => ({}) });
  await pending;
  assert.deepEqual(revoked, ['blob:fixture']);
  assert.equal(state.reelsMedia, null);
});

test('legacy Home links preserve explicit tasks and mail destinations while generic agents opens the new main', () => {
  const home = fs.readFileSync(path.join(__dirname, '../public/home.js'), 'utf8');
  const start = home.indexOf('function handleInitialUrl(');
  const context = { global: { location: { search: '' } }, URLSearchParams, calls: [] };
  context.setRoute = (...args) => context.calls.push(['route', ...args]);
  context.openTasks = options => context.calls.push(['tasks', options]);
  context.openNotifications = filter => context.calls.push(['notifications', filter]);
  const route = vm.runInNewContext(`(${home.slice(start, home.indexOf('function init(', start)).trim()})`, context);
  for (const [search, expected] of [
    ['?panel=agents', [['route', 'home', 'agents']]],
    ['?panel=agents&taskView=reminders', [['tasks', { view: 'today', focusReminders: true }]]],
    ['?notification=tasks', [['tasks', { view: 'today', focusReminders: true }]]],
    ['?panel=notifications&notification=mail', [['notifications', 'mail']]],
  ]) {
    context.global.location.search = search; context.calls = [];
    route(); assert.deepEqual(JSON.parse(JSON.stringify(context.calls)), expected);
  }
});

test('native calendar swipe loads the previous week from schedule detail', () => {
  const state = { mode: 'schedule', calendarLoading: false, summary: { calendarCenter: '2026-10-10' } };
  const calls = [];
  const start = source.indexOf('function settleCalendar(');
  const dates = source.slice(source.indexOf('function parseDate('), source.indexOf('function formatDateTime('));
  const settle = vm.runInNewContext(`${dates}\n(${source.slice(start, source.indexOf('function scrollCalendar(', start)).trim()})`, {
    state, DAY_MS: 86400000, clearTimeout() {}, setTimeout: callback => callback(), loadCalendarCenter: value => calls.push(value),
  });
  settle({ isConnected: true, clientWidth: 300, scrollLeft: 0 });
  assert.deepEqual(calls, ['2026-10-03']);
});
