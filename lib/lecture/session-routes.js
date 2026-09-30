'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { KEY_PATTERN, fail, idParam } = require('./http');

// 강의 노트 L1b: Session · 오디오 파트(recording_span) · Session 이벤트.
// 설계 정본은 docs/Lecture-note-system_Design_v4.3.md §6.5·§7·§10.1.1, 구현 기록은 §17.3이다.
const MIB = 1024 * 1024;
// 스파이크 실측 약 19KB/s → 3시간 약 200MB. 한 파트는 일시정지 사이의 한 구간이다.
const AUDIO_PART_MAX_BYTES = 600 * MIB;
const AUDIO_EXTENSIONS = { 'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg' };

function registerSessionRoutes({ app, db, paths: { tmpDir, audioDir } }) {
  const getContainer = db.prepare('SELECT id, type FROM lecture_containers WHERE id = ? AND deleted_at IS NULL');
  const sessionColumns = `s.id, s.container_id AS containerId, s.local_date AS localDate, s.started_at_ms AS startedAtMs,
    (SELECT COUNT(*) FROM lecture_audio_parts p WHERE p.session_id = s.id) AS partCount,
    (SELECT COALESCE(SUM(p.session_end_ms - p.session_start_ms), 0) FROM lecture_audio_parts p WHERE p.session_id = s.id) AS recordedMs`;
  const listSessions = db.prepare(`SELECT ${sessionColumns} FROM lecture_sessions s WHERE s.container_id = ? AND s.deleted_at IS NULL ORDER BY s.local_date DESC, s.id DESC`);
  const getSession = db.prepare(`SELECT ${sessionColumns} FROM lecture_sessions s WHERE s.id = ?`);
  // Session이 참조한 자료는 Session 이벤트(자료 열기·페이지 이동)에서 처음 나온 순서다(§10.1.1).
  const sessionDocuments = db.prepare(`SELECT d.id, d.title, d.kind FROM lecture_documents d
    JOIN (SELECT document_id, MIN(id) AS first FROM lecture_session_events WHERE session_id = ? GROUP BY document_id) e ON e.document_id = d.id
    WHERE d.deleted_at IS NULL ORDER BY e.first`);
  const latestSessionOn = db.prepare('SELECT id FROM lecture_sessions WHERE container_id = ? AND local_date = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1');
  const insertSession = db.prepare('INSERT INTO lecture_sessions (container_id, local_date, started_at_ms) VALUES (?, ?, ?)');
  const getPart = db.prepare('SELECT sha256, size_bytes AS sizeBytes FROM lecture_audio_parts WHERE session_id = ? AND part_key = ?');
  const insertPart = db.prepare(`INSERT INTO lecture_audio_parts
    (session_id, part_key, runtime_id, mime_type, file_path, sha256, size_bytes, session_start_ms, session_end_ms, end_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertEvent = db.prepare(`INSERT OR IGNORE INTO lecture_session_events
    (session_id, event_key, type, runtime_id, session_t_ms, document_id, page) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const documentExists = db.prepare('SELECT 1 FROM lecture_documents WHERE id = ?');
  const insertMarker = db.prepare(`INSERT OR IGNORE INTO lecture_session_markers
    (session_id, marker_key, kind, runtime_id, session_t_ms, document_id, page) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const deleteMarker = db.prepare('DELETE FROM lecture_session_markers WHERE session_id = ? AND marker_key = ?');

  app.get('/api/lecture/containers/:id/sessions', (req, res) => {
    const key = idParam(req, res);
    if (key == null) return;
    if (!getContainer.get(key)) return fail(res, 404, '폴더를 찾을 수 없습니다.');
    return res.json({ sessions: listSessions.all(key).map(session => ({ ...session, documents: sessionDocuments.all(session.id) })) });
  });

  // 마이크를 누를 때만 부른다. 같은 과목·같은 날짜의 Session이 있으면 새로 만들지 않고 그걸 돌려준다(설계 §6.5).
  // 날짜는 기기의 로컬 날짜다. 날짜가 바뀌면 다음 녹음이 새 Session이 되는 것이 곧 '닫힘'이다.
  // `+ 새 강의`로 연 자료의 첫 녹음만 forceNew로 같은 날 Session을 나눈다. 그 뒤로는 가장 최근 Session에 붙는다.
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
    const forceNew = req.body?.forceNew === true;
    const id = db.transaction(() => (!forceNew && latestSessionOn.get(key, localDate)?.id) || insertSession.run(key, localDate, startedAtMs).lastInsertRowid)();
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

  // 마커(§6.4)는 녹음 중에 남기는 Session 시간축의 북마크다. 같은 키는 한 번만 받는다.
  app.post('/api/lecture/sessions/:id/markers', (req, res) => {
    const key = idParam(req, res);
    if (key == null) return;
    if (!getSession.get(key)) return fail(res, 404, '강의를 찾을 수 없습니다.');
    const marker = req.body || {};
    const valid = KEY_PATTERN.test(String(marker.key)) && ['important', 'later'].includes(marker.kind)
      && KEY_PATTERN.test(String(marker.runtimeId)) && Number.isSafeInteger(marker.t)
      && (marker.documentId == null || (Number.isSafeInteger(marker.documentId) && documentExists.get(marker.documentId)))
      && (marker.page == null || (Number.isSafeInteger(marker.page) && marker.page >= 1));
    if (!valid) return fail(res, 400, '마커 형식이 올바르지 않습니다.');
    const { changes } = insertMarker.run(key, marker.key, marker.kind, marker.runtimeId, marker.t, marker.documentId ?? null, marker.page ?? null);
    return res.status(changes ? 201 : 200).json({ key: marker.key });
  });

  // 남긴 직후의 `취소`다. 이미 없으면 그대로 성공이다.
  app.delete('/api/lecture/sessions/:id/markers/:markerKey', (req, res) => {
    const key = idParam(req, res);
    if (key == null) return;
    const markerKey = String(req.params.markerKey);
    if (!KEY_PATTERN.test(markerKey)) return fail(res, 400, '올바른 마커 키가 아닙니다.');
    return res.json({ deleted: deleteMarker.run(key, markerKey).changes });
  });
}

module.exports = { registerSessionRoutes };
