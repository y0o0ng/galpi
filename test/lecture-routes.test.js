'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');
const { migrations } = require('../lib/database-migrations');
const { registerLectureRoutes, isLectureAnnotationPut } = require('../lib/lecture');

test('lecture containers, documents and revision-checked annotations', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lecture-'));
  const db = new Database(':memory:');
  [28, 30].forEach(version => migrations.find(item => item.version === version).up(db));
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
    assert.deepEqual((await call('GET', url)).body, { revision: 0, body: { pages: {} }, deviceId: null });
    const stroke = { pages: { 1: [{ color: 'ink', points: [[1, 2, 0.5]] }] } };
    assert.equal((await call('PUT', url, { baseRevision: 0, body: stroke })).body.revision, 1);
    assert.equal((await call('PUT', url, { baseRevision: 1, body: { pages: {} } })).body.revision, 2);
    const stale = await call('PUT', url, { baseRevision: 1, body: stroke, deviceId: 'dev_other' });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.deviceId, null);
    assert.equal(stale.body.revision, 2);
    assert.deepEqual(stale.body.body, { pages: {} });
    assert.equal((await call('PUT', url, { baseRevision: 2, body: [] })).status, 400);
    assert.equal((await call('PUT', url, { baseRevision: 2, body: stroke, deviceId: 'dev_ipad' })).body.revision, 3);
    assert.equal((await call('GET', url)).body.deviceId, 'dev_ipad');
    assert.equal((await call('PUT', url, { baseRevision: 2, body: stroke, deviceId: 'dev_ipad' })).body.deviceId, 'dev_ipad');
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

test('lecture sessions append by date, store audio parts idempotently and dedupe events', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lecture-'));
  const db = new Database(':memory:');
  [28, 30].forEach(version => migrations.find(item => item.version === version).up(db));
  const app = express();
  app.use(express.json());
  registerLectureRoutes({ app, db, dataDir });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/lecture`;
  const call = async (method, url, body, headers = { 'content-type': 'application/json' }) => {
    const res = await fetch(base + url, { method, headers, body: Buffer.isBuffer(body) ? body : body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  try {
    const course = (await call('POST', '/containers', { type: 'course', name: '동역학' })).body.container;
    const general = (await call('POST', '/containers', { type: 'general', name: '개인' })).body.container;
    const doc = (await call('POST', `/containers/${course.id}/blank`, {})).body.document;
    assert.equal((await call('POST', `/containers/${general.id}/sessions`, { localDate: '2026-09-30', startedAtMs: 1 })).status, 400);

    const first = (await call('POST', `/containers/${course.id}/sessions`, { localDate: '2026-09-30', startedAtMs: 1000 })).body.session;
    const again = (await call('POST', `/containers/${course.id}/sessions`, { localDate: '2026-09-30', startedAtMs: 9000 })).body.session;
    assert.equal(again.id, first.id);
    assert.equal(again.startedAtMs, 1000);
    const nextDay = (await call('POST', `/containers/${course.id}/sessions`, { localDate: '2026-10-01', startedAtMs: 2000 })).body.session;
    assert.notEqual(nextDay.id, first.id);
    // `+ 새 강의`는 같은 날에도 새 Session을 만들고, 그 뒤 일반 녹음은 가장 최근 Session에 붙는다.
    const split = (await call('POST', `/containers/${course.id}/sessions`, { localDate: '2026-10-01', startedAtMs: 3000, forceNew: true })).body.session;
    assert.notEqual(split.id, nextDay.id);
    assert.equal((await call('POST', `/containers/${course.id}/sessions`, { localDate: '2026-10-01', startedAtMs: 4000 })).body.session.id, split.id);

    const audio = Buffer.from('fake-mp4-bytes');
    const partUrl = `/sessions/${first.id}/parts/part_aaaaaaaa?runtime=rt_bbbbbbbb&start=100&end=60100&status=paused`;
    const audioHeaders = { 'content-type': 'audio/mp4' };
    const stored = await call('PUT', partUrl, audio, audioHeaders);
    assert.equal(stored.status, 201);
    assert.equal(stored.body.sha256, require('node:crypto').createHash('sha256').update(audio).digest('hex'));
    assert.equal((await call('PUT', partUrl, audio, audioHeaders)).body.duplicate, true);
    assert.equal((await call('PUT', partUrl, Buffer.from('other'), audioHeaders)).status, 409);
    assert.equal((await call('PUT', partUrl, audio, { 'content-type': 'text/plain' })).status, 415);
    assert.equal((await call('PUT', partUrl.replace('end=60100', 'end=50'), audio, audioHeaders)).status, 400);
    assert.deepEqual(fs.readFileSync(path.join(dataDir, 'lecture', 'audio', String(first.id), 'part_aaaaaaaa.m4a')), audio);

    const sessions = (await call('GET', `/containers/${course.id}/sessions`)).body.sessions;
    assert.deepEqual(sessions.map(item => [item.localDate, item.partCount, item.recordedMs]), [['2026-10-01', 0, 0], ['2026-10-01', 0, 0], ['2026-09-30', 1, 60000]]);

    const event = { key: 'ev_cccccccc', type: 'page_change', runtimeId: 'rt_bbbbbbbb', t: 5000, documentId: doc.id, page: 2 };
    assert.equal((await call('POST', `/sessions/${first.id}/events`, { events: [event, { ...event, key: 'ev_dddddddd', type: 'document_open', page: null }] })).body.inserted, 2);
    assert.equal((await call('POST', `/sessions/${first.id}/events`, { events: [event] })).body.inserted, 0);
    assert.deepEqual((await call('GET', `/containers/${course.id}/sessions`)).body.sessions.find(item => item.id === first.id).documents.map(item => item.id), [doc.id]);
    assert.equal((await call('POST', `/sessions/${first.id}/events`, { events: [{ ...event, key: 'ev_eeeeeeee', documentId: 999 }] })).status, 400);
  } finally {
    server.close();
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
