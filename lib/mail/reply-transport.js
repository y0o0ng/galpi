'use strict';

const nodemailer = require('nodemailer');
const { smtpUserAddress } = require('./body');

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const SMTP_HOSTS = { naver: 'smtp.naver.com', works: 'smtp.worksmobile.com' };
const TIMEOUT_MS = 15_000;

function failed(errorCode) {
  return { state: 'failed', errorCode };
}

function unknown() {
  return { state: 'unknown', errorCode: 'MAIL_REPLY_RESULT_UNKNOWN' };
}

function createMailReplyTransport({ gmailTokens, smtpCredentials, credentialVersion, fetch: fetchImpl = globalThis.fetch,
  createTransport = nodemailer.createTransport } = {}) {
  const composer = createTransport({ streamTransport: true, buffer: true, newline: 'windows' });

  async function sendGmail(target, mail) {
    if (!gmailTokens) return failed('MAIL_REPLY_AUTH_REQUIRED');
    const version = credentialVersion?.(target);
    let headers;
    let raw;
    try {
      const token = await gmailTokens.getAccessToken();
      headers = { authorization: 'Bearer ' + token };
      const profile = await fetchImpl(GMAIL_API + '/profile', { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if ([401, 403].includes(profile.status)) return failed('MAIL_REPLY_AUTH_REQUIRED');
      if (!profile.ok) return failed('MAIL_REPLY_PREFLIGHT_FAILED');
      const { emailAddress } = await profile.json();
      if (emailAddress?.toLowerCase() !== target.accountAddress.toLowerCase()) {
        return failed('MAIL_REPLY_ACCOUNT_MISMATCH');
      }
      const original = await fetchImpl(
        GMAIL_API + '/messages/' + encodeURIComponent(target.gmailMessageId) + '?format=minimal',
        { headers, signal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      if ([401, 403].includes(original.status)) return failed('MAIL_REPLY_AUTH_REQUIRED');
      if (!original.ok) return failed('MAIL_REPLY_PREFLIGHT_FAILED');
      const { id, threadId } = await original.json();
      if (id !== target.gmailMessageId || threadId !== target.threadId) {
        return failed('MAIL_REPLY_IDENTITY_MISMATCH');
      }
      const { message } = await composer.sendMail(mail);
      raw = message.toString('base64url');
    } catch (error) {
      return failed(error?.code === 'MAIL_AUTH_REQUIRED' ? 'MAIL_REPLY_AUTH_REQUIRED' : 'MAIL_REPLY_PREFLIGHT_FAILED');
    }
    if (credentialVersion?.(target) !== version) return failed('MAIL_REPLY_AUTH_REQUIRED');
    try {
      const sent = await fetchImpl(GMAIL_API + '/messages/send', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ raw, threadId: target.threadId }),
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if ([401, 403].includes(sent.status)) return failed('MAIL_REPLY_AUTH_REQUIRED');
      if (sent.status >= 400 && sent.status < 500 && sent.status !== 408) return failed('MAIL_REPLY_REJECTED');
      if (!sent.ok) return unknown();
      const { id, threadId } = await sent.json();
      return typeof id === 'string' && id && threadId === target.threadId
        ? { state: 'sent', providerMessageId: id }
        : unknown();
    } catch {
      return unknown();
    }
  }

  async function sendSmtp(target, mail, host) {
    const credentials = smtpCredentials?.(target);
    if (!credentials?.user || !credentials?.pass) return failed('MAIL_REPLY_AUTH_REQUIRED');
    if (smtpUserAddress(target.provider, credentials.user) !== target.accountAddress.toLowerCase()) {
      return failed('MAIL_REPLY_ACCOUNT_MISMATCH');
    }
    try {
      const client = createTransport({
        host,
        port: 465,
        secure: true,
        auth: { user: credentials.user, pass: credentials.pass },
        connectionTimeout: TIMEOUT_MS,
        greetingTimeout: TIMEOUT_MS,
        socketTimeout: TIMEOUT_MS,
      });
      const sent = await client.sendMail(mail);
      return sent.accepted?.length === 1 && sent.accepted[0] === target.to
        ? { state: 'sent', providerMessageId: sent.messageId }
        : unknown();
    } catch (error) {
      if (error?.code === 'EAUTH') return failed('MAIL_REPLY_AUTH_REQUIRED');
      if (error?.responseCode >= 400 && error.responseCode <= 599) return failed('MAIL_REPLY_REJECTED');
      return unknown();
    }
  }

  return async function transmit(target, text) {
    const subject = target.subject.replace(/[\r\n]+/g, ' ');
    const mail = {
      from: { name: '', address: target.accountAddress },
      to: { name: '', address: target.to },
      subject: /^re:/i.test(subject) ? subject : 'Re: ' + subject,
      inReplyTo: target.messageId,
      references: target.references,
      text,
      disableFileAccess: true,
      disableUrlAccess: true,
    };
    if (target.provider === 'gmail') return sendGmail(target, mail);
    const host = SMTP_HOSTS[target.provider];
    return host ? sendSmtp(target, mail, host) : failed('MAIL_REPLY_ACCOUNT_UNAVAILABLE');
  };
}

module.exports = { createMailReplyTransport };
