import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const host = process.env.HOST && process.env.HOST !== '0.0.0.0' ? process.env.HOST : '127.0.0.1';
const port = process.env.PORT || '3000';
const baseUrl = (process.env.GALPI_URL || process.env.AI_COUNCIL_URL || `http://${host}:${port}`).replace(/\/$/, '');
const apiToken = process.env.API_TOKEN || '';

async function apiRequest(path, options = {}) {
  const headers = {
    ...(options.headers || {}),
  };
  if (apiToken) headers['X-API-Token'] = apiToken;

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const message = body?.error || body?.message || response.statusText;
    throw new Error(`${response.status} ${message}`);
  }

  return body;
}

function jsonResult(value) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

const server = new McpServer({
  name: 'galpi-obsidian',
  version: '0.1.0',
});

server.registerTool(
  'get_config',
  {
    description: 'Read Galpi runtime config and model availability.',
    inputSchema: {},
  },
  async () => jsonResult(await apiRequest('/api/config'))
);

server.registerTool(
  'list_notes',
  {
    description: 'List tracked Obsidian notes from Galpi. Defaults to active notes only.',
    inputSchema: {
      limit: z.number().int().min(1).max(100).optional(),
      includeArchived: z.boolean().optional(),
    },
  },
  async ({ limit = 50, includeArchived = false }) => {
    const params = new URLSearchParams({
      limit: String(limit),
      includeArchived: String(includeArchived),
      forAi: 'true',
    });
    return jsonResult(await apiRequest(`/api/vault/notes?${params.toString()}`));
  }
);

server.registerTool(
  'search_notes',
  {
    description: 'Search active Obsidian notes through Galpi hybrid note search.',
    inputSchema: {
      query: z.string().min(1),
    },
  },
  async ({ query }) => {
    const params = new URLSearchParams({ q: query });
    return jsonResult(await apiRequest(`/api/vault/search?${params.toString()}`));
  }
);

server.registerTool(
  'read_note',
  {
    description: 'Read one active Obsidian note by filename. Returns title and body without frontmatter.',
    inputSchema: {
      filename: z.string().regex(/^[^/\\]+\.md$/),
    },
  },
  async ({ filename }) => {
    return jsonResult(await apiRequest(`/api/vault/note/${encodeURIComponent(filename)}?forAi=true`));
  }
);

server.registerTool(
  'organize_status',
  {
    description: 'Read Codex organize queue and note status.',
    inputSchema: {},
  },
  async () => jsonResult(await apiRequest('/api/organize/status'))
);

server.registerTool(
  'validate_vault',
  {
    description: 'Run Codex vault validation through Galpi.',
    inputSchema: {},
  },
  async () => jsonResult(await apiRequest('/api/vault/validate', { method: 'POST' }))
);

server.registerTool(
  'run_organize_process',
  {
    description: 'Run one pending Codex organize job through Galpi. This may edit vault CODEX sections via the server validation pipeline.',
    inputSchema: {},
  },
  async () => jsonResult(await apiRequest('/api/organize/process', { method: 'POST' }))
);

server.registerTool(
  'archive_note',
  {
    description: 'Archive one active note by filename through Galpi. This moves the note to _archive and updates DB/frontmatter.',
    inputSchema: {
      filename: z.string().regex(/^[^/\\]+\.md$/),
    },
  },
  async ({ filename }) => jsonResult(await apiRequest('/api/notes/archive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename }),
  }))
);

server.registerTool(
  'restore_note',
  {
    description: 'Restore one archived note by filename through Galpi. This moves the note back to the active vault and marks it pending.',
    inputSchema: {
      filename: z.string().regex(/^[^/\\]+\.md$/),
    },
  },
  async ({ filename }) => jsonResult(await apiRequest('/api/notes/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename }),
  }))
);

server.registerTool(
  'list_merge_candidates',
  {
    description: 'List note merge candidates from Galpi. Read-only: merge execution must be approved through Xion before any merge API is called.',
    inputSchema: {},
  },
  async () => jsonResult(await apiRequest('/api/notes/merge-candidates'))
);

const transport = new StdioServerTransport();
await server.connect(transport);
