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
    similarity(a, b) {
      let dot = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }
      return dot / Math.sqrt(normA * normB);
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

test('contextAsync keeps semantic candidates beyond the output limit', async () => {
  const projectDir = createProject();
  const projectId = path.resolve(projectDir);
  const store = createStore(projectDir);
  const embeddingProvider = {
    model: 'recall-fixture-v1',
    dimensions: 2,
    async embed(text) {
      if (text === 'target concept') return [1, 0];
      return [0.99, 0.14];
    },
    similarity(a, b) {
      const dot = a[0] * b[0] + a[1] * b[1];
      const normA = Math.hypot(a[0], a[1]);
      const normB = Math.hypot(b[0], b[1]);
      return dot / (normA * normB);
    },
  };
  try {
    for (let i = 0; i < 60; i++) {
      store.remember({ projectId, content: `semantic distractor ${i}`, importance: 0 });
    }
    const target = store.remember({ projectId, content: 'target concept', importance: 1 });

    const result = await store.contextAsync({
      projectId,
      task: 'target concept',
      limit: 1,
      budget: 2000,
      semanticThreshold: 0.2,
      embeddingProvider,
      weights: { lexical: 0, semantic: 0, importance: 1, recency: 0 },
    });

    const ids = result.items.map(item => item.id);
    assert.equal(ids[0], target.id);
    assert.ok(ids.length > 1, 'semantic candidates must not be capped by the lexical output limit');
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
