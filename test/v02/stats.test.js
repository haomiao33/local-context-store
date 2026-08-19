import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../../src/store.js';
import { hashText } from '../../src/embedding.js';

function createProject() { return fs.mkdtempSync(path.join(os.tmpdir(), 'lcs-stats-')); }

function withStore(fn) {
  const projectDir = createProject();
  const store = createStore(projectDir);
  try { return fn(store, path.resolve(projectDir)); } finally { store.close(); }
}

test('stats reports an empty project without inventing counts', () => {
  withStore((store, projectId) => {
    const stats = store.stats({ projectId });
    assert.equal(stats.projectId, projectId);
    assert.equal(stats.items.total, 0);
    assert.deepEqual(stats.items.byType, {});
    assert.equal(stats.items.highSignal, 0);
    assert.equal(stats.items.newestUpdatedAt, null);
    assert.equal(stats.items.oldestUpdatedAt, null);
    assert.equal(stats.sessions.total, 0);
    assert.equal(stats.snapshots.total, 0);
    assert.equal(stats.snapshots.latest, null);
  });
});

test('stats counts items by type and flags high-signal entries', () => {
  withStore((store, projectId) => {
    store.remember({ projectId, content: 'auth uses Zustand', type: 'decision', importance: 0.9 });
    store.remember({ projectId, content: 'do not change the public API', type: 'constraint', importance: 1 });
    store.remember({ projectId, content: 'refresh can race on tab restore', type: 'observation', importance: 0.4 });
    store.remember({ projectId, content: 'another decision', type: 'decision', importance: 0.8 });

    const stats = store.stats({ projectId });
    assert.equal(stats.items.total, 4);
    assert.deepEqual(stats.items.byType, { decision: 2, constraint: 1, observation: 1 });
    // importance >= 0.8 counts as high signal
    assert.equal(stats.items.highSignal, 3);
    assert.ok(stats.items.newestUpdatedAt);
    assert.ok(stats.items.oldestUpdatedAt);
  });
});

test('stats ignores items belonging to another project', () => {
  withStore((store, projectId) => {
    store.remember({ projectId, content: 'mine' });
    store.remember({ projectId: '/somewhere/else', content: 'theirs' });
    assert.equal(store.stats({ projectId }).items.total, 1);
    assert.equal(store.stats({ projectId: '/somewhere/else' }).items.total, 1);
  });
});

test('stats counts sessions and reports the latest snapshot', () => {
  withStore((store, projectId) => {
    store.startSession({ projectId, agent: 'claude-code' });
    store.startSession({ projectId, agent: 'codex' });
    store.snapshot({ projectId, title: 'first handoff' });
    store.snapshot({ projectId, title: 'auth refresh handoff', goal: 'preserve public API' });

    const stats = store.stats({ projectId });
    assert.equal(stats.sessions.total, 2);
    assert.equal(stats.snapshots.total, 2);
    assert.equal(stats.snapshots.latest.title, 'auth refresh handoff');
    assert.ok(stats.snapshots.latest.createdAt);
  });
});

test('stats reports a healthy FTS index when every item is indexed', () => {
  withStore((store, projectId) => {
    store.remember({ projectId, content: 'indexed content' });
    store.remember({ projectId, content: 'more indexed content' });
    const stats = store.stats({ projectId });
    assert.equal(stats.fts.total, 2);
    assert.equal(stats.fts.indexed, 2);
    assert.equal(stats.fts.drift, false);
  });
});

test('stats detects FTS index drift, which makes search silently miss items', () => {
  withStore((store, projectId) => {
    const item = store.remember({ projectId, content: 'will be dropped from the index' });
    store.remember({ projectId, content: 'still indexed' });
    // Simulate the drift that rebuildFts() exists to repair.
    store.db.prepare('DELETE FROM items_fts WHERE id = ?').run(item.id);

    const stats = store.stats({ projectId });
    assert.equal(stats.fts.total, 2);
    assert.equal(stats.fts.indexed, 1);
    assert.equal(stats.fts.drift, true);
  });
});

test('stats counts an embedding as current only when model and content hash match', () => {
  withStore((store, projectId) => {
    const model = 'test-model-v1';
    const fresh = store.remember({ projectId, content: 'fresh content' });
    const stale = store.remember({ projectId, content: 'edited content' });
    const otherModel = store.remember({ projectId, content: 'indexed by another model' });
    store.remember({ projectId, content: 'never embedded' });

    store.saveEmbedding({ itemId: fresh.id, model, vector: [1, 0], contentHash: hashText(fresh.content) });
    // Content changed after the embedding was written.
    store.saveEmbedding({ itemId: stale.id, model, vector: [1, 0], contentHash: hashText('the old content') });
    store.saveEmbedding({ itemId: otherModel.id, model: 'some-other-model', vector: [1, 0], contentHash: hashText(otherModel.content) });

    const stats = store.stats({ projectId, model });
    assert.equal(stats.embeddings.total, 4);
    assert.equal(stats.embeddings.current, 1);
    assert.equal(stats.embeddings.model, model);
  });
});

test('stats embedding coverage is complete after indexEmbeddings runs', async () => {
  const projectDir = createProject();
  const projectId = path.resolve(projectDir);
  const store = createStore(projectDir);
  try {
    store.remember({ projectId, content: 'auth uses Zustand' });
    store.remember({ projectId, content: 'payments must stay stable' });
    const provider = { model: 'test-model-v1', embed: async () => [0.1, 0.2, 0.3] };
    await store.indexEmbeddings({ projectId, embeddingProvider: provider });

    const stats = store.stats({ projectId, model: provider.model });
    assert.equal(stats.embeddings.current, 2);
    assert.equal(stats.embeddings.total, 2);
  } finally { store.close(); }
});

test('latestSnapshot resolves ties by insertion order, not by string comparison', () => {
  withStore((store, projectId) => {
    // Both land in the same millisecond, so created_at alone cannot order them.
    store.snapshot({ projectId, title: 'older' });
    const newer = store.snapshot({ projectId, title: 'newer' });
    assert.equal(store.latestSnapshot(projectId).id, newer.id);
    assert.equal(store.stats({ projectId }).snapshots.latest.title, 'newer');
  });
});
