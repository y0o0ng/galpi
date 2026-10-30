'use strict';

// Explicit development migration only; never imported from application startup.
function applyModuleMigrations(db) {
  if (!db?.prepare || !db?.transaction || db.inTransaction) throw Error('INVALID_DEVELOPMENT_DB');
  const foreignKeys = db.pragma('foreign_keys', { simple: true });
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS memory_storage_migrations (
        version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      )`);
      const versions = db.prepare('SELECT version FROM memory_storage_migrations ORDER BY version').all().map(row => row.version);
      if (![[], [1], [1, 2]].some(expected => JSON.stringify(expected) === JSON.stringify(versions))) throw Error('UNKNOWN_MODULE_MIGRATION');
      if (!versions.includes(1)) db.exec(`
        CREATE TABLE memory_general_fact_transitions_new (
          transition_id TEXT NOT NULL PRIMARY KEY,
          subject TEXT NOT NULL CHECK (subject = 'USER'),
          attribute_key TEXT NOT NULL CHECK (attribute_key != ''),
          revision INTEGER NOT NULL CHECK (revision >= 1),
          candidate_id TEXT NOT NULL UNIQUE REFERENCES memory_general_fact_candidates(candidate_id),
          previous_state_id TEXT REFERENCES memory_general_fact_states(state_id),
          next_state_id TEXT REFERENCES memory_general_fact_states(state_id),
          transition TEXT NOT NULL CHECK (transition IN ('CREATE','EXPAND','SUPERSEDE','REVISE','INVALIDATE','NO_CHANGE')),
          change_class TEXT CHECK (change_class IN ('EXPANSION','WORLD_UPDATE','CORRECTION','ADDITIONAL_CONTEXT',
            'CONTRADICTION','TEMPORAL_SCOPE_CHANGE','INTERPRETATION_REVISION','AMBIGUOUS','UNRESOLVED')),
          replay_sha256 TEXT NOT NULL CHECK (length(replay_sha256) = 64),
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          UNIQUE(subject, attribute_key, revision),
          CHECK ((transition IN ('CREATE','EXPAND') AND previous_state_id IS NULL AND next_state_id IS NOT NULL)
            OR (transition IN ('SUPERSEDE','REVISE') AND previous_state_id IS NOT NULL AND next_state_id IS NOT NULL AND next_state_id != previous_state_id)
            OR (transition = 'INVALIDATE' AND previous_state_id IS NOT NULL AND next_state_id IS NULL)
            OR (transition = 'NO_CHANGE' AND previous_state_id IS NOT NULL AND next_state_id = previous_state_id)),
          CHECK ((transition = 'CREATE' AND change_class IS NULL)
            OR (transition = 'EXPAND' AND change_class = 'EXPANSION')
            OR (transition = 'SUPERSEDE' AND change_class = 'WORLD_UPDATE')
            OR (transition IN ('REVISE','INVALIDATE') AND change_class = 'CORRECTION')
            OR (transition = 'NO_CHANGE' AND change_class IS NOT NULL))
        );
        INSERT INTO memory_general_fact_transitions_new SELECT * FROM memory_general_fact_transitions;
        DROP TABLE memory_general_fact_transitions;
        ALTER TABLE memory_general_fact_transitions_new RENAME TO memory_general_fact_transitions;
        ALTER TABLE memory_general_fact_reviews ADD COLUMN rejection_tag TEXT
          CHECK (rejection_tag IS NULL OR rejection_tag IN ('WRONG_TARGET','WRONG_CONTENT','OTHER'));

        CREATE TABLE memory_formation_step2b_episodes (
          episode_number INTEGER PRIMARY KEY CHECK(episode_number BETWEEN 1 AND 15),
          episode_sha256 TEXT NOT NULL CHECK(length(episode_sha256)=64),
          report_sha256 TEXT CHECK(report_sha256 IS NULL OR length(report_sha256)=64)
        );
        CREATE TABLE memory_formation_step2b_candidates (
          episode_number INTEGER NOT NULL REFERENCES memory_formation_step2b_episodes(episode_number),
          result_index INTEGER NOT NULL CHECK(result_index >= 0),
          candidate_sha256 TEXT NOT NULL CHECK(length(candidate_sha256)=64),
          status TEXT NOT NULL DEFAULT 'WAITING' CHECK(status IN ('WAITING','ATTEMPTED','REVIEW_PREPARED','KEEP_AMBIGUOUS','ALREADY_COMMITTED','PROCESSING_ERROR')),
          candidate_id TEXT, review_id TEXT UNIQUE, package_sha256 TEXT, reason TEXT,
          advance_triggered INTEGER NOT NULL DEFAULT 0 CHECK(advance_triggered IN (0,1)),
          PRIMARY KEY(episode_number,result_index), UNIQUE(episode_number,candidate_sha256)
        );
        CREATE TABLE memory_project_candidates (
          candidate_id TEXT PRIMARY KEY, candidate_json TEXT NOT NULL CHECK(json_valid(candidate_json)),
          evidence_ids_json TEXT NOT NULL CHECK(json_valid(evidence_ids_json)),
          status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','COMMITTED')),
          pending_reason TEXT, proposal_json TEXT, validation_json TEXT,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
        CREATE TABLE memory_projects (project_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')));
        CREATE TABLE memory_project_states (
          state_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES memory_projects(project_id),
          candidate_id TEXT NOT NULL UNIQUE REFERENCES memory_project_candidates(candidate_id),
          kind TEXT NOT NULL CHECK(kind IN ('STATUS','CLAIM')), value TEXT NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
        CREATE TABLE memory_project_transitions (
          sequence INTEGER PRIMARY KEY, transition_id TEXT NOT NULL UNIQUE,
          project_id TEXT NOT NULL REFERENCES memory_projects(project_id),
          candidate_id TEXT NOT NULL UNIQUE REFERENCES memory_project_candidates(candidate_id),
          previous_state_id TEXT REFERENCES memory_project_states(state_id),
          next_state_id TEXT REFERENCES memory_project_states(state_id),
          transition TEXT NOT NULL CHECK(transition IN ('CREATE','EXPAND','SUPERSEDE','REVISE','INVALIDATE','NO_CHANGE')),
          change_class TEXT, replay_sha256 TEXT NOT NULL CHECK(length(replay_sha256)=64),
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
        CREATE TABLE memory_project_transition_evidence (
          transition_id TEXT NOT NULL REFERENCES memory_project_transitions(transition_id),
          evidence_id TEXT NOT NULL REFERENCES memory_evidence_refs(evidence_id),
          PRIMARY KEY(transition_id,evidence_id)
        );
        CREATE TABLE memory_project_reviews (
          review_id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL REFERENCES memory_project_candidates(candidate_id),
          replay_sha256 TEXT NOT NULL, proposal_json TEXT NOT NULL, proposal_sha256 TEXT NOT NULL, package_sha256 TEXT NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')), decision TEXT CHECK(decision IN ('APPROVE','HOLD','REJECT_PROPOSAL')),
          decision_reason TEXT, rejection_tag TEXT CHECK(rejection_tag IS NULL OR rejection_tag IN ('WRONG_TARGET','WRONG_CONTENT','OTHER')),
          decided_at INTEGER, transition_id TEXT REFERENCES memory_project_transitions(transition_id)
        );
        INSERT INTO memory_storage_migrations(version) VALUES (1);
      `);
      if (!versions.includes(2)) db.exec(`
        ALTER TABLE memory_projects ADD COLUMN display_name TEXT;
        ALTER TABLE memory_project_reviews ADD COLUMN approved_display_name TEXT;
        INSERT INTO memory_storage_migrations(version) VALUES (2);
      `);
      if (db.pragma('foreign_key_check').length) throw Error('MIGRATION_FOREIGN_KEY_FAILURE');
    })();
  } finally { db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`); }
}

function main(args) {
  if (args.length !== 1) throw Error('INVALID_ARGUMENTS');
  const { openDevelopmentDb } = require('./review-ui');
  const db = openDevelopmentDb(args[0]);
  try { applyModuleMigrations(db); return { version: 2 }; } finally { db.close(); }
}

if (require.main === module) {
  try { console.log(JSON.stringify(main(process.argv.slice(2)))); }
  catch (error) { console.error(/^[A-Z][A-Z0-9_]{0,79}$/.test(error.message) ? error.message : 'MIGRATION_FAILED'); process.exitCode = 1; }
}

module.exports = { applyModuleMigrations, main };
