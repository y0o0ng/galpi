'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');
const { migrations } = require('../lib/database-migrations');
const { registerLectureRoutes, isLectureLargeJson } = require('../lib/lecture');

test('lecture containers, documents and revision-checked annotations', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lecture-'));
  const db = new Database(':memory:');
  [28, 30, 33, 34, 35, 36].forEach(version => migrations.find(item => item.version === version).up(db));
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

test('only the annotation PUT and the sticky Q&A POST skip the global 1MB JSON parser', () => {
  assert.equal(isLectureLargeJson({ method: 'PUT', path: '/api/lecture/documents/3/annotations' }), true);
  assert.equal(isLectureLargeJson({ method: 'GET', path: '/api/lecture/documents/3/annotations' }), false);
  assert.equal(isLectureLargeJson({ method: 'PUT', path: '/api/lecture/containers/3' }), false);
  assert.equal(isLectureLargeJson({ method: 'POST', path: '/api/lecture/qa/turns' }), true);
  assert.equal(isLectureLargeJson({ method: 'POST', path: '/api/lecture/qa/turns/3/retry' }), false);
});

test('lecture sessions append by date, store audio parts idempotently and dedupe events', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lecture-'));
  const db = new Database(':memory:');
  [28, 30, 33, 34, 35, 36].forEach(version => migrations.find(item => item.version === version).up(db));
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

    const marker = { key: 'mk_ffffffff', kind: 'important', runtimeId: 'rt_bbbbbbbb', t: 7000, documentId: doc.id, page: 1 };
    assert.equal((await call('POST', `/sessions/${first.id}/markers`, marker)).status, 201);
    assert.equal((await call('POST', `/sessions/${first.id}/markers`, marker)).status, 200);
    assert.equal((await call('POST', `/sessions/${first.id}/markers`, { ...marker, key: 'mk_gggggggg', kind: 'question' })).status, 400);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lecture_session_markers').get().n, 1);
    assert.equal((await call('DELETE', `/sessions/${first.id}/markers/mk_ffffffff`)).body.deleted, 1);
    assert.equal((await call('DELETE', `/sessions/${first.id}/markers/mk_ffffffff`)).body.deleted, 0);
  } finally {
    server.close();
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('lecture trash hides documents and sessions, restores them, and purges session strokes', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lecture-'));
  const db = new Database(':memory:');
  [28, 30, 33, 34, 35, 36].forEach(version => migrations.find(item => item.version === version).up(db));
  const app = express();
  app.use(express.json());
  registerLectureRoutes({ app, db, dataDir });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/lecture`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: body instanceof FormData ? undefined : { 'content-type': 'application/json' }, body: body instanceof FormData ? body : body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const pdfForm = () => {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('%PDF-1.4\n%%EOF\n')], { type: 'application/pdf' }), 'a.pdf');
    return form;
  };
  try {
    const course = (await call('POST', '/containers', { type: 'course', name: '동역학' })).body.container;
    const pdfA = (await call('POST', `/containers/${course.id}/documents`, pdfForm())).body.document;
    const pdfB = (await call('POST', `/containers/${course.id}/documents`, pdfForm())).body.document;
    const blank = (await call('POST', `/containers/${course.id}/blank`, {})).body.document;
    const session = (await call('POST', `/containers/${course.id}/sessions`, { localDate: '2026-09-30', startedAtMs: 1 })).body.session;
    const strokes = { pages: { 1: [{ id: 'keep', source_session_id: null }, { id: 'gone', source_session_id: session.id }] } };
    await call('PUT', `/documents/${blank.id}/annotations`, { baseRevision: 0, body: strokes, deviceId: 'dev_ipad' });

    // 자료 삭제: 목록·뷰어에서 사라지고, 되돌리면 돌아온다.
    assert.equal((await call('DELETE', `/documents/${pdfA.id}`)).body.trashed, true);
    assert.deepEqual((await call('GET', `/containers/${course.id}/documents`)).body.documents.map(doc => doc.id).sort(), [pdfB.id, blank.id].sort());
    assert.equal((await call('GET', `/documents/${pdfA.id}`)).status, 404);
    assert.equal((await call('POST', `/trash/document/${pdfA.id}/restore`)).body.restored, true);
    assert.equal((await call('GET', `/documents/${pdfA.id}`)).status, 200);

    // 강의 삭제: 타임라인에서 사라지고, 새 녹음은 휴지통 강의에 붙지 않는다. 획은 숨김 목록으로만 알린다.
    await call('DELETE', `/sessions/${session.id}`);
    assert.deepEqual((await call('GET', `/containers/${course.id}/sessions`)).body.sessions, []);
    assert.deepEqual((await call('GET', `/documents/${blank.id}`)).body.hiddenSessionIds, [session.id]);
    const fresh = (await call('POST', `/containers/${course.id}/sessions`, { localDate: '2026-09-30', startedAtMs: 2 })).body.session;
    assert.notEqual(fresh.id, session.id);
    const trash = (await call('GET', '/trash')).body.items;
    assert.deepEqual(trash.map(item => [item.type, item.id]), [['session', session.id]]);
    assert.equal(trash[0].purgeAt - trash[0].deletedAt, 30 * 24 * 60 * 60);

    // 강의 영구 삭제: 그 강의 획만 필기에서 빠지고 revision이 오른다.
    assert.equal((await call('DELETE', `/trash/session/${session.id}`)).body.purged, true);
    const after = (await call('GET', `/documents/${blank.id}/annotations`)).body;
    assert.deepEqual(after.body.pages[1].map(stroke => stroke.id), ['keep']);
    assert.equal(after.revision, 2);
    assert.equal(after.deviceId, 'server:lecture-trash');

    // 같은 PDF를 두 자료가 쓰면 하나를 영구 삭제해도 파일은 남는다.
    await call('DELETE', `/documents/${pdfA.id}`);
    await call('DELETE', `/trash/document/${pdfA.id}`);
    assert.equal(fs.readdirSync(path.join(dataDir, 'lecture', 'documents')).length, 1);
    await call('DELETE', `/documents/${pdfB.id}`);
    await call('DELETE', `/trash/document/${pdfB.id}`);
    assert.equal(fs.readdirSync(path.join(dataDir, 'lecture', 'documents')).length, 0);
    assert.equal((await call('POST', '/trash/folder/1/restore')).status, 404);

    // 폴더 삭제: 안의 자료가 함께 숨고 목록엔 폴더 하나만 보인다. 영구 삭제하면 안쪽까지 지워진다.
    const info = (await call('GET', '/containers')).body.containers[0];
    assert.deepEqual([info.pdfCount, info.blankCount, info.sessionCount], [0, 1, 0]);
    assert.equal((await call('DELETE', `/containers/${course.id}`)).body.trashed, true);
    assert.deepEqual((await call('GET', '/containers')).body.containers, []);
    assert.equal((await call('GET', `/documents/${blank.id}`)).status, 404);
    assert.deepEqual((await call('GET', '/trash')).body.items.map(item => item.type), ['folder']);
    await call('POST', `/trash/folder/${course.id}/restore`);
    assert.equal((await call('GET', `/documents/${blank.id}`)).status, 200);
    await call('DELETE', `/containers/${course.id}`);
    assert.equal((await call('DELETE', `/trash/folder/${course.id}`)).body.purged, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lecture_documents').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lecture_sessions').get().n, 0);
  } finally {
    server.close();
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('handwriting samples store strokes with their label, list written prompts and export', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lecture-'));
  const db = new Database(':memory:');
  [28, 30, 33, 34, 35, 36].forEach(version => migrations.find(item => item.version === version).up(db));
  const app = express();
  app.use(express.json());
  registerLectureRoutes({ app, db, dataDir });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/lecture/handwriting`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const strokes = [{ tool: 'pen', color: '#000000', width: 0.004, points: [[0.1, 0.1, 0.5], [0.2, 0.15, 0.5]] }];
  try {
    const saved = await call('POST', '', { promptId: 'q-001', label: '? 운동량 보존은 언제 성립해?', strokes, aspect: 0.25 });
    assert.equal(saved.status, 201);
    assert.equal(saved.body.count, 1);
    assert.equal((await call('POST', '', { promptId: 'q-002', label: '', strokes, aspect: 0.25 })).status, 400);
    assert.equal((await call('POST', '', { promptId: 'q-002', label: 'x', strokes: [], aspect: 0.25 })).status, 400);
    assert.equal((await call('POST', '', { promptId: 'q-002', label: 'x', strokes: [{ width: 1, points: [[0, 'a']] }], aspect: 0.25 })).status, 400);
    assert.deepEqual((await call('GET', '')).body, { count: 1, promptIds: ['q-001'] });
    const exported = (await call('GET', '/export')).body.samples;
    assert.equal(exported[0].label, '? 운동량 보존은 언제 성립해?');
    assert.deepEqual(exported[0].strokes, strokes);
    assert.equal((await call('DELETE', `/${saved.body.id}`)).body.count, 0);
  } finally {
    server.close();
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('sticky Q&A routes by the first glyph, keeps chains, is idempotent and respects deleted stickies', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lecture-'));
  const db = new Database(':memory:');
  [28, 30, 33, 34, 35, 36].forEach(version => migrations.find(item => item.version === version).up(db));
  const calls = [];
  const replies = [];
  const askModel = async request => {
    calls.push(request);
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return { model: 'fake-model', output: reply };
  };
  const app = express();
  app.use(express.json());
  registerLectureRoutes({ app, db, dataDir, askModel });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/lecture`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const png = `data:image/png;base64,${Buffer.from('fake-png').toString('base64')}`;
  const send = (clientRequestId, extra = {}) => call('POST', '/qa/turns', { clientRequestId, documentId: doc.id, stickyId: 'k_sticky01', strokeIds: ['s_1'], inkBottom: 0.2, images: { question: png }, ...extra });
  let doc;
  try {
    const { body: { container } } = await call('POST', '/containers', { type: 'general', name: '동역학' });
    doc = (await call('POST', `/containers/${container.id}/blank`, { title: '노트' })).body.document;

    replies.push({ route: 'new', question: '? 운동량 보존은 언제?', answer: '외력의 합이 0일 때야.' });
    const first = (await send('req-00000001')).body.turn;
    assert.equal(first.status, 'answered');
    assert.equal(first.answerText, '외력의 합이 0일 때야.');
    assert.equal(first.read, false);
    assert.equal(calls[0].content[1].type, 'input_image');
    // 같은 요청을 다시 보내면 모델을 다시 부르지 않는다.
    assert.equal((await send('req-00000001')).body.turn.id, first.id);
    assert.equal(calls.length, 1);

    replies.push({ route: 'follow', question: 'ㄴ 외력이 있으면?', answer: '충돌처럼 짧으면 무시해도 돼.' });
    const follow = (await send('req-00000002', { strokeIds: ['s_2'] })).body.turn;
    assert.equal(follow.chainId, first.chainId);
    assert.match(calls[1].content[0].text, /외력의 합이 0일 때야/);

    // 첫 글자가 애매하면 답하지 않고, 사용자가 고른 경로로 다시 보낸다. 새 질문에는 앞 대화를 넣지 않는다.
    replies.push({ route: 'unclear', question: '여기서 v₂가 뭐야', answer: '' });
    const unclear = (await send('req-00000003', { strokeIds: ['s_3'] })).body.turn;
    assert.equal(unclear.status, 'needs_route');
    replies.push({ route: 'new', question: '? 여기서 v₂가 뭐야', answer: '충돌 뒤 속도야.' });
    const routed = (await call('POST', `/qa/turns/${unclear.id}/retry`, { route: 'new' })).body.turn;
    assert.equal(routed.status, 'answered');
    assert.notEqual(routed.chainId, first.chainId);
    assert.doesNotMatch(calls[3].content[0].text, /previous_chain/);

    replies.push({ route: 'memo', question: '시험에 나올 듯', answer: '' });
    assert.equal((await send('req-00000004', { strokeIds: ['s_4'] })).body.turn.status, 'memo');

    replies.push(Object.assign(new Error('boom'), { code: 'ETIMEDOUT' }));
    const failed = (await send('req-00000005', { strokeIds: ['s_5'] })).body.turn;
    assert.equal(failed.status, 'failed');
    assert.equal(db.prepare('SELECT status, error_code AS code FROM lecture_qa_attempts ORDER BY id DESC').get().code, 'ETIMEDOUT');
    replies.push({ route: 'new', question: '? 다시', answer: '다시 답했어.' });
    assert.equal((await call('POST', `/qa/turns/${failed.id}/retry`)).body.turn.status, 'answered');

    assert.equal((await send('req-00000006', { images: { question: 'data:image/gif;base64,AAAA' } })).status, 400);
    // 타이핑한 질문은 질문 이미지 없이 글로 간다.
    replies.push({ route: 'follow', question: 'ㄴ 그럼 마찰이 있으면?', answer: '마찰은 외력이라 보존이 깨져.' });
    const typed = (await send('req-00000009', { strokeIds: [], typedText: 'ㄴ 그럼 마찰이 있으면?', images: {} })).body.turn;
    assert.equal(typed.status, 'answered');
    assert.equal(typed.typedText, 'ㄴ 그럼 마찰이 있으면?');
    assert.match(calls.at(-1).content[0].text, /<typed_question>\nㄴ 그럼 마찰이 있으면\?/);
    assert.equal(calls.at(-1).content.length, 1);
    assert.equal((await send('req-00000010', { strokeIds: [], images: {} })).status, 400);
    assert.equal((await call('POST', `/qa/turns/${first.id}/read`)).body.turn.read, true);
    assert.equal((await call('GET', `/qa?documentId=${doc.id}`)).body.turns.length, 6);

    // 포스트잇을 지우면 Q&A와 근거 사본이 사라지고, 같은 포스트잇으로는 다시 보낼 수 없다.
    assert.equal(fs.existsSync(path.join(dataDir, 'lecture', 'qa', String(first.id), 'question.png')), true);
    await call('DELETE', `/qa/stickies/k_sticky01?documentId=${doc.id}`);
    assert.equal((await call('GET', `/qa?documentId=${doc.id}`)).body.turns.length, 0);
    assert.equal(fs.existsSync(path.join(dataDir, 'lecture', 'qa', String(first.id))), false);
    assert.equal((await send('req-00000007')).status, 410);

    // 기동 때 걸려 있던 요청은 결과 불명으로 바꾸고 다시 부르지 않는다.
    db.prepare("INSERT INTO lecture_qa_turns (client_request_id, document_id, sticky_id, stroke_ids, ink_bottom, evidence, status) VALUES ('req-00000008', ?, 'k_sticky02', '[]', 0, '{}', 'pending')").run(doc.id);
    registerLectureRoutes({ app: express(), db, dataDir, askModel });
    assert.equal(db.prepare("SELECT status FROM lecture_qa_turns WHERE client_request_id = 'req-00000008'").get().status, 'unknown');
    assert.equal(calls.length, 8);
  } finally {
    server.close();
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
