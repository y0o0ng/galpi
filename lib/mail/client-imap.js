'use strict';

const { buildMessageIdentity } = require('./agent');
const { createImapFlowClient } = require('./naver');
const { sha256 } = require('../content-hash');
const { locationKey } = require('./client-cache');
const { addresses, clientError, digest, epoch, headerMessageId, MAX_SOURCE_BYTES } = require('./client-message');

const META = {
  uid: true, envelope: true, internalDate: true, size: true, flags: true, bodyStructure: true, threadId: true,
  headers: ['message-id', 'in-reply-to', 'references'],
};
const PEEK = { ...META, source: { start: 0, maxLength: MAX_SOURCE_BYTES + 1 } };
const UID_WINDOW = 512;
const PEEK_BATCH = 10;
const META_BATCH = 50;
const DAY = 86400;
const TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 };
const SEARCH_EXCLUDED_ROLE = /^\\(?:drafts|trash|junk|spam)$/i;

function validity(value) {
  const text = String(value ?? '');
  return /^\d+$/.test(text) && text !== '0' ? text : null;
}

function folderProperties(folder) {
  const flags = [...(folder.flags || [])];
  return {
    id: 'folder:' + folder.path,
    kind: 'folder',
    path: folder.path,
    name: folder.name || folder.path,
    delimiter: folder.delimiter || null,
    specialUse: folder.specialUse || flags.find(flag => SEARCH_EXCLUDED_ROLE.test(flag)) || null,
    inbox: folder.path.toUpperCase() === 'INBOX' || folder.specialUse?.toLowerCase() === '\\inbox',
    selectable: !flags.some(flag => /^\\(noselect|nonexistent)$/i.test(flag)),
  };
}

function analysisMailboxes(list) {
  const folders = list.filter(folder => folder.listed !== false && folderProperties(folder).selectable).map(folder => ({
    path: folder.path,
    roles: new Set([...(folder.flags || []), ...(folder.specialUseSource === 'extension' ? [folder.specialUse] : [])]
      .filter(Boolean).map(value => value.toLowerCase())),
  }));
  const blocked = ['\\sent', '\\drafts', '\\trash', '\\junk', '\\spam'];
  const standardRoles = blocked.slice(0, 3).map(role => folders.filter(folder => folder.roles.has(role)));
  standardRoles.push(folders.filter(folder => folder.roles.has('\\junk') || folder.roles.has('\\spam')));
  const complete = standardRoles.every(matches => matches.length === 1)
    && new Set(standardRoles.map(matches => matches[0].path)).size === standardRoles.length;
  const codes = new Map();
  for (const { path, roles } of folders) {
    if (codes.has(path)) codes.set(path, 'MAIL_CLIENT_SMART_MAILBOX_UNVERIFIED');
    else if (blocked.some(role => roles.has(role))) codes.set(path, 'MAIL_CLIENT_SMART_INELIGIBLE');
    else if ([...roles].some(role => /^\\(?:all|flagged|important)$/u.test(role))) {
      codes.set(path, 'MAIL_CLIENT_SMART_MAILBOX_UNVERIFIED');
    } else {
      const received = path.toUpperCase() === 'INBOX' || roles.has('\\inbox') || roles.has('\\archive');
      codes.set(path, received || complete ? null : 'MAIL_CLIENT_SMART_MAILBOX_UNVERIFIED');
    }
  }
  return codes;
}

function header(row, name) {
  const value = row.headers?.toString('latin1').replace(/\r?\n[ \t]+/g, ' ');
  return value?.match(new RegExp('^' + name + ':[ \\t]*(.*)$', 'im'))?.[1].trim() || null;
}

function attachmentState(part) {
  if (!part) return null;
  return part.disposition?.toLowerCase() === 'attachment'
    || Boolean(part.parameters?.name && part.disposition?.toLowerCase() !== 'inline')
    || (part.childNodes || []).some(child => attachmentState(child) === true);
}

function identityFor(account, row, raw) {
  const envelope = row.envelope || {};
  const messageId = envelope.messageId || header(row, 'message-id');
  if (!messageId && !raw) return null;
  return buildMessageIdentity({
    provider: account.provider,
    messageId,
    from: envelope.from?.[0]?.address,
    to: addresses(envelope.to).map(entry => entry.address),
    subject: envelope.subject,
    receivedAt: epoch(envelope.date),
    references: header(row, 'references'),
    inReplyTo: envelope.inReplyTo || header(row, 'in-reply-to'),
    rawDigest: !messageId ? sha256(raw.toString('latin1')) : null,
  });
}

function normalize(account, path, uidValidity, row, raw) {
  const envelope = row.envelope || {};
  const flags = new Set([...(row.flags || [])].map(flag => flag.toLowerCase()));
  const receivedAt = epoch(row.internalDate);
  if (!Number.isSafeInteger(row.uid) || row.uid <= 0 || receivedAt === null || !Number.isSafeInteger(row.size)) {
    throw clientError('MAIL_CLIENT_PROVIDER_RESPONSE');
  }
  const metadata = {
    threadId: row.threadId || null,
    subject: envelope.subject || '',
    from: addresses(envelope.from),
    to: addresses(envelope.to),
    cc: addresses(envelope.cc),
    sentAt: epoch(envelope.date),
    receivedAt,
    read: flags.has('\\seen'),
    starred: flags.has('\\flagged'),
    important: null,
    hasAttachments: attachmentState(row.bodyStructure),
    rfcMessageId: headerMessageId(envelope.messageId || header(row, 'message-id')),
    labelIds: [],
  };
  const metaProof = digest(JSON.stringify([
    row.size, metadata.receivedAt, metadata.sentAt, metadata.subject, metadata.rfcMessageId,
    metadata.from, metadata.to, metadata.cc, header(row, 'references'), header(row, 'in-reply-to'),
  ]));
  return {
    locator: {
      path, uid: row.uid, uidValidity, metaProof, rawProof: raw && !uidValidity ? digest(raw) : null,
      agentIdentity: identityFor(account, row, raw),
    },
    proof: raw && !uidValidity ? digest(JSON.stringify([metaProof, digest(raw)])) : uidValidity + ':' + metaProof,
    metadata,
  };
}

function fullSource(row) {
  if (row.size > MAX_SOURCE_BYTES || row.source?.length > MAX_SOURCE_BYTES) {
    throw clientError('MAIL_CLIENT_SOURCE_TOO_LARGE', 413);
  }
  if (!Buffer.isBuffer(row.source) || row.source.length !== row.size || !row.source.length) {
    throw clientError('MAIL_CLIENT_SOURCE_UNAVAILABLE', 503);
  }
  return row.source;
}

// One FETCH row becomes a proven row: with no usable UIDVALIDITY the raw source hash is taken in the same session.
function provenRow(account, path, uidValidity, row) {
  if (uidValidity) return normalize(account, path, uidValidity, row);
  try {
    return normalize(account, path, null, row, fullSource(row));
  } catch (error) {
    if (!error?.statusCode) throw error;
    return { ...normalize(account, path, null, row), detailError: error.code };
  }
}

function stale() {
  return clientError('MAIL_CLIENT_LOCATION_STALE', 409);
}

function checkAnchor(box, anchor) {
  if (anchor && (validity(box.uidValidity) !== anchor.validity
    || (Number(box.uidNext) > 0 && Number(box.uidNext) <= anchor.high))) throw stale();
}

function matchesObservation(candidate, current) {
  return candidate.locator.uid === current.locator.uid
    && candidate.locator.uidValidity === current.locator.uidValidity
    && candidate.locator.metaProof === current.locator.metaProof
    && (!candidate.locator.rawProof || candidate.locator.rawProof === current.locator.rawProof);
}

function createImapMailConnection({ credentialsFor, createClient = createImapFlowClient, credentialVersion, onAuthRequired }) {
  return async function connect(account, run) {
    const version = credentialVersion?.(account);
    const credentials = credentialsFor(account);
    if (!credentials?.user || !credentials.pass) throw clientError('MAIL_CLIENT_AUTH_REQUIRED', 503);
    let address = String(credentials.user).trim().toLowerCase();
    if (account.provider === 'naver' && !address.includes('@')) address += '@naver.com';
    if (address !== account.address.toLowerCase()) throw clientError('MAIL_CLIENT_ACCOUNT_MISMATCH', 503);
    const client = createClient(credentials, TIMEOUTS);
    try {
      await client.connect();
      return await run(client);
    } catch (error) {
      if (error?.authenticationFailed) onAuthRequired?.(account, version);
      if (error?.code?.startsWith('MAIL_CLIENT_')) throw error;
      throw clientError(error?.authenticationFailed ? 'MAIL_CLIENT_AUTH_REQUIRED' : 'MAIL_CLIENT_PROVIDER_UNAVAILABLE', 503);
    } finally {
      if (client.usable !== false) await client.logout().catch(() => {});
      else client.close?.();
    }
  };
}

async function readVerified(account, path, client, box, candidate, { analysis = false } = {}) {
  if (validity(box.uidValidity) !== candidate.locator.uidValidity) throw stale();
  const row = await client.fetchOne(candidate.locator.uid, PEEK, { uid: true });
  if (!row) throw stale();
  const raw = fullSource(row);
  const current = normalize(account, path, validity(box.uidValidity), row, raw);
  if (!matchesObservation(candidate, current)) throw stale();
  if (analysis && [...(row.flags || [])].some(flag => /^\\(?:draft|deleted)$/i.test(flag))) {
    throw clientError('MAIL_CLIENT_SMART_INELIGIBLE', 422);
  }
  current.locator.inbox = candidate.locator.inbox;
  if (typeof candidate.locator.analysisMailboxEligible === 'boolean') {
    current.locator.analysisMailboxEligible = candidate.locator.analysisMailboxEligible;
  }
  return { raw, row: current };
}

function createImapMailClient(options) {
  const connect = createImapMailConnection(options);

  function examine(account, path, run, { analysis = false } = {}) {
    return connect(account, async client => {
      if (analysis) {
        const codes = analysisMailboxes(await client.list());
        if (!codes.has(path)) throw stale();
        const code = codes.get(path);
        if (code) throw clientError(code, 422);
      }
      const lock = await client.getMailboxLock(path, { readOnly: true });
      try {
        return await run(client, client.mailbox || {});
      } finally {
        lock.release();
      }
    });
  }

  async function freezeAnchor(client, box) {
    const high = Number(box.uidNext) > 0
      ? Number(box.uidNext) - 1
      : box.exists ? (await client.fetchOne('*', { uid: true }))?.uid : 0;
    if (!Number.isSafeInteger(high) || high < 0) throw clientError('MAIL_CLIENT_PROVIDER_RESPONSE');
    return { high, validity: validity(box.uidValidity) };
  }

  async function metadataRows(account, path, client, uidValidity, ids) {
    const rows = [];
    for (let i = 0; i < ids.length; i += 50) {
      const batch = new Set(ids.slice(i, i + 50));
      for await (const row of client.fetch([...batch].join(','), META, { uid: true })) {
        if (batch.has(row.uid)) rows.push(normalize(account, path, uidValidity, row));
      }
    }
    return rows;
  }

  return {
    listCollections: (account, { analysis = false } = {}) => connect(account, async client => {
      const folders = await client.list();
      const codes = analysis ? analysisMailboxes(folders) : null;
      return folders.map(folder => ({
        ...folderProperties(folder),
        ...(codes ? { analysisEligible: codes.get(folder.path) === null } : {}),
      }));
    }),

    page(account, collection, cursor, limit) {
      const { path } = collection;
      return examine(account, path, async (client, box) => {
        const anchor = cursor?.anchor || await freezeAnchor(client, box);
        checkAnchor(box, anchor);
        let high = cursor ? cursor.before - 1 : anchor.high;
        const ids = [];
        for (let chunks = 0; high > 0 && ids.length < limit && chunks < 4; chunks += 1) {
          const low = Math.max(1, high - UID_WINDOW + 1);
          const found = await client.search({ uid: low + ':' + high }, { uid: true });
          if (!Array.isArray(found)) throw clientError('MAIL_CLIENT_PROVIDER_RESPONSE');
          const portion = [...new Set(found)].filter(uid => uid >= low && uid <= high).sort((a, b) => b - a);
          const take = portion.slice(0, limit - ids.length);
          ids.push(...take);
          high = portion.length > take.length ? take.at(-1) - 1 : low - 1;
        }
        const rows = await metadataRows(account, path, client, anchor.validity, ids);
        return {
          rows: rows.sort((a, b) => b.locator.uid - a.locator.uid),
          next: high > 0 ? { before: high + 1, anchor } : null,
        };
      });
    },

    search(account, collection, cursor, limit, params) {
      const { path, specialUse } = collection;
      return examine(account, path, async (client, box) => {
        const anchor = cursor?.anchor || await freezeAnchor(client, box);
        checkAnchor(box, anchor);
        const high = cursor ? cursor.before - 1 : anchor.high;
        if (!high) return { rows: [], next: null };
        const predicates = { uid: '1:' + high };
        if (!(params.mailbox || params.role) || !SEARCH_EXCLUDED_ROLE.test(specialUse)) Object.assign(predicates, { draft: false, deleted: false });
        if (params.q) predicates.or = [{ subject: params.q }, { from: params.q }, { to: params.q }];
        if (params.contactEmail) predicates.or = [{ from: params.contactEmail }, { to: params.contactEmail }];
        if (params.sender) predicates.from = params.sender;
        if (params.read) predicates.seen = params.read === 'read';
        if (params.starred) predicates.flagged = true;
        // IMAP dates are day-level. Filter the returned timestamps against the exact KST-derived boundaries.
        if (params.from !== null) predicates.since = new Date((params.from - DAY) * 1000);
        if (params.until !== null) predicates.before = new Date((params.until + DAY) * 1000);
        const found = await client.search(predicates, { uid: true });
        if (!Array.isArray(found)) throw clientError('MAIL_CLIENT_PROVIDER_RESPONSE');
        const ids = [...new Set(found)].filter(uid => Number.isSafeInteger(uid) && uid > 0 && uid <= high)
          .sort((a, b) => b - a).slice(0, limit + 1);
        const take = ids.slice(0, limit);
        return {
          rows: await metadataRows(account, path, client, anchor.validity, take),
          next: ids.length > take.length ? { before: take.at(-1), anchor } : null,
        };
      });
    },

    // A per-request candidate stream over one folder. A single session (connect + EXAMINE) is held until
    // finish() has fetched the rows the page emitted, so the raw proof for an invalid UIDVALIDITY (Naver/Works
    // INBOX report 0) happens in that session instead of a second connection.
    openStream(account, collection, { anchor: pinned = null, carry = null } = {}) {
      const { path } = collection;
      const order = (a, b) => b.receivedAt - a.receivedAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
      let pending = [...(carry?.pending || [])];
      let taken = [];
      let anchor = pinned;
      let held;
      let checked = false;

      function session() {
        if (held) return held;
        let release;
        const hold = new Promise(resolve => { release = resolve; });
        let gate;
        const opened = new Promise((resolve, reject) => { gate = { resolve, reject }; });
        opened.catch(() => {});
        const done = connect(account, async client => {
          const lock = await client.getMailboxLock(path, { readOnly: true });
          try {
            gate.resolve({ client, box: client.mailbox || {} });
            await hold;
          } finally {
            lock.release();
          }
        }).catch(error => gate.reject(error));
        held = { opened, close: async () => { release(); await done; } };
        return held;
      }

      async function guarded(run) {
        try {
          return await run();
        } catch (error) {
          throw error?.code?.startsWith('MAIL_CLIENT_') ? error : clientError('MAIL_CLIENT_PROVIDER_UNAVAILABLE', 503);
        }
      }

      async function ready() {
        const { client, box } = await session().opened;
        if (pinned && !checked) checkAnchor(box, pinned);
        checked = true;
        return { client, box };
      }

      return {
        open: ({ from, to, maximum }) => guarded(async () => {
          const { client, box } = await ready();
          anchor ||= await freezeAnchor(client, box);
          checkAnchor(box, anchor);
          pending = [];
          if (!anchor.high) return { earlier: false, anchor, count: 0 };
          const uid = '1:' + anchor.high;
          // IMAP SEARCH compares dates without timezone. Widen the server predicate then filter exact UTC seconds.
          const ids = await client.search({
            uid, since: new Date(Math.max(0, from - DAY) * 1000), before: new Date((to + DAY) * 1000),
          }, { uid: true });
          if (!Array.isArray(ids)) throw clientError('MAIL_CLIENT_PROVIDER_RESPONSE');
          const unique = [...new Set(ids)].filter(id => id > 0 && id <= anchor.high);
          const found = [];
          for (let i = 0; i < unique.length; i += 150) {
            for await (const entry of client.fetch(unique.slice(i, i + 150).join(','), {
              uid: true, internalDate: true,
            }, { uid: true })) {
              const receivedAt = epoch(entry.internalDate);
              if (receivedAt >= from && receivedAt < to) found.push({ uid: entry.uid, receivedAt, key: locationKey({ path, uid: entry.uid }) });
            }
            if (found.length > maximum) return { dense: true, anchor };
          }
          const earlier = from > 0 ? await client.search({
            uid, before: new Date((from + DAY) * 1000),
          }, { uid: true, returnOptions: ['COUNT'] }) : { count: 0 };
          if (!Array.isArray(earlier) && !Number.isSafeInteger(earlier?.count)) {
            throw clientError('MAIL_CLIENT_PROVIDER_RESPONSE');
          }
          pending = found.sort(order);
          return {
            earlier: Array.isArray(earlier) ? Boolean(earlier.length) : earlier.count > 0,
            anchor, count: found.length,
          };
        }),
        async peek() {
          const head = pending[0];
          return head ? { receivedAt: head.receivedAt, locator: { path, uid: head.uid } } : null;
        },
        advance(keep = true) {
          const head = pending.shift();
          if (keep) taken.push(head);
        },
        finish() {
          const wanted = taken;
          taken = [];
          if (!wanted.length) return [];
          return guarded(async () => {
            const { client, box } = await ready();
            const uidValidity = validity(box.uidValidity);
            const rows = new Map();
            const size = uidValidity ? META_BATCH : PEEK_BATCH;
            for (let i = 0; i < wanted.length; i += size) {
              const batch = new Set(wanted.slice(i, i + size).map(entry => entry.uid));
              for await (const row of client.fetch([...batch].join(','), uidValidity ? META : PEEK, { uid: true })) {
                if (batch.has(row.uid)) rows.set(row.uid, provenRow(account, path, uidValidity, row));
              }
            }
            // A message that vanished or changed since SEARCH is left out of the page.
            return wanted.map(entry => {
              const row = rows.get(entry.uid);
              return row?.metadata.receivedAt === entry.receivedAt ? row : null;
            });
          });
        },
        carry: () => (pending.length ? { pending: [...pending] } : null),
        async close() {
          const current = held;
          held = null;
          await current?.close();
        },
      };
    },

    prove: (account, rows) => {
      if (!rows.length || rows[0].locator.uidValidity) return rows;
      const { path } = rows[0].locator;
      return examine(account, path, async (client, box) => {
        const proven = [];
      for (const row of rows) {
        try {
          proven.push((await readVerified(account, path, client, box, row)).row);
        } catch (error) {
          if (![409, 413].includes(error.statusCode)) throw error;
          proven.push({ ...row, detailError: error.code });
        }
      }
        return proven;
      });
    },

    open(account, candidate, options) {
      if (!candidate.locator.uidValidity && !candidate.locator.rawProof) throw stale();
      return examine(account, candidate.locator.path,
        (client, box) => readVerified(account, candidate.locator.path, client, box, candidate, options), options);
    },

    fromAgent(account, agent, collection) {
      const path = collection.path;
      return examine(account, path, async (client, box) => {
        const storedValidity = validity(agent.imapUidValidity);
        const liveValidity = validity(box.uidValidity);
        if (!agent.imapUid || (storedValidity && storedValidity !== liveValidity)) throw stale();
        const entry = await client.fetchOne(agent.imapUid, PEEK, { uid: true });
        if (!entry || entry.uid !== agent.imapUid) throw stale();
        const raw = fullSource(entry);
        return normalize(account, path, liveValidity, entry, raw);
      });
    },
  };
}

module.exports = { createImapMailClient, createImapMailConnection, folderProperties, readVerified };
