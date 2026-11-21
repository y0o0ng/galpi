'use strict';

const { internals: { parseKstDate } } = require('../assistant-tasks');
const { createSmartStore, FILTERS } = require('./client-smart-store');
const { classify, validDeadline } = require('./client-smart-analyze');
const { extractCalendar, taskProposal } = require('./client-smart-calendar');
const { normalizeMail } = require('./normalize');
const { clientError, digest, MAX_SOURCE_BYTES } = require('./client-message');

const STOP_SOURCE = new Set([
  'MAIL_CLIENT_LOCATION_STALE', 'MAIL_CLIENT_MESSAGE_GONE', 'MAIL_CLIENT_SMART_INELIGIBLE',
  'MAIL_CLIENT_SMART_MAILBOX_UNVERIFIED', 'MAIL_CLIENT_SOURCE_TOO_LARGE',
]);
const KINDS = ['classification', 'calendar'];
const COVERAGE = { scope: 'observed_workspace', complete: false, verification: 'stored_observations' };

function invalid() {
  return clientError('MAIL_CLIENT_SMART_INVALID_REQUEST', 400);
}

function messageIds(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 10
    || !ids.every(id => Number.isSafeInteger(id) && id > 0) || new Set(ids).size !== ids.length) throw invalid();
  return ids;
}

function options({ limit = 20, accountId = null, cursor = null }) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25
    || (accountId !== null && (!Number.isSafeInteger(accountId) || accountId <= 0))) throw invalid();
  return { limit, accountId, cursor };
}

function withCursor(scope, cursor, isKey) {
  if (cursor === null) return null;
  try {
    if (typeof cursor !== 'string' || !/^[\w-]{1,2048}$/u.test(cursor)) throw invalid();
    const [saved, key] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (saved === digest(JSON.stringify(scope)) && Array.isArray(key) && isKey(key)) return key;
  } catch { /* reject malformed cursor */ }
  throw clientError('MAIL_CLIENT_CURSOR_INVALID', 409);
}

function nextCursor(scope, key) {
  return Buffer.from(JSON.stringify([digest(JSON.stringify(scope)), key])).toString('base64url');
}

function dateRange(month, from, until) {
  try {
    if (month !== undefined) {
      if (from !== undefined || until !== undefined || typeof month !== 'string' || !/^\d{4}-\d{2}$/u.test(month)) throw invalid();
      const parsed = parseKstDate(month + '-01');
      from = parsed.value;
      until = new Date(Date.UTC(parsed.year, parsed.month, 1)).toISOString().slice(0, 10);
    }
    const start = parseKstDate(from).value;
    const end = parseKstDate(until).value;
    const delta = Date.parse(end) - Date.parse(start);
    if (delta <= 0 || delta > 366 * 86400000) throw invalid();
    return { from: start, until: end };
  } catch { throw invalid(); }
}

function jobResult(job) {
  const { id, kind, state, code, attempts, nextAttemptAt, leaseUntil, model, promptVersion, analyzedAt } = job;
  return { id, kind, state, code, attempts, nextAttemptAt: state === 'pending' ? nextAttemptAt : null,
    leaseUntil: state === 'analyzing' ? leaseUntil : null, model, promptVersion, analyzedAt };
}

function knownError(error) {
  if (error?.code?.startsWith('MAIL_CLIENT_') && Number.isInteger(error.statusCode)) {
    return { code: error.code, statusCode: error.statusCode };
  }
  return { code: 'MAIL_CLIENT_SMART_INTERNAL_ERROR', statusCode: 500 };
}

function decisionProjection(row, liveAgent = undefined) {
  if (liveAgent) {
    const { model, promptVersion, analyzedAt, ...decision } = liveAgent;
    return { ...decision, source: 'agent', model, promptVersion, analyzedAt };
  }
  if (liveAgent === undefined && row?.agentResult) {
    return { ...JSON.parse(row.agentResult), source: 'agent', model: row.agentModel,
      promptVersion: row.agentVersion, analyzedAt: row.agentAnalyzedAt };
  }
  return row?.workspaceResult ? { ...JSON.parse(row.workspaceResult), source: 'workspace',
    model: row.workspaceModel, promptVersion: row.workspaceVersion, analyzedAt: row.workspaceAnalyzedAt } : null;
}

function statusProjection(row, classification) {
  return {
    classification: { state: classification ? 'done' : row?.classificationState || 'unclassified',
      code: classification?.source === 'agent' ? null : row?.classificationCode ?? null,
      incomplete: classification?.source !== 'agent' && row?.classificationIncomplete ? JSON.parse(row.classificationIncomplete) : [] },
    calendar: { state: row?.calendarState || 'unclassified', code: row?.calendarCode ?? null,
      incomplete: row?.calendarIncomplete ? JSON.parse(row.calendarIncomplete) : [],
      model: row?.calendarModel ?? null, promptVersion: row?.calendarVersion ?? null, analyzedAt: row?.calendarAnalyzedAt ?? null },
  };
}

function publicEvent(row, verified) {
  const { sourceError, accountStatus, incomplete, ...event } = row;
  return { ...event, incomplete: incomplete ? JSON.parse(incomplete) : [],
    sourceVerification: { state: verified ? 'verified' : 'observed', verifiedAt: row.verifiedAt } };
}

function createMailSmart({ db, mailClient, agentStore, callModel, model, now = () => Math.floor(Date.now() / 1000),
  onError = () => {} }) {
  const store = createSmartStore(db, validDeadline);
  let timer;
  let running;

  function checkAccount(id) {
    const account = agentStore.getAccount(id);
    if (!account) throw clientError('MAIL_CLIENT_ACCOUNT_NOT_FOUND', 404);
    if (account.status === 'disabled') throw clientError('MAIL_CLIENT_ACCOUNT_DISABLED', 503);
    return account;
  }

  async function open(id, expected = null) {
    const source = await mailClient.openAnalysisSource(id);
    const { cached, account, row, raw } = source;
    if (expected && account.id !== expected.accountId) throw clientError('MAIL_CLIENT_LOCATION_STALE', 409);
    const current = store.isCurrent(id);
    if (!current || current.proof_key !== cached.proof) throw clientError('MAIL_CLIENT_LOCATION_STALE', 409);
    if (current.status === 'disabled') throw clientError('MAIL_CLIENT_ACCOUNT_DISABLED', 503);
    if (account.provider === 'gmail' && row.metadata.labelIds.some(label => ['SENT', 'DRAFT', 'SPAM', 'TRASH'].includes(label))) {
      throw clientError('MAIL_CLIENT_SMART_INELIGIBLE', 422);
    }
    if (!Buffer.isBuffer(raw) || !raw.length) throw clientError('MAIL_CLIENT_SOURCE_UNAVAILABLE', 503);
    if (raw.length > MAX_SOURCE_BYTES) throw clientError('MAIL_CLIENT_SOURCE_TOO_LARGE', 413);
    const hash = digest(raw);
    const previous = store.source(id);
    if ((previous && previous.hash !== hash) || (expected && expected.hash !== hash)) {
      throw clientError('MAIL_CLIENT_LOCATION_STALE', 409);
    }
    return { ...source, hash };
  }

  function preferencesFor(accountId, senderAddress) {
    const sender = String(senderAddress || '').toLowerCase();
    const senderDomain = sender.includes('@') ? sender.split('@').at(-1) : '';
    const preferences = agentStore.findMatchingPreferences({ accountId, senderAddress: sender, senderDomain });
    return { sender, senderDomain, preferences, skip: preferences.some(rule => rule.action === 'skip_analysis') };
  }

  async function reserve(id, kinds) {
    const { account, row, hash, agentMessageId } = await open(id);
    const agent = store.agent(agentMessageId, account.id);
    const skip = preferencesFor(account.id, row.metadata.from[0]?.address).skip;
    const entries = kinds.flatMap(kind => {
      if (kind === 'classification' && agent && !skip) return [];
      if (skip) return [{ kind, state: 'skipped', code: 'MAIL_CLIENT_SMART_PREFERENCE_SKIP' }];
      if (typeof callModel !== 'function') return [];
      return [{ kind, state: 'pending', code: null }];
    });
    const jobs = store.reserve({ accountId: account.id, messageId: id, hash, now: now() }, entries);
    if (!jobs) throw clientError('MAIL_CLIENT_LOCATION_STALE', 409);
    return { id, accountId: account.id, sourceSha256: hash, jobs: kinds.map(kind => {
      if (skip) {
        const job = jobs.find(item => item.kind === kind);
        return { id: job?.id ?? null, kind, state: 'skipped', code: 'MAIL_CLIENT_SMART_PREFERENCE_SKIP' };
      }
      if (kind === 'classification' && agent) return { kind, source: 'agent', state: 'done', code: null };
      const job = jobs.find(item => item.kind === kind);
      return job ? jobResult(job) : { kind, state: 'failed', code: 'MAIL_CLIENT_SMART_MODEL_UNAVAILABLE' };
    }) };
  }

  async function verifyResult(id) {
    const { account, row, hash, agentMessageId } = await open(id);
    const stored = store.message(id);
    const source = store.source(id);
    const current = stored?.sourceSha256 === hash ? stored : null;
    const agent = store.agent(agentMessageId, account.id);
    const classification = decisionProjection(current, agent);
    const statuses = statusProjection(current, classification);
    if (preferencesFor(account.id, row.metadata.from[0]?.address).skip) {
      for (const kind of KINDS) {
        if (statuses[kind].state !== 'done') statuses[kind] = { state: 'skipped', code: 'MAIL_CLIENT_SMART_PREFERENCE_SKIP', incomplete: [] };
      }
    }
    return { id, accountId: account.id, agentMessageId, sourceSha256: hash,
      sourceVerification: { state: 'verified', verifiedAt: now(), storedAt: source?.verifiedAt ?? null },
      classification, ...statusesForResponse(statuses), jobs: store.jobs(id, hash).map(jobResult) };
  }

  function statusesForResponse(statuses) {
    return { classificationStatus: statuses.classification, calendarStatus: statuses.calendar };
  }

  // Limit concurrent raw reads without turning the request into a wait for the model.
  async function selected(ids, run, invalidate = false) {
    const results = [];
    for (let i = 0; i < ids.length; i += 2) {
      results.push(...await Promise.all(ids.slice(i, i + 2).map(async id => {
        try { return await run(id); } catch (error) {
          if (invalidate && STOP_SOURCE.has(error.code)) store.invalidate(id, error.code);
          if (!error?.code?.startsWith('MAIL_CLIENT_')) onError(error);
          return { id, error: knownError(error) };
        }
      })));
    }
    return { results };
  }

  async function process(job) {
    try {
      const source = await open(job.messageId, job);
      const { account, row, agentMessageId, raw } = source;
      const observed = preferencesFor(account.id, row.metadata.from[0]?.address);
      if (observed.skip) return { state: 'skipped', code: 'MAIL_CLIENT_SMART_PREFERENCE_SKIP' };
      if (job.kind === 'classification' && store.agent(agentMessageId, account.id)) {
        return { state: 'skipped', code: 'MAIL_CLIENT_SMART_AGENT_REUSED' };
      }
      if (typeof callModel !== 'function') return { state: 'failed', code: 'MAIL_CLIENT_SMART_MODEL_UNAVAILABLE', retry: true };
      const normalized = await normalizeMail(raw);
      const identity = preferencesFor(account.id, normalized.from?.address);
      if (identity.skip) return { state: 'skipped', code: 'MAIL_CLIENT_SMART_PREFERENCE_SKIP' };
      const input = { callModel, model, normalized, receivedAt: row.metadata.receivedAt };
      if (!Number.isSafeInteger(input.receivedAt) || input.receivedAt < 0) {
        return { state: 'failed', code: 'MAIL_CLIENT_SMART_RECEIVED_AT_INVALID' };
      }
      const result = job.kind === 'classification'
        ? await classify({ ...input, labels: row.metadata.labelIds, preferences: identity.preferences,
          history: agentStore.senderHistory({ accountId: account.id, senderAddress: identity.sender,
            senderDomain: identity.senderDomain, threadId: row.metadata.threadId, excludeId: agentMessageId }) })
        : await extractCalendar(input);
      const verified = await open(job.messageId, job);
      if (preferencesFor(account.id, normalized.from?.address).skip) {
        return { state: 'skipped', code: 'MAIL_CLIENT_SMART_PREFERENCE_SKIP' };
      }
      if (job.kind === 'classification' && store.agent(verified.agentMessageId, account.id)) {
        return { state: 'skipped', code: 'MAIL_CLIENT_SMART_AGENT_REUSED' };
      }
      return { state: 'done', model, agentMessageId: verified.agentMessageId, ...result };
    } catch (error) {
      if (STOP_SOURCE.has(error.code)) return { state: 'skipped', code: error.code, invalidate: true };
      if (error.code === 'MAIL_CLIENT_ACCOUNT_DISABLED') return { state: 'skipped', code: error.code };
      if (error.code === 'MAIL_CLIENT_SMART_MODEL_OUTPUT_INVALID') return { state: 'failed', code: error.code };
      const code = error?.code?.startsWith('MAIL_CLIENT_') && error.statusCode
        ? error.code : 'MAIL_CLIENT_SMART_MODEL_OR_SOURCE_FAILED';
      return { state: 'failed', code, retry: error.statusCode == null || error.statusCode >= 500 };
    }
  }

  async function work() {
    const job = store.claim(now());
    if (job) store.finish(job, await process(job), now());
    return job?.id ?? null;
  }

  function tick() {
    if (running) return running;
    running = work().finally(() => { running = null; });
    return running;
  }

  function start() {
    if (timer) return;
    const run = () => { void tick().catch(onError); };
    timer = setInterval(run, 5000);
    timer.unref();
    run();
  }

  return {
    start, tick,
    stop() { clearInterval(timer); timer = null; },
    analyze(ids, kind) {
      const requested = kind === 'both' ? KINDS : KINDS.includes(kind) ? [kind] : null;
      if (!requested) throw invalid();
      return selected(messageIds(ids), id => reserve(id, requested), true);
    },
    results: ids => selected(messageIds(ids), verifyResult),
    messages(filter, input) {
      if (typeof filter !== 'string' || !Object.hasOwn(FILTERS, filter)) throw invalid();
      const { limit, accountId, cursor } = options(input);
      if (accountId != null) checkAccount(accountId);
      const scope = [filter, accountId, limit];
      const key = withCursor(scope, cursor, key => key.length === 4 && Number.isSafeInteger(key[0])
        && Number.isSafeInteger(key[1]) && typeof key[2] === 'string' && Number.isSafeInteger(key[3]));
      const [date, afterAccount, afterLocation, afterId] = key || [null, null, null, null];
      const rows = store.page(filter, { date, afterAccount, afterLocation, afterId, accountId, limit: limit + 1 });
      const messages = rows.slice(0, limit).map(row => {
        const metadata = JSON.parse(row.metadata);
        const classification = decisionProjection(row);
        return { ...metadata, id: row.id, accountId: row.accountId, provider: row.provider, fetchedAt: row.fetchedAt,
          starred: metadata.starred ?? (row.provider === 'gmail' ? metadata.labelIds.includes('STARRED') : !!metadata.important),
          important: row.provider === 'gmail' ? metadata.important : null,
          agentMessageId: row.agentMessageId, classification, ...statusesForResponse(statusProjection(row, classification)),
          sourceVerification: { state: 'observed', verifiedAt: row.verifiedAt } };
      });
      const last = rows[limit - 1];
      return { messages, coverage: COVERAGE, nextCursor: rows.length > limit
        ? nextCursor(scope, [last.receivedAt, last.accountId, last.locationKey, last.id]) : null };
    },
    calendar(input) {
      const { limit, accountId, cursor } = options(input);
      if (accountId != null) checkAccount(accountId);
      const range = dateRange(input.month, input.from, input.until);
      const section = input.section ?? 'resolved';
      if (!['resolved', 'unresolved'].includes(section)) throw invalid();
      const scope = ['calendar', section, accountId, range, limit];
      const key = withCursor(scope, cursor, key => key.length === 2 && typeof key[0] === 'string' && Number.isSafeInteger(key[1]));
      const load = (name, start) => {
        const [date, afterId] = start || [null, null];
        const isUnresolved = name === 'unresolved';
        const rows = store.calendar(isUnresolved, { ...range, date, afterId, accountId, limit: limit + 1 });
        const last = rows[limit - 1];
        return { events: rows.slice(0, limit).map(row => publicEvent(row, false)),
          nextCursor: rows.length > limit ? nextCursor(['calendar', name, accountId, range, limit],
            [isUnresolved ? last.referenceKstDate : last.startDate, last.id]) : null };
      };
      return { ...range, section, ...load(section, key), coverage: COVERAGE,
        ...(section === 'resolved' && cursor === null ? { unresolved: load('unresolved', null) } : {}) };
    },
    async calendarEvent(id) {
      const row = store.event(id);
      if (!row) throw clientError('MAIL_CLIENT_SMART_EVENT_NOT_FOUND', 404);
      const source = await open(row.messageId, { accountId: row.accountId, hash: row.sourceSha256 });
      const event = publicEvent({ ...row, currentAgentMessageId: source.agentMessageId, verifiedAt: now() }, true);
      return { event, taskProposal: taskProposal(event, now()) };
    },
  };
}

module.exports = { createMailSmart };
