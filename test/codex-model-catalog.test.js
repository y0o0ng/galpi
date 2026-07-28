'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');

const {
  listCodexModelsViaAppServer,
  normalizeCodexModels,
} = require('../lib/codex-model-catalog');
const { safeCodexRunnerHealth } = require('../lib/model-runtime-routes');

function createFakeSpawn(handler) {
  return function spawnImpl(command, args) {
    assert.equal(command, '/fake/codex');
    assert.deepEqual(args, ['app-server']);
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    let buffered = '';
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        buffered += String(chunk);
        let newline;
        while ((newline = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, newline);
          buffered = buffered.slice(newline + 1);
          if (line) handler(JSON.parse(line), child);
        }
        callback();
      },
    });
    child.kill = () => {
      child.killed = true;
      return true;
    };
    return child;
  };
}

function send(child, message) {
  queueMicrotask(() => child.stdout.write(`${JSON.stringify(message)}\n`));
}

test('Codex app-server model/list initializes, paginates, and filters hidden fields', async () => {
  const requests = [];
  const spawnImpl = createFakeSpawn((message, child) => {
    requests.push(message);
    if (message.method === 'initialize') {
      send(child, { id: 0, result: { userAgent: 'fake' } });
    } else if (message.method === 'model/list' && !message.params.cursor) {
      send(child, {
        id: message.id,
        result: {
          data: [{
            id: 'gpt-5.6-terra',
            displayName: 'GPT-5.6 Terra',
            hidden: false,
            defaultReasoningEffort: 'medium',
            supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Fast' }],
            inputModalities: ['text', 'image'],
            baseInstructions: 'must not leak',
          }],
          nextCursor: 'next-opaque',
        },
      });
    } else if (message.method === 'model/list') {
      send(child, {
        id: message.id,
        result: {
          data: [
            { id: 'gpt-hidden', hidden: true },
            { id: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', isDefault: true },
          ],
          nextCursor: null,
        },
      });
    }
  });

  const models = await listCodexModelsViaAppServer({
    codexBin: '/fake/codex',
    spawnImpl,
    timeoutMs: 1000,
  });
  assert.deepEqual(models.map(model => model.id), ['gpt-5.6-terra', 'gpt-5.6-sol']);
  assert.equal(models[0].baseInstructions, undefined);
  assert.deepEqual(models[1].inputModalities, ['text', 'image']);
  assert.ok(requests.some(message => message.method === 'initialized'));
  assert.ok(requests.some(message => message.params?.cursor === 'next-opaque'));
});

test('Codex app-server model/list has a bounded timeout', async () => {
  const spawnImpl = createFakeSpawn(() => {});
  await assert.rejects(
    listCodexModelsViaAppServer({
      codexBin: '/fake/codex',
      spawnImpl,
      timeoutMs: 20,
    }),
    error => error.code === 'CODEX_MODEL_LIST_TIMEOUT',
  );
});

test('Codex model normalization never exposes raw provider instructions', () => {
  assert.deepEqual(normalizeCodexModels([{
    id: 'gpt-5.6-terra',
    displayName: 'Terra',
    hidden: false,
    baseInstructions: 'secret',
    provider: { token: 'secret' },
  }]), [{
    id: 'gpt-5.6-terra',
    model: 'gpt-5.6-terra',
    displayName: 'Terra',
    description: null,
    hidden: false,
    defaultReasoningEffort: null,
    supportedReasoningEfforts: [],
    inputModalities: ['text', 'image'],
    supportsPersonality: false,
    isDefault: false,
    upgrade: null,
  }]);
});

test('Codex model route health never exposes local runner errors', () => {
  assert.deepEqual(safeCodexRunnerHealth({
    mode: 'codex',
    ok: false,
    checkedAt: '2026-07-28T12:00:00.000Z',
    version: 'codex-cli 0.145.0',
    login: 'Logged in using ChatGPT',
    error: 'spawn /Users/private/bin/codex ENOENT',
  }), {
    mode: 'codex',
    ok: false,
    checkedAt: '2026-07-28T12:00:00.000Z',
    version: 'codex-cli 0.145.0',
    login: 'available',
    errorCode: 'CODEX_RUNNER_UNAVAILABLE',
  });
});
