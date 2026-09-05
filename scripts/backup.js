'use strict';

// 볼트 + DB 백업. 서버 인프로세스(서버의 db 연결 재사용)에서도, cron/CLI에서도 돌아간다.
//   인프로세스: require('./scripts/backup').runBackup({ db })
//   CLI/cron : node scripts/backup.js

const path = require('path');
const fsp = require('fs/promises');
const { execFile } = require('child_process');
const { randomUUID } = require('crypto');
const Database = require('better-sqlite3');
const { resolveRuntimePaths } = require('../lib/runtime-paths');

const RETENTION_DAYS = 7;
const BACKUP_FILE_RE = /^((galpi|council)-.*\.db|vault-.*\.tar\.gz)$/;

function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function defaultBackupDir() {
  return resolveRuntimePaths({ appRoot: path.resolve(__dirname, '..') }).backupDir;
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
    // 중단된 프로세스가 남긴 임시 산출물도 같은 보관 기간 뒤 정리한다.
    if (!BACKUP_FILE_RE.test(filename.replace(/\.partial$/, ''))) continue;
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
      const stat = await fsp.stat(path.join(backupDir, filename));
      const { size, mtimeMs } = stat;
      if (!stat.isFile() || size === 0) continue;
      entries.push({ filename, size, mtimeMs });
    } catch { /* skip */ }
  }
  // 둘 중 하나만 공개된 뒤 프로세스가 종료돼도 최근 정상 백업으로 세지 않는다.
  const names = new Set(entries.map(entry => entry.filename));
  return entries.filter(({ filename }) => {
    const stamp = filename.replace(/^(galpi|council|vault)-/, '').replace(/\.(db|tar\.gz)$/, '');
    return names.has(`vault-${stamp}.tar.gz`)
      && (names.has(`galpi-${stamp}.db`) || names.has(`council-${stamp}.db`));
  }).sort((a, b) => b.mtimeMs - a.mtimeMs);
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
  const runtimePaths = resolveRuntimePaths({ appRoot: root });
  const dir = backupDir || runtimePaths.backupDir;
  const vault = vaultPath || runtimePaths.vaultPath;
  const dbPath = dbPathOverride || runtimePaths.dbPath;

  await fsp.mkdir(dir, { recursive: true });
  const stamp = `${timestamp()}-${randomUUID()}`;

  const dbDest = path.join(dir, `galpi-${stamp}.db`);
  const vaultDest = path.join(dir, `vault-${stamp}.tar.gz`);
  const dbTemp = `${dbDest}.partial`;
  const vaultTemp = `${vaultDest}.partial`;
  let ownDb = null;
  try {
    // SQLite 온라인 백업 — 서버가 쓰는 중에도 안전 (단순 복사로 인한 손상 방지)
    const conn = db || (ownDb = new Database(dbPath, { readonly: true, fileMustExist: true }));
    await conn.backup(dbTemp);
    await tarVault(vault, vaultTemp);

    // 두 산출물이 완성된 뒤 공개한다. link는 rename과 달리 기존 목적지를 덮어쓰지 않는다.
    await fsp.link(dbTemp, dbDest);
    try {
      await fsp.link(vaultTemp, vaultDest);
    } catch (err) {
      await fsp.unlink(dbDest);
      throw err;
    }
  } finally {
    if (ownDb) ownDb.close();
    await Promise.all([fsp.rm(dbTemp, { force: true }), fsp.rm(vaultTemp, { force: true })]);
  }

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
