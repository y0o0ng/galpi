'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');
const { migrations } = require('../lib/database-migrations');
const { registerLectureRoutes, isLectureAnnotationPut } = require('../lib/lecture-routes');

test('lecture containers, documents and revision-checked annotations', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lecture-'));
  const db = new Database(':memory:');
  migrations.find(item => item.version === 28).up(db);
  const app = express();
  app.use(express.json({ limit: '40mb' }));
  registerLectureRoutes({ app, db, dataDir });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/lecture`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: body instanceof FormData ? undefined : { 'content-type': 'application/json' },
      body: body instanceof FormData ? body : body && JSON.stringify(body),
    });
    return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };
  try {
    assert.equal((await call('POST', '/containers', { type: 'folder', name: 'x' })).status, 400);
    const course = (await call('POST', '/containers', { type: 'course', name: '  운영체제  ' })).body.container;
    assert.equal(course.name, '운영체제');
    assert.equal((await call('PATCH', `/containers/${course.id}`, { type: 'general' })).status, 400);
    assert.equal((await call('PATCH', `/containers/${course.id}`, { favorite: true })).body.container.favorite, 1);

    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    const form = () => {
      const data = new FormData();
      data.append('file', new Blob([pdf], { type: 'application/pdf' }), '3주차 스케줄링.pdf');
      return data;
    };
    const first = await call('POST', `/containers/${course.id}/documents`, form());
    assert.equal(first.status, 201);
    assert.equal(first.body.document.title, '3주차 스케줄링');
    assert.equal('filePath' in first.body.document, false);
    const second = await call('POST', `/containers/${course.id}/documents`, form());
    assert.equal(second.status, 201);
    assert.equal(fs.readdirSync(path.join(dataDir, 'lecture', 'documents')).length, 1);
    assert.deepEqual((await call('GET', `/documents/${first.body.document.id}/file`)).body, pdf);

    const text = new FormData();
    text.append('file', new Blob(['hello'], { type: 'text/plain' }), 'a.txt');
    assert.equal((await call('POST', `/containers/${course.id}/documents`, text)).status, 415);

    const blank = (await call('POST', `/containers/${course.id}/blank`, {})).body.document;
    assert.equal(blank.blankPages, 1);
    assert.equal((await call('PATCH', `/documents/${blank.id}/pages`, { blankPages: 3 })).body.document.blankPages, 3);
    assert.equal((await call('PATCH', `/documents/${first.body.document.id}/pages`, { blankPages: 3 })).status, 404);
    assert.equal((await call('GET', `/containers/${course.id}/documents`)).body.documents.length, 3);

    const url = `/documents/${blank.id}/annotations`;
    assert.deepEqual((await call('GET', url)).body, { revision: 0, body: { pages: {} } });
    const stroke = { pages: { 1: [{ color: 'ink', points: [[1, 2, 0.5]] }] } };
    assert.equal((await call('PUT', url, { baseRevision: 0, body: stroke })).body.revision, 1);
    assert.equal((await call('PUT', url, { baseRevision: 1, body: { pages: {} } })).body.revision, 2);
    const stale = await call('PUT', url, { baseRevision: 1, body: stroke });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.revision, 2);
    assert.deepEqual(stale.body.body, { pages: {} });
    assert.equal((await call('PUT', url, { baseRevision: 2, body: [] })).status, 400);
    assert.equal((await call('GET', '/containers')).body.containers[0].documentCount, 3);
  } finally {
    server.close();
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('only the annotation PUT skips the global 1MB JSON parser', () => {
  assert.equal(isLectureAnnotationPut({ method: 'PUT', path: '/api/lecture/documents/3/annotations' }), true);
  assert.equal(isLectureAnnotationPut({ method: 'GET', path: '/api/lecture/documents/3/annotations' }), false);
  assert.equal(isLectureAnnotationPut({ method: 'PUT', path: '/api/lecture/containers/3' }), false);
});
