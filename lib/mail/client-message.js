'use strict';

const { createHash } = require('node:crypto');
const PostalMime = require('postal-mime');
const { addressParser, decodeWords } = PostalMime;
const { htmlToText, repairMissingCharset } = require('./normalize');

const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const INLINE_IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

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
  const blockedRemoteImages = countRemoteImages(parsed.html);
  return {
    subject: parsed.subject ?? metadata.subject,
    from: addresses(parsed.from ? [parsed.from] : []),
    to: addresses(parsed.to),
    cc: addresses(parsed.cc),
    bcc: addresses(parsed.bcc),
    replyTo: addresses(parsed.replyTo),
    sentAt: epoch(parsed.date),
    body: { format: 'text', text: originalText(parsed), ...(parsed.html ? { html: parsed.html } : {}),
      ...(blockedRemoteImages ? { blockedRemoteImages } : {}) },
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
      downloadable: attachment.disposition !== 'inline' && !attachment.related && attachment.content?.byteLength > 0,
    })),
  };
}

function countRemoteImages(value) {
  return typeof value === 'string'
    ? [...value.matchAll(/<img\b[^>]*?\ssrc\s*=\s*['"]?https?:\/\//giu)].length : 0;
}

async function readClientAttachment(raw, index) {
  const parsed = await PostalMime.parse(repairMissingCharset(raw));
  const attachment = parsed.attachments?.[index];
  if (!attachment?.content?.byteLength || attachment.disposition === 'inline' || attachment.related) {
    throw clientError('MAIL_CLIENT_ATTACHMENT_NOT_FOUND', 404);
  }
  const safeName = String(attachment.filename || '').replace(/[\u0000-\u001f\u007f/\\]/gu, '_').trim().slice(0, 180);
  return { filename: safeName || 'attachment', bytes: Buffer.from(attachment.content) };
}

async function readClientInlineImage(raw, index) {
  if (!Buffer.isBuffer(raw) || raw.length > MAX_SOURCE_BYTES) throw clientError('MAIL_CLIENT_SOURCE_TOO_LARGE', 413);
  const parsed = await PostalMime.parse(repairMissingCharset(raw));
  const attachment = parsed.attachments?.[index];
  const contentType = attachment?.mimeType?.toLowerCase();
  if (!attachment?.contentId || !attachment.content?.byteLength
    || (attachment.disposition !== 'inline' && !attachment.related) || !INLINE_IMAGES.has(contentType)) {
    throw clientError('MAIL_CLIENT_ATTACHMENT_NOT_FOUND', 404);
  }
  const bytes = Buffer.from(attachment.content);
  const signature = bytes.toString('hex', 0, 12);
  const valid = {
    'image/png': signature.startsWith('89504e470d0a1a0a'),
    'image/jpeg': signature.startsWith('ffd8ff'),
    'image/gif': /^47494638(?:37|39)61/u.test(signature),
    'image/webp': signature.startsWith('52494646') && signature.slice(16) === '57454250',
  };
  if (!valid[contentType]) throw clientError('MAIL_CLIENT_ATTACHMENT_NOT_FOUND', 404);
  return { contentType, bytes };
}

module.exports = {
  readClientAttachment,
  readClientInlineImage,
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
