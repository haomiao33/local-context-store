import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../../src/store.js';
import { hashText } from '../../src/embedding.js';

function createProject() { return fs.mkdtempSync(path.join(os.tmpdir(), 'lcs-write-')); }

function withStore(fn) {
  const projectDir = createProject();
  const store = createStore(projectDir);
  try { return fn(store, path.resolve(projectDir)); } finally { store.close(); }
}

// --- forget ---------------------------------------------------------------

test('forget removes an item that turned out to be wrong', () => {
  withStore((store, projectId) => {
    const item = store.remember({ projectId, content: 'auth uses Redux', type: 'decision' });
    assert.equal(store.forget(item.id), true);
    assert.equal(store.get(item.id), null);
    assert.equal(store.stats({ projectId }).items.total, 0);
  });
});

test('forget reports false for an id that is not there', () => {
  withStore(store => assert.equal(store.forget('00000000-0000-0000-0000-000000000000'), false));
});

// items_fts has no foreign key to items, so a plain DELETE would leave the
// index behind and make search return rows that no longer exist.
test('forget clears the FTS index entry rather than leaving drift behind', () => {
  withStore((store, projectId) => {
    const item = store.remember({ projectId, content: 'auth uses Redux' });
    store.remember({ projectId, content: 'payments must stay stable' });
    store.forget(item.id);

    const stats = store.stats({ projectId });
    assert.equal(stats.items.total, 1);
    assert.equal(stats.fts.indexed, 1);
    assert.equal(stats.fts.drift, false);
    assert.deepEqual(store.search({ projectId, query: 'Redux' }), []);
  });
});

test('forget drops the stored embedding with the item', () => {
  withStore((store, projectId) => {
    const item = store.remember({ projectId, content: 'auth uses Redux' });
    store.saveEmbedding({ itemId: item.id, model: 'test-model-v1', vector: [1, 0], contentHash: hashText(item.content) });
    store.forget(item.id);
    assert.equal(store.getEmbedding(item.id), null);
  });
});

// --- remember is idempotent ----------------------------------------------

test('remembering the same content twice updates the entry instead of duplicating it', () => {
  withStore((store, projectId) => {
    const first = store.remember({ projectId, content: '认证用 Zustand', type: 'decision', importance: 0.5 });
    const second = store.remember({ projectId, content: '认证用 Zustand', type: 'decision', importance: 0.9 });

    assert.equal(second.id, first.id, 'the existing entry should be reused');
    assert.equal(second.importance, 0.9, 'the newer importance wins');
    assert.equal(second.created_at, first.created_at, 'creation time is preserved');
    assert.ok(second.updated_at >= first.updated_at);
    assert.equal(store.stats({ projectId }).items.total, 1);
  });
});

test('re-remembering can correct the type of an existing entry', () => {
  withStore((store, projectId) => {
    const note = store.remember({ projectId, content: 'do not change the public API', type: 'note' });
    const constraint = store.remember({ projectId, content: 'do not change the public API', type: 'constraint' });
    assert.equal(constraint.id, note.id);
    assert.equal(constraint.type, 'constraint');
    assert.deepEqual(store.stats({ projectId }).items.byType, { constraint: 1 });
  });
});

test('deduplication is scoped to a project', () => {
  withStore((store, projectId) => {
    store.remember({ projectId, content: 'shared wording' });
    store.remember({ projectId: '/somewhere/else', content: 'shared wording' });
    assert.equal(store.stats({ projectId }).items.total, 1);
    assert.equal(store.stats({ projectId: '/somewhere/else' }).items.total, 1);
  });
});

test('deduplication leaves exactly one FTS row, so search returns one hit', () => {
  withStore((store, projectId) => {
    store.remember({ projectId, content: 'authentication refresh race' });
    store.remember({ projectId, content: 'authentication refresh race' });
    const stats = store.stats({ projectId });
    assert.equal(stats.fts.indexed, 1);
    assert.equal(stats.fts.drift, false);
    assert.equal(store.search({ projectId, query: 'authentication' }).length, 1);
  });
});

test('an unchanged re-remember keeps the existing embedding current', () => {
  withStore((store, projectId) => {
    const model = 'test-model-v1';
    const item = store.remember({ projectId, content: 'auth uses Zustand' });
    store.saveEmbedding({ itemId: item.id, model, vector: [1, 0], contentHash: hashText(item.content) });
    store.remember({ projectId, content: 'auth uses Zustand', importance: 0.9 });
    assert.equal(store.stats({ projectId, model }).embeddings.current, 1);
  });
});

test('content is compared after trimming, the same way it is stored', () => {
  withStore((store, projectId) => {
    const first = store.remember({ projectId, content: 'trimmed content' });
    const second = store.remember({ projectId, content: '  trimmed content  ' });
    assert.equal(second.id, first.id);
  });
});

// --- reindex --------------------------------------------------------------

test('reindex repairs a drifted FTS index so search finds items again', () => {
  withStore((store, projectId) => {
    store.remember({ projectId, content: 'authentication refresh race' });
    store.remember({ projectId, content: 'payments must stay stable' });
    store.db.prepare('DELETE FROM items_fts').run();
    assert.equal(store.stats({ projectId }).fts.drift, true);
    assert.deepEqual(store.search({ projectId, query: 'authentication' }), []);

    const result = store.reindex();

    assert.equal(result.indexed, 2);
    assert.equal(store.stats({ projectId }).fts.drift, false);
    assert.equal(store.search({ projectId, query: 'authentication' }).length, 1);
  });
});

test('reindex is safe to run when the index is already healthy', () => {
  withStore((store, projectId) => {
    store.remember({ projectId, content: 'authentication refresh race' });
    store.reindex();
    store.reindex();
    const stats = store.stats({ projectId });
    assert.equal(stats.fts.indexed, 1);
    assert.equal(stats.fts.drift, false);
  });
});
