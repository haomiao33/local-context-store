#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { createStore, projectDatabase, ITEM_TYPES } from './store.js';
import { DEFAULT_EMBEDDING_DIMENSIONS } from './embedding.js';
import { getEmbeddingProvider } from './embedding.js';
import { getModelBaseDir, modelStatus, installModel, removeModel, ensureModelReady } from './model.js';

const cwd = process.cwd();
const projectId = path.resolve(cwd);

// Single source of truth for the version: the published package manifest.
// npm always ships package.json, so this resolves for both `npm link` and
// global installs.
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const SOURCE_LABELS = { packaged: 'shipped with the package', user: 'installed locally' };

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function formatAge(timestamp) {
  if (!timestamp) return 'never';
  const seconds = Math.max(0, (Date.now() - Date.parse(timestamp)) / 1000);
  if (seconds < 90) return 'just now';
  const minutes = seconds / 60;
  if (minutes < 90) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 36) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// The database keeps its write-ahead log alongside the main file; reporting the
// main file alone understates the footprint after heavy writes.
function databaseBytes(databasePath) {
  return ['', '-wal', '-shm'].reduce((total, suffix) => {
    try { return total + fs.statSync(`${databasePath}${suffix}`).size; } catch { return total; }
  }, 0);
}

const program = new Command();

program
  .name('lcs')
  .description('Local Context Store for coding agents')
  .version(pkg.version)
  .showHelpAfterError();

program.command('init').description('Initialize a project-local context database at .context/context.db').action(() => {
  const store = createStore(cwd); store.close();
  console.log(`Initialized ${projectDatabase(cwd)}`);
});

program.command('remember <content>')
  .description('Save durable project context that agents should remember')
  .addHelpText('after', '\nExamples:\n  $ lcs remember "Auth uses Zustand" --type decision --importance 0.9\n  $ lcs remember "Do not change public auth API" --type constraint --importance 1\n')
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

program.command('search <query>')
  .description('Find stored context by full-text search')
  .addHelpText('after', '\nExamples:\n  $ lcs search "authentication refresh"\n  $ lcs search "public API" --limit 10\n')
  .option('-l, --limit <number>', 'maximum number of results', '20')
  .action((query, opts) => {
    const limit = Number(opts.limit);
    if (!Number.isInteger(limit) || limit < 1) throw new Error('limit must be a positive integer');
    const store = createStore(cwd);
    const rows = store.search({ projectId, query, limit });
    store.close();
    for (const r of rows) console.log(`${r.id}  [${r.type}] ${r.content}`);
  });

program.command('forget <id>')
  .description('Remove a stored entry that is wrong or no longer true')
  .addHelpText('after', '\nExamples:\n  $ lcs forget 11afcbf5-0ffc-4886-80ee-41669a37e80a\n\nIds are shown by `lcs search`. Removing an entry also clears its search index\nrow and its embedding.\n')
  .action(id => {
    const store = createStore(cwd);
    let forgotten;
    try { forgotten = store.forget(id); } finally { store.close(); }
    if (!forgotten) throw new Error(`no item with id ${id}`);
    console.log(`Forgot ${id}`);
  });

program.command('reindex')
  .description('Rebuild the full-text search index from the stored items')
  .addHelpText('after', '\nExamples:\n  $ lcs reindex\n\nRun this when `lcs status` reports FTS index drift; until then search silently\nmisses the items that are not indexed.\n')
  .action(() => {
    const store = createStore(cwd);
    let result;
    try { result = store.reindex(); } finally { store.close(); }
    console.log(`Reindexed ${result.indexed} item${result.indexed === 1 ? '' : 's'}`);
  });

program.command('context <task>')
  .description('Build a relevant, token-budgeted context pack for a coding task')
  .addHelpText('after', '\nExamples:\n  $ lcs context "fix authentication refresh race"\n  $ lcs context "fix authentication refresh race" --semantic\n  $ lcs context "refactor payment service" --budget 4000\n\nThe budget is an approximate token limit for the returned context pack.\n--semantic enables local embedding + FTS5 hybrid retrieval.\nThe q4 model ships with the package and is used directly; there is nothing to install.\n')
  .option('-b, --budget <number>', 'approximate token budget for the context pack', '8000')
  .option('--semantic', 'use local embedding + FTS5 hybrid retrieval')
  .action(async (task, opts) => {
    const budget = Number(opts.budget);
    if (!Number.isInteger(budget) || budget < 1) throw new Error('budget must be a positive integer');
    if (opts.semantic) {
      const ready = await ensureModelReady();
      if (ready.source !== 'packaged' && ready.source !== 'user') {
        console.error(`Downloaded the ${ready.dtype} model from ${ready.source} into ${ready.dir}`);
      }
    }
    const store = createStore(cwd);
    const result = opts.semantic
      ? await store.contextAsync({ projectId, task, budget, embeddingProvider: getEmbeddingProvider() })
      : store.context({ projectId, task, budget });
    store.close();
    console.log(`Context${opts.semantic ? ' (hybrid)' : ''}\n────────────────────────────\nTask\n  ${task}\n`);
    for (const item of result.items) console.log(`[${item.type}] ${item.content}\n`);
    console.log(`Items: ${result.items.length}  Approx. tokens: ${result.tokenCount}`);
  });

program.command('status')
  .description('Show what this project remembers and whether an agent can retrieve it')
  .addHelpText('after', '\nExamples:\n  $ lcs status\n  $ lcs status --project ~/work/api\n  $ lcs status --json\n\nA project id is the absolute path of the project directory, so --project takes\nthat directory and reads its .context/context.db.\n')
  .option('-p, --project <directory>', 'report on another project directory instead of the current one')
  .option('--json', 'emit machine-readable output for agents and scripts')
  .action(opts => {
    const projectDir = opts.project ? path.resolve(opts.project) : cwd;
    const project = path.resolve(projectDir);
    const databasePath = projectDatabase(projectDir);
    const model = modelStatus();
    const store = createStore(projectDir);
    let stats;
    try { stats = store.stats({ projectId: project }); } finally { store.close(); }
    const bytes = databaseBytes(databasePath);

    if (opts.json) {
      console.log(JSON.stringify({
        version: pkg.version,
        model: {
          available: model.available,
          resolvedFrom: model.resolvedFrom,
          name: model.model,
          dtype: model.dtype,
          dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
          path: model.dir,
        },
        database: { path: databasePath, bytes },
        project: stats,
      }, null, 2));
      return;
    }

    const typeBreakdown = Object.entries(stats.items.byType).map(([type, count]) => `${type} ${count}`).join(' · ');
    const modelState = model.available ? `available (${SOURCE_LABELS[model.resolvedFrom]})` : 'not available';

    console.log('Runtime');
    console.log(`  lcs            ${pkg.version}`);
    console.log(`  Model          ${modelState} · ${model.dtype} · ${DEFAULT_EMBEDDING_DIMENSIONS}d`);
    console.log(`  Path           ${model.dir}`);
    console.log(`\nProject  ${project}`);
    console.log(`  Database       ${databasePath}  (${formatBytes(bytes)})`);
    console.log(`  Items          ${stats.items.total}${typeBreakdown ? `   ${typeBreakdown}` : ''}`);
    console.log(`  High-signal    ${stats.items.highSignal} at importance >= 0.8`);
    console.log(`  Updated        newest ${formatAge(stats.items.newestUpdatedAt)} · oldest ${formatAge(stats.items.oldestUpdatedAt)}`);
    console.log(`  Sessions       ${stats.sessions.total}`);
    console.log(`  Snapshots      ${stats.snapshots.total}${stats.snapshots.latest ? `   latest "${stats.snapshots.latest.title}" (${formatAge(stats.snapshots.latest.createdAt)})` : ''}`);
    console.log('\nRetrieval');
    console.log(`  FTS index      ${stats.fts.indexed} / ${stats.fts.total} indexed${stats.fts.drift ? '   ← drift: search will miss unindexed items' : ''}`);
    const stale = stats.embeddings.total - stats.embeddings.current;
    console.log(`  Embeddings     ${stats.embeddings.current} / ${stats.embeddings.total} current${stale ? `  (${stale} missing or stale, recomputed on the next --semantic run)` : ''}`);
    console.log(`                 ${stats.embeddings.model}`);
  });

const model = program.command('model').description('Manage the local embedding model');
model.command('status').description('Show local q4 embedding model status and path').action(() => {
  const status = modelStatus();
  const where = status.available ? `available (${SOURCE_LABELS[status.resolvedFrom]})` : 'not available';
  console.log(`Model: ${status.model}\nDtype: ${status.dtype}\nStatus: ${where}\nPath: ${status.dir}`);
  for (const file of status.files) console.log(`  ${file.exists ? '✓' : '✗'} ${file.file}`);
  if (!status.available) console.log('\nNo model found. Run `lcs model install` to download it.');
});
model.command('install')
  .description('Download the q4 embedding model into the user data directory')
  .addHelpText('after', '\nExamples:\n  $ lcs model install\n  $ lcs model install --source C:\\models\\all-MiniLM-L6-v2-ONNX\n\nInstalling is normally unnecessary: the npm package ships the model and it is read\nfrom there directly. Use this for a source checkout without model/, or to override\nthe packaged copy. Downloads try GitHub first, then HuggingFace.\n--source copies a manually downloaded model directory and does not use the network.\nThe source directory must contain the files shown by `lcs model status`.\n')
  .option('--source <directory>', 'copy an already-downloaded model directory instead of downloading')
  .action(async opts => {
    const status = await installModel({ sourceDir: opts.source });
    console.log(`Installed ${status.model} (${status.dtype}) from ${status.source}`);
    console.log(`Path: ${status.dir}`);
  });
model.command('remove').description('Remove the model from the user data directory').action(async () => {
  await removeModel();
  console.log(`Removed local model from ${getModelBaseDir()}`);
  console.log('The copy shipped with the package is untouched and stays available.');
});

program.command('snapshot <title>')
  .description('Save a lightweight checkpoint for resuming or handing work to another agent')
  .addHelpText('after', '\nExamples:\n  $ lcs snapshot "Auth refresh handoff" --task "fix auth refresh"\n  $ lcs snapshot "Payment refactor" --goal "preserve public API"\n')
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

program.command('show-snapshot').description('Show the latest project resume checkpoint').action(() => {
  const store = createStore(cwd);
  const snapshot = store.latestSnapshot(projectId);
  store.close();
  if (!snapshot) return console.log('No snapshots.');
  console.log(JSON.stringify(snapshot, null, 2));
});

program.command('mcp')
  .description('Start the local MCP server over stdio for Claude Code, Codex, or another MCP client')
  .addHelpText('after', '\nThe server uses the current working directory as the project and .context/context.db as its database.\n\nExample:\n  $ lcs mcp\n')
  .action(async () => { await import('./mcp.js'); });

program.parseAsync().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
