'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { migrations } = require('../lib/database-migrations');
const { registerDdayRoutes } = require('../lib/dday-routes');

test('D-Day records are independent of tasks and support add, edit, list, delete', () => {
  const db = new Database(':memory:');
  migrations.find(item => item.version === 27).up(db);
  const routes = new Map();
  const app = Object.fromEntries(['get', 'post', 'patch', 'delete'].map(method => [method, (path, handler) => routes.set(`${method} ${path}`, handler)]));
  registerDdayRoutes({ app, db });
  const call = (method, path, body = {}, params = {}) => {
    const result = { statusCode: 200, body: null };
    const res = {
      status(code) { result.statusCode = code; return this; },
      json(value) { result.body = value; return this; },
      sendStatus(code) { result.statusCode = code; return this; },
    };
    routes.get(`${method} ${path}`)({ body, params, is: () => true }, res);
    return result;
  };
  try {
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'assistant_tasks'").get().n, 0);
    assert.equal(call('post', '/api/ddays', { title: '시험', targetDate: '2026-09-31' }).statusCode, 400);
    const created = call('post', '/api/ddays', { title: '  시험  ', targetDate: '2026-10-03' });
    assert.equal(created.statusCode, 201);
    assert.equal(created.body.dday.title, '시험');
    const key = created.body.dday.id;
    assert.deepEqual(call('get', '/api/ddays').body.ddays.map(item => item.title), ['시험']);
    assert.equal(call('patch', '/api/ddays/:id', { title: '기말', targetDate: '2026-10-04' }, { id: key }).body.dday.targetDate, '2026-10-04');
    assert.equal(call('delete', '/api/ddays/:id', {}, { id: key }).statusCode, 204);
    assert.deepEqual(call('get', '/api/ddays').body.ddays, []);
  } finally {
    db.close();
  }
});
