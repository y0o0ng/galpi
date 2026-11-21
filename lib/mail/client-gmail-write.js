'use strict';

const { clientError, digest } = require('./client-message');

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TIMEOUT = 12_000;
const BODY = { 'content-type': 'application/json' };

function outcome(state, code) {
  return { state, code };
}

function createGmailMailWriter({ tokenSource, fetch: fetchImpl = globalThis.fetch } = {}) {
  async function get(path, headers) {
    try {
      const res = await fetchImpl(API + path, { headers, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT) });
      if ([401, 403].includes(res.status)) throw clientError('MAIL_CLIENT_WRITE_AUTH_REQUIRED', 503);
      if (res.status === 404) throw clientError('MAIL_CLIENT_LOCATION_STALE', 409);
      if (!res.ok) throw clientError('MAIL_CLIENT_PROVIDER_UNAVAILABLE', 503);
      return await res.json();
    } catch (error) {
      if (error?.code?.startsWith('MAIL_CLIENT_')) throw error;
      throw clientError('MAIL_CLIENT_PROVIDER_UNAVAILABLE', 503);
    }
  }

  async function authorize(account) {
    if (!tokenSource) throw clientError('MAIL_CLIENT_WRITE_AUTH_REQUIRED', 503);
    let token;
    try {
      token = await tokenSource.getAccessToken();
    } catch (error) {
      throw clientError(error?.code === 'MAIL_AUTH_REQUIRED'
        ? 'MAIL_CLIENT_WRITE_AUTH_REQUIRED' : 'MAIL_CLIENT_PROVIDER_UNAVAILABLE', 503);
    }
    const headers = { authorization: 'Bearer ' + token };
    const profile = await get('/profile?fields=emailAddress', headers);
    if (String(profile?.emailAddress || '').toLowerCase() !== account.address.toLowerCase()) {
      throw clientError('MAIL_CLIENT_ACCOUNT_MISMATCH', 503);
    }
    return headers;
  }

  async function moveLabels(action, labels, headers) {
    const target = action.targetMailbox.id.startsWith('label:') ? action.targetMailbox.id.slice(6) : null;
    if (!target || !action.sourceMailbox) throw clientError('MAIL_CLIENT_WRITE_MAILBOX_INVALID', 400);
    const response = await get('/labels?fields=labels(id,type)', headers);
    const userLabels = new Set((response?.labels || []).filter(label => label.type === 'user').map(label => label.id));
    if (!userLabels.has(target)) throw clientError('MAIL_CLIENT_WRITE_MAILBOX_NOT_FOUND', 409);
    if (action.sourceMailbox === 'all') return { add: [target], remove: [] };
    const source = action.sourceMailbox.startsWith('label:') ? action.sourceMailbox.slice(6) : null;
    if (source !== 'INBOX' && !userLabels.has(source)) throw clientError('MAIL_CLIENT_WRITE_MAILBOX_INVALID', 400);
    if (!labels.includes(source)) throw clientError('MAIL_CLIENT_LOCATION_STALE', 409);
    return { add: [target], remove: source === target ? [] : [source] };
  }

  return {
    async apply(account, message, action, hooks) {
      const headers = await authorize(account);
      const id = message.locator.messageId;
      if (!id || message.proof !== id) throw clientError('MAIL_CLIENT_LOCATION_STALE', 409);
      const path = '/messages/' + encodeURIComponent(id);
      const current = await get(path + '?format=minimal&fields=id,labelIds', headers);
      if (current?.id !== id) throw clientError('MAIL_CLIENT_LOCATION_STALE', 409);
      const labels = current.labelIds ?? [];
      if (!Array.isArray(labels)) throw clientError('MAIL_CLIENT_PROVIDER_RESPONSE', 503);
      let changes;
      const trash = action.action === 'trash';
      if (trash) changes = { add: ['TRASH'], remove: [] };
      else if (action.action === 'archive') changes = { add: [], remove: ['INBOX'] };
      else if (action.action === 'move') changes = await moveLabels(action, labels, headers);
      else {
        const read = action.action === 'set_read';
        const label = read ? 'UNREAD' : 'STARRED';
        const add = read ? !action.value : action.value;
        changes = add ? { add: [label], remove: [] } : { add: [], remove: [label] };
      }
      if (!hooks.prepare({ mailboxKey: 'gmail', messageKey: digest(id), contentKey: '' })) {
        return outcome('confirmed', 'MAIL_CLIENT_MANUAL_UNREAD_PRESERVED');
      }
      const { add, remove } = changes;
      const matches = values => add.every(label => values.includes(label)) && remove.every(label => !values.includes(label));
      if (matches(labels)) return outcome('confirmed', 'MAIL_CLIENT_ALREADY_SET');
      hooks.dispatch();
      const res = await fetchImpl(API + path + (trash ? '/trash' : '/modify'), {
        method: 'POST', headers: { ...headers, ...BODY }, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT),
        ...(trash ? {} : { body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }) }),
      });
      if ([401, 403].includes(res.status)) return outcome('failed', 'MAIL_CLIENT_WRITE_AUTH_REQUIRED');
      if (res.status === 404) return outcome('failed', 'MAIL_CLIENT_LOCATION_STALE');
      if (res.status >= 400 && res.status < 500 && res.status !== 408) {
        return outcome('failed', 'MAIL_CLIENT_WRITE_REJECTED');
      }
      if (!res.ok) return outcome('unknown', 'MAIL_CLIENT_WRITE_UNKNOWN');
      const updated = await res.json();
      return updated?.id === id && Array.isArray(updated.labelIds) && matches(updated.labelIds)
        ? outcome('confirmed', 'MAIL_CLIENT_WRITE_CONFIRMED')
        : outcome('unknown', 'MAIL_CLIENT_WRITE_UNKNOWN');
    },
  };
}

module.exports = { createGmailMailWriter };
