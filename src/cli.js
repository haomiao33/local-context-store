#!/usr/bin/env node
import path from 'node:path';
import { Command } from 'commander';
import { createStore, projectDatabase, ITEM_TYPES } from './store.js';
import { getEmbeddingProvider } from './embedding.js';

const cwd = process.cwd();
const projectId = path.resolve(cwd);
const program = new Command();

program
  .name('ctx')
  .description('Local Context Store for coding agents')
  .version('0.2.0-alpha.1')
  .showHelpAfterError();

program
  .command('init')
  .description('Initialize a project-local context database at .context/context.db')
  .action(() => {
    const store = createStore(cwd); store.close();
    console.log(`Initialized ${projectDatabase(cwd)}`);
  });

program
  .command('remember <content>')
  .description('Save durable project context that agents should remember')
  .addHelpText('after', '\nExamples:\n  $ ctx remember "Auth uses Zustand" --type decision --importance 0.9\n  $ ctx remember "Do not change public auth API" --type constraint --importance 1\n')
  .option('-t, --type <type>', 'context type: fact|decision|task|constraint|observation|note', 'note')
  .option('-i, --importance <number>', 'importance from 0 (low) to 1 (critical)', '0.5')
  .action((content, opts) => {
    if (!ITEM_TYPES.includes(opts.type)) throw new Error(`invalid type: ${opts.type}. Choose: ${ITEM_TYPES.join(', ')}`);
    const importance = Number(opts.importance);
    if (!Number.isFinite(importance) || importance < 0 || importance > 1) throw new Error('importance must be a number between 0 and 1');
    const store = createStore(cwd);
    const item = store.remember({ projectId, type: opts.type, content, importance });
    store.close();
    console.log(`[${item.type}] ${item.id}\n${item.content}`);
  });

program
  .command('search <query>')
  .description('Find stored context by full-text search')
  .addHelpText('after', '\nExamples:\n  $ ctx search "authentication refresh"\n  $ ctx search "public API" --limit 10\n')
  .option('-l, --limit <number>', 'maximum number of results', '20')
  .action((query, opts) => {
    const limit = Number(opts.limit);
    if (!Number.isInteger(limit) || limit < 1) throw new Error('limit must be a positive integer');
    const store = createStore(cwd);
    const rows = store.search({ projectId, query, limit });
    store.close();
    for (const r of rows) console.log(`${r.id}  [${r.type}] ${r.content}`);
  });

program
  .command('context <task>')
  .description('Build a relevant, token-budgeted context pack for a coding task')
  .addHelpText('after', '\nExamples:\n  $ ctx context "fix authentication refresh race"\n  $ ctx context "fix authentication refresh race" --semantic\n  $ ctx context "refactor payment service" --budget 4000\n\nThe budget is an approximate token limit for the returned context pack.\n--semantic enables local embedding + FTS5 hybrid retrieval. The model runs locally and is cached after first use.\n')
  .option('-b, --budget <number>', 'approximate token budget for the context pack', '8000')
  .option('--semantic', 'use local embedding + FTS5 hybrid retrieval')
  .action(async (task, opts) => {
    const budget = Number(opts.budget);
    if (!Number.isInteger(budget) || budget < 1) throw new Error('budget must be a positive integer');
    const store = createStore(cwd);
    const result = opts.semantic
      ? await store.contextAsync({ projectId, task, budget, embeddingProvider: getEmbeddingProvider() })
      : store.context({ projectId, task, budget });
    store.close();
    console.log(`Context${opts.semantic ? ' (hybrid)' : ''}\n────────────────────────────\nTask\n  ${task}\n`);
    for (const item of result.items) console.log(`[${item.type}] ${item.content}\n`);
    console.log(`Items: ${result.items.length}  Approx. tokens: ${result.tokenCount}`);
  });

program
  .command('snapshot <title>')
  .description('Save a lightweight checkpoint for resuming or handing work to another agent')
  .addHelpText('after', '\nExamples:\n  $ ctx snapshot "Auth refresh handoff" --task "fix auth refresh"\n  $ ctx snapshot "Payment refactor" --goal "preserve public API"\n')
  .option('-g, --goal <goal>', 'the goal or outcome of the work')
  .option('-t, --task <task>', 'current task; related context is included in the snapshot')
  .action((title, opts) => {
    const store = createStore(cwd);
    const context = opts.task ? store.context({ projectId, task: opts.task, budget: 4000 }) : { items: [], tokenCount: 0 };
    const state = { task: opts.task ?? null, context: context.items.map(({ id, type, content }) => ({ id, type, content })) };
    const snapshot = store.snapshot({ projectId, title, goal: opts.goal ?? null, state, tokenCount: context.tokenCount });
    store.close();
    console.log(`Snapshot ${snapshot.id} created.`);
  });

program
  .command('show-snapshot')
  .description('Show the latest project resume checkpoint')
  .action(() => {
    const store = createStore(cwd);
    const snapshot = store.latestSnapshot(projectId);
    store.close();
    if (!snapshot) return console.log('No snapshots.');
    console.log(JSON.stringify(snapshot, null, 2));
  });

program
  .command('mcp')
  .description('Start the local MCP server over stdio for Claude Code, Codex, or another MCP client')
  .addHelpText('after', '\nThe server uses the current working directory as the project and .context/context.db as its database.\n\nExample:\n  $ ctx mcp\n')
  .action(async () => {
    await import('./mcp.js');
  });

program.parseAsync().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
