'use strict';

const { sha256 } = require('./content-hash');
const { parseTopicNote } = require('./topic-store');

const NOTE_INDEX_STATUSES = new Set(['pending', 'ready', 'error', 'missing']);

function stripFrontmatter(raw) {
  return String(raw || '').replace(/^---[\s\S]*?---\r?\n?/, '').trim();
}

function buildSemanticEmbeddingText(title, raw) {
  const body = stripFrontmatter(raw)
    .replace(/<!-- CODEX-TAGS-START -->[\s\S]*?<!-- CODEX-TAGS-END -->/g, '')
    .replace(/<!-- CODEX-LINKS-START -->[\s\S]*?<!-- CODEX-LINKS-END -->/g, '')
    .replace(/<!-- CODEX-PROPOSALS-START -->[\s\S]*?<!-- CODEX-PROPOSALS-END -->/g, '')
    .replace(/<!-- CODEX-SUMMARY-START -->|<!-- CODEX-SUMMARY-END -->/g, '')
    .replace(/<!-- QA-LOG-START -->|<!-- QA-LOG-END -->/g, '')
    .replace(/^---+$/gm, '')
    .trim();
  return `${title || ''}\n${body}`.trim();
}

function noteContentSha256({ filename = '', title = '', noteType, raw }) {
  if (noteType === 'topic') {
    const parsed = parseTopicNote(raw, { filename });
    if (!parsed.parseable || parsed.noteType !== 'topic' || !parsed.contentSha256) {
      const detail = parsed.issues.map(item => `${item.code}: ${item.message}`).join('; ');
      throw new Error(`${filename || 'topic note'}의 정규화 QA-LOG hash를 만들 수 없습니다${detail ? `: ${detail}` : ''}`);
    }
    return parsed.contentSha256;
  }
  return sha256(buildSemanticEmbeddingText(title, raw));
}

function deriveNoteIndexState(values) {
  try {
    return {
      contentSha256: noteContentSha256(values),
      indexStatus: 'pending',
      error: null,
    };
  } catch (error) {
    return { contentSha256: null, indexStatus: 'error', error };
  }
}

function createNoteIndexStateStore(db) {
  if (!db?.prepare) throw new TypeError('SQLite DB 연결이 필요합니다.');

  const getState = db.prepare(`
    SELECT filename, content_sha256 AS contentSha256,
           indexed_sha256 AS indexedSha256, index_status AS indexStatus,
           embedding
    FROM notes
    WHERE filename = ?
    LIMIT 1
  `);
  const markContent = db.prepare(`
    UPDATE notes
    SET content_sha256 = @contentSha256,
        index_status = CASE
          WHEN @indexStatus = 'error' THEN 'error'
          WHEN indexed_sha256 = @contentSha256 AND embedding IS NOT NULL THEN 'ready'
          ELSE 'pending'
        END,
        updated_at = strftime('%s','now')
    WHERE filename = @filename
  `);
  const markReady = db.prepare(`
    UPDATE notes
    SET embedding = @embedding,
        indexed_sha256 = @contentSha256,
        index_status = 'ready',
        updated_at = strftime('%s','now')
    WHERE filename = @filename
      AND content_sha256 = @contentSha256
  `);
  const markError = db.prepare(`
    UPDATE notes
    SET index_status = 'error',
        updated_at = strftime('%s','now')
    WHERE filename = @filename
      AND content_sha256 = @contentSha256
      AND index_status != 'ready'
  `);
  const markMissing = db.prepare(`
    UPDATE notes
    SET index_status = 'missing',
        updated_at = strftime('%s','now')
    WHERE filename = ?
  `);

  return {
    get(filename) {
      return getState.get(filename) || null;
    },
    markContent({ filename, contentSha256, indexStatus = 'pending' }) {
      if (!NOTE_INDEX_STATUSES.has(indexStatus) || !['pending', 'error'].includes(indexStatus)) {
        throw new TypeError(`지원하지 않는 content 상태입니다: ${indexStatus}`);
      }
      if (indexStatus === 'pending' && !contentSha256) {
        throw new TypeError('pending 노트에는 contentSha256이 필요합니다.');
      }
      return markContent.run({ filename, contentSha256: contentSha256 || null, indexStatus });
    },
    markReady({ filename, contentSha256, embedding }) {
      if (!contentSha256 || !embedding) throw new TypeError('ready 노트에는 contentSha256과 embedding이 필요합니다.');
      return markReady.run({ filename, contentSha256, embedding });
    },
    markError({ filename, contentSha256 }) {
      if (!contentSha256) throw new TypeError('error 상태 갱신에는 contentSha256이 필요합니다.');
      return markError.run({ filename, contentSha256 });
    },
    markMissing(filename) {
      return markMissing.run(filename);
    },
  };
}

module.exports = {
  NOTE_INDEX_STATUSES,
  buildSemanticEmbeddingText,
  createNoteIndexStateStore,
  deriveNoteIndexState,
  noteContentSha256,
};
