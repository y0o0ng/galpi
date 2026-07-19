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

test('task and agent browser modules load before the panel shell and expose narrow APIs', () => {
  const html = read('public/index.html');
  const taskSource = read('public/task-panel.js');
  const agentSource = read('public/agent-panel.js');
  const taskIndex = html.indexOf('<script src="task-panel.js"></script>');
  const agentIndex = html.indexOf('<script src="agent-panel.js"></script>');
  const paperIndex = html.indexOf('<script src="paper-panel.js"></script>');
  const appIndex = html.indexOf('<script src="app.js"></script>');

  assert.match(html, /id="agent-panel-content" aria-live="polite"/);
  assert.ok(taskIndex > 0 && taskIndex < agentIndex);
  assert.ok(agentIndex < paperIndex && paperIndex < appIndex);

  const taskWindow = {};
  vm.runInNewContext(taskSource, { window: taskWindow }, { filename: 'task-panel.js' });
  assert.deepEqual(Object.keys(taskWindow.TaskPanel).sort(), ['init', 'makeReminderCard', 'refresh', 'render']);
  const agentWindow = {};
  vm.runInNewContext(agentSource, { window: agentWindow }, { filename: 'agent-panel.js' });
  assert.deepEqual(Object.keys(agentWindow.AgentPanel).sort(), ['init', 'refresh', 'show']);
});

test('runtime flag hides task entry points and foreground refresh stays separate from chat polling', () => {
  const app = read('public/app.js');

  assert.match(app, /tasksEnabled = config\.tasksEnabled === true/);
  assert.match(app, /command\.feature !== 'tasks' \|\| tasksEnabled/);
  assert.match(app, /\.\.\.\(tasksEnabled \? \[\['task', '할 일'\]\] : \[\]\)/);
  assert.match(app, /setInterval\(refreshTaskViews, 60_000\)/);
  assert.match(app, /document\.visibilityState !== 'visible'/);
  assert.match(app, /document\.addEventListener\('visibilitychange'/);
  assert.match(app, /setInterval\(pollForUpdates, 7000\)/);
});

test('task reminders use the dedicated renderer and never enter Codex decisions', () => {
  const app = read('public/app.js');
  const taskPanel = read('public/task-panel.js');
  const dedicatedBranch = app.indexOf("item.type === 'task_reminder'");
  const genericCard = app.indexOf("card.className = `notification-card type-${item.type || 'review'}`");

  assert.ok(dedicatedBranch > 0 && dedicatedBranch < genericCard);
  assert.doesNotMatch(taskPanel, /\/api\/notifications\/.+\/(?:approve|ignore)/);
  assert.match(taskPanel, /\/api\/reminders\/\$\{item\.reminderId\}\/acknowledge/);
  assert.match(taskPanel, /\/api\/reminders\/\$\{item\.reminderId\}\/snooze/);
  assert.match(taskPanel, /const snoozeRequestKey = makeRequestKey\('web-snooze'\)/);
});

test('agent summary is read-only and task text is inserted as text content', () => {
  const agentPanel = read('public/agent-panel.js');
  const taskPanel = read('public/task-panel.js');

  assert.match(agentPanel, /state\.apiFetch\('\/api\/tasks\/summary'\)/);
  assert.doesNotMatch(agentPanel, /method:\s*'(?:POST|PATCH|DELETE)'/);
  assert.doesNotMatch(agentPanel, /innerHTML\s*=\s*(?:message|data|item|task|error)/);
  assert.doesNotMatch(taskPanel, /innerHTML\s*=\s*(?:message|data|item|task|error)/);
  assert.match(taskPanel, /title\.textContent = task\.title/);
  assert.match(agentPanel, /title\.textContent = task\.title \|\| '제목 없는 일정'/);
  assert.doesNotMatch(`${taskPanel}\n${agentPanel}`, /[—–]/);
});

test('schedule layout preserves the five task views and mobile action targets', () => {
  const css = read('public/style.css');

  assert.match(css, /#notification-center\.tasks-enabled \.notification-tabs\s*{[^}]*repeat\(5, 1fr\)/s);
  assert.match(css, /\.task-view-tabs\s*{[^}]*repeat\(5, 1fr\)/s);
  assert.match(css, /\.schedule-agent-week\s*{[^}]*repeat\(7, minmax\(0, 1fr\)\)/s);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.task-action\s*{[^}]*min-height: 44px/s);
  assert.match(css, /\.schedule-agent-action\s*{[^}]*min-height: 44px/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.task-panel-skeleton span/s);
});
