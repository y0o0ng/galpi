'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { migrations } = require('../lib/database-migrations');
const { createMailClientContacts } = require('../lib/mail/client-contacts');
const { createMailStore } = require('../lib/mail/store');

test('CSV preview is read-only, import preserves existing contacts, and observation is explicit and reversible', t => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, created_at INTEGER)');
  for (const version of [7, 9, 19, 20, 21, 45, 49]) migrations.find(migration => migration.version === version).up(db);
  const contacts = createMailClientContacts(db);
  const entries = [
    { name: '김연구', email: 'Team@example.com', organization: '실험실' },
    { name: '덮어쓰기', email: 'team@EXAMPLE.COM' },
    { email: 'one@example.com\nBcc: two@example.com' },
  ];
  assert.deepEqual(contacts.import({ entries, preview: true }), { created: 1, skipped: 1, invalid: 1 });
  assert.equal(contacts.list({}).total, 0);
  assert.deepEqual(contacts.import({ entries }), { created: 1, skipped: 1, invalid: 1 });
  assert.deepEqual(contacts.import({ entries: [{ name: '다른 이름', email: 'TEAM@example.com' }] }),
    { created: 0, skipped: 1, invalid: 0 });
  assert.equal(contacts.list({ q: '실험실' }).contacts[0].name, '김연구');
  assert.equal(contacts.list({ source: 'works' }).total, 0);
  const store = createMailStore(db);
  const account = store.registerAccount({ provider: 'gmail', address: 'self@example.com', now: 20 });
  db.prepare(`INSERT INTO mail_client_messages (account_id, location_key, proof_key, locator_json, metadata_json, fetched_at)
    VALUES (?, 'example', 'example', '{}', ?, 40)`).run(account.id, JSON.stringify({
    from: [{ name: '시온', address: 'from@example.com' }],
    to: [{ address: 'self@example.com' }, { name: '기존', address: 'team@example.com' }, { address: 'to@example.com' }],
  }));
  assert.equal(contacts.list({ source: 'observed' }).total, 0);
  assert.deepEqual(contacts.setCollection({ enabled: true }), { collectionEnabled: true });
  assert.deepEqual(contacts.list({ source: 'observed' }).contacts.map(entry => entry.email).sort(), ['from@example.com', 'to@example.com']);
  assert.equal(contacts.list({}).total, 3);
  contacts.setCollection({ enabled: false });
  assert.equal(contacts.list({}).total, 1);
  assert.equal(db.prepare('SELECT count(*) AS size FROM mail_client_contacts').get().size, 1);
  assert.throws(() => contacts.import({ entries: [{ email: 'sender@example.com', role: 'admin' }] }), { code: 'MAIL_CLIENT_CONTACTS_INVALID' });
});

test('contact pages preserve sorting, filtering and totals beyond 200 CSV and observed contacts', t => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, created_at INTEGER)');
  for (const version of [7, 9, 19, 20, 21, 45, 49]) migrations.find(migration => migration.version === version).up(db);
  const contacts = createMailClientContacts(db);
  const entries = source => Array.from({ length: 205 }, (_, i) => ({ name: 'contact ' + String(i).padStart(3, '0'),
    email: `${source}${i}@example.com` }));
  assert.equal(contacts.import({ entries: entries('csv') }).created, 205);
  const account = createMailStore(db).registerAccount({ provider: 'gmail', address: 'self@example.com', now: 20 });
  db.prepare(`INSERT INTO mail_client_messages (account_id, location_key, proof_key, locator_json, metadata_json, fetched_at)
    VALUES (?, 'example', 'example', '{}', ?, 40)`).run(account.id, JSON.stringify({
    from: [{ address: 'CSV0@example.com' }], to: entries('observed').map(({ name, email }) => ({ name, address: email })),
  }));
  contacts.setCollection({ enabled: true });
  for (const source of ['csv', 'observed']) {
    const first = contacts.list({ source, q: 'contact', limit: '200' });
    assert.equal(first.total, 205);
    assert.equal(first.nextOffset, 200);
    const next = contacts.list({ source, q: 'contact', limit: '200', offset: String(first.nextOffset) });
    assert.equal(next.total, 205);
    assert.equal(next.nextOffset, undefined);
    assert.deepEqual([...first.contacts, ...next.contacts].map(entry => entry.email), entries(source).map(entry => entry.email));
    assert.equal(contacts.list({ source, offset: '999' }).total, 205);
  }
  assert.equal(contacts.list({}).total, 410);
  assert.equal(contacts.list({ q: 'csv200', limit: '6' }).contacts.length, 1);
});
