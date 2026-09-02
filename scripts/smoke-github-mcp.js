'use strict';

require('dotenv').config();

const { createGitHubMcpClient } = require('../lib/github/mcp-client');

const MAX_RESULT_CHARS = 4000;

async function main() {
  const path = String(process.argv[2] || 'README.md').trim();
  let github;

  try {
    github = await createGitHubMcpClient();
    const listed = await github.listTools();
    const toolNames = (listed.tools || []).map(tool => tool.name);
    const snapshot = await github.openMainSnapshot();
    const result = await snapshot.readFile(path);
    if (result?.isError === true) {
      throw Object.assign(new Error('GitHub MCP 파일 읽기 도구가 오류 결과를 반환했습니다.'), {
        code: 'GITHUB_MCP_TOOL_RESULT_ERROR',
      });
    }
    const serialized = JSON.stringify(result);
    console.log(JSON.stringify({
      success: true,
      path,
      sha: snapshot.sha,
      tools: toolNames,
      result: serialized.slice(0, MAX_RESULT_CHARS),
      truncated: serialized.length > MAX_RESULT_CHARS,
    }));
  } catch (error) {
    console.error(JSON.stringify({
      success: false,
      code: String(error?.code || 'GITHUB_MCP_SMOKE_FAILED'),
      message: String(error?.message || 'GitHub MCP smoke에 실패했습니다.').slice(0, 240),
    }));
    process.exitCode = 1;
  } finally {
    if (github) {
      try {
        await github.close();
      } catch (error) {
        console.error(JSON.stringify({
          success: false,
          code: String(error?.code || 'GITHUB_MCP_CLOSE_FAILED'),
        }));
        process.exitCode = 1;
      }
    }
  }
}

void main();
