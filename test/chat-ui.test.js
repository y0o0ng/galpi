'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');

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
    /#send-btn,\s*#voice-hd-button,\s*#voice-realtime-button \{[^}]*width: 44px;[^}]*height: 44px/s,
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
  // 8·9·10px은 눈으로 구분되지 않는다. 세 값이 공존하면 규칙이 아니라 사고로 읽힌다.
  assert.doesNotMatch(css, /border-radius: 8px;/);
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

test('the home reuses the panel type scale and stays one column', () => {
  // 지식 패널은 데스크톱에서 350px 고정 폭이라 2열이 물리적으로 안 들어간다.
  // 그래서 홈은 데스크톱과 모바일이 같은 1열을 쓰고, 그리드 컬럼을 만들지 않는다.
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) 350px;/);
  assert.match(css, /\.home-agents \{[^}]*display: grid/s);
  assert.doesNotMatch(css, /\.home-agents \{[^}]*grid-template-columns/s);

  // 9 · 11 · 17만 쓴다. 홈 때문에 새 단계를 만들지 않는다.
  assert.match(css, /\.home-section-title \{[^}]*font-size: 9px/s);
  assert.match(css, /\.home-attention-title \{[^}]*font-size: 11px/s);
  assert.match(css, /\.home-agent-title \{[^}]*font-size: 11px/s);

  // 카드 모서리는 12px, 그 안의 일반 컨트롤은 10px 하나씩이다.
  assert.match(css, /\.home-attention,\n\.home-today \{[^}]*border-radius: 12px/s);
  assert.match(css, /\.home-agent \{[^}]*border-radius: 10px/s);
  // 390px은 상세 블록의 값이다. 홈이 그 높이를 물려받으면 접는 의미가 없다.
  assert.doesNotMatch(css, /\.home-agent \{[^}]*min-height/s);
});

test('XION sits first among the knowledge tabs and opens with the date', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const order = [...html.matchAll(/data-panel-tab="([a-z]+)"/g)].map(match => match[1]);
  assert.deepEqual(order, ['agents', 'notifications', 'notes', 'papers']);

  const panel = fs.readFileSync(path.join(ROOT, 'public/agent-panel.js'), 'utf8');
  const render = panel.slice(panel.indexOf('function renderSummary()'));
  // 머리는 첫 줄이다. 인사와 날짜가 확인할 것 뒤로 가면 화면이 다시 목록처럼 읽힌다.
  assert.ok(render.indexOf('makeHomeHead') < render.indexOf('makeAttentionSection'));
  // 인사는 KST로 고른다. 브라우저 timezone을 쓰면 기기마다 다른 인사가 나온다.
  assert.match(panel, /function greeting[\s\S]*?timeZone: 'Asia\/Seoul'/);
  assert.match(css, /\.home-date \{[^}]*font-size: 17px/s);
});

test('the home briefing comes before the agent status, and never outranks itself', () => {
  const panel = fs.readFileSync(path.join(ROOT, 'public/agent-panel.js'), 'utf8');
  const render = panel.slice(panel.indexOf('function renderSummary()'));
  const body = render.slice(0, render.indexOf('\n  }'));
  // 홈이 답하는 질문은 "지금 뭘 봐야 하는가"다. 에이전트 운영 상태가 그 앞에 오면
  // 순서가 뒤집힌다.
  assert.ok(body.indexOf('makeAttentionSection') < body.indexOf('makeTodaySection'));
  assert.ok(body.indexOf('makeTodaySection') < body.indexOf('makeScheduleRow'));

  // 홈은 알림 탭과 같은 응답을 읽는다. 메일 전용 목록 API를 따로 부르지 않는다.
  assert.match(panel, /item\.source === 'mail'/);
  // 상태 변경은 알림 탭의 몫이다. 홈에서 완료·미루기를 부르면 책임이 두 곳이 된다.
  assert.doesNotMatch(panel, /\/api\/mail\/attention/);

  // 정상 에이전트의 운영 세부값이 첫 화면을 채우지 않는다.
  assert.match(panel, /tone === 'warn' \|\| tone === 'danger'/);
});

test('an agent row is one button, so mobile gets one target instead of several', () => {
  const panel = fs.readFileSync(path.join(ROOT, 'public/agent-panel.js'), 'utf8');
  // 줄 안에 버튼을 또 넣으면 중첩이 되고 타깃이 잘게 쪼개진다. 복구 버튼은 상세에 둔다.
  assert.match(panel, /row = document\.createElement\('button'\)/);
  assert.match(panel, /row\.addEventListener\('click', onOpen\)/);
  assert.doesNotMatch(panel, /row\.appendChild\(button\(/);
});

test('the summary screen reads status only, and details load their own agent', () => {
  const panel = fs.readFileSync(path.join(ROOT, 'public/agent-panel.js'), 'utf8');
  // 카드가 쓰는 runner는 organize/status에도 있다. 요약이 모델 카탈로그까지
  // 부르면 에이전트가 늘 때마다 여는 비용이 그만큼 는다.
  assert.match(panel, /loadScheduleSummary\(\) : Promise\.resolve\(false\),\s*loadCodexStatus\(\),\s*loadMailData\(\),\s*loadHomeAttention\(\),/s);
  assert.doesNotMatch(panel, /loadCodexData\(\),\s*loadMailData/s);
  // 한 소스가 죽어도 나머지 영역은 살아 있어야 한다.
  assert.match(panel, /Promise\.allSettled\(\[\s*state\.enabled \? loadScheduleSummary/s);
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

test('the two consumers of /api/notifications still split task from the rest', () => {
  // 메일이 합류하면서 일정 블록에 새면 안 되고, 알림 탭에서 빠져도 안 된다.
  const agent = fs.readFileSync(path.join(ROOT, 'public/agent-panel.js'), 'utf8');
  const panel = fs.readFileSync(path.join(ROOT, 'public/notification-panel.js'), 'utf8');
  assert.match(agent, /filter\(item => item\.type === 'task_reminder'\)/);
  assert.match(panel, /filter\(item => item\.type !== 'task_reminder'\)/);
});

test('the service worker shows fixed text and never reads mail content', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8');
  assert.match(sw, /payload\.type === 'mail_attention'/);
  assert.match(sw, /XION 메일 알림/);
  assert.match(sw, /XION 일정 알림/);
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
