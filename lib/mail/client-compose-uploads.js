'use strict';

const { randomUUID } = require('node:crypto');
const { clientError } = require('./client-message');
const { MAX_ATTACHMENT_BYTES, attachmentHeaders, rawTooLarge } = require('./client-compose-mime');

const TTL = 15 * 60_000;
const TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_HANDLES = 100;
const invalid = () => clientError('MAIL_CLIENT_COMPOSE_INVALID', 400);
const expired = () => clientError('MAIL_CLIENT_UPLOAD_NOT_FOUND', 409);

function createComposeUploads({ ttl = TTL } = {}) {
  const entries = new Map();
  let bytes = 0;
  let inflight = 0;

  function take(id) {
    const entry = entries.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    entries.delete(id);
    return entry;
  }

  return {
    async upload(accountId, stream, filename, type) {
      const metadata = attachmentHeaders(filename, type);
      if (inflight + entries.size >= MAX_HANDLES) throw rawTooLarge();
      inflight += 1;
      let size = 0;
      try {
        const content = await new Promise((resolve, reject) => {
          const chunks = [];
          const timer = setTimeout(() => settle(invalid()), 30_000).unref();
          function settle(error) {
            clearTimeout(timer);
            stream.off('data', data);
            stream.off('end', end);
            stream.off('aborted', aborted);
            stream.off('error', settle);
            if (error) {
              stream.resume();
              reject(error);
            } else resolve(Buffer.concat(chunks, size));
          }
          function data(chunk) {
            if (size + chunk.length > MAX_ATTACHMENT_BYTES || bytes + chunk.length > TOTAL_BYTES) {
              settle(rawTooLarge());
              return;
            }
            size += chunk.length;
            bytes += chunk.length;
            chunks.push(chunk);
          }
          function end() { settle(size ? null : invalid()); }
          function aborted() { settle(invalid()); }
          stream.on('data', data);
          stream.once('end', end);
          stream.once('aborted', aborted);
          stream.once('error', settle);
        });
        const id = randomUUID();
        const timer = setTimeout(() => { bytes -= take(id)?.content.length ?? 0; }, ttl).unref();
        entries.set(id, { ...metadata, content, accountId, timer });
        return { id, ...metadata, size };
      } catch (error) {
        bytes -= size;
        throw error;
      } finally {
        inflight -= 1;
      }
    },
    claim(accountId, ids) {
      if (new Set(ids).size !== ids.length) throw invalid();
      for (const id of ids) {
        if (entries.get(id)?.accountId !== accountId) throw expired();
      }
      let held = 0;
      const claimed = ids.map(id => {
        const { filename, contentType, content } = take(id);
        held += content.length;
        return { filename, contentType, content };
      });
      function release() {
        bytes -= held;
        held = 0;
      }
      return { parts: claimed, release };
    },
  };
}

module.exports = { createComposeUploads };
