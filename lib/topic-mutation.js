'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

function createSerialQueue() {
  let chain = Promise.resolve();

  return function enqueue(task) {
    if (typeof task !== 'function') throw new TypeError('실행할 mutation 함수가 필요합니다.');
    const run = chain.then(task);
    chain = run.then(() => {}, () => {});
    return run;
  };
}

function toBuffer(content) {
  return Buffer.isBuffer(content) ? content : Buffer.from(String(content ?? ''), 'utf8');
}

async function readSnapshot(fsImpl, filepath) {
  try {
    const [content, stat] = await Promise.all([
      fsImpl.readFile(filepath),
      fsImpl.stat(filepath),
    ]);
    if (!stat.isFile()) throw new Error(`mutation 대상이 파일이 아닙니다: ${filepath}`);
    return { exists: true, content, mode: stat.mode & 0o777 };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, content: null, mode: null };
    throw error;
  }
}

function assertExpectedSnapshot(change, snapshot) {
  if (!Object.hasOwn(change, 'expectedContent')) return;

  if (change.expectedContent === null) {
    if (snapshot.exists) throw new Error(`이미 존재하는 파일을 새로 만들 수 없습니다: ${change.filepath}`);
    return;
  }

  if (!snapshot.exists || !snapshot.content.equals(toBuffer(change.expectedContent))) {
    throw new Error(`파일이 읽은 뒤 변경되었습니다: ${change.filepath}`);
  }
}

async function atomicWriteFile(fsImpl, filepath, content, mode = null) {
  const tempPath = `${filepath}.mutation-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  await fsImpl.mkdir(path.dirname(filepath), { recursive: true });
  try {
    const options = mode === null ? undefined : { mode };
    await fsImpl.writeFile(tempPath, content, options);
    await fsImpl.rename(tempPath, filepath);
  } catch (error) {
    await fsImpl.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function applyFileChanges(fsImpl, changes, snapshots) {
  for (const change of changes.filter(item => item.nextContent !== null)) {
    const snapshot = snapshots.get(change.filepath);
    await atomicWriteFile(
      fsImpl,
      change.filepath,
      toBuffer(change.nextContent),
      snapshot.exists ? snapshot.mode : null,
    );
  }

  for (const change of changes.filter(item => item.nextContent === null)) {
    await fsImpl.rm(change.filepath, { force: true });
  }
}

async function restoreSnapshots(fsImpl, changes, snapshots) {
  const errors = [];

  for (const change of changes) {
    const snapshot = snapshots.get(change.filepath);
    try {
      if (snapshot.exists) {
        await atomicWriteFile(fsImpl, change.filepath, snapshot.content, snapshot.mode);
      } else {
        await fsImpl.rm(change.filepath, { force: true });
      }
    } catch (error) {
      errors.push(`${change.filepath}: ${error.message}`);
    }
  }

  if (errors.length > 0) throw new Error(`파일 snapshot 복원 실패: ${errors.join('; ')}`);
}

async function commitFileDatabaseMutation({
  db,
  changes,
  applyDatabase,
  verifyFiles = null,
  fsImpl = fs,
}) {
  if (!db?.transaction) throw new TypeError('SQLite DB 연결이 필요합니다.');
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new TypeError('적용할 파일 변경이 필요합니다.');
  }
  if (typeof applyDatabase !== 'function') throw new TypeError('DB mutation 함수가 필요합니다.');

  if (changes.some(change => (
    !String(change?.filepath || '').trim()
    || !Object.hasOwn(change, 'nextContent')
    || change.nextContent === undefined
    || !Object.hasOwn(change, 'expectedContent')
  ))) {
    throw new TypeError('각 파일 변경에는 filepath, expectedContent, nextContent가 필요합니다.');
  }
  const normalized = changes.map(change => ({
    ...change,
    filepath: path.resolve(String(change.filepath)),
  }));
  if (new Set(normalized.map(change => change.filepath)).size !== normalized.length) {
    throw new Error('같은 파일을 한 mutation에서 두 번 변경할 수 없습니다.');
  }

  const snapshots = new Map();
  for (const change of normalized) {
    const snapshot = await readSnapshot(fsImpl, change.filepath);
    assertExpectedSnapshot(change, snapshot);
    snapshots.set(change.filepath, snapshot);
  }

  try {
    await applyFileChanges(fsImpl, normalized, snapshots);
    if (verifyFiles) await verifyFiles();

    const applyTransaction = db.transaction(() => {
      const result = applyDatabase();
      if (result && typeof result.then === 'function') {
        throw new TypeError('DB mutation 함수는 동기 함수여야 합니다.');
      }
      return result;
    });
    return applyTransaction();
  } catch (error) {
    try {
      await restoreSnapshots(fsImpl, normalized, snapshots);
    } catch (restoreError) {
      throw new Error(`${error.message}; ${restoreError.message}`, { cause: error });
    }
    throw error;
  }
}

function createTopicMutationCoordinator({ db, fsImpl = fs } = {}) {
  if (!db?.transaction) throw new TypeError('SQLite DB 연결이 필요합니다.');
  const enqueue = createSerialQueue();

  return {
    run(task) {
      return enqueue(task);
    },
    commit(options) {
      return commitFileDatabaseMutation({ ...options, db, fsImpl });
    },
  };
}

module.exports = {
  atomicWriteFile,
  commitFileDatabaseMutation,
  createSerialQueue,
  createTopicMutationCoordinator,
};
