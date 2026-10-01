'use strict';

const { fail, idParam, text } = require('./http');

// 필체 등록: 문장을 따라 쓴 손글씨 표본(획 + 정답 글). OCR 학습·평가용이고 화면 기능에는 쓰지 않는다.
const MAX_STROKES = 400;
const MAX_POINTS = 20000;

function validStrokes(strokes) {
  if (!Array.isArray(strokes) || !strokes.length || strokes.length > MAX_STROKES) return false;
  let points = 0;
  return strokes.every(stroke => {
    if (!stroke || !Array.isArray(stroke.points) || !stroke.points.length || !Number.isFinite(stroke.width)) return false;
    points += stroke.points.length;
    return points <= MAX_POINTS && stroke.points.every(point => Array.isArray(point) && point.length >= 2 && point.every(Number.isFinite));
  });
}

function registerHandwritingRoutes({ app, db }) {
  const insert = db.prepare('INSERT INTO lecture_handwriting_samples (prompt_id, label, strokes, aspect, device_id) VALUES (?, ?, ?, ?, ?)');
  const count = db.prepare('SELECT COUNT(*) AS n FROM lecture_handwriting_samples');
  const promptIds = db.prepare('SELECT DISTINCT prompt_id AS promptId FROM lecture_handwriting_samples');
  const remove = db.prepare('DELETE FROM lecture_handwriting_samples WHERE id = ?');
  const all = db.prepare('SELECT id, prompt_id AS promptId, label, strokes, aspect, created_at AS createdAt FROM lecture_handwriting_samples ORDER BY id');

  // 화면이 다음 문장을 고를 때 쓴 문장을 건너뛰도록 쓴 문장 ID도 준다.
  app.get('/api/lecture/handwriting', (_req, res) => res.json({ count: count.get().n, promptIds: promptIds.all().map(row => row.promptId) }));

  app.post('/api/lecture/handwriting', (req, res) => {
    const promptId = text(req.body?.promptId, 40);
    const label = text(req.body?.label, 200);
    const aspect = Number(req.body?.aspect);
    if (!promptId || promptId.length > 40) return fail(res, 400, '문장 ID가 올바르지 않습니다.');
    if (!label || label.length > 200) return fail(res, 400, '정답 글은 1~200자여야 합니다.');
    if (!(aspect > 0 && aspect <= 2)) return fail(res, 400, '칸 비율이 올바르지 않습니다.');
    if (!validStrokes(req.body?.strokes)) return fail(res, 400, '획 형식이 올바르지 않습니다.');
    const result = insert.run(promptId, label, JSON.stringify(req.body.strokes), aspect, text(req.body?.deviceId, 80) || null);
    return res.status(201).json({ id: Number(result.lastInsertRowid), count: count.get().n });
  });

  // 방금 저장한 표본을 되돌린다.
  app.delete('/api/lecture/handwriting/:id', (req, res) => {
    const key = idParam(req, res);
    if (key == null) return;
    if (!remove.run(key).changes) return fail(res, 404, '표본을 찾을 수 없습니다.');
    return res.json({ deleted: true, count: count.get().n });
  });

  // 학습 스크립트용 내보내기.
  app.get('/api/lecture/handwriting/export', (_req, res) => res.json({
    samples: all.all().map(row => ({ ...row, strokes: JSON.parse(row.strokes) })),
  }));
}

module.exports = { registerHandwritingRoutes };
