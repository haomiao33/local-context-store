#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { createStore, projectDatabase, ITEM_TYPES } from './store.js';

const cwd = process.cwd();
const program = new Command();
program.name('ctx').description('Local context store for coding agents').version('0.1.0');

program.command('init').description('Initialize the project context database').action(() => {
  const store = createStore(cwd); store.close();
  console.log(`Initialized ${projectDatabase(cwd)}`);
});

program.command('remember <content>').description('Store durable project context')
  .option('-t, --type <type>', 'fact|decision|task|constraint|observation|note', 'note')
  .option('-i, --importance <number>', '0..1', '0.5')
  .action((content, opts) => {
    if (!ITEM_TYPES.includes(opts.type)) throw new Error(`invalid type: ${opts.type}`);
    const store = createStore(cwd);
    const item = store.remember({ projectId: path.resolve(cwd), type: opts.type, content, importance: Number(opts.importance) });
    store.close();
    console.log(`[${item.type}] ${item.id}\n${item.content}`);
  });

program.command('search <query>').description('Search stored context')
  .option('-l, --limit <number>', 'max results', '20')
  .action((query, opts) => {
    const store = createStore(cwd);
    const rows = store.search({ projectId: path.resolve(cwd), query, limit: Number(opts.limit) });
    store.close();
    for (const r of rows) console.log(`${r.id}  [${r.type}] ${r.content}`);
  });

program.command('context <task>').description('Build a task-oriented context pack')
  .option('-b, --budget <number>', 'approximate token budget', '8000')
  .action((task, opts) => {
    const store = createStore(cwd);
    const result = store.context({ projectId: path.resolve(cwd), task, budget: Number(opts.budget) });
    store.close();
    console.log(`Context\n────────────────────────────\nTask\n  ${task}\n`);
    for (const item of result.items) console.log(`[${item.type}] ${item.content}\n`);
    console.log(`Items: ${result.items.length}  Approx. tokens: ${result.tokenCount}`);
  });

program.command('snapshot <title>').description('Create a resume checkpoint')
  .option('-g, --goal <goal>')
  .option('-t, --task <task>')
  .action((title, opts) => {
    const store = createStore(cwd);
    const projectId = path.resolve(cwd);
    const context = opts.task ? store.context({ projectId, task: opts.task, budget: 4000 }) : { items: [] };
    const state = { task: opts.task ?? null, context: context.items.map(({ id, type, content }) => ({ id, type, content })) };
    const snapshot = store.snapshot({ projectId, title, goal: opts.goal ?? null, state, tokenCount: context.tokenCount ?? 0 });
    store.close();
    console.log(`Snapshot ${snapshot.id} created.`);
  });

program.command('show-snapshot').description('Show the latest resume checkpoint').action(() => {
  const store = createStore(cwd);
  const snapshot = store.latestSnapshot(path.resolve(cwd));
  store.close();
  if (!snapshot) return console.log('No snapshots.');
  console.log(JSON.stringify(snapshot, null, 2));
});

program.command('mcp').description('Start the MCP server').action(async () => {
  await import('./mcp.js');
});

program.parseAsync().catch(err => { console.error(err.message); process.exit(1); });
