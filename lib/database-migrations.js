'use strict';

const { sha256 } = require('./content-hash');

const LATEST_SCHEMA_VERSION = 17;

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
  {
    version: 7,
    name: 'assistant_web_push',
    up(db) {
      db.exec(`
        CREATE TABLE assistant_push_subscriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          endpoint TEXT NOT NULL UNIQUE CHECK (length(endpoint) BETWEEN 1 AND 2048),
          p256dh TEXT NOT NULL CHECK (length(p256dh) BETWEEN 1 AND 256),
          auth TEXT NOT NULL CHECK (length(auth) BETWEEN 1 AND 128),
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'expired', 'revoked')),
          device_label TEXT NOT NULL DEFAULT '' CHECK (length(device_label) <= 80),
          failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
          last_success_at INTEGER,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE assistant_push_deliveries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          reminder_id INTEGER NOT NULL,
          subscription_id INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN (
              'pending', 'sending', 'retry', 'accepted', 'failed', 'expired', 'skipped'
            )),
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
          next_attempt_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          lease_until INTEGER,
          last_attempt_at INTEGER,
          last_http_status INTEGER,
          last_error_code TEXT CHECK (length(last_error_code) <= 80),
          accepted_at INTEGER,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          FOREIGN KEY (reminder_id) REFERENCES assistant_reminders(id),
          FOREIGN KEY (subscription_id) REFERENCES assistant_push_subscriptions(id),
          UNIQUE (reminder_id, subscription_id),
          CHECK (expires_at >= created_at),
          CHECK (
            (status = 'sending' AND lease_until IS NOT NULL) OR
            (status != 'sending' AND lease_until IS NULL)
          )
        );

        CREATE INDEX idx_assistant_push_subscriptions_status
          ON assistant_push_subscriptions(status, updated_at);
        CREATE INDEX idx_assistant_push_deliveries_due
          ON assistant_push_deliveries(status, next_attempt_at);
        CREATE INDEX idx_assistant_push_deliveries_lease
          ON assistant_push_deliveries(status, lease_until);
        CREATE INDEX idx_assistant_push_deliveries_reminder
          ON assistant_push_deliveries(reminder_id, status);
      `);
    },
  },
  {
    version: 8,
    name: 'assistant_schedule_note_projection',
    up(db) {
      addColumnIfMissing(db, 'notes', 'owner_agent', 'TEXT');
      db.exec(`
        CREATE TABLE assistant_schedule_note_projections (
          month_key TEXT PRIMARY KEY
            CHECK (
              month_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND
              CAST(substr(month_key, 6, 2) AS INTEGER) BETWEEN 1 AND 12
            ),
          generation INTEGER NOT NULL DEFAULT 1 CHECK (generation >= 1),
          projected_generation INTEGER NOT NULL DEFAULT 0
            CHECK (projected_generation >= 0 AND projected_generation <= generation),
          content_sha256 TEXT CHECK (content_sha256 IS NULL OR length(content_sha256) = 64),
          last_error TEXT,
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          projected_at INTEGER
        );

        CREATE INDEX idx_notes_owner_agent
          ON notes(owner_agent, archived, ai_readable);
        CREATE INDEX idx_assistant_schedule_note_projection_pending
          ON assistant_schedule_note_projections(projected_generation, generation, updated_at);

        INSERT OR IGNORE INTO assistant_schedule_note_projections (month_key)
        SELECT DISTINCT CASE due_kind
          WHEN 'date' THEN substr(due_date, 1, 7)
          WHEN 'datetime' THEN strftime('%Y-%m', due_at, 'unixepoch', '+9 hours')
          ELSE strftime('%Y-%m', closed_at, 'unixepoch', '+9 hours')
        END
        FROM assistant_tasks
        WHERE lifecycle = 'closed' AND status IN ('done', 'cancelled');
      `);
    },
  },
  {
    version: 9,
    name: 'model_runtime_catalog',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS codex_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          status TEXT NOT NULL DEFAULT 'pending',
          note_filenames_json TEXT NOT NULL,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          error TEXT,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          started_at INTEGER,
          finished_at INTEGER
        )
      `);
      addColumnIfMissing(db, 'messages', 'model_selection', 'TEXT');
      addColumnIfMissing(db, 'messages', 'model_catalog_generation', 'INTEGER');
      addColumnIfMissing(db, 'messages', 'runtime_generation', 'TEXT');
      addColumnIfMissing(db, 'messages', 'reasoning_effort', 'TEXT');
      addColumnIfMissing(db, 'codex_jobs', 'model_selection', 'TEXT');
      addColumnIfMissing(db, 'codex_jobs', 'model_id', 'TEXT');
      addColumnIfMissing(db, 'codex_jobs', 'model_catalog_generation', 'INTEGER');

      db.exec(`
        CREATE TABLE app_settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE model_catalog_cache (
          surface TEXT PRIMARY KEY
            CHECK (surface IN ('openai_api', 'codex_subscription')),
          generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
          payload_json TEXT,
          payload_version INTEGER NOT NULL DEFAULT 1 CHECK (payload_version >= 1),
          last_attempt_at INTEGER,
          last_success_at INTEGER,
          last_error_code TEXT CHECK (
            last_error_code IS NULL OR length(last_error_code) BETWEEN 1 AND 80
          ),
          last_error_at INTEGER
        );

        CREATE INDEX idx_messages_runtime_generation
          ON messages(runtime_generation, created_at);
        CREATE INDEX idx_codex_jobs_model
          ON codex_jobs(model_id, status, created_at);
      `);
    },
  },
  {
    version: 10,
    name: 'realtime_turn_receipts',
    up(db) {
      db.exec(`
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
          error_code TEXT CHECK (
            error_code IS NULL OR length(error_code) BETWEEN 1 AND 80
          ),
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          finalized_at INTEGER
        );

        CREATE UNIQUE INDEX idx_realtime_turn_receipts_item
          ON realtime_turn_receipts(session_id, input_item_id);
        CREATE UNIQUE INDEX idx_realtime_turn_receipts_response
          ON realtime_turn_receipts(final_response_id)
          WHERE final_response_id IS NOT NULL;
        CREATE INDEX idx_realtime_turn_receipts_status
          ON realtime_turn_receipts(status, created_at);
      `);
    },
  },
  {
    version: 11,
    name: 'voice_shortcut_access',
    up(db) {
      db.exec(`
        CREATE TABLE assistant_shortcut_credentials (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          subscription_id INTEGER NOT NULL UNIQUE,
          token_sha256 TEXT NOT NULL UNIQUE CHECK (length(token_sha256) = 64),
          token_prefix TEXT NOT NULL CHECK (length(token_prefix) BETWEEN 6 AND 12),
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'revoked')),
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          last_used_at INTEGER,
          revoked_at INTEGER,
          FOREIGN KEY (subscription_id) REFERENCES assistant_push_subscriptions(id),
          CHECK (
            (status = 'active' AND revoked_at IS NULL) OR
            (status = 'revoked' AND revoked_at IS NOT NULL)
          )
        );

        CREATE TABLE voice_shortcut_receipts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          credential_id INTEGER NOT NULL,
          request_id TEXT NOT NULL CHECK (length(request_id) = 36),
          request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64),
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'completed')),
          conversation_id TEXT NOT NULL CHECK (length(conversation_id) BETWEEN 22 AND 64),
          attempt_count INTEGER NOT NULL DEFAULT 1
            CHECK (attempt_count BETWEEN 1 AND 3),
          user_message_id INTEGER REFERENCES messages(id),
          assistant_message_id INTEGER REFERENCES messages(id),
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          completed_at INTEGER,
          FOREIGN KEY (credential_id) REFERENCES assistant_shortcut_credentials(id),
          UNIQUE (credential_id, request_id),
          CHECK (
            (status = 'pending' AND user_message_id IS NULL
              AND assistant_message_id IS NULL AND completed_at IS NULL) OR
            (status = 'completed' AND user_message_id IS NOT NULL
              AND assistant_message_id IS NOT NULL AND completed_at IS NOT NULL)
          )
        );

        CREATE INDEX idx_assistant_shortcut_credentials_status
          ON assistant_shortcut_credentials(status, subscription_id);
        CREATE INDEX idx_voice_shortcut_receipts_status
          ON voice_shortcut_receipts(status, updated_at);
      `);
    },
  },
  {
    version: 12,
    name: 'attachment_upload_foundation',
    up(db) {
      db.exec(`
        CREATE TABLE attachment_blobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
          stored_name TEXT NOT NULL UNIQUE CHECK (length(stored_name) BETWEEN 1 AND 180),
          stored_path TEXT NOT NULL UNIQUE CHECK (length(stored_path) BETWEEN 1 AND 1000),
          mime_type TEXT NOT NULL CHECK (length(mime_type) BETWEEN 1 AND 120),
          size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
          storage_scope TEXT NOT NULL DEFAULT 'temporary'
            CHECK (storage_scope IN ('temporary', 'library')),
          status TEXT NOT NULL DEFAULT 'ready'
            CHECK (status IN ('writing', 'ready', 'failed', 'deleted')),
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE attachments (
          id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 20 AND 80),
          blob_id INTEGER NOT NULL REFERENCES attachment_blobs(id),
          original_name TEXT NOT NULL CHECK (length(original_name) BETWEEN 1 AND 255),
          kind TEXT NOT NULL CHECK (kind IN ('image', 'pdf', 'text', 'markdown')),
          session_id TEXT,
          scope TEXT NOT NULL DEFAULT 'temporary'
            CHECK (scope IN ('temporary', 'library')),
          lifecycle_status TEXT NOT NULL DEFAULT 'uploaded_unattached'
            CHECK (lifecycle_status IN (
              'uploading', 'uploaded_unattached', 'attached_temporary',
              'promoting', 'library', 'expired', 'failed', 'deleted'
            )),
          attached_at INTEGER,
          promoted_at INTEGER,
          expired_at INTEGER,
          deleted_at INTEGER,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE INDEX idx_attachment_blobs_hash
          ON attachment_blobs(sha256, storage_scope, status);
        CREATE INDEX idx_attachments_lifecycle
          ON attachments(lifecycle_status, created_at);
        CREATE INDEX idx_attachments_blob
          ON attachments(blob_id, lifecycle_status);
      `);
    },
  },
  {
    version: 13,
    name: 'attachment_message_lifecycle',
    up(db) {
      db.exec(`
        CREATE TABLE message_attachments (
          message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
          attachment_id TEXT NOT NULL REFERENCES attachments(id),
          position INTEGER NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 15),
          origin_user_turn_index INTEGER NOT NULL CHECK (origin_user_turn_index > 0),
          replay_window_turns INTEGER NOT NULL CHECK (replay_window_turns BETWEEN 1 AND 1000),
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          PRIMARY KEY (message_id, attachment_id),
          UNIQUE (message_id, position)
        );

        CREATE INDEX idx_message_attachments_attachment
          ON message_attachments(attachment_id, origin_user_turn_index);
      `);
    },
  },
  {
    version: 14,
    name: 'attachment_document_index',
    up(db) {
      db.exec(`
        CREATE TABLE attachment_documents (
          attachment_id TEXT PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
          content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
          parser_version TEXT NOT NULL CHECK (length(parser_version) BETWEEN 1 AND 120),
          parse_status TEXT NOT NULL DEFAULT 'parsing'
            CHECK (parse_status IN ('parsing', 'ready', 'failed', 'needs_ocr')),
          page_count INTEGER CHECK (page_count IS NULL OR page_count > 0),
          line_count INTEGER CHECK (line_count IS NULL OR line_count > 0),
          char_count INTEGER CHECK (char_count IS NULL OR char_count > 0),
          chunk_count INTEGER NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
          error_code TEXT CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 80),
          error_message TEXT CHECK (error_message IS NULL OR length(error_message) <= 1000),
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          parsed_at INTEGER,
          CHECK (
            (parse_status = 'ready' AND char_count IS NOT NULL AND chunk_count > 0
              AND error_code IS NULL AND error_message IS NULL AND parsed_at IS NOT NULL) OR
            (parse_status = 'parsing' AND error_code IS NULL AND error_message IS NULL
              AND parsed_at IS NULL) OR
            (parse_status IN ('failed', 'needs_ocr') AND error_code IS NOT NULL
              AND parsed_at IS NULL)
          )
        );

        CREATE TABLE attachment_chunks (
          chunk_id TEXT PRIMARY KEY CHECK (length(chunk_id) BETWEEN 20 AND 80),
          attachment_id TEXT NOT NULL REFERENCES attachment_documents(attachment_id) ON DELETE CASCADE,
          chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
          heading TEXT CHECK (heading IS NULL OR length(heading) <= 240),
          page_start INTEGER CHECK (page_start IS NULL OR page_start > 0),
          page_end INTEGER CHECK (page_end IS NULL OR page_end >= page_start),
          line_start INTEGER CHECK (line_start IS NULL OR line_start > 0),
          line_end INTEGER CHECK (line_end IS NULL OR line_end >= line_start),
          content TEXT NOT NULL CHECK (length(content) > 0),
          content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
          embedding TEXT,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          UNIQUE (attachment_id, chunk_index),
          CHECK ((page_start IS NULL) = (page_end IS NULL)),
          CHECK ((line_start IS NULL) = (line_end IS NULL))
        );

        CREATE INDEX idx_attachment_documents_status
          ON attachment_documents(parse_status, updated_at);
        CREATE INDEX idx_attachment_chunks_attachment
          ON attachment_chunks(attachment_id, chunk_index);
      `);
    },
  },
  {
    version: 15,
    name: 'attachment_library_links',
    up(db) {
      db.exec(`
        CREATE TABLE attachment_library_items (
          attachment_id TEXT PRIMARY KEY REFERENCES attachments(id),
          note_filename TEXT NOT NULL UNIQUE REFERENCES notes(filename),
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE INDEX idx_attachment_library_note
          ON attachment_library_items(note_filename);
      `);
    },
  },
  {
    version: 16,
    name: 'assistant_reminder_origin',
    up(db) {
      // 기한이 있는데 알림을 안 걸면 기한이 지나도 조용히 `overdue`로 넘어가기만 했다.
      // 이제 기본 알림을 대신 잡아주므로, 사용자가 정한 알림과 구분할 열이 필요하다.
      // 구분이 없으면 UI가 사용자가 걸지도 않은 알림을 "설정됨"으로 보여준다.
      db.exec(`
        ALTER TABLE assistant_reminders
          ADD COLUMN origin TEXT NOT NULL DEFAULT 'user'
          CHECK (origin IN ('user', 'auto'));
      `);

      // 이미 들어있는 일정에도 소급 적용한다. 기한이 아직 안 지났고 살아있는 알림이
      // 없는 활성 일정에만 붙인다. 이미 지난 시각으로는 만들지 않는다 —
      // 마이그레이션 직후에 지난 알림이 한꺼번에 터지는 것이 가장 나쁜 결과다.
      const now = Math.floor(Date.now() / 1000);
      const pending = db.prepare(`
        SELECT id, due_kind AS dueKind, due_date AS dueDate, due_at AS dueAt,
               reminder_version AS reminderVersion
        FROM assistant_tasks
        WHERE status = 'active' AND lifecycle = 'active' AND due_kind != 'none'
          AND NOT EXISTS (
            SELECT 1 FROM assistant_reminders r
            WHERE r.task_id = assistant_tasks.id AND r.status IN ('pending', 'fired')
          )
      `).all();
      const insert = db.prepare(`
        INSERT INTO assistant_reminders (
          task_id, remind_at, origin, occurrence_key, created_at, updated_at
        ) VALUES (@taskId, @remindAt, 'auto', @occurrenceKey, @now, @now)
      `);
      for (const task of pending) {
        let remindAt;
        if (task.dueKind === 'datetime') {
          remindAt = task.dueAt - 10 * 60;
        } else {
          const [year, month, day] = task.dueDate.split('-').map(Number);
          remindAt = Math.floor(Date.UTC(year, month - 1, day, 9 - 9, 0, 0) / 1000);
        }
        if (remindAt <= now) continue;
        insert.run({
          taskId: task.id,
          remindAt,
          occurrenceKey: `task:${task.id}:v${task.reminderVersion}:${remindAt}`,
          now,
        });
      }
    },
  },
  {
    version: 17,
    name: 'assistant_task_series',
    up(db) {
      // 반복 master는 새 표에 두고, 회차는 series_id를 가진 평범한 assistant_tasks
      // 행으로 만든다. 회차마다 task 행이 하나라 알림의 one_live_per_task UNIQUE가
      // 그대로 성립해서 assistant_reminders는 한 열도 바뀌지 않는다.
      db.exec(`
        CREATE TABLE assistant_task_series (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_request_id TEXT NOT NULL UNIQUE,
          create_payload_sha256 TEXT NOT NULL
            CHECK (length(create_payload_sha256) = 64),
          title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
          detail TEXT NOT NULL DEFAULT '' CHECK (length(detail) <= 2000),
          freq TEXT NOT NULL
            CHECK (freq IN ('daily', 'weekdays', 'weekly', 'monthly')),
          by_weekday TEXT,
          by_monthday INTEGER,
          start_date TEXT NOT NULL CHECK (start_date GLOB '????-??-??'),
          end_date TEXT CHECK (end_date IS NULL OR end_date GLOB '????-??-??'),
          time_kind TEXT NOT NULL CHECK (time_kind IN ('date', 'datetime')),
          time_of_day TEXT,
          reminder_lead_seconds INTEGER
            CHECK (reminder_lead_seconds IS NULL OR reminder_lead_seconds >= 0),
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'ended')),
          timezone TEXT NOT NULL DEFAULT 'Asia/Seoul'
            CHECK (timezone = 'Asia/Seoul'),
          version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
          materialized_through TEXT,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          ended_at INTEGER,
          -- SQLite는 CHECK 식이 NULL이면 통과시킨다. 그래서 규칙이 요구하는 열은
          -- 범위만 적지 말고 IS NOT NULL을 함께 적어야 빈 값이 새어들지 않는다.
          CHECK (
            (freq = 'weekly' AND by_weekday IS NOT NULL AND by_monthday IS NULL) OR
            (freq = 'monthly' AND by_weekday IS NULL AND by_monthday IS NOT NULL
              AND by_monthday BETWEEN 1 AND 31) OR
            (freq IN ('daily', 'weekdays')
              AND by_weekday IS NULL AND by_monthday IS NULL)
          ),
          CHECK (
            (time_kind = 'date' AND time_of_day IS NULL) OR
            (time_kind = 'datetime' AND time_of_day IS NOT NULL
              AND time_of_day GLOB '??:??:??')
          ),
          CHECK (end_date IS NULL OR end_date >= start_date),
          CHECK (
            (status = 'active' AND ended_at IS NULL) OR
            (status = 'ended' AND ended_at IS NOT NULL)
          )
        );

        CREATE INDEX idx_assistant_task_series_active
          ON assistant_task_series(status, materialized_through);
      `);

      // 기존 표는 재생성하지 않고 열만 붙인다. SQLite는 추가 열에 REFERENCES를
      // 허용하지만 기본값이 NULL이어야 하므로 series_id는 nullable이다.
      // 단발 일정은 세 열이 모두 지금 값 그대로 남는다.
      db.exec(`
        ALTER TABLE assistant_tasks
          ADD COLUMN series_id INTEGER REFERENCES assistant_task_series(id);
        ALTER TABLE assistant_tasks
          ADD COLUMN occurrence_date TEXT;
        ALTER TABLE assistant_tasks
          ADD COLUMN overridden INTEGER NOT NULL DEFAULT 0
          CHECK (overridden IN (0, 1));

        CREATE UNIQUE INDEX idx_assistant_tasks_series_occurrence
          ON assistant_tasks(series_id, occurrence_date)
          WHERE series_id IS NOT NULL;
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
