'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VAULT_PATH = process.env.VAULT_PATH
  ? path.resolve(process.env.VAULT_PATH)
  : path.join(ROOT, 'ai-council-vault');

const REQUIRED_FRONTMATTER = [
  'title',
  'note_type',
  'archived',
  'codex_status',
  'ai_readable',
  'knowledge_type',
  'confidence',
];

const REQUIRED_MARKERS = [
  '<!-- CODEX-TAGS-START -->',
  '<!-- CODEX-TAGS-END -->',
  '<!-- CODEX-LINKS-START -->',
  '<!-- CODEX-LINKS-END -->',
];

function countOccurrences(raw, marker) {
  return String(raw || '').split(marker).length - 1;
}

function extractMarkerBlock(raw, startMarker, endMarker) {
  const start = raw.indexOf(startMarker);
  if (start < 0) return null;

  const end = raw.indexOf(endMarker, start + startMarker.length);
  if (end < 0) return null;

  return raw.slice(start + startMarker.length, end).trim();
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fields = {};
  match[1].split('\n').forEach(line => {
    const parts = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!parts) return;
    fields[parts[1]] = parts[2].trim().replace(/^"(.*)"$/, '$1');
  });

  return fields;
}

function shouldSkipFile(filename) {
  return (
    !filename.endsWith('.md') ||
    filename.startsWith('.') ||
    filename === 'memory.md' ||
    filename.startsWith('_system/')
  );
}

function validateFile(filename) {
  const filepath = path.join(VAULT_PATH, filename);
  const raw = fs.readFileSync(filepath, 'utf8');
  const warnings = [];
  const frontmatter = parseFrontmatter(raw);

  if (!frontmatter) {
    warnings.push('frontmatter 없음');
  } else {
    REQUIRED_FRONTMATTER.forEach(field => {
      if (!(field in frontmatter) || frontmatter[field] === '') {
        warnings.push(`frontmatter 누락: ${field}`);
      }
    });

    if (String(frontmatter.archived).toLowerCase() === 'true') {
      warnings.push('archived 노트: Codex 정리 대상에서 제외 필요');
    }
  }

  REQUIRED_MARKERS.forEach(marker => {
    const count = countOccurrences(raw, marker);
    if (count === 0) warnings.push(`CODEX 마커 누락: ${marker}`);
    if (count > 1) warnings.push(`CODEX 마커 중복: ${marker} (${count})`);
  });

  const linksBlock = extractMarkerBlock(raw, '<!-- CODEX-LINKS-START -->', '<!-- CODEX-LINKS-END -->');
  if (linksBlock) {
    linksBlock.split('\n').forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('**[') || trimmed.endsWith(']**')) return;
      if (!trimmed.startsWith('- ')) return;

      if (!/^- (?:[1-9][0-9]?|100) \[\[[^\]\n]+\]\] — .+/.test(trimmed)) {
        warnings.push(`CODEX 링크 형식 오류: ${index + 1}행`);
      }
    });
  }

  return warnings;
}

function main() {
  const files = fs.readdirSync(VAULT_PATH).filter(filename => !shouldSkipFile(filename));
  const failures = [];

  files.forEach(filename => {
    const warnings = validateFile(filename);
    if (warnings.length > 0) failures.push({ filename, warnings });
  });

  if (failures.length === 0) {
    console.log(`Codex validation passed: ${files.length} notes checked.`);
    return;
  }

  console.error(`Codex validation failed: ${failures.length}/${files.length} notes need attention.`);
  failures.forEach(({ filename, warnings }) => {
    console.error(`\n${filename}`);
    warnings.forEach(warning => console.error(`- ${warning}`));
  });
  process.exit(1);
}

main();
