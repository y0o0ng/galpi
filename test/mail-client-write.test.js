'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { migrations } = require('../lib/database-migrations');
const { createMailStore } = require('../lib/mail/store');
const { createMailClient } = require('../lib/mail/client');
const { createMailClientActions } = require('../lib/mail/client-actions');
const { createGmailMailClient } = require('../lib/mail/client-gmail');
const { createGmailMailWriter } = require('../lib/mail/client-gmail-write');
const { createImapMailClient } = require('../lib/mail/client-imap');
const { createImapMailWriter } = require('../lib/mail/client-imap-write');

const NOW = 1795200000;
const RAW = Buffer.from([
  'From: Instructor <instructor@example.org>',
  'To: user@example.org',
  'Date: Fri, 20 Nov 2026 12:00:00 GMT',
  'Message-ID: <origin@example.org>',
  'Subject: Lecture',
  '',
  'not-persisted-body',
].join('\r\n'));

const FOLDERS = [
  { path: 'INBOX', name: 'Inbox', flags: [] },
  { path: 'Archive', name: 'Archive', specialUse: '\\Archive', flags: ['\\Archive'] },
  { path: 'Bin', name: 'Bin', specialUse: '\\Trash', flags: ['\\Trash'] },
  { path: 'Projects', name: 'Projects', flags: [] },
  { path: 'Hidden', name: 'Hidden', flags: ['\\Noselect'] },
];

function gmailMock() {
  const state = {
    requests: [],
    labels: ['INBOX', 'Label_origin', 'Label_keep', 'IMPORTANT', 'UNREAD'],
    writes: [],
    afterWrite: null,
    afterMetadata: null,
    writeStatus: null,
    profile: 'owner@gmail.com',
  };
  const readToken = { getAccessToken: async () => 'mock-read' };
  const writeToken = { getAccessToken: async () => 'mock-modify' };
  const folderLabels = [
    { id: 'INBOX', name: 'INBOX', type: 'system' },
    { id: 'IMPORTANT', name: 'IMPORTANT', type: 'system' },
    { id: 'Label_origin', name: 'Origin', type: 'user' },
    { id: 'Label_target', name: 'Target', type: 'user' },
    { id: 'Label_keep', name: 'Keep', type: 'user' },
  ];
  async function fetch(url, init = {}) {
    const parsed = new URL(url);
    const path = parsed.pathname.replace('/gmail/v1/users/me', '');
    const method = init.method || 'GET';
    state.requests.push({ method, path, auth: init.headers.authorization });
    if (method === 'POST') {
      assert.equal(init.headers.authorization, 'Bearer mock-modify');
      assert.match(path, /^\/messages\/g1\/(modify|trash)$/);
      const body = init.body ? JSON.parse(init.body) : null;
      state.writes.push({ path, body });
      if (state.writeStatus) return Response.json({}, { status: state.writeStatus });
      if (path.endsWith('/trash')) {
        state.labels = [...new Set(state.labels.filter(label => label !== 'INBOX').concat('TRASH'))];
      } else {
        state.labels = [...new Set(state.labels.filter(label => !body.removeLabelIds.includes(label)).concat(body.addLabelIds))];
      }
      if (state.afterWrite) await state.afterWrite();
      return Response.json({ id: 'g1', labelIds: state.labels });
    }
    assert.equal(method, 'GET');
    if (path === '/profile') {
      return Response.json({ emailAddress: init.headers.authorization === 'Bearer mock-modify' ? state.profile : 'owner@gmail.com' });
    }
    if (path === '/labels') return Response.json({ labels: folderLabels });
    if (path === '/messages') {
      const filter = parsed.searchParams.get('labelIds');
      const requested = parsed.searchParams.get('q');
      const matches = (!filter || state.labels.includes(filter)) && !requested?.startsWith('before:');
      return Response.json({ messages: matches ? [{ id: 'g1' }] : [] });
    }
    assert.equal(path, '/messages/g1');
    const message = {
      id: 'g1', threadId: 'thread-1', internalDate: String((NOW - 2) * 1000), labelIds: state.labels,
      raw: RAW.toString('base64url'), payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: 'Lecture' }] },
    };
    if (parsed.searchParams.get('format') === 'full' && state.afterMetadata) await state.afterMetadata();
    return Response.json(message);
  }
  return {
    state,
    reader: createGmailMailClient({ tokenSource: readToken, fetch }),
    writer: createGmailMailWriter({ tokenSource: writeToken, fetch }),
  };
}

function imapMock() {
  function message(raw = RAW) {
    return {
      uid: 1, size: raw.length, source: raw, internalDate: new Date((NOW - 5) * 1000),
      envelope: { messageId: '<origin@example.org>', subject: 'Lecture', date: new Date('2026-11-20T12:00:00Z') },
      flags: new Set(),
    };
  }
  function mailbox() {
    return {
      folders: FOLDERS.slice(), rows: { INBOX: [message()], Archive: [], Bin: [], Projects: [], Hidden: [] },
      validity: 0n, moveCapable: true, copyUid: true, failCommand: null, grantReadOnly: false,
      calls: [],
    };
  }
  const naver = mailbox();
  const works = mailbox();
  const credentialsFor = account => ({ user: account.address, pass: 'fake-app-password' });
  function createClient(credentials) {
    const state = credentials.user.endsWith('@naver.com') ? naver : works;
    let locked;
    let sourceChecked;
    const rows = () => state.rows[locked.path];
    return {
      enabled: new Set(),
      capabilities: new Set(state.moveCapable ? ['MOVE'] : []),
      async connect() {},
      async logout() { assert.equal(locked, null); },
      async list() { return state.folders; },
      async getMailboxLock(path, { readOnly }) {
        assert.equal(locked, undefined);
        if (!state.rows[path]) throw new Error('mailbox missing');
        locked = { path, readOnly };
        this.mailbox = {
          uidNext: Math.max(0, ...rows().map(row => row.uid)) + 1,
          uidValidity: state.validity,
          exists: rows().length,
          readOnly: readOnly || state.grantReadOnly,
        };
        state.calls.push({ op: 'lock', path, readOnly });
        return { release() { locked = null; } };
      },
      async search(spec, options) {
        assert.equal(options.uid, true);
        const [min, max] = spec.uid.split(':').map(Number);
        return rows().filter(row => row.uid >= min && row.uid <= max).map(row => row.uid);
      },
      async *fetch(set, fields, { uid }) {
        assert.equal(uid, true);
        for (const row of rows().filter(entry => set.split(',').includes(String(entry.uid)))) {
          yield { ...row, source: fields.source ? row.source : undefined };
        }
      },
      async fetchOne(uid, fields, options) {
        assert.equal(options.uid, true);
        const row = rows().find(entry => entry.uid === uid);
        state.calls.push({ op: fields.source ? 'peek' : 'flags', uid, path: locked.path, readOnly: locked.readOnly });
        if (fields.source) sourceChecked = uid;
        return row ? { ...row, ...(fields.source ? {} : { source: undefined }) } : false;
      },
      async exec(command, args, options) {
        const uid = Number(args[0].value);
        assert.equal(locked.readOnly, false);
        assert.equal(sourceChecked, uid);
        assert.ok(['UID STORE', 'UID MOVE'].includes(command));
        state.calls.push({ op: command, args });
        if (state.failCommand) {
          if (state.failCommand === 'BYE') return { response: { command: 'BYE' }, next() {} };
          if (state.failCommand === 'NO') throw Object.assign(new Error('denied'), {
            responseStatus: 'NO', response: { attributes: [{ section: [{ value: 'NOPERM' }] }] },
          });
          throw new Error('timed out after dispatch');
        }
        const row = rows().find(entry => entry.uid === uid);
        if (command === 'UID STORE') {
          const flag = args[2][0].value;
          assert.ok(['\\Seen', '\\Flagged'].includes(flag));
          if (args[1].value === '+FLAGS.SILENT') row.flags.add(flag);
          else if (args[1].value === '-FLAGS.SILENT') row.flags.delete(flag);
          else assert.fail('unsafe STORE command');
        } else {
          const dest = args[1].value;
          const newUid = Math.max(90, ...state.rows[dest].map(entry => entry.uid + 1));
          state.rows[dest].push({ ...row, uid: newUid });
          state.rows[locked.path] = rows().filter(entry => entry.uid !== uid);
          if (state.copyUid) {
            await options.untagged.OK({ attributes: [{ section:
              ['COPYUID', '0', String(uid), String(newUid)].map(value => ({ value })),
            }] });
          }
        }
        return { response: { command: 'OK' }, next() {} };
      },
    };
  }
  const options = { credentialsFor, createClient };
  return { naver, works, reader: createImapMailClient(options), writer: createImapMailWriter(options), message };
}

function fixture(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, created_at INTEGER)');
  for (const version of [7, 9, 19, 20, 21, 44, 45, 46]) migrations.find(migration => migration.version === version).up(db);
  const agentStore = createMailStore(db);
  const account = {
    gmail: agentStore.registerAccount({ provider: 'gmail', address: 'owner@gmail.com', now: NOW }).id,
    naver: agentStore.registerAccount({ provider: 'naver', address: 'owner@naver.com', now: NOW }).id,
    works: agentStore.registerAccount({ provider: 'works', address: 'owner@school.example.com', now: NOW }).id,
  };
  const gmail = gmailMock();
  const imap = imapMock();
  const reader = createMailClient({
    db, agentStore, providers: { gmail: gmail.reader, naver: imap.reader, works: imap.reader }, now: () => NOW,
  });
  const restart = () => createMailClientActions({
    db, agentStore, providers: { gmail: gmail.writer, naver: imap.writer, works: imap.writer },
    onConfirmed: () => reader.invalidateCursors(),
  });
  const service = restart();
  const locate = async (provider, folder = provider === 'gmail' ? 'all' : 'folder:INBOX') => {
    const page = await reader.mailbox(account[provider], folder, null, 1);
    assert.ok(page.messages[0]?.id, JSON.stringify(page));
    return page.messages[0].id;
  };
  const single = async (requestId, messageId, action, options = {}, instance = service) => (
    (await instance.run(requestId, [{ messageId, action, ...options }])).results[0]
  );
  return { db, account, gmail, imap, reader, service, restart, locate, single };
}

test('Gmail uses a separate write token and changes only UNREAD or STARRED', async t => {
  const f = fixture(t);
  const id = await f.locate('gmail');
  for (const [index, action, value] of [
    [1, 'set_read', true], [2, 'set_read', false], [3, 'set_starred', true], [4, 'set_starred', false],
  ]) {
    assert.equal((await f.single('flags-' + index, id, action, { value })).state, 'confirmed');
  }
  assert.deepEqual(f.gmail.state.writes.map(write => write.body), [
    { addLabelIds: [], removeLabelIds: ['UNREAD'] },
    { addLabelIds: ['UNREAD'], removeLabelIds: [] },
    { addLabelIds: ['STARRED'], removeLabelIds: [] },
    { addLabelIds: [], removeLabelIds: ['STARRED'] },
  ]);
  assert.ok(f.gmail.state.labels.includes('IMPORTANT'));
  assert.ok(f.gmail.state.requests.some(req => req.auth === 'Bearer mock-read'));
  assert.equal((await f.reader.detail(id)).read, false);
  assert.equal(f.gmail.state.writes.length, 4);
});

test('Gmail archive, scoped label move, and trash preserve distinct native operations', async t => {
  const f = fixture(t);
  const messageId = await f.locate('gmail');
  const targetMailbox = { accountId: f.account.gmail, id: 'label:Label_target' };
  assert.equal((await f.single('archive', messageId, 'archive')).state, 'confirmed');
  assert.deepEqual(f.gmail.state.writes.at(-1).body, { addLabelIds: [], removeLabelIds: ['INBOX'] });
  assert.ok(f.gmail.state.labels.includes('Label_keep'));
  assert.equal((await f.single('move-label', messageId, 'move', { sourceMailbox: 'label:Label_origin', targetMailbox })).state, 'confirmed');
  assert.deepEqual(f.gmail.state.writes.at(-1).body, { addLabelIds: ['Label_target'], removeLabelIds: ['Label_origin'] });
  assert.equal((await f.single('move-all', messageId, 'move', {
    sourceMailbox: 'all', targetMailbox: { ...targetMailbox, id: 'label:Label_origin' },
  })).state, 'confirmed');
  assert.deepEqual(f.gmail.state.writes.at(-1).body, { addLabelIds: ['Label_origin'], removeLabelIds: [] });
  assert.equal((await f.single('system-target', messageId, 'move', {
    sourceMailbox: 'all', targetMailbox: { ...targetMailbox, id: 'label:IMPORTANT' },
  })).state, 'failed');
  assert.equal((await f.single('wrong-source', messageId, 'move', { sourceMailbox: 'label:INBOX', targetMailbox })).statusCode, 409);
  assert.equal((await f.single('trash', messageId, 'trash')).state, 'confirmed');
  assert.deepEqual(f.gmail.state.writes.at(-1), { path: '/messages/g1/trash', body: null });
  assert.ok(f.gmail.state.labels.includes('IMPORTANT'));
});

test('IMAP flags are explicit and verification and mutation stay in one writable lock', async t => {
  const f = fixture(t);
  const id = await f.locate('naver');
  assert.equal((await f.reader.detail(id)).read, false);
  assert.equal(f.imap.naver.calls.some(call => call.op === 'UID STORE'), false);
  for (const [index, action, value] of [
    [1, 'set_read', true], [2, 'set_read', false], [3, 'set_starred', true], [4, 'set_starred', false],
  ]) {
    assert.equal((await f.single('imap-' + index, id, action, { value })).state, 'confirmed');
  }
  assert.deepEqual(f.imap.naver.calls.filter(call => call.op === 'UID STORE').map(call => [
    call.args[1].value, call.args[2][0].value,
  ]), [['+FLAGS.SILENT', '\\Seen'], ['-FLAGS.SILENT', '\\Seen'], ['+FLAGS.SILENT', '\\Flagged'], ['-FLAGS.SILENT', '\\Flagged']]);
  assert.deepEqual([...f.imap.naver.rows.INBOX[0].flags], []);
});

test('a UIDVALIDITY 0 reuse with identical metadata and different raw bytes rejects the write', async t => {
  const f = fixture(t);
  const id = await f.locate('works');
  const old = f.imap.works.rows.INBOX[0];
  old.source = Buffer.from(old.source.toString().replace('not-persisted-body', 'new-persisted-body'));
  assert.equal(old.source.length, old.size);
  const result = await f.single('stale', id, 'trash');
  assert.deepEqual([result.state, result.statusCode, result.code], ['failed', 409, 'MAIL_CLIENT_LOCATION_STALE']);
  assert.equal(f.imap.works.calls.some(call => call.op.startsWith('UID ')), false);
});

test('native MOVE alone handles archive, trash, and selected folders; missing or cross-account targets fail closed', async t => {
  const f = fixture(t);
  const id = await f.locate('naver');
  const move = targetMailbox => ({ targetMailbox: { accountId: f.account.naver, id: targetMailbox } });
  assert.equal((await f.single('missing', id, 'move', move('folder:Absent'))).statusCode, 409);
  assert.equal((await f.single('hidden', id, 'move', move('folder:Hidden'))).statusCode, 409);
  assert.equal((await f.single('cross', id, 'move', { targetMailbox: { accountId: f.account.works, id: 'folder:Projects' } })).statusCode, 409);
  f.imap.naver.moveCapable = false;
  assert.equal((await f.single('no-native', id, 'archive')).code, 'MAIL_CLIENT_MOVE_UNSUPPORTED');
  assert.equal(f.imap.naver.calls.some(call => call.op.startsWith('UID ')), false);
  assert.equal(f.imap.naver.rows.INBOX.length, 1);
  f.imap.naver.moveCapable = true;
  assert.equal((await f.single('arch', id, 'archive')).state, 'confirmed');
  const archived = await f.locate('naver', 'folder:Archive');
  assert.equal((await f.single('projects', archived, 'move', move('folder:Projects'))).state, 'confirmed');
  const moved = await f.locate('naver', 'folder:Projects');
  assert.equal((await f.single('binned', moved, 'trash')).state, 'confirmed');
  assert.deepEqual(f.imap.naver.calls.filter(call => call.op.startsWith('UID ')).map(call => [call.op, call.args[1].value]), [
    ['UID MOVE', 'Archive'], ['UID MOVE', 'Projects'], ['UID MOVE', 'Bin'],
  ]);
  assert.equal(f.imap.naver.rows.Bin.length, 1);
  await assert.rejects(f.reader.detail(id), { code: 'MAIL_CLIENT_LOCATION_STALE' });
});

test('special-use folders must be unique and a read-only granting server cannot be written', async t => {
  const f = fixture(t);
  const id = await f.locate('works');
  f.imap.works.folders.push({ path: 'Other', flags: ['\\Trash'] });
  assert.equal((await f.single('ambiguous-trash', id, 'trash')).statusCode, 409);
  f.imap.works.folders = f.imap.works.folders.filter(folder => folder.specialUse !== '\\Archive');
  f.imap.works.folders.push({ path: 'Archive', flags: [], specialUse: '\\Archive', specialUseSource: 'name' });
  assert.equal((await f.single('missing-archive', id, 'archive')).statusCode, 409);
  f.imap.works.grantReadOnly = true;
  assert.equal((await f.single('read-only-select', id, 'set_starred', { value: true })).code, 'MAIL_CLIENT_WRITE_AUTH_REQUIRED');
  assert.equal(f.imap.works.calls.some(call => call.op.startsWith('UID ')), false);
});

test('one batch retains confirmed and failed per-account results and atomic request identity', async t => {
  const f = fixture(t);
  const gmail = await f.locate('gmail');
  const works = await f.locate('works');
  f.imap.works.moveCapable = false;
  const commands = [{ messageId: gmail, action: 'archive' }, { messageId: works, action: 'trash' }];
  const batch = await f.service.run('batch-1', commands);
  assert.equal(batch.success, false);
  assert.deepEqual(batch.results.map(result => [result.accountId, result.state]), [[f.account.gmail, 'confirmed'], [f.account.works, 'failed']]);
  assert.deepEqual(await f.restart().run('batch-1', commands), batch);
  await assert.rejects(f.service.run('batch-1', [commands[0]]), { code: 'MAIL_CLIENT_REQUEST_CONFLICT', statusCode: 409 });
  assert.equal(f.gmail.state.writes.length, 1);
  assert.equal(f.db.prepare('SELECT count(*) AS count FROM mail_reply_attempts').get().count, 0);
  assert.equal(f.db.prepare('SELECT count(*) AS count FROM mail_messages').get().count, 0);
});

test('an uncertain Gmail POST or IMAP BYE never causes another mutation for the same request', async t => {
  const f = fixture(t);
  const gmail = await f.locate('gmail');
  const naver = await f.locate('naver');
  const cached = f.db.prepare("SELECT count(*) AS n FROM mail_client_cache WHERE cache_key LIKE 'page:%'").get().n;
  f.gmail.state.afterWrite = async () => { throw new Error('lost response'); };
  const timeout = await f.single('lost', gmail, 'trash');
  assert.equal(timeout.state, 'unknown');
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM mail_client_cache WHERE cache_key LIKE 'page:%'").get().n, cached);
  assert.deepEqual(await f.single('lost', gmail, 'trash', {}, f.restart()), timeout);
  assert.equal(f.gmail.state.writes.length, 1);
  f.imap.naver.failCommand = 'BYE';
  const bye = await f.single('bye', naver, 'trash');
  assert.equal(bye.state, 'unknown');
  assert.deepEqual(await f.single('bye', naver, 'trash', {}, f.restart()), bye);
  assert.equal(f.imap.naver.calls.filter(call => call.op === 'UID MOVE').length, 1);
});

test('concurrent calls see an unresolved receipt while a mutation is in flight', async t => {
  const f = fixture(t);
  const id = await f.locate('gmail');
  let started;
  let release;
  const posted = new Promise(resolve => { started = resolve; });
  f.gmail.state.afterWrite = () => new Promise(resolve => { release = resolve; started(); });
  const original = f.single('in-flight', id, 'set_read', { value: true });
  await posted;
  const duplicate = await f.single('in-flight', id, 'set_read', { value: true });
  assert.equal(duplicate.state, 'unknown');
  release();
  assert.equal((await original).state, 'confirmed');
  assert.equal(f.gmail.state.writes.length, 1);
});

test('Gmail modify credentials are checked against the account and explicit denials are terminal', async t => {
  const f = fixture(t);
  const id = await f.locate('gmail');
  f.gmail.state.profile = 'another@gmail.com';
  assert.equal((await f.single('mismatch', id, 'trash')).code, 'MAIL_CLIENT_ACCOUNT_MISMATCH');
  assert.equal(f.gmail.state.writes.length, 0);
  f.gmail.state.profile = 'owner@gmail.com';
  f.gmail.state.writeStatus = 403;
  const rejected = await f.single('denied', id, 'trash');
  assert.equal(rejected.state, 'failed');
  assert.equal(rejected.code, 'MAIL_CLIENT_WRITE_AUTH_REQUIRED');
  assert.deepEqual(await f.single('denied', id, 'trash'), rejected);
  assert.equal(f.gmail.state.writes.length, 1);
});

test('manual unread survives a service restart and a subsequent GET, and explicit read clears the guard', async t => {
  const f = fixture(t);
  const id = await f.locate('gmail');
  assert.equal((await f.single('mark-unread', id, 'set_read', { value: false })).state, 'confirmed');
  assert.equal((await f.reader.detail(id)).read, false);
  const restarted = f.restart();
  assert.equal((await f.single('auto-blocked', id, 'set_read', { value: true, origin: 'auto' }, restarted)).code,
    'MAIL_CLIENT_MANUAL_UNREAD_PRESERVED');
  assert.equal(f.gmail.state.writes.length, 0);
  await f.single('read-by-user', id, 'set_read', { value: true }, restarted);
  f.gmail.state.labels.push('UNREAD');
  assert.equal((await f.single('auto-allowed', id, 'set_read', { value: true, origin: 'auto' }, f.restart())).state, 'confirmed');
  assert.equal(f.gmail.state.writes.length, 2);
});

test('manual unread survives IMAP MOVE with COPYUID and also conservatively follows identical source bytes without it', async t => {
  const f = fixture(t);
  for (const [provider, copyUid] of [['naver', true], ['works', false]]) {
    f.imap[provider].copyUid = copyUid;
    const id = await f.locate(provider);
    await f.single('unread-' + provider, id, 'set_read', { value: false });
    assert.equal((await f.single('move-' + provider, id, 'archive')).state, 'confirmed');
    const archived = await f.locate(provider, 'folder:Archive');
    assert.equal((await f.single('auto-' + provider, archived, 'set_read', { value: true, origin: 'auto' }, f.restart())).code,
      'MAIL_CLIENT_MANUAL_UNREAD_PRESERVED');
    assert.equal(f.imap[provider].calls.filter(call => call.op === 'UID STORE').length, 0);
    await f.single('manual-' + provider, archived, 'set_read', { value: true });
    f.imap[provider].rows.Archive[0].flags.delete('\\Seen');
    await f.single('after-manual-' + provider, archived, 'set_read', { value: true, origin: 'auto' }, f.restart());
    assert.equal(f.imap[provider].calls.filter(call => call.op === 'UID STORE').length, 2);
  }
});

test('confirmed writes invalidate account observations and issued unified cursors without evicting other accounts’ observations', async t => {
  const f = fixture(t);
  const id = await f.locate('gmail');
  await f.locate('works');
  const list = await f.reader.inbox(null, 1);
  assert.ok(list.nextCursor);
  const affected = f.db.prepare("SELECT count(*) AS n FROM mail_client_cache WHERE account_id = ? AND cache_key LIKE 'page:%'");
  assert.equal(affected.get(f.account.gmail).n, 1);
  assert.equal(affected.get(f.account.works).n, 1);
  assert.equal((await f.single('invalidate', id, 'archive')).state, 'confirmed');
  assert.equal(affected.get(f.account.gmail).n, 0);
  assert.equal(affected.get(f.account.works).n, 1);
  await assert.rejects(f.reader.inbox(list.nextCursor, 1), { code: 'MAIL_CLIENT_CURSOR_INVALID' });
  const current = await f.reader.inbox(null, 5);
  assert.equal(current.messages.some(message => message.accountId === f.account.gmail), false);
});

test('a first-page read already in flight is retried after a write instead of restoring a pre-mutation observation', async t => {
  const f = fixture(t);
  const id = await f.locate('gmail');
  let started;
  let release;
  const received = new Promise(resolve => { started = resolve; });
  f.gmail.state.afterMetadata = () => {
    f.gmail.state.afterMetadata = null;
    return new Promise(resolve => { release = resolve; started(); });
  };
  const oldList = f.reader.mailbox(f.account.gmail, 'all', null, 1);
  await received;
  assert.equal((await f.single('invalidate-while-loading', id, 'archive')).state, 'confirmed');
  release();
  const page = await oldList;
  assert.equal(page.messages[0].labelIds.includes('INBOX'), false);
  const cached = f.db.prepare("SELECT observation_json AS json FROM mail_client_cache WHERE cache_key LIKE 'page:%'").all();
  assert.equal(cached.length, 1);
  assert.equal(JSON.parse(cached[0].json).rows[0].metadata.labelIds.includes('INBOX'), false);
});
