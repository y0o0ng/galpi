'use strict';

const { clientError, decodeWords, epoch, headerAddresses, headerMessageId } = require('./client-message');

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const HTTP_TIMEOUT_MS = 12_000;
const PART_FIELDS = 'filename,mimeType,headers(name,value)';
const TREE_FIELDS = Array.from({ length: 6 }).reduce(fields => PART_FIELDS + ',parts(' + fields + ')', PART_FIELDS);
const MESSAGE_FIELDS = 'id,threadId,internalDate,labelIds,payload(' + TREE_FIELDS + ')';

function headersOf(part) {
  return new Map(responseArray(part?.headers).map(header => {
    if (typeof header?.name !== 'string') throw clientError('MAIL_CLIENT_PROVIDER_RESPONSE');
    return [header.name.toLowerCase(), header.value];
  }));
}

function attachmentState(part, root = true) {
  if (!part) return null;
  const disposition = headersOf(part).get('content-disposition') || '';
  if (/^attachment\b/i.test(disposition) || (!root && part.filename && !/^inline\b/i.test(disposition))) {
    return true;
  }
  const children = responseArray(part.parts).map(child => attachmentState(child, false));
  if (children.includes(true)) return true;
  return children.includes(null) || (/^multipart\//i.test(part.mimeType || '') && !children.length)
    ? null : false;
}

function responseArray(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw clientError('MAIL_CLIENT_PROVIDER_RESPONSE');
  return value;
}

function labelState(labelIds) {
  const labels = responseArray(labelIds);
  return {
    labelIds: labels,
    read: !labels.includes('UNREAD'),
    starred: labels.includes('STARRED'),
    important: labels.includes('IMPORTANT'),
  };
}

function normalize(message) {
  const internalDate = Number(message.internalDate);
  if (!message.id || message.internalDate == null || !Number.isFinite(internalDate)) {
    throw clientError('MAIL_CLIENT_PROVIDER_RESPONSE');
  }
  const headers = headersOf(message.payload);
  return {
    locator: { messageId: message.id },
    proof: message.id,
    metadata: {
      threadId: message.threadId ?? null,
      subject: decodeWords(headers.get('subject') || ''),
      from: headerAddresses(headers.get('from')),
      to: headerAddresses(headers.get('to')),
      cc: headerAddresses(headers.get('cc')),
      sentAt: epoch(headers.get('date')),
      receivedAt: Math.floor(internalDate / 1000),
      ...labelState(message.labelIds),
      hasAttachments: attachmentState(message.payload),
      rfcMessageId: headerMessageId(headers.get('message-id')),
    },
  };
}

function boundedToken(tokenSource, options) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(clientError('MAIL_CLIENT_PROVIDER_TIMEOUT', 503)), HTTP_TIMEOUT_MS);
  });
  return Promise.race([timeout, tokenSource.getAccessToken(options)]).finally(() => clearTimeout(timer));
}

function createGmailMailClient({ tokenSource, fetch: fetchImpl = globalThis.fetch }) {
  async function get(path, query = {}, force = false) {
    try {
      const token = await boundedToken(tokenSource, { force });
      const params = new URLSearchParams(query).toString();
      const response = await fetchImpl(API + path + (params ? '?' + params : ''), {
        method: 'GET',
        headers: { authorization: 'Bearer ' + token },
        redirect: 'error',
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (response.status === 401 && !force) return get(path, query, true);
      if (response.status === 401 || response.status === 403) throw clientError('MAIL_CLIENT_AUTH_REQUIRED', 503);
      if (response.status === 404) throw clientError('MAIL_CLIENT_MESSAGE_GONE', 404);
      if (!response.ok) throw clientError('MAIL_CLIENT_PROVIDER_UNAVAILABLE', 503);
      const data = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw clientError('MAIL_CLIENT_PROVIDER_RESPONSE');
      return data;
    } catch (error) {
      if (error?.code?.startsWith('MAIL_CLIENT_')) throw error;
      if (error?.code === 'MAIL_AUTH_REQUIRED') throw clientError('MAIL_CLIENT_AUTH_REQUIRED', 503);
      if (error?.name === 'TimeoutError') throw clientError('MAIL_CLIENT_PROVIDER_TIMEOUT', 503);
      throw clientError('MAIL_CLIENT_PROVIDER_UNAVAILABLE', 503);
    }
  }

  async function verifyAccount(account) {
    const profile = await get('/profile', { fields: 'emailAddress' });
    if (String(profile.emailAddress || '').toLowerCase() !== account.address.toLowerCase()) {
      throw clientError('MAIL_CLIENT_ACCOUNT_MISMATCH', 503);
    }
  }

  async function fetchMetadata(id) {
    const message = await get('/messages/' + encodeURIComponent(id), { format: 'full', fields: MESSAGE_FIELDS });
    if (message.id !== id) throw clientError('MAIL_CLIENT_LOCATION_STALE', 409);
    return normalize(message);
  }

  async function load(ids) {
    const result = [];
    for (let i = 0; i < ids.length; i += 8) {
      const batch = ids.slice(i, i + 8);
      result.push(...await Promise.all(batch.map(async id => {
        try {
          return await fetchMetadata(id);
        } catch (error) {
          if (error.code !== 'MAIL_CLIENT_MESSAGE_GONE') throw error;
          return null;
        }
      })));
    }
    return result.filter(Boolean);
  }

  function list({ labelId, pageToken, limit, q }) {
    return get('/messages', {
      maxResults: limit,
      fields: 'messages(id),nextPageToken,resultSizeEstimate',
      ...(pageToken ? { pageToken } : {}),
      ...(q ? { q } : {}),
      ...(labelId ? { labelIds: labelId } : {}),
      ...(['SPAM', 'TRASH'].includes(labelId) ? { includeSpamTrash: 'true' } : {}),
    });
  }

  return {
    async listCollections(account) {
      await verifyAccount(account);
      const data = await get('/labels', { fields: 'labels(id,name,type)' });
      return [
        { id: 'all', kind: 'all', name: '전체 메일', selectable: true },
        ...responseArray(data.labels).map(label => ({
          id: 'label:' + label.id, kind: 'label', providerId: label.id, name: label.name,
          type: label.type, inbox: label.id === 'INBOX', selectable: true,
        })),
      ];
    },

    async page(account, collection, cursor, limit) {
      await verifyAccount(account);
      const result = await list({ labelId: collection.providerId, pageToken: cursor, limit });
      if (result.nextPageToken && result.nextPageToken === cursor) throw clientError('MAIL_CLIENT_PROVIDER_RESPONSE');
      const rows = await load([...new Set(responseArray(result.messages).map(message => message.id))]);
      return {
        rows: collection.providerId ? rows.filter(row => row.metadata.labelIds.includes(collection.providerId)) : rows,
        next: result.nextPageToken || null,
      };
    },

    async inboxRange(account, _collection, { from, to, maximum }) {
      await verifyAccount(account);
      const ids = new Set();
      const tokens = new Set();
      let pageToken;
      do {
        const q = (from > 0 ? 'after:' + (from - 1) + ' ' : '') + 'before:' + to;
        const page = await list({ labelId: 'INBOX', pageToken, limit: 100, q });
        for (const message of responseArray(page.messages)) ids.add(message.id);
        if (ids.size > maximum) return { dense: true };
        pageToken = page.nextPageToken;
        if (tokens.has(pageToken)) throw clientError('MAIL_CLIENT_PROVIDER_RESPONSE');
        if (pageToken) tokens.add(pageToken);
      } while (pageToken);
      const [rows, older] = await Promise.all([
        load([...ids]),
        from > 0 ? list({ labelId: 'INBOX', limit: 1, q: 'before:' + from }) : null,
      ]);
      return {
        rows: rows.filter(row => row.metadata.labelIds.includes('INBOX')
          && row.metadata.receivedAt >= from && row.metadata.receivedAt < to),
        earlier: Boolean(older?.messages?.length),
        anchor: null,
      };
    },

    async fromAgent(account, agent) {
      if (!agent.gmailMessageId) throw clientError('MAIL_CLIENT_LOCATION_STALE', 409);
      await verifyAccount(account);
      return fetchMetadata(agent.gmailMessageId);
    },

    async open(account, message) {
      await verifyAccount(account);
      const id = message.locator.messageId;
      const result = await get('/messages/' + encodeURIComponent(id), {
        format: 'raw', fields: 'id,threadId,internalDate,labelIds,raw',
      });
      if (result.id !== id || !result.raw) throw clientError('MAIL_CLIENT_LOCATION_STALE', 409);
      return {
        raw: Buffer.from(result.raw, 'base64url'),
        row: {
          ...message,
          metadata: {
            ...message.metadata,
            threadId: result.threadId ?? null,
            ...labelState(result.labelIds),
          },
        },
      };
    },
  };
}

module.exports = { createGmailMailClient };
