import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../../src/store.js';

function createProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lcs-embedding-'));
}

test('embedding is persisted and can be loaded without recomputing', () => {
  const projectDir = createProject();
  const projectId = path.resolve(projectDir);
  const store = createStore(projectDir);
  try {
    const item = store.remember({ projectId, content: 'authentication refresh race' });
    const vector = [0.1, 0.2, 0.3, 0.4];
    store.saveEmbedding({ itemId: item.id, model: 'test-hash-v1', vector, contentHash: 'hash-1' });
    const loaded = store.getEmbedding(item.id);
    assert.equal(loaded.model, 'test-hash-v1');
    assert.deepEqual(loaded.vector, vector);
    assert.equal(loaded.contentHash, 'hash-1');
  } finally {
    store.close();
  }
});

test('embedding can be invalidated when content hash changes', () => {
  const projectDir = createProject();
  const projectId = path.resolve(projectDir);
  const store = createStore(projectDir);
  try {
    const item = store.remember({ projectId, content: 'authentication refresh race' });
    store.saveEmbedding({ itemId: item.id, model: 'test-hash-v1', vector: [1, 0], contentHash: 'old' });
    assert.equal(store.getEmbedding(item.id, 'new'), null);
    assert.deepEqual(store.getEmbedding(item.id, 'old').vector, [1, 0]);
  } finally {
    store.close();
  }
});
