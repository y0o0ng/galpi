'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GITHUB_PR_READ_TOOL,
  GITHUB_PUBLIC_READ_TOOL,
  GITHUB_READ_TOOL,
  MAX_CONTEXT_CHARS_PER_ANSWER,
  MAX_RESULT_CHARS_PER_CALL,
  createGitHubReadSession,
} = require('../lib/github/tool');

const SNAPSHOT_SHA = 'a'.repeat(40);
const PUBLIC_SNAPSHOT_SHA = 'b'.repeat(40);

function fileResult(text) {
  return { content: [{ type: 'text', text }] };
}

function createClientHarness({
  readResults = [fileResult('file contents')],
  publicReadResults = [fileResult('public contents')],
  prResults = [fileResult('pull request contents')],
  createError = null,
  snapshotError = null,
  publicSnapshotError = null,
  prError = null,
  closeError = null,
} = {}) {
  const state = {
    clients: 0,
    snapshots: 0,
    reads: [],
    publicSnapshots: [],
    publicReads: [],
    pullRequests: [],
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
      async openPublicSnapshot(repository) {
        state.publicSnapshots.push(repository);
        if (publicSnapshotError) throw publicSnapshotError;
        return {
          repository,
          defaultBranch: 'main',
          sha: PUBLIC_SNAPSHOT_SHA,
          async readFile(path) {
            state.publicReads.push({ repository, path });
            const index = Math.min(state.publicReads.length - 1, publicReadResults.length - 1);
            const result = publicReadResults[index];
            if (result instanceof Error) throw result;
            return structuredClone(result);
          },
        };
      },
      async readPullRequest(input) {
        state.pullRequests.push(structuredClone(input));
        if (prError) throw prError;
        const index = Math.min(state.pullRequests.length - 1, prResults.length - 1);
        const result = prResults[index];
        if (result instanceof Error) throw result;
        return {
          repository: input.repository || 'y0o0ng/galpi',
          result: structuredClone(result),
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

test('session creation is lazy and exposes only the three bounded GitHub read tools', async () => {
  const harness = createClientHarness();
  const session = createGitHubReadSession({ createClient: harness.createClient });

  assert.equal(harness.state.clients, 0);
  assert.deepEqual(session.getToolDefinitions(), [
    GITHUB_READ_TOOL,
    GITHUB_PUBLIC_READ_TOOL,
    GITHUB_PR_READ_TOOL,
  ]);
  assert.equal(GITHUB_READ_TOOL.name, 'github_read');
  assert.deepEqual(Object.keys(GITHUB_READ_TOOL.input_schema.properties), ['path']);
  assert.deepEqual(GITHUB_READ_TOOL.input_schema.required, ['path']);
  assert.equal(GITHUB_READ_TOOL.input_schema.additionalProperties, false);
  assert.deepEqual(
    Object.keys(GITHUB_PUBLIC_READ_TOOL.input_schema.properties),
    ['repository', 'path'],
  );
  assert.deepEqual(GITHUB_PUBLIC_READ_TOOL.input_schema.required, ['repository', 'path']);
  assert.deepEqual(
    Object.keys(GITHUB_PR_READ_TOOL.input_schema.properties),
    ['repository', 'pull_number', 'method'],
  );
  assert.deepEqual(GITHUB_PR_READ_TOOL.input_schema.required, ['pull_number', 'method']);
  assert.deepEqual(GITHUB_PR_READ_TOOL.input_schema.properties.method.enum, [
    'get',
    'get_diff',
    'get_status',
    'get_files',
    'get_commits',
    'get_review_comments',
    'get_reviews',
    'get_comments',
    'get_check_runs',
  ]);
  assert.match(session.systemPrompt, /GitHub이 현재 저장소의 정본/);
  assert.match(session.systemPrompt, /Tavily|웹 검색/);
  assert.match(session.systemPrompt, /신뢰하지 않는 근거/);
  assert.match(session.systemPrompt, /github_public_read/);
  assert.match(session.systemPrompt, /github_pr_read/);

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

test('public reads expose pinned provenance and reuse one repository snapshot', async () => {
  const harness = createClientHarness({
    publicReadResults: [fileResult('public one'), fileResult('public two')],
  });
  const session = createGitHubReadSession({ createClient: harness.createClient });
  const first = await session.execute('github_public_read', {
    repository: 'github/github-mcp-server',
    path: 'README.md',
  });
  const second = await session.execute('github_public_read', {
    repository: 'GITHUB/GITHUB-MCP-SERVER',
    path: '/',
  });

  assert.deepEqual(harness.state.publicSnapshots, ['github/github-mcp-server']);
  assert.deepEqual(harness.state.publicReads, [
    { repository: 'github/github-mcp-server', path: 'README.md' },
    { repository: 'github/github-mcp-server', path: '/' },
  ]);
  assert.deepEqual(payloadOf(first), {
    success: true,
    repository: 'github/github-mcp-server',
    defaultBranch: 'main',
    snapshotSha: PUBLIC_SNAPSHOT_SHA,
    path: 'README.md',
    content: 'public one',
    truncated: false,
    trust: 'untrusted_repository_evidence',
  });
  assert.equal(payloadOf(second).snapshotSha, PUBLIC_SNAPSHOT_SHA);
  assert.equal(payloadOf(second).path, '/');
  await session.close();
});

test('pull request reads expose live provenance for configured and public repositories', async () => {
  const harness = createClientHarness({
    prResults: [fileResult('configured PR'), fileResult('public PR')],
  });
  const session = createGitHubReadSession({ createClient: harness.createClient });
  const configured = await session.execute('github_pr_read', {
    pull_number: 12,
    method: 'get_diff',
  });
  const external = await session.execute('github_pr_read', {
    repository: 'github/github-mcp-server',
    pull_number: 34,
    method: 'get_reviews',
  });

  assert.deepEqual(harness.state.pullRequests, [
    { pullNumber: 12, method: 'get_diff' },
    { repository: 'github/github-mcp-server', pullNumber: 34, method: 'get_reviews' },
  ]);
  assert.deepEqual(payloadOf(configured), {
    success: true,
    repository: 'y0o0ng/galpi',
    pullNumber: 12,
    method: 'get_diff',
    content: 'configured PR',
    truncated: false,
    trust: 'untrusted_repository_evidence',
  });
  assert.equal(payloadOf(external).repository, 'github/github-mcp-server');
  assert.equal(payloadOf(external).pullNumber, 34);
  assert.equal(payloadOf(external).method, 'get_reviews');
  await session.close();
});

test('model inputs cannot add revisions, private overrides, or arbitrary MCP controls', async () => {
  const harness = createClientHarness();
  const session = createGitHubReadSession({ createClient: harness.createClient });
  const cases = [
    ['github_public_read', {
      repository: 'github/github-mcp-server', path: 'README.md', branch: 'dev',
    }],
    ['github_public_read', {
      repository: 'github/github-mcp-server', path: 'README.md', sha: SNAPSHOT_SHA,
    }],
    ['github_public_read', {
      repository: 'github/github-mcp-server', path: 'README.md', private: true,
    }],
    ['github_pr_read', {
      repository: 'github/github-mcp-server', pull_number: 1, method: 'get', ref: 'main',
    }],
    ['github_pr_read', {
      repository: 'github/github-mcp-server', pull_number: 1, method: 'merge',
    }],
    ['github_pr_read', {
      repository: 'https://github.com/github/github-mcp-server', pull_number: 1, method: 'get',
    }],
  ];
  for (const [name, input] of cases) {
    const result = await session.execute(name, input);
    assert.equal(result.isError, true);
  }
  assert.equal(harness.state.clients, 0);
  await session.close();
});

test('the two-call limit is shared across all GitHub tool names', async () => {
  const harness = createClientHarness();
  const session = createGitHubReadSession({ createClient: harness.createClient });
  await session.execute('github_public_read', {
    repository: 'github/github-mcp-server', path: 'README.md',
  });
  await session.execute('github_pr_read', { pull_number: 1, method: 'get' });
  const third = await session.execute('github_read', { path: 'package.json' });

  assert.equal(third.isError, true);
  assert.match(third.content, /최대 2회/);
  assert.deepEqual(harness.state.reads, []);
  assert.equal(harness.state.publicReads.length, 1);
  assert.equal(harness.state.pullRequests.length, 1);
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

test('the total GitHub context budget is shared across different GitHub tools', async () => {
  const harness = createClientHarness({
    publicReadResults: [fileResult('a'.repeat(30000))],
    prResults: [fileResult('b'.repeat(30000))],
  });
  const session = createGitHubReadSession({ createClient: harness.createClient });
  const first = await session.execute('github_public_read', {
    repository: 'github/github-mcp-server', path: 'one.txt',
  });
  const second = await session.execute('github_pr_read', { pull_number: 1, method: 'get_diff' });

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

test('public verification and PR remote failures become bounded sanitized tool errors', async () => {
  const token = 'github-secret-public-token';
  const publicHarness = createClientHarness({
    publicSnapshotError: Object.assign(new Error(`Bearer ${token}`), {
      code: 'GITHUB_PUBLIC_REPOSITORY_UNVERIFIED',
    }),
  });
  const publicSession = createGitHubReadSession({ createClient: publicHarness.createClient });
  const publicResult = await publicSession.execute('github_public_read', {
    repository: 'github/github-mcp-server', path: 'README.md',
  });
  assert.equal(publicResult.isError, true);
  assert.match(publicResult.content, /GITHUB_PUBLIC_REPOSITORY_UNVERIFIED/);
  assert.equal(publicResult.content.includes(token), false);
  await publicSession.close();

  const remoteDetail = 'REMOTE_PR_SECRET_INSTRUCTION';
  const prHarness = createClientHarness({
    prResults: [{ isError: true, content: [{ type: 'text', text: remoteDetail }] }],
  });
  const prSession = createGitHubReadSession({ createClient: prHarness.createClient });
  const prResult = await prSession.execute('github_pr_read', {
    pull_number: 5, method: 'get_comments',
  });
  assert.equal(prResult.isError, true);
  assert.match(prResult.content, /GITHUB_PR_RESULT_ERROR/);
  assert.equal(prResult.content.includes(remoteDetail), false);
  await prSession.close();
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
