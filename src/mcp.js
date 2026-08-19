import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createStore, projectDatabase } from './store.js';
import { modelStatus } from './model.js';
import { DEFAULT_EMBEDDING_DIMENSIONS } from './embedding.js';

const projectDir = process.env.LOCAL_CONTEXT_PROJECT || process.cwd();
const projectId = path.resolve(projectDir);
const store = createStore(projectDir);

// Same source of truth as the CLI: a hardcoded string here drifted to 0.1.0
// while the package was at 0.3.x.
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const server = new McpServer({ name: 'local-context-store', version: pkg.version });

server.registerTool('context_get', {
  description: 'Retrieve durable project context relevant to the current coding task.',
  inputSchema: {
    task: z.string().min(1),
    budget: z.number().int().positive().default(8000)
  }
}, async ({ task, budget }) => {
  const result = store.context({ projectId, task, budget });
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

server.registerTool('context_remember', {
  description: 'Persist a durable project fact, decision, task, constraint, observation, or note.',
  inputSchema: {
    content: z.string().min(1),
    type: z.enum(['fact','decision','task','constraint','observation','note']).default('note'),
    importance: z.number().min(0).max(1).default(0.5)
  }
}, async ({ content, type, importance }) => {
  const item = store.remember({ projectId, content, type, importance });
  return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
});

server.registerTool('context_snapshot', {
  description: 'Create a compact checkpoint for resuming or handing work to another coding agent.',
  inputSchema: {
    title: z.string().min(1),
    goal: z.string().optional(),
    task: z.string().optional(),
    budget: z.number().int().positive().default(4000)
  }
}, async ({ title, goal, task, budget }) => {
  const context = task ? store.context({ projectId, task, budget }) : { items: [], tokenCount: 0 };
  const snapshot = store.snapshot({
    projectId,
    title,
    goal: goal ?? null,
    tokenCount: context.tokenCount,
    state: {
      task: task ?? null,
      items: context.items.map(({ id, type, content }) => ({ id, type, content }))
    }
  });
  return { content: [{ type: 'text', text: JSON.stringify(snapshot, null, 2) }] };
});

// Lexical search complements context_get: an agent looking for an exact symbol,
// error code, or API name wants the keyword hit, not a ranked context pack.
server.registerTool('context_search', {
  description: 'Find stored context by exact keyword, for symbols, API names, and error codes.',
  inputSchema: {
    query: z.string().min(1),
    limit: z.number().int().positive().max(100).default(20)
  }
}, async ({ query, limit }) => {
  const rows = store.search({ projectId, query, limit });
  return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
});

// Lets an agent judge how much to trust what it retrieves: a drifted search
// index means results are incomplete, not merely empty.
server.registerTool('context_status', {
  description: 'Report what this project remembers and whether retrieval is healthy.',
  inputSchema: {}
}, async () => {
  const model = modelStatus();
  const payload = {
    version: pkg.version,
    model: {
      available: model.available,
      resolvedFrom: model.resolvedFrom,
      name: model.model,
      dtype: model.dtype,
      dimensions: DEFAULT_EMBEDDING_DIMENSIONS
    },
    database: { path: projectDatabase(projectDir) },
    project: store.stats({ projectId })
  };
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
