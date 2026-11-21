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
      ...['SPAM', 'TRASH', 'DRAFT'].map(id => ({ id, name: id, type: 'system' })),
    ] });
    if (endpoint === '/messages') {
      const query = parsed.searchParams.get('q') || '';
      const after = Number(query.match(/after:(\d+)/)?.[1] ?? -1);
      const before = Number(query.match(/before:(\d+)/)?.[1] ?? Infinity);
      if (after >= 0 && before === unavailableWindowEnd) return Response.json({}, { status: 503 });
      const label = parsed.searchParams.get('labelIds');
      const fieldsOnly = [...query.matchAll(/(subject|from|to):"([^"]+)"/g)];
      const orEnd = query.indexOf('}');
      const matches = (row, [, field, term]) => row.payload.headers.find(header => header.name.toLowerCase() === field)
        ?.value.toLowerCase().includes(term);
      const found = mail.filter(row => (!label || row.labelIds.includes(label))
        && Number(row.internalDate) / 1000 > after && Number(row.internalDate) / 1000 < before
        && (parsed.searchParams.has('includeSpamTrash') || !row.labelIds.some(value => ['SPAM', 'TRASH'].includes(value)))
        && (!query.includes('-in:drafts') || !row.labelIds.includes('DRAFT'))
        && (!query.includes('is:unread') || row.labelIds.includes('UNREAD'))
        && (!query.includes('is:read') || !row.labelIds.includes('UNREAD'))
        && (!query.includes('is:starred') || row.labelIds.includes('STARRED'))
        && (!query.includes('has:attachment') || row.payload.parts?.some(part => part.filename))
        && (orEnd < 0 || fieldsOnly.filter(match => match.index < orEnd).some(match => matches(row, match)))
        && fieldsOnly.filter(match => match.index > orEnd).every(match => matches(row, match)));
      const offset = Number(parsed.searchParams.get('pageToken') || 0);
      const limit = Number(parsed.searchParams.get('maxResults') || 100);
      const messages = found.slice(offset, offset + limit).map(({ id }) => ({ id }));
      const fields = parsed.searchParams.get('fields');
      if (!found.length && fields) {
        return fields.split(',').includes('resultSizeEstimate')
          ? Response.json({ resultSizeEstimate: 0 }) : new Response(null, { status: 204 });
      }
      return Response.json({
        messages,
        ...(offset + limit < found.length ? { nextPageToken: String(offset + limit) } : {}),
      });
    }
    const id = endpoint.split('/').at(-1);
    if (endpoint.startsWith('/threads/')) {
      const messages = mail.filter(row => row.threadId === id).map(({ raw, ...metadata }) => metadata);
      return messages.length ? Response.json({ id, messages }) : Response.json({}, { status: 404 });
    }
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

test('an empty Gmail mailbox and inbox range stay available', async () => {
  const gmail = fakeGmail();
  gmail.setMessages([]);
  const account = { address: 'test@gmail.com' };
  const inbox = { providerId: 'INBOX' };
  assert.deepEqual(await gmail.adapter.page(account, inbox, null, 20), { rows: [], next: null });
  assert.deepEqual(await gmail.adapter.inboxRange(account, inbox, { from: NOW - 3600, to: NOW, maximum: 200 }), {
    rows: [], earlier: false, anchor: null,
  });
});

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
          calls.push({ path, operation: 'SEARCH', terms });
          const [low, high] = terms.uid.split(':').map(Number);
          const textMatches = (row, filters) => (!filters.subject || row.envelope.subject.toLowerCase().includes(filters.subject))
            && ['from', 'to'].every(key => !filters[key] || row.envelope[key].some(({ name, address }) =>
              name.toLowerCase().includes(filters[key]) || address.toLowerCase().includes(filters[key])));
          const hasFlag = (row, field, flag) => terms[field] === undefined || row.flags.has(flag) === terms[field];
          const found = rows().filter(row => row.uid >= low && row.uid <= high
            && (!terms.since || row.internalDate >= terms.since)
            && (!terms.before || row.internalDate < terms.before)
            && hasFlag(row, 'seen', '\\Seen') && hasFlag(row, 'flagged', '\\Flagged')
            && hasFlag(row, 'draft', '\\Draft') && hasFlag(row, 'deleted', '\\Deleted')
            && textMatches(row, terms) && (!terms.or || terms.or.some(filter => textMatches(row, filter)))).map(row => row.uid);
          return options.returnOptions ? { count: found.length } : found;
        },
        async *fetch(set, query, options) {
          assert.ok(path);
          assert.equal(options.uid, true);
          assert.equal(query.source, undefined);
          const ids = new Set(set.split(',').map(Number));
          calls.push({ path, operation: 'FETCH', ids: [...ids] });
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

function fixture(t, smartEnabled = false) {
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
    db, agentStore: store, smartEnabled, providers: { gmail: gmail.adapter, naver: imap.adapter, works: imap.adapter }, now: () => now,
  });
  return { db, store, service, gmail, imap, addAccount, advance(seconds) { now += seconds; } };
}

test('Gmail labels and All Mail cover archived messages with a shared read token and unchanged Agent INBOX policy', async t => {
  const f = fixture(t);
  const accountId = f.addAccount('gmail', 'test@gmail.com');
  const { mailboxes } = await f.service.mailboxes(accountId);
  assert.deepEqual(mailboxes.map(({ id, kind }) => [id, kind]), [
    ['all', 'all'], ['label:INBOX', 'label'], ['label:Label_2', 'label'],
    ['label:SPAM', 'label'], ['label:TRASH', 'label'], ['label:DRAFT', 'label'],
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

test('HTML-only mail retains original markup and a clean plain-text fallback without attachment bytes', async t => {
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
  assert.equal(detail.body.format, 'text');
  assert.equal(detail.body.text, 'Safe visible text.');
  assert.match(detail.body.html, /<p>Safe visible text\.<\/p>/u);
  assert.equal(detail.body.blockedRemoteImages, 1);
  assert.equal(detail.hasAttachments, false);
});

test('CID image bytes come from the verified message and only raster inline parts can be read', async t => {
  const f = fixture(t);
  const account = f.addAccount('gmail', 'test@gmail.com');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l8sAAAAASUVORK5CYII=';
  const raw = Buffer.from([
    'From: Teacher <teacher@example.com>', 'Subject: HTML with inline image', 'MIME-Version: 1.0',
    'Content-Type: multipart/related; boundary=body', '', '--body', 'Content-Type: text/html', '',
    '<p>본문 그림</p><img src="cid:logo@example.com">', '--body', 'Content-Type: image/png',
    'Content-ID: <logo@example.com>', 'Content-Disposition: inline', 'Content-Transfer-Encoding: base64', '', png,
    '--body', 'Content-Type: image/svg+xml', 'Content-ID: <script@example.com>', 'Content-Disposition: inline', '',
    '<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>',
    '--body', 'Content-Type: image/png', 'Content-ID: <fake@example.com>', 'Content-Disposition: inline', '',
    '<html>Not a PNG</html>', '--body--', '',
  ].join('\r\n'));
  const message = gmailMessage('cid', NOW, ['UNREAD'], raw);
  f.gmail.setMessages([message]);
  const { messages: [item] } = await f.service.mailbox(account, 'all', null, 10);
  const detail = await f.service.detail(item.id);
  const indexOf = cid => detail.attachments.findIndex(attachment => attachment.contentId === `<${cid}@example.com>`);
  assert.match(detail.body.html, /cid:logo@example.com/);
  assert.ok(!JSON.stringify(detail).includes(png));
  assert.deepEqual(await f.service.inlineImage(item.id, indexOf('logo')), { contentType: 'image/png', bytes: Buffer.from(png, 'base64') });
  for (const cid of ['script', 'fake']) await assert.rejects(f.service.inlineImage(item.id, indexOf(cid)), { code: 'MAIL_CLIENT_ATTACHMENT_NOT_FOUND' });
  await assert.rejects(f.service.attachment(item.id, indexOf('logo')), { code: 'MAIL_CLIENT_ATTACHMENT_NOT_FOUND' });
  assert.deepEqual(message.labelIds, ['UNREAD']);
  f.gmail.setMessages([]);
  await assert.rejects(f.service.inlineImage(item.id, indexOf('logo')), { code: 'MAIL_CLIENT_MESSAGE_GONE' });
});

test('smart source checks freshly read Gmail labels and rejects reused IDs before opening content', async t => {
  const f = fixture(t, true);
  const accountId = f.addAccount('gmail', 'test@gmail.com');
  const original = gmailMessage('reused', NOW, ['IMPORTANT']);
  f.gmail.setMessages([original]);
  const { messages: [listed] } = await f.service.mailbox(accountId, 'all', null, 20);
  assert.equal((await f.service.openAnalysisSource(listed.id)).row.metadata.important, true);

  f.gmail.setMessages([{ ...original, labelIds: ['SENT'] }]);
  const requests = f.gmail.calls.length;
  await assert.rejects(f.service.openAnalysisSource(listed.id), { code: 'MAIL_CLIENT_SMART_INELIGIBLE' });
  assert.equal(f.gmail.calls.slice(requests).some(call => call.query.get('format') === 'raw'), false);

  f.gmail.setMessages([{ ...original, internalDate: String((NOW + 1) * 1000) }]);
  await assert.rejects(f.service.openAnalysisSource(listed.id), { code: 'MAIL_CLIENT_LOCATION_STALE' });
});

test('smart IMAP eligibility uses server roles, retains distinct locations and rejects stale proofs', async t => {
  const f = fixture(t, true);
  const accountId = f.addAccount('naver', 'test@naver.com');
  for (const [path, role] of [['A', 'Sent'], ['B', 'Drafts'], ['C', 'Trash'], ['D', 'Junk']]) {
    f.imap.naver.folders.push({ path, flags: new Set(['\\' + role]) });
    f.imap.naver.rows[path] = [imapMessage(17, NOW - 10)];
  }
  const { mailboxes } = await f.service.mailboxes(accountId);
  assert.ok(mailboxes.every(mailbox => !Object.hasOwn(mailbox, 'analysisEligible')));
  const { messages: [ordinary] } = await f.service.mailbox(accountId, 'folder:Projects/2026', null, 20);
  const { messages: [inbox] } = await f.service.mailbox(accountId, 'folder:INBOX', null, 20);
  assert.equal(ordinary.rfcMessageId, inbox.rfcMessageId);
  assert.notEqual(ordinary.id, inbox.id);
  assert.equal((await f.service.openAnalysisSource(ordinary.id)).cached.locator.analysisMailboxEligible, true);
  assert.equal((await f.service.openAnalysisSource(ordinary.id)).agentMessageId, null);
  for (const folder of ['A', 'B', 'C', 'D']) {
    const { messages: [excluded] } = await f.service.mailbox(accountId, 'folder:' + folder, null, 20);
    await assert.rejects(f.service.openAnalysisSource(excluded.id), { code: 'MAIL_CLIENT_SMART_INELIGIBLE' });
  }
  f.imap.naver.folders.find(folder => folder.path === 'D').flags.clear();
  const ordinaryFolder = f.imap.naver.folders.find(folder => folder.path === 'Projects/2026');
  ordinaryFolder.specialUse = '\\Archive';
  ordinaryFolder.specialUseSource = 'name';
  await assert.rejects(f.service.openAnalysisSource(ordinary.id), { code: 'MAIL_CLIENT_SMART_MAILBOX_UNVERIFIED' });
  ordinaryFolder.specialUseSource = 'extension';
  assert.ok((await f.service.openAnalysisSource(ordinary.id)).raw.equals(SOURCE));

  f.imap.naver.rows.INBOX = f.imap.naver.rows.INBOX.map(row => ({
    ...row, source: Buffer.from(SOURCE.toString().replace('end-of-full-body', 'new-of-full-body')),
  }));
  await assert.rejects(f.service.openAnalysisSource(inbox.id), { code: 'MAIL_CLIENT_LOCATION_STALE' });
  const { messages: [replacement] } = await f.service.mailbox(accountId, 'folder:INBOX', null, 20);
  assert.notEqual(inbox.id, replacement.id);
  f.imap.naver.validity = 44n;
  await assert.rejects(f.service.openAnalysisSource(replacement.id), { code: 'MAIL_CLIENT_LOCATION_STALE' });
  f.imap.naver.rows['Projects/2026'] = [];
  await assert.rejects(f.service.openAnalysisSource(ordinary.id), { code: 'MAIL_CLIENT_LOCATION_STALE' });
  assert.ok(f.imap.calls.every(call => ['EXAMINE', 'PEEK', 'SEARCH', 'FETCH'].includes(call.operation)));
});

test('Workspace searches unobserved historical messages across Gmail, Naver and Works, using headers only', async t => {
  const f = fixture(t);
  const gmail = f.addAccount('gmail', 'test@gmail.com');
  const naver = f.addAccount('naver', 'test@naver.com');
  const works = f.addAccount('works', 'test@school.example.com');
  const old = Date.parse('2022-03-18T12:00:00Z') / 1000;
  const g = gmailMessage('old-gmail', old + 2, ['Label_2', 'STARRED']);
  g.payload.headers.find(header => header.name === 'Subject').value = '오래된 연구 기록';
  f.gmail.setMessages([g]);
  const n = imapMessage(23, old + 1);
  n.envelope.from[0].name = '오래된 연구팀';
  f.imap.naver.rows['Projects/2026'] = [n];
  const w = imapMessage(9, old, { flags: ['\\Flagged'] });
  w.envelope.to[0].name = '오래된 기록 수신자';
  f.imap.works.rows['Sent Messages'] = [w];

  assert.equal(f.db.prepare('SELECT count(*) AS n FROM mail_client_messages').get().n, 0);
  const query = { q: '오래된' };
  const first = await f.service.search(query, null, null, 2);
  assert.equal(first.coverage, 'provider_mailboxes');
  assert.deepEqual(first.messages.map(row => row.accountId), [gmail, naver]);
  assert.ok(first.messages.every(row => !row.stale && row.id));
  assert.equal(first.total, 3);
  assert.ok(first.nextCursor);
  const next = await f.service.search(query, null, first.nextCursor, 2);
  assert.deepEqual(next.messages.map(row => row.accountId), [works]);
  assert.equal(next.nextCursor, null);
  const callCount = f.imap.calls.length + f.gmail.calls.length;
  assert.deepEqual(await f.service.search(query, null, first.nextCursor, 2), next);
  assert.equal(f.imap.calls.length + f.gmail.calls.length, callCount);
  assert.throws(() => f.service.search({ q: 'different' }, null, first.nextCursor, 2), { code: 'MAIL_CLIENT_CURSOR_INVALID' });
  f.advance(601);
  assert.throws(() => f.service.search(query, null, first.nextCursor, 2), { code: 'MAIL_CLIENT_CURSOR_INVALID' });
  assert.equal((await f.service.detail(first.messages[1].id)).read, false);
  assert.equal(n.flags.has('\\Seen'), false);
  n.source = Buffer.from(SOURCE.toString().replace('end-of-full-body', 'new-of-full-body'));
  await assert.rejects(f.service.detail(first.messages[1].id), { code: 'MAIL_CLIENT_LOCATION_STALE' });
  assert.equal(f.store.countMessages(naver), 0);
  assert.ok(f.gmail.calls.find(call => call.endpoint === '/messages' && call.query.get('q')
    ?.includes('{subject:"오래된" from:"오래된" to:"오래된"}')));
  assert.ok(f.imap.calls.find(call => call.operation === 'SEARCH' && call.terms.or?.some(term => term.to === '오래된')));
  const body = await f.service.search({ q: 'end-of-full-body' }, null, null, 10);
  assert.deepEqual(body.messages, []);
  assert.equal(body.total, 0);
});

test('related mail finds exact case-insensitive From and To addresses across providers, excluding subject and display-name matches', async t => {
  const f = fixture(t);
  const gmail = f.addAccount('gmail', 'test@gmail.com');
  const naver = f.addAccount('naver', 'test@naver.com');
  const works = f.addAccount('works', 'test@school.example.com');
  const g = gmailMessage('sender', NOW - 500 * DAY, []);
  g.payload.headers.find(header => header.name === 'From').value = 'Friend <ALICE@example.com>';
  const subjectOnly = gmailMessage('subject', NOW - 2, []);
  subjectOnly.payload.headers.find(header => header.name === 'Subject').value = 'For alice@example.com';
  f.gmail.setMessages([subjectOnly, g]);
  const n = imapMessage(9, NOW - 600 * DAY);
  n.envelope.to = [{ name: 'Alice', address: 'alice@EXAMPLE.com' }];
  const displayOnly = imapMessage(10, NOW - 300 * DAY);
  displayOnly.envelope.from = [{ name: 'alice@example.com', address: 'other@example.com' }];
  const partial = imapMessage(11, NOW - 310 * DAY);
  partial.envelope.to = [{ address: 'not-alice@example.com', name: 'Partial result' }];
  f.imap.naver.rows['Projects/2026'] = [n, displayOnly, partial];
  const w = imapMessage(4, NOW - 700 * DAY);
  w.envelope.from = [{ address: 'Alice@example.com', name: 'Alice' }];
  f.imap.works.rows['Sent Messages'] = [w];
  const exact = { contactEmail: 'Alice@Example.COM' };
  const first = await f.service.search(exact, null, null, 1);
  assert.equal(first.messages[0].accountId, gmail);
  assert.throws(() => f.service.search({ q: 'alice@example.com' }, null, first.nextCursor, 1), { code: 'MAIL_CLIENT_CURSOR_INVALID' });
  const next = await f.service.search(exact, null, first.nextCursor, 1);
  assert.equal(next.messages[0].accountId, naver);
  const last = await f.service.search(exact, null, next.nextCursor, 1);
  assert.equal(last.messages[0].accountId, works);
  assert.equal(last.nextCursor, null);
  assert.equal(last.total, 3);
  const plain = await f.service.search({ q: 'alice@example.com' }, null, null, 20);
  assert.ok(plain.messages.some(row => row.providerMessageId === 'subject'));
  assert.throws(() => f.service.search({ contactEmail: 'alice' }, null, null, 1), { code: 'MAIL_CLIENT_SEARCH_INVALID' });
});

test('Workspace filter-only search uses actual folder scopes, flags and exact KST dates', async t => {
  const f = fixture(t);
  const gmail = f.addAccount('gmail', 'test@gmail.com');
  const naver = f.addAccount('naver', 'test@naver.com');
  f.addAccount('works', 'test@school.example.com');
  const from = Date.parse('2022-03-17T15:00:00Z') / 1000;
  const mail = [
    gmailMessage('g-spam', from + 5, ['SPAM', 'STARRED', 'UNREAD']),
    gmailMessage('g-trash', from + 4, ['TRASH', 'STARRED', 'UNREAD']),
    gmailMessage('g-draft', from + 3, ['DRAFT', 'STARRED', 'UNREAD']),
    gmailMessage('g-archived', from, ['Label_2', 'STARRED', 'UNREAD']),
    gmailMessage('g-before', from - 1, ['STARRED', 'UNREAD']),
  ];
  f.gmail.setMessages(mail);
  const project = f.imap.naver.rows['Projects/2026'] = [
    imapMessage(13, from - 1, { flags: ['\\Flagged'] }),
    imapMessage(15, from + DAY, { flags: ['\\Flagged'] }),
    imapMessage(23, from + 2, { flags: ['\\Flagged', '\\Seen'] }),
    imapMessage(32, from + 1, { flags: ['\\Flagged'] }),
    imapMessage(36, from + 1, { flags: ['\\Flagged'] }),
  ];
  project.at(-1).bodyStructure = {};
  f.imap.naver.rows.INBOX.push(imapMessage(92, from + 1, { flags: ['\\Draft', '\\Flagged'] }));
  for (const [path, role] of [['스팸메일함', '\\Junk'], ['휴지통', '\\Trash'], ['임시보관함', '\\Drafts']]) {
    f.imap.naver.folders.push({ path, flags: new Set([role]) });
    f.imap.naver.rows[path] = [imapMessage(1, from + 9, { flags: ['\\Flagged', ...(role === '\\Drafts' ? ['\\Draft'] : [])] })];
  }
  const query = { read: 'unread', starred: 'true', attachments: 'true', from: '2022-03-18', until: '2022-03-18' };
  const all = await f.service.search(query, null, null, 20);
  assert.deepEqual(all.messages.map(row => [row.accountId, row.providerMessageId, row.folderPath]),
    [[naver, null, 'Projects/2026'], [gmail, 'g-archived', null]]);
  assert.equal(all.total, 2);
  assert.equal(all.nextCursor, null);
  const inbox = await f.service.search({ ...query, inbox: '1' }, null, null, 20);
  assert.deepEqual(inbox.messages, []);
  for (const label of ['SPAM', 'TRASH', 'DRAFT']) {
    const direct = await f.service.search({ ...query, accountId: String(gmail), mailbox: 'label:' + label }, gmail, null, 20);
    assert.equal(direct.messages[0].providerMessageId, 'g-' + label.toLowerCase());
  }
  for (const path of ['스팸메일함', '휴지통', '임시보관함']) {
    const direct = await f.service.search({ ...query, accountId: String(naver), mailbox: 'folder:' + path }, naver, null, 20);
    assert.equal(direct.messages[0].folderPath, path);
  }
  const bySender = await f.service.search({ ...query, sender: 'office' }, null, null, 20);
  assert.deepEqual(bySender.messages, []);
  assert.throws(() => f.service.search({ from: '2026-02-31' }, naver, null, 10), { code: 'MAIL_CLIENT_SEARCH_INVALID' });
});

test('Workspace search pages provider candidates on demand and reports partial account failures', async t => {
  const f = fixture(t);
  f.addAccount('gmail', 'test@gmail.com');
  const naver = f.addAccount('naver', 'test@naver.com');
  const works = f.addAccount('works', 'test@school.example.com');
  f.gmail.setUnavailable(true);
  f.imap.naver.rows['Projects/2026'] = Array.from({ length: 42 }, (_, index) => imapMessage(index + 1, NOW - 4000 + index));
  const query = { q: 'friend@example.com' };
  const first = await f.service.search(query, null, null, 20);
  assert.ok(first.incomplete);
  assert.deepEqual(first.sources.map(source => source.status).sort(), ['fresh', 'fresh', 'unavailable']);
  assert.equal(first.messages[0].accountId, naver);
  assert.ok(first.messages.some(row => row.accountId === works));
  assert.equal(first.messages.length, 20);
  assert.ok(!f.imap.calls.some(call => call.path === 'Projects/2026' && call.operation === 'FETCH' && call.ids.includes(1)));
  const ids = first.messages.map(row => row.id);
  for (let cursor = first.nextCursor; cursor;) {
    const next = await f.service.search(query, null, cursor, 20);
    assert.ok(next.incomplete);
    for (const row of next.messages) {
      assert.ok(!ids.includes(row.id));
      ids.push(row.id);
    }
    cursor = next.nextCursor;
  }
  assert.equal(ids.length, 45);
});

test('Gmail search continues with the provider page token and does not fetch the whole mailbox up front', async t => {
  const f = fixture(t);
  const account = f.addAccount('gmail', 'test@gmail.com');
  const mail = Array.from({ length: 25 }, (_, index) => gmailMessage('archived-' + index, NOW - DAY * 100 - index, ['STARRED']));
  f.gmail.setMessages(mail);
  const query = { starred: 'true' };
  const first = await f.service.search(query, account, null, 20);
  assert.deepEqual(first.messages.map(row => row.providerMessageId), mail.slice(0, 20).map(row => row.id));
  assert.equal(f.gmail.calls.filter(call => call.endpoint.startsWith('/messages/')).length, 20);
  const next = await f.service.search(query, account, first.nextCursor, 20);
  assert.deepEqual(next.messages.map(row => row.providerMessageId), mail.slice(20).map(row => row.id));
  assert.equal(next.total, 25);
  assert.equal(next.nextCursor, null);
  assert.ok(f.gmail.calls.some(call => call.endpoint === '/messages' && call.query.get('pageToken') === '20'));
  assert.ok(f.gmail.calls.filter(call => call.endpoint.startsWith('/messages/')).every(call =>
    !/\b(?:body|raw)\b/.test(call.query.get('fields'))));
});

test('Gmail details load the actual thread and give unobserved messages stable, openable IDs', async t => {
  const f = fixture(t);
  const account = f.addAccount('gmail', 'test@gmail.com');
  const active = gmailMessage('active', NOW, ['INBOX', 'UNREAD']);
  const older = gmailMessage('older', NOW - DAY, ['UNREAD', 'STARRED']);
  const sent = gmailMessage('sent', NOW - DAY + 20, ['SENT']);
  older.threadId = sent.threadId = active.threadId;
  f.gmail.setMessages([active, older, sent]);
  const page = await f.service.mailbox(account, 'label:INBOX', null, 1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM mail_client_messages').get().n, 1);
  const detail = await f.service.detail(page.messages[0].id);
  assert.deepEqual(detail.thread.messages.map(row => row.receivedAt), [NOW - DAY, NOW - DAY + 20]);
  assert.ok(detail.thread.messages.every(row => row.from.length && Object.keys(row).sort().join() === 'from,id,receivedAt,subject'));
  const request = f.gmail.calls.find(call => call.endpoint === '/threads/thread-active');
  assert.ok(request);
  assert.doesNotMatch(request.query.get('fields'), /\b(?:body|raw)\b/);
  const related = await f.service.detail(detail.thread.messages[0].id);
  assert.equal(related.providerMessageId, 'older');
  assert.equal(related.body.text.trim(), SOURCE_BODY);
  assert.equal(related.read, false);
  assert.equal(related.starred, true);
  assert.deepEqual(older.labelIds, ['UNREAD', 'STARRED']);
  assert.deepEqual(related.thread.messages.map(row => row.id), [detail.thread.messages[1].id, page.messages[0].id]);

  const threadGets = f.gmail.calls.filter(call => call.endpoint === '/threads/thread-active').length;
  await f.service.detail(detail.id, { includeThread: false });
  assert.equal(f.gmail.calls.filter(call => call.endpoint === '/threads/thread-active').length, threadGets);
});

test('Workspace downloads only the selected verified non-inline attachment', async t => {
  const f = fixture(t);
  const account = f.addAccount('naver', 'test@naver.com');
  const observed = await f.service.mailbox(account, 'folder:INBOX', null, 1);
  const id = observed.messages[0].id;
  const file = await f.service.attachment(id, 0);
  assert.equal(file.filename, 'office.txt');
  assert.equal(file.bytes.toString(), FILE_CONTENT + '\n');
  await assert.rejects(f.service.attachment(id, 1), { code: 'MAIL_CLIENT_ATTACHMENT_NOT_FOUND' });
});
