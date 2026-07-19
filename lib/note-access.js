'use strict';

function parseAiReadable(value) {
  if (value === undefined) return true;
  const normalized = String(value).trim().replace(/^(["'])(.*)\1$/, '$2').toLowerCase();
  return normalized === 'true';
}

function aiReadableFromRaw(raw) {
  const frontmatter = String(raw || '').match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  if (frontmatter === undefined) return true;
  const value = frontmatter.match(/^ai_readable:\s*(.*)$/mi)?.[1];
  return parseAiReadable(value);
}

module.exports = { aiReadableFromRaw, parseAiReadable };
