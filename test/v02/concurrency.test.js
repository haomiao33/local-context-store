import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { createStore } from '../../src/store.js';

function runWorker(workerData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./concurrency-worker.js', import.meta.url), { workerData });
    worker.once('message', message => message.ok ? resolve() : reject(new Error(message.error)));
    worker.once('error', reject);
    worker.once('exit', code => {
      if (code !== 0) reject(new Error(`worker exited with code ${code}`));
    });
  });
}

test('randomized concurrent writers and readers share one SQLite project safely', { timeout: 30_000 }, async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcs-concurrency-'));
  const projectId = path.resolve(projectDir);
  const workers = 8;
  const writesPerWorker = 100;
  const searchesPerWorker = 100;
  const rssBefore = process.memoryUsage().rss;

  const started = performance.now();
  await Promise.all(Array.from({ length: workers }, (_, workerId) => runWorker({
    projectDir,
    projectId,
    workerId,
    writes: writesPerWorker,
    searches: searchesPerWorker,
  })));
  const elapsedMs = performance.now() - started;
  const rssAfter = process.memoryUsage().rss;

  const store = createStore(projectDir);
  try {
    const rows = store.search({ projectId, query: 'authentication', limit: 10_000 });
    const count = store.db.prepare('SELECT COUNT(*) AS count FROM items WHERE project_id = ?').get(projectId).count;
    const totalOps = workers * (writesPerWorker + searchesPerWorker);
    const opsPerSecond = totalOps / (elapsedMs / 1000);
    console.log(`\n[v0.2 concurrency] workers=${workers} writes=${workers * writesPerWorker} searches=${workers * searchesPerWorker} elapsed=${elapsedMs.toFixed(1)}ms ops/s=${opsPerSecond.toFixed(1)} rssDeltaMB=${((rssAfter - rssBefore) / 1024 / 1024).toFixed(1)}`);
    assert.equal(count, workers * writesPerWorker);
    assert.ok(rows.length > 0);
    assert.ok(Number.isFinite(elapsedMs));
  } finally {
    store.close();
  }
});
