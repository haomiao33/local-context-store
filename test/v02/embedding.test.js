import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmbeddingProvider, hashText } from '../../src/embedding.js';

test('embedding provider returns a normalized vector', async () => {
  const provider = createEmbeddingProvider({ model: 'test-hash-v1', dimensions: 64 });
  const vector = await provider.embed('authentication refresh race');
  assert.equal(vector.length, 64);
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  assert.ok(Math.abs(norm - 1) < 1e-6);
});

test('same text produces the same embedding', async () => {
  const provider = createEmbeddingProvider({ model: 'test-hash-v1', dimensions: 64 });
  const a = await provider.embed('auth state uses Zustand');
  const b = await provider.embed('auth state uses Zustand');
  assert.deepEqual(a, b);
});

test('similar text is closer than unrelated text', async () => {
  const provider = createEmbeddingProvider({ model: 'test-hash-v1', dimensions: 256 });
  const query = await provider.embed('authentication refresh race');
  const similar = await provider.embed('auth token refresh concurrency issue');
  const unrelated = await provider.embed('CSS grid layout for dashboard');
  assert.ok(provider.similarity(query, similar) > provider.similarity(query, unrelated));
});

test('embedding cache key changes when content changes', () => {
  assert.notEqual(hashText('auth'), hashText('authentication'));
  assert.equal(hashText('auth'), hashText('auth'));
});

test('embedding provider rejects empty input', async () => {
  const provider = createEmbeddingProvider({ model: 'test-hash-v1', dimensions: 64 });
  await assert.rejects(() => provider.embed('   '), /text is required/);
});
