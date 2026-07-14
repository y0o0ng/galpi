'use strict';

const DEFAULT_RECENT_SAVE_LIMIT = 30;
const MAX_RECENT_SAVE_LIMIT = 100;

function compactText(value, maxLength = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function createRecentSavesReader(db) {
  if (!db?.prepare) throw new TypeError('SQLite DB 연결이 필요합니다.');
  const statement = db.prepare(`
    SELECT d.id,
           d.question,
           d.answer_excerpt AS answerExcerpt,
           d.action,
           d.reason,
           d.qa_id AS qaId,
           d.note_filename AS noteFilename,
           n.title AS noteTitle,
           d.created_at AS createdAt
    FROM auto_save_decisions d
    JOIN notes n ON n.filename = d.note_filename
    WHERE d.decision = 'save'
      AND d.action IN ('created', 'appended')
      AND n.note_type = 'topic'
      AND n.archived = 0
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT ?
  `);

  return function listRecentSaves(limit = DEFAULT_RECENT_SAVE_LIMIT) {
    const parsedLimit = Number.parseInt(limit, 10);
    const boundedLimit = Math.min(
      MAX_RECENT_SAVE_LIMIT,
      Math.max(1, Number.isFinite(parsedLimit) ? parsedLimit : DEFAULT_RECENT_SAVE_LIMIT),
    );
    return statement.all(boundedLimit).map(row => ({
      id: row.id,
      text: compactText(row.question || row.answerExcerpt),
      action: row.action,
      reason: row.reason,
      qaId: row.qaId,
      note: { filename: row.noteFilename, title: row.noteTitle },
      createdAt: row.createdAt,
    }));
  };
}

module.exports = { compactText, createRecentSavesReader };
