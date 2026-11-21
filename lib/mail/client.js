'use strict';

const { randomUUID } = require('node:crypto');
const { createMailClientCache, locationKey } = require('./client-cache');
const { clientError, digest, parseClientMessage } = require('./client-message');

const DAY = 86400;
const INBOX_WINDOW = 7 * DAY;
const RANGE_MAX = 200;
const CURSOR_TTL = 600;
const COLLECTION_TTL = 300;

const compareCandidates = (a, b) => b.row.metadata.receivedAt - a.row.metadata.receivedAt
  || a.account.id - b.account.id
  || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

function createMailClient({ db, agentStore, providers, now = () => Math.floor(Date.now() / 1000) }) {
  const cache = createMailClientCache(db);
  const cursors = new Map();

  function accountFor(id) {
    const account = agentStore.getAccount(id);
    if (!account) throw clientError('MAIL_CLIENT_ACCOUNT_NOT_FOUND', 404);
    if (account.status === 'disabled') throw clientError('MAIL_CLIENT_ACCOUNT_DISABLED', 503);
    return account;
  }

  function adapter(account) {
    if (account.status === 'disabled') throw clientError('MAIL_CLIENT_ACCOUNT_DISABLED', 503);
    const provider = providers[account.provider];
    if (!provider) throw clientError('MAIL_CLIENT_ACCOUNT_UNAVAILABLE', 503);
    return provider;
  }

  function issue(scope, state) {
    const token = randomUUID();
    cursors.set(token, { scope, state, expiresAt: now() + CURSOR_TTL, response: null });
    for (const [id, item] of cursors) {
      if (item.expiresAt <= now() || cursors.size > 256) cursors.delete(id);
      else break;
    }
    return token;
  }

  function pageCursor(scope, token, start, read) {
    if (!token) return read(start);
    const slot = cursors.get(token);
    if (!slot || slot.scope !== scope || slot.expiresAt <= now()) throw clientError('MAIL_CLIENT_CURSOR_INVALID', 409);
    if (!slot.response) slot.response = Promise.resolve().then(() => read(slot.state)).catch(error => {
      slot.response = null;
      throw error;
    });
    return slot.response;
  }

  function observation(account, status, fetchedAt = null, failure = null) {
    return {
      accountId: account.id,
      provider: account.provider,
      status,
      fetchedAt,
      ageSeconds: fetchedAt === null ? null : Math.max(0, now() - fetchedAt),
      failure,
    };
  }

  async function observe(account, key, read, maxAge = 0) {
    const previous = cache.readObservation(account.id, key);
    if (maxAge && previous && account.status !== 'disabled' && now() - previous.fetchedAt < maxAge) {
      return { value: previous.value, source: observation(account, 'fresh', previous.fetchedAt) };
    }
    try {
      const value = await read(adapter(account));
      const fetchedAt = now();
      if (!value.dense) cache.saveObservation(account.id, key, value, fetchedAt);
      return { value, source: observation(account, 'fresh', fetchedAt) };
    } catch (error) {
      if (error?.statusCode == null) throw error;
      const failure = { code: error.code, statusCode: error.statusCode };
      if (previous && !['MAIL_CLIENT_ACCOUNT_DISABLED', 'MAIL_CLIENT_ACCOUNT_MISMATCH'].includes(error.code)) {
        return { value: previous.value, source: observation(account, 'stale', previous.fetchedAt, failure) };
      }
      return { value: null, source: observation(account, 'unavailable', null, failure) };
    }
  }

  async function collections(account, maxAge = 0) {
    return observe(account, 'collections', provider => provider.listCollections(account), maxAge);
  }

  function requireObservation(result) {
    if (!result.value) throw clientError(result.source.failure.code, result.source.failure.statusCode || 503);
    return result.value;
  }

  function matchesAgent(agent, account, row) {
    if (!agent || agent.accountId !== account.id || agent.provider !== account.provider) return false;
    if (account.provider === 'gmail') {
      return agent.identityKind === 'gmail_message'
        && agent.identityKey === row.locator.messageId && agent.gmailMessageId === row.locator.messageId;
    }
    const storedValidity = String(agent.imapUidValidity ?? '');
    const identity = row.locator.agentIdentity;
    const sender = row.metadata.from[0]?.address;
    return row.locator.inbox && identity?.kind === agent.identityKind && identity.key === agent.identityKey
      && row.locator.uid === agent.imapUid
      && (!storedValidity || storedValidity === '0' || row.locator.uidValidity === storedValidity)
      && Boolean(sender) && sender.toLowerCase() === String(agent.senderAddress || '').toLowerCase()
      && row.metadata.subject === (agent.subject || '') && row.metadata.sentAt === agent.receivedAt;
  }

  function agentLink(account, row, id) {
    const key = account.provider === 'gmail' ? row.locator.messageId : row.locator.agentIdentity?.key;
    if (!key || (account.provider !== 'gmail' && !row.locator.inbox)) return null;
    const known = agentStore.findMessageByIdentity(account.id, key);
    if (!known) return null;
    const agent = agentStore.findMessageLocator(known.id);
    return matchesAgent(agent, account, row) && cache.bindAgent(known.id, id, account.id, row) ? known.id : null;
  }

  function item(account, row, id, source, error = null) {
    return {
      id,
      accountId: account.id,
      provider: account.provider,
      folderPath: row.locator.path ?? null,
      providerMessageId: row.locator.messageId ?? null,
      ...row.metadata,
      fetchedAt: source.fetchedAt,
      stale: source.status === 'stale',
      agentMessageId: id === null || source.status === 'stale' ? null : agentLink(account, row, id),
      ...(error ? { detailError: error } : {}),
    };
  }

  function atCollection(rows, collection) {
    return rows.map(row => ({ ...row, locator: { ...row.locator, inbox: Boolean(collection.inbox) } }));
  }

  async function materialize(account, rows, source) {
    if (!rows.length) return [];
    if (source.status === 'stale' && rows[0].locator.path && !rows[0].locator.uidValidity) {
      return rows.map(row => {
        const id = cache.findPreviouslyVerified(account.id, row);
        return item(account, row, id, source, id === null ? 'MAIL_CLIENT_LOCATION_UNVERIFIED' : null);
      });
    }
    let proven;
    try {
      const provider = adapter(account);
      proven = provider.prove ? await provider.prove(account, rows) : rows;
    } catch (error) {
      if (!error?.statusCode) throw error;
      return rows.map(row => item(account, row, null, source, error.code));
    }
    const confirmed = proven.filter(row => !row.detailError);
    const ids = cache.saveMessages(account.id, confirmed, source.fetchedAt);
    let index = 0;
    return proven.map(row => item(account, row, row.detailError ? null : ids[index++], source, row.detailError));
  }

  async function collectRange(account, from, to, anchor) {
    return observe(account, 'inbox:' + from + ':' + to + ':' + JSON.stringify(anchor ?? null), async provider => {
      const discovered = await collections(account, COLLECTION_TTL);
      const collection = requireObservation(discovered).find(entry => entry.inbox && entry.selectable);
      if (!collection) throw clientError('MAIL_CLIENT_INBOX_UNAVAILABLE', 503);
      const maximum = to - from <= 1 ? Infinity : RANGE_MAX;
      const range = await provider.inboxRange(account, collection, { from, to, maximum, anchor });
      return range.dense ? range : { ...range, rows: atCollection(range.rows, collection) };
    });
  }

  async function readInbox(scope, accounts, limit, start) {
    let { upper, buffered } = start;
    const anchors = { ...start.anchors };
    const sources = { ...start.sources };
    const excluded = new Set(start.excluded);
    const seen = new Set(start.seen);
    let incomplete = start.incomplete;
    const currentAccounts = accounts.filter(account => !excluded.has(account.id));
    for (let hops = 0; !buffered.length && upper !== null && hops < 3; hops += 1) {
      let from = Math.max(0, upper - INBOX_WINDOW);
      let groups;
      // A busy range is split before any rows from it are emitted. All accounts use the same boundary.
      for (;;) {
        groups = await Promise.all(currentAccounts.map(account => collectRange(account, from, upper, anchors[account.id])));
        if (!groups.some(group => group.value?.dense) || upper - from <= 1) break;
        from += Math.floor((upper - from) / 2);
      }
      buffered = [];
      let earlier = false;
      for (const [index, account] of currentAccounts.entries()) {
        const { value, source } = groups[index];
        sources[account.id] = value?.dense
          ? observation(account, 'unavailable', null, { code: 'MAIL_CLIENT_INBOX_RANGE_TOO_DENSE' })
          : source;
        if (!value || value.dense) {
          excluded.add(account.id);
          continue;
        }
        anchors[account.id] = value.anchor;
        earlier ||= value.earlier;
        for (const row of value.rows) {
          const key = account.id + ':' + locationKey(row.locator);
          if (seen.has(key)) continue;
          seen.add(key);
          buffered.push({ account, row, key, source });
        }
      }
      incomplete ||= Object.values(sources).some(source => source.status !== 'fresh');
      buffered.sort(compareCandidates);
      upper = from > 0 && earlier ? from : null;
      if (excluded.size) {
        for (let i = currentAccounts.length - 1; i >= 0; i -= 1) {
          if (excluded.has(currentAccounts[i].id)) currentAccounts.splice(i, 1);
        }
      }
    }

    const page = buffered.slice(0, limit);
    const groups = new Map();
    for (const [index, entry] of page.entries()) {
      if (!groups.has(entry.account.id)) groups.set(entry.account.id, []);
      groups.get(entry.account.id).push({ ...entry, index });
    }
    const messages = [];
    await Promise.all([...groups.values()].map(async group => {
      const [{ account, source }] = group;
      const rows = await materialize(account, group.map(entry => entry.row), source);
      group.forEach((entry, i) => { messages[entry.index] = rows[i]; });
    }));
    const remaining = buffered.slice(limit);
    const nextCursor = remaining.length || upper !== null
      ? issue(scope, { upper, buffered: remaining, sources, anchors, excluded, seen, incomplete })
      : null;
    return {
      messages,
      sources: accounts.map(account => sources[account.id]),
      incomplete: incomplete || messages.some(message => message.detailError),
      nextCursor,
    };
  }

  return {
    accounts() {
      return agentStore.listAccounts().map(({ id, provider, address, status }) => ({ id, provider, address, status }));
    },

    async mailboxes(accountId) {
      const account = accountFor(accountId);
      const result = await collections(account);
      return { mailboxes: requireObservation(result), source: result.source };
    },

    async mailbox(accountId, id, token, limit) {
      const account = accountFor(accountId);
      const scope = 'mailbox:' + JSON.stringify([accountId, id, limit]);
      return pageCursor(scope, token, { providerCursor: null, seen: new Set() }, async state => {
        const result = await collections(account, COLLECTION_TTL);
        const collection = requireObservation(result).find(entry => entry.id === id && entry.selectable);
        if (!collection) throw clientError('MAIL_CLIENT_MAILBOX_NOT_FOUND', 404);
        const key = 'page:' + digest(JSON.stringify([id, state.providerCursor, limit]));
        const observed = await observe(account, key, async provider => {
          const page = await provider.page(account, collection, state.providerCursor, limit);
          const rows = atCollection(page.rows, collection);
          return { ...page, rows: provider.prove ? await provider.prove(account, rows) : rows };
        });
        const page = requireObservation(observed);
        const seen = new Set(state.seen);
        const rows = page.rows.filter(row => {
          const key = locationKey(row.locator);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        const confirmed = rows.filter(row => !row.detailError);
        const ids = cache.saveMessages(account.id, confirmed, observed.source.fetchedAt);
        let index = 0;
        const messages = rows.map(row => item(account, row, row.detailError ? null : ids[index++], observed.source, row.detailError));
        return {
          messages, source: observed.source,
          incomplete: observed.source.status !== 'fresh' || messages.some(message => message.detailError),
          nextCursor: page.next === null ? null : issue(scope, { providerCursor: page.next, seen }),
        };
      });
    },

    async inbox(token, limit) {
      const accounts = agentStore.listAccounts();
      const scope = 'inbox:' + JSON.stringify([limit, accounts.map(account => [
        account.id, account.provider, account.address, account.status === 'disabled',
      ])]);
      const initial = {
        upper: (Math.floor(now() / DAY) + 1) * DAY, anchors: {}, sources: {}, buffered: [],
        seen: new Set(), excluded: new Set(), incomplete: false,
      };
      return pageCursor(scope, token, initial, state => readInbox(scope, accounts, limit, state));
    },

    async detail(id) {
      const cached = cache.getMessage(id);
      if (!cached) throw clientError('MAIL_CLIENT_MESSAGE_NOT_FOUND', 404);
      const account = accountFor(cached.accountId);
      const { raw, row } = await adapter(account).open(account, cached);
      row.locator.inbox = cached.locator.inbox;
      const detail = await parseClientMessage(raw, row.metadata);
      const fetchedAt = now();
      cache.saveMessages(account.id, [row], fetchedAt);
      return {
        ...item(account, row, id, observation(account, 'fresh', fetchedAt)),
        ...detail,
        hasAttachments: detail.attachments.some(attachment => !attachment.inline),
      };
    },

    async fromAgent(id) {
      const agent = agentStore.findMessageLocator(id);
      if (!agent) throw clientError('MAIL_CLIENT_AGENT_MESSAGE_NOT_FOUND', 404);
      const account = accountFor(agent.accountId);
      let collection = { inbox: true };
      if (account.provider !== 'gmail') {
        const result = await collections(account, COLLECTION_TTL);
        collection = requireObservation(result).find(entry => entry.inbox && entry.selectable);
        if (!collection) throw clientError('MAIL_CLIENT_INBOX_UNAVAILABLE', 503);
      }
      const row = await adapter(account).fromAgent(account, agent, collection);
      row.locator.inbox = true;
      if (!matchesAgent(agent, account, row)) throw clientError('MAIL_CLIENT_LOCATION_STALE', 409);
      const [clientId] = cache.saveMessages(account.id, [row], now());
      if (!cache.bindAgent(id, clientId, account.id, row)) throw clientError('MAIL_CLIENT_LOCATION_STALE', 409);
      return { id: clientId, accountId: account.id, provider: account.provider, agentMessageId: id };
    },

    fromAttention(id) {
      const attention = agentStore.findAttentionById(id);
      if (!attention) throw clientError('MAIL_CLIENT_ATTENTION_NOT_FOUND', 404);
      return this.fromAgent(attention.mailMessageId);
    },
  };
}

module.exports = { createMailClient };
