'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const {
  createTopicMutationCoordinator,
} = require('../lib/topic-mutation');

async function createFixture(t, fsImpl = fs) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'topic-mutation-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const db = new Database(':memory:');
  db.exec('CREATE TABLE changes (value TEXT NOT NULL)');
  t.after(() => db.close());
  return {
    root,
    db,
    coordinator: createTopicMutationCoordinator({ db, fsImpl }),
  };
}

test('topic mutation queue serializes work and continues after a rejected task', async t => {
  const { coordinator } = await createFixture(t);
  const order = [];
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });

  const first = coordinator.run(async () => {
    order.push('first:start');
    await firstGate;
    order.push('first:end');
  });
  const second = coordinator.run(async () => {
    order.push('second');
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['first:start']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first:start', 'first:end', 'second']);

  await assert.rejects(coordinator.run(async () => {
    throw new Error('expected failure');
  }), /expected failure/);
  await coordinator.run(async () => order.push('after-failure'));
  assert.equal(order.at(-1), 'after-failure');
});

test('topic mutation commits multiple files and DB changes together', async t => {
  const { root, db, coordinator } = await createFixture(t);
  const source = path.join(root, 'source.md');
  const target = path.join(root, 'target.md');
  await fs.writeFile(source, 'source before');

  coordinator.run(() => coordinator.commit({
    changes: [
      { filepath: source, expectedContent: 'source before', nextContent: 'source after' },
      { filepath: target, expectedContent: null, nextContent: 'target after' },
    ],
    applyDatabase() {
      db.prepare('INSERT INTO changes VALUES (?)').run('committed');
    },
  }));

  await coordinator.run(async () => {});
  assert.equal(await fs.readFile(source, 'utf8'), 'source after');
  assert.equal(await fs.readFile(target, 'utf8'), 'target after');
  assert.deepEqual(db.prepare('SELECT value FROM changes').all(), [{ value: 'committed' }]);
});

test('topic mutation moves a file only after writing the destination', async t => {
  const { root, db, coordinator } = await createFixture(t);
  const source = path.join(root, 'topic.md');
  const destination = path.join(root, '_archive', 'topic.md');
  await fs.writeFile(source, 'active topic');

  await coordinator.run(() => coordinator.commit({
    changes: [
      { filepath: destination, expectedContent: null, nextContent: 'archived topic' },
      { filepath: source, expectedContent: 'active topic', nextContent: null },
    ],
    applyDatabase() {
      db.prepare('INSERT INTO changes VALUES (?)').run('archived');
    },
  }));

  await assert.rejects(fs.access(source), { code: 'ENOENT' });
  assert.equal(await fs.readFile(destination, 'utf8'), 'archived topic');
  assert.deepEqual(db.prepare('SELECT value FROM changes').all(), [{ value: 'archived' }]);
});

test('topic mutation restores every file and rolls DB back when DB work fails', async t => {
  const { root, db, coordinator } = await createFixture(t);
  const source = path.join(root, 'source.md');
  const target = path.join(root, 'target.md');
  const created = path.join(root, 'created.md');
  await fs.writeFile(source, 'source before');
  await fs.writeFile(target, 'target before');

  await assert.rejects(coordinator.run(() => coordinator.commit({
    changes: [
      { filepath: source, expectedContent: 'source before', nextContent: null },
      { filepath: target, expectedContent: 'target before', nextContent: 'target after' },
      { filepath: created, expectedContent: null, nextContent: 'created' },
    ],
    applyDatabase() {
      db.prepare('INSERT INTO changes VALUES (?)').run('rolled back');
      throw new Error('forced DB failure');
    },
  })), /forced DB failure/);

  assert.equal(await fs.readFile(source, 'utf8'), 'source before');
  assert.equal(await fs.readFile(target, 'utf8'), 'target before');
  await assert.rejects(fs.access(created), { code: 'ENOENT' });
  assert.deepEqual(db.prepare('SELECT value FROM changes').all(), []);
});

test('topic mutation restores earlier writes when a later atomic rename fails', async t => {
  let renameCount = 0;
  const failingFs = {
    ...fs,
    async rename(from, to) {
      renameCount += 1;
      if (renameCount === 2) throw new Error('forced rename failure');
      return fs.rename(from, to);
    },
  };
  const { root, db, coordinator } = await createFixture(t, failingFs);
  const first = path.join(root, 'first.md');
  const second = path.join(root, 'second.md');
  await fs.writeFile(first, 'first before');
  await fs.writeFile(second, 'second before');

  await assert.rejects(coordinator.run(() => coordinator.commit({
    changes: [
      { filepath: first, expectedContent: 'first before', nextContent: 'first after' },
      { filepath: second, expectedContent: 'second before', nextContent: 'second after' },
    ],
    applyDatabase() {
      db.prepare('INSERT INTO changes VALUES (?)').run('must not run');
    },
  })), /forced rename failure/);

  assert.equal(await fs.readFile(first, 'utf8'), 'first before');
  assert.equal(await fs.readFile(second, 'utf8'), 'second before');
  assert.deepEqual(db.prepare('SELECT value FROM changes').all(), []);
});

test('topic mutation rejects stale file input before writing', async t => {
  const { root, db, coordinator } = await createFixture(t);
  const filepath = path.join(root, 'topic.md');
  await fs.writeFile(filepath, 'current');

  await assert.rejects(coordinator.run(() => coordinator.commit({
    changes: [{ filepath, expectedContent: 'stale', nextContent: 'next' }],
    applyDatabase() {
      db.prepare('INSERT INTO changes VALUES (?)').run('must not run');
    },
  })), /파일이 읽은 뒤 변경되었습니다/);

  assert.equal(await fs.readFile(filepath, 'utf8'), 'current');
  assert.deepEqual(db.prepare('SELECT value FROM changes').all(), []);
});

test('topic mutation requires explicit stale-write preconditions', async t => {
  const { root, db, coordinator } = await createFixture(t);
  const filepath = path.join(root, 'topic.md');

  await assert.rejects(coordinator.run(() => coordinator.commit({
    changes: [{ filepath, nextContent: 'next' }],
    applyDatabase() {
      db.prepare('INSERT INTO changes VALUES (?)').run('must not run');
    },
  })), /expectedContent/);

  await assert.rejects(fs.access(filepath), { code: 'ENOENT' });
  assert.deepEqual(db.prepare('SELECT value FROM changes').all(), []);
});
