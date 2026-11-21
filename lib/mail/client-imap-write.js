'use strict';

const { encodePath } = require('imapflow/lib/tools');
const { createImapMailConnection, folderProperties, readVerified } = require('./client-imap');
const { clientError, digest } = require('./client-message');

const outcome = (state, code, destinationUid) => ({ state, code, destinationUid });
const confirmed = (code = 'MAIL_CLIENT_WRITE_CONFIRMED', destinationUid) => outcome('confirmed', code, destinationUid);

function targetFolder(folders, action) {
  const selectable = folders.filter(folder => folder.listed !== false && folderProperties(folder).selectable);
  const role = { archive: '\\archive', trash: '\\trash' }[action.action];
  // ImapFlow may infer specialUse from a name and only display one of two conflicting roles.
  const matches = role ? selectable.filter(folder => [...(folder.flags || [])].some(flag => flag.toLowerCase() === role))
    : selectable.filter(folder => 'folder:' + folder.path === action.targetMailbox.id);
  if (matches.length !== 1) throw clientError('MAIL_CLIENT_WRITE_MAILBOX_NOT_FOUND', 409);
  return matches[0].path;
}

function copiedUid(response, originUid) {
  const section = response?.attributes?.[0]?.section;
  const [type, , source, destination] = section || [];
  if (type?.value?.toUpperCase() !== 'COPYUID' || source?.value !== String(originUid)
    || !/^[1-9]\d*$/.test(destination?.value || '')) return null;
  const uid = Number(destination.value);
  return uid <= 0xffffffff ? uid : null;
}

function protocolRejection(error, moving) {
  const code = error?.response?.attributes?.[0]?.section?.[0]?.value?.toUpperCase();
  if (['NOPERM', 'READ-ONLY', 'AUTHENTICATIONFAILED'].includes(code)) {
    return outcome('failed', 'MAIL_CLIENT_WRITE_AUTH_REQUIRED');
  }
  if (error?.responseStatus === 'BAD' || code === 'TRYCREATE' || (!moving && error?.responseStatus === 'NO')) {
    return outcome('failed', 'MAIL_CLIENT_WRITE_REJECTED');
  }
  return outcome('unknown', 'MAIL_CLIENT_WRITE_UNKNOWN');
}

async function nativeMove(client, uid, path) {
  let destinationUid = null;
  // Use only the native command. ImapFlow's messageMove() may fall back to COPY + EXPUNGE.
  try {
    const response = await client.exec('UID MOVE', [
      { type: 'SEQUENCE', value: String(uid) },
      { type: 'ATOM', value: encodePath(client, path) },
    ], { untagged: { OK: async item => { destinationUid ??= copiedUid(item, uid); } } });
    response.next();
    if (response.response?.command?.toUpperCase() !== 'OK') return outcome('unknown', 'MAIL_CLIENT_WRITE_UNKNOWN');
    return confirmed('MAIL_CLIENT_WRITE_CONFIRMED', copiedUid(response.response, uid) ?? destinationUid);
  } catch (error) {
    return protocolRejection(error, true);
  }
}

async function nativeFlag(client, uid, flag, value) {
  try {
    const response = await client.exec('UID STORE', [
      { type: 'SEQUENCE', value: String(uid) },
      { type: 'ATOM', value: value ? '+FLAGS.SILENT' : '-FLAGS.SILENT' },
      [{ type: 'ATOM', value: flag }],
    ]);
    response.next();
    if (response.response?.command?.toUpperCase() !== 'OK') return outcome('unknown', 'MAIL_CLIENT_WRITE_UNKNOWN');
  } catch (error) {
    return protocolRejection(error, false);
  }
  const current = await client.fetchOne(uid, { uid: true, flags: true }, { uid: true });
  const flags = [...(current?.flags || [])].map(item => item.toLowerCase());
  if (current?.uid !== uid || !current.flags || flags.includes(flag.toLowerCase()) !== value) {
    return outcome('unknown', 'MAIL_CLIENT_WRITE_UNKNOWN');
  }
  return confirmed();
}

function createImapMailWriter(options) {
  const connect = createImapMailConnection(options);
  return {
    async apply(account, message, action, hooks) {
      const { path, uid, uidValidity, rawProof } = message.locator;
      if (!path || !Number.isSafeInteger(uid) || uid < 1 || (!uidValidity && !rawProof)) {
        throw clientError('MAIL_CLIENT_LOCATION_STALE', 409);
      }
      return connect(account, async client => {
        const moving = ['archive', 'move', 'trash'].includes(action.action);
        if (moving && !client.capabilities.has('MOVE')) throw clientError('MAIL_CLIENT_MOVE_UNSUPPORTED', 409);
        const destination = moving ? targetFolder(await client.list(), action) : null;
        const lock = await client.getMailboxLock(path, { readOnly: false });
        try {
          if (client.mailbox?.readOnly) throw clientError('MAIL_CLIENT_WRITE_AUTH_REQUIRED', 503);
          const { raw, row } = await readVerified(account, path, client, client.mailbox || {}, message);
          const sourceKey = { mailboxKey: digest(path), messageKey: String(uid), contentKey: digest(raw) };
          const destinationKey = moving && path !== destination ? digest(destination) : null;
          if (!hooks.prepare(sourceKey, destinationKey)) return confirmed('MAIL_CLIENT_MANUAL_UNREAD_PRESERVED');
          if (moving) {
            if (!destinationKey) return confirmed('MAIL_CLIENT_ALREADY_SET');
            hooks.dispatch();
            return await nativeMove(client, uid, destination);
          }
          const read = action.action === 'set_read';
          if ((read ? row.metadata.read : row.metadata.starred) === action.value) {
            return confirmed('MAIL_CLIENT_ALREADY_SET');
          }
          hooks.dispatch();
          return await nativeFlag(client, uid, read ? '\\Seen' : '\\Flagged', action.value);
        } finally {
          lock.release();
        }
      });
    },
  };
}

module.exports = { createImapMailWriter, nativeMove };
