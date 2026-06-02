'use strict';

const fs = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VAULT_PATH = process.env.VAULT_PATH
  ? path.resolve(process.env.VAULT_PATH)
  : path.join(ROOT, 'ai-council-vault');

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { frontmatter: {}, bodyStart: 0, rawFrontmatter: '' };

  const frontmatter = {};
  match[1].split('\n').forEach(line => {
    const parts = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!parts) return;
    frontmatter[parts[1]] = parts[2].trim().replace(/^"(.*)"$/, '$1');
  });

  return {
    frontmatter,
    bodyStart: match[0].length,
    rawFrontmatter: match[1],
  };
}

function inferKnowledgeType(noteType) {
  if (noteType === 'council') return 'council_synthesis';
  if (noteType === 'single_manual') return 'answer';
  if (noteType === 'user_manual') return 'user_document';
  return 'legacy';
}

function describeNoteType(noteType) {
  if (noteType === 'council') return '의회 모드 종합';
  if (noteType === 'single_manual') return '단일 답변 수동 저장';
  if (noteType === 'user_manual') return '사용자 저장 문서';
  return '기존 노트';
}

function insertFrontmatterFields(raw, fm) {
  const parsed = parseFrontmatter(raw);
  if (!parsed.rawFrontmatter) return raw;

  const fields = [];
  const created = fm.created || new Date().toISOString().slice(0, 16).replace('T', ' ');
  const noteType = fm.note_type || 'legacy';

  if (!('updated' in fm)) fields.push(`updated: ${created}`);
  if (!('codex_status' in fm)) fields.push('codex_status: pending');
  if (!('ai_readable' in fm)) fields.push('ai_readable: true');
  if (!('knowledge_type' in fm)) fields.push(`knowledge_type: ${inferKnowledgeType(noteType)}`);
  if (!('confidence' in fm)) fields.push('confidence: medium');
  if (fields.length === 0) return raw;

  const updatedFrontmatter = `${parsed.rawFrontmatter}\n${fields.join('\n')}`;
  return raw.replace(/^---\n[\s\S]*?\n---/, `---\n${updatedFrontmatter}\n---`);
}

function buildRecallHint(fm, filename) {
  const title = fm.title || filename.replace(/\.md$/, '');
  const noteType = fm.note_type || 'legacy';

  return `## AI 회수 힌트
- 핵심 개념: ${title}
- 노트 성격: ${describeNoteType(noteType)}
- 다시 꺼낼 상황: 같은 주제의 후속 질문이나 이전 판단을 참고할 때
- 연결 후보: 정리 엔진이 추후 보강
- 신뢰도: ${fm.confidence || 'medium'}`;
}

function insertRecallHint(raw, fm, filename) {
  if (raw.includes('## AI 회수 힌트')) return raw;

  const hint = buildRecallHint(fm, filename);
  const headingMatch = raw.match(/^(# .+)\n/m);
  if (headingMatch) {
    return raw.replace(headingMatch[0], `${headingMatch[1]}\n\n${hint}\n\n`);
  }

  const parsed = parseFrontmatter(raw);
  if (!parsed.bodyStart) return `${hint}\n\n${raw}`;
  return `${raw.slice(0, parsed.bodyStart)}\n\n${hint}\n\n${raw.slice(parsed.bodyStart).trimStart()}`;
}

async function main() {
  const files = await fs.readdir(VAULT_PATH);
  let scanned = 0;
  let changed = 0;
  let skipped = 0;

  for (const filename of files) {
    if (!filename.endsWith('.md') || filename.startsWith('.')) {
      skipped += 1;
      continue;
    }

    scanned += 1;
    const filepath = path.join(VAULT_PATH, filename);
    const raw = await fs.readFile(filepath, 'utf8');
    const { frontmatter } = parseFrontmatter(raw);

    let next = insertFrontmatterFields(raw, frontmatter);
    const latestFm = parseFrontmatter(next).frontmatter;
    next = insertRecallHint(next, latestFm, filename);

    if (next === raw) continue;
    await fs.writeFile(filepath, next, 'utf8');
    changed += 1;
  }

  console.log(JSON.stringify({ success: true, scanned, changed, skipped }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
