'use strict';

const { randomUUID } = require('node:crypto');
const { createMailClientCache, locationKey } = require('./client-cache');
const { clientError, digest, parseClientMessage, readClientAttachment, readClientInlineImage } = require('./client-message');
const { matchesSearch, searchOptions } = require('./client-search');
const { createUnifiedReader, roleCollection, UNIFIED_ROLES } = require('./client-unified');

const DAY = 86400;
const CURSOR_TTL = 600;
const COLLECTION_TTL = 300;
const SEARCH_BATCHES_PER_PAGE = 3;

const compareCandidates = (a, b) => b.row.metadata.receivedAt - a.row.metadata.receivedAt
  || a.account.id - b.account.id
  || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

function createMailClient({ db, agentStore, providers, credentialVersion, smartEnabled = false, now = () => Math.floor(Date.now() / 1000) }) {
  const cache = createMailClientCache(db);
  const cursors = new Map();
  let generation = 0;

  function assertGeneration(version) {
    if (version !== generation) throw clientError('MAIL_CLIENT_CURSOR_INVALID', 409);
  }

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
    const currentPage = async state => {
      const version = generation;
      const result = await read(state, version);
      assertGeneration(version);
      return result;
    };
    // A write confirmed during the first read changes nothing the caller has seen yet, so read once more.
    if (!token) {
      return currentPage(start).catch(error => (
        error?.code === 'MAIL_CLIENT_CURSOR_INVALID' ? currentPage(start) : Promise.reject(error)));
    }
    const slot = cursors.get(token);
    if (!slot || slot.scope !== scope || slot.expiresAt <= now()) throw clientError('MAIL_CLIENT_CURSOR_INVALID', 409);
    if (!slot.response) slot.response = currentPage(slot.state).catch(error => {
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
    const version = generation;
    const messageList = key !== 'collections';
    const previous = cache.readObservation(account.id, key);
    if (maxAge && previous && account.status !== 'disabled' && now() - previous.fetchedAt < maxAge) {
      return { value: previous.value, source: observation(account, 'fresh', previous.fetchedAt) };
    }
    try {
      const value = await read(adapter(account));
      if (messageList) assertGeneration(version);
      const fetchedAt = now();
      if (!value.dense) cache.saveObservation(account.id, key, value, fetchedAt);
      return { value, source: observation(account, 'fresh', fetchedAt) };
    } catch (error) {
      if (messageList) assertGeneration(version);
      if (error?.statusCode == null) throw error;
      const failure = { code: error.code, statusCode: error.statusCode };
      if (previous && !['MAIL_CLIENT_ACCOUNT_DISABLED', 'MAIL_CLIENT_ACCOUNT_MISMATCH'].includes(error.code)) {
        return { value: previous.value, source: observation(account, 'stale', previous.fetchedAt, failure) };
      }
      return { value: null, source: observation(account, 'unavailable', null, failure) };
    }
  }

  async function collections(account, maxAge = 0) {
    return observe(account, 'collections',
      provider => provider.listCollections(account, { analysis: smartEnabled }), maxAge);
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
    const gmail = account.provider === 'gmail';
    // Existing v45 observations stored IMAP \Flagged in important.
    const starred = row.metadata.starred
      ?? (gmail ? row.metadata.labelIds?.includes('STARRED') : row.metadata.important) ?? false;
    return {
      id,
      accountId: account.id,
      provider: account.provider,
      folderPath: row.locator.path ?? null,
      providerMessageId: row.locator.messageId ?? null,
      ...row.metadata,
      starred,
      important: gmail ? row.metadata.important : null,
      fetchedAt: source.fetchedAt,
      stale: source.status === 'stale',
      agentMessageId: id === null || source.status === 'stale' ? null : agentLink(account, row, id),
      ...(error ? { detailError: error } : {}),
    };
  }

  function atCollection(rows, collection) {
    return rows.map(row => ({ ...row, locator: { ...row.locator, inbox: Boolean(collection.inbox),
      ...(typeof collection.analysisEligible === 'boolean' ? { analysisMailboxEligible: collection.analysisEligible } : {}),
    } }));
  }

  // `proven` rows come from a stream that already did the per-row raw proof in its own session.
  async function materialize(account, rows, source, version, proven = false) {
    if (!rows.length) return [];
    if (source.status === 'stale' && rows[0].locator.path && !rows[0].locator.uidValidity) {
      return rows.map(row => {
        const id = cache.findPreviouslyVerified(account.id, row);
        return item(account, row, id, source, id === null ? 'MAIL_CLIENT_LOCATION_UNVERIFIED' : null);
      });
    }
    let checked = rows;
    try {
      const provider = adapter(account);
      if (!proven && provider.prove) checked = await provider.prove(account, rows);
    } catch (error) {
      if (!error?.statusCode) throw error;
      return rows.map(row => item(account, row, null, source, error.code));
    }
    assertGeneration(version);
    const confirmed = checked.filter(row => !row.detailError);
    const ids = cache.saveMessages(account.id, confirmed, source.fetchedAt);
    let index = 0;
    return checked.map(row => item(account, row, row.detailError ? null : ids[index++], source, row.detailError));
  }

  const readUnified = createUnifiedReader({
    cache, now, adapter, collections, requireObservation, atCollection, observation, assertGeneration, materialize, issue,
  });

  async function openSource(id, expectedAccountId, options) {
    const cached = cache.getMessage(id);
    if (!cached || (expectedAccountId != null && cached.accountId !== expectedAccountId)) {
      throw clientError('MAIL_CLIENT_MESSAGE_NOT_FOUND', 404);
    }
    const account = accountFor(cached.accountId);
    const version = credentialVersion?.(account);
    const result = await adapter(account).open(account, cached, options);
    if (credentialVersion && (credentialVersion(account) !== version || agentStore.getAccount(account.id)?.status === 'disabled')) {
      throw clientError('MAIL_CLIENT_ACCOUNT_CHANGED', 409);
    }
    return { account, cached, ...result };
  }

  async function searchStreams(accounts, params, sources) {
    return (await Promise.all(accounts.map(async account => {
      const found = await collections(account);
      sources.set(account.id, found.source);
      if (!found.value) return [];
      const selectable = found.value.filter(box => box.selectable);
      let mailboxes;
      if (params.mailbox) {
        const target = selectable.find(box => box.id === params.mailbox);
        if (!target) throw clientError('MAIL_CLIENT_MAILBOX_NOT_FOUND', 404);
        mailboxes = [target];
      } else if (params.role) {
        const target = roleCollection(account, selectable, params.role);
        if (target) mailboxes = [].concat(target);
        else {
          mailboxes = [];
          sources.set(account.id, observation(account, 'unavailable', null,
            { code: 'MAIL_CLIENT_MAILBOX_UNAVAILABLE', statusCode: 503 }));
        }
      } else if (params.inbox) {
        mailboxes = selectable.filter(box => box.inbox);
        if (!mailboxes.length) sources.set(account.id, observation(account, 'unavailable', null,
          { code: 'MAIL_CLIENT_INBOX_UNAVAILABLE', statusCode: 503 }));
      } else if (account.provider === 'gmail') {
        mailboxes = selectable.filter(box => box.kind === 'all');
      } else {
        mailboxes = selectable.filter(box => !/^\\(?:drafts|trash|junk|spam)$/i.test(box.specialUse));
      }
      return mailboxes.map(collection => ({ account, collection, cursor: null, done: false, buffer: [] }));
    }))).flat();
  }

  async function readSearch(scope, accounts, limit, start, version) {
    const { params } = start;
    const seen = new Set(start.seen);
    const sources = new Map(start.sources);
    const streams = start.streams ? start.streams.map(stream => ({ ...stream, buffer: [...stream.buffer] }))
      : await searchStreams(accounts, params, sources);
    const page = [];
    let batches = 0;
    while (page.length < limit) {
      const pending = streams.filter(stream => !stream.done && !stream.buffer.length);
      if (pending.length && batches < SEARCH_BATCHES_PER_PAGE) {
        batches += 1;
        // Run across accounts in parallel, keeping IMAP mailbox operations serial per account.
        await Promise.all(accounts.map(async account => {
          for (const stream of pending.filter(entry => entry.account.id === account.id)) {
            try {
              const result = await adapter(account).search(account, stream.collection, stream.cursor, Math.max(limit, 20), params);
              const source = observation(account, 'fresh', now());
              stream.buffer = atCollection(result.rows, stream.collection)
                .filter(row => matchesSearch(row.metadata, params))
                .map(row => ({ account, row, source, key: account.id + ':' + locationKey(row.locator) }))
                .sort(compareCandidates);
              stream.cursor = result.next;
              stream.done = result.next === null;
            } catch (error) {
              if (error?.statusCode == null) throw error;
              sources.set(account.id, observation(account, 'unavailable', null, { code: error.code, statusCode: error.statusCode }));
              stream.done = true;
            }
          }
        }));
        assertGeneration(version);
      }
      const available = streams.filter(stream => stream.buffer.length);
      if (!available.length) {
        if (batches < SEARCH_BATCHES_PER_PAGE && streams.some(stream => !stream.done)) continue;
        break;
      }
      const stream = available.reduce((first, entry) => compareCandidates(entry.buffer[0], first.buffer[0]) < 0 ? entry : first);
      const candidate = stream.buffer.shift();
      if (!seen.has(candidate.key)) {
        seen.add(candidate.key);
        page.push({ candidate, stream });
      }
    }

    const messages = [];
    const materializeGroups = new Map();
    for (const [index, { candidate, stream }] of page.entries()) {
      if (!materializeGroups.has(stream)) materializeGroups.set(stream, []);
      materializeGroups.get(stream).push({ ...candidate, index });
    }
    await Promise.all(accounts.map(async account => {
      for (const [stream, group] of materializeGroups) {
        if (stream.account.id !== account.id) continue;
        const items = await materialize(account, group.map(entry => entry.row), group[0].source, version);
        group.forEach(({ index }, i) => { messages[index] = items[i]; });
      }
    }));
    assertGeneration(version);
    const next = streams.some(stream => !stream.done || stream.buffer.length);
    const remaining = new Set(streams.flatMap(stream => stream.buffer.map(entry => entry.key)).filter(key => !seen.has(key)));
    const pageSources = accounts.map(({ id }) => sources.get(id));
    return {
      messages, sources: pageSources, coverage: 'provider_mailboxes',
      incomplete: pageSources.some(source => source.status !== 'fresh') || messages.some(message => message.detailError),
      total: seen.size + remaining.size,
      nextCursor: next ? issue(scope, { params, streams, sources, seen }) : null,
    };
  }

  async function unifiedPage(role, token, limit, accountId = null) {
    if (!UNIFIED_ROLES.includes(role)) throw clientError('MAIL_CLIENT_INVALID_REQUEST', 400);
    const accounts = accountId == null ? agentStore.listAccounts().filter(account => account.status !== 'disabled')
      : [accountFor(accountId)];
    const scope = 'unified:' + JSON.stringify([role, limit, accounts.map(account => [account.id, account.provider, account.address])]);
    const initial = {
      upper: (Math.floor(now() / DAY) + 1) * DAY, carry: {}, anchors: {}, sources: {},
      seen: new Set(), excluded: new Set(), incomplete: false,
    };
    return pageCursor(scope, token, initial, (state, version) => readUnified(role, scope, accounts, limit, state, version));
  }

  return {
    openSource,
    async openAnalysisSource(id) {
      const source = await openSource(id, null, { analysis: true });
      const { account, row, cached } = source;
      const agent = cached.agentMessageId ? agentStore.findMessageLocator(cached.agentMessageId) : null;
      return { ...source, agentMessageId: matchesAgent(agent, account, row) ? agent.id : null };
    },
    invalidateCursors() {
      generation += 1;
      cursors.clear();
    },
    accounts() {
      return agentStore.listAccounts().map(({ id, provider, address, status }) => ({ id, provider, address, status }));
    },

    async mailboxes(accountId) {
      const account = accountFor(accountId);
      const result = await collections(account);
      const mailboxes = requireObservation(result).map(({ analysisEligible, ...mailbox }) => mailbox);
      return { mailboxes, source: result.source };
    },

    async mailbox(accountId, id, token, limit) {
      const account = accountFor(accountId);
      const scope = 'mailbox:' + JSON.stringify([accountId, id, limit]);
      return pageCursor(scope, token, { providerCursor: null, seen: new Set() }, async (state, version) => {
        const result = await collections(account, COLLECTION_TTL);
        assertGeneration(version);
        const collection = requireObservation(result).find(entry => entry.id === id && entry.selectable);
        if (!collection) throw clientError('MAIL_CLIENT_MAILBOX_NOT_FOUND', 404);
        const key = 'page:' + digest(JSON.stringify([id, state.providerCursor, limit]));
        const observed = await observe(account, key, async provider => {
          const page = await provider.page(account, collection, state.providerCursor, limit);
          const rows = atCollection(page.rows, collection);
          return { ...page, rows: provider.prove ? await provider.prove(account, rows) : rows };
        });
        assertGeneration(version);
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

    unified: unifiedPage,

    inbox: (token, limit) => unifiedPage('inbox', token, limit),

    search(query, accountId, token, limit) {
      const accounts = accountId === null ? agentStore.listAccounts().filter(account => account.status !== 'disabled') : [accountFor(accountId)];
      const params = searchOptions(query, now());
      const scope = 'search:' + digest(JSON.stringify([query.q, query.sender, params.contactEmail, query.read, query.starred,
        query.attachments, query.period, query.from, query.until, query.inbox, query.mailbox, query.role, accountId, limit,
        accounts.map(account => [account.id, account.provider, account.address])]));
      return pageCursor(scope, token, { params, seen: [], sources: [] },
        (state, version) => readSearch(scope, accounts, limit, state, version));
    },

    async attachment(id, index) {
      const { raw } = await openSource(id);
      return readClientAttachment(raw, index);
    },

    async inlineImage(id, index) {
      const { raw } = await openSource(id);
      return readClientInlineImage(raw, index);
    },

    async detail(id, { includeThread = true } = {}) {
      const version = generation;
      const { account, cached, raw, row } = await openSource(id);
      row.locator.inbox = cached.locator.inbox;
      if (typeof cached.locator.analysisMailboxEligible === 'boolean') {
        row.locator.analysisMailboxEligible = cached.locator.analysisMailboxEligible;
      }
      const detail = await parseClientMessage(raw, row.metadata);
      if (includeThread && account.provider === 'gmail' && detail.thread.providerThreadId) {
        const related = await adapter(account).thread(detail.thread.providerThreadId, row.locator.messageId).catch(error => {
          if (error?.statusCode == null) throw error;
          return [];
        });
        if (related.length && version === generation) {
          related.sort((a, b) => a.metadata.receivedAt - b.metadata.receivedAt
            || a.locator.messageId.localeCompare(b.locator.messageId));
          const ids = cache.saveMessages(account.id, related, now());
          detail.thread.messages = related.map(({ metadata: { from, subject, receivedAt } }, index) => ({
            id: ids[index], from, subject, receivedAt,
          }));
        }
      }
      const fetchedAt = now();
      if (version === generation) cache.saveMessages(account.id, [row], fetchedAt);
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
      if (typeof collection.analysisEligible === 'boolean') row.locator.analysisMailboxEligible = collection.analysisEligible;
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
