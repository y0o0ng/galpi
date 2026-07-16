'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizeForHash, sha256 } = require('./content-hash');

const QA_LOG_START = '<!-- QA-LOG-START -->';
const QA_LOG_END = '<!-- QA-LOG-END -->';
const QA_ID_PATTERN = /^qa-[a-f0-9]+(?:-[a-f0-9]+)*$/i;

function stripGeneratedWebSources(value) {
  const normalized = String(value || '').replace(/\r\n?/g, '\n');
  const marker = '\n## Web sources\n';
  const markerIndex = normalized.indexOf(marker);
  return (markerIndex >= 0 ? normalized.slice(0, markerIndex) : normalized).trim();
}

function comparableQaEntryText(content) {
  const body = normalizeForHash(content)
    .replace(/^###[^\n]*(?:\n|$)/, '')
    .replace(/^\s*<!--\s*qa_id:\s*[^>]+?\s*-->\s*/, '')
    .trim();

  if (body.startsWith('**내용:**')) {
    const answer = stripGeneratedWebSources(body.slice('**내용:**'.length));
    return normalizeForHash(`Q:\nA: ${answer}`);
  }

  const answerMarker = '\n**A:**';
  const answerIndex = body.indexOf(answerMarker);
  if (!body.startsWith('**Q:**') || answerIndex < 0) return null;
  const question = body.slice('**Q:**'.length, answerIndex).trim();
  const answer = stripGeneratedWebSources(body.slice(answerIndex + answerMarker.length));
  return normalizeForHash(`Q: ${question}\nA: ${answer}`);
}

function comparableChunkText(content) {
  const body = normalizeForHash(content).replace(/^모델:[^\n]*(?:\n|$)/, '').trim();
  const answerMarker = '\nA:';
  const answerIndex = body.indexOf(answerMarker);
  if (!body.startsWith('Q:') || answerIndex < 0) return null;
  const question = body.slice('Q:'.length, answerIndex).trim();
  const answer = body.slice(answerIndex + answerMarker.length).trim();
  return normalizeForHash(`Q: ${question}\nA: ${answer}`);
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

    const comparableContent = comparableQaEntryText(content);
    return {
      qaId,
      heading: entryStart.heading,
      content,
      contentSha256: sha256(content),
      comparableContentSha256: comparableContent ? sha256(comparableContent) : null,
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

function columnNames(db, tableName) {
  return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map(row => row.name));
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

function matchingLegacyDecisionIds(chunk, field, value, autoSaveRows) {
  const normalized = String(value || '');
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(normalized)) return [];
  const decisionField = field === 'source_user_message'
    ? 'sourceUserMessage'
    : field === 'source_assistant_message'
      ? 'sourceAssistantMessage'
      : null;
  if (!decisionField) return [];

  return autoSaveRows
    .filter(row => (
      row.qaId === chunk.chunkId
      && row.noteFilename === chunk.noteFilename
      && String(row[decisionField] || '') === normalized
    ))
    .map(row => row.id);
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
  const chunkColumns = columnNames(db, 'note_chunks');
  const chunkRows = db.prepare(`
    SELECT
      chunk_id AS chunkId,
      note_filename AS noteFilename,
      note_title AS noteTitle,
      chunk_type AS chunkType,
      content,
      source_session AS sourceSession,
      source_user_message AS sourceUserMessage,
      source_assistant_message AS sourceAssistantMessage,
      embedding,
      ${chunkColumns.has('content_sha256') ? 'content_sha256' : 'NULL'} AS contentSha256,
      ${chunkColumns.has('index_status') ? 'index_status' : "'ready'"} AS indexStatus
    FROM note_chunks
    WHERE chunk_type = 'topic_qa'
    ORDER BY note_filename, chunk_id
  `).all();
  const autoSaveRows = tables.has('auto_save_decisions')
    ? db.prepare(`
      SELECT
        id,
        qa_id AS qaId,
        note_filename AS noteFilename,
        source_user_message AS sourceUserMessage,
        source_assistant_message AS sourceAssistantMessage,
        decision,
        action
      FROM auto_save_decisions
      WHERE qa_id IS NOT NULL
      ORDER BY qa_id, id
    `).all()
    : [];
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
  const observations = {
    sourceMissingChunks: [],
    legacySourceReferences: [],
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
        comparableContentSha256: entry.comparableContentSha256,
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
      fileQaLocations.get(entry.qaId).push({
        filename,
        noteTitle: parsed.title,
        heading: entry.heading,
        contentSha256: entry.contentSha256,
        comparableContentSha256: entry.comparableContentSha256,
      });
    }
  }

  for (const [qaId, locations] of fileQaLocations) {
    if (locations.length > 1) {
      findings.duplicateFileQaIds.push({ qaId, filenames: locations.map(item => item.filename).sort() });
    }
  }

  const readyChunkRows = chunkRows.filter(chunk => chunk.indexStatus === 'ready');
  const chunksById = groupBy(readyChunkRows, row => row.chunkId);
  const allChunksById = groupBy(chunkRows, row => row.chunkId);
  for (const [chunkId, rows] of allChunksById) {
    if (rows.length > 1) {
      findings.duplicateDbChunkIds.push({ chunkId, noteFilenames: rows.map(row => row.noteFilename).sort() });
    }
  }

  const activeDbChunks = readyChunkRows.filter(chunk => {
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
    if (chunk.indexStatus === 'source_missing') {
      observations.sourceMissingChunks.push({
        chunkId: chunk.chunkId,
        filename: chunk.noteFilename,
      });
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
      for (const referenceError of [userError, assistantError].filter(Boolean)) {
        const decisionIds = matchingLegacyDecisionIds(
          chunk,
          referenceError.field,
          referenceError.value,
          autoSaveRows,
        );
        if (decisionIds.length > 0) {
          observations.legacySourceReferences.push({
            chunkId: chunk.chunkId,
            noteFilename: chunk.noteFilename,
            field: referenceError.field,
            value: referenceError.value,
            reason: 'matching_auto_save_decision',
            autoSaveDecisionIds: decisionIds,
          });
        } else {
          findings.sourceReferenceErrors.push(referenceError);
        }
      }
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
  for (const key of Object.keys(observations)) {
    observations[key] = stableSort(observations[key], item => (
      item.filename || item.noteFilename || item.chunkId || `${item.field}:${item.value}`
    ));
  }

  const malformedTopics = noteReports.filter(note => !note.parseable).length;
  const healthy = Object.values(findings).every(items => items.length === 0);
  const fileQaEvidence = stableSort(
    [...fileQaLocations.entries()].flatMap(([qaId, locations]) => (
      locations.map(location => ({ qaId, ...location }))
    )),
    item => `${item.qaId}:${item.filename}`
  );
  const dbChunkEvidence = stableSort(chunkRows.map(chunk => {
    const comparableContent = comparableChunkText(chunk.content);
    return {
      chunkId: chunk.chunkId,
      noteFilename: chunk.noteFilename,
      noteTitle: chunk.noteTitle,
      contentSha256: chunk.content === null || chunk.content === undefined
        ? null
        : sha256(chunk.content),
      comparableContentSha256: comparableContent ? sha256(comparableContent) : null,
      sourceSession: chunk.sourceSession ?? null,
      sourceUserMessage: chunk.sourceUserMessage ?? null,
      sourceAssistantMessage: chunk.sourceAssistantMessage ?? null,
      contentSha256: chunk.contentSha256 || null,
      indexStatus: chunk.indexStatus,
    };
  }), item => `${item.chunkId}:${item.noteFilename}`);
  const autoSaveEvidence = stableSort(autoSaveRows.map(row => ({
    id: row.id,
    qaId: row.qaId,
    noteFilename: row.noteFilename,
    sourceUserMessage: row.sourceUserMessage ?? null,
    sourceAssistantMessage: row.sourceAssistantMessage ?? null,
    decision: row.decision,
    action: row.action,
  })), item => `${item.qaId}:${String(item.id).padStart(12, '0')}`);

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
      autoSaveDecisions: tables.has('auto_save_decisions'),
    },
    evidence: {
      fileQaEntries: fileQaEvidence,
      dbTopicChunks: dbChunkEvidence,
      autoSaveDecisions: autoSaveEvidence,
    },
    observations,
    notes: stableSort(noteReports, note => note.filename),
    findings,
  };
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'en'));
}

function buildTopicRepairPlan(report) {
  if (!report?.summary || !report?.findings) {
    throw new TypeError('topic audit report가 필요합니다.');
  }

  const findings = report.findings;
  const evidence = report.evidence || {};
  const fileEntries = evidence.fileQaEntries || [];
  const dbChunks = evidence.dbTopicChunks || [];
  const saveDecisions = evidence.autoSaveDecisions || [];
  const fileEntriesById = groupBy(fileEntries, item => item.qaId);
  const dbChunksById = groupBy(dbChunks, item => item.chunkId);
  const decisionsById = groupBy(saveDecisions, item => item.qaId);
  const operations = [];

  for (const finding of findings.duplicateFileQaIds || []) {
    const locations = fileEntriesById.get(finding.qaId) || [];
    const chunks = dbChunksById.get(finding.qaId) || [];
    const decisions = decisionsById.get(finding.qaId) || [];
    const locationNames = new Set(locations.map(item => item.filename));
    const ownerSignals = {
      dbAssignment: uniqueSorted(chunks.map(item => item.noteFilename).filter(name => locationNames.has(name))),
      autoSaveDecision: uniqueSorted(decisions
        .filter(item => item.decision === 'save')
        .map(item => item.noteFilename)
        .filter(name => locationNames.has(name))),
      contentMatch: uniqueSorted(locations
        .filter(location => location.comparableContentSha256 && chunks.some(chunk => (
          chunk.comparableContentSha256 === location.comparableContentSha256
        )))
        .map(item => item.filename)),
    };
    const strongOwners = uniqueSorted([
      ...ownerSignals.dbAssignment,
      ...ownerSignals.autoSaveDecision,
    ]);
    const strongCandidate = strongOwners.length === 1 ? strongOwners[0] : null;
    const ownerCandidate = strongCandidate
      && (ownerSignals.contentMatch.length === 0 || ownerSignals.contentMatch.includes(strongCandidate))
      ? strongCandidate
      : (strongOwners.length === 0 && ownerSignals.contentMatch.length === 1
        ? ownerSignals.contentMatch[0]
        : null);
    const identicalFileContent = uniqueSorted(locations.map(item => item.contentSha256)).length === 1;
    const otherLocations = ownerCandidate
      ? uniqueSorted(locations.map(item => item.filename).filter(name => name !== ownerCandidate))
      : [];

    operations.push({
      id: `duplicate-file-qa:${finding.qaId}`,
      kind: 'duplicate_file_qa',
      status: 'manual_review',
      target: { qaId: finding.qaId },
      reason: '같은 qa_id가 여러 Markdown Q&A에 있어 어느 본문이 ID를 유지할지 확인해야 합니다.',
      evidence: {
        locations,
        dbChunks: chunks,
        autoSaveDecisions: decisions,
        ownerSignals,
        identicalFileContent,
      },
      recommendation: {
        action: identicalFileContent && ownerCandidate
          ? 'remove_duplicate_file_entry'
          : 'resolve_duplicate_qa_id',
        preserveQaIdIn: ownerCandidate,
        removeDuplicateFrom: identicalFileContent ? otherLocations : [],
        assignNewQaIdIn: identicalFileContent ? [] : otherLocations,
      },
    });
  }

  for (const finding of findings.dbOnlyChunks || []) {
    const chunk = (dbChunksById.get(finding.chunkId) || [])
      .find(item => item.noteFilename === finding.filename) || null;
    const matchingFileEntries = chunk?.comparableContentSha256
      ? fileEntries.filter(item => item.comparableContentSha256 === chunk.comparableContentSha256)
      : [];
    const hasContentMatch = matchingFileEntries.length > 0;
    const indexedMatchingFileEntries = matchingFileEntries.filter(entry => (
      (dbChunksById.get(entry.qaId) || []).some(candidate => (
        candidate.noteFilename === entry.filename
        && candidate.comparableContentSha256 === entry.comparableContentSha256
      ))
    ));
    const hasIndexedReplacement = indexedMatchingFileEntries.length > 0;
    const needsReview = hasContentMatch && !hasIndexedReplacement;
    operations.push({
      id: `db-only-chunk:${finding.chunkId}:${finding.filename}`,
      kind: 'db_only_chunk',
      status: needsReview ? 'manual_review' : 'ready',
      target: { chunkId: finding.chunkId, filename: finding.filename },
      reason: needsReview
        ? 'DB-only 청크와 본문이 같은 Markdown Q&A가 있어 ID 변경 여부를 확인해야 합니다.'
        : (hasIndexedReplacement
          ? '같은 본문이 다른 qa_id로 이미 정상 인덱싱되어 있어 구형 청크를 회수에서 제외할 수 있습니다.'
          : 'DB 청크의 원본 Q&A를 Markdown에서 찾지 못했습니다.'),
      evidence: {
        dbChunk: chunk,
        matchingFileEntries,
        indexedMatchingFileEntries,
        autoSaveDecisions: decisionsById.get(finding.chunkId) || [],
      },
      recommendation: {
        action: needsReview ? 'reconcile_chunk_with_file_qa' : 'mark_source_missing',
      },
    });
  }

  const simpleFindingSpecs = [
    {
      key: 'fileOnlyQa', kind: 'file_only_qa', status: 'ready', action: 'reindex_file_qa',
      reason: 'Markdown에 정본 Q&A가 있지만 검색 청크가 없습니다.',
    },
    {
      key: 'chunkTitleDrift', kind: 'chunk_title_drift', status: 'ready', action: 'refresh_chunk_title_cache',
      reason: '청크의 호환용 제목 캐시가 현재 Markdown 제목과 다릅니다.',
    },
    {
      key: 'sourceReferenceErrors', kind: 'source_reference_error', status: 'manual_review', action: 'inspect_source_reference',
      reason: '원본 메시지 참조는 provenance이므로 자동으로 수정하지 않습니다.',
    },
    {
      key: 'archivedChunks', kind: 'archived_chunk', status: 'ready', action: 'exclude_archived_chunk',
      reason: '보관된 노트의 청크는 활성 회수에서 제외되어야 합니다.',
    },
    {
      key: 'missingEmbeddings', kind: 'missing_embedding', status: 'ready', action: 'rebuild_chunk_embedding',
      reason: '검색 가능한 청크에 임베딩이 없습니다.',
    },
  ];
  for (const spec of simpleFindingSpecs) {
    (findings[spec.key] || []).forEach((finding, index) => {
      const qaId = finding.qaId || null;
      const chunkId = finding.chunkId || null;
      const filename = finding.filename || finding.noteFilename || null;
      const evidenceId = qaId || chunkId;
      operations.push({
        id: `${spec.kind}:${qaId || chunkId || filename || 'unknown'}:${index + 1}`,
        kind: spec.kind,
        status: spec.status,
        target: { qaId, chunkId, filename },
        reason: spec.reason,
        evidence: {
          finding: { ...finding },
          fileEntries: evidenceId ? fileEntriesById.get(evidenceId) || [] : [],
          dbChunks: evidenceId ? dbChunksById.get(evidenceId) || [] : [],
          autoSaveDecisions: evidenceId ? decisionsById.get(evidenceId) || [] : [],
        },
        recommendation: { action: spec.action },
      });
    });
  }

  const handledKeys = new Set([
    'duplicateFileQaIds',
    'dbOnlyChunks',
    ...simpleFindingSpecs.map(spec => spec.key),
  ]);
  for (const [key, items] of Object.entries(findings)) {
    if (handledKeys.has(key)) continue;
    (items || []).forEach((finding, index) => {
      const targetId = finding.qaId || finding.chunkId || finding.filename || finding.noteFilename || index + 1;
      operations.push({
        id: `manual-review:${key}:${targetId}:${index + 1}`,
        kind: key,
        status: 'manual_review',
        target: {
          qaId: finding.qaId || null,
          chunkId: finding.chunkId || null,
          filename: finding.filename || finding.noteFilename || null,
        },
        reason: '아직 자동 복구 규칙이 없는 무결성 문제입니다.',
        evidence: { ...finding },
        recommendation: { action: `inspect_${key}` },
      });
    });
  }

  const sortedOperations = stableSort(operations, item => item.id);
  const readyOperations = sortedOperations.filter(item => item.status === 'ready').length;
  const manualReviewOperations = sortedOperations.length - readyOperations;
  const status = manualReviewOperations > 0
    ? 'manual_review'
    : (readyOperations > 0 ? 'ready' : 'clean');
  const inputSha256 = sha256(JSON.stringify({
    summary: report.summary,
    notes: report.notes,
    findings: report.findings,
    evidence: report.evidence,
    observations: report.observations || {},
  }));

  return {
    version: 1,
    mode: 'dry-run',
    status,
    inputSha256,
    summary: {
      totalOperations: sortedOperations.length,
      readyOperations,
      manualReviewOperations,
    },
    auditSummary: report.summary,
    operations: sortedOperations,
  };
}

function formatTopicRepairPlan(plan) {
  const labels = {
    clean: 'clean',
    ready: 'ready for reviewed apply',
    manual_review: 'manual review required',
  };
  const lines = [
    `Topic repair plan: ${labels[plan.status] || plan.status}`,
    'Mode: dry-run (files and DB are not modified)',
    `Input SHA-256: ${plan.inputSha256}`,
    `Operations: total ${plan.summary.totalOperations}, ready ${plan.summary.readyOperations}, manual ${plan.summary.manualReviewOperations}`,
  ];

  const describe = operation => {
    const target = operation.target || {};
    const targetText = target.qaId || target.chunkId || target.filename || operation.id;
    const action = operation.recommendation?.action || 'inspect';
    const owner = operation.recommendation?.preserveQaIdIn
      ? `, preserve=${operation.recommendation.preserveQaIdIn}`
      : '';
    return `  - ${operation.kind} ${targetText}: ${action}${owner}`;
  };
  const manual = plan.operations.filter(item => item.status === 'manual_review');
  const ready = plan.operations.filter(item => item.status === 'ready');
  if (manual.length > 0) lines.push('', `Manual review (${manual.length})`, ...formatList(manual, describe));
  if (ready.length > 0) lines.push('', `Ready after backup and approval (${ready.length})`, ...formatList(ready, describe));
  return lines.join('\n');
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
  const observations = report.observations || {};
  if (observations.sourceMissingChunks?.length > 0) {
    lines.push(
      '',
      `Source-missing chunks (${observations.sourceMissingChunks.length})`,
      ...formatList(
        observations.sourceMissingChunks,
        item => `  - ${item.filename}: ${item.chunkId}`,
      ),
    );
  }
  if (observations.legacySourceReferences?.length > 0) {
    lines.push(
      '',
      `Legacy source references (${observations.legacySourceReferences.length})`,
      ...formatList(
        observations.legacySourceReferences,
        item => `  - ${item.noteFilename}/${item.chunkId}: ${item.field} (${item.reason})`,
      ),
    );
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
  buildTopicRepairPlan,
  formatTopicStoreAudit,
  formatTopicRepairPlan,
};
