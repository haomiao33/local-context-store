import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/store.js';

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lcs-'));
}

test('remember and search persist context', () => {
  const project = tempProject();
  const store = createStore(project);
  const projectId = path.resolve(project);
  const item = store.remember({ projectId, type: 'decision', content: 'Auth state uses Zustand', importance: 0.9 });
  assert.equal(item.type, 'decision');
  const rows = store.search({ projectId, query: 'Zustand' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, item.id);
  store.close();
});

test('context applies a token budget', () => {
  const project = tempProject();
  const store = createStore(project);
  const projectId = path.resolve(project);
  for (let i = 0; i < 20; i++) store.remember({ projectId, type: 'note', content: `authentication refresh detail ${i}`, importance: i / 20 });
  const result = store.context({ projectId, task: 'authentication refresh', budget: 100 });
  assert.ok(result.items.length > 0);
  assert.ok(result.tokenCount <= 100);
  store.close();
});

test('snapshot round trips state', () => {
  const project = tempProject();
  const store = createStore(project);
  const projectId = path.resolve(project);
  store.snapshot({ projectId, title: 'Auth handoff', state: { task: 'fix auth', status: 'in_progress' } });
  const latest = store.latestSnapshot(projectId);
  assert.equal(latest.title, 'Auth handoff');
  assert.equal(latest.state.status, 'in_progress');
  store.close();
});
