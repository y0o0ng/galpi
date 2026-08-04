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

test('every composer control meets the 44px touch target on mobile', () => {
  // 반이중 마이크만 이 규칙에서 빠져 38px로 남아 있었고, flex-end 정렬 때문에
  // 다른 버튼보다 3px 낮게 앉았다.
  // 모바일 규칙은 여러 블록에 흩어져 있다. 어디에 적혔든 걸리면 된다.
  const mobile = allBlocks(css, '@media (max-width: 640px)').join('\n');
  for (const id of ['#send-btn', '#attachment-button', '#voice-hd-button', '#voice-realtime-button']) {
    assert.ok(
      new RegExp(`${id}[^{}]*\\{[^}]*height: 44px`, 's').test(mobile),
      `${id}이 44px 규칙에 없다`,
    );
  }
});

test('temporary attachments keep one shared renderer and a narrow-screen composer wrap', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.match(html, /id="attachment-input"[^>]*type="file"[^>]*hidden/);
  assert.match(html, /id="attachment-button"[^>]*aria-label="파일 첨부"[^>]*hidden/);
  assert.ok(html.indexOf('attachment-ui.js') < html.indexOf('app.js'));
  assert.match(app, /appendUserBubble\(msg\.content, msg\.attachments\)/);
  assert.match(app, /attachmentIds: \[draftAttachment\.attachmentId\]/);
  assert.match(app, /useComposerDraft: true/);
  assert.match(app, /const usesComposerDraft = options\.overrideText == null \|\| options\.useComposerDraft === true/);
  assert.match(css, /@media \(max-width: 360px\) \{[\s\S]*?#input-area \{[\s\S]*?flex-wrap: wrap/s);
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
