'use strict';

const { buildMessageIdentity } = require('./agent');
const { createImapFlowClient } = require('./naver');
const { sha256 } = require('../content-hash');
const { addresses, clientError, digest, epoch, headerMessageId, MAX_SOURCE_BYTES } = require('./client-message');

const META = {
  uid: true, envelope: true, internalDate: true, size: true, flags: true, bodyStructure: true, threadId: true,
  headers: ['message-id', 'in-reply-to', 'references'],
};
const PEEK = { ...META, source: { start: 0, maxLength: MAX_SOURCE_BYTES + 1 } };
const UID_WINDOW = 512;
const DAY = 86400;
const TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 };

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
    specialUse: folder.specialUse || null,
    inbox: folder.path.toUpperCase() === 'INBOX' || folder.specialUse?.toLowerCase() === '\\inbox',
    selectable: !flags.some(flag => /^\\(noselect|nonexistent)$/i.test(flag)),
  };
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

function createImapMailClient({ credentialsFor, createClient = createImapFlowClient }) {
  async function connect(account, run) {
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
      if (error?.code?.startsWith('MAIL_CLIENT_')) throw error;
      throw clientError(error?.authenticationFailed ? 'MAIL_CLIENT_AUTH_REQUIRED' : 'MAIL_CLIENT_PROVIDER_UNAVAILABLE', 503);
    } finally {
      if (client.usable !== false) await client.logout().catch(() => {});
      else client.close?.();
    }
  }

  function examine(account, path, run) {
    return connect(account, async client => {
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

  async function readVerified(account, path, client, box, candidate) {
    if (validity(box.uidValidity) !== candidate.locator.uidValidity) throw stale();
    const row = await client.fetchOne(candidate.locator.uid, PEEK, { uid: true });
    if (!row) throw stale();
    const raw = fullSource(row);
    const current = normalize(account, path, validity(box.uidValidity), row, raw);
    if (!matchesObservation(candidate, current)) throw stale();
    current.locator.inbox = candidate.locator.inbox;
    return { raw, row: current };
  }

  return {
    listCollections: account => connect(account, async client => (await client.list()).map(folderProperties)),

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

    inboxRange(account, collection, { from, to, maximum, anchor: previous }) {
      const { path } = collection;
      return examine(account, path, async (client, box) => {
        const anchor = previous || await freezeAnchor(client, box);
        checkAnchor(box, anchor);
        if (!anchor.high) return { rows: [], earlier: false, anchor };
        const uid = '1:' + anchor.high;
        // IMAP SEARCH compares dates without timezone. Widen the server predicate then filter exact UTC seconds.
        const ids = await client.search({
          uid, since: new Date(Math.max(0, from - DAY) * 1000), before: new Date((to + DAY) * 1000),
        }, { uid: true });
        if (!Array.isArray(ids)) throw clientError('MAIL_CLIENT_PROVIDER_RESPONSE');
        const unique = [...new Set(ids)].filter(id => id > 0 && id <= anchor.high);
        const candidateDates = [];
        for (let i = 0; i < unique.length; i += 150) {
          for await (const entry of client.fetch(unique.slice(i, i + 150).join(','), {
            uid: true, internalDate: true,
          }, { uid: true })) {
            const receivedAt = epoch(entry.internalDate);
            if (receivedAt >= from && receivedAt < to) candidateDates.push(entry.uid);
          }
          if (candidateDates.length > maximum) return { dense: true };
        }
        const rows = await metadataRows(account, path, client, anchor.validity, candidateDates);
        const earlier = from > 0 ? await client.search({
          uid, before: new Date((from + DAY) * 1000),
        }, { uid: true, returnOptions: ['COUNT'] }) : { count: 0 };
        if (!Array.isArray(earlier) && !Number.isSafeInteger(earlier?.count)) {
          throw clientError('MAIL_CLIENT_PROVIDER_RESPONSE');
        }
        return {
          rows: rows.filter(row => row.metadata.receivedAt >= from && row.metadata.receivedAt < to),
          earlier: Array.isArray(earlier) ? Boolean(earlier.length) : earlier.count > 0,
          anchor,
        };
      });
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

    open(account, candidate) {
      if (!candidate.locator.uidValidity && !candidate.locator.rawProof) throw stale();
      return examine(account, candidate.locator.path,
        (client, box) => readVerified(account, candidate.locator.path, client, box, candidate));
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

module.exports = { createImapMailClient };
