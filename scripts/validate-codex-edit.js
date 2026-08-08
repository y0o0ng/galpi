'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VAULT_PATH = process.env.VAULT_PATH
  ? path.resolve(process.env.VAULT_PATH)
  : path.join(ROOT, 'galpi-vault');

const REQUIRED_FRONTMATTER = [
  'title',
  'note_type',
  'archived',
  'codex_status',
  'ai_readable',
];

// `knowledge_type`·`confidence`는 사람이 쌓는 지식 노트의 성질이다. 에이전트가
// DB에서 다시 만들어내는 projection 노트에는 그런 값이 없고, 있어야 할 이유도 없다.
// 이 둘을 모두에게 요구하면 매달 생기는 일정 기록 노트가 영영 정리를 통과하지
// 못하고 needs_manual_check로 쌓인다. Codex가 그 노트에서 고치는 것은 여전히
// CODEX-TAGS·CODEX-LINKS 마커뿐이라 아래 마커 검사는 그대로 받는다.
const KNOWLEDGE_FRONTMATTER = ['knowledge_type', 'confidence'];

function isAgentOwnedNote(frontmatter) {
  return Boolean(frontmatter?.owner_agent);
}

const REQUIRED_MARKERS = [
  '<!-- CODEX-TAGS-START -->',
  '<!-- CODEX-TAGS-END -->',
  '<!-- CODEX-LINKS-START -->',
  '<!-- CODEX-LINKS-END -->',
];
const TOPIC_REQUIRED_MARKERS = [
  '<!-- CODEX-SUMMARY-START -->',
  '<!-- CODEX-SUMMARY-END -->',
  '<!-- QA-LOG-START -->',
  '<!-- QA-LOG-END -->',
  '<!-- CODEX-PROPOSALS-START -->',
  '<!-- CODEX-PROPOSALS-END -->',
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

function splitQaLogEntries(qaLog) {
  return String(qaLog || '')
    .split(/(?=^###\s+\d{4}-\d{2}-\d{2}\s+)/m)
    .map(item => item.trim())
    .filter(item => /^###\s+\d{4}-\d{2}-\d{2}\s+/.test(item));
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

function collectVaultFileStems() {
  return new Set(
    fs.readdirSync(VAULT_PATH)
      .filter(filename => filename.endsWith('.md'))
      .map(filename => filename.replace(/\.md$/, ''))
  );
}

function validateWikiLinkInner(inner, fileStems, context) {
  const text = String(inner || '').trim();
  if (!text.includes('|')) return `${context}: 파일ID 없는 bare wiki link`;

  const fileId = text.slice(0, text.indexOf('|')).trim().replace(/\.md$/, '');
  const title = text.slice(text.indexOf('|') + 1).trim();
  if (!/^\d{8}-\d{6}-[a-z0-9]{4}$/.test(fileId)) return `${context}: 파일ID 형식 오류`;
  if (!title) return `${context}: 표시 제목 누락`;
  if (!fileStems.has(fileId)) return `${context}: 대상 파일 없음`;
  return null;
}

function shouldSkipFile(filename) {
  return (
    !filename.endsWith('.md') ||
    filename.startsWith('.') ||
    filename === 'memory.md' ||
    filename.startsWith('_system/')
  );
}

function validateFile(filename, fileStems) {
  const filepath = path.join(VAULT_PATH, filename);
  const raw = fs.readFileSync(filepath, 'utf8');
  const warnings = [];
  const frontmatter = parseFrontmatter(raw);

  // 레거시/비-Codex 노트(frontmatter도 CODEX 마커도 없음)는 Codex 관리 대상이 아니므로 검증 제외
  const hasCodexMarkers = raw.includes('<!-- CODEX-TAGS-START -->') || raw.includes('<!-- CODEX-LINKS-START -->');
  if (!frontmatter && !hasCodexMarkers) return [];

  if (!frontmatter) {
    warnings.push('frontmatter 없음');
  } else {
    if (String(frontmatter.archived).toLowerCase() === 'true') {
      return [];
    }

    const required = isAgentOwnedNote(frontmatter)
      ? REQUIRED_FRONTMATTER
      : [...REQUIRED_FRONTMATTER, ...KNOWLEDGE_FRONTMATTER];
    required.forEach(field => {
      if (!(field in frontmatter) || frontmatter[field] === '') {
        warnings.push(`frontmatter 누락: ${field}`);
      }
    });
  }

  REQUIRED_MARKERS.forEach(marker => {
    const count = countOccurrences(raw, marker);
    if (count === 0) warnings.push(`CODEX 마커 누락: ${marker}`);
    if (count > 1) warnings.push(`CODEX 마커 중복: ${marker} (${count})`);
  });

  if (frontmatter?.note_type === 'topic') {
    TOPIC_REQUIRED_MARKERS.forEach(marker => {
      const count = countOccurrences(raw, marker);
      if (count === 0) warnings.push(`topic 마커 누락: ${marker}`);
      if (count > 1) warnings.push(`topic 마커 중복: ${marker} (${count})`);
    });

    const qaLog = extractMarkerBlock(raw, '<!-- QA-LOG-START -->', '<!-- QA-LOG-END -->');
    if (qaLog) {
      splitQaLogEntries(qaLog).forEach((entry, index) => {
        if (!/<!--\s*qa_id:\s*qa-[a-f0-9-]+\s*-->/.test(entry)) {
          warnings.push(`topic QA 항목 qa_id 누락: ${index + 1}번째`);
        }
      });
    }
  }

  const linksBlock = extractMarkerBlock(raw, '<!-- CODEX-LINKS-START -->', '<!-- CODEX-LINKS-END -->');
  if (linksBlock) {
    linksBlock.split('\n').forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('**[') || trimmed.endsWith(']**')) return;
      if (!trimmed.startsWith('- ')) return;

      const match = trimmed.match(/^- (?:[1-9][0-9]?|100) \[\[([^\]\n]+)\]\] — .+/);
      if (!match) {
        warnings.push(`CODEX 링크 형식 오류: ${index + 1}행`);
        return;
      }

      const linkWarning = validateWikiLinkInner(match[1], fileStems, `CODEX 링크 ${index + 1}행`);
      if (linkWarning) warnings.push(linkWarning);
    });
  }

  const proposalsBlock = extractMarkerBlock(raw, '<!-- CODEX-PROPOSALS-START -->', '<!-- CODEX-PROPOSALS-END -->');
  if (proposalsBlock) {
    proposalsBlock.split('\n').forEach((line, index) => {
      const trimmed = line.trim();

      if (trimmed.startsWith('- MERGE ')) {
        const match = trimmed.match(/^-\s*MERGE\s+\[\[([^\]\n]+)\]\]\s*(?:—\s*.+)?$/i);
        if (!match) {
          warnings.push(`MERGE 제안 형식 오류: ${index + 1}행`);
          return;
        }
        const linkWarning = validateWikiLinkInner(match[1], fileStems, `MERGE 제안 ${index + 1}행`);
        if (linkWarning) warnings.push(linkWarning);
        return;
      }

      if (trimmed.startsWith('- SPLIT ')) {
        if (!/^-\s*SPLIT\s+qa-/i.test(trimmed)) return;

        const match = trimmed.match(/^-\s*SPLIT\s+(\S+)\s*(?:→|->)\s*\[\[([^\]\n]+)\]\]\s*(?:—\s*.+)?$/i);
        if (!match) {
          warnings.push(`SPLIT 제안 형식 오류: ${index + 1}행`);
          return;
        }
        if (!/^qa-[a-f0-9-]+$/.test(match[1])) {
          warnings.push(`SPLIT 제안 qa_id 형식 오류: ${index + 1}행`);
          return;
        }
        const linkWarning = validateWikiLinkInner(match[2], fileStems, `SPLIT 제안 ${index + 1}행`);
        if (linkWarning) warnings.push(linkWarning);
        return;
      }
    });
  }

  return warnings;
}

function main() {
  const requestedFiles = process.argv.slice(2)
    .map(filename => path.basename(String(filename || '').trim()))
    .filter(Boolean);
  const files = requestedFiles.length > 0
    ? requestedFiles.filter(filename => !shouldSkipFile(filename))
    : fs.readdirSync(VAULT_PATH).filter(filename => !shouldSkipFile(filename));
  const fileStems = collectVaultFileStems();
  const failures = [];

  files.forEach(filename => {
    const warnings = validateFile(filename, fileStems);
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
