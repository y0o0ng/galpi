'use strict';

const { createImapMailConnection, folderProperties } = require('./client-imap');
const { nativeMove } = require('./client-imap-write');
const { clientError, digest, MAX_SOURCE_BYTES } = require('./client-message');

const WINDOW = 512;
const APPEND_VERIFY_LIMIT = 30;
const missing = () => clientError('MAIL_CLIENT_DRAFT_NOT_FOUND', 404);
const conflict = () => clientError('MAIL_CLIENT_DRAFT_CONFLICT', 409);
const unavailable = () => clientError('MAIL_CLIENT_PROVIDER_UNAVAILABLE', 503);
const unknown = { state: 'unknown', code: 'MAIL_CLIENT_DRAFT_SAVE_UNKNOWN' };

function isUid(uid) {
  return Number.isInteger(uid) && uid > 0 && uid <= 0xffffffff;
}

function validity(box) {
  const val = String(box?.uidValidity ?? '');
  return /^[1-9]\d{0,9}$/u.test(val) ? val : null;
}

function role(folders, flag, optional = false) {
  const matches = folders.filter(folder => folder.listed !== false && folderProperties(folder).selectable
    && [...(folder.flags || [])].some(value => value.toLowerCase() === flag));
  if (matches.length === 1) return matches[0].path;
  if (optional) return null;
  throw clientError('MAIL_CLIENT_DRAFT_FOLDER_UNAVAILABLE', 409);
}

function token(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decode(value) {
  try {
    const result = JSON.parse(Buffer.from(value, 'base64url').toString());
    if (!Array.isArray(result) || token(result) !== value) throw missing();
    return result;
  } catch {
    throw missing();
  }
}

function snapshot(account, path, box, row) {
  if (!row || !isUid(row.uid) || ![...(row.flags || [])].some(flag => flag.toLowerCase() === '\\draft')) throw missing();
  if (row.size > MAX_SOURCE_BYTES || row.source?.length > MAX_SOURCE_BYTES) {
    throw clientError('MAIL_CLIENT_SOURCE_TOO_LARGE', 413);
  }
  if (!Buffer.isBuffer(row.source) || !row.source.length || row.source.length !== row.size) throw unavailable();
  const proof = digest(row.source);
  const marker = row.source.subarray(0, Math.max(0, row.source.indexOf('\r\n\r\n')))
    .toString('latin1').match(/^X-Galpi-Draft-Id:[ \t]*([a-f0-9-]{36})[ \t]*\r?$/im)?.[1] ?? null;
  return {
    id: token([account.id, path, validity(box), row.uid, proof, marker]),
    uid: row.uid, raw: row.source, subject: row.envelope?.subject ?? null,
  };
}

async function fetchSnapshot(account, path, client, uid) {
  const row = await client.fetchOne(uid, {
    uid: true, flags: true, size: true, envelope: true, source: { start: 0, maxLength: MAX_SOURCE_BYTES + 1 },
  }, { uid: true });
  if (row?.uid !== uid) throw missing();
  return snapshot(account, path, client.mailbox, row);
}

async function assertSnapshot(account, path, client, id) {
  const [accountId, folder, valid, uid] = decode(id);
  if (accountId !== account.id || folder !== path || !isUid(uid)) throw missing();
  if (valid !== validity(client.mailbox)) throw conflict();
  let current;
  try {
    current = await fetchSnapshot(account, path, client, uid);
  } catch (error) {
    if (error.statusCode === 404) throw conflict();
    throw error;
  }
  if (current.id !== id) throw conflict();
  return current;
}

async function highUid(client, refresh = false) {
  const high = Number(client.mailbox?.uidNext) - 1;
  if (!refresh && (high === 0 || isUid(high))) return high;
  if (!refresh && client.mailbox?.exists === 0) return 0;
  // Last sequence number is only used to learn the highest UID, never to open a draft.
  const row = await client.fetchOne('*', { uid: true });
  if (!isUid(row?.uid)) throw unavailable();
  return row.uid;
}

function matchesNaverAppend(submitted, stored) {
  const boundary = stored.indexOf('\r\n\r\n');
  if (boundary < 0) return false;
  const headers = stored.subarray(0, boundary + 2).toString('latin1');
  const added = [...headers.matchAll(/(?:^|(?<=\r\n))X-Naver-IMAP-Append:[^\r\n]+\r\n(?![ \t])/gi)];
  if (added.length !== 1) return false;
  const [field] = added;
  const start = field.index;
  return stored.length - field[0].length === submitted.length
    && stored.subarray(0, start).equals(submitted.subarray(0, start))
    && stored.subarray(start + field[0].length).equals(submitted.subarray(start));
}

async function identifyAppend(account, path, client, minimum, response, raw, marker) {
  const naverImap = account.provider === 'naver' || account.provider === 'works';
  const valid = validity(client.mailbox);
  const known = response?.uid >= minimum && isUid(response.uid) && valid && String(response.uidValidity) === valid;
  const high = known ? response.uid : await highUid(client, true);
  const low = Math.max(minimum, high - WINDOW + 1);
  const range = low + ':' + high;
  let candidates = known ? [response.uid] : high < low ? [] : await client.search({
    uid: range, header: { 'X-Galpi-Draft-Id': marker },
  }, { uid: true });
  if (!Array.isArray(candidates)) return null;
  if (naverImap && high >= low && !candidates.length) {
    candidates = await client.search({ uid: range, draft: true }, { uid: true });
    if (!Array.isArray(candidates)) return null;
  }
  const ids = [...new Set(candidates)].filter(uid => isUid(uid) && (known || (uid >= low && uid <= high)));
  if (ids.length > APPEND_VERIFY_LIMIT) return null;
  const matches = [];
  for (const uid of ids) {
    try {
      const current = await fetchSnapshot(account, path, client, uid);
      const sameSource = current.raw.equals(raw) || (naverImap && matchesNaverAppend(raw, current.raw));
      if (sameSource && decode(current.id).at(-1) === marker) matches.push(current.id);
    } catch (error) {
      if (error.statusCode !== 404) throw error;
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function createImapDrafts(options) {
  const connect = createImapMailConnection(options);

  function withDrafts(account, readOnly, run) {
    return connect(account, async client => {
      const folders = await client.list();
      const path = role(folders, '\\drafts');
      const lock = await client.getMailboxLock(path, { readOnly });
      try {
        return await run(client, path, folders);
      } finally {
        lock.release();
      }
    });
  }

  function trashFor(client, path, folders) {
    const trash = role(folders, '\\trash', true);
    if (!client.capabilities.has('MOVE') || !trash || trash === path || client.mailbox?.readOnly) {
      throw clientError('MAIL_CLIENT_DRAFT_MOVE_UNAVAILABLE', 409);
    }
    return trash;
  }

  return account => ({
    list(cursor, limit) {
      return withDrafts(account, true, async (client, path) => {
        let high = await highUid(client);
        const valid = validity(client.mailbox);
        if (cursor) {
          const [accountId, folder, expected, before] = decode(cursor);
          if (accountId !== account.id || folder !== path || expected !== valid || !isUid(before)) throw conflict();
          high = Math.min(high, before);
        }
        const drafts = [];
        for (let windows = 0; high > 0 && drafts.length < limit && windows < 4; windows += 1) {
          const low = Math.max(1, high - WINDOW + 1);
          const found = await client.search({ uid: low + ':' + high, draft: true }, { uid: true });
          if (!Array.isArray(found)) throw unavailable();
          const ids = [...new Set(found)].filter(uid => isUid(uid) && uid >= low && uid <= high).sort((a, b) => b - a);
          for (const uid of ids) {
            high = uid - 1;
            try {
              const item = await fetchSnapshot(account, path, client, uid);
              drafts.push({ id: item.id, subject: item.subject });
            } catch (error) {
              if (error.statusCode !== 404) throw error;
            }
            if (drafts.length === limit) break;
          }
          if (drafts.length < limit) high = low - 1;
        }
        return { drafts, nextCursor: high > 0 ? token([account.id, path, valid, high]) : null };
      });
    },
    findByMessage(locator, raw) {
      return withDrafts(account, true, async (client, path) => {
        if (locator.path !== path || !isUid(locator.uid)) throw conflict();
        const draft = await fetchSnapshot(account, path, client, locator.uid);
        if (digest(draft.raw) !== digest(raw)) throw conflict();
        return draft.id;
      });
    },
    open(id) {
      return withDrafts(account, true, (client, path) => assertSnapshot(account, path, client, id));
    },
    save(raw, _thread, before, marker, onDispatch) {
      return withDrafts(account, false, async (client, path, folders) => {
        if (client.mailbox?.readOnly) throw clientError('MAIL_CLIENT_WRITE_AUTH_REQUIRED', 503);
        const limit = client.capabilities.get('APPENDLIMIT');
        if (typeof limit === 'number' && raw.length > limit) {
          throw clientError('MAIL_CLIENT_COMPOSE_TOO_LARGE', 413);
        }
        const trash = before ? trashFor(client, path, folders) : null;
        if (before) await assertSnapshot(account, path, client, before.id);
        const minimum = (await highUid(client)) + 1;
        let reply;
        onDispatch();
        try {
          reply = await client.append(path, raw, ['\\Draft']);
        } catch (error) {
          if (['BAD', 'NO'].includes(error.responseStatus) && /^\S+\s+APPEND\b/i.test(error.executedCommand || '')) {
            return { state: 'failed', code: 'MAIL_CLIENT_DRAFT_SAVE_REJECTED' };
          }
          // The server may have committed before disconnecting. Observe, never append again.
        }
        let draftId;
        try {
          draftId = await identifyAppend(account, path, client, minimum, reply, raw, marker);
        } catch {
          return unknown;
        }
        if (!draftId) return unknown;
        if (before) {
          try {
            const prior = await assertSnapshot(account, path, client, before.id);
            const removal = await nativeMove(client, prior.uid, trash);
            if (removal.state !== 'confirmed') {
              return { ...unknown, draftId, cleanup: removal.state };
            }
          } catch {
            return { ...unknown, draftId, cleanup: 'failed' };
          }
        }
        return { state: 'saved', draftId, ...(before ? { cleanup: 'confirmed' } : {}) };
      });
    },
    async cleanup(before) {
      try {
        return await withDrafts(account, false, async (client, path, folders) => {
          const trash = trashFor(client, path, folders);
          const prior = await assertSnapshot(account, path, client, before.id);
          return (await nativeMove(client, prior.uid, trash)).state;
        });
      } catch {
        return 'failed';
      }
    },
  });
}

module.exports = { createImapDrafts };
