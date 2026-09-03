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
  const modelPickerSource = read('public/model-picker.js');
  const notificationIndex = html.indexOf('<script src="notification-panel.js"></script>');
  const taskIndex = html.indexOf('<script src="task-panel.js"></script>');
  const pushIndex = html.indexOf('<script src="push-client.js"></script>');
  const agentIndex = html.indexOf('<script src="agent-panel.js"></script>');
  const modelPickerIndex = html.indexOf('<script src="model-picker.js"></script>');
  const paperIndex = html.indexOf('<script src="paper-panel.js"></script>');
  const appIndex = html.indexOf('<script src="app.js"></script>');

  assert.match(html, /class="knowledge-tab active" data-panel-tab="agents"/);
  assert.match(html, /id="notification-panel-content" class="notification-body" aria-live="polite"/);
  assert.match(html, /id="agent-panel-content" aria-live="polite"/);
  assert.match(html, /aria-label="기본 답변 비서 XION"/);
  assert.match(html, /class="model-logo-icon xion-mark-icon"[^>]*>[\s\S]*?XION/);
  assert.match(html, /id="chat-model-button"[^>]*aria-haspopup="listbox"[^>]*aria-expanded="false"/);
  assert.match(html, /id="chat-model-options" role="listbox" aria-label="GPT 모델"/);
  assert.match(html, /id="input" placeholder="시온에게 물어보세요"/);
  assert.doesNotMatch(html, /council-btn|council-mode-toggle|Claude 크레딧/);
  assert.match(html, /id="assistant-tools-toggle"[^>]*aria-controls="assistant-tools-menu"[^>]*aria-expanded="false"/);
  assert.match(html, /id="assistant-tools-menu" aria-label="XION 도구" hidden/);
  assert.doesNotMatch(html, /id="pet"|src="pet\.js"/);
  assert.match(appSource, /const ASSISTANT_TOOL_GROUPS = \[/);
  assert.match(appSource, /function initAssistantTools\(\)/);
  assert.match(appSource, /if \(!command\.endsWith\(' '\)\) sendMessage\(\)/);
  assert.match(appSource, /DOMContentLoaded[\s\S]*initAssistantTools\(\)/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?#assistant-tools-toggle\s*{[^}]*width: 44px;[^}]*height: 44px/s);
  assert.match(css, /#assistant-tools-menu\s*{[^}]*bottom: calc\(100% \+ 10px\)[^}]*max-height:/s);
  assert.match(css, /#chat-model-button\s*{[^}]*height: 40px;[^}]*border: none/s);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?#chat-model-button\s*{[^}]*height: 44px/s);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?#chat-model-menu\s*{[^}]*position: fixed/s);
  assert.match(css, /#input\s*{[^}]*min-width: 0/s);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?#send-btn,\s*#voice-hd-button\s*{[^}]*width: 44px;[^}]*height: 44px/s);
  assert.match(modelPickerSource, /If-Match/);
  assert.match(modelPickerSource, /appliesFrom|다음 답변부터/);
  assert.ok(notificationIndex > 0 && notificationIndex < taskIndex);
  assert.ok(taskIndex < pushIndex && pushIndex < agentIndex);
  assert.ok(agentIndex < modelPickerIndex && modelPickerIndex < paperIndex && paperIndex < appIndex);

  const notificationWindow = {};
  vm.runInNewContext(notificationSource, { window: notificationWindow }, { filename: 'notification-panel.js' });
  assert.deepEqual(Object.keys(notificationWindow.NotificationPanel).sort(), ['init', 'refresh', 'show']);
  const taskWindow = {};
  vm.runInNewContext(taskSource, { window: taskWindow }, { filename: 'task-panel.js' });
  assert.deepEqual(Object.keys(taskWindow.TaskPanel).sort(), ['getPendingScheduleConfirmation', 'init', 'makeReminderCard', 'makeScheduleCandidateCard', 'refresh', 'render']);
  const pushWindow = {};
  vm.runInNewContext(pushSource, { window: pushWindow }, { filename: 'push-client.js' });
  assert.deepEqual(Object.keys(pushWindow.PushClient).sort(), ['enable', 'getState', 'init', 'refresh']);
  const agentWindow = {};
  vm.runInNewContext(agentSource, { window: agentWindow }, { filename: 'agent-panel.js' });
  assert.deepEqual(Object.keys(agentWindow.AgentPanel).sort(), ['init', 'openTasks', 'refresh', 'show']);
  assert.match(agentSource, /heading\.textContent = '사서 Codex'/);
  assert.match(agentSource, /\/api\/settings\/codex-models/);
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
  assert.deepEqual(
    manifest.icons.map(icon => [icon.src, icon.sizes, icon.type, icon.purpose]),
    [
      ['/lib/icons/Xion/xion-app-icon-192.png', '192x192', 'image/png', 'any'],
      ['/lib/icons/Xion/xion-app-icon-512.png', '512x512', 'image/png', 'any'],
      ['/lib/icons/Xion/xion-app-icon-512.png', '512x512', 'image/png', 'maskable'],
    ],
  );
  assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'));
  assert.match(html, /rel="icon" href="\/lib\/icons\/Xion\/xion-app-icon\.svg"/);
  assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="\/lib\/icons\/Xion\/xion-app-icon-180\.png"/);
  assert.match(html, /rel="apple-touch-icon" sizes="167x167" href="\/lib\/icons\/Xion\/xion-app-icon-167\.png"/);
  for (const size of [167, 180, 192, 512]) {
    assert.ok(fs.existsSync(path.join(ROOT, `public/lib/icons/Xion/xion-app-icon-${size}.png`)));
  }
  assert.match(worker, /addEventListener\('push'/);
  // 메일 알림이 붙으면서 분기가 생겼다. 잠그는 것은 여전히 일정 쪽 문구·tag가
  // 그대로라는 것이다 — MAIL-3가 배포된 일정 Push를 바꾸지 않는다.
  assert.match(worker, /'XION 일정 알림'/);
  assert.match(worker, /확인할 일정이 있어\. 앱에서 내용을 확인해줘\./);
  assert.match(worker, /icon: '\/lib\/icons\/Xion\/xion-app-icon-192\.png'/);
  assert.match(worker, /badge: '\/lib\/icons\/Xion\/xion-mark\.svg'/);
  assert.doesNotMatch(worker, /Claude_code_pet/);
  assert.match(worker, /`task-reminder:\$\{safeInt\(payload\.reminderId\) \?\? 'unknown'\}`/);
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
  // 리마인더를 그리는 쪽은 에이전트 탭 하나다. 알림 탭이 그 렌더러나 목록을
  // 가져다 쓰면 같은 일정이 두 화면에 서게 된다.
  assert.doesNotMatch(notificationPanel, /TaskPanel\.makeReminderCard|TaskPanel\.render|TaskPanel\.refresh/);
  // 예외는 일정 후보 카드뿐이다. 메일에서 일정을 만드는 자리가 알림 탭 카드인데,
  // 거기서도 같은 컴포넌트를 써야 저장이 기존 task API 한 경로로 남는다(설계 15).
  assert.match(notificationPanel, /TaskPanel\?\.makeScheduleCandidateCard/);
  assert.doesNotMatch(taskPanel, /\/api\/notifications\/.+\/(?:approve|ignore)/);
  assert.match(taskPanel, /\/api\/reminders\/\$\{item\.reminderId\}\/acknowledge/);
  assert.match(taskPanel, /\/api\/reminders\/\$\{item\.reminderId\}\/snooze/);
  assert.match(taskPanel, /const snoozeRequestKey = makeRequestKey\('web-snooze'\)/);
});

test('chat schedule candidates remain unpersisted until the existing task API confirms them', () => {
  const app = read('public/app.js');
  const taskPanel = read('public/task-panel.js');
  const server = read('server.js');
  const css = read('public/style.css');

  assert.match(server, /createSchedulePrepareSession\(assistantTasks/);
  // 라우트가 출처 정책을 정하고 공통 턴 코어가 일정 후보와 함께 저장을 차단한다.
  assert.match(server, /allowAutoTopic: source !== 'voice'/);
  // 임시 첨부 경계는 문서 도구 후보와 이미지 입력을 함께 본다.
  assert.match(server, /const hasTemporaryAttachmentContext = attachmentToolSession\.hasTemporaryCandidates\s*\|\| attachmentImages\.hasTemporaryImages\(/);
  assert.match(server, /if \(!scheduleCandidate && allowAutoTopic && !hasTemporaryAttachmentContext\) \{[\s\S]*?autoAppendTopicNote/);
  assert.match(server, /scheduleCandidate,/);
  assert.match(app, /TaskPanel\?\.makeScheduleCandidateCard\(data\.scheduleCandidate\)/);
  assert.match(app, /if \(candidateCard\) \{[\s\S]*?group\.appendChild\(candidateCard\)[\s\S]*?return;/);
  assert.match(taskPanel, /const payload = JSON\.parse\(JSON\.stringify\(input\)\)/);
  assert.match(taskPanel, /request\('\/api\/tasks', \{ method: 'POST', body: JSON\.stringify\(payload\) \}\)/);
  assert.match(taskPanel, /function runCancel\(\) \{[\s\S]*?actions\.remove\(\)[\s\S]*?등록하지 않았어/);
  assert.match(taskPanel, /const cancel = actionButton\('취소', runCancel\)/);
  assert.match(taskPanel, /const confirm = actionButton\('등록', runConfirm, true\)/);
  assert.match(taskPanel, /아직 저장되지 않았어/);
  // 음성은 자기 요청을 만들지 않고 버튼과 똑같은 핸들러를 부른다.
  assert.match(taskPanel, /state\.pendingCandidate = \{[\s\S]*?confirm: runConfirm,[\s\S]*?cancel: runCancel,/);
  assert.match(app, /pendingConfirmation: \(\) => window\.TaskPanel\?\.getPendingScheduleConfirmation\(\)/);
  assert.match(css, /\.task-candidate-card\s*{[^}]*border-left: 3px solid var\(--brand\)/s);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.task-candidate-actions \.task-action\s*{[^}]*min-height: 44px/s);
});

test('agent shell delegates writes to TaskPanel and inserts task text as text content', () => {
  const agentPanel = read('public/agent-panel.js');
  const taskPanel = read('public/task-panel.js');

  assert.match(agentPanel, /state\.apiFetch\(`\/api\/tasks\/summary/);
  assert.doesNotMatch(agentPanel, /\/api\/tasks[^'`]*['`][\s\S]{0,120}method:\s*'(?:POST|PUT|PATCH|DELETE)'/);
  assert.match(agentPanel, /\/api\/models\/refresh[\s\S]*?method: 'POST'/);
  assert.match(agentPanel, /\/api\/settings\/codex-models[\s\S]*?method: 'PUT'/);
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

  assert.match(css, /\.notification-tabs\s*{[^}]*repeat\(5, 1fr\)/s);
  assert.match(css, /\.task-view-tabs\s*{[^}]*display: flex[^}]*border-bottom:/s);
  assert.match(css, /:root\s*{[^}]*--bg:\s*#F3F5F2[^}]*--brand:\s*#2F6B57[^}]*--brand-ink:\s*#2F6B57/s);
  assert.match(css, /\[data-theme="dark"\]\s*{[^}]*--bg:\s*#151A18[^}]*--brand-ink:\s*#7FB99F/s);
  assert.match(css, /\.task-view-tab\.active\s*{[^}]*border-bottom-color: var\(--brand-ink\)/s);
  assert.doesNotMatch(css, /217, 119, 87|var\(--claude-color\)/);
  assert.match(css, /\.task-card\s*{[^}]*border-bottom: 1px solid var\(--border\)[^}]*background: transparent/s);
  assert.match(css, /\.schedule-agent-week\s*{[^}]*repeat\(7, minmax\(0, 1fr\)\)/s);
  assert.match(css, /\.schedule-agent-calendar-track\s*{[^}]*width: 300%/s);
  assert.match(css, /\.schedule-agent-calendar-viewport\s*{[^}]*scroll-snap-type: x mandatory/s);
  assert.match(css, /#agent-panel-content\s*{[^}]*display: flex;[^}]*flex-direction: column;[^}]*overflow-y: auto/s);
  assert.match(css, /#agent-panel-content > \*\s*{[^}]*flex: 0 0 auto;[^}]*min-width: 0/s);
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

// ─── 일정 후보 카드의 음성 확인 수명 ──────────────────────────────────────

function loadTaskPanel({ apiFetch } = {}) {
  function element(tag) {
    const node = {
      tagName: tag,
      children: [],
      classList: {
        list: new Set(),
        add(...names) { names.forEach(n => this.list.add(n)); },
        remove(...names) { names.forEach(n => this.list.delete(n)); },
        contains(n) { return this.list.has(n); },
      },
      attributes: {},
      listeners: {},
      textContent: '',
      hidden: false,
      disabled: false,
      setAttribute(k, v) { this.attributes[k] = v; },
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      append(...nodes) { this.children.push(...nodes); },
      remove() {},
    };
    return node;
  }

  const win = {
    document: { createElement: element },
    Headers: class { constructor() { this.map = {}; } set(k, v) { this.map[k] = v; } },
  };
  vm.runInNewContext(read('public/task-panel.js'), {
    window: win, document: win.document, Headers: win.Headers,
    Object, JSON, String, Number, Date, Math, Promise, Error, Array, Set, Intl, console,
  }, { filename: 'task-panel.js' });

  win.TaskPanel.init({
    apiFetch: apiFetch || (async () => ({ ok: true, async json() { return {}; } })),
    showToast: () => {},
    onChanged: () => {},
    enabled: true,
  });
  return win.TaskPanel;
}

const CANDIDATE = {
  task: {
    clientRequestId: 'req-1',
    title: '할머니집 가기',
    detail: '',
    due: { kind: 'datetime', at: '2026-08-01T11:00:00+09:00' },
    reminderAt: null,
  },
};

test('a fresh candidate card is offered to voice and released once it is answered', async () => {
  const posts = [];
  const panel = loadTaskPanel({
    async apiFetch(path, options) {
      posts.push({ path, body: JSON.parse(options.body) });
      return { ok: true, async json() { return { task: { id: 1 } }; } };
    },
  });

  assert.equal(panel.getPendingScheduleConfirmation(), null);
  panel.makeScheduleCandidateCard(CANDIDATE);

  const pending = panel.getPendingScheduleConfirmation();
  assert.equal(pending.id, 'req-1');
  assert.equal(pending.title, '할머니집 가기');

  await pending.confirm();
  // 같은 clientRequestId로 기존 task API를 한 번만 부른다.
  assert.equal(posts.length, 1);
  assert.equal(posts[0].path, '/api/tasks');
  assert.equal(posts[0].body.clientRequestId, 'req-1');
  // 답을 받은 카드는 더 이상 음성 확인 대상이 아니다. 남으면 다음 "응"이 또 등록한다.
  assert.equal(panel.getPendingScheduleConfirmation(), null);
});

test('cancelling by voice releases the card without calling the task API', () => {
  const posts = [];
  const panel = loadTaskPanel({
    async apiFetch(path) { posts.push(path); return { ok: true, async json() { return {}; } }; },
  });

  panel.makeScheduleCandidateCard(CANDIDATE);
  panel.getPendingScheduleConfirmation().cancel();

  assert.deepEqual(posts, []);
  assert.equal(panel.getPendingScheduleConfirmation(), null);
});

test('a failed registration keeps the card so it can be pressed again', async () => {
  const panel = loadTaskPanel({
    async apiFetch() { return { ok: false, status: 500, async json() { return { error: '서버 오류' }; } }; },
  });

  panel.makeScheduleCandidateCard(CANDIDATE);
  const pending = panel.getPendingScheduleConfirmation();
  await assert.rejects(() => pending.confirm());
  // 실패는 해제하지 않는다. 사용자가 화면에서 다시 누를 수 있어야 한다.
  assert.equal(panel.getPendingScheduleConfirmation()?.id, 'req-1');
});

test('a newer candidate replaces the one still waiting', () => {
  const panel = loadTaskPanel();
  panel.makeScheduleCandidateCard(CANDIDATE);
  panel.makeScheduleCandidateCard({ task: { ...CANDIDATE.task, clientRequestId: 'req-2' } });
  assert.equal(panel.getPendingScheduleConfirmation().id, 'req-2');
});

test('the recurrence tab and its controls stay behind the series flag', () => {
  const taskSource = read('public/task-panel.js');
  const appSource = read('public/app.js');
  const css = read('public/style.css');

  // 반복 탭은 반복 플래그가 켜져 있을 때만 생긴다.
  assert.match(taskSource, /\[['"]series['"], ['"]반복['"]\]/);
  assert.match(taskSource, /\.filter\(\(\[value\]\) => value !== 'series' \|\| state\.seriesEnabled\)/);
  assert.match(taskSource, /state\.seriesEnabled = state\.enabled && seriesEnabled === true;/);
  assert.match(appSource, /taskSeriesEnabled = config\.taskSeriesEnabled === true;/);
  assert.match(appSource, /seriesEnabled: taskSeriesEnabled,/);

  // 규칙 넷이 모두 작성 카드에 있다.
  assert.match(taskSource, /\['daily', '매일'\], \['weekdays', '평일'\]/);
  assert.match(taskSource, /\['weekly', '매주 요일'\], \['monthly', '매월 n일'\]/);

  // 회차 날짜 계산은 클라이언트에 두지 않는다. 규칙 엔진이 두 벌이 되면 안 된다.
  assert.doesNotMatch(taskSource, /occurrenceDatesBetween|nextOccurrenceDates/);

  // 이미 만들어진 단발 일정을 반복으로 바꾸는 길은 열지 않는다.
  assert.match(taskSource, /const canRecur = !task;/);

  assert.match(css, /\.task-series-badge \{/);
  assert.match(css, /\.task-weekday \{/);
});

test('occurrence edits and cancels ask for their scope before they apply', () => {
  const taskSource = read('public/task-panel.js');

  assert.match(taskSource, /function chooseScope\(actions, \{ thisLabel, seriesLabel, onThis, onSeries \}\)/);
  assert.match(taskSource, /thisLabel: '이번 회차만',\s*\n\s*seriesLabel: '이후 전체',/);
  assert.match(taskSource, /thisLabel: '이번 회차 건너뛰기',\s*\n\s*seriesLabel: '반복 종료',/);
  assert.match(taskSource, /actionButton\('되돌리기', \(\) => actions\.replaceChildren\(\.\.\.previous\)\)/);

  // 이번 회차만 고치는 길은 기존 task API 그대로다.
  assert.match(taskSource, /onThis: \(\) => renderComposer\(state\.container, task\)/);
  assert.match(taskSource, /onThis: event => mutateTask\(task, 'cancel', event\.currentTarget\)/);
  // 이후 전체는 시리즈 API로 간다.
  assert.match(taskSource, /onSeries: \(\) => openSeriesEditor\(task\.series\.id\)/);
  assert.match(taskSource, /onSeries: \(\) => endSeries\(task\.series\.id\)/);
  assert.match(taskSource, /\/api\/task-series\/\$\{series\.id\}\/end/);
});

// 작성자 스타일의 display는 UA의 `[hidden] { display: none }`을 이긴다.
// .task-form-field가 display:grid라서 hidden 지정이 한 번도 먹지 않았고,
// 마감이 '없음'인데도 날짜 칸이 계속 보였다.
test('hidden fields in the task form actually disappear', () => {
  const css = read('public/style.css');
  assert.match(css, /\.task-form \[hidden\] \{\s*\n\s*display: none;/);
});

test('recurrence and override candidates stay unpersisted until the card is pressed', () => {
  const taskSource = read('public/task-panel.js');
  const voiceSource = read('public/voice/halfduplex.js');

  // 카드 종류는 셋이고 각각 자기 API로만 간다.
  assert.match(taskSource, /if \(candidate\?\.kind === 'series'\) return makeSeriesCandidateCard\(candidate\);/);
  assert.match(taskSource, /if \(candidate\?\.kind === 'override'\) return makeOverrideCandidateCard\(candidate\);/);
  assert.match(taskSource, /heading: '반복 일정 등록 전 확인'/);
  assert.match(taskSource, /heading: '일정 변경 전 확인'/);
  assert.match(taskSource, /confirmLabel: '적용'/);

  // 부르는 경로는 서버가 준 문자열이 아니라 action에서만 나온다.
  assert.match(taskSource, /const plans = \{/);
  assert.match(taskSource, /\/api\/tasks\/\$\{payload\.taskId\}\/cancel/);
  assert.match(taskSource, /\/api\/task-series\/\$\{payload\.seriesId\}\/end/);
  assert.doesNotMatch(taskSource, /request\(payload\.(path|url|request)/);

  // 반복이 꺼져 있으면 두 카드 모두 그리지 않는다.
  assert.match(taskSource, /if \(\s*\n?\s*!state\.seriesEnabled \|\| !input/);

  // 음성이 카드의 주 버튼 이름을 받아야 한다.
  assert.match(voiceSource, /'적용', '적용해', '적용해줘'/);
  assert.match(voiceSource, /const COMMAND_STEMS = \['등록', '저장', '적용'\];/);
});

test('the override tool points at ids from the schedule context, never at titles', () => {
  const toolSource = read('lib/assistant-schedule-tools.js');
  const notesSource = read('lib/assistant-schedule-notes.js');

  assert.match(toolSource, /name: 'schedule_override_prepare'/);
  assert.match(toolSource, /enum: \['skip', 'reschedule', 'series_update', 'end'\]/);
  assert.match(toolSource, /Take it from the \[#id\] marker in <schedule>/);
  assert.match(toolSource, /제목만 보고 짐작하지 않으며, 어느 회차인지 하나로 정해지지 않으면 호출하지 말고 되묻는다/);
  assert.match(toolSource, /둘 중 무엇인지 분명하지 않으면 도구를 호출하지 말고 되묻는다/);
  // schedule_prepare의 기존 경계는 그대로다.
  assert.match(toolSource, /기존 일정 조회, 과거 일정 질문, 일정 추천, 수정, 완료, 취소, 삭제 요청에는 호출하지 않는다/);
  assert.match(notesSource, /\[#\$\{task\.id\}\]/);
});

test('the librarian block can run the queue without waiting for the auto threshold', () => {
  const agentSource = read('public/agent-panel.js');

  assert.match(agentSource, /state\.apiFetch\('\/api\/organize\/status'\)/);
  assert.match(agentSource, /async function organizeQueuedNotes\(\)/);
  assert.match(agentSource, /'\/api\/organize\/queue', \{\s*\n\s*method: 'POST'/);
  assert.match(agentSource, /button\(\s*\n?\s*state\.organizeRunning \? '시작하는 중…' : '대기열 정리'/);
  // 누를 것이 없으면 못 누른다.
  assert.match(agentSource, /organizeButton\.disabled = state\.organizeRunning \|\| state\.codexSaving \|\| !canOrganize;/);
  // 실패 뒤 멈춰 밀려 있는 job도 이 버튼이 다시 돌린다.
  assert.match(agentSource, /const canOrganize = queueable > 0 \|\| waitingJobs > 0;/);
  assert.match(agentSource, /밀려 있는 정리 \$\{waitingJobs\}건/);
  // 지난 실패로 멈춘 노트가 있으면 그 사실을 숫자로 말한다.
  assert.match(agentSource, /그중 \$\{stranded\}개는 지난 실패로 멈춤/);
  // 정리 상태를 못 읽어도 모델 설정은 계속 쓸 수 있어야 한다.
  assert.match(agentSource, /state\.organize = organizeResponse\.ok/);
});

// 검증 실패는 본문을 건드리지 않고 끝난다. 사람이 열어봐야 고칠 것이 없으므로
// "수동 확인"만 내밀면 할 수 있는 일이 없다. 이유를 보여주고 다시 돌리게 한다.
test('a stalled note shows why it stopped and offers a retry', () => {
  const notificationSource = read('public/notification-panel.js');
  const agentSource = read('public/agent-panel.js');
  const serverSource = read('server.js');

  assert.match(notificationSource, /notification-reasons/);
  assert.match(notificationSource, /item\.retryable \? '재정리' : '확인 완료'/);
  assert.match(notificationSource, /async function retryNote\(item, card\)/);
  assert.match(notificationSource, /'\/api\/organize\/retry'/);
  // 다시 돌려도 안 되면 그냥 정리된 것으로 두는 길을 남긴다.
  assert.match(notificationSource, /settle\.textContent = '정리된 것으로 두기';/);

  // 원본이 위태로운 상태에는 재정리를 주지 않는다.
  assert.match(serverSource, /retryable: !recoveryRequired && !blocked,/);
  // 복구가 필요한 노트가 있으면 정리 전체가 멈추므로 재정리를 내밀지 않는다.
  assert.match(serverSource, /const blocked = hasCodexRecoveryRequired\(\);/);
  assert.match(serverSource, /reasons: recoveryRequired \|\| !note\.codexLastError/);
  assert.match(serverSource, /codex_status = 'needs_manual_check'/);

  // pending으로 되돌리는 것만으로는 아무것도 돌지 않는다. worker는 밀린 job을 찾을
  // 뿐이고 자동 큐는 문턱을 기다린다. 되돌리기와 job 생성이 같은 transaction이어야
  // "다시 정리한다"가 실제로 성립한다.
  assert.match(serverSource, /return createCodexJobRecordFromPending\(\);\s*\n\s*\}\)\(\);/);

  // 같은 이유로 여러 개가 멈추면 한 번에 돌린다.
  assert.match(agentSource, /async function retryStalledNotes\(\)/);
  assert.match(agentSource, /`멈춘 \$\{stalled\}개 다시`/);
});
