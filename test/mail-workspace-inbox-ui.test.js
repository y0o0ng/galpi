'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');

const ROOT = path.join(__dirname, '../public');
const chrome = [
  process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(file => file && existsSync(file));

async function browser(t) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'galpi-mail-browser-'));
  const child = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-background-networking', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + profile], { stdio: 'ignore' });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const completed = once(child, 'exit');
      child.kill('SIGTERM');
      await completed;
    }
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  let port;
  for (let attempt = 0; attempt < 120 && !port; attempt++) {
    if (child.exitCode !== null) throw new Error('Chrome exited before opening its local test connection');
    try { [port] = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n'); } catch {}
    if (!port) await delay(50);
  }
  assert.ok(port);
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const socket = new WebSocket(targets.find(item => item.type === 'page').webSocketDebuggerUrl);
  await once(socket, 'open');
  t.after(() => socket.close());
  const waiting = new Map();
  const network = [];
  const uncaught = [];
  let next = 0;
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Network.requestWillBeSent') network.push(message.params.request.url);
    if (message.method === 'Runtime.exceptionThrown') uncaught.push(message.params.exceptionDetails.exception?.description);
    if (message.id && waiting.has(message.id)) {
      const { resolve, reject, timer } = waiting.get(message.id);
      clearTimeout(timer);
      waiting.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  });
  function call(method, params = {}) {
    const id = ++next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiting.delete(id); reject(new Error('Chrome command timeout ' + method)); }, 6000);
      waiting.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async function waitFor(expression) {
    for (let index = 0; index < 240; index++) {
      if (await evaluate(expression)) return;
      await delay(50);
    }
    throw new Error('Browser condition not reached: ' + expression + '\n' + await evaluate('document.body.innerText.slice(-2200)')
      + '\n' + uncaught.join('\n'));
  }
  const metrics = (width, height) => call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const shown = selector => 'Boolean(document.querySelector(' + JSON.stringify(selector) + ')?.getClientRects().length)';
  const text = value => '(document.querySelector("#mail-workspace").innerText.includes(' + JSON.stringify(value) + '))';
  const click = selector => evaluate('document.querySelector(' + JSON.stringify(selector) + ').click()');
  const press = (label, selector = '#mail-workspace button') => evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})]
    .find(button => (button.getAttribute('aria-label') || button.textContent.trim()) === ${JSON.stringify(label)} && button.getClientRects().length && !button.disabled).click()`);
  const capture = async filename => {
    if (!process.env.MAIL_INBOX_SCREENSHOTS) return;
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const png = await call('Page.captureScreenshot', { format: 'png' });
    await fs.mkdir(process.env.MAIL_INBOX_SCREENSHOTS, { recursive: true });
    await fs.writeFile(path.join(process.env.MAIL_INBOX_SCREENSHOTS, filename), Buffer.from(png.data, 'base64'));
  };
  await call('Network.enable');
  await call('Runtime.enable');
  return { call, evaluate, waitFor, metrics, shown, text, click, press, capture, network };
}

async function mockApp(t) {
  const accounts = [
    { id: 1, provider: 'gmail', address: 'sample@gmail.com', status: 'active' },
    { id: 2, provider: 'naver', address: 'sample@naver.com', status: 'active' },
    { id: 3, provider: 'works', address: 'student@school.ac.kr', status: 'active' },
  ];
  const now = Math.floor(Date.now() / 1000);
  const fixture = process.env.MAIL_INBOX_FIXTURE;
  const messages = fixture ? JSON.parse(await fs.readFile(fixture, 'utf8')) : [
    { id: 1, accountId: 1, provider: 'gmail', subject: '논문 피드백 전달', from: [{ name: '최유진 교수' }],
      receivedAt: now, read: false, important: true, starred: true, hasAttachments: true },
    { id: 2, accountId: 3, provider: 'works', subject: '재료공학 과제 안내', from: [{ name: '김민수 교수' }],
      receivedAt: now - 1, read: false, starred: false, hasAttachments: true },
    { id: 3, accountId: 2, provider: 'naver', subject: '신소재 실험 결과 공유', from: [{ name: '이서연 연구원' }],
      receivedAt: now - 2, read: true, starred: false },
  ];
  const calls = [];
  const state = { enabled: true, outcome: 'confirmed', incomplete: false, inboxError: false };
  const routes = process.env.MAIL_INBOX_EXPORTS ? JSON.parse(process.env.MAIL_INBOX_EXPORTS) : [];
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const endpoint = url.pathname;
    const json = (data, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (endpoint === '/export/0' || endpoint === '/export/1') {
      const raw = await fs.readFile(routes[Number(endpoint.at(-1))], 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      const fallback = "'SF Pro', -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', system-ui, sans-serif";
      res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0}'
        + 'div[style*="position: absolute"]{visibility:hidden}</style>'
        + raw.replaceAll('font-family: SF Pro', 'font-family: ' + fallback));
      return;
    }
    if (!endpoint.startsWith('/api/')) {
      const file = path.join(ROOT, endpoint === '/' ? 'index.html' : endpoint);
      try {
        const data = await fs.readFile(file);
        res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      } catch { res.writeHead(404).end(); }
      return;
    }
    let payload;
    if (req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      payload = JSON.parse(Buffer.concat(chunks).toString());
    }
    calls.push({ method: req.method, endpoint, query: Object.fromEntries(url.searchParams), payload });
    if (endpoint === '/api/config') return json({ requiresApiToken: false, gptChatBootstrapModel: 'mock' });
    if (endpoint === '/api/models/chat') return json({ selection: 'auto', options: [], resolvedModelId: null });
    if (!endpoint.startsWith('/api/mail-client/')) return json({ messages: [], notes: [], models: [], notifications: [], ddays: [], chat: [] });
    if (endpoint.endsWith('/accounts')) return state.enabled ? json({ success: true, accounts })
      : json({ success: false, code: 'MAIL_CLIENT_DISABLED' }, 503);
    if (endpoint.endsWith('/mailboxes')) {
      const id = Number(endpoint.split('/').at(-2));
      const mailboxes = [{ id: 'inbox', inbox: true, selectable: true, name: '받은편지함' }];
      if (id === 1) mailboxes.push(...['연구실', '지원서'].map(name => ({ id: name, name, kind: 'label', type: 'user', selectable: true })));
      return json({ success: true, mailboxes });
    }
    if (endpoint.endsWith('/inbox')) {
      if (state.inboxError) return json({ success: false, code: 'MAIL_CLIENT_PROVIDER_UNAVAILABLE' }, 503);
      if (url.searchParams.has('cursor')) return json({ success: true, messages: [
        { ...messages[0], id: 40, subject: '이전 메일' },
      ], nextCursor: null });
      return json({ success: true, messages: messages.filter(message => !message.removed),
        incomplete: state.incomplete, sources: accounts.map(account => ({
          ...account, status: state.incomplete && account.id === 3 ? 'unavailable' : 'fresh',
        })), nextCursor: '00000000-0000-4000-8000-000000000001' });
    }
    if (endpoint.endsWith('/messages')) {
      const id = Number(endpoint.split('/').at(-2));
      return json({ success: true, messages: messages.filter(message => message.accountId === id && !message.removed) });
    }
    if (endpoint.endsWith('/messages/actions')) {
      if (state.outcome === 'disabled') return json({ success: false, code: 'MAIL_CLIENT_WRITE_DISABLED' }, 503);
      return json({ success: state.outcome === 'confirmed', results: payload.operations.map(operation => {
        const message = messages.find(item => item.id === operation.messageId);
        if (state.outcome === 'confirmed') {
          if (operation.action === 'set_read') message.read = operation.value;
          if (operation.action === 'set_starred') message.starred = operation.value;
          if (operation.action === 'archive' || operation.action === 'trash') message.removed = true;
        }
        return { messageId: message.id, state: state.outcome };
      }) });
    }
    return json({ success: false, code: 'MOCK_NOT_FOUND' }, 404);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { url: 'http://127.0.0.1:' + server.address().port, calls, messages, state, routes };
}

const measures = selectors => `JSON.stringify(${JSON.stringify(selectors)}.map(selector => {
  const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
  return [x,y,width,height];
}))`;

test('desktop inbox renders base and selected exports, preserves explicit actions, and keeps cursor scopes', { skip: !chrome }, async t => {
  const app = await mockApp(t);
  const ui = await browser(t);
  await ui.metrics(1440, 900);
  await ui.call('Page.navigate', { url: app.url });
  await ui.waitFor(ui.shown('.home-card-mail'));
  assert.equal(app.calls.some(call => call.endpoint.startsWith('/api/mail-client')), false);
  await ui.click('.home-card-mail');
  await ui.waitFor(ui.shown('#mail-workspace.active .mw-row'));
  assert.equal(await ui.evaluate('document.querySelectorAll("#global-nav").length'), 1);
  assert.equal(await ui.evaluate('document.querySelector("#home-page").classList.contains("active")'), false);
  assert.equal(await ui.evaluate('document.querySelector(".mw-toolbar").innerText.replace(/\\s+/g," ").trim()'),
    '읽음 안 읽음 중요 보관 휴지통 이동 필터');
  assert.equal(await ui.evaluate('document.querySelectorAll(".mw-row[data-checked=Yes]").length'), 0);
  await ui.waitFor('[...document.querySelectorAll("#mail-workspace img")].every(img => img.complete && img.naturalWidth > 0)');
  const fixtureImportance = app.messages[0].important;
  const rects = ['#global-nav', '.mw-sidebar', '.mw-main', '.mw-header', '.mw-toolbar', '.mw-rows', '.mw-row', '.mw-pagination'];
  const baseRects = JSON.parse(await ui.evaluate(measures(rects)));
  assert.deepEqual(baseRects.slice(0, 7), [
    [0, 0, 232, 900], [232, 0, 240, 900], [472, 0, 968, 900],
    [504, 28, 904, 36], [504, 80, 904, 32], [504, 128, 904, 44 * app.messages.length], [504, 128, 904, 44],
  ]);
  await ui.capture('app-basic.png');

  await ui.click('[data-message-id="1"] .mw-row-select');
  await ui.click('[data-message-id="3"] .mw-row-select');
  assert.equal(await ui.evaluate('document.querySelector(".mw-selection").textContent'), '2개 선택');
  assert.equal(await ui.evaluate('getComputedStyle(document.querySelector(".mw-row[data-checked=Yes]")).backgroundColor'), 'rgb(226, 236, 231)');
  assert.deepEqual(JSON.parse(await ui.evaluate(measures(rects))), baseRects);
  assert.equal(app.calls.some(call => call.method === 'POST'), false);
  await ui.capture('app-selected.png');

  await ui.press('읽음');
  await ui.waitFor('document.querySelector("[data-message-id=\\"1\\"]")?.dataset.state === "Read"');
  const actions = () => app.calls.filter(call => call.endpoint.endsWith('/messages/actions'));
  assert.deepEqual(actions()[0].payload.operations, [1, 3].map(messageId => ({ messageId, action: 'set_read', value: true })));
  assert.ok(actions()[0].payload.requestId);
  assert.equal(app.messages[0].important, fixtureImportance);
  await ui.click('[data-message-id="1"] .mw-row-star');
  await ui.waitFor('document.querySelector("[data-message-id=\\"1\\"] .mw-row-star")?.getAttribute("aria-pressed") === "false"');
  assert.deepEqual(actions()[1].payload.operations, [{ messageId: 1, action: 'set_starred', value: false }]);
  assert.equal(app.messages[0].important, fixtureImportance);
  await ui.click('[data-message-id="1"] .mw-row-select');
  app.state.outcome = 'unknown';
  await ui.press('휴지통', '.mw-toolbar button');
  await ui.waitFor('document.querySelector("[data-message-id=\\"1\\"] .mw-row-star")?.disabled');
  assert.ok(await ui.evaluate(ui.shown('[data-message-id="1"]')));
  assert.equal(actions().length, 3);
  app.state.incomplete = true;
  await ui.press('새로고침');
  await ui.waitFor('document.querySelector(".mw-rows").getAttribute("aria-busy") === "false"');
  assert.equal(await ui.evaluate('document.querySelector("[data-message-id=\\"1\\"] .mw-row-star").disabled'), true);
  assert.ok(await ui.evaluate('document.body.innerText.includes("Works · 일부 메일")'));
  app.state.incomplete = false;
  await ui.press('새로고침');
  await ui.waitFor('!document.querySelector("[data-message-id=\\"1\\"] .mw-row-star")?.disabled');
  app.state.inboxError = true;
  await ui.press('새로고침');
  await ui.waitFor('document.body.innerText.includes("메일 목록을 불러오지 못했어")');
  assert.ok(await ui.evaluate(ui.shown('[data-message-id="1"]')));
  app.state.inboxError = false;
  await ui.press('다음 페이지');
  await ui.waitFor(ui.text('이전 메일'));
  assert.ok(app.calls.some(call => call.query.cursor === '00000000-0000-4000-8000-000000000001'));
  await ui.press('이전 페이지');
  await ui.waitFor(ui.text('논문 피드백 전달'));
  await ui.press('Gmail', '.mw-chips button');
  await ui.waitFor('document.querySelectorAll(".mw-row .mw-provider").length > 0 && [...document.querySelectorAll(".mw-provider")].every(node => node.textContent === "Gmail")');
  assert.ok(app.calls.some(call => call.endpoint.includes('/accounts/1/messages') && call.query.mailbox === 'inbox'));
  await ui.press('전체', '.mw-chips button');
  await ui.waitFor(ui.shown('[data-message-id="2"]'));
  app.state.outcome = 'confirmed';
  await ui.click('[data-message-id="2"] .mw-row-select');
  await ui.press('보관', '.mw-toolbar button');
  await ui.waitFor('!' + ui.shown('[data-message-id="2"]') + ' && document.querySelector(".mw-rows").getAttribute("aria-busy") === "false"');
  assert.deepEqual(actions().at(-1).payload.operations, [{ messageId: 2, action: 'archive' }]);
  await ui.click('[data-message-id="3"] .mw-row-select');
  await ui.press('휴지통', '.mw-toolbar button');
  await ui.waitFor('!' + ui.shown('[data-message-id="3"]') + ' && document.querySelector(".mw-rows").getAttribute("aria-busy") === "false"');
  assert.deepEqual(actions().at(-1).payload.operations, [{ messageId: 3, action: 'trash' }]);
  assert.equal(app.calls.some(call => /\/smart\/|\/send$/.test(call.endpoint)), false);
  await ui.click('#global-nav [data-product-route="home"]');
  await ui.waitFor(ui.shown('#home-page.active .home-card-mail'));
  assert.equal(await ui.evaluate(ui.shown('#mail-workspace')), false);

  for (const [index] of app.routes.entries()) {
    await ui.call('Page.navigate', { url: app.url + '/export/' + index });
    await ui.waitFor(ui.shown('[data-attachment]'));
    const exportRects = JSON.parse(await ui.evaluate(measures([
      'body > div > div:nth-child(1)', 'body > div > div:nth-child(2)', 'body > div > div:nth-child(3)',
      'body > div > div:nth-child(3) > div:nth-child(1)', 'body > div > div:nth-child(3) > div:nth-child(2)',
      'body > div > div:nth-child(3) > div:nth-child(3)', '[data-attachment]',
      'body > div > div:nth-child(3) > div:nth-child(4)',
    ])));
    assert.deepEqual(exportRects, baseRects);
    await ui.capture(index ? 'export-selected.png' : 'export-basic.png');
  }
});

test('disabled Mail Workspace uses the existing Home mail card and respects the write gate', { skip: !chrome }, async t => {
  const app = await mockApp(t);
  app.state.enabled = false;
  const ui = await browser(t);
  await ui.call('Page.navigate', { url: app.url });
  await ui.waitFor(ui.shown('.home-card-mail'));
  await ui.click('.home-card-mail');
  await ui.waitFor(ui.shown('.home-card-mail.focused'));
  assert.equal(await ui.evaluate(ui.shown('#mail-workspace.active')), false);
  app.state.enabled = true;
  app.state.outcome = 'disabled';
  await ui.call('Page.reload', { ignoreCache: true });
  await ui.waitFor(ui.shown('.home-card-mail'));
  await ui.click('.home-card-mail');
  await ui.waitFor(ui.shown('.mw-row'));
  await ui.click('[data-message-id="1"] .mw-row-star');
  await ui.waitFor('document.body.innerText.includes("메일 상태를 변경할 수 없어")');
  assert.equal(await ui.evaluate('document.querySelector("[data-message-id=\\"1\\"] .mw-row-star").disabled'), true);
  assert.equal(app.calls.filter(call => call.method === 'POST').length, 1);
});
