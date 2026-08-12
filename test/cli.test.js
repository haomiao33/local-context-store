import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = path.resolve(process.cwd(), 'src/cli.js');

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lcs-cli-'));
}

function run(project, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: project,
    encoding: 'utf8'
  });
}

test('cli init creates the project-local database', () => {
  const project = tempProject();
  const result = run(project, ['init']);
  assert.equal(result.status, 0);
  assert.ok(fs.existsSync(path.join(project, '.context', 'context.db')));
  assert.match(result.stdout, /Initialized/);
});

test('cli remember accepts valid type and importance', () => {
  const project = tempProject();
  assert.equal(run(project, ['init']).status, 0);
  const result = run(project, ['remember', 'Auth uses Zustand', '--type', 'decision', '--importance', '0.9']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /\[decision\]/);
  assert.match(result.stdout, /Auth uses Zustand/);
});

test('cli remember rejects invalid importance', () => {
  const project = tempProject();
  assert.equal(run(project, ['init']).status, 0);
  const result = run(project, ['remember', 'Invalid importance', '--importance', '2']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /importance must be a number between 0 and 1/);
});

test('cli search requires a query', () => {
  const project = tempProject();
  assert.equal(run(project, ['init']).status, 0);
  const result = run(project, ['search']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing required argument 'query'/);
});

test('cli context validates the budget', () => {
  const project = tempProject();
  assert.equal(run(project, ['init']).status, 0);
  const result = run(project, ['context', 'auth', '--budget', '0']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /budget must be a positive integer/);
});

test('cli help documents the core commands and options', () => {
  const project = tempProject();
  const result = run(project, ['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /remember/);
  assert.match(result.stdout, /context/);
  assert.match(result.stdout, /snapshot/);
  assert.match(result.stdout, /mcp/);
});
