'use strict';

function registerDdayRoutes({ app, db }) {
  const list = db.prepare('SELECT id, title, target_date AS targetDate FROM ddays ORDER BY target_date, id');
  const get = db.prepare('SELECT id, title, target_date AS targetDate FROM ddays WHERE id = ?');
  const create = db.prepare('INSERT INTO ddays (title, target_date) VALUES (?, ?)');
  const update = db.prepare('UPDATE ddays SET title = ?, target_date = ? WHERE id = ?');
  const remove = db.prepare('DELETE FROM ddays WHERE id = ?');

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return year >= 1900 && year <= 9999 && date.toISOString().slice(0, 10) === value;
  }

  function input(req, res) {
    if (!req.is('application/json')) {
      res.status(415).json({ error: 'Content-Type은 application/json이어야 합니다.' });
      return null;
    }
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const targetDate = req.body?.targetDate;
    if (!title || title.length > 120 || !validDate(targetDate)) {
      res.status(400).json({ error: '제목(1~120자)과 올바른 날짜를 입력해 주세요.' });
      return null;
    }
    return { title, targetDate };
  }

  function id(req, res) {
    const value = Number(req.params.id);
    if (!Number.isSafeInteger(value) || value < 1) {
      res.status(400).json({ error: '올바른 D-Day ID가 아닙니다.' });
      return null;
    }
    return value;
  }

  app.get('/api/ddays', (_req, res) => res.json({ ddays: list.all() }));
  app.post('/api/ddays', (req, res) => {
    const value = input(req, res);
    if (!value) return;
    const result = create.run(value.title, value.targetDate);
    res.status(201).json({ dday: get.get(result.lastInsertRowid) });
  });
  app.patch('/api/ddays/:id', (req, res) => {
    const key = id(req, res);
    if (key == null) return;
    const value = input(req, res);
    if (!value) return;
    if (!update.run(value.title, value.targetDate, key).changes) return res.status(404).json({ error: 'D-Day를 찾을 수 없습니다.' });
    return res.json({ dday: get.get(key) });
  });
  app.delete('/api/ddays/:id', (req, res) => {
    const key = id(req, res);
    if (key == null) return;
    if (!remove.run(key).changes) return res.status(404).json({ error: 'D-Day를 찾을 수 없습니다.' });
    return res.sendStatus(204);
  });
}

module.exports = { registerDdayRoutes };
