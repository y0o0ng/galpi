'use strict';

const { sha256 } = require('./content-hash');

function createTopicChunkStore(db) {
  if (!db?.prepare) throw new TypeError('SQLite DB 연결이 필요합니다.');

  const upsertChunk = db.prepare(`
    INSERT INTO note_chunks (
      chunk_id, note_filename, note_title, chunk_type, content,
      source_session, source_user_message, source_assistant_message,
      content_sha256, index_status
    ) VALUES (
      @chunkId, @noteFilename, @noteTitle, @chunkType, @content,
      @sourceSession, @sourceUserMessage, @sourceAssistantMessage,
      @contentSha256, 'ready'
    )
    ON CONFLICT(chunk_id) DO UPDATE SET
      note_filename = excluded.note_filename,
      note_title = excluded.note_title,
      chunk_type = excluded.chunk_type,
      content = excluded.content,
      source_session = excluded.source_session,
      source_user_message = excluded.source_user_message,
      source_assistant_message = excluded.source_assistant_message,
      embedding = CASE
        WHEN note_chunks.content_sha256 = excluded.content_sha256 THEN note_chunks.embedding
        ELSE NULL
      END,
      content_sha256 = excluded.content_sha256,
      index_status = 'ready',
      updated_at = strftime('%s','now')
  `);
  const updateEmbedding = db.prepare(`
    UPDATE note_chunks
    SET embedding = ?
    WHERE chunk_id = ?
      AND EXISTS (
        SELECT 1
        FROM notes n
        WHERE n.filename = note_chunks.note_filename
          AND n.ai_readable = 1
          AND n.codex_status != 'recovery_required'
      )
  `);
  const listReadyByNote = db.prepare(`
    SELECT
      c.chunk_id AS chunkId,
      c.note_filename AS noteFilename,
      n.title AS noteTitle,
      c.chunk_type AS chunkType,
      c.content,
      c.content_sha256 AS contentSha256,
      c.index_status AS indexStatus,
      c.embedding,
      c.created_at AS createdAt,
      c.updated_at AS updatedAt
    FROM note_chunks c
    JOIN notes n ON n.filename = c.note_filename
    WHERE c.note_filename = ?
      AND c.chunk_type = 'topic_qa'
      AND c.index_status = 'ready'
      AND n.note_type = 'topic'
      AND n.archived = 0
      AND n.ai_readable = 1
      AND n.codex_status NOT IN ('running', 'recovery_required')
    ORDER BY c.created_at ASC, c.id ASC
  `);
  const listAllReady = db.prepare(`
    SELECT
      c.chunk_id AS chunkId,
      c.note_filename AS noteFilename,
      n.title AS noteTitle,
      c.chunk_type AS chunkType,
      c.content,
      c.content_sha256 AS contentSha256,
      c.index_status AS indexStatus,
      c.embedding,
      c.created_at AS createdAt,
      c.updated_at AS updatedAt
    FROM note_chunks c
    JOIN notes n ON n.filename = c.note_filename
    WHERE c.chunk_type = 'topic_qa'
      AND c.index_status = 'ready'
      AND n.note_type = 'topic'
      AND n.archived = 0
      AND n.ai_readable = 1
      AND n.codex_status NOT IN ('running', 'recovery_required')
    ORDER BY c.id ASC
  `);

  return {
    upsert(values) {
      const content = String(values.content || '');
      return upsertChunk.run({
        ...values,
        content,
        contentSha256: sha256(content),
        sourceSession: values.sourceSession || null,
        sourceUserMessage: values.sourceUserMessage || null,
        sourceAssistantMessage: values.sourceAssistantMessage || null,
      });
    },
    updateEmbedding(chunkId, embedding) {
      return updateEmbedding.run(embedding, chunkId);
    },
    listReadyByNote(filename) {
      return listReadyByNote.all(filename);
    },
    listAllReady() {
      return listAllReady.all();
    },
  };
}

module.exports = { createTopicChunkStore };
