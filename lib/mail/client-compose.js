'use strict';

const { randomUUID } = require('node:crypto');
const { createMailClientCache } = require('./client-cache');
const { addresses, clientError, digest } = require('./client-message');
const { createComposeUploads } = require('./client-compose-uploads');
const { prepareSmtp } = require('./client-compose-smtp');
const {
  MAX_ATTACHMENTS, addressList, buildMime, compose, describe, draftThread, fromDraft, header, parse, partsFor,
} = require('./client-compose-mime');

const ID = /^[A-Za-z0-9_-]{1,2000}$/u;
const REQUEST_ID = /^[A-Za-z0-9_.:-]{1,128}$/u;
const SHA = /^[a-f0-9]{64}$/u;
const KINDS = ['new', 'reply', 'reply_all', 'forward'];
const unknown = { state: 'unknown', code: 'MAIL_CLIENT_COMPOSE_UNKNOWN' };
const invalid = () => clientError('MAIL_CLIENT_COMPOSE_INVALID', 400);
const draftConflict = () => clientError('MAIL_CLIENT_DRAFT_CONFLICT', 409);

function allowed(input, fields) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !fields.includes(key))) throw invalid();
}

function version(snapshot) {
  return digest(JSON.stringify([snapshot.messageId ?? null, snapshot.threadId ?? null, digest(snapshot.raw)]));
}

function draftRef(draftId, version) {
  if (typeof draftId !== 'string' || !ID.test(draftId) || typeof version !== 'string' || !SHA.test(version)) throw invalid();
  return { draftId, version };
}

function requestId(value) {
  if (typeof value !== 'string' || !REQUEST_ID.test(value)) throw invalid();
  return value;
}

function composeInput(input, draftId) {
  allowed(input, ['kind', 'originalId', 'to', 'cc', 'bcc', 'subject', 'text', 'html', 'attachments']);
  const { kind, originalId = null, attachments = [] } = input;
  if (!KINDS.includes(kind) || (kind === 'new' ? originalId !== null : !Number.isSafeInteger(originalId) || originalId < 1)
    || typeof input.text !== 'string' || (input.html !== undefined && typeof input.html !== 'string')
    || !Array.isArray(attachments) || attachments.length > MAX_ATTACHMENTS) throw invalid();
  const refs = attachments.map(ref => {
    if (ref?.kind === 'upload') {
      allowed(ref, ['kind', 'id']);
      if (typeof ref.id !== 'string' || !ID.test(ref.id)) throw invalid();
      return { kind: ref.kind, id: ref.id };
    }
    allowed(ref, ['kind', 'index', 'proof']);
    if (!Number.isSafeInteger(ref.index) || ref.index < 0 || ref.index >= MAX_ATTACHMENTS
      || typeof ref.proof !== 'string' || !SHA.test(ref.proof)
      || (ref.kind === 'original' ? originalId === null : ref.kind !== 'draft' || !draftId)) throw invalid();
    return { kind: ref.kind, index: ref.index, proof: ref.proof };
  });
  if (new Set(refs.map(ref => ref.kind + ':' + (ref.id ?? ref.index))).size !== refs.length) throw invalid();
  const to = addressList(input.to);
  const cc = addressList(input.cc);
  if ((kind === 'reply' || kind === 'reply_all') && (to.length || cc.length)) throw invalid();
  return {
    kind, originalId, to, cc, bcc: addressList(input.bcc),
    subject: header(input.subject ?? '', 998), text: input.text, html: input.html, attachments: refs,
  };
}

function attachmentProof(rawHash, index, part) {
  return digest(JSON.stringify([rawHash, index, digest(part.content)]));
}

function describeWithProof(raw, parts) {
  const rawHash = digest(raw);
  return describe(parts).map(item => ({ ...item, proof: attachmentProof(rawHash, item.index, parts[item.index]) }));
}

function retainPart(rawHash, parts, ref) {
  const part = parts[ref.index];
  if (!part || ref.proof !== attachmentProof(rawHash, ref.index, part)) {
    throw clientError('MAIL_CLIENT_ATTACHMENT_CHANGED', 409);
  }
  return part;
}

function prepareStatements(db) {
  const get = db.prepare('SELECT * FROM mail_client_compose_receipts WHERE request_id = ?');
  const insert = db.prepare(`
    INSERT INTO mail_client_compose_receipts
      (request_id, account_id, operation, request_sha256, draft_id, draft_version, original_id, state)
    VALUES (@id, @accountId, @operation, @hash, @draftId, @draftVersion, @originalId, 'pending')
    ON CONFLICT DO NOTHING
  `);
  const finish = db.prepare(`
    UPDATE mail_client_compose_receipts SET state = ?, result_json = ?, finished_at = unixepoch()
    WHERE request_id = ?
  `);
  return { get, insert, finish };
}

function publicReceipt(row) {
  const result = row.result_json ? JSON.parse(row.result_json) : {};
  return {
    ...result,
    success: row.state === 'saved' || (row.state === 'sent' && result.delivery === 'full'),
    requestId: row.request_id, accountId: row.account_id, operation: row.operation,
    state: row.state, createdAt: row.created_at, finishedAt: row.finished_at,
  };
}

function createMailClientCompose({
  db, agentStore, mailClient, gmail, imap, credentialsFor, createTransport, uploads = createComposeUploads(),
  writeEnabled = false, sendEnabled = false,
}) {
  const cache = createMailClientCache(db);
  const statements = prepareStatements(db);
  const locks = new Map();

  function accountFor(id) {
    const account = agentStore.getAccount(id);
    if (!account) throw clientError('MAIL_CLIENT_ACCOUNT_NOT_FOUND', 404);
    if (account.status === 'disabled') throw clientError('MAIL_CLIENT_ACCOUNT_DISABLED', 503);
    if (!['gmail', 'naver', 'works'].includes(account.provider)) {
      throw clientError('MAIL_CLIENT_ACCOUNT_UNAVAILABLE', 503);
    }
    return account;
  }

  function gate(operation) {
    if (!writeEnabled) throw clientError('MAIL_CLIENT_WRITE_DISABLED', 503);
    if (operation === 'send' && !sendEnabled) throw clientError('MAIL_CLIENT_SEND_DISABLED', 503);
  }

  function provider(account) {
    return account.provider === 'gmail' ? gmail(account) : imap(account);
  }

  async function serialize(key, run) {
    if (!key) return run();
    const prior = locks.get(key);
    const work = (prior ?? Promise.resolve()).then(run);
    const settled = work.catch(() => {});
    locks.set(key, settled);
    try {
      return await work;
    } finally {
      if (locks.get(key) === settled) locks.delete(key);
    }
  }

  function invalidate(accountId) {
    cache.invalidateLists(accountId);
    mailClient.invalidateCursors();
  }

  function finalize(id, result) {
    const { state, ...metadata } = result;
    statements.finish.run(state, JSON.stringify(metadata), id);
    return publicReceipt(statements.get.get(id));
  }

  async function resolveDraft(api, ref) {
    try {
      const draft = await api.open(ref.draftId);
      if (version(draft) !== ref.version) throw draftConflict();
      return draft;
    } catch (error) {
      if (error.statusCode === 404) throw draftConflict();
      throw error;
    }
  }

  async function build(account, input, before, uploaded) {
    const source = input.originalId === null ? null : await mailClient.openSource(input.originalId, account.id);
    const original = source && await parse(source.raw);
    const origParts = original ? partsFor(original) : [];
    const observed = before && await parse(before.raw);
    const draftParts = input.attachments.some(ref => ref.kind === 'draft') ? partsFor(observed) : [];
    const origHash = source && digest(source.raw);
    const draftHash = before && digest(before.raw);
    if (input.kind === 'forward' && input.attachments.filter(ref => ref.kind === 'original').length !== origParts.length) {
      throw clientError('MAIL_CLIENT_ATTACHMENT_CHANGED', 409);
    }
    const mail = compose(account, input, original);
    mail.attachments = input.attachments.map(ref => {
      if (ref.kind === 'upload') return uploaded.shift();
      if (ref.kind === 'original') return retainPart(origHash, origParts, ref);
      return retainPart(draftHash, draftParts, ref);
    });
    if (observed && input.kind === 'new') Object.assign(mail, draftThread(observed));
    const threadId = mail.inReplyTo ? (source ? source.row.metadata.threadId : before?.threadId) : null;
    return { mail, threadId };
  }

  function responseFromError(error, operation) {
    const known = error?.code?.startsWith('MAIL_CLIENT_') && Number.isInteger(error.statusCode);
    const code = known ? error.code : 'MAIL_CLIENT_COMPOSE_PREFLIGHT_FAILED';
    const state = code === 'MAIL_CLIENT_DRAFT_CONFLICT' && operation === 'save' ? 'conflict' : 'failed';
    return { state, code, statusCode: known ? error.statusCode : 503 };
  }

  async function execute(account, operation, input, ref, id, claimed, onDispatch) {
    const google = account.provider === 'gmail';
    const smtp = operation === 'send' && !google ? prepareSmtp({ credentialsFor, createTransport }, account) : null;
    const api = (ref || operation === 'save' || google) ? await provider(account) : null;
    const before = ref ? await resolveDraft(api, ref) : null;
    const { mail, threadId } = input
      ? await build(account, input, before, claimed)
      : { mail: fromDraft(account, await parse(before.raw)), threadId: before.threadId };
    if (operation === 'send' && !(mail.to.length + mail.cc.length + mail.bcc.length)) {
      throw clientError('MAIL_CLIENT_RECIPIENT_REQUIRED', 400);
    }
    const marker = operation === 'save' && !google ? randomUUID() : undefined;
    const mime = await buildMime(mail, { keepBcc: google || operation === 'save', marker });
    // Re-read after MIME preparation. Gmail offers no atomic check-and-write.
    if (before && (google || operation === 'send')) await resolveDraft(api, ref);
    let result;
    if (operation === 'send') {
      onDispatch();
      result = google ? await api.send(mime.raw, threadId, before) : await smtp(mime);
    } else {
      if (google) onDispatch();
      result = await api.save(mime.raw, threadId, before, marker, onDispatch);
    }

    // Record provider acceptance before touching the IMAP draft.
    const shouldClean = result.state === 'sent' && result.delivery === 'full' && !google && before;
    const receipt = finalize(id, shouldClean ? { ...result, cleanup: 'pending' } : result);
    if (['sent', 'saved', 'unknown'].includes(receipt.state)) invalidate(account.id);
    if (!shouldClean) return receipt;
    const cleanup = await api.cleanup(before).catch(() => 'unknown');
    if (cleanup === 'confirmed') invalidate(account.id);
    return finalize(id, { ...result, cleanup });
  }

  function submit(accountId, operation, id, rawInput, ref = null) {
    gate(operation);
    requestId(id);
    const input = operation === 'send' && ref && rawInput === null ? null : composeInput(rawInput, ref?.draftId);
    const hash = digest(JSON.stringify([accountId, operation, ref, input]));
    return serialize(ref && JSON.stringify([accountId, ref.draftId]), async () => {
      const claim = {
        id, accountId, operation, hash, draftId: ref?.draftId ?? null,
        draftVersion: ref?.version ?? null, originalId: input?.originalId ?? null,
      };
      if (!statements.insert.run(claim).changes) {
        const existing = statements.get.get(id);
        if (existing) {
          if (existing.request_sha256 !== hash) throw clientError('MAIL_CLIENT_REQUEST_CONFLICT', 409);
          return publicReceipt(existing);
        }
        throw clientError('MAIL_CLIENT_DRAFT_SEND_ALREADY_REQUESTED', 409);
      }
      let dispatched = false;
      let claimed;
      try {
        claimed = uploads.claim(accountId, input?.attachments.filter(ref => ref.kind === 'upload').map(ref => ref.id) ?? []);
        const account = accountFor(accountId);
        return await execute(account, operation, input, ref, id, claimed.parts, () => { dispatched = true; });
      } catch (error) {
        // A database/cache error after transport leaves the saved result or pending reservation intact.
        const row = statements.get.get(id);
        if (row.state !== 'pending') return publicReceipt(row);
        if (error?.code?.startsWith('SQLITE_')) throw error;
        if (dispatched) {
          const result = finalize(id, unknown);
          invalidate(accountId);
          return result;
        }
        return finalize(id, responseFromError(error, operation));
      } finally {
        claimed?.release();
      }
    });
  }

  return {
    async list(accountId, cursor, limit) {
      return (await provider(accountFor(accountId))).list(cursor, limit);
    },
    async detail(accountId, id) {
      const draft = await (await provider(accountFor(accountId))).open(id);
      const parsed = await parse(draft.raw);
      return {
        id: draft.id, messageId: draft.messageId ?? null, threadId: draft.threadId ?? null, version: version(draft),
        from: parsed.from?.address ?? null,
        subject: parsed.subject ?? '', text: parsed.text ?? '', htmlSource: parsed.html ?? null,
        ...draftThread(parsed),
        to: addresses(parsed.to).map(entry => entry.address),
        cc: addresses(parsed.cc).map(entry => entry.address),
        bcc: addresses(parsed.bcc).map(entry => entry.address),
        attachments: describeWithProof(draft.raw, partsFor(parsed)),
      };
    },
    async fromMessage(accountId, clientMessageId) {
      const { raw, row } = await mailClient.openSource(clientMessageId, accountId);
      const adapter = await provider(accountFor(accountId));
      const id = await adapter.findByMessage(row.locator, raw);
      return this.detail(accountId, id);
    },
    async originalAttachments(accountId, originalId) {
      const { raw } = await mailClient.openSource(originalId, accountId);
      return { attachments: describeWithProof(raw, partsFor(await parse(raw))) };
    },
    upload(accountId, stream, filename, contentType) {
      gate('save');
      accountFor(accountId);
      return uploads.upload(accountId, stream, filename, contentType);
    },
    save(accountId, id, input, draftId, observedVersion) {
      return submit(accountId, 'save', id, input, draftId ? draftRef(draftId, observedVersion) : null);
    },
    send(accountId, id, input, draftId, observedVersion) {
      return submit(accountId, 'send', id, input, draftId ? draftRef(draftId, observedVersion) : null);
    },
    receipt(accountId, id) {
      const row = statements.get.get(requestId(id));
      if (row?.account_id !== accountId || row.operation !== 'send') {
        throw clientError('MAIL_CLIENT_RECEIPT_NOT_FOUND', 404);
      }
      return publicReceipt(row);
    },
  };
}

module.exports = { createMailClientCompose };
