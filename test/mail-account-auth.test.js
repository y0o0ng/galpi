'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { migrations } = require('../lib/database-migrations');
const { createMailStore } = require('../lib/mail/store');
const { createMailAccountAuth, CALLBACK } = require('../lib/mail/account-auth');

const origin = 'http://127.0.0.1:4242';
const gmail = { clientId: 'fake-client', clientSecret: 'fake-client-secret', read: 'env-read',
  modify: 'env-modify', reply: 'env-send', redirectUri: origin + CALLBACK };
const imap = {
  naver: { user: 'owner', pass: 'env-naver', host: 'imap.naver.com', port: 993 },
  works: { user: 'work@school.example', pass: 'env-works', host: 'imap.worksmobile.com', port: 993 },
};

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'galpi-mail-account-'));
  const file = path.join(root, 'private', 'mail.json');
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, created_at INTEGER)');
  for (const version of [7, 9, 19, 20, 21, 45]) migrations.find(migration => migration.version === version).up(db);
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const store = createMailStore(db, { now: () => 1000 });
  const create = override => createMailAccountAuth({
    store, file, gmail, imap, forbiddenPaths: [path.join(root, 'vault'), path.join(root, 'backup')],
    ...options, ...override,
  });
  return { store, db, file, root, create };
}

test('IMAP verifies the registered login, replaces only validated credentials and retains account data', async t => {
  const connections = [];
  const { store, db, file, create } = fixture(t, { createImap: config => {
    connections.push(config);
    return {
      usable: true,
      async connect() {
        if (config.pass === 'wrong') throw Object.assign(new Error('wrong fake password'), { authenticationFailed: true });
      },
      async getMailboxLock(mailbox, options) {
        assert.equal(mailbox, 'INBOX');
        assert.deepEqual(options, { readOnly: true });
        return { release() {} };
      },
      async logout() {},
    };
  } });
  const naver = store.registerAccount({ provider: 'naver', address: 'owner@naver.com' });
  const works = store.registerAccount({ provider: 'works', address: 'work@school.example' });
  store.commitImapCursor(naver.id, { mailbox: 'INBOX', uidValidity: '0', lastUid: 42 });
  store.saveMessage({ accountId: naver.id, identityKind: 'fingerprint', identityKey: 'test-42', receivedAt: 999 });
  const auth = create();
  assert.equal(auth.agentCredentials(naver).pass, 'env-naver');
  assert.equal(auth.imapCredentials(works).pass, 'env-works');
  await assert.rejects(auth.connectImap({ provider: 'naver', email: 'different@naver.com', password: 'secret' }),
    { code: 'MAIL_PROVIDER_ACCOUNT_LIMIT' });
  assert.equal(connections.length, 0);
  const connect = password => auth.connectImap({ provider: 'naver', email: 'Owner@naver.com', password });
  assert.equal((await connect('naver-new-secret')).id, naver.id);
  assert.equal(connections[0].host, imap.naver.host);
  assert.equal(connections[0].user, 'owner@naver.com');
  await assert.rejects(connect('wrong'), { code: 'MAIL_CLIENT_AUTH_REQUIRED' });
  assert.equal(auth.imapCredentials(naver).pass, 'naver-new-secret');

  const worksData = { provider: 'works', email: works.address };
  await assert.rejects(auth.connectImap({ ...worksData, password: 'wrong' }), { code: 'MAIL_CLIENT_AUTH_REQUIRED' });
  assert.equal(auth.imapCredentials(works).pass, 'env-works');
  assert.equal((await auth.connectImap({ ...worksData, password: 'works-new-secret' })).id, works.id);
  assert.equal(connections.at(-1).host, imap.works.host);
  assert.equal(connections.at(-1).user, works.address);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.doesNotMatch(JSON.stringify(auth.list()), /new-secret/);
  assert.doesNotMatch(JSON.stringify(db.prepare('SELECT * FROM app_settings').all()), /new-secret/);

  assert.equal(auth.disconnect(naver.id).status, 'disabled');
  assert.equal(auth.disconnect(naver.id).status, 'disabled');
  assert.throws(() => auth.agentCredentials(naver), { code: 'MAIL_AUTH_REQUIRED' });
  assert.deepEqual(create().imapCredentials(naver), {});
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /naver-new-secret/);
  assert.equal(create().imapCredentials(works).pass, 'works-new-secret');
  assert.deepEqual(store.listDueAccounts(1000).map(item => item.id), [works.id]);
  assert.equal(store.getSyncState(naver.id).imapLastUid, 42);
  assert.equal(db.prepare('SELECT count(*) AS count FROM mail_messages WHERE account_id = ?').get(naver.id).count, 1);

  fs.rmSync(file);
  const restarted = create();
  assert.deepEqual(restarted.imapCredentials(naver), {});
  assert.deepEqual(restarted.imapCredentials(works), {});
  assert.equal(store.getAccount(works.id).status, 'auth_required');
  const reconnected = await restarted.connectImap({ provider: 'naver', email: naver.address, password: 'reconnected-secret' });
  assert.equal(reconnected.id, naver.id);
  assert.equal(reconnected.status, 'active');
  assert.equal(store.getSyncState(naver.id).imapLastUid, 42);
  assert.deepEqual(store.listDueAccounts(1000).map(item => item.id), [naver.id]);
});

test('Gmail binds verified consent to the authenticated browser, separates grants and replaces the shared read cache', async t => {
  const commands = new Map();
  const refreshes = [];
  const alerts = [];
  let clock = 1_000_000;
  let profile = 'owner@gmail.com';
  let invalidToken;
  const fetch = async (url, { body: input }) => {
    if (url.includes('/profile')) return Response.json({ emailAddress: profile });
    const body = new URLSearchParams(input);
    if (body.get('grant_type') === 'refresh_token') {
      const refresh = body.get('refresh_token');
      refreshes.push(refresh);
      if (refresh === invalidToken) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      return Response.json({ access_token: 'access:' + refresh, expires_in: 3600 });
    }
    const code = body.get('code');
    const challenge = createHash('sha256').update(body.get('code_verifier')).digest('base64url');
    const command = commands.get(code);
    assert.equal(challenge, command.challenge);
    assert.equal(body.get('redirect_uri'), origin + CALLBACK);
    return Response.json({ access_token: 'callback-access', refresh_token: code, scope: command.scopes });
  };
  const { store, db, file, create } = fixture(t, { fetch, now: () => clock, onAuthRequired: account => alerts.push(account.id) });
  const account = store.registerAccount({ provider: 'gmail', address: profile });
  store.commitGmailCursor(account.id, '173');
  const auth = create();
  const sharedRead = auth.gmailTokens('read');
  assert.deepEqual(await Promise.all([sharedRead.getAccessToken(), sharedRead.getAccessToken()]), ['access:env-read', 'access:env-read']);
  assert.deepEqual(refreshes, ['env-read']);
  assert.throws(() => auth.startGmail('read', 'https://different.example'), { code: 'MAIL_CLIENT_ACCOUNT_INPUT_INVALID' });
  assert.throws(() => auth.startGmail('reply', origin), { code: 'MAIL_CLIENT_OAUTH_READ_REQUIRED' });
  const issue = (role, code, granted) => {
    const start = auth.startGmail(role, origin);
    const params = new URL(start.url).searchParams;
    const scopes = params.get('scope');
    commands.set(code, { challenge: params.get('code_challenge'), scopes: granted ?? scopes });
    return { start, scopes, params, callback: binding => auth.callback({ state: start.state, code }, binding ?? start.binding),
      finish: () => auth.finishGmail(start.state, start.binding) };
  };

  const wrong = issue('read', 'wrong-address');
  profile = 'different@gmail.com';
  await wrong.callback();
  assert.throws(wrong.finish, { code: 'MAIL_PROVIDER_ACCOUNT_LIMIT' });
  assert.equal(fs.existsSync(file), false);
  profile = account.address;

  const read = issue('read', 'new-read');
  assert.deepEqual(read.scopes, 'https://www.googleapis.com/auth/gmail.readonly');
  assert.equal(read.params.get('login_hint'), account.address);
  assert.equal(read.params.get('code_challenge_method'), 'S256');
  assert.equal(read.params.get('state'), read.start.state);
  await assert.rejects(auth.callback({ state: read.start.state, code: 'new-read' }), { code: 'MAIL_CLIENT_OAUTH_STATE_INVALID' });
  await assert.rejects(read.callback('z'.repeat(43)), { code: 'MAIL_CLIENT_OAUTH_STATE_INVALID' });
  assert.deepEqual(read.finish(), { status: 'pending' });
  await read.callback();
  await assert.rejects(read.callback(), { code: 'MAIL_CLIENT_OAUTH_STATE_INVALID' });
  assert.equal(fs.existsSync(file), false);
  assert.equal(read.finish().account.id, account.id);
  assert.deepEqual(read.finish().account.permissions, { modify: false, reply: false });
  await assert.rejects(auth.gmailTokens('modify').getAccessToken(), { code: 'MAIL_AUTH_REQUIRED' });
  await assert.rejects(auth.gmailTokens('reply', 'modify').getAccessToken(), { code: 'MAIL_AUTH_REQUIRED' });
  assert.deepEqual(await Promise.all([sharedRead.getAccessToken(), sharedRead.getAccessToken()]), ['access:new-read', 'access:new-read']);
  assert.deepEqual(refreshes, ['env-read', 'new-read']);

  const rejected = issue('modify', 'missing-scope', read.scopes);
  await rejected.callback();
  assert.throws(rejected.finish, { code: 'MAIL_CLIENT_OAUTH_SCOPE_REQUIRED' });
  const modify = issue('modify', 'new-modify');
  assert.match(modify.scopes, /gmail\.modify$/);
  await modify.callback();
  assert.deepEqual(modify.finish().account.permissions, { modify: true, reply: false });
  const reply = issue('reply', 'new-send');
  assert.deepEqual(reply.scopes.split(' ').map(scope => scope.split('/').at(-1)), ['gmail.compose', 'gmail.metadata']);
  await reply.callback();
  assert.deepEqual(reply.finish().account.permissions, { modify: true, reply: true });
  assert.equal(await auth.gmailTokens('modify').getAccessToken(), 'access:new-modify');
  assert.equal(await auth.gmailTokens('reply').getAccessToken(), 'access:new-send');
  assert.doesNotMatch(JSON.stringify(db.prepare('SELECT * FROM app_settings').all()), /new-read|new-modify|new-send|fake-client-secret/);

  invalidToken = 'new-read';
  await assert.rejects(sharedRead.getAccessToken({ force: true }), { code: 'MAIL_AUTH_REQUIRED' });
  assert.equal(auth.list().accounts[0].status, 'auth_required');
  assert.deepEqual(alerts, [account.id]);
  assert.equal(store.listDueAccounts(1000).length, 0);
  const reauth = issue('read', 'recovered');
  await reauth.callback();
  assert.equal(reauth.finish().account.status, 'active');
  assert.equal(await sharedRead.getAccessToken(), 'access:recovered');
  assert.equal(store.getSyncState(account.id).gmailHistoryId, '173');
  assert.deepEqual(store.listDueAccounts(1000).map(item => item.id), [account.id]);

  const expired = issue('read', 'expired');
  clock += 600_001;
  await assert.rejects(expired.callback(), { code: 'MAIL_CLIENT_OAUTH_STATE_INVALID' });
  const pending = issue('read', 'pending-disconnect');
  await pending.callback();
  auth.disconnect(account.id);
  assert.throws(pending.finish, { code: 'MAIL_CLIENT_OAUTH_STATE_INVALID' });
  await assert.rejects(create().gmailTokens('read').getAccessToken(), { code: 'MAIL_AUTH_REQUIRED' });
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /recovered|new-modify|new-send|pending-disconnect/);
});

test('managed credentials cannot be stored under the Vault or read from a public file', t => {
  const { file, root, create } = fixture(t);
  assert.throws(() => create({ file: path.join(root, 'vault', 'secret.json') }), { code: 'MAIL_CLIENT_ACCOUNT_STORAGE_UNAVAILABLE' });
  fs.mkdirSync(path.dirname(file), { mode: 0o700 });
  fs.writeFileSync(file, '{}', { mode: 0o644 });
  assert.throws(() => create(), { code: 'MAIL_CLIENT_ACCOUNT_STORAGE_UNAVAILABLE' });
});
