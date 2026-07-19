'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('notification, task, and agent modules load before the panel shell and expose narrow APIs', () => {
  const html = read('public/index.html');
  const appSource = read('public/app.js');
  const css = read('public/style.css');
  const notificationSource = read('public/notification-panel.js');
  const taskSource = read('public/task-panel.js');
  const pushSource = read('public/push-client.js');
  const agentSource = read('public/agent-panel.js');
  const notificationIndex = html.indexOf('<script src="notification-panel.js"></script>');
  const taskIndex = html.indexOf('<script src="task-panel.js"></script>');
  const pushIndex = html.indexOf('<script src="push-client.js"></script>');
  const agentIndex = html.indexOf('<script src="agent-panel.js"></script>');
  const paperIndex = html.indexOf('<script src="paper-panel.js"></script>');
  const appIndex = html.indexOf('<script src="app.js"></script>');

  assert.match(html, /data-panel-tab="notifications"[^>]*class="[^"]*active|class="knowledge-tab active" data-panel-tab="notifications"/);
  assert.match(html, /id="notification-panel-content" class="notification-body" aria-live="polite"/);
  assert.match(html, /id="agent-panel-content" aria-live="polite"/);
  assert.match(html, /data-model="claude" aria-label="기본 답변 모드 XION"/);
  assert.match(html, /class="model-logo-icon xion-mark-icon"[^>]*>[\s\S]*?XION/);
  assert.match(html, /id="assistant-tools-toggle"[^>]*aria-controls="assistant-tools-menu"[^>]*aria-expanded="false"/);
  assert.match(html, /id="assistant-tools-menu" aria-label="XION 도구" hidden/);
  assert.doesNotMatch(html, /id="pet"|src="pet\.js"/);
  assert.match(appSource, /const ASSISTANT_TOOL_GROUPS = \[/);
  assert.match(appSource, /function initAssistantTools\(\)/);
  assert.match(appSource, /if \(!command\.endsWith\(' '\)\) sendMessage\(\)/);
  assert.match(appSource, /DOMContentLoaded[\s\S]*initAssistantTools\(\)/);
  assert.match(css, /#assistant-tools-toggle\s*{[^}]*width: 44px;[^}]*height: 44px/s);
  assert.match(css, /#assistant-tools-menu\s*{[^}]*bottom: calc\(100% \+ 10px\)[^}]*max-height:/s);
  assert.match(css, /\.model-btn\[data-model="claude"\]\.active\s*{[^}]*background: transparent;[^}]*color: var\(--brand-ink\)/s);
  assert.ok(notificationIndex > 0 && notificationIndex < taskIndex);
  assert.ok(taskIndex < pushIndex && pushIndex < agentIndex);
  assert.ok(agentIndex < paperIndex && paperIndex < appIndex);

  const notificationWindow = {};
  vm.runInNewContext(notificationSource, { window: notificationWindow }, { filename: 'notification-panel.js' });
  assert.deepEqual(Object.keys(notificationWindow.NotificationPanel).sort(), ['init', 'refresh', 'show']);
  const taskWindow = {};
  vm.runInNewContext(taskSource, { window: taskWindow }, { filename: 'task-panel.js' });
  assert.deepEqual(Object.keys(taskWindow.TaskPanel).sort(), ['init', 'makeReminderCard', 'refresh', 'render']);
  const pushWindow = {};
  vm.runInNewContext(pushSource, { window: pushWindow }, { filename: 'push-client.js' });
  assert.deepEqual(Object.keys(pushWindow.PushClient).sort(), ['enable', 'getState', 'init', 'refresh']);
  const agentWindow = {};
  vm.runInNewContext(agentSource, { window: agentWindow }, { filename: 'agent-panel.js' });
  assert.deepEqual(Object.keys(agentWindow.AgentPanel).sort(), ['init', 'openTasks', 'refresh', 'show']);
});

test('minimal PWA has stable scope and a push-only service worker', () => {
  const html = read('public/index.html');
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  const worker = read('public/sw.js');

  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#F3F5F2');
  assert.ok(manifest.icons.every(icon => icon.src === '/lib/icons/Xion/xion-app-icon.svg'));
  assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'));
  assert.match(html, /rel="icon" href="\/lib\/icons\/Xion\/xion-app-icon\.svg"/);
  assert.match(worker, /addEventListener\('push'/);
  assert.match(worker, /showNotification\('XION 일정 알림'/);
  assert.match(worker, /icon: '\/lib\/icons\/Xion\/xion-app-icon\.svg'/);
  assert.match(worker, /badge: '\/lib\/icons\/Xion\/xion-mark\.svg'/);
  assert.doesNotMatch(worker, /Claude_code_pet/);
  assert.match(worker, /tag: `task-reminder:\$\{reminderId\}`/);
  assert.match(worker, /addEventListener\('notificationclick'/);
  assert.match(worker, /\?panel=agents&taskView=reminders/);
  assert.match(worker, /current\.navigate\(target\.href\)/);
  assert.doesNotMatch(worker, /addEventListener\('fetch'/);
  assert.doesNotMatch(worker, /(?:title|detail|token|p256dh|auth|endpoint)/i);
});

test('push permission is requested only by explicit enable after canonical-origin checks', async () => {
  const source = read('public/push-client.js');
  let permissionRequests = 0;
  let subscriptions = 0;
  let currentSubscription = null;
  const subscription = {
    endpoint: 'https://web.push.apple.com/ui-test',
    toJSON() {
      return {
        endpoint: this.endpoint,
        keys: { p256dh: 'B'.repeat(87), auth: 'C'.repeat(22) },
      };
    },
    async unsubscribe() { return true; },
  };
  const registration = {
    pushManager: {
      async getSubscription() { return currentSubscription; },
      async subscribe(options) {
        assert.equal(options.userVisibleOnly, true);
        subscriptions += 1;
        currentSubscription = subscription;
        return subscription;
      },
    },
  };
  const fakeWindow = {
    isSecureContext: true,
    PushManager: function PushManager() {},
    Notification: {
      permission: 'default',
      async requestPermission() {
        permissionRequests += 1;
        this.permission = 'granted';
        return 'granted';
      },
    },
    atob,
    matchMedia: () => ({ matches: true }),
  };
  const navigator = {
    userAgent: 'Macintosh',
    platform: 'MacIntel',
    maxTouchPoints: 0,
    serviceWorker: {
      async register(pathname, options) {
        assert.equal(pathname, '/sw.js');
        assert.equal(options.scope, '/');
      },
      ready: Promise.resolve(registration),
    },
  };
  vm.runInNewContext(source, {
    window: fakeWindow,
    navigator,
    Notification: fakeWindow.Notification,
    location: { origin: 'https://galpi.example.ts.net' },
    Uint8Array,
  }, { filename: 'push-client.js' });
  const calls = [];
  fakeWindow.PushClient.init({
    async apiFetch(pathname, options = {}) {
      calls.push({ pathname, options });
      if (pathname === '/api/push/config') {
        return {
          ok: true,
          async json() {
            return {
              enabled: true,
              canonicalOrigin: 'https://galpi.example.ts.net',
              publicKey: 'A'.repeat(87),
            };
          },
        };
      }
      return { ok: true, async json() { return { id: 1 }; } };
    },
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(await fakeWindow.PushClient.refresh())),
    { status: 'available', label: '알림 켜기' },
  );
  assert.equal(permissionRequests, 0);
  assert.equal(subscriptions, 0);
  assert.equal(await fakeWindow.PushClient.enable(), true);
  assert.equal(permissionRequests, 1);
  assert.equal(subscriptions, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(fakeWindow.PushClient.getState())),
    { status: 'enabled', label: '알림 켜짐' },
  );
  assert.equal(calls.filter(call => call.pathname === '/api/push/subscriptions').length, 1);
});

test('runtime flag hides task entry points and foreground refresh stays separate from chat polling', () => {
  const app = read('public/app.js');

  assert.match(app, /meta\[name="theme-color"\][\s\S]*dark \? '#151A18' : '#F3F5F2'/);
  assert.match(app, /tasksEnabled = config\.tasksEnabled === true/);
  assert.match(app, /command\.feature !== 'tasks' \|\| tasksEnabled/);
  assert.match(app, /window\.PaperPanel\.open\('agents'\)/);
  assert.match(app, /window\.AgentPanel\.openTasks/);
  assert.match(app, /setInterval\(refreshTaskViews, 60_000\)/);
  assert.match(app, /document\.visibilityState !== 'visible'/);
  assert.match(app, /document\.addEventListener\('visibilitychange'/);
  assert.match(app, /setInterval\(pollForUpdates, 7000\)/);
});

test('task controls stay in the agent tab and the floating notification center is removed', () => {
  const app = read('public/app.js');
  const html = read('public/index.html');
  const css = read('public/style.css');

  assert.match(app, /openTaskComposer[\s\S]*PaperPanel\.open\('agents'\)[\s\S]*AgentPanel\.openTasks/);
  assert.match(app, /openNotificationsPanel[\s\S]*PaperPanel\.open\('notifications'\)/);
  assert.doesNotMatch(`${app}\n${html}\n${css}`, /notification-center/);
  assert.doesNotMatch(app, /NotificationPanelPosition|enableNotificationPanelDrag/);
});

test('task reminders use the dedicated renderer and never enter Codex decisions', () => {
  const agentPanel = read('public/agent-panel.js');
  const notificationPanel = read('public/notification-panel.js');
  const taskPanel = read('public/task-panel.js');

  assert.match(agentPanel, /filter\(item => item\.type === 'task_reminder'\)/);
  assert.match(agentPanel, /TaskPanel\.makeReminderCard\(item\)/);
  assert.match(notificationPanel, /filter\(item => item\.type !== 'task_reminder'\)/);
  assert.doesNotMatch(notificationPanel, /TaskPanel/);
  assert.doesNotMatch(taskPanel, /\/api\/notifications\/.+\/(?:approve|ignore)/);
  assert.match(taskPanel, /\/api\/reminders\/\$\{item\.reminderId\}\/acknowledge/);
  assert.match(taskPanel, /\/api\/reminders\/\$\{item\.reminderId\}\/snooze/);
  assert.match(taskPanel, /const snoozeRequestKey = makeRequestKey\('web-snooze'\)/);
});

test('agent shell delegates writes to TaskPanel and inserts task text as text content', () => {
  const agentPanel = read('public/agent-panel.js');
  const taskPanel = read('public/task-panel.js');

  assert.match(agentPanel, /state\.apiFetch\(`\/api\/tasks\/summary/);
  assert.doesNotMatch(agentPanel, /method:\s*'(?:POST|PATCH|DELETE)'/);
  assert.doesNotMatch(agentPanel, /innerHTML\s*=\s*(?:message|data|item|task|error)/);
  assert.doesNotMatch(taskPanel, /innerHTML\s*=\s*(?:message|data|item|task|error)/);
  assert.match(taskPanel, /title\.textContent = task\.title/);
  assert.match(agentPanel, /title\.textContent = task\.title \|\| '제목 없는 일정'/);
  assert.doesNotMatch(`${taskPanel}\n${agentPanel}`, /[—–]/);
});

test('schedule layout keeps native week navigation and minimal task controls', () => {
  const css = read('public/style.css');
  const agentPanel = read('public/agent-panel.js');
  const taskPanel = read('public/task-panel.js');

  assert.match(css, /\.notification-tabs\s*{[^}]*repeat\(4, 1fr\)/s);
  assert.match(css, /\.task-view-tabs\s*{[^}]*display: flex[^}]*border-bottom:/s);
  assert.match(css, /:root\s*{[^}]*--bg:\s*#F3F5F2[^}]*--brand:\s*#2F6B57[^}]*--brand-ink:\s*#2F6B57/s);
  assert.match(css, /\[data-theme="dark"\]\s*{[^}]*--bg:\s*#151A18[^}]*--brand-ink:\s*#7FB99F/s);
  assert.match(css, /\.task-view-tab\.active\s*{[^}]*border-bottom-color: var\(--brand-ink\)/s);
  assert.doesNotMatch(css, /217, 119, 87|var\(--claude-color\)/);
  assert.match(css, /\.task-card\s*{[^}]*border-bottom: 1px solid var\(--border\)[^}]*background: transparent/s);
  assert.match(css, /\.schedule-agent-week\s*{[^}]*repeat\(7, minmax\(0, 1fr\)\)/s);
  assert.match(css, /\.schedule-agent-calendar-track\s*{[^}]*width: 300%/s);
  assert.match(css, /\.schedule-agent-calendar-viewport\s*{[^}]*scroll-snap-type: x mandatory/s);
  assert.match(agentPanel, /const back = button\('<', openSummary\)/);
  assert.match(agentPanel, /back\.setAttribute\('aria-label', '일정 요약으로 돌아가기'\)/);
  assert.match(agentPanel, /add\.setAttribute\('aria-label', '일정 추가'\)/);
  assert.doesNotMatch(agentPanel, /button\('(?:이전|오늘|다음)'/);
  assert.match(agentPanel, /event\.key === 'ArrowLeft'[\s\S]*scrollCalendar\(-1\)/);
  assert.match(agentPanel, /event\.key === 'ArrowRight'[\s\S]*scrollCalendar\(1\)/);
  assert.match(taskPanel, /if \(task\.dueKind !== 'none'\)/);
  assert.match(taskPanel, /if \(task\.reminder\)/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.task-action\s*{[^}]*min-height: 44px/s);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.schedule-agent-back,[\s\S]*?min-height: 44px/s);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.task-card-actions \.task-action\s*{[^}]*flex: 1 1 0[^}]*min-width: 0/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.task-panel-skeleton span/s);
});
