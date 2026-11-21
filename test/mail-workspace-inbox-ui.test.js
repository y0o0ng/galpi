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
const INLINE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l8sAAAAASUVORK5CYII=', 'base64');
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
    { id: 1, accountId: 1, provider: 'gmail', labelIds: ['INBOX'], subject: '논문 피드백 전달', from: [{ name: '최유진 교수', address: 'sender@example.com' }],
      receivedAt: now, read: false, important: true, starred: true, hasAttachments: true },
    { id: 2, accountId: 3, provider: 'works', folderPath: 'INBOX', subject: '재료공학 과제 안내', from: [{ name: '김민수 교수' }],
      receivedAt: now - 1, read: false, starred: false, hasAttachments: true },
    { id: 3, accountId: 2, provider: 'naver', subject: '신소재 실험 결과 공유', from: [{ name: '이서연 연구원' }],
      receivedAt: now - 2, read: true, starred: false },
  ];
  const calls = [];
  const state = { enabled: true, outcome: 'confirmed', incomplete: false, authExpired: false, inboxError: false,
    holdInbox: null, holdDetail: null, missingDetail: false, contactsUnavailable: false, submission: 'saved', send: 'sent' };
  const manualUnread = new Set();
  const contacts = [{ id: 1, name: '최유진 교수', email: 'sender@example.com', organization: '연구실', source: 'csv' }];
  let draft = { id: 'draft-1', version: 'a'.repeat(64), subject: 'Re: 논문 피드백 전달', text: '', to: ['sender@example.com'],
    cc: [], bcc: [], attachments: [] };
  let mailSettings = { notificationsEnabled: true, quietHours: { enabled: true, start: '23:00', end: '07:00' } };
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
    if (endpoint === '/mail-message-frame') {
      const remote = url.searchParams.get('images') === '1' ? ' https: http:' : '';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; img-src blob:${remote}; frame-ancestors 'self'`,
        'Referrer-Policy': 'no-referrer' });
      res.end('<!doctype html><meta charset="utf-8"><style>body{margin:0;display:flow-root}img,table{max-width:100%}</style><body></body>');
      return;
    }
    if (!endpoint.startsWith('/api/')) {
      const file = path.join(ROOT, endpoint === '/' ? 'index.html' : endpoint);
      try {
        const data = await fs.readFile(file);
        if (state.htmlDetail && endpoint === '/') res.setHeader('Content-Security-Policy',
          "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-ancestors 'none'");
        res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      } catch { res.writeHead(404).end(); }
      return;
    }
    let payload;
    if (['POST', 'PUT'].includes(req.method)) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks);
      payload = req.headers['content-type'] === 'application/octet-stream' ? { bytes: raw.length } : raw.length ? JSON.parse(raw.toString()) : {};

    }
    calls.push({ method: req.method, endpoint, query: Object.fromEntries(url.searchParams), payload });
    if (endpoint === '/api/config') return json({ requiresApiToken: false, gptChatBootstrapModel: 'mock' });
    if (endpoint === '/api/models/chat') return json({ selection: 'auto', options: [], resolvedModelId: null });
    if (endpoint === '/api/mail/status') return json({ accounts, analysis: { pending: 1, analyzing: 0, done: 2, failed: 1 } });
    if (endpoint === '/api/mail/settings') {
      if (req.method === 'PUT') mailSettings = { ...mailSettings, ...payload };
      return json({ success: true, settings: mailSettings });
    }
    if (endpoint === '/api/mail/preferences') return json({ success: true, preferences: [{
      id: 1, preferenceType: 'sender', target: 'old@example.com', action: 'suppress_notification',
    }] });
    if (!endpoint.startsWith('/api/mail-client/')) return json({ messages: [], notes: [], models: [], notifications: [], ddays: [], chat: [] });
    if (endpoint.endsWith('/accounts')) return state.enabled ? json({ success: true, accounts })
      : json({ success: false, code: 'MAIL_CLIENT_DISABLED' }, 503);
    if (endpoint.endsWith('/mailboxes')) {
      const id = Number(endpoint.split('/').at(-2));
      const mailboxes = [{ id: 'inbox', inbox: true, selectable: true, name: '받은편지함' }];
      if (id > 1) mailboxes.push({ id: 'folder:Project', kind: 'folder', name: '프로젝트', path: 'Project', selectable: true });
      if (id === 1) {
        mailboxes.push(...['연구실', '지원서'].map(name => ({ id: name, name, kind: 'label', type: 'user', providerId: name, selectable: true })));
        mailboxes.push(
          { id: 'drafts', name: '임시보관함', kind: 'label', type: 'system', providerId: 'DRAFT', selectable: true },
          { id: 'trash', name: '휴지통', kind: 'label', type: 'system', providerId: 'TRASH', selectable: true },
        );
      }
      return json({ success: true, mailboxes });
    }
    if (endpoint.endsWith('/inbox')) {
      if (state.holdInbox) await state.holdInbox;
      if (state.inboxError) return json({ success: false, code: 'MAIL_CLIENT_PROVIDER_UNAVAILABLE' }, 503);
      if (url.searchParams.has('cursor')) return json({ success: true, messages: [
        { ...messages[0], id: 40, subject: '이전 메일' },
      ], nextCursor: null });
      return json({ success: true, messages: messages.filter(message => !message.removed),
        incomplete: state.incomplete || state.authExpired, sources: accounts.map(account => ({
          ...account, status: (state.incomplete || state.authExpired) && account.id === 3 ? 'unavailable' : 'fresh',
          failure: state.authExpired && account.id === 3 ? { code: 'MAIL_CLIENT_AUTH_REQUIRED' } : undefined,
        })), nextCursor: '00000000-0000-4000-8000-000000000001' });
    }
    if (endpoint.endsWith('/search')) {
      const query = url.searchParams.get('q')?.toLowerCase();
      const contactEmail = url.searchParams.get('contactEmail')?.toLowerCase();
      const found = messages.filter(message => (!query || message.subject.toLowerCase().includes(query) || query === 'sender@example.com')
        && (!contactEmail || [...message.from, ...(message.to || [])].some(entry => entry.address?.toLowerCase() === contactEmail))
        && (url.searchParams.get('read') !== 'unread' || !message.read));
      return json({ success: true, messages: found, total: found.length, nextCursor: null });
    }
    if (endpoint.endsWith('/smart/messages')) {
      if (state.holdSmart) await state.holdSmart;
      if (state.smartError) return json({ success: false, code: 'MAIL_CLIENT_PROVIDER_UNAVAILABLE' }, 503);
      const nextPage = url.searchParams.has('cursor');
      return json({ success: true, messages: (nextPage ? state.smartSecondPage : state.smartMessages) ?? [messages[0]],
        nextCursor: nextPage ? null : state.smartNextCursor ?? null });
    }
    if (endpoint.endsWith('/smart/analysis-targets')) {
      const ids = state.analysisTargets || [];
      return json({ success: true, total: new Set(ids).size, ...(url.searchParams.has('snapshot') ? { messageIds: ids } : {}) });
    }
    if (endpoint.endsWith('/smart/analyze')) return json({ success: true, results: payload.messageIds.map(id => ({
      id, jobs: [{ kind: 'classification', state: 'pending' }, { kind: 'calendar', state: 'pending' }],
    })) }, 202);
    if (endpoint.endsWith('/smart/results')) return json({ success: true, results: url.searchParams.get('messageIds').split(',').map(Number).map(id => ({
      id, classificationStatus: { state: state.analysisStates?.[id] || 'pending' },
      calendarStatus: { state: state.analysisStates?.[id] || 'pending' },
    })) });
    if (endpoint.endsWith('/smart/calendar') && url.searchParams.get('section') === 'unresolved') {
      const cursor = url.searchParams.get('cursor');
      const events = state.undated || [];
      return json({ success: true, events: cursor ? events.slice(13) : events.slice(0, 13), total: events.length,
        nextCursor: !cursor && events.length > 13 ? 'undated-next' : null });
    }
    if (endpoint.endsWith('/smart/calendar')) return json({ success: true, events: [{
      id: 7, messageId: 1, accountId: 1, kind: 'personal', title: '연구실 면담',
      startDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
    }], nextCursor: null });
    if (endpoint.endsWith('/smart/calendar/7')) return json({ success: true, event: { id: 7, messageId: 1 } });
    if (state.undated && /\/smart\/calendar\/\d+$/u.test(endpoint)) {
      return json({ success: true, event: { id: Number(endpoint.split('/').at(-1)), messageId: 1 } });
    }
    if (endpoint.endsWith('/contacts')) {
      if (state.contactsUnavailable) return json({ success: false, code: 'MOCK_NOT_FOUND' }, 404);
      const from = url.searchParams.get('source');
      const q = url.searchParams.get('q');
      const entries = contacts.filter(item => (!from || from === item.source) && (!q || item.name.includes(q) || item.email.includes(q)));
      const offset = Number(url.searchParams.get('offset') || 0);
      const end = offset + Number(url.searchParams.get('limit') || 100);
      return json({ success: true, contacts: entries.slice(offset, end), total: entries.length,
        ...(end < entries.length ? { nextOffset: end } : {}) });
    }
    if (endpoint.endsWith('/contacts/import')) {
      const found = payload.entries.filter(item => !contacts.some(contact => contact.email === item.email));
      if (!payload.preview) contacts.push(...found.map((entry, index) => ({ id: contacts.length + index + 1, source: 'csv', ...entry })));
      return json({ success: true, created: found.length, skipped: payload.entries.length - found.length });
    }
    if (/\/mail-client\/messages\/\d+$/.test(endpoint)) {
      if (state.holdDetail) await state.holdDetail;
      if (state.missingDetail) return json({ success: false, code: 'MAIL_CLIENT_MESSAGE_GONE' }, 404);
      const source = messages.find(item => item.id === Number(endpoint.split('/').at(-1)));
      if (!source) return json({ success: false, code: 'MAIL_CLIENT_MESSAGE_GONE' }, 404);
      return json({ success: true, message: { ...source, accountId: source.accountId || 1,
        from: [{ name: '최유진 교수', address: 'sender@example.com' }], to: [{ address: 'sample@gmail.com' }],
        body: { format: 'text', text: '<img src="https://example.invalid/track">안녕하세요.\n\n> 앞선 답장입니다.', blockedRemoteImages: 1 },
        thread: { messages: source.id === 1 ? [{ id: 2, from: [{ name: '최유진 교수' }], subject: '앞선 답장', receivedAt: now - 800 }] : [] },
        attachments: [{ filename: '실험.pdf', size: 208, downloadable: true }],
        ...(source.id === 1 ? state.htmlDetail : null),
      } });
    }
    if (endpoint.endsWith('/messages/1/inline-images/0')) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(INLINE_PNG);
      return;
    }
    if (/\/mail-client\/messages\/\d+\/attachments\/\d+$/.test(endpoint)) return json({ success: false, code: 'MAIL_CLIENT_ATTACHMENT_NOT_FOUND' }, 404);
    if (endpoint.endsWith('/messages/1/draft')) return json({ success: true, draft });
    if (endpoint.endsWith('/drafts/draft-1') && req.method === 'GET') return json({ success: true, draft });
    if (endpoint.endsWith('/drafts') || endpoint.endsWith('/drafts/draft-1')) {
      if (state.submission === 'saved') {
        draft = { ...draft, text: payload.compose.text, subject: payload.compose.subject || draft.subject };
        return json({ success: true, state: 'saved', draftId: draft.id });
      }
      return json({ success: false, state: state.submission }, state.submission === 'conflict' ? 409 : 502);
    }
    if (endpoint.endsWith('/send')) return json({ success: state.send === 'sent', state: state.send, delivery: 'full',
      requestId: payload.requestId }, state.send === 'sent' ? 200 : 202);
    if (endpoint.endsWith('/uploads')) return json({ success: true, attachment: { id: 'upload' } });
    if (endpoint.endsWith('/messages')) {
      const id = Number(endpoint.split('/').at(-2));
      const mailbox = url.searchParams.get('mailbox');
      const folder = messages.filter(message => message.accountId === id && !message.removed);
      const draft = { ...folder[0], read: true, to: [{ name: '최유진 교수' }] };
      return json({ success: true, messages: mailbox === 'trash' ? []
        : mailbox === 'drafts' ? [draft] : folder, nextCursor: null });
    }
    if (endpoint.endsWith('/messages/actions')) {
      if (state.outcome === 'disabled') return json({ success: false, code: 'MAIL_CLIENT_WRITE_DISABLED' }, 503);
      return json({ success: state.outcome === 'confirmed', results: payload.operations.map(operation => {
        const message = messages.find(item => item.id === operation.messageId);
        if (state.outcome === 'confirmed') {
          if (operation.action === 'set_read') {
            if (operation.origin === 'auto' && manualUnread.has(message.id)) {
              return { messageId: message.id, state: 'confirmed', code: 'MAIL_CLIENT_MANUAL_UNREAD_PRESERVED' };
            }
            if (!operation.value) manualUnread.add(message.id);
            else if (operation.origin !== 'auto') manualUnread.delete(message.id);
            message.read = operation.value;
          }
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
  return { url: 'http://127.0.0.1:' + server.address().port, calls, contacts, messages, state, routes };
}

const mailAgent = '#home-agents [aria-label="Mail 에이전트 열기"]';

async function enterFromAgents(ui) {
  await ui.click('[data-home-view="agents"]');
  await ui.waitFor(ui.shown(mailAgent));
  await ui.click(mailAgent);
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
  await ui.click('.home-card-mail');
  await ui.waitFor(ui.shown('.home-card-mail.focused'));
  assert.equal(app.calls.some(call => call.endpoint.startsWith('/api/mail-client')), false);
  await enterFromAgents(ui);
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
  await ui.waitFor('!document.querySelector(\'[data-message-id="1"] .mw-row-star\').disabled');
  await ui.click('[data-message-id="1"] .mw-row-star');
  await ui.waitFor('document.querySelector("[data-message-id=\\"1\\"] .mw-row-star")?.getAttribute("aria-pressed") === "false"');
  assert.deepEqual(actions()[1].payload.operations, [{ messageId: 1, action: 'set_starred', value: false }]);
  assert.equal(app.messages[0].important, fixtureImportance);
  await ui.waitFor('!document.querySelector(".mw-square[aria-label=새로고침]").disabled');
  await ui.click('[data-message-id="1"] .mw-row-select');
  app.state.outcome = 'unknown';
  await ui.press('휴지통', '.mw-toolbar button');
  await ui.waitFor('document.querySelector("[data-message-id=\\"1\\"] .mw-row-star")?.disabled');
  assert.ok(await ui.evaluate(ui.shown('[data-message-id="1"]')));
  assert.equal(actions().length, 3);
  await ui.waitFor('document.body.innerText.includes("결과를 확인할 수 없는 메일")');
  assert.equal(await ui.evaluate(ui.shown('.mw-operation-notice')), false);
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
  assert.equal(app.calls.some(call => /\/smart\/analyze$|\/send$/.test(call.endpoint)), false);
  await ui.click('#global-nav [data-product-route="home"]');
  await ui.waitFor(ui.shown('#home-page.active ' + mailAgent));
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

test('disabled Mail Workspace preserves Agent details and the existing write gate', { skip: !chrome }, async t => {
  const app = await mockApp(t);
  app.state.enabled = false;
  const ui = await browser(t);
  await ui.call('Page.navigate', { url: app.url });
  await ui.waitFor(ui.shown('.home-card-mail'));
  await enterFromAgents(ui);
  await ui.waitFor(ui.shown('#home-agents .agent-detail-head h2'));
  assert.equal(await ui.evaluate(ui.shown('#mail-workspace.active')), false);
  app.state.enabled = true;
  app.state.outcome = 'disabled';
  await ui.call('Page.reload', { ignoreCache: true });
  await ui.waitFor(ui.shown('.home-card-mail'));
  await enterFromAgents(ui);
  await ui.waitFor(ui.shown('.mw-row'));
  await ui.click('[data-message-id="1"] .mw-row-star');
  await ui.waitFor('document.body.innerText.includes("메일 상태를 변경할 수 없어")');
  assert.equal(await ui.evaluate('document.querySelector("[data-message-id=\\"1\\"] .mw-row-star").disabled'), true);
  assert.equal(app.calls.filter(call => call.method === 'POST').length, 1);
});

test('tablet and phone show only the controls and mailbox layouts from their Figma frames', { skip: !chrome }, async t => {
  const app = await mockApp(t);
  const ui = await browser(t);
  await ui.metrics(820, 1180);
  await ui.call('Page.navigate', { url: app.url });
  await ui.waitFor(ui.shown('.home-card-mail'));
  await enterFromAgents(ui);
  await ui.waitFor(ui.shown('.mw-row'));
  assert.equal(await ui.evaluate(ui.shown('.mw-sidebar')), false);
  assert.equal(await ui.evaluate(ui.shown('.mw-toolbar')), true);
  assert.deepEqual(JSON.parse(await ui.evaluate(measures(['.mw-header', '.mw-toolbar', '.mw-row']))),
    [[24, 84, 772, 40], [24, 140, 772, 32], [24, 188, 772, 44]]);
  await ui.capture('tablet-entry.png');
  await ui.press('메일함 메뉴 열기');
  await ui.waitFor(ui.shown('.mw-sidebar'));
  assert.equal(await ui.evaluate(ui.shown('.mw-close')), false);
  assert.deepEqual(JSON.parse(await ui.evaluate(measures(['.mw-sidebar']))), [[0, 0, 280, 1180]]);
  await ui.capture('tablet-mailboxes.png');
  await ui.evaluate('document.querySelector("#mail-workspace").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
  await ui.waitFor('!' + ui.shown('.mw-sidebar'));

  await ui.metrics(390, 844);
  await ui.waitFor(ui.shown('.mw-compose-fab'));
  assert.equal(await ui.evaluate(ui.shown('.mw-toolbar')), false);
  assert.equal(await ui.evaluate(ui.shown('.mw-pagination')), false);
  assert.equal(await ui.evaluate(ui.shown('.mw-row-select')), false);
  assert.equal(await ui.evaluate(ui.shown('.mw-compact-search')), true);
  assert.equal(await ui.evaluate('document.querySelector("#mail-workspace").scrollWidth'), 390);
  assert.deepEqual(JSON.parse(await ui.evaluate(measures(['.mw-header', '.mw-row', '.mw-compose-fab'])))
    .map(([x, y, w, h]) => [x, y, Math.floor(w), h]),
  [[0, 56, 390, 104], [0, 161, 390, 72], [262, 693, 108, 48]]);
  await ui.capture('phone-entry.png');
  await ui.press('메일함 메뉴 열기');
  await ui.waitFor(ui.shown('.mw-close'));
  assert.equal(await ui.evaluate(ui.shown('.mw-main')), false);
  assert.equal(await ui.evaluate('getComputedStyle(document.querySelector("[data-mailbox-role=inbox]")).order'), '-1');
  await ui.capture('phone-mailboxes.png');
  await ui.press('메일함 메뉴 닫기');
  await ui.waitFor(ui.shown('.mw-row'));
  assert.equal(app.calls.some(call => call.method === 'POST' && call.endpoint.startsWith('/api/mail-client')), false);
});

test('list variants keep the designed actions and surface only verified failures', { skip: !chrome }, async t => {
  const app = await mockApp(t);
  let release;
  app.state.holdInbox = new Promise(resolve => { release = resolve; });
  t.after(release);
  const ui = await browser(t);
  await ui.metrics(1440, 900);
  await ui.call('Page.navigate', { url: app.url });
  await ui.waitFor(ui.shown('.home-card-mail'));
  await enterFromAgents(ui);
  await ui.waitFor(ui.shown('.mw-skeleton'));
  assert.equal(await ui.evaluate('document.querySelectorAll(".mw-skeleton").length'), 10);
  assert.equal(await ui.evaluate(ui.shown('.mw-pagination')), false);
  await ui.capture('desktop-list-loading.png');
  release();
  await ui.waitFor(ui.shown('.mw-row'));

  await ui.press('연구실', '.mw-sidebar button');
  await ui.waitFor(ui.text('Gmail · 안 읽음'));
  assert.equal(await ui.evaluate(ui.shown('.mw-chips')), false);
  await ui.capture('desktop-account-folder.png');
  await ui.press('임시보관함', '.mw-sidebar button');
  await ui.waitFor(ui.text('초안 1개'));
  assert.equal(await ui.evaluate('document.querySelector(".mw-actions").textContent'), '휴지통');
  assert.equal(await ui.evaluate('document.querySelector(".mw-chips button").disabled'), true);
  assert.equal(await ui.evaluate(ui.text('받는 사람 · 최유진 교수')), true);
  await ui.capture('desktop-drafts.png');

  await ui.press('휴지통', '.mw-sidebar button');
  await ui.waitFor(ui.text('휴지통이 비어 있어'));
  assert.equal(await ui.evaluate(ui.shown('.mw-pagination')), false);
  await ui.capture('desktop-trash-empty.png');
  await ui.click('[data-mailbox-role="inbox"]');
  await ui.waitFor(ui.shown('.mw-row'));

  app.state.authExpired = true;
  await ui.press('새로고침');
  await ui.waitFor(ui.text('Works 로그인이 만료됐어.'));
  assert.equal(await ui.evaluate('document.querySelector(".mw-reconnect").disabled'), true);
  await ui.capture('desktop-account-expired.png');
  app.state.authExpired = false;
  app.state.incomplete = true;
  await ui.press('새로고침');
  await ui.waitFor(ui.text('일부 메일이 최신 상태가 아닐 수 있어.'));
  await ui.capture('desktop-sync-error.png');
  app.state.incomplete = false;
  await ui.press('지금 다시 시도');
  await ui.waitFor('!' + ui.shown('.mw-list-notice'));

  app.state.outcome = 'failed';
  await ui.click('[data-message-id="1"] .mw-row-select');
  await ui.press('읽음');
  await ui.waitFor(ui.shown('.mw-operation-notice'));
  assert.equal(await ui.evaluate('document.querySelector(".mw-row[data-checked=Yes]").dataset.state'), 'Unread');
  await ui.capture('desktop-read-error.png');
  const writes = () => app.calls.filter(call => call.endpoint.endsWith('/messages/actions'));
  assert.equal(writes().length, 1);
  app.state.outcome = 'confirmed';
  await ui.press('다시 시도');
  await ui.waitFor('!document.querySelector(".mw-row[data-message-id=\\"1\\"][data-state=Unread]")');
  assert.deepEqual(writes().map(call => call.payload.operations), Array.from({ length: 2 },
    () => [{ messageId: 1, action: 'set_read', value: true }]));
});

test('folder moves require a verified source, same provider target, and explicit confirmation', { skip: !chrome }, async t => {
  const app = await mockApp(t);
  const ui = await browser(t);
  await ui.metrics(1440, 900);
  await ui.call('Page.navigate', { url: app.url });
  await ui.waitFor(ui.shown('.home-card-mail'));
  await enterFromAgents(ui);
  await ui.waitFor(ui.shown('.mw-row'));
  const writes = () => app.calls.filter(call => call.endpoint.endsWith('/messages/actions'));
  await ui.click('[data-message-id="1"] .mw-row-select');
  await ui.click('[data-message-id="2"] .mw-row-select');
  await ui.press('이동', '.mw-toolbar button');
  await ui.waitFor(ui.text('같은 제공처의 메일만 한 번에'));
  assert.equal(await ui.evaluate('document.querySelector(".mw-popover-primary").disabled'), true);
  await ui.press('취소', 'dialog button');
  await ui.click('[data-message-id="2"] .mw-row-select');
  await ui.press('이동', '.mw-toolbar button');
  await ui.waitFor(ui.shown('dialog[open]'));
  await ui.click('dialog [data-account-id="3"]');
  assert.equal(await ui.evaluate('document.querySelector("dialog [data-account-id=\\"3\\"] + button").disabled'), true);
  await ui.press('연구실', 'dialog button');
  assert.equal(writes().length, 0);
  await ui.press('이동', 'dialog button');
  await ui.waitFor('!document.querySelector(".mw-square[aria-label=새로고침]").disabled');
  assert.deepEqual(writes()[0].payload.operations, [
    { messageId: 1, action: 'move', sourceMailbox: 'label:INBOX', targetMailbox: { accountId: 1, id: '연구실' } },
  ]);
  await ui.click('[data-message-id="2"] .mw-row-select');
  await ui.press('이동', '.mw-toolbar button');
  await ui.press('프로젝트', 'dialog button');
  await ui.press('이동', 'dialog button');
  await ui.waitFor('!document.querySelector(".mw-square[aria-label=새로고침]").disabled');
  assert.deepEqual(writes()[1].payload.operations, [
    { messageId: 2, action: 'move', targetMailbox: { accountId: 3, id: 'folder:Project' } },
  ]);
});

test('opening a message marks it read after rendering and respects manual unread protection', { skip: !chrome }, async t => {
  const app = await mockApp(t);
  const ui = await browser(t);
  await ui.metrics(1440, 900);
  await ui.call('Page.navigate', { url: app.url });
  await ui.waitFor(ui.shown('.home-card-mail'));
  await enterFromAgents(ui);
  await ui.waitFor(ui.shown('.mw-row'));
  const open = () => ui.click('[data-message-id="1"] .mw-subject');
  const back = () => ui.press('목록', '.mw-detail-toolbar button');
  const actions = () => app.calls.filter(call => call.endpoint.endsWith('/messages/actions'));
  const inboxGets = () => app.calls.filter(call => call.endpoint.endsWith('/inbox')).length;
  const rowState = state => `document.querySelector('[data-message-id="1"]')?.dataset.state === '${state}' &&
    document.querySelector('.mw-rows').getAttribute('aria-busy') === 'false'`;
  await ui.evaluate(`(() => {
    window.autoReadBodies = [];
    const originalFetch = window.fetch;
    window.fetch = (url, options) => {
      if (String(url).endsWith('/messages/actions') && JSON.parse(options.body).operations[0].origin === 'auto') {
        window.autoReadBodies.push(document.querySelector('.mw-detail-body')?.textContent || '');
      }
      return originalFetch(url, options);
    };
  })()`);

  app.state.missingDetail = true;
  await open();
  await ui.waitFor(ui.text('이 메일을 찾을 수 없어'));
  assert.equal(actions().length, 0);
  await back();

  app.state.missingDetail = false;
  await open();
  await ui.waitFor(rowState('Read'));
  assert.match((await ui.evaluate('window.autoReadBodies'))[0], /안녕하세요/);
  assert.deepEqual(actions()[0].payload.operations, [{ messageId: 1, action: 'set_read', value: true, origin: 'auto' }]);
  await ui.press('안 읽음', '.mw-detail-toolbar button');
  await ui.waitFor(rowState('Unread'));
  assert.deepEqual(actions()[1].payload.operations, [{ messageId: 1, action: 'set_read', value: false }]);
  await back();

  const before = inboxGets();
  await open();
  await ui.waitFor('window.autoReadBodies.length === 2 && !document.querySelector(`[data-message-id="1"] .mw-row-star`).disabled');
  assert.equal(actions().length, 3);
  assert.equal(inboxGets(), before);
  assert.equal(app.messages[0].read, false);
  await back();
  assert.ok(await ui.evaluate(rowState('Unread')));

  app.state.outcome = 'unknown';
  await ui.click('[data-message-id="2"] .mw-subject');
  await ui.waitFor('window.autoReadBodies.length === 3 && ' +
    'document.querySelector(`[data-message-id="2"]`).title.includes("변경 결과") && ' +
    '!document.querySelector(`[data-message-id="1"] .mw-row-star`).disabled');
  assert.equal(inboxGets(), before);
  assert.equal(app.messages[1].read, false);
  await back();
  assert.equal(await ui.evaluate('document.querySelector(`[data-message-id="2"]`).dataset.state'), 'Unread');
});

test('detail and reply preserve text boundaries, expose draft conflicts and issue one explicit send', { skip: !chrome }, async t => {
  const app = await mockApp(t);
  const ui = await browser(t);
  await ui.metrics(1440, 1000);
  await ui.call('Page.navigate', { url: app.url });
  await ui.waitFor(ui.shown('.home-card-mail'));
  await enterFromAgents(ui);
  await ui.waitFor(ui.shown('.mw-row'));
  await ui.click('[data-message-id="1"] .mw-subject');
  await ui.waitFor(ui.shown('.mw-detail-body'));
  assert.equal(await ui.evaluate('document.querySelector(".mw-detail-body img") === null'), true);
  assert.ok(await ui.evaluate(ui.text('외부 이미지 1개')));
  await ui.capture('mail-detail.png');
  await ui.press('실험.pdf 다운로드');
  await ui.waitFor(ui.text('첨부파일을 다운로드하지 못했어.'));
  await ui.capture('mail-attachment-failed.png');
  await ui.press('답장', '.mw-detail-toolbar button');
  await ui.waitFor(ui.shown('.mw-compose-body'));
  app.state.submission = 'failed';
  await ui.evaluate('document.querySelector(".mw-compose-body").textContent = "답장 본문"; document.querySelector(".mw-compose-body").dispatchEvent(new Event("input", { bubbles: true }))');
  await ui.press('임시 저장');
  await ui.waitFor(ui.text('초안을 저장하지 못했어.'));
  await ui.capture('mail-draft-failed.png');
  app.state.submission = 'saved';
  await ui.press('임시 저장');
  await ui.waitFor(ui.text('임시보관함에 저장됨'));
  await ui.capture('mail-compose.png');
  app.state.submission = 'conflict';
  await ui.evaluate('document.querySelector(".mw-compose-body").textContent = "수정한 본문"; document.querySelector(".mw-compose-body").dispatchEvent(new Event("input", { bubbles: true }))');
  await ui.press('임시 저장');
  await ui.waitFor(ui.text('다른 기기에서 수정됨'));
  await ui.capture('mail-draft-conflict.png');
  await ui.press('최신 버전 불러오기');
  await ui.waitFor(ui.text('답장 본문'));
  await ui.press('보내기', '.mw-compose-bottom button');
  await ui.waitFor(ui.text('메일을 보냈어'));
  assert.equal(app.calls.filter(call => call.endpoint.endsWith('/send')).length, 1);
  await ui.capture('mail-reply-sent.png');
  await ui.press('답장', '.mw-detail-toolbar button');
  app.state.send = 'unknown';
  await ui.press('보내기', '.mw-compose-bottom button');
  await ui.waitFor(ui.text('발송 결과를 확인하지 못했어.'));
  assert.equal(app.calls.filter(call => call.endpoint.endsWith('/send')).length, 2);
  await ui.capture('mail-send-unknown.png');
});

test('HTML mail shows styled tables and CID images, and loads only approved remote images inside the reader', { skip: !chrome }, async t => {
  const remoteRequests = [];
  const remote = http.createServer((req, res) => {
    remoteRequests.push({ path: req.url, referrer: req.headers.referer });
    res.writeHead(200, { 'Content-Type': req.url === '/clicked' ? 'text/html' : 'image/png' });
    res.end(req.url === '/clicked' ? '<title>외부 링크</title>' : INLINE_PNG);
  });
  remote.listen(0, '127.0.0.1');
  await once(remote, 'listening');
  t.after(() => { remote.closeAllConnections(); remote.close(); });
  const external = 'http://127.0.0.1:' + remote.address().port;
  const app = await mockApp(t);
  app.messages[0].read = true;
  app.state.htmlDetail = {
    body: { format: 'text', text: '평문 인용', html: `<!doctype html><html><head><style>
      @import url('${external}/style'); @font-face {font-family: remote; src: url('${external}/font')}
      .content {color:#34754e;background:#eceff1 url('${external}/css-image');font-family:Arial,sans-serif}
      @media (max-width:500px){.content{font-size:18px}}
      </style></head><body><script>window.mailExecuted = true;</script><link rel="stylesheet" href="${external}/link">
      <iframe src="${external}/frame"></iframe><table width="600"><tr><td class="content" id="mail-cell">HTML 원본 테이블
      <img id="cid-image" src="cid:logo%40example.com" alt="내장 로고" width="20">
      <img id="remote-image" src="${external}/pixel" srcset="${external}/srcset 1x" onload="window.mailExecuted = true" width="25">
      <p style="background-image:image-set('${external}/inline-css' 1x); color:blue">본문 문단</p>
      <a id="safe-link" href="${external}/clicked" target="_top">안전한 링크</a>
      <a id="bad-link" href="javascript:window.mailExecuted=true">위험한 링크</a></td></tr></table></body></html>` },
    attachments: [{ filename: 'logo.png', contentId: '<logo@example.com>', contentType: 'image/png', inline: true, size: INLINE_PNG.length }],
  };
  const ui = await browser(t);
  const frame = 'document.querySelector("iframe.mw-detail-body")';
  const inside = selector => frame + '?.contentDocument?.querySelector(' + JSON.stringify(selector) + ')';
  await ui.metrics(1440, 900);
  await ui.call('Page.navigate', { url: app.url });
  await ui.waitFor(ui.shown('.home-card-mail'));
  await enterFromAgents(ui);
  await ui.waitFor(ui.shown('.mw-row'));
  const open = () => ui.click('[data-message-id="1"] .mw-subject');
  await open();
  await ui.waitFor(`${inside('#cid-image')}?.naturalWidth === 1`);
  assert.equal(await ui.evaluate(`${inside('#mail-cell')}.ownerDocument.defaultView.getComputedStyle(${inside('#mail-cell')}).color`), 'rgb(52, 117, 78)');
  assert.equal(await ui.evaluate(`${inside('#mail-cell')}.ownerDocument.defaultView.getComputedStyle(${inside('#mail-cell')}).backgroundColor`), 'rgb(236, 239, 241)');
  assert.equal(await ui.evaluate(`${inside('#remote-image')}.hasAttribute('src')`), false);
  assert.deepEqual(remoteRequests, []);
  assert.ok(await ui.evaluate(ui.text('외부 이미지 1개를 차단했어.')));
  assert.equal(await ui.evaluate(`Boolean(${frame}.contentWindow.mailExecuted || window.mailExecuted)`), false);
  assert.equal(await ui.evaluate(`Boolean(${inside('script, iframe, link, [onload], [srcset]')})`), false);
  assert.equal(await ui.evaluate(`${inside('#bad-link')}.hasAttribute('href')`), false);
  assert.equal(await ui.evaluate(`${inside('#safe-link')}.target`), '_blank');
  assert.equal(await ui.evaluate(`${inside('#safe-link')}.rel`), 'noopener noreferrer');
  const link = await ui.evaluate(`(() => { const rect = ${inside('#safe-link')}.getBoundingClientRect();
    const pane = ${frame}.getBoundingClientRect(); return { x: pane.x + rect.x + 5, y: pane.y + rect.y + 5 }; })()`);
  const clicked = once(remote, 'request', { signal: AbortSignal.timeout(5000) });
  await ui.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...link, button: 'left', clickCount: 1 });
  await ui.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...link, button: 'left', clickCount: 1 });
  const [navigation] = await clicked;
  assert.equal(navigation.url, '/clicked');
  assert.equal(navigation.headers.referer, undefined);
  assert.equal(await ui.evaluate('location.origin'), app.url);
  await ui.press('이미지 표시');
  await ui.waitFor(`${inside('#remote-image')}?.naturalWidth === 1`);
  assert.deepEqual(remoteRequests.filter(request => !['/clicked', '/favicon.ico'].includes(request.path)),
    [{ path: '/pixel', referrer: undefined }]);
  await ui.metrics(390, 844);
  await ui.waitFor(`${inside('#mail-cell')}?.ownerDocument.defaultView.getComputedStyle(${inside('#mail-cell')}).fontSize === '18px'`);
  assert.equal(await ui.evaluate(`${frame}.getBoundingClientRect().width <= 390 && ${frame}.getBoundingClientRect().height > 30`), true);
  await ui.metrics(1440, 900);
  await ui.press('목록', '.mw-detail-toolbar button');
  const before = remoteRequests.filter(request => request.path === '/pixel').length;
  await open();
  await ui.waitFor(`${inside('#cid-image')}?.naturalWidth === 1`);
  assert.equal(await ui.evaluate(`${inside('#remote-image')}.hasAttribute('src')`), false);
  assert.equal(remoteRequests.filter(request => request.path === '/pixel').length, before);
  await ui.press('답장', '.mw-detail-toolbar button');
  await ui.waitFor(ui.shown('.mw-quote summary'));
  await ui.click('.mw-quote summary');
  await ui.waitFor(ui.text('평문 인용'));
  assert.equal(await ui.evaluate(ui.shown('iframe.mw-detail-body')), false);
});

test('smart mailbox refresh updates visible results and ignores responses after navigation', { skip: !chrome }, async t => {
  const app = await mockApp(t);
  app.state.smartMessages = [];
  const ui = await browser(t);
  await ui.metrics(1440, 900);
  await ui.call('Page.navigate', { url: app.url });
  await ui.waitFor(ui.shown('.home-card-mail'));
  await ui.evaluate(`(() => {
    const schedule = window.setTimeout.bind(window);
    const cancel = window.clearTimeout.bind(window);
    const timers = new Map();
    let timerId = -1;
    window.setTimeout = (run, ms, ...args) => {
      if (ms !== 15000) return schedule(run, ms, ...args);
      const id = timerId--;
      timers.set(id, () => run(...args));
      return id;
    };
    window.clearTimeout = id => { if (!timers.delete(id)) cancel(id); };
    const fetch = window.fetch.bind(window);
    window.smartPoll = { queued: () => timers.size, requests: 0, aborted: 0, completed: 0, tick() {
      const [id, run] = timers.entries().next().value;
      timers.delete(id);
      run();
    } };
    window.fetch = (url, options) => {
      if (!String(url).startsWith('/api/mail-client/smart/messages?') || !options?.signal) return fetch(url, options);
      const { signal, ...rest } = options;
      window.smartPoll.requests++;
      signal.addEventListener('abort', () => window.smartPoll.aborted++, { once: true });
      // Let the mock return even after cancellation to exercise the stale-response guard.
      return fetch(url, rest).then(response => {
        const json = response.json.bind(response);
        response.json = () => json().finally(() => window.smartPoll.completed++);
        return response;
      });
    };
  })()`);
  await enterFromAgents(ui);
  await ui.waitFor(ui.shown('.mw-row'));
  await ui.press('중요', '.mw-sidebar button');
  await ui.waitFor('window.smartPoll.queued() === 1');
  await ui.press('내가 표시', '.mw-chips button');
  await ui.waitFor('window.smartPoll.queued() === 1');
  assert.equal(await ui.evaluate('document.querySelectorAll(".mw-row").length'), 0);

  app.state.smartMessages = [app.messages[0]];
  await ui.evaluate('window.smartPoll.tick()');
  await ui.waitFor(ui.shown('[data-message-id="1"]'));
  const smartCalls = () => app.calls.filter(call => call.endpoint.endsWith('/smart/messages'));
  assert.equal(smartCalls().at(-1).query.variant, 'starred');
  await ui.click('[data-message-id="1"] .mw-row-select');
  app.state.smartMessages = app.messages.slice(0, 2);
  await ui.waitFor('window.smartPoll.queued() === 1');
  await ui.evaluate('window.smartPoll.tick()');
  await ui.waitFor(ui.shown('[data-message-id="2"]'));
  assert.equal(await ui.evaluate('document.querySelector(\'[data-message-id="1"]\').dataset.checked'), 'Yes');
  assert.equal(await ui.evaluate('document.querySelector(\'.mw-chips [aria-pressed="true"]\').textContent'), '내가 표시');

  app.state.smartError = true;
  await ui.waitFor('window.smartPoll.queued() === 1');
  await ui.evaluate('window.smartPoll.tick()');
  await ui.waitFor('window.smartPoll.completed === 3 && window.smartPoll.queued() === 1');
  assert.equal(await ui.evaluate(ui.shown('[data-message-id="2"]')), true);
  assert.equal(await ui.evaluate(ui.text('메일 목록을 불러오지 못했어')), false);

  app.state.smartError = false;
  app.state.smartMessages = [{ ...app.messages[0], id: 40, subject: '늦게 도착한 스마트 응답' }];
  let release;
  app.state.holdSmart = new Promise(resolve => { release = resolve; });
  t.after(release);
  await ui.evaluate('window.smartPoll.tick()');
  await ui.waitFor('window.smartPoll.requests === 4');
  await ui.click('.mw-sidebar [data-mailbox-role="inbox"]');
  await ui.waitFor(ui.text('신소재 실험 결과 공유'));
  assert.equal(await ui.evaluate('window.smartPoll.aborted'), 1);
  release();
  await ui.waitFor('window.smartPoll.completed === 4');
  assert.equal(await ui.evaluate(ui.text('늦게 도착한 스마트 응답')), false);
  assert.equal(await ui.evaluate('window.smartPoll.queued()'), 0);

  app.state.smartMessages = [app.messages[0]];
  app.state.smartSecondPage = [app.messages[1]];
  app.state.smartNextCursor = 'smart-page-2';
  await ui.press('미분류', '.mw-sidebar button');
  await ui.waitFor('window.smartPoll.queued() === 1');
  await ui.press('다음 페이지');
  await ui.waitFor(ui.shown('[data-message-id="2"]'));
  app.state.smartSecondPage = [app.messages[2]];
  await ui.waitFor('window.smartPoll.queued() === 1');
  await ui.evaluate('window.smartPoll.tick()');
  await ui.waitFor(ui.text('신소재 실험 결과 공유'));
  assert.equal(smartCalls().at(-1).query.cursor, 'smart-page-2');
  assert.equal(await ui.evaluate('document.querySelector(\'.mw-pagination [aria-current="page"]\').textContent'), '2');
  await ui.waitFor('window.smartPoll.queued() === 1');
  await ui.click('#global-nav [data-product-route="home"]');
  await ui.waitFor('window.smartPoll.queued() === 0');
  assert.equal(await ui.evaluate(ui.shown('#mail-workspace.active')), false);
  assert.equal(app.calls.some(call => call.method === 'POST' && call.endpoint.startsWith('/api/mail-client/smart/')), false);
});

test('calendar keeps all undated events on a separate scrolling page across month changes', { skip: !chrome }, async t => {
  const app = await mockApp(t);
  app.state.undated = Array.from({ length: 14 }, (_, i) => ({ id: 100 + i, title: '미확정 후보 ' + (i + 1),
    originalDateText: '다음 달 중', dateProvenance: 'unresolved', startDate: null }));
  const ui = await browser(t);
  await ui.metrics(1440, 900);
  await ui.call('Page.navigate', { url: app.url });
  await ui.waitFor(ui.shown('.home-card-mail'));
  await enterFromAgents(ui);
  await ui.waitFor(ui.shown('.mw-row'));
  await ui.press('일정', '.mw-sidebar button');
  await ui.waitFor(ui.text('미확정 후보 1'));
  await ui.waitFor(ui.text('연구실 면담'));
  const unresolved = () => app.calls.filter(call => call.endpoint.endsWith('/smart/calendar') && call.query.section === 'unresolved');
  assert.equal(unresolved().length, 1);
  assert.equal(unresolved()[0].query.month, undefined);
  assert.equal(await ui.evaluate('document.querySelector(".mw-calendar-undated-title .mw-muted").textContent'), '14개');
  assert.equal(await ui.evaluate('document.querySelector(".mw-calendar-month").textContent.includes("미확정 후보")'), false);
  assert.ok(await ui.evaluate(`(() => {
    const month = document.querySelector('.mw-calendar-month').getBoundingClientRect();
    const panel = document.querySelector('.mw-calendar-undated').getBoundingClientRect();
    return panel.width === 288 && panel.left > month.right && panel.bottom === month.bottom && panel.bottom <= 900;
  })()`));
  await ui.capture('mail-calendar-undated.png');
  await ui.press('다음 달');
  assert.equal(await ui.evaluate(ui.text('미확정 후보 1')), true);
  assert.equal(unresolved().length, 1);
  await ui.evaluate('document.querySelector(".mw-calendar-undated-items").scrollTop = 100000');
  await ui.waitFor(ui.text('미확정 후보 14'));
  assert.equal(unresolved()[1].query.cursor, 'undated-next');
  await ui.metrics(390, 844);
  assert.ok(await ui.evaluate('document.querySelector(".mw-calendar-undated").getBoundingClientRect().width <= 390'));
  await ui.evaluate('document.querySelector(".mw-calendar-undated").scrollIntoView({ block: "end" }); document.querySelector(".mw-calendar-undated-items").scrollTop = 0');
  await ui.capture('mail-calendar-undated-phone.png');
  await ui.click('.mw-calendar-undated .mw-calendar-event:last-child button');
  await ui.waitFor(ui.shown('.mw-detail-body'));
  assert.ok(app.calls.some(call => call.endpoint.endsWith('/smart/calendar/113')));
});

test('sidebar analysis confirms once, starts batches of ten and shows real partial results', { skip: !chrome }, async t => {
  const app = await mockApp(t);
  const ids = Array.from({ length: 12 }, (_, i) => i + 1);
  app.state.analysisTargets = [...ids, ids[0]];
  const ui = await browser(t);
  await ui.metrics(1440, 900);
  await ui.call('Page.navigate', { url: app.url });
  await ui.waitFor(ui.shown('.home-card-mail'));
  await ui.evaluate(`(() => {
    const schedule = window.setTimeout.bind(window);
    window.setTimeout = (run, ms, ...args) => ms === 5000
      ? (window.runAnalysisPoll = () => { window.runAnalysisPoll = null; run(...args); }, -12)
      : schedule(run, ms, ...args);
  })()`);
  await enterFromAgents(ui);
  await ui.waitFor(ui.text('분석 12'));
  const posts = () => app.calls.filter(call => call.endpoint.endsWith('/smart/analyze'));
  await ui.click('.mw-analyze');
  await ui.waitFor(ui.text('미분류 12통을 분석할까?'));
  await ui.capture('mail-analysis-a1.png');
  await ui.metrics(820, 1180);
  assert.equal(await ui.evaluate('document.querySelector(".mw-analysis-dialog").getBoundingClientRect().width'), 380);
  await ui.capture('mail-analysis-a1-tablet.png');
  await ui.metrics(1440, 900);
  await ui.press('취소', 'dialog button');
  assert.equal(posts().length, 0);
  await ui.click('.mw-analyze');
  await ui.waitFor(ui.shown('.mw-analysis-dialog[open]'));
  await ui.press('분석', 'dialog button');
  await ui.waitFor('Boolean(window.runAnalysisPoll)');
  assert.deepEqual(posts().map(call => call.payload), [ids.slice(0, 10), ids.slice(10)].map(messageIds => ({ messageIds, kind: 'both' })));
  assert.equal(await ui.evaluate('document.querySelector(".mw-analyze").disabled'), true);
  assert.equal(await ui.evaluate(ui.text('분석 중 0/12')), true);
  await ui.capture('mail-analysis-a2.png');
  app.state.analysisStates = Object.fromEntries(ids.slice(0, 10).map(id => [id, id === 9 ? 'failed' : id === 10 ? 'skipped' : 'done']));
  await ui.evaluate('window.runAnalysisPoll()');
  await ui.waitFor(ui.text('분석 중 10/12'));
  await ui.press('중요', '.mw-sidebar button');
  await ui.waitFor(ui.text('논문 피드백 전달'));
  const before = app.calls.filter(call => call.endpoint.endsWith('/smart/messages')).length;
  app.state.analysisStates[11] = app.state.analysisStates[12] = 'done';
  app.state.analysisTargets = [];
  await ui.waitFor('Boolean(window.runAnalysisPoll)');
  await ui.evaluate('window.runAnalysisPoll()');
  await ui.waitFor(ui.text('10통 분석했어 · 1통 실패 · 1통 미처리'));
  await ui.waitFor('document.querySelector(".mw-analyze").dataset.state === "disabled"');
  assert.ok(app.calls.filter(call => call.endpoint.endsWith('/smart/messages')).length > before);
  assert.equal(posts().length, 2);
  assert.equal(app.calls.some(call => call.method === 'POST' && call.endpoint.endsWith('/messages/actions')), false);
  await ui.click('.mw-sidebar [data-mailbox-role="inbox"]');
  await ui.waitFor(ui.text('신소재 실험 결과 공유'));
  await ui.capture('mail-analysis-a3.png');
  await ui.click('.mw-analyze');
  assert.equal(posts().length, 2);
  await ui.press('미분류 보기', '.mw-analysis-notice button');
  await ui.waitFor('document.querySelector("#mail-workspace h1").textContent === "미분류"');
  await ui.waitFor('document.querySelector(".mw-rows").getAttribute("aria-busy") === "false"');
  await ui.click('.mw-sidebar [data-mailbox-role="inbox"]');
  await ui.waitFor(ui.text('신소재 실험 결과 공유'));
  await ui.capture('mail-analysis-a4.png');
  assert.equal(await ui.evaluate('Boolean(window.runAnalysisPoll)'), false);

  app.state.analysisTargets = [13];
  await ui.press('새로고침');
  await ui.waitFor(ui.text('분석 1'));
  await ui.click('.mw-analyze');
  await ui.waitFor(ui.shown('.mw-analysis-dialog[open]'));
  await ui.press('분석', 'dialog button');
  await ui.waitFor('Boolean(window.runAnalysisPoll)');
  app.state.analysisStates[13] = 'done';
  app.state.analysisTargets = [];
  await ui.evaluate('window.runAnalysisPoll()');
  await ui.waitFor(ui.text('1통 분석했어'));
  assert.equal(await ui.evaluate('document.querySelector(".mw-analysis-notice img").getAttribute("src").endsWith("analyze-done.svg")'), true);
  assert.ok(await ui.evaluate('!document.querySelector(".mw-analysis-notice button")'));
  await ui.capture('mail-analysis-done.png');
});

test('filter, search results, smart lists, calendar and contact import use Workspace APIs', { skip: !chrome }, async t => {
  const app = await mockApp(t);
  const ui = await browser(t);
  await ui.metrics(1440, 900);
  await ui.call('Page.navigate', { url: app.url });
  await ui.waitFor(ui.shown('.home-card-mail'));
  await enterFromAgents(ui);
  await ui.waitFor(ui.shown('.mw-row'));
  await ui.press('필터');
  await ui.waitFor(ui.shown('.mw-filter-form'));
  await ui.press('안 읽음', 'dialog button');
  await ui.capture('mail-filter.png');
  await ui.press('적용', 'dialog button');
  await ui.waitFor('!document.querySelector(".mw-square[aria-label=새로고침]").disabled');
  assert.ok(app.calls.some(call => call.endpoint.endsWith('/search') && call.query.read === 'unread'));
  await ui.evaluate('document.querySelector(".mw-search input").value="논문";document.querySelector(".mw-search").requestSubmit()');
  await ui.waitFor(ui.text('검색 결과'));
  await ui.waitFor(ui.shown('.mw-row'));
  await ui.capture('mail-search-results.png');
  await ui.evaluate('document.querySelector(".mw-search input").value="없는 제목";document.querySelector(".mw-search").requestSubmit()');
  await ui.waitFor(ui.text('검색 결과가 없어'));
  await ui.capture('mail-search-empty.png');
  for (const [label, filter] of [['중요', 'important'], ['조치 필요', 'action_required'], ['마감', 'deadline'], ['무시', 'ignore'], ['미분류', 'unclassified']]) {
    await ui.press(label, '.mw-sidebar button');
    await ui.waitFor('!document.querySelector(".mw-square[aria-label=새로고침]").disabled');
    assert.ok(app.calls.some(call => call.endpoint.endsWith('/smart/messages') && call.query.filter === filter));
    await ui.capture('mail-smart-' + filter + '.png');
    if (filter === 'action_required') {
      for (const [label, variant] of [['답장', 'reply'], ['확인', 'confirm'], ['제출', 'submit']]) {
        await ui.press(label, '.mw-chips button');
        await ui.waitFor('!document.querySelector(".mw-square[aria-label=새로고침]").disabled');
        assert.equal(app.calls.filter(call => call.endpoint.endsWith('/smart/messages')).at(-1).query.variant, variant);
      }
    }
  }
  await ui.press('일정', '.mw-sidebar button');
  await ui.waitFor(ui.text('연구실 면담'));
  await ui.capture('mail-calendar.png');
  await ui.press('원본 메일 열기');
  await ui.waitFor(ui.shown('.mw-detail-body'));
  await ui.press('연락처', '.mw-sidebar button');
  await ui.waitFor(ui.text('sender@example.com'));
  await ui.capture('mail-contacts.png');
  await ui.click('button.mw-contact-row');
  await ui.waitFor(ui.shown('.mw-contact-attributes'));
  await ui.capture('mail-contact-detail.png');
  app.state.contactsUnavailable = true;
  await ui.press('메일 설정', '.mw-sidebar button');
  await ui.waitFor(ui.text('자동 분류 규칙'));
  await ui.capture('mail-settings-base.png');
  app.state.contactsUnavailable = false;
  await ui.press('메일 설정', '.mw-sidebar button');
  await ui.waitFor(ui.text('CSV에서 가져옴'));
  await ui.capture('mail-settings.png');
  const csv = path.join(os.tmpdir(), 'galpi-mail-contacts-fixture-' + process.pid + '.csv');
  await fs.writeFile(csv, 'Name,E-mail,Organization\n최유진,sender@example.com,연구실\n안지원,other@example.com,소속\n');
  t.after(() => fs.rm(csv, { force: true }));
  await ui.press('CSV 가져오기', '.mw-settings button');
  const root = await ui.call('DOM.getDocument');
  const input = await ui.call('DOM.querySelector', { nodeId: root.root.nodeId, selector: '#mail-workspace input[type=file]' });
  await ui.call('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [csv] });
  await ui.waitFor(ui.text('새 연락처 1명'));
  await ui.capture('mail-contacts-csv.png');
  await ui.press('1명 가져오기', 'dialog button');
  await ui.waitFor('!document.querySelector(".mw-csv-dialog")');
  assert.equal(app.calls.filter(call => call.endpoint.endsWith('/contacts/import') && !call.payload.preview).length, 1);
});

test('contact scrolling loads additional filtered pages and both history views use exact address search', { skip: !chrome }, async t => {
  const app = await mockApp(t);
  for (const [source, name] of [['csv', '가져온'], ['observed', '관측']]) {
    app.contacts.push(...Array.from({ length: 205 }, (_, index) => ({ id: source + index,
      name: `${name} 연락처 ${index}`, email: `${source}${index}@example.com`, source })));
  }
  app.messages[2].subject = '제목에만 sender@example.com';
  const ui = await browser(t);
  await ui.metrics(1440, 900);
  await ui.call('Page.navigate', { url: app.url });
  await ui.waitFor(ui.shown('.home-card-mail'));
  await enterFromAgents(ui);
  await ui.waitFor(ui.shown('.mw-row'));
  await ui.press('연락처', '.mw-sidebar button');
  const count = value => `document.querySelectorAll('.mw-contact-list button').length === ${value}`;
  await ui.waitFor(count(200));
  await ui.press('CSV', '.mw-contacts .mw-chips button');
  await ui.waitFor(ui.text('206명'));
  await ui.evaluate('document.querySelector(".mw-contact-list button:last-child").scrollIntoView()');
  await ui.waitFor(count(206));
  assert.ok(app.calls.some(call => call.endpoint.endsWith('/contacts') && call.query.source === 'csv' && call.query.offset === '200'));
  assert.equal(await ui.evaluate('new Set([...document.querySelectorAll(".mw-contact-email")].map(row => row.textContent)).size'), 206);

  await ui.press('메일에서 수집', '.mw-contacts .mw-chips button');
  await ui.waitFor(ui.text('205명'));
  await ui.evaluate('document.querySelector(".mw-contacts input").value="관측"; document.querySelector(".mw-contacts form").requestSubmit()');
  await ui.waitFor(count(200));
  await ui.evaluate('document.querySelector(".mw-contact-list button:last-child").scrollIntoView()');
  await ui.waitFor(count(205));
  assert.ok(app.calls.some(call => call.endpoint.endsWith('/contacts') && call.query.source === 'observed'
    && call.query.q === '관측' && call.query.offset === '200'));

  await ui.press('CSV', '.mw-contacts .mw-chips button');
  await ui.evaluate('document.querySelector(".mw-contacts input").value="sender@example.com"; document.querySelector(".mw-contacts form").requestSubmit()');
  await ui.waitFor(count(1));
  await ui.click('.mw-contact-list button');
  await ui.waitFor(ui.text('주고받은 메일'));
  assert.equal(await ui.evaluate(ui.text('제목에만 sender@example.com')), false);
  await ui.press('모두 보기', '.mw-contact-history button');
  await ui.waitFor(ui.shown('.mw-rows [data-message-id="1"]'));
  assert.equal(await ui.evaluate(ui.text('제목에만 sender@example.com')), false);
  const history = app.calls.filter(call => call.endpoint.endsWith('/search'));
  assert.deepEqual(history.slice(-2).map(call => [call.query.contactEmail, call.query.q]),
    Array(2).fill(['sender@example.com', undefined]));
});

test('tablet and phone detail and composer follow their visible actions and preserve the loading and missing states', { skip: !chrome }, async t => {
  const app = await mockApp(t);
  const ui = await browser(t);
  await ui.metrics(820, 1180);
  await ui.call('Page.navigate', { url: app.url });
  await ui.waitFor(ui.shown('.home-card-mail'));
  await enterFromAgents(ui);
  await ui.waitFor(ui.shown('.mw-row'));
  let release;
  app.state.holdDetail = new Promise(resolve => { release = resolve; });
  t.after(release);
  await ui.click('[data-message-id="1"] .mw-subject');
  await ui.waitFor(ui.shown('.mw-detail-placeholder'));
  await ui.metrics(1440, 1000);
  await ui.capture('mail-detail-loading.png');
  await ui.metrics(820, 1180);
  release();
  await ui.waitFor(ui.shown('.mw-detail-body'));
  await ui.capture('tablet-detail.png');
  await ui.press('답장', '.mw-detail-toolbar button');
  await ui.waitFor(ui.shown('.mw-compose-body'));
  await ui.capture('tablet-compose.png');
  await ui.press('작성 취소');
  await ui.waitFor(ui.shown('.mw-detail-body'));
  await ui.metrics(390, 844);
  await ui.waitFor(ui.shown('.mw-detail-compact'));
  assert.equal(await ui.evaluate(ui.shown('.mw-detail-toolbar')), false);
  assert.ok(await ui.evaluate(ui.text('이전 메시지 1개 보기')));
  await ui.capture('phone-detail.png');
  await ui.press('답장', '.mw-detail-actions button');
  await ui.waitFor(ui.shown('.mw-compose-head .mw-popover-primary'));
  assert.equal(await ui.evaluate(ui.shown('.mw-compose-bottom')), false);
  await ui.capture('phone-compose.png');
  await ui.press('보내기', '.mw-compose-head button');
  await ui.waitFor(ui.text('메일을 보냈어'));
  await ui.capture('phone-sent.png');
  await ui.press('받은편지함', '.mw-detail-compact button');
  await ui.waitFor(ui.shown('.mw-row'));
  app.state.missingDetail = true;
  await ui.click('[data-message-id="1"] .mw-subject');
  await ui.waitFor(ui.text('이 메일을 찾을 수 없어'));
  await ui.metrics(1440, 1000);
  await ui.capture('mail-detail-gone.png');
  assert.equal(app.calls.filter(call => call.endpoint.endsWith('/send')).length, 1);
});

test('contact lookup and move failure retain the designed controls', { skip: !chrome }, async t => {
  const app = await mockApp(t);
  const ui = await browser(t);
  await ui.metrics(1440, 900);
  await ui.call('Page.navigate', { url: app.url });
  await ui.waitFor(ui.shown('.home-card-mail'));
  await enterFromAgents(ui);
  await ui.waitFor(ui.shown('.mw-row'));
  app.state.outcome = 'failed';
  await ui.click('[data-message-id="1"] .mw-row-select');
  await ui.press('이동', '.mw-toolbar button');
  await ui.press('연구실', 'dialog button');
  await ui.capture('mail-move-picker.png');
  await ui.press('이동', 'dialog button');
  await ui.waitFor(ui.text('‘연구실’로 옮기지 못했어'));
  await ui.capture('mail-move-failed.png');
  await ui.press('연락처', '.mw-sidebar button');
  await ui.waitFor(ui.shown('button.mw-contact-row'));
  await ui.metrics(390, 844);
  await ui.capture('phone-contacts.png');
  await ui.click('button.mw-contact-row');
  await ui.waitFor(ui.shown('.mw-contact-attributes'));
  await ui.capture('phone-contact-detail.png');
  await ui.press('메일 쓰기', '.mw-contact-profile button');
  await ui.waitFor(ui.shown('.mw-compose-body'));
  await ui.metrics(1440, 1000);
  await ui.evaluate('const field = document.querySelector("[aria-label=\\"받는 사람\\"]"); field.focus(); field.value="최유진"; field.dispatchEvent(new Event("input", {bubbles:true}));');
  await ui.waitFor(ui.shown('.mw-recipient-choice'));
  await ui.capture('mail-contact-autocomplete.png');
  await ui.click('.mw-recipient-choice');
  assert.match(await ui.evaluate('document.querySelector("[aria-label=\\"받는 사람\\"]").value'), /sender@example\.com/);
  assert.equal(app.calls.filter(call => call.endpoint.endsWith('/send')).length, 0);
});
