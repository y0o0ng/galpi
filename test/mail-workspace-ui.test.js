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

test('Mail Workspace renders original component variants and local Figma assets', async () => {
  const source = await fs.readFile(path.join(ROOT, 'mail-workspace-components.js'), 'utf8');
  for (const node of ['452:977', '452:993', '452:970', '475:9061', '478:9453', '463:3011', '470:5453']) assert.ok(source.includes(node));
  const html = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(html.indexOf('mail-workspace-components.js') < html.indexOf('mail-workspace.js'));
  assert.ok(html.indexOf('mail-workspace.js') < html.indexOf('home.js'));
  assert.equal(html.includes('data-product-route="mail"'), false);
  const icons = await fs.readdir(path.join(ROOT, 'assets/figma/mail-workspace'));
  assert.ok(icons.length >= 25);
  for (const file of icons) {
    const svg = await fs.readFile(path.join(ROOT, 'assets/figma/mail-workspace', file), 'utf8');
    assert.match(svg, /<svg\b[^>]*\b(?:width|height)=/);
    assert.doesNotMatch(svg, /<script|\bonload=|(?:xlink:)?href=["']https?:/i);
  }
});

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
    if (!process.env.MAIL_M1_SCREENSHOTS) return;
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const png = await call('Page.captureScreenshot', { format: 'png' });
    await fs.mkdir(process.env.MAIL_M1_SCREENSHOTS, { recursive: true });
    await fs.writeFile(path.join(process.env.MAIL_M1_SCREENSHOTS, filename), Buffer.from(png.data, 'base64'));
  };
  await call('Network.enable');
  await call('Runtime.enable');
  return { call, evaluate, waitFor, metrics, shown, text, click, press, capture, network };
}

async function mockApp(t) {
  const switches = { enabled: true, writeEnabled: true, smartEnabled: true };
  const accounts = [
    { id: 1, provider: 'gmail', address: 'one@example.com', status: 'active' },
    { id: 2, provider: 'naver', address: 'two@example.com', status: 'active' },
    { id: 3, provider: 'works', address: 'three@example.com', status: 'active' },
  ];
  const timestamp = Math.floor(Date.now() / 1000);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const messages = [
    { id: 11, accountId: 1, provider: 'gmail', receivedAt: timestamp, subject: '논문 피드백 전달', from: [{ name: '최유진 교수', address: 'sender@example.com' }],
      read: false, starred: false, important: true, labelIds: ['INBOX', 'IMPORTANT'], hasAttachments: true },
    { id: 12, accountId: 2, provider: 'naver', receivedAt: timestamp - 800, subject: '재료공학 과제 안내', from: [{ name: '김민수 교수' }],
      read: false, starred: true, labelIds: [], folderPath: 'INBOX' },
    { id: 13, accountId: 3, provider: 'works', receivedAt: timestamp - 1200, subject: '2027-1학기 수강신청 일정 안내', from: [{ name: '학사지원팀' }],
      read: true, starred: false, labelIds: [], folderPath: 'INBOX' },
  ];
  const pageTwo = { ...messages[0], id: 21, subject: '둘째 페이지 메일', hasAttachments: false };
  const smartSnapshot = structuredClone(messages);
  const sources = accounts.map(account => ({ accountId: account.id, provider: account.provider, status: 'fresh' }));
  const source = sources[0];
  const calls = [];
  const ids = rows => rows.map(item => item.id);
  const getMessage = id => [...messages, pageTwo].find(message => message.id === id);
  let confirmTrash = false;
  let analyses = 0;
  let shifted = false;
  let inboxFailure = false;
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const endpoint = url.pathname;
    const json = (data, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: status < 400, ...data }));
    };
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
    if (endpoint === '/api/config') return json({ requiresApiToken: false, weatherEnabled: false, tasksEnabled: false,
      gptChatBootstrapModel: 'mock', mailClient: switches });
    if (endpoint === '/api/models/chat') return json({ selection: 'auto', options: [], resolvedModelId: null });
    if (endpoint === '/api/notifications') return json({ notifications: [
      { id: 'attention-42', attentionId: 42, mailMessageId: 7, source: 'mail', type: 'mail_attention', title: '논문 피드백 전달', sender: '최유진 교수' },
    ] });
    if (!endpoint.startsWith('/api/mail-client')) return json({ messages: [], notes: [], models: [], notifications: [], ddays: [], chat: [] });
    if (endpoint.endsWith('/accounts')) return json({ accounts });
    if (endpoint.endsWith('/mailboxes')) {
      const id = Number(endpoint.split('/').at(-2));
      const mailboxes = id === 1 ? [
        { id: 'all', kind: 'all', name: '전체 메일', selectable: true },
        { id: 'label:INBOX', kind: 'label', type: 'system', providerId: 'INBOX', inbox: true, name: 'INBOX', selectable: true },
        { id: 'label:TRASH', kind: 'label', type: 'system', providerId: 'TRASH', name: 'Trash', selectable: true },
        { id: 'label:Label_1', kind: 'label', type: 'user', name: '연구실', selectable: true },
      ] : [{ id: 'folder:INBOX', kind: 'folder', path: 'INBOX', inbox: true, name: 'INBOX', selectable: true }];
      return json({ mailboxes, source: sources[id - 1] });
    }
    if (endpoint.endsWith('/inbox')) {
      if (inboxFailure) return json({ code: 'MAIL_CLIENT_PROVIDER_UNAVAILABLE' }, 503);
      if (url.searchParams.has('cursor')) return json({ messages: [pageTwo], nextCursor: null, sources, incomplete: false });
      return json({ messages: messages.filter(item => !item.labelIds.includes('TRASH')), nextCursor: '11111111-1111-4111-8111-111111111111',
        sources: [source, sources[1], { ...sources[2], status: 'unavailable', failure: { code: 'MAIL_CLIENT_AUTH_REQUIRED' } }], incomplete: true });
    }
    if (endpoint.includes('/accounts/') && endpoint.endsWith('/messages')) {
      const id = Number(endpoint.split('/').at(-2));
      const box = url.searchParams.get('mailbox');
      const visible = messages.filter(item => item.accountId === id && (box === 'label:TRASH'
        ? item.labelIds.includes('TRASH') : !item.labelIds.includes('TRASH') && (box !== 'label:Label_1' || shifted)));
      return json({ messages: visible, source: sources[id - 1], nextCursor: null, incomplete: false });
    }
    if (endpoint.endsWith('/attention/42')) return json({ id: 11 });
    if (/\/messages\/\d+$/.test(endpoint)) {
      const id = Number(endpoint.split('/').at(-1));
      if (id === 21) return json({ code: 'MAIL_CLIENT_LOCATION_STALE' }, 409);
      return json({ message: { ...getMessage(id), cc: [{ address: 'copy@example.com' }],
        body: { format: 'text', text: '<img src="https://tracking.invalid/pixel"><script>window.mailExecuted = true</script>' },
        thread: { providerThreadId: 'fixture-thread', references: ['<parent@example.com>'] },
        attachments: [{ filename: '논문초안.pdf', size: 2020, contentType: 'application/pdf' }],
      } });
    }
    if (endpoint.endsWith('/messages/actions')) {
      return json({ results: payload.operations.map(operation => {
        const mail = getMessage(operation.messageId);
        const action = operation.action;
        if (action === 'trash') {
          if (!confirmTrash) return { messageId: mail.id, state: 'unknown', code: 'MAIL_CLIENT_WRITE_UNKNOWN' };
          mail.labelIds.push('TRASH');
        }
        if (action === 'set_read' && !operation.value) return { messageId: mail.id, state: 'failed', code: 'MAIL_CLIENT_WRITE_REJECTED' };
        if (action === 'set_read') mail.read = operation.value;
        if (action === 'set_starred') mail.starred = operation.value;
        if (action === 'move') shifted = true;
        return { messageId: mail.id, state: 'confirmed' };
      }) });
    }
    if (endpoint.endsWith('/smart/messages')) return json({ coverage: { complete: false }, messages: smartSnapshot, nextCursor: null });
    if (endpoint.endsWith('/smart/analyze')) {
      return json({ results: payload.messageIds.map((id, index) => ({ id, jobs: [
        { kind: 'calendar', state: index === 0 ? 'pending' : index === 1 ? 'failed' : 'skipped', code: index === 2 ? 'MAIL_CLIENT_SMART_PREFERENCE_SKIP' : undefined },
      ] })) }, 202);
    }
    if (endpoint.endsWith('/smart/results')) {
      analyses += 1;
      return json({ results: [{ id: ids(messages)[0], jobs: [{ kind: 'calendar', state: 'done' }],
        classification: { source: 'agent' }, classificationStatus: { state: 'done' }, calendarStatus: { state: 'done' } }] });
    }
    const event = { id: 1, messageId: 11, accountId: 1, title: '연구실 면담', kind: 'personal', startDate: today,
      startAt: timestamp, dateProvenance: 'inferred', referenceKstDate: today,
      originalDateText: '11월 21일', inferenceReason: 'nearest_future', evidenceExcerpt: '연구실 면담이 예정되어 있어.' };
    if (endpoint.endsWith('/smart/calendar')) return json({
      events: [event, { ...event, id: 2, title: '과제 제출', kind: 'deadline' }],
      unresolved: { events: [{ ...event, id: 3, title: '날짜 미정 면담', dateProvenance: 'unresolved', startDate: null, startAt: null }] },
      coverage: { complete: false }, nextCursor: null,
    });
    if (endpoint.endsWith('/smart/calendar/1')) return json({ event, taskProposal: { value: {} } });
    return json({ code: 'MOCK_NOT_FOUND' }, 404);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { url: 'http://127.0.0.1:' + server.address().port, calls, switches, messages,
    analyses: () => analyses, failInbox(value) { inboxFailure = value; }, confirmTrash() { confirmTrash = true; } };
}

async function enterMail(t) {
  const app = await mockApp(t);
  const ui = await browser(t);
  await ui.metrics(1440, 900);
  await ui.call('Page.navigate', { url: app.url });
  await ui.waitFor(ui.shown('.home-mail-workspace-link'));
  await ui.click('.home-mail-workspace-link');
  await ui.waitFor(ui.shown('.m1-mail-row[data-message-id="11"]'));
  return { app, ui };
}

test('desktop exposes partial accounts, real mailbox and cursor navigation, and safe details', { skip: !chrome }, async t => {
  const { app, ui } = await enterMail(t);
  assert.equal(await ui.evaluate(ui.text('Works · 계정 인증이 만료됐어.')), true);
  assert.equal(await ui.evaluate('document.querySelectorAll(".m1-rows .m1-source-tag").length'), 3);
  assert.equal(app.calls.some(call => call.endpoint.endsWith('/smart/analyze')), false);
  await ui.capture('desktop-inbox.png');
  await ui.press('다음 페이지');
  await ui.waitFor(ui.text('둘째 페이지 메일'));
  assert.ok(app.calls.find(call => call.query.cursor === '11111111-1111-4111-8111-111111111111'));
  await ui.click('[data-message-id="21"] .m1-row-open');
  await ui.waitFor(ui.text('메일 위치나 원본이 바뀌었어.'));
  await ui.press('목록');
  await ui.waitFor(ui.text('둘째 페이지 메일'));
  await ui.press('이전 페이지');
  await ui.click('[data-message-id="11"] .m1-row-open');
  await ui.waitFor(ui.shown('.m1-message-body'));
  assert.equal(await ui.evaluate('document.querySelector(".m1-message-body").children.length'), 0);
  assert.equal(await ui.evaluate('Boolean(window.mailExecuted)'), false);
  assert.equal(ui.network.some(url => url.includes('tracking.invalid')), false);
  assert.equal(await ui.evaluate(ui.text('copy@example.com')), true);
  assert.equal(await ui.evaluate(ui.text('논문초안.pdf')), true);
  assert.equal(await ui.evaluate('document.querySelector(".m1-attachments button")'), null);
  await ui.capture('desktop-detail.png');
  await ui.press('목록');
  await ui.waitFor(ui.shown('[data-message-id="11"]'));
  app.failInbox(true);
  await ui.press('새로고침');
  await ui.waitFor(ui.text('메일 목록을 불러오지 못했어.'));
  assert.equal(await ui.evaluate(ui.shown('[data-message-id="11"]')), true);
  await ui.press('휴지통', '#mail-workspace-folders button');
  await ui.waitFor(ui.text('메일함이 비어 있어.'));
  assert.equal(await ui.evaluate(ui.text('메일 목록을 불러오지 못했어.')), false);
  await ui.press('Home Overview로 돌아가기');
  await ui.waitFor(ui.shown('.home-mail-workspace-link'));
  await ui.evaluate('window.HomeDashboard.openNotifications("mail")');
  await ui.waitFor(ui.shown('.mail-open'));
  await ui.click('.mail-open');
  await ui.waitFor(ui.shown('.m1-message-body'));
  assert.ok(app.calls.some(call => call.endpoint === '/api/mail-client/attention/42'));
  for (const route of ['chat', 'notes', 'settings', 'home']) {
    await ui.evaluate('window.HomeDashboard.setRoute(' + JSON.stringify(route) + (route === 'home' ? ',"overview"' : '') + ')');
    await ui.waitFor(ui.shown('[data-product-page="' + route + '"].active'));
  }
});

test('message actions use confirmed receipts and retain unknown or failed results', { skip: !chrome }, async t => {
  const { app, ui } = await enterMail(t);
  const select = '[data-message-id="11"] .m1-row-select';
  const operations = () => app.calls.filter(call => call.endpoint.endsWith('/messages/actions')).map(call => call.payload);
  await ui.click(select);
  await ui.press('읽음');
  await ui.waitFor('!document.querySelector(\'[data-message-id="11"]\').classList.contains("m1-unread")');
  assert.deepEqual(operations()[0].operations, [{ messageId: 11, action: 'set_read', value: true }]);
  assert.match(operations()[0].requestId, /^[a-z0-9-]{16,}$/);
  await ui.click(select);
  await ui.press('안 읽음');
  await ui.waitFor(ui.text('읽음 변경에 실패했어.'));
  assert.equal(await ui.evaluate('document.querySelector(\'[data-message-id="11"]\').classList.contains("m1-unread")'), false);
  await ui.click('[data-message-id="11"] .m1-row-star');
  await ui.waitFor('document.querySelector(\'[data-message-id="11"] .m1-row-star\').getAttribute("aria-pressed") === "true"');
  assert.equal(app.messages[0].important, true);
  await ui.click(select);
  await ui.click('[data-message-id="12"] .m1-row-select');
  await ui.press('읽음');
  await ui.waitFor('!document.querySelector(\'[data-message-id="12"]\').classList.contains("m1-unread")');
  assert.deepEqual(operations().at(-1).operations, [11, 12].map(messageId => ({ messageId, action: 'set_read', value: true })));
  await ui.click(select);
  await ui.press('이동');
  await ui.waitFor(ui.shown('.m1-dialog[open]'));
  await ui.press('연구실', '.m1-dialog button');
  await ui.waitFor("!document.querySelector('.m1-dialog[open]')");
  assert.deepEqual(operations().at(-1).operations, [
    { messageId: 11, action: 'move', targetMailbox: { accountId: 1, id: 'label:Label_1' }, sourceMailbox: 'label:INBOX' },
  ]);
  await ui.press('연구실', '#mail-workspace-folders button');
  await ui.waitFor(ui.shown('[data-message-id="11"]'));
  await ui.click(select);
  await ui.press('휴지통', '.m1-toolbar button');
  await ui.waitFor(ui.text('결과를 확인할 수 없는 메일 1개'));
  assert.equal(await ui.evaluate(ui.shown('[data-message-id="11"]')), true);
  const before = operations().length;
  await ui.click('[data-message-id="11"] .m1-row-star');
  assert.equal(operations().length, before);
  app.confirmTrash();
  await ui.press('새로고침');
  await ui.waitFor('document.querySelector(\'[data-message-id="11"] .m1-row-select\')?.disabled === false');
  await ui.click(select);
  await ui.press('휴지통', '.m1-toolbar button');
  await ui.waitFor(ui.text('메일함이 비어 있어.'));
});

test('tablet drawer and phone list use explicit analysis and display dated and unresolved candidates', { skip: !chrome }, async t => {
  const { app, ui } = await enterMail(t);
  await ui.metrics(820, 1180);
  await ui.waitFor(ui.shown('.m1-menu'));
  await ui.press('메일함 메뉴');
  await ui.waitFor(ui.shown('.m1-drawer-open .m1-sidebar'));
  assert.equal(await ui.evaluate('document.querySelector(".m1-main").inert'), true);
  await ui.capture('tablet-menu.png');
  await ui.press('중요', '#mail-workspace-folders button');
  await ui.waitFor(ui.text('탐색하고 분석한 메일 범위만 표시해.'));
  assert.equal(app.calls.some(call => call.endpoint.endsWith('/smart/analyze')), false);
  await ui.press('메일 3개 분석');
  await ui.waitFor(ui.text('분석 대기'));
  await ui.waitFor(ui.text('분석 실패'));
  await ui.waitFor(ui.text('분석 제외'));
  await ui.waitFor(ui.text('기존 Agent 판단'));
  assert.ok(app.analyses() > 0);
  assert.deepEqual(app.calls.find(call => call.endpoint.endsWith('/smart/analyze')).payload, { messageIds: [11, 12, 13], kind: 'both' });
  await ui.click('[data-message-id="11"] .m1-row-star');
  await ui.waitFor('document.querySelector(\'[data-message-id="11"] .m1-row-star\')?.getAttribute("aria-pressed") === "true"');
  await ui.metrics(390, 844);
  await ui.press('메일함 메뉴');
  await ui.press('받은편지함', '#mail-workspace-folders button');
  await ui.waitFor('document.querySelector("#mail-workspace h1").textContent === "받은편지함"');
  await ui.capture('phone-inbox.png');
  await ui.press('메일함 메뉴');
  await ui.capture('phone-mailboxes.png');
  await ui.press('일정', '#mail-workspace-folders button');
  await ui.waitFor(ui.shown('.m1-calendar-grid .m1-calendar-event'));
  await ui.waitFor(ui.text('날짜 미확정'));
  assert.equal(await ui.evaluate('document.querySelectorAll(".m1-calendar-grid .m1-calendar-event").length'), 2);
  assert.equal(await ui.evaluate('document.querySelector(".m1-calendar-grid").innerText.includes("날짜 미정 면담")'), false);
  await ui.capture('phone-calendar.png');
  assert.equal(await ui.evaluate('document.querySelector("#mail-workspace").scrollWidth <= 390'), true);
  await ui.click('.m1-calendar-grid .m1-event-personal');
  await ui.waitFor(ui.text('메일 수신일 기준 추론'));
  await ui.press('원본 메일 열기');
  await ui.waitFor(ui.shown('.m1-message-body'));
  await ui.capture('phone-detail.png');
  assert.equal(app.calls.some(call => /\/api\/tasks|\/api\/mail\/.*attention/.test(call.endpoint) && call.method === 'POST'), false);
});

test('flags separately gate the entry point, write controls and smart filters', { skip: !chrome }, async t => {
  const app = await mockApp(t);
  const ui = await browser(t);
  app.switches.enabled = false;
  await ui.call('Page.navigate', { url: app.url });
  await ui.waitFor(ui.shown('.home-card-mail'));
  assert.equal(await ui.evaluate(ui.shown('.home-mail-workspace-link')), false);
  assert.equal(app.calls.some(call => call.endpoint.startsWith('/api/mail-client')), false);
  Object.assign(app.switches, { enabled: true, writeEnabled: false, smartEnabled: false });
  await ui.call('Page.reload', { ignoreCache: true });
  await ui.waitFor(ui.shown('.home-mail-workspace-link'));
  await ui.click('.home-mail-workspace-link');
  await ui.waitFor(ui.shown('.m1-mail-row'));
  assert.equal(await ui.evaluate('document.querySelectorAll(".m1-row-select").length'), 0);
  assert.equal(await ui.evaluate(ui.text('스마트 메일함')), false);
  await ui.click('[data-message-id="11"] .m1-row-open');
  await ui.waitFor(ui.shown('.m1-message-body'));
  assert.equal(app.calls.some(call => call.method === 'POST' && call.endpoint.startsWith('/api/mail-client')), false);
});
