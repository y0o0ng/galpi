'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'validate-codex-edit.js');

const MARKERS = [
  '## 🏷️ 주제 태그',
  '<!-- CODEX-TAGS-START -->',
  '<!-- CODEX-TAGS-END -->',
  '',
  '## 🔗 연결',
  '<!-- CODEX-LINKS-START -->',
  '<!-- CODEX-LINKS-END -->',
].join('\n');

function makeVault(files) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-validate-'));
  Object.entries(files).forEach(([name, body]) => {
    fs.writeFileSync(path.join(vault, name), body);
  });
  return vault;
}

function validate(vault, filenames) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...filenames], {
      env: { ...process.env, VAULT_PATH: vault },
      encoding: 'utf8',
    });
    return { ok: true, output: stdout };
  } catch (error) {
    return { ok: false, output: `${error.stdout || ''}${error.stderr || ''}` };
  }
}

// 일정 월별 기록은 DB에서 다시 만들어내는 projection이다. 사람이 쌓는 지식 노트가
// 아니라서 knowledge_type·confidence가 없고, 있어야 할 이유도 없다.
const SCHEDULE_NOTE = `---
id: xion-schedule-2026-08
title: "2026년 8월 일정 기록"
note_type: schedule_history
archived: false
codex_status: pending
ai_readable: true
owner_agent: schedule
projection_source: assistant_tasks
period: 2026-08
---

# 2026년 8월 일정 기록

${MARKERS}
`;

const KNOWLEDGE_NOTE = `---
id: some-note
title: "보통 노트"
note_type: reference
archived: false
codex_status: pending
ai_readable: true
---

# 보통 노트

${MARKERS}
`;

test('agent-owned projection notes are not asked for knowledge frontmatter', () => {
  const vault = makeVault({ 'xion-schedule-2026-08.md': SCHEDULE_NOTE });
  const result = validate(vault, ['xion-schedule-2026-08.md']);
  assert.equal(result.ok, true, result.output);
  assert.match(result.output, /validation passed/);
});

test('notes without an owning agent still need knowledge_type and confidence', () => {
  const vault = makeVault({ 'some-note.md': KNOWLEDGE_NOTE });
  const result = validate(vault, ['some-note.md']);
  assert.equal(result.ok, false);
  assert.match(result.output, /frontmatter 누락: knowledge_type/);
  assert.match(result.output, /frontmatter 누락: confidence/);
});

// 예외는 두 필드에만 준다. Codex가 그 노트에서 고치는 것은 여전히 마커뿐이라
// 마커가 없으면 그대로 걸려야 한다.
test('the exemption does not excuse a missing CODEX marker', () => {
  const vault = makeVault({
    'xion-schedule-2026-09.md': SCHEDULE_NOTE
      .replace('xion-schedule-2026-08', 'xion-schedule-2026-09')
      .replace('<!-- CODEX-LINKS-START -->\n<!-- CODEX-LINKS-END -->', ''),
  });
  const result = validate(vault, ['xion-schedule-2026-09.md']);
  assert.equal(result.ok, false);
  assert.match(result.output, /CODEX 마커 누락/);
});

test('the exemption does not excuse the shared required fields', () => {
  const vault = makeVault({
    'xion-schedule-2026-10.md': SCHEDULE_NOTE.replace('ai_readable: true\n', ''),
  });
  const result = validate(vault, ['xion-schedule-2026-10.md']);
  assert.equal(result.ok, false);
  assert.match(result.output, /frontmatter 누락: ai_readable/);
});
