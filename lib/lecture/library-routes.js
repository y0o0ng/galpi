'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { DEFAULT_LIMITS, readSingleAttachmentUpload } = require('../attachment-upload');
const { fail, idParam, text } = require('./http');

// 강의 노트 L1a: Container(과목|일반) · Document(PDF|백지) · 누적 필기.
// 설계 정본은 docs/Lecture-note-system_Design_v4.3.md §4.3·§8·§10.1.1, 구현 기록은 §17.2다.
const MIB = 1024 * 1024;
const PDF_MAX_BYTES = 200 * MIB;
const ANNOTATION_MAX_BYTES = 32 * MIB;

const ANNOTATION_PATH = /^\/api\/lecture\/documents\/[^/]+\/annotations\/?$/;
const isLectureAnnotationPut = req => req.method === 'PUT' && ANNOTATION_PATH.test(req.path);
const annotationJson = express.json({ limit: ANNOTATION_MAX_BYTES + 64 * 1024 });

function registerLibraryRoutes({ app, db, paths: { documentsDir, tmpDir } }) {
  const containerColumns = `c.id, c.type, c.name, c.color, c.favorite = 1 AS favorite, c.created_at AS createdAt, c.updated_at AS updatedAt,
    (SELECT COUNT(*) FROM lecture_documents d WHERE d.container_id = c.id) AS documentCount,
    (SELECT MAX(d.updated_at) FROM lecture_documents d WHERE d.container_id = c.id) AS lastDocumentAt,
    (SELECT d.title FROM lecture_documents d WHERE d.container_id = c.id ORDER BY d.updated_at DESC, d.id DESC LIMIT 1) AS lastDocumentTitle,
    (SELECT d.kind FROM lecture_documents d WHERE d.container_id = c.id ORDER BY d.updated_at DESC, d.id DESC LIMIT 1) AS lastDocumentKind`;
  const listContainers = db.prepare(`SELECT ${containerColumns} FROM lecture_containers c ORDER BY c.favorite DESC, COALESCE(lastDocumentAt, c.updated_at) DESC, c.id DESC`);
  const getContainer = db.prepare(`SELECT ${containerColumns} FROM lecture_containers c WHERE c.id = ?`);
  const insertContainer = db.prepare('INSERT INTO lecture_containers (type, name, color) VALUES (?, ?, ?)');
  const updateContainer = db.prepare("UPDATE lecture_containers SET name = ?, favorite = ?, updated_at = strftime('%s','now') WHERE id = ?");

  const documentColumns = `id, container_id AS containerId, kind, title, size_bytes AS sizeBytes, blank_pages AS blankPages,
    created_at AS createdAt, updated_at AS updatedAt,
    (SELECT revision FROM lecture_annotations a WHERE a.document_id = lecture_documents.id) AS revision`;
  const listDocuments = db.prepare(`SELECT ${documentColumns} FROM lecture_documents WHERE container_id = ? ORDER BY updated_at DESC, id DESC`);
  const getDocument = db.prepare(`SELECT ${documentColumns}, file_path AS filePath FROM lecture_documents WHERE id = ?`);
  const insertPdf = db.prepare("INSERT INTO lecture_documents (container_id, kind, title, file_path, sha256, size_bytes) VALUES (?, 'pdf', ?, ?, ?, ?)");
  const insertBlank = db.prepare("INSERT INTO lecture_documents (container_id, kind, title, blank_pages) VALUES (?, 'blank', ?, 1)");
  const touchDocument = db.prepare("UPDATE lecture_documents SET updated_at = strftime('%s','now') WHERE id = ?");
  const setBlankPages = db.prepare("UPDATE lecture_documents SET blank_pages = ?, updated_at = strftime('%s','now') WHERE id = ? AND kind = 'blank'");

  const getAnnotation = db.prepare('SELECT revision, body, device_id AS deviceId, updated_at AS updatedAt FROM lecture_annotations WHERE document_id = ?');
  const insertAnnotation = db.prepare("INSERT INTO lecture_annotations (document_id, revision, body, device_id) VALUES (?, 1, ?, ?)");
  const updateAnnotation = db.prepare("UPDATE lecture_annotations SET revision = revision + 1, body = ?, device_id = ?, updated_at = strftime('%s','now') WHERE document_id = ? AND revision = ?");

  const visibleDocument = key => {
    const doc = getDocument.get(key);
    if (!doc) return null;
    const { filePath, ...visible } = doc;
    return visible;
  };

  app.get('/api/lecture/containers', (_req, res) => res.json({ containers: listContainers.all() }));

  app.post('/api/lecture/containers', (req, res) => {
    const type = req.body?.type;
    const name = text(req.body?.name, 60);
    if (!['course', 'general'].includes(type) || !name || name.length > 60) return fail(res, 400, '유형(과목·일반)과 이름(1~60자)을 입력해 주세요.');
    const color = /^#[0-9a-fA-F]{6}$/.test(req.body?.color || '') ? req.body.color : null;
    const result = insertContainer.run(type, name, color);
    return res.status(201).json({ container: getContainer.get(result.lastInsertRowid) });
  });

  // 유형은 생성 뒤 바꾸지 않는다(설계 §4.3). 이름과 즐겨찾기만 바꾼다.
  app.patch('/api/lecture/containers/:id', (req, res) => {
    const key = idParam(req, res);
    if (key == null) return;
    const current = getContainer.get(key);
    if (!current) return fail(res, 404, '폴더를 찾을 수 없습니다.');
    if ('type' in (req.body || {})) return fail(res, 400, '폴더 유형은 바꿀 수 없습니다.', 'LECTURE_TYPE_IMMUTABLE');
    const name = req.body?.name === undefined ? current.name : text(req.body.name, 60);
    if (!name || name.length > 60) return fail(res, 400, '이름은 1~60자여야 합니다.');
    const favorite = req.body?.favorite === undefined ? current.favorite : Boolean(req.body.favorite);
    updateContainer.run(name, favorite ? 1 : 0, key);
    return res.json({ container: getContainer.get(key) });
  });

  app.get('/api/lecture/containers/:id/documents', (req, res) => {
    const key = idParam(req, res);
    if (key == null) return;
    if (!getContainer.get(key)) return fail(res, 404, '폴더를 찾을 수 없습니다.');
    return res.json({ documents: listDocuments.all(key) });
  });

  app.post('/api/lecture/containers/:id/blank', (req, res) => {
    const key = idParam(req, res);
    if (key == null) return;
    if (!getContainer.get(key)) return fail(res, 404, '폴더를 찾을 수 없습니다.');
    const title = text(req.body?.title, 120) || '새 노트';
    if (title.length > 120) return fail(res, 400, '제목은 120자 이하여야 합니다.');
    const result = insertBlank.run(key, title);
    return res.status(201).json({ document: visibleDocument(result.lastInsertRowid) });
  });

  // PDF는 같은 내용이면 파일 하나를 공유한다(sha256). 날짜별 사본을 만들지 않는다(설계 §4.3).
  app.post('/api/lecture/containers/:id/documents', async (req, res) => {
    const key = idParam(req, res);
    if (key == null) return;
    if (!getContainer.get(key)) return fail(res, 404, '폴더를 찾을 수 없습니다.');
    let candidate;
    try {
      candidate = await readSingleAttachmentUpload(req, { tmpDir, limits: { ...DEFAULT_LIMITS, pdf: PDF_MAX_BYTES } });
    } catch (error) {
      return fail(res, error.status || 400, error.message, error.code);
    }
    try {
      if (candidate.kind !== 'pdf') {
        await fsp.unlink(candidate.partialPath).catch(() => {});
        return fail(res, 415, '강의 자료는 PDF만 올릴 수 있습니다.', 'LECTURE_PDF_ONLY');
      }
      const finalPath = path.join(documentsDir, `${candidate.sha256}.pdf`);
      if (fs.existsSync(finalPath)) await fsp.unlink(candidate.partialPath);
      else await fsp.rename(candidate.partialPath, finalPath);
      const title = path.basename(candidate.originalName || 'document.pdf', path.extname(candidate.originalName || '.pdf')).slice(0, 120) || '자료';
      const result = insertPdf.run(key, title, finalPath, candidate.sha256, candidate.sizeBytes);
      return res.status(201).json({ document: visibleDocument(result.lastInsertRowid) });
    } catch (error) {
      await fsp.unlink(candidate.partialPath).catch(() => {});
      return fail(res, 500, 'PDF를 저장하지 못했습니다.', 'LECTURE_STORAGE_FAILED');
    }
  });

  app.get('/api/lecture/documents/:id', (req, res) => {
    const key = idParam(req, res);
    if (key == null) return;
    const doc = getDocument.get(key);
    if (!doc) return fail(res, 404, '자료를 찾을 수 없습니다.');
    return res.json({ document: visibleDocument(key), container: getContainer.get(doc.containerId) });
  });

  app.get('/api/lecture/documents/:id/file', (req, res) => {
    const key = idParam(req, res);
    if (key == null) return;
    const doc = getDocument.get(key);
    if (!doc || doc.kind !== 'pdf') return fail(res, 404, 'PDF를 찾을 수 없습니다.');
    const resolved = path.resolve(doc.filePath);
    if (!resolved.startsWith(path.resolve(documentsDir) + path.sep) || !fs.existsSync(resolved)) return fail(res, 404, 'PDF 파일이 없습니다.');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    return fs.createReadStream(resolved).pipe(res);
  });

  app.patch('/api/lecture/documents/:id/pages', (req, res) => {
    const key = idParam(req, res);
    if (key == null) return;
    const pages = Number(req.body?.blankPages);
    if (!Number.isSafeInteger(pages) || pages < 1 || pages > 500) return fail(res, 400, '페이지 수는 1~500이어야 합니다.');
    if (!setBlankPages.run(pages, key).changes) return fail(res, 404, '백지 노트를 찾을 수 없습니다.');
    return res.json({ document: visibleDocument(key) });
  });

  app.get('/api/lecture/documents/:id/annotations', (req, res) => {
    const key = idParam(req, res);
    if (key == null) return;
    if (!getDocument.get(key)) return fail(res, 404, '자료를 찾을 수 없습니다.');
    const row = getAnnotation.get(key);
    return res.json(row ? { revision: row.revision, body: JSON.parse(row.body), deviceId: row.deviceId, updatedAt: row.updatedAt } : { revision: 0, body: { pages: {} }, deviceId: null });
  });

  // 오래된 탭이 최신 필기를 덮어쓰지 못하게 baseRevision이 현재와 같을 때만 저장한다.
  // 다르면 409와 현재 서버본을 돌려주고, 자동 merge는 하지 않는다(설계 §8.3).
  app.put('/api/lecture/documents/:id/annotations', annotationJson, (req, res) => {
    const key = idParam(req, res);
    if (key == null) return;
    if (!getDocument.get(key)) return fail(res, 404, '자료를 찾을 수 없습니다.');
    const baseRevision = Number(req.body?.baseRevision);
    const body = req.body?.body;
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) return fail(res, 400, 'baseRevision이 필요합니다.');
    if (!body || typeof body !== 'object' || Array.isArray(body) || !body.pages || typeof body.pages !== 'object') return fail(res, 400, '필기 형식이 올바르지 않습니다.');
    const serialized = JSON.stringify(body);
    if (Buffer.byteLength(serialized) > ANNOTATION_MAX_BYTES) return fail(res, 413, '필기가 너무 큽니다.', 'LECTURE_ANNOTATION_TOO_LARGE');
    const deviceId = text(req.body?.deviceId, 80) || null;
    const saved = db.transaction(() => {
      const current = getAnnotation.get(key);
      if (!current) {
        if (baseRevision !== 0) return false;
        insertAnnotation.run(key, serialized, deviceId);
      } else if (!updateAnnotation.run(serialized, deviceId, key, baseRevision).changes) {
        return false;
      }
      touchDocument.run(key);
      return true;
    })();
    const row = getAnnotation.get(key);
    if (!saved) {
      return res.status(409).json({ error: '다른 기기에서 먼저 저장된 필기가 있습니다.', code: 'LECTURE_REVISION_CONFLICT', revision: row ? row.revision : 0, body: row ? JSON.parse(row.body) : { pages: {} }, deviceId: row?.deviceId ?? null });
    }
    return res.json({ revision: row.revision, updatedAt: row.updatedAt });
  });

}

module.exports = { registerLibraryRoutes, isLectureAnnotationPut };
