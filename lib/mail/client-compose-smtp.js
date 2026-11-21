'use strict';

const nodemailer = require('nodemailer');
const { clientError } = require('./client-message');
const { smtpUserAddress } = require('./body');

const HOSTS = { naver: 'smtp.naver.com', works: 'smtp.worksmobile.com' };
const TIMEOUT = 15_000;
const unknown = { state: 'unknown', code: 'MAIL_CLIENT_COMPOSE_UNKNOWN' };

function prepareSmtp({ credentialsFor, createTransport = nodemailer.createTransport }, account) {
  const creds = credentialsFor(account);
  if (!creds?.user || !creds.pass || !HOSTS[account.provider]) {
    throw clientError('MAIL_CLIENT_WRITE_AUTH_REQUIRED', 503);
  }
  if (smtpUserAddress(account.provider, creds.user) !== account.address.toLowerCase()) {
    throw clientError('MAIL_CLIENT_ACCOUNT_MISMATCH', 503);
  }
  return async ({ raw, envelope }) => {
    let transport;
    try {
      transport = createTransport({
        host: HOSTS[account.provider], port: 465, secure: true, auth: { user: creds.user, pass: creds.pass },
        connectionTimeout: TIMEOUT, greetingTimeout: TIMEOUT, socketTimeout: TIMEOUT,
        disableFileAccess: true, disableUrlAccess: true,
      });
      const info = await transport.sendMail({ raw, envelope });
      const expected = new Set(envelope.to.map(address => address.toLowerCase()));
      const received = new Set(info.accepted?.filter(address => typeof address === 'string').map(address => address.toLowerCase()));
      if (!received.size || [...received].some(address => !expected.has(address))) return unknown;
      const partial = received.size < expected.size;
      return {
        state: 'sent',
        ...(partial ? { code: 'MAIL_CLIENT_SMTP_PARTIAL' } : {}),
        delivery: partial ? 'partial' : 'full',
        acceptedCount: received.size, rejectedCount: expected.size - received.size,
        sentCopyStatus: 'verification_required',
        ...(typeof info.messageId === 'string' && /^<[^<>\s]+>$/u.test(info.messageId) && info.messageId.length <= 255
          ? { providerMessageId: info.messageId } : {}),
      };
    } catch (error) {
      if (error.code === 'EAUTH') return { state: 'failed', code: 'MAIL_CLIENT_WRITE_AUTH_REQUIRED' };
      if (error.responseCode === 552 && /5\.3\.4|size|too large/i.test(error.response || '')) {
        return { state: 'failed', code: 'MAIL_CLIENT_COMPOSE_TOO_LARGE', statusCode: 413 };
      }
      if ((error.responseCode >= 400 && error.responseCode <= 599)
        || ['CONN', 'EHLO', 'HELO', 'AUTH', 'MAIL FROM', 'RCPT TO'].includes(error.command)) {
        return { state: 'failed', code: 'MAIL_CLIENT_SMTP_REJECTED' };
      }
      return unknown;
    }
  };
}

module.exports = { prepareSmtp };
