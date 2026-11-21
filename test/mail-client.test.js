'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { migrations } = require('../lib/database-migrations');
const { createMailStore } = require('../lib/mail/store');
const { createGmailProvider, createGoogleTokenSource } = require('../lib/mail/gmail');
const { createGmailMailClient } = require('../lib/mail/client-gmail');
const { createImapMailClient } = require('../lib/mail/client-imap');
const { createMailClient } = require('../lib/mail/client');

const NOW = Date.parse('2026-11-21T12:00:00Z') / 1000;
const DAY = 86400;
const PRIOR_WINDOW_END = (Math.floor(NOW / DAY) + 1) * DAY - 7 * DAY;
const SENT = new Date('2026-11-20T23:00:00Z');
const SOURCE_BODY = 'abcdefg'.repeat(2700) + 'end-of-full-body';
const FILE_CONTENT = 'never-store-attachment';
const SOURCE = Buffer.from([
  'From: Teacher <teacher@example.com>',
  'To: Friend <friend@example.com>',
  'Cc: Office <office@example.com>',
  'Reply-To: Reply <reply@example.com>',
  'Date: ' + SENT.toUTCString(),
  'Subject: Original subject',
  'Message-ID: <same@example.com>',
  'References: <older@example.com> <parent@example.com>',
  'In-Reply-To: <parent@example.com>',
  'Content-Type: multipart/mixed; boundary="parts"',
  '',
  '--parts',
  'Content-Type: text/plain; charset=utf-8',
  '',
  SOURCE_BODY,
  '--parts',
  'Content-Type: text/plain',
  'Content-Disposition: attachment; filename="office.txt"',
  '',
  FILE_CONTENT,
  '--parts--',
  '',
].join('\r\n'));

function gmailMessage(id, date, labels, raw = SOURCE) {
  return {
    id, threadId: 'thread-' + id, internalDate: String(date * 1000), labelIds: labels, raw: raw.toString('base64url'),
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: 'Teacher <teacher@example.com>' },
        { name: 'To', value: 'Friend <friend@example.com>' },
        { name: 'Date', value: SENT.toUTCString() },
        { name: 'Subject', value: 'Original subject' },
        { name: 'Message-ID', value: '<same@example.com>' },
      ],
      parts: [{ mimeType: 'text/plain' }, { filename: 'office.txt', mimeType: 'text/plain' }],
    },
  };
}

function fakeGmail() {
  const calls = [];
  const mail = [
    gmailMessage('archived', NOW - 1, ['Label_2', 'IMPORTANT', 'UNREAD']),
    gmailMessage('g-inbox', NOW - 5, ['Label_2', 'INBOX', 'UNREAD']),
    gmailMessage('g-older', NOW - 86400 * 8, ['INBOX']),
  ];
  let unavailable = false;
  let unavailableWindowEnd = null;
  let emailAddress = 'test@gmail.com';
  let tokenFetches = 0;
  async function fetch(url, init) {
    const parsed = new URL(url);
    if (parsed.hostname === 'oauth2.googleapis.com') {
      assert.equal(init.method, 'POST');
      tokenFetches += 1;
      return Response.json({ access_token: 'mock-read-token', expires_in: 3600 });
    }
    assert.equal(parsed.hostname, 'gmail.googleapis.com');
    assert.equal(init.method || 'GET', 'GET');
    assert.equal(init.headers.authorization, 'Bearer mock-read-token');
    const endpoint = parsed.pathname.replace('/gmail/v1/users/me', '');
    calls.push({ endpoint, query: parsed.searchParams });
    if (unavailable) return Response.json({}, { status: 503 });
    if (endpoint === '/profile') return Response.json({ emailAddress });
    if (endpoint === '/labels') return Response.json({ labels: [
      { id: 'INBOX', name: 'INBOX', type: 'system' }, { id: 'Label_2', name: 'Project', type: 'user' },
    ] });
    if (endpoint === '/messages') {
      const query = parsed.searchParams.get('q') || '';
      const after = Number(query.match(/after:(\d+)/)?.[1] ?? -1);
      const before = Number(query.match(/before:(\d+)/)?.[1] ?? Infinity);
      if (after >= 0 && before === unavailableWindowEnd) return Response.json({}, { status: 503 });
      const label = parsed.searchParams.get('labelIds');
      const found = mail.filter(row => (!label || row.labelIds.includes(label))
        && Number(row.internalDate) / 1000 > after && Number(row.internalDate) / 1000 < before);
      const offset = Number(parsed.searchParams.get('pageToken') || 0);
      const limit = Number(parsed.searchParams.get('maxResults') || 100);
      const messages = found.slice(offset, offset + limit).map(({ id }) => ({ id }));
      return Response.json({
        messages,
        ...(offset + limit < found.length ? { nextPageToken: String(offset + limit) } : {}),
      });
    }
    const id = endpoint.split('/').at(-1);
    const message = mail.find(row => row.id === id);
    return message ? Response.json(message) : Response.json({}, { status: 404 });
  }
  const tokens = createGoogleTokenSource({ credentials: { refreshToken: 'mock-refresh-token' }, fetch });
  return {
    adapter: createGmailMailClient({ tokenSource: tokens, fetch }),
    legacy: createGmailProvider({ tokenSource: tokens, fetch }),
    calls,
    tokenFetches: () => tokenFetches,
    setMessages(messages) { mail.splice(0, mail.length, ...messages); },
    setUnavailable(value) { unavailable = value; },
    setUnavailableWindow(end) { unavailableWindowEnd = end; },
    setEmailAddress(value) { emailAddress = value; },
  };
}

function imapMessage(uid, receivedAt, { source = SOURCE, flags = [], messageId = '<same@example.com>' } = {}) {
  return {
    uid,
    source,
    size: source.length,
    internalDate: new Date(receivedAt * 1000),
    envelope: {
      messageId,
      subject: 'Original subject',
      date: SENT,
      from: [{ name: 'Teacher', address: 'teacher@example.com' }],
      to: [{ name: 'Friend', address: 'friend@example.com' }],
      cc: [{ name: 'Office', address: 'office@example.com' }],
      inReplyTo: '<parent@example.com>',
    },
    headers: Buffer.from('References: <older@example.com> <parent@example.com>\r\n'),
    bodyStructure: { childNodes: [{ disposition: 'attachment' }] },
    flags: new Set(flags),
  };
}

function fakeImap() {
  const naver = {
    folders: [
      { path: 'INBOX', name: '받은메일함', flags: new Set() },
      { path: 'Projects/2026', name: '2026', flags: new Set(), delimiter: '/' },
      { path: 'NoSelect', flags: new Set(['\\Noselect']) },
    ],
    rows: {
      INBOX: [imapMessage(80, NOW - 2), imapMessage(81, NOW - 10, { flags: ['\\Seen'] })],
      'Projects/2026': [imapMessage(19, NOW - 20), imapMessage(20, NOW - 30)],
    },
    validity: 0n,
    unavailable: false,
  };
  const works = {
    folders: [
      { path: 'Received', name: '학교 받은 메일', specialUse: '\\Inbox', flags: new Set() },
      { path: 'Sent Messages', name: '보냄', specialUse: '\\Sent', flags: new Set() },
    ],
    rows: { Received: [imapMessage(3, NOW - 5, { flags: ['\\Flagged'] })], 'Sent Messages': [] },
    validity: 12n,
    unavailable: false,
  };
  const calls = [];
  const adapter = createImapMailClient({
    credentialsFor(account) {
      return { user: account.provider === 'naver' ? 'test' : 'test@school.example.com', pass: 'app-password' };
    },
    createClient(credentials) {
      const state = credentials.user === 'test' ? naver : works;
      let path;
      const rows = () => state.rows[path] || [];
      return {
        async connect() {
          if (state.unavailable) throw new Error('isolated mock failure');
        },
        async logout() {},
        async list() { return state.folders; },
        async getMailboxLock(mailbox, options) {
          assert.deepEqual(options, { readOnly: true });
          assert.ok(state.folders.some(folder => folder.path === mailbox));
          path = mailbox;
          calls.push({ path, operation: 'EXAMINE' });
          this.mailbox = {
            uidNext: Math.max(0, ...rows().map(row => row.uid)) + 1,
            uidValidity: state.validity, exists: rows().length,
          };
          return { release() { path = null; } };
        },
        async search(terms, options) {
          assert.ok(path);
          assert.equal(options.uid, true);
          const [low, high] = terms.uid.split(':').map(Number);
          const found = rows().filter(row => row.uid >= low && row.uid <= high
            && (!terms.since || row.internalDate >= terms.since)
            && (!terms.before || row.internalDate < terms.before)).map(row => row.uid);
          return options.returnOptions ? { count: found.length } : found;
        },
        async *fetch(set, query, options) {
          assert.ok(path);
          assert.equal(options.uid, true);
          assert.equal(query.source, undefined);
          const ids = new Set(set.split(',').map(Number));
          for (const row of rows().filter(row => ids.has(row.uid))) yield { ...row, source: undefined };
        },
        async fetchOne(uid, query, options) {
          assert.ok(path);
          assert.equal(options.uid, true);
          assert.ok(query.source?.maxLength);
          calls.push({ path, operation: 'PEEK', uid });
          return rows().find(row => row.uid === Number(uid)) ?? false;
        },
      };
    },
  });
  return { naver, works, calls, adapter };
}

function fixture(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, created_at INTEGER)');
  for (const version of [7, 9, 19, 20, 21, 45]) migrations.find(item => item.version === version).up(db);
  const store = createMailStore(db);
  const gmail = fakeGmail();
  const imap = fakeImap();
  let now = NOW;
  const addAccount = (provider, address) => store.registerAccount({ provider, address, now }).id;
  const service = createMailClient({
    db, agentStore: store, providers: { gmail: gmail.adapter, naver: imap.adapter, works: imap.adapter }, now: () => now,
  });
  return { db, store, service, gmail, imap, addAccount, advance(seconds) { now += seconds; } };
}

test('Gmail labels and All Mail cover archived messages with a shared read token and unchanged Agent INBOX policy', async t => {
  const f = fixture(t);
  const accountId = f.addAccount('gmail', 'test@gmail.com');
  const { mailboxes } = await f.service.mailboxes(accountId);
  assert.deepEqual(mailboxes.map(({ id, kind }) => [id, kind]), [
    ['all', 'all'], ['label:INBOX', 'label'], ['label:Label_2', 'label'],
  ]);
  const all = await f.service.mailbox(accountId, 'all', null, 1);
  assert.equal(all.messages[0].providerMessageId, 'archived');
  assert.equal(all.messages[0].hasAttachments, true);
  assert.equal(all.messages[0].important, true);
  assert.ok(all.nextCursor);
  const label = await f.service.mailbox(accountId, 'label:Label_2', null, 1);
  assert.equal(label.messages[0].id, all.messages[0].id);
  const next = await f.service.mailbox(accountId, 'all', all.nextCursor, 1);
  assert.equal(next.messages[0].providerMessageId, 'g-inbox');
  await assert.rejects(f.service.mailbox(accountId, 'label:INBOX', all.nextCursor, 1), { code: 'MAIL_CLIENT_CURSOR_INVALID' });
  const detail = await f.service.detail(all.messages[0].id);
  assert.equal(detail.body.text.trim(), SOURCE_BODY);
  assert.equal(detail.body.format, 'text');
  assert.deepEqual(detail.thread, {
    providerThreadId: 'thread-archived', messageId: '<same@example.com>',
    inReplyTo: '<parent@example.com>', references: ['<older@example.com>', '<parent@example.com>'],
  });
  assert.equal(detail.to[0].address, 'friend@example.com');
  assert.equal(detail.cc[0].address, 'office@example.com');
  assert.equal(detail.replyTo[0].address, 'reply@example.com');
  assert.equal(detail.attachments[0].filename, 'office.txt');
  assert.ok(!JSON.stringify(detail.attachments).includes(FILE_CONTENT));
  assert.equal(detail.read, false);
  await assert.rejects(f.gmail.legacy.fetchRaw('archived'), { code: 'MAIL_MESSAGE_EXCLUDED' });
  assert.equal((await f.gmail.legacy.fetchRaw('g-inbox')).raw.length, SOURCE.length);
  assert.equal(f.gmail.tokenFetches(), 1);
  const values = f.db.prepare('SELECT locator_json, metadata_json FROM mail_client_messages').all();
  const observations = f.db.prepare('SELECT observation_json FROM mail_client_cache').all();
  for (const value of [...values, ...observations]) {
    assert.ok(!JSON.stringify(value).includes('end-of-full-body'));
    assert.ok(!JSON.stringify(value).includes(FILE_CONTENT));
  }
  assert.equal(f.store.countMessages(accountId), 0);
  assert.equal(f.store.getSyncState(accountId).baselineComplete, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM mail_attention').get().n, 0);
});

test('Gmail STARRED and IMPORTANT are independent in list and detail metadata', async t => {
  const f = fixture(t);
  const account = f.addAccount('gmail', 'test@gmail.com');
  const labels = [['STARRED'], ['IMPORTANT'], ['STARRED', 'IMPORTANT'], []];
  const originals = labels.map((entry, i) => gmailMessage('marks-' + i, NOW - i, entry));
  f.gmail.setMessages(originals);
  const page = await f.service.mailbox(account, 'all', null, 20);
  const marks = ({ starred, important }) => [starred, important];
  const expected = [[true, false], [false, true], [true, true], [false, false]];
  assert.deepEqual(page.messages.map(marks), expected);
  const details = await Promise.all(page.messages.map(message => f.service.detail(message.id)));
  assert.deepEqual(details.map(marks), expected);
  originals[0].labelIds = ['IMPORTANT'];
  assert.deepEqual(marks(await f.service.detail(page.messages[0].id)), [false, true]);
});

test('stale pages from the previous metadata contract still separate manual stars from importance', async t => {
  const f = fixture(t);
  const gmail = f.addAccount('gmail', 'test@gmail.com');
  const works = f.addAccount('works', 'test@school.example.com');
  f.gmail.setMessages([gmailMessage('legacy-star', NOW, ['STARRED'])]);
  await f.service.mailbox(gmail, 'all', null, 20);
  await f.service.mailbox(works, 'folder:Received', null, 20);
  f.db.prepare("UPDATE mail_client_cache SET observation_json = json_remove(observation_json, '$.rows[0].metadata.starred')").run();
  f.db.prepare(`
    UPDATE mail_client_cache
    SET observation_json = json_set(observation_json, '$.rows[0].metadata.important', json('true'))
    WHERE account_id = ? AND cache_key LIKE 'page:%'
  `).run(works);
  f.gmail.setUnavailable(true);
  f.imap.works.unavailable = true;
  const gmailPage = await f.service.mailbox(gmail, 'all', null, 20);
  const worksPage = await f.service.mailbox(works, 'folder:Received', null, 20);
  assert.equal(gmailPage.source.status, 'stale');
  assert.equal(worksPage.source.status, 'stale');
  assert.deepEqual(gmailPage.messages.map(({ starred, important }) => [starred, important]), [[true, false]]);
  assert.deepEqual(worksPage.messages.map(({ starred, important }) => [starred, important]), [[true, null]]);
});

test('Naver and Works list real folders and paginate by UID in read-only mailboxes', async t => {
  const f = fixture(t);
  const naver = f.addAccount('naver', 'test@naver.com');
  const works = f.addAccount('works', 'test@school.example.com');
  const folders = await f.service.mailboxes(naver);
  assert.deepEqual(folders.mailboxes.map(folder => folder.path), ['INBOX', 'Projects/2026', 'NoSelect']);
  assert.equal(folders.mailboxes[2].selectable, false);
  const { mailboxes } = await f.service.mailboxes(works);
  assert.equal(mailboxes[0].path, 'Received');
  assert.equal(mailboxes[0].inbox, true);
  assert.equal(mailboxes[1].specialUse, '\\Sent');
  const p1 = await f.service.mailbox(naver, 'folder:Projects/2026', null, 1);
  const p2 = await f.service.mailbox(naver, 'folder:Projects/2026', p1.nextCursor, 1);
  assert.equal(p1.messages[0].folderPath, 'Projects/2026');
  assert.equal(p2.messages[0].folderPath, 'Projects/2026');
  assert.notEqual(p1.messages[0].id, p2.messages[0].id);
  assert.equal(p1.messages[0].rfcMessageId, p2.messages[0].rfcMessageId);
  assert.equal((await f.service.mailbox(naver, 'folder:Projects/2026', null, 1)).messages[0].id, p1.messages[0].id);
  f.imap.naver.rows.INBOX.push(imapMessage(20, NOW - 30));
  const inboxCopy = (await f.service.mailbox(naver, 'folder:INBOX', null, 5)).messages.find(row => row.receivedAt === NOW - 30);
  assert.notEqual(inboxCopy.id, p1.messages[0].id);
  assert.equal(p1.messages[0].starred, false);
  assert.equal(p1.messages[0].important, null);
  const naverDetail = await f.service.detail(p1.messages[0].id);
  assert.equal(naverDetail.read, false);
  assert.equal(naverDetail.starred, false);
  assert.equal(f.imap.naver.rows['Projects/2026'][1].flags.has('\\Seen'), false);
  const worksPage = await f.service.mailbox(works, 'folder:Received', null, 1);
  assert.equal(worksPage.messages[0].starred, true);
  assert.equal(worksPage.messages[0].important, null);
  const worksDetail = await f.service.detail(worksPage.messages[0].id);
  assert.equal(worksDetail.starred, true);
  assert.equal(worksDetail.important, null);
  assert.equal(worksDetail.body.text.trim(), SOURCE_BODY);
  await assert.rejects(f.service.mailbox(naver, 'folder:Sent', null, 1), { code: 'MAIL_CLIENT_MAILBOX_NOT_FOUND' });
});

test('a reused UID with unchanged headers, size and UIDVALIDITY 0 cannot reopen the earlier message', async t => {
  const f = fixture(t);
  const account = f.addAccount('naver', 'test@naver.com');
  const folder = 'folder:Projects/2026';
  const first = await f.service.mailbox(account, folder, null, 1);
  const row = f.imap.naver.rows['Projects/2026'][1];
  row.source = Buffer.from(row.source.toString().replace('end-of-full-body', 'another-raw-body'));
  assert.equal(row.source.length, row.size);
  await assert.rejects(f.service.detail(first.messages[0].id), { code: 'MAIL_CLIENT_LOCATION_STALE' });
  const newer = await f.service.mailbox(account, folder, null, 1);
  assert.notEqual(newer.messages[0].id, first.messages[0].id);
  assert.match((await f.service.detail(newer.messages[0].id)).body.text, /another-raw-body/);
  f.imap.naver.validity = 15n;
  await assert.rejects(f.service.detail(newer.messages[0].id), { code: 'MAIL_CLIENT_LOCATION_STALE' });
});

test('unified inbox sorts by receive time across providers and replays stable cursors without duplicates', async t => {
  const f = fixture(t);
  const gmail = f.addAccount('gmail', 'test@gmail.com');
  const naver = f.addAccount('naver', 'test@naver.com');
  const works = f.addAccount('works', 'test@school.example.com');
  const found = [];
  let page = await f.service.inbox(null, 1);
  while (true) {
    found.push(...page.messages);
    assert.equal(page.incomplete, false);
    if (!page.nextCursor) break;
    const token = page.nextCursor;
    page = await f.service.inbox(token, 1);
    assert.deepEqual(await f.service.inbox(token, 1), page);
    assert.ok(found.length < 10);
  }
  assert.deepEqual(found.map(row => row.accountId), [naver, gmail, works, naver, gmail]);
  assert.equal(new Set(found.map(row => row.id)).size, found.length);
  assert.deepEqual(found.map(row => row.receivedAt), [NOW - 2, NOW - 5, NOW - 5, NOW - 10, NOW - 8 * 86400]);
});

test('unified inbox fills a page across a UTC window boundary and returns only the remaining messages', async t => {
  const f = fixture(t);
  const gmail = f.addAccount('gmail', 'test@gmail.com');
  const works = f.addAccount('works', 'test@school.example.com');
  const gmailRows = [
    gmailMessage('recent', NOW - 1, ['INBOX']),
    ...Array.from({ length: 28 }, (_, i) => gmailMessage('older-' + i, PRIOR_WINDOW_END - 3 - i, ['INBOX'])),
  ];
  f.gmail.setMessages([...gmailRows, gmailRows[1]]);
  f.imap.works.rows.Received = [
    imapMessage(4, PRIOR_WINDOW_END),
    imapMessage(3, PRIOR_WINDOW_END - 1),
    imapMessage(2, PRIOR_WINDOW_END - 2),
  ];
  const first = await f.service.inbox(null, 20);
  assert.equal(first.messages.length, 20);
  assert.deepEqual(first.messages.slice(0, 5).map(row => row.accountId), [gmail, works, works, works, gmail]);
  assert.ok(first.nextCursor);
  const next = await f.service.inbox(first.nextCursor, 20);
  assert.deepEqual(await f.service.inbox(first.nextCursor, 20), next);
  assert.equal(next.messages.length, 12);
  assert.equal(next.nextCursor, null);
  const all = [...first.messages, ...next.messages];
  assert.equal(new Set(all.map(row => row.id)).size, 32);
  assert.deepEqual(all.map(row => row.receivedAt), [
    NOW - 1, PRIOR_WINDOW_END, PRIOR_WINDOW_END - 1, PRIOR_WINDOW_END - 2,
    ...Array.from({ length: 28 }, (_, i) => PRIOR_WINDOW_END - 3 - i),
  ]);
});

test('unified inbox stops after three windows and resumes across empty windows on the same cursor contract', async t => {
  const f = fixture(t);
  f.addAccount('gmail', 'test@gmail.com');
  f.gmail.setMessages([
    gmailMessage('recent-a', NOW, ['INBOX']),
    gmailMessage('recent-b', NOW - 1, ['INBOX']),
    gmailMessage('far-past', NOW - 35 * DAY, ['INBOX']),
  ]);
  const countWindows = () => f.gmail.calls.filter(({ endpoint, query }) => endpoint === '/messages'
    && query.get('q')?.startsWith('after:')).length;
  const page = await f.service.inbox(null, 20);
  assert.deepEqual(page.messages.map(row => row.providerMessageId), ['recent-a', 'recent-b']);
  assert.equal(countWindows(), 3);
  assert.ok(page.nextCursor);
  const next = await f.service.inbox(page.nextCursor, 20);
  assert.deepEqual(next.messages.map(row => row.providerMessageId), ['far-past']);
  assert.equal(next.nextCursor, null);
  assert.equal(countWindows(), 6);
  assert.deepEqual(await f.service.inbox(page.nextCursor, 20), next);
  assert.equal(countWindows(), 6);
  f.advance(600);
  await assert.rejects(f.service.inbox(page.nextCursor, 20), { code: 'MAIL_CLIENT_CURSOR_INVALID' });
});

test('unified inbox retains each range observation when one account contributes fresh and stale rows', async t => {
  const f = fixture(t);
  f.addAccount('gmail', 'test@gmail.com');
  f.gmail.setMessages([
    gmailMessage('newer', NOW, ['INBOX']),
    gmailMessage('older', PRIOR_WINDOW_END - 1, ['INBOX']),
  ]);
  const live = await f.service.inbox(null, 20);
  assert.equal(live.messages.length, 2);
  assert.equal(live.nextCursor, null);
  f.advance(45);
  f.gmail.setUnavailableWindow(PRIOR_WINDOW_END);
  const mixed = await f.service.inbox(null, 20);
  assert.equal(mixed.incomplete, true);
  assert.equal(mixed.sources[0].status, 'stale');
  assert.deepEqual(mixed.messages.map(row => [row.providerMessageId, row.stale, row.fetchedAt]), [
    ['newer', false, NOW + 45],
    ['older', true, NOW],
  ]);
});

test('a later window failure preserves earlier rows from that account and older rows from healthy accounts', async t => {
  const f = fixture(t);
  const gmail = f.addAccount('gmail', 'test@gmail.com');
  const works = f.addAccount('works', 'test@school.example.com');
  f.gmail.setMessages([
    gmailMessage('visible', NOW, ['INBOX']),
    gmailMessage('unavailable', PRIOR_WINDOW_END - 1, ['INBOX']),
  ]);
  f.imap.works.rows.Received = [imapMessage(3, PRIOR_WINDOW_END - 2)];
  f.gmail.setUnavailableWindow(PRIOR_WINDOW_END);
  const page = await f.service.inbox(null, 20);
  assert.deepEqual(page.messages.map(row => row.accountId), [gmail, works]);
  assert.deepEqual(page.sources.map(source => source.status), ['unavailable', 'fresh']);
  assert.equal(page.incomplete, true);
  assert.equal(page.nextCursor, null);
});

test('an unavailable account leaves healthy inbox rows and reports old cached metadata with an observation time', async t => {
  const f = fixture(t);
  const gmail = f.addAccount('gmail', 'test@gmail.com');
  const works = f.addAccount('works', 'test@school.example.com');
  f.gmail.setUnavailable(true);
  const partial = await f.service.inbox(null, 10);
  assert.equal(partial.incomplete, true);
  assert.deepEqual(partial.sources.map(source => source.status), ['unavailable', 'fresh']);
  assert.deepEqual(partial.messages.map(row => row.accountId), [works]);
  f.gmail.setUnavailable(false);
  const old = await f.service.inbox(null, 10);
  assert.equal(old.incomplete, false);
  f.advance(120);
  f.gmail.setUnavailable(true);
  const stale = await f.service.inbox(null, 10);
  assert.equal(stale.incomplete, true);
  assert.equal(stale.sources[0].status, 'stale');
  assert.equal(stale.sources[0].ageSeconds, 120);
  assert.equal(stale.sources[0].failure.code, 'MAIL_CLIENT_PROVIDER_UNAVAILABLE');
  const row = stale.messages.find(row => row.accountId === gmail);
  assert.equal(row.stale, true);
  assert.ok(stale.messages.some(row => row.accountId === works));
  await assert.rejects(f.service.detail(row.id), { code: 'MAIL_CLIENT_PROVIDER_UNAVAILABLE' });
  f.gmail.setUnavailable(false);
  f.gmail.setEmailAddress('wrong@gmail.com');
  const mismatch = await f.service.inbox(null, 10);
  assert.deepEqual(mismatch.sources.map(source => source.status), ['unavailable', 'fresh']);
  assert.equal(mismatch.sources[0].failure.code, 'MAIL_CLIENT_ACCOUNT_MISMATCH');
});

test('a cached Naver mailbox page keeps the last verified IDs and marks the observation stale', async t => {
  const f = fixture(t);
  const account = f.addAccount('naver', 'test@naver.com');
  const live = await f.service.mailbox(account, 'folder:INBOX', null, 5);
  f.advance(300);
  f.imap.naver.unavailable = true;
  const old = await f.service.mailbox(account, 'folder:INBOX', null, 5);
  assert.equal(old.source.status, 'stale');
  assert.equal(old.source.ageSeconds, 300);
  assert.equal(old.incomplete, true);
  assert.deepEqual(old.messages.map(row => row.id), live.messages.map(row => row.id));
  assert.ok(old.messages.every(row => row.stale));
});

test('Attention links verify account, INBOX location and independent envelope evidence without changing Agent state', async t => {
  const f = fixture(t);
  const accountId = f.addAccount('naver', 'test@naver.com');
  const { message } = f.store.saveMessage({
    accountId, identityKind: 'rfc_message_id', identityKey: '<same@example.com>',
    imapUid: 80, imapUidValidity: '0', senderAddress: 'teacher@example.com',
    subject: 'Original subject', receivedAt: SENT.getTime() / 1000, isBaseline: true,
  }, NOW);
  const attentionId = f.db.prepare('INSERT INTO mail_attention (mail_message_id) VALUES (?)').run(message.id).lastInsertRowid;
  const link = await f.service.fromAttention(attentionId);
  const detail = await f.service.detail(link.id);
  assert.equal(detail.agentMessageId, message.id);
  assert.equal(detail.folderPath, 'INBOX');
  assert.equal(f.db.prepare('SELECT analysis_state state FROM mail_messages').get().state, 'skipped');
  assert.equal(f.store.findAttentionById(attentionId).state, 'open');
  assert.equal(f.db.prepare('SELECT count(*) n FROM mail_push_deliveries').get().n, 0);
  const original = f.imap.naver.rows.INBOX[0];
  original.source = Buffer.from(original.source.toString().replace('end-of-full-body', 'another-raw-body'));
  await assert.rejects(f.service.fromAttention(attentionId), { code: 'MAIL_CLIENT_LOCATION_STALE' });
  const changed = await f.service.mailbox(accountId, 'folder:INBOX', null, 5);
  const replacement = changed.messages.find(row => row.receivedAt === NOW - 2);
  assert.notEqual(replacement.id, link.id);
  assert.equal(replacement.agentMessageId, null);
  original.envelope.from = [{ address: 'wrong@example.com' }];
  await assert.rejects(f.service.fromAttention(attentionId), { code: 'MAIL_CLIENT_LOCATION_STALE' });
  await assert.rejects(f.service.detail(link.id), { code: 'MAIL_CLIENT_LOCATION_STALE' });
});

test('HTML-only mail is returned as text without script content or attachment bytes', async t => {
  const f = fixture(t);
  const account = f.addAccount('works', 'test@school.example.com');
  const source = Buffer.from([
    'From: Teacher <teacher@example.com>',
    'Subject: HTML mail',
    'Message-ID: <same@example.com>',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>Safe visible text.</p><script>run_trap()</script><img src="https://example.com/pixel" onerror="run_trap()">',
  ].join('\r\n'));
  f.imap.works.rows.Received = [imapMessage(3, NOW - 5, { source })];
  const page = await f.service.mailbox(account, 'folder:Received', null, 1);
  const detail = await f.service.detail(page.messages[0].id);
  assert.deepEqual(detail.body, { format: 'text', text: 'Safe visible text.' });
  assert.equal(detail.hasAttachments, false);
});
