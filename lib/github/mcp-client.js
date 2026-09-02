'use strict';

const GITHUB_MCP_ENDPOINT = 'https://api.githubcopilot.com/mcp/';
const GITHUB_PUBLIC_API_ORIGIN = 'https://api.github.com';
const GITHUB_COMMIT_TOOL = 'get_commit';
const GITHUB_FILE_TOOL = 'get_file_contents';
const GITHUB_PR_TOOL = 'pull_request_read';
const GITHUB_ALLOWED_TOOLS = [GITHUB_COMMIT_TOOL, GITHUB_FILE_TOOL, GITHUB_PR_TOOL];
const GITHUB_PR_METHODS = Object.freeze([
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

class GitHubMcpClientError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'GitHubMcpClientError';
    this.code = code;
  }
}

function clientError(message, code) {
  return new GitHubMcpClientError(message, code);
}

function configuredToken() {
  const token = String(process.env.GITHUB_MCP_TOKEN || '').trim();
  if (!token) {
    throw clientError('GITHUB_MCP_TOKEN이 설정되어 있지 않습니다.', 'GITHUB_MCP_TOKEN_MISSING');
  }
  return token;
}

function parseGitHubRepository(value) {
  const cleanValue = String(value || '').trim();
  const parts = cleanValue.split('/');
  const owner = parts[0] || '';
  const repo = parts[1] || '';
  const ownerValid = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner);
  const repoValid = repo.length <= 100
    && repo !== '.'
    && repo !== '..'
    && /^[A-Za-z0-9._-]+$/.test(repo);
  if (parts.length !== 2 || !ownerValid || !repoValid) {
    throw clientError(
      'GITHUB_MCP_REPOSITORY는 정확한 owner/repo 형식이어야 합니다.',
      'GITHUB_MCP_REPOSITORY_INVALID',
    );
  }
  return Object.freeze({ owner, repo, fullName: `${owner}/${repo}` });
}

function configuredRepository() {
  return parseGitHubRepository(process.env.GITHUB_MCP_REPOSITORY);
}

function repositoryKey(repository) {
  return repository.fullName.toLowerCase();
}

function loadMcpSdk() {
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const {
    StreamableHTTPClientTransport,
  } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
  return { Client, StreamableHTTPClientTransport };
}

function validateRemoteTools(listed) {
  if (!Array.isArray(listed?.tools)) {
    throw clientError(
      'GitHub Remote MCP 도구 목록 형식이 올바르지 않습니다.',
      'GITHUB_MCP_TOOLSET_UNEXPECTED',
    );
  }

  const names = [];
  for (const tool of listed.tools) {
    if (!tool || typeof tool.name !== 'string' || !tool.name) {
      throw clientError(
        'GitHub Remote MCP 도구 목록 형식이 올바르지 않습니다.',
        'GITHUB_MCP_TOOLSET_UNEXPECTED',
      );
    }
    names.push(tool.name);
  }

  const missing = GITHUB_ALLOWED_TOOLS.find(name => !names.includes(name));
  if (missing) {
    throw clientError(`GitHub Remote MCP에 ${missing} 도구가 없습니다.`, 'GITHUB_MCP_TOOL_MISSING');
  }
  if (
    names.length !== GITHUB_ALLOWED_TOOLS.length
    || new Set(names).size !== names.length
    || names.some(name => !GITHUB_ALLOWED_TOOLS.includes(name))
  ) {
    throw clientError(
      'GitHub Remote MCP가 허용되지 않은 추가 도구를 노출했습니다.',
      'GITHUB_MCP_TOOLSET_UNEXPECTED',
    );
  }
  return listed;
}

function parseCommitSha(result) {
  if (result?.isError === true) {
    throw clientError(
      'GitHub main 커밋 조회가 오류 결과를 반환했습니다.',
      'GITHUB_MCP_COMMIT_RESULT_ERROR',
    );
  }

  const textContent = Array.isArray(result?.content)
    ? result.content.find(item => item?.type === 'text' && typeof item.text === 'string' && item.text.trim())
    : null;
  if (!textContent) {
    throw clientError(
      'GitHub main 커밋 응답 형식이 올바르지 않습니다.',
      'GITHUB_MCP_COMMIT_RESPONSE_INVALID',
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(textContent.text);
  } catch {
    throw clientError(
      'GitHub main 커밋 응답 형식이 올바르지 않습니다.',
      'GITHUB_MCP_COMMIT_RESPONSE_INVALID',
    );
  }

  const sha = parsed && !Array.isArray(parsed) && typeof parsed.sha === 'string'
    ? parsed.sha
    : '';
  if (!/^[0-9a-fA-F]{40}$/.test(sha)) {
    throw clientError(
      'GitHub main 커밋 SHA가 올바르지 않습니다.',
      'GITHUB_MCP_COMMIT_RESPONSE_INVALID',
    );
  }
  return sha;
}

function publicRepositoryError() {
  return clientError(
    '외부 GitHub 저장소가 공개 저장소인지 확인하지 못했습니다.',
    'GITHUB_PUBLIC_REPOSITORY_UNVERIFIED',
  );
}

function isValidGitRefName(value) {
  if (value === '@' || value.startsWith('/') || value.endsWith('/')) return false;
  if (value.includes('..') || value.includes('@{') || value.includes('//')) return false;
  if (/[\u0000-\u0020\u007f~^:?*\\[\]]/.test(value)) return false;
  return value.split('/').every(part => (
    part
    && !part.startsWith('.')
    && !part.endsWith('.')
    && !part.endsWith('.lock')
  ));
}

async function fetchPublicRepositoryMetadata(repository, fetchImpl) {
  if (typeof fetchImpl !== 'function') throw publicRepositoryError();
  const url = new URL(
    `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`,
    GITHUB_PUBLIC_API_ORIGIN,
  );
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'galpi-github-public-verifier',
      },
    });
  } catch {
    throw publicRepositoryError();
  }
  if (!response?.ok) throw publicRepositoryError();

  let metadata;
  try {
    metadata = await response.json();
  } catch {
    throw publicRepositoryError();
  }
  const defaultBranch = typeof metadata?.default_branch === 'string'
    ? metadata.default_branch.trim()
    : '';
  if (
    !metadata
    || Array.isArray(metadata)
    || metadata.full_name !== repository.fullName
    || metadata.private !== false
    || !defaultBranch
    || defaultBranch.length > 255
    || !isValidGitRefName(defaultBranch)
  ) {
    throw publicRepositoryError();
  }
  return Object.freeze({
    ...repository,
    defaultBranch,
  });
}

async function closeQuietly(client) {
  try {
    await client?.close?.();
  } catch {
    // 연결 실패의 고정된 외부 오류를 cleanup 오류로 덮지 않는다.
  }
}

async function createGitHubMcpClient({
  loadSdk = loadMcpSdk,
  fetchImpl = globalThis.fetch,
} = {}) {
  const token = configuredToken();
  const repository = configuredRepository();
  let client;

  try {
    const { Client, StreamableHTTPClientTransport } = await loadSdk();
    const transport = new StreamableHTTPClientTransport(new URL(GITHUB_MCP_ENDPOINT), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-MCP-Readonly': 'true',
          'X-MCP-Tools': GITHUB_ALLOWED_TOOLS.join(','),
        },
      },
    });
    client = new Client({ name: 'galpi-github-readonly', version: '0.1.0' });
    await client.connect(transport);
  } catch {
    await closeQuietly(client);
    throw clientError('GitHub Remote MCP 연결 또는 인증에 실패했습니다.', 'GITHUB_MCP_CONNECTION_FAILED');
  }

  let initialTools;
  try {
    initialTools = await client.listTools();
  } catch {
    await closeQuietly(client);
    throw clientError('GitHub Remote MCP 도구 목록을 읽지 못했습니다.', 'GITHUB_MCP_CONNECTION_FAILED');
  }
  try {
    validateRemoteTools(initialTools);
  } catch (error) {
    await closeQuietly(client);
    throw error;
  }

  let closed = false;
  const publicMetadataPromises = new Map();
  const publicSnapshotPromises = new Map();

  function ensureOpen() {
    if (closed) {
      throw clientError('GitHub Remote MCP 연결이 이미 닫혔습니다.', 'GITHUB_MCP_CLIENT_CLOSED');
    }
  }

  async function readFileAt(targetRepository, path, revision = {}) {
    ensureOpen();
    const cleanPath = String(path || '').trim();
    if (!cleanPath) {
      throw clientError('읽을 GitHub 파일 경로가 필요합니다.', 'GITHUB_MCP_PATH_INVALID');
    }

    try {
      return await client.callTool({
        name: GITHUB_FILE_TOOL,
        arguments: {
          owner: targetRepository.owner,
          repo: targetRepository.repo,
          path: cleanPath,
          ...revision,
        },
      });
    } catch {
      throw clientError('GitHub 파일 읽기 도구 호출에 실패했습니다.', 'GITHUB_MCP_TOOL_CALL_FAILED');
    }
  }

  function verifiedPublicRepository(value) {
    const target = parseGitHubRepository(value);
    const key = repositoryKey(target);
    if (!publicMetadataPromises.has(key)) {
      const promise = fetchPublicRepositoryMetadata(target, fetchImpl).catch(error => {
        publicMetadataPromises.delete(key);
        throw error;
      });
      publicMetadataPromises.set(key, promise);
    }
    return publicMetadataPromises.get(key);
  }

  async function resolveSnapshot(targetRepository, revision) {
    let result;
    try {
      result = await client.callTool({
        name: GITHUB_COMMIT_TOOL,
        arguments: {
          owner: targetRepository.owner,
          repo: targetRepository.repo,
          sha: revision,
          detail: 'none',
        },
      });
    } catch {
      throw clientError(
        'GitHub 커밋 조회 도구 호출에 실패했습니다.',
        'GITHUB_MCP_COMMIT_CALL_FAILED',
      );
    }
    const sha = parseCommitSha(result);
    return Object.freeze({
      repository: targetRepository.fullName,
      defaultBranch: revision,
      sha,
      readFile: path => readFileAt(targetRepository, path, { sha }),
    });
  }

  return {
    async listTools() {
      ensureOpen();
      let listed;
      try {
        listed = await client.listTools();
      } catch {
        throw clientError('GitHub Remote MCP 도구 목록을 읽지 못했습니다.', 'GITHUB_MCP_TOOL_LIST_FAILED');
      }
      try {
        return validateRemoteTools(listed);
      } catch (error) {
        closed = true;
        await closeQuietly(client);
        throw error;
      }
    },

    async readFile(path, { ref } = {}) {
      ensureOpen();
      const cleanPath = String(path || '').trim();
      if (!cleanPath) {
        throw clientError('읽을 GitHub 파일 경로가 필요합니다.', 'GITHUB_MCP_PATH_INVALID');
      }
      const cleanRef = ref === undefined ? '' : String(ref).trim();
      if (ref !== undefined && !cleanRef) {
        throw clientError('Git ref가 비어 있습니다.', 'GITHUB_MCP_REF_INVALID');
      }
      return readFileAt(repository, cleanPath, cleanRef ? { ref: cleanRef } : {});
    },

    async openMainSnapshot() {
      ensureOpen();
      const snapshot = await resolveSnapshot(repository, 'main');
      return Object.freeze({
        sha: snapshot.sha,
        readFile: snapshot.readFile,
      });
    },

    async openPublicSnapshot(repositoryValue) {
      ensureOpen();
      const target = parseGitHubRepository(repositoryValue);
      const key = repositoryKey(target);
      if (!publicSnapshotPromises.has(key)) {
        const promise = (async () => {
          const verified = await verifiedPublicRepository(target.fullName);
          return resolveSnapshot(verified, verified.defaultBranch);
        })().catch(error => {
          publicSnapshotPromises.delete(key);
          throw error;
        });
        publicSnapshotPromises.set(key, promise);
      }
      return publicSnapshotPromises.get(key);
    },

    async readPullRequest({ repository: repositoryValue, pullNumber, method } = {}) {
      ensureOpen();
      const target = repositoryValue === undefined
        ? repository
        : parseGitHubRepository(repositoryValue);
      if (!Number.isInteger(pullNumber) || pullNumber <= 0) {
        throw clientError('Pull request 번호가 올바르지 않습니다.', 'GITHUB_MCP_PR_INPUT_INVALID');
      }
      if (!GITHUB_PR_METHODS.includes(method)) {
        throw clientError('Pull request 조회 방법이 올바르지 않습니다.', 'GITHUB_MCP_PR_INPUT_INVALID');
      }
      const authorized = repositoryKey(target) === repositoryKey(repository)
        ? target
        : await verifiedPublicRepository(target.fullName);
      let result;
      try {
        result = await client.callTool({
          name: GITHUB_PR_TOOL,
          arguments: {
            method,
            owner: authorized.owner,
            repo: authorized.repo,
            pullNumber,
          },
        });
      } catch {
        throw clientError(
          'GitHub pull request 조회 도구 호출에 실패했습니다.',
          'GITHUB_MCP_PR_CALL_FAILED',
        );
      }
      return Object.freeze({ repository: authorized.fullName, result });
    },

    async close() {
      if (closed) return;
      closed = true;
      try {
        await client.close();
      } catch {
        throw clientError('GitHub Remote MCP 연결 종료에 실패했습니다.', 'GITHUB_MCP_CLOSE_FAILED');
      }
    },
  };
}

module.exports = {
  GITHUB_PR_METHODS,
  GitHubMcpClientError,
  createGitHubMcpClient,
  parseGitHubRepository,
};
