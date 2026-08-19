import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';

const cli = path.resolve(process.cwd(), 'src/cli.js');
function tempProject() { return fs.mkdtempSync(path.join(os.tmpdir(), 'lcs-cli-')); }
function rememberedId(result) {
  const match = result.stdout.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  assert.ok(match, `no item id in output: ${result.stdout}`);
  return match[0];
}
function run(project, args, env = {}) { return spawnSync(process.execPath, [cli, ...args], { cwd: project, encoding: 'utf8', env: { ...process.env, ...env } }); }

test('cli exposes lcs as its command name', () => {
  const result = run(tempProject(), ['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: lcs /);
});

test('cli init creates the project-local database', () => {
  const project = tempProject(); const result = run(project, ['init']);
  assert.equal(result.status, 0); assert.ok(fs.existsSync(path.join(project, '.context', 'context.db'))); assert.match(result.stdout, /Initialized/);
});

test('cli remember accepts valid type and importance', () => {
  const project = tempProject(); assert.equal(run(project, ['init']).status, 0);
  const result = run(project, ['remember', 'Auth uses Zustand', '--type', 'decision', '--importance', '0.9']);
  assert.equal(result.status, 0); assert.match(result.stdout, /\[decision\]/); assert.match(result.stdout, /Auth uses Zustand/);
});

test('cli remember rejects invalid importance', () => {
  const project = tempProject(); assert.equal(run(project, ['init']).status, 0);
  const result = run(project, ['remember', 'Invalid importance', '--importance', '2']);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /importance must be a number between 0 and 1/);
});

test('cli search requires a query', () => {
  const project = tempProject(); assert.equal(run(project, ['init']).status, 0);
  const result = run(project, ['search']); assert.notEqual(result.status, 0); assert.match(result.stderr, /missing required argument 'query'/);
});

test('cli context validates the budget', () => {
  const project = tempProject(); assert.equal(run(project, ['init']).status, 0);
  const result = run(project, ['context', 'auth', '--budget', '0']); assert.notEqual(result.status, 0); assert.match(result.stderr, /budget must be a positive integer/);
});

test('cli help documents the core commands and options', () => {
  const result = run(tempProject(), ['--help']); assert.equal(result.status, 0);
  assert.match(result.stdout, /remember/); assert.match(result.stdout, /context/); assert.match(result.stdout, /snapshot/); assert.match(result.stdout, /mcp/); assert.match(result.stdout, /model/);
});

test('cli context help documents the local semantic retrieval option', () => {
  const result = run(tempProject(), ['context', '--help']); assert.equal(result.status, 0);
  assert.match(result.stdout, /--semantic/); assert.match(result.stdout, /local embedding/); assert.match(result.stdout, /budget/);
});

test('cli model status reports the packaged model as available with no install step', () => {
  const result = run(tempProject(), ['model', 'status'], { LCS_MODEL_DIR: tempProject() });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Status: available \(shipped with the package\)/);
  assert.doesNotMatch(result.stdout, /✗/);
});

test('cli model help documents install, status, and remove', () => {
  const result = run(tempProject(), ['model', '--help']); assert.equal(result.status, 0);
  assert.match(result.stdout, /install/); assert.match(result.stdout, /status/); assert.match(result.stdout, /remove/);
});

test('cli --version matches the package version', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
  const result = run(tempProject(), ['--version']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), pkg.version);
});

test('cli status reports runtime, project, and retrieval health', () => {
  const project = tempProject();
  assert.equal(run(project, ['init']).status, 0);
  assert.equal(run(project, ['remember', 'Auth uses Zustand', '--type', 'decision', '--importance', '0.9']).status, 0);
  const result = run(project, ['status']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Runtime/);
  assert.match(result.stdout, /Project/);
  assert.match(result.stdout, /Retrieval/);
  assert.match(result.stdout, /Items\s+1/);
  assert.match(result.stdout, /decision 1/);
  assert.match(result.stdout, /FTS index\s+1 \/ 1 indexed/);
});

test('cli status works on a project that was never initialised', () => {
  const result = run(tempProject(), ['status']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Items\s+0/);
});

test('cli status --project reads another project directory', () => {
  const other = tempProject();
  assert.equal(run(other, ['init']).status, 0);
  assert.equal(run(other, ['remember', 'remote project note']).status, 0);
  const result = run(tempProject(), ['status', '--project', other]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Items\s+1/);
  assert.match(result.stdout, new RegExp(fs.realpathSync(other).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('cli status --json emits the fields an agent needs', () => {
  const project = tempProject();
  assert.equal(run(project, ['init']).status, 0);
  assert.equal(run(project, ['remember', 'Auth uses Zustand', '--type', 'decision', '--importance', '0.9']).status, 0);
  const result = run(project, ['status', '--json']);
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.version, JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')).version);
  assert.equal(payload.project.items.total, 1);
  assert.equal(payload.project.items.byType.decision, 1);
  assert.equal(payload.project.items.highSignal, 1);
  assert.equal(payload.project.fts.drift, false);
  assert.equal(payload.model.available, true);
  assert.ok(payload.database.path.endsWith(path.join('.context', 'context.db')));
  assert.ok(Number.isInteger(payload.database.bytes));
});

test('cli status reports FTS drift so a silent search gap is visible', () => {
  const project = tempProject();
  assert.equal(run(project, ['init']).status, 0);
  assert.equal(run(project, ['remember', 'will be dropped']).status, 0);
  const db = new Database(path.join(project, '.context', 'context.db'));
  db.prepare('DELETE FROM items_fts').run();
  db.close();
  const result = run(project, ['status']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /FTS index\s+0 \/ 1 indexed/);
  assert.match(result.stdout, /drift/i);
});

test('mcp server reports the package version rather than a hardcoded one', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
  const source = fs.readFileSync(path.resolve(process.cwd(), 'src/mcp.js'), 'utf8');
  assert.doesNotMatch(source, /version: '\d+\.\d+\.\d+'/, 'mcp.js must not hardcode a version');
  assert.match(source, /version: pkg\.version/);
  assert.ok(pkg.version);
});

test('cli forget removes an entry by id', () => {
  const project = tempProject();
  assert.equal(run(project, ['init']).status, 0);
  const remembered = run(project, ['remember', 'auth uses Redux', '--type', 'decision']);
  assert.equal(remembered.status, 0);
  const id = rememberedId(remembered);

  const result = run(project, ['forget', id]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Forgot/);
  assert.match(run(project, ['status']).stdout, /Items\s+0/);
});

test('cli forget fails clearly on an unknown id', () => {
  const project = tempProject();
  assert.equal(run(project, ['init']).status, 0);
  const result = run(project, ['forget', '00000000-0000-0000-0000-000000000000']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no item with id/i);
});

test('cli forget leaves no FTS drift behind', () => {
  const project = tempProject();
  assert.equal(run(project, ['init']).status, 0);
  const id = rememberedId(run(project, ['remember', 'auth uses Redux']));
  assert.equal(run(project, ['remember', 'payments must stay stable']).status, 0);
  assert.equal(run(project, ['forget', id]).status, 0);
  const status = run(project, ['status']).stdout;
  assert.match(status, /FTS index\s+1 \/ 1 indexed/);
  assert.doesNotMatch(status, /drift/);
});

test('cli remember is idempotent for identical content', () => {
  const project = tempProject();
  assert.equal(run(project, ['init']).status, 0);
  assert.equal(run(project, ['remember', 'auth uses Zustand', '--type', 'decision']).status, 0);
  assert.equal(run(project, ['remember', 'auth uses Zustand', '--type', 'decision', '--importance', '0.9']).status, 0);
  const status = run(project, ['status']).stdout;
  assert.match(status, /Items\s+1/);
  assert.match(status, /High-signal\s+1/);
});

test('cli reindex repairs a drifted FTS index', () => {
  const project = tempProject();
  assert.equal(run(project, ['init']).status, 0);
  assert.equal(run(project, ['remember', 'authentication refresh race']).status, 0);
  const db = new Database(path.join(project, '.context', 'context.db'));
  db.prepare('DELETE FROM items_fts').run();
  db.close();
  assert.match(run(project, ['status']).stdout, /drift/);

  const result = run(project, ['reindex']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Reindexed 1/);
  const status = run(project, ['status']).stdout;
  assert.match(status, /FTS index\s+1 \/ 1 indexed/);
  assert.doesNotMatch(status, /drift/);
  assert.equal(run(project, ['search', 'authentication']).stdout.trim().split('\n').length, 1);
});
