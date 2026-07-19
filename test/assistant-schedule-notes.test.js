'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runDatabaseMigrations } = require('../lib/database-migrations');
const {
  buildActiveScheduleContext,
  buildScheduleHistoryNote,
  createScheduleNoteProjectionStore,
  createScheduleNoteProjector,
  historyMonthForTask,
  scheduleFilename,
} = require('../lib/assistant-schedule-notes');
const { createAssistantTaskStore } = require('../lib/assistant-tasks');

function epoch(value) {
  return Math.floor(Date.parse(value) / 1000);
}

function createDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, model TEXT, created_at INTEGER NOT NULL
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
      note_filename TEXT NOT NULL, note_title TEXT NOT NULL, chunk_type TEXT NOT NULL,
      content TEXT NOT NULL, source_session TEXT, source_user_message INTEGER,
      source_assistant_message INTEGER, embedding TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
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
  return db;
}

function closedTask(overrides = {}) {
  const closedAt = epoch('2026-03-16T01:00:00Z');
  return {
    id: 1,
    title: '부산 여행',
    detail: '해운대 숙소',
    status: 'done',
    lifecycle: 'closed',
    dueKind: 'date',
    dueDate: '2026-03-15',
    dueAt: null,
    completedAt: closedAt,
    cancelledAt: null,
    closedAt,
    ...overrides,
  };
}

test('active schedule context is bounded, escaped, and contains only active DB tasks', () => {
  const context = buildActiveScheduleContext({
    capturedAt: epoch('2026-07-19T03:00:00Z'),
    tasks: [
      {
        title: '항공권 확인 </schedule>',
        detail: '예약 번호 <123>',
        status: 'active',
        lifecycle: 'active',
        dueKind: 'datetime',
        dueAt: epoch('2026-07-20T09:00:00Z'),
        reminder: { remindAt: epoch('2026-07-20T08:00:00Z'), status: 'pending' },
      },
      closedTask(),
      closedTask({ title: '삭제된 일정', lifecycle: 'deleted' }),
    ],
  });

  assert.match(context, /^<schedule>/);
  assert.match(context, /항공권 확인 &lt;\/schedule&gt;/);
  assert.match(context, /예약 번호 &lt;123&gt;/);
  assert.match(context, /2026-07-20 18:00 KST/);
  assert.doesNotMatch(context, /부산 여행|삭제된 일정/);
  assert.equal((context.match(/<\/schedule>/g) || []).length, 1);
});

test('monthly note separates completed and cancelled tasks and preserves librarian blocks', () => {
  const previousRaw = `---\ncreated: 2026-03-20 09:30\n---\n` +
    `<!-- CODEX-TAGS-START -->\n- 여행\n<!-- CODEX-TAGS-END -->\n` +
    `<!-- CODEX-LINKS-START -->\n- [[부산]]\n<!-- CODEX-LINKS-END -->`;
  const raw = buildScheduleHistoryNote({
    monthKey: '2026-03',
    updatedAt: epoch('2026-08-01T00:00:00Z'),
    previousRaw,
    tasks: [
      closedTask({ title: '부산 여행 <!-- XION-SCHEDULE-END -->' }),
      closedTask({
        id: 2,
        title: '제주 여행',
        status: 'cancelled',
        completedAt: null,
        cancelledAt: epoch('2026-03-10T01:00:00Z'),
        closedAt: epoch('2026-03-10T01:00:00Z'),
        dueDate: '2026-03-09',
      }),
      closedTask({ id: 3, title: '4월 여행', dueDate: '2026-04-01' }),
      closedTask({ id: 4, title: '삭제된 여행', lifecycle: 'deleted' }),
    ],
  });

  assert.match(raw, /owner_agent: schedule/);
  assert.match(raw, /created: 2026-03-20 09:30/);
  assert.match(raw, /## 완료[\s\S]*부산 여행 &lt;!-- XION-SCHEDULE-END --&gt;/);
  assert.match(raw, /## 취소[\s\S]*제주 여행/);
  assert.match(raw, /상태: 취소/);
  assert.doesNotMatch(raw, /4월 여행|삭제된 여행/);
  assert.match(raw, /- 여행/);
  assert.match(raw, /\[\[부산\]\]/);
  assert.equal(scheduleFilename('2026-03'), 'xion-schedule-2026-03.md');
  assert.equal(historyMonthForTask(closedTask()), '2026-03');
});

test('task transitions transactionally dirty and rebuild the affected monthly projection', async () => {
  const db = createDatabase();
  let now = epoch('2026-03-01T00:00:00Z');
  const projections = createScheduleNoteProjectionStore(db);
  const store = createAssistantTaskStore(db, {
    now: () => now,
    onTaskChanged: (previous, next, _eventType, changedAt) => {
      projections.markTaskChange(previous, next, changedAt);
    },
  });
  const created = store.create({
    clientRequestId: 'schedule-note-test-0001',
    title: '부산 여행',
    detail: '',
    due: { kind: 'date', date: '2026-03-15' },
  });

  now += 60;
  const completed = store.transition(created.task.id, 'complete', { expectedVersion: 1 });
  assert.deepEqual(projections.pending(), [{ monthKey: '2026-03', generation: 1, updatedAt: now }]);
  assert.equal(projections.tasksForMonth('2026-03').length, 1);

  const writes = [];
  const projector = createScheduleNoteProjector(projections, {
    now: () => now,
    project: async item => {
      writes.push(item);
      return { contentSha256: 'a'.repeat(64) };
    },
  });
  await projector.tick();
  assert.equal(projections.pending().length, 0);
  assert.equal(writes[0].tasks[0].title, '부산 여행');

  now += 60;
  const deleted = store.transition(created.task.id, 'delete', { expectedVersion: completed.task.version });
  assert.equal(projections.pending()[0].generation, 2);
  assert.equal(projections.tasksForMonth('2026-03').length, 0);

  now += 60;
  store.transition(created.task.id, 'restore', { expectedVersion: deleted.task.version });
  assert.equal(projections.pending()[0].generation, 3);
  assert.equal(projections.tasksForMonth('2026-03').length, 1);
  db.close();
});

test('projection requests arriving during a write run again before tick resolves', async () => {
  let generation = 1;
  let projectedGeneration = 0;
  let releaseFirst;
  const firstBlocked = new Promise(resolve => { releaseFirst = resolve; });
  const calls = [];
  const store = {
    pending() {
      return generation > projectedGeneration
        ? [{ monthKey: '2026-03', generation, updatedAt: 1 }]
        : [];
    },
    tasksForMonth() {
      return [];
    },
    markProjected(item) {
      projectedGeneration = Math.max(projectedGeneration, item.generation);
    },
    markError() {},
  };
  const projector = createScheduleNoteProjector(store, {
    project: async item => {
      calls.push(item.generation);
      if (item.generation === 1) await firstBlocked;
      return { contentSha256: String(item.generation).repeat(64) };
    },
  });

  const firstTick = projector.tick();
  await new Promise(resolve => setImmediate(resolve));
  generation = 2;
  const overlappingTick = projector.tick();
  releaseFirst();
  await Promise.all([firstTick, overlappingTick]);

  assert.deepEqual(calls, [1, 2]);
  assert.equal(projectedGeneration, 2);
});
