'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fail, idParam } = require('./http');

// 강의 노트 `최근 삭제`(2026-09-30 사용자 결정). 자료·강의를 지우면 deleted_at만 찍어 목록에서 숨기고,
// 30일 뒤 실제로 지운다. 강의를 실제로 지울 때는 그 강의 시각이 붙은 획도 자료 필기에서 뺀다 — 휴지통에
// 있는 동안은 화면에서만 숨기므로 되돌리면 그대로 돌아온다.
const RETENTION_SECONDS = 30 * 24 * 60 * 60;
const TRASH_WRITER = 'server:lecture-trash';

function registerTrashRoutes({ app, db, paths: { documentsDir } }) {
  const nowSeconds = () => Math.floor(Date.now() / 1000);
  const trashDocument = db.prepare('UPDATE lecture_documents SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL');
  const trashSession = db.prepare('UPDATE lecture_sessions SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL');
  const restoreDocument = db.prepare(`UPDATE lecture_documents SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL
    AND container_id IN (SELECT id FROM lecture_containers WHERE deleted_at IS NULL)`);
  const restoreSession = db.prepare(`UPDATE lecture_sessions SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL
    AND container_id IN (SELECT id FROM lecture_containers WHERE deleted_at IS NULL)`);
  const listTrash = db.prepare(`
    SELECT 'document' AS type, d.id, d.title, d.kind AS detail, c.name AS containerName, d.deleted_at AS deletedAt
      FROM lecture_documents d JOIN lecture_containers c ON c.id = d.container_id WHERE d.deleted_at IS NOT NULL
    UNION ALL
    SELECT 'session' AS type, s.id, s.local_date AS title,
      (SELECT COALESCE(SUM(p.session_end_ms - p.session_start_ms), 0) FROM lecture_audio_parts p WHERE p.session_id = s.id) AS detail,
      c.name AS containerName, s.deleted_at AS deletedAt
      FROM lecture_sessions s JOIN lecture_containers c ON c.id = s.container_id WHERE s.deleted_at IS NOT NULL
    ORDER BY deletedAt DESC`);
  const expiredDocuments = db.prepare('SELECT id FROM lecture_documents WHERE deleted_at IS NOT NULL AND deleted_at <= ?');
  const expiredSessions = db.prepare('SELECT id FROM lecture_sessions WHERE deleted_at IS NOT NULL AND deleted_at <= ?');
  const trashedDocument = db.prepare('SELECT id, file_path AS filePath FROM lecture_documents WHERE id = ? AND deleted_at IS NOT NULL');
  const trashedSession = db.prepare('SELECT id, container_id AS containerId FROM lecture_sessions WHERE id = ? AND deleted_at IS NOT NULL');
  const fileUsers = db.prepare('SELECT COUNT(*) AS n FROM lecture_documents WHERE file_path = ?');
  const sessionParts = db.prepare('SELECT file_path AS filePath FROM lecture_audio_parts WHERE session_id = ?');
  const containerAnnotations = db.prepare(`SELECT a.document_id AS documentId, a.body FROM lecture_annotations a
    JOIN lecture_documents d ON d.id = a.document_id WHERE d.container_id = ?`);
  const rewriteAnnotation = db.prepare(`UPDATE lecture_annotations SET revision = revision + 1, body = ?, device_id = ?,
    updated_at = strftime('%s','now') WHERE document_id = ?`);
  const purgeDocumentRows = db.transaction(id => {
    db.prepare('DELETE FROM lecture_annotations WHERE document_id = ?').run(id);
    db.prepare('DELETE FROM lecture_session_events WHERE document_id = ?').run(id);
    // 마커는 강의에 속한다. 자료만 사라지면 자료 연결만 끊는다.
    db.prepare('UPDATE lecture_session_markers SET document_id = NULL WHERE document_id = ?').run(id);
    db.prepare('DELETE FROM lecture_documents WHERE id = ?').run(id);
  });
  const purgeSessionRows = db.transaction((id, containerId) => {
    // 그 강의 시각이 붙은 획을 자료 필기에서 뺀다. 필기 정본이 바뀌므로 revision을 올린다.
    containerAnnotations.all(containerId).forEach(({ documentId, body }) => {
      const parsed = JSON.parse(body);
      let changed = false;
      Object.keys(parsed.pages || {}).forEach(page => {
        const kept = parsed.pages[page].filter(stroke => stroke.source_session_id !== id);
        if (kept.length !== parsed.pages[page].length) { parsed.pages[page] = kept; changed = true; }
      });
      if (changed) rewriteAnnotation.run(JSON.stringify(parsed), TRASH_WRITER, documentId);
    });
    db.prepare('DELETE FROM lecture_session_markers WHERE session_id = ?').run(id);
    db.prepare('DELETE FROM lecture_session_events WHERE session_id = ?').run(id);
    db.prepare('DELETE FROM lecture_audio_parts WHERE session_id = ?').run(id);
    db.prepare('DELETE FROM lecture_sessions WHERE id = ?').run(id);
  });

  function purgeDocument(id) {
    const doc = trashedDocument.get(id);
    if (!doc) return false;
    purgeDocumentRows(id);
    // 같은 PDF를 다른 자료(휴지통 포함)가 쓰고 있으면 파일은 남긴다.
    if (doc.filePath && !fileUsers.get(doc.filePath).n) {
      const resolved = path.resolve(doc.filePath);
      if (resolved.startsWith(path.resolve(documentsDir) + path.sep)) fs.rmSync(resolved, { force: true });
    }
    return true;
  }

  function purgeSession(id) {
    const session = trashedSession.get(id);
    if (!session) return false;
    const files = sessionParts.all(id).map(part => part.filePath);
    purgeSessionRows(id, session.containerId);
    files.forEach(file => fs.rmSync(file, { force: true }));
    if (files.length) fs.rmSync(path.dirname(files[0]), { recursive: true, force: true });
    return true;
  }

  function purgeExpired() {
    const cutoff = nowSeconds() - RETENTION_SECONDS;
    expiredDocuments.all(cutoff).forEach(({ id }) => purgeDocument(id));
    expiredSessions.all(cutoff).forEach(({ id }) => purgeSession(id));
  }

  const kinds = { document: { trash: trashDocument, restore: restoreDocument, purge: purgeDocument }, session: { trash: trashSession, restore: restoreSession, purge: purgeSession } };
  const kindParam = (req, res) => {
    const kind = kinds[req.params.type];
    if (!kind) fail(res, 404, '알 수 없는 항목입니다.');
    return kind;
  };

  app.delete('/api/lecture/documents/:id', (req, res) => {
    const key = idParam(req, res);
    if (key == null) return;
    if (!trashDocument.run(nowSeconds(), key).changes) return fail(res, 404, '자료를 찾을 수 없습니다.');
    return res.json({ trashed: true });
  });

  // 녹음 중인 강의는 화면이 막는다. 서버는 녹음 상태를 모른다.
  app.delete('/api/lecture/sessions/:id', (req, res) => {
    const key = idParam(req, res);
    if (key == null) return;
    if (!trashSession.run(nowSeconds(), key).changes) return fail(res, 404, '강의를 찾을 수 없습니다.');
    return res.json({ trashed: true });
  });

  app.get('/api/lecture/trash', (_req, res) => res.json({
    items: listTrash.all().map(item => ({ ...item, purgeAt: item.deletedAt + RETENTION_SECONDS })),
  }));

  app.post('/api/lecture/trash/:type/:id/restore', (req, res) => {
    const kind = kindParam(req, res);
    const key = kind && idParam(req, res);
    if (key == null || !kind) return;
    if (!kind.restore.run(key).changes) return fail(res, 404, '되돌릴 항목이 없습니다.');
    return res.json({ restored: true });
  });

  app.delete('/api/lecture/trash/:type/:id', (req, res) => {
    const kind = kindParam(req, res);
    const key = kind && idParam(req, res);
    if (key == null || !kind) return;
    if (!kind.purge(key)) return fail(res, 404, '지울 항목이 없습니다.');
    return res.json({ purged: true });
  });

  return { purgeExpired };
}

module.exports = { registerTrashRoutes, RETENTION_SECONDS };
