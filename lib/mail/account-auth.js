'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const { createGoogleTokenSource } = require('./gmail');
const { createImapFlowClient } = require('./naver');
const { clientError } = require('./client-message');
const { contactAddress } = require('./client-contacts');

const CALLBACK = '/api/mail/oauth/callback';
const PROFILE = 'https://gmail.googleapis.com/gmail/v1/users/me/profile?fields=emailAddress';
const SCOPES = {
  read: ['gmail.readonly'],
  modify: ['gmail.modify'],
  reply: ['gmail.compose', 'gmail.metadata'],
};
const IS_IMAP = new Set(['naver', 'works']);
const SESSION_MS = 10 * 60 * 1000;
const invalid = () => clientError('MAIL_CLIENT_ACCOUNT_INPUT_INVALID', 400);
const authRequired = () => Object.assign(new Error('Mail authentication required'), { code: 'MAIL_AUTH_REQUIRED' });
const storageError = () => clientError('MAIL_CLIENT_ACCOUNT_STORAGE_UNAVAILABLE', 503);
const random = () => randomBytes(32).toString('base64url');

function addressOf(provider, input) {
  if (typeof input !== 'string' || input.length > 320) throw invalid();
  let address = input.trim().toLowerCase();
  if (provider === 'naver' && !address.includes('@')) address += '@naver.com';
  if (!contactAddress.test(address) || (provider === 'naver' && !address.endsWith('@naver.com'))) throw invalid();
  return address;
}

function canonical(input) {
  const pieces = [];
  let current = path.resolve(input);
  while (!fs.existsSync(current)) {
    pieces.unshift(path.basename(current));
    current = path.dirname(current);
  }
  return path.join(fs.realpathSync(current), ...pieces);
}

function secretFile(file, forbidden) {
  const target = path.resolve(file);
  const dir = path.dirname(target);
  function validatePath() {
    const resolved = canonical(target);
    if (forbidden.filter(Boolean).map(canonical).some(root => {
      const relative = path.relative(root, resolved);
      return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
    })) throw storageError();
  }
  function privatePath(entry, directory) {
    const stat = fs.lstatSync(entry);
    if ((directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)
      || (stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) throw storageError();
  }
  return {
    read() {
      try {
        validatePath();
        if (!fs.existsSync(target)) return {};
        privatePath(dir, true);
        privatePath(target, false);
        const saved = JSON.parse(fs.readFileSync(target, 'utf8'));
        if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw storageError();
        return saved;
      } catch { throw storageError(); }
    },
    write(saved) {
      const temp = path.join(dir, '.' + random() + '.tmp');
      let fd;
      try {
        validatePath();
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        privatePath(dir, true);
        if (fs.existsSync(target)) privatePath(target, false);
        fd = fs.openSync(temp, 'wx', 0o600);
        fs.writeFileSync(fd, JSON.stringify(saved));
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
        fs.renameSync(temp, target);
      } catch { throw storageError(); }
      finally {
        if (fd !== undefined) fs.closeSync(fd);
        try { fs.unlinkSync(temp); } catch { /* renamed or not created */ }
      }
    },
  };
}

function redirectConfig(input) {
  try {
    const url = new URL(input);
    const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
    if (url.pathname !== CALLBACK || url.search || url.hash || url.username || url.password
      || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) return null;
    return url;
  } catch { return null; }
}

function createMailAccountAuth({ store, file, forbiddenPaths = [], gmail = {}, imap = {}, fetch: fetchImpl = globalThis.fetch,
  createImap = createImapFlowClient, now = Date.now, onChange = () => {}, onAuthRequired = () => {} }) {
  const secrets = secretFile(file, forbiddenPaths);
  let records = secrets.read();
  const revisions = { gmail: 0, naver: 0, works: 0 };
  const tokenSources = new Map();
  const sessions = new Map();
  const redirect = redirectConfig(gmail.redirectUri);
  const oauthEnabled = Boolean(redirect && gmail.clientId && gmail.clientSecret);
  const find = provider => store.listAccounts().find(account => account.provider === provider);
  const generation = account => revisions[account.provider];

  // A tombstone wins if the server stopped between the file and DB writes.
  for (const account of store.listAccounts()) {
    if (records[account.provider]?.credentials === null && account.status !== 'disabled') store.disableManagedAccount(account);
    else if (store.isManagedAccount(account.provider) && !records[account.provider]?.credentials && account.status === 'active') {
      store.markAccountError(account.id, { status: 'auth_required', errorCode: 'MAIL_AUTH_REQUIRED',
        nextSyncAt: Math.floor(now() / 1000) });
    }
  }

  function replace(provider, record, mutate) {
    const next = { ...records, [provider]: record };
    secrets.write(next);
    // The on-disk and live resolution both fail closed while the DB transition completes.
    records = next;
    revisions[provider] += 1;
    if (provider === 'gmail') tokenSources.clear();
    const account = mutate();
    onChange(account);
    return publicAccount(account);
  }

  function checkIdentity(provider, address) {
    const current = find(provider);
    if (current && current.address !== address) throw clientError('MAIL_PROVIDER_ACCOUNT_LIMIT', 409);
    return current;
  }

  function source(provider) {
    const record = records[provider];
    if (record) return record;
    return store.isManagedAccount(provider) ? { credentials: null } : null;
  }

  function publicAccount(account) {
    const managed = source(account.provider);
    const credential = managed?.credentials;
    return {
      id: account.id, provider: account.provider, address: account.address, status: account.status, lastSyncAt: account.lastSyncAt,
      ...(account.provider === 'gmail' ? { managed: Boolean(managed), permissions: {
        modify: Boolean(managed ? credential?.modify : gmail.modify),
        reply: Boolean(managed ? credential?.reply : gmail.reply),
      } } : {}),
    };
  }

  function currentFor(account) {
    const id = account.accountId ?? account.id;
    const current = id ? store.getAccount(id) : find(account.provider);
    const address = account.address || account.accountAddress;
    return current?.provider === account.provider && current.address === address?.toLowerCase()
      && !['disabled', 'auth_required'].includes(current.status) ? current : null;
  }

  function imapCredentials(account) {
    if (!currentFor(account)) return {};
    const managed = source(account.provider);
    if (managed && managed.address !== account.address?.toLowerCase()
      && managed.address !== account.accountAddress?.toLowerCase()) return {};
    const base = imap[account.provider] || {};
    const data = managed ? managed.credentials : base;
    if (!data?.user || !data.pass) return {};
    try {
      if (addressOf(account.provider, data.user) !== (account.address || account.accountAddress).toLowerCase()) return {};
    } catch { return {}; }
    return { host: base.host, port: base.port, user: data.user, pass: data.pass };
  }

  function noteAuthRequired(account, version) {
    if (generation(account) !== version || !currentFor(account)) return;
    const time = Math.floor(now() / 1000);
    store.markAccountError(account.id, { status: 'auth_required', errorCode: 'MAIL_AUTH_REQUIRED', nextSyncAt: time }, time);
    if (store.claimAuthAlert(account.id, time)) onAuthRequired(account);
  }

  const fetchGoogle = (url, options) => fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(12_000) });
  async function gmailAddress(token) {
    let response;
    try { response = await fetchGoogle(PROFILE, { headers: { authorization: 'Bearer ' + token } }); }
    catch { throw clientError('MAIL_CLIENT_PROVIDER_UNAVAILABLE', 503); }
    if ([401, 403].includes(response.status)) throw authRequired();
    if (!response.ok) throw clientError('MAIL_CLIENT_PROVIDER_UNAVAILABLE', 503);
    const data = await response.json().catch(() => ({}));
    return addressOf('gmail', data.emailAddress);
  }

  function gmailTokens(role, legacyRole = role) {
    return {
      async getAccessToken(options) {
        const account = find('gmail');
        if (!account || !currentFor(account)) throw authRequired();
        const managed = source('gmail');
        const token = managed ? (managed.address === account.address ? managed.credentials?.[role] : null) : gmail[legacyRole];
        const version = generation(account);
        if (!token) {
          if (role === 'read') noteAuthRequired(account, version);
          throw authRequired();
        }
        const key = managed ? role : 'legacy:' + legacyRole;
        if (!tokenSources.has(key)) {
          tokenSources.set(key, { source: createGoogleTokenSource({
            credentials: { clientId: gmail.clientId, clientSecret: gmail.clientSecret, refreshToken: token },
            fetch: fetchGoogle,
            onRefreshToken: replacement => {
              if (!managed || generation(account) !== version) return;
              const record = records.gmail;
              const next = { ...records, gmail: { ...record, credentials: { ...record.credentials, [role]: replacement } } };
              secrets.write(next);
              records = next;
            },
          }) });
        }
        const entry = tokenSources.get(key);
        try {
          const access = await entry.source.getAccessToken(options);
          // Legacy read credentials precede the UI identity check. Verify before the Agent can use them.
          if (!managed && role === 'read') {
            if (entry.checked !== access) {
              entry.checked = access;
              entry.identity = gmailAddress(access).catch(error => {
                entry.checked = null;
                if (error.code === 'MAIL_AUTH_REQUIRED') throw error;
                throw Object.assign(new Error('Gmail profile lookup failed'), { code: 'MAIL_HTTP_FAILED', retryable: true });
              });
            }
            if (await entry.identity !== account.address) throw authRequired();
          }
          if (generation(account) !== version || !currentFor(account)) throw authRequired();
          return access;
        } catch (error) {
          if (role === 'read' && error.code === 'MAIL_AUTH_REQUIRED') noteAuthRequired(account, version);
          throw error;
        }
      },
    };
  }

  function sessionFor(state, binding) {
    const session = typeof state === 'string' ? sessions.get(state) : null;
    if (!session || session.until <= now() || typeof binding !== 'string'
      || !/^[A-Za-z0-9_-]{43}$/u.test(binding)
      || !timingSafeEqual(Buffer.from(session.binding), Buffer.from(binding))) throw clientError('MAIL_CLIENT_OAUTH_STATE_INVALID', 400);
    return session;
  }

  return {
    list: () => ({ accounts: store.listAccounts().map(publicAccount), gmailOAuthEnabled: oauthEnabled }),
    generation,
    noteAuthRequired,
    imapCredentials,
    gmailTokens,
    agentCredentials(account) {
      if (!currentFor(account)) throw authRequired();
      if (account.provider === 'gmail') return {};
      const data = imapCredentials(account);
      if (!data.user) throw authRequired();
      return data;
    },
    async connectImap({ provider, email, password } = {}) {
      if (!IS_IMAP.has(provider) || typeof password !== 'string' || !password.trim()
        || password.length > 512 || /[\u0000-\u001f\u007f]/u.test(password)) throw invalid();
      const address = addressOf(provider, email);
      checkIdentity(provider, address);
      const version = revisions[provider];
      const credentials = { user: address, pass: password };
      const config = imap[provider] || {};
      const client = createImap({ host: config.host, port: config.port, ...credentials },
        { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 12_000 });
      try {
        // Authenticate with the full registered mailbox address, never an independent login name.
        await client.connect();
        const box = await client.getMailboxLock('INBOX', { readOnly: true });
        box.release();
      } catch (error) {
        throw clientError(error?.authenticationFailed ? 'MAIL_CLIENT_AUTH_REQUIRED' : 'MAIL_CLIENT_PROVIDER_UNAVAILABLE', 503);
      } finally {
        if (client.usable) await client.logout().catch(() => {});
        else client.close?.();
      }
      if (version !== revisions[provider]) throw clientError('MAIL_CLIENT_ACCOUNT_CHANGED', 409);
      checkIdentity(provider, address);
      return replace(provider, { address, credentials }, () => store.activateManagedAccount(provider, address));
    },
    disconnect(id) {
      const account = store.getAccount(id);
      if (!account) throw clientError('MAIL_CLIENT_ACCOUNT_NOT_FOUND', 404);
      const disabled = replace(account.provider, { address: account.address, credentials: null }, () => store.disableManagedAccount(account));
      if (account.provider === 'gmail') sessions.clear();
      return disabled;
    },
    startGmail(role, origin) {
      if (!oauthEnabled) throw clientError('MAIL_CLIENT_OAUTH_UNAVAILABLE', 503);
      if (typeof role !== 'string' || !Object.hasOwn(SCOPES, role) || (origin && origin !== redirect.origin)) throw invalid();
      const account = find('gmail');
      if (role !== 'read' && (!account || !currentFor(account) || !records.gmail?.credentials?.read)) {
        throw clientError('MAIL_CLIENT_OAUTH_READ_REQUIRED', 409);
      }
      for (const [id, item] of sessions) if (item.until <= now()) sessions.delete(id);
      if (sessions.size >= 64) throw clientError('MAIL_CLIENT_OAUTH_BUSY', 503);
      const state = random();
      const binding = random();
      const verifier = random();
      sessions.set(state, { binding, verifier, role, version: revisions.gmail, until: now() + SESSION_MS, status: 'pending' });
      setTimeout(() => sessions.delete(state), SESSION_MS).unref();
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({
        client_id: gmail.clientId, redirect_uri: redirect.href, response_type: 'code', access_type: 'offline',
        prompt: 'consent', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256', scope: SCOPES[role].map(name => 'https://www.googleapis.com/auth/' + name).join(' '),
        ...(account ? { login_hint: account.address } : {}),
      });
      return { state, binding, secure: redirect.protocol === 'https:', expiresIn: SESSION_MS, url: url.href };
    },
    async callback({ state, code, error }, binding) {
      const session = sessionFor(state, binding);
      if (session.status !== 'pending') throw clientError('MAIL_CLIENT_OAUTH_STATE_INVALID', 400);
      session.status = 'verifying';
      const verifier = session.verifier;
      delete session.verifier;
      try {
        if (error || typeof code !== 'string' || !code || code.length > 2048) throw clientError('MAIL_CLIENT_OAUTH_CANCELLED', 400);
        const response = await fetchGoogle('https://oauth2.googleapis.com/token', {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: gmail.clientId, client_secret: gmail.clientSecret, redirect_uri: redirect.href,
            grant_type: 'authorization_code', code, code_verifier: verifier }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || typeof payload.refresh_token !== 'string' || !payload.refresh_token
          || typeof payload.access_token !== 'string' || !payload.access_token) throw clientError('MAIL_CLIENT_OAUTH_GRANT_FAILED', 400);
        const scopes = new Set(String(payload.scope || '').split(/\s+/u));
        if (SCOPES[session.role].some(scope => !scopes.has('https://www.googleapis.com/auth/' + scope))) {
          throw clientError('MAIL_CLIENT_OAUTH_SCOPE_REQUIRED', 400);
        }
        const address = await gmailAddress(payload.access_token);
        checkIdentity('gmail', address);
        if (session.until <= now() || session.version !== revisions.gmail) throw clientError('MAIL_CLIENT_ACCOUNT_CHANGED', 409);
        session.status = 'ready';
        session.address = address;
        session.refreshToken = payload.refresh_token;
      } catch (problem) {
        session.status = 'failed';
        session.error = problem?.code?.startsWith('MAIL_CLIENT_') || problem?.code === 'MAIL_PROVIDER_ACCOUNT_LIMIT'
          ? problem.code : 'MAIL_CLIENT_OAUTH_GRANT_FAILED';
      }
    },
    finishGmail(state, binding) {
      const session = sessionFor(state, binding);
      if (session.status === 'failed') throw clientError(session.error,
        ['MAIL_PROVIDER_ACCOUNT_LIMIT', 'MAIL_CLIENT_ACCOUNT_CHANGED'].includes(session.error) ? 409 : 400);
      if (session.status === 'done') return { status: 'done', account: session.account };
      if (session.status !== 'ready') return { status: 'pending' };
      if (session.version !== revisions.gmail) throw clientError('MAIL_CLIENT_ACCOUNT_CHANGED', 409);
      checkIdentity('gmail', session.address);
      const previous = records.gmail?.address === session.address ? records.gmail.credentials : null;
      const credentials = { ...previous, [session.role]: session.refreshToken };
      session.account = replace('gmail', { address: session.address, credentials },
        () => store.activateManagedAccount('gmail', session.address));
      delete session.refreshToken;
      session.status = 'done';
      return { status: 'done', account: session.account };
    },
  };
}

module.exports = { CALLBACK, createMailAccountAuth };
