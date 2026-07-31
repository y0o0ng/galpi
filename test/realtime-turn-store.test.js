'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  createRealtimeTurnStore,
  isPersistableUserTurn,
} = require('../lib/realtime-turn-store');

const SESSION = 'voice-session-1';
const ITEM = 'item_abc';

function createDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE realtime_turn_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      input_item_id TEXT NOT NULL,
      final_response_id TEXT,
      audio_sha256 TEXT,
      status TEXT NOT NULL DEFAULT 'correction_pending'
        CHECK (status IN (
          'correction_pending', 'corrected', 'ready_to_finalize', 'finalized',
          'correction_failed', 'needs_review', 'discarded'
        )),
      corrected_transcript TEXT,
      transcript_origin TEXT CHECK (
        transcript_origin IS NULL
        OR transcript_origin IN ('stt_corrected', 'user_edited')
      ),
      transcription_model TEXT,
      assistant_transcript TEXT,
      assistant_status TEXT CHECK (
        assistant_status IS NULL
        OR assistant_status IN ('completed', 'cancelled', 'failed', 'incomplete')
      ),
      user_message_id INTEGER REFERENCES messages(id),
      assistant_message_id INTEGER REFERENCES messages(id),
      usage_json TEXT,
      error_code TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      finalized_at INTEGER
    );
    CREATE UNIQUE INDEX idx_realtime_turn_receipts_item
      ON realtime_turn_receipts(session_id, input_item_id);
  `);
  return db;
}

function createStore(db, overrides = {}) {
  const insert = db.prepare(
    'INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)',
  );
  return createRealtimeTurnStore({
    db,
    enabled: true,
    insertMessage: ({ sessionId, role, content }) => (
      Number(insert.run(sessionId, role, content).lastInsertRowid)
    ),
    ...overrides,
  });
}

function messageRows(db) {
  return db.prepare('SELECT id, session_id, role, content FROM messages ORDER BY id ASC').all();
}

function receiptRow(db) {
  return db
    .prepare('SELECT * FROM realtime_turn_receipts WHERE session_id = ? AND input_item_id = ?')
    .get(SESSION, ITEM);
}

test('empty and punctuation-only corrected transcripts are never persisted', () => {
  for (const value of ['', '   ', '.', '...', '  ??  ', null, undefined]) {
    assert.equal(
      isPersistableUserTurn(value),
      false,
      `expected ${JSON.stringify(value)} to be filtered`,
    );
  }
});

test('observed throat-clear fillers are filtered regardless of the assistant outcome', () => {
  for (const value of ['하...', '그', '음', '흥.', '음.', '음음', '하하', 'uh', 'Um']) {
    assert.equal(
      isPersistableUserTurn(value),
      false,
      `expected ${JSON.stringify(value)} to be filtered`,
    );
  }
});

test('short real answers and real interruptions survive the filter', () => {
  // 필러 집합에 없는 짧은 대답은 그대로 남는다.
  assert.equal(isPersistableUserTurn('응'), true);
  assert.equal(isPersistableUserTurn('네'), true);
  // 실제 끼어들기도 저장한다.
  assert.equal(isPersistableUserTurn('잠깐'), true);
  assert.equal(isPersistableUserTurn('아니 그거 말고'), true);
  // 필러로 시작해도 실질 글자가 2자를 넘으면 실제 발화로 본다.
  assert.equal(isPersistableUserTurn('음 좋아'), true);
});

test('a turn finalizes only after both the correction and the assistant outcome arrive', () => {
  const db = createDatabase();
  const store = createStore(db);

  const afterCorrection = store.recordCorrection({
    sessionId: SESSION,
    inputItemId: ITEM,
    correctedTranscript: '내일 회의 몇 시야?',
    transcriptionModel: 'gpt-transcribe',
  });
  assert.equal(afterCorrection.finalized, false);
  assert.equal(messageRows(db).length, 0);

  const afterAssistant = store.recordAssistant({
    sessionId: SESSION,
    inputItemId: ITEM,
    finalResponseId: 'resp_1',
    assistantTranscript: '오후 3시야.',
    assistantStatus: 'completed',
  });
  assert.equal(afterAssistant.finalized, true);

  const rows = messageRows(db);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.role), ['user', 'assistant']);
  assert.deepEqual(rows.map(row => row.session_id), ['shared-main', 'shared-main']);
  // 과거 대화 검색이 답변을 id > user_id로 찾으므로 순서가 뒤집히면 안 된다.
  assert.ok(rows[0].id < rows[1].id);
  assert.equal(afterAssistant.userMessageId, rows[0].id);
  assert.equal(afterAssistant.assistantMessageId, rows[1].id);
});

test('the assistant outcome arriving first still finalizes in the right message order', () => {
  const db = createDatabase();
  const store = createStore(db);

  store.recordAssistant({
    sessionId: SESSION,
    inputItemId: ITEM,
    finalResponseId: 'resp_1',
    assistantTranscript: '오후 3시야.',
    assistantStatus: 'completed',
  });
  assert.equal(messageRows(db).length, 0);

  const result = store.recordCorrection({
    sessionId: SESSION,
    inputItemId: ITEM,
    correctedTranscript: '내일 회의 몇 시야?',
  });

  assert.equal(result.finalized, true);
  const rows = messageRows(db);
  assert.deepEqual(rows.map(row => row.role), ['user', 'assistant']);
  assert.ok(rows[0].id < rows[1].id);
});

test('repeating either record call after finalization returns the same message ids', () => {
  const db = createDatabase();
  const store = createStore(db);

  store.recordCorrection({
    sessionId: SESSION,
    inputItemId: ITEM,
    correctedTranscript: '내일 회의 몇 시야?',
  });
  const first = store.recordAssistant({
    sessionId: SESSION,
    inputItemId: ITEM,
    assistantTranscript: '오후 3시야.',
    assistantStatus: 'completed',
  });

  const repeatedAssistant = store.recordAssistant({
    sessionId: SESSION,
    inputItemId: ITEM,
    assistantTranscript: '오후 3시야.',
    assistantStatus: 'completed',
  });
  const repeatedCorrection = store.recordCorrection({
    sessionId: SESSION,
    inputItemId: ITEM,
    correctedTranscript: '내일 회의 몇 시야?',
  });

  assert.deepEqual(repeatedAssistant, first);
  assert.deepEqual(repeatedCorrection, first);
  assert.equal(messageRows(db).length, 2);
});

test('an interrupted assistant stores the corrected user turn alone', () => {
  const db = createDatabase();
  const store = createStore(db);

  store.recordCorrection({
    sessionId: SESSION,
    inputItemId: ITEM,
    correctedTranscript: '잠깐 그거 말고 다른 거',
  });
  const result = store.recordAssistant({
    sessionId: SESSION,
    inputItemId: ITEM,
    assistantTranscript: '오후 3시까지 말하다 끊긴 부분',
    assistantStatus: 'cancelled',
  });

  assert.equal(result.finalized, true);
  assert.equal(result.assistantMessageId, null);
  const rows = messageRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, 'user');
  // partial text는 durable 본문으로 남기지 않는다.
  assert.equal(receiptRow(db).assistant_transcript, null);
});

test('an incomplete assistant is not promoted to a completed message', () => {
  const db = createDatabase();
  const store = createStore(db);

  store.recordCorrection({
    sessionId: SESSION,
    inputItemId: ITEM,
    correctedTranscript: '아까 그 논문 요약해줘',
  });
  const result = store.recordAssistant({
    sessionId: SESSION,
    inputItemId: ITEM,
    assistantTranscript: '길게 말하다 상한에 걸린 부분',
    assistantStatus: 'incomplete',
  });

  assert.equal(result.assistantMessageId, null);
  assert.equal(messageRows(db).length, 1);
  assert.equal(receiptRow(db).assistant_status, 'incomplete');
});

test('a throat-clear turn writes no message and is recorded as an empty turn', () => {
  const db = createDatabase();
  const store = createStore(db);

  store.recordCorrection({
    sessionId: SESSION,
    inputItemId: ITEM,
    correctedTranscript: '음.',
  });
  const result = store.recordAssistant({
    sessionId: SESSION,
    inputItemId: ITEM,
    assistantStatus: 'cancelled',
  });

  assert.equal(result.discarded, true);
  assert.equal(result.finalized, false);
  assert.equal(messageRows(db).length, 0);

  const receipt = receiptRow(db);
  assert.equal(receipt.status, 'discarded');
  assert.equal(receipt.error_code, 'empty_turn');
  assert.equal(receipt.user_message_id, null);

  // 이미 버려진 턴은 같은 이벤트가 다시 와도 되살아나지 않는다.
  const repeated = store.recordCorrection({
    sessionId: SESSION,
    inputItemId: ITEM,
    correctedTranscript: '음.',
  });
  assert.equal(repeated.discarded, true);
  assert.equal(messageRows(db).length, 0);
});

// 2026-07-31 Pi 실기기 회귀. 시온이 말을 끝낸 뒤의 헛기침은 사용자 턴을 만들고
// 정상 completed 답변까지 받아내므로, assistant 상태로는 걸러지지 않는다.
test('a throat clear answered by a completed response is still discarded', () => {
  const db = createDatabase();
  const store = createStore(db);

  store.recordCorrection({
    sessionId: SESSION,
    inputItemId: ITEM,
    correctedTranscript: '음.',
  });
  const result = store.recordAssistant({
    sessionId: SESSION,
    inputItemId: ITEM,
    finalResponseId: 'resp-cough',
    assistantTranscript: '그래서 그 이미지는 부서진 여러 존재들이 겹겹이 쌓이면서 새로워지는 거야.',
    assistantStatus: 'completed',
  });

  assert.equal(result.discarded, true);
  assert.equal(result.finalized, false);
  assert.equal(messageRows(db).length, 0);
  assert.equal(receiptRow(db).error_code, 'empty_turn');
});

test('separate turns in one session are tracked independently', () => {
  const db = createDatabase();
  const store = createStore(db);

  for (const [item, transcript, status] of [
    ['item_1', '음.', 'cancelled'],
    ['item_2', '내일 일정 알려줘', 'completed'],
  ]) {
    store.recordCorrection({
      sessionId: SESSION,
      inputItemId: item,
      correctedTranscript: transcript,
    });
    store.recordAssistant({
      sessionId: SESSION,
      inputItemId: item,
      assistantTranscript: status === 'completed' ? '오전 10시 하나 있어.' : null,
      assistantStatus: status,
    });
  }

  const rows = messageRows(db);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.content), ['내일 일정 알려줘', '오전 10시 하나 있어.']);
});

test('the store stays inert while the finalize flag is off', () => {
  const db = createDatabase();
  const store = createRealtimeTurnStore({ db, enabled: false, insertMessage: () => 1 });

  assert.equal(store.available, false);
  assert.deepEqual(store.publicConfig(), { finalizeEnabled: false });
  assert.equal(store.getReceipt({ sessionId: SESSION, inputItemId: ITEM }), null);
  assert.throws(() => store.recordCorrection({
    sessionId: SESSION,
    inputItemId: ITEM,
    correctedTranscript: '내일 회의 몇 시야?',
  }));
  assert.equal(messageRows(db).length, 0);
});
