import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../../src/store.js';
import { createEmbeddingProvider } from '../../src/embedding.js';

function createProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lcs-hybrid-'));
}

function createTestEmbeddingProvider() {
  const vectors = new Map([
    ['fix authentication refresh concurrency', [1, 1, 0, 0]],
    ['Public auth API must not change', [1, 0.8, 0, 0]],
    ['Authentication renewal has a concurrency issue', [1, 1, 0, 0]],
    ['CSS grid dashboard layout', [0, 0, 1, 1]],
  ]);
  return {
    model: 'test-fixture-v1',
    dimensions: 4,
    async embed(text) {
      if (vectors.has(text)) return vectors.get(text);
      return [0, 0, 0, 1];
    },
  };
}

test('contextAsync combines lexical and semantic retrieval', async () => {
  const projectDir = createProject();
  const projectId = path.resolve(projectDir);
  const store = createStore(projectDir);
  const embeddingProvider = createTestEmbeddingProvider();
  try {
    const lexical = store.remember({ projectId, type: 'constraint', content: 'Public auth API must not change', importance: 1 });
    const semantic = store.remember({ projectId, type: 'observation', content: 'Authentication renewal has a concurrency issue', importance: 0.8 });
    const unrelated = store.remember({ projectId, type: 'note', content: 'CSS grid dashboard layout' });

    const result = await store.contextAsync({
      projectId,
      task: 'fix authentication refresh concurrency',
      budget: 2000,
      embeddingProvider,
    });

    const ids = result.items.map(item => item.id);
    assert.ok(ids.includes(semantic.id));
    assert.ok(ids.includes(lexical.id));
    assert.ok(!ids.includes(unrelated.id));
    assert.ok(result.items.every(item => Number.isFinite(item.score)));
  } finally {
    store.close();
  }
});

test('contextAsync reuses persisted embeddings on repeated queries', async () => {
  const projectDir = createProject();
  const projectId = path.resolve(projectDir);
  const store = createStore(projectDir);
  const embeddingProvider = createEmbeddingProvider({ backend: 'hash', model: 'test-hash-v1', dimensions: 128 });
  let calls = 0;
  const original = embeddingProvider.embed;
  embeddingProvider.embed = async text => {
    calls++;
    return original(text);
  };
  try {
    store.remember({ projectId, content: 'authentication refresh race' });
    await store.contextAsync({ projectId, task: 'authentication refresh race', embeddingProvider });
    const firstCalls = calls;
    await store.contextAsync({ projectId, task: 'authentication refresh race', embeddingProvider });
    assert.equal(calls, firstCalls + 1);
  } finally {
    store.close();
  }
});
