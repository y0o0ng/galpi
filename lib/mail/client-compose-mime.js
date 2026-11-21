'use strict';

const { domainToASCII } = require('node:url');
const MailComposer = require('nodemailer/lib/mail-composer');
const PostalMime = require('postal-mime');
const { addresses, clientError, MAX_SOURCE_BYTES } = require('./client-message');
const { htmlToText, repairMissingCharset } = require('./normalize');

const MAX_MIME_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024;
const MAX_ATTACHMENTS = 30;
const rawTooLarge = () => clientError('MAIL_CLIENT_COMPOSE_TOO_LARGE', 413);
const invalid = () => clientError('MAIL_CLIENT_COMPOSE_INVALID', 400);

function header(value, max) {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/u.test(value)) throw invalid();
  return value;
}

function mailbox(value) {
  const address = header(typeof value === 'string' ? value : value?.address, 254).trim();
  const at = address.lastIndexOf('@');
  const local = address.slice(0, at);
  const domainInput = address.slice(at + 1);
  const domain = at > 0 && /^[\p{L}\p{N}\p{M}.\-]+$/u.test(domainInput) && domainToASCII(domainInput);
  if (!/^[\w!#$%&'*+\-/=?^`{|}~]+(?:\.[\w!#$%&'*+\-/=?^`{|}~]+)*$/u.test(local) || local.length > 64
    || !domain || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(domain)) {
    throw invalid();
  }
  return local + '@' + domain.toLowerCase();
}

function addressList(items = []) {
  if (!Array.isArray(items) || items.length > 100) throw invalid();
  return items.map(mailbox);
}

function recipients(to, cc, bcc, self) {
  const seen = new Set(self ? [self.toLowerCase()] : []);
  const unique = entries => addressList(entries).filter(address => {
    const key = address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { to: unique(to), cc: unique(cc), bcc: unique(bcc) };
}

function messageId(value) {
  return typeof value === 'string' && value.length <= 255 && /^<[\w.!#$%&'*+\-/=?^`{|}~]+@[\w.-]+>$/u.test(value)
    ? value : undefined;
}

function references(value, last) {
  const ids = typeof value === 'string' ? (value.match(/<[^<>\s]+>/gu) || []).filter(messageId) : [];
  return [...new Set([...ids, ...(last ? [last] : [])])].join(' ') || undefined;
}

function attachmentHeaders(filename, type) {
  const contentType = header(type || 'application/octet-stream', 127).toLowerCase();
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(contentType)) throw invalid();
  const name = header(filename || 'attachment', 255);
  if (/[/\\]/u.test(name) || ['.', '..'].includes(name)) throw invalid();
  return { filename: name, contentType };
}

function parsedAttachment(part) {
  const cid = part.contentId?.match(/^<?([^<>\x00-\x20\x7f]+)>?$/u)?.[1];
  return {
    ...attachmentHeaders(part.filename, part.mimeType),
    content: Buffer.from(part.content),
    ...(cid ? { cid } : {}),
    contentDisposition: part.disposition === 'inline' ? 'inline' : 'attachment',
  };
}

function describe(parts) {
  return parts.map(({ filename, contentType, content, contentDisposition }, index) => ({
    index, filename, contentType, size: content.length, inline: contentDisposition === 'inline',
  }));
}

async function parse(raw) {
  if (!Buffer.isBuffer(raw) || !raw.length) throw clientError('MAIL_CLIENT_SOURCE_UNAVAILABLE', 503);
  if (raw.length > MAX_SOURCE_BYTES) throw rawTooLarge();
  return PostalMime.parse(repairMissingCharset(raw));
}

function partsFor(parsed) {
  if (parsed.attachments.length > MAX_ATTACHMENTS) throw rawTooLarge();
  return parsed.attachments.map(parsedAttachment);
}

function compose(account, input, original) {
  const from = mailbox(account.address);
  let { to, cc, bcc } = recipients(input.to, input.cc, input.bcc);
  let { subject, text, html } = input;
  let inReplyTo;
  let refs;
  if (original) {
    const source = header(original.subject || '', 998);
    if (input.kind === 'forward') {
      subject = /^fwd:/i.test(source) ? source : 'Fwd: ' + source;
      const format = list => addresses(list).map(entry => entry.address).join(', ');
      const quote = [
        '---------- Forwarded message ----------',
        'From: ' + format(original.from ? [original.from] : []),
        'Date: ' + (original.date || ''),
        'Subject: ' + source,
        'To: ' + format(original.to),
        '', original.text || (original.html ? htmlToText(original.html) : ''),
      ].join('\n');
      text += '\n\n' + quote;
      if (html != null) html += '<pre>' + quote.replace(/[&<>]/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]) + '</pre>';
    } else {
      const replyTo = addresses(original.replyTo);
      const senders = replyTo.length ? replyTo : addresses(original.from ? [original.from] : []);
      if (!senders.length) throw clientError('MAIL_CLIENT_REPLY_RECIPIENTS_UNKNOWN', 409);
      const all = input.kind === 'reply_all';
      ({ to, cc, bcc } = recipients(
        [...senders, ...(all ? addresses(original.to) : [])], all ? addresses(original.cc) : [], input.bcc, from,
      ));
      if (!to.length && cc.length) to.push(cc.shift());
      if (!to.length) throw clientError('MAIL_CLIENT_REPLY_RECIPIENTS_UNKNOWN', 409);
      inReplyTo = messageId(original.messageId);
      if (!inReplyTo) throw clientError('MAIL_CLIENT_REPLY_MESSAGE_ID_INVALID', 409);
      refs = references(original.references, inReplyTo);
      subject = /^re:/i.test(source) ? source : 'Re: ' + source;
    }
  }
  return { from, to, cc, bcc, subject, text, html, inReplyTo, references: refs };
}

function fromDraft(account, parsed) {
  const mail = compose(account, {
    to: addresses(parsed.to), cc: addresses(parsed.cc), bcc: addresses(parsed.bcc),
    subject: header(parsed.subject ?? '', 998), text: parsed.text ?? '', html: parsed.html ?? undefined,
  });
  if (mailbox(parsed.from).toLowerCase() !== mail.from.toLowerCase()) {
    throw clientError('MAIL_CLIENT_ACCOUNT_MISMATCH', 409);
  }
  return {
    ...mail,
    ...draftThread(parsed),
    attachments: partsFor(parsed),
  };
}

function draftThread(parsed) {
  return { inReplyTo: messageId(parsed.inReplyTo), references: references(parsed.references) };
}

async function buildMime(mail, { keepBcc, marker } = {}) {
  if (mail.attachments.length > MAX_ATTACHMENTS
    || mail.attachments.reduce((bytes, part) => bytes + part.content.length, 0) > MAX_ATTACHMENT_BYTES) throw rawTooLarge();
  const message = new MailComposer({
    ...mail, disableFileAccess: true, disableUrlAccess: true, newline: 'windows',
    ...(marker ? { headers: { 'X-Galpi-Draft-Id': marker } } : {}),
  }).compile();
  const envelope = message.getEnvelope();
  message.keepBcc = !!keepBcc;
  const raw = await message.build();
  if (raw.length > MAX_MIME_BYTES) throw rawTooLarge();
  return { raw, envelope };
}

module.exports = {
  MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, addressList, attachmentHeaders, buildMime, compose,
  describe, draftThread, fromDraft, header, parse, partsFor, rawTooLarge,
};
