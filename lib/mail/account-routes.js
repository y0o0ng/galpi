'use strict';

const { CALLBACK } = require('./account-auth');
const { clientError } = require('./client-message');

const COOKIE = 'galpi_mail_oauth';
const BASE = '/api/mail-client/account-management';

function registerMailAccountRoutes(app, service) {
  if (!service) return;
  function binding(req) {
    const cookie = (req.get('cookie') || '').split(';').map(value => value.trim()).find(value => value.startsWith(COOKIE + '='));
    return cookie?.slice(COOKIE.length + 1);
  }
  const json = run => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (req.method === 'POST' && (!req.is('application/json') || !req.body || Array.isArray(req.body))) {
        throw clientError('MAIL_CLIENT_ACCOUNT_INPUT_INVALID', 400);
      }
      const data = await run(req, res);
      return res.json({ success: true, ...data });
    } catch (error) {
      const known = Number.isInteger(error?.statusCode) && /^(?:MAIL_CLIENT_|MAIL_PROVIDER_ACCOUNT_LIMIT$)/u.test(error?.code);
      return res.status(known ? error.statusCode : 500).json({
        success: false, code: known ? error.code : 'MAIL_CLIENT_INTERNAL_ERROR',
      });
    }
  };
  app.get(BASE, json(() => service.list()));
  app.post(BASE + '/imap', json(async req => ({ account: await service.connectImap(req.body) })));
  app.post(BASE + '/disconnect', json(req => {
    if (!Number.isSafeInteger(req.body.accountId) || req.body.accountId < 1) throw clientError('MAIL_CLIENT_ACCOUNT_INPUT_INVALID', 400);
    return { account: service.disconnect(req.body.accountId) };
  }));
  app.post(BASE + '/gmail/start', json((req, res) => {
    const { state, binding: cookie, secure, expiresIn, url } = service.startGmail(req.body.role, req.get('origin'));
    res.cookie(COOKIE, cookie, { httpOnly: true, secure, sameSite: 'lax', maxAge: expiresIn, path: '/api' });
    return { state, url };
  }));
  app.post(BASE + '/gmail/finish', json(req => service.finishGmail(req.body.state, binding(req))));
  app.get(CALLBACK, async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    try {
      await service.callback(req.query, binding(req));
      return res.type('text/plain').send('갈피에서 Gmail 연결 결과를 확인해 줘. 이 창은 닫아도 돼.');
    } catch {
      return res.status(400).type('text/plain').send('Gmail 연결 요청을 확인하지 못했어.');
    }
  });
}

module.exports = { registerMailAccountRoutes };
