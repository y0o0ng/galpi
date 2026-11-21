'use strict';

const { clientError } = require('./client-message');

const BASE = '/api/mail-client';

function positiveInteger(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw clientError('MAIL_CLIENT_INVALID_REQUEST', 400);
  }
  return Number(value);
}

function pageOptions(query) {
  const limit = query.limit == null ? 20 : positiveInteger(query.limit);
  const cursor = query.cursor ?? null;
  if (limit > 25 || (cursor !== null && (typeof cursor !== 'string' || !/^[a-f0-9-]{36}$/i.test(cursor)))) {
    throw clientError('MAIL_CLIENT_INVALID_REQUEST', 400);
  }
  return { limit, cursor };
}

function registerMailClientRoutes({ app, service, contacts }) {
  function get(path, run) {
    app.get(BASE + path, async (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (!service) return res.status(503).json({ success: false, code: 'MAIL_CLIENT_DISABLED' });
      try {
        return res.json({ success: true, ...(await run(req)) });
      } catch (error) {
        const known = error?.code?.startsWith('MAIL_CLIENT_') && Number.isInteger(error.statusCode);
        return res.status(known ? error.statusCode : 500).json({
          success: false, code: known ? error.code : 'MAIL_CLIENT_INTERNAL_ERROR',
        });
      }
    });
  }

  get('/accounts', () => ({ accounts: service.accounts() }));
  get('/accounts/:accountId/mailboxes', req => service.mailboxes(positiveInteger(req.params.accountId)));
  get('/accounts/:accountId/messages', req => {
    const accountId = positiveInteger(req.params.accountId);
    const { limit, cursor } = pageOptions(req.query);
    const { mailbox } = req.query;
    if (typeof mailbox !== 'string' || !mailbox || mailbox.length > 1024) {
      throw clientError('MAIL_CLIENT_INVALID_REQUEST', 400);
    }
    return service.mailbox(accountId, mailbox, cursor, limit);
  });
  get('/inbox', req => {
    const { limit, cursor } = pageOptions(req.query);
    return service.inbox(cursor, limit);
  });
  get('/messages/:messageId', async req => ({
    message: await service.detail(positiveInteger(req.params.messageId)),
  }));
  get('/messages/:messageId/attachments', async req => {
    const { id, fetchedAt, attachments } = await service.detail(positiveInteger(req.params.messageId), { includeThread: false });
    return { id, fetchedAt, attachments };
  });
  get('/search', req => {
    const { limit, cursor } = pageOptions(req.query);
    const accountId = req.query.accountId == null ? null : positiveInteger(req.query.accountId);
    return service.search(req.query, accountId, cursor, limit);
  });
  app.get(BASE + '/messages/:messageId/attachments/:index', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!service) return res.status(503).json({ success: false, code: 'MAIL_CLIENT_DISABLED' });
    try {
      const { index } = req.params;
      if (!/^\d{1,4}$/u.test(index)) throw clientError('MAIL_CLIENT_INVALID_REQUEST', 400);
      const attachment = await service.attachment(positiveInteger(req.params.messageId), Number(index));
      res.attachment(attachment.filename);
      res.type('application/octet-stream');
      return res.send(attachment.bytes);
    } catch (error) {
      const known = error?.code?.startsWith('MAIL_CLIENT_') && Number.isInteger(error.statusCode);
      return res.status(known ? error.statusCode : 500).json({
        success: false, code: known ? error.code : 'MAIL_CLIENT_INTERNAL_ERROR',
      });
    }
  });
  app.get(BASE + '/messages/:messageId/inline-images/:index', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!service) return res.status(503).json({ success: false, code: 'MAIL_CLIENT_DISABLED' });
    try {
      const { index } = req.params;
      if (!/^\d{1,4}$/u.test(index)) throw clientError('MAIL_CLIENT_INVALID_REQUEST', 400);
      const image = await service.inlineImage(positiveInteger(req.params.messageId), Number(index));
      res.set('X-Content-Type-Options', 'nosniff');
      return res.type(image.contentType).send(image.bytes);
    } catch (error) {
      const known = error?.code?.startsWith('MAIL_CLIENT_') && Number.isInteger(error.statusCode);
      return res.status(known ? error.statusCode : 500).json({
        success: false, code: known ? error.code : 'MAIL_CLIENT_INTERNAL_ERROR',
      });
    }
  });
  if (contacts) {
    get('/contacts', req => contacts.list(req.query));
    function contactWrite(run) {
      return (req, res) => {
        res.set('Cache-Control', 'no-store');
        if (!service) return res.status(503).json({ success: false, code: 'MAIL_CLIENT_DISABLED' });
        try {
          if (!req.is('application/json')) throw clientError('MAIL_CLIENT_CONTACTS_INVALID', 400);
          return res.json({ success: true, ...run(req.body) });
        } catch (error) {
          const known = error?.code === 'MAIL_CLIENT_CONTACTS_INVALID';
          return res.status(known ? 400 : 500).json({
            success: false, code: known ? error.code : 'MAIL_CLIENT_INTERNAL_ERROR',
          });
        }
      };
    }
    app.post(BASE + '/contacts/import', contactWrite(body => contacts.import(body)));
    app.put(BASE + '/contacts/settings', contactWrite(body => contacts.setCollection(body)));
  }
  get('/agent-messages/:messageId', req => service.fromAgent(positiveInteger(req.params.messageId)));
  get('/attention/:attentionId', req => service.fromAttention(positiveInteger(req.params.attentionId)));
}

function registerMailClientActionRoutes({ app, service }) {
  function post(path, run) {
    app.post(BASE + path, async (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (!service) return res.status(503).json({ success: false, code: 'MAIL_CLIENT_WRITE_DISABLED' });
      try {
        const { statusCode, data } = await run(req);
        return res.status(statusCode).json(data);
      } catch (error) {
        const known = error?.code?.startsWith('MAIL_CLIENT_') && Number.isInteger(error.statusCode);
        return res.status(known ? error.statusCode : 500).json({
          success: false, code: known ? error.code : 'MAIL_CLIENT_INTERNAL_ERROR',
        });
      }
    });
  }

  post('/messages/:messageId/actions', async req => {
    const { requestId, ...operation } = req.body || {};
    if (Object.hasOwn(operation, 'messageId')) throw clientError('MAIL_CLIENT_WRITE_INVALID_REQUEST', 400);
    operation.messageId = positiveInteger(req.params.messageId);
    const { success, results: [result] } = await service.run(requestId, [operation]);
    return { statusCode: result.statusCode, data: { success, requestId, result } };
  });

  post('/messages/actions', async req => {
    const { requestId, operations, ...extra } = req.body || {};
    if (Object.keys(extra).length) throw clientError('MAIL_CLIENT_WRITE_INVALID_REQUEST', 400);
    return { statusCode: 200, data: await service.run(requestId, operations) };
  });
}

function registerMailClientComposeRoutes({ app, service }) {
  const base = BASE + '/accounts/:accountId';

  function route(method, path, run) {
    app[method](base + path, async (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (!service) return res.status(503).json({ success: false, code: 'MAIL_CLIENT_DISABLED' });
      try {
        const accountId = positiveInteger(req.params.accountId);
        const { statusCode = 200, ...data } = await run(req, accountId);
        return res.status(statusCode).json({ success: true, ...data });
      } catch (error) {
        const known = error?.code?.startsWith('MAIL_CLIENT_') && Number.isInteger(error.statusCode);
        return res.status(known ? error.statusCode : 500).json({
          success: false, code: known ? error.code : 'MAIL_CLIENT_INTERNAL_ERROR',
        });
      }
    });
  }

  function submission(body, fields) {
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !fields.includes(key))) {
      throw clientError('MAIL_CLIENT_COMPOSE_INVALID', 400);
    }
    return body;
  }

  function sendResult(result) {
    const statusCode = result.statusCode ?? ({ pending: 202, unknown: 202, conflict: 409, failed: 502 }[result.state] ?? 200);
    return { ...result, statusCode };
  }

  route('get', '/drafts', (req, accountId) => {
    const { cursor = null, limit = '10' } = req.query;
    const pageSize = positiveInteger(limit);
    if (pageSize > 25 || (cursor !== null && (typeof cursor !== 'string' || !cursor || cursor.length > 2000))) {
      throw clientError('MAIL_CLIENT_COMPOSE_INVALID', 400);
    }
    return service.list(accountId, cursor, pageSize);
  });
  route('get', '/drafts/:draftId', async (req, accountId) => ({
    draft: await service.detail(accountId, req.params.draftId),
  }));
  route('post', '/drafts', async (req, accountId) => {
    const { requestId, compose } = submission(req.body, ['requestId', 'compose']);
    return sendResult(await service.save(accountId, requestId, compose));
  });
  route('put', '/drafts/:draftId', async (req, accountId) => {
    const { requestId, version, compose } = submission(req.body, ['requestId', 'version', 'compose']);
    return sendResult(await service.save(accountId, requestId, compose, req.params.draftId, version));
  });
  route('post', '/drafts/:draftId/send', async (req, accountId) => {
    const { requestId, version } = submission(req.body, ['requestId', 'version']);
    return sendResult(await service.send(accountId, requestId, null, req.params.draftId, version));
  });
  route('post', '/send', async (req, accountId) => {
    const { requestId, compose } = submission(req.body, ['requestId', 'compose']);
    return sendResult(await service.send(accountId, requestId, compose));
  });
  route('get', '/send/:requestId', (req, accountId) => ({ receipt: service.receipt(accountId, req.params.requestId) }));
  route('get', '/messages/:messageId/draft', async (req, accountId) => ({
    draft: await service.fromMessage(accountId, positiveInteger(req.params.messageId)),
  }));
  route('get', '/messages/:messageId/attachment-references', (req, accountId) => (
    service.originalAttachments(accountId, positiveInteger(req.params.messageId))
  ));
  route('post', '/uploads', async (req, accountId) => {
    if (!req.is('application/octet-stream') || typeof req.query.filename !== 'string' || !req.query.filename) {
      throw clientError('MAIL_CLIENT_COMPOSE_INVALID', 400);
    }
    const attachment = await service.upload(accountId, req, req.query.filename, req.query.contentType);
    return { statusCode: 201, attachment };
  });
}

function registerMailClientSmartRoutes({ app, service }) {
  function route(method, path, run) {
    app[method](BASE + '/smart' + path, async (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (!service) return res.status(503).json({ success: false, code: 'MAIL_CLIENT_SMART_DISABLED' });
      try {
        const data = await run(req);
        return res.status(method === 'post' ? 202 : 200).json({ success: true, ...data });
      } catch (error) {
        const known = error?.code?.startsWith('MAIL_CLIENT_') && Number.isInteger(error.statusCode);
        return res.status(known ? error.statusCode : 500).json({
          success: false, code: known ? error.code : 'MAIL_CLIENT_INTERNAL_ERROR',
        });
      }
    });
  }

  function options(query) {
    return {
      accountId: query.accountId == null ? null : positiveInteger(query.accountId),
      limit: query.limit == null ? 20 : positiveInteger(query.limit),
      cursor: query.cursor ?? null,
    };
  }

  route('post', '/analyze', req => {
    const input = req.body;
    if (!req.is('application/json') || !input || Array.isArray(input)
      || Object.keys(input).length !== 2 || !Object.hasOwn(input, 'messageIds') || !Object.hasOwn(input, 'kind')) {
      throw clientError('MAIL_CLIENT_SMART_INVALID_REQUEST', 400);
    }
    return service.analyze(input.messageIds, input.kind);
  });
  route('get', '/results', req => {
    const ids = req.query.messageIds;
    if (typeof ids !== 'string' || ids.length > 170) throw clientError('MAIL_CLIENT_SMART_INVALID_REQUEST', 400);
    return service.results(ids.split(',').map(positiveInteger), req.query.statusOnly === '1');
  });
  route('get', '/analysis-targets', req => service.analysisTargets(req.query.snapshot === '1'));
  route('get', '/messages', req => service.messages(req.query.filter, { ...options(req.query), variant: req.query.variant }));
  route('get', '/calendar', req => service.calendar({
    ...options(req.query), month: req.query.month, from: req.query.from, until: req.query.until, section: req.query.section,
  }));
  route('get', '/calendar/:eventId', req => service.calendarEvent(positiveInteger(req.params.eventId)));
}

module.exports = { registerMailClientRoutes, registerMailClientActionRoutes, registerMailClientComposeRoutes, registerMailClientSmartRoutes };
