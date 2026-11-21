'use strict';

const { createMailClientCache } = require('./client-cache');
const { clientError, digest } = require('./client-message');

const ACTIONS = new Set(['set_read', 'set_starred', 'archive', 'move', 'trash']);
const REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;
const STATUS_CODES = {
  MAIL_CLIENT_WRITE_MAILBOX_INVALID: 400,
  MAIL_CLIENT_MESSAGE_NOT_FOUND: 404,
  MAIL_CLIENT_ACCOUNT_NOT_FOUND: 404,
  MAIL_CLIENT_LOCATION_STALE: 409,
  MAIL_CLIENT_WRITE_MAILBOX_NOT_FOUND: 409,
  MAIL_CLIENT_WRITE_ACCOUNT_CONFLICT: 409,
  MAIL_CLIENT_MOVE_UNSUPPORTED: 409,
  MAIL_CLIENT_SOURCE_TOO_LARGE: 413,
  MAIL_CLIENT_ACCOUNT_DISABLED: 503,
  MAIL_CLIENT_ACCOUNT_MISMATCH: 503,
  MAIL_CLIENT_WRITE_AUTH_REQUIRED: 503,
  MAIL_CLIENT_PROVIDER_UNAVAILABLE: 503,
  MAIL_CLIENT_SOURCE_UNAVAILABLE: 503,
};

function invalid() {
  return clientError('MAIL_CLIENT_WRITE_INVALID_REQUEST', 400);
}

function positiveId(id) {
  return Number.isSafeInteger(id) && id > 0;
}

function mailboxId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024;
}

function normalize(raw) {
  if (!raw || !positiveId(raw.messageId) || !ACTIONS.has(raw.action)) throw invalid();
  const { action } = raw;
  const allowed = new Set(['messageId', 'action']);
  const request = { messageId: raw.messageId, action };
  if (action === 'set_read' || action === 'set_starred') {
    allowed.add('value');
    if (typeof raw.value !== 'boolean') throw invalid();
    request.value = raw.value;
  }
  if (action === 'set_read') {
    allowed.add('origin');
    const origin = raw.origin === undefined ? 'user' : raw.origin;
    if (origin !== 'user' && !(origin === 'auto' && raw.value)) throw invalid();
    request.origin = origin;
  }
  if (action === 'move') {
    allowed.add('targetMailbox');
    allowed.add('sourceMailbox');
    const target = raw.targetMailbox;
    if (!positiveId(target?.accountId) || !mailboxId(target.id)
      || Object.keys(target).some(key => !['accountId', 'id'].includes(key))) throw invalid();
    request.targetMailbox = { accountId: target.accountId, id: target.id };
    if (Object.hasOwn(raw, 'sourceMailbox')) {
      if (!mailboxId(raw.sourceMailbox)) throw invalid();
      request.sourceMailbox = raw.sourceMailbox;
    }
  }
  if (Object.keys(raw).some(key => !allowed.has(key))) throw invalid();
  return request;
}

function createMailClientActions({ db, agentStore, providers, onConfirmed = () => {} }) {
  const cache = createMailClientCache(db);
  const pending = new Map();
  const readReceipts = db.prepare(`
    SELECT message_id AS messageId, request_sha256 AS requestHash, state, provider_code AS code
    FROM mail_client_action_receipts WHERE request_id = ?
  `);
  const insertReceipt = db.prepare(`
    INSERT INTO mail_client_action_receipts (request_id, message_id, request_sha256, state, provider_code)
    VALUES (?, ?, ?, 'unknown', 'MAIL_CLIENT_WRITE_PENDING')
  `);
  const finishReceipt = db.prepare(`
    UPDATE mail_client_action_receipts SET state = ?, provider_code = ?, finished_at = unixepoch()
    WHERE request_id = ? AND message_id = ?
  `);
  const findOverride = db.prepare(`
    SELECT state FROM mail_client_read_overrides WHERE account_id = ? AND mailbox_key = ?
       AND message_key = ? AND content_key = ?
  `);
  const setOverride = db.prepare(`
    INSERT INTO mail_client_read_overrides (account_id, mailbox_key, message_key, content_key, state)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET state = excluded.state
  `);
  const deleteOverride = db.prepare(`
    DELETE FROM mail_client_read_overrides WHERE account_id = ? AND mailbox_key = ?
       AND message_key = ? AND content_key = ?
  `);

  const reserve = db.transaction((requestId, hash, operations) => {
    const rows = readReceipts.all(requestId);
    if (rows.length) {
      if (rows[0].requestHash !== hash) throw clientError('MAIL_CLIENT_REQUEST_CONFLICT', 409);
      return rows;
    }
    for (const { messageId } of operations) insertReceipt.run(requestId, messageId, hash);
    return null;
  });

  function forAccount(id, task) {
    const tail = Promise.resolve(pending.get(id)).catch(() => {}).then(task);
    pending.set(id, tail);
    return tail.finally(() => { if (pending.get(id) === tail) pending.delete(id); });
  }

  function result(messageId, accountId, state, code) {
    if (code === 'MAIL_CLIENT_WRITE_PENDING') code = 'MAIL_CLIENT_WRITE_UNKNOWN';
    return {
      messageId, accountId, state, code,
      statusCode: state === 'confirmed' ? 200 : state === 'unknown' ? 202 : STATUS_CODES[code] || 502,
    };
  }

  function execute(accountId, requestId, operation, message) {
    let attempted = false;
    let sourceKey;
    let possibleDestination;
    let original;
    let originalDestination;
    let protectedUnread = false;
    const reading = operation.action === 'set_read';
    const manualUnread = reading && !operation.value;
    const values = key => [accountId, key.mailboxKey, key.messageKey, key.contentKey];
    const get = key => findOverride.get(...values(key))?.state;
    const put = (key, state) => state ? setOverride.run(...values(key), state) : deleteOverride.run(...values(key));
    const wildcard = key => ({ ...key, messageKey: '*' });

    const prepare = db.transaction((key, destinationMailboxKey) => {
      sourceKey = key;
      original = get(key);
      protectedUnread = (original || get(wildcard(key))) === 'unread';
      if (reading && operation.origin === 'auto' && protectedUnread) return false;
      if (manualUnread) put(key, 'unread');
      if (destinationMailboxKey && protectedUnread) {
        possibleDestination = { ...wildcard(key), mailboxKey: destinationMailboxKey };
        originalDestination = get(possibleDestination);
        put(possibleDestination, 'unread');
      }
      return true;
    });

    const finish = db.transaction((state, code, destinationUid) => {
      if (state === 'failed') {
        if (manualUnread && sourceKey) put(sourceKey, original);
        if (possibleDestination) put(possibleDestination, originalDestination);
      }
      const invalidate = state === 'confirmed' && code !== 'MAIL_CLIENT_MANUAL_UNREAD_PRESERVED';
      if (invalidate) {
        if (reading && operation.origin === 'user' && operation.value && sourceKey) {
          put(sourceKey, get(wildcard(sourceKey)) === 'unread' ? 'read' : null);
        }
        if (possibleDestination) {
          put(sourceKey, null);
          if (destinationUid) {
            put({ ...possibleDestination, messageKey: String(destinationUid) }, 'unread');
            put(possibleDestination, originalDestination);
          }
        }
        cache.invalidateLists(accountId);
      }
      finishReceipt.run(state, code, requestId, operation.messageId);
      return invalidate;
    });

    return forAccount(accountId, async () => {
      let outcome;
      try {
        if (!message) throw clientError('MAIL_CLIENT_MESSAGE_NOT_FOUND', 404);
        const account = agentStore.getAccount(accountId);
        if (!account) throw clientError('MAIL_CLIENT_ACCOUNT_NOT_FOUND', 404);
        if (account.status === 'disabled') throw clientError('MAIL_CLIENT_ACCOUNT_DISABLED', 503);
        if (operation.targetMailbox && operation.targetMailbox.accountId !== accountId) {
          throw clientError('MAIL_CLIENT_WRITE_ACCOUNT_CONFLICT', 409);
        }
        if (operation.sourceMailbox && account.provider !== 'gmail') {
          throw clientError('MAIL_CLIENT_WRITE_MAILBOX_INVALID', 400);
        }
        const provider = providers[account.provider];
        if (!provider) throw clientError('MAIL_CLIENT_PROVIDER_UNAVAILABLE', 503);
        outcome = await provider.apply(account, message, operation, { prepare, dispatch() { attempted = true; } });
      } catch (error) {
        outcome = attempted ? { state: 'unknown', code: 'MAIL_CLIENT_WRITE_UNKNOWN' }
          : { state: 'failed', code: error?.code?.startsWith('MAIL_CLIENT_')
            ? error.code : 'MAIL_CLIENT_PROVIDER_UNAVAILABLE' };
      }
      if (finish(outcome.state, outcome.code, outcome.destinationUid)) onConfirmed(accountId);
      return result(operation.messageId, accountId, outcome.state, outcome.code);
    });
  }

  return {
    async run(requestId, rawOperations) {
      if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)
        || !Array.isArray(rawOperations) || !rawOperations.length || rawOperations.length > 25) throw invalid();
      const operations = rawOperations.map(normalize);
      if (new Set(operations.map(operation => operation.messageId)).size !== operations.length) throw invalid();
      const prior = reserve.immediate(requestId, digest(JSON.stringify(operations)), operations);
      const byId = prior && new Map(prior.map(row => [row.messageId, row]));
      const results = await Promise.all(operations.map(operation => {
        const message = cache.getMessage(operation.messageId);
        const accountId = message?.accountId ?? null;
        const receipt = byId?.get(operation.messageId);
        return receipt ? result(operation.messageId, accountId, receipt.state, receipt.code)
          : execute(accountId, requestId, operation, message);
      }));
      return { requestId, success: results.every(item => item.state === 'confirmed'), results };
    },
  };
}

module.exports = { createMailClientActions };
