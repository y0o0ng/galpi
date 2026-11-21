'use strict';

const { clientError } = require('./client-message');

const DAY = 86400;
function searchOptions(query, now) {
  const allowed = new Set(['q', 'sender', 'read', 'starred', 'attachments', 'period', 'from', 'until', 'accountId', 'inbox', 'mailbox', 'cursor', 'limit']);
  if (Object.entries(query).some(([key, value]) => !allowed.has(key) || typeof value !== 'string')) throw invalid();
  function invalid() { return clientError('MAIL_CLIENT_SEARCH_INVALID', 400); }
  function text(key) {
    const value = (query[key] || '').trim().toLowerCase();
    if (value.length > 160 || /[\u0000-\u001f]/u.test(value)) throw invalid();
    return value;
  }
  function date(value) {
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid();
    const unixDate = new Date(value + 'T00:00:00.000Z');
    if (!Number.isFinite(unixDate.valueOf()) || unixDate.toISOString().slice(0, 10) !== value) throw invalid();
    return unixDate.valueOf() / 1000 - 9 * 3600;
  }
  if (query.read && !['read', 'unread'].includes(query.read)) throw invalid();
  for (const key of ['starred', 'attachments', 'inbox']) {
    if (query[key] && !['true', '1'].includes(query[key])) throw invalid();
  }
  if (query.period && !['week', 'month', 'custom'].includes(query.period)) throw invalid();
  if (query.mailbox && (!query.accountId || query.mailbox.length > 1024 || query.inbox)) throw invalid();
  let from = date(query.from);
  const end = date(query.until);
  if (from != null && end != null && from > end) throw invalid();
  if (query.period === 'week') from = now - 7 * DAY;
  if (query.period === 'month') from = now - 30 * DAY;
  return {
    q: text('q'), sender: text('sender'), read: query.read || '',
    starred: query.starred ? 1 : 0, attachments: query.attachments ? 1 : 0,
    inbox: query.inbox ? 1 : 0, mailbox: query.mailbox || '',
    from, until: end === null ? null : end + DAY,
  };
}

function createSearch(db) {
  const page = db.prepare(`
    WITH matched AS (
      SELECT m.id, m.account_id AS accountId, m.locator_json AS locator, m.metadata_json AS metadata,
        m.fetched_at AS fetchedAt, a.provider,
        CAST(json_extract(m.metadata_json, '$.receivedAt') AS INTEGER) AS received
      FROM mail_client_messages AS m
      JOIN mail_accounts AS a ON a.id = m.account_id AND a.status <> 'disabled'
      WHERE (@accountId IS NULL OR m.account_id = @accountId)
        AND NOT EXISTS (
          SELECT 1 FROM mail_client_messages AS newer
          WHERE newer.account_id = m.account_id AND newer.location_key = m.location_key
            AND (newer.fetched_at > m.fetched_at OR (newer.fetched_at = m.fetched_at AND newer.id > m.id))
        )
        AND (@inbox = 0 OR json_extract(m.locator_json, '$.inbox') = 1
          OR (a.provider = 'gmail' AND EXISTS (
            SELECT 1 FROM json_each(m.metadata_json, '$.labelIds') WHERE value = 'INBOX'
          )))
        AND (@mailbox = '' OR (a.provider = 'gmail' AND (
          (@mailbox = 'all' AND NOT EXISTS (
            SELECT 1 FROM json_each(m.metadata_json, '$.labelIds') WHERE value IN ('TRASH', 'SPAM')
          )) OR EXISTS (
            SELECT 1 FROM json_each(m.metadata_json, '$.labelIds') WHERE 'label:' || value = @mailbox
          )
        )) OR (a.provider <> 'gmail' AND 'folder:' || json_extract(m.locator_json, '$.path') = @mailbox))
        AND (@q = '' OR instr(lower(coalesce(json_extract(m.metadata_json, '$.subject'), '')), @q) > 0
          OR EXISTS (
            SELECT 1 FROM json_each(m.metadata_json, '$.from')
              WHERE instr(lower(coalesce(json_extract(value, '$.address'), '')), @q) > 0
                OR instr(lower(coalesce(json_extract(value, '$.name'), '')), @q) > 0
          ) OR EXISTS (
            SELECT 1 FROM json_each(m.metadata_json, '$.to')
              WHERE instr(lower(coalesce(json_extract(value, '$.address'), '')), @q) > 0
                OR instr(lower(coalesce(json_extract(value, '$.name'), '')), @q) > 0
          ))
        AND (@sender = '' OR EXISTS (
          SELECT 1 FROM json_each(m.metadata_json, '$.from')
            WHERE instr(lower(coalesce(json_extract(value, '$.address'), '')), @sender) > 0
              OR instr(lower(coalesce(json_extract(value, '$.name'), '')), @sender) > 0
        ))
        AND (@read = '' OR json_extract(m.metadata_json, '$.read') = (@read = 'read'))
        AND (@starred = 0 OR coalesce(json_extract(m.metadata_json, '$.starred'), CASE WHEN a.provider = 'gmail'
          THEN EXISTS(SELECT 1 FROM json_each(m.metadata_json, '$.labelIds') WHERE value = 'STARRED')
          ELSE json_extract(m.metadata_json, '$.important') END) = 1)
        AND (@attachments = 0 OR json_extract(m.metadata_json, '$.hasAttachments') = 1)
        AND (@from IS NULL OR received >= @from)
        AND (@until IS NULL OR received < @until)
    ), counted AS (SELECT *, COUNT(*) OVER () AS total FROM matched)
    SELECT * FROM counted
    WHERE @after IS NULL OR received < @after OR (received = @after AND id < @lastId)
    ORDER BY received DESC, id DESC
    LIMIT @limit
  `);
  return (options, count, key) => page.all({
    ...options, limit: count, after: key?.received ?? null, lastId: key?.id ?? null,
  }).map(row => ({ ...row, locator: JSON.parse(row.locator), metadata: JSON.parse(row.metadata) }));
}

module.exports = { createSearch, searchOptions };
