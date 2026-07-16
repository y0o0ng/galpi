'use strict';

const crypto = require('node:crypto');

function normalizeForHash(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(normalizeForHash(value), 'utf8').digest('hex');
}

module.exports = { normalizeForHash, sha256 };
