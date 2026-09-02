'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createGitHubMcpClient } = require('../lib/github/mcp-client');

const TEST_TOKEN = 'github-test-token-secret';
const VALID_REPOSITORY = 'y0o0ng/galpi';
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const EXPECTED_TOOLS = [{ name: 'get_commit' }, { name: 'get_file_contents' }];

function commitResult(sha = SHA_A) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ sha, commit: { message: 'test' } }) }],
  };
}

async function withGitHubEnv(values, run) {
  const keys = ['GITHUB_MCP_TOKEN', 'GITHUB_MCP_REPOSITORY'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    return await run();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

function createSdkHarness({
  tools,
  toolLists,
  listResult,
  connectError,
  listError,
  callError,
  callResult,
} = {}) {
  const state = {
    clientInfo: null,
    transport: null,
    connected: 0,
    listCalls: 0,
    toolCalls: [],
    closed: 0,
  };

  class FakeTransport {
    constructor(url, options) {
      state.transport = { url, options };
    }
  }

  class FakeClient {
    constructor(clientInfo) {
      state.clientInfo = clientInfo;
    }

    async connect() {
      state.connected += 1;
      if (connectError) throw connectError;
    }

    async listTools() {
      state.listCalls += 1;
      if (listError) throw listError;
      if (listResult !== undefined) return structuredClone(listResult);
      const listedTools = toolLists
        ? toolLists[Math.min(state.listCalls - 1, toolLists.length - 1)]
        : tools;
      return { tools: listedTools || EXPECTED_TOOLS };
    }

    async callTool(request) {
      state.toolCalls.push(structuredClone(request));
      if (callError) throw callError;
      if (typeof callResult === 'function') {
        return structuredClone(await callResult(request, state.toolCalls.length));
      }
      if (callResult !== undefined) return structuredClone(callResult);
      if (request.name === 'get_commit') return commitResult();
      return {
        content: [{ type: 'text', text: 'file contents' }],
        structuredContent: { path: request.arguments.path },
      };
    }

    async close() {
      state.closed += 1;
    }
  }

  return {
    state,
    loadSdk: () => ({
      Client: FakeClient,
      StreamableHTTPClientTransport: FakeTransport,
    }),
  };
}

test('missing token fails before loading the SDK or connecting', async () => {
  let sdkLoads = 0;
  await withGitHubEnv({
    GITHUB_MCP_TOKEN: undefined,
    GITHUB_MCP_REPOSITORY: VALID_REPOSITORY,
  }, async () => {
    await assert.rejects(
      () => createGitHubMcpClient({ loadSdk: () => { sdkLoads += 1; } }),
      error => error.code === 'GITHUB_MCP_TOKEN_MISSING',
    );
  });
  assert.equal(sdkLoads, 0);
});

test('malformed repository configuration fails closed before loading the SDK', async () => {
  let sdkLoads = 0;
  await withGitHubEnv({
    GITHUB_MCP_TOKEN: TEST_TOKEN,
    GITHUB_MCP_REPOSITORY: 'y0o0ng/galpi/other',
  }, async () => {
    await assert.rejects(
      () => createGitHubMcpClient({ loadSdk: () => { sdkLoads += 1; } }),
      error => error.code === 'GITHUB_MCP_REPOSITORY_INVALID',
    );
  });
  assert.equal(sdkLoads, 0);
});

test('transport uses the official endpoint, Bearer token, and strict tool headers', async () => {
  const harness = createSdkHarness();
  await withGitHubEnv({
    GITHUB_MCP_TOKEN: TEST_TOKEN,
    GITHUB_MCP_REPOSITORY: VALID_REPOSITORY,
  }, async () => {
    const github = await createGitHubMcpClient({ loadSdk: harness.loadSdk });
    assert.equal(harness.state.transport.url.href, 'https://api.githubcopilot.com/mcp/');
    assert.deepEqual(harness.state.transport.options.requestInit.headers, {
      Authorization: `Bearer ${TEST_TOKEN}`,
      'X-MCP-Readonly': 'true',
      'X-MCP-Tools': 'get_commit,get_file_contents',
    });
    await github.close();
  });
});

test('readFile injects the configured owner and repo and preserves the MCP result', async () => {
  const harness = createSdkHarness();
  await withGitHubEnv({
    GITHUB_MCP_TOKEN: TEST_TOKEN,
    GITHUB_MCP_REPOSITORY: VALID_REPOSITORY,
  }, async () => {
    const github = await createGitHubMcpClient({ loadSdk: harness.loadSdk });
    const result = await github.readFile('docs/roadmap.md', { ref: 'refs/heads/main' });

    assert.deepEqual(harness.state.toolCalls, [{
      name: 'get_file_contents',
      arguments: {
        owner: 'y0o0ng',
        repo: 'galpi',
        path: 'docs/roadmap.md',
        ref: 'refs/heads/main',
      },
    }]);
    assert.deepEqual(result, {
      content: [{ type: 'text', text: 'file contents' }],
      structuredContent: { path: 'docs/roadmap.md' },
    });
    assert.equal(github.callTool, undefined);
    await github.close();
  });
});

test('readFile can only call get_file_contents', async () => {
  const harness = createSdkHarness();
  await withGitHubEnv({
    GITHUB_MCP_TOKEN: TEST_TOKEN,
    GITHUB_MCP_REPOSITORY: VALID_REPOSITORY,
  }, async () => {
    const github = await createGitHubMcpClient({ loadSdk: harness.loadSdk });
    await github.readFile('README.md');
    assert.deepEqual(harness.state.toolCalls, [{
      name: 'get_file_contents',
      arguments: { owner: 'y0o0ng', repo: 'galpi', path: 'README.md' },
    }]);
    await github.close();
  });
});

test('readFile faithfully preserves an MCP tool-level error result', async () => {
  const toolResult = {
    isError: true,
    content: [{ type: 'text', text: 'remote tool detail' }],
    structuredContent: { status: 'failed' },
  };
  const harness = createSdkHarness({ callResult: toolResult });
  await withGitHubEnv({
    GITHUB_MCP_TOKEN: TEST_TOKEN,
    GITHUB_MCP_REPOSITORY: VALID_REPOSITORY,
  }, async () => {
    const github = await createGitHubMcpClient({ loadSdk: harness.loadSdk });
    assert.deepEqual(await github.readFile('README.md'), toolResult);
    await github.close();
  });
});

test('connection and tool-call errors are distinct and never expose the token', async () => {
  await withGitHubEnv({
    GITHUB_MCP_TOKEN: TEST_TOKEN,
    GITHUB_MCP_REPOSITORY: VALID_REPOSITORY,
  }, async () => {
    const connectionHarness = createSdkHarness({
      connectError: new Error(`Authorization: Bearer ${TEST_TOKEN}`),
    });
    await assert.rejects(
      () => createGitHubMcpClient({ loadSdk: connectionHarness.loadSdk }),
      error => {
        assert.equal(error.code, 'GITHUB_MCP_CONNECTION_FAILED');
        assert.equal(String(error).includes(TEST_TOKEN), false);
        return true;
      },
    );
    assert.equal(connectionHarness.state.closed, 1);

    const callHarness = createSdkHarness({
      callError: new Error(`request failed for ${TEST_TOKEN}`),
    });
    const github = await createGitHubMcpClient({ loadSdk: callHarness.loadSdk });
    await assert.rejects(
      () => github.readFile('README.md'),
      error => {
        assert.equal(error.code, 'GITHUB_MCP_TOOL_CALL_FAILED');
        assert.equal(String(error).includes(TEST_TOKEN), false);
        return true;
      },
    );
    await github.close();
  });
});

test('a missing remote tool fails distinctly and cleans up', async () => {
  const harness = createSdkHarness({ tools: [{ name: 'get_file_contents' }] });
  await withGitHubEnv({
    GITHUB_MCP_TOKEN: TEST_TOKEN,
    GITHUB_MCP_REPOSITORY: VALID_REPOSITORY,
  }, async () => {
    await assert.rejects(
      () => createGitHubMcpClient({ loadSdk: harness.loadSdk }),
      error => error.code === 'GITHUB_MCP_TOOL_MISSING',
    );
  });
  assert.equal(harness.state.closed, 1);
});

test('an unexpected additional remote tool fails closed and cleans up', async () => {
  const harness = createSdkHarness({
    tools: [...EXPECTED_TOOLS, { name: 'search_code' }],
  });
  await withGitHubEnv({
    GITHUB_MCP_TOKEN: TEST_TOKEN,
    GITHUB_MCP_REPOSITORY: VALID_REPOSITORY,
  }, async () => {
    await assert.rejects(
      () => createGitHubMcpClient({ loadSdk: harness.loadSdk }),
      error => error.code === 'GITHUB_MCP_TOOLSET_UNEXPECTED',
    );
  });
  assert.equal(harness.state.closed, 1);
});

test('listTools fails closed if the remote toolset drifts during the session', async () => {
  const harness = createSdkHarness({
    toolLists: [
      EXPECTED_TOOLS,
      [...EXPECTED_TOOLS, { name: 'get_me' }],
    ],
  });
  await withGitHubEnv({
    GITHUB_MCP_TOKEN: TEST_TOKEN,
    GITHUB_MCP_REPOSITORY: VALID_REPOSITORY,
  }, async () => {
    const github = await createGitHubMcpClient({ loadSdk: harness.loadSdk });
    await assert.rejects(
      () => github.listTools(),
      error => error.code === 'GITHUB_MCP_TOOLSET_UNEXPECTED',
    );
    await github.close();
  });
  assert.equal(harness.state.closed, 1);
});

test('listTools is available and close is idempotent', async () => {
  const harness = createSdkHarness();
  await withGitHubEnv({
    GITHUB_MCP_TOKEN: TEST_TOKEN,
    GITHUB_MCP_REPOSITORY: VALID_REPOSITORY,
  }, async () => {
    const github = await createGitHubMcpClient({ loadSdk: harness.loadSdk });
    assert.deepEqual(await github.listTools(), { tools: EXPECTED_TOOLS });
    await github.close();
    await github.close();
  });
  assert.equal(harness.state.listCalls, 2);
  assert.equal(harness.state.closed, 1);
});

test('the exact two-tool allowlist is accepted in either order', async () => {
  for (const tools of [EXPECTED_TOOLS, [...EXPECTED_TOOLS].reverse()]) {
    const harness = createSdkHarness({ tools });
    await withGitHubEnv({
      GITHUB_MCP_TOKEN: TEST_TOKEN,
      GITHUB_MCP_REPOSITORY: VALID_REPOSITORY,
    }, async () => {
      const github = await createGitHubMcpClient({ loadSdk: harness.loadSdk });
      assert.deepEqual(await github.listTools(), { tools });
      await github.close();
    });
  }
});

test('duplicate, unusable, and malformed remote tool lists fail closed', async () => {
  const invalidResults = [
    { tools: [...EXPECTED_TOOLS, { name: 'get_commit' }] },
    { tools: [{ name: 'get_commit' }, {}] },
    { tools: null },
  ];

  for (const listResult of invalidResults) {
    const harness = createSdkHarness({ listResult });
    await withGitHubEnv({
      GITHUB_MCP_TOKEN: TEST_TOKEN,
      GITHUB_MCP_REPOSITORY: VALID_REPOSITORY,
    }, async () => {
      await assert.rejects(
        () => createGitHubMcpClient({ loadSdk: harness.loadSdk }),
        error => error.code === 'GITHUB_MCP_TOOLSET_UNEXPECTED',
      );
    });
    assert.equal(harness.state.closed, 1);
  }
});

test('openMainSnapshot resolves main with the configured repository and exposes its SHA', async () => {
  const harness = createSdkHarness();
  await withGitHubEnv({
    GITHUB_MCP_TOKEN: TEST_TOKEN,
    GITHUB_MCP_REPOSITORY: VALID_REPOSITORY,
  }, async () => {
    const github = await createGitHubMcpClient({ loadSdk: harness.loadSdk });
    const snapshot = await github.openMainSnapshot();

    assert.equal(snapshot.sha, SHA_A);
    assert.deepEqual(harness.state.toolCalls, [{
      name: 'get_commit',
      arguments: {
        owner: 'y0o0ng',
        repo: 'galpi',
        sha: 'main',
        detail: 'none',
      },
    }]);
    await github.close();
  });
});

test('get_commit tool-level errors fail snapshot creation without reading a file', async () => {
  const harness = createSdkHarness({
    callResult: {
      isError: true,
      content: [{ type: 'text', text: 'untrusted remote detail' }],
    },
  });
  await withGitHubEnv({
    GITHUB_MCP_TOKEN: TEST_TOKEN,
    GITHUB_MCP_REPOSITORY: VALID_REPOSITORY,
  }, async () => {
    const github = await createGitHubMcpClient({ loadSdk: harness.loadSdk });
    await assert.rejects(
      () => github.openMainSnapshot(),
      error => error.code === 'GITHUB_MCP_COMMIT_RESULT_ERROR'
        && !String(error).includes('untrusted remote detail'),
    );
    assert.deepEqual(harness.state.toolCalls.map(call => call.name), ['get_commit']);
    await github.close();
  });
});

test('get_commit protocol errors are sanitized', async () => {
  const harness = createSdkHarness({
    callError: new Error(`Authorization: Bearer ${TEST_TOKEN}`),
  });
  await withGitHubEnv({
    GITHUB_MCP_TOKEN: TEST_TOKEN,
    GITHUB_MCP_REPOSITORY: VALID_REPOSITORY,
  }, async () => {
    const github = await createGitHubMcpClient({ loadSdk: harness.loadSdk });
    await assert.rejects(
      () => github.openMainSnapshot(),
      error => error.code === 'GITHUB_MCP_COMMIT_CALL_FAILED'
        && !String(error).includes(TEST_TOKEN),
    );
    await github.close();
  });
});

test('unusable get_commit responses fail closed before any file read', async () => {
  const unusableResults = [
    { content: [] },
    { content: [{ type: 'text', text: '{not-json' }] },
    { content: [{ type: 'text', text: JSON.stringify({ commit: { sha: SHA_A } }) }] },
    commitResult('abc123'),
    commitResult('g'.repeat(40)),
  ];

  for (const callResult of unusableResults) {
    const harness = createSdkHarness({ callResult });
    await withGitHubEnv({
      GITHUB_MCP_TOKEN: TEST_TOKEN,
      GITHUB_MCP_REPOSITORY: VALID_REPOSITORY,
    }, async () => {
      const github = await createGitHubMcpClient({ loadSdk: harness.loadSdk });
      await assert.rejects(
        () => github.openMainSnapshot(),
        error => error.code === 'GITHUB_MCP_COMMIT_RESPONSE_INVALID',
      );
      assert.deepEqual(harness.state.toolCalls.map(call => call.name), ['get_commit']);
      await github.close();
    });
  }
});

test('snapshot reads reuse one immutable SHA and never send ref', async () => {
  const harness = createSdkHarness();
  await withGitHubEnv({
    GITHUB_MCP_TOKEN: TEST_TOKEN,
    GITHUB_MCP_REPOSITORY: VALID_REPOSITORY,
  }, async () => {
    const github = await createGitHubMcpClient({ loadSdk: harness.loadSdk });
    const snapshot = await github.openMainSnapshot();
    await snapshot.readFile('README.md', {
      owner: 'attacker', repo: 'other', ref: 'main', sha: SHA_B,
    });
    await snapshot.readFile('package.json');

    assert.deepEqual(harness.state.toolCalls, [
      {
        name: 'get_commit',
        arguments: {
          owner: 'y0o0ng', repo: 'galpi', sha: 'main', detail: 'none',
        },
      },
      {
        name: 'get_file_contents',
        arguments: { owner: 'y0o0ng', repo: 'galpi', path: 'README.md', sha: SHA_A },
      },
      {
        name: 'get_file_contents',
        arguments: { owner: 'y0o0ng', repo: 'galpi', path: 'package.json', sha: SHA_A },
      },
    ]);
    assert.equal(harness.state.toolCalls.filter(call => call.name === 'get_commit').length, 1);
    assert.equal(harness.state.toolCalls.some(call => 'ref' in call.arguments), false);
    assert.equal(Object.isFrozen(snapshot), true);
    await github.close();
  });
});

test('snapshot reads preserve file-level MCP error results', async () => {
  const fileErrorResult = {
    isError: true,
    content: [{ type: 'text', text: 'remote file error' }],
  };
  const harness = createSdkHarness({
    callResult(request) {
      return request.name === 'get_commit' ? commitResult() : fileErrorResult;
    },
  });
  await withGitHubEnv({
    GITHUB_MCP_TOKEN: TEST_TOKEN,
    GITHUB_MCP_REPOSITORY: VALID_REPOSITORY,
  }, async () => {
    const github = await createGitHubMcpClient({ loadSdk: harness.loadSdk });
    const snapshot = await github.openMainSnapshot();
    assert.deepEqual(await snapshot.readFile('README.md'), fileErrorResult);
    await github.close();
  });
});

test('an existing snapshot stays pinned when a new snapshot resolves a moved main', async () => {
  let commitCalls = 0;
  const harness = createSdkHarness({
    callResult(request) {
      if (request.name === 'get_commit') {
        commitCalls += 1;
        return commitResult(commitCalls === 1 ? SHA_A : SHA_B);
      }
      return { content: [{ type: 'text', text: 'file contents' }] };
    },
  });

  await withGitHubEnv({
    GITHUB_MCP_TOKEN: TEST_TOKEN,
    GITHUB_MCP_REPOSITORY: VALID_REPOSITORY,
  }, async () => {
    const github = await createGitHubMcpClient({ loadSdk: harness.loadSdk });
    const snapshotA = await github.openMainSnapshot();
    const snapshotB = await github.openMainSnapshot();
    await snapshotA.readFile('README.md');
    await snapshotB.readFile('README.md');
    await snapshotA.readFile('package.json');

    assert.equal(snapshotA.sha, SHA_A);
    assert.equal(snapshotB.sha, SHA_B);
    const fileCalls = harness.state.toolCalls.filter(call => call.name === 'get_file_contents');
    assert.deepEqual(fileCalls.map(call => call.arguments.sha), [SHA_A, SHA_B, SHA_A]);
    assert.equal(commitCalls, 2);
    await github.close();
  });
});
