'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createGitHubMcpClient } = require('../lib/github/mcp-client');

const TEST_TOKEN = 'github-test-token-secret';
const VALID_REPOSITORY = 'y0o0ng/galpi';

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

function createSdkHarness({ tools, connectError, listError, callError } = {}) {
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
      return { tools: tools || [{ name: 'get_file_contents' }] };
    }

    async callTool(request) {
      state.toolCalls.push(structuredClone(request));
      if (callError) throw callError;
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
      'X-MCP-Tools': 'get_file_contents',
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
  const harness = createSdkHarness({ tools: [{ name: 'get_me' }] });
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

test('listTools is available and close is idempotent', async () => {
  const harness = createSdkHarness();
  await withGitHubEnv({
    GITHUB_MCP_TOKEN: TEST_TOKEN,
    GITHUB_MCP_REPOSITORY: VALID_REPOSITORY,
  }, async () => {
    const github = await createGitHubMcpClient({ loadSdk: harness.loadSdk });
    assert.deepEqual(await github.listTools(), { tools: [{ name: 'get_file_contents' }] });
    await github.close();
    await github.close();
  });
  assert.equal(harness.state.listCalls, 2);
  assert.equal(harness.state.closed, 1);
});
