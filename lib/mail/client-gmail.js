'use strict';

const { clientError, decodeWords, epoch, headerAddresses, headerMessageId } = require('./client-message');

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const HTTP_TIMEOUT_MS = 12_000;
const PART_FIELDS = 'filename,mimeType,headers(name,value)';
const TREE_FIELDS = Array.from({ length: 6 }).reduce(fields => PART_FIELDS + ',parts(' + fields + ')', PART_FIELDS);
const MESSAGE_FIELDS = 'id,threadId,internalDate,labelIds,payload(' + TREE_FIELDS + ')';
const THREAD_FIELDS = 'id,messages(' + MESSAGE_FIELDS + ')';
const PRIVATE_LABELS = ['SPAM', 'TRASH', 'DRAFT'];
const RATE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded', 'backendError']);
const WINDOW_PAGE = 100;
const LAZY_CHUNK = 8;

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

// Gmail answers rate limits with 403/429 too. Only the reason code is read and logged.
async function rejection(response) {
  const body = await response.json().catch(() => null);
  const error = body?.error;
  const reason = [error?.errors?.[0]?.reason, error?.status].find(value => typeof value === 'string' && /^[A-Za-z_]{1,40}$/.test(value));
  const limited = response.status === 429 || RATE_REASONS.has(error?.errors?.[0]?.reason) || error?.status === 'RESOURCE_EXHAUSTED';
  console.warn('Mail Workspace Gmail ' + response.status + ' reason=' + (reason || 'unknown'));
  return limited ? clientError('MAIL_CLIENT_PROVIDER_RATE_LIMITED', 503) : clientError('MAIL_CLIENT_AUTH_REQUIRED', 503);
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
      if (response.status === 403 || response.status === 429) throw await rejection(response);
      if (response.status === 401) throw clientError('MAIL_CLIENT_AUTH_REQUIRED', 503);
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

    async search(account, collection, cursor, limit, params) {
      await verifyAccount(account);
      const labelId = collection.providerId;
      const explicit = PRIVATE_LABELS.includes(labelId);
      const terms = [];
      if (params.contactEmail) terms.push(`{from:"${params.contactEmail}" to:"${params.contactEmail}"}`);
      // Values containing Gmail query delimiters are checked against the returned headers only.
      if (params.q && !/["\\]/u.test(params.q)) terms.push(`{subject:"${params.q}" from:"${params.q}" to:"${params.q}"}`);
      if (params.sender && !/["\\]/u.test(params.sender)) terms.push(`from:"${params.sender}"`);
      if (!explicit) terms.push('-in:drafts', '-in:spam', '-in:trash');
      if (params.read) terms.push('is:' + params.read);
      if (params.starred) terms.push('is:starred');
      if (params.attachments) terms.push('has:attachment');
      if (params.from !== null) terms.push('after:' + (params.from - 1));
      if (params.until !== null) terms.push('before:' + params.until);
      const result = await list({ labelId, pageToken: cursor, limit, q: terms.join(' ') });
      if (result.nextPageToken && result.nextPageToken === cursor) throw clientError('MAIL_CLIENT_PROVIDER_RESPONSE');
      const rows = await load([...new Set(responseArray(result.messages).map(message => message.id))]);
      return {
        rows: rows.filter(({ metadata: { labelIds } }) => (!labelId || labelIds.includes(labelId))
          && (explicit || !labelIds.some(label => PRIVATE_LABELS.includes(label)))),
        next: result.nextPageToken || null,
      };
    },

    async thread(id, messageId) {
      // The current message's raw GET has already verified the account and thread ID.
      const result = await get('/threads/' + encodeURIComponent(id), { format: 'full', fields: THREAD_FIELDS });
      const messages = responseArray(result.messages);
      if (result.id !== id || messages.some(message => message.threadId !== id)
        || !messages.some(message => message.id === messageId)) throw clientError('MAIL_CLIENT_LOCATION_STALE', 409);
      return [...new Map(messages.filter(message => message.id !== messageId)
        .map(message => [message.id, normalize(message)])).values()];
    },

    // A per-request candidate stream. Ids come newest-first from the list call, so metadata is fetched
    // in list order and only when the merge needs the next head. Order across chunks relies on that
    // Gmail list order; rows inside one fetched chunk are sorted by receive time.
    openStream(account, collection, { carry = null } = {}) {
      const labelId = collection.providerId;
      let window = carry ? { from: carry.from, to: carry.to } : null;
      let ids = [...(carry?.ids || [])];
      let ready = [...(carry?.rows || [])];
      let taken = [];
      let verified = false;
      const verify = async () => {
        if (!verified) await verifyAccount(account);
        verified = true;
      };
      const newest = (a, b) => b.metadata.receivedAt - a.metadata.receivedAt
        || (a.locator.messageId < b.locator.messageId ? -1 : a.locator.messageId > b.locator.messageId ? 1 : 0);
      return {
        async open({ from, to, maximum }) {
          await verify();
          window = { from, to };
          const older = from > 0 ? list({ labelId, limit: 1, q: 'before:' + from }) : null;
          older?.catch(() => {});
          const found = new Set();
          const tokens = new Set();
          let pageToken;
          do {
            const q = (from > 0 ? 'after:' + (from - 1) + ' ' : '') + 'before:' + to;
            const page = await list({ labelId, pageToken, limit: WINDOW_PAGE, q });
            for (const message of responseArray(page.messages)) found.add(message.id);
            if (found.size > maximum) return { dense: true };
            pageToken = page.nextPageToken;
            if (tokens.has(pageToken)) throw clientError('MAIL_CLIENT_PROVIDER_RESPONSE');
            if (pageToken) tokens.add(pageToken);
          } while (pageToken);
          ids = [...found];
          ready = [];
          return { earlier: Boolean((await older)?.messages?.length), anchor: null, count: ids.length };
        },
        async peek() {
          while (!ready.length && ids.length) {
            await verify();
            const rows = await load(ids.splice(0, LAZY_CHUNK));
            ready.push(...rows.filter(row => (!labelId || row.metadata.labelIds.includes(labelId))
              && row.metadata.receivedAt >= window.from && row.metadata.receivedAt < window.to).sort(newest));
          }
          const row = ready[0];
          return row ? { receivedAt: row.metadata.receivedAt, locator: row.locator } : null;
        },
        advance(keep = true) {
          const row = ready.shift();
          if (keep) taken.push(row);
        },
        async finish() {
          const rows = taken;
          taken = [];
          return rows;
        },
        carry: () => (ids.length || ready.length ? { ids: [...ids], rows: [...ready], ...window } : null),
        async close() {},
      };
    },

    async fromAgent(account, agent) {
      if (!agent.gmailMessageId) throw clientError('MAIL_CLIENT_LOCATION_STALE', 409);
      await verifyAccount(account);
      return fetchMetadata(agent.gmailMessageId);
    },

    async open(account, message, { analysis = false } = {}) {
      await verifyAccount(account);
      const id = message.locator.messageId;
      if (analysis) {
        const current = await fetchMetadata(id);
        const difference = ['receivedAt', 'sentAt', 'rfcMessageId', 'subject', 'from', 'to', 'cc']
          .some(key => JSON.stringify(current.metadata[key]) !== JSON.stringify(message.metadata[key]));
        if (difference) throw clientError('MAIL_CLIENT_LOCATION_STALE', 409);
        if (current.metadata.labelIds.some(label => ['SENT', 'DRAFT', 'SPAM', 'TRASH'].includes(label))) {
          throw clientError('MAIL_CLIENT_SMART_INELIGIBLE', 422);
        }
      }
      const result = await get('/messages/' + encodeURIComponent(id), {
        format: 'raw', fields: 'id,threadId,internalDate,labelIds,raw',
      });
      if (result.id !== id || !result.raw) throw clientError('MAIL_CLIENT_LOCATION_STALE', 409);
      if (analysis && (result.internalDate == null
        || Math.floor(Number(result.internalDate) / 1000) !== message.metadata.receivedAt)) {
        throw clientError('MAIL_CLIENT_LOCATION_STALE', 409);
      }
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
