'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runBackup } = require('../scripts/backup');

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
  assert.ok((await fs.stat(result.vaultDest)).size > 0);
});
