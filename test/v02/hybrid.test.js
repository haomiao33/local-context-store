import test from 'node:test';
import assert from 'node:assert/strict';
import { hybridRank } from '../../src/hybrid.js';

test('hybrid ranking merges lexical and semantic candidates', () => {
  const rows = hybridRank({
    lexical: [
      { id: 'exact', ftsScore: 0.95, importance: 0.5, recency: 0.5 },
      { id: 'lexical', ftsScore: 0.8, importance: 0.5, recency: 0.5 },
    ],
    semantic: [
      { id: 'semantic', semanticScore: 0.98, importance: 0.5, recency: 0.5 },
      { id: 'exact', semanticScore: 0.7, importance: 0.5, recency: 0.5 },
    ],
    weights: { lexical: 0.35, semantic: 0.45, importance: 0.15, recency: 0.05 },
  });
  assert.equal(new Set(rows.map(row => row.id)).size, 3);
  assert.ok(rows.find(row => row.id === 'exact'));
  assert.equal(rows[0].id, 'semantic');
});

test('hybrid ranking keeps importance and recency as secondary signals', () => {
  const rows = hybridRank({
    lexical: [{ id: 'old', ftsScore: 0.7, importance: 1, recency: 0 }],
    semantic: [{ id: 'new', semanticScore: 0.7, importance: 0.5, recency: 1 }],
    weights: { lexical: 0.35, semantic: 0.45, importance: 0.15, recency: 0.05 },
  });
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => Number.isFinite(row.score)));
});

test('hybrid ranking works when one retrieval source has no results', () => {
  const rows = hybridRank({
    lexical: [],
    semantic: [{ id: 'semantic-only', semanticScore: 0.9, importance: 0.5, recency: 0.5 }],
  });
  assert.deepEqual(rows.map(row => row.id), ['semantic-only']);
});

test('hybrid ranking is deterministic for equal inputs', () => {
  const input = {
    lexical: [{ id: 'a', ftsScore: 0.5, importance: 0.5, recency: 0.5 }],
    semantic: [{ id: 'a', semanticScore: 0.5, importance: 0.5, recency: 0.5 }],
  };
  assert.deepEqual(hybridRank(input), hybridRank(input));
});
