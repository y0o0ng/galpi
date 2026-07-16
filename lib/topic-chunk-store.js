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
  const updateEmbedding = db.prepare(
    'UPDATE note_chunks SET embedding = ? WHERE chunk_id = ?',
  );
  const listReadyByNote = db.prepare(`
    SELECT
      chunk_id AS chunkId,
      note_filename AS noteFilename,
      note_title AS noteTitle,
      chunk_type AS chunkType,
      content,
      content_sha256 AS contentSha256,
      index_status AS indexStatus,
      embedding,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM note_chunks
    WHERE note_filename = ?
      AND chunk_type = 'topic_qa'
      AND index_status = 'ready'
    ORDER BY created_at ASC, id ASC
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
  };
}

module.exports = { createTopicChunkStore };
