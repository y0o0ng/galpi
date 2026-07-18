'use strict';

const SAVED_NOTE_TYPES = new Set(['topic', 'council']);

function savedNoteTypeForModel(model) {
  return String(model || '').includes('의회') ? 'council' : 'topic';
}

function createNoteSaveStateReader(db) {
  if (!db?.prepare) throw new TypeError('SQLite DB 연결이 필요합니다.');
  const chunkColumns = new Set(
    db.prepare('PRAGMA table_info(note_chunks)').all().map(column => column.name),
  );
  const readyChunkClause = chunkColumns.has('index_status')
    ? "AND c.index_status = 'ready'"
    : '';
  const directTopicReadyClause = chunkColumns.has('index_status')
    ? `
      AND (
        n.note_type != 'topic'
        OR EXISTS (
          SELECT 1
          FROM note_chunks c
          WHERE c.note_filename = n.filename
            AND c.index_status = 'ready'
            AND (
              CAST(c.source_assistant_message AS TEXT) = CAST(n.source_message AS TEXT)
              OR CAST(c.source_user_message AS TEXT) = CAST(n.source_message AS TEXT)
            )
        )
      )`
    : '';

  const findDirect = db.prepare(`
    SELECT n.filename, n.title, n.note_type AS noteType
    FROM notes n
    WHERE n.source_message = ? AND n.note_type = ?
      ${directTopicReadyClause}
    ORDER BY n.updated_at DESC, n.id DESC
    LIMIT 1
  `);
  const findChunk = db.prepare(`
    SELECT c.note_filename AS filename, n.title, n.note_type AS noteType
    FROM note_chunks c
    JOIN notes n ON n.filename = c.note_filename
    WHERE (c.source_assistant_message = ? OR c.source_user_message = ?)
      AND n.note_type = ?
      ${readyChunkClause}
    ORDER BY c.updated_at DESC
    LIMIT 1
  `);
  const getMessage = db.prepare('SELECT model FROM messages WHERE id = ? LIMIT 1');
  const listSessionMessages = db.prepare(`
    SELECT m.id, m.role, m.content, m.model,
      CASE WHEN m.role = 'assistant' AND (
        EXISTS (
          SELECT 1 FROM notes n
          WHERE n.source_message = CAST(m.id AS TEXT)
            AND n.note_type = CASE
              WHEN instr(COALESCE(m.model, ''), '의회') > 0 THEN 'council'
              ELSE 'topic'
            END
            ${directTopicReadyClause}
        ) OR EXISTS (
          SELECT 1
          FROM note_chunks c
          JOIN notes n ON n.filename = c.note_filename
          WHERE (c.source_assistant_message = m.id OR c.source_user_message = m.id)
            AND n.note_type = CASE
              WHEN instr(COALESCE(m.model, ''), '의회') > 0 THEN 'council'
              ELSE 'topic'
            END
            ${readyChunkClause}
        )
      ) THEN 1 ELSE 0 END AS noteSaved
    FROM messages m
    WHERE m.session_id = ?
    ORDER BY m.created_at ASC, m.id ASC
  `);

  function find(messageId, noteType = 'topic') {
    if (!messageId) return null;
    if (!SAVED_NOTE_TYPES.has(noteType)) throw new TypeError('지원하지 않는 저장 노트 타입입니다.');
    const id = String(messageId);
    return findDirect.get(id, noteType) || findChunk.get(id, id, noteType) || null;
  }

  function findForMessage(messageId) {
    if (!messageId) return null;
    const message = getMessage.get(messageId);
    return message ? find(messageId, savedNoteTypeForModel(message.model)) : null;
  }

  return {
    find,
    findForMessage,
    listSessionMessages: sessionId => listSessionMessages.all(sessionId),
  };
}

module.exports = { createNoteSaveStateReader, savedNoteTypeForModel };
