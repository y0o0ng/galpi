'use strict';

const { clientError } = require('./client-message');

const sourceValues = new Set(['', 'csv', 'gmail', 'naver', 'works', 'observed']);
const address = /^[^\s@<>(),;:\\"\[\]\u0000-\u001f]+@[^\s@<>(),;:\\"\[\]\u0000-\u001f]+\.[^\s@<>(),;:\\"\[\]\u0000-\u001f]+$/u;
const invalid = () => clientError('MAIL_CLIENT_CONTACTS_INVALID', 400);

function createMailClientContacts(db) {
  const contacts = `
    WITH addresses AS (
      SELECT json_extract(person.value, '$.name') AS name,
        json_extract(person.value, '$.address') AS email, m.fetched_at, m.id
      FROM mail_client_messages AS m
      JOIN mail_accounts AS a ON a.id = m.account_id AND a.status <> 'disabled'
      JOIN json_each(m.metadata_json, '$.from') AS person
      WHERE @collect = 1
      UNION ALL
      SELECT json_extract(person.value, '$.name'), json_extract(person.value, '$.address'), m.fetched_at, m.id
      FROM mail_client_messages AS m
      JOIN mail_accounts AS a ON a.id = m.account_id AND a.status <> 'disabled'
      JOIN json_each(m.metadata_json, '$.to') AS person
      WHERE @collect = 1
    ), ranked AS (
      SELECT coalesce(name, '') AS name, email, lower(email) AS email_key,
        row_number() OVER(PARTITION BY lower(email) ORDER BY fetched_at DESC, id DESC) AS rank
      FROM addresses
      WHERE email LIKE '%@%.%' AND length(email) <= 254
        AND lower(email) NOT IN (SELECT lower(address) FROM mail_accounts)
    ), directory AS (
      SELECT id, name, email, organization, source FROM mail_client_contacts
      UNION ALL
      SELECT email_key AS id, name, email, '' AS organization, 'observed' AS source FROM ranked
      WHERE rank = 1 AND NOT EXISTS (SELECT 1 FROM mail_client_contacts WHERE mail_client_contacts.email_key = ranked.email_key)
    )
    SELECT id, name, email, organization, source, COUNT(*) OVER() AS total FROM directory
    WHERE (@source = '' OR source = @source) AND (
      @q = '' OR instr(lower(name), @q) > 0
      OR instr(lower(email), @q) > 0 OR instr(lower(organization), @q) > 0
    )
    ORDER BY CASE WHEN name = '' THEN email ELSE name END COLLATE NOCASE, email COLLATE NOCASE, id
    LIMIT @limit
  `;
  const list = db.prepare(contacts);
  const collectionKey = 'mail_client.contacts.observed_enabled';
  const collection = db.prepare('SELECT value_json = ? AS enabled FROM app_settings WHERE key = ?');
  const setCollection = db.prepare(`
    INSERT INTO app_settings (key, value_json) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, version = version + 1, updated_at = unixepoch()
  `);
  const isCollectionEnabled = () => Boolean(collection.get('true', collectionKey)?.enabled);
  const existing = db.prepare('SELECT 1 FROM mail_client_contacts WHERE email_key = ?');
  const insert = db.prepare(`
    INSERT INTO mail_client_contacts (name, email, email_key, organization, source)
    VALUES (?, ?, ?, ?, 'csv') ON CONFLICT(email_key) DO NOTHING
  `);
  const process = db.transaction((entries, preview) => {
    const seen = new Set();
    const summary = { created: 0, skipped: 0, invalid: 0 };
    function field(value, limit) {
      return value == null ? '' : typeof value === 'string' && value.length <= limit
        && !/[\u0000-\u001f\u007f]/u.test(value) ? value.trim() : null;
    }
    for (const entry of entries) {
      if (!entry || Array.isArray(entry) || typeof entry !== 'object'
        || Object.keys(entry).some(key => !['name', 'email', 'organization'].includes(key))) throw invalid();
      const email = field(entry.email, 254);
      const name = field(entry.name, 200);
      const org = field(entry.organization, 300);
      if (!email || !address.test(email) || name === null || org === null) {
        summary.invalid++;
        continue;
      }
      const key = email.toLowerCase();
      if (seen.has(key) || existing.get(key)) { summary.skipped++; continue; }
      seen.add(key);
      if (preview || insert.run(name, email, key, org).changes === 1) summary.created++;
      else summary.skipped++;
    }
    return summary;
  });
  return {
    list(query) {
      if (Object.keys(query).some(key => !['q', 'source', 'limit'].includes(key))) throw invalid();
      const { q = '', source = '', limit: raw = '100' } = query;
      if (typeof q !== 'string' || q.length > 160 || !sourceValues.has(source)
        || typeof raw !== 'string' || !/^\d{1,3}$/u.test(raw)) throw invalid();
      const limit = Number(raw);
      if (limit < 1 || limit > 200) throw invalid();
      const collectionEnabled = isCollectionEnabled();
      const rows = list.all({ q: q.trim().toLowerCase(), source, limit, collect: collectionEnabled ? 1 : 0 });
      return { contacts: rows.map(({ total, ...entry }) => entry), total: rows[0]?.total ?? 0, collectionEnabled };
    },
    setCollection(body) {
      if (!body || Object.keys(body).length !== 1 || typeof body.enabled !== 'boolean') throw invalid();
      setCollection.run(collectionKey, String(body.enabled));
      return { collectionEnabled: body.enabled };
    },
    import(body) {
      if (!body || Object.keys(body).some(key => !['entries', 'preview'].includes(key))
        || !Array.isArray(body.entries) || !body.entries.length || body.entries.length > 1000
        || (body.preview !== undefined && typeof body.preview !== 'boolean')) throw invalid();
      return body.preview ? process(body.entries, true) : process.immediate(body.entries, false);
    },
  };
}

module.exports = { createMailClientContacts };
