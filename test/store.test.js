import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/store.js';

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lcs-'));
}

function withStore(fn) {
  const project = tempProject();
  const store = createStore(project);
  try {
    return fn(store, path.resolve(project));
  } finally {
    store.close();
  }
}

test('remember and search persist context', () => withStore((store, projectId) => {
  const item = store.remember({ projectId, type: 'decision', content: 'Auth state uses Zustand', importance: 0.9 });
  assert.equal(item.type, 'decision');
  const rows = store.search({ projectId, query: 'Zustand' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, item.id);
}));

test('search matches any query token and returns relevant context', () => withStore((store, projectId) => {
  const item = store.remember({ projectId, type: 'observation', content: 'Refresh requests can race', importance: 0.8 });
  store.remember({ projectId, type: 'note', content: 'React component architecture' });
  const rows = store.search({ projectId, query: 'authentication refresh race' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, item.id);
}));

test('context retrieves relevant items for a coding task', () => withStore((store, projectId) => {
  const constraint = store.remember({ projectId, type: 'constraint', content: 'Public auth API must not change', importance: 1 });
  const observation = store.remember({ projectId, type: 'observation', content: 'Refresh requests can race', importance: 0.8 });
  const decision = store.remember({ projectId, type: 'decision', content: 'Auth state uses Zustand', importance: 0.9 });
  store.remember({ projectId, type: 'note', content: 'React component architecture' });

  const result = store.context({ projectId, task: 'fix authentication refresh race', budget: 8000 });
  const ids = result.items.map(item => item.id);

  assert.ok(ids.includes(constraint.id));
  assert.ok(ids.includes(observation.id));
  assert.ok(ids.includes(decision.id));
  assert.ok(!ids.includes(undefined));
  assert.ok(result.items.length > 0);
}));

test('context falls back to per-token retrieval when the full task has no results', () => withStore((store, projectId) => {
  const item = store.remember({ projectId, type: 'observation', content: 'Refresh requests can race', importance: 0.8 });
  const result = store.context({ projectId, task: 'zzzzzz refresh', budget: 8000 });
  assert.ok(result.items.some(candidate => candidate.id === item.id));
}));

test('context respects a token budget for normal-sized items', () => withStore((store, projectId) => {
  for (let i = 0; i < 20; i++) {
    store.remember({ projectId, type: 'note', content: `authentication refresh detail ${i}`, importance: i / 20 });
  }
  const result = store.context({ projectId, task: 'authentication refresh', budget: 40 });
  assert.ok(result.items.length > 0);
  assert.ok(result.tokenCount <= 40);
}));

test('importance outside 0..1 is rejected', () => withStore((store, projectId) => {
  assert.throws(() => store.remember({ projectId, content: 'low', importance: -2 }), /importance must be a number between 0 and 1/);
  assert.throws(() => store.remember({ projectId, content: 'high', importance: 2 }), /importance must be a number between 0 and 1/);
}));

test('invalid context type is rejected', () => withStore((store, projectId) => {
  assert.throws(() => store.remember({ projectId, type: 'unknown', content: 'x' }), /invalid type/);
}));

test('empty content is rejected', () => withStore((store, projectId) => {
  assert.throws(() => store.remember({ projectId, content: '   ' }), /content is required/);
}));

test('snapshot round trips state', () => withStore((store, projectId) => {
  store.snapshot({ projectId, title: 'Auth handoff', state: { task: 'fix auth', status: 'in_progress' } });
  const latest = store.latestSnapshot(projectId);
  assert.equal(latest.title, 'Auth handoff');
  assert.equal(latest.state.status, 'in_progress');
}));
