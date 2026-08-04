'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function configuredPath(value) {
  const candidate = String(value || '').trim();
  return candidate ? path.resolve(candidate) : null;
}

function resolveRuntimePaths({
  env = process.env,
  appRoot = path.resolve(__dirname, '..'),
  homeDir = os.homedir(),
} = {}) {
  const root = path.resolve(appRoot);
  const dataDir = configuredPath(env.GALPI_DATA_DIR) || root;

  return {
    dataDir,
    dbPath: path.join(dataDir, 'galpi.db'),
    attachmentsTmpDir: path.join(dataDir, 'attachments', 'tmp'),
    vaultPath: configuredPath(env.VAULT_PATH) || path.join(root, 'galpi-vault'),
    backupDir: configuredPath(env.BACKUP_DIR) || path.join(homeDir, 'backups', 'galpi'),
  };
}

function ensureDataDirectory(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.statSync(dataDir).isDirectory()) {
    throw new Error(`갈피 데이터 경로가 디렉터리가 아닙니다: ${dataDir}`);
  }
}

module.exports = { ensureDataDirectory, resolveRuntimePaths };
