'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const Database = require('better-sqlite3');

const { runBackup, listBackups, pruneOldBackups } = require('../scripts/backup');

test('runBackup honors an explicit DB path and creates a matching vault archive', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-path-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dbPath = path.join(root, 'custom.db');
  const vaultPath = path.join(root, 'vault');
  const backupDir = path.join(root, 'backups');
  await fs.mkdir(vaultPath);
  await fs.writeFile(path.join(vaultPath, 'note.md'), '# note\n');

  const db = new Database(dbPath);
  db.exec('CREATE TABLE marker (value TEXT NOT NULL)');
  db.prepare('INSERT INTO marker VALUES (?)').run('custom-db');
  db.close();

  const result = await runBackup({
    projectDir: path.join(root, 'unused-project'),
    dbPath,
    vaultPath,
    backupDir,
    retentionDays: 30,
  });

  const backupDb = new Database(result.dbDest, { readonly: true });
  assert.equal(backupDb.prepare('SELECT value FROM marker').get().value, 'custom-db');
  backupDb.close();
  assert.match(path.basename(result.dbDest), /^galpi-\d{8}-\d{4}-[0-9a-f-]{36}\.db$/);
  assert.ok((await fs.stat(result.vaultDest)).size > 0);
});

test('runBackup follows the configured data, vault, and backup roots', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-runtime-paths-'));
  const originalEnv = {
    GALPI_DATA_DIR: process.env.GALPI_DATA_DIR,
    VAULT_PATH: process.env.VAULT_PATH,
    BACKUP_DIR: process.env.BACKUP_DIR,
  };
  t.after(async () => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  });

  const dataDir = path.join(root, 'data');
  const vaultPath = path.join(root, 'vault');
  const backupDir = path.join(root, 'backups');
  await Promise.all([fs.mkdir(dataDir), fs.mkdir(vaultPath)]);
  await fs.writeFile(path.join(vaultPath, 'note.md'), '# configured roots\n');
  process.env.GALPI_DATA_DIR = dataDir;
  process.env.VAULT_PATH = vaultPath;
  process.env.BACKUP_DIR = backupDir;

  const db = new Database(path.join(dataDir, 'galpi.db'));
  db.exec('CREATE TABLE marker (value TEXT NOT NULL)');
  db.prepare('INSERT INTO marker VALUES (?)').run('configured-db');
  db.close();

  const result = await runBackup({ projectDir: path.join(root, 'app'), retentionDays: 30 });
  const backupDb = new Database(result.dbDest, { readonly: true });
  assert.equal(backupDb.prepare('SELECT value FROM marker').get().value, 'configured-db');
  backupDb.close();
  assert.equal(result.backupDir, backupDir);
  assert.ok((await fs.stat(result.vaultDest)).size > 0);
});

test('listBackups keeps legacy council DB backups visible after the rename', async t => {
  const backupDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-list-'));
  t.after(() => fs.rm(backupDir, { recursive: true, force: true }));

  await Promise.all([
    fs.writeFile(path.join(backupDir, 'galpi-20260718-0100.db'), 'new'),
    fs.writeFile(path.join(backupDir, 'council-20260717-0100.db'), 'legacy'),
    fs.writeFile(path.join(backupDir, 'vault-20260717-0100.tar.gz'), 'legacy vault'),
    fs.writeFile(path.join(backupDir, 'vault-20260718-0100.tar.gz'), 'vault'),
    fs.writeFile(path.join(backupDir, 'unrelated.db'), 'ignore'),
  ]);

  const filenames = (await listBackups(backupDir)).map(entry => entry.filename).sort();
  assert.deepEqual(filenames, [
    'council-20260717-0100.db',
    'galpi-20260718-0100.db',
    'vault-20260717-0100.tar.gz',
    'vault-20260718-0100.tar.gz',
  ]);
});

test('same-instant retries and concurrent backups preserve complete earlier backups', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date() });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-retry-'));
  const vaultPath = path.join(root, 'vault');
  const backupDir = path.join(root, 'backups');
  const db = new Database(':memory:');
  t.after(async () => {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.mkdir(vaultPath);
  await fs.writeFile(path.join(vaultPath, 'note.md'), 'original');
  db.exec("CREATE TABLE marker(value TEXT); INSERT INTO marker VALUES ('original')");
  const first = await runBackup({ db, vaultPath, backupDir });
  const originalDb = await fs.readFile(first.dbDest);
  const originalTar = await fs.readFile(first.vaultDest);
  const originalEntries = await listBackups(backupDir);

  db.exec("UPDATE marker SET value = 'updated'");
  await assert.rejects(runBackup({ db, backupDir, vaultPath: path.join(root, 'missing') }));
  assert.deepEqual(await fs.readFile(first.dbDest), originalDb);
  assert.deepEqual(await fs.readFile(first.vaultDest), originalTar);
  assert.deepEqual(await listBackups(backupDir), originalEntries);
  assert.deepEqual((await fs.readdir(backupDir)).sort(), originalEntries.map(e => e.filename).sort());

  await fs.writeFile(path.join(vaultPath, 'note.md'), 'updated');
  const newer = await Promise.all([
    runBackup({ db, vaultPath, backupDir }),
    runBackup({ db, vaultPath, backupDir }),
  ]);
  assert.equal(new Set([first, ...newer].map(result => result.stamp)).size, 3);
  assert.equal((await listBackups(backupDir)).length, 6);
  for (const result of newer) {
    const copy = new Database(result.dbDest, { readonly: true });
    try {
      assert.equal(copy.prepare('SELECT value FROM marker').get().value, 'updated');
      assert.equal(copy.pragma('integrity_check', { simple: true }), 'ok');
    } finally { copy.close(); }
    const archive = await promisify(execFile)('tar', ['-xOf', result.vaultDest, 'vault/note.md']);
    assert.equal(archive.stdout, 'updated');
  }
  assert.deepEqual(await fs.readFile(first.dbDest), originalDb);
  assert.deepEqual(await fs.readFile(first.vaultDest), originalTar);
});

test('failed DB writes leave no backup or partial output', async t => {
  const backupDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-db-failure-'));
  t.after(() => fs.rm(backupDir, { recursive: true, force: true }));
  const db = { async backup(dest) {
    await fs.writeFile(dest, 'incomplete DB');
    throw new Error('disk full');
  } };
  await assert.rejects(runBackup({ db, backupDir }), /disk full/);
  assert.deepEqual(await listBackups(backupDir), []);
  assert.deepEqual(await fs.readdir(backupDir), []);
});

for (const suffix of ['.db', '.tar.gz']) {
  test(`publication collision at ${suffix} preserves the existing file and removes new partials`, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-publish-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const vaultPath = path.join(root, 'vault');
    const backupDir = path.join(root, 'backups');
    await fs.mkdir(vaultPath);
    await fs.writeFile(path.join(vaultPath, 'note.md'), 'note');
    const db = { backup: dest => fs.writeFile(dest, 'prepared database') };
    const link = fs.link;
    let existingPath;
    t.mock.method(fs, 'link', async (source, dest) => {
      // Even after the first publication, the pair must not be listed yet.
      assert.deepEqual(await listBackups(backupDir), []);
      if (dest.endsWith(suffix)) {
        existingPath = dest;
        await fs.writeFile(dest, 'existing backup', { flag: 'wx' });
      }
      return link(source, dest);
    });
    await assert.rejects(runBackup({ db, vaultPath, backupDir }), { code: 'EEXIST' });
    assert.equal(await fs.readFile(existingPath, 'utf8'), 'existing backup');
    assert.deepEqual(await fs.readdir(backupDir), [path.basename(existingPath)]);
    assert.deepEqual(await listBackups(backupDir), []);
  });
}

test('incomplete pairs never become the latest backup and expired partials are pruned', async t => {
  const backupDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-incomplete-'));
  t.after(() => fs.rm(backupDir, { recursive: true, force: true }));
  const complete = ['galpi-complete.db', 'vault-complete.tar.gz'];
  const incomplete = ['galpi-orphan.db', 'vault-unpaired.tar.gz', 'galpi-pending.db',
    'vault-pending.tar.gz.partial', 'galpi-unfinished.db.partial'];
  for (const filename of [...complete, ...incomplete, 'unrelated.partial']) {
    await fs.writeFile(path.join(backupDir, filename), filename);
  }
  // A matching directory is not a usable database backup.
  await fs.mkdir(path.join(backupDir, 'galpi-directory.db'));
  await fs.writeFile(path.join(backupDir, 'vault-directory.tar.gz'), 'unpaired');
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  for (const filename of complete) await fs.utimes(path.join(backupDir, filename), yesterday, yesterday);
  const entries = await listBackups(backupDir);
  assert.deepEqual(entries.map(e => e.filename).sort(), complete);
  assert.ok(entries[0].mtimeMs <= yesterday.getTime() + 1);

  const expired = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  for (const filename of [...incomplete, 'unrelated.partial']) {
    await fs.utimes(path.join(backupDir, filename), expired, expired);
  }
  assert.equal(await pruneOldBackups(backupDir), incomplete.length);
  assert.deepEqual((await listBackups(backupDir)).map(e => e.filename).sort(), complete);
  assert.equal(await fs.readFile(path.join(backupDir, 'unrelated.partial'), 'utf8'), 'unrelated.partial');
});
