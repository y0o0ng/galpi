'use strict';

const { sha256 } = require('./content-hash');

const LATEST_SCHEMA_VERSION = 6;

function tableColumns(db, tableName) {
  return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map(column => column.name));
}

function addColumnIfMissing(db, tableName, columnName, definition) {
  if (tableColumns(db, tableName).has(columnName)) return false;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  return true;
}

const migrations = [
  {
    version: 1,
    name: 'legacy_optional_columns',
    up(db) {
      addColumnIfMissing(db, 'notes', 'embedding', 'TEXT');
      addColumnIfMissing(db, 'notes', 'paper_id', 'TEXT');
      addColumnIfMissing(db, 'messages', 'embedding', 'TEXT');
      addColumnIfMissing(
        db,
        'auto_save_decisions',
        'organize_queued',
        'INTEGER NOT NULL DEFAULT 0',
      );
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_active_paper_id
        ON notes(paper_id)
        WHERE paper_id IS NOT NULL AND archived = 0;

        CREATE INDEX IF NOT EXISTS idx_auto_save_decisions_queue
        ON auto_save_decisions(organize_queued, decision, action);
      `);
    },
  },
  {
    version: 2,
    name: 'topic_chunk_integrity',
    up(db) {
      addColumnIfMissing(db, 'note_chunks', 'content_sha256', 'TEXT');
      addColumnIfMissing(
        db,
        'note_chunks',
        'index_status',
        "TEXT NOT NULL DEFAULT 'ready' CHECK (index_status IN ('ready', 'source_missing'))",
      );

      const rows = db.prepare(`
        SELECT chunk_id AS chunkId, content
        FROM note_chunks
        WHERE content_sha256 IS NULL OR content_sha256 = ''
      `).all();
      const updateHash = db.prepare(`
        UPDATE note_chunks
        SET content_sha256 = ?
        WHERE chunk_id = ?
      `);
      for (const row of rows) updateHash.run(sha256(row.content), row.chunkId);

      db.exec(`
        UPDATE note_chunks
        SET index_status = 'ready'
        WHERE index_status IS NULL OR index_status = '';

        CREATE INDEX IF NOT EXISTS idx_note_chunks_index_status
        ON note_chunks(index_status, chunk_type, note_filename);
      `);
    },
  },
  {
    version: 3,
    name: 'retrieval_shadow_query_hash',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS assistant_retrieval_shadow_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT,
          mode TEXT NOT NULL,
          notes_json TEXT NOT NULL,
          chunks_json TEXT NOT NULL,
          context_chars INTEGER NOT NULL DEFAULT 0,
          latency_ms INTEGER NOT NULL DEFAULT 0,
          error TEXT,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        )
      `);
      addColumnIfMissing(db, 'assistant_retrieval_shadow_runs', 'query_sha256', 'TEXT');
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_retrieval_shadow_query_hash
        ON assistant_retrieval_shadow_runs(query_sha256);
      `);
    },
  },
  {
    version: 4,
    name: 'note_index_integrity',
    up(db) {
      addColumnIfMissing(db, 'notes', 'content_sha256', 'TEXT');
      addColumnIfMissing(db, 'notes', 'indexed_sha256', 'TEXT');
      addColumnIfMissing(
        db,
        'notes',
        'index_status',
        "TEXT NOT NULL DEFAULT 'pending' CHECK (index_status IN ('pending', 'ready', 'error', 'missing'))",
      );
      db.exec(`
        UPDATE notes
        SET index_status = 'pending'
        WHERE index_status IS NULL OR index_status = '';

        CREATE INDEX IF NOT EXISTS idx_notes_index_status
        ON notes(index_status, archived, note_type);
      `);
    },
  },
  {
    version: 5,
    name: 'note_ai_read_access',
    up(db) {
      addColumnIfMissing(
        db,
        'notes',
        'ai_readable',
        'INTEGER NOT NULL DEFAULT 1 CHECK (ai_readable IN (0, 1))',
      );
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_notes_ai_access
        ON notes(ai_readable, archived, codex_status, note_type);
      `);
    },
  },
  {
    version: 6,
    name: 'assistant_task_core',
    up(db) {
      db.exec(`
        CREATE TABLE assistant_tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_request_id TEXT NOT NULL UNIQUE,
          create_payload_sha256 TEXT NOT NULL
            CHECK (length(create_payload_sha256) = 64),
          title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
          detail TEXT NOT NULL DEFAULT '' CHECK (length(detail) <= 2000),
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'done', 'cancelled')),
          lifecycle TEXT NOT NULL DEFAULT 'active'
            CHECK (lifecycle IN ('active', 'closed', 'deleted')),
          deleted_from_lifecycle TEXT
            CHECK (deleted_from_lifecycle IN ('active', 'closed')),
          due_kind TEXT NOT NULL DEFAULT 'none'
            CHECK (due_kind IN ('none', 'date', 'datetime')),
          due_date TEXT,
          due_at INTEGER,
          timezone TEXT NOT NULL DEFAULT 'Asia/Seoul'
            CHECK (timezone = 'Asia/Seoul'),
          reminder_version INTEGER NOT NULL DEFAULT 1
            CHECK (reminder_version >= 1),
          version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          completed_at INTEGER,
          cancelled_at INTEGER,
          closed_at INTEGER,
          deleted_at INTEGER,
          CHECK (
            (due_kind = 'none' AND due_date IS NULL AND due_at IS NULL) OR
            (due_kind = 'date' AND due_date GLOB '????-??-??' AND due_at IS NULL) OR
            (due_kind = 'datetime' AND due_date IS NULL AND due_at IS NOT NULL)
          ),
          CHECK (
            (status = 'active' AND completed_at IS NULL AND cancelled_at IS NULL) OR
            (status = 'done' AND completed_at IS NOT NULL AND cancelled_at IS NULL) OR
            (status = 'cancelled' AND completed_at IS NULL AND cancelled_at IS NOT NULL)
          ),
          CHECK (
            (lifecycle = 'active' AND status = 'active' AND closed_at IS NULL
              AND deleted_at IS NULL AND deleted_from_lifecycle IS NULL) OR
            (lifecycle = 'closed' AND status IN ('done', 'cancelled') AND closed_at IS NOT NULL
              AND deleted_at IS NULL AND deleted_from_lifecycle IS NULL) OR
            (lifecycle = 'deleted' AND deleted_at IS NOT NULL
              AND deleted_from_lifecycle IN ('active', 'closed')
              AND ((deleted_from_lifecycle = 'active' AND closed_at IS NULL) OR
                   (deleted_from_lifecycle = 'closed' AND closed_at IS NOT NULL)))
          )
        );

        CREATE TABLE assistant_task_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id INTEGER NOT NULL,
          event_type TEXT NOT NULL CHECK (event_type IN (
            'created', 'updated', 'completed', 'cancelled', 'reopened', 'deleted', 'restored'
          )),
          from_status TEXT CHECK (from_status IN ('active', 'done', 'cancelled')),
          to_status TEXT NOT NULL CHECK (to_status IN ('active', 'done', 'cancelled')),
          from_lifecycle TEXT CHECK (from_lifecycle IN ('active', 'closed', 'deleted')),
          to_lifecycle TEXT NOT NULL CHECK (to_lifecycle IN ('active', 'closed', 'deleted')),
          task_version INTEGER NOT NULL CHECK (task_version >= 1),
          actor_type TEXT NOT NULL DEFAULT 'user'
            CHECK (actor_type IN ('user', 'system')),
          occurred_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          FOREIGN KEY (task_id) REFERENCES assistant_tasks(id)
        );

        CREATE TABLE assistant_reminders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id INTEGER NOT NULL,
          remind_at INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'fired', 'acknowledged', 'cancelled')),
          occurrence_key TEXT NOT NULL UNIQUE,
          snoozed_from_id INTEGER,
          snooze_request_key TEXT UNIQUE,
          fired_at INTEGER,
          acknowledged_at INTEGER,
          acknowledgement_action TEXT
            CHECK (acknowledgement_action IN ('seen', 'snoozed', 'completed')),
          cancellation_reason TEXT CHECK (cancellation_reason IN (
            'task_completed', 'task_cancelled', 'task_deleted', 'replaced', 'removed'
          )),
          cancelled_at INTEGER,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          FOREIGN KEY (task_id) REFERENCES assistant_tasks(id),
          FOREIGN KEY (snoozed_from_id) REFERENCES assistant_reminders(id),
          CHECK (
            (snoozed_from_id IS NULL AND snooze_request_key IS NULL) OR
            (snoozed_from_id IS NOT NULL AND snooze_request_key IS NOT NULL)
          ),
          CHECK (
            (status = 'pending' AND fired_at IS NULL AND acknowledged_at IS NULL
              AND acknowledgement_action IS NULL AND cancellation_reason IS NULL
              AND cancelled_at IS NULL) OR
            (status = 'fired' AND fired_at IS NOT NULL AND acknowledged_at IS NULL
              AND acknowledgement_action IS NULL AND cancellation_reason IS NULL
              AND cancelled_at IS NULL) OR
            (status = 'acknowledged' AND fired_at IS NOT NULL AND acknowledged_at IS NOT NULL
              AND acknowledgement_action IS NOT NULL AND cancellation_reason IS NULL
              AND cancelled_at IS NULL) OR
            (status = 'cancelled' AND acknowledged_at IS NULL
              AND acknowledgement_action IS NULL AND cancellation_reason IS NOT NULL
              AND cancelled_at IS NOT NULL)
          )
        );

        CREATE INDEX idx_assistant_tasks_status_due_date
          ON assistant_tasks(status, due_date);
        CREATE INDEX idx_assistant_tasks_status_due_at
          ON assistant_tasks(status, due_at);
        CREATE INDEX idx_assistant_tasks_lifecycle_updated
          ON assistant_tasks(lifecycle, updated_at);
        CREATE INDEX idx_assistant_task_events_task_occurred
          ON assistant_task_events(task_id, occurred_at, id);
        CREATE INDEX idx_assistant_reminders_status_remind_at
          ON assistant_reminders(status, remind_at);
        CREATE INDEX idx_assistant_reminders_task_status
          ON assistant_reminders(task_id, status);
        CREATE UNIQUE INDEX idx_assistant_reminders_one_live_per_task
          ON assistant_reminders(task_id)
          WHERE status IN ('pending', 'fired');
      `);
    },
  },
];

function runDatabaseMigrations(db) {
  if (!db?.prepare || typeof db.transaction !== 'function') {
    throw new TypeError('SQLite DB 연결이 필요합니다.');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )
  `);

  const appliedRows = db.prepare(`
    SELECT version, name
    FROM schema_version
    ORDER BY version ASC
  `).all();
  const appliedVersions = new Set(appliedRows.map(row => row.version));
  const highestVersion = appliedRows.at(-1)?.version || 0;
  if (highestVersion > LATEST_SCHEMA_VERSION) {
    throw new Error(`지원하지 않는 DB schema version입니다: ${highestVersion}`);
  }
  for (let version = 1; version <= highestVersion; version += 1) {
    if (!appliedVersions.has(version)) {
      throw new Error(`DB schema version 기록이 연속적이지 않습니다: ${version}`);
    }
  }

  const insertVersion = db.prepare(`
    INSERT INTO schema_version (version, name)
    VALUES (?, ?)
  `);
  const applied = [];
  for (const migration of migrations) {
    if (migration.version <= highestVersion) continue;
    db.transaction(() => {
      migration.up(db);
      insertVersion.run(migration.version, migration.name);
    })();
    applied.push({ version: migration.version, name: migration.name });
  }

  return {
    currentVersion: applied.at(-1)?.version || highestVersion,
    applied,
  };
}

module.exports = {
  LATEST_SCHEMA_VERSION,
  runDatabaseMigrations,
};
