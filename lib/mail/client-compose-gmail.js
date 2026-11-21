'use strict';

const { clientError, MAX_SOURCE_BYTES } = require('./client-message');

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TIMEOUT = 15_000;
const GMAIL_ID = /^[\w-]{1,256}$/u;
const unavailable = () => clientError('MAIL_CLIENT_PROVIDER_UNAVAILABLE', 503);
const authRequired = () => clientError('MAIL_CLIENT_WRITE_AUTH_REQUIRED', 503);
const unknown = { state: 'unknown', code: 'MAIL_CLIENT_COMPOSE_UNKNOWN' };

function draftPath(id) {
  if (typeof id !== 'string' || !GMAIL_ID.test(id)) throw clientError('MAIL_CLIENT_DRAFT_NOT_FOUND', 404);
  return '/drafts/' + id;
}

function snapshot(data, expected) {
  if (!data?.id || (expected && data.id !== expected) || !data.message?.id
    || typeof data.message.raw !== 'string' || !/^[A-Za-z0-9_\-]+=*$/u.test(data.message.raw)) throw unavailable();
  if (data.message.raw.length > Math.ceil(MAX_SOURCE_BYTES / 3) * 4) {
    throw clientError('MAIL_CLIENT_SOURCE_TOO_LARGE', 413);
  }
  return {
    id: data.id,
    messageId: data.message.id,
    threadId: data.message.threadId ?? null,
    raw: Buffer.from(data.message.raw, 'base64url'),
  };
}

function createGmailCompose({ tokenSource, fetch: fetchImpl = globalThis.fetch }) {
  function request(path, headers, method = 'GET', payload) {
    return fetchImpl(API + path, {
      method, headers: payload ? { ...headers, 'content-type': 'application/json' } : headers,
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      redirect: 'error', signal: AbortSignal.timeout(TIMEOUT),
    });
  }

  async function get(path, headers) {
    try {
      const response = await request(path, headers);
      if ([401, 403].includes(response.status)) throw authRequired();
      if (response.status === 404) throw clientError('MAIL_CLIENT_DRAFT_NOT_FOUND', 404);
      if (!response.ok) throw unavailable();
      return await response.json();
    } catch (error) {
      if (error.code?.startsWith('MAIL_CLIENT_')) throw error;
      throw unavailable();
    }
  }

  return async function gmail(account) {
    if (!tokenSource) throw authRequired();
    let token;
    try {
      token = await tokenSource.getAccessToken();
    } catch (error) {
      if (error.code === 'MAIL_AUTH_REQUIRED') throw authRequired();
      throw unavailable();
    }
    const headers = { authorization: 'Bearer ' + token };
    const profile = await get('/profile?fields=emailAddress', headers);
    if (profile?.emailAddress?.toLowerCase() !== account.address.toLowerCase()) {
      throw clientError('MAIL_CLIENT_ACCOUNT_MISMATCH', 503);
    }
    const open = async id => snapshot(await get(draftPath(id) + '?format=raw', headers), id);

    async function write(path, method, payload, action, previousMessageId) {
      try {
        const response = await request(path, headers, method, payload);
        if ([401, 403].includes(response.status)) return { state: 'failed', code: 'MAIL_CLIENT_WRITE_AUTH_REQUIRED' };
        if (response.status === 413) return { state: 'failed', code: 'MAIL_CLIENT_COMPOSE_TOO_LARGE', statusCode: 413 };
        if (response.status >= 400 && response.status < 500 && response.status !== 408) {
          return { state: 'failed', code: 'MAIL_CLIENT_COMPOSE_REJECTED' };
        }
        if (!response.ok) return unknown;
        const result = await response.json();
        if (typeof result?.id !== 'string' || !GMAIL_ID.test(result.id)) return unknown;
        if (action === 'send') {
          return { state: 'sent', providerMessageId: result.id, delivery: 'full', sentCopyStatus: 'provider_managed' };
        }
        if ((payload.id && payload.id !== result.id) || typeof result.message?.id !== 'string'
          || result.message.id === previousMessageId) return unknown;
        return { state: 'saved', draftId: result.id, draftMessageId: result.message.id };
      } catch {
        return unknown;
      }
    }

    const message = (raw, threadId) => ({ raw: raw.toString('base64url'), ...(threadId ? { threadId } : {}) });
    return {
      async list(cursor, limit) {
        const query = new URLSearchParams({ maxResults: limit, fields: 'drafts(id,message(id,threadId)),nextPageToken,resultSizeEstimate' });
        if (cursor) query.set('pageToken', cursor);
        const data = await get('/drafts?' + query, headers);
        if (!Array.isArray(data?.drafts ?? [])) throw unavailable();
        return {
          drafts: (data.drafts ?? []).map(entry => ({
            id: entry.id, messageId: entry.message?.id ?? null, threadId: entry.message?.threadId ?? null,
          })),
          nextCursor: data.nextPageToken ?? null,
        };
      },
      open,
      async save(raw, threadId, before) {
        const payload = { message: message(raw, threadId) };
        if (before) payload.id = before.id;
        return write(before ? draftPath(before.id) : '/drafts', before ? 'PUT' : 'POST', payload, 'save', before?.messageId);
      },
      async send(raw, threadId, before) {
        const mime = message(raw, threadId);
        return before
          ? write('/drafts/send', 'POST', { id: before.id, message: mime }, 'send')
          : write('/messages/send', 'POST', mime, 'send');
      },
    };
  };
}

module.exports = { createGmailCompose };
