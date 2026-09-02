'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GITHUB_READ_TOOL,
  MAX_CONTEXT_CHARS_PER_ANSWER,
  MAX_RESULT_CHARS_PER_CALL,
  createGitHubReadSession,
} = require('../lib/github/tool');

const SNAPSHOT_SHA = 'a'.repeat(40);

function fileResult(text) {
  return { content: [{ type: 'text', text }] };
}

function createClientHarness({
  readResults = [fileResult('file contents')],
  createError = null,
  snapshotError = null,
  closeError = null,
} = {}) {
  const state = {
    clients: 0,
    snapshots: 0,
    reads: [],
    closes: 0,
  };

  async function createClient() {
    state.clients += 1;
    if (createError) throw createError;
    return {
      async openMainSnapshot() {
        state.snapshots += 1;
        if (snapshotError) throw snapshotError;
        return {
          sha: SNAPSHOT_SHA,
          async readFile(path) {
            state.reads.push(path);
            const index = Math.min(state.reads.length - 1, readResults.length - 1);
            const result = readResults[index];
            if (result instanceof Error) throw result;
            return structuredClone(result);
          },
        };
      },
      async close() {
        state.closes += 1;
        if (closeError) throw closeError;
      },
    };
  }

  return { createClient, state };
}

function payloadOf(result) {
  const newline = result.content.indexOf('\n');
  assert.ok(newline > 0, 'untrusted notice와 JSON payload가 함께 있어야 한다');
  return JSON.parse(result.content.slice(newline + 1));
}

test('session creation is lazy and exposes only github_read with path input', async () => {
  const harness = createClientHarness();
  const session = createGitHubReadSession({ createClient: harness.createClient });

  assert.equal(harness.state.clients, 0);
  assert.deepEqual(session.getToolDefinitions(), [GITHUB_READ_TOOL]);
  assert.equal(GITHUB_READ_TOOL.name, 'github_read');
  assert.deepEqual(Object.keys(GITHUB_READ_TOOL.input_schema.properties), ['path']);
  assert.deepEqual(GITHUB_READ_TOOL.input_schema.required, ['path']);
  assert.equal(GITHUB_READ_TOOL.input_schema.additionalProperties, false);
  assert.match(session.systemPrompt, /GitHub이 현재 저장소의 정본/);
  assert.match(session.systemPrompt, /Tavily|웹 검색/);
  assert.match(session.systemPrompt, /신뢰하지 않는 근거/);

  await session.close();
  assert.equal(harness.state.clients, 0);
});

test('the first read creates one client and one immutable main snapshot', async () => {
  const harness = createClientHarness();
  const session = createGitHubReadSession({ createClient: harness.createClient });
  const result = await session.execute('github_read', { path: 'README.md' });
  const payload = payloadOf(result);

  assert.equal(result.isError, undefined);
  assert.equal(harness.state.clients, 1);
  assert.equal(harness.state.snapshots, 1);
  assert.deepEqual(harness.state.reads, ['README.md']);
  assert.deepEqual(payload, {
    success: true,
    snapshotSha: SNAPSHOT_SHA,
    path: 'README.md',
    content: 'file contents',
    truncated: false,
    trust: 'untrusted_repository_evidence',
  });
  assert.match(result.content, /UNTRUSTED GITHUB REPOSITORY EVIDENCE/);
  await session.close();
});

test('embedded text resources are preferred over the remote download acknowledgement', async () => {
  const harness = createClientHarness({
    readResults: [{
      content: [
        { type: 'text', text: 'successfully downloaded text file' },
        {
          type: 'resource',
          resource: {
            uri: `repo://configured/repository/sha/${SNAPSHOT_SHA}/contents/README.md`,
            mimeType: 'text/plain; charset=utf-8',
            text: '# Galpi\nactual repository content',
          },
        },
      ],
    }],
  });
  const session = createGitHubReadSession({ createClient: harness.createClient });
  const result = await session.execute('github_read', { path: 'README.md' });

  assert.equal(payloadOf(result).content, '# Galpi\nactual repository content');
  assert.doesNotMatch(result.content, /successfully downloaded/);
  await session.close();
});

test('multiple reads reuse one snapshot and model input cannot select repository or revision', async () => {
  const harness = createClientHarness({
    readResults: [fileResult('one'), fileResult('two')],
  });
  const session = createGitHubReadSession({ createClient: harness.createClient });

  const rejected = await session.execute('github_read', {
    path: 'README.md',
    owner: 'attacker',
    repo: 'other',
    ref: 'main',
    sha: 'b'.repeat(40),
  });
  assert.equal(rejected.isError, true);
  assert.equal(harness.state.clients, 0);

  await session.execute('github_read', { path: 'README.md' });
  await session.execute('github_read', { path: 'package.json' });
  assert.equal(harness.state.clients, 1);
  assert.equal(harness.state.snapshots, 1);
  assert.deepEqual(harness.state.reads, ['README.md', 'package.json']);
  await session.close();
});

test('the repository root path is accepted', async () => {
  const harness = createClientHarness();
  const session = createGitHubReadSession({ createClient: harness.createClient });
  const result = await session.execute('github_read', { path: '/' });

  assert.equal(payloadOf(result).path, '/');
  assert.deepEqual(harness.state.reads, ['/']);
  await session.close();
});

test('at most two GitHub reads are allowed per answer', async () => {
  const harness = createClientHarness();
  const session = createGitHubReadSession({ createClient: harness.createClient });
  await session.execute('github_read', { path: 'one' });
  await session.execute('github_read', { path: 'two' });

  assert.deepEqual(session.getToolDefinitions(), []);
  const third = await session.execute('github_read', { path: 'three' });
  assert.equal(third.isError, true);
  assert.match(third.content, /최대 2회/);
  assert.deepEqual(harness.state.reads, ['one', 'two']);
  assert.deepEqual(session.getUsage(), {
    calls: 2,
    contextChars: session.getUsage().contextChars,
  });
  await session.close();
});

test('successful content is bounded and truncation is explicit', async () => {
  const harness = createClientHarness({ readResults: [fileResult('x'.repeat(30000))] });
  const session = createGitHubReadSession({ createClient: harness.createClient });
  const result = await session.execute('github_read', { path: 'large.txt' });
  const payload = payloadOf(result);

  assert.ok(result.content.length <= MAX_RESULT_CHARS_PER_CALL);
  assert.equal(payload.truncated, true);
  assert.ok(payload.content.length < 30000);
  assert.equal(payload.snapshotSha, SNAPSHOT_SHA);
  assert.equal(payload.path, 'large.txt');
  await session.close();
});

test('the total GitHub context budget is shared across both reads', async () => {
  const harness = createClientHarness({
    readResults: [fileResult('a'.repeat(30000)), fileResult('b'.repeat(30000))],
  });
  const session = createGitHubReadSession({ createClient: harness.createClient });
  const first = await session.execute('github_read', { path: 'one.txt' });
  const second = await session.execute('github_read', { path: 'two.txt' });

  assert.ok(first.content.length <= MAX_RESULT_CHARS_PER_CALL);
  assert.ok(second.content.length <= MAX_RESULT_CHARS_PER_CALL);
  assert.ok(session.getUsage().contextChars <= MAX_CONTEXT_CHARS_PER_ANSWER);
  assert.equal(payloadOf(first).truncated, true);
  assert.equal(payloadOf(second).truncated, true);
  await session.close();
});

test('file-level MCP errors and malformed results become sanitized tool errors', async () => {
  const remoteDetail = 'REMOTE_SECRET_INSTRUCTION';
  const cases = [
    { isError: true, content: [{ type: 'text', text: remoteDetail }] },
    { content: [{ type: 'image', data: remoteDetail }] },
  ];

  for (const readResult of cases) {
    const harness = createClientHarness({ readResults: [readResult] });
    const session = createGitHubReadSession({ createClient: harness.createClient });
    const result = await session.execute('github_read', { path: 'README.md' });
    assert.equal(result.isError, true);
    assert.equal(result.content.includes(remoteDetail), false);
    await session.close();
  }
});

test('thrown client errors never expose token-like detail', async () => {
  const token = 'github-secret-token-value';
  for (const harness of [
    createClientHarness({ createError: new Error(`Bearer ${token}`) }),
    createClientHarness({ readResults: [new Error(`request failed with ${token}`)] }),
  ]) {
    const session = createGitHubReadSession({ createClient: harness.createClient });
    const result = await session.execute('github_read', { path: 'README.md' });
    assert.equal(result.isError, true);
    assert.equal(result.content.includes(token), false);
    await session.close();
  }
});

test('close is idempotent after use and unused close creates no client', async () => {
  const usedHarness = createClientHarness();
  const used = createGitHubReadSession({ createClient: usedHarness.createClient });
  await used.execute('github_read', { path: 'README.md' });
  await used.close();
  await used.close();
  assert.equal(usedHarness.state.closes, 1);

  const unusedHarness = createClientHarness();
  const unused = createGitHubReadSession({ createClient: unusedHarness.createClient });
  await unused.close();
  await unused.close();
  assert.equal(unusedHarness.state.clients, 0);
  assert.equal(unusedHarness.state.closes, 0);
});
