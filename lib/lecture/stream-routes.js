'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { KEY_PATTERN, fail, idParam } = require('./http');

// 강의 노트 L2: Document 가상 오디오 스트림(설계 §12.2). 오디오 정본은 Session에 두고, 한 자료가 열려 있던
// 구간과 실제 녹음 구간(파트)의 교집합만 Session 순서대로 이어 보여준다. 새 오디오 파일을 만들지 않는다.

// 이벤트 순서대로 가장 최근에 연 자료가 그 시점의 활성 자료다. 첫 이벤트 전은 첫 자료에 붙인다 — 녹음은 늘
// 자료를 연 채로 시작하고 `자료 열기` 이벤트는 녹음 시작보다 몇백 ms 늦게 찍힌다.
function activeIntervals(events) {
  const intervals = [];
  events.forEach(event => {
    const last = intervals[intervals.length - 1];
    if (last && last.documentId === event.documentId) return;
    if (last) last.end = event.t;
    intervals.push({ documentId: event.documentId, start: intervals.length ? event.t : -Infinity, end: Infinity });
  });
  return intervals;
}

// session: { id, localDate, startedAtMs, parts: [{ partKey, mimeType, start, end }], events: [{ t, documentId, page }],
//            markers: [{ kind, t, page }] }, titles: Map(documentId → title)
// 반환: 이 자료가 한 번도 재생 구간을 갖지 않는 Session은 null.
function buildSessionStream(documentId, session, titles) {
  const intervals = activeIntervals(session.events);
  const pieces = [];
  session.parts.forEach((part, index) => {
    if (index > 0 && part.start > session.parts[index - 1].end) {
      pieces.push({ type: 'silence', start: session.parts[index - 1].end, end: part.start });
    }
    (intervals.length ? intervals : [{ documentId: null, start: -Infinity, end: Infinity }]).forEach(interval => {
      const start = Math.max(part.start, interval.start);
      const end = Math.min(part.end, interval.end);
      if (end <= start) return;
      if (interval.documentId === documentId) {
        pieces.push({ type: 'span', partKey: part.partKey, mimeType: part.mimeType, start, end, audioStart: start - part.start });
      } else {
        const last = pieces[pieces.length - 1];
        if (last?.type === 'other' && last.documentId === interval.documentId && last.end === start) last.end = end;
        else pieces.push({ type: 'other', start, end, documentId: interval.documentId, title: titles.get(interval.documentId) || '다른 자료' });
      }
    });
  });
  // 이 자료의 첫 재생 구간과 마지막 재생 구간 사이만 남긴다. 앞뒤의 다른 자료·무녹음은 이 자료의 이야기가 아니다.
  const first = pieces.findIndex(piece => piece.type === 'span');
  if (first < 0) return null;
  const last = pieces.length - 1 - [...pieces].reverse().findIndex(piece => piece.type === 'span');
  const items = pieces.slice(first, last + 1);
  const spans = items.filter(item => item.type === 'span');
  const inSpan = t => spans.some(span => t >= span.start && t <= span.end);
  return {
    id: session.id,
    localDate: session.localDate,
    startedAtMs: session.startedAtMs,
    items,
    markers: session.markers.filter(marker => inSpan(marker.t)),
    // `재생 위치로`는 재생 시각의 마지막 쪽 이동을 따른다. 이 자료에서 본 쪽만 남긴다.
    pages: session.events.filter(event => event.documentId === documentId && event.page).map(event => ({ t: event.t, page: event.page })),
  };
}

function registerStreamRoutes({ app, db }) {
  const getDocument = db.prepare(`SELECT d.id, d.container_id AS containerId FROM lecture_documents d
    JOIN lecture_containers c ON c.id = d.container_id WHERE d.id = ? AND d.deleted_at IS NULL AND c.deleted_at IS NULL`);
  const containerSessions = db.prepare(`SELECT id, local_date AS localDate, started_at_ms AS startedAtMs FROM lecture_sessions
    WHERE container_id = ? AND deleted_at IS NULL ORDER BY local_date, started_at_ms, id`);
  const sessionParts = db.prepare(`SELECT part_key AS partKey, mime_type AS mimeType, session_start_ms AS start, session_end_ms AS end
    FROM lecture_audio_parts WHERE session_id = ? ORDER BY session_start_ms, id`);
  const sessionEvents = db.prepare(`SELECT session_t_ms AS t, document_id AS documentId, page FROM lecture_session_events
    WHERE session_id = ? ORDER BY session_t_ms, id`);
  const sessionMarkers = db.prepare(`SELECT kind, session_t_ms AS t, page FROM lecture_session_markers
    WHERE session_id = ? ORDER BY session_t_ms, id`);
  const containerTitles = db.prepare('SELECT id, title FROM lecture_documents WHERE container_id = ?');
  const getPartFile = db.prepare(`SELECT p.file_path AS filePath, p.mime_type AS mimeType FROM lecture_audio_parts p
    JOIN lecture_sessions s ON s.id = p.session_id WHERE p.session_id = ? AND p.part_key = ? AND s.deleted_at IS NULL`);

  app.get('/api/lecture/documents/:id/stream', (req, res) => {
    const key = idParam(req, res);
    if (key == null) return;
    const doc = getDocument.get(key);
    if (!doc) return fail(res, 404, '자료를 찾을 수 없습니다.');
    const titles = new Map(containerTitles.all(doc.containerId).map(row => [row.id, row.title]));
    const sessions = containerSessions.all(doc.containerId).map(session => buildSessionStream(key, {
      ...session,
      parts: sessionParts.all(session.id),
      events: sessionEvents.all(session.id),
      markers: sessionMarkers.all(session.id),
    }, titles)).filter(Boolean);
    return res.json({ sessions });
  });

  // 녹음 파트 원본. 화면은 인증 헤더를 붙여 받아 blob으로 재생한다.
  app.get('/api/lecture/sessions/:id/parts/:partKey/audio', (req, res) => {
    const key = idParam(req, res);
    if (key == null) return;
    if (!KEY_PATTERN.test(String(req.params.partKey))) return fail(res, 400, '올바른 파트 키가 아닙니다.');
    const part = getPartFile.get(key, String(req.params.partKey));
    if (!part || !fs.existsSync(part.filePath)) return fail(res, 404, '녹음을 찾을 수 없습니다.');
    res.setHeader('Content-Type', part.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    return fs.createReadStream(path.resolve(part.filePath)).pipe(res);
  });
}

module.exports = { registerStreamRoutes, buildSessionStream };
