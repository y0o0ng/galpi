'use strict';

// 볼트 + DB 백업. 서버 인프로세스(서버의 db 연결 재사용)에서도, cron/CLI에서도 돌아간다.
//   인프로세스: require('./scripts/backup').runBackup({ db })
//   CLI/cron : node scripts/backup.js

const path = require('path');
const os = require('os');
const fsp = require('fs/promises');
const { execFile } = require('child_process');
const Database = require('better-sqlite3');

const RETENTION_DAYS = 7;
const BACKUP_FILE_RE = /^((galpi|council)-.*\.db|vault-.*\.tar\.gz)$/;

function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function defaultBackupDir() {
  return process.env.BACKUP_DIR || path.join(os.homedir(), 'backups', 'galpi');
}

function tarVault(vaultPath, dest) {
  return new Promise((resolve, reject) => {
    execFile(
      'tar',
      ['-czf', dest, '-C', path.dirname(vaultPath), path.basename(vaultPath)],
      { maxBuffer: 1024 * 1024 * 64 },
      (err) => (err ? reject(err) : resolve()),
    );
  });
}

async function pruneOldBackups(backupDir, retentionDays = RETENTION_DAYS) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let files;
  try {
    files = await fsp.readdir(backupDir);
  } catch {
    return 0;
  }

  let pruned = 0;
  for (const filename of files) {
    if (!BACKUP_FILE_RE.test(filename)) continue;
    const filepath = path.join(backupDir, filename);
    try {
      const { mtimeMs } = await fsp.stat(filepath);
      if (mtimeMs < cutoff) {
        await fsp.unlink(filepath);
        pruned += 1;
      }
    } catch { /* 개별 파일 실패는 무시 */ }
  }
  return pruned;
}

async function listBackups(backupDir = defaultBackupDir()) {
  let files;
  try {
    files = await fsp.readdir(backupDir);
  } catch {
    return [];
  }

  const entries = [];
  for (const filename of files) {
    if (!BACKUP_FILE_RE.test(filename)) continue;
    try {
      const { size, mtimeMs } = await fsp.stat(path.join(backupDir, filename));
      entries.push({ filename, size, mtimeMs });
    } catch { /* skip */ }
  }
  return entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

// db를 넘기면(인프로세스) 서버 연결로 온라인 백업, 안 넘기면(CLI) readonly 연결을 새로 연다.
async function runBackup({
  projectDir,
  dbPath: dbPathOverride,
  vaultPath,
  backupDir,
  db,
  retentionDays = RETENTION_DAYS,
} = {}) {
  const root = projectDir || path.resolve(__dirname, '..');
  const dir = backupDir || defaultBackupDir();
  const vault = vaultPath
    || (process.env.VAULT_PATH ? path.resolve(process.env.VAULT_PATH) : path.join(root, 'galpi-vault'));
  const dbPath = dbPathOverride || path.join(root, 'galpi.db');

  await fsp.mkdir(dir, { recursive: true });
  const stamp = timestamp();

  // SQLite 온라인 백업 — 서버가 쓰는 중에도 안전 (단순 복사로 인한 손상 방지)
  const dbDest = path.join(dir, `galpi-${stamp}.db`);
  let ownDb = null;
  const conn = db || (ownDb = new Database(dbPath, { readonly: true, fileMustExist: true }));
  try {
    await conn.backup(dbDest);
  } finally {
    if (ownDb) ownDb.close();
  }

  const vaultDest = path.join(dir, `vault-${stamp}.tar.gz`);
  await tarVault(vault, vaultDest);

  const pruned = await pruneOldBackups(dir, retentionDays);
  return { backupDir: dir, dbDest, vaultDest, stamp, pruned };
}

module.exports = { runBackup, pruneOldBackups, listBackups, defaultBackupDir };

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  runBackup()
    .then((r) => {
      console.log(`✅ 백업 완료\n   DB:   ${r.dbDest}\n   볼트: ${r.vaultDest}\n   오래된 백업 ${r.pruned}개 삭제 (보관 ${RETENTION_DAYS}일)`);
    })
    .catch((err) => {
      console.error('❌ 백업 실패:', err.message);
      process.exit(1);
    });
}
