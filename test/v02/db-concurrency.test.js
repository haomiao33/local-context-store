import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

function runOpenWorker(projectDir) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(`
      import { parentPort, workerData } from 'node:worker_threads';
      import { createStore } from ${JSON.stringify(new URL('../../src/store.js', import.meta.url).href)};
      try {
        const store = createStore(workerData.projectDir);
        store.close();
        parentPort.postMessage({ ok: true });
      } catch (error) {
        parentPort.postMessage({ ok: false, error: error.stack });
      }
    `, { eval: true, type: 'module', workerData: { projectDir } });
    worker.once('message', message => message.ok ? resolve() : reject(new Error(message.error)));
    worker.once('error', reject);
    worker.once('exit', code => {
      if (code !== 0) reject(new Error(`worker exited with code ${code}`));
    });
  });
}

test('multiple processes can initialize the same SQLite project concurrently', { timeout: 30_000 }, async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcs-db-concurrency-'));
  await Promise.all(Array.from({ length: 8 }, () => runOpenWorker(projectDir)));
  assert.ok(fs.existsSync(path.join(projectDir, '.context', 'context.db')));
});
