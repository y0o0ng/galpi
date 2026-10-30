'use strict';

const STATUSES = Object.freeze(['PLANNED', 'ACTIVE', 'PAUSED', 'DONE', 'ABANDONED']);
const text = value => typeof value === 'string' && value.trim().length > 0;

function validateProjectPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(payload))
      || Object.getOwnPropertySymbols(payload).length
      || Object.keys(payload).sort().join(',') !== 'claimText,kind,projectMention,status,subject'
      || payload.subject !== 'USER' || !text(payload.projectMention)
      || !((payload.kind === 'STATUS' && STATUSES.includes(payload.status) && payload.claimText === null)
        || (payload.kind === 'CLAIM' && payload.status === null && text(payload.claimText)))) {
    throw new TypeError('INVALID_PROJECT_CANDIDATE');
  }
  return payload;
}

module.exports = { STATUSES, validateProjectPayload };
