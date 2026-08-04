'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ensureDataDirectory, resolveRuntimePaths } = require('../lib/runtime-paths');

test('runtime paths keep the native layout when no path environment is configured', () => {
  const appRoot = path.join(path.sep, 'srv', 'galpi');
  const homeDir = path.join(path.sep, 'home', 'operator');
  const paths = resolveRuntimePaths({ env: {}, appRoot, homeDir });

  assert.deepEqual(paths, {
    dataDir: appRoot,
    dbPath: path.join(appRoot, 'galpi.db'),
    attachmentsTmpDir: path.join(appRoot, 'attachments', 'tmp'),
    vaultPath: path.join(appRoot, 'galpi-vault'),
    backupDir: path.join(homeDir, 'backups', 'galpi'),
  });
});

test('runtime paths separate database, vault, and backups using configured roots', () => {
  const paths = resolveRuntimePaths({
    env: {
      GALPI_DATA_DIR: '/var/lib/galpi',
      VAULT_PATH: '/vault',
      BACKUP_DIR: '/backups',
    },
    appRoot: '/app',
    homeDir: '/home/node',
  });

  assert.equal(paths.dataDir, '/var/lib/galpi');
  assert.equal(paths.dbPath, '/var/lib/galpi/galpi.db');
  assert.equal(path.dirname(`${paths.dbPath}-wal`), paths.dataDir);
  assert.equal(path.dirname(`${paths.dbPath}-shm`), paths.dataDir);
  assert.equal(paths.attachmentsTmpDir, '/var/lib/galpi/attachments/tmp');
  assert.equal(paths.vaultPath, '/vault');
  assert.equal(paths.backupDir, '/backups');
});

test('ensureDataDirectory creates the configured database directory', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'galpi-runtime-paths-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const dataDir = path.join(tempRoot, 'nested', 'data');

  ensureDataDirectory(dataDir);

  assert.equal(fs.statSync(dataDir).isDirectory(), true);
});
