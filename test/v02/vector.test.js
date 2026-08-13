import test from 'node:test';
import assert from 'node:assert/strict';
import { cosineSimilarity, topKSimilar } from '../../src/vector.js';

test('cosine similarity returns 1 for identical normalized vectors', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 0], [1, 0]) - 1) < 1e-9);
});

test('cosine similarity returns 0 for orthogonal vectors', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-9);
});

test('cosine similarity rejects dimension mismatch', () => {
  assert.throws(() => cosineSimilarity([1, 0], [1]), /dimension mismatch/);
});

test('topKSimilar returns highest semantic matches in descending order', () => {
  const query = [1, 0];
  const rows = [
    { id: 'a', vector: [0.9, 0.1] },
    { id: 'b', vector: [0, 1] },
    { id: 'c', vector: [1, 0] },
  ];
  const result = topKSimilar(query, rows, 2);
  assert.deepEqual(result.map(row => row.id), ['c', 'a']);
  assert.ok(result[0].semanticScore >= result[1].semanticScore);
});

test('topKSimilar reads encoded Float32 embedding buffers without decoding arrays', () => {
  const query = [1, 0];
  const rows = [
    { id: 'a', vector_blob: Buffer.from(new Float32Array([0.9, 0.1]).buffer) },
    { id: 'b', vector_blob: Buffer.from(new Float32Array([0, 1]).buffer) },
    { id: 'c', vector_blob: Buffer.from(new Float32Array([1, 0]).buffer) },
  ];
  const result = topKSimilar(query, rows, 2);
  assert.deepEqual(result.map(row => row.id), ['c', 'a']);
  assert.ok(Math.abs(result[0].semanticScore - 1) < 1e-6);
});

test('topKSimilar keeps deterministic ordering for equal scores', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    id: `item-${String(99 - i).padStart(3, '0')}`,
    vector: [1, 0],
  }));
  const result = topKSimilar([1, 0], rows, 5);
  assert.deepEqual(result.map(row => row.id), ['item-000', 'item-001', 'item-002', 'item-003', 'item-004']);
});

test('topKSimilar handles an empty candidate set', () => {
  assert.deepEqual(topKSimilar([1, 0], [], 10), []);
});
