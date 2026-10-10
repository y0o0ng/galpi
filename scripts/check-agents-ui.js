'use strict';

// Explicit browser check: NODE_PATH=<Playwright installation> node scripts/check-agents-ui.js
// Fixtures stay in memory; no production DB, tokens, workers, or external API calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = '/tmp/galpi-agents-ui-render';

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((req, res) => {
    const relative = req.url === '/' ? 'index.html' : req.url.slice(1).split('?')[0];
    const file = path.resolve(root, 'public', relative);
    if (!file.startsWith(path.join(root, 'public') + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    let body = fs.readFileSync(file);
    if (relative === 'index.html') body = body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
    res.setHeader('Content-Type', relative.endsWith('.css') ? 'text/css' : relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
    res.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    await page.goto(url);
    await page.addScriptTag({ url: `${url}/task-panel.js` });
    await page.addScriptTag({ url: `${url}/agent-panel.js` });
    await page.evaluate(async () => {
      const day = new Date(Date.now() - 10 * 3600000).toISOString().slice(0, 10);
      const days = Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${String(i + 5).padStart(2, '0')}`, count: i === 5 ? 2 : 0, isToday: i === 5 }));
      window.fixture = {
        '/api/tasks/summary': { today: day, calendarCenter: day, counts: { overdue: 1, today: 2, upcoming: 5, inbox: 3 }, calendar: [{ days }, { days }, { days }], preview: [{ title: '테스트 마감', bucket: 'overdue' }], nextReminder: null },
        '/api/notifications': { notifications: [] },
        '/api/models/codex': { runner: { ok: true }, catalog: { status: 'ready' }, models: [{ id: 'test-general', displayName: 'Fixture general' }, { id: 'test-deep' }], settings: { general: { value: 'test-general', version: 3 }, deep: { value: 'test-deep', version: 4 } } },
        '/api/organize/status': { runner: { ok: true }, queueable: 4, waitingJobs: 1, stalledNotes: [], stranded: 0, recoveryRequired: 0, autoQueueThreshold: 5 },
        '/api/mail/status': { accounts: [{ provider: 'gmail', address: 'fixture@example.test', status: 'active', lastSyncAt: 1791592920 }], analysis: { pending: 2, analyzing: 1, done: 18, skipped: 6, failed: 0 } },
        '/api/mail/settings': { settings: { notificationsEnabled: true, quietHours: { enabled: false, start: '23:00', end: '07:00' } } },
        '/api/mail/preferences': { preferences: [{ id: 11, target: 'fixture.test', preferenceType: 'domain', action: 'suppress_notification' }] },
        '/api/reels/latest': { batch: { batchId: day, status: 'candidate', cards: [{ id: 7, title: '<img onerror=alert(1)> fixture 후보', concept: 'test', why: 'fixture reason' }] } },
        '/api/reels/episodes/latest': { episode: null },
        '/api/tasks': { tasks: [], counts: {} },
        '/api/reels/instagram/insights': { status: 'disconnected', points: [] },
      };
      const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 120;
      const stream = canvas.captureStream(20);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      const chunks = [];
      recorder.ondataavailable = event => chunks.push(event.data);
      await new Promise(resolve => {
        const ctx = canvas.getContext('2d');
        const drawing = setInterval(() => { ctx.fillStyle = '#2F6B57'; ctx.fillRect(0, 0, 80, 120); ctx.fillStyle = 'white'; ctx.fillRect(Date.now() % 50, 45, 20, 20); }, 50);
        recorder.onstop = () => { clearInterval(drawing); resolve(); };
        recorder.start(); setTimeout(() => recorder.stop(), 800);
      });
      stream.getTracks().forEach(track => track.stop());
      window.mediaBlob = new Blob(chunks, { type: 'video/webm' });
      window.calls = [];
      window.revokedMedia = [];
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.revokeObjectURL = url => { window.revokedMedia.push(url); revoke(url); };
      window.apiFailures = {};
      window.pushFixture = { status: 'enabled', label: '알림 켜짐' };
      const apiFetch = async (route, options = {}) => {
        const base = route.split('?')[0];
        window.calls.push({ route, ...options });
        if (base === '/api/reels/instagram/insights' && window.insightsGate) await window.insightsGate;
        if (base === '/api/reels/episodes/9/video') return new Response(window.mediaBlob);
        if (base.startsWith('/api/cards/') && !window.fixture[base]) return new Response('{}', { status: 404 });
        if (window.apiFailures[base]) return new Response(JSON.stringify({ error: 'fixture unavailable' }), { status: 503 });
        if (options.method === 'PUT' && base === '/api/mail/settings') Object.assign(window.fixture[base].settings, JSON.parse(options.body));
        if (options.method === 'PUT' && base === '/api/settings/codex-models') {
          const body = JSON.parse(options.body);
          window.fixture['/api/models/codex'].settings.general.value = body.generalModel;
          window.fixture['/api/models/codex'].settings.deep.value = body.deepModel;
          return new Response(JSON.stringify(window.fixture['/api/models/codex']));
        }
        if (options.method === 'DELETE' && base === '/api/mail/preferences/11') window.fixture['/api/mail/preferences'].preferences = [];
        if (options.method === 'POST' && base.includes('/uploads/youtube/retry')) window.fixture['/api/reels/episodes/latest'].episode.uploads[0].status = 'pending';
        if (options.method === 'POST' && base.endsWith('/approve')) window.fixture['/api/reels/episodes/latest'].episode.status = 'approved';
        return new Response(JSON.stringify(window.fixture[base] || { success: true }));
      };
      window.TaskPanel.init({ apiFetch, enabled: true, showToast: () => {}, onChanged: () => {} });
      window.HomeDashboard = { openNotifications: filter => { window.mailFilter = filter; } };
      window.AgentPanel.init({ apiFetch, enabled: true, showToast: () => {}, pushClient: { getState: () => window.pushFixture, refresh: async () => window.pushFixture, enable: async () => true } });
      document.getElementById('home-overview').hidden = true;
      document.getElementById('home-overview').classList.remove('active');
      const agents = document.getElementById('home-agents');
      agents.hidden = false; agents.classList.add('active');
      document.querySelector('[data-home-view="overview"]').classList.remove('active');
      document.querySelector('[data-home-view="agents"]').classList.add('active');
      document.getElementById('home-now').textContent = '10월 10일 토요일 · 15:52';
    });
    const refresh = () => page.evaluate(() => window.AgentPanel.refresh());
    const snapshotAll = async name => {
      for (const [device, width, height] of [['desktop', 1440, 1100], ['pad', 820, 1180], ['phone', 390, 1090]]) {
        await page.setViewportSize({ width, height });
        assert.equal(await page.evaluate(() => [...document.querySelectorAll('.agent-detail-card')].some(card => card.scrollWidth > card.clientWidth + 1)), false, `${device} ${name} overflow`);
        await page.screenshot({ path: path.join(output, `${device}-${name}.png`), fullPage: true });
      }
    };
    const back = async () => { await page.getByRole('button', { name: '에이전트 요약으로 돌아가기', exact: true }).click(); await page.locator('.agents-dashboard').waitFor(); };
    for (const [name, width, height] of [['desktop', 1440, 1100], ['pad', 820, 1180], ['phone', 390, 1090]]) {
      await page.setViewportSize({ width, height });
      await refresh();
      const geometry = await page.evaluate(() => {
        const board = document.querySelector('.agents-data-board').getBoundingClientRect();
        const rail = document.querySelector('.agents-status-rail').getBoundingClientRect();
        return { board: { x: board.x, y: board.y, width: board.width }, rail: { x: rail.x, y: rail.y }, overflow: document.body.scrollWidth > innerWidth };
      });
      assert.equal(geometry.overflow, false, name);
      if (width > 600) assert.ok(geometry.rail.x > geometry.board.x + geometry.board.width - 1, name);
      else assert.ok(geometry.board.y > geometry.rail.y, name);
      assert.equal(await page.getByText('데이터 미연결', { exact: true }).count(), 1);
      assert.equal(await page.getByText('미연결', { exact: true }).count(), 1);
      await page.screenshot({ path: path.join(output, `${name}-main.png`), fullPage: true });
      for (const label of ['Mail 에이전트', '일정 에이전트', '사서 Codex']) {
        await page.locator('.agent-rail-entry').filter({ hasText: label }).click();
        await page.locator('.agent-detail-body').waitFor();
        await page.screenshot({ path: path.join(output, `${name}-${label.startsWith('Mail') ? 'mail' : label.startsWith('일정') ? 'schedule' : 'codex'}.png`), fullPage: true });
        assert.ok(await page.locator('.agent-detail-card').count() > 1);
        assert.equal(await page.evaluate(() => [...document.querySelectorAll('.agent-detail-card')].some(card => card.scrollWidth > card.clientWidth + 1)), false, `${name} ${label} overflow`);
        if (width === 390) assert.equal(await page.evaluate(() => [...document.querySelectorAll('.agent-detail-workspace button')].some(button => button.getBoundingClientRect().height < 44)), false, `${label} touch targets`);
        await back();
      }
    }
    await page.evaluate(() => {
      window.insightsGate = new Promise(resolve => { window.resolveInsights = resolve; });
      window.pendingInsightsRefresh = window.AgentPanel.refresh();
    });
    await page.locator('.agents-dashboard').waitFor();
    assert.equal(await page.locator('.agent-rail-entry').count(), 5);
    await page.evaluate(() => { window.resolveInsights(); window.insightsGate = null; });
    await page.evaluate(() => window.pendingInsightsRefresh);
    await page.evaluate(() => {
      window.fixture['/api/reels/instagram/insights'] = { status: 'ready', followers: { status: 'ready', latest: { total: 53, observedAt: 1791525500 } }, basis: 'meta_day', scope: 'account_reels', metric: 'views', fetchedAt: 1791600000, points: [
        { startAt: 1791266400, endAt: 1791352800, views: 1234, followers: { total: 54, observedAt: 1791352700 } },
        { startAt: 1791352800, endAt: 1791439200, views: null },
        { startAt: 1791439200, endAt: 1791525600, views: 0, followers: { total: 53, observedAt: 1791525500 } },
      ] };
    });
    await refresh();
    assert.equal(await page.locator('.instagram-insights .views-point').count(), 2);
    assert.equal((await page.locator('.views-trend').getAttribute('d')).match(/M/g).length, 2);
    assert.equal((await page.locator('.views-trend').getAttribute('d')).includes('L'), false);
    assert.equal((await page.locator('.followers-trend').getAttribute('d')).match(/M/g).length, 2);
    assert.equal(await page.locator('.followers-point').count(), 2);
    assert.notEqual(await page.locator('.followers-trend').getAttribute('stroke'), await page.locator('.views-trend').getAttribute('stroke'));
    assert.equal(await page.locator('.instagram-insights tbody tr').nth(1).locator('td').nth(1).textContent(), '미제공');
    await page.locator('.instagram-insights summary').click();
    assert.equal(await page.locator('.instagram-insights tbody tr').count(), 3);
    await snapshotAll('instagram-ready');
    await page.evaluate(() => { window.apiFailures['/api/reels/instagram/insights'] = true; });
    await refresh();
    await page.getByText('지금 조회하지 못해 마지막 조회 결과를 표시해.').waitFor();
    assert.equal(await page.locator('.instagram-insights .views-point').count(), 2);
    await snapshotAll('instagram-stale');
    await page.evaluate(() => { delete window.apiFailures['/api/reels/instagram/insights']; });
    await page.evaluate(() => {
      const values = [2618, 4865, 1318, 707, 802, 2480, 1530];
      window.fixture['/api/reels/instagram/insights'] = { status: 'ready', basis: 'meta_day', scope: 'account_reels', metric: 'views', fetchedAt: 1791633069,
        points: values.map((views, i) => ({ startAt: 1791010800 + i * 86400, endAt: 1791097200 + i * 86400, views })) };
    });
    await refresh();
    assert.equal(await page.locator('.instagram-insights .views-point').count(), 7);
    assert.equal(await page.locator('.agents-data-board > h3').count(), 0);
    assert.equal(await page.locator('.instagram-chart-header h4').textContent(), '인스타그램');
    assert.equal(await page.locator('.instagram-chart-header .instagram-series-legend span').count(), 2);
    assert.ok(await page.locator('.instagram-insights svg').evaluate(el => el.getBoundingClientRect().height <= 220));
    assert.equal((await page.locator('.views-trend').getAttribute('d')).match(/L/g).length, 6);
    assert.equal(await page.locator('.instagram-insights rect').count(), 0);
    await page.evaluate(() => {
      const data = window.fixture['/api/reels/instagram/insights'];
      data.followers = { status: 'ready', latest: { total: 54, observedAt: 1791633069 } };
    });
    await refresh();
    assert.equal(await page.locator('.followers-point').count(), 1);
    assert.equal((await page.locator('.followers-trend').getAttribute('d')).includes('L'), false);
    assert.equal(await page.locator('.instagram-insights .views-point').count(), 7);
    assert.equal(await page.getByText('현재', { exact: true }).count(), 0);
    assert.equal(await page.locator('.instagram-insights tbody tr').count(), 7);
    assert.equal(await page.locator('.followers-point').getAttribute('cx'), await page.locator('.views-point').last().getAttribute('cx'));
    assert.equal(await page.locator('.chart-grid').count(), 5);
    assert.equal(await page.locator('.chart-axis').count(), 2);
    assert.equal(await page.locator('.instagram-insights svg text:not(.chart-tick)').count(), 7);

    await snapshotAll('instagram-seven-days');
    for (const width of [1440, 820, 390]) {
      await page.setViewportSize({ width, height: 1100 });
      assert.ok(await page.locator('.instagram-chart-header').evaluate(el => el.querySelector('.instagram-series-legend').getBoundingClientRect().right < el.querySelector('h4').getBoundingClientRect().left));
    }
    await page.evaluate(() => { window.fixture['/api/reels/instagram/insights'].followers.latest.observedAt = Date.parse('2026-10-10T15:01:00Z') / 1000; });
    await refresh();
    assert.equal(await page.locator('.instagram-insights tbody tr').count(), 8);
    assert.equal(await page.locator('.instagram-insights svg text:not(.chart-tick)').last().textContent(), '10/11');
    assert.equal(await page.locator('.instagram-insights tbody tr').last().locator('td').nth(1).textContent(), '미제공');
    await page.evaluate(() => { window.fixture['/api/reels/instagram/insights'].followers.latest.observedAt = 1791633069; });
    await refresh();

    await page.locator('.agent-rail-entry').filter({ hasText: '일정 에이전트' }).click();
    await page.getByRole('button', { name: '전체 일정', exact: true }).click();
    await page.locator('#agent-task-content .task-view-tabs').waitFor();
    await page.getByRole('button', { name: '일정 요약으로 돌아가기', exact: true }).click();
    await page.locator('.agents-dashboard').waitFor();
    assert.equal(await page.evaluate(() => window.calls.some(c => /acknowledge/.test(c.route))), false);
    // Existing mail setting and preference contracts, including conditional recovery.
    await page.locator('.agent-rail-entry').filter({ hasText: 'Mail 에이전트' }).click();
    await page.getByRole('button', { name: 'Push 끄기' }).click();
    assert.equal(await page.evaluate(() => window.fixture['/api/mail/settings'].settings.notificationsEnabled), false);
    await page.getByRole('button', { name: '방해 금지 켜기' }).click();
    assert.equal(await page.evaluate(() => window.fixture['/api/mail/settings'].settings.quietHours.start), '23:00');
    await page.getByRole('button', { name: '되돌리기', exact: true }).click();
    await page.getByRole('button', { name: '되돌리기', exact: true }).waitFor({ state: 'detached' });
    assert.equal(await page.getByText('분석 복구', { exact: true }).count(), 0);
    await page.evaluate(() => { window.fixture['/api/mail/status'].analysis.failed = 2; window.fixture['/api/mail/status'].accounts[0].status = 'auth_required'; });
    await refresh();
    assert.equal(await page.getByText('메일 재인증 필요', { exact: true }).count(), 1);
    await page.getByRole('button', { name: '멈춘 2개 다시' }).click();
    assert.ok(await page.evaluate(() => window.calls.some(c => c.route === '/api/mail/analysis/requeue' && c.method === 'POST')));
    await snapshotAll('mail-error');
    await back();
    // Model versions and all fail-close gates.
    await page.locator('.agent-rail-entry').filter({ hasText: '사서 Codex' }).click();
    await page.getByRole('button', { name: '변경 저장' }).click();
    await page.waitForFunction(() => window.calls.some(c => c.route === '/api/settings/codex-models'));
    const model = await page.evaluate(() => window.calls.find(c => c.route === '/api/settings/codex-models'));
    assert.equal(model.headers['If-Match'], '"3"');
    assert.equal(JSON.parse(model.body).deepVersion, 4);
    for (const gate of ['runner', 'recovery', 'unavailable']) {
      await page.evaluate(gate => {
        window.apiFailures['/api/organize/status'] = gate === 'unavailable';
        const state = window.fixture['/api/organize/status'];
        state.runner.ok = gate !== 'runner'; state.recoveryRequired = gate === 'recovery' ? 1 : 0;
      }, gate);
      await refresh();
      assert.equal(await page.getByRole('button', { name: '대기열 정리', exact: true }).isDisabled(), true, gate);
    }
    await snapshotAll('codex-error');
    await back();
    // Reels uses real episode states; no invented substage progress or publication success.
    await page.evaluate(() => { window.apiFailures = {}; });
    await page.locator('.agent-rail-entry').filter({ hasText: 'Reels · Shorts' }).click();
    await page.locator('.reels-stage[aria-current="step"]').waitFor();
    assert.equal(await page.locator('.reels-stage').count(), 4);
    assert.equal(await page.locator('details.reels-stage').count(), 0);
    assert.equal(await page.locator('.reels-stage img[onerror]').count(), 0);
    await snapshotAll('reels-candidates');
    await page.getByRole('button', { name: '이걸로' }).click();
    assert.ok(await page.evaluate(() => window.calls.some(c => c.route === '/api/reels/candidates/7/select' && c.method === 'POST')));
    for (const status of ['producing', 'revising', 'failed', 'ready', 'approved']) {
      await page.evaluate(status => {
        window.fixture['/api/reels/latest'].batch.status = 'selected';
        window.fixture['/api/reels/episodes/latest'].episode = { id: 9, candidateId: 7, batchId: window.fixture['/api/reels/latest'].batch.batchId, status, title: 'Fixture episode', caption: '<script>fixture</script>', videoUrl: status === 'ready' || status === 'approved' ? '/api/reels/episodes/9/video' : null, claims: [], revisions: [], attempts: 1, errorCode: status === 'failed' ? 'FIXTURE_FAILURE' : null, uploads: status === 'approved' ? [{ platform: 'youtube', status: 'failed', errorCode: 'FIXTURE_UPLOAD' }, { platform: 'instagram', status: 'done', remoteUrl: 'https://www.instagram.com/reel/fixture/' }] : [] };
      }, status);
      await refresh();
      const step = await page.locator('.reels-stage[aria-current="step"]').getAttribute('data-step');
      assert.equal(await page.locator('.reels-stage:not(.active) .reels-episode-card').count(), 0);
      assert.equal(await page.locator('.reels-stage .reels-check').count(), Number(step) - 1);
      assert.equal(step, ['producing', 'revising', 'failed'].includes(status) ? '2' : status === 'ready' ? '3' : '4');
      assert.equal(await page.getByRole('button', { name: '승인', exact: true }).count(), status === 'ready' ? 1 : 0);
      await snapshotAll(`reels-${status}`);
      if (status === 'ready') {
        await page.waitForFunction(() => document.querySelector('.reels-video video')?.src.startsWith('blob:'));
        assert.equal(await page.getByRole('button', { name: '영상 저장', exact: true }).count(), 1);
        await page.evaluate(async () => {
          window.playingReel = document.querySelector('.reels-video video');
          window.playingReel.muted = true; window.playingReel.loop = true;
          await window.playingReel.play();
        });
        for (let i = 0; i < 3; i++) await refresh();
        assert.equal(await page.evaluate(() => document.querySelector('.reels-video video') === window.playingReel && !window.playingReel.paused), true, 'polling must preserve playing video');
        await page.evaluate(() => { window.fixture['/api/reels/episodes/latest'].episode.caption = 'Updated fixture caption'; });
        await refresh();
        assert.equal(await page.evaluate(() => document.querySelector('.reels-video video') === window.playingReel && !window.playingReel.paused), true, 'metadata updates must preserve playing video');
        await page.getByText('Updated fixture caption', { exact: true }).waitFor();

        await page.getByRole('button', { name: '수정 요청', exact: true }).click();
        assert.equal(await page.locator('.reels-revise textarea').isVisible(), true);
        await page.getByRole('button', { name: '승인', exact: true }).click();
      }
    }
    await page.getByRole('button', { name: '다시 시도', exact: true }).click();
    await page.getByRole('button', { name: '수동 게시함', exact: true }).waitFor({ state: 'detached' });
    assert.ok(await page.evaluate(() => window.calls.some(c => c.route === '/api/reels/episodes/9/uploads/youtube/retry')));
    assert.equal(await page.getByRole('link', { name: '열기', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Agents로 돌아가기' }).click();
    await page.locator('.agents-dashboard').waitFor();
    assert.ok(await page.evaluate(() => window.revokedMedia.length > 0));
    await page.evaluate(() => { window.apiFailures['/api/mail/status'] = true; document.documentElement.dataset.theme = 'dark'; });
    await refresh();
    assert.equal(await page.locator('.agent-rail-entry').count(), 5);
    await page.screenshot({ path: path.join(output, 'phone-dark-source-error.png'), fullPage: true });
    await page.locator('.agent-rail-entry').filter({ hasText: 'Reels · Shorts' }).click();
    await page.evaluate(() => {
      window.fixture['/api/reels/latest'].batch.batchId = '2000-01-01';
      window.fixture['/api/reels/episodes/latest'].episode.batchId = '2000-01-01';
    });
    await refresh();
    assert.equal(await page.locator('.reels-stage .reels-check').count(), 0);
    assert.equal(await page.locator('.reels-stage[aria-current="step"]').getAttribute('data-step'), '1');
    await page.getByText('오늘 주제 후보를 기다리는 중이야.').waitFor();
    await snapshotAll('reels-new-cycle');
    await page.getByRole('button', { name: 'Agents로 돌아가기' }).click();
    await page.locator('.agents-dashboard').waitFor();
    await page.evaluate(() => {
      window.fixture['/api/cards/latest'] = { batch: null };
      window.fixture['/api/cards/jobs/latest'] = { job: { id: 12, status: 'ready', title: 'Fixture card job', images: [], claims: [], caption: 'Fixture caption', finishedAt: 123 } };
    });
    await refresh();
    await page.locator('.agent-rail-entry').filter({ hasText: '카드 뉴스' }).click();
    await page.getByText('시온의 원리노트', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '승인', exact: true }).count(), 1);
    await page.getByRole('button', { name: '승인', exact: true }).click();
    assert.ok(await page.evaluate(() => window.calls.some(c => c.route === '/api/cards/jobs/12/approve' && c.method === 'POST')));
    await snapshotAll('cards-existing-contract');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify({ viewports: [1440, 820, 390], assertions: 'layout, detail navigation, mail settings/recovery, model versions, Codex fail-close, Reels states/selection/approval/revision/upload retry, XSS text, source isolation, dark', errors, apiCalls: await page.evaluate(() => window.calls) }, null, 2));
    console.log(`Agents browser checks passed; screenshots and receipt: ${output}`);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
