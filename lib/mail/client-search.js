'use strict';

const { clientError } = require('./client-message');
const { contactAddress } = require('./client-contacts');

const DAY = 86400;
function searchOptions(query, now) {
  const allowed = new Set(['q', 'sender', 'contactEmail', 'read', 'starred', 'attachments', 'period', 'from', 'until', 'accountId', 'inbox', 'mailbox', 'cursor', 'limit']);
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
  const contactEmail = query.contactEmail?.trim().toLowerCase() ?? '';
  if (query.contactEmail !== undefined && (contactEmail.length > 254 || !contactAddress.test(contactEmail))) throw invalid();
  return {
    q: text('q'), sender: text('sender'), contactEmail, read: query.read || '',
    starred: query.starred ? 1 : 0, attachments: query.attachments ? 1 : 0,
    inbox: query.inbox ? 1 : 0, mailbox: query.mailbox || '',
    from, until: end === null ? null : end + DAY,
  };
}

function matchesSearch(metadata, params) {
  const has = (value, query) => (value || '').toLowerCase().includes(query);
  const person = (entries, query) => (entries || []).some(entry => has(entry.address, query) || has(entry.name, query));
  return (!params.q || has(metadata.subject, params.q) || person(metadata.from, params.q) || person(metadata.to, params.q))
    && (!params.sender || person(metadata.from, params.sender))
    && (!params.contactEmail || [...metadata.from, ...metadata.to].some(entry => entry.address?.toLowerCase() === params.contactEmail))
    && (!params.read || metadata.read === (params.read === 'read'))
    && (!params.starred || metadata.starred === true)
    && (!params.attachments || metadata.hasAttachments === true)
    && (params.from === null || metadata.receivedAt >= params.from)
    && (params.until === null || metadata.receivedAt < params.until);
}

module.exports = { searchOptions, matchesSearch };
