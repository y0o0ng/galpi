'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { DEFAULT_LIMITS, readSingleAttachmentUpload } = require('./attachment-upload');

// 강의 노트 L1a: Container(과목|일반) · Document(PDF|백지) · 누적 필기.
// 설계 정본은 docs/Lecture-note-system_Design_v4.3.md §4.3·§8·§10.1.1이다.
const MIB = 1024 * 1024;
const PDF_MAX_BYTES = 200 * MIB;
const ANNOTATION_MAX_BYTES = 32 * MIB;
// 스파이크 실측 약 19KB/s → 3시간 약 200MB. 한 파트는 일시정지 사이의 한 구간이다.
const AUDIO_PART_MAX_BYTES = 600 * MIB;
const AUDIO_EXTENSIONS = { 'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg' };
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;

const ANNOTATION_PATH = /^\/api\/lecture\/documents\/[^/]+\/annotations\/?$/;
const isLectureAnnotationPut = req => req.method === 'PUT' && ANNOTATION_PATH.test(req.path);
const annotationJson = express.json({ limit: ANNOTATION_MAX_BYTES + 64 * 1024 });

function registerLectureRoutes({ app, db, dataDir }) {
  const lectureDir = path.join(dataDir, 'lecture');
  const documentsDir = path.join(lectureDir, 'documents');
  const tmpDir = path.join(lectureDir, 'tmp');
  const audioDir = path.join(lectureDir, 'audio');
  fs.mkdirSync(documentsDir, { recursive: true });
  fs.mkdirSync(audioDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

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

  const getAnnotation = db.prepare('SELECT revision, body, updated_at AS updatedAt FROM lecture_annotations WHERE document_id = ?');
  const insertAnnotation = db.prepare("INSERT INTO lecture_annotations (document_id, revision, body, device_id) VALUES (?, 1, ?, ?)");
  const updateAnnotation = db.prepare("UPDATE lecture_annotations SET revision = revision + 1, body = ?, device_id = ?, updated_at = strftime('%s','now') WHERE document_id = ? AND revision = ?");

  const visibleDocument = key => {
    const doc = getDocument.get(key);
    if (!doc) return null;
    const { filePath, ...visible } = doc;
    return visible;
  };

  const sessionColumns = `s.id, s.container_id AS containerId, s.local_date AS localDate, s.started_at_ms AS startedAtMs,
    (SELECT COUNT(*) FROM lecture_audio_parts p WHERE p.session_id = s.id) AS partCount,
    (SELECT COALESCE(SUM(p.session_end_ms - p.session_start_ms), 0) FROM lecture_audio_parts p WHERE p.session_id = s.id) AS recordedMs`;
  const listSessions = db.prepare(`SELECT ${sessionColumns} FROM lecture_sessions s WHERE s.container_id = ? ORDER BY s.local_date DESC, s.id DESC`);
  const getSession = db.prepare(`SELECT ${sessionColumns} FROM lecture_sessions s WHERE s.id = ?`);
  const latestSessionOn = db.prepare('SELECT id FROM lecture_sessions WHERE container_id = ? AND local_date = ? ORDER BY id DESC LIMIT 1');
  const insertSession = db.prepare('INSERT INTO lecture_sessions (container_id, local_date, started_at_ms) VALUES (?, ?, ?)');
  const getPart = db.prepare('SELECT sha256, size_bytes AS sizeBytes FROM lecture_audio_parts WHERE session_id = ? AND part_key = ?');
  const insertPart = db.prepare(`INSERT INTO lecture_audio_parts
    (session_id, part_key, runtime_id, mime_type, file_path, sha256, size_bytes, session_start_ms, session_end_ms, end_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertEvent = db.prepare(`INSERT OR IGNORE INTO lecture_session_events
    (session_id, event_key, type, runtime_id, session_t_ms, document_id, page) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const documentExists = db.prepare('SELECT 1 FROM lecture_documents WHERE id = ?');

  const fail = (res, status, error, code) => res.status(status).json({ error, ...(code ? { code } : {}) });
  const idParam = (req, res, name = 'id') => {
    const value = Number(req.params[name]);
    if (Number.isSafeInteger(value) && value >= 1) return value;
    fail(res, 400, '올바른 ID가 아닙니다.');
    return null;
  };
  const text = (value, max) => (typeof value === 'string' ? value.trim() : '').slice(0, max + 1);

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
    return res.json(row ? { revision: row.revision, body: JSON.parse(row.body), updatedAt: row.updatedAt } : { revision: 0, body: { pages: {} } });
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
      return res.status(409).json({ error: '다른 기기에서 먼저 저장된 필기가 있습니다.', code: 'LECTURE_REVISION_CONFLICT', revision: row ? row.revision : 0, body: row ? JSON.parse(row.body) : { pages: {} } });
    }
    return res.json({ revision: row.revision, updatedAt: row.updatedAt });
  });

  // ─── L1b: Session · 오디오 파트 · Session 이벤트 ───────────────────────────

  app.get('/api/lecture/containers/:id/sessions', (req, res) => {
    const key = idParam(req, res);
    if (key == null) return;
    if (!getContainer.get(key)) return fail(res, 404, '폴더를 찾을 수 없습니다.');
    return res.json({ sessions: listSessions.all(key) });
  });

  // 마이크를 누를 때만 부른다. 같은 과목·같은 날짜의 Session이 있으면 새로 만들지 않고 그걸 돌려준다(설계 §6.5).
  // 날짜는 기기의 로컬 날짜다. 날짜가 바뀌면 다음 녹음이 새 Session이 되는 것이 곧 '닫힘'이다.
  app.post('/api/lecture/containers/:id/sessions', (req, res) => {
    const key = idParam(req, res);
    if (key == null) return;
    const container = getContainer.get(key);
    if (!container) return fail(res, 404, '폴더를 찾을 수 없습니다.');
    if (container.type !== 'course') return fail(res, 400, '녹음은 과목 폴더에서만 할 수 있습니다.', 'LECTURE_SESSION_COURSE_ONLY');
    const localDate = String(req.body?.localDate || '');
    const startedAtMs = Number(req.body?.startedAtMs);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || !Number.isSafeInteger(startedAtMs) || startedAtMs <= 0) {
      return fail(res, 400, 'localDate와 startedAtMs가 필요합니다.');
    }
    const id = db.transaction(() => latestSessionOn.get(key, localDate)?.id ?? insertSession.run(key, localDate, startedAtMs).lastInsertRowid)();
    return res.json({ session: getSession.get(id) });
  });

  // 오디오 파트는 원본 바이트를 그대로 받는다. 같은 part_key를 다시 올리면 내용이 같을 때만 성공으로 본다.
  app.put('/api/lecture/sessions/:id/parts/:partKey', async (req, res) => {
    const key = idParam(req, res);
    if (key == null) return;
    const partKey = String(req.params.partKey);
    if (!KEY_PATTERN.test(partKey)) return fail(res, 400, '올바른 파트 키가 아닙니다.');
    if (!getSession.get(key)) return fail(res, 404, '강의를 찾을 수 없습니다.');
    const mimeType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const extension = AUDIO_EXTENSIONS[mimeType];
    if (!extension) return fail(res, 415, '지원하지 않는 오디오 형식입니다.', 'LECTURE_AUDIO_TYPE');
    const runtimeId = String(req.query.runtime || '');
    const start = Number(req.query.start);
    const end = Number(req.query.end);
    const endStatus = String(req.query.status || '');
    if (!KEY_PATTERN.test(runtimeId) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || !['paused', 'interrupted'].includes(endStatus)) {
      return fail(res, 400, '파트 구간 정보가 올바르지 않습니다.');
    }

    const partialPath = path.join(tmpDir, `${partKey}-${crypto.randomBytes(6).toString('hex')}.partial`);
    const hash = crypto.createHash('sha256');
    let size = 0;
    try {
      await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(partialPath, { flags: 'wx', mode: 0o600 });
        req.on('data', chunk => {
          size += chunk.length;
          if (size > AUDIO_PART_MAX_BYTES) {
            req.destroy();
            output.destroy();
            reject(Object.assign(new Error('오디오 파트가 너무 큽니다.'), { status: 413 }));
            return;
          }
          hash.update(chunk);
        });
        req.on('error', reject);
        req.on('aborted', () => reject(new Error('업로드가 중단되었습니다.')));
        output.on('error', reject);
        output.on('finish', resolve);
        req.pipe(output);
      });
    } catch (error) {
      await fsp.unlink(partialPath).catch(() => {});
      if (!res.headersSent) return fail(res, error.status || 400, error.message);
      return undefined;
    }
    const sha256 = hash.digest('hex');
    if (!size) {
      await fsp.unlink(partialPath).catch(() => {});
      return fail(res, 400, '빈 오디오 파트입니다.');
    }
    const existing = getPart.get(key, partKey);
    if (existing) {
      await fsp.unlink(partialPath).catch(() => {});
      if (existing.sha256 !== sha256) return fail(res, 409, '같은 파트에 다른 내용이 이미 저장돼 있습니다.', 'LECTURE_PART_CONFLICT');
      return res.json({ sha256, sizeBytes: existing.sizeBytes, duplicate: true });
    }
    try {
      const sessionDir = path.join(audioDir, String(key));
      await fsp.mkdir(sessionDir, { recursive: true });
      const finalPath = path.join(sessionDir, `${partKey}.${extension}`);
      await fsp.rename(partialPath, finalPath);
      insertPart.run(key, partKey, runtimeId, mimeType, finalPath, sha256, size, start, end, endStatus);
      return res.status(201).json({ sha256, sizeBytes: size });
    } catch {
      await fsp.unlink(partialPath).catch(() => {});
      return fail(res, 500, '오디오를 저장하지 못했습니다.', 'LECTURE_STORAGE_FAILED');
    }
  });

  // 자료 열기·페이지 이동은 '사용자가 그 자료를 보던 시각'이라는 약한 근거다(§6.3). event_key로 중복을 버린다.
  app.post('/api/lecture/sessions/:id/events', (req, res) => {
    const key = idParam(req, res);
    if (key == null) return;
    if (!getSession.get(key)) return fail(res, 404, '강의를 찾을 수 없습니다.');
    const events = Array.isArray(req.body?.events) ? req.body.events : null;
    if (!events || events.length > 500) return fail(res, 400, 'events 배열(최대 500개)이 필요합니다.');
    const valid = events.every(event => KEY_PATTERN.test(String(event?.key)) && ['document_open', 'page_change'].includes(event?.type)
      && KEY_PATTERN.test(String(event?.runtimeId)) && Number.isSafeInteger(event?.t)
      && Number.isSafeInteger(event?.documentId) && documentExists.get(event.documentId)
      && (event.page == null || (Number.isSafeInteger(event.page) && event.page >= 1)));
    if (!valid) return fail(res, 400, '이벤트 형식이 올바르지 않습니다.');
    let inserted = 0;
    db.transaction(() => {
      events.forEach(event => {
        inserted += insertEvent.run(key, event.key, event.type, event.runtimeId, event.t, event.documentId, event.page ?? null).changes;
      });
    })();
    return res.json({ inserted });
  });
}

module.exports = { registerLectureRoutes, isLectureAnnotationPut };
