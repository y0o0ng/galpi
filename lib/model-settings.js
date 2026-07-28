'use strict';

const ALLOWED_SETTING_KEYS = new Set([
  'chat.model_selection',
  'codex.general_model',
  'codex.deep_model',
]);

function assertSettingKey(key) {
  if (!ALLOWED_SETTING_KEYS.has(key)) {
    const error = new Error(`허용되지 않은 설정 key입니다: ${key}`);
    error.code = 'INVALID_SETTING_KEY';
    throw error;
  }
}

function parseStoredValue(raw, key) {
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error(`설정 JSON이 손상되었습니다: ${key}`);
    error.code = 'CORRUPT_SETTING_VALUE';
    throw error;
  }
}

function createModelSettingsStore(db, { now = () => Math.floor(Date.now() / 1000) } = {}) {
  if (!db?.prepare || typeof db.transaction !== 'function') {
    throw new TypeError('SQLite DB 연결이 필요합니다.');
  }

  const selectOne = db.prepare(`
    SELECT key, value_json AS valueJson, version, updated_at AS updatedAt
    FROM app_settings
    WHERE key = ?
  `);
  const insertDefault = db.prepare(`
    INSERT OR IGNORE INTO app_settings (key, value_json, version, updated_at)
    VALUES (?, ?, 1, ?)
  `);
  const updateOne = db.prepare(`
    UPDATE app_settings
    SET value_json = ?, version = version + 1, updated_at = ?
    WHERE key = ? AND version = ?
  `);

  function get(key) {
    assertSettingKey(key);
    const row = selectOne.get(key);
    if (!row) return null;
    return {
      key: row.key,
      value: parseStoredValue(row.valueJson, key),
      version: row.version,
      updatedAt: row.updatedAt,
    };
  }

  function ensureDefaults(defaults) {
    const entries = Object.entries(defaults || {});
    const applied = [];
    db.transaction(() => {
      for (const [key, value] of entries) {
        assertSettingKey(key);
        const result = insertDefault.run(key, JSON.stringify(value), now());
        if (result.changes > 0) applied.push(key);
      }
    })();
    return applied;
  }

  function update(key, value, expectedVersion) {
    assertSettingKey(key);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      const error = new Error('설정 version이 필요합니다.');
      error.code = 'INVALID_SETTING_VERSION';
      throw error;
    }
    const result = updateOne.run(JSON.stringify(value), now(), key, expectedVersion);
    if (result.changes === 0) {
      const current = get(key);
      const error = new Error(current ? '설정이 다른 요청에서 먼저 변경되었습니다.' : '설정을 찾을 수 없습니다.');
      error.code = current ? 'SETTING_VERSION_CONFLICT' : 'SETTING_NOT_FOUND';
      error.current = current;
      throw error;
    }
    return get(key);
  }

  function updateMany(changes) {
    if (!Array.isArray(changes) || changes.length === 0) {
      throw new TypeError('변경할 설정이 필요합니다.');
    }
    const keys = new Set();
    for (const change of changes) {
      assertSettingKey(change?.key);
      if (keys.has(change.key)) throw new Error(`중복 설정 key입니다: ${change.key}`);
      keys.add(change.key);
    }

    return db.transaction(() => changes.map(change => (
      update(change.key, change.value, change.expectedVersion)
    )))();
  }

  return {
    get,
    ensureDefaults,
    update,
    updateMany,
  };
}

module.exports = {
  ALLOWED_SETTING_KEYS,
  createModelSettingsStore,
};
