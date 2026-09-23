'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');

test('model picker formats unknown and known GPT families without tier-specific names', () => {
  const source = fs.readFileSync(path.join(ROOT, 'public/model-picker.js'), 'utf8');
  const helper = source.slice(source.indexOf('function displayModelName('), source.indexOf('function close('));
  const display = vm.runInNewContext(`(${helper.trim()})`);
  for (const [id, label] of [
    ['gpt-6-astra', 'GPT-6 Astra'], ['gpt-5.6-sol', 'GPT-5.6 Sol'],
    ['gpt-5.6-terra', 'GPT-5.6 Terra'], ['gpt-5.6-luna', 'GPT-5.6 Luna'],
    ['gpt-9-future-family', 'GPT-9 Future Family'],
  ]) assert.equal(display(id), label);
});

// 미디어 쿼리는 중첩 중괄호를 담으므로 괄호를 세서 잘라낸다.
function blockAt(text, start) {
  assert.ok(start >= 0, '규칙 블록을 찾지 못했다');
  const open = text.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    else if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open, index + 1);
    }
  }
  throw new Error('닫히지 않은 규칙 블록');
}

function allBlocks(text, selector) {
  const blocks = [];
  for (let at = text.indexOf(selector); at >= 0; at = text.indexOf(selector, at + 1)) {
    blocks.push(blockAt(text, at));
  }
  assert.ok(blocks.length, `${selector} 블록을 찾지 못했다`);
  return blocks;
}

test('markdown bubbles turn off the plain-text whitespace rule', () => {
  // .bubble은 평문 줄바꿈을 살리려고 pre-wrap이다. 그 아래에 마크다운 HTML을 넣으면
  // 블록 사이 개행까지 빈 줄이 돼 같은 답변이 두 배 길어진다(실측 504px → 276px).
  assert.match(css, /\.bubble \{[^}]*white-space: pre-wrap/s);
  assert.match(css, /\.bubble\.md \{[^}]*white-space: normal/s);
});

test('bubble markdown keeps intentional line breaks when pre-wrap is off', () => {
  // pre-wrap을 끄면 문단 안의 개행이 공백으로 뭉개진다. breaks가 그걸 <br>로 남긴다.
  // 둘은 반드시 함께 간다. 하나만 있으면 답변이 길어지거나 줄바꿈이 사라진다.
  assert.match(app, /function renderBubbleMarkdown\(text\)/);
  assert.match(app, /marked\.parse\(String\(text \?\? ''\), \{ breaks: true \}\)/);

  // 말풍선은 전부 이 경로를 쓴다. 직접 marked.parse를 부르면 breaks가 빠진다.
  const direct = app.match(/bubble\.innerHTML = DOMPurify\.sanitize\(marked\.parse/g);
  assert.equal(direct, null, '말풍선이 renderBubbleMarkdown을 우회한다');
});

test('/archive renders search candidates with the shared note card', () => {
  assert.match(
    app,
    /results\.forEach\(note => wrap\.appendChild\(makeNoteCard\(note\)\)\)/,
  );
  assert.doesNotMatch(app, /renderNoteCard\(/);
});

test('every composer action keeps a 44px touch target', () => {
  assert.match(css, /#attachment-button \{[^}]*min-height: 44px/s);
  const mobile = allBlocks(css, '@media (max-width: 640px)').join('\n');
  assert.match(mobile, /#assistant-tools-toggle \{[^}]*width: 44px;[^}]*height: 44px/s);
  assert.match(mobile, /#chat-model-button \{[^}]*height: 44px/s);
  assert.match(
    mobile,
    /#send-btn,\s*#voice-hd-button \{[^}]*width: 44px;[^}]*height: 44px/s,
  );
});

test('desktop floats the composer without changing the mobile bottom bar', () => {
  const desktop = allBlocks(css, '@media (min-width: 641px)').join('\n');
  assert.match(desktop, /#input-area \{[^}]*border-top-color: transparent;[^}]*background: transparent;[^}]*box-shadow: none/s);
  assert.match(desktop, /#composer-shell \{[^}]*border-radius: 24px;[^}]*box-shadow:/s);

  const mobile = allBlocks(css, '@media (max-width: 640px)').join('\n');
  assert.match(mobile, /#input-area \{[^}]*padding-block: 8px max\(10px, env\(safe-area-inset-bottom\)\)/s);
  assert.match(mobile, /#composer-toolbar \{[^}]*min-height: 50px/s);
});

test('the two-row composer keeps attachments in the plus menu and one primary action', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.match(html, /id="attachment-input"[^>]*type="file"[^>]*hidden/);
  assert.match(html, /id="attachment-button"[^>]*aria-label="파일 첨부"[^>]*hidden/);
  assert.ok(html.indexOf('id="assistant-tools-menu"') < html.indexOf('id="attachment-button"'));
  assert.ok(html.indexOf('id="attachment-button"') < html.indexOf('id="composer-primary-action"'));
  assert.ok(html.indexOf('attachment-ui.js') < html.indexOf('app.js'));
  assert.match(app, /appendUserBubble\(msg\.content, msg\.attachments\)/);
  assert.match(app, /attachmentIds: draftAttachments\.map\(attachment => attachment\.attachmentId\)/);
  assert.match(app, /useComposerDraft: true/);
  assert.match(app, /const usesComposerDraft = options\.overrideText == null \|\| options\.useComposerDraft === true/);
  assert.match(css, /#composer-shell \{[^}]*display: grid/s);
  assert.match(css, /#composer-toolbar \{[^}]*justify-content: space-between/s);
  assert.doesNotMatch(css, /@media \(max-width: 360px\) \{[\s\S]*?#input-area \{[\s\S]*?flex-wrap: wrap/s);
});

test('empty input offers half-duplex voice and typed input offers send', () => {
  assert.match(app, /function updateComposerPrimaryAction\(\)/);
  assert.match(app, /const hasText = input\.value\.trim\(\)\.length > 0/);
  assert.match(app, /const voiceAvailable = voice\.dataset\.available === 'true'/);
  assert.match(app, /const showVoice = voiceAvailable && \(!hasText \|\| voiceActive\)/);
  assert.match(app, /voice\.hidden = !showVoice;\s*send\.hidden = showVoice/s);
  assert.match(app, /addEventListener\('input',[\s\S]*?updateComposerPrimaryAction\(\)/);
});

test('half-duplex voice uses the XION mark without shrinking its touch target', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.match(
    html,
    /id="voice-hd-button"[\s\S]*?<span class="composer-action-disc"[^>]*>[\s\S]*?<span class="xion-mark-icon"><\/span>/,
  );
  assert.doesNotMatch(html, /composer-voice-wave/);
  assert.match(css, /\.composer-action-disc \{[^}]*width: 36px;[^}]*height: 36px/s);
  assert.match(css, /\.composer-action-disc \.xion-mark-icon \{[^}]*width: 26px;[^}]*height: 26px/s);

  const mobile = allBlocks(css, '@media (max-width: 640px)').join('\n');
  assert.match(mobile, /\.composer-action-disc \{[^}]*width: 38px;[^}]*height: 38px/s);
});

test('voice and send share one disc so the primary action does not jump', () => {
  // 두 상태가 같은 슬롯을 쓴다. 지름이 다르면 첫 글자를 치는 순간 원이 커지며 밀린다.
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.match(html, /id="send-btn"[\s\S]*?<span class="composer-action-disc"[^>]*>[\s\S]*?<svg/);
  assert.match(css, /#send-btn,\s*#voice-hd-button \{[^}]*background: transparent;[^}]*box-shadow: none/s);
  assert.doesNotMatch(css, /body\[data-active-model="[^"]+"\] #send-btn/);
});

test('turns are spaced wider than the paragraphs inside one answer', () => {
  // 턴 사이가 문단 사이(10px)보다 좁으면 대화가 하나의 긴 문서처럼 뭉쳐 읽힌다.
  assert.match(css, /#messages \{[^}]*gap: 20px/s);
  assert.match(css, /\.bubble\.md p \{[^}]*margin: 0 0 10px/s);
  // 간격은 #messages 한 곳에서만 준다. .msg-group에 margin이 다시 붙으면 두 값이 더해진다.
  assert.doesNotMatch(css, /\.msg-group \{[^}]*margin-bottom/s);
});

test('control radii keep one step instead of three values a pixel apart', () => {
  // 집중 노트 목록의 8px은 Figma 값이고, 나머지 공통 컨트롤은 기존 단계를 유지한다.
  assert.match(css, /\.home-card-notes\.focused \.note-library-card,[^}]*border-radius: 8px;/s);
  assert.doesNotMatch(css, /border-radius: 9px;/);
  // 40px 컨트롤은 옆의 원과 같은 가족이 되도록 높이의 절반을 쓴다.
  assert.match(css, /#chat-model-button \{[^}]*height: 40px;[^}]*border-radius: 20px/s);
  // #input은 배경이 투명하다. radius를 주면 화면에 안 보이면서 shell 값과만 어긋난다.
  assert.doesNotMatch(css, /#input \{[^}]*border-radius/s);
});

test('the composer rows start and end on the same vertical lines', () => {
  // 위 입력줄 글자선과 아래 도구줄이 어긋나면 두 줄이 다른 상자처럼 보인다.
  // 버튼 안에서 글리프는 (40-20)/2, 원은 (40-36)/2 들어가므로 좌우 padding이 다르다.
  assert.match(css, /#input \{[^}]*padding: 11px 14px 4px/s);
  assert.match(css, /#composer-toolbar \{[^}]*padding: 0 12px 5px 4px/s);

  const mobile = allBlocks(css, '@media (max-width: 640px)').join('\n');
  assert.match(mobile, /#input \{[^}]*padding: 12px 18px 5px/s);
  assert.match(mobile, /#composer-toolbar \{[^}]*padding: 1px 15px 5px 6px/s);
});

test('the model chevron is drawn, not typed, so its ink centers with the label', () => {
  // U+2304는 잉크가 em 상자 아래쪽에 몰려 있다. flex 중앙 정렬은 상자를 맞출 뿐이라
  // 닫힌 상태에서 4.5px 낮게, rotate(180deg)한 열린 상태에서는 그만큼 높게 보였다.
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.doesNotMatch(html, /⌄/);
  assert.match(html, /<svg class="chat-model-chevron"[^>]*viewBox="0 0 24 24"/);
  // 잉크 y 9~15는 viewBox 중심 12를 기준으로 대칭이라 180도 뒤집어도 중심이 유지된다.
  assert.match(html, /class="chat-model-chevron"[\s\S]*?<polyline points="6 9 12 15 18 9">/);
  assert.match(css, /\.chat-model-chevron \{[^}]*display: block/s);
  assert.doesNotMatch(css, /\.chat-model-chevron \{[^}]*font-size/s);
});

test('the codex agent card keeps three type steps, not four half-pixel ones', () => {
  // 10 / 10.5 / 11 / 11.5px은 위계가 아니라 어긋남으로 읽힌다. 9 · 11 · 17만 쓴다.
  assert.match(css, /\.schedule-agent-kicker \{[^}]*font-size: 9px;[^}]*font-weight: 700/s);
  assert.match(css, /\.schedule-agent-head h2 \{[^}]*font-size: 17px/s);
  for (const rule of [
    /\.codex-agent-description,\s*\.codex-agent-message \{[^}]*font-size: 11px/s,
    /\.codex-model-field > span \{[^}]*font-size: 11px/s,
    /\.codex-model-field select \{[^}]*font: 600 11px/s,
    /\.schedule-agent-status \{[^}]*font-size: 11px/s,
    /\.schedule-agent-action \{[^}]*font: 650 11px/s,
  ]) assert.match(css, rule);
  assert.match(css, /\.codex-agent-block \{[^}]*padding: 16px/s);
});

test('the product shell exposes the four approved destinations on desktop and mobile', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const desktop = html.slice(html.indexOf('id="global-nav"'), html.indexOf('id="product-surface"'));
  const mobile = html.slice(html.indexOf('id="bottom-nav"'), html.indexOf('id="shared-panel-store"'));
  const routes = text => [...text.matchAll(/data-product-route="([a-z]+)"/g)].map(match => match[1]);
  assert.deepEqual(routes(desktop), ['home', 'chat', 'notes', 'home', 'settings']);
  assert.deepEqual(routes(mobile), ['home', 'chat', 'notes', 'settings']);
  assert.match(css, /#product-shell \{[^}]*grid-template-columns: 232px minmax\(0, 1fr\)/s);
  assert.match(css, /@media \(max-width: 1100px\)[\s\S]*?#bottom-nav \{[^}]*display: grid/s);
});

test('global Notes is a lecture-note placeholder while Chat keeps topic notes and papers', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const home = fs.readFileSync(path.join(ROOT, 'public/home.js'), 'utf8');
  const notesPage = html.slice(html.indexOf('id="notes-page"'), html.indexOf('id="settings-page"'));
  assert.match(notesPage, /강의 노트[\s\S]*준비 중/);
  assert.doesNotMatch(notesPage, /data-panel-tab|notes-page-views|note-panel|paper-panel/);
  assert.match(home, /if \(route !== 'home'\) parkSharedPanels\(\)/);
  assert.doesNotMatch(home, /if \(route === 'notes'\) global\.NotePanel\?\.show\(\)/);
  assert.match(html, /id="knowledge-panel"[\s\S]*id="note-panel"[\s\S]*id="paper-panel"/);
});

test('Home uses the approved 16-column geometry and responsive card flow', () => {
  assert.match(css, /#home-grid \{[^}]*grid-template-columns: repeat\(16, minmax\(0, 1fr\)\)[^}]*gap: 20px/s);
  assert.match(css, /\.home-card-weather \{ grid-column: 1 \/ span 4/);
  assert.match(css, /\.home-card-tasks \{ grid-column: 5 \/ span 7/);
  assert.match(css, /\.home-card-calendar \{ grid-column: 12 \/ span 5/);
  assert.match(css, /@media \(max-width: 1100px\)[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 360px\)\)/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?#home-grid \{[^}]*display: flex;[^}]*flex-direction: column/s);
  assert.match(css, /\.home-grid-left \{ grid-column: 1; \}/);
  assert.match(css, /\.home-grid-right \{ grid-column: 2; \}/);
  assert.match(css, /#home-grid \.home-card-calendar \{ height: 260px; \}/);
  assert.doesNotMatch(css, /\.home-card-calendar \{ grid-column: 1 \/ -1; grid-row: auto \/ span 2; \}/);
  assert.match(css, /#home-grid\.focus-calendar \.home-card-calendar \{ grid-area: 1 \/ 5 \/ span 2 \/ span 12; \}/);
  assert.match(css, /#home-grid\.focus-calendar \.home-card-lecture \{ grid-area: 3 \/ 3 \/ span 1 \/ span 7; \}/);
  assert.match(css, /#home-grid\.has-focus \.home-card\.focused:is\(\.home-card-calendar, \.home-card-mail, \.home-card-notes\) \{[^}]*grid-column-end: span 12/s);
});

test('phone focus keeps Calendar, Mail, and Notes in their Overview order', () => {
  const mobile = allBlocks(css, '@media (max-width: 640px)').join('\n');
  assert.match(mobile, /#home-grid\.has-focus \.home-card-calendar \{ order: 5 !important; \}/);
  assert.match(mobile, /#home-grid\.has-focus \.home-card-mail \{ order: 6 !important; \}/);
  assert.match(mobile, /#home-grid\.has-focus \.home-card-notes \{ order: 8 !important; \}/);
});

test('D-Day uses its own API and the pad/phone card leaves room below three rows', () => {
  const home = fs.readFileSync(path.join(ROOT, 'public/home.js'), 'utf8');
  assert.match(home, /state\.apiFetch\('\/api\/ddays'\)/);
  assert.match(home, /return state\.ddays\.map\(dday =>/);
  assert.doesNotMatch(home.slice(home.indexOf('function ddayItems()'), home.indexOf('function renderLecture()')), /TaskPanel|state\.tasks/);
  assert.match(css, /#home-grid \.home-card-dday \{ height: 190px; padding-bottom: 24px; \}/);
});

test('pad and phone hide only the Chat header and show web usage beside shell notifications', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const mobile = allBlocks(css, '@media (max-width: 1100px)').join('\n');
  assert.match(mobile, /#app #header \{ display: none; \}/);
  assert.match(mobile, /body\[data-product-route="chat"\] #shell-web-usage-pill \{ display: inline-flex/);
  assert.match(html, /id="shell-web-usage-pill"[\s\S]*?aria-label="알림 보기"/);
  assert.match(html, /id="shell-knowledge-panel-toggle"/);
  assert.match(css, /#mobile-shell-header #shell-knowledge-panel-toggle \{ display: none; \}/);
  assert.match(css, /body\[data-product-route="chat"\] #mobile-shell-header #shell-knowledge-panel-toggle \{ display: grid; \}/);
});

test('every desktop focus layout fits the original three-row Home canvas without overlap', () => {
  assert.match(css, /#home-grid\.has-focus \{ grid-template-rows: repeat\(3, 210px\); \}/);
  assert.match(css, /#home-grid\.has-focus\.focus-mail \{ grid-template-rows: 95px 440px 95px; \}/);
  const cards = ['weather', 'tasks', 'calendar', 'mail', 'notifications', 'dday', 'lecture', 'notes'];
  for (const focus of ['calendar', 'tasks', 'mail', 'notifications', 'dday', 'notes']) {
    const occupied = new Set();
    for (const card of cards) {
      const rule = css.match(new RegExp(`#home-grid\\.focus-${focus} \\.home-card-${card} \\{ grid-area: (\\d+) \\/ (\\d+)(?: \\/ span (\\d+) \\/ span (\\d+))?; \\}`));
      assert.ok(rule, `${focus}: ${card} has a position`);
      const row = Number(rule[1]), column = Number(rule[2]);
      const rowSpan = Number(rule[3] || 1), columnSpan = Number(rule[4] || 1);
      assert.ok(row + rowSpan <= 4 && column + columnSpan <= 17, `${focus}: ${card} stays inside 3 × 16`);
      for (let r = row; r < row + rowSpan; r++) for (let c = column; c < column + columnSpan; c++) {
        const cell = `${r}:${c}`;
        assert.ok(!occupied.has(cell), `${focus}: ${card} does not overlap at ${cell}`);
        occupied.add(cell);
      }
    }
  }
  for (const [card, row, column] of [
    ['calendar', 1, 5], ['tasks', 1, 5], ['mail', 2, 1],
    ['notifications', 2, 5], ['dday', 3, 1], ['notes', 2, 5],
  ]) {
    assert.match(css, new RegExp(`#home-grid\\.focus-${card} \\.home-card-${card} \\{ grid-area: ${row} \\/ ${column} \\/ span`));
  }
  for (const [card, row] of [['weather', 1], ['tasks', 1], ['calendar', 1], ['mail', 2], ['notifications', 2], ['dday', 3], ['lecture', 3], ['notes', 3]]) {
    assert.match(css, new RegExp(`#home-grid\\.focus-mail \\.home-card-${card} \\{ grid-area: ${row} \\/`));
  }
});

test('Home keeps one focus state and the platform-specific collapse contracts', () => {
  const home = fs.readFileSync(path.join(ROOT, 'public/home.js'), 'utf8');
  assert.match(home, /focusedCard: null/);
  assert.match(home, /notesView: 'notes'/);
  assert.doesNotMatch(home, /focused(?:Tasks|Calendar|Mail|Notifications|Dday|Notes):/);
  assert.match(home, /state\.focusedCard = nextCard;[\s\S]*?renderOverview\(\)/);
  assert.match(home, /if \(state\.focusedCard === 'notes'\) mountLibrary\(\)/);
  assert.match(home, /card\.animate\(\[/);
  assert.match(home, /prefers-reduced-motion: reduce/);
  assert.match(home, /grid\.querySelectorAll\('\.home-card'\)/);
  assert.match(home, /!event\.target\.closest\('\.home-card\.focused'\)[\s\S]*?collapseFocus\(\)/);
  assert.match(css, /#home-focus-collapse:not\(\[hidden\]\) \{[^}]*position: sticky/s);
  assert.match(css, /#home-grid\.focus-calendar \.home-card-calendar \{ grid-area: 1 \/ 5 \/ span 2 \/ span 12; \}/);
  assert.match(css, /#home-grid\.has-focus:is\(\.focus-calendar, \.focus-mail, \.focus-notes\) \.home-card\.focused \{[^}]*grid-column: 1 \/ -1;[^}]*height: 440px/s);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?#home-grid\.has-focus \{ display: flex; flex-direction: column; gap: 16px; \}/);
  assert.doesNotMatch(css, /has-spacer|focus-spacer-height/);
});

test('focused Tasks follows the Figma count, progress and list without extra form buttons', () => {
  const home = fs.readFileSync(path.join(ROOT, 'public/home.js'), 'utf8');
  const tasks = home.slice(home.indexOf('function renderTasks()'), home.indexOf('function kstDate('));
  assert.match(tasks, /home-task-progress/);
  assert.match(tasks, /state\.completedToday \/ progressTotal/);
  assert.doesNotMatch(tasks, /일정 추가|전체 일정/);
  assert.match(home, /\/api\/tasks\?view=history&status=done&limit=100/);
  assert.match(css, /#home-grid\.has-focus \.home-card\.focused:is\(\.home-card-tasks, \.home-card-notifications\) \{ height: 440px; \}/);
});

test('Home uses the Figma shell assets and the existing Notes and Mail controllers in focused cards', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const home = fs.readFileSync(path.join(ROOT, 'public/home.js'), 'utf8');
  const note = fs.readFileSync(path.join(ROOT, 'public/note-panel.js'), 'utf8');
  const paper = fs.readFileSync(path.join(ROOT, 'public/paper-panel.js'), 'utf8');
  const notifications = fs.readFileSync(path.join(ROOT, 'public/notification-panel.js'), 'utf8');
  for (const asset of ['galpi-logo.svg', 'bell.svg', 'moon.svg', 'more.svg', 'left.svg', 'nav-dot.svg', 'nav-active-dot.svg', 'task-open.svg', 'task-done.svg', 'calendar-today.svg', 'calendar-selected.svg', 'calendar-event-dot.svg']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'public/assets/figma', asset)));
  }
  assert.match(html, /assets\/figma\/galpi-logo\.svg/);
  assert.match(home, /host\.append\(note, paper\)/);
  assert.match(note, /function splitDetail\(\)/);
  assert.match(paper, /function splitDetail\(\)/);
  assert.match(notifications, /function makeMailCard\(item\)/);
  assert.match(notifications, /home-mail-workspace-list[\s\S]*?detail\.replaceChildren\(makeMailCard\(item\)\)/);
  assert.match(notifications, /home-mail-workspace-actions[\s\S]*?mailAction\(item, 'done'\)[\s\S]*?mailAction\(item, 'snooze'\)/);
  assert.match(css, /\.home-card-mail\.focused \.home-count-summary \{\s*display: block;/);
});

test('Home renders no News surface and requests no News briefing', () => {
  const home = fs.readFileSync(path.join(ROOT, 'public/home.js'), 'utf8');
  const panel = fs.readFileSync(path.join(ROOT, 'public/agent-panel.js'), 'utf8');
  const summaryRefresh = panel.slice(panel.lastIndexOf('renderLoading();'), panel.indexOf('function show()'));
  assert.doesNotMatch(home, /news|알아둘 것|\/api\/news\/briefing/i);
  assert.doesNotMatch(summaryRefresh, /loadNewsBriefing|\/api\/news\/briefing/);
});

test('Chat knowledge tabs are exactly Notes and Papers with Notes selected', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const tabs = html.slice(html.indexOf('id="knowledge-tabs"'), html.indexOf('id="knowledge-panel-close"'));
  assert.deepEqual([...tabs.matchAll(/data-panel-tab="([a-z]+)"/g)].map(match => match[1]), ['notes', 'papers']);
  const panel = fs.readFileSync(path.join(ROOT, 'public/paper-panel.js'), 'utf8');
  assert.match(panel, /activeTab: 'notes'/);
  assert.doesNotMatch(tabs, /agents|notifications/);
});

test('Calendar keeps the Figma month and compact weeks with one event marker per day', () => {
  const home = fs.readFileSync(path.join(ROOT, 'public/home.js'), 'utf8');
  assert.match(home, /selectedDate: null/);
  assert.match(home, /if \(task\?\.dueKind === 'date'\) return task\.dueDate \|\| ''/);
  assert.match(home, /const compactAnchor = state\.selectedDate \|\| today/);
  assert.match(home, /compactPairStart = Math\.max\(0, Math\.min\(compactWeek - 1,/);
  assert.match(home, /const mondayOffset = \(first\.getUTCDay\(\) \+ 6\) % 7/);
  assert.match(home, /length: weeks \* 7/);
  assert.match(home, /days\.length === 42 \? ' six-weeks' : ''/);
  assert.match(home, /outside-compact-week/);
  assert.match(home, /outside-compact-pair/);
  assert.match(home, /const hasEvent = state\.tasks\.some\(task => taskDate\(task\) === item\.key\)/);
  assert.match(home, /if \(hasEvent\) day\.append\(node\('i'/);
  assert.match(css, /\.calendar-day\.today \.calendar-day-number \{ background: url\('assets\/figma\/calendar-today\.svg'\)/);
  assert.match(css, /\.calendar-day\.selected:not\(\.today\) \.calendar-day-number \{[^}]*background: url\('assets\/figma\/calendar-selected\.svg'\)/);
  assert.match(css, /\.home-card-calendar:not\(\.focused\) \.calendar-day\.outside-compact-week \{[^}]*display: none/s);
  assert.match(css, /#home-grid:is\(\.focus-mail, \.focus-notes\) \.home-card-calendar \.calendar-day\.outside-compact-week \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 1100px\)[\s\S]*?\.home-card-calendar:not\(\.focused\) \.calendar-day\.outside-compact-pair \{ display: none; \}/);
  assert.match(css, /@media \(min-width: 641px\) and \(max-width: 1100px\) \{\s*#home-grid\.has-focus \{ grid-template-rows: none; \}/);
  assert.match(css, /#home-grid\.has-focus:is\(\.focus-calendar, \.focus-mail, \.focus-notes\) \.home-card\.focused \{\s*grid-row: auto;/);
  const compact = css.slice(css.lastIndexOf('@media (min-width: 641px)'));
  assert.match(compact, /@container \(max-width: 150px\)[\s\S]*?\.calendar-day\.selected:not\(\.today\) \.calendar-day-number \{ width: 18px; height: 18px; margin: 0; \}/);
  assert.match(compact, /@media \(max-width: 640px\)[\s\S]*?\.calendar-day\.selected:not\(\.today\) \.calendar-day-number \{\s*width: 15px;\s*height: 15px;/);
  assert.match(home, /node\('span', 'calendar-action-divider'\)/);
  assert.match(css, /grid-template-columns: minmax\(0, 287\.5px\) minmax\(0, 1fr\);\s*grid-template-rows: 24px minmax\(0, 1fr\);\s*column-gap: 41\.5px/s);
  assert.match(css, /grid-template-columns: 110px 1px 110px 1px 110px/);
  assert.match(css, /\.home-card-calendar\.focused \.calendar-agenda \{[^}]*padding-top: 31px/s);
});

test('focused Calendar follows the Figma selected, all-events, and add-event states', () => {
  const home = fs.readFileSync(path.join(ROOT, 'public/home.js'), 'utf8');
  const tasks = fs.readFileSync(path.join(ROOT, 'public/task-panel.js'), 'utf8');
  assert.match(home, /calendarView: 'selected'/);
  assert.match(home, /calendarPopup: false/);
  assert.match(home, /\['today', '오늘'\], \['upcoming', '예정'\], \['notifications', '알림'\], \['repeated', '반복'\], \['done', '종결'\]/);
  assert.match(home, /else setCalendarView\('selected'\)/);
  assert.match(home, /onCancel: closeCalendarEditor, onSaved: saveCalendarEditor/);
  assert.match(home, /state\.focusedCard === 'calendar' && state\.calendarPopup\)\) renderOverview\(\)/);
  assert.match(home, /global\.TaskPanel\?\.render\(host, \{ view \}\)/);
  assert.match(home, /global\.TaskPanel\.makeReminderCard\(item\)/);
  assert.match(tasks, /if \(onSaved\) onSaved\(\)/);
  assert.match(css, /\.home-card-calendar\.focused \.calendar-detail \{[^}]*grid-area: 1 \/ 2 \/ span 2/s);
  assert.match(css, /\.home-card-calendar\.focused \.calendar-detail \{ order: 3; flex: 1 1 auto;/);
});

test('focused Notes uses the Figma text selector in its card header', () => {
  const home = fs.readFileSync(path.join(ROOT, 'public/home.js'), 'utf8');
  assert.match(home, /article\.querySelector\('\.home-card-head'\)\.replaceChildren\(tabs,/);
  assert.match(home, /node\('span', 'home-library-divider'\)/);
  assert.match(home, /host\.closest\('\.home-card-notes'\)\.querySelectorAll\('\.home-library-tabs button'\)/);
  assert.match(css, /\.home-card-notes\.focused \.home-library-tabs \.home-card-action \{[^}]*background: transparent;[^}]*font-size: 16px/s);
});

test('Home actions reuse TaskPanel, Mail settings, and Codex settings', () => {
  const home = fs.readFileSync(path.join(ROOT, 'public/home.js'), 'utf8');
  const panel = fs.readFileSync(path.join(ROOT, 'public/agent-panel.js'), 'utf8');
  assert.match(home, /global\.TaskPanel\?\.render\(host, options\)/);
  assert.match(panel, /state\.apiFetch\('\/api\/mail\/settings', \{\s*method: 'PUT'/s);
  assert.match(panel, /state\.apiFetch\('\/api\/models\/codex'\)/);
  assert.match(panel, /state\.apiFetch\('\/api\/settings\/codex-models', \{\s*method: 'PUT'/s);
  assert.match(panel, /makeMailAgentCard\(\), makeScheduleAgentCard\(\), makeCodexAgentCard\(\)/);
  assert.match(panel, /saveMailSettings\(\{ notificationsEnabled:/);
  assert.match(panel, /button\('대기열 정리', organizeQueuedNotes\)|button\(state\.organizeRunning \? '시작하는 중…' : '대기열 정리', organizeQueuedNotes\)/);
});

test('focused notifications inspect existing categories and provider counts', () => {
  const home = fs.readFileSync(path.join(ROOT, 'public/home.js'), 'utf8');
  assert.match(home, /system\.filter\(item => item\.type === 'merge'\)/);
  assert.match(home, /mail\.filter\(item => item\.provider === 'gmail'\)/);
  assert.match(home, /home-notification-detail-row/);
});

test('Agents summary matches the three Figma operational cards without embedding the task calendar', () => {
  const panel = fs.readFileSync(path.join(ROOT, 'public/agent-panel.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  const summary = panel.slice(panel.indexOf('function makeMailAgentCard()'), panel.indexOf('function makeDetailHead('));
  assert.doesNotMatch(summary, /makeCalendar\(|makeScheduleBlock\(/);
  assert.match(summary, /agentSummarySection\('계정'/);
  assert.match(summary, /agentSummarySection\('정리 상태'/);
  assert.match(css, /#agent-panel-content > \.agents-operational-card \{[^}]*min-height: 210px/s);
  assert.match(css, /#agent-panel-content > \.mail-agent-card \{ min-height: 238px; \}/);
  assert.match(css, /#agent-panel-content > \.schedule-agent-card \{ min-height: 286px; \}/);
  assert.match(css, /\.home-page-head \{[^}]*min-height: 78px/s);
});

test('legacy task and notification links route into working Home surfaces', () => {
  const home = fs.readFileSync(path.join(ROOT, 'public/home.js'), 'utf8');
  assert.match(home, /params\.get\('panel'\) === 'agents'[\s\S]*?openTasks\(/);
  assert.match(home, /params\.get\('panel'\) === 'notifications'[\s\S]*?openNotifications\(params\.get\('notification'\) === 'mail' \? 'mail' : 'all'\)/);
  assert.match(home, /focusReminders: params\.get\('taskView'\) === 'reminders'/);
});

test('the mail card treats a disabled flag as off, not as an error', () => {
  const panel = fs.readFileSync(path.join(ROOT, 'public/agent-panel.js'), 'utf8');
  // 503을 실패로 다루면 카드가 빨갛게 뜨고, 사람이 고칠 것이 없는데 고치려 들게 된다.
  assert.match(panel, /MAIL_AGENT_DISABLED[\s\S]{0,120}state\.mail = \{ disabled: true \}/);
  // 확인할 메일 자체는 알림 탭의 몫이다. 여기에 두 번째 받은편지함을 만들지 않는다.
  assert.doesNotMatch(panel, /\/api\/mail\/attention/);
  assert.match(panel, /\/api\/mail\/analysis\/requeue/);
});

test('the chat column and the composer share one inline padding rule', () => {
  // 따로 적어두면 다시 어긋난다. 한 규칙에 묶어 같은 세로선을 강제한다.
  assert.match(
    css,
    /#chat, #input-area \{\s*padding-inline: max\(var\(--gutter\), \(100% - var\(--reading-width\)\) \/ 2\);/,
  );
  assert.match(css, /--gutter:\s*16px/);
  assert.match(css, /--reading-width:\s*600px/);
});

test('the header hairline is themed so it survives dark mode', () => {
  // 검정 6%를 그대로 쓰면 어두운 배경에서 경계가 사라진다.
  assert.match(css, /:root \{[\s\S]*?--hairline:\s*rgba\(0, 0, 0, 0\.06\)/);
  assert.match(css, /\[data-theme="dark"\] \{[\s\S]*?--hairline:\s*rgba\(255, 255, 255, 0\.10\)/);
  assert.match(css, /#header \{[^}]*border-bottom: 1px solid var\(--hairline\)/s);
  assert.match(css, /#input-area \{[^}]*border-top: 1px solid var\(--hairline\)/s);
});

test('the icon save button keeps a 44px hit area without growing', () => {
  assert.match(css, /\.icon-save-btn \{[^}]*width: 28px/s);
  // 28px + 8px씩 = 44px. 아이콘 크기는 그대로 두고 닿는 범위만 넓힌다.
  assert.match(css, /\.icon-save-btn::after \{[^}]*inset: -8px/s);
});

test('headings step up in size instead of only getting bolder', () => {
  assert.match(css, /\.bubble\.md h1 \{ font-size: 19px/);
  assert.match(css, /\.bubble\.md h2 \{ font-size: 17px/);
  assert.match(css, /\.bubble\.md h3 \{ font-size: 15px/);
});

test('every progress stage the server can send has a chat label', () => {
  // 라벨이 없는 단계는 화면에서 조용히 무시돼 진행 표시가 이전 단계에 멈춘 것처럼 보인다.
  const { VALID_PROGRESS_STAGES } = require('../lib/progress-stream');
  const labels = app.slice(app.indexOf('PROGRESS_STAGE_LABELS'));
  const labelled = new Set(
    [...labels.slice(0, labels.indexOf('});')).matchAll(/^ {2}([a-z_]+):/gm)].map(match => match[1]),
  );
  assert.deepEqual([...VALID_PROGRESS_STAGES].filter(stage => !labelled.has(stage)), []);
  assert.deepEqual([...labelled].filter(stage => !VALID_PROGRESS_STAGES.has(stage)), []);
  // 큰 첨부의 첫 턴은 파싱이 요청 안에서 끝나므로 그 시간을 따로 알린다.
  assert.ok(labelled.has('attachment_parse'));
});

test('the notification panel gains a mail filter without losing the others', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const panel = fs.readFileSync(path.join(ROOT, 'public/notification-panel.js'), 'utf8');
  const filters = [...html.matchAll(/data-notification-filter="([a-z]+)"/g)].map(m => m[1]);
  assert.deepEqual(filters, ['all', 'codex', 'system', 'mail', 'saves']);
  // 가드가 탭 수를 고정한다. 버튼만 늘리고 가드를 안 고치면 패널이 통째로 죽는다.
  assert.match(panel, /el\.tabs\.length !== 5/);
});

test('mail cards never render the mail body, only what the design allows', () => {
  const panel = fs.readFileSync(path.join(ROOT, 'public/notification-panel.js'), 'utf8');
  // 알림 탭은 받은편지함이 아니다(설계 23). 카드는 제목·요약·행동·기한까지다.
  assert.match(panel, /function makeMailCard/);
  assert.doesNotMatch(panel, /item\.body/);
  // 카드 본문만 본다. 패널 다른 곳의 정적 스켈레톤 마크업은 데이터가 아니라 위험하지 않다.
  const cardSource = panel.slice(panel.indexOf('function makeMailCard'), panel.indexOf('function makeMailAction'));
  assert.ok(cardSource.length > 200, 'makeMailCard 본문을 못 찾았다');
  assert.equal(cardSource.includes('innerHTML'), false);
  assert.match(cardSource, /textContent/);
  // 완료·나중에는 서버 상태를 바꾸는 유일한 경로다.
  assert.match(panel, /\/api\/mail\/attention\/\$\{item\.attentionId\}\/\$\{kind\}/);
});

test('provider names come from one table, so a third provider is not mislabelled', () => {
  // `gmail이냐 아니냐`의 이진 분기는 provider가 둘일 때만 맞다. 웍스가 붙으면서
  // 그 분기가 웍스를 `Naver`로 표시했다.
  for (const file of ['public/notification-panel.js', 'public/agent-panel.js']) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(source, /const PROVIDER_LABELS = \{ gmail: 'Gmail', naver: 'Naver', works: 'Works' \}/, file);
    assert.doesNotMatch(source, /=== 'gmail' \? 'Gmail' : 'Naver'/, file);
  }
});

test('turning a sender quiet is one narrow action, not a rule editor', () => {
  const panel = fs.readFileSync(path.join(ROOT, 'public/notification-panel.js'), 'utf8');
  const agent = fs.readFileSync(path.join(ROOT, 'public/agent-panel.js'), 'utf8');

  // 만드는 곳은 카드 하나이고 범위는 발신자 하나다(설계 3.4·11.3). 도메인·분류를
  // 사용자가 고르는 UI를 만들면 그게 규칙 편집기다.
  assert.match(panel, /preferenceType: 'sender'/);
  assert.match(panel, /action: 'suppress_notification'/);
  assert.doesNotMatch(panel, /preferenceType: 'domain'|preferenceType: 'category'/);
  // 이름이 아니라 주소로 좁힌다. 표시용 sender에는 이름이 들어 있을 수 있다.
  assert.match(panel, /target: item\.senderAddress/);

  // 확인하고 되돌리는 자리는 Mail 상세다. 거기서도 만들지는 않는다.
  assert.match(agent, /function makeMailPreferences/);
  assert.match(agent, /\/api\/mail\/preferences\/\$\{id\}/);
  assert.match(agent, /method: 'DELETE'/);
  assert.doesNotMatch(agent, /method: 'POST'[\s\S]{0,200}\/api\/mail\/preferences/);

  // 목록은 action으로 거르지 않는다. 대화로 만든 규칙이 여기 안 보이면 만든 사람이
  // 그것을 지울 자리가 없다.
  assert.doesNotMatch(agent, /mailPreferences\.filter/);
  for (const label of ['suppress_notification', 'always_notify', 'skip_analysis']) {
    assert.match(agent, new RegExp(`${label}: '`), label);
  }
});

test('a suppressed sender keeps its judgement, so routing is the only layer that changes', () => {
  const push = fs.readFileSync(path.join(ROOT, 'lib/mail/push.js'), 'utf8');
  // 선호는 라우팅 단계에서만 듣는다(설계 11.1). 분석·Attention 경로를 건드리면
  // "알림은 껐지만 나중에 검색은 되는" 계약이 깨진다.
  assert.match(push, /function effectiveMode/);
  assert.match(push, /action === 'suppress_notification'/);
  // 좁은 순서를 정하는 쿼리는 store 한 곳이다. 여기서 다시 만들지 않는다.
  assert.doesNotMatch(push, /FROM mail_preferences/);
  // 억제가 승격을 이긴다. 껐는데 울리면 알림 전체를 못 믿게 된다.
  assert.match(push, /suppress_notification'\)\) return 'silent'/);
  // 승격은 한 칸이다. 도메인 하나를 통째로 즉시 알림으로 만들지 않는다(설계 11.1).
  assert.match(push, /always_notify/);
  assert.match(push, /category === 'urgent' \|\| message\.category === 'action_required'/);
  // 분석 bypass는 라우팅의 일이 아니다. 그것은 analyze.js가 LLM 앞에서 처리한다.
  assert.doesNotMatch(push, /skip_analysis/);
});

test('a mail card opens its body from the provider and never from a stored one', () => {
  const panel = fs.readFileSync(path.join(ROOT, 'public/notification-panel.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');

  // 본문은 저장돼 있지 않다(설계 23). 카드가 여는 것은 그때 읽어오는 경로 하나다.
  assert.match(panel, /\/api\/mail\/messages\/\$\{item\.mailMessageId\}\/body/);
  assert.match(panel, /apiFetch\(`\/api\/mail\/messages\/\$\{item\.mailMessageId\}\/body`, \{ cache: 'no-store' \}\)/);
  // HTML을 그리지 않는다. 그리면 원격 이미지·추적 픽셀이 들어올 구멍이 생긴다.
  assert.match(panel, /text\.textContent = data\.body/);
  const renderBody = panel.slice(panel.indexOf('function renderBody'));
  assert.doesNotMatch(renderBody.slice(0, renderBody.indexOf('\n  }')), /innerHTML/);
  // 제목 줄 자체가 여는 버튼이고 상태를 스크린리더에 알린다.
  assert.match(panel, /aria-expanded/);
  assert.match(css, /\.mail-body-text \{[\s\S]{0,200}white-space: pre-wrap;/);
});

test('a mail becomes a schedule only through the candidate card the user confirms', () => {
  const panel = fs.readFileSync(path.join(ROOT, 'public/notification-panel.js'), 'utf8');

  // 카드는 후보만 만든다. 저장은 사용자가 `등록`을 눌러야 기존 task API에서
  // 일어난다(설계 15) — 알림 탭이 /api/tasks를 직접 부르지 않는다.
  assert.match(panel, /TaskPanel\?\.makeScheduleCandidateCard/);
  assert.doesNotMatch(panel, /'\/api\/tasks'/);
  // 같은 메일은 같은 멱등키라 두 번 눌러도 일정이 둘이 되지 않는다.
  assert.match(panel, /clientRequestId: `mail-attention:\$\{item\.attentionId\}`/);
  // 기한이 없거나 지난 메일에는 버튼 자체가 없다. 눌러도 실패할 버튼을 만들지 않는다.
  assert.match(panel, /if \(scheduleCandidateFrom\(item\)\)/);
  assert.match(panel, /item\.deadlineAt > now/);
  // 알림은 기본 알림에 맡긴다. 카드가 알림 시각을 지어내지 않는다.
  assert.match(panel, /reminderAt: null/);
});

test('the two consumers of /api/notifications still split task from the rest', () => {
  // 메일이 합류하면서 일정 블록에 새면 안 되고, 알림 탭에서 빠져도 안 된다.
  const agent = fs.readFileSync(path.join(ROOT, 'public/agent-panel.js'), 'utf8');
  const panel = fs.readFileSync(path.join(ROOT, 'public/notification-panel.js'), 'utf8');
  assert.match(agent, /filter\(item => item\.type === 'task_reminder'\)/);
  assert.match(panel, /filter\(item => item\.type !== 'task_reminder'\)/);
});

test('the service worker shows fixed text and never reads mail content', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8');
  // 종류는 payload.type으로 가르고 문구는 SW 안에 고정돼 있다. 분기 표현식의
  // 모양이 아니라 그 사실을 잰다 — 종류가 셋이 되면서 `===` 두 번이 표가 됐다.
  assert.match(sw, /kinds\[payload\.type\]/);
  assert.match(sw, /mail_attention:/);
  assert.match(sw, /news_review:/);
  // Codex 업데이트 알림은 버전 형식을 확인한 뒤에만 문구에 넣는다.
  assert.match(sw, /codex_update:/);
  assert.match(sw, /\/\^\\d\+\\\.\\d\+\\\.\\d\+\$\/\.test\(payload\.codexVersion\)/);
  assert.match(sw, /XION 메일 알림/);
  assert.match(sw, /XION 일정 알림/);
  // 재확인 Push는 무엇을 물어보는지 밝히지 않는다(뉴스 설계 11.5).
  assert.match(sw, /'물어볼 게 하나 있어\.'/);
  // payload가 담지 않는 값을 SW가 읽으려 하면 안 된다.
  for (const forbidden of ['payload.subject', 'payload.sender', 'payload.summary', 'payload.count', 'payload.body']) {
    assert.equal(sw.includes(forbidden), false, forbidden);
  }
  // 회차를 tag에 넣지 않으면 snooze 재알림이 이전 알림을 덮어쓴다.
  assert.match(sw, /notifySeq/);
  // 서버 API를 다시 부르지 않는다. 잠금화면 문구는 payload만으로 정해진다.
  assert.equal(sw.includes('fetch('), false);
  // 새 문구가 배포돼도 옛 SW가 계속 잡고 있으면 잠금화면은 옛 문구로 나간다.
  assert.match(sw, /addEventListener\('install', \(\) => self\.skipWaiting\(\)\)/);
  assert.match(sw, /clients\.claim\(\)/);
});

test('모델 메뉴가 조상의 스택 컨텍스트에 갇힌 채 전체 화면 딤에 덮이지 않는다', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  const picker = fs.readFileSync(path.join(ROOT, 'public/model-picker.js'), 'utf8');

  // `#input-area`의 backdrop-filter는 새 스택 컨텍스트를 만든다. 그래서 그 안에 있는
  // `#chat-model-menu`의 z-index는 루트에서 통하지 않고, `body::before`로 만든 딤이
  // 메뉴 위에 깔린다. 딤은 가상 요소라 탭의 target이 body가 되어 바깥 클릭으로
  // 읽히고, 항목을 눌러도 선택 대신 메뉴가 닫혔다. 모바일에서만 나던 버그다.
  assert.match(css, /#input-area\s*{[^}]*backdrop-filter/s);
  assert.doesNotMatch(css, /body\.model-picker-open/);
  // 딤이 없으니 그 클래스를 붙이던 코드도 남기지 않는다.
  assert.doesNotMatch(picker, /model-picker-open/);

  // 메뉴 자체는 그대로 모바일에서 화면 하단에 고정된다.
  assert.match(css, /#chat-model-menu\s*{[^}]*position: fixed/s);
});
