'use strict';

function locationKey(locator) {
  return JSON.stringify(locator.messageId ? [locator.messageId] : [locator.path, locator.uid]);
}

function createMailClientCache(db) {
  const putMessage = db.prepare(`
    INSERT INTO mail_client_messages (account_id, location_key, proof_key, locator_json, metadata_json, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (account_id, location_key, proof_key) DO UPDATE SET
      locator_json = CASE WHEN excluded.fetched_at >= fetched_at THEN excluded.locator_json ELSE locator_json END,
      metadata_json = CASE WHEN excluded.fetched_at >= fetched_at THEN excluded.metadata_json ELSE metadata_json END,
      fetched_at = max(excluded.fetched_at, fetched_at)
    RETURNING id
  `);
  const getMessage = db.prepare(`
    SELECT id, account_id AS accountId, locator_json AS locator, proof_key AS proof, metadata_json AS metadata,
           fetched_at AS fetchedAt
    FROM mail_client_messages WHERE id = ?
  `);
  const findMessages = db.prepare(`
    SELECT id FROM mail_client_messages
    WHERE account_id = ? AND location_key = ? AND json_extract(locator_json, '$.metaProof') = ?
    LIMIT 2
  `);
  const findAgentLink = db.prepare('SELECT id FROM mail_client_messages WHERE agent_message_id = ?');
  const bindAgentLink = db.prepare(`
    UPDATE mail_client_messages SET agent_message_id = ?
    WHERE id = ? AND agent_message_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM mail_client_messages WHERE agent_message_id = ?)
  `);
  const getObservation = db.prepare(`
    SELECT observation_json AS observation, fetched_at AS fetchedAt
    FROM mail_client_cache WHERE account_id = ? AND cache_key = ?
  `);
  const putObservation = db.prepare(`
    INSERT INTO mail_client_cache (account_id, cache_key, observation_json, fetched_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (account_id, cache_key) DO UPDATE SET
      observation_json = excluded.observation_json, fetched_at = excluded.fetched_at
    WHERE excluded.fetched_at >= fetched_at
  `);
  const deleteLists = db.prepare(`
    DELETE FROM mail_client_cache
    WHERE account_id = ? AND (cache_key LIKE 'page:%' OR cache_key LIKE 'inbox:%')
  `);
  const pruneObservations = db.prepare(`
    DELETE FROM mail_client_cache WHERE account_id = ? AND cache_key IN (
      SELECT cache_key FROM mail_client_cache WHERE account_id = ?
      ORDER BY fetched_at DESC, rowid DESC LIMIT -1 OFFSET 256
    )
  `);
  const saveObservation = db.transaction((accountId, key, observation, fetchedAt) => {
    putObservation.run(accountId, key, JSON.stringify(observation), fetchedAt);
    pruneObservations.run(accountId, accountId);
  });

  return {
    saveMessages: db.transaction((accountId, rows, fetchedAt) => rows.map(row => putMessage.get(
      accountId, locationKey(row.locator), row.proof, JSON.stringify(row.locator), JSON.stringify(row.metadata), fetchedAt,
    ).id)),
    findPreviouslyVerified(accountId, row) {
      const matches = findMessages.all(accountId, locationKey(row.locator), row.locator.metaProof);
      return matches.length === 1 ? matches[0].id : null;
    },
    bindAgent(agentId, clientId, accountId, row) {
      const linked = findAgentLink.get(agentId);
      if (linked) return linked.id === clientId;
      if (row.locator.path && !row.locator.uidValidity) {
        const candidates = findMessages.all(accountId, locationKey(row.locator), row.locator.metaProof);
        if (candidates.length !== 1 || candidates[0].id !== clientId) return false;
      }
      bindAgentLink.run(agentId, clientId, agentId);
      return findAgentLink.get(agentId)?.id === clientId;
    },
    getMessage(id) {
      const row = getMessage.get(id);
      return row ? { ...row, locator: JSON.parse(row.locator), metadata: JSON.parse(row.metadata) } : null;
    },
    readObservation(accountId, key) {
      const row = getObservation.get(accountId, key);
      return row ? { fetchedAt: row.fetchedAt, value: JSON.parse(row.observation) } : null;
    },
    saveObservation,
    invalidateLists(accountId) { deleteLists.run(accountId); },
  };
}

module.exports = { createMailClientCache, locationKey };
