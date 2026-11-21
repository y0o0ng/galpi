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

function registerMailClientRoutes({ app, service }) {
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
    const { id, fetchedAt, attachments } = await service.detail(positiveInteger(req.params.messageId));
    return { id, fetchedAt, attachments };
  });
  get('/agent-messages/:messageId', req => service.fromAgent(positiveInteger(req.params.messageId)));
  get('/attention/:attentionId', req => service.fromAttention(positiveInteger(req.params.attentionId)));
}

module.exports = { registerMailClientRoutes };
