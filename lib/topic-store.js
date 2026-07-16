'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const QA_LOG_START = '<!-- QA-LOG-START -->';
const QA_LOG_END = '<!-- QA-LOG-END -->';
const QA_ID_PATTERN = /^qa-[a-f0-9]+(?:-[a-f0-9]+)*$/i;

function normalizeForHash(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(normalizeForHash(value), 'utf8').digest('hex');
}

function countOccurrences(raw, marker) {
  return String(raw || '').split(marker).length - 1;
}

function parseSimpleFrontmatter(raw) {
  const normalized = String(raw || '').replace(/\r\n?/g, '\n');
  const match = normalized.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!match) return { present: false, fields: {} };

  const fields = {};
  for (const line of match[1].split('\n')) {
    const parts = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!parts) continue;
    fields[parts[1]] = parts[2].trim().replace(/^"(.*)"$/, '$1');
  }
  return { present: true, fields };
}

function isTrue(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function issue(code, message, severity = 'error', extra = {}) {
  return { code, severity, message, ...extra };
}

function parseQaLog(raw) {
  const normalized = String(raw || '').replace(/\r\n?/g, '\n');
  const issues = [];
  const startCount = countOccurrences(normalized, QA_LOG_START);
  const endCount = countOccurrences(normalized, QA_LOG_END);

  if (startCount !== 1) {
    issues.push(issue(
      'qa_log_start_count',
      `QA-LOG 시작 마커가 1개여야 하지만 ${startCount}개입니다.`
    ));
  }
  if (endCount !== 1) {
    issues.push(issue(
      'qa_log_end_count',
      `QA-LOG 종료 마커가 1개여야 하지만 ${endCount}개입니다.`
    ));
  }
  if (startCount !== 1 || endCount !== 1) {
    return { parseable: false, entries: [], contentSha256: null, issues };
  }

  const start = normalized.indexOf(QA_LOG_START);
  const bodyStart = start + QA_LOG_START.length;
  const end = normalized.indexOf(QA_LOG_END, bodyStart);
  if (end < bodyStart) {
    issues.push(issue('qa_log_marker_order', 'QA-LOG 종료 마커가 시작 마커보다 앞에 있습니다.'));
    return { parseable: false, entries: [], contentSha256: null, issues };
  }

  const body = normalized.slice(bodyStart, end);
  const entryStartPattern = /^###\s+(\d{4}-\d{2}-\d{2})[^\n]*\n(?:[ \t]*\n)*[ \t]*<!--\s*qa_id:\s*([^>]+?)\s*-->/gm;
  const starts = [];
  let match;
  while ((match = entryStartPattern.exec(body)) !== null) {
    starts.push({
      index: match.index,
      markerIndex: match.index + match[0].lastIndexOf('<!--'),
      qaId: match[2].trim(),
      heading: match[0].slice(0, match[0].indexOf('\n')).trim(),
    });
  }

  const missingIdPattern = /^###\s+\d{4}-\d{2}-\d{2}[^\n]*\n(?:[ \t]*\n)*(?=\*\*(?:Q|내용):\*\*)/gm;
  while ((match = missingIdPattern.exec(body)) !== null) {
    if (!starts.some(entry => entry.index === match.index)) {
      issues.push(issue(
        'qa_id_missing',
        'Q&A 항목 제목 바로 뒤에 qa_id 마커가 없습니다.',
        'error',
        { offset: match.index }
      ));
    }
  }

  if (starts.length === 0) {
    if (body.trim()) {
      issues.push(issue('qa_log_unparseable', 'QA-LOG에 인식 가능한 Q&A 항목이 없습니다.'));
      return { parseable: false, entries: [], contentSha256: null, issues };
    }
    return { parseable: issues.every(item => item.severity !== 'error'), entries: [], contentSha256: sha256(''), issues };
  }

  if (body.slice(0, starts[0].index).trim()) {
    issues.push(issue('qa_log_unparsed_prefix', '첫 Q&A 항목 앞에 해석되지 않은 내용이 있습니다.'));
  }

  const expectedMarkerIndexes = new Set(starts.map(entry => entry.markerIndex));
  const markerPattern = /<!--\s*qa_id:\s*([^>]+?)\s*-->/g;
  while ((match = markerPattern.exec(body)) !== null) {
    if (!expectedMarkerIndexes.has(match.index)) {
      issues.push(issue(
        'qa_id_orphan_marker',
        `Q&A 제목과 연결되지 않은 qa_id 마커가 있습니다: ${match[1].trim()}`,
        'error',
        { qaId: match[1].trim() }
      ));
    }
  }

  const entries = starts.map((entryStart, index) => {
    const nextIndex = starts[index + 1]?.index ?? body.length;
    const content = normalizeForHash(body.slice(entryStart.index, nextIndex));
    const qaId = entryStart.qaId;

    if (!QA_ID_PATTERN.test(qaId)) {
      issues.push(issue(
        'qa_id_invalid',
        `qa_id 형식이 잘못되었습니다: ${qaId}`,
        'error',
        { qaId }
      ));
    }

    const withoutHeader = content
      .replace(/^###[^\n]*\n/, '')
      .replace(/^\s*<!--\s*qa_id:\s*[^>]+?\s*-->\s*/, '')
      .trim();
    if (!withoutHeader) {
      issues.push(issue('qa_entry_empty', `Q&A 항목 본문이 비어 있습니다: ${qaId}`, 'error', { qaId }));
    }

    return {
      qaId,
      heading: entryStart.heading,
      content,
      contentSha256: sha256(content),
    };
  });

  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.qaId)) {
      issues.push(issue(
        'qa_id_duplicate_in_note',
        `같은 노트에 qa_id가 중복되었습니다: ${entry.qaId}`,
        'error',
        { qaId: entry.qaId }
      ));
    }
    seen.add(entry.qaId);
  }

  const parseable = issues.every(item => item.severity !== 'error');
  return {
    parseable,
    entries,
    contentSha256: parseable ? sha256(entries.map(entry => entry.content).join('\n\n')) : null,
    issues,
  };
}

function parseTopicNote(raw, { filename = '' } = {}) {
  const frontmatter = parseSimpleFrontmatter(raw);
  const qaLog = parseQaLog(raw);
  const issues = [...qaLog.issues];

  if (!frontmatter.present) {
    issues.unshift(issue('frontmatter_missing', 'frontmatter가 없습니다.'));
  }

  const title = String(frontmatter.fields.title || filename.replace(/\.md$/i, '')).trim();
  return {
    filename,
    title,
    noteType: String(frontmatter.fields.note_type || '').trim(),
    archived: isTrue(frontmatter.fields.archived),
    frontmatter: frontmatter.fields,
    parseable: frontmatter.present && qaLog.parseable,
    entries: qaLog.entries,
    contentSha256: frontmatter.present && qaLog.parseable ? qaLog.contentSha256 : null,
    issues,
  };
}

function tableNames(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
}

function requiredTables(db) {
  const names = tableNames(db);
  const missing = ['notes', 'note_chunks'].filter(name => !names.has(name));
  if (missing.length > 0) throw new Error(`필수 테이블이 없습니다: ${missing.join(', ')}`);
  return names;
}

function rowArchived(row) {
  return Number(row.archived) === 1;
}

function stableSort(items, key) {
  return [...items].sort((a, b) => String(key(a)).localeCompare(String(key(b)), 'en'));
}

function groupBy(items, key) {
  const grouped = new Map();
  for (const item of items) {
    const value = key(item);
    if (!grouped.has(value)) grouped.set(value, []);
    grouped.get(value).push(item);
  }
  return grouped;
}

async function loadRootMarkdown(vaultPath) {
  const dirents = await fs.readdir(vaultPath, { withFileTypes: true });
  const filenames = dirents
    .filter(entry => entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.'))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en'));
  const files = new Map();

  for (const filename of filenames) {
    try {
      const raw = await fs.readFile(path.join(vaultPath, filename), 'utf8');
      files.set(filename, { filename, raw, readError: null, frontmatter: parseSimpleFrontmatter(raw) });
    } catch (error) {
      files.set(filename, { filename, raw: null, readError: error.message, frontmatter: { present: false, fields: {} } });
    }
  }
  return files;
}

function referenceFinding(chunk, field, value, reason) {
  return {
    chunkId: chunk.chunkId,
    noteFilename: chunk.noteFilename,
    field,
    value: String(value),
    reason,
  };
}

function checkMessageReference(chunk, field, value, messageIds) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value);
  if (!/^\d+$/.test(normalized)) return referenceFinding(chunk, field, value, 'invalid_format');
  if (!messageIds.has(normalized)) return referenceFinding(chunk, field, value, 'missing');
  return null;
}

async function auditTopicStore({ db, vaultPath }) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('SQLite DB 연결이 필요합니다.');
  if (!vaultPath) throw new TypeError('vaultPath가 필요합니다.');

  const tables = requiredTables(db);
  const noteRows = db.prepare(`
    SELECT filename, title, note_type AS noteType, archived
    FROM notes
    ORDER BY filename
  `).all();
  const chunkRows = db.prepare(`
    SELECT
      chunk_id AS chunkId,
      note_filename AS noteFilename,
      note_title AS noteTitle,
      chunk_type AS chunkType,
      source_session AS sourceSession,
      source_user_message AS sourceUserMessage,
      source_assistant_message AS sourceAssistantMessage,
      embedding
    FROM note_chunks
    WHERE chunk_type = 'topic_qa'
    ORDER BY note_filename, chunk_id
  `).all();
  const messageIds = tables.has('messages')
    ? new Set(db.prepare('SELECT id FROM messages').all().map(row => String(row.id)))
    : null;
  const sessionIds = tables.has('sessions')
    ? new Set(db.prepare('SELECT id FROM sessions').all().map(row => String(row.id)))
    : null;

  const files = await loadRootMarkdown(path.resolve(vaultPath));
  const notesByFilename = new Map(noteRows.map(row => [row.filename, row]));
  const activeDbTopics = noteRows.filter(row => row.noteType === 'topic' && !rowArchived(row));
  const activeFileTopics = [...files.values()].filter(file => (
    !file.readError
    && file.frontmatter.fields.note_type === 'topic'
    && !isTrue(file.frontmatter.fields.archived)
  ));
  const auditedFilenames = new Set([
    ...activeDbTopics.map(row => row.filename),
    ...activeFileTopics.map(file => file.filename),
  ]);

  const findings = {
    parserIssues: [],
    missingTopicFiles: [],
    untrackedTopicFiles: [],
    catalogDrift: [],
    fileOnlyQa: [],
    dbOnlyChunks: [],
    assignmentDrift: [],
    duplicateFileQaIds: [],
    duplicateDbChunkIds: [],
    unverifiableChunks: [],
    chunkTitleDrift: [],
    sourceReferenceErrors: [],
    orphanChunks: [],
    archivedChunks: [],
    wrongTypeChunks: [],
    missingEmbeddings: [],
  };

  const noteReports = [];
  const parsedByFilename = new Map();

  for (const filename of [...auditedFilenames].sort((a, b) => a.localeCompare(b, 'en'))) {
    const file = files.get(filename);
    const dbNote = notesByFilename.get(filename);
    let parsed = null;

    if (!file) {
      findings.missingTopicFiles.push({ filename, dbTitle: dbNote?.title || null });
    } else if (file.readError) {
      findings.parserIssues.push({
        filename,
        code: 'file_read_error',
        severity: 'error',
        message: file.readError,
      });
    } else {
      parsed = parseTopicNote(file.raw, { filename });
      parsedByFilename.set(filename, parsed);
      findings.parserIssues.push(...parsed.issues.map(item => ({ filename, ...item })));
    }

    if (!dbNote) {
      findings.untrackedTopicFiles.push({ filename, fileTitle: parsed?.title || null });
    } else if (parsed) {
      if (dbNote.noteType !== 'topic' || rowArchived(dbNote) || dbNote.title !== parsed.title) {
        findings.catalogDrift.push({
          filename,
          fileTitle: parsed.title,
          dbTitle: dbNote.title,
          dbNoteType: dbNote.noteType,
          dbArchived: rowArchived(dbNote),
        });
      }
    }

    noteReports.push({
      filename,
      title: parsed?.title || dbNote?.title || filename.replace(/\.md$/i, ''),
      filePresent: Boolean(file && !file.readError),
      dbPresent: Boolean(dbNote),
      parseable: Boolean(parsed?.parseable),
      qaCount: parsed?.entries.length || 0,
      dbChunkCount: chunkRows.filter(chunk => chunk.noteFilename === filename).length,
      contentSha256: parsed?.contentSha256 || null,
      qaEntries: (parsed?.entries || []).map(entry => ({
        qaId: entry.qaId,
        contentSha256: entry.contentSha256,
      })),
      issues: parsed?.issues || [],
      fileOnlyQaIds: [],
      dbOnlyChunkIds: [],
      assignmentDriftIds: [],
    });
  }

  const fileQaLocations = new Map();
  for (const [filename, parsed] of parsedByFilename) {
    if (!parsed.parseable) continue;
    for (const entry of parsed.entries) {
      if (!fileQaLocations.has(entry.qaId)) fileQaLocations.set(entry.qaId, []);
      fileQaLocations.get(entry.qaId).push({ filename, contentSha256: entry.contentSha256 });
    }
  }

  for (const [qaId, locations] of fileQaLocations) {
    if (locations.length > 1) {
      findings.duplicateFileQaIds.push({ qaId, filenames: locations.map(item => item.filename).sort() });
    }
  }

  const chunksById = groupBy(chunkRows, row => row.chunkId);
  for (const [chunkId, rows] of chunksById) {
    if (rows.length > 1) {
      findings.duplicateDbChunkIds.push({ chunkId, noteFilenames: rows.map(row => row.noteFilename).sort() });
    }
  }

  const activeDbChunks = chunkRows.filter(chunk => {
    const note = notesByFilename.get(chunk.noteFilename);
    return note?.noteType === 'topic' && !rowArchived(note);
  });
  const activeChunkIds = new Set(activeDbChunks.map(chunk => chunk.chunkId));
  const matchedQaIds = new Set();

  for (const [qaId, locations] of fileQaLocations) {
    if (locations.length !== 1) continue;
    const dbChunks = chunksById.get(qaId) || [];
    if (dbChunks.length === 0) {
      findings.fileOnlyQa.push({ qaId, filename: locations[0].filename });
      continue;
    }
    if (dbChunks.length !== 1) continue;
    if (dbChunks[0].noteFilename !== locations[0].filename) {
      findings.assignmentDrift.push({
        qaId,
        fileFilename: locations[0].filename,
        dbFilename: dbChunks[0].noteFilename,
      });
      continue;
    }
    if (activeChunkIds.has(qaId)) matchedQaIds.add(qaId);
  }

  for (const chunk of activeDbChunks) {
    const locations = fileQaLocations.get(chunk.chunkId) || [];
    if (locations.length > 0 || (chunksById.get(chunk.chunkId) || []).length > 1) continue;
    const parsed = parsedByFilename.get(chunk.noteFilename);
    if (parsed?.parseable) {
      findings.dbOnlyChunks.push({ chunkId: chunk.chunkId, filename: chunk.noteFilename });
    } else {
      findings.unverifiableChunks.push({ chunkId: chunk.chunkId, filename: chunk.noteFilename });
    }
  }

  for (const chunk of chunkRows) {
    const note = notesByFilename.get(chunk.noteFilename);
    if (!note) {
      findings.orphanChunks.push({ chunkId: chunk.chunkId, filename: chunk.noteFilename });
      continue;
    }
    if (rowArchived(note)) {
      findings.archivedChunks.push({ chunkId: chunk.chunkId, filename: chunk.noteFilename });
      continue;
    }
    if (note.noteType !== 'topic') {
      findings.wrongTypeChunks.push({ chunkId: chunk.chunkId, filename: chunk.noteFilename, noteType: note.noteType });
      continue;
    }

    const canonicalTitle = parsedByFilename.get(chunk.noteFilename)?.title || note.title;
    if (chunk.noteTitle !== canonicalTitle) {
      findings.chunkTitleDrift.push({
        chunkId: chunk.chunkId,
        filename: chunk.noteFilename,
        cachedTitle: chunk.noteTitle,
        currentTitle: canonicalTitle,
      });
    }
    if (!chunk.embedding) findings.missingEmbeddings.push({ chunkId: chunk.chunkId, filename: chunk.noteFilename });

    if (messageIds) {
      const userError = checkMessageReference(chunk, 'source_user_message', chunk.sourceUserMessage, messageIds);
      const assistantError = checkMessageReference(chunk, 'source_assistant_message', chunk.sourceAssistantMessage, messageIds);
      if (userError) findings.sourceReferenceErrors.push(userError);
      if (assistantError) findings.sourceReferenceErrors.push(assistantError);
    }
    if (sessionIds && chunk.sourceSession !== null && chunk.sourceSession !== undefined && chunk.sourceSession !== '') {
      if (!sessionIds.has(String(chunk.sourceSession))) {
        findings.sourceReferenceErrors.push(referenceFinding(
          chunk,
          'source_session',
          chunk.sourceSession,
          'missing'
        ));
      }
    }
  }

  const noteReportByFilename = new Map(noteReports.map(note => [note.filename, note]));
  for (const item of findings.fileOnlyQa) {
    noteReportByFilename.get(item.filename)?.fileOnlyQaIds.push(item.qaId);
  }
  for (const item of findings.dbOnlyChunks) {
    noteReportByFilename.get(item.filename)?.dbOnlyChunkIds.push(item.chunkId);
  }
  for (const item of findings.assignmentDrift) {
    noteReportByFilename.get(item.fileFilename)?.assignmentDriftIds.push(item.qaId);
    if (item.dbFilename !== item.fileFilename) {
      noteReportByFilename.get(item.dbFilename)?.assignmentDriftIds.push(item.qaId);
    }
  }

  for (const key of Object.keys(findings)) {
    findings[key] = stableSort(findings[key], item => (
      item.filename || item.noteFilename || item.qaId || item.chunkId || `${item.code}:${item.message}`
    ));
  }

  const malformedTopics = noteReports.filter(note => !note.parseable).length;
  const healthy = Object.values(findings).every(items => items.length === 0);
  return {
    healthy,
    summary: {
      vaultActiveTopics: activeFileTopics.length,
      dbActiveTopics: activeDbTopics.length,
      auditedTopics: noteReports.length,
      fileQaEntries: [...fileQaLocations.values()].reduce((sum, entries) => sum + entries.length, 0),
      dbActiveTopicChunks: activeDbChunks.length,
      matchedQa: matchedQaIds.size,
      malformedTopics,
      fileOnlyQa: findings.fileOnlyQa.length,
      dbOnlyChunks: findings.dbOnlyChunks.length,
      assignmentDrift: findings.assignmentDrift.length,
      duplicateFileQaIds: findings.duplicateFileQaIds.length,
      duplicateDbChunkIds: findings.duplicateDbChunkIds.length,
      chunkTitleDrift: findings.chunkTitleDrift.length,
      sourceReferenceErrors: findings.sourceReferenceErrors.length,
      orphanChunks: findings.orphanChunks.length,
      archivedChunks: findings.archivedChunks.length,
      missingEmbeddings: findings.missingEmbeddings.length,
      unverifiableChunks: findings.unverifiableChunks.length,
    },
    capabilities: {
      messageReferences: Boolean(messageIds),
      sessionReferences: Boolean(sessionIds),
    },
    notes: stableSort(noteReports, note => note.filename),
    findings,
  };
}

function formatList(items, formatter, limit = 20) {
  const shown = items.slice(0, limit).map(formatter);
  if (items.length > limit) shown.push(`  ... ${items.length - limit}개 더 있음`);
  return shown;
}

function formatTopicStoreAudit(report) {
  const { summary, findings } = report;
  const lines = [
    `Topic store audit: ${report.healthy ? 'passed' : 'needs attention'}`,
    `Topics: vault ${summary.vaultActiveTopics}, DB ${summary.dbActiveTopics}, audited ${summary.auditedTopics}`,
    `Q&A: file ${summary.fileQaEntries}, DB ${summary.dbActiveTopicChunks}, matched ${summary.matchedQa}`,
    `Findings: malformed ${summary.malformedTopics}, file-only ${summary.fileOnlyQa}, DB-only ${summary.dbOnlyChunks}, assignment ${summary.assignmentDrift}`,
    `Integrity: title drift ${summary.chunkTitleDrift}, source refs ${summary.sourceReferenceErrors}, orphan ${summary.orphanChunks}, archived chunks ${summary.archivedChunks}, missing embeddings ${summary.missingEmbeddings}`,
  ];

  const sections = [
    ['Parser issues', findings.parserIssues, item => `  - ${item.filename}: ${item.code} - ${item.message}`],
    ['Missing topic files', findings.missingTopicFiles, item => `  - ${item.filename}`],
    ['Untracked topic files', findings.untrackedTopicFiles, item => `  - ${item.filename}`],
    ['Catalog drift', findings.catalogDrift, item => `  - ${item.filename}: file="${item.fileTitle}" DB="${item.dbTitle}" type=${item.dbNoteType} archived=${item.dbArchived}`],
    ['File-only Q&A', findings.fileOnlyQa, item => `  - ${item.filename}: ${item.qaId}`],
    ['DB-only chunks', findings.dbOnlyChunks, item => `  - ${item.filename}: ${item.chunkId}`],
    ['Assignment drift', findings.assignmentDrift, item => `  - ${item.qaId}: file=${item.fileFilename}, DB=${item.dbFilename}`],
    ['Duplicate file Q&A IDs', findings.duplicateFileQaIds, item => `  - ${item.qaId}: ${item.filenames.join(', ')}`],
    ['Duplicate DB chunk IDs', findings.duplicateDbChunkIds, item => `  - ${item.chunkId}: ${item.noteFilenames.join(', ')}`],
    ['Unverifiable chunks', findings.unverifiableChunks, item => `  - ${item.filename}: ${item.chunkId}`],
    ['Chunk title drift', findings.chunkTitleDrift, item => `  - ${item.filename}/${item.chunkId}: "${item.cachedTitle}" -> "${item.currentTitle}"`],
    ['Source reference errors', findings.sourceReferenceErrors, item => `  - ${item.noteFilename}/${item.chunkId}: ${item.field}=${item.value} (${item.reason})`],
    ['Orphan chunks', findings.orphanChunks, item => `  - ${item.filename}: ${item.chunkId}`],
    ['Archived chunks', findings.archivedChunks, item => `  - ${item.filename}: ${item.chunkId}`],
    ['Wrong-type chunks', findings.wrongTypeChunks, item => `  - ${item.filename}: ${item.chunkId} (${item.noteType})`],
    ['Missing embeddings', findings.missingEmbeddings, item => `  - ${item.filename}: ${item.chunkId}`],
  ];

  for (const [title, items, formatter] of sections) {
    if (items.length === 0) continue;
    lines.push('', `${title} (${items.length})`, ...formatList(items, formatter));
  }
  return lines.join('\n');
}

module.exports = {
  QA_LOG_START,
  QA_LOG_END,
  normalizeForHash,
  sha256,
  parseSimpleFrontmatter,
  parseQaLog,
  parseTopicNote,
  auditTopicStore,
  formatTopicStoreAudit,
};
