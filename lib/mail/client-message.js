'use strict';

const { createHash } = require('node:crypto');
const PostalMime = require('postal-mime');
const { addressParser, decodeWords } = PostalMime;
const { htmlToText, repairMissingCharset } = require('./normalize');

const MAX_SOURCE_BYTES = 32 * 1024 * 1024;

function clientError(code, statusCode = 502) {
  return Object.assign(new Error(code), { code, statusCode });
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function addresses(entries) {
  return (entries || []).flatMap(entry => entry.group ? addresses(entry.group) : entry.address
    ? [{ name: entry.name || null, address: entry.address }]
    : []);
}

function headerAddresses(header) {
  return header ? addresses(addressParser(header)) : [];
}

function headerMessageId(value) {
  return typeof value === 'string' ? value.trim() || null : null;
}

function epoch(value) {
  if (value == null) return null;
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : null;
}

function originalText(mail) {
  if (typeof mail.text === 'string' && mail.text.trim()) return mail.text;
  if (typeof mail.html !== 'string' || !mail.html) return mail.text || '';
  return htmlToText(mail.html);
}

async function parseClientMessage(raw, metadata) {
  if (!Buffer.isBuffer(raw) || !raw.length) throw clientError('MAIL_CLIENT_SOURCE_UNAVAILABLE');
  if (raw.length > MAX_SOURCE_BYTES) throw clientError('MAIL_CLIENT_SOURCE_TOO_LARGE', 413);
  const parsed = await PostalMime.parse(repairMissingCharset(raw));
  return {
    subject: parsed.subject ?? metadata.subject,
    from: addresses(parsed.from ? [parsed.from] : []),
    to: addresses(parsed.to),
    cc: addresses(parsed.cc),
    bcc: addresses(parsed.bcc),
    replyTo: addresses(parsed.replyTo),
    sentAt: epoch(parsed.date),
    body: { format: 'text', text: originalText(parsed) },
    thread: {
      providerThreadId: metadata.threadId ?? null,
      messageId: headerMessageId(parsed.messageId),
      inReplyTo: headerMessageId(parsed.inReplyTo),
      references: (parsed.references || '').match(/<[^<>\s]+>/gu) || [],
    },
    attachments: (parsed.attachments || []).map(attachment => ({
      filename: attachment.filename || null,
      contentType: attachment.mimeType || null,
      contentId: attachment.contentId || null,
      disposition: attachment.disposition || null,
      inline: attachment.disposition === 'inline' || Boolean(attachment.related),
      size: attachment.content?.byteLength ?? null,
    })),
  };
}

module.exports = {
  MAX_SOURCE_BYTES,
  addresses,
  clientError,
  decodeWords,
  digest,
  epoch,
  headerAddresses,
  headerMessageId,
  parseClientMessage,
};
