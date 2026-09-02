'use strict';

require('dotenv').config();

const { createGitHubMcpClient } = require('../lib/github/mcp-client');

const MAX_RESULT_CHARS = 4000;

async function main() {
  const path = String(process.argv[2] || 'README.md').trim();
  const ref = String(process.argv[3] || '').trim();
  let github;

  try {
    github = await createGitHubMcpClient();
    const listed = await github.listTools();
    const toolNames = (listed.tools || []).map(tool => tool.name);
    if (!toolNames.includes('get_file_contents')) {
      throw Object.assign(new Error('get_file_contents 도구가 없습니다.'), {
        code: 'GITHUB_MCP_TOOL_MISSING',
      });
    }

    const result = await github.readFile(path, ref ? { ref } : undefined);
    if (result?.isError === true) {
      throw Object.assign(new Error('GitHub MCP 파일 읽기 도구가 오류 결과를 반환했습니다.'), {
        code: 'GITHUB_MCP_TOOL_RESULT_ERROR',
      });
    }
    const serialized = JSON.stringify(result);
    console.log(JSON.stringify({
      success: true,
      path,
      ref: ref || null,
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
