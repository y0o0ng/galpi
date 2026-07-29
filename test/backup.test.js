'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runBackup, listBackups } = require('../scripts/backup');

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
  assert.match(path.basename(result.dbDest), /^galpi-\d{8}-\d{4}\.db$/);
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
    fs.writeFile(path.join(backupDir, 'vault-20260718-0100.tar.gz'), 'vault'),
    fs.writeFile(path.join(backupDir, 'unrelated.db'), 'ignore'),
  ]);

  const filenames = (await listBackups(backupDir)).map(entry => entry.filename).sort();
  assert.deepEqual(filenames, [
    'council-20260717-0100.db',
    'galpi-20260718-0100.db',
    'vault-20260718-0100.tar.gz',
  ]);
});
