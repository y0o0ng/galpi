'use strict';

const { sha256 } = require('./content-hash');

const LATEST_SCHEMA_VERSION = 2;

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
