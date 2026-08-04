'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const fsSync = require('node:fs');
const Database = require('better-sqlite3');

const { createAttachmentImageService } = require('../lib/attachment-images');
const { runDatabaseMigrations } = require('../lib/database-migrations');

function createDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      last_active INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY, filename TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
      note_type TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
      codex_status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE auto_save_decisions (
      id INTEGER PRIMARY KEY, decision TEXT NOT NULL, action TEXT
    );
    CREATE TABLE note_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, chunk_id TEXT UNIQUE NOT NULL,
      note_filename TEXT NOT NULL, note_title TEXT NOT NULL,
      chunk_type TEXT NOT NULL, content TEXT NOT NULL, source_session TEXT,
      source_user_message INTEGER, source_assistant_message INTEGER,
      embedding TEXT, created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE assistant_retrieval_shadow_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, mode TEXT NOT NULL,
      notes_json TEXT NOT NULL, chunks_json TEXT NOT NULL,
      context_chars INTEGER NOT NULL DEFAULT 0, latency_ms INTEGER NOT NULL DEFAULT 0,
      error TEXT, created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);
  runDatabaseMigrations(db);
  db.prepare("INSERT INTO sessions (id) VALUES ('shared-main'), ('other-session')").run();
  return db;
}

async function seedImage(db, tmpDir, {
  id,
  bytes,
  filename = '사진.png',
  mimeType = 'image/png',
  sessionId = null,
  lifecycleStatus = 'uploaded_unattached',
  storedPath = null,
}) {
  const storedName = `${id}.png`;
  const finalPath = storedPath || path.join(tmpDir, storedName);
  await fsp.mkdir(path.dirname(finalPath), { recursive: true });
  await fsp.writeFile(finalPath, bytes, { mode: 0o600 });
  const blobId = Number(db.prepare(`
    INSERT INTO attachment_blobs (sha256, stored_name, stored_path, mime_type, size_bytes)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    crypto.createHash('sha256').update(bytes).digest('hex'),
    storedName,
    finalPath,
    mimeType,
    bytes.length,
  ).lastInsertRowid);
  db.prepare(`
    INSERT INTO attachments (id, blob_id, original_name, kind, session_id, lifecycle_status)
    VALUES (?, ?, ?, 'image', ?, ?)
  `).run(id, blobId, filename, sessionId, lifecycleStatus);
  return { blobId, storedPath: finalPath };
}

function attachToTurn(db, { attachmentId, sessionId = 'shared-main', position = 0 }) {
  const messageId = Number(db.prepare(`
    INSERT INTO messages (session_id, role, content) VALUES (?, 'user', '턴')
  `).run(sessionId).lastInsertRowid);
  db.prepare(`
    INSERT INTO message_attachments (
      message_id, attachment_id, position, origin_user_turn_index, replay_window_turns
    ) VALUES (?, ?, ?, 1, 3)
  `).run(messageId, attachmentId, position);
  return messageId;
}

async function withFixture(t, prefix = 'attachment-images-') {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  const tmpDir = path.join(root, 'attachments', 'tmp');
  await fsp.mkdir(tmpDir, { recursive: true });
  const db = createDatabase();
  t.after(async () => {
    db.close();
    await fsp.rm(root, { recursive: true, force: true });
  });
  return { root, tmpDir, db };
}

test('이번 턴 이미지와 replay 창 이미지를 대화 순서대로 함께 보낸다', async t => {
  const { tmpDir, db } = await withFixture(t);
  const olderId = 'att_11111111111111111111111111111111';
  const currentId = 'att_22222222222222222222222222222222';
  await seedImage(db, tmpDir, {
    id: olderId,
    bytes: Buffer.from('오래된 이미지'),
    filename: '이전.png',
    sessionId: 'shared-main',
    lifecycleStatus: 'attached_temporary',
  });
  attachToTurn(db, { attachmentId: olderId });
  await seedImage(db, tmpDir, {
    id: currentId,
    bytes: Buffer.from('이번 이미지'),
    filename: '이번.png',
  });

  const images = createAttachmentImageService(db, { enabled: true, tmpDir });
  const result = await images.listTurnImages({
    sessionId: 'shared-main',
    attachmentIds: [currentId],
  });

  assert.deepEqual(result.images.map(image => image.filename), ['이전.png', '이번.png']);
  assert.equal(result.omittedForBudget, 0);
  assert.equal(result.skippedInvalid, 0);
  assert.match(result.images[1].dataUrl, /^data:image\/png;base64,/);
  assert.equal(
    Buffer.from(result.images[1].dataUrl.split(',')[1], 'base64').toString(),
    '이번 이미지',
  );
  assert.equal(images.hasTemporaryImages({ sessionId: 'shared-main', attachmentIds: [] }), true);
});

test('턴 예산을 넘는 이미지는 오래된 것부터 빼고 개수를 알린다', async t => {
  const { tmpDir, db } = await withFixture(t, 'attachment-images-budget-');
  const ids = [
    'att_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'att_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'att_cccccccccccccccccccccccccccccccc',
  ];
  for (const [index, id] of ids.entries()) {
    await seedImage(db, tmpDir, {
      id,
      bytes: Buffer.alloc(400, index + 1),
      filename: `${index + 1}.png`,
      sessionId: 'shared-main',
      lifecycleStatus: 'attached_temporary',
    });
    attachToTurn(db, { attachmentId: id });
  }

  const byBytes = createAttachmentImageService(db, {
    enabled: true,
    tmpDir,
    maxTurnBytes: 900,
  });
  const budgeted = await byBytes.listTurnImages({ sessionId: 'shared-main' });
  // 최신순으로 채우므로 가장 오래된 1.png가 밀린다.
  assert.deepEqual(budgeted.images.map(image => image.filename), ['2.png', '3.png']);
  assert.equal(budgeted.omittedForBudget, 1);
  assert.equal(budgeted.usedBytes, 800);

  const byCount = createAttachmentImageService(db, {
    enabled: true,
    tmpDir,
    maxImagesPerTurn: 1,
  });
  const capped = await byCount.listTurnImages({ sessionId: 'shared-main' });
  assert.deepEqual(capped.images.map(image => image.filename), ['3.png']);
  assert.equal(capped.omittedForBudget, 2);
});

test('원본이 저장 기록과 다르거나 경로를 벗어나면 그 이미지만 제외한다', async t => {
  const { root, tmpDir, db } = await withFixture(t, 'attachment-images-guard-');
  const tamperedId = 'att_dddddddddddddddddddddddddddddddd';
  const outsideId = 'att_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  const goodId = 'att_ffffffffffffffffffffffffffffffff';
  const { storedPath } = await seedImage(db, tmpDir, {
    id: tamperedId,
    bytes: Buffer.from('원본'),
    filename: '변조.png',
  });
  await fsp.writeFile(storedPath, Buffer.from('바뀐 내용'));
  await seedImage(db, tmpDir, {
    id: outsideId,
    bytes: Buffer.from('바깥'),
    filename: '바깥.png',
    storedPath: path.join(root, 'outside.png'),
  });
  await seedImage(db, tmpDir, { id: goodId, bytes: Buffer.from('정상'), filename: '정상.png' });

  const images = createAttachmentImageService(db, { enabled: true, tmpDir });
  const result = await images.listTurnImages({
    sessionId: 'shared-main',
    attachmentIds: [tamperedId, outsideId, goodId],
  });

  assert.deepEqual(result.images.map(image => image.filename), ['정상.png']);
  assert.equal(result.skippedInvalid, 2);
  assert.equal(result.omittedForBudget, 0);
});

test('다른 대화·만료·비활성에서는 이미지를 꺼내지 않는다', async t => {
  const { tmpDir, db } = await withFixture(t, 'attachment-images-scope-');
  const otherSessionId = 'att_10101010101010101010101010101010';
  const expiredId = 'att_20202020202020202020202020202020';
  await seedImage(db, tmpDir, {
    id: otherSessionId,
    bytes: Buffer.from('남의 대화'),
    sessionId: 'other-session',
    lifecycleStatus: 'attached_temporary',
  });
  attachToTurn(db, { attachmentId: otherSessionId, sessionId: 'other-session' });
  await seedImage(db, tmpDir, {
    id: expiredId,
    bytes: Buffer.from('만료됨'),
    sessionId: 'shared-main',
    lifecycleStatus: 'expired',
  });
  attachToTurn(db, { attachmentId: expiredId });

  const images = createAttachmentImageService(db, { enabled: true, tmpDir });
  const result = await images.listTurnImages({
    sessionId: 'shared-main',
    attachmentIds: [otherSessionId, expiredId],
  });
  assert.deepEqual(result.images, []);
  assert.equal(images.hasTemporaryImages({ sessionId: 'shared-main' }), false);

  const disabled = createAttachmentImageService(db, { enabled: false, tmpDir });
  assert.deepEqual((await disabled.listTurnImages({ sessionId: 'shared-main' })).images, []);
});

test('서버가 이미지 턴만 멀티모달 입력으로 바꾸고 검증된 모델을 요구한다', () => {
  const server = fsSync.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  // 이미지는 모델 선택보다 먼저 확정돼야 검증된 모델만 고를 수 있다.
  assert.match(
    server,
    /const turnImages = await attachmentImages\.listTurnImages\(\{[\s\S]*?\}\);[\s\S]{0,600}?resolveChatModelSelection\(\{/,
  );
  assert.match(server, /requireImageInput: turnImages\.images\.length > 0/);
  // 이미지가 없는 턴은 기존 문자열 입력을 그대로 쓴다.
  assert.match(
    server,
    /content: turnImages\.images\.length > 0\s*\?\s*\[\s*\{ type: 'input_text', text: contextMessage \},[\s\S]*?type: 'input_image',[\s\S]*?image_url: image\.dataUrl,[\s\S]*?\]\s*:\s*contextMessage,/,
  );
  // 이미지 미지원은 조용한 모델 교체 대신 사용자에게 보이는 오류로 나간다.
  assert.match(server, /code === 'MODEL_IMAGE_UNSUPPORTED'/);
});
