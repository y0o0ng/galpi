'use strict';

const ALLOWED_CATALOG_SURFACES = new Set([
  'openai_api',
  'codex_subscription',
]);

function assertSurface(surface) {
  if (!ALLOWED_CATALOG_SURFACES.has(surface)) {
    throw new Error(`허용되지 않은 model catalog surface입니다: ${surface}`);
  }
}

function parsePayload(raw, surface) {
  if (raw === null || raw === undefined || raw === '') return null;
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error(`모델 카탈로그 JSON이 손상되었습니다: ${surface}`);
    error.code = 'CORRUPT_MODEL_CATALOG';
    throw error;
  }
}

function normalizeErrorCode(error) {
  const raw = String(error?.code || error?.name || 'MODEL_CATALOG_REFRESH_FAILED')
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .slice(0, 80);
  return raw || 'MODEL_CATALOG_REFRESH_FAILED';
}

function createModelCatalogStore(db, { now = () => Math.floor(Date.now() / 1000) } = {}) {
  if (!db?.prepare || typeof db.transaction !== 'function') {
    throw new TypeError('SQLite DB 연결이 필요합니다.');
  }

  const selectOne = db.prepare(`
    SELECT surface, generation, payload_json AS payloadJson,
           payload_version AS payloadVersion, last_attempt_at AS lastAttemptAt,
           last_success_at AS lastSuccessAt, last_error_code AS lastErrorCode,
           last_error_at AS lastErrorAt
    FROM model_catalog_cache
    WHERE surface = ?
  `);
  const recordAttemptStmt = db.prepare(`
    INSERT INTO model_catalog_cache (
      surface, generation, payload_version, last_attempt_at
    ) VALUES (?, 0, 1, ?)
    ON CONFLICT(surface) DO UPDATE SET
      last_attempt_at = excluded.last_attempt_at
  `);
  const saveSuccessStmt = db.prepare(`
    INSERT INTO model_catalog_cache (
      surface, generation, payload_json, payload_version,
      last_attempt_at, last_success_at, last_error_code, last_error_at
    ) VALUES (?, 1, ?, ?, ?, ?, NULL, NULL)
    ON CONFLICT(surface) DO UPDATE SET
      generation = model_catalog_cache.generation + 1,
      payload_json = excluded.payload_json,
      payload_version = excluded.payload_version,
      last_attempt_at = excluded.last_attempt_at,
      last_success_at = excluded.last_success_at,
      last_error_code = NULL,
      last_error_at = NULL
  `);
  const saveFailureStmt = db.prepare(`
    INSERT INTO model_catalog_cache (
      surface, generation, payload_version,
      last_attempt_at, last_error_code, last_error_at
    ) VALUES (?, 0, 1, ?, ?, ?)
    ON CONFLICT(surface) DO UPDATE SET
      last_attempt_at = excluded.last_attempt_at,
      last_error_code = excluded.last_error_code,
      last_error_at = excluded.last_error_at
  `);

  function get(surface) {
    assertSurface(surface);
    const row = selectOne.get(surface);
    if (!row) return null;
    return {
      surface: row.surface,
      generation: row.generation,
      payload: parsePayload(row.payloadJson, surface),
      payloadVersion: row.payloadVersion,
      lastAttemptAt: row.lastAttemptAt,
      lastSuccessAt: row.lastSuccessAt,
      lastErrorCode: row.lastErrorCode,
      lastErrorAt: row.lastErrorAt,
    };
  }

  function recordAttempt(surface) {
    assertSurface(surface);
    recordAttemptStmt.run(surface, now());
    return get(surface);
  }

  function saveSuccess(surface, payload, { payloadVersion = 1 } = {}) {
    assertSurface(surface);
    const timestamp = now();
    saveSuccessStmt.run(
      surface,
      JSON.stringify(payload),
      payloadVersion,
      timestamp,
      timestamp,
    );
    return get(surface);
  }

  function saveFailure(surface, error) {
    assertSurface(surface);
    const timestamp = now();
    saveFailureStmt.run(surface, timestamp, normalizeErrorCode(error), timestamp);
    return get(surface);
  }

  return {
    get,
    recordAttempt,
    saveSuccess,
    saveFailure,
  };
}

module.exports = {
  ALLOWED_CATALOG_SURFACES,
  createModelCatalogStore,
  normalizeErrorCode,
};
