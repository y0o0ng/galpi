'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const Database = require('better-sqlite3');
const { migrations } = require('../lib/database-migrations');
const { createMailClientCompose } = require('../lib/mail/client-compose');
const { createGmailCompose } = require('../lib/mail/client-compose-gmail');
const { createImapDrafts } = require('../lib/mail/client-compose-imap');
const { buildMime, parse, MAX_ATTACHMENT_BYTES } = require('../lib/mail/client-compose-mime');
const { createComposeUploads } = require('../lib/mail/client-compose-uploads');
const { registerMailClientComposeRoutes } = require('../lib/mail/client-routes');

const ACCOUNTS = [
  { id: 1, address: 'me@gmail.com', provider: 'gmail' },
  { id: 2, address: 'me@naver.com', provider: 'naver' },
  { id: 3, address: 'me@example.com', provider: 'works' },
];
const COMPOSE = { kind: 'new', to: ['to@example.com'], text: 'Private message body', subject: 'Subject' };

function gmailFixture() {
  const drafts = new Map();
  const calls = [];
  let seq = 0;
  const control = {};
  const json = (data, status) => new Response(JSON.stringify(data), { status });
  const gmail = createGmailCompose({
    tokenSource: { getAccessToken: async () => 'test-token' },
    async fetch(url, init) {
      const path = new URL(url).pathname.split('/users/me')[1];
      const payload = init.body && JSON.parse(init.body);
      calls.push({ path, method: init.method, payload });
      if (path === '/profile') return json({ emailAddress: control.address ?? ACCOUNTS[0].address });
      if (path === '/drafts' && init.method === 'GET') return json({ drafts: [...drafts.values()] });
      if (path === '/messages/send' || path === '/drafts/send') {
        if (control.unknown) throw new Error('timeout');
        if (control.status) return json({}, control.status);
        if (path === '/drafts/send') {
          assert.ok(drafts.has(payload.id));
          drafts.delete(payload.id);
        }
        return json({ id: 'sent-' + ++seq });
      }
      const [, , draftId] = path.split('/');
      if (init.method === 'GET') {
        control.onOpen?.(draftId, drafts);
        return drafts.has(draftId) ? json(drafts.get(draftId)) : json({}, 404);
      }
      if (init.method === 'PUT' || init.method === 'POST') {
        const id = draftId || 'draft-' + ++seq;
        const entry = { id, message: { ...payload.message, id: 'message-' + ++seq } };
        drafts.set(id, entry);
        return json(entry);
      }
      throw new Error('unexpected request');
    },
  });
  return { gmail, drafts, calls, control };
}

function imapFixture() {
  const folders = [
    { path: 'INBOX', flags: new Set(), specialUse: '\\Inbox' },
    { path: 'Temp', flags: new Set(['\\Drafts']), specialUse: '\\Drafts' },
    { path: 'Bin', flags: new Set(['\\Trash']), specialUse: '\\Trash' },
    { path: 'Sent', flags: new Set(['\\Sent']), specialUse: '\\Sent' },
  ];
  const events = [];
  const store = new Map();
  const control = { validity: 0n, capabilities: new Map([['MOVE', true]]) };
  const credentialsFor = account => ({ user: account.provider === 'naver' ? 'me' : account.address, pass: 'secret' });

  function boxStore(user) {
    if (!store.has(user)) store.set(user, { next: 1, messages: new Map() });
    return store.get(user);
  }

  const imap = createImapDrafts({
    credentialsFor,
    createClient(creds) {
      const box = boxStore(creds.user);
      return {
        usable: true,
        enabled: new Set(),
        capabilities: control.capabilities,
        async connect() {},
        async logout() {},
        async list() { return folders; },
        async getMailboxLock(path, { readOnly }) {
          assert.equal(path, 'Temp');
          this.mailbox = { uidValidity: control.validity, uidNext: box.next, readOnly };
          events.push(['lock', creds.user, readOnly]);
          return { release() {} };
        },
        async search(query, options) {
          assert.equal(options.uid, true);
          events.push(['search', query]);
          const [low, high] = query.uid.split(':').map(Number);
          return [...box.messages].filter(([uid, raw]) => uid >= low && uid <= high
            && (!query.header || raw.includes(query.header['X-Galpi-Draft-Id']))).map(([uid]) => uid);
        },
        async fetchOne(uid, query, opts) {
          if (uid === '*') return { uid: Math.max(...box.messages.keys()) };
          assert.equal(opts.uid, true);
          assert.ok(query.source.maxLength > 0);
          const raw = box.messages.get(uid);
          return raw && { uid, source: raw, size: raw.length, flags: new Set(['\\Draft']) };
        },
        async append(path, raw, flags) {
          assert.equal(this.mailbox.readOnly, false);
          assert.equal(path, 'Temp');
          assert.deepEqual(flags, ['\\Draft']);
          events.push(['append', path]);
          if (control.appendNeverVisible) throw new Error('append response lost');
          const uid = box.next++;
          box.messages.set(uid, Buffer.from(raw));
          if (control.loseAppendAck) throw new Error('append response lost after commit');
          return control.noUid ? {} : { uid, uidValidity: control.validity };
        },
        async exec(command, args) {
          assert.equal(command, 'UID MOVE');
          assert.equal(args[1].value, 'Bin');
          events.push(['move', Number(args[0].value)]);
          if (control.moveFails) throw new Error('no response');
          box.messages.delete(Number(args[0].value));
          return { response: { command: 'OK' }, next() {} };
        },
      };
    },
  });
  return { imap, events, control, folders, boxStore, credentialsFor };
}

function setup(t, overrides = {}) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, created_at INTEGER)');
  for (const version of [7, 9, 19, 20, 21, 45, 47]) migrations.find(migration => migration.version === version).up(db);
  const g = gmailFixture();
  const i = imapFixture();
  const observations = { invalidations: 0, smtp: [] };
  const smtp = {};
  const source = { raw: null };
  const agentStore = {
    getAccount: id => ACCOUNTS.find(account => account.id === id),
  };
  const options = {
    db, agentStore, gmail: g.gmail, imap: i.imap, credentialsFor: i.credentialsFor,
    mailClient: {
      async openSource(id, accountId) {
        assert.equal(id, 75);
        assert.equal(accountId, source.accountId ?? 2);
        return { raw: source.raw, row: { metadata: { threadId: 'original-thread' } } };
      },
      invalidateCursors() { observations.invalidations += 1; },
    },
    writeEnabled: true, sendEnabled: true,
    createTransport(config) {
      return {
        async sendMail({ raw, envelope }) {
          observations.smtp.push({ config, raw, envelope });
          if (smtp.error) throw smtp.error;
          return { accepted: smtp.accepted ?? envelope.to, messageId: '<smtp@example.com>' };
        },
      };
    },
    ...overrides,
  };
  return { db, g, i, observations, smtp, source, api: createMailClientCompose(options), options };
}

function sourceMessage() {
  const head = [
    'From: sender@example.com', 'Reply-To: replies@example.com',
    'To: me@naver.com, colleague@example.com', 'Cc: COLLEAGUE@example.com, reviewer@example.com',
    'Bcc: original-hidden@example.com', 'Subject: Meeting', 'Message-ID: <meeting@example.com>',
    'References: <earlier@example.com>', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="bound"',
    '', '--bound', 'Content-Type: text/plain; charset=utf-8', '', 'Original body',
    '--bound', 'Content-Type: application/octet-stream', 'Content-Disposition: attachment; filename="original.bin"',
    'Content-Transfer-Encoding: base64', '', 'YWJj', '--bound--', '',
  ];
  return Buffer.from(head.join('\r\n'));
}

test('Gmail creates, reads, updates and sends a draft with stable draft ID and fresh message ID', async t => {
  const { api, g, observations } = setup(t);
  const saved = await api.save(1, 'gmail-create', { ...COMPOSE, bcc: ['private@example.com'], html: '<b>Draft</b>' });
  assert.equal(saved.state, 'saved');
  const first = await api.detail(1, saved.draftId);
  assert.deepEqual(first.bcc, ['private@example.com']);
  assert.equal(first.htmlSource.trim(), '<b>Draft</b>');
  assert.equal((await api.list(1, null, 10)).drafts[0].id, first.id);
  const update = await api.save(1, 'gmail-update', { ...COMPOSE, text: 'Updated' }, first.id, first.version);
  assert.equal(update.draftId, first.id);
  const next = await api.detail(1, first.id);
  assert.notEqual(next.version, first.version);
  assert.notEqual(next.messageId, first.messageId);
  const sent = await api.send(1, 'gmail-send', null, next.id, next.version);
  assert.equal(sent.state, 'sent');
  assert.equal(sent.sentCopyStatus, 'provider_managed');
  assert.deepEqual(await api.send(1, 'gmail-send', null, next.id, next.version), sent);
  await assert.rejects(api.send(1, 'another-gmail-send', null, next.id, next.version), { code: 'MAIL_CLIENT_DRAFT_SEND_ALREADY_REQUESTED' });
  assert.equal(g.calls.filter(call => call.path === '/drafts/send').length, 1);
  assert.equal(g.calls.filter(call => call.path === '/drafts/send')[0].payload.id, next.id);
  assert.equal(g.drafts.size, 0);
  assert.equal(observations.invalidations, 3);
});

test('Gmail detects an external edit even after initial verification, before PUT or drafts.send', async t => {
  const { api, g } = setup(t);
  const created = await api.save(1, 'create', COMPOSE);
  const draft = await api.detail(1, created.draftId);
  let reads = 0;
  g.control.onOpen = (id, entries) => {
    if (++reads === 2) entries.get(id).message.id = 'external';
  };
  const result = await api.save(1, 'race-update', COMPOSE, draft.id, draft.version);
  assert.equal(result.state, 'conflict');
  assert.equal(g.calls.filter(call => call.method === 'PUT').length, 0);
  const conflict = await api.send(1, 'race-send', null, draft.id, draft.version);
  assert.equal(conflict.state, 'failed');
  assert.equal(conflict.statusCode, 409);
  assert.equal(g.calls.filter(call => call.path === '/drafts/send').length, 0);
  g.control.address = 'someone.else@gmail.com';
  const mismatch = await api.send(1, 'mismatch', COMPOSE);
  assert.equal(mismatch.code, 'MAIL_CLIENT_ACCOUNT_MISMATCH');
  assert.equal(g.calls.filter(call => call.path === '/messages/send').length, 0);
});

test('IMAP uses actual Drafts role, raw proof with UIDVALIDITY=0 and read-only GET', async t => {
  const { api, i } = setup(t);
  i.control.noUid = true;
  const created = await api.save(2, 'create', COMPOSE);
  assert.equal(created.state, 'saved');
  assert.equal((await api.list(2, null, 10)).drafts[0].id, created.draftId);
  assert.equal((await api.detail(2, created.draftId)).text.trim(), COMPOSE.text);
  assert.ok(i.events.some(([op]) => op === 'search'));
  assert.deepEqual(i.events.filter(([op]) => op === 'lock').map(event => event.at(-1)), [false, true, true]);
  i.boxStore('me').messages.set(1, Buffer.from('Different draft at reused UID'));
  await assert.rejects(api.detail(2, created.draftId), { code: 'MAIL_CLIENT_DRAFT_CONFLICT' });

  i.folders.push({ path: 'Drafts2', flags: new Set(['\\Drafts']) });
  const rejected = await api.save(2, 'ambiguous', COMPOSE);
  assert.equal(rejected.code, 'MAIL_CLIENT_DRAFT_FOLDER_UNAVAILABLE');
  i.folders.pop();
  i.folders[1].flags.clear();
  assert.equal((await api.save(2, 'guessed', COMPOSE)).code, 'MAIL_CLIENT_DRAFT_FOLDER_UNAVAILABLE');
  assert.deepEqual(i.events.filter(([op]) => op === 'append'), [['append', 'Temp']]);
});

test('IMAP replacement keeps the previous draft until confirmed and does not append without MOVE', async t => {
  const { api, i } = setup(t);
  const saved = await api.save(2, 'create', COMPOSE);
  const draft = await api.detail(2, saved.draftId);
  i.control.capabilities.delete('MOVE');
  const input = { ...COMPOSE, text: 'edited' };
  const blocked = await api.save(2, 'blocked', input, draft.id, draft.version);
  assert.equal(blocked.code, 'MAIL_CLIENT_DRAFT_MOVE_UNAVAILABLE');
  assert.equal(i.boxStore('me').messages.size, 1);
  assert.equal(i.events.filter(([op]) => op === 'append').length, 1);
  i.control.capabilities.set('MOVE', true);
  i.control.appendNeverVisible = true;
  const unknown = await api.save(2, 'timeout', input, draft.id, draft.version);
  assert.equal(unknown.state, 'unknown');
  assert.deepEqual(await api.save(2, 'timeout', input, draft.id, draft.version), unknown);
  assert.equal((await api.detail(2, draft.id)).text.trim(), COMPOSE.text);
  i.control.appendNeverVisible = false;
  i.control.loseAppendAck = true;
  i.control.moveFails = true;
  const both = await api.save(2, 'cleanup-failed', input, draft.id, draft.version);
  assert.equal(both.state, 'unknown');
  assert.equal(both.cleanup, 'unknown');
  assert.equal(i.boxStore('me').messages.size, 2);
  assert.equal((await api.detail(2, both.draftId)).text.trim(), 'edited');
  assert.equal((await api.detail(2, draft.id)).text.trim(), COMPOSE.text);
  assert.equal(i.events.filter(([op]) => op === 'append').length, 3);
});

test('Works replacement with tagged APPENDUID uses native Trash move and paginates remaining drafts', async t => {
  const { api, i } = setup(t);
  i.control.validity = 42n;
  const a = await api.save(3, 'first', COMPOSE);
  await api.save(3, 'second', COMPOSE);
  const before = await api.detail(3, a.draftId);
  const replacement = await api.save(3, 'replace', { ...COMPOSE, text: 'new version' }, before.id, before.version);
  assert.equal(replacement.state, 'saved');
  assert.equal(replacement.cleanup, 'confirmed');
  assert.deepEqual(i.events.filter(([op]) => op === 'move'), [['move', 1]]);
  const page1 = await api.list(3, null, 1);
  const page2 = await api.list(3, page1.nextCursor, 1);
  assert.equal(page1.drafts[0].id, replacement.draftId);
  assert.notEqual(page1.drafts[0].id, page2.drafts[0].id);
});

test('SMTP verifies account, distinguishes auth failure, timeout, partial and full delivery', async t => {
  const { api, smtp, observations, i } = setup(t);
  smtp.error = Object.assign(new Error('authentication denied'), { code: 'EAUTH' });
  assert.equal((await api.send(2, 'auth', COMPOSE)).code, 'MAIL_CLIENT_WRITE_AUTH_REQUIRED');
  smtp.error = Object.assign(new Error('server unavailable'), { code: 'ETIMEDOUT', command: 'CONN' });
  assert.equal((await api.send(2, 'connection', COMPOSE)).state, 'failed');
  smtp.error = Object.assign(new Error('response lost after DATA'), { code: 'ETIMEDOUT', command: 'DATA' });
  assert.equal((await api.send(2, 'data-timeout', COMPOSE)).state, 'unknown');
  smtp.error = null;
  smtp.accepted = ['TO@example.com'];
  const recipients = { ...COMPOSE, bcc: ['hidden@example.com'] };
  const partial = await api.send(3, 'partial', recipients);
  assert.equal(partial.state, 'sent');
  assert.equal(partial.success, false);
  assert.deepEqual([partial.delivery, partial.acceptedCount, partial.rejectedCount], ['partial', 1, 1]);
  smtp.accepted = null;
  const receipt = await api.send(3, 'full', recipients);
  assert.equal(receipt.success, true);
  assert.equal(receipt.sentCopyStatus, 'verification_required');
  const last = observations.smtp.at(-1);
  assert.equal(last.config.host, 'smtp.worksmobile.com');
  assert.equal(last.config.secure, true);
  assert.deepEqual(last.envelope, { from: 'me@example.com', to: ['to@example.com', 'hidden@example.com'] });
  assert.doesNotMatch(last.raw.toString(), /^Bcc:/im);
  assert.doesNotMatch(last.raw.toString(), /hidden@example.com/i);
  assert.deepEqual(i.events, []);
});

test('SMTP draft ambiguous send is never moved, confirmed send stays sent if cleanup fails', async t => {
  const { api, smtp, i, db, observations } = setup(t);
  const first = await api.save(2, 'draft-1', COMPOSE);
  const second = await api.save(2, 'draft-2', COMPOSE);
  const a = await api.detail(2, first.draftId);
  const b = await api.detail(2, second.draftId);
  smtp.error = new Error('response lost');
  assert.equal((await api.send(2, 'draft-uncertain', null, a.id, a.version)).state, 'unknown');
  assert.equal(i.events.filter(([op]) => op === 'move').length, 0);
  smtp.error = null;
  i.control.moveFails = true;
  const confirmed = await api.send(2, 'draft-sent', null, b.id, b.version);
  assert.equal(confirmed.state, 'sent');
  assert.equal(confirmed.cleanup, 'unknown');
  assert.equal(i.events.filter(([op]) => op === 'append').length, 2);
  assert.equal(i.events.filter(([op]) => op === 'move').length, 1);
  assert.deepEqual(await api.send(2, 'draft-sent', null, b.id, b.version), confirmed);
  assert.equal(observations.smtp.length, 2);
  assert.doesNotMatch(JSON.stringify(db.prepare('SELECT * FROM mail_client_compose_receipts').all()), /Private message body|to@example.com|secret/);
});

test('same request retries across restart and uncertain or interrupted receipts never transmit twice', async t => {
  const { api, g, options, db } = setup(t);
  g.control.unknown = true;
  const receipt = await api.send(1, 'lost', COMPOSE);
  assert.equal(receipt.state, 'unknown');
  const restarted = createMailClientCompose(options);
  g.control.unknown = false;
  assert.deepEqual(await restarted.send(1, 'lost', COMPOSE), receipt);
  await assert.rejects(restarted.send(1, 'lost', { ...COMPOSE, text: 'changed' }), { code: 'MAIL_CLIENT_REQUEST_CONFLICT' });
  db.prepare("UPDATE mail_client_compose_receipts SET state='pending', result_json=NULL, finished_at=NULL").run();
  assert.equal((await restarted.send(1, 'lost', COMPOSE)).state, 'pending');
  assert.equal(g.calls.filter(call => call.path === '/messages/send').length, 1);
  assert.throws(() => restarted.receipt(2, 'lost'), { code: 'MAIL_CLIENT_RECEIPT_NOT_FOUND' });
});

test('concurrent retry observes a pending receipt before the provider receives the message', async t => {
  let release;
  let notify;
  const inTransport = new Promise(resolve => { notify = resolve; });
  const released = new Promise(resolve => { release = resolve; });
  let dispatched = 0;
  const { api } = setup(t, {
    createTransport: () => ({
      async sendMail({ envelope }) {
        dispatched += 1;
        notify();
        await released;
        return { accepted: envelope.to };
      },
    }),
  });
  const first = api.send(2, 'concurrent', COMPOSE);
  try {
    await inTransport;
    assert.equal(api.receipt(2, 'concurrent').state, 'pending');
    assert.equal((await api.send(2, 'concurrent', COMPOSE)).state, 'pending');
  } finally {
    release();
  }
  assert.equal((await first).state, 'sent');
  assert.equal(dispatched, 1);
});

test('reply, reply-all and forward use original headers, preserve threading and protect BCC', async t => {
  const { api, source, observations } = setup(t);
  source.raw = sourceMessage();
  const reply = { kind: 'reply', originalId: 75, text: 'Works for me', bcc: ['my-copy@example.com'] };
  assert.equal((await api.send(2, 'reply', reply)).state, 'sent');
  let outbound = observations.smtp.at(-1);
  let parsed = await parse(outbound.raw);
  assert.deepEqual(outbound.envelope.to, ['replies@example.com', 'my-copy@example.com']);
  assert.equal(parsed.subject, 'Re: Meeting');
  assert.equal(parsed.inReplyTo, '<meeting@example.com>');
  assert.equal(parsed.references, '<earlier@example.com> <meeting@example.com>');
  assert.equal(parsed.bcc, undefined);

  const all = { ...reply, kind: 'reply_all', bcc: ['my-copy@example.com', 'reviewer@example.com'] };
  assert.equal((await api.send(2, 'all', all)).state, 'sent');
  outbound = observations.smtp.at(-1);
  parsed = await parse(outbound.raw);
  assert.deepEqual(parsed.to.map(value => value.address), ['replies@example.com', 'colleague@example.com']);
  assert.deepEqual(parsed.cc.map(value => value.address), ['reviewer@example.com']);
  assert.deepEqual(outbound.envelope.to, ['replies@example.com', 'colleague@example.com', 'reviewer@example.com', 'my-copy@example.com']);
  assert.doesNotMatch(outbound.raw.toString(), /original-hidden@example.com|my-copy@example.com/);

  const [ref] = (await api.originalAttachments(2, 75)).attachments;
  const forward = {
    kind: 'forward', originalId: 75, text: 'See below', to: ['forward@example.com'],
    attachments: [{ kind: 'original', index: ref.index, proof: ref.proof }],
  };
  assert.equal((await api.send(2, 'forward', forward)).state, 'sent');
  parsed = await parse(observations.smtp.at(-1).raw);
  assert.equal(parsed.subject, 'Fwd: Meeting');
  assert.match(parsed.text, /From: sender@example.com[\s\S]*Original body/);
  assert.equal(Buffer.from(parsed.attachments[0].content).toString(), 'abc');
  source.raw = Buffer.from(source.raw.toString().replace('YWJj', 'eHl6'));
  const stale = await api.send(2, 'stale-attachment', forward);
  assert.equal(stale.code, 'MAIL_CLIENT_ATTACHMENT_CHANGED');
  assert.equal((await api.send(2, 'missing-attachment', { ...forward, attachments: [] })).state, 'failed');
  assert.equal(observations.smtp.length, 3);
});

test('attachments are one-shot, bound to account, expiring and checked after MIME encoding', async t => {
  const { api, observations } = setup(t);
  const stream = buffer => Readable.from([buffer]);
  const upload = await api.upload(2, stream(Buffer.from('payload')), 'foo.txt', 'text/plain');
  const compose = { ...COMPOSE, attachments: [{ kind: 'upload', id: upload.id }] };
  assert.equal((await api.send(3, 'wrong-account', compose)).code, 'MAIL_CLIENT_UPLOAD_NOT_FOUND');
  assert.equal((await api.send(2, 'with-upload', compose)).state, 'sent');
  const mime = await parse(observations.smtp.at(-1).raw);
  assert.equal(Buffer.from(mime.attachments[0].content).toString(), 'payload');
  assert.equal((await api.send(2, 'reuse', compose)).code, 'MAIL_CLIENT_UPLOAD_NOT_FOUND');
  const huge = await api.upload(2, stream(Buffer.alloc(MAX_ATTACHMENT_BYTES)), 'huge.bin');
  const oversized = { ...COMPOSE, text: 'x'.repeat(800_000), attachments: [{ kind: 'upload', id: huge.id }] };
  assert.equal((await api.send(2, 'too-big', oversized)).statusCode, 413);
  assert.equal((await api.send(2, 'cleared', oversized)).code, 'MAIL_CLIENT_UPLOAD_NOT_FOUND');
  await assert.rejects(api.upload(2, stream(Buffer.alloc(MAX_ATTACHMENT_BYTES + 1)), 'huge.bin'), { statusCode: 413 });
  const expiring = createComposeUploads({ ttl: 1 });
  const short = await expiring.upload(2, stream(Buffer.from('test')), 'expire.txt');
  await new Promise(resolve => setTimeout(resolve, 8));
  assert.throws(() => expiring.claim(2, [short.id]), { code: 'MAIL_CLIENT_UPLOAD_NOT_FOUND' });
  assert.equal(observations.smtp.length, 1);
});

test('existing draft files can be retained using provider attachment proof, then sent', async t => {
  const { api, i, observations } = setup(t);
  const file = await api.upload(2, Readable.from([Buffer.from('kept')]), 'kept.txt');
  const saved = await api.save(2, 'with-file', { ...COMPOSE, attachments: [{ kind: 'upload', id: file.id }] });
  const draft = await api.detail(2, saved.draftId);
  const [attachment] = draft.attachments;
  const updated = await api.save(2, 'edited-with-file', {
    ...COMPOSE, attachments: [{ kind: 'draft', index: attachment.index, proof: attachment.proof }],
  }, draft.id, draft.version);
  assert.equal(updated.state, 'saved');
  const current = await api.detail(2, updated.draftId);
  const sent = await api.send(2, 'send-file', null, current.id, current.version);
  assert.equal(sent.cleanup, 'confirmed');
  assert.equal(i.boxStore('me').messages.size, 0);
  assert.equal(Buffer.from((await parse(observations.smtp.at(-1).raw)).attachments[0].content).toString(), 'kept');
});

test('gate, account and header validation run before writes; draft read routes have no-store', async t => {
  const { api, g, i, options } = setup(t);
  const draftOnly = createMailClientCompose({ ...options, sendEnabled: false });
  assert.throws(() => draftOnly.send(1, 'no-send', COMPOSE), { code: 'MAIL_CLIENT_SEND_DISABLED' });
  const readOnly = createMailClientCompose({ ...options, writeEnabled: false });
  assert.throws(() => readOnly.save(1, 'no-write', COMPOSE), { code: 'MAIL_CLIENT_WRITE_DISABLED' });
  assert.throws(() => api.send(1, 'spoof', { ...COMPOSE, from: 'fake@example.com' }), { statusCode: 400 });
  assert.throws(() => api.send(1, 'injection', { ...COMPOSE, to: ['to@example.com\r\nBCC: x@example.com'] }), { statusCode: 400 });
  assert.throws(() => api.send(1, 'domain', { ...COMPOSE, to: ['to@example.com:25'] }), { statusCode: 400 });
  assert.throws(() => api.send(1, 'path', { ...COMPOSE, to: ['to@example.com/path'] }), { statusCode: 400 });
  assert.equal((await api.send(1, 'no-recipient', { ...COMPOSE, to: [] })).code, 'MAIL_CLIENT_RECIPIENT_REQUIRED');
  assert.equal(g.calls.filter(call => call.method !== 'GET').length, 0);
  assert.deepEqual(i.events, []);

  const handlers = {};
  const app = Object.fromEntries(['get', 'post', 'put'].map(method => [method, (path, action) => { handlers[method + path] = action; }]));
  registerMailClientComposeRoutes({ app, service: draftOnly });
  async function route(method, path, request) {
    const headers = {};
    const response = {
      set: (name, value) => { headers[name] = value; },
      status(code) { this.code = code; return this; },
      json(body) { return { headers, status: this.code, body }; },
    };
    return handlers[method + '/api/mail-client/accounts/:accountId' + path]({
      query: {}, params: { accountId: '1' }, ...request,
    }, response);
  }
  const list = await route('get', '/drafts', {});
  assert.equal(list.headers['Cache-Control'], 'no-store');
  assert.equal(list.status, 200);
  const disabled = await route('post', '/send', { body: { requestId: 'route', compose: COMPOSE } });
  assert.equal(disabled.headers['Cache-Control'], 'no-store');
  assert.equal(disabled.body.code, 'MAIL_CLIENT_SEND_DISABLED');
});

test('MIME builder explicitly keeps BCC for Gmail API and provider draft storage only', async () => {
  const { raw } = await buildMime({
    from: 'me@example.com', to: [], cc: [], bcc: ['bcc@example.com'], text: 'body', attachments: [],
  }, { keepBcc: true });
  assert.equal((await parse(raw)).bcc[0].address, 'bcc@example.com');
});
