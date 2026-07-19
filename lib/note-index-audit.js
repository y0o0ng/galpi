'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { deriveNoteIndexState } = require('./note-index-state');
const { aiReadableFromRaw } = require('./note-access');

function columnNames(db, tableName) {
  return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map(row => row.name));
}

async function listMarkdown(dirpath) {
  const entries = await fs.readdir(dirpath, { withFileTypes: true }).catch(error => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.'))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en'));
}

async function auditNoteIndex({ db, vaultPath }) {
  if (!db?.prepare) throw new TypeError('SQLite DB 연결이 필요합니다.');
  if (!vaultPath) throw new TypeError('vaultPath가 필요합니다.');
  const columns = columnNames(db, 'notes');
  const required = ['content_sha256', 'indexed_sha256', 'index_status', 'ai_readable'];
  const missingColumns = required.filter(column => !columns.has(column));
  if (missingColumns.length > 0) {
    throw new Error(`note index audit에는 schema v5가 필요합니다: ${missingColumns.join(', ')}`);
  }

  const root = path.resolve(vaultPath);
  const archive = path.join(root, '_archive');
  const [rootFiles, archiveFiles] = await Promise.all([
    listMarkdown(root),
    listMarkdown(archive),
  ]);
  const locations = new Map();
  for (const filename of rootFiles) locations.set(filename, [{ filepath: path.join(root, filename), archived: false }]);
  for (const filename of archiveFiles) {
    const current = locations.get(filename) || [];
    current.push({ filepath: path.join(archive, filename), archived: true });
    locations.set(filename, current);
  }

  const rows = db.prepare(`
    SELECT filename, title, note_type AS noteType, archived, embedding,
           ai_readable AS aiReadable,
           content_sha256 AS contentSha256, indexed_sha256 AS indexedSha256,
           index_status AS indexStatus
    FROM notes
    ORDER BY filename
  `).all();
  const rowsByFilename = new Map(rows.map(row => [row.filename, row]));
  const findings = {
    duplicateFiles: [],
    untrackedFiles: [],
    missingSources: [],
    malformedSources: [],
    contentHashDrift: [],
    indexStateDrift: [],
    aiReadAccessDrift: [],
  };
  const notes = [];

  for (const [filename, entries] of locations) {
    if (entries.length > 1) findings.duplicateFiles.push({ filename });
    if (!rowsByFilename.has(filename)) findings.untrackedFiles.push({ filename, archived: entries[0].archived });
  }

  for (const row of rows) {
    const entries = locations.get(row.filename) || [];
    const entry = entries.find(item => item.archived === Boolean(row.archived)) || entries[0] || null;
    if (!entry) {
      findings.missingSources.push({ filename: row.filename, recordedStatus: row.indexStatus });
      notes.push({ filename: row.filename, filePresent: false, indexStatus: row.indexStatus });
      continue;
    }

    let raw;
    try {
      raw = await fs.readFile(entry.filepath, 'utf8');
    } catch (error) {
      findings.malformedSources.push({ filename: row.filename, error: error.message });
      notes.push({ filename: row.filename, filePresent: true, readable: false, indexStatus: row.indexStatus });
      continue;
    }
    const derived = deriveNoteIndexState({
      filename: row.filename,
      title: row.title,
      noteType: row.noteType,
      raw,
    });
    const fileAiReadable = aiReadableFromRaw(raw);
    if (Boolean(row.aiReadable) !== fileAiReadable) {
      findings.aiReadAccessDrift.push({
        filename: row.filename,
        database: Boolean(row.aiReadable),
        frontmatter: fileAiReadable,
      });
    }
    if (derived.error) {
      findings.malformedSources.push({ filename: row.filename, recordedStatus: row.indexStatus });
    } else if (row.contentSha256 !== derived.contentSha256) {
      findings.contentHashDrift.push({
        filename: row.filename,
        recordedSha256: row.contentSha256,
        currentSha256: derived.contentSha256,
      });
    }

    const active = !Boolean(row.archived) && Boolean(row.aiReadable);
    if (active && !derived.error && (
      row.indexStatus !== 'ready'
      || !row.embedding
      || row.indexedSha256 !== derived.contentSha256
    )) {
      findings.indexStateDrift.push({
        filename: row.filename,
        indexStatus: row.indexStatus,
        contentSha256: row.contentSha256,
        indexedSha256: row.indexedSha256,
        hasEmbedding: Boolean(row.embedding),
      });
    }
    notes.push({
      filename: row.filename,
      filePresent: true,
      readable: true,
      archived: Boolean(row.archived),
      aiReadable: Boolean(row.aiReadable),
      indexStatus: row.indexStatus,
      contentMatches: !derived.error && row.contentSha256 === derived.contentSha256,
      indexedMatches: !derived.error && row.indexedSha256 === derived.contentSha256,
    });
  }

  const healthy = Object.values(findings).every(items => items.length === 0);
  return {
    healthy,
    summary: {
      dbNotes: rows.length,
      vaultNotes: locations.size,
      ready: rows.filter(row => row.indexStatus === 'ready').length,
      pending: rows.filter(row => row.indexStatus === 'pending').length,
      error: rows.filter(row => row.indexStatus === 'error').length,
      missing: rows.filter(row => row.indexStatus === 'missing').length,
      findings: Object.values(findings).reduce((sum, items) => sum + items.length, 0),
    },
    notes,
    findings,
  };
}

function formatNoteIndexAudit(report) {
  const { summary, findings } = report;
  const lines = [
    `Note index audit: ${report.healthy ? 'passed' : 'needs attention'}`,
    `Notes: DB ${summary.dbNotes}, vault ${summary.vaultNotes}`,
    `States: ready ${summary.ready}, pending ${summary.pending}, error ${summary.error}, missing ${summary.missing}`,
    `Findings: ${summary.findings}`,
  ];
  const sections = [
    ['Duplicate files', findings.duplicateFiles],
    ['Untracked files', findings.untrackedFiles],
    ['Missing sources', findings.missingSources],
    ['Malformed sources', findings.malformedSources],
    ['Content hash drift', findings.contentHashDrift],
    ['Index state drift', findings.indexStateDrift],
    ['AI read access drift', findings.aiReadAccessDrift],
  ];
  for (const [label, items] of sections) {
    if (items.length === 0) continue;
    lines.push('', `${label} (${items.length})`, ...items.slice(0, 20).map(item => `  - ${item.filename}`));
    if (items.length > 20) lines.push(`  ... ${items.length - 20}개 더 있음`);
  }
  return lines.join('\n');
}

module.exports = { auditNoteIndex, formatNoteIndexAudit };
